#!/usr/bin/env python3
"""板块轮动归档 —— 同花顺单源版(2026-10-28 起替代东财 push2/push2his)。

为什么换源:
    东财 push2 / push2his 对住宅 IP 与 GitHub Runner 的海外 IP 一律 0.2s 内 RST
    (2026-10-22 ~ 10-27 连续 6 个交易日 0 产出),换域名/换 IPv6/换协议都无效;
    同一时刻 quote.eastmoney.com / datacenter-web.eastmoney.com 却正常 —— 属行情接口的 IP 风控。
    同花顺的板块日线 CDN(d.10jqka.com.cn)是静态文件,无 cookie、无签名,实测 0.2s/板。

数据形态(实测):
    · 目录:行业 90 个(881xxx)、概念 ~294 个(885xxx/886xxx)、地域 33 个(882xxx)
    · 日线:GET d.10jqka.com.cn/v6/line/bk_<code>/01/last.js → 140 根
           每行 `日期,开,高,低,收,成交量,成交额(元),...`
    · 涨跌幅由相邻两根收盘价算出,成交额 /1e8 折成"亿元"(与旧归档同单位)

策略:每次全量重建最近 --days 个交易日窗口(417 个板块 × 1 请求,约 20s)。
    不做增量拼接 —— 140 根 > 120 天窗口,重建天然幂等,不会出现"缺口越滚越大"。

退出码:0=成功;1=覆盖不足(拒绝写入);4=数据源整体不可达(调用方只告警)。
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import ssl
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

CST = timezone(timedelta(hours=8))
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'public', 'rotation.json'))

CLOSE_READY = '15:05'
MAX_PCT = 20.0          # 板块单日涨跌幅超过 ±20% 视为脏数据
MIN_SUCCESS_RATIO = 0.85
MIN_SUCCESS_ABS = 50

SSL_CTX = ssl._create_unverified_context()
UA = {
    'User-Agent': ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                   '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'),
    'Referer': 'https://q.10jqka.com.cn/',
    'Accept': '*/*',
}

# 目录页只取板块代码(名称一律从日线接口返回的 name 取 —— 目录页是 GBK 且有嵌套标签,易乱码)
CATALOG = [
    ('industry', 'https://q.10jqka.com.cn/thshy/', r'code/(881\d{3})'),
    ('region',   'https://q.10jqka.com.cn/dy/',    r'code/(882\d{3})'),
]
CONCEPT_PAGE = 'https://q.10jqka.com.cn/gn/'
LINE_URL = 'https://d.10jqka.com.cn/v6/line/bk_{code}/01/last.js'
BENCH = ('sh000300', '沪深300')
BENCH_URL = ('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'
             '?param=sh000300,day,,,{bars},qfq')
BENCH_UA = {'User-Agent': UA['User-Agent'], 'Referer': 'https://gu.qq.com/'}


def http_get(url: str, referer: str = None, timeout: int = 15, retry: int = 3) -> str:
    last = None
    for i in range(retry + 1):
        try:
            headers = dict(UA)
            if referer:
                headers['Referer'] = referer
            req = urllib.request.Request(url, headers=headers)
            resp = urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX)
            body = resp.read()
            if resp.headers.get('Content-Encoding') == 'gzip':
                body = gzip.decompress(body)
            return body.decode('utf-8', 'ignore')
        except Exception as e:  # noqa: BLE001
            last = e
            if i < retry:
                time.sleep(0.6 * (i + 1))
    raise last  # type: ignore[misc]


def fetch_catalog() -> list:
    """→ [{id, name, type}]；name 先留空,由日线接口回填。三类全失败才算源不可达。"""
    boards: list = []
    seen = set()

    def add(code: str, btype: str) -> None:
        code = (code or '').strip()
        if code and code not in seen:
            seen.add(code)
            boards.append({'id': code, 'name': '', 'type': btype})

    ok_pages = 0
    for btype, url, pat in CATALOG:
        try:
            html = http_get(url, referer='https://q.10jqka.com.cn/')
            ok_pages += 1
            for code in re.findall(pat, html):
                add(code, btype)
        except Exception as e:  # noqa: BLE001
            print(f'  ⚠ 目录页失败({btype}): {type(e).__name__} {e}')

    # 概念板块不挂在 <a> 上,而是嵌在 <input id="gnSection" value='{"…":"…"}'> 的 JSON 里
    try:
        html = http_get(CONCEPT_PAGE, referer='https://q.10jqka.com.cn/')
        ok_pages += 1
        m = re.search(r"id=\"gnSection\"\s+value='(\{.*?\})'", html, re.S)
        if m:
            for item in json.loads(m.group(1)).values():
                add(str(item.get('platecode', '')), 'concept')
        else:
            print('  ⚠ 概念页未找到 gnSection')
    except Exception as e:  # noqa: BLE001
        print(f'  ⚠ 目录页失败(concept): {type(e).__name__} {e}')

    if not ok_pages:
        raise RuntimeError('三个板块目录页全部失败')
    return boards


def fetch_board(code: str) -> dict:
    """→ {id, name, pct:{date: pct}, amt:{date: 亿}}"""
    txt = http_get(LINE_URL.format(code=code))
    m = re.search(r'\((\{.*\})\)\s*;?\s*$', txt, re.S)
    if not m:
        raise ValueError('返回不是 JSONP')
    j = json.loads(m.group(1))
    name = str(j.get('name') or '')
    bars = [b for b in str(j.get('data') or '').split(';') if b]
    pct, amt = {}, {}
    prev = None
    for b in bars:
        f = b.split(',')
        if len(f) < 7:
            continue
        try:
            d = f[0]
            d = f'{d[0:4]}-{d[4:6]}-{d[6:8]}'
            close = float(f[4])
            amount = float(f[6])
        except (ValueError, IndexError):
            continue
        if prev is not None and prev > 0:
            pct[d] = round((close - prev) / prev * 100, 2)
            amt[d] = round(amount / 1e8, 2)
        prev = close
    return {'id': code, 'name': name, 'pct': pct, 'amt': amt}


def fetch_bench(days: int) -> dict:
    """沪深300 每个交易日的涨跌幅 → {date: pct}(同时充当交易日骨架)。"""
    url = BENCH_URL.format(bars=int(days) + 30)
    req = urllib.request.Request(url, headers=BENCH_UA)
    j = json.loads(urllib.request.urlopen(req, timeout=20, context=SSL_CTX)
                   .read().decode('utf-8', 'ignore'))
    node = (j.get('data') or {}).get(BENCH[0]) or {}
    rows = node.get('qfqday') or node.get('day') or []
    out, prev = {}, None
    for r in rows:
        try:
            d, close = str(r[0]), float(r[2])
        except (TypeError, ValueError, IndexError):
            continue
        if prev and prev > 0:
            out[d] = round((close - prev) / prev * 100, 2)
        prev = close
    return out


def build(boards: list, days: int, throttle: float, workers: int) -> int:
    t0 = time.time()
    now8 = datetime.now(CST)
    today, hhmm = now8.strftime('%Y-%m-%d'), now8.strftime('%H:%M')

    print(f'  板块目录: {len(boards)} 个 '
          f'(行业 {sum(1 for b in boards if b["type"] == "industry")} / '
          f'概念 {sum(1 for b in boards if b["type"] == "concept")} / '
          f'地域 {sum(1 for b in boards if b["type"] == "region")})')

    try:
        bench_map = fetch_bench(days)
    except Exception as e:  # noqa: BLE001
        print(f'  ✗ 基准/骨架(腾讯日线)不可达: {type(e).__name__} {e}')
        return 4
    dates = sorted(bench_map)
    if dates and dates[-1] == today and hhmm < CLOSE_READY:
        dates = dates[:-1]
        print(f'  · 今日 {today} {hhmm} 未收盘 → 丢弃当日盘中快照')
    dates = dates[-days:]
    if not dates:
        print('  ✗ 骨架为空,未写入任何文件')
        return 4
    print(f'  交易日骨架: {len(dates)} 天 ({dates[0]} ~ {dates[-1]})')

    # 逐板块拉日线(417 个静态 JS,6 路并发 + 轻微节流)
    data: dict = {}
    fail: list = []
    t1 = time.time()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(fetch_board, b['id']): b for b in boards}
        for fut in as_completed(futs):
            b = futs[fut]
            try:
                got = fut.result()
                b['name'] = got['name'] or b['id']
                data[b['id']] = got
            except Exception as e:  # noqa: BLE001
                fail.append((b['id'], b['name'] or b['id'], f'{type(e).__name__}: {e}'[:60]))
            time.sleep(throttle)
    print(f'  拉取完成: {len(data)}/{len(boards)} 成功,耗时 {time.time() - t1:.0f}s')

    # 502 多是并发下的瞬时失败(2026-10-28 实测:同批 6 个地域板块在 6 路并发下全 502,
    #   随后串行请求全部 200)→ 失败板块串行补一轮,避免把本可拿到的板块留成 coverage=0。
    if fail:
        print(f'  · {len(fail)} 个板块失败,串行重试一轮...')
        retry_ok = 0
        for b in boards:
            if b['id'] in data:
                continue
            try:
                got = fetch_board(b['id'])    # http_get 内部已带 3 次退避重试
                b['name'] = got['name'] or b['id']
                data[b['id']] = got
                retry_ok += 1
            except Exception:  # noqa: BLE001
                pass
            time.sleep(0.3)
        fail = [f for f in fail if f[0] not in data]
        print(f'  · 重试补齐 {retry_ok} 个,仍失败 {len(fail)} 个')

    if not data:
        print('  ✗ 全部板块都拉取失败(数据源不可达),未写入任何文件')
        return 4
    min_ok = max(MIN_SUCCESS_ABS, int(len(boards) * MIN_SUCCESS_RATIO))
    if len(data) < min_ok:
        print(f'  ✗ 成功率过低({len(data)}/{len(boards)},需 ≥{min_ok}),拒绝写入(线上保持原样)')
        print(f'    失败示例: {fail[:5]}')
        return 1

    suspect: list = []
    sectors = []
    for b in boards:
        got = data.get(b['id'])
        pct, amt = [], []
        for d in dates:
            v = got['pct'].get(d) if got else None
            a = got['amt'].get(d) if got else None
            if v is not None and abs(v) > MAX_PCT:
                suspect.append({'id': b['id'], 'name': b['name'], 'date': d, 'pct': v})
                v, a = None, None
            pct.append(v)
            amt.append(a)
        miss = sum(1 for v in pct if v is None)
        sectors.append({
            'id': b['id'], 'name': b['name'], 'type': b['type'],
            'pct': pct, 'amt': amt,
            'coverage': round((len(dates) - miss) / len(dates), 4),
        })
    if suspect:
        print(f'  ⚠ 拦截异常涨跌幅 {len(suspect)} 条(置为缺失): {suspect[:3]}')
    sectors.sort(key=lambda x: (x['type'], x['id']))

    out = {
        'meta': {
            'generatedAt': now8.strftime('%Y-%m-%d %H:%M:%S'),
            'lastTradeDate': dates[-1],
            'firstTradeDate': dates[0],
            'windowDays': len(dates),
            'sectorCount': len(sectors),
            'countByType': {
                t: sum(1 for s in sectors if s['type'] == t)
                for t in ('industry', 'concept', 'region')
            },
            'benchmark': BENCH[1],
            'benchmarkSecid': '1.000300',
            'failedCount': len(fail),
            'failedSectors': [{'id': a, 'name': b} for a, b, _ in fail][:30],
            'suspectCount': len(suspect),
            'suspectValues': suspect[:20],
            'source': 'ths d.10jqka.com.cn board line (full rebuild)',
            'schema': 'columnar-v1',
        },
        'dates': dates,
        'bench': [bench_map.get(d) for d in dates],
        'sectors': sectors,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, OUT)

    print('-' * 58)
    print(f'✓ 写入 {OUT}')
    print(f'  板块 {len(sectors)} 个 {out["meta"]["countByType"]}')
    print(f'  交易日 {len(dates)} 天 {dates[0]} ~ {dates[-1]}')
    print(f'  文件 {os.path.getsize(OUT) / 1048576:.2f} MB | 失败 {len(fail)} | '
          f'总耗时 {time.time() - t0:.0f}s')
    if fail:
        print(f'  失败示例: {fail[:5]}')
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=120)
    ap.add_argument('--throttle', type=float, default=0.12)
    ap.add_argument('--workers', type=int, default=6)
    args = ap.parse_args()

    now8 = datetime.now(CST)
    if now8.weekday() < 5 and (9, 30) <= (now8.hour, now8.minute) < (15, 5):
        print(f'⏸ 现在是交易时段({now8.strftime("%H:%M")}),板块日线还是盘中快照 → 15:05 后再跑')
        return 0

    print('=' * 58)
    print('板块轮动归档(同花顺单源)')
    print('=' * 58)
    try:
        boards = fetch_catalog()
    except Exception as e:  # noqa: BLE001
        print(f'✗ 板块目录不可达: {type(e).__name__} {e}')
        return 4
    if not boards:
        print('✗ 板块目录为空')
        return 4
    return build(boards, args.days, args.throttle, args.workers)


if __name__ == '__main__':
    sys.exit(main())
