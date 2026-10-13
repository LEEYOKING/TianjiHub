// 【板块轮动】第二层视图:轮动时间轴
// 横轴 = 交易日,纵轴 = 板块,格子颜色表示事件类型;点击格子给出**解释**(为什么算事件)
// 性能:格子数可达 数万(板块 × 交易日),因此用 Canvas 绘制而非 DOM
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, PageHeader } from './Overview';
import { RotationRuleBar } from '../components/RotationRulePanel';
import { useRotationData, useRotationRule } from '../data/rotationData';
import { COLOR_BORDER, COLOR_DOWN, COLOR_FLAT, COLOR_TEXT, COLOR_UP } from '../utils/format';
import { analyzeAll } from '../utils/rotation/analytics';
import type { SectorStats } from '../utils/rotation/analytics';
import { computeWindow } from '../utils/rotation/ruleEngine';
import type { SectorType } from '../utils/rotation/types';

const COLOR_STRONG = COLOR_UP;        // 强势事件(进涨幅榜) — 红
const COLOR_WEAK = COLOR_DOWN;        // 弱势事件(进跌幅榜) — 绿
const COLOR_LARGE_UP = '#d9363e';     // 大涨(达阈值)
const COLOR_LARGE_DOWN = '#089b55';   // 大跌(达阈值)
const COLOR_NONE = '#F0F1F2';         // 有数据但未触发
const COLOR_NA = '#FFFFFF';           // 无数据

function dashToSlash(d?: string): string {
  if (!d || d.length < 10) return '';
  return `${d.slice(2, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}`;
}

interface Cell {
  r: number;
  c: number;
}

export default function RotationTimeline() {
  const { data, error, loading } = useRotationData();
  const [rule, setRule] = useRotationRule();
  const [typeFilter, setTypeFilter] = useState<'all' | SectorType>('all');
  const [rowLimit, setRowLimit] = useState(40);
  const [kw, setKw] = useState('');
  const [hover, setHover] = useState<Cell | null>(null);
  const [picked, setPicked] = useState<Cell | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const computed = useMemo(() => {
    if (!data || !data.dates.length) return null;
    const comp = computeWindow(data, rule);
    const stats = analyzeAll(data, rule, comp);
    return { comp, stats };
  }, [data, rule]);

  // 纵轴板块:按活跃度排序 + 过滤(默认只画活跃的,避免一次性画几千行)
  const rows = useMemo<SectorStats[]>(() => {
    if (!computed) return [];
    let rs = computed.stats;
    if (typeFilter !== 'all') rs = rs.filter((s) => s.sector.type === typeFilter);
    if (kw.trim()) rs = rs.filter((s) => s.sector.name.includes(kw.trim()));
    const byScore = [...rs].sort((a, b) => b.score - a.score);
    const active = byScore.filter((s) => s.strongCount + s.weakCount > 0);
    const pool = active.length ? active : byScore;
    return pool.slice(0, rowLimit);
  }, [computed, typeFilter, kw, rowLimit]);

  const cols = computed?.comp.dates.length ?? 0;

  // 每个板块在窗口内的事件序列(与 comp.series 对齐)
  const seriesByRow = useMemo(() => {
    if (!computed) return [];
    const map = new Map(computed.comp.series.map((s) => [s.sector.id, s]));
    return rows.map((r) => map.get(r.sector.id)!);
  }, [computed, rows]);

  const cellW = cols > 0 ? Math.max(10, Math.min(20, Math.floor(1000 / cols))) : 14;
  const cellH = 18;

  // 绘制
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !cols || !rows.length) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cols * cellW;
    const h = rows.length * cellH;
    cv.width = w * dpr;
    cv.height = h * dpr;
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    for (let r = 0; r < rows.length; r++) {
      const s = seriesByRow[r];
      for (let c = 0; c < cols; c++) {
        const ev = s?.events[c] ?? null;
        let fill = COLOR_NONE;
        if (!ev) fill = COLOR_NA;
        else if (ev.largeUp) fill = COLOR_LARGE_UP;
        else if (ev.largeDown) fill = COLOR_LARGE_DOWN;
        else if (ev.strong) fill = COLOR_STRONG;
        else if (ev.weak) fill = COLOR_WEAK;
        ctx.fillStyle = fill;
        ctx.fillRect(c * cellW + 0.5, r * cellH + 0.5, cellW - 1, cellH - 1);
        if (fill === COLOR_NA) {
          ctx.strokeStyle = '#F3F4F6';
          ctx.strokeRect(c * cellW + 0.5, r * cellH + 0.5, cellW - 1, cellH - 1);
        }
      }
    }
    // 悬停高亮
    if (hover) {
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(hover.c * cellW + 0.5, hover.r * cellH + 0.5, cellW - 1, cellH - 1);
    }
    if (picked) {
      ctx.strokeStyle = '#1890FF';
      ctx.lineWidth = 2;
      ctx.strokeRect(picked.c * cellW + 1, picked.r * cellH + 1, cellW - 2, cellH - 2);
    }
  }, [rows, seriesByRow, cols, cellW, cellH, hover, picked]);

  const toCell = (e: React.MouseEvent<HTMLCanvasElement>): Cell | null => {
    const cv = canvasRef.current;
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = Math.floor(x / cellW);
    const r = Math.floor(y / cellH);
    if (r < 0 || r >= rows.length || c < 0 || c >= cols) return null;
    return { r, c };
  };

  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center', color: '#86909C', fontSize: 13 }}>板块轮动数据加载中…</div>;
  }
  if (error || !data || !computed || !cols) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: '#86909C', fontSize: 13 }}>
        板块轮动数据暂不可用{error ? `（${error}）` : ''}
      </div>
    );
  }

  const m = data.meta;
  const hoverSeries = hover ? seriesByRow[hover.r] : null;
  const hoverEv = hoverSeries && hover ? hoverSeries.events[hover.c] : null;
  const hoverPct = hoverSeries && hover ? hoverSeries.pctInWindow[hover.c] : null;
  const hoverRankUp = hoverSeries && hover ? hoverSeries.rankUpOn[hover.c] : null;
  const hoverRankDown = hoverSeries && hover ? hoverSeries.rankDownOn[hover.c] : null;

  const pickedSeries = picked ? seriesByRow[picked.r] : null;
  const pickedEv = pickedSeries && picked ? pickedSeries.events[picked.c] : null;
  const pickedStats = picked ? rows[picked.r] : null;

  return (
    <div>
      <PageHeader title="轮动时间轴" tradeDateSlash={dashToSlash(m.lastTradeDate)} subtitle="强弱事件在什么时间发生 · 点击格子查看判定依据" />
      <RotationRuleBar rule={rule} onChange={setRule} />

      <Card
        title="板块 × 交易日 事件热力网格"
        right={
          <span style={{ fontSize: 11, color: '#86909C' }}>
            近 {rule.windowDays} 个交易日 · {cols} 列 × {rows.length} 行 = {cols * rows.length} 格
          </span>
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ display: 'inline-flex', background: '#F5F6F8', borderRadius: 6, padding: 2, gap: 2 }}>
            {([
              ['all', '全部'],
              ['industry', '行业'],
              ['concept', '概念'],
              ['region', '地域'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => {
                  setTypeFilter(k);
                  setPicked(null);
                }}
                style={{
                  border: 'none',
                  background: typeFilter === k ? '#fff' : 'transparent',
                  color: typeFilter === k ? COLOR_TEXT : '#86909C',
                  fontWeight: typeFilter === k ? 600 : 400,
                  fontSize: 12,
                  padding: '4px 10px',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: 'inline-flex', background: '#F5F6F8', borderRadius: 6, padding: 2, gap: 2 }}>
            {[20, 40, 80].map((n) => (
              <button
                key={n}
                onClick={() => {
                  setRowLimit(n);
                  setPicked(null);
                }}
                style={{
                  border: 'none',
                  background: rowLimit === n ? '#fff' : 'transparent',
                  color: rowLimit === n ? COLOR_TEXT : '#86909C',
                  fontWeight: rowLimit === n ? 600 : 400,
                  fontSize: 12,
                  padding: '4px 10px',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                前 {n} 活跃
              </button>
            ))}
          </div>
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="搜索板块名…"
            style={{ border: `1px solid ${COLOR_BORDER}`, borderRadius: 8, padding: '5px 10px', fontSize: 12, outline: 'none', width: 130 }}
          />
          {/* 图例 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginLeft: 'auto', fontSize: 11, color: '#86909C' }}>
            {[
              { c: COLOR_LARGE_UP, t: '大涨(达阈值)' },
              { c: COLOR_STRONG, t: '强势(进涨幅榜)' },
              { c: COLOR_LARGE_DOWN, t: '大跌(达阈值)' },
              { c: COLOR_WEAK, t: '弱势(进跌幅榜)' },
              { c: COLOR_NONE, t: '未触发' },
              { c: COLOR_NA, t: '无数据' },
            ].map((x) => (
              <span key={x.t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <i style={{ width: 11, height: 11, background: x.c, border: `1px solid ${COLOR_BORDER}`, borderRadius: 2, display: 'inline-block' }} />
                {x.t}
              </span>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {/* 纵轴板块名 */}
          <div style={{ flexShrink: 0, width: 108, paddingTop: 0 }}>
            {rows.map((r, i) => (
              <div
                key={r.sector.id}
                title={r.sector.name}
                style={{
                  height: cellH,
                  lineHeight: `${cellH}px`,
                  fontSize: 11,
                  color: '#4E5969',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  background: hover?.r === i || picked?.r === i ? '#F0F7FF' : 'transparent',
                }}
              >
                {r.sector.name}
              </div>
            ))}
          </div>
          {/* Canvas 网格 */}
          <div ref={wrapRef} style={{ overflowX: 'auto', position: 'relative', flex: 1 }}>
            <canvas
              ref={canvasRef}
              onMouseMove={(e) => setHover(toCell(e))}
              onMouseLeave={() => setHover(null)}
              onClick={(e) => {
                const c = toCell(e);
                setPicked(c);
              }}
              style={{ display: 'block', cursor: 'pointer' }}
            />
            {/* 悬停提示 */}
            {hover && hoverEv && hoverSeries && (
              <div
                style={{
                  position: 'absolute',
                  left: Math.min(hover.c * cellW + 12, Math.max(0, (wrapRef.current?.clientWidth || 600) - 220)),
                  top: hover.r * cellH + cellH + 4,
                  background: '#fff',
                  border: `1px solid ${COLOR_BORDER}`,
                  borderRadius: 8,
                  boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
                  padding: '8px 10px',
                  fontSize: 11,
                  color: COLOR_TEXT,
                  pointerEvents: 'none',
                  zIndex: 20,
                  minWidth: 170,
                  lineHeight: 1.7,
                }}
              >
                <div style={{ fontWeight: 700 }}>
                  {hoverSeries.sector.name} · {computed.comp.dates[hover.c]}
                </div>
                <div>
                  涨跌幅:
                  <b style={{ color: hoverPct != null && hoverPct > 0 ? COLOR_UP : hoverPct != null && hoverPct < 0 ? COLOR_DOWN : COLOR_FLAT }}>
                    {hoverPct != null ? `${hoverPct > 0 ? '+' : ''}${hoverPct.toFixed(2)}%` : '无数据'}
                  </b>
                </div>
                <div style={{ color: '#86909C' }}>
                  {hoverEv.strong ? '强势事件' : hoverEv.weak ? '弱势事件' : '未触发事件'}
                  {hoverRankUp ? ` · 涨幅榜第 ${hoverRankUp}` : ''}
                  {hoverRankDown ? ` · 跌幅榜第 ${hoverRankDown}` : ''}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 横轴日期(每格一个刻度,太密则抽样显示) */}
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <div style={{ width: 108, flexShrink: 0 }} />
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div style={{ display: 'flex', width: cols * cellW }}>
              {computed.comp.dates.map((d, i) => {
                const step = cols > 60 ? 10 : cols > 30 ? 5 : 2;
                return (
                  <div
                    key={d}
                    style={{ width: cellW, flexShrink: 0, fontSize: 9, color: '#86909C', transform: 'rotate(-60deg)', transformOrigin: 'left top', height: 26 }}
                  >
                    {i % step === 0 ? d.slice(5) : ''}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* 点击解释 */}
      {picked && pickedStats && (
        <>
          <div style={{ height: 16 }} />
          <Card
            title={`事件解释 · ${pickedStats.sector.name} · ${computed.comp.dates[picked.c]}`}
            right={
              <button
                onClick={() => setPicked(null)}
                style={{ border: 'none', background: 'transparent', color: '#86909C', fontSize: 12, cursor: 'pointer' }}
              >
                收起
              </button>
            }
          >
            {!pickedEv ? (
              <div style={{ fontSize: 12, color: '#86909C', padding: '8px 0' }}>该交易日无数据（不计为 0 涨跌幅，也不作为“没有事件”处理）。</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <div style={{ background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 12, color: '#86909C', marginBottom: 6 }}>当日涨跌幅</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: (pickedSeries!.pctInWindow[picked.c] ?? 0) > 0 ? COLOR_UP : COLOR_DOWN }}>
                    {(pickedSeries!.pctInWindow[picked.c] ?? 0) > 0 ? '+' : ''}
                    {(pickedSeries!.pctInWindow[picked.c] ?? 0).toFixed(2)}%
                  </div>
                </div>
                <div style={{ background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 12, color: '#86909C', marginBottom: 6 }}>当日排名</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: COLOR_TEXT }}>
                    涨幅榜第 {pickedSeries!.rankUpOn[picked.c] ?? '—'} / 共 {computed.comp.ranking[picked.c].total}
                  </div>
                </div>
                <div style={{ background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 12, color: '#86909C', marginBottom: 8 }}>命中的判定条件</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: COLOR_TEXT }}>
                    {[
                      ['rankUp', `进入涨幅榜 TOP ${rule.topN}`, pickedEv.rankUp],
                      ['rankDown', `进入跌幅榜 TOP ${rule.topN}`, pickedEv.rankDown],
                      ['largeUp', `涨幅 ≥ ${rule.riseThreshold}%`, pickedEv.largeUp],
                      ['largeDown', `跌幅 ≤ -${rule.fallThreshold}%`, pickedEv.largeDown],
                    ].map(([k, label, hit]) => (
                      <span key={String(k)} style={{ color: hit ? COLOR_TEXT : '#B0B7C3' }}>
                        {hit ? '●' : '○'} {String(label)}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 12, color: '#86909C', marginBottom: 8 }}>最终事件</div>
                  <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 2 }}>
                    <div style={{ color: pickedEv.strong ? COLOR_UP : '#B0B7C3' }}>{pickedEv.strong ? '强势事件 ✓' : '非强势事件'}</div>
                    <div style={{ color: pickedEv.weak ? COLOR_DOWN : '#B0B7C3' }}>{pickedEv.weak ? '弱势事件 ✓' : '非弱势事件'}</div>
                  </div>
                </div>
              </div>
            )}
            <div style={{ fontSize: 11, color: '#86909C', marginTop: 12, lineHeight: 1.8 }}>
              判定口径:组合方式为「{rule.eventLogic === 'AND' ? '同时满足' : '任一满足'}」；
              未启用的条件不参与计算（大涨进榜条件:{rule.riseRankEnabled ? '启用' : '未启用'}，大跌进榜条件:{rule.fallRankEnabled ? '启用' : '未启用'}）。
            </div>
          </Card>
        </>
      )}
    </div>
  );
}