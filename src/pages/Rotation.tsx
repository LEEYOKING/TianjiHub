// 【板块轮动】第一层:轮动档案(总览)
// 结构对应产品三层叙事:
//   第一层 每日强弱榜单档案(基础层) — 最新交易日最强/最弱
//   第二层 板块行为画像(核心层)     — 反复活跃 / 活跃间隔 / 涨跌交替 / 趋势持续性 + 反复活跃榜
//   第三层 板块轮动关系(进阶层)     — V1.2/V2 预留
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, PageHeader } from './Overview';
import { RotationRuleBar } from '../components/RotationRulePanel';
import { useRotationData, useRotationRule } from '../data/rotationData';
import { COLOR_BORDER, COLOR_DOWN, COLOR_FLAT, COLOR_TEXT, COLOR_UP } from '../utils/format';
import { analyzeAll } from '../utils/rotation/analytics';
import { computeWindow } from '../utils/rotation/ruleEngine';
import type { SectorStats } from '../utils/rotation/analytics';
import type { SectorType } from '../utils/rotation/types';

const TYPE_LABEL: Record<SectorType, string> = { industry: '行业', concept: '概念', region: '地域' };

function dashToSlash(d?: string): string {
  if (!d || d.length < 10) return '';
  return `${d.slice(2, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}`;
}

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#86909C', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || COLOR_TEXT, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#86909C', marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function MiniTable({ rows, mode }: { rows: { id: string; name: string; pct: number; rank: number; type: SectorType }[]; mode: 'up' | 'down' }) {
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

export default function Rotation() {
  const { data, error, loading } = useRotationData();
  const [rule, setRule] = useRotationRule();
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState<'all' | SectorType>('all');
  const [kw, setKw] = useState('');
  const [sortKey, setSortKey] = useState<'score' | 'strong' | 'gap' | 'ret'>('score');

  const computed = useMemo(() => {
    if (!data || !data.dates.length) return null;
    const comp = computeWindow(data, rule);
    const stats = analyzeAll(data, rule, comp);
    return { comp, stats };
  }, [data, rule]);

  const tableRows = useMemo(() => {
    if (!computed) return [] as (SectorStats & { type: SectorType })[];
    let rows = computed.stats.map((s) => ({ ...s, type: s.sector.type }));
    if (typeFilter !== 'all') rows = rows.filter((r) => r.type === typeFilter);
    if (kw.trim()) rows = rows.filter((r) => r.sector.name.includes(kw.trim()));
    const cmp = {
      score: (a: SectorStats, b: SectorStats) => b.score - a.score,
      strong: (a: SectorStats, b: SectorStats) => b.strongCount - a.strongCount,
      gap: (a: SectorStats, b: SectorStats) => (a.gapStrong.avg ?? 999) - (b.gapStrong.avg ?? 999),
      ret: (a: SectorStats, b: SectorStats) => b.cumReturn - a.cumReturn,
    }[sortKey];
    return rows.sort(cmp).slice(0, 60);
  }, [computed, typeFilter, kw, sortKey]);

  // 榜单行需要板块类型标签 → 用 id 反查(排名结果只含 id/name/pct/rank)
  const typeById = useMemo(() => {
    const mp = new Map<string, SectorType>();
    (data?.sectors || []).forEach((s) => mp.set(s.id, s.type));
    return mp;
  }, [data]);

  const latest = computed ? computed.comp.ranking[computed.comp.ranking.length - 1] : null;
  const strongTop = latest
    ? latest.ranked.slice(0, rule.topN).map((r) => ({ ...r, type: typeById.get(r.id) || ('industry' as SectorType) }))
    : [];
  const weakTop = latest
    ? [...latest.ranked]
        .reverse()
        .slice(0, rule.topN)
        .map((r) => ({ ...r, type: typeById.get(r.id) || ('industry' as SectorType) }))
    : [];

  // 第二层:4 个画像入口的高亮
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

  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center', color: '#86909C', fontSize: 13 }}>板块轮动数据加载中…</div>;
  }
  if (error || !data || !computed) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: '#86909C', fontSize: 13 }}>
        板块轮动数据暂不可用{error ? `（${error}）` : ''}
      </div>
    );
  }

  const m = data.meta;

  return (
    <div>
      <PageHeader
        title="板块轮动"
        tradeDateSlash={dashToSlash(m.lastTradeDate)}
        subtitle="板块行为档案 · 可配置规则 · 全窗口可复算"
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

      {/* 第一层 */}
      <Card
        title="第一层 · 每日强弱榜单档案"
        right={<span style={{ fontSize: 11, color: '#86909C' }}>基础层 · {latest?.date || '-'} · 当日有效板块 {latest?.total ?? 0} 个</span>}
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
          榜单按当日涨跌幅降序、并列时按板块代码升序（稳定排序，同样数据每次结果一致）。点击任一板块进入行为画像。
        </div>
      </Card>

      {/* 第二层 */}
      <div style={{ height: 16 }} />
      <Card
        title="第二层 · 板块行为画像"
        right={<span style={{ fontSize: 11, color: '#86909C' }}>核心层 · 近 {rule.windowDays} 个交易日</span>}
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
              t: '涨跌交替模式',
              v: profile ? `${profile.bothSides} 个` : '-',
              c: COLOR_TEXT,
              s: profile ? `占 ${((profile.bothSides / profile.total) * 100).toFixed(0)}% — 既进过强势榜也进过弱势榜` : '',
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

        {/* 反复活跃榜 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT }}>板块行为统计表</span>
          <div style={{ display: 'inline-flex', background: '#F5F6F8', borderRadius: 6, padding: 2, gap: 2 }}>
            {([
              ['all', '全部'],
              ['industry', '行业'],
              ['concept', '概念'],
              ['region', '地域'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTypeFilter(k)}
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
            {([
              ['score', '按活跃度'],
              ['strong', '按强势次数'],
              ['gap', '按平均间隔'],
              ['ret', '按累计收益'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                style={{
                  border: 'none',
                  background: sortKey === k ? '#fff' : 'transparent',
                  color: sortKey === k ? COLOR_TEXT : '#86909C',
                  fontWeight: sortKey === k ? 600 : 400,
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
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="搜索板块名…"
            style={{
              border: `1px solid ${COLOR_BORDER}`,
              borderRadius: 8,
              padding: '5px 10px',
              fontSize: 12,
              outline: 'none',
              width: 140,
            }}
          />
          <span style={{ fontSize: 11, color: '#86909C' }}>共 {computed.stats.length} 个板块，展示前 {tableRows.length} 个</span>
        </div>

        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 940 }}>
            <thead>
              <tr style={{ background: '#F7F9FC', color: '#86909C' }}>
                {['板块', '类型', '强势次数', '弱势次数', '强势频率', '平均间隔', '独立周期', '独立间隔', '累计收益', '最大回撤', '活跃度', '覆盖率'].map((h) => (
                  <th key={h} style={{ padding: '9px 10px', textAlign: h === '板块' || h === '类型' ? 'left' : 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr
                  key={r.sector.id}
                  onClick={() => navigate(`/rotation/sector/${r.sector.id}`)}
                  style={{ borderBottom: `1px solid ${COLOR_BORDER}`, cursor: 'pointer' }}
                >
                  <td style={{ padding: '9px 10px', color: COLOR_TEXT, fontWeight: 500, whiteSpace: 'nowrap' }}>{r.sector.name}</td>
                  <td style={{ padding: '9px 10px', color: '#86909C' }}>{TYPE_LABEL[r.type]}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', color: COLOR_UP, fontWeight: 600 }}>{r.strongCount}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', color: COLOR_DOWN, fontWeight: 600 }}>{r.weakCount}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right' }}>{(r.strongFreq * 100).toFixed(0)}%</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                    {r.gapStrong.avg != null ? `${r.gapStrong.avg.toFixed(1)} 日` : '—'}
                    {r.gapStrong.sampleInsufficient && <span style={{ color: COLOR_FLAT, fontSize: 10 }}> 样本少</span>}
                  </td>
                  <td style={{ padding: '9px 10px', textAlign: 'right' }}>{r.clustersStrong.length}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right' }}>{r.clusterGapStrong.avg != null ? `${r.clusterGapStrong.avg.toFixed(1)} 日` : '—'}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 600, color: r.cumReturn > 0 ? COLOR_UP : r.cumReturn < 0 ? COLOR_DOWN : COLOR_FLAT }}>
                    {(r.cumReturn * 100).toFixed(2)}%
                  </td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', color: COLOR_DOWN }}>{(r.maxDrawdown * 100).toFixed(2)}%</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 600 }}>{r.score.toFixed(1)}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', color: r.coverage < 1 ? '#FA8C16' : '#86909C' }}>
                    {(r.coverage * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: '#86909C', marginTop: 12, lineHeight: 1.8 }}>
          口径说明:间隔按<b>交易日序号差</b>计算（相邻两个事件日相差 1 即"间隔 1 个交易日"）；间隔样本少于 4 个时标注"样本少"，
          不计算集中度；累计收益为<b>复合收益</b> ∏(1+r)−1，不可简单相加；覆盖率 &lt; 100% 表示该板块存在数据缺失日（缺失日不计为 0 涨跌幅）。
          板块指数收益用于行情研究，不等于可交易组合收益。
        </div>
      </Card>

      {/* 第三层 */}
      <div style={{ height: 16 }} />
      <Card title="第三层 · 板块轮动关系" right={<span style={{ fontSize: 11, color: '#86909C' }}>进阶层 · 规划中</span>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          {[
            { t: '同步活跃', d: '哪些板块经常在相近时间走强？（事件重合率 / Jaccard 相似度）', v: 'V1.2' },
            { t: '先后关系', d: '某板块走强后，其它板块是否更容易在随后 1~5 个交易日走强？（条件频率 + Lift）', v: 'V1.2' },
            { t: '市场环境分层', d: '宽基上涨 / 下跌 / 高波动 / 低波动阶段下，活跃模式是否不同？', v: 'V2' },
          ].map((x) => (
            <div key={x.t} style={{ border: `1px dashed ${COLOR_BORDER}`, borderRadius: 10, padding: '14px 16px', background: '#FCFDFF' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT }}>{x.t}</span>
                <span style={{ fontSize: 10, color: '#86909C', background: '#F0F1F2', borderRadius: 4, padding: '2px 7px' }}>{x.v}</span>
              </div>
              <div style={{ fontSize: 12, color: '#86909C', lineHeight: 1.75 }}>{x.d}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: '#86909C', marginTop: 14, lineHeight: 1.8 }}>
          说明:以上均为<b>历史统计关联</b>，不代表因果，也不代表未来必然重现。展示前需同时给出样本数与基准频率。
        </div>
      </Card>
    </div>
  );
}