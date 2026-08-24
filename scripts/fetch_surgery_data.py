"""
盘后数据(每日 15:30 / 17:00 拉取两次):
- 全市场涨停 + 封成比评分
- 亏钱效应传导(昨日涨停 + 今日大跌)
- 北向资金汇总
- 全球资产(用于盘前扫描)
"""
import akshare as ak
import json
import warnings
import os
from datetime import datetime, timedelta
import urllib.request

warnings.filterwarnings('ignore')

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public')
OUT_DIR = os.path.abspath(OUT_DIR)
OUT = os.path.join(OUT_DIR, 'surgery.json')
PRE = os.path.join(OUT_DIR, 'prescan.json')

# v1.9.1:用东八区日期
TODAY = datetime.utcnow() + timedelta(hours=8)
TRADE_DATE = TODAY.strftime('%Y%m%d')
TRADE_DATE_DASH = TODAY.strftime('%Y-%m-%d')
YESTERDAY = (TODAY - timedelta(days=1)).strftime('%Y%m%d')
YESTERDAY_DASH = (TODAY - timedelta(days=1)).strftime('%Y-%m-%d')

# v2.0.7cs:周末直接退出(跟 fetch_real_data.py 一致,周末不污染 baseData)
if TODAY.weekday() >= 5:
    print(f"⏸  {TODAY.strftime('%Y-%m-%d %A')} 是周末,跳过 fetch_surgery_data")
    import sys
    sys.exit(0)

def safe_float(v, default=0):
    try:
        if v is None or v == '' or (isinstance(v, float) and str(v) == 'nan'):
            return default
        return float(v)
    except Exception:
        return default

def safe_int(v, default=0):
    try:
        if v is None or v == '' or (isinstance(v, float) and str(v) == 'nan'):
            return default
        return int(v)
    except Exception:
        return default

def safe_str(v, default='-'):
    if v is None:
        return default
    return str(v).strip() or default

def fmt_time(v):
    v = safe_str(v, '')
    if len(v) == 6 and v.isdigit():
        return f"{v[0:2]}:{v[2:4]}:{v[4:6]}"
    return v

def parse_hhmm(s):
    """把 09:25:00 转成当日分钟数"""
    try:
        parts = s.split(':')
        return int(parts[0]) * 60 + int(parts[1])
    except Exception:
        return -1

print("=" * 50)
print("盘后数据(全景手术台 + 盘前扫描)")
print(f"今日: {TRADE_DATE} / 昨日: {YESTERDAY}")
print("=" * 50)

# ========== 1. 全市场快照(用于 BigLoser 池) ==========
print("\n[1/5] 全市场快照...")
spot_df = ak.stock_zh_a_spot()
print(f"  {len(spot_df)} 只")

# ========== 2. 涨停 + 封成比评分 ==========
print("\n[2/5] 涨停板 + 封成比评分...")

def get_recent_zt_date(date):
    for d in range(0, 7):
        try_date = (TODAY - timedelta(days=d)).strftime('%Y%m%d')
        try:
            df = ak.stock_zt_pool_em(date=try_date)
            if len(df) > 0:
                return try_date, df
        except Exception:
            pass
    return None, None

zt_actual_date, zt_df = get_recent_zt_date(TRADE_DATE)
if zt_actual_date != TRADE_DATE:
    print(f"  ⚠ 今日涨停板数据为空,使用最近交易日 {zt_actual_date} 的数据")
seal_cards = []
for _, row in zt_df.iterrows():
    code = safe_str(row['代码'])
    name = safe_str(row['名称'])
    industry = safe_str(row.get('所属行业', '-'))
    consecutive = safe_int(row.get('连板数', 1)) if 'consecutiveDays' not in row else safe_int(row.get('连板数', 1))
    consecutive = int(consecutive) if consecutive else 1
    first_time_str = fmt_time(row.get('首次封板时间', ''))
    first_minutes = parse_hhmm(first_time_str)
    bombed = safe_int(row.get('炸板次数', 0))
    sealed_yi = safe_float(row.get('封板资金', 0)) / 1e8  # 元 → 亿
    amount_yi = safe_float(row.get('成交额', 0)) / 1e8
    change_pct = safe_float(row.get('涨跌幅', 10))

    # 封成比
    ratio = round(sealed_yi / amount_yi, 2) if amount_yi > 0 else 0

    # 评分
    grade = 'C'
    if ratio > 3:
        grade = 'S'
    elif ratio > 1:
        grade = 'A'
    elif ratio > 0.3:
        grade = 'B'
    else:
        grade = 'C'

    # 尾盘偷鸡
    is_late_seal = first_minutes >= 14 * 60  # 14:00 之后
    late_seal_tag = is_late_seal

    if is_late_seal and grade == 'S':
        grade = 'A'
    elif is_late_seal and grade == 'A':
        grade = 'B'
    # B/C 不再降

    seal_cards.append({
        'code': code, 'name': name, 'industry': industry,
        'consecutiveDays': consecutive,
        'firstSealTime': first_time_str,
        'bombedCount': bombed,
        'sealedAmount': round(sealed_yi, 2),
        'turnover': round(amount_yi, 2),
        'changePercent': round(change_pct, 2),
        'closePrice': safe_float(row.get('最新价', 0)),
        'ratio': ratio,
        'grade': grade,
        'isLateSeal': late_seal_tag,
    })

# 按评级 S > A > B > C, 同评级按封成比降序
grade_order = {'S': 0, 'A': 1, 'B': 2, 'C': 3}
seal_cards.sort(key=lambda x: (grade_order[x['grade']], -x['ratio']))
print(f"  {len(seal_cards)} 只涨停, S级{sum(1 for s in seal_cards if s['grade']=='S')} / A级{sum(1 for s in seal_cards if s['grade']=='A')} / B级{sum(1 for s in seal_cards if s['grade']=='B')} / C级{sum(1 for s in seal_cards if s['grade']=='C')}")

# ========== 3. 亏钱效应传导 ==========
print("\n[3/5] 亏钱效应传导(昨日涨停 + 今日大跌)...")
prev_zt_codes = set()
prev_zt_list = []
try:
    # 用 zt_actual_date 的前一天作为"昨日"
    prev_actual_date = (TODAY - timedelta(days=1)).strftime('%Y%m%d')
    prev_zt = ak.stock_zt_pool_em(date=prev_actual_date)
    prev_zt_codes = set(safe_str(c) for c in prev_zt['代码'].tolist())
    for _, row in prev_zt.iterrows():
        prev_zt_list.append({
            'code': safe_str(row['代码']),
            'name': safe_str(row['名称']),
            'consecutiveDays': safe_int(row.get('连板数', 1)),
        })
    print(f"  昨日涨停 {len(prev_zt_list)} 只")
except Exception as e:
    print(f"  昨日涨停拉取失败: {e}")

# 今日 BigLoser: 跌幅 > 7% 且 换手率 > 15%
big_loser = []
for _, row in spot_df.iterrows():
    pct = safe_float(row.get('涨跌幅', 0))
    turnover_rate = safe_float(row.get('换手率', 0))
    if pct < -7 and turnover_rate > 15:
        big_loser.append({
            'code': safe_str(row['代码']),
            'name': safe_str(row['名称']),
            'industry': safe_str(row.get('行业', '-')),
            'changePercent': round(pct, 2),
            'turnoverRate': round(turnover_rate, 2),
        })
print(f"  BigLoser {len(big_loser)} 只")

# 交集(昨日涨停 + 今日 BigLoser)
intersect = []
prev_dict = {p['code']: p for p in prev_zt_list}
for bl in big_loser:
    if bl['code'] in prev_dict:
        intersect.append({
            **bl,
            'prevStatus': f"昨日{prev_dict[bl['code']]['consecutiveDays']}板涨停",
        })
big_loser_dict = {b['code']: b for b in big_loser}
chain = []
for p in prev_zt_list:
    if p['code'] in big_loser_dict:
        chain.append({
            'from': {'code': p['code'], 'name': p['name'], 'consecutiveDays': p['consecutiveDays']},
            'to': big_loser_dict[p['code']],
        })

prev_zt_n = len(prev_zt_list)
sys_warning = prev_zt_n > 0 and len(intersect) / prev_zt_n > 0.3
print(f"  传导: 昨日涨停 {prev_zt_n} 中, 今日 {len(intersect)} 只进 BigLoser ({len(intersect)*100/max(prev_zt_n,1):.1f}%) {'⚠️ 系统性退潮' if sys_warning else '正常'}")

# ========== 4. 北向资金 ==========
print("\n[4/5] 北向资金汇总...")
hsgt_summary = ak.stock_hsgt_fund_flow_summary_em()
north = []
for _, row in hsgt_summary.iterrows():
    if safe_str(row.get('资金方向', '')) == '北向':
        north.append({
            'type': safe_str(row.get('类型', '')),  # 沪股通/深股通
            'netBuy': safe_float(row.get('成交净买额', 0)),
            'netInflow': safe_float(row.get('资金净流入', 0)),
            'index': safe_str(row.get('相关指数', '')),
            'indexChange': safe_float(row.get('指数涨跌幅', 0)),
        })
north_total = sum(n['netBuy'] for n in north)
print(f"  北向净买入 {north_total:.2f}亿")

# 沪股通增持板块(替代 Top10 活跃股)
print("  沪股通增持板块:")
try:
    rank = ak.stock_hsgt_board_rank_em("北向资金增持行业板块排行", "今日")
    print(f"  板块 {len(rank)} 个")
except Exception as e:
    print(f"  ERR: {e}")

# ========== 5. 全球资产(盘前扫描) ==========
print("\n[5/5] 全球资产(盘前扫描)...")

def fetch_quote(code, source='tx'):
    """fetch 一个实时报价"""
    try:
        if source == 'tx':
            url = f"https://qt.gtimg.cn/q={code}"
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=6) as r:
                txt = r.read().decode('gbk', errors='ignore')
            # 腾讯期货/海外用 ,  分隔;A 股用 ~ 分隔
            if '=' in txt and '"' in txt:
                data = txt.split('"')[1]
                # 判断分隔符
                sep = ',' if ',' in data and '~' not in data else '~'
                if sep == '~' and '~' in data:
                    parts = data.split('~')
                else:
                    parts = data.split(',')
                return parts
        elif source == 'sina':
            url = f"https://hq.sinajs.cn/list={code}"
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://finance.sina.com.cn',
            })
            with urllib.request.urlopen(req, timeout=6) as r:
                txt = r.read().decode('gbk', errors='ignore')
            if '=' in txt and '"' in txt:
                data = txt.split('"')[1]
                return data.split(',')
    except Exception as e:
        return None
    return None

def fetch_us_index_daily(symbol, lookback_days=30):
    """美股日 K(akshare)"""
    try:
        df = ak.stock_us_daily(symbol)
        return df.tail(lookback_days).reset_index(drop=True)
    except Exception as e:
        return None

# 离岸人民币(新浪)
parts = fetch_quote('fx_susdcnh', 'sina')
usdcnh_today = None
if parts and len(parts) > 12:
    usdcnh_today = {
        'price': safe_float(parts[1]),
        'open': safe_float(parts[5]),
        'high': safe_float(parts[6]),
        'low': safe_float(parts[7]),
        'prevClose': safe_float(parts[8]),
        'name': '离岸人民币',
        'change': safe_float(parts[10]),
        'changePct': safe_float(parts[11]),
    }
print(f"  USDCNH: {usdcnh_today}")

# 黄金(纽约)
parts = fetch_quote('hf_GC', 'tx')
gc_today = None
if parts and len(parts) > 5:
    price = safe_float(parts[0])
    change = safe_float(parts[1])
    gc_today = {
        'price': price,
        'change': change,
        'changePct': round(change / price * 100, 2) if price else 0,
        'open': safe_float(parts[3]) if len(parts) > 3 else 0,
        'high': safe_float(parts[4]) if len(parts) > 4 else 0,
        'low': safe_float(parts[5]) if len(parts) > 5 else 0,
        'name': '纽约黄金',
    }
print(f"  黄金: {gc_today}")

# 原油(WTI)
parts = fetch_quote('hf_CL', 'tx')
cl_today = None
if parts and len(parts) > 5:
    price = safe_float(parts[0])
    change = safe_float(parts[1])
    cl_today = {
        'price': price,
        'change': change,
        'changePct': round(change / price * 100, 2) if price else 0,
        'open': safe_float(parts[3]) if len(parts) > 3 else 0,
        'high': safe_float(parts[4]) if len(parts) > 4 else 0,
        'low': safe_float(parts[5]) if len(parts) > 5 else 0,
        'name': 'WTI 原油',
    }
print(f"  原油: {cl_today}")

# 标普 500 + 纳斯达克 + 道琼斯 日 K(取近 30 天)
spx_df = fetch_us_index_daily('.INX', 30)
nasdaq_df = fetch_us_index_daily('.IXIC', 30)
dji_df = fetch_us_index_daily('.DJI', 30)  # v2.0.7:用户要求盘前扫描加道琼斯
print(f"  标普 500 数据: {len(spx_df) if spx_df is not None else 0} 条")
print(f"  纳斯达克 数据: {len(nasdaq_df) if nasdaq_df is not None else 0} 条")
print(f"  道琼斯 数据: {len(dji_df) if dji_df is not None else 0} 条")

# 拼接成"过去 24 小时"的归一化数据
# 用最近 2 个交易日的 close 做对比(开盘/收盘)
global_assets = []
if usdcnh_today and usdcnh_today.get('prevClose'):
    global_assets.append({
        'code': 'USDCNH',
        'name': '离岸人民币',
        'price': usdcnh_today['price'],
        'changePct': round((usdcnh_today['price'] / usdcnh_today['prevClose'] - 1) * 100, 2) if usdcnh_today['prevClose'] else 0,
        'series': [],  # 时序可后续填
    })
if gc_today:
    global_assets.append({
        'code': 'GC',
        'name': '纽约黄金',
        'price': gc_today['price'],
        'changePct': gc_today.get('changePct', 0),
        'series': [],
    })
if cl_today:
    global_assets.append({
        'code': 'CL',
        'name': 'WTI 原油',
        'price': cl_today['price'],
        'changePct': cl_today.get('changePct', 0),
        'series': [],
    })
if spx_df is not None and len(spx_df) >= 2:
    prev = spx_df.iloc[-2]['close']
    last = spx_df.iloc[-1]['close']
    # v2.0.7:series 归一化基准改为"24h 前"close(倒二),跟 chart 标题"以 24h 前价格=0%基准"一致
    base24h = spx_df.iloc[-2]['close']
    series = [{'date': str(row['date'])[:10], 'pct': round((row['close'] / base24h - 1) * 100, 2)} for _, row in spx_df.iterrows()]
    global_assets.append({
        'code': 'SPX',
        'name': '标普500',
        'price': last,
        'changePct': round((last / prev - 1) * 100, 2),
        'series': series,
    })
if nasdaq_df is not None and len(nasdaq_df) >= 2:
    prev = nasdaq_df.iloc[-2]['close']
    last = nasdaq_df.iloc[-1]['close']
    base24h = nasdaq_df.iloc[-2]['close']
    series = [{'date': str(row['date'])[:10], 'pct': round((row['close'] / base24h - 1) * 100, 2)} for _, row in nasdaq_df.iterrows()]
    global_assets.append({
        'code': 'IXIC',
        'name': '纳斯达克',
        'price': last,
        'changePct': round((last / prev - 1) * 100, 2),
        'series': series,
    })
# v2.0.7:盘前扫描加道琼斯指数
if dji_df is not None and len(dji_df) >= 2:
    prev = dji_df.iloc[-2]['close']
    last = dji_df.iloc[-1]['close']
    base24h = dji_df.iloc[-2]['close']
    series = [{'date': str(row['date'])[:10], 'pct': round((row['close'] / base24h - 1) * 100, 2)} for _, row in dji_df.iterrows()]
    global_assets.append({
        'code': 'DJI',
        'name': '道琼斯',
        'price': last,
        'changePct': round((last / prev - 1) * 100, 2),
        'series': series,
    })

# A50 期货:用恒生指数或上证50替代
# 这里用标普500的 24h 数据已能体现"全球资产"主线, 简化处理

# 判断"汇率压制"风险
risk_text = []
usdcnh_pct = next((a['changePct'] for a in global_assets if a['code'] == 'USDCNH'), 0)
spx_pct = next((a['changePct'] for a in global_assets if a['code'] == 'SPX'), 0)
ixic_pct = next((a['changePct'] for a in global_assets if a['code'] == 'IXIC'), 0)
if usdcnh_pct > 0.3:
    risk_text.append(f"【汇率压制】人民币贬值 {usdcnh_pct:.2f}%, 压制外资偏好")
if spx_pct < -0.5:
    risk_text.append(f"【隔夜美股弱势】标普 500 {spx_pct:+.2f}%, 今日上证50承压")
if not risk_text:
    risk_text.append("【无显著风险】隔夜外盘情绪稳定")

# ========== 输出 ==========
surgery_data = {
    'meta': {
        'generatedAt': TODAY.strftime('%Y-%m-%d %H:%M:%S'),
        'tradeDate': TRADE_DATE,
        'tradeDateSlash': TODAY.strftime('%y/%m/%d'),
    },
    'sealCards': seal_cards,
    'bigLoser': big_loser,
    'loserChain': chain,  # 传导链
    'loserIntersection': intersect,  # 昨日涨停 + 今日大跌
    'prevLimitUpCount': prev_zt_n,
    'systemWarning': sys_warning,
    'north': north,
    'northTotal': round(north_total, 2),
}

prescan_data = {
    'meta': {
        'generatedAt': TODAY.strftime('%Y-%m-%d %H:%M:%S'),
        'tradeDate': TRADE_DATE,
    },
    'assets': global_assets,
    'riskText': risk_text,
}

os.makedirs(OUT_DIR, exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(surgery_data, f, ensure_ascii=False, indent=2)
with open(PRE, 'w', encoding='utf-8') as f:
    json.dump(prescan_data, f, ensure_ascii=False, indent=2)

print(f"\n✓ surgery.json: {os.path.getsize(OUT) / 1024:.1f} KB")
print(f"✓ prescan.json: {os.path.getsize(PRE) / 1024:.1f} KB")
print("=" * 50)
