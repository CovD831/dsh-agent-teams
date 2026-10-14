# 两份 `ran[]` 读出契约（批次 1 前置）

> **本文件的性质**：**契约**，不是实现、不是提案。它写下来是为了让 `A1`（读数出口 → `/state`）与
> `D1/D2`（判据落盘 → 卡点记录）**可以并行开工而不撞车**。
> **背景（t25 F1，blocker）**：两者改的是**同一条通路的两端**（同一份 `ran[]`），
> 各自假设一种用法 ⇒ 合流时撞车 —— 那是 **t54 形态**（inScope 各自成立、合起来漏）。
>
> **基线**：HEAD `5cc8e40`（分支 `task-mutation-integrate`）。全部 `文件:行` 均为我**自己回源核对**，非转述。
> **本轮不改** `src/`、`scripts/`、`lib/` 任何文件。

---

## 0. ★ 开工前必须先读：任务书里有一条前提在本分支上**不成立**

任务书（t47）逐字写：
> ★ **注意**：`gateIdFromMessage` 的丢数据缺陷**已修**（提交 `4be6952`，新增 `gateIdsFromMessage`）

**实测：在该提交上为真，但在本分支上不成立。** 三条命令：

```sh
$ git merge-base --is-ancestor 4be6952 HEAD && echo "ancestor" || echo "NOT an ancestor"
NOT an ancestor of HEAD

$ git branch -a --contains 4be6952
（无输出 —— 没有任何本地或远程分支包含它）

$ git branch --show-current
task-mutation-integrate        # HEAD = 5cc8e40

$ grep -rn "gateIdsFromMessage" src/ scripts/ | wc -l
0                              # ★ 这个函数在本分支上【不存在】

$ grep -n "exec(message)" src/tools/shared/entities.ts
2934:  const match = /\[([\w][\w.-]*)\]/u.exec(message)   # ★ 单值 exec 仍在
```

⇒ **在本分支上，多 id 丢数据的缺陷仍然活着**，`gateIdsFromMessage` 不存在。
（`4be6952` 的提交说明与 diff 我都读过：它确实新增了 `gateIdsFromMessage` 并注明
「`noteStall(task, point, gateIdFromMessage(msg), now)`…要全量的调用点走 `gateIdsFromMessage`」——
**但那个提交没有合进本分支**。）

**对本契约的影响**：下方**契约二**按「`gateIdsFromMessage` 存在」与「不存在」**两种情形都写**，
并给出**判定命令**。★ 这样 A1/D1 无论基于哪种情形开工，契约都成立 ——
**不把「另一个任务会把它合进来」当前提**（那正是 t54 形态：依赖一个不在表里的前提）。

---

## 1. 共同数据源（两份契约的唯一源头）

`src/gates/registry.ts:143-149`：

```ts
export interface GateEvaluation {
  ok: boolean
  blockers: string[]
  unmeasured?: string
  ran: GateRunEntry[]        // ← :147 ★ 两份契约的共同源头
  outputs: Record<string, Record<string, unknown>>
}
```

`GateRunEntry`（`src/gates/registry.ts:119-141`）**唯一定义**：

```ts
export interface GateRunEntry {
  id: string
  verdict: 'ok' | 'blocked' | 'unmeasured' | 'skipped'
  count?: number
  produced?: boolean
  observed?: boolean
}
```

### 1.1 ★ `ran[]` 的每一格来自哪里（9 个 `ran.push` 站点，逐条回源）

**这是本契约最重要的表**：`GateRunEntry` 是**可选字段拼出来的**，
所以"某个字段在场"本身就是一条信息。下表由 `grep -n "ran.push" src/gates/registry.ts` 得到（**9 处**），逐条读源码归类：

| # | 行号 | 触发条件 | 产生的格子 |
|---|---|---|---|
| 1 | `:681` | `appliesTo` 为假 | `{ id, verdict:'skipped' }` |
| 2 | `:751` | 预算耗尽（`budgetStop`）**且**在观察名单 | `{ id, verdict:'unmeasured', observed:true }` |
| 3 | `:754` | 预算耗尽**且**不在观察名单 | `{ id, verdict:'unmeasured' }` |
| 4 | `:785` | 判据返回 `ok` | `{ id, verdict:'ok', produced:<bool> }` |
| 5 | `:793` | 判据返回 `blocked` **且**在观察名单 | `{ id, verdict:'blocked', count:<n>, observed:true }` |
| 6 | `:797` | 判据返回 `blocked` **且**不在观察名单 | `{ id, verdict:'blocked', count:<n> }` |
| 7 | `:803` | 判据返回 `unmeasured` **且** `observeOnly` | `{ id, verdict:'unmeasured', observed:true }` |
| 8 | `:826` | 判据返回 `unmeasured` **且** `unmeasuredDisposition==='tolerate'` | `{ id, verdict:'unmeasured', observed:true }` |
| 9 | `:830` | 判据返回 `unmeasured`（默认 `refuse`） | `{ id, verdict:'unmeasured' }` |

★ **两条从这张表读出来的、契约必须写死的事实**：

**(A) `count` 只在 `verdict==='blocked'` 时在场。**
`ok`（#4）用 `produced`、`skipped`（#1）两个都没有、`unmeasured`（#2/#3/#7/#8/#9）也没有。
⇒ **`count` 的缺席不是 0 条，是「这个 verdict 不度量条数」。**

**(B) ★★ `observed:true` 由【两种不同成因】产生，而它们在数据上同形 —— 契约必须分开。**
- **成因甲：观察模式**（#2 / #5 / #7）—— 「判据开火了，而裁决按**部署开关**被放过」
  （`AGENT_TEAMS_OBSERVE_GATES`，`registry.ts:454`；观察集是**运行时数据**，`registry.ts:473-476`）。
- **成因乙：判据自己声明容让**（#8）—— 「判据开了口说『我说不出』，而它**自己**声明这一档不拒」
  （`unmeasuredDisposition: 'tolerate'`，见 `registry.ts:69` 与 `:814-826` 的逐字注释）。

★ 源码 `registry.ts:814-826` **明说这两者复用 `observed` 是刻意的**：
> 「`observed.unmeasured` 是既有字段（观察模式用的那一个），它本来就承担"开火了但裁决没被采纳"的语义 ——
> 而这里的形状**恰好是**那件事…⇒ ★ 复用它是**对的**，不是将就」

⇒ **契约不改这个决定**（不改 `ran[]` 的形状），但**必须在文档层把两个成因分开写**，
因为两者的**补救动作不同**：成因甲要人去改部署开关或接受观察期；成因乙是**判据已明确表示不拒**，无需动作。
★ **若 A1 要让用户区分这两者，`ran[]` 现有字段不够** —— 见 §4 争议点 **X1**。

---

## 2. 契约一：「`ran[]` → `/state`」（A1 用）

### 2.1 现状基线（A1 不是"接出来"，是"新增"）

```sh
$ sed -n '743p' src/tools/status.ts
          ...runtimeRecord === undefined ? {} : { runtime_gates: runtimeRecord },

$ grep -rn "runtime_gates\|GateRunEntry\|\.ran\b" src/client/ --include=*.ts --include=*.tsx | wc -l
0                                    # ★ client 今天零判据字段

$ grep -rn "\.ran\b" src/ --include=*.ts | grep -v "registry.ts" | wc -l
0                                    # ★ ran[] 今天【零消费】（计划 F3 的读数，我复现）
```

⇒ `/state` 今天**只送** `runtime_gates` 一格（`status.ts:743`，经 `diagnosticFields`，`entities.ts:2596-2608`）。

★ `/state` 新增字段走**既有约定**：`diagnosticFields`（`entities.ts:2596`）的
`inputSurface` / `runtimeGates` / `dispatchInputSurface` / `completionInputSurface` 四格，
以及 `runtimeGatesSchema()`（`:2581-2595`）—— 它用 `{ type: 'json' as const }`，理由是
「那一格里的东西**不属于本文件**」（`tsdown`/TS 推断会冲突）。**A1 的新字段应沿用同一 spec**，
因为 `ran[]` 同样"不属于" `status.ts`。

### 2.2 字段表（逐字段：名 / 类型 / 来源 / 缺席语义）

| 字段 | 类型 | 来源（`registry.ts`） | 在场条件 | **缺席语义（写死）** |
|---|---|---|---|---|
| `id` | `string` | `:120` `id` | **恒在场** | ★ **缺席 = 数据损坏，不是"没有判据"**。契约要求：**不许用缺席表示任何事**（它是唯一的身份） |
| `verdict` | `'ok'｜'blocked'｜'unmeasured'｜'skipped'` | `:121` | **恒在场** | ★ 同上：缺席 = 损坏。**四值之外一律拒**（不得把未知值当 `ok`） |
| `count` | `number` | `:122` | **仅 `verdict==='blocked'`** | ★ **缺席 = 「该 verdict 不度量条数」，不是 `0`**。⇒ 读取端**不许** `count ?? 0` |
| `produced` | `boolean` | `:123` | **仅 `verdict==='ok'`** | ★ **缺席 ≠ `false`**。源码 `:785` 是 `produced: Object.keys(given).length > 0`，**恒写出一个布尔**；⇒ 在 `ok` 格上缺席即损坏。在**非 `ok`** 格上缺席是正常的（不是"没产出"） |
| `observed` | `boolean` | `:140` | **仅 `verdict∈{blocked,unmeasured}` 且被判为"开火但未采纳"** | ★★ **缺席 ≠ `false`**（本契约的核心条款，见 §2.3） |

### 2.3 ★★ 缺席语义：三条必须写死的规则

**规则 1：`observed` 的缺席不许冒充 `false`。**
源码 `:124-139` 逐字给出理由：
> 「只在「判据交出了 blocked / unmeasured，而它处在观察模式」时为 `true`。其余情形【缺席】——
> 尤其：`ok` 的判据在观察模式下**不产出这个字段**。」

⇒ 于是有三种状态，**必须三态不同形**：

| 状态 | 数据形态 | 读数 |
|---|---|---|
| 开火了、被放过 | `observed === true` | 画底纹（#4） |
| 跑了、**没有**被放过 | `verdict:'blocked'` 且 **`observed` 缺席** | 实心 `✗`（#2） |
| **这条判据根本没跑** | `verdict:'skipped'`（`observed` 也不在场） | `⊘`（#5） |

★ 若读取端写 `entry.observed ?? false`，**第一列与第二列合流**（都变成 `false`），
而源码 `:131-137` 逐字警告过这个读法：
> 「只读 `verdict` 的调用方会以为流程被拒了，只读 `ok` 的调用方会以为这条判据温和。」

⇒ **契约条款 C1**：`/state` 的 `observed` 字段**只允许**两种形态：**显式 `true`**，或**字段完全不出现在该格**。
**不许** `observed: false` 与缺席并存（那会让"没被放过"与"不适用"同形）。

**规则 2：`verdict:'skipped'` 与 `observed` 不同形（两者不许互推）。**
源码 `:135-139` 逐字：
> 「跳过是"判据根本没跑"（`appliesTo` 为假），这里是"跑了、开火了、被放过"。
> 两者在日志里都是"没有拦住流程"，但**成因与责任完全不同**。」

**规则 3：位置级与判据级不许合流。**
`observedBlockers` / `observedUnmeasured`（`registry.ts:221` / `:675`）是**位置级计数**，
与 `ran[]` 里的**判据级** `observed` 是两件事。源码 `:212-219` 明令三分不许合流。
⇒ **契约条款 C2**：`/state` 必须**同时**送两者，且**字段名不得互相冒充**
（位置级走聚合行的 `⚑k`，判据级走格子的底纹）。

### 2.4 ★ 第⑤类「观察判据明细」的覆盖要求（验收明确要求）

B 线的符号表（`REFACTOR-PLAN.md` §3-B-B0.1 的 #4）要求画出「开火了、但裁决被观察模式放过」的格子。
⇒ **A1 的出口必须让 client 拿得到画底纹所需的信息**，即：

1. **每格必须有 `observed`**（显式 `true` 或缺席，见 C1）；
2. **不许把 `observed` 折进 `verdict`** —— 源码 `:130` 逐字：「**不能只靠 `verdict` 表示**」；
3. ★ **A1 必须按「位置」分组送出**，因为 `ran[]` 是**位置级**的（`evaluate(point, ctx)` 一次调用的产物）：
   `ran` 里**只含该位置的判据**（`registry.ts:676-677` 的 `if (reg.point !== point) continue`）。
   ⇒ 六个插入点 = **最多 6 份 `ran[]`**，不是一个扁平数组。

★ **本条是 A1/D1 最容易撞车的地方**，见 §4 **X2**。

---

## 3. 契约二：「`ran[]` → 卡点记录」（D1/D2 用）

### 3.1 现状基线（逐条回源）

**落盘路径**：`src/tools/update-task.ts:1530-1534`（completion 位置）：

```ts
auto: {
  tool: 'agent_teams_update_task',
  point: 'completion',
  ...gateIdFromMessage(frictionMessage) === undefined ? {} : { gate: gateIdFromMessage(frictionMessage) as string },
},
```

**同形的还有三处**（`grep -n "gateIdFromMessage(frictionMessage)" src/ --include=*.ts`）：

| 位置 | 行号 | point |
|---|---|---|
| `src/tools/update-task.ts` | `:1533` | `completion` |
| `src/tools/shared/entities.ts` | `:3766` | （契约位置，`rejectOnContractGates`） |
| `src/tools/create-task.ts` | `:956` | `contract` |

**`FrictionAutoOrigin` 的形状**（`src/tools/shared/entities.ts:2914-2924`）：

```ts
export interface FrictionAutoOrigin {
  tool: string
  point: string
  gate?: string          // ★ 单值，可选
}
```

★ `gate` 的**缺席语义已写死在源码**（`:2919-2922`）：
> 「拒绝原文里的**判据 id**…读得出来时才写。读不出来 ⇒ 缺席（**不猜**：编一个 id 会让
> "这条是谁拒的"变成一条**假事实**）」

### 3.2 ★★ 为什么 `gate` 不能简单改成数组（实测依据）

```sh
$ sed -n '717,720p' src/types.ts
  const sameGate = previous !== undefined
    && previous.gate === gate
    && previous.point === point
  const count = sameGate ? (previous.count ?? 0) + 1 : priorCount + 1
```

`noteStall` 用 **`previous.gate === gate` 的标量相等**判「同一个 (task, gate) 又被拒了一次」（`src/types.ts:717-719`）。
调用点：`src/tools/update-task.ts:1494`
```ts
const stall = noteStall(task, 'completion', gateIdFromMessage(frictionMessage), Date.now())
```

⇒ **契约条款 C3**：`auto.gate` **保持单值 `string | undefined`，永不变数组**。
理由写死：改成数组会让 `previous.gate === gate` **恒为假**（数组与字符串、或两个数组引用不相等），
于是 `sameGate` 恒 `false` ⇒ **每一次拒绝都被算成"第一次"** ⇒ 卡点计数**永远差一拍**、永不触发。
★ 而源码 `:710-711` 已经明令这一态**不许并进**另两态：
> 「读不到 ⇒ **判不了**（第三态）。**不许并进另外两态**：并进 `first` 是把"读不到"说成"它没停"；
> 并进 `repeated` 是把**每一条**读不出 id 的拒绝都变成卡点（那 207 条就全回来了）。」

### 3.3 多 id 的落点：`gates[]` 与 `gate` 的共存语义

**判定命令（开工前先跑，决定走哪一支）**：

```sh
$ grep -rn "export function gateIdsFromMessage" src/ | wc -l
0    # ⇒ 支路 B（本分支现状）
1    # ⇒ 支路 A（4be6952 已合入）
```

| | **支路 A**：`gateIdsFromMessage` 已存在 | **支路 B**：**本分支现状**（该函数不存在） |
|---|---|---|
| `auto.gate` | 保持单值 = `gateIdFromMessage(msg)`（**首个** id） | 同左（不变） |
| `auto.gates` | **新增** `gates?: readonly string[]` = `gateIdsFromMessage(msg)`，**去重后全量** | ★ 需 D1 **自行实现**全量读取（同一条正则加 `g` 旗标 + 去重），**或**先并入 `4be6952` |
| 两者的关系 | ★ **写入时两条都写**；读取端**只许读一条**（见下） | 同左 |
| **权威源** | ★★ **`gates[]` 是权威**；`gate` 是**为 `noteStall` 保留的兼容标量** | 同左 |

★ **契约条款 C4（共存语义，写死）**：
1. **写**：两个字段都写（`gate` 恒为该批的**首个** id，与今天的语义逐字相同）。
2. **读**：
   - **`noteStall` 只读 `gate`**（标量相等，见 C3）；
   - **分诊/展示只读 `gates[]`**；
   - ★ **任何读取端不许"从 `gates[0]` 推 `gate`"或反之** —— 两者是**同一份数据的两个投影**，
     互推会让"投影不一致"这种损坏**静默消失**。
3. **缺席语义**：
   - `gate` 缺席 = **读不出任何 id**（与今天同义，`:2919-2922`）；
   - `gates` 缺席 = **同一个意思**（读不出任何 id），**不是"空数组"**。
     ★ 契约要求：`gates` **恒为 `string[]` 且长度 ≥1**（当它存在时）；
     **空数组一律禁止写出** —— 源码 `:2919-2922` 的"不猜"原则同样适用于它，
     而空数组会让"没读出来"与"读出来了但没有"同形。
4. **一致性**：若两者都在场，**必须 `gates[0] === gate`**。违反 = 写侧 bug（A1 的读侧应报 `unmeasured`，不是静默取一个）。

★ **支路 B 的处置（本分支）**：D1 若要拿全量 id，**两条路**：
- **(乙)** D1 在自己的 inScope 内实现 `gateIdsFromMessage`（一行正则 + `matchAll` + 去重），
  并**把"改 `gateIdFromMessage` 的单值语义"排除在外**（源码 `:3280` 记着
  「前缀里的判据 id 与正文里的**同一份**（`gateIdFromMessage` 只算一次）」——
  改它会让那条"只算一次"的假设失效）；
- **(甲)** 先把 `4be6952` 合入本分支。★ 但**这会把一个不在本任务表里的前提引进来** ——
  正是 t54 形态。⇒ **契约不选它**，只记录它存在。

### 3.4 契约二的字段表

| 字段 | 类型 | 来源 | 在场条件 | **缺席语义（写死）** |
|---|---|---|---|---|
| `tool` | `string` | 调用方常量（`'agent_teams_update_task'` 等） | 恒在场 | 缺席 = 损坏 |
| `point` | `string` | 调用方常量（`'completion'` / `'contract'` / …） | 恒在场 | 缺席 = 损坏。★ **不是从 `ran[]` 来** —— 它是**调用点**的知识（`evaluate` 的入参） |
| `gate` | `string` | `gateIdFromMessage(msg)`（`entities.ts:2933-2936`） | 读得出时 | ★ 缺席 = **读不出 id**（三态第三态），**不许当 `''` 或 `'unknown'`** |
| `gates` | `readonly string[]` | `gateIdsFromMessage(msg)`（**支路 A**）或 D1 自实现（**支路 B**） | 读得出时 | ★ 缺席 = 读不出；**空数组禁止写出**（见 C4.3） |

★ **注意 `point` 的来源**：它**不在 `ran[]` 里**。`GateRunEntry`（`:119-141`）**没有 point 字段** ——
因为 `ran[]` 是**一次 `evaluate(point, …)` 的产物**，point 是那次调用的**入参**（`registry.ts:646`）。
⇒ **契约条款 C5**：卡点记录要写 `point` 时，**只能取自调用点**，不许从 `ran[]` 反推。

---

## 4. ★ 两份契约的对齐（同一条 `ran[]`，两个出口）

### 4.1 字段使用矩阵

| `GateRunEntry` 字段 | → `/state`（A1） | → 卡点记录（D1/D2） | **若不同，为什么** |
|---|---|---|---|
| `id` | ★ **要**（每格的身份） | ★ **要**（`gate`/`gates` 的来源） | 同 |
| `verdict` | ★ **要**（画 `✓/✗/◌/⊘`） | ✗ **不要** | ★ **见 X3** —— 卡点记录记的是"**谁拒的**"，不是"它给了什么判决"；判决已在 `point` + 拒绝原文里 |
| `count` | ★ **要**（异常明细的条数） | ✗ 不要 | 卡点记录不按条数聚合（每次拒绝一条记录） |
| `produced` | ★ **要**（`ok` 格上区分"产出为空"） | ✗ 不要 | — |
| `observed` | ★★ **要，且必须显式**（C1） | ★ **要**（见 X1） | ★ 两边语义**可能不同** —— 见 X1 |

★ **两边的 `point` 不同源**：A1 从调用 `evaluate` 的地方拿（一个位置一份 `ran[]`）；
D1 从**调用点常量**拿（C5）。⇒ **两者必须一致**，否则同一件事在两处读起来不同名。

### 4.2 ★ 三个必须由 A1/D1 **开工前**商定的争议点

**X1 · `observed` 是否要进卡点记录？（契约给建议，不代替决定）**
- **不进**：卡点记录的职责是"某判据拒了"，而 `observed:true` 意味着**它没有真的拒**（裁决被放过）。
  ⇒ 记进去会让"拒了"与"没拒"在台账里同形 —— 违反 `registry.ts:212-219` 的三分纪律。
- **进**：`observed:true` 的判据**确实开火了**，而"开火了但流程没被拦住"正是**观察期最有价值的读数**。
- ★ **契约的推荐**：**不进 `gates[]`，但另立一格 `observed?: readonly string[]`**
  （与 `gates[]` 平级、语义正交）—— 这样"拒了"与"开火但被放过"**不同形**，
  且与 §1.1 观察到的**两个成因**（甲/乙）留给 D2 去分。
  ⇒ **本条是 X1，需 A1/D1 owner 一起拍**。

**X2 · `ran[]` 的**分组**由谁负责？（最容易撞车处）**
`ran[]` 是位置级的（§2.4）。⇒ 两种设计：
- **(i) 服务端分组**：`/state` 送 `{ completion: ran[], dispatch: ran[], … }`；
- **(ii) 扁平 + 带 point**：送一个扁平数组，每格加 `point`。
★ **契约建议 (i)**：因为 `GateRunEntry` **没有 point 字段**（§3.4 C5），
选 (ii) 就**必须给每格加 `point`** —— 那等于**改 `registry.ts` 的形状**，
而 `registry.ts` 是**上游不存在的新目录**、D 线之外的改动。
⇒ **(i) 不需要动 `registry.ts`**，代价是 `/state` 载荷多一层嵌套。
⇒ **本条是 X2，必须 A1/D1 一起拍**（这正是 t25 F1 说的"同一条通路"）。

**X3 · 卡点记录要不要 `verdict`？**
契约建议**不要**：`gates[]` 已经是"哪条判据"的答案；
而"它给了什么判决"在**卡点语境下**必然是"拒了"（否则不会有卡点）——
唯一的例外正是 X1 的 `observed`。⇒ 若要写 `verdict`，等于承认 X1 该进。

---

## 5. 与 N4（`friction` 字段扩展）的对齐点

计划 §2 的「共享资源」段逐字要求：
> **`N4`（`friction-triage` 的生产接口面）与 `D1`/`D2` 共同消费卡点语料** —— 三者都在读写 `friction` 台账的字段。
> ⇒ 任何一方要**扩展字段**，必须**在开工前**与另两方对齐。

**契约列出的对齐点（逐条可检查）**：

| # | 对齐点 | 为什么 |
|---|---|---|
| **N-a** | ★ `auto.gates[]` 是 **N4 要消费的新字段** ⇒ N4 的接口面必须先声明它 | 否则 N4 的读数**静默变空**，而"字段没了"与"卡点本来就没有"同形（计划 §2 逐字） |
| **N-b** | ★ `auto.observed[]`（若 X1 采纳）**同上** | 同 |
| **N-c** | ★ **`gate` 保持单值**这条约束**必须传给 N4** | N4 若把它当数组用会崩；且它的 `triage` 可能在别处依赖标量 |
| **N-d** | 字段**改名**是禁止的（只许**加**） | 改名会让已落盘的历史记录与新记录**不同形**，而台账**不可重算**（`recordFriction` 的注释逐字：「记录被污染之后**不可重算**」） |
| **N-e** | ★ 三方的**语料口径必须一致**：`FrictionAutoOrigin` 的 `gate` 缺席 = "读不出来"（三态第三态） | 与 §3.4 一致；N4 若把缺席读成"无判据"就是合流 |

★ **契约条款 C6**：上述五点在 A1/D1/D2/N4 **任何一个开工前**都要有一份共同的书面确认 ——
**本契约就是那份确认的草案**，但它**只覆盖 `ran[]` 侧**，N4 的字段面仍需 N4 自己补一次。

---

## 6. ★ 本契约自己的局限（明确留白）

1. **`4be6952` 未合入本分支** ⇒ 契约二在**支路 B** 下成立；支路 A 的字段语义我已按该提交的 diff 写出，
   但**没有实测**（该分支不在本工作区可 checkout 的范围）。
2. **`observed` 的两个成因（甲/乙）在数据上同形**，我**没有**设计出在不改 `registry.ts` 形状的前提下
   把它们分开的字段 —— 见 §4 X1。**契约不假装解决了它。**
3. **`/state` 的载荷大小未测**：`ran[]` 按位置送最多 6 份，每份最多 4 条（`completion`），
   ⇒ 上界 6×4 = 24 格，**但我没有实测真实 `/state` 响应体**。
4. **未跑 `pnpm typecheck` / 构建**：本契约是文档，无代码改动（`git diff --stat -- src/ scripts/` ⇒ 空）。
5. ★ **契约不是实现**：X1/X2/X3 三条**必须由 A1/D1 的 owner 拍板**，我只给建议与理由。

---

*本文件只写 `docs/READOUT-CONTRACTS.md`。未改动 `src/`、`scripts/`、`lib/` 任何文件。基线 HEAD `5cc8e40`。*
