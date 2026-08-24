// 主力资金流卡片 — v2.0.7ab
// 数据源:akshare stock_fund_flow_industry 90 行业当日净额累加
// 顶部 1 大数字(今日主力净流入) + 90 行业柱状图(从大到小) + hover 高亮

import ReactECharts from 'echarts-for-react';
import { useMemo, useState } from 'react';
import type { ReportData } from '../data/loader';

interface Props {
  data: ReportData;
}

const RED = '#ff4d4f';
const GREEN = '#0ecd70';

export function MainCapitalFlowCard({ data }: Props) {
  const mcf = data.marketOverview.mainCapitalFlow20d;
  const industries = (mcf as any)?.industries as Array<{ name: string; net_inflow: number }> | undefined;
  const total = (mcf as any)?.total_net_inflow ?? 0;
  const date = (mcf as any)?.date ?? '';
  const [hover, setHover] = useState<{ name: string; net: number } | null>(null);

  const totalColor = total > 0 ? RED : total < 0 ? GREEN : '#6b7280';
  const sign = total > 0 ? '+' : '';

  const option = useMemo(() => {
    if (!industries || industries.length === 0) return {};
    const names = industries.map((x) => x.name);
    const values = industries.map((x) => x.net_inflow);
    const maxAbs = Math.max(...values.map((v) => Math.abs(v)), 1);

    return {
      animation: false,
      grid: { top: 8, right: 6, left: 8, bottom: 18 },
      tooltip: {
        trigger: 'axis' as const,
        axisPointer: { type: 'shadow' as const },
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderColor: '#E5E7EB',
        textStyle: { color: '#111827', fontSize: 12 },
        formatter: (params: any) => {
          const i = params[0].dataIndex;
          return `<div style="font-weight:600;color:#111827">${names[i]}</div>主力净流入: <b style="color:${values[i] > 0 ? RED : GREEN}">${values[i] > 0 ? '+' : ''}${values[i].toFixed(2)}亿元</b>`;
        },
      },
      xAxis: {
        type: 'value' as const,
        min: -maxAbs, max: maxAbs,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#F3F4F6', type: 'dashed' as const } },
        axisLabel: { color: '#9ca3af', fontSize: 10, formatter: (v: number) => v.toFixed(0) },
      },
      yAxis: {
        type: 'category' as const,
        data: names,
        inverse: true,  // 从大到小
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#6b7280', fontSize: 10 },
      },
      series: [
        {
          name: '主力净流入',
          type: 'bar' as const,
          data: values.map((v) => ({
            value: v,
            itemStyle: {
              color: v >= 0 ? RED : GREEN,
              borderRadius: v >= 0 ? [0, 2, 2, 0] : [2, 0, 0, 2],
            },
          })),
          barWidth: '60%',
          emphasis: { focus: 'self' as const },
        },
      ],
    };
  }, [industries]);

  if (!industries || industries.length === 0) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 12, lineHeight: 1.7 }}>
        ⚠️ 主力资金流暂未接入
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 顶部:今日净流入 + 日期(像 ths 一样,左大字 + 右日期) */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 4px 10px', borderBottom: '1px solid #F3F4F6', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>今日主力净流入</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: totalColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
            {sign}{total.toFixed(2)}<span style={{ fontSize: 12, fontWeight: 600, marginLeft: 2 }}>亿元</span>
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'right' }}>
          {date}<br />
          <span style={{ color: '#d1d5db' }}>90 行业累加</span>
        </div>
      </div>

      {/* 柱状图 */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactECharts
          option={option}
          style={{ height: '100%', minHeight: 200, width: '100%' }}
          notMerge={true}
          lazyUpdate={true}
          onEvents={{
            mouseover: (e: any) => {
              if (e?.dataIndex != null) {
                setHover({ name: industries[e.dataIndex].name, net: industries[e.dataIndex].net_inflow });
              }
            },
            mouseout: () => setHover(null),
          }}
        />
      </div>

      {/* hover 提示(放卡片底部) */}
      {hover && (
        <div style={{ marginTop: 4, padding: '4px 8px', background: '#F7F8FA', borderRadius: 4, fontSize: 11, color: '#4b5563' }}>
          <strong style={{ color: '#111827' }}>{hover.name}</strong> ·{' '}
          <strong style={{ color: hover.net > 0 ? RED : GREEN }}>
            {hover.net > 0 ? '+' : ''}{hover.net.toFixed(2)}亿元
          </strong>
        </div>
      )}
    </div>
  );
}
