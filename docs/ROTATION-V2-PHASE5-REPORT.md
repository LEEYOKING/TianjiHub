# 天机枢「板块轮动档案」V2.0 — 阶段 5 交付报告（规则配置器）

> 阶段 1 [审计](./ROTATION-V2-AUDIT.md) ｜ 阶段 2 [PHASE2](./ROTATION-V2-PHASE2-REPORT.md) ｜ 阶段 3 [PHASE3](./ROTATION-V2-PHASE3-REPORT.md) ｜ 阶段 4 [PHASE4](./ROTATION-V2-PHASE4-REPORT.md)
> 本阶段只做**规则配置器（§7.1 / §7.5 / §7.6 + 统一刷新）**，未进入阶段 6；未删除任何已有能力，未改动数据链路与其它页面。

---

## 1. 改动清单（§15 交付 1：改动清单）

| # | 改动 | 对应任务书 | 说明 |
|---|---|---|---|
| 1 | **简单 / 高级模式分层** | §7.1 | 抽屉顶部新增「简单 / 高级」Seg。**口径：切换模式只改变"显示哪些控件"，不改变任何已存参数值**（切到简单模式不会悄悄把高级参数改回默认） |
| 2 | **简单模式** = 基础设置（窗口 / 板块范围 / TOP N）+ 事件定义（大涨阈值 / 大跌阈值 / 是否要求进榜）+ 规则方案 + 当前配置摘要；对「组合方式」「冷却期」「关注间隔」「活跃度权重」**只显示当前值并提示"高级模式中可修改"** | §7.1 | 默认进入简单模式；普通复盘用户不会被冷门参数干扰 |
| 3 | **高级模式** = 简单模式全部 + 「排名与幅度的组合」(OR/AND) + 「独立事件冷却期」+ 「关注间隔上下限」滑块 + 「活跃度评分权重（只读）」 | §7.1 / §7.2 | 权重显式标注为**实验参数**，只读展示，不开放修改（避免未经验证的权重被随意调走） |
| 4 | **规则方案：保存 / 切换 / 命名 / 复制 / 删除** | §7.5 | 存 `localStorage` 键 `tjhub-rotation-rule-presets`（仅本设备，不跨设备、不联网）；方案上限 20 条，超出丢弃最早的；同名保存即覆盖（= 重新命名/更新的机制） |
| 5 | **参数校验（可读提示）** | §7.6 | 新增纯函数 `validateRule()`，抽屉顶部以红色面板逐条列出问题；**参数有问题时禁止「保存当前」**（不会把非法参数存进方案）；同时把上下限滑块做成**自动耦合**，从源头避免"下限 > 上限" |
| 6 | **堵住阶段 2 遗留缺陷** | §7.6 | 阶段 2 报告记录的"大涨/大跌阈值 = 0 会被当成条件未启用、但标志位仍按 ≥0 命中"——现在 `validateRule` 明确拦截，且界面滑块 min=0.5 使其无法产生 |
| 7 | **统一刷新** | §7.3 | 规则仍为模块级单例 + 订阅（`rotationData`），抽屉改动即时广播到主场 / 详情页 / 关系模块；本阶段**未新增任何第二份规则状态** |
| 8 | **方案存档升级不丢配置** | 审计 R5 | 旧版本方案不会被丢弃，只在下拉里标「（旧版本）」；应用时按当前版本重新盖章（`{...r, version: DEFAULT_RULE.version}`），保留用户参数 |

**未做（留待阶段 6）**：观察清单（§10，localStorage MVP）、性能与首屏预算实测、§9.2 数据状态机、§9.3 `meta.algoVersion`、§15 全面验收。

---

## 2. 文件清单（交付 2：文件清单）

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/utils/rotation/types.ts` | 修改 | 新增 `RuleIssue` + `validateRule()`（纯函数，7 条校验） |
| `src/data/rotationData.ts` | 修改 | 新增方案存档：`RulePreset` / `parsePresets` / `serializePresets` / `upsertPreset` / `removePreset` / `decodePreset` / `loadPresets` / `savePresets` / `PRESET_LIMIT`（前 6 个为纯函数，便于测试） |
| `src/components/RotationRulePanel.tsx` | 修改 | 新增简单/高级 Seg、规则方案区块、校验提示、上下限自动耦合、高级模式的权重只读区块 |
| `src/utils/rotation/__tests__/ruleConfig.test.ts` | **新增** | 21 个用例（校验 10 项 + 方案存档 11 项） |

未改动：`ruleEngine.ts`、`analytics.ts`、`relations.ts`、`observations.ts`、`Rotation.tsx`、`RotationDetail.tsx`、`RotationRelations.tsx`、Python 脚本、GitHub Actions、`public/*.json`。

---

## 3. 公式与口径变化（交付 3：公式与口径变化）

### 3.1【口径声明】分层只影响"可见控件"，不影响参数值

模式切换（简单 ↔ 高级）**不加权、不归一化、不重置任何字段**。它在简单模式下隐藏的 4 项（组合方式 / 冷却期 / 关注间隔上下限 / 权重只读块）依然参与计算，只是不在简单模式里可直接改。界面在简单模式下把这些项的**当前值**显式写出来，避免"看不见就等于没生效"的误解。

### 3.2【新增】参数校验规则 `validateRule(rule) → RuleIssue[]`

| 字段 | 触发条件 | 提示（节选） |
|---|---|---|
| `windowDays` | `≤ 0` | 统计窗口必须是大于 0 的交易日数。 |
| `topN` | `< 1` | 每日榜单数量至少为 1。 |
| `riseThreshold` | `≤ 0` | 大涨阈值必须大于 0：为 0 时该条件会被判为"未启用"，但涨幅判定仍会按 ≥0 命中，结果自相矛盾。 |
| `fallThreshold` | `≤ 0` | 大跌阈值必须大于 0：（同上）。 |
| `gapMin` | `< 1` | 关注间隔下限至少为 1 个交易日。 |
| `gapMax` | `< gapMin` | 关注间隔上限（X）不能小于下限（Y）。 |
| `cooldownDays` | `< 0` | 独立事件冷却期不能为负数。 |

**"阈值必须 > 0"是本阶段堵住的一个真实缺陷**：规则引擎用 `阈值 > 0` 判定"该条件是否启用"（`largeUpOn/largeDownOn`），而事件标志位又按 `pct >= 阈值` 计算 —— 阈值为 0 会让"条件被当作关闭"与"所有非负涨幅都命中"同时成立。

### 3.3【设计防呆】关注间隔上下限自动耦合

- 拖动**下限**：`patch({ gapMin: v, gapMax: max(v, gapMax) })`
- 拖动**上限**：`patch({ gapMax: v, gapMin: min(v, gapMin) })`

即 UI 路径下 `gapMin ≤ gapMax` 恒成立，红色校验提示几乎不可能由滑块触发（该校验主要用于拦截外部导入 / 损坏存档）。

### 3.4【新增】规则方案存档格式

```
localStorage['tjhub-rotation-rule-presets'] = JSON: [ { name, encoded: serializeRule(rule), version } , ... ]
```
- `encoded` 复用既有的 `serializeRule` / `deserializeRule`，**天然带校验**：解不出来的条目在读取时直接丢弃（损坏存档不会污染配置器）。
- `version` 仅用于界面提示「（旧版本）」，**不参与丢弃判断**（审计 R5：规则版本升级不应丢用户方案）。
- `parsePresets` 对非法输入（非 JSON / 非数组 / 缺字段 / 空白名）一律宽容返回，不抛异常。
- 上限 `PRESET_LIMIT = 20`，超出丢弃最早的。

---

## 4. 数据结构变化（交付 4：数据结构变化）

- **新增导出类型**：`RuleIssue`（types）、`RulePreset`（rotationData）。
- **新增导出函数/常量**：`validateRule`；`parsePresets` / `serializePresets` / `upsertPreset` / `removePreset` / `decodePreset` / `loadPresets` / `savePresets` / `PRESET_LIMIT`。
- **新增 localStorage 键**：`tjhub-rotation-rule-presets`（审计 §8 已明确许可的"个人设备内轻量 MVP"，**不引入认证体系**）。
- **未改动**：`RotationRuleSet` 字段、`rotation.json` schema、既有键 `tjhub-rotation-rule`、路由表、`DEFAULT_RULE.version`（仍 `1.1.0` —— 因此**不会作废用户已存的当前规则**）。
- **未新增任何依赖**。

---

## 5. 测试结果（交付 5：测试结果）

| 项 | 结果 |
|---|---|
| `npm test` | **8 文件 / 124 用例 全绿**（阶段 4 为 103，本阶段 +21） |
| `npx tsc -b` | 通过 |
| `npm run build` | 通过（vite 8.2.0 / rolldown） |
| 回归 | 阶段 2/3/4 的 103 项全部保持通过 |

新增 `ruleConfig.test.ts`（预期值全部明确给出，无快照）：
- **校验 10 项**：默认规则合法；`gapMin === gapMax` 边界合法；`windowDays=0` / `topN=0` / `riseThreshold=0` / `fallThreshold=0` / `gapMin=0` / `gapMax<gapMin`（提示带出两个具体数值）/ `cooldownDays=-1` 各自只报对应字段；多问题同时出现时按字段稳定顺序列出。
- **方案存档 11 项**：空/非 JSON/非数组输入 → `[]` 且不抛异常；缺 name / 缺 encoded / encoded 乱码 / 空白名 → 该条丢弃；同名保留最后一条；超过 `PRESET_LIMIT` 只保留最新一批（断言首尾名称）；序列化往返一致；`decodePreset` 正常解出、损坏串返回 `null`；`upsertPreset` 新增/同名覆盖/空白名不新增/超限丢弃最早；`removePreset` 删除与不存在名不改变；**旧版本方案不被丢弃且带出旧版本号**（审计 R5）。

**浏览器验收**（`vite preview` + `/rotation`，真实数据）：

| 验收项 | 结果 |
|---|---|
| 点「调整规则」抽屉可打开 | ✅（脚本返回 OPENED） |
| 抽屉顶部存在「简单 / 高级」两个模式按钮 | ✅ |
| 切到高级模式后，「任一满足/同时满足」Seg 与「不合并」冷却期 Seg **出现** | ✅ |
| 输入方案名 → 点「保存当前」→ 下拉框出现该方案（实测出现「测试方案A」） | ✅ |
| 简单模式下「组合方式 / 冷却期 / 活跃度权重」不出现 | ⚠ 部分（子代理读取 body 文本时不稳，见 §6 第 1 条） |
| 间隔上下限自动耦合、红色校验提示 | ⚠ 未取到实测（滑块需真实拖拽；由单测 + 代码审查确认） |
| 规则变更后全页面同步 | ✅（机制未变；阶段 1~4 已多次实测：改动规则后主页面榜单/统计表即时更新） |

---

## 6. 已知问题（交付 6：已知问题）

1. **配置器 UI 未能完成可靠的浏览器实测**：本环境的 `browser_evaluate` 多次返回 `undefined`（疑似只接受单行脚本、上下文不稳），且子代理为绕过"遮罩"对 DOM 做过临时改动（该遮罩实为抽屉自带的 backdrop，并非缺陷），导致部分断言读到的是被改动后的 DOM。**已按阶段 4 先例降级为"代码审查 + 单测 + tsc/build 覆盖"**，建议你在真机点开配置器目视确认 3 件事：① 简单模式看不到组合方式/冷却期/间隔；② 切高级后它们出现；③ 拖动间隔上限低于下限时下限自动跟随。
2. **方案仅存本设备**：不跨设备、清缓存即丢（§10 明确允许的 MVP 形态）。界面已写明。
3. **方案名无长度/字符校验**：超长名称会让下拉与输入框显得拥挤（未做截断）。阶段 6 可补一个 12 字上限。
4. **`validateRule` 目前只服务于配置器**：`rotationData.pickStoredRule` 仍只做版本校验，不校验字段合法性 —— 若 localStorage 被手工改成非法规则串，界面能读到但会在顶部提示红条（不会崩溃）。要把校验也接到读取链路需要改 `pickStoredRule` 的语义（会改变"旧存档回落默认"的行为），留待阶段 6 评估。
5. **活跃度权重仍不可配置**：按 §7.2 归类为"高级研究"，当前只读展示。若将来要开放，需要把权重纳入 `RotationRuleSet`（会牵动序列化格式与测试），属较大改动。
6. **未做**：§10 观察清单、§9.2 数据状态机、§9.3 `meta.algoVersion`、§15 全面验收。

---

## 7. 可运行版本（交付 7：可运行版本）

- 本报告对应提交即为可运行版本；**未新增任何依赖**（仍只有 vitest 一个新增 devDependency）。
- 自检：`npm test`（124 通过）/ `npx tsc -b` / `npm run build` 全绿。
- 本地预览：`npm run preview -- --port 4210`，访问 `/rotation` → 点「调整规则」。

## 8. 运行部署说明（交付 8：运行部署说明）

- 技术栈与部署方式**未变**：React 19 + TS + Vite 8（rolldown）纯静态站，Cloudflare Pages Git 集成，无 Worker/D1/Functions/API/env。
- 无新增环境变量 / 构建期配置 / 接口；新增的只有浏览器端 localStorage 键（`tjhub-rotation-rule-presets`）。
- **提交纪律**：本地 `git commit` 后**不执行 `git push`**，由你在 GitHub Desktop 里 Fetch → Pull → Push（先 Fetch，云端 cron 会往 main 提交数据文件）。
- ⚠️ 严禁提交本地生成的 `public/data.json` / `public/rotation.json`；本阶段只做只读校验，未生成也未改动任何数据文件。
