// 板块轮动 · 类型与规则定义层
// 纯逻辑模块：自包含，不依赖 React / 项目其它文件 / 任何第三方库。
// 数据源为 public/rotation.json（列式 columnar-v1）：pct/amt 中的 null 表示
// “当日无数据”，任何统计都不能把它当作 0 涨跌幅，分母需相应扣除。

/** 板块类型：行业 / 概念 / 地域 */
export type SectorType = 'industry' | 'concept' | 'region';
/** 多条件组合方式：OR=任一满足 AND=同时满足 */
export type EventLogic = 'OR' | 'AND';

/** 单个板块的时序数据（列式） */
export interface RotationSector {
  id: string;
  name: string;
  type: SectorType;
  pct: (number | null)[]; // 每日涨跌幅(%)，与 dates 对齐，缺失为 null
  amt: (number | null)[]; // 每日成交额(亿)，与 dates 对齐，缺失为 null
  coverage: number;
}

/** 数据元信息 */
export interface RotationMeta {
  generatedAt?: string;
  lastTradeDate?: string;
  firstTradeDate?: string;
  windowDays?: number;
  sectorCount?: number;
  countByType?: Partial<Record<SectorType, number>>;
  benchmark?: string;
  suspectCount?: number;
  source?: string;
  schema?: string;
}

/** 完整轮动数据集 */
export interface RotationData {
  meta: RotationMeta;
  dates: string[];             // 严格升序 YYYY-MM-DD
  bench: (number | null)[];    // 基准(如沪深300)每日涨跌幅(%)，长度与 dates 一致
  sectors: RotationSector[];
}

/** 规则集：决定窗口、榜单、阈值与事件合并口径 */
export interface RotationRuleSet {
  windowDays: number;        // 统计窗口(交易日)，如 15/30/60/90
  topN: number;              // 每日榜单数量，如 5/10/20
  riseThreshold: number;     // 大涨阈值(正数，单位 %)
  fallThreshold: number;     // 大跌阈值(正数，单位 %，比较时用 -fallThreshold)
  riseRankEnabled: boolean;  // 大涨是否启用“进入涨幅榜”条件
  fallRankEnabled: boolean;  // 大跌是否启用“进入跌幅榜”条件
  eventLogic: EventLogic;    // 多条件组合方式
  scope: 'all' | SectorType; // 板块范围
  cooldownDays: number;      // 独立事件冷却期(交易日步长)，0=不合并
  gapMin: number;            // 关注间隔下界(交易日步长)
  gapMax: number;            // 关注间隔上界(交易日步长)
  version: string;           // 规则版本号
}

/** 默认规则 — 严格对齐产品文档 §2.1「当前规则摘要」的"开箱即用"初始值：
 *  近 60 个交易日 / TOP 10 / 大涨 +2.5% / 大跌 −2.5% / 进榜条件启用 / 组合方式=任一满足 /
 *  板块范围=全部 / 关注间隔 1~5 个交易日 / 独立事件冷却期=0（不合并）
 *  这些只是初始值，不代表经回测验证的最优参数。
 *  注：version 变化会让 localStorage 里的旧规则存档作废（见 rotationData.readRule），
 *      这样调整默认值才能对老用户生效。 */
export const DEFAULT_RULE: RotationRuleSet = {
  windowDays: 60,
  topN: 10,
  riseThreshold: 2.5,
  fallThreshold: 2.5,
  riseRankEnabled: true,
  fallRankEnabled: true,
  eventLogic: 'OR',
  scope: 'all',
  cooldownDays: 0,
  gapMin: 1,
  gapMax: 5,
  version: '1.1.0',
};

// 序列化前缀（含版本，便于将来格式升级时兼容判断）
const RULE_PREFIX = 'R1';

/**
 * 序列化为可复制的紧凑配置串。
 * 字段顺序固定：前缀|windowDays|topN|riseThreshold|fallThreshold|
 *   riseRankEnabled|fallRankEnabled|eventLogic|scope|cooldownDays|gapMin|gapMax|version
 */
export function serializeRule(r: RotationRuleSet): string {
  return [
    RULE_PREFIX,
    r.windowDays,
    r.topN,
    r.riseThreshold,
    r.fallThreshold,
    r.riseRankEnabled ? 1 : 0,
    r.fallRankEnabled ? 1 : 0,
    r.eventLogic,
    r.scope,
    r.cooldownDays,
    r.gapMin,
    r.gapMax,
    r.version,
  ].join('|');
}

/** 反序列化：任何非法输入返回 null（不抛异常） */
export function deserializeRule(s: string): RotationRuleSet | null {
  if (typeof s !== 'string') return null;
  const p = s.trim().split('|');
  if (p.length !== 13 || p[0] !== RULE_PREFIX) return null;

  const toNum = (x: string): number => {
    const v = Number(x);
    return Number.isFinite(v) ? v : NaN;
  };
  const windowDays = toNum(p[1]);
  const topN = toNum(p[2]);
  const riseThreshold = toNum(p[3]);
  const fallThreshold = toNum(p[4]);
  const cooldownDays = toNum(p[9]);
  const gapMin = toNum(p[10]);
  const gapMax = toNum(p[11]);
  if ([windowDays, topN, riseThreshold, fallThreshold, cooldownDays, gapMin, gapMax].some(Number.isNaN)) {
    return null;
  }

  const eventLogic = p[7];
  if (eventLogic !== 'OR' && eventLogic !== 'AND') return null;
  const scope = p[8];
  if (scope !== 'all' && scope !== 'industry' && scope !== 'concept' && scope !== 'region') return null;

  return {
    windowDays,
    topN,
    riseThreshold,
    fallThreshold,
    riseRankEnabled: p[5] === '1',
    fallRankEnabled: p[6] === '1',
    eventLogic,
    scope,
    cooldownDays,
    gapMin,
    gapMax,
    version: p[12],
  };
}

/**
 * 稳定短指纹：基于 serializeRule 做 FNV-1a 32 位哈希。
 * 规则任一字段变化 → 指纹变化；相同规则 → 永远相同（可作缓存键 / 变更检测）。
 */
export function ruleFingerprint(r: RotationRuleSet): string {
  const s = serializeRule(r);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${RULE_PREFIX}-${h.toString(16).padStart(8, '0')}`;
}

// ===================== 规则参数校验（V2.0 阶段 5，任务书 §7.6） =====================

/** 一条可读的参数问题（field 便于界面定位到具体行） */
export interface RuleIssue {
  field: keyof RotationRuleSet;
  message: string;
}

/**
 * 校验规则参数，返回**可直接展示给用户的中文提示**；空数组 = 合法。
 *
 * 重点说明「阈值必须 > 0」这条：规则引擎里"该条件是否启用"的判定是 `阈值 > 0`
 * （见 ruleEngine 的 largeUpOn / largeDownOn），而事件标志位又按 `pct >= 阈值` 计算。
 * 因此阈值为 0 会出现自相矛盾的结果（条件被当作未启用，但标志位仍会命中所有非负涨幅），
 * 必须在配置器入口拦下来。
 */
export function validateRule(rule: RotationRuleSet): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (!(rule.windowDays > 0)) {
    issues.push({ field: 'windowDays', message: '统计窗口必须是大于 0 的交易日数。' });
  }
  if (!(rule.topN >= 1)) {
    issues.push({ field: 'topN', message: '每日榜单数量至少为 1。' });
  }
  if (!(rule.riseThreshold > 0)) {
    issues.push({
      field: 'riseThreshold',
      message: '大涨阈值必须大于 0：为 0 时该条件会被判为"未启用"，但涨幅判定仍会按 ≥0 命中，结果自相矛盾。',
    });
  }
  if (!(rule.fallThreshold > 0)) {
    issues.push({
      field: 'fallThreshold',
      message: '大跌阈值必须大于 0：为 0 时该条件会被判为"未启用"，但跌幅判定仍会按 ≤0 命中，结果自相矛盾。',
    });
  }
  if (!(rule.gapMin >= 1)) {
    issues.push({ field: 'gapMin', message: '关注间隔下限至少为 1 个交易日。' });
  }
  if (rule.gapMax < rule.gapMin) {
    issues.push({
      field: 'gapMax',
      message: `关注间隔上限（${rule.gapMax} 个交易日）不能小于下限（${rule.gapMin} 个交易日）。`,
    });
  }
  if (rule.cooldownDays < 0) {
    issues.push({ field: 'cooldownDays', message: '独立事件冷却期不能为负数。' });
  }
  return issues;
}