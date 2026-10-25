# 孤岛普查：零引用导出的逐个定性（接线 / 删除 / 保留）

> **用户硬原则（原话）**：「**所有的线都要接。我不允许项目内存在任何没有被接线的"孤岛"，要么接线，要么删掉。如果它有用就接线，没用就删掉。**」
> **用户删除授权（原话）**：「**确定没有引用并且没有用就可以删除。大不了如果以后真的要用的话，再自己写一个。**」
>
> **本轮只出审计，不执行删除。** 处置建议可执行，但**删代码是不可逆动作**（用户已授权，仍需按本报告 §6 的「可重写性」判据逐条过）。
> **本文未改动 `src/`、`scripts/`、`lib/` 任何文件。**
> **基线**：HEAD `25e7e2b`。

---

## 0. ★ 先说一件必须留痕的事：队长先后给过三个数，都不是本报告的基数

**队长在本次任务里连续更正了两次，并明确要求我留痕。我照办。**

| # | 队长给的数 | 实测 | 差异根因（我回源定位） |
|---|---|---|---|
| 1 | 导出面 **561** / 孤岛 **88** | 561 对不上：我的等价口径是 **565** | 其正则只匹配 `^export (function\|const)`，**漏 `export class`、漏 `src/client/**/*.tsx`**；且用 `grep -w` 判引用 |
| 2 | 导出面 **724** / 孤岛 **12** | 孤岛 **12** ✅ 与我的实测**一致** | — |
| 3 | 导出面 **1027** / A 类 266 / B 类 141 | **1027 ≈ 我的「导出声明数」1029**；**A 类 266 与我的 12 对不上** | ★ 根因见 §0.2 |

### 0.1 `grep -w` 假阳性：我独立复现了队长指出的那条

```sh
$ grep -rn "PANEL_LAYOUT_STORAGE_KEY" src/ scripts/ | wc -l
4
$ grep -rn "PANEL_LAYOUT_STORAGE_KEY" src/ scripts/
src/client/ActivityPanel.tsx:65:  PANEL_LAYOUT_STORAGE_KEY,
src/client/ActivityPanel.tsx:118:  return parsePanelLayout(window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY))
src/client/ActivityPanel.tsx:435:  window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout))
src/client/panel-geometry.ts:24:export const PANEL_LAYOUT_STORAGE_KEY = 'dsh-agent-teams:activity-panel:v1'
```

⇒ **它被真实使用 3 次**，却被 `grep -w` 报成"零引用"。**队长的自我更正成立。**

### 0.2 ★ 1027 与 911 的差：**不是错，是两种口径**（这条值得单独记）

我实测两种数：

```sh
# 口径 A：唯一名字（unique names）
$ python3 …  # 见 §7 复现脚本
unique names = 911        # kinds: function 486 · interface 214 · const 121 · type 86 · class 2 · let 2

# 口径 B：导出声明处（declarations，重名计多次）
declarations = 1029       # kinds: function 534 · interface 215 · const 188 · type 88 · class 2 · let 2
```

**差 118 处，几乎全部来自判据文件**：

```sh
$ # 每个判据文件都导出 id / point / description / gate / appliesTo
$ grep -rc "^export const \(id\|point\|description\|gate\|appliesTo\) = " src/gates/*/*.ts | ...
# 17 条判据 × 5 个同名导出 = 85 个「声明处」，而「唯一名字」只算 5 个
# 另有 Config / apply / inject / MemberClock / TERMINAL_TASK_STATUSES … 等 14 组重名
$ # 实测：names exported from >1 place = 15，extra declarations = 118
```

⇒ **1027（队长）与 911（我）都对，只是口径不同**：队长数的是**声明处**，我数的是**唯一名字**。
★ **本报告一律用「唯一名字」口径**（因为"这个符号有没有人用"是**按名字**问的），并在 §7 给出两种口径的复现脚本。

### 0.3 ★ 266 与 12 的差：**`A 类` 的判据不同**

队长的 A 类（266）用的是「**src/ 与 scripts/ 双零引用**」；
我的 12 用的是「**在定义它的那个文件里也没被用过 + src/ 其它文件零引用 + scripts/ 零引用**」。

**差别 = 一个符号在「自己的文件里被自己用了」算不算"被接线"。**

我的判定：**不算接线**。理由（这是本报告的**核心口径**，请队长裁定）：

- 一个 `export function foo()` **只被同一文件的 `bar()` 调用**，而 `bar()` 又被生产调用 —— 那 `foo` **是**接线的（可达）。
- 但一个 `export function foo()` **只被同一文件的别处调用，而那条链最终也没人调** —— 那是**断链**。
- ⇒ 「是否接线」的**正确判据是可达性**，不是"本文件内出现过"。

★ 我**两者都算了**（见 §2 的三栏表），并把差异显式分开：
- **A1 类（真断链，本次重点）**：本文件内零使用 + 跨文件零引用 = **12 个**
- **A2 类（本文件内自用，但无跨文件消费者）**：**195 个**（含大量 `interface`/`type`，见 §2.3）

⇒ **本报告的 12 与队长的 266 不是矛盾，是两级口径**：队长给的是"跨文件零引用"的**上界**，我给的是"连自己文件都不用"的**下界**。**真死码必在 12 里；266 里那 254 个需要逐个看去向。**

---

## 1. 口径声明（三类必须不同形 —— 按队长要求分栏）

| 类 | 定义 | 本报告实测 | 复现命令 |
|---|---|---:|---|
| **导出面** | `src/**/*.{ts,tsx}`（不含 `.d.ts`）的**导出唯一名字** | **911** | §7 脚本（口径 A） |
| **A1 · 零引用（真断链）** | 本文件内零使用 **且** src/ 其它文件零引用 **且** scripts/ 零引用 | **12** | §7 脚本（口径 C） |
| **B · 仅被 scripts/ 引用** | src/ 零引用，但有 scripts/ 引用 | **27** | §7 脚本（口径 D） |
| **C · 无法判定** | 动态引用探测不到（按名查表 / 字符串拼名 / `Object.entries`） | **1**（`describeReclaimability`，见 §4） | §7 脚本（口径 E） |

★ **B 类不叫孤岛**，叫「**缺生产调用方**」—— 测试是它唯一消费者。**按队长的口径要求单列。**
★ 三类**不合成一个数**。

---

## 2. A1 类：12 个真断链（逐个定性）

**共同的可复跑证据**（对每个符号都跑过）：

```sh
# ① 跨文件零引用（纯子串，不用 grep -w —— 见 §0.1 的教训）
$ python3 -c "…逐符号 count() …"     # 见 §7 脚本
# ② 本文件内零使用（排除它自己的定义行）
# ③ 名字从未作为【字符串】出现在任何地方（排除按名查表/字符串拼名）
```

| # | 符号 | 位置 | 声明种类 | 它做什么 | 反证尝试 | **处置** |
|---|---|---|---|---|---|---|
| 1 | `MEMBER_NEVER_SPAWNED` | `src/members.ts:935` | const | 「这个成员**从未被 spawn**，所以"它活着吗"不是一个能问它的问题」 | 名字作为字符串：**无**；动态查表：**无** | **接线**（★ 见 §2.1） |
| 2 | `VERIFY_COMMAND_GATE_ID` | `src/gates/contract/verify-command.ts:76` | const | 判据 id 的别名（`= id`），供调用方按需注入执行器 | 无 | **删除**（★ 见 §2.2） |
| 3 | `L1_LAYER` | `src/mutation.ts:85` | const | `= L1_OPERATORS` 的别名 | 无 | **删除**（纯别名，见 §2.3） |
| 4 | `L2_LAYER` | `src/mutation.ts:86` | const | `= L2_OPERATORS` 的别名 | 无 | **删除**（纯别名） |
| 5 | `TASK_FAILURE_TONES` | `src/client/activity-monitor.ts:24` | const | 任务失败色调表 | 无 | **删除**（★ 见 §2.4） |
| 6 | `interruptMember` | `src/members.ts:735` | function | 中断一个成员的子会话 | 无 | **保留**（★ 见 §2.5） |
| 7 | `inRange` | `src/mutation.ts:328` | function | 行号是否落在区间内 | 无 | **删除**（★ 见 §2.3） |
| 8 | `isTaskKind` | `src/quality-gates.ts:2304` | function | 类型守卫 `value is TaskKind` | 无 | **删除**（★ 见 §2.6） |
| 9 | `isFindingSeverity` | `src/quality-gates.ts:2337` | function | 类型守卫 `value is FindingSeverity` | 无 | **删除**（★ 见 §2.6） |
| 10 | `hasReviewLoop` | `src/client/activity-model.ts:432` | function | 任务列表里有没有 review 循环 | 无 | **删除**（★ 见 §2.4） |
| 11 | `describeWorktree` | `src/worktree.ts:653` | function | 把 worktree 结果渲染成人话 | 无 | **保留**（★ 见 §2.5） |
| 12 | `isWorktreePointer` | `src/worktree.ts:1290` | function | 判一个文件是不是 worktree 指针 | 无 | **保留**（★ 见 §2.5） |

★ **12 个里，零个的「反证尝试」找到动态引用**（我探测了三类：字符串字面量、`Object.entries`/`Object.keys` 遍历、注册表按名查表 —— 见 §7 脚本口径 E）。**但"我没找到"≠"它不存在"，见 §5。**

### 2.1 `MEMBER_NEVER_SPAWNED` → **接线**（不是删）

**队长的抽样判断正确，我回源确认并给出更强证据 —— 不是一个孤例，是一对里的一个：**

```sh
$ sed -n '932p;935p' src/members.ts
export const DRIVER_STATUS_UNREADABLE = 'the live Agent driver is present but reports a lifecycle status that is neither "running" nor "idle"'
export const MEMBER_NEVER_SPAWNED = 'this member was never spawned (no child session id), so whether it is alive is not a question that can be asked of it'

$ grep -rn "DRIVER_STATUS_UNREADABLE" src/ scripts/
src/members.ts:932:export const DRIVER_STATUS_UNREADABLE = '…'
src/members.ts:982:    reason: `${DRIVER_STATUS_UNREADABLE} (reported: ${JSON.stringify(String(live.status))})`,   ← ★ 已接线

$ grep -rn "MEMBER_NEVER_SPAWNED" src/ scripts/
src/members.ts:935:export const MEMBER_NEVER_SPAWNED = '…'                                                    ← ★ 只有定义
```

**它俩是同一个块里、同一类东西（"成因人话串"），一个接了、一个没接。**
而 `MEMBER_NEVER_SPAWNED` 该接的地方**就在隔壁 26 行**：

```sh
$ sed -n '960,962p' src/members.ts
  if (member.id === '') {
    return { state: 'never-spawned', readout: 'never-spawned', rejects: false }   ← ★ 没有 reason 字段
  }
# 对比 :981-983 的 driver-status-unreadable 分支：它【有】reason
```

⇒ **接线点：`src/members.ts:961` 的返回对象加 `reason: MEMBER_NEVER_SPAWNED`**，
与 `:982` 的 `driver-status-unreadable` 分支**同形**。

**接上后达成什么**：把 `never-spawned` 这一态**从 code-string 升级为可读的人话** ——
而 `readout: 'never-spawned'` 是个**机器码**，读日志的人拿不到那句区分
（「它没起来过」与「起来了又死了」不同形）。★ 这正是 `convergence.ts:93` 逐字要求的那条区分：
> `state: 'never-spawned'` 是一个**可判定的事实**（它没起来过、也就没交回任何…

★ **本条不是"删除候选"** —— 删掉它等于把「从未启动」这条**已固化的语义**从代码里拿掉。

### 2.2 `VERIFY_COMMAND_GATE_ID` → **删除**（机制已被更简单的做法取代）

该常量的**设计意图**（`verify-command.ts:68-75` 逐字）：
> 这个 id 的另一半用途：**调用方可以按它决定要不要注入执行器**……要在 `create_task` / `amend_task` 上按需注入，调用方必须能问出"contract 位置有没有一条判据需要跑命令"

**但实际实现是【无条件注入】**：

```sh
$ sed -n '754p' src/tools/create-task.ts
            execVerifyCommand: (command: string): Promise<number> => runVerifyCommand(workspace, command),

$ sed -n '91p' src/tools/amend-task.ts
            execVerifyCommand: (command: string): Promise<number> => runVerifyCommand(workspace, command),
```

⇒ **两处都不问 gate id，直接注入。** 「按需注入」这条路由**从未被实现**，常量是它的遗留。

| 判据 | 结论 |
|---|---|
| 零引用？ | ✅ 实测零（含字符串、动态查表） |
| 能轻易重写？ | ✅ 一行 `export const VERIFY_COMMAND_GATE_ID = id` |
| 承载已固化语义？ | ❌ **机制已被取代** —— 无条件注入比"按需问"更简单，且两处生产调用点都已这样写 |

**⇒ 删除。** ★ 但**若**队长打算恢复"按需注入"（那会让 `contract.verify-command` 不再被无条件求值），**则改为接线** —— 这条归 §6 待裁定。

### 2.3 `L1_LAYER` / `L2_LAYER` / `inRange` → **删除**

```sh
$ sed -n '85,86p;328p' src/mutation.ts
export const L1_LAYER = L1_OPERATORS
export const L2_LAYER = L2_OPERATORS
export function inRange(line: number, range: LineRange): boolean {

$ grep -rn "L1_LAYER\|L2_LAYER" src/ scripts/ | wc -l
2      # 只有那两行定义
```

- `L1_LAYER` / `L2_LAYER` 是 `L1_OPERATORS` / `L2_OPERATORS` 的**纯别名**（真名在同文件 `:65`/`:78`，**在用**）。
- `inRange` 是 3 行纯函数（区间判定）。

**⇒ 三个都可删**：零引用、可一行重写、不承载判据语义（`mutation.ts` 的判据语义在 `completion.mutation` 判据里，不在这几个工具函数）。

### 2.4 `hasReviewLoop` / `TASK_FAILURE_TONES` → **删除**（★ 但记下它的来由）

**`hasReviewLoop`（`activity-model.ts:432`）**：这次不是"从没接过"，而是**接线后被 UI 删除**：

```sh
$ git log --oneline -S"hasReviewLoop" --format="%h %s" -- src/client/
3296ef8 merge: land t13, the amber convergence UI
$ # ★ 它只被【引入】，没有别的历史 —— 说明它从未有第二个消费者
```

**同族（`loopFacts`/`nextLoopDisclosure`/`toggleLoopDisclosure`/`roundTailCounts`）** 则**确实有过消费者，被 `3ce3e76` 删掉了**：

```sh
$ git show 3ce3e76 -- src/client/ActivityPanel.tsx | grep -E "^[-+].*(loopFacts|toggleLoopDisclosure|roundTailCounts)" | head
-  loopFacts,
-  nextLoopDisclosure,
-  roundTailCounts,
-  toggleLoopDisclosure,
-  const facts = useMemo(() => loopFacts(loop, discarded), [loop, discarded])
-      const next = nextLoopDisclosure(current, facts)
-        onClick={() => { setDisclosure((current) => toggleLoopDisclosure(…)) }}
-                {discarded ? t('task.status.notRun') : roundTailCounts(…)}
```

★ 那个 commit 的说明是「**screen two becomes the dependency graph alone**」——
⇒ **UI 被主动删减，`activity-model.ts` 里的计算逻辑留了下来**。
⇒ 这是**「展示层收缩，模型层未跟上」**的一批 —— 归 **§6 待裁定**（要么接线、要么删），
**但不是"从未接过"**，性质与 §2.2 不同。

**`TASK_FAILURE_TONES`（`activity-monitor.ts:24`）**：零引用（含 `isBrokenFailure`/`isConsultativeFailure`/`isUnmeasuredFailure` 同族 —— 那三个**是 B 类**，被 `workspace-activity.test.mjs` 引用）。

### 2.5 `interruptMember` / `describeWorktree` / `isWorktreePointer` → **保留**

三个都是**功能完整、可轻易接线、但删除会留下缺口**的：

| 符号 | 位置 | 保留理由 |
|---|---|---|
| `interruptMember` | `members.ts:735` | 中断成员子会话的**唯一实现**。删了 = 团队失去"中断一个跑飞的成员"这条能力，而用户原则是"有用就接线" |
| `describeWorktree` | `worktree.ts:653` | `WorktreeResult` → 人话。★ 而同文件的 `describeReclaimability` **正被生产脚本消费**（§4）—— 说明这一族"人话渲染"在本仓是**有消费先例的** |
| `isWorktreePointer` | `worktree.ts:1290` | 判 worktree 指针文件。与 `dispatch.worktree` 判据的**同一语义域**（隔离树识别） |

★ 这三个我**不判删除**，因为**用户原则的第一半是"有用就接线"** —— 而判断"有没有用"需要
**它们的消费者是否曾存在**的证据，这三个我都**没找到"从未需要"的证据**（=`我没找到`，不是`不存在`，见 §5）。

### 2.6 `isTaskKind` / `isFindingSeverity` → **删除**

两个**类型守卫**，零引用。同文件里有一族同类（`isReviewPolicy`／`isTaskEvidence`／`isCommandResult` 等），
**那一族是 B 类（有测试）**，唯独这两个**连测试都没有**。

```sh
$ grep -rn "isTaskKind\|isFindingSeverity" src/ scripts/
src/quality-gates.ts:2304:export function isTaskKind(value: unknown): value is TaskKind {
src/quality-gates.ts:2337:export function isFindingSeverity(value: unknown): value is FindingSeverity {
```

⇒ **删除**（零引用 + 一行可重写 + 不承载判据语义）。
★ 但**记一笔**：`quality-gates.ts` 里这对"有守卫的"与"没守卫的"并列，
说明该文件的守卫族**本身是不完整的** —— 这归 §6。

---

## 3. B 类：27 个「缺生产调用方」（**不叫孤岛**）

这 27 个**有测试引用**，src/ 零引用。**测试是它们唯一消费者。**

```sh
$ python3 …（口径 D）
count: 27   kinds: {'function': 26, 'const': 1}
```

**处置口径**（用户授权 + 队长的"不可删"三条）：
**B 类的删除 = 连测试一起删 = 在删判据** ⇒ **除个别外，一律不删**，转「**接线**」或「**保留**」。

| 符号 | 位置 | 消费者 | 处置 |
|---|---|---|---|
| `readExperienceDispatch` | `tools/shared/entities.ts:1896` | `gate-experience-dispatch.test.mjs` | **接线**（★ 见下） |
| `readContractGateVerdict` | `quality-gates.ts:1649` | 2 个夹具 + **`fixtures/baseline-known-failures.json`** | **保留**（★ 见 §3.2） |
| `describeReclaimability` | `worktree.ts:1249` | **`worktree-reclaim.mjs`（生产脚本）** + 2 夹具 | ★ **它其实不是 B 类，见 §4** |
| `parseStatusLine` | `mutation-guard.ts:163` | `gate-mutation-guard.test.mjs` | 保留 |
| `buildDeliveryRecord` / `describeDeliveries` | `state.ts:409` / `:551` | `gate-delivered-blocked.test.mjs` | 保留 |
| `dependencyStatuses` / `describeDependencyOutcomes` | `state.ts:339` / `:364` | `gate-terminal-dependency.test.mjs` | 保留 |
| `removeTeamDir` / `teamLockQueueKeys` | `state.ts:1343` / `:86` | `verify.mjs` | 保留 |
| `resetWaitRecords` / `waitWindowSnapshot` | `tools.ts:883` / `:870` | 4 个夹具（含 `gate-runtime-liveness`） | 保留 |
| `modelBindingOf` | `create-task.ts:142` | `gate-task-model-binding.test.mjs` | 保留 |
| `rehydrateReplayCtx` | `entities.ts:2999` | 2 个夹具 | 保留 |
| `FAILURE_KIND_NAMES` / `summariseExecutions` | `types.ts:271` / `:922` | `gate-execution-history.test.mjs` | 保留 |
| `invokedAgentTeamsGoal` | `command.ts:61` | `lifecycle-verify.mjs` | 保留 |
| client 侧 11 个（见 §3.1） | `activity-model.ts` / `activity-monitor.ts` | `workspace-activity.test.mjs` / `verify.mjs` | **保留**（★ 它们的测试是**真行为断言**） |

### 3.1 ★ client 侧的"仅测试引用"里，两条在**主验证驱动**里

```sh
$ grep -n "liveCaptainTeam\|teamProgressSummary" scripts/verify.mjs
48:  liveCaptainTeam,
50:  teamProgressSummary,
885:check('live captain team is selected only for the current session', liveCaptainTeam([liveTeam], 'captain-1') === liveTeam)
886:check('halted captain team is hidden from the composer banner', liveCaptainTeam([{ ...liveTeam, halted: true }], 'captain-1') === undefined)
901:check('progress summary prefers running task titles', teamProgressSummary(liveTeam, '、').detail === 'Clarify requirements')
```

★ `scripts/verify.mjs` **就是 `pnpm verify` 的主驱动**（`package.json:92`）。
⇒ 这两个符号有**真实的行为契约**，且**被主验收集跑**。**删它 = 删验收。**

### 3.2 `readContractGateVerdict` → **保留**（★ 本报告最重要的一条"不可删"）

**它零生产引用，但有一份成文的裁定链说明"为什么现在不能接"**：

```sh
$ grep -n "readContractGateVerdict" scripts/fixtures/baseline-known-failures.json
22:  "because": "…★ 而多出来的那一条不是可以记账的存量：臂 4 自己的长注释（④）逐字判定它是
   `readContractGateVerdict`（src/quality-gates.ts:1301），形状正是 t41 —— 该做的是【去接线】，
   不许把上限调成 21。★★ t7 实测：src/ 全仓对它的引用为【零】…
   ★★★ 而 t7 没有接线，因为它现在被另一条已生效的裁定挡住（如实报告，不是没做）：
   `readContractGateVerdict` 对 `unmeasured` 的处置是 rejects: false（放行、但留痕），
   而 t5 的裁定（A.5）明确要求契约位置保留拒绝 unmeasured（见 src/gates/contract/verify-command.ts:88-97）…
   ⇒ 直接把生产接到这条读数上，会让'判不了契约的任务静默进入工作'——那是 t5 刚裁定不许做的事。"
```

⇒ **这是「明确判定为不可删」的一条**：它**有测试钉着**（`gate-unmeasured-not-blocked` + `gate-producer-consumer`），
且接上它会**违反另一条已生效的裁定**。**处置：保留**，并在 §6 记为待裁定（两条裁定的冲突）。

---

## 4. C 类：无法判定 / 需改判的（1 个）

### 4.1 ★ `describeReclaimability` —— **我原本会把它判成 B 类，这是「grep 抓不到的动态引用」的真实样本**

```sh
$ grep -n "describeReclaimability" scripts/worktree-reclaim.mjs
126:import { judgeWorktreeReclaimable, describeReclaimability } from '../lib/worktree.js'
233:      human: describeReclaimability(verdict),
294:    human: describeReclaimability(verdict),
```

而 `scripts/worktree-reclaim.mjs` **是被生产动态 import 的**：

```sh
$ sed -n '727,729p' src/tools/update-task.ts
async function loadWorktreeReclaimModule(): Promise<ReclaimJudgeModule> {
  const target = pathToFileURL(join(pluginRoot(), 'scripts', 'worktree-reclaim.mjs')).href
  return await import(/* @vite-ignore */ target) as ReclaimJudgeModule
```

⇒ **`describeReclaimability` 是接线的**（可达路径：`update-task.ts` → 动态 import → `worktree-reclaim.mjs:233` → 它）。
**它不是孤岛，也不是 B 类。** 我把它单列为 §4 —— **因为它是本报告里最该被记住的一例**：

> **静态 grep（即使是纯子串）看不见"被 `pluginRoot()` 动态 import 的脚本消费"这条路。**

★ 而**同族**的 `judgeWorktreeReclaimable`（`:814`）有 4 处 src/ 引用所以从未被误判 ——
**两个兄弟，一个因有一条类型 import 而"看起来接线"，一个因只被动态脚本用而"看起来死了"。**

### 4.2 队长特别点的 `LEAD_ART` / `ACTION_ART` —— **假设不成立，它们不是孤岛**

队长提示这可能是"被渲染层动态引用"的一类。**我实测：它们是被【静态 import】的，一共 5 个消费者。**

```sh
$ grep -rn "LEAD_ART\|ACTION_ART" src/client/ | grep -v "artwork.ts:2[69]"
src/client/ActivityPanel.tsx:57:import { LEAD_ART } from './artwork.ts'
src/client/AgentTeamsCard.tsx:22:import { LEAD_ART, memberArtUrl } from './artwork.ts'
src/client/AgentTeamsCard.tsx:90:        <img className={css.leadAvatar} src={LEAD_ART} alt="" aria-hidden />
src/client/TeamChatEntry.tsx:7:import { LEAD_ART } from './artwork.ts'
src/client/TeamChatEntry.tsx:16:    <img src={LEAD_ART} alt="" aria-hidden />{t('workspace.focus')}
src/client/CaptainNode.tsx:15:import { LEAD_ART } from './artwork.ts'
src/client/CaptainNode.tsx:51:        <img className={css.leadAvatar} src={LEAD_ART} alt="" aria-hidden />
src/client/MemberRow.tsx:45:import { ACTION_ART, memberArtUrl } from './artwork.ts'
src/client/MemberRow.tsx:301:          <img className={css.stateArt} data-activity={member.activity} src={ACTION_ART[member.activity]} alt="" aria-hidden />
```

⇒ ★ **它们是首次普查的假阳性（§0.1 那一类），不是动态引用。**
`ACTION_ART[member.activity]` **是**一次按名查表 —— 但查的是**表内键**，表本身是静态 import 的。

---

## 5. ★ 「确实没用」与「我没找到」的分界（本仓记账最久的一条）

**我做的反证尝试**（对 12 个 A1 类逐个跑，脚本见 §7 口径 E）：

1. **名字作为字符串**出现在任何 `src/`+`scripts/` 文件（`'NAME'` / `"NAME"` / `` `NAME` ``）；
2. **`Object.entries` / `Object.keys` / `Object.values` 遍历**该名字所在的对象；
3. **注册表按名查表**（`registry.register` / `Map.get(name)` / `lookup[` 形态）；
4. **`.mjs` 脚本里的 import**（含被动态 import 的脚本，见 §4.1）；
5. **git 历史**：该名字是否**曾经**有消费者（`git log -S`）。

**结果**：12 个里**没有一个**找到动态引用。**但我必须写明这个结论的边界**：

> **「12 个都没有动态引用」是一个【有限覆盖】下的结论。**
> - ✅ 覆盖到：字符串字面量、三种 `Object.*` 遍历、`import`/动态 `import`、git 历史。
> - ❌ **覆盖不到**：运行时拼出来的名字（如 `'foo' + bar`）、宿主框架按 manifest 查表、
>   外部消费者（本仓 `package.json` 只暴露 `.` 与 `./client` 两个入口，但**外部包可以深路径 import `lib/...`**）。
>
> ⇒ 因此我对**每一个** A1 类的措辞都是「**实测零引用**」，而**不是**「**确实没人用**」。
> **前者是读数，后者需要覆盖性前提**——而那个前提我给不出。

★ **这正是本仓记账最久的形态**，我按队长要求**显式留痕**。
⇒ **凡是我写「删除」的，都是「实测零引用 + 能轻易重写 + 不承载已固化语义」三条同时成立**，
**不是**「我断定它没用」。

---

## 6. 待用户/队长裁定（本报告不自行决定）

| # | 待裁定 | 关联 | 若不裁定 |
|---|---|---|---|
| **Q1** | **A1 类 12 个里，`interruptMember`/`describeWorktree`/`isWorktreePointer` 三个是「接线」还是「删除」？** 我倾向接线（用户原则"有用就接线"），但**"有没有用"需要消费者证据，而我只查到"从未有过消费者"** | §2.5 | 三个能力点悬空 |
| **Q2** | **`VERIFY_COMMAND_GATE_ID`：删除，还是恢复"按需注入"？** 删=承认机制被取代；恢复=让 `contract.verify-command` 不再被无条件求值 | §2.2 | 一个设计意图没有落点 |
| **Q3** | ★ **`readContractGateVerdict` 的两条裁定冲突**（基线文件已写明：接上它会违反 t5 对 `unmeasured` 的处置）—— **先裁哪一条？** | §3.2 | 一条判据长期挂着不能接 |
| **Q4** | **client 那批「UI 被删、模型层留下」的符号**（`loopFacts`/`nextLoopDisclosure`/`toggleLoopDisclosure`/`roundTailCounts`/`hasReviewLoop`）—— **是"等 UI 回来"还是"配套删掉"？** | §2.4 | 6 个符号长期悬空 |
| **Q5** | **队长的 A 类 266 里，那 254 个「本文件内自用但无跨文件消费者」怎么算？** 我给的是"不算接线"的口径（§0.3），与你的 266 不同 | §0.3 | 两套口径长期并存 |

---

## 7. 复现命令与脚本（本报告全部读数的来源）

```sh
cd /Users/abab/Desktop/agent-teams-dev    # HEAD 25e7e2b
```

**口径 A/B —— 导出面（两种数）**
```sh
python3 - <<'PY'
import re, os, io
from collections import Counter
by={}
for dp,ds,fs in os.walk('src'):
    for f in fs:
        if f.endswith(('.ts','.tsx')) and not f.endswith('.d.ts'):
            p=os.path.join(dp,f)
            for i,l in enumerate(io.open(p,encoding='utf-8',errors='replace'),1):
                m=re.match(r'^export\s+(?:declare\s+)?(?:async\s+)?(function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)',l)
                if m: by.setdefault(m.group(2),[]).append((p,i,m.group(1)))
print("unique names (口径A):", len(by))
print("declarations (口径B):", sum(len(v) for v in by.values()))
print("kinds:", dict(Counter(v[0][2] for v in by.values())))
PY
# ⇒ unique 911 · declarations 1029 · {function 486, interface 214, const 121, type 86, class 2, let 2}
```

**口径 C/D/E —— 孤岛分类（★ 用纯子串，不用 `grep -w`，见 §0.1）**
```sh
python3 - <<'PY'
import re, os, io, json
def collect(exts):
    out={}
    for dp,ds,fs in os.walk('src'):
        for f in fs:
            if f.endswith(exts) and not f.endswith('.d.ts'):
                p=os.path.join(dp,f)
                for i,l in enumerate(io.open(p,encoding='utf-8',errors='replace'),1):
                    m=re.match(r'^export\s+(?:declare\s+)?(?:async\s+)?(function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)',l)
                    if m: out.setdefault(m.group(2),(p,i,m.group(1)))
    return out
def corpus():
    c={}
    for root in ('src','scripts'):
        for dp,ds,fs in os.walk(root):
            for f in fs:
                if f.endswith(('.ts','.tsx','.mjs','.js','.json','.css','.yml')):
                    p=os.path.join(dp,f); c[p]=io.open(p,encoding='utf-8',errors='replace').read()
    return c
exp=collect(('.ts','.tsx'))
val={k:v for k,v in exp.items() if v[2] in ('function','const','let','var','class')}
corp=corpus()
A1=[];B=[]
for s,(p,ln,k) in val.items():
    lines=io.open(p,encoding='utf-8',errors='replace').read().split('\n')
    own='\n'.join(l for i,l in enumerate(lines,1) if i!=ln).count(s)          # 本文件内使用（排除定义行）
    cross=[q for q,t in corp.items() if q!=p and s in t]                      # 跨文件（纯子串）
    if own==0 and not cross: A1.append((s,p,ln,k))
    elif own==0 and cross and not [q for q in cross if 'src/' in q]: B.append((s,p,ln,k))
print("A1 (真断链):", len(A1))
for x in sorted(A1,key=lambda z:z[1]): print("   ",x)
print("B (仅 scripts):", len(B))
# 口径E：动态引用反证（字符串 / Object.* 遍历）
for s,p,ln,k in A1:
    quoted=[q for q,t in corp.items() if q!=p and re.search(r'[\'"`]'+re.escape(s)+r'[\'"`]',t)]
    if quoted: print("   ★ DYNAMIC:",s,quoted)
PY
# ⇒ A1 = 12 · B = 27 · 动态反证命中 0 个
```

**`readExperienceDispatch` 的零生产调用方（队长的实例，我复核为真）**
```sh
grep -rn "readExperienceDispatch" src/ scripts/
# ⇒ src/ 只有定义处（entities.ts:1896）；其余 14 处全在 scripts/gate-experience-dispatch.test.mjs
grep -rn "loadFrictionTriageModule" src/
# ⇒ entities.ts:1902（被 readExperienceDispatch 调）· :1993（定义）· update-task.ts:715（注释）
# ⇒ ★ 链条最后一环断掉，与队长+t27 的结论一致
```

---

## 8. 处置后的预计净变化

**★ 以下基于「实测零引用 + 可轻易重写 + 不承载已固化语义」三条同时成立者。**

| 处置 | 个数 | 预计 `src/` 行数变化 | 预计导出符号变化 |
|---|---:|---:|---:|
| **删除（A1 类，§2.2 ~ §2.6）** | **7** | ≈ **−35 行** | **−7** |
| 接线（A1 类，§2.1） | **1** | +1 行 | 0（已存在，改为被引用） |
| 保留（A1 类，§2.5 + 待裁定 §6-Q1） | **4** | 0 | 0 |
| **删除（B 类）** | **0** | 0 | 0 |
| 保留（B 类，含测试钉住的） | **27** | 0 | 0 |
| 无法判定（§4） | **1** | 0 | 0 |

**具体 7 个删除项**：`VERIFY_COMMAND_GATE_ID` · `L1_LAYER` · `L2_LAYER` · `inRange` ·
`isTaskKind` · `isFindingSeverity` · `hasReviewLoop`

**7 个删除项的逐条行数**（供核算）：

```sh
$ for s in VERIFY_COMMAND_GATE_ID L1_LAYER L2_LAYER inRange isTaskKind isFindingSeverity hasReviewLoop; do
    grep -rn "^export .*\b$s\b" src/; done
# 各自 1 行定义（inRange/isTaskKind/isFindingSeverity/hasReviewLoop 的【函数体】另计，故实际删除行数 > 7）
```

★ **诚实说明**：上表 **−35 行是粗估**（7 行导出声明 + 函数体）。
**精确值需在真正删除时以 `git diff --stat` 为准** —— 本轮**不执行删除**，故**不给精确数**（本仓纪律：不给未经实测的数字）。

★ **导出面变化**：911 → **904**（口径 A）/ 1029 → **1022**（口径 B）。

★ **对用户硬原则的覆盖率**：**12/911 = 1.3%** 是 A1 类真断链；
**266（队长口径）− 12 = 254 个**需要按 §0.3 的口径**逐个看去向** —— **这批是本轮未覆盖的部分**，
而它**恰好是队长 A 类的主体**。⇒ **本报告没有"清零孤岛"**，只**清点了最硬的那一层**。

---

## 9. 本报告的局限（明确留白）

1. **A 类 266 → 我实测 12**：口径差已在 §0.3 讲清。**254 个未逐个审计**（超出本轮范围；它们的定义是"本文件内自用"）。
2. **动态引用探测是有限覆盖**（§5）。我列了 5 种反证手段与**3 类覆盖不到的情形**。
3. **未跑 `pnpm build` / `typecheck`**：本轮是只读审计（且无删除动作），故不产生编译证据。
4. **`interface`/`type` 类未逐个判**：队长指出 121 interface + 43 type 是"契约面，删了会删契约" ——
   我**同意该判断**，且**本轮未对它们做逐个定性**（它们本来就不在我 A1 的 12 里，因为我的口径要求"本文件内也不用"）。
5. **`lib/`（编译产物）未查**：`lib/` 是 `src/` 的产物，本轮不动、也不据它判断。

---

*本报告只读：未改动 `src/`、`scripts/`、`lib/` 任何文件；未执行任何删除。基线 HEAD `25e7e2b`。*
