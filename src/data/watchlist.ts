// 板块轮动 · 观察清单（V2.0 阶段 6，任务书 §10 / §14 第 20、21 项）
//
// 定位：观察清单回答"我该把哪些板块加入清单、并在接下来的交易日继续验证"。
//   · 只保存**板块 id + 加入时点**，不保存"当时的统计快照" —— 每天的强势/弱势次数与收益
//     都用**当前规则 + 当前数据**重新计算，清单本身是"待继续验证的名单"。
//   · 仅存本机浏览器（localStorage），**不跨设备、不联网、不做认证** —— 这是 §10 明确许可的轻量 MVP，
//     界面必须标注"仅本设备"。
//
// 与 rotationData 的规则存储同构：模块级单例 + 订阅，保证主页 / 详情页看到同一份清单。

import { useEffect, useState } from 'react';
import type { RotationSector } from '../utils/rotation/types';

const WATCH_KEY = 'tjhub-rotation-watchlist';
/** 观察清单条目上限（避免 localStorage 无限膨胀） */
export const WATCH_LIMIT = 50;

export interface WatchItem {
  id: string;
  name: string;
  /** 加入时的本机日期（ISO，仅用于展示"加入于"） */
  addedAt: string;
  /** 加入时数据的最新交易日 —— 用于计算"自加入以来"的区间（不用本机日期，避免节假日错位） */
  basisDate: string;
}

/**
 * 解析观察清单存档（纯函数，便于测试）。
 * - 非法输入 → []
 * - 缺 id / name 的条目 → 丢弃
 * - 同一板块 id 重复 → 保留**最后一条**（相当于"重新加入"）
 * - 超过 WATCH_LIMIT 条 → 只保留最新的一批
 */
export function parseWatchlist(raw: string | null | undefined): WatchItem[] {
  if (!raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const byId = new Map<string, WatchItem>();
  for (const it of arr) {
    const rec = it as { id?: unknown; name?: unknown; addedAt?: unknown; basisDate?: unknown } | null;
    const id = typeof rec?.id === 'string' ? rec.id.trim() : '';
    const name = typeof rec?.name === 'string' ? rec.name.trim() : '';
    if (!id || !name) continue;
    const addedAt = typeof rec?.addedAt === 'string' ? rec.addedAt : '';
    const basisDate = typeof rec?.basisDate === 'string' ? rec.basisDate : '';
    byId.set(id, { id, name, addedAt, basisDate });
  }
  const list = [...byId.values()];
  return list.slice(Math.max(0, list.length - WATCH_LIMIT));
}

export function serializeWatchlist(list: WatchItem[]): string {
  return JSON.stringify(list);
}

/** 加入清单（已在清单中则不重复添加）；超出上限丢弃最早的 */
export function addWatch(list: WatchItem[], sector: Pick<RotationSector, 'id' | 'name'>, basisDate: string, now: string): WatchItem[] {
  if (!sector.id || !sector.name) return list;
  const next = list.filter((w) => w.id !== sector.id);
  next.push({ id: sector.id, name: sector.name, addedAt: now, basisDate });
  return next.slice(Math.max(0, next.length - WATCH_LIMIT));
}

export function removeWatch(list: WatchItem[], id: string): WatchItem[] {
  return list.filter((w) => w.id !== id);
}

export function inWatchlist(list: WatchItem[], id: string): boolean {
  return list.some((w) => w.id === id);
}

// ---------- 模块级单例 + 订阅（与 rotationData 的规则存储同构） ----------
function readWatchlist(): WatchItem[] {
  try {
    return parseWatchlist(localStorage.getItem(WATCH_KEY));
  } catch {
    return [];
  }
}

let watchState: WatchItem[] = readWatchlist();
const watchListeners = new Set<() => void>();

export function getWatchlist(): WatchItem[] {
  return watchState;
}

export function setWatchlist(list: WatchItem[]): void {
  watchState = list;
  try {
    localStorage.setItem(WATCH_KEY, serializeWatchlist(list));
  } catch {
    // 隐私模式 / 配额已满 — 静默，内存态仍可用
  }
  watchListeners.forEach((l) => l());
}

/** 所有轮动页共用同一份观察清单 */
export function useWatchlist(): [WatchItem[], (l: WatchItem[]) => void] {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    watchListeners.add(l);
    return () => {
      watchListeners.delete(l);
    };
  }, []);
  return [watchState, setWatchlist];
}

/** 加入 / 移除的便捷封装（供列表与详情页复用） */
export function toggleWatch(sector: Pick<RotationSector, 'id' | 'name'>, basisDate: string): void {
  const now = new Date().toISOString().slice(0, 10);
  const cur = getWatchlist();
  setWatchlist(inWatchlist(cur, sector.id) ? removeWatch(cur, sector.id) : addWatch(cur, sector, basisDate, now));
}
