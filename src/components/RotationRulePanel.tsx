// 板块轮动:规则摘要栏 + 规则配置抽屉
// 口径一致性:所有轮动页共用 rotationData 里的规则单例;此处只负责"展示 + 修改"
// 视觉:沿用站点既有卡片体系(圆角 14 / CARD_SHADOW / #E5E7EB 边框 / 红涨绿跌)
import { useEffect, useState } from 'react';
import {
  COLOR_BORDER,
  COLOR_DOWN,
  COLOR_FLAT,
  COLOR_PRIMARY,
  COLOR_TEXT,
  COLOR_UP,
} from '../utils/format';
import { SCORE_WEIGHTS } from '../utils/rotation/analytics';
import {
  DEFAULT_RULE,
  serializeRule,
  validateRule,
  type RotationRuleSet,
  type SectorType,
} from '../utils/rotation/types';
import {
  decodePreset,
  loadPresets,
  removePreset,
  savePresets,
  upsertPreset,
  PRESET_LIMIT,
  type RulePreset,
} from '../data/rotationData';

const CARD_SHADOW = '0 1px 3px rgba(0, 0, 0, 0.04), 0 0 30px 5px rgba(0, 0, 0, 0.02)';

// v2.0.8l0:滑块自定义样式 —— 未选中段浅灰 / 已选中段与「完成」按钮同色(主题蓝) / 圆点带白描边
const RANGE_CSS = `
  .tj-range {
    -webkit-appearance: none; appearance: none;
    width: 110px; height: 14px; background: transparent; outline: none; cursor: pointer;
  }
  .tj-range::-webkit-slider-runnable-track {
    height: 4px; border-radius: 2px;
    background: linear-gradient(to right, ${COLOR_PRIMARY} 0 var(--pct), #E5E7EB var(--pct) 100%);
  }
  .tj-range::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 14px; height: 14px; border-radius: 50%; box-sizing: border-box;
    background: ${COLOR_PRIMARY}; border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(24, 144, 255, 0.35);
    margin-top: -5px;
  }
  .tj-range::-moz-range-track { height: 4px; border-radius: 2px; background: #E5E7EB; }
  .tj-range::-moz-range-progress { height: 4px; border-radius: 2px; background: ${COLOR_PRIMARY}; }
  .tj-range::-moz-range-thumb {
    width: 14px; height: 14px; border-radius: 50%; box-sizing: border-box;
    background: ${COLOR_PRIMARY}; border: 2px solid #fff;
  }
`;

// 「统计窗口 / 板块范围 / 每日榜单数量」三个 Seg 统一总宽度(以选项最多的"统计窗口"为基准)
const SEG_WIDTH = 196;

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
  blockWidth,
}: {
  value: T;
  options: { label: string; value: T }[];
  onChange: (v: T) => void;
  /** v2.0.8l0:指定后按钮等分该总宽度 —— 让"选项个数不同"的 Seg 也能保持总宽一致 */
  blockWidth?: number;
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        background: '#F5F6F8',
        borderRadius: 6,
        padding: 2,
        gap: 2,
        flexShrink: 0,
        ...(blockWidth ? { width: blockWidth } : null),
      }}
    >
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
            ...(blockWidth ? { flex: 1, padding: '4px 4px', whiteSpace: 'nowrap' as const } : null),
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
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: COLOR_TEXT, marginBottom: 4 }}>{title}</div>
      {desc && <div style={{ fontSize: 11, color: '#86909C', marginBottom: 12, lineHeight: 1.6 }}>{desc}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, minHeight: 28 }}>
      <span style={{ fontSize: 12, color: '#4E5969' }}>{label}</span>
      {children}
    </div>
  );
}

/** 全宽竖排字段：标签独占一行、控件区整行铺满 —— 避免"标签右对齐 + 控件换行"造成的错位 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, color: '#4E5969' }}>{label}</span>
      {children}
    </div>
  );
}

/** V2.0 阶段 5:配置器内的小按钮(方案保存/应用/重命名/删除用) */
function SmallBtn({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        border: `1px solid ${disabled ? COLOR_BORDER : COLOR_PRIMARY}`,
        background: '#fff',
        color: disabled ? '#C9CDD4' : COLOR_PRIMARY,
        borderRadius: 8,
        padding: '5px 12px',
        fontSize: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
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
  // 已选中比例 → 轨道渐变的断点(未选中段浅灰)
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 176 }}>
      <input
        type="range"
        className="tj-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
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
  // V2.0 阶段 5：简单 / 高级模式（只影响"显示哪些控件"，不改变任何已存参数值）
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple');
  // 规则方案（§7.5）：仅本设备浏览器内
  const [presets, setPresets] = useState<RulePreset[]>(() => loadPresets());
  const [presetSel, setPresetSel] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presetMsg, setPresetMsg] = useState('');
  const patch = (p: Partial<RotationRuleSet>) => onChange({ ...rule, ...p, version: DEFAULT_RULE.version });

  // 抽屉打开时锁住底层页面滚动（防止滚轮"穿透"到底下的页面）；抽屉内部滚动条不受影响
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // §7.6 参数校验：返回可直接展示的中文提示（空数组 = 合法）
  const issues = validateRule(rule);
  const invalid = issues.length > 0;
  const flash = (m: string) => {
    setPresetMsg(m);
    setTimeout(() => setPresetMsg(''), 2000);
  };
  const applyPreset = () => {
    const p = presets.find((x) => x.name === presetSel);
    if (!p) return;
    const r = decodePreset(p);
    if (!r) {
      flash('该方案已损坏，无法应用');
      return;
    }
    // 版本不一致也允许应用，但按当前版本重新盖章 —— 保证"方案升级不丢用户配置"（审计 R5）
    onChange({ ...r, version: DEFAULT_RULE.version });
    flash(p.version === DEFAULT_RULE.version ? '已应用方案' : '已应用（旧版本方案，参数已保留）');
  };
  const saveAsPreset = () => {
    const nm = presetName.trim();
    if (!nm) {
      flash('请先填写方案名称');
      return;
    }
    if (invalid) {
      flash('当前参数有问题，修正后再保存');
      return;
    }
    const next = upsertPreset(presets, nm, rule);
    setPresets(next);
    savePresets(next);
    setPresetSel(nm);
    setPresetName('');
    flash(`已保存为「${nm}」（同名会覆盖）`);
  };
  const renamePreset = () => {
    const nm = presetName.trim();
    const old = presets.find((p) => p.name === presetSel);
    if (!old || !nm) {
      flash('请选择方案并填写新名称');
      return;
    }
    const r = decodePreset(old);
    if (!r) return;
    const next = upsertPreset(removePreset(presets, old.name), nm, r);
    setPresets(next);
    savePresets(next);
    setPresetSel(nm);
    setPresetName('');
    flash(`已重命名为「${nm}」`);
  };
  const deletePreset = () => {
    if (!presetSel) return;
    const next = removePreset(presets, presetSel);
    setPresets(next);
    savePresets(next);
    setPresetSel('');
    flash('已删除该方案');
  };

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
          {/* v2.0.8l0:自定义滑块样式(仅本组件使用,类名限定,不影响其它页面) */}
          <style>{RANGE_CSS}</style>
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
                padding: '18px 20px',
                borderBottom: `1px solid ${COLOR_BORDER}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700, color: COLOR_TEXT }}>轮动规则配置器</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* V2.0 阶段 5:简单 / 高级分层 —— 只影响显示哪些控件,不改动任何已存参数 */}
                <Seg
                  value={mode}
                  onChange={setMode}
                  options={[
                    { label: '简单', value: 'simple' as const },
                    { label: '高级', value: 'advanced' as const },
                  ]}
                />
                <button
                  onClick={() => setOpen(false)}
                  style={{ border: 'none', background: 'transparent', fontSize: 18, color: '#86909C', cursor: 'pointer' }}
                >
                  ×
                </button>
              </div>
            </div>

            <div style={{ padding: '20px', overflowY: 'auto', flex: 1, overscrollBehavior: 'contain' }}>
              {/* §7.6 参数校验提示(可读文案;正常情况下应为空) */}
              {invalid && (
                <div style={{ background: '#FFF2F0', border: '1px solid #FFCCC7', borderRadius: 8, padding: '10px 12px', marginBottom: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#CF1322', marginBottom: 4 }}>当前参数有问题，请先修正：</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {issues.map((it) => (
                      <li key={it.field} style={{ fontSize: 12, color: '#CF1322', lineHeight: 1.8 }}>
                        {it.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* §7.5 规则方案(仅本设备) */}
              <Section title="规则方案" desc="保存在本机浏览器内（不跨设备、不联网）；同名保存会覆盖已有方案">
                <Field label="已保存方案">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <select
                      value={presetSel}
                      onChange={(e) => setPresetSel(e.target.value)}
                      disabled={!presets.length}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        border: `1px solid ${COLOR_BORDER}`,
                        borderRadius: 8,
                        padding: '5px 10px',
                        fontSize: 12,
                        color: COLOR_TEXT,
                        background: '#fff',
                        outline: 'none',
                      }}
                    >
                      <option value="">{presets.length ? '请选择方案…' : '暂无保存的方案'}</option>
                      {presets.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                          {p.version !== DEFAULT_RULE.version ? '（旧版本）' : ''}
                        </option>
                      ))}
                    </select>
                    <SmallBtn onClick={applyPreset} disabled={!presetSel}>
                      应用
                    </SmallBtn>
                    <SmallBtn onClick={deletePreset} disabled={!presetSel}>
                      删除
                    </SmallBtn>
                  </div>
                </Field>
                <Field label="方案名称">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      placeholder="输入名称后保存 / 重命名"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        border: `1px solid ${COLOR_BORDER}`,
                        borderRadius: 8,
                        padding: '5px 10px',
                        fontSize: 12,
                        outline: 'none',
                      }}
                    />
                    <SmallBtn onClick={saveAsPreset} disabled={invalid} title={invalid ? '当前参数有问题，修正后再保存' : '把当前参数保存为新方案（同名覆盖）'}>
                      保存当前
                    </SmallBtn>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <SmallBtn onClick={renamePreset} disabled={!presetSel || !presetName.trim()} title="把所选方案改名（先在上方输入新名称）">
                      重命名所选
                    </SmallBtn>
                  </div>
                </Field>
                <div style={{ fontSize: 11, color: presetMsg ? COLOR_PRIMARY : '#86909C', lineHeight: 1.7, minHeight: 18 }}>
                  {presetMsg || `共 ${presets.length} / ${PRESET_LIMIT} 个方案；「复制」= 用新名称「保存当前」，再删除旧方案。`}
                </div>
              </Section>

              <Section title="基础设置" desc="决定统计范围,先从这里开始">
                <Row label="统计窗口">
                  <Seg
                    value={rule.windowDays}
                    onChange={(v) => patch({ windowDays: v })}
                    blockWidth={SEG_WIDTH}
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
                    blockWidth={SEG_WIDTH}
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
                    blockWidth={SEG_WIDTH}
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
                    style={{ accentColor: COLOR_PRIMARY, width: 18, height: 18, cursor: 'pointer' }}
                  />
                </Row>
                <Row label="大跌要求进入跌幅榜">
                  <input
                    type="checkbox"
                    checked={rule.fallRankEnabled}
                    onChange={(e) => patch({ fallRankEnabled: e.target.checked })}
                    style={{ accentColor: COLOR_PRIMARY, width: 18, height: 18, cursor: 'pointer' }}
                  />
                </Row>
                {mode === 'advanced' && (
                  <>
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
                    <div style={{ fontSize: 11, color: '#86909C', lineHeight: 1.7, marginTop: 2 }}>
                      未勾选的条件不会参与判断。AND 表示必须同时进榜且达到阈值；OR 表示满足任一已启用条件即可。
                    </div>
                  </>
                )}
              </Section>

              {mode === 'advanced' && (
                <>
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
                      <Slider
                        value={rule.gapMin}
                        min={1}
                        max={20}
                        step={1}
                        onChange={(v) => patch({ gapMin: v, gapMax: Math.max(v, rule.gapMax) })}
                        suffix="日"
                      />
                    </Row>
                    <Row label="关注间隔上限">
                      <Slider
                        value={rule.gapMax}
                        min={1}
                        max={30}
                        step={1}
                        onChange={(v) => patch({ gapMax: v, gapMin: Math.min(v, rule.gapMin) })}
                        suffix="日"
                      />
                    </Row>
                    <div style={{ fontSize: 11, color: '#86909C', lineHeight: 1.7, marginTop: 2 }}>
                      冷却期只影响“独立事件”的合并口径，不删除任何原始每日涨跌记录。间隔按交易日序号差计算。
                      上下限会自动保持「下限 ≤ 上限」（拖动其一时另一个会跟随调整）。
                    </div>
                  </Section>

                  <Section title="活跃度评分权重（只读）" desc="当前为实验参数，尚未经回测验证；此处只展示，暂不开放修改">
                    <div style={{ fontSize: 12, color: '#4E5969', lineHeight: 1.9 }}>
                      强势频率 × {(SCORE_WEIGHTS.f1 * 100).toFixed(0)}% ＋ 近期活跃 × {(SCORE_WEIGHTS.f2 * 100).toFixed(0)}% ＋ 独立周期频率 ×{' '}
                      {(SCORE_WEIGHTS.f3 * 100).toFixed(0)}% ＋ 相对市场趋势 × {(SCORE_WEIGHTS.f4 * 100).toFixed(0)}%
                      <div style={{ fontSize: 11, color: '#86909C', marginTop: 4 }}>
                        各分项先归一化到 0~1，按上述权重加总后 × 100 四舍五入，即为「活跃度评分」。
                      </div>
                    </div>
                  </Section>
                </>
              )}

              <Section title="当前配置摘要">
                <div
                  style={{
                    background: '#F7F9FC',
                    border: `1px solid ${COLOR_BORDER}`,
                    borderRadius: 8,
                    padding: '12px 14px',
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
                padding: '14px 20px',
                borderTop: `1px solid ${COLOR_BORDER}`,
                display: 'flex',
                gap: 12,
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