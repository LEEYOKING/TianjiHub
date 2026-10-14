// 事件判定 / 榜单 / AND-OR 组合 —— 对应任务书 §14 的 1/2/3/6/7 与 §8.2、§7.3
// 全部预期值手算给出，见每个断言上方的推导注释。
import { describe, expect, it } from 'vitest';
import { computeWindow, toWindowView } from '../ruleEngine';
import { analyzeAll } from '../analytics';
import type { RotationData, RotationRuleSet } from '../types';
import { dataA, dataB, dataC, mkRule, ruleC } from './fixtures';

function run(data: RotationData, rule: RotationRuleSet) {
  const comp = computeWindow(data, rule);
  const stats = analyzeAll(data, rule, comp);
  return { comp, stats, byId: new Map(stats.map((s) => [s.sector.id, s])) };
}

/** 取某板块"窗口对齐"的逐日事件（长度一定 = 窗口交易日数） */
function dayEvents(data: RotationData, rule: RotationRuleSet, id: string) {
  const comp = computeWindow(data, rule);
  const s = comp.series.find((x) => x.sector.id === id)!;
  return toWindowView(comp, s).eventAt;
}

describe('每日榜单：降序 + 并列按板块 id 升序（稳定排序）', () => {
  it('d4 出现并列 1.0%（b 与 d）→ 按 id 升序 b 在前；TOP2 = c,b', () => {
    const { comp } = run(dataA(), mkRule());
    // d4 全部涨跌幅: c=2.0, b=1.0, d=1.0, a=0.0, e=-0.5
    expect(comp.ranking[3].ranked.map((r) => r.id)).toEqual(['c', 'b', 'd', 'a', 'e']);
    expect(comp.ranking[3].ranked.slice(0, 2).map((r) => r.id)).toEqual(['c', 'b']);
    expect(comp.ranking[3].ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it('d8 出现并列 1.0%（b 与 e）→ 按 id 升序 b 在前', () => {
    const { comp } = run(dataA(), mkRule());
    // d8: a=3.0, e=1.0, b=1.0, d=0.0, c=-1.0
    expect(comp.ranking[7].ranked.map((r) => r.id)).toEqual(['a', 'b', 'e', 'd', 'c']);
  });

  it('无数据的当日不参与排名（fixture B 的 d3 只有 q 一个板块）', () => {
    const { comp } = run(dataB(), mkRule({ windowDays: 6, topN: 1 }));
    expect(comp.ranking[2].total).toBe(1);
    expect(comp.ranking[2].ranked.map((r) => r.id)).toEqual(['q']);
  });

  it('同样输入跑两次结果完全一致（可复现）', () => {
    const a = run(dataA(), mkRule());
    const b = run(dataA(), mkRule());
    expect(JSON.stringify(a.comp.ranking)).toBe(JSON.stringify(b.comp.ranking));
  });
});

describe('事件判定：强势/弱势/大涨/大跌 四类各自独立', () => {
  // 手算板块 a（TOP2 / 大涨≥4% / 大跌≤-3% / OR）逐日结果：
  //   d1 1.0  : 进榜?否 大涨?否 → 强势否 | 弱势?否 大跌?否 → 弱势否
  //   d2 4.0  : 进榜?是(1) 大涨?是 → 强势是 | 弱势否
  //   d3 -3.0 : 强势否 | 弱势?是(倒数1) 大跌?是 → 弱势是
  //   d4 0.0  : 强势否 | 弱势?是(倒数2) 大跌?否 → 弱势是
  //   d5 2.0  : 进榜?是(2) 大涨?否 → 强势是(OR) | 弱势否
  //   d6 5.0  : 进榜?是(1) 大涨?是 → 强势是 | 弱势否
  //   d7 -1.0 : 强势否 | 弱势?是(倒数2) 大跌?否 → 弱势是
  //   d8 3.0  : 进榜?是(1) 大涨?否 → 强势是(OR) | 弱势否
  //   d9 0.5  : 强势否 | 弱势否
  //   d10 -4.0: 强势否 | 弱势?是(倒数1) 大跌?是 → 弱势是
  const expected = [
    { rankUp: false, largeUp: false, strong: false, rankDown: false, largeDown: false, weak: false },
    { rankUp: true, largeUp: true, strong: true, rankDown: false, largeDown: false, weak: false },
    { rankUp: false, largeUp: false, strong: false, rankDown: true, largeDown: true, weak: true },
    { rankUp: false, largeUp: false, strong: false, rankDown: true, largeDown: false, weak: true },
    { rankUp: true, largeUp: false, strong: true, rankDown: false, largeDown: false, weak: false },
    { rankUp: true, largeUp: true, strong: true, rankDown: false, largeDown: false, weak: false },
    { rankUp: false, largeUp: false, strong: false, rankDown: true, largeDown: false, weak: true },
    { rankUp: true, largeUp: false, strong: true, rankDown: false, largeDown: false, weak: false },
    { rankUp: false, largeUp: false, strong: false, rankDown: false, largeDown: false, weak: false },
    { rankUp: false, largeUp: false, strong: false, rankDown: true, largeDown: true, weak: true },
  ];

  it('OR 组合下逐日 6 个标志位全部吻合手算', () => {
    const ev = dayEvents(dataA(), mkRule(), 'a');
    expect(ev).toHaveLength(10);
    expected.forEach((exp, i) => {
      const got = ev[i]!;
      expect({
        rankUp: got.rankUp, largeUp: got.largeUp, strong: got.strong,
        rankDown: got.rankDown, largeDown: got.largeDown, weak: got.weak,
      }).toEqual(exp);
    });
  });

  it('OR 组合下的计数：强势 4 次 / 弱势 4 次 / 大涨 2 次 / 大跌 2 次', () => {
    const { byId } = run(dataA(), mkRule());
    const a = byId.get('a')!;
    // 强势日 = d2,d5,d6,d8（4 次）；弱势日 = d3,d4,d7,d10（4 次）
    expect(a.strongCount).toBe(4);
    expect(a.weakCount).toBe(4);
    // 大涨日 = d2(4.0), d6(5.0)（2 次，与是否进榜无关）；大跌日 = d3(-3.0), d10(-4.0)（2 次）
    expect(a.largeUpCount).toBe(2);
    expect(a.largeDownCount).toBe(2);
    expect(a.strongDates).toEqual(['d2', 'd5', 'd6', 'd8']);
    expect(a.weakDates).toEqual(['d3', 'd4', 'd7', 'd10']);
  });

  it('切成 AND（同时满足）后：强势 2 次（仅 d2/d6），但大涨事件仍为 2 次', () => {
    const { byId } = run(dataA(), mkRule({ eventLogic: 'AND' }));
    const a = byId.get('a')!;
    expect(a.strongCount).toBe(2);      // rankUp ∧ largeUp → 只有 d2(4.0) 与 d6(5.0)
    expect(a.strongDates).toEqual(['d2', 'd6']);
    expect(a.largeUpCount).toBe(2);     // 大涨事件口径不受组合方式影响（§7.3）
    // 弱势同理：rankDown ∧ largeDown → d3（倒数1 且 -3.0）与 d10（倒数1 且 -4.0）
    expect(a.weakCount).toBe(2);
    expect(a.weakDates).toEqual(['d3', 'd10']);
    expect(a.largeDownCount).toBe(2);
  });

  it('关闭"进涨幅榜"条件后：强势次数 == 大涨次数（只看绝对阈值）', () => {
    const { byId } = run(dataA(), mkRule({ riseRankEnabled: false }));
    const a = byId.get('a')!;
    expect(a.strongCount).toBe(2);
    expect(a.strongCount).toBe(a.largeUpCount);
  });

  it('两个条件都未启用 → 强势/弱势事件必为 0（阈值 0 属非法参数，见下方说明）', () => {
    const { byId } = run(dataA(), mkRule({ riseRankEnabled: false, riseThreshold: 0, fallRankEnabled: false, fallThreshold: 0 }));
    const a = byId.get('a')!;
    // combineEvent：两个条件都没启用时直接返回 false
    expect(a.strongCount).toBe(0);
    expect(a.weakCount).toBe(0);
    expect(a.strongDates).toEqual([]);
    expect(a.weakDates).toEqual([]);
    // ⚠ 口径说明：大涨/大跌"标志位"是按绝对阈值独立计算的（§8.2），阈值置 0 时
    //   "涨幅 ≥ 0%" 恒成立 → 大涨事件日会被算成 7 天。这属于非法参数，
    //   任务书 §7.6 要求「大涨阈值必须 > 0」，将由阶段 5 的配置器校验拦截
    //   （当前滑块 min=0.5，UI 上无法产生 0，故不是线上问题）。
    expect(a.largeUpCount).toBe(7);   // pct >= 0 的天数：d1,d2,d4,d5,d6,d8,d9
    expect(a.largeDownCount).toBe(4); // pct <= 0 的天数：d3(-3.0), d4(0.0), d7(-1.0), d10(-4.0)
  });

  it('TOP N 从 2 放宽到 4：强势次数 4→8，但大涨事件次数仍为 2（§7.3 关键断言）', () => {
    const { byId } = run(dataA(), mkRule({ topN: 4 }));
    const a = byId.get('a')!;
    // topN=4 时 a 进榜的日为 d1,d2,d4,d5,d6,d7,d8,d9 共 8 天（d3/d10 排名第 5 之外）
    expect(a.strongCount).toBe(8);
    expect(a.largeUpCount).toBe(2);
  });
});

describe('边界：无事件 / 只有一个事件 / 连续事件', () => {
  it('无任何事件：计数全 0、间隔统计为"样本不足"而不是 0', () => {
    const data = dataC([0.1, -0.2, 0.3, 0.0, 0.2]);
    const { byId } = run(data, ruleC({ windowDays: 5 }));
    const a = byId.get('a')!;
    expect(a.strongCount).toBe(0);
    expect(a.weakCount).toBe(0);
    expect(a.strongDates).toEqual([]);
    expect(a.clustersStrong).toEqual([]);
    expect(a.lastStrongAgo).toBeNull();
    // §8.3：事件不足两个时，间隔统计必须是 null / 样本不足，不能默认为 0
    expect(a.gapStrong.count).toBe(0);
    expect(a.gapStrong.avg).toBeNull();
    expect(a.gapStrong.median).toBeNull();
    expect(a.gapStrong.empties).toEqual([]);
    expect(a.gapStrong.sampleInsufficient).toBe(true);
  });

  it('只有一个事件：计 1 次、无间隔、距今天数 = 窗口末 - 事件日', () => {
    const data = dataC([0.1, 6.0, 0.2, 0.3, 0.1]);
    const { byId, comp } = run(data, ruleC({ windowDays: 5 }));
    const a = byId.get('a')!;
    expect(a.strongCount).toBe(1);
    expect(a.strongDates).toEqual(['d2']);
    // 事件在下标 1、窗口末下标 4 → 距今 3 个交易日步长
    expect(a.lastStrongAgo).toBe(3);
    expect(a.gapStrong.count).toBe(0);
    expect(a.clustersStrong).toHaveLength(1);
    expect(a.clustersStrong[0].days).toBe(1);
    expect(a.clustersStrong[0].startDate).toBe('d2');
    expect(a.clustersStrong[0].endDate).toBe('d2');
    // 窗口对齐视图下事件数必须与摘要一致（回归 P0-1 索引错位）
    const view = toWindowView(comp, comp.series[0]);
    expect(view.eventAt.filter((e) => e?.strong === true).length).toBe(a.strongCount);
  });

  it('连续 3 个交易日强势：当前连续 3、历史最长 3、间隔各为 1 → 空档各为 0', () => {
    const data = dataC([0.1, 0.2, 6.0, 7.0, 8.0]);
    const { byId } = run(data, ruleC({ windowDays: 5 }));
    const a = byId.get('a')!;
    expect(a.strongCount).toBe(3);
    expect(a.currentStrongStreak).toBe(3);
    expect(a.longestStrongStreak).toBe(3);
    // d3,d4,d5 → 相邻事件间隔 [1,1]
    expect(a.gapStrong.gaps).toEqual([1, 1]);
    expect(a.gapStrong.avg).toBe(1);
    // §8.3：空档交易日数 empty_i = gap_i - 1
    expect(a.gapStrong.empties).toEqual([0, 0]);
    expect(a.gapStrong.avgEmpty).toBe(0);
    // 冷却期 0 → 相邻事件日各自成簇（1 <= 0 不成立）
    expect(a.clustersStrong).toHaveLength(3);
  });
});
