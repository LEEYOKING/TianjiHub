#!/usr/bin/env python3
"""
v2.0.7cw: 快速拉 8/17 收盘数据(只用 sina 55 页累加 + akshare 涨停/跌停/可转债/ETF/融资)
跳过 fetch_real_data.py 里 fetch_surgery/akshare 涨停池等慢的部分
目的:让 user 5 分钟拿到 baseData 8/17 收盘,不用等 GitHub Actions cron

用法:
  cd ~/tianjishu-a
  python3 scripts/quick_fetch_8_17.py
  # 跑完 public/data.json tradeDate = 20260817
  git add public/data.json
  git commit -m "data: 快速 8/17 收盘 baseData"
  git push origin main
"""
import json
import os
import sys
import subprocess
import urllib.request
from datetime import datetime, timedelta
import time

TODAY = datetime.now()
TRADE_DATE = TODAY.strftime('%Y%m%d')
TRADE_DATE_DASH = TODAY.strftime('%Y-%m-%d')
TRADE_DATE_SLASH = TODAY.strftime('%y/%m/%d')
OUT = 'public/data.json'

print(f"=== quick_fetch_8_17.py ===")
print(f"目标日期: {TRADE_DATE} ({TRADE_DATE_DASH})")
print(f"输出: {OUT}")
print()

def _subprocess_run(cmd, **kw):
    return subprocess.run(cmd, **kw)

# 读 HEAD data.json 保留其他字段(涨停池/龙虎榜/历史/板块等)
HEAD_DATA = None
try:
    res = _subprocess_run(['git', 'show', f'HEAD:{OUT}'], capture_output=True, timeout=10)
    if res.returncode == 0 and res.stdout:
        HEAD_DATA = json.loads(res.stdout.decode('utf-8'))
        print(f"✓ 从 git HEAD 读 {OUT} ({len(json.dumps(HEAD_DATA))} bytes)")
except Exception as e:
    print(f"⚠️ 读 git HEAD 失败: {e}")
    HEAD_DATA = None

if HEAD_DATA is None:
    print("❌ 必须先 git clone 这个 repo(从 git HEAD 读 baseData)")
    sys.exit(1)

# ============ 1. 拉 sina 55 页全市场累加 ============
print("\n[1/3] 拉 sina 全市场 55 页...")
all_stocks = []
TOTAL_PAGES = 55
CONCURRENCY = 10
SINA_API = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData'

import concurrent.futures

def fetch_page(page):
    try:
        url = f"{SINA_API}?num=100&page={page}&sort=code&asc=1&node=hs_a"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            text = resp.read().decode('utf-8', errors='ignore')
            return json.loads(text)
    except Exception as e:
        return []

for i in range(1, TOTAL_PAGES + 1, CONCURRENCY):
    batch_pages = list(range(i, min(i + CONCURRENCY, TOTAL_PAGES + 1)))
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        results = list(executor.map(fetch_page, batch_pages))
    for r in results:
        all_stocks.extend(r)
    if all(r == [] for r in results):
        break  # 全空就停
    if i + CONCURRENCY < TOTAL_PAGES + 1:
        time.sleep(0.05)
    print(f"  已累加 {len(all_stocks)} 只 (page {i}-{i+CONCURRENCY-1})")

# 累加统计
up = down = flat = 0
total = 0.0
lu = ld = 0
dist = {
    'down_ge_10': 0, 'down_10_to_7': 0, 'down_7_to_5': 0,
    'down_5_to_3': 0, 'down_3_to_0': 0, 'flat': 0,
    'up_0_to_3': 0, 'up_3_to_5': 0, 'up_5_to_7': 0,
    'up_7_to_10': 0, 'up_ge_10': 0,
}
for s in all_stocks:
    cp = float(s.get('changepercent', 0))
    amt = float(s.get('amount', 0) or 0)
    if cp > 0: up += 1
    elif cp < 0: down += 1
    else: flat += 1
    if cp < -10: dist['down_ge_10'] += 1
    elif cp < -7: dist['down_10_to_7'] += 1
    elif cp < -5: dist['down_7_to_5'] += 1
    elif cp < -3: dist['down_5_to_3'] += 1
    elif cp < 0: dist['down_3_to_0'] += 1
    elif cp == 0: dist['flat'] += 1
    elif cp < 3: dist['up_0_to_3'] += 1
    elif cp < 5: dist['up_3_to_5'] += 1
    elif cp < 7: dist['up_5_to_7'] += 1
    elif cp < 10: dist['up_7_to_10'] += 1
    else: dist['up_ge_10'] += 1
    if 9.97 <= cp < 11 or 19.97 <= cp < 21: lu += 1
    if -11 < cp <= -9.97 or -21 < cp <= -19.97: ld += 1
    total += amt

total_turnover = round(total / 1e8, 2)  # 元 → 亿
mkt_total = up + down + flat
up_pct = round(up * 10000 / mkt_total / 100, 2) if mkt_total > 0 else 0
print(f"  sina 累加: 涨={up} 跌={down} 平={flat} (共 {mkt_total} 只)")
print(f"  成交额={total_turnover} 亿 涨停={lu} 跌停={ld}")

# ============ 2. 拉 em push2 ETF / 可转债 ============
print("\n[2/3] 拉 em ETF + 可转债 (10s 限流)...")

def fetch_em(fs, pz=2000):
    for domain in ['https://push2.eastmoney.com', 'https://82.push2.eastmoney.com', 'https://push2his.eastmoney.com']:
        try:
            url = f"{domain}/api/qt/clist/get?pn=1&pz={pz}&po=1&fid=f3&fs={fs}&fields=f12,f3"
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://quote.eastmoney.com/',
            })
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
                return data.get('data', {}).get('diff', [])
        except:
            continue
    return []

# ETF 沪深 m:0+t:9,m:1+t:9
etf_list = fetch_em('m:0+t:9,m:1+t:9', 2000)
etf_up = sum(1 for s in etf_list if float(s.get('f3', 0)) > 0.01)
etf_down = sum(1 for s in etf_list if float(s.get('f3', 0)) < -0.01)
etf_flat = len(etf_list) - etf_up - etf_down
print(f"  ETF: 涨={etf_up} 跌={etf_down} 平={etf_flat} (共 {len(etf_list)} 只)")

# 可转债 沪深 m:128+t:4,m:129+t:4
bond_list = fetch_em('m:128+t:4,m:129+t:4', 2000)
bond_up = sum(1 for s in bond_list if float(s.get('f3', 0)) > 0.01)
bond_down = sum(1 for s in bond_list if float(s.get('f3', 0)) < -0.01)
bond_flat = len(bond_list) - bond_up - bond_down
print(f"  可转债: 涨={bond_up} 跌={bond_down} 平={bond_flat} (共 {len(bond_list)} 只)")

# ============ 3. 写 public/data.json(保留 HEAD 其他字段) ============
print("\n[3/3] 写 public/data.json...")

# 计算 turnoverDiff(今日 - 上一交易日)
last_2 = HEAD_DATA.get('history', [])
yesterday_vol = last_2[-1].get('volume', 0) if last_2 else 0
turnover_diff = round(total_turnover - yesterday_vol, 2)

# 改写 marketOverview 关键字段(涨停池/龙虎榜/行业/概念保留 HEAD 不动)
mo = HEAD_DATA['marketOverview']
mo['tradeDate'] = TRADE_DATE
mo['tradeDateDash'] = TRADE_DATE_DASH
mo['tradeDateSlash'] = TRADE_DATE_SLASH
mo['marketTurnover'] = total_turnover
mo['turnoverDiff'] = turnover_diff
mo['upCount'] = up
mo['downCount'] = down
mo['flatCount'] = flat
mo['upPercent'] = up_pct
mo['limitUpCount'] = lu
mo['limitDownCount'] = ld
mo['etfUp'] = etf_up
mo['etfDown'] = etf_down
mo['etfFlat'] = etf_flat
mo['bondUp'] = bond_up
mo['bondDown'] = bond_down
mo['bondFlat'] = bond_flat
# 涨跌分布(11 档)— 前端期望
mo['changeDistribution'] = {
    'down_ge_10': dist['down_ge_10'], 'down_10_to_7': dist['down_10_to_7'],
    'down_7_to_5': dist['down_7_to_5'], 'down_5_to_3': dist['down_5_to_3'],
    'down_3_to_0': dist['down_3_to_0'], 'flat': dist['flat'],
    'up_0_to_3': dist['up_0_to_3'], 'up_3_to_5': dist['up_3_to_5'],
    'up_5_to_7': dist['up_5_to_7'], 'up_7_to_10': dist['up_7_to_10'],
    'up_ge_10': dist['up_ge_10'],
}
# 删 _fetchError 标记(成功跑)
if '_fetchError' in HEAD_DATA:
    del HEAD_DATA['_fetchError']
if '_fetchTimeIso' in HEAD_DATA:
    del HEAD_DATA['_fetchTimeIso']

# 写文件
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(HEAD_DATA, f, ensure_ascii=False, indent=2)

print(f"\n✓ 写完 {OUT}")
print(f"  tradeDate: {TRADE_DATE} ({TRADE_DATE_DASH})")
print(f"  涨/跌/平: {up}/{down}/{flat}")
print(f"  成交额: {total_turnover} 亿 (增量 {turnover_diff} 亿)")
print(f"  涨停/跌停: {lu}/{ld}")
print(f"  ETF: {etf_up}/{etf_down}/{etf_flat}")
print(f"  可转债: {bond_up}/{bond_down}/{bond_flat}")
print()
print("=== 接下来操作 ===")
print("git add public/data.json")
print('git commit -m "data: 8/17 收盘 quick fetch"')
print("git push origin main")
print()
print("⚠️  涨停池/龙虎榜/板块 — 保留 HEAD 8/16 数据(今晚 fetch_surgery_data 跑后会更新)")
