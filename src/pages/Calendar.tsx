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

const WEEKDAYS = ['一', '二', '三', '四', '五'];
const pctColor = (v: number) => (v > 0 ? COLOR_UP : v < 0 ? COLOR_DOWN : COLOR_FLAT);
const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 生成某月的格子（只含周一~周五；周六日不展示，用前置空格保证列对齐） */
function buildCells(year: number, month: number): (number | null)[] {
  const firstWd = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7; // 周一=0
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWd; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const wd = (new Date(Date.UTC(year, month - 1, d)).getUTCDay() + 6) % 7;
    if (wd >= 5) continue;   // 周末不展示
    cells.push(d);
  }
  return cells;
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
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px', borderRadius: 6,
          background: added.has(r.key) ? 'rgba(255,77,79,0.07)' : dropped.has(r.key) ? 'rgba(134,144,156,0.07)' : 'transparent',
        }}>
          <span style={{ width: 16, fontSize: 11, color: '#C9CDD4', flexShrink: 0 }}>{i + 1}</span>
          <span style={{
            flex: 1, minWidth: 0, fontSize: 12, color: COLOR_TEXT, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{r.name}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: pctColor(r.pct), flexShrink: 0 }}>{fmtPct(r.pct)}</span>
          <span style={{ fontSize: 11, color: '#86909C', width: 56, textAlign: 'right', flexShrink: 0 }}>
            {r.amount.toFixed(r.amount >= 100 ? 0 : 1)}{amountUnit}
          </span>
          {added.has(r.key) && <span style={{ fontSize: 10, color: COLOR_UP, flexShrink: 0 }}>新进</span>}
          {dropped.has(r.key) && <span style={{ fontSize: 10, color: '#86909C', flexShrink: 0 }}>掉出</span>}
        </div>
      ))}
    </div>
  );
}

function DiffCard({ title, a, b, amountUnit }: { title: string; a: DiffRow[]; b: DiffRow[]; amountUnit: string }) {
  const { added, dropped } = useMemo(() => diffKeys(a, b, (x) => x.key), [a, b]);
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT, marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <DiffColumn rows={a} added={added} dropped={dropped} amountUnit={amountUnit} />
        <div style={{ width: 1, background: '#F2F3F5' }} />
        <DiffColumn rows={b} added={added} dropped={dropped} amountUnit={amountUnit} />
      </div>
    </div>
  );
}

function ComparePanel({ a, b, onExit }: { a: string; b: string; onExit: () => void }) {
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
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
        background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '10px 14px', marginBottom: 12,
      }}>
        <div style={{ fontSize: 13, color: COLOR_TEXT }}>
          <span style={{ fontWeight: 600 }}>日期对比</span>
          <span style={{ marginLeft: 10, color: '#86909C' }}>左 = {a}　右 = {b}</span>
        </div>
        <button onClick={onExit}
          style={{ padding: '4px 12px', fontSize: 12, borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', color: '#4E5969' }}>
          退出对比
        </button>
      </div>

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
            <DiffCard title="板块涨幅 TOP10" a={toSectorRows(da.sectors.up)} b={toSectorRows(db.sectors.up)} amountUnit="亿" />
            <DiffCard title="板块跌幅 TOP10" a={toSectorRows(da.sectors.down)} b={toSectorRows(db.sectors.down)} amountUnit="亿" />
            {da.stocks && db.stocks ? (
              <>
                <DiffCard title="个股涨幅 TOP10" a={toStockRows(da.stocks.up)} b={toStockRows(db.stocks.up)} amountUnit="亿" />
                <DiffCard title="个股跌幅 TOP10" a={toStockRows(da.stocks.down)} b={toStockRows(db.stocks.down)} amountUnit="亿" />
                <DiffCard title="个股成交额 TOP10" a={toStockRows(da.stocks.volume)} b={toStockRows(db.stocks.volume)} amountUnit="亿" />
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

      {/* 工具栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
        background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: '10px 14px', marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => shift(-1)} aria-label="上个月"
            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', color: '#4E5969', fontSize: 15 }}>‹</button>
          <span style={{ fontSize: 15, fontWeight: 600, color: COLOR_TEXT, minWidth: 108, textAlign: 'center' }}>
            {y != null && m != null ? `${y} 年 ${m} 月` : '—'}
          </span>
          <button onClick={() => shift(1)} aria-label="下个月"
            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', color: '#4E5969', fontSize: 15 }}>›</button>
          <button
            onClick={() => { if (latest) { setY(Number(latest.slice(0, 4))); setM(Number(latest.slice(5, 7))); } }}
            style={{ marginLeft: 4, padding: '4px 10px', fontSize: 12, borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', color: '#4E5969' }}>
            最新
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
        <ComparePanel a={cmpA} b={cmpB} onExit={exitCompare} />
      )}

      {!loading && !error && (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: isMobile ? '10px 8px 14px' : '14px 16px 18px' }}>
          {/* 表头：周一~周五 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: isMobile ? 6 : 10, marginBottom: 8 }}>
            {WEEKDAYS.map((w) => (
              <div key={w} style={{ textAlign: 'center', fontSize: 12, color: '#86909C', fontWeight: 500 }}>
                {isMobile ? w : `周${w}`}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: isMobile ? 6 : 10 }}>
            {cells.map((d, i) => {
              if (d == null) return <div key={`b${i}`} />;
              const ds = `${y}-${pad2(m!)}-${pad2(d)}`;
              const info = dayMap.get(ds);
              const isA = cmpA === ds;
              const isB = cmpB === ds;
              const selected = isA || isB;
              const hs = heatStyle(info);
              return (
                <button
                  key={ds}
                  onClick={() => pickDate(ds)}
                  title={info ? `${ds} · 点击查看当日榜单` : `${ds} · 未归档（休市或早于归档起点）`}
                  style={{
                    textAlign: 'left', cursor: info ? 'pointer' : 'default',
                    minHeight: isMobile ? 62 : 86,
                    borderRadius: 10,
                    border: `1px solid ${selected ? '#111827' : hs.borderColor}`,
                    boxShadow: selected ? '0 0 0 2px rgba(17,24,39,0.12)' : 'none',
                    background: info ? hs.background : '#FAFBFC',
                    padding: isMobile ? '5px 6px' : '7px 9px',
                    font: 'inherit',
                    transition: 'transform .12s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 4 }}>
                    <span style={{ fontSize: isMobile ? 12 : 13, fontWeight: 600, color: info ? COLOR_TEXT : '#C9CDD4' }}>{d}</span>
                    {selected && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: '#fff', background: '#111827',
                        borderRadius: 6, padding: '0 4px', lineHeight: '14px',
                      }}>{isA ? 'A' : 'B'}</span>
                    )}
                  </div>

                  {!info && <div style={{ fontSize: 10, color: '#C9CDD4', marginTop: 6 }}>{new Date(Date.UTC(y!, m! - 1, d)).getUTCDay() % 6 === 0 ? '休市' : ''}</div>}

                  {info && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                        {info.limitUp != null && (
                          <span style={{ fontSize: 10, color: COLOR_UP, background: 'rgba(255,77,79,0.10)', borderRadius: 4, padding: '0 4px', lineHeight: '15px' }}>
                            涨停 {info.limitUp}
                          </span>
                        )}
                        {info.limitDown != null && info.limitDown > 0 && (
                          <span style={{ fontSize: 10, color: COLOR_DOWN, background: 'rgba(14,205,112,0.10)', borderRadius: 4, padding: '0 4px', lineHeight: '15px' }}>
                            跌停 {info.limitDown}
                          </span>
                        )}
                        {info.up != null && (
                          <span style={{ fontSize: 10, color: '#86909C' }}>{info.up}↑ / {info.down}↓</span>
                        )}
                      </div>
                      {info.topUp?.[0] && !isMobile && (
                        <div style={{
                          marginTop: 5, fontSize: 11, color: COLOR_TEXT, display: 'flex', justifyContent: 'space-between', gap: 4,
                        }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.topUp[0].name}</span>
                          <span style={{ color: COLOR_UP, fontWeight: 600, flexShrink: 0 }}>{fmtPct(info.topUp[0].pct)}</span>
                        </div>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>

          {/* 图例 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 14, fontSize: 11, color: '#86909C' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <i style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(255,77,79,0.30)', display: 'inline-block' }} />涨多
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <i style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(14,205,112,0.26)', display: 'inline-block' }} />跌多
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <i style={{ width: 12, height: 12, borderRadius: 3, background: '#FAFBFC', border: '1px solid #EDEFF2', display: 'inline-block' }} />未归档
            </span>
            <span>格内：涨停数 + 当日最强板块（成交额 ≥ 5 亿）</span>
          </div>
        </div>
      )}

      {openDate && (
        <CalendarDayModal
          date={openDate}
          onClose={() => setOpenDate(null)}
          onPrev={openIdx > 0 ? () => stepOpen(-1) : undefined}
          onNext={openIdx >= 0 && openIdx < dayList.length - 1 ? () => stepOpen(1) : undefined}
        />
      )}
    </div>
  );
}
