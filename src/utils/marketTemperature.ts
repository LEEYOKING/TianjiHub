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
export function calcLiveEmotionTemperature(input: {
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
  // 盘后超短框架字段(盘中冻结,仅用于 details 兜底展示)
  baseMaxBoards?: number;
  baseBrokenCount?: number;
}) {
  let score = 50;
  const up = Math.max(0, Math.round(input.upCount));
  const down = Math.max(0, Math.round(input.downCount));
  const lu = Math.max(0, Math.round(input.limitUp));
  const ld = Math.max(0, Math.round(input.limitDown));

  // 1. 涨跌停对比(±30)
  const ratio = lu / Math.max(ld, 1);
  let s1 = 0;
  if (ld === 0 && lu > 0) s1 = 30;
  else if (ratio > 5) s1 = 24;
  else if (ratio > 2) s1 = 15;
  else if (ratio >= 1) s1 = 6;
  else if (ratio > 0.5) s1 = -12;
  else s1 = -30;
  score += s1;

  // 2. 上涨占比(±35)
  const total = up + down;
  const pct = total > 0 ? (up / total) * 100 : 50;
  let s2 = 0;
  if (pct > 70) s2 = 35;
  else if (pct > 60) s2 = 25;
  else if (pct > 55) s2 = 12;
  else if (pct >= 45) s2 = 0;
  else if (pct > 35) s2 = -15;
  else if (pct > 25) s2 = -25;
  else s2 = -35;
  score += s2;

  // 3. 大涨 vs 大跌股数(±35)
  let s3 = 0;
  if (input.distribution) {
    const bigUp = input.distribution.up_5_to_7 + input.distribution.up_7_to_10 + input.distribution.up_ge_10;
    const bigDown = input.distribution.down_7_to_5 + input.distribution.down_10_to_7 + input.distribution.down_ge_10;
    const diff = bigUp - bigDown;
    if (diff > 300) s3 = 35;
    else if (diff > 150) s3 = 25;
    else if (diff > 50) s3 = 12;
    else if (diff >= -50) s3 = 0;
    else if (diff > -150) s3 = -12;
    else if (diff > -300) s3 = -25;
    else s3 = -35;
  }
  score += s3;

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
      limit_up: lu,
      limit_down: ld,
      max_boards: Math.max(0, Math.round(input.baseMaxBoards || 0)),
      broken_rate: '0%',
      broken_count: Math.max(0, Math.round(input.baseBrokenCount || 0)),
      yest_perf: '盘中',        // 盘中无昨日涨停表现,标记"盘中"
      yest_perf_value: 0,
      promote_rate: '盘中',
      promote_rate_value: 0,
      limit_ratio: ld > 0 ? ratio.toFixed(1) : `${lu}/0`,
    },
    dimension_scores: {
      '涨跌停对比': s1,
      '上涨占比': s2,
      '大涨大跌': s3,
    },
  };
}