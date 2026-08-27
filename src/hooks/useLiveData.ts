// React hook:盘中每 10s 拉全市场 + ETF + 可转债 + 涨跌停;60s 拉指数 + 49 行业
// v2.0.7ea:删 4 个 CF Function(/api/market-stats/etf-stats/bond-stats/emotion-temp)
// — CF Workers 出口 IP 实际也被 em 限流严(实测 5 域名全 FAIL 9.6s),Function 没解决问题
// — useLiveData 改直连腾讯 qt.gtimg.cn(海外 IP 实测 5,363 只 28s 稳定)+ em 申万 60s 拉
// — Function 删掉省 CF 配额 + 减少 5-10s 浪费
import { useEffect, useState, useRef } from 'react';
import {
  fetchLiveIndices,
  fetchSinaIndustries,
  fetchTodaySnapshot,
  fetchMarketSummary,  // v2.0.7ea:加回 fetchMarketSummary(腾讯 qt.gtimg.cn)
  fetchEMIndustries,
  fetchEMConcepts,   // v2.0.7gg:概念板块实时
  fetchEMRegions,    // v2.0.7gg:地域板块实时
  fetchETFAndBondStats,  // v2.0.7gg:ETF/可转债盘中实时
  SINA_INDUSTRY_LABELS,
} from '../data/live';
import type { ReportData } from '../data/loader';
import { calcLiveEmotionTemperature } from '../utils/marketTemperature';

// 判断是否在 A 股交易时段(供组件 UI 用)
// v2.0.7dh:用东八区时间(跟 isPreMarket 一致)— 之前用 new Date() 本地时间
//  → 海外 user 浏览器(UTC)11:30 北京 = 03:30 UTC,isLiveMarket 返 false
//  → useLiveData 不跑 fastTick,卡片走 baseData 8/17 收盘
//  → 跟"盘中应该看实时"矛盾
// 修法:用 Date.now() + 8h 算东八区时间,getUTCDay/getUTCHours 取东八区时间
export function isLiveMarket(): boolean {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  // v2.0.7ew:边界 9:30-15:30(原 15:00)— 15:00 收盘后 30 分钟继续拉数据,
  // 让 fastTick 拉到 14:59 收盘定格值(腾讯全市场 sum ~1.93 万亿稳定),useState prev 不会回到 11:46 早盘
  // 修前 bug:15:00 后 fetchMarketSummary 限流拉空,prev 保留 11:46 早盘 11948 → user 看到早盘数据
  return mins >= 9 * 60 + 30 && mins < 15 * 60 + 30;
}

// v2.0.7dj:早盘限流期 9:30-10:00(北京)— 跟 isLiveMarket 区别:
//  isLiveMarket 9:30-10:00 返 true(用 useLiveData 拉实时)
//  isEarlyTradingHours 9:30-10:00 返 true(显示限流提示)
// 用途:PageHeader 红色标签文案切换
//  - 9:30-10:00 + useLiveData 没拉到数据(限流)→ "盘中实时数据将在10:00后逐步更新"
//  - 10:00 后(限流大概率恢复)+ useLiveData 拉到数据 → "盘中实时数据"
export function isEarlyTradingHours(): boolean {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return mins >= 9 * 60 + 30 && mins < 10 * 60;
}

// v2.0.7p:9:30 集合竞价前(交易日)— 9:15 集合竞价开始,但 sina 在 9:05 也能拉到少量"集合竞价预报价"
// 看着像"半数据"(如 1 涨 / 5499 平盘)。这段时间清零 A 股统计(避免显示半数据),
// v2.0.7bc:用东八区时间判断(海外 user 浏览器本地时间 < 9:30 会被误判为 preMarket)
// 之前用 new Date() 本地时间 — 海外 user 看到 0(强制清 0 触发)
export function isPreMarket(): boolean {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return mins < 9 * 60 + 30;  // 东八区 9:30 之前
}

export interface LiveSnapshot {
  /** 6 个指数实时数据(顺序对应 data.indices) */
  indices: { name?: string; point: number; changeAmount: number; changePercent: number; turnover: number }[];
  /** 全市场汇总(EM push2:含涨跌停) */
  market: {
    upCount: number;
    downCount: number;
    flatCount: number;
    totalTurnover: number;
    limitUpCount: number;
    limitDownCount: number;
    // v2.0.7ab:涨跌分布分桶(11 档)
    changeDistribution?: {
      down_ge_10: number; down_10_to_7: number; down_7_to_5: number;
      down_5_to_3: number; down_3_to_0: number; flat: number;
      up_0_to_3: number; up_3_to_5: number; up_5_to_7: number;
      up_7_to_10: number; up_ge_10: number;
    };
  } | null;
  /** ETF 涨跌分布(EM push2) */
  etfStats: { up: number; down: number; flat: number } | null;
  /** 可转债 涨跌分布(EM push2) */
  bondStats: { up: number; down: number; flat: number } | null;
  /** 49 个 sina 行业实时数据(60s 拉) */
  sinaIndustries: Map<string, { changePercent: number; totalTurnover: number; leaderName: string; leaderChangePercent: number; stockCount: number } | null>;
  // v2.0.7ax:em 申万 90 行业(跟 ths 90 细分类 一一对应,60s 实时)
  emIndustries?: Map<string, { name: string; changePercent: number; leaderName: string; totalTurnover: number; leaderChangePercent: number; stockCount: number }>;
  // v2.0.7gg:em 申万概念 + 地域(概念/地域板块盘中实时覆盖)
  emConcepts?: Map<string, { name: string; changePercent: number; leaderName: string; totalTurnover: number; leaderChangePercent: number; stockCount: number }>;
  emRegions?: Map<string, { name: string; changePercent: number; leaderName: string; totalTurnover: number; leaderChangePercent: number; stockCount: number }>;
  /** 今日实时快照(用于把今天数据 push 到 history 末尾) — v2.0.7cu:加 limitUp/limitDown 字段(同源 sina 9.97% 阈值) */
  today: { date: string; volume: number; up: number; down: number; flat?: number; limitUp: number; limitDown: number } | null;
  /** 数据源时间戳 */
  fetchedAt: number;
  /** 是否还在首次拉取(初始 false) */
  isFirstLoad: boolean;
  /** 上次"快速拉"(10s)时间戳 */
  fastFetchedAt: number;
}

/** 实时数据 hook — 盘中(9:30-15:00)10s 拉全市场/ETF/可转债,60s 拉指数+行业;非盘中 5min
 * 默认 enabled=true */
export function useLiveData(enabled = true, stockCodes?: string[], etfCodes?: string[], bondCodes?: string[]): LiveSnapshot {
  // v2.0.7ee:接 stockCodes 参数(从 baseData.meta.stockCodes 传) — React 端用真实 5,547 只拉腾讯

  const [snap, setSnap] = useState<LiveSnapshot>({
    indices: [],
    market: null,
    etfStats: null,
    bondStats: null,
    sinaIndustries: new Map(),
    today: null,
    fetchedAt: 0,
    isFirstLoad: true,
    fastFetchedAt: 0,
  });
  // v2.0.7ee:useRef 缓存最新 codes(让 marketTick setInterval 闭包能读到)
  const codesRef = useRef<string[] | undefined>(stockCodes);
  // v2.0.8:marketTick 引用(stockCodes 首次就绪时立即拉,缩短首次实时到位时间)
  const marketTickRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    codesRef.current = stockCodes;
    // stockCodes 首次就绪 → 立即拉市场(不等 60s interval,也不走 fallback 13999 慢拉)
    if (stockCodes && stockCodes.length > 0) {
      marketTickRef.current?.();
    }
  }, [stockCodes]);
  // v2.0.7gg:缓存 ETF/可转债代码列表(盘中实时拉取用)
  const etfCodesRef = useRef<string[] | undefined>(etfCodes);
  const bondCodesRef = useRef<string[] | undefined>(bondCodes);
  useEffect(() => { etfCodesRef.current = etfCodes; bondCodesRef.current = bondCodes; }, [etfCodes, bondCodes]);

  useEffect(() => {
    if (!enabled) return;
    // v2.0.7dc:非盘中(15:00-次日 9:30 + 周末/节假日)直接 return — 不拉 em/sina
    // 根因:之前 line 170-171 在非盘中仍然 setInterval(fastTick, 60_000) + (slowTick, 300_000)
    //      → sina/em 拉到部分数据(stale 或 0)→ setSnap → 覆盖 baseData 8/17 收盘真值(2.4 万亿)
    //      → user 23:53 盘后看到 2.2 万亿 / 4060 涨(在 2.4 万亿 / 4335 涨 之间变化)
    // 修法:非 isLiveMarket 时 return,React state 保持空 → 卡片走 baseData 8/17 收盘
    // v2.0.7fp:回滚 v2.0.7fo-fix 0:00-9:30 慢跑逻辑 — 8/22 9:45 user 报告网站白屏
    // 根因:fastTick 拉 5500+ 只腾讯 30s+ + slowTick 拉 em 申万 30s+ 同步等待,JS 占用 100% CPU
    //       → React UI 不响应,连启动页都没出现
    // — 0:00-9:30 仍然 return 不跑,卡片走 baseData 8/21(已手动改 2505/2862/46 同花顺口径)
    // — 8/22 18:30 cron 会用新算法(指数成交额)重写 8/21 末点 → 8/22 9:30 开盘后 useLiveData 正常拉盘中
    const isLive = isLiveMarket();
    if (!isLive) return;
    // 10s 拉快:全市场 + ETF + 可转债 + 指数 + today(v2.0.7g:加 today 同步,避免曲线图落后)
    // v2.0.7cs:safe 加重试 — em/sina 拉失败时 800ms 后重试 1 次
    // — 之前拉失败直接 fallback,看起来"上周五收盘"(user 反馈)
    // — 加重试后:网络抖动/限流 都能 recover,user 看到 8/17 实时
    // v2.0.7fv:safe retry 死代码修 — 之前 `await p` 拿 reject 后再 `await p` 拿的是同一个 rejected Promise
    //   修法:把 p 改成 thunk,每次调用发起新请求
    const safe = async <T,>(thunk: () => Promise<T>, fallback: T, retryMs = 800): Promise<T> => {
      const p1 = thunk();
      try { return await p1; }
      catch (e) {
        console.warn('[useLiveData] sub-fetch fail, retrying in', retryMs, 'ms:', e);
        await new Promise((r) => setTimeout(r, retryMs));
        try { return await thunk(); }
        catch (e2) {
          console.warn('[useLiveData] sub-fetch retry fail:', e2);
          return fallback;
        }
      }
    };
    // v2.0.7gf:指数 tick(20s 高频)— 只拉 6 个指数(秒回),不再跟全市场 5500 只混在一起等 30s+
    const indexInflightRef = { current: false };
    const indexTick = async () => {
      if (indexInflightRef.current) return;
      indexInflightRef.current = true;
      try {
        const idxResult = await safe(() => fetchLiveIndices(), []);
        setSnap((prev) => {
          const hasIdx = idxResult && idxResult.length > 0;
          return {
            ...prev,
            indices: hasIdx ? idxResult : prev.indices,
            fastFetchedAt: hasIdx ? Date.now() : prev.fastFetchedAt,
            fetchedAt: hasIdx ? Date.now() : prev.fetchedAt,
            isFirstLoad: hasIdx ? false : prev.isFirstLoad,
          };
        });
      } catch (e) {
        console.warn('[useLiveData] index tick error:', e);
      } finally {
        indexInflightRef.current = false;
      }
    };
    // v2.0.7gf:全市场 tick(60s 低频)— 拉 5500 只(约 28s)+ 派生 today
    const marketInflightRef = { current: false };
    const marketTick = async () => {
      if (marketInflightRef.current) return;
      // v2.0.8:codes 未就绪不拉 — 避免走 fallback 13999 慢拉(140 批限流,首次等 1-2 分钟)
      if (!codesRef.current || codesRef.current.length === 0) return;
      marketInflightRef.current = true;
      try {
        const mkt = await safe(() => fetchMarketSummary(codesRef.current), null);
        // todayResult 从 mkt 派生(避免 fetchTodaySnapshot 内部再调 fetchMarketSummary 双重请求)
        let todayResult: any = null;
        if (mkt && !(mkt.totalTurnover === 0 && mkt.upCount === 0 && mkt.downCount === 0)) {
          const now8 = new Date(Date.now() + 8 * 3600 * 1000);
          const y = now8.getUTCFullYear();
          const mm = String(now8.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(now8.getUTCDate()).padStart(2, '0');
          todayResult = {
            date: `${y}-${mm}-${dd}`,
            volume: mkt.totalTurnover,
            up: mkt.upCount,
            down: mkt.downCount,
            flat: mkt.flatCount,
            limitUp: mkt.limitUpCount,
            limitDown: mkt.limitDownCount,
          };
        }
        setSnap((prev) => {
          const hasAny = !!mkt;
          return {
            ...prev,
            // 拉到 null(失败)→ 保留 prev,不写死 null — sticky
            market: mkt ?? prev.market,
            today: todayResult ?? prev.today,
            fastFetchedAt: hasAny ? Date.now() : prev.fastFetchedAt,
            fetchedAt: hasAny ? Date.now() : prev.fetchedAt,
            isFirstLoad: hasAny ? false : prev.isFirstLoad,
          };
        });
      } catch (e) {
        console.warn('[useLiveData] market tick error:', e);
      } finally {
        marketInflightRef.current = false;
      }
    };
    // 60s 拉慢:行业(v2.0.7ax:em 申万 90 行业,跟 ths 90 细分类 一一对应,不是 sina 49 行业聚合)
    // v2.0.7fv:slowTick 加 inflight 保护 + sticky — 失败返空 Map 时保留 prev
    // v2.0.7fv:M3 修 — 主 hook 也拉 sinaIndustries (之前只有 useLiveDataOnce 拉,主 hook 永不变)
    const slowInflightRef = { current: false };
    const slowTick = async () => {
      if (slowInflightRef.current) return;
      slowInflightRef.current = true;
      try {
        const [emIndResult, emConResult, emRegResult, sinaIndResult, etfBondResult] = await Promise.all([
          safe(() => fetchEMIndustries(), new Map()),
          safe(() => fetchEMConcepts(), new Map()),
          safe(() => fetchEMRegions(), new Map()),
          safe(() => fetchSinaIndustries(SINA_INDUSTRY_LABELS), new Map()),
          safe(() => fetchETFAndBondStats(etfCodesRef.current || [], bondCodesRef.current || []), null),
        ]);
        setSnap((prev) => ({
          ...prev,
          emIndustries: (emIndResult && emIndResult.size > 0) ? emIndResult : prev.emIndustries,
          emConcepts: (emConResult && emConResult.size > 0) ? emConResult : prev.emConcepts,
          emRegions: (emRegResult && emRegResult.size > 0) ? emRegResult : prev.emRegions,
          sinaIndustries: (sinaIndResult && sinaIndResult.size > 0) ? sinaIndResult : prev.sinaIndustries,
          etfStats: etfBondResult ? etfBondResult.etf : prev.etfStats,
          bondStats: etfBondResult ? etfBondResult.bond : prev.bondStats,
        }));
      } catch (e) {
        console.warn('[useLiveData] slow tick error:', e);
      } finally {
        slowInflightRef.current = false;
      }
    };

    marketTickRef.current = marketTick;

    indexTick();
    marketTick();
    slowTick();

    // v2.0.7gf:指数 20s 高频 + 全市场/行业 60s 低频
    const indexIntv = setInterval(indexTick, 20_000);
    const marketIntv = setInterval(marketTick, 60_000);
    const slowIntv = setInterval(slowTick, 60_000);
    return () => {
      clearInterval(indexIntv);
      clearInterval(marketIntv);
      clearInterval(slowIntv);
    };
  }, [enabled]);

  return snap;
}

/** 仅拉 1 次的 live hook */
export function useLiveDataOnce(enabled = true): LiveSnapshot {
  const [snap, setSnap] = useState<LiveSnapshot>({
    indices: [],
    market: null,
    etfStats: null,
    bondStats: null,
    sinaIndustries: new Map(),
    emIndustries: new Map(),
    today: null,
    fetchedAt: 0,
    isFirstLoad: true,
    fastFetchedAt: 0,
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
      try { return await p; } catch { return fallback; }
    };
    (async () => {
      try {
        // v2.0.7ea:删 fetchEMMarketStats/Etf/Bond(改用 fetchMarketSummary 腾讯)
        // — fetchEMEtfStats/fetchEMBondStats 仍然保留(在 live.ts)— 慢调用只在 em 不限流时用
        // v2.0.7ee:传 codes(从 baseData.meta.stockCodes 读) — 拉真实 5,547 只
        const [idxResult, mkt, sinaResult, emIndResult, todayResult] = await Promise.all([
          fetchLiveIndices(),
          safe(fetchMarketSummary(), null),  // 改:fetchEMMarketStats → fetchMarketSummary(腾讯)
          fetchSinaIndustries(SINA_INDUSTRY_LABELS),
          safe(fetchEMIndustries(), new Map()),
          safe(fetchTodaySnapshot(), null),
        ]);
        if (cancelled) return;
        setSnap({
          indices: idxResult,
          market: mkt,
          // v2.0.7ea:ETF/可转债 盘中不拉(em 限流严)— 走 baseData(etfStats/bondStats 不更新)
          etfStats: null,
          bondStats: null,
          sinaIndustries: sinaResult,
          emIndustries: emIndResult,
          today: todayResult,
          fetchedAt: Date.now(),
          isFirstLoad: false,
          fastFetchedAt: Date.now(),
        });
      } catch (e) {
        console.warn('[useLiveDataOnce] error:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  return snap;
}

/** 把 live snapshot 合并到 ReportData(覆盖涨跌幅/家数等实时字段)
 * v2.0.7:全市场/ETF/可转债 涨跌停数也用 live 覆盖(10s 实时) */
export function mergeLiveData(data: ReportData, live: LiveSnapshot): ReportData {
  if (live.fetchedAt === 0) return data;
  const next: ReportData = JSON.parse(JSON.stringify(data));
  // 1. 指数 — v2.0.8gj:改按 name 匹配覆盖(前端 7 指数含北证50,data.json 可能仍 6 个,避免按索引错位)
  if (live.indices.length > 0 && live.indices.some((li) => li.point > 0)) {
    for (const li of live.indices) {
      if (!li.name || li.point <= 0) continue;
      const target = next.marketOverview.indices.find((it) => it.name === li.name);
      if (target) {
        target.point = li.point;
        target.changeAmount = li.changeAmount;
        target.changePercent = li.changePercent;
        target.turnover = li.turnover;
      }
    }
  }
  // 2. 全市场汇总 — v2.0.7p:9:30 集合竞价前清零(避免显示 sina "半数据" 如 1 涨 5499 平)
  // 9:30 之后用 live 实时
  // v2.0.7av:跨日时(8:00 hook 切日期后但 baseData 还没 cron 更新)也清 0 涨跌停
  // — 否则 8/14 9:30-9:35 会显示 8/13 收盘涨停池 56(错,应 0)
  // v2.0.8gj:删除 crossDay 空分支 — 该分支导致新交易日早盘(9:30 后、盘后 cron 更新前,baseData 还是昨日)
  // 全市场(成交量/涨跌家数/涨跌停/涨跌分布/曲线图末点)不应用 live 实时数据,只有指数(在判断之前)实时。
  // 修法:盘中(非 preMarket)一律用 live 实时覆盖,跨日不再单独拦截。
  if (isPreMarket()) {
    // v2.0.7cy:取消 preMarket 清 0 — 0:00-9:30 保留 baseData 上一交易日收盘值
    // — 之前 v2.0.7p/v2.0.7bd 清 0 → user 看到 30-60 分钟空白
    // — 现在保留 baseData 8/17 收盘 + Layout 8:00 hook 切日期到 8/18
    // — 数字跟 tradeDate 一致(user 不困惑"为什么今天跟昨天一样")
    // — 9:30 之后 em/sina 拉到 8/18 盘中 → 覆盖 baseData
    // 注:不再清 0,所有字段保留 baseData 值
  } else {
    // v2.0.7cu:live.today 优先覆盖(跟曲线图末点同源)
    // — 根因:fetchEMMarketStats 限流时 catch 返 {0,0,0,0},fetchTodaySnapshot 限流时返 null
    // — useState prev 保留机制:live.today 拉成功的值被 sticky 保留,live.market 被 0 覆盖
    // — 结果:曲线图末点 = live.today.volume(2.4 万亿 ✓ 8/17 实时),卡片 = next.marketOverview.marketTurnover(21561 ✗ 8/14 baseData)
    // — 修法:卡片也用 live.today 覆盖,跟曲线图末点同源
    // — 跟 v2.0.7bi 一样处理 limitUp/limitDown(同花顺"当前封板"近似)
    if (live.today && (live.today.up > 0 || live.today.down > 0) && live.today.volume > 0) {
      // v2.0.8gj:盘中动态算 turnoverDiff = 今日实时成交额 - 昨日收盘成交额(baseData 覆盖前的值)
      const _prevTurnover = next.marketOverview.marketTurnover;
      next.marketOverview.marketTurnover = live.today.volume;
      next.marketOverview.turnoverDiff = Math.round((live.today.volume - _prevTurnover) * 100) / 100;
      next.marketOverview.upCount = live.today.up;
      next.marketOverview.downCount = live.today.down;
      // v2.0.7ex:fetchTodaySnapshot 也加 flatCount 字段(用现价/昨收算涨跌幅,精度 0.001%)
      // — 之前 baseData flatCount=277(14:00 cron 用 fields[32]===0 算的,错算 179 只涨/跌为"平")
      // — 8/20 实际:涨 4096 跌 1347 平 98 总 5541,baseData 算成 3983+1153+277=5413
      // — 修法:fetchTodaySnapshot 返 flatCount,mergeLiveData 覆盖 baseData
      if (live.today.flat !== undefined && live.today.flat >= 0) {
        next.marketOverview.flatCount = live.today.flat;
      }
      // 涨跌停 — fetchTodaySnapshot 也带 limitUp/limitDown(同源 sina 9.97% 阈值)
      if (live.today.limitUp !== undefined && live.today.limitUp > 0) {
        next.marketOverview.limitUpCount = live.today.limitUp;
      }
      if (live.today.limitDown !== undefined && live.today.limitDown > 0) {
        next.marketOverview.limitDownCount = live.today.limitDown;
      }
      const mktTotalToday = live.today.up + live.today.down;
      if (mktTotalToday > 0) {
        next.marketOverview.upPercent = Math.round(live.today.up * 10000 / mktTotalToday) / 100;
      }
    } else {
      // v2.0.7ct 兜底:live.today 没值时(live.today 为 null 一直没成功过),用 live.market
      // mktValid 阈值 600 → 100 — em 8/17 11:00 限流严,部分数据(100+ 只)也用
      const mktTotal = live.market ? (live.market.upCount + live.market.downCount + live.market.flatCount) : 0;
      const mktValid = live.market && mktTotal >= 100;
      if (mktValid) {
        // v2.0.7d:成交量也实时刷新 + turnoverDiff 由 fetch_real_data 5 cron 算(末 1 vs 末 2 收盘对比)
        // v2.0.7bb:em 不覆盖 turnoverDiff(避免 8/13 跑出 25659 - 25673 = -14.46 自减)
        // v2.0.8gj:盘中动态算 turnoverDiff(与 live.today 分支同口径)
        const _prevTurnover2 = next.marketOverview.marketTurnover;
        next.marketOverview.marketTurnover = live.market!.totalTurnover;
        next.marketOverview.turnoverDiff = Math.round((live.market!.totalTurnover - _prevTurnover2) * 100) / 100;
        next.marketOverview.upCount = live.market!.upCount;
        next.marketOverview.downCount = live.market!.downCount;
        next.marketOverview.flatCount = live.market!.flatCount;
        // v2.0.7bi:涨跌停 = em 实时 9.99% 阈值 算(盘中 9:30-15:00)
        if (live.market!.limitUpCount > 0) {
          next.marketOverview.limitUpCount = live.market!.limitUpCount;
        }
        if (live.market!.limitDownCount > 0) {
          next.marketOverview.limitDownCount = live.market!.limitDownCount;
        }
        next.marketOverview.upPercent = mktTotal > 0
          ? Math.round(live.market!.upCount * 10000 / mktTotal) / 100
          : 0;
        // v2.0.7ab:涨跌分布分桶也实时刷新
        if (live.market!.changeDistribution) {
          next.marketOverview.changeDistribution = live.market!.changeDistribution;
        }
      }
    }
  }
  // v2.0.7at:limitUpCount/limitDownCount 不被 fast tick(em 实时算)覆盖
  // — fetch_real_data 用 akshare 涨停池算(同花顺一致),em 实时算 9.9% 阈值会偏(70 vs 56)
  // — 让涨停池真值生效(15:35 cron 跑出来,盘后定格)
  // 3. ETF 涨跌分布(EM push2 — 10s 实时,fs 错时 fallback)
  // v2.0.7ct:阈值 200 → 30 — em 8/17 11:00 限流严,部分数据(30+ 只)也用
  const etfTotal = live.etfStats ? (live.etfStats.up + live.etfStats.down + live.etfStats.flat) : 0;
  if (live.etfStats && etfTotal >= 30) {
    next.marketOverview.etfUp = live.etfStats.up;
    next.marketOverview.etfDown = live.etfStats.down;
    next.marketOverview.etfFlat = live.etfStats.flat;
  }
  // 4. 可转债 涨跌分布(EM push2 — 10s 实时,fs 错时 fallback)
  // v2.0.7ct:阈值 100 → 20
  const bondTotal = live.bondStats ? (live.bondStats.up + live.bondStats.down + live.bondStats.flat) : 0;
  if (live.bondStats && bondTotal >= 20) {
    next.marketOverview.bondUp = live.bondStats.up;
    next.marketOverview.bondDown = live.bondStats.down;
    next.marketOverview.bondFlat = live.bondStats.flat;
  }
  // 5. v2.0.7ax:行业板块用 em 申万 90 行业实时覆盖 ths 90 细分类
  // — em "m:90+t:2" 申万二级行业(约 90 个),跟 ths 90 细分类 一一对应(医疗服务/医疗器械/化学制药 等都分开)
  // — 不再用 sina 49 行业(那是聚合,自动化设备/通用设备/.../电机 都归到 new_jxhy,会导致多个 ths 细分类被覆盖成同一值)
  // — em 申万按 name 模糊匹配覆盖 ths 90 细分类(60s 实时,无重复)
  if (live.emIndustries && live.emIndustries.size > 0) {
    for (const s of next.sectors) {
      const thsName = s.name || '';
      if (!thsName) continue;
      let bestMatch: { name: string; changePercent: number; leaderName: string } | null = null;
      let bestLen = 0;
      for (const [emName, emItem] of live.emIndustries) {
        if (!emName) continue;
        // 完全相等或包含
        if (thsName === emName || thsName.includes(emName) || emName.includes(thsName)) {
          // 取最长的匹配(避免"医疗服务"误匹配到"医疗器械"等)
          if (emName.length > bestLen) {
            bestLen = emName.length;
            bestMatch = emItem;
          }
        }
      }
      if (bestMatch) {
        // v2.0.7du:em 申万 跟 ths 14:00 数字差 > 3% 时跳过覆盖(走 ths 14:00)
        // — em 申万是 em 实时,ths 14:00 是 fetch-data 14:00 cron 写
        // — em 申万 +0.17% vs ths +9.38% 差异大 → em 申万 stale(限流返 8/17)— 跳过
        // — 数字差 ≤ 3% 时正常覆盖(em 实时比 ths 14:00 更近)
        if (Math.abs(bestMatch.changePercent - s.changePercent) <= 3) {
          s.changePercent = bestMatch.changePercent;
          if (bestMatch.leaderName && bestMatch.leaderName !== '-') s.leaderName = bestMatch.leaderName;
        }
      }
    }
  }
  // v2.0.7gg:概念/地域板块 em 申万实时覆盖(跟行业一样按 name 模糊匹配)
  // 若 baseData 该板块为空(盘后同花顺 ths 超时),直接用 em 实时数据生成列表
  const toSectorItem = (name: string, item: any) => ({
    name,
    changePercent: item.changePercent,
    stockCount: 0,
    totalTurnover: 0,
    leaderName: item.leaderName && item.leaderName !== '-' ? item.leaderName : '-',
    leaderChangePercent: 0,
    netInflow: 0,
    topStocks: [item.leaderName && item.leaderName !== '-' ? item.leaderName : '-', '-'],
    limitUpCount: 0,
    upCount: 0,
    downCount: 0,
  });
  const applyOrBuildEmSector = (list: any[] | undefined, emMap: Map<string, any> | undefined, limit: number, setter: (arr: any[]) => void) => {
    if (!emMap || emMap.size === 0) return;
    if (list && list.length > 0) {
      for (const s of list) {
        const thsName = s.name || '';
        if (!thsName) continue;
        let bestMatch: any = null;
        let bestLen = 0;
        for (const [emName, emItem] of emMap) {
          if (!emName) continue;
          if (thsName === emName || thsName.includes(emName) || emName.includes(thsName)) {
            if (emName.length > bestLen) { bestLen = emName.length; bestMatch = emItem; }
          }
        }
        if (bestMatch && Math.abs(bestMatch.changePercent - s.changePercent) <= 3) {
          s.changePercent = bestMatch.changePercent;
          if (bestMatch.leaderName && bestMatch.leaderName !== '-') s.leaderName = bestMatch.leaderName;
        }
      }
    } else {
      // baseData 为空：用 em 实时数据生成(按涨跌幅降序取前 limit 个)
      const built = Array.from(emMap.entries())
        .filter(([name]) => !!name)
        .map(([name, item]) => toSectorItem(name, item))
        .sort((a, b) => b.changePercent - a.changePercent)
        .slice(0, limit);
      if (built.length > 0) setter(built);
    }
  };
  applyOrBuildEmSector(next.conceptSectors as any, live.emConcepts as any, 30, (arr) => { next.conceptSectors = arr; });
  applyOrBuildEmSector(next.regionSectors as any, live.emRegions as any, 20, (arr) => { next.regionSectors = arr; });
  // 6. 把今日实时数据 push 到 history 末尾(让曲线图含当日点)
  // v2.0.7dr:曲线图末点直接映射卡片数据(next.marketOverview.*)— 不再单独算 todayData
  // — 之前:曲线图末点用 todayData(快 fastTick 拉 + liveLimits 阈值 600/100)— em 限流时 0:0
  // — 现在:曲线图末点 = 卡片数字(完全一致)— 永远有值(走 baseData fallback)— 不再 0:0
  // — 跟卡片同源,实时性靠 fastTick 推 next.marketOverview → history 末点同步
  if (next.history && next.history.length > 0) {
    const lastDate = next.history[next.history.length - 1].date;
    // 东八区"今天"日期(海外 user 浏览器本地时区不对时统一用 UTC+8)
    const now8 = new Date(Date.now() + 8 * 3600 * 1000);
    const todayDate = `${now8.getUTCFullYear()}-${String(now8.getUTCMonth() + 1).padStart(2, '0')}-${String(now8.getUTCDate()).padStart(2, '0')}`;
    // 末点数据 = 卡片数据(mergeLiveData 已处理优先 live,fallback baseData)
    const todayPoint = {
      date: todayDate,
      volume: next.marketOverview.marketTurnover,
      up: next.marketOverview.upCount,
      down: next.marketOverview.downCount,
      limitUp: next.marketOverview.limitUpCount,
      limitDown: next.marketOverview.limitDownCount,
    };
    if (todayDate !== lastDate) {
      // 新一天 — push 新点
      next.history.push(todayPoint);
    } else {
      // 同一天 — 更新末点(volume/up/down/limitUp/limitDown 都用卡片)
      next.history[next.history.length - 1] = {
        ...next.history[next.history.length - 1],
        ...todayPoint,
      };
    }
  }
  // 7. v2.0.8:市场情绪温度盘中实时重算 — 用实时 3 维度(涨跌停对比/上涨占比/大涨大跌)
  // 盘后温度仍由脚本用原 5 维度超短框架算,盘中用本函数覆盖 temperature/status。
  if (next.marketOverview.marketTemperature) {
    const bt = next.marketOverview.marketTemperature;
    next.marketOverview.marketTemperature = calcLiveEmotionTemperature({
      upCount: next.marketOverview.upCount,
      downCount: next.marketOverview.downCount,
      limitUp: next.marketOverview.limitUpCount,
      limitDown: next.marketOverview.limitDownCount,
      distribution: next.marketOverview.changeDistribution,
      baseMaxBoards: bt.details.max_boards,
      baseBrokenCount: bt.details.broken_count,
    });
  }
  return next;
}
