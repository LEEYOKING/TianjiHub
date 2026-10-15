#!/usr/bin/env python3
"""盘后数据新鲜度检查 —— 用于 GitHub Actions 的「任务规划」与「失败可见化」

为什么需要它（2026-10-14 实测事故）：
  · GitHub Actions 免费额度的 cron 延迟极严重：应 15:35 跑的任务实测拖到 23:13，
    应 18:35 的拖到次日 01:45；
  · 海外 IP 抓国内财经接口（akshare/东财/新浪/腾讯）会遇风控 —— 盘后档经常整档失败；
  · 而失败原本是**静默**的：轮动归档步骤带 continue-on-error，job 依旧显示绿色，
    线上只表现为"报告日期不动"，要等用户自己发现。
  · 另有一个更隐蔽的坑：如果在**盘中**跑 fetch_real_data.py，会把盘中快照当收盘数据写进去
    （成交额/涨跌家数严重失真），必须从流程上拦住。

两种模式：
  --plan  决定本次运行要做什么，输出 mode=… 到 stdout（供 GITHUB_OUTPUT 使用），**永远 exit 0**
  --gate  校验关键数据是否真的是"最近一个交易日的盘后快照"，有问题则 exit 1（让 job 变红）

mode 取值：
  margin     只跑 08:30 的融资补抓档（与既有行为一致，不加交易日门槛）
  postclose  跑完整盘后流程（行情 + 手术台 + 轮动归档）
  skip       什么都不跑（非交易日且数据不旧 / 盘中保护 / 补跑档且数据已新鲜）
"""

import datetime
import json
import os
import sys

# ---------------- 常量 ----------------
CST = datetime.timezone(datetime.timedelta(hours=8))
MARKET_OPEN = "09:30"
MARKET_CLOSE = "15:00"          # 15:00 整点视为已收盘
CLOSE_READY = "15:05"           # 该时点之后，当日收盘数据才算可取
MARGIN_SLOT = "30 0 * * 1-5"                      # 08:30 CST 融资补抓档
RESCUE_SLOTS = ("0 14 * * 1-5", "0 22 * * 1-5")   # 22:00 CST / 次日 06:00 CST 补跑档


# ---------------- 时间与交易日 ----------------
def now_cst() -> datetime.datetime:
    return datetime.datetime.now(CST)


def trade_dates() -> list[str]:
    """A 股交易日历（升序 YYYY-MM-DD）。取不到时返回空列表（调用方会降级）。"""
    try:
        import akshare as ak  # 延迟导入：本地/CI 都可能因风控失败
        df = ak.tool_trade_date_hist_sina()
        return sorted(str(x) for x in df["trade_date"].tolist())
    except Exception as e:  # noqa: BLE001
        print(f"! 交易日历获取失败，降级为「仅工作日」判断：{e}")
        return []


def resolve_target(now: datetime.datetime, dates: list[str]) -> tuple[str, bool]:
    """返回 (目标交易日 YYYY-MM-DD, 是否可信)。

    规则：目标 = 最近一个**已完成收盘**的交易日
      · 今天是交易日且已过 15:05 → 目标就是今天
      · 否则 → 今天之前最近的一个交易日（今天是交易日时即上一交易日；
        今天是非交易日时即上一个交易日，例如周六早上目标=周五）
    交易日历不可用时退化为"最近的工作日"，并标记不可信（gate 只告警不失败）。
    """
    today = now.strftime("%Y-%m-%d")
    hhmm = now.strftime("%H:%M")
    if dates:
        strict = True
        earlier = [d for d in dates if d < today]
        if today in dates and hhmm >= CLOSE_READY:
            return today, strict
        if earlier:
            return earlier[-1], strict
        return today, strict
    # 降级：最近的工作日（含今天，若今天不是周末）
    strict = False
    d = now.date()
    while d.weekday() >= 5:
        d -= datetime.timedelta(days=1)
    if d == now.date() and hhmm < CLOSE_READY:
        d -= datetime.timedelta(days=1)
        while d.weekday() >= 5:
            d -= datetime.timedelta(days=1)
    return d.strftime("%Y-%m-%d"), strict


def is_trading_today(now: datetime.datetime, dates: list[str]) -> bool:
    today = now.strftime("%Y-%m-%d")
    if dates:
        return today in dates
    return now.weekday() < 5


# ---------------- 数据文件体检 ----------------
def load_json(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return None


def check_file(label: str, path: str, target: str, date_key: str, fmt: str) -> list[str]:
    """校验一个数据文件：日期字段是否等于目标交易日、生成时点是否落在盘中。

    fmt: 'dash' = YYYY-MM-DD（rotation.json 的 meta.lastTradeDate）
         'compact' = YYYYMMDD（data.json 的 meta.tradeDate）
    """
    problems: list[str] = []
    j = load_json(path)
    if j is None:
        return [f"{label} 无法读取（{path}）"]

    meta = j.get("meta") or {}
    raw = str(meta.get(date_key) or "")
    if fmt == "compact":
        got = f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}" if len(raw) == 8 else ""
    else:
        got = raw

    if got != target:
        problems.append(f"{label} 仍停留在 {got or '未知'}，而最近该完成的交易日是 {target}")

    gen = str(meta.get("generatedAt") or "")
    if len(gen) >= 16 and got and gen[:10] == got:
        hhmm = gen[11:16]
        if MARKET_OPEN <= hhmm < MARKET_CLOSE:
            problems.append(
                f"{label} 的生成时点 {gen} 落在盘中（{MARKET_OPEN}~{MARKET_CLOSE}），不是盘后快照"
            )
    return problems


def inspect(now: datetime.datetime, dates: list[str]) -> tuple[list[str], str, bool]:
    target, strict = resolve_target(now, dates)
    problems: list[str] = []
    problems += check_file("data.json（行情主体）", "public/data.json", target, "tradeDate", "compact")
    problems += check_file("rotation.json（轮动归档）", "public/rotation.json", target, "lastTradeDate", "dash")
    return problems, target, strict


# ---------------- 模式：--plan ----------------
def emit(mode: str, reason: str, now: datetime.datetime, target: str) -> None:
    print(f"mode={mode}")
    print(f"（{now.strftime('%Y-%m-%d %H:%M')} CST · 目标交易日 {target}）{reason}")
    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a", encoding="utf-8") as f:
            f.write(f"mode={mode}\n")


def plan(now: datetime.datetime, dates: list[str], schedule: str, manual: bool) -> tuple[str, str]:
    """决定本次运行做什么。返回 (mode, 说明)。"""
    problems, target, _strict = inspect(now, dates)
    stale = len(problems) > 0
    trading = is_trading_today(now, dates)
    hhmm = now.strftime("%H:%M")

    # 1) 08:30 融资补抓档：行为与既有完全一致（不加交易日门槛）
    if schedule == MARGIN_SLOT:
        return "margin", "08:30 融资补抓档"

    # 2) 盘中保护：交易日 09:30~15:00 一律不跑盘后流程
    #    （防止手动触发或异常调度的 cron 把盘中快照当收盘数据写进 data.json）
    if trading and MARKET_OPEN <= hhmm < MARKET_CLOSE:
        return "skip", f"现在是盘中（{MARKET_OPEN}~{MARKET_CLOSE}），拒绝拉取，避免盘中快照污染 data.json"

    # 3) 补跑档（22:00 / 次日 06:00）：只在数据真的过期时才跑
    #    注意这里**不看**"今天是不是交易日" —— 周六早上发现周五数据缺失，正需要它来补
    if schedule in RESCUE_SLOTS:
        if stale:
            return "postclose", "补跑档：检测到关键数据仍未更新，执行完整盘后流程"
        return "skip", "补跑档：数据已是最新，无需补跑（省额度）"

    # 4) 常规盘后档（15:35 / 18:35）与手动触发
    if not trading:
        # 非交易日：数据不旧就跳过；若确实旧（例如前一交易日漏跑），补一次
        if stale:
            return "postclose", "非交易日，但检测到数据过期，执行补跑"
        return "skip", "非交易日且数据已是最新"
    return "postclose", ("手动触发" if manual else "常规盘后档")


# ---------------- 模式：--gate ----------------
def gate(now: datetime.datetime, dates: list[str]) -> int:
    problems, target, strict = inspect(now, dates)
    if not problems:
        print(f"✅ 数据新鲜度校验通过（目标交易日 {target}）")
        return 0
    if not strict:
        # 交易日历不可靠时只告警，不误判成失败（例如节假日遇 akshare 风控）
        print("::warning::无法获取可靠交易日历，以下仅为提示，不判定失败：")
        for p in problems:
            print(f"  - {p}")
        return 0
    print("::error::数据新鲜度校验未通过（关键数据不是最近交易日的盘后快照）：")
    for p in problems:
        print(f"::error::{p}")
    return 1


def main() -> int:
    mode_flag = sys.argv[1] if len(sys.argv) > 1 else "--plan"
    now = now_cst()
    dates = trade_dates()

    if mode_flag == "--gate":
        return gate(now, dates)

    schedule = os.environ.get("SCHEDULE_CRON", "")
    manual = os.environ.get("GITHUB_EVENT_NAME", "") == "workflow_dispatch"
    m, reason = plan(now, dates, schedule, manual)
    target, _strict = resolve_target(now, dates)
    emit(m, reason, now, target)
    return 0


if __name__ == "__main__":
    sys.exit(main())
