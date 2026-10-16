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

/** 'YYYY-MM-DD' → 次日 'YYYY-MM-DD'(纯日期运算,用 UTC 以免受本地时区/夏令时干扰) */
export function nextDateStr(d: string): string {
  if (!d || d.length < 10) return '';
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  if (!y || !m || !day) return '';
  const t = new Date(Date.UTC(y, m - 1, day) + 86400000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

/**
 * 由数据文件自身的 meta 判定"是否为盘后快照",用于页头「报告日期」的状态词。
 * 返回 { time: 'HH:MM', postClose: boolean }。
 *
 * 口径(V2.0 修订):归档在 **lastTradeDate 当日 15:05 之后 ~ 次日 09:30 之前** 生成都算盘后数据。
 * 因为云端 cron 常被 GitHub 延迟到深夜甚至次日凌晨(实测 22:00 档直到次日 08:07 才跑完),
 * 那种情况下拿到的**确实是该交易日的完整收盘数据**;早先"必须同一日期且 ≥15:05"的判定
 * 会把它误判成"非当日盘后数据",反而误导人。
 * 反之:生成时点落在该交易日的盘中(09:30~15:00)属于盘中快照,不算盘后;
 * 生成时点晚于次日 09:30 也说明它落后了一个交易日。
 *
 * 主页(Rotation)与详情页(RotationDetail)共用此单一实现,避免两处口径漂移。
 */
export function describeGenTime(
  generatedAt?: string,
  lastTradeDate?: string,
): { time: string; postClose: boolean } {
  const g = generatedAt || '';
  if (g.length < 16) return { time: '--:--', postClose: false };
  const date = g.slice(0, 10);
  const time = g.slice(11, 16);
  const sameDayPostClose = date === lastTradeDate && time >= '15:05';
  const nextDayPreOpen = date === nextDateStr(lastTradeDate || '') && time < '09:30';
  return { time, postClose: sameDayPostClose || nextDayPreOpen };
}
