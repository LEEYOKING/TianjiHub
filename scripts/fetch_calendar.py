#!/usr/bin/env python3
"""日历回溯 · 每日归档

把「每个交易日」的三张榜归档成小文件，供前端日历页按需加载：
    · 板块涨幅 TOP10 / 跌幅 TOP10（数据来自 public/rotation.json，零新增采集）
    · 个股涨幅 TOP10 / 跌幅 TOP10 / 成交额 TOP10（全市场快照，新浪优先、腾讯兜底）

产物（按日分片，一天一个文件，机器人只新增不改旧 → 几乎不会有 git 冲突）：
    public/calendar/index.json          日期列表 + 每日摘要（涨跌家数 / 涨停数 / TOP5 板块）
    public/calendar/YYYY-MM-DD.json     当日三张榜

用法
    python3 scripts/fetch_calendar.py                    # 默认取 data.json 的 tradeDate
    python3 scripts/fetch_calendar.py --date 2026-11-11
    python3 scripts/fetch_calendar.py --backfill 120     # 从 rotation.json 回补板块榜（个股无法回补）
    python3 scripts/fetch_calendar.py --out /tmp/cal     # 指定输出根目录（联调用）

重要限制
    个股榜没有历史接口（同花顺/腾讯/新浪都只给当日快照），所以：
      · --backfill 只能回补板块榜；
      · 个股榜自上线的第一个交易日起逐日积累，6 个月后自然补齐。
    回补时若该日已存在含个股的文件，只刷新板块部分，不会把个股数据覆盖掉。

退出码
    0=成功 / 1=数据不足（板块列或快照缺失）/ 4=数据源整体不可达
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import ssl
import sys
import time
import urllib.request
from datetime import datetime, timezone, timedelta

CST = timezone(timedelta(hours=8))
CLOSE_READY = '15:05'          # 该时点前，当日数据还是盘中快照，拒绝归档

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
PUB = os.path.join(ROOT, 'public')

TOP_N = 10                     # 弹窗里展示的条数
TOP_SUMMARY = 5                # 写进 index.json 供日历格子 hover 用的条数
MIN_SECTOR_AMT = 5.0           # 板块上榜门槛：当日成交额 ≥ 5 亿（过滤只有一两只成分股的迷你概念）
MAX_PCT = 21.0                 # 涨跌幅超过此值视为上市首日/次新，不参与涨跌幅排名
MIN_SPOT = 1000                # 全市场快照少于这个数量视为抓取失败

UA = {'User-Agent': 'Mozilla/5.0'}
SSL_CTX = ssl._create_unverified_context()

EXIT_OK = 0
EXIT_THIN = 1
EXIT_SOURCE_DOWN = 4


# ---------------- 工具 ----------------
def http_get(url: str, headers=None, timeout: int = 20, retry: int = 3) -> str:
    last = None
    hdr = dict(UA)
    if headers:
        hdr.update(headers)
    for i in range(retry):
        try:
            req = urllib.request.Request(url, headers=hdr)
            raw = urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX).read()
            if raw[:2] == b'\x1f\x8b':
                raw = gzip.decompress(raw)
            return raw.decode('utf-8', 'ignore')
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(0.8 * (i + 1))
    raise last  # type: ignore[misc]


def load_json(path: str, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return default


def atomic_write(path: str, obj) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, path)


def _f(v, default=0.0) -> float:
    try:
        x = float(v)
        return x if x == x else default       # 过滤 NaN
    except (TypeError, ValueError):
        return default


# ---------------- 全市场快照 ----------------
def fetch_spot_sina():
    """新浪全市场快照（含成交额）→ list[dict]；失败返 []"""
    try:
        import warnings
        warnings.filterwarnings('ignore')
        import akshare as ak
        df = ak.stock_zh_a_spot()
        if df is None or len(df) < MIN_SPOT:
            return []
        rows = []
        for _, r in df.iterrows():
            code = str(r.get('代码') or '').strip()
            name = str(r.get('名称') or '').strip()
            if not code or not name:
                continue
            rows.append({
                'code': code[-6:],
                'name': name,
                'close': _f(r.get('最新价')),
                'pct': _f(r.get('涨跌幅')),
                'amount': _f(r.get('成交额')) / 1e8,     # 元 → 亿
            })
        print(f'    新浪全市场 {len(rows)} 只')
        return rows
    except Exception as e:  # noqa: BLE001
        print(f'    新浪全市场失败（{type(e).__name__}: {e}）→ 改用腾讯')
        return []


def fetch_spot_tencent():
    """腾讯 qt.gtimg.cn 全市场快照 → list[dict]；失败返 []"""
    codes = []
    try:
        for pg in range(1, 60):
            url = ('https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/'
                   'Market_Center.getHQNodeData?page=%d&num=100&sort=symbol&asc=1&node=hs_a'
                   '&symbol=&_s_r_a=page' % pg)
            data = json.loads(http_get(url, {'Referer': 'https://finance.sina.com.cn/'}))
            if not isinstance(data, list) or not data:
                break
            for it in data:
                sym = it.get('symbol') or it.get('code')
                if sym:
                    codes.append(sym)
            if len(data) < 100:
                break
        print(f'    腾讯快照：代码表 {len(codes)} 个')
    except Exception as e:  # noqa: BLE001
        print(f'    代码表获取失败：{type(e).__name__} {e}')

    if len(codes) < MIN_SPOT:      # 兜底：上一份 data.json 里的 stockCodes
        prev = load_json(os.path.join(PUB, 'data.json'), {}) or {}
        codes = list((prev.get('meta') or {}).get('stockCodes') or [])
        print(f'    改用 data.json.stockCodes {len(codes)} 个')

    out = []
    for start in range(0, len(codes), 100):
        batch = codes[start:start + 100]
        try:
            txt = http_get('https://qt.gtimg.cn/q=' + ','.join(batch),
                           {'Referer': 'https://stockapp.finance.qq.com/'})
        except Exception:  # noqa: BLE001
            continue
        for line in txt.split(';'):
            if '=' not in line:
                continue
            f = line.split('=', 1)[1].strip().strip('";').split('~')
            if len(f) < 50:
                continue
            name = f[1]
            if not name or '退' in name:
                continue
            out.append({
                'code': str(f[2])[-6:],
                'name': name,
                'close': _f(f[3]),
                'pct': _f(f[32]),
                'amount': _f(f[37]) / 1e4,     # 万元 → 亿
            })
        time.sleep(0.05)
    print(f'    腾讯全市场 {len(out)} 只')
    return out


def fetch_spot():
    rows = fetch_spot_sina()
    if len(rows) >= MIN_SPOT:
        return rows, 'sina'
    rows = fetch_spot_tencent()
    if len(rows) >= MIN_SPOT:
        return rows, 'tencent'
    return [], 'none'


# ---------------- 榜单 ----------------
def _board(code: str) -> str:
    if code.startswith(('8', '4')):
        return 'bj'
    if code.startswith(('688', '689')):
        return 'sh'
    if code.startswith('6'):
        return 'sh'
    return 'sz'


def stock_ranks(spot: list[dict]) -> dict:
    """三张个股榜。口径：剔除 ST / 停牌（成交额 0）/ 涨跌幅异常（首日·次新）。"""
    clean = []
    for r in spot:
        name = r['name']
        if 'ST' in name.upper() or '退' in name:
            continue
        if r['amount'] <= 0 or r['close'] <= 0:
            continue
        clean.append(r)

    for r in clean:
        r['pct'] = round(r['pct'], 2)
        r['amount'] = round(r['amount'], 2)

    ranked = [r for r in clean if abs(r['pct']) <= MAX_PCT]

    def pack(r):
        return {'code': r['code'], 'name': r['name'], 'pct': r['pct'],
                'amount': r['amount'], 'close': r['close'], 'board': _board(r['code'])}

    up = [pack(r) for r in sorted(ranked, key=lambda x: x['pct'], reverse=True)[:TOP_N]]
    down = [pack(r) for r in sorted(ranked, key=lambda x: x['pct'])[:TOP_N]]
    volume = [pack(r) for r in sorted(clean, key=lambda x: x['amount'], reverse=True)[:TOP_N]]
    return {'up': up, 'down': down, 'volume': volume}


def sector_ranks(rot: dict, date: str) -> dict | None:
    """从 rotation.json 取指定日期的板块榜；该日不在窗口内返 None"""
    dates = rot.get('dates') or []
    if date not in dates:
        return None
    idx = dates.index(date)
    rows = []
    for s in rot.get('sectors') or []:
        pct = s.get('pct') or []
        amt = s.get('amt') or []
        if idx >= len(pct) or idx >= len(amt):
            continue
        p, a = pct[idx], amt[idx]
        if p is None or a is None or a < MIN_SECTOR_AMT:   # 成交额门槛
            continue
        rows.append({'id': s.get('id'), 'name': s.get('name'), 'type': s.get('type'),
                     'pct': round(float(p), 2), 'amt': round(float(a), 2),
                     'coverage': s.get('coverage')})

    def pack(r):
        return {'id': r['id'], 'name': r['name'], 'type': r['type'],
                'pct': r['pct'], 'amt': r['amt']}

    up = [pack(r) for r in sorted(rows, key=lambda x: x['pct'], reverse=True)[:TOP_N]]
    down = [pack(r) for r in sorted(rows, key=lambda x: x['pct'])[:TOP_N]]
    return {'up': up, 'down': down}


# ---------------- 归档 ----------------
def day_path(out_root: str, date: str) -> str:
    return os.path.join(out_root, f'{date}.json')


def index_path(out_root: str) -> str:
    return os.path.join(out_root, 'index.json')


def market_summary(data: dict, date: str) -> dict:
    """涨跌家数 / 涨停数 / 总成交额 —— 只有该日正好是 data.json 的 tradeDate 时才有"""
    meta = data.get('meta') or {}
    if str(meta.get('tradeDate') or '') != date.replace('-', ''):
        return {}
    mo = data.get('marketOverview') or {}
    return {
        'up': mo.get('upCount'),
        'down': mo.get('downCount'),
        'flat': mo.get('flatCount'),
        'limitUp': mo.get('limitUpCount'),
        'limitDown': mo.get('limitDownCount'),
        'brokenLimit': mo.get('brokenLimitCount'),
        'turnover': mo.get('marketTurnover'),
    }


def update_index(out_root: str, date: str, entry: dict) -> None:
    path = index_path(out_root)
    idx = load_json(path, None) or {'meta': {'schema': 'calendar-index-v1'}, 'days': []}
    days = [d for d in idx.get('days') or [] if d.get('date') != date]
    days.append(entry)
    days.sort(key=lambda d: d.get('date') or '')
    idx['days'] = days
    idx['meta'] = {
        'schema': 'calendar-index-v1',
        'generatedAt': datetime.now(CST).strftime('%Y-%m-%d %H:%M:%S'),
        'firstDate': days[0]['date'] if days else None,
        'lastDate': days[-1]['date'] if days else None,
        'days': len(days),
    }
    atomic_write(path, idx)


def build_one(date: str, rot: dict, data: dict, out_root: str) -> tuple[int, str]:
    """归档单个交易日；返回 (退出码, 说明)"""
    sec = sector_ranks(rot, date)
    if sec is None:
        return EXIT_THIN, f'{date} 不在 rotation.json 的 {len(rot.get("dates") or [])} 天窗口内'

    existing = load_json(day_path(out_root, date), {}) or {}
    summary = market_summary(data, date)

    day = {
        'meta': {
            'schema': 'calendar-day-v1',
            'date': date,
            'generatedAt': datetime.now(CST).strftime('%Y-%m-%d %H:%M:%S'),
            'sectorFilter': f'成交额 ≥ {MIN_SECTOR_AMT} 亿',
            'stockFilter': '剔除 ST / 停牌 / 涨跌幅 > 21%（首日·次新）',
        },
        'sectors': sec,
        'stocks': existing.get('stocks'),
        'summary': summary or existing.get('summary') or {},
    }

    if summary:
        day['meta']['summarySource'] = 'data.json'
    atomic_write(day_path(out_root, date), day)

    entry = {'date': date, **day['summary'],
             'topUp': sec['up'][:TOP_SUMMARY],
             'topDown': sec['down'][:TOP_SUMMARY],
             'hasStocks': bool(day['stocks'])}
    update_index(out_root, date, entry)
    return EXIT_OK, f'{date} 板块 {len(sec["up"])}+{len(sec["down"])} 条'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', default='')
    ap.add_argument('--backfill', type=int, default=0)
    ap.add_argument('--out', default=os.path.join(PUB, 'calendar'))
    args = ap.parse_args()

    now8 = datetime.now(CST)
    # 盘中保护：收盘前当日板块/个股都还是快照，归档成"完整交易日"就是脏数据
    if now8.weekday() < 5 and (9, 30) <= (now8.hour, now8.minute) < (15, 5):
        print(f'⏸ 现在是交易时段({now8.strftime("%H:%M")})，收盘数据未就绪 → 15:05 后再跑')
        return EXIT_OK

    rot = load_json(os.path.join(PUB, 'rotation.json'), None)
    if not rot or not rot.get('dates'):
        print('✗ rotation.json 不可用 → 板块榜无法生成')
        return EXIT_SOURCE_DOWN

    data = load_json(os.path.join(PUB, 'data.json'), {}) or {}
    meta = data.get('meta') or {}
    date = args.date or (
        f"{str(meta['tradeDate'])[:4]}-{str(meta['tradeDate'])[4:6]}-{str(meta['tradeDate'])[6:8]}"
        if meta.get('tradeDate') else now8.strftime('%Y-%m-%d')
    )
    out_root = args.out

    # ---- 回补模式：只补板块（个股无历史接口） ----
    if args.backfill > 0:
        dates = [d for d in (rot.get('dates') or []) if not args.date or d <= date][-args.backfill:]
        print(f'回补 {len(dates)} 个交易日的板块榜（个股榜无法回补，保持原样/为空）')
        ok = skipped = 0
        for d in dates:
            code, msg = build_one(d, rot, data, out_root)
            if code == EXIT_OK:
                ok += 1
            else:
                skipped += 1
                print(f'  ! {msg}')
        print(f'✓ 回补完成：成功 {ok} 天，跳过 {skipped} 天')
        return EXIT_OK if ok else EXIT_THIN

    # ---- 单日模式 ----
    if date not in (rot.get('dates') or []):
        print(f'⚠ {date} 不在板块归档窗口内（{rot["dates"][0]} ~ {rot["dates"][-1]}）→ 只写个股与摘要')
        sec = {'up': [], 'down': []}
    else:
        sec = sector_ranks(rot, date) or {'up': [], 'down': []}

    spot, src = fetch_spot()
    if not spot:
        print('✗ 全市场快照不可用（新浪/腾讯均失败）')
        return EXIT_SOURCE_DOWN
    stocks = stock_ranks(spot)

    existing = load_json(day_path(out_root, date), {}) or {}
    summary = market_summary(data, date)
    day = {
        'meta': {
            'schema': 'calendar-day-v1',
            'date': date,
            'generatedAt': datetime.now(CST).strftime('%Y-%m-%d %H:%M:%S'),
            'spotSource': src,
            'spotCount': len(spot),
            'sectorFilter': f'成交额 ≥ {MIN_SECTOR_AMT} 亿',
            'stockFilter': '剔除 ST / 停牌 / 涨跌幅 > 21%（首日·次新）',
        },
        'sectors': sec if (sec['up'] or sec['down']) else existing.get('sectors') or sec,
        'stocks': stocks,
        'summary': summary or existing.get('summary') or {},
    }
    atomic_write(day_path(out_root, date), day)

    update_index(out_root, date, {
        'date': date, **day['summary'],
        'topUp': day['sectors']['up'][:TOP_SUMMARY],
        'topDown': day['sectors']['down'][:TOP_SUMMARY],
        'hasStocks': True,
    })

    print(f'✓ 写入 {os.path.join(out_root, date + ".json")}')
    print(f'  板块 {len(day["sectors"]["up"])}+{len(day["sectors"]["down"])} 条'
          f'（门槛 {MIN_SECTOR_AMT} 亿） | 个股 涨{len(stocks["up"])}/跌{len(stocks["down"])}/量{len(stocks["volume"])}'
          f' | 快照 {src} {len(spot)} 只')
    if summary:
        print(f'  摘要 涨{summary.get("up")} 跌{summary.get("down")} 涨停{summary.get("limitUp")}'
              f' 跌停{summary.get("limitDown")} 成交额{summary.get("turnover")}亿')
    else:
        print('  （该日不在 data.json 当前 tradeDate，摘要留空）')
    return EXIT_OK


if __name__ == '__main__':
    sys.exit(main())
