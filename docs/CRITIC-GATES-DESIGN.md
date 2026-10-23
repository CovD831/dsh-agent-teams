# 评审判据族（critic gates）设计

**状态**：设计稿，未写实现。本文件只读勘察 + 契约设计，`src/` 一个字节未动。
**基线**：分支 `task-mutation-integrate` · HEAD `830a45e298e0119aba6dc5d7adcf5ec770945521` · 工作区**不干净**（开工前已有 20 个 M，非本次改动）。
**勘察日期**：本次会话。全部命令在仓库根执行。

---

## 0. 一句话结论

**评审判据族做「过程评审」，不做「内容评审」。** 但「过程」这个词太粗，它必须再切两刀才落得下去：

```
内容评审（这行有没有 bug）         → 需要 LLM，外部 reviewer（OCR 一类）产出，作为证据喂进来
过程评审 A：这份证据**存在**吗      → 可机械判，属于我们  ← 本族两条
过程评审 B：这份证据**独立/闭合**吗 → 可机械判，属于我们  ← 本族一条
过程评审 C：这份证据**本身可信**吗 → ★ 判据层**做不到**，只能靠"伪造的代价"（见 §4）
```

★ 第三条是本设计里最容易被口号盖住的一格：**判据层无法让它消费的数据变可信**。凡是设计里出现「findings 由谁签名」的问题，答案都不在判据层。

---

## 1. 现状事实清单（`STATUS: 待独立重跑`）

> 本节的每一个数字都是我自己跑出来的，**但按本角色的纪律，未经独立重跑的事实不得作为边界决策的唯一依据**。
> 因此：**§3 的三条判据形态可以在本节未复核时成立（它们是"该做什么"的设计），而 §6 的 ADR 与 §8 的迁移顺序在复核前标注为「依据为未复核事实」。**

| # | 事实 | 复跑命令（最小） | 结果 |
|---|---|---|---|
| F1 | 判据条数 | `grep -l "export const id = " src/gates/*/*.ts \| wc -l` | `22` |
| F2 | `src/gates/**` 里没有任何 diff / 行号锚点的字面量 | `grep -rln "changedLines\|from_line\|startLine\|diff" src/gates \| wc -l` | `0` |
| F3 | 插入点是 7 个 | `sed -n '320,340p' src/gates/registry.ts` | `admission contract dispatch completion delivery runtime collection` |
| F4 | `findings[]` **已经存在**，形状为 `{id, severity, file?, line?, problem, requiredFix, resolved?}` | `sed -n '266,275p' src/types.ts` | 存在（`ReviewFinding`） |
| F5 | `findings` 挂在任务记录上，由 `update_task` 落盘 | `sed -n '2069p' src/tools/update-task.ts` | `if (findings !== undefined) task.findings = findings` |
| F6 | `resolved` 在全仓 **0 个写位点**、3 个读位点 | `grep -rn "\.resolved *=" src/ \| wc -l` / `grep -rn "finding.resolved" src/ \| wc -l` | `0` / `3` |
| F7 | 已有的 pass 前置：open = `resolved !== true` | `sed -n '1851,1853p' src/quality-gates.ts` + `sed -n '2235,2237p' src/quality-gates.ts` | 存在 |
| F8 | `independenceOf()` 已实现、已在生成时调用、已落盘 | `sed -n '2698p;2871p' src/quality-gates.ts`；`sed -n '870p' src/types.ts` | 存在 |
| F9 | **没有任何判据读独立性** | `grep -rn "reviewIndependence" src/gates \| wc -l` | `0` |
| F10 | 自审拒斥已在**写路径**（不是判据层），按 `identity.name` 判 | `sed -n '1997,2010p' src/tools/update-task.ts`；`sed -n '3457,3577p' src/quality-gates.ts` | 存在 |
| F11 | `artifactBindingOf` 三态 `bound/drifted/unbound`；**缺席或空数组都算 `unbound`** | `sed -n '601,616p' src/quality-gates.ts` | 存在 |
| F12 | 交付点能拿到的 ctx 只有 `{team, gate, coverage, members}` | `sed -n '172,183p' src/tools/delivery.ts` | 无 findings 专用格（但 `team` 是全量状态，够读） |
| F13 | ★ **交付点 `unmeasured` ⇒ 拒绝交付** | `sed -n '237,239p' src/tools/delivery.ts` | `throwWithSurface(...) could not measure ...` |
| F14 | ★ **完工点纯 `unmeasured` ⇒ 放行 + 告警** | `sed -n '1601,1603p' src/tools/update-task.ts` | `completionNotChecked ⇒ 放行` |
| F15 | `canDeclareDelivery` **完全不读 findings** | 见 §5 论证段 | 成立（该函数内无 findings 引用） |
| F16 | `ReviewPolicy.requiredReviewers` 只被解析/校验，**无任何执行方** | `grep -rn "requiredReviewers" src/` | 只出现在 `profiles.ts` / `quality-gates.ts:862` 的校验里 |

### 1.1 F13 / F14 是本次设计最硬的一条约束

它们不是实现细节，它们**决定了判据该放哪个位置**：

```
completion 位置：unmeasured = 放行 + 告警   → 新判据在 completion 上说"我测不了"是**安全**的
delivery   位置：unmeasured = 拒绝整个交付 → 新判据在 delivery 上说"我测不了"会**死锁**
```

⇒ **凡是「数据可能不存在」的判据，首选 `completion`；放在 `delivery` 的判据必须保证"数据不存在"这一支落 `skipped` 或 `ok`，而不是 `unmeasured`。** 这与 `delivery/coverage.ts` 头注里那段「`coverage` 缺席 ⇒ `unmeasured`，所以**不**把 `coverage` 写进 `requires`」是同一个坑的两面。

---

## 2. 我对「过程评审 vs 内容评审」这条划分的挑战

**结论：方向同意，边界不同意。** 同意的是「判据层不判代码质量」，不同意的是它给出的理由与它的边界恰好错位一格。

### 2.1 同意的那一半，理由要换掉

团队长的理由：*内容评审要 LLM ⇒ 不可复算，要么变成启发式 ⇒ 误伤。*

这条**成立但不是最强的一条**。更强的两条：

1. **判据层的产物是一份可重放的裁决**（`GateEvaluation.ran[]` 会进 `evolution/gate-tally`、会进飞轮的置信度）。一次调用 LLM 的判据，同一份 `team.json` 重放两次会得到两个 verdict ⇒ 它把整个注册表的**唯一硬性质**（同一输入同一结论）打破了。这不是"精度问题"，是**类型错误**。
2. **内容评审的合格线本身是概率性的**。一个 LLM reviewer 说「这段有 bug」时，判据层没有第二个独立来源去判它说得对不对 —— 于是判据只剩两条路：信它（那就不是判据，是转发），或者用启发式校验它（那就是误伤的来源）。**两条都不是"判据"这个名词在契约里承诺的东西。**

### 2.2 不同意的那一格：**「证据本身可信吗」也不属于判据层，但设计里到处在假装它属于**

初稿的三条判据都隐含一个前提：`findings[]` 是真的。而 F5+F6 说明：

```
findings      由 update_task 的入参直接落盘         ← 谁的入参？判据层不知道，也不需要知道
resolved      全仓 0 个写位点 ⇒ 它**只能**由入参写   ← 即"被判的一方自己盖章"
severity      同一条路                              ← 即"被判的一方自己定轻重"
```

⇒ 所以这一族的表述必须改成：**判据不判 findings 真假，判"这条 claim 有没有一份不是在它自己手里产生的佐证"。** 这是本设计与初稿的实质分歧，也是 §4 的全部内容。

### 2.3 还有一个反方向的挑战：**有一条内容评审其实可机械判，别把它扫进"外部 reviewer"**

「这条 finding 说的那个文件/行现在还是不是那样」—— 这不是代码质量判断，是**字节一致性判断**，而本仓**已经有** `artifactBindingOf`（F11）在做同一件事的三态。把它划给外部 reviewer 是把已经存在的能力重复建设。

⇒ **本族三条里，没有一条判代码内容；但有一条（closed）必须消费"字节绑定"这个可机械判的量。** 这就是下面 gate 2 长成那个形状的原因。

---

## 3. 三条判据的最终形态

### G1 `delivery.review-coverage`

```
id:              delivery.review-coverage
插入点:          delivery            ← ★ 不是 dispatch。理由见下
输入面 requires: ['team']
判定逻辑:
  writePaths    = ∪ t.changedPaths                  for t ∈ completed ∧ kind ∈ WRITE_KINDS
  boundPaths    = ∪ v.reviewedArtifacts[].path      for v ∈ completed ∧ kind ∈ VERDICT_KINDS
  waived        = team.reviewWaivers?  (逐路径、带闭集 category)
  for p of writePaths:
     if p ∈ boundPaths                → covered
     else if waiverOf(p) ∧ predicateOf(waiver.category)(p) → covered(waived)
     else                             → uncovered.push(p)
  return uncovered.length === 0 ? ok(covered/waived 计数) : blocked(逐条指名 p 与声称改它的任务)
四态:
  ok         —— 每个被声称改动过的路径，都在某条判决的字节绑定里，或被一条**谓词成立**的豁免覆盖
  blocked    —— 有路径既没被绑过、也没被合法豁免（★ 逐条指名，不汇总成一句"有文件没审"）
  unmeasured —— ① `team.tasks` 不是数组 ② 某条 task 不是对象 ③ 某个路径过不了
                `normalizeWorkspacePath`（F: `quality-gates/predicates.ts:35`）
                ④ 某条 waiver 的 `category` 不在闭集里 ⇒ 读不懂它凭什么叫豁免
  skipped    —— `appliesTo` 为假：这个队**没有**任何 completed 的写类任务声称改过路径，
                且**没有**任何 completed 的判决类任务（= 这轮根本没有"文件—评审"这对关系）
证据形状:
  ok      → { covered_paths[], waived[{path, category, by, waived_by_implementer}], bound_by[{path, task_id}] }
  blocked → 每条 blocker 一句话，含：路径 + 声称改它的任务 id + "没有任何判决绑定过它"
           读的人可以据此点开那条任务（`agent_teams_status`）看它到底改了什么
```

**为什么不是 `dispatch`**：`dispatch` 那一刻只看得见"这一个成员这一次"，而「有没有人审过这个文件」是**跨任务**的问题（改它的是 A，该审它的是 B）。放 `dispatch` 会把一个全局问题挤进一个局部位置，而且会**在成员开工时**拒绝（补救动作是"去派一条 review"，而那时 review 该由队长派）。`delivery` 是唯一同时看得见全部写任务与全部判决的位置。

**为什么 `requires` 只有 `team`，不声明别的**：F12 —— 交付点今天只喂 `{team, gate, coverage, members}`，而 `team` 是**全量** `TeamState`（含每个 task 的 `changedPaths` / `reviewedArtifacts` / `createdAt`）。⇒ **这条判据今天就能拿到它要的全部输入，不需要任何人补一格。** 这是它在三条里唯一"输入面零成本"的原因，也是它该第一个落地的原因。

**「显式标为无需评审」的判定依据（回答初稿的三问）**：

1. **谁能标**：任何有 tool 调用权的人（队长或成员）都能写一条 waiver。**判据层不追问"你有没有资格"** —— 它追问的是"**你给的理由成立吗**"，那是一个可判的事实，而不是一个权限。
2. **判定依据**：`category` 是**闭集**，每个值配一条**机械谓词**，谓词住在 `quality-gates/predicates.ts`（与 `isDefaultExcludedPath` 同一处）：

   | category | 谓词（必须成立才承认这条豁免） | 覆盖的路径 |
   |---|---|---|
   | `docs-only` | `p` 以 `.md` 结尾且以 `docs/` 开头 | `docs/CRITIC-GATES-DESIGN.md` |
   | `generated` | `p` 落在 `lib/`、`dist/` 等构建产物前缀（复用 `contract/build-artifact-scope` 的既有口径） | `lib/gates/index.js` |
   | `fixture` | `p` 匹配 `scripts/*.test.mjs` 或 `scripts/fixtures/**` | `scripts/gate-r5.test.mjs` |
   | `config` | `p` 落在 `config/` 或 `*.json` / `*.yml` 且不在 `src/` | `package.json` |

   ★ **`src/**` 没有任何一行可豁免** —— 这不是"默认严格"，是**闭集里没有覆盖它的谓词**。一条把 `src/gates/registry.ts` 标成 `docs-only` 的 waiver 会**当场 blocked**（谓词不成立），而理由字段写得多漂亮都不改变这个结论。
3. **会不会变成"全标跳过"的空转**：上面这条就是答案的一半（谓词绑定）。另一半是**必须可数**：
   - waiver **逐路径**，不许通配（`src/*` 这种字符串过不了 `normalizeWorkspacePath` 的精确匹配，且 `category` 谓词无从成立）；
   - `ok` 时 waiver 清单**逐条**进 `outputs`，并额外给两个布尔：`waived_by_implementer`（waiver 的 `by` == 那条写任务的实现者）—— ★ **不据此拒绝**（单 agent 队会死锁，与 `independenceOf` 头注「不做硬拒绝」同一条纪律），只让它**可读**；
   - 少一条就退化成"豁免是一个布尔字段"，而那正是本仓反复记过的形态（降级必须可读）。

---

### G2 `delivery.review-findings-closed`

```
id:              delivery.review-findings-closed
插入点:          delivery            ← ★ 与初稿不同，见下面"为什么不是 completion"
输入面 requires: ['team']
判定逻辑:
  for f of 所有 verdict-kind 任务的 findings, where f.severity ∈ {high, blocker}:
     if f.disposition === 'fixed':
        要佐证: ∃ repair 任务 r: r.status === 'completed'
                               ∧ r.sourceTaskId === (那条判决的 reviewedTaskId)
                               ∧ f.id ∈ r.sourceFindingIds          ← 已有字段，见 F/§4
        佐证缺席 ⇒ open.push({f, why: 'no completed repair cites this finding'})
     else if f.disposition === 'dismissed':
        要 3 格: why 非空 ∧ by 非空 ∧ severityAfter ∈ {low, medium, info}
        任缺一格 ⇒ open.push({f, why: 'dismissal without <哪一格>'})
     else:  open.push({f, why: 'no disposal record'})            ← resolved:true 但无 disposition 也落这里
  return open.length === 0 ? ok(closed/waived 计数) : blocked(逐条指名 finding id)
四态:
  ok         —— 每条 high/blocker 都有一条**形状完整**的处置记录，且 fixed 的那些都能指到一条
                completed 的 repair
  blocked    —— 有 finding 没有可接受的处置（★ 逐条指名 `f.id` + 缺哪一格 + 它属于哪条任务）
  unmeasured —— finding 形状读不出：`severity` 不是 `low|medium|high|blocker`（例如 `"HIGH"`）/
                `id` 为空 / `requiredFix` 不是字符串 ⇒ 无法分类 ⇒ 整条判据 unmeasured
  skipped    —— `appliesTo` 为假：队里没有任何 verdict-kind 任务（⇒ 没有"评审发现"这个概念）
证据形状: { findings_closed[], findings_dismissed[{id, why, by, severityAfter}],
            corroborated_by[{finding_id, repair_task_id}] }
```

**为什么不是 `completion`**（对初稿的实质修正，理由是可复跑的）：

同一个问题在 `completion` 上**已经被答过一次** —— `evaluateQualityCompletion` 在 review 任务 `status → completed` 且 `verdict=pass` 时拒绝（`quality-gates.ts:2235`）。把 G2 也放 `completion`，就是**同一时刻的第二个真相**，而且按 F14，两者冲突时**弱的那个赢**（`unmeasured` 会被放行，`blocked` 会被拒）—— 于是日志里会出现"门说测不了、另一个门说有问题"，而读的人无法判定该信谁。

而 `canDeclareDelivery` **完全不读 findings**（F15）。⇒ 现存的真实缺口在**交付那一刻**，且它是初稿没提到的一种：

```
review 任务 → failed（verdict=needs_revision，3 条 high findings）
             ↓ 没人建 repair（或建了但被 cancel）
             ↓ 队长 declare_delivery
⇒ 今天：全绿放行。那 3 条 high findings 从此刻起再没有任何东西会读它们。
```

★ 这才是这条判据**唯一不可替代**的内容。它不比 `quality-gates.ts:2235` 更严格，它比它**更晚、更全局**。

**「驳回需要什么字段才不算随手驳回」（回答初稿）**：

`why` 是自由文本，**自由文本不构成约束** —— 写 20 个字和写 200 个字在判据眼里同形。⇒ 驳回的可判形状是**另外两格**：

| 字段 | 为什么是它 | 可判性 |
|---|---|---|
| `by` | 谁驳回的。与 G1 的 waiver 同一条纪律：不拒，但进输出 | 非空可判 |
| `severityAfter` | ★ **驳回的全部实质内容是一句事实主张**："这条 high 其实不是 high" | 必须是闭集枚举 |
| `why` | 给人读的理由 | **判据只验非空，明确说它不验质量** |

★ 而 `severityAfter` 是关键设计：**一个字段同时让"随手驳回"变得可数**——不是靠它的内容，而是靠它**存在**。一条 `dismissed` 而没有 `severityAfter` 的记录 = "我不想改，也不想说它为什么可以不改" ⇒ open。这条把"随手驳回"从一个道德问题变成一个形状问题。

★ **一个诚实的天花板**：这三格全部来自 `update_task` 的一个入参（F5）。一个铁了心要造假的人可以写 `disposition:'dismissed', severityAfter:'info', why:'x', by:'y'`。**这条判据拦不住他。** 它拦住的是**沉默**（根本没有这一格）与**半成品**（有 `resolved:true` 但没有任何处置）。拦住"主动造假"的，是 §4 里那条"佐证不能出自被判方"。

---

### G3 `completion.review-independence`

```
id:              completion.review-independence
插入点:          completion          ← ★ 保留初稿。它在 completion 上，unmeasured 是安全的（F14）
输入面 requires: ['task.verdict']    ← ★ 刻意**不**声明 task.reviewIndependence（理由见下）
判定逻辑:
  r = task.reviewIndependence
  if r === undefined               → unmeasured('no independence reading was recorded when this review was generated')
  switch r.status:
    'independent'       → ok
    'not-independent'   → blocked(引用 r.why)          // 只对 verdict==='pass'
    'undecidable'       → unmeasured(引用 r.why)       // ★ 与 judgeSelfReview 的分歧点
    其它                → unmeasured('unrecognized status')
四态:
  ok         —— 落了盘的那份独立性读数是 `independent`
  blocked    —— `not-independent`，且这条 review 正在判 `pass`
  unmeasured —— ① 没有读数 ② `undecidable` ③ `status` 不在闭集
  skipped    —— `appliesTo` 为假：kind ∉ {review, requirements} **或** verdict ≠ 'pass'
                （判 `needs_revision` / `reject` 是安全方向，协议只禁"给自己盖章"）
证据形状: { reviewer, implementer, status, why, reading_source: 'generated'|'absent' }
```

**为什么 `requires` 里没有 `task.reviewIndependence`**：缺席**就是**本判据的一条合法输入（⇒ `unmeasured`）。把它写进 `requires`，核对层就会在每一次缺席时**与判据同时**报同一件事；而一旦 `AGENT_TEAMS_ENFORCE_REQUIRES=1`，核对层会把这条判据唯一正确的未测量裁决**拦成接线缺陷** ⇒ 一个永远关着的门。这与 `delivery/coverage.ts` 头注那段（「★ `coverage` 缺席是判据的一条合法输入，所以不写进 `requires`」）逐字同源。

**「同一模型不同会话算独立吗」（回答初稿）**：

**按今天的实现：算。** 而这是**对的**，只是必须把话说清楚：

```
identity 是一个**名字**（`identity.name`，F10）  ⊄ 会话 id  ⊄ 模型 id
```

⇒ 判据能判的独立性只有一种："**这次审查的署名 ≠ 那次实现的署名**"。它不是"不同大脑"，它是"不同署名"。把"不同模型"当独立性的标准，会要求一个本仓**没有**的量（member 的 model 配置存在，但它不是审查时的身份）。

★ 所以这条判据的**价值不在"它有多强"，在"它今天是零"**（F9：`grep reviewIndependence src/gates` ⇒ 0）。它今天能拦住的真实场景是三个，全部有出处：

1. **共享池里的自我审查**：review 任务生成时没指人（`assignee === undefined`）⇒ 落共享池 ⇒ 实现者可以领它。`independenceOf` 对这一幕返回 `not-independent`（`quality-gates.ts:2722-2726`），**而没有任何判据读它**。
2. **写路径放行的 `undecidable`**：`judgeSelfReview` 在 `undecidable` 时 `{ok:true}`（`quality-gates.ts:3537-3543`、`3567-3569`）⇒ 一次"实现者读不出来"的自审被**放行**。本判据把它搬到 `unmeasured`（仍然不拒，但**留痕且可数**）。
3. **历史事实**：`update-task.ts:1975` 头注 MEASURED —— 盘上可判的 13 条审查任务里 **4 条是真自审，且全部判 pass**（`mutation-quality` t4/t8/t12/t14，同一身份 `ledger`）。★ 这条我**没有重跑**（`docs/releases/*` 里没有对应的 team.json），标 **unknown**。

**为什么不干脆把 `independenceOf` 的逻辑搬进判据里**：那会造出第二个真相（生成时的名字 vs 判据时的名字），而 `assignee` 事后可改 ⇒ 两个读数会漂。判据**只读落盘的那一份**，这正是 t6 那段注释（`quality-gates.ts:2864-2877`）选择"在生成那一刻算并落盘"的同一个理由。

---

## 4. ★ 输入从哪来（这一格最容易翻车）

### 4.1 四个问题逐个回答

| 问题 | 答案 | 依据 |
|---|---|---|
| `findings[]` 由谁产生？ | **审查 agent 自己**，通过 `agent_teams_update_task` 的 `findings` 入参 | `update-task.ts:2069` |
| 落在哪？ | `team.json` 里 `task.findings`（**没有**独立文件、**没有**事件流） | `types.ts:720` |
| 谁签名的？能不能伪造？ | **没有任何签名。** 能伪造 —— 手改 `team.json` 或直接传参都可以 | F5 + 本文件通读：无签名/无 digest/无 key |
| 外部 reviewer（OCR）没跑时报什么？ | **不报 `unmeasured`，报 `blocked`**（判据见 4.2） | —— |

### 4.2 `unmeasured` vs `skipped` 的判定规则（团队长要求"给判据，不要含糊"）

这条规则是**按"缺席的成因"分**，不是按"哪一格空着"分：

```
「这件事该做的事，做了吗？」
  ├─ 没做（可判定的缺席）                → blocked    ← ★ 不是 unmeasured
  │     例：文件改了、没有任何判决绑定过它（G1）；review 判了 failed 留 3 条 high、
  │         没人建 repair 就交付（G2）
  ├─ 做了，但读不出来（形状坏 / 身份读不出） → unmeasured
  │     例：severity: "HIGH"；waiver.category 不在闭集；independence.status 不在闭集
  └─ 这件事本来就不该有（不适用）           → skipped
        例：纯 work 队没有 verdict 任务；review 判的是 needs_revision
```

★ **为什么"外部 reviewer 没跑"必须是 `blocked` 而不是 `unmeasured`**：`unmeasured` 说的是"**我**没能测量"，而"没人审过这些文件"是一个**关于世界的、可判定的**结论。按 `docs/GATE-REGISTRY.md:283`「规则一：可判定的事实不得写成没能测量」——把前者写成后者，补救动作会从"去派一条 review"变成"去查判据的接线"，方向完全错。

★ 而这条规则有一个**必须由三方共担**的后果（见 §5 的不变量归属表）：`blocked` 意味着交付被拒 ⇒ **一个从未跑过 reviewer 的队会在第一次交付时被拦**。这不是误伤，这正是这条门存在的理由；但它要求**上线顺序**先于它（§8）。

### 4.3 那"可信"这件事到底由谁保证

结论：**判据层不保证。判据层保证"这条 claim 不是在它自己手里结的账"。**

```
不可信的：f.severity / f.problem / f.requiredFix / f.resolved     ← 审查方自己写
            ↑ 判据只验形状，不验内容，且**明确在输出里说它没验**

可承担代价的：r.status === 'completed' ∧ r.sourceFindingIds ∋ f.id
            ↑ 一条 repair 任务的价值不在于它说了什么，在于**它要走完工门**
              （verify-rerun 要真跑命令 / r5 要红前绿后 / mutation 要变异被抓住）
            ⇒ 伪造它的代价 = 伪造一次真实的命令执行
```

这正是本仓已经有的接线：`sourceFindingIds` 在 `update_task` 的校验里被比对（防重复 repair，`quality-gates.ts:1595-1604`），`countRepairAttempts` 用它数轮次（`:2610`）。**G2 只是第一次把它当成"闭环证据"来读，而不是只当"防重复的键"。**

★ 一个必须写下来的边界：**如果外部 reviewer 的输出（OCR 的 `{path, content, suggestion_code, start_line, ...}`）直接写进 `findings`，它同样不可信** —— 它只是把"内部模型自己写的"换成"外部模型自己写的"。**换来源不等于加签名。** 真正的升级路径是 §9 的 Scope-out #3。

---

## 5. 与现有判据的边界（逐条）

| 对谁 | 它管什么 | 本族管什么 | 不重叠在哪（可判） |
|---|---|---|---|
| `delivery.coverage` | **目标条目**有没有人认领（`coverageOf` 矩阵） | **被改动的路径**有没有被判决绑定过 | 一个目标可以有任务认领、而它的文件一行都没被审过（⇒ coverage 绿、G1 红）；反之一个没人认领的目标也可能被顺手审过（⇒ G1 绿、coverage 红）。两集合**无包含关系** |
| `completion.r5` | 新增的**测试**在父版本上是否变红（测试有没有判别力） | 这份**判决**有没有绑定它判的字节 | r5 的宾语是"一条测试的判别力"，G1 的宾语是"一条路径的绑定"。r5 全绿而某文件从未进过任何 `reviewedArtifacts` 是完全可能的（那条测试测的是另一个文件） |
| `dispatch.changed-paths` | 成员**自报的** `changedPaths` 与**会话里真实发生的写入**是否一致（谁动的） | 那个路径**被谁判过** | 时间与宾语都不同：前者在 `dispatch`、宾语是"自报 vs 观测"；本族在 `delivery`、宾语是"观测/自报的路径 vs 判决绑定"。★ 前者是后者的**上游供应商**（它让 `changedPaths` 值得被信），两者是串联不是并联 |
| `completion.verify-rerun` | 命令**真的跑了吗** | finding **真的闭环了吗** | 一条 repair 可以真跑命令（verify-rerun 绿）却只修了 3 条 finding 里的 1 条 |
| `quality-gates.ts:2235`（**不是判据**） | review 任务**自己**转 completed 时，不许留 open high | 交付那一刻，全队还有没有 open high | ★ 时刻与范围都不同：前者管"这条 review 能不能收口"，后者管"整个队能不能交付"。**G2 的存在理由就是 F15**：那 3 条 finding 所属的 review 永不再转状态，而 `canDeclareDelivery` 不读它们 |
| `judgeSelfReview`（**不是判据**） | 写路径上"署名相等 ⇒ 拒 pass" | 落盘的独立性读数是否 `independent` | G3 **不重算**独立性（避免第二个真相），它读那份落盘的读数，并**收紧 `undecidable` 那一支**（`ok` → `unmeasured`） |

★ 一条**必须承认的重叠**：G2 与 `quality-gates.ts:2235` 在"review 任务完成的同一刻"**会同时说话**。这是**刻意的**（一个在写路径拒、一个在交付时拒），但它们必须**同口径**，否则会出现"2235 放行、G2 拒绝"的争议。口径统一的落点：G2 的 `open` 定义包住 2235 的 `open` 定义（`resolved !== true` ⊆ `no acceptable disposal`）。**这一条要写进实现注释，并由一条臂钉住**（§7 臂 3c）。

---

## 6. ADR（`依据为未复核事实` —— §1 未独立重跑前，这三条是**建议**不是裁决）

### ADR-1：G1 / G2 放 `delivery`，G3 放 `completion`

- **决策**：如上（单选）。
- **被否掉的选项**：三条全放 `completion`（否：G1 是跨任务问题，`completion` 只看一条任务；G2 与 2235 同刻撞车）；三条全放 `delivery`（否：G3 在 `delivery` 上 `unmeasured` ⇒ 拒交付，而"没有独立性读数"在今天是**常态**（F9），会立刻全量死锁）。
- **代价**：G1/G2 一旦硬化，所有历史队第一次交付会被拒 ⇒ 必须配 §8 的 `ONLINE_AT` 灰度。

### ADR-2：豁免/驳回的合法性来自**闭集 + 谓词**，不来自**权限**

- **决策**：谁能写 waiver 不设限；waiver 成不成立由 `category` 的机械谓词决定。
- **被否掉的选项**：只许队长写 waiver（否：队长的 `by` 也是一串字符串，等于用权限换掉了一个可判事实，且单 agent 队无法自证）；只允许 `why` 非空（否：自由文本不构成约束，§3 G2 已论证）。
- **代价**：`src/**` 完全不可豁免 ⇒ 一个"确实不需要评审"的 `src/` 改动（例如纯类型重排）会被拒。**接受**，因为它的补救动作是"派一条 review"或"改契约"，两者都比"给自己开一张免死金牌"便宜。

### ADR-3：findings 的可信度**不**由判据层建立，由 repair 任务的完工门承担

- **决策**：G2 只承认"有 completed repair 引用它"的 `fixed`。
- **被否掉的选项**：给 findings 加签名/加 digest（否：签名需要密钥分发的 I/O，判据层是纯函数；且本仓没有这套基础设施，`unknown` 是否有任何形态的事件签名）；把 OCR 输出直接当证据（否：见 §4.3 ——换来源不等于加签名）。
- **代价**：一个不建 repair 任务、直接 `dismissed` 的流程会一路绿灯（只要三格齐全）。**已知且接受**，因为那条路径留下了 `by` + `severityAfter` + `why`，是**可追责**的。

---

## 7. 最小可验证路径（不写代码，成本 ≤ 2 小时）

目标：在**真实 git history** 上证明三条判据**会开火**，且**四态两两不同形**。全部用 `node --input-type=module -e`（判据核心是纯函数，可以直接把谓词逻辑写成一次性脚本；**脚本放 `/tmp`，不进仓**）。

### 7.1 真实输入从哪来

| 输入 | 真实来源 | 命令 |
|---|---|---|
| `writePaths` | 本仓真实提交改过的路径 | `git show --name-only --format= 088dc8c`（房间/摄像机那次提交，含 `src/client/**` + `lib/**`） |
| 对照路径集 | 只有文档的提交 | `git show --name-only --format= 830a45e`（HEAD，纯 `docs/`） |
| `findings[]` 形状 | **语料很薄** ⇒ 只能按 `types.ts:266-275` 的字面形状合成 | `grep -c '"severity"' docs/releases/v0.1.19/repair-trace.jsonl` ⇒ **0**（标 `unknown`：盘上没有真实 findings 语料） |
| `independenceOf` 的行为 | 直接 import 现成的纯函数 | `node --input-type=module -e "import('/Users/abab/Desktop/agent-teams-dev/lib/quality-gates.js').then(m=>console.log(m.independenceOf(undefined,'ledger')))"` |

### 7.2 九臂表（每臂 ≤ 10 分钟）

| 臂 | 目的 | 输入 | 期望 | 判据（"它真的在测"） |
|---|---|---|---|---|
| 1a | G1 伪造臂 | `writePaths` = `088dc8c` 的真实路径集；`boundPaths` = ∅；无 waiver | `blocked`，且 blocker 条数 = 路径数 | 逐条含路径原文（不是一句"有文件没审"） |
| 1b | G1 未测量臂 | `writePaths` 里塞 `'../etc/passwd'` | `unmeasured` | 且 `shapeOf(unmeasured) ≠ shapeOf(blocked)` |
| 1c | G1 对照臂 | `writePaths` = `830a45e` 的 `docs/**`；waiver `category:'docs-only'` | `ok`，`waived` 长度 = 路径数 | 且把同一条 waiver 的 `category` 改成 `generated` ⇒ **必须变 `blocked`**（谓词真的在起作用，不是装饰） |
| 2a | G2 伪造臂 | 3 条 `severity:'high'` + `resolved:true` 无 `disposition` | `blocked` | 逐条指名 `f.id` |
| 2b | G2 未测量臂 | 一条 `severity:'HIGH'`（大小写） | `unmeasured` | —— |
| 2c | G2 对照臂 | 3 条 high：1 条 `fixed` 且有 completed repair 引用、1 条 `dismissed` 三格齐、1 条 `medium` | `ok` | 再把 repair 的 `status` 改成 `in_progress` ⇒ **必须变 `blocked`**（佐证真的在读 repair） |
| 3a | G3 伪造臂 | `independenceOf(undefined,'ledger')` 的**真实返回值**喂进判定 | `blocked` | 断言 `status === 'not-independent'`（已经是真实输出，不是我编的） |
| 3b | G3 未测量臂 | 同一输入的 `undecidable` 变体（`independenceOf('a', undefined)`） | `unmeasured` | ★ 且断言**与 `ok` 不同形**（这是与 `judgeSelfReview` 分歧的那一格） |
| 3c | G2 ↔ 2235 口径臂 | 一条 `resolved:false` 的 high | G2 `blocked` **且** 2235 也拒 | 两者不得一个放行一个拒绝 |

### 7.3 这条路径能证明什么、不能证明什么

- **能**：谓词真的在跑（1c 的"改 category 必须翻面"、2c 的"改 repair 状态必须翻面"两条**反向臂**才是重点——只跑正向臂等于没测，见 `GATE-REGISTRY.md` 规则二）。
- **不能**：不能证明"在**生产**数据上会开火"，因为本机 `~/.agent-teams/` 不存在（`ls ~/.agent-teams` ⇒ 空）⇒ **盘上零真实 team.json**。这一格必须写 `unknown`，并由一个真实跑过 profile 队之后的读数来补（§9 Scope-out #1）。

---

## 8. 迁移顺序（每段可验证、可回滚）

```
S0  只加 `docs/`（本文件）。零代码。回滚 = 删文件。
    └ 验收：`pnpm test:gates` 逐字相同（一个字节没动 src/）

S1  只「记」不「判」：把独立性读数的覆盖面从"计划环生成的任务"扩到
    `create_task` 直建的 review 任务（`create-task.ts:832` 那一支已有同款快照代码可抄）。
    └ 理由：G3 的 `unmeasured` 臂在今天是**常态**（F9）。不先补记录，G3 一上线
      就对每一条手建 review 报 unmeasured。
    └ 验收：`grep -c reviewIndependence` 在 team.json 上从 0 变 N；三条判据仍未接。

S2  三条判据以 **观察模式** 落地：`AGENT_TEAMS_OBSERVE_GATES=delivery.review-coverage,
    delivery.review-findings-closed,completion.review-independence`（`registry.ts:510`）。
    └ 观察模式的语义是"开火了、裁决被放过、原文进 `observed`"（`registry.ts:125-137`）
       ⇒ **零拒绝风险**，且真实读数第一次有数据。
    └ 三条各自自带三臂夹具 `scripts/gate-*-critic.test.mjs`（§7.2 的九臂）。
    └ 验收：跑一个真实 profile 队，读出 `observed.blockers` 条数与内容；若
       `delivery.review-coverage` 在**正常队**上就报了几百条 ⇒ 口径错了，回 S2 调。

S3  按位置**逐条**硬化，不打包：
    S3a  `completion.review-independence`（最安全：unmeasured 不拒，F14）
    S3b  `delivery.review-findings-closed`（配 `FINDINGS_GATE_ONLINE_AT` 灰度：
          `task.createdAt < ONLINE_AT` 的 finding 不计入 open，与
          `plan-reviewed.ts` 的 `PLAN_REVIEWED_GATE_ONLINE_AT` 同一手法）
    S3c  `delivery.review-coverage`（最后，最会拒人；同上灰度）
    └ 每段的回滚 = 从 `ALL_GATES` 里摘掉那一行（`src/gates/index.ts` 的"一人一行"约定
      就是为此存在），或把 env 改回观察模式。

S4  （不在本期）把 `observedChangedPaths`（会话观测）接进交付点，让 G1 的
    `writePaths` 从"自报"升级为"观测"。当前它是**自报**，这一点必须在 G1 的
    输出里明说（`path_source: 'self-reported'`）。
```

★ **顺序的三条硬理由**（不是风格）：
1. **S1 必须早于 S3a** —— 否则 G3 把每一条手建 review 判成 unmeasured（虽不拒，但读数全是噪音，而噪音会教人忽略门禁）。
2. **S2 必须早于 S3** —— 本族是**首个会拒交付的评审门**，不给观察期就是在生产上做实验。
3. **S3c 必须最后** —— 它是唯一会拦住"正常、但不评审"的队的那条。

---

## 9. Scope-out（本期显式不做，注明归属家族）

| # | 不做项 | 归属家族 | 为什么现在不做 |
|---|---|---|---|
| 1 | 用真实 profile 队的盘上数据做一次 census（"多少个文件被改、多少个被绑定"） | 生态取证 / `evidence-auditor` | 本机 `~/.agent-teams/` 不存在 ⇒ 语料为 0，标 `unknown` |
| 2 | 把 `observedChangedPaths` 接进 `delivery` ctx（让 G1 的路径来自会话观测而非自报） | 接线 / `dispatch.changed-paths` 家族 | 需要改 `src/tools/delivery.ts` 的 ctx 构造；本期只读 |
| 3 | findings 的**签名**机制（谁产生、可否伪造、外部 OCR 输出的 attestation） | 证据基础设施（新家族） | 判据层是纯函数，不可能持有密钥；且本仓 `unknown` 是否有事件签名 |
| 4 | `ReviewPolicy.requiredReviewers` 的执行（F16：只解析，零执行方） | 配置 / 契约家族 | 它是"指定谁必须审"，与 G3 的"审的人是否独立"是两个量 |
| 5 | 交付时把 `verdictBindings` 的 `unbound` 硬化成拒绝（t97 的 S3/S4） | `delivery` 家族 / t97 线 | 上游自己把 S1 定位为"只报不拒"，S3/S4 是独立一段 |
| 6 | 把 G2 的 `open` 定义与 `quality-gates.ts:2235` 合并成**单一**函数 | 契约家族（`quality-gates.ts`） | 需要动写路径，超出"只读设计" |
| 7 | 内容评审（LLM 读 diff） | **不属于本仓判据层**（外部 reviewer） | 见 §2.1 |

---

## 10. 不变量归属表

| 不变量 | owner | 验收方式 |
|---|---|---|
| `unmeasured` 不得并进 `ok` | 每条判据自己（`src/gates/**` 契约 §3.4） | 三臂夹具的"形状不同"断言（`shapeOf(unmeasured) !== shapeOf(ok)`） |
| `delivery` 位置的 `unmeasured` ⇒ 拒绝；`completion` 位置 ⇒ 放行 | `src/tools/delivery.ts:237` / `src/tools/update-task.ts:1601` | 既有夹具；本族新增判据**不得**改变它 |
| 一条路径"被改过"由 `changedPaths` 声明 | `dispatch.changed-paths`（它验真伪） | 该判据自己的夹具 |
| 一条路径"被审过"由 `reviewedArtifacts` 绑定 | `update-task.ts:2058`（落盘时刻） | `artifactBindingOf` 三态 + G1 |
| 一条 high finding "被处置" | ★ **G2**（本族新增） | G2 的 2a/2c 两臂 |
| 一条 finding "真的被修了" | **repair 任务的完工门**（`verify-rerun` / `r5` / `mutation`） | 那些判据自己的夹具 |
| 独立性读数在**生成时**算一次并落盘 | `quality-gates.ts:2871`（生成）+ `create_task`（S1 补） | F9：今天是 `0` 个读者 ⇒ S3a 之后是 `1` |
| 豁免/驳回的合法性 = 闭集 + 谓词 | ★ **本族**（`predicates.ts` 新增 4 条谓词） | G1 的 1c 反向臂、G2 的 2c 反向臂 |

★ 表里最后一条是本族最容易被后人改坏的地方：**只要有人把 `category` 从闭集改成字符串**，整套豁免就退化成"写什么算什么"。⇒ 它需要一条**源码级**的臂（读 `predicates.ts` 的导出，断言 4 个谓词存在且 `category` 是 `as const` 数组）。

---

## 11. 待澄清（需用户裁决，不替他决定）

1. **G1 遇到"只有 `work` 类任务的队"该不该说话？** 今天 `work` 类不走完工门（`evaluateQualityCompletion` 对 `kind==='work'` 早返回）。若 `work` 任务也声明 `changedPaths`，G1 会在一个**根本没有评审概念**的队上报 `blocked`。选项：(a) 只收 write-kind 的 `changedPaths`（宽，漏 `work` 改的文件）；(b) 收全部（严，普通队会被拦）。
2. **`reviewedArtifacts` 为空数组时，G1 该算"没审"还是"审了但没绑定"？** `artifactBindingOf` 把两者都算 `unbound`（F11）。对 G1：前者应 `blocked`、后者应 `unmeasured` —— 但落盘形状上两者**不可区分**。要么接受"都算 blocked"，要么在 S1 顺手存一个 `reviewedArtifactsRecorded: true`。
3. **`severityAfter` 的闭集里要不要有 `blocker`？** 若允许 `blocker → blocker` 的"驳回"，那等于允许"承认问题很严重但我不改"。建议不允许，但这会拒绝一种合法的"已知风险接受"流程。
