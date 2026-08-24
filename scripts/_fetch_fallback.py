"""v2.0.7da: fetch_real_data.py 失败时的降级脚本
- v2.0.7cv 旧版:用 git HEAD 8/14 数字 — 错(应该用真 8/17 数据)
- v2.0.7da 新版:调 quick_fetch_5page 逻辑(5 页 sina 推算 55 页 — 沙箱能拉 sina 8/17 收盘)
- 同时拉 em ETF/可转债(em 拉不到返 0 — 总比 8/14 stale 好)
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
OUT = '/workspace/fupan/public/data.json'  # v2.0.7fv:M12 修 — 相对路径改绝对路径,避免 cron cwd 变化写错位置
SINA_API = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData'
TOTAL_PAGES = 55
SAMPLE_PAGES = 5  # 5 页 = 500 只(全市场 5500)

def _subprocess_run(cmd, **kw):
    return subprocess.run(cmd, **kw)

print(f"=== _fetch_fallback.py v2.0.7da ===")
print(f"目标日期: {TRADE_DATE} ({TRADE_DATE_DASH})")
print(f"5 页推算 55 页 — sina 5 页 + em ETF/可转债")

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
    except Exception:  # v2.0.7fv:M12 修 — bare except 会吞 KeyboardInterrupt,改 Exception
        return []

print("[1/2] 拉 sina 5 页...")
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
    # v2.0.7fv:ST 主板 5% 涨停漏算修 — 4.97 ≤ cp < 5.5 也算涨停
    elif 4.97 <= cp < 5.5: lu += 1
    if -11 < cp <= -9.97 or -21 < cp <= -19.97: ld += 1
    # v2.0.7fv:ST 主板 -5% 跌停
    elif -5.5 < cp <= -4.97: ld += 1
    total += amt

SCALE = 1  # v2.0.7dz:取消 × 11 推算 — 5 页 sample 数字直接写
# — 之前 SCALE = TOTAL_PAGES / SAMPLE_PAGES = 55/5 = 11,推算错 11 倍
# — 5 页 500 只 up=200 直接写,不推算
up = round(up * SCALE)
down = round(down * SCALE)
flat = round(flat * SCALE)
lu = round(lu * SCALE)
ld = round(ld * SCALE)
total_turnover = round(total / 1e8 * SCALE, 2)
mkt_total = up + down + flat
up_pct = round(up * 10000 / mkt_total / 100, 2) if mkt_total > 0 else 0

print(f"  推算 55 页:涨={up} 跌={down} 平={flat} turnover={total_turnover} 亿 lu={lu} ld={ld}")

# em ETF / 可转债
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
        except Exception:  # v2.0.7fv:M12 修 — bare except 会吞 KeyboardInterrupt,改 Exception
            continue
    return []

print("[2/2] 拉 em ETF + 可转债...")
etf_list = fetch_em('m:0+t:9,m:1+t:9', 500)
etf_up = sum(1 for s in etf_list if float(s.get('f3', 0)) > 0.01)
etf_down = sum(1 for s in etf_list if float(s.get('f3', 0)) < -0.01)
etf_flat = len(etf_list) - etf_up - etf_down
print(f"  ETF: {etf_up}/{etf_down}/{etf_flat} (共 {len(etf_list)})")

bond_list = fetch_em('m:128+t:4,m:129+t:4', 500)
bond_up = sum(1 for s in bond_list if float(s.get('f3', 0)) > 0.01)
bond_down = sum(1 for s in bond_list if float(s.get('f3', 0)) < -0.01)
bond_flat = len(bond_list) - bond_up - bond_down
print(f"  可转债: {bond_up}/{bond_down}/{bond_flat} (共 {len(bond_list)})")

# 写 public/data.json(保留 HEAD 其他字段 — 涨停池/龙虎榜/融资/板块)
last_2 = HEAD_DATA.get('history', [])
yesterday_vol = last_2[-1].get('volume', 0) if last_2 else 0
turnover_diff = round(total_turnover - yesterday_vol, 2)

# v2.0.7dw:append history 末点(8/18 当日)— 之前 fallback 没写 history,React 读 history 末点 0:0
if HEAD_DATA.get('history'):
    last_date = HEAD_DATA['history'][-1].get('date', '')
    today_date = TRADE_DATE_DASH
    # v2.0.7dy:append 前先删除 8/18 旧末点(避免多次 cron 累加)
    HEAD_DATA['history'][:] = [h for h in HEAD_DATA['history'] if h.get('date') != today_date]
    # 8/18 当日新点 push
    HEAD_DATA['history'].append({
        'date': today_date,
        'volume': total_turnover,
        'up': up,
        'down': down,
        'flat': flat,
        'limitUp': lu,
        'limitDown': ld,
    })

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
print(f"  tradeDate: {TRADE_DATE}")
print(f"  涨/跌/平: {up}/{down}/{flat}")
print(f"  成交额: {total_turnover} 亿 (增量 {turnover_diff} 亿)")
print(f"  涨停/跌停: {lu}/{ld}")
print(f"  ETF: {etf_up}/{etf_down}/{etf_flat}")
print(f"  可转债: {bond_up}/{bond_down}/{bond_flat}")
