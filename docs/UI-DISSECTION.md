# src/client/** 解剖：可复跑读数 + 可证伪缺陷清单 + 分层重构方案

**性质**：只读分析。本文档是 t5 的产出，**没有改动 `src/` 下任何文件**。
**基线**：HEAD = `b8f357e6c1e0cb57ac593a4a45e32e3eb01af63c`（工作树只有 `lib/git-artifact-stamp.json` 与 `docs/SESSION-BASELINE-2026-10-15.md` 两处非 client 变更）。

## 0. 方法纪律（为什么这份文档不写观感）

`docs/T30-LAYOUT-FINDING.md` 记录了一次代价很高的教训：一个**未经验证的配对**（"截图上的这两个 y 是相邻两行"）被写成了结论，然后被当成缺陷找了整整一轮，直到补上 computed style 才被推翻（commit `8ddbb81`、该文档 §⑨b）。

⇒ 本文档的每一条读数都遵守三条：

1. **不测像素**。本文档**一条像素测量都没有**。所有数字都是对**源文件文本**的计数。
2. **不写"看起来"**。每条缺陷 = 症状 + **可复跑命令** + `文件:行`。命令贴进终端就能自己复核。
3. **区分"读到"与"没有"**。一条规则"没被引用"与"我没找到引用"必须不同形 —— 所以下面每条死规则都给出了**它为什么被判成群**的证据（通常是"删掉它的那次 commit"），而不是只报一个 0。

**读数的唯一来源**：`src/client/**` 的文本。**没有跑过浏览器，没有跑过构建**。凡是需要构建才能验证的结论，都在 §5 明确标出。

---

## 1. 运行时架构

### 1.1 文件与规模的现状

任务书给的"24 文件 6735 行"在上游某个时点是对的；**当前基线是 31 文件 9666 行**。

```
$ find src/client -type f | wc -l          →  31
$ cat src/client/* | wc -l                 →  9666
```

分布极度不均（`wc -l src/client/*` 排序）：

| 文件 | 行 | 占 client 总行 |
|---|---:|---:|
| `ActivityPanel.module.css` | 2456 | 25.4% |
| `activity-model.ts` | 1093 | 11.3% |
| `StagingPlanEditor.tsx` | 981 | 10.1% |
| `ActivityPanel.tsx` | 906 | 9.4% |
| `activity-monitor.ts` | 539 | 5.6% |
| `locales.ts` | 524 | 5.4% |
| `MemberRow.tsx` | 453 | 4.7% |
| 其余 24 文件合计 | 2714 | 28.1% |

⇒ **前 7 个文件 = 71.9% 的 client 代码**，而其中 3 个是"一个文件一个巨型单元"的形态。

### 1.2 `index.tsx` 注册的 surface / slot（这是运行时形状的唯一真相）

`src/client/index.tsx` 的 `apply(ctx)` 一共注册 **7 个 slot 实例 + 1 个 conversation node + 1 个 native tab + 1 个 locale 命名空间**。它们**分属两个作用域**，而这个区分是有语义的（见 `index.tsx:147-163` 的注释）：

**A. 必选作用域**（`ctx.slots` / `ctx.uiConversation`，宿主只要装了 client 就有）：

| slot | id / key | order | 组件 | 行 |
|---|---|---|---:|---|
| `conversation.session.header.utilities` | `agent-teams-session-id` | 90 | `SessionIdAction` | `index.tsx:164-167` |
| `shell.overlay` | `agent-teams-activity` | 80 | `Panel`（→ `ActivitySurface`） | `index.tsx:169-175` |
| `conversation.chat.commandview` | `agent-teams` | — | `HiddenAgentTeamsCommand` | `index.tsx:180-183` |
| `conversation.chat.node` | `agent-teams` | — | `AgentTeamsCard` | `index.tsx:186-193` |

**B. 可选服务作用域**（`ctx.inject(['sidebarRight','sidebarRightTabs'], …)`，`index.tsx:102-145`）—— 宿主不提供侧边栏时**整块消失**：

| 贡献 | 形态 | 组件 | 行 |
|---|---|---|---|
| `sidebarRightTabs.register` | native tab | （tab 定义，非 slot） | `index.tsx:104-107` |
| slot `conversation.session.header.actions` | id `agent-teams-entry`，order 50 | `TeamChatEntry` | `index.tsx:108-111` |
| slot `conversation.chat.turnTail` | id `agent-teams-summary`，order 50 | `TeamTurnCard` | `index.tsx:112-116` |
| slot `sidebar.right.pane.tab` | key `TEAM_TAB_ID` | `WorkspaceActivity` | `index.tsx:117-125` |
| slot `sidebar.right.pane.tab` | key `ROSTER_SETTINGS_TAB_ID` | `RosterSettingsSurface` | `index.tsx:140-144` |

⇒ **缺陷素材**：`sidebar.right.pane.tab` 被**注册两次**（两个不同 key，两个不同组件），这是**故意**的（`index.tsx:126-139` 写明了理由）。但它意味着"侧边栏里这个插件占两个 tab"，而 `WorkspaceActivity` 与 `RosterSettingsSurface` 各自独立订阅同一份 snapshot —— 见 §3-D5。

**必选服务**：`export const inject = ['uiConversation','slots','sessions','locale','modelDirectories','layout']`（`index.tsx:43`）。

### 1.3 `activity-monitor.ts` 的轮询节奏

两个常量（`activity-monitor.ts:377-385`）：

```ts
export const ACTIVITY_POLL_MS = 1000      // 热：有明确卡片目标时
export const ACTIVITY_PROBE_MS = 5000     // 冷：只有 discovery session、还没有队时
export const ACTIVITY_STATE_URL = '/plugins/dsh-agent-teams/state'
export const ACTIVITY_HALT_URL  = '/plugins/dsh-agent-teams/halt'
```

节奏是**状态机**，不是固定值（`activity-monitor.ts:456-493`）：

```
monitorTargets.length > 0            ⇒ hot = true  ⇒ 1000ms 起
无 targets 但有 discoverySessionId   ⇒ hot = false ⇒ 5000ms 起
   └─ 一旦该 session 的队被看见       ⇒ hot = true  ⇒ 升级到 1000ms（:490-493，并 reschedule）
```

另外：`tick` 有 `inFlight` 闸门（`:467`），并发请求被丢弃；`fetchState` 用 `cache:'no-store'`（`:471-474`）；失败时**保留最后一份 snapshot** 并只把 `onStatus('error')` 报上去（`:520-523`）。

归档路径是**按需**的：只有当 `missing.length || needsDiscoveryArchive || discoveredTeamArchived` 为真时才多打一次 `?archived=1`（`:494-519`）。

**每条轮询的通知条件是"内容变了"**（`:356-375`）—— `contentEquals` 是递归、**键序无关**的结构化比较（`:297-348`），而不是 `JSON.stringify`。这一格是 t31 修的，理由写在 `:302-316`。

### 1.4 数据流图

```
                      宿主 /plugins/dsh-agent-teams/state          （HTTP，JSON）
                                   │
                                   │  fetch(cache:'no-store'), AbortController
                                   ▼
        ┌──────────────── startActivityPolling() ────────────────┐
        │  activity-monitor.ts:439                                │
        │  cadence: hot 1000ms / probe 5000ms；inFlight 闸门       │
        └────────────────────────┬────────────────────────────────┘
                                 │ publishSnapshots({teams} | {archivedTeams})
                                 ▼
                  updateActivitySnapshots()          :356
                  └─ contentEquals 闸门（键序无关）   :297   ★ 内容没变 ⇒ return，零通知
                                 │ 变了才通知
                                 ▼
        activitySnapshots（模块级单例）:168  ← getActivitySnapshotsSnapshot()
        snapshotListeners              :166  ← subscribeActivitySnapshots()
                                 │
             ┌───────────────────┼───────────────────┬──────────────────┐
             ▼                   ▼                   ▼                  ▼
    WorkspaceActivity    RosterSettingsSurface   AgentTeamsCard   ActivityPanel
    (:87 useSyncExternalStore)  (:143 注入)      (:24 注入)      (:24 注入)
                                                                      │
    targets（另一条独立轨道）:164 targets / :165 targetListeners       │
        monitorAgentTeam(sessionId, teamId)  ← 卡片渲染时登记，refcount :198
        settleActivityMonitorTargets(keys)   ← 归档落地后退休     :229
        getActivityMonitorTargetsSnapshot()  → WorkspaceMonitor :40
```

**state 的三个来源，必须分清**（这是最容易看混的一处）：

| 来源 | 位置 | 生命周期 | 谁读 |
|---|---|---|---|
| **snapshots**（服务端事实） | `activity-monitor.ts:164-168` | 模块级单例，跨路由存活 | 4 个 surface |
| **targets**（谁要被轮询） | `activity-monitor.ts:164-165` | 模块级，refcount | `WorkspaceMonitor` |
| **workspace state**（tab 的 UI 选择） | `workspace-state.ts:12-39`，由 `index.tsx:74` 创建 | **插件实例级**，由 `index.tsx` 持有并注入给两个 slot | `WorkspaceActivity`、`WorkspaceMonitor` |

⇒ **workspace state 的三个字段**：`statuses`（连接态，按 session）、`history`（卡片回放的队伍，按 `session:team`）、`selected`（当前选中队，按 session）。它是**唯一的"用户选择"存储**，而它**不在 React 里**（`:12-38` 手写 store + `publish` 通知）。

**import 图无环**（已实测，见 §3-D7 的命令）。

---

## 2. 量化症状：全部原始读数

> 下面每张表都注明**产生它的命令**。全部是对 `src/client/**` 文本的机械计数。

### 2.1 CSS：`ActivityPanel.module.css`（2456 行，58 071 字符）

| 指标 | 读数 | 复跑命令 |
|---|---:|---|
| 声明块（rule block） | **366** | 见下方脚本 |
| `@`-wrapper 块（media/container/keyframes） | **14** | 同上 |
| 逗号拆分后的**单个选择器** | **474** | 同上 |
| **去重后的选择器** | **381** | 同上 |
| **`!important` 条数** | **1** | `grep -c '!important' src/client/ActivityPanel.module.css` |
| 总声明（`prop: value` 计） | **1384** | 同上脚本 |
| **同一选择器在多处被定义（重复块）** | **66 个选择器 / 93 处多余** | 同上脚本 |
| **同选择器 + 同属性被声明 >1 次**（潜在覆盖，含 keyframes） | **52 组** | 同上脚本 |
| ↳ 排除 `@keyframes` 内的 `0%/50%/from/to/100%` 后的**真·覆盖组** | **44 组** | 见 §2.1.2 |
| ↳ 其中**全部声明都在 at-rule 之外**（无条件死声明） | **11 组** | 见 §2.1.2 表 A |
| 注释块 / 注释字符 | 37 块 / 5359 字符（占全文 9.2%） | 同上 |
| 空行 | 320 | `grep -c '^\s*$' …` |
| **类名 token 总数** | **135** | 见 §3-D1 脚本 |
| **在全部 `.tsx`/`.ts` 里找不到引用的类名** | **6** | 同上 |

**唯一的 `!important`** 在 `ActivityPanel.module.css:2016`：

```css
.team[data-workspace-team] > [data-staging-editor] { grid-column: 1 !important; grid-row: 2 / 4; }
```

这是全文**唯一**一处强制覆盖 —— 它是一条"这个网格我说了算"的信号，见 §3-D4。

#### 2.1.1 布局分区：附录占了 28%

按**行号区间**切分（`@media`/`@container` 的括号配对已实测）：

| 区间 | 行 | 行数 | 内容 |
|---|---|---:|---|
| 主体 | 1–1772 | 1772 | 全部基础样式 |
| 附录 | 1773–2456 | **684（27.9%）** | 见下 |

附录内部：

| 区间 | 行 | 行数 |
|---|---|---:|
| `@media (prefers-reduced-motion: reduce)` | 1773–1798 | 26 |
| `@media (max-width: 960px)` | 1800–1804 | 5 |
| `@media (max-width: 640px)` | 1806–1880 | 75 |
| `@container agent-team (max-width: 360px)` | 1882–1913 | 32 |
| `@container (max-width: 520px)` | 1936–1942 | 7 |
| **无 at-rule 包裹的裸规则**（是附录里的"补丁层"） | 除上述 151 行外 | **533** |
| `@container (min-width: 1000px)` | 2014–2019 | 6 |

⇒ **附录里 33 个选择器"逐字重新声明"了主体里已经存在的同一条选择器**（实测）。

#### 2.1.2 覆盖组的**精确**分类：44 组（去掉 keyframes），按"在不在 at-rule 里"三分

判定规则：一条声明若其**行号**落在 6 个 at-rule 区间（`1773-1798 / 1800-1804 / 1806-1880 / 1882-1913 / 1936-1942 / 2014-2019`）之内，则它只在特定条件下生效；落在区间之外则是**无条件生效**。

| 类别 | 组数 | 含义 |
|---|---:|---|
| **全部声明都在 at-rule 之外** ⇒ 前者被**无条件**覆盖 = **真·死声明** | **11** | 见下表 A |
| **混合**（一部分在 at-rule 外、一部分在内）⇒ 覆盖**依赖条件** | **32** | 见下表 B（摘要） |
| **全部在 at-rule 之内** ⇒ 合法响应式 | **1** | `.planApproveActions { width }` @1853,1885 |

**表 A：11 组真·死声明（每一条都是"前者永远读不到"）**

| 选择器 | 属性 | 行号（前 → 后） |
|---|---|---|
| `.panel` | `animation` | 70 → 1762 |
| `.badge` | `transition` | 15 → 1762 |
| `.memberAvatar[data-unread='true']::after` | `animation` | 699 → 1762 |
| **`.memberRow`** | **`grid-template-columns`** | **666 → 2062** |
| **`.memberRow`** | **`gap`** | **666 → 2062** |
| `.taskDetailMeta` | `color` | 1029 → 1035 |
| `.planNewTask label` | `gap` | 1318 → 1637 |
| `.planApproveRow button` | `background` | 1550 → 1690 |
| `.planApproveRow button` | `color` | 1550 → 1690 |
| `.planApproveRow button` | `min-height` | 1550 → 1690 |
| `.planApproveActions > button[data-danger]` | `color` | 1706 → 1712 |

**⇒ `.memberRow` 的那两组是最值得看的一对**：666 行声明了网格列与 gap，**2062 行无条件重新声明**。这两个行号相隔 1396 行，而 2062 在**任何视口宽度下**都生效 ⇒ **666 行的那两条声明是死的**。

**表 B：32 组混合覆盖（摘要，按是否成组）**

| 形态 | 组数 | 例子 |
|---|---:|---|
| `transition` / `animation: none` 的 reduced-motion 覆盖 | 10 | `.planChevron/Feedback/planActions button/planCard input/textarea/select/planConfirm button/planNewTask button/input/planApproveRow button` → 全部指向 `:1776`（`@media prefers-reduced-motion`）⇒ **这 10 组是合法的**，1776 只在降动效偏好下生效 |
| `.planApproveRow` / `.planNewTask` / `.planSecondaryActions` 等**在各处被重写了 2–3 次**（1633/1645/1528/1541 + 1845/1885） | 8 | `.planNewTask { align-items }` @1528 → @1633 → @1845；**@1528 与 @1633 两条都在 at-rule 之外**，所以 1528 是死的 |
| 进宽 / 窄态的条件覆盖（`.badge top/right`、`.captainNode`、`.delegationTree`、`.memberBranch`、`.planFlow li`、`.planCardHeader`、`.planGrid`、`.planModelPicker`、`.planHeader > span`、`.planFlow li::after`） | 14 | 这些"主体一份 + `@media (@1806-1880)` 一份"是**合法响应式**；**但**其中 1870/1874/1879 落在 1865–1882 的**裸区**，所以这几条要逐条判 |

⇒ **结论**：原始计数（含 keyframes 共 **52** 组）**不能整体当缺陷数** —— 排除 keyframes 后是 **44** 组，其中"附录全是冗余"**也不成立**（32 组是混合，多数为合法条件覆盖或 reduced-motion）。**真正无条件被覆盖、因而前者可删的，是表 A 的 11 组。**

### 2.2 属性选择器：`data-*` 探针一共 159 处 / 29 个不同属性

**读数**：
```bash
grep -oE '\[[a-zA-Z-]+[^]]*\]' src/client/ActivityPanel.module.css | wc -l      # → 159
grep -oE '\[(data-[a-zA-Z-]+)' src/client/ActivityPanel.module.css | sort -u | wc -l   # → 29
```

与 TS/TSX 的使用计数对照（`grep -roE '\b<attr>\b' src/client/*.tsx src/client/*.ts | wc -l`）：

| 属性 | 在 ts/tsx 出现 | 判定 |
|---|---:|---|
| `data-subagent-readout` | 2 | ✅ |
| `data-workspace-team` | 1 | ✅ |
| `data-phase` | 1 | ✅ |
| …（其余 24 个均 ≥1） | ≥1 | ✅ |
| **`data-selected-member`** | **0** | ❌ **死属性** |

⇒ **只有 1 个属性选择器是死的**：`ActivityPanel.module.css:2020`

```css
.team[data-workspace-team] .memberBlock[data-selected-member] .memberRow { outline: … }
```

同族的 `data-has-model`（`T30-LAYOUT-FINDING.md` §⑥/§⑩ 记的那条）**已经在 t36 被删掉** —— 实测 `grep -rc 'data-has-model' src/client/*.tsx` 零命中，CSS 里也零命中。**这条旧发现已经关闭，不要重复处理。**

### 2.3 TSX：组件与 props

**props 的口径说明**：这个代码库**几乎不用 `interface XxxProps`**，而是**组件签名里内联一个对象类型**。所以下表的"props"是**内联对象类型里的字段数**（脚本已核）。

| 文件:行 | 组件 | props | `useState` | `useEffect` | hooks 合计 | 行数 |
|---|---|---:|---:|---:|---:|---:|
| `ActivityPanel.tsx:371` | **`ActivityPanel`** | **0**（用 `ActivityPanelProps`） | **8** | **6** | **45** | 371–906 |
| `ActivityPanel.tsx:154` | `TeamSection` | 3（内联 7 字段） | 4 | — | 5 | — |
| `ActivityPanel.tsx:128` | `CollapsedBadge` | 3 | 0 | 0 | 0 | — |
| `StagingPlanEditor.tsx:631` | `StagingPlanEditor` | 3 | **7** | **1** | — | 981（全文件） |
| `StagingPlanEditor.tsx` 全文件 / 6 个组件 | — | — | **32 合计** | **7 合计** | 45 | 981 |
| `StagingPlanEditor.tsx:134` | `StagedModelPicker` | 7 | — | — | — | — |
| `StagingPlanEditor.tsx:371` | `StagedMemberEditor` | 5 | — | — | — | — |
| `StagingPlanEditor.tsx:497` | `StagedTaskEditor` | 4 | — | — | — | — |
| `StagingPlanEditor.tsx:900` | `MemberModelField` | 5 | — | — | — | — |
| `MemberRow.tsx:242` | `MemberRow` | **15** | 0 | 0 | 1 | 453 |
| `DependencyGraph.tsx:65` | `DependencyGraph` | 7 | 5 | 2 | 11 | 258 |
| `MemberScreen.tsx:70` | `MemberScreen` | 0 | 2 | 1 | 4 | 214 |
| `WorkspaceActivity.tsx:85` | `WorkspaceActivity` | 0 | 1 | 2 | 11 | 130 |
| `MemberClock.tsx:99` | `MemberClock` | 5 | 2 | 1 | 3 | 128 |
| `SessionIdAction.tsx:101` | `SessionIdAction` | 0 | 1 | 1 | 4 | 131 |
| `AgentTeamsCard.tsx:66` | `AgentTeamsSummary` | 2 | — | — | — | — |
| `roster-settings.tsx` | `RosterSettingsSurface` / `RosterSettings` | 0 / 0 | 0 | 0 | 1 | 203 |

**`ActivityPanel.tsx` 的 8 个 `useState`**（逐行）：

| 行 | state | 所属组件 |
|---:|---|---|
| 165 | `selectedTaskId` | `TeamSection` |
| 167 | `stopOpen` | `TeamSection` |
| 176 | `stopping` | `TeamSection` |
| 177 | `stopError` | `TeamSection` |
| 380 | `open` | `ActivityPanel` |
| 381 | `openOwner` | `ActivityPanel` |
| 382 | `autoOpened` | `ActivityPanel` |
| 383 | `wasActive` | `ActivityPanel` |
| 384 | `historic` | `ActivityPanel` |
| 385 | `layout` | `ActivityPanel` |
| 386 | `bounds` | `ActivityPanel` |
| 387 | `interaction` | `ActivityPanel` |

（12 个 `useState` 总计：`TeamSection` 4 + `ActivityPanel` 8。任务书说的"单文件多少 state"就是这个数。）

**`ActivityPanel.tsx` 的 9 个 effect**（`grep -n`）：`424, 434, 442, 484, 501, 517, 541, 599, 670` —— 其中 3 个是 `useLayoutEffect`（`442, 484, 501`），其余 `useEffect`。`:424` 是一个 `useEffect` 把 `current` 同步进 `currentRef`，这是"ref 镜像 state"的手法。

**`StagingPlanEditor.tsx` 的 32 个 `useState` 分布在 6 个组件里**（这是逐行实测的，**不是**都压在 `StagingPlanEditor` 上 —— 这一点容易误读，特意纠正）：

| 组件 | 行 | `useState` | `useEffect` |
|---|---:|---:|---:|
| `DisclosureChevron` | 82–89 | 0 | 0 |
| `Feedback` | 90–108 | 0 | 0 |
| `StagedModelPicker` | 134–370 | 2 | 0 |
| `StagedMemberEditor` | 371–496 | **9** | 2 |
| `StagedTaskEditor` | 497–630 | **9** | 2 |
| `StagingPlanEditor` | 631–882 | 7 | 1 |
| `MemberModelField` | 900–982 | 5 | 1 |
| **合计** | 981 行 | **32** | 7 |

⇒ 单文件 45 个 hook 调用，`useId` 4 次。**最大单点其实是 `StagedMemberEditor` 与 `StagedTaskEditor`（各 9 个）**，而不是 `StagingPlanEditor` 本体（7 个）。这个分布改变了 D6 的处置方式，见下。

### 2.4 重复：hook 写法与模块级单例

| 指标 | 读数 | 说明 |
|---|---:|---|
| 手写 `subscribe/getSnapshot` 外部 store | **4 处** | `activity-monitor.ts:182/188`、`activity-monitor.ts:241/247`、`workspace-state.ts:20/21`、`WorkspaceActivity.tsx:17-25`（bridge） |
| `useSyncExternalStore` 调用点 | **16** | 见脚本；最大的扇出在 `WorkspaceActivity.tsx`（5 次） |
| 同一份 snapshot 被独立订阅的 surface | **4** | `WorkspaceActivity`、`RosterSettingsSurface`、`AgentTeamsCard`、`ActivityPanel` |

### 2.5 文案：`locales.ts`

| 指标 | 读数 | 复跑 |
|---|---:|---|
| `zh` key 数 | **241** | 解析 `zh` 对象字面量 |
| `en` key 数 | **241** | 同上 |
| **zh/en 差集** | **0 / 0** | 两本字典完全对齐 ✅ |
| **从未被引用的 key** | **40** | 见下 |
| 其中被 `scripts/verify.mjs` 钉住的 | **1**（`member.state.notCreated`） | `scripts/verify.mjs:308` |

**读数口径（这一条必须写清，否则数字会漂）**：判据是"**完整的点号 key 是否作为带引号的字符串出现在某个非 `locales.ts` 文件里**"。语料 = `src/**` + `scripts/**` + `test/**` 中所有 `.ts/.tsx/.mjs/.js/.json/.md`，共 **281** 个文件。

**为什么用"完整点号 key"而不是"末段"**：我一开始试过"完整 key 或末段"的双重匹配，得到 13；换成严格的全 key 匹配得到 **40**。两者差的 27 个是**假阴性** —— 例如 `progress.running` 的末段 `running` 在 CSS 类名、状态字符串里到处出现，于是被误判成"活着"。**严格口径是唯一可复跑的那个**，所以以 40 为准。

**为什么不可能有"动态拼出的 key"**（这一条排除了最后一类反例）：`locales.ts:265` 是

```ts
export type AgentTeamsLocaleKey = keyof typeof zh
```

而 `t()` 的参数类型就是 `AgentTeamsLocaleKey` ⇒ **key 只能以字面量形式出现在代码里**，拼出来的字符串连类型检查都过不去。仓库里唯一的动态 key 构造是 `workspace-state.ts:34` 的 `` `${owner}:${...}` ``，那是 map key，不是 locale key。

⇒ **这 40 条就是死文案**（`zh` 与 `en` 各一份，共 80 处条目）：

| 分组 | 条数 | key |
|---|---:|---|
| `assignment.*` | **4** | `assignment.discarded` / `assignment.empty` / `assignment.label` / `assignment.staged` |
| `member.state.*` | **10** | `delivered` / `failed` / `left` / `pending` / `removed` / `staged` / `stopped` / `unassigned` / `waiting` / `working` |
| `member.status.*` | **6** | `delivered` / `idle` / `settled` / `unknown` / `waitingOn` / `waitingPrerequisite` |
| `plan.approve*` | **3** | `plan.approveConfirm` / `plan.approveConfirmTitle` / `plan.approveWarning` |
| `plan.*` 其他 | **5** | `plan.approving` / `plan.member.provider` / `plan.member.reasoningHint` / `plan.model.defaultReasoning` |
| `progress.*` | **3** | `progress.blocked` / `progress.running` / `progress.title` |
| `workspace.*` | **8** | `completed` / `description` / `eyebrow` / `guide` / `members` / `noTasks` / `relationships` / `tasks` |
| 其他 | **2** | `action.openActivityPanel` / `activity.panelButton` |
| **合计** | **40** | |

⇒ 成组的形态很明显：**`member.state.*` 10 条**（**整整一代**的成员状态词汇表被换掉了）、**`workspace.*` 8 条**（`WorkspaceActivity.tsx` 早期版本的标题/引导语）、**`assignment.*` 4 条 + `plan.approve*` 3 条**（两批交互被删了，文案留下）。这几个成组占了 40 条里的 **25 条（62.5%）**，说明这不是零散遗漏，而是**几次大改没有回收文案**。

**★ 一条必须保留的**：`member.state.notCreated` 也在上面这 40 里，但它被 `scripts/verify.mjs:308` 逐字钉住 ⇒ **删了它 `pnpm verify` 会红**。这不是"死文案"，是"**被测试钉住但当前 UI 不渲染**"。这正是"读到"与"没有"必须不同形的一条活例 —— 所以 D8 的可删清单是 **39 条，不是 40**。

---
## 3. 可证伪缺陷清单

每条格式：**症状 → 可复跑读数 → 位置 → 为什么这是缺陷（而不是风格）**。
每条都附一个**反向半边**（"如果这条被修好了，什么读数会变"），因为只有正向半边的判据可以让一个什么都没做的实现照样通过。

---

### D1 — 6 个死 CSS 类：R3 删了组件，样式没删

**症状**：`ActivityPanel.module.css` 里有 6 个类名，在整个 client（全部 `.ts`/`.tsx`）里**一次都没有被引用**。

**读数**：
```bash
python3 - <<'EOF'
import re,glob
src=re.sub(r'/\*.*?\*/','',open('src/client/ActivityPanel.module.css').read(),flags=re.S)
cls=set(re.findall(r'\.([A-Za-z_][A-Za-z0-9_-]*)',src))
corpus={f:open(f).read() for f in glob.glob('src/client/*.tsx')+glob.glob('src/client/*.ts')}
print([c for c in sorted(cls) if not any(re.search(r'\b'+re.escape(c)+r'\b',t) for t in corpus.values())])
EOF
```
⇒ `['assignmentLine', 'loopRound', 'loopRoundMarker', 'loopSection', 'loopStatusTail', 'memberState']`（135 个类名中的 6 个，4.4%）

**位置**（逐条，行号已实测）：

| 类名 | CSS 行 | 判定证据 |
|---|---:|---|
| `assignmentLine` | 1815（`@media max-width:640px` 内） | 面板早期版本的"分配行"；`ActivityPanel.tsx:145` 提到 `memberStateLabel` 等已搬走 |
| `memberState` | **1987** | 与活类 `memberRole` 同写在一行逗号列表里 —— **只死了一半**（见下） |
| `loopSection` | 2006 | t13 的 `ReviewLoopSection` |
| `loopRound` | 2015 | 同上 |
| `loopRoundMarker` | 2025 | 同上 |
| `loopStatusTail` | 2042 | 同上 |

**为什么这是缺陷（而不是"留着无害"）**：
1. 五条 `loop*` 类**成组**来自 t13 的 `ReviewLoopSection`，而 R3 把第二屏改成"只有依赖图"（`git log -S'loopRoundMarker' -- src/client/ActivityPanel.tsx` → 命中 merge `3ce3e76 merge: land R3, screen two becomes the dependency graph alone`）。**组件删了，它的 2042–2100 行样式留下了**。
2. `activity-model.ts:473` 的注释还在说"轮次/收敛原本单占一块（`ReviewLoopSection`）" —— 代码里的**叙述**与**样式**彼此矛盾：文档说它没了，CSS 说它还在。
3. 这正是 `T30-LAYOUT-FINDING.md` §⑥/§⑩ 已经处理过一次的**同一形态**（`data-has-model`："读起来像在管事、实际不生效"）。**同一个仓库里第二次出现。**

**★ 附带发现（比 D1 本身更值钱）**：`memberState` 的死亡是**半条规则里的**：

```css
/* ActivityPanel.module.css:1987 */
.team[data-workspace-team] .memberRole, .team[data-workspace-team] .memberState, .team[data-workspace-team] .memberCount { font-size: 11px; }
```

它是一条**3 选择器的逗号列表**，中间那个死了。⇒ 这条验证了一个方法论要点：**"死规则"的粒度是选择器，不是规则块**。一个只按规则块整块删的工具会把 `memberRole`/`memberCount` 的字号一起删掉。

**反向半边**：修好之后，上面那个脚本的输出应当是 `[]`；而 `grep -c 'loopSection\|loopRound\|loopStatusTail\|memberState\|assignmentLine' src/client/ActivityPanel.module.css` 应从 **6** 变成 **0**。

---

### D2 — 11 组无条件被覆盖的死声明

**症状**：同一选择器、同一属性被声明多于一次，且**两次声明都在任何 `@media`/`@container` 之外** ⇒ 在标准级联下（同优先级取后出现者），**前者永远读不到**。

**读数**：
```bash
python3 - <<'EOF'
import re,collections
nc=re.sub(r'/\*.*?\*/','',open('src/client/ActivityPanel.module.css').read(),flags=re.S)
def blocks(t):
    out=[];st=[];i=0;seg=''
    while i<len(t):
        if t[i]=='{': st.append((seg.strip(),t[:i].count('\n')+1)); seg=''
        elif t[i]=='}':
            if st: s,l=st.pop(); out.append((s,seg,l))
            seg=''
        else: seg+=t[i]
        i+=1
    return out
bs=blocks(nc)
ATR=[(1773,1798),(1800,1804),(1806,1880),(1882,1913),(1936,1942),(2014,2019)]
inatr=lambda ln: any(a<=ln<=b for a,b in ATR)
p=collections.defaultdict(list); loc={}
for sel,body,ln in bs:
    if sel.startswith('@'): continue
    for x in sel.split(','):
        for d in body.split(';'):
            if ':' in d:
                p[(x.strip(),d.split(':')[0].strip())].append(ln); loc[ln]=inatr(ln)
KF={'0%','50%','from','to','100%'}
real={k:v for k,v in p.items() if len(v)>1 and k[0] not in KF}
dead=[(k,v) for k,v in real.items() if all(not loc[l] for l in v)]
print('groups total:',len(real),'| DEAD (every decl outside at-rules):',len(dead))
for k,v in sorted(dead): print('   ',k,v)
EOF
```
⇒ 覆盖组共 **44** 组（已排除 4 组 `@keyframes` 的合法重复），其中**全部声明都在 at-rule 之外**的有 **11** 组。

**位置：11 组死声明（表 A）**

| 选择器 | 属性 | 行号（前者 → 覆盖者） |
|---|---|---|
| `.panel` | `animation` | 70 → 1762 |
| `.badge` | `transition` | 15 → 1762 |
| `.memberAvatar[data-unread='true']::after` | `animation` | 699 → 1762 |
| **`.memberRow`** | **`grid-template-columns`** | **666 → 2062** |
| **`.memberRow`** | **`gap`** | **666 → 2062** |
| `.taskDetailMeta` | `color` | 1029 → 1035 |
| `.planNewTask label` | `gap` | 1318 → 1637 |
| `.planApproveRow button` | `background` | 1550 → 1690 |
| `.planApproveRow button` | `color` | 1550 → 1690 |
| `.planApproveRow button` | `min-height` | 1550 → 1690 |
| `.planApproveActions > button[data-danger]` | `color` | 1706 → 1712 |

**⇒ `.memberRow`（`grid-template-columns` 与 `gap`，666 → 2062）是这 11 组里最值得看的一对**：两条相隔 **1396 行**，且 2062 在任何宽度下生效。

**为什么这是缺陷**：这 11 组里的**前者**是"读起来像在管事、实际永远不生效"的声明 —— 与 `T30-LAYOUT-FINDING.md` §⑥/§⑩ 已处理过的 `data-has-model` **同一形态**。它们不会报错，只会让下一个读样式表的人以为 `.memberRow` 的列定义在 666 行。

**★ 必须同时说清的：不能把 44 组整体当缺陷**。实测分类：

| 类别 | 组数 | 是否缺陷 |
|---|---:|---|
| 全部在 at-rule 之外（表 A） | **11** | ✅ 是 |
| 混合（一条在外、一条在内） | **32** | ❌ **大部分不是** —— 其中 10 组是 `@media (prefers-reduced-motion: reduce)` 的 `transition/animation: none` 覆盖（`:1776`），**这是正确写法**；其余是窄态/宽态的条件覆盖 |
| 全部在 at-rule 之内 | **1** | ❌ 不是（`.planApproveActions { width }` @1853,1885） |

⇒ 换句话说：**附录里的覆盖绝大多数是合法的**这一结论，与**附录里仍有 11 组无条件死声明**这一结论**同时成立**。把前者当成"所以附录没问题"、或把后者当成"所以附录全是垃圾"，都是在用一个数字去回答两个问题。

**可证伪性**：不是"我觉得乱"，而是具体到"`ActivityPanel.module.css:666` 的 `.memberRow { grid-template-columns }` 在**所有宽度**下都被 `:2062` 覆盖 ⇒ 666 行那两条可删"。要推翻它，只需指出一个 2062 不在生效路径上的情形（例如它其实在某条选择器作用域里 —— 但实测它所在的规则不在任何 at-rule 内）。

**反向半边**：修好之后，上面那个脚本的 `DEAD` 列表应为**空**；而 `44` 这个总数**不应当**变化（合法覆盖要保留）。

---

### D3 — 附录 684 行里 533 行是裸的"补丁层"

**症状**：`ActivityPanel.module.css` 的 1773–2456 行（**684 行，占全文 27.9%**）里，只有 **151 行**属于 6 个 at-rule 区间；**其余约 533 行是没有任何 at-rule 包裹的裸规则**。

**读数**：
```bash
awk 'NR>=1773' src/client/ActivityPanel.module.css | wc -l   # → 684
# 6 个 at-rule 区间（括号配对实测）：1773-1798, 1800-1804, 1806-1880, 1882-1913, 1936-1942, 2014-2019
#   区间内行数 = (1798-1773+1)+(1804-1800+1)+(1880-1806+1)+(1913-1882+1)+(1942-1936+1)+(2019-2014+1)
#               =  26 + 5 + 75 + 32 + 7 + 6 = 151
# 裸规则区 = 684 − 151 = 533 行（含空行）
```

**位置**：`ActivityPanel.module.css:1920-1935`、`1943-2013`、`2020-2456` 中的裸规则区。典型形态：

```css
/* :1930-1935 —— 一整段"不许…"的裸覆盖 */
.team[data-workspace-team] .dagNodeLabel { display: block; width: 100%; … }
.team[data-workspace-team] .sectionHead { flex-wrap: wrap; gap: 6px; }
.team[data-workspace-team] .memberLine { flex-wrap: nowrap; }
.team[data-workspace-team] .memberStatusLine { white-space: nowrap; }
```

**为什么这是缺陷**：这一层 100% 由 `.team[data-workspace-team]` 前缀的选择器构成（`grep -c '\.team\[data-workspace-team\]' ⇒ 占附录裸区绝大多数）。它是一个**只在 `workspace=true` 路径上生效的第二套皮肤**，写在一个文件末尾、与它要覆盖的那套规则**相隔 1000–2000 行**。

⇒ **这就是 `T30-LAYOUT-FINDING.md` §⑨ 讨论的那件事的结构面**：文档说"两个屏共用一个网格"在行距上无辜、但**仍是"两块内容挤在一个容器里"的结构问题**。这里给出它的**机械读数**：`workspace` 这个布尔量在 CSS 里的表达方式是**533 行前缀重写**，而不是一个作用域。

**反向半边**：修好之后，`grep -c '\.team\[data-workspace-team\]' src/client/ActivityPanel.module.css` 的计数应当**不在一个文件里**（裸区被拆走），而 D2 的表 A 应当变空。

**★ 这里必须纠正一个容易过头的地方**：附录里有 **33 个选择器**逐字重新出现了主体的同一条选择器（§2.1.1 实测），但**其中只有 1 个（`.memberRow` @2062）是无条件覆盖**；其余 32 个在 at-rule 内，是合法响应式。⇒ **"33 处重声明"不等于"33 处冗余"**，这一点在 D2 的三分表里已经算清。D3 的缺陷不是"它们冗余"，而是"它们**散落在一个文件的两端、没有作用域**"。

---

### D4 — 唯一一条 `!important` 是网格争夺的战报

**症状**：全文只有 1 处 `!important`，而它出现在 `@container (min-width: 1000px)` 里，强制一个子元素回到第 1 列。

**读数**：
```bash
grep -n '!important' src/client/ActivityPanel.module.css
```
⇒ `2016:  .team[data-workspace-team] > [data-staging-editor] { grid-column: 1 !important; grid-row: 2 / 4; }`

**位置**：`ActivityPanel.module.css:2014-2019`

```css
@container (min-width: 1000px) {
  .team[data-workspace-team]:has(> [data-staging-editor]) { grid-template-columns: minmax(0,1fr) minmax(0,1fr); }
  .team[data-workspace-team] > [data-staging-editor] { grid-column: 1 !important; grid-row: 2 / 4; }
  .team[data-workspace-team]:has(> [data-staging-editor]) > .delegationSection { grid-column: 2; grid-row: 2; }
  .team[data-workspace-team]:has(> [data-staging-editor]) > .dependencySection { grid-column: 2; grid-row: 3; … }
}
```

**为什么这是缺陷**：`!important` 在这里的作用是**否决**同一个 `:has()` 网格上的另一条声明。它标志着"这个布局有两套作者、靠优先级打官司"。`T30-LAYOUT-FINDING.md` §⑨ 已经证明这个双列网格**确实生效**（1440 宽时 `display:grid`、`528.531px 839.469px`），所以说它是"没用的规则"是错的 —— 它是**有效但脆**的，而脆性证据就是这唯一的 `!important`。

**反向半边**：删掉 `!important` 后如果布局不变 ⇒ 它是冗余强制；如果变了 ⇒ 它就是当前布局的**承重件**，那就得先拆网格再拆它。两种结果都是可测的，所以这条是可证伪的。

---

### D5 — `ActivityPanel.tsx`：906 行里 8 个 state + 9 个 effect，承担 5 种互不相关的职责

**症状**：一个文件同时管：① 浮窗拖拽/缩放 ② 面板开合与自动展开 ③ 队伍终止（halt）交互 ④ 卡片回放态 ⑤ 渲染整棵面板树。`ActivityPanel.tsx` 是 client 里 **fan-out 最大的文件（14 个内部 import）**。

**读数**：
```bash
grep -c 'useState\|useEffect\|useLayoutEffect\|useMemo\|useCallback\|useRef\|useSyncExternalStore' src/client/ActivityPanel.tsx
grep -n 'useEffect(\|useLayoutEffect(' src/client/ActivityPanel.tsx
```
⇒ 全文件 **50** 个 hook 调用；`useState` 12、`useEffect` 6、`useLayoutEffect` 3、`useRef` 8、`useMemo` 7、`useCallback` 11、`useSyncExternalStore` 3。
⇒ 按组件分：**`ActivityPanel` 本体 45 个**（含 8 个 `useState`、6 个 `useEffect`、3 个 `useLayoutEffect`），`TeamSection` 5 个（含 4 个 `useState`）。
⇒ **⇒ 45/50 的 hook 都压在 `ActivityPanel` 这一个组件上**，这是 D5 的量化依据。
⇒ effect 行号：**424, 434, 442, 484, 501, 517, 541, 599, 670**。

**位置**：
- `ActivityPanel.tsx:380-387` —— `ActivityPanel` 的 8 个 state 连号声明（`open / openOwner / autoOpened / wasActive / historic / layout / bounds / interaction`）。
- `ActivityPanel.tsx:165-177` —— `TeamSection` 的 4 个 state（`selectedTaskId / stopOpen / stopping / stopError`）混在 906 行文件的第 165 行，即**在 `ActivityPanel` 本体之前 200 行**。
- `ActivityPanel.tsx:424` —— `useEffect(() => { currentRef.current = current }, [current])`：ref 镜像 state 的补偿手法。

**为什么这是缺陷**：面板**每 1000ms 都可能重渲染**（`ACTIVITY_POLL_MS`）。把 8 个 state 放在树根意味着**任何一次**（拖拽中的 pointermove、halt 按钮的 `stopping`、面板开合）都会让整棵 906 行的子树重算。`activity-model.ts:638-662` 的注释已经承认过这个形态并做过一次修正（"秒表原本挂在 1599 行的 `TeamSection` 上 —— `useElapsedNow` 一 tick，**整棵面板树重渲染**"），⇒ **同一个根因还剩至少 8 个 state 没搬走。**

**反向半边**：读数不是"看起来多"，而是**具体的**：把 `interaction`（拖拽态）从 `ActivityPanel` 移出后，`ActivityPanel` 的 `useState` 数应从 8 → 7，而 `TeamSection` 的渲染次数在拖拽期间应从"每 pointermove 一次"变为 0。后者需要 React DevTools 或一个渲染计数器 —— **这一条是本文档中唯一"验证手段不纯机械"的，明确标出**。

---

### D6 — `StagingPlanEditor.tsx`：981 行 / 45 个 hook / 32 个 `useState` 分布在 6 个组件里

**症状**：一个文件里 6 个组件共用 45 个 hook 调用，其中 **32 个是 `useState`**，而**没有一个组件低于 2 个**（2/9/9/7/5）。

**读数**：
```bash
grep -cE '\buseState\s*[(<]' src/client/StagingPlanEditor.tsx   # → 32
grep -cE '\buseEffect\s*\(' src/client/StagingPlanEditor.tsx     # → 7
wc -l src/client/StagingPlanEditor.tsx                           # → 981
```
逐组件的分布见 §2.3 的表（`StagedMemberEditor` 9、`StagedTaskEditor` 9、`StagingPlanEditor` 7、`MemberModelField` 5、`StagedModelPicker` 2）。

**位置**：`StagingPlanEditor.tsx:134/371/497/631/900`（5 个有状态的组件）+ `:82/:90`（2 个无状态）。

**为什么这是缺陷**：32 个 `useState` 平铺在 981 行里，形态是"表单的每个字段各自一个格子"，而 `useEffect` 有 7 个（每个有状态组件各带 1–2 个）。

**★ 处置方式因为上面的分布而不同**（这是本文档纠正的一处早期误读）：
- **不是**"把 `StagingPlanEditor` 本体的 32 个 state 收敛成一个 reducer" —— 它本体只有 7 个。
- **而是**"这 6 个组件本来就已经分开，却仍然挤在一个文件里，且 `StagedMemberEditor`/`StagedTaskEditor` 各带 9 个平铺 state"。⇒ 正确动作是 **L1.5（拆文件）+ 各自把 9 个平铺 state 收敛成一个 draft 对象**。

**反向半边**：`grep -cE '\buseState\s*[(<]' src/client/StagingPlanEditor.tsx` 从 **32** 显著下降，且每个拆出去的文件里 `useState` 数 ≤ 2（一个 draft 对象 + 一个提交态）。

---

### D7 — `MemberRow.tsx`：15 个 props 的"什么都传"接口

**症状**：`MemberRowProps`（`MemberRow.tsx:214-241`）有 **15 个字段**，且其中 **2 个是"由调用方算好交进来"的旁路**。

**读数**：
```bash
sed -n '214,241p' src/client/MemberRow.tsx | grep -cE 'readonly [A-Za-z]'   # → 15
```

**位置**：`MemberRow.tsx:214-241`；旁路字段在 `:221`（`memberModel`）与 `:224`（`memberModelEditable`）：注释写着"★ 模型这一格由**调用方**算好交进来（面板用 `memberRouteLabel` 算一次）"。

**为什么这是缺陷**：15 个 props 里混了三类东西 —— ① 数据（`team`/`member`/`tasks`）、② 回调（`onToggle`/`onOpenSubagent`/`onSelectTask`）、③ **已经算过的读数**（`memberModel`、`memberModelEditable`、`discarded`、`stopped`、`historic`、`frozenNow`）。第三类让"这一行该显示什么"的决定权**分散到调用方**，而 `MemberRow.tsx:255-262` 又同时自己算 `memberClock` / `memberRound` / `memberSubagentReadout` / `memberDotTone` —— ⇒ **同一行里一半读数自己算、一半由外面算**，判据没有单一位置。

**反向半边**：`grep -cE 'readonly [A-Za-z]' <(sed -n '214,241p' src/client/MemberRow.tsx)` 明显下降，且这些读数**全部**由 `MemberRow` 自己从 `team`/`member`/`tasks` 派生（就像 `memberClock` / `memberRound` 现在做的那样）。

---

### D8 — 39 条死文案（另有 1 条被测试钉住，不可删）

**症状**：`locales.ts` 的 241 个 key 里，**40** 个从未被任何非 `locales.ts` 文件引用；其中 1 个被 `scripts/verify.mjs` 钉住 ⇒ **39 条可删**。

**读数**：见 §2.5 —— 判据是完整的点号 key 作为带引号字符串出现在 281 个文件的语料里；`t()` 的参数类型是 `keyof typeof zh` ⇒ **不可能有动态拼出的 key**。

**位置**：`src/client/locales.ts` 的 `zh`（`:7` 起）与 `en`（`:268` 起）**各自**有一份 ⇒ **共 78 处条目要删**。

**为什么这是缺陷**：`scripts/verify.mjs:307-308`、`:488`、`:496` 会**主动断言**特定 locale key 的存在或不存在 ⇒ 这个仓库**已经把 locales 当作受测资产**。一个受测资产里躺 40 条没人引用的条目（占总数的 **16.6%**），会让"这条文案是给谁用的"无法回答。

**★ 必须保留的那一条**：`member.state.notCreated` 在语料里同样零命中，但 `scripts/verify.mjs:308` 逐字钉住了它（`localesSource.includes("'member.state.notCreated': '未创建'")`）⇒ **删了 `pnpm verify` 会红**。它是"被测试钉住但当前 UI 不渲染"，**不是死文案**。

**反向半边**：修好之后，同一段语料扫描应在 `zh`/`en` 上都返回**只剩 `member.state.notCreated` 一条**；且 `pnpm verify` 仍绿（证明没有碰到 `:307-308` 钉住的两条 —— 另一条 `task.status.notRun` 本来就在活集里）。

### D9 — 存根/占位读数：3 处

| # | 位置 | 症状 | 读数 |
|---:|---|---|---|
| D9a | `activity-model.ts:208-209` | `teamProgressSummary` 的最后两个分支**返回同一个值** `{working:0, detail:''}` | 见下 |
| D9b | `index.tsx:60-62` | `useLegacyPanelInfo` 是一个**恒返回** `{activePanelId: null}` 的旧宿主兼容存根 | 3 行 |
| D9c | `activity-monitor.ts:324-328`（`contentEquals`） | 数组分支里 `if (!Array.isArray(a) \|\| !Array.isArray(b) \|\| a.length !== b.length) return false` —— 前一行的 `if (Array.isArray(a) \|\| Array.isArray(b))` 已经保证至少一个为数组，所以这里**必然**在"一个是数组一个不是"时返回 false | 逻辑冗余，**不是 bug** |

**D9a 是唯一的真缺陷**：

```ts
/* activity-model.ts:208-209 */
if (team.tasks.length === 0) return { working: 0, detail: '' }
return { working: 0, detail: '' }
```

**读数**：
```bash
grep -n -A2 'team.tasks.length === 0' src/client/activity-model.ts
```
⇒ 两条 `return` 字面相同。第一个 `if` 因此**是死的**（无论真假都得到同一结果）。

**为什么值得记**：这正是 `T30-LAYOUT-FINDING.md` 那族形态的最小实例 —— **一条读起来在做判定的分支，其两个出口完全同形**。它不会报错，也不会被发现，只会让下一个读者以为"没有任务时"有特殊处理。

**反向半边**：删掉 `if` 分支后行为不变（可断言）；或两个分支给出**不同**的值（那就说明意图存在，只是实现漏了）。

---

### D10 — 测试靠"源文件文本切片"判 client 契约：18 处读取 / 30 处 `includes`

**症状**：`scripts/workspace-activity.test.mjs` 通过**读取 `.tsx`/`.css` 源文本并做字符串匹配**来验证 client 行为，而不是通过渲染或导入。这**直接约束**了本次重构能怎么搬代码。

**读数**：
```bash
grep -c 'readSource(' scripts/workspace-activity.test.mjs      # → 14   （readSource 是 readFile 的别名，见 :1314）
grep -c 'readFile(new URL' scripts/workspace-activity.test.mjs # →  4
grep -c 'includes(' scripts/workspace-activity.test.mjs        # → 30
grep -c 'CLIENT_ROOT' scripts/workspace-activity.test.mjs      # → 15
```
⇒ **18 处源文本读取**（14 + 4），配 **30 处 `includes(...)` 断言**。别名定义在 `:1314`（`const { readFile: readSource, readdir: readDirNames } = await import('node:fs/promises')`），根路径在 `:1317`（`CLIENT_ROOT = new URL('../src/client/', …)`）。

**位置（代表性例子）**：
- `:1231` —— `readFile('../src/client/ActivityPanel.module.css')` 然后 `indexOf('.memberModel {')` 加 `slice` 到下一个 `}`，断言这个块里"没有 `border-radius` / `border:` / `background:`"。
- `:1281`、`:1654`、`:1713`、`:1771` —— 读 `ActivityPanel.tsx` 文本，断言某些**字符串不存在**（例如 `:1713` 断言 `panel.includes('data-member-model') === false`）。
- `:1743` —— 读 CSS 源断言 `border-radius: 999px` **存在**（作为反向半边）。

**为什么这是缺陷**：`:1231` 那条断言对 `.memberModel {` 做 `indexOf` —— ⇒ **把类名挪到另一行、或把它并进一个逗号选择器列表（正是 D1 里 `memberState` 的处境），都会让 `indexOf` 返回 `-1`**，于是 `assert.notEqual(start,-1,'★ 前置：…')` 报红，而**样式本身完全没坏**。这个仓库自己已经把这个教训写在 `:1254-1266`（"读不到"与"它违反了"必须不同形）—— 那一处是 R2 修好的，但**同类耦合还剩 18 处读取 / 30 处断言**。

**⇒ 这是重构方案的第一约束**：任何"把 CSS 类改名/合并选择器/把 jsx 挪文件"的动作都必须**同步**改这些断言，否则 `pnpm verify` 会以"看起来像样式坏了"的方式报红 —— 而那正是 `T30-LAYOUT-FINDING.md` §⑪ 警告过的"看起来合理的错数字"在测试层的对应物。

**反向半边**：把 `:1231` 从"CSS 文本 slice"改成"读编译后的样式表 + 一条真实断言"（`:1823-1829` 已经有一个 `extractActivityPanelCss` 的辅助函数可以做这件事），则同类断言的**位置无关性**得到保证。

---

### D11 — `ActivityPanel.tsx` 的 9 个 effect 里有 3 个 `useLayoutEffect`（承重，重构时必须显式安排）

**症状**：见 D5。此处单列是因为它有**独立读数**，且它**约束拆分的顺序**：

```bash
grep -n 'useEffect(\|useLayoutEffect(' src/client/ActivityPanel.tsx | wc -l   # → 9
```

**位置**：`ActivityPanel.tsx:424,434,442,484,501,517,541,599,670`。
其中 `:442/484/501` 是 `useLayoutEffect` —— 布局同步 effect，意味着这三处**在浏览器绘制前**改 DOM。`T30-LAYOUT-FINDING.md` §⑨ 已经证明这个面板的布局**确实是活的**（宽 ≥1000px 时 `display:grid`、`gridTemplateColumns` 有两个不同值），所以这些 `useLayoutEffect` 是承重的，不是装饰。

**为什么单列**：任何"把面板拆成多个组件"的重构都必须先回答"这三个 layout effect 归谁"。**它们不能跟着随便一个子组件走。**

**反向半边**：每个 `useLayoutEffect` 都能指出它同步的**具体** DOM 事实（记在 `panel-geometry.ts` 的哪条函数上）。

---

## 4. 分层重构方案

分层原则：**L0/L1 是零行为变更的纯搬运**（可以用集合比对验证）；**L2 起会改行为**（必须用测试或渲染验证）；**L3 是结构性重构**（会动到 D10 的文本断言）。每层标出**验证条件**。

---

### L0 — 零行为变更的纯删除（收益中 / 风险最低）

| # | 动作 | 依据 | 验证 |
|---|---|---|---|
| L0.1 | 删 6 个死 CSS 类（D1），**逐选择器删**，不整块删 | D1 清单 | 重跑 D1 脚本 ⇒ `[]`；`grep -c` ⇒ 0 |
| L0.2 | 删 `data-selected-member` 那条属性规则（`:2020`）—— 或改为真的设置这个属性（二选一，不许留着"读起来像在管事"的规则） | §2.2 | 同上脚本 |
| L0.3 | 删 39 条死文案（D8），**zh 与 en 各删一次**（78 处条目） | §2.5 | 语料扫描 ⇒ 只剩 `member.state.notCreated`；`pnpm verify` 仍绿 |
| L0.4 | 删 `activity-model.ts:208-209` 的死 `if` | D9a | 单元测试：无任务的队返回值不变 |
| L0.5 | 删 D2 **表 A 的 11 组**里**前者**那一条声明（后者无条件覆盖它），保留后一份 | D2 表 A | 逐条：删前删后同一选择器的**最终声明值**相同（该值可直接从两份声明的文本读出，无需浏览器） |

**L0 的纪律**：L0.5 是 L0 里唯一需要小心的一条 —— **只删 D2 表 A 那 11 组的前者**，而不是"重复即删"。§2.1.2 的三分表已经示范了为什么：44 组里 32 组是混合（多数是 `@media (prefers-reduced-motion)` 的**正确**写法），1 组全在 at-rule 内。**按"重复即删"会删掉 reduced-motion 支持。**

**L0 不需要重新构建就能验证的**：L0.1–L0.4（纯文本读取 + 单元测试）。**L0.5 建议也跑一次构建**，因为它改的是 CSS 产物。

---

### L1 — 零行为变更的纯搬运（收益高 / 风险低）

**★ 前置纪律**（这个仓库自己要求"拆分的集合比对"，见 `T30-LAYOUT-FINDING.md` §⑦ 第 1 条）：每一次搬运都要**两边集合相等**的证明 —— 对着搬之前的定义列表和搬之后的定义列表做 diff，而不是"改完跑测试绿了"。

| # | 动作 | 依据 | 为什么是纯搬运 |
|---|---|---|---|
| L1.1 | 把 `ActivityPanel.module.css` 的 684 行附录**按选择器归属**切进各组件自己的 `.module.css` | D3 | CSS Modules 的类名是**每个文件独立哈希**的 ⇒ 跨文件复用同一个类名本来就不成立；附录里那些 `.team[data-workspace-team] .xxx` 需要连同它的作用域一起搬 |
| L1.2 | 把 `ActivityPanel.tsx` 里 `TeamSection`（`:154` 起）拆进 `TeamSection.tsx` | D5 | 它已经是一个独立组件，4 个 state 自持 |
| L1.3 | 把 `ActivityPanel` 的浮窗几何（`layout`/`bounds`/`interaction` 三个 state + 4 个 effect）拆进一个自持的 hook/组件，**`panel-geometry.ts` 已经是它的纯函数半边** | D5/D11 | `panel-geometry.ts`（194 行）已经把所有几何运算抽成纯函数 ⇒ 剩下的是 state 编排 |
| L1.4 | 把 `MemberRow` 的第三类 props 改为内部派生（D7） | D7 | `memberClock`/`memberRound`/`memberSubagentReadout` 已经在内部算了 —— 只是把另外 4 个也拿进来 |
| L1.5 | `StagingPlanEditor.tsx` 里 6 个内部组件各自成文件 | D6 | 它们已经是独立函数组件 |

**L1 的硬约束（**这一条最容易被忽略**）**：**D10 的 18 处源文本读取 / 30 处 `includes` 断言**。凡是动到 `ActivityPanel.tsx` / `ActivityPanel.module.css` / `MemberRow.tsx` / `MemberScreen.tsx` 的**类名或字符串**的搬运，都必须同步更新：
- `scripts/workspace-activity.test.mjs:1231`（`.memberModel {` 的 `indexOf`）
- `:1281, :1654, :1713, :1771`（`ActivityPanel.tsx` 文本断言）
- `:1743`（`border-radius: 999px` 的反向半边）
- `scripts/verify.mjs:224, :307-308, :488, :496`（locales 文本断言）

⇒ **建议把 L1 之前先做一件事**：把 D10 里那类"按文件名找字符串"的断言改成"按语义找"（`:1823-1829` 已有 `extractActivityPanelCss` 可以复用）。**这不是重构本身，而是让重构可以被验证的前提。**

---

### L2 — 会改行为（收益高 / 风险中）

| # | 动作 | 改动点 | 必须验证什么 |
|---|---|---|---|
| L2.1 | 去掉 D4 的唯一 `!important` | `:2016` | 宽 ≥1000px 且存在 `[data-staging-editor]` 时，`.delegationSection` 与 `.dependencySection` 的列位**不变** |
| L2.2 | 把 D3 的 533 行"两套皮肤"裸补丁层改成一个真正的 `workspace` 作用域（例如把前缀重写换成容器查询或一个 wrapper 类） | `:1920-2456` 的裸区 | 侧边栏路径（`WorkspaceActivity → TeamSection`）与浮窗路径（`shell.overlay`）在**同一个宽度下**的读数一致 |
| L2.3 | `StagedMemberEditor`（9）与 `StagedTaskEditor`（9）各把平铺 state 收敛成一个受控 draft（D6） | `:371` / `:497` | 表单的**全部**交互臂（6 个子组件）逐条绿 |
| L2.4 | `ActivityPanel` 的 8 个 state 继续外移 | D5/D11 | **三个 `useLayoutEffect`（`:442/484/501`）的归属必须显式回答**，见 D11 |

（D3 的 533 行裸补丁层由 **L2.2** 一并处理 —— 它就是"没有作用域的 workspace 皮肤"，不是独立的第五条。）

**★ L2.2 特别提示**：`T30-LAYOUT-FINDING.md` §⑨ 明确说"两块内容挤在一个容器里"**在行距上是无辜的**，拆分依然是对的，但**不要把行距缺陷归到它头上**。L2.2 要处理的是**结构**（谁拥有这两列），不是行距。

---

### L3 — 需要重新构建 client bundle 才能验证的改动

**为什么必须重建**：client 的产物是 `lib/client.js`，它由 `tsdown` 用 **lightningcss** 编译 CSS Modules，类名被哈希（`_8qZE2a_*` 形态）。⇒ **任何 CSS 或 TSX 的改动都不会在 `src/` 层面可见，只会出现在产物里**。

`tsdown.config.ts` 的相关事实（已读）：
- CJS closure-factory 产物，`window.__ModuleLoader__.load({ id, factory })`；
- CSS Modules 由 lightningcss 编译成**哈希类名**，CSS 文本**自动注入一个 `<style data-plugin>`**；
- `PLUGIN_ID` 从 `package.json` 的 `name` 读取（不是写死的）；
- **除平台 seed 之外的 `@deepseek-ai` 值导入是构建错误**（purity gate）。

**构建命令**：`pnpm build`（= `clean-build clear` → `tsc -p tsconfig.json` → `tsc -p tsconfig.client.json` → `clean-build publish` → `tsdown` → `git-artifacts --write`）。

**哪些层需要重建**：

| 层 | 需要 `pnpm build`？ | 说明 |
|---|---|---|
| L0.1–L0.4 | **否** | 纯删除，`pnpm verify` + 单元测试即可 |
| L0.5 | **是** | 改的是 CSS 产物 |
| L1.1（CSS 拆分） | **是** — **而且是这里最危险的** | 类名哈希**按文件路径**计算（`T30-LAYOUT-FINDING.md` §⑪ 实测） |
| L1.2–L1.5 | **是** | 改 TSX 模块边界 |
| L2.1–L2.5 | **是** | 全部 |

**★ 一条必须写进重构纪律的读数**（`T30-LAYOUT-FINDING.md` §⑪，原样保留其重要性）：lightningcss 的哈希前缀**按文件的绝对路径**算 —— 换一个 worktree 重建，前缀就从 `_8qZE2a_` 变成 `EpOeea`。任何**硬编码**这个前缀的验证脚本会得到一个"**看起来很合理的错数字**"（当时是 21px），而不是一个报错。⇒ **前缀必须从样式表里现推**（`/\.([A-Za-z0-9_-]+)_memberRow\b/`）。

顺带：**L1.1（CSS 拆分）会改变哈希前缀本身**（因为文件路径变了）。所以 L1.1 之后，任何依赖旧前缀的东西都会静默失效 —— 这是 L1.1 应当排在靠后的理由。

---

### 建议的执行顺序与理由

```
① D10 的测试解耦（改测试，不改 src）
      └─ 理由：不做这一步，后面每一步的验证都在"按文件名找字符串"，会把真缺陷和搬迁混在一起红

② L0.1 – L0.4（纯删除，零风险，立即缩小表面积）
      └─ 收益：-6 个死 CSS 类 / -1 条死属性规则 / -78 处文案条目（39 key × zh+en）/ -1 个死分支
         （注：-11 条无条件死声明属于 L0.5，也在此步，但它改 CSS 产物 ⇒ 需重建）

③ L1.1（CSS 附录拆分）+ 重建 + 按上面前缀纪律验证
      └─ 理由：684 行里 533 行是裸补丁层，它是 D2/D3/D4 的共同温床；
         先把它归位，后面三条缺陷会自己暴露成"更小的、可判定的"问题

④ L2.1（去 !important）→ L2.2（作用域化）
      └─ 理由：③ 之后这两条各自只剩一个明确的判据

⑤ L1.2 – L1.5（TSX 拆分，逐组件搬，每次集合比对）
      └─ 理由：改 TSX 比改 CSS 更容易被类型检查兜住，风险低于 ③

⑥ L2.3 / L2.4（state 模型）
      └─ 理由：唯一"验证手段不纯机械"的两条（D5 的渲染次数、D11 的 layout effect 归属），
         放在最后，且必须先把验证手段建起来
```

**★ 全程不做的事**：
- **不测像素**（`T30-LAYOUT-FINDING.md` 整篇的理由）。
- **不把 `data-has-model` 再当缺陷**（t36 已删，见 §2.2）。
- **不碰 `.agent-teams/worktrees/**`**。
- **不把 §2.1.2 的 44 组覆盖整体当缺陷数**（其中仅 11 组是无条件死声明；32 组里多数是 reduced-motion 与窄态覆盖）。

---

## 5. 本文档没有回答的问题（如实留在这里）

按 `T30-LAYOUT-FINDING.md` §⑤/§⑨b 的纪律，**没量到的不写成结论**：

1. **"面板放大和截断"到底是不是真的**：用户最初的投诉（`T30-LAYOUT-FINDING.md` §①）里，"放大"已被证伪（是 Retina 折半错误），"行距 320px" 已被证伪（§⑨b）。**"截断"这一半本文档没有给读数** —— 而且要给出它，需要真实浏览器里的 computed style，那正是 §⑤ 点名要补的读数。**本文档全程没开浏览器。**
2. **D5 的"整棵面板树重渲染"**：本文档给的是 `useState` 计数（8/12）与 effect 计数（9），**不是**渲染次数。渲染次数需要 React Profiler 或渲染计数器。
3. **D2 表 A 在真实级联下的最终值**：本文档按"同优先级取后出现者"推断，**没有**用浏览器确认。要彻底证伪，仍需一次 computed style 读数 —— 但**不需要像素测量**，`getComputedStyle(el).gridTemplateColumns` 就够了。
4. **D2 表 A 那 11 组之外的覆盖是否也别有用心**：本文档用"在不在 at-rule 里"把 44 组分成 11/32/1，**判据是机械的、排他的** —— 但它回答的是"前者会不会被无条件覆盖"，**不回答**"那条被覆盖的声明是不是曾经想表达别的意思"。例如 `.planNewTask { align-items }` 在 1528、1633 各一次（**两次都在 at-rule 之外**）⇒ 1528 是死的，但**为什么**会有两条，本文档没查（需要 `git log -L`）。
5. **附录 684 行的历史**：本文档没有用 `git log` 追这 533 行裸区是**哪几次提交**堆上去的。这会影响 L2.2 的拆法（一次堆积 vs 多次补丁，处置不同）。
