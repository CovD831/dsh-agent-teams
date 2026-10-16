# 三模块的输入/输出定义（2026-10-16）

> **用户裁定（逐字）**
> 「改名是肯定要改的,我们的一些**细节其实都还没有调查清楚**。比如之前我们已经做了一些
>  判断标准,什么东西要采集,采集之后怎么做处理,那**产出的结论是不是也需要规定好**呢?
>  其实很多东西都需要做**细致的规划**。
>
>  1. **采集模块**:定义输入就是要采集什么,输出就是**产出什么结论**、怎么改之类的。
>     **目前我们的输出还没定义。**
>
>  2. **实施模块**:**我觉得不一定一定要有这个实施模块。**
>     因为我们**这个插件本身就是一个任务的实施**,它可以走我们**本身的 Agent Team 派发任务**之类的。
>
>  3. **评估器模块**:需要给它的**输入定义好**,也就是明确它需要**监督一些什么**。
>     或者说,不管是**平常改项目时发出的提案契约**,还是**我们产出的结论**,
>     可能都要**统一好一种形式**。这样的话,评估器的输入部分就比较好定义了,
>     **直接复用我们已有的约定就好了**。
>     评估器的**输出**,可能就是一些**打分和一个置信度**。
>     你可以参考 **jev** 这种模型,它其实就是会**输出概率和置信度**。」

---

## 0. ★★★ 三条裁定,而其中一条**砍掉一个模块**

### ① 采集模块的**输出还没定义** —— ✅ 用户对,实测如此

```
src/evolution/ 的六个导出里：
  CollectionDecision（三态）  ← ★ 那只是"采不采",不是"怎么改"
❌ 没有 RoutingDecision（该走软还是硬 + 以什么形态改）
❌ 没有"结论"这个产出物本身
```

**⇒ 本规格 §1 把它定义出来。**

### ② ★★★ **实施模块可以不存在** —— 用户对,而且这一条省掉一整个模块

> 「因为我们**这个插件本身就是一个任务的实施**,它可以走我们**本身的 Agent Team 派发任务**。」

★ **实测本仓已有:**
```
create_task（含质量契约 objective/acceptance/verify/inScope）
reassign_task · edit_plan · review 闭环（repair + 再审）
acceptanceResults / commandsRun   ← ★ 交付时填回
```

⇒ ★★★ **所以"实施"不是新模块,而是【把结论变成一条任务契约,交给已有的派发】。**
```
★ 结论（自净化产出）
   ⇒ ★ 转成一条 create_task 的契约
   ⇒ ★ 走已有的派发 / 审查 / repair 闭环
   ⇒ ★ 而"审查通过"就是它的验收
```

★★ **而那正好复用用户第 ③ 点说的"统一形式"** —— 两件事是同一件。

### ③ ★★★ 评估器的输入 = **已有的契约形式** —— 用户对

> 「不管是平常改项目时发出的**提案契约**,还是**我们产出的结论**,
>  可能都要**统一好一种形式**……**直接复用我们已有的约定就好了**。」

★ **实测本仓的契约字段（那是现成的统一形式）:**
```
kind? · objective? · inScope?[] · outOfScope?[] · acceptance?[] · verify?[]
deliverables?[] · nonGoals?[] · coverageOf?[]
★ 而交付时填回：changedPaths?[] · acceptanceResults?[] · commandsRun?[]
```

⇒ ★★★ **所以"结论"不该发明新形状,而该是【契约形状的一个子集 + 一个 target】。**

---

## 1. ★★★ 采集模块：输入 / 输出

### 1.1 输入（**两个方面**）

```ts
/** ★ 采集的输入 —— 已经实现（observe 的 ObserveInput） */
export interface CollectionInput {
  /** ★ 信号本身 */
  readonly candidate: {
    readonly kind: readonly string[]      // unwired / misclassified / …
    readonly component?: string
    readonly message: string              // ★ 原文，不改写
    readonly source?: string
    readonly at: number
  }
  /** ★ 已有的索引（从【既有】台账读） */
  readonly index: {
    readonly seen: ReadonlySet<string>
    readonly lastBySource: ReadonlyMap<string, number>
    readonly counts: ReadonlyMap<string, number>
  }
  /** ★ 由调用方注入（不在这里 import） */
  readonly evaluateCollection?: (...) => Promise<...>
  readonly stateRoot: string | undefined
}
```

### 1.2 ★★ 输出（**用户说"还没定义"—— 这里定义**）

**三层,而每层回答一个问题:**

```ts
/** ── 第 1 层：采不采 ── ★ 已实现 */
export type CollectionDecision = boolean | undefined
//   true=采 · false=拒 · ★ undefined=判不了（仍写盘）

/** ── 第 2 层：★★★ 该怎么改 ── 待实现（本规格定义） */
export interface RoutingDecision {
  /** ★★★ 是否需要修改 */
  readonly needChange: boolean
  /** ★★★ 以什么形态改 —— 三态 */
  readonly modality:
    | 'hard'        // 加/改一条判据（机械可判）
    | 'soft'        // 改 prompt / profile（不可机械判）
    | 'contract'    // ★ 变成一条任务契约（需要人/agent 实施）
    | 'none'        // 判定为不必改
    | 'unmeasured'  // ★★ 判不了（例如"这需要产品决策"）
  /** ★★ 理由必须可核 —— 不是随手填的 */
  readonly why: string
  /** 以什么形态改：落到哪个对象 */
  readonly target?: {
    readonly kind: 'gate' | 'prompt' | 'profile' | 'threshold'
    readonly ref: string        // 判据 id / profile 键 / 阈值名
  }
  /** ★★★ 收益的【靶】：哪个 (component, kind) 桶该下降 */
  readonly effect?: {
    readonly component: string
    readonly kind: readonly string[]
  }
}
```

★★★ **而 `effect` 是与评估器的**接口** —— 见 §3。
★ **没有它,收益就只能靠感觉**（而那是用户第 ③ 点要解决的事）。

### 1.3 ★ 而"结论"的**成品形状** = 契约子集 + routing

```ts
/** ★★★ 采集模块的【最终产出】—— 一份"提案" */
export interface Proposal {
  readonly id: string
  readonly at: number
  /** ★★ 复用契约的形式（用户第 ③ 点）—— 不许发明第二套 */
  readonly contract: {
    readonly objective: string           // ★ 要改什么（一句话，可核）
    readonly acceptance: readonly string[] // ★★ 怎么算改好了（可读真假）
    readonly verify?: readonly string[]    // ★ 机械判据（若能给）
    readonly inScope?: readonly string[]
  }
  /** ★★★ 以什么形态改 */
  readonly routing: RoutingDecision
  /** ★ 来源：哪条信号触发的（回溯用） */
  readonly from: readonly string[]       // signal ids
}
```

★★ **而它【直接可以喂给 `create_task`】** —— 那正是用户第 ② 点的落法。

---

## 2. ★★★ 实施：**不存在这个模块**（用户裁定）

```
★ 结论（Proposal）
   ⇒ 转成 create_task 的契约
   ⇒ 走已有派发 · 审查 · repair 闭环
   ⇒ acceptanceResults / commandsRun 填回
⇒ ★★ 所以"实施"= 已有的 Agent Team 机制，不是新代码
```

★ **而它带来的好处（不只是省代码）:**
```
· ★ 实施走【已有的审查闭环】⇒ 它天然受 review 约束
· ★ 它的产出【天然有】changedPaths / acceptanceResults / commandsRun
  ⇒ ★★ 那正是评估器要的输入（见 §3）
· ★ 循环 B 的边界【自动成立】:派发的任务改不了 collection 判据
  （除非那条任务自己那样写，而那会被闸门按 outOfScope 拦下）
```

---

## 3. ★★★ 评估器：输入 / 输出

### 3.1 输入 = **已有的契约 + 交付读数**（用户裁定）

```ts
/** ★★★ 评估器监督的对象 —— 一律是【契约形状】 */
export interface EvaluatedSubject {
  readonly id: string                    // 任务 id 或提案 id
  readonly at: number

  /** ★ 复用契约的形式（不发明第二套） */
  readonly contract: {
    readonly kind?: TaskKind
    readonly objective?: string
    readonly acceptance?: readonly string[]
    readonly verify?: readonly string[]
    readonly inScope?: readonly string[]
    readonly outOfScope?: readonly string[]
    readonly nonGoals?: readonly string[]
  }
  /** ★★ 交付后的读数（实施完才有） */
  readonly delivered?: {
    readonly changedPaths?: readonly string[]
    readonly acceptanceResults?: readonly AcceptanceResult[]
    readonly commandsRun?: readonly CommandRunResult[]
  }
  /** ★★★ 收益的【靶】—— 来自 Proposal.routing.effect，或开发改动自己声明 */
  readonly effect?: {
    readonly component: string
    readonly kind: readonly string[]
  }
}
```

⇒ ★★★ **所以评估器【不关心】subject 是"自净化的提案"还是"一次普通开发改动"** ——
**两者都是同一个形状,所以它天然通用（用户 2b）。**

### 3.2 ★★★ 输出 = **打分 + 置信度**（用户裁定，参考 jev）

**而本仓【已有】那个形状 —— 在 `confidence.ts` 里:**
```ts
export interface FlywheelReading {
  readonly verdict: FlywheelVerdict       // ★ promote / observe / archive / unmeasured
  readonly confidence: number | undefined // ★★ undefined ⇒ 判不了（不是 0）
  readonly reasons: readonly string[]     // ★ 逐条机械理由
  readonly conditions: {...}              // ★★ 四条件逐条读数
}
```

⇒ ★★ **那就是"打分 + 置信度"的现成实现**（`confidence = (upvoted + k/2)/(recalled + k)`）。

**评估器的输出形状（按它扩展）:**
```ts
export interface EvaluationReading {
  readonly subjectId: string
  /** ★★★ 综合判定 —— 三态（unmeasured 必须存在） */
  readonly verdict: 'effective' | 'ineffective' | 'unmeasured'
  /** ★★ 打分 0..1；undefined ⇒ 判不了（★ 不是 0） */
  readonly score: number | undefined
  /** ★★ 置信度 0..1；undefined ⇒ 样本不足（★ 不是 0） */
  readonly confidence: number | undefined
  /** ★ 逐条机械理由（哪几条过、哪几条没过） */
  readonly reasons: readonly string[]
  /** ★★ 逐条读数（缺哪条一眼可见，而不是只给个 false） */
  readonly readings: readonly {
    readonly name: string        // 'acceptance' / 'verify' / 'effect' / 'coverage'
    readonly value: string | number | undefined
    readonly ok: boolean | undefined   // ★ undefined ⇒ 这一条判不了
  }[]
}
```

### 3.3 ★★★ 而"打分"由**三个可算的来源**合成

| # | 来源 | 怎么算 | 现状 |
|---|---|---|---|
| **①** | **验收** | `acceptanceResults[]` 里 passed/total | ✅ 数据已有 |
| **②** | **机械验证** | `commandsRun[]` 的 exitCode | ✅ 数据已有 |
| **③** | ★★ **收益** | 靶桶的**前后窗口**比较 | ⚠️ **地基在,零调用** |
| **④** | **置信度** | ★ 样本量（`confidenceOf` 的双计数）| ⚠️ 已实现,零调用 |

⇒ ★★★ **③ 与 ④ 是评估器的核心,而它们【都已实现或已定义】。**

### 3.4 ★★ 而"置信度"为什么必须与"打分"分开

```
打分      ⇒ 「它有多好」（0..1）
置信度    ⇒ ★ 「这个打分有多可信」（0..1）
⇒ ★★ 两者【不同轴】:
   一条改动可能【打分很高而置信度极低】（一次就成功，但没有样本）
   也可能【打分一般而置信度很高】（十次里八次成功）
★ 合一个 ⇒「样本不足的完美」与「样本充足的平庸」同形
```

★ **而那正是用户"参考 jev"那句的要点:jev 输出**概率**与**置信度**,是两个数。

---

## 4. ★★ 统一形式：**本仓已有的那套语汇**（不发明第二套）

| 层 | 三态 | 出处 |
|---|---|---|
| 判据 | `ok` / `blocked` / `unmeasured` | `src/gates/registry.ts` |
| 飞轮 | `promote` / `observe` / `archive` / `unmeasured` | `src/confidence.ts` |
| 采集 | `true` / `false` / **`undefined`** | `src/evolution/collect.ts` |
| ★ **分流** | `hard` / `soft` / `contract` / `none` / **`unmeasured`** | ⬜ 待实现 |
| ★ **收益** | `improved` / `unchanged` / **`unmeasured`** | ⬜ 待实现 |
| ★ **评估** | `effective` / `ineffective` / **`unmeasured`** | ⬜ 待实现 |

★★★ **而贯穿全部的一条规律:每一层都有 `unmeasured`,且它【不是】"低分"或"否"。**
**那是本仓记账最久的形态的解药。**

---

## 5. ★ 落地顺序（①②③ 互不依赖 ⇒ 可并行）

| # | 做什么 | 模块 | 依赖 |
|---|---|---|---|
| **①** | ★ **改命名 + 划界**（`evolution` → 采集与处理）| 采集 | 无 |
| **②** | ★★ **`Proposal` + `RoutingDecision`**（采集的输出）| 采集 | 无 |
| **③** | ★★★ **`EvaluatedSubject` + `EvaluationReading`** | 评估器 | 无 |
| **④** | ★ **结论 → 契约的桥**（`Proposal` → `create_task` 参数）| 采集→实施 | ② |
| **⑤** | ★★ **收益读数**（`EffectReading`：前后窗口）| 评估器 | ③ |
| **⑥** | **晋升闸**（`effective` 才准 L2 → L1）| 评估器 | ⑤ |

★ **而 ④ 是用户第 ② 点的落法:一个转换函数,不是新模块。**

---

## 6. ★ 而"细致规划"还差什么（如实列出）

```
✅ 已定义：采集的输入（CollectionInput）· 采不采（三态）
⬜ 刚定义：采集的输出（Proposal / RoutingDecision）
⬜ 刚定义：评估器的输入（EvaluatedSubject）· 输出（EvaluationReading）
❌ 未定义：★ 分流的【映射表】—— "能否机械判定"具体怎么算
❌ 未定义：★ 靶的【选取规则】—— 一条改动该盯哪个桶
❌ 未定义：★ "effective" 的【阈值】—— 下降多少算 improved
❌ 未定义：★ 窗口【多长】—— 改动前后各看几天
```

⇒ ★★ **前四项是本规格定义的;后四项是【需要调研的】—— 而它们正是"细致规划"的剩余部分。**

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
