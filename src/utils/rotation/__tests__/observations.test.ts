// 近期轮动观察（V2.0 阶段 3）—— 纯函数测试
// 约定：所有预期值都由本文件**手算给出**，不使用快照、不用实现回填（沿用阶段 2 的纪律）。
//
// 默认阈值（实验参数）实测于 2026-10-13 真实归档数据：
//   minCoverage 0.6 ｜ 持续活跃 强势≥12 且 距最近强势≤3 日
//   反复脉冲 独立周期≥5 且 周期平均间隔≥12 日
//   沉寂后重新活跃 距最近强势≤4 日 且 此前空档≥24 日
//   强弱交替 强势、弱势各≥12 次 且 少数侧/多数侧≥0.8
//   相对走强 相对基准超额≥28% 且 覆盖率≥0.9
import { describe, expect, it } from 'vitest';
import { emptyGapStats } from '../analytics';
import type { EventCluster, GapStats, SectorStats } from '../analytics';
import {
  DEFAULT_OBSERVATION_THRESHOLDS,
  OBSERVATION_PRIORITY,
  buildObservationOf,
  buildObservations,
  pickHighlightObservations,
  sectorToFacts,
} from '../observations';
import type { Observation, ObservationFacts } from '../observations';

/** 造一个间隔统计（默认"样本不足、无均值"） */
function mkGap(over: Partial<GapStats> = {}): GapStats {
  return {
    count: 0, gaps: [], empties: [], avg: null, avgEmpty: null,
    median: null, min: null, max: null, std: null,
    inRange: 0, concentration: null, sampleInsufficient: true,
    ...over,
  };
}

/** 造一个独立事件簇 */
function mkCluster(startDate: string, days = 1): EventCluster {
  return {
    startIdx: 0, endIdx: 0, days, maxPct: 5, cumReturn: 0.05,
    startDate, endDate: startDate, eventDates: [startDate],
  };
}

/** 造一个判定事实（只覆盖判定所需字段） */
function mkFacts(o: Partial<ObservationFacts> = {}, id = 'x'): ObservationFacts {
  return {
    sector: { id, name: `板块${id}`, type: 'industry', pct: [], amt: [], coverage: 1 },
    strongCount: 0,
    weakCount: 0,
    lastStrongAgo: null,
    lastGapBefore: null,
    clusterCount: 0,
    clusterGapAvg: null,
    gapStrongAvg: null,
    gapStrongSampleInsufficient: true,
    cumReturn: 0,
    relStrength: null,
    coverage: 1,
    lastStrongDate: null,
    lastActiveDate: null,
    ...o,
  };
}

/** 造一个完整 SectorStats（用于 buildObservations 的排序/去重测试） */
function mkStats(o: {
  id: string;
  strongCount?: number;
  weakCount?: number;
  lastStrongAgo?: number | null;
  lastGapBefore?: number | null;
  clusterCount?: number;
  clusterGapAvg?: number | null;
  gapStrongAvg?: number | null;
  gapStrongInsuff?: boolean;
  relStrength?: number | null;
  coverage?: number;
  lastActiveDate?: string | null;
}): SectorStats {
  const coverage = o.coverage ?? 1;
  const clusters = Array.from({ length: o.clusterCount ?? 0 }, (_, i) => mkCluster(`c${i + 1}`));
  return {
    sector: { id: o.id, name: `板块${o.id}`, type: 'industry', pct: [], amt: [], coverage },
    validDays: 60,
    coverage,
    strongCount: o.strongCount ?? 0,
    weakCount: o.weakCount ?? 0,
    largeUpCount: 0,
    largeDownCount: 0,
    strongFreq: 0,
    weakFreq: 0,
    gapStrong: mkGap({ avg: o.gapStrongAvg ?? null, sampleInsufficient: o.gapStrongInsuff ?? true }),
    gapWeak: emptyGapStats(),
    clustersStrong: clusters,
    clustersWeak: [],
    clusterGapStrong: mkGap({ avg: o.clusterGapAvg ?? null, sampleInsufficient: o.clusterGapAvg == null }),
    clusterGapWeak: emptyGapStats(),
    currentStrongStreak: 0,
    longestStrongStreak: 0,
    currentWeakStreak: 0,
    longestWeakStreak: 0,
    lastStrongAgo: o.lastStrongAgo ?? null,
    lastWeakAgo: null,
    lastActiveAgo: null,
    lastActiveDate: o.lastActiveDate ?? null,
    lastGapBefore: o.lastGapBefore ?? null,
    cumReturn: 0,
    upDayRatio: 0,
    avgPct: 0,
    volatility: 0,
    maxDrawdown: 0,
    relStrength: o.relStrength ?? null,
    score: 0,
    scoreParts: { f1: 0, f2: 0, f3: 0, f4: 0 },
    strongDates: [],
    weakDates: [],
  };
}

const T = DEFAULT_OBSERVATION_THRESHOLDS;

describe('默认阈值（实验参数，回归）', () => {
  it('覆盖率0.6 / 持续12次且近3日 / 脉冲5簇且间隔12日 / 重启近4日且空档24日 / 交替各12次比例0.8 / 相对28%覆盖0.9', () => {
    expect(T.minCoverage).toBe(0.6);
    expect(T.sustainedMinStrong).toBe(12);
    expect(T.sustainedRecentAgo).toBe(3);
    expect(T.pulseMinClusters).toBe(5);
    expect(T.pulseMinClusterGap).toBe(12);
    expect(T.reactivateRecentAgo).toBe(4);
    expect(T.reactivateGapBefore).toBe(24);
    expect(T.alternateMinEach).toBe(12);
    expect(T.alternateBalance).toBe(0.8);
    expect(T.relativeExcess).toBe(0.28);
    expect(T.relativeMinCoverage).toBe(0.9);
  });
});

describe('覆盖率门槛：数据不足不下结论', () => {
  it('覆盖率 0.5 < 0.6 → null（即使其余条件都满足）', () => {
    const f = mkFacts({ coverage: 0.5, lastStrongAgo: 1, lastGapBefore: 40 });
    expect(buildObservationOf(f, 60)).toBeNull();
  });

  it('覆盖率 0.6 恰好达到门槛 → 可以生成观察', () => {
    const f = mkFacts({ coverage: 0.6, lastStrongAgo: 2, lastGapBefore: 30 });
    expect(buildObservationOf(f, 60)!.label).toBe('reactivate');
  });
});

describe('A. 沉寂后重新活跃（优先级最高）', () => {
  it('距最近强势 3 日（≤4）且 此前空档 25 日（≥24）→ reactivate，strength = 空档 25', () => {
    const f = mkFacts({ strongCount: 6, lastStrongAgo: 3, lastGapBefore: 25, lastStrongDate: 'd57' });
    const o = buildObservationOf(f, 60)!;
    expect(o.label).toBe('reactivate');
    expect(o.labelText).toBe('沉寂后重新活跃');
    expect(o.strength).toBe(25);
    expect(o.lastEventDate).toBe('d57');   // 最近一次强势事件日
    expect(o.windowDays).toBe(60);
    expect(o.reason).toContain('过去 60 个有效交易日内强势 6 次');
    expect(o.reason).toContain('最近一次在 3 个交易日前');
    expect(o.reason).toContain('此前空档达 25 个交易日');
  });

  it('此前空档 23 日（<24）→ 不判为 reactivate（且其余标签也不满足）', () => {
    const f = mkFacts({ strongCount: 6, lastStrongAgo: 3, lastGapBefore: 23 });
    expect(buildObservationOf(f, 60)).toBeNull();
  });

  it('距最近强势 5 日（>4）→ 不判为 reactivate', () => {
    const f = mkFacts({ strongCount: 6, lastStrongAgo: 5, lastGapBefore: 40 });
    expect(buildObservationOf(f, 60)).toBeNull();
  });
});

describe('B. 反复脉冲', () => {
  it('5 个独立周期且平均间隔 12.5 日（≥12）→ pulse，strength = 5×10 + 12.5 = 62.5', () => {
    const f = mkFacts({
      strongCount: 5,
      lastStrongAgo: 30,     // 近期无事件 → 不会先命中 reactivate / sustained
      lastGapBefore: 5,
      clusterCount: 5,
      clusterGapAvg: 12.5,
      lastStrongDate: 'd30',
    });
    const o = buildObservationOf(f, 60)!;
    expect(o.label).toBe('pulse');
    expect(o.strength).toBeCloseTo(62.5, 10);
    expect(o.reason).toContain('形成 5 个独立活跃周期');
    expect(o.reason).toContain('周期平均间隔 12.5 个交易日');
    expect(o.lastEventDate).toBe('d30');
  });

  it('4 个独立周期（<5）→ 不算脉冲', () => {
    const f = mkFacts({ strongCount: 4, lastStrongAgo: 30, clusterCount: 4, clusterGapAvg: 15 });
    expect(buildObservationOf(f, 60)).toBeNull();
  });

  it('5 个独立周期但平均间隔 11 日（<12）→ 不算"有明显间隔"', () => {
    const f = mkFacts({ strongCount: 5, lastStrongAgo: 30, clusterCount: 5, clusterGapAvg: 11 });
    expect(buildObservationOf(f, 60)).toBeNull();
  });
});

describe('C. 持续活跃', () => {
  it('强势 13 次（≥12）且最近 1 日前（≤3）→ sustained，strength = 强势次数 13', () => {
    const f = mkFacts({ strongCount: 13, lastStrongAgo: 1, lastGapBefore: 2, clusterCount: 1, lastStrongDate: 'd59' });
    const o = buildObservationOf(f, 60)!;
    expect(o.label).toBe('sustained');
    expect(o.strength).toBe(13);
    expect(o.reason).toContain('强势 13 次，最近一次在 1 个交易日前');
    expect(o.lastEventDate).toBe('d59');
  });

  it('强势 11 次（<12）→ 不算持续活跃', () => {
    const f = mkFacts({ strongCount: 11, lastStrongAgo: 1, lastGapBefore: 2 });
    expect(buildObservationOf(f, 60)).toBeNull();
  });

  it('强势 15 次但最近 4 日前（>3，近期已无活动）→ 不算持续活跃', () => {
    const f = mkFacts({ strongCount: 15, lastStrongAgo: 4, lastGapBefore: 2 });
    expect(buildObservationOf(f, 60)).toBeNull();
  });
});

describe('D. 强弱交替', () => {
  it('强势 12 次、弱势 10 次（少数侧 10 < 12）→ 不算交替', () => {
    const f = mkFacts({ strongCount: 12, weakCount: 10, lastStrongAgo: 40 });
    expect(buildObservationOf(f, 60)).toBeNull();
  });

  it('强势 14 次、弱势 12 次 → 比例 12/14 = 0.857 ≥ 0.8 → alternate，strength = min = 12', () => {
    const f = mkFacts({ strongCount: 14, weakCount: 12, lastStrongAgo: 40, lastActiveDate: 'd59' });
    const o = buildObservationOf(f, 60)!;
    expect(o.label).toBe('alternate');
    expect(o.strength).toBe(12);
    expect(o.reason).toContain('强势 14 次、弱势 12 次');
    expect(o.lastEventDate).toBe('d59');   // 最近一次活跃事件日（强势或弱势）
  });

  it('强势 16 次、弱势 12 次 → 比例 12/16 = 0.75 < 0.8 → 不算交替', () => {
    const f = mkFacts({ strongCount: 16, weakCount: 12, lastStrongAgo: 40 });
    expect(buildObservationOf(f, 60)).toBeNull();
  });
});

describe('E. 相对走强', () => {
  it('相对基准超额 +30%（≥28%）、覆盖率 0.95（≥0.9）→ relative，strength = 0.30', () => {
    const f = mkFacts({ relStrength: 0.3, coverage: 0.95, lastActiveDate: 'd58' });
    const o = buildObservationOf(f, 60)!;
    expect(o.label).toBe('relative');
    expect(o.strength).toBeCloseTo(0.3, 12);
    expect(o.reason).toContain('相对基准（沪深300）超额 +30.00%');
    expect(o.reason).toContain('不等同于绝对上涨');
    expect(o.lastEventDate).toBe('d58');
  });

  it('超额 +27%（<28%）→ 不算相对走强', () => {
    const f = mkFacts({ relStrength: 0.27, coverage: 1 });
    expect(buildObservationOf(f, 60)).toBeNull();
  });

  it('超额 +30% 但覆盖率 0.85（<0.9）→ 不算相对走强（相对结论更依赖数据完整度）', () => {
    const f = mkFacts({ relStrength: 0.3, coverage: 0.85 });
    expect(buildObservationOf(f, 60)).toBeNull();
  });
});

describe('去重与优先级：同一板块只保留最有辨识度的标签', () => {
  it('同时满足 reactivate 与 pulse → 返回 reactivate（优先级更高）', () => {
    const f = mkFacts({ lastStrongAgo: 2, lastGapBefore: 30, clusterCount: 5, clusterGapAvg: 15 });
    expect(buildObservationOf(f, 60)!.label).toBe('reactivate');
  });

  it('同时满足 sustained 与 alternate → 返回 sustained', () => {
    const f = mkFacts({ strongCount: 15, weakCount: 15, lastStrongAgo: 1, lastGapBefore: 1 });
    expect(buildObservationOf(f, 60)!.label).toBe('sustained');
  });

  it('优先级表本身：重启 < 脉冲 < 持续 < 交替 < 相对', () => {
    expect(OBSERVATION_PRIORITY.reactivate).toBeLessThan(OBSERVATION_PRIORITY.pulse);
    expect(OBSERVATION_PRIORITY.pulse).toBeLessThan(OBSERVATION_PRIORITY.sustained);
    expect(OBSERVATION_PRIORITY.sustained).toBeLessThan(OBSERVATION_PRIORITY.alternate);
    expect(OBSERVATION_PRIORITY.alternate).toBeLessThan(OBSERVATION_PRIORITY.relative);
  });
});

describe('阈值可覆盖（实验参数）', () => {
  it('把 sustainedMinStrong 降到 2 且 recentAgo 放宽到 5 → 强势 2 次、近 1 日 即判 sustained', () => {
    const f = mkFacts({ strongCount: 2, lastStrongAgo: 1 });
    expect(buildObservationOf(f, 60)).toBeNull();
    const o = buildObservationOf(f, 60, { ...T, sustainedMinStrong: 2, sustainedRecentAgo: 5 })!;
    expect(o.label).toBe('sustained');
    expect(o.strength).toBe(2);
  });

  it('把 relativeExcess 降到 0.05 → 超额 +6% 即判 relative', () => {
    const f = mkFacts({ relStrength: 0.06, coverage: 0.95 });
    expect(buildObservationOf(f, 60)).toBeNull();
    expect(buildObservationOf(f, 60, { ...T, relativeExcess: 0.05 })!.label).toBe('relative');
  });
});

describe('sectorToFacts：从 SectorStats 抽取判定事实', () => {
  it('抽取次数/间隔/周期/日期，且 lastStrongDate 取强势事件日的最后一条', () => {
    const s = mkStats({ id: 'z', strongCount: 3, lastStrongAgo: 2, lastGapBefore: 11, clusterCount: 2, clusterGapAvg: 7, gapStrongAvg: 4.5, gapStrongInsuff: false, relStrength: 0.3, coverage: 0.95, lastActiveDate: 'd58' });
    s.strongDates = ['d50', 'd55', 'd58'];
    const f = sectorToFacts(s);
    expect(f.strongCount).toBe(3);
    expect(f.lastStrongAgo).toBe(2);
    expect(f.lastGapBefore).toBe(11);
    expect(f.clusterCount).toBe(2);
    expect(f.clusterGapAvg).toBe(7);
    expect(f.gapStrongAvg).toBe(4.5);
    expect(f.gapStrongSampleInsufficient).toBe(false);
    expect(f.lastStrongDate).toBe('d58');
    expect(f.lastActiveDate).toBe('d58');
    expect(f.coverage).toBe(0.95);
  });

  it('无强势事件 → lastStrongDate = null', () => {
    const f = sectorToFacts(mkStats({ id: 'z' }));
    expect(f.lastStrongDate).toBeNull();
  });
});

describe('buildObservations：每个板块至多一条 + 排序规则', () => {
  it('按优先级排序，同标签内按强度降序，末键为板块 id 升序', () => {
    const stats = [
      // a：sustained，强度 13
      mkStats({ id: 'a', strongCount: 13, lastStrongAgo: 1, lastGapBefore: 1, clusterCount: 1 }),
      // b：reactivate，强度 30（优先级最高 → 应排第一）
      mkStats({ id: 'b', strongCount: 2, lastStrongAgo: 2, lastGapBefore: 30 }),
      // c：sustained，强度 12
      mkStats({ id: 'c', strongCount: 12, lastStrongAgo: 1, lastGapBefore: 1, clusterCount: 1 }),
      // d：覆盖率 0.5 → 不生成观察
      mkStats({ id: 'd', strongCount: 20, lastStrongAgo: 0, lastGapBefore: 40, coverage: 0.5 }),
    ];
    const out = buildObservations(stats, 60);
    expect(out.map((o) => o.sector.id)).toEqual(['b', 'a', 'c']);
    expect(out.map((o) => o.label)).toEqual(['reactivate', 'sustained', 'sustained']);
    // 每个板块只出现一次（去重）
    expect(new Set(out.map((o) => o.sector.id)).size).toBe(out.length);
  });

  it('同标签、同强度 → 按板块 id 升序稳定排序', () => {
    const stats = [
      mkStats({ id: 'z', strongCount: 12, lastStrongAgo: 1, lastGapBefore: 1, clusterCount: 1 }),
      mkStats({ id: 'y', strongCount: 12, lastStrongAgo: 1, lastGapBefore: 1, clusterCount: 1 }),
    ];
    expect(buildObservations(stats, 60).map((o) => o.sector.id)).toEqual(['y', 'z']);
  });

  it('没有任何符合条件 → 空数组', () => {
    expect(buildObservations([mkStats({ id: 'a' })], 60)).toEqual([]);
    expect(buildObservations([], 60)).toEqual([]);
  });
});

describe('pickHighlightObservations：折叠态按标签多样性挑选', () => {
  /** 造一个只关心 label/id 的伪观察 */
  const mkObs = (id: string, label: Observation['label']): Observation => ({
    sector: { id, name: `板块${id}`, type: 'industry', pct: [], amt: [], coverage: 1 },
    label,
    labelText: label,
    reason: '',
    metrics: [],
    windowDays: 60,
    lastEventDate: null,
    coverage: 1,
    strength: 0,
  });

  it('取 3 条时优先各标签各 1 条（顺序 = 传入顺序）', () => {
    const obs = [
      mkObs('r1', 'reactivate'), mkObs('r2', 'reactivate'), mkObs('r3', 'reactivate'),
      mkObs('p1', 'pulse'), mkObs('s1', 'sustained'),
    ];
    expect(pickHighlightObservations(obs, 3).map((o) => o.sector.id)).toEqual(['r1', 'p1', 's1']);
    expect(pickHighlightObservations(obs, 3).map((o) => o.label)).toEqual(['reactivate', 'pulse', 'sustained']);
  });

  it('标签种类不足 n 时，按原顺序补齐（不重复取同一板块）', () => {
    const obs = [mkObs('r1', 'reactivate'), mkObs('r2', 'reactivate'), mkObs('r3', 'reactivate')];
    expect(pickHighlightObservations(obs, 3).map((o) => o.sector.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('观察总数少于 n → 全量返回', () => {
    const obs = [mkObs('a', 'pulse'), mkObs('b', 'relative')];
    expect(pickHighlightObservations(obs, 3).map((o) => o.sector.id)).toEqual(['a', 'b']);
  });

  it('空列表 → 空数组', () => {
    expect(pickHighlightObservations([], 3)).toEqual([]);
  });
});
