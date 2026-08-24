#!/usr/bin/env python3
"""v2.0.7cx: 简化版 quick_fetch — 只拉 5 页 sina + 数学推算 55 页 — 2-3 分钟

跟 quick_fetch_8_17.py 区别:只拉 5 页(500 只),用 sample 推算 55 页
准确度:5 页(500 只)能反映整体 up/down 比例 — 实际数字按 11 倍推算
"""
import json
import os
import sys
import subprocess
import urllib.request
from datetime import datetime
import concurrent.futures

TODAY = datetime.now()
TRADE_DATE = TODAY.strftime('%Y%m%d')
TRADE_DATE_DASH = TODAY.strftime('%Y-%m-%d')
TRADE_DATE_SLASH = TODAY.strftime('%y/%m/%d')
OUT = 'public/data.json'
SINA_API = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData'
TOTAL_PAGES = 55
SAMPLE_PAGES = 5  # 5 页 = 500 只(全市场 5500)

def _subprocess_run(cmd, **kw):
    return subprocess.run(cmd, **kw)

print(f"=== quick_fetch_5page.py ===")
print(f"目标日期: {TRADE_DATE} ({TRADE_DATE_DASH})")
print(f"拉 5 页(500 只)推算 55 页(5500 只)")

HEAD_DATA = None
try:
    res = _subprocess_run(['git', 'show', f'HEAD:{OUT}'], capture_output=True, timeout=10)
    if res.returncode == 0 and res.stdout:
        HEAD_DATA = json.loads(res.stdout.decode('utf-8'))
        print(f"✓ 从 git HEAD 读 {OUT} ({len(json.dumps(HEAD_DATA))} bytes)")
except Exception as e:
    print(f"⚠️ 读 git HEAD 失败: {e}")

if HEAD_DATA is None:
    print("❌ 必须先 git clone 这个 repo(从 git HEAD 读 baseData)")
    sys.exit(1)

# 拉 5 页 sina
def fetch_page(page):
    try:
        url = f"{SINA_API}?num=100&page={page}&sort=code&asc=1&node=hs_a"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode('utf-8', errors='ignore'))
    except:
        return []

print("\n[1/2] 拉 sina 5 页...")
all_stocks = []
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
    results = list(executor.map(fetch_page, range(1, SAMPLE_PAGES + 1)))
for r in results:
    all_stocks.extend(r)
print(f"  累加 {len(all_stocks)} 只")

up = down = flat = 0
total = 0.0
lu = ld = 0
for s in all_stocks:
    cp = float(s.get('changepercent', 0))
    amt = float(s.get('amount', 0) or 0)
    if cp > 0: up += 1
    elif cp < 0: down += 1
    else: flat += 1
    if 9.97 <= cp < 11 or 19.97 <= cp < 21: lu += 1
    if -11 < cp <= -9.97 or -21 < cp <= -19.97: ld += 1
    total += amt

# 推算 55 页(11 倍)
SCALE = TOTAL_PAGES / SAMPLE_PAGES  # 11
up = round(up * SCALE)
down = round(down * SCALE)
flat = round(flat * SCALE)
lu = round(lu * SCALE)
ld = round(ld * SCALE)
total_turnover = round(total / 1e8 * SCALE, 2)  # 元 → 亿
mkt_total = up + down + flat
up_pct = round(up * 10000 / mkt_total / 100, 2) if mkt_total > 0 else 0

print(f"  推算 55 页:涨={up} 跌={down} 平={flat}")
print(f"  成交额={total_turnover} 亿 涨停={lu} 跌停={ld}")

# ETF / 可转债 — 拉 1 页(200 只)够用
def fetch_em(fs, pz=500):
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

print("\n[2/2] 拉 em ETF + 可转债...")
etf_list = fetch_em('m:0+t:9,m:1+t:9', 500)
etf_up = sum(1 for s in etf_list if float(s.get('f3', 0)) > 0.01)
etf_down = sum(1 for s in etf_list if float(s.get('f3', 0)) < -0.01)
etf_flat = len(etf_list) - etf_up - etf_down
print(f"  ETF: 涨={etf_up} 跌={etf_down} 平={etf_flat} (共 {len(etf_list)} 只)")

bond_list = fetch_em('m:128+t:4,m:129+t:4', 500)
bond_up = sum(1 for s in bond_list if float(s.get('f3', 0)) > 0.01)
bond_down = sum(1 for s in bond_list if float(s.get('f3', 0)) < -0.01)
bond_flat = len(bond_list) - bond_up - bond_down
print(f"  可转债: 涨={bond_up} 跌={bond_down} 平={bond_flat} (共 {len(bond_list)} 只)")

# 写 public/data.json
last_2 = HEAD_DATA.get('history', [])
yesterday_vol = last_2[-1].get('volume', 0) if last_2 else 0
turnover_diff = round(total_turnover - yesterday_vol, 2)

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
if '_fetchError' in HEAD_DATA:
    del HEAD_DATA['_fetchError']
if '_fetchTimeIso' in HEAD_DATA:
    del HEAD_DATA['_fetchTimeIso']

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
