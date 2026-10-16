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
  --gate  校验关键数据是否真的是"最近一个交易日的盘后快照"：
            行情主体 data.json 有问题 → exit 1（让 job 变红）
            轮动归档 rotation.json 有问题 → 只出 ::warning::，**不阻断流程**

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
MIN_SECTORS = 500               # 板块全集约 663(行业128+概念504+地域31)；低于此视为归档残缺
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


def check_rotation_shape() -> list[str]:
    """板块数健全性检查：归档必须覆盖完整板块全集（663 个：行业128 + 概念504 + 地域31）。

    2026-10-16 实测事故：东财在成功返回第 1 个板块（青海）后开始风控，其余 662 个全失败，
    而 fetch_rotation.py 当时只拦"全部失败"，于是写出了只有 1 个板块的残缺归档并上线：
    排名池 n=1 时该板块每天都同时进涨幅榜与跌幅榜 → 页面上出现"强势 60 次 + 弱势 60 次"的
    矛盾数据，还把上一份完整的 663 板块归档覆盖掉了。
    单看 data.json 完全发现不了这件事（它的 tradeDate 是新鲜的），所以必须单独盯"板块数"。
    这类是**数据损坏**（上线的是错的），比"没更新"更严重，故计入硬问题。
    """
    j = load_json("public/rotation.json")
    if j is None:
        return []
    n = len(j.get("sectors") or [])
    declared = (j.get("meta") or {}).get("sectorCount")
    if n < MIN_SECTORS:
        return [
            f"rotation.json 板块数塌缩：实际 {n} 个（meta.sectorCount={declared}），低于 {MIN_SECTORS} —— 归档残缺、全站统计会失真"
        ]
    return []


def inspect(now: datetime.datetime, dates: list[str]) -> tuple[list[str], list[str], str, bool]:
    """返回 (硬问题, 软问题, 目标交易日, 交易日历是否可信)。

    为什么要把问题分软硬：
      · 硬 = data.json（行情主体）。它断供就意味着整个站点数据停摆，必须让 job 变红。
      · 软 = rotation.json（轮动归档）。它依赖东财 push2his，海外 IP 极易被风控，
        属"高发但可容忍"的失败 —— 用户确认降级为**警告**，不阻断流程。
    例外：轮动归档的"板块数塌缩"属于数据损坏（上线的是错的、而非没更新），
    因此归到硬问题里 —— 这类必须变红。
    """
    target, strict = resolve_target(now, dates)
    hard = check_file("data.json（行情主体）", "public/data.json", target, "tradeDate", "compact")
    soft = check_file("rotation.json（轮动归档）", "public/rotation.json", target, "lastTradeDate", "dash")
    hard += check_rotation_shape()   # 板块数塌缩=数据损坏,计入硬问题(见其 docstring)
    return hard, soft, target, strict


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
    hard, soft, target, _strict = inspect(now, dates)
    stale = bool(hard or soft)   # 轮动数据过期同样值得补跑一次（judge 用，与"是否让 job 变红"无关）
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
    hard, soft, target, strict = inspect(now, dates)
    if not hard and not soft:
        print(f"✅ 数据新鲜度校验通过（目标交易日 {target}）")
        return 0
    if not strict:
        # 交易日历不可靠时只告警，不误判成失败（例如节假日遇 akshare 风控）
        print("::warning::无法获取可靠交易日历，以下仅为提示，不判定失败：")
        for p in soft + hard:
            print(f"  - {p}")
        return 0
    # 软问题（轮动归档）只告警，不阻断流程
    for p in soft:
        print(f"::warning::轮动归档未更新（不阻断流程）：{p}")
    if not hard:
        print(f"⚠️ 行情主体已是最新（目标交易日 {target}），仅轮动归档滞后")
        return 0
    print("::error::数据新鲜度校验未通过（行情主体不是最近交易日的盘后快照）：")
    for p in hard:
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
