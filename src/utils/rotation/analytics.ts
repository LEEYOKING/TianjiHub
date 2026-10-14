// 板块轮动 · 行为分析层
// 职责：在 WindowComputation 之上，计算每个板块的事件间隔、独立事件簇、连续强势、
// 收益/波动/回撤/相对强度与活跃度评分，并生成确定性模板文本。
// 纯逻辑，自包含。所有统计均跳过 null（无数据），绝不把 null 当 0。

import type { RotationData, RotationRuleSet, RotationSector } from './types';
import { toWindowView } from './ruleEngine';
import type { SectorEventSeries, WindowComputation } from './ruleEngine';

/** 间隔统计（单位为“交易日步长”） */
export interface GapStats {
  count: number;                 // 有效间隔数
  gaps: number[];                // 原始间隔序列 gap_i = d_(i+1) − d_i
  /** v2.0.9:空档交易日数 empty_i = gap_i − 1（两事件之间“没有事件”的交易日数）。
   *  与 gaps 是两个不同指标，必须分别命名与展示，不能混用（任务书 §8.3）。 */
  empties: number[];
  avg: number | null;
  avgEmpty: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  std: number | null;
  inRange: number;               // 落在 [gapMin, gapMax] 的次数
  concentration: number | null;  // inRange/count，count<4 时为 null
  sampleInsufficient: boolean;   // count < 4
}

/** 独立事件簇 */
export interface EventCluster {
  startIdx: number; endIdx: number; // 窗口内序号(0-based，相对 days)
  days: number;                     // 事件日数量
  maxPct: number; cumReturn: number; // 簇内最大涨幅 / 簇内复合收益(小数)
  startDate: string; endDate: string;
  eventDates: string[];
}

/** 单个板块的完整行为画像 */
export interface SectorStats {
  sector: RotationSector;
  validDays: number; coverage: number;
  strongCount: number; weakCount: number; largeUpCount: number; largeDownCount: number;
  strongFreq: number; weakFreq: number;          // 次数/有效日数
  gapStrong: GapStats; gapWeak: GapStats;        // 事件日口径的间隔
  clustersStrong: EventCluster[]; clustersWeak: EventCluster[];
  clusterGapStrong: GapStats; clusterGapWeak: GapStats; // 独立事件簇口径的间隔(用簇起始日相减)
  currentStrongStreak: number; longestStrongStreak: number;
  currentWeakStreak: number; longestWeakStreak: number;
  lastStrongAgo: number | null; lastWeakAgo: number | null; // 距窗口最后一个交易日的交易日数
  /** 最近一次强势事件「之前」的那个间隔(交易日步长);不足两个事件时为 null */
  lastGapBefore: number | null;
  cumReturn: number;      // 复合收益(小数)
  upDayRatio: number; avgPct: number; volatility: number;
  maxDrawdown: number;    // 负数或 0
  relStrength: number | null;  // 相对基准累计超额(小数)，基准缺失时 null
  score: number;          // 0~100 活跃度评分
  strongDates: string[]; weakDates: string[];
}

/** 空间隔统计 */
export function emptyGapStats(): GapStats {
  return {
    count: 0, gaps: [], empties: [], avg: null, avgEmpty: null,
    median: null, min: null, max: null, std: null,
    inRange: 0, concentration: null, sampleInsufficient: true,
  };
}

/**
 * 间隔统计。
 * 口径：count<4 时不计算集中度（不允许用两三个样本包装成“规律”）。
 * 标准差用总体标准差（除以 n），n=1 时为 0。
 * v2.0.9:同时给出 empty_i = gap_i − 1（空档交易日数），与 gap_i 严格区分。
 */
export function gapStatsOf(gaps: number[], gapMin: number, gapMax: number): GapStats {
  const count = gaps.length;
  if (count === 0) return emptyGapStats();

  const sorted = [...gaps].sort((a, b) => a - b);
  let sum = 0;
  for (const g of gaps) sum += g;
  const avg = sum / count;

  const empties = gaps.map((g) => g - 1);
  const avgEmpty = avg - 1;

  const median = count % 2 === 1
    ? sorted[(count - 1) / 2]
    : (sorted[count / 2 - 1] + sorted[count / 2]) / 2;

  const min = sorted[0];
  const max = sorted[count - 1];

  let variance = 0;
  for (const g of gaps) variance += (g - avg) ** 2;
  variance /= count;
  const std = Math.sqrt(variance);

  let inRange = 0;
  for (const g of gaps) if (g >= gapMin && g <= gapMax) inRange++;

  const sampleInsufficient = count < 4;
  const concentration = sampleInsufficient ? null : inRange / count;

  return { count, gaps: [...gaps], empties, avg, avgEmpty, median, min, max, std, inRange, concentration, sampleInsufficient };
}

/**
 * 最大回撤（单一实现，v2.0.9 抽出）。
 * 口径：DD_d = V_d / max(V_1..V_d) − 1；MDD = min(DD_d)。返回负数或 0。
 * 净值序列必须与"收益曲线"同源（任务书 §8.7），故详情页曲线与统计摘要都走这里。
 */
export function maxDrawdownOf(nav: number[]): number {
  let peak = nav.length > 0 ? nav[0] : 1;
  let mdd = 0;
  for (const v of nav) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? v / peak - 1 : 0;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

/**
 * 分析单个板块。
 * 注意：窗口由 data.dates 长度与 rule.windowDays 共同决定（与 computeWindow 保持一致）。
 */
export function analyzeSector(
  series: SectorEventSeries,
  data: RotationData,
  rule: RotationRuleSet,
  comp: WindowComputation,
): SectorStats {
  const total = data.dates.length;
  const win = Math.max(0, Math.min(Math.floor(rule.windowDays), total));
  const start = total - win;

  const days = series.days;
  const pct = series.pctInWindow;
  const events = series.events;

  // 全局下标 → 序列位置 映射（供连续天数 / 事件簇回溯）
  const posByGlobal = new Map<number, number>();
  for (let k = 0; k < days.length; k++) posByGlobal.set(days[k], k);

  // 有效涨跌幅（跳过 null / NaN）
  const valid: number[] = [];
  for (let k = 0; k < pct.length; k++) {
    const v = pct[k];
    if (isNum(v)) valid.push(v);
  }
  const validDays = valid.length;
  const coverage = win > 0 ? validDays / win : 0;

  // ---- 事件计数与事件日(全局下标) ----
  const strongGlobals: number[] = [];
  const weakGlobals: number[] = [];
  let largeUpCount = 0;
  let largeDownCount = 0;
  for (let k = 0; k < days.length; k++) {
    const e = events[k];
    if (!e) continue;
    if (e.largeUp) largeUpCount++;
    if (e.largeDown) largeDownCount++;
    if (e.strong) strongGlobals.push(days[k]);
    if (e.weak) weakGlobals.push(days[k]);
  }
  const strongCount = strongGlobals.length;
  const weakCount = weakGlobals.length;
  const strongDates = strongGlobals.map((g) => data.dates[g]);
  const weakDates = weakGlobals.map((g) => data.dates[g]);
  // 最近一次强势事件「之前」的间隔：最后两个强势事件日的全局下标差（<2 个事件为 null）
  const lastGapBefore = strongCount >= 2 ? strongGlobals[strongCount - 1] - strongGlobals[strongCount - 2] : null;
  const strongFreq = validDays > 0 ? strongCount / validDays : 0;
  const weakFreq = validDays > 0 ? weakCount / validDays : 0;

  // ---- 间隔统计（口径：相邻事件日的全局下标差 = 交易日步长，Δ=1 表示相隔 1 步）----
  const gapStrong = gapStatsOf(diff(strongGlobals), rule.gapMin, rule.gapMax);
  const gapWeak = gapStatsOf(diff(weakGlobals), rule.gapMin, rule.gapMax);

  // ---- 独立事件簇（按冷却期合并）；簇间间隔用“簇起始日”相减 ----
  const strongGroups = groupByCooldown(strongGlobals, rule.cooldownDays);
  const weakGroups = groupByCooldown(weakGlobals, rule.cooldownDays);
  const clustersStrong = strongGroups.map((g) => buildCluster(g, pct, posByGlobal, data.dates));
  const clustersWeak = weakGroups.map((g) => buildCluster(g, pct, posByGlobal, data.dates));
  const clusterGapStrong = gapStatsOf(diff(strongGroups.map((g) => g[0])), rule.gapMin, rule.gapMax);
  const clusterGapWeak = gapStatsOf(diff(weakGroups.map((g) => g[0])), rule.gapMin, rule.gapMax);

  // ---- 连续强势 / 弱势（无数据跳过：不算连续也不中断）----
  const strongStreak = streakInfo(events, posByGlobal, start, total, 'strong');
  const weakStreak = streakInfo(events, posByGlobal, start, total, 'weak');

  // ---- 复合收益：∏(1+r)-1，缺失日跳过 ----
  let cum = 1;
  for (const p of valid) cum *= 1 + p / 100;
  const cumReturn = cum - 1;

  const avgPct = validDays > 0 ? valid.reduce((s, x) => s + x, 0) / validDays : 0;
  let upDays = 0;
  for (const p of valid) if (p > 0) upDays++;
  const upDayRatio = validDays > 0 ? upDays / validDays : 0;

  // 波动率 = 涨跌幅的总体标准差
  let variance = 0;
  for (const p of valid) variance += (p - avgPct) ** 2;
  variance = validDays > 0 ? variance / validDays : 0;
  const volatility = Math.sqrt(variance);

  // 最大回撤：基于窗口内净值序列（跳过缺失日）；与详情页曲线同源，单一实现见 maxDrawdownOf
  let v = 1;
  const navValid: number[] = [];
  for (const p of valid) {
    v *= 1 + p / 100;
    navValid.push(v);
  }
  const maxDrawdown = maxDrawdownOf(navValid);

  // ---- 相对基准：只取「两者都有数据的共同有效日」分别复合，单一实现见 relativeToBench ----
  const rel = relativeToBench(data, comp, series);
  const relStrength: number | null = rel.commonDays > 0 ? rel.simple : null;

  // ---- 活跃度评分 0~100 ----
  // 权重：强势频率 35% + 近期活跃度 25% + 独立簇频率 20% + 相对市场趋势 20%，各分项先归一化到 0~1。
  // 近期活跃度用指数衰减 R=exp(-λΔ)，λ=ln2/5(半衰期 5 个交易日)，Δ=距最近一次强势事件的交易日数。
  const f1 = clamp01(strongFreq / 0.2);                     // 20% 交易日强势即满分
  const f2 = strongStreak.ago === null ? 0 : Math.exp(-(Math.LN2 / 5) * strongStreak.ago);
  const f3 = clamp01((clustersStrong.length / Math.max(1, validDays)) / 0.1); // 每 10 个交易日 1 簇即满分
  const f4 = relStrength === null ? 0.5 : clamp01(0.5 + relStrength / 0.2);    // 超额 ±10% 映射到 0~1
  const score = Math.round(clamp01(0.35 * f1 + 0.25 * f2 + 0.2 * f3 + 0.2 * f4) * 100);

  return {
    sector: series.sector,
    validDays,
    coverage,
    strongCount, weakCount, largeUpCount, largeDownCount,
    strongFreq, weakFreq,
    gapStrong, gapWeak,
    clustersStrong, clustersWeak,
    clusterGapStrong, clusterGapWeak,
    currentStrongStreak: strongStreak.current,
    longestStrongStreak: strongStreak.longest,
    currentWeakStreak: weakStreak.current,
    longestWeakStreak: weakStreak.longest,
    lastStrongAgo: strongStreak.ago,
    lastWeakAgo: weakStreak.ago,
    lastGapBefore,
    cumReturn,
    upDayRatio, avgPct, volatility,
    maxDrawdown,
    relStrength,
    score,
    strongDates, weakDates,
  };
}

/** 批量分析：comp.series 已经过 scope 过滤，这里直接逐个分析 */
export function analyzeAll(data: RotationData, rule: RotationRuleSet, comp: WindowComputation): SectorStats[] {
  return comp.series.map((s) => analyzeSector(s, data, rule, comp));
}

// ===================== 相对基准（两种口径，单一实现） =====================

/**
 * 相对基准的两种口径（任务书 §8.8 要求明确区分并在指标名/说明中标注）：
 *  · simple   = 板块累计收益 − 基准累计收益      （"简单超额收益"，绝对差）
 *  · netValue = 板块净值 / 基准净值 − 1          （"相对净值收益"，比率口径）
 * 一律只在「两者都有行情」的**共同有效日**上分别复合；缺失日不计入分母，
 * 也不当作 0 涨跌幅（否则基准缺失会把板块收益稀释、反之亦然）。
 */
export function relativeToBench(
  data: RotationData,
  comp: WindowComputation,
  series: SectorEventSeries,
): { simple: number | null; netValue: number | null; commonDays: number } {
  let s = 1;
  let b = 1;
  let common = 0;
  const view = toWindowView(comp, series);
  for (let i = 0; i < view.windowLen; i++) {
    const p = view.pctAt[i];
    const bm = data.bench[comp.indices[i]];
    if (!isNum(p) || !isNum(bm)) continue;
    s *= 1 + p / 100;
    b *= 1 + bm / 100;
    common++;
  }
  if (common === 0) return { simple: null, netValue: null, commonDays: 0 };
  return { simple: (s - 1) - (b - 1), netValue: b > 0 ? s / b - 1 : null, commonDays: common };
}

// ===================== 窗口净值序列（单一实现，v2.0.9 新增） =====================

/**
 * 窗口净值序列：详情页收益曲线与「最大回撤 / 累计收益」共用同一套序列（任务书 §6.4、§8.7）。
 * 口径：
 *  · 与窗口交易日**一一对齐**（长度 = comp.dates.length），由 toWindowView 保证不错位；
 *  · 缺失日**沿用前值**（等价于"跳过缺失日"），绝不当作 0 收益；
 *  · navSector[末] − 1 === analyzeSector().cumReturn；
 *  · maxDrawdown === analyzeSector().maxDrawdown（同一个 maxDrawdownOf）。
 */
export interface NavSeries {
  dates: string[];
  navSector: number[];
  navBench: number[];
  sectorValid: boolean[];
  benchValid: boolean[];
  cumReturn: number;
  maxDrawdown: number;
  validSectorDays: number;
  validBenchDays: number;
  /** 基准在窗口内完全没有行情时为 false → UI 必须隐藏基准线，不得伪造 */
  benchAvailable: boolean;
}

export function buildNavSeries(data: RotationData, comp: WindowComputation, series: SectorEventSeries): NavSeries {
  const view = toWindowView(comp, series);
  const n = view.windowLen;
  const navSector: number[] = new Array(n);
  const navBench: number[] = new Array(n);
  const sectorValid: boolean[] = new Array(n);
  const benchValid: boolean[] = new Array(n);

  let sv = 1;
  let bv = 1;
  let validSectorDays = 0;
  let validBenchDays = 0;
  for (let i = 0; i < n; i++) {
    const p = view.pctAt[i];
    sectorValid[i] = isNum(p);
    if (isNum(p)) {
      sv *= 1 + p / 100;
      validSectorDays++;
    }
    const b = data.bench[comp.indices[i]];
    benchValid[i] = isNum(b);
    if (isNum(b)) {
      bv *= 1 + b / 100;
      validBenchDays++;
    }
    navSector[i] = sv;
    navBench[i] = bv;
  }

  return {
    dates: [...comp.dates],
    navSector,
    navBench,
    sectorValid,
    benchValid,
    cumReturn: sv - 1,
    maxDrawdown: maxDrawdownOf(navSector),
    validSectorDays,
    validBenchDays,
    benchAvailable: validBenchDays > 0,
  };
}

/**
 * 生成单板块的确定性模板文本（非 AI）。
 * 事件日序号由 lastStrongAgo 锚定（最后一个事件日 = win - lastStrongAgo），
 * 再用间隔序列反推全部事件日，因此无需额外数据即可还原“第 X 天”。
 */
export function describeSector(stats: SectorStats, rule: RotationRuleSet): string[] {
  const win = Math.max(1, Math.floor(rule.windowDays));
  const lines: string[] = [];
  lines.push(`最近 ${win} 个交易日，进入强势榜 ${stats.strongCount} 次，进入弱势榜 ${stats.weakCount} 次。`);
  lines.push(...describeSide('强势', win, stats.strongCount, stats.lastStrongAgo, stats.gapStrong));
  lines.push(...describeSide('弱势', win, stats.weakCount, stats.lastWeakAgo, stats.gapWeak));
  // 口径提示必须位于末尾
  lines.push(`统计口径：窗口 ${rule.windowDays} 个交易日，TOP ${rule.topN}，大涨阈值 +${rule.riseThreshold}%，组合方式 ${rule.eventLogic}。`);
  return lines;
}

/** 生成全市场汇总文本（确定性） */
export function describeOverall(stats: SectorStats[], data: RotationData, rule: RotationRuleSet): string[] {
  const win = Math.max(0, Math.min(Math.floor(rule.windowDays), data.dates.length));
  const lines: string[] = [];
  lines.push(`共分析 ${stats.length} 个板块（窗口 ${win} 个交易日，TOP ${rule.topN}，组合方式 ${rule.eventLogic}）。`);

  let strong = 0;
  let weak = 0;
  let clusters = 0;
  for (const s of stats) {
    strong += s.strongCount;
    weak += s.weakCount;
    clusters += s.clustersStrong.length;
  }
  lines.push(`窗口内合计：强势事件 ${strong} 次，弱势事件 ${weak} 次，独立强势簇 ${clusters} 个。`);

  const top = [...stats]
    .sort((a, b) => (b.score - a.score) || (a.sector.id < b.sector.id ? -1 : a.sector.id > b.sector.id ? 1 : 0))
    .slice(0, 3);
  if (top.length > 0) {
    lines.push(`活跃度前三：${top.map((s) => `${s.sector.name}(${s.score})`).join('、')}。`);
  }
  lines.push(`统计口径：窗口 ${win} 个交易日，TOP ${rule.topN}，大涨阈值 +${rule.riseThreshold}%，组合方式 ${rule.eventLogic}。`);
  return lines;
}

// ===================== 内部工具 =====================

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** 相邻元素差（要求输入升序） */
function diff(arr: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < arr.length; i++) out.push(arr[i] - arr[i - 1]);
  return out;
}

/**
 * 冷却期分簇：若距“最近一个已归属事件日”≤ cooldownDays 个交易日步长，则并入同簇。
 * cooldownDays=0 时相邻事件日间距必然 ≥1，故每个事件日各自成簇。
 * 注意：相邻事件日间距即为集群内的步长差。
 */
function groupByCooldown(globals: number[], cooldownDays: number): number[][] {
  if (globals.length === 0) return [];
  const groups: number[][] = [];
  let cur: number[] = [globals[0]];
  for (let i = 1; i < globals.length; i++) {
    if (globals[i] - globals[i - 1] <= cooldownDays) cur.push(globals[i]);
    else { groups.push(cur); cur = [globals[i]]; }
  }
  groups.push(cur);
  return groups;
}

/** 由事件的全局下标簇构建事件簇对象 */
function buildCluster(
  g: number[],
  pct: (number | null)[],
  posByGlobal: Map<number, number>,
  dates: string[],
): EventCluster {
  const startGlobal = g[0];
  const endGlobal = g[g.length - 1];
  const startIdx = posByGlobal.get(startGlobal) ?? 0;
  const endIdx = posByGlobal.get(endGlobal) ?? 0;

  // 簇内复合收益：从簇起始日到结束日的区间收益（跳过缺失日）
  let cum = 1;
  for (let d = startGlobal; d <= endGlobal; d++) {
    const pos = posByGlobal.get(d);
    if (pos === undefined) continue;
    const p = pct[pos];
    if (isNum(p)) cum *= 1 + p / 100;
  }

  // 簇内最大涨幅：成员事件日中的最大 pct
  let maxPct = -Infinity;
  for (const d of g) {
    const pos = posByGlobal.get(d);
    if (pos === undefined) continue;
    const p = pct[pos];
    if (isNum(p) && p > maxPct) maxPct = p;
  }

  return {
    startIdx,
    endIdx,
    days: g.length,
    maxPct: maxPct === -Infinity ? 0 : maxPct,
    cumReturn: cum - 1,
    startDate: dates[startGlobal],
    endDate: dates[endGlobal],
    eventDates: g.map((d) => dates[d]),
  };
}

/**
 * 连续与“距今”信息。
 * 口径：从窗口最后一个交易日往前遍历；
 *  - 当日无数据 → 跳过（不算连续、也不中断）；
 *  - 当日有数据且命中 → 连续计数 +1；
 *  - 当日有数据但未命中 → 中断。
 */
function streakInfo(
  events: (unknown)[],
  posByGlobal: Map<number, number>,
  start: number,
  total: number,
  key: 'strong' | 'weak',
): { current: number; longest: number; ago: number | null } {
  const hit = (pos: number): boolean => {
    const e = events[pos] as Record<string, unknown> | null;
    return !!e && e[key] === true;
  };

  // 当前连续（从末尾往前）
  let current = 0;
  for (let d = total - 1; d >= start; d--) {
    const pos = posByGlobal.get(d);
    if (pos === undefined) continue;
    if (hit(pos)) current++;
    else break;
  }

  // 窗口内最长连续（无数据跳过不中断）
  let longest = 0;
  let run = 0;
  for (let d = start; d < total; d++) {
    const pos = posByGlobal.get(d);
    if (pos === undefined) continue;
    if (hit(pos)) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }

  // 距窗口最后一个交易日的交易日步长
  let ago: number | null = null;
  for (let d = total - 1; d >= start; d--) {
    const pos = posByGlobal.get(d);
    if (pos === undefined) continue;
    if (hit(pos)) { ago = total - 1 - d; break; }
  }

  return { current, longest, ago };
}

/** 由间隔序列与锚点反推事件日的窗口内 1-based 序号 */
function eventDayNumbers(win: number, lastAgo: number, gaps: number[]): number[] {
  let span = 0;
  for (const g of gaps) span += g;
  const last = win - lastAgo;   // 最后一个事件日的窗口内序号
  const first = last - span;    // 第一个事件日
  const nums: number[] = [first];
  for (const g of gaps) nums.push(nums[nums.length - 1] + g);
  return nums;
}

/** 生成单侧（强势/弱势）事件明细文本 */
function describeSide(label: string, win: number, count: number, lastAgo: number | null, gap: GapStats): string[] {
  const out: string[] = [];
  if (count === 0) {
    out.push(`窗口内未出现${label}事件。`);
    return out;
  }
  if (count === 1) {
    const day = lastAgo === null ? null : win - lastAgo;
    out.push(day === null ? `窗口内出现 1 次${label}事件。` : `${label}事件发生在第 ${day} 天（仅 1 次，无间隔）。`);
    return out;
  }
  const nums = lastAgo === null ? [] : eventDayNumbers(win, lastAgo, gap.gaps);
  const dayText = nums.length > 0 ? `第 ${nums.join('、')} 天` : `${count} 天`;
  out.push(`${label}事件发生在${dayText}，事件间隔分别为 ${gap.gaps.join('、')} 个交易日。`);
  if (gap.sampleInsufficient) {
    out.push(`⚠ 间隔样本仅 ${gap.count} 个，不足以判断规律。`);
  }
  return out;
}