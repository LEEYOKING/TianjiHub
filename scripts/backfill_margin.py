"""
次日早晨补抓融资融券(marginHistory)。

背景:交易所的融资融券数据在 T 日盘后**延迟发布**(实测 T 日 22:10 抓不到 T 日终值),
导致线上"融资流向"长期落后 1 个交易日;若 T 之后是连续假期(如国庆),假期内无 cron,
就会一直停在 T-1 日,直到下个交易日才补齐。

本脚本只做一件事:重新拉最近 60 个交易日的融资融券,覆盖写回 data.json 的
marketOverview.marginHistory。**不动其它任何字段**,因此在盘前/假期运行也绝对安全
(不会像 fetch_real_data.py 那样产生"今日"假数据)。

用法:python3 scripts/backfill_margin.py
"""
# 兼容 Python 3.9(macOS 自带)
from __future__ import annotations
import json
import os
import warnings

warnings.filterwarnings('ignore')

# 与 fetch_real_data.py 共用同一份多源实现：上交所官方优先、金十镜像兜底。
# 2026-11-10 起金十镜像停更(线上融资流向卡在 11-05 的原因)，不可再单独依赖。
from margin_history import fetch_margin_history

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'public', 'data.json'))


def _fetch_margin_history():
    """返回 list[dict{date, margin_balance, margin_balance_diff, sh_close}],失败返 None"""
    return fetch_margin_history()


def main():
    if not os.path.exists(OUT):
        print(f"data.json 不存在({OUT}),跳过")
        return
    with open(OUT, encoding='utf-8') as f:
        data = json.load(f)

    fresh = _fetch_margin_history()
    if not fresh:
        print("⚠ 融资融券拉取失败,本轮跳过(线上保持原值)")
        return

    mo = data.get('marketOverview') or {}
    old = mo.get('marginHistory') or []
    old_last = old[-1].get('date', '') if old else ''
    new_last = fresh[-1].get('date', '')

    # 无新数据(末点日期没有前进)→ 不写,避免无意义提交
    if old_last and new_last <= old_last:
        print(f"  融资融券无新数据(旧末点 {old_last} ≥ 新末点 {new_last}),跳过写入")
        return

    mo['marginHistory'] = fresh
    data['marketOverview'] = mo
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"  ✓ 已补抓融资融券:末点 {old_last or '空'} → {new_last},{len(fresh)} 天")
    print(f"    最新:{fresh[-1]}")


if __name__ == '__main__':
    main()