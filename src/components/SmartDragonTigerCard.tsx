// 龙虎榜智能解读卡片 — v2.0.7q
// 接收 Python DragonTigerInterpreter.analyze_stock() 输出的结构化 JSON
// UI 极简:L1 结论 + L2 买卖对比 + L3 资金性质分布
import { useIsMobile } from '../hooks/useIsMobile';

// ============================================================
// 类型定义
// ============================================================
export interface SeatInfo {
  seat: string;
  name: string;
  type: string;        // 一线游资 / 机构 / 外资 / 散户集中营 / 量化基金 / 普通营业部
  style: string;
  icon: string;
  net_amount: number;  // 元
}

export interface ForceDistribution {
  [type: string]: number;  // 占比 %
}

export interface InterpretedData {
  stock_info: {
    code: string;
    name: string;
    reason: string;
  };
  tags: string[];
  summary_text: string;
  structured_buy_list: SeatInfo[];
  structured_sell_list: SeatInfo[];
  force_distribution: ForceDistribution;
}

// ============================================================
// 颜色配置
// ============================================================
const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  '游资合力': { bg: '#F63638', text: '#fff' },
  '溢价预期': { bg: '#BF4044', text: '#fff' },
  '游资接力': { bg: '#F63638', text: '#fff' },
  '次新博弈': { bg: '#BF4044', text: '#fff' },
  '机构博弈': { bg: '#50a2fe', text: '#fff' },
  '游资出货': { bg: '#8C444F', text: '#fff' },
  '警惕低开': { bg: '#8C444F', text: '#fff' },
  '北向买入': { bg: '#9a81fc', text: '#fff' },
  '冷门': { bg: '#9ca3af', text: '#fff' },
  '普通': { bg: '#E5E7EB', text: '#4b5563' },
};

const TYPE_COLORS: Record<string, string> = {
  '一线游资': '#F63638',
  '机构': '#50a2fe',
  '外资': '#9a81fc',
  '散户集中营': '#0ecd70',
  '量化基金': '#13c2c2',
  '普通营业部': '#9ca3af',
};


// 标签 chip 样式:背景 = bg 色的 10% 透明度,文字默认用 bg(深色字)
function makeChipStyle(bg: string, text?: string) {
  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  return {
    padding: '3px 10px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600,
    background: `rgba(${r},${g},${b},0.10)`,
    // 默认 color = bg(深色字);只有显式传 text 才覆盖(用于"普通"这种浅底)
    color: text ?? bg,
  };
}

// ============================================================
// 组件
// ============================================================
export function SmartDragonTigerCard({ data }: { data: InterpretedData }) {
  // v2.0.7fm:user 反馈 龙虎榜卡片内容溢出 — 移动端 grid 1 列(原 1fr 1fr 强制 2 列窄屏挤)— PC 端保持 1fr 1fr
  const _isMobile = useIsMobile();
  // 按金额排序(买方降序,卖方按绝对值降序)— v2.0.7ai:只取前 5 条
  const buys = [...data.structured_buy_list].sort((a, b) => b.net_amount - a.net_amount).slice(0, 5);
  const sells = [...data.structured_sell_list].sort((a, b) => Math.abs(b.net_amount) - Math.abs(a.net_amount)).slice(0, 5);

  // 找最大金额(用于柱状图)
  const maxAmt = Math.max(
    ...buys.map(b => Math.abs(b.net_amount)),
    ...sells.map(s => Math.abs(s.net_amount)),
    1
  );

  // v2.0.7ac:卖方资金性质分布(前端根据 structured_sell_list 累加)
  const sellForce: Record<string, number> = {};
  for (const s of sells) {
    if (!s.type) continue;
    const amt = Math.abs(s.net_amount || 0);
    sellForce[s.type] = (sellForce[s.type] || 0) + amt;
  }
  const sellTotalAmt = Object.values(sellForce).reduce((a, b) => a + b, 0);
  const sellForcePct: Record<string, number> = {};
  if (sellTotalAmt > 0) {
    for (const [k, v] of Object.entries(sellForce)) {
      sellForcePct[k] = Math.round((v / sellTotalAmt) * 100);
    }
  }

  return (
    // v2.0.7ah:flex column + height: 521(固定,不是 minHeight)— PC 端所有卡片等高
    // v2.0.7fn:user 反馈 移动端 L3 资金性质分布图例撞到底部翻页 — 移动端改 height: auto(去 maxHeight 限制)+ 紧凑 padding + L2 也 1 列
    <div
      style={{
        background: '#fff',
        border: '1px solid #E5E7EB',
        borderRadius: 14,
        padding: _isMobile ? '14px 16px' : '20px 24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 30px 5px rgba(0,0,0,0.02)',
        marginBottom: 0,
        // PC 端固定 521 等高;移动端自适应(不卡 521,避免内容溢出卡片后撞到下方 Pagination)
        height: _isMobile ? 'auto' : 521,
        minHeight: _isMobile ? 521 : 521,
        maxHeight: _isMobile ? 'none' : 521,
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* L1: 股票名 + Tags + Summary */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          <div>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>{data.stock_info.name}</span>
            <span style={{ fontSize: 13, color: '#9ca3af', marginLeft: 10 }}>{data.stock_info.code}</span>
            {data.stock_info.reason && (
              <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 10 }}>· {data.stock_info.reason}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {data.tags.map(t => {
              const c = TAG_COLORS[t] || TAG_COLORS['普通'];
              // v2.0.7x:只对"普通"这种浅底标签传 text(深灰),其他用默认 bg
              return (
                <span
                  key={t}
                  style={makeChipStyle(c.bg, t === '普通' ? c.text : undefined)}
                >
                  {t}
                </span>
              );
            })}
          </div>
        </div>
        <div
          style={{
            fontSize: 13,
            color: '#4b5563',
            lineHeight: 1.7,
            padding: '10px 14px',
            background: '#F7F8FA',
            borderRadius: 6,
            // v2.0.7t:删 borderLeft 蓝条(同色背景)
          }}
        >
          {data.summary_text}
        </div>
      </div>

      {/* L2: 买卖力量对比图 */}
      {/* v2.0.7fn:user 反馈 移动端 L2 也强制 1fr 1fr 挤 — 移动端改 1fr(单列),PC 端保留 1fr 1fr */}
      <div style={{ display: 'grid', gridTemplateColumns: _isMobile ? '1fr' : '1fr 1fr', gap: _isMobile ? 12 : 20, marginBottom: _isMobile ? 12 : 18, flex: 1 }}>
        <SeatColumn seats={buys} side="buy" maxAmt={maxAmt} />
        <SeatColumn seats={sells} side="sell" maxAmt={maxAmt} />
      </div>

      {/* v2.0.7ag:L3 资金性质分布 — 移到卡片底部,距离卡片底 20px */}
      {/* v2.0.7fm:user 反馈 龙虎榜卡片内容溢出 — 移动端 grid 1 列(原 1fr 1fr 强制 2 列窄屏挤)— PC 端保持 1fr 1fr */}
      {/* v2.0.7fn:user 反馈 移动端卡片内容仍超 521,撞到下方 Pagination — 紧凑化 gap,移动端 paddingBottom 减小 */}
      <div style={{ display: 'grid', gridTemplateColumns: _isMobile ? '1fr' : '1fr 1fr', gap: _isMobile ? 8 : 16, marginTop: _isMobile ? 8 : 'auto', paddingBottom: _isMobile ? 8 : 20 }}>
        {/* 买入 */}
        {Object.keys(data.force_distribution).length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: '#86909C', marginBottom: 6, fontWeight: 500 }}>
              买入资金性质分布
            </div>
            <div style={{ display: 'flex', height: 15, borderRadius: 4, overflow: 'hidden', background: '#F3F4F6' }}>
              {Object.entries(data.force_distribution).map(([type, pct]) => (
                <div
                  key={type}
                  style={{
                    width: `${pct}%`,
                    background: TYPE_COLORS[type] || '#9ca3af',
                    transition: 'width 0.3s',
                  }}
                  title={`${type} ${pct}%`}
                />
              ))}
            </div>
            {/* 图例 */}
            <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
              {Object.entries(data.force_distribution).map(([type, pct]) => (
                <span key={type} style={{ fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: TYPE_COLORS[type] || '#9ca3af' }} />
                  {type} <strong style={{ color: '#111827', marginLeft: 2 }}>{pct}%</strong>
                </span>
              ))}
            </div>
          </div>
        )}
        {/* 卖出 — v2.0.7ac:新增,从 structured_sell_list 算 */}
        {Object.keys(sellForcePct).length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: '#86909C', marginBottom: 6, fontWeight: 500 }}>
              卖出资金性质分布
            </div>
            <div style={{ display: 'flex', height: 15, borderRadius: 4, overflow: 'hidden', background: '#F3F4F6' }}>
              {Object.entries(sellForcePct).map(([type, pct]) => (
                <div
                  key={type}
                  style={{
                    width: `${pct}%`,
                    background: TYPE_COLORS[type] || '#9ca3af',
                    transition: 'width 0.3s',
                  }}
                  title={`${type} ${pct}%`}
                />
              ))}
            </div>
            {/* 图例 */}
            <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
              {Object.entries(sellForcePct).map(([type, pct]) => (
                <span key={type} style={{ fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: TYPE_COLORS[type] || '#9ca3af' }} />
                  {type} <strong style={{ color: '#111827', marginLeft: 2 }}>{pct}%</strong>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 买卖单方子组件
// ============================================================
function SeatColumn({ seats, side, maxAmt }: { seats: SeatInfo[]; side: 'buy' | 'sell'; maxAmt: number }) {
  const isBuy = side === 'buy';
  const color = isBuy ? '#ff4d4f' : '#0ecd70';
  const title = isBuy ? '买方阵营' : '卖方阵营';

  if (seats.length === 0) {
    return (
      <div>
        <div style={{ fontSize: 13, color, fontWeight: 600, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 12, color: '#9ca3af', padding: '12px 0' }}>无数据</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 13, color, fontWeight: 600, marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {seats.map((s, i) => {
          const amt = s.net_amount;
          const absAmt = Math.abs(amt);
          const widthPct = (absAmt / maxAmt) * 100;
          const amtYi = (absAmt / 1e8).toFixed(2);
          const sign = isBuy ? '+' : '-';
          return (
            <div key={i}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: '#111827', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{s.name}</span>
                  <span
                    style={{
                      ...makeChipStyle(TYPE_COLORS[s.type] || '#9ca3af'),
                      fontSize: 10,
                      padding: '1px 6px',
                      fontWeight: 500,
                    }}
                  >
                    {s.type}
                  </span>
                </span>
                <span style={{ color, fontWeight: 600 }}>
                  {sign}{amtYi} 亿
                </span>
              </div>
              <div style={{ display: 'flex', height: 6, background: '#FAFBFC', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${widthPct}%`,
                    // v2.0.7w:横向渐变(从浅到深)
                    background: isBuy
                      ? 'linear-gradient(90deg, #FFE7E7 0%, #ff4d4f 100%)'
                      : 'linear-gradient(90deg, #DFF7EA 0%, #0ecd70 100%)',
                    transition: 'width 0.3s',
                    // v2.0.7ac:右上右下圆角最大(因 isBuy 从左往右,反之亦然)
                    borderTopRightRadius: 999,
                    borderBottomRightRadius: 999,
                  }}
                />
              </div>
              <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{s.style}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
