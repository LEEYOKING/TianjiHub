import { useState, useEffect, useRef } from 'react'
import { Card, Tooltip, Popover } from 'antd' // v2.0.7fs:删 Modal(心电图弹窗删除)
import {
  COLOR_UP,
  COLOR_TEXT,
  COLOR_PURPLE,
  COLOR_BLUE,
  COLOR_ORANGE,
} from '../utils/format'
import type { ReportData } from '../data/loader'
// v2.0.7fr:复用 Overview 的 PageHeader 组件(统一响应式布局 + zIndex 1 防蒙层穿透)
// — 之前 Surgery 自己手写 PageHeader,zIndex 100 > 蒙层 99 → 蒙层下方 PageHeader 仍可见
// — 移动端没区分 flex column → 标题+tag+date/time 全挤一行
import { PageHeader } from './Overview'
import { fetchZTPool, inTradingSession, livePollDelayMs, type LiveSealCard } from '../data/live'

interface SealCard {
  code: string
  name: string
  industry: string
  consecutiveDays: number
  firstSealTime: string
  bombedCount: number
  sealedAmount: number
  turnover: number
  changePercent: number
  closePrice: number
  ratio: number
  grade: 'S' | 'A' | 'B' | 'C'
  isLateSeal: boolean
}

interface BigLoser {
  code: string
  name: string
  industry: string
  changePercent: number
  turnoverRate: number
}

interface LoserChainItem {
  from: { code: string; name: string; consecutiveDays: number }
  to: BigLoser
}

interface LoserIntersection {
  code: string
  name: string
  industry: string
  changePercent: number
  turnoverRate: number
  prevStatus: string
}

interface SurgeryData {
  meta: { generatedAt: string; tradeDate: string; tradeDateSlash: string }
  sealCards: SealCard[]
  bigLoser: BigLoser[]
  loserChain: LoserChainItem[]
  loserIntersection: LoserIntersection[]
  prevLimitUpCount: number
  systemWarning: boolean
  north: { type: string; netBuy: number; netInflow: number; index: string; indexChange: number }[]
  northTotal: number
}

// 评级配色(S紫、A蓝、B橙、C浅绿),背景色统一变浅
const COLOR_C_LIGHT = '#52c41a'
// v2.0.7ay:背景色 + 0.05 透明度(用户反馈 0.4 太重,改 0.05 极淡背景)
const GRADE_STYLE: Record<string, { bg: string; border: string; letter: string; badge: string }> = {
  S: {
    bg: 'rgba(154, 129, 252, 0.05)',
    border: COLOR_PURPLE,
    letter: COLOR_PURPLE,
    badge: COLOR_PURPLE,
  },
  A: { bg: 'rgba(80, 162, 254, 0.05)', border: COLOR_BLUE, letter: COLOR_BLUE, badge: COLOR_BLUE },
  B: {
    bg: 'rgba(245, 154, 35, 0.05)',
    border: COLOR_ORANGE,
    letter: COLOR_ORANGE,
    badge: COLOR_ORANGE,
  },
  C: {
    bg: 'rgba(82, 196, 26, 0.05)',
    border: COLOR_C_LIGHT,
    letter: COLOR_C_LIGHT,
    badge: COLOR_C_LIGHT,
  },
}

// 气泡提示(用户 #13 反馈:hover 即弹出)
const HelpPopover = (
  <div style={{ width: 280, fontSize: 12, lineHeight: 1.7, color: '#4E5969' }}>
    <div style={{ fontWeight: 600, color: COLOR_TEXT, marginBottom: 6 }}>
      封成比 = 收盘封单金额 / 全天成交额
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: COLOR_PURPLE, fontWeight: 600 }}>S级</span>
      <span>封成比 &gt; 3(极致缩量)</span>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: COLOR_BLUE, fontWeight: 600 }}>A级</span>
      <span>封成比 1-3(健康换手)</span>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: COLOR_ORANGE, fontWeight: 600 }}>B级</span>
      <span>封成比 0.3-1(分歧较大)</span>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: COLOR_C_LIGHT, fontWeight: 600 }}>C级</span>
      <span>封成比 &lt; 0.3(烂板/弱势)</span>
    </div>
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #F0F0F0', color: '#86909C' }}>
      14:00 后首封标记"<span style={{ color: COLOR_UP }}>尾盘偷鸡</span>"并降一级
    </div>
  </div>
)

export default function Surgery(_props: { data?: ReportData }) {
  // 通过 useLive 拿 data(实际 props 也会传,但更稳的获取是从全局 context)
  // Surgery 数据来自 baseData.surgery(已合并到 data.json)
  // 我们需要从 useLive 找到 data(没直接暴露)— 通过 React 顶层 props 拿
  // 注:Surgery 数据 static,没法 live 更新;但页面通过父组件 props.data 拿到
  // 这里通过 context 拿不到 baseData,我们用 props
  // 改用 props
  return <SurgeryInner data={_props.data} />
}

/**
 * 盘中实时封成比(双层方案):
 *   · 交易时段内轮询东财涨停池 —— 14:00 前 120 秒一次,14:00(含)后 60 秒一次;
 *   · 休市/非交易日不轮询(5 分钟探一次是否开盘),直接沿用静态快照;
 *   · 拉取失败时保留上一次成功的数据,再失败就回退静态快照,不白屏。
 * 拉到的只有卡片数据,绝不会写回 data.json,不存在污染静态数据的可能。
 */
function useLiveSealCards() {
  const [cards, setCards] = useState<LiveSealCard[] | null>(null)
  const [at, setAt] = useState<number | null>(null)
  useEffect(() => {
    let timer = 0
    let cancelled = false
    let busy = false

    const tick = async () => {
      if (cancelled || busy) return
      busy = true
      let next = 300_000 // 休市:5 分钟探一次
      try {
        if (inTradingSession() && document.visibilityState === 'visible') {
          const res = await fetchZTPool()
          if (!cancelled && res) {
            setCards(res)
            setAt(Date.now())
          }
          next = livePollDelayMs()
        }
      } catch {
        next = livePollDelayMs()
      }
      busy = false
      if (!cancelled) timer = window.setTimeout(tick, next)
    }

    tick()
    // 切回前台立刻补一次(后台标签页不计时,回来时可能已过很久)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && inTradingSession()) {
        window.clearTimeout(timer)
        tick()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return { cards, at }
}

function SurgeryInner({ data }: { data?: ReportData }) {
  // v2.0.7fs:删 selectedCard state + Modal 弹窗("封板心电图")— user 反馈点击股票卡片不需要弹窗
  // 之前用 selectedCard state 记录点击的卡片,Modal 显示 SealCardDetail 组件
  // 现在直接删除:state/Modal/SealCardDetail 都不需要
  const surgery = data?.surgery
  // 盘中实时层:hook 必须在任何 return 之前调用
  const { cards: liveCards, at: liveAt } = useLiveSealCards()

  // v2.0.7fv:L1 修 — 删 v2.0.7fc debug 屏,生产环境显示 [Debug v2.0.7fc] 用户以为系统坏了
  if (!surgery) {
    return (
      <div style={{ padding: 24, color: '#86909C' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>加载中...</div>
      </div>
    )
  }

  const { sealCards, systemWarning, meta } = surgery as SurgeryData
  // 双层:交易时段拿到实时涨停池就覆盖静态卡片;拿不到/休市则用收盘定稿
  const shownCards: SealCard[] = liveCards ?? sealCards
  const isLiveNow = Boolean(liveCards)
  const inSession = inTradingSession()
  const refreshSec = livePollDelayMs() / 1000
  const liveClock = liveAt ? new Date(liveAt + 8 * 3600 * 1000).toISOString().slice(11, 19) : ''
  const { tradeDateSlash, tradeDate: _origTradeDate } = meta
  // v2.0.7av:08:00 之后,如果 data 是"昨天",显示 today(模拟新数据,跟 Overview 8:00 hook 一致)
  let displayDate = tradeDateSlash
  if (_origTradeDate) {
    const _now = new Date(Date.now() + 8 * 3600 * 1000)
    const _mins = _now.getUTCHours() * 60 + _now.getUTCMinutes()
    const _todayYMD = `${_now.getUTCFullYear()}${String(_now.getUTCMonth() + 1).padStart(2, '0')}${String(_now.getUTCDate()).padStart(2, '0')}`
    if (_mins >= 8 * 60 && _origTradeDate !== _todayYMD) {
      const yy = String(_now.getUTCFullYear()).slice(2)
      const mm = String(_now.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(_now.getUTCDate()).padStart(2, '0')
      displayDate = `${yy}/${mm}/${dd}`
    }
  }
  // v2.0.7ad:用 meta.generatedAt(数据本身生成时间) + tradeDate(数据交易日)
  // 不再用 live.fetchedAt(那是页面 fetch 时间,会跟着每次 live tick 变)
  // generatedTime 格式: HH:MM
  const generatedTime = (meta.generatedAt || '').split(' ')[1] || ''
  // v2.0.7fr:把 meta.generatedAt (e.g. "2026-08-22 16:14:30") 解析成 UTC ms 给 PageHeader lastUpdatedAt
  // — PageHeader 内部用 toShanghaiHM(lastUpdatedAt) 转成 HH:MM
  const lastUpdatedAtMs = meta.generatedAt
    ? Date.parse(meta.generatedAt.replace(' ', 'T') + '+08:00')
    : undefined

  return (
    <div>
      {/* v2.0.7fr:复用 Overview 的 PageHeader 组件 — 修 2 个 bug:
          1. zIndex 1 < 蒙层 99,蒙层打开时 PageHeader 被盖住(之前 Surgery 自己写 zIndex 100 > 蒙层 99)
          2. 移动端 flex column(标题+tag 上,date/time 下),不再文字挤在一行 */}
      <PageHeader
        title="全景手术台"
        tradeDateSlash={displayDate}
        subtitle={
          isLiveNow
            ? `盘中实时 · 涨停封成比每 ${refreshSec} 秒刷新 · 更新于 ${liveClock}`
            : `盘后深度复盘 · 涨停封成比动态评分 · 更新于 ${generatedTime}`
        }
        liveTag={isLiveNow ? (inSession ? '盘中实时' : '已收盘·定格') : '收盘复盘数据'}
        liveColor={isLiveNow ? '#0958D9' : '#4b5563'}
        liveBg={isLiveNow ? '#E6F4FF' : '#F0F1F2'}
        lastUpdatedAt={isLiveNow && liveAt ? liveAt : lastUpdatedAtMs}
      />

      {systemWarning && (
        <div
          style={{
            background: '#FFF1F0',
            border: '1px solid #FFA39E',
            borderRadius: 8,
            padding: '12px 20px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            color: '#CF1322',
            fontSize: 13,
          }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span>
            <b>【系统性退潮警告】</b>
            昨日涨停股今日大面积跌停,亏钱效应炸裂。建议:今日所有追高操作胜率低于
            20%,请清空短线仓位或逆回购。
          </span>
        </div>
      )}

      {/* 涨跌停封成比动态评分 — 用户 #13 反馈:删"S 紫 / A 蓝 / B 橙 / C 浅绿"文案,改 hover 气泡 */}
      <Card
        bodyStyle={{ padding: 20 }}
        style={{ borderRadius: 14, marginBottom: 16 }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: COLOR_TEXT }}>
              涨跌停封成比动态评分 ({shownCards.length}只)
            </span>
            <Popover content={HelpPopover} trigger="hover" placement="leftTop">
              {/* 用户 #13 反馈:浅灰色感叹号 icon,hover 即弹出气泡
                  用户 #12 反馈:去掉 cursor:help(不显示"?"icon) */}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  color: '#C9CDD4',
                }}>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </span>
            </Popover>
          </div>
        }>
        <SealCardGrid sealCards={shownCards} />
      </Card>
    </div>
  )
}

function SealCardItem({ card }: { card: SealCard }) {
  const s = GRADE_STYLE[card.grade]
  return (
    // v2.0.7fv:L8 修 — 移动端 Tooltip 触不发,加 trigger="click" + Popover 风格
    // 同时保留 hover 触发(PC 端)— 用 antd Tooltip 的 trigger="['hover','click']"
    <Tooltip
      title={`${card.name} (${card.code})\n封单 ${card.sealedAmount}亿 / 成交 ${card.turnover}亿\n首封 ${card.firstSealTime} ${card.isLateSeal ? '(尾盘偷鸡)' : ''}`}
      trigger={['hover', 'click']}>
      <div
        style={{
          background: s.bg, // v2.0.7ay:rgba alpha 0.05(用户反馈 0.4 太重改 0.05)
          border: `1.5px solid ${s.border}`,
          borderRadius: 8,
          padding: '12px 14px',
          cursor: 'default', // v2.0.7fs:删点击弹窗,改 default
          transition: 'transform .15s, box-shadow .15s',
          position: 'relative',
          minHeight: 110,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)'
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = ''
          e.currentTarget.style.boxShadow = ''
        }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 4,
            gap: 6,
          }}>
          {/* v2.0.7ei:股票名 14→16 + 右侧加股票代码(小字、灰色) */}
          <span style={{ fontSize: 16, fontWeight: 600, color: COLOR_TEXT }}>{card.name}</span>
          <span style={{ fontSize: 11, color: '#86909C', fontVariantNumeric: 'tabular-nums' }}>
            {card.code}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: s.letter,
              }}>
              {card.ratio.toFixed(2)}
            </span>
            <span style={{ fontSize: 10, color: '#86909C' }}>封成比</span>
          </div>
          {/* 用户 #11 反馈:评级 S\A\B\C 字号 30px(原 36) + 加粗 */}
          <div
            style={{
              fontSize: 30,
              fontWeight: 900,
              color: s.letter,
              fontFamily:
                '"PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              lineHeight: 1,
              letterSpacing: 0,
            }}>
            {card.grade}
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#86909C', lineHeight: 1.4 }}>
          连板{card.consecutiveDays} · 开板{card.bombedCount} · {card.firstSealTime}
          {card.isLateSeal && <span style={{ color: COLOR_UP, marginLeft: 4 }}>(尾盘偷鸡)</span>}
        </div>
      </div>
    </Tooltip>
  )
}

// v2.0.7ch:SealCardGrid 组件 — ResizeObserver + 最多 8 列 + 卡片最小 200px
// v2.0.7fs:删 onSelect prop(点击卡片不再弹"心电图"弹窗)
function SealCardGrid({ sealCards }: { sealCards: SealCard[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(8)

  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width
        // 列数 = min(8, max(1, floor(容器宽/200)))
        // 200 是卡片最小宽度,gap 10
        // 容器 2000px / 200 = 10 → 限制 8 列
        // 容器 1500px / 200 = 7.5 → 7 列
        // 容器 1000px / 200 = 5 列
        const newCols = Math.min(8, Math.max(1, Math.floor((w + 10) / 210)))
        setCols(newCols)
      }
    })
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 10,
      }}>
      {sealCards.map((card) => (
        <SealCardItem key={card.code} card={card} />
      ))}
    </div>
  )
}
