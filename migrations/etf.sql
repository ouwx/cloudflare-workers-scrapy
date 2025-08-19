CREATE TABLE ETF (
    code TEXT NOT NULL,             -- 基金代码
    date TEXT NOT NULL,             -- 数据日期
    name TEXT,                      -- 基金名称
    trade REAL,                     -- 最新交易价格
    pricechange REAL,               -- 涨跌额
    changepercent REAL,             -- 涨跌幅百分比
    buy REAL,                       -- 买价
    sell REAL,                      -- 卖价
    settlement REAL,                -- 昨日结算价
    open REAL,                      -- 今日开盘价
    high REAL,                      -- 今日最高价
    low REAL,                       -- 今日最低价
    volume INTEGER,                 -- 成交量
    amount INTEGER,                 -- 成交额
    PRIMARY KEY (code, date)
);
