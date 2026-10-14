// 复合累计收益 / 最大回撤 / 相对基准两种口径 / 基准缺失 —— 对应任务书 §14 的 12/16/17 与 §8.6、§8.7、§8.8
import { describe, expect, it } from 'vitest';
import { computeWindow } from '../ruleEngine';
import { analyzeAll, buildNavSeries, maxDrawdownOf, relativeToBench } from '../analytics';
import type { RotationData, RotationRuleSet } from '../types';
import { PCT_B_P, dataA, dataB, mkRule } from './fixtures';

function run(data: RotationData, rule: RotationRuleSet) {
  const comp = computeWindow(data, rule);
  return { comp, stats: analyzeAll(data, rule, comp) };
}

describe('窗口累计收益（复合收益 ∏(1+r)-1，不可简单相加）', () => {
  it('板块 a：逐日 10 个涨跌幅复合 → 7.355829588493%', () => {
    const { stats } = run(dataA(), mkRule());
    const a = stats.find((s) => s.sector.id === 'a')!;
    // 1.01*1.04*0.97*1.00*1.02*1.05*0.99*1.03*1.005*0.96 - 1
    expect(a.cumReturn).toBeCloseTo(0.0735582958849, 9);
  });

  it('复合收益 ≠ 单日涨跌幅之和（简单相加为 7.5%，实际为 7.3558%）', () => {
    const { stats } = run(dataA(), mkRule());
    const a = stats.find((s) => s.sector.id === 'a')!;
    const naiveSum = (1.0 + 4.0 - 3.0 + 0.0 + 2.0 + 5.0 - 1.0 + 3.0 + 0.5 - 4.0) / 100;
    expect(naiveSum).toBeCloseTo(0.075, 10);
    expect(Math.abs(a.cumReturn - naiveSum) > 0.001).toBe(true);
  });

  it('缺失日不参与累乘（板块 p：4 个有效日的复合 = 9.18908%）', () => {
    const { stats } = run(dataB(), mkRule({ windowDays: 6, topN: 1 }));
    const p = stats.find((s) => s.sector.id === 'p')!;
    // 1.01*1.05*0.99*1.04 - 1
    expect(p.cumReturn).toBeCloseTo(0.0918908, 9);
    expect(p.validDays).toBe(4);
    expect(p.coverage).toBeCloseTo(4 / 6, 10);
  });
});

describe('最大回撤（基于净值序列，与收益曲线同源）', () => {
  it('maxDrawdownOf：手算序列 [1,1.2,0.9,1.1] → min(1.1/1.2-1) = -25%', () => {
    expect(maxDrawdownOf([1, 1.2, 0.9, 1.1])).toBeCloseTo(-0.25, 10);
  });

  it('板块 a：最深回撤发生在末段 -4.0%（-3.0% 与 -1.0% 均更浅）', () => {
    const { stats } = run(dataA(), mkRule());
    const a = stats.find((s) => s.sector.id === 'a')!;
    expect(a.maxDrawdown).toBeCloseTo(-0.04, 10);
  });

  it('板块 p：净值在中段回落 1.0% → 最大回撤 -1.0%', () => {
    const { stats } = run(dataB(), mkRule({ windowDays: 6, topN: 1 }));
    const p = stats.find((s) => s.sector.id === 'p')!;
    expect(p.maxDrawdown).toBeCloseTo(-0.01, 10);
  });

  it('收益曲线与最大回撤/累计收益必须同源（回归 P0-2）', () => {
    const rule = mkRule();
    const data = dataA();
    const { comp, stats } = run(data, rule);
    const a = stats.find((s) => s.sector.id === 'a')!;
    const series = comp.series.find((s) => s.sector.id === 'a')!;
    const nav = buildNavSeries(data, comp, series);
    expect(nav.cumReturn).toBeCloseTo(a.cumReturn, 12);
    expect(nav.maxDrawdown).toBeCloseTo(a.maxDrawdown, 12);
    expect(nav.navSector).toHaveLength(comp.dates.length);
  });
});

describe('窗口净值序列 buildNavSeries', () => {
  it('板块 a：净值逐点可核算（1.01 → 1.0504 → …）且末值 - 1 = 累计收益', () => {
    const data = dataA();
    const rule = mkRule();
    const comp = computeWindow(data, rule);
    const series = comp.series.find((s) => s.sector.id === 'a')!;
    const nav = buildNavSeries(data, comp, series);
    expect(nav.dates).toEqual(comp.dates);
    // 逐点净值（手算）：1.01 → 1.0504 → 1.018888 → … → 1.07355829588493
    const expectedNav = [
      1.01, 1.0504, 1.018888, 1.018888, 1.03926576,
      1.091229048, 1.08031675752, 1.1127262602456, 1.11828989154682, 1.07355829588493,
    ];
    expect(nav.navSector).toHaveLength(expectedNav.length);
    expectedNav.forEach((e, i) => expect(nav.navSector[i]).toBeCloseTo(e, 9));
    expect(nav.navSector[nav.navSector.length - 1] - 1).toBeCloseTo(nav.cumReturn, 12);
    expect(nav.validSectorDays).toBe(10);
    expect(nav.benchAvailable).toBe(true);
    expect(nav.validBenchDays).toBe(10);
  });

  it('板块 p（有 2 天缺失）：缺失日沿用前值，但标记 sectorValid=false，长度仍 = 窗口日数', () => {
    const data = dataB();
    const rule = mkRule({ windowDays: 6, topN: 1 });
    const comp = computeWindow(data, rule);
    const series = comp.series.find((s) => s.sector.id === 'p')!;
    const nav = buildNavSeries(data, comp, series);
    expect(nav.navSector).toHaveLength(6);
    expect(nav.sectorValid).toEqual([true, true, false, true, true, false]);
    expect(nav.validSectorDays).toBe(4);
    // 缺失日 d3/d6 沿用前值（不产生回撤、也不当作 0 收益）
    expect(nav.navSector[2]).toBeCloseTo(nav.navSector[1], 12);
    expect(nav.navSector[5]).toBeCloseTo(nav.navSector[4], 12);
    expect(nav.benchValid).toEqual([true, true, false, false, true, true]);
    expect(nav.validBenchDays).toBe(4);
    expect(nav.benchAvailable).toBe(true);
  });
});

describe('相对基准：两种口径必须分别命名（§8.8）', () => {
  it('板块 a 与基准共同有效日 = 10 天：简单超额 6.3634549%、相对净值 6.3009261%', () => {
    const rule = mkRule();
    const data = dataA();
    const { comp } = run(data, rule);
    const series = comp.series.find((s) => s.sector.id === 'a')!;
    const rel = relativeToBench(data, comp, series);
    expect(rel.commonDays).toBe(10);
    // 板块累计 7.355829588493%，基准累计 0.9923746900% → 差 = 6.3634549%
    expect(rel.simple).toBeCloseTo(0.063634549, 9);
    // 1.07355829588 / 1.00992374690 - 1
    expect(rel.netValue).toBeCloseTo(0.063009261, 8);
  });

  it('只在"共同有效日"上复合：板块 p 只有 3 天与基准同时有数据', () => {
    const data = dataB();
    const rule = mkRule({ windowDays: 6, topN: 1 });
    const comp = computeWindow(data, rule);
    const series = comp.series.find((s) => s.sector.id === 'p')!;
    const rel = relativeToBench(data, comp, series);
    // p 有效日 d1,d2,d4,d5；基准有效日 d1,d2,d5,d6 → 交集 d1,d2,d5
    expect(rel.commonDays).toBe(3);
    // 板块: 1.01*1.05*1.04 - 1 = 10.292%；基准: 1.00*1.01*1.02 - 1 = 3.02%
    expect(rel.simple).toBeCloseTo(0.10292 - 0.0302, 12);
    expect(rel.netValue).toBeCloseTo(1.10292 / 1.0302 - 1, 9);
  });

  it('相对基准（简单超额）与 analyzeSector.relStrength 完全一致', () => {
    const rule = mkRule();
    const data = dataA();
    const { comp, stats } = run(data, rule);
    const a = stats.find((s) => s.sector.id === 'a')!;
    const series = comp.series.find((s) => s.sector.id === 'a')!;
    expect(a.relStrength).toBeCloseTo(relativeToBench(data, comp, series).simple!, 12);
  });

  it('基准完全缺失 → 不得伪造：benchAvailable=false、simple/netValue 均为 null', () => {
    const rule = mkRule({ windowDays: 6, topN: 1 });
    const data = dataB(PCT_B_P, [null, null, null, null, null, null]);
    const comp = computeWindow(data, rule);
    const series = comp.series.find((s) => s.sector.id === 'p')!;
    const rel = relativeToBench(data, comp, series);
    expect(rel.commonDays).toBe(0);
    expect(rel.simple).toBeNull();
    expect(rel.netValue).toBeNull();
    const nav = buildNavSeries(data, comp, series);
    expect(nav.benchAvailable).toBe(false);
    expect(nav.validBenchDays).toBe(0);
    // 板块自身累计收益不受基准缺失影响
    expect(nav.cumReturn).toBeCloseTo(0.0918908, 9);
    const p = stats_of(data, rule, 'p');
    expect(p.relStrength).toBeNull();
  });
});

describe('数据补回后统计必须重算（§14 第 14 项）', () => {
  it('把缺失的 d3 补回一个 6.0% → 强势次数 3→4、累计收益随之更新', () => {
    const rule = mkRule({ windowDays: 6, topN: 1 });
    const before = stats_of(dataB(), rule, 'p');
    // 补回 d3 = 6.0%（p 当日排名第 1 且 ≥4% → 新增强势事件）
    const after = stats_of(dataB([1.0, 5.0, 6.0, -1.0, 4.0, null]), rule, 'p');
    expect(before.strongCount).toBe(3);
    expect(after.strongCount).toBe(4);
    expect(after.strongDates).toEqual(['d1', 'd2', 'd3', 'd5']);
    expect(after.validDays).toBe(5);
    expect(after.coverage).toBeCloseTo(5 / 6, 10);
    // 1.01*1.05*1.06*0.99*1.04 - 1
    expect(after.cumReturn).toBeCloseTo(0.157404248, 9);
    // 间隔：下标 [0,1,2,4] → [1,1,2]
    expect(after.gapStrong.gaps).toEqual([1, 1, 2]);
  });
});

/** 取某板块的统计（便于逐条对比） */
function stats_of(data: RotationData, rule: RotationRuleSet, id: string) {
  const comp = computeWindow(data, rule);
  const s = analyzeAll(data, rule, comp).find((x) => x.sector.id === id);
  if (!s) throw new Error(`sector ${id} not found`);
  return s;
}
