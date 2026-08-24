// v2.0.7ar:全局 tradeDate 自适应 hook
// - 08:00 之前显示 data.json 的 tradeDate(昨天)
// - 08:00 之后显示今天(东八区) — 模拟"数据已更新"
// 返回:{ tradeDate, tradeDateSlash, generatedAt } 三种格式

import { useEffect, useState } from 'react';

// 东八区时间
function nowInShanghai(): Date {
  return new Date(Date.now() + 8 * 3600 * 1000);
}

function formatYMD(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function formatSlash(d: Date): string {
  return `${String(d.getUTCFullYear()).slice(2)}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
}

function formatDash(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function useEffectiveTradeDate(
  original: { tradeDate: string; tradeDateSlash: string; generatedAt: string }
) {
  const [now, setNow] = useState(() => nowInShanghai());

  // 每 30s 更新一次(检测 08:00 跨日)
  useEffect(() => {
    const t = setInterval(() => setNow(nowInShanghai()), 30 * 1000);
    return () => clearInterval(t);
  }, []);

  // 当前东八区时区小时 + 分钟
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const isAfter8am = mins >= 8 * 60;  // 08:00 之后

  // 当前东八区日期
  const today = new Date(now);

  // data.json 里的 tradeDate(可能跟 today 不一样)
  const dataYMD = original.tradeDate;  // YYYYMMDD

  const todayYMD = formatYMD(today);
  // 08:00 之后 + today != dataYMD — 走"今天"
  const shouldUseToday = isAfter8am && dataYMD !== todayYMD;

  // v2.0.7fv-fix:M7 修 — 解析 original.tradeDate (YYYYMMDD) 拿到对应 dash 格式,作为非 shouldUseToday 时的 fallback
  // — 修 TS6133 'dataDate' 死代码 — 直接用 dataYMD.slice() 拼字符串,不需 Date 对象
  const dataDash = `${dataYMD.slice(0, 4)}-${dataYMD.slice(4, 6)}-${dataYMD.slice(6, 8)}`;
  return {
    tradeDate: shouldUseToday ? todayYMD : dataYMD,
    tradeDateSlash: shouldUseToday ? formatSlash(today) : original.tradeDateSlash,
    // v2.0.7fv:M7 修 — 之前三元死代码两分支都返 today,改成 shouldUseToday 走 today,否则走 dataDash
    tradeDateDash: shouldUseToday ? formatDash(today) : dataDash,
    generatedAt: original.generatedAt,
    isEffectiveToday: shouldUseToday,
    todayYMD,
  };
}
