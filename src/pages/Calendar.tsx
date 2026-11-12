// 【日历回溯】—— 按交易日回看板块/个股榜单
// 数据：public/calendar/index.json（日期索引 + 每日摘要）+ public/calendar/YYYY-MM-DD.json（单日三张榜）
//
// 页面结构：
//   ① 月份切换 + 对比模式开关
//   ② 情绪热力日历（月视图，周一~周五；格子底色 = 当日涨跌家数强弱，格内 = 涨停数与最强板块）
//   ③ 点击某日 → 浮窗看三张榜（CalendarDayModal）
//   ④ 对比模式：依次点两天 → 并排 diff（摘要差值与榜单进出）
//
// 埋点：无需额外代码 —— index.html 引入的 Xhoper SDK 会 patch History，
//       路由切换自动上报 page_view（path=/calendar，title 取 document.title），与其它页面一致。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from './Overview';
import CalendarDayModal from '../components/CalendarDayModal';
import CalendarRankings from '../components/CalendarRankings';
import { useCalendarEvents } from '../data/calendarEvents';
import { findMainlines, FEATURE_LABEL, type MainlineFeature, type MainlineRow } from '../utils/calendar/period';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  dashToSlash,
  diffKeys,
  loadCalendarDay,
  useCalendarIndex,
  type CalendarDay,
  type CalendarIndexDay,
  type CalendarSector,
  type CalendarStock,
} from '../data/calendarData';
import { COLOR_DOWN, COLOR_FLAT, COLOR_TEXT, COLOR_UP } from '../utils/format';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const pctColor = (v: number) => (v > 0 ? COLOR_UP : v < 0 ? COLOR_DOWN : COLOR_FLAT);
const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 生成某月的格子：周一~周日 7 列，非交易日由调用方置灰 */
function buildCells(year: number, month: number): (number | null)[] {
  const firstWd = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7; // 周一=0
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWd; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

/** 该日是周几（周一=0 … 周日=6） */
function weekdayOf(year: number, month: number, day: number): number {
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** 格子的热力底色：涨多红、跌多绿；无摘要（历史仅板块榜）为中性 */
function heatStyle(d?: CalendarIndexDay): React.CSSProperties {
  if (!d || d.up == null || d.down == null) return { background: '#FFFFFF', borderColor: '#EDEFF2' };
  const total = d.up + d.down;
  if (!total) return { background: '#FFFFFF', borderColor: '#EDEFF2' };
  const r = d.up / total;
  if (r >= 0.5) {
    const k = Math.min(1, (r - 0.5) / 0.5);
    return { background: `rgba(255,77,79,${(0.06 + 0.34 * k).toFixed(3)})`, borderColor: 'rgba(255,77,79,0.22)' };
  }
  const k = Math.min(1, (0.5 - r) / 0.5);
  return { background: `rgba(14,205,112,${(0.06 + 0.30 * k).toFixed(3)})`, borderColor: 'rgba(14,205,112,0.22)' };
}

// ---------------- 主线识别 ----------------
/** 辅助标签配色：主标签（在榜/退潮）用实心，辅助标签用浅底色，避免抢主状态 */
const FEATURE_STYLE: Record<MainlineFeature, { color: string; bg: string }> = {
  accelerating: { color: '#D25F00', bg: 'rgba(245,166,35,0.14)' },
  streak: { color: '#1264C0', bg: 'rgba(24,144,255,0.12)' },
  new: { color: '#C4232A', bg: 'rgba(255,77,79,0.12)' },
  evergreen: { color: '#0E8A4F', bg: 'rgba(14,205,112,0.12)' },
};

function MainlineCard({ rows, windowDays }: { rows: MainlineRow[]; windowDays: number }) {
  const isMobile = useIsMobile();
  if (!rows.length) {
    return (
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: '12px 16px', marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: COLOR_TEXT }}>主线识别</div>
        <div style={{ fontSize: 12, color: '#86909C', marginTop: 6 }}>
          近 {windowDays} 个交易日暂无板块反复进入涨幅榜前五 —— 市场处于快速轮动、无明确主线状态。
        </div>
      </div>
    );
  }
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: '12px 16px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: COLOR_TEXT }}>主线识别</span>
        <span style={{ fontSize: 11, color: '#86909C' }}>
          近 {windowDays} 个交易日内进入「涨幅榜 TOP5」≥ 3 次；主标签 在榜/退潮，辅助标签 新晋/持续/加速/常青
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
        {rows.map((r) => (
          <div key={r.id} style={{
            border: `1px solid ${r.isActive ? 'rgba(255,77,79,0.28)' : '#EDEFF2'}`,
            background: r.isActive ? 'rgba(255,77,79,0.05)' : '#FAFBFC',
            borderRadius: 10, padding: '9px 11px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.name}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                {r.isActive ? (
                  <span style={{ fontSize: 10, color: '#fff', background: COLOR_UP, borderRadius: 6, padding: '1px 6px' }}>
                    在榜
                  </span>
                ) : (
                  <span style={{ fontSize: 10, color: '#86909C', background: '#F2F3F5', borderRadius: 6, padding: '1px 6px' }}>
                    退潮
                  </span>
                )}
                {r.feature && (
                  <span style={{
                    fontSize: 10, borderRadius: 6, padding: '1px 6px',
                    color: FEATURE_STYLE[r.feature].color,
                    background: FEATURE_STYLE[r.feature].bg,
                  }}>
                    {FEATURE_LABEL[r.feature]}
                  </span>
                )}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6, fontSize: 11, color: '#86909C' }}>
              <span>上榜 <b style={{ color: COLOR_TEXT, fontSize: 15 }}>{r.count}</b> 次</span>
              {r.consecutive > 0 && <span>连续 {r.consecutive} 天</span>}
              <span style={{ marginLeft: 'auto', color: pctColor(r.avgPct), fontWeight: 600 }}>
                均涨 {fmtPct(r.avgPct)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- 对比：榜单并排 diff ----------------
type DiffRow = { key: string; name: string; pct: number; amount: number };

function toSectorRows(rows: CalendarSector[]): DiffRow[] {
  return rows.map((r) => ({ key: r.id, name: r.name, pct: r.pct, amount: r.amt }));
}
function toStockRows(rows: CalendarStock[]): DiffRow[] {
  return rows.map((r) => ({ key: r.code, name: r.name, pct: r.pct, amount: r.amount }));
}

function DiffColumn({ rows, added, dropped, amountUnit }: {
  rows: DiffRow[]; added: Set<string>; dropped: Set<string>; amountUnit: string;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {rows.length === 0 && <div style={{ fontSize: 12, color: '#C9CDD4', padding: '10px 0' }}>无数据</div>}
      {rows.map((r, i) => (
        <div key={r.key} style={{
          // 固定列宽栅格：名次/名称/涨跌幅/成交额/标记 五列在所有行严格对齐，
          // 避免有无「新进/掉出」标记时元素宽度不同造成视觉错位
          display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr) 54px 58px 28px',
          alignItems: 'center', columnGap: 6, padding: '5px 6px', borderRadius: 6,
          background: added.has(r.key) ? 'rgba(255,77,79,0.07)' : dropped.has(r.key) ? 'rgba(134,144,156,0.07)' : 'transparent',
        }}>
          <span style={{ fontSize: 11, color: '#C9CDD4', textAlign: 'left' }}>{i + 1}</span>
          <span style={{
            fontSize: 12, color: COLOR_TEXT, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{r.name}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: pctColor(r.pct), textAlign: 'right' }}>{fmtPct(r.pct)}</span>
          <span style={{ fontSize: 11, color: '#86909C', textAlign: 'right' }}>
            {r.amount.toFixed(r.amount >= 100 ? 0 : 1)}{amountUnit}
          </span>
          <span style={{ fontSize: 10, textAlign: 'right', color: added.has(r.key) ? COLOR_UP : '#86909C' }}>
            {added.has(r.key) ? '新进' : dropped.has(r.key) ? '掉出' : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

function DiffCard({ title, a, b, amountUnit, aDate, bDate }: {
  title: string; a: DiffRow[]; b: DiffRow[]; amountUnit: string; aDate: string; bDate: string;
}) {
  const { added, dropped } = useMemo(() => diffKeys(a, b, (x) => x.key), [a, b]);
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT }}>{title}</span>
        <span style={{ fontSize: 11, color: '#86909C' }}>左 {aDate} ｜ 右 {bDate}</span>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <DiffColumn rows={a} added={added} dropped={dropped} amountUnit={amountUnit} />
        <div style={{ width: 1, background: '#F2F3F5' }} />
        <DiffColumn rows={b} added={added} dropped={dropped} amountUnit={amountUnit} />
      </div>
    </div>
  );
}

function ComparePanel({ a, b }: { a: string; b: string }) {
  const isMobile = useIsMobile();
  const [da, setDa] = useState<CalendarDay | null>(null);
  const [db, setDb] = useState<CalendarDay | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setErr(null);
    Promise.all([loadCalendarDay(a), loadCalendarDay(b)])
      .then(([x, y]) => {
        if (!alive) return;
        setDa(x);
        setDb(y);
      })
      .catch((e) => alive && setErr(String(e?.message || e)));
    return () => {
      alive = false;
    };
  }, [a, b]);

  const statRows: { label: string; va?: number; vb?: number; unit?: string; colorOf?: (v: number) => string }[] = [
    { label: '上涨家数', va: da?.summary.up, vb: db?.summary.up, colorOf: () => COLOR_UP },
    { label: '下跌家数', va: da?.summary.down, vb: db?.summary.down, colorOf: () => COLOR_DOWN },
    { label: '涨停数', va: da?.summary.limitUp, vb: db?.summary.limitUp, colorOf: () => COLOR_UP },
    { label: '跌停数', va: da?.summary.limitDown, vb: db?.summary.limitDown, colorOf: () => COLOR_DOWN },
    { label: '总成交额', va: da?.summary.turnover, vb: db?.summary.turnover, unit: '亿' },
  ];

  return (
    <div style={{ marginBottom: 16 }}>
      {err && <div style={{ color: '#E60012', fontSize: 13, marginBottom: 10 }}>加载失败：{err}</div>}
      {!da || !db ? (
        <div style={{ fontSize: 13, color: '#86909C', padding: '16px 0' }}>加载中…</div>
      ) : (
        <>
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '10px 14px', marginBottom: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', fontSize: 12, color: '#86909C', fontWeight: 500, padding: '6px 8px' }}></th>
                  <th style={{ textAlign: 'right', fontSize: 12, color: '#86909C', fontWeight: 500, padding: '6px 8px' }}>{a}</th>
                  <th style={{ textAlign: 'right', fontSize: 12, color: '#86909C', fontWeight: 500, padding: '6px 8px' }}>{b}</th>
                  <th style={{ textAlign: 'right', fontSize: 12, color: '#86909C', fontWeight: 500, padding: '6px 8px' }}>变化</th>
                </tr>
              </thead>
              <tbody>
                {statRows.map((r) => {
                  const diff = r.va != null && r.vb != null ? r.vb - r.va : undefined;
                  return (
                    <tr key={r.label} style={{ borderTop: '1px solid #F2F3F5' }}>
                      <td style={{ fontSize: 13, color: COLOR_TEXT, padding: '7px 8px' }}>{r.label}</td>
                      <td style={{ fontSize: 13, textAlign: 'right', padding: '7px 8px', color: r.colorOf ? r.colorOf(r.va || 0) : COLOR_TEXT }}>
                        {r.va != null ? `${r.va}${r.unit || ''}` : '-'}
                      </td>
                      <td style={{ fontSize: 13, textAlign: 'right', padding: '7px 8px', color: r.colorOf ? r.colorOf(r.vb || 0) : COLOR_TEXT }}>
                        {r.vb != null ? `${r.vb}${r.unit || ''}` : '-'}
                      </td>
                      <td style={{ fontSize: 13, textAlign: 'right', padding: '7px 8px', color: diff == null ? '#C9CDD4' : diff > 0 ? COLOR_UP : diff < 0 ? COLOR_DOWN : COLOR_FLAT }}>
                        {diff == null ? '-' : `${diff > 0 ? '+' : ''}${Math.round(diff * 100) / 100}${r.unit || ''}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <DiffCard title="板块涨幅 TOP10" a={toSectorRows(da.sectors.up)} b={toSectorRows(db.sectors.up)} amountUnit="亿" aDate={a} bDate={b} />
            <DiffCard title="板块跌幅 TOP10" a={toSectorRows(da.sectors.down)} b={toSectorRows(db.sectors.down)} amountUnit="亿" aDate={a} bDate={b} />
            {da.stocks && db.stocks ? (
              <>
                <DiffCard title="个股涨幅 TOP10" a={toStockRows(da.stocks.up)} b={toStockRows(db.stocks.up)} amountUnit="亿" aDate={a} bDate={b} />
                <DiffCard title="个股跌幅 TOP10" a={toStockRows(da.stocks.down)} b={toStockRows(db.stocks.down)} amountUnit="亿" aDate={a} bDate={b} />
                <DiffCard title="个股成交额 TOP10" a={toStockRows(da.stocks.volume)} b={toStockRows(db.stocks.volume)} amountUnit="亿" aDate={a} bDate={b} />
              </>
            ) : (
              <div style={{
                gridColumn: isMobile ? 'auto' : '1 / -1', background: '#fff', border: '1px dashed #E5E7EB',
                borderRadius: 12, padding: '14px 16px', fontSize: 12, color: '#86909C', lineHeight: 1.8,
              }}>
                个股榜只能逐日累积（无历史接口），所以 5–10 月的历史日期没有个股榜。请选两个「日历上线后」的交易日做个股对比。
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- 页面 ----------------
export default function Calendar() {
  const { index, loading, error } = useCalendarIndex();
  const isMobile = useIsMobile();
  const [y, setY] = useState<number | null>(null);
  const [m, setM] = useState<number | null>(null);
  const [view, setView] = useState<'calendar' | 'week' | 'month'>('calendar');
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [compareOn, setCompareOn] = useState(false);
  const [cmpA, setCmpA] = useState<string | null>(null);
  const [cmpB, setCmpB] = useState<string | null>(null);

  const dayMap = useMemo(() => {
    const map = new Map<string, CalendarIndexDay>();
    (index?.days || []).forEach((d) => map.set(d.date, d));
    return map;
  }, [index]);

  // 默认展示最新交易日月
  useEffect(() => {
    if (y != null || !index?.meta.lastDate) return;
    setY(Number(index.meta.lastDate.slice(0, 4)));
    setM(Number(index.meta.lastDate.slice(5, 7)));
  }, [index, y]);

  const shift = (delta: number) => {
    if (y == null || m == null) return;
    const t = y * 12 + (m - 1) + delta;
    setY(Math.floor(t / 12));
    setM((t % 12) + 1);
  };

  const pickDate = useCallback((date: string) => {
    if (!compareOn) {
      setOpenDate(date);
      return;
    }
    if (!cmpA) {
      setCmpA(date);
      setCmpB(null);
    } else if (!cmpB && date !== cmpA) {
      setCmpB(date);
    } else if (!cmpB) {
      setCmpB(null);
    } else {
      // 已有一对 → 滚动：A 取旧 B，B 取新点
      setCmpA(cmpB);
      setCmpB(date);
    }
  }, [compareOn, cmpA, cmpB]);

  const exitCompare = () => {
    setCompareOn(false);
    setCmpA(null);
    setCmpB(null);
  };

  const cells = y != null && m != null ? buildCells(y, m) : [];
  const latest = index?.meta.lastDate || '';
  const earliest = index?.meta.firstDate || '';
  // 交易日清单：有归档窗口内、工作日、但不在清单里 = 真休市（节假日）
  const tradeSet = useMemo(() => new Set(index?.meta.tradeDates || []), [index]);
  const hasTradeList = !!index?.meta.tradeDates?.length;

  // 当前月份的交易天数：优先用真实交易日清单，缺失时退回已归档天数
  const monthTradeCount = useMemo(() => {
    if (y == null || m == null) return 0;
    const prefix = `${y}-${pad2(m)}`;
    const src = hasTradeList ? (index?.meta.tradeDates || []) : (index?.days || []).map((d) => d.date);
    return src.filter((d) => d.startsWith(prefix)).length;
  }, [index, y, m, hasTradeList]);

  // 最旧月份：不允许再往前翻（数据保留，只在交互上拦截）
  const minYM = earliest ? { y: Number(earliest.slice(0, 4)), m: Number(earliest.slice(5, 7)) } : null;
  const atMinMonth = !!(y != null && m != null && minYM && y * 12 + m <= minYM.y * 12 + minYM.m);
  // 最晚只到「当前自然月」与「最后归档月」中较早的那个，不允许翻到未来
  const now = new Date();
  const monthOf = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7));
  const maxMonth = Math.min(monthOf(latest || '') || (now.getFullYear() * 12 + now.getMonth() + 1),
    now.getFullYear() * 12 + now.getMonth() + 1);
  const atMaxMonth = !!(y != null && m != null && y * 12 + m >= maxMonth);

  // 主线识别：只用 index.json 的每日 TOP5，进入页面即可算，不额外拉数据
  // 窗口取 20 个交易日 —— 实测 10 日窗内没有任何板块能进榜 3 次（板块轮动极快），
  // 20 日窗口才能稳定识别出「反复走强」的方向
  const MAINLINE_WINDOW = 20;
  const mainlines = useMemo(
    () => findMainlines(index?.days || [], MAINLINE_WINDOW, 3).slice(0, 8),
    [index],
  );

  // 事件标注（localStorage）
  const events = useCalendarEvents();
  const eventDates = useMemo(() => new Set(events.map((e) => e.date)), [events]);
  const monthEvents = useMemo(
    () => (y != null && m != null
      ? events
          .filter((e) => e.date.startsWith(`${y}-${pad2(m)}`))
          .sort((a, b) => a.date.localeCompare(b.date))
      : []),
    [events, y, m],
  );

  // 弹窗内 ← → 翻页：在已归档日期序列里前后移动
  const dayList = index?.days || [];
  const openIdx = openDate ? dayList.findIndex((d) => d.date === openDate) : -1;
  const stepOpen = (delta: number) => {
    const j = openIdx + delta;
    if (openIdx >= 0 && j >= 0 && j < dayList.length) setOpenDate(dayList[j].date);
  };

  return (
    <div>
      <PageHeader
        title="日历回溯"
        tradeDateSlash={dashToSlash(latest)}
        subtitle="按交易日回看板块与个股榜单 · 支持两天对比"
        liveTag="收盘归档"
        lastUpdatedAt={0}
      />

      {/* 视图切换：日历 / 周榜 / 月榜 */}
      <div style={{
        display: 'inline-flex', gap: 4, padding: 4, marginBottom: 14,
        background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12,
      }}>
        {([
          { k: 'calendar', label: '日历' },
          { k: 'week', label: '周榜' },
          { k: 'month', label: '月榜' },
        ] as const).map((t) => (
          <button
            key={t.k}
            onClick={() => { setView(t.k); if (t.k !== 'calendar') exitCompare(); }}
            style={{
              padding: '6px 16px', fontSize: 13, borderRadius: 8, cursor: 'pointer', fontWeight: 500,
              border: 'none',
              background: view === t.k ? '#111827' : 'transparent',
              color: view === t.k ? '#fff' : '#4E5969',
              transition: 'all .15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === 'calendar' ? (
        <>
      <MainlineCard rows={mainlines} windowDays={MAINLINE_WINDOW} />

      {/* 大卡片：头部工具栏 / 对比结果 / 日历网格 / 图例 同处一张卡片 */}
      <div style={{
        background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
          padding: '10px 14px', borderBottom: '1px solid #EDEFF2',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span title={atMinMonth ? '仅支持查询6个月内数据' : '上个月'} style={{ display: 'inline-flex' }}>
            <button
              onClick={() => { if (!atMinMonth) shift(-1); }}
              disabled={atMinMonth}
              aria-label="上个月"
              style={{
                width: 34, height: 40, borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff',
                cursor: atMinMonth ? 'default' : 'pointer', color: '#4E5969', fontSize: 16,
                opacity: atMinMonth ? 0.35 : 1,
              }}>‹</button>
          </span>
          <span style={{ minWidth: 116, textAlign: 'center', display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: COLOR_TEXT }}>
              {y != null && m != null ? `${y} 年 ${m} 月` : '—'}
            </span>
            <span style={{ fontSize: 11, color: '#A9AEB8' }}>
              共 <b style={{ color: COLOR_TEXT, fontWeight: 600 }}>{monthTradeCount}</b> 交易日
            </span>
          </span>
          <span title={atMaxMonth ? '已是最新月份' : '下个月'} style={{ display: 'inline-flex' }}>
            <button
              onClick={() => { if (!atMaxMonth) shift(1); }}
              disabled={atMaxMonth}
              aria-label="下个月"
              style={{
                width: 34, height: 40, borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff',
                cursor: atMaxMonth ? 'default' : 'pointer', color: '#4E5969', fontSize: 16,
                opacity: atMaxMonth ? 0.35 : 1,
              }}>›</button>
          </span>
          <button
            onClick={() => {
              const todayMonth = now.getFullYear() * 12 + now.getMonth() + 1;
              const t = Math.min(Math.max(todayMonth, minYM ? minYM.y * 12 + minYM.m : todayMonth), maxMonth || todayMonth);
              setY(Math.floor((t - 1) / 12));
              setM(((t - 1) % 12) + 1);
            }}
            style={{ marginLeft: 4, padding: '4px 10px', fontSize: 12, borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', color: '#4E5969', height: 30 }}>
            回到今天
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {compareOn && (
            <span style={{ fontSize: 12, color: '#86909C' }}>
              {cmpA ? `A：${cmpA}` : '点击选择基准日 A'}
              {cmpA && !cmpB ? ' → 再点一天作为 B' : ''}
              {cmpB ? `　B：${cmpB}` : ''}
            </span>
          )}
          <button
            onClick={() => {
              if (compareOn) exitCompare();
              else { setCompareOn(true); setCmpA(null); setCmpB(null); setOpenDate(null); }
            }}
            style={{
              padding: '5px 14px', fontSize: 12, borderRadius: 8, cursor: 'pointer', fontWeight: 500,
              border: `1px solid ${compareOn ? '#111827' : '#E5E7EB'}`,
              background: compareOn ? '#111827' : '#fff',
              color: compareOn ? '#fff' : '#4E5969',
            }}
          >
            {compareOn ? '取消对比' : '日期对比'}
          </button>
        </div>
      </div>

      {loading && <div style={{ padding: 40, textAlign: 'center', color: '#86909C', fontSize: 13 }}>日历数据加载中…</div>}
      {error && <div style={{ padding: 24, color: '#E60012', fontSize: 13 }}>日历数据加载失败：{error}</div>}

      {!!cmpA && !!cmpB && (
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #EDEFF2', background: '#FCFCFD' }}>
          <ComparePanel a={cmpA} b={cmpB} />
        </div>
      )}

      {!loading && !error && (
        <div style={{ padding: '12px 14px' }}>
          {/* 日历网格：大卡片内部的独立小卡片，四周留白 */}
          <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
              {WEEKDAYS.map((w, i) => (
                <div
                  key={w}
                  style={{
                    textAlign: 'center',
                    padding: isMobile ? '11px 0' : '14px 0',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#4E5969',
                    background: '#FAFBFC',
                    borderRight: i < 6 ? '1px solid #EDEFF2' : 'none',
                    borderBottom: '1px solid #E5E7EB',
                  }}
                >
                  {isMobile ? w : `周${w}`}
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
              {cells.map((d, i) => {
                if (d == null) {
                  // 月初空位：保留格线，让网格连续
                  return <div key={`b${i}`} style={{
                    background: '#FAFBFC',
                    borderRight: i % 7 !== 6 ? '1px solid #F2F3F5' : 'none',
                    borderBottom: '1px solid #F2F3F5',
                  }} />;
                }
                const ds = `${y}-${pad2(m!)}-${pad2(d)}`;
                const info = dayMap.get(ds);
                const isA = cmpA === ds;
                const isB = cmpB === ds;
                const selected = isA || isB;
                const hs = heatStyle(info);
                const wd = weekdayOf(y!, m!, d);
                const weekend = wd >= 5;
                // 休市 = 无归档 且（不在交易日清单里 且 不晚于最后归档日）
                // 节假日与周末同样处理；清单缺失时退化为「只认周末」
                const closed = !info && (hasTradeList
                  ? (!tradeSet.has(ds) && ds <= latest)
                  : weekend);
                const closedLabel = weekend ? '周末休市' : '节假日休市';
                return (
                  <button
                    key={ds}
                    onClick={() => { if (info) pickDate(ds); }}
                    title={
                      info
                        ? `${ds} · 点击查看当日榜单`
                        : closed
                          ? `${ds} · ${closedLabel}`
                          : `${ds} · 未归档（待补跑或晚于最后归档日）`
                    }
                    style={{
                      position: 'relative',
                      textAlign: 'center', cursor: info ? 'pointer' : 'default',
                      minHeight: isMobile ? 74 : 108,
                      borderRadius: 0,
                      border: 'none',
                      borderRight: i % 7 !== 6 ? '1px solid #F2F3F5' : 'none',
                      borderBottom: '1px solid #F2F3F5',
                      boxShadow: selected ? 'inset 0 0 0 2px #111827' : 'none',
                      // 周末与节假日统一用同一种「无数据」底色（#FAFBFC），只靠格内「休市」文案区分
                      background: info ? hs.background : '#FAFBFC',
                      padding: isMobile ? '6px 5px 8px' : '8px 8px 10px',
                      font: 'inherit',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'background .12s ease',
                    }}
                  >
                    {/* 角标：事件圆点 / 对比 A-B，绝对定位，不干扰日期居中 */}
                    <div style={{ position: 'absolute', top: isMobile ? 5 : 7, right: isMobile ? 5 : 7, display: 'flex', alignItems: 'center', gap: 4 }}>
                      {eventDates.has(ds) && (
                        <i
                          title="该日有事件标注"
                          style={{ width: 5, height: 5, borderRadius: '50%', background: '#F5A623', display: 'inline-block' }}
                        />
                      )}
                      {selected && (
                        <span style={{
                          fontSize: 11, fontWeight: 700, color: '#fff', background: '#111827',
                          borderRadius: 6, padding: '0 4px', lineHeight: '15px',
                        }}>{isA ? 'A' : 'B'}</span>
                      )}
                    </div>

                    {/* 第一要素：日期数字居中，加大加粗 */}
                    <span style={{
                      fontSize: isMobile ? 20 : 26,
                      fontWeight: 700,
                      lineHeight: 1,
                      letterSpacing: '-0.02em',
                      color: info ? '#111827' : closed ? '#B4B9C1' : '#C9CDD4',
                    }}>{d}</span>

                    {!info && closed && (
                      <div style={{ fontSize: 11, color: '#B4B9C1', marginTop: 7 }}>休市</div>
                    )}

                    {info && (
                      <>
                        {info.topUp?.[0] && (
                          <div style={{
                            marginTop: 7, display: 'flex', alignItems: 'baseline', justifyContent: 'center',
                            gap: 3, maxWidth: '100%', lineHeight: 1.2,
                          }}>
                            <span style={{
                              fontSize: 12, color: '#4E5969', maxWidth: isMobile ? 52 : 78,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>{info.topUp[0].name}</span>
                            <span style={{ fontSize: 12, color: COLOR_UP, fontWeight: 600, flexShrink: 0 }}>
                              {fmtPct(info.topUp[0].pct)}
                            </span>
                          </div>
                        )}
                        {!isMobile && (
                          <div style={{ marginTop: 4, fontSize: 11, color: '#86909C' }}>
                            {info.limitUp != null ? `涨停 ${info.limitUp}` : ''}
                            {info.up != null ? `${info.limitUp != null ? ' · ' : ''}${info.up}↑ ${info.down}↓` : ''}
                          </div>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{
            marginTop: 12, paddingTop: 10, borderTop: '1px solid #F2F3F5',
          }}>

          {/* 图例 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 11, color: '#86909C' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <i style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(255,77,79,0.30)', display: 'inline-block' }} />涨多
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <i style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(14,205,112,0.26)', display: 'inline-block' }} />跌多
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <i style={{ width: 12, height: 12, borderRadius: 3, background: '#FAFBFC', border: '1px solid #EDEFF2', display: 'inline-block' }} />休市 / 未归档
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <i style={{ width: 6, height: 6, borderRadius: '50%', background: '#F5A623', display: 'inline-block' }} />有事件标注
            </span>
            <span>格内：涨停数 + 当日最强板块（成交额 ≥ 5 亿）</span>
          </div>

          {/* 本月事件 */}
          {monthEvents.length > 0 && (
            <div style={{ marginTop: 14, borderTop: '1px solid #F2F3F5', paddingTop: 12 }}>
              <div style={{ fontSize: 12, color: '#86909C', marginBottom: 6 }}>本月事件标注</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {monthEvents.map((e) => (
                  <div key={`${e.date}-${e.createdAt}`} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                    <span
                      onClick={() => setOpenDate(e.date)}
                      style={{ color: '#4E5969', fontWeight: 600, width: 74, flexShrink: 0, cursor: 'pointer' }}
                    >{e.date.slice(5)}</span>
                    <span style={{ color: COLOR_TEXT }}>{e.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        </div>
      )}
      </div>

      {openDate && (
        <CalendarDayModal
          date={openDate}
          onClose={() => setOpenDate(null)}
          onPrev={openIdx > 0 ? () => stepOpen(-1) : undefined}
          onNext={openIdx >= 0 && openIdx < dayList.length - 1 ? () => stepOpen(1) : undefined}
        />
      )}
        </>
      ) : (
        <CalendarRankings kind={view} />
      )}
    </div>
  );
}
