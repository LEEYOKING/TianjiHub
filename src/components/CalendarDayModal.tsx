// 日历回溯 · 单日详情浮窗
// 展示某交易日收盘后的三张榜：板块涨/跌 TOP10、个股涨/跌/成交额 TOP10。
// 数据按需从 public/calendar/YYYY-MM-DD.json 拉取（父页面已做按日缓存）。
import { useEffect, useState } from 'react';
import { loadCalendarDay, type CalendarDay, type CalendarSector, type CalendarStock, type CalendarSummary } from '../data/calendarData';
import { addEvent, removeEvent, useCalendarEvents } from '../data/calendarEvents';
import { COLOR_DOWN, COLOR_FLAT, COLOR_TEXT, COLOR_UP } from '../utils/format';
import { useIsMobile } from '../hooks/useIsMobile';

interface Props {
  date: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

const pctColor = (v: number) => (v > 0 ? COLOR_UP : v < 0 ? COLOR_DOWN : COLOR_FLAT);
const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ minWidth: 74 }}>
      <div style={{ fontSize: 11, color: '#86909C', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color || COLOR_TEXT, lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}

function SummaryBar({ s }: { s: CalendarSummary }) {
  if (s.up == null && s.turnover == null) {
    return <div style={{ fontSize: 12, color: '#86909C' }}>该日未归档大盘摘要（仅板块榜有历史）</div>;
  }
  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <Stat label="上涨" value={String(s.up ?? '-')} color={COLOR_UP} />
      <Stat label="下跌" value={String(s.down ?? '-')} color={COLOR_DOWN} />
      <Stat label="涨停" value={String(s.limitUp ?? '-')} color={COLOR_UP} />
      <Stat label="跌停" value={String(s.limitDown ?? '-')} color={COLOR_DOWN} />
      <Stat label="炸板" value={String(s.brokenLimit ?? '-')} />
      <Stat label="成交额" value={s.turnover != null ? `${Math.round(s.turnover)}亿` : '-'} />
    </div>
  );
}

const NUM_TD: React.CSSProperties = { padding: '7px 8px', fontSize: 13, textAlign: 'right', whiteSpace: 'nowrap' };
const HEAD_TD: React.CSSProperties = { padding: '7px 8px', fontSize: 12, color: '#86909C', fontWeight: 500, textAlign: 'right', whiteSpace: 'nowrap' };

function SectorTable({ rows, tone }: { rows: CalendarSector[]; tone: 'up' | 'down' }) {
  if (!rows.length) return <div style={{ fontSize: 12, color: '#86909C', padding: '12px 0' }}>无数据</div>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...HEAD_TD, textAlign: 'left', width: 28 }}>#</th>
          <th style={{ ...HEAD_TD, textAlign: 'left' }}>板块</th>
          <th style={HEAD_TD}>涨跌幅</th>
          <th style={HEAD_TD}>成交额</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id} style={{ borderTop: '1px solid #F2F3F5' }}>
            <td style={{ ...NUM_TD, textAlign: 'left', color: '#C9CDD4' }}>{i + 1}</td>
            <td style={{ ...NUM_TD, textAlign: 'left', fontWeight: 500, color: COLOR_TEXT }}>
              {r.name}
              <span style={{ marginLeft: 6, fontSize: 11, color: '#C9CDD4' }}>
                {r.type === 'concept' ? '概念' : r.type === 'region' ? '地域' : '行业'}
              </span>
            </td>
            <td style={{ ...NUM_TD, fontWeight: 600, color: tone === 'up' ? pctColor(r.pct) : pctColor(r.pct) }}>{fmtPct(r.pct)}</td>
            <td style={{ ...NUM_TD, color: '#86909C' }}>{r.amt.toFixed(0)}亿</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StockTable({ rows, kind }: { rows: CalendarStock[]; kind: 'pct' | 'amount' }) {
  if (!rows.length) return <div style={{ fontSize: 12, color: '#86909C', padding: '12px 0' }}>无数据</div>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...HEAD_TD, textAlign: 'left', width: 28 }}>#</th>
          <th style={{ ...HEAD_TD, textAlign: 'left' }}>名称</th>
          <th style={HEAD_TD}>涨跌幅</th>
          <th style={HEAD_TD}>成交额</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.code} style={{ borderTop: '1px solid #F2F3F5' }}>
            <td style={{ ...NUM_TD, textAlign: 'left', color: '#C9CDD4' }}>{i + 1}</td>
            <td style={{ ...NUM_TD, textAlign: 'left', fontWeight: 500, color: COLOR_TEXT }}>
              {r.name}
              <span style={{ marginLeft: 6, fontSize: 11, color: '#C9CDD4' }}>{r.code}</span>
            </td>
            <td style={{ ...NUM_TD, fontWeight: kind === 'pct' ? 600 : 500, color: pctColor(r.pct) }}>{fmtPct(r.pct)}</td>
            <td style={{ ...NUM_TD, color: '#86909C' }}>{r.amount.toFixed(1)}亿</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT }}>{title}</span>
        {hint && <span style={{ fontSize: 11, color: '#C9CDD4' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export default function CalendarDayModal({ date, onClose, onPrev, onNext }: Props) {
  const isMobile = useIsMobile();
  const [day, setDay] = useState<CalendarDay | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const allEvents = useCalendarEvents();
  const myEvents = allEvents.filter((e) => e.date === date);

  useEffect(() => {
    let alive = true;
    setDay(null);
    setErr(null);
    setDraft('');
    loadCalendarDay(date)
      .then((d) => alive && setDay(d))
      .catch((e) => alive && setErr(String(e?.message || e)));
    return () => {
      alive = false;
    };
  }, [date]);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
      if (e.key === 'ArrowRight' && onNext) onNext();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, onPrev, onNext]);

  const stocks = day?.stocks;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(17,24,39,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 8 : 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 1080, maxHeight: '90vh', overflowY: 'auto',
          background: '#F7F9FC', borderRadius: 16, padding: isMobile ? '14px 12px 18px' : '20px 22px 24px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        {/* 头部 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: isMobile ? 17 : 20, fontWeight: 700, color: COLOR_TEXT }}>{date}</span>
            <span style={{ fontSize: 11, color: '#86909C', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '2px 8px' }}>
              收盘归档
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {onPrev && (
              <button onClick={onPrev} title="上一交易日（←）"
                style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', color: '#4E5969' }}>‹</button>
            )}
            {onNext && (
              <button onClick={onNext} title="下一交易日（→）"
                style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', color: '#4E5969' }}>›</button>
            )}
            <button onClick={onClose} title="关闭（Esc）"
              style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', color: '#4E5969' }}>✕</button>
          </div>
        </div>

        {err && <div style={{ color: '#E60012', fontSize: 13, marginBottom: 12 }}>加载失败：{err}</div>}
        {!day && !err && <div style={{ color: '#86909C', fontSize: 13, padding: '24px 0' }}>加载中…</div>}

        {day && (
          <>
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
              <SummaryBar s={day.summary} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <Section title="板块涨幅 TOP10" hint="成交额 ≥ 5 亿">
                <SectorTable rows={day.sectors.up} tone="up" />
              </Section>
              <Section title="板块跌幅 TOP10" hint="成交额 ≥ 5 亿">
                <SectorTable rows={day.sectors.down} tone="down" />
              </Section>
            </div>

            {stocks ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <Section title="个股涨幅 TOP10" hint="剔除 ST / 首日次新">
                    <StockTable rows={stocks.up} kind="pct" />
                  </Section>
                  <Section title="个股跌幅 TOP10" hint="剔除 ST / 首日次新">
                    <StockTable rows={stocks.down} kind="pct" />
                  </Section>
                </div>
                <Section title="个股成交额 TOP10" hint="全市场">
                  <StockTable rows={stocks.volume} kind="amount" />
                </Section>
              </>
            ) : (
              <div style={{ background: '#fff', border: '1px dashed #E5E7EB', borderRadius: 12, padding: '18px 16px', fontSize: 12, color: '#86909C', lineHeight: 1.8 }}>
                该交易日只有板块榜 —— 个股榜没有历史接口，自日历上线起逐日累积（约 6 个月后补齐近半年）。
              </div>
            )}

            {/* 事件标注（存 localStorage，仅本机可见） */}
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '12px 14px', marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT }}>事件标注</span>
                <span style={{ fontSize: 11, color: '#C9CDD4' }}>本机记录（localStorage），不影响统计口径</span>
              </div>

              {myEvents.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                  {myEvents.map((e) => (
                    <div key={e.createdAt} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <i style={{ width: 5, height: 5, borderRadius: '50%', background: '#F5A623', flexShrink: 0 }} />
                      <span style={{ flex: 1, color: COLOR_TEXT, wordBreak: 'break-all' }}>{e.text}</span>
                      <button
                        onClick={() => removeEvent(date, e.createdAt)}
                        title="删除"
                        style={{ border: 'none', background: 'transparent', color: '#C9CDD4', cursor: 'pointer', fontSize: 12, padding: '0 2px' }}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && draft.trim()) {
                      addEvent(date, draft);
                      setDraft('');
                    }
                  }}
                  placeholder="记一笔：政策 / 消息面 / 情绪拐点…（回车保存）"
                  style={{
                    flex: 1, minWidth: 0, fontSize: 12, padding: '7px 10px', borderRadius: 8,
                    border: '1px solid #E5E7EB', outline: 'none', color: COLOR_TEXT,
                  }}
                />
                <button
                  onClick={() => {
                    if (!draft.trim()) return;
                    addEvent(date, draft);
                    setDraft('');
                  }}
                  style={{
                    padding: '0 14px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
                    border: '1px solid #111827', background: '#111827', color: '#fff', flexShrink: 0,
                  }}
                >添加</button>
              </div>
            </div>

            <div style={{ marginTop: 10, fontSize: 11, color: '#C9CDD4' }}>
              归档于 {day.meta.generatedAt}
              {day.meta.spotCount ? ` · 全市场快照 ${day.meta.spotCount} 只（${day.meta.spotSource}）` : ''}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
