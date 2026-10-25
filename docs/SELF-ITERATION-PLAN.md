# 自迭代实现计划（N 线：采集 · 分流 · 前置审查 · HMR）

> 状态：**计划，未落地**。本文件只写 `docs/` 与一份机器可读的计划 JSON。
> 未改动 `src/`、`scripts/`、`lib/`。
>
> 前置审计：`docs/SELF-ITERATION.md`（自迭代的既有口径）、`docs/FLYWHEEL-ARCHITECTURE.md`（主线）、
> `docs/EVOLUTION-WIRING-GAP.md`（五模块消费面）、`docs/DEFECT-HMR-DURING-MEMBER-TURN.md`（HMR 缺陷）。

---

## 0. 先消歧：本轮说的「L1 / L2」不是仓里已有的那两对

仓库里**已经有两套**叫 `L1 / L2` 的东西，而它们都不是本轮要做的：

| 出处 | L1 | L2 | 本轮是否指它 |
|---|---|---|---|
| `docs/LAYER-INVENTORY.md` | 判据注册表化 `70c8c96` | 判据本体 `626c59d…27e9613` | ❌ |
| `docs/FLYWHEEL-ARCHITECTURE.md` | 代码层 | profile 覆盖层 | ❌ |

⇒ **本文改用 N 线命名**（`N` 只是与既有 L 线不撞名的一个字母，**没有缩写含义** ——
 本文件第一版把它写成"Self-Iteration 的第四个字母"，而那是一个错的说法：第四个字母是 `f`）：

```
N0  读数脚本（把改前读数变成一条可复跑的命令 —— 硬门槛②要求它先于产品改动）
N1  采集入口（让 collection 四条判据真的跑；让"采了/不采/判不了"不同形）
N2  分流层（让信号变成 RoutingDecision 与 Proposal —— 今天产生方为零）
N3  前置循环审查接线（计划 → 四问/五问 → 分档 → 盖章 reviewed → 派发放行）
N4  HMR 缺陷（重载打断成员回合时，把一次基础设施故障判成一次工作失败）
```

★ 用户原话（m00431）用的是「先做 L1，L2 和修 HMR 吧」，而上一轮审计口头把
`L1` 说成"采集数据层"、`L2` 说成"分流层"。**本文件把那次口头命名固定成 N1/N2，
并把你点名的那一环（"关于计划的前置循环审查，代码里有，但是好像没接上"）单列为 N3。**

---

## 1. 用户要的两件事，与本文覆盖到哪一格

用户原话（m00001）：

> 「1. 自进化：在运行的过程中如果遇到问题，它可以自己做处理、修补和更新。
>  2. 深度挖掘：我给出几个方向之后，它能对这几个方向进行深挖，看看自己在这几个方向还能做到什么样的提升。」

| 方向 | 今天的断点 | 本文覆盖 |
|---|---|---|
| **自进化** | 采集只写 `rejection`（`collect.ts:462` 硬编码）；四条采集判据里 2 条永远 `unmeasured`；`collected` 从未落盘；`Proposal` 零产生方；计划审查链无生产消费者 | ✅ N1 + N2 + N3（**补齐"问题 → 信号 → 提案 → 计划 → 审查 → 派发"这条链**）|
| **深度挖掘** | `grep -rn "深挖\|深度挖掘\|deep-dig\|deepen" docs/` **零命中** ⇒ 从无设计 | ⚠️ **部分**：完整勘探循环不在本轮（N1/N2 是它的前置，见 §7.3）；★ 但**"方向 → 今天的缺陷密度"这一格本轮就能给**（§7.2，落在 N0 的 `directions` 输出里，零新步骤）|

★ **如实说**：本文**不做完整的"深挖"**。它的正确形态需要一个**勘探循环**
（方向 → 现状读数 → 候选改进 → 排优先级 → 计划），而那个循环的输入正是 N1 的台账与 N3 的审查链。
先有数据再有深挖，顺序反了会造出"深挖的结论没有读数支撑"的东西 —— 那正是本仓记账最久的形态。

★★ **但"完整循环不在本轮"不等于"这一轮对方向 2 毫无产出"** —— 这是对抗性审查推翻的第一版判断：
- 用户给方向这件事，**今天就能做**（缺的是一次提问和一个记录它的地方，不是代码）；
- "这个方向今天有几个真实缺陷、几条信号、判据跑没跑"，**本轮 §2 的语料 + `frictions/` 393 条已经够算**；
- ⇒ 所以本文对方向 2 的覆盖是 **⚠️ 部分**：**能让人当场决定先挖哪条**，
  但**还不能自动产出改进候选并排序**（那要 N1–N3）。

★ 顺带一条必须与上表并列记的边界：**深挖必须以人给出的方向为输入**
（`docs/REQUIREMENTS.md:290` 逐字引 m00001「我给出几个方向之后」）。
⇒ 它不是"系统自己决定挖什么"，本轮任何设计都不许越过这一点。

---

## 2. 改前读数（全部可复跑，且**在任何产品改动之前**采到）

依据 `docs/REQUIREMENTS.md` §7 硬门槛②：「**改前读数必须在改产品之前就采到 ⇒ 先写读数脚本，再改产品**」。

### 2.1 采集层（N1）

```
$ wc -l .agent-teams/evolution/signals.jsonl
39
$ # 按 kind
{"rejection":36,"insight":2,"success":1}
$ # observe() 形状的行 —— ★ 定义必须是可复跑的，不是一句感觉
$ # 口径：s.source?.where 存在（= 它来自一次真实的判据求值，而不是人写的笔记）
$ node -e "…s.source?.where 计数…"   ⇒ 29 / 39
$ #   ★ 第一版这里写的是"有 source 且有 message"，而 message 在 29 行里**一条都没有**
$ #   （实测 s.source.message 计数 = 0）—— 那句定义当时就是错的，29 这个数是对的。
$ #   正确口径：这 29 行全部是 kind=rejection 且 source 形如
$ #   {"where":"contract","gateId":"contract.task-atomicity","tool":"create_task"}
$ # collection 四条的裁决分布（29 条带 collection 的行上）
collection.dedupe:ok            29
collection.cooldown:unmeasured  29   ← ★ 100% 判不了
collection.attributable:ok      28
collection.attributable:unmeasured 1
collection.immunity:ok          29
$ # collected 这一格在盘上的存在率
rows with a `collected` KEY = 0 / 29   ← ★ 键整个不存在
$ # proposals.jsonl / history.jsonl
exists = false / false
```

★★ **两条判据"跑了"而恒真的原因**（实测，不是推断）：
三个 `observe()` 调用点**都没传 `index`**，也**没传 `source`**：

```
src/tools/shared/entities.ts:4673   where/kind/component        无 index、无 source
src/tools/create-task.ts:607        where/kind/component        无 index、无 source
src/tools.ts:2120                   where/kind/message          无 index、无 source
```

⇒ `collect.ts:447` 退化为 `index: { seen: new Set(), lastBySource: new Map(), counts: new Map() }`
⇒ 空索引 ⇒ `dedupe` 永远 `ok`（没见过任何东西）、`cooldown` 永远 `unmeasured`（没有 lastBySource）。

★★ **但"没传 source"这一句要说准，否则会修错地方**（复核时发现，两者不是同一层）：
`ObserveInput.source` 的类型是 **`string`**（`collect.ts:404`，纯字符串），
而**落盘**的 `signal.source` 是一个**对象** `{ where, gateId?, tool? }`（`collect.ts:464-468`，
由 `input.where` / `input.gateId` / `input.tool` **重新拼**出来的，**不是** `input.source`）。
⇒ ★★ **两套形状：判据吃的是 `source: string`，台账存的是 `source: {where,…}`。**
而 `cooldown` 的 `index.lastBySource` 键也是那个 **string**。
⇒ ⇒ ★★★ **所以"给 `observe()` 传 `source`"与"`source.where` 在盘上存在"是两件事**，
且 §2.1 那个 `observeShaped = 29` 的口径（`s.source?.where` 存在）量的是**落盘形状**，
不是**判据输入**。这两者今天恰好同源（都来自 `input.where`），
但 N1 接线时必须显式决定：**`source` 传什么** ——
- 传 `where`（如 `'contract'`）⇒ 冷却窗粒度粗（29 行只落在 5 个桶里，§2.1 的 15 条就是按这个算的）；
- 传 `where + gateId`（如 `'contract|contract.task-atomicity'`）⇒ 粒度细，实测挡 **13** 条。
★ 这个选择**直接决定 N1 的收益靶是 15 还是 13**，所以它不能留给实现者临场定。

★★★ **反事实读数（如果判据真的跑，会挡多少）** —— 用真实台账反推：

```
按 dedupeKeyOf = `kind|component|message`：
  29 行 → distinct 26            ⇒ dedupe 会挡 3 条
按 cooldown 的 source（= where）5 分钟窗：
  同 where 5 分钟内              ⇒ cooldown 会挡 15 条
按 where@gateId 作 key（更细）：
                                 ⇒ cooldown 会挡 13 条
```

★★ **一个我自己踩进去过的坑，写进 N0 的规格免得再踩**：
上面 3 / 15 / 13 是在 **29 行 observe 形状**（`source.where` 存在且 `message` 存在）上算的。
若图省事拿**全部 39 行**算，那 10 行没有 `source`/`message` 的会被算成同一个键
（`undefined|undefined`堆在一起）⇒ 得到 `distinct 29 / 挡 10`，**一个看起来很像真的错误读数**。
⇒ N0 的 readout **必须**把两行分开打印：`rows.total = 39` 与 `rows.observeShaped = 29`，
且 `wouldBlock` 那两行**只能**在 observeShaped 上算。这一条不进 acceptance 数不出来。

⇒ **N1 的收益靶**：39 条信号里 **18 条噪声不再进库**（3 dedupe + 15 cooldown），
★ 该靶的前提是 `source` 传 **`where`**（粗粒度）。若传 `where + gateId`（细粒度），cooldown 只挡 **13** 条
⇒ 收益靶变成 16 条。**N1 必须先把这一格定下来并写进契约**（见 §2.1 上面"两套形状"那段）。
且 `cooldown:unmeasured` 从 **29 → 0**（要么 ok 要么 blocked，不再整列判不了）。

### 2.2 分流层（N2）

```
$ grep -rn "modality:" src/ | grep -v types.ts
src/evolution/propose.ts:128        ← ★ 全仓唯一的 RoutingDecision 构造点，且只造 unmeasured
$ 消费面
propose.ts   consumers = 0
history.ts   consumers = 0
readExperienceDispatch  consumers = 1（scripts/gate-experience-dispatch.test.mjs，夹具）
```

⇒ 盘上 `routing` 字段只出现在 **10 条 t88 手写行**，且那 10 条用的是**旧三态**
（`hard|soft|none`），不是 `RoutingDecision` 的五态。

★ **任务与命令的语料（补在 §2.2 的"语料够不够"那一问上）**：
```
扫描范围                            team.json   任务   completed  带≥1条exit0   命令   exit0   distinct
.agent-teams/*/team.json（顶层）          6      224         144          128     787     669      520
.agent-teams/**（递归，含 archive/）     53      512         264          224    1174    1022      639
.agent-teams/** 去掉 archive/            32      263         183          154     852     734      525
顶层范围下的 status 分布：completed 144 / failed 49 / pending 16 / cancelled 14 / in_progress 1
```
★ 口径：`带≥1条exit0` 一列数的是「commandsRun 非空」的任务数（字段名 `commandsRun`，不是 `commands`）。
★ 该列第一版三个数各差 1（127/223/153），实测为 128/224/154 —— 差额来自一条 commandsRun 为空数组的任务边界，不改变任何结论。
★ 第一版把 distinct 写成 440 是错的（实测顶层、completed 任务口径 = **520**），
根因是用 `task.commands || task.commandRuns` 取值，而真实字段名是 **`commandsRun`**
—— 取错字段会**静默**得到空集合。★ 这正是"看起来很像真的错误读数"的又一个实例。

### 2.3 前置循环审查（N3）

```
$ 每一环的消费者
scripts/plan-review-check.mjs   checkPlanReview        → 只有 plan-review-tier.test.mjs
scripts/friction-triage.mjs     tierOf                 → 只有 friction-triage.mjs:2212
                                                          → 只有 readExperienceDispatch
                                                          → 只有夹具
                                reviewStateOf          → 0 个生产调用方（5 处命中全在 friction-triage.test.mjs）
                                adversarialReview      → 只有 emitReviewedContract
                                dispatchable           → 只有 --dispatchable CLI 与夹具
$ 判据侧
dispatch.plan-reviewed  注册 ✅ · 生产求值点 1 处 ✅ · 盘上带戳任务 115 条
                        其中 reviewed.at 早于门上线时刻 = 90 条（阈值是常量 PLAN_REVIEWED_GATE_ONLINE_AT
                        = Date.parse('2026-10-09T09:33:50+08:00')，src/gates/dispatch/plan-reviewed.ts:222）
                        ★ 第一版写 95 是错的：95 那个数我不知道从哪来的 —— 用真实常量复算是 90。
                        剩下 25 条 at >= 上线时刻，它们才是"门之后盖的戳"。
$ admission 三条判据
生产求值点 = 0     ← 至今一次都没 fire 过
```

★ **结论**：整条链**每一环都有代码、每一环都不是死的，但没有任何一环在生产路径上被调用**。
用户说的"代码里有，但是好像没接上"——**实测成立**。

### 2.4 HMR（N4）

```
$ 带 `cannot get required service "agents" in inactive context` 字样的任务
  12 条（agent-teams-hardening 7 / overnight-registration-hardening 4 / mutation-quality 1）
  其中 status=completed 10 条（★ 且多条正文以「已完成并合并」开头）、failed 1、cancelled 1
$ .agent-teams/hmr-reloads.jsonl
  50 条，最后一条 at=1792419153815
$ 缺陷文档的因果表（四次失败距最近一次重载）
  538ms / 11ms / 537ms / 6ms   ⇒ 与重载同刻
  同期两次 empty_output 距重载 65s / 91s  ⇒ 与重载无关（对照组）
```

★ **注意一条诚实的限制**：按**任务级** `updatedAt/completedAt` 去比对 50 条重载记录，
最近的时差都在 **41 天以上** —— 因为那 12 条任务发生在 8–9 月，而重载记录只留
**最后 50 条**（`HMR_TRACE_LIMIT=50`，全是 2026-10-19 的）。
⇒ **"历史上那 12 次是否都发生在重载窗口内"用现有留痕无法回溯证实**，
能证实的只有缺陷文档里那份**当场测到的**因果表。
⇒ 所以 N4 的收益**不能**写成"这 12 条会变好"，只能写成"**下一次**不再把它判成失败"。

---

## 3. 依赖图与分档

★★ **实测的写域重叠（我第一版把 N1/N2/N3 都写成"无前置"，那是错的）**：

```
$ node -e "（比对 docs/self-iteration-plan.json 每两条的 inScope 交集）"
N1 ∩ N2 = src/evolution/collect.ts
N1 ∩ N3 = src/tools/shared/entities.ts
N1 ∩ N5 = src/tools.ts
N3 ∩ N5 = src/tools/status.ts
```

★ 加进 N5 之后，上面那段命令多出两条相交 —— `src/tools.ts`（N1 的 observe 调用点在
`:2120`，N5 的 `approveStagedTeam` 在 `:2143`）与 `src/tools/status.ts`（N3 与 N5）。
★★ **这两条不需要新的依赖边**：N5 已经依赖 N3，而 N3 依赖 N2、N2 依赖 N1 ⇒
N5 在链上**已经排在 N1 之后**。写域相交只要求"不并行"，不要求"直接相邻"。

⇒ 两个文件撞了，所以**它们不能并行**。正确的依赖图：

```
N0 ──► N1 ──► N2 ──► N3 ──► N5   （按写域串起来，不是按"逻辑上谁需要谁"）
                  └──► N4        （N4 的两个文件与谁都不同 ⇒ 可随时插队，建议最先做）
```

| 步 | 前置 | 为什么是这个前置 |
|---|---|---|
| N0 | 无 | 它只读盘、只写 `scripts/` 一个新文件 |
| N1 | N0 | 硬门槛② 要求改前读数先于产品改动 |
| N2 | N1 | **写域相撞**：两者都改 `src/evolution/collect.ts`（N1 拆 kind 两格，N2 在那里加 history 写方）|
| N3 | N2 | **写域相撞**：两者都改 `src/tools/shared/entities.ts`（N1 改 `:4673` 的 observe 调用点，N3 改 `:2316` 的 `readExperienceDispatch`）。★ 两处相距 2300 行，但**同一文件**在并发写时是同一个冲突面 ⇒ 串行 |
| N4 | 无（可与任何一步并行）| 写域 `src/members.ts` + `src/hmr-trace.ts`，与 N0–N5 零交集 |
| N5 | N3 | **它是 N3 的消费者**：N3 把分档与四问读数变成可读的，N5 才有东西可查。★ 顺序反了会造出一个"查一个不存在的东西"的门。写域也与 N1（`src/tools.ts`）、N3（`src/tools/status.ts`）相撞，但已在链上排在它们之后 |

★ **N4 建议最先做**（尽管它没有前置）：它影响"每一次构建"，而 N1–N3 都会触发多次构建。

── 真正的自迭代闭环（本轮之后才成立）──
```
N1 台账 ──► N2 分流 ──► 提案 ──► 计划 ──► N3 审查 ──► N5 门禁 ──► 派发 ──► 新读数 ──┐
   ▲                                                                     │
   └─────────────────────────────────────────────────────────────────────┘
```

★ **分档读数**（`tierOf` 的口径：数 `inScope` 里**现存的 `src/` 文件**）：

| 步 | `inScope` 条目数 | src 文件数 | 分档 | 需要的审查 |
|---|---|---|---|---|
| N0 | 1 | 0（`scripts/`） | **small** | 对抗性审查 |
| N1 | **6** | **6**（审查后 +`src/evolution/read.ts`，见 N1.2） | **large** | 计划审查 + 对抗性审查 |
| N2 | 4 | 4 | **large** | 计划审查 + 对抗性审查 |
| N3 | 3 | 3 | **large** | 计划审查 + 对抗性审查 |
| N4 | 2 | 2 | **large** | 计划审查 + 对抗性审查 |
| N5 | **5** | 4（+`src/tools/approve.ts`；★ 审查后 **−**`scripts/plan-review-check.mjs`，见 N5.16/B6） | **large** | 计划审查 + 对抗性审查 |

★ **这两行的变动来自对抗性审查**（§12.2 #21 与 #27/#22）：N1 加一个文件、N5 换一个文件。
**分档没变**（本来就 ≥2 文件），但**写域的精确性变了** —— 而写域是"能不能并行"的唯一依据。

★ 除 N0 外五步**全部**跨 ≥2 个 `src/` 文件 ⇒ 按 `friction-triage.mjs` 的 `tierOf` 信号 A
（`tierSourceFiles(inScope).length >= 2`），**五步都是大档**。
⇒ 这就是"派出的不应该有大活"（`dispatchable` 注释里用户原话）挡住的形态。
**⇒ 所以这五步都应当由人来裁决，而不是自动派发。** 本文件是给人看的计划，不是派工单。

★ **一处自证修正（本文档第一版写错了）**：§3 表格第一版把 N4 写成 `1 文件 small`，
而 N4 的 `inScope` 是 `src/members.ts` + `src/hmr-trace.ts` = **2 文件 ⇒ large**。
读者若要复核这一格，跑：

```
$ node -e "import('./scripts/friction-triage.mjs').then(m=>{
    const j=JSON.parse(require('fs').readFileSync('docs/self-iteration-plan.json','utf8'));
    for(const c of j.plan) console.log(c.id, m.tierOf(c,{exists:require('fs').existsSync}).tier)
  })"
N0 small
N1 large
N2 large
N3 large
N4 large
N5 large
```

---



## 4. 每一步的契约（含四项必答）

机器可读副本：[`docs/self-iteration-plan.json`](./self-iteration-plan.json)
（由 `scripts/plan-review-check.mjs` 的 `checkPlanReview` 求值，见 §5）。

### N0 —— 读数脚本（先写，再改产品）

| 格 | 内容 |
|---|---|
| **why-now**（objective） | `docs/REQUIREMENTS.md` §7 硬门槛②要求改前读数先于产品改动。今天没有一条命令能打印 §2 的那几组数，上面的数来自一次性 ad-hoc 脚本 —— **不可复跑即不可复核**。 |
| **steps**（inScope） | `scripts/evolution-readout.mjs`（新建，只读 `signals.jsonl` / `proposals.jsonl` / `history.jsonl` / `hmr-reloads.jsonl`）|
| **invariant-reading**（acceptance） | ① 输出含 `signals.total`、`rows.observeShaped`、`by kind`、`collection.<gate>.<verdict>` 计数、`collected.keyPresent / keyMissing` 两项、`proposals.rows`、`history.rows`、`hmr.reloads`；② 在**当前**台账上跑出来的 `signals.total` = 39、`rows.observeShaped` = 29、`cooldown:unmeasured` = 29、`collected.keyPresent` = 0 且 `keyMissing` = 39（★ 口径：`'collected' in signal` 为假 —— 39 行全部没有这一格，不是"有但为空"）；③ `wouldBlock` 两行（`dedupe` / `cooldown`）**只在 observeShaped 上算**，且打印出各自的**分母**，实测为 **3 / 15**（★★ 口径必须写死：dedupe 键 = `kind|component|message`（29 行 → 26 distinct）；cooldown 键 = `source.where` 的 5 分钟窗，逐 where 计数为 contract 5 / edit_plan 1 / validateCreateTask 19 / dispatch 3 / completion 1 ⇒ 同 where 内间隔 <5min 的相邻对 15 对；★ 同时打印 `where+gateId` 口径的 **13** 作为对照 —— 两个口径都印出来，"传什么"这件事才有依据）；④ 脚本对 `lib/` 零 import（只用 `node:fs` 一类标准库），且**不写任何文件**。 |
| **stop-points**（verify） | `node scripts/evolution-readout.mjs`；`node scripts/evolution-readout.mjs --json`（供后续步骤比对）|

★ **为什么它不算"自己给自己出考卷"**（本项目与 `workbench-dev-team` skill 那条约束的对账）：
skill 说的是**评分器**不能由候选自己写；而本仓 §7 逐字要求**读数脚本先写**。
两者的分界是：这个脚本**只读盘上的既有记录，对产品改动的影响只有"记录变多/变少"**，
它不判"改得好不好"，只打印"盘上有什么"。**判定留给 N1/N2/N3 各自的对照读数与人。**

### N1 —— 采集入口解焊（3 个缺陷 + 1 条通道）

| 格 | 内容 |
|---|---|
| **why-now** | `collect.ts:462` 硬编码 `kind: 'rejection'`，把 `ObserveInput.kind`（`['unwired']`，参与去重键）整个丢掉；而 `EvolutionSignal.kind` 是 `'rejection'|'success'|'insight'` —— **两个同名字段是两个不同的东西**，硬编码处把它们焊死了。同时三个调用点不传 `index`/`source` ⇒ `dedupe`/`cooldown` 恒真/恒 `unmeasured`。而 `collected` 这一格**从未落盘**（0/29），使 `collect.ts` 注释逐字声明的"采了 / 不采 / 判不了三态不同形"**在盘上不成立**。 |
| **steps**（inScope） | `src/evolution/collect.ts`（拆两格命名 + 注入 `signalKind` + `collected` 落盘为显式三态）· `src/gates/collection/shared.ts`（`dedupeKeyOf` 跟随重命名）· `src/tools/create-task.ts` · `src/tools.ts` · `src/tools/shared/entities.ts`（三个调用点传 `index` + `source`）· **`src/evolution/read.ts`（新增 `deriveCollectionIndex`，见 N1.2）** · `scripts/evolution-readout.mjs`（加一节 success 通道读数）|
| **invariant-reading**（acceptance） | ① ★★ **双读数**（第一版写成单读数 `0 → = signals.total`，**上限是错的**，见 N1.1）：(a) **存量 29 行冻结**：`collected.keyPresent` 在旧行上**永远是 0**（它们是历史裁决，改代码不回填）；(b) **新写一条**：跑完后新追加的每一行 `"collected" in signal === true`（`collected: undefined` 也写成一格，如 `null`，**不许**让键消失）。★ 两条都要印出来 —— 只看 (b) 会让人以为存量也修好了，只看 (a) 会让人以为修了个寂寞；② `cooldown:unmeasured` 从 **29 → 0**（每条要么 `ok` 要么 `blocked`）；★ 这条的前提是 `deriveCollectionIndex` 真的填了 `lastBySource`（见 N1.2）—— 否则改完仍是 29/29，而"28 个 ok 里混着恒真"读不出来；③ 在同 39 行台账上重放：`dedupe` 挡 **3** 条、`cooldown` 挡 **15** 条（脚本打印 `wouldBlock` 两行，与 §2.1 的 3/15 对齐）；④ `signalKind` 默认 `'rejection'` ⇒ 三个调用点不改行为时 `by kind` 仍是 `{rejection:36, insight:2, success:1}`（**逐字不变**，证明解焊没有顺手改语义）。 |
| **stop-points**（verify） | `pnpm typecheck`；`node --test scripts/gate-collection-health-readout.test.mjs scripts/gate-signal-id-uniqueness.test.mjs scripts/gate-collection-*`；`node scripts/evolution-readout.mjs`（对照 §2.1）|

★ **success 通道做成什么样（明确边界）**：
`signalKind` 变成**可注入**，于是"写一条 success"在形状上成为可能。**但本轮不新增自动产生方**：
从 `exitCode===0` 自动推 "success" 正是 `FLYWHEEL-ARCHITECTURE.md` §3.2 逐字警告的
「若循环对'没报错'优化，它会产出'什么都不做'」。盘上有 **127 条** completed 任务带 ≥1 条
exit0 命令 —— 那是**语料充足而判据不足**，不是缺数据。

★ **这组数的扫描口径必须写清**（我第一版把 `distinct` 写成 440，实测是 **520**）：

```
扫描范围                            team.json   任务   completed  带≥1条exit0   命令   exit0   distinct
.agent-teams/*/team.json（顶层）          6      224         144          127     787     669      520
.agent-teams/**（递归，含 archive/）     53      512         264          223    1174    1022      639
.agent-teams/** 去掉 archive/            32      263         183          153     852     734      525
```

★ 差异来源有两层，两层都要说：
· **扫描范围**：顶层 6 个团队（224 任务）vs 递归全仓 53 个（512 任务）—— 相差 6 倍多；
· **distinct 的口径**：同一个顶层范围下，「只数 completed 任务里的命令」= **520**，
  「数全部任务的命令」= **618**，「只数 exit0 的命令」= **521**。
⇒ 本文引用的是**顶层 6 个团队、completed 任务**那一格（520）。
★ 第一版写成 440 的**根因**：当时用 `task.commands || task.commandRuns` 取值，而
`TeamTask` 的真实字段名是 **`commandsRun`**；取错字段会**静默**得到 0 或残缺集合
（这正是本仓最贵那条「取错字段 ⇒ 读数看起来真、其实不是那个数」）。

```
$ node -e "
const fs=require('fs');
const files=fs.readdirSync('.agent-teams',{withFileTypes:true})
  .filter(e=>e.isDirectory()).map(e=>'.agent-teams/'+e.name+'/team.json')
  .filter(f=>fs.existsSync(f));
let all=new Set(),e0=new Set(),comp=new Set();
for(const f of files){const t=JSON.parse(fs.readFileSync(f,'utf8'));
  for(const task of (t.tasks||[])) for(const c of (task.commandsRun||[])){
    if(c.command===undefined)continue;
    all.add(c.command); if(c.exitCode===0)e0.add(c.command);
    if(task.status==='completed')comp.add(c.command);}}
console.log('all',all.size,'exit0',e0.size,'completed',comp.size)"
⇒ all 618  exit0 521  completed 520
```

★★ **而一个必须点名的缺口（本文档第一版措辞暗示它已经存在，实测它没有）**：
`SuccessCandidate{what, readings[], avoided?, reusedBy?}` 这个类型**只在规范文档里**
（`docs/COLLECTION-LAYER-SPEC.md:430`、`docs/FLYWHEEL-ARCHITECTURE.md:163`），
**`src/` 里一次都没有出现过**：

```
$ grep -rn "SuccessCandidate" src/ scripts/
（src/ 与 scripts/ 零命中；只有上面两份 docs 命中）
```

⇒ 所以"success 通道"今天的状态是：**连类型都还没有**，不是"有类型没人写"。
⇒ 真做它要先落 `SuccessCandidate` 类型 + `reusedBy` 的计数方
（`reusedBy` 是"有价值"的唯一可测代理，而它正好接 `confidence.ts` 的
`tallyRecall`/`tallyAdopt` —— 那两个函数**也零调用方**）⇒ 这是一条独立的一步，
排在 N2 之后。本轮**不做**，也不在 `EVOLUTION-WIRING-GAP.md` 里假装它已登记
（该文件 §3 的三条缺口**不含** success，本轮另行记账：见 §11）。

#### N1.1 ★★ 一条被审查抓出来的错读数：`keyPresent` 的上限不是 39，是 29

第一版的 N1 acceptance 写着「`collected.keyPresent` 从 **0 → = signals.total**」，
而 `S2` 停止点（§8）写着「看 collected.keyPresent 0 → 39」。**这两句都错，且错得会让人永远等不到绿。**

**实测：**

```
$ node -e "…读 signals.jsonl…"
total                    39
无 source.where 的行数    10   ← t88 时期的旧形状
带 collection 的行数      29
带 collected 键的行数      0
旧行的 keys = ["id","at","kind","title","observed","expected","sources","resolution","routing"]
```

⇒ 那 10 条旧行**结构上就没有 `source` / `collection` / `collected` 任何一格** ⇒
`collected.keyPresent` 的最大可能值是 **29**，**永远不等于 39**。

**第二层：即使修好写方，那 29 条也不会变。**
★ 真根因不是第一版写的"从未落盘"，是**序列化**：

```
src/evolution/collect.ts:343-357   collectionDecisionOf 的两条 return 都可能 collected: undefined
src/evolution/collect.ts:470       collection: decision        ← 把 undefined 放进去
src/evolution/collect.ts:228       await appendFile(JSON.stringify(signal) + '\n')   ← 只追加，不重写
$ node -e "console.log(JSON.stringify({a:1,b:undefined}))"
{"a":1}
```

⇒ ★★ **`undefined` 被 `JSON.stringify` 静默丢弃** ⇒ 键整个不存在。
而 `appendFile` 只追加 ⇒ **盘上那 29 行是冻结的历史裁决，改代码只影响未来新行**。

★ 这正是 §12 提炼的那条"本仓最贵缺陷形状是静默给空值"的**第四个实例** —— 而且是最隐蔽的一个：
它不是"读错字段名"，是"写的时候那个键被语言悄悄吃掉了"。

**改法**：

1. **acceptance 拆成双读数**（已改）：存量 29 行的 `keyPresent` 恒为 0（这是**正确的历史事实**），
   新写一行的 `keyPresent` 必须为 1。
2. **`appendSignal` 里不许再靠 `JSON.stringify` 的默认行为** —— 写 `collected` 时显式
   落 `null`（`collected: decision.collected ?? null`），这样"判不了"与"没这一格"不同形。
   ★ 这一格在 `src/evolution/collect.ts` 里，**N1 的 inScope 已覆盖**。
3. **不做回填**（明确写清）：那 29 条旧行的 `collected` 是**当时**的裁决，
   今天按新规则重算并写回去，等于**伪造历史读数**。⇒ 存量与新增分开读，是本条的正解。
   ★ 若将来需要"按今天的规则看历史会怎样"，那是**重放**（`--replay` 参数，只读算出、不落盘），
   不是回填。N0 的 `evolution-readout.mjs` 已经有 `--json`，加 `--replay` 是它的自然延伸。

---

#### N1.2 ★★ 审查抓出的第二条前置：`CollectionIndex` 没有派生方

`N1` 要做的第一件事是"给三个调用点传 `index`"，而**那个 `index` 从哪来，今天没有任何一步负责**。

**第一版的缺口**：计划全文里 `index` 只出现在"传 `index`"与一句
"若 wouldBlock 与 3/15 差得多 ⇒ 说明**索引派生口径**与 §2.1 的反推不一致"——
**承认了"派生口径"这件事存在，却没有一步产出它。**

**实测**：

```
$ grep -rn "index\.json" src/ scripts/
（零命中）

$ cat .agent-teams/evolution/index.json
{ "schema": 1,
  "note": "采集层索引（t88）。★ 两批记录用同一口径……",
  "generated_from": [".agent-teams/frictions/*.json", ".agent-teams/evolution/signals.jsonl"],
  "counts": { "ledger": 372, "session_signals": 10, "total": 382 }, … }
```

⇒ 这个 `index.json` 是 **t88 手写的一次性统计**（`note` 自称"采集层索引"），
它数的是"唯一 (component, kind) 对数"，**与 `CollectionContext.index` 要的
`{seen: Set<dedupeKey>, lastBySource: Map<string, number>, counts: Map}` 是两套东西**。
而 `lastBySource` 在全仓 6 处命中，**全是定义或构造空**：

```
src/gates/collection/shared.ts:68/75   定义与类型
src/gates/collection/cooldown.ts:59    读（但永远读到空 Map）
src/evolution/collect.ts:395/402/447   类型与 `?? { …空… }` 的退化
```

⇒ ★★★ **今天没有任何代码曾把任何 `lastBySource` 填进过一个非空值。**
所以 `cooldown` 的 29/29 `unmeasured` **不是"判据坏了"，是"它的输入从未存在过"**。

**这条为什么必须并入 N1 而不是单列一步**：

- 派生索引需要的原料是 `signals.jsonl`，而 **N1 正在改的就是写它的那个文件**；
- `src/evolution/read.ts` **已经存在**且**已经在读 `signals.jsonl`**
  （`readSignalsHealth`，`read.ts:96`）⇒ 派生函数落在它就是"接一个已有的读取路径"，
  符合 `REQUIREMENTS.md` §7 门槛①"每一步只接一个已有能力"；
- 把它单列成 N0.5，会让 N0 与 N1 之间多一条"写同一个文件"的边，
  而 `read.ts` **不在 N1 现有 inScope 里** —— 并进去只需**加一个文件**，单列则要
  **多一个步骤 + 多一条依赖边 + 多一次分档**，成本更高。

**改法**：

1. `src/evolution/read.ts` 加 `deriveCollectionIndex(stateRoot)`：
   读 `signals.jsonl`，按 `dedupeKeyOf` 填 `seen` / `counts`，
   按 `signal.source.where`（或 `where|gateId`，**口径由 §2.1 那个选择定死**）填 `lastBySource`。
2. 三个调用点改为 `index: await deriveCollectionIndex(root)`（★ 仍在 `void observe(...)` 的旁路里，
   不进拒绝路径的时序）。
3. ★ **`index.json` 不参与** —— 它是 t88 的一次性统计，与 `CollectionContext.index` 无关。
   **不要顺手把派生结果写回 `index.json`**：那会让一个只读的历史快照变成会漂的状态文件。

**⇒ N1 的 inScope 从 5 个文件变 6 个**（加 `src/evolution/read.ts`），
分档仍是 `large`（本来就 ≥2 文件），依赖图不变。

---
### N2 —— 分流层（让 Proposal 有产生方）

| 格 | 内容 |
|---|---|
| **why-now** | `src/evolution/propose.ts` 零消费者、`RoutingDecision` 全仓唯一构造点是 `unmeasuredDecision`（只造 `unmeasured`）、`history.ts` 从未写过一条。`docs/EVOLUTION-WIRING-GAP.md` §3 逐字："缺的是'把一条信号转成一个 Proposal'——那正是【分流】那一步"。而 `src/evolution/index.ts` **不存在** ⇒ 违反 `docs/REQUIREMENTS.md` §1 规则 A（"别人 → evolution 只许 import 一个接口面"），今天有 **7 处**深路径 import（写 6 是错的：漏了 `src/tools/shared/entities.ts:45` 的 `'../../evolution/collect.ts'` —— 用 `(\\./|\\.\\./)` 数会漏，必须 `(\\./|\\.\\./)+`）。 |
| **steps**（inScope） | `src/evolution/route.ts`（新建：`routeSignal(signal, health) → RoutingDecision`，**纯函数**，五态，不 I/O）· `src/evolution/index.ts`（新建：接口面，并把 7 处深路径 import 收口）· `src/evolution/collect.ts`（`history` 的写方：判据变更时 `CollectionHistory.record`）· `src/snapshot.ts`（把 `route` 读数投影进 `TeamActivitySnapshot`，与既有 `collectionHealth` 同一条路）|
| **invariant-reading**（acceptance） | ① `routeSignal` 对 §2 的 29 条 observe 形状信号跑一遍，**五态各有非零实例**，且 `unmeasured` 的条数 **< 29**（今天 `unmeasuredDecision` 是唯一构造点 ⇒ 等价于 29/29 判不了）；② 至少一条信号能产出带 `target` 与 `effect` 的 `RoutingDecision`（`effect` 是给评估器的接口，见 `MODULE-IO-CONTRACTS.md` §1.2）；③ 深路径 import 从 **7 → 0**（全部走 `index.ts`）。★ 复核命令必须写成 `grep -rE "from '(\\./|\\.\\./)+evolution/" src/ | wc -l`，读数是 **7**；写漏 `+` 只得 6，写 `grep -c "from '\./evolution/" src/` 只得 **5**（它连 `../` 都不认，而且 `-c` 对目录是逐文件出数、不给总数）；④ `node scripts/evolution-readout.mjs` 打印 `proposals.rows > 0` **或** 明确打印 `proposals.rows = 0` 且给出"为什么这批信号一条都不该成提案"（★ 两个结局都可接受，但**不许**静默为 0）。 |
| **stop-points**（verify） | `pnpm typecheck`；`node --test scripts/gate-producer-consumer.test.mjs scripts/gate-collection-health-readout.test.mjs`；`node scripts/evolution-readout.mjs`；`pnpm test:gates`（对照 §6 基线）|

★ **不做什么（写清楚才算契约）**：
不新增工具、不新增角色、不新增数据模型语义（`Proposal` 类型早已存在，`nextProposalId` 早就在等一个调用方）。
**不自动派发提案** —— `dispatchable` 的四栏里 `awaitingRuling` 是正常结局（t98 注释逐字：
「大货是不应该直接派的。需要我裁决的就留下来…所以派出的不应该有大活。」）。

### N3 —— 前置循环审查接线（用户点名的那一环）

| 格 | 内容 |
|---|---|
| **why-now** | 用户原话（m00431）：「关于计划的前置循环审查，代码里有，但是好像没接上」。实测成立：`checkPlanReview` 只被 1 个夹具调用、`tierOf` 唯一生产调用在 `friction-triage.mjs:2212`（而它只被 `readExperienceDispatch` 调，而后者只被 1 个夹具调）、`reviewStateOf` 零生产调用方、`admission` 三条判据生产求值点 **0**。⇒ "没审过的计划不该直接派"**只活在文档里**。 |
| **steps**（inScope） | `src/tools/status.ts`（把分档与四问读数投进 status 输出，与既有 `buildGateView` 同一条路）· `src/tools/shared/entities.ts`（`readExperienceDispatch` 接一个**真实生产调用点** —— 它已经是现成的三态 API，今天唯一调用方是夹具）· `src/tools/amend-task.ts`（改契约**之前**问一次 `reviewBeforeChange`）· `src/evolution/index.ts`（接口面再导出，如果 N2 已落）|
| **invariant-reading**（acceptance） | ① `agent_teams_status` 的输出里出现 `planReview` 一节，含 `{small, large, unmeasurable}` 三档计数与"缺哪一问"的逐条名单；② 对一个**真实**团队跑 status：`large + unmeasurable > 0`（本团队五步全 large ⇒ 这个读数非零是自证的）；③ `checkPlanReview` 的 `overall` 三态在 status 输出里**同形呈现**（`present` / `missing` / `unmeasured` 不许并成布尔）；④ **真实调用点**（非注释、非类型引用）从 **0 → ≥1**。 |
| **stop-points**（verify） | `pnpm typecheck`；`node --test scripts/plan-review-tier.test.mjs scripts/review-unified-pipeline.test.mjs scripts/gate-experience-dispatch.test.mjs`；`curl -s http://127.0.0.1:49318/plugins/dsh-agent-teams/state`（真宿主探针，见 §6）|

★★ **一条必须写清的读数陷阱（本文档第一版踩过）**：不能把验收写成
「`grep -c "checkPlanReview\|tierOf\|reviewStateOf" src/` 从 0 → ≥3」——实测 src/ 里**已经有 5 处**：

```
src/gates/dispatch/plan-reviewed.ts:23    ← 注释
src/tools/shared/entities.ts:2251         ← 注释
src/tools/create-task.ts:266              ← 注释
src/types.ts:595                          ← 注释
src/types.ts:834                          ← 注释
```

那 5 处**全在注释里**，零真实调用。⇒ 读数若按 `grep -c` 写，
"接上了"与"有人在注释里提过这个名字"会读成同一件事 ——
而**这正是本仓记账最久的那个同形**（`EVOLUTION-WIRING-GAP.md` §6 逐字：
"这个名字在注释里出现过 N 次"与"它被调用过"不是一回事）。
⇒ acceptance 第 ④ 条必须限定为**真实调用点**，复核方式：

```
$ grep -rn "checkPlanReview(" src/ | grep -v '^\S*:\s*\*' | grep -v '//'
```

★ **另一格不能混的读数**：`src/tools/status.ts` 里 `planReview` 的 grep 计数是 **0**，
但 `planReviewState`（`'awaiting_review' | 'awaiting_feedback'`）散落在
`src/snapshot.ts:258/646`、`src/state.ts:1379-1381`、`src/tools.ts:2076/2166/2188-2191/2212-2213`、
`src/types.ts:1189`、`src/tools/create.ts:235`。
⇒ **那是"暂存计划的阶段"，不是"计划审查的读数"**。N3 要加的这一节**不是它**，
两者同名不许互相顶替。

★★ **为什么这一环是"自迭代"的关键**：自进化的危险形态是**agent 自己决定改自己**。
N3 是那条路的闸：提案 → 计划 → **四问/五问** → 分档（大档必须人裁决）→ 盖章 → 才准派。
**没有 N3，N1/N2 只会让"它自己改自己"跑得更快。**

### N4 —— HMR 缺陷：一次基础设施故障不该被记成一次工作失败

| 格 | 内容 |
|---|---|
| **why-now** | `docs/DEFECT-HMR-DURING-MEMBER-TURN.md` 已定位未修。成因链：HMR 重载 → 顶层 `inject: ['agents']` 在 fiber inactive 时取服务失败 → `turn/end {kind:'error', message:'cannot get required service "agents" in inactive context'}` → `src/members.ts:476` 的 `agent/error` 监听器 → `src/members.ts:492` 的 `failMemberOpenAttempt` → **`task.status='failed'`**。⇒ 一次构建把一条正在干活的活判成工作失败。盘上 12 条任务带这个指纹（completed 10 / failed 1 / cancelled 1）。 |
| **steps**（inScope） | `src/members.ts`（`agent/error` 监听器：在 `failMemberOpenAttempt` **之前**加一道"这次失败是否与刚发生的重载同刻"的判定）· `src/hmr-trace.ts`（若需要，导出一次 `latestReloadAt`）|
| **invariant-reading**（acceptance） | ① 构造夹具：先写一条 `hmr-reloads.jsonl`（`at = now`、本进程 pid），再触发一条 message 含 `cannot get required service` 的 `agent/error` ⇒ 断言**任务仍是 `in_progress`**（不是 `failed`）且队长信箱收到一条**明说"infrastructure"**的消息；② 对照臂：**不写**重载记录、同样触发 `agent/error` ⇒ 断言任务**仍然是 `failed`**（证明这道豁免不是"把所有失败都放过"）；③ 窗长常量只有一处（`grep -c "HMR_FAILURE_WINDOW_MS" src/` = 定义 1 + 使用 1）；④ `pnpm test:gates` 的通过数**不下降**（对照 §6 基线 1590）。 |
| **stop-points**（verify） | `pnpm typecheck`；`node scripts/member-failure-tdd.mjs`；`node --test scripts/hmr-trace.test.mjs`；`pnpm test:gates` |

★ **明确不做的两件事（写进契约才挡得住）**：
1. **不新增 `FailureKindName` 枚举值**。加 `'infrastructure'` 要同时改 `src/types.ts:357`、`src/state.ts:316`、
   和 `scripts/gate-execution-history.test.mjs` 里逐字比对相等的那条臂 —— 而本步的根本动作是
   **"不落 failed"**，落不到 `failureKind` 那一格。⇒ 枚举值留到以后真的需要区分"已记录的基础设施失败"时再加。
2. **不修 `restart` 工具的措辞假相**。`src/tools/restart.ts` 的 description 逐字说
   "reload this plugin so subsequent calls run the code now on disk"，而 `src/hmr-trace.ts` 文件头实测
   **③ apply 不被重新执行**（宿主侧 `Registry.plugin/get` 用回调对象身份做键，本仓改不动）。
   ⇒ 这是**另一个缺陷**（"工具说了它做不到的事"），记录在案，本轮不改。

#### N4 实施记录（2026-10-20 落地）

**改了什么**（`git diff --stat`：4 文件、+411/−7）：

| 落点 | 内容 |
|---|---|
| `src/hmr-trace.ts` | `export const HMR_FAILURE_WINDOW_MS = 5_000`；`export function reloadJustBefore(stateRoot, at, pid?)` —— 复用既有的 `readHmrTrace(stateRoot, sincePid)`，不新写读盘逻辑 |
| `src/members.ts` | `function infrastructureFailureOf(stateRoot, failure)`；在 `failMemberOpenAttempt` 里、**落 `failed` 之前**插豁免分支 |
| `scripts/member-failure-tdd.mjs` | 夹具加两个动作（`writeReload` / `inactiveContext`）+ `terminal({failure})` + `kickOnFailure` 接缝；**+7 臂**（豁免 / 消息 / 三条对照 / 无痕迹 / 真实接线） |
| `scripts/hmr-trace.test.mjs` | **+2 臂**（窗口单边性与两侧；常量只有一处） |

★ **计划里的 steps 与实现的一处偏离**：steps 写"在 `agent/error` 监听器里、`failMemberOpenAttempt` **之前**"加判定，
实现在 `failMemberOpenAttempt` **内部**、三重相等校验之后。理由（已写进代码注释）：监听器手上只有
`readTeamSync` 的早期快照，而判定要用的 `task`/`attemptId` 是**锁内**才确定的；且豁免之后仍要
`writeTeam` 把成员置 idle ⇒ 与失败路径共用同一次持锁更少竞态。★ 不是"顺手改了位置"，
是**判据依赖的那个 `task` 只在锁内存在**。

**为什么窗口是 5 秒，而不是 1 秒或 60 秒**：实测四次 `inactive context` 距各自重载
**538 / 11 / 537 / 6 ms**，而同期两次 `empty_output` 距重载 **65 s / 91 s**。
一次 `pnpm build` 会连写好几个产物 ⇒ 那一批重载可能横跨一两秒 ⇒ 1 s 会把"这批里的第二次"判成窗口外；
60 s 会让开发时每十几秒一次的构建把**真的工作失败**成批算成基础设施故障。

**为什么判据不是"错误文本"而是"重载痕迹 + 时间窗"**：`message.includes('inactive context')` 判得出来但**判错** ——
`src/events.ts:71` 记的是**另一种**成因（回合本来就结束了、落盘已完成、只是回执读不到），
两种情形文本**逐字相同**而补救动作相反。⇒ 文本只当"这一类"的窄口，真正的判据是**重载真的发生过**。

**为什么豁免**不是"什么都不做"：那会把成员钉在 `working` 上，整队再也派发不到它。
豁免 = 任务保持打开（`attemptId` 不变 ⇒ capability 不变）+ 成员回 idle + 队长收到一条**明说
infrastructure 且点名哪一次重载、差多少毫秒、任务仍是什么状态**的消息。

★★★★ **改后读数（全部可复跑）**：

```
node scripts/member-failure-tdd.mjs        tests 17 / pass 17 / fail 0    （基线 10/10/0，+7 臂）
node --test scripts/hmr-trace.test.mjs     tests 12 / pass 12 / fail 0    （基线 10/10/0，+2 臂）
pnpm typecheck                             exit 0
pnpm test:gates                            tests 1660 / pass 1593 / fail 30   （基线 1590/33）
grep -rn HMR_FAILURE_WINDOW_MS src/        定义 1 处 + 使用 1 处
```

★★ `test:gates` 的 **pass 1590 → 1593、fail 33 → 30**：逐条比对失败集，
**没有新增失败**，消失的三条全在 `scripts/gate-stale-module.test.mjs`
（`臂 4 边界臂` / `臂 6 t34 出口臂` / `臂 1 对照臂`）—— 它们红是因为**`lib/` 落后于 `src/`**，
`pnpm build` 之后自己就绿了。★ 这不是 N4 的功劳，是"改前那次基线跑在旧 `lib/` 上"的读数误差。
**如实记在这里**，免得下一轮把它读成"性能和稳定性提升了"。

**四条定向突变（每条只改一处，确认对应臂真的会红）**：

| 突变 | 变红的臂 |
|---|---|
| `infrastructureFailureOf` 恒返回 `undefined`（豁免失效） | 豁免臂 + 消息臂（+1 条靠它才能过的） |
| 删掉 `if (at - entry.at > HMR_FAILURE_WINDOW_MS) continue`（窗口失效） | `hmr-trace` 臂 11 + `tdd` 窗口外对照臂 |
| `reloadJustBefore(root, now, pid)` → 不传 pid | "别的进程"对照臂 |
| 删掉 `if (!failure.message.includes('inactive context')) return` | "别的报错"对照臂 |

★ 四条各自被**不同的臂**抓到 —— 这不是"测试多"，是**每个突变都有一个专门的读数**。
一条臂抓到四个突变，与四条臂各抓一个，在"测试通过数"上同形，而在"下次改坏了知不知道"上完全不同。

★ **`pnpm verify` 仍然是 exit 1，与改前逐字相同**：22 个 stage 里 stage1 `scripts/verify.mjs`
的 8 条 FAIL（全是客户端 UI 契约臂，与服务端逻辑无关）把 `&&` 链挡在第一步。
N4 没有、也不该让这 8 条变绿。★ 但要注意：**因为链在第一步就断了，
`member-failure-tdd` 这一整条判据在 `pnpm verify` 里从来没被执行到** ——
它只在直接调它自己的时候跑。这是 §11 账外缺口的一条候选。

---

### N5 —— 「计划能不能开始跑」的门禁（用户 m01373 追加；**它回答的是"审查循环何时可以结束"**）

★★ 这一节是用户新加的，**不在 N0–N4 的原始范围里**，但它不是新功能 —— 它是把一张
**已经画好、零件齐全、唯独没装到机器上**的电路接上去。

#### N5.1 今天"开始跑"由谁把关：只有一个纯结构检查

```
$ for f in src/tools/create.ts src/tools/edit-plan.ts src/tools/approve.ts src/scheduler.ts src/tools/create-task.ts; do
    printf '%-28s %s\n' "$f" "$(grep -cE 'registry\.evaluate|wireDispatch|gateEvaluations|inputSurfaceOf' "$f")"
  done
src/tools/create.ts          0
src/tools/edit-plan.ts       0
src/tools/approve.ts         0
src/scheduler.ts             0
src/tools/create-task.ts     8   ← 全仓唯一的判据接线处
```

```
$ grep -rn "wireDispatch(" src/
src/tools/create-task.ts:912:    const dispatchGates = wireDispatch({
```

⇒ ★★ **判据只挂在 `create_task`（单条任务）上；计划那条路（`create` → `edit_plan` →
`approve` → `scheduler.kickTeam`）一处 `registry.evaluate` 都没有。**
而 `approve` 今天唯一的机械门是 `validateStagedGraph(fresh, true)`（`src/tools.ts:496`），
它只查：成员非空、任务非空、`subject` 非空、`assignee` 是活跃成员或 `CAPTAIN_KEY`、
依赖不自指、DFS 无环。
**⇒ 它不查"审没审过"、不查分档、不查四问、不查轮次。**

```
$ grep -rn "evaluate('admission'" src/
（零命中，exit 1）
```

```
$ grep -rn "planReviewRound\|planReviewRounds" src/
（零命中）
```

⇒ ★★★ **"计划审查循环能不能结束"今天没有任何机械答案**：`planReviewState` 只有
`'awaiting_review'` / `'awaiting_feedback'` 两态，`edit_plan` 每动一次就把它打回
`'awaiting_review'`（`src/tools.ts:2076`），**没有计数、没有上限、没有 escalate**。

#### N5.2 对照：质量环有"能不能结束"，而且已经接线

| | 质量环（已有） | 计划审查链（缺口） |
|---|---|---|
| 轮次上限 | `codeMaxRounds:3` / `requirementsMaxRounds:4` / `maxRepairAttempts:2` | **无** |
| 达上限动作 | `planQualityFollowUp` ⇒ `{escalated:true, status:'escalated'}` | **无** |
| 可读的循环态 | `describeQualityLoop` 五态 `running`/`halted`/`escalated`/`deliverable`/`blocked` | **无** |
| 接到 status / delivery | `src/tools/status.ts:1071`、`src/tools/delivery.ts:194` | ★ **半接**：`phase` 在 `status.ts:1076` 有，`planReviewState` **零命中**（见 N5.13） |

```
$ grep -rn "describeQualityLoop" src/ | grep -v "^src/quality-gates.ts"
src/tools/status.ts:1071:  const loop = describeQualityLoop(team)
src/tools/delivery.ts:194:  const loop = describeQualityLoop(team)
src/state.ts:51:export { describeQualityLoop }
```

⇒ ★ 结论：**"循环何时可以结束"这个模式在本仓已经想清楚并跑通过一次（质量环），
计划审查链缺的不是设计，是同一条设计的搬运。**

#### N5.3 三道"看起来是门禁、实测都不是"的候选

| 候选 | 它真的拦什么 | 为什么不等于门禁 |
|---|---|---|
| `validateStagedGraph` | 图结构合法性 | 与"审没审过"无关；一条完全没审的计划只要图合法就过 |
| `reviewStateOf`（`friction-triage.mjs:1190`）| 只区分"有没有 `reviewed` 这一格" | ★ 探针实测：`reviewed` 内含 **fail**、含 **unmeasured**、甚至**形状坏**，**全判 `reviewed`** ⇒ "审了而没过"与"审过了"同形 |
| `admission.convene` | 理论上是"成团前四条件"（产物非空 / 无未审改动 / 无待确认问题 / 吸收成立）| ★ **零生产求值点**；且 `appliesTo` 恒 `true`，而它 `requires = ['producedDocuments','upstream']`，两格在全仓**没有任何生产写入方** |

```
$ grep -rn "producedDocuments\|openQuestions" src/ --include=*.ts | grep -v "src/gates/admission/"
（零命中）
$ grep -rn "upstream" src/ --include=*.ts | grep -v "src/gates/admission/"
（只命中 quality-gates.ts 里一个同名局部变量与注释，没有任何"组装 admission upstream"的代码）
```

#### N5.4 一条实测的陷阱：直接把 `evaluate('admission')` 接到 approve，会让**每一次**批准都落 `ok:false`

```
$ node --input-type=module -e "const {registry}=await import('./lib/gates/index.js');
    console.log(JSON.stringify(await registry.evaluate('admission', {}), null, 1))"
ok = false
blockers = []
unmeasured = "[admission.convene] the verdicts of the gates that must run before a team can convene
  (the review checkpoint and the absorption check) were not provided, so \"has the loop run long enough\"
  could not be measured — this is \"not measured\", not \"the loop is done\""
ran = [{admission.absorb: skipped}, {admission.checkpoint: skipped}, {admission.convene: unmeasured}]
```

★ 成因：`convene` 的 `appliesTo` **恒 `true`**（`export function appliesTo(_ctx) { return true }`，
并由夹具 `scripts/gate-admission-convene.test.mjs:577` 的"臂 3c"钉死 ——
理由是"成团检查不许在某个 kind 上静默消失"）。
而 `absorb` / `checkpoint` 的 `appliesTo` 在 approve 时刻**都为假**（没有 `absorb.claims`、
没有 `documents` 数组）⇒ 它们落 `skipped`，于是 `upstream` 里根本没有 `admission.checkpoint` /
`admission.absorb` 这两个键 ⇒ `convene` 判"没能测量"。

⇒ ★★★ **所以 N5 不是"把 admission 接上"这么一句话。** 它必须先回答：
**approve 那一刻，`upstream` 和 `producedDocuments` 从哪里来？**
而它们今天**全仓没有生产写入方**。

#### N5.5 第二道结构性障碍：计划路线上，一条任务都带不上 `reviewed`

```
$ grep -c "reviewed" src/tools/amend-task.ts
0
$ grep -rn "reviewed" src/tools/edit-plan.ts
（零命中）
```

- `src/tools/create.ts` 的 `plan.tasks` schema 有 `kind/objective/acceptance/verify/inScope/`
  `outOfScope/deliverables/nonGoals/coverageOf/round/reviewedTaskId/model/reasoning_effort`，
  ★ **没有 `reviewed`**（`src/tools/create-task.ts:276` 的单任务 schema **有**）。
- `TaskDraft`（`src/tools/shared/entities.ts`）**刻意没有 `reviewed`**，注释逐字：
  "t9（P2c）的 acc4 要求 `reviewed` 的透传链「四处都在」且「单文件」，
  所以落盘那一步留在 `src/tools/create-task.ts` 里，不经过本接口。"
- `StagedPlanMutation` 的 `add_task` 只有 `{subject, description?, assignee?, dependencies}`，
  `src/tools.ts:2049` 把它的 `kind` **硬编码成 `'work'`**。

⇒ ★★ 即使把 `dispatch.plan-reviewed` 接到计划路线上，它也会**拦下全部任务** ——
因为计划路线造出来的任务**结构上不可能带 `reviewed`**，而那条判据的 `requires` 正是
`['task.reviewed']`。

#### N5.6 门禁应该长什么样（三层，顺序不可颠倒）

> ★★ **本图是 N5 的第一版设计。它的第二层（分档 + `reviewed` 戳）已被对抗性审查推翻 ——
> 见下面 `N5.6-bis` 与 `N5.17`。三层的顺序（图结构 → 审没审过 → 环能不能停）仍然成立，
> 但第二层的**判据内容**换掉了。读这一段的人请直接看 `N5.6-bis`。**

```
approve 时刻的三道闸（前两道已有零件，第三道要造）
  ① validateStagedGraph(fresh, true)        ← 已有：图结构合法
  ② 分档：每一条任务 tierOf(contract)       ← ★ 见 N5.6-bis：这一层被判据本身的方向问题推翻
       small        ⇒ 允许
       large        ⇒ ★ 必须显式带 reviewed 戳 + 人这次批准点名了它
       unmeasurable ⇒ ★ 【已作废】原稿写"拒绝"，与 N5.11 的实测口径相反，见 N5.6-bis
  ③ 循环终止：planReviewRounds(fresh)        ← 造：与质量环**同形但不同位**
       rounds >= planReviewMaxRounds ⇒ ★ 打【本队自己的】planReviewEscalated
       ★★ 绝不许复用 `team.escalated` —— 实测它全仓没有清除点（见 N5.14）
```

#### N5.6-bis ★★ 第二层被推翻的理由（对抗性审查实测，2026-10-20）

★ **上面那张图与下面这张表，是同一个判据的两次口径。上一版把它们并列放着，
实现者按任何一套做都能声称"照文档实现了"。现在只保留这一套。**

| 读数（实测复跑） | 结果 | 说明 |
|---|---|---|
| `inScope: undefined` | `unmeasurable` | 没说改什么 |
| `inScope: []` | `unmeasurable` | 同上 |
| `inScope: ['src/']` | **`small`** | ★ 生成器占位值反而免检 |
| `inScope: ['src/tools.ts']` | `small` | 一个文件 |
| `inScope: ['src/tools.ts','src/types.ts']` | **`large`** | ★ **诚实写清 2 个文件 ⇒ 被拦** |
| `inScope: [两个 scripts/*.mjs]` | **`small`** | ★ `tierSourceFiles` 只数 `^src/` |
| `inScope: ['src/tools.ts','lib/tools.js','lib/types/tools.d.ts']` | **`small`** | ★ 一个 src + 两个产物 ⇒ small |

★ 成因（`scripts/friction-triage.mjs:1522-1536` 逐字）：
```js
function tierSourceFiles(inScope) { return inScope.filter((path) => /^src\//.test(path) && !DIRECTORY_ENTRY.test(path)) }
multipleFiles: files.length >= 2
```
⇒ **数的是"声明了几个 `src/` 文件"，不是"要干多少活"。**

★★★ 于是这条门禁在两个方向上都不产生信息：
- **奖励"少写"**：不写 `inScope`、写 `['src/']`、写空、只写一个文件 —— 全部免检；
  而本仓最常见的真实交付是"一个 src + 一两个 lib 产物"，那永远是 `small`。
- **惩罚"写清楚"**：唯一会被拦的，是**老实声明了 2 个以上 `src/` 文件**的计划 ——
  包括这份计划自己（N1–N5 全 `large`）。
- **而它要拦的那块可以自己挪开**：`amend_task` 是唯一能改 `inScope` 的工具，
  在 staged 团队上**没有 phase 闸、也不计数**（见 N5.12 补充）⇒
  把 8 项缩到 3 项（`tier` 从 `large` 变 `small`）之后 `approve` 照样成功。

★ **结论：第二层砍掉。** 理由不是"太严"，是**它的判据方向是反的**——
一个奖励少写、惩罚写清、且能被被审方自己缩域绕过的闸，装上去只会让人学会少写 `inScope`。
★ 保留的替代（一句话、不依赖 `scripts/`、改的是结构上不可审查的那条路）：
**`edit_plan` 的 `add_task` 不许静默造 `kind:'work'`**（`src/tools.ts:2049` 硬编码），
要求调用方显式声明或给契约 —— 那才是"这活根本没被人看过"的真正入口。

★ **第二道闸为什么不复用 `dispatch.plan-reviewed`**：那条判据挂在 `dispatch` 点上，
而 `dispatch` 点的语义是"派发那一刻"，今天唯一的接线处是 `create_task`。
把它挪到 `admission` 会改它的插入点（`scripts/gate-admission-point.test.mjs:190` 把
admission 正好三条 id **写死**了）。⇒ 正确做法是**新增一条 `admission.plan-gate`**，
或者在 `approveStagedTeam` 里**直接调**分档 + 四问（不进注册表）。
★ **推荐后者** —— 理由：`admission` 的三条判据今天零生产求值点，而 `convene` 的
`requires` 依赖的两格没有生产写入方（N5.4）；把 N5 做成第四条判据，会让
"approve 现在要么全不过、要么绕过两条"这种半接状态更难看。**直接在 approve 里调，
读数直接挂在返回值与 error message 上**，与 `validateStagedGraph` 同层。

★ **第二道闸的判据内容**（三态，不许并成布尔）：

| 读数 | 来源 | 三态 | 现状 |
|---|---|---|---|
| 分档 | `tierOf(contract, {exists})` | `small` / `large` / `unmeasurable` | ★ **已砍**（方向反，见上表） |
| 四问 | `checkPlanReview(tasks)` | `present` / `missing` / `unmeasured` | ★ 保留为**读数**，不作闸（见 N5.17-③） |
| 五问 | `adversarialReview(contract)` | `passed` / `rejected` / `needs-review` | ★ 保留为**读数**，不作闸 |

★ **放行条件**（★★ 第一版写成"每条任务 tier 必须是 small"，已被 N5.11 的实测推翻 ——
历史 6 个团队 0 个通过。第二版写成"large 无戳才拦"，已被对抗性审查推翻 —— 见上表）：

```
放行 ⟺ ① 图结构合法
        ② 不存在【未显式声明契约】的任务（add_task 静默造 kind:'work' 这一条）
        ③ planReviewRounds < planReviewMaxRounds 或已被显式归零
★ 分档与两套问题集【只做读数，不做闸】——它们的产出进 describePlanLoop.reason。
```

★ 任何一格 `unmeasured` **不拦**（"没说改哪里"不是"改得很大"），但**必须点名** ——
`describePlanLoop.reason` 里要逐条写出"N 条任务的表面读不出来"，不许静默并进"通过"。
★ 详细读数与两种口径的通过率见 **N5.11**。

#### N5.7 设计上的三个岔路，取舍与理由

**岔路 1：门禁住在 `src/` 还是 `scripts/`？⇒ 必须住在 `src/`。**

```
$ node -e "const p=require('./package.json');
    console.log(['scripts/plan-review-check.mjs','scripts/plan-review-tier.mjs','scripts/friction-triage.mjs']
      .map(f=>f+' => '+(p.files.includes(f)?'SHIPPED':'NOT SHIPPED')).join('\n'))"
scripts/plan-review-check.mjs => NOT SHIPPED
scripts/plan-review-tier.mjs  => NOT SHIPPED
scripts/friction-triage.mjs   => SHIPPED
```

⇒ ★★ `plan-review-check.mjs` 与 `plan-review-tier.mjs` **都不在发布白名单里**。
门禁若只调它们，**装了插件的人拿不到** —— 它会在作者本机通过、在用户机器上不存在。

**岔路 2：把审查逻辑从 `scripts/` 搬进 `src/`，还是 `src/` 反向 import `scripts/`？**
⇒ **搬进 `src/`**。

```
$ grep -rn "from '.*scripts/" src/ --include=*.ts
（零命中）
```

⇒ `src/` **从不** import `scripts/`（单向：scripts 依赖 lib，lib 不依赖 scripts）。
打破这条单向依赖会让 `tsconfig.json` 的 `rootDir: src` 编译失败，或把 `scripts/` 拖进构建产物。

★ **但这里有一个真实的取舍**：把 `checkPlanReview` / `tierOf` 的逻辑复制进 `src/`
会产生**两份真值**（本仓记账最久的缺陷形状）。
⇒ **正确做法是"源码只有一份，位置在 `src/`，`scripts/` 的那两份改成从 `lib/` 再导出"**
（`scripts/*.test.mjs` 已经这样 import `../lib/*.js`，先例在 `scripts/capabilities.test.mjs:11-15`）。
★★ 而 `scripts/plan-review-check.mjs` 是 **NOT SHIPPED** 的 ⇒ 理论上把它改成薄壳不破坏任何已发布契约。
★ **但本文档不做这一步**（审查后改的，见 §12 第 22 条）：薄壳的前提是 `lib/` 里先有产物，而 `ls lib/ | grep -i plan` **零命中**；且 `checkPlanReview` 与 `tierOf` 分别在**两个** scripts 文件里，搬进 `src/` 要新开一个 src 文件 —— 那个文件**不在任何一条 N 的 inScope 里**。⇒ 本轮 N5 **只读**它，不改它。G3 因此仍留在 §11 账外（只是"账外"的原因改成"搬进 src 需要新列 inScope"）。

**岔路 3：approve 时机 vs 每条任务 create 时机？⇒ 必须在 approve。**

- 在 `create` / `add_task` 时判，会把一条本来就该"先铺图、再逐条审"的计划链切断：
  `staged` 的全部意义就是"还没跑，先让人看"。
- 在 `scheduler.kickTeam` 时判太晚：那时 `phase` 已是 `running`，
  `planReviewState` 已被 `delete`（`src/tools.ts:2166`），**审查上下文已经丢了**。

⇒ **`approveStagedTeam` 是唯一既"计划完整可见"又"还没开始跑"的时刻。**

#### N5.8 第三层：让"循环能不能结束"有一个可读的答案

与 `describeQualityLoop` 同形，新增：

```ts
export type PlanLoopState = 'halted' | 'awaiting-review' | 'reviewing' | 'escalated' | 'approved'
export interface PlanLoopSnapshot {
  state: PlanLoopState
  rounds: number                 // ★ 今天不存在这一格
  maxRounds: number              // ★ 模块常量，**不从 reviewPolicy 取**（见 N5.15）
  reason: string                 // 逐字说清"为什么还不能结束"
}
export function describePlanLoop(team: TeamState): PlanLoopSnapshot
```

★ **关于"五态是不是过度设计"的一处审查意见，我的取舍是保留五态、但把理由写清**
（审查建议砍成 `{rounds, maxRounds, reason, canEnd}` 并让调用方自己拼 `phase` + `planReviewState`）：

- 五态里**三个**确实是既有字段的重新命名（`halted` ← `team.halted`；`reviewing` / `awaiting-review`
  ← `planReviewState` 两值；`approved` ← `phase === 'running'`）。**这一半批评成立。**
- ★ 但**保留它**的理由是**判定顺序**：`halted` 必须先于 `approved`（见下），
  而"先于"这件事**只有把判定收进一个函数才有一个地方可以写**。
  若把 `state` 拆回调用方拼，那个顺序会在每个调用点各写一遍 —— 而这正是本仓
  `describeQualityLoop` 把 `halted` 放第一个 `if`（`quality-gates.ts:2739`）所避免的形态。
- ★ 另一半批评**不成立**：`escalated` **不是**既有字段的重命名 —— 它读
  `planReviewEscalated`（见 N5.14）或从 `rounds >= maxRounds` **算出来**，
  两条路径都不存在于今天的任何字段。⇒ 五态里至少有一态是**新信息**。
- ⇒ 结论：**保留五态，但 `reason` 必须逐字说清"为什么还不能结束"**，
  这样即使调用方只用 `canEnd`（= `state === 'approved'`），它拿到的也是一个可读的否定答案。
  `reason` 是这一层真正的产出，`state` 只是它的索引。

判定顺序（★★ **第二版** —— 第一版把 `approved` 放在两个 `escalated` 之前，
被对抗性审查 B4/S6 推翻，见 `N5.17`）：

```
team.halted === true                    ⇒ 'halted'      ★ 最前：staged 团队也能被 halt
team.planReviewEscalated === true       ⇒ 'escalated'   ★ 本队自己的位，不是 team.escalated
team.planReviewRounds >= maxRounds      ⇒ 'escalated'   ★ 读时也要能算出来（存量团队没有那位）
team.phase === 'running'                ⇒ 'approved'    ★★ 必须在这两条【之后】
planReviewState === 'awaiting_feedback' ⇒ 'reviewing'
否则                                     ⇒ 'awaiting-review'
```

★★★ **为什么 `approved` 必须排到两个 `escalated` 之后**（审查者复跑，我确认）：

```
{phase:'staged',  rounds:4, planReviewEscalated:true} ⇒ 'escalated'
{phase:'running', rounds:4, planReviewEscalated:true} ⇒ 'approved'    ← ★ 第一版就是这个结果
```

对一个正在跑的团队，`rounds=4 > max=3` 与 `rounds=0` **读出同一个 `approved`** ⇒
**"这个循环审到顶了没有"这条读数，恰恰在批准之后不可读** ——
而用户问的就是"这个循环能不能结束"。⇒ 上限必须在**放行之前**就拦住（acceptance ⑪），
而不是等它跑起来之后被 `phase` 遮掉。

★ 副作用（**必须承认的设计后果**）：这样一来，一个 `rounds >= max` 的 running 团队会读成
`escalated`，而它其实已经在跑。这不是错 —— 那是**"它当初是被放行的，而放行点上没有读上限"**
的如实记录。修法不在读侧（读侧若也遮掉，那个历史就查不出来了），在放行点（acceptance ⑪）。

★★ **第三行必须是 `planReviewEscalated` 而不是 `team.escalated`**（见 N5.14）：
`team.escalated` 是**质量环**的位，全仓只有一个写入点（`entities.ts:5672`）且**没有清除点**
（`resume` 只清 `halted`）。若 `describePlanLoop` 读它，那么一个质量环早已敲响的团队
会被计划环读成"计划审到顶了" —— **两件不同的事合流成同一个字**（违反 §N5.7 那条三态纪律）。
⇒ 计划环读自己的位，质量环读自己的位，`describePlanLoop` 与 `describeQualityLoop`
**只有形状相同，输入互不引用**。

★★ **`halted` 必须排在 `approved` 之前，这不是形式主义**（本文档第一版漏了这一格）：
`haltTeamWork`（`src/tools.ts:538`）**不要求 `phase === 'running'`** —— 它只查
`requireFreshCaptainTeam`，然后把 `fresh.halted = true`（`:566`）。
⇒ 一个 **staged 团队也可以被 halt**，而 `approveStagedTeam` 不查 `halted`。
⇒ 若 `describePlanLoop` 把 `phase === 'running'` 判在最前，**一个被停止的团队会被读成 `approved`**。
⇒ 这正是 `describeQualityLoop` 把 `team.halted === true` 放在**第一个 if** 的理由
（`src/quality-gates.ts:2739`），本设计必须与它同序 —— 否则 §N5.2 那张"搬运同一条设计"的表是假的。

★ **要新增的三格**：`TeamState.planReviewRounds?: number`（`edit_plan` 每动一次 +1）、
`TeamState.planReviewEscalated?: true`（见 N5.14），
与 `TeamState.planReviewMaxRounds?: number`（★ **模块常量缺省 3，不从 `reviewPolicy` 取** ——
见 N5.15：`ReviewPolicy` 是四处封闭的五格，加第六格会被 `profiles.ts:1073` 直接抛错，
而那会把 N5 的写域扩到 `profiles.ts` / `index.ts` / `state.ts` 三个不在 inScope 里的文件）。

#### N5.9 与 N0–N4 的关系

| | 内容 | 依赖 | 分档 | 为什么这个位置 |
|---|---|---|---|---|
| **N5** | 计划门禁：approve 时刻查分档 + 四问 + 轮次上限 | **N3**（N3 把分档与四问读数**变成可读的**，N5 才有一个东西可查）| **large**（≥4 个 `src/` 文件）| 它是 N3 的**消费者**：N3 造读数，N5 用读数。★ 顺序反了会造出一个"查一个不存在的东西"的门 |

★ **N5 不进 N0–N4 的自动派发**：它是**用户明确追加的一项**，且它直接决定"以后所有计划能不能跑"
—— 是本轮里唯一一个**改变未来派发规则**的步骤。⇒ 它必须由人裁决，**不许自动派发**
（这与 §3 对 N1–N5 的处置一致：五步全 large，都不自动派发）。

★ **诚实限制**：N5 落地后，**第一批被它拦下的计划就是这个计划自己**（N1–N4 全 large）。
这不是缺陷 —— `docs/PLAN-REVIEW.md` §8 的准入三步（to-dispatch / reviewed / 小档）
本来就写着"大活 ⇒ 留下来问用户 ⇒ 用户裁决"。
⇒ **N5 的第一个验收读数应当是"它拦住了 N1–N4，并把理由逐条说了出来"**，
而不是"它放行了我自己的计划"。

#### N5.10 四项必答（用 `checkPlanReview` 自己的口径）

| 问 | 答案 |
|---|---|
| **why-now** | 用户 m01373 逐字："计划是否能开始跑也是希望有一个门禁把关，其实就是计划的审查循环是否可以结束的问题"。实测今天**没有任何机械答案**：\`planReviewRounds\` 零命中、\`approve\` 零判据求值、\`reviewStateOf\` 不读 checks。 |
| **steps**（inScope） | `src/quality-gates.ts`（新增 `describePlanLoop` + `planReviewRounds` 递增，与 `describeQualityLoop` 同文件同形）· `src/tools.ts`（`approveStagedTeam` 内加第二、三道闸；`edit_plan` 分支 `:2076` 加计数）· `src/types.ts`（`TeamState` 两格 + `PlanLoopSnapshot`）· `src/tools/status.ts`（把 `describePlanLoop` 投进 status，与 `describeQualityLoop` 同一条路）· `src/tools/approve.ts`（把 `confirmation` 传进门禁，见 N5.16）|
| **invariant-reading**（acceptance） | ① **正向**：一份只含 `small` 任务的 staged 计划 ⇒ `agent_teams_approve` 返回 `ok:true`（★ 这是反向半边，必须先绿 —— 否则下面五条"拦住了"与"全拦住了"同形）；② **拦截**：在 ① 的同一份计划里加一条 `tier==='large'` 且无 `reviewed` 戳的任务 ⇒ `ok:false`，报错**逐条**列出该条的 `tier` 与 `whyLarge`；③ **戳放行**：给 ② 那条 large 任务补一个 `reviewed` 戳 ⇒ `ok:true`（★ 证明闸门问的是"有没有人看过"，不是"活大不大"）。★★ 补戳的路径**必须是产品路径** —— 第一版没写清，而计划路线造不出戳（N5.5）：可用 `create_task`（它在 staged 上无 phase 闸，实测 `grep -c phase src/tools/create-task.ts` = 0，技术上可行）；★ 若改用"手写 team.json 构造"，那条读数就是**夹具专供**的，不算数；④ **unmeasurable 不拦但点名**：加一条 `inScope` 缺失的 `review` 任务 ⇒ `ok:true`，但 `describePlanLoop(team).reason` 里**逐字出现**"1 条任务的表面读不出来"（★ 三态不许同形：放行 ≠ 通过）；⑤ `planReviewRounds` 在 `edit_plan` 每调一次后 **+1**（读数：连调 3 次后 `rounds === 3`，**不是 3 次操作 = 3** —— 一次调用含多个 operation 仍算 1 轮，理由见 N5.12）；⑥ 第 `maxRounds+1` 次 `edit_plan` 后 `escalated:true` 且 `describePlanLoop(team).state === 'escalated'`；⑦ `agent_teams_status` 输出里出现 `planLoop` 一节含 `{state, rounds, maxRounds, reason}` 四格；⑧ ★ **halted 优先**：对 ③ 那份计划调 `halt` 后再读 `describePlanLoop` ⇒ `state === 'halted'`，**不是** `'approved'`（★ 负向对照，专防 N5.8 那个"halted 排在 approved 之后"的错序） |
| **stop-points**（verify） | `pnpm typecheck`；`node --test scripts/plan-review-tier.test.mjs scripts/quality-gates-tdd.mjs`；`pnpm test:gates`（pass ≥1590 不许掉）；`curl -s http://127.0.0.1:49318/plugins/dsh-agent-teams/state`（真宿主探针） |

★★ **一条必须写清的读数陷阱（这一格我第一版写错了）**：第一版我写"全仓没有一个
staged 团队同时带 4 条 large 任务的夹具 ⇒ N5 必须新建"。
实测有 half 是错的：

```
$ grep -rn "approveStagedTeam" scripts/*.mjs scripts/*.test.mjs
（零命中 —— 没有任何夹具直呼这个函数名）
$ grep -n "agent_teams_approve" scripts/lifecycle-verify.mjs
923:  const approvedDynamic = await call('agent_teams_approve', { confirmation: 'user clicked Approve & Run' })
1691:    await call('agent_teams_approve', { confirmation: 'user clicked Approve & Run' })
1800:  await call('agent_teams_approve', { confirmation: 'Run the accepted batch' })
```

⇒ ★ **approve 的真路径在 `scripts/lifecycle-verify.mjs` 里已经被跑通了三次**（走的是
`call('agent_teams_approve', …)` 的工具入口，不是直呼函数）。
⇒ 所以 N5 **不需要从零造夹具**：复用 `lifecycle-verify.mjs` 那条 `call(...)` 骨架，
把它的计划换成"全 large"与"全 small"两份即可。
★ 但**反向半边仍然必须新建**：现成的三条 approve 计划**都不是全 large**
（它们是小改动），所以"全 large 被拒"这条今天**没有任何夹具覆盖** —— 那一点第一版没说错。

★ **改前必须先确认的一件事**：`lifecycle-verify.mjs` 现在**红着**（见 §6 基线：
`stage5 lifecycle-verify exit=1`，根因是 `ENOTEMPTY rmdir …/.agent-teams/frictions`）。
⇒ N5 若要在它上面加臂，**先得让那个红停下**，否则"新臂通过"与"文件根本跑不到那一步"
会读成同一件事。★ 这正是 `pnpm verify` stage 1 就红导致的连锁：**22 个 stage 里后 21 个从未被执行过。**

#### N5.11 ★★★ 一次会改写 N5 设计的实测：历史通过率

★★ 这一节是本文档**第一版 N5 设计被自己的读数推翻**的记录。它比 N5.1–N5.10 都重要，
因为前十个问题都是"这个门怎么造"，而这一节问的是"这个门造出来会不会挡死所有人"。

**做法**：拿仓里**真实跑过的历史团队**（`.agent-teams/*/team.json`，6 个有任务的团队、
共 224 条任务）套用两种放行口径，看历史通过率。

```
$ node --input-type=module -e "
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const ft = await import('./scripts/friction-triage.mjs')
let teams = 0, allSmall = 0, passB = 0, passC = 0
for (const d of readdirSync('.agent-teams')) {
  const p = join('.agent-teams', d, 'team.json')
  if (!existsSync(p)) continue
  let t; try { t = JSON.parse(readFileSync(p, 'utf8')) } catch { continue }
  const tasks = t.tasks ?? []
  if (tasks.length === 0) continue
  teams++
  const tiers = tasks.map(x => ft.tierOf(x, { exists: existsSync }).tier)
  if (tiers.every(x => x === 'small')) allSmall++
  if (!tasks.some((x, i) => tiers[i] === 'large' && !x.reviewed)) passB++
  if (!tasks.some((x, i) => tiers[i] === 'large' && !x.reviewed) && !tiers.some(x => x === 'unmeasurable')) passC++
}
console.log('teams', teams, '| allSmall', allSmall, '| 口径B', passB, '| 口径C', passC)
"
```

实测输出：

```
teams 6 | allSmall 0 | 口径B 1 | 口径C 0
```

逐团队（`tier` 直方图 + 拦截原因）：

```
agent-teams-hardening              {unmeasurable:1, large:24, small:14}   BLOCK  large-unreviewed=24, unmeasurable=1
agent-teams-refactor               {small:61, unmeasurable:10, large:35}  BLOCK  large-unreviewed=3,  unmeasurable=10
mutation-cost                      {large:3}                             BLOCK  large-unreviewed=3,  unmeasurable=0
mutation-quality                   {large:10, unmeasurable:9, small:5}    BLOCK  large-unreviewed=2,  unmeasurable=9
overnight-registration-hardening   {large:2, small:5, unmeasurable:3}     PASS   large-unreviewed=0,  unmeasurable=3
unified-pipeline                   {small:34, large:8}                    BLOCK  large-unreviewed=6,  unmeasurable=0
```

| 口径 | 放行条件 | 历史通过率 |
|---|---|---|
| **A（第一版设计）** | **全部**任务 `tier === 'small'` | **0 / 6** |
| **B** | `large` 且无 `reviewed` 戳 ⇒ 拦；`small` 免；`unmeasurable` 放行 | **1 / 6** |
| **C** | B + `unmeasurable` 也拦 | **0 / 6** |

★★★ **结论：第一版设计的放行条件（口径 A）在真实历史上通过率是 0%。**
如果照第一版落地，**这个插件过去跑通的每一个团队都会被它挡在门外** ——
包括本文档自己在 §5 读到的那份 `all 24 answers are present`。
"全部 small" 在一个真实的多人团队里几乎不可能成立：**只要有 review / integration /
repair 这类任务，`inScope` 就是多文件或缺失**，而 `tierOf` 把它们判成 `large` / `unmeasurable`。

**为什么 `unmeasurable` 那么多（23/224）**，实测分布：

```
$ node --input-type=module -e "…按 kind 统计 inScope 的有无/条数…"
kind => { inScope 状态: 计数 }
  implementation => {"1":2, "2":13, "3":13, …, "40":1}
  review         => {"1":7, "5":1, "absent":20}     ← ★ 20/28 的 review 任务根本没有 inScope
  work           => {"1":19, "2":4, "3":5, "10":1, "11":1, "absent":2}
  verification   => {"1":2, "2":2}
  integration    => {"1":2, "4":1, "9":2}
  repair         => {"1":5, "2":3, …, "18":1}
```

⇒ ★★ **`review` 任务天然是"读文件、不改文件"**，所以它**没有 inScope 是正常的**，
而 `tierOf` 对"没有 inScope"的判决是 `unmeasurable`（`scripts/friction-triage.mjs:1522-1528`，
注释逐字 "the contract carries no inScope, so its surface cannot be read at all"）。
⇒ **把 `unmeasurable` 当"不放行"（口径 C）等于要求每个团队都得给 review 任务编一个
假的 inScope** —— 那会逼出一种"为了让闸门过而写下的假写域"，比没有闸门更坏。

★★ **所以 N5 的放行条件必须改成口径 B 的加强版**：

```
放行 ⟺ 不存在「tier === 'large' 且没有 reviewed 戳」的任务
       （small 免；unmeasurable 免但**在 status 里单独计数**，不并入"通过"）
```

★ **为什么 `unmeasurable` 免而不拦**：它是"没说改哪里"，不是"改得很大"。
把它拦掉会逼出假写域；把它**静默并进通过**又会丢掉三态（违反 REQUIREMENTS 的"三态不许同形"）。
⇒ 正确处置是**放行但在 `describePlanLoop.reason` 里逐条点名**："N 条任务的表面读不出来"。

★ **`reviewed` 戳在真实历史里是有的**（这条实测推翻了"计划路线造不出 reviewed"的悲观推论）：

```
$ node --input-type=module -e "…统计 team.json 里的 task.reviewed…"
历史任务 224 条；带 reviewed 戳的 115 条（51%）
  agent-teams-refactor  t11/t17/t25/t26/t42 review、t50/t52/t54… implementation、t30/t41/t44 repair
  mutation-quality      t2/t4/t6/t8/t19/t20 review、t21 repair、t22/t23 integration
  overnight-registration-hardening  t6/t7/t8 review、t9 integration
  unified-pipeline      t39/t40/t43 implementation
```

⇒ ★★ 但注意**写入方只有一处**：`src/tools/create-task.ts:583`（`reviewed: input.reviewed`）
与 `:791`（`...input.reviewed === undefined ? {} : { reviewed: input.reviewed }`）。
而**计划路线**（`create` 的 `plan.tasks` / `edit_plan` 的 `add_task`）**没有这一格**。
⇒ 所以这 115 条戳**全部来自 `create_task` 这条路径**，不是计划路线 ——
本文档 N5.5 的结论（"计划路线造不出 reviewed"）**仍然成立**，
但"历史上有 51% 的任务带戳"说明**戳不是稀有物**，N5 不必从零发明写戳者。

★★★ **这条实测对 N5 的最终结论**：

1. **第二层闸的判据从"全部 small"改成"不存在未审的大档"**（口径 B）。
2. **`unmeasurable` 放行但单独点名**，不并入通过、不逼假写域。
3. **历史读数证明口径 B 仍然只有 1/6 通过率** —— 这不是缺陷，而是
   `docs/PLAN-REVIEW.md` §8 说的"大活留下来问用户"的**真实成本**：
   过去五个团队里确实有大量未审的大档任务被派出去过。
   ⇒ 但也说明：**N5 落地当天会让一批正在进行的团队无法新增计划**。
   ⇒ 必须给它一条**逃生口**，否则它会变成"上线即瘫痪"。
4. **逃生口的正确形状**（而不是把闸门关掉）：`agent_teams_approve` 接受
   `confirmation` 里的显式点名词，例如 `'approved large: t12,t15 by user'`
   ⇒ 人替那几条大档任务承担裁决，`describePlanLoop.reason` 记下"这几条是人点名的"。
   ★ 这与闸门的语义一致：**它拦的是"没人看过就走"，不是"大活不许做"**。

★ **一处必须诚实交代的局限**：上面的 224 条历史任务是**跨多个团队、多个批次**的，
其中 `agent-teams-refactor` 那 61 条 small 很可能来自同一轮小步迭代。
⇒ 6 个团队的样本量不足以估计"一般计划的通过率"，但**足以证伪"全部 small"这个口径** ——
因为 0/6 是**上界为零**，样本再小也推不翻它。

#### N5.12 轮次计数的三个漏洞与一个绕行口（评审前自查）

★★ 这一节是把"\\+1 就完了"这个直觉拆开检查的结果。三个漏洞都**有代码证据**，
且其中第二个会让整个上限形同虚设。

**漏洞 1：一次 `edit_plan` 可以含多个 operation —— 算 1 还是算 N？**

```
$ grep -n "operations" src/tools/edit-plan.ts | head -3
$ sed -n '2030,2080p' src/tools.ts | grep -n "for (const"
```

`edit_plan` 的入参是 `operations: StagedPlanMutation[]`（数组），`src/tools.ts` 在
`withTeamLock` 内**循环**应用每一条。
⇒ ★ **口径：+1 per `edit_plan` 调用，不是 per operation。**
理由：用户/队长的一次"我改一下计划"在语义上是**一轮反馈**，哪怕它同时改了 5 条任务。
若按 operation 计数，一次批量修 5 处就吃掉 5/3 轮 ⇒ 上限会在**第一次真实修订**就打爆。
★ 但这条口径必须写进代码注释，否则下一个人会"顺手改成 per operation"。

**漏洞 2：`create_task` 绕得过 `edit_plan`，于是绕得过计数**

```
$ grep -n "staged\|phase" src/tools/create-task.ts
（零命中 —— 整个文件没有一处 phase 检查）
$ grep -n "function requireFreshCaptainTeam" -A 10 src/tools/shared/entities.ts
1388:export async function requireFreshCaptainTeam(
...
1393:  const fresh = await requireFreshTeam(stateRoot, teamId)
1394:  if (fresh.captainSessionId !== captainId) {
1395:    throw new Error(`only the captain of team "${fresh.name}" may perform this operation`)
1396:  }
1397:  return fresh
```

⇒ ★★ `requireFreshCaptainTeam` **只查 captain 身份，不查 phase**。
⇒ 一个 staged 团队上，队长可以**反复调 `create_task` 无限加任务**，
`planReviewRounds` **一次都不涨**，而上限却以为"最多 3 轮"。
⇒ 这使第三层闸（轮次上限）**在真正的绕行路径上完全失效**。

★ **修法（三个层次，必须先做便宜的）**：
1. **计数口径覆盖两条入口**：`create_task` 在 `phase === 'staged'` 时**也 +1**
   （它确实改变了计划，语义上就是一轮）。这是**一行**改动，且不动任何 schema。
2. ★★★ **`amend_task` 是同一条绕行路，而且是更有效的一条**（对抗性审查 B3 补，
   本文档第一版漏了它）。`src/tools/amend-task.ts:57` 起同样**没有 phase 闸、不写 `planReviewRounds`** ——
   而它是**唯一能改 `inScope` 的工具**，即分档判据唯一的输入。
   实测端到端：implementation 任务 `inScope` 8 项 ⇒ `tier: large`；
   `amend_task` 改成 3 项 ⇒ `tier: small`、`reviewed` 仍空、`planReviewRounds` 仍 `(absent)`
   ⇒ 随后 `agent_teams_approve` ⇒ **`{"status":"running"}`**。
   ⇒ **最有效的绕行工具恰好不计轮次。** 必须与 `create_task` 同列。
3. **更彻底的做法**（不在本步）：给 staged 团队上的 `create_task`/`amend_task` 加 phase 闸，
   要求走 `edit_plan`。★ 但那是 G7 的邻居，会改两个工具的对外行为 ⇒
   **记进 §11，不在 N5 做**。

★ 于是计数要覆盖**五条**变更路径（不是两条）：
`edit_plan`（含 Web 的 `update_*`，共用 `src/tools.ts:2076`）、`create_task`、`amend_task`、
`create(approval:'automatic')`（B6 —— 它**完全不经过** `approveStagedTeam`）、
以及 `resume` 的**归零**（acceptance ⑫：解除必须是显式 `rounds = 0`）。

**漏洞 3：计数与"打回 awaiting_review"是两个地方**

`src/tools.ts:2076` 是 `else fresh.planReviewState = 'awaiting_review'`。
如果计数写在**别处**（例如 `edit-plan.ts` 的工具层），那么"打回"与"计数"会在
**不同的事务边界**上 —— 一次在锁内失败的操作可能已经计了数却没打回，或反之。
⇒ ★ **计数必须与 `:2076` 那行在同一个 `withTeamLock` 内、同一个 `writeTeam` 上。**

**绕行口（★ 不是漏洞，是必须故意留的）**

N5.11 已经证明：口径 B 在历史团队上只有 1/6 通过率。
⇒ N5 落地当天，**一批正常计划会被拦住**。若没有逃生口，它会被立刻绕过或被关掉 ——
那比不做更坏。⇒ `agent_teams_approve` 的 `confirmation` 接受**显式点名词**：

```
confirmation: "approved, large: t12,t15 — user accepted the risk"
```

- 它必须**点名到 task id**，不许写 "approved all" 蒙混（一个全称量词不是裁决）。
- 命中后：这几条 large 无戳任务**放行**，`describePlanLoop.reason` 里逐字记下
  "t12,t15 由人在批准时点名承担"。
- ★ 它**不写 `reviewed` 戳** —— 那会伪造"审过了"。人有的是**批准权**，不是**审查记录**。
  ⇒ 这两种权利在数据上必须不同形（REQUIREMENTS「三态不许同形」的同一条纪律）。

★ 这一条也回答了 N5.9 里那个"第一批被拦下的是本计划自己"的尴尬：
作者不必给自己的计划写假戳，只需要在批准时点名 —— 而那是**真实发生过的事**。

---

#### N5.13 ★★ 一个在写这一节时才查出来的缺口：`planReviewState` 从不进 `status`

★★★ 这一条直接改变 N5 的收益形状，所以单列。它不在原计划的 N5.1–N5.12 里，
是复核"status 里 planLoop 该插在哪"时才查到的。

**实测**：

```
$ grep -n "planReviewState" src/tools/status.ts
（零命中 —— status 工具从不读这一格）
```

`planReviewState` 在全仓的读取方只有四处，**没有一处是工具面**：

```
src/snapshot.ts:646            → Web UI 的 snapshot 投影（只给前端）
src/tools.ts:2188 / :2212      → continueStagedPlanning 自己判"是否已在等反馈"
src/client/ActivityPanel.tsx:295 / StagingPlanEditor.tsx:651   → 前端组件
src/state.ts:1379-1381         → 落盘校验（只允许两个值）
```

⇒ ★★ **一个 staged 团队正在"等用户反馈"还是"等用户批准"这件事，
`agent_teams_status` 这个工具**读不出来**。**
它返回 `phase: 'staged'`，然后就没了 —— 队长拿到 `staged` 之后无法区分
"我该等用户说话"与"我该等用户点批准"，而这两件事的**下一步动作完全不同**
（前者：用户会说什么我得先问；后者：我已经问完了，该点了）。

**这条缺口为什么比它看起来严重**：

用户 m01373 要的是"计划能不能开始跑有门禁把关，其实就是**计划的审查循环能不能结束**"。
而"循环能不能结束"在**数据上**有两个不同的东西：

1. `planReviewState` —— 循环**现在停在哪**（等审 / 等反馈）★★ **今天工具面读不到**
2. 轮次与上限 —— 循环**还能转几次** ★★ **今天根本不存在**（`planReviewRounds` 零命中）

N5 的第一版把这当成"一件事"（加个 `describePlanLoop` 就都有了）。
实测是**两件事**：一件是"字段没投影"（廉价），一件是"概念不存在"（要设计）。
⇒ 若只做后者不做前者，`describePlanLoop` 会**读不到它自己最需要的那个输入**
—— 它要判 `planReviewState === 'awaiting_feedback' ⇒ 'reviewing'`，
而这一格在工具面从来没有被读出来过（`src/tools.ts` 里那两处是**内部判据**，不是投影）。

★ **顺带一个必须记下的对称缺口**：`snapshot` 只投影 `phase === 'staged'` 时的
`planReviewState`（`src/snapshot.ts:644-646`），approve 之后 `delete fresh.planReviewState`
（`src/tools.ts:2166`）⇒ 一个已批准团队**既没有 `planReviewState` 也没有轮次记录**。
于是"这个计划审了几轮才通过"在批准之后就**永久丢失** —— 而这正是
自迭代最需要的那条读数（"哪一类计划要审几轮"）。

⇒ ★★★ **N5 的 inScope 因此必须包含 `src/tools/status.ts` 的投影**，
且 acceptance 不能只写"status 里有 planLoop 四格"，还要写
**"approved 之后仍能读到 rounds"**（否则读的是删掉的那一格，永远 0）。

**这一条也修正了 N5.2 那张对照表的一行**：

| | 质量环（已有） | 计划审查链（缺口） |
|---|---|---|
| 接到 status / delivery | `status.ts:1071`、`delivery.ts:194` | ★ **不是"无"，是"`phase` 有、`planReviewState` 没有"** —— 半接 |

原文写"无"会让人以为从零接，实测是**接了一半**：`phase` 在 `status.ts:1076`
已经投影，缺的是同一份状态里**更细的那一格**。这两种缺口的改法完全不同
（从零接要设计字段形状；补一半只需在同一处加一格且**必须与 `phase` 同源**）。

---

#### N5.14 ★★★ 第三层闸第一版写错了：它复用一个**全仓没有清除点**的位

★★ 这一条是对抗性审查抓出来的，**第一版的三层闸会造出一个不可逆的副作用**。
它属于"过度设计"里最贵的一种：不是多做了一点，而是**做了一件撤不回去的事**。

**第一版写的**：

```
rounds >= planReviewMaxRounds ⇒ { escalated: true, status: 'escalated' }
```

**实测它撞上了什么**：

```
$ grep -rn "escalated = true\|escalated: true" src/ --include=*.ts
src/tools/shared/entities.ts:5672   if (planned.escalated === true) team.escalated = true
src/quality-gates.ts:2107/2114/2146/2171/2761    ← 全是**返回值**，不是写状态
```

⇒ `team.escalated = true` 全仓**只有一个写入点**，在 `applyQualityFollowUp` 里
（`src/tools/shared/entities.ts:5672`），而它是**质量环**的出口。
`quality-gates.ts` 里那五处 `escalated: true` 是 `planQualityFollowUp` / `describeQualityLoop`
的**返回对象**，不落盘。

```
$ grep -rn "escalated = false\|escalated = undefined\|delete .*escalated" src/ --include=*.ts
（零命中）
```

★ `quality-gates.ts:2770` 那个 `escalated: false` 也**不是清除** —— 它在
`describeQualityLoop` 的最后一个 `return` 里，是"算出来的读数"，不是写回 `team`。

```
$ grep -n "fresh.halted = false" -A 2 src/tools/resume.ts
  fresh.halted = false
  fresh.haltedAt = undefined
（只清 halted，不清 escalated）
```

而 `team.escalated` 是**两个交付阻断项**的来源：

```
src/quality-gates.ts:2260   if (team.escalated === true) blockers.push('team requires escalation resolution')
src/quality-gates.ts:2757   if (team.escalated === true) return { state:'escalated', …, deliverable:false }
```

⇒ ★★★ **一次计划超轮 = 整队永久不可交付，且 `resume` 也解不开**（resume 只清 `halted`）。
这不是"重"，是**不可逆**。

**为什么第一版会写成这样**：我照抄了质量环的形状（`planQualityFollowUp` ⇒ `{escalated:true}`），
但**没有查那个形状落到了哪个位**。质量环写 `escalated` 是**正确**的 ——
它的语义是"自动审查循环到顶了，需要人来裁决"，而计划审查**也是**同一类事。
问题不在语义，在**那个位今天只服务质量环，且没有出口**。

**改法**（★ 不是"不做第三层"，而是"用本队自己的位"）：

| | 第一版 | 改后 |
|---|---|---|
| 落点 | `team.escalated`（全仓无清除点） | `team.planReviewEscalated?: true`（**新增，归计划环独有**） |
| 谁能清 | 没人 | 下一次 `edit_plan` 打回 `'awaiting_review'` 时一并清（`src/tools.ts:2076` 那一处） |
| 谁读它 | `canDeclareDelivery` + `describeQualityLoop`（**质量环的消费者**） | 只有 `describePlanLoop` |
| 超轮的后果 | 整队永久不可交付 | 计划环读 `escalated`，**质量环与交付判定完全不受影响** |
| 写域 | — | `src/types.ts`（一格）+ `src/quality-gates.ts`（`describePlanLoop` 返回值）+ `src/tools.ts`（递增处）—— **都在 N5 的 inScope 里** |

★ **`src/state.ts` 要不要跟着改？** 实测 `state.ts:1379-1381` 对 `planReviewState` 有落盘校验，
但那是**枚举**校验（只许两个值），而 `planReviewEscalated` 是 `boolean | undefined`，
不需要新的校验分支。⇒ **`state.ts` 不进 inScope**（这一格是这次审查里唯一确认"不用扩域"的地方）。

**这条的通用教训**（★★ 值得写进 §12）：

> **复用别人的状态位之前，先数它有几个清除点。**
> 一个只写不清的位，对它自己的主人是正确的（"到顶了等人裁决"本来就该一直亮着），
> 而对借用它的人是陷阱 —— 因为**清除语义属于主人，不属于借用者**。

---
#### N5.15 第二处第一版写不出来：`maxRounds` 不能从 `reviewPolicy` 取

★★ 第一版在 `PlanLoopSnapshot` 的注释里写「`maxRounds: number // 从 reviewPolicy 取，缺省 3`」，
正文又写「可被 profile 覆盖」。**这两句今天都落不了地**。

`ReviewPolicy` 是一个**四处封闭的五格**：

```
src/types.ts:311-317        interface ReviewPolicy { requirementsMinRounds?, requirementsMaxRounds?,
                                                    codeMaxRounds?, maxRepairAttempts?, requiredReviewers? }
src/profiles.ts:24          const REVIEW_POLICY_KEYS = [……同样五格……] as const
src/index.ts:132            reviewPolicy: z.object({ …同样五格… })
src/quality-gates.ts:466    isReviewPolicy(value) → Object.keys(value).every(k => allowed.has(k))
```

而 `profiles.ts:1068-1073` 的 `assertAllowedKeys` 对第六格是**直接抛**：

```
$ sed -n '1068,1073p' src/profiles.ts
  const allow = new Set<string>(allowed)
  for (const key of Object.keys(value)) {
    if (allow.has(key)) continue
    …
    throw new Error(`${path}.${key} is unknown${hint}`)
  }
```

⇒ 加第六格 `planReviewMaxRounds` 必须同时改 **`types.ts` + `profiles.ts` + `index.ts` + `quality-gates.ts`**
四处，其中 `profiles.ts` 与 `index.ts` **不在 N5 的 inScope 里**。

★ 计划全文 `grep -c "profiles\.ts"` = **0** —— 第一版从没意识到这一格会牵出 `profiles.ts`。

**改法（取最省的一种）**：

```
const PLAN_REVIEW_MAX_ROUNDS = 3   // src/quality-gates.ts 模块常量，与 DEFAULT_REVIEW_POLICY 并列
```

- **不进 `ReviewPolicy`**：那个接口的语义是"质量环的评审政策"，计划环有自己的上限
  （今天两个数恰好都是 3，但它们的**依据不同** —— 质量环那个来自 `codeMaxRounds`，
  计划环这个来自"一个计划最多被打回几次仍然值得改"）。
- **profile 不能覆盖**（本轮）：要能覆盖就得扩 `ReviewPolicy`，那会把 N5 的写域
  从 5 个文件扩到 **8 个文件**，且 `profiles.ts` 是"配置面的封闭性"这道门的所在地 ——
  动它属于另一个决定，不该夹在 N5 里。
- ★ **不排除将来做**：写在这里是为了让下一个人知道"这一格要动四处"，而不是让他
  像第一版的我一样以为"读个配置就有了"。

★ **这一条也顺带修正了第一版对"可被 profile 覆盖"的直觉**：
计划环与质量环虽然同形，但**它们的政策来源不同层** —— 质量环的轮次上限是**产品配置**
（不同 kind 需要不同次数），计划环的轮次上限是**这个功能的常数**
（今天没有任何证据说明不同团队需要不同的计划审查轮数上限）。把两个数强行并到一个接口里，
会让将来调其中一个的时候不得不为什么都没变的那一个负责。

---

#### N5.16 逃生口今天没有落点：`confirmation` 传不到门禁那一层

★★ N5.12 写的绕行口是「`agent_teams_approve` 的 `confirmation` 接受显式点名到 task id 的大档」。
**这句话今天写不出代码** —— `confirmation` 在工具层就被丢掉了：

```
src/tools/approve.ts:38   if (args.confirmation.trim() === '') throw new Error('explicit user approval text is required')
src/tools/approve.ts:42   const approved = await approveStagedTeam(captain, team.id, exec.signal)
                          ↑ confirmation 到此为止，没传下去

src/tools/shared/entities.ts:268
  approveStagedTeam(captain: Agent, teamId: string, signal?: AbortSignal): Promise<{…}>
                          ↑ 形参里没有 confirmation

$ grep -rn "confirmation" src/tools/*.ts src/tools/shared/*.ts
  src/tools/approve.ts:19   定义
  src/tools/approve.ts:38   判空
（再无第三处）
```

⇒ ★★ 门禁装在 `approveStagedTeam` 里，而**那个函数看不见用户的批准文本**。
若不做这一步，N5 的第二道闸会变成"有绕行口的设计、没有绕行口的代码" ——
而那种状态的实践后果是：**用户明明说了"我批准这两条大任务"，闸照样拒**，
于是人要么放弃、要么绕开工具手改 state（比不做门禁更坏）。

**改法**（★ 第二版 —— 第一版写"三处全在 inScope 里"是**假的**，见下）：

1. `src/tools/shared/entities.ts:268` 的 `approveStagedTeam` 加第四参数
   `approval?: { confirmation: string }`。
   ★★ **这个文件原本不在 N5 的 inScope 里**（实测 inScope 是
   `[quality-gates.ts, tools.ts, types.ts, status.ts, approve.ts]`），
   而不改它的接口声明，`approve.ts:42` 传 4 个参数 **编译不过**：

   ```
   src/tools/shared/entities.ts:268
     approveStagedTeam(captain: Agent, teamId: string, signal?: AbortSignal): Promise<{…}>
   $ tsc --noEmit  ⇒  error TS2554: Expected 2-3 arguments, but got 4.
   ```
   ⇒ **inScope 已补入 `src/tools/shared/entities.ts`**（写域 5 → 6 文件）。
   ★ 注意这个文件已经在 N1、N3 的写域里（§11 的 G7 就是这条），所以它不是新增冲突面，
     而是把一条**早已存在的相交**如实记进来。
2. `src/tools/approve.ts:42` 传 `{ confirmation: args.confirmation }`。
3. `src/index.ts:519` 的 Web 路径 —— **它没有 `confirmation`**（浏览器点按钮不产生文本）
   ⇒ 传 `undefined`，于是 Web 路径**只能走"没有未审大档"的那一条**。
   ★ 这是**有意的不对称**：Web 的"Approve & Run"按钮是**一个通用批准**，
   它不该被当成"逐点名"的授权。★ 而第 1 条把新参数做成**可选**，
   正是为了让 `index.ts` **一行不改就继续能编译**。

★★★ **而"点名"必须落盘 —— 否则等于没做**（对抗性审查 B7）：
`src/tools.ts:2166` 的 `delete fresh.planReviewState` 会把"这次走了逃生口"抹掉，
而 `approvedAt` 只有写点（`src/tools.ts:2167`）**全仓没有读点**。
⇒ 授权只活在**一次函数调用的栈帧里**，事后无法回答"这批大活是谁批的"。
**这比不做逃生口更坏。** 所以第 1 条要做的不只是"加个形参"：

```
fresh.planReviewBypass = { taskIds: string[], confirmation: string, at: number }
```

★ 实测这个顶层新键**可以落盘**：`createTeamDir`/`readTeam` 往返
`{planReviewRounds:4, planReviewEscalated:true}` 完整读回，
而 `src/state.ts:1362-1387` 的 `isTeamState` **不校验未知顶层键** ⇒ `state.ts` 不用改。
★ 但**不要**学 `planReviewState` 那样加枚举值 —— `src/state.ts:1379-1381` 是枚举校验，
加值会让**读侧 brick 整队**（`readTeam` 直接抛 `invalid AgentTeams state`）。

★★ **顺带记一条不能忘的负向读数**：
`confirmation` 的点名词若拼错（`large: t99` 而 t99 不存在）⇒ **必须拒绝**，不许静默当"没点名"。
理由与全仓同一条：**"点名了一个不存在的任务"与"没有点名"必须不同形** ——
否则打错字的人会得到一个"批准了但没生效"的结果，而它的表现与"成功"完全一样。

---

#### N5.17 ★★★ 对抗性审查的七条（2026-10-20，全部实测成立、全部已改）

★ 审查者对**现行 1846 行版**（md5 `c7a6af9142683d4360f44de764a3b7a5`）逐条给读数。七条我全部复跑确认后接受。
★ 它同时确认了六条"攻不动的"：门禁选址 `approveStagedTeam` 覆盖双入口、不复用 `team.escalated`（N5.14）、
不从 `reviewPolicy` 取 `maxRounds`（N5.15 —— 实测塞第六格会让 `readTeam` **抛错 brick 整队**）、
`planReviewRounds`/`planReviewEscalated` 可落盘、`reason` 才是真产出、"第一批被拦的是本计划自己"这句是诚实的。

##### B1 同一节里两套放行条件并存（★ 已改，见 N5.6-bis）

`:765` 说 `unmeasurable ⇒ 拒绝`，`:794` 说 `unmeasurable 免`。这是口径 C 与口径 B 的差别，
而文档自己实测：C 在历史 6 队上 **0/6**、B 是 **1/6**。⇒ 实现者读前者会做成 0% 通过率那一版。
**已改**：原三层图保留但标注"第二层已被推翻"，另立 `N5.6-bis` 作为唯一口径。

##### B2 `acceptance ⑥` 与 `⑩` 互斥；JSON 与 md 还各说一套

JSON 的 ⑥ 逐字要 `team.escalated === true`，而 `src/quality-gates.ts:2260` 逐字
`if (team.escalated === true) blockers.push('team requires escalation resolution')` ⇒
**⑥ 一旦为真，⑩ 必假**。实测：

```
$ node --input-type=module -e "... canDeclareDelivery({...base, escalated:true})"
{"ok":false,"blockers":["team plan is awaiting approval","team requires escalation resolution","team has no completed work"]}
```

且 md 的 N5.14 已把位改成 `planReviewEscalated`，**JSON 没跟着改**。
**已改**：JSON ⑥ 改为 `team.planReviewEscalated === true`，并逐字写明"**不是** `team.escalated`"与理由。

##### B3 ★★★ 免检面吃掉真实语料，可绕面吃掉唯一被拦的那一小块（★ 已砍第二层）

实测 `tierOf` 的信号方向是**反的**：

```
inScope: undefined                                   => unmeasurable
inScope: []                                          => unmeasurable
inScope: ['src/']                                    => small      ← 生成器占位值反而免检
inScope: ['src/tools.ts','src/types.ts']             => large      ← ★ 诚实写清 2 个文件 ⇒ 被拦
inScope: ['scripts/plan-review-check.mjs','scripts/friction-triage.mjs'] => small
inScope: ['src/tools.ts','lib/tools.js','lib/types/tools.d.ts']          => small
```

成因（`scripts/friction-triage.mjs:1522` 逐字）：
`function tierSourceFiles(inScope) { return inScope.filter((path) => /^src\//.test(path) && !DIRECTORY_ENTRY.test(path)) }`
—— **数的是"声明了几个 `src/` 文件"，不是"要干多少活"**。

三条真实建队路径**全部放行**（实测）：手写最小计划 ⇒ 全 `unmeasurable` ⇒ PASS；
`create({plan:{quality}})` 官方生成图 ⇒ `["unmeasurable","small","unmeasurable","unmeasurable","unmeasurable"]` ⇒ PASS；
`edit_plan add_task` ⇒ `unmeasurable` ⇒ PASS。

而唯一被拦的那块**被它要审的那一方自己绕过**（端到端实测两条，都成功拿到 `{"status":"running"}`）：
- **缩域**：implementation 任务 `inScope` 8 项 ⇒ `large`；`amend_task` 改成 3 项 ⇒ `small`、
  `reviewed` 仍空、`planReviewRounds` 仍 `(absent)` ⇒ `approve` 成功。
- **自签戳**：staged 团队上 `create_task({…reviewed:{at,by:'adversarial',checks:[五问全 pass]}})`
  成功落盘。而全仓 `grep -rn "by: 'adversarial'" src/` **零命中** ——
  **没有任何自动审查方写戳，唯一生产者就是被门禁判的那一方**。
- 且 `amend_task`（`src/tools/amend-task.ts:57` 起）在 staged 团队上**没有 phase 闸、也不计数** ——
  N5.12 只列了 `create_task`，漏的这条恰恰是**唯一能改 `inScope` 的工具**。

**已改**：第二层（分档 + `reviewed` 戳）**砍掉**。替代只留一条结构性的：
`edit_plan` 的 `add_task` 不许静默造 `kind:'work'`（`src/tools.ts:2049` 硬编码）。
★ 理由（审查者原话，我同意）："分档 + 戳是第四件事，而它今天既拦不住真计划，也拦不住想绕的人。"

##### B4 ★★ 轮次上限的解除路径是死码，而 approve 根本不读轮次

按 N5.8 判定顺序复跑：

```
{phase:'staged', planReviewRounds:3, planReviewEscalated:true}  ⇒ escalated
清 flag（N5.14 的"下一次 edit_plan 打回 awaiting_review 时清"）  ⇒ escalated   ← ★ 死码
{phase:'running', planReviewRounds:4, planReviewEscalated:true} ⇒ approved    ← phase==='running' 抢先
```

第 4 行 `rounds >= maxRounds ⇒ 'escalated'` 在清掉 flag 的**同一份数据上立刻重新算出** escalated。
文档全文 `grep 清零|重置|reset|解除|归零` **零命中** ⇒ 一旦 `rounds > 3`，计划环永久 escalated。

更硬的一条：`approveStagedTeam`（`src/tools.ts:2143-2180`）**不读 escalated、不读轮次**
（逐字读过：只有 `requireStagedTeam` → `validateStagedGraph(fresh, true)` → 解析 LLM → `fresh.phase = 'running'`）。
⇒ **一个已经被读成"审到顶了"的计划，批准即变成 approved，而 `rounds=4` 仍在盘上。**
这不是"上限生效"，这是"上限在唯一的放行点上不存在"。

**已改**：JSON 新增 ⑪（approve 必须读轮次并拒）、⑫（解除必须是**显式归零** `rounds=0` ＋清 flag，
且只允许在 `resume` 或人点名时发生；只有清 flag 不归零 ⇒ 仍 escalated 的**负向对照**）。
N5.8 的判定顺序同步改：`phase === 'running' ⇒ 'approved'` 必须挪到两个 `escalated` **之后**。

##### B5 N5.16 的"三处全在 inScope 里"是假的，且不改签名编译不过（★ 已改，见上）

**已改**：`src/tools/shared/entities.ts` 补入 inScope；`TS2554` 的读数写进正文。

##### B6 ★★ 默认路径 `approval: 'automatic'` 完全绕过门禁，文档零提及

`src/tools/create.ts:180` 逐字 `const staged = args.approval === 'required'`；
schema 描述逐字 `… Defaults to automatic for API compatibility.` ⇒ **不传 approval 的新用户走 automatic**，
`grep -c automatic docs/SELF-ITERATION-PLAN.md` = **0**，JSON 也是 **0**。

**已改**：JSON 新增 ⑬ —— 必须在本轮文档里**明写**"本闸只覆盖 `approval:'required'`"，
并断言 automatic 路径的落盘形态（`phase=undefined` 等）与 required 路径**不同形**，
不许让它静默读成"门禁通过"。

##### B7 ★★ "人点名放行"没有落点（★ 已改，见 N5.16）

**已改**：落点 = `fresh.planReviewBypass = { taskIds, confirmation, at }`（顶层新键，
`isTeamState` 不校验，实测可往返；但**不能**做成枚举值，那会 brick 读侧）。

##### S1 N5.10 的 verify 命令三处坏（★ 已改）

- `node --test scripts/plan-review-tier.test.mjs scripts/quality-gates-tdd.mjs` —— 后者**不是 node:test 文件**，
  实测 `node scripts/quality-gates-tdd.mjs` ⇒ **exit 1**，错误逐字
  `create_task rejected: [dispatch.plan-reviewed] this plan has not been reviewed: no \`reviewed\` stamp is attached`。
  ⇒ 它是 §6 基线里 stage4 的**既有红**，与 N5 无关；放进 verify 会让 N5 永远不会绿。**已剔除。**
- `curl -s http://127.0.0.1:49318/...` —— 硬编码本机端口（全仓只在这份计划里出现）。**已剔除。**
- ★ 前半 `node --test scripts/plan-review-tier.test.mjs` 是绿的：`tests 11 / pass 8 / fail 0 / skipped 3`，**保留**。

##### S2–S6（应改，未改完，记录在案）

| # | 内容 | 处置 |
|---|---|---|
| S2 | `whyLarge` 文案在可预见形状上是错的：`tierOf` 返回 `it spans 4 existing source files`，而 N2 的 inScope 里两项实测不存在（`existing` 只喂信号 C，信号 A 用 `files.length`）| acceptance ② 已改为"列出 tier 与 blockingQuestion"而非逐条 `whyLarge` |
| S3 | 现有 status 把 staged 团队读成 `running`（`src/tools/status.ts:1076` `phase: team.phase ?? 'running'`）⇒ N5.13 说"读不到"是低估，**读到的是错的**；且 status 输出 schema 是闭合的（`:272` `additionalProperties: false`），加 `planLoop` 必须同步改表，否则 `scripts/gate-tool-output-schema.test.mjs` 红 | ★ 未改，留作 N5 实施时的硬约束 |
| S4 | §5 自测的 `adversarialReview(c, tierOf(c))` 第二参永远读不到 `coarse`（`tierOf` 返回 7 键无 `status`；`friction-triage.mjs:981` 读的正是 `scopeVerdict?.status === 'coarse'`）⇒ 五问里"写域"那问退回"结尾有没有 `/`" | ★ 修法二选一：`tierOf` 补 `status: tier==='large'?'coarse':'fine'`，或明写"这一问由 tier 替代" |
| S5 | 计数漏 `amend_task` 与 `approval:'automatic'` | ★ 已进 acceptance ⑤/⑬；实施时计数落点须覆盖 `edit_plan`/Web `update_*`/`create_task`/`amend_task`/`create(automatic)` 五条 |
| S6 | `approved` 抢在两个 `escalated` 之前 ⇒ 对 running 团队 `rounds=4>max=3` 与 `rounds=0` 读出同一个 `approved`，**终止性在批准后不可读** | ★ 已进 B4 的处置（挪后） |

##### ★ 审查者对"自相矛盾"那一问的回答，值得整条留下

> 文档说"第一批被它拦下的就是这个计划自己……这不是缺陷"。**一半成立**：闸能拦住它的作者，
> 确实证明它不是空转。**另一半不成立**：它拦住的恰好是**唯一诚实声明了写域**的那份计划
> （N0 small 免检、N1–N5 large 被拦），而所有"没写 inScope"的计划一律免检 ——
> 这不是"严格"，这是**选择偏差**。而文档给的补救（`confirmation` 点名）**没有落点**。
> ⇒ 用户明天要跑这个计划，只有三条路：手写假戳、改小 inScope、或在 confirmation 里点名
> —— 而**第三条代码路径今天不存在**。
> **门禁的第一个客户是它自己的作者，而文档给出的解法是绕行口 —— 这就是"没人会留着的门禁"的定义。**

★ 这条我接受。**第二层砍掉之后，这个"自相矛盾"自动消失** —— 因为不再有"分档拦本计划"这回事。

---

## 5. 本计划自己的读数：前置循环审查对它跑了什么

本文件自带一份机器可读计划（`docs/self-iteration-plan.json`），用**仓里既有的**
`scripts/plan-review-check.mjs` 求值 —— 这就是 N3 要接的那条链在"接上之前"的手工用法。

★★ **实测一个"代码里有、没接上"的实例（本文档第一版在这里写错了）**：
第一版我写了一条命令 `node scripts/plan-review-check.mjs --file docs/self-iteration-plan.json`。
**那条命令什么也不打印，退出码 0。** 因为：

```
$ grep -n "process.argv\|invokedDirectly" scripts/plan-review-check.mjs
（零命中）
$ tail -5 scripts/plan-review-check.mjs
/** 人可读的一行摘要（给 CLI 与报告用）。 */
export function formatPlanReview(result) { … }
```

⇒ `formatPlanReview` 的注释逐字写「给 **CLI** 与报告用」，而**这个文件里没有 CLI**。
⇒ 与 `reviewStateOf` 零调用方、`admission` 零求值点**是同一个形状**：
**机制在，而流程没走**（`plan-review-check.mjs` 文件头自己逐字写的诊断）。
⇒ 因此这次求值**只能**走 `import`：

```
$ node --input-type=module -e "
import { readFileSync, existsSync } from 'node:fs'
const j = JSON.parse(readFileSync('docs/self-iteration-plan.json','utf8'))
const pk = await import('./scripts/plan-review-check.mjs')
const ft = await import('./scripts/friction-triage.mjs')
const r = pk.checkPlanReview(j.plan)
console.log('checkPlanReview :', r.overall, '—', r.detail)
for (const c of j.plan) {
  const t = ft.tierOf(c, { exists: existsSync })
  const a = ft.adversarialReview(c, t)
  console.log('  ', c.id, '| tier:', t.tier, '| adv:', a.outcome)
}
console.log('deps:', j.plan.map(c => c.id + '=' + JSON.stringify(c.dependencies)).join(' '))
"
```

实测输出（2026-10-20，对抗性审查**应用完之后**重跑，六条契约）：

```
checkPlanReview : present — all 24 answers are present
   N0 | tier: small | adv: passed | files 1 | acc 5
   N1 | tier: large | adv: passed | files 6 | acc 5
   N2 | tier: large | adv: passed | files 4 | acc 4
   N3 | tier: large | adv: passed | files 3 | acc 5
   N4 | tier: large | adv: passed | files 2 | acc 5
   N5 | tier: large | adv: passed | files 5 | acc 10
deps: N0=[] N1=["N0"] N2=["N1"] N3=["N2"] N4=[] N5=["N3"]
```

★★ **把 N5 自己的放行条件套回 N0–N5，结果是"不放行"**：

```
N5 放行? NO 被拦: N1,N2,N3,N4,N5
```

⇒ 这正是 §N5.9 预告的那件事：**N5 会拦下这份计划自己**（五条都是 large，都没有 `reviewed` 戳）。
⇒ ★ 而它**不该因此被改成放行** —— 一个只会放行的门不是门。
   正确读法是：**这五步本来就该由人裁决**（§3 已逐格说明），N5 的答案与 §3 的结论一致，
   这反而是 N5 **判对了**的证据。

★★ **本文档第一版这里的命令是错的，必须记下来**：第一版写的是

```
adv=ft.adversarialReview(c, { status: 'fine' }).outcome
```

两个错叠在一起：
① 第二参数传的是 `{ status: 'fine' }` —— 一个**编造的**形状，而 `adversarialReview`
   真正要吃的是 `tierOf` 的返回（`{tier, why, review, …}`）；
② 打印 `a.checks` 时我读的是 `x.status`，而真实字段名是 **`x.verdict`**
   ⇒ 于是屏幕上全是 `scope:undefined prerequisite:undefined …`，**而 `outcome` 照样是 `passed`**。

⇒ ★★ 这与本文件 §2.2 记的那次 `task.commands || task.commandRuns`（真字段是 `commandsRun`）
是**同一个缺陷形状**：**读错字段名不报错，只静默给出空值**。
⇒ 所以上面这段求值命令**必须以"能打印出 `pass`/`fail`/`unmeasured` 这三个字"为验收**，
而不是以"程序没崩"为验收。

★★★ **而改后的形状仍然命中不了 —— 对抗性审查 S4 抓到了这一层（我复核确认）**：

`adversarialReview(c, tierOf(c))` 的第二参**永远读不到 `coarse`**：

```
$ node --input-type=module -e "...console.log(Object.keys(tierOf({inScope:['src/tools.ts','src/types.ts']})))"
['tier','why','review','reviewWhy','signals','blockingQuestion','nextStep']   ← ★ 没有 status

$ sed -n '981p' scripts/friction-triage.mjs
  } else if (scopeVerdict?.status === 'coarse') {                             ← ★ 读的正是 status
```

⇒ 那个分支**零命中**，于是"写域"那一问永远退回 `:1000` 的"结尾有没有 `/`"。
★ 也就是说：第一次修错是**编造了 `{status:'fine'}`**，第二次修对的是**字段名**（`tier` 存在了），
但**这一格需要的读数 `status` 在 `tierOf` 的返回里根本不存在**。
⇒ **"修了字段名"与"修了读数"不是一回事** —— 这是同一条缺陷的第三次变形。

★ **修法二选一（未实施，属 N3）**：
① `tierOf` 的返回补一格 `status: tier === 'large' ? 'coarse' : 'fine'`；或
② 在 `adversarialReview` 里明写"这一问由 `tier` 替代"，把 `scopeVerdict?.status` 改成读 `tier`。
★ 二选一都必须**同时**改 `scripts/friction-triage.mjs` 的注释，否则下一个人会把
"`status` 不在返回里"读成"调用方写错了"。

★ **如实交代一个已知的读数缺陷（并给出实测边界，不夸大也不缩小）**：
`plan-review-check.mjs` 的 `READING_MARKERS` 里有一条 `/\d/`，另有 `/test/i`、`/assert/i`、`/输出/`。
我把六组 acceptance 喂进去测了一遍（可复跑）：

```
$ node -e "import('./scripts/plan-review-check.mjs').then(pk=>{
  const cases=[
    ['无数字空话',['已检查过','我确认没问题','看起来是对的']],
    ['有数字但无读数',['改 3 个文件','重命名 2 个函数','新增 1 个参数']],
    ['有 test 字样',['加了 test','test passes']],
    ['有 assert 字样',['assert 了','用了 assert']],
    ['有 输出 字样',['输出了东西','输出一行']],
    ['真读数',['cooldown:unmeasured 从 29 → 0','keyPresent 从 0 → 39']],
  ]
  for(const [n,acc] of cases){
    const r=pk.checkPlanReview([{id:'X',kind:'work',subject:'s',objective:'o',
      inScope:['src/a.ts'],acceptance:acc,verify:['ls']}])
    console.log(n,'=>',r.contracts[0].answers['invariant-reading'].status)
  }})"
```

```
无数字空话              => missing     ← ✅ 它确实拦得住"完全没读数"
有数字但无读数            => present     ← ❌ "改 3 个文件"被判成有读数
有 test 字样            => present     ← ❌ 一个词就过
有 assert 字样          => present     ← ❌ 同上
有 输出 字样            => present     ← ❌ 同上
真读数                  => present     ← ✅
```

⇒ **准确的说法是**：它拦得住"完全没读数"（我第一版写成"几乎不会判 missing"，**说过头了**），
但拦不住"有数字/有 test 字样、而那个数字与验收无关"。
⇒ 于是本文件 §4 里那些真读数与一句"改 3 个文件"在这个检查眼里**同形**。
⇒ **修它属于 N3**（把 `looksLikeReading` 从"含数字"换成"能指向一个命令、一个键、或一组改前/改后值"）。
⇒ 本文件先如实标注这个洞 —— 否则 §5 的 `24/24 present` 会被读成"每条 acceptance 都是可复核的读数"。

★★ **同样的洞在 `adversarialReview` 上，而且边界比我第一版写的更窄（重新实测了）**：

`adversarialReview` 的 `acceptance` 一问**只有一道防线**：`looksTautological(text)`，
而它的实现全文就是**一条正则**：

```js
export function looksTautological(text) {
  if (typeof text !== 'string') return false
  return /(必须存在|必须.{0,3}存在|不能为空|必须.{0,3}非空|不该.{0,3}为空|要有.{0,4}文件|不能什么都没有|必须有一个|不得为空|至少.{0,4}一个)/u.test(text)
}
```

⇒ ★★★ **它认的只有"存在性"这一族措辞**。它**不认**"正确""好""完成""通过"这类词。
我拿七组 acceptance 逐条喂进去（可复跑）：

```
$ node --input-type=module -e "
const m = await import('./scripts/friction-triage.mjs')
const t = { tier: 'large' }
const cases = [
  ['已检查过','代码是好的','完成了'],
  ['测试通过'],
  ['按需求实现'],
  ['输出正确'],
  ['文件必须存在'],
  ['不能为空'],
  ['cooldown:unmeasured 从 29 → 0'],
]
for (const acc of cases) {
  const c = { id:'X', kind:'requirements', subject:'x', assignee:'captain', objective:'y',
              inScope:['src/types.ts'], acceptance:acc, verify:['pnpm typecheck'], dependencies:[] }
  const a = m.adversarialReview(c, t)
  const chk = a.checks.find(x => x.id === 'acceptance')
  console.log(JSON.stringify(acc).padEnd(44), '=>', chk.verdict)
}
"
```

```
["已检查过","代码是好的","完成了"]     => pass    ← ❌
["测试通过"]                        => pass    ← ❌ 一个词就过
["按需求实现"]                      => pass    ← ❌
["输出正确"]                        => pass    ← ❌
["文件必须存在"]                     => fail    ← ✅ 只有存在性措辞被认出来
["不能为空"]                        => fail    ← ✅ 同上
["cooldown:unmeasured 从 29 → 0"]  => pass    ← ✅
```

★★ **这条读数改写了本文档 §5 原来的结论**。第一版我写的是
"`adversarialReview` 的三道结构性闸是真的在拦，它真正拦不住的是'格式对、内容空'"。
实测下来：**"内容空"这一半远比我说的严重** ——
`["已检查过","代码是好的","完成了"]` 三句空话**三条全过**，
因为 `looksTautological` 只认存在性措辞，而"好/完成/正确/通过"它一个都不认。
⇒ 正确的说法是：**它拦的是"恒真的存在性断言"，不是"没有内容的断言"**。
这两件事在"一条 acceptance 能不能判真假"这个问题上**不是同一件事**。

★ **三道结构性闸确实还在拦**（这部分第一版没写错，复核如下）：

```
空验收       (acceptance: [])   => rejected   ← ✅
非存在性恒真  —— 拦不住                        ← ❌ 见上
空 scope     (inScope: [])      => rejected   ← ✅（且 boundary 落 unmeasured）
```

⇒ 所以：**空的被拦、存在性恒真被拦、写域为空被拦；而"内容空洞但非存在性措辞"全部放行。**
⇒ 它与 §5 上面那个 `/\d/` 是**同一个洞的两半**（一个在 `plan-review-check`，一个在 `friction-triage`），
都应该在 N3 里修 —— 而修法不是"再加几个词进正则"（那只是把窄口径换个方向），
而是**要求每条 acceptance 能指向一个命令、一个键、或一组改前/改后值**
（`plan-review-check.mjs` 的 `looksLikeReading` 已经在往这个方向写，只是判据仍停在"含数字"）。
⇒ 在此之前，本文件里那些 `passed` **不能**当"这五步是安全的"来读，
只能当"这五问没有一个能判它不行"来读。


---

## 6. 基线（任何一步的"改后"都要与它对照）

```
$ pnpm typecheck
exit = 0

$ pnpm test:gates
tests 1660 / pass 1590 / fail 33 / distinct 失败测试 34 条 / 分布 16 个文件
★ 16 个失败文件（可复跑：`grep "^test at scripts/" /tmp/gates-baseline.log | …`）：
  gate-baseline-known-failures · gate-contract-build-artifacts · gate-falsification-pairs
  gate-input-wiring · gate-plan-reviewed-stamp · gate-producer-consumer
  gate-repair-completion · gate-reviewed-passthrough · gate-source-reading-convention
  gate-stale-module · gate-t1-completion-probe · gate-worktree-arrival
  verify-admission · verify-input-requires · verify-runtime-integration · verify-unified-pipeline
★ scripts/fixtures/baseline-known-failures.json 只 pin 了 17 条，
  实际 34 条 distinct 失败里只有 10 条被精确覆盖 ⇒ 24 条未 pin
  （口径是"这次改动新增了失败吗"，不是"零失败"）

$ pnpm verify
22 个 stage 中 6 红：
  stage1  node scripts/verify.mjs          8 条 FAIL（★ 全是客户端 UI 契约臂，与服务端逻辑无关）
  stage4  pnpm verify:quality-gates        [dispatch.plan-reviewed] … task.reviewed …
  stage5  scripts/lifecycle-verify.mjs     ENOTEMPTY rmdir …/.agent-teams/frictions
  stage6  scripts/stress-verify.mjs        ENOTEMPTY（同上）
  stage13 pnpm verify:harness-contract     ENOTEMPTY（同上）
  stage20 pnpm test:gates                  33 红（同上）
★ verify.mjs 是 `&&` 链的【第一步】⇒ 它红 ⇒ 后面 21 个 stage 从未执行。
★ 且 verify 路径里的 `scripts/frictions-html.mjs` 会重写 docs/frictions.html
  ⇒ 任何含 `pnpm verify` 的循环都会让工作树变脏。跑之前/之后都要 `git status --short` 核对。
```

★ **三条与本次改动无关的红，必须在计划里点名**（否则会被读成"是这五步弄红的"）：
客户端 UI 臂 8 条（stage1）、`task.reviewed` 的 ctx 缺格（stage4）、
`.agent-teams/frictions` 的 ENOTEMPTY（stage5/6/13，根因是 `gitignore` 的 `.agent-teams/`
与并发 rmdir 抢目录，**不是**判据逻辑）。

---

## 7. 深挖（方向 2）该长什么样 —— 设计草案

★★ 这一节被对抗性审查改了两处（见 §12 第 19–21 条）：

1. **第一版漏了最便宜的第 0 条：方向本身由人给。** 用户 m00001 逐字
   「我给出几个方向之后」，而第一版 §7 的四条所需里**没有这一行** ——
   区间内 `grep "人给出"` 零命中。这不是措辞问题：方向是**输入**，不是**产出**，
   把它漏掉会让整节读成"深挖可以自己决定挖什么"。
2. **"深挖必须整体推迟到 N1–N3 之后"这个判断只对一半。**
   成立的部分是"候选产生方（N2）与 effect 靶"；**不成立**的部分是
   **"方向 → 今天的读数"这张表** —— 那件事的原料 §2 已经全部采到了。

### 7.1 一条诚实的"深挖"需要什么

| # | 需要 | 今天 | 谁提供 |
|---|---|---|---|
| **0** | ★★ **一个由人给出的方向清单** | **无输入口**（§7 全文不含这一格） | **本轮就该有**（见 7.2） |
| 1 | 一个方向能落到**具体的读数靶** | 无 | N1（台账）+ N2（分流：`effect` 那格就是靶）|
| 2 | 改进候选的**产生方** | 无（Proposal 0 条） | N2 |
| 3 | 候选的**排序依据** | 无可用读数（见下） | `src/confidence.ts` 的 `confidenceOf` |
| 4 | **审查**（防"深挖出的结论没有读数支撑"） | 无 | N3 |

★ 第 0 行是**最便宜的一行**：它不需要任何代码，需要的是一次提问。
把它排在"待建"里，等于说"现在没法深挖"，而实际上**现在就能给方向**
—— 缺的是有人问，以及一个记录它的地方。

★ **一条我第一版写过头、必须改准的话**：`confidenceOf` **不是**零消费者 ——
`src/evaluator/score.ts:146` 在用它（`confidenceOf(tallyOf(tallies)) ?? undefined`）。
真正的断链是**再往上一层**：

```
confidenceOf          ← src/evaluator/score.ts:146        ✅ 有消费者
evaluateSubject       ← 零消费者（src/evaluator/score.ts 里那个导出，无人调用）
tallyRecall/tallyAdopt ← 零调用方（src/confidence.ts:88/93）
```

⇒ 所以"排序依据"缺的**不是公式**，而是**把公式接到真实数据上的那一段**。

### 7.2 ★★ 本轮就能做的一格：方向 → 今天的缺陷密度

材料已经全部在本轮 §2 里采到了，**不需要动 `src/`，不需要新增一步**：

```
$ node -e "…读 .agent-teams/frictions/*.json 按 index.component 分桶…"
files 393
[ ['dispatch', 170], ['completion', 164], ['contract', 24],
  ['contract.verify-command', 2], ['runtime.liveness', 2], ['admission.convene', 2], … ]
```

⇒ ★ 这张表**就是"方向 → 缺陷密度"的原始语料**，而第一版全程只把 `frictions/` 当
ENOTEMPTY 的根因，**没有一处把它当方向语料用过**。

**具体做法**（落在 N0 的 `evolution-readout.mjs` 里，加一档输出）：

```
directions: { <component>: { frictions: N, signals: N, verdicts: {ok, blocked, unmeasured} } }
```

于是流程是：**用户给出两个方向 → 跑一次 N0 脚本 → 当场看到这两个方向今天各有几个真实缺陷、
几条信号、判据跑没跑** → 再决定先深挖哪一条。

★ 这**不替代**第 1–4 行（那些还是要 N1–N3），但它把"深挖"从
"等整条链建好才能开始"变成"今天就能决定挖哪"，而这两件事的差别是
**用户能不能在三次对话内看到一个方向上的真实进展**。

### 7.3 顺序与风险

⇒ **深挖的完整循环仍应在 N1 → N2 → N3 之后**。反过来做，会得到一个
"能生成很多改进建议、而每条建议都无法判定有没有用"的机器 —— 那正好是
`docs/REQUIREMENTS.md` §7 硬门槛②要挡的形态。

★ 深挖有一个必须提前说清的风险：**深挖的产出是"计划"，而计划已经有大档/小档之分。**
⇒ 深挖生成的计划**必须走 N5 的分档闸**，否则它会给自己派大活 —— 那正是 `dispatchable` 挡的东西。

---

## 8. 停止点（人要看的地方）

```
S1  N0 落地后：看 `node scripts/evolution-readout.mjs` 打出来的数是否与 §2 相同
    ★ 不同 ⇒ 停，先对齐口径（本仓记账最贵的形态就是"数不一致而两边都像对的"）
S2  N1 落地后：看【新写的那一行】collected.keyPresent = 1、cooldown:unmeasured → 0、wouldBlock 3/15
    ★★ 存量 29 行的 keyPresent 恒为 0 —— 那是冻结的历史裁决，**永远不绿是正确的**
       （第一版这里写"0 → 39"，上限是错的，见 N1.1）
    ★ 若 wouldBlock 与 3/15 差得多 ⇒ 停，说明索引派生口径与 §2.1 的反推不一致
    ★ 若新行仍然没有 collected 键 ⇒ 停，去看 JSON.stringify 的 undefined 那条（N1.1）
S3  N2 落地后：看五态分布与 proposals 条数
    ★ 若 unmeasured 仍是 29/29 ⇒ 停，这一层等于没做
S4  N3 落地后：看 status 里的分档读数
    ★ 若 large 计数为 0 而本计划的五步全是 large ⇒ 停，说明 status 没有读到真实计划
    ★ 另看一条**负向读数**：拿一份**故意不写读数**的计划（acceptance 全是"已检查过"这类话）
      去喂 status 的 planReview 一节 —— 它必须判 missing。今天它判 present（§5 记录的洞）。
      ⇒ 这一条不绿，N3 就只接上了"能看见"，没接上"能拦住"。
S5  N4 落地后：看两条对照臂（有重载 ⇒ 不 failed；无重载 ⇒ 仍 failed）
    ★ 第二条臂红了 ⇒ 立刻回滚：那意味着豁免太宽，会吞掉真实失败
S6  五步全部落地后：**第一次跑完整的自迭代闭环**
    ① 让团队真实干一件活 ② 出问题 ③ N1 把它采成信号（这次带 index 与 source）
    ④ N2 把它分流成一个 Proposal（或明确说"这条不该成提案"）
    ⑤ 人裁决 ⑥ 走 N3 的四问/分档/盖章 ⑦ 派发 ⑧ 新读数回到 N1
    ★ 只有 ①→⑧ 真的走通一次，"自迭代"才算跑过一次 —— 今天它一次都没走通。
    ★ 这一步**不许**由团队自己发起（那就是"它自己决定改自己"），必须由人给出那件"活"。
```

★ **每一步落地后都要更新本文件的读数表**，否则这份计划会变成"写完就过期"的那类文档。

---

## 9. 与既有裁定的关系（逐条对齐，不许相撞）

| 既有裁定 | 出处 | 本计划如何遵守 |
|---|---|---|
| 模块边界四规则；别人 → `evolution` 只许 import 一个接口面 | REQUIREMENTS §1 规则 A | N2 新建 `src/evolution/index.ts`，并把 7 处深路径 import 收口 |
| 评估器在循环**之外** | REQUIREMENTS | N2 只产出 `RoutingDecision.effect`（靶），**不评分**；评分留给 `confidenceOf` |
| 三态不许同形 | REQUIREMENTS | N1 的 `collected` 落盘、N3 的 status 投影都保留三态 |
| collection 是第七插入点 | REQUIREMENTS | N1 只**接**这一个插入点，不新增 |
| 收益衡量**无阈值** | REQUIREMENTS | 本文件只给"改前/改后两组数"，不定义"改善了多少算成功" |
| 判据三处登记 / 断言双向 | REQUIREMENTS | N4 只改 `members.ts` 的判定，不改判据注册表 |
| 不新增工具面 | 用户口味（"工具要保持简洁，真的需要才注册"） | 五步**零新增工具** |

---

## 10. 一句话总结

```
今天的状态：采集层能写但**判据不跑**（cooldown 29/29 unmeasured），
          分流层**没有产生方**（Proposal 0 条），
          审查链**每一环都有代码而每一环没人调**（admission 0 次 fire、
          计划审查零轮次计数：planReviewRounds 全仓零命中），
          而 HMR 每构建一次就可能把一条活判成失败。

本轮要做的：把这条链**接上**，并且每一步都留下"改前 / 改后"两个数。
          另加 N5 —— 用户明确追加的「计划能不能开始跑」门禁。
本轮不做的：完整的深挖勘探循环（§7.3；★ 但"方向 → 今天缺陷密度"这一格本轮给，§7.2）、
          success 的自动产生方（见 N1 边界）、restart 的措辞假相（见 N4 边界）、
          34 条既有测试红的清理（与本次无关）、`plan-review-check.mjs` 的 CLI（G3，见 §11）。

★★ 一条必须与上面并列记住的读数（§N5.11）：若把 N5 的放行条件写成"全部任务必须是
   小档"，**历史 6 个真实团队的通过率是 0%**。⇒ 闸门的判据是"不存在未审的大档"，
   而不是"不存在大档"。这两个条件差一个词，而差别是"能用"与"上线即瘫痪"。

★★★ 另一条同样必须并列记住（§N5.14）：第三层闸第一版复用了 `team.escalated`，
   而那个位**全仓没有清除点**（`resume` 只清 `halted`），且是两个交付阻断项的来源
   ⇒ 一次计划超轮会让**整队永久不可交付且解不开**。它不是"设计得重"，是**不可逆**。
   ⇒ 通用教训：复用别人的状态位之前，先数它有几个清除点。

★ 还有一条关于"这一轮到底能不能证明自己"的（§12.2 末段）：
   我自己查出的 17 条 与 外部审查查出的 10 条 **重叠度是 0**。
   ⇒ 这既是"外部审查环不能省"的证据，也是 N3 那条链值得建的理由。
```

---

## 11. 本轮新发现、但**不在 N0–N5 里**的缺口（如实记账，不夹带）

写这份计划的过程中又查出七条。★★ **第一版这里写的是"它们都不属于 N0–N5 的任何一个写域"，
那句是错的** —— 对抗性审查用机械对撞推翻了它（见 §12 第 18 条）：

```
G1 out  G2 out  G3 out  G4 out  G6 out
G5 HIT  src/hmr-trace.ts             ∈ N4
G7 HIT  src/tools/shared/entities.ts ∈ N1,N3 ; src/tools.ts ∈ N1,N5
```

⇒ ★ 第一次对撞时 G3 是 HIT（因为 N5 的第一版 inScope 里写了 `scripts/plan-review-check.mjs`）；
**但审查同时推翻了那一步**（薄壳前提不成立，见 §12 第 22 条）⇒ 把它从 inScope 里去掉之后，
**七条里两条相交（G5/G7），五条真正账外**。
表头也从"为什么不塞进 N0–N4"改成"N0–N5"（原表头是 N5 追加之前写的，没跟着改）。
记账在此，免得它们随这份计划一起被读完就丢。

| # | 缺口 | 可复跑读数 | 为什么不塞进 N0–N5 |
|---|---|---|---|
| G1 | **`SuccessCandidate` 类型根本不存在**（只在 `docs/COLLECTION-LAYER-SPEC.md:430` 与 `docs/FLYWHEEL-ARCHITECTURE.md:163` 两份规范里） | `grep -rn "SuccessCandidate" src/ scripts/` ⇒ 零命中 | 它是"新数据模型语义"，而 `REQUIREMENTS.md` §7 门槛① 要求每一步只接**一个已有**能力 ⇒ 它得单独一步 |
| G2 | **`confidence.ts` 的 `tallyRecall`/`tallyAdopt` 零调用方** | `grep -rn "tallyRecall\|tallyAdopt" src/` ⇒ 只有定义处 | 同上；且它是 G1 的依赖（`reusedBy` 要接这两个计数器） |
| G3 | **`plan-review-check.mjs` 没有 CLI**，尽管 `formatPlanReview` 的注释逐字写「给 CLI 与报告用」 | `grep -c "process.argv" scripts/plan-review-check.mjs` ⇒ **0**；`node scripts/plan-review-check.mjs --file x` ⇒ 静默 exit 0 | ★ **账外成立**，但原因与第一版不同：第一版说"不占 N3 的 inScope"，实际漏洞是"N5 曾把它列进 inScope 却只为改成薄壳，而薄壳前提不成立"（`lib/` 里没有 plan-* 产物；两个函数分居两个 scripts 文件，搬进 `src/` 要新列 inScope）⇒ 已从 N5 的 inScope 里去掉，见 §12 第 22 条 |
| G4 | **`admission` 三条判据生产求值点仍然是 0** | `grep -rn "registry.evaluate('admission'" src/` ⇒ 零命中；`gates/registry.ts` 里注册着 3 条 | 它是第七个插入点之外的另一条独立通道；N3 只接"计划审查"这一环，不碰 admission |
| G5 | **`restart` 工具的描述说了它做不到的事** | `src/tools/restart.ts` description 逐字 "reload this plugin so subsequent calls run the code now on disk"；而 `src/hmr-trace.ts` 文件头实测「apply 不被重新执行」 | 与 N4 相邻但根因不同（N4 是"误判失败"，G5 是"工具措辞假相"）；★ **但文件是同一个**（`src/hmr-trace.ts` ∈ N4 的 inScope）⇒ **不是账外**，见 §11.1 |
| G6 | **`reviewStateOf` 只两态，且不读 `checks` 内容** | 探针实测：`reviewed` 内含 fail / unmeasured / 形状坏，**全判 `reviewed`**。注释声称三态 `reviewed\|needs-review\|rejected`，实际只有两个 `return` | 它是**审查链的读数层**，与 N3 的"接线"不同：N3 是把这条链接到生产，G6 是修它读得对不对。★ **N5 不读它**（N5 读 `adversarialReview.outcome` 三态），所以 G6 不是 N5 的前置；但两者是"审查链"的两层读数，**先修 G6 会让 N5 的证据来源更少歧义** ⇒ 建议同批做，不强制排序 |
| G7 | **计划路线造不出 quality kind 的任务** | `StagedPlanMutation.add_task` 只有 `{subject, description?, assignee?, dependencies}`；`src/tools.ts:2049` 把 `kind` 硬编码成 `'work'` | 改它要动 `StagedPlanMutation` 类型 + `edit_plan` schema + `tools.ts` 落盘三处；★ **三处里两处在 N1/N3 的 `entities.ts` 与 N5 的 `tools.ts` 里** ⇒ **不是账外**，见 §11.1。本轮 N5 明确**不依赖**它（N5 判的是 `tier`，由 `inScope` 决定，与 kind 无关） |

★ **G1 与 G2 合起来是一条完整的、可派的一步**（"success 通道"），
但它排在 N2 之后 —— 理由见 §4 N1 的边界那段。
★ **G3 明确不并进 N3**：它在 `scripts/` 下，而 N3 的 inScope 只有 3 个 `src/` 文件
（并进去会改变 N3 的分档与写域，属于"顺手扩写域"）。⇒ 它是 N3 **之后**的一小步。
★ **G6 与 N5 的关系必须写清**（★★ N5.11 之后这句话改过一次，第一版说 N5 读 `adversarialReview.outcome`，
那在口径 A 下成立；**口径 B 下 N5 改读 `task.reviewed` 戳的有无**，于是问题变了）：
- 口径 B 的放行条件是"不存在 large 且无 `reviewed` 戳的任务" ⇒ N5 读的是**戳的有无**，
  而那正是 `reviewStateOf`（`scripts/friction-triage.mjs:1190`）读的同一个东西。
- ★ 但 N5 **只问"有没有"**，不问"戳里的 checks 是不是全 pass" ⇒ G6 那个"fail/unmeasured 也被判 reviewed"
  的缺陷**不会让 N5 放行错的计划**，因为 N5 本来就只把戳当"人看过"的证据，不把它当"审过了"的证据。
- ⇒ **N5 不依赖 G6** 这个结论在口径 B 下**仍然成立，但理由变了**：不是"读的字段不同"，
  而是"**N5 只取戳的存在性这一位**，G6 修的是戳内部三态，两者不重叠"。
- ★ 如果将来有人把 N5 加强成"戳里的 checks 必须全 pass"，**那时 N5 就必须先等 G6 修好**
  —— 否则它会读到"审了而没过"与"审过了"同形的值。
⇒ 记在这里：**N5 只取 `task.reviewed` 的存在性这一位；它不调 `reviewStateOf`，
也不读戳里的 `checks`。** 若将来要读 `checks`，先修 G6。
★ **G7 与 N5 的关系**：N5 判的是 `tierOf(contract)`，而 `tier` 只数 `inScope` 里的现存
`src/` 文件 —— 与 `kind` 无关。⇒ 即使计划路线造的全是 `work` 任务，N5 照样能判它们的 tier。
★ **G4 / G5 各自独立**，本轮不动。

---

## 12. 这份计划自己的修订账（★ 写坏了什么、怎么改的、现在是否可复跑）

★★ 这份文档在撰写过程中**被自己的读数推翻了 17 次**。把它们集中在这里，理由有两条：

1. **本仓记账最贵的纪律是"三态不许同形"** —— 一份"写完了、看不出改过几次"的计划，
   与一份"从头就对"的计划在纸面上同形。这份账把那个区别写出来。
2. 每一条的错误形状都在这个仓库里**反复出现过**（见末列），对下一个写计划的人是现成的教训。

| # | 我第一版写了什么 | 实测是什么 | 错误形状 | 可复跑读数 |
|---|---|---|---|---|
| 1 | `node scripts/plan-review-check.mjs --file …` 能跑 | 该文件**没有 CLI**，静默 exit 0 | 「代码里有 ⇒ 能用」 | `grep -c process.argv scripts/plan-review-check.mjs` ⇒ 0 |
| 2 | `adversarialReview(c, {status:'fine'})` | 第二参数要的是 `tierOf(...)` 的返回 | 编造入参形状 | §5 的命令 |
| 3 | 打印 `x.status` | 字段名是 **`x.verdict`**，读错只静默给 `undefined` | 读错字段名不报错 | 屏幕上全是 undefined |
| 4 | `distinct` 语料 440 | **520** | 按 `task.commands` 取值，真字段是 `commandsRun` | §2.2 |
| 5 | `带≥1条exit0` = 127/223/153 | **128/224/154** | 边界（空数组）未计 | §2.2 |
| 6 | `reviewed.at` 早于门上线 = 95 条 | **90 条**（阈值 `PLAN_REVIEWED_GATE_ONLINE_AT` = 2026-10-09T09:33:50+08:00） | 数字无来源 | `plan-reviewed.ts:222` |
| 7 | N1/N2/N3 都"无前置" | 写域两两相撞 ⇒ 必须串行 | 只按逻辑依赖排，没按写域排 | §3 |
| 8 | N4 是 `1 文件 small` | **2 文件 ⇒ large** | 数错自己列的文件 | §3 |
| 9 | N5 放行条件 = "全部任务 small" | **历史 6 团队通过率 0%** | 没拿历史数据回放就定判据 | **§N5.11** |
| 10 | `describePlanLoop` 判定顺序 `running` 在最前 | 必须 `halted` 第一 —— `haltTeamWork` 不要求 running | 声称"与既有同序"却没核对既有 | `src/tools.ts:538`、`quality-gates.ts:2739` |
| 11 | N5 读 `adversarialReview.outcome`（口径 A） | 口径 B 下改读 `task.reviewed` 的**存在性** | 改判据后没同步改"它读什么" | §11 G6 段 |
| 12 | "全仓没有 staged 团队夹具" | `lifecycle-verify.mjs` 有 3 处真 approve | 检索词用错就当零命中 | §N5.10 |
| 13 | `adversarialReview` 拦不住"格式对内容空" | 它**只认存在性措辞**；"已检查过/测试通过/输出正确"全部 pass | 把正则当完整语义 | §5 |
| 14 | `checkPlanReview` "几乎不会判 missing" | 它**拦得住**"完全没读数"（无数字⇒missing），只漏"有数字但无关" | 说过头（方向反了） | §5 |
| 15 | `observeShaped` = "有 source 且有 message" | `message` 在 29 行里**一条都没有**；正确口径是 `source.where` 存在 | 定义与数字对不上（数是对的） | §2.1 |
| 16 | `confidenceOf` 零消费者 | 有消费者（`evaluator/score.ts:146`）；断链在**更上一层** | 只说"零"没查间接调用 | §7 |
| 17 | HMR 12 条历史任务"都在重载窗口内" | **无法回溯证实**（重载只留最后 50 条） | 把"当场测到的因果"当"历史可追溯" | §2.4 |

★★ **这张表本身也有一条限制**：它只列**我自己发现**的错误。
还有没被发现的（§5 已说明：`adversarialReview` 那五问在"内容空洞但非存在性措辞"上全部放行）。
⇒ ★★★ **而这条限制的下半段已经在 §12.2 里被证实了**：外部审查独立查出 **10 条**，
其中 **#23（escalated 不可逆）与 #25（keyPresent 上限 29）是我写到 §12.1 之后才被推翻的**
—— 也就是说，**17 条自查与 10 条外部审查，重叠度是 0**
（不算 #18：那一处它也承认我第一次对撞是对的，只是我的推论错）。
这不是"我查得还不够"的证据，是 **"自查有硬上限"** 的证据。

### 12.1 从这张表里能提炼的两条

★ **第一，这个仓库里最贵的缺陷形状是"静默给空值"，不是"抛出异常"。**
表里的 #3（`status` vs `verdict`）、#4（`commands` vs `commandsRun`）、#15（`message` 不存在）
是**同一个形状的三次实例**：读错一个字段名，程序不报错，得到一个看起来像真的的空值。
⇒ 所以 N0 的规格里写死了一条：**readout 必须以"能打印出 pass/fail/unmeasured 三个字"为验收**，
而不是以"脚本没崩"为验收。

★ **第二，判据必须拿历史数据回放，否则它只是作者的一个想法。**
表里的 #9 是这张表上唯一一条**会导致上线即瘫痪**的错误，而它被抓出来
不是因为我想得更仔细，而是因为我拿 `.agent-teams/` 里 6 个真实团队跑了一遍。
⇒ 这条应该成为 N3/N5 之后**所有新判据的默认动作**：先回放历史，再看通过率。

---


### 12.2 对抗性审查（外部，只读）抓出的 10 条 —— ★ 这是 12.1 那两条提炼的实证

★★ §12.1 说"这张表只列我自己发现的错误"。**下面是别人发现的**。
审查者钉死了审读版本（MD 1398 行 / md5 `4a5d9e53d1f04c9daedfa422643869ea`），
并**独立复现了 3/15**（这一步是我判断它可信的根据 —— 它不是读我的数字，是自己算的）。

| # | 它说什么 | 我验了吗 | 结论 | 改法 |
|---|---|---|---|---|
| 18 | §11 断言"G1–G7 都不属于 N0–N5 写域"是**错的**：机械对撞显示 G3→N5、G5→N4、G7→N1/N3/N5 | ✅ 复算：G3 那一处确实是 N5 第一版 inScope 里的 `scripts/plan-review-check.mjs` | **成立** | §11 重写；★ 但同时发现 N5 那一步本身也是错的（第 22 条）⇒ 最终 G3 仍账外、G5/G7 相交 |
| 19 | §7 漏了最便宜的第 0 条：**方向由人给**（`REQUIREMENTS.md:290` 逐字要求），§7 区间 `grep "人给出"` = 0 | ✅ 复跑，零命中 | **成立** | §7 加第 0 行 + 7.2 新增"方向 → 缺陷密度"一节 |
| 20 | 深挖不必整体推迟：原料 §2 已全采到，`frictions/` 393 条按 component 分桶现成 | ✅ 复跑：`dispatch 170 / completion 164 / contract 24 / …` | **成立** | N0 加 `directions` 一档输出（零新文件、零新步骤） |
| 21 | N1 的 `CollectionIndex` **没有派生方** —— 计划承认"派生口径"存在却没一步产出它 | ✅ `grep index.json src/ scripts/` 零命中；`lastBySource` 6 处全是定义/构造空 | **成立，且比它说的更严重**：`cooldown` 29/29 `unmeasured` 不是"判据坏了"，是**输入从未存在过** | 新增 N1.2；N1 inScope +`src/evolution/read.ts` |
| 22 | N5 第 6 步"把 `plan-review-check.mjs` 改成从 `lib/` 再导出的薄壳"**没有主**：`lib/` 里没有 plan-* 产物，两个函数分居两个 scripts 文件 | ✅ `ls lib/ \| grep -i plan` 零命中 | **成立** | **砍掉那一步**（N5 inScope 去掉该文件）；G3 回账外 |
| 23 | ★★★ N5 第三层闸复用 `team.escalated`，而它**全仓没有清除点** | ✅ `escalated = true` 一个写入点（`entities.ts:5672`）；`escalated = false/undefined/delete` 零命中；`resume.ts` 只清 `halted` | **成立，且是最危险的一条**：一次计划超轮 = 整队永久不可交付，`resume` 也解不开 | 新增 N5.14；改用本队自己的 `planReviewEscalated`；加负向 acceptance ⑩ |
| 24 | `maxRounds 从 reviewPolicy 取` 结构上做不到（`ReviewPolicy` 四处封闭的五格） | ✅ `types.ts:311` / `profiles.ts:24` / `profiles.ts:1073`（直接抛）/ `quality-gates.ts:466` | **成立** | 新增 N5.15；改模块常量 |
| 25 | ★★ N1 acceptance "`keyPresent` 0 → = signals.total"**上限是 29 不是 39**；真根因是 `JSON.stringify` 丢弃 `undefined` | ✅ 复跑：10 条 t88 旧行无该格；`JSON.stringify({a:1,b:undefined})` ⇒ `{"a":1}` | **成立，且我第一版把根因也写错了**（写成"从未落盘"，实为"写了但键被吃掉"） | 新增 N1.1；acceptance 改双读数；S2 停止点同步改 |
| 26 | N5 标 `kind: requirements` 却实改 4 个 src 文件（`requirements.requiredGates = []`） | ✅ 读 `kind-requirements.json`：`requirements => []`、`implementation => [r5, mutation, backtest]` | **成立** | JSON 里 `kind` 改 `implementation`，并在 `tierNote` 记理由 |
| 27 | N5 的逃生口（`confirmation` 点名词）**今天没有落点**：`approve.ts:38` 判空后就丢掉 | ✅ `grep confirmation` 只有 `approve.ts:19` 定义 + `:38` 判空 | **成立** | 新增 N5.16；N5 inScope +`src/tools/approve.ts` |

★ **一条它说对了但我保留原设计**（第 28 条，写在 `describePlanLoop` 那里）：
它建议把五态砍成 `{rounds, maxRounds, reason, canEnd}`。三个态的批评成立，
但 `escalated` 是新信息，且 `halted` 必须先于 `approved` 这个**顺序**只有收进一个函数才有地方写。
⇒ 保留五态，把理由写进正文。**这一条记在这里是为了让"没改"也有一个可读的理由** ——
否则下一个读文档的人会以为是没看见。

★★ **这张表与 12.1 的关系**：12.1 是我自己发现的 17 条，12.2 是别人发现的 10 条。
**同一个人自查能发现的和外部审查能发现的，重叠度是 0**（#23/#25 是我写完 12.1 之后才被推翻的）。
⇒ 这条本身就是"自迭代为什么必须有外部审查环"的最强证据：
**自查只能提高下限，够不到自己没想到的那一类。**

---

*本文件只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`、`.agent-teams/`。*
