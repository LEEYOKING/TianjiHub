// 观察清单（V2.0 阶段 6，任务书 §10 / §14 第 20、21 项）—— 纯函数测试
// 与规则方案同构：存档解析健壮性 + 增删 + 上限；另含「自加入以来」区间统计（与全窗口同源）。
import { describe, expect, it } from 'vitest';
import { computeWindow } from '../ruleEngine';
import { analyzeAll, sinceStatsOf } from '../analytics';
import {
  WATCH_LIMIT,
  addWatch,
  inWatchlist,
  parseWatchlist,
  removeWatch,
  serializeWatchlist,
} from '../../../data/watchlist';
import { dataA, mkRule } from './fixtures';

const SEC = (id: string, name: string) => ({ id, name });

describe('观察清单存档：parseWatchlist 的健壮性（§14 第 21 项：刷新后状态）', () => {
  it('空 / 非法输入 → 空数组（不抛异常）', () => {
    expect(parseWatchlist(null)).toEqual([]);
    expect(parseWatchlist('')).toEqual([]);
    expect(parseWatchlist(undefined)).toEqual([]);
    expect(parseWatchlist('不是JSON')).toEqual([]);
    expect(parseWatchlist('{"a":1}')).toEqual([]);
  });

  it('缺 id / name 的条目被丢弃；空白名称也被丢弃', () => {
    const raw = JSON.stringify([
      { id: 'a', name: '甲', addedAt: '2026-10-15', basisDate: '2026-10-13' },
      { name: '缺id' },
      { id: 'noName' },
      { id: 'c', name: '   ' },
    ]);
    const out = parseWatchlist(raw);
    expect(out.map((w) => w.id)).toEqual(['a']);
    expect(out[0]).toEqual({ id: 'a', name: '甲', addedAt: '2026-10-15', basisDate: '2026-10-13' });
  });

  it('同一板块重复 → 保留最后一条（重新加入）', () => {
    const raw = JSON.stringify([
      { id: 'a', name: '甲', addedAt: '2026-10-01', basisDate: '2026-09-30' },
      { id: 'a', name: '甲', addedAt: '2026-10-15', basisDate: '2026-10-13' },
    ]);
    const out = parseWatchlist(raw);
    expect(out).toHaveLength(1);
    expect(out[0].addedAt).toBe('2026-10-15');
    expect(out[0].basisDate).toBe('2026-10-13');
  });

  it('超过上限只保留最新的一批', () => {
    const raw = JSON.stringify(
      Array.from({ length: WATCH_LIMIT + 3 }, (_, i) => ({ id: `s${i}`, name: `板块${i}`, addedAt: 'x', basisDate: 'y' })),
    );
    const out = parseWatchlist(raw);
    expect(out).toHaveLength(WATCH_LIMIT);
    expect(out[0].id).toBe('s3');
    expect(out[out.length - 1].id).toBe(`s${WATCH_LIMIT + 2}`);
  });

  it('序列化往返一致（写入 → 读回＝刷新后状态不变）', () => {
    let list = addWatch([], SEC('a', '甲'), '2026-10-13', '2026-10-15');
    list = addWatch(list, SEC('b', '乙'), '2026-10-13', '2026-10-15');
    expect(parseWatchlist(serializeWatchlist(list))).toEqual(list);
  });
});

describe('观察清单：加入 / 移除 / 判定', () => {
  it('addWatch 追加；重复加入同一板块不会产生两条', () => {
    let list = addWatch([], SEC('a', '甲'), '2026-10-13', '2026-10-15');
    expect(list.map((w) => w.id)).toEqual(['a']);
    list = addWatch(list, SEC('a', '甲'), '2026-10-14', '2026-10-16');
    expect(list).toHaveLength(1);
    expect(list[0].basisDate).toBe('2026-10-14');
  });

  it('addWatch 对缺 id/name 的输入不生效', () => {
    expect(addWatch([], SEC('', '甲'), 'd', 'n')).toEqual([]);
    expect(addWatch([], SEC('a', ''), 'd', 'n')).toEqual([]);
  });

  it('addWatch 超过上限时丢弃最早的', () => {
    let list: ReturnType<typeof parseWatchlist> = [];
    for (let i = 0; i < WATCH_LIMIT + 2; i++) list = addWatch(list, SEC(`s${i}`, `板块${i}`), 'y', 'x');
    expect(list).toHaveLength(WATCH_LIMIT);
    expect(list[0].id).toBe('s2');
  });

  it('removeWatch 按 id 删除；不存在 id 不改变列表；inWatchlist 判定正确', () => {
    const list = addWatch(addWatch([], SEC('a', '甲'), 'y', 'x'), SEC('b', '乙'), 'y', 'x');
    expect(removeWatch(list, 'a').map((w) => w.id)).toEqual(['b']);
    expect(removeWatch(list, 'zzz')).toEqual(list);
    expect(inWatchlist(list, 'a')).toBe(true);
    expect(inWatchlist(list, 'zzz')).toBe(false);
  });
});

describe('sinceStatsOf：「自加入以来」区间统计（与全窗口口径同源）', () => {
  // 夹具 A：10 个交易日 d1..d10；板块 a 强势日 = d2/d5/d6/d8，弱势日 = d3/d4/d7/d10
  // 从 d5 起算（窗口内第 5 列，index 4）：区间 = d5 d6 d7 d8 d9 d10
  //   a 的 pct：2.0, 5.0, -1.0, 3.0, 0.5, -4.0 → 复合 = 1.02*1.05*0.99*1.03*1.005*0.96 - 1
  //   区间强势 = d5 d6 d8 → 3；区间弱势 = d7（当日跌幅榜第 2，进跌幅榜）与 d10（-4.0 ≤ -3）→ 2
  it('从 d5 起算：有效 6 天、复合收益手算值、强势 3 次 / 弱势 2 次', () => {
    const data = dataA();
    const rule = mkRule();
    const comp = computeWindow(data, rule);
    const series = comp.series.find((s) => s.sector.id === 'a')!;
    const since = sinceStatsOf(data, comp, series, 'd5');

    expect(since.truncated).toBe(false);
    expect(since.fromWi).toBe(4);
    expect(since.fromDate).toBe('d5');
    expect(since.days).toBe(6);
    expect(since.strongCount).toBe(3);
    expect(since.weakCount).toBe(2);
    expect(since.cumReturn).toBeCloseTo(1.02 * 1.05 * 0.99 * 1.03 * 1.005 * 0.96 - 1, 10);
    expect(since.lastEventDate).toBe('d10');   // 区间内最后一个事件日（d10 为弱势事件）
  });

  it('从窗口首日 d1 起算 → 与全窗口统计完全一致（同一套口径）', () => {
    const data = dataA();
    const rule = mkRule();
    const comp = computeWindow(data, rule);
    const series = comp.series.find((s) => s.sector.id === 'a')!;
    const stats = analyzeAll(data, rule, comp).find((s) => s.sector.id === 'a')!;
    const since = sinceStatsOf(data, comp, series, 'd1');

    expect(since.fromWi).toBe(0);
    expect(since.truncated).toBe(false);
    expect(since.days).toBe(stats.validDays);
    expect(since.strongCount).toBe(stats.strongCount);
    expect(since.weakCount).toBe(stats.weakCount);
    expect(since.cumReturn).toBeCloseTo(stats.cumReturn, 12);
    expect(since.rel).toBeCloseTo(stats.relStrength!, 12);
  });

  it('基准日早于窗口起点 / 不在日期表里 → 截断到窗口起点并置 truncated', () => {
    const data = dataA();
    const rule = mkRule({ windowDays: 5 });          // 窗口 = d6..d10
    const comp = computeWindow(data, rule);
    const series = comp.series.find((s) => s.sector.id === 'a')!;

    const early = sinceStatsOf(data, comp, series, 'd2');       // d2 早于窗口起点 d6
    expect(early.truncated).toBe(true);
    expect(early.fromWi).toBe(0);
    expect(early.fromDate).toBe('d6');

    const unknown = sinceStatsOf(data, comp, series, '不存在');  // 不在日期表里
    expect(unknown.truncated).toBe(true);
    expect(unknown.fromWi).toBe(0);
  });

  it('区间内无任何有效交易日 → 累计收益为 null（不伪造 0）', () => {
    const data = dataA();
    const rule = mkRule({ windowDays: 1 });          // 窗口只有 d10
    const comp = computeWindow(data, rule);
    // 用一个窗口内无数据的板块做边界：临时把某板块的窗口内数据置空
    const series = comp.series.find((s) => s.sector.id === 'a')!;
    const clone = { ...series, days: [], pctInWindow: [], events: [], rankUpOn: [], rankDownOn: [] };
    const since = sinceStatsOf(data, comp, clone, 'd10');
    expect(since.days).toBe(0);
    expect(since.cumReturn).toBeNull();
    expect(since.rel).toBeNull();
  });
});
