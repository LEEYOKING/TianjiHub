// 准点触发 GitHub Actions 的 Daily Data Refresh。
// 背景：GitHub 免费 cron 实测延迟 3~14.5 小时（应 15:35 的拖到次日 06:04），
// 而复盘需要在 16:00 前拿到当日数据。Worker Cron 按分钟准点，只负责「调起」，
// 实际抓取仍跑在 GitHub Actions 上（仓库里的 cron 全部保留作兜底）。

const OWNER = 'LEEYOKING';
const REPO = 'TianjiHub';
const WORKFLOW = 'daily-refresh.yml';
const REF = 'main';

// 免费账户只有 5 条 cron 名额，所以只注册「每 5 分钟」这一条，
// 由这里判断是否命中三个目标时点（UTC）。
//   07:35 UTC = 15:35 CST 收盘核心档
//   10:05 UTC = 18:05 CST 龙虎榜档
//   13:30 UTC = 21:30 CST 融资档
const SLOTS = [
  [7, 35],
  [10, 5],
  [13, 30],
];

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
    const hit = SLOTS.some(([h, m]) => t.getUTCHours() === h && t.getUTCMinutes() === m);
    if (!hit) return; // 每 5 分钟一次的空转，直接退出，不消耗 GitHub 额度
    try {
      await dispatch(env);
      console.log(`dispatched ${WORKFLOW} at ${new Date().toISOString()}`);
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
    // 部署后访问 Worker 域名/health 可确认密钥是否配好（不触发任何任务）
    return new Response(
      JSON.stringify({
        ok: true,
        tokenConfigured: Boolean(env.GITHUB_TOKEN),
        workflow: `${OWNER}/${REPO}/${WORKFLOW}`,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  },
};
