export function renderHtml(content: string) {
  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>ETF KV 查询</title>
        <link rel="stylesheet" type="text/css" href="https://static.integrations.cloudflare.com/styles.css">
      </head>
      <body>
        <header>
          <h1>ETF KV 查询</h1>
        </header>
        <main>
          ${content}
        </main>
      </body>
    </html>
  `;
}
