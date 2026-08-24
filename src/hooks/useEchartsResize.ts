import { useEffect } from 'react';

// v2.0.7fh:全局 window resize 监听 — 触发所有 echarts 实例 resize
// — user 反馈 #7:浏览器宽度从移动端拉到 PC 端时,6 个图表未拉宽
// — 根因:echarts-for-react lazyUpdate 不会自动 resize
// — 修法:resize 事件 dispatch echartsInstance.resize() (100ms debounce 避免抖动)
export function useEchartsResize() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // 触发所有 echarts 实例 resize
        // 1. 走全局 echarts 模块(import * as echarts from 'echarts')
        import('echarts').then((echartsMod) => {
          // 获取页面上所有 .echarts-for-react 内部 canvas 的 div,触发 resize
          const instances = echartsMod.getInstanceByDom.bind(echartsMod);
          document.querySelectorAll('div[_echarts_instance_]').forEach((el) => {
            const inst = instances(el as HTMLElement);
            if (inst) inst.resize();
          });
          // 兜底:window.dispatchEvent 让 echarts-for-react 内部也响应
          window.dispatchEvent(new Event('echarts:resize'));
        }).catch(() => {
          // ignore
        });
      }, 100);
    };
    window.addEventListener('resize', onResize);
    // 初始挂载时也触发一次(避免初次进入宽度变化)
    onResize();
    return () => {
      window.removeEventListener('resize', onResize);
      if (timer) clearTimeout(timer);
    };
  }, []);
}
