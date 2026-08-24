#!/bin/bash
# ============================================================
# 天机枢 — 交易日盘后自动刷新（由 launchd 定时调用）
# 触发点：每天 15:30（收盘后）+ 18:30（龙虎榜 18:00 披露后补跑）
# 逻辑：判断是否 A 股交易日 → caffeinate 防睡眠 → 跑 refresh_data.sh → 写日志
# ============================================================
set -uo pipefail

# launchd 环境 PATH 不全，手动补齐（python3/git/caffeinate 都依赖）
export PATH="/Library/Frameworks/Python.framework/Versions/3.14/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

PROJECT_DIR="/Users/leeyoking/Documents/Trae_Cron File/TJHUB天机枢"
LOG_FILE="$PROJECT_DIR/auto_refresh.log"
TODAY=$(TZ=Asia/Shanghai date '+%Y-%m-%d')
HOUR_MIN=$(TZ=Asia/Shanghai date '+%H:%M')

log() {
  echo "[$(TZ=Asia/Shanghai date '+%F %T')] $1" >> "$LOG_FILE"
}

# 1. 判断今天是否 A 股交易日（周末 + 法定节假日自动跳过）
#    优先用 akshare 交易日历；akshare 拉取失败时退化为「只跳过周末」
NO_PROXY="*" no_proxy="*" python3 -c "
import datetime, sys
today = datetime.date.today().strftime('%Y-%m-%d')
try:
    import akshare as ak
    df = ak.tool_trade_date_hist_sina()
    dates = set(str(x) for x in df['trade_date'].tolist())
    sys.exit(0 if today in dates else 1)
except Exception:
    sys.exit(0 if datetime.date.today().weekday() < 5 else 1)
"
if [ $? -ne 0 ]; then
  log "${TODAY} ${HOUR_MIN} 非交易日（周末/法定节假日），跳过"
  exit 0
fi

# 2. 跑盘后刷新（caffeinate -i 防止运行期间系统睡眠中断）
log "${TODAY} ${HOUR_MIN} 交易日，开始盘后刷新..."
cd "$PROJECT_DIR"
caffeinate -i ./refresh_data.sh >> "$LOG_FILE" 2>&1
RC=$?
log "${TODAY} ${HOUR_MIN} 刷新结束（exit=${RC}）"
exit "$RC"