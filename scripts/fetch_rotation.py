#!/usr/bin/env python3
"""
板块轮动 · P1 历史归档

用途
    把「每个交易日 × 每个板块」的涨跌幅 / 成交额归档成一份紧凑 JSON，
    供【板块轮动】页面在前端做规则引擎计算（不引入数据库）。

设计约束（重要）
    · 本脚本**只新增** public/rotation.json，不读写 data.json / sectorKlines.json 等任何既有文件；
    · 不 import 也 exec 任何既有脚本，避免影响现有页面数据链路；
    · 幂等：同一交易日重跑不会产生重复行；区间重跑按 (date, sector) 覆盖。

数据源
    · 板块清单：东财 push2 clist  →  m:90+t:1(地域) / m:90+t:2(行业) / m:90+t:3(概念)
    · 板块日线：东财 push2his kline → secid=90.{BK码}
                字段 f51..f61 = 日期,开,收,高,低,量,额(元),振幅%,涨跌幅%,涨跌额,换手率%

用法
    python3 scripts/fetch_rotation.py                     # 全量回补 250 个交易日(默认)
    python3 scripts/fetch_rotation.py --days 90           # 回补 90 个交易日
    python3 scripts/fetch_rotation.py --only industry     # 只做行业板块
    python3 scripts/fetch_rotation.py --limit 5           # 只拉 5 个板块(联调用)
    python3 scripts/fetch_rotation.py --out /tmp/t.json   # 指定输出
"""
# 兼容 Python 3.9(macOS 自带)
from __future__ import annotations
import argparse
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta

# ---------- 常量 ----------
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.abspath(os.path.join(HERE, '..', 'public', 'rotation.json'))

# 最低成功率门槛:只成功拉到极少数板块时,归档是"残缺但看起来有效"的 —— 比整份失败更危险。
# 2026-10-16 实测事故:东财在成功返回第 1 个板块(青海 BK0163)后开始风控,其余 662 个全失败,
#   而 main() 原来只拦"全部失败",于是仍写出了只有 1 个板块的残缺归档并上线 → 排名池 n=1 时,
#   该板块每天都同时是第 1 名(进涨幅榜)和倒数第 1 名(进跌幅榜) → 页面出现
#   "强势 60 次 + 弱势 60 次"的矛盾数据,还把上一份完整的 663 板块归档覆盖掉了。
MIN_SUCCESS_RATIO = 0.9
MIN_SUCCESS_ABS = 10          # 全量场景下的绝对下限(仅在 total 较大时生效,以免破坏 --limit 联调)

# 东财 push2(板块清单)多域名 — 沿用 fetch_real_data.py 的容错思路(海外/云 IP 会间歇性封锁)
PUSH2_DOMAINS = [
    'https://push2.eastmoney.com',
    'https://82.push2.eastmoney.com',
    'https://47.push2.eastmoney.com',
    'https://90.push2.eastmoney.com',
    'https://push2delay.eastmoney.com',
    'https://1.push2.eastmoney.com',
]
# 东财 push2his(板块日线)多域名
PUSH2HIS_DOMAINS = [
    'https://push2his.eastmoney.com',
    'https://7.push2his.eastmoney.com',
    'https://push2his.eastmoney.com',
]

UA = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://quote.eastmoney.com/'}
SSL_CTX = ssl._create_unverified_context()

BOARD_TYPES = {
    'region': 'm:90+t:1',     # 地域板块 31 个
    'industry': 'm:90+t:2',   # 行业板块 496 个(申万一/二/三级混合)
    'concept': 'm:90+t:3',    # 概念板块 506 个
}

# 相对强度基准(沪深300) — push2his 的 secid 用 1. 前缀
BENCH_SECID = '1.000300'
BENCH_NAME = '沪深300'


# ---------- 工具 ----------
def http_get(url: str, timeout: int = 20, retry: int = 3, delay: float = 0.8) -> str:
    """带重试的 GET,返回解码文本;失败抛异常"""
    last = None
    for i in range(retry):
        try:
            req = urllib.request.Request(url, headers=UA)
            return urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX).read().decode('utf-8', 'ignore')
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(delay * (i + 1))
    raise last  # type: ignore[misc]


def multi_domain_get(path_qs: str, domains, timeout: int = 20) -> str:
    """按域名轮流尝试(兼容 push2 / push2his 的不同域名字段)"""
    last = None
    for d in domains:
        try:
            return http_get(d + path_qs, timeout=timeout, retry=1, delay=0)
        except Exception as e:  # noqa: BLE001
            last = e
    # 全部域名失败 → 再对第一个域名做一次带重试的尝试
    try:
        return http_get(domains[0] + path_qs, timeout=timeout, retry=2, delay=1.0)
    except Exception as e:  # noqa: BLE001
        last = e
    raise last  # type: ignore[misc]


def norm_name(s: str) -> str:
    """板块名归一化(去掉罗马数字后缀/空白),用于跨源匹配"""
    if not s:
        return ''
    s = str(s).strip().replace('　', '')
    s = re.sub(r'(Ⅱ|Ⅱ|II|Ⅲ|III|Ⅰ|I)$', '', s)
    return s


def load_prev_boards(path: str) -> list[dict]:
    """从上一份 rotation.json 读取板块清单 —— clist 被风控时的兜底。
    板块全集极少变动(东财偶尔增补概念板块),用上一份清单重拉日线不影响正确性。"""
    try:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        out = [{'id': str(s['id']), 'name': str(s['name']), 'type': str(s['type'])}
               for s in d.get('sectors', []) if s.get('id')]
        return out
    except Exception as e:  # noqa: BLE001
        print(f'    ⚠ 读取上一份 rotation.json 失败: {type(e).__name__} {e}')
        return []


# ---------- 1. 板块清单 ----------
def fetch_board_list(btype: str, pagesize: int = 100) -> list[dict]:
    """拉某类板块全量清单 → [{id, name, type}]"""
    fs = BOARD_TYPES[btype]
    out: list[dict] = []
    pn = 1
    total = None
    while True:
        qs = (f'/api/qt/clist/get?pn={pn}&pz={pagesize}&po=1&np=1&fltt=2&invt=2&fid=f3'
              f'&fs={fs}&fields=f12,f14')
        raw = multi_domain_get(qs, PUSH2_DOMAINS)
        j = json.loads(raw)
        data = j.get('data') or {}
        total = data.get('total') if total is None else total
        diff = data.get('diff')
        # diff 可能是 list 或 dict(视 invt 参数)
        rows = diff if isinstance(diff, list) else list((diff or {}).values())
        if not rows:
            break
        for r in rows:
            code = str(r.get('f12') or '').strip()
            name = str(r.get('f14') or '').strip()
            if code and name:
                out.append({'id': code, 'name': name, 'type': btype})
        if total and len(out) >= int(total):
            break
        if len(rows) < pagesize:
            break
        pn += 1
        if pn > 30:  # 防御:最多 30 页
            break
    # 去重(按 id)
    seen = {}
    for r in out:
        seen.setdefault(r['id'], r)
    return list(seen.values())


def industry_universe() -> tuple[list[str], str]:
    """行业板块口径 = 申万二级(与前端 src/data/live.ts 的 SW_LEVEL2 一致)
    返回 (申万二级名称列表(原始,含 Ⅱ), 来源说明)"""
    # 主源:直接解析前端 live.ts(单一事实来源,避免两处名单漂移)
    ts = os.path.abspath(os.path.join(HERE, '..', 'src', 'data', 'live.ts'))
    names: list[str] = []
    src = ''
    if os.path.exists(ts):
        try:
            with open(ts, encoding='utf-8') as f:
                txt = f.read()
            m = re.search(r'export const SW_LEVEL2\s*=\s*\[(.*?)\];', txt, re.S)
            if m:
                pairs = re.findall(r"'([^']+)'|\"([^\"]+)\"", m.group(1))
                names = [a or b for a, b in pairs]
                src = f'live.ts SW_LEVEL2({len(names)})'
        except Exception as e:  # noqa: BLE001
            print(f'    ⚠ 解析 live.ts 失败: {e}')
    # 备源:akshare 申万二级
    if not names:
        try:
            import warnings
            warnings.filterwarnings('ignore')
            import akshare as ak
            df = ak.sw_index_second_info()
            names = [str(x) for x in df['行业名称'].tolist()]
            src = f'akshare sw_index_second_info({len(names)})'
        except Exception as e:  # noqa: BLE001
            print(f'    ⚠ akshare 申万二级也失败: {e}')
    return names, src


def select_sw_level2(boards: list[dict], sw_names: list[str]) -> tuple[list[dict], list[str]]:
    """从东财行业混合池(m:90+t:2,申万一/二/三级)中挑出申万二级
    — 必须与申万二级名单**一对一**匹配:若用集合+后缀归一化会重复命中
      (例:申万二级 '白酒Ⅱ' 归一化为 '白酒',会把东财另一个 '白酒' 板块也带进来 → 168 > 128)
    返回 (选中板块列表, 未匹配的申万二级名)"""
    ind = [b for b in boards if b['type'] == 'industry']
    others = [b for b in boards if b['type'] != 'industry']
    used_ids: set[str] = set()
    missing: list[str] = []
    for nm in sw_names:
        cand = next((b for b in ind if b['id'] not in used_ids and b['name'] == nm), None)
        if cand is None:
            nn = norm_name(nm)
            cand = next((b for b in ind if b['id'] not in used_ids and norm_name(b['name']) == nn), None)
        if cand is None:
            missing.append(nm)
        else:
            used_ids.add(cand['id'])
    return others + [b for b in ind if b['id'] in used_ids], missing


# ---------- 2. 板块日线 ----------
def fetch_kline(secid: str, bars: int) -> tuple[str, list[list]]:
    """拉单个板块/指数的日线 → (名称, [[date, close, changePct, amount亿], ...])"""
    qs = ('/api/qt/stock/kline/get?secid=' + secid +
          '&fields1=f1,f2,f3,f4,f5,f6'
          '&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'
          f'&klt=101&fqt=0&beg=0&end=20500101&lmt={int(bars)}')
    raw = multi_domain_get(qs, PUSH2HIS_DOMAINS)
    j = json.loads(raw)
    d = j.get('data') or {}
    name = str(d.get('name') or '')
    rows: list[list] = []
    for k in (d.get('klines') or []):
        p = k.split(',')
        if len(p) < 9:
            continue
        try:
            date = p[0]
            close = float(p[2])
            pct = float(p[8])
            amt = float(p[6]) / 1e8  # 元 → 亿
        except (ValueError, IndexError):
            continue
        rows.append([date, round(close, 2), round(pct, 2), round(amt, 2)])
    return name, rows


# ---------- 3. 主流程 ----------
def main() -> int:
    ap = argparse.ArgumentParser(description='板块轮动 P1 历史归档')
    ap.add_argument('--days', type=int, default=120, help='回补最近 N 个交易日(默认 120,兼顾研究深度与仓库体积)')
    ap.add_argument('--only', default='all', choices=['all', 'region', 'industry', 'concept'])
    ap.add_argument('--limit', type=int, default=0, help='只拉前 N 个板块(联调用)')
    ap.add_argument('--out', default=DEFAULT_OUT, help='输出路径')
    ap.add_argument('--throttle', type=float, default=0.12, help='每请求间隔秒(默认 0.12)')
    args = ap.parse_args()

    t0 = time.time()
    print('=' * 58)
    print('板块轮动 · P1 历史归档')
    print(f'目标: 最近 {args.days} 个交易日 | 范围: {args.only} | 输出: {args.out}')
    print('=' * 58)

    # ---- 3.1 板块清单 ----
    btypes = ['region', 'industry', 'concept'] if args.only == 'all' else [args.only]
    boards: list[dict] = []
    for bt in btypes:
        try:
            lst = fetch_board_list(bt)
            print(f'  [{bt}] 清单 {len(lst)} 个')
            boards.extend(lst)
        except Exception as e:  # noqa: BLE001
            print(f'  [{bt}] 清单拉取失败: {type(e).__name__} {e}')

    # v2.0.8kz:clist 全域名被风控时的兜底(实测本地/云端均出现过 push2 整域被拒、
    # 而 push2his 日线正常)→ 用上一份 rotation.json 的板块清单继续重拉日线,
    # 避免"清单拿不到就整份归档失败"。板块全集极少变动,兜底不影响数据正确性。
    if not boards:
        prev = load_prev_boards(args.out)
        prev = [b for b in prev if args.only == 'all' or b['type'] == args.only]
        if prev:
            print(f'  ⚠ 清单接口全部失败 → 回退上一份 rotation.json 的板块清单: {len(prev)} 个')
            boards = prev
        else:
            print('  ✗ 清单全部失败,且无上一份 rotation.json 可兜底 → 放弃本次归档')
            return 1

    # 行业口径过滤:只保留申万二级(与前端【板块涨跌】页一致)
    if 'industry' in btypes:
        sw_names, sw_src = industry_universe()
        if sw_names:
            boards, missing = select_sw_level2(boards, sw_names)
            # 东财 clist 分页偶发缺项(实测某次只返 495/496,恰好少了 '化学原料' 的 BK1019)
            # → 未匹配时重拉行业清单再试,最多 3 次,取缺项最少的结果
            for attempt in range(3):
                if not missing:
                    break
                print(f'    ⚠ {len(missing)} 个申万二级未匹配(疑清单分页缺项: {missing[:5]}),'
                      f'第 {attempt + 1} 次重拉行业清单...')
                try:
                    fresh = fetch_board_list('industry')
                except Exception as e:  # noqa: BLE001
                    print(f'      重拉失败: {type(e).__name__} {e}')
                    break
                cand_boards, cand_missing = select_sw_level2(
                    [b for b in boards if b['type'] != 'industry'] + fresh, sw_names)
                if len(cand_missing) < len(missing):
                    boards, missing = cand_boards, cand_missing
            print(f'  行业口径: 申万二级(来源 {sw_src}) → 匹配 {len(sw_names) - len(missing)}/{len(sw_names)} 个;'
                  f'东财行业池其余(申万一级/三级)已剔除')
            if missing:
                print(f'    仍未匹配 {len(missing)} 个(东财无同名板块): {missing[:12]}')
        else:
            print('  ⚠ 未能取得申万二级名单,行业将使用东财混合池(m:90+t:2)全部板块 — 请注意口径')

    if args.limit > 0:
        boards = boards[:args.limit]
    print(f'  合计待拉 {len(boards)} 个板块(预计 {len(boards) * (0.12 + 0.25):.0f}s 左右)')

    # ---- 3.2 基准(沪深300)日线 → 交易日骨架 ----
    bench_map: dict[str, float] = {}
    try:
        bn, brows = fetch_kline(BENCH_SECID, args.days + 20)
        bench_map = {r[0]: r[2] for r in brows}
        print(f'  基准 {bn or BENCH_NAME}: {len(brows)} 根日线')
    except Exception as e:  # noqa: BLE001
        print(f'  ⚠ 基准指数拉取失败({type(e).__name__}),将改用板块日期并集作为交易日骨架')

    # ---- 3.3 逐板块拉日线 ----
    ok, fail = 0, []
    raw_secs: list[dict] = []
    for i, b in enumerate(boards, 1):
        try:
            _n, rows = fetch_kline('90.' + b['id'], args.days + 20)
            if not rows:
                raise RuntimeError('空日线')
            raw_secs.append({'id': b['id'], 'name': b['name'], 'type': b['type'], 'rows': rows})
            ok += 1
        except Exception as e:  # noqa: BLE001
            fail.append((b['id'], b['name'], f'{type(e).__name__}: {e}'))
        if i % 50 == 0 or i == len(boards):
            print(f'    进度 {i}/{len(boards)}  成功 {ok} 失败 {len(fail)}  ({time.time() - t0:.0f}s)')
        time.sleep(args.throttle)

    if not raw_secs:
        print('✗ 全部板块都拉取失败,未写入任何文件(线上保持原样)')
        return 1

    # 最低成功率门槛(2026-10-16 事故):只成功极少数板块时,残缺归档会"看起来有效"地污染全站
    total = len(boards)
    min_ok = max(1, int(total * MIN_SUCCESS_RATIO))
    if total >= 50:
        min_ok = max(min_ok, MIN_SUCCESS_ABS)
    if ok < min_ok:
        print(f'✗ 成功率过低({ok}/{total},需 ≥{min_ok}),拒绝写入 —— 避免残缺归档覆盖完整数据(线上保持原样)')
        print(f'  失败示例: {fail[:5]}')
        return 1

    # ---- 3.4 组装:交易日骨架 ----
    if bench_map:
        dates = sorted(bench_map.keys())
    else:
        all_d = set()
        for s in raw_secs:
            all_d.update(r[0] for r in s['rows'])
        dates = sorted(all_d)
    dates = dates[-args.days:]
    dset = set(dates)
    print(f'  交易日骨架: {len(dates)} 天 ({dates[0]} ~ {dates[-1]})')

    # ---- 3.5 组装:sectors(列式,缺失为 null) ----
    # 异常值守卫:板块是成分股组合,单日涨跌幅超过 ±20% 在数学上几乎不可能。
    # 实测仅 2 条:'昨日连板' 2025-11-12 -99.9% / '昨日连板_含一字' 2025-12-25 -99.89%,
    # 属东财板块成分重构导致的指数跳变(脏数据)。置 null(视为缺失)并从榜单计算中排除,
    # 同时在 meta.suspectValues 留审计痕迹 — 遵循"缺失/异常单独标记,不当作 0 涨跌"。
    SUSPECT_PCT = 20.0
    suspect: list[dict] = []
    sectors_out = []
    for s in raw_secs:
        m = {r[0]: r for r in s['rows']}
        pct, amt = [], []
        for d in dates:
            r = m.get(d)
            if r is None:
                pct.append(None)
                amt.append(None)
                continue
            v = r[2]
            if v is not None and abs(v) > SUSPECT_PCT:
                suspect.append({'id': s['id'], 'name': s['name'], 'date': d, 'pct': v})
                pct.append(None)
                amt.append(None)
            else:
                pct.append(v)
                amt.append(r[3])
        miss = sum(1 for v in pct if v is None)
        sectors_out.append({
            'id': s['id'], 'name': s['name'], 'type': s['type'],
            'pct': pct, 'amt': amt,
            'coverage': round((len(dates) - miss) / len(dates), 4),
        })
    if suspect:
        print(f'  ⚠ 拦截异常涨跌幅 {len(suspect)} 条(已置为缺失并记录审计): {suspect[:3]}')
    # 按 type 再按 id 稳定排序
    sectors_out.sort(key=lambda x: (x['type'], x['id']))

    bench = [bench_map.get(d) for d in dates] if bench_map else None

    now8 = datetime.now(timezone(timedelta(hours=8)))
    out = {
        'meta': {
            'generatedAt': now8.strftime('%Y-%m-%d %H:%M:%S'),
            'lastTradeDate': dates[-1],
            'firstTradeDate': dates[0],
            'windowDays': len(dates),
            'sectorCount': len(sectors_out),
            'countByType': {
                t: len([s for s in sectors_out if s['type'] == t]) for t in ('industry', 'concept', 'region')
            },
            'benchmark': BENCH_NAME,
            'benchmarkSecid': BENCH_SECID,
            'failedCount': len(fail),
            'failedSectors': [{'id': a, 'name': b} for a, b, _ in fail][:30],
            'suspectCount': len(suspect),
            'suspectValues': suspect[:20],
            'source': 'eastmoney push2his (board kline)',
            'schema': 'columnar-v1',
        },
        'dates': dates,
        'bench': bench,
        'sectors': sectors_out,
    }

    # ---- 3.6 写入(原子替换) ----
    outp = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(outp), exist_ok=True)
    tmp = outp + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, outp)

    size_mb = os.path.getsize(outp) / 1048576
    print('-' * 58)
    print(f'✓ 写入 {outp}')
    print(f'  板块 {len(sectors_out)} 个 {out["meta"]["countByType"]}')
    print(f'  交易日 {len(dates)} 天 {dates[0]} ~ {dates[-1]}')
    print(f'  文件 {size_mb:.2f} MB | 成功 {ok} 失败 {len(fail)} | 耗时 {time.time() - t0:.0f}s')
    if fail:
        print(f'  失败示例: {fail[:5]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())