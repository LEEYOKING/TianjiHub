import type { ReactNode } from 'react';

/**
 * 公共表格样式 — 全站统一
 * 用户反馈:全部主要列居中对齐,字号 14px,字重 700,黑色 #111827
 * 列名不换行
 */
export const HEAD_STYLE: React.CSSProperties = {
  padding: '10px 8px',
  textAlign: 'center',
  color: '#111827',
  background: '#F7F8FA',
  fontSize: 14,
  fontWeight: 700,
  borderBottom: '1px solid #E5E6EB',
  whiteSpace: 'nowrap',
};

export const CELL_STYLE: React.CSSProperties = {
  padding: '10px 8px',
  textAlign: 'center',
  color: '#111827',
  fontSize: 14,
  fontWeight: 700,
  borderTop: '1px solid #F0F0F0',
  whiteSpace: 'nowrap',
};

/** 通用色值 */
import { COLOR_UP, COLOR_DOWN, COLOR_FLAT } from '../utils/format';

/**
 * 单元格颜色工具
 */
export const upColor = COLOR_UP;
export const downColor = COLOR_DOWN;
export const flatColor = COLOR_FLAT;

/** "+X.XX%" 文本(自动判断颜色) */
export function PctCell({ value, suffix = '%' }: { value: number; suffix?: string }) {
  return (
    <span style={{ color: value > 0 ? COLOR_UP : value < 0 ? COLOR_DOWN : '#111827' }}>
      {value > 0 ? '+' : ''}{value.toFixed(2)}{suffix}
    </span>
  );
}

/** 数值单元格(支持小数位) */
export function NumCell({ value, suffix = '', digits = 2 }: { value: number | string; suffix?: string; digits?: number }) {
  const n = typeof value === 'string' ? value : Number(value.toFixed(digits));
  return <span>{n}{suffix}</span>;
}

/** 颜色文字 */
export function ColoredText({ value, children, style }: { value: number; children: ReactNode; style?: React.CSSProperties }) {
  const c = value > 0 ? COLOR_UP : value < 0 ? COLOR_DOWN : '#111827';
  return <span style={{ color: c, ...style }}>{children}</span>;
}
