import { useEffect, useState, useMemo } from 'react';
import { Card } from 'antd';
import ReactECharts from 'echarts-for-react';
import { COLOR_UP, COLOR_DOWN } from '../utils/format';
import { PageHeader } from './Overview';
import { useLive } from '../App';
import { useIsMobile } from '../hooks/useIsMobile';

interface Asset {
  code: string;
  name: string;
  price: number;
  changePct: number;
  series: { date: string; pct: number }[];
}

interface PreScanData {
  meta: { generatedAt: string; tradeDate: string };
  assets: Asset[];
  riskText: string[];
}

export default function PreScan() {
  const [data, setData] = useState<PreScanData | null>(null);
  // v2.0.7fd:6 列资产 grid 移动端变 2 列
  const isMobile = useIsMobile();

  useEffect(() => {
    // v2.0.7fv:L2 修 — fetch 加 .catch + cancelled flag
    let cancelled = false;
    fetch(import.meta.env.BASE_URL + 'prescan.json')
      .then((r) => {
        if (!r.ok) throw new Error(`prescan.json 拉取失败: ${r.status}`);
        return r.json();
      })
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) console.warn('[PreScan] 拉取失败:', e); });
    return () => { cancelled = true; };
  }, []);

  const chartOption = useMemo(() => {
    if (!data) return {};
    // X 轴:用所有资产的最长 series 的日期做主轴,取最近 30 个交易日
    let xDates: string[] = [];
    data.assets.forEach((a) => {
      if (a.series.length > xDates.length) {
        xDates = a.series.map((s) => s.date);
      }
    });
    // 各资产 series 按时间对齐
    const series = data.assets.map((a) => {
      const yValues = a.series.map((s) => s.pct);
      return {
        name: a.name,
        type: 'line',
        data: yValues,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2 },
        emphasis: { focus: 'series' },
      };
    });
    return {
      grid: { top: 40, right: 20, left: 60, bottom: 30 },
      legend: {
        show: true,
        top: 5,
        textStyle: { color: '#4E5969', fontSize: 12 },
        itemWidth: 16,
        itemHeight: 8,
        itemGap: 16,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        valueFormatter: (v: number) => `${v.toFixed(2)}%`,
      },
      xAxis: {
        type: 'category',
        data: xDates,
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#86909C', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        splitLine: { lineStyle: { color: '#F0F0F0', type: 'dashed' } },
        axisLabel: { color: '#86909C', fontSize: 11, formatter: '{value}%' },
      },
      series,
      color: ['#E60012', '#1890FF', '#52C41A', '#722ED1', '#FA8C16', '#13C2C2'],
    };
  }, [data]);

  if (!data) {
    return <div style={{ padding: 24, color: '#86909C' }}>加载中...</div>;
  }

  // 构造 tradeDate 格式(yy/mm/dd)
  const tradeDateDash = data.meta.tradeDate;
  const y = tradeDateDash.slice(2, 4);
  const m = tradeDateDash.slice(4, 6);
  const d = tradeDateDash.slice(6, 8);
  const tradeDateSlash = `${y}/${m}/${d}`;
  const generatedTime = data.meta.generatedAt.split(' ')[1]?.slice(0, 5) || '';

  return (
    <div>
      <PageHeader
        title="盘前扫描"
        tradeDateSlash={tradeDateSlash} _originalTradeDate={data.meta.tradeDate}

        liveTag="隔夜数据"
        liveColor="#1890FF"
        // 用户 #19 反馈:背景色改同色系浅蓝色
        liveBg="rgba(24, 144, 255, 0.1)"
        subtitle={`全球资产联动 · 隔夜美股/汇率/大宗商品 · 上次更新 ${generatedTime}`}
        lastUpdatedAt={useLive().fetchedAt}
      />

      {/* 风险提示卡片 */}
      {data.riskText.length > 0 && (
        <div
          style={{
            display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16,
          }}
        >
          {data.riskText.map((t, i) => (
            <div
              key={i}
              style={{
                background: t.includes('压制') || t.includes('弱势') ? '#FFF1F0' : '#F6FFED',
                border: `1px solid ${t.includes('压制') || t.includes('弱势') ? '#FFA39E' : '#B7EB8F'}`,
                borderRadius: 8, padding: '10px 16px',
                color: t.includes('压制') || t.includes('弱势') ? '#CF1322' : '#389E0D',
                fontSize: 13,
              }}
            >
              {t}
            </div>
          ))}
        </div>
      )}

      {/* 全球资产卡片 — 复用 Overview 指数卡片样式(同卡片/同字号/同 6 列) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(6, minmax(0, 1fr))',
        gap: isMobile ? 10 : 16,
        marginBottom: 20,
        width: '100%',
      }}>
        {data.assets.map((a) => {
          const changeAmount = a.price * a.changePct / 100;  // 美股无涨跌额字段,自行换算
          return (
            <div
              key={a.code}
              style={{
                background: '#fff',
                borderRadius: 14,
                padding: '14px 16px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 30px 5px rgba(0,0,0,0.02)',
                border: '1px solid #E5E7EB',
                boxSizing: 'border-box',
                minWidth: 0,
              }}
            >
              {/* 名称 + 涨跌幅 badge */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>{a.name}</span>
                <span style={{
                  fontSize: 13,
                  color: a.changePct > 0 ? COLOR_UP : a.changePct < 0 ? COLOR_DOWN : '#9CA3AF',
                  background: a.changePct > 0 ? 'rgba(255, 77, 79, 0.08)'
                    : a.changePct < 0 ? 'rgba(14, 205, 112, 0.08)'
                    : 'rgba(156, 163, 175, 0.08)',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontWeight: 700,
                  minWidth: 56,
                  textAlign: 'center',
                }}>
                  {a.changePct >= 0 ? '+' : ''}{a.changePct.toFixed(2)}%
                </span>
              </div>
              {/* 现价 + 涨跌箭头 */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: '#1F2329', lineHeight: 1.2 }}>
                  {a.price > 100 ? a.price.toFixed(2) : a.price.toFixed(4)}
                </span>
                <span style={{
                  fontSize: 16, fontWeight: 700,
                  color: a.changePct > 0 ? COLOR_UP : a.changePct < 0 ? COLOR_DOWN : '#9CA3AF',
                }}>
                  {a.changePct > 0 ? '↑' : a.changePct < 0 ? '↓' : '–'}
                </span>
              </div>
              {/* 涨跌额 + 代码 */}
              <div style={{ fontSize: 12, color: '#86909C', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 500, color: changeAmount >= 0 ? COLOR_UP : COLOR_DOWN }}>
                  {changeAmount >= 0 ? '+' : ''}{changeAmount.toFixed(2)}
                </span>
                <span>{a.code}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 全球资产联动比价图 */}
      <Card bodyStyle={{ padding: 20 }} style={{ borderRadius: 14, marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#1F2329' }}>全球资产联动比价图</span>
          <span style={{ fontSize: 11, color: '#86909C', marginLeft: 12 }}>
            以 24 小时前价格 = 0% 基准 · 当前价相对偏离百分比
          </span>
        </div>
        <ReactECharts option={chartOption} style={{ height: 360 }} />
        <div style={{ marginTop: 12, fontSize: 12, color: '#86909C', padding: '8px 12px', background: '#F5F6F8', borderRadius: 6 }}>
          <b>相关性预警:</b>USDCNH 离岸人民币过去 12 小时斜率 &gt; 0.3% (贬值) 且 A50 期货跌幅 &gt; 0.5%,系统变量 <code style={{ color: COLOR_UP }}>IsOverseasBearish = True</code>。
          <br />过去 3 个月,人民币贬值超 300 基点时,次日北向资金净流出概率为 <b style={{ color: COLOR_DOWN }}>78%</b>。
        </div>
      </Card>
    </div>
  );
}
