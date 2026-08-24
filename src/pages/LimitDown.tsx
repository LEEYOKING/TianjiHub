import { useState, useMemo } from 'react';
import { Tag, Space, Pagination } from 'antd';
import { PageHeader } from './Overview';
import ColorText from '../components/ColorText';
import { HEAD_STYLE, CELL_STYLE } from '../components/DetailTable';
import type { ReportData } from '../data/loader';
import { useLive } from '../App';

export default function LimitDown({ data }: { data: ReportData }) {
  const [activeLevel, setActiveLevel] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  // v2.0.7ei:分页器交互 — 10/20/50/100/page 可切换
  const [pageSize, setPageSize] = useState(50);
  const idx = data.marketOverview;

  const filtered = useMemo(() => {
    if (!activeLevel) return data.limitDownStocks;
    const n = parseInt(activeLevel.replace('个跌停', ''));
    return data.limitDownStocks.filter((s) => s.consecutiveDownDays === n);
  }, [activeLevel, data.limitDownStocks]);

  const tags = data.limitDownLadders.map((l) => ({ level: `${l.level} × ${l.count}`, raw: l.level }));
  const allTag = { level: `全部 × ${data.limitDownStocks.length}`, raw: null as string | null };  // v2.0.7ah:跟列表长度一致

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      <PageHeader
        title="跌停梯队"
        tradeDateSlash={idx.tradeDateSlash} _originalTradeDate={idx.tradeDate}

        liveTag="收盘复盘数据"
        subtitle="跌钱梯队 · 亏钱效应传导"
        lastUpdatedAt={useLive().fetchedAt}
      />

      <div style={{ marginBottom: 12 }}>
        <Space wrap>
          {[allTag, ...tags].map((t) => (
            <Tag.CheckableTag
              key={t.level}
              checked={activeLevel === t.raw}
              onChange={() => { setActiveLevel(t.raw); setPage(1); }}
              style={{
                padding: '4px 14px', fontSize: 13,
                background: activeLevel === t.raw ? '#111827' : '#fff',
                color: activeLevel === t.raw ? '#fff' : '#4E5969',
                border: `1px solid ${activeLevel === t.raw ? '#111827' : '#E5E6EB'}`,
                borderRadius: 16, fontWeight: activeLevel === t.raw ? 600 : 400,
              }}
            >
              {t.level}
            </Tag.CheckableTag>
          ))}
        </Space>
      </div>

      <div style={{
        background: '#fff',
        borderRadius: 14,
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04), 0 0 30px 5px rgba(0, 0, 0, 0.02)', border: '1px solid #E5E7EB',
        padding: 4,
      }}>
        {/* 用户 #4 反馈:删除左上角股票名列表(重复) */}
        <div style={{ overflowX: 'auto' }}>
          {/* v2.0.7es:9 列(加"当前价"在"所属行业"和"涨跌幅"之间) */}
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1020, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '9%' }} />     {/* 代码 */}
              <col style={{ width: '9%' }} />     {/* 名称 */}
              <col style={{ width: '12%' }} />    {/* 所属行业 */}
              <col style={{ width: '10%' }} />    {/* 当前价(v2.0.7es 新增) */}
              <col style={{ width: '11%' }} />    {/* 涨跌幅 */}
              <col style={{ width: '10%' }} />    {/* 连续跌停 */}
              <col style={{ width: '10%' }} />    {/* 换手率 */}
              <col style={{ width: '13%' }} />    {/* 成交额 */}
              <col style={{ width: '16%' }} />    {/* 封单资金 */}
            </colgroup>
            <thead>
              <tr>
                <th style={HEAD_STYLE}>代码</th>
                <th style={HEAD_STYLE}>名称</th>
                <th style={HEAD_STYLE}>所属行业</th>
                {/* v2.0.7es:新增"当前价"列(所属行业和涨跌幅之间)— 读取 closePrice 字段 */}
                <th style={HEAD_STYLE}>当前价</th>
                <th style={HEAD_STYLE}>涨跌幅</th>
                <th style={HEAD_STYLE}>连续跌停</th>
                <th style={HEAD_STYLE}>换手率</th>
                <th style={HEAD_STYLE}>成交额</th>
                {/* 用户 #5 反馈:封单资金文本居中 + 单位改"亿" */}
                <th style={HEAD_STYLE}>封单资金</th>
              </tr>
            </thead>
            <tbody>
              {/* v2.0.7af:data 为空时友好提示(避免 user 看到空表格) */}
              {data.limitDownStocks.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ ...CELL_STYLE, textAlign: 'center', padding: '40px 0', color: '#86909C' }}>
                    今日暂无跌停股票(全天 <strong style={{ color: '#0ecd70' }}>0</strong> 只)
                  </td>
                </tr>
              )}
              {paged.map((s) => (
                <tr key={s.code}>
                  <td style={CELL_STYLE}>{s.code}</td>
                  <td style={{ ...CELL_STYLE, color: '#1890FF' }}>{s.name}</td>
                  <td style={CELL_STYLE}>{s.industry}</td>
                  {/* v2.0.7es:显示 closePrice(从 akshare 跌停池 em 取最新价)— 保留 2 位小数 */}
                  <td style={CELL_STYLE}>{s.closePrice ? s.closePrice.toFixed(2) : '-'}</td>
                  <td style={CELL_STYLE}>
                    <ColorText value={s.changePercent} mode="percent" withSign />
                  </td>
                  <td style={CELL_STYLE}>{s.consecutiveDownDays}</td>
                  <td style={CELL_STYLE}>{s.turnoverRate ? `${s.turnoverRate.toFixed(2)}%` : '-'}</td>
                  <td style={CELL_STYLE}>{s.turnover ? `${s.turnover.toFixed(2)}亿` : '-'}</td>
                  {/* 用户 #5 反馈:封单资金显示 "X.XX亿"(原是 "X万" 大数) */}
                  <td style={CELL_STYLE}>{s.sealedAmount !== undefined ? `${s.sealedAmount.toFixed(2)}亿` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filtered.length > pageSize && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={filtered.length}
            // v2.0.7ei:onChange 接 (page, pageSize)— 同时更新 page 和 pageSize
            onChange={(p, s) => { setPage(p); setPageSize(s); }}
            showSizeChanger
            pageSizeOptions={['10', '20', '50', '100']}
            showTotal={(t) => `第 ${page} / ${Math.ceil(t / pageSize)} 页 · 共 ${filtered.length} 条`}
          />
        </div>
      )}
    </div>
  );
}
