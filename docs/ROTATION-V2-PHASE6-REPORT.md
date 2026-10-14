# 天机枢「板块轮动档案」V2.0 — 阶段 6 交付报告（观察清单 + 性能 + 全面验收）

> 阶段 1 [审计](./ROTATION-V2-AUDIT.md) ｜ 阶段 2 [PHASE2](./ROTATION-V2-PHASE2-REPORT.md) ｜ 阶段 3 [PHASE3](./ROTATION-V2-PHASE3-REPORT.md) ｜ 阶段 4 [PHASE4](./ROTATION-V2-PHASE4-REPORT.md) ｜ 阶段 5 [PHASE5](./ROTATION-V2-PHASE5-REPORT.md)
> 本阶段完成**观察清单（§10）**、**性能实测（§11.4 / 审计 R8）**与**全面验收（§14 24 项 + §15）**，是 V2.0 的收尾阶段。

---

## 1. 改动清单（§15 交付 1：改动清单）

| # | 改动 | 对应任务书 | 说明 |
|---|---|---|---|
| 1 | **观察清单（localStorage MVP）** | §10 | 新增 `src/data/watchlist.ts`：只存**板块 id + 加入时点**，不存统计快照；模块级单例 + 订阅（与规则存储同构），主页与详情页看到同一份清单 |
| 2 | 观察清单卡片（主页） | §10 | 位于「近期轮动观察」之下；空状态给出明确引导；有数据时展示 板块 / 加入于 / 观察区间 / 强势 / 弱势 / 区间累计收益 / 相对基准超额 / 最近事件 / 移除 |
| 3 | 「自加入以来」区间统计 | §10 | 新增 `analytics.sinceStatsOf()`，从**加入时的数据最新交易日**算到窗口末（不是本机日期，避免节假日错位）；早于窗口起点时截断到窗口起点并给出提示 |
| 4 | 收藏入口 3 处 | §10 | 观察卡 ☆、行为统计表每行 ☆、详情页页头「☆ 加入观察」；均 `stopPropagation`，不误触跳转 |
| 5 | **"仅本设备"标注** | 审计 R6 | 卡片右上角「仅本设备（浏览器本地）· 共 N / 50」+ 空状态文案 + 气泡词条 `仅本设备` 三处明示 |
| 6 | **口径复用，不新增第二套实现** | §8.8 / §9.4 | 区间统计走 `toWindowView`；相对基准把**既有** `relativeToBench` 加一个可选 `fromWi` 参数复用（默认 0 → 旧调用与测试不受影响），**没有第二次实现** |
| 7 | **性能实测** | §11.4 / 审计 R8 | 用真实数据（663 板块 × 120 日）实测各纯函数耗时，并记录数据体积与构建产物（见 §5） |
| 8 | **全面验收** | §14 / §15 | §14 24 项逐项给出证据（见 §9）；§15 8 项交付 + 三阶段验收条件自检（见 §10） |

**未做（明确不以本轮范围处理）**：§9.2 完整数据状态机、§9.3 `meta.algoVersion`、观察清单的云同步（§10 明确只许可本地 MVP）。

---

## 2. 文件清单（交付 2：文件清单）

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/data/watchlist.ts` | **新增** | 观察清单：`WatchItem` / `parseWatchlist` / `serializeWatchlist` / `addWatch` / `removeWatch` / `inWatchlist` / `toggleWatch` / `getWatchlist` / `setWatchlist` / `useWatchlist` / `WATCH_LIMIT` |
| `src/utils/rotation/analytics.ts` | 修改 | 新增 `SinceStats` + `sinceStatsOf()`；`relativeToBench` 增加可选 `fromWi`（默认 0） |
| `src/pages/Rotation.tsx` | 修改 | 观察清单卡片 + 观察卡 ☆ + 统计表行 ☆ + `watchRows` |
| `src/pages/RotationDetail.tsx` | 修改 | 页头「☆ 加入观察」 |
| `src/components/InfoTip.tsx` | 修改 | GLOSSARY 新增 5 条：观察清单 / 仅本设备 / 加入以来区间 / 加入于 / 观察起点 |
| `src/utils/rotation/__tests__/watchlist.test.ts` | **新增** | 13 个用例（存档健壮性 5 + 增删 4 + 区间统计 4） |

未改动：`ruleEngine.ts`、`relations.ts`、`observations.ts`、`RotationRulePanel.tsx`、`rotationData.ts`（除阶段 5 内容）、Python 脚本、GitHub Actions、`public/*.json`。

---

## 3. 公式与口径变化（交付 3：公式与口径变化）

### 3.1【新增】「自加入以来」区间统计 `sinceStatsOf`

```
fromWi   = 加入时的数据最新交易日 在**当前窗口**中的列号（早于窗口起点 / 不在日期表 → 0，并置 truncated）
区间复合收益 = ∏(1 + pct/100) − 1        只累乘区间内该板块有效日
区间强势/弱势次数 = 区间内 view.eventAt[i].strong / .weak 为真的列数
区间相对基准超额 = relativeToBench(data, comp, series, fromWi).simple   ← 复用既有唯一实现
```
- **缺失日**：不计入分母、也不当作 0 涨跌幅（与全窗口口径一致）。
- **"加入于"只是本机日期**，不参与任何计算；计算一律用"加入时的数据最新交易日"，避免节假日错位。
- 与全窗口统计**同源**：从窗口首日起算时，`sinceStatsOf` 的 `cumReturn / strongCount / weakCount / rel` 与 `analyzeSector` 的对应值**完全相等**（有单测断言）。

### 3.2【口径变化】`relativeToBench` 增加可选起点

新增第 4 个可选参数 `fromWi = 0`。**默认值保持 0 → 既有调用点、既有 14 项 `returns.test.ts` 断言全部不受影响**（回归全绿）。这是"区间相对基准"与"全窗口相对基准"共用同一实现的唯一途径，避免出现第二套相对基准算法。

### 3.3【口径声明】观察清单存什么、不存什么

清单只存 `{ id, name, addedAt, basisDate }`：
- **不存**"加入当时的强势次数/收益快照" → 因此清单不会随着规则变化而失真（改用新规则后，区间统计会整套重算）。
- 若某板块不在当前规则的「板块范围」内，卡片明确显示"暂无法计算表现"，而不是显示 0 或旧值。

---

## 4. 数据结构变化（交付 4：数据结构变化）

- **新增导出类型**：`WatchItem`（watchlist）、`SinceStats`（analytics）。
- **新增导出函数/常量**：`sinceStatsOf`；`parseWatchlist` / `serializeWatchlist` / `addWatch` / `removeWatch` / `inWatchlist` / `toggleWatch` / `getWatchlist` / `setWatchlist` / `useWatchlist` / `WATCH_LIMIT`。
- **新增 localStorage 键**：`tjhub-rotation-watchlist`（审计 §8 已许可，不引入认证体系）；上限 50 条。
- **未改动**：`RotationRuleSet` 字段、`rotation.json` schema、既有两个键（`tjhub-rotation-rule` / `tjhub-rotation-rule-presets`）、路由表、`DEFAULT_RULE.version`（仍 `1.1.0`）。
- **未新增任何依赖**。

---

## 5. 测试结果（交付 5：测试结果）

### 5.1 单元测试

| 项 | 结果 |
|---|---|
| `npm test` | **9 文件 / 137 用例 全绿**（阶段 5 为 124，本阶段 +13） |
| `npx tsc -b` | 通过 |
| `npm run build` | 通过（rolldown，≈450ms） |
| 回归 | 阶段 2~5 的 124 项全部保持通过（含 `relativeToBench` 加参数后的 14 项收益断言） |

新增 `watchlist.test.ts`：存档健壮性（空/非 JSON/非数组/缺字段/空白名/重复 id 取最后一条/超上限丢弃最早/序列化往返一致）；增删（重复加入不产生两条、缺 id 或 name 不生效、超上限、按 id 删除、不存在 id 无副作用）；区间统计（**手算**：从 d5 起算有效 6 天、复合 `1.02×1.05×0.99×1.03×1.005×0.96−1`、强势 3 次 / 弱势 2 次；从窗口首日起算与全窗口**完全相等**；基准日早于窗口起点 → `truncated=true` 且 `fromDate` 落到窗口首日；区间无有效日 → `cumReturn=null` 不伪造 0）。

### 5.2 性能实测（§14 第 23 项上下游 / 审计 R8）

真实数据：663 板块 × 120 日（页面默认窗口 60 日，参与计算 series = 663）。Node 环境单线程实测（`performance.now()`，多次取均值）：

| 环节 | 耗时 | 触发时机 |
|---|---|---|
| JSON 归一化 `normalize` | 0.12 ms | 首次进入轮动页（在 fetch 之后） |
| `computeWindow` | **11.19 ms** | 数据或规则变化时 |
| `analyzeAll` | **6.97 ms** | 同上 |
| `buildObservations` | 0.25 ms | 同上 |
| `computeSyncPairs`（全市场两两共现） | 20.18 ms | **仅在展开「高级研究」时** |
| `computeRegimeStats` | 0.62 ms | 同上 |
| `computeSectorPeers`（详情页，单板块） | 0.42 ms | 进入详情页 |
| `computeLeadLag`（详情页，单 leader） | 1.04 ms | 进入详情页 |
| `sinceStatsOf`（观察清单，单条） | 0.003 ms | 每次渲染（≤50 条约 0.15 ms） |
| `validateRule` / `serializeRule` | 0.002 ms | 配置器交互时 |

**结论**：主页纯计算 **≈ 18.4 ms**（`computeWindow + analyzeAll + buildObservations`），详情页 **≈ 19.6 ms**，观察清单 50 条 **≈ 0.15 ms** —— 全部远低于"首屏 3 秒内可读"的要求。真正的瓶颈是**数据下载**：`public/rotation.json` 原始 1.00 MB / **gzip 404 KB**（浏览器端 `JSON.parse` 不计在 JS 侧）。

构建产物（gzip）：轮动相关 `Rotation` 15.30 KB + `RotationDetail` 9.71 KB + 共享块 17.79 KB；antd 269 KB、echarts 377 KB 为**既有**依赖，本阶段未新增。

### 5.3 浏览器验收（`vite preview`，真实数据）

| 验收项 | 结果 |
|---|---|
| 观察清单卡片渲染；空状态文案含「还没有观察中的板块」与「仅本设备」 | ✅（实测卡片右上角计数「共 N / 50」） |
| 点观察卡 ☆ 加入 → 计数 +1（实测 24 → 25） | ✅ |
| 表头与设计一致：板块 / 加入于 / 观察区间 / 强势 / 弱势 / 区间累计收益 / 相对基准超额 / 最近事件 / 操作 | ✅ |
| **刷新后清单保留**（§14 第 21 项）：重载 `?v=9` 后计数与数据行不变 | ✅ |
| 详情页页头「☆ 加入观察」按钮 | ✅（代码路径与主页同一 `toggleWatch`） |
| 窄屏无页面级横向溢出 | ⚠ 未取到本轮实测（见 §6 第 1 条）；沿用阶段 3/4 结论：观察清单独表用 `min-width:900 + 外层 overflowX:auto`，与既有大表格同一模式 |

---

## 6. 已知问题（交付 6：已知问题）

1. **本环境 `browser_evaluate` 不可用**（单行脚本也大量返回 `undefined`）：阶段 5/6 的验收改用 `browser_snapshot + browser_click`（不用 evaluate）后**已成功验证观察清单的加入与跨刷新保留**。剩下的"窄屏测量"与"配置器红条提示"仍未能在浏览器实测，已由单测 + 代码审查覆盖，**建议真机各目视一次**。
2. **测试残留**：本轮浏览器测试在你的本机浏览器里留下了 25 条观察清单记录（`tjhub-rotation-watchlist`）。不影响功能，可在页面「我的观察清单」里逐条点「移除」清空。
3. **观察清单不跨设备**：清缓存 / 换设备即丢（§10 明确许可），卡片与气泡均已标注。
4. **清单与"板块范围"的耦合**：若把规则范围改成"仅行业"，清单里的概念板块会显示"暂无法计算表现"而不是被静默隐藏（**有意如此**，避免用户以为清单丢了）。
5. **区间起点依赖数据窗口**：加入超过 120 个交易日后，区间会被截断到窗口起点（界面有橙色提示），因此"自加入以来"的长期跟踪能力受数据窗口长度限制。
6. **`computeSyncPairs` 仍是全市场两两共现**（20 ms）：只在展开高级研究时触发，暂不需要优化；若将来把它放到首屏，需要改成增量/分片。
7. **未做**：§9.2 完整数据状态机（正常/缺失/延迟/更新中/数据源异常的统一状态）、§9.3 `meta.algoVersion`（需要 Python 脚本配合，属数据侧改动）。

---

## 7. 可运行版本（交付 7：可运行版本）

- 本报告对应提交即为 V2.0 最终版；**未新增任何依赖**（全程只新增 vitest 一个 devDependency）。
- 自检：`npm test`（137 通过）/ `npx tsc -b` / `npm run build` 全绿。
- 本地预览：`npm run preview -- --port 4220`，访问 `/rotation`、`/rotation/sector/BK0425`。

## 8. 运行部署说明（交付 8：运行部署说明）

- 技术栈与部署方式**自始至终未变**：React 19 + TS + Vite 8（rolldown）纯静态站，Cloudflare Pages Git 集成构建，**无 Worker / D1 / Functions / 服务端 API / 环境变量**。
- 数据链路未动：GitHub Actions 盘后（15:35 / 18:35 / 次晨 08:30）生成 `public/rotation.json`，前端按需 fetch。
- 浏览器端本地存储共 3 个键：`tjhub-rotation-rule`（当前规则）、`tjhub-rotation-rule-presets`（规则方案）、`tjhub-rotation-watchlist`（观察清单）。
- **提交纪律**：本地 `git commit` 后**不执行 `git push`**，由你在 GitHub Desktop 里 Fetch → Pull → Push（先 Fetch，云端 cron 会往 main 提交数据文件）。
- ⚠️ 严禁提交本地生成的 `public/data.json` / `public/rotation.json`；本阶段只做只读校验，未生成也未改动任何数据文件。

---

## 9. §14 24 项验收对照表

| # | 项目 | 证据 |
|---|---|---|
| 1~3 | 事件判定 / 组合逻辑 / 独立于排行榜的大涨大跌 | `events.test.ts` 13 项（阶段 2） |
| 4 | 间隔统计（avg/median/std/集中度） | `gaps-clusters.test.ts` 16 项 |
| 5~7 | 缺失日处理 / 无事件边界 / 连续事件 | `events.test.ts` + `alignment.test.ts` |
| 8 | 独立事件簇（冷却期合并） | `gaps-clusters.test.ts`（冷却 0/1/2/3 → 簇数 4/3/2/1） |
| 9 | 窗口切换后结果一致 | `consistency.test.ts`（窗口 10→6 全指标同步变化） |
| 10~11 | 序列压缩 vs 窗口对齐 / 缺失日不参与 | `alignment.test.ts`（P0-1 回归：`events.length=4 ≠ dates.length=6`） |
| 12 | 复合累计收益 | `returns.test.ts`（手算 7.355829588493%） |
| 13 | 数据源重复记录去重 | `consistency.test.ts`（重复 id 只留第一条） |
| 14 | 数据补回后统计重算 | `returns.test.ts`（补齐 d3 → 强势 3→4、收益更新） |
| 15 | 摘要 = 时间轴 = 明细 事件数一致 | `alignment.test.ts`（夹具 A 与 B 双场景）+ 详情页页面级自检文案 |
| 16 | 最大回撤（与曲线同源） | `returns.test.ts`（`maxDrawdownOf` 手算 + `buildNavSeries` 同源断言） |
| 17 | 相对基准两种口径 | `returns.test.ts`（简单超额 6.3634549% vs 相对净值 6.3009261%） |
| 18 | 规则序列化 / 旧版本存档回落 | `consistency.test.ts` + `ruleConfig.test.ts` |
| 19 | 热力图点击出判定依据 | 阶段 2/3 浏览器实测（点击格子 → 涨跌幅/排名/命中条件/最终事件） |
| 20 | **观察清单** | 本阶段：`watchlist.test.ts` 13 项 + 浏览器实测（☆ 加入 → 计数 +1、表格渲染） |
| 21 | **刷新后状态保留** | 本阶段：浏览器实测（重载后清单计数与数据行不变）+ 序列化往返一致单测 |
| 22 | **窄屏布局** | 阶段 3 实测小卡片网格降为 2 列（`gridTemplateColumns="155px 155px"`）；本阶段新增表格沿用 `overflowX:auto` 容器（本轮未重测，见 §6 第 1 条） |
| 23 | **生产构建通过** | `npm run build` 通过（rolldown，≈450ms） |
| 24 | **既有路由未被破坏** | 14 条路由未改动；构建产物仍逐页分包（`Sector` / `DragonTiger` / `LimitUp` … 均在产物中） |

> 说明：任务书 §14 的完整编号列表在本次对话上下文中被截断，上表编号依据审计报告与阶段 2 报告的交叉引用复原（阶段 2 报告明确列出 "§14 的 1~18 项全部由 64 个用例覆盖；第 19 项热力图点击已实测；第 23/24 项生产构建与既有路由已验证；第 20/21/22 项留待阶段 6"）。若与任务书原文编号有出入，请以任务书为准，我会据此修正。

---

## 10. §15 阶段性验收自检

| 阶段 | 验收条件（审计 §9 表） | 自检结果 |
|---|---|---|
| 阶段 3 | 首屏 3 秒内可读；观察卡均可溯源；筛选口径一致 | ✅ 纯计算 18.4 ms + gzip 404 KB；观察卡触发依据全部由统计量生成；筛选全局统一并写入界面 |
| 阶段 4 | 摘要事件数 = 时间轴事件数 = 明细事件数；曲线与摘要同源 | ✅ 页面级自检文案「时间轴事件数：强势 N · 弱势 M ✓ 与摘要一致」+ `alignment.test.ts` 双场景断言 + `buildNavSeries` 同源断言 |
| 阶段 5 | §14 第 18 项通过；参数非法有可读提示；规则变更后全页面同步 | ✅ `ruleConfig.test.ts` 21 项；红条可读提示 + 自动耦合；模块单例订阅全页同步 |
| 阶段 6 | §14 全 24 项 + §15 验收标准全绿 | ✅ 见 §9（22 项充分验证，第 22 项沿用阶段 3 实测 + 同模式推理） |
