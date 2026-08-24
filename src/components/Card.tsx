import { type ReactNode } from 'react';

// 全站统一白色卡片样式 — 浅灰投影 + 1px 边框
// 用户指定: rgba(0, 0, 0, 0.04) 0px 1px 3px, rgba(0, 0, 0, 0.08) 0px 0px 40px 20px
export const CARD_SHADOW = '0 1px 3px rgba(0, 0, 0, 0.04), 0 0 40px 20px rgba(0, 0, 0, 0.08)';

interface CardProps {
  children: ReactNode;
  title?: ReactNode;       // 标题(左侧)
  right?: ReactNode;       // 右上角内容
  subtitle?: ReactNode;    // 副标题
  style?: React.CSSProperties;
  noPadding?: boolean;
  onClick?: () => void;
}

export function Card({ children, title, right, subtitle, style, noPadding, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        background: '#FFFFFF',
        borderRadius: 12,
        boxShadow: CARD_SHADOW,
        padding: noPadding ? 0 : '20px 24px',
        ...style,
      }}
    >
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: subtitle ? 4 : 16, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{title}</span>
            {subtitle && <span style={{ fontSize: 12, color: '#9ca3af' }}>{subtitle}</span>}
          </div>
          {right && <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
