// 涨跌分布柱状图 — v2.0.7ae
// 11 档分桶:跌 5 / 平 1 / 涨 5,色:跌绿 / 平灰 / 涨红
// v2.0.7bq 左右外边距 30px / 柱子宽度动态(根据容器宽自适应)

import ReactECharts from 'echarts-for-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReportData } from '../data/loader';

interface Props {
  data: ReportData;
}

const RED = '#ff4d4f';
const GREEN = '#0ecd70';
const GRAY = '#9ca3af';

const BUCKETS: Array<{
  key: keyof NonNullable<NonNullable<ReportData['marketOverview']>['changeDistribution']>;
  label: string;
  type: 'down' | 'flat' | 'up';
}> = [
  { key: 'down_ge_10',   label: '>10%',  type: 'down' },
  { key: 'down_10_to_7', label: '10~7',  type: 'down' },
  { key: 'down_7_to_5',  label: '7~5',   type: 'down' },
  { key: 'down_5_to_3',  label: '5~3',   type: 'down' },
  { key: 'down_3_to_0',  label: '3~0',   type: 'down' },
  { key: 'flat',         label: '0',     type: 'flat' },
  { key: 'up_0_to_3',    label: '0~3',   type: 'up' },
  { key: 'up_3_to_5',    label: '3~5',   type: 'up' },
  { key: 'up_5_to_7',    label: '5~7',   type: 'up' },
  { key: 'up_7_to_10',   label: '7~10',  type: 'up' },
  { key: 'up_ge_10',     label: '>10%',  type: 'up' },
];

function barColor(type: 'down' | 'flat' | 'up'): string {
  if (type === 'down') return GREEN;
  if (type === 'flat') return GRAY;
  return RED;
}

export function ChangeDistributionCard({ data }: Props) {
  const dist = data.marketOverview.changeDistribution;
  // v2.0.7ds:涨跌家数/涨跌停直接读第一排卡片数字(跟卡片同源)— 不依赖 dist 累加
  // — 之前:dist 累加(useLiveData 拉的)— 跟卡片数字同源但不是直接读
  // — 现在:直接读 data.marketOverview.{upCount,downCount,flatCount,limitUpCount,limitDownCount}
  // — 跟第一排"上涨/下跌/涨跌停比"卡片数字完全一致
  // — em 限流时 dist 可能是空/部分数据,但卡片走 mergeLiveData 永远有值 — 跟卡片同源更稳定
  const upCount = data.marketOverview.upCount ?? 0;
  const downCount = data.marketOverview.downCount ?? 0;
  const flatCount = data.marketOverview.flatCount ?? 0;
  const limitUp = data.marketOverview.limitUpCount ?? 0;
  const limitDown = data.marketOverview.limitDownCount ?? 0;
  const total = upCount + downCount + flatCount;

  const downPct = total > 0 ? downCount / total : 0;
  const flatPct = total > 0 ? flatCount / total : 0;
  const upPct = total > 0 ? upCount / total : 0;

  // v2.0.7bq:测容器宽度 → 动态算柱子宽度
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        setContainerWidth(w);
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // 容器宽 - 左右 30*2 = 内部宽 / 11 桶 = 单桶宽,柱子 = 单桶宽 * 0.7
  const innerWidth = Math.max(0, containerWidth - 60);
  const barWidth = containerWidth > 0 ? Math.max(8, Math.floor((innerWidth / 11) * 0.7)) : 24;

  const option = useMemo(() => {
    if (!dist) return {};
    const labels = BUCKETS.map((b) => b.label);
    const values = BUCKETS.map((b) => dist[b.key] ?? 0);
    const colors = BUCKETS.map((b) => barColor(b.type));

    return {
      animation: false,
      // v2.0.7bq:左右外边距 30 统一
      grid: { top: 22, right: 30, left: 30, bottom: 20 },
      tooltip: { show: false },
      xAxis: {
        type: 'category' as const,
        data: labels,
        axisLine: { show: true, lineStyle: { color: '#E5E7EB', width: 1 } },
        axisTick: { show: false },
        axisLabel: { color: '#6b7280', fontSize: 12, fontWeight: 600 },
      },
      yAxis: { type: 'value' as const, show: false },
      series: [
        {
          type: 'bar' as const,
          data: values.map((v, i) => ({
            value: v,
            itemStyle: {
              color: colors[i],
              borderRadius: [4, 4, 0, 0],
              opacity: v === 0 ? 0.6 : 1,
            },
            label: { color: colors[i] },
          })),
          // v2.0.7bq:柱子宽度动态(根据容器宽度)
          barWidth: barWidth,
          label: {
            show: true,
            position: 'top' as const,
            fontSize: 11,
            fontWeight: 700,
            formatter: (p: any) => p.value >= 0 ? p.value : '',
          },
        },
      ],
    };
  }, [dist, barWidth]);

  if (!dist) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>暂无数据</div>;
  }

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* v2.0.7ek:柱状图撑到 300px(原来 227)— 配合 Card 360 整体高度 */}
      <div style={{ height: 280 }}>
        <ReactECharts
          option={option}
          style={{ height: '100%', width: '100%' }}
          notMerge={true}
          lazyUpdate={true}
        />
      </div>

      {/* 柱状图和底部内容之间 30px 间距 */}
      <div style={{ height: 24 }} />

      {/* 底部块 — 左右 30px 统一 */}
      <div style={{ paddingBottom: 20 }}>
        <div style={{ display: 'flex', gap: 16, padding: '0 30px 4px', fontSize: 13, color: '#4b5563' }}>
          <span>
            <span style={{ color: '#111827', fontWeight: 600 }}>涨跌</span>{' '}
            <span style={{ color: GREEN }}>跌{downCount}家</span>
            <span style={{ color: '#d1d5db' }}> · </span>
            <span style={{ color: RED }}>涨{upCount}家</span>
          </span>
          <span>
            <span style={{ color: GREEN }}>跌停{limitDown}家</span>
            <span style={{ color: '#d1d5db' }}>·</span>
            <span style={{ color: RED }}>涨停{limitUp}家</span>
          </span>
        </div>

        <div style={{ display: 'flex', height: 10, margin: '4px 30px 0', background: '#F3F4F6', gap: 2 }}>
          {downPct > 0 && (
            <div
              style={{
                width: `${downPct * 100}%`, background: GREEN,
                borderTopLeftRadius: 999, borderBottomLeftRadius: 999,
                borderTopRightRadius: 0, borderBottomRightRadius: 0,
              }}
              title={`跌 ${(downPct * 100).toFixed(1)}%`}
            />
          )}
          {flatPct > 0 && (
            <div style={{ width: `${flatPct * 100}%`, background: GRAY, borderRadius: 0 }} title={`平 ${(flatPct * 100).toFixed(1)}%`} />
          )}
          {upPct > 0 && (
            <div
              style={{
                width: `${upPct * 100}%`, background: RED,
                borderTopLeftRadius: 0, borderBottomLeftRadius: 0,
                borderTopRightRadius: 999, borderBottomRightRadius: 999,
              }}
              title={`涨 ${(upPct * 100).toFixed(1)}%`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
