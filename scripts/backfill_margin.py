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
import akshare as ak
import json
import os
import time
import warnings

warnings.filterwarnings('ignore')

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'public', 'data.json'))


def _fetch_margin_history():
    """返回 list[dict{date, margin_balance, margin_balance_diff, sh_close}],失败返 None"""
    df = None
    for attempt in range(5):
        try:
            df = ak.macro_china_market_margin_sh()
            if df is not None and len(df) > 0:
                break
            print(f"    融资融券 第 {attempt + 1} 次:返空,重试...")
        except Exception as e:
            print(f"    融资融券 第 {attempt + 1} 次 失败: {e}")
        time.sleep(2)
    if df is None or len(df) == 0:
        return None
    df = df.tail(60).copy()
    df['日期'] = df['日期'].astype(str)
    # 同期沪市收盘(双 Y 轴用)
    sh_map = {}
    try:
        idx = ak.stock_zh_index_daily(symbol='sh000001')
        idx['date'] = idx['date'].astype(str)
        sh_map = dict(zip(idx['date'], idx['close']))
    except Exception:
        pass
    out = []
    for _, r in df.iterrows():
        d = r['日期']
        mb = round(float(r['融资余额']) / 1e8, 2)  # 元 → 亿
        sc = sh_map.get(d)
        out.append({
            'date': d,
            'margin_balance': mb,
            'margin_balance_diff': 0,  # 下面算
            'sh_close': round(float(sc), 2) if sc is not None else None,
        })
    for i in range(1, len(out)):
        out[i]['margin_balance_diff'] = round(out[i]['margin_balance'] - out[i - 1]['margin_balance'], 2)
    return out


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