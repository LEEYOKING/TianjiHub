// 板块轮动 · 近期轮动观察（V2.0 阶段 3 新增，任务书 §5.1 / §5.2 / §5.3 / §5.4）
// 职责：从已算好的 SectorStats 里，按**可解释的规则**识别"值得继续研究"的板块行为，
//       每条观察只给一个标签（同一板块命中多个标签时，按"辨识度"去重，只保留最有辨识度的那个），
//       并附带：统计窗口 / 核心触发原因 / 关键数据 / 最近一次相关事件日期 / 数据覆盖率。
// 纯逻辑，自包含，不做任何预测 —— 只陈述"过去发生了什么、由什么数据支持"。
//
// 阈值全部是**实验参数**（默认值见 DEFAULT_OBSERVATION_THRESHOLDS），不是经回测验证的最优参数；
// 界面必须标注"实验参数"，且允许后续按产品反馈调整。

import type { RotationSector } from './types';
import type { SectorStats } from './analytics';

/** 五类观察标签（任务书 §5.1 A~E） */
export type ObservationLabel = 'reactivate' | 'pulse' | 'sustained' | 'alternate' | 'relative';

export const OBSERVATION_LABEL_TEXT: Record<ObservationLabel, string> = {
  reactivate: '沉寂后重新活跃',
  pulse: '反复脉冲',
  sustained: '持续活跃',
  alternate: '强弱交替',
  relative: '相对走强',
};

/**
 * 辨识度优先级：数字越小越"有辨识度"。
 * 同一板块同时命中多个标签时，只保留优先级最高（最有辨识度）的那个，
 * 避免同一板块在一屏里重复出现（任务书 §5.3）。
 * 排序理由：沉寂后重启 / 反复脉冲 属于"少数板块才有的形态"，比"次数多""相对强"更能区分对象。
 */
export const OBSERVATION_PRIORITY: Record<ObservationLabel, number> = {
  reactivate: 0,
  pulse: 1,
  sustained: 2,
  alternate: 3,
  relative: 4,
};

/** 观察标签的展示色（A 股语境下避开绿色：绿色=下跌） */
export const OBSERVATION_COLOR: Record<ObservationLabel, string> = {
  reactivate: '#1890FF', // 蓝：重启
  pulse: '#FA8C16',      // 橙：脉冲
  sustained: '#ff4d4f',  // 红：持续强势
  alternate: '#722ED1',  // 紫：反复
  relative: '#FAAD14',   // 金：相对强度
};

export interface ObservationThresholds {
  /** 生成任何观察所需的最低数据覆盖率（数据不足不下结论） */
  minCoverage: number;
  /** 持续活跃：窗口内强势事件次数下限 */
  sustainedMinStrong: number;
  /** 持续活跃：距最近一次强势 ≤ N 个交易日（"近期仍有活动"） */
  sustainedRecentAgo: number;
  /** 反复脉冲：独立活跃周期个数下限 */
  pulseMinClusters: number;
  /** 反复脉冲：周期平均间隔下限（有间隔才叫"脉冲"，否则是"连续"） */
  pulseMinClusterGap: number;
  /** 沉寂后重新活跃：距最近一次强势 ≤ N 个交易日 */
  reactivateRecentAgo: number;
  /** 沉寂后重新活跃：此前空档 ≥ N 个交易日 */
  reactivateGapBefore: number;
  /** 强弱交替：强势、弱势各自的下限 */
  alternateMinEach: number;
  /** 强弱交替：少数一侧 / 多数一侧 的比例下限（两侧都不能太少） */
  alternateBalance: number;
  /** 相对走强：相对基准（简单超额）下限 */
  relativeExcess: number;
  /** 相对走强：覆盖率下限（相对强度结论更依赖数据完整度） */
  relativeMinCoverage: number;
}

/**
 * 默认阈值（**实验参数**，可调；界面明确标注"实验参数"）。
 *
 * 取值依据（2026-10-13 真实归档数据实测，默认规则 = 60 日 / TOP10 / ±2.5% / OR / 全部）：
 * 该规则下事件的"绝对次数"整体偏高（全市场强势次数中位数 4 次、弱势 4 次、独立周期 4 个），
 * 因此阈值统一取在**全市场约 p90~p95 分位**附近，使 5 类标签合计只命中约 90 个板块（占 14%），
 * 保证「近期轮动观察」确实是"少数值得继续研究的对象"，而不是把大半个市场都贴上标签。
 * 阈值是绝对次数而非分位数，规则大幅变化（如把窗口缩到 15 日、改成 AND 逻辑）时命中数会随之变化；
 * 若某组规则下命中为 0，界面会给出明确的空状态说明（任务书 §5.3）。
 */
export const DEFAULT_OBSERVATION_THRESHOLDS: ObservationThresholds = {
  minCoverage: 0.6,
  sustainedMinStrong: 12,
  sustainedRecentAgo: 3,
  pulseMinClusters: 5,
  pulseMinClusterGap: 12,
  reactivateRecentAgo: 4,
  reactivateGapBefore: 24,
  alternateMinEach: 12,
  alternateBalance: 0.8,
  relativeExcess: 0.28,
  relativeMinCoverage: 0.9,
};

/** 判定所需的"事实"——从 SectorStats 抽取出的最小字段集，便于独立构造与测试 */
export interface ObservationFacts {
  sector: RotationSector;
  strongCount: number;
  weakCount: number;
  /** 距窗口最后一个交易日的交易日步长；无事件为 null */
  lastStrongAgo: number | null;
  /** 最近一次强势事件「之前」的间隔（交易日步长）；不足两个事件为 null */
  lastGapBefore: number | null;
  /** 独立活跃周期个数 */
  clusterCount: number;
  /** 周期之间（按簇起始日相减）的平均间隔 */
  clusterGapAvg: number | null;
  /** 相邻强势事件的平均间隔 */
  gapStrongAvg: number | null;
  /** 间隔样本是否不足（不足时不给"平均间隔"数字） */
  gapStrongSampleInsufficient: boolean;
  cumReturn: number;
  relStrength: number | null;
  coverage: number;
  lastStrongDate: string | null;
  lastActiveDate: string | null;
}

export interface ObservationMetric {
  k: string;
  v: string;
}

export interface Observation {
  sector: RotationSector;
  label: ObservationLabel;
  labelText: string;
  /** 核心触发原因（由真实统计量生成的自然语言，不含预测性表述） */
  reason: string;
  /** 关键数据（用于卡片底部 chips） */
  metrics: ObservationMetric[];
  windowDays: number;
  /** 最近一次相关事件日期（该标签对应的"相关事件"） */
  lastEventDate: string | null;
  coverage: number;
  /** 排序强度（同类标签内越大越靠前） */
  strength: number;
}

/** 从 SectorStats 抽取判定所需事实 */
export function sectorToFacts(s: SectorStats): ObservationFacts {
  const n = s.strongDates.length;
  return {
    sector: s.sector,
    strongCount: s.strongCount,
    weakCount: s.weakCount,
    lastStrongAgo: s.lastStrongAgo,
    lastGapBefore: s.lastGapBefore,
    clusterCount: s.clustersStrong.length,
    clusterGapAvg: s.clusterGapStrong.avg,
    gapStrongAvg: s.gapStrong.avg,
    gapStrongSampleInsufficient: s.gapStrong.sampleInsufficient,
    cumReturn: s.cumReturn,
    relStrength: s.relStrength,
    coverage: s.coverage,
    lastStrongDate: n > 0 ? s.strongDates[n - 1] : null,
    lastActiveDate: s.lastActiveDate,
  };
}

function fix1(x: number): string {
  return x.toFixed(1);
}

function signedPct(x: number, d = 2): string {
  return `${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;
}

/** 关键数据 chips（各标签通用；"相对基准"缺失时显示 —） */
function metricsOf(f: ObservationFacts): ObservationMetric[] {
  return [
    { k: '强势', v: `${f.strongCount} 次` },
    { k: '弱势', v: `${f.weakCount} 次` },
    { k: '独立周期', v: `${f.clusterCount} 个` },
    {
      k: '平均间隔',
      v: f.gapStrongSampleInsufficient || f.gapStrongAvg === null ? '样本少' : `${fix1(f.gapStrongAvg)} 日`,
    },
    { k: '累计收益', v: signedPct(f.cumReturn) },
    { k: '相对基准', v: f.relStrength === null ? '—' : signedPct(f.relStrength) },
  ];
}

/**
 * 判定单个板块的观察标签。
 * 返回 null = 该板块在当前规则与阈值下没有明显观察线索。
 * 规则顺序即优先级（同一板块只返回第一个命中的标签）。
 */
export function buildObservationOf(
  f: ObservationFacts,
  windowDays: number,
  t: ObservationThresholds = DEFAULT_OBSERVATION_THRESHOLDS,
): Observation | null {
  // 数据不足（覆盖率过低）一律不下结论
  if (!(f.coverage >= t.minCoverage)) return null;

  const mk = (label: ObservationLabel, reason: string, strength: number, lastEventDate: string | null): Observation => ({
    sector: f.sector,
    label,
    labelText: OBSERVATION_LABEL_TEXT[label],
    reason,
    metrics: metricsOf(f),
    windowDays,
    lastEventDate,
    coverage: f.coverage,
    strength,
  });

  // A. 沉寂后重新活跃：近期有强势事件，且此前空档足够长
  if (
    f.lastStrongAgo !== null &&
    f.lastStrongAgo <= t.reactivateRecentAgo &&
    (f.lastGapBefore ?? 0) >= t.reactivateGapBefore
  ) {
    return mk(
      'reactivate',
      `过去 ${windowDays} 个有效交易日内强势 ${f.strongCount} 次；最近一次在 ${f.lastStrongAgo} 个交易日前，而此前空档达 ${f.lastGapBefore} 个交易日 —— 沉寂一段时间后重新触发强势条件。`,
      f.lastGapBefore ?? 0,
      f.lastStrongDate,
    );
  }

  // B. 反复脉冲：多个独立活跃周期，且周期之间有明显间隔
  if (
    f.clusterCount >= t.pulseMinClusters &&
    f.clusterGapAvg !== null &&
    f.clusterGapAvg >= t.pulseMinClusterGap
  ) {
    return mk(
      'pulse',
      `过去 ${windowDays} 个有效交易日内形成 ${f.clusterCount} 个独立活跃周期，周期平均间隔 ${fix1(f.clusterGapAvg)} 个交易日 —— 多次出现强势事件但彼此间隔明显，未必形成连续趋势。`,
      f.clusterCount * 10 + f.clusterGapAvg,
      f.lastStrongDate,
    );
  }

  // C. 持续活跃：强势事件次数多，且近期仍有活动
  if (
    f.strongCount >= t.sustainedMinStrong &&
    f.lastStrongAgo !== null &&
    f.lastStrongAgo <= t.sustainedRecentAgo
  ) {
    return mk(
      'sustained',
      `过去 ${windowDays} 个有效交易日内强势 ${f.strongCount} 次，最近一次在 ${f.lastStrongAgo} 个交易日前 —— 满足强势条件的频率较高且仍在延续。`,
      f.strongCount,
      f.lastStrongDate,
    );
  }

  // D. 强弱交替：强势与弱势两侧都较活跃
  const mn = Math.min(f.strongCount, f.weakCount);
  const mx = Math.max(f.strongCount, f.weakCount);
  if (mn >= t.alternateMinEach && mx > 0 && mn / mx >= t.alternateBalance) {
    return mk(
      'alternate',
      `过去 ${windowDays} 个有效交易日内强势 ${f.strongCount} 次、弱势 ${f.weakCount} 次 —— 强弱两侧都较活跃，行为较为反复。`,
      mn,
      f.lastActiveDate,
    );
  }

  // E. 相对走强：相对基准有明显超额（是相对强度，不代表绝对上涨）
  if (f.relStrength !== null && f.relStrength >= t.relativeExcess && f.coverage >= t.relativeMinCoverage) {
    return mk(
      'relative',
      `过去 ${windowDays} 个有效交易日内相对基准（沪深300）超额 ${signedPct(f.relStrength)} —— 这是相对强度，不等同于绝对上涨。`,
      f.relStrength,
      f.lastActiveDate,
    );
  }

  return null;
}

/**
 * 生成全部观察线索（每个板块至多一条），并排序：
 *   优先按"辨识度优先级"，再按标签内强度降序，最后按板块 id 升序（保证同样数据结果可复现）。
 */
export function buildObservations(
  stats: SectorStats[],
  windowDays: number,
  t: ObservationThresholds = DEFAULT_OBSERVATION_THRESHOLDS,
): Observation[] {
  const out: Observation[] = [];
  for (const s of stats) {
    const o = buildObservationOf(sectorToFacts(s), windowDays, t);
    if (o) out.push(o);
  }
  out.sort(
    (a, b) =>
      OBSERVATION_PRIORITY[a.label] - OBSERVATION_PRIORITY[b.label] ||
      b.strength - a.strength ||
      (a.sector.id < b.sector.id ? -1 : a.sector.id > b.sector.id ? 1 : 0),
  );
  return out;
}

/**
 * 折叠态（首屏精选）挑选：在"已按优先级排序"的观察里做一次**标签多样性**挑选 ——
 * 按优先级顺序每个标签最多先各取 1 条，不足以填满 n 条时再按原顺序补齐。
 *
 * 目的：默认展示的 3 条应尽量覆盖不同类型的行为线索，
 * 而不是清一色都是同一个标签（例如全市场"沉寂后重新活跃"最多，若不做多样性处理，
 * 首屏 3 条会全部是该标签，信息量反而下降）。
 */
export function pickHighlightObservations(obs: Observation[], n: number): Observation[] {
  const picked: Observation[] = [];
  const seenLabel = new Set<ObservationLabel>();
  for (const o of obs) {
    if (picked.length >= n) break;
    if (seenLabel.has(o.label)) continue;
    seenLabel.add(o.label);
    picked.push(o);
  }
  if (picked.length < n) {
    const pickedIds = new Set(picked.map((o) => o.sector.id));
    for (const o of obs) {
      if (picked.length >= n) break;
      if (pickedIds.has(o.sector.id)) continue;
      picked.push(o);
    }
  }
  return picked;
}
