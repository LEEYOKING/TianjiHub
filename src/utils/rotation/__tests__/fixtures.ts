// 板块轮动 · 测试夹具（手工可核算的极小数据集）
// 约定：
//  · 日期用 d1..dN 这类短标记，便于"第 i 天 ↔ 下标 i-1"直接对照；
//  · 所有预期值都由测试文件**手算给出**，不用快照、不跑实现回填（任务书 §1.4）。
import type { RotationData, RotationRuleSet, RotationSector, SectorType } from '../types';
import { DEFAULT_RULE } from '../types';

/** 造一个板块；coverage 由 pct 中非 null 的比例算出 */
export function mkSector(
  id: string,
  name: string,
  pct: (number | null)[],
  type: SectorType = 'industry',
): RotationSector {
  const valid = pct.filter((v) => v !== null).length;
  return { id, name, type, pct, amt: pct.map(() => null), coverage: pct.length > 0 ? valid / pct.length : 0 };
}

export function mkData(dates: string[], bench: (number | null)[], sectors: RotationSector[]): RotationData {
  return {
    meta: {
      lastTradeDate: dates[dates.length - 1],
      windowDays: dates.length,
      sectorCount: sectors.length,
      benchmark: '沪深300',
    },
    dates,
    bench,
    sectors,
  };
}

/** 规则：窗口 10 天 / TOP2 / 大涨≥4% / 大跌≤-3% / OR / 冷却不合并 / 关注间隔 1~5 */
export function mkRule(over: Partial<RotationRuleSet> = {}): RotationRuleSet {
  return { ...DEFAULT_RULE, windowDays: 10, topN: 2, riseThreshold: 4, fallThreshold: 3, ...over };
}

// ============ 夹具 A：10 个交易日 × 5 个板块 ============
// 用于事件判定 / 间隔 / 独立簇 / 收益与回撤口径。每个预期值都在测试里手算。
export const DATES_A = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10'];

/** 核心样本板块 a 的逐日涨跌幅(%) */
export const PCT_A = [1.0, 4.0, -3.0, 0.0, 2.0, 5.0, -1.0, 3.0, 0.5, -4.0];

/** 基准（沪深300）逐日涨跌幅(%) */
export const BENCH_A = [0.5, 0.5, -1.0, 0.0, 0.5, 0.5, 0.0, 0.5, 0.0, -0.5];

export function dataA(over: { pctA?: (number | null)[]; bench?: (number | null)[] } = {}): RotationData {
  return mkData(DATES_A, over.bench ?? BENCH_A, [
    mkSector('a', '甲板块', over.pctA ?? PCT_A),
    mkSector('b', '乙板块', [2.0, 1.0, 2.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]),
    mkSector('c', '丙板块', [-1.0, -2.0, -1.0, 2.0, -2.5, -1.0, 0.5, -1.0, -2.0, -1.0]),
    mkSector('d', '丁板块', [3.0, 0.0, 1.0, 1.0, 4.0, -3.0, 2.0, 0.0, 1.0, 0.0]),
    mkSector('e', '戊板块', [0.0, -1.0, 0.5, -0.5, 0.0, 2.0, -2.0, 1.0, -0.5, 2.0]),
  ]);
}

// ============ 夹具 B：6 个交易日 / 板块 p 有 2 天缺失 ============
// 用于"缺失交易日""数据补回""窗口对齐"与"基准缺失"。
export const DATES_B = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];

/** 板块 p：d3 / d6 无数据 → 有效率 4/6 = 0.667 */
export const PCT_B_P = [1.0, 5.0, null, -1.0, 4.0, null];

/** 基准：d3 / d4 无数据 */
export const BENCH_B = [0, 1, null, null, 2, 1];

export function dataB(pctP: (number | null)[] = PCT_B_P, bench: (number | null)[] = BENCH_B): RotationData {
  return mkData(DATES_B, bench, [
    mkSector('p', '甲板块', pctP),
    mkSector('q', '乙板块', [0.0, 1.0, 1.0, 1.0, 1.0, 1.0]),
  ]);
}

// ============ 夹具 C：单板块 / 榜单条件关闭 ============
// 用于"无事件""只有一个事件""连续事件"三个边界（此时排名条件不参与，只看绝对阈值）。
export function dataC(pct: (number | null)[], bench: (number | null)[] = pct.map(() => 0)): RotationData {
  const dates = pct.map((_, i) => `d${i + 1}`);
  return mkData(dates, bench, [mkSector('a', '甲板块', pct)]);
}

/** 夹具 C 的规则：关闭进榜条件，只看绝对阈值（大涨≥5% / 大跌≤-5%） */
export function ruleC(over: Partial<RotationRuleSet> = {}): RotationRuleSet {
  return mkRule({
    topN: 1,
    riseRankEnabled: false,
    fallRankEnabled: false,
    riseThreshold: 5,
    fallThreshold: 5,
    ...over,
  });
}
