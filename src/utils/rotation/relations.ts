// 板块轮动 · 关系层（第三层）
// 职责：在 WindowComputation + SectorStats 之上，计算板块之间的
//   同步活跃（事件重合）、先后关系（领先→跟随条件频率）、市场环境分层统计。
// 纯逻辑、自包含、确定性（同样输入同样输出）；所有并列一律按 board id 升序稳定排序。
//
// 统一口径（务必与 UI 说明保持一致）：
//  - 「强势事件」一律取自 comp.series[].events[i].strong（已按用户规则算好），本模块不重新判定强弱。
//  - 上涨/下跌环境：按当日基准涨跌幅符号（data.bench[comp.indices[i]]）：>0 为 up，<0 为 down；
//    等于 0 或 null 的当日样本不计入任一环境。
//  - 高/低波动环境：对基准算 20 个交易日滚动标准差（不足 20 日用已有天数），取窗口内该滚动值的中位数
//    作为阈值，高于中位数为 high，否则 low；当天无基准数据（benchPct=null）不计入。
//  - 分母一律用「该环境 / 该滞后下的有效交易日数」，缺失日不计入分母，也不计为 0 涨跌。
//  - lift = 实际条件频率 / 随机基准频率，必须同时给出实际命中数 hits（建议 hits < 3 视为样本不足）。

import type { RotationData, RotationRuleSet } from './types';
import type { WindowComputation } from './ruleEngine';
import type { SectorStats } from './analytics';

// 供调用方从本模块一并取用规则类型，保持页面调用签名一致
export type { RotationRuleSet };

// ===================== 同步活跃 =====================

/** 一对板块的同步活跃统计 */
export interface SyncPair {
  a: { id: string; name: string };
  b: { id: string; name: string };
  coDays: number;      // 两个板块在同一交易日都发生「强势事件」的天数
  aDays: number;       // A 的强势事件日数
  bDays: number;       // B 的强势事件日数
  jaccard: number;     // coDays / (aDays + bDays - coDays)
  lift: number;        // coDays / 随机基准期望值,期望 = aDays * bDays / 窗口有效交易日数
}

/**
 * 计算同步活跃板块对。
 * 性能：不做 O(n²×D) 的板块对全量双重循环；先按「每一天 → 当日所有强势板块」建稀疏索引，
 * 只对同一天共同出现的板块对累加计数，最后再算 Jaccard/Lift。
 * 默认 minCoDays=3, limit=10, minJaccard=0；结果按 jaccard 降序（并列按 board id 升序）。
 */
export function computeSyncPairs(
  comp: WindowComputation,
  stats: SectorStats[],
  opts?: { minCoDays?: number; limit?: number; minJaccard?: number },
): SyncPair[] {
  const minCoDays = opts?.minCoDays ?? 3;
  const limit = opts?.limit ?? 10;
  const minJaccard = opts?.minJaccard ?? 0;

  const n = comp.series.length;
  const windowDays = comp.indices.length;

  // 每天 → 当日发生强势事件的板块下标（插入顺序随 i 递增，天然升序）
  const byDay = new Map<number, number[]>();
  // 每个板块的强势事件日数（与 comp.series 同序）
  const strongDays: number[] = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    const s = comp.series[i];
    for (let k = 0; k < s.days.length; k++) {
      if (s.events[k]?.strong) {
        strongDays[i]++;
        const g = s.days[k];
        const arr = byDay.get(g);
        if (arr) arr.push(i);
        else byDay.set(g, [i]);
      }
    }
  }

  // 只对「同一天共同出现」的板块对累加共现次数（稀疏统计）
  const pairCount = new Map<number, number>();
  for (const list of byDay.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const a = list[x];
        const b = list[y]; // list 升序 ⇒ a < b
        const key = a * n + b;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
    }
  }

  const out: SyncPair[] = [];
  for (const [key, coDays] of pairCount) {
    if (coDays < minCoDays) continue;
    const a = Math.floor(key / n);
    const b = key % n;
    const aDays = strongDays[a];
    const bDays = strongDays[b];
    const union = aDays + bDays - coDays;
    const jaccard = union > 0 ? coDays / union : 0;
    if (jaccard < minJaccard) continue;
    // 随机基准期望：把 A/B 的强势事件随机撒到窗口交易日，重合的期望次数
    const expected = windowDays > 0 ? (aDays * bDays) / windowDays : 0;
    const lift = expected > 0 ? coDays / expected : 0;
    out.push({
      a: { id: stats[a].sector.id, name: stats[a].sector.name },
      b: { id: stats[b].sector.id, name: stats[b].sector.name },
      coDays,
      aDays,
      bDays,
      jaccard,
      lift,
    });
  }

  out.sort(
    (p, q) =>
      q.jaccard - p.jaccard ||
      (p.a.id < q.a.id ? -1 : p.a.id > q.a.id ? 1 : 0) ||
      (p.b.id < q.b.id ? -1 : p.b.id > q.b.id ? 1 : 0),
  );
  return out.slice(0, limit);
}

// ===================== 单板块的同步活跃伙伴（详情页用） =====================

/** 指定板块与另一个板块的同步活跃统计（target 恒为本板块） */
export interface SectorPeer {
  peer: { id: string; name: string };
  coDays: number;      // 共同活跃天数（同一交易日两者都发生强势事件）
  targetDays: number;  // 本板块的强势事件日数
  peerDays: number;    // 对方板块的强势事件日数
  jaccard: number;     // coDays / (targetDays + peerDays − coDays)
  lift: number;        // coDays / 随机基准期望（targetDays × peerDays / 窗口交易日数）
}

/**
 * 计算「指定板块」与其它板块的同步活跃关系（详情页的"该板块参与的同步关系"）。
 * 口径与 computeSyncPairs **完全一致**（同日强势共现、Jaccard、Lift 同一公式），
 * 区别只是把统计范围限制在"与目标板块配对"的板块对上，
 * 这样即便是活跃度不高的板块，也能拿到它自己的关系（全市场 Top N 会把它漏掉）。
 * 结果按 Jaccard 降序（并列按 coDays 降序、对方板块 id 升序），返回前 limit 条。
 */
export function computeSectorPeers(
  comp: WindowComputation,
  stats: SectorStats[],
  targetId: string,
  opts?: { minCoDays?: number; limit?: number },
): SectorPeer[] {
  const minCoDays = opts?.minCoDays ?? 2;
  const limit = opts?.limit ?? 10;

  const n = comp.series.length;
  const windowDays = comp.indices.length;

  let ti = -1;
  for (let i = 0; i < n; i++) {
    if (comp.series[i].sector.id === targetId) {
      ti = i;
      break;
    }
  }
  if (ti < 0) return [];

  // 每天 → 当日发生强势事件的板块下标（稀疏索引，插入顺序随 i 递增天然升序）
  const byDay = new Map<number, number[]>();
  const strongDays: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const s = comp.series[i];
    for (let k = 0; k < s.days.length; k++) {
      if (s.events[k]?.strong) {
        strongDays[i]++;
        const g = s.days[k];
        const arr = byDay.get(g);
        if (arr) arr.push(i);
        else byDay.set(g, [i]);
      }
    }
  }

  // 只累加「目标板块当日也走强」的那些天里共同出现的板块
  const co = new Map<number, number>();
  for (const list of byDay.values()) {
    if (list.indexOf(ti) < 0) continue;
    for (const x of list) {
      if (x === ti) continue;
      co.set(x, (co.get(x) ?? 0) + 1);
    }
  }

  const out: SectorPeer[] = [];
  for (const [j, coDays] of co) {
    if (coDays < minCoDays) continue;
    const targetDays = strongDays[ti];
    const peerDays = strongDays[j];
    const union = targetDays + peerDays - coDays;
    const jaccard = union > 0 ? coDays / union : 0;
    const expected = windowDays > 0 ? (targetDays * peerDays) / windowDays : 0;
    const lift = expected > 0 ? coDays / expected : 0;
    out.push({
      peer: { id: stats[j].sector.id, name: stats[j].sector.name },
      coDays,
      targetDays,
      peerDays,
      jaccard,
      lift,
    });
  }

  out.sort(
    (p, q) =>
      q.jaccard - p.jaccard ||
      q.coDays - p.coDays ||
      (p.peer.id < q.peer.id ? -1 : p.peer.id > q.peer.id ? 1 : 0),
  );
  return out.slice(0, limit);
}

// ===================== 先后关系（领先 → 跟随） =====================

/** 单个滞后格 k：A 走强后第 k 个交易日 B 走强的条件频率 */
export interface LeadLagCell {
  k: number;
  hits: number;      // 实际命中数
  condFreq: number;  // 条件频率 P(B 强势 @ t+k | A 强势 @ t)
  baseFreq: number;  // 随机基准频率 P(B 强势)
  lift: number;      // condFreq / baseFreq
}

/** 单个跟随板块的整行结果 */
export interface LeadLagRow {
  sector: { id: string; name: string };
  baseFreq: number;              // P(B=1) 基准活跃频率
  cells: LeadLagCell[];          // k = 1..maxLag
  best: LeadLagCell | null;      // lift 最大且 hits >= 3 的那一格;若都不足则 null
  samples: number;               // A 的强势事件日数(用于判断样本是否足够)
}

/**
 * 计算「领先板块 leaderId 走强后，其它板块在随后 1..maxLag 个交易日的走强概率」。
 * 只在用户选中一个领先板块时调用，复杂度 O(n × D × maxLag)，可接受。
 * 分母为该滞后下的可观测有效日：A 事件日 d 需满足 d+k 落在窗口内且 B 当日有数据（缺失日不计入）。
 * 返回除 leader 外的全部板块，按 best.lift 降序（best 为 null 的排最后，并列按 board id 升序）。
 */
export function computeLeadLag(
  comp: WindowComputation,
  stats: SectorStats[],
  leaderId: string,
  maxLag = 5,
): LeadLagRow[] {
  const lag = Math.max(1, Math.floor(maxLag));
  const n = comp.series.length;

  const idxById = new Map<string, number>();
  for (let i = 0; i < n; i++) idxById.set(comp.series[i].sector.id, i);
  const li = idxById.get(leaderId);
  if (li === undefined) return [];

  const leader = comp.series[li];
  const leaderStrong: number[] = [];
  for (let k = 0; k < leader.days.length; k++) {
    if (leader.events[k]?.strong) leaderStrong.push(leader.days[k]);
  }
  const samples = leaderStrong.length;
  const windowMax = comp.indices.length > 0 ? comp.indices[comp.indices.length - 1] : -1;

  const rows: LeadLagRow[] = [];
  for (let j = 0; j < n; j++) {
    if (j === li) continue;
    const s = comp.series[j];
    const baseFreq = stats[j].strongFreq; // P(B 强势) = 强势次数 / 有效交易日数

    // B 有数据日 → 当日是否强势（用于 O(1) 查询，同时可区分「无数据」）
    const strongByDay = new Map<number, boolean>();
    for (let k = 0; k < s.days.length; k++) strongByDay.set(s.days[k], !!s.events[k]?.strong);

    const cells: LeadLagCell[] = [];
    for (let k = 1; k <= lag; k++) {
      let denom = 0;
      let hits = 0;
      for (const d of leaderStrong) {
        const t = d + k;
        if (t > windowMax) continue;      // 超出窗口尾部，不可观测
        const st = strongByDay.get(t);
        if (st === undefined) continue;   // B 当日无数据：不计入分母
        denom++;
        if (st) hits++;
      }
      const condFreq = denom > 0 ? hits / denom : 0;
      const lift = baseFreq > 0 ? condFreq / baseFreq : 0;
      cells.push({ k, hits, condFreq, baseFreq, lift });
    }

    let best: LeadLagCell | null = null;
    for (const c of cells) {
      if (c.hits < 3) continue;
      if (!best || c.lift > best.lift) best = c;
    }

    rows.push({ sector: { id: s.sector.id, name: s.sector.name }, baseFreq, cells, best, samples });
  }

  rows.sort((p, q) => {
    const lp = p.best ? p.best.lift : -1;
    const lq = q.best ? q.best.lift : -1;
    if (lq !== lp) return lq - lp;
    return p.sector.id < q.sector.id ? -1 : p.sector.id > q.sector.id ? 1 : 0;
  });
  return rows;
}

// ===================== 市场环境分层 =====================

/** 单个交易日的市场环境标签 */
export interface RegimeLabel {
  dateIndex: number;      // 全局日期下标
  regime: 'up' | 'down';  // 基准涨跌（benchPct 为 0/null 时，该样本不参与涨跌统计，见 computeRegimeStats）
  vol: 'high' | 'low';    // 基准滚动波动高低（benchPct=null 时不参与统计）
  benchPct: number | null;
}

/** 单个板块在各环境下的强势事件频率 */
export interface RegimeStat {
  sector: { id: string; name: string };
  upDays: number; downDays: number; upFreq: number; downFreq: number;   // 该板块在上涨/下跌环境里的强势事件频率
  highVolDays: number; lowVolDays: number; highVolFreq: number; lowVolFreq: number;
}

/**
 * 为窗口内每个交易日打「涨跌 × 波动」标签。
 * - 涨跌：benchPct>0 → up，<0 → down；等于 0 或 null 当日不参与涨跌统计（此处仍给出占位值，由统计阶段排除）。
 * - 波动：基准 20 个交易日滚动标准差（不足 20 日用已有天数），阈值取窗口内滚动值中位数，> 中位数为 high。
 */
export function computeRegimeLabels(data: RotationData, comp: WindowComputation): RegimeLabel[] {
  const rolling: (number | null)[] = comp.indices.map((gi) => rollingStd(data.bench, gi, 20));

  // 窗口内非空滚动值的中位数作为阈值
  const vals = rolling.filter((v): v is number => v !== null).slice().sort((a, b) => a - b);
  let median = 0;
  if (vals.length > 0) {
    median =
      vals.length % 2 === 1
        ? vals[(vals.length - 1) / 2]
        : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
  }

  const labels: RegimeLabel[] = [];
  for (let i = 0; i < comp.indices.length; i++) {
    const raw = data.bench[comp.indices[i]];
    const benchPct = isNum(raw) ? raw : null;
    const regime: 'up' | 'down' = benchPct !== null && benchPct < 0 ? 'down' : 'up';
    const rv = rolling[i];
    const vol: 'high' | 'low' = rv !== null && rv > median ? 'high' : 'low';
    labels.push({ dateIndex: comp.indices[i], regime, vol, benchPct });
  }
  return labels;
}

/**
 * 按环境标签统计各板块的强势事件频率。
 * - 涨跌环境：benchPct 为 null 或 0 的当日不计入任一环境的分母；分母 = 该板块在该环境中有数据的交易日数。
 * - 波动环境：benchPct 为 null 的当日不计入；分母 = 该板块在该环境中有数据的交易日数。
 */
export function computeRegimeStats(
  comp: WindowComputation,
  stats: SectorStats[],
  labels: RegimeLabel[],
): RegimeStat[] {
  const labelByIndex = new Map<number, RegimeLabel>();
  for (const l of labels) labelByIndex.set(l.dateIndex, l);

  const out: RegimeStat[] = [];
  for (let i = 0; i < comp.series.length; i++) {
    const s = comp.series[i];
    let upD = 0;
    let upS = 0;
    let downD = 0;
    let downS = 0;
    let hvD = 0;
    let hvS = 0;
    let lvD = 0;
    let lvS = 0;

    for (let k = 0; k < s.days.length; k++) {
      const l = labelByIndex.get(s.days[k]);
      if (!l) continue;
      const strong = !!s.events[k]?.strong;

      if (l.benchPct !== null && l.benchPct > 0) {
        upD++;
        if (strong) upS++;
      } else if (l.benchPct !== null && l.benchPct < 0) {
        downD++;
        if (strong) downS++;
      }

      if (l.benchPct !== null) {
        if (l.vol === 'high') {
          hvD++;
          if (strong) hvS++;
        } else {
          lvD++;
          if (strong) lvS++;
        }
      }
    }

    out.push({
      sector: { id: stats[i].sector.id, name: stats[i].sector.name },
      upDays: upD,
      downDays: downD,
      upFreq: upD > 0 ? upS / upD : 0,
      downFreq: downD > 0 ? downS / downD : 0,
      highVolDays: hvD,
      lowVolDays: lvD,
      highVolFreq: hvD > 0 ? hvS / hvD : 0,
      lowVolFreq: lvD > 0 ? lvS / lvD : 0,
    });
  }
  return out;
}

// ===================== 内部工具 =====================

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 截至 gi（含）的滚动标准差：取 [gi-win+1, gi] 内非空基准值，不足 win 日用已有天数；无数据返回 null */
function rollingStd(bench: (number | null)[], gi: number, win: number): number | null {
  const from = Math.max(0, gi - win + 1);
  const vals: number[] = [];
  for (let d = from; d <= gi; d++) {
    if (isNum(bench[d])) vals.push(bench[d] as number);
  }
  if (vals.length === 0) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  let variance = 0;
  for (const v of vals) variance += (v - mean) ** 2;
  variance /= vals.length;
  return Math.sqrt(variance);
}