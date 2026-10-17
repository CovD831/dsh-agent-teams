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

