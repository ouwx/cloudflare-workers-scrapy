// sseQueryProxy.ts
export async function fetchSseETFProxy(request: Request, env: any): Promise<Response> {
  const BASE = "https://query.sse.com.cn/commonQuery.do";
  const DEFAULT_REFERER = "https://www.sse.com.cn/market/funddata/volumn/etfvolumn/";
  const maxAttempts = 3;
  const timeoutMs = 12_000;

  try {
    // 读取 request 的 query 参数以覆盖默认值
    const reqUrl = new URL(request.url);
    const qp = reqUrl.searchParams;

    const sqlId = qp.get("sqlId") || "COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L";
    const page = qp.get("page") || "1";
    const pageSize = qp.get("pageSize") || "1000";
    const statDate = qp.get("STAT_DATE") || "";
    const referer = qp.get("referer") || DEFAULT_REFERER;

    // 支持客户端透传 cookie（如果你选择这样做），通过自定义头 x-forward-cookie
    const forwardCookie = request.headers.get("x-forward-cookie") || "";

    // 动态回调名与时间戳
    const tsBase = Date.now();
    const cbBase = `jsonpCallback${tsBase % 10000000}`;

    // 构造基础 headers（注意 Cloudflare Worker 环境对 Host/User-Agent 设置有限制）
    const baseHeaders: Record<string, string> = {
      "Referer": referer,
      "Accept": "*/*",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
    };
    if (forwardCookie) baseHeaders["Cookie"] = forwardCookie;

    // helper: 构造请求 url
    const buildTarget = (cbName: string, ts: string) => {
      const params = new URLSearchParams({
        "isPagination": "true",
        "pageHelp.pageSize": pageSize,
        "pageHelp.pageNo": page,
        "pageHelp.beginPage": page,
        "pageHelp.cacheSize": "1",
        "pageHelp.endPage": page,
        "sqlId": sqlId,
        "STAT_DATE": statDate,
        "jsonCallBack": cbName,
        "_": ts
      });
      return `${BASE}?${params.toString()}`;
    };

    // helper: 解析 jsonp -> object
    function parseJsonp(text: string, cbName: string): any | null {
      if (!text) return null;
      text = text.trim();
      // 纯 JSON
      if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
        try { return JSON.parse(text); } catch { return null; }
      }
      // 精确匹配 cbName({...})
      const re = new RegExp("^\\s*" + cbName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + "\\s*\\(\\s*([\\s\\S]*)\\s*\\)\\s*;?\\s*$", "i");
      let m = text.match(re);
      if (m && m[1]) {
        try { return JSON.parse(m[1]); } catch { return null; }
      }
      // 尝试抓最后一个花括号对象
      const re2 = /[^{]*({[\s\S]*})[\s;]*$/;
      m = text.match(re2);
      if (m && m[1]) {
        try { return JSON.parse(m[1]); } catch { return null; }
      }
      return null;
    }

    // 发请求并重试
    let lastErr: any = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ts = String(Date.now());
      const cb = `jsonpCallback${Number(ts) % 10000000}`;
      const target = buildTarget(cb, ts);

      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);

        const resp = await fetch(target, {
          method: "GET",
          headers: baseHeaders,
          signal: controller.signal,
        });

        clearTimeout(id);
        const text = await resp.text();

        // 上游可能会返回 System Error 字样 -> 视为可重试
        if (text && text.indexOf("System Error") >= 0) {
          lastErr = new Error("Upstream System Error: " + text.slice(0, 200));
          // 短延迟后重试
          await new Promise(res => setTimeout(res, 300 * attempt));
          continue;
        }

        const parsed = parseJsonp(text, cb);

        if (parsed) {
          return new Response(JSON.stringify(parsed["pageHelp"]["data"]), {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, x-forward-cookie",
            }
          });
        } else {
          // 无法解析，返回原始前 1000 字供排查（502）
          return new Response(JSON.stringify({
            success: false,
            error: "无法解析上交所返回内容（非标准 JSONP/JSON）",
            rawPreview: text.slice(0, 1000)
          }), {
            status: 502,
            headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
          });
        }
      } catch (err) {
        lastErr = err;
        // 若 AbortError 或 网络错误，等待后重试
        await new Promise(res => setTimeout(res, 400 * attempt));
        continue;
      }
    }

    return new Response(JSON.stringify({
      success: false,
      error: "请求上交所失败（重试耗尽）",
      message: String(lastErr)
    }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      success: false,
      error: "代理内部错误",
      message: String(e)
    }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
    });
  }
}
