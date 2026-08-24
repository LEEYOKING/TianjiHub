// A股特有:红涨绿跌(和欧美相反) - 全局色值统一
export const COLOR_UP = '#ff4d4f';      // 红色,代表上涨(0x5)
export const COLOR_DOWN = '#0ecd70';    // 绿色,代表下跌(0x0)
export const COLOR_FLAT = '#999999';    // 灰色,平盘
export const COLOR_TEXT = '#111827';    // 主文字黑
export const COLOR_PURPLE = 'rgb(154, 129, 252)';   // #9A81FC
export const COLOR_BLUE = 'rgb(80, 162, 254)';      // #50A2FE
export const COLOR_ORANGE = 'rgb(255, 167, 76)';    // #FFA74C
export const COLOR_EGGSHELL = '#FFEAA7';             // 蛋黄色 (C 级)
export const COLOR_PRIMARY = '#1890FF';              // 主题蓝(保持不变)
export const COLOR_BG_ALT = '#F5F7FA';
export const COLOR_BORDER = '#EBEEF5';

/**
 * 根据数值返回A股颜色
 */
export function colorOf(v: number): string {
  if (v > 0) return COLOR_UP;
  if (v < 0) return COLOR_DOWN;
  return COLOR_FLAT;
}

/**
 * 格式化带正负号的百分比(+3.48% / -1.16%)
 */
export function formatPercent(v: number, withSign = true): string {
  if (v === null || v === undefined || isNaN(v)) return '-';
  const abs = Math.abs(v).toFixed(2);
  if (withSign) {
    if (v > 0) return `+${abs}%`;
    if (v < 0) return `-${abs}%`;
    return `0.00%`;
  }
  return `${v.toFixed(2)}%`;
}

export function formatPrice(v: number): string {
  if (v === null || v === undefined || isNaN(v)) return '-';
  return v.toFixed(2);
}

export function formatYi(v: number, unit = '亿'): string {
  if (v === null || v === undefined || isNaN(v)) return '-';
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(2)}万亿`;
  return `${v.toFixed(2)}${unit}`;
}

export function formatWan(v: number): string {
  if (v === null || v === undefined || isNaN(v)) return '-';
  return `${v.toFixed(0)}万`;
}

export function formatNumber(v: number): string {
  if (v === null || v === undefined || isNaN(v)) return '-';
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

/** 时间字符串 "09:25:00" 转分钟数(用于判断尾盘偷鸡) */
export function timeToMinutes(s: string): number {
  try {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  } catch {
    return -1;
  }
}
