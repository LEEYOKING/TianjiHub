// 【板块轮动 · 第三层】板块轮动关系
// 三个子区块：同步活跃 / 先后关系 / 市场环境分层。
// 视觉沿用站点既有卡片体系（内联 style、红涨绿跌），不引入 antd 或任何新依赖。
// 口径：强势事件一律取自 comp 已算好的 strong；缺失日不计入分母，也不计为 0 涨跌。
// 免责：以下均为历史统计关联，不代表因果，也不代表未来必然重现；样本不足处已标注。

import { useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { InfoTip, tipItems } from './InfoTip';
import { COLOR_BORDER, COLOR_DOWN, COLOR_FLAT, COLOR_TEXT, COLOR_UP } from '../utils/format';
import type { RotationData, RotationRuleSet } from '../utils/rotation/types';
import type { WindowComputation } from '../utils/rotation/ruleEngine';
import type { SectorStats } from '../utils/rotation/analytics';
import {
  computeLeadLag,
  computeRegimeLabels,
  computeRegimeStats,
  computeSyncPairs,
} from '../utils/rotation/relations';

const COLOR_MID = '#FA8C16'; // 中档 lift(1.2~1.5)

// v2.0.8ku:三个子表的表头字段(与下方 Head cols 一一对应)—— 用于感叹号气泡说明
const MODE_HEADERS: Record<'sync' | 'lead' | 'regime', string[]> = {
  sync: ['板块 A', '板块 B', '共同活跃天数', '各自活跃天数', '重合率(Jaccard)', 'Lift'],
  lead: ['跟随板块', '基准频率', 't+1', 't+2', 't+3', 't+4', 't+5', '最佳滞后', '命中样本'],
  regime: ['板块', '上涨日频率', '下跌日频率', '差值', '高波动频率', '低波动频率'],
};

const TABLE: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const TH: React.CSSProperties = { padding: '8px 10px', fontWeight: 500, color: '#86909C', whiteSpace: 'nowrap' };

// v2.0.8kt:板块名链接样式(与站点卡片体系一致;悬停变色由下方 <style> 提供)
const LINK_STYLE: React.CSSProperties = {
  color: COLOR_TEXT,
  fontWeight: 500,
  textDecoration: 'none',
  borderBottom: '1px dashed #D5DAE2',
};
const LINK_CSS = `
  .tj-rot-link { transition: color .15s, border-color .15s; }
  .tj-rot-link:hover { color: #1890FF; border-bottom-color: #1890FF; }
`;

/** 表头行（背景 #F7F9FC + 字色 #86909C） */
function Head({ cols }: { cols: { label: string; align?: 'left' | 'right' }[] }) {
  return (
    <thead>
      <tr style={{ background: '#F7F9FC', color: '#86909C' }}>
        {cols.map((c) => (
          <th key={c.label} style={{ ...TH, textAlign: c.align ?? 'right' }}>
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** 分段切换按钮（等价于 RotationRulePanel 里的 Seg，但本文件自包含） */
function Seg<T extends string | number>({
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
          key={String(o.value)}
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

const pct1 = (x: number): string => `${(x * 100).toFixed(1)}%`;

/** 按 lift 上色：≥1.5 强(红) / 1.2~1.5 中(橙) / <1.2 灰 */
function liftColor(lift: number): string {
  if (lift >= 1.5) return COLOR_UP;
  if (lift >= 1.2) return COLOR_MID;
  return COLOR_FLAT;
}

const EMPTY_HINT: React.CSSProperties = { fontSize: 12, color: '#86909C', padding: '14px 0' };

export function RotationRelations(props: {
  data: RotationData;
  rule: RotationRuleSet;
  comp: WindowComputation;
  stats: SectorStats[];
}): ReactElement {
  const { data, rule, comp, stats } = props;
  const [mode, setMode] = useState<'sync' | 'lead' | 'regime'>('sync');
  const [minCoDays, setMinCoDays] = useState<number>(3);
  const [leaderId, setLeaderId] = useState<string>('');

  // 领先板块候选：有强势事件、按 strongCount 降序（并列按 board id 升序）
  const leaders = useMemo(
    () =>
      [...stats]
        .filter((s) => s.strongCount > 0)
        .sort(
          (a, b) =>
            b.strongCount - a.strongCount ||
            (a.sector.id < b.sector.id ? -1 : a.sector.id > b.sector.id ? 1 : 0),
        ),
    [stats],
  );
  const activeLeader =
    leaderId && leaders.some((l) => l.sector.id === leaderId) ? leaderId : leaders[0]?.sector.id ?? '';

  const syncPairs = useMemo(
    () => computeSyncPairs(comp, stats, { minCoDays, limit: 10 }),
    [comp, stats, minCoDays],
  );
  const leadRows = useMemo(
    () => (activeLeader ? computeLeadLag(comp, stats, activeLeader, 5) : []),
    [comp, stats, activeLeader],
  );
  const labels = useMemo(() => computeRegimeLabels(data, comp), [data, comp]);
  const regimeRows = useMemo(() => {
    const rs = computeRegimeStats(comp, stats, labels);
    return [...rs]
      .sort(
        (a, b) =>
          Math.abs(b.upFreq - b.downFreq) - Math.abs(a.upFreq - a.downFreq) ||
          (a.sector.id < b.sector.id ? -1 : a.sector.id > b.sector.id ? 1 : 0),
      )
      .slice(0, 15);
  }, [comp, stats, labels]);

  return (
    <div>
      {/* v2.0.8kt:板块名链接的悬停样式(全局限定在 .tj-rot-link,不影响其它页面) */}
      <style>{LINK_CSS}</style>
      {/* 分段切换 + 当前子表字段说明(感叹号气泡随模式切换字段) */}
      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            { label: '同步活跃', value: 'sync' as const },
            { label: '先后关系', value: 'lead' as const },
            { label: '市场环境分层', value: 'regime' as const },
          ]}
        />
        <InfoTip items={tipItems(MODE_HEADERS[mode])} title="列含义 / 计算公式" />
      </div>

      {/* (a) 同步活跃 */}
      {mode === 'sync' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#4E5969' }}>共同活跃天数 ≥</span>
            <Seg
              value={minCoDays}
              onChange={setMinCoDays}
              options={[
                { label: '3', value: 3 },
                { label: '5', value: 5 },
                { label: '8', value: 8 },
              ]}
            />
            <span style={{ fontSize: 11, color: '#86909C' }}>
              重合率 Jaccard = 共同活跃天数 / 两者活跃天数并集；Lift = 实际共同天数 / 随机基准期望
            </span>
          </div>
          {syncPairs.length === 0 ? (
            <div style={EMPTY_HINT}>窗口内暂无可展示的同步活跃板块对（可调低「共同活跃天数」阈值）。</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ ...TABLE, minWidth: 720 }}>
                <Head
                  cols={[
                    { label: '板块 A', align: 'left' },
                    { label: '板块 B', align: 'left' },
                    { label: '共同活跃天数' },
                    { label: '各自活跃天数' },
                    { label: '重合率(Jaccard)' },
                    { label: 'Lift' },
                  ]}
                />
                <tbody>
                  {syncPairs.map((p) => (
                    <tr key={`${p.a.id}-${p.b.id}`} style={{ borderBottom: `1px solid ${COLOR_BORDER}` }}>
                      {/* v2.0.8kt:板块名可点击 → 进入该板块行为详情 */}
                      <td style={{ padding: '8px 10px' }}>
                        <Link to={`/rotation/sector/${p.a.id}`} style={LINK_STYLE} className="tj-rot-link">
                          {p.a.name}
                        </Link>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <Link to={`/rotation/sector/${p.b.id}`} style={LINK_STYLE} className="tj-rot-link">
                          {p.b.name}
                        </Link>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: COLOR_UP, fontWeight: 600 }}>{p.coDays}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#86909C' }}>
                        {p.aDays} / {p.bDays}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{pct1(p.jaccard)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: liftColor(p.lift) }}>
                        {p.lift.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* (b) 先后关系 */}
      {mode === 'lead' && (
        <div>
          {leaders.length === 0 ? (
            <div style={EMPTY_HINT}>窗口内无强势事件，暂无可分析的领先板块。</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#4E5969' }}>领先板块</span>
                <select
                  value={activeLeader}
                  onChange={(e) => setLeaderId(e.target.value)}
                  style={{
                    border: `1px solid ${COLOR_BORDER}`,
                    borderRadius: 8,
                    padding: '5px 10px',
                    fontSize: 12,
                    color: COLOR_TEXT,
                    background: '#fff',
                    outline: 'none',
                    minWidth: 160,
                  }}
                >
                  {leaders.map((l) => (
                    <option key={l.sector.id} value={l.sector.id}>
                      {l.sector.name}（强势 {l.strongCount} 次）
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: 11, color: '#86909C' }}>
                  条件频率 = 领先板块走强后第 k 个交易日跟随板块也走强的比例；基准频率 = 跟随板块整体活跃频率
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ ...TABLE, minWidth: 860 }}>
                  <Head
                    cols={[
                      { label: '跟随板块', align: 'left' },
                      { label: '基准频率' },
                      { label: 't+1' },
                      { label: 't+2' },
                      { label: 't+3' },
                      { label: 't+4' },
                      { label: 't+5' },
                      { label: '最佳滞后' },
                      { label: '命中样本' },
                    ]}
                  />
                  <tbody>
                    {leadRows.map((r) => (
                      <tr key={r.sector.id} style={{ borderBottom: `1px solid ${COLOR_BORDER}` }}>
                        <td style={{ padding: '8px 10px', color: COLOR_TEXT, fontWeight: 500, whiteSpace: 'nowrap' }}>
                          {r.sector.name}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#86909C' }}>{pct1(r.baseFreq)}</td>
                        {r.cells.map((c) => (
                          <td
                            key={c.k}
                            title={`命中 ${c.hits} 次 / lift ${c.lift.toFixed(2)}`}
                            style={{ padding: '8px 10px', textAlign: 'right', color: liftColor(c.lift), fontWeight: 600 }}
                          >
                            {pct1(c.condFreq)}
                          </td>
                        ))}
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          {r.best ? (
                            <span style={{ color: liftColor(r.best.lift), fontWeight: 600 }}>
                              t+{r.best.k}（lift {r.best.lift.toFixed(2)}）
                            </span>
                          ) : (
                            <span style={{ color: COLOR_FLAT }}>样本不足</span>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#86909C' }}>
                          {r.samples}
                          {r.samples < 3 && <span style={{ color: COLOR_FLAT, fontSize: 10 }}> 样本不足</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* (c) 市场环境分层 */}
      {mode === 'regime' && (
        <div>
          <div style={{ fontSize: 11, color: '#86909C', lineHeight: 1.8, marginBottom: 10 }}>
            两个维度定义：<b>涨跌环境</b>按当日基准涨跌幅符号（&gt;0 记为上涨日、&lt;0 记为下跌日，等于 0 或无数据不计入）；
            <b>波动环境</b>对基准计算 20 个交易日滚动标准差（不足 20 日用已有天数），取其窗口内中位数为阈值，高于中位数为高波动。
            各环境频率的分母为该环境下的有效交易日数，缺失日不计入分母，也不计为 0 涨跌。
          </div>
          {regimeRows.length === 0 ? (
            <div style={EMPTY_HINT}>窗口内暂无数据。</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ ...TABLE, minWidth: 720 }}>
                <Head
                  cols={[
                    { label: '板块', align: 'left' },
                    { label: '上涨日频率' },
                    { label: '下跌日频率' },
                    { label: '差值' },
                    { label: '高波动频率' },
                    { label: '低波动频率' },
                  ]}
                />
                <tbody>
                  {regimeRows.map((r) => {
                    const diff = r.upFreq - r.downFreq;
                    const diffColor = diff > 0 ? COLOR_UP : diff < 0 ? COLOR_DOWN : COLOR_FLAT;
                    return (
                      <tr key={r.sector.id} style={{ borderBottom: `1px solid ${COLOR_BORDER}` }}>
                        <td style={{ padding: '8px 10px', color: COLOR_TEXT, fontWeight: 500, whiteSpace: 'nowrap' }}>
                          {r.sector.name}
                        </td>
                        <td
                          title={`上涨日 ${r.upDays} 天`}
                          style={{ padding: '8px 10px', textAlign: 'right', color: COLOR_UP }}
                        >
                          {pct1(r.upFreq)}
                        </td>
                        <td
                          title={`下跌日 ${r.downDays} 天`}
                          style={{ padding: '8px 10px', textAlign: 'right', color: COLOR_DOWN }}
                        >
                          {pct1(r.downFreq)}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: diffColor }}>
                          {diff > 0 ? '+' : ''}
                          {(diff * 100).toFixed(1)}%
                        </td>
                        <td
                          title={`高波动日 ${r.highVolDays} 天`}
                          style={{ padding: '8px 10px', textAlign: 'right' }}
                        >
                          {pct1(r.highVolFreq)}
                        </td>
                        <td
                          title={`低波动日 ${r.lowVolDays} 天`}
                          style={{ padding: '8px 10px', textAlign: 'right' }}
                        >
                          {pct1(r.lowVolFreq)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 免责说明 */}
      <div style={{ fontSize: 11, color: '#86909C', marginTop: 14, lineHeight: 1.8 }}>
        说明：以上均为<b>历史统计关联</b>，不代表因果，也不代表未来必然重现；样本不足处已标注（先后关系中命中 &lt; 3 视为样本不足）。
        统计窗口：近 {rule.windowDays} 个交易日，事件口径遵循当前规则，缺失日不计入分母。
      </div>
    </div>
  );
}