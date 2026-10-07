# 拆分 `src/tools.ts`：设计（t30）

> **这份文件是【设计】，不是实现。** t30 按 captain 裁决停在设计阶段 ——
> 落笔要等 t34（`moduleFreshness` 接线）落定 + 插件重载，理由见 §0。
>
> 契约要求的六件事，本文逐条回答：怎么切 · 边界与依赖方向 · **inScope 冲突表** ·
> 怎么保证逐条不回归 · 装配与外接口不变 · 定向突变能打红。

---

## 0. 为什么先设计、不先落笔

captain 裁决「甲」，理由三条，我全部接受：① 在旧模块上做的重构与没做重构在观测上
分不清；② 6699 行重构 + 撞 t34 的写域（它正在改 `status`）⇒ 冲突会伪装成"行为变了"；
③ **t34 正是为终结这件事而建的** —— 它落地后基线才是可证的。

★ 而这次设计过程本身**产出了一条落笔前必须知道的事**（§2.3）：真正的耦合不是
"工具之间互相调用"，而是**7 个模块级可变状态**。不先钉住它们，任何切法都会在
"搬一个工具"时顺手把别人的状态也搬走 —— 而那正是"行为变了"最常见的入口。

### 0.1 第 0 步（基线确认）：**读到的是「否」，所以本文停在这里**

按 §6 的顺序，落笔前必须先确认"宿主进程持的是当前构建"。captain 从**工具出口**
读了一次：

```
agent_teams_status 的返回值里【没有】`deployment` 那一格
⇒ 宿主进程持有的模块【不含 t34】⇒ 落笔的基线不可证
```

★ **而这个读法是自洽的、可证伪的**（不是"我猜它旧了"）：`deployment` 那一格
是 t34 加到 status 出口上的，所以

```
出口【有没有】那一格  ⇔  宿主进程【有没有】t34
```

⇒ 出口的形状本身即证据，不需要额外读数。★ 我独立复核过：`src/tools.ts:6101`
（`deployment: (() => {`，IIFE 内 6108 调 `moduleFreshness()`）确实在源码与
构建产物里都在，而宿主出口没有它 ⇒ **结论成立**。

**所以本文的落笔条件是明确的，且只剩一步**：

```
重载插件 ⇒ 再调一次 agent_teams_status ⇒ 返回值里【出现】deployment 那一格
         ⇒ 那时本文 §6 的第 1 步才可以开始
```

★ 为什么坚持这一条而不是"先干起来"：本文 §4 的冲突表、§5 的夹具臂、§7 的风险
清单**全部建立在"我读的源码 == 进程跑的代码"这个前提上**。前提不成立时，
后面每一步的绿都不可信 —— 而那正是 §0 裁决「甲」的理由本身。

---

## 1. 现状（实测，非估计）

```
src/tools.ts                   6778 行（不是派工单上的 5729 —— 本轮又长了 ~1000 行）

  1 .. 3341    前置：import / 类型 / 93 个模块级 helper / 7 个可变状态   ← 49%
  3342 .. 3710 registerAgentTeamsTools 的装配头部（守卫、时钟、调度器、锁）
  3711 .. 6779 ctx.tools.register(defineTool({...})) × 16                  ← 45%
```

16 个工具，按体量：

| 工具 | 行区间 | 行数 | 直接引用的 helper 数 |
|---|---|---|---|
| `agent_teams_update_task` | 4642–5475 | **834** | 26 |
| `agent_teams_restart` | 6355–6779 | 425 | 10 |
| `agent_teams_status` | 5718–6141 | 423 | 15 |
| `agent_teams_create_task` | 4204–4409 | 206 | 11 |
| `agent_teams_create` | 3712–3895 | 184 | 5 |
| `agent_teams_send_message` | 5585–5717 | 133 | 9 |
| `agent_teams_reassign_task` | 4410–4540 | 131 | 11 |
| `agent_teams_edit_plan` | 3896–4015 | 120 | 5 |
| `agent_teams_amend_task` | 5476–5584 | 109 | 10 |
| `agent_teams_declare_delivery` | 6142–6248 | 107 | 9 |
| `agent_teams_claim_task` | 4541–4641 | 101 | 10 |
| `agent_teams_add_member` | 4048–4144 | 97 | 7 |
| `agent_teams_remove_member` | 4145–4203 | 59 | 8 |
| `agent_teams_delete` | 6301–6354 | 54 | 7 |
| `agent_teams_resume` | 6249–6300 | 52 | 6 |
| `agent_teams_approve` | 4016–4047 | 32 | 3 |

★ **`update_task` 一条占 12.3%**，而它正是本轮的常客（`dispatch` + `completion`
两个位置的判据都在它里面跑）。它是拆分的**首要收益点**，也是**最难切的那个**
（见 §3.2）。

---

## 2. 关键发现（这些决定了切法）

### 2.1 ★ 共享核很小 —— 拆分所以可行

93 个模块级 helper 里，**只有 5 个被 8 个以上工具引用**：

```
workspaceOf            16 个工具
requireCaptain         16
stateRootOf            14
teamLockKey            13
requireCaptainTeam     11
```

而它们**总共只有 ~72 行**：

| helper | 行 | 行数 |
|---|---|---|
| `requireCaptain` | 298–303 | 6 |
| `workspaceOf` | 306–308 | 3 |
| `stateRootOf` | 817–819 | 3 |
| `teamLockKey` | 822–824 | 3 |
| `requireCaptainTeam` | 832–838 | 7 |
| `requireParticipantTeam` | 841–847 | 7 |
| `requireFreshTeam` | 861–865 | 5 |
| `requireMember` | 893–899 | 7 |
| `requireTask` | 902–908 | 7 |
| `trimmedOptional` | 917–920 | 4 |
| `memberOpenTask` | 953–957 | 5 |
| `taskDetails` | 959–968 | 10 |
| `captainOpenTask` | 971–975 | 5 |

⇒ **共享核只有约 72 行**，抽成一个 `src/tools/shared/` 即可。**这是拆分可行性的
决定性事实** —— 若共享核是 1000 行以上，"按工具拆"就只是把同一个文件切成多片、
冲突面几乎不变。

★ 另有 **21 个 helper 只被 1 个工具引用** ⇒ 它们应当**跟着那个工具走**，
不进共享核（进了会把共享核做胖，重新制造耦合）。

### 2.2 ★ 工具之间**不互相调用**

实测：16 个工具没有任何一个在函数体里调用另一个工具。它们只共享 helper 与状态。
⇒ 切法是**树**（工具 → 共享核），不是网。这一步让"按工具一个文件"在结构上成立。

### 2.3 ★★ 真正的耦合是 7 个模块级可变状态（落笔前必须先钉住）

这才是拆分最危险的地方 —— 也是**第 7 次"两个来源"形态的温床**：

| 状态 | 行 | 谁碰它 | 形态 |
|---|---|---|---|
| `taskWorktreeBase` Map | 385 | `update_task`、（`rememberWorktreeBase`） | 内存 |
| `STATE_DIR_FOR_BASE_PERSIST` | 451 | `update_task` 装配写 | 内存·单例 |
| `runtimeGateLog` 数组 | 1110 | `update_task` | 内存·**有上限** |
| `LOADED_STAMP_OUTPUT` / `LOADED_STAMP_READ` | 1186–1187 | `status`、`restart` | **加载时读一次** |
| `waitRecords` Map | 1579 | `update_task`、`status` | 内存·有上限 |
| `waitWindows` Map | 1625 | `update_task`、`status` | 内存·有上限 |

**按"工具 ↔ 状态"实测的耦合矩阵**（经 accessor 读，非直接引用）：

| 工具 | worktree base | runtime log | wait 记录/窗口 | freshness |
|---|---|---|---|---|
| `update_task` | **USES** | . | **USES** | . |
| `status` | . | . | **USES** | **USES** |
| `restart` | . | . | . | **USES** |
| 其余 13 个 | . | . | . | . |

⇒ ★★ **只有 3 个工具碰可变状态，13 个完全不碰。**

★★★ 这条是本设计的核心论点：

```
今天这些状态【每个只有一份】，因为它们住在同一个模块里。

  拆成多文件之后，若每个文件各自 import 一份 ⇒ 状态会分裂成 N 份，
  而"分裂"不会当场报错 —— 它表现为"status 看不到 update_task 写的 wait 记录"，
  而那个症状与"这个成员确实没在动"【同形】。

⇒ 所以【状态必须住在一个地方、被所有工具 import】，
  而不是"每个工具文件自己维护一份"。
  这条不是风格问题，它是"三态不许合流"在拆分上的翻版。
```

**具体做法（落笔时）**：把 7 个状态连同它们的 accessor 一起放进
`src/tools/shared/state.ts`，**只导出 accessor（读/写函数），不导出裸变量**。
理由：裸 `export const waitRecords = new Map()` 允许任何文件直接 `.clear()`，
而 accessor 让"谁在写这个状态"在类型层面可枚举 —— `resetWaitRecords()` 已经是
这个形状的既有先例（1443 行）。

### 2.4 今天真正的"冲突对"只有 4 / 120

按"共享同一可变资源"定义冲突，**16 个工具两两共 120 对，真正共享的只有 4 对**：

```
update_task      <-> status             [gateCtx, waitState]
update_task      <-> declare_delivery   [gateCtx]
status           <-> declare_delivery   [gateCtx]
status           <-> restart            [freshness]
```

⇒ ★ **瓶颈不是"工具之间耦合太深"，而是"16 个工具挤在同一个文件里"。**
这是一个重要的判断：它意味着**按工具切文件的收益很大、风险很小**
（不是那种"你以为解耦了、其实没有"的重构）。

---

## 3. 切法

### 3.1 目录结构

```
src/tools.ts                     ← 保留：装配（registerAgentTeamsTools）+ 再导出
                                    ★ 目标 ≤ 400 行（今天 6778）
src/tools/
  shared/
    state.ts         7 个可变状态 + accessor（只导出函数，不导出裸变量）
    team-access.ts   requireCaptain / requireCaptainTeam / requireParticipantTeam /
                     requireFreshTeam / requireFreshParticipant / requireMember /
                     requireTask / stateRootOf / teamLockKey / workspaceOf
    task-shape.ts    taskDetails / memberOpenTask / captainOpenTask / trimmedOptional
    define.ts        withInputSurfaceOnError / defineTool 包装（16 个工具共用）
  create.ts          agent_teams_create
  edit-plan.ts       agent_teams_edit_plan
  approve.ts         agent_teams_approve
  members.ts         agent_teams_add_member / remove_member
  create-task.ts     agent_teams_create_task
  reassign.ts        agent_teams_reassign_task
  claim.ts           agent_teams_claim_task
  update-task/
    index.ts         agent_teams_update_task（入口 + schema）
    dispatch.ts      ★ 从 4642–4950 切出的 dispatch 位置那一半
    completion.ts    ★ 从 4950–5475 切出的 completion 位置那一半
    repair.ts        repairEvidence / discriminatingFiles
  amend-task.ts      agent_teams_amend_task
  message.ts         agent_teams_send_message
  status.ts          agent_teams_status
  delivery.ts        agent_teams_declare_delivery
  resume.ts          agent_teams_resume
  delete.ts          agent_teams_delete
  restart.ts         agent_teams_restart
```

★ **一个工具一个文件**是主规则；唯一例外是 `update_task`（§3.2）。

### 3.2 `update_task` 的特殊处理（834 行）

它是本任务**唯一**需要二次拆分的工具，理由是实测的：

```
4642–5141  dispatch 位置   ~500 行  （changed-paths 的 ctx 构造 + 归属观察 + 闸门合并）
          ★ 内部实测锚点：dispatchContext 在 4827，evaluate('dispatch') 在 4848
5142–5475  completion 位置 ~334 行  （verify 重跑 / 变异 / 回测 / 覆盖的 ctx 构造）
          ★ 内部实测锚点：completionContext 在 5142，evaluate('completion') 在 5244
```

★ 这两半**已经是两个插入点**（`registry.evaluate('dispatch', …)` 与
`registry.evaluate('completion', …)`），中间以一个 `wantsCompleted` 分界。
⇒ 按**插入点**切，不是按"随便找个行数中点切"：

```
· 切完之后，改 dispatch 判据只碰 dispatch.ts，改 completion 判据只碰 completion.ts
· ★ 而这正是本轮四条任务链被串成一条的那个原因 ——
  t3（dispatch 接线）与 t4（completion 接线）本可并行，却都改 tools.ts
```

★ 切点在源码里是**可指认的**（不是估计）：`dispatchContext` 在 4827 行、
`completionContext` 在 5142 行 —— 两行之间是那段"两次求值之间"的公共部分
（`wantsCompleted`、`changedFiles`、`observedFiles` 的折叠），它属于 `index.ts`。

### 3.3 依赖方向（单向，不许有环）

```
      tools.ts（装配）
          │  只 import 工具模块，不 import shared
          ▼
    tools/<tool>.ts  ──────────►  tools/shared/*.ts
          │                              │
          │                              ▼
          │                        src/state.ts, src/gates/, src/types.ts …
          └──────────────►  （既有模块，方向不变）
```

★ **两条不许违反的规则**（拆分的"不回归"在很大程度上靠它们）：

```
① shared 不许 import 任何 <tool>.ts          —— 否则立刻成环
② <tool>.ts 之间不许互相 import             —— 已实测：今天没有，拆完也不许有
```

★ ② 可以**机械化钉住**（见 §5 臂 3）：一条扫描 `src/tools/**` 的 import 图、
发现环或横跨就红的臂。这比"约定"强 —— 约定会腐烂。

---

## 4. ★ inScope 冲突表：拆分**真的**提高并行度了吗

契约要求"给出新的 inScope 冲突表，显示不同工具落在不同文件"。下面是实测的
**前 / 后**对比（对以 `src/tools.ts` 为 inScope 的任务而言）。

### 4.1 今天（拆分前）

```
任务           工具行为改动涉及的文件
─────────────────────────────────────────────────
t3  dispatch 接线        src/tools.ts
t4  completion 接线      src/tools.ts
t34 status 出口          src/tools.ts
t30 拆分本身             src/tools.ts
─────────────────────────────────────────────────
⇒ ★ 四条任务链【全部】落在同一个文件 ⇒ 结构上串行（今天的实测事实）
```

### 4.2 拆分后

| 任务 | 涉及文件 | 与他谁冲突 |
|---|---|---|
| t3 dispatch 接线 | `src/tools/update-task/dispatch.ts` | 无 |
| t4 completion 接线 | `src/tools/update-task/completion.ts` | 无 |
| t34 status 出口 | `src/tools/status.ts` | 无 |
| t30 拆分本身 | `src/tools.ts`（装配） | 无 |

```
⇒ ★ 四条的 inScope【两两不相交】⇒ 可并行
```

### 4.3 拆分后的冲突表（16 工具 × 共享资源，4 行的形态**不变**）

★ 诚实说明：**§2.4 那 4 对冲突在拆分后依然存在**（`gateCtx` / `waitState` /
`freshness`）—— 因为那是**真实的运行时共享**，不是文件布局造成的。
拆分**不消除**它们，只是让"碰这些共享资源的工具"从 16 个收窄到 3 个：

```
拆分前：改任何一个工具 ⇒ 都碰 src/tools.ts ⇒ 与【全部 15 个】冲突
拆分后：改 update_task  ⇒ 碰 update-task/*.ts  ⇒ 与 status/restart 潜在冲突（2 个）
        改 status       ⇒ 碰 status.ts         ⇒ 与 update_task/restart 潜在冲突（2 个）
        改其余 13 个    ⇒ 各自一个文件          ⇒ 与【0 个】冲突
```

⇒ **冲突面：16 → 至多 3。** 这才是"并行度真的提高了"的可证读数。

---

## 5. 夹具设计：`scripts/gate-tool-split.test.mjs`

契约要求"定向突变能打红：把某个工具的定义删掉 ⇒ 对应臂红"。六条臂：

```
臂 1（普查臂）  16 个工具【逐个】都在注册清单里，且 name 与拆分前【逐字相同】
                ★ 定向突变：删掉任一工具 ⇒ 该工具那条红（不是"总数少 1"那种恒真断言）

臂 2（内容臂）  ★ 每个工具的 parameters / description / execute 与基线【逐字一致】
                —— 用 golden 快照（`scripts/fixtures/tool-definitions.json`）
                ★ 这是"拆分不得改变行为"的主力：它抓的是"搬的时候顺手改了一句描述"

臂 3（结构臂）  import 图无环、且 <tool>.ts 之间无横跨
                ★ 定向突变：让 status.ts import update-task ⇒ 红

臂 4（共享态臂）★ 7 个可变状态【全进程只有一份】
                · 从 update_task 写一条 wait 记录 ⇒ 从 status 读得到
                · 定向突变：让 status 自己 `new Map()` ⇒ 读不到 ⇒ 红
                ★ 这一条是 §2.3 那个"分裂不会当场报错"的机械形式

臂 5（装配臂）  registerAgentTeamsTools 仍然导出、registry 里的工具数不变、
                返回值 AgentTeamsRuntime 的 5 个键不变（对外接口不变）

臂 6（体量臂）  ★ 不是"必须小于 N 行"（那会把当前数量写成不变量）
                而是：**src/tools.ts 不再包含任何 defineTool 的工具体**
                —— 判据是"结构变了"，不是"数字小了"
```

★ 臂 2 的 golden 快照必须**从拆分前的 commit 生成**（不是拆分后自拍）——
否则它是"自己给自己出题"。生成命令写进夹具注释，下次改动可以复现。

### 5.1 怎么保证"逐条不回归"（契约第 ② 条）

```
① 拆分【纯搬运】：不改一行逻辑、不改一句描述、不改一个 schema 字段
② 全量回归 = 既有 623 条 + 本夹具 6 条
③ ★ 关键：拆分【前】先跑一次全量并留读数，拆分【后】逐条对拍
   —— 而不是"改完跑一次绿了就算"（那是"在旧模块上做的重构"的同一个盲区）
④ 若某条既有臂因为"行号/文件路径"而红 ⇒ ★ 那是【夹具写死了布局】，
   要改的是夹具的取数方式，不是回退拆分。这条要写进提交信息。
```

---

## 6. 落笔顺序（t34 之后）

```
第 0 步  确认基线：从【工具出口】读 moduleFreshness === 'current'
         ★ 这一步不做完，后面每一步的绿都不可信（§0）
第 1 步  生成 golden 快照（第 0 步的 commit 上）
第 2 步  建 src/tools/shared/，把 7 个状态 + 13 个共享 helper 搬过去
         ★ 此时 tools.ts 只多几行 import —— 全量必须仍然全绿
第 3 步  逐个工具往外搬，一次一个，每搬一个跑一次全量
         ★ 顺序：先搬【不与可变状态耦合】的 13 个（零风险，收益立刻可见）
           再搬 status / restart
           最后搬 update_task（按插入点切）
第 4 步  tools.ts 收成装配 + 再导出；加夹具 6 条臂；跑 pnpm verify
第 5 步  ★ 出拆分后的 inScope 冲突表（§4.2/4.3），交给 captain 做并行派发依据
```

★ 第 3 步的"一次一个"不是保守，是**让失败可归因**：一次搬 16 个之后出现回归，
你分不清是哪一个搬坏的 —— 而本队为"归因错误"已经付过多次学费。

---

## 7. 已知边界（不假装它能做更多）

1. **拆分不消除那 4 对运行时共享**（§4.3）。它把冲突面从 16 收到 ≤3，不是 0。
2. **`update_task` 仍是最大的一个工具**（834 行 → 三个文件，最大的约 520 行）。
   它内部还有可拆空间（例如 verification 相关的 4 条判据），但那属于**行为改动**，
   不在"纯搬运"的契约里 —— 本轮不做。
3. **`lib/` 是产物**：拆分后 `lib/tools.js` 会变成 `lib/tools.js` + `lib/tools/*.js`。
   `package.json` 的 `files` 已经含 `lib`，所以**打包不用改**。

   ── ★★ 但有一条【实测过的】真代价：20 个既有夹具把 `src/tools.ts` 当**源码**读 ──

   落笔前我把这条从"猜"变成了"实测"，因为它决定第 3 步的真实工作量：

   ```
   引用 tools.ts / lib/tools.js 的夹具：20 个
   其中把它当【源码文本】扫的（会因拆分而改变行为）：
     scripts/verify-unmeasured-consumers.test.mjs   15 处   ← 最多
     scripts/gate-readout-uniform.test.mjs          10
     scripts/gate-tool-output-schema.test.mjs        8
     scripts/gate-index-assembly.test.mjs            7
     scripts/verify-readout-uniform.test.mjs         6
     scripts/verify-admission.test.mjs               6
     scripts/gate-changed-paths.test.mjs             6
     scripts/verify-input-requires.test.mjs          5
     …（其余若干各 1–4 处）
   ```

   **★ 而它们的失效方向是【红】，不是【静默】—— 我实测确认过，这是好消息：**

   `gate-tool-output-schema` 最典型：**枚举来源是注册表**（活的、16 个），
   **期望值来源是 `src/tools.ts` 的文本**（按 `defineTool({` 大括号配平取块）。
   搬走任一工具之后，**两道闸门都会红**（我两条都读了源码确认）：

   ```
   ① sourceBlockOf(name) ⇒ assert.ok(m !== null,
        '★ 源码里找不到工具 "…" —— 它被改名或删掉了，普查必须跟着看清新形状')

   ② 更早还有一条专设的守卫：
        assert.deepEqual(unparsable, [],
          '★ 这些工具在注册表里、而源码里解析不出它的块 —— 普查会漏掉它们')

   ③ 以及一条集合相等：普查范围 == 注册表全集
        （注释原话："差额就是『声明落在实现后面』会藏身的地方"）
   ```

   ⇒ **三层都指向"红"，没有一层会静默。** 原因是 t15 特意把枚举来源从**手写的
   `EMITTERS` 表**改成了**注册表**（其注释原话："一份手写的表，就是一个会腐烂的
   声明面"）—— 正是那一改，让这次拆分撞上去时**会红，而不是会躲**。

   ★★ 这一条值得单独记：**t15 当初那个"把声明面换成注册表"的决定，
   在今天成了"拆分时不会静默漏普查"的保障。** 一个机制的价值常在下一次
   改动时才兑现 —— 而这次兑现的方式恰好是"红给你看"。

   **落笔时的处置**：这些夹具改成"从 `src/tools/**` 里找那个工具的块"，
   而**判据（红）不变** —— 改的是夹具的取数方式，不是放宽它（§5.1 第 ④ 条）。

4. **本设计没有验证过**：§4 的冲突表是按实测的 helper/state 引用关系**推**出来的，
   不是跑出来的。⇒ 落笔后必须**用真实 inScope 表复算一次**再报。
   ★ 而第 3 条我已经按同样纪律补成了**实测**（不再是猜）—— 凡是我能先测的，
   就不留给落笔时赌。
