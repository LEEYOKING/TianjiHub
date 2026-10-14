// 规则切换后全模块结果同步变化 / 规则存档 / 重复记录去重 —— 对应任务书 §14 的 9/13/18
import { describe, expect, it } from 'vitest';
import { computeWindow } from '../ruleEngine';
import { analyzeAll } from '../analytics';
import { DEFAULT_RULE, deserializeRule, serializeRule } from '../types';
import { normalize, pickStoredRule } from '../../../data/rotationData';
import { dataA, dataB, mkRule } from './fixtures';
import type { RotationData, RotationRuleSet } from '../types';

function statsOf(data: RotationData, rule: RotationRuleSet, id: string) {
  const comp = computeWindow(data, rule);
  return {
    comp,
    s: analyzeAll(data, rule, comp).find((x) => x.sector.id === id)!,
  };
}

describe('规则切换后统计结果同步重算（§14 第 9 项）', () => {
  it('窗口 10 → 6：板块 a 强势次数 4→3、累计收益同步变化', () => {
    const data = dataA();
    const w10 = statsOf(data, mkRule({ windowDays: 10 }), 'a');
    const w6 = statsOf(data, mkRule({ windowDays: 6 }), 'a');

    // 窗口 10 天：强势 d2,d5,d6,d8
    expect(w10.s.strongCount).toBe(4);
    // 窗口 6 天（仅 d5~d10）：强势 d5,d6,d8；弱势 d7,d10
    expect(w6.s.strongCount).toBe(3);
    expect(w6.s.strongDates).toEqual(['d5', 'd6', 'd8']);
    expect(w6.s.weakCount).toBe(2);
    expect(w6.s.weakDates).toEqual(['d7', 'd10']);

    // 累计收益：窗口 6 天 = 1.02*1.05*0.99*1.03*1.005*0.96 - 1
    expect(w10.s.cumReturn).toBeCloseTo(0.0735582958849, 9);
    expect(w6.s.cumReturn).toBeCloseTo(0.0536568258, 9);

    // 窗口长度变化时，日期轴也必须同步变化
    expect(w6.comp.dates).toEqual(['d5', 'd6', 'd7', 'd8', 'd9', 'd10']);
    expect(w10.comp.dates).toHaveLength(10);
  });

  it('窗口大于数据长度时自动截断到全部交易日', () => {
    const data = dataB();
    const { comp } = statsOf(data, mkRule({ windowDays: 999, topN: 1 }), 'p');
    expect(comp.dates).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6']);
  });

  it('板块范围切换（scope）只保留对应类型', () => {
    const data = dataA();
    const withIndustry = statsOf(data, mkRule({ scope: 'industry' }), 'a');
    expect(withIndustry.comp.series).toHaveLength(5);
    const withConcept = statsOf(data, mkRule({ scope: 'concept' }), 'a');
    expect(withConcept.comp.series).toHaveLength(0); // 夹具 A 全是行业板块
  });

  it('scope 切换后排名只在范围内进行（概念范围下没有板块 → 无榜单）', () => {
    const data = dataA();
    const { comp } = statsOf(data, mkRule({ scope: 'region' }), 'a');
    expect(comp.ranking[0].total).toBe(0);
    expect(comp.ranking[0].ranked).toEqual([]);
  });
});

describe('规则存档：序列化 / 反序列化 / 版本作废（§14 第 18 项）', () => {
  it('序列化 → 反序列化 往返一致', () => {
    const custom: RotationRuleSet = {
      windowDays: 30, topN: 20, riseThreshold: 5, fallThreshold: 4.5,
      riseRankEnabled: false, fallRankEnabled: true, eventLogic: 'AND',
      scope: 'concept', cooldownDays: 3, gapMin: 2, gapMax: 8, version: '1.1.0',
    };
    const back = deserializeRule(serializeRule(custom));
    expect(back).toEqual(custom);
  });

  it('非法串一律返回 null（不抛异常）', () => {
    expect(deserializeRule('')).toBeNull();
    expect(deserializeRule('R2|1|2|3|4|1|1|OR|all|0|1|5|1.1.0')).toBeNull(); // 前缀不对
    expect(deserializeRule('R1|a|2|3|4|1|1|OR|all|0|1|5|1.1.0')).toBeNull(); // 数字非法
    expect(deserializeRule('R1|30|10|3|3|1|1|XOR|all|0|1|5|1.1.0')).toBeNull(); // 组合方式非法
    expect(deserializeRule('R1|30|10|3|3|1|1|OR|mars|0|1|5|1.1.0')).toBeNull(); // 范围非法
  });

  it('存档有效且版本一致 → 采用存档（用户自定义得以保留）', () => {
    const custom = { ...DEFAULT_RULE, windowDays: 90, topN: 20 };
    expect(pickStoredRule(serializeRule(custom))).toEqual(custom);
  });

  it('存档版本与当前默认不一致 → 作废并回落新默认值', () => {
    const old = { ...DEFAULT_RULE, windowDays: 30, topN: 5, version: '1.0.0' };
    const picked = pickStoredRule(serializeRule(old));
    expect(picked).toEqual(DEFAULT_RULE);
    expect(picked.version).toBe('1.1.0');
    expect(picked.windowDays).toBe(60);
    expect(picked.topN).toBe(10);
    expect(picked.riseThreshold).toBe(2.5);
  });

  it('没有存档 / 存档损坏 → 一律回落默认值', () => {
    expect(pickStoredRule(null)).toEqual(DEFAULT_RULE);
    expect(pickStoredRule('乱码')).toEqual(DEFAULT_RULE);
  });
});

describe('数据源重复记录去重（§14 第 13 项）', () => {
  it('同一 id 出现两次 → 只保留第一条，统计不会被算两次', () => {
    const dup = {
      meta: { lastTradeDate: 'd2' },
      dates: ['d1', 'd2'],
      bench: [0, 0],
      sectors: [
        { id: 'a', name: '甲', type: 'industry', pct: [1, 2], amt: [0, 0], coverage: 1 },
        { id: 'a', name: '甲(重复)', type: 'industry', pct: [1, 2], amt: [0, 0], coverage: 1 },
        { id: 'b', name: '乙', type: 'industry', pct: [0, 0], amt: [0, 0], coverage: 1 },
      ],
    };
    const d = normalize(dup);
    expect(d.sectors).toHaveLength(2);
    expect(d.sectors.map((s) => s.id)).toEqual(['a', 'b']);
    expect(d.sectors[0].name).toBe('甲');
  });

  it('非法行（缺 id / 缺 name / null）被过滤掉，不影响其它板块', () => {
    const d = normalize({
      dates: ['d1'],
      bench: [0],
      sectors: [
        { id: 'a', name: '甲', type: 'industry', pct: [1] },
        { id: '', name: '缺id' },
        { id: 'x', name: '' },
        null,
      ],
    });
    expect(d.sectors.map((s) => s.id)).toEqual(['a']);
  });

  it('字段缺失时给出安全默认值（pct/amt/coverage 不合法也不崩）', () => {
    const d = normalize({ sectors: [{ id: 'a', name: '甲' }] });
    expect(d.sectors[0].pct).toEqual([]);
    expect(d.sectors[0].amt).toEqual([]);
    expect(d.sectors[0].coverage).toBe(0);
    expect(d.sectors[0].type).toBe('industry');
    expect(d.dates).toEqual([]);
    expect(d.bench).toEqual([]);
  });

  it('非对象 / 缺 sectors 时返回空数据集而不是抛错', () => {
    expect(normalize(null).sectors).toEqual([]);
    expect(normalize({}).sectors).toEqual([]);
    expect(normalize({ sectors: 'not-array' }).sectors).toEqual([]);
  });
});
