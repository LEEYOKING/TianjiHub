import { useState, useMemo } from 'react';
import { Tag, Space, Pagination } from 'antd';
import { PageHeader } from './Overview';
import ColorText from '../components/ColorText';
import { HEAD_STYLE, CELL_STYLE } from '../components/DetailTable';
import type { ReportData } from '../data/loader';
import { useLive } from '../App';

export default function LimitUp({ data }: { data: ReportData }) {
  const [activeLevel, setActiveLevel] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  // v2.0.7ei:分页器交互 — 10/20/50/100/page 可切换
  const [pageSize, setPageSize] = useState(50);
  const idx = data.marketOverview;

  const filtered = useMemo(() => {
    if (!activeLevel) return data.limitUpStocks;
    // 不改 — 生产原本就是这种写法(activeLevel="3板" 字符串 vs s.consecutiveDays=3 数字 → 模板字符串后比较)
    return data.limitUpStocks.filter((s) => `${s.consecutiveDays}板` === activeLevel);
  }, [activeLevel, data.limitUpStocks]);

  const tags = data.limitUpLadders.map((l) => ({ level: `${l.level} × ${l.count}`, raw: l.level }));
  const allTag = { level: `全部 × ${data.limitUpStocks.length}`, raw: null as string | null };

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      <PageHeader
        title="连板天梯"
        tradeDateSlash={idx.tradeDateSlash} _originalTradeDate={idx.tradeDate}

        liveTag="收盘复盘数据"
        subtitle="连板梯队 · 涨停龙头股的全景画像"
        lastUpdatedAt={useLive().fetchedAt}
      />

      {/* 标签筛选 */}
      <div style={{ marginBottom: 12 }}>
        <Space wrap>
          {[allTag, ...tags].map((t) => (
            <Tag.CheckableTag
              key={t.level}
              checked={activeLevel === t.raw}
              onChange={() => {
                setActiveLevel(t.raw);
                setPage(1);
              }}
              style={{
                padding: '4px 14px',
                fontSize: 13,
                background: activeLevel === t.raw ? '#111827' : '#fff',
                color: activeLevel === t.raw ? '#fff' : '#4E5969',
                border: `1px solid ${activeLevel === t.raw ? '#111827' : '#E5E6EB'}`,
                borderRadius: 16,
                fontWeight: activeLevel === t.raw ? 600 : 400,
              }}
            >
              {t.level}
            </Tag.CheckableTag>
          ))}
        </Space>
      </div>

      {/* 表格 — 全站统一样式(用户 #11 反馈) + 用户 #18 圆角 14 + #6 阴影 */}
      <div style={{
        background: '#fff',
        borderRadius: 14,
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04), 0 0 30px 5px rgba(0, 0, 0, 0.02)', border: '1px solid #E5E7EB',
        padding: 4,
      }}>
        <div style={{ overflowX: 'auto' }}>
          {/* 用户 #12 反馈:列宽均衡 — 共 11 列,总宽 1100,均分约 100 */}
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '8%' }} />     {/* 代码 */}
              <col style={{ width: '9%' }} />     {/* 名称 */}
              <col style={{ width: '7%' }} />     {/* 连板数 */}
              <col style={{ width: '10%' }} />    {/* 所属行业 */}
              <col style={{ width: '8%' }} />     {/* 当前价 */}
              <col style={{ width: '8%' }} />     {/* 涨跌幅 */}
              <col style={{ width: '8%' }} />     {/* 换手率 */}
              <col style={{ width: '9%' }} />     {/* 成交额 */}
              <col style={{ width: '9%' }} />     {/* 封板资金 */}
              <col style={{ width: '9%' }} />     {/* 炸板次数 */}
              <col style={{ width: '15%' }} />    {/* 首封时间 */}
            </colgroup>
            <thead>
              <tr>
                <th style={HEAD_STYLE}>代码</th>
                <th style={HEAD_STYLE}>名称</th>
                <th style={HEAD_STYLE}>连板数</th>
                <th style={HEAD_STYLE}>所属行业</th>
                {/* 用户 #3 反馈:当前价/涨跌幅/换手率/成交额/封板资金 文本居中(全部) */}
                <th style={HEAD_STYLE}>当前价</th>
                <th style={HEAD_STYLE}>涨跌幅</th>
                <th style={HEAD_STYLE}>换手率</th>
                <th style={HEAD_STYLE}>成交额</th>
                <th style={HEAD_STYLE}>封板资金</th>
                <th style={HEAD_STYLE}>炸板次数</th>
                <th style={HEAD_STYLE}>首封时间</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((s) => (
                <tr key={s.code}>
                  <td style={CELL_STYLE}>{s.code}</td>
                  <td style={{ ...CELL_STYLE, color: '#1890FF' }}>{s.name}</td>
                  <td style={CELL_STYLE}>{s.consecutiveDays}连板</td>
                  <td style={CELL_STYLE}>{s.industry}</td>
                  {/* 用户 #3:全部数值列文本居中 */}
                  <td style={CELL_STYLE}>{s.closePrice.toFixed(2)}</td>
                  <td style={CELL_STYLE}>
                    <ColorText value={s.changePercent} mode="percent" withSign />
                  </td>
                  <td style={CELL_STYLE}>{s.turnoverRate != null ? `${s.turnoverRate.toFixed(2)}%` : '-'}</td>
                  <td style={CELL_STYLE}>{s.turnover.toFixed(2)}亿</td>
                  <td style={CELL_STYLE}>{(s.sealedAmount ?? 0).toFixed(2)}亿</td>
                  <td style={CELL_STYLE}>{s.bombedCount}</td>
                  <td style={CELL_STYLE}>{s.firstSealTime}</td>
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
            // v2.0.7fv:L7 修 — showTotal 应该用 antd 传入的 t,不是 filtered.length
            showTotal={(t) => `第 ${page} / ${Math.ceil(t / pageSize)} 页 · 共 ${t} 条`}
          />
        </div>
      )}
    </div>
  );
}
