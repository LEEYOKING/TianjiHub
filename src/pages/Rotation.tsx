// 【板块轮动档案】单页视图 —— 已合并原「轮动档案」+「轮动时间轴」两页
// 页面结构(自上而下,含跨模块联动):
//   ① 规则栏(全局唯一口径)
//   ② 每日强弱榜单       —— 最新交易日最强/最弱
//   ③ 板块行为画像       —— 4 张概览卡 + 榜单切换(反复活跃/最近重新活跃/趋势持续性) + 行为统计表
//      行为统计表 = 全页的「选择器」:点某一行 → 时间轴聚焦该板块并滚动过去
//   ④ 事件热力时间轴     —— Canvas 网格(可点格子看判定依据),复用统计表的筛选条件
//   ⑤ 板块轮动关系       —— 同步活跃 / 先后关系 / 市场环境分层
// 注:卡片标题不使用"第一/二/三层"这类实现内部分层用语,避免终端用户困惑
// 设计原则:所有模块共用同一份 rule 与同一份 filteredStats,避免"改一个阈值后各模块口径不一致"
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, PageHeader } from './Overview';
import { InfoTip, TitleWithTip, tipItems } from '../components/InfoTip';
import { RotationRuleBar } from '../components/RotationRulePanel';
import { RotationRelations } from '../components/RotationRelations';
import { useRotationData, useRotationRule } from '../data/rotationData';
import { COLOR_BORDER, COLOR_DOWN, COLOR_FLAT, COLOR_TEXT, COLOR_UP } from '../utils/format';
import { analyzeAll } from '../utils/rotation/analytics';
import type { SectorStats } from '../utils/rotation/analytics';
import { computeWindow } from '../utils/rotation/ruleEngine';
import type { SectorType } from '../utils/rotation/types';

const TYPE_LABEL: Record<SectorType, string> = { industry: '行业', concept: '概念', region: '地域' };

// 时间轴配色(与站点一致:红=强势/上涨,绿=弱势/下跌)
const TL_LARGE_UP = '#d9363e';
const TL_STRONG = COLOR_UP;
const TL_LARGE_DOWN = '#089b55';
const TL_WEAK = COLOR_DOWN;
const TL_NONE = '#F0F1F2';
const TL_NA = '#FFFFFF';
/** hover 气泡的估算高度(3 行文字 + 上下内边距),用于判断是否改到格子上方显示 */
const TIP_H = 76;

// 「最近重新活跃」判定阈值(V1 固定值,不随规则变化 — 已在界面上明确标注)
const REACTIVATE_AGO = 5;    // 距最近一次强势事件 ≤ 5 个交易日
const REACTIVATE_GAP = 10;   // 且此前空档 ≥ 10 个交易日

// v2.0.8ku:表头字段提为常量 —— 渲染表头与"感叹号"气泡说明共用同一份,避免两处措辞漂移
const STATS_HEADERS = [
  '板块', '类型', '强势次数', '弱势次数', '强势频率', '平均间隔',
  '独立周期', '独立间隔', '累计收益', '最大回撤', '活跃度', '覆盖率',
];
const BOARD_HEADERS_BASE = ['板块', '类型'];
const MINI_TABLE_HEADERS = ['序号', '板块', '类型', '涨跌幅'];
// v2.0.8kv:热力网格图例(色块 + 名称) —— 标题行最右侧展示,同一份数据复用给感叹号气泡(色块在名称左侧)
const HEATMAP_LEGEND: { c: string; t: string }[] = [
  { c: TL_LARGE_UP, t: '大涨(达阈值)' },
  { c: TL_STRONG, t: '强势(进涨幅榜)' },
  { c: TL_LARGE_DOWN, t: '大跌(达阈值)' },
  { c: TL_WEAK, t: '弱势(进跌幅榜)' },
  { c: TL_NONE, t: '未触发' },
  { c: TL_NA, t: '无数据' },
];
const PROFILE_CARD_LABELS = ['反复活跃次数', '活跃间隔', '最近重新活跃', '趋势与持续性'];

function dashToSlash(d?: string): string {
  if (!d || d.length < 10) return '';
  return `${d.slice(2, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}`;
}

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#86909C', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || COLOR_TEXT, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#86909C', marginTop: 5, lineHeight: 1.6 }}>{sub}</div>}
    </div>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { label: string; value: T }[];
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'inline-flex', background: '#F5F6F8', borderRadius: 6, padding: 2, gap: 2 }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            border: 'none',
            background: value === o.value ? '#fff' : 'transparent',
            color: value === o.value ? COLOR_TEXT : '#86909C',
            fontWeight: value === o.value ? 600 : 400,
            fontSize: 12,
            padding: '4px 10px',
            borderRadius: 4,
            cursor: 'pointer',
            boxShadow: value === o.value ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            transition: 'all .15s',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MiniTable({
  rows,
  mode,
}: {
  rows: { id: string; name: string; pct: number; rank: number; type: SectorType }[];
  mode: 'up' | 'down';
}) {
  const nav = useNavigate();
  if (!rows.length) return <div style={{ fontSize: 12, color: '#86909C', padding: '12px 0' }}>当日无数据</div>;
  return (
    <div>
      {rows.map((r) => (
        <div
          key={r.id}
          onClick={() => nav(`/rotation/sector/${r.id}`)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 6px',
            borderBottom: `1px solid ${COLOR_BORDER}`,
            cursor: 'pointer',
          }}
        >
          <span style={{ width: 26, fontSize: 12, color: '#86909C' }}>{r.rank}</span>
          <span style={{ flex: 1, fontSize: 13, color: COLOR_TEXT, fontWeight: 500 }}>{r.name}</span>
          <span style={{ fontSize: 11, color: '#86909C', background: '#F5F7FA', borderRadius: 4, padding: '1px 6px' }}>
            {TYPE_LABEL[r.type]}
          </span>
          <span style={{ width: 72, textAlign: 'right', fontSize: 13, fontWeight: 600, color: mode === 'up' ? COLOR_UP : COLOR_DOWN }}>
            {r.pct > 0 ? '+' : ''}
            {r.pct.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  );
}

/** 榜单行(用于 反复活跃 / 最近重新活跃 / 趋势持续性 三种模式) */
function BoardList({
  title,
  headers,
  rows,
  onPick,
}: {
  title: string;
  /** 后三列的列名(由各模式传入真实指标名,不再用"指标1/2/3"占位) */
  headers: [string, string, string];
  rows: { id: string; name: string; type: SectorType; v1: string; v2: string; v3: string; hot?: boolean }[];
  onPick: (id: string) => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT }}>{title}</span>
        {/* v2.0.8ku:榜单表头说明气泡(随榜单模式自动切换字段) */}
        <InfoTip items={tipItems([...BOARD_HEADERS_BASE, ...headers])} title="列含义" />
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#F7F9FC', color: '#86909C' }}>
            {['板块', '类型', ...headers].map((h) => (
              // v2.0.8kw:除首列外,表头与单元格一律水平居中
              <th key={h} style={{ padding: '8px 10px', textAlign: h === '板块' ? 'left' : 'center', fontWeight: 500 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} onClick={() => onPick(r.id)} style={{ borderBottom: `1px solid ${COLOR_BORDER}`, cursor: 'pointer' }}>
              <td style={{ padding: '8px 10px', color: r.hot ? COLOR_UP : COLOR_TEXT, fontWeight: r.hot ? 600 : 500, whiteSpace: 'nowrap' }}>{r.name}</td>
              <td style={{ padding: '8px 10px', color: '#86909C', textAlign: 'center' }}>{TYPE_LABEL[r.type]}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600 }}>{r.v1}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center' }}>{r.v2}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', color: '#86909C' }}>{r.v3}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={5} style={{ padding: '12px 10px', color: '#86909C' }}>
                当前筛选下没有符合条件的板块
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function Rotation() {
  const { data, error, loading } = useRotationData();
  const [rule, setRule] = useRotationRule();
  const navigate = useNavigate();

  // 全页共用筛选(统计表与时间轴联动,保证两处看到的是同一批板块)
  const [typeFilter, setTypeFilter] = useState<'all' | SectorType>('all');
  const [kw, setKw] = useState('');
  const [sortKey, setSortKey] = useState<'score' | 'strong' | 'gap' | 'ret'>('score');
  const [boardMode, setBoardMode] = useState<'active' | 'reactivate' | 'trend'>('active');

  // 时间轴状态
  const [rowLimit, setRowLimit] = useState(40);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  // Y 轴板块名自身的悬停高亮(与画布 hover 分开 — 便于用户识别"这一行可以点进详情")
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const [picked, setPicked] = useState<{ r: number; c: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  const computed = useMemo(() => {
    if (!data || !data.dates.length) return null;
    const comp = computeWindow(data, rule);
    const stats = analyzeAll(data, rule, comp);
    return { comp, stats };
  }, [data, rule]);

  // 过滤后的板块(统计表 + 时间轴共用)
  const filteredStats = useMemo<SectorStats[]>(() => {
    if (!computed) return [];
    let rows = computed.stats;
    if (typeFilter !== 'all') rows = rows.filter((r) => r.sector.type === typeFilter);
    if (kw.trim()) rows = rows.filter((r) => r.sector.name.includes(kw.trim()));
    return rows;
  }, [computed, typeFilter, kw]);

  const tableRows = useMemo(() => {
    const cmp = {
      score: (a: SectorStats, b: SectorStats) => b.score - a.score,
      strong: (a: SectorStats, b: SectorStats) => b.strongCount - a.strongCount,
      gap: (a: SectorStats, b: SectorStats) => (a.gapStrong.avg ?? 999) - (b.gapStrong.avg ?? 999),
      ret: (a: SectorStats, b: SectorStats) => b.cumReturn - a.cumReturn,
    }[sortKey];
    return [...filteredStats].sort(cmp).slice(0, 60);
  }, [filteredStats, sortKey]);

  // 「最近重新活跃」:距最近强势 ≤5 个交易日 且 此前空档 ≥10 个交易日(固定阈值,界面已标注)
  const reactivated = useMemo(() => {
    if (!computed) return [];
    return filteredStats
      .filter((s) => s.lastStrongAgo != null && s.lastStrongAgo <= REACTIVATE_AGO && (s.lastGapBefore ?? 0) >= REACTIVATE_GAP)
      .sort((a, b) => (a.lastStrongAgo ?? 99) - (b.lastStrongAgo ?? 99) || (b.lastGapBefore ?? 0) - (a.lastGapBefore ?? 0));
  }, [filteredStats]);

  const latest = computed ? computed.comp.ranking[computed.comp.ranking.length - 1] : null;
  const typeById = useMemo(() => {
    const mp = new Map<string, SectorType>();
    (data?.sectors || []).forEach((s) => mp.set(s.id, s.type));
    return mp;
  }, [data]);
  const strongTop = latest
    ? latest.ranked.slice(0, rule.topN).map((r) => ({ ...r, type: typeById.get(r.id) || ('industry' as SectorType) }))
    : [];
  const weakTop = latest
    ? [...latest.ranked]
        .reverse()
        .slice(0, rule.topN)
        .map((r) => ({ ...r, type: typeById.get(r.id) || ('industry' as SectorType) }))
    : [];

  // 概览卡:4 个画像入口的高亮
  const profile = useMemo(() => {
    if (!computed || !computed.stats.length) return null;
    const ss = computed.stats;
    const mostActive = [...ss].sort((a, b) => b.strongCount - a.strongCount)[0];
    const gapReady = ss.filter((s) => !s.gapStrong.sampleInsufficient && s.gapStrong.avg !== null);
    const tightest = [...gapReady].sort((a, b) => (a.gapStrong.avg ?? 999) - (b.gapStrong.avg ?? 999))[0];
    const bothSides = ss.filter((s) => s.strongCount > 0 && s.weakCount > 0).length;
    const bestRet = [...ss].sort((a, b) => b.cumReturn - a.cumReturn)[0];
    return { mostActive, tightest, bothSides, bestRet, total: ss.length };
  }, [computed]);

  // 榜单数据(三种模式)
  const boardRows = useMemo(() => {
    const mk = (s: SectorStats) => ({
      id: s.sector.id,
      name: s.sector.name,
      type: s.sector.type,
    });
    if (boardMode === 'active') {
      return [...filteredStats]
        .sort((a, b) => b.strongCount - a.strongCount || b.weakCount - a.weakCount)
        .slice(0, 10)
        .map((s) => ({
          ...mk(s),
          v1: `${s.strongCount} 次`,
          v2: `弱势 ${s.weakCount} 次`,
          v3: `频率 ${(s.strongFreq * 100).toFixed(0)}%`,
        }));
    }
    if (boardMode === 'reactivate') {
      return reactivated.slice(0, 10).map((s) => ({
        ...mk(s),
        v1: s.lastStrongAgo != null ? `${s.lastStrongAgo} 日前` : '—',
        v2: `此前空档 ${s.lastGapBefore} 日`,
        v3: `窗口内 ${s.strongCount} 次 · 累计 ${(s.cumReturn * 100).toFixed(1)}%`,
        hot: true,
      }));
    }
    return [...filteredStats]
      .sort((a, b) => b.cumReturn - a.cumReturn)
      .slice(0, 10)
      .map((s) => ({
        ...mk(s),
        v1: `${(s.cumReturn * 100).toFixed(2)}%`,
        v2: `回撤 ${(s.maxDrawdown * 100).toFixed(2)}%`,
        v3: `相对基准 ${s.relStrength == null ? '—' : `${(s.relStrength * 100).toFixed(2)}%`}`,
      }));
  }, [filteredStats, boardMode, reactivated]);

  // 榜单后三列的真实列名(随模式变化)
  const boardHeaders: [string, string, string] =
    boardMode === 'active'
      ? ['强势次数', '弱势次数', '强势频率']
      : boardMode === 'reactivate'
        ? ['距上次强势', '此前空档', '窗口内次数 · 累计收益']
        : ['累计收益', '最大回撤', '相对基准超额'];

  // 时间轴行:聚焦某板块时只画它一行(放大便于看),否则画活跃度前 N 行
  const tlRows = useMemo<SectorStats[]>(() => {
    if (focusId) {
      const one = filteredStats.find((s) => s.sector.id === focusId);
      return one ? [one] : [];
    }
    const byScore = [...filteredStats].sort((a, b) => b.score - a.score);
    const active = byScore.filter((s) => s.strongCount + s.weakCount > 0);
    return (active.length ? active : byScore).slice(0, rowLimit);
  }, [filteredStats, focusId, rowLimit]);

  const cols = computed?.comp.dates.length ?? 0;
  const cellW = cols > 0 ? Math.max(10, Math.min(20, Math.floor(1000 / cols))) : 14;
  const cellH = focusId ? 26 : 18;

  const seriesByRow = useMemo(() => {
    if (!computed) return [];
    const mp = new Map(computed.comp.series.map((s) => [s.sector.id, s]));
    return tlRows.map((r) => mp.get(r.sector.id)!);
  }, [computed, tlRows]);

  // Canvas 绘制
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !cols || !tlRows.length) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cols * cellW;
    const h = tlRows.length * cellH;
    cv.width = w * dpr;
    cv.height = h * dpr;
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (let r = 0; r < tlRows.length; r++) {
      const s = seriesByRow[r];
      for (let c = 0; c < cols; c++) {
        const ev = s?.events[c] ?? null;
        let fill = TL_NONE;
        if (!ev) fill = TL_NA;
        else if (ev.largeUp) fill = TL_LARGE_UP;
        else if (ev.largeDown) fill = TL_LARGE_DOWN;
        else if (ev.strong) fill = TL_STRONG;
        else if (ev.weak) fill = TL_WEAK;
        ctx.fillStyle = fill;
        ctx.fillRect(c * cellW + 0.5, r * cellH + 0.5, cellW - 1, cellH - 1);
        if (fill === TL_NA) {
          ctx.strokeStyle = '#F3F4F6';
          ctx.strokeRect(c * cellW + 0.5, r * cellH + 0.5, cellW - 1, cellH - 1);
        }
      }
    }
    if (hover) {
      // v2.0.8kv:鼠标所在格子所属的整行加一层极浅高亮(表明当前选中该行)
      ctx.fillStyle = 'rgba(24, 144, 255, 0.06)';
      ctx.fillRect(0, hover.r * cellH + 0.5, w, cellH - 1);
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(hover.c * cellW + 0.5, hover.r * cellH + 0.5, cellW - 1, cellH - 1);
    }
    if (picked) {
      ctx.strokeStyle = '#1890FF';
      ctx.lineWidth = 2;
      ctx.strokeRect(picked.c * cellW + 1, picked.r * cellH + 1, cellW - 2, cellH - 2);
    }
  }, [tlRows, seriesByRow, cols, cellW, cellH, hover, picked]);

  const pickSector = (id: string) => {
    setFocusId(id);
    setPicked(null);
    setHover(null);
    requestAnimationFrame(() => timelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
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
  const pickedSeries = picked ? seriesByRow[picked.r] : null;
  const pickedEv = pickedSeries && picked ? pickedSeries.events[picked.c] : null;

  const toCell = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    const c = Math.floor((e.clientX - rect.left) / cellW);
    const r = Math.floor((e.clientY - rect.top) / cellH);
    if (r < 0 || r >= tlRows.length || c < 0 || c >= cols) return null;
    return { r, c };
  };

  // v2.0.8ky:本页数据自身的生成时点(rotation.json 的 meta.generatedAt,固定东八区)
  // —— 并入页头「报告日期」显示,并标注是否为当日盘后生成(归档正常时应晚于当日 15:05)
  const gen = (() => {
    const g = m.generatedAt || '';            // 'YYYY-MM-DD HH:MM:SS'(东八区)
    if (g.length < 16) return { time: '--:--', postClose: false };
    const time = g.slice(11, 16);
    return { time, postClose: g.slice(0, 10) === m.lastTradeDate && time >= '15:05' };
  })();

  return (
    <div>
      <PageHeader
        title="板块轮动档案"
        tradeDateSlash={dashToSlash(m.lastTradeDate)}
        subtitle="榜单档案 · 行为画像 · 事件时间轴 · 轮动关系（可配置规则，全窗口可复算）"
        dateSuffix={
          <>
            <span style={{ color: '#111827', fontWeight: 500 }}> {gen.time}</span>
            <span>（{gen.postClose ? '盘后数据' : '非当日盘后数据'}）</span>
          </>
        }
        hideGeneratedAt
      />
      <RotationRuleBar
        rule={rule}
        onChange={setRule}
        dataRange={{
          first: m.firstTradeDate,
          last: m.lastTradeDate,
          windowDays: m.windowDays,
          sectorCount: m.sectorCount,
          suspectCount: m.suspectCount,
        }}
      />

      {/* ① 每日强弱榜单 */}
      <Card
        title={<TitleWithTip text="每日强弱榜单" items={tipItems(MINI_TABLE_HEADERS)} title="列含义" />}
        right={
          <span style={{ fontSize: 11, color: '#86909C' }}>
            {latest?.date || '-'} · 当日有效板块 {latest?.total ?? 0} 个
          </span>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLOR_UP, marginBottom: 6 }}>每日最强板块 TOP {rule.topN}</div>
            <MiniTable rows={strongTop} mode="up" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLOR_DOWN, marginBottom: 6 }}>每日最弱板块 TOP {rule.topN}</div>
            <MiniTable rows={weakTop} mode="down" />
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#86909C', marginTop: 12, lineHeight: 1.7 }}>
          按当日涨跌幅降序排名，并列时按板块代码升序（稳定排序，同样数据每次结果一致）。点击任一板块进入行为详情。
        </div>
      </Card>

      {/* ② 板块行为画像 */}
      <div style={{ height: 16 }} />
      <Card
        title={<TitleWithTip text="板块行为画像" items={tipItems(PROFILE_CARD_LABELS)} title="概览指标含义" />}
        right={<span style={{ fontSize: 11, color: '#86909C' }}>近 {rule.windowDays} 个交易日</span>}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 16 }}>
          {[
            {
              t: '反复活跃次数',
              v: profile ? `${profile.mostActive.strongCount} 次` : '-',
              c: COLOR_UP,
              s: profile ? `${profile.mostActive.sector.name}（弱势 ${profile.mostActive.weakCount} 次）` : '',
            },
            {
              t: '活跃间隔',
              v: profile?.tightest?.gapStrong.avg != null ? `${profile.tightest.gapStrong.avg.toFixed(1)} 日` : '样本不足',
              c: COLOR_TEXT,
              s: profile?.tightest ? `${profile.tightest.sector.name} · 中位 ${profile.tightest.gapStrong.median ?? '-'} 日` : '暂无足够间隔样本',
            },
            {
              t: '最近重新活跃',
              v: `${reactivated.length} 个`,
              c: COLOR_UP,
              s: `距上次强势 ≤${REACTIVATE_AGO} 日且此前空档 ≥${REACTIVATE_GAP} 日`,
            },
            {
              t: '趋势与持续性',
              v: profile ? `${(profile.bestRet.cumReturn * 100).toFixed(1)}%` : '-',
              c: profile && profile.bestRet.cumReturn >= 0 ? COLOR_UP : COLOR_DOWN,
              s: profile ? `${profile.bestRet.sector.name} · 窗口复合收益居首` : '',
            },
          ].map((x) => (
            <div key={x.t} style={{ background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 10, padding: '14px 16px' }}>
              <Stat label={x.t} value={x.v} color={x.c} sub={x.s} />
            </div>
          ))}
        </div>

        {/* 榜单切换 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
          <Seg
            value={boardMode}
            onChange={setBoardMode}
            options={[
              { label: '反复活跃榜', value: 'active' as const },
              { label: '最近重新活跃榜', value: 'reactivate' as const },
              { label: '趋势持续性榜', value: 'trend' as const },
            ]}
          />
          <span style={{ fontSize: 11, color: '#86909C' }}>
            {boardMode === 'active'
              ? '按窗口内进入强势榜的次数排序'
              : boardMode === 'reactivate'
                ? `判定口径（固定值）：距最近一次强势事件 ≤ ${REACTIVATE_AGO} 个交易日，且此前空档 ≥ ${REACTIVATE_GAP} 个交易日 —— 即"沉寂一段时间后重新活跃"`
                : '按窗口内板块复合收益排序'}
          </span>
        </div>
        <div style={{ marginTop: 12 }}>
          <BoardList
            title={
              boardMode === 'active' ? '反复进入强势榜 TOP 10' : boardMode === 'reactivate' ? '最近重新活跃 TOP 10' : '趋势持续性 TOP 10'
            }
            headers={boardHeaders}
            rows={boardRows}
            onPick={pickSector}
          />
        </div>
        {boardMode === 'reactivate' && (
          <div style={{ fontSize: 11, color: '#86909C', marginTop: 10, lineHeight: 1.7 }}>
            "此前空档"= 最近一次强势事件与上一次强势事件之间的交易日步长；空档越大说明是"沉寂后重启"而非持续活跃。
            该判定阈值为 V1 固定启发值，不随规则面板变化。
          </div>
        )}

        {/* 全量统计表(= 全页选择器) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            板块行为统计表
            <InfoTip items={tipItems(STATS_HEADERS)} title="列含义 / 计算公式" />
          </span>
          <Seg
            value={typeFilter}
            onChange={(v) => {
              setTypeFilter(v);
              setPicked(null);
            }}
            options={[
              { label: '全部', value: 'all' as const },
              { label: '行业', value: 'industry' as const },
              { label: '概念', value: 'concept' as const },
              { label: '地域', value: 'region' as const },
            ]}
          />
          <Seg
            value={sortKey}
            onChange={setSortKey}
            options={[
              { label: '按活跃度', value: 'score' as const },
              { label: '按强势次数', value: 'strong' as const },
              { label: '按平均间隔', value: 'gap' as const },
              { label: '按累计收益', value: 'ret' as const },
            ]}
          />
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="搜索板块名（同时过滤时间轴）…"
            style={{ border: `1px solid ${COLOR_BORDER}`, borderRadius: 8, padding: '5px 10px', fontSize: 12, outline: 'none', width: 200 }}
          />
          <span style={{ fontSize: 11, color: '#86909C' }}>
            筛选后 {filteredStats.length} 个，展示前 {tableRows.length} 个 · 点击行 → 下方时间轴聚焦该板块
          </span>
        </div>
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 980 }}>
            <thead>
              <tr style={{ background: '#F7F9FC', color: '#86909C' }}>
                {STATS_HEADERS.map((h) => (
                  <th
                    key={h}
                    // v2.0.8kw:除首列外,表头与单元格一律水平居中
                    style={{ padding: '9px 10px', textAlign: h === '板块' ? 'left' : 'center', fontWeight: 500, whiteSpace: 'nowrap' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr
                  key={r.sector.id}
                  style={{
                    borderBottom: `1px solid ${COLOR_BORDER}`,
                    cursor: 'pointer',
                    background: focusId === r.sector.id ? '#F0F7FF' : undefined,
                  }}
                >
                  <td
                    style={{ padding: '9px 10px', fontWeight: 500, whiteSpace: 'nowrap' }}
                    onClick={() => pickSector(r.sector.id)}
                  >
                    <span style={{ color: COLOR_TEXT }}>{r.sector.name}</span>
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/rotation/sector/${r.sector.id}`);
                      }}
                      style={{ color: '#1890FF', fontSize: 11, marginLeft: 8 }}
                    >
                      详情 ›
                    </span>
                  </td>
                  <td style={{ padding: '9px 10px', color: '#86909C', textAlign: 'center' }}>{TYPE_LABEL[r.sector.type]}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'center', color: COLOR_UP, fontWeight: 600 }}>{r.strongCount}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'center', color: COLOR_DOWN, fontWeight: 600 }}>{r.weakCount}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'center' }}>{(r.strongFreq * 100).toFixed(0)}%</td>
                  <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                    {r.gapStrong.avg != null ? `${r.gapStrong.avg.toFixed(1)} 日` : '—'}
                    {r.gapStrong.sampleInsufficient && <span style={{ color: COLOR_FLAT, fontSize: 10 }}> 样本少</span>}
                  </td>
                  <td style={{ padding: '9px 10px', textAlign: 'center' }}>{r.clustersStrong.length}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                    {r.clusterGapStrong.avg != null ? `${r.clusterGapStrong.avg.toFixed(1)} 日` : '—'}
                  </td>
                  <td
                    style={{
                      padding: '9px 10px',
                      textAlign: 'center',
                      fontWeight: 600,
                      color: r.cumReturn > 0 ? COLOR_UP : r.cumReturn < 0 ? COLOR_DOWN : COLOR_FLAT,
                    }}
                  >
                    {(r.cumReturn * 100).toFixed(2)}%
                  </td>
                  <td style={{ padding: '9px 10px', textAlign: 'center', color: COLOR_DOWN }}>{(r.maxDrawdown * 100).toFixed(2)}%</td>
                  <td style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 600 }}>{r.score.toFixed(1)}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'center', color: r.coverage < 1 ? '#FA8C16' : '#86909C' }}>
                    {(r.coverage * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: '#86909C', marginTop: 12, lineHeight: 1.8 }}>
          口径说明:间隔按<b>交易日序号差</b>计算（相邻两个事件日相差 1 即"间隔 1 个交易日"）；间隔样本少于 4 个时标注"样本少"，不计算集中度；
          累计收益为<b>复合收益</b> ∏(1+r)−1，不可简单相加；覆盖率 &lt; 100% 表示该板块存在数据缺失日（缺失日不计为 0 涨跌幅）。
          板块指数收益用于行情研究，不等于可交易组合收益。
        </div>
      </Card>

      {/* ③ 事件热力时间轴(与上方筛选/选中联动) */}
      <div style={{ height: 16 }} />
      <div ref={timelineRef}>
        {/* v2.0.8kt:标题改为'事件热力网格（近N交易日）',并删除右上角'列×行'副文本 */}
        {/* v2.0.8ku:标题右侧加感叹号说明(图例各色含义) */}
        {/* v2.0.8kv:标题改'板块热力网格';图例整体移到标题行最右侧;气泡内色块置于名称左侧 */}
        <Card
          title={
            // v2.0.8kw:Top20/40/80 的分段切换移到标题提示 icon 的右侧(与标题同一行)
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <TitleWithTip
                text={`板块热力网格（近${rule.windowDays}交易日）`}
                items={tipItems(HEATMAP_LEGEND.map(({ c, t }) => ({ label: t, color: c })))}
                title="网格颜色含义"
              />
              {!focusId && (
                <Seg
                  value={String(rowLimit)}
                  onChange={(v) => {
                    setRowLimit(Number(v));
                    setPicked(null);
                  }}
                  options={[
                    { label: 'Top20', value: '20' },
                    { label: 'Top40', value: '40' },
                    { label: 'Top80', value: '80' },
                  ]}
                />
              )}
            </span>
          }
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: '#86909C', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {HEATMAP_LEGEND.map((x) => (
                <span key={x.t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <i style={{ width: 11, height: 11, background: x.c, border: `1px solid ${COLOR_BORDER}`, borderRadius: 2, display: 'inline-block' }} />
                  {x.t}
                </span>
              ))}
            </div>
          }
        >
          {focusId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: COLOR_TEXT }}>
                已聚焦：<b>{filteredStats.find((s) => s.sector.id === focusId)?.sector.name || focusId}</b>
              </span>
              <button
                onClick={() => {
                  setFocusId(null);
                  setPicked(null);
                }}
                style={{
                  border: `1px solid ${COLOR_BORDER}`,
                  background: '#fff',
                  color: '#4E5969',
                  borderRadius: 8,
                  padding: '4px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                取消聚焦（显示活跃前 N 行）
              </button>
              <button
                onClick={() => navigate(`/rotation/sector/${focusId}`)}
                style={{
                  border: 'none',
                  background: '#1890FF',
                  color: '#fff',
                  borderRadius: 8,
                  padding: '5px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                查看该板块行为详情
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flexShrink: 0, width: 108 }}>
              {tlRows.map((r, i) => (
                // v2.0.8kt:Y 轴板块名可点击 → 进入该板块行为详情
                <div
                  key={r.sector.id}
                  title={`${r.sector.name} — 点击查看行为详情`}
                  onClick={() => navigate(`/rotation/sector/${r.sector.id}`)}
                  onMouseEnter={() => setHoverRow(i)}
                  onMouseLeave={() => setHoverRow(null)}
                  style={{
                    height: cellH,
                    lineHeight: `${cellH}px`,
                    fontSize: 11,
                    // 可点击语义用链接色 + 下划线提示(悬停加深)
                    color: hoverRow === i ? '#1890FF' : '#4E5969',
                    textDecoration: hoverRow === i ? 'underline' : 'none',
                    cursor: 'pointer',
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
            {/* 画布 + 横轴放在同一个横向滚动容器内,保证滚动时日期刻度与格子严格对齐;
                overflowY: hidden → hover 气泡即使贴着边缘也不会把容器撑出纵向滚动条 */}
            <div ref={wrapRef} style={{ overflowX: 'auto', overflowY: 'hidden', position: 'relative', flex: 1 }}>
              <canvas
                ref={canvasRef}
                onMouseMove={(e) => setHover(toCell(e))}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => setPicked(toCell(e))}
                style={{ display: 'block', cursor: 'pointer' }}
              />
              {/* 横轴日期:水平排布(不再 rotate,避免被容器裁切),按间隔抽样显示 */}
              <div style={{ display: 'flex', width: cols * cellW, height: 16 }}>
                {computed.comp.dates.map((d, i) => {
                  const step = cols > 60 ? 10 : cols > 30 ? 5 : 2;
                  return (
                    <div
                      key={d}
                      style={{ width: cellW, flexShrink: 0, fontSize: 9, color: '#86909C', whiteSpace: 'nowrap', lineHeight: '14px' }}
                    >
                      {i % step === 0 ? d.slice(5) : ''}
                    </div>
                  );
                })}
              </div>
              {hover && hoverEv && hoverSeries && (
                <div
                  style={{
                    position: 'absolute',
                    // 横向:贴右边缘时左移,避免超出内容宽度
                    left: Math.min(hover.c * cellW + 12, Math.max(0, cols * cellW - 220)),
                    // 纵向:末 5 行改为显示在格子上方,否则气泡会溢出画布底部导致容器可上下滚动
                    top: hover.r >= tlRows.length - 5 ? Math.max(0, hover.r * cellH - TIP_H - 4) : hover.r * cellH + cellH + 4,
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
                    {hoverSeries.rankUpOn[hover.c] ? ` · 涨幅榜第 ${hoverSeries.rankUpOn[hover.c]}` : ''}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 格子点击解释 */}
          {picked && pickedSeries && (
            <div style={{ marginTop: 16, borderTop: `1px solid ${COLOR_BORDER}`, paddingTop: 16 }}>
              {!pickedEv ? (
                <div style={{ fontSize: 12, color: '#86909C' }}>
                  {computed.comp.dates[picked.c]} · {pickedSeries.sector.name} 当日无数据（不计为 0 涨跌幅，也不作为"没有事件"处理）。
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: COLOR_TEXT, marginBottom: 12 }}>
                    事件解释 · {pickedSeries.sector.name} · {computed.comp.dates[picked.c]}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                    <div style={{ background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, color: '#86909C', marginBottom: 6 }}>当日涨跌幅</div>
                      <div
                        style={{
                          fontSize: 20,
                          fontWeight: 700,
                          color: (pickedSeries.pctInWindow[picked.c] ?? 0) > 0 ? COLOR_UP : COLOR_DOWN,
                        }}
                      >
                        {(pickedSeries.pctInWindow[picked.c] ?? 0) > 0 ? '+' : ''}
                        {(pickedSeries.pctInWindow[picked.c] ?? 0).toFixed(2)}%
                      </div>
                    </div>
                    <div style={{ background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, color: '#86909C', marginBottom: 6 }}>当日排名</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: COLOR_TEXT }}>
                        涨幅榜第 {pickedSeries.rankUpOn[picked.c] ?? '—'} / 共 {computed.comp.ranking[picked.c].total}
                      </div>
                    </div>
                    <div style={{ background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, color: '#86909C', marginBottom: 8 }}>命中的判定条件</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: COLOR_TEXT }}>
                        {[
                          [`进入涨幅榜 TOP ${rule.topN}`, pickedEv.rankUp],
                          [`进入跌幅榜 TOP ${rule.topN}`, pickedEv.rankDown],
                          [`涨幅 ≥ ${rule.riseThreshold}%`, pickedEv.largeUp],
                          [`跌幅 ≤ -${rule.fallThreshold}%`, pickedEv.largeDown],
                        ].map(([label, hit], i) => (
                          <span key={i} style={{ color: hit ? COLOR_TEXT : '#B0B7C3' }}>
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
                  <div style={{ fontSize: 11, color: '#86909C', marginTop: 12, lineHeight: 1.8 }}>
                    判定口径：组合方式为「{rule.eventLogic === 'AND' ? '同时满足' : '任一满足'}」；未启用的条件不参与计算
                    （大涨进榜条件:{rule.riseRankEnabled ? '启用' : '未启用'}，大跌进榜条件:{rule.fallRankEnabled ? '启用' : '未启用'}）。
                  </div>
                </>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* ④ 板块轮动关系 */}
      <div style={{ height: 16 }} />
      <Card
        title={
          <TitleWithTip
            text="板块轮动关系"
            title="核心指标含义"
            items={tipItems(['共同活跃天数', '重合率(Jaccard)', 'Lift', '基准频率', '最佳滞后', '命中样本', '上涨日频率', '差值'])}
          />
        }
        right={<span style={{ fontSize: 11, color: '#86909C' }}>历史统计关联 · 非因果</span>}
      >
        <RotationRelations data={data} rule={rule} comp={computed.comp} stats={computed.stats} />
      </Card>
    </div>
  );
}