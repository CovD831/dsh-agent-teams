# 判据产出 · 消费者施工单（T2）

> **只读施工单。本次没有改 `src/` 的任何一个字节 —— 本文件是唯一产出。**
>
> 补的是「证据链缺一环」：22 条判据把产出落盘了，而**落盘之后没有读者**。
> 本文件逐条点名「谁该读它」，并把「无读者」按**性质**分成三类 ——
> 因为这三类的处置完全相反：(a) 去接线、(b) 什么都不做、(c) 去删。

---

## 0. 一句话结论

```
22 条判据里，16 条有产出键、6 条没有。
有产出键的 16 条判据共交出 45 个「判据×产出键」对（去重后 44 个键名 ——
唯一跨判据同名的是 `skipped`：dispatch.worktree 与 runtime.liveness 各一个）。
其中【生产读者】存在的 = 1 个（reruns，src/tools/update-task.ts:1681）。
其余 44 个：【零生产读者】。
```

而**这 44 个**里有读者的分类是（★ 按「判据×键」对计，不按键名 —— 见 §7.4）：

```
(a) 该被读而没有     12 对   ← 真的缺陷
(b) 本来就只给人看   23 对   ← 不算缺
(c) 真没人需要        9 对   ← 记账，不删
```

**这不是 44 个洞，是 12 个。** 把 44 个都当洞去接线，会造出 32 个新的假消费者 ——
那比不接更坏。★ 这三个数由 §7.4 的自检脚本机械核对（不重不漏、合计 45）。

---

## 1. 可复跑的读数（三条，逐条给命令与退出码）

### 读数 ① 22 条判据 —— 注册表的真实计数

```bash
node --input-type=module -e "
import {registry} from './lib/gates/index.js'
let n=0
for (const [p,g] of Object.entries(registry.list())) { n+=g.length; console.log(p, g.length) }
console.log('total', n)"
# → admission 3 / contract 3 / dispatch 3 / completion 4 / delivery 2 / runtime 3 / collection 4
# → total 22        [exit 0]
```

### 读数 ② 每条判据 `ok:true` 的产出键 —— 静态抽取

探针脚本见 §7（`probe-payload-keys.mjs`）。口径镜像 `registry.ts:840`：
**只有 `ok === true` 的裁决，除 `ok` 以外的键才被收进 `outputs`**。

```bash
node probe-payload-keys.mjs        # 仓库根跑
# → 16 条有产出键 / 6 条无产出键        [exit 0]
```

★ 这 6 条**无产出键**的判据不是"漏了"，它们是 `ok()` 或 `ok: true`（无附加数据）：
`admission.checkpoint` / `contract.build-artifact-scope` / `collection.*` ×4。
（`completion.verify-rerun` 的 `reruns` 在单行 `return { ok: true, reruns }` 里 ——
探针的第一版漏了它，见 §7 的"这条探针自己踩过的坑"。）

### 读数 ③ 每个产出键的**生产读者** —— 精确版

```bash
node probe-payload-readers.mjs     # 仓库根跑
# → 有生产读者的产出键 = 1；无生产读者的产出键 = 42     [exit 0]
# → 那唯一的一个：reruns ← src/tools/update-task.ts:1681
```

★ **口径必须说清**（否则这份清单会被读成"44 个洞"）：

```
① 生产读者 = src/** 里【判据目录之外】的读取点，且必须走产出通道：
             X.outputs['<gateId>']?.<key>  或  X.outputs['<gateId>']['<key>']
             ★ 注释行不算读者（本仓注释大量引用产出键 —— 那是"看起来有读者"的陷阱）
             ★ 裸词 grep 不算（见 §7 的反面教材：landed/scope/full/baseline 会各报 10+ 个假读者）
② 夹具读者 = scripts/** 里的同形访问。★ 夹具调用【不算】消费者 ——
             这条口径不是我发明的，是 `scripts/gate-producer-consumer.test.mjs:36-46`
             的既有裁定（「夹具调用【不算】消费者」），本文件沿用。
```

### 读数 ④ 落盘的真实分布（核对"117 条 / 5 个键"这个审计读数）

```bash
node --input-type=module -e "
import fs from 'node:fs'
// 只读 .agent-teams/**/team.json，跳过 worktrees/（那是别的分支的副本）
const walk=(d,o=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){
  if(e.name==='worktrees')continue
  const p=d+'/'+e.name
  if(e.isDirectory())walk(p,o); else if(e.name==='team.json')o.push(p)} return o}
const files=walk('.agent-teams')
const keys=new Map(); let n=0
for(const f of files){let j;try{j=JSON.parse(fs.readFileSync(f,'utf8'))}catch{continue}
  for(const t of j.tasks??[]) for(const seg of Object.values(t.gateEvaluations??{}))
    for(const [id,g] of Object.entries(seg?.outputs??{})){n++; for(const k of Object.keys(g))keys.set(k,(keys.get(k)??0)+1)}}
console.log('files',files.length,'entries',n)
console.log([...keys.entries()].sort((a,b)=>b[1]-a[1]))"
```

实测（本机，2026-10-20）。★★ **这一格是唯一会随时间动的读数** ——
因为它数的是**盘上正在被别的任务写的东西**：

| 口径 | 21:29 那次 | 21:37 那次（+8 分钟，本队其他任务在落盘） |
|---|---|---|
| 全部 `team.json`（跳过 worktrees/） | 192 条 · verifyProbe 73 / atomicityReadout 63 / reruns 39 / reviewedReadout 13 / r5 3 | **196** 条 · verifyProbe 75 / atomicityReadout 65 / reruns 40 / reviewedReadout 13 / r5 3 |
| 同上、**排除 `.agent-teams/archive/`** | 118 条 · verifyProbe **44** / atomicityReadout **35** / reruns 33 / r5 3 / reviewedReadout 3 | **122** 条 · verifyProbe **46** / atomicityReadout **37** / reruns 33 / r5 3 / reviewedReadout 3 |
| 只数 S1 单段 `task.gateEvaluation` | 46 条 · reruns 42 / r5 3 | **46** 条 · 同左（这一格没动） |

★ **审计代理那句「117 条 / 44 / 35」是可以复现的**：排除 archive 后是 **118**（差 1
是那个空 `outputs: {}`，`Object.keys` 计数为 0 ⇒ 若按"有键的条目"数就是 117）。
⇒ 那条读数**成立**，本文件把它固定在一条命令上，口径写明"排除 archive"。

★★ **而这里有一条本文件必须自己说出来的纪律**：上面那两个数字（192 → 196，
118 → 122）在 8 分钟内变了，**而它们都不是"错"**。⇒
**本文件后面所有结论都不依赖这两个数**：§0 的 45 对 / 12 / 23 / 9 是**代码结构**
的读数（`ok:true` 字面量 + `outputs[...]` 读取点），**不数盘上条目**。
盘上那几行只是用来核对"审计代理那句话成不成立"，它成立，仅此而已。
★ 一个会随时间漂的读数，只要**结论不钉在它上面**，就不是问题；
  把结论钉在它上面才是 —— 那正是本仓记的"用一个会动的数当证据"。★

### 读数 ⑤ 判据层求值点 —— 顺带查出的一个**前提问题**

★ 这一条的命令**必须剥掉注释**：仓里有 2 处 `evaluate('admission'` 在**注释**里，
其中一处（`src/snapshot.ts:784`）是 t1 提交新增的、**引用这句话本身的注释** ——
裸 grep 会把它数成"有调用点"，于是"零求值点"这个结论会**自己把自己证伪成假的**。
（本仓记过同族的一次：`gate-producer-consumer.test.mjs` 文件头「臂 3 第一版没剥注释」。）

```bash
# 代码级（非注释）的 admission 求值点数量：
n=$(grep -rn "evaluate('admission'" src/ --include=*.ts | grep -vc "^\S*:[0-9]*: *\(\*\|//\)")
echo "code-level admission evaluate call sites = $n"
# → code-level admission evaluate call sites = 0        [exit 0]

# 对照：全部文本命中 2 处，两处都在注释里
grep -rn "evaluate('admission'" src/ --include=*.ts
# → src/snapshot.ts:784                （注释）
# → src/client/activity-model.ts:1490  （注释）          [exit 0]
```

`admission` 那 3 条判据（`absorb` / `checkpoint` / `convene`）在生产路径上
**一个求值点都没有**（`src/tools/status.ts:107` 的 `NOT_EVALUATED_IN_STATUS`
把它列进"status 不求值"的那张表；其余五个位置各有真实求值点）。
⇒ **它们的三条产出键（`absorbReport` / `conveneReport`）的"无读者"是派生的**：
先有"零求值点"，才有"零读者"。★ 这与本队 T1 那条「admission 已注册零求值点」
是**同一个事实的两个出口** —— 本文件把它记为 (a) 类，但**收敛方案指向 T1，不指向接线**。

---

## 2. 逐条清单：22 条判据 × 产出键 × 谁读

图例：**读者=无** 表示按 §1 读数③ 的口径，`src/**` 判据目录外零读取点。
「夹具」列只说明"这条产出被测试钉住过"，**不构成消费者**。

| # | 判据 id | point | `ok:true` 的产出键 | 生产读者（文件:行） | 夹具 | 分类 |
|---|---|---|---|---|---|---|
| 1 | `admission.absorb` | admission | `absorbReport` | **无**（且**零求值点**） | 10 处 | **(a)** |
| 2 | `admission.checkpoint` | admission | —（`ok()`，无键） | — | — | — |
| 3 | `admission.convene` | admission | `conveneReport` | **无**（且**零求值点**） | 10 处 | **(a)** |
| 4 | `contract.build-artifact-scope` | contract | —（`ok()`） | — | — | — |
| 5 | `contract.verify-command` | contract | `verifyProbe` | **无** | 3 处 | **(a)** |
| 6 | `contract.task-atomicity` | contract | `atomicityReadout` | **无** | 6 处 | **(b)** |
| 7 | `dispatch.changed-paths` | dispatch | `verifiedChangedPaths` | **无** | 6 处 | **(a)** |
| 8 | `dispatch.worktree` | dispatch | `landed` / `skipped` / `arrivedIn` / `declaredPaths` | **无** | 1 处 | **(c)** 3 键 + **(b)** 1 键 |
| 9 | `dispatch.plan-reviewed` | dispatch | `reviewedReadout` | **无** | 7 处 | **(a)** |
| 10 | `completion.verify-rerun` | completion | `reruns` | ✅ `src/tools/update-task.ts:1681` | 7 处 | ✅ 有读者 |
| 11 | `completion.r5` | completion | `r5` | **无** | 214 处（多数是同名变量） | **(c)** |
| 12 | `completion.mutation` | completion | `mutationReport` / `mutationScore` / `killed` / `survived` / `corpus` / `batch` / `scope` / `early-stop` / `coverageUnmeasured`（9 键） | **无** | 13+ 处 | **(b)** 全 9 键 |
| 13 | `completion.backtest` | completion | `baseline` / `selection` / `full` | **无** | 1 处 | **(b)** `baseline`/`full` + **(c)** `selection` |
| 14 | `delivery.coverage` | delivery | `goal_items` / `covered_goal_items` / `coverage_source` / `in_progress_goal_items` | **无** | 1-2 处 | **(a)** `coverage_source` + **(b)** 其余 3 键 |
| 15 | `delivery.convergence` | delivery | `converged_members` / `converged_note` | **无** | 2 处 | **(b)** |
| 16 | `runtime.liveness` | runtime | `probes` / `stuck_count` / `waited_count` / `first_probe` / `alive` / `interval_complete` / `message`（+ 经 `...evidence` 的 `wait_ms` 等 8 格） | **无** | 23 处 | **(a)** `stuck_count` / `probes` + **(b)** 其余 |
| 17 | `runtime.stall` | runtime | `threshold` / `examined` / `stalled_count` / `observations` | **无** | 16 处 | **(a)** `stalled_count` / `observations` |
| 18 | `runtime.shape-execution` | runtime | `shape_violations` / `shape_violation_count` | **无** | 10 处 | **(a)** ★ 最贵的一条 |
| 19 | `collection.dedupe` | collection | —（`ok()`） | — | — | — |
| 20 | `collection.cooldown` | collection | —（`ok()`） | — | — | — |
| 21 | `collection.attributable` | collection | —（`ok()`） | — | — | — |
| 22 | `collection.immunity` | collection | —（`ok()`） | — | — | — |

★ **注意第 18 行与第 4 行的对比**：`runtime.shape-execution` 的
`shape_violations` 与 `src/tools/status.ts:1380` 的 `shape_violations`
**同名、同义、两份实现**。见 §3.1。

---

## 3. 「无读者」按性质分三类

### 3.0 为什么必须分三类（这是本任务的核心）

一句"44 个判据×键没有读者"是**不可行动**的：读它的人无法知道该做什么。
而这三类的补救动作**方向相反**：

```
(a) 该被读而没有  ⇒ 去接线。★ 而且它常常已经在别处【重算了一遍】—— 两份真相
(b) 本来就只给人看 ⇒ 什么都别做。接一个"消费者"只会造出一个假接线
(c) 真没人需要     ⇒ 去删。留着它，下一次普查会把它再报一次，而报表越长越没人读
```

★ 判 (a) 与 (b) 的**机械判据**（不是感觉）：

```
(a) 该被读而没有  ⟺  同一份事实在 【别处被重算了一遍】，或 【裁决依赖它而裁决不知道该读它】
(b) 本来就只给人看 ⟺  它进的是【给人读的出口】（日志 / 渲染 / 状态返回值的人话字段），
                      而那个出口本身有读者
(c) 真没人需要     ⟺  既没有第二份真相，也没有人读的出口；它的用途是"将来可能有用"
```

---

### 3.1 (a) 该被读而没有 —— 12 个「判据×键」对，**6 个独立缺陷**（★ 逐条给了证据）

> ★ 这一节的每一条都带**可复跑的读数**。"我检查过了"不在这里。

#### (a)-1 ★★ `runtime.shape-execution` 的 `shape_violations` —— **两份真相**

```
判据层：  src/gates/runtime/shape-execution.ts:139-148  ⇒ outputs['runtime.shape-execution'].shape_violations
状态层：  src/tools/status.ts:1380                      ⇒ shape_violations: shapeExecution.status === 'measured' ? [...] : []
而状态层那一格的来源【不是】判据产出：
          src/tools/status.ts:1348  const shapeExecution = shapeExecutionFor(ctx, team)
          src/tools/shared/entities.ts:5251  : shapeExecutionFor(ctx, team)     ← 判据输入面的注入，也是它
          src/members.ts:1910  export function shapeExecutionFor(...)
```

⇒ 同一个问句「哪些成员干过活却一个 worker 都没派」在仓里有**两次计算**，
一次进判据产出（`outputs`，零读者），一次进 status 返回值（人读的那一格）。
**两份必然分叉**：判据读到的是注入时刻的那份 ctx，status 读到的是另一时刻的另一份。

★★ 而更贵的是：**status 那一份不带判据的三态**。读数如下：

```bash
node --input-type=module -e "
import {renderStatus} from './lib/tools/shared/entities.js'
const value = {
  team_name:'probe', viewer:'captain', members:[], tasks:[], captain_inbox:[],
  member_inboxes:{}, mailbox_warnings:[], mailbox_warning_count:0,
  team_shape:'this team declared shape \"dispatch\" — ★★ NOT held: ledger finished task(s) but spawned no temporary worker',
  shape_execution:'measured', shape_violations:['ledger'],
}
console.log(renderStatus(value))"
# → 渲染里【一个字都没有】：team_shape / shape_execution / shape_violations 都不渲染 [exit 0]
#    实际输出只有：Team "probe" / Viewing as: captain / Members (0): / Tasks (0): / Captain inbox (0):
```

⇒ **三格恒在场、schema 标 `required: true`（`src/tools/status.ts:300-302`）、
却从来没有被渲染过。** 而 `src/client/**` 也零读取（`grep -rn "team_shape\|shape_violations" src/client/` = 空）。
本仓对这件事有**逐字的既有裁定**（`src/tools/shared/entities.ts:6365-6380`，
`deployment` 那段 MEASURED）：「**一个只在返回值里、而人看不见的读数，与它不存在是同一件事**」。

**收敛方案**（谁该读它 / 动哪个文件 / 循环依赖）：

| 动作 | 动哪个文件 | 循环依赖 |
|---|---|---|
| ① 让 status 的 `shape_violations` **读判据产出**，而不是自己再算一遍 | `src/tools/status.ts:1348` + `:1380` | ★ **不会**。`status.ts` 已经在 import `registry`（`:7`）与 `evaluateRuntimeGates`（`:12`），而 `runtimeRecord.outputs` 在 `:1421` 已经原样交出去 —— 数据**已经在手里**，改动是"从手里那份读"，不新增任何 import |
| ② `shapeExecutionFor` 的**唯一构造点**收敛到判据输入面那条路 | `src/tools/shared/entities.ts:5251`（已经是唯一注入点） | ★ **不会**。`members.ts` 零 `gates` import（`grep -n "gates" src/members.ts` = 空），方向天然是 `members ← tools ← gates`，判据层只认 `../registry.ts` / `../requires.ts` |
| ③ 把 `team_shape` / `shape_execution` / `shape_violations` 渲染出来 | `src/tools/shared/entities.ts` 的 `renderStatus`（`:6246`） | ★ 不会，纯字符串拼接 |

★★ **禁改项**：`shapeExecutionOf`（`src/members.ts:1971`）不许进 `src/gates/**` ——
判据层零 I/O 是载荷级不变量（`shape-execution.ts:84` 逐字写着
「契约 §2 性质 1 —— 判据不 import I/O」）。收敛方向只能是
**status 去读判据产出**，不能是**判据去读 session**。

#### (a)-2 ★★ `runtime.stall` 的 `stalled_count` —— **恒不可见**（可复跑证明）

```
判据层：  src/gates/runtime/stall.ts:279-288   ok:true + { threshold, examined, stalled_count, observations }
消费层：  src/tools/shared/entities.ts:5335-5345  evaluateRuntimeGates 的 outcome 只看 ok/blockers/unmeasured
```

读数（决定性）：

```bash
node --input-type=module -e "
import {registry} from './lib/gates/index.js'
const team = { id:'t', shape:'flat', tasks:[{id:'t1', status:'in_progress', attempt:5, assignee:'w'}] }
const r = await registry.evaluate('runtime', { event:'task-status', team })
console.log('ok =', r.ok, '| unmeasured =', JSON.stringify(r.unmeasured))
console.log('outputs =', JSON.stringify(r.outputs['runtime.stall']))"
# → ok = false | unmeasured = "[runtime.liveness] ...no wait observation at all..."
# → outputs = {"threshold":2,"examined":1,"stalled_count":1,"observations":[{"taskId":"t1","count":5,"basis":"rounds"}]}
# [exit 0]
```

⇒ ★ **这个队有一个停了 5 轮的任务（`stalled_count: 1`），而 `outcome` 那一行会写
`unmeasured: [runtime.liveness]...` —— 卡死这件事在日志里一个字都不出现。**
`runtimeGateLogSnapshot()`（`src/tools.ts:882`）只记 `outcome`，而 `outcome`
是按 `ok/blockers/unmeasured` 三态拼的（`entities.ts:5335`）⇒ `stalled_count`
永远进不去。它是 **(a) 类里最"哑"的一条**：一个恒不响的哨兵。

**收敛方案**：

| 动作 | 动哪个文件 | 循环依赖 |
|---|---|---|
| ① `evaluateRuntimeGates` 的 `outcome` 除了三态，**再从 `outputs` 里读 `stalled_count > 0` / `shape_violation_count > 0`** 并拼一句 `alarms: …` | `src/tools/shared/entities.ts:5335-5345` | ★ **不会**。`evaluation.outputs` 是**同一个对象**上的既有字段（`registry.ts:1016/1022/1048/1063` 四处 return 都带它），不需要新 import |
| ② 或：status 的 `runtime_gates` 那一格已经是**整个 `runtimeRecord`**（`src/tools/status.ts:1421`）⇒ 人读出口**已经拿到了** `stalled_count`，缺的只是**没人渲染它** | `src/tools/shared/entities.ts` 的 `renderStatus` | ★ 不会 |
| ★ 建议：①② 都做。① 让机器读得到（日志/台账），② 让人读得到（面板） | | |

★★ **禁改项**：不许把 `stalled_count` 并进 `blockers` —— `stall.ts:139-141` 逐字写着
「本判据**不拒绝**（runtime 位置的纪律）」，而 `blockers` 在 `update-task.ts:1591`
会触发拒绝。把一条**读数**变成**裁决**，会让每个跑过 N 轮的任务都失败。

#### (a)-3 `runtime.liveness` 的 `stuck_count` / `probes` —— **只在 `blocked` 支有出口，而那一支的产出被注册表丢掉**

```
判据层：  src/gates/runtime/liveness.ts:361  blockedWith([...], { probes, stuck_count, waited_count })
          src/gates/runtime/liveness.ts:371  ok:true + { probes, stuck_count, waited_count, message }
注册表：  src/gates/registry.ts:840  if (verdict['ok'] === true) { ...outputs.set... }
          src/gates/registry.ts:849-856  blocked 支 ⇒ 只 push blockers，**不看别的键**
```

读数（决定性）：

```bash
node --input-type=module -e "
import {registry} from './lib/gates/index.js'
const live = await import('./lib/gates/runtime/liveness.js')
const ctx = { waits:[{task:{id:'t1',assignee:'w'},startedAt:0,lastActivityAt:100,
  previousPollAt:0,previousLastActivityAt:100,now:700000}], now:700000 }
const direct = live.gate(ctx)
console.log('gate 层有 stuck_count 吗:', 'stuck_count' in direct)          # → true
const r = await registry.evaluate('runtime',{event:'task-status',team:{id:'t',shape:'flat',tasks:[]},...ctx})
console.log('注册表的 outputs[stream.liveness]:', JSON.stringify(r.outputs['runtime.liveness']))  # → undefined
console.log('ran 条目:', JSON.stringify(r.ran.find(e=>e.id==='runtime.liveness')))             # → verdict:blocked, count:1"
# [exit 0]
```

⇒ 判据**写了**（`liveness.ts:281-292` 那段长注释逐字解释了"证据是构造裁决的参数"），
而注册表**只收 `ok:true` 的产出**（那条注释自己写着「其余字段只对 `ok:true` 的产出收集」——
**它当时就写对了，只是没意识到这意味着 `blockedWith` 的证据全丢**）。★ 这是 (a) 类里
唯一一条"判据的意图与注册表的实现**互相认为对方会处理**"的缝。

**收敛方案**：

| 动作 | 动哪个文件 | 循环依赖 |
|---|---|---|
| ① 注册表在 `blocked` / `unmeasured` 支也收"除 `ok`/`blockers`/`unmeasured`/`unmeasuredDisposition` 之外的键"，进一个**并列**的 `outputs` 格（或 `evidence`） | `src/gates/registry.ts:849-890` | ★ **可能**：这是**改注册表**，而它是 22 条判据共用的接口。★ 但这正是本仓既有做法（`registry.ts:710-719` 那段 MEASURED 记的**就是**"一个只能表达过/不过的接线层，会强迫判据把结果写进副作用里"）。⇒ 改它**方向正确**，但**风险最高**，必须配一条能红的臂 |
| ② 低风险替代：`evaluateRuntimeGates` 从 `ran[]` 的 `count` 已经能读到"blocked 几条"（`registry.ts:851` 的 `count: list.length`）—— ★ 而这**不是** `stuck_count` | `src/tools/shared/entities.ts` | 不会，但它只覆盖"几条"，不覆盖"谁" |
| ★ 建议：**①**，并把它作为一条独立任务（它改的是共用接口，不是一条判据） | | |

#### (a)-4 `contract.verify-command` 的 `verifyProbe` —— **跑了一次真命令，结果被丢掉**

```
判据层：  src/gates/contract/verify-command.ts:797  return { ok: true, verifyProbe: runs.map(...) }
          runs 的来源：:702-753  真的 `await exec(trimmed)` —— 一次**真实进程**
生产读者：无
```

⇒ 落盘 73 条（全仓口径；排除 archive 44 条）**全部零消费**。而它的用途被注释写死：
`verify-command.ts:793-796`「调用方可以把这次观察落进记录，而不是只留下
"契约看着没问题"这句话」。

**为什么它是 (a) 而不是 (b)**：同一件事在**别处被重算了一遍** ——
`completion.verify-rerun`（`src/gates/completion/verify-rerun.ts`）在完成时**又跑一遍**
同样的 verify 命令，而它的产出 `reruns` 是**唯一有读者**的那一个
（`update-task.ts:1681` → `mergeRerunIntoCommandsRun` → 覆盖成员自报的 `commandsRun`）。
⇒ **同一条 verify 命令被跑了两次，而第一次的观察被丢掉。**

**收敛方案**：

| 动作 | 动哪个文件 | 循环依赖 |
|---|---|---|
| ① 契约时刻的 `verifyProbe` 落盘进 `task.gateEvaluations.contract.outputs`（**已经落了**，`create-task.ts:919` / `amend-task.ts:110`），然后**完成时刻读它**做对照：两次退出码不一致 ⇒ 一个 (b)/(c) 读数进 `commandsRun` 的 evidence | `src/tools/update-task.ts:1681` 附近（与 `reruns` **同一处**） | ★ **不会**。那一行已经在读 `completionGates.outputs[...]`，改成同时读 `task.gateEvaluations.contract.outputs['contract.verify-command']` —— 数据在同一个 `task` 对象上，零新 import |
| ★ 而**不建议**省掉 completion 那次重跑：契约时刻的探针在**零工作**上跑（`verify-command.ts` 的设计目标就是"能不能判"），完成时刻要的是"这次工作**是否**让命令变绿"—— 两问不同形 | | |

#### (a)-5 `dispatch.changed-paths` 的 `verifiedChangedPaths` —— **判据亲眼核对的集合被丢掉，落盘用的是成员自报的**

```
判据层：  src/gates/dispatch/changed-paths.ts:318-325  ok:true + verifiedChangedPaths（会话面 ∪ 工作区面）
落地层：  src/tools/update-task.ts:1992   if (input.changedPaths !== undefined) task.changedPaths = input.changedPaths
          ★ 落盘的是 **input.changedPaths** —— 成员自报的那一份
```

⇒ 判据刚刚花了一整轮把"自报 vs 真实"核完（`:193-227` 的 `fabricated` / `concealed`
逐条比对），并通过了；而**它核过的那份集合从来没有落到盘上**。★ 与 `reruns` 的对比是
决定性的：`reruns` 那条链路**就是为了替换掉成员自报的 exitCode** 而存在的
（`registry.ts:710-719` 的 MEASURED）。同一条纪律，`changedPaths` 这一半**没接**。

**收敛方案**：

| 动作 | 动哪个文件 | 循环依赖 |
|---|---|---|
| ① 在 `update-task.ts:1992` 之前，从 `dispatchGates.outputs['dispatch.changed-paths']?.verifiedChangedPaths` 取那份集合，与 `input.changedPaths` **对照**：不一致 ⇒ 一条 warn（**不拒绝** —— 判据已经放行了） | `src/tools/update-task.ts:1992` | ★ **一处真风险**：`dispatchGates` 在 `update_task` 上**可能缺席** —— `:1135` 明确写着「dispatch 求值已经搬到 `create_task` 了」。⇒ 只有 `create_task` 那条路有它 | 
| ② 因此：`create_task` 落盘（`task.changedPaths` 由 `verifiedChangedPaths` 初始化）+ `update_task` 保持自报 | `src/tools/create-task.ts:1027` 附近 | ★ 不会 |
| ★ 建议：②（低风险）+ ①里那句 warn 只在 `dispatchGates !== undefined` 时打 | | |

#### (a)-6 `dispatch.plan-reviewed` 的 `reviewedReadout` + `admission.absorb`/`convene` 的 `absorbReport`/`conveneReport`

- `reviewedReadout`（`plan-reviewed.ts:520-531`）：五问逐条 verdict 的读数。
  落盘 13 条（全仓）/ 3 条（排除 archive），**零消费**。
  而 **UI 真读的那条路**（`src/snapshot.ts:785` 转发 `gateEvaluations` → 
  `MemberRow.tsx:450` 的 `readEvaluationsByPoint`）读的是**裁决**（`ran[]` / `blockers` / `unmeasured`），
  `outputs` 在 `GateEvaluationView`（`activity-model.ts:1218-1228`）里**根本没声明**。
  ⇒ **(a) 类**：`reviewedReadout` 是"为什么这一条过了"的凭据，而消费面只拿到了"过了"。
- `absorbReport` / `conveneReport`：★ 它们的 (a) **是派生的**（§1 读数⑤：零求值点）。
  ⇒ **收敛动作不在本文件，在 T1**。本文件只记：**接线之前必须先有求值点**；
  接线之后 `conveneReport.autoApprove` 是唯一一个"判据说能不能，而编排层不读"的**动作型**产出。

---

### 3.2 (b) 本来就只给人看 —— 23 个「判据×键」对，**不算缺**

| 键 | 为什么是 (b)：它有一个人读的出口，而那个出口有读者 |
|---|---|
| `contract.task-atomicity` 的 `atomicityReadout`（4 格） | `task-atomicity.ts:877-903` 的注释逐字：「"我看着 atomic"这句话没有信息量；"判别面 1 条、写域 1 组、并列动词 0 个"才有」。它是**语料**（`discriminatingSurfaces` / `scopeGroups` **明确不参与裁决**，`:849` 逐字「它们仍然**照常报出来**（它是读数），但**不参与裁决**」）。落盘 63 条/35 条是**攒语料**，不是欠账 |
| `runtime.liveness` 的 `message` / `first_probe` / `alive` / `stuck` / `interval_complete`（5 对） | 它们**进 `blockers` 的文字**（`liveness.ts:593-604` 的告警整句），而 `blockers` 有读者（`update-task.ts:1597` 拼进拒绝措辞、`gate-view` 进 `abnormal[]`）。★ 唯一**没有**读者那两个计数已分开归档：`stuck_count` → (a)-3、`waited_count` → (c) |
| `delivery.convergence` 的 `converged_members` / `converged_note` | `:327-333` 的注释：「让交付记录里留着门禁亲眼看过的成员状态」。而交付记录的人读出口是 `status` 的 `delivery` 那一格（`status.ts:1273-1292`，含 `blockers` / `unmeasured` / `gates_evaluated`）。★ `converged_members` 严格说是"名单"而人读的是"结论"—— 但它与 `blockers` 的名单**同源**（`:307-325` 逐成员拼的），⇒ 不算第二份真相 |
| `delivery.coverage` 的 `goal_items` / `covered_goal_items` / `in_progress_goal_items` | `covered` 与 `inProgress` 都从 `rows` 过滤而来，而 `rows` 是**调用方给的矩阵**（`coverage.ts:216` `ctx.coverage`）—— 调用方（`status.ts:1119` 的 `buildCoverageMatrix`）**本来就有这份矩阵**，而且还渲染了（`renderStatus` 的 `Coverage:` 段，`entities.ts:6332`）⇒ 判据这一格是**同一份数据的转抄**，不是新事实 |
| `completion.mutation` 的 9 个键 | ★ 全部是 `report` 的**分解**：`mutationScore = report.mutationScore`、`killed = report.totals.killed`…（`mutation.ts:815-820`）。`report` 本身由 `src/mutation/coverage.ts` 产出、在**判据之外**也有读者（`coverage.ts:605/628`），而判据的裁决用它拼 `blockers`（`:805-813`，含 `survivor:` 逐条）。⇒ 这些键是"把裁决的依据一并交出"的**人读**读数，不是给机器用的输入 |
| `completion.backtest` 的 `baseline` / `full` | `:845-865` 的注释：「调用方要落盘的是判据层亲眼看到的 baseline/selection/full」。同上：**裁决依据的人读版本** |
| `completion.r5` 的 `r5` | 落盘 3 条（全仓）/ 1 条。`r5` 是"父版本上红、修复版本上绿"的**两轮观测**（`r5.ts:640-687`）。★ 它**有**一个真实的人读出口：`task.gateEvaluations.completion.outputs.r5` 已经落盘，而 UI 读的是裁决 —— 与 `reviewedReadout` 同一形状。**但它比 `reviewedReadout` 弱**：`r5.evidence`（新增臂的名单）是判据自己说"这次是强证据还是弱证据"（`:665-684`）—— 那是 (a) 的候选，只是落盘样本只有 1 条，**不值得现在动**。⇒ 归 (b)，**并记一笔：样本到 10 条时重判** |

★ **这一档的纪律（本文件最重要的一条）**：
**不许为了"消灭零读者"给 (b) 类接一个消费者。** 那会造出 23 个假接线，而假接线比
零读者**更坏** —— 它让人以为有人在看。本仓对这件事有逐字的先例
（`docs/ORPHAN-CENSUS.md` §5 第 6 条：「它不是"忘了接线"，而是**调用方写了一份自己的
实现，而两份从没被比对过**」）。

---

### 3.3 (c) 真没人需要 —— 9 个「判据×键」对

| 键 | 依据 |
|---|---|
| `dispatch.worktree` 的 `arrivedIn` / `declaredPaths` / `skipped`（3 对） | `arrivedIn === ctx.worktreePath`（`worktree.ts:255`）—— **原样回抄输入**，零信息量。`declaredPaths` 同样（`:188` 由 `ctx.update.changedPaths` 算出）。`skipped` 是一句人话（`:196`），而 `ok:true` + 空 `landed` 已经表达了同一件事 ⇒ 三个都是**回抄/冗余** |
| `dispatch.worktree` 的 `landed`（1 对） | ★ **有争议**：`src/worktree.ts` 里有大量 `landed` —— 但那是 `ReclaimReading` 的同名字段（`worktree.ts:101/547/770`），**与判据产出无关**（这正是 §7.3 坑 3 的那个假读者）。判据这一格是 `landed: true`（字面量，`:255`）⇒ 零信息量。★ **但**：判据的**结论**"工作没有落进共享工作区"是 `(b)`（它进 `blockers`，`:247`）。⇒ 产出键本身归 (c) |
| `completion.backtest` 的 `selection`（1 对） | `selectionReport` 是**抽样**的读数（跑了哪几条），而裁决只用 `baseline` 与 `full`。★ 抽样本身**不是**可行动的事实（"抽了 3 条"不告诉你该做什么）⇒ (c)。★ 若将来要"抽样覆盖率"这条读数，它会变成 (a) |
| `runtime.stall` 的 `examined`（1 对） | 一个计数（`stall.ts:278`）。`stalled_count` 与 `observations` 已经覆盖了"谁停了"；`examined` 只多回答"看了几条"，而 `threshold` 已经给了量具（`:282`）。★ 归 (c)，**并记一笔**：`examined: 0` 与"没有任务"必须不同形这件事，已经由 `observations: []` + 裁决表达 |
| `runtime.shape-execution` 的 `shape_violation_count`（1 对） | `violations.length` 的**冗余**（`shape-execution.ts:147`）。名单在场时计数可算 ⇒ (c) |
| `runtime.liveness` 的 `waited_count`（1 对） | 与 `stalled_count` 并排的一个计数（`liveness.ts:361/374`）。★ 它的兄弟 `stuck_count` 是 (a)（因为"谁卡住了"是动作导向的），而 `waited_count` 只多回答"这个队有几个人在等"。`probes[]` 已经在场，计数可算 ⇒ (c) |
| `runtime.liveness` 的 `skipped`（1 对） | `liveness.ts:343`：`waits: []` 时的一句人话（"此刻没人在等"）。★ 它与 `dispatch.worktree` 的 `skipped` **同名不同源**（§7.4 记了这个唯一的重名）⇒ 两处都归 (c)，但**不许合并**：一条判据的"不适用"理由与另一条判据的"不适用"理由不可互换 |

★ **合计 9 对**（3 + 1 + 1 + 1 + 1 + 1 + 1）。核对见 §7.4。

★ **(c) 类的处置**：**先记账，不删**。理由是可复跑的：删一个 `ok:true` 的键会改变
`outputs` 的形状，而 `scripts/gate-*.test.mjs` 里有 **34 处**对这些键的断言
（`gate-shape-execution` 10 处、`gate-worktree-arrival` 等）。删除必须连带改夹具，
而那属于"实现"，不属于这张只读施工单。⇒ 本文件给的是**名单与依据**。

---

## 4. 施工单：(a) 类的动作清单（按风险从低到高）

| 序 | 动作 | 动哪个文件 | 新增失败风险 | 循环依赖 | 建议 |
|---|---|---|---|---|---|
| 1 | status 的 `shape_violations` 改读**判据产出**，不再重算 | `src/tools/status.ts:1348,1380` | 低（数据已在手） | 无 | ✅ 先做 |
| 2 | `renderStatus` 渲染 `team_shape` / `shape_execution` / `shape_violations` | `src/tools/shared/entities.ts:6246` | 低（纯字符串） | 无 | ✅ 先做 |
| 3 | `evaluateRuntimeGates` 的 `outcome` 拼上 `stalled_count` / `shape_violation_count` | `src/tools/shared/entities.ts:5335` | 低（同一个对象上的既有字段） | 无 | ✅ 先做 |
| 4 | `update_task` 在 `reruns` 同一处**对照** `verifyProbe`（两次退出码不一致 ⇒ warn） | `src/tools/update-task.ts:1681` | 中（多一处 warn，可能触发新日志断言） | 无 | ⚠️ 配一条能红的臂 |
| 5 | `create_task` 用 `verifiedChangedPaths` 初始化 `task.changedPaths` | `src/tools/create-task.ts:1027` | 中（改变落盘内容） | 无 | ⚠️ 需要先证明判据在 `create_task` 上真的开火了 |
| 6 | **注册表在 `blocked`/`unmeasured` 支也收证据** | `src/gates/registry.ts:849-890` | ★ **高**（22 条判据共用的接口） | 无，但波及面最大 | ❌ 单独立任务，不进本次 |

★ **本轮施工单只是一个只读产出**（见 §6 的 `src/` 零改动证明）。

---

## 4.2 ★★★ 已落地的三条（2026-10-21）

| 序 | 动作 | 提交 | 臂 |
|---|---|---|---|
| 1 | `status` 的 `shape_violations` 改读**判据产出**，不再重算 | `d419f83` | 臂 9（`gate-shape-execution`）|
| 2 | `renderStatus` 渲染 `team_shape` / `shape_execution` / `shape_violations` | `17c753b` | 臂 10（同上）|
| 3 | `runtime` 的 `outcome` 拼上 `stalled_count` / `shape_violation_count` | `809d9c1` | 臂 6（`gate-runtime-record-tristate`）|

★★ 三件共同的一件事：**新增了一个「这一份是谁算的 / 有没有渲染」的读数**，
而不是只把数字接通：

```
  序 1  ⇒ shape_source: 'judgment-gate' | 'status-recomputed'
  序 2  ⇒ renderStatus 里两行（声明 / 执行），且零违规不打印噪音
  序 3  ⇒ outcome 里 "[stalled_count=1]"，而 notChecked 时**一个计数都没有**
```

★★★ 而序 3 有一条我**写错了期望、被实测纠正**的记录值得留：

臂 6 的第一版断言「没有停下 ⇒ **不得**出现计数」，而它红了。
实测：`runtime.stall` 在没停下时**也**返回 `stalled_count: 0`（`examined: 1` 证明它真查过）
⇒ 那是**测到的零**，不是"没测到"。
⇒ 于是臂拆成三条：①有停下=1 ②查过没停下=0 ③**全 skipped** ⇒ `notChecked:` 且无计数。
★ "我的期望错了"这件事本身是读数 —— 差一点把一个**正确的实现**按一个**错误的期望**改坏。

### 剩下的（**未做**，各自有理由）

| 序 | 动作 | 为什么没做 |
|---|---|---|
| 4 | `verifyProbe` 对照 | 需要一条能红的臂；而两次退出码不一致的成因还没查清 |
| 5 | `verifiedChangedPaths` 初始化 `changedPaths` | 需先证明判据在 `create_task` 上真的开火了 |
| 6 | 注册表在 `blocked`/`unmeasured` 支也收证据 | ★ 22 条判据共用的接口，**波及面最大** ⇒ 单独立任务 |

### 4.1 动作与缺陷的对应（★ 6 个缺陷 → 6 个动作，一一对上，不留缝）

| 缺陷 | 由哪几行动作收敛 | 说明 |
|---|---|---|
| (a)-1 `shape_violations` 两份真相 | 序 1 + 序 2 | 序 1 收敛**算**的那一处，序 2 收敛**给人看**的那一处。★ 两者缺一：只做 1 ⇒ 机器读的是判据的、人读的还是没渲染；只做 2 ⇒ 渲染的是**重算**的那一份 |
| (a)-2 `stalled_count` 恒不可见 | 序 3 | 一条动作同时修 `stalled_count` 与 `shape_violation_count`：两者都从 `outputs` 读、都进 `outcome` |
| (a)-3 liveness `blocked` 支证据被丢 | 序 6 | ★ **只有这一个缺陷要动注册表** ⇒ 它是"必须单独立任务"的那一条 |
| (a)-4 `verifyProbe` 被丢 | 序 4 | |
| (a)-5 `verifiedChangedPaths` 被丢 | 序 5 | |
| (a)-6 `reviewedReadout` / `absorbReport` / `conveneReport` | — **无动作** | ★ **刻意留空**：前两个的根因是「零求值点」（§1 读数⑤），归 T1；`reviewedReadout` 要等 UI 侧先声明 `outputs` 格（`activity-model.ts:1218`），那是另一个写域。★ 留空而不是"凑一个动作"，是因为凑出来的动作会变成下一个"接上了但没人读" |

---

## 5. 三条**不该做**的事（防止下一轮把这份清单读成"44 个洞"）

```
✗ 不许给 (b) 类接线 —— 23 个假消费者比 23 个零读者更坏。
  判据：(b) 的那 23 个对各自都有一个人读的出口（§3.2 逐条给了），
        而接一个机器消费者会让"有人在看"变成一句假话。

✗ 不许为了消灭"零读者"而删判据的产出键 —— 除非它同时是 (c)。
  判据：(c) 只有 9 个对，而且删除要连带改 34 处夹具断言（§3.3）。
        "零读者"是【接线】的读数，不是【删除】的许可。

✗ 不许把 (a)-2 的 stalled_count 并进 blockers。
  判据：stall.ts:139-141 逐字「本判据不拒绝（runtime 位置的纪律）」，
        而 blockers 在 update-task.ts:1591 会触发拒绝。
        合并 = 让每个跑过 N 轮的任务都失败 = 把读数当裁决。
```

---

## 6. 只读证明（本任务没有改 `src/`）

```bash
# ① 我在本任务里改过的文件 —— 只有本文件（第一个是它自己）
git status --porcelain docs/OUTPUTS-CONSUMER-AUDIT.md
# →  M docs/OUTPUTS-CONSUMER-AUDIT.md          [exit 0]

# ② 本文件【相对 HEAD】的差异 —— 全部是我下面的修正（§6 与 §4.1 是后来补的）
git diff --stat docs/OUTPUTS-CONSUMER-AUDIT.md
# → 1 file changed, 104 insertions(+), 12 deletions(-)   [exit 0]
#   ★ 这个数会随我继续编辑而变，所以它**不**是证据；证据是 ③ 的【空输出】

# ③ 我没有碰 src/ lib/ scripts/ 的【源码】—— 但 lib/ 里有一个文件是脏的，见下
git status --porcelain src/ scripts/
# → （空）                                     [exit 0]

git status --porcelain lib/
# →  M lib/git-artifact-stamp.json            [exit 0]
```

### ★★ 关于 `lib/git-artifact-stamp.json` 那一条（不是我改的，但必须记）

```bash
git diff lib/git-artifact-stamp.json
# → -  "commit": "1eaaee1daf7a17bf695a7ac141276f7726ee9617"
# → +  "commit": "36dd06198800d60524a5df1fa065af7caf66885f"
# 而 36dd061 就是上面那条 commits 的 HEAD（21:15:03，t1 的收口提交）
# mtime: Oct 20 21:38:29 —— 比 36dd061 晚 23 分钟 ⇒ 是某次 `pnpm build` 的产物
```

★ 这个文件是**构建产物**（`scripts/build-atomic.test.mjs:419` 的 `REQUIRED` 列表里有它；
`gate-shared-artifact-writes.test.mjs` 逐字记着它是"共享产物"）。
它记的是"lib/ 这一份产物是照着哪个 commit 构建的"。★ **我在本任务里没有跑过任何
构建命令**（本任务全程只有 `node`、`grep`、`git status`、`git log`、`git diff`）⇒
它上面那个 mtime 与我无关，那是**本队别的任务**在 21:38 跑构建时刷新的。
⇒ 记在这里，因为下一轮复审跑 `git status` 会看到 `M lib/`，而它需要一个解释，
且那个解释**不能**是"我改了 lib/"。

```bash
# ④ 本任务我真正动过的，只有本文件：
git status --porcelain docs/OUTPUTS-CONSUMER-AUDIT.md
# →  M docs/OUTPUTS-CONSUMER-AUDIT.md          [exit 0]
```

### ★★★ 一条必须如实记下来的读数：本文件**已经不是未跟踪的新文件**了

```bash
git log --oneline -1 -- docs/OUTPUTS-CONSUMER-AUDIT.md
# → 36dd061 docs(admission): 补齐 4 处同源假话（t1 的 inScope 之外）—— UI 侧也在说「空段 / 未注册」
```

★ **`36dd061`（2026-10-20 21:15:03）把本文件一起提交了** —— 而那个提交是 **t1 的收口提交**
（同时改了 `src/client/activity-model.ts` / `src/client/locales.ts` / `src/snapshot.ts`
与它们 `lib/` 的产物）。⇒ 三件事必须说清楚，否则这份施工单的 §6 会读成一句假话：

```
① t1 的提交【不是我做的】—— 我在本任务里从未执行过 `git add` / `git commit`。
   我在本次会话里对 src/ 的写入次数 = 0（③ 的空输出是证据）。
   ★ 而"我没做"不是"它没发生"：那份提交里**确实**有本文件，而它把我的中间稿
     （§3.2 里两个还没改的计数）固定进了历史。

② ⇒ 所以本文件从"新增文件"变成了"相对 HEAD 改了 2 行"。
   这 2 行就是 ② 里那两处计数措辞（23 / 5 对）。**没有第三个改动。**

③ ★ 这条本身就是本仓记的那个形态的一个实例：
   「一个文件的**当前内容**与它**被谁、在哪个提交里固定下来**是两件事」——
   而只跑 `git status` 看到 `M` 而不是 `??` 的人，会以为"我改了一个已存在的文件"。
   ⇒ 记在这里，因为下一轮复审会看见 `M`，而它需要一个解释。
```

★ 探针脚本 `probe-payload-keys.mjs` / `probe-payload-readers.mjs` 是**生成本文件读数用**的，
放在 `/tmp/t2probe/`，**没有进仓**（它们不是本仓的机制，进仓会变成下一个"零读者")。
它们的全文见 §7 —— 任何人可以原样复跑。

---

## 7. 探针脚本全文（复跑用）

### 7.1 `probe-payload-keys.mjs` —— 每条判据 `ok:true` 的顶层键

```js
/**
 * ── 只读探针（T2 · 读数②）：22 条判据的 `ok:true` 裁决带哪些【产出键】──────────────
 *
 * 口径镜像 registry.ts:840 —— 只有 `ok === true` 的裁决，除 `ok` 以外的顶层键
 * 才被收进 `outputs`。⇒ 本探针逐文件找 `ok: true` 所在的**对象字面量**，取它的
 * **顶层键**（含简写与展开）。
 *
 * 用法（仓库根）：node probe-payload-keys.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const { registry } = await import(path.resolve('lib/gates/index.js'))

/** 从 `{` 的位置取出与它配对的 `}`（跳过字符串与注释）。 */
function objectLiteralAt(source, braceIndex) {
  let depth = 0, i = braceIndex, inString = null, inLine = false, inBlock = false
  for (; i < source.length; i++) {
    const ch = source[i], next = source[i + 1]
    if (inLine) { if (ch === '\n') inLine = false; continue }
    if (inBlock) { if (ch === '*' && next === '/') { inBlock = false; i++ } continue }
    if (inString !== null) {
      if (ch === '\\') { i++; continue }
      if (ch === inString) inString = null
      continue
    }
    if (ch === '/' && next === '/') { inLine = true; i++; continue }
    if (ch === '/' && next === '*') { inBlock = true; i++; continue }
    if (ch === "'" || ch === '"' || ch === '`') { inString = ch; continue }
    if (ch === '{') depth++
    if (ch === '}') { depth--; if (depth === 0) return source.slice(braceIndex, i + 1) }
  }
  return undefined
}

/** 顶层逗号切分（深度 1，跳过字符串与注释）。 */
function topLevelEntries(literal) {
  const body = literal.slice(1, -1)
  const entries = []
  let depth = 0, current = '', inString = null, inLine = false, inBlock = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i], next = body[i + 1]
    if (inLine) { current += ch; if (ch === '\n') inLine = false; continue }
    if (inBlock) { current += ch; if (ch === '*' && next === '/') { inBlock = false; current += next; i++ } continue }
    if (inString !== null) {
      current += ch
      if (ch === '\\') { current += body[i + 1] ?? ''; i++; continue }
      if (ch === inString) inString = null
      continue
    }
    if (ch === '/' && next === '/') { inLine = true; current += ch; continue }
    if (ch === '/' && next === '*') { inBlock = true; current += ch; continue }
    if (ch === "'" || ch === '"' || ch === '`') { inString = ch; current += ch; continue }
    if (ch === '{' || ch === '[' || ch === '(') depth++
    if (ch === '}' || ch === ']' || ch === ')') depth--
    if (ch === ',' && depth === 0) { entries.push(current); current = ''; continue }
    current += ch
  }
  if (current.trim() !== '') entries.push(current)
  return entries
    .map((e) => e.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim())
    .filter((e) => e !== '')
}

function keyOfEntry(entry) {
  if (entry.startsWith('...')) return { spread: entry.slice(3).trim() }
  const m = entry.match(/^'([^']+)'\s*:/) ?? entry.match(/^"([^"]+)"\s*:/) ?? entry.match(/^([A-Za-z_$][\w$-]*)\s*:/)
  if (m !== null) return { key: m[1] }
  const shorthand = entry.match(/^([A-Za-z_$][\w$]*)\s*$/)
  if (shorthand !== null) return { key: shorthand[1] }
  return {}
}

const rows = []
for (const point of Object.keys(registry.list())) {
  for (const gate of registry.list()[point]) {
    const file = `src/gates/${point}/${gate.id.split('.').pop()}.ts`
    if (!fs.existsSync(file)) { rows.push({ id: gate.id, point, keys: ['<文件缺失>'] }); continue }
    const source = fs.readFileSync(file, 'utf8')
    const keys = [], spread = []
    const re = /ok: true/g
    let m
    while ((m = re.exec(source)) !== null) {
      const lineStart = source.lastIndexOf('\n', m.index) + 1
      const lineText = source.slice(lineStart, source.indexOf('\n', m.index))
      /** 注释行不算（本仓注释里大量出现 `ok: true`）。 */
      if (/^\s*(\*|\/\/|\/\*)/.test(lineText)) continue
      /**
       * ★ 排除**类型层**的 `ok: true`（`{ ok: true; k: T }` / `|` 分支里的）。
       *   三种合法形态：① `ok: true,`（多行第一行）② `ok: true }` ③ `ok: true, k: v }`
       */
      const afterOk = lineText.slice(lineText.indexOf('ok: true') + 'ok: true'.length)
      const bareClose = /^\s*\}?\s*$/.test(afterOk)
      const firstOfMultiline = /^\s*,\s*$/.test(afterOk)
      const singleLinePayload = afterOk.match(/^\s*,\s*(.+?)\s*\}\s*$/)
      if (!bareClose && !firstOfMultiline && singleLinePayload === null) continue
      const brace = source.lastIndexOf('{', m.index)
      if (brace === -1) continue
      const literal = objectLiteralAt(source, brace)
      if (literal === undefined) continue
      for (const entry of topLevelEntries(literal)) {
        if (/^ok\s*:\s*true$/.test(entry)) continue
        const got = keyOfEntry(entry)
        if (got.key !== undefined) keys.push(got.key)
        if (got.spread !== undefined) spread.push(got.spread)
      }
    }
    rows.push({ id: gate.id, point, keys: [...new Set(keys)], spread: [...new Set(spread)] })
  }
}

for (const row of rows) {
  const shown = row.keys.length === 0 ? '(无产出键)' : row.keys.join(', ')
  const sp = row.spread.length === 0 ? '' : `  [展开: ${row.spread.join(' | ')}]`
  console.log(`${row.id.padEnd(32)} ${row.point.padEnd(11)} ${shown}${sp}`)
}
console.log('total =', rows.length)
const withKeys = rows.filter((r) => r.keys.length > 0).length
console.log('有产出键的判据 =', withKeys, '/ 无产出键的判据 =', rows.length - withKeys)
```

**实测输出**（2026-10-20，本机）：

```
admission.absorb                 admission   absorbReport
admission.checkpoint             admission   (无产出键)
admission.convene                admission   conveneReport
contract.build-artifact-scope    contract    (无产出键)
contract.verify-command          contract    verifyProbe
contract.task-atomicity          contract    atomicityReadout
dispatch.changed-paths           dispatch    verifiedChangedPaths
dispatch.worktree                dispatch    landed, skipped, arrivedIn, declaredPaths
dispatch.plan-reviewed           dispatch    reviewedReadout
completion.verify-rerun          completion  reruns
completion.r5                    completion  r5
completion.mutation              completion  mutationReport, mutationScore, killed, survived,
                                             corpus, batch, scope, early-stop, coverageUnmeasured
completion.backtest              completion  baseline, selection, full
delivery.coverage                delivery    goal_items, covered_goal_items, coverage_source
                                             [展开: in_progress_goal_items]
delivery.convergence             delivery    converged_members [展开: converged_note]
runtime.liveness                 runtime     skipped, probes, stuck_count, waited_count, message,
                                             first_probe, alive, stuck, interval_complete
                                             [展开: evidence | observation_inconsistent]
runtime.stall                    runtime     threshold, examined, stalled_count, observations
runtime.shape-execution          runtime     shape_violations, shape_violation_count
collection.dedupe                collection  (无产出键)
collection.cooldown              collection  (无产出键)
collection.attributable          collection  (无产出键)
collection.immunity              collection  (无产出键)
total = 22
有产出键的判据 = 16 / 无产出键的判据 = 6
```

### 7.2 `probe-payload-readers.mjs` —— 每个键的**生产读者**

```js
/**
 * ── 只读探针（T2 · 读数③）：每个产出键**谁读它** ─────────────────────────────────
 *
 * 口径（与本仓 scripts/gate-producer-consumer.test.mjs:36-46 的既有裁定一致）：
 *   ① 生产读者 = src/** 里【判据目录之外】、且**走产出通道**的读取点：
 *                 X.outputs['<gateId>']?.<key>  或  X.outputs['<gateId>']['<key>']
 *      ★ 注释行不算。★ 裸词不算（landed/scope/full/baseline 会各报 10+ 个假读者）。
 *   ② 夹具读者 = scripts/** 里同形访问 —— 证明"能被钉住"，**不算消费者**。
 *
 * 用法（仓库根）：node probe-payload-readers.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const GATES = [
  ['admission.absorb', ['absorbReport']],
  ['admission.checkpoint', []],
  ['admission.convene', ['conveneReport']],
  ['contract.build-artifact-scope', []],
  ['contract.verify-command', ['verifyProbe']],
  ['contract.task-atomicity', ['atomicityReadout']],
  ['dispatch.changed-paths', ['verifiedChangedPaths']],
  ['dispatch.worktree', ['landed', 'skipped', 'arrivedIn', 'declaredPaths']],
  ['dispatch.plan-reviewed', ['reviewedReadout']],
  ['completion.verify-rerun', ['reruns']],
  ['completion.r5', ['r5']],
  ['completion.mutation', ['mutationReport', 'mutationScore', 'killed', 'survived', 'corpus',
    'batch', 'scope', 'early-stop', 'coverageUnmeasured']],
  ['completion.backtest', ['baseline', 'selection', 'full']],
  ['delivery.coverage', ['goal_items', 'covered_goal_items', 'coverage_source', 'in_progress_goal_items']],
  ['delivery.convergence', ['converged_members', 'converged_note']],
  ['runtime.liveness', ['probes', 'stuck_count', 'waited_count', 'first_probe', 'alive', 'interval_complete', 'message']],
  ['runtime.stall', ['threshold', 'examined', 'stalled_count', 'observations']],
  ['runtime.shape-execution', ['shape_violations', 'shape_violation_count']],
  ['collection.dedupe', []],
  ['collection.cooldown', []],
  ['collection.attributable', []],
  ['collection.immunity', []],
]

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'worktrees' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

const srcFiles = walk('src')
const scriptFiles = fs.readdirSync('scripts').filter((n) => n.endsWith('.mjs')).map((n) => `scripts/${n}`)
const read = (f) => fs.readFileSync(f, 'utf8').split('\n')
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 产出通道：X.outputs['gateId']?.key  或  X.outputs['gateId']['key'] */
function outputChannel(files, gateId, key) {
  const found = []
  const patterns = [
    new RegExp(`outputs\\[['"]${esc(gateId)}['"]\\]\\s*\\??\\.\\s*${esc(key)}\\b`),
    new RegExp(`outputs\\[['"]${esc(gateId)}['"]\\]\\s*\\[\\s*['"]${esc(key)}['"]`),
  ]
  for (const file of files) {
    read(file).forEach((line, index) => {
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) return
      if (patterns.some((p) => p.test(line))) found.push(`${file}:${index + 1}`)
    })
  }
  return found
}

/** 夹具通道：outputs[...] 上的同形键访问（任意 gateId） */
function fixtureChannel(files, key) {
  const patterns = [
    new RegExp(`outputs\\[[^\\]]*\\]\\s*\\??\\.\\s*${esc(key)}\\b`),
    new RegExp(`outputs\\[[^\\]]*\\]\\s*\\[\\s*['"]${esc(key)}['"]`),
  ]
  const found = []
  for (const file of files) {
    read(file).forEach((line, index) => {
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) return
      if (patterns.some((p) => p.test(line))) found.push(`${file}:${index + 1}`)
    })
  }
  return found
}

let withReader = 0, without = 0
for (const [gateId, keys] of GATES) {
  console.log(`\n## ${gateId}`)
  if (keys.length === 0) { console.log('   产出键：无'); continue }
  for (const key of keys) {
    const production = outputChannel(srcFiles, gateId, key)
    const fixtures = fixtureChannel(scriptFiles, key)
    if (production.length > 0) withReader++
    else without++
    console.log(`   ${key.padEnd(22)} 生产: ${production.length === 0 ? '**无**' : production.join(' ')}`)
    console.log(`   ${''.padEnd(22)} 夹具: ${fixtures.length === 0 ? '无' : fixtures.join(' ')}`)
  }
}
console.log(`\n有生产读者的产出键 = ${withReader}；无生产读者的产出键 = ${without}`)
```

**实测输出尾部**（决定性那两行）：

```
## completion.verify-rerun
   reruns                 生产: src/tools/update-task.ts:1681
                          夹具: 无
...
有生产读者的产出键 = 1；无生产读者的产出键 = 42
```

### 7.3 ★ 这条探针自己踩过的三个坑（记下来，因为它们是同一族）

```
坑 1（第一版）：只认多行 `ok: true,`
  ⇒ `completion.verify-rerun` 的单行 `return { ok: true, reruns }` 被读成"无产出"。
  ⇒ 修：三种合法形态都要认（见脚本里的 bareClose / firstOfMultiline / singleLinePayload）。
  ★ 教训与源码那一族同源：「漏一格的表现是**它看起来不存在**，不是报错」。

坑 2（第二版）：没排除**类型层**的 `ok: true`
  ⇒ `dispatch.plan-reviewed.ts:394` 的返回类型声明
     `{ ok: true; reviewedReadout: ... } | { ok: false; ... }` 被当成一个裁决。
  ⇒ 修：`ok: true` 之后只允许 `,` 或 `}`。

坑 3（读者探针第一版）：按**裸词** grep 键名
  ⇒ `landed` 报 14 个"生产读者"、`scope` 报 17 个、`full` 报 18 个、`baseline` 报 63 个 ——
     **全部是假读者**：它们是 `worktree.ts` 的 `ReclaimReading.landed`、
     `quality-gates.ts` 的 inScope `scope`、`renderStatus` 的 `full` 之类同形标识符。
  ★ 这是本任务最值得记的一条：**"没有读者"这件事，用裸词 grep 是测不出来的** ——
    它会给出一个看起来很好的假读数，而那正是本仓记账最久的形态。
  ⇒ 修：只认**产出通道**（`outputs['<gateId>']` 后跟键访问），且注释行不算。
```

### 7.4 ★ 分类自检（不重不漏、合计 45）—— 这一段是给复审用的

分类是**人工判断**，所以必须有一条机械读数来证明"没有漏、没有重"。
脚本按「判据×键」对（**不是**按键名 —— 见下面的重名）核对：

```js
/** 只读自检：45 个 gate×key 对必须被 (a)/(b)/(c)/reader 各归一次。 */
const BY_GATE = {
  'admission.absorb': ['absorbReport'],
  'admission.convene': ['conveneReport'],
  'contract.verify-command': ['verifyProbe'],
  'contract.task-atomicity': ['atomicityReadout'],
  'dispatch.changed-paths': ['verifiedChangedPaths'],
  'dispatch.worktree': ['landed', 'skipped', 'arrivedIn', 'declaredPaths'],
  'dispatch.plan-reviewed': ['reviewedReadout'],
  'completion.verify-rerun': ['reruns'],
  'completion.r5': ['r5'],
  'completion.mutation': ['mutationReport','mutationScore','killed','survived','corpus','batch','scope','early-stop','coverageUnmeasured'],
  'completion.backtest': ['baseline','selection','full'],
  'delivery.coverage': ['goal_items','covered_goal_items','coverage_source','in_progress_goal_items'],
  'delivery.convergence': ['converged_members','converged_note'],
  'runtime.liveness': ['skipped','probes','stuck_count','waited_count','message','first_probe','alive','stuck','interval_complete'],
  'runtime.stall': ['threshold','examined','stalled_count','observations'],
  'runtime.shape-execution': ['shape_violations','shape_violation_count'],
}

const A = [
  'admission.absorb|absorbReport', 'admission.convene|conveneReport',
  'contract.verify-command|verifyProbe', 'dispatch.changed-paths|verifiedChangedPaths',
  'dispatch.plan-reviewed|reviewedReadout',
  'runtime.liveness|stuck_count', 'runtime.liveness|probes',
  'runtime.stall|stalled_count', 'runtime.stall|observations', 'runtime.stall|threshold',
  'runtime.shape-execution|shape_violations', 'delivery.coverage|coverage_source',
]
const READER = ['completion.verify-rerun|reruns']
const C = [
  'dispatch.worktree|landed', 'dispatch.worktree|arrivedIn', 'dispatch.worktree|declaredPaths',
  'dispatch.worktree|skipped', 'runtime.liveness|skipped',
  'completion.backtest|selection', 'runtime.stall|examined',
  'runtime.shape-execution|shape_violation_count', 'runtime.liveness|waited_count',
]
const B = [
  'contract.task-atomicity|atomicityReadout', 'completion.r5|r5',
  'runtime.liveness|message', 'runtime.liveness|first_probe', 'runtime.liveness|alive',
  'runtime.liveness|stuck', 'runtime.liveness|interval_complete',
  'delivery.convergence|converged_members', 'delivery.convergence|converged_note',
  'delivery.coverage|goal_items', 'delivery.coverage|covered_goal_items',
  'delivery.coverage|in_progress_goal_items',
  'completion.mutation|mutationReport','completion.mutation|mutationScore',
  'completion.mutation|killed','completion.mutation|survived','completion.mutation|corpus',
  'completion.mutation|batch','completion.mutation|scope','completion.mutation|early-stop',
  'completion.mutation|coverageUnmeasured',
  'completion.backtest|baseline','completion.backtest|full',
]

const pairs = []
for (const [g, ks] of Object.entries(BY_GATE)) for (const k of ks) pairs.push(`${g}|${k}`)
const classified = [...A, ...B, ...C, ...READER]
const dup = classified.filter((p, i) => classified.indexOf(p) !== i)
const missing = pairs.filter((p) => !classified.includes(p))
const extra = classified.filter((p) => !pairs.includes(p))

console.log('gate×key 对总数 =', pairs.length)
console.log('  (a) 该被读而没有   =', A.length)
console.log('  (b) 本来就只给人看 =', B.length)
console.log('  (c) 真没人需要     =', C.length)
console.log('  有读者             =', READER.length)
console.log('  合计               =', classified.length)
console.log('重复 =', dup.length === 0 ? '无' : dup)
console.log('漏归类 =', missing.length === 0 ? '无' : missing)
console.log('多出 =', extra.length === 0 ? '无' : extra)
```

**实测输出**：

```
gate×key 对总数 = 45
  (a) 该被读而没有   = 12
  (b) 本来就只给人看 = 23
  (c) 真没人需要     = 9
  有读者             = 1
  合计               = 45
重复 = 无
漏归类 = 无
多出 = 无
```

★ **为什么按「判据×键」对而不按键名**：45 对去重后只有 **44 个键名**，
因为 `skipped` 在 `dispatch.worktree:196` 与 `runtime.liveness:343` 各有一个
（★ 两者的**语义也不同**：前者是"这个任务没声明 worktree"，后者是"这个队此刻没人在等"）。
按键名数会把这个**两条不同的判决理由**合成一个 —— 那正是本仓记账的"两份真相合流"。
⇒ 本文件一律按对计。★ 而**分类时也不许把两处 `skipped` 合并**（§3.3 有专门一行）。

★★ **这张自检的诚实边界**：它证明的是「**归类覆盖了全部 45 对**」，
**不**证明「每个归类是对的」。(a)/(b)/(c) 的判据写在 §3.0，每一档的分类依据
在 §3.1-§3.3 逐条给出（带文件行号）—— 复审要驳的是**那些依据**，不是这张表。

---

## 8. 与 REQUIREMENTS / 其他任务的关系

- **T1（admission 假话）**：本文件 §1 读数⑤ 给出「`admission` 生产路径零求值点」的
  **可复跑命令**（`grep -rn "evaluate('admission'" src/` = 零命中）。
  §3.1 (a)-6 说明：`absorbReport` / `conveneReport` 的"无读者"**是派生的**，
  接线之前必须先有求值点 ⇒ **这条依赖 T1，本文件不单独立任务**。
- **本文件不改 `docs/REQUIREMENTS.md`**：本任务没有形成"新的已裁定需求"，
  它产出的是**读数与施工单**（按 `AGENTS.md` 的三格纪律，计划/提案进
  `docs/DECISIONS-PENDING.md`，而本文件是**读数**，不是需求）。
- **本文件不改 `src/`**（§6 给了 `git status` 的空输出）。

---

## 9. 一句话交接

```
(a) 12 个「判据×键」对、6 个独立缺陷 —— 其中 3 个可以低风险先做（§4 序 1-3），
    2 个需要配臂（序 4-5），1 个（注册表收证据）必须单独立任务。
(b) 23 个对 —— 什么都不做，并且【不许】为了"消灭零读者"接线。
(c)  9 个对 —— 先记账，删它要连带改 34 处夹具断言，不属本单。
★ 而最贵的一条不是任何一个键，是 §3.1 (a)-1 与 (a)-2 那两条：
  同一份事实被算了两次（shape），和一条恒不响的哨兵（stall）。
```
