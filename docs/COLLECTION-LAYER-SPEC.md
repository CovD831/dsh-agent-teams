# 采集层规格 —— 在哪采 · 什么形式 · 存哪里（2026-10-16）

> **用户的问题（逐字）**
> 「采集层其实一方面做的是**采集**,另一方面是**存储**,对吧?
>  也就是它**在哪里采集**,**以什么形式存储**,以及**存储在哪里**。」

★ 而我先量了一个数,它改变了这三问的**优先级**（见 §0）。

---

## 0. ★★★ 先看一个测量结果:现在的卡点库,**86% 是噪声**

```
.agent-teams/frictions/  ⇒  384 条,12.9 MB（磁盘 14 M）
  平均每条 35 KB

★ 而"缺陷本身"（title/observed/expected/index/resolution/notes）:
  合计 1.1 MB ⇒ ★★ 只占 13.8%
  ⇒ 平均每条有效载荷 3 KB，而实际存了 35 KB
```

**多出来的 10 倍是什么:**
```
scene.ctx   4.96 MB（38%）  ⇒ ★ 整份 team 状态快照（含全部 members + tasks + 依赖图）
context     1.84 MB（14%）
observed    0.81 MB（6%）
```

★ 而**去重只省 2%**（337 份快照里 331 份都不同）——
⇒ ★★ **不是重复,是"每条都存了一份不同的完整状态"。**

★★★ **所以本规格的第一结论:存储方案的关键不是"存哪里",而是"采什么"。**
**现在采了 10 倍于需要的东西。**

---

## 1. ★ 在哪采（三个汇合点,不是 13 个模块）

### 原则（用户硬约束:模块不许互相侵入）

```
❌ 侵入:  在 src/gates/contract/task-atomicity.ts 里 import evolution
✅ 不侵入: 宿主在【已有的】汇合点调用一次 observe()
```

### 三个汇合点

| 汇合点 | 位置 | 覆盖什么 | 状态 |
|---|---|---|---|
| **A** `recordFriction()` | `entities.ts:3805` | ★ **所有判据拒绝** | ✅ **已在** |
| **B** 工具拒绝抛出点 | `tools.ts`（`transitionError` 一带）| ★ **闸门拒绝** | ★ 新增一行 |
| **C** 契约校验 | `quality-gates.ts:843` `validateCreateTask` | ★ **契约类** | ★ 新增一行 |

★ **而 `src/gates/**` 一个字不改。**

### ★★ 外加两个**没有汇合点**的采集需求（用户原话的三类）

```
① rejection  ⇒ ✅ 上面三个汇合点覆盖
② success    ⇒ ❌ 【没有汇合点】—— 现在无处可采
③ insight    ⇒ ❌ 【没有汇合点】—— 现在无处可采
```

**用户原话:**
> 「不管是**报错**,还是主会话发任务时**子代理觉得不合理**;
>  或者子代理做出了一些**比较好的处理办法**,主会话觉得在什么方面**处理得很好、很有价值**」

⇒ ★★ **② 与 ③ 是【人/AI 主动标记】的,不是自动触发的。**

**所以它们各自需要一个显式入口:**
```
② success  ⇒ ★ 一个工具调用（人有意的）+ 一个自动信号（任务 completed 且无 rejection）
③ insight  ⇒ ★ 一个工具调用（人有意的）
```

★ **而"自动信号"那条要小心** —— 见 §5 的失败模式:
**" успех 不报"会让循环只看到失败,于是它优化出来的东西会趋向"什么都不做"。**

---

## 2. ★★★ 什么形式（这是本规格的核心）

### 依据:GEPA 那句 + Raven 那条

**GEPA（hermes-self-evolution ★5512）逐字:**
> 「GEPA reads execution traces to understand **WHY** things fail
>  (**not just that** they failed)」

**Raven（★5470）§4 逐字:**
> 「Analyst 会把"**装上的机制本轮实际做了什么**"一并交给 Curator:
>  哪条审核放行了几次、打回了几次、理由是什么,哪个工具调用失败了。
>  Curator 据此**核对自己上一轮的修订是否起效**,而不是只看它的计划。」

⇒ ★★★ **所以记录必须带"机制活动"（which mechanism did what）** ——
**而本仓恰好有那个数据:判据的 `ran[]`（逐条裁决）+ `commandsRun`。**

### 建议的形状

```ts
export interface EvolutionSignal {
  readonly id: string                    // e-0001（单调,与 f- 同族）
  readonly at: number

  /** ★ 三类（用户原话） */
  readonly kind: 'rejection' | 'success' | 'insight'

  /** ★ 确定性来源 —— 谁拒的 / 哪条判据 / 哪个工具 */
  readonly source: {
    readonly where: string               // 'create_task' | 'update_task' | 'validateCreateTask'
    readonly gateId?: string             // 'contract.task-atomicity'（可空）
    readonly tool?: string               // 工具名（可空）
  }

  /** ★ 原文，不改写 */
  readonly message: string

  /** ★★★ 机制活动：装上的机制本轮实际做了什么（Raven §4）
   *   —— 数据来自判据的 ran[]，不是重算 */
  readonly mechanisms?: readonly {
    readonly gateId: string
    readonly verdict: string             // ok | blocked | skipped | unmeasured
    readonly count?: number
  }[]

  /** ★ 场景：只存【标识】，不存快照（那是 38% 噪声的来源） */
  readonly scene?: {
    readonly team?: string
    readonly task?: string
    readonly attempt?: number
  }

  /** ★★ 引用而非内嵌：状态快照按【内容哈希】单独存（见 §3） */
  readonly stateRef?: string             // 'sha1:abc123...'

  /** ★ 分类（复用既有 9 类，不发明第二套） */
  readonly index?: { readonly component?: string; readonly kind?: readonly string[] }

  /** ★★ 分流（用户要的那一格） */
  readonly routing?: {
    readonly decision: 'soft' | 'hard' | 'unmeasured'
    readonly why: string
    readonly target?: string
    readonly effect?: string
  }
}
```

### ★★★ 三条硬约束（都来自实测的教训）

| # | 约束 | 为什么 |
|---|---|---|
| **1** | ★ **`scene` 只存标识,不存快照** | 现在 `scene.ctx` 占 38%（4.96 MB / 384 条）|
| **2** | ★★ **状态快照按内容哈希【单独】存,记录只引用** | 331/337 份不同 ⇒ **引用能省 4.96 MB 里的绝大部分** |
| **3** | ★ **`mechanisms` 不重算,直接抄判据的 `ran[]`** | 重算会引入第二个口径 ⇒ 两处漂移（本仓记账过）|

★ **而 (3) 特别重要** —— 因为在观察点重算判据**会与当时的裁决不同**,
于是"记录说 X,当时实际是 Y" ⇒ **两个口径,一个事实。**

---

## 3. ★ 存哪里

### 现状与问题

```
.agent-teams/frictions/*.json   ⇒ 一条一文件，12.9 MB
```

★ **一条一文件的问题**（不是错,但有代价）:
```
· 384 个 inode
· 每次都是整文件读写（35 KB）
· 而 38% 是同一个 team 的不同快照
```

### 建议:三层,按"变化频率"分

```
① 信号流（append-only）
   .agent-teams/evolution/signals.jsonl
   ★ 一行一条,只含 §2 的形状（无快照）
   ★★ 平均 3 KB ⇒ 384 条只需 ~1.1 MB（而现在 12.9 MB）

② 状态快照（content-addressed，去重）
   .agent-teams/evolution/states/<sha1>.json
   ★ 记录里只放 stateRef
   ★★ 同一 team 的多次记录 ⇒ 同一份快照只存一次

③ 索引（派生，可重建）
   .agent-teams/evolution/index.json
   ★ kind 分布 / routing 分布 / 各 component 的计数
   ★★ ★ 它是【派生】的 ⇒ 删了能重建 ⇒ 坏不了
```

### ★★ 为什么 signals 用 **jsonl** 而不是一条一文件

| | 一条一文件（现状）| ★ jsonl |
|---|---|---|
| append | 建新文件 | ★ **一行** |
| 全量读 | 384 次 open | ★ **一次** |
| 并发写 | 需要锁 | ★ **append 是原子的**（本仓 mailbox 已这么做）|
| 部分损坏 | 坏一条 | ⚠️ 坏一行 —— ★ **但有 id,可跳过** |

★ **而本仓【已有先例】**:`inbox/*.jsonl`（mailbox）就是这么做的。

⇒ ★★ **所以不是新发明 —— 是复用本仓既有的存储约定。**

### ★★★ 而"存哪里"有一个必须回答的:**与既有 frictions 的关系**

```
选项 ① 迁移:把 384 条转换成新格式（含拆出快照）
选项 ② 并存:新的走 evolution/，旧的 frictions/ 冻结不动
选项 ③ 复用:直接扩展现有的 frictions/ 形状
```

★ **我建议 ②（并存,旧的冻结）**,理由:
```
· 那 384 条是【历史】，它们的形状有它自己的读者（frictions.html / verify:frictions）
· ★ 迁移会让"历史"与"新格式"混在一起，而两者口径不同
· ★★ 而"旧的冻结"是可验证的:它的 count 不再增长
```

★ **而这也符合本仓的纪律:先并存,确认新的能用,再决定迁移。**

---

## 4. ★★ 用户提的决策模型（jev / laya）—— 我查了

**实测:**
```
★ jev-router 在 ~/.dsh/dsh-tauri-ui/model-presets.json 的能力表里
   ⇒ [1, 1, 1000000, 0]
       是否推理=1 · 是否工具=1 · 上下文=1M · 最大输出=0
★ 而 laya 没在配置里找到
★ 而 wb provider 的 cordis.patch.yml 里没配它们（只有 hy4-preview / deepseek / glm / kimi）
```

### ★★ 而用户对它的定位,我认为**判据是精确的**

**用户原话:**
> 「这种决策模型主打**快速决策**。我觉得它的使用场景,应该是
>  **能自动产生特别大标签,或者能做数据回填的地方**,
>  它的作用就是做一个**快速判断或路由**。」

★★ **而"路由"正是本设计的 `route` 那一格:**
```
soft | hard | unmeasured  ⇒ ★ 一个【三分类】决策
★ 而它的输入是【结构化的】:kind(9 类) + component + source.where + message
★ 而它的输出是【结构化的】:routing + target
```

⇒ ★★★ **所以它是一个理想的"小模型"任务 —— 而它需要的数据正是采集层要采的。**

### ★ 但我建议**现在不接**,理由有二

| # | 理由 |
|---|---|
| **1** | ★ **本仓的 model 路由是冻结的**（t84 刚证明:`provider/model` 冻进 session descriptor,改了不传播）⇒ 接一个模型不是"改一行配置" |
| **2** | ★★ **分类器要【先有标签数据】才能训/评** —— 而现在 384 条里**没有一条带 routing 标签**（我实测过）|

⇒ ★★ **所以正确顺序是:先采（含人工 routing）⇒ 积累标签 ⇒ 再让决策模型做路由。**

★ **而那正好也是"数据回填"的场景**（用户原话）:
**先用手工/大模型标一批,再用它回填决策模型。**

### ★ 而 `maxTokens = 0` 那条我标出来

```
jev-router 的 [1,1,1000000,0] ⇒ 最大输出 = 0
```
⚠️ **那可能是能力表缺数据,也可能真的不能输出** ——
★ **接入前必须实测一次**,否则"路由"会返回空。

---

## 5. ★★ 采集层必须自带的三个防护（来自失败模式研究）

| # | 防护 | 依据 |
|---|---|---|
| **1** | ★★ **不只在失败时采,也要在成功时采** | 否则循环只看得到失败 ⇒ **优化出"什么都不做"**（classic specification gaming）|
| **2** | ★ **采"机制活动",不只采"结果"** | Raven §4:让 Curator 能"核对自己上一轮的修订是否起效" |
| **3** | ★★ **采集有【冷却】+ 去重** | MemOS 的 `cooldownMs`;同一 (kind, component, message) 在冷却期内只记一次 |

★ **而 (1) 我认为最容易被忽略,也最危险** ——
**因为"成功"现在【完全没有汇合点】,它需要显式设计。**

---

## 6. ★ 落地顺序（每步可验证）

| # | 做什么 | 验证读数 |
|---|---|---|
| **1** | ★ **只加采集,不改存储**（`observe` + 三汇合点）| 本会话那 7 次**进得了库** |
| **2** | ★ **加 `kind`（rejection/success/insight）** | 三类**都有**样本 |
| **3** | ★★ **`scene` 只存标识 + 快照走 stateRef** | ★ **单条体积从 35 KB 降到 ~3 KB** |
| **4** | ★ **jsonl + content-addressed 快照** | 全量读一次 vs 384 次 |
| **5** | **索引（派生）** | 删了能重建 |

★ **而每一步的反向半边:**
```
1. 一条判据拒绝仍被记录（现状不许退化）
2. 一条闸门拒绝现在【也】被记录（新增）
3. ★ 快照能按 stateRef 取回（不丢事实）
4. ★ jsonl 部分损坏时，坏行可跳过、好行仍可读
5. ★ 索引删掉后能从 signals 重建出相同结果
```

---

## 7. ★★ 待你拍板

| # | 问题 | 我的建议 |
|---|---|---|
| **1** | 存储:与既有 `frictions/` **并存**（旧的冻结）,还是迁移? | ★ **并存** —— 历史口径不同 |
| **2** | `signals` 用 **jsonl**? | ★ **是** —— 复用本仓 mailbox 的先例 |
| **3** | 决策模型（jev）现在接? | ★ **不接** —— 先积累带标签的数据（用户自己的"数据回填"顺序）|
| **4** | 成功信号怎么采? | ★ **需要一个显式入口**（工具调用 + 自动信号）—— §5 的第 1 条防护 |

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
