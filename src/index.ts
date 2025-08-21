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
