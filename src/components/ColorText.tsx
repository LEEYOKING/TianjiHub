import { colorOf, formatPercent } from '../utils/format';

interface Props {
  value: number;
  /** 显示模式: percent = +x.xx%, raw = 原值 */
  mode?: 'percent' | 'raw';
  withSign?: boolean;
  style?: React.CSSProperties;
  className?: string;
  children?: React.ReactNode;
}

/** A股红涨绿跌数字组件 */
export default function ColorText({ value, mode = 'raw', withSign = false, style, className, children }: Props) {
  const display = children !== undefined
    ? children
    : (mode === 'percent' ? formatPercent(value, withSign) : String(value));
  return (
    <span style={{ color: colorOf(value), ...style }} className={className}>
      {display}
    </span>
  );
}
