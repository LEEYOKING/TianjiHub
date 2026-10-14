// 事件间隔 / 空档交易日数 / 独立事件簇 / 冷却期边界 —— 对应任务书 §14 的 4/8 与 §8.3、§8.4
import { describe, expect, it } from 'vitest';
import { computeWindow } from '../ruleEngine';
import { analyzeAll, gapStatsOf } from '../analytics';
import type { RotationRuleSet } from '../types';
import { dataA, mkRule } from './fixtures';

function runA(rule: RotationRuleSet) {
  const data = dataA();
  const comp = computeWindow(data, rule);
  const stats = analyzeAll(data, rule, comp);
  return { stats, a: stats.find((s) => s.sector.id === 'a')! };
}

describe('gapStatsOf 公式（手算核算）', () => {
  // gaps = [1,2,3,4]，关注区间 1~3
  const g = gapStatsOf([1, 2, 3, 4], 1, 3);

  it('平均 2.5 / 中位 2.5 / 最小 1 / 最大 4', () => {
    expect(g.count).toBe(4);
    expect(g.avg).toBeCloseTo(2.5, 10);
    expect(g.median).toBeCloseTo(2.5, 10);
    expect(g.min).toBe(1);
    expect(g.max).toBe(4);
  });

  it('总体标准差 = sqrt(1.25) ≈ 1.1180339887', () => {
    expect(g.std).toBeCloseTo(1.1180339887, 9);
  });

  it('空档交易日数 empty_i = gap_i - 1 = [0,1,2,3]，均值 1.5', () => {
    expect(g.empties).toEqual([0, 1, 2, 3]);
    expect(g.avgEmpty).toBeCloseTo(1.5, 10);
  });

  it('落在 1~3 的有 3 个 → 集中度 0.75（样本 ≥4 才计算）', () => {
    expect(g.inRange).toBe(3);
    expect(g.concentration).toBeCloseTo(0.75, 10);
    expect(g.sampleInsufficient).toBe(false);
  });

  it('样本只有 3 个时集中度必须为 null（不拿两三个样本包装规律）', () => {
    const g3 = gapStatsOf([1, 2, 3], 1, 3);
    expect(g3.count).toBe(3);
    expect(g3.concentration).toBeNull();
    expect(g3.sampleInsufficient).toBe(true);
  });

  it('空输入返回全 null 且样本不足', () => {
    const ge = gapStatsOf([], 1, 5);
    expect(ge.count).toBe(0);
    expect(ge.avg).toBeNull();
    expect(ge.median).toBeNull();
    expect(ge.gaps).toEqual([]);
    expect(ge.empties).toEqual([]);
    expect(ge.sampleInsufficient).toBe(true);
  });
});

describe('事件间隔（交易日序号差）', () => {
  it('板块 a 强势事件日 d2,d5,d6,d8 → 间隔 [3,1,2]、空档 [2,0,1]', () => {
    const { a } = runA(mkRule());
    expect(a.strongDates).toEqual(['d2', 'd5', 'd6', 'd8']);
    expect(a.gapStrong.gaps).toEqual([3, 1, 2]);
    expect(a.gapStrong.empties).toEqual([2, 0, 1]);
    expect(a.gapStrong.avg).toBeCloseTo(2, 10);
    expect(a.gapStrong.avgEmpty).toBeCloseTo(1, 10);
    expect(a.gapStrong.median).toBeCloseTo(2, 10);
    expect(a.gapStrong.min).toBe(1);
    expect(a.gapStrong.max).toBe(3);
    // 间隔数 = 事件数 - 1
    expect(a.gapStrong.count).toBe(a.strongCount - 1);
    // 3 个间隔 < 4 → 样本不足
    expect(a.gapStrong.sampleInsufficient).toBe(true);
    expect(a.gapStrong.concentration).toBeNull();
  });

  it('板块 a 弱势事件日 d3,d4,d7,d10 → 间隔 [1,3,3]、空档 [0,2,2]', () => {
    const { a } = runA(mkRule());
    expect(a.weakDates).toEqual(['d3', 'd4', 'd7', 'd10']);
    expect(a.gapWeak.gaps).toEqual([1, 3, 3]);
    expect(a.gapWeak.empties).toEqual([0, 2, 2]);
    expect(a.gapWeak.avg).toBeCloseTo(7 / 3, 9);
    expect(a.gapWeak.median).toBe(3);
    // 总体标准差 = sqrt(8/9)
    expect(a.gapWeak.std).toBeCloseTo(0.9428090416, 9);
  });

  it('无数据日不会把间隔算错：事件日按交易日序号差，缺失日不产生事件也不截断（夹具 B）', () => {
    const data = dataA({ pctA: [1.0, null, 4.0, null, 6.0, 2.0, null, 5.0, 1.0, 1.0] });
    const rule = mkRule({ riseRankEnabled: false });
    const comp = computeWindow(data, rule);
    const a = analyzeAll(data, rule, comp).find((s) => s.sector.id === 'a')!;
    // 大涨日 = 下标 2(d3,4.0) / 4(d5,6.0) / 7(d8,5.0)
    expect(a.strongDates).toEqual(['d3', 'd5', 'd8']);
    // 间隔按交易日序号差：2 → 2（d3→d5 = 2 步）、3（d5→d8 = 3 步）
    expect(a.gapStrong.gaps).toEqual([2, 3]);
    expect(a.gapStrong.empties).toEqual([1, 2]);
  });
});

describe('独立事件簇：冷却期边界', () => {
  // 板块 a 强势日（窗口内 0-based 下标）= [1, 4, 5, 7]，相邻差 = [3, 1, 2]
  it('冷却期 0（不合并）：4 个事件日各自成簇', () => {
    const { a } = runA(mkRule({ cooldownDays: 0 }));
    expect(a.clustersStrong).toHaveLength(4);
    expect(a.clustersStrong.map((c) => c.days)).toEqual([1, 1, 1, 1]);
    expect(a.clustersStrong.map((c) => c.startDate)).toEqual(['d2', 'd5', 'd6', 'd8']);
  });

  it('冷却期 1：仅 4→5（差 1）合并 → 3 簇 [1],[4,5],[7]', () => {
    const { a } = runA(mkRule({ cooldownDays: 1 }));
    expect(a.clustersStrong).toHaveLength(3);
    expect(a.clustersStrong.map((c) => c.days)).toEqual([1, 2, 1]);
    expect(a.clustersStrong.map((c) => c.startDate)).toEqual(['d2', 'd5', 'd8']);
    expect(a.clustersStrong[1].endDate).toBe('d6');
    expect(a.clustersStrong[1].eventDates).toEqual(['d5', 'd6']);
  });

  it('冷却期 2：合并具有传递性 → 4,5,7 并成一个簇（共 2 簇）', () => {
    const { a } = runA(mkRule({ cooldownDays: 2 }));
    expect(a.clustersStrong).toHaveLength(2);
    expect(a.clustersStrong.map((c) => c.days)).toEqual([1, 3]);
    expect(a.clustersStrong[1].eventDates).toEqual(['d5', 'd6', 'd8']);
  });

  it('冷却期 3：1→4 差为 3 也能并入 → 全部并成 1 簇', () => {
    const { a } = runA(mkRule({ cooldownDays: 3 }));
    expect(a.clustersStrong).toHaveLength(1);
    expect(a.clustersStrong[0].days).toBe(4);
    expect(a.clustersStrong[0].startDate).toBe('d2');
    expect(a.clustersStrong[0].endDate).toBe('d8');
  });

  it('簇内指标：d5~d8 簇 = 3 个事件日 / 最大涨幅 5.0% / 区间复合收益 9.20987%', () => {
    const { a } = runA(mkRule({ cooldownDays: 2 }));
    const c = a.clustersStrong[1];
    expect(c.days).toBe(3);
    expect(c.eventDates).toEqual(['d5', 'd6', 'd8']);
    // 簇内最大涨幅取自事件日：max(2.0, 5.0, 3.0) = 5.0
    expect(c.maxPct).toBeCloseTo(5.0, 10);
    // 簇内复合收益 = 区间 d5..d8 的 ∏(1+r)：1.02*1.05*0.99*1.03 - 1 = 0.0920987
    expect(c.cumReturn).toBeCloseTo(0.0920987, 9);
  });

  it('簇间隔用"簇起始日"相减，而非事件日', () => {
    const { a } = runA(mkRule({ cooldownDays: 2 }));
    // 簇起始日 = [1(d2), 4(d5)] → 间隔 = [3]
    expect(a.clusterGapStrong.gaps).toEqual([3]);
    expect(a.clusterGapStrong.count).toBe(1);
    expect(a.clusterGapStrong.sampleInsufficient).toBe(true);
  });

  it('原始事件日在分簇后仍然完整保留（§8.4：绝不修改原始事件）', () => {
    const { a } = runA(mkRule({ cooldownDays: 3 }));
    expect(a.clustersStrong).toHaveLength(1);
    expect(a.strongDates).toEqual(['d2', 'd5', 'd6', 'd8']);
    expect(a.strongCount).toBe(4);
    expect(a.clustersStrong[0].eventDates).toEqual(['d2', 'd5', 'd6', 'd8']);
  });
});
