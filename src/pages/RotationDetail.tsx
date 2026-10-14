// 【板块轮动】第三层视图:板块行为详情
// 回答"这个板块究竟是什么行为模式":次数/间隔/连续性/独立周期 + 事件时间轴 + 净值曲线 + 自动生成描述
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { Card, PageHeader } from './Overview';
import { TitleWithTip, tipItems } from '../components/InfoTip';
import { RotationRuleBar, pctColor } from '../components/RotationRulePanel';
import { useRotationData, useRotationRule } from '../data/rotationData';
import { COLOR_BORDER, COLOR_DOWN, COLOR_FLAT, COLOR_TEXT, COLOR_UP } from '../utils/format';
import { useEchartsResize } from '../hooks/useEchartsResize';
import { analyzeSector, buildNavSeries, describeSector } from '../utils/rotation/analytics';
import { computeWindow, toWindowView } from '../utils/rotation/ruleEngine';

const COLOR_STRONG = COLOR_UP;
const COLOR_WEAK = COLOR_DOWN;
const COLOR_LARGE_UP = '#d9363e';
const COLOR_LARGE_DOWN = '#089b55';
const COLOR_NONE = '#F0F1F2';

// v2.0.8ku:各卡片的"感叹号"气泡字段清单 —— 与卡片内实际出现的字段/图例一一对应
const STATS_LABELS = [
  '有效交易日', '强势榜出现次数', '弱势榜出现次数', '大涨事件日', '大跌事件日',
  '强势事件平均间隔', '最近一次强势事件', '当前连续强势', '当前连续弱势', '独立活跃周期',
  '窗口累计收益', '相对基准超额', '最大回撤', '活跃度评分', '间隔集中度',
];
const TIMELINE_LEGEND = ['大涨', '进强势榜', '大跌', '进弱势榜', '未进榜'];
const NAV_LABELS = ['累计净值曲线', '基准'];
const DETAIL_LABELS = [
  '强势事件日期', '弱势事件日期', '起始日', '结束日', '事件日数', '簇内最大涨幅', '簇内累计收益', '事件日',
];

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

export default function RotationDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading } = useRotationData();
  const [rule, setRule] = useRotationRule();
  useEchartsResize();

  const payload = useMemo(() => {
    if (!data || !id) return null;
    const comp = computeWindow(data, rule);
    const series = comp.series.find((s) => s.sector.id === id);
    if (!series) return null;
    const stats = analyzeSector(series, data, rule, comp);
    return { comp, series, stats, desc: describeSector(stats, rule) };
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

  const { comp, series, stats, desc } = payload;
  const dates = comp.dates;

  // v2.0.9:窗口对齐视图 —— series.events/pctInWindow/rankUpOn 是按"该板块有数据的日"压缩对齐的，
  // 长度并不等于窗口交易日数(覆盖率<100% 时两者不等)。任何按窗口下标取值都必须走 view。
  const view = toWindowView(comp, series);

  // v2.0.9:净值序列改由 analytics 单一实现（与统计摘要的累计收益/最大回撤同源，不再当 0 收益累乘）
  const nav = buildNavSeries(data, comp, series);
  const navS = nav.navSector.map((x) => Math.round((x - 1) * 10000) / 100);
  const navB = nav.navBench.map((x) => Math.round((x - 1) * 10000) / 100);

  const freqWord = (n: number) => `${(n * 100).toFixed(0)}%`;
  const gapText = (g: typeof stats.gapStrong) =>
    g.avg == null ? '样本不足' : `${g.avg.toFixed(1)} 日（中位 ${g.median?.toFixed(1) ?? '-'} 日）`;

  const chartOption = {
    animation: true,
    animationDuration: 800,
    grid: { top: 34, right: 18, left: 46, bottom: 26 },
    legend: { show: true, top: 4, right: 8, textStyle: { color: '#4E5969', fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    tooltip: { trigger: 'axis', formatter: (ps: any[]) => {
      const x = ps?.[0]?.axisValue ?? '';
      return `<div style="color:#111827;font-weight:700;font-size:12px;margin-bottom:4px;">${x}</div>` +
        ps.map((p) => `<div style="font-size:12px;color:${p.color};font-weight:600;">${p.seriesName}: ${p.value}%</div>`).join('');
    } },
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
        name: series.sector.name,
        type: 'line',
        data: navS,
        smooth: true,
        symbol: 'none',
        lineStyle: { color: COLOR_UP, width: 2.5 },
        areaStyle: { color: 'rgba(255,77,79,0.08)' },
      },
      // v2.0.9:基准在窗口内完全没有行情时不画基准线(不伪造基准曲线，任务书 §6.4)
      ...(nav.benchAvailable
        ? [{
            name: `基准 ${data.meta.benchmark || '沪深300'}`,
            type: 'line' as const,
            data: navB,
            smooth: true,
            symbol: 'none',
            lineStyle: { color: '#86909C', width: 2, type: 'dashed' as const },
          }]
        : []),
    ],
  };

  return (
    <div>
      <PageHeader
        title={`${series.sector.name} · 行为画像`}
        tradeDateSlash={dashToSlash(data.meta.lastTradeDate)}
        subtitle={`近 ${rule.windowDays} 个交易日 · 规则 TOP ${rule.topN} / 大涨 ${rule.riseThreshold}% / 大跌 -${rule.fallThreshold}%`}
      />
      <div style={{ marginBottom: 12 }}>
        <Link to="/rotation" style={{ fontSize: 12, color: '#1890FF' }}>
          ← 返回轮动档案
        </Link>
        <span style={{ fontSize: 12, color: '#86909C', marginLeft: 12 }}>
          板块代码 {series.sector.id} · 数据覆盖率 {(stats.coverage * 100).toFixed(0)}%
          {stats.coverage < 1 && <span style={{ color: '#FA8C16' }}>（存在缺失日，缺失日不计为 0 涨跌幅）</span>}
        </span>
      </div>
      <RotationRuleBar rule={rule} onChange={setRule} />

      {/* 关键指标 */}
      <Card
        title={<TitleWithTip text="统计摘要" items={tipItems(STATS_LABELS)} title="指标含义 / 计算公式" />}
        right={<span style={{ fontSize: 11, color: '#86909C' }}>有效交易日 {stats.validDays} / {dates.length}</span>}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))', gap: 12 }}>
          <KV label="强势榜出现次数" value={`${stats.strongCount} 次`} color={COLOR_UP} sub={`频率 ${freqWord(stats.strongFreq)}`} />
          <KV label="弱势榜出现次数" value={`${stats.weakCount} 次`} color={COLOR_DOWN} sub={`频率 ${freqWord(stats.weakFreq)}`} />
          <KV label="大涨事件日" value={`${stats.largeUpCount} 次`} color={COLOR_UP} sub={`涨幅 ≥ ${rule.riseThreshold}%`} />
          <KV label="大跌事件日" value={`${stats.largeDownCount} 次`} color={COLOR_DOWN} sub={`跌幅 ≤ -${rule.fallThreshold}%`} />
          <KV label="强势事件平均间隔" value={gapText(stats.gapStrong)} sub={stats.gapStrong.sampleInsufficient ? '⚠ 样本不足' : `间隔样本 ${stats.gapStrong.count} 个`} />
          <KV
            label="最近一次强势事件"
            value={stats.lastStrongAgo == null ? '窗口内无' : `${stats.lastStrongAgo} 个交易日前`}
            sub={stats.strongDates.length ? `最近日期 ${stats.strongDates[stats.strongDates.length - 1]}` : ''}
          />
          <KV label="当前连续强势" value={`${stats.currentStrongStreak} 天`} color={stats.currentStrongStreak > 0 ? COLOR_UP : COLOR_FLAT} sub={`窗口内最长 ${stats.longestStrongStreak} 天`} />
          <KV label="当前连续弱势" value={`${stats.currentWeakStreak} 天`} color={stats.currentWeakStreak > 0 ? COLOR_DOWN : COLOR_FLAT} sub={`窗口内最长 ${stats.longestWeakStreak} 天`} />
          <KV label="独立活跃周期" value={`${stats.clustersStrong.length} 个`} sub={`冷却期 ${rule.cooldownDays === 0 ? '不合并' : `${rule.cooldownDays} 日`} · 周期间隔 ${stats.clusterGapStrong.avg != null ? `${stats.clusterGapStrong.avg.toFixed(1)} 日` : '样本不足'}`} />
          <KV label="窗口累计收益" value={`${(stats.cumReturn * 100).toFixed(2)}%`} color={pctColor(stats.cumReturn)} sub="复合收益 ∏(1+r)−1" />
          <KV label="相对基准超额" value={stats.relStrength == null ? '—' : `${(stats.relStrength * 100).toFixed(2)}%`} color={stats.relStrength == null ? COLOR_FLAT : pctColor(stats.relStrength)} sub={`基准 ${data.meta.benchmark || '沪深300'}`} />
          <KV label="最大回撤" value={`${(stats.maxDrawdown * 100).toFixed(2)}%`} color={COLOR_DOWN} sub={`上涨日占比 ${(stats.upDayRatio * 100).toFixed(0)}% · 波动率 ${(stats.volatility * 100).toFixed(2)}%`} />
          <KV label="活跃度评分" value={stats.score.toFixed(1)} sub="频率35% + 近期25% + 独立周期20% + 相对趋势20%" />
          <KV label="间隔集中度" value={stats.gapStrong.concentration == null ? '样本不足' : `${(stats.gapStrong.concentration * 100).toFixed(0)}%`} sub={`落在 ${rule.gapMin}~${rule.gapMax} 个交易日内的比例`} />
        </div>
      </Card>

      {/* 事件时间轴 */}
      <div style={{ height: 16 }} />
      <Card
        title={<TitleWithTip text={`${dates.length} 个交易日的强弱事件时间轴`} items={tipItems(TIMELINE_LEGEND)} title="色块含义" />}
        right={
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#86909C' }}>
            {[
              { c: COLOR_LARGE_UP, t: '大涨' },
              { c: COLOR_STRONG, t: '进强势榜' },
              { c: COLOR_LARGE_DOWN, t: '大跌' },
              { c: COLOR_WEAK, t: '进弱势榜' },
              { c: COLOR_NONE, t: '未进榜' },
            ].map((x) => (
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
            if (!ev) bg = '#FAFAFA';
            else if (ev.largeUp) bg = COLOR_LARGE_UP;
            else if (ev.largeDown) bg = COLOR_LARGE_DOWN;
            else if (ev.strong) bg = COLOR_STRONG;
            else if (ev.weak) bg = COLOR_WEAK;
            const title = !ev
              ? `${d} 无数据`
              : `${d} ${p != null ? `${p > 0 ? '+' : ''}${p.toFixed(2)}%` : ''}${ev.strong ? ' · 强势' : ''}${ev.weak ? ' · 弱势' : ''}${
                  view.rankUpAt[i] ? ` · 涨幅榜第 ${view.rankUpAt[i]}` : ''
                }`;
            return (
              <div
                key={d}
                title={title}
                style={{ width: 20, height: 20, background: bg, border: `1px solid ${COLOR_BORDER}`, borderRadius: 3, opacity: ev ? 1 : 0.35 }}
              />
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#86909C', marginTop: 6 }}>
          <span>{dates[0]}</span>
          <span>{dates[dates.length - 1]}</span>
        </div>
      </Card>

      {/* 净值曲线 */}
      <div style={{ height: 16 }} />
      <Card title={<TitleWithTip text="窗口净值曲线（板块 vs 基准，复合累计）" items={tipItems(NAV_LABELS)} title="图线含义" />}>
        <ReactECharts option={chartOption} style={{ height: 300, width: '100%' }} notMerge lazyUpdate />
        <div style={{ fontSize: 11, color: '#86909C', marginTop: 8, lineHeight: 1.8 }}>
          板块指数收益用于行情研究，<b>不等于投资者实际可实现的收益</b>（不可直接交易板块指数，且未考虑手续费与冲击成本）。
        </div>
      </Card>

      {/* v2.0.8kt:两块卡片并排一行两列(窄屏自动堆叠);grid 默认 align-items:stretch → 两卡高度始终一致 */}
      <div style={{ height: 16 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'stretch' }}>
        <Card title="板块AI总结" right={<span style={{ fontSize: 11, color: '#86909C' }}>按统计口径自动生成 · 非预测</span>}>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#4E5969', lineHeight: 2.1 }}>
            {desc.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          <div style={{ fontSize: 11, color: '#86909C', marginTop: 12, lineHeight: 1.8 }}>
            以上文字由规则引擎按已计算字段自动生成，可复现、可审计；不构成买卖建议，也不代表未来概率。
          </div>
        </Card>

        <Card title="计算口径">
          <div style={{ fontSize: 12, color: '#4E5969', lineHeight: 2 }}>
            <div>· 统计窗口:最近 <b>{rule.windowDays}</b> 个交易日（有效日 {stats.validDays} 天，缺失日不计为 0 涨跌幅）</div>
            <div>· 强势事件 = {rule.riseRankEnabled ? `进入涨幅 TOP ${rule.topN}` : ''}{rule.riseRankEnabled && rule.riseThreshold ? ` ${rule.eventLogic === 'AND' ? '且' : '或'} ` : ''}涨幅 ≥ {rule.riseThreshold}%</div>
            <div>· 弱势事件 = {rule.fallRankEnabled ? `进入跌幅 TOP ${rule.topN}` : ''}{rule.fallRankEnabled && rule.fallThreshold ? ` ${rule.eventLogic === 'AND' ? '且' : '或'} ` : ''}跌幅 ≤ -{rule.fallThreshold}%</div>
            <div>· 间隔 = 交易日序号差（相邻事件日相差 1 表示间隔 1 个交易日步长）</div>
            <div>· 独立活跃周期 = 以冷却期 {rule.cooldownDays} 个交易日合并相邻事件日；周期间隔按<b>周期起始日</b>相减</div>
            <div>· 排名并列时按板块代码升序（稳定排序，结果可复现）</div>
            <div>· 间隔样本少于 4 个时标注"样本不足"，不计算集中度</div>
          </div>
        </Card>
      </div>

      {/* 强弱事件明细 */}
      <div style={{ height: 16 }} />
      <Card
        title={<TitleWithTip text="事件明细" items={tipItems(DETAIL_LABELS)} title="字段含义 / 计算公式" />}
        right={<span style={{ fontSize: 11, color: '#86909C' }}>最近 12 条</span>}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLOR_UP, marginBottom: 8 }}>强势事件日期（{stats.strongDates.length}）</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {stats.strongDates.slice(-12).map((d) => (
                <span key={d} style={{ fontSize: 11, color: COLOR_UP, background: 'rgba(255,77,79,0.08)', borderRadius: 5, padding: '3px 8px' }}>
                  {d}
                </span>
              ))}
              {!stats.strongDates.length && <span style={{ fontSize: 12, color: '#86909C' }}>窗口内无强势事件</span>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLOR_DOWN, marginBottom: 8 }}>弱势事件日期（{stats.weakDates.length}）</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {stats.weakDates.slice(-12).map((d) => (
                <span key={d} style={{ fontSize: 11, color: COLOR_DOWN, background: 'rgba(14,205,112,0.10)', borderRadius: 5, padding: '3px 8px' }}>
                  {d}
                </span>
              ))}
              {!stats.weakDates.length && <span style={{ fontSize: 12, color: '#86909C' }}>窗口内无弱势事件</span>}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT, marginBottom: 8 }}>独立活跃周期（{stats.clustersStrong.length} 个）</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 620 }}>
              <thead>
                <tr style={{ background: '#F7F9FC', color: '#86909C' }}>
                  {['起始日', '结束日', '事件日数', '簇内最大涨幅', '簇内累计收益', '事件日'].map((h) => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.clustersStrong.slice(-8).map((c, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${COLOR_BORDER}` }}>
                    <td style={{ padding: '8px 10px' }}>{c.startDate}</td>
                    <td style={{ padding: '8px 10px' }}>{c.endDate}</td>
                    <td style={{ padding: '8px 10px' }}>{c.days}</td>
                    <td style={{ padding: '8px 10px', color: COLOR_UP }}>+{c.maxPct.toFixed(2)}%</td>
                    <td style={{ padding: '8px 10px', color: pctColor(c.cumReturn) }}>{(c.cumReturn * 100).toFixed(2)}%</td>
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
    </div>
  );
}