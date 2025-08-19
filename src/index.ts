export default {
  // 定时任务触发
  async scheduled(event, env, ctx) {
    ctx.waitUntil(fetchETF(env));
  },

  // HTTP 请求触发
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/scrapy-etf") {
      return fetchETF(env);
    }
    // 首页查询框和自动补全
    if (url.pathname === "/") {
      const { renderHtml } = await import("./renderHtml.js");
      const form = [
        '<form id="searchForm" style="margin-bottom:2em;" autocomplete="off">',
        '  <label for="code">ETF code/名称 查询：</label>',
        '  <input type="text" id="code" name="code" required list="suggest-list" />',
        '  <datalist id="suggest-list"></datalist>',
        '  <button type="submit">查询</button>',
        '</form>',
        '<div id="result"></div>',
        '<script>',
        'const input = document.getElementById("code");',
        'const datalist = document.getElementById("suggest-list");',
        'const resultDiv = document.getElementById("result");',
        'async function doQuery(code) {',
        '  if (!code) return;',
        '  const formData = new FormData();',
        '  formData.append("code", code);',
        '  const resp = await fetch("/", { method: "POST", body: formData });',
        '  const html = await resp.text();',
        '  resultDiv.innerHTML = html.match(/<main>([\s\S]*)<\/main>/)?.[1] || html;',
        '}',
        'input.addEventListener("input", async function(e) {',
        '  const val = input.value;',
        '  if (val.length > 2) {',
        '    const resp = await fetch("/suggest?q=" + encodeURIComponent(val));',
        '    const arr = await resp.json();',
        '    datalist.innerHTML = arr.map(function(item) { return `<option value=\'${item.code}\'>${item.code} - ${item.name}</option>`; }).join("");',
        '    doQuery(val);',
        '  } else {',
        '    datalist.innerHTML = "";',
        '    resultDiv.innerHTML = "";',
        '  }',
        '});',
        'document.getElementById("searchForm").addEventListener("submit", async function(e) {',
        '  e.preventDefault();',
        '  doQuery(input.value);',
        '});',
        '</script>'
      ].join('');
      return new Response(renderHtml(form), { headers: { "content-type": "text/html;charset=UTF-8" } });
    }

    // 自动补全建议接口
    if (url.pathname === "/suggest" && request.method === "GET") {
      const q = url.searchParams.get("q")?.trim();
      if (!q || q.length < 2) return new Response(JSON.stringify([]), { headers: { "content-type": "application/json" } });
      // 这里假设 KV 里 key 是 code，value 是 name，遍历所有 key 并模糊匹配
      // Cloudflare KV 没有直接模糊查询，只能用 list + get
      const list = await env.KV.list();
      const result = [];
      for (const { name: code } of list.keys) {
        if (result.length >= 10) break;
        if (code.includes(q)) {
          const name = await env.KV.get(code);
          result.push({ code, name });
        } else {
          const name = await env.KV.get(code);
          if (name && name.includes(q)) {
            result.push({ code, name });
          }
        }
      }
      return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
    }
    return new Response("Not Found", { status: 404 });
  }
};

async function fetchETF(env) {
  const today = new Date().toISOString().split("T")[0];
  const callbackName = "RMx2tYYlc7QrOsu";

  const baseUrl = `https://vip.stock.finance.sina.com.cn/quotes_service/api/jsonp.php/IO.XSRV2.CallbackList['${callbackName}']/Market_Center.getHQNodeDataSimple`;
  const allRecords = [];

  // 2️⃣ 分页爬取 ETF 数据
  for (let page = 1; page <= 1; page++) {
    const url = `${baseUrl}?page=${page}&num=1800&sort=symbol&asc=0&node=etf_hq_fund`;

    try {
      const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      const text = await resp.text();

      const jsonMatch = text.match(
        new RegExp(`IO\\.XSRV2\\.CallbackList\\['${callbackName}'\\]\\((.*)\\);`)
      );
      if (!jsonMatch) continue;

      const data = JSON.parse(jsonMatch[1]);
      for (const item of data) {
        //写入KV
        await env.KV.put(item.code, item.name);
        allRecords.push([
          item.code,
          today,
          item.name,
          parseFloat(item.trade),
          parseFloat(item.pricechange),
          parseFloat(item.changepercent),
          parseFloat(item.buy),
          parseFloat(item.sell),
          parseFloat(item.settlement),
          parseFloat(item.open),
          parseFloat(item.high),
          parseFloat(item.low),
          parseInt(item.volume),
          parseInt(item.amount)
        ]);
      }
    } catch (err) {
      console.error(`Page ${page} 爬取失败:`, err);
    }
  }

  console.log(`总共抓取到 ${allRecords.length} 条记录`);

  // 3️⃣ 插入数据
  const sql = `
    INSERT OR REPLACE INTO ETF  
    (code, date, name, trade, pricechange, changepercent, buy, sell, settlement, open, high, low, volume, amount) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `;

  try {
    const stmts = allRecords.map(row => env.DB.prepare(sql).bind(...row));
    await env.DB.batch(stmts);
  } catch (err) {
    console.error("批量插入失败:", err);
  }

  return new Response(`ETF 数据抓取完成，共 ${allRecords.length} 条记录`);
}
