"""融资融券（沪市融资余额）历史抓取 —— 多源，取最新的一份。

2026-11-10 事故：原唯一数据源 akshare.macro_china_market_margin_sh 实际请求的是
金十数据的 CDN（cdn.jin10.com/data_center/reports/fs_1.json）—— 第三方镜像，会静默停更。
该镜像从 2026-11-06 起不再追加数据，于是线上「融资流向」一直停在 11-05，
而 data.json 本身每天正常更新（tradeDate 已经是 11-09），表面看就是"只有这一张图不动"。

上交所官方接口（akshare.stock_margin_sse）同一天已有 11-06 / 11-09 的完整数据，
且两源在 11-05 的融资余额完全一致（1180797811849 元），口径可无缝衔接。

策略：两个源都试，谁返回的最新日期更晚就用谁（官方源优先作为并列时的选择），
都失败才返回 None —— 调用方据此保持原值、不写脏数据。
"""

from __future__ import annotations

import datetime
import time
import warnings

warnings.filterwarnings("ignore")

DAYS = 60            # 归档/展示窗口（交易日）
CALENDAR_DAYS = 130  # 取数窗口的自然日（> 60 个交易日的 1.9 倍余量）


def _sse(days: int):
    """上交所官方：返回 [(date 'YYYY-MM-DD', 融资余额 元), ...] 升序；失败返 None"""
    import akshare as ak

    end = datetime.date.today()
    start = end - datetime.timedelta(days=CALENDAR_DAYS)
    for attempt in range(3):
        try:
            df = ak.stock_margin_sse(
                start_date=start.strftime("%Y%m%d"),
                end_date=end.strftime("%Y%m%d"),
            )
            if df is not None and len(df) > 0:
                rows = []
                for _, r in df.iterrows():
                    d = str(r["信用交易日期"]).strip()
                    if len(d) == 8 and d.isdigit():
                        d = f"{d[:4]}-{d[4:6]}-{d[6:8]}"
                    rows.append((d, float(r["融资余额"])))
                rows.sort(key=lambda x: x[0])
                return rows
            print(f"    上交所融资融券 第 {attempt + 1} 次:返空")
        except Exception as e:  # noqa: BLE001
            print(f"    上交所融资融券 第 {attempt + 1} 次失败: {type(e).__name__} {e}")
        time.sleep(2)
    return None


def _jin10(days: int):
    """金十数据镜像（原数据源）：返回同结构；失败返 None"""
    import akshare as ak

    for attempt in range(2):
        try:
            df = ak.macro_china_market_margin_sh()
            if df is not None and len(df) > 0:
                rows = [(str(r["日期"]), float(r["融资余额"])) for _, r in df.iterrows()]
                rows.sort(key=lambda x: x[0])
                return rows
        except Exception as e:  # noqa: BLE001
            print(f"    金十融资融券 第 {attempt + 1} 次失败: {type(e).__name__} {e}")
        time.sleep(2)
    return None


def _sh_close():
    """沪指收盘价 map；失败返空 dict（图表双 Y 轴会缺一列，不影响主数据）"""
    try:
        import akshare as ak

        df = ak.stock_zh_index_daily(symbol="sh000001")
        return dict(zip(df["date"].astype(str), df["close"]))
    except Exception as e:  # noqa: BLE001
        print(f"    沪指日线获取失败（不影响融资余额）: {type(e).__name__} {e}")
        return {}


def fetch_margin_history(days: int = DAYS):
    """返回 list[dict{date, margin_balance, margin_balance_diff, sh_close}]，全失败返 None"""
    sse = _sse(days)
    jin10 = _jin10(days)
    candidates = [x for x in (sse, jin10) if x]
    if not candidates:
        return None

    best = max(candidates, key=lambda rows: rows[-1][0])
    src = "上交所官方" if best is sse else "金十镜像"
    rows = best[-(days + 1):]   # 多取一天，保证首日也能算出净流入

    sh_map = _sh_close()
    out = []
    for d, yuan in rows:
        sc = sh_map.get(d)
        out.append({
            "date": d,
            "margin_balance": round(yuan / 1e8, 2),  # 元 → 亿
            "margin_balance_diff": 0,
            "sh_close": round(float(sc), 2) if sc is not None else None,
        })
    for i in range(1, len(out)):
        out[i]["margin_balance_diff"] = round(
            out[i]["margin_balance"] - out[i - 1]["margin_balance"], 2
        )
    out = out[-days:]
    print(f"    融资融券来源: {src}，末点 {out[-1]['date']}，{len(out)} 天")
    return out
