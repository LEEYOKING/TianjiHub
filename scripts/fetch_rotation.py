#!/usr/bin/env python3
"""
板块轮动 · P1 历史归档

用途
    把「每个交易日 × 每个板块」的涨跌幅 / 成交额归档成一份紧凑 JSON，
    供【板块轮动】页面在前端做规则引擎计算（不引入数据库）。

设计约束（重要）
    · 本脚本**只新增** public/rotation.json，不读写 data.json 等任何既有文件；
    · 不 import 也 exec 任何既有脚本，避免影响现有页面数据链路；
    · 幂等：同一交易日重跑不会产生重复行；区间重跑按 (date, sector) 覆盖。

数据源
    · 板块清单：东财 push2 clist  →  m:90+t:1(地域) / m:90+t:2(行业) / m:90+t:3(概念)
    · 板块日线：东财 push2his kline → secid=90.{BK码}
                字段 f51..f61 = 日期,开,收,高,低,量,额(元),振幅%,涨跌幅%,涨跌额,换手率%

用法
    python3 scripts/fetch_rotation.py --incremental       # ★每日增量:只新增"今天这一格"(约 13 次请求)
    python3 scripts/fetch_rotation.py                     # 全量回补 250 个交易日(默认)
    python3 scripts/fetch_rotation.py --days 90           # 回补 90 个交易日
    python3 scripts/fetch_rotation.py --only industry     # 只做行业板块
    python3 scripts/fetch_rotation.py --limit 5           # 只拉 5 个板块(联调用)
    python3 scripts/fetch_rotation.py --out /tmp/t.json   # 指定输出

两种模式的分工(2026-10-20 加入增量,起因是云端长期 0 成功)
    · 增量 --incremental:只补缺口的交易日(通常就一格),历史列原地保留。
      快路用 13 次 clist 分页拿全部 667 板块的当日涨跌幅/成交额(clist 与 kline 当日值同源),
      push2 被风控时退回逐板块 kline(按缺口取数,单次仅 ~14KB)。**每日盘后默认走这条**。
    · 全量 --days N:重建整份归档。只在"首次构建"或"归档不可用/缺口 >30 个交易日"时才用。
    退出码:0=成功/无需归档;1=数据源不可用或覆盖不足(不写文件);3=增量不适用 → 回退全量。
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
from concurrent.futures import ThreadPoolExecutor
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

# ---------- 增量模式相关 ----------
# 增量不适用(无历史归档 / 历史列不对齐 / 缺口>1 个交易日)→ 调用方回退全量重建
EXIT_NEED_FULL = 3
# 当日收盘就绪时点(CST):该时点之前 clist/kline 给的当日值都是**盘中快照**,
# 归档成"完整交易日"就是把假收盘数据写进库(与 data.json 的盘中事故同源),故一律拒绝。
CLOSE_READY = '15:05'
CST = timezone(timedelta(hours=8))
# 板块是成分股组合,单日涨跌幅数学上几乎不可能超过 ±20%(超出的属东财成分重构导致的脏数据)
SUSPECT_PCT = 20.0


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


def _num(v, div: float = 1.0):
    """东财字段可能返回 '-'/None/空(无数据)→ 统一转 float 或 None"""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return round(x / div, 2)


def kline_beg(days: int) -> str:
    """按"要回补 N 个交易日"折算 kline 的起始自然日(×1.9 留出周末/假期余量)。

    ⚠ 必须给 beg,不能用 beg=0 —— 东财 kline 的 `lmt` 在 beg=0 时**完全不生效**:
      2026-10-20 实测 lmt=120 仍返回 2000 年至今 6489 根日线(566KB),
      而 beg=20260301&lmt=120 只返 156 根(14KB)。全量为 667 个板块各发一次请求,
      用 beg=0 等于单轮拖 ~370MB —— 这才是"跑到 12 分钟被杀 / 频繁被风控"的主因。
    """
    d = datetime.now(CST) - timedelta(days=int(days * 1.9) + 10)
    return d.strftime('%Y%m%d')


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


def fetch_clist_quotes(btype: str, pagesize: int = 100) -> dict[str, tuple]:
    """东财 clist 快照:分页拿该类型**全部**板块的当日涨跌幅/成交额 → {板块id: (pct, amt亿)}

    口径实测(2026-10-20 盘中 10:26):同一板块的 clist f3/f6 与 push2his kline 当日那根
    完全同源 —— 差值 ≤0.05 个百分点、成交额 ≤0.3%,差异只来自两次取数的几秒时差。
    故"当日这一格"用 clist 取与用 kline 逐板块取是等价的,但请求量从 667 次降到 13 次。

    ⚠ pagesize 只能 100:实测 pz=200/500/1000 一律被风控秒断(RemoteDisconnected)。
    ⚠ 分页偶发丢项(实测 industry total=496 只返 494、concept total=516 只返 515),
      调用方需对缺失板块另做兜底(见 run_incremental)。
    """
    fs = BOARD_TYPES[btype]
    out: dict[str, tuple] = {}
    pn = 1
    total = None
    while True:
        qs = (f'/api/qt/clist/get?pn={pn}&pz={pagesize}&po=1&np=1&fltt=2&invt=2&fid=f3'
              f'&fs={fs}&fields=f12,f14,f3,f6')
        raw = multi_domain_get(qs, PUSH2_DOMAINS)
        j = json.loads(raw)
        data = j.get('data') or {}
        total = data.get('total') if total is None else total
        diff = data.get('diff')
        rows = diff if isinstance(diff, list) else list((diff or {}).values())
        if not rows:
            break
        for r in rows:
            code = str(r.get('f12') or '').strip()
            if code:
                out[code] = (_num(r.get('f3')), _num(r.get('f6'), 1e8))
        if total and len(out) >= int(total):
            break
        if len(rows) < pagesize:
            break
        pn += 1
        if pn > 30:  # 防御:最多 30 页(≈3000 个板块)
            break
    return out


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
def fetch_kline(secid: str, bars: int, beg: str = '0') -> tuple[str, list[list]]:
    """拉单个板块/指数的日线 → (名称, [[date, close, changePct, amount亿], ...])

    beg 传具体起始日(见 kline_beg);只有联调/短区间才该传 0(会拖回全历史,见其 docstring)。
    """
    qs = ('/api/qt/stock/kline/get?secid=' + secid +
          '&fields1=f1,f2,f3,f4,f5,f6'
          '&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'
          f'&klt=101&fqt=0&beg={beg}&end=20500101&lmt={int(bars)}')
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


def fetch_kline_many(items: list[dict], bars: int, beg: str, throttle: float = 0.12,
                     workers: int = 6) -> tuple[dict[str, list[list]], list[dict]]:
    """并发拉多个板块的日线 → ({板块id: rows}, [{id, name, err}])

    为什么并发:东财是"每请求固定延迟"型(单次 ~1.2s,与载荷无关),667 个板块单线程要 ~15 分钟,
    顶着 workflow 的 20 分钟超时跑 —— 一旦某轮慢一点就被 kill,前面的数据全白拉。
    6 路并发实测把总时长压到 ~2-3 分钟,把"被超时杀掉"这个失败源直接消掉。
    (与 fetch_real_data.py 对东财的并发策略一致:适度并发 + 提交间隔节流,不裸冲。)
    """
    per: dict[str, list[list]] = {}
    failed: list[dict] = []
    total = len(items)
    done = 0

    def one(b: dict):
        _n, rows = fetch_kline('90.' + b['id'], bars, beg)
        if not rows:
            raise RuntimeError('空日线')
        return b['id'], rows

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        futs = []
        for b in items:
            futs.append(ex.submit(one, b))
            time.sleep(throttle)          # 提交间隔节流(总时长仍由请求延迟主导)
        for f, b in zip(futs, items):     # 按提交顺序收结果,输出可复现
            try:
                sid, rows = f.result()
                per[sid] = rows
            except Exception as e:  # noqa: BLE001
                failed.append({'id': b['id'], 'name': b['name'], 'err': f'{type(e).__name__}: {e}'})
            done += 1
            if done % 50 == 0 or done == total:
                print(f'    进度 {done}/{total}  成功 {len(per)} 失败 {len(failed)}')
    return per, failed


# ---------- 3. 每日增量(2026-10-20 新增) ----------
MAX_PENDING_DAYS = 30    # 缺口超过这么多交易日就交给全量重建(尾部窗口一样长,重建更干净)
CLIST_MIN_HIT = 0.8      # clist 快路至少要覆盖 80% 板块才认(单类成功不算,否则等于绕远路)


def fetch_kline_days(secs: list[dict], days: list[str], throttle: float = 0.12
                     ) -> tuple[dict[str, dict[str, tuple]], list[str]]:
    """逐板块 kline:为**缺口那几天**取 (涨跌幅, 成交额亿) → ({日期: {板块id: (pct, amt)}}, 失败板块id)

    与全量的区别只在"要多少天":全量重建 120 天窗口;这里只要缺口那几根,单次载荷小很多 ——
    东财 lmt 在 beg=0 时失效(见 kline_beg),按缺口给 beg 才能把单次载荷从 566KB 压到 ~14KB。
    """
    beg = (datetime.strptime(days[0], '%Y-%m-%d') - timedelta(days=5)).strftime('%Y%m%d')
    rows_by_id, bad = fetch_kline_many(secs, len(days) + 8, beg, throttle)
    out: dict[str, dict[str, tuple]] = {d: {} for d in days}
    for s in secs:
        rows = rows_by_id.get(s['id'])
        m = {r[0]: (r[2], r[3]) for r in rows} if rows else {}
        for d in days:
            out[d][s['id']] = m.get(d, (None, None))
    failed = [b['id'] for b in bad]
    n_ok = sum(1 for v in out[days[-1]].values() if v[0] is not None)
    print(f'  kline 兜底完成:最新一格覆盖 {n_ok}/{len(secs)} 失败 {len(failed)}')
    for b in bad[:3]:
        print(f'    {b["id"]} {b["name"]}: {b["err"]}')
    return out, failed


def run_incremental(args) -> int:
    """只给现有归档 append 缺口的交易日(通常就一格),不动历史列。

    取数走**两条相互独立的路,谁通走谁**(东财 push2 与 push2his 常单独被风控):
      ① clist 快路(13 次请求):仅当缺口正好是"今天"时可用 —— clist 只给当日快照;
      ② kline 兜底(667 次请求,但按缺口取数、单次仅 ~14KB):缺口跨了多天、或目标日不是今天、
         或 push2 被风控时走这条。
    全量重建只在"归档不可用/缺口 >30 个交易日"时才是必要的(退出码 3 交给调用方)。

    退出码:0=已归档或无需归档;1=数据源不可用/覆盖不足(不写文件,线上保持原归档);
            EXIT_NEED_FULL=增量不适用(无归档/列不对齐/缺口过大/首建)。
    """
    try:
        with open(args.out, encoding='utf-8') as f:
            prev = json.load(f)
        dates = list(prev['dates'])
        bench = list(prev['bench'])
        secs = list(prev['sectors'])
    except Exception as e:  # noqa: BLE001
        print(f'  ✗ 读取上一份归档失败({type(e).__name__} {e}) → 增量不适用,需全量重建')
        return EXIT_NEED_FULL
    if len(dates) < 20 or len(secs) < MIN_SUCCESS_ABS:
        print(f'  ✗ 上一份归档过小(dates={len(dates)}, sectors={len(secs)}) → 需全量重建')
        return EXIT_NEED_FULL
    n = len(dates)
    bad = [s['id'] for s in secs if len(s.get('pct') or []) != n or len(s.get('amt') or []) != n]
    if bad:
        print(f'  ✗ 归档列式不对齐({len(bad)} 个板块,如 {bad[:5]}) → 需全量重建')
        return EXIT_NEED_FULL

    last = dates[-1]
    now8 = datetime.now(CST)
    today = now8.strftime('%Y-%m-%d')
    hhmm = now8.strftime('%H:%M')

    # 交易日骨架 + 基准当日涨跌幅:沪深300 日线(1 次请求),它同时回答"最近有哪些交易日"
    try:
        _bn, brows = fetch_kline(BENCH_SECID, 30, kline_beg(30))
        bench_map = {r[0]: r[2] for r in brows}
    except Exception as e:  # noqa: BLE001
        print(f'  ✗ 基准 {BENCH_NAME} 日线拉取失败({type(e).__name__} {e}) → 本次跳过(保持原归档)')
        return 1

    new_days = [d for d in sorted(bench_map) if d > last]
    # 只补"已完整收盘"的日子:当日收盘前(或非交易日)那根是盘中快照,归档成完整交易日
    # 就是把假收盘数据写进库(与 data.json 的盘中事故同源)。
    pending = [d for d in new_days if d < today or (d == today and hhmm >= CLOSE_READY)]
    if not pending:
        print(f'  · 无新增完整交易日(归档已到 {last};今日 {today} {hhmm}) → 跳过')
        return 0
    if len(pending) > MAX_PENDING_DAYS:
        print(f'  ✗ 缺口 {len(pending)} 个交易日(>{MAX_PENDING_DAYS}) → 需全量重建')
        return EXIT_NEED_FULL
    print(f'  待补交易日 {len(pending)} 个: {pending[0]} ~ {pending[-1]}')

    # ---- 取数①（快路，仅当缺口=今天这一格）：clist 一次分页拿全板块当日值 ----
    # 东财 push2(clist) 与 push2his(kline) 是**相互独立**的两个集群:实测常出现
    #   push2 整域被风控(HTTP 000,连接秒断)而 push2his 完全正常,或反之。
    # 所以下面两条路都要留着 —— 谁可用走谁。
    by_day: dict[str, dict[str, tuple]] = {}
    failed: list[str] = []
    if pending == [today]:
        quotes: dict[str, tuple] = {}
        for bt in ('region', 'industry', 'concept'):
            try:
                q = fetch_clist_quotes(bt)
                print(f'  [{bt}] clist 快照 {len(q)} 个')
                quotes.update(q)
            except Exception as e:  # noqa: BLE001
                print(f'  [{bt}] clist 快照失败: {type(e).__name__} {e}')
        hit = sum(1 for s in secs if quotes.get(s['id'], (None, None))[0] is not None)
        if hit >= len(secs) * CLIST_MIN_HIT:
            col = {s['id']: quotes.get(s['id'], (None, None)) for s in secs}
            miss = [s for s in secs if col[s['id']][0] is None]
            if miss:
                # clist 分页偶发丢项(实测 industry 496 只返 494 / concept 516 只返 515)+
                # 已停更的季节性概念板块 → 逐个 kline 补齐(通常只有个位数个)
                print(f'  · {len(miss)} 个板块不在 clist 快照中 → 逐个 kline 兜底')
                sub, f2 = fetch_kline_days(miss, [today], args.throttle)
                for sid, v in sub[today].items():
                    col[sid] = v
                failed = f2
            by_day = {today: col}
        else:
            print(f'  · clist 只覆盖 {hit}/{len(secs)}(不足 {CLIST_MIN_HIT:.0%})'
                  f' → 改用逐板块 kline(仅缺口天数)')

    # ---- 取数②（兜底）：逐板块 kline 取缺口那几天(缺口>1 天 / 目标日不是今天时只能走这条) ----
    if not by_day:
        by_day, failed = fetch_kline_days(secs, pending, args.throttle)

    # ---- 覆盖门槛:与全量同一套防"残缺归档污染全站"的逻辑(只看最后一格=页面当前值) ----
    last_col = by_day[pending[-1]]
    covered = sum(1 for s in secs if last_col[s['id']][0] is not None)
    min_ok = max(1, int(len(secs) * MIN_SUCCESS_RATIO))
    if covered < min_ok:
        print(f'  ✗ 最新交易日覆盖过低({covered}/{len(secs)},需 ≥{min_ok}) → 拒绝写入(线上保持原归档)')
        print(f'    失败板块示例: {failed[:8]}')
        return 1
    for d in pending[:-1]:
        n_d = sum(1 for s in secs if by_day[d][s['id']][0] is not None)
        if n_d < min_ok:
            print(f'  ⚠ {d} 覆盖偏低 {n_d}/{len(secs)}(中间缺口日,不影响页面当前值)')

    # ---- 合并:每列 append 一格(异常涨跌幅置 null 并留审计,与全量同规则) ----
    suspect: list[dict] = []
    add_cols: dict[str, dict[str, tuple]] = {}
    for d in pending:
        col: dict[str, tuple] = {}
        for s in secs:
            pct, amt = by_day[d][s['id']]
            if pct is not None and abs(pct) > SUSPECT_PCT:
                suspect.append({'id': s['id'], 'name': s['name'], 'date': d, 'pct': pct})
                pct, amt = None, None
            col[s['id']] = (pct, amt)
        add_cols[d] = col

    out_dates = dates + pending
    out_bench = bench + [bench_map.get(d) for d in pending]
    out_secs = []
    for s in secs:
        p, a = list(s['pct']), list(s['amt'])
        for d in pending:
            v = add_cols[d][s['id']]
            p.append(v[0])
            a.append(v[1])
        out_secs.append({
            'id': s['id'], 'name': s['name'], 'type': s['type'],
            'pct': p, 'amt': a, 'coverage': 1.0,
        })

    # ---- 窗口固定:超出就裁掉最老的一格(与全量 "只保留最近 N 个交易日" 一致,控仓库体积) ----
    # 窗口取本脚本的 --days(默认 120),**不是**上一份归档的 windowDays —— 后者会自我延续:
    # 只要某次写出的窗口比 120 长一格,之后每次增量都照着它保留,窗口就逐日膨胀。
    win = max(20, min(int(args.days or 120), len(out_dates)))
    if len(out_dates) > win:
        out_dates = out_dates[-win:]
        out_bench = out_bench[-win:]
        for s in out_secs:
            s['pct'] = s['pct'][-win:]
            s['amt'] = s['amt'][-win:]

    for s in out_secs:
        miss = sum(1 for v in s['pct'] if v is None)
        s['coverage'] = round((len(out_dates) - miss) / len(out_dates), 4)

    name_of = {s['id']: s['name'] for s in secs}
    out = {
        'meta': {
            'generatedAt': now8.strftime('%Y-%m-%d %H:%M:%S'),
            'lastTradeDate': out_dates[-1],
            'firstTradeDate': out_dates[0],
            'windowDays': len(out_dates),
            'sectorCount': len(out_secs),
            'countByType': {
                t: len([s for s in out_secs if s['type'] == t]) for t in ('industry', 'concept', 'region')
            },
            'benchmark': BENCH_NAME,
            'benchmarkSecid': BENCH_SECID,
            'failedCount': len(failed),
            'failedSectors': [{'id': i, 'name': name_of.get(i, '')} for i in failed][:30],
            'suspectCount': len(suspect),
            'suspectValues': suspect[:20],
            'source': 'eastmoney push2 clist (incremental) + push2his kline (fallback)',
            'schema': 'columnar-v1',
        },
        'dates': out_dates,
        'bench': out_bench,
        'sectors': out_secs,
    }

    outp = os.path.abspath(args.out)
    tmp = outp + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, outp)

    print('-' * 58)
    print(f'✓ 增量归档 {outp}')
    print(f'  新增交易日 {len(pending)} 个 {pending[0]} ~ {pending[-1]}(基准 {BENCH_NAME} {out_bench[-1]}%)')
    print(f'  最新一格覆盖 {covered}/{len(out_secs)} | 取数失败 {len(failed)} | 异常值 {len(suspect)}')
    print(f'  窗口 {len(out_dates)} 天 {out_dates[0]} ~ {out_dates[-1]} | 板块 {len(out_secs)} 个')
    return 0


# ---------- 4. 主流程 ----------
def main() -> int:
    ap = argparse.ArgumentParser(description='板块轮动 P1 历史归档')
    ap.add_argument('--days', type=int, default=120, help='回补最近 N 个交易日(默认 120,兼顾研究深度与仓库体积)')
    ap.add_argument('--only', default='all', choices=['all', 'region', 'industry', 'concept'])
    ap.add_argument('--limit', type=int, default=0, help='只拉前 N 个板块(联调用)')
    ap.add_argument('--incremental', action='store_true',
                    help='★每日增量:只给现有归档 append"今天这一格"(约 13 次请求,秒级完成)')
    ap.add_argument('--out', default=DEFAULT_OUT, help='输出路径')
    ap.add_argument('--throttle', type=float, default=0.12, help='每请求间隔秒(默认 0.12)')
    args = ap.parse_args()

    t0 = time.time()
    print('=' * 58)
    print('板块轮动 · P1 历史归档' + (' · 每日增量' if args.incremental else ' · 全量重建'))
    if args.incremental:
        # 增量只动"今天这一格",历史列原地保留,故 days/only/limit 不适用
        print(f'输出: {args.out}')
        print('=' * 58)
        return run_incremental(args)
    print(f'目标: 最近 {args.days} 个交易日 | 范围: {args.only} | 输出: {args.out}')
    print('=' * 58)

    # ---- 3.1 板块清单 ----
    btypes = ['region', 'industry', 'concept'] if args.only == 'all' else [args.only]
    boards: list[dict] = []
    failed_types: list[str] = []
    for bt in btypes:
        try:
            lst = fetch_board_list(bt)
            print(f'  [{bt}] 清单 {len(lst)} 个')
            boards.extend(lst)
        except Exception as e:  # noqa: BLE001
            print(f'  [{bt}] 清单拉取失败: {type(e).__name__} {e}')
            failed_types.append(bt)

    # 2026-10-20 修复:回退必须**按类型**做,而不是"三类全失败才回退"。
    # 实测(2026-10-20 run):region 清单成功 31 个,而 industry/concept 清单 502 Bad Gateway。
    # 此时旧的 `if not boards` 不会触发回退 → 行业口径过滤面对 **0 个行业板块** →
    # 匹配 0/128(申万二级)→ 待拉板块塌到只剩 31 个地域 → 整档必然失败。
    # 按类型回退后:失败的类型用上一份 rotation.json 里同类型的板块补齐,
    # 保持"待拉 667 个"的完整尝试面(东财部分恢复时才可能过成功率门槛)。
    if failed_types:
        prev = load_prev_boards(args.out)
        prev = [b for b in prev if args.only == 'all' or b['type'] == args.only]
        for bt in failed_types:
            add = [b for b in prev if b['type'] == bt]
            if add:
                print(f'  ⚠ [{bt}] 清单失败 → 回退上一份 rotation.json 的同类型板块: {len(add)} 个')
                boards.extend(add)
        if not boards:
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
        bn, brows = fetch_kline(BENCH_SECID, args.days + 20, kline_beg(args.days + 20))
        bench_map = {r[0]: r[2] for r in brows}
        print(f'  基准 {bn or BENCH_NAME}: {len(brows)} 根日线')
    except Exception as e:  # noqa: BLE001
        print(f'  ⚠ 基准指数拉取失败({type(e).__name__}),将改用板块日期并集作为交易日骨架')

    # ---- 3.3 逐板块拉日线(6 路并发,见 fetch_kline_many) ----
    rows_by_id, bad = fetch_kline_many(boards, args.days + 20, kline_beg(args.days + 20),
                                       args.throttle)
    bmap = {b['id']: b for b in boards}
    raw_secs = [{'id': sid, 'name': bmap[sid]['name'], 'type': bmap[sid]['type'], 'rows': rows}
                for sid, rows in rows_by_id.items()]
    ok = len(raw_secs)
    fail = [(b['id'], b['name'], b['err']) for b in bad]
    print(f'  拉取完成:耗时 {time.time() - t0:.0f}s')

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
    # 盘中保护:收盘前东财给的"今日"这根是盘中快照(成交额/涨跌幅都还在变),归档成完整交易日
    # 就是把假收盘数据写进库 —— 与 data.json 的盘中事故同源,故直接丢掉今天这根。
    now8 = datetime.now(CST)
    today, hhmm = now8.strftime('%Y-%m-%d'), now8.strftime('%H:%M')
    if dates and dates[-1] == today and hhmm < CLOSE_READY:
        dates = dates[:-1]
        print(f'  · 今日 {today} {hhmm} 未收盘 → 丢弃当日盘中快照,归档到上一完整交易日')
    if not dates:
        print('✗ 骨架为空(全部为盘中快照),未写入任何文件')
        return 1
    dates = dates[-args.days:]
    dset = set(dates)
    print(f'  交易日骨架: {len(dates)} 天 ({dates[0]} ~ {dates[-1]})')

    # ---- 3.5 组装:sectors(列式,缺失为 null) ----
    # 异常值守卫:板块是成分股组合,单日涨跌幅超过 ±20% 在数学上几乎不可能。
    # 实测仅 2 条:'昨日连板' 2025-11-12 -99.9% / '昨日连板_含一字' 2025-12-25 -99.89%,
    # 属东财板块成分重构导致的指数跳变(脏数据)。置 null(视为缺失)并从榜单计算中排除,
    # 同时在 meta.suspectValues 留审计痕迹 — 遵循"缺失/异常单独标记,不当作 0 涨跌"。
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