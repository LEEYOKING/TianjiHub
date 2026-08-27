import { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { PageHeader, Card } from './Overview';
import { COLOR_UP, COLOR_DOWN, COLOR_TEXT, COLOR_FLAT } from '../utils/format';
import type { ReportData } from '../data/loader';
import type { SectorItem } from '../types';
import { useLive } from '../App';

export default function Sector({ data }: { data: ReportData }) {
  // data 已经是 App.tsx 合并 live 后的 mergedData,直接用
  const sectors = data.sectors;
  const concepts = data.conceptSectors || [];
  const regions = data.regionSectors || [];
  const idx = data.marketOverview;

  // 涨幅前 10 / 跌幅前 10
  // v2.0.7v:涨幅前 10 — 过滤负数 + 次级键(成交额 / 涨停数)
  const topGain = useMemo(
    () => [...sectors]
      .filter((s) => s.changePercent > 0)
      .sort((a, b) => b.changePercent - a.changePercent || (b.totalTurnover || 0) - (a.totalTurnover || 0) || (b.limitUpCount || 0) - (a.limitUpCount || 0))
      .slice(0, 10),
    [sectors]
  );
  // v2.0.7v:跌幅前 10 — 过滤非负数 + 次级键(成交额 / 跌停数)
  const topLose = useMemo(
    () => [...sectors]
      .filter((s) => s.changePercent < 0)
      .sort((a, b) => a.changePercent - b.changePercent || (b.totalTurnover || 0) - (a.totalTurnover || 0) || (b.limitUpCount || 0) - (a.limitUpCount || 0))
      .slice(0, 10),
    [sectors]
  );

  // 用户 #7-#10 反馈:行业/概念/地域 TOP15 = 全市场该日期内涨幅最高 15 个(过滤负数)
  // 全市场涨幅 TOP15(行业):涨幅 > 0 中排前 15
  const sectorTopGain = useMemo(
    () => [...sectors].filter((s) => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 15),
    [sectors]
  );
  // 用户 #8 反馈:全市场净流入 TOP15 = 净流入金额最高 15 个(过滤负值)
  const sectorTopNetIn = useMemo(
    () => [...sectors].filter((s) => (s.netInflow || 0) > 0).sort((a, b) => (b.netInflow || 0) - (a.netInflow || 0)).slice(0, 15),
    [sectors]
  );
  // 用户 #9 反馈:概念 TOP15 = 全市场该日期涨幅最高 15 个(过滤负数)
  const conceptTopGain = useMemo(
    () => [...concepts].filter((s) => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 15),
    [concepts]
  );
  // 用户 #10 反馈:地域 TOP15 = 全市场该日期涨幅最高 15 个(过滤负数)
  const regionTopGain = useMemo(
    () => [...regions].filter((s) => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 15),
    [regions]
  );

  return (
    <div>
      <style>{responsiveStyle}</style>
      <PageHeader
        title="板块涨跌"
        tradeDateSlash={idx.tradeDateSlash} _originalTradeDate={idx.tradeDate}

        subtitle="行业 + 概念 + 地域板块涨跌幅 + 主力资金流向"
        lastUpdatedAt={useLive().fetchedAt}
      />

      {/* 第一行:行业涨幅前10 + 跌幅前10 横向条形图 — 用户 #1 反馈:宽度 100% 自适应 */}
      <div className="sector-charts-grid">
        <div className="sector-chart-card">
          <BarChartCard
            title="行业板块涨幅前10"
            items={topGain.map((s, i) => ({ ...s, idx: i + 1, sign: 1 }))}
            maxAbs={Math.max(...topGain.map((s) => Math.abs(s.changePercent))) * 1.15}
            type="gain"
          />
        </div>
        <div className="sector-chart-card">
          <BarChartCard
            title="行业板块跌幅前10"
            items={topLose.map((s, i) => ({ ...s, idx: i + 1, sign: -1 }))}
            maxAbs={Math.max(...topLose.map((s) => Math.abs(s.changePercent))) * 1.15}
            type="lose"
          />
        </div>
      </div>

      {/* 第二行:行业 TOP15 涨跌幅 + 主力净流入 TOP15 */}
      <div className="sector-tables-grid">
        <DetailTableCard
          title="行业板块 TOP15"
          data={sectorTopGain}
          defaultSort="desc"
          showNetInflow={false}
        />
        <DetailTableCard
          title="行业主力净流入 TOP15"
          data={sectorTopNetIn}
          defaultSort="netInflow"
          showNetInflow={true}
        />
      </div>

      {/* 第三行:概念板块 + 地域板块 */}
      <div className="sector-tables-grid">
        <DetailTableCard
          title="概念板块 TOP15"
          data={conceptTopGain}
          defaultSort="desc"
        />
        <DetailTableCard
          title="地域板块 TOP15"
          data={regionTopGain}
          defaultSort="desc"
        />
      </div>
    </div>
  );
}

// 响应式:前 2 个图表 + 2 个表格均宽度自适应不溢出
const responsiveStyle = `
  /* 用户 #1 反馈:2 个图表 + 2 个表格宽度均自适应不溢出 */
  .sector-charts-grid, .sector-tables-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
    margin-bottom: 16px;
    width: 100%;
  }
  .sector-chart-card { min-width: 0; overflow: hidden; }
  @media (max-width: 1100px) {
    .sector-charts-grid { grid-template-columns: minmax(0, 1fr) !important; }
  }
  @media (max-width: 900px) {
    .sector-charts-grid, .sector-tables-grid { grid-template-columns: minmax(0, 1fr) !important; }
  }
  /* v2.0.7fd:移动端 768px — 紧凑(PC ≥ 769px 零影响) */
  @media (max-width: 768px) {
    .sector-charts-grid, .sector-tables-grid { grid-template-columns: minmax(0, 1fr) !important; gap: 10px !important; }
    .sector-chart-card { min-height: 280px !important; }
  }
`;

// ====== 横向条形图卡(左对齐 + 右侧数值 + 圆角) ======
function BarChartCard({ title, items, maxAbs, type: _type }: {
  title: string;
  items: (SectorItem & { idx: number; sign: number })[];
  maxAbs: number;
  type: 'gain' | 'lose';
}) {
  const labels = items.map((it) => it.name).reverse();
  const absValues = items.map((it) => Math.abs(it.changePercent)).reverse();
  const rawValues = items.map((it) => it.changePercent).reverse();
  // 真正的 maxAbs(从 absValues 算)— 用户 #7 反馈:最后 1 个坐标只保留 1 位小数
  const realMax = Math.max(maxAbs, ...absValues) * 1.1;

  const option = useMemo(() => {
    return {
      animation: true,
      animationDuration: 600,
      animationDurationUpdate: 400,
      animationEasing: 'linear',
      animationEasingUpdate: 'linear',
      grid: { top: 10, right: 70, left: 100, bottom: 20 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,0,0,0.04)' } },
        backgroundColor: '#fff',
        borderColor: '#E5E6EB',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: COLOR_TEXT, fontSize: 12 },
        formatter: (params: any) => {
          const p = params[0];
          const v = p.data.rawValue;
          const c = v > 0 ? COLOR_UP : v < 0 ? COLOR_DOWN : COLOR_FLAT;
          const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};opacity:0.6;margin-right:6px;vertical-align:middle;"></span>`;
          const sign = v >= 0 ? '+' : '';
          return `<div style="font-weight:600;color:#111827;font-size:13px;margin-bottom:4px;">${p.name}</div><div style="font-weight:600;color:${c};font-size:13px;">${dot}${sign}${v.toFixed(2)}%</div>`;
        },
      },
      xAxis: {
        type: 'value',
        min: 0,
        max: realMax,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#F0F0F0', type: 'dashed' } },
        // 用户 #7 反馈:横坐标最后 1 个坐标保留 1 位小数(原显示很多位)
        axisLabel: { color: '#86909C', fontSize: 11, formatter: (v: number) => `${v.toFixed(1)}%` },
      },
      yAxis: {
        type: 'category', data: labels, inverse: false,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: COLOR_TEXT, fontSize: 12, fontWeight: 500 },
      },
      series: [
        {
          type: 'bar',
          data: absValues.map((abs, i) => {
            // 用户 #2 反馈:A 股红涨绿跌 — 涨幅用渐变红,跌幅用渐变绿
            const isUp = rawValues[i] >= 0;
            // 涨幅:浅红 → 深红 ; 跌幅:浅绿 → 深绿
            const colorTop = isUp ? '#ff4d4f' : '#0ecd70';
            const colorBottom = isUp ? 'rgba(255, 77, 79, 0.15)' : 'rgba(14, 205, 112, 0.15)';
            return {
              value: abs,
              rawValue: rawValues[i],
              // 用户 #11 反馈:柱高度 × 1.3(原本 14 → 18)
              itemStyle: {
                color: {
                  type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
                  colorStops: [
                    { offset: 0, color: colorBottom },
                    { offset: 1, color: colorTop },
                  ],
                },
                borderRadius: [0, 4, 4, 0],
              },
            };
          }),
          // 用户 #11 反馈:柱宽度 18(原 14,× 1.3)
          barWidth: 18,
          label: {
            show: true,
            position: 'right',
            formatter: (p: any) => {
              const v = p.data.rawValue;
              const sign = v >= 0 ? '+' : '';
              // v2.0.7v:label 用 2 位,如有更精细的 pctRaw 显示 4 位
              const raw = p.data.rawPct;
              if (raw != null && Math.abs(raw) >= 0.0001 && Math.round(raw * 100) / 100 !== Math.round(v * 100) / 100) {
                return `${sign}${v.toFixed(2)}% (${sign}${raw.toFixed(4)}%)`;
              }
              return sign + v.toFixed(2) + '%';
            },
            color: COLOR_TEXT,
            fontSize: 11,
            fontWeight: 600,
          },
        },
      ],
    };
  }, [labels, absValues, rawValues, realMax]);

  return (
    <Card title={title}>
      {/* 用户 #1 反馈:宽度自适应 */}
      <ReactECharts option={option} style={{ height: 360, width: '100%' }} notMerge lazyUpdate />
    </Card>
  );
}

// ====== 详细表卡(支持涨跌幅升降序 + 表格样式 + 首列居中 + 列名不换行) ======
function DetailTableCard({ title, data, defaultSort = 'desc', showNetInflow = false }: { title: string; data: SectorItem[]; defaultSort?: 'desc' | 'asc' | 'netInflow' | 'turnover'; showNetInflow?: boolean }) {
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc' | 'netInflow' | 'turnover'>(defaultSort === 'turnover' ? 'turnover' : defaultSort);

  const sorted = useMemo(() => {
    const arr = [...data];
    if (sortOrder === 'desc') arr.sort((a, b) => b.changePercent - a.changePercent);
    else if (sortOrder === 'asc') arr.sort((a, b) => a.changePercent - b.changePercent);
    else if (sortOrder === 'netInflow') arr.sort((a, b) => (b.netInflow || 0) - (a.netInflow || 0));
    else arr.sort((a, b) => b.totalTurnover - a.totalTurnover);
    return arr;
  }, [data, sortOrder]);

  const cycleSort = () => {
    setSortOrder((cur) => {
      if (cur === 'desc') return 'asc';
      if (cur === 'asc') return showNetInflow ? 'netInflow' : 'turnover';
      if (cur === 'netInflow') return 'turnover';
      return 'desc';
    });
  };

  const sortLabel = sortOrder === 'desc' ? '涨跌幅 ↓' : sortOrder === 'asc' ? '涨跌幅 ↑' : sortOrder === 'netInflow' ? '净流入' : '成交额';

  // 表头/单元格 公共样式(用户 #11 反馈:列名不换行 / 字号 14px 加粗黑色居中)
  const headStyle: React.CSSProperties = {
    padding: '10px 8px',
    textAlign: 'center',
    color: '#111827',
    background: '#F7F8FA',
    fontSize: 14,
    fontWeight: 700,
    borderBottom: '1px solid #E5E6EB',
    whiteSpace: 'nowrap',  // 用户 #11 反馈:列名不换行
  };
  const cellStyle: React.CSSProperties = {
    padding: '10px 8px',
    textAlign: 'center',
    color: '#111827',
    fontSize: 14,
    fontWeight: 700,
    borderTop: '1px solid #F0F0F0',
    whiteSpace: 'nowrap',
  };

  // 渲染"板块名称"列 — 用户 #12 反馈:首列单元格居中
  const renderNameCell = (s: SectorItem) => (
    <td style={{ ...cellStyle, position: 'sticky', left: 0, background: '#fff', zIndex: 1, borderRight: '1px solid #E5E6EB' }}>{s.name}</td>
  );

  return (
    <Card title={title} right={
      <span style={{ fontSize: 11, color: '#86909C' }}>按 {sortLabel} 排序</span>
    }>
      {/* v2.0.7fn:user 反馈 PC 端表格"资金流向"列被 site header 盖住(红箭头)— 加 isolation: isolate 建立独立 stacking context,防止外部 site header zIndex 干扰;虽已确认 v2.0.7fm 不会影响 PC 端,但截图现象说明有外部 stacking 在穿透,加这层防御 */}
      <div style={{ overflowX: 'auto', maxWidth: '100%', position: 'relative', zIndex: 0, isolation: 'isolate' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: showNetInflow ? 645 : 585 }}>
          <thead>
            <tr>
              {/* 板块名称:首列,居中(用户 #12 反馈) */}
              <th style={{ ...headStyle, width: 95, position: 'sticky', left: 0, zIndex: 2, borderRight: '1px solid #E5E6EB' }}>板块名称</th>
              {showNetInflow && (
                <th onClick={cycleSort} style={{
                  ...headStyle, cursor: 'pointer', width: 80,
                  // 用户 #9 反馈:第 2 列表头颜色改回黑色(不再跟随 sortOrder 变色)
                  color: '#111827',
                }} title="点击切换排序">
                  主力净流入 {sortOrder === 'netInflow' ? '↓' : ''}
                </th>
              )}
              <th onClick={cycleSort} style={{
                ...headStyle,
                cursor: "pointer", width: 70,
                // 用户 #9 反馈:第 2 列表头颜色改回黑色
                color: '#111827',
              }} title="点击切换排序">
                涨跌幅 {sortOrder === 'desc' ? '↓' : sortOrder === 'asc' ? '↑' : ''}
              </th>
              <th style={{ ...headStyle, width: 70 }}>成交额</th>
              <th style={{ ...headStyle, width: 80 }}>涨停/占比</th>
              <th style={{ ...headStyle, width: 80 }}>上涨/下跌</th>
              <th style={{ ...headStyle, textAlign: 'left', width: 100 }}>领涨个股</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => {
              const pct = s.changePercent;
              const limitCount = s.limitUpCount ?? 0;
              const limitPct = s.stockCount > 0 ? (limitCount / s.stockCount * 100).toFixed(1) : '0.0';
              const topStocks = s.topStocks && s.topStocks.length > 0 ? s.topStocks : ['-', '-'];
              return (
                <tr key={s.name}>
                  {renderNameCell(s)}
                  {showNetInflow && (
                    <td style={{
                      ...cellStyle,
                      color: (s.netInflow || 0) > 0 ? COLOR_UP : COLOR_DOWN,
                      fontSize: 13,
                    }}>{(s.netInflow || 0) > 0 ? '+' : ''}{(s.netInflow || 0).toFixed(2)}亿</td>
                  )}
                  <td style={{
                    ...cellStyle,
                    color: pct >= 0 ? COLOR_UP : COLOR_DOWN,
                  }}>
                    {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                  </td>
                  <td style={cellStyle}>{s.totalTurnover.toFixed(2)}亿</td>
                  <td style={cellStyle}>
                    <span style={{
                      color: limitCount > 0 ? COLOR_UP : '#9ca3af',
                      fontSize: 18,
                      fontWeight: 700,
                    }}>{limitCount}</span>
                    <span style={{ color: '#C9CDD4', margin: '0 4px', fontWeight: 400, fontSize: 14 }}>/</span>
                    <span style={{ color: '#111827', fontWeight: 400, fontSize: 14 }}>{limitPct}%</span>
                  </td>
                  <td style={cellStyle}>
                    <span style={{ color: COLOR_UP }}>{s.upCount ?? '-'}</span>
                    <span style={{ color: '#C9CDD4', margin: '0 4px', fontWeight: 400 }}>/</span>
                    <span style={{ color: COLOR_DOWN }}>{s.downCount ?? '-'}</span>
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'left', fontSize: 12, fontWeight: 500 }}>
                    {topStocks[0] !== '-' ? (
                      <>
                        <span style={{ color: COLOR_UP, fontWeight: 700 }}>{topStocks[0]}</span>
                        {topStocks[1] && topStocks[1] !== '-' && (
                          <>
                            <span style={{ color: '#C9CDD4', margin: '0 4px' }}>·</span>
                            <span style={{ color: '#4E5969', fontWeight: 500 }}>{topStocks[1]}</span>
                          </>
                        )}
                      </>
                    ) : <span style={{ color: '#C9CDD4' }}>-</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
