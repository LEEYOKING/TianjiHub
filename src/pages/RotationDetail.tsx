// 【板块轮动】第二层视图:板块行为详情(V2.0 阶段 4 精修)
// 信息顺序严格对齐任务书 §6.1:
//   ① 板块名称 / 分类 / 数据状态   ② 当前规则摘要
//   ③ 核心统计摘要(8 卡 + 「更多统计」折叠)  ④ 历史强弱事件时间轴(可点 → 簇归属 + 曲线位置)
//   ⑤ 窗口净值与基准曲线(口径声明 + 可选相对净值)  ⑥ 行为特征分析(五段式)
//   ⑦ 事件明细(最近 N 条 + 查看全部;原始事件日 vs 独立簇分列)
//   ⑧ 高级统计与关联分析(该板块参与的同步/领先关系)+ 计算口径
// 硬约束:
//   · 位置型取值(时间轴按"窗口第几列")一律走 toWindowView(覆盖率<100% 不错位)
//   · 净值/回撤/累计收益/相对基准只有一套实现(analytics),曲线与摘要同源
//   · 时间轴事件数 = 摘要事件数 = 明细事件数(页面显式自检并展示)
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { Card, PageHeader } from './Overview';
import { TitleWithTip, tipItems } from '../components/InfoTip';
import { RotationRuleBar, pctColor } from '../components/RotationRulePanel';
import { useRotationData, useRotationRule } from '../data/rotationData';
import { inWatchlist, toggleWatch, useWatchlist } from '../data/watchlist';
import { COLOR_BORDER, COLOR_DOWN, COLOR_FLAT, COLOR_TEXT, COLOR_UP, describeGenTime } from '../utils/format';
import { useEchartsResize } from '../hooks/useEchartsResize';
import {
  SCORE_WEIGHTS,
  analyzeAll,
  buildNavSeries,
  relativeToBench,
  summarizeBehavior,
} from '../utils/rotation/analytics';
import { computeWindow, toWindowView } from '../utils/rotation/ruleEngine';
import { computeLeadLag, computeSectorPeers } from '../utils/rotation/relations';
import type { SectorType } from '../utils/rotation/types';

const TYPE_LABEL: Record<SectorType, string> = { industry: '行业', concept: '概念', region: '地域' };

const COLOR_STRONG = COLOR_UP;
const COLOR_WEAK = COLOR_DOWN;
const COLOR_LARGE_UP = '#d9363e';
const COLOR_LARGE_DOWN = '#089b55';
const COLOR_REL = '#1890FF';    // 相对净值线
const COLOR_NONE = '#F0F1F2';
const COLOR_NA = '#FAFAFA';     // 无数据底色

// 时间轴图例(6 类:4 类事件 + 未触发 + 无数据) —— 色块与名称一一对应,同一份数据复用给气泡
const TIMELINE_LEGEND: { c: string; t: string }[] = [
  { c: COLOR_LARGE_UP, t: '大涨' },
  { c: COLOR_STRONG, t: '进强势榜' },
  { c: COLOR_LARGE_DOWN, t: '大跌' },
  { c: COLOR_WEAK, t: '进弱势榜' },
  { c: COLOR_NONE, t: '未进榜' },
  { c: COLOR_NA, t: '无数据' },
];

// 各区块的"感叹号"气泡字段清单 —— 与区块内实际出现的字段/图例一一对应
const CORE_LABELS = ['强势事件次数', '弱势事件次数', '累计收益', '相对基准超额', '最近一次活跃事件', '强势事件平均间隔', '最大回撤', '数据有效覆盖率'];
const MORE_LABELS = ['大涨事件日', '大跌事件日', '当前连续强势', '当前连续弱势', '独立活跃周期', '活跃度评分', '间隔集中度', '相对净值表现', '更多统计'];
const CURVE_LABELS = ['累计净值曲线', '基准', '相对净值表现', '净值曲线口径', '窗口起止'];
const SUMMARY_LABELS = ['历史行为', '活跃模式', '收益与风险', '统计局限', '后续观察'];
const DETAIL_LABELS = ['强势事件日期', '弱势事件日期', '起始日', '结束日', '事件日数', '簇内最大涨幅', '簇内累计收益', '事件日'];
const REL_LABELS = ['同步活跃伙伴', '共同活跃天数', '各自活跃天数', '重合率(Jaccard)', 'Lift', '走强后的跟随板块', '最佳滞后', '命中样本', '基准频率'];

function dashToSlash(d?: string): string {
  if (!d || d.length < 10) return '';
  return `${d.slice(2, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}`;
}

function KV({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, color: '#86909C', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: color || COLOR_TEXT, lineHeight: 1.15 }}>{value}</div>
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

/** 五段式行为总结的一个子块 */
function SummaryBlock({ tag, title, lines, color }: { tag: string; title: string; lines: string[]; color: string }) {
  return (
    <div style={{ background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: color, borderRadius: 4, padding: '1px 7px' }}>{tag}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT }}>{title}</span>
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#4E5969', lineHeight: 1.9 }}>
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

export default function RotationDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading } = useRotationData();
  const [rule, setRule] = useRotationRule();
  // 观察清单(§10):仅本设备
  const [watchList] = useWatchlist();
  useEchartsResize();

  const [showMoreStats, setShowMoreStats] = useState(false);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [showAllClusters, setShowAllClusters] = useState(false);
  const [pickedIdx, setPickedIdx] = useState<number | null>(null);
  const [navMode, setNavMode] = useState<'vs' | 'rel'>('vs');

  const payload = useMemo(() => {
    if (!data || !id) return null;
    const comp = computeWindow(data, rule);
    // 全量分析:详情页的"同步/领先关系"需要全部板块的强势事件序列与名称(口径与主页完全一致)
    const allStats = analyzeAll(data, rule, comp);
    const stats = allStats.find((s) => s.sector.id === id);
    if (!stats) return null;
    const series = comp.series.find((s) => s.sector.id === id);
    if (!series) return null;
    const view = toWindowView(comp, series);
    const nav = buildNavSeries(data, comp, series);
    const relNet = relativeToBench(data, comp, series).netValue;
    const peers = computeSectorPeers(comp, allStats, id, { minCoDays: 2, limit: 6 });
    const follow = computeLeadLag(comp, allStats, id, 5)
      .filter((r) => r.best !== null && r.samples >= 3)
      .slice(0, 6);
    const summary = summarizeBehavior(stats, rule, {
      benchAvailable: nav.benchAvailable,
      benchmark: data.meta.benchmark,
    });
    return { comp, allStats, series, stats, view, nav, relNet, peers, follow, summary };
  }, [data, id, rule]);

  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center', color: '#86909C', fontSize: 13 }}>板块轮动数据加载中…</div>;
  }
  if (error || !data) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: '#86909C', fontSize: 13 }}>
        板块轮动数据暂不可用{error ? `（${error}）` : ''}
      </div>
    );
  }
  if (!payload) {
    return (
      <div>
        <PageHeader title="板块详情" tradeDateSlash={dashToSlash(data.meta.lastTradeDate)} subtitle="未找到该板块（可能不在当前规则的板块范围内）" />
        <Card title="提示">
          <div style={{ fontSize: 13, color: '#86909C' }}>
            板块 <b>{id}</b> 不在当前规则的板块范围内，或该数据文件中不存在。
            <div style={{ marginTop: 10 }}>
              <Link to="/rotation" style={{ color: '#1890FF' }}>
                ← 返回轮动档案
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const { comp, stats, series, view, nav, relNet, peers, follow, summary } = payload;
  const dates = comp.dates;
  const meta = data.meta;
  const benchName = meta.benchmark || '沪深300';

  // —— 数据状态(§6.1 第 1 项) ——
  // 口径与主页共用同一实现(见 format.describeGenTime):当日 15:05 ~ 次日 09:30 生成都算盘后数据
  const genTime = describeGenTime(meta.generatedAt, meta.lastTradeDate);
  const missingDays = dates.length - stats.validDays;

  // —— 数据一致性自检(§6.3:时间轴事件数必须 = 摘要 = 明细) ——
  const tlStrong = view.eventAt.filter((e) => e?.strong === true).length;
  const tlWeak = view.eventAt.filter((e) => e?.weak === true).length;
  const consistent = tlStrong === stats.strongCount && tlWeak === stats.weakCount && stats.strongDates.length === stats.strongCount;

  // —— 时间轴点击取数 ——
  const pickedDate = pickedIdx != null ? dates[pickedIdx] ?? null : null;
  const pickedEv = pickedIdx != null ? view.eventAt[pickedIdx] : null;
  const pickedPct = pickedIdx != null ? view.pctAt[pickedIdx] : null;
  // 当日真实排名(不管是否进 TOP N):从当日完整榜单里定位本板块,保证"事件可追溯到排名"
  const pickedRankRow = pickedIdx != null ? comp.ranking[pickedIdx]?.ranked.find((r) => r.id === series.sector.id) : undefined;
  const pickedTotal = pickedIdx != null ? comp.ranking[pickedIdx]?.total ?? null : null;
  const pickedCluster =
    pickedEv && pickedDate
      ? (pickedEv.strong ? stats.clustersStrong : stats.clustersWeak).find((c) => c.eventDates.includes(pickedDate)) ?? null
      : null;
  const pickedNav = pickedIdx != null ? nav.navSector[pickedIdx] - 1 : null;
  const pickedNavB = pickedIdx != null && nav.benchValid[pickedIdx] ? nav.navBench[pickedIdx] - 1 : null;

  // —— 净值曲线 ——
  const navS = nav.navSector.map((x) => Math.round((x - 1) * 10000) / 100);
  const navB = nav.navBench.map((x) => Math.round((x - 1) * 10000) / 100);
  const navRelVals = nav.navSector.map((x, i) => (nav.navBench[i] > 0 ? Math.round((x / nav.navBench[i] - 1) * 10000) / 100 : null));
  const showRel = navMode === 'rel' && nav.benchAvailable;

  const chartOption = {
    animation: true,
    animationDuration: 800,
    grid: { top: 34, right: 18, left: 46, bottom: 26 },
    legend: { show: true, top: 4, right: 8, textStyle: { color: '#4E5969', fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    tooltip: {
      trigger: 'axis',
      formatter: (ps: any[]) => {
        const x = ps?.[0]?.axisValue ?? '';
        return `<div style="color:#111827;font-weight:700;font-size:12px;margin-bottom:4px;">${x}</div>` +
          ps.map((p) => `<div style="font-size:12px;color:${p.color};font-weight:600;">${p.seriesName}: ${p.value ?? '—'}%</div>`).join('');
      },
    },
    xAxis: {
      type: 'category',
      data: dates.map((d) => d.slice(5)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#86909C', fontSize: 10, interval: Math.max(0, Math.floor(dates.length / 8)) },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#F0F0F0', type: 'dashed' } },
      axisLabel: { color: '#86909C', fontSize: 10, formatter: '{value}%' },
    },
    series: [
      {
        name: `${series.sector.name}（板块累计）`,
        type: 'line',
        data: navS,
        smooth: true,
        symbol: 'none',
        lineStyle: { color: COLOR_UP, width: 2.5 },
        areaStyle: { color: 'rgba(255,77,79,0.08)' },
      },
      // 基准在窗口内完全没有行情时不画基准线(不伪造基准曲线，任务书 §6.4)
      ...(nav.benchAvailable

        ? [
            {
              name: `基准 ${benchName}（基准累计）`,
              type: 'line' as const,
              data: navB,
              smooth: true,
              symbol: 'none',
              lineStyle: { color: '#86909C', width: 2, type: 'dashed' as const },
            },
            ...(showRel
              ? [
                  {
                    name: '相对净值（板块/基准−1）',
                    type: 'line' as const,
                    data: navRelVals,
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { color: COLOR_REL, width: 2 },
                  },
                ]
              : []),
          ]
        : []),
    ],
  };

  const freqWord = (n: number) => `${(n * 100).toFixed(0)}%`;
  const strongChips = showAllEvents ? stats.strongDates : stats.strongDates.slice(-12);
  const weakChips = showAllEvents ? stats.weakDates : stats.weakDates.slice(-12);
  const clusterRows = showAllClusters ? stats.clustersStrong : stats.clustersStrong.slice(-8);

  return (
    <div>
      <PageHeader
        title={`${series.sector.name} · 行为画像`}
        tradeDateSlash={dashToSlash(meta.lastTradeDate)}
        subtitle={`近 ${rule.windowDays} 个交易日 · 规则 TOP ${rule.topN} / 大涨 ${rule.riseThreshold}% / 大跌 -${rule.fallThreshold}%`}
      />

      {/* ① 板块名称 / 分类 / 数据状态 */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Link to="/rotation" style={{ fontSize: 12, color: '#1890FF' }}>
          ← 返回轮动档案
        </Link>
        {/* 观察清单入口(§10,仅本设备) */}
        <button
          onClick={() => toggleWatch({ id: series.sector.id, name: series.sector.name }, meta.lastTradeDate || '')}
          title={inWatchlist(watchList, series.sector.id) ? '从观察清单移除' : '加入观察清单（仅本设备）'}
          style={{
            border: `1px solid ${COLOR_BORDER}`,
            background: '#fff',
            color: inWatchlist(watchList, series.sector.id) ? '#FAAD14' : '#4E5969',
            borderRadius: 8,
            padding: '3px 12px',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {inWatchlist(watchList, series.sector.id) ? '★ 已在观察清单' : '☆ 加入观察'}
        </button>
        <span style={{ fontSize: 12, color: '#86909C' }}>
          板块代码 {series.sector.id} · 分类 {TYPE_LABEL[series.sector.type]}
        </span>
        <span style={{ fontSize: 12, color: '#86909C' }}>
          数据覆盖率{' '}
          <b style={{ color: stats.coverage < 1 ? '#FA8C16' : COLOR_TEXT }}>{(stats.coverage * 100).toFixed(0)}%</b>
          （{stats.validDays}/{dates.length} 个交易日，缺失 {missingDays} 天）
          {stats.coverage < 1 && <span style={{ color: '#FA8C16' }}> · 缺失日不计为 0 涨跌幅</span>}
        </span>
        <span style={{ fontSize: 12, color: '#86909C' }}>
          数据时点 {meta.lastTradeDate} {genTime.time}
          <span style={{ color: genTime.postClose ? '#86909C' : '#FA8C16' }}>（{genTime.postClose ? '盘后数据' : '非当日盘后数据'}）</span>
        </span>
      </div>

      {/* ② 当前规则摘要 */}
      <RotationRuleBar rule={rule} onChange={setRule} />

      {/* ③ 核心统计摘要(8 卡) + 「更多统计」 */}
      <div style={{ height: 14 }} />
      <Card
        title={<TitleWithTip text="核心统计摘要" items={tipItems([...CORE_LABELS, ...MORE_LABELS])} title="指标含义 / 计算公式" />}
        right={
          <span style={{ fontSize: 11, color: '#86909C' }}>
            窗口近 {dates.length} 个交易日 · 有效交易日 {stats.validDays}
          </span>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))', gap: 12 }}>
          <KV label="强势事件次数" value={`${stats.strongCount} 次`} color={COLOR_UP} sub={`频率 ${freqWord(stats.strongFreq)}（÷ 有效交易日）`} />
          <KV label="弱势事件次数" value={`${stats.weakCount} 次`} color={COLOR_DOWN} sub={`频率 ${freqWord(stats.weakFreq)}（÷ 有效交易日）`} />
          <KV label="窗口累计收益" value={`${(stats.cumReturn * 100).toFixed(2)}%`} color={pctColor(stats.cumReturn)} sub="复合收益 ∏(1+r)−1" />
          <KV
            label="相对基准超额"
            value={stats.relStrength == null ? '—' : `${stats.relStrength > 0 ? '+' : ''}${(stats.relStrength * 100).toFixed(2)}%`}
            color={stats.relStrength == null ? COLOR_FLAT : pctColor(stats.relStrength)}
            sub={`简单超额（板块−基准 ${benchName}）`}
          />
          <KV
            label="最近一次活跃事件"
            value={stats.lastActiveDate ? dashToSlash(stats.lastActiveDate) : '窗口内无'}
            color={COLOR_TEXT}
            sub={stats.lastActiveAgo == null ? '强势/弱势事件均未出现' : `${stats.lastActiveAgo} 个交易日前（强势或弱势取较近者）`}
          />
          <KV
            label="强势事件典型间隔"
            value={stats.gapStrong.avg == null ? '样本不足' : `${stats.gapStrong.avg.toFixed(1)} 日`}
            sub={
              stats.gapStrong.sampleInsufficient
                ? `⚠ 仅 ${stats.gapStrong.count} 个间隔样本`
                : `中位 ${stats.gapStrong.median?.toFixed(1)} 日 · 样本 ${stats.gapStrong.count} 个`
            }
          />
          <KV label="最大回撤" value={`${(stats.maxDrawdown * 100).toFixed(2)}%`} color={COLOR_DOWN} sub="窗口净值自峰值回落的最大幅度" />
          <KV
            label="数据有效覆盖率"
            value={`${(stats.coverage * 100).toFixed(0)}%`}
            color={stats.coverage < 1 ? '#FA8C16' : COLOR_TEXT}
            sub={`${stats.validDays} / ${dates.length} 个交易日${missingDays > 0 ? ` · 缺 ${missingDays} 天` : ''}`}
          />
        </div>

        <div style={{ marginTop: 14 }}>
          {!showMoreStats && (
            <button
              onClick={() => setShowMoreStats(true)}
              style={{ border: `1px solid ${COLOR_BORDER}`, background: '#fff', color: '#1890FF', borderRadius: 8, padding: '5px 14px', fontSize: 12, cursor: 'pointer' }}
            >
              展开更多统计（+10）
            </button>
          )}
          {showMoreStats && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))', gap: 12 }}>
              <KV label="大涨事件日" value={`${stats.largeUpCount} 次`} color={COLOR_UP} sub={`涨幅 ≥ ${rule.riseThreshold}%`} />
              <KV label="大跌事件日" value={`${stats.largeDownCount} 次`} color={COLOR_DOWN} sub={`跌幅 ≤ -${rule.fallThreshold}%`} />
              <KV label="当前连续强势" value={`${stats.currentStrongStreak} 天`} color={stats.currentStrongStreak > 0 ? COLOR_UP : COLOR_FLAT} sub={`窗口内最长 ${stats.longestStrongStreak} 天`} />
              <KV label="当前连续弱势" value={`${stats.currentWeakStreak} 天`} color={stats.currentWeakStreak > 0 ? COLOR_DOWN : COLOR_FLAT} sub={`窗口内最长 ${stats.longestWeakStreak} 天`} />
              <KV
                label="独立活跃周期"
                value={`${stats.clustersStrong.length} 个`}
                sub={`冷却期 ${rule.cooldownDays === 0 ? '不合并' : `${rule.cooldownDays} 日`} · 周期间隔 ${stats.clusterGapStrong.avg != null ? `${stats.clusterGapStrong.avg.toFixed(1)} 日` : '样本不足'}`}
              />
              <KV
                label="活跃度评分"
                value={stats.score.toFixed(1)}
                sub={`强势频率 ${(SCORE_WEIGHTS.f1 * 100).toFixed(0)}% + 近期活跃 ${(SCORE_WEIGHTS.f2 * 100).toFixed(0)}% + 独立周期 ${(SCORE_WEIGHTS.f3 * 100).toFixed(0)}% + 相对趋势 ${(SCORE_WEIGHTS.f4 * 100).toFixed(0)}%`}
              />
              <KV
                label="间隔集中度"
                value={stats.gapStrong.concentration == null ? '样本不足' : `${(stats.gapStrong.concentration * 100).toFixed(0)}%`}
                sub={`落在关注区间 ${rule.gapMin}~${rule.gapMax} 个交易日内的比例`}
              />
              <KV
                label="相对净值超额"
                value={relNet == null ? '—' : `${relNet > 0 ? '+' : ''}${(relNet * 100).toFixed(2)}%`}
                color={relNet == null ? COLOR_FLAT : pctColor(relNet)}
                sub="比率口径：板块净值 / 基准净值 − 1"
              />
              <KV label="上涨日占比" value={freqWord(stats.upDayRatio)} sub="窗口内有数据日中收涨的比例" />
              <KV label="波动率 / 日均" value={`${(stats.volatility * 100).toFixed(2)}%`} sub={`日均涨跌幅 ${stats.avgPct.toFixed(2)}%（缺失日不计入）`} />
              </div>
              {/* 「收起更多统计」放在展开后的数据卡片**下方**(而非上方),避免挡住新增内容 */}
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <button
                  onClick={() => setShowMoreStats(false)}
                  style={{ border: `1px solid ${COLOR_BORDER}`, background: '#fff', color: '#1890FF', borderRadius: 8, padding: '5px 14px', fontSize: 12, cursor: 'pointer' }}
                >
                  收起更多统计
                </button>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* ④ 历史强弱事件时间轴(可点 → 簇归属 + 曲线位置) */}
      <div style={{ height: 16 }} />
      <Card
        title={<TitleWithTip text={`强弱事件时间轴（${dates.length} 个交易日）`} items={tipItems(TIMELINE_LEGEND.map(({ c, t }) => ({ label: t, color: c })))} title="色块含义" />}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#86909C', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span>
              时间轴事件数：强势 <b style={{ color: COLOR_UP }}>{tlStrong}</b> · 弱势 <b style={{ color: COLOR_DOWN }}>{tlWeak}</b>
              {consistent ? <span style={{ color: '#86909C' }}> ✓ 与摘要一致</span> : <span style={{ color: '#FA8C16' }}> ⚠ 与摘要不一致</span>}
            </span>
            {TIMELINE_LEGEND.map((x) => (
              <span key={x.t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <i style={{ width: 11, height: 11, background: x.c, border: `1px solid ${COLOR_BORDER}`, borderRadius: 2, display: 'inline-block' }} />
                {x.t}
              </span>
            ))}
          </div>
        }
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {dates.map((d, i) => {
            const ev = view.eventAt[i];
            const p = view.pctAt[i];
            let bg = COLOR_NONE;
            let border = `1px solid ${COLOR_BORDER}`;
            if (!ev) {
              bg = COLOR_NA;
              border = '1px dashed #D5DAE2';
            } else if (ev.largeUp) bg = COLOR_LARGE_UP;
            else if (ev.largeDown) bg = COLOR_LARGE_DOWN;
            else if (ev.strong) bg = COLOR_STRONG;
            else if (ev.weak) bg = COLOR_WEAK;
            const title = !ev
              ? `${d} 无数据（不计为 0 涨跌幅，也不当作"没有事件"）`
              : `${d} ${p != null ? `${p > 0 ? '+' : ''}${p.toFixed(2)}%` : ''}${ev.strong ? ' · 强势' : ''}${ev.weak ? ' · 弱势' : ''}${
                  view.rankUpAt[i] ? ` · 涨幅榜第 ${view.rankUpAt[i]}` : ''
                }`;
            return (
              <button
                key={d}
                title={title}
                onClick={() => setPickedIdx(pickedIdx === i ? null : i)}
                style={{
                  width: 20,
                  height: 20,
                  background: bg,
                  border: pickedIdx === i ? '2px solid #1890FF' : border,
                  borderRadius: 3,
                  cursor: 'pointer',
                  padding: 0,
                  opacity: ev ? 1 : 0.5,
                }}
              />
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#86909C', marginTop: 6 }}>
          <span>{dates[0]}</span>
          <span>{dates[dates.length - 1]}</span>
        </div>
        <div style={{ fontSize: 11, color: '#86909C', marginTop: 8, lineHeight: 1.8 }}>
          点击任一格子可查看该交易日的判定依据、所属<b>独立活跃周期</b>，以及它在收益曲线上的位置。
          {!consistent && <span style={{ color: '#FA8C16' }}>（检测到时间轴与摘要事件数不一致，请反馈。）</span>}
        </div>

        {/* 时间轴点击解释 */}
        {pickedIdx != null && (
          <div style={{ marginTop: 14, borderTop: `1px solid ${COLOR_BORDER}`, paddingTop: 14 }}>
            {!pickedEv ? (
              <div style={{ fontSize: 12, color: '#86909C' }}>
                {pickedDate} · 该日无数据（不计为 0 涨跌幅，也不作为"没有事件"处理）。
              </div>
            ) : (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: COLOR_TEXT, marginBottom: 12 }}>
                  事件解释 · {series.sector.name} · {pickedDate}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                  <div style={{ background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 12, color: '#86909C', marginBottom: 6 }}>当日涨跌幅</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: (pickedPct ?? 0) >= 0 ? COLOR_UP : COLOR_DOWN }}>
                      {pickedPct != null ? `${pickedPct > 0 ? '+' : ''}${pickedPct.toFixed(2)}%` : '—'}
                    </div>
                  </div>
                  <div style={{ background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 12, color: '#86909C', marginBottom: 6 }}>当日排名</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: COLOR_TEXT, lineHeight: 1.5 }}>
                      涨幅榜第 {pickedRankRow ? pickedRankRow.rank : '—'} / 共 {pickedTotal ?? '—'}
                      <div style={{ fontSize: 12, color: '#86909C', fontWeight: 400 }}>
                        跌幅榜第 {pickedRankRow && pickedTotal ? pickedTotal - pickedRankRow.rank + 1 : '—'}
                      </div>
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
                  {/* 独立事件簇归属(§6.3 新增) */}
                  <div style={{ background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 12, color: '#86909C', marginBottom: 8 }}>所属独立活跃周期</div>
                    {pickedEv.strong || pickedEv.weak ? (
                      pickedCluster ? (
                        <div style={{ fontSize: 12, color: COLOR_TEXT, lineHeight: 1.9 }}>
                          <div>
                            第 {((pickedEv.strong ? stats.clustersStrong : stats.clustersWeak).indexOf(pickedCluster) ?? 0) + 1} 个周期
                            （共 {pickedEv.strong ? stats.clustersStrong.length : stats.clustersWeak.length} 个）
                          </div>
                          <div style={{ color: '#86909C' }}>
                            {pickedCluster.startDate} ~ {pickedCluster.endDate} · 事件日 {pickedCluster.days} 个
                          </div>
                          <div style={{ color: pctColor(pickedCluster.cumReturn) }}>簇内复合收益 {(pickedCluster.cumReturn * 100).toFixed(2)}%</div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: '#86909C' }}>未能定位所属周期</div>
                      )
                    ) : (
                      <div style={{ fontSize: 12, color: '#86909C' }}>当日未触发事件，不属于任何活跃周期</div>
                    )}
                  </div>
                  {/* 曲线位置(§6.3 新增) */}
                  <div style={{ background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 12, color: '#86909C', marginBottom: 8 }}>该日收益曲线位置</div>
                    <div style={{ fontSize: 12, color: COLOR_TEXT, lineHeight: 1.9 }}>
                      <div>
                        板块累计 <b style={{ color: pctColor(pickedNav ?? 0) }}>{pickedNav == null ? '—' : `${((pickedNav * 100)).toFixed(2)}%`}</b>
                      </div>
                      <div>
                        基准累计{' '}
                        <b style={{ color: '#86909C' }}>{pickedNavB == null ? '无数据' : `${(pickedNavB * 100).toFixed(2)}%`}</b>
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#86909C', marginTop: 12, lineHeight: 1.8 }}>
                  判定口径：组合方式为「{rule.eventLogic === 'AND' ? '同时满足' : '任一满足'}」；未启用的条件不参与计算
                  （大涨进榜条件:{rule.riseRankEnabled ? '启用' : '未启用'}，大跌进榜条件:{rule.fallRankEnabled ? '启用' : '未启用'}）。
                  名次按当日全部有效板块的涨跌幅降序（并列按板块代码升序）。
                </div>
              </>
            )}
          </div>
        )}
      </Card>

      {/* ⑤ 窗口净值与基准曲线 */}
      <div style={{ height: 16 }} />
      <Card
        title={<TitleWithTip text="窗口净值与基准曲线" items={tipItems(CURVE_LABELS)} title="图线含义 / 口径" />}
        right={
          nav.benchAvailable ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#86909C' }}>图线</span>
              <Seg
                value={navMode}
                onChange={setNavMode}
                options={[
                  { label: '板块 vs 基准', value: 'vs' as const },
                  { label: '叠加相对净值', value: 'rel' as const },
                ]}
              />
            </span>
          ) : (
            <span style={{ fontSize: 11, color: '#FA8C16' }}>基准缺失 · 仅显示板块曲线</span>
          )
        }
      >
        <ReactECharts option={chartOption} style={{ height: 300, width: '100%' }} notMerge lazyUpdate />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginTop: 12 }}>
          <div style={{ fontSize: 11, color: '#86909C', lineHeight: 1.9, background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 8, padding: '10px 12px' }}>
            <b style={{ color: COLOR_TEXT }}>窗口起止</b>：{dates[0]} ~ {dates[dates.length - 1]}（{dates.length} 个交易日）
          </div>
          <div style={{ fontSize: 11, color: '#86909C', lineHeight: 1.9, background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 8, padding: '10px 12px' }}>
            <b style={{ color: COLOR_TEXT }}>收益口径</b>：复合收益 ∏(1+r)−1，以窗口首日为基点（0%）；缺失日<b>沿用前值</b>（等价于跳过，不当作 0 收益）
          </div>
          <div style={{ fontSize: 11, color: '#86909C', lineHeight: 1.9, background: '#F7F9FC', border: `1px solid ${COLOR_BORDER}`, borderRadius: 8, padding: '10px 12px' }}>
            <b style={{ color: COLOR_TEXT }}>基准</b>：{benchName}；<b style={{ color: COLOR_TEXT }}>相对净值</b>=板块净值/基准净值−1（比率口径，与摘要的「简单超额」是两种口径）
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#86909C', marginTop: 10, lineHeight: 1.8 }}>
          板块指数收益用于行情研究，<b>不等于投资者实际可实现的收益</b>（不可直接交易板块指数，且未考虑手续费与冲击成本）。
          {!nav.benchAvailable && ' 本窗口基准无可用行情，故不显示基准曲线与相对净值（不伪造）。'}
        </div>
      </Card>

      {/* ⑥ 行为特征分析(五段式) */}
      <div style={{ height: 16 }} />
      <Card
        title={<TitleWithTip text="行为特征分析" items={tipItems(SUMMARY_LABELS)} title="五段式结构说明" />}
        right={<span style={{ fontSize: 11, color: '#86909C' }}>数据解释器 · 非预测</span>}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
          <SummaryBlock tag="A" title="历史行为" lines={summary.history} color="#1890FF" />
          <SummaryBlock tag="B" title="活跃模式" lines={summary.activity} color="#FA8C16" />
          <SummaryBlock tag="C" title="收益与风险" lines={summary.returnRisk} color="#ff4d4f" />
          <SummaryBlock tag="D" title="统计局限" lines={summary.limits} color="#86909C" />
        </div>
        <div style={{ marginTop: 12 }}>
          <SummaryBlock tag="E" title="后续观察" lines={summary.nextSteps} color="#722ED1" />
        </div>
        <div style={{ fontSize: 11, color: '#86909C', marginTop: 12, lineHeight: 1.8 }}>
          以上文字由规则引擎按已计算字段自动生成，可复现、可审计；不构成买卖建议，也不代表未来概率。
        </div>
      </Card>

      {/* ⑦ 事件明细(原始事件日 vs 独立簇分列;支持查看全部) */}
      <div style={{ height: 16 }} />
      <Card
        title={<TitleWithTip text="事件明细" items={tipItems(DETAIL_LABELS)} title="字段含义 / 计算公式" />}
        right={
          <button
            onClick={() => setShowAllEvents((v) => !v)}
            style={{ border: `1px solid ${COLOR_BORDER}`, background: '#fff', color: '#1890FF', borderRadius: 8, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            {showAllEvents ? '收起（最近 12 条）' : `查看全部事件日（共 ${stats.strongDates.length + stats.weakDates.length} 条）`}
          </button>
        }
      >
        <div style={{ fontSize: 11, color: '#86909C', marginBottom: 12, lineHeight: 1.8 }}>
          两类明细严格区分：<b>原始事件日</b>（逐日判定结果）与<b>独立活跃周期</b>（按冷却期把相邻事件日合并后的周期）。
          事件日总数与上方摘要、时间轴一致：强势 {stats.strongCount} · 弱势 {stats.weakCount}。
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLOR_UP, marginBottom: 8 }}>
              强势事件日（{stats.strongDates.length}）{!showAllEvents && stats.strongDates.length > 12 && <span style={{ fontSize: 11, color: '#86909C', fontWeight: 400 }}> · 显示最近 12 条</span>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {strongChips.map((d) => (
                <span key={d} title={d} style={{ fontSize: 11, color: COLOR_UP, background: 'rgba(255,77,79,0.08)', borderRadius: 5, padding: '3px 8px' }}>
                  {d}
                </span>
              ))}
              {!stats.strongDates.length && <span style={{ fontSize: 12, color: '#86909C' }}>窗口内无强势事件</span>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLOR_DOWN, marginBottom: 8 }}>
              弱势事件日（{stats.weakDates.length}）{!showAllEvents && stats.weakDates.length > 12 && <span style={{ fontSize: 11, color: '#86909C', fontWeight: 400 }}> · 显示最近 12 条</span>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {weakChips.map((d) => (
                <span key={d} title={d} style={{ fontSize: 11, color: COLOR_DOWN, background: 'rgba(14,205,112,0.10)', borderRadius: 5, padding: '3px 8px' }}>
                  {d}
                </span>
              ))}
              {!stats.weakDates.length && <span style={{ fontSize: 12, color: '#86909C' }}>窗口内无弱势事件</span>}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT }}>独立活跃周期（{stats.clustersStrong.length} 个）</span>
            {stats.clustersStrong.length > 8 && (
              <button
                onClick={() => setShowAllClusters((v) => !v)}
                style={{ border: `1px solid ${COLOR_BORDER}`, background: '#fff', color: '#1890FF', borderRadius: 8, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}
              >
                {showAllClusters ? '收起（最近 8 个）' : '查看全部'}
              </button>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 620 }}>
              <thead>
                <tr style={{ background: '#F7F9FC', color: '#86909C' }}>
                  {['起始日', '结束日', '事件日数', '簇内最大涨幅', '簇内累计收益', '事件日'].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '8px 10px',
                        // 事件日数 / 簇内最大涨幅 / 簇内累计收益 三列(数值型)居中,其余左对齐
                        textAlign: ['事件日数', '簇内最大涨幅', '簇内累计收益'].includes(h) ? 'center' : 'left',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clusterRows.map((c, i) => (
                  <tr key={`${c.startDate}-${i}`} style={{ borderBottom: `1px solid ${COLOR_BORDER}` }}>
                    <td style={{ padding: '8px 10px' }}>{c.startDate}</td>
                    <td style={{ padding: '8px 10px' }}>{c.endDate}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>{c.days}</td>
                    <td style={{ padding: '8px 10px', color: COLOR_UP, textAlign: 'center' }}>{c.maxPct >= 0 ? '+' : ''}{c.maxPct.toFixed(2)}%</td>
                    <td style={{ padding: '8px 10px', color: pctColor(c.cumReturn), textAlign: 'center' }}>{(c.cumReturn * 100).toFixed(2)}%</td>
                    <td style={{ padding: '8px 10px', color: '#86909C' }}>{c.eventDates.join(', ')}</td>
                  </tr>
                ))}
                {!stats.clustersStrong.length && (
                  <tr>
                    <td colSpan={6} style={{ padding: '10px', color: '#86909C' }}>
                      窗口内无强势事件，无法形成活跃周期
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {/* ⑧ 高级统计与关联分析 */}
      <div style={{ height: 16 }} />
      <Card
        title={<TitleWithTip text="高级统计与关联分析" items={tipItems(REL_LABELS)} title="核心指标含义" />}
        right={<span style={{ fontSize: 11, color: '#86909C' }}>该板块参与的历史统计关联 · 非因果</span>}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: COLOR_TEXT, marginBottom: 8 }}>
          同步活跃伙伴（与本板块同日走强的板块，按 Jaccard 重合率排序）
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 680 }}>
            <thead>
              <tr style={{ background: '#F7F9FC', color: '#86909C' }}>
                {['伙伴板块', '共同活跃天数', '各自活跃天数', '重合率(Jaccard)', 'Lift'].map((h, i) => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: i === 0 ? 'left' : 'center', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {peers.map((p) => (
                <tr key={p.peer.id} style={{ borderBottom: `1px solid ${COLOR_BORDER}` }}>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                    <Link to={`/rotation/sector/${p.peer.id}`} style={{ color: COLOR_TEXT, textDecoration: 'none', borderBottom: '1px dashed #D5DAE2' }}>
                      {p.peer.name}
                    </Link>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', color: COLOR_UP, fontWeight: 600 }}>{p.coDays}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', color: '#86909C' }}>
                    {p.targetDays} / {p.peerDays}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>{(p.jaccard * 100).toFixed(1)}%</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, color: p.lift >= 1.5 ? COLOR_UP : p.lift >= 1.2 ? '#FA8C16' : COLOR_FLAT }}>
                    {p.lift.toFixed(2)}
                  </td>
                </tr>
              ))}
              {!peers.length && (
                <tr>
                  <td colSpan={5} style={{ padding: '12px 10px', color: '#86909C' }}>
                    {stats.strongCount === 0
                      ? '本板块窗口内无强势事件，无法计算同步活跃关系。'
                      : '窗口内暂无可展示的同步活跃伙伴（共同活跃天数均不足）。'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: COLOR_TEXT, margin: '18px 0 8px' }}>
          本板块走强后，其它板块也走强的概率最高者（t+1 ~ t+5，命中 ≥ 3 才纳入）
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 560 }}>
            <thead>
              <tr style={{ background: '#F7F9FC', color: '#86909C' }}>
                {['跟随板块', '最佳滞后', '条件频率', '基准频率', '命中样本'].map((h, i) => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: i === 0 ? 'left' : 'center', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {follow.map((r) => (
                <tr key={r.sector.id} style={{ borderBottom: `1px solid ${COLOR_BORDER}` }}>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                    <Link to={`/rotation/sector/${r.sector.id}`} style={{ color: COLOR_TEXT, textDecoration: 'none', borderBottom: '1px dashed #D5DAE2' }}>
                      {r.sector.name}
                    </Link>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', color: r.best && r.best.lift >= 1.2 ? COLOR_UP : '#86909C', fontWeight: 600 }}>
                    t+{r.best!.k}（lift {r.best!.lift.toFixed(2)}）
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>{(r.best!.condFreq * 100).toFixed(1)}%</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', color: '#86909C' }}>{(r.baseFreq * 100).toFixed(1)}%</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', color: '#86909C' }}>{r.samples}</td>
                </tr>
              ))}
              {!follow.length && (
                <tr>
                  <td colSpan={5} style={{ padding: '12px 10px', color: '#86909C' }}>
                    {stats.strongCount < 3
                      ? `本板块强势事件仅 ${stats.strongCount} 次（< 3），样本不足，不给出先行/跟随结论。`
                      : '窗口内暂无满足样本门槛的跟随板块。'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: '#86909C', marginTop: 14, lineHeight: 1.8 }}>
          说明：以上均为<b>历史统计关联</b>，不代表因果，也不代表未来必然重现；样本不足处已标注（走强后跟随板块命中 &lt; 3 视为样本不足，不纳入）。
          统计窗口：近 {rule.windowDays} 个交易日，事件口径遵循当前规则，缺失日不计入分母。
        </div>
      </Card>

      {/* 计算口径(本页通用) */}
      <div style={{ height: 16 }} />
      <Card title="计算口径（本页所有指标通用）">
        <div style={{ fontSize: 12, color: '#4E5969', lineHeight: 2 }}>
          <div>· 统计窗口:最近 <b>{rule.windowDays}</b> 个交易日（该板块有效日 {stats.validDays} 天，缺失日不计为 0 涨跌幅、不进任何分母）</div>
          <div>· 强势事件 = {rule.riseRankEnabled ? `进入涨幅 TOP ${rule.topN}` : ''}{rule.riseRankEnabled && rule.riseThreshold ? ` ${rule.eventLogic === 'AND' ? '且' : '或'} ` : ''}涨幅 ≥ {rule.riseThreshold}%</div>
          <div>· 弱势事件 = {rule.fallRankEnabled ? `进入跌幅 TOP ${rule.topN}` : ''}{rule.fallRankEnabled && rule.fallThreshold ? ` ${rule.eventLogic === 'AND' ? '且' : '或'} ` : ''}跌幅 ≤ -{rule.fallThreshold}%</div>
          <div>· 间隔 = 交易日序号差（相邻事件日相差 1 表示间隔 1 个交易日步长）；空档交易日数 = 间隔 − 1</div>
          <div>· 独立活跃周期 = 以冷却期 {rule.cooldownDays} 个交易日合并相邻事件日；周期间隔按<b>周期起始日</b>相减</div>
          <div>· 累计收益为复合收益 ∏(1+r)−1（不可简单相加）；最大回撤 = 窗口净值自峰值回落的最大幅度，与曲线<b>同源</b></div>
          <div>· 相对基准有两种口径：「简单超额」= 板块累计 − 基准累计（窗口内共同有效日）；「相对净值」= 板块净值/基准净值 − 1。本页分别标注，不混用</div>
          <div>· 排名并列时按板块代码升序（稳定排序，结果可复现）；间隔样本少于 4 个时标注"样本不足"，不计算集中度</div>
        </div>
      </Card>
    </div>
  );
}
