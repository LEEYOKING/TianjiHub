"""每 5 分钟跑一次,只拉 sina 累加 50 页 + 指数 + 涨跌停(走公开接口,无 akshare 限流)
v2.0.7fv:
- M9: 修 line 140 zdt/zdt 重复(删死代码,直接用 akshare)
- M10: 写 dist/data.json 前先 makedirs
- M11: 周末防御,周六周日直接 sys.exit(0)
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import urllib.request, json, time
import pandas as pd
from datetime import datetime, timedelta

# v2.0.7fv:M11 修 — 周末防御
_now_east8 = datetime.utcnow() + timedelta(hours=8)
if _now_east8.weekday() >= 5:  # 周六/周日
    print(f"  ⏸ 周末({_now_east8.strftime('%A')}),跳过 fetch_5min")
    sys.exit(0)


EAST8 = 8 * 3600

def safe_float(x, default=0.0):
    try:
        v = float(str(x).replace('%', '').replace(',', ''))
        if v != v:  # NaN
            return default
        return v
    except (ValueError, TypeError):
        return default

def http_get(url, headers=None, timeout=10):
    headers = headers or {}
    headers.setdefault('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    headers.setdefault('Referer', 'https://finance.sina.com.cn/')
    req = urllib.request.Request(url, headers=headers)
    return urllib.request.urlopen(req, timeout=timeout).read()

# ========== 1. 指数(6 个) ==========
WANTED_INDICES = [
    ('sh000001', '上证指数'),
    ('sz399001', '深证成指'),
    ('sz399006', '创业板指'),
    ('sh000688', '科创50'),
    ('sh000300', '沪深300'),
    ('sz399303', '微盘指数'),
]
indices = []
sh_amt = 0
for code, name in WANTED_INDICES:
    try:
        # 腾讯接口
        url = f'https://qt.gtimg.cn/q={code}'
        raw = http_get(url).decode('gbk', errors='ignore')
        # 解析 v_sh000001="1~上证指数~..."
        import re
        m = re.search(r'="([^"]+)"', raw)
        if not m: continue
        parts = m.group(1).split('~')
        if len(parts) < 38: continue
        turnover_yi = 0
        if len(parts) > 30 and '/' in parts[30]:
            comp = parts[30].split('/')
            if len(comp) >= 3:
                turnover_yi = safe_float(comp[2]) / 1e8
        indices.append({
            'name': name,
            'point': safe_float(parts[3]),
            'changeAmount': safe_float(parts[24]),
            'changePercent': safe_float(parts[25]),
            'turnover': round(turnover_yi, 2),
        })
        if code == 'sh000001':
            sh_amt = turnover_yi
    except Exception as e:
        print(f'  {name} 失败: {e}')
print(f'  指数 {len(indices)} 个')

# ========== 2. 全市场(sina 累加 50 页,sandbox IP 限流 456,sleep+重试) ==========
print('  全市场累加 50 页...')
spot_rows = []
for page in range(1, 56):
    url = (
        'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/'
        f'Market_Center.getHQNodeData?num=100&page={page}&sort=code&asc=1&node=hs_a&_={int(time.time()*1000)}'
    )
    for retry in range(3):
        try:
            data = json.loads(http_get(url, timeout=10).decode('utf-8', errors='ignore'))
            if data and len(data) >= 50:
                spot_rows.extend(data)
                break
        except Exception as e:
            if retry == 2:
                pass
        time.sleep(0.5 + retry * 0.5)
    time.sleep(0.1)
    if page % 10 == 0:
        print(f'    p{page} cum {len(spot_rows)}')

# 去重(以 symbol 为 key)
seen = set()
unique_rows = []
for s in spot_rows:
    sym = s.get('symbol', s.get('code', ''))
    if sym and sym not in seen:
        seen.add(sym)
        unique_rows.append(s)
spot_rows = unique_rows

total_turnover = sum(safe_float(s.get('amount', 0)) for s in spot_rows) / 1e8
up_count = sum(1 for s in spot_rows if safe_float(s.get('changepercent', 0)) > 0)
down_count = sum(1 for s in spot_rows if safe_float(s.get('changepercent', 0)) < 0)
flat_count = sum(1 for s in spot_rows if safe_float(s.get('changepercent', 0)) == 0)
print(f'  全市场 {len(spot_rows)} 只 ↑{up_count} ↓{down_count} 成交 {total_turnover:.2f}亿')

# ========== 3. ETF + 可转债(akshare 拉这两个) ==========
print('  ETF(akshare)...')
etf_up = etf_down = etf_flat = 0
try:
    import akshare as ak
    etf_df = ak.fund_etf_spot_em()
    etf_df['pct'] = etf_df['涨跌幅'].astype(str).str.replace('%', '', regex=False).apply(safe_float)
    etf_df = etf_df.dropna(subset=['pct'])
    etf_up = int((etf_df['pct'] > 0).sum())
    etf_down = int((etf_df['pct'] < 0).sum())
    etf_flat = int((etf_df['pct'] == 0).sum())
    print(f'  ETF: 涨 {etf_up} 跌 {etf_down} 平 {etf_flat}')
except Exception as e:
    print(f'  ETF akshare 失败: {e}')

print('  可转债(akshare)...')
bond_up = bond_down = bond_flat = 0
try:
    bond_df = ak.bond_zh_hs_cov_spot()
    bond_df['cp'] = bond_df['changepercent'].astype(str).str.replace('%', '', regex=False).apply(safe_float)
    bond_df = bond_df.dropna(subset=['cp'])
    bond_df = bond_df[bond_df['cp'] != 0]
    bond_up = int((bond_df['cp'] > 0).sum())
    bond_down = int((bond_df['cp'] < 0).sum())
    bond_flat = int((bond_df['cp'] == 0).sum())
    print(f'  可转债: 涨 {bond_up} 跌 {bond_down} 平 {bond_flat}')
except Exception as e:
    print(f'  可转债 akshare 失败: {e}')

# 涨跌停:用涨停股接口
print('  涨跌停...')
limit_up = 0
limit_down = 0
# v2.0.7fv:M9 修 — 删原 line 140 死代码('hs_a'.replace('hs_a', 'lscjfb/zdt') 拼出 zdt/zdt 重复)
# 改用 akshare 直接拉,跟 fetch_real_data.py 一致

# 用 akshare 的 zt_pool(如果可用)
try:
    import akshare as ak
    zt_df = ak.stock_zt_pool_em(date=(datetime.utcnow()+timedelta(hours=8)).strftime('%Y%m%d'))
    limit_up = len(zt_df)
    dt_df = ak.stock_zt_pool_dtgc_em(date=(datetime.utcnow()+timedelta(hours=8)).strftime('%Y%m%d'))
    limit_down = len(dt_df)
    print(f'  涨停 {limit_up} 跌停 {limit_down}(akshare)')
except Exception as e:
    print(f'  akshare 涨跌停失败: {e}')
    # 估算:用 sina limit-up 节点
    try:
        z = json.loads(http_get('https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?num=200&page=1&sort=changepercent&asc=0&node=lscjfb').decode('utf-8', errors='ignore'))
        limit_up = len([s for s in z if safe_float(s.get('changepercent', 0)) >= 9.5])
    except: pass
    try:
        d = json.loads(http_get('https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?num=200&page=1&sort=changepercent&asc=1&node=hs_a&changepercent=-1'.replace('asc=0','asc=1')).decode('utf-8', errors='ignore'))
    except: pass

# 读取现有 data.json,只更新 marketOverview
import json
data_path = '/workspace/fupan/public/data.json'
with open(data_path, 'r', encoding='utf-8') as f:
    d = json.load(f)

d['marketOverview']['indices'] = indices
d['marketOverview']['marketTurnover'] = round(total_turnover, 2)
d['marketOverview']['upCount'] = up_count
d['marketOverview']['downCount'] = down_count
d['marketOverview']['flatCount'] = flat_count
d['marketOverview']['upPercent'] = round(up_count * 100 / max(1, up_count+down_count+flat_count), 2)
d['marketOverview']['etfUp'] = etf_up
d['marketOverview']['etfDown'] = etf_down
d['marketOverview']['etfFlat'] = etf_flat
d['marketOverview']['bondUp'] = bond_up
d['marketOverview']['bondDown'] = bond_down
d['marketOverview']['bondFlat'] = bond_flat
d['marketOverview']['limitUpCount'] = limit_up
d['marketOverview']['limitDownCount'] = limit_down

# update meta
now_east8 = datetime.utcnow() + timedelta(hours=8)
d['meta']['generatedAt'] = now_east8.strftime('%Y-%m-%d %H:%M:%S')
d['meta']['tradeDate'] = now_east8.strftime('%Y%m%d')

# 写回 public + dist
# v2.0.7fv:M10 修 — 写前先 makedirs (dist/ 首次部署/清理后不存在会 FileNotFoundError)
for p in ['/workspace/fupan/public/data.json', '/workspace/fupan/dist/data.json']:
    parent = os.path.dirname(p)
    if parent and not os.path.exists(parent):
        os.makedirs(parent, exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
print(f'✓ 已更新 {len(spot_rows)} 只 + 6 指数 + ETF {etf_up}/{etf_down} + 可转债 {bond_up}/{bond_down} + 涨跌停 {limit_up}/{limit_down}')
print(f'  meta.tradeDate: {d["meta"]["tradeDate"]}  generatedAt: {d["meta"]["generatedAt"]}')
