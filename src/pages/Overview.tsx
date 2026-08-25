import { useState, useMemo, useEffect } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';
import ReactECharts from 'echarts-for-react';
import ColorText from '../components/ColorText';
import {
  COLOR_UP, COLOR_DOWN, COLOR_FLAT, COLOR_TEXT,
} from '../utils/format';
import type { ReportData } from '../data/loader';
import type { HistoryPoint } from '../types';
import { useLive } from '../App';
import { ChangeDistributionCard } from '../components/ChangeDistributionCard';
import { MarginHistoryCard } from '../components/MarginHistoryCard';
import { useEchartsResize } from '../hooks/useEchartsResize';

// 前 2 个曲线图:7/15/30 日(去掉 60/90)
// 涨跌停家数:7/15 日(原限制)
const RANGE_OPTIONS_3 = [
  { label: '7日', value: 7 },
  { label: '15日', value: 15 },
  { label: '30日', value: 30 },
];
const RANGE_OPTIONS_LIMIT = [
  { label: '7日', value: 7 },
  { label: '15日', value: 15 },
];

// 28 个申万一级行业(用户 #1 反馈:方案 C 热力图)
// ths 90 个细分类 → sw 28 一级分类映射(基于 ths name 关键词)
function classifySW28(thsName: string): string | null {
  if (thsName.includes('煤炭')) return '煤炭';
  if (thsName.includes('石油') || thsName.includes('石化')) return '石油石化';
  if (thsName.includes('钢铁')) return '钢铁';
  if (thsName.includes('贵金属') || thsName.includes('小金属') || thsName.includes('工业金属') || thsName.includes('能源金属')) return '有色金属';
  if (thsName.includes('元件') || thsName.includes('半导体') || thsName.includes('光学') || thsName.includes('消费电子') || thsName.includes('其他电子')) return '电子';
  if (thsName.includes('通信设备') || thsName.includes('通信服务')) return '通信';
  if (thsName.includes('计算机') || thsName.includes('IT服务') || thsName.includes('软件')) return '计算机';
  if (thsName.includes('银行')) return '银行';
  if (thsName.includes('保险') || thsName.includes('证券') || thsName.includes('多元金融')) return '非银金融';
  if (thsName.includes('房地产')) return '房地产';
  if (thsName.includes('汽车')) return '汽车';
  if (thsName.includes('医药') || thsName.includes('中药') || thsName.includes('化学制药') || thsName.includes('生物') || thsName.includes('医疗器械') || thsName.includes('医疗服务')) return '医药生物';
  if (thsName.includes('白酒') || thsName.includes('酒') || thsName.includes('饮料') || thsName.includes('食品') || thsName.includes('乳品')) return '食品饮料';
  if (thsName.includes('家电') || thsName.includes('家居') || thsName.includes('厨卫')) return '家用电器';
  if (thsName.includes('建材') || thsName.includes('水泥')) return '建筑材料';
  if (thsName.includes('建筑') || thsName.includes('装饰') || thsName.includes('工程')) return '建筑装饰';
  if (thsName.includes('化工') || thsName.includes('化学') || thsName.includes('农化')) return '基础化工';
  if (thsName.includes('农林') || thsName.includes('种植') || thsName.includes('林业') || thsName.includes('渔业') || thsName.includes('养殖') || thsName.includes('农产品')) return '农林牧渔';
  if (thsName.includes('服装') || thsName.includes('纺织')) return '纺织服饰';
  if (thsName.includes('造纸') || thsName.includes('包装') || thsName.includes('印刷')) return '轻工制造';
  if (thsName.includes('环保') || thsName.includes('水务') || thsName.includes('环境')) return '环保';
  // v2.0.7gj:电池/光伏/风电/电网/电机 归「电力设备」(原误归公用事业/机械设备)
  if (thsName.includes('电池') || thsName.includes('光伏') || thsName.includes('风电') || thsName.includes('电网') || thsName.includes('电机') || thsName.includes('电气')) return '电力设备';
  if (thsName.includes('电力') || thsName.includes('燃气')) return '公用事业';
  if (thsName.includes('航空') || thsName.includes('机场') || thsName.includes('港口') || thsName.includes('航运') || thsName.includes('物流') || thsName.includes('铁路') || thsName.includes('公路') || thsName.includes('交通运输')) return '交通运输';
  if (thsName.includes('零售') || thsName.includes('贸易') || thsName.includes('商业')) return '商贸零售';
  // v2.0.7gj:传媒/游戏/影视/互联网 归「传媒」(原误归社会服务)
  if (thsName.includes('传媒') || thsName.includes('游戏') || thsName.includes('影视') || thsName.includes('互联网') || thsName.includes('出版') || thsName.includes('广告')) return '传媒';
  if (thsName.includes('旅游') || thsName.includes('酒店') || thsName.includes('餐饮') || thsName.includes('教育') || thsName.includes('体育')) return '社会服务';
  if (thsName.includes('机械') || thsName.includes('设备') || thsName.includes('自动化') || thsName.includes('专用') || thsName.includes('通用')) return '机械设备';
  if (thsName.includes('军工') || thsName.includes('国防')) return '国防军工';
  if (thsName.includes('美容') || thsName.includes('护理')) return '美容护理';
  if (thsName.includes('综合')) return '综合';
  if (thsName.includes('橡胶') || thsName.includes('塑料')) return '基础化工';
  if (thsName.includes('油气')) return '石油石化';
  if (thsName.includes('厨卫')) return '家用电器';
  if (thsName.includes('其他社会服务')) return '社会服务';
  return null;
}

// 用户 #6 反馈:box-shadow 改 0 1px 3px rgba(0,0,0,0.04), 0 0 30px 5px rgba(0,0,0,0.02)
// 用户 #18 反馈:白色卡片圆角 14px
const CARD_SHADOW = '0 1px 3px rgba(0, 0, 0, 0.04), 0 0 30px 5px rgba(0, 0, 0, 0.02)';

// 响应式:前 2 个图表卡 width 100% 自适应,不溢出
const overviewStyle = `
  /* 间距 16px(原 12px + 4px) */
  .overview-stats-row { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
  .overview-indices-row { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 16px; margin-bottom: 20px; }
  /* v2.0.7ei:6 图表响应式 — 1800px+ 3 列 / ≤1800 2 列 / ≤1200 1 列 */
  .overview-charts-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; width: 100%; }
  /* v2.0.7ej:6 图表合并 1 个 grid 容器(成交量/涨/跌家数/涨/跌停家数/热力图/涨跌分布/融资流向) */
  .overview-charts-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; width: 100%; }
  .overview-chart-card { min-width: 0; overflow: hidden; min-height: 360px; }
  .stat-card, .index-card {
    background: #fff;
    border-radius: 14px;
    padding: 14px 16px;
    box-shadow: ${CARD_SHADOW};
    border: 1px solid #E5E7EB;
    box-sizing: border-box;
    min-width: 0;
  }
  @media (max-width: 1800px) {
    .overview-charts-row { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
    .overview-charts-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  }
  @media (max-width: 1400px) {
    .overview-indices-row { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
  }
  @media (max-width: 1200px) {
    .overview-charts-row { grid-template-columns: minmax(0, 1fr) !important; }
    .overview-charts-grid { grid-template-columns: minmax(0, 1fr) !important; }
  }
  @media (max-width: 1100px) {
    .overview-stats-row { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
  }
  @media (max-width: 700px) {
    .overview-stats-row { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  }
  /* v2.0.7fd:移动端 768px — 1 列紧凑(PC ≥ 769px 零影响) */
  @media (max-width: 768px) {
    .overview-stats-row { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 10px !important; }
    .overview-indices-row { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 10px !important; }
    .overview-charts-row, .overview-charts-grid { grid-template-columns: minmax(0, 1fr) !important; gap: 10px !important; }
    .overview-chart-card { min-height: 280px !important; }
  }
`;
export function OverviewStyles() { return <style>{overviewStyle}</style>; }

function RangeTabs({ value, onChange, options }: { value: number; onChange: (v: number) => void; options: { label: string; value: number }[] }) {
  return (
    <div style={{ display: 'inline-flex', background: '#F5F6F8', borderRadius: 6, padding: 2, gap: 2 }}>
      {options.map((r) => (
        <button
          key={r.value}
          onClick={() => onChange(r.value)}
          style={{
            border: 'none',
            background: value === r.value ? '#fff' : 'transparent',
            color: value === r.value ? '#111827' : '#86909C',
            fontWeight: value === r.value ? 600 : 400,
            fontSize: 12,
            padding: '4px 10px',
            borderRadius: 4,
            cursor: 'pointer',
            boxShadow: value === r.value ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            transition: 'all .15s',
          }}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

export default function Overview({ data }: { data: ReportData }) {
  // data 已经是 App.tsx 合并 live 后的 mergedData,直接用
  const { marketOverview: idx, history } = data;
  // v2.0.8gj:沪深300 挪到第一行尾部,第二行其余指数(上证/深证/创业板/北证50/科创50/微盘)按原顺序
  const hs300Index = idx.indices.find((it) => it.name === '沪深300');
  const row2Indices = idx.indices.filter((it) => it.name !== '沪深300');

  // v2.0.7fv:L5 修 — 删 30s 重复拉 data.json — App.tsx 已经在 60s 拉,这里再 30s 拉完全没 setState 浪费带宽
  // v2.0.7fv:L6 修 — liveAgoSec 不会自动 tick,加个 1s setState 让 "X 秒前更新" 实时
  const [, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  // v2.0.7fh:user #7 — 监听 window resize 触发所有 echarts resize(避免移动→PC 拉宽图表不变)
  useEchartsResize();
  const [volRange, setVolRange] = useState(7);
  const [udRange, setUdRange] = useState(7);
  const [ldRange, setLdRange] = useState(7);

  // 公共动画:从左到右渐入展开(用户 #3)
  // 用户 #13 反馈:曲线图动画速度 ×1.5(原 1500ms → 1000ms)
  const animCfg = {
    animation: true,
    animationDuration: 1000,
    animationDurationUpdate: 333,
    animationEasing: 'cubicOut' as const,
    animationEasingUpdate: 'cubicOut' as const,
    animationDelay: (idx: number) => idx * 20,
    animationDelayUpdate: 0,
  };

  // 1. 成交量折线图
  const volChart = useMemo(() => {
    const hist = sliceHistory(volRange);
    const dates = hist.map((h: HistoryPoint) => {
      const d = new Date(h.date);
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    const values = hist.map((h: HistoryPoint) => Math.round((h.volume / 10000) * 100) / 100);
    return {
      ...animCfg,
      grid: { top: 30, right: 20, left: 50, bottom: 30, containLabel: false },
      tooltip: { trigger: 'axis', formatter: (params: any) => {
        const p = params[0];
        return `<div style="color:#111827;font-weight:700;font-size:13px;margin-bottom:4px;">${p.name}</div><div style="color:${COLOR_UP};font-weight:700;font-size:13px;">成交: ${p.value}万亿</div>`;
      } },
      xAxis: {
        type: 'category', data: dates,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#86909C', fontSize: 11 },
        boundaryGap: ['5%', '5%'],
      },
      yAxis: {
        type: 'value', axisLine: { show: false },
        splitLine: { lineStyle: { color: '#F0F0F0', type: 'dashed' } },
        axisLabel: { color: '#86909C', fontSize: 11, formatter: '{value}万亿' },
      },
      series: [{
        name: '成交量', type: 'line', data: values,
        symbol: 'circle', symbolSize: 9,
        smooth: true,
        lineStyle: { color: COLOR_UP, width: 3 },
        itemStyle: { color: COLOR_UP, borderColor: '#fff', borderWidth: 2 },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(255, 77, 79, 0.18)' }, { offset: 1, color: 'rgba(255, 77, 79, 0.02)' }] } },
      }],
    };
  }, [volRange, history]);

  // 2. 涨跌家数折线图
  const udChart = useMemo(() => {
    const hist = sliceHistory(udRange);
    const dates = hist.map((h: HistoryPoint) => {
      const d = new Date(h.date);
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    // v2.0.7eg:末点 0 时 fallback marketOverview 真值
    // — 之前 fetch-data history 末点(8/19)up=0, down=0 → 曲线图最右点掉到 0
    // — 用 idx.upCount / idx.downCount(第一排卡片值)覆盖
    const lastUp = data.marketOverview.upCount || 0;
    const lastDown = data.marketOverview.downCount || 0;
    const upData = hist.map((h: HistoryPoint, i: number) => {
      if (i === hist.length - 1 && (h.up === 0 || h.up == null) && lastUp > 0) return lastUp;
      return h.up;
    });
    const downData = hist.map((h: HistoryPoint, i: number) => {
      if (i === hist.length - 1 && (h.down === 0 || h.down == null) && lastDown > 0) return lastDown;
      return h.down;
    });
    return {
      ...animCfg,
      grid: { top: 40, right: 20, left: 50, bottom: 30 },
      legend: { show: true, top: 5, right: 10, textStyle: { color: '#4E5969', fontSize: 12 }, itemWidth: 12, itemHeight: 8, itemGap: 16 },
      tooltip: { trigger: 'axis', formatter: (params: any) => {
        let html = `<div style="color:#111827;font-weight:700;font-size:13px;margin-bottom:4px;">${params[0].name}</div>`;
        params.forEach((p: any) => {
          const c = p.seriesName === '上涨家数' ? COLOR_UP : COLOR_DOWN;
          html += `<div style="color:${c};font-weight:700;font-size:13px;margin:2px 0;">${p.marker} ${p.seriesName}: ${p.value}</div>`;
        });
        return html;
      } },
      xAxis: {
        type: 'category', data: dates,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#86909C', fontSize: 11 },
        boundaryGap: ['5%', '5%'],
      },
      yAxis: { type: 'value', axisLine: { show: false }, splitLine: { lineStyle: { color: '#F0F0F0', type: 'dashed' } }, axisLabel: { color: '#86909C', fontSize: 11 } },
      series: [
        { name: '上涨家数', type: 'line', data: upData, symbol: 'circle', symbolSize: 9, smooth: true, lineStyle: { color: COLOR_UP, width: 3 }, itemStyle: { color: COLOR_UP, borderColor: '#fff', borderWidth: 2 } },
        { name: '下跌家数', type: 'line', data: downData, symbol: 'circle', symbolSize: 9, smooth: true, lineStyle: { color: COLOR_DOWN, width: 3 }, itemStyle: { color: COLOR_DOWN, borderColor: '#fff', borderWidth: 2 } },
      ],
    };
  }, [udRange, history, data.marketOverview.upCount, data.marketOverview.downCount]);

  // 4. 申万一级行业涨跌幅(v2.0.4:照抄用户附件 — treemap 不同面积 + 7 档色)
  // ths 90 个 → sw 28 一级映射
  const swList = useMemo(() => {
    const swGroups: Record<string, { sumPct: number; weight: number; names: string[] }> = {};
    for (const s of data.sectors) {
      const sw = classifySW28(s.name);
      if (!sw) continue;
      if (!swGroups[sw]) swGroups[sw] = { sumPct: 0, weight: 0, names: [] };
      const w = s.totalTurnover || 1;
      swGroups[sw].sumPct += s.changePercent * w;
      swGroups[sw].weight += w;
      swGroups[sw].names.push(s.name);
    }
    // v2.0.4:全部 28 个 sw 行业,按 weight 排(treemap 自动排面积)
    return Object.entries(swGroups)
      .filter(([, v]) => v.weight > 0)
      .map(([sw, v]) => ({ sw, avgPct: Math.round((v.sumPct / v.weight) * 100) / 100, weight: v.weight, names: v.names }))
      .sort((a, b) => b.weight - a.weight);
  }, [data.sectors]);

  // v2.0.6:7 档色(用户指定阈值 + 色值)—— 严格按 sw 行业平均涨跌幅
  // +5%(含)以上 / +2%~+5% / 0%~+2% / 0%(含) / 0%~-2% / -2%~-5% / -5%(含)以上
  const colorBy = (pct: number) => {
    if (pct >= 5) return '#F63638';         // +5%(含)以上 深红
    if (pct >= 2) return '#BF4044';         // +2% ~ +5% 中红
    if (pct > 0) return '#8C444F';          // 0% ~ +2% 暗红棕
    if (pct === 0) return '#424455';        // = 0%(含) 深灰
    if (pct > -2) return '#36764D';         // 0% ~ -2% 暗绿
    if (pct > -5) return '#2E9D50';         // -2% ~ -5% 中绿
    return '#31CC5B';                        // < -5% 亮绿
  };
  // 7 档图例数据(从大到小 = 从最正到最负) — v2.0.7g:用户要求色块文字改简洁
  const heatLegend = [
    { color: '#F63638', label: '+5%' },
    { color: '#BF4044', label: '+3%' },
    { color: '#8C444F', label: '+1%' },
    { color: '#424455', label: '0%' },
    { color: '#36764D', label: '-1%' },
    { color: '#2E9D50', label: '-3%' },
    { color: '#31CC5B', label: '-5%' },
  ];
  const treemapChart = useMemo(() => {
    return {
      animation: true,
      animationDuration: 600,
      // v2.0.5 修复:不加灰底,白底透 Card 背景
      tooltip: {
        backgroundColor: '#fff', borderColor: '#E5E6EB', borderWidth: 1,
        textStyle: { color: '#111827', fontSize: 12 },
        formatter: (p: any) => {
          // 通过 name 找回对应 sw 行业
          const s = swList.find(x => x.sw === p.name);
          if (!s) return '';
          const isUp = s.avgPct > 0, isDown = s.avgPct < 0;
          const c = isUp ? COLOR_UP : isDown ? COLOR_DOWN : '#999';
          const sign = isUp ? '+' : '';
          return `<div style="font-weight:600;color:#111827;font-size:13px;margin-bottom:4px;">${s.sw}</div><div style="font-weight:700;color:${c};font-size:14px;">${sign}${s.avgPct.toFixed(2)}%</div><div style="color:#86909C;font-size:11px;margin-top:2px;">含 ${s.names.join(' / ')}</div>`;
        },
      },
      series: [{
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: '100%', height: 360,
        top: 0, left: 0, right: 0, bottom: 0,
        // v2.0.5:treemap squarify 自动布局(用户附件:大 cell 左上,小 cell 填右下)
        squareRatio: 1,
        leafDepth: 1,
        // v2.0.5 修复:cell 缝 = 纯白 1-2px(用户附件风格),白底透出
        levels: [{
          itemStyle: { borderColor: '#fff', borderWidth: 1, gapWidth: 1 },
        }],
        // v2.0.5:label 名 + 涨跌幅两行(用户附件风格),白字 + 阴影
        label: {
          show: true,
          color: '#fff',
          textShadowColor: 'rgba(0,0,0,0.55)',
          textShadowBlur: 2,
          textShadowOffsetY: 1,
          formatter: (p: any) => {
            const v = p.data?.avgPct ?? 0;
            const sign = v > 0 ? '+' : '';
            return `${p.name}\n${sign}${v.toFixed(2)}%`;
          },
        },
        // v2.0.5:labelLayout 按 cell 面积算字号(用户附件:大 cell 大字,小 cell 小字)
        labelLayout: (params: any) => {
          const rect = params.rect;
          const min = Math.min(rect.width, rect.height);
          let fontSize = 12;
          if (min < 45) fontSize = 9;
          else if (min < 70) fontSize = 10;
          else if (min < 110) fontSize = 11;
          else if (min < 170) fontSize = 12;
          else if (min < 240) fontSize = 13;
          else fontSize = 15;
          // 极小 cell(< 30px) 文字可能被截,改用单行居中
          if (min < 32) {
            return {
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              fontSize,
              verticalAlign: 'middle',
              align: 'center',
              lineHeight: fontSize + 1,
            };
          }
          return {
            x: rect.x + 5,
            y: rect.y + 5,
            fontSize,
            verticalAlign: 'top',
            align: 'left',
            lineHeight: fontSize + 2,
          };
        },
        upperLabel: { show: false },
        // v2.0.5 修复:cell 缝 = 纯白 1px,7 档色按 sw 行业平均涨跌幅
        itemStyle: { borderColor: '#fff', borderWidth: 1, gapWidth: 1 },
        data: swList.map((s) => ({
          name: s.sw,
          // value = weight 排面积(大行业面积大)
          value: s.weight,
          avgPct: s.avgPct,
          names: s.names,
          itemStyle: { color: colorBy(s.avgPct) },
        })),
      }],
    };
  }, [swList]);

  // 3. 涨跌停家数折线图
  const ldChart = useMemo(() => {
    const hist = sliceHistory(ldRange);
    const dates = hist.map((h: HistoryPoint) => {
      const d = new Date(h.date);
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    // v2.0.7gj:末点强制用涨跌停比卡片真值(涨停池封板/跌停池),跟卡片完全一致
    const lastUp = data.marketOverview.limitUpCount || 0;
    const lastDown = data.marketOverview.limitDownCount || 0;
    const upData = hist.map((h: HistoryPoint, i: number) => {
      if (i === hist.length - 1) return lastUp;
      return h.limitUp;
    });
    const downData = hist.map((h: HistoryPoint, i: number) => {
      if (i === hist.length - 1) return lastDown;
      return h.limitDown;
    });
    return {
      ...animCfg,
      grid: { top: 40, right: 20, left: 50, bottom: 30 },
      legend: { show: true, top: 5, right: 10, textStyle: { color: '#4E5969', fontSize: 12 }, itemWidth: 12, itemHeight: 8, itemGap: 16 },
      tooltip: { trigger: 'axis', formatter: (params: any) => {
        let html = `<div style="color:#111827;font-weight:700;font-size:13px;margin-bottom:4px;">${params[0].name}</div>`;
        params.forEach((p: any) => {
          const c = p.seriesName === '涨停家数' ? COLOR_UP : COLOR_DOWN;
          html += `<div style="color:${c};font-weight:700;font-size:13px;margin:2px 0;">${p.marker} ${p.seriesName}: ${p.value}</div>`;
        });
        return html;
      } },
      xAxis: {
        type: 'category', data: dates,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#86909C', fontSize: 11 },
        boundaryGap: ['5%', '5%'],
      },
      yAxis: { type: 'value', axisLine: { show: false }, splitLine: { lineStyle: { color: '#F0F0F0', type: 'dashed' } }, axisLabel: { color: '#86909C', fontSize: 11 } },
      series: [
        { name: '涨停家数', type: 'line', data: upData, symbol: 'circle', symbolSize: 9, smooth: true, lineStyle: { color: COLOR_UP, width: 3 }, itemStyle: { color: COLOR_UP, borderColor: '#fff', borderWidth: 2 } },
        { name: '跌停家数', type: 'line', data: downData, symbol: 'circle', symbolSize: 9, smooth: true, lineStyle: { color: COLOR_DOWN, width: 3 }, itemStyle: { color: COLOR_DOWN, borderColor: '#fff', borderWidth: 2 } },
      ],
    };
  }, [ldRange, history, data.marketOverview.limitUpCount, data.marketOverview.limitDownCount]);


  return (
    <div>
      <OverviewStyles />
      <PageHeader
        title="大盘总览"
        tradeDateSlash={idx.tradeDateSlash} _originalTradeDate={idx.tradeDate}

        subtitle="盘后深度复盘 · 大盘快照 + 多日趋势"
        lastUpdatedAt={useLive().fetchedAt}
      />

      {/* 第一行:6 张卡 — 成交量 / 上涨家数 / 下跌家数 / 涨跌停比 / 可转债 / ETF */}
      <div className="overview-stats-row">
        <StatCard label="成交量" value={idx.marketTurnover} suffix="亿"
          subLeft="较上一日增量" subValue={idx.turnoverDiff} suffix2="亿" subValueColor="updown" />
        {/* v2.0.8gj:合并"上涨家数"+"下跌家数"为一张"涨/跌家数"卡,第3行仅保留"平盘 xxx" */}
        <StatCard
          label="涨/跌家数"
          value={null}
          customValue={
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
              <span style={{ color: COLOR_UP, fontSize: 26, fontWeight: 700 }}>{idx.upCount}</span>
              <span style={{ color: '#C9CDD4', fontSize: 22, fontWeight: 400 }}>:</span>
              <span style={{ color: COLOR_DOWN, fontSize: 26, fontWeight: 700 }}>{idx.downCount}</span>
            </span>
          }
          subLeft="平盘" subText={idx.flatCount}
        />
        <StatCard
          label="涨跌停比"
          value={null}
          customValue={
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
              <span style={{ color: COLOR_UP, fontSize: 26, fontWeight: 700 }}>{idx.limitUpCount}</span>
              <span style={{ color: '#C9CDD4', fontSize: 22, fontWeight: 400 }}>:</span>
              <span style={{ color: COLOR_DOWN, fontSize: 26, fontWeight: 700 }}>{idx.limitDownCount}</span>
            </span>
          }
        />
        {/* 可转债涨跌分布:主体=可转债涨/跌,左下=可转债对应正股涨/跌(用户 #3 反馈修正) */}
        <BondsCard
          bondUp={idx.bondUp || 0}
          bondDown={idx.bondDown || 0}
          stockUp={idx.bondStockUp || 0}
          stockDown={idx.bondStockDown || 0}
        />
        {/* ETF 涨跌分布 */}
        <ETFCard
          etfUp={idx.etfUp || 0}
          etfDown={idx.etfDown || 0}
          etfFlat={idx.etfFlat || 0}
        />
        {/* v2.0.8gj:沪深300 指数卡挪到第一行第6位置 */}
        {hs300Index && <IndexCard it={hs300Index} />}
      </div>

      {/* 第二行:6 个指数(不含沪深300,已挪到第一行尾部) */}
      <div className="overview-indices-row">
        {row2Indices.map((it) => (
          <IndexCard key={it.name} it={it} />
        ))}
      </div>

      {/* v2.0.7ej:6 图表合并到 1 个 grid 容器 — 响应式 3/2/1 列
          — 1800+ 时 1 行 3 列(2 行 × 3 列 = 6 图)
          — ≤1800 时 1 行 2 列(3 行 × 2 列 = 6 图)
          — ≤1200 时 1 行 1 列(6 行 × 1 列) */}
      <div className="overview-charts-grid">
        {/* 1. 成交量 */}
        <div className="overview-chart-card">
          <Card title="成交量(亿)" right={<RangeTabs value={volRange} onChange={setVolRange} options={RANGE_OPTIONS_3} />}>
            <ReactECharts key={volRange} option={volChart} style={{ height: 360, width: '100%' }} notMerge={true} lazyUpdate={true} />
          </Card>
        </div>
        {/* 2. 涨/跌家数 */}
        <div className="overview-chart-card">
          <Card title="涨/跌家数" right={<RangeTabs value={udRange} onChange={setUdRange} options={RANGE_OPTIONS_3} />}>
            <ReactECharts key={udRange} option={udChart} style={{ height: 360, width: '100%' }} notMerge={true} lazyUpdate={true} />
          </Card>
        </div>
        {/* 3. 涨/跌停家数 */}
        <div className="overview-chart-card">
          <Card title="涨/跌停家数" right={<RangeTabs value={ldRange} onChange={setLdRange} options={RANGE_OPTIONS_LIMIT} />}>
            <ReactECharts key={ldRange} option={ldChart} style={{ height: 360, width: '100%' }} notMerge={true} lazyUpdate={true} />
          </Card>
        </div>
        {/* 4. 市场行情热力图 */}
        <div className="overview-chart-card">
          <Card
            title="市场行情热力图(按行业成交量排序)"
            right={
              // v2.0.6:右上角 7 档色图例 — 每个色块作为百分比范围的背景,白字写在色块上
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', maxWidth: 520, justifyContent: 'flex-end' }}>
                {heatLegend.map((l) => (
                  <span
                    key={l.label}
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      background: l.color,
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 3,
                      lineHeight: '16px',
                      letterSpacing: 0.2,
                    }}
                  >
                    {l.label}
                  </span>
                ))}
              </div>
            }
          >
            {/* v2.0.6:7 档色严格按用户给的色值,28 cell 按 sw 行业平均涨跌幅映射 */}
            <ReactECharts option={treemapChart} style={{ height: 360, width: '100%' }} notMerge={true} lazyUpdate={true} />
          </Card>
        </div>
        {/* 5. 涨跌分布 */}
        <div className="overview-chart-card">
          <Card title="涨跌分布">
            <ChangeDistributionCard data={data} />
          </Card>
        </div>
        {/* 6. 融资流向 */}
        <div className="overview-chart-card">
          <Card
            title="融资流向"
            right={<MarginBadge data={data} />}
          >
            <MarginHistoryCard data={data} />
          </Card>
        </div>
      </div>
    </div>
  );

  // v2.0.7cq:过滤周末(周六/周日)+ 节假日占位(A 股交易日),避免 baseData 周末 stale 数据污染图表
  // — baseData 周末没刷新,history 末 1/2 条会是周六/周日的 0 数据(或 weekend 量)
  // — 8/15 周六(2026)被 user 反馈:图表显示 0:0 tooltip,看起来是 "数据缺失"
  // — 过滤后图表只显示真实交易日,周末/节假日自动跳过
  // v2.0.7ff:按"自然日"切片(user 反馈 "30日" 应是近 30 个日历日,允许跨月 + 周末断点)
  // — 之前 slice(-range) 是取最后 N 个交易日,history 只有 19 天时 "30日" 实际只显示 19 天
  // — 现在取 (today - range 天) ~ today 所有 history 记录,周末/缺失自然断点
  function sliceHistory(range: number) {
    const today = new Date();
    const cutoff = new Date(today);
    cutoff.setDate(today.getDate() - range);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return history.filter((h: HistoryPoint) => h.date >= cutoffStr);
  }
}

// ====== 时间判断(盘中/收盘)— v1.9.1:只保留 2 个状态 ======
// v2.0.7dh:用东八区时间(跟 isLiveMarket 一致)— 海外 user 浏览器(UTC)判断错
// v2.0.7dj:加 9:30-10:00 早盘限流期 → 显示 "盘中实时数据将在10:00后逐步更新"
//  — 之前 9:30-10:00 显示"盘中实时数据",但 em/akshare 限流严,user 看到 baseData 困惑
//  — 改后:明确告知 user 限流期 + 等 10:00 cron 跑
export function getMarketSession(): { label: string; color: string; bg: string } {
  // v2.0.7dh:用东八区时间
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const day = d.getUTCDay();
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const mins = h * 60 + m;
  // 周末 → 收盘复盘
  if (day === 0 || day === 6) {
    return { label: '收盘复盘数据', color: '#4b5563', bg: '#F0F1F2' };
  }
  // v2.0.7dj:早盘限流期 9:30-10:00 → 限流提示(等 10:00 cron 跑 + em 限流恢复)
  if (mins >= 9 * 60 + 30 && mins < 10 * 60) {
    return { label: '盘中实时数据将在10:00后逐步更新', color: '#ff4d4f', bg: 'rgba(255, 77, 79, 0.1)' };
  }
  // 交易时段 10:00 ~ 15:00 → 盘中实时(em 限流恢复)
  if (mins >= 10 * 60 && mins < 15 * 60) {
    return { label: '盘中实时数据', color: '#ff4d4f', bg: 'rgba(255, 77, 79, 0.1)' };
  }
  // 其他时间(10:00 前 / 15:00 后 / 中午) → 收盘复盘
  return { label: '收盘复盘数据', color: '#4b5563', bg: '#F0F1F2' };
}

// ====== 共享组件 ======
// v2.0.7df-fix:盘后用当前时间显示(不用 generatedAt)— 父组件不再传 generatedAt prop
export function PageHeader({ title, tradeDateSlash, subtitle, liveTag, liveColor, liveBg, lastUpdatedAt, _originalTradeDate }: {
  title: string; tradeDateSlash: string; subtitle?: string; liveTag?: string; liveColor?: string; liveBg?: string; lastUpdatedAt?: number;
  // v2.0.7ar:可选的原始 tradeDate(YYYYMMDD)— 如果传,08:00 之后用 today 覆盖
  _originalTradeDate?: string;
}) {
  // v2.0.7fl:user 反馈 移动端顶部标题栏文字挤在一起 — 用 isMobile 改 column 布局(标题+tag 上,date+time 下)
  // — PC 端保持 flex row space-between(零变化)
  const _isMobile = useIsMobile();
  // 用户 #3 反馈:6 个表格"收盘复盘数据"标签文字色 #4b5563(原 #86909C)
  // 用户 #17 反馈:6 个表格复用大盘总览盘后灰色样式
  // 用户 #19 反馈:PreScan "隔夜数据" 背景用同色系浅蓝色
  // v1.9.1:6 个页面(连板天梯/跌停梯队/放量突破/突破前高/低位放量/龙虎榜)统一灰色 #4b5563 + #F0F1F2
  const session = liveTag ? null : getMarketSession();
  const finalTag = liveTag || session?.label;
  // 收盘复盘数据 / 隔夜数据 默认灰色
  const isGrayTag = liveTag === '收盘复盘数据' || liveTag === '隔夜数据';
  const finalColor = liveTag
    ? (liveColor ?? (isGrayTag ? '#4b5563' : COLOR_UP))
    : session?.color;
  const finalBg = liveTag
    ? (liveBg ?? (isGrayTag ? '#F0F1F2' : 'rgba(255, 77, 79, 0.1)'))
    : session?.bg;
  // 用户 #6 反馈:报告日期 + 生成时间 用东八区(Asia/Shanghai)时间显示
  // lastUpdatedAt 是 UTC 时间戳,需要 +8h 转换
  const toShanghaiHM = (utcTs: number) => {
    const d = new Date(utcTs + 8 * 3600 * 1000);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };
  // 显示"最后一次实时刷新时间"(用东八区)
  const displayTime = lastUpdatedAt
    ? toShanghaiHM(lastUpdatedAt)
    : (() => {
        // v2.0.7df-fix:盘后/无实时数据时显示当前时间(东八区),不是 data.json 的 generatedAt
        // 因为 generatedAt 是 fetch_real_data.py 跑时的时间(可能几小时前甚至昨天)
        // — user 期望看到"现在几点"才有用(不然 8/18 00:47 看到 8/17 19:07 感觉很奇怪)
        const now = new Date(Date.now() + 8 * 3600 * 1000);
        const yy = String(now.getUTCFullYear()).slice(2);
        const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(now.getUTCDate()).padStart(2, '0');
        const hh = String(now.getUTCHours()).padStart(2, '0');
        const min = String(now.getUTCMinutes()).padStart(2, '0');
        return `${yy}/${mm}/${dd} ${hh}:${min}`;
      })();
  // 报告日期:数据是 8.6 → 解析为东八区日期(数据元数据即交易日)
  const parseDate = (s: string) => {
    // tradeDateSlash 格式 'YY/MM/DD' 直接用
    if (s && /^\d{2}\/\d{2}\/\d{2}$/.test(s)) return s;
    return s;
  };
  // v2.0.7ar:08:00 之后,如果 data 是"昨天",显示 today(模拟新数据)
  let displayDate = parseDate(tradeDateSlash);
  if (_originalTradeDate) {
    const _now = new Date(Date.now() + 8 * 3600 * 1000);
    const _mins = _now.getUTCHours() * 60 + _now.getUTCMinutes();
    const _todayYMD = `${_now.getUTCFullYear()}${String(_now.getUTCMonth() + 1).padStart(2, '0')}${String(_now.getUTCDate()).padStart(2, '0')}`;
    if (_mins >= 8 * 60 && _originalTradeDate !== _todayYMD) {
      const yy = String(_now.getUTCFullYear()).slice(2);
      const mm = String(_now.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(_now.getUTCDate()).padStart(2, '0');
      displayDate = `${yy}/${mm}/${dd}`;
    }
  }
  // v1.9.8:实时状态指示(蓝点闪烁显示"实时刷新"中)
  const isLive = lastUpdatedAt && lastUpdatedAt > 0;
  const liveAgoSec = lastUpdatedAt ? Math.floor((Date.now() - lastUpdatedAt) / 1000) : -1;
  return (
    // v1.9.4 反馈 #5:标题+副标题作为整体固定悬浮在主区顶部,#F7F9FC 底
    // v1.9.8:paddingTop 20 替代原 marginTop -20,避免 sticky 区域出现"上方 20px 镂空"
    // v2.0.7fk:zIndex 100→1(蒙层 zIndex 99 > 1,抽屉打开时 PageHeader 被蒙层覆盖,不被穿透)
    <div style={{
      position: 'sticky', top: 0, zIndex: 1,
      background: '#F7F9FC',
      paddingTop: 20,
      paddingBottom: 12,
      marginBottom: 16,
    }}>
      {/* v2.0.7fl:user 反馈 移动端顶部标题栏文字挤在一起 — 移动端 flex column(标题+tag 上,实时+日期下)— PC 端 flex row space-between */}
      <div style={{ display: 'flex', alignItems: _isMobile ? 'flex-start' : 'center', flexDirection: _isMobile ? 'column' : 'row', justifyContent: 'space-between', marginBottom: 4, gap: _isMobile ? 6 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: _isMobile ? 16 : 20, fontWeight: 600, color: '#111827', margin: 0, whiteSpace: 'nowrap' }}>{title}</h2>
          {finalTag && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: _isMobile ? 10 : 11, color: finalColor, background: finalBg,
              padding: _isMobile ? '2px 6px' : '3px 8px', borderRadius: 10,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: finalColor }} />
              {finalTag}
            </span>
          )}
          {/* v2.0.7fn:user 反馈 移动端 副文本(subtitle)要在 标题 下方 — 移动端紧贴标题后,PC 端仍放在容器外底部 */}
          {_isMobile && subtitle && <div style={{ fontSize: 12, color: '#86909C' }}>{subtitle}</div>}
        </div>
        <div style={{ fontSize: _isMobile ? 11 : 12, color: '#86909C', display: 'flex', alignItems: 'center', gap: _isMobile ? 6 : 12, flexWrap: 'wrap' }}>
          {/* v1.9.8:实时状态指示 — 蓝点 + "X 秒前更新" 让用户感知数据在刷新 */}
          {isLive ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#0ecd70' }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: '#0ecd70',
                animation: 'fupan-live-pulse 1.5s infinite',
              }} />
              <span>实时</span>
              <span style={{ color: '#86909C' }}>· {liveAgoSec < 60 ? `${liveAgoSec}秒前更新` : `${Math.floor(liveAgoSec / 60)}分钟前更新`}</span>
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#86909C' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#bfbfbf' }} />
              <span>数据快照</span>
            </span>
          )}
          <span>·</span>
          <span>
            报告日期 <span style={{ color: '#111827', fontWeight: 500 }}>{displayDate}</span>
            <span style={{ margin: '0 8px' }}>·</span>
            生成时间 <span style={{ color: '#111827', fontWeight: 500 }}>{displayTime}</span>
          </span>
        </div>
      </div>
      {/* v2.0.7fn:PC 端 subtitle 保留在容器外底部(原设计)— 移动端不放这里(已挪到标题行右侧) */}
      {!_isMobile && subtitle && <div style={{ fontSize: 12, color: '#86909C' }}>{subtitle}</div>}
    </div>
  );
}

// 白色卡片:加浅灰外投影(用户 #18 反馈:全站圆角 14px + #6 反馈:box-shadow 改)
// 用户 #16 反馈:全站白色卡片加 1px solid #E5E7EB border
export function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 14,
      boxShadow: CARD_SHADOW,
      border: '1px solid #E5E7EB',
      padding: '16px 20px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, minHeight: 32 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

// v2.0.8gj:指数卡片(第一行沪深300 + 第二行 6 指数共用)
function IndexCard({ it }: { it: { name: string; point: number; changeAmount: number; changePercent: number; turnover: number } }) {
  return (
    <div className="index-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>{it.name}</span>
        <span className="index-pct-badge" style={{
          fontSize: 13,
          color: it.changePercent > 0 ? COLOR_UP : it.changePercent < 0 ? COLOR_DOWN : COLOR_FLAT,
          background: it.changePercent > 0 ? 'rgba(255, 77, 79, 0.08)'
            : it.changePercent < 0 ? 'rgba(14, 205, 112, 0.08)'
            : 'rgba(156, 163, 175, 0.08)',
          padding: '4px 10px', borderRadius: 6, fontWeight: 700, minWidth: 56, textAlign: 'center',
        }}>
          {it.changePercent > 0 ? '+' : ''}{it.changePercent.toFixed(2)}%
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 24, fontWeight: 700, color: COLOR_TEXT, lineHeight: 1.2 }}>{it.point.toFixed(2)}</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: it.changePercent > 0 ? COLOR_UP : it.changePercent < 0 ? COLOR_DOWN : COLOR_FLAT }}>
          {it.changePercent > 0 ? '↑' : it.changePercent < 0 ? '↓' : '–'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#86909C', display: 'flex', justifyContent: 'space-between' }}>
        <span><ColorText value={it.changeAmount} style={{ fontWeight: 500 }}>{it.changeAmount >= 0 ? '+' : ''}{it.changeAmount.toFixed(2)}</ColorText></span>
        <span>成交额 {Math.round(it.turnover)}亿</span>
      </div>
    </div>
  );
}

// 通用 StatCard
function StatCard({ label, value, subLeft, subValue, subText, suffix, suffix2, subValueColor = 'updown', valueColor, customValue }: {
  label: string;
  value?: number | string | null;
  customValue?: React.ReactNode;
  subLeft?: string;
  subValue?: number;
  subText?: number | string;
  suffix?: string;
  suffix2?: string;
  subValueColor?: 'updown' | 'uponly';
  valueColor?: string;
}) {
  let subColor = '#9ca3af';
  let subValueDisplay: React.ReactNode = null;
  if (subValue !== undefined && subValue !== null) {
    if (subValueColor === 'updown') {
      subColor = subValue > 0 ? COLOR_UP : subValue < 0 ? COLOR_DOWN : '#9ca3af';
      const sign = subValue > 0 ? '+' : '';
      subValueDisplay = <span style={{ color: subColor, fontWeight: 700 }}>{sign}{subValue}{suffix2 || ''}</span>;
    } else if (subValueColor === 'uponly') {
      subColor = COLOR_UP;
      subValueDisplay = <span style={{ color: subColor, fontWeight: 700 }}>+{subValue}{suffix2 || ''}</span>;
    }
  }
  return (
    <div className="stat-card">
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: valueColor || '#111827', lineHeight: 1.2 }}>
        {customValue !== undefined ? customValue : (value !== null && value !== undefined ? `${value}${suffix || ''}` : '-')}
      </div>
      {(subLeft || subValueDisplay || subText !== undefined) && (
        <div style={{ fontSize: 12, marginTop: 6, color: '#6b7280' }}>
          {subLeft && <span style={{ color: '#6b7280' }}>{subLeft} </span>}
          {subValueDisplay}
          {subText !== undefined && <span style={{ color: '#111827', fontWeight: 700 }}>{subText}</span>}
        </div>
      )}
    </div>
  );
}

// 可转债涨跌分布卡(用户 #5 + 反馈 #3 修正:正股=可转债对应正股的涨跌)
// 主体: 可转债 涨家数:跌家数
// 左下: 正股 涨家数:跌家数(320 只可转债对应的 320 个正股)
function BondsCard({ bondUp, bondDown, stockUp, stockDown }: { bondUp: number; bondDown: number; stockUp: number; stockDown: number }) {
  return (
    <div className="stat-card">
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>可转债涨跌分布</div>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ color: COLOR_UP }}>{bondUp}</span>
        <span style={{ color: '#C9CDD4', fontSize: 20, fontWeight: 400 }}>:</span>
        <span style={{ color: COLOR_DOWN }}>{bondDown}</span>
      </div>
      <div style={{ fontSize: 12, marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ color: '#6b7280' }}>正股</span>
        <span style={{ color: COLOR_UP, fontWeight: 700 }}>{stockUp}</span>
        <span style={{ color: '#C9CDD4' }}>:</span>
        <span style={{ color: COLOR_DOWN, fontWeight: 700 }}>{stockDown}</span>
      </div>
    </div>
  );
}

// ETF 涨跌分布卡(用户 #6)
// 主体: 涨家数:跌家数
// 左下: 平盘 平盘家数
function ETFCard({ etfUp, etfDown, etfFlat }: { etfUp: number; etfDown: number; etfFlat: number }) {
  return (
    <div className="stat-card">
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>场内ETF涨跌分布</div>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ color: COLOR_UP }}>{etfUp}</span>
        <span style={{ color: '#C9CDD4', fontSize: 20, fontWeight: 400 }}>:</span>
        <span style={{ color: COLOR_DOWN }}>{etfDown}</span>
      </div>
      <div style={{ fontSize: 12, marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ color: '#6b7280' }}>平盘</span>
        <span style={{ color: '#111827', fontWeight: 700 }}>{etfFlat}</span>
      </div>
    </div>
  );
}

// v2.0.7ad:融资卡片右上角徽章 — font-weight 500
function MarginBadge({ data }: { data: ReportData }) {
  const list = data.marketOverview.marginHistory;
  if (!list || list.length === 0) return null;
  const last = list[list.length - 1];
  const diff = last.margin_balance_diff;
  const md = last.date.slice(5);
  // v2.0.7eg:akshare 数据延迟 1 天(8/19 跑时末行 8/18)— 显示"昨值"提示
  const today = new Date(Date.now() + 8 * 3600 * 1000);
  const todayStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
  const isStale = last.date < todayStr;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px',
      background: 'rgba(255, 77, 79, 0.08)',
      color: '#ff4d4f',
      borderRadius: 4,
      fontSize: 12, fontWeight: 500, fontVariantNumeric: 'tabular-nums',
      lineHeight: 1.4,
    }}>
      <span>{md}{isStale ? ' 昨值' : ''}</span>
      <span>净流入</span>
      <span>{diff > 0 ? '+' : ''}{diff.toFixed(2)}亿元</span>
      <span style={{ fontSize: 14, lineHeight: 1 }}>↑</span>
    </div>
  );
}
