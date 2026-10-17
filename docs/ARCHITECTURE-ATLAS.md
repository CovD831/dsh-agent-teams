# 架构图集的文字版（2026-10-17）

> **用户**（m18597 逐字）：「其实我原本想让你跟我说的是，可能是通过画 SVG 图或者 HTML
>  页面去呈现整个项目的架构模块，包括：1. **模块间的契约定义**；2. **整体的运行管线**
>  （比如它是怎么去派工的，成员又是怎么运行的）；3. **我们之前做的采集模块**等。」
>
> 「那你这么看起来的话 反而 UI 是最不重要的那个了。我们现在需要好好去讨论这个运行时了……
>  而且 **UI 是一个投影，我们原本的运行时没有做好的话，那更谈不上投影了**，对吧？」

**三张图**（同一份生成器，数字全部当场量出）：

| 图 | 回答什么 | 文件 |
|---|---|---|
| ① 契约 | 模块之间靠什么说话 | [`architecture-1-contract.svg`](architecture-1-contract.svg) |
| ② 管线 | 一次任务怎么从创建走到完成 | [`architecture-2-pipeline.svg`](architecture-2-pipeline.svg) |
| ③ 采集 | 卡点怎么被记下来、为什么只记了三种 | [`architecture-3-collection.svg`](architecture-3-collection.svg) |

生成器：`scripts/make-architecture-atlas.py`（★ 文件头写明"改代码后不要直接重跑——
先确认那三组事实仍然成立"）。复核脚本见本文 §5。

---

## 1. 契约面

### 1.1 判据层是唯一一条被**机械钉住**的边界

```
$ grep -rn "from 'node:" src/gates --include=*.ts | wc -l
0
```

`src/gates/` **12,496 行 / 27 文件 / 242 个 export**，而它对 `node:` 的引用是 **0**。
这不是"我们注意着不写"，而是**有一个叶子专门为此存在**：

```ts
// src/quality-gates/predicates.ts 的文件头
// src/gates/{admission,dispatch}/*.ts 的 4 个文件都 import src/quality-gates.ts 的
// normalizeWorkspacePath —— 而后者 import 了 node:fs
// ⇒ 「判据不 import I/O」这条载荷级不变量在【传递闭包】上破了
```

于是 QG-A 那一块（`normalizeWorkspacePath` · `pathMatchesScope` · `classifyChangedPath` ·
`inScopeOverlap` · `verifyTargetOf` · `armsNamedIn` · `GENERIC_TERMS` …）被搬到零 `node:` 的
`predicates.ts`，被 8 处 import。**刻意不含** `structurallyImpossiblePath` 与
`checkTaskPremises`（那两个真的要 `existsSync`）。

★ 这条边界的形状值得记住：**不变量不是靠"大家都记得"，而是靠"那个 import 走不通"**。
同一份纪律在别处是反例 —— `src/evaluator/` 做到了零 import，代价是**也没有人调用它**（§2.4）。

### 1.2 依赖方向（★ 一张量出来的表）

112 个 ts/tsx · 435 条已解析的本地 import · **跨组边 177 条 / 65 种**。

| 从 | 到 | 条数 |
|---|---|---:|
| `tools` | `types` | 21 |
| `tools` | `state` | 17 |
| `tools` | `gates` | 17 |
| `tools` | `events` | 13 |
| `tools` | `members` | 9 |
| `gates` | `quality-gates` | 4 |
| `gates` | `mutation` | 1 |
| `gates` | `types` | 1 |

★★ **`gates -> tools` = 0。** 判据层不知道运行时层存在 —— 这一条是成立的，而且它是
**载荷级**的（`gates` 层的判据函数签名里不出现任何 `tools` 的类型）。

★ 而 `gates` 指向外部的两条边值得单独说：

- `gates -> quality-gates`（4 条）：`admission/absorb.ts:68` · `admission/checkpoint.ts:85` ·
  `admission/convene.ts:120` · `dispatch/changed-paths.ts:46`，全部只拿 `normalizeWorkspacePath`。
- `gates -> mutation`（1 条）：`gates/completion/mutation.ts:60-78` import `../../mutation.ts`。

**这两条都不是意外**：判据要判"这个改动在不在作用域里"，就必须知道路径怎么归一。
方向是对的（判据依赖工具的**纯函数部分**，不依赖工具的**执行部分**）。

### 1.3 接口面：只有一个模块真的有"入口文件"

| 模块 | 文件 | export | 被外部消费的文件 |
|---|---:|---:|---:|
| `gates` | 27 | 242 | **7** |
| `tools` | 19 | 221 | **2** |
| `evolution` | 6 | 38 | 4 |
| `mutation` | 5 | 89 | 1 |
| `evaluator` | 3 | 13 | **0** |
| `client` | 27 | 292 | **0** |

★★ **`src/gates/index.ts` 是全仓唯一一个真正的"公开入口"**（inbound 9）：

```
src/snapshot.ts:23          import { registry, INSERTION_POINTS } from './gates/index.ts'
src/tools/status.ts:7       import { registry } from '../gates/index.ts'
src/tools/update-task.ts:118  import { registry } from '../gates/index.ts'
src/tools/create-task.ts:13   import { registry } from '../gates/index.ts'
src/tools/delivery.ts:8       import { registry } from '../gates/index.ts'
src/tools.ts:61             import { gateModuleViews, registry } from './gates/index.ts'
```

⇒ ★ **用户那条硬约束**「我是不允许模块之间互相侵入的。所以，需要暴露给其他模块使用的功能，
都必须做一个**接口**接出来」（`REQUIREMENTS.md` §1）—— 在 `gates` 上**是实现的**。

**而在 `tools` 上不是**：221 个 export 里，被外部消费的只有 `src/tools/shared/entities.ts`
与 `src/tools.ts` 两个文件。**`src/tools/shared/entities.ts` 一个文件 5,795 行 = `src/tools/`
的 44.2%**，它同时是"接口"和"实现"—— 那不是一个接口面，那是**一个漏斗**。

★ 而 `client` 的 **0** 是**对的**：`grep -rn "from '\.\./" src/client` = 0，
客户端不 import 任何服务端代码。这和用户 m18385 的裁定「前端始终还是作为一个"投影"存在」
在代码上是同一件事。

---

## 2. 运行管线

### 2.1 一句话：**它是工具驱动的，没有后台循环**

```
$ grep -E "setInterval|timer\." src/scheduler.ts src/index.ts
  （空）
$ grep -rn "setInterval" src/ --include=*.ts --include=*.tsx | grep -v src/client
  （空）
```

`setInterval` 全仓 5 处，**全在 `src/client/`**。服务端 `setTimeout` 只有 2 处，都是投递超时：

```ts
// src/scheduler.ts:66
const DELIVER_TIMEOUT_MS = 30_000
// :766 / :1093
setTimeout(() => controller.abort(), DELIVER_TIMEOUT_MS)
```

⇒ ★★★ **插件不自己跑。每一个动作都由一次工具调用触发。没有工具调用的时候，它什么都不做。**

### 2.2 一次派发的完整链路（从代码量出）

```
队长调 agent_teams_create_task / update_task / status / resume / approve …
        │
        └─► await scheduler.kickTeam(workspace, teamId, captain?)
              src/tools/create-task.ts:1095 · status.ts:662 · update-task.ts:2162
              edit-plan.ts:334 · members.ts:165 · create.ts:141 · resume.ts:63 · tools.ts:2169
                 │
                 ├─ 早退 ①  team.halted === true
                 ├─ 早退 ②  team.phase === 'staged'
                 ├─ 早退 ③  dispatchHeldByReload(team.tasks).held
                 │              （★ 三者都【不报错】—— 一次不派发的 kick
                 │                与"本来就没活"在日志里同形）
                 │
                 ├─ const captain = liveCaptain(ctx, team.captainSessionId, suppliedCaptain)
                 │      captain === undefined ⇒ ★ 直接 return（静默）
                 │
                 └─ for (const member of team.members)
                        await runtime.kickMember(workspace, teamId, member.name, captain)
                              │   ★ 逐成员，不是广播
                              │
                              └─ serializeMember(queueKey, async () => {        ← 每人一把链式锁
                                     readTeam 第二次（防竞态，不是冗余）
                                     同样三处闸门（★ 只挡一处，另一条路径就是绕过闸门的路）
                                     isMemberAvailable(member)
                                        · member.stopping === true ⇒ false
                                        · live === undefined || live.status === 'idle' ⇒ true
                                     ── 先投邮箱 ──
                                     未读邮件 ⇒ claimMailboxDelivery ⇒ DELIVER_TIMEOUT_MS
                                     ── 否则取票 ──
                                     ownedOpenTask(tasks, member.name)     ← claimed/in_progress 优先
                                     nextReadyTask(tasks, member.name)     ← 依赖全 completed
                                     beginTaskAttempt(task, name)          ← 新一代 attemptId，写盘
                                     member.status = 'working'             ← 写盘
                                     ── 投递 ──
                                     deliverToMemberDetailed(...)
                                        accepted=false ⇒ 回滚 + task.deliveryFailure = {at, attempt, reason}
                                 })
```

**成员是真子代理**：`ctx.subagents.startContinuable(...)` —— `src/members.ts:649`
`request: { prompt, parent: captain, persona, toolFilter, agentOptions }`。
⇒ 上下文独立，**因而前缀缓存不共享**（这正是用户 m18385 否决更大跨度 UI 的第二条理由）。

### 2.3 完成路径 —— 全架构最薄弱的一环

```
成员调 agent_teams_update_task(status='completed')
        │
        ├─ 认证：attemptId 必须等于当前一代 capability（stale ⇒ 拒绝）
        ├─ 判据：completion 三态（ok / blocked / unmeasured）
        ├─ 落盘 task.status = 'completed'                    ★ 这是【唯一】的"完成"事实
        │
        ├─ runtime 判据在【结果已落盘之后】求值
        │     src/tools/update-task.ts:2051  evaluateRuntimeGates(ctx, 'task-update-settled', …)
        │
        ├─ captain 通知分支（★★ 只在一个条件下走）
        │     followUp = (status==='failed' && verdict ∈ {needs_revision, reject})
        │                 ? applyQualityFollowUp(fresh, task) : undefined
        │     followUp.created.length > 0 ⇒ followUpMessage = createMessage(...)
        │     :2058  appendMailbox(…, CAPTAIN_KEY, followUpMessage)    ← ★ 只有这条分支
        │     :2146  steerCaptainReport(captain, …, followUpMessage)   ← ★ 只有这条分支
        │     :2147  markMailboxDelivered(…)
        │
        └─ :2162  await scheduler.kickTeam(...)     ← ★ 踢【其他成员】，队长不在列表里
```

★★★ **所以 `status='completed'` 这件事，今天在插件侧的唯一痕迹是 `team.json` 里那一格。**

- 不 append 队长信箱（`appendMailbox` 的 5 个生产调用点里没有这一处）
- 不 `steer` 队长（`steerCaptainReport` 的 **3 个**生产调用点里没有这一处：`update-task.ts:2146` · `message.ts:114` · `members.ts:222`；`amend-task.ts:14` 只 import 不调用）
- 不唤醒队长（`kickTeam` 的循环里没有队长）

**而它未必是 bug** —— 因为宿主**本来就有**一条独立的结算通道：

```js
// node_modules/@deepseek-ai/dsh-subagent/lib/index.js:1252
notifySettlement(activation, terminal) {
  if (!activation.announced) return
  const parent = this.ctx.agents.get(activation.parentSession)
  if (parent === void 0) return
  const message = createSettlementMessage(activation.childId, terminal)
  if (this.closingTeardownFor(parent) !== undefined) { parent.inject(message); return }
  this.sendWaking(parent, message, parent.status === 'idle' ? 'queue' : 'steer')
}
```

而 `spawnMember` 传的 `parent` **就是队长**（`src/members.ts:649` `parent: captain`），
且 `announced` 在 `submitMaterialized` 里被置真（`:1957`）—— **成员一出生就是 true**。

### 2.4 这条通道**实测是通的**（★ 本会话最重要的正面读数）

从本会话日志（`/tmp/session-b27.jsonl`，18,845 行）数 `agent/inbox/spliced` 的
`inserted[].source.kind`：

| source.kind | 条数 |
|---|---:|
| `user` | 146 |
| **`subagent-settled`** | **135** |
| `agent-teams` | 120 |
| `agent-message` | 81 |
| 其余 4 种 | 9 |

135 条里 **133 条能对上盘上团队成员**（按 `source.senderSessionId` 前向匹配
`team.json` 的 `members[].id`）：`archaeologist` 42 · `test-triage` 33 · `ui-dissect` 23 ·
`reviewer-glm` 11 · `reviewer` 9 · `ui-engineer` 9 · 其余 4 个各 1~3 条。
投递目标：`next-step` 123 · `next-turn` 12。停止原因：`completed` 117 · `aborted` 11 · `error` 7。

★★ **方法论教训（会误导后来人）**：`user/message` 里 `source.kind === 'subagent-settled'`
的是 **0 条**。结算通知**只走 `agent/inbox/spliced`**，不进 `user/message` 列表。
用"消息列表里有没有"去判"队长收没收到"会**系统性漏判**。

### 2.5 那为什么用户仍然会看到"成员做完了，主规划这边没收到"

三个**都有代码依据**的路径，按实测频率排：

**① 队长不在的时候，没人敲门**（★ 最主要的一条）

整套系统的心跳是"队长调一次工具"。队长 idle 且没有人在它身上调工具 ⇒
`kickTeam` 从不被调用 ⇒ 三个早退都不需要发生，**根本没人来敲这个门**。

盘上读数（19 个非 archive 团队 / 235 个任务 / 55 个成员）：

```
mutation-quality    t24  foreman   attempt=4  in_progress  ★ 72 小时无更新
agent-teams-hardening t38 friction-eng         pending      待派 130 小时
mutation-cost       t4   friction-eng         pending      待派 103 小时
```

那两条 pending **都有正当理由**（`mutation-cost` 是 `phase='staged'` 早退②；
`t38` 的 `friction-eng` 是 `stopping=true` ⇒ `isMemberAvailable` 返回 false）。
而 **`mutation-quality/t24` 是真的悬在半空**：任务 `in_progress` 72 小时，
`team.members` 里 `foreman` 还写着 `status='working'`。

★ 而这一条有一个**部分**的出口：`agent_teams_status` 里 `memberLiveness` 会读出五态
（`never-spawned` / `not-live` / `working` / `idle` / `could-not-measure`），
`stranded` + `stranded_tasks` 会把"记录说它有事、而会话没了"标出来，
`strandedWorktrees` 还会去数那棵树里有多少未提交改动。
**但它只在队长调 `status` 时才跑** —— 而如果队长没在调工具，这一格永远不出现。

**② `src/mailbox.ts:142` 会**主动**丢掉结算通知**

```js
// src/mailbox.ts:85-93（收集）
const latest = tasks.filter(t => (t.attempt ?? 0) > 0 || t.status === 'completed')
                    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
if (latest?.status === 'completed' && reports.some(report =>
      report.from === member.name && report.ts >= latest.updatedAt
      && report.discardedAt === undefined
      && (report.deliveredAt !== undefined || report.readAt !== undefined))) {
  redundantSettlements.add(member.id)
}
// :142（过滤）
if (input.source?.kind === 'subagent-settled' && redundantSettlements.has(input.source.senderSessionId) …) continue
```

★ 这是一个**窄化得很好**的去重（它的判据是"那条报告已经投递过/已读过"），
但它成立的时刻恰好是**结算通知是唯一唤醒源**的时刻。归类成"去重"还是"丢唤醒"，
取决于那条 `report` 是否真的已经让队长看过 —— **本仓没有这个读数**。

**③ `update_task` 判 completed 时既不 steer 也不 append 信箱**（§2.3）

这三条叠加起来的效果就是用户描述的那句话。

---

## 3. 采集模块

### 3.1 三个汇合点，一个落盘面

```
汇合点（宿主已经在的地方 —— 我们不改控制流，只在旁边记一笔）
  ├─ recordFriction()          src/tools/shared/entities.ts:4175
  │     ★ 只在【判据拒绝】时触发；3 个生产调用点：
  │        update-task.ts:1517 · shared/entities.ts:4836 · create-task.ts:1007
  ├─ 工具拒绝抛出点             src/tools.ts
  │     ★ 参数不合法 / 越权 / 状态不允许 —— 非判据类拒绝
  └─ validateCreateTask()      src/quality-gates.ts:980
        ★ 建任务的契约校验，纯函数，只依赖 types.ts

插入点 gate：7 个（src/gates/registry.ts:288 INSERTION_POINTS）
  admission(3) · contract(3) · dispatch(3) · completion(4) · delivery(2) · runtime(2) · collection(4)
  ⇒ 21 条判据，每条文件里恰好一行 `export const id = …`
  ★ 三态 ok / blocked / unmeasured（★★ unmeasured 绝不等于 ok）

落盘
  .agent-teams/evolution/signals.jsonl     appendSignalClaimingId() 进程内互斥
  ★ 而现场【只有】两个文件：index.json（920 B）· signals.jsonl（16 行 / 20.6 KB）

设计上还打算做内容寻址（把成员/任务子结构按 sha 存块），而实测那个粒度是对的：
  · 整块哈希只省 1%（4.92 → 4.88 MB）—— ★ 这是最初测错的口径
  · 成员/任务【子结构】省 70%（2.32 → 0.69 MB）
  ⇒ 但 [.agent-teams/evolution/] 里【没有 blocks/ 目录】—— 这一层还没落地
  .agent-teams/frictions/f-*.json           ★ 旧的台账，386 个文件 · 15 MB · 冻结不迁移
```

### 3.2 采集健康度：两个元指标

出自 AutoLibra / ICLR 2026 口径（`src/evolution/` 的 `collectionHealthOf()`）：

- **`coverage`** —— 采到的信号覆盖了多少种 `(component, kind)` 对
- **`redundancy`** —— 唯一对数 / 总记录数

★★ **口径陷阱（实测踩过）**：必须按「`(component, 单个 kind)` 对」算，不能按「kind 集合桶」算。
两者差 16（按对 **54** / 按桶 **38**），成因是台账里 **18 条记录带多个 `kind`**
（如 `contract.verify-command · ["unwired","misclassified"]` ⇒ 算 1 个桶、2 个对）。
同一份数据两个读数 —— 而只有前者回答"覆盖了多少种"。

### 3.3 现在的真实状态：★ 采集在跑，但只有 3 个导出有消费者

`src/evolution/` 21 个 export，生产消费者只有 3 个：

| export | 调用点 |
|---|---:|
| `observe` | **3**（`shared/entities.ts:4503` · `create-task.ts:607` · `tools.ts:2117`） |
| `collectionHealthOf` | 1（`snapshot.ts:631`） |
| `readSignalsHealth` | 1（`snapshot.ts:618`） |

而 **`src/evaluator/`（422 行 / 3 文件 / 13 个 export）在被引用上是 0**——
`grep -rn "evaluator" src/ | grep -v "^src/evaluator/"` = 零命中，**连夹具都不 import**。

★★ **而这两个事实是同一个原因**（`RUNTIME-ARCHITECTURE.md` §0 已指出）：
**没有宿主汇合点 ⇒ 没人调用 ⇒ 不跑。** "工具驱动"就是"没有汇合点"的最强形式。

### 3.4 救援词汇写好了，**一个动作都没有**

`src/tools/shared/entities.ts` 里有一整套分诊词汇：

```ts
RescueState = 'solved' | 'cannot-solve' | 'trying'      // :3002
RESCUE_STATES                                           // :3010
FrictionRescue                                          // :3027
rescueStateOf                                           // :3065
defaultRescueForStall                                   // :3096
poolForRescue                                           // :3130
missingRescueEvidence                                   // :3154
actionForFriction                                       // :3220
classifyRescue                                          // :3311
```

**外部消费者实测全 0**：`actionForFriction` 0 · `classifyRescue` 0 · `rescueStateOf` 0 ·
`missingRescueEvidence` 0（仅 `actionForFriction` 内部调）· `poolForRescue` 3 处，全在
`entities.ts:4360-4391` 的台账写入。**`rescueFromStall` 这个函数根本不存在，只在一句注释里被提到。**

`docs/HARNESS-COMPARISON.md` §6 有一个数：**`self 378 / escalate 6`（98.4% 的卡点自己消化了）**。
两种解读都写在文档里（A：判据在起作用；B：上报极稀有，不值得照抄 qedor 那套 TTL/限额重型闭环），
**结论待用户裁定** —— 而判开所需的读数（那 6 条 escalate 的时间、内容、处置耗时）**本仓没有**。

---

## 4. 用户的两个问题

### 4.1 「超时救援」—— 今天**没有**任何"到点自动救援"的代码

**先纠正一个容易混的：`runtime.liveness` 不是硬超时。**

```ts
// src/gates/runtime/liveness.ts 文件头逐字
// 硬超时：t=30min ⇒ 判定失败 ⇒ 结束等待，与「任务本来要多久」【无关】
// 探活：  t=10,20,30min ⇒ 每次问「还健康吗」
```

- `DEFAULT_LIVENESS_INTERVAL_MS = 10 * 60_000`（`:123`）
- 判据**永不因"等太久"说话**，只比较 `wait.lastActivityAt` 的两端
- **不能拒绝任务**（契约 §5），`blocked` = 报警 + 证据
- 状态不放在模块作用域（会被 5 个调用点 + 夹具 + 进程级单例污染），由调用方经 `wait.previous` 注入
- 三条不可协商性质：纯函数不 import I/O、不调 `Date.now()`、不调别的判据、三态

**而 `runtime.stall` 只报不救**：

```ts
// src/gates/runtime/stall.ts
export const DEFAULT_STALL_ROUNDS = 2          // :94
if (stall.state === 'stalled' || stall.count >= threshold)   // :216
```

★★ **而它在盘上没有一条证据**：遍历 `.agent-teams/**/team.json` 的 446 条任务，
**携带 `stall` 的 = 0**；386 条 friction 记录里只有 10 条带 `stall`，全部是
`('trying', point=None, count=1)`，**没有一条到 `count >= 2`**。
⇒ `stalled` 这一支**在这份工作区的全部历史里从未被触发过**。

**为什么** —— 落盘链是通的（`update-task.ts:1498` `noteStall(...)` → `:1508` `writeTeam`
在 `throwWithSurface` 之前，`:1570` 放行后 `clearStall`），但触发它需要**同一任务被拒两次**，
而 98.4% 的卡点第一次就被自己消化掉了。

**救援该落在哪**（这是要跟用户讨论的部分）：

```
今天唯一的"发动机" = 工具调用。所以"到点救援"必须有【工具调用之外】的心跳。
宿主全域没有服务端定时器先例：
  grep -rn "setInterval" node_modules/@deepseek-ai/*/lib/*.js  ⇒ 只有 dsh-client-ui-chat/lib/client.js
  grep -n setTimeout node_modules/@deepseek-ai/dsh-subagent/lib/index.js ⇒ 0 处
而 cordis 给了落脚点：
  ctx.effect(execute: () => Effect, label?) ⇒ disposer 在 fiber 卸载时按反序跑、可以是 async
  ⇒ ctx.effect(() => { const t = setInterval(...); return () => clearInterval(t) }, 'label')
```

**三个候选形状**（都不写代码，先要用户拍板）：

| 形状 | 谁当救援 | 代价 |
|---|---|---|
| **A. 队长自己**（用户倾向的） | `ctx.effect` 里一个 10min tick，读所有 running 队，条件满足时 `captain.steer(...)` | 队长不在（session 结束）时 steer 会抛；★ 但 `readCaptainSession` 已经吞了这一种 |
| **B. 持久化成员** | 起一个永不结束的 `wakeup` 成员，它自己的 turn 就是心跳 | 多一个真正在烧 token 的会话；★ 且它的 turn 也需要有人 kick |
| **C. 纯判据 + 记录，不唤醒** | 只把"这次等太久"写盘，等 UI 投影出来给人看 | 不解决"没人看"的那一段 |

★ 用户原话是「在我的原本的想法中，队长可能充当救援；或者说，你需要拉起一个持久化的成员
去作为救援，可能还是队长比较合适吧」—— **倾向 A**。

**A 的可行前提已经在了**：`src/index.ts:517-529` 已有先例 —— 浏览器点 Approve 之后，
除了 HTTP 200 还要给模型一条 control message，用的就是 `captain.steer(createUserMessage(...))`，
且注释写明"Approval is already committed. Do not report a failed approval and invite a retry"。

**A 缺的三件东西**（都能从盘上读出来，不需要新状态）：

1. **"该救援"的判据**：`task.status ∈ {claimed, in_progress}` 且 `now - task.updatedAt > N`，
   且那个成员 `memberLiveness(...) !== 'working'`。★ 后者比 timeout 更硬 ——
   一个真的在跑的成员 `live.status === 'running'`，一个悬空的成员 `live === undefined`。
2. **幂等标记**：`task.deliveryFailure` 是现成的形状先例（`{at, attempt, reason}`）——
   救援也要带 attempt，否则"上次救过"与"这次又卡住"同形（这是 `REQUIREMENTS.md` §4 的字面要求）。
3. **不重复打扰**：`escalate` 那 6/384 的读数说明"打扰"极稀有；而一个每 10min 醒一次的
   定时器会**制造**打扰。⇒ 需要一条"这次已经叫过人了"的落盘记录。

### 4.2 「更可靠的回调」—— 通道是通的（135 次），断在**三个具体位置**

用户原话：「确实会出现成员明明已经做完了任务，但是主规划这边没有接收到任何消息，
导致整体进展就被卡住了。」

**而实测说：宿主的结算通道跑通了 135 次。** 所以问题不在"没有回调机制"，
而在"完成这件事**没有一条自己的路**"。逐条：

**① 完成没有自己的消息**（结构原因）

`update_task` 判 completed ⇒ 只有 `task.status` 落盘。宿主的 `subagent-settled` 带的是
**成员的停止原因 + 它最后一段输出**，不带 `task.status`；而 `mailbox.ts` 的
`redundantSettlements` 又会在"报告已投递"时把它滤掉。

⇒ ★ **"完成"这件事今天靠的是"队长恰好调了一次 status"。**

**② 队长的 inbox 有两套来源，只有一套会被 `mailboxPrompt` 渲染成回执**

`appendMailbox` → `mailboxPrompt(teamId, CAPTAIN_KEY, [message])` → `steerCaptainReport`。
而宿主的 `subagent-settled` 完全绕开这条路（它由宿主直接 `inject`/`steer`，正文是
`Background subagent <id> finished …`）。两套来源的**回执语义不同**，而 `src/mailbox.ts`
的 `parseReceipt` 只认 `AgentTeams inbox receipt: ` 前缀的那一套。

**③ 队长不在时，`steer` 会抛，而这条路径已经做好降级了**

```ts
// src/tools/update-task.ts:2149-2156
else if (captain === undefined) {
  ctx.logger?.info?.(
    `agent-teams: follow-up steer for team "${team.id}" was NOT delivered — the captain session could not be read in this context `
    + '(cannot get required service "agents" in inactive context). The completion itself HAS landed; the message is still in the mailbox '
    + 'and will be delivered by the next status read. This is a delivery miss, not a completion failure.')
}
```

★ 这段注释是**对的**：产物已经交付，卡的是**通知**。而它的措辞已经点出了缺的那一半 ——
"will be delivered by the next status read"，**而如果队长永远不再读 status 呢？**

**所以"更可靠的回调"要补的，按可行性排：**

| # | 补什么 | 成本 | 能解决哪一条 |
|---|---|---|---|
| 1 | **`update_task` 判终态时无条件 `appendMailbox` 一条状态消息**（不只 quality follow-up） | 小 | ①（完成有自己的消息） |
| 2 | **别在 `redundantSettlements` 里滤掉结算**（或者：滤之前要求那条报告 `readAt !== undefined`，不是 `deliveredAt`） | 小 | ①的漏 |
| 3 | **订阅 `agent/turn-stopping`**（宿主 12 个 agent 事件里我们只订了 6 个，而这一格正好是"一个 turn 要结束了"） | 中 | ②（在 turn 边界上核对一次） |
| 4 | **把"完成"变成一次 `steer`**（而非等队长来读） | 中 | ③的前提 |
| 5 | **一个 10min tick 的救援器**（同 4.1 的 A） | 大 | ①②③ 全部兜底 |

★ 而 **#5 是兜底而非常规路径** —— 只有当 1~4 都不成立时它才该出声。
理由：`escalate 6 / 384` 的读数是整个采集面最反直觉的一条 —— **打扰极其稀有**。
一个每 10 分钟醒一次的救援器，第一件事会是**把打扰从 6 变成 600**。

---

## 5. 复核命令（每条断言都能重跑）

```bash
# 契约面
grep -rn "from 'node:" src/gates --include=*.ts | wc -l          # ⇒ 0
python3 /tmp/atlas-verify.py | sed -n '/== import 图 ==/,/tools ->/p'
                                                                  # ⇒ cross=177 distinct=65, gates->{quality-gates:4, mutation:1, types:1}

# 管线
grep -E "setInterval|timer\." src/scheduler.ts src/index.ts       # ⇒ 空
grep -rn "evaluateRuntimeGates(" src/ --include=*.ts | grep -v "export function"
                                                                  # ⇒ 6 处
grep -rn "steerCaptainReport(" src/ --include=*.ts | grep -v "export function"
                                                                  # ⇒ 3 处（amend-task.ts 只 import）
grep -rn "appendMailbox(" src/ --include=*.ts | grep -v "export async function"
                                                                  # ⇒ 5 处
node -e "…TEAM_TOOL_NAMES…"                                       # ⇒ 16
grep -rn "^export const id = " src/gates --include=*.ts | wc -l   # ⇒ 21

# 结算通道（需要先 zstd -d 解出会话日志）
zstd -d -f -o /tmp/session-b27.jsonl \
  ~/.dsh/sessions/--Users-abab-Desktop-agent-teams-dev--/session-b27be614-…/session.v4.jsonl.zstd
#   然后数 agent/inbox/spliced 的 inserted[].source.kind ⇒ subagent-settled 135

# 盘上铁证
python3 - <<'PY'
import json, pathlib
hits = 0
for f in pathlib.Path('.agent-teams').rglob('team.json'):
    if '/archive/' in str(f): continue
    for t in json.loads(f.read_text()).get('tasks') or []:
        hits += 1 if 'stall' in t else 0
print('任务带 stall 的条数:', hits)          # ⇒ 0
PY
```

---

## 6. ★ 本文没有回答的

| 问题 | 为什么没答 |
|---|---|
| 救援器该多久 tick 一次 | 用户给了「10min 或 5min 探活一次比较好」，但那是 `liveness` 的口径，不是救援的口径 |
| 救援算不算"打扰"（要不要计数） | `HARNESS-COMPARISON.md` §6 的 6/384 是本仓唯一读数，而它没有时间/内容 |
| 队长不在时谁负责 | 三个候选（A/B/C）都列了，等用户拍板 |
| UI 怎么投影这三条 | 用户 m18597 已裁定押后：「UI 是一个投影，我们原本的运行时没有做好的话，那更谈不上投影了」 |

★ 本文是**阐述**，不是需求。要变成需求的条目，见 `docs/REQUIREMENTS.md` 的待补项。
