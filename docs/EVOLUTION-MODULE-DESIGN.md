# 自进化模块（资金化）设计 v1 —— 2026-10-16

> **用户裁定（逐字）**
> 「这个**资金化**模块主要包含:1. **信息采集层** 2. **信息处理**。
>  ……把**完整的自进化模块**设计一下。」
> 「我们的自迭代是**基于明显的报错**,或者是有价值的**信息采集**过来的。
>  所以,我们的迭代应该是**比较快**的,而不是像他们那种**定时的慢迭代**。」
> 「其实**大部分情况**,这还是我们项目一个"**少打扰**"的问题,
>  **大部分东西都可以自己做判断**。」
> 「我**不允许模块之间互相侵入**。所以,**需要暴露给其他模块使用的功能,
>  都必须做一个接口接出来**,供其他模块调用。」

---

## 0. ★★★ 先说一条**战略结论**（它决定了整个设计）

**记忆项目与我们的自进化,在"信号性质"上根本不同:**

| | 记忆项目（EverOS / MemOS） | ★ **我们** |
|---|---|---|
| **信号** | 用户的**偏好 / 语义**（需要 LLM 合并）| ★ **确定性的报错**（闸门拒绝 / 判据 blockers / exit code）|
| **因此** | ★ **必须慢** —— 偏好要累积才看得出 | ★ **可以快** —— 信号本身是确定的 |
| **有损吗** | ★ **是** —— EverOS 逐字:「repeatedly re-consolidating makes it **worse**」| ★ **否** —— 中间**没有 LLM 合并语义** |
| **周期** | 每周一次（且警告"别频繁跑"）| ★ **越快越好,只要能验证** |

★ **而 MemOS 自己也分了两层（逐字）:**
> 「**Tool feedback** — every tool call succeeds or fails … **Deterministic, no LLM required**.
>  **User feedback** — free-text messages … which we need to **classify** before they can act」

⇒ ★★★ **所以我们的路径 = 它的"Tool feedback"那一层,不需要 LLM 分类。**
**而 EverOS 的"别频繁跑"警告【不适用于我们】—— 那条警告的前提是 LLM 有损合并。**

### ★★ 于是"快"的判据不是"时间",而是**验证**

```
有确定性验证 ⇒ ★ 立刻生效，不问人（用户的"少打扰"）
无验证        ⇒ 才提议（★ 而那是少数）
```

---

## 1. ★★★ 模块边界（用户硬约束：不许互相侵入）

### 现状：`src/` 的真实模块

```
capabilities.ts   插件挂载 + prompt section
client/           前端（投影层）
confidence.ts     ★ 飞轮的核心算法（纯函数，零副作用）
events.ts         事件类型
gates/            17 条判据 + 注册表
mutation/         变异测试
quality-gates/    契约校验
scheduler.ts      派发调度
snapshot.ts       状态投影（→ /state → client）
state/            ★ 持久化 + 类型
tools/            工具实现
worktree.ts       worktree 隔离
```

### ★★ 自进化模块该住在哪

```
★ 新建 src/evolution/          ← ★ 一个【新模块】，不是散落在各处
    ├── index.ts               ★ 唯一对外出口（barrel）
    ├── types.ts               信号 / 记录 / 裁决的形状
    ├── collect.ts             ① 采集层的**接口实现**
    ├── classify.ts            ② 分类（复用既有 taxonomy）
    ├── route.ts               ③ ★ 分流：soft | hard | unmeasured
    ├── propose.ts             ④ 提议生成
    ├── verify.ts              ⑤ ★ 验证闸（决定能否自动生效）
    └── promote.ts             ⑥ 晋升（数据 → 配置）
```

### ★★★ 而"不许侵入"的落实方式（这是本设计的核心）

**三个方向都要有明确规则:**

| 方向 | 规则 |
|---|---|
| **① 别人 → 进化模块** | ★ **只通过 `src/evolution/index.ts`**（barrel）。**不许** `import '../evolution/collect.ts'` 这种深入路径 |
| **② 进化模块 → 别人** | ★ **只读**。它**不修改**其他模块的状态；要影响别人,走 **`emit` 一条信号**给宿主（见 §3）|
| **③ 采集点嵌入** | ★★★ **其他模块不许【主动调用】采集** —— 否则就是侵入。**改为:宿主在【既有的失败路径】上调用一次 `evolution.observe(...)`**（一个调用点,一个接口）|

⇒ ★★ **即:不是"13 个采集点散布在各模块里",而是**
```
各模块【已有】的失败/成功路径
  ⇒ 宿主（index.ts / tools.ts）在那些路径上已有一处统一出口
  ⇒ ★ 在那个出口上挂一个 observe() 调用
```

★ **而本仓恰好【已经有】那个统一出口** —— 见 §3。

---

## 2. ★★★ 采集什么（`observe` 的输入形状）

### 依据：本仓**已有**的失败/成功出口

| 出口 | 在哪 | 现在的去向 |
|---|---|---|
| ★ **判据拒绝** | `recordFriction({point, message, ...})` ×3 | ✅ **写盘**（`.agent-teams/frictions/`，384 条）|
| ★★ **闸门拒绝** | `validateCreateTask` / scope 校验 / TBD | ❌ **不写盘**（★ 本会话 7 次里 5 次是这类）|
| ★ **成员越界** | inScope 校验 | ❌ 不写盘 |
| ★★ **成功但值得记** | 无处 | ❌ **完全没有** |
| ★ **成员的好做法** | 无 | ❌ 完全没有 |

### 所以 `observe` 要采三类（★ 用户原话里的三类）

```ts
export interface EvolutionSignal {
  readonly kind: 'rejection' | 'success' | 'insight'
  /** 确定性来源：谁拒的 / 哪个工具 / 哪条判据 */
  readonly source: { readonly where: string; readonly gateId?: string; readonly tool?: string }
  /** ★ 原文，不改写 —— 改写会让"看到什么"不可核 */
  readonly message: string
  /** 结构化上下文（可空，不许编） */
  readonly context?: Readonly<Record<string, unknown>>
  /** 团队 / 任务 / 尝试（与卡点台账同口径） */
  readonly scene?: { readonly team?: string; readonly task?: string; readonly attempt?: number }
  /** ★ 时间：用于"同类出现的间隔"（不是用于排序展示） */
  readonly at: number
}
```

★ **用户原话对应:**
> 「不管是**报错**,还是主会话发任务时**子代理觉得不合理**;
>  或者子代理做出了一些**比较好的处理办法**,主会话觉得在什么方面**处理得很好、很有价值**」

⇒ ★★ **三类:`rejection`（报错/不合理）· `success`（好做法）· `insight`（有价值的信息）**

### ★★ 与既有 384 条的关系

```
★ 不新开存储
★ evolution 的采集【复用】 .agent-teams/frictions/*.json 的形状
  ⇒ 只是加一格 routing + 放宽触发条件
★ 而"成功"与"洞察"是【新增】的 kind —— 它们现在无处可去
```

---

## 3. ★★★ 采集点怎么嵌（不许侵入的落实）

### 规则：**一个调用点,一个接口**

```ts
// ★ 宿主侧（index.ts / tools.ts —— 那是【已有的】统一出口）
// 在既有的失败路径上，加【一行】：
void evolution.observe(signalFromRejection(...))

// ★★ 而各模块【不知道】evolution 存在
//    ⇒ 例如 gates/ 里一个字都不改
```

★ **为什么这是"不侵入":**
```
❌ 侵入:  src/gates/contract/task-atomicity.ts 里 import evolution
✅ 不侵入: 宿主在"判据拒绝"那个【已有的】汇合点调用一次
          ⇒ 判据层完全不知道有采集层
```

### ★ 现有汇合点（可直接用）

| 汇合点 | 位置 | 覆盖 |
|---|---|---|
| `recordFriction()` | `tools/shared/entities.ts:3805` | ★ **所有判据拒绝** |
| 工具拒绝的抛出点 | `tools.ts` 的 `transitionError` 一带 | ★ **闸门拒绝** |
| 契约校验 | `quality-gates.ts:843` `validateCreateTask` | ★ **契约类** |

⇒ ★★ **只需要在三个汇合点各挂一行** —— **而不是改 13 个模块。**

---

## 4. ★ 处理层（`classify` → `route` → `verify` → `promote`）

### ① 分类（复用既有 taxonomy）

**本仓已有 9 类**（`index.kind`）:
```
unwired (346) · misclassified (24) · mismatched (5) · unsatisfiable (5)
brittle (4) · overreaching (2) · uncalled (2) · cross-ecosystem (1) · unread (1)
```
★ **不发明第二套 taxonomy** —— 扩它。

### ② ★★★ 分流（`route`）—— **这是用户要的那一格**

```ts
export type Routing = 'soft' | 'hard' | 'unmeasured'

export interface RoutingDecision {
  readonly routing: Routing
  /** ★ 理由必须可核 —— 不是随手填的 */
  readonly why: string
  /** hard 时的落点（哪条判据 / 哪个位置） */
  readonly target?: string
  /** ★ 生效后用来判断"好了没有"的读数 */
  readonly effect?: string
}
```

**★ 分流的判据（用户原话的形式化）:**
```
① 能否【机械判定】？  ⇒ 能 ⇒ hard（加一条判据）
                     ⇒ 不能 ⇒ soft（改 prompt）
② 而 unmeasured 是【第三个答案】：
   ★ 两者都不合适（例如"这需要产品决策"）⇒ 不硬塞
```

★ **为什么 `unmeasured` 必须存在**:本仓记账最久的形态——
**"没能判断"与"判断为不必改"在报告里同形。**（与判据层同一纪律。）

### ③ 验证闸（`verify`）—— **决定能否自动生效**

★★ **而这是"快"的关键:**
```ts
export interface VerificationResult {
  readonly verdict: 'verified' | 'refuted' | 'unmeasured'
  /** ★ 可复跑的读数 —— 不是"我检查过了" */
  readonly readings: readonly { readonly command: string; readonly exitCode?: number; readonly evidence: string }[]
}
```

**★ 已有的验证器（直接复用,不新造）:**
```
pnpm test:gates          ← 判据层
pnpm verify:fast         ← ★ 那个 62 倍的快环
pnpm verify:frictions    ← ★ 卡点数据的校验器（已存在！）
npx tsc --noEmit         ← 两个 config
```

### ④ 晋升（`promote`）—— **照 EverOS 的三层覆盖**

```
L1 代码里的默认（★ 只有人能改）
      ↑ 晋升需 verified
L2 profile 覆盖（~/.dsh/profiles/desktop/cordis.patch.yml）
      ★ 改它不动代码、不必 build、不影响稳定版
      ↑ 晋升需 verified
L3 单次覆盖（每次调用）
```

★★ **而"验证过才生效"落在 L2 → L1 的晋升上:**
```
① 改动先落 L2（数据层）⇒ ★ 立即可用
② 观察该 kind 的卡点是否下降（用 L3 的读数）
③ ★ 下降 ⇒ 晋升到 L1（代码层）
```

★ **而这正好答应用户的"不放心":**
> 「如果已经有某种测试验证了修改后是好的,那立马生效我觉得也没关系」

⇒ **L2 的改动"验证"= `verify:fast` + "该 kind 的卡点下降"** ——
**两个都是可复跑的读数。**

---

## 5. ★★★ 与 `confidence.ts` 的关系（它现在已经在了，但零读者）

```
confidence.ts 已实现:
  tallyRecall / tallyAdopt        ← 双计数（recalled = 找到，upvoted = 采纳）
  confidenceOf = (upvoted + k/2) / (recalled + k)
  PROMOTE_THRESHOLD = 0.90 · ARCHIVE_THRESHOLD = 0.15
  readFlywheel() ⇒ promote | observe | archive | unmeasured
```

★ **而实测:它被 `entities.ts:3399` 用了一次（写进 `readSedimentFlywheel`）,
而 `readSedimentFlywheel` 【零调用方】。**

⇒ ★★ **所以"处理层"的地基已在,缺的是【采集 → 它】与【它 → 生效】两条腿。**

★ **而它的 `confidence` 公式与本设计的关系:**
```
★ 它是【采纳率】的度量 —— 适合回答"这条沉淀该不该晋升"
★ 而它【不】适合回答"这次的报错该走软还是硬"
⇒ ★ 两者是【不同轴】的:一个管"沉淀的信誉"，一个管"缺陷的分流"
⇒ ★★ 不许把两者混成一个指标（那正是本仓记账的形态）
```

---

## 6. ★★ 对外接口（唯一出口）

```ts
// src/evolution/index.ts —— ★ 其他模块只许 import 这个
export { observe }              // ① 采集（宿主在既有失败路径调用）
export { readEvolutionState }   // ② 只读：给 status / snapshot 投影
export { propose }              // ③ 生成提议（人不直接调，AI 调）
export { verifyChange }         // ④ 验证闸
export type { EvolutionSignal, RoutingDecision, VerificationResult }
```

★★ **而反向的关系:**进化模块**需要读**别人时,走**只读**接口:
```
读判据注册表  ⇒ registry.list()（已存在）
读卡点台账    ⇒ 已存在
读 team.json  ⇒ 已存在
★ 而它【不写】任何别人的状态
```

---

## 7. ★★★ 落地顺序（每步都可验证，且都不动代码层）

| # | 做什么 | 验证读数 |
|---|---|---|
| **1** | ★ **采集层**:放宽触发条件 + 加 `kind`/`routing` 字段 | ★ 本会话那 7 次失败**进得了台账** |
| **2** | ★ **补录**本会话的 7 次（带 routing）| ★ **软硬分布**第一次可读 |
| **3** | **分类层**:复用既有 9 类,扩到三类信号 | 分类覆盖率 |
| **4** | **验证闸**:复用 `verify:fast` / `verify:frictions` | 一条改动**能否自动判定 verified** |
| **5** | **晋升**:L2 → L1 | ★ 一条真改动**真的晋升了** |
| **6** | **投影**:给 client 一个"进化"面板 | ★ 前端能看到（用户 2(a) 的要求）|

★ **而第 1 步就有反向半边:**
```
A：一条【判据拒绝】仍被记录（现状不许退化）
B：一条【闸门拒绝】现在【也】被记录（新增的那一格）
C：★ routing 的取值必须能从记录本身读出理由
```

---

## 8. ★ 与"记忆项目"的对照表（我读了三个实现）

| 机制 | EverOS | MemOS | SkillClaw | ★ **我们** |
|---|---|---|---|---|
| 采集 | Episodes | 工具/用户双通道 | session JSON | ★ **确定性拒绝 + 成功 + 洞察** |
| 信号性质 | 语义（LLM）| ★ 工具层确定 | 分数/轨迹 | ★ **确定** |
| 周期 | 每周 02:00 | 失败突发 | 每轮 | ★ **能快就快** |
| 隔离 | —— | —— | ★★ **workspace 边界 + 自验证** | ★ **接口 + 只读** |
| 验证 | —— | δ 守卫 | ★★ **Step 5 自验证** | ★ **复用既有 verify** |
| 晋升 | —— | policy 挂载 | 写回 skills/ | ★ **L2 → L1** |
| 提示词分层 | ★★ **PromptSlot 三层** | policy guidance | SKILL.md | ★ **照 PromptSlot** |

★★ **而 SkillClaw 那两步我必须点出来,因为它们直接答应用户的"不放心":**
```
Step 4  Execute —— 写进 workspace（★ 隔离）
Step 5  Self-validation before finalizing:
        「do not leave a skill change in skills/ unless it has passed
          your self-validation, or unless you intentionally revert」
        「Define 1-3 small validation scenarios … Prefer cases that would
          have caught the observed failure」
```
⇒ ★★★ **"改了必须自验证,否则回滚"** —— 那就是用户说的"不放心改完立马生效"的解法。

---

## 9. ★ 待用户拍板的三件

| # | 问题 | 选项 |
|---|---|---|
| **1** | `evolution/` 是新目录,还是并入 `confidence.ts`? | ★ **建议新目录**(用户要"模块不许互相侵入",而 `confidence.ts` 是纯算法,该被 evolution 调用) |
| **2** | L2 覆盖放哪? | ★ **建议复用 `cordis.patch.yml` 的 profile**(与 prompt 同一层,已有先例) |
| **3** | 第 1 步(采集层)现在做,还是先看完整设计? | ★ **建议现在做** —— 它是后面所有层的前提 |

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
