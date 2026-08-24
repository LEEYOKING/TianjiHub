#!/bin/bash
# 部署验证脚本 — v2.0.7cs
# 用途:deploy 完跑一下,确认 4 个 Function 生效 + baseData 是当天数据
# 用法: ./scripts/verify-deploy.sh
#      或: bash scripts/verify-deploy.sh

set -e

# ============ 1. 4 个 Function 测活 ============
echo "=== 1/3 测 4 个 Cloudflare Pages Function ==="
echo ""

APIS=(
  "/api/market-stats"
  "/api/etf-stats"
  "/api/bond-stats"
  "/api/emotion-temp"
)

for api in "${APIS[@]}"; do
  url="https://tianjishu-a-6is.pages.dev${api}"
  echo -n "  $api ... "
  # v2.0.7ct:5s → 30s timeout — em push2 拉 6000 只 + 6 域名 fallback 要 10-20s
  body=$(curl -sS --max-time 30 -w "\n__HTTP__%{http_code}" "$url" 2>&1)
  http=$(echo "$body" | grep "__HTTP__" | sed 's/__HTTP__//')
  json=$(echo "$body" | grep -v "__HTTP__")

  if [ "$http" != "200" ]; then
    echo "❌ HTTP $http(可能 Function 还没 deploy / 或路由 404)"
    echo "    返回: ${json:0:200}"
    continue
  fi

  # 解析 source 字段(emotion-temp 没 source,看 error 字段)
  if [ "$api" = "/api/emotion-temp" ]; then
    if echo "$json" | grep -q '"error":true'; then
      err=$(echo "$json" | grep -oE '"message":"[^"]+"' | head -1 | sed 's/"message":"//;s/"$//')
      echo "⚠️  HTTP 200 但 Function 返 error: $err"
      echo "    (这通常表示 Function 跑起来了,但 em push2 拉不到 — 加重试 fallback 中)"
    else
      echo "✅ HTTP 200,emotion-temp Function 正常"
    fi
  else
    source=$(echo "$json" | grep -oE '"source":"[^"]+"' | head -1 | sed 's/"source":"//;s/"$//')
    isweekend=$(echo "$json" | grep -oE '"isWeekend":(true|false)' | head -1 | sed 's/"isWeekend"://')
    if [ -z "$source" ]; then
      echo "❌ HTTP 200 但 JSON 格式不对(没 source 字段)"
      echo "    返回: ${json:0:200}"
    elif [ "$isweekend" = "true" ]; then
      echo "✅ HTTP 200(今天是周末,Function 主动返 null,正常)"
    elif [ "$source" = "fallback" ]; then
      err=$(echo "$json" | grep -oE '"error":"[^"]+"' | head -1 | sed 's/"error":"//;s/"$//')
      echo "⚠️  HTTP 200 但 source=fallback(em push2 拉不到 — Function 重试后 fallback)"
      echo "    错误: ${err:0:120}"
    else
      echo "✅ HTTP 200,source=$source(Function 拉到 em 实时)"
    fi
  fi
done

echo ""

# ============ 2. baseData 日期检查 ============
echo "=== 2/3 baseData 当天日期检查 ==="
echo ""

data_url="https://tianjishu-a-6is.pages.dev/data.json"
echo -n "  GET /data.json ... "
http=$(curl -sS --max-time 30 -o /tmp/data_check.json -w "%{http_code}" "$data_url" 2>/dev/null)

if [ "$http" != "200" ]; then
  echo "❌ HTTP $http(data.json 没拿到)"
else
  trade_date=$(python3 -c "import json; d=json.load(open('/tmp/data_check.json')); print(d['marketOverview'].get('tradeDate',''))" 2>/dev/null)
  today=$(TZ='Asia/Shanghai' date +'%Y%m%d')
  today_dash=$(TZ='Asia/Shanghai' date +'%Y-%m-%d')
  weekday=$(TZ='Asia/Shanghai' date +'%A')

  if [ -z "$trade_date" ]; then
    echo "❌ data.json 解析失败(可能是 SPA fallback HTML)"
  elif [ "$trade_date" = "$today" ]; then
    echo "✅ tradeDate=$trade_date(今天 $today_dash $weekday,baseData 当天)"
  elif [ "$weekday" = "Saturday" ] || [ "$weekday" = "Sunday" ]; then
    echo "⚠️  tradeDate=$trade_date(今天是 $weekday,周末没跑 fetch_real_data,正常)"
    echo "    今天 baseData 显示 $trade_date(上一交易日)"
  else
    stale_days=$(python3 -c "
from datetime import datetime
t = datetime.strptime('$trade_date','%Y%m%d')
n = datetime.strptime('$today','%Y%m%d')
print((n-t).days)
" 2>/dev/null)
    echo "⚠️  tradeDate=$trade_date(今天 $today_dash $weekday),stale $stale_days 天"
    echo "    建议:去 GitHub Actions trigger 一次 fetch-data.yml(让 baseData 更新到今天)"
  fi
fi

echo ""

# ============ 3. 总结 ============
echo "=== 3/3 总结 ==="
echo ""
echo "如果上面 4 个 Function 都 ✅,Function 部署成功 → 浏览器刷一下 https://tianjihub.xhoper.com"
echo "如果 baseDate 是 stale → 浏览器 Overview 页 6 个字段显示 8/17 实时(来自 Function),涨停池/龙虎榜/融资 stale(来自 baseData)"
echo "如果想 baseData 也更新 → GitHub → Actions → fetch-data.yml → Run workflow"
echo ""
echo "完整流程:"
echo "  1. ./scripts/verify-deploy.sh  ← 你现在"
echo "  2. (可选)GitHub Actions 跑 fetch-data.yml"
echo "  3. 等 5-10 分钟,自动 deploy 完"
echo "  4. 再跑一次 ./scripts/verify-deploy.sh 看 baseData 更新"
