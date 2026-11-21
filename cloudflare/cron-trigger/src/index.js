// 准点触发 GitHub Actions 的 Daily Data Refresh。
// 背景：GitHub 免费 cron 实测延迟 3~14.5 小时（应 15:35 的拖到次日 06:04），
// 而复盘需要在 16:00 前拿到当日数据。Worker Cron 按分钟准点，只负责「调起」，
// 实际抓取仍跑在 GitHub Actions 上（仓库里的 cron 全部保留作兜底）。

const OWNER = 'LEEYOKING';
const REPO = 'TianjiHub';
const WORKFLOW = 'daily-refresh.yml';
const REF = 'main';
const DATA_URL = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}/public/data.json`;

// 免费账户只有 5 条 cron 名额，所以只注册「每 5 分钟」这一条，
// 由这里判断是否命中目标时点（UTC）。
//
// 2026-11-20 事故：当天 15:10 的准点触发没有出现（全天只有 GitHub cron 在 15:37 拉起的
// 那一次），而那次又因为「手术台」步骤挂死被 60 分钟超时杀掉 —— 当天数据全丢。
// 所以收盘档改成「一个主档 + 两个自带新鲜度判断的重试档」：
//   · kind='close'  : 先看仓库里 data.json 的 tradeDate 是不是今天，已经是就跳过，
//                     没更新才 dispatch —— 准点漏投/运行挂死都能在同一天内自愈；
//   · kind='always' : 无条件 dispatch（龙虎榜 18:00 才披露、融资余额当晚才定稿）。
const SLOTS = [
  { h: 7, m: 10, kind: 'close' }, // 15:10 CST 收盘主档
  { h: 7, m: 40, kind: 'close' }, // 15:40 CST 重试
  { h: 8, m: 10, kind: 'close' }, // 16:10 CST 重试（复盘前最后一次）
  { h: 10, m: 5, kind: 'always' }, // 18:05 CST 龙虎榜档
  { h: 13, m: 30, kind: 'always' }, // 21:30 CST 融资档
];

function cstToday() {
  // en-CA 的日期格式就是 YYYY-MM-DD
  const d = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return d.replace(/-/g, '');
}

async function alreadyFresh() {
  try {
    // 加时间戳绕开 raw.githubusercontent 的 5 分钟 CDN 缓存
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cf: { cacheTtl: 0 } });
    if (!res.ok) return false;
    const j = await res.json();
    return String(j?.meta?.tradeDate || '') === cstToday();
  } catch (e) {
    console.error(`freshness check failed: ${e}`);
    return false; // 判断不了就当没更新，宁可多跑一次也不漏
  }
}

async function dispatch(env) {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'tianjihub-cron-trigger',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: REF }),
    },
  );
  if (res.status !== 204) {
    const text = await res.text();
    throw new Error(`dispatch failed ${res.status}: ${text.slice(0, 200)}`);
  }
}

export default {
  async scheduled(controller, env, ctx) {
    const t = new Date(controller.scheduledTime);
    const slot = SLOTS.find((s) => t.getUTCHours() === s.h && t.getUTCMinutes() === s.m);
    if (!slot) return; // 每 5 分钟一次的空转，直接退出，不消耗 GitHub 额度

    if (slot.kind === 'close' && (await alreadyFresh())) {
      console.log(`skip ${t.toISOString()}: data.json 已是今日数据`);
      return;
    }

    try {
      await dispatch(env);
      console.log(`dispatched ${WORKFLOW} at ${new Date().toISOString()} (slot ${slot.h}:${slot.m})`);
    } catch (e) {
      // 失败重试一次：GitHub API 偶发 5xx/限流
      console.error(String(e));
      try {
        await dispatch(env);
        console.log('dispatch retry ok');
      } catch (e2) {
        console.error(`retry failed: ${e2}`);
      }
    }
  },

  async fetch(request, env) {
    // 部署后访问 Worker 域名可确认密钥是否配好（不触发任何任务）
    const url = new URL(request.url);
    if (url.searchParams.get('check') === '1') {
      // 校验 token 是否还有效：token 过期时 dispatch 会 401，而 cron 里失败是静默的
      // （2026-11-20 全天没能触发，最可能就是 token 到期）。
      try {
        const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}`, {
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'tianjihub-cron-trigger',
          },
        });
        return new Response(JSON.stringify({ ok: r.ok, status: r.status, tokenValid: r.status === 200 }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e).slice(0, 300) }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    if (url.searchParams.get('force') === '1') {
      // 手动补触发：curl 'https://tianjihub-cron.leeyoking.workers.dev/?force=1'
      try {
        await dispatch(env);
        return new Response(JSON.stringify({ ok: true, dispatched: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e).slice(0, 300) }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(
      JSON.stringify({
        ok: true,
        tokenConfigured: Boolean(env.GITHUB_TOKEN),
        workflow: `${OWNER}/${REPO}/${WORKFLOW}`,
        fresh: await alreadyFresh(),
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  },
};
