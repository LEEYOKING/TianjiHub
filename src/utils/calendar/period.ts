// 日历回溯 · 区间统计（纯函数，可在 node 下单测）
// 数据源：public/rotation.json（列式，417 板块 × 120 交易日）
// 口径：null 表示当日无数据，不当作 0 涨跌幅；板块日均成交额 < 5 亿不参与排名
//      （与 fetch_calendar.py 的 MIN_SECTOR_AMT 保持一致）
import type { RotationData } from '../rotation/types'
import type { CalendarIndexDay } from '../../data/calendarData'

export interface PeriodRankRow {
  id: string
  name: string
  type: string
  cumPct: number // 区间累计收益 %
  avgPct: number // 日均涨跌幅 %
  days: number // 区间内有数据的天数
  upDays: number // 其中上涨天数
  avgAmt: number // 日均成交额（亿）
  lastPct: number // 区间最后一天的涨跌幅
}

export interface PeriodBucket {
  key: string // 唯一键（周 = 周一日期；月 = YYYY-MM）
  label: string // 展示文案
  from: string // YYYY-MM-DD
  to: string
}

/** 把交易日序列切成周（周一~周五）/月 */
export function buildBuckets(dates: string[], kind: 'week' | 'month'): PeriodBucket[] {
  const map = new Map<string, PeriodBucket>()
  for (const d of dates) {
    let key: string
    let label: string
    if (kind === 'month') {
      key = d.slice(0, 7)
      label = `${key.slice(0, 4)}年${Number(key.slice(5, 7))}月`
    } else {
      key = mondayOf(d)
      label = `${key.slice(5)} ~ ${d.slice(5)}`
    }
    const hit = map.get(key)
    if (!hit) {
      map.set(key, { key, label, from: d, to: d })
    } else {
      hit.to = d
      if (kind === 'week') hit.label = `${hit.from.slice(5)} ~ ${d.slice(5)}`
    }
  }
  return Array.from(map.values()).sort((a, b) => a.from.localeCompare(b.from))
}

/** 取某日所在周的周一（YYYY-MM-DD，按 UTC 计算，与 A 股交易日一致） */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  const wd = (d.getUTCDay() + 6) % 7 // 周一=0
  d.setUTCDate(d.getUTCDate() - wd)
  return d.toISOString().slice(0, 10)
}

/**
 * 区间板块排名：累计收益 = Π(1+pct/100)-1，只统计区间内有数据的交易日。
 * @param minAvgAmt 日均成交额门槛（亿），默认 5 —— 过滤只有一两只成分股的迷你概念
 */
export function rankSectorsInPeriod(
  rot: RotationData,
  from: string,
  to: string,
  minAvgAmt = 5,
): PeriodRankRow[] {
  const idx: number[] = []
  rot.dates.forEach((d, i) => {
    if (d >= from && d <= to) idx.push(i)
  })
  if (!idx.length) return []

  const rows: PeriodRankRow[] = []
  for (const s of rot.sectors) {
    let nav = 1
    let days = 0
    let upDays = 0
    let amtSum = 0
    let amtDays = 0
    let lastPct = 0

    for (const i of idx) {
      const p = s.pct[i]
      if (p == null) continue
      nav *= 1 + p / 100
      days += 1
      if (p > 0) upDays += 1
      lastPct = p
      const a = s.amt[i]
      if (a != null) {
        amtSum += a
        amtDays += 1
      }
    }
    if (!days) continue
    const avgAmt = amtDays ? amtSum / amtDays : 0
    if (avgAmt < minAvgAmt) continue
    rows.push({
      id: s.id,
      name: s.name,
      type: s.type,
      cumPct: (nav - 1) * 100,
      avgPct: 0, // 下面统一算
      days,
      upDays,
      avgAmt,
      lastPct,
    })
  }

  // 日均 = 累计收益按天数摊平（几何均值），避免少数暴涨日把日均拉变形
  for (const r of rows) {
    r.avgPct = (Math.pow(1 + r.cumPct / 100, 1 / r.days) - 1) * 100
  }
  rows.sort((a, b) => b.cumPct - a.cumPct)
  return rows
}

// ---------------- 主线识别 ----------------
export interface MainlineRow {
  id: string
  name: string
  type: string
  count: number // 窗口内进入涨幅榜 TOP5 的天数
  consecutive: number // 截至最新一个交易日的连续在榜天数
  avgPct: number // 在榜日的平均涨幅
  sumPct: number
  lastDate: string // 最近一次在榜日期
  isActive: boolean // 最新交易日是否仍在榜
  /** 辅助特征（最多一个）：新晋 / 持续 / 加速 / 常青 */
  feature: MainlineFeature | null
}

export type MainlineFeature = 'new' | 'streak' | 'accelerating' | 'evergreen'

export const FEATURE_LABEL: Record<MainlineFeature, string> = {
  new: '新晋',
  streak: '持续',
  accelerating: '加速',
  evergreen: '常青',
}

/**
 * 主线识别：近 window 个已归档交易日里，进入「板块涨幅 TOP5」次数 ≥ minCount 的板块。
 * 排序：仍在榜 > 出现次数 > 平均涨幅。
 * 只用 index.json 里的 topUp（每日 TOP5），不额外加载 rotation.json —— 打开页面即可算。
 */
export function findMainlines(days: CalendarIndexDay[], window = 10, minCount = 3): MainlineRow[] {
  const win = days.slice(-window)
  if (!win.length) return []
  const latestDate = win[win.length - 1].date

  const acc = new Map<
    string,
    { name: string; type: string; hits: { idx: number; pct: number; date: string }[] }
  >()
  win.forEach((d, idx) => {
    for (const s of d.topUp || []) {
      let a = acc.get(s.id)
      if (!a) {
        a = { name: s.name, type: s.type, hits: [] }
        acc.set(s.id, a)
      }
      a.hits.push({ idx, pct: s.pct, date: d.date })
    }
  })

  const rows: MainlineRow[] = []
  acc.forEach((a, id) => {
    if (a.hits.length < minCount) return
    const dates = a.hits.map((h) => h.date)
    const pcts = a.hits.map((h) => h.pct)
    let consecutive = 0
    for (let i = win.length - 1; i >= 0; i--) {
      if ((win[i].topUp || []).some((s) => s.id === id)) consecutive += 1
      else break
    }
    const sumPct = pcts.reduce((x, y) => x + y, 0)
    const isActive = dates[dates.length - 1] === latestDate

    // 辅助特征：只取一个，按信息量优先级判定
    // 加速 = 近 5 个交易日在榜日的均涨 > 此前在榜日均涨（两边都要有样本）
    const recent = a.hits.filter((h) => h.idx >= win.length - 5).map((h) => h.pct)
    const earlier = a.hits.filter((h) => h.idx < win.length - 5).map((h) => h.pct)
    const avg = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length
    const accelerating = recent.length >= 1 && earlier.length >= 1 && avg(recent) > avg(earlier)
    let feature: MainlineFeature | null = null
    if (accelerating) feature = 'accelerating'
    else if (consecutive >= 3) feature = 'streak'
    else if (isActive && consecutive === 1) feature = 'new'
    else if (dates.length / win.length >= 0.5) feature = 'evergreen'

    rows.push({
      id,
      name: a.name,
      type: a.type,
      count: dates.length,
      consecutive,
      avgPct: sumPct / pcts.length,
      sumPct,
      lastDate: dates[dates.length - 1],
      isActive,
      feature,
    })
  })

  rows.sort(
    (x, y) => Number(y.isActive) - Number(x.isActive) || y.count - x.count || y.avgPct - x.avgPct,
  )
  return rows
}
