#!/bin/bash
# ============================================================
# 天机枢 — 盘后一键刷新脚本
# 作用：跑 fetch_real_data.py 生成 data.json → 提交 → 推送
# 用法：./refresh_data.sh
# 建议：每个交易日 15:30 收盘后跑一次
# ============================================================
set -euo pipefail

# 切到脚本所在目录（项目根）
cd "$(dirname "$0")"

TODAY=$(TZ=Asia/Shanghai date '+%Y-%m-%d')

# 0. 盘中保护（2026-10-23 事故：上午 10:31 跑本脚本，把盘中快照当收盘数据写进 data.json，
#    页面整晚显示"今天但其实是上午"的数据）。
#    口径与 check_freshness.py / fetch_real_data.py / fetch_rotation.py 一致：15:05 之前不跑。
DOW=$(TZ=Asia/Shanghai date '+%u')
HHMM=$(TZ=Asia/Shanghai date '+%H%M')
if [ "$DOW" -le 5 ] && [ "$HHMM" -ge "0930" ] && [ "$HHMM" -lt "1505" ]; then
  echo "✗ 现在是交易时段（09:30~15:05 CST），拒绝运行。"
  echo "  盘中拉取到的是未收盘快照，写成 data.json 会被当成收盘数据（成交额/涨跌家数都不完整）。"
  echo "  请在 15:05 之后重跑本脚本。"
  exit 1
fi

echo "=================================================="
echo " 天机枢盘后刷新 · ${TODAY}"
echo "=================================================="

# 1. 同步远端（防止本地落后导致 push 冲突；失败不阻断）
echo "[1/4] 同步远端代码..."
if git pull --rebase origin main >/dev/null 2>&1; then
  echo "  ✓ 已同步"
else
  echo "  ! 同步失败或无需同步（网络波动），继续"
fi

# 2. 跑数据脚本
#    NO_PROXY 用于绕过 macOS 系统代理残留（代理软件没开时 51926 端口会挡 requests）
echo "[2/4] 拉取盘后数据（约 10-15 分钟，请耐心等待）..."
# v2.0.8hh:优先用 Python 3.14(macOS PATH 变化时 python3 可能变成 3.9,脚本带 3.9 future 兼容双保险)
PYBIN="$(command -v python3.14 || command -v python3.12 || echo python3)"
echo "  使用解释器: $PYBIN ($($PYBIN --version 2>&1))"
NO_PROXY="*" no_proxy="*" "$PYBIN" scripts/fetch_real_data.py

# 2.5 手术台/预览数据(fetch_surgery_data 生成 surgery.json + prescan.json — 8/21 后无人调度,一直不更新)
# v2.0.8hh:接入刷新链路,让「涨跌停封成比动态评分」每日更新;失败不阻断主流程
echo "[2.5/4] 拉取手术台数据(封成比评分/亏钱传导/北向)..."
if NO_PROXY="*" no_proxy="*" "$PYBIN" scripts/fetch_surgery_data.py; then
  echo "  ✓ surgery.json / prescan.json 已更新"
else
  echo "  ! 手术台数据拉取失败(akshare 风控/限流),本次跳过,不影响主数据"
fi

# 2.6 板块轮动历史归档(2026-10-28 起:同花顺单源,每次全量重建)
# — 东财 push2/push2his 对住宅 IP 与 GitHub Runner 的海外 IP 一律 0.2s 内 RST
#   (10-22~10-27 连续 6 个交易日 0 产出),换域名/换 IPv6/换协议都无效,已彻底弃用。
#   同花顺 d.10jqka.com.cn 的板块日线是静态 CDN(无 cookie、无签名),417 个板块 / 120 天
#   约 45s 跑完;接口给 140 根 > 120 天窗口 → 每次重建天然幂等,不会像增量拼接那样滚出缺口。
#   失败(退出码 4 = 数据源不可达)不阻断主流程;覆盖不足(1)时脚本自己拒绝写入,保持原归档。
echo "[2.6/4] 拉取板块轮动历史归档(同花顺单源,全量重建 120 天)..."
set +e
NO_PROXY="*" no_proxy="*" "$PYBIN" scripts/fetch_rotation_ths.py --days 120
ROT_RC=$?
set -e
if [ "$ROT_RC" -eq 0 ]; then
  echo "  ✓ rotation.json 已重建(417 板块 / 120 交易日)"
elif [ "$ROT_RC" -eq 4 ]; then
  echo "  ! 同花顺板块日线不可达，本次跳过轮动归档(脚本不写残缺文件)"
  echo "    → 稍后重跑一次即可；或等云端 22:00 / 次日 06:00 的补跑档"
else
  echo "  ! 轮动归档未完成(退出码 $ROT_RC:覆盖不足,脚本拒绝写残缺文件),本次跳过,不影响主数据"
fi

# 3. 提交
echo "[3/4] 提交数据..."
git add public/data.json public/surgery.json public/prescan.json scripts/fetch_real_data.py
# 板块轮动归档(存在才 add,避免脚本失败时报错)
[ -f public/rotation.json ] && git add public/rotation.json || true
if git diff --cached --quiet; then
  echo "  ! 无数据变化，跳过提交"
else
  git commit -m "盘后刷新数据 ${TODAY}"
  echo "  ✓ 已提交"
fi

# 4. 推送（HTTP/1.1 规避 GitHub HTTP2 framing 层报错/连接超时；失败重试 8 次）
echo "[4/4] 推送到 GitHub..."
PUSH_OK=0
for i in $(seq 1 8); do
  if git -c http.version=HTTP/1.1 push; then
    PUSH_OK=1
    break
  fi
  echo "  ! push 第 ${i} 次失败（GitHub 网络波动），$((i * 5)) 秒后重试..."
  sleep $((i * 5))
done

if [ "$PUSH_OK" -ne 1 ]; then
  echo ""
  echo "❌ push 仍失败！数据已提交到本地，但未推送到 GitHub/Cloudflare。"
  echo "   请稍后手动执行：git -c http.version=HTTP/1.1 push"
  exit 1
fi

echo ""
echo "✓ 完成！已推送 GitHub。Cloudflare Pages 会自动重新部署（约 1-2 分钟）。"