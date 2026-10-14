# 天机枢「板块轮动档案」V2.0 — 阶段 2 交付报告（统计口径统一 + 测试）

> 阶段 1 审计报告见 [ROTATION-V2-AUDIT.md](./ROTATION-V2-AUDIT.md)。
> 本阶段**只做口径统一、缺陷修复与测试**，未进入阶段 3 的主页 UI 重构，未删除任何功能。

---

## 1. 前置：Vitest 兼容性检查结论

| 检查项 | 现状 | 与 Vitest 的兼容性 |
|---|---|---|
| 构建工具 | Vite **8.2.0**（已安装实体，非别名） | ✅ Vitest 5 的 peer `vite` 要求为 `^6.4.0 \|\| ^7.0.0 \|\| ^8.0.0` |
| 模块系统 | `"type": "module"`（纯 ESM） | ✅ |
| Node | v26.5.0（`engines: >=20`） | ✅ Vitest 5 要求 `@types/node >=24`（已装 ^24.13.3） |
| 包管理器 | npm 11.17.0 + `package-lock.json` | ✅ |
| 现有测试配置 | 无 | — |
| tsconfig | 三份项目引用（app/node），`tsc -b` 参与 build | 测试放在 `src/` 内即被 `tsc -b` 一并类型检查 |

**安装结果（严格遵守"唯一新增 devDependency"）**

```
package.json: +"vitest": "^5.0.4"        ← 仅此一项
npm ls vite → vite@8.2.0 deduped         ← 未升级、未重复安装
jsdom / happy-dom / @vitest/ui / coverage 等 peer 均为 optional → 未被装入
package-lock.json                          ← 仅锁文件变化
```

新增脚本（不影响 dev / build / lint / preview）：

```json
"test": "vitest run",
"test:watch": "vitest"
```

未创建 `vitest.config.*`：直接复用 `vite.config.ts` 默认配置，测试全部为纯函数测试（node 环境，不需要 DOM）。

---

## 2. 口径统一：旧口径 → 新口径（含修改原因与影响范围）

### 2.1 变更 A：位置型可视化的取值口径（修复 P0-1 索引错位）

| | 旧口径 | 新口径 |
|---|---|---|
| 主页热力网格 | `seriesByRow[r].events[c]`（c = 窗口列号） | `viewByRow[r].eventAt[c]` |
| 详情页事件时间轴 | `series.events[i]` / `series.pctInWindow[i]`（i = 窗口日号） | `view.eventAt[i]` / `view.pctAt[i]` |
| 悬浮/点击取值 | `series.pctInWindow[hover.c]` / `rankUpOn[hover.c]` | `view.pctAt[hover.c]` / `view.rankUpAt[hover.c]` |

`series.events/pctInWindow/rankUpOn` 的长度 = **该板块有数据的交易日数**（`series.days`），
而窗口交易日数是 `comp.dates.length`。覆盖率 = 100% 时两者巧合相等，此前按下标直取在覆盖率 < 100% 时整体错位。

**修改原因**：违反任务书 §6.3（时间轴与明细必须可互相验证、事件数必须一致）、§6.4、§9.4（各模块不得各用一套口径）。
**实现**：新增 `ruleEngine.toWindowView(comp, series)`，把压缩序列还原为**与窗口日一一对齐**的等长数组（缺失日 = `null`），复杂度 O(有效日数)。
**影响范围**：实测 663 个板块中 **26 个（3.9%）覆盖率 < 100%**（最低 `BK1755` 120 天里只有 2 天有数据）。**其余 637 个板块显示完全不变**。

### 2.2 变更 B：详情页收益曲线与最大回撤同源（修复 P0-2）

| | 旧口径 | 新口径 |
|---|---|---|
| 板块净值 | 组件内就地累乘，缺失日 `p == null ? 1 : 1 + p/100`（当作 0 收益） | `analytics.buildNavSeries()`，缺失日**沿用前值**（等价于跳过），并标记 `sectorValid[]` |
| 最大回撤 | `analyzeSector` 内联峰值循环 | 单一实现 `maxDrawdownOf(nav)`，**曲线与摘要共用同一条净值序列** |
| 基准线 | 无条件绘制 | 基准窗口内完全无数据时 `benchAvailable=false` → **隐藏基准线，不伪造**（§6.4） |

**修改原因**：同一页面并列展示的「累计收益/最大回撤」与「净值曲线」曾用两套算法，对缺失日的处理不同，数值必然不等（违反 §8.7）。
**影响范围**：同样只影响 26 个覆盖率 < 100% 的板块；覆盖率 100% 时新旧数值完全一致（无 null → 两种处理等价）。

### 2.3 变更 C：相对基准口径单一实现 + 两种口径明确命名（§8.8）

- 抽出 `relativeToBench(data, comp, series)`，只取**两者都有行情的共同有效日**分别复合：
  - `simple` = 板块累计收益 − 基准累计收益 → 即现有 UI 的「相对基准超额」（**简单超额收益**口径）
  - `netValue` = 板块净值 / 基准净值 − 1（**相对净值收益**口径，供阶段 4 UI 使用）
- `analyzeSector.relStrength` 改为调用同一函数，**数值完全不变**（等价重构，仅消除重复实现）。

### 2.4 变更 D：补「空档交易日数」（§8.3 明确要求两个指标分别命名）

`GapStats` 新增（旧字段一律保留、语义不变）：

```
gaps[]      gap_i    = d_(i+1) − d_i     （相邻事件日的交易日序号差）
empties[]   empty_i  = gap_i − 1          （两者之间"没有事件"的交易日数）
avgEmpty    = avg − 1
```

### 2.5 变更 E：数据源重复记录去重（§14 第 13 项）

`rotationData.normalize()` 现在按 `id` 去重（保留第一条）并过滤非法行；同时导出为纯函数以便测试。
**影响范围**：仅当数据源出现重复板块 id 时才有差异（此前会被统计两次）；当前线上数据无重复，显示不变。

### 2.6 变更 F：规则存档读取抽出为纯函数

`rotationData.pickStoredRule(stored, fallback)`：解析失败 / 版本与 `DEFAULT_RULE.version` 不一致 → 回落默认。
**行为不变**，仅便于测试（§14 第 18 项）。

### 2.7 签名变更（内部）

`analyzeSector(series, data, rule)` → `analyzeSector(series, data, rule, comp)`；调用点 2 处（`analyzeAll`、`RotationDetail`）。目的是让"窗口定义"只有 `computeWindow` 一个来源。

---

## 3. 算法指标字典（本阶段新增/变更部分）

| 指标 | 业务含义 | 输入 | 计算公式 | 缺失数据 | 类型 | 使用页面 | 测试用例 |
|---|---|---|---|---|---|---|---|
| `windowView.eventAt/pctAt/rankUpAt` | 把板块序列还原到窗口日坐标 | comp + series | `wi = series.days[k] − comp.indices[0]` | 缺失日 = `null` | 原始（坐标对齐） | 主页热力网格 / 详情时间轴 / 悬停点击 | alignment 8 项 |
| `navSector[]` | 板块窗口净值 | 涨跌幅序列 | 逐日 `× (1+r/100)`，缺失日沿用前值 | 不当作 0 收益 | 派生 | 详情页曲线 / 最大回撤 | returns 4 项 |
| `navBench[]` | 基准窗口净值 | bench 序列 | 同上 | 全缺失 → 不画线 | 派生 | 详情页曲线 | returns 4 项 |
| `sectorValid[] / benchValid[]` | 逐日是否有行情 | 同上 | 布尔掩码 | — | 原始 | 详情页曲线（阶段 4 可标注） | returns 4 项 |
| `maxDrawdownOf(nav)` | 最大回撤 | 净值序列 | `DD_d = V_d/max(V≤d) − 1`；`MDD = min(DD_d)` | 跳过缺失日 | 派生 | 摘要 + 曲线 | returns 4 项 |
| `relativeToBench.simple` | 简单超额收益 | 板块 + 基准 | 共同有效日分别复合后作差 | 无共同日 → `null` | 派生 | 摘要「相对基准超额」 | returns 4 项 |
| `relativeToBench.netValue` | 相对净值收益 | 同上 | `S_nav/B_nav − 1` | 同上 | 派生 | 阶段 4 使用 | returns 4 项 |
| `gapStats.empties / avgEmpty` | 空档交易日数 | 事件日序号 | `empty_i = gap_i − 1` | — | 派生 | 阶段 4 展示 | gaps 16 项 |
| `normalize`（去重后） | 板块集合 | rotation.json | 按 id 保留第一条 | — | 原始 | 数据层 | consistency 13 项 |

---

## 4. 测试用例与预期 → 实际结果

**总览：5 个测试文件 / 64 个用例 / 全部通过（100%）**，命令 `npm test`（`vitest run`）。

| 文件 | 用例 | 覆盖任务书条款 | 关键手算预期（已通过） |
|---|---|---|---|
| `events.test.ts` | 13 | §14 1/2/3/6/7、§8.2、§7.3 | d4 并列 1.0% → 按 id 升序 `b` 在 `d` 前；a 板块 OR 下强势 4 次/弱势 4 次/大涨 2 次/大跌 2 次；AND 下强势 2 次而**大涨仍 2 次**；TOP N 2→4 时强势 4→8 而**大涨仍 2 次**；无事件时间隔为 `null` 而非 0；连续 3 日强势 → 当前/最长连续均 3、`empties=[0,0]` |
| `gaps-clusters.test.ts` | 16 | §14 4/8、§8.3、§8.4 | `gapStatsOf([1,2,3,4],1,3)` → avg 2.5 / median 2.5 / std 1.1180339887 / `empties=[0,1,2,3]` / concentration 0.75；冷却期 0/1/2/3 → 簇数 **4/3/2/1**（2 体现合并的传递性）；`d5~d8` 簇 → 3 个事件日、最大涨幅 5.0%、区间复合收益 9.20987% |
| `returns.test.ts` | 14 | §14 12/14/16/17、§8.6/8.7/8.8 | 板块 a 累计收益 **7.355829588493%**（≠简单相加 7.5%）；最大回撤 **−4.0%**；`maxDrawdownOf([1,1.2,0.9,1.1])=−25%`；净值逐点 1.01→1.0504→1.018888…→1.07355829588493；简单超额 6.3634549% vs 相对净值 6.3009261%（共同有效日 10 天）；基准全缺失 → `benchAvailable=false` 且相对值为 `null`；补齐 d3 后强势 3→4、累计收益 9.18908%→15.7404248% |
| `alignment.test.ts` | 8 | §14 10/11/15、§6.3、§9.1 | 板块 p 的 `series.events.length=4 ≠ comp.dates.length=6`（错位根源）；窗口视图长度 6、`pctAt=[1,5,null,-1,4,null]`；**摘要 strongCount = 视图强势日数 = strongDates.length**（夹具 A 与夹具 B 双场景）；缺失日数量 = 窗口日 − 有效日 |
| `consistency.test.ts` | 13 | §14 9/13/18 | 窗口 10→6：强势 4→3、弱势 2 且日期轴同步变为 `d5..d10`、累计收益 7.3558%→5.36568258%；规则序列化往返一致；旧版本存档作废后回落 60/TOP10/2.5%；重复 id 只保留第一条；非法行被过滤且不崩 |

**测试编写纪律**：全部预期值由手算给出并写在断言上方注释里，**未使用快照**，**未使用实现回填**。
过程中修正了 4 处**我自己写错的预期**（不是实现问题）：AND 下弱势应为 2 次（d10 也是 `rankDown ∧ largeDown`）、阈值置 0 时大涨标志位会被算成 7 天（属非法参数，阶段 5 校验拦截）、净值断言需逐点 `toBeCloseTo` 而非 `toFixed(6)`、以及一处测试解构写错。

---

## 5. 回归验证（浏览器实测，非仅单测）

| 场景 | 结果 |
|---|---|
| `/rotation/sector/BK1693`（覆盖率 40.8%） | 页头 `有效交易日 49 / 60`；时间轴 **前 11 格无数据（opacity 0.35）、后 49 格有数据**（修复前会把数据挤到左边、无数据堆到右边）；`noDataCount = 60 − 49 = 11` ✅ |
| 时间轴 ↔ 摘要一致性 | 时间轴深红（大涨）色块 3 个 == 摘要「强势榜出现次数 3 次」✅ |
| `/rotation` 主页 | 热力图 canvas 正常渲染（960×720）；点击格子 → 「事件解释」面板弹出；无「板块轮动数据暂不可用」✅ |
| 工程链路 | `npx tsc -b --noEmit` 通过；`npm run build` 通过（含测试类型检查）；`npm test` 64/64 通过 ✅ |

---

## 6. 修改文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `package.json` | 修改 | +`vitest ^5.0.4`、+`test` / `test:watch` 脚本 |
| `package-lock.json` | 修改 | 仅 vitest 及其依赖 |
| `src/utils/rotation/ruleEngine.ts` | 修改 | 新增 `SectorWindowView` 与 `toWindowView()`（窗口对齐访问器） |
| `src/utils/rotation/analytics.ts` | 修改 | `GapStats` 增 `empties/avgEmpty`；抽出 `maxDrawdownOf()`；新增 `relativeToBench()`、`buildNavSeries()`/`NavSeries`；`analyzeSector` 增加 `comp` 参数并改用上述单一实现 |
| `src/pages/Rotation.tsx` | 修改 | 热力网格改用 `viewByRow`（绘制 / 悬浮气泡 / 点击解释面板） |
| `src/pages/RotationDetail.tsx` | 修改 | 时间轴与净值曲线改用 `view` / `buildNavSeries`；基准不可用时隐藏基准线 |
| `src/data/rotationData.ts` | 修改 | `normalize` 导出并增加 id 去重；抽出 `pickStoredRule` |
| `src/utils/rotation/__tests__/fixtures.ts` | 新增 | 手工可核算的极小数据集（夹具 A/B/C） |
| `src/utils/rotation/__tests__/events.test.ts` | 新增 | 13 用例 |
| `src/utils/rotation/__tests__/gaps-clusters.test.ts` | 新增 | 16 用例 |
| `src/utils/rotation/__tests__/returns.test.ts` | 新增 | 14 用例 |
| `src/utils/rotation/__tests__/alignment.test.ts` | 新增 | 8 用例 |
| `src/utils/rotation/__tests__/consistency.test.ts` | 新增 | 13 用例 |
| `docs/ROTATION-V2-PHASE2-REPORT.md` | 新增 | 本文件 |

未改动：其它页面、`data.json`/`rotation.json`、`scripts/*`、workflow、任何依赖版本。

---

## 7. 本地运行与测试说明

```bash
# 依赖（仅首次）
npm ci

# 跑统计算法测试（64 项，约 0.2s）
npm test

# 监听模式
npm run test:watch

# 类型检查 / 生产构建（已含测试文件的类型检查）
npx tsc -b --noEmit
npm run build

# 本地预览
npm run dev     # http://localhost:5173/rotation
```

部署链路未变：Cloudflare Pages + Git 集成，`npm run build` 产物 `dist/`。

---

## 8. 遗留问题与未完成事项（如实列出）

| # | 事项 | 原因 | 归属阶段 |
|---|---|---|---|
| 1 | 主页「类型/搜索筛选」作用范围不一致：每日强弱榜与行为画像不受筛选、统计表与热力网格受筛选 | 属信息架构问题，非算法口径 | **阶段 3** |
| 2 | 相对净值收益 `netValue` 已实现但 UI 未使用 | 避免在阶段 2 改 UI | 阶段 4 |
| 3 | 大涨/大跌阈值 = 0 会被当成"条件未启用"，同时标志位仍按 `≥0` 计算 | 滑块 min=0.5，UI 无法产生；需配置器校验（§7.6） | 阶段 5 |
| 4 | 活跃度评分权重未做可靠性门槛与分项展开 | 需 UI | 阶段 3 |
| 5 | §14 第 20/21/22 项（观察清单、刷新后状态、窄屏布局）未覆盖 | 对应功能尚未开发（阶段 6） | 阶段 6 |
| 6 | 归档脚本 `fetch_rotation.py` 无自动化测试（Python 侧） | 本阶段只覆盖 TS 核心算法；且脚本依赖外部接口 | 阶段 6 评估 |
| 7 | 未引入 jsdom / 组件渲染测试 | 遵你的要求"优先测核心统计算法，不为测试大规模重构" | 后续按需 |
| 8 | 东财 `push2` 集群脉冲式风控导致归档可能滞后（本阶段未改） | 与本阶段无关；workflow 已加 `continue-on-error` | 阶段 6 评估增量归档 |

**未覆盖的 §14 清单项**：第 19 项（热力图点击详情）已用浏览器实测通过；第 23/24 项（生产构建、既有路由未破坏）已验证通过；第 1–18 项全部由 64 个用例覆盖。

---

## 9. 下一步

等你确认本报告后进入 **阶段 3：主页信息架构优化**（按你已确认的两点执行：轮动观察默认 3 条 + 可展开；关联分析折叠在主页底部）。
