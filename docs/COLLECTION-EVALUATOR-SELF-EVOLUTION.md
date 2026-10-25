# `collection` 评估器的自进化（2026-10-16）

> **用户裁定**
> 「可以,那就加。**这个评估器本身也应该有一套自进化的机制**。
>  比如它**采集什么**,或者**怎么去做判断**,这些都是需要能后续做优化的」

★ 而这句话有一个**必须解决的矛盾**（见 §3）—— 它是本设计里最需要说清的一处。

---

## 1. ★★★ 先看一个数据:它证明这个闸门**现在就该存在**

**现有 372 条的分类分布（我实测）:**

```
唯一 (component):            35
唯一 (component, kind) 对:   54

★ 前 5 个桶占 92%:
   161 条 (43.3%)   dispatch   · unwired
   157 条 (42.2%)   completion · unwired
    19 条 ( 5.1%)   contract   · unwired
     2 条 ( 0.5%)   contract.verify-command · misclassified
     2 条 ( 0.5%)   admission.convene        · misclassified
⇒ ★★ 前两条就占 85.5%
```

★ **而看时间跨度（更能说明问题）:**
```
dispatch · unwired     161 条 · 2026-10-07 → 2026-10-14
completion · unwired   156 条 · 2026-10-07 → 2026-10-10
contract · unwired      19 条 · 2026-10-07 → 2026-10-14
```

⇒ ★★★ **同一个 `unwired` 在 `dispatch` 位置上重复了 161 次,持续 8 天,
而【没有任何机制发现这件事】。**

★★ **所以 `collection` 这个闸门要防的第一件事,不是"采错的",而是"采重复的"** ——
**而 AutoLibra 的 `redundancy` 正是那个读数。**

---

## 2. ★★★ 而"评估器本身自进化"是什么意思

**用户原话拆成两半:**
```
① 它**采集什么**        ⇒ ★ 判据集本身该能增删改
② 它**怎么去做判断**     ⇒ ★ 判据的阈值/逻辑该能改
```

### 而本仓的判据体系**已经是那个形状**（这是关键）

```
· 注册式    ⇒ 改一行即加/删一条判据（写错【启动即炸】）
· 三态      ⇒ ok / blocked / unmeasured
· 可插拔    ⇒ id + description 由注册表读，UI 不硬编码
· 观察模式  ⇒ ★ 一条判据可以"进了但只记不拦"（observe）
```

⇒ ★★★ **所以"评估器自进化"不需要新机制** ——
**它 = 让判据集本身成为可被自进化循环修改的对象。**

---

## 3. ★★★ 而这里的矛盾必须解决:**不能让自己改自己的判据**

**如果 `collection` 的判据可以被自进化循环修改,那么:**
```
循环发现"我被 collection.dedupe 拦住了"
  ⇒ ★ 它可以去【放宽那条判据】
  ⇒ ★★ 接下来所有重复都会被采
  ⇒ ★★★ 而那正是"reward tampering / 策略利用判据省略掉的东西"
```

**那份 rubric 调研逐字警告过:**
> 「whether the **policy exploits what they omit**」

**而 STOP 给了唯一正确的解法（我实测过它的源码结构）:**
```
tasks/maxcut/utility.py         ← 给被进化的程序看的
tasks/maxcut/secret_utility.py  ← ★ 真正裁决，被进化对象【看不到、改不到】
```

### ★★★ 所以分成两个循环,而不是一个

```
★ 循环 A（内层 · 可自动）:
   改 prompt · 改 profile · 改判据的【阈值】· 改采集的【范围】
   ⇒ ★ 而那些都受循环 B 的裁决

★★ 循环 B（外层 · 只能人改）:
   collection 的四条判据本身 · 验证命令 · confidence 阈值
   ⇒ ★★ 只能【提议】，不能自改
```

★ **而它与"评估器待在循环外"是同一条规则,只是应用在元层。**

---

## 4. ★★ 那么"评估器的自进化"具体怎么做

### 4.1 ★ 它自己产生读数（这是"自进化"的燃料）

```ts
/** ★★ 采集层的自我读数 —— 它是"该不该改判据"的唯一依据 */
export interface CollectionHealth {
  /** 每个 (component, kind) 桶的计数与时间跨度 */
  readonly buckets: readonly {
    readonly component: string
    readonly kind: readonly string[]
    readonly count: number
    readonly firstAt: number
    readonly lastAt: number
  }[]
  /** ★★ AutoLibra 的 redundancy：唯一桶数 / 总记录数 */
  readonly redundancy: number
  /** ★ AutoLibra 的 coverage：有多少 (component, kind) 组合【没被任何判据区分】*/
  readonly coverage: number
  /** ★ 被 collection 判据拒掉的条数（按判据 id 分组）*/
  readonly refused: Readonly<Record<string, number>>
}
```

⇒ ★★★ **而 `redundancy` 那个数就是"该不该改判据"的信号:**
```
★ 实测现在: 54 / 372 ≈ 0.145   （唯一桶只占 14.5%）
⇒ ★ 那意味着 85.5% 的记录是"已见过的桶"
⇒ ★★ 那本身就是一个"该优化采集范围"的读数，而不是一句感觉
```

### 4.2 ★★★ 而"自进化"的第一个动作是**它自己发现的**,不需要人

**依据 §1 那个数据 —— 一个**可机械判定**的信号:**
```
if redundancy 低于某阈值（例如唯一桶 < 30%）
   ⇒ ★ 提议："采集范围过宽，或分类过粗"
```

★ **而这正好是你要的"少打扰":**
```
★ 有确定性读数 ⇒ 它自己提议（甚至自己改【内层】）
★ 无确定性读数 ⇒ 才问人
```

### 4.3 ★★ 而判据的**变更本身**要有历史（否则会反复来回改）

**照 SkillClaw 的 `history/` 与 Raven 的"读全部历史再决定":**
> 「SkillClaw: `skills/<name>/history/{v1.md, v1_evidence.md, v2.md, ...}`
>  Raven Step 3: **Before deciding any action on an existing skill,
>  read ALL files under history/. This is mandatory, not optional.**
>  Without this context you risk **reverting previous improvements
>  or repeating past mistakes**.」
> 「Explicitly answer: What changed in each prior version?
>  What evidence justified that change? Did later sessions suggest the change
>  helped, hurt, or remain ambiguous?」

⇒ ★★★ **所以 `collection` 的判据要有一个 `history`:
每次改判据,记下【改前 / 改后 / 证据 / 后来的读数】。**

★★ **而那防的正是"反复来回改"** —— 一种在自进化系统里很常见的退化。

---

## 5. ★★★ 落地:三层,而顺序不能颠倒

| # | 做什么 | 谁改 | 依据 |
|---|---|---|---|
| **1** | 加 `collection` 位置 + 四条判据（初版）| ★ **人** | 本设计 |
| **2** | ★ **加 CollectionHealth 读数**（redundancy / coverage / refused）| ★ **人** | AutoLibra |
| **3** | ★★ **加判据 history**（改一次记一条）| ★ **人** | SkillClaw · Raven |
| **4** | ★ 让循环 A 能【提议】改 collection 判据 | 循环 A | ★ 需 1-3 就位 |
| **5** | ⚠️ 让循环 A 能【自己】改 collection 判据 | —— | ★★ **不建议**（见 §3）|

★ **而 (1)(2)(3) 必须先做** ——
**因为 (4) 的"提议"需要 (2) 的读数,而"不被反复改"需要 (3) 的历史。**

---

## 6. ★★ 三条反向半边（写进任何实现契约）

**A**：★ **`redundancy` 必须能算出"前 N 个桶占多少"** ——
实测口径:现在前 5 桶占 92%,若它算出别的数 ⇒ 口径错

**B**：★★ **循环 A 不许修改 `collection` 的判据** ——
用一个机械臂钉住（与 §D 同族:evolution 不许 import gates 的写路径）

**C**：★ **判据 history 改一次记一条** ——
删掉 history 后重跑,`redundancy` 的算法结果**不变**（history 是记录,不参与计算）

---

## 7. ★ 待你拍板

| # | 问题 | 我的建议 |
|---|---|---|
| **10** | 循环 A 能否**自己**改 collection 判据? | ★★ **不能** —— 只能提议（§3 的 STOP 解法）|
| **11** | 先做 (1)(2)(3) 吗? | ★ **是** —— (4) 依赖它们 |
| **12** | redundancy 的告警阈值 | ★ **不设精确值**（MemOS 教训:阈值永不触发）⇒ 只作【提示】|

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
