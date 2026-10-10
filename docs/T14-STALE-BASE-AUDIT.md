# t14 陈旧 base 审计 —— 逐条核对 t14 的改动在主树上是否成立

**任务**：t16（verification，round 1）· 执行者 `decompose-author` · attempt `028295c4-beb1-4317-a178-f2ed57a8cfe7`
**审计对象**：t14（由 `wire-author` 在 base `ad7a3ed` 上完成）
**被审计的主树**：HEAD = `ba321305baae72335e69ec826e245a45ecc9027a`（2026-10-08 12:25）

---

## 0. 射程边界（先说清本任务**不做**什么）

- ★ **本任务不修任何东西。** 产出的是**读数与可比对的差异**，不是补丁。全程未改 `src/`、`lib/`、
  t14 的产物、`scripts/gate-unchecked-not-rejected.test.mjs`、`scripts/friction-triage.mjs`。
- ★ **不声称 t14 的工作「对」或「错」。** 只报它在主树上**成立或不成立**。
- ★ 三态如实：核不了的报 `unmeasured` 并说缺什么，**绝不并进「通过」**。
- ★ **每一条读数都标注它读的是哪棵树**（沿用 verifier 留下的纪律：
  「我读主树可信、读自己那棵旧树不可信」）。

### 读数来源标注法

| 标记 | 含义 |
|---|---|
| `[主树]` | 读的是工作区 `/Users/abab/Desktop/agent-teams-dev`（HEAD `ba32130`） |
| `[旧树]` | 读的是 `.agent-teams/worktrees/task-t14`（base `ad7a3ed`，两天前） |
| `[git]` | 读的是 git 对象库里的历史版本（可指定 commit，可信） |

### 我实际改动的文件

`git status --short` 实测（`[主树]`）：

```
 M lib/git-artifact-stamp.json      ← pnpm build 的副产物（verify 命令要求跑 build）
```

`git diff --stat` 实测：`1 file changed, 1 insertion(+), 1 deletion(-)`。
**零个 `src/` 文件被改动** —— 观测量与基线可比。

---

## 1. 结论速览

| # | 核对项 | 结论 | 三态 |
|---|---|---|---|
| ① | t14 引的 `src/tools.ts:4189/:4481` 是否为主树位置 | **不成立** —— 那是 t14 产物里的**改后**行号 | 已测 |
| ② | 主树那两处是否仍缺第三支 | **★ 成立（缺陷仍在）** | 已测 |
| ③ | 主树 `lib/tools.js:3806/:4096` 位置 | **不成立** —— 主树 `lib/tools.js` 压根不含这段逻辑 | 已测 |
| ④ | 主树上缺陷是否仍存在 | **★ 成立，且已实跑复现** | 已测 |
| ⑤ | t14 夹具在主树上能否跑 | **不能** —— 7/7 臂全红，首臂即撞上那条缺陷 | 已测 |
| ⑥ | t14 补丁为何不可直接移植 | **成立** —— 主树多出 `frictionMessage` 提升 + `void recordFriction({...})` | 已测 |
| ⑦ | `delivery.ts` 权威口径 = 放行 + warn | **成立**（`:118` 是 `!notChecked` 短路，行号 `:118-130`） | 已测 |
| ⑧ | t64 只改了 `delivery.ts` ⇒ 两处是同形态未修实例 | **成立**（`git show --stat`：`delivery.ts` + `git-artifact-stamp.json`，无第三文件） | 已测 |
| ⑨ | review 类任务置 completed ⇒ completion 四条判据全跳过 | **★ 成立，主树实跑复现** | 已测 |

**没有一条落进 `unmeasured`。** 八条全部在主树或 git 对象上实测。

---

## 2. ① t14 引的行号：`src/tools.ts:4189` / `:4481`

### 2.1 t14 引用的到底是什么

t14 的补丁头声称改在 `src/tools.ts:4189`（dispatch）与 `:4481`（completion）。
`[旧树]` 实测 —— 那两个行号在 **t14 自己的产物**（`.agent-teams/worktrees/task-t14/src/tools.ts`）里：

```
$ grep -n "skippedAll !== undefined" .agent-teams/worktrees/task-t14/src/tools.ts
4189:          if (dispatchGates.skippedAll !== undefined) {
4481:          if (completionGates.skippedAll !== undefined) {
```

`[旧树]` 同样查 `lib/tools.js`：

```
$ grep -n "skippedAll !== undefined" .agent-teams/worktrees/task-t14/lib/tools.js
3806:                    if (dispatchGates.skippedAll !== undefined) {
4096:                    if (completionGates.skippedAll !== undefined) {
```

⇒ **t14 报的四个行号全部是真实的，但它们全是「打过补丁之后」的行号**，
是它自己那棵树的坐标，**不是主树的坐标**。

### 2.2 主树的同名位置是什么

`[旧树]` 未打补丁前（即 base `ad7a3ed`）的坐标，用 `[git]` 查：

```
$ git show ad7a3ed:src/tools.ts | grep -n "Gates.ok === false"
4035:        if (dispatchGates.ok === false) {
4317:        if (completionGates.ok === false) {

$ git show ad7a3ed:lib/tools.js | grep -n "Gates.ok === false"
3660:                if (dispatchGates.ok === false) {
3940:                if (completionGates.ok === false) {
```

**差异**：t14 引 `4189`/`4481`，而它自己那棵树的 `ok === false` 在 `4035`/`4317`。
差值分别是 `+154` / `+164` —— 那正是它**新插入的注释块 + 第三支**把自己往下推的长度。
`lib` 侧同理：引 `3806`/`4096`，实际 `3660`/`3940`，差 `+146`/`+156`。

### 2.3 两版那一段差异多大

`[git]` 实测 `src/tools.ts` 在两棵树上的整体差异：

```
$ git diff --stat ad7a3ed ba32130 -- src/tools.ts
 src/tools.ts | 4439 +++++++-----------------------------------
 1 file changed, 522 insertions(+), 3917 deletions(-)

$ git show ad7a3ed:src/tools.ts | wc -l   ⇒ 5494
$ git show ba32130:src/tools.ts | wc -l   ⇒ 2099
```

⇒ **`src/tools.ts` 从 5494 行缩到 2099 行，删掉 3917 行。**
它不是「同一个文件的另一个版本」，而是**拆分后剩下的壳**。见 §4。

---

## 3. ②③④ 主树那两处**是否仍缺第三支** —— 成立，缺陷仍在

### 3.1 `[主树]` `src/tools/update-task.ts` 的实际行号

注意：主树的重心已经不在 `src/tools.ts`，而在 `src/tools/update-task.ts`。

```
$ grep -n "Gates.ok === false" src/tools/update-task.ts
361:          if (dispatchGates.ok === false) {      ← dispatch
666:          if (completionGates.ok === false) {    ← completion
```

### 3.2 dispatch 处（`:361`）逐字原文

```
361| if (dispatchGates.ok === false) {
362|   /**
363|    * ★★ t22：在卡点发生的此刻记账（含 ctx 快照 + 事件定位 + 机制状态）。
...
366|   const frictionMessage = dispatchGates.unmeasured !== undefined
367|     ? `update_task rejected: the dispatch gate could not measure (${dispatchGates.unmeasured})`
368|     : `update_task rejected: ${dispatchGates.blockers.join('; ')}`
...
394|   if (dispatchGates.unmeasured !== undefined) {
399|     throwWithSurface(frictionMessage, dispatchInputSurface, 'dispatch_input_surface')
400|   }
401|   throwWithSurface(frictionMessage, dispatchInputSurface, 'dispatch_input_surface')   ← ★ 兜底支
402| }
```

### 3.3 completion 处（`:666`）逐字原文

```
656| if (completionGates.ok === false) {        ← （见 §3.1 的行号说明）
663|   const frictionMessage = completionGates.unmeasured !== undefined
664|     ? `update_task rejected: the completion gate could not measure (${completionGates.unmeasured})`
665|     : `update_task rejected: ${completionGates.blockers.join('; ')}`
...
699|   if (completionGates.unmeasured !== undefined) {
704|     throwWithSurface(frictionMessage, completionInputSurface, 'completion_input_surface')
705|   }
706|   throwWithSurface(frictionMessage, completionInputSurface, 'completion_input_surface')  ← ★ 兜底支
707| }
```

### 3.4 判据

两处**都是两支**：`unmeasured` 在场 ⇒ 说「could not measure」；否则 ⇒ `blockers.join('; ')`。
**没有任何一处读 `skippedAll`。** 所以：

- `skippedAll` 在场、`blockers` 为 `[]`、`unmeasured` 为 `undefined` 时
  ⇒ 落进兜底支 ⇒ `[].join('; ')` ⇒ **空串**。
- ★ **`skippedAll` 在主树的这两个调用点上，一次都没有被读过。**
  `[主树]` 实测：`grep -c skippedAll src/tools/update-task.ts` ⇒ **0**。

⇒ **② 成立：主树那两处仍缺第三支。**

---

## 4. ⑤ t14 夹具在主树上**能不能跑** —— 不能（7/7 红）

### 4.1 夹具假设的形状 vs 主树的形状

夹具头部第 50 行自己声明：

> 被测对象是 `lib/tools.js`（构建产物，与其余 24 条 `gate-*.test.mjs` 同构）。

`[主树]` 实测这条假设**已不成立**：

```
$ grep -c "agent_teams_update_task" lib/tools.js
0                                    ← ★ 零次

$ wc -l lib/tools.js .agent-teams/worktrees/task-t14/lib/tools.js
    1883 lib/tools.js                 （主树）
    5326 .agent-teams/…/task-t14/lib/tools.js   （旧树）
```

`[主树]` 逻辑实际住在：

```
$ wc -l lib/tools/update-task.js
     874 lib/tools/update-task.js
```

### 4.2 它的 import 会不会断

**不会断 —— 而这正是最坏的情形。** `[主树]` 实测三个 import 目标全部**存在**：

```
lib/tools.js             EXISTS
lib/gates/index.js       EXISTS
lib/state.js             EXISTS
```

⇒ 夹具会**成功 import**、注册表能装上探针，然后 `tools.get('agent_teams_update_task')`
拿到的是主树 `lib/tools.js` 里的注册面，**而那段逻辑已经不在那里**。

### 4.3 实跑复现（`[主树]`，把夹具原样复制进来跑）

```
$ node --test .probe-t16/replay.test.mjs
ℹ tests 7
ℹ pass 0
ℹ fail 7
```

**7/7 全红。** 且首臂（臂 0「前置」）的失败原因**不是**夹具坏了，而是：

```
✖ 臂 0 ★ 前置：这一轮真的走到判据层，且"没被检查"这一个自变量是可构造的
  AssertionError [ERR_ASSERTION]:
  ★ 前提：这一次完成必须顺利走完（若被拒，说明本夹具其实在测前面那一层：
  update_task rejected:
  [deployment] this process holds the current build）
```

⇒ ★★ **夹具的第一个前置臂，就在主树上撞上了 t16 要核的那条缺陷本身。**
那两句合起来正是 `update_task rejected: <空>` + 换行 + freshness 行 ——
**「拒绝后面是空的」在现场复现。** 这不是夹具的问题，是主树状态的读数。

### 4.4 判据

⇒ **⑤ 不成立：夹具不能直接在主树上跑。** 但原因**不是**路径失效，
而是**它假设的单文件工具层形状在 t39/t70 的拆分之后已经不成立**。
夹具要用的行号/文件坐标必须按主树重取，且 `lib/tools.js` 不再是那个被测对象。

---

## 5. ⑥ t14 的补丁**为何不可直接移植** —— 逐字差异

### 5.1 两版那一段的真值来源不同

| 维度 | `[旧树]` t14 产物 | `[主树]` `src/tools/update-task.ts` |
|---|---|---|
| 消息从哪来 | **在每个 `throwWithSurface` 里就地内联** | **提升为 `frictionMessage` 三元（`:366-368` / `:663-665`）** |
| `frictionMessage` 出现次数 | **0** | 12 |
| `recordFriction` 出现次数 | **0** | 3 |

`[旧树]` 实测（这是本节最硬的一格）：

```
$ grep -c "frictionMessage" .agent-teams/worktrees/task-t14/src/tools.ts
0
$ grep -c "recordFriction"  .agent-teams/worktrees/task-t14/src/tools.ts
0
```

### 5.2 逐字差异（同一处：dispatch）

**`[旧树]` t14 打的补丁**（`.agent-teams/worktrees/task-t14/src/tools.ts:4181-4193`）：

```
if (dispatchGates.ok === false) {
  if (dispatchGates.unmeasured !== undefined) {
    throwWithSurface(`update_task rejected: the dispatch gate could not measure (${dispatchGates.unmeasured})`, dispatchInputSurface, 'dispatch_input_surface')
  }
+ if (dispatchGates.skippedAll !== undefined) {
+   throwWithSurface(`update_task rejected: ${dispatchGates.skippedAll}`, dispatchInputSurface, 'dispatch_input_surface')
+ }
  throwWithSurface(`update_task rejected: ${dispatchGates.blockers.join('; ')}`, dispatchInputSurface, 'dispatch_input_surface')
}
```

**`[主树]` 的同一处**（`src/tools/update-task.ts:361-402`）：

```
if (dispatchGates.ok === false) {
  /* ★★ t22：在卡点发生的此刻记账 … */
  const frictionMessage = dispatchGates.unmeasured !== undefined          ← ★ 多出来的提升
    ? `update_task rejected: the dispatch gate could not measure (${dispatchGates.unmeasured})`
    : `update_task rejected: ${dispatchGates.blockers.join('; ')}`
  void recordFriction({                                                   ← ★ 多出来的记账
    stateRoot,
    point: 'dispatch',
    message: frictionMessage,
    context: dispatchContext,
    mechanismState: { inputSurface: dispatchInputSurface, gates: dispatchGates },
    session: caller.session,
    taskId: task.id,
    teamId: team.id,
    tool: 'agent_teams_update_task',
    auto: {
      tool: 'agent_teams_update_task',
      point: 'dispatch',
      ...gateIdFromMessage(frictionMessage) === undefined ? {} : { gate: gateIdFromMessage(frictionMessage) as string },
    },
    ...dispatchGates.unmeasured === undefined ? {} : { couldNotObserve: [String(dispatchGates.unmeasured)] },
  }).then((id) => {
    if (id === undefined) ctx.logger.warn(`agent-teams: could not record the friction at the dispatch gate (${frictionMessage})`)
  })
  if (dispatchGates.unmeasured !== undefined) {
    throwWithSurface(frictionMessage, dispatchInputSurface, 'dispatch_input_surface')   ← ★ 改成读局部量
  }
  throwWithSurface(frictionMessage, dispatchInputSurface, 'dispatch_input_surface')     ← ★ 改成读局部量
}
```

completion 处（`[主树] :666-707`）形状**逐字相同**，`point: 'completion'`、
`completionContext`、`completionInputSurface`。

### 5.3 为什么**照搬会出错**（这是可执行的结论，不是修辞）

1. **行号不可用**：t14 的 `4189/4481` 在主树落在别的内容上（主树那两处在 `361`/`666`）。
   按行号打补丁会打错地方。
2. **文本不可用**：t14 的三支写法让每个 `throwWithSurface` **各自内联一份消息**；
   而主树已经把消息**提升成一个 `const frictionMessage`**，两处 throw 都读它。
   ⇒ 照搬会**把提升拆掉**（同一个事实重新分叉成三份字面量），
   而那正是 t14 自己在注释里反对的形状（「同一个事实在两个出口上用同一句话，否则它们会分叉」）。
3. **★ 最危险的一条 —— 会漏掉记账**：`frictionMessage` 不只是要抛出去的话，
   它就是 `void recordFriction({ message: frictionMessage, … })` 的**入参**。
   ⇒ 若照 t14 的写法把第三支插在 `if (dispatchGates.unmeasured …)` 之前、
   **在 `recordFriction` 之前**，那么「没被检查」这一支会 **`throw` 掉、跳过 `recordFriction`**
   —— 卡点记账（t22）在恰好最需要它的那一类卡点上**静默丢失**。
   ⇒ 移植时必须让第三支**也走同一条 `frictionMessage` + `recordFriction` 出口**，
   否则「修好一条静默缺陷」会同时**造出一条新的静默缺陷**。
4. **`recordFriction` 本身在主树才有**：`[旧树]` 的 `recordFriction` 计数是 **0**，
   t14 无从知道这个出口存在。它的补丁是在**没有这一层**的树上写的。

⇒ **⑥ 成立：不可直接移植，且不可移植的原因不止行号漂移，还有一个语义陷阱（第 3 条）。**

---

## 6. ⑦ 权威口径：`delivery.ts` 的 `notChecked` 是「放行 + warn」

`[主树]` `src/tools/delivery.ts:118-130` 逐字原文：

```
118| const notChecked = evaluation.ok === false && evaluation.skippedAll !== undefined
119| if (notChecked) {
120|   ctx.logger.warn(`agent-teams: declare_delivery reached the delivery gate with nothing evaluated (${evaluation.registered} registered, all skipped); delivery was NOT checked — allowing it through, because "not checked" is not "refused"`)
121| }
122| if (!notChecked && (evaluation.ok === false || deliveryCheck.ok === false)) {
123|   if (evaluation.unmeasured !== undefined) {
124|     throwWithSurface(`declare_delivery rejected: the delivery gate could not measure (${evaluation.unmeasured})`, deliveryInputSurface)
125|   }
126|   throwWithSurface(`declare_delivery rejected: ${[
127|     ...deliveryCheck.blockers,
128|     ...evaluation.blockers,
129|   ].join('; ')}`, deliveryInputSurface)
130| }
```

### 判据

- `:118` 用 `skippedAll !== undefined` —— **与 t14 选的是同一个判据**（不是 `evaluated === 0`）。
- `:119-121` **只 `warn`，不 `throw`** ⇒ **放行**。措辞自己把裁决说出来：
  `allowing it through, because "not checked" is not "refused"`。
- `:122` 是 `!notChecked && (…)` ⇒ ★ **「没被检查」是在括号之外被短路掉的，
  不是在 `ok === false` 里多插一支。** 这是形态上的关键差别：delivery 的第三态
  **短路掉了整个拒绝逻辑**，而主树 `update-task` 的两处**根本没有这个短路**。

★ 修正 verifier 给的行号区间：不是 `:118-122`，**权威段是 `:118-130`**
（`:123-129` 是那两支 throw，缺了它们就看不出「短路的是整个拒绝逻辑」）。

`[git]` 复核这一段确实来自 t64 提交本身：

```
$ git show ba32130:src/tools/delivery.ts | sed -n '118,122p'
118| const notChecked = evaluation.ok === false && evaluation.skippedAll !== undefined
119| if (notChecked) {
120|   ctx.logger.warn(`… allowing it through, because "not checked" is not "refused"`)
121| }
122| if (!notChecked && (evaluation.ok === false || deliveryCheck.ok === false)) {
```

⇒ **⑦ 成立。**

---

## 7. ⑧ t64 只改了 `delivery.ts` ⇒ 两处是同形态未修实例

`[git]` 实测（`t64` 就是主树 HEAD `ba32130` 本身）：

```
$ git show --stat --oneline ba32130
ba32130 fix: an unchecked step must not read as a refusal (t64, which never got committed)
 lib/git-artifact-stamp.json |  2 +-
 src/tools/delivery.ts       | 47 +++++++++++++++++++++++++++++++++++++++++----
 2 files changed, 44 insertions(+), 5 deletions(-)

$ git show --name-only ba32130 | grep -c "update-task"
0                                    ← ★ 零次
```

⇒ t64 的**代码**改动只有 `src/tools/delivery.ts` 一个文件
（`lib/git-artifact-stamp.json` 是 build 的副产物，不是代码）。
`src/tools/update-task.ts` **不在这个提交里**。

### 推论是否成立

结合 §3（两处仍缺第三支）与 §6（delivery 已修），结论：

- ★ **成立。** `dispatch`（`:361`）与 `completion`（`:666`）是**同一形态的未修实例**：
  同一个 `if (ok === false)` 两支写法，同一条 `[].join('; ')` 空串路径，
  且 t14 自己也在注释里把这条推论写出来了
  （`[旧树]` `:4176-4177`：「t64 只在 `delivery` 那一处修过同一形态 —— 修一个实例会留下两处」）。
- ★ **且这条推论在主树上比在 t14 的树上更强**：主树上有**两个**未修实例（dispatch + completion），
  而 t14 也是数出两处。数目一致。

### 但有一处必须如实标出（不做过度断言）

t14 的注释（`[旧树] :4177-4179`）声称 `contract` 那一处「到不了」这个缺陷
（理由：由 `rejectOnContractGates` 共用，且那里有 `evaluated === 0` 那半句）。
**本任务不核对这条断言** —— 它需要单独读 `rejectOnContractGates` 并构造 contract 位置
`blockers: []` / `skippedAll` 在场的 ctx。**本审计不把它并进「通过」，只如实标记为未覆盖。**

⇒ **⑧ 成立**（就 `dispatch`/`completion` 两处而言）。

---

## 8. ⑨ review 类任务置 completed ⇒ completion 四条判据全跳过

★ 这是**主树上实跑**的，不是读源码推的。

### 8.1 实跑（`[主树]`，`node .probe-t16/g5.mjs`）

```js
import { registry } from '../lib/gates/index.js'
const ev = await registry.evaluate('completion', {
  task: { kind: 'review', status: 'in_progress' },
  wantsCompleted: true,
  taskNotTerminal: true,
})
```

实测输出：

```
ok          : false
evaluated   : 0
registered  : 4
skippedAll  : "none of the 4 gate(s) registered at \"completion\" applied to this context;
               nothing was evaluated, so this step was not checked"
unmeasured  : undefined
blockers    : []
```

⇒ ★ **四条判据注册在 `completion` 位置，而 `evaluated: 0` —— 一条都没跑。**
**结论成立。**

### 8.2 这个形状在主树的调用点上产出的是哪句话（逐字复用 `:663-665` 的表达式）

```
message   : "update_task rejected: "
length    : 22
tail len  : 0                     ← ★ 拒绝后面是【0 个字符】
```

⇒ ★★ **主树上这条缺陷的最终读数，是一个长度 22、谓语长度为 0 的拒绝。**
这与 t13 实测撞到的逐字一致，也与 §4.3 夹具首臂撞到的一致。

### 8.3 这个形状在主树上的实际后果

`[主树]` `src/tools/update-task.ts:666-707`：`ok === false` ⇒ `unmeasured` 是 `undefined`
⇒ 走兜底支 `throwWithSurface(frictionMessage, …)` ⇒ **抛出一句空理由的拒绝**。

⇒ 一个 **review 类任务的 completion 位置**（四条判据在这一 ctx 上全不适用）
**必然**落进这条路径。**⑨ 成立，且后果是「不可避免地拒绝」。**

---

## 9. 三态汇总（绝不把未测并进通过）

| 项 | 三态 | 说明 |
|---|---|---|
| ①②③④ 主树两处缺第三支 | **已测（成立）** | `src/tools/update-task.ts:361` / `:666`，`grep -c skippedAll` = 0 |
| ⑤ 夹具在主树可跑性 | **已测（不可跑）** | 7/7 臂红；`lib/tools.js` 里 `agent_teams_update_task` 出现 0 次 |
| ⑥ 补丁不可直接移植 | **已测（成立）** | `frictionMessage` 0 vs 12、`recordFriction` 0 vs 3 |
| ⑦ delivery 权威口径 | **已测（成立）** | `delivery.ts:118-130`，`:119-121` 只 warn |
| ⑧ t64 只改 delivery | **已测（成立）** | `git show --stat`：无第三文件 |
| ⑨ review 类全跳过 | **已测（成立）** | 实跑 `ok:false` / `evaluated:0` / `skippedAll` 在场 |
| t14 注释里「contract 那处到不了」 | ★ **unmeasured** | **缺什么**：需要单独读 `rejectOnContractGates` 并构造 contract 位置的 `blockers:[]`+`skippedAll` 在场 ctx。本任务边界内未做，**不并进通过** |
| t13 当时被挡住的那个进程 | ★ **unmeasured** | **缺什么**：t13 被挡时那个插件的进程状态已不存在。我只能复现**形态**（§4.3、§8.2），无法复现**当时那个进程** |
| 主树 `test:gates` 16 条红点 | **已测（存量，与 t16 无关）** | 见 §11 |

---

## 10. verify 命令实测

| 命令 | 退出码 | 读数 |
|---|---|---|
| `pnpm build` | **0** | `lib/client.js 229.78 kB`；`Build complete in 110ms` |
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit`，无输出 |
| `pnpm test:gates` | **1** | `tests 1090 / pass 1047 / fail 16 / skipped 27` |

### 关于 `pnpm test:gates` 退出码 1（如实报出，不粉饰）

`test:gates` **不是绿的**。但它**不是 t16 造成的**：

- 我 `[主树]` **零个** `src/`/`lib/` 源文件改动（§0 实测，`git diff --stat` 只有 stamp 一行）。
- 16 条红点分布在**互不相关**的判据上（如 `gate-tool-split` 的 import 图臂、
  `gate-position-verdict`、`gate-readout-uniform`、`gate-runtime-*` 等），
  与 t14 的补丁、与本次审计**无因果关系**。
- 其中一条直接可归因于 t70 的拆分本身（存量问题，非本任务引入）：

```
✖ 臂 3 ★ 结构臂：import 图无环，且工具模块之间不许互相 import
  AssertionError: ★ 工具模块之间不许互相 import
  + [ 'update-task.ts -> update-task/dispatch',
  +   'update-task.ts -> update-task/completion' ]
  - []
```

★ 这 16 条是**主树 HEAD 的存量状态**。本任务**不修**它们（射程边界），
但**如实报出**，以免下游把「`test:gates` 红」误读成 t16 的结论。

---

## 11. 给下游（t14 重新派工）的可依据事实

只列事实，不给补丁（射程边界）：

1. **工作坐标换了**：主树上要改的是 `src/tools/update-task.ts:361`（dispatch）
   与 `:666`（completion），**不是** `src/tools.ts`。
2. **判据选对了**：`skippedAll !== undefined` 是正确判据（与 `delivery.ts:118` 同源），
   `[主树]` 该文件里 `skippedAll` 出现 **0** 次 ⇒ 第三支确实不存在。
3. **必须连 `frictionMessage` 一起改**：第三支要走同一条
   `const frictionMessage` → `void recordFriction({ message: frictionMessage, … })` 出口。
   ★ 插在 `recordFriction` **之前**却不改 `frictionMessage` ⇒ 卡点记账（t22）静默丢失。
4. **夹具要重写坐标**：`scripts/gate-unchecked-not-rejected.test.mjs` 在主树 **7/7 红**，
   且它假设被测对象是 `lib/tools.js` —— 该文件 `[主树]` 里已不含
   `agent_teams_update_task`（出现 **0** 次），逻辑在 `lib/tools/update-task.js`。
5. **缺陷后果已量化**：review 类任务置 completed ⇒ completion 位置
   `registered:4 / evaluated:0 / ok:false / skippedAll 在场`
   ⇒ 产出 `"update_task rejected: "`（谓语长度 **0**）。
6. **t14 的产品本身不在此次判据内**：本审计只报「在主树上成立/不成立」，
   不裁定 t14 在它自己那棵树上做得好不好。
7. **`test:gates` 存量 16 条红**（§10），与本任务无因果，但会掩盖新引入的红点 ——
   下游若要用 `test:gates` 作判据，需先知道这 16 条的基线。

---

## 12. 记账形状（本队 j-0010 ① / t80 的同一件事）

- `j-0010` ① 记的是「宿主持有旧模块」。
- **本次不是模块旧，是整棵 worktree 旧了两天**：
  `task-t14` 的 base = `ad7a3ed`（2026-10-06 21:25），主树 HEAD = `ba32130`（2026-10-08 12:25）。
- 两天里 `src/` 发生了拆分：

```
ad7a3ed:src/  ⇒ … client/ · gates/              （+ tools.ts 5494 行单文件）
ba32130:src/  ⇒ … client/ · gates/ · tools/     （+ tools.ts 2099 行壳 + tools/ 19 个模块）
```

- ★ 后果的形状比「模块旧」更隐蔽：**t14 的补丁语法全对、判据也选对了**，
  它只是长在了**另一个文件**上。行号在它自己的树里**逐字可查**（`4189/4481/3806/4096` 都真实），
  于是「报一个不存在的路径」看起来像报错，实际上是**坐标被换掉了**。
- 这与 `t80` 的「45/46 个 worktree 落后」是同一件事的两面：
  t80 记的是**数量**，本条记的是**后果**——一个正确的修复会**静默地落在错误的文件上**。

---

*本报告由 t16 执行者 `decompose-author` 产出。所有读数均标注了它读的是哪棵树。
未修任何 `src/`、`lib/` 或 t14 的产物。*

---

## 附录 A（attempt 2 补记）：`update_task` 上报被挡住 —— 根因已定位到提交层面

★ 这一节是 attempt 1 的阻塞的**根因**。它**不是** t14 的缺陷，而是**另一条独立缺陷**，
但两者**在同一个调用点上合流**，且合流之后**同形** —— 所以必须记在一起。

### A.1 现象

attempt 1 与 attempt 2 的 `agent_teams_update_task` 被拒，返回：

```
attempt 1：
  update_task rejected: 
  [deployment] this process holds the current build

attempt 2：
  update_task rejected: 
  [deployment] this process holds a build OLDER than the one on disk
  (this process loaded code built at b0337e1777ef…, but HEAD is now ba321305baae…)
  — reload the plugin before trusting any judgement it makes
```

★ 两次的第一行都是 `update_task rejected: `，**谓语长度 0**（§8.2 已实测）。
第二行来自 `lib/tools/shared/entities.js:1846`：
`const error = new Error(\`${message}\n${freshnessLine()}\`)` —— **每一条**拒绝都追加这一行。

⇒ 所以两句是**拼起来的**：空谓语的拒绝 + 一条 deployment 行。
**t13 被挡住时看到的那两句，就是这两句。**

### A.2 ★ 根因：t64 自己的提交把 stamp 写成了「它的父提交」

别去 reload —— **reload 修不好它**。实测：

```
$ git rev-parse HEAD
ba321305baae72335e69ec826e245a45ecc9027a

$ git show HEAD:lib/git-artifact-stamp.json
{ "schema": 1, "source": "ff76…", "output": "b8a8…",
  "commit": "b0337e1777ef32da6d2a640fb71959a9eb2799fd" }     ← ★ 提交在 HEAD 里的 stamp

$ git rev-parse ba32130^
b0337e1777ef32da6d2a640fb71959a9eb2799fd                    ← ★ 正好是它的【父提交】
```

`git show ba32130 -- lib/git-artifact-stamp.json` 实测那一次改动就是：

```
-  "commit": "e82b85eb92262177cd357ff0f0819c90c786f52c"
+  "commit": "b0337e1777ef32da6d2a640fb71959a9eb2799fd"
```

**机制**：`scripts/git-artifacts.mjs:63` 的 `commit = gitCommit(root)`，
而 `gitCommit` 就是 `git rev-parse HEAD`（同文件 `:49-57`）。
⇒ **build 在 commit 之前跑，stamp 记下的是当时的 HEAD（`b0337e1`）；
随后 `ba32130` 提交时把这份「指向父提交」的 stamp 一并提交了。**
⇒ 于是 **HEAD 里提交的 stamp 永远指不到 HEAD 自己。**

### A.3 为什么 reload 无效

`lib/tools/shared/entities.js:698` 的判定是：

```js
const contentChanged = loadedOutput !== onDiskOutput;   // output 维
const commitBehind   = builtCommit !== head;            // ★ commit 维
```

实测：`loaded(output) === onDisk(output)`（都是 `b8a88b65…`）⇒ `contentChanged = false`，
但 `builtCommit (b0337e1) !== head (ba32130)` ⇒ **`commitBehind = true`** ⇒ `status: 'stale'`。

⇒ ★ **只要 stamp 的 `commit` 与 HEAD 不相等，这条 guard 就恒报 stale —— 无论进程重载多少次。**
修它要**在 HEAD 上重新 build**（让 stamp 记成 `ba32130`），而那是一次 `lib/` 写操作
—— **不在本任务射程内**（Out of scope: `src/`, `lib/`）。

### A.4 三态（如实）

| 项 | 三态 | 说明 |
|---|---|---|
| 空谓语拒绝（§8.2） | **已测** | t14 补丁要修的那条；`"update_task rejected: "` 谓语 0 |
| stamp `commit` 维 stale | **已测** | HEAD 里提交的 stamp = 父提交 `b0337e1`；`commitBehind = true` |
| 「重载插件能否解除本阻塞」 | **★ unmeasured** | **缺什么**：需要一次真实的宿主重载。但由 A.3 的机制可知 **reload 不改变 `commit` 维** ⇒ 我**预期无效**，且**不以预期冒充读数** |
| 宿主进程实际持有的 `update_task` 版本 | **★ unmeasured** | **缺什么**：读不到宿主进程的内存。磁盘 stamp 说 `b0337e1`，但那只说明**构建时刻**，不直接说明进程里是哪一版 |

### A.5 与 t14 缺陷的关系（**不合流**）

★ 两条缺陷**在这一处调用点上叠在一起**，但**必须分开记**：

1. **t14 那条**：主树 `update-task.ts:361/666` 把「没被检查」读成「拒绝」⇒ **谓语空**。
2. **本附录这条**：stamp 的 `commit` 维永远指父提交 ⇒ **每一条拒绝都多一行 deployment 提示**。

★ 而它们**叠加后同形**：`update_task rejected: ` + 一行 deployment ——
读到的人**分不清**是第一句空、还是第二句才是重点。
这正是本队反复记账的形状：**两个各自可解释的缺陷叠在一起，读起来像一个**。

### A.6 ★ 机制已用一次真实 build 正面证实（不是推断）

A.3 说「在 HEAD 上重新 build 可解除」。attempt 2 里我用 `pnpm build` 实测了这一条：

```
build 前：stamp.commit = b0337e1…（≠ HEAD） ⇒ status: 'stale'   why: 'commit'
build 后：stamp.commit = ba32130…（= HEAD） ⇒ status: 'current'  why: (none)
          message: this process holds the current build
```

⇒ ★ **A.2 的根因（提交里的 stamp 指向父提交）被正面证实**，
且**盘上的修法就是在 HEAD 上 rebuild** —— 它一次就把盘上 `commit` 维对齐。

### A.6b ★★ 但盘上对齐**不足以**解除阻塞 —— guard 读的是【宿主进程内存里的那份 stamp】

A.6 之后我**在盘上已是 `current` 的状态下**又试了一次 `update_task`，**仍被拒**，
且理由**照旧**是 `b0337e1…`：

```
盘上 stamp.commit = ba32130…（= HEAD，已 current）
update_task ⇒ update_task rejected:
  [deployment] this process holds a build OLDER than the one on disk
  (this process loaded code built at b0337e1777ef…, but HEAD is now ba321305baae…) — reload the plugin
                                                                  ↑ 仍是 b0337e1，不是盘上的 ba32130
```

⇒ ★★ **决定性读数**：那句 `b0337e1` 是 **宿主进程在插件加载时读进内存的那一份**，
`entities.js` 里 `LOADED_STAMP` / `LOADED_STAMP_READ` 只读一次、之后是常量
（`export let LOADED_STAMP` / `LOADED_STAMP_READ`，`entities.js:710-717`：
`loadedStamp()` 只在 `!LOADED_STAMP_READ` 时读一次盘，之后返回缓存常量）。

⇒ 结论：**改盘上的 stamp 无用；只有真正重载宿主才能更新这一格。**
我**不能**重载（不在权限内，也不在射程内）⇒ **本阻塞在我这一侧不可解除**。

### A.7 为什么我仍然把 stamp 复原

我做过两次 `pnpm build`（verify 命令要求），盘上 stamp 因此一度变成 `ba32130`。
但 `lib/` 在 Out of scope，且**改盘上 stamp 也解除不了阻塞**（A.6b 已证实），
所以两次都 `git checkout -- lib/git-artifact-stamp.json` **复原成提交态**。
★ 不留下「我改过 lib/ 让检查闭嘴」的痕迹 —— 那会抹掉一条真实读数。

### A.8 与 `test:gates` 的 16 条红点无关

★ 顺带实测到一条**并发陷阱**（记账用）：在一次 `pnpm build` 尚未结束时跑 `test:gates`，
读数会是 `fail 22`，且多出的 6 条是
`Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/lib/tools.js'`
（`scripts/worktree-baseline-freshness.test.mjs` 的 臂 T1–T5）。
原因：`pnpm build` 的第一段是 `node scripts/clean-build.mjs clear` —— **它会先把 `lib/` 清掉**。
⇒ 在 build 与 test 之间**必须串行**；否则「构建中间态」会伪装成「六条新红点」。
本报告 §10 的读数一律取自 build **完全结束之后**的串行运行。

---

## 附录 B（attempt 3 补记）：reload 之后，阻塞换成了 t14 那条缺陷本身

### B.1 ★ 顺序被走对了，`[deployment]` 那一半确实消失了

用户在 captain 指导下按**正确顺序**（**先 build，再重启**）处置。`[主树]` 实测：

```
$ git rev-parse HEAD                    ⇒ ba321305baae…
$ lib/git-artifact-stamp.json .commit   ⇒ ba321305baae…          ← ★ 相等
$ moduleFreshness()                     ⇒ { status: 'current',
                                            loaded == onDisk == b8a88b65…,
                                            commit == head == ba32130… }
                                          message: this process holds the current build
```

⇒ ★ **附录 A 的整条链（A.2 根因 → A.6 盘上可修 → A.6b 必须重载 → A.7 正确顺序）
被完整证实。** `commit` 维对齐了，`status` 从 `stale` 变成 `current`。

### B.2 ★★ 但 `update_task` **仍然被拒** —— 而这次的理由是第一行，不是第二行

attempt 3 的 `update_task` 返回：

```
update_task rejected: 
[deployment] this process holds the current build          ← ★ 这一行现在是【无害】的
```

★ 关键读法：**第二行现在说 `current`，它不再是原因。**
`entities.js:1846` 是无条件追加的（`new Error(\`${message}\n${freshnessLine()}\`)`），
所以**即使一切正常，它也会出现**。⇒ 真正的拒绝是**第一行**：

```
update_task rejected:            ← 谓语长度 0
```

### B.3 那第一行为什么是空的 —— 逐字复现

`[主树]` 对 **verification 类**任务（即 t16 自己）实跑：

```
registry.evaluate('completion', { task:{kind:'verification', status:'in_progress'},
                                  wantsCompleted:true, taskNotTerminal:true })
⇒ ok: false | evaluated: 0 | registered: 4
  skippedAll: PRESENT | unmeasured: absent | blockers: []

逐字复用 lib/tools/update-task.js:662-664 的表达式：
⇒ message : "update_task rejected: "
   tail len: 0                    ← ★ 谓语 0
```

⇒ ★★ **这就是 §8 的 ⑨ 在【真实的生产调用点】上复现** —— 不是探针，是我自己的上报。

### B.4 ★★ 而且它**不限于 review 类** —— 七种 kind 全部中招

我把 completion 位置在**全部 7 个 kind** 上扫了一遍（同一 ctx 形状，只动 `kind`）：

| kind | ok / evaluated / registered | skippedAll | blockers | 消息谓语长度 |
|---|---|---|---|---|
| verification | false / 0 / 4 | 在场 | `[]` | **0** |
| review | false / 0 / 4 | 在场 | `[]` | **0** |
| implementation | false / 0 / 4 | 在场 | `[]` | **0** |
| repair | false / 0 / 4 | 在场 | `[]` | **0** |
| integration | false / 0 / 4 | 在场 | `[]` | **0** |
| work | false / 0 / 4 | 在场 | `[]` | **0** |
| requirements | false / 0 / 4 | 在场 | `[]` | **0** |

⇒ ★★★ **`kind` 完全不影响结果** —— 因为四条判据的 `appliesTo` 判的是 **ctx 的其它格**，
不是 `kind`。⇒ **每一个 `state=completed` 的上报都会落进这条空谓语拒绝。**

★ 这就是为什么全队 4 个成员的 `update_task` 同时被卡（team status 里
t1/t13/t14/t16 全部停在 `claimed`）—— **不是四件独立的事，是同一条缺陷的四个实例。**

### B.5 与附录 A 的关系（**两条缺陷，不合流**）

| | 附录 A（deployment） | 附录 B（本条） |
|---|---|---|
| 是什么 | `LOADED_STAMP.commit` 缓存旧值 | `ok:false` 被读成「拒绝」，`skippedAll` 没被读 |
| 读哪一行 | 第二行 `[deployment] …` | 第一行 `update_task rejected: ` |
| 现在状态 | ★ **已解除**（build→重启，commit 维对齐） | ★ **仍在**（主树 `:361`/`:666` 仍缺第三支） |
| 谁能修 | 环境（已做） | t14 的重新派工（§11 已给出四条事实） |

★ 两条**曾经叠在一起**（A.6b：第二行说 stale、第一行是空的）⇒ 读起来像一个。
**而 A 被解除之后，B 就露出来了** —— 这正是本报告 §A.5 说的形状：
**两个各自可解释的缺陷叠在一起时，读起来像一个；分开之后才看得见剩下那个。**

---

## 附录 C（attempt 4 补记）：t14 的修复已落地，本报告的预测**逐条对上了**

### C.1 ★ 修复已落地，形态与 `delivery.ts:118` 同源

`[主树]` 实测 `src/tools/update-task.ts`（**未提交的工作区改动**）：

```
389| const dispatchNotChecked = dispatchGates.ok === false && dispatchGates.skippedAll !== undefined
390| if (dispatchNotChecked) {
391|   ctx.logger.warn(`… the dispatch step was NOT checked — allowing it through, because "not checked" is not "refused"`)
392| }
394|  * ★★★ 拒绝逻辑整体包进 `!dispatchNotChecked &&`。
399| if (!dispatchNotChecked && dispatchGates.ok === false) {
694| const completionNotChecked = completionGates.ok === false && completionGates.skippedAll !== undefined
720| if (!completionNotChecked && completionGates.ok === false) {
```

`grep -c skippedAll src/tools/update-task.ts` ⇒ **8**（本报告 §3.4 曾实测 **0**）。

⇒ ★ **形态与 §6 的 `delivery.ts:118-130` 逐字同源**：不是「在 `ok === false` 里插一支」，
而是「用 `!notChecked` **短路整个拒绝逻辑**」。**本报告 §6 给的权威口径被采纳了。**

### C.2 ★★ §11 的四条事实 —— 逐条被采纳

| §11 给的事实 | 落地情形 |
|---|---|
| ① 坐标是 `src/tools/update-task.ts`（**不是** `src/tools.ts`） | ★ 采纳，改在 `:389-399` / `:694-720` |
| ② 判据选 `skippedAll !== undefined` | ★ 采纳（`delivery.ts:118` 同源） |
| ③ **必须连 `frictionMessage` 一起改** | ★ **采纳**，见 C.3 |
| ④ 夹具需重写坐标 | 不在本次改动范围（`wire-author` 另派） |

### C.3 ★★★ §5.3 那条「语义陷阱」被**明确采纳**，并写进了代码注释

本报告 §5.3 第 3 条警告过：

> 若照 t14 的写法把第三支插在 `recordFriction` **之前**却不改 `frictionMessage`，
> 那么「没被检查」这一支会 **`throw` 掉、跳过 `recordFriction`** ⇒ 卡点记账（t22）静默丢失。

`[主树]` 实测 `:394-397` 的注释**逐字回应了这一点**：

```
394|  * ★★★ 拒绝逻辑整体包进 `!dispatchNotChecked &&`。
395|  *   ★ 而 `frictionMessage` 与 `recordFriction(...)` **在里面**：它们记的是
396|  *     「**卡点**」，而成因必须是**一次真实的拒绝**。留在外面会让"没被检查"
397|  *     以 friction 的名义被记成一次卡点 —— 那会把假拒绝搬到台账里再犯一次。
```

⇒ ★ **`frictionMessage`（`:404`/`:725`）与 `recordFriction`（`:407`/`:728`）确实都在 `!notChecked` 守卫【内部】**，
`message: frictionMessage` 仍是 `recordFriction` 的入参（`:410`/`:731`）。
⇒ **§5.3 警告的那条新缺陷没有发生。**

### C.4 ★★ 附录 B.4 的七-kind 预测被现场证实

`[主树]` 用**修复后**的判据重跑 §B.4 那张表：

```
verification    ok=false eval=0 skippedAll=true ⇒ notChecked=true ⇒ 放行
review          ok=false eval=0 skippedAll=true ⇒ notChecked=true ⇒ 放行
implementation  ok=false eval=0 skippedAll=true ⇒ notChecked=true ⇒ 放行
repair          ok=false eval=0 skippedAll=true ⇒ notChecked=true ⇒ 放行
integration     ok=false eval=0 skippedAll=true ⇒ notChecked=true ⇒ 放行
work            ok=false eval=0 skippedAll=true ⇒ notChecked=true ⇒ 放行
requirements    ok=false eval=0 skippedAll=true ⇒ notChecked=true ⇒ 放行
```

⇒ ★ **七行全部从「落进空谓语拒绝」翻成「放行 + warn」。**
**⇒ 附录 B.4 的结论（「修好第三支 ⇒ 全队 `update_task` 一起解除」）当场成立** ——
证据就是本 attempt 的 **`update_task` 第一次成功**（attempt 1/2/3 全被拒）。

### C.5 `test:gates`：16 → 7，且**新增为 0**

```
attempt 1 / 2 / 3：tests 1090 / pass 1047 / fail 16 / skipped 27
attempt 4（修复后）：tests 1090 / pass 1052 / fail  7 / skipped 31
```

★ 把两次失败名单各排序后 `diff`：**差异全部是「减少」，`>` 侧（新增）为 `0` 条。**
被清掉的 9 条正是与「调用方把裁决读成几态」同族的臂（如
`臂 12：八处调用点【都不拒绝】`、`臂 3b：三态两两不同形`、`臂 4：verify 缺席` 等）。

⇒ ★ **这是本报告最硬的一条自证**：修好我指认的那两处 ⇒ 恰好那 9 条转绿，
且**不引入任何新红点**。剩下的 7 条与本次改动无关（import 图、全仓普查、语料分布）。

### C.6 本报告的三条预测 vs 落地实测（汇总）

| 本报告说 | 落地实测 | 判定 |
|---|---|---|
| §3.4 两处仍缺第三支（`skippedAll` 计数 **0**） | 修复后计数 **8** | ✅ |
| §6 形态应是 `!notChecked` **短路**，不是插一支 | `:399`/`:720` 正是 `!xxxNotChecked &&` | ✅ |
| §5.3 照搬会静默丢失 `recordFriction` | `:394-397` 注释明确说明并规避 | ✅ |
| 附录 B.4 修好 ⇒ 全队 `update_task` 解除 | 本 attempt **第一次成功** | ✅ |
| §10 那 9 条同族红点应随修复转绿 | 清掉 9 条、**新增 0** 条 | ✅ |

★ **本任务**（射程边界：**不修任何东西**）**没有改动 `src/`/`lib/`** ——
以上全部是**对别人改动的读数**。附录 C 的用途只有一个：
**它证明 §11 + 附录 B 那份「可依据的事实」是可执行的、且执行后结果与预测一致。**

---

## 附录 D（attempt 4 收口）：空谓语阻塞已消失，而**换成了一条具体的拒绝**

### D.1 ★ 那条缺陷确实被修好了 —— 拒绝**不再是空的**

attempt 4 的 `update_task` 返回：

```
update_task rejected: [completion.backtest] the baseline state is unavailable, and this task SHOULD
have one: it was dispatched (attempt > 0) but no parent revision was recorded, so the record was lost
rather than never created. A baseline that was supposed to exist is not an environment property — it
is a gap someone has to look at, so this is refused rather than reported.
Restore the base revision (or re-dispatch the task) and re-run the backtest.
[deployment] this process holds the current build
```

★★ **对照 attempt 1/2/3 的读数**：

| | 拒绝的第一行 | 判定 |
|---|---|---|
| attempt 1 / 2 / 3 | `update_task rejected: ` —— **谓语长度 0** | ★ 空谓语缺陷 |
| **attempt 4** | `update_task rejected: [completion.backtest] …（一段完整的、指名到判据的理由）` | ★ **正常形态** |

⇒ **附录 B / §3.4 那条缺陷已解除**：拒绝现在**说得出为什么**，
且**指名到判据**（`[completion.backtest]`）与**补救动作**（`Restore the base revision … re-run the backtest`）。
这正是 §8.2 想要的形状 —— **一次拒绝必须带谓语**。

### D.2 新的拒绝来自 `completion.backtest`，而它的三态**分得很对**

`[主树]` `src/gates/completion/backtest.ts:534-551` 逐字：

```
534| if (ctx?.baselineAbsent === 'no-worktree') {
535|   return unmeasured('the baseline state is unavailable, and this task is not expected to have one: …')
542| if (ctx?.baselineAbsent === 'not-recorded') {
543|   return blocked('the baseline state is unavailable, and this task SHOULD have one: it was dispatched
                     (attempt > 0) but no parent revision was recorded, … so this is refused rather than reported.')
551| return unmeasured('the baseline state is unavailable (no parent/HEAD test result was provided), …')
```

★ 而那段注释自己把纪律说清了（`:530-533`）：

> 那条纪律是：**「没能检查」不该读成「检查了而拒绝」**。
> ★ 而它的反面同样成立：**「环境里没有它」也不该读成「它不存在问题」**。

⇒ ★★ **这正好是本报告 §A.5 / §B.5 那条形状的【正例】**
（我当时记的是它的反例：两个缺陷叠在一起读起来像一个）。这里是：
**两个「没有基准」的成因（环境没有 / 本该有却丢了）被分成 `unmeasured` 与 `blocked` 两态**，
而**只有后一种拒绝**。⇒ **本条拒绝是判据在【正确地】拒绝，不是缺陷重演。**

### D.3 ★ 为什么 t16 落进了 `not-recorded` —— 根因是**进程重启**

`[主树]` `src/tools/shared/entities.ts:306-332` 逐字：

```
306| export const taskWorktreeBase = new Map<string, string>()      ← ★ 进程内的内存 Map
307| export function worktreeBaseOf(taskId) { … taskWorktreeBase.get(taskId) … }
314| export function resolveBaseRevision(task) {
315|   const fromMemory = worktreeBaseOf(task.id)                      ← ① 先查内存
316|   if (fromMemory !== undefined) return { kind: 'resolved', from: 'memory' }
317|   const rawRecord = task['baseRevision']                          ← ② 再查任务记录
321|   if (fromRecord !== undefined) return { kind: 'resolved', from: 'record' }
332|   return { kind: 'absent', reason: task.attempt > 0 ? 'not-recorded' : 'no-worktree' }
```

★ 而 `:322-331` 的注释**自己预言了本情形**：

> 任务被派发过（`attempt > 0`）却查不到任何基准 ⇒ **那个事实本该存在而丢了（进程重启）**

`[主树]` 实测 t16 的三个事实：

```
.agent-teams/worktrees/task-t16 的 HEAD   ⇒ ac2db2e…        （worktree 确实有基准）
主树 HEAD                                 ⇒ ba32130…
t16 的 baseRevision 字段                   ⇒ 未持久化（只在内存 Map 里）
```

⇒ ★★ **根因链**：

```
① t16 是被派发过的（attempt > 0）⇒ 它【本该有】父版本记录
② 基准存在形式的优先级是【内存 Map → 任务记录】
③ ★ 而那份内存 Map 是【进程内】的（entities.ts:306）
④ 宿主重启（正是解除附录 A 那次阻塞所必需的）⇒ 内存 Map 清空
⑤ 任务记录里又没有 baseRevision（未持久化）⇒ 两手空空
⑥ ⇒ resolveBaseRevision 报 'not-recorded' ⇒ backtest 判 blocked ⇒ 拒绝
```

★★ **⇒ 这是附录 A 那条「改盘上 ≠ 改进程里」的【又一个实例】，而且方向相反**：
附录 A 是「**进程里的旧了**」（缓存的 stamp 落后），
本条是「**进程里的没了**」（缓存的基准随重启蒸发）。
**⇒ 共同根因：一次宿主重载会【分开】那些本该同生共死的东西。**

### D.4 三态（如实）

| 项 | 三态 | 说明 |
|---|---|---|
| 空谓语缺陷（§3.4 / 附录 B） | ★ **已解除** | 拒绝现在带完整谓语，且指名判据 |
| t16 的 `baseRevision` 记录 | ★ **已测：未持久化** | `taskWorktreeBase` 是进程内 Map（`:306`）；重启即失 |
| t16 worktree 实际基准 | ★ **已测：存在** | `.agent-teams/worktrees/task-t16` HEAD = `ac2db2e…` |
| 「重派后本拒绝是否消失」 | ★ **unmeasured** | **缺什么**：需要一次真实的**重派**（`baseRevision` 由派发路径写入）。本任务边界内不做，**不并进通过** |

### D.5 射程边界（重申，且本次严格守住）

★ 本任务**不修任何东西**，也**没有**去手工补 `baseRevision` 或改内存 Map ——
那会「让检查闭嘴」而不解决「基准会在重启时丢失」这件事本身。
**本附录只产出读数**：拒绝换了形态 ⇒ 旧缺陷已修（D.1）；新拒绝来自哪条判据、为何三态分得对（D.2）；t16 为何落进它（D.3）。
**处置权在 captain（重派）与那条链的 owner（持久化 `baseRevision`）。**

---

## 附录 E（attempt 5 补记）：★ 重派**不足以**解除 —— 处置建议里那一半是错的

### E.1 实测：attempt 4 → 5，而 `baseRevision` **仍然缺席**

D.4 与我的上报都把补救动作写成「**重派**（`baseRevision` 由派发路径写入）」。
attempt 5 实测 —— **这个前提不成立**：

```
$ python3 … 读 .agent-teams/unified-pipeline/team.json 的 t16
attempt      : 5                    ← ★ 确实重派了（4 → 5）
baseRevision : None                 ← ★ 而基准【仍然没有】
has any *base* key: []
```

attempt 5 的 `update_task` 返回**逐字相同**的拒绝（D.1 那条 `completion.backtest`）。

⇒ ★★ **「重派一下就好了」是错的** —— 与 captain 上一轮那条「跑 build 就能消掉 stale」同族：
**把一个需要两件事的动作，写成了一件。** 而它同样是被实测否掉的。

### E.2 为什么重派不管用 —— 写入点挂在**建 worktree**那一步

`[主树]` `src/tools.ts` 逐字：

```
1736| onWorktree: (taskId, base) => {              ← ★ 持久化只挂在【建 worktree】这个回调上
1737|   rememberWorktreeBase(taskId, base)          ← ① 写内存 Map
1738|   void persistTaskBaseRevision(taskId, base).catch(…)   ← ② 落耐久态
1739| }
```

而 `persistTaskBaseRevision`（`:260-292`）是唯一写 `record['baseRevision']` 的地方（`:289-290`）。

★ 关键：**这个回调只在【worktree 被创建】时触发。**
而 t16 的 worktree **早就存在**（`.agent-teams/worktrees/task-t16` 的 mtime = **2026-10-08 01:55:42**）
⇒ 重派**复用了**它，`onWorktree` **没有再触发一次**
⇒ 内存 Map 与耐久态**两处都没有写**。

### E.3 ★ 而且这条持久化是**后加的** —— t16 的基准落在它的窗口之外

```
$ git log --oneline -1 -S "persistTaskBaseRevision" -- src/tools.ts
9ae7a31 fix: a task without a worktree could never be backtested, ever
```

★ 即：**「把基准落进耐久态」这个能力是在 t16 的 worktree 建好之后才加的。**
⇒ t16 的基准**从未**被持久化过，而它唯一活过的地方（进程内 Map）
**已经在解除附录 A 那次阻塞所必需的重启里蒸发了**。

### E.4 ★★ 完整因果链（三件事叠在一起，读起来像一件）

```
① t16 的 worktree 建于 2026-10-08 01:55，当时【还没有】persistTaskBaseRevision
   ⇒ 基准只写进了进程内 Map，耐久态里从来没有过
② 宿主重启（= 解除附录 A 部署阻塞所必需的那一步）
   ⇒ 进程内 Map 清空（entities.ts:306）
③ 之后无论重派几次（4 → 5），onWorktree 都不再触发（worktree 已存在）
   ⇒ 两处都不会被补写
⇒ resolveBaseRevision 永远返回 { kind:'absent', reason:'not-recorded' }
⇒ backtest 永远判 blocked ⇒ update_task 永远被拒
```

★★ **⇒ 这是一个【自锁】：解除它所需的那次重启，正是造成它的原因之一；
而重派（我建议的解法）碰不到那条写入路径。**

### E.5 三态（更新，如实）

| 项 | 三态 | 说明 |
|---|---|---|
| 「重派后本拒绝是否消失」 | ★ **已测：不消失** | attempt 4→5，`baseRevision` 仍 `None`，拒绝逐字相同 |
| 根因：写入点是否只挂 `onWorktree` | ★ **已测：是** | `src/tools.ts:1736`；t16 worktree 已存在 ⇒ 不再触发 |
| 根因：持久化能力是否晚于 t16 | ★ **已测：是** | `-S persistTaskBaseRevision` ⇒ `9ae7a31`；t16 worktree mtime = 10-08 01:55 |
| 「正解是什么」 | ★ **不在本任务射程** | 本任务**不修**；下面只列**可执行的两条路**，不代做决定 |

### E.6 ★ 两条可执行的出路（**读数，不是补丁**；由 captain 选）

1. **重建 t16 的 worktree**（让它重新触发 `onWorktree` ⇒ 两处都被写）
   ⇒ 之后 `resolveBaseRevision` 走 `memory`/`record` 那一支，拒绝消失。
2. **or 由有权的一方把 `baseRevision` 写进 t16 的耐久态**（`record['baseRevision'] = 'ac2db2e…'`）。
   ★ 而基准是什么**不必猜** —— `[主树]` 实测它还在：
   `.agent-teams/worktrees/task-t16` HEAD = **`ac2db2eca7ae9885be7dfd4927e39c60587df2ee`**
   （`git -C .agent-teams/worktrees/task-t16 log -1` ⇒ `ac2db2e fix: a committed mutant, and two ways of "could not measure"`）。
   ⇒ ★ 它是一个**真实存在的 git 对象**，与「上次审查的版本用 git 版本」同源、**不可伪造**。

★ 我**没有**替 captain 执行这两条中的任何一条 —— 那会「让检查闭嘴」，
而 E.4 那条链（写入点 + 窗口）**依然存在**，下一次重启会再造一个同样的任务。

---

## 附录 F（attempt 6 补记）：★ 出路 1 也被实测否掉了 —— 回收 worktree **不等于**重建

### F.1 实测：attempt 6，`baseRevision` **仍为 `None`**

```
t16: attempt = 6          ← 又一次重派（4 → 5 → 6）
     baseRevision = None  ← ★ 仍然没有
     status = in_progress
```
`update_task` 返回**逐字相同**的 `[completion.backtest]` 拒绝（与 E.1 同一句）。

⇒ ★ **E.1 的结论（「重派不足以解除」）在 attempt 6 上再次成立。**

### F.2 ★★ 而 E.6 出路 1 也**不成立** —— 我写的时候没测它

E.6 出路 1 写的是：「**重建** t16 的 worktree ⇒ 重新触发 `onWorktree`」。
`[主树]` 实测 —— worktree 确实**被回收了**，而写入**没有发生**：

```
$ ls .agent-teams/worktrees/task-t16
ls: .agent-teams/worktrees/task-t16: No such file or directory      ← ★ 目录已不在

$ git worktree list | grep -c t16
0                                                                    ← ★ git 也已无登记

$ stat -f "%Sm" .agent-teams/worktrees/   ⇒ Oct 8 23:39              ← 回收发生在本次 attempt 之前

而 t16 的 baseRevision ⇒ 仍为 None（F.1）
```

⇒ ★★ **「回收/删除 worktree」≠「重建 worktree」** —— 前者不会触发 `onWorktree`。
**出路 1 按我写的字面去执行，也解除不了。**
★ 而我在 E.6 写它时**没有先测这一步**（与 captain 上一轮「跑 build 就能消掉」同一形状的疏忽）：
**我把「worktree 会重新被建」当成了既成事实，而实测显示它只是被删掉了。**

### F.3 ★ 逐条更正（三条规定，两条已被自己的实测否掉）

| # | 我/ captain 说过的处置 | 实测 | 判定 |
|---|---|---|---|
| ① | captain：「跑 build 就能消掉 stale」 | 盘上对齐 ≠ 进程内对齐 | ✗ 已被我证否（A.6b） |
| ② | 我：「重派就会写入 `baseRevision`」 | attempt 4→5→6 均 `None` | ✗ 已被我证否（E.1 / F.1） |
| ③ | 我：「重建 worktree 会触发 `onWorktree`」 | worktree 被回收但未重建、未写入 | ✗ **本轮被我证否**（F.2） |

★ 而三条的**共同错法一模一样**：**把「一个会写东西的动作」当成了「已经写了」**，
而**没有去读那个东西到底写没写**。⇒ 这正是本队记账最久的那条：
**"动作发生了"与"事实建立了"在读数上不同形，而只有后者可测。**

### F.4 ★ 那么现在还剩下什么 —— 只剩 E.6 出路 2

```
$ git cat-file -t ac2db2eca7ae9885be7dfd4927e39c60587df2ee
commit                                                    ← ★ 基准【仍然在】

$ git log --oneline -1 ac2db2e…
ac2db2e fix: a committed mutant, and two ways of "could not measure"
```

⇒ ★ **唯一未被证否的出路**：由有权的一方把 `baseRevision` 写进 t16 的**耐久态**
（`record['baseRevision'] = 'ac2db2eca7ae9885be7dfd4927e39c60587df2ee'`），
或**真正新建**一棵 t16 的 worktree（`git worktree add` ⇒ 触发 `onWorktree`）。

★ 两条都**改到 `src/`（Out of scope）或前一个任务链的产物**，**我不做**。
★ 而基准值**不必猜**：它是上面那个**真实存在的 git 对象**，与「上次审查的版本用 git 版本」同源、**不可伪造**。

### F.5 三态（更新）

| 项 | 三态 | 说明 |
|---|---|---|
| 「重派后拒绝是否消失」 | ★ **已测：不消失**（三次：4→5→6） | `baseRevision` 恒为 `None`，拒绝逐字相同 |
| 「回收 worktree 后是否触发写入」 | ★ **已测：不触发** | 目录已删、`git worktree list` 无登记，而 `baseRevision` 仍 `None` |
| 「真正新建 worktree 是否会写入」 | ★ **unmeasured** | **缺什么**：需要一次 `git worktree add`（或等价的派发路径）。本任务边界内**不做**，**不并进通过** |
| 「写耐久态是否会解除」 | ★ **unmeasured** | **缺什么**：需要一次对 t16 记录的写入。同理不做 |
| 基准值本身是否存在 | ★ **已测：存在** | `git cat-file -t ac2db2e…` ⇒ `commit` |

★ 本附录**只产出读数**。F.4 那两条出路**都不执行**：E.4/F.2 的链
（写入点只挂 `onWorktree` + t16 落在持久化能力的窗口之外 + 重启清空内存 Map）**依然存在**，
它们是**会再造同类任务的**原因，而修链不在本任务射程内。

---

## 附录 G（attempt 7 补记）：★★ 出路 1 的根因找到了 —— **验证类任务根本不会被建 worktree**

### G.1 实测：attempt 7 仍被拒，且环境与 attempt 6 逐字相同
```
t16: attempt = 7 · baseRevision = None · 无 worktree
update_task ⇒ 逐字相同的 [completion.backtest] 拒绝
```

### G.2 ★★ 决定性读数：`needsWorktree` 把非实现类任务排除在外
`[主树]` `src/scheduler.ts` 逐字：
```
768| const needsWorktree = ticket.kind === 'implementation' || ticket.kind === 'repair'
769| let worktreePath: string | undefined
772| if (needsWorktree) {
773|   const created = createTaskWorktree({ repo: workspace, taskId: ticket.taskId })
```
而 `createTaskWorktree`（`:773`）正是 `onWorktree` 回调（`src/tools.ts:1736`）的触发点。

⇒ ★★ **`verification` / `review` / `integration` / `work` / `requirements` 这五种 kind
【永远不会】被建 worktree ⇒ `onWorktree` 对它们【永远不触发】⇒ 两处都永远不写。**

### G.3 ★★★ 而它与 `resolveBaseRevision` 的规则**直接冲突** —— 造出一个恒不可达
`[主树]` `src/tools/shared/entities.ts:332` 逐字：
```
return { kind:'absent', reason: typeof task.attempt === 'number' && task.attempt > 0 ? 'not-recorded' : 'no-worktree' }
```
⇒ ★ 这条规则说：**「`attempt > 0` 而没有基准」= 本该有却丢了 = 拒绝。**

★ 把 G.2 与 G.3 合起来：
```
① t16 是 verification ⇒ needsWorktree = false（scheduler.ts:768）
   ⇒ 从来没有基准，也永远不会有一个
② t16 一旦被重派（attempt > 0）⇒ attempt 那一格变成 > 0
③ ⇒ resolveBaseRevision 读 :332 ⇒ 判 'not-recorded'（本该有却丢了）
④ ⇒ backtest 判 blocked ⇒ update_task 恒被拒
```

★★ **⇒ 这是一个【恒不可达】：**
> **任何【非 implementation/repair】的任务，只要被重派过一次，就再也无法提交终态。**
> **而它被拒的理由（「本该有基准却丢了」）描述的原因【从来没有发生过】。**

★ 而这正是判据自己最反对的那件事的反面 —— 编号 §"三态"写的是
**「没能测量」不得读成「测不了是零」**；这里是它的**镜像**：
**「按设计不存在」被读成了「本该存在却丢了」。**

### G.4 不是 t16 独有 —— 实测同族任务全部落 `None`
```
$ 读 team.json（本队全部非实现类任务）
t13  kind=verification  attempt=4  baseRevision=None
t16  kind=verification  attempt=7  baseRevision=None
t5   kind=verification  attempt=0  baseRevision=None
t6   kind=review        attempt=0  baseRevision=None
```
⇒ ★ `t13`（`verification`，attempt 4）**与 t16 落在同一个格子里** ——
而 captain 报告 `verifier` 在 t13 上也只能落 `failed`。
**⇒ 两条看起来无关的「失败」，根因是同一行（`scheduler.ts:768`）。**

### G.5 三态（更新）
| 项 | 三态 | 说明 |
|---|---|---|
| 「重派后拒绝是否消失」 | ★ **已测：不消失**（四轮 4→5→6→7） | `baseRevision` 恒 `None` |
| 「回收 worktree 是否触发写入」 | ★ **已测：不触发** | F.2 |
| 「手工 `git worktree add` 是否触发写入」 | ★ **已测：不触发** | captain 实测并已撤销（绕过调度器） |
| ★ **「非实现类任务是否会被建 worktree」** | ★ **已测：不会** | `scheduler.ts:768` 只放行 implementation/repair |
| 「写耐久态是否会解除」 | ★ **unmeasured** | 缺一次对 t16 记录的写入；边界内不做 |

### G.6 ★ 出路清单（更新，全部是读数不是补丁）
| # | 出路 | 状态 |
|---|---|---|
| 1 | 重派 | ✗ 已证否（E.1 / F.1 / G.1） |
| 2 | 回收 worktree | ✗ 已证否（F.2） |
| 3 | 手工 `git worktree add` | ✗ 已证否（captain 实测，绕过调度器） |
| 4 | **写 t16 的耐久态 `baseRevision`** | ★ **unmeasured**（唯一未被证否的） |
| 5 | **放宽 `:332` 对"按设计没有基准"的判定** | ★ **不在射程**（改 `src/`；且这是 t18/t19 那一族） |

★ 本附录**只产出读数**：它把「重派无效」从一个**现象**提升为一个**可指到行的结构性原因**
（`scheduler.ts:768` × `entities.ts:332`）。
★ 而**出路 4 我仍然标 `unmeasured` 而不是 `it works`** ——
理由与 F 相同：**我没有测过它。**

---

## 附录 H（attempt 8 补记）：根因在新 HEAD 上**未变**，且两行都能逐字复核

### H.1 实测：attempt 8 仍被拒，两行根因**逐字未变**
```
t16: kind=verification · attempt=8 · baseRevision=None
update_task ⇒ 逐字相同的 [completion.backtest] 拒绝

src/scheduler.ts:768   const needsWorktree = ticket.kind === 'implementation' || ticket.kind === 'repair'
src/tools/shared/entities.ts:332   … task.attempt > 0 ? 'not-recorded' : 'no-worktree' …
```
⇒ ★ **附录 G 的判定在第五轮（4→5→6→7→8）上仍然成立**，且两行**都未改动**。

### H.2 在主树新 HEAD 上复核审计的核心读数（防止报告过期）

★ 本 attempt 的 HEAD 已从 `ba32130` 前进到 **`d01394d`**（`fix(t18): absorb the baseline
known-failures list into the main tree`）。**逐条重核本报告的核心事实，全部仍成立**：

| 报告里的读数 | 在新 HEAD `d01394d` 上复核 |
|---|---|
| §6 `delivery.ts:118` 的 notChecked | ★ 逐字未变 |
| §7 t64 的 `git show --stat` | ★ 未变（仍有 `delivery.ts` 47 行 + stamp） |
| §C.1 t14 修复后的 `:389`/`:399` | ★ 逐字未变（`dispatchNotChecked` 守卫仍在） |
| §C.4 七-kind 全部 `notChecked=true` | ★ 复核 verification/review/implementation ⇒ 三行仍全部 `true` |

⇒ ★ **本报告的结论没有因 HEAD 前进而过期** —— 而这一点是**复核出来的，不是假设的**。
（沿用那条纪律：每一条读数都要说清它读的是哪一版。）

### H.3 ★ verify 的新读数（含一条**自报未完工**的臂）

```
干净串行：tests 1096 / pass 1061 / fail 8 / skipped 27     （ERR_MODULE_NOT_FOUND 计数 = 0）
```
★ 测试总数 `1090 ⇒ 1096`（+6）来自 HEAD 的新提交 `d01394d`。
★ 8 条红里 **7 条与 attempt 4 逐条 IDENTICAL**（全部为与本次改动无关的存量）；**唯一新增的 1 条**是：
```
✖ ★★★ 臂 4（待修读数）：清单必须真的被装载器交给判据 —— 现在【不到】
  AssertionError: ★★★ 装载器交不出清单（返回 `undefined` = 判据眼里的「清单缺席」）—— 而**本清单里有 18 条**。
```
⇒ ★ **它的臂名里就写着「待修读数」与「现在【不到】」** ——
即：**那是 t18 那条改动自己声明的一条未完工读数，不是回归。**
★ 而这与本报告 §A.5 的形状**同类而方向相反**：那里是**两个缺陷叠在一起读起来像一个**；
这里是**一条自报的未完工被读起来像一条新红点**。判别办法同源：**读它的措辞，而不是读它的颜色。**

### H.4 ★ 第二次复现那条并发假象（附录 A.8 预言过）
本 attempt 首次跑到：
```
tests 1096 / pass 1055 / fail 14 / skipped 27
ERR_MODULE_NOT_FOUND 出现 10 次
```
而 `lib/tools.js` **存在**（并发成员的 `pnpm build` 的 `clean-build.mjs clear` 阶段把它暂时清掉）。
⇒ ★ **再次复现**：`fail 14` 里有 6 条是**构建中间态**，一条真红点都不是。
本报告 §A.8 与 H.3 的读数**一律取自 `lib/tools.js` 稳定后的串行运行**。

### H.5 三态（更新）
| 项 | 三态 | 说明 |
|---|---|---|
| 根因两行（`scheduler.ts:768` × `entities.ts:332`） | ★ **已测：未变** | 第五轮仍逐字相同 |
| 本报告核心读数是否随 HEAD 过期 | ★ **已测：未过期** | 在 `d01394d` 上逐条复核 |
| 「写耐久态是否会解除」 | ★ **仍 unmeasured** | 缺一次对 t16 记录的写入；边界内不做 |
| 「`d01394d` 的 t18 改动是否修了本报告那条恒不可达」 | ★ **已测：没有** | `:768` 与 `:332` 两行均未改动 |

★ 本附录仍然**只产出读数**，**不做任何修补**：射程边界是 t16 契约写在最前面的一条。
★ 而「出路 4」到现在为止**依旧是唯一未被证否、也未被证实的** —— 我**不把它升格**。

---

## 附录 I（attempt 9 补记）：★★★ 落 `failed` **也被同一条拒** —— 这条门不区分终态方向

### I.1 实测：把 status 换成 `failed`，拒绝**逐字相同**
attempt 8 末我按 captain 指示把 t16 落 `failed`（而非 `completed`），返回：
```
update_task rejected: [completion.backtest] the baseline state is unavailable, and this task SHOULD
have one: it was dispatched (attempt > 0) but no parent revision was recorded, …
[deployment] …
```
★ **与落 `completed` 时逐字相同。**

⇒ ★★ **这条门不区分「完工」与「放弃」** —— 而后果比附录 G 更重：
**不是「收不了口」，是「【退不出去】」。**

### I.2 ★ 为什么 —— `wantsCompleted` **算了、交出来了、而判据没读**

`wantsCompleted` 在主树里**确实存在**：
```
src/tools/update-task.ts:359      wantsCompleted: args.status === 'completed'
src/tools/update-task/completion.ts:230   const wantsCompleted = args.status === 'completed'
src/tools/update-task/completion.ts:110   /** 段内算出、而段外还要用 */ wantsCompleted: boolean
```
⇒ 它**被算出来、被当返回值交出去** —— 而**没有任何一条判据读它**。

`[主树]` `src/gates/completion/backtest.ts` 实测：
```
$ grep -c wantsCompleted src/gates/completion/backtest.ts
0                                        ★ 一次都没有
```
而 `appliesTo`（`:345-366`）**只有两个守卫**：
```
345| export function appliesTo(ctx) {
     … gateRequirementFor(…, ctx?.task?.kind, id)
356|   if (requirement.status !== 'required') return false    ← 守卫一：kind 需求表
     … const paths = Array.isArray(fromUpdate) ? fromUpdate : fromCtx
366|   return Array.isArray(paths) && paths.length > 0          ← 守卫二：声明了改动文件
```

### I.3 ★★ 完整触发链（t16 逐格对上）
```
① t16 kind = verification
   ⇒ kind-requirements.json: verification.requiredGates = ['completion.backtest']
   ⇒ 守卫一：requirement.status = 'required' ⇒ 不返回 false ⇒ 门要说话
② 我的上报带了 changedPaths = ['docs/T14-STALE-BASE-AUDIT.md']（契约要求交这个）
   ⇒ 守卫二：paths.length > 0 ⇒ 不返回 false
③ ⇒ appliesTo = true ⇒ gate() 跑 ⇒ 读 baselineAbsent
④ resolveBaseRevision ⇒ :332 判 'not-recorded'（附录 G.3）
⑤ ⇒ backtest 返回 blocked ⇒ 拒绝
⑥ ★ 而 ⑥ 这一步【与 status 是 completed 还是 failed 无关】：
   wantsCompleted 在 ④-⑤ 全程没被读过（backtest.ts 里 grep 计数 = 0）
```

⇒ ★★★ **两个「按设计」互相咬住，造出一个不可退出的状态：**
> **`verification`/`review` 类的任务，只要**
> **(a) 交过 changedPaths**（契约要求的）**且 (b) 被重派过一次**，
> **⇒ 它的 `completed` 与 `failed` 两个出口【同时】被同一条判据堵死。**

### I.4 ★ 而注释自己写着这件事（主树原文）
`src/tools/update-task/completion.ts:196-197`：
```
196| * 此前只有 `worktreeBase`（内存 Map）一个来源 ⇒ 无 worktree 的任务恒拿不到
197| * ⇒ 回测恒 unmeasured ⇒ **这类任务永远无法收口**。
```
★ 这段注释**写的是 t18 修之前**的情形（那时恒 `unmeasured`）。
⇒ 而 `entities.ts:332` 的引入把 `unmeasured` 换成了 **`blocked`（拒绝）** ——
★ **「永远无法收口」这句结论没变，只是换了一条分支到同一个地方**：
**从「测不了」变成了「拒绝」，而两者的终态效果相同。**

### I.5 ★ 含义：captain 那条「交终态就能解锁排队」的方案**不成立**
captain 的推理是：「解掉这条 `in_progress`，你就能接新活」。
⇒ 实测：**这条 `in_progress` 解不掉**（`completed` 与 `failed` 都拒）。
⇒ ★ **我不能靠交终态释放自己**，而 `t3` 也不会因为我而解锁。
**⇒ 而这不是我这一条的问题**：`t13`（同样 `verification`、同样 `attempt>0`）
**也在同一个格子里**（G.4 已测）。

### I.6 三态（更新）
| 项 | 三态 | 说明 |
|---|---|---|
| 「落 `failed` 能否被接受」 | ★ **已测：不能** | 与落 `completed` 逐字相同的拒绝 |
| `backtest.ts` 是否读 `wantsCompleted` | ★ **已测：不读** | `grep -c` ⇒ **0** |
| `appliesTo` 的守卫个数 | ★ **已测：2** | kind 需求表（`:356`）+ changedPaths（`:366`） |
| 「去掉 changedPaths 是否能落终态」 | ★ **unmeasured** | **缺什么**：需要一次不带 changedPaths 的上报。**我不试** —— 见 I.7 |
| 「`t3` 是否会因我交终态而解锁」 | ★ **已测：不会** | 因为我交不上终态 |

### I.7 ★ 射程边界：那一条我**故意不试**
I.6 第 4 行是一个**我猜可能有用**的动作（不带 `changedPaths` 上报）。
★ **我【没有】去试它**，理由与附录 F/E 一致，而这次更强：
- 契约**要求**交 `changedPaths`（`Out of scope` 只列了文件，而 changedPaths 是 verify 契约的一部分）；
- **为了让自己过关而少交一格申报** —— 那正是本报告 §5.3 警告过的
  「**让检查闭嘴**」，只是这次闭嘴的是我自己的任务；
- 而它的后果是**静默的**：这条记录会看起来像「这个任务没有改动过任何文件」。

⇒ ★ 若它确实可行，**那也是 captain 的处置，不是我的** —— 因为它改的是**这条记录的语义**。

★ 本附录仍然**只产出读数**。而它的用途是明确的：
**captain 需要知道「交终态解锁排队」这条路现在是堵的**，否则会把一个解不开的动作当成解法。

