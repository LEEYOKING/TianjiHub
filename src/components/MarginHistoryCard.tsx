// 融资流向卡片 — v2.0.7ab
// v2.0.7aa 初版:60 日 融资余额 + 沪指 + 净流入柱状
// v2.0.7ab:加右上角"当天净流入"徽章(参考 ths,红涨绿跌)

import ReactECharts from 'echarts-for-react';
import { useMemo } from 'react';
import type { ReportData } from '../data/loader';
import type { MarginHistoryItem } from '../types';

interface Props {
  data: ReportData;
}

const RED = '#ff4d4f';
const GREEN = '#0ecd70';
const BLUE = '#50a2fe';
const ORANGE = '#f59e0b';

export function MarginHistoryCard({ data }: Props) {
  const list = data.marketOverview.marginHistory;

  const sumN = (n: number) => {
    if (!list || list.length === 0) return 0;
    return list.slice(-n).reduce((s: number, x: MarginHistoryItem) => s + (x.margin_balance_diff || 0), 0);
  };

  const renderTopStat = (label: string, n: number) => {
    const v = sumN(n);
    const color = v > 0 ? RED : v < 0 ? GREEN : '#6b7280';
    const sign = v > 0 ? '+' : '';
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 2 }}>{label}</div>
        <div style={{ color, fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {sign}{v.toFixed(2)}亿元
        </div>
      </div>
    );
  };

  const option = useMemo(() => {
    if (!list || list.length === 0) return {};
    const dates = list.map((x: MarginHistoryItem) => x.date);
    const balances = list.map((x: MarginHistoryItem) => x.margin_balance);
    const closes = list.map((x: MarginHistoryItem) => x.sh_close);
    const diffs = list.map((x: MarginHistoryItem) => x.margin_balance_diff);
    const maxAbs = Math.max(...diffs.map((v: number) => Math.abs(v || 0)), 1);
    const balMin = Math.min(...balances);
    const balMax = Math.max(...balances);
    const closeArr = closes.filter((v: number | null): v is number => v != null);
    const closeMin = closeArr.length ? Math.min(...closeArr) : 3000;
    const closeMax = closeArr.length ? Math.max(...closeArr) : 4500;

    return {
      animation: false,
      grid: [
        { top: 8, right: 50, left: 50, bottom: '52%' },
        { top: '52%', right: 50, left: 50, bottom: 22 },
      ],
      tooltip: {
        trigger: 'axis' as const,
        axisPointer: { type: 'cross' as const, link: { xAxisIndex: 'all' } },
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderColor: '#E5E7EB',
        textStyle: { color: '#111827', fontSize: 12 },
        formatter: (params: any[]) => {
          if (!params || !params.length) return '';
          const i = params[0].dataIndex;
          const d = dates[i];
          const bal = balances[i]?.toFixed(2);
          const diff = diffs[i]?.toFixed(2);
          const sh = closes[i] != null ? closes[i]?.toFixed(2) : '-';
          const diffColor = (diffs[i] || 0) > 0 ? RED : GREEN;
          return `<div style="font-weight:600;color:#111827;margin-bottom:4px">${d}</div>
            融资余额: <b>${bal}亿</b><br/>
            融资净流入: <b style="color:${diffColor}">${(diffs[i] || 0) > 0 ? '+' : ''}${diff}亿</b><br/>
            沪指: <b>${sh}</b>`;
        },
      },
      xAxis: [
        {
          type: 'category' as const, data: dates, gridIndex: 0,
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { show: false },
        },
        {
          type: 'category' as const, data: dates, gridIndex: 1,
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { color: '#9ca3af', fontSize: 10, formatter: (v: string) => v.slice(5) },
        },
      ],
      yAxis: [
        {
          type: 'value' as const, gridIndex: 0,
          min: Math.floor(balMin * 0.998), max: Math.ceil(balMax * 1.002),
          axisLine: { show: false }, axisTick: { show: false },
          splitLine: { lineStyle: { color: '#F3F4F6', type: 'dashed' as const } },
          axisLabel: { color: '#9ca3af', fontSize: 10, formatter: (v: number) => v.toFixed(0) },
        },
        {
          // v2.0.7fv:M14 修 — 第二个 yAxis (收盘价) 加 position: 'right', 避免跟融资余额左轴标签覆盖
          type: 'value' as const, gridIndex: 0, position: 'right' as const,
          min: Math.floor(closeMin * 0.99), max: Math.ceil(closeMax * 1.01),
          axisLine: { show: false }, axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { color: '#9ca3af', fontSize: 10, formatter: (v: number) => v.toFixed(0) },
        },
        {
          type: 'value' as const, gridIndex: 1,
          min: -maxAbs, max: maxAbs,
          axisLine: { show: false }, axisTick: { show: false },
          splitLine: { lineStyle: { color: '#F3F4F6', type: 'dashed' as const } },
          axisLabel: { color: '#9ca3af', fontSize: 10, formatter: (v: number) => v.toFixed(0) },
        },
      ],
      series: [
        {
          name: '融资余额', type: 'line' as const, data: balances,
          smooth: true, symbol: 'none',
          lineStyle: { color: BLUE, width: 2 },
          areaStyle: { color: 'rgba(80,162,254,0.08)' },
          xAxisIndex: 0, yAxisIndex: 0,
        },
        {
          name: '收盘价', type: 'line' as const, data: closes,
          smooth: true, symbol: 'none',
          lineStyle: { color: ORANGE, width: 1.5 },
          xAxisIndex: 0, yAxisIndex: 1,
        },
        {
          name: '融资净流入', type: 'bar' as const, data: diffs,
          xAxisIndex: 1, yAxisIndex: 2,
          itemStyle: {
            color: (params: any) => (params.value >= 0 ? RED : GREEN),
            borderRadius: 2,
          },
          barWidth: '60%',
        },
      ],
    };
  }, [list]);

  if (!list || list.length === 0) {
    return (
      <div>
        <div style={{ display: 'flex', gap: 16, padding: '14px 16px', background: '#F7F8FA', borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
          {renderTopStat('60日净流入', 60)}
          {renderTopStat('20日净流入', 20)}
          {renderTopStat('5日净流入', 5)}
          {renderTopStat('3日净流入', 3)}
        </div>
        <div style={{ padding: '40px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
          ⚠️ 融资融券数据暂未拉到
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 顶部 4 数字 — v2.0.7ac:徽章移到 Card right */}
      <div style={{ display: 'flex', gap: 16, padding: '8px 4px', marginBottom: 4, fontSize: 12 }}>
        {renderTopStat('60日净流入', 60)}
        {renderTopStat('20日净流入', 20)}
        {renderTopStat('5日净流入', 5)}
        {renderTopStat('3日净流入', 3)}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactECharts
          option={option}
          // v2.0.7ek:配合 Card 360 整体高度
          style={{ height: '100%', minHeight: 300, width: '100%' }}
          notMerge={true}
          lazyUpdate={true}
        />
      </div>
    </div>
  );
}
