// A股复盘系统全局类型定义

/** 基础股票信息 */
export interface StockBase {
  code: string;
  name: string;
  industry?: string;
}

/** K 线数据点(用于"所处位置"量化判断 v1.9.3) */
export interface KLinePoint {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  amount: number;  // 成交额(用 amount 代理 volume,因为腾讯 K 线无 volume 字段)
}

/** 行情数据 */
export interface QuoteData extends StockBase {
  closePrice: number;
  changePercent: number;
  turnover: number; // 亿元
  volumeRatio?: number;
  turnoverRate?: number; // 换手率 %
  amount?: number; // 成交额(亿)
  sealedAmount?: number; // 封单/封板资金
  bombedCount?: number; // 炸板次数
  firstSealTime?: string; // 首次封板时间
}

/** 大盘总览 */
export interface MarketOverview {
  tradeDate: string; // 交易日 YYYYMMDD
  tradeDateSlash: string; // yy/mm/dd
  generatedAt: string; // 生成时间
  marketTurnover: number; // 全市场成交额(亿)
  turnoverDiff: number; // 较上一日增量(亿)
  shTurnover: number;
  szTurnover: number;
  bjTurnover: number;
  upCount: number;
  downCount: number;
  flatCount: number;
  upPercent: number; // 上涨占比 %
  stockTotal: number;
  limitUpCount: number;
  limitDownCount: number;
  // v2.0.7aw:炸板家数(5 cron 跑,盘中 em 实时算"当前封板" + 炸板 = 涨停过总数 实时)
  brokenLimitCount?: number;
  indices: IndexQuote[];
  // v2.0.7z:情绪温度(5 维度直接相加 0-100,user 最新算法)
  marketTemperature?: {
    temperature: number;
    status: string;
    statusDesc: string;
    details: {
      limit_up: number;
      limit_down: number;
      max_boards: number;
      broken_rate: string;
      broken_count: number;
      yest_perf: string;        // "+1.5%" / "无数据"
      yest_perf_value: number;  // 数值(0 = 无数据)
      promote_rate: string;     // "27%" / "无数据"
      promote_rate_value: number;
      limit_ratio: string;      // "12.0" / "60/0"
    };
    dimension_scores: {
      '涨跌停对比': number;
      '连板高度': number;
      '炸板率': number;
      '昨日涨停今日': number;
      '晋级率': number;
    };
  };
  // 可转债 / ETF 涨跌家数(akshare 静态)
  etfUp?: number;
  etfDown?: number;
  etfFlat?: number;
  bondUp?: number;
  bondDown?: number;
  bondFlat?: number;
  // v2.0.7gg:ETF/可转债代码列表(腾讯 sh/sz 前缀),盘中实时拉取用
  etfCodes?: string[];
  bondCodes?: string[];
  // v2.0.7aa:主力资金流(20 日) + 融资融券历史(60 日)
  mainCapitalFlow20d?: MainCapitalFlowItem[] | null;
  marginHistory?: MarginHistoryItem[] | null;
  // v2.0.7aa:涨跌分布分桶(11 档)
  changeDistribution?: {
    down_ge_10: number;
    down_10_to_7: number;
    down_7_to_5: number;
    down_5_to_3: number;
    down_3_to_0: number;
    flat: number;
    up_0_to_3: number;
    up_3_to_5: number;
    up_5_to_7: number;
    up_7_to_10: number;
    up_ge_10: number;
  };
}

export interface MainCapitalFlowItem {
  date: string;
  main_net_inflow: number;  // 主力净流入(亿元)
  huge_net_inflow?: number;
  big_net_inflow?: number;
}

export interface MarginHistoryItem {
  date: string;
  margin_balance: number;        // 融资余额(亿)
  margin_balance_diff: number;   // 当日净流入(亿)
  sh_close: number | null;       // 沪市收盘指数
}

export interface IndexQuote {
  name: string;
  point: number;
  changeAmount: number; // 涨跌额
  changePercent: number;
  turnover: number; // 成交额(亿)
}

/** 历史日线数据(用于折线图) */
export interface HistoryPoint {
  date: string;
  volume: number; // 当日成交额(亿)
  limitUp: number;
  limitDown: number;
  up: number;
  down: number;
}

/** 涨跌停梯队 */
export interface LadderGroup {
  level: string; // "6板" / "2个跌停"
  count: number;
}

export interface LimitUpStock extends QuoteData {
  consecutiveDays: number;
  limitUpStats: string; // "6/6"
}

export interface LimitDownStock extends QuoteData {
  consecutiveDownDays: number;
}

/** 板块 */
export interface SectorItem {
  name: string;
  changePercent: number;
  stockCount: number;
  totalTurnover: number; // 亿
  leaderName: string;
  leaderChangePercent: number;
  limitUpCount?: number; // 今日板块内涨停股数
  upCount?: number;       // 板块内上涨家数(同花顺 summary 自带)
  downCount?: number;     // 板块内下跌家数
  netInflow?: number;     // 主力净流入(亿)— 现在已用全市场实时数据替换
  topStocks?: string[];   // 领涨个股前 2 名
}

/** 异动选股 */
export interface BreakoutStock extends QuoteData {
  volumeMultiple?: number; // 量比倍数
  breakoutPercent?: number; // 突破幅度 %
  rangePosition?: number; // 250日区间位置 %
  isNewHigh?: boolean; // 是否创 60 日新高(v1.9.1)
  isLimitUp?: boolean; // 是否涨停(v1.9.1)
}

/** 龙虎榜 */
export interface InterpretedStock {
  stock_info: { code: string; name: string; reason: string };
  tags: string[];
  summary_text: string;
  structured_buy_list: Array<{
    seat: string; name: string; type: string; style: string; icon: string; net_amount: number;
  }>;
  structured_sell_list: Array<{
    seat: string; name: string; type: string; style: string; icon: string; net_amount: number;
  }>;
  force_distribution: { [type: string]: number };
}

export interface DragonTigerStock extends QuoteData {
  netBuy: number; // 净买额(亿)
  buyAmount: number;
  sellAmount: number;
  reason: string;
  details: {
    buys: SeatRow[];
    sells: SeatRow[];
  };
  interpreted?: InterpretedStock;  // v2.0.7q:Python interpreter 输出
}

export interface SeatRow {
  direction: 'buy' | 'sell';
  seat: string;
  buyAmount: number; // 亿
  sellAmount: number; // 亿
  netAmount: number; // 亿
}
