// 【板块轮动档案】单页视图 —— 已合并原「轮动档案」+「轮动时间轴」两页
// V2.0 阶段 3：主页信息架构重构（任务书 §4 第一层「快速复盘」+ §5）
// 页面结构(自上而下):
//   ① 规则栏(全局唯一口径)
//   ② 本页筛选(类型/关键词) —— 【全局】作用于本页全部模块,保证同一屏只有一套口径(修 P0-3)
//   ③ 近期轮动观察       —— 【新】按可解释的观察标签列出 3 条(可展开全部),这是本层最重要的结论入口
//   ④ 每日强弱榜单       —— 最新交易日最强/最弱(标注交易日 + 数据状态)
//   ⑤ 板块行为统计表     —— 默认 7 列 + 「展开更多列」;= 全页的「选择器」:点行 → 时间轴聚焦
//   ⑥ 板块热力网格       —— Canvas 网格(可点格子看判定依据),档位 Top5/10/20/40/80/全部
//   ⑦ 高级研究(折叠)    —— 板块轮动关系 / 行为画像与分类榜单 / 活跃度评分构成
// 设计原则:所有模块共用同一份 rule 与同一份 filteredStats(规则 scope × 页面筛选),
//          位置型取值一律经 toWindowView，避免覆盖率<100% 时错位。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, PageHeader } from './Overview';
import { InfoTip, TitleWithTip, tipItems } from '../components/InfoTip';
import { RotationRuleBar } from '../components/RotationRulePanel';
import { RotationRelations } from '../components/RotationRelations';
import { useRotationData, useRotationRule } from '../data/rotationData';
import { WATCH_LIMIT, inWatchlist, toggleWatch, useWatchlist } from '../data/watchlist';
import { COLOR_BORDER, COLOR_DOWN, COLOR_FLAT, COLOR_TEXT, COLOR_UP, describeGenTime } from '../utils/format';
import { analyzeAll, SCORE_WEIGHTS, sinceStatsOf } from '../utils/rotation/analytics';
import type { SectorStats } from '../utils/rotation/analytics';
import { computeWindow, toWindowView } from '../utils/rotation/ruleEngine';
import type { SectorType } from '../utils/rotation/types';
import { OBSERVATION_COLOR, buildObservations, pickHighlightObservations } from '../utils/rotation/observations';
import type { Observation, ObservationMetric } from '../utils/rotation/observations';

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

// 近期轮动观察默认展示条数
// §5.3 给的范围是 3~5;列表在 >1200px 下已改为 1 行 2 列,故提到 4 —— 正好占满 2 行无残缺边,
// 且 pickHighlightObservations 会优先取"不同标签",4 条能覆盖 4 类标签(标签共 5 类),
// 比取 6 条时不得不重复已有标签更划算。超出部分仍可通过「展开全部」查看。
const OBS_DEFAULT = 4;

// 统计表列定义 —— 默认 7 列(§5.6),其余进「展开更多列」
const STATS_HEADERS_DEFAULT = ['板块', '强势次数', '弱势次数', '最近活跃日期', '事件间隔摘要', '累计收益', '相对基准超额'];
const STATS_HEADERS_MORE = ['类型', '强势频率', '平均间隔', '独立周期', '独立间隔', '最大回撤', '活跃度', '覆盖率'];
const STATS_HEADERS = [...STATS_HEADERS_DEFAULT, ...STATS_HEADERS_MORE]; // InfoTip 词条
const BOARD_HEADERS_BASE = ['板块', '类型'];
const MINI_TABLE_HEADERS = ['序号', '板块', '类型', '涨跌幅'];

// 热力网格档位(v2.0.9 补 Top5 / Top10 / 全部)
const HEATMAP_LEVELS: { label: string; value: string }[] = [
  { label: 'Top5', value: '5' },
  { label: 'Top10', value: '10' },
  { label: 'Top20', value: '20' },
  { label: 'Top40', value: '40' },
  { label: 'Top80', value: '80' },
  { label: '全部', value: 'all' },
];

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

// v2.0.8kz:每日最强/最弱榜的小卡片网格 —— 一行最多 5 张,窄屏自动降列
// 颜色深浅按名次递变(第 1 名最重,往后越浅),hover 轻微上浮
// v2.0.9:新增 .tj-obs-card(近期轮动观察卡片)的 hover 效果
const AUX_CSS = `
  .tj-mini-cards { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
  .tj-mini-card { transition: transform .15s ease, box-shadow .15s ease, filter .15s ease; }
  .tj-mini-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.08); filter: brightness(1.04); }
  .tj-obs-card { transition: border-color .15s ease, box-shadow .15s ease, background .15s ease; }
  .tj-obs-card:hover { border-color: #1890FF !important; box-shadow: 0 4px 14px rgba(24,144,255,0.10); background: #FCFDFF; }
  @media (max-width: 1280px) { .tj-mini-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @media (max-width: 760px) { .tj-mini-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  /* v2.0.9:近期轮动观察列表 —— 屏幕 >1200px 时 1 行 2 列,否则 1 行 1 列 */
  .tj-obs-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
  @media (min-width: 1201px) { .tj-obs-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
`;

function MiniBoardCards({
  rows,
  mode,
  empty = '当日无数据',
}: {
  rows: { id: string; name: string; pct: number; rank: number; type: SectorType }[];
  mode: 'up' | 'down';
  empty?: string;
}) {
  const nav = useNavigate();
  if (!rows.length) return <div style={{ fontSize: 12, color: '#86909C', padding: '12px 0' }}>{empty}</div>;
  const rgb = mode === 'up' ? '255, 77, 79' : '14, 205, 112';      // 红=最强 / 绿=最弱
  const main = mode === 'up' ? COLOR_UP : COLOR_DOWN;
  const n = rows.length;
  return (
    <div className="tj-mini-cards">
      {rows.map((r, i) => {
        // 名次越靠前颜色越重:第 1 名 0.16,最后一名 0
        const a = 0.16 * (1 - i / Math.max(1, n - 1));
        return (
          <div
            key={r.id}
            className="tj-mini-card"
            onClick={() => nav(`/rotation/sector/${r.id}`)}
            title={`${r.name} — 点击查看行为详情`}
            style={{
              background: `rgba(${rgb}, ${a.toFixed(3)})`,
              border: `1px solid rgba(${rgb}, ${Math.min(a + 0.1, 0.34).toFixed(3)})`,
              borderRadius: 10,
              padding: '8px 10px',
              cursor: 'pointer',
              minWidth: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: main }}>No.{r.rank}</span>
              <span style={{ fontSize: 10, color: '#86909C', background: '#fff', borderRadius: 4, padding: '1px 5px' }}>
                {TYPE_LABEL[r.type]}
              </span>
            </div>
            <div
              style={{
                fontSize: 12, fontWeight: 500, color: COLOR_TEXT, margin: '6px 0 3px',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {r.name}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: main, lineHeight: 1.15 }}>
              {r.pct > 0 ? '+' : ''}
              {r.pct.toFixed(2)}%
            </div>
          </div>
        );
      })}
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

/**
 * 关键数据 chips 的数值着色(与站点红涨绿跌一致):
 *   强势次数固定红 / 弱势次数固定绿(与数值正负无关);
 *   收益类(累计收益、相对基准)按数值正负 —— 正红 / 负绿 / 零灰(用 COLOR_FLAT,不用纯黑);
 *   其余(独立周期、平均间隔等)保持常规文字色。
 */
function metricColor(m: ObservationMetric): string {
  if (m.tone === 'strong') return COLOR_UP;
  if (m.tone === 'weak') return COLOR_DOWN;
  if (m.tone === 'signed') {
    const n = Number(m.v.replace(/[^0-9.+-]/g, ''));   // '+3.21%' → 3.21 ; '—' → 0
    if (!Number.isNaN(n) && n !== 0) return n > 0 ? COLOR_UP : COLOR_DOWN;
    return COLOR_FLAT;
  }
  return COLOR_TEXT;
}

/** 近期轮动观察卡片(§5.2:板块名/标签/触发依据/关键数据/最近事件日期/覆盖率/点击进详情) */
function ObservationCard({
  o,
  onOpen,
  watched,
  onToggleWatch,
}: {
  o: Observation;
  onOpen: (id: string) => void;
  watched: boolean;
  onToggleWatch: () => void;
}) {
  const color = OBSERVATION_COLOR[o.label];
  return (
    <div
      className="tj-obs-card"
      onClick={() => onOpen(o.sector.id)}
      title={`${o.sector.name} — 点击查看行为详情`}
      style={{
        border: `1px solid ${COLOR_BORDER}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 10,
        padding: '12px 14px',
        cursor: 'pointer',
        background: '#fff',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: color, borderRadius: 4, padding: '2px 8px' }}>
          {o.labelText}
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: COLOR_TEXT }}>{o.sector.name}</span>
        <span style={{ fontSize: 10, color: '#86909C', background: '#F5F6F8', borderRadius: 4, padding: '1px 5px' }}>
          {TYPE_LABEL[o.sector.type]}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            color: o.coverage < 1 ? '#FA8C16' : '#86909C',
          }}
        >
          最近事件 {o.lastEventDate ? dashToSlash(o.lastEventDate) : '—'} · 数据覆盖 {(o.coverage * 100).toFixed(0)}%
        </span>
        {/* 观察清单入口(§10);stopPropagation 避免同时触发"进入详情" */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleWatch();
          }}
          title={watched ? '从观察清单移除' : '加入观察清单（仅本设备）'}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 15,
            lineHeight: 1,
            padding: '2px 4px',
            color: watched ? '#FAAD14' : '#C9CDD4',
          }}
        >
          {watched ? '★' : '☆'}
        </button>
      </div>
      <div style={{ fontSize: 12, color: '#4E5969', lineHeight: 1.8, marginTop: 8 }}>
        <span style={{ color: '#86909C' }}>触发依据：</span>
        {o.reason}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: 11, color: '#86909C' }}>
        {o.metrics.map((m) => (
          <span key={m.k}>
            {m.k} <b style={{ color: metricColor(m), fontWeight: 600 }}>{m.v}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Rotation() {
  const { data, error, loading } = useRotationData();
  const [rule, setRule] = useRotationRule();
  const navigate = useNavigate();

  // 全页共用筛选(【全局】作用于本页全部模块,保证同一屏只有一套口径)
  const [typeFilter, setTypeFilter] = useState<'all' | SectorType>('all');
  const [kw, setKw] = useState('');
  const [sortKey, setSortKey] = useState<'score' | 'strong' | 'gap' | 'ret'>('score');
  const [showMoreCols, setShowMoreCols] = useState(false);
  const [obsOpen, setObsOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [boardMode, setBoardMode] = useState<'active' | 'reactivate' | 'trend'>('active');
  // 观察清单(§10):仅本设备浏览器内的"待继续验证名单"
  const [watchList] = useWatchlist();
  /** 加入观察清单时的"数据基准日"(用最新交易日,而非本机日期,避免节假日错位) */
  const basisDate = data?.meta?.lastTradeDate || '';

  // 时间轴状态
  const [rowLimit, setRowLimit] = useState<'5' | '10' | '20' | '40' | '80' | 'all'>('40');
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

  const kwTrim = kw.trim();
  const filterActive = typeFilter !== 'all' || kwTrim !== '';

  // 过滤后的板块(本页全部模块共用 —— 规则 scope × 页面筛选)
  const filteredStats = useMemo<SectorStats[]>(() => {
    if (!computed) return [];
    let rows = computed.stats;
    if (typeFilter !== 'all') rows = rows.filter((r) => r.sector.type === typeFilter);
    if (kwTrim) rows = rows.filter((r) => r.sector.name.includes(kwTrim));
    return rows;
  }, [computed, typeFilter, kwTrim]);

  const tableRows = useMemo(() => {
    const cmp = {
      score: (a: SectorStats, b: SectorStats) => b.score - a.score,
      strong: (a: SectorStats, b: SectorStats) => b.strongCount - a.strongCount,
      gap: (a: SectorStats, b: SectorStats) => (a.gapStrong.avg ?? 999) - (b.gapStrong.avg ?? 999),
      ret: (a: SectorStats, b: SectorStats) => b.cumReturn - a.cumReturn,
    }[sortKey];
    return [...filteredStats].sort(cmp).slice(0, 60);
  }, [filteredStats, sortKey]);

  // 实际统计窗口(交易日数)
  const windowDaysActual = computed?.comp.dates.length ?? 0;

  // 【新】近期轮动观察 —— 全部由真实统计量生成,不含硬编码
  const observations = useMemo<Observation[]>(
    () => (computed && windowDaysActual > 0 ? buildObservations(filteredStats, windowDaysActual) : []),
    [computed, filteredStats, windowDaysActual],
  );
  const shownObservations = obsOpen ? observations : pickHighlightObservations(observations, OBS_DEFAULT);

  // 「最近重新活跃」:距最近强势 ≤5 个交易日 且 此前空档 ≥10 个交易日(固定阈值,界面已标注)
  const reactivated = useMemo(() => {
    return filteredStats
      .filter((s) => s.lastStrongAgo != null && s.lastStrongAgo <= REACTIVATE_AGO && (s.lastGapBefore ?? 0) >= REACTIVATE_GAP)
      .sort((a, b) => (a.lastStrongAgo ?? 99) - (b.lastStrongAgo ?? 99) || (b.lastGapBefore ?? 0) - (a.lastGapBefore ?? 0));
  }, [filteredStats]);

  const latestAll = computed ? computed.comp.ranking[computed.comp.ranking.length - 1] : null;
  const typeById = useMemo(() => {
    const mp = new Map<string, SectorType>();
    (data?.sectors || []).forEach((s) => mp.set(s.id, s.type));
    return mp;
  }, [data]);

  // 观察清单的每一行:用**当前规则 + 最新数据**重新计算"自加入以来"的区间表现(§10)
  const watchRows = useMemo(() => {
    if (!computed || !data) return [];
    const mp = new Map(computed.comp.series.map((s) => [s.sector.id, s]));
    return watchList.map((w) => {
      const series = mp.get(w.id);
      if (!series) return { w, missing: true as const };
      return {
        w,
        missing: false as const,
        type: typeById.get(w.id) || ('industry' as SectorType),
        since: sinceStatsOf(data, computed.comp, series, w.basisDate),
      };
    });
  }, [computed, data, watchList, typeById]);

  // 每日榜单同样应用本页筛选(统一口径)
  const latestRanked = useMemo(() => {
    if (!latestAll) return [];
    return latestAll.ranked.filter(
      (r) => (typeFilter === 'all' || typeById.get(r.id) === typeFilter) && (!kwTrim || r.name.includes(kwTrim)),
    );
  }, [latestAll, typeFilter, kwTrim, typeById]);

  const strongTop = latestRanked
    .slice(0, rule.topN)
    .map((r) => ({ ...r, type: typeById.get(r.id) || ('industry' as SectorType) }));
  const weakTop = [...latestRanked]
    .reverse()
    .slice(0, rule.topN)
    .map((r) => ({ ...r, type: typeById.get(r.id) || ('industry' as SectorType) }));

  // 概览卡:4 个画像入口的高亮(基于筛选后的板块)
  const profile = useMemo(() => {
    if (!filteredStats.length) return null;
    const ss = filteredStats;
    const mostActive = [...ss].sort((a, b) => b.strongCount - a.strongCount)[0];
    const gapReady = ss.filter((s) => !s.gapStrong.sampleInsufficient && s.gapStrong.avg !== null);
    const tightest = [...gapReady].sort((a, b) => (a.gapStrong.avg ?? 999) - (b.gapStrong.avg ?? 999))[0];
    const bothSides = ss.filter((s) => s.strongCount > 0 && s.weakCount > 0).length;
    const bestRet = [...ss].sort((a, b) => b.cumReturn - a.cumReturn)[0];
    return { mostActive, tightest, bothSides, bestRet, total: ss.length };
  }, [filteredStats]);

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

  // 活跃度评分构成(取活跃度前 10 展示分项)
  const scoreRows = useMemo(() => [...filteredStats].sort((a, b) => b.score - a.score).slice(0, 10), [filteredStats]);

  // 时间轴行:聚焦某板块时只画它一行(放大便于看),否则画活跃度前 N 行
  const tlRows = useMemo<SectorStats[]>(() => {
    if (focusId) {
      const one = filteredStats.find((s) => s.sector.id === focusId);
      return one ? [one] : [];
    }
    const byScore = [...filteredStats].sort((a, b) => b.score - a.score);
    const active = byScore.filter((s) => s.strongCount + s.weakCount > 0);
    const pool = active.length ? active : byScore;
    return pool.slice(0, rowLimit === 'all' ? pool.length : Number(rowLimit));
  }, [filteredStats, focusId, rowLimit]);

  const cols = computed?.comp.dates.length ?? 0;
  const cellW = cols > 0 ? Math.max(10, Math.min(20, Math.floor(1000 / cols))) : 14;
  // 行高自适应:行数很多(如"全部")时压缩行高,避免 Canvas 尺寸过大
  const cellH = focusId ? 26 : Math.max(10, Math.min(18, Math.floor(6000 / Math.max(1, tlRows.length))));

  const seriesByRow = useMemo(() => {
    if (!computed) return [];
    const mp = new Map(computed.comp.series.map((s) => [s.sector.id, s]));
    return tlRows.map((r) => mp.get(r.sector.id)!);
  }, [computed, tlRows]);

  // v2.0.9:窗口对齐视图 —— 热力网格按"窗口第几列"取值，必须走 view(而非 series.events[c])，
  // 否则覆盖率<100% 的板块整行色块会错位。见 ruleEngine.toWindowView 注释。
  const viewByRow = useMemo(
    () => (computed ? seriesByRow.map((s) => (s ? toWindowView(computed.comp, s) : null)) : []),
    [computed, seriesByRow],
  );

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
      const s = viewByRow[r];
      for (let c = 0; c < cols; c++) {
        const ev = s?.eventAt[c] ?? null;
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
  }, [tlRows, viewByRow, cols, cellW, cellH, hover, picked]);

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
  // v2.0.9:hover/picked 一律按"窗口列"取值 → 走 viewByRow，避免覆盖率<100% 时错位
  const hoverSeries = hover ? seriesByRow[hover.r] : null;
  const hoverView = hover ? viewByRow[hover.r] : null;
  const hoverEv = hoverView && hover ? hoverView.eventAt[hover.c] : null;
  const hoverPct = hoverView && hover ? hoverView.pctAt[hover.c] : null;
  const pickedSeries = picked ? seriesByRow[picked.r] : null;
  const pickedView = picked ? viewByRow[picked.r] : null;
  const pickedEv = pickedView && picked ? pickedView.eventAt[picked.c] : null;

  const toCell = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    const c = Math.floor((e.clientX - rect.left) / cellW);
    const r = Math.floor((e.clientY - rect.top) / cellH);
    if (r < 0 || r >= tlRows.length || c < 0 || c >= cols) return null;
    return { r, c };
  };

  // 本页数据自身的生成时点判定(rotation.json 的 meta,固定东八区) —— 并入页头「报告日期」状态词
  // 口径见 format.describeGenTime:当日 15:05 ~ 次日 09:30 之间生成都算盘后数据
  // (云端 cron 常被 GH 延迟到深夜/次日凌晨,那种情况拿到的仍是该交易日的完整收盘数据)
  const gen = describeGenTime(m.generatedAt, m.lastTradeDate);

  // 数据状态标记:非当日盘后快照 → 明确提示,避免"用旧数据伪装成当日榜单"
  const staleTag = !gen.postClose ? (
    <span style={{ color: '#FA8C16' }}> · ⚠ 非当日盘后快照</span>
  ) : null;

  /** 统计表单元格:最近活跃日期 */
  const cellLastActive = (r: SectorStats) =>
    r.lastActiveDate ? dashToSlash(r.lastActiveDate) : <span style={{ color: '#B0B7C3' }}>—</span>;

  /** 统计表单元格:事件间隔摘要(强势平均间隔 · 独立周期平均间隔) */
  const cellGapSummary = (r: SectorStats) => {
    const g = r.gapStrong;
    const cg = r.clusterGapStrong;
    const p1 = g.sampleInsufficient || g.avg === null ? '强势间隔样本少' : `强势 ${g.avg.toFixed(1)} 日`;
    const p2 = cg.sampleInsufficient || cg.avg === null ? '' : ` · 独立 ${cg.avg.toFixed(1)} 日`;
    return <span style={{ color: '#4E5969' }}>{p1}{p2}</span>;
  };

  // 统计表列(默认 7 列 + 展开更多列)
  const columns: { key: string; label: string; more?: boolean; align: 'left' | 'center'; cell: (r: SectorStats) => React.ReactNode }[] = [
    {
      key: 'sector',
      label: '板块',
      align: 'left',
      cell: (r) => (
        <>
          <span style={{ color: COLOR_TEXT }}>{r.sector.name}</span>
          <span style={{ fontSize: 10, color: '#86909C', background: '#F5F6F8', borderRadius: 4, padding: '1px 5px', marginLeft: 6 }}>
            {TYPE_LABEL[r.sector.type]}
          </span>
          {/* 观察清单入口(§10) */}
          <span
            onClick={(e) => {
              e.stopPropagation();
              toggleWatch({ id: r.sector.id, name: r.sector.name }, basisDate);
            }}
            title={inWatchlist(watchList, r.sector.id) ? '从观察清单移除' : '加入观察清单（仅本设备）'}
            style={{ cursor: 'pointer', fontSize: 13, marginLeft: 8, color: inWatchlist(watchList, r.sector.id) ? '#FAAD14' : '#C9CDD4' }}
          >
            {inWatchlist(watchList, r.sector.id) ? '★' : '☆'}
          </span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/rotation/sector/${r.sector.id}`);
            }}
            style={{ color: '#1890FF', fontSize: 11, marginLeft: 8 }}
          >
            详情 ›
          </span>
        </>
      ),
    },
    { key: 'strong', label: '强势次数', align: 'center', cell: (r) => <span style={{ color: COLOR_UP, fontWeight: 600 }}>{r.strongCount}</span> },
    { key: 'weak', label: '弱势次数', align: 'center', cell: (r) => <span style={{ color: COLOR_DOWN, fontWeight: 600 }}>{r.weakCount}</span> },
    { key: 'lastActive', label: '最近活跃日期', align: 'center', cell: cellLastActive },
    { key: 'gapSummary', label: '事件间隔摘要', align: 'center', cell: cellGapSummary },
    {
      key: 'cum',
      label: '累计收益',
      align: 'center',
      cell: (r) => (
        <span style={{ fontWeight: 600, color: r.cumReturn > 0 ? COLOR_UP : r.cumReturn < 0 ? COLOR_DOWN : COLOR_FLAT }}>
          {(r.cumReturn * 100).toFixed(2)}%
        </span>
      ),
    },
    {
      key: 'rel',
      label: '相对基准超额',
      align: 'center',
      cell: (r) =>
        r.relStrength == null ? (
          <span style={{ color: '#B0B7C3' }}>—</span>
        ) : (
          <span style={{ fontWeight: 600, color: r.relStrength > 0 ? COLOR_UP : r.relStrength < 0 ? COLOR_DOWN : COLOR_FLAT }}>
            {r.relStrength > 0 ? '+' : ''}
            {(r.relStrength * 100).toFixed(2)}%
          </span>
        ),
    },
    // —— 以下为「展开更多列」 ——
    { key: 'type', label: '类型', align: 'center', more: true, cell: (r) => <span style={{ color: '#86909C' }}>{TYPE_LABEL[r.sector.type]}</span> },
    { key: 'freq', label: '强势频率', align: 'center', more: true, cell: (r) => `${(r.strongFreq * 100).toFixed(0)}%` },
    {
      key: 'gapAvg',
      label: '平均间隔',
      align: 'center',
      more: true,
      cell: (r) => (
        <span>
          {r.gapStrong.avg != null ? `${r.gapStrong.avg.toFixed(1)} 日` : '—'}
          {r.gapStrong.sampleInsufficient && <span style={{ color: COLOR_FLAT, fontSize: 10 }}> 样本少</span>}
        </span>
      ),
    },
    { key: 'clusters', label: '独立周期', align: 'center', more: true, cell: (r) => r.clustersStrong.length },
    {
      key: 'clusterGap',
      label: '独立间隔',
      align: 'center',
      more: true,
      cell: (r) => (r.clusterGapStrong.avg != null ? `${r.clusterGapStrong.avg.toFixed(1)} 日` : '—'),
    },
    {
      key: 'mdd',
      label: '最大回撤',
      align: 'center',
      more: true,
      cell: (r) => <span style={{ color: COLOR_DOWN }}>{(r.maxDrawdown * 100).toFixed(2)}%</span>,
    },
    { key: 'score', label: '活跃度', align: 'center', more: true, cell: (r) => <span style={{ fontWeight: 600 }}>{r.score.toFixed(1)}</span> },
    {
      key: 'coverage',
      label: '覆盖率',
      align: 'center',
      more: true,
      cell: (r) => <span style={{ color: r.coverage < 1 ? '#FA8C16' : '#86909C' }}>{(r.coverage * 100).toFixed(0)}%</span>,
    },
  ];

  const shownColumns = columns.filter((c) => showMoreCols || !c.more);

  return (
    <div>
      <style>{AUX_CSS}</style>
      <PageHeader
        title="板块轮动档案"
        tradeDateSlash={dashToSlash(m.lastTradeDate)}
        subtitle="轮动观察 · 每日榜单 · 行为统计 · 事件热力网格 · 高级研究（可配置规则，全窗口可复算）"
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

      {/* ② 本页筛选 —— 【全局】作用于本页全部模块(修 P0-3:同一屏只允许一套口径) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT }}>本页筛选</span>
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
        <input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="搜索板块名…"
          style={{ border: `1px solid ${COLOR_BORDER}`, borderRadius: 8, padding: '5px 10px', fontSize: 12, outline: 'none', width: 200 }}
        />
        <span style={{ fontSize: 11, color: '#86909C' }}>筛选后 {filteredStats.length} 个板块</span>
        {filterActive && (
          <button
            onClick={() => {
              setTypeFilter('all');
              setKw('');
              setPicked(null);
            }}
            style={{ border: `1px solid ${COLOR_BORDER}`, background: '#fff', color: '#4E5969', borderRadius: 8, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            清除筛选
          </button>
        )}
      </div>
      <div style={{ fontSize: 11, color: '#86909C', marginTop: 6, lineHeight: 1.8 }}>
        类型 / 关键词筛选<b>同时作用于本页全部模块</b>（每日榜单、近期轮动观察、行为统计表、热力网格、高级研究）——
        同一屏只有一套口径，避免各模块筛选范围不一致。板块总数范围另由上方规则栏的「板块范围」控制，两者取交集。
      </div>

      {/* ③ 近期轮动观察 —— 本层最重要的结论入口(§5.1) */}
      <div style={{ height: 16 }} />
      <Card
        title={<TitleWithTip text="近期轮动观察" items={tipItems(['近期轮动观察', '持续活跃', '反复脉冲', '沉寂后重新活跃', '强弱交替', '相对走强', '触发依据'])} title="观察标签含义" />}
        right={
          <span style={{ fontSize: 11, color: '#86909C' }}>
            统计窗口 近 {windowDaysActual} 个交易日 · 阈值口径：<b style={{ color: '#FA8C16' }}>实验参数</b>
          </span>
        }
      >
        {observations.length === 0 ? (
          <div style={{ background: '#F7F9FC', border: `1px dashed ${COLOR_BORDER}`, borderRadius: 10, padding: '18px 16px', fontSize: 12, color: '#4E5969', lineHeight: 1.9 }}>
            <div style={{ fontWeight: 600, color: COLOR_TEXT }}>当前规则下暂无符合条件的明显轮动观察。</div>
            <div style={{ color: '#86909C', marginTop: 4 }}>
              这是<b>当前统计窗口与观察阈值</b>下的结果，不代表市场没有机会；可调整上方规则或放宽窗口后重新计算。
              {filterActive && '（当前已应用本页筛选，也可能因此排除了符合条件的板块。）'}
            </div>
          </div>
        ) : (
          <>
            {/* v2.0.9:>1200px 时 1 行 2 列(见 AUX_CSS 的 .tj-obs-grid),窄屏降为 1 列 */}
            <div className="tj-obs-grid">
              {shownObservations.map((o) => (
                <ObservationCard
                  key={o.sector.id}
                  o={o}
                  onOpen={(id) => navigate(`/rotation/sector/${id}`)}
                  watched={inWatchlist(watchList, o.sector.id)}
                  onToggleWatch={() => toggleWatch({ id: o.sector.id, name: o.sector.name }, basisDate)}
                />
              ))}
            </div>
            {observations.length > OBS_DEFAULT && (
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <button
                  onClick={() => setObsOpen((v) => !v)}
                  style={{ border: `1px solid ${COLOR_BORDER}`, background: '#fff', color: '#1890FF', borderRadius: 8, padding: '5px 16px', fontSize: 12, cursor: 'pointer' }}
                >
                  {obsOpen ? '收起' : `展开全部（共 ${observations.length} 条）`}
                </button>
              </div>
            )}
            <div style={{ fontSize: 11, color: '#86909C', marginTop: 12, lineHeight: 1.8 }}>
              以上分类仅为<b>观察线索</b>（由真实统计量按可解释规则生成），不代表买卖建议；每个板块只保留最有辨识度的一个标签，避免重复。
              阈值为尚未回测验证的<b>实验参数</b>，用于可解释性展示。
            </div>
          </>
        )}
      </Card>

      {/* 观察清单(§10):仅本设备,回答"该把哪些板块加入清单并继续验证" */}
      <div style={{ height: 16 }} />
      <Card
        title={<TitleWithTip text="我的观察清单" items={tipItems(['观察清单', '加入以来区间', '加入于', '观察起点', '相对基准超额', '仅本设备'])} title="观察清单说明" />}
        right={
          <span style={{ fontSize: 11, color: '#86909C' }}>
            仅本设备（浏览器本地）· 共 {watchList.length} / {WATCH_LIMIT}
          </span>
        }
      >
        {watchList.length === 0 ? (
          <div style={{ background: '#F7F9FC', border: `1px dashed ${COLOR_BORDER}`, borderRadius: 10, padding: '16px', fontSize: 12, color: '#4E5969', lineHeight: 1.9 }}>
            还没有观察中的板块。在下方「轮动观察卡」或「板块行为统计表」点 <b style={{ color: '#FAAD14' }}>☆</b> 即可加入，
            之后回到本页会用<b>当前规则与最新数据</b>重新计算它们的表现，便于在后续交易日继续验证。
            <div style={{ color: '#86909C', marginTop: 4 }}>清单只保存在本设备浏览器，不联网、不跨设备，清缓存会丢失。</div>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
                <thead>
                  <tr style={{ background: '#F7F9FC', color: '#86909C' }}>
                    {['板块', '加入于', '观察区间', '强势', '弱势', '区间累计收益', '相对基准超额', '最近事件', '操作'].map((h, i) => (
                      <th key={h} style={{ padding: '9px 10px', textAlign: i === 0 || i === 8 ? 'left' : 'center', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {watchRows.map((row) => (
                    <tr key={row.w.id} style={{ borderBottom: `1px solid ${COLOR_BORDER}` }}>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                        <span
                          onClick={() => navigate(`/rotation/sector/${row.w.id}`)}
                          style={{ color: COLOR_TEXT, cursor: 'pointer', borderBottom: '1px dashed #D5DAE2' }}
                        >
                          {row.w.name}
                        </span>
                        {!row.missing && (
                          <span style={{ fontSize: 10, color: '#86909C', background: '#F5F6F8', borderRadius: 4, padding: '1px 5px', marginLeft: 6 }}>
                            {TYPE_LABEL[row.type]}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '9px 10px', textAlign: 'center', color: '#86909C' }}>{row.w.addedAt || '—'}</td>
                      {row.missing ? (
                        <td colSpan={6} style={{ padding: '9px 10px', color: '#FA8C16' }}>
                          该板块不在当前规则的「板块范围」内，暂无法计算表现（可在上方规则栏把范围调回"全部板块"）。
                        </td>
                      ) : (
                        <>
                          <td style={{ padding: '9px 10px', textAlign: 'center', color: '#4E5969' }}>
                            {row.since.fromDate} 起 · {row.since.days} 个交易日
                            {row.since.truncated && <span style={{ color: '#FA8C16' }}>（已超窗口，按最早可用日）</span>}
                          </td>
                          <td style={{ padding: '9px 10px', textAlign: 'center', color: COLOR_UP, fontWeight: 600 }}>{row.since.strongCount}</td>
                          <td style={{ padding: '9px 10px', textAlign: 'center', color: COLOR_DOWN, fontWeight: 600 }}>{row.since.weakCount}</td>
                          <td
                            style={{
                              padding: '9px 10px',
                              textAlign: 'center',
                              fontWeight: 600,
                              color: row.since.cumReturn == null ? COLOR_FLAT : row.since.cumReturn > 0 ? COLOR_UP : row.since.cumReturn < 0 ? COLOR_DOWN : COLOR_FLAT,
                            }}
                          >
                            {row.since.cumReturn == null ? '—' : `${(row.since.cumReturn * 100).toFixed(2)}%`}
                          </td>
                          <td
                            style={{
                              padding: '9px 10px',
                              textAlign: 'center',
                              fontWeight: 600,
                              color: row.since.rel == null ? COLOR_FLAT : row.since.rel > 0 ? COLOR_UP : row.since.rel < 0 ? COLOR_DOWN : COLOR_FLAT,
                            }}
                          >
                            {row.since.rel == null ? '—' : `${row.since.rel > 0 ? '+' : ''}${(row.since.rel * 100).toFixed(2)}%`}
                          </td>
                          <td style={{ padding: '9px 10px', textAlign: 'center', color: '#86909C' }}>{row.since.lastEventDate || '区间内无'}</td>
                        </>
                      )}
                      <td style={{ padding: '9px 10px' }}>
                        <button
                          onClick={() => toggleWatch({ id: row.w.id, name: row.w.name }, basisDate)}
                          style={{ border: `1px solid ${COLOR_BORDER}`, background: '#fff', color: '#4E5969', borderRadius: 8, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}
                        >
                          移除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: '#86909C', marginTop: 10, lineHeight: 1.8 }}>
              区间口径：「加入于」只是本机日期；计算用的是<b>加入时数据的最新交易日</b>到当前窗口末。
              强势/弱势次数为该区间内按<b>当前规则</b>判定的事件数；尚未结算的交易日（本周最新一根）也在区间内。
            </div>
          </>
        )}
      </Card>

      {/* ④ 每日强弱榜单 —— 1 行 2 列小卡片(标注交易日 + 数据状态) */}
      <div style={{ height: 16 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, alignItems: 'stretch' }}>
        <Card
          title={
            <TitleWithTip
              text={`每日最强板块 TOP ${rule.topN}`}
              items={tipItems([...MINI_TABLE_HEADERS, '排名规则'])}
              title="字段含义 / 排名规则"
            />
          }
          right={
            <span style={{ fontSize: 11, color: '#86909C' }}>
              {latestAll?.date || '-'} · {filterActive ? '筛选后' : '当日'}有效板块 {latestRanked.length} 个
              {staleTag}
            </span>
          }
        >
          <MiniBoardCards rows={strongTop} mode="up" empty={filterActive ? '当前筛选下当日无匹配板块' : '当日无数据'} />
        </Card>
        <Card
          title={
            <TitleWithTip
              text={`每日最弱板块 TOP ${rule.topN}`}
              items={tipItems([...MINI_TABLE_HEADERS, '排名规则'])}
              title="字段含义 / 排名规则"
            />
          }
          right={
            <span style={{ fontSize: 11, color: '#86909C' }}>
              {latestAll?.date || '-'} · {filterActive ? '筛选后' : '当日'}有效板块 {latestRanked.length} 个
              {staleTag}
            </span>
          }
        >
          <MiniBoardCards rows={weakTop} mode="down" empty={filterActive ? '当前筛选下当日无匹配板块' : '当日无数据'} />
        </Card>
      </div>

      {/* ⑤ 板块行为统计表(= 全页选择器) */}
      <div style={{ height: 16 }} />
      <Card
        title={<TitleWithTip text="板块行为统计表" items={tipItems(STATS_HEADERS)} title="列含义 / 计算公式" />}
        right={
          <span style={{ fontSize: 11, color: '#86909C' }}>
            筛选后 {filteredStats.length} 个，展示前 {tableRows.length} 个 · 点击行 → 下方热力网格聚焦该板块
          </span>
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#4E5969' }}>排序</span>
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
          <button
            onClick={() => setShowMoreCols((v) => !v)}
            style={{ border: `1px solid ${COLOR_BORDER}`, background: '#fff', color: '#1890FF', borderRadius: 8, padding: '5px 14px', fontSize: 12, cursor: 'pointer' }}
          >
            {showMoreCols ? '收起更多列' : `展开更多列（+${STATS_HEADERS_MORE.length}）`}
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: showMoreCols ? 1240 : 880 }}>
            <thead>
              <tr style={{ background: '#F7F9FC', color: '#86909C' }}>
                {shownColumns.map((c) => (
                  // v2.0.8kw:除首列外,表头与单元格一律水平居中
                  <th key={c.key} style={{ padding: '9px 10px', textAlign: c.align, fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr
                  key={r.sector.id}
                  onClick={() => pickSector(r.sector.id)}
                  style={{
                    borderBottom: `1px solid ${COLOR_BORDER}`,
                    cursor: 'pointer',
                    background: focusId === r.sector.id ? '#F0F7FF' : undefined,
                  }}
                >
                  {shownColumns.map((c) => (
                    <td key={c.key} style={{ padding: '9px 10px', textAlign: c.align, whiteSpace: c.key === 'sector' ? 'nowrap' : undefined }}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
              {!tableRows.length && (
                <tr>
                  <td colSpan={shownColumns.length} style={{ padding: '14px 10px', color: '#86909C' }}>
                    {filterActive ? '当前筛选下没有符合条件的板块（可清除筛选或调整规则范围）。' : '当前规则下没有符合条件的板块。'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: '#86909C', marginTop: 12, lineHeight: 1.8 }}>
          口径说明:间隔按<b>交易日序号差</b>计算（相邻两个事件日相差 1 即"间隔 1 个交易日"）；间隔样本少于 4 个时标注"样本少"，不计算集中度；
          累计收益为<b>复合收益</b> ∏(1+r)−1，不可简单相加；覆盖率 &lt; 100% 表示该板块存在数据缺失日（缺失日不计为 0 涨跌幅）。
          板块指数收益用于行情研究，不等于可交易组合收益。
        </div>
      </Card>

      {/* ⑥ 事件热力网格(与上方筛选/选中联动) */}
      <div style={{ height: 16 }} />
      <div ref={timelineRef}>
        <Card
          title={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <TitleWithTip
                text={`板块热力网格（近${rule.windowDays}交易日）`}
                items={tipItems(HEATMAP_LEGEND.map(({ c, t }) => ({ label: t, color: c })))}
                title="网格颜色含义"
              />
              {!focusId && (
                <Seg
                  value={rowLimit}
                  onChange={(v) => {
                    setRowLimit(v);
                    setPicked(null);
                  }}
                  options={HEATMAP_LEVELS.map((l) => ({ label: l.label, value: l.value as typeof rowLimit }))}
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
              {hover && hoverSeries && hoverView && hoverEv && (
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
                    {hoverView.rankUpAt[hover.c] ? ` · 涨幅榜第 ${hoverView.rankUpAt[hover.c]}` : ''}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 格子点击解释 */}
          {picked && pickedSeries && pickedView && (
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
                          color: (pickedView.pctAt[picked.c] ?? 0) > 0 ? COLOR_UP : COLOR_DOWN,
                        }}
                      >
                        {(pickedView.pctAt[picked.c] ?? 0) > 0 ? '+' : ''}
                        {(pickedView.pctAt[picked.c] ?? 0).toFixed(2)}%
                      </div>
                    </div>
                    <div style={{ background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, color: '#86909C', marginBottom: 6 }}>当日排名</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: COLOR_TEXT }}>
                        涨幅榜第 {pickedView.rankUpAt[picked.c] ?? '—'} / 共 {computed.comp.ranking[picked.c].total}
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

      {/* ⑦ 高级研究(折叠) —— 关联分析 / 行为画像与榜单 / 活跃度评分构成 */}
      <div style={{ height: 16 }} />
      <Card
        title={
          <span onClick={() => setAdvOpen((v) => !v)} style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#86909C' }}>{advOpen ? '▾' : '▸'}</span>
            <span>高级研究</span>
          </span>
        }
        right={
          <span style={{ fontSize: 11, color: '#86909C' }}>
            {advOpen ? '点击标题收起' : '点击标题展开 · 轮动关系 / 行为画像与分类榜单 / 活跃度评分构成'}
          </span>
        }
      >
        {advOpen ? (
          <div>
            {/* (a) 板块轮动关系 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT }}>板块轮动关系</span>
                <InfoTip
                  items={tipItems(['共同活跃天数', '重合率(Jaccard)', 'Lift', '基准频率', '最佳滞后', '命中样本', '上涨日频率', '差值'])}
                  title="核心指标含义"
                />
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#86909C' }}>历史统计关联 · 非因果</span>
              </div>
              <RotationRelations data={data} rule={rule} comp={computed.comp} stats={filteredStats} />
            </div>

            <div style={{ height: 1, background: COLOR_BORDER, margin: '20px 0' }} />

            {/* (b) 板块行为画像 + 分类榜单 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT }}>板块行为画像与分类榜单</span>
                <InfoTip items={tipItems(PROFILE_CARD_LABELS)} title="概览指标含义" />
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#86909C' }}>近 {rule.windowDays} 个交易日 · 受本页筛选影响</span>
              </div>
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
            </div>

            <div style={{ height: 1, background: COLOR_BORDER, margin: '20px 0' }} />

            {/* (c) 活跃度评分构成 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT }}>活跃度评分构成</span>
                <InfoTip
                  items={tipItems(['活跃度', '强势频率分', '近期活跃度', '独立周期频率', '相对市场趋势', '总分', '实验参数'])}
                  title="评分分项与权重含义"
                />
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#86909C' }}>权重为<b style={{ color: '#FA8C16' }}>实验参数</b> · 各分项已归一化到 0~1</span>
              </div>
              <div style={{ fontSize: 12, color: '#4E5969', lineHeight: 1.9, marginBottom: 10 }}>
                活跃度 = 强势频率 × {(SCORE_WEIGHTS.f1 * 100).toFixed(0)}% + 近期活跃 × {(SCORE_WEIGHTS.f2 * 100).toFixed(0)}% +
                独立周期频率 × {(SCORE_WEIGHTS.f3 * 100).toFixed(0)}% + 相对市场趋势 × {(SCORE_WEIGHTS.f4 * 100).toFixed(0)}%，
                加总后 × 100 四舍五入。
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 560 }}>
                  <thead>
                    <tr style={{ background: '#F7F9FC', color: '#86909C' }}>
                      {['板块', '强势频率', '近期活跃', '独立周期', '相对趋势', '总分'].map((h) => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: h === '板块' ? 'left' : 'center', fontWeight: 500 }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scoreRows.map((r) => (
                      <tr key={r.sector.id} style={{ borderBottom: `1px solid ${COLOR_BORDER}` }}>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          <span
                            onClick={() => navigate(`/rotation/sector/${r.sector.id}`)}
                            style={{ color: COLOR_TEXT, cursor: 'pointer' }}
                          >
                            {r.sector.name}
                          </span>
                        </td>
                        {[r.scoreParts.f1, r.scoreParts.f2, r.scoreParts.f3, r.scoreParts.f4].map((f, i) => (
                          <td key={i} style={{ padding: '8px 10px', textAlign: 'center', color: '#4E5969' }}>
                            {f.toFixed(2)}
                          </td>
                        ))}
                        <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700 }}>{r.score}</td>
                      </tr>
                    ))}
                    {!scoreRows.length && (
                      <tr>
                        <td colSpan={6} style={{ padding: '14px 10px', color: '#86909C' }}>
                          当前筛选下没有可展示的板块。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
