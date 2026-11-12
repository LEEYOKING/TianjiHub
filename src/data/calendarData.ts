// 日历回溯：数据加载
// 产物由 scripts/fetch_calendar.py 每日生成，按日分片：
//   public/calendar/index.json       —— 日期索引 + 每日摘要（首屏只拉这一个，约 130KB）
//   public/calendar/YYYY-MM-DD.json  —— 单日三张榜（点某天 / 做日期对比时才按需拉）
// 设计：与 rotation.json 一致 —— 独立文件、进入页面才按需加载，不影响其它页首屏。
import { useEffect, useState } from 'react'

export interface CalendarSector {
  id: string
  name: string
  type: string
  pct: number
  amt: number
}

export interface CalendarStock {
  code: string
  name: string
  pct: number
  amount: number
  close: number
  board: string
}

export interface CalendarSummary {
  up?: number
  down?: number
  flat?: number
  limitUp?: number
  limitDown?: number
  brokenLimit?: number
  turnover?: number
}

export interface CalendarIndexDay extends CalendarSummary {
  date: string
  topUp: CalendarSector[]
  topDown: CalendarSector[]
  hasStocks: boolean
}

export interface CalendarIndex {
  meta: {
    schema: string
    generatedAt: string
    firstDate: string
    lastDate: string
    days: number
    /** 归档窗口内的全部交易日；用于区分「节假日休市」与「归档缺失」 */
    tradeDates?: string[]
  }
  days: CalendarIndexDay[]
}

export interface CalendarStocks {
  up: CalendarStock[]
  down: CalendarStock[]
  volume: CalendarStock[]
}

export interface CalendarDay {
  meta: {
    schema: string
    date: string
    generatedAt: string
    spotSource?: string
    spotCount?: number
    sectorFilter?: string
    stockFilter?: string
  }
  sectors: { up: CalendarSector[]; down: CalendarSector[] }
  stocks: CalendarStocks | null
  summary: CalendarSummary
}

let idxCache: CalendarIndex | null = null
let idxInflight: Promise<CalendarIndex> | null = null
const dayCache = new Map<string, CalendarDay>()
const dayInflight = new Map<string, Promise<CalendarDay>>()

function normalizeIndex(j: any): CalendarIndex {
  const days = (Array.isArray(j?.days) ? j.days : [])
    .filter((d: any) => d && typeof d.date === 'string')
    .map((d: any) => ({
      ...d,
      topUp: Array.isArray(d.topUp) ? d.topUp : [],
      topDown: Array.isArray(d.topDown) ? d.topDown : [],
      hasStocks: !!d.hasStocks,
    }))
    .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)))
  return {
    meta: j?.meta || {
      schema: '',
      generatedAt: '',
      firstDate: '',
      lastDate: '',
      days: days.length,
    },
    days,
  }
}

/** 加载日历索引（带内存缓存 + 并发合并） */
export function loadCalendarIndex(force = false): Promise<CalendarIndex> {
  if (idxCache && !force) return Promise.resolve(idxCache)
  if (idxInflight) return idxInflight
  idxInflight = fetch(`${import.meta.env.BASE_URL}calendar/index.json?t=${Date.now()}`, {
    cache: 'no-store',
  })
    .then((r) => {
      if (!r.ok) throw new Error(`calendar/index.json 拉取失败: ${r.status}`)
      return r.json()
    })
    .then((j) => {
      idxCache = normalizeIndex(j)
      return idxCache
    })
    .finally(() => {
      idxInflight = null
    })
  return idxInflight
}

/** 加载某个交易日详情（按日缓存，同一天反复点弹窗只拉一次） */
export function loadCalendarDay(date: string): Promise<CalendarDay> {
  const hit = dayCache.get(date)
  if (hit) return Promise.resolve(hit)
  const running = dayInflight.get(date)
  if (running) return running
  const p = fetch(`${import.meta.env.BASE_URL}calendar/${date}.json?t=${Date.now()}`, {
    cache: 'no-store',
  })
    .then((r) => {
      if (!r.ok) throw new Error(`calendar/${date}.json 拉取失败: ${r.status}`)
      return r.json()
    })
    .then((j: any) => {
      const d: CalendarDay = {
        meta: j?.meta || { schema: '', date, generatedAt: '' },
        sectors: {
          up: Array.isArray(j?.sectors?.up) ? j.sectors.up : [],
          down: Array.isArray(j?.sectors?.down) ? j.sectors.down : [],
        },
        stocks: j?.stocks
          ? {
              up: Array.isArray(j.stocks.up) ? j.stocks.up : [],
              down: Array.isArray(j.stocks.down) ? j.stocks.down : [],
              volume: Array.isArray(j.stocks.volume) ? j.stocks.volume : [],
            }
          : null,
        summary: j?.summary || {},
      }
      dayCache.set(date, d)
      return d
    })
    .finally(() => {
      dayInflight.delete(date)
    })
  dayInflight.set(date, p)
  return p
}

export function useCalendarIndex() {
  const [index, setIndex] = useState<CalendarIndex | null>(idxCache)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    loadCalendarIndex()
      .then((d) => alive && setIndex(d))
      .catch((e) => alive && setError(String(e?.message || e)))
    return () => {
      alive = false
    }
  }, [])

  return { index, loading: !index && !error, error }
}

/** 把 'YYYY-MM-DD' 转成页面统一展示的 'YY/MM/DD' */
export function dashToSlash(d?: string): string {
  if (!d || d.length < 10) return ''
  return `${d.slice(2, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}`
}

/** 列表 diff：返回 b 中「新进」的 key 集合与 a 中「掉出」的 key 集合 */
export function diffKeys<T>(a: T[], b: T[], keyOf: (x: T) => string) {
  const ka = new Set(a.map(keyOf))
  const kb = new Set(b.map(keyOf))
  const added = new Set<string>()
  const dropped = new Set<string>()
  kb.forEach((k) => {
    if (!ka.has(k)) added.add(k)
  })
  ka.forEach((k) => {
    if (!kb.has(k)) dropped.add(k)
  })
  return { added, dropped }
}
