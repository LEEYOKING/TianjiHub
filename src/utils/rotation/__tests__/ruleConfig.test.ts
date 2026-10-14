// 配置器（V2.0 阶段 5）—— 纯函数测试：规则参数校验（§7.6） + 规则方案存档（§7.5）
// 约定：预期值全部手算/明确给出，不用快照。
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE, serializeRule, validateRule } from '../types';
import type { RotationRuleSet } from '../types';
import {
  PRESET_LIMIT,
  decodePreset,
  parsePresets,
  removePreset,
  serializePresets,
  upsertPreset,
  type RulePreset,
} from '../../../data/rotationData';

const rule = (over: Partial<RotationRuleSet> = {}): RotationRuleSet => ({ ...DEFAULT_RULE, ...over });

describe('validateRule：参数校验（§7.6）', () => {
  it('默认规则合法 → 无任何问题', () => {
    expect(validateRule(DEFAULT_RULE)).toEqual([]);
  });

  it('边界合法：关注间隔上下限相等（gapMin === gapMax）不算问题', () => {
    expect(validateRule(rule({ gapMin: 5, gapMax: 5 }))).toEqual([]);
    expect(validateRule(rule({ gapMin: 1, gapMax: 30 }))).toEqual([]);
  });

  it('统计窗口为 0 → 报 windowDays', () => {
    const issues = validateRule(rule({ windowDays: 0 }));
    expect(issues.map((i) => i.field)).toEqual(['windowDays']);
    expect(issues[0].message).toContain('大于 0');
  });

  it('每日榜单数量为 0 → 报 topN', () => {
    expect(validateRule(rule({ topN: 0 })).map((i) => i.field)).toEqual(['topN']);
  });

  it('大涨阈值 = 0 → 报 riseThreshold（阶段 2 遗留的"0 会被当成未启用"缺陷）', () => {
    const issues = validateRule(rule({ riseThreshold: 0 }));
    expect(issues.map((i) => i.field)).toEqual(['riseThreshold']);
    expect(issues[0].message).toContain('自相矛盾');
  });

  it('大跌阈值 = 0 → 报 fallThreshold', () => {
    expect(validateRule(rule({ fallThreshold: 0 })).map((i) => i.field)).toEqual(['fallThreshold']);
  });

  it('关注间隔下限 = 0 → 报 gapMin', () => {
    expect(validateRule(rule({ gapMin: 0 })).map((i) => i.field)).toEqual(['gapMin']);
  });

  it('关注间隔上限 < 下限（5 < 8）→ 报 gapMax，且提示里带出两个具体数值', () => {
    const issues = validateRule(rule({ gapMin: 8, gapMax: 5 }));
    expect(issues.map((i) => i.field)).toEqual(['gapMax']);
    expect(issues[0].message).toContain('5');
    expect(issues[0].message).toContain('8');
  });

  it('冷却期为负 → 报 cooldownDays', () => {
    expect(validateRule(rule({ cooldownDays: -1 })).map((i) => i.field)).toEqual(['cooldownDays']);
  });

  it('多个问题同时出现 → 按字段逐个报出（顺序稳定）', () => {
    const issues = validateRule(rule({ windowDays: 0, topN: 0, gapMin: 9, gapMax: 3 }));
    expect(issues.map((i) => i.field)).toEqual(['windowDays', 'topN', 'gapMax']);
  });
});

describe('规则方案存档（§7.5）：parsePresets 的健壮性', () => {
  const enc = (over: Partial<RotationRuleSet> = {}) => serializeRule(rule(over));

  it('空 / 非法输入 → 空数组（不抛异常）', () => {
    expect(parsePresets(null)).toEqual([]);
    expect(parsePresets('')).toEqual([]);
    expect(parsePresets(undefined)).toEqual([]);
    expect(parsePresets('不是JSON')).toEqual([]);
    expect(parsePresets('{"a":1}')).toEqual([]);   // 非数组
  });

  it('缺 name 或 encoded、或 encoded 无法反序列化 → 该条被丢弃', () => {
    const raw = JSON.stringify([
      { name: 'ok', encoded: enc({ topN: 5 }) },
      { encoded: enc() },                            // 缺 name
      { name: 'noEnc' },                             // 缺 encoded
      { name: '乱码', encoded: 'R1|坏数据' },         // 反序列化失败
      { name: '  ', encoded: enc() },                // 名称只有空白
    ]);
    const out = parsePresets(raw);
    expect(out.map((p) => p.name)).toEqual(['ok']);
    expect(out[0].version).toBe(DEFAULT_RULE.version);
  });

  it('同名方案保留最后一条（相当于"覆盖"）', () => {
    const raw = JSON.stringify([
      { name: 'x', encoded: enc({ topN: 5 }) },
      { name: 'x', encoded: enc({ topN: 20 }) },
    ]);
    const out = parsePresets(raw);
    expect(out).toHaveLength(1);
    expect(out[0].encoded).toBe(enc({ topN: 20 }));
  });

  it('超过上限时只保留最新的一批（丢弃最早的）', () => {
    const raw = JSON.stringify(
      Array.from({ length: PRESET_LIMIT + 5 }, (_, i) => ({ name: `p${i}`, encoded: enc({ topN: (i % 3) + 1 }) })),
    );
    const out = parsePresets(raw);
    expect(out).toHaveLength(PRESET_LIMIT);
    expect(out[0].name).toBe(`p${5}`);                          // 最早的 5 条被丢弃
    expect(out[out.length - 1].name).toBe(`p${PRESET_LIMIT + 4}`);
  });

  it('serializePresets ↔ parsePresets 往返一致', () => {
    const list = parsePresets(JSON.stringify([{ name: 'a', encoded: enc({ windowDays: 15 }) }]));
    expect(parsePresets(serializePresets(list))).toEqual(list);
  });

  it('decodePreset：正常解出规则；损坏串返回 null', () => {
    expect(decodePreset({ name: 'a', encoded: enc({ topN: 20 }), version: DEFAULT_RULE.version })?.topN).toBe(20);
    expect(decodePreset({ name: 'a', encoded: '乱码', version: 'x' })).toBeNull();
  });
});

describe('规则方案存档（§7.5）：增删改', () => {
  it('upsertPreset：新增追加；同名则覆盖（数量不变，内容更新）', () => {
    const e1 = serializeRule(rule({ topN: 5 }));
    const e2 = serializeRule(rule({ topN: 20 }));
    let list = upsertPreset([], '甲', rule({ topN: 5 }));
    expect(list.map((p) => p.name)).toEqual(['甲']);
    expect(list[0].encoded).toBe(e1);

    list = upsertPreset(list, '乙', rule({ windowDays: 30 }));
    expect(list.map((p) => p.name)).toEqual(['甲', '乙']);

    list = upsertPreset(list, '甲', rule({ topN: 20 }));
    expect(list).toHaveLength(2);
    expect(list.find((p) => p.name === '甲')!.encoded).toBe(e2);
  });

  it('upsertPreset：名称为空白 → 原样返回（不新增）', () => {
    const list = upsertPreset([], '   ', DEFAULT_RULE);
    expect(list).toEqual([]);
  });

  it('upsertPreset：超过上限时丢弃最早的', () => {
    let list: RulePreset[] = [];
    for (let i = 0; i < PRESET_LIMIT + 3; i++) list = upsertPreset(list, `p${i}`, rule({ topN: (i % 3) + 1 }));
    expect(list).toHaveLength(PRESET_LIMIT);
    expect(list[0].name).toBe('p3');
    expect(list[list.length - 1].name).toBe(`p${PRESET_LIMIT + 2}`);
  });

  it('removePreset：按名称删除；不存在的名称不改变列表', () => {
    const list = upsertPreset(upsertPreset([], '甲', DEFAULT_RULE), '乙', rule({ topN: 5 }));
    expect(removePreset(list, '甲').map((p) => p.name)).toEqual(['乙']);
    expect(removePreset(list, '不存在')).toEqual(list);
  });

  it('保存旧版本方案不会被丢弃，且带出旧版本号（审计 R5：升级不丢配置）', () => {
    const oldRule = { ...DEFAULT_RULE, version: '0.9.0' };
    const list = upsertPreset([], '老方案', oldRule);
    expect(list[0].version).toBe('0.9.0');
    expect(parsePresets(serializePresets(list))[0].version).toBe('0.9.0');
    // 应用时由调用方按当前版本重新盖章（见 RotationRulePanel.applyPreset）
    expect(decodePreset(list[0])!.version).toBe('0.9.0');
  });
});
