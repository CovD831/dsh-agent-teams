# 资金化模块：整体架构与实现细节（2026-10-16）

> **回答用户两问**（在 (5) success/insight 确认者、(6) 晋升门槛 都按队长建议定的前提下）：
> 「它这整个资金化模块的**整体架构**是怎样的?**实现细节**又是什么?」
>
> ★ 本文**只写已经真实存在的**,不写设想 —— 每条都带「实测」的出处。

---

## 0. ★★★ 先看现状：已经【真实存在】的东西

```
src/evolution/                  ★ 4 个文件
  types.ts      形状 · EvolutionLoop(A|B) · LOOP_B_SUBJECTS · canLoopAAutoChange
  collect.ts    ★ 采集：observe() · appendSignal() · collectionDecisionOf()
  health.ts     ★ 读数：collectionHealthOf() · bucketsOf()
  history.ts    ★ 判据变更历史：reviewBeforeChange()

src/gates/collection/           ★ 4 条判据 + 共用形状
  dedupe.ts  cooldown.ts  attributable.ts  immunity.ts  shared.ts

.agent-teams/evolution/
  signals.jsonl   12 行（t88 补录）
  index.json      读数
```

**★ 而位置已接**：`INSERTION_POINTS` 7 个 · 判据 21 条 · **3 个生产调用点**
```
entities.ts:4136    ← 判据拒绝（点 A）
create-task.ts:616  ← 契约校验（点 C）
tools.ts:2124       ← 闸门拒绝（点 B）
```

---

## 1. ★★★ 整体架构：**一条主线 + 三个评估器 + 两个循环**

### 1.1 主线（信号的一生）

```
       ┌──────────────────────────────────────────────────────────────┐
       │  ① 采集       ② 该不该采      ③ 分流        ④ 生效     ⑤ 跑分 │
       └──────────────────────────────────────────────────────────────┘

  [生产路径的失败/成功]
        │
        │ ★ 3 个汇合点（宿主调用，别的模块不知道 evolution 存在）
        ▼
   observe(input)                        ← src/evolution/collect.ts:244
        │
        ├──► evaluateCollection(candidate, index)      ← ★ 调用方注入
        │        │
        │        └── registry.evaluate('collection', …)  ← ★ 4 条判据
        │              dedupe / cooldown / attributable / immunity
        │
        ├─ ok === false      ⇒ ★ 不采（但 index 计数 +1，不静默丢）
        ├─ ran 有 unmeasured ⇒ ★ 判不了，与"不采"不同形
        └─ 否则              ⇒ appendSignal() 写 signals.jsonl
                                   │
                                   ▼
                        collectionDecisionOf(evaluation)   ← 三态字段
```

### 1.2 ★★★ 三个评估器（**必须分开**）

| # | 评估器 | 问什么 | 落在哪 | 现状 |
|---|---|---|---|---|
| **①** | **该不该采** | 这条信号值得进库吗 | ★ `collection` 位置 4 条判据 | ✅ **已存在** |
| **②** | **该怎么分流** | 走软还是走硬 | ⬜ **不存在**（见 §3）| ⬜ |
| **③** | **改完好了没有** | 该 kind 的卡点降了吗 | ★ `verify` + `confidence.ts` | ⚠️ **地基在,零调用** |

★★ **合任何两个 ⇒「没采」「采了没用」「治了没好」三者合流** ——
**那正是本仓记账最久的形态。**

### 1.3 ★★★ 两个循环（**这是"评估器待在循环外"的落实**）

```ts
// src/evolution/types.ts:105 —— ★ 实测的原样
export const LOOP_B_SUBJECTS = Object.freeze([
  'collection-gates',      // ★ collection 的四条判据本身
  'verify-command',        // ★ 验证命令
  'confidence-threshold',  // ★ confidence 阈值
] as const)

canLoopAAutoChange(subject)   // ★ 对这三者返回 false
```

```
★ 循环 A（内层 · 可自动）:  改 prompt · profile · 阈值
★★ 循环 B（外层 · 只能提议）: collection 判据 · 验证命令 · confidence 阈值
   ⇒ ★★ 而 src/evolution/ 里【没有任何函数能改判据】——
      不是忘了写，是【刻意不提供】
      （一条只禁止调用的注释会腐烂，没有那个函数则不会）
```

### 1.4 ★ 不许侵入（四条规则）

```
A. 别人 → evolution：★ 只许 import src/evolution/index.ts
B. evolution → 别人：★ 只读。要影响别人 ⇒ 发信号给宿主
C. 采集点：★ 别的模块不许主动调用 —— 宿主在【既有汇合点】调用一次
D. ★★★ 裁决器（gates / 验证命令 / 阈值）【AI 只读】，且是【机械臂】钉住的
```

---

## 2. ★★ 存储：树形三层（**实测 7× 压缩**）

### 2.1 树形成立（实测）

| 层 | 唯一块数 | 体积 |
|---|---|---|
| **team 级字段** | ★ **12** | 9.0 KB |
| **member** | ★ **36** | 25.1 KB |
| **task** | **163** | 681.9 KB |

⇒ ★★ **层越往上唯一块越少 = 树。**

### 2.2 拼装可行（实测）

```
唯一块存储: 211 块 ·   716.0 KB
引用表    : 372 条 ·    30.7 KB     ← ★ 引用极便宜
总计      :            746.7 KB
原始 ctx  :           4920 KB
⇒ ★★ 压缩比 7×
```

### 2.3 目标形状

```
signals.jsonl                     一行一条，只含【引用】+ 缺陷本身
states/team/<hash>.json              12 个唯一块
states/member/<hash>.json            36 个
states/task/<hash>.json             163 个
index.json                         ★ 派生，删了能重建
```

★★ **而"减少 10 倍"不靠【删上下文】,靠【一次存、多处引用】** ——
**可复现性一字不损**（与「软归档不硬删」同一纪律）。

### 2.4 ★ 裁剪按【实际读到的部分】

> 用户原话：「先按树存全,等用一阵子,再按**实际用到的部分**裁剪。」

★ **落实方式:每次拼装记一行"读了哪几层"** ⇒ 那是裁剪的**可复跑依据**,不是现在猜。

---

## 3. ★★★ (5) success / insight：**三类信号三种强度**（这是要请用户定的）

### 3.1 为什么不能一视同仁

| 类型 | 性质 | ⇒ 采集强度 |
|---|---|---|
| **rejection** | ★ **事实**（闸门拒绝了就是拒绝了）| ★ **自动采** |
| **success** | ★★ **判断** | ★★ **自动采候选 + 显式确认才升级为"模式"** |
| **insight** | ★★★ **提炼** | ★★★ **只由人/AI 显式提交** |

### 3.2 ★★★ 而"成功候选"的形状（必须带可复跑读数）

```ts
export interface SuccessCandidate {
  readonly what: string            // 做了什么（一句话）
  readonly readings: readonly {    // ★★★ 可复跑的证据
    readonly command: string
    readonly exitCode?: number
    readonly evidence: string
  }[]
  readonly avoided?: string              // ★ 它【避免了】哪条 rejection
  readonly reusedBy?: readonly string[]  // ★★ 被复用了多少次
}
```

★★ **因为"没报错"不等于"做对了"** ——
**若循环对"没报错"优化,它会产出"什么都不做"**（specification gaming）。

### 3.3 ★★★ (6) 晋升门槛：**低 + 只作提示**

**依据（MemOS 源码实测）:**
> 「`minEpisodesForInduction` 在源码里**已被下调到 1**,
>  注释**反复记录「真实使用中阈值永不触发」**。」

⇒ ★★ **所以"有价值"的判据不是精确阈值,而是两个【可数的量】:**
```
① 复用了多少次（reusedBy.length）        ⇒ ★ 那是"有价值"的【唯一可测代理】
② confidence.ts 的双计数                ⇒ ★ "被找到"与"被采纳"【是两个数】
   tallyRecall（找到）· tallyAdopt（采纳）
   confidence = (upvoted + k/2) / (recalled + k)
```

★ **而"门槛"的角色:`提示`,不是`开关`**（memex 逐字:
「阈值不该是执行开关,该是提示开关」）。

### 3.4 ★ 而 §3.1 的三个确认者选项（用户要定的）

| | 谁确认 | 代价 |
|---|---|---|
| **(甲)** | 队长（任务结束时顺手标）| ★ 成本低,可能流于形式 |
| **(乙)** | 独立 reviewer（像判据那样）| ★ 更准,要成本 |
| **(丙)** | ★ **不确认,只靠"复用次数"筛** | ★ 无人值守,会有噪声 |

★ **我建议 (丙) + 一个低门槛提示** —— 因为:
```
★ 现在【有真样本】了（t88 的 e-0009 就是 success）
★ 而"复用了多少次"是【可数的】,不需要一个人来判
★★ 而噪声的代价小:它只让一条建议多出现一次（提示,不是开关）
```

---

## 4. ★★ 实现细节（已存在的那部分）

### 4.1 `observe()` 的契约（`collect.ts:197-250`）

```ts
export interface ObserveInput {
  readonly stateRoot: string | undefined
  /** ★ 采集前先问 collection 四条 —— 由【调用方注入】，不在这里 import */
  readonly evaluateCollection?: (context: {
    readonly candidate: { kind, component?, message, source?, at }
    readonly index: { seen: ReadonlySet<string>
                      lastBySource: ReadonlyMap<string, number>
                      counts: ReadonlyMap<string, number> }
  }) => Promise<{ ok: boolean; unmeasured?: string; ran: readonly {id, verdict}[] }>
  /** ★ 从【既有】台账读；步骤 1 允许是空索引 */
  readonly index?: { ... }
}
```

★★ **两条设计要点（实测的注释）:**
```
· stateRoot【由调用方给】，不许用进程级单值（与 recordFriction 同一条纪律）
· evaluateCollection【注入】而不是 import ⇒ ★ 依赖方向单向
  （collect.ts 只 import node:fs / node:path，从不 import gates）
```

### 4.2 三态字段 `collection`

```
true       ⇒ 采了
false      ⇒ 被 collection 拒了
undefined  ⇒ ★ 判不了（仍然写盘！）
```
★★ **理由（t87 加的,队长认可）:**
> 「没有它,**"采了"与"被采集拒了"在记录里同形** —— 而那正是这一步存在的理由。」
> 「`undefined` **仍然写** —— 否则"采集器坏了"会表现成"台账悄悄是空的",
>  而那与"确实没有信号"无法区分。」

### 4.3 四条判据（都是纯函数级）

| id | 判什么 | 缺输入时 |
|---|---|---|
| `collection.dedupe` | 同一 `(kind, component, message)` 在窗口内已存在 | ★ `unmeasured` |
| `collection.cooldown` | 同一来源 N 分钟内 | ★ `unmeasured` |
| `collection.attributable` | 能否落到一个 component | ★ `unmeasured` |
| `collection.immunity` | 已知噪声源（如 worktree 路径差异） | ★ `unmeasured` |

★★ **缺输入一律 `unmeasured`（不是 `ok`）** —— 否则缺索引时**去重会静默失效**。

### 4.4 读数（`health.ts`）

```ts
export function collectionHealthOf(records, refused = {}): CollectionHealth
// ⇒ { buckets, redundancy, coverage, refused }

redundancy = 唯一 (component, 单个 kind) 对数 / 总记录数
★ 实测口径:54/372 = 0.145161（补录前）· 71/382 = 0.185864（补录后）
★★ 与 buckets.length【刻意不是同一个数】:
   带多个 kind 的记录在桶里算 1、在对里算 N
   （实测本仓:桶 38、对 54，差 16，来自 18 条多 kind 记录）
```

### 4.5 判据变更历史（`history.ts`）

```ts
record({ gateId, at, before, after, evidence })   // ★ 四格缺一即抛
// ★ 不提供 delete / update / clear（追加语义，刻意）
reviewBeforeChange(...)   // ★ 要求先拿到【全部】history 才给 verdict
```

**依据（SkillClaw `history/` + Raven Step 3 逐字）:**
> 「**Before deciding any action on an existing skill, read ALL files under history/.
>  This is mandatory, not optional.** Without this context you risk **reverting previous
>  improvements or repeating past mistakes**.」

★ **而它是结构性的**:`history.ts` **不被 `health.ts` import**、也不接受记录集
⇒ ★ **「history 参与计算」这份形状下【写不出来】。**

---

## 5. ⬜ 还不存在的（如实列出）

| # | 缺什么 | 依赖 |
|---|---|---|
| **①** | ★ **分流**（soft/hard/unmeasured 的判定与落地）| 无 —— **可以开始** |
| **②** | ★ **循环 A 的提议机制** | ①②已落地 ⇒ **可以开始** |
| **③** | ★ **晋升**（L2 profile → L1 代码）| 要 ② 先有 |
| **④** | **树形存储**（现在的 `signals.jsonl` 还是平铺的）| 无 |
| **⑤** | ★ **索引落盘**（现在 `index.json` 是 t88 手工写的,不是派生）| ④ 之后 |
| **⑥** | **`success` / `insight` 的入口** | ★ **等 (5) 定** |
| **⑦** | **UI 投影**（提示词模块）| ① 之后 |

---

## 6. ★★★ 所以整体架构一句话

```
生产路径的失败/成功
  ⇒ 【采集】宿主在 3 个既有汇合点调 observe()
  ⇒ 【该不该采】collection 4 条判据（三态）
  ⇒ 【存】树形引用 + 按需拼装（7× 压缩）
  ⇒ 【分流】soft（改 prompt）/ hard（加判据）/ unmeasured
  ⇒ 【生效】L2 profile 覆盖（可改、不必 build）
  ⇒ 【跑分】确定性验证器（test:gates / verify:fast）+ 该 kind 的卡点是否下降
  ⇒ 【晋升】跑分通过 ⇒ 从 L2 升到 L1

★ 而两个循环把它围住：
  循环 A 能自动改 prompt / profile / 阈值
  循环 B（collection 判据 / 验证命令 / 阈值）★ 只能提议
```

★ **而它与记忆项目的根本差别（决定了它【可以快】）:**
```
记忆项目:  信号是【偏好/语义】⇒ 需要 LLM 合并 ⇒ ★ 必须慢（且反复合并会变差）
我们:      信号是【确定性报错】⇒ 没有 LLM 合并 ⇒ ★ 越快越好，只要能验证
```

---

## 7. ★ 请你定（就两条,定完可以连续开工）

| # | 问题 | 我的建议 |
|---|---|---|
| **(5)** | success/insight 确认者 | ★ **(丙) 只靠复用次数筛 + 低门槛提示** |
| **(6)** | 晋升门槛 | ★ **低 + 只作提示**（MemOS:「阈值永不触发」）|

★ **而 (5) 若选 (丙),`success` 条目的形状按 §3.2**（带 `readings` + `reusedBy`）——
**而那是可实现的,因为 `confidence.ts` 的双计数已经在盘上。**

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
