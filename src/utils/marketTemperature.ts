// 市场情绪温度算法（前端 JS 版，用于盘中实时计算）
// 与 scripts/market_temperature.py 的 5 维度直接相加算法保持一致。
// 盘中能实时拿到的只有涨跌停数；连板高度/炸板/昨日涨停表现/晋级率这些
// 依赖盘后涨停池结构数据，盘中用 baseData 盘后值。

const STATUS_MAP: [number, string, string][] = [
  [20, '绝对冰点', '退潮末期,试错期'],
  [40, '低温分歧', '情绪修复,接力谨慎'],
  [60, '常温震荡', '无明显主线,轮动快'],
  [80, '高温一致', '主升浪,赚钱效应强'],
  [100, '极度沸点', '高潮,随时面临退潮分歧'],
];

export function calcMarketTemperature(input: {
  limitUp: number;
  limitDown: number;
  maxBoards: number;
  brokenCount: number;
  yestAvg: number;
  hasYest: boolean;
  promoteRate: number;
  hasPromote: boolean;
}) {
  let score = 50;

  const limitUp = Math.max(0, Math.round(input.limitUp));
  const limitDown = Math.max(0, Math.round(input.limitDown));

  // 1. 涨跌停对比(+15 ~ -15)
  const ratio = limitUp / Math.max(limitDown, 1);
  const s1 = ratio > 10 ? 15 : ratio > 5 ? 10 : ratio > 2 ? 5 : ratio >= 1 ? 0 : -15;
  score += s1;

  // 2. 连板高度(+10 ~ -10)
  const boards = Math.max(0, Math.round(input.maxBoards));
  const s2 = boards >= 7 ? 10 : boards >= 5 ? 8 : boards >= 4 ? 5 : boards >= 3 ? 0 : -10;
  score += s2;

  // 3. 炸板率(+10 ~ -10)
  const broken = Math.max(0, Math.round(input.brokenCount));
  let brokenRate = 0;
  let s3 = 0;
  if (limitUp + broken > 0) {
    brokenRate = broken / (limitUp + broken);
    s3 = brokenRate < 0.15 ? 10 : brokenRate < 0.3 ? 5 : brokenRate < 0.5 ? -5 : -10;
  }
  score += s3;

  // 4. 昨日涨停今日表现(+10 ~ -10)，无数据中性 0
  const avg = input.yestAvg;
  const s4 = input.hasYest ? (avg > 3 ? 10 : avg >= 0 ? 5 : avg > -2 ? -5 : -10) : 0;
  score += s4;

  // 5. 晋级率(+5 ~ -5)，无数据中性 0
  const promoteRate = input.promoteRate;
  const s5 = input.hasPromote ? (promoteRate > 0.5 ? 5 : promoteRate >= 0.3 ? 2 : -5) : 0;
  score += s5;

  const final = Math.max(0, Math.min(100, Math.round(score)));

  let status = '常温震荡';
  let statusDesc = '中性';
  for (const [th, name, desc] of STATUS_MAP) {
    if (final <= th) {
      status = name;
      statusDesc = desc;
      break;
    }
  }

  return {
    temperature: final,
    status,
    statusDesc,
    details: {
      limit_up: limitUp,
      limit_down: limitDown,
      max_boards: boards,
      broken_rate: `${Math.round(brokenRate * 100)}%`,
      broken_count: broken,
      yest_perf: input.hasYest ? `${avg >= 0 ? '+' : ''}${avg.toFixed(1)}%` : '无数据',
      yest_perf_value: input.hasYest ? avg : 0,
      promote_rate: input.hasPromote ? `${Math.round(promoteRate * 100)}%` : '无数据',
      promote_rate_value: input.hasPromote ? promoteRate : 0,
      limit_ratio: limitDown > 0 ? ratio.toFixed(1) : `${limitUp}/0`,
    },
    dimension_scores: {
      '涨跌停对比': s1,
      '连板高度': s2,
      '炸板率': s3,
      '昨日涨停今日': s4,
      '晋级率': s5,
    },
  };
}

// v2.0.8:盘中实时情绪温度算法 — 用盘中实时可得的 3 维度:
//  1) 涨跌停对比(情绪极值) 2) 上涨占比(市场宽度) 3) 大涨 vs 大跌股数(赚钱/亏钱效应)
// 替代原 5 维度超短框架(连板/炸板/昨日涨停/晋级率 依赖盘后涨停池结构,盘中无法实时)。
// v2.0.8hh:盘中实时情绪温度算法(重构) — 5 维度加权,取代旧 3 维度(涨跌停对比权重过高,
// 大盘普跌但涨停多时会误判成 90+ 亢奋;且完全没看指数方向和成交额)。
// 5 维度各自归一化到 0-100(50=中性),加权平均:
//   指数方向 25% + 市场宽度 30% + 涨跌停对比 15% + 赚钱效应 20% + 量能 10%
// 设计要点:
//   - 指数方向 + 市场宽度 合计 55%,决定"整体市场"冷暖(大盘普跌 → 显著压低温度)
//   - 涨跌停对比降权到 15%,只作短线情绪补充,不再单点推高温度
//   - 赚钱效应(大涨 vs 大跌家数)反映真实的赚钱/亏钱效应
//   - 量能(相对昨日同期的成交额变化)反映资金参与度,权重最小
export function calcLiveEmotionTemperature(input: {
  // v2.0.8hh:新增指数方向/成交额/进度输入
  indices?: { name?: string; changePercent: number }[];
  upCount: number;
  downCount: number;
  limitUp: number;
  limitDown: number;
  distribution?: {
    down_ge_10: number; down_10_to_7: number; down_7_to_5: number;
    down_5_to_3: number; down_3_to_0: number; flat: number;
    up_0_to_3: number; up_3_to_5: number; up_5_to_7: number;
    up_7_to_10: number; up_ge_10: number;
  } | null;
  marketTurnover?: number;   // 今日实时成交额(亿)
  prevTurnover?: number;     // 上一交易日收盘成交额(亿)
  progress?: number;         // 交易进度 0-1(收盘后=1)
  // 盘后超短框架字段(盘中冻结,仅用于 details 兜底展示)
  baseMaxBoards?: number;
  baseBrokenCount?: number;
}) {
  const _c = (v: number) => Math.max(0, Math.min(100, v));
  const up = Math.max(0, Math.round(input.upCount));
  const down = Math.max(0, Math.round(input.downCount));
  const lu = Math.max(0, Math.round(input.limitUp));
  const ld = Math.max(0, Math.round(input.limitDown));
  const total = up + down;

  // 1. 指数方向(0-100) — 核心指数平均涨跌幅(排除波动大的北证50/微盘,更代表大盘)
  const idxAll = (input.indices || []).filter((i) => i && typeof i.changePercent === 'number' && isFinite(i.changePercent));
  const coreIdx = idxAll.filter((i) => !(i.name || '').includes('北证') && !(i.name || '').includes('微盘'));
  const useIdx = coreIdx.length > 0 ? coreIdx : idxAll;
  const avgPct = useIdx.length > 0 ? useIdx.reduce((s, i) => s + i.changePercent, 0) / useIdx.length : 0;
  // 每 1% 涨跌 ±18 分,±2.8% 满档(极端行情)
  const sIdx = _c(50 + avgPct * 18);

  // 2. 市场宽度(0-100) — 上涨家数占比(>50% 越热,<50% 越冷)
  const upPct = total > 0 ? (up / total) * 100 : 50;
  const sBreadth = _c(upPct);

  // 3. 涨跌停对比(0-100) — 短线情绪极值,权重已降
  let sLimit = 50;
  if (lu > 0 && ld === 0) sLimit = 78;          // 有涨停无跌停:偏热但不再给满档(避免小票涨停潮虚高)
  else if (lu === 0 && ld > 0) sLimit = 20;     // 有跌停无涨停:极冷
  else if (lu > 0 && ld > 0) sLimit = _c(50 + Math.log10(lu / ld) * 18);  // ratio=10→68, ratio=0.1→32

  // 4. 赚钱效应(0-100) — 大涨(≥5%)vs 大跌(≤-5%)家数占比差
  let sMomentum = 50;
  if (input.distribution && total > 0) {
    const d = input.distribution;
    const bigUp = (d.up_5_to_7 || 0) + (d.up_7_to_10 || 0) + (d.up_ge_10 || 0);
    const bigDown = (d.down_10_to_7 || 0) + (d.down_7_to_5 || 0) + (d.down_ge_10 || 0);
    const bigUpPct = (bigUp / total) * 100;
    const bigDownPct = (bigDown / total) * 100;
    // 每 1pp 净差 ±4 分,±12.5pp 满档
    sMomentum = _c(50 + (bigUpPct - bigDownPct) * 4);
  }

  // 5. 量能(0-100) — 今日成交额相对"昨日同期"(昨收×进度)的放量/缩量幅度
  let sVolume = 50;
  if (input.prevTurnover && input.prevTurnover > 0 && typeof input.marketTurnover === 'number') {
    const prog = Math.max(0, Math.min(1, input.progress ?? 1));
    const baseVol = input.prevTurnover * (prog > 0 ? prog : 1);   // 盘中=昨日同期, 盘后=昨收
    const relChange = baseVol > 0 ? ((input.marketTurnover - baseVol) / baseVol) * 100 : 0;
    // 每 1% ±2 分,±25% 满档;放量越热、缩量越冷
    sVolume = _c(50 + relChange * 2);
  }

  // 加权平均(指数 25% + 宽度 30% + 涨跌停 15% + 赚钱效应 20% + 量能 10%)
  const final = Math.round(_c(sIdx * 0.25 + sBreadth * 0.30 + sLimit * 0.15 + sMomentum * 0.20 + sVolume * 0.10));

  let status = '常温震荡';
  let statusDesc = '中性';
  for (const [th, name, desc] of STATUS_MAP) {
    if (final <= th) {
      status = name;
      statusDesc = desc;
      break;
    }
  }

  return {
    temperature: final,
    status,
    statusDesc,
    details: {
      limit_up: lu,
      limit_down: ld,
      max_boards: Math.max(0, Math.round(input.baseMaxBoards || 0)),
      broken_rate: '0%',
      broken_count: Math.max(0, Math.round(input.baseBrokenCount || 0)),
      yest_perf: '盘中',
      yest_perf_value: 0,
      promote_rate: '盘中',
      promote_rate_value: 0,
      limit_ratio: ld > 0 ? (lu / ld).toFixed(1) : `${lu}/0`,
    },
    // v2.0.8hh:维度分改为各维度 0-100 归一值(便于将来前端展示/调试)
    dimension_scores: {
      '指数方向': Math.round(sIdx),
      '市场宽度': Math.round(sBreadth),
      '涨跌停对比': Math.round(sLimit),
      '赚钱效应': Math.round(sMomentum),
      '量能': Math.round(sVolume),
    },
  };
}