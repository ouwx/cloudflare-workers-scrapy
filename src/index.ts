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
    // 新增 /news 路由，抓取 WSJ 中文网 RSS
    if (url.pathname === "/news") {
      return fetchNews(env);
    }
    // 首页查询框和自动补全
    if (url.pathname === "/") {
      // ...existing code...
    }

    return new Response("Not Found", { status: 404 });

      }
};

// 抓取华尔街日报中文网新闻 RSS 内容
async function fetchNews(env) {
  const rssUrl = "https://cn.wsj.com/zh-hans/rss";
  try {
    const resp = await fetch(rssUrl, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const xml = await resp.text();

    // 提取 <item> 块
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).map(match => {
      let title = match[1].match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || "";
      let description = match[1].match(/<description>([\s\S]*?)<\/description>/)?.[1]?.trim() || "";
      const link = match[1].match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || "";
      let guid = match[1].match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1]?.trim() || "";
      let pubDate = match[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || "";


      // 去掉 <![CDATA[ ]]> 包裹
      title = title.replace(/^<!\[CDATA\[|\]\]>$/g, "");
      description = description.replace(/^<!\[CDATA\[|\]\]>$/g, "");

      // 去掉 HTML 标签
      description = description.replace(/<[^>]+>/g, "").trim();

      // pubDate 格式化为 YYYY-MM-DD HH:MM:SS
      let pubDateObj: Date | null = null;
      if (pubDate) {
        const d = new Date(pubDate);
        if (!isNaN(d.getTime())) {
          pubDateObj = d;
          const pad = (n: number) => n.toString().padStart(2, '0');
          pubDate = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        }
      }

      return { title, description, link, guid, pubDate, pubDateObj };
    })
    // 只保留2天内的新闻
    .filter(item => item.pubDateObj && item.pubDateObj >= twoDaysAgo);

    // 用 items 的 guid 组合计算 md5
    const guidConcat = items.map(item => item.guid).join(',');
    const md5 = await getMD5(guidConcat);
    const kvKey = 'fetchNews_MD5';
    const oldMd5 = await env.KV.get(kvKey);
    console.log(`旧MD5: ${oldMd5}, 新MD5: ${md5}`);
    if (oldMd5 === md5) {
      console.log('新闻MD5未变化，跳过写入');
      return new Response('新闻数据未变化，无需更新');
    }
    // 不同则继续处理并更新 KV
    await env.KV.put(kvKey, md5);

    // 插入数据库
    const sql = `
      INSERT OR IGNORE INTO news (guid, title, description, link, pubDate)
      VALUES (?, ?, ?, ?, ?);
    `;
    try {
      const stmts = items.map(item => env.DB.prepare(sql).bind(item.guid, item.title, item.description, item.link, item.pubDate));
      await env.DB.batch(stmts);
    } catch (err) {
      console.error("批量插入新闻失败:", err);
      return new Response("新闻入库失败", { status: 500 });
    }

    // 返回插入的新闻
    return new Response(JSON.stringify(items.map(({pubDateObj, ...rest}) => rest), null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  } catch (err) {
    console.error("抓取新闻失败:", err);
    return new Response("新闻抓取失败", { status: 500 });
  }
}


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
      // 计算 data 的 md5
      const md5 = await getMD5(JSON.stringify(data));
      // 先获取 KV 里的 md5
      const kvKey = 'fetchETF_MD5';
      const oldMd5 = await env.KV.get(kvKey);
      if (oldMd5 === md5) {
        return new Response('ETF 数据未变化，无需更新');
      }
      // 不同则写数据库并更新 KV
      await env.KV.put(kvKey, md5);
      for (const item of data) {
        //写入KV
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

  // 过滤掉 trade === 0 的记录
  const beforeFilterCount = allRecords.length;
  const filteredRecords = allRecords.filter(row => {
    const trade = row[3];
    // 过滤掉为 0 或 非数值的 trade
    return trade !== 0 && !Number.isNaN(trade);
  });
  const removedCount = beforeFilterCount - filteredRecords.length;
  if (removedCount > 0) {
    console.log(`过滤掉 ${removedCount} 条 trade=0 的记录`);
  }

  // 3️⃣ 插入数据
  const sql = `
    INSERT OR REPLACE INTO ETF  
    (code, date, name, trade, pricechange, changepercent, buy, sell, settlement, open, high, low, volume, amount) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `;

  try {
    const stmts = filteredRecords.map(row => env.DB.prepare(sql).bind(...row));
    await env.DB.batch(stmts);
  } catch (err) {
    console.error("批量插入失败:", err);
  }
  console.log(`成功插入 ${filteredRecords.length} 条 ETF 记录`);
  return new Response(`ETF 数据抓取完成，共插入 ${filteredRecords.length} 条记录`);
}

// 计算字符串的 MD5 值
async function getMD5(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuf = encoder.encode(str);
  const hashBuf = await crypto.subtle.digest('MD5', dataBuf);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
