# 产出消费普查：24 条"只有夹具消费"的具名清单（2026-10-23）

> **本文回答的问题**：`gate-producer-consumer.test.mjs` 臂 4 报 `fixtureOnly = 24`，
> 但那只是一个数字。**这 24 个东西叫什么、为什么不能有生产消费者？**
>
> **用途**：下一轮处置时的唯一输入。数字不可处置，名字可以。
>
> 基线：`task-mutation-integrate` @ `830a45e`。由 `wire-fixer` 采集，主理人复核了"臂 2 断言"那一条。

---

## 0. 一句话结论

**臂 4 的上限 20 在「只改源码、不改判据」的前提下不可达。**

```
臂 2：workspaceAndWorktreeChangedPaths 硬性断言 production === 0（gate-producer-consumer.test.mjs:362）
臂 4：fixtureOnly ≤ 20
⇒ 第 3 条必然留在计数里，任何"把它接上"的做法都会当场打红臂 2
```

★ **但「不可达」只在这个前提下成立。** 臂 2 的断言文案自己给了改制指引（逐字）：

> 「若那是真的修复，请把这一臂改成断言"它已被消费"并注明日期；
>  若那是误报，说明判据的分界读错了（它把夹具调用算进了生产）」

⇒ **真正的结论是**：这道门要绿，必须**同时**做两件事 ——
① 给 `workspaceAndWorktreeChangedPaths` 接上真实生产消费者；
② 按它自己写明的指引把臂 2 改成"它已被消费"并注日期。

**②属于改判据面，需要用户点头。** 在此之前，红是正确状态，不是失败。

与 `docs/PIN-LIST-ROT.md` 同族：**记账值腐化了，而清单自己的退场判据没被执行。**

---

## 1. 性质分布

| 性质 | 条数 | 含义 |
|---|---:|---|
| `OLD_DEBT` | 17 | `077b794` 之前就在，`ORPHAN-AUDIT.md` 逐条判过「保留」 |
| `DESIGN_EXIT` | 4 | 镜像字面量 / 自检断言 —— **接了就是恶化** |
| `NO_EVENT_SOURCE` | 3 | 缺的是观测点，`src/` 里今天不存在那个事件源 |
| `WIRED_BY_ME` | 0 | 本次接的 7 条已离开计数（见 §3） |

---

## 2. 24 条清单

| # | 产出名 | 定义 | 性质 | 为什么不能有生产消费者 |
|---|---|---|---|---|
| 1 | `invokedAgentTeamsGoal` | `src/command.ts:61` | OLD_DEBT | 薄封装；生产的读法在 `command.ts:128` 直接拿 `invocation`、`:138` 读 `.goal` |
| 2 | `verdictState` | `gates/admission/checkpoint.ts:645` | OLD_DEBT | 注释逐字：「一条**只在夹具里用得到**的出口」；`convene.ts:304` 明说**故意不** import（判据之间不互相调用） |
| 3 | `workspaceAndWorktreeChangedPaths` | `harness-compat.ts:563` | OLD_DEBT | ★ **臂 2 硬性断言 `production === 0`** —— 接上就打红臂 2。它是 t41 原型的标本，"只有夹具消费"正是被测的性质 |
| 4 | `parseStatusLine` | `mutation-guard.ts:163` | OLD_DEBT | 与 `collectChangedPaths` / `gitChangedPaths` 是同一规则的第三份写法，**但差分对拍 13 例里 2 处行为不同**（`RM a.ts -> "b c.ts"` 只取到前半；裸 `??` 被当路径）⇒ **不是可安全替换的重复实现** |
| 5 | `checkMutationGuard` | `mutation-guard.ts:226` | OLD_DEBT | 全仓零调用（`entities.ts:1077` 逐字记过）。★ 附带真缺陷：它声明的 `gitStatus`(`:101`) **从未被读** |
| 6 | `readContractGateVerdict` | `quality-gates.ts:2173` | OLD_DEBT | `baseline-known-failures.json:22` 记着它被**两条裁定夹住**（本臂要求接 / t5 要求契约位保留拒绝 `unmeasured`）。接上会让"判不了契约的任务静默进入工作" |
| 7 | `teamLockQueueKeys` | `state.ts:107` | OLD_DEBT | 锁队列诊断快照；唯一消费方 `verify.mjs`（物理在 `scripts/`） |
| 8 | `buildDeliveryRecord` | `state.ts:430` | OLD_DEBT | **无写入点**：`task.delivery` 全仓只有两处**读**（`state.ts:284`/`:522`），零处写 |
| 9 | `describeDeliveries` | `state.ts:572` | OLD_DEBT | 同上族；输入 `summariseDeliveries` 的唯一"消费"是自己的 `ReturnType<>` 类型引用 |
| 10 | `removeTeamDir` | `state.ts:1441` | OLD_DEBT | 生产删队走 `archiveTeamDir`（归档语义）；硬删只给夹具清理 |
| 11 | `readExperienceDispatch` | `tools/shared/entities.ts:2411` | OLD_DEBT | 要接的「卡点 ⇒ 任务」下游**在 `src/` 里不存在** |
| 12 | `rehydrateReplayCtx` | `tools/shared/entities.ts:4424` | OLD_DEBT | 重放是夹具侧机制；生产没有"重放历史卡点"的路径 |
| 13 | `runtimeGateLogSnapshot` | `tools.ts:903` | OLD_DEBT | 注释逐字「**控制台**/夹具读它」；生产侧没有那个控制台 |
| 14 | `waitRecordSnapshot` | `tools.ts:914` | OLD_DEBT | 生产**不需要快照**：内部直接读 Map 本体（`tools.ts:1148`） |
| 15 | `waitWindowSnapshot` | `tools.ts:936` | OLD_DEBT | 同上 |
| 16 | `resetWaitRecords` | `tools.ts:949` | OLD_DEBT | 注释逐字「**只给夹具用**：进程级状态会跨用例残留」 |
| 17 | `describeReclaimability` | `worktree.ts:1906` | OLD_DEBT | ★ **其实已被生产消费**：`scripts/worktree-reclaim.mjs:126` import、`:233`/`:294` 调用，该 CLI 还经 `update-task.ts` 的 `pluginRoot()` **动态 import** ⇒ 只是**物理路径在 `scripts/` 被分桶成夹具**（`ORPHAN-AUDIT §4` 记过这例） |
| 18 | `tallyRecall` | `confidence.ts:88` | NO_EVENT_SOURCE | `F-LINE-FLYWHEEL.md:209` 逐字：「没有生产路径调用它们（还没有地方在产生这两个计数）」⇒ 缺"检索命中"观测点 |
| 19 | `tallyAdopt` | `confidence.ts:93` | NO_EVENT_SOURCE | 同上，缺"采纳"观测点 |
| 20 | `isLeadSession` | `lineage.ts:238` | DESIGN_EXIT | 注释称给那 9 处用，实测**已全部**改用 `sessionLeadsTeam`（19 处）。接了=造第二个入口 |
| 21 | `readTeamEx` | `state.ts:696` | NO_EVENT_SOURCE | 裁定「甲」：28 处 `readTeam` 的区全部确定，「区不存在」不会发生 ⇒ 三态里的 `no-region` 无场景 |
| 22 | `checkEmptyIsNotPerfect` | `evolution/health.ts:138` | DESIGN_EXIT | 自检断言；`collectionHealthOf` 已内联同口径（`health.ts:171`）⇒ 生产调它=把断言变成运行时分支 |
| 23 | `FAILURE_KIND_NAMES` | `types.ts:360` | DESIGN_EXIT | `types.ts` 不能 import `state.ts` 时的**镜像字面量**，唯一用途是被 `gate-execution-history.test.mjs:421` 逐字比对。生产读它=镜像变真值 |
| 24 | `GATE_INSERTION_POINTS` | `types.ts:395` | DESIGN_EXIT | 同上，由 `gate-insertion-point-parity.test.mjs:45` 逐字逐序钉住 |

---

## 3. 本次已接的 7 条（已离开计数）

| 产出 | 定义 | 生产消费点 | 消掉的是什么 |
|---|---|---|---|
| `modelBindingOf` | `tools/create-task.ts:145` | `describeModelBindingForCreate:200` | 函数体**逐字相同**的第二份 |
| `rescueStateOf` | `tools/shared/entities.ts:3688` | `normalizeRescueInput:3930` | 同一规则的**第三份** |
| `duplicateSignalIds` | `evolution/collect.ts:252` | `readSignalsHealth`（`evolution/read.ts:153`） | 读取端第一次主动问「有没有撞 ID」 |
| `summariseExecutions` | `types.ts:1422` | `tools/status.ts:1005` | task 投影第一次送 `execution` |
| `dependencyStatuses` | `state.ts:360` | `scheduler.ts:952` | `DispatchTicket` 第一次带依赖结果 |
| `describeDependencyOutcomes` | `state.ts:385` | `scheduler.ts:952` | 同上 |
| `appendSignalClaimingId` | `evolution/collect.ts:346` | `observe()`（`collect.ts:658`） | ★ **注释声称用它，代码一直用两步式**（t93 已判缺陷） |

读数：`fixtureOnly 31 → 24`，单调下降，无一条走平或变大。

---

## 4. ★ 两条比清单更重要的事

### 4.1 分桶盲区：`describeReclaimability` 其实**有**生产消费者

它的消费方 `scripts/worktree-reclaim.mjs` 是个**生产 CLI**，还经 `pluginRoot()` 动态 import。
只是它的**物理路径在 `scripts/` 下**，于是被本装置分桶成"夹具"。

⇒ **判据用「路径」推断「是不是夹具」，而路径不等于用途。**
这与本仓记过多次的形态同族：**用位置代替语义。**

**影响**：这 24 里有多少条其实是这个盲区？至少 #17 是。下次处置前应先按"用途"复核一遍，不能按路径。

### 4.2 `collection` 位从来没做过输入面核对

`gate-input-wiring` **臂 10** 的实测读数（`scripts/gate-input-wiring.test.mjs:673`）：

```
evaluate: {"collection":3, "delivery":2, "runtime":1, "contract":1, "completion":1, "dispatch":1}
audit   : {              "delivery":2, "runtime":1, "contract":1, "completion":1, "dispatch":1}
```

⇒ **`collection` 有 3 处 `evaluate`，0 处 `inputSurfaceOf`。**

配合另一条实测（本轮独立复核过）：

```
admission：注册 3 条判据，全仓 evaluate('admission') 零命中
```

⇒ **七个插入点里，至少有两个从来没被真正核对过**：
- `admission` —— 从未求值
- `collection` —— 求值了，但从未做输入面核对

**这两条是存量红，不是本次引入**（未改动基线上逐字复现）。

★ **含义**：`pnpm verify` 全绿并不等于"七道门都在工作"。**至少两道门是半活的**，而它们在日志里与正常门同形 —— 这正是本仓记了一整年的那个形态。

---

## 5. 未做的处置

| 类 | 条数 | 为什么不做 |
|---|---:|---|
| `DESIGN_EXIT` | 4 | 接了就是把断言变运行时分支、把镜像变真值 |
| `NO_EVENT_SOURCE` | 3 | 缺观测点，硬接=造一个假事件源 |
| `OLD_DEBT` 里的进程态快照 5 条 | 5 | 要接得先新造 `/degraded` 诊断面 ⇒ **新增产品面**，不是补一行读取 |
| `parseStatusLine` | 1 | 差分对拍证明它**不是**可安全替换的重复实现（2/13 行为不同） |

---

*本文只写 `docs/PRODUCER-CONSUMER-CENSUS.md`。未改动 `src/`、`scripts/`、`lib/`。*
