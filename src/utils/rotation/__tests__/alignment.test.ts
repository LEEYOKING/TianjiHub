// 窗口对齐 / 摘要-时间轴-明细一致性 / 缺失日 —— 对应任务书 §14 的 10/11/15 与 §6.3、§9.4
// 本文件是 P0-1「索引错位」缺陷的回归测试：修复前这些断言会失败。
import { describe, expect, it } from 'vitest';
import { computeWindow, toWindowView } from '../ruleEngine';
import { analyzeAll } from '../analytics';
import { dataA, dataB, mkRule, PCT_B_P } from './fixtures';

describe('toWindowView：把"按有效日压缩"的序列还原成"按窗口日对齐"', () => {
  it('板块 p（6 天里缺 2 天）：序列长度 4 ≠ 窗口长度 6（这正是错位的根源）', () => {
    const data = dataB();
    const rule = mkRule({ windowDays: 6, topN: 1 });
    const comp = computeWindow(data, rule);
    const series = comp.series.find((s) => s.sector.id === 'p')!;
    expect(comp.dates).toHaveLength(6);
    expect(series.days).toEqual([0, 1, 3, 4]);        // 有效日的全局下标
    expect(series.events).toHaveLength(4);            // ← 被压缩过，不是 6
    expect(series.events[4]).toBeUndefined();         // ← 旧代码按下标 4 取值会取到 undefined
  });

  it('窗口对齐后长度 = 6，缺失日（下标 2、5）为 null，事件日位置与日期严格对应', () => {
    const data = dataB();
    const rule = mkRule({ windowDays: 6, topN: 1 });
    const comp = computeWindow(data, rule);
    const series = comp.series.find((s) => s.sector.id === 'p')!;
    const view = toWindowView(comp, series);

    expect(view.windowLen).toBe(6);
    expect(view.eventAt).toHaveLength(6);
    expect(view.pctAt).toEqual([1, 5, null, -1, 4, null]);
    // 事件日：d1(进榜) d2(进榜+大涨) d5(进榜+大涨)；d4 当日排名第 2、未达阈值 → 无事件
    expect(view.eventAt.map((e) => (e === null ? null : e.strong))).toEqual([true, true, null, false, true, null]);
    expect(view.rankUpAt).toEqual([1, 1, null, null, 1, null]);
  });
});

describe('摘要 / 时间轴 / 事件明细 三处事件数必须一致（§6.3、§14 第 15 项）', () => {
  const cases: { name: string; rule: ReturnType<typeof mkRule>; id: string }[] = [
    { name: '夹具 A 板块 a（覆盖率 100%）', rule: mkRule(), id: 'a' },
    { name: '夹具 B 板块 p（覆盖率 66.7%）', rule: mkRule({ windowDays: 6, topN: 1 }), id: 'p' },
  ];

  cases.forEach(({ name, rule, id }) => {
    it(`${name}：摘要 strongCount = 窗口对齐视图中的强势日数 = 明细 strongDates.length`, () => {
      const data = name.includes('夹具 B') ? dataB() : dataA();
      const comp = computeWindow(data, rule);
      const stats = analyzeAll(data, rule, comp).find((s) => s.sector.id === id)!;
      const series = comp.series.find((s) => s.sector.id === id)!;
      const view = toWindowView(comp, series);

      const viewStrong = view.eventAt.filter((e) => e?.strong === true).length;
      const viewWeak = view.eventAt.filter((e) => e?.weak === true).length;

      expect(viewStrong).toBe(stats.strongCount);
      expect(viewWeak).toBe(stats.weakCount);
      expect(stats.strongDates).toHaveLength(stats.strongCount);
      expect(stats.weakDates).toHaveLength(stats.weakCount);
      // 时间轴色块总数 = 窗口交易日数（缺失日以 null 呈现，不当作"无事件日"）
      expect(view.eventAt).toHaveLength(comp.dates.length);
      expect(view.eventAt.filter((e) => e === null)).toHaveLength(comp.dates.length - stats.validDays);
    });
  });

  it('事件日期与窗口日期一一对应：强势日下标集合 = strongDates 在 dates 中的下标', () => {
    const data = dataA();
    const rule = mkRule();
    const comp = computeWindow(data, rule);
    const stats = analyzeAll(data, rule, comp).find((s) => s.sector.id === 'a')!;
    const series = comp.series.find((s) => s.sector.id === 'a')!;
    const view = toWindowView(comp, series);

    const idxFromView = view.eventAt.map((e, i) => (e?.strong ? comp.dates[i] : null)).filter(Boolean);
    expect(idxFromView).toEqual(stats.strongDates);
  });
});

describe('缺失交易日不被当作 0 涨跌幅（§9.1）', () => {
  it('缺失日既不计入有效日，也不进榜：d3/d6 无数据时 p 的涨幅榜排名为 null', () => {
    const data = dataB();
    const rule = mkRule({ windowDays: 6, topN: 1 });
    const comp = computeWindow(data, rule);
    const p = analyzeAll(data, rule, comp).find((s) => s.sector.id === 'p')!;

    expect(p.validDays).toBe(4);
    expect(p.coverage).toBeCloseTo(4 / 6, 10);
    // 强势频率的分母是"有效交易日数"，不是窗口长度
    expect(p.strongFreq).toBeCloseTo(3 / 4, 10);
  });

  it('把缺失日当成 0 会算出完全不同的累计收益（说明为什么不能这么干）', () => {
    const rule = mkRule({ windowDays: 6, topN: 1 });
    const data = dataB();
    const p = analyzeAll(data, rule, computeWindow(data, rule)).find((s) => s.sector.id === 'p')!;
    // 正确口径：跳过缺失日 → 1.01*1.05*0.99*1.04 - 1
    expect(p.cumReturn).toBeCloseTo(0.0918908, 9);
    // 错误口径（把缺失日当 0 收益）→ 结果相同（0 收益不改乘数）但有效日会被算成 6 天、覆盖率变 100%
    expect(p.coverage).toBeLessThan(1);
    expect(PCT_B_P.filter((v) => v === null)).toHaveLength(2);
  });

  it('板块数据不完整不会污染其它板块的排名（q 在 d3 仍然是唯一入榜者）', () => {
    const data = dataB();
    const rule = mkRule({ windowDays: 6, topN: 1 });
    const comp = computeWindow(data, rule);
    expect(comp.ranking[2].total).toBe(1);
    expect(comp.ranking[2].ranked[0].id).toBe('q');
  });
});
