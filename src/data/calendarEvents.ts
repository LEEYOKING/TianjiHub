// 日历回溯 · 事件标注
// 纯前端存储（localStorage）—— 站点是静态托管，没有后端可写；
// 换浏览器/清缓存会丢，属于"个人复盘笔记"定位，不参与任何统计口径。
import { useEffect, useState } from 'react';

export interface CalendarEvent {
  date: string;      // YYYY-MM-DD
  text: string;
  createdAt: string; // ISO
}

const KEY = 'tjhub-calendar-events';
const EVT = 'tj:calendar-events-changed';

function read(): CalendarEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e: any) => e && typeof e.date === 'string' && typeof e.text === 'string' && e.text.trim())
      .map((e: any) => ({ date: e.date, text: e.text, createdAt: e.createdAt || '' }));
  } catch {
    return [];
  }
}

function write(list: CalendarEvent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 隐私模式/配额满：静默失败，不影响页面其它功能 */
  }
  window.dispatchEvent(new Event(EVT));
}

export function allEvents(): CalendarEvent[] {
  return read();
}

export function eventsOf(date: string): CalendarEvent[] {
  return read().filter((e) => e.date === date);
}

export function addEvent(date: string, text: string): CalendarEvent[] {
  const t = text.trim();
  if (!t) return read();
  const list = read();
  list.push({ date, text: t, createdAt: new Date().toISOString() });
  write(list);
  return list;
}

export function removeEvent(date: string, createdAt: string): CalendarEvent[] {
  const list = read().filter((e) => !(e.date === date && e.createdAt === createdAt));
  write(list);
  return list;
}

/** 订阅事件变更（同一页面内多处展示时保持同步） */
export function useCalendarEvents() {
  const [list, setList] = useState<CalendarEvent[]>(read);
  useEffect(() => {
    const sync = () => setList(read());
    window.addEventListener(EVT, sync);
    window.addEventListener('storage', sync);   // 其它标签页改动了 localStorage
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return list;
}
