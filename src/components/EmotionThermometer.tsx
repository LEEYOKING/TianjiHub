// 情绪温度计组件 — v2.0.7ae
// v2.0.7z:5 维度直接相加算法
// v2.0.7ae:0°/100° 文字改在弧外(0 在 (cx-r),100 在 (cx+r))+ 半圆弧与温度数值间距 6px + 估值/情绪字号 12px

export interface EmotionThermometerProps {
  temperature: number;  // 0-100
  status?: string;
  statusDesc?: string;
  details: {
    limit_up: number;
    limit_down: number;
    max_boards: number;
    broken_rate: string;
    broken_count: number;
    yest_perf: string;
    promote_rate: string;
    limit_ratio: string;
  };
  dimension_scores?: {
    '涨跌停对比': number;
    '连板高度': number;
    '炸板率': number;
    '昨日涨停今日': number;
    '晋级率': number;
  };
  limitUpCount?: number;
  upCount?: number;
  downCount?: number;
}

// 颜色(0-100 渐变)— 5 档:蓝 → 青 → 暖黄 → 橙 → 红
// v2.0.7eh:色值升级(更鲜亮:青蓝 → 亮绿 → 亮黄 → 亮橙 → 亮红)
function getColor(t: number): string {
  if (t <= 20) return '#07d4ec';  // 0-20° 蓝青 极冷/低迷
  if (t <= 40) return '#0ecd70';  // 20-40° 亮绿 偏冷/谨慎
  if (t <= 60) return '#ffc11b';  // 40-60° 暖黄 中性/平稳
  if (t <= 80) return '#ff832d';  // 60-80° 橙 偏热/活跃
  return '#ff4d4f';                // 80-100° 红 极热/亢奋
}

function getValuationTag(limitUp: number, upCount: number, downCount: number): { text: string; color: string } {
  if (limitUp >= 80 || (upCount > downCount * 3 && upCount > 3000)) {
    return { text: '极高', color: '#dc2626' };
  }
  if (limitUp >= 30 || upCount > downCount * 1.5) {
    return { text: '偏高', color: '#f97316' };
  }
  if (limitUp >= 10) {
    return { text: '中位', color: '#f59e0b' };
  }
  return { text: '低位', color: '#06b6d4' };
}

function getSentimentTag(temperature: number, _limitUp: number, _limitDown: number): { text: string; color: string } {
  // v2.0.7ev:跟 5 档温度范围一致(0-20 低迷 / 20-40 谨慎 / 40-60 平稳 / 60-80 活跃 / 80-100 亢奋)
  // — 之前只用涨跌停比例算(8/20 74:4 比值 18.5 → "亢奋" — 但 60° 应是"平稳")
  // — 修法:用温度档位,色值跟 getColor 保持一致(弧线同色)
  // — 参数前 _ 表示"故意未用"(TS noUnusedParameters 不报错,保留参数是为了未来扩展)
  const t = Math.max(0, Math.min(100, temperature));
  if (t <= 20) return { text: '低迷', color: getColor(t) };
  if (t <= 40) return { text: '谨慎', color: getColor(t) };
  if (t <= 60) return { text: '平稳', color: getColor(t) };
  if (t <= 80) return { text: '活跃', color: getColor(t) };
  return { text: '亢奋', color: getColor(t) };
}

export function EmotionThermometer({
  temperature,
  details,
  limitUpCount,
  upCount,
  downCount,
}: EmotionThermometerProps) {
  // v2.0.7ac:实时刷新 — 不存 hover state 了
  const safeT = Math.max(0, Math.min(100, temperature));
  const color = getColor(safeT);

  const lu = limitUpCount ?? details.limit_up;
  const ld = details.limit_down;
  const valuation = getValuationTag(lu, upCount ?? 0, downCount ?? 0);
  const sentiment = getSentimentTag(safeT, lu, ld);

  // v2.0.7ac:半圆弧半径 80%(原 r=70 → r=56)
  const cx = 100;
  const cy = 100;
  const r = 56;  // 80% of 70
  const angle = 180 - (safeT / 100) * 180;
  const angleRad = (angle * Math.PI) / 180;
  const endX = cx + r * Math.cos(angleRad);
  const endY = cy - r * Math.sin(angleRad);
  const needleLength = 44;  // 80% of 56
  const needleX = cx + needleLength * Math.cos(angleRad);
  const needleY = cy - needleLength * Math.sin(angleRad);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        padding: '0px 8px',  // v2.0.7fr:user 反馈 12px 8px 8px → 0px 8px(去掉上下 padding,温度计贴卡片边缘)
        borderRadius: 10,
        background: 'transparent',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* 半圆弧 SVG — v2.0.7af:viewBox 200x124 给 0°/100° 留更多位置 */}
        <svg width="100%" height="80" viewBox="0 0 200 124" style={{ display: 'block' }}>
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            stroke="#F3F4F6"
            strokeWidth="11"
            strokeLinecap="round"
          />
          {safeT > 0 && (
            <path
              d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${endX} ${endY}`}
              fill="none"
              stroke={color}
              strokeWidth="11"
              strokeLinecap="round"
              style={{ transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)' }}
            />
          )}
          <line
            x1={cx}
            y1={cy}
            x2={needleX}
            y2={needleY}
            stroke="#111827"
            strokeWidth="2"
            strokeLinecap="round"
            style={{ transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)' }}
          />
          <circle cx={cx} cy={cy} r="4" fill="#111827" />
          {/* v2.0.7af:0°/100° 字号 10→12 + 距弧起点 12px(弧起止点 = (cx-r, cy) / (cx+r, cy)) */}
          <text x={cx - r} y={cy + 14} textAnchor="middle" fontSize="12" fill="#6b7280" fontWeight={600}>0°</text>
          <text x={cx + r} y={cy + 14} textAnchor="middle" fontSize="12" fill="#6b7280" fontWeight={600}>100°</text>
        </svg>

        {/* v2.0.7af:半圆弧与温度数值间距 6px(保持) */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginTop: 6 }}>
          <span style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1, fontFamily: 'system-ui, -apple-system, sans-serif', fontVariantNumeric: 'tabular-nums' }}>
            {safeT}
          </span>
          <span style={{ fontSize: 13, color, fontWeight: 600 }}>°</span>
        </div>

        {/* v2.0.7ad:固定标题"市场情绪温度计"放在温度数字下方 */}
        <div style={{ textAlign: 'center', fontSize: 12, color: '#6b7280', marginTop: 2 }}>
          市场情绪温度计
        </div>

        {/* v2.0.7ae:估值 / 情绪 标签 — 字号 12 */}
        <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 12, alignItems: 'center' }}>
          <span>
            <span style={{ color: '#6b7280' }}>估值</span>{' '}
            <strong style={{ color: valuation.color, fontWeight: 700 }}>{valuation.text}</strong>
          </span>
          <span style={{ color: '#d1d5db' }}>|</span>
          <span>
            {/* v2.0.7ej:情绪文案颜色改用温度色值(跟温度计弧线同色)— 不再用 sentiment.color */}
            <span style={{ color: '#6b7280' }}>情绪</span>{' '}
            <strong style={{ color, fontWeight: 700 }}>{sentiment.text}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
