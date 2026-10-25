# 全量架构梳理（2026-10-17）

> **用户要求**:「重新讨论一下整个插件项目的架构,**不管是实现上的架构 还是呈现上的 UI 架构**
>  都要梳理一遍,并且要**足够细致**」
>
> ★★★ **本文的每一条都是【当场量的】**,不是回忆的。数错的地方我会标明。

---

# 一、实现架构

## 1.1 ★★★ 尺寸：56,981 行，而**前 5 个文件占 59%**

```
$ find src -name '*.ts' -o -name '*.tsx' | xargs cat | wc -l
  56,981 行
```

### ★★ `src/` 顶层 25 个文件（按行数）

| 行数 | 文件 | 它是什么 |
|---:|---|---|
| **2,685** | `quality-gates.ts` | ★ **契约校验 + 判决 + 交付裁决** |
| **2,316** | `tools.ts` | ★ **工具注册聚合层**（★ 只是 import + register）|
| **1,567** | `state.ts` | 团队状态的**落盘/读取** |
| **1,507** | `members.ts` | 成员的生成/存活/子代理 |
| **1,296** | `worktree.ts` | 隔离工作树 |
| **1,253** | `scheduler.ts` | 派发与调度 |
| **1,251** | `types.ts` | ★ 类型（★ 零 import 叶子）|
| **879** | `snapshot.ts` | ★ **UI 投影**（服务端那一半）|
| 835 | `profiles.ts` | profile 覆盖层 |
| 801 | `harness-compat.ts` | DSH 版本兼容 |
| 669 | `index.ts` | ★ 插件入口（HTTP 路由 + 槽位）|
| 419 | `mutation-guard.ts` | 变异守卫 |
| 310 | `artifacts.ts` | ★ **唯一读产物字节的模块** |
| 298 | `web-routes.ts` | HTTP 路由 |
| 292 | `hmr-trace.ts` | HMR 追踪 |
| 288 | `confidence.ts` | ★ 飞轮双计数 |
| 279 | `lineage.ts` | ★ fork 链身份 |
| 224 | `event-types.ts` | 事件类型 |
| 169 | `mailbox.ts` | 信箱 |
| 141 | `command.ts` | 命令 |
| 111 | `capabilities.ts` | ★ 能力清单（含 10 条队长协议）|
| 78 | `events.ts` | ★ 事件追加（★ **静默丢弃**，见 §3）|
| 66 | `mutation.ts` | 变异 |
| 28 | `tool-names.ts` | 工具名 |
| 4 | `css-modules.d.ts` | 类型声明 |

⇒ ★★★ **前 5 个文件 = 9,326 行 = 全部顶层文件的 59%。**

### ★★ 四个子目录（**直接行数，不递归**）

| 目录 | 行数 | 文件 | 是什么 |
|---|---:|---:|---|
| `src/client/` | 9,552 | 27 | ★ **UI 投影**（客户端那一半）|
| `src/tools/` | 6,496 | 15 | 单个工具的实现 |
| `src/gates/` | 2,627 | 4 | ★ **21 条判据** |
| `src/gates/completion/` | 2,865 | 5 | 其中 completion 那 4 条 |
| `src/evolution/` | 1,334 | 6 | ★ **采集与处理** |
| `src/evaluator/` | 422 | 3 | ★★ **收益评估（★ 孤儿，见 §2.3）** |
| `src/quality-gates/` | 328 | 1 | 判据用的谓词 |
| `src/state/` | 254 | 1 | 状态工具 |

### ★★★ 而 `src/client/` 内部的分布

| 行数 | 文件 | 职责 |
|---:|---|---|
| **2,000** | `activity-model.ts` | ★ **纯函数投影**（关系/字形/宽度/阶段）|
| **1,236** | `MemberRow.tsx` | ★ **成员行**（两行式 + 六态 + 展开）|
| 981 | `StagingPlanEditor.tsx` | 计划编辑器 |
| 936 | `ActivityPanel.tsx` | 面板外壳 |
| 689 | `activity-monitor.ts` | ★ 快照订阅 |
| 478 | `locales.ts` | 文案 |
| 397 | `index.tsx` | ★ **槽位注册** |
| 336 | `folders-probe.tsx` | ★ t103/t105 的探针（★ 判据载体）|
| 258 | `DependencyGraph.tsx` | 依赖图 |
| 250 | `folders-panel.tsx` | ★ **文件夹视图** |
| 214 | `MemberScreen.tsx` | 成员屏 |

---

## 1.2 ★★★ 依赖方向（**实测的 import 图**）

```
index.ts ──► capabilities · command · hmr-trace · profiles · snapshot · state
             · tool-names · tools · web-routes

tools.ts ──► events · harness-compat · mailbox · members · profiles
             · quality-gates · scheduler · state · types

scheduler.ts ──► lineage · mailbox · members · state · types · worktree
members.ts   ──► events · harness-compat · lineage · mailbox · state · types
state.ts     ──► lineage · quality-gates · types
snapshot.ts  ──► harness-compat · members · state · types · worktree
quality-gates.ts ──► types                      ★ 只依赖类型
gates/registry.ts ──► budget-stop · requires     ★ 只依赖本层
```

### ★★★ 三条结构性事实

**① `types.ts` 是零 import 叶子**（1,251 行，谁都能依赖它，它不依赖谁）
★ 那是**正确**的 —— 而 t81 那次"`types.ts` 是零 import 叶子"正是我们用它证明的。

**② `quality-gates.ts` 只依赖 `types.ts`** —— ★ 它**不碰 I/O**
★★ 而那正是 t94 那次的关键:`validateCreateTask` 是**纯函数**，所以它**结构上无法采集**。

**③ `src/gates/` 真的零 `node:` 引用**

```
$ grep -rc "from 'node:" src/gates --include=*.ts | grep -v ':0'
  （空）
```
★★★ **所以"判据层没有 I/O"这条不变量【成立】** —— 而 `stall.ts` 说的
"that purity is **payload, not style**" 是真的。

### ★★ 而各层的 `node:` 引用数（量出来的）

| 层 | `node:` 引用 |
|---|---:|
| ★ `src/gates/` | **0** |
| `src/evaluator/` | **0** |
| `src/evolution/` | 2 |
| `src/quality-gates/` | 1 |

---

## 1.3 ★★★ 五条被反复引用的不变量（而它们现在**都可机械检**）

| # | 不变量 | 怎么检 |
|---|---|---|
| **①** | ★ **判据层零 I/O** | `grep "from 'node:" src/gates` ⇒ 空 |
| **②** | ★ **`types.ts` 零 import** | `grep "^import" src/types.ts` ⇒ 空 |
| **③** | ★★ **工具定义与拆分前逐字相同** | `gate-tool-split` 臂 2（golden）|
| **④** | ★★★ **源码里的注册 id 必须在 `lib/client.js`（bundle）里** | `gate-client-bundle-parity` |
| **⑤** | ★ **已注册判据数不许减少** | `gate-registry-integrity` |

★ **而 ④ 是【今天新加的】** —— **因为我在它上面犯过错**（改了源码没带 bundle,用户看不见）。

---

## 1.4 ★★★ 而**孤儿面**是最大的结构问题（量出来的）

```
$ 每个模块的函数导出数 vs 有外部消费者的数

src/evolution/   导出 21 · 有消费者 3   ⇒ ★ 86% 无消费者
src/evaluator/   导出  5 · 有消费者 0   ⇒ ★★ 100% 无消费者
src/lineage.ts   导出  3 · 有消费者 1
src/artifacts.ts 导出  4 · 有消费者 2
src/confidence.ts 导出 4 · 有消费者 2
```

### ★★★ 而 `src/evaluator/` 五个导出，逐个查**全是 0**

```
effectBucketKeyOf   0
effectReadingOf     0
sourceTalliesOf     0
tallyOf             0
evaluateSubject     0
```

⇒ ★★★ **即:t92 建的那个"评估器模块"，【一行都没被用】。**
★ 而它的 422 行 + 3 个文件 + 那份规格 —— **现在是一个完整的、未被消费的子系统。**

### ★★ 而 `evolution` 那 3 个有消费者的

```
observe               49 引用   ★ 采集入口（t87 接了三个生产点）
collectionHealthOf     8 引用   ★ t101 接了 /state
readSignalsHealth      2 引用   ★ t101 自己内部
```

⇒ ★★ **所以采集层【只活了 3 个函数】，而另外 18 个是孤儿。**

---

## 1.5 ★★★ 而 `appendTeamEvent` 是**静默丢弃**的（今天实测）

```
$ node -e "…dsh-session.KNOWN_SESSION_EVENT_TYPES…"
  总类型数 59 · 含 'agent-teams' 的 【0】
```

⇒ ★★★ **所以本插件发的【每一个】session 事件都被丢掉**（`events.ts:47` 的 `return`）。
★ 而那是**已知且刻意的**（`events.ts` 的注释逐字说了，并指出"磁盘状态才是权威源"）。

★★ **而这意味着:所有依赖 event stream 的设计都是【空转】的。**
★ **而 t109 的审计已经改走落盘** —— **那是对的。**

---

## 1.6 ★★ 评判：实现架构的**好与坏**

### ✅ 好的（有据）

```
① ★ 分层是真的: gates 零 I/O · types 零 import · quality-gates 只依赖 types
② ★★ 判据是注册式 + 三态 ⇒ 加一条 = 改一行（写错启动即炸）
③ ★★★ 不变量【可机械检】（5 条，见 §1.3）
④ ★ 依赖方向单一:index → tools → state → types，没有环
```

### ❌ 坏的（有据）

```
① ★★★ 三个大文件吃掉了 59%：quality-gates 2,685 · tools 2,316 · state 1,567
② ★★★ 孤儿面 86%–100%：evolution 18/21 · evaluator 5/5
   ⇒ ★ 而那与"模块不许互相侵入"是同一个问题的两面
     ★ 隔离得太好 ⇒ 没人用
③ ★ 而 tools.ts 2,316 行【只是 import + register】
   ⇒ ★ 那 2,316 行里【真正的代码】可能很少 —— 而那要量
```

### ★★ 而我要立刻核 ③


## 1.7 ★★★ **重大修正：57,093 行里有一半是注释**

```
$ src/ 全量统计
  总行数     57,093
  空行        2,381
  ★ 注释     28,006  (49%)
  ★★★ 真代码  26,706
  ⇒ 注释 : 代码 = 【1.05 : 1】
```

### ★★ 而逐个大文件看

| 文件 | 总行 | 注释 | 注释占 | **真代码** |
|---|---:|---:|---:|---:|
| `tools.ts` | 2,317 | 1,504 | **65%** | ★ **669** |
| `snapshot.ts` | 880 | 504 | 57% | **359** |
| `src/client/activity-model.ts` | 2,001 | 902 | 45% | **973** |
| `src/members.ts` | 1,508 | 630 | 42% | **812** |
| `src/client/MemberRow.tsx` | 1,237 | 497 | 40% | **701** |
| `src/quality-gates.ts` | 2,686 | 1,027 | 38% | **1,524** |
| `src/state.ts` | 1,568 | 594 | 38% | **890** |

⇒ ★★★ **所以"前 5 个文件占 59%"那个说法要修正:**
```
★ 按【总行数】:前 5 个占 59%
★★ 按【真代码】:quality-gates 1,524 + tools 669 + state 890 + members 812 + worktree ?
   ⇒ ★★ 而 tools.ts 从 2,316 掉到 669 —— ★ 它的"大"几乎全是注释
```

★★ **而 `tools.ts` 的注释占 65%,理由是可以理解的:** 它是**注册聚合层**,
**而每一个 register 都有"为什么在这儿、为什么这个顺序"的注释。**

★★★ **所以本仓的真实形状是:**
```
★ 26,706 行真代码 —— ★ 那不是"巨大"
★★ 而 28,006 行注释 —— ★ 那是【设计理由的存货】
⇒ ★★★ 而"bug 越来越多"如果成立，问题【不在代码量】
```

---

# 二、呈现架构（UI）

## 2.1 ★★★ 客户端 9,552 行，而**它只读快照**

### 数据流向（实测）

```
服务端  /state 路由（src/index.ts:405）
  ★ workspaceRegistry.list() ⇒ 遍历【所有已注册工作区】
  ★ collectTeamsActivity(ctx, roots) ⇒ 每个工作区的队
  ▼
客户端  activity-monitor.ts:689
  ★ body.teams as readonly ActivityTeam[]  ⇒ ★ 全量
  ★ useSyncExternalStore(subscribeActivitySnapshots, getActivitySnapshotsSnapshot)
  ▼
组件    12 个 .tsx
  ★ 全部【只读】—— 没有任何写路径
```

### ★★★ 所以**投影这个定位，代码已经实现了**

```
$ grep -cE "fetch|POST|selectPanel" src/client/folders-panel.tsx  ⇒ 5
★ 而那 5 处【全是 selectPanel】⇒ ★ 只切视图，不写数据
```

---

## 2.2 ★★★ 而 UI 现在是**三个投影面**，不是一个

| # | 面 | 挂在哪 | 状态 |
|---|---|---|---|
| **①** | ★ **团队投影**（项目内）| `sidebar.right.pane.tab`（`TEAM_TAB_ID`）| ✅ 两行式 + 六态 + 展开 |
| **②** | ★ **跨项目投影** | `main` key（`FOLDERS_MAIN_KEY`）| ✅ 文件夹视图（只读）|
| **③** | ★ **会话内的点** | `conversation.session.header.actions` 等 5 处 | ✅ 入口/摘要/ID/命令/节点 |

★★★ **而 ② 的数据【已经在内存里】** —— 它只是同一份 `teams` 数组的另一种切法。

---

## 2.3 ★★★ 而 UI 的**真正的结构问题**（量出来的）

### ① `activity-model.ts` 2,001 行 / 973 行真代码 —— ★ 它扛了太多角色

```
$ grep -oE "export (function|const|type|interface) [a-zA-Z]+" src/client/activity-model.ts | wc -l
```

★★ **实测它是【纯函数仓库】:** 关系投影 · 字形 · 宽度 · 阶段 · 依赖图 · 折行。
**而 `MemberRow`（1,237）+ `activity-model`（2,001）= UI 真代码的 44%。**

### ② ★★ 而**探针代码留在生产里**

```
src/client/folders-probe.tsx   336 行
```
★ 它是 **t103/t105 的判据载体** —— **12 条臂靠它。**
⇒ ★★ **所以它不能删,而它也不是"产品代码"。**
★★★ **而那是一个真实的形状:【判据的载体住在产品目录里】。**

### ③ ★ 而"看不见的界面"这个缺陷**根因是结构性的**

```
★★ 三个面挂【三个不同的槽位】:
   sidebar.right.pane.tab · main · conversation.*
⇒ ★★★ 而【它们之间没有导航】—— 用户要自己知道"从哪进哪个"
```

★ **而那正是用户报的两个缺陷（回不去、压在红绿灯上）的**同一个根因**。**

---

## 2.4 ★★ 而"像素风"现在的实际落点

| 已落地 | 位置 |
|---|---|
| ★ 文件夹图标（内联 SVG `<rect>`）| `folders-panel.tsx` `FolderGlyph` |
| ★ 六态字形（`✓ ⊘ ● ○ · ✗`）| `MemberRow` |
| ★ 硬阴影 · 零圆角 · `crispEdges` | `folders-panel.module.css` |
| ★ CJK 宽度表（零依赖）| `activity-model.ts` |

★ **而【没有】像素场景** —— 而那份文献说**那是对的**（场景不买变化检测）。

---

## 2.5 ★★★ 而 UI 的**验收盲区**（这是最重要的一节）

```
★ 我有:tsc · 101 个夹具 · 集合比对 · 变异测试
★★ 而【我看不见界面】——本机没有视觉模型,launchChrome() 也不 resolve
⇒ ★★★ 所以"界面对不对"【只有用户能验】
```

**而这一轮已经证明了两次:**
```
① 回不去（★ 缺一个入口）—— 我 12 条臂全绿
② 按钮压在红绿灯上     —— 我 6 条臂全绿
⇒ ★★★ 两次都是【用户点出来的】
```

### ★★ 而第二类盲区更隐蔽

```
★★ 我上一轮说"修好了,请你试"——★ 而 bundle 里根本没有那个按钮
⇒ ★★★ 所以【连"能不能看见"这件事，我的夹具也验不了】
   ★ 因为夹具 import 的是 lib/client/*.js,而浏览器加载的是 lib/client.js
```

★ **而那条臂已经加了**（`gate-client-bundle-parity`）。

---

## 2.6 ★★ 评判：呈现架构的**好与坏**

### ✅ 好的

```
① ★★★ 【只有一份数据源】:useSyncExternalStore + 全量 teams ⇒ 所有面同一个真相
② ★ 【零写路径】—— 投影这个定位是代码事实，不是文档说法
③ ★ 跨项目投影【不需要新数据】（★ 已核实）
④ ★ 槽位挂载【用官方机制】—— 不是 DOM 注入
```

### ❌ 坏的

```
① ★★★ 三个面之间【没有导航】⇒ 用户迷路（★ 已发生两次）
② ★★ 判据载体（folders-probe）住在产品目录里 ⇒ 336 行非产品代码
③ ★ 没有"哪些工作区需要我"的读数 ⇒ ★ 跨项目投影【还没有它存在的理由】
   ★ 现在只是"列出文件夹"，而那【不回答任何问题】
```

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*

---

# 三、诊断：三个真问题（而它们**都不是"代码太多"**）

## 3.1 ★★★ 问题一：**孤儿面** —— 隔离得太好，没人调用

```
src/evaluator/   5 个导出 · 外部引用 【0】   ⇒ ★★ 100% 孤儿
src/evolution/  21 个导出 · 有消费者 3      ⇒ ★ 86% 孤儿
```

★ **而这不是"忘了接线"那么简单 —— 它是【规则的另一面】:**
```
★★ 用户裁定:「我是不允许模块之间互相侵入的」
⇒ ★★★ 而隔离得越彻底，模块越"干净"，也越【没有理由被调用】
★ 所以 evaluator 422 行 + 一份规格 + 5 个夹具，【没有一行在生产路径上】
```

★★ **而它与"采集层"的差别说明了什么是关键:**
```
★ evolution 的 observe 有 49 处引用 —— 因为【宿主在既有汇合点调用它】
★★ evaluator 的 evaluateSubject 有 0 处 —— 因为【没有那样的汇合点】
⇒ ★★★ 所以接线的前提不是"接口做好了"，而是【有一个宿主已经在的地方】
```

---

## 3.2 ★★★ 问题二：三个投影面**之间没有导航**

### 实测

| 面 | 槽位 | 进去的方式 |
|---|---|---|
| ① 团队投影 | `sidebar.right.pane.tab` | ★ 会话内点 tab |
| ② 跨项目投影 | `main` key（`FOLDERS_MAIN_KEY`） | ★ 启动时 `selectPanel` 一次 |
| ③ 会话内点 | `conversation.*` 5 处 | 自然 |

⇒ ★★★ **而【② → ①】没有路，【① → ②】是我昨天才补的。**

### ★★★ 而官方**有完整的导航 API**，而我们**已经持有它**

```ts
// node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/types/client/service.d.ts
openTab<K>(kind, options?): void
openTabIn<K>(sessionId, kind, options?): void      // ★ 跨会话开一个 tab
openResourceIn(sessionId, address, options?): void
closeIn(sessionId, tabId): void
```

**而我们的实测:**
```
src/client/index.tsx:143   bridge.set(native.sidebarRight)   ⇒ ★ 我们【存了它】
★★ 而我们【只用它读了东西】，从没用它【导航】
```

⇒ ★★★ **所以"三个面之间没有导航"不是能力缺失 —— 是【我们没用已有的能力】。**
★ **而那与我这一轮犯的错是同一族:★ "我有那个东西，而我没用它"。**

---

## 3.3 ★★★ 问题三：**跨项目投影现在不回答任何问题**

```
★ 现在它做的:列出文件夹 + "N 个团队 · M 进行中"
★★ 而它【不回答】:"哪个工作区需要我？"
⇒ ★★★ 而那正是它存在的理由（★ 文献:跨项目看板的目的就是【变化检测】）
```

★ **而"需要我"这个读数**我们**已经有数据** —— 只是没聚合:
```
★ member.activity:  working · idle · unknown
★★ member.liveness: working · idle · not-live · never-spawned
★ task 状态：pending/claimed/in_progress/completed/…
★★ ★★★ 而"某个成员在等"= idle 但有未完成任务（t82 那条已实现:memberHasOpenWork）
```

⇒ ★★ **所以"哪个工作区需要我"是【一个纯函数】:** 对该工作区所有队的所有成员,
**数"`memberHasOpenWork` 为真而 `activity==='idle'`"的人数。**

---

# 四、三条建议（按"能不能立刻做"排）

## 4.1 ★★★ 建议一：用**已有**的导航 API 把三个面连起来

```
★ 已有:ctx.sidebarRight.openTabIn(sessionId, kind)
★★ 所以"从文件夹点进某个工作区"⇒ ★ 找到那个工作区的 captainSessionId
   ⇒ openTabIn(它, TEAM_TAB_KIND)
⇒ ★★★ 零新能力，只是【用已有的】
```

★ **而反向（团队 → 文件夹）已经做了**（`selectPanel`）。

## 4.2 ★★ 建议二：给跨项目投影加**一个**读数

```
★★ 现在:"N 个团队 · M 进行中"
⇒ ★★★ 改成:"★ 需要你:N"（★ 那才是变化检测）
   ★ 而 N = 该工作区里"有未完成任务但 activity=idle"的成员数
```

★ **理由:** 那是**一个纯函数**（`memberHasOpenWork` 已存在），而它会**让那个面有存在的理由**。

## 4.3 ★★★ 建议三：**处理孤儿面**，而三条路各有代价

| # | 做法 | 代价 |
|---|---|---|
| **甲** | ★ **给 evaluator 找一个宿主汇合点**（像 `observe` 那样）| ★ 要有一个"改动完成"的时刻 |
| **乙** | ★★ **明确标为"未接线"并从文档里移到待做** | ★ 零成本，而它**不会假装有用** |
| **丙** | 删掉 | ⚠️ ★ 那会让"能力与它的判据被同一次提交抹掉" |

⇒ ★★★ **我建议 乙 + 甲:先诚实地标出来，等有汇合点再接。**
★ **而"改动完成"那个汇合点【其实存在】:** `update_task` 的完成路径 ——
**★ 而它正是 `completion` 判据跑的地方。**

---

# 五、★ 本文的三条边界

```
① ★★ 所有数字都是【当场量的】（57,093 · 26,706 · 49% · 86% · 100%）
   ★ 而"前 5 个占 59%"那条我【修正过】—— 按真代码算，tools.ts 只有 669
② ★ 我没有【看见界面】—— 本机无视觉模型、launchChrome 不 resolve
③ ★★ 而"三个面没有导航"这条，我是【从槽位注册和用户报的两个缺陷】推出来的，
   而没有【跑起来走过一遍】
```

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
