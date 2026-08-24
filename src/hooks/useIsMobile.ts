import { useEffect, useState } from 'react';

// v2.0.7fd:移动端响应式 hook — 768px 断点
// PC 端(≥ 769px)零变化;≤ 768px 切移动端布局
// SSR 安全:服务端无 window,默认 false(走 PC 布局)— 避免 hydration mismatch
const MOBILE_MAX = 768;

export function useIsMobile(): boolean {
  const [m, setM] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= MOBILE_MAX;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // v2.0.7fv:L9 修 — resize 走 150ms debounce,但进入页面立即校准不走 debounce
    const update = () => setM(window.innerWidth <= MOBILE_MAX);
    const onR = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(update, 150);
    };
    window.addEventListener('resize', onR);
    // 进入页面时再校准一次(防止初始值在 SSR / 早期 effect 之前与实际不符)
    // — 立即执行 update(),不走 debounce — 避免 150ms 视觉跳变
    update();
    return () => {
      window.removeEventListener('resize', onR);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return m;
}
