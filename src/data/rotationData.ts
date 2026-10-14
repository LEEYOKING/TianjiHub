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
  type SectorType,
} from '../utils/rotation/types';

let cached: RotationData | null = null;
let inflight: Promise<RotationData> | null = null;

function normalize(j: any): RotationData {
  return {
    meta: j?.meta || {},
    dates: Array.isArray(j?.dates) ? j.dates : [],
    bench: Array.isArray(j?.bench) ? j.bench : [],
    sectors: Array.isArray(j?.sectors)
      ? j.sectors
          .filter((s: any) => s && s.id && s.name)
          .map((s: any) => ({
            id: String(s.id),
            name: String(s.name),
            type: (s.type || 'industry') as SectorType,
            pct: Array.isArray(s.pct) ? s.pct : [],
            amt: Array.isArray(s.amt) ? s.amt : [],
            coverage: typeof s.coverage === 'number' ? s.coverage : 0,
          }))
      : [],
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

function readRule(): RotationRuleSet {
  try {
    const s = localStorage.getItem(RULE_KEY);
    const r = s ? deserializeRule(s) : null;
    // v2.0.8l0:规则版本不匹配时旧存档作废 → 回落到新默认值
    // (否则调整 DEFAULT_RULE 对已有 localStorage 存档的老用户完全不可见)
    return r && r.version === DEFAULT_RULE.version ? r : DEFAULT_RULE;
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