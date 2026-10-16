import { describe, expect, it } from 'vitest';
import { describeGenTime, nextDateStr } from '../../../utils/format';

/**
 * 「盘后数据」状态词判定 —— V2.0 修订口径
 *   归档在 lastTradeDate 当日 15:05 之后 ~ 次日 09:30 之前生成 → 算盘后数据
 *   生成时点落在该交易日盘中(09:30~15:00) → 不算(那是盘中快照)
 *   生成时点晚于次日 09:30 → 不算(已经落后一个交易日)
 * 预期值全部手算给出(见每条用例的下方注释),不使用快照。
 */
describe('nextDateStr', () => {
  it('普通跨日', () => {
    expect(nextDateStr('2026-10-15')).toBe('2026-10-16');
    expect(nextDateStr('2026-10-09')).toBe('2026-10-10');
  });

  it('跨月/跨年/闰年边界', () => {
    expect(nextDateStr('2026-10-31')).toBe('2026-11-01');
    expect(nextDateStr('2026-12-31')).toBe('2027-01-01');
    expect(nextDateStr('2028-02-28')).toBe('2028-02-29');   // 2028 是闰年
    expect(nextDateStr('2026-02-28')).toBe('2026-03-01');   // 2026 非闰年
  });

  it('非法输入返回空串', () => {
    expect(nextDateStr('')).toBe('');
    expect(nextDateStr('2026-10')).toBe('');
    expect(nextDateStr('xxxx-10-15')).toBe('');
  });
});

describe('describeGenTime', () => {
  const LTD = '2026-10-15';   // 归档覆盖到的最后交易日

  it('同一交易日 15:05 之后生成 → 盘后数据(含边界 15:05 与 15:04)', () => {
    // 手算:日期相同且 HH:MM >= '15:05'
    expect(describeGenTime('2026-10-15 15:05:00', LTD)).toEqual({ time: '15:05', postClose: true });
    expect(describeGenTime('2026-10-15 15:35:12', LTD)).toEqual({ time: '15:35', postClose: true });
    expect(describeGenTime('2026-10-15 23:13:50', LTD)).toEqual({ time: '23:13', postClose: true });
    // 15:04 差一分钟 → 不算(严格大于等于 15:05)
    expect(describeGenTime('2026-10-15 15:04:59', LTD).postClose).toBe(false);
  });

  it('同一交易日盘中生成 → 不算盘后(14:09 就是这一类,此前把好数据误判成盘中的那种)', () => {
    // 手算:09:30~15:00 之间属于盘中快照
    expect(describeGenTime('2026-10-15 14:09:11', LTD).postClose).toBe(false);
    expect(describeGenTime('2026-10-15 09:30:00', LTD).postClose).toBe(false);
    expect(describeGenTime('2026-10-15 10:00:00', LTD).postClose).toBe(false);
  });

  it('★次日 09:30 之前生成 → 仍算盘后数据(本次修订的核心:云端 cron 延迟到凌晨补跑)', () => {
    // 手算:生成日期 = lastTradeDate 的次日,且 HH:MM < '09:30'
    expect(describeGenTime('2026-10-16 08:07:43', LTD)).toEqual({ time: '08:07', postClose: true });
    expect(describeGenTime('2026-10-16 00:04:00', LTD)).toEqual({ time: '00:04', postClose: true });
    expect(describeGenTime('2026-10-16 09:29:59', LTD).postClose).toBe(true);
    // 09:30 整点起开盘了 → 不算
    expect(describeGenTime('2026-10-16 09:30:00', LTD).postClose).toBe(false);
    expect(describeGenTime('2026-10-16 10:30:00', LTD).postClose).toBe(false);
  });

  it('落后更久 → 不算盘后(生成日期既非当日也非次日)', () => {
    // 手算:数据覆盖到 10/15,却到 10/17 才生成 → 已经落后,标注必须保留警示
    expect(describeGenTime('2026-10-17 08:00:00', LTD).postClose).toBe(false);
    expect(describeGenTime('2026-10-18 20:00:00', LTD).postClose).toBe(false);
  });

  it('跨月边界的次日凌晨也算盘后', () => {
    // 手算:lastTradeDate 2026-10-31 → 次日 2026-11-01,08:00 < 09:30
    expect(describeGenTime('2026-11-01 08:00:00', '2026-10-31').postClose).toBe(true);
    expect(describeGenTime('2026-11-02 08:00:00', '2026-10-31').postClose).toBe(false);
  });

  it('mock 传入的 lastTradeDate → 盘后数据', () => {
    expect(describeGenTime('2026-10-16 17:00:00', '2026-10-16').postClose).toBe(true);
    expect(describeGenTime('2026-10-16 12:00:00', '2026-10-16').postClose).toBe(false);
  });

  it('缺字段/格式过短 → 兜底为不可判定', () => {
    // 手算:长度 < 16 无法取出 'HH:MM' → time 显示占位,postClose 一律 false
    expect(describeGenTime(undefined, LTD)).toEqual({ time: '--:--', postClose: false });
    expect(describeGenTime('', LTD)).toEqual({ time: '--:--', postClose: false });
    expect(describeGenTime('2026-10-15', LTD)).toEqual({ time: '--:--', postClose: false });
    expect(describeGenTime('2026-10-16 08:07:43', undefined).postClose).toBe(false);
  });
});
