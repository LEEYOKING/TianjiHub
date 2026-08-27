// 盘中实时数据层:通过 CORS 公开接口拉取实时数据
// 数据源:
//   - 指数实时: 腾讯 qt.gtimg.cn (GBK, CORS ✓) - 6 个核心指数
//   - 成分股列表: 新浪 vip.stock.finance.sina.com.cn/quotes_service/api/... (CORS ✓)
//     - node=hs_a 拿全市场个股(算 upCount/downCount/totalTurnover)
//     - node=new_xxxx 拿板块成分股(算板块涨跌幅 + 领涨股)
//   - 行业板块代码: 49 个新浪行业(new_blhy, new_dlhy 等)
//
// 静态 data.json 提供基础数据(净流入/领涨股详情/涨停股池/龙虎榜等),
// live data 覆盖 "指数涨跌幅 + 板块涨跌幅 + 全市场家数" 等实时变化快的字段。

/** 49 个新浪行业板块的 label(从 akshare sector_spot 取) */
export const SINA_INDUSTRY_LABELS = [
  'new_blhy',   // 玻璃行业
  'new_cbzz',   // 船舶制造
  'new_cmyl',   // 传媒娱乐
  'new_dlhy',   // 电力行业
  'new_dqhy',   // 电器行业
  'new_dzqj',   // 电子器件
  'new_dzxx',   // 电子信息
  'new_fdc',    // 房地产
  'new_fdsb',   // 发电设备
  'new_fjzz',   // 飞机制造
  'new_gthy',   // 钢铁行业
  'new_hbhy',   // 环保行业
  'new_hqhy',   // 化纤行业
  'new_hxxgy',  // 化工行业
  'new_jdhy',   // 家电行业
  'new_jjhy',   // 家具行业
  'new_jrhy',   // 金融行业
  'new_jxhy',   // 机械行业
  'new_jzqg',   // 建筑材料
  'new_jzzs',   // 建筑装饰
  'new_kfq',    // 开发区
  'new_lsjs',   // 绿色节能
  'new_lthy',   // 煤炭行业
  'new_mtc',    // 摩托车
  'new_ncpc',   // 农产品加工
  'new_nlmy',   // 农林牧渔
  'new_nyhy',   // 农药化肥
  'new_qczz',   // 汽车制造
  'new_qtgg',   // 其他工业
  'new_slhy',   // 食品行业
  'new_snhy',   // 塑料行业
  'new_sphy',   // 商业百货
  'new_syhy',   // 石油行业
  'new_tchy',   // 陶瓷行业
  'new_txfw',   // 通信服务
  'new_wlys',   // 物流行业
  'new_xfhy',   // 消费电子
  'new_xnyhy',  // 新能源
  'new_ylqx',   // 医疗器械
  'new_yqhy',   // 仪器仪表
  'new_yysc',   // 印刷包装
  'new_yshy',   // 印刷行业
  'new_zjhy',   // 造纸行业
  'new_zncd',   // 智能穿戴
  'new_zqqy',   // 证券期货
  'new_zyjs',   // 专业技术服务
  'new_zyyd',   // 中药行业
  'new_gghy1',  // 公共事业
  'new_gqhg',   // 股权变更
];

/** 7 个核心指数代码(对应 data.json indices 顺序) */
export const INDEX_CODES = ['sh000001', 'sz399001', 'sz399006', 'bj899050', 'sh000688', 'sh000300', 'sz399303'];
/** 与 INDEX_CODES 一一对应的指数中文名(v2.0.8gj:用于按名匹配覆盖,避免按索引错位) */
export const INDEX_NAMES = ['上证指数', '深证成指', '创业板指', '北证50', '科创50', '沪深300', '微盘指数'];

// v2.0.8:申万一级行业 31 个——行业板块统一用这一级,与脚本 data.json 的 sectors、热力图 classifySW28 对齐。
// 旧版前端用 em m:90+t:2(494 个申万二/三级)按"最长子串"模糊匹配同花顺 90 细分类,会把
// 医疗服务→其他医疗服务、电机→电机Ⅲ,把跌幅前10负值覆盖成正的三级子板块值,导致行业板块涨跌错乱。
export const SW_LEVEL1 = [
  '煤炭', '石油石化', '钢铁', '有色金属', '电子', '汽车', '家用电器', '食品饮料',
  '纺织服饰', '轻工制造', '医药生物', '公用事业', '交通运输', '房地产', '商贸零售',
  '社会服务', '综合', '建筑材料', '建筑装饰', '电力设备', '国防军工', '计算机', '传媒',
  '通信', '银行', '非银金融', '机械设备', '环保', '美容护理', '农林牧渔', '基础化工',
];
const SW_LEVEL1_SET = new Set(SW_LEVEL1);

const TENCENT_BASE = 'https://qt.gtimg.cn/q=';
const SINA_API = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData';

/** 单只股票数据(sina) */
interface SinaStock {
  symbol: string;
  code: string;
  name: string;
  trade: string;            // 最新价
  pricechange: string;      // 涨跌额
  changepercent: string;    // 涨跌幅
  settlement: string;       // 昨收
  open: string;             // 今开
  high: string;             // 最高
  low: string;              // 最低
  volume: number;           // 成交量(股)
  amount: number;           // 成交额(元)
  turnoverratio: string;    // 换手率
  ticktime: string;         // 最后成交时间
  per?: number;             // 市盈率
  pb?: number;              // 市净率
  mktcap?: number;          // 总市值(万)
  nmc?: number;             // 流通市值(万)
}

/** 拉取腾讯指数实时数据
 * 字段位置(0-indexed): 3=现价, 4=昨收, 5=今开, 6=成交量(手)
 *                       31=涨跌额, 32=涨跌幅, 33=最高, 34=最低
 *                       35="现价/成交量(手)/成交额(元)" 复合字段 */
export async function fetchLiveIndices(): Promise<{ name?: string; point: number; changeAmount: number; changePercent: number; turnover: number }[]> {
  try {
    const url = TENCENT_BASE + INDEX_CODES.join(',');
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buf);
    const lines = text.split(';').map((s) => s.trim()).filter(Boolean);
    const results: any[] = [];
    for (const line of lines) {
      const m = line.match(/="([^"]+)"/);
      if (!m) continue;
      const parts = m[1].split('~');
      if (parts.length < 36) continue;
      const point = parseFloat(parts[3]) || 0;
      const changeAmount = parseFloat(parts[31]) || 0;
      const changePercent = parseFloat(parts[32]) || 0;
      // 成交额: 解析 parts[35] 复合字段 "现价/成交量/成交额(元)"
      const amountStr = parts[35]?.split('/')[2] || '0';
      const amountYuan = parseFloat(amountStr) || 0;
      const turnover = Math.round(amountYuan / 1e8);  // 元 → 亿
      results.push({ name: INDEX_NAMES[results.length], point, changeAmount, changePercent, turnover });
    }
    return results;
  } catch (e) {
    console.warn('[live] fetchLiveIndices 失败:', e);
    return [];
  }
}

/** 拉取 sina 节点(全市场 / 板块)成分股 */
async function fetchSinaNode(node: string, num = 100): Promise<SinaStock[]> {
  return fetchSinaNodeByPage(node, num, 1);
}

async function fetchSinaNodeByPage(node: string, num: number, page: number): Promise<SinaStock[]> {
  return fetchSinaNodeByPageCustom(node, num, page, 'changepercent', 0);
}

async function fetchSinaNodeByPageCustom(node: string, num: number, page: number, sort: string, asc: number): Promise<SinaStock[]> {
  try {
    const url = `${SINA_API}?num=${num}&page=${page}&sort=${sort}&asc=${asc}&node=${node}&_=${Date.now()}`;
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buf);
    const decoded = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    if (!decoded.trim() || decoded.trim() === '[]') return [];
    const parsed = JSON.parse(decoded);
    // v2.0.7fv:M5 修 — sina 在风控/异常时常返 {} / null / 单对象,确保返数组
    if (!Array.isArray(parsed)) {
      console.warn(`[live] fetchSinaNode ${node} p${page} 返非数组:`, typeof parsed);
      return [];
    }
    return parsed as SinaStock[];
  } catch (e) {
    console.warn(`[live] fetchSinaNode ${node} p${page} 失败:`, e);
    return [];
  }
}

/** v2.0.7cs:东八区"今天"周几(0=周日,1=周一,...,6=周六)
 * — 海外 user 浏览器本地时间可能不是北京时间,统一用 UTC+8 算 */
function _isWeekendCN(): boolean {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const w = d.getUTCDay();
  return w === 0 || w === 6;
}

/** 拉取全市场汇总 — 通过并发拉 50 个 page (按代码排序,每页 100 = 5000 只 ≈ 全市场)
 * sina 限制 num=100 但支持 page=1..50, sort=code 时按代码顺序翻页
 * 并发 10 个 page, 总耗时 ~5s
 *
 * v2.0.7h:同时返回 limitUpCount/limitDownCount(让 fetchEMMarketStats / fetchTodaySnapshot 共享同源)
 * 上/跌/平/成交/涨跌停 一致用 sina 实时累加,卡片和曲线图必然一致
 *
 * v2.0.7cs:周末直接返 null — sina 周末返空,调它浪费配额,直接让 useLiveData 走 baseData
 *
 * v2.0.7ea:换成腾讯 qt.gtimg.cn(几乎不限流,海外 IP 实测稳定)
 * — 5,500+ 只全市场,100 只/批 × 55 批,~5s 拉完
 * — 字段:fields[3] 现价 / fields[4] 昨收 / fields[6] 成交量(手)/ fields[32] 涨跌幅 / fields[37] 成交额(万)
 * — CORS: access-control-allow-origin: * — 浏览器 React fetch 可直接调 */
export async function fetchMarketSummary(stockCodes?: string[]): Promise<{
  upCount: number; downCount: number; flatCount: number; totalTurnover: number;
  limitUpCount: number; limitDownCount: number;
  // v2.0.7ab:涨跌分布 11 档分桶
  changeDistribution?: {
    down_ge_10: number; down_10_to_7: number; down_7_to_5: number;
    down_5_to_3: number; down_3_to_0: number; flat: number;
    up_0_to_3: number; up_3_to_5: number; up_5_to_7: number;
    up_7_to_10: number; up_ge_10: number;
  };
} | null> {
  // v2.0.7cs:周末 sina 返空,直接 null(避免空数据被当成 stale 实时值)
  if (_isWeekendCN()) {
    return null;
  }
  // v2.0.7ew:过滤 stockCodes 只 A 股(/^(sh|sz)\d{6}$/)— baseData 13,999 只中含
  // 8,452 只港股通/可转债/历史重复代码,腾讯 qt.gtimg.cn 拉这些会失败(fields 长度 < 50)
  // 之前 13,999 只 140 批,部分批 100 只全是非 A 股 → allStocks.length === 0 → return null
  // → useState prev 保留 11:46 早盘 11948 → user 看到早盘数据(15:00 后)
  // 修法:过滤只 A 股代码,140 批变 56 批,3-5 分钟完成,降低限流概率
  let codes: string[];
  if (stockCodes && stockCodes.length > 0) {
    // 保留 sh/sz/bj 三种前缀(北交所 bj 也是 A 股,之前误滤掉导致全市场家数少 300+)
    codes = stockCodes.filter((c) => /^(sh|sz|bj)\d{6}$/.test(c));
  } else {
    // fallback 硬编码区间
    codes = [];
    for (let i = 600000; i < 606000; i++) codes.push(`sh${i}`);
    for (let i = 688000; i < 690000; i++) codes.push(`sh${i}`);
    for (let i = 1; i < 4000; i++) codes.push(`sz${String(i).padStart(6, '0')}`);
    for (let i = 300000; i < 302000; i++) codes.push(`sz${i}`);
  }

  const BATCH_SIZE = 100;
  const allStocks: { cp: number; amt: number; name: string; code: string; close: number; prevClose: number }[] = [];
  // v2.0.7eu:fetchMarketSummary 改 https://qt.gtimg.cn(跟 fetchLiveIndices 一致)
  // — 之前 line 205 写 http://qt.gtimg.cn 在 CF Pages (https) React 页面 fetch 时
  //   被浏览器 mixed content 拦截 → allStocks 永远是空 → 返 null → mergeLiveData 走 baseData
  // — 表现:user 早盘 9:30 后看到 baseData 上一交易日收盘数字(8/19 → 看不到 8/20 实时)
  // — fetchLiveIndices 用 TENCENT_BASE (https://) 一直能通,所以指数点位是新的,
  //   只有全市场家数/成交额/涨跌停/涨跌分布显示 baseData 旧值
  // v2.0.7ez:fetchMarketSummary 拉每批 1 域名 retry 3 次 + 2 个域名 fallback
  // — 8/20 user 反馈 15:00 后变早盘数据:腾讯海外 IP 限流,某批 fail → allStocks.length < 阈值
  //   → 返 null → useState prev 保留 11:46 早盘 11948
  // — 修法:每批 retry 3 次(1s/2s/4s 退避),失败换域名 qz.gtimg.cn / m.gtimg.cn
  const TENCENT_HOSTS = ['qt.gtimg.cn', 'qz.gtimg.cn', 'm.gtimg.cn'];

  // 拉单批(3 域名依次重试),返回原始 text 或 null
  const fetchOneBatch = async (batch: string[]): Promise<string | null> => {
    for (const host of TENCENT_HOSTS) {
      try {
        const url = `https://${host}/q=` + batch.join(',');
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://stockapp.finance.qq.com/' }
        });
        if (!resp.ok) continue;
        const text = await resp.text();
        if (text && text.length > 0) return text;
      } catch (e) {
        // 继续试下一个域名
      }
    }
    return null;
  };

  // 解析单批返回的 text(v_sh600519="1~贵州茅台~600519~1297.99~...")
  const parseBatchText = (text: string) => {
    for (const line of text.split(';')) {
      const eqIdx = line.indexOf('=');
      if (eqIdx < 0) continue;
      const fields = line.slice(eqIdx + 1).trim().replace(/^"|"$/g, '').split('~');
      if (fields.length < 50) continue;
      const codeRaw = fields[2];
      if (!codeRaw || !/^\d+$/.test(codeRaw)) continue;
      const name = fields[1];
      // 跳过退市
      if (name.includes('退')) continue;
      // v2.0.7ex:用 fields[3] 现价 / fields[4] 昨收 算涨跌幅,不用 fields[32]
      const close = parseFloat(fields[3]);
      const prevClose = parseFloat(fields[4]);
      const amt = parseFloat(fields[37]) || 0; // 成交额(万)
      if (isNaN(close) || isNaN(prevClose) || prevClose === 0) continue;
      const cp = ((close - prevClose) / prevClose) * 100;
      allStocks.push({ cp, amt, name, code: codeRaw, close, prevClose });
    }
  };

  // v2.0.7gg:并发拉取 — 原来 56 批串行约 2-3 分钟,改并发 10 批/轮,压到 ~几秒
  // — 腾讯 qt.gtimg.cn 对并发不敏感(海外 IP 实测稳定),CONCURRENCY 控制单轮并发批数
  const CONCURRENCY = 10;
  const batches: string[][] = [];
  for (let i = 0; i < codes.length; i += BATCH_SIZE) {
    batches.push(codes.slice(i, i + BATCH_SIZE));
  }
  for (let start = 0; start < batches.length; start += CONCURRENCY) {
    const group = batches.slice(start, start + CONCURRENCY);
    const texts = await Promise.all(group.map((b) => fetchOneBatch(b)));
    for (let gi = 0; gi < texts.length; gi++) {
      const text = texts[gi];
      if (!text) {
        console.warn('[fetchMarketSummary] 第', start + gi + 1, '批失败(3 域名)');
        continue;
      }
      parseBatchText(text);
    }
  }
  // v2.0.7gf:Bug1 修复 — 原逻辑按"批数"判断成功(50 只/批),当 stockCodes 是硬编码 13999 只
  // (含约 8400 个不存在代码)时 totalBatches=140,而真实 A 股仅约 5500 只 → successBatches≈56
  // < 140*0.9=126 → 永远返 null,盘中全市场实时数据因此失效
  // — 无效代码腾讯返 v_pv_none_match,fields.length<50 被跳过,不影响 allStocks.length
  // — 改为按"有效样本数"判断:全市场真实 A 股约 5500 只,拉到 4000+ 即视为有效快照
  if (allStocks.length < 4000) {
    console.warn(`[fetchMarketSummary] 有效样本仅 ${allStocks.length} 只(<4000),疑似限流/部分失败,返 null 保留 prev`);
    return null;
  }
  let up = 0, down = 0, flat = 0, total = 0, lu = 0, ld = 0;
  // v2.0.7ab:涨跌分布 11 档分桶
  const dist = {
    down_ge_10: 0, down_10_to_7: 0, down_7_to_5: 0, down_5_to_3: 0, down_3_to_0: 0,
    flat: 0,
    up_0_to_3: 0, up_3_to_5: 0, up_5_to_7: 0, up_7_to_10: 0, up_ge_10: 0,
  };
  for (const s of allStocks) {
    const cp = s.cp;
    const amt = s.amt;
    // v2.0.7fo:平盘判定 0 → abs < 0.005(同花顺 0.01% 精度口径)— 8/21 baseData 严格 cp===0 算 375 平,实际 ~133
    if (cp > 0.005) up++;
    else if (cp < -0.005) down++;
    else flat++;
    // v2.0.7ab:涨跌分布分桶 — v2.0.7fo:同步改 cp === 0 → abs < 0.005
    // v2.0.7fv:分桶标签错修 — 之前 cp < -5 写 down_5_to_3 错(应该是 down_7_to_5)
    if (cp < -10) dist.down_ge_10++;
    else if (cp < -7) dist.down_10_to_7++;
    else if (cp < -5) dist.down_7_to_5++;   // 修: 之前错写 down_5_to_3
    else if (cp < -3) dist.down_5_to_3++;
    else if (cp < 0) dist.down_3_to_0++;
    else if (Math.abs(cp) < 0.005) dist.flat++;
    else if (cp < 3) dist.up_0_to_3++;
    else if (cp < 5) dist.up_3_to_5++;
    else if (cp < 7) dist.up_5_to_7++;
    else if (cp < 10) dist.up_7_to_10++;
    else dist.up_ge_10++;
    // v2.0.7gf:涨跌停按精确涨停价比对(比涨跌幅阈值更准,彻底覆盖四舍五入冗余)
    // — 涨停价 = 昨收×(1±limitPct%) 四舍五入到分;现价 >= 涨停价即封板
    // — 板块判定(基于 6 位数字代码):
    //   北交所(4/8/9 开头)→ 30%;科创/创业(688/300/301)→ 20%;主板 ST → 5%;主板 → 10%
    //   注意:创业板/科创板 ST 涨跌幅仍是 20%、北交所 ST 仍 30%,只有主板 ST 才 5%
    //   (旧逻辑 isST 优先,会把创业板/科创板 ST 误判成 5%,导致涨跌停虚高)
    const isBJ = s.code.startsWith('4') || s.code.startsWith('8') || s.code.startsWith('9');
    const is20 = s.code.startsWith('688') || s.code.startsWith('300') || s.code.startsWith('301');
    const isST = s.name.includes('ST');
    const limitPct = isBJ ? 30 : (is20 ? 20 : (isST ? 5 : 10));
    const limitUpPrice = Math.round(s.prevClose * (1 + limitPct / 100) * 100) / 100;
    const limitDownPrice = Math.round(s.prevClose * (1 - limitPct / 100) * 100) / 100;
    // 严格等于涨停价才算封板(排除新股上市/复牌首日等无涨跌幅限制、close 远超涨跌停价的票)
    if (Math.abs(s.close - limitUpPrice) < 0.005) lu++;
    if (Math.abs(s.close - limitDownPrice) < 0.005) ld++;
    total += amt;
  }
  // v2.0.7ea:腾讯全市场 ~5,500 只,不再推算 × 11(直接用真实数字)
  return {
    upCount: up,
    downCount: down,
    flatCount: flat,
    // v2.0.7ea:成交额(万) → 亿 ÷ 1e4
    totalTurnover: Math.round(total / 1e4),
    limitUpCount: lu,
    limitDownCount: ld,
    changeDistribution: dist,
  };
}

/** 拉取今日实时数据(用于把 8.6 当日数据 push 到 history 末尾)
 * 返回: { date, volume, up, down, flat, limitUp, limitDown } */
export async function fetchTodaySnapshot(stockCodes?: string[]): Promise<{
  date: string;
  volume: number;
  up: number;
  down: number;
  flat: number;  // v2.0.7ex:用现价/昨收算的精确平盘数(baseData 277 错算成 98 才对)
  limitUp: number;
  limitDown: number;
} | null> {
  try {
    // v2.0.7cs:用东八区判断周末(海外 user 浏览器本地时间可能不是北京时间)
    if (_isWeekendCN()) return null;
    // 日期格式 yyyy-MM-dd — 用东八区,跟海外 user 浏览器一致
    const now8 = new Date(Date.now() + 8 * 3600 * 1000);
    const y = now8.getUTCFullYear();
    const m = String(now8.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now8.getUTCDate()).padStart(2, '0');
    const date = `${y}-${m}-${d}`;
    // v2.0.7ee:传 stockCodes 给 fetchMarketSummary
    const summary = await fetchMarketSummary(stockCodes);
    if (!summary) return null;  // 周末/fetch 失败
    // v2.0.7cu:全 0 数据(限流)→ 返 null(让 useState sticky 保留 prev 成功值)
    // — 之前返 {0,0,0,0} → setSnap today: todayResult ?? prev.today ?? 不 sticky(0 不是 null)→ 覆盖了 2.4 万亿成功值
    if (summary.totalTurnover === 0 && summary.upCount === 0 && summary.downCount === 0) {
      console.warn('[fetchTodaySnapshot] 拉到的全是 0(sina/em 限流),返 null 让 useState sticky 保留 prev 成功值');
      return null;
    }
    return {
      date,
      volume: summary.totalTurnover,
      up: summary.upCount,
      down: summary.downCount,
      flat: summary.flatCount,  // v2.0.7ex
      limitUp: summary.limitUpCount,
      limitDown: summary.limitDownCount,
    };
  } catch (e) {
    console.warn('[live] fetchTodaySnapshot 失败:', e);
    return null;
  }
}

/** 拉取单个 sina 行业板块的实时数据
 * 通过成分股计算: 总成交额(元) + 加权涨跌幅(成交额加权) + 领涨股(涨跌幅第一的成分股) */
export async function fetchSinaIndustry(sinaLabel: string): Promise<{
  changePercent: number;      // 加权涨跌幅
  totalTurnover: number;      // 总成交额(亿)
  leaderName: string;         // 领涨股
  leaderChangePercent: number; // 领涨股涨跌幅
  stockCount: number;
} | null> {
  const stocks = await fetchSinaNode(sinaLabel, 200);
  if (stocks.length === 0) return null;
  let totalAmount = 0, weightedSum = 0;
  for (const s of stocks) {
    // v2.0.7fv:M4 修 — sina changepercent 偶尔是 "-" / "" / undefined,parseFloat 返 NaN
    //   NaN * amt = NaN → weightedSum NaN → 整行业 NaN
    const cp = parseFloat(s.changepercent);
    const amt = s.amount || 0;
    if (isNaN(cp) || isNaN(amt)) continue;  // 跳过脏数据
    totalAmount += amt;
    weightedSum += cp * amt;
  }
  const weightedPct = totalAmount > 0 ? weightedSum / totalAmount : 0;
  const leader = stocks[0];  // 已按涨跌幅降序
  return {
    changePercent: Math.round(weightedPct * 100) / 100,
    totalTurnover: Math.round(totalAmount / 1e8 * 100) / 100,
    leaderName: leader.name,
    leaderChangePercent: Math.round(parseFloat(leader.changepercent) * 100) / 100,  // 跟上面统一取整
    stockCount: stocks.length,
  };
}

/** 拉取多个 sina 行业板块实时数据(并发) */
export async function fetchSinaIndustries(labels: string[]): Promise<Map<string, Awaited<ReturnType<typeof fetchSinaIndustry>>>> {
  const result = new Map<string, any>();
  const concurrency = 6;
  for (let i = 0; i < labels.length; i += concurrency) {
    const batch = labels.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((label) => fetchSinaIndustry(label).then((data) => ({ label, data }))));
    for (const { label, data } of results) {
      if (data) result.set(label, data);
    }
    // 加个小延迟避免请求过快
    if (i + concurrency < labels.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return result;
}

// v2.0.7gg:盘中实时拉 ETF/可转债涨跌家数(用脚本写入 data.json 的代码列表 + 腾讯行情)
// — 之前 ETF/可转债盘中不更新(em 限流,函数被删),现在用腾讯加载代码列表实时算涨/跌/平
export async function fetchETFAndBondStats(
  etfCodes: string[],
  bondCodes: string[],
): Promise<{ etf: { up: number; down: number; flat: number }; bond: { up: number; down: number; flat: number } }> {
  const statCodes = async (codes: string[]): Promise<{ up: number; down: number; flat: number }> => {
    let up = 0, down = 0, flat = 0;
    if (!codes || codes.length === 0) return { up: 0, down: 0, flat: 0 };
    const BATCH = 100;
    const batches: string[][] = [];
    for (let i = 0; i < codes.length; i += BATCH) batches.push(codes.slice(i, i + BATCH));
    const HOSTS = ['qt.gtimg.cn', 'qz.gtimg.cn', 'm.gtimg.cn'];
    const CONCURRENCY = 8;
    for (let start = 0; start < batches.length; start += CONCURRENCY) {
      const group = batches.slice(start, start + CONCURRENCY);
      const texts = await Promise.all(group.map(async (b) => {
        for (const host of HOSTS) {
          try {
            const resp = await fetch(`https://${host}/q=` + b.join(','), {
              headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://stockapp.finance.qq.com/' }
            });
            if (!resp.ok) continue;
            const t = await resp.text();
            if (t && t.length > 0) return t;
          } catch (e) { /* 下一个域名 */ }
        }
        return null;
      }));
      for (const text of texts) {
        if (!text) continue;
        for (const line of text.split(';')) {
          const eq = line.indexOf('=');
          if (eq < 0) continue;
          const fields = line.slice(eq + 1).trim().replace(/^"|"$/g, '').split('~');
          if (fields.length < 50) continue;
          const close = parseFloat(fields[3]);
          const prev = parseFloat(fields[4]);
          if (isNaN(close) || isNaN(prev) || prev === 0) continue;
          const cp = ((close - prev) / prev) * 100;
          if (cp > 0.005) up++;
          else if (cp < -0.005) down++;
          else flat++;
        }
      }
    }
    return { up, down, flat };
  };
  const [etf, bond] = await Promise.all([statCodes(etfCodes), statCodes(bondCodes)]);
  return { etf, bond };
}

// =============================================================
// 东方财富 push2 实时全市场接口(浏览器直连,CORS ✓,10s 轮询稳定)
// =============================================================
// EMMarketStats 现在由 fetchSinaStatsByNode 填(虽然名字带 EM,但内部已切 sina)
// v2.0.7cs:接口本身不变,函数返回 | null(周末/null → useLiveData 不覆盖 baseData)
interface EMMarketStats {
  upCount: number;
  downCount: number;
  flatCount: number;
  totalTurnover: number;  // 亿
  limitUpCount: number;
  limitDownCount: number;
  // v2.0.7ab:涨跌分布分桶(11 档)
  changeDistribution?: {
    down_ge_10: number; down_10_to_7: number; down_7_to_5: number;
    down_5_to_3: number; down_3_to_0: number; flat: number;
    up_0_to_3: number; up_3_to_5: number; up_5_to_7: number;
    up_7_to_10: number; up_ge_10: number;
  };
}

// =============================================================
// v2.0.7f:全部改用 sina vip API(已验证浏览器 CORS ✓,跟 49 行业同源,稳定)
// 不再赌东方财富 push2(fs 编码容易失效,且有风控)
// =============================================================
/** 沪深 A 股全市场统计 — v2.0.7h:改用 fetchMarketSummary(55 页 hs_a 全量累加)
 * 跟 fetchTodaySnapshot 同源,卡片和曲线图数据必然一致
 *
 * v2.0.7cs:返回 EMMarketStats | null — 周末/null 时 useLiveData 走 baseData,避免写死 0
 * v2.0.7cu:全 0(限流)→ 返 null — 跟 fetchTodaySnapshot 一致,让 useState sticky 保留 prev 成功值 */
export async function fetchEMMarketStats(): Promise<EMMarketStats | null> {
  const r = await fetchMarketSummary();
  if (!r) return null;  // 周末/null
  // v2.0.7cu:全 0(限流)→ 返 null
  if (r.totalTurnover === 0 && r.upCount === 0 && r.downCount === 0) {
    return null;
  }
  // v2.0.7dj:涨跌停 = 0 但 mktTotal > 0(em/sina 限流返部分数据)— 返 null
  // — 8/18 11:30 早盘限流 → sina 55 页只前 5 页返 → upCount 500 但 limitUpCount=0
  // — 走 baseData 80:7(错,user 期望 sticky em 实时算的 56:4)
  // — 修法:涨跌停 0 + 涨/跌 > 0 → 限流信号 → 返 null → React state sticky prev
  if (r.limitUpCount === 0 && r.limitDownCount === 0 && (r.upCount > 0 || r.downCount > 0)) {
    console.warn('[fetchEMMarketStats] 涨跌停=0 但涨/跌>0(em/sina 限流部分数据),返 null 让 useState sticky 保留 prev 涨跌停');
    return null;
  }
  return {
    upCount: r.upCount,
    downCount: r.downCount,
    flatCount: r.flatCount,
    totalTurnover: r.totalTurnover,
    limitUpCount: r.limitUpCount,
    limitDownCount: r.limitDownCount,
    changeDistribution: r.changeDistribution,
  };
}

// v2.0.7ea:删 fetchEMEtfStats / fetchEMBondStats 函数
// — CF Function 删了,useLiveData 改用 baseData(etfStats/bondStats: null)
// — 盘中 ETF/可转债 不实时拉(em 限流严,实测 5 域名全 FAIL)
// — 走 baseData.etfUp/etfDown/bondUp/bondDown(fetch-data 18:10 cron 写)
// — 留 useLiveData 字段为 null — Layout/Overview 不显示 ETF/可转债 实时值





// =============================================================
// v2.0.7ax:em 申万 90 行业实时(跟 ths 90 细分类 一一对应,不是 sina 49 行业聚合)
// — em "m:90+t:2" 申万二级行业(约 90 个)
// — 跟 ths 90 细分类 名字大部分一致(医疗服务/医疗器械/化学制药/中药 等都分开)
// — em 实时 10s 拉,按 name 模糊匹配覆盖 ths 90 细分类
// =============================================================


export interface EMIndustryItem {
  name: string;            // 申万行业名
  changePercent: number;   // 涨跌幅
  totalTurnover: number;   // 成交额(亿)
  leaderName: string;      // 领涨股
  leaderChangePercent: number;
  stockCount: number;
}

/** 拉取 em 申万板块实时数据(行业/概念/地域)
 * fs: m:90+t:2(申万行业) / m:90+t:3(申万概念) / m:90+t:1(申万地域)
 * 返回: Map<name, EMIndustryItem> */
async function fetchEMSectors(fs: string, pn = 1): Promise<Map<string, EMIndustryItem>> {
  // v2.0.8:pz 改 100(东财单页上限,原来 pz=200 实际也被截断),支持 pn 翻页
  const params = `pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fs=${fs}&fields=f3,f12,f14,f128&fid=f3`;
  const result = new Map<string, EMIndustryItem>();
  for (const domain of ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com', 'https://82.push2.eastmoney.com']) {
    try {
      const r = await fetch(`${domain}/api/qt/clist/get?${params}`, { cache: 'no-store' });
      const j = await r.json();
      if (j && j.data && j.data.diff && j.data.diff.length > 0) {
        for (const s of j.data.diff) {
          const name = s.f14 || '';
          if (!name) continue;
          result.set(name, {
            name,
            changePercent: Math.round((s.f3 || 0) * 100) / 100,
            totalTurnover: 0,  // em 这个接口没成交额,留着 0(用静态值)
            leaderName: s.f128 || '-',
            leaderChangePercent: 0,
            stockCount: 0,
          });
        }
        break;
      }
    } catch (e) {
      continue;
    }
  }
  return result;
}

/** em 申万一级行业(31 个) — v2.0.8:分页拉全 494 个再过滤到 31 个一级,确保涨幅/跌幅两端的一级行业都能取到
 * (旧版单页 pz=200 被东财截成 100 且按涨幅降序,只能取到涨幅前 100 个,跌幅行业永远取不到 → 跌幅前10 不实时) */
export const fetchEMIndustries = async (): Promise<Map<string, EMIndustryItem>> => {
  const result = new Map<string, EMIndustryItem>();
  for (let pn = 1; pn <= 6; pn++) {
    const page = await fetchEMSectors('m:90+t:2+f:!50', pn);
    if (page.size === 0) break;
    for (const [name, item] of page) {
      if (SW_LEVEL1_SET.has(name)) result.set(name, item);
    }
  }
  return result;
};
// v2.0.7gg:em 概念/地域板块(正确 fs 用空格分隔 + f:!50 过滤;URL 里 + 即空格)
export const fetchEMConcepts = () => fetchEMSectors('m:90+t:3+f:!50');
export const fetchEMRegions = () => fetchEMSectors('m:90+t:1+f:!50');

// =============================================================
// v2.0.7cs:Cloudflare Pages Function 优先(em 实时数据走 Function,绕开 user 浏览器直连 IP 限流)
// Function 拉失败时,fallback 直连 sina/em push2(双保险)
// =============================================================
// v2.0.7ea:删 MarketStatsAPIResponse interface
// — 4 个 CF Function 删了,React 也不再 fetch('/api/...') — 接口定义不再需要

// v2.0.7ea:删 fetchMarketStatsViaAPI / fetchEtfStatsViaAPI / fetchBondStatsViaAPI
// — CF Function 实测拉 em 全 FAIL 9.6s(5 域名),Function 没用
// — fetchMarketSummary 已改腾讯 qt.gtimg.cn(海外 IP 28s 5,363 只稳定)
// — ETF/可转债:盘中靠 fetchEMEtfStats / fetchEMBondStats(em 限流时返 null — sticky prev/baseData)
// — React useLiveData 直接调 fetchMarketSummary 即可
