// 详情页（V2.0 阶段 4）—— 纯函数测试：五段式行为总结 + 单板块同步活跃伙伴
// 约定：预期值全部手算给出（沿用阶段 2/3 的纪律），不用快照、不用实现回填。
import { describe, expect, it } from 'vitest';
import { computeWindow } from '../ruleEngine';
import { analyzeAll, buildNavSeries, summarizeBehavior } from '../analytics';
import { computeSectorPeers, computeSyncPairs } from '../relations';
import { dataA, dataC, mkRule, ruleC } from './fixtures';

function runA() {
  const data = dataA();
  const rule = mkRule();               // 窗口 10 / TOP2 / 大涨≥4% / 大跌≤-3% / OR / 冷却 0
  const comp = computeWindow(data, rule);
  const stats = analyzeAll(data, rule, comp);
  const series = comp.series.find((s) => s.sector.id === 'a')!;
  return { data, rule, comp, stats, series, nav: buildNavSeries(data, comp, series) };
}

describe('summarizeBehavior：五段式（历史行为 / 活跃模式 / 收益与风险 / 统计局限 / 后续观察）', () => {
  it('夹具 A 板块 a：五段内容与手算数字一致', () => {
    const { rule, nav, stats } = runA();
    const a = stats.find((s) => s.sector.id === 'a')!;
    const s = summarizeBehavior(a, rule, { benchAvailable: nav.benchAvailable, benchmark: '沪深300' });

    // A. 历史行为：强势 4 次、弱势 4 次；大涨（≥4%）2 次、大跌（≤-3%）2 次
    expect(s.history[0]).toContain('过去 10 个有效交易日内');
    expect(s.history[0]).toContain('强势事件 4 次、弱势事件 4 次');
    expect(s.history[0]).toContain('大涨事件 2 次、大跌事件 2 次');
    expect(s.history[1]).toContain('40.0%');

    // B. 活跃模式：冷却 0 → 每个事件日各自成簇 = 4 个周期；最长连续 2 天；最近一次 2 日前
    expect(s.activity.some((l) => l.includes('分散在 4 个独立活跃周期中'))).toBe(true);
    expect(s.activity.some((l) => l.includes('未设冷却期合并'))).toBe(true);
    expect(s.activity.some((l) => l.includes('当前不处于连续强势；窗口内最长连续 2 天'))).toBe(true);
    expect(s.activity.some((l) => l.includes('最近一次强势事件在 2 个交易日前'))).toBe(true);
    // 间隔 [3,1,2] → 3 个样本 < 4 → 不给"平均间隔"结论
    expect(s.activity.some((l) => l.includes('仅 3 个间隔样本'))).toBe(true);

    // C. 收益与风险：复合 7.36% / 简单超额 +6.36% / 最大回撤 -4.00%
    expect(s.returnRisk[0]).toContain('7.36%');
    expect(s.returnRisk[1]).toContain('相对 沪深300 超额 6.36%');
    expect(s.returnRisk[1]).toContain('简单超额口径');
    expect(s.returnRisk[2]).toContain('-4.00%');

    // D. 统计局限：覆盖率 100%、间隔样本 3 个
    expect(s.limits[0]).toContain('100.0%');
    expect(s.limits[1]).toContain('间隔样本 3 个');
    expect(s.limits[1]).toContain('少于 4 个');
    expect(s.limits[2]).toContain('基准在窗口内有可用行情');

    // E. 后续观察：只给可验证条件，无预测性表述
    expect(s.nextSteps[0]).toContain('进入涨幅 TOP 2 或涨幅 ≥ 4%');
    const all = [...s.history, ...s.activity, ...s.returnRisk, ...s.limits, ...s.nextSteps].join('');
    expect(all).not.toMatch(/必然|即将|一定会|肯定/);
  });

  it('无强势事件 → 活跃模式明确说明"未出现强势事件"', () => {
    const data = dataC([0.5, 0.5, 0.5]);        // 关闭进榜条件、阈值 ±5% → 无事件
    const rule = ruleC();
    const comp = computeWindow(data, rule);
    const stats = analyzeAll(data, rule, comp)[0];
    const s = summarizeBehavior(stats, rule, { benchAvailable: true });
    expect(s.activity).toEqual(['窗口内未出现强势事件，暂不构成强势活跃形态。']);
    expect(s.history[0]).toContain('强势事件 0 次');
  });

  it('基准不可用 → 收益段明确"无法计算"，不伪造；局限段说明相对表现模块不可用', () => {
    const data = dataC([1.0, 2.0], [null, null]);
    const rule = ruleC();
    const comp = computeWindow(data, rule);
    const stats = analyzeAll(data, rule, comp)[0];
    const nav = buildNavSeries(data, comp, comp.series[0]);
    const s = summarizeBehavior(stats, rule, { benchAvailable: nav.benchAvailable });
    expect(nav.benchAvailable).toBe(false);
    expect(s.returnRisk[1]).toContain('无法计算');
    expect(s.limits[2]).toContain('整体不可用');
  });
});

describe('computeSectorPeers：单板块的同步活跃伙伴（口径与 computeSyncPairs 一致）', () => {
  // 手算（夹具 A，窗口 10 天，TOP2 / 大涨≥4% / OR）：
  //   a 的强势日：d2 d5 d6 d8 → targetDays = 4
  //   b：d1 d2 d3 d4 d7 d8 d9 d10（8 天，d6 被 a/e 挤掉且未达 4%）→ 与 a 共现 d2 d8 → co 2
  //   d：d1 d3 d5 d7 d9（5 天，d4 与 b 并列 1.0% 按 id 升序被 b 挤到第 3）→ 与 a 共现 d5 → co 1
  //   e：d6 d10（2 天）→ 与 a 共现 d6 → co 1
  //   c：窗口内从未走强 → co 0
  it('minCoDays=1：b(co2) 与 e(co1) 的 Jaccard 同为 0.20，按 coDays 降序 → b 在前；d 最后', () => {
    const { comp, stats } = runA();
    const peers = computeSectorPeers(comp, stats, 'a', { minCoDays: 1, limit: 10 });
    expect(peers.map((p) => p.peer.id)).toEqual(['b', 'e', 'd']);

    expect(peers[0].peer).toEqual({ id: 'b', name: '乙板块' });
    expect(peers[0]).toMatchObject({ coDays: 2, targetDays: 4, peerDays: 8 });
    // jaccard = 2 / (4+8−2) = 0.20；lift = 2 / (4×8/10) = 0.625
    expect(peers[0].jaccard).toBeCloseTo(0.2, 10);
    expect(peers[0].lift).toBeCloseTo(0.625, 10);

    expect(peers[1].peer).toEqual({ id: 'e', name: '戊板块' });
    expect(peers[1]).toMatchObject({ coDays: 1, peerDays: 2 });
    // jaccard = 1 / (4+2−1) = 0.20（与 b 相同，故用 coDays 降序破平）；lift = 1 / (4×2/10) = 1.25
    expect(peers[1].jaccard).toBeCloseTo(0.2, 10);
    expect(peers[1].lift).toBeCloseTo(1.25, 10);

    expect(peers[2].peer).toEqual({ id: 'd', name: '丁板块' });
    expect(peers[2]).toMatchObject({ coDays: 1, peerDays: 5 });
    // jaccard = 1 / (4+5−1) = 1/8
    expect(peers[2].jaccard).toBeCloseTo(1 / 8, 10);
  });

  it('minCoDays=2 → 只剩 co=2 的 b；minCoDays=3 → 空（没有板块与 a 共现 ≥ 3 天）', () => {
    const { comp, stats } = runA();
    expect(computeSectorPeers(comp, stats, 'a', { minCoDays: 2 }).map((p) => p.peer.id)).toEqual(['b']);
    expect(computeSectorPeers(comp, stats, 'a', { minCoDays: 3 })).toEqual([]);
  });

  it('窗口内从未走强的板块 → 空结果；未知 id → 空结果', () => {
    const { comp, stats } = runA();
    expect(computeSectorPeers(comp, stats, 'c')).toEqual([]);
    expect(computeSectorPeers(comp, stats, '不存在的id')).toEqual([]);
  });

  it('与 computeSyncPairs 的结果逐条一致（证明两处口径没有分叉）', () => {
    const { comp, stats } = runA();
    const peers = computeSectorPeers(comp, stats, 'a', { minCoDays: 1, limit: 100 });
    const syncAll = computeSyncPairs(comp, stats, { minCoDays: 1, limit: 100 });
    const key = (x: { id: string; coDays: number }) => `${x.id}:${x.coDays}`;
    const fromPeers = peers.map((p) => key({ id: p.peer.id, coDays: p.coDays })).sort();
    const fromSync = syncAll
      .filter((p) => p.a.id === 'a' || p.b.id === 'a')
      .map((p) => key({ id: p.a.id === 'a' ? p.b.id : p.a.id, coDays: p.coDays }))
      .sort();
    expect(fromPeers).toEqual(fromSync);
  });
});
