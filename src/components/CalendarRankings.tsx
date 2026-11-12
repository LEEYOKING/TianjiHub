// 日历回溯 · 周榜 / 月榜
// 数据源：rotation.json（417 板块 × 130 交易日）；区间累计收益按复利计算，
// 日均成交额 < 5 亿的迷你板块不参与排名（与每日归档门槛一致）。
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useRotationData } from '../data/rotationData';
import { buildBuckets, rankSectorsInPeriod, type PeriodRankRow } from '../utils/calendar/period';
import { COLOR_DOWN, COLOR_FLAT, COLOR_TEXT, COLOR_UP } from '../utils/format';
import { useIsMobile } from '../hooks/useIsMobile';

const pctColor = (v: number) => (v > 0 ? COLOR_UP : v < 0 ? COLOR_DOWN : COLOR_FLAT);
const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

function RankTable({ rows, tone }: { rows: PeriodRankRow[]; tone: 'up' | 'down' }) {
  if (!rows.length) {
    return <div style={{ fontSize: 12, color: '#C9CDD4', padding: '14px 0' }}>该区间无满足门槛的板块</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
        <thead>
          <tr>
            {['#', '板块', '区间累计', '日均', '上涨天数', '日均成交额'].map((h, i) => (
              <th key={h} style={{
                padding: '7px 8px', fontSize: 12, color: '#86909C', fontWeight: 500,
                textAlign: i <= 1 ? 'left' : 'right', whiteSpace: 'nowrap',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} style={{ borderTop: '1px solid #F2F3F5' }}>
              <td style={{ padding: '7px 8px', fontSize: 12, color: '#C9CDD4', width: 26 }}>{i + 1}</td>
              <td style={{ padding: '7px 8px', fontSize: 13, color: COLOR_TEXT, fontWeight: 500, whiteSpace: 'nowrap' }}>
                {r.name}
                <span style={{ marginLeft: 6, fontSize: 11, color: '#C9CDD4' }}>
                  {r.type === 'concept' ? '概念' : r.type === 'region' ? '地域' : '行业'}
                </span>
              </td>
              <td style={{ padding: '7px 8px', fontSize: 13, textAlign: 'right', fontWeight: 700, color: tone === 'up' ? COLOR_UP : COLOR_DOWN }}>
                {fmtPct(r.cumPct)}
              </td>
              <td style={{ padding: '7px 8px', fontSize: 12, textAlign: 'right', color: pctColor(r.avgPct) }}>{fmtPct(r.avgPct)}</td>
              <td style={{ padding: '7px 8px', fontSize: 12, textAlign: 'right', color: '#4E5969' }}>{r.upDays}/{r.days}</td>
              <td style={{ padding: '7px 8px', fontSize: 12, textAlign: 'right', color: '#86909C' }}>{r.avgAmt.toFixed(0)}亿</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: COLOR_TEXT }}>{title}</span>
        {hint && <span style={{ fontSize: 11, color: '#C9CDD4' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export default function CalendarRankings({ kind }: { kind: 'week' | 'month' }) {
  const { data, loading, error } = useRotationData();
  const isMobile = useIsMobile();
  const [idx, setIdx] = useState<number | null>(null);

  const buckets = useMemo(() => (data ? buildBuckets(data.dates, kind) : []), [data, kind]);

  // 默认落在最新一期；切换周/月视图时重置
  useEffect(() => {
    setIdx(buckets.length ? buckets.length - 1 : null);
  }, [buckets]);

  const bucket = idx != null ? buckets[idx] : undefined;

  const ranked = useMemo(() => {
    if (!data || !bucket) return [];
    return rankSectorsInPeriod(data, bucket.from, bucket.to);
  }, [data, bucket]);

  const benchCum = useMemo(() => {
    if (!data || !bucket) return null;
    let nav = 1;
    let n = 0;
    data.dates.forEach((d, i) => {
      if (d < bucket.from || d > bucket.to) return;
      const b = data.bench[i];
      if (b == null) return;
      nav *= 1 + b / 100;
      n += 1;
    });
    return n ? (nav - 1) * 100 : null;
  }, [data, bucket]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#86909C', fontSize: 13 }}>区间数据加载中…</div>;
  if (error) return <div style={{ padding: 24, color: '#E60012', fontSize: 13 }}>区间数据加载失败：{error}</div>;
  if (!bucket) return <div style={{ padding: 24, color: '#86909C', fontSize: 13 }}>暂无归档数据</div>;

  const top = ranked.slice(0, 15);
  const bottom = ranked.slice(-15).reverse();
  const atFirst = idx == null || idx <= 0;
  const atLast = idx == null || idx >= buckets.length - 1;
  const arrowStyle = (disabled: boolean): CSSProperties => ({
    width: 30, height: 30, borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff',
    cursor: disabled ? 'default' : 'pointer', color: '#4E5969', fontSize: 15,
    opacity: disabled ? 0.35 : 1,
  });

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
        background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: '10px 14px', marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setIdx((v) => (v != null && v > 0 ? v - 1 : v))} disabled={atFirst} aria-label="上一期"
            style={arrowStyle(atFirst)}>‹</button>
          <span style={{ fontSize: 15, fontWeight: 600, color: COLOR_TEXT, minWidth: 150, textAlign: 'center' }}>
            {kind === 'week' ? `${bucket.label} 周` : bucket.label}
          </span>
          <button onClick={() => setIdx((v) => (v != null && v < buckets.length - 1 ? v + 1 : v))} disabled={atLast} aria-label="下一期"
            style={arrowStyle(atLast)}>›</button>
          <button onClick={() => setIdx(buckets.length - 1)}
            style={{ marginLeft: 4, padding: '4px 10px', fontSize: 12, borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', color: '#4E5969' }}>
            最新
          </button>
        </div>
        <div style={{ fontSize: 12, color: '#86909C' }}>
          {bucket.from} ~ {bucket.to}
          {benchCum != null && (
            <span style={{ marginLeft: 12 }}>
              沪深300 区间 <span style={{ color: pctColor(benchCum), fontWeight: 600 }}>{fmtPct(benchCum)}</span>
            </span>
          )}
          <span style={{ marginLeft: 12 }}>排名门槛：日均成交额 ≥ 5 亿</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
        <Card title={kind === 'week' ? '本周涨幅榜 TOP15' : '本月涨幅榜 TOP15'} hint="按区间累计收益排序">
          <RankTable rows={top} tone="up" />
        </Card>
        <Card title={kind === 'week' ? '本周跌幅榜 TOP15' : '本月跌幅榜 TOP15'} hint="按区间累计收益排序">
          <RankTable rows={bottom} tone="down" />
        </Card>
      </div>
    </div>
  );
}
