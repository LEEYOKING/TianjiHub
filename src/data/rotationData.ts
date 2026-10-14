// 板块轮动:数据加载 + 规则全局存储
// 设计要点:
//   · rotation.json 是**独立文件**,只在进入【板块轮动】页时才按需加载 → 不影响其它页面首屏
//   · 规则存"模块级单例 + 订阅",保证同一页面里总览/时间轴/详情用**完全相同**的口径
//     (避免用户改一个阈值后各模块口径不一致 — 这是产品的硬性设计原则)
import { useEffect, useState } from 'react';
import {
  DEFAULT_RULE,
  deserializeRule,
  serializeRule,
  type RotationData,
  type RotationRuleSet,
  type RotationSector,
  type SectorType,
} from '../utils/rotation/types';

let cached: RotationData | null = null;
let inflight: Promise<RotationData> | null = null;

/**
 * 归一化 rotation.json：过滤非法行、**按 id 去重**（v2.0.9：数据源若返回重复记录，
 * 同一板块会被统计两次 —— 任务书 §14 第 13 项）。导出为纯函数以便测试。
 */
export function normalize(j: any): RotationData {
  const raw = Array.isArray(j?.sectors) ? (j.sectors as any[]) : [];
  const seen = new Set<string>();
  const sectors: RotationSector[] = [];
  for (const s of raw) {
    if (!s || !s.id || !s.name) continue;
    const id = String(s.id);
    if (seen.has(id)) continue; // 重复 id：只保留第一条
    seen.add(id);
    sectors.push({
      id,
      name: String(s.name),
      type: (s.type || 'industry') as SectorType,
      pct: Array.isArray(s.pct) ? s.pct : [],
      amt: Array.isArray(s.amt) ? s.amt : [],
      coverage: typeof s.coverage === 'number' ? s.coverage : 0,
    });
  }
  return {
    meta: j?.meta || {},
    dates: Array.isArray(j?.dates) ? j.dates : [],
    bench: Array.isArray(j?.bench) ? j.bench : [],
    sectors,
  };
}

/** 加载 rotation.json(带内存缓存 + 并发合并) */
export function loadRotationData(): Promise<RotationData> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = fetch(`${import.meta.env.BASE_URL}rotation.json?t=${Date.now()}`, { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new Error(`rotation.json 拉取失败: ${r.status}`);
      return r.json();
    })
    .then((j) => {
      const d = normalize(j);
      cached = d;
      return d;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useRotationData() {
  const [data, setData] = useState<RotationData | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }
    let alive = true;
    loadRotationData()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(String(e?.message || e));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { data, error, loading };
}

// ---------- 规则:全局单例 + 订阅 ----------
const RULE_KEY = 'tjhub-rotation-rule';

/**
 * 从存档串解析出可用规则（纯函数，v2.0.9 抽出以便测试 — 任务书 §14 第 18 项）。
 * 规则：解析失败 / 版本与当前 DEFAULT_RULE 不匹配 → 一律回落默认（旧存档作废）。
 */
export function pickStoredRule(stored: string | null, fallback: RotationRuleSet = DEFAULT_RULE): RotationRuleSet {
  const r = stored ? deserializeRule(stored) : null;
  return r && r.version === fallback.version ? r : fallback;
}

function readRule(): RotationRuleSet {
  try {
    return pickStoredRule(localStorage.getItem(RULE_KEY));
  } catch {
    return DEFAULT_RULE;
  }
}

let ruleState: RotationRuleSet = readRule();
const ruleListeners = new Set<() => void>();

export function getRotationRule(): RotationRuleSet {
  return ruleState;
}

/** 更新规则(写入 localStorage 并广播给所有轮动页) */
export function setRotationRule(r: RotationRuleSet) {
  ruleState = r;
  try {
    localStorage.setItem(RULE_KEY, serializeRule(r));
  } catch {
    // 隐私模式/localStorage 满 — 静默,仍用内存值
  }
  ruleListeners.forEach((l) => l());
}

export function resetRotationRule() {
  setRotationRule(DEFAULT_RULE);
}

/** 所有轮动页共用同一份规则 */
export function useRotationRule(): [RotationRuleSet, (r: RotationRuleSet) => void] {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    ruleListeners.add(l);
    return () => {
      ruleListeners.delete(l);
    };
  }, []);
  return [ruleState, setRotationRule];
}

// ---------- 规则方案（V2.0 阶段 5，任务书 §7.5；仅本设备浏览器内，不跨设备、不联网） ----------
const PRESET_KEY = 'tjhub-rotation-rule-presets';
/** 方案数量上限（超出时丢弃最早的，避免 localStorage 无限膨胀） */
export const PRESET_LIMIT = 20;

export interface RulePreset {
  name: string;
  /** serializeRule 的紧凑串（复用既有序列化/反序列化，天然带校验） */
  encoded: string;
  /** 保存时的规则版本；与当前 DEFAULT_RULE.version 不一致时界面给出"旧版本"提示，但**不丢弃** */
  version: string;
}

/**
 * 解析方案存档（纯函数，便于测试）。
 * - 非法输入（非 JSON / 非数组 / 空串）→ []
 * - 缺 name 或 encoded 的条目 → 丢弃
 * - encoded 无法反序列化的条目 → 丢弃（复用 deserializeRule 的校验）
 * - 同名方案：保留**最后一条**（相当于"覆盖"）
 * - 超过 PRESET_LIMIT 条：只保留最新的一批
 */
export function parsePresets(raw: string | null | undefined): RulePreset[] {
  if (!raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const byName = new Map<string, RulePreset>();
  for (const it of arr) {
    const rec = it as { name?: unknown; encoded?: unknown } | null;
    const name = typeof rec?.name === 'string' ? rec.name.trim() : '';
    const encoded = typeof rec?.encoded === 'string' ? rec.encoded : '';
    if (!name || !encoded) continue;
    const rule = deserializeRule(encoded);
    if (!rule) continue;
    byName.set(name, { name, encoded, version: rule.version });
  }
  const list = [...byName.values()];
  return list.slice(Math.max(0, list.length - PRESET_LIMIT));
}

export function serializePresets(list: RulePreset[]): string {
  return JSON.stringify(list);
}

/** 新增/覆盖方案（同名覆盖），并保持最多 PRESET_LIMIT 条 */
export function upsertPreset(list: RulePreset[], name: string, rule: RotationRuleSet): RulePreset[] {
  const nm = name.trim();
  if (!nm) return list;
  const next = list.filter((p) => p.name !== nm);
  next.push({ name: nm, encoded: serializeRule(rule), version: rule.version });
  return next.slice(Math.max(0, next.length - PRESET_LIMIT));
}

export function removePreset(list: RulePreset[], name: string): RulePreset[] {
  return list.filter((p) => p.name !== name);
}

/** 把方案串还原成规则（版本原样保留，由调用方决定是否重新盖章） */
export function decodePreset(p: RulePreset): RotationRuleSet | null {
  return deserializeRule(p.encoded);
}

export function loadPresets(): RulePreset[] {
  try {
    return parsePresets(localStorage.getItem(PRESET_KEY));
  } catch {
    return [];
  }
}

export function savePresets(list: RulePreset[]): void {
  try {
    localStorage.setItem(PRESET_KEY, serializePresets(list));
  } catch {
    // 隐私模式 / 配额已满 — 静默，内存态仍可用
  }
}