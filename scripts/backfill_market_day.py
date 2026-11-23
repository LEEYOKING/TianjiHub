#!/usr/bin/env python3
"""回补某个交易日的「涨跌家数 / 成交额 / 涨跌停」到 public/data.json 的 history。

背景（2026-11-20）：
  那次整档运行在「拉取手术台」步骤挂住 53 分钟被超时杀掉，当天全市场快照永久丢失；
  而 history 的涨跌家数只有「当天快照」一个真值来源，错过就断档，折线图缺一格。

做法（不依赖任何"当天快照"）：
  · 涨跌家数：逐只个股拉日线，比较 DATE 收盘 vs 前一交易日收盘 —— 真值
  · 成交额：Σ(收盘价 × 成交量) 得到估算，再用「上一个已知交易日」的真实成交额校准系数
  · 涨跌停：东财涨停池 / 跌停池（支持历史日期）—— 真值

用法：
  python3 scripts/backfill_market_day.py 2026-11-20
"""
import concurrent.futures as cf
import json
import ssl
import sys
import time
import urllib.request

DATA = 'public/data.json'
UA = {'User-Agent': 'Mozilla/5.0'}
_SSL = ssl._create_unverified_context()


def http_get(url, referer='https://finance.sina.com.cn/', timeout=15):
    req = urllib.request.Request(url, headers={**UA, 'Referer': referer})
    return urllib.request.urlopen(req, timeout=timeout, context=_SSL).read()


def sina_stock_codes():
    """新浪 hs_a 节点分页取全市场 A 股代码（约 60 页 × 100）。"""
    codes = []
    for p in range(1, 80):
        url = (
            'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/'
            f'Market_Center.getHQNodeData?num=100&page={p}&sort=symbol&asc=1&node=hs_a&_={int(time.time() * 1000)}'
        )
        try:
            rows = json.loads(http_get(url).decode('utf-8', 'ignore'))
        except Exception as e:
            print(f'  代码表第 {p} 页失败: {e}')
            break
        if not isinstance(rows, list) or not rows:
            break
        codes += [r['symbol'] for r in rows]
        if len(rows) < 100:
            break
        time.sleep(0.05)
    return codes


def tencent_daily(sym, end_date, n=8):
    """腾讯日线：返回 {YYYY-MM-DD: (收盘价, 成交量/手)}。"""
    url = f'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={sym},day,,{end_date},{n},qfq'
    try:
        j = json.loads(http_get(url, 'https://gu.qq.com/').decode('utf-8', 'ignore'))
        node = (j.get('data') or {}).get(sym) or {}
        rows = node.get('qfqday') or node.get('day') or []
        out = {}
        for r in rows:
            if len(r) >= 6:
                try:
                    out[str(r[0])] = (float(r[2]), float(r[5]))
                except (TypeError, ValueError):
                    pass
        return out
    except Exception:
        return {}


def limit_counts(date_compact):
    """东财涨停池 / 跌停池家数（支持历史日期）。"""
    try:
        import akshare as ak
        up = len(ak.stock_zt_pool_em(date=date_compact))
        down = len(ak.stock_zt_pool_dtgc_em(date=date_compact))
        return up, down
    except Exception as e:
        print(f'  ! 涨跌停池获取失败: {e}')
        return None, None


def main():
    if len(sys.argv) < 2:
        print('用法: python3 scripts/backfill_market_day.py YYYY-MM-DD')
        sys.exit(2)
    date = sys.argv[1]
    date_compact = date.replace('-', '')

    d = json.load(open(DATA, encoding='utf-8'))
    history = d.get('history') or []
    dates = [h['date'] for h in history]
    if date in dates:
        print(f'{date} 已在 history 中，将覆盖为真值')
    prev_dates = [x for x in dates if x < date]
    if not prev_dates:
        print('错误：history 里找不到上一个交易日，无法校准')
        sys.exit(1)
    prev_date = prev_dates[-1]
    prev_real = next(h for h in history if h['date'] == prev_date)
    print(f'目标日 {date} / 校准基准 {prev_date}（真实成交额 {prev_real.get("volume")} 亿）')

    codes = sina_stock_codes()
    print(f'全市场代码 {len(codes)} 只，开始逐只拉腾讯日线…')
    t0 = time.time()
    stats = {date: {'up': 0, 'down': 0, 'flat': 0, 'vol': 0.0},
             prev_date: {'up': 0, 'down': 0, 'flat': 0, 'vol': 0.0}}
    done = 0

    def work(sym):
        return tencent_daily(sym, date)

    with cf.ThreadPoolExecutor(max_workers=12) as ex:
        for kl in ex.map(work, codes):
            done += 1
            if done % 1000 == 0:
                print(f'  …{done}/{len(codes)}')
            ks = sorted(kl.keys())
            if date not in kl:
                continue
            i = ks.index(date)
            if i == 0:
                continue
            prev_k = ks[i - 1]
            c, _v = kl[date]
            pc, _pv = kl[prev_k]
            if pc <= 0:
                continue
            pct = (c - pc) / pc * 100
            if pct > 0.005:
                stats[date]['up'] += 1
            elif pct < -0.005:
                stats[date]['down'] += 1
            else:
                stats[date]['flat'] += 1
            stats[date]['vol'] += c * _v * 100 / 1e8
            # 同一批数据顺带算校准日
            if prev_k in kl:
                pc2, pv2 = kl[prev_k]
                j = ks.index(prev_k)
                if j > 0:
                    pp = kl[ks[j - 1]][0]
                    if pp > 0:
                        p2 = (pc2 - pp) / pp * 100
                        if p2 > 0.005:
                            stats[prev_date]['up'] += 1
                        elif p2 < -0.005:
                            stats[prev_date]['down'] += 1
                        else:
                            stats[prev_date]['flat'] += 1
                        stats[prev_date]['vol'] += pc2 * pv2 * 100 / 1e8

    el = time.time() - t0
    s, b = stats[date], stats[prev_date]
    print(f'耗时 {el:.0f}s')
    print(f'{date}: 涨 {s["up"]} 跌 {s["down"]} 平 {s["flat"]} | 成交额估算 {s["vol"]:.2f} 亿')
    print(f'{prev_date}(校准): 涨 {b["up"]} 跌 {b["down"]} 平 {b["flat"]} | 估算 {b["vol"]:.2f} 亿 vs 真实 {prev_real.get("volume")} 亿')

    if s['up'] + s['down'] < 3000:
        print('✗ 样本不足（<3000 只有效），拒绝写入')
        sys.exit(1)
    factor = 1.0
    if b['vol'] > 0 and prev_real.get('volume'):
        factor = float(prev_real['volume']) / b['vol']
        print(f'校准系数 {factor:.4f}')
    volume = round(s['vol'] * factor, 2)

    lu, ld = limit_counts(date_compact)
    print(f'涨跌停：涨停 {lu} / 跌停 {ld}')

    entry = {
        'date': date,
        'volume': volume,
        'limitUp': lu if lu is not None else 0,
        'limitDown': ld if ld is not None else 0,
        'up': s['up'],
        'down': s['down'],
    }
    if date in dates:
        history[dates.index(date)] = entry
    else:
        history.append(entry)
        history.sort(key=lambda x: x['date'])
    d['history'] = history
    with open(DATA, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, separators=(',', ':'))

    # 日历同日摘要（个股榜无历史接口，只能补家数）
    import os
    cal_path = f'public/calendar/{date}.json'
    if os.path.exists(cal_path):
        cal = json.load(open(cal_path, encoding='utf-8'))
        cal['summary'] = {
            'up': s['up'], 'down': s['down'], 'flat': s['flat'],
            'limitUp': lu or 0, 'limitDown': ld or 0,
            'turnover': volume,
        }
        with open(cal_path, 'w', encoding='utf-8') as f:
            json.dump(cal, f, ensure_ascii=False, separators=(',', ':'))
        print(f'已写入 {cal_path} 的 summary')

    print(f'✓ 已回填 {date}: 涨 {s["up"]} / 跌 {s["down"]} / 平 {s["flat"]} / 成交 {volume} 亿 / 涨停 {lu} / 跌停 {ld}')


if __name__ == '__main__':
    main()
