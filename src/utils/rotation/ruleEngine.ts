// 板块轮动 · 规则引擎
// 职责：把原始列式数据 + 规则集，计算成“窗口内的逐日榜单 + 每个板块的事件序列”。
// 纯逻辑，自包含。null 一律视为“无数据”，绝不参与排名 / 阈值 / 分母。

import type { RotationData, RotationRuleSet, RotationSector, EventLogic } from './types';

/** 单日事件布尔组合结果 */
export interface DayEvent {
  rankUp: boolean;    // 是否进入当日涨幅 TOP N
  rankDown: boolean;  // 是否进入当日跌幅 TOP N
  largeUp: boolean;   // pct >= riseThreshold
  largeDown: boolean; // pct <= -fallThreshold
  strong: boolean;    // 按 rule 组合后的最终“强势”事件
  weak: boolean;      // 按 rule 组合后的最终“弱势”事件
}

/** 当日榜单中的一行（rank 1 = 当日最强） */
export interface RankRow {
  id: string;
  name: string;
  pct: number;
  rank: number;
}

/** 单个交易日的完整榜单 */
export interface DayRanking {
  dateIndex: number; // 全局日期下标
  date: string;
  ranked: RankRow[]; // 当日全部有效板块按 pct 降序
  total: number;     // 当日有效板块数
}

/** 单个板块在窗口内的事件序列（与 series.days 对齐） */
export interface SectorEventSeries {
  sector: RotationSector;
  days: number[];                // 窗口内全局日期下标(升序)，仅含板块有数据的日子
  pctInWindow: (number | null)[];// 与 days 对齐的涨跌幅
  events: (DayEvent | null)[];   // 与 days 对齐；null = 当日无数据
  rankUpOn: (number | null)[];   // 与 days 对齐；当日涨幅榜排名(1-based)，未进榜为 null
  rankDownOn: (number | null)[]; // 与 days 对齐；当日跌幅榜排名(1-based)，未进榜为 null
}

/** 一次窗口计算的全部产物 */
export interface WindowComputation {
  indices: number[];            // 窗口内全局日期下标(升序)
  dates: string[];              // 与 indices 对齐
  ranking: DayRanking[];        // 与 indices 对齐
  series: SectorEventSeries[];  // 仅包含 scope 命中的板块
}

/**
 * 事件条件组合：
 * - 两个条件都启用 → 按 eventLogic 组合(AND=同时 / OR=任一)；
 * - 只启用一个 → 只为该条件（未启用的条件绝不参与）；
 * - 都不启用 → false。
 */
function combineEvent(
  rankHit: boolean,
  rankOn: boolean,
  bigHit: boolean,
  bigOn: boolean,
  logic: EventLogic,
): boolean {
  if (!rankOn && !bigOn) return false;
  if (rankOn && bigOn) return logic === 'AND' ? rankHit && bigHit : rankHit || bigHit;
  return rankOn ? rankHit : bigHit;
}

/** 判断一个值是否为可用数值（null / undefined / NaN 均视为无数据） */
function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 计算窗口：
 * - 窗口 = dates 的最后 rule.windowDays 个交易日（不足则取全部）；
 * - scope 过滤板块，排名只在 scope 内进行；
 * - 排名稳定：先按 pct 降序，再按板块 id 升序（保证同数据可复现）；
 * - 复杂度 O(窗口日数 × 板块数 log 板块数)，避免 O(n²) 反复 filter。
 */
export function computeWindow(data: RotationData, rule: RotationRuleSet): WindowComputation {
  const total = data.dates.length;
  const win = Math.max(0, Math.min(Math.floor(rule.windowDays), total));
  const start = total - win;

  // 窗口内全局日期下标(升序)
  const indices: number[] = new Array(win);
  for (let k = 0; k < win; k++) indices[k] = start + k;

  // scope 过滤（一次，避免逐日重复过滤）
  const scoped = data.sectors.filter((s) => rule.scope === 'all' || s.type === rule.scope);

  // 逐日构建榜单，并缓存 id→排名 映射，供事件判定 O(1) 查询
  const ranking: DayRanking[] = new Array(win);
  const upRankMaps: Map<string, number>[] = new Array(win);
  const downRankMaps: Map<string, number>[] = new Array(win);

  for (let wi = 0; wi < win; wi++) {
    const gi = indices[wi];
    const rows: { id: string; name: string; pct: number }[] = [];
    for (let si = 0; si < scoped.length; si++) {
      const s = scoped[si];
      const v = s.pct[gi];
      if (!isNum(v)) continue; // 无数据不进榜
      rows.push({ id: s.id, name: s.name, pct: v });
    }
    // 并列时用 id 升序作稳定次级键
    rows.sort((a, b) => (b.pct - a.pct) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const ranked: RankRow[] = new Array(rows.length);
    const upMap = new Map<string, number>();
    const downMap = new Map<string, number>();
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k];
      ranked[k] = { id: r.id, name: r.name, pct: r.pct, rank: k + 1 };
      upMap.set(r.id, k + 1);               // 降序排名：1 = 当日最强
      downMap.set(r.id, rows.length - k);   // 升序排名：1 = 当日最弱
    }
    ranking[wi] = { dateIndex: gi, date: data.dates[gi], ranked, total: ranked.length };
    upRankMaps[wi] = upMap;
    downRankMaps[wi] = downMap;
  }

  // 逐板块生成事件序列
  const riseRankOn = rule.riseRankEnabled;
  const fallRankOn = rule.fallRankEnabled;
  const largeUpOn = rule.riseThreshold > 0;   // 阈值>0 视为“大涨条件启用”
  const largeDownOn = rule.fallThreshold > 0; // 阈值>0 视为“大跌条件启用”

  const series: SectorEventSeries[] = scoped.map((s) => {
    const days: number[] = [];
    const pctInWindow: (number | null)[] = [];
    const events: (DayEvent | null)[] = [];
    const rankUpOn: (number | null)[] = [];
    const rankDownOn: (number | null)[] = [];

    for (let wi = 0; wi < win; wi++) {
      const gi = indices[wi];
      const v = s.pct[gi];
      if (!isNum(v)) continue; // 无数据：不进 days/events（与“有数据但未触发”严格区分）

      const ur = upRankMaps[wi].get(s.id) ?? null;
      const dr = downRankMaps[wi].get(s.id) ?? null;
      const rankUp = ur !== null && ur <= rule.topN;
      const rankDown = dr !== null && dr <= rule.topN;
      const largeUp = v >= rule.riseThreshold;
      const largeDown = v <= -rule.fallThreshold;

      const strong = combineEvent(rankUp, riseRankOn, largeUp, largeUpOn, rule.eventLogic);
      const weak = combineEvent(rankDown, fallRankOn, largeDown, largeDownOn, rule.eventLogic);

      days.push(gi);
      pctInWindow.push(v);
      events.push({ rankUp, rankDown, largeUp, largeDown, strong, weak });
      rankUpOn.push(rankUp ? ur : null);
      rankDownOn.push(rankDown ? dr : null);
    }

    return { sector: s, days, pctInWindow, events, rankUpOn, rankDownOn };
  });

  return {
    indices,
    dates: indices.map((i) => data.dates[i]),
    ranking,
    series,
  };
}