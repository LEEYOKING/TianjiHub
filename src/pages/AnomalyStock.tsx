import { useState, useMemo } from 'react';
import { Empty, InputNumber, Pagination } from 'antd';
import { PageHeader } from './Overview';
import ColorText from '../components/ColorText';
import { formatPrice } from '../utils/format';
import { HEAD_STYLE, CELL_STYLE } from '../components/DetailTable';
import type { ReportData } from '../data/loader';
import type { BreakoutStock } from '../types';
import { useLive } from '../App';

type AnomalyType = 'breakout' | 'high-break' | 'low-position';

interface Props {
  type: AnomalyType;
  data: ReportData;
}

// 表格列配置(用户 #11 反馈:全站统一 14px 加粗黑色居中)
const TABLE_STYLE = { background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04), 0 0 30px 5px rgba(0, 0, 0, 0.02)', border: '1px solid #E5E7EB', padding: 4 };

// v1.9.1:每个页面的默认筛选条件 + 列配置
const CONFIG: {
  [K in AnomalyType]: {
    title: string;
    rule: string;
    defaults: { volMin: number; pctMin: number; pctMax: number; needNewHigh: boolean; excludeLimitUp: boolean };
    columns: Array<{ key: string; label: string; align: 'center' | 'left'; color?: string; render?: (v: any, row: BreakoutStock) => React.ReactNode }>;
  };
} = {
  breakout: {
    title: '放量突破',
    rule: '量比≥X, 涨幅≥Y%, 收盘创60日新高(口径基于东方财富强势股池)',
    defaults: { volMin: 2.0, pctMin: 5.0, pctMax: 100.0, needNewHigh: true, excludeLimitUp: false },
    columns: [
      { key: 'code', label: '代码', align: 'center' },
      { key: 'name', label: '名称', align: 'center', color: '#1890FF' },
      { key: 'closePrice', label: '当前价', align: 'center', render: (v: number) => formatPrice(v) },
      { key: 'changePercent', label: '涨跌幅', align: 'center', render: (v: number) => <ColorText value={v} mode="percent" withSign /> },
      { key: 'volumeMultiple', label: '量比', align: 'center', render: (v?: number) => (v ? `${v.toFixed(1)}倍` : '-') },
      { key: 'turnover', label: '成交额', align: 'center', render: (v: number) => `${v.toFixed(2)}亿` },
    ],
  },
  'high-break': {
    title: '突破前高',
    rule: '涨幅≥Y%, 收盘创60日新高(突破幅度 = 当日涨跌幅的近似)',
    defaults: { volMin: 0, pctMin: 5.0, pctMax: 100.0, needNewHigh: true, excludeLimitUp: false },
    columns: [
      { key: 'code', label: '代码', align: 'center' },
      { key: 'name', label: '名称', align: 'center', color: '#1890FF' },
      { key: 'closePrice', label: '当前价', align: 'center', render: (v: number) => formatPrice(v) },
      { key: 'changePercent', label: '涨跌幅', align: 'center', render: (v: number) => <ColorText value={v} mode="percent" withSign /> },
      { key: 'breakoutPercent', label: '突破幅度', align: 'center', render: (v?: number) => (v !== undefined ? <ColorText value={v} mode="percent" withSign /> : '-') },
      { key: 'turnover', label: '成交额', align: 'center', render: (v: number) => `${v.toFixed(2)}亿` },
    ],
  },
  'low-position': {
    title: '低位放量',
    rule: '量比≥X, 涨幅 Y%~Z%, 不属于涨停(基于东方财富强势股池)',
    defaults: { volMin: 2.0, pctMin: 2.0, pctMax: 9.6, needNewHigh: false, excludeLimitUp: true },
    columns: [
      { key: 'code', label: '代码', align: 'center' },
      { key: 'name', label: '名称', align: 'center', color: '#1890FF' },
      { key: 'closePrice', label: '当前价', align: 'center', render: (v: number) => formatPrice(v) },
      { key: 'changePercent', label: '涨跌幅', align: 'center', render: (v: number) => <ColorText value={v} mode="percent" withSign /> },
      { key: 'volumeMultiple', label: '量比', align: 'center', render: (v?: number) => (v ? `${v.toFixed(1)}倍` : '-') },
      { key: 'turnover', label: '成交额', align: 'center', render: (v: number) => `${v.toFixed(2)}亿` },
    ],
  },
};

export default function AnomalyStock({ type, data }: Props) {
  const cfg = CONFIG[type];
  const idx = data.marketOverview;
  // v1.9.1:全量候选股
  const candidates = data.allStrongStocks || data.breakoutStocks;
  // v1.9.2:用户可自定义筛选 — input 与 list 解耦,点"筛选"按钮才过滤
  const [volMinInput, setVolMinInput] = useState<number>(cfg.defaults.volMin);
  const [pctMinInput, setPctMinInput] = useState<number>(cfg.defaults.pctMin);
  const [pctMaxInput, setPctMaxInput] = useState<number>(cfg.defaults.pctMax);
  const [applied, setApplied] = useState<{ volMin: number; pctMin: number; pctMax: number }>({
    volMin: cfg.defaults.volMin, pctMin: cfg.defaults.pctMin, pctMax: cfg.defaults.pctMax,
  });
  // v2.0.7ei:分页器交互 — 10/20/50/100/page 可切换(放量突破/突破前高/低位放量)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const list = useMemo(() => {
    return candidates
      .filter((s) => (s.volumeMultiple ?? 0) >= applied.volMin)
      .filter((s) => s.changePercent >= applied.pctMin && s.changePercent <= applied.pctMax)
      .filter((s) => !cfg.defaults.needNewHigh || s.isNewHigh)
      .filter((s) => !cfg.defaults.excludeLimitUp || !s.isLimitUp)
      .map((s) => ({ ...s, breakoutPercent: s.breakoutPercent ?? s.changePercent }));
    // v2.0.7ei:删 .slice(0, 20) — 让分页器控制
  }, [candidates, applied, cfg.defaults.needNewHigh, cfg.defaults.excludeLimitUp]);

  // v2.0.7ei:分页后 list
  const paged = useMemo(() => list.slice((page - 1) * pageSize, page * pageSize), [list, page, pageSize]);

  const hasPendingChange =
    volMinInput !== applied.volMin || pctMinInput !== applied.pctMin || pctMaxInput !== applied.pctMax;

  return (
    <div>
      <PageHeader
        title={cfg.title}
        tradeDateSlash={idx.tradeDateSlash} _originalTradeDate={idx.tradeDate}

        liveTag="收盘复盘数据"
        subtitle="异动选股 · 量价共振信号"
        lastUpdatedAt={useLive().fetchedAt}
      />

      <div
        style={{
          background: '#FFFBE6', border: '1px solid #FFE58F', borderRadius: 4,
          padding: '10px 16px', marginBottom: 12, fontSize: 13, color: '#874D00',
        }}
      >
        <span style={{ color: '#999', marginRight: 8 }}>口径:</span>
        {cfg.rule}
      </div>

      {/* v1.9.1:用户可自定义筛选输入 */}
      <div
        style={{
          background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10,
          padding: '12px 20px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 13, color: '#4b5563', fontWeight: 600 }}>自定义筛选</span>
        <label style={{ fontSize: 13, color: '#4b5563' }}>
          量比 ≥
          <InputNumber
            size="small" min={0} step={0.1} value={volMinInput} onChange={(v) => setVolMinInput(v ?? 0)}
            style={{ width: 80, marginLeft: 6 }} addonAfter="倍"
          />
        </label>
        <label style={{ fontSize: 13, color: '#4b5563' }}>
          涨幅 ≥
          <InputNumber
            size="small" min={-10} step={0.5} value={pctMinInput} onChange={(v) => setPctMinInput(v ?? 0)}
            style={{ width: 80, marginLeft: 6 }} addonAfter="%"
          />
        </label>
        <label style={{ fontSize: 13, color: '#4b5563' }}>
          涨幅 ≤
          <InputNumber
            size="small" min={-10} max={20} step={0.5} value={pctMaxInput} onChange={(v) => setPctMaxInput(v ?? 100)}
            style={{ width: 80, marginLeft: 6 }} addonAfter="%"
          />
        </label>
        {/* v1.9.7:筛选按钮高亮 = UI 主题黑 #111827 */}
        <button
          // v2.0.7fv:L4 修 — 筛选后重置分页 page=1,避免停在空页
          onClick={() => {
            setApplied({ volMin: volMinInput, pctMin: pctMinInput, pctMax: pctMaxInput });
            setPage(1);
          }}
          style={{
            fontSize: 13, color: '#fff',
            background: hasPendingChange ? '#111827' : '#bfbfbf',
            border: 'none', padding: '5px 18px', borderRadius: 6,
            cursor: hasPendingChange ? 'pointer' : 'not-allowed',
            fontWeight: 600, transition: 'background 0.15s',
          }}
          disabled={!hasPendingChange}
        >
          筛选
        </button>
        <span style={{ fontSize: 12, color: '#86909C', marginLeft: 'auto' }}>
          候选池 {candidates.length} 只 · 命中 <b style={{ color: '#1890ff' }}>{list.length}</b> 只
        </span>
        <button
          onClick={() => {
            setVolMinInput(cfg.defaults.volMin);
            setPctMinInput(cfg.defaults.pctMin);
            setPctMaxInput(cfg.defaults.pctMax);
            setApplied({ volMin: cfg.defaults.volMin, pctMin: cfg.defaults.pctMin, pctMax: cfg.defaults.pctMax });
          }}
          style={{
            fontSize: 12, color: '#4b5563', background: '#F0F1F2',
            border: 'none', padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
          }}
        >
          重置默认
        </button>
      </div>

      {list.length === 0 ? (
        <Empty description="当前筛选条件下无符合股票" />
      ) : (
        <div style={TABLE_STYLE}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1080, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
              <thead>
                <tr>
                  {cfg.columns.map((c) => (
                    <th key={c.key} style={{ ...HEAD_STYLE, textAlign: c.align }}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* v2.0.7ei:用 paged(分页后)代替 list */}
                {paged.map((row: BreakoutStock) => (
                  <tr key={row.code}>
                    {cfg.columns.map((c) => {
                      const v = (row as any)[c.key];
                      const cellStyle: React.CSSProperties = {
                        ...CELL_STYLE,
                        textAlign: c.align,
                        color: c.color,
                        fontWeight: 700,
                      };
                      return (
                        <td key={c.key} style={cellStyle}>
                          {c.render ? c.render(v, row) : v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* v2.0.7ei:分页器(放量突破/突破前高/低位放量) */}
      {list.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={list.length}
            onChange={(p, s) => { setPage(p); setPageSize(s); }}
            showSizeChanger
            pageSizeOptions={['10', '20', '50', '100']}
            showTotal={(t) => `第 ${page} / ${Math.ceil(t / pageSize)} 页 · 共 ${t} 条`}
          />
        </div>
      )}
    </div>
  );
}
