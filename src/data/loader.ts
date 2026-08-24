// 运行时数据加载:启动时从 /data.json 拉取,作为全局只读快照
// 盘中时间(9:30-15:00)支持 60s 自动刷新
import type {
  MarketOverview,
  LadderGroup,
  LimitUpStock,
  LimitDownStock,
  SectorItem,
  BreakoutStock,
  DragonTigerStock,
  QuoteData,
  HistoryPoint,
  KLinePoint,
} from '../types';

export interface ReportData {
  meta: {
    generatedAt: string;
    tradeDate: string;
    tradeDateSlash: string;
    dataSource: string;
    // v2.0.7ee:股票代码列表(akshare 真实 5,547 只)— React useLiveData 拿这个拉腾讯
    stockCodes?: string[];
  };
  marketOverview: MarketOverview;
  history: HistoryPoint[];
  limitUpLadders: LadderGroup[];
  limitUpStocks: LimitUpStock[];
  firstBoardStocks: QuoteData[];
  limitDownLadders: LadderGroup[];
  limitDownStocks: LimitDownStock[];
  sectors: SectorItem[];
  conceptSectors: SectorItem[];   // 概念板块(同花顺)
  regionSectors: SectorItem[];   // 地域板块(按市场)
  breakoutStocks: BreakoutStock[];
  highBreakStocks: BreakoutStock[];
  lowPositionStocks: BreakoutStock[];
  allStrongStocks?: BreakoutStock[]; // v1.9.1:全量候选股(给客户端自定义筛选)
  sectorKlines?: Record<string, { leaderName: string; code?: string; kline: KLinePoint[] }>; // v1.9.3:行业 leader K 线(用于所处位置量化判断)
  dragonTigerStocks: DragonTigerStock[];
  dragonTiger?: {                // v2.0.7bn:龙虎榜数据自身的元信息(实际是哪天披露的)
    tradeDate: string;           // YYYYMMDD,如 20260813
    tradeDateDash: string;       // YYYY-MM-DD
    tradeDateSlash: string;      // YYYY/MM/DD
    publishedAt: string;         // 披露时间 '18:00'
    count: number;
  };
  surgery?: any;                 // 全景手术台数据(从 surgery.json 合并)
}

let cached: ReportData | null = null;
let inflight: Promise<ReportData> | null = null;

function normalize(j: any): ReportData {
  return {
    ...j,
    conceptSectors: j.conceptSectors || [],
    regionSectors: j.regionSectors || [],
    surgery: j.surgery,
  } as ReportData;
}

export function loadReportData(force = false): Promise<ReportData> {
  if (cached && !force) return Promise.resolve(cached);
  if (inflight) return inflight;
  // v2.0.7as:改用 cache: 'no-store' 强制每次重新下载(避免浏览器 disk cache 拉到旧 data.json)
  // 加 ?t=timestamp 双保险
  inflight = fetch(import.meta.env.BASE_URL + 'data.json?t=' + Date.now(), { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new Error(`data.json 拉取失败: ${r.status}`);
      return r.json();
    })
    .then((j) => {
      const norm = normalize(j);
      cached = norm;
      inflight = null;
      return cached;
    })
    .catch((e) => {
      inflight = null;
      throw e;
    });
  return inflight;
}

/** 强制刷新(清除缓存,重新 fetch) */
export function refreshReportData(): Promise<ReportData> {
  cached = null;
  inflight = null;
  return loadReportData(true);
}

/** 判断是否在 A 股交易时段 — v2.0.7fv:海外 user 时区修,改用东八区
 * — 之前用浏览器本地时间,海外 user 永远看不到盘中
 * — 跟 useLiveData.ts 的 _isWeekendCN 一致,统一 UTC+8
 */
export function isLiveMarket(): boolean {
  const now8 = new Date(Date.now() + 8 * 3600 * 1000);
  const day = now8.getUTCDay();
  if (day === 0 || day === 6) return false;  // 周末
  const mins = now8.getUTCHours() * 60 + now8.getUTCMinutes();
  return mins >= 9 * 60 + 30 && mins < 15 * 60;
}
