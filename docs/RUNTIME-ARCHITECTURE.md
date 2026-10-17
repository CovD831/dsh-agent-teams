# 运行时架构：它到底怎么跑起来的（2026-10-17）

> **用户**「首先是关于插件本身,**从运行层面（即任务执行方面）讲,
>  它应该是什么样一个架构**。这个之前我们其实讨论过,但我觉得现在可以再清晰一遍。」
>
> ★★★ **每一条都是【从代码量出来的】**,而"没量到"的地方我标明。

---

## 0. ★★★ 一句话：**它是【工具驱动】的，没有后台循环**

```
$ grep -E "setInterval|timer\." src/scheduler.ts src/index.ts
  （空）
```

⇒ ★★★ **所以:插件不自己跑,【每个动作都由一次工具调用触发】。**
★ **而那解释了为什么它"看起来慢"** —— **没有工具调用的时候,它什么都不做。**

### ★★ 而这一点与"评估器孤儿"是同一个原因

★★ 见 `ARCHITECTURE-FULL.md` §3.1:**没有宿主汇合点 ⇒ 没人调用 ⇒ 不跑。**
**★ 而"工具驱动"就是"没有汇合点"的最强形式。**

---

## 1. ★★★ 启动：`apply()` 做四件事

```ts
// src/index.ts:191  export function apply(ctx, config)
```

| # | 做什么 | 位置 |
|---|---|---|
| **①** | ★ **注册 16 个工具** | `:267` `registerAgentTeamsTools(ctx, resolved)` |
| **②** | 注册 **HTTP 路由**（`/state` 等）| `:400` `:422` `:477` `:628` |
| **③** | 注册 **commands**（斜杠命令）| `:351` |
| **④** | 监听 `internal/service` | `:663` |

★ **而客户端那半（`src/client/index.tsx`）是【另一个进程/另一份 bundle】**
⇒ ★★ 它注册槽位（11 处），**而它与服务端只通过 `/state` 通信**。

---

## 2. ★★★ 16 个工具 = 16 个"动作"

```
agent_teams_create · create_task · update_task · claim_task · reassign_task
· edit_plan · amend_task · approve · resume · restart · delete
· add_member · remove_member · send_message · status · declare_delivery
```

### ★★ 而它们分成三类

| 类 | 工具 | 谁调用 |
|---|---|---|
| **① 队长动作** | `create` · `create_task` · `edit_plan` · `add_member` · `remove_member` · `status` · `declare_delivery` | ★ **队长（主会话）** |
| **② 成员动作** | `claim_task` · `update_task` · `send_message` | ★ **成员（子代理）** |
| **③ 仲裁** | `reassign_task` · `amend_task` · `approve` · `resume` · `restart` · `delete` | ★ 队长或人 |

---

## 3. ★★★ 一次任务的完整生命周期（从代码量出来的）

```
① 队长调 create_task
   ★ 而它【不是】直接派发 —— 它写状态,判定闸门,然后:
   ★★ src/tools/create-task.ts:1095   await scheduler.kickTeam(workspace, team.id, captain)
   ⇒ ★★★ 而"派发前"就是那一刻（★ 那行注释逐字说了）

② kickTeam(workspace, teamId)  ← ★ src/scheduler.ts:687
   ├─ readTeam(stateRoot, teamId)                    ★ 读盘
   ├─ if (halted || phase==='staged') return         ★ 三个早退
   ├─ if (dispatchHeldByReload(tasks).held) return   ★ reload 期间不派
   ├─ const captain = liveCaptain(...)               ★ 队长必须活着
   ├─ for (member of team.members)
   │    └─ await runtime.kickMember(...)             ★ 逐个成员
   └─ kickMember:
        ├─ serializeMember(queueKey, …)             ★ 逐成员串行
        ├─ readTeam 再读一次                        ★ 防竞态
        └─ ★ 有活 ⇒ ctx.subagents.startContinuable(...)  ⇒ ★★ 真的是子代理
```

⇒ ★★★ **四个关键性质:**
```
① ★ 派发【不是广播】而是【逐成员 kick】⇒ 每人一个独立的队列锁
② ★★ 每次 kick 都【重读一次 team】⇒ ★ 那是防竞态的设计
③ ★★★ 成员 = 【真正的子代理】（startContinuable）⇒ ★ 所以它的上下文独立
④ ★ 有【三个早退条件】:halted · staged · reload 待处理
```

---

## 4. ★★★ 而"完成"是怎么被知道的 —— **那是全架构最薄弱的一环**

### 实测

```
$ grep "onCompleted|completion" src/scheduler.ts
  ★ 只找到一句 prompt 文案
⇒ ★★★ 所以【没有回调注册】—— 完成是【成员自己调 update_task 说出来的】
```

### ★★ 而那意味着

```
★★ 一个成员如果【不调 update_task】:
   · 它的任务永远停在 in_progress
   · ★ 而 kickTeam 不会因为它卡住而做任何事（★ 没有超时）
   · ★★ 而唯一的发现机制是【runtime.stall 判据】（★ 那是告警，不干预）
⇒ ★★★ 而那正是文献说的"neglect time" —— ★ 而我们【没有把它做成读数】
```

★ **而 `runtime.stall` 判据存在** —— **而它只报,不救。**
★★ **所以"成员静默卡住"这件事,今天【只能靠人看见】** —— **而那正是 UI 该补的。**

---

## 5. ★★★ 状态存在哪：**磁盘是唯一真相**

```
★ 每个工作区:<workspace>/.agent-teams/<teamId>/team.json
★★ 而聊天记录:<teamId>/inbox/*.jsonl
★ 而采集流:  .agent-teams/evolution/signals.jsonl
★★ 而审计:    .agent-teams/audit/workspace.jsonl（★ 今天加的）
```

### ★★★ 而"事件流"是【死的】

```
$ 宿主 KNOWN_SESSION_EVENT_TYPES ⇒ 59 个,含 agent-teams 的 【0】
⇒ ★★★ 所以 appendTeamEvent 发的【每一个】事件都被丢掉
★ 而 events.ts 的注释逐字承认了,并指出"磁盘状态才是权威源"
```

⇒ ★★ **所以架构是:【磁盘 = 真相,客户端 = 只读投影,事件流 = 装饰】。**
★ **而那是【对的】** —— 因为事件流不可靠,而磁盘在。

---

## 6. ★★★ 而 UI 从哪拿数据：**一条路**

```
服务端 HTTP:  GET /plugins/dsh-agent-teams/state
  ★ workspaceRegistry.list() ⇒ 【所有】已注册工作区
  ★ 每个区:collectTeamsActivity(ctx, roots)
  ★ 每个队:assembleTeamSnapshot ⇒ 成员 · 任务 · 判据 · 信箱 · 采集读数
  ▼ JSON
客户端:  activity-monitor.ts:689
  ★ body.teams as readonly ActivityTeam[]     ⇒ ★ 全量
  ★ useSyncExternalStore(...)                ⇒ ★ 12 个组件订阅同一份
```

⇒ ★★★ **所以【没有第二条路】** —— **而那是好的:一个真相源。**

★★ **而它是一个【轮询】（`activity-monitor` 定时拉）** ——
**★ 而不是推送。** 而那份调研提到别人用 SSE/WebSocket。

---

## 7. ★★★ 所以"运行架构"是三句话

```
① ★★ 它【不自己跑】—— 每次工具调用后 kickTeam 跑一轮
② ★★★ 成员是【真子代理】,而"完成"靠【成员自己上报】
③ ★ 真相在【磁盘】,客户端【只读】,事件流【不可用】
```

### ★★ 而三个结构性弱点（都是从上面推出来的）

| # | 弱点 | 为什么 |
|---|---|---|
| **①** | ★★★ **没有超时 / 没有救援** | 成员不调 `update_task` ⇒ 任务永远 in_progress ⇒ 只能靠人看见 |
| **②** | ★★ **没有推送** | 客户端轮询 ⇒ 状态最多晚一个轮询周期 |
| **③** | ★ **没有汇合点** | 非工具触发的逻辑（如 evaluator）永远不跑 |

---

## 8. ★★ 而这三条**恰好对上 UI 该呈现什么**

```
★ 弱点 ①（不知道谁卡住）⇒ ★★★ UI 最该回答:"谁需要你？"
★★ 弱点 ②（晚一个周期） ⇒ ★ 而那是可接受的（★ 人不需要毫秒）
★ 弱点 ③（没有汇合点）  ⇒ ★ 而那与 UI 无关（是后端问题）
```

⇒ ★★★ **所以 UI 的第一职责【不是画得好看】,而是【让"需要你"这件事跳出来】。**

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
