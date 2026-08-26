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
NO_PROXY="*" no_proxy="*" python3 scripts/fetch_real_data.py

# 3. 提交
echo "[3/4] 提交数据..."
git add public/data.json public/sectorKlines.json scripts/fetch_real_data.py
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