# 评估器体系：判据 · 分流 · 收益（2026-10-16）

> **用户两问 + 一个更大的洞察**
> ① 「"该不该采"是拿什么判的?」
> ② 「走软还是硬?你说还没做,那你觉得我们应该怎么去做这个评估?」
> ③ 「如果改完后没有这么一个评估器的话,它其实不光是在做自进化上,
>    **在做任何项目的时候,都需要有一个评估去衡量收益**。」
> ④ ★★ 「这个评估器应该和我们以前做的**变异测试、回测**之类的,
>    都可以算是**评估器的一部分**,它们相当于是**比较机械地**去做一些改动的评判。」

★★★ **④ 是本文真正的主题** —— 因为用户把它**从自进化里抽出来了**,
而抽出来之后,它与 `mutation` / `backtest` 是**同一个东西**（见 §0）。

---

## 0. ★★★ 用户那个洞察,在源码里是**成立的**

### 实测:变异测试与回测,与判据是**同一个形状**

```ts
// src/gates/completion/mutation.ts:138
export interface MutationContext {
  loadKindRequirements?: () => KindRequirementsLoad   // ★ 判据【自己读数据】
  task?: { id, kind, verify, changedPaths }
  changedPaths?: string[]
  // ...
}
// src/gates/completion/backtest.ts:230
export interface BacktestContext {
  loadKindRequirements?: () => KindRequirementsLoad   // ★ 同一个注入格
  task?: { id, kind, inScope }
  changedPaths?: string[]
  baselineTestResults?: ...    // ★ 缺席 ⇒ unmeasured（"没测到"不是"通过"）
}
```

⇒ ★★★ **所以 `completion.mutation` 与 `completion.backtest`【就是判据】——
它们与 `contract.verify-command` 住在同一个注册表、走同一个 `evaluate()`、给同一种三态。**

★★ **而用户说它们"比较机械地做改动的评判"—— 那正是它们的定义:**
```
· 机械 = 【无 LLM 参与】⇒ 结果可复跑、可复现、无随机性
· 评判 = 【给改动一个三态裁决】ok / blocked / unmeasured
```

⇒ ★★★ **所以本仓已有的 21 条判据,就是用户说的"机械评估器"的 21 个实例。**
**而缺的不是"再做一套评估器",是【把它们的读数组织成一个能回答"收益"的东西】。**

---

## 1. ★★ 判据（"机械评估器"）的**共同形状**（实测归纳）

```ts
{
  id: string                    // 'completion.mutation'
  point: InsertionPoint         // 挂在哪一刻
  description: string           // ★ 给人读的一句话
  appliesTo?: (ctx) => boolean  // ★ 何时适用（★ 21 条全都有）
  gate: (ctx) => GateVerdict    // ★ 三态：ok / blocked / unmeasured
}
```

### ★★★ 三条贯穿全部 21 条的纪律

| # | 纪律 | 为什么 |
|---|---|---|
| **1** | **三态,不是两态** | ★「没能测量」**不许**并进「测出来了」 |
| **2** | **缺输入 ⇒ `unmeasured`** | 否则「缺索引 ⇒ 去重静默失效」这类形态 |
| **3** | **每条都声明 `appliesTo`** | ★ 否则落进「对全部 kind 生效」的静默路径 |

★★ **而这三条正是"评估器"与"一句断言"的区别** ——
**一句断言只有真/假;而评估器要能说"我判不了"。**

---

## 2. ★★★ (1) "该不该采"拿什么判 —— **四条,全是纯谓词**

| # | 判据 | 判什么 | 缺输入 |
|---|---|---|---|
| **1** | `collection.dedupe` | 同一 `(kind, component, message)` 在窗口内已存在? | `unmeasured` |
| **2** | `collection.cooldown` | 同一来源在 N 分钟内刚说过话? | `unmeasured` |
| **3** | `collection.attributable` | 这条**能否落到一个 component**? | `unmeasured` |
| **4** | `collection.immunity` | 是不是**已知噪声源**（如 worktree 路径差异）? | `unmeasured` |

### ★★ 而它们的**判据来源**是 AutoLibra 的两个元指标

**`Open-Social-World/autolibra`（ICLR 2026）逐字:**
> 「**`coverage` and `redundancy` meta-metrics** then measure how well
>  the induced metric set **covers unseen human feedback**.」

⇒ ★★ **映射:**
```
redundancy  ⇒ ★ 与既有同义 ⇒ collection.dedupe / cooldown
coverage    ⇒ ★ 覆盖不到新东西 ⇒ collection.attributable
```

### ★★★ 而"该不该采"的**读数**（不是判据,是它的体温）

```ts
collectionHealthOf(records) ⇒ {
  buckets,          // 每个 (component, kind) 的计数与时间跨度
  redundancy,       // ★ 唯一 (component, 单 kind) 对数 / 总记录数
  coverage,
  refused,          // ★ 按判据 id 分组的拒绝数
}
```

**实测（本会话）:**
```
补录前: 372 条 / 54 对  ⇒ redundancy 0.145161
补录后: 382 条 / 71 对  ⇒ redundancy 0.185864
★ 而 384 条台账里,dispatch·unwired 一个桶【161 条、持续 8 天】而无人发现
```

⇒ ★★★ **那些数就是"该不该采"的收益读数** —— 而**此前没有任何东西在看它们。**

---

## 3. ★★★ (2) "走软还是硬" —— **我建议这么做**

### 3.1 ★ 判据是一个**纯谓词**,而它是可机械判的

```
① 这个缺陷【能否被机械判定】？
   能 ⇒ ★ hard（加一条判据 —— 而判据本身就是机械判定）
   不能 ⇒ soft（改 prompt / profile）
② ★ unmeasured 是第三个答案：两者都不合适（例如"这需要产品决策"）⇒ 不硬塞
```

★ **为什么 `unmeasured` 必须存在**:本仓记账最久的形态 ——
**「没能判断」与「判断为不必改」在报告里同形。**

### 3.2 ★★★ 而"能否机械判定"的判据,可以用**已有的 21 条**来量

**这是我认为最关键的实现思路:**

```
拿这条缺陷问：★ 它【像不像】已注册的某条判据能抓的形态？
  像 ⇒ hard（说明这类缺陷【已被证明可机械判定】，只是那条判据的射程没覆盖到它）
  不像 ⇒ soft

★ 而"像不像"是【可算的】,不用 LLM:
   · 它的 point 落在哪？（contract/dispatch/completion/…）
   · 它的 kind 是哪一类？（unwired / misclassified / …）
   · 该位置【已有】判据的 description 与它是否同一个语义面？
```

⇒ ★★ **所以"分流"的第一版不需要模型,只需要一个映射表 + 人工确认。**
★★ **而那正是"数据回填 → 再让决策模型做路由"的顺序**（用户自己的说法）。

### 3.3 ★ 而 MemOS 给了两条我建议照搬的守卫

**`memos-local-plugin/core/feedback/ALGORITHMS.md` 逐字:**
> 「**6.1 Cooldown** —— `isOnCooldown` … 若最新的那条比 `cooldownMs` 更年轻,**就跳过**」
> 「**6.2 Value-delta guard** … 我们**只在非请求路径**（failure-burst）执行它。
>  当用户明说"这是错的"时,我们**当成 ground truth 并绕过阈值** —— 用户替我们分类了。」

⇒ ★★★ **映射到我们:**
```
★ 人/队长【明说】这条该走硬 ⇒ 直接采纳（人已经分类了，不过阈值）
★ 系统【自己发现】的模式   ⇒ 必须过 δ 守卫（防噪声写成一次分流）
```

### 3.4 ★★ 分流的落点（三层，照 EverOS 的 PromptSlot）

```
L1 代码里的默认（★ 只有人能改）      ← 晋升需 verified
L2 profile 覆盖（cordis.patch.yml）  ← ★ 改它不动代码、不必 build、不影响稳定版
L3 单次覆盖
```

⇒ ★★ **"验证过才生效"落在 L2 → L1 的晋升上:**
```
① 改动先落 L2 ⇒ ★ 立即可用
② 观察该 kind 的卡点是否下降（★ 可复跑的读数）
③ 下降 ⇒ 晋升 L1
```

---

## 4. ★★★ (3)(4) 用户那个洞察的落法："衡量收益"是一个**独立的评估层次**

### 4.1 ★★ 而它已经有了地基,只是零调用

```
src/confidence.ts 已实现:
  tallyRecall / tallyAdopt        ← ★ 双计数（recalled=找到, upvoted=采纳）
  confidenceOf = (upvoted + k/2) / (recalled + k)
  PROMOTE_THRESHOLD = 0.90 · ARCHIVE_THRESHOLD = 0.15
  readFlywheel() ⇒ promote | observe | archive | unmeasured
★ 而它被 entities.ts:3399 用了一次（写进 readSedimentFlywheel）
★★ 而 readSedimentFlywheel 【零调用方】
```

⇒ ★★★ **所以"衡量收益"的两条腿都缺:没东西喂它,也没东西读它。**

### 4.2 ★★ 而"收益"有**三种可算的形态**（这是本节的实质）

| # | 收益是什么 | 怎么算 | 现状 |
|---|---|---|---|
| **①** | ★ **该 kind 的卡点下降了没有** | 同一 `(component, kind)` 桶在改动【之后】的计数是否下降 | ⬜ **可算,没做** |
| **②** | ★★ **改动被采纳了多少** | `tallyAdopt` / `tallyRecall`（★ 已实现）| ⚠️ 零调用 |
| **③** | ★ **验证器是否变强** | 判据数 / 覆盖的 kind 数 / mutation 的检出率 | ✅ 部分（21 条）|

★★ **而 ① 是最直接的那个** —— 因为它**用同一批数据**:
```
改动前: dispatch·unwired 有 161 条（2026-10-07 → 10-14）
改动后: 若下一个窗口降到 ~0 ⇒ ★ 那是一个【可数的收益】
       若仍是 161 ⇒ ★ 说明改动【没生效】—— 而那与"没改过"同形（除非有这个读数）
```

### 4.3 ★★★ 于是"评估器体系"是**四层**,而它们各回答一个问题

```
① 该不该采       ⇒ collection 位置 4 条判据          ✅ 已存在
② 该怎么分流     ⇒ 映射表 + 人工确认（第一版）        ⬜ 待做
③ 改完跑分       ⇒ ★ 已有的 21 条判据 + 确定性验证器   ✅ 大部分已在
④ 收益衡量       ⇒ ★ 该 kind 的卡点是否下降 + 双计数   ⚠️ 地基在,零调用
```

★★★ **而 ③ 与 ④ 的区别正是用户那句"衡量收益"的要点:**
```
③ 回答「这次改动【合规】吗」  ⇒ 判据（机械、单次）
④ 回答「这次改动【有收益】吗」⇒ ★ 需要【前后两个窗口】的比较
⇒ ★★ 单次判据【结构上】回答不了 ④——它只看当下,不看趋势
```

---

## 5. ★★ 实现细节：把"收益"做成可读的

### 5.1 ★ 一个"窗口比较"的形状

```ts
export interface EffectReading {
  readonly component: string
  readonly kind: readonly string[]
  /** ★ 改动【之前】那个窗口 */
  readonly before: { readonly from: number; readonly to: number; readonly count: number }
  /** ★ 改动【之后】那个窗口 */
  readonly after:  { readonly from: number; readonly to: number; readonly count: number }
  /** ★★★ 三态：'improved' | 'unchanged' | 'unmeasured' */
  readonly verdict: 'improved' | 'unchanged' | 'unmeasured'
  /** ★ 为什么判不了（例如【之前的窗口里没有这条】⇒ 无从比较）*/
  readonly why?: string
}
```

★★ **`unmeasured` 必须存在**:若改动前那个桶**本来就没有记录**,就**无从说它下降了** ——
而「无从比较」与「没有下降」**在报告里同形**。

### 5.2 ★★ 而它与 `confidence.ts` 的关系

```
★ 两者是【不同轴】的:
  confidence  ⇒ 一条【沉淀】的信誉（被找到 vs 被采纳）
  EffectReading ⇒ 一次【改动】的收益（前窗 vs 后窗）
⇒ ★★ 不许把两者混成一个指标 —— 那正是本仓记账的形态
```

### 5.3 ★ 而"机械评估器"该有的一条元读数

```
★ 判据自身是否有效？—— 三条:
  ① 它【真的跑了】吗（evaluated > 0，不是 skipped）
  ② 它【开过火】吗（blocked > 0 过）
  ③ ★★ 它开火后【改了什么】吗（对应 kind 的卡点下降了吗）
⇒ ★★★ 而 ③ 是本仓【完全没有】的读数 —— 而它正是"收益"
```

★ **而 ③ 一旦有,那 346/384 条 `unwired` 就有了它的对偶:**
```
unwired  ⇒ ★ 装了但调不到（判据从不跑）
★ 而 ③ 能抓 ⇒ 跑了但【没起作用】（判据跑了，而缺陷照样来）
⇒ ★★ 那是本仓记账里【缺失的一整个类别】
```

---

## 6. ★★★ 结论：用户那个洞察的准确形式

```
★ 用户说：「变异测试、回测,都可以算是评估器的一部分,
          它们相当于是比较机械地去做一些改动的评判。」

★★ 而源码证实:它们【就是判据】—— 同一个注册表、同一个三态、同一个 evaluate()。
⇒ ★★ 所以本仓已有 21 个"机械评估器",而缺的是【组织它们的那一层】:
   · 该不该采    ✅ 4 条
   · 该怎么分流  ⬜ 映射表
   · 改完跑分    ✅ 21 条
   · ★ 收益衡量  ⚠️ 地基在,零调用 —— 而那正是用户说的"衡量收益"
```

★ **而"收益"的关键性质是【它需要前后两个窗口】—— 单次判据结构上回答不了它。
那是本仓【完全缺失】的一层,而不是"再写几条判据"。**

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
