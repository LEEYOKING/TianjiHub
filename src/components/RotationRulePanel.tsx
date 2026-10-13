// 板块轮动:规则摘要栏 + 规则配置抽屉
// 口径一致性:所有轮动页共用 rotationData 里的规则单例;此处只负责"展示 + 修改"
// 视觉:沿用站点既有卡片体系(圆角 14 / CARD_SHADOW / #E5E7EB 边框 / 红涨绿跌)
import { useState } from 'react';
import {
  COLOR_BORDER,
  COLOR_DOWN,
  COLOR_FLAT,
  COLOR_PRIMARY,
  COLOR_TEXT,
  COLOR_UP,
} from '../utils/format';
import { DEFAULT_RULE, serializeRule, type RotationRuleSet, type SectorType } from '../utils/rotation/types';

const CARD_SHADOW = '0 1px 3px rgba(0, 0, 0, 0.04), 0 0 30px 5px rgba(0, 0, 0, 0.02)';

const SCOPE_LABEL: Record<'all' | SectorType, string> = {
  all: '全部板块',
  industry: '仅行业',
  concept: '仅概念',
  region: '仅地域',
};

// ---------- 小组件 ----------
function Chip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: '#F5F7FA',
        border: `1px solid ${COLOR_BORDER}`,
        borderRadius: 8,
        padding: '4px 10px',
        fontSize: 12,
        color: '#4E5969',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
      <b style={{ color: color || COLOR_TEXT, fontWeight: 600 }}>{value}</b>
    </span>
  );
}

function Seg<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { label: string; value: T }[];
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'inline-flex', background: '#F5F6F8', borderRadius: 6, padding: 2, gap: 2 }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          style={{
            border: 'none',
            background: value === o.value ? '#fff' : 'transparent',
            color: value === o.value ? COLOR_TEXT : '#86909C',
            fontWeight: value === o.value ? 600 : 400,
            fontSize: 12,
            padding: '4px 10px',
            borderRadius: 4,
            cursor: 'pointer',
            boxShadow: value === o.value ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            transition: 'all .15s',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT, marginBottom: 2 }}>{title}</div>
      {desc && <div style={{ fontSize: 11, color: '#86909C', marginBottom: 10, lineHeight: 1.6 }}>{desc}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 12, color: '#4E5969' }}>{label}</span>
      {children}
    </div>
  );
}

function Slider({
  value,
  min,
  max,
  step,
  onChange,
  suffix = '%',
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 170 }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: 110, accentColor: COLOR_PRIMARY }}
      />
      <b style={{ fontSize: 12, color: COLOR_TEXT, minWidth: 42, textAlign: 'right' }}>
        {value}
        {suffix}
      </b>
    </div>
  );
}

// ---------- 主组件 ----------
export function RotationRuleBar({
  rule,
  onChange,
  dataRange,
}: {
  rule: RotationRuleSet;
  onChange: (r: RotationRuleSet) => void;
  dataRange?: { first?: string; last?: string; windowDays?: number; sectorCount?: number; suspectCount?: number };
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const patch = (p: Partial<RotationRuleSet>) => onChange({ ...rule, ...p, version: DEFAULT_RULE.version });

  const riseCond = rule.riseRankEnabled
    ? `进涨幅榜${rule.eventLogic === 'AND' ? ' 且 ' : ' 或 '}≥${rule.riseThreshold}%`
    : `≥${rule.riseThreshold}%`;
  const fallCond = rule.fallRankEnabled
    ? `进跌幅榜${rule.eventLogic === 'AND' ? ' 且 ' : ' 或 '}≤-${rule.fallThreshold}%`
    : `≤-${rule.fallThreshold}%`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serializeRule(rule));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <div
        style={{
          background: '#fff',
          border: `1px solid ${COLOR_BORDER}`,
          borderRadius: 14,
          boxShadow: CARD_SHADOW,
          padding: '12px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT, marginRight: 2 }}>当前规则</span>
        <Chip label="窗口" value={`近 ${rule.windowDays} 个交易日`} />
        <Chip label="榜单" value={`TOP ${rule.topN}`} />
        <Chip label="大涨" value={riseCond} color={COLOR_UP} />
        <Chip label="大跌" value={fallCond} color={COLOR_DOWN} />
        <Chip label="范围" value={SCOPE_LABEL[rule.scope]} />
        <Chip label="组合" value={rule.eventLogic === 'AND' ? '同时满足' : '任一满足'} />
        <Chip label="独立事件冷却" value={rule.cooldownDays === 0 ? '不合并' : `${rule.cooldownDays} 日`} />
        <Chip label="关注间隔" value={`${rule.gapMin}~${rule.gapMax} 个交易日`} />
        <div style={{ flex: 1 }} />
        {dataRange && (
          <span style={{ fontSize: 11, color: '#86909C' }}>
            数据范围 {dataRange.first} ~ {dataRange.last}（{dataRange.windowDays} 个交易日 · {dataRange.sectorCount} 个板块）
            {dataRange.suspectCount ? ` · 已剔除异常值 ${dataRange.suspectCount} 条` : ''}
          </span>
        )}
        <button
          onClick={() => setOpen(true)}
          style={{
            border: `1px solid ${COLOR_PRIMARY}`,
            background: '#fff',
            color: COLOR_PRIMARY,
            borderRadius: 8,
            padding: '5px 14px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          调整规则
        </button>
      </div>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.28)', zIndex: 1200 }}
          />
          <div
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: 400,
              maxWidth: '92vw',
              background: '#fff',
              zIndex: 1201,
              boxShadow: '-8px 0 28px rgba(0,0,0,0.10)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: `1px solid ${COLOR_BORDER}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700, color: COLOR_TEXT }}>轮动规则配置器</span>
              <button
                onClick={() => setOpen(false)}
                style={{ border: 'none', background: 'transparent', fontSize: 18, color: '#86909C', cursor: 'pointer' }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: '18px 20px', overflowY: 'auto', flex: 1 }}>
              <Section title="基础设置" desc="决定统计范围,先从这里开始">
                <Row label="统计窗口">
                  <Seg
                    value={rule.windowDays}
                    onChange={(v) => patch({ windowDays: v })}
                    options={[
                      { label: '15日', value: 15 },
                      { label: '30日', value: 30 },
                      { label: '60日', value: 60 },
                      { label: '90日', value: 90 },
                    ]}
                  />
                </Row>
                <Row label="板块范围">
                  <Seg
                    value={rule.scope}
                    onChange={(v) => patch({ scope: v })}
                    options={[
                      { label: '全部', value: 'all' as const },
                      { label: '行业', value: 'industry' as const },
                      { label: '概念', value: 'concept' as const },
                      { label: '地域', value: 'region' as const },
                    ]}
                  />
                </Row>
                <Row label="每日榜单数量">
                  <Seg
                    value={rule.topN}
                    onChange={(v) => patch({ topN: v })}
                    options={[
                      { label: 'TOP 5', value: 5 },
                      { label: 'TOP 10', value: 10 },
                      { label: 'TOP 20', value: 20 },
                    ]}
                  />
                </Row>
              </Section>

              <Section title="事件定义" desc="定义什么算强势 / 弱势事件">
                <Row label="大涨阈值">
                  <Slider
                    value={rule.riseThreshold}
                    min={0.5}
                    max={10}
                    step={0.5}
                    onChange={(v) => patch({ riseThreshold: v })}
                  />
                </Row>
                <Row label="大跌阈值">
                  <Slider
                    value={rule.fallThreshold}
                    min={0.5}
                    max={10}
                    step={0.5}
                    onChange={(v) => patch({ fallThreshold: v })}
                  />
                </Row>
                <Row label="大涨要求进入涨幅榜">
                  <input
                    type="checkbox"
                    checked={rule.riseRankEnabled}
                    onChange={(e) => patch({ riseRankEnabled: e.target.checked })}
                    style={{ accentColor: COLOR_PRIMARY, width: 16, height: 16 }}
                  />
                </Row>
                <Row label="大跌要求进入跌幅榜">
                  <input
                    type="checkbox"
                    checked={rule.fallRankEnabled}
                    onChange={(e) => patch({ fallRankEnabled: e.target.checked })}
                    style={{ accentColor: COLOR_PRIMARY, width: 16, height: 16 }}
                  />
                </Row>
                <Row label="排名与幅度的组合">
                  <Seg
                    value={rule.eventLogic}
                    onChange={(v) => patch({ eventLogic: v })}
                    options={[
                      { label: '任一满足', value: 'OR' as const },
                      { label: '同时满足', value: 'AND' as const },
                    ]}
                  />
                </Row>
                <div style={{ fontSize: 11, color: '#86909C', lineHeight: 1.6 }}>
                  未勾选的条件不会参与判断。AND 表示必须同时进榜且达到阈值；OR 表示满足任一已启用条件即可。
                </div>
              </Section>

              <Section title="高级统计" desc="用于识别“独立活跃周期”,不影响原始行情记录">
                <Row label="独立事件冷却期">
                  <Seg
                    value={rule.cooldownDays}
                    onChange={(v) => patch({ cooldownDays: v })}
                    options={[
                      { label: '不合并', value: 0 },
                      { label: '1日', value: 1 },
                      { label: '2日', value: 2 },
                      { label: '3日', value: 3 },
                    ]}
                  />
                </Row>
                <Row label="关注间隔下限">
                  <Slider value={rule.gapMin} min={1} max={20} step={1} onChange={(v) => patch({ gapMin: v })} suffix="日" />
                </Row>
                <Row label="关注间隔上限">
                  <Slider value={rule.gapMax} min={1} max={30} step={1} onChange={(v) => patch({ gapMax: v })} suffix="日" />
                </Row>
                <div style={{ fontSize: 11, color: '#86909C', lineHeight: 1.6 }}>
                  冷却期只影响“独立事件”的合并口径，不删除任何原始每日涨跌记录。间隔按交易日序号差计算。
                </div>
              </Section>

              <Section title="当前配置摘要">
                <div
                  style={{
                    background: '#F7F9FC',
                    border: `1px solid ${COLOR_BORDER}`,
                    borderRadius: 8,
                    padding: '10px 12px',
                    fontSize: 12,
                    color: '#4E5969',
                    lineHeight: 1.9,
                  }}
                >
                  统计窗口:近 {rule.windowDays} 个交易日；每日榜单:TOP {rule.topN}；
                  <br />
                  大涨:{riseCond}；大跌:{fallCond}；板块范围:{SCOPE_LABEL[rule.scope]}。
                  <br />
                  关注事件间隔:{rule.gapMin}~{rule.gapMax} 个交易日；独立事件冷却期:{rule.cooldownDays} 个交易日。
                  <br />
                  规则版本:{rule.version}（指纹 {serializeRule(rule).length} 字符）
                </div>
              </Section>
            </div>

            <div
              style={{
                padding: '12px 20px',
                borderTop: `1px solid ${COLOR_BORDER}`,
                display: 'flex',
                gap: 10,
                justifyContent: 'flex-end',
              }}
            >
              <button
                onClick={copy}
                style={{
                  border: `1px solid ${COLOR_BORDER}`,
                  background: '#fff',
                  color: '#4E5969',
                  borderRadius: 8,
                  padding: '7px 14px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {copied ? '已复制 ✓' : '复制当前配置'}
              </button>
              <button
                onClick={() => onChange(DEFAULT_RULE)}
                style={{
                  border: `1px solid ${COLOR_BORDER}`,
                  background: '#fff',
                  color: '#4E5969',
                  borderRadius: 8,
                  padding: '7px 14px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                重置默认
              </button>
              <button
                onClick={() => setOpen(false)}
                style={{
                  border: 'none',
                  background: COLOR_PRIMARY,
                  color: '#fff',
                  borderRadius: 8,
                  padding: '7px 18px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                完成
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** 涨跌幅文字色(红涨绿跌,与站点一致) */
export function pctColor(v: number | null | undefined): string {
  if (v === null || v === undefined) return COLOR_FLAT;
  if (v > 0) return COLOR_UP;
  if (v < 0) return COLOR_DOWN;
  return COLOR_FLAT;
}