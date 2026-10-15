# M1 · 模块地图：7 个超大文件的职责拆解（只读）

> **本任务的性质**：**只读分析**。M2–M4 才是改动。本文件未改动任何 `src/` 文件（自证见 §9）。
> **基线**：HEAD `5cc8e40`（分支 `task-mutation-integrate`）。
> **方法**：每个"职责"都附**符号名 + 行范围**，全部可用文中命令复跑 —— **不凭印象**。

---

## 0. ★ 先纠正三处前提（任务书的数据有两处漂移，且有一处框架误导）

### 0.1 两个行数与实测不符（漂移来源可指）

任务书给的 7 个行数，我逐个复测（`wc -l`）：

| 文件 | 任务书写 | **实测** | 差 |
|---|---:|---:|---:|
| `quality-gates.ts` | 2520 | **2512** | −8 |
| `tools.ts` | 2227 | **2227** | ✅ |
| `mutation.ts` | 1705 | **1692** | −13 |
| `state.ts` | 1504 | **1504** | ✅ |
| `members.ts` | 1465 | **1465** | ✅ |
| `worktree.ts` | 1296 | **1296** | ✅ |
| `scheduler.ts` | 1246 | **1246** | ✅ |

```sh
$ wc -l src/quality-gates.ts src/tools.ts src/mutation.ts src/state.ts src/members.ts src/worktree.ts src/scheduler.ts
    2512 src/quality-gates.ts
    2227 src/tools.ts
    1692 src/mutation.ts
    1504 src/state.ts
    1465 src/members.ts
    1296 src/worktree.ts
    1246 src/scheduler.ts
```

⇒ 5 个准、2 个漂（`quality-gates` / `mutation` 在此期间被别的任务改过）。
★ **本文一律用实测值**，并在 §1 的每张表里标出与任务书给的值的差异。

### 0.2 ★★ 最重要的一条：这些"超大"里 **29%–64% 是注释**，"行数"不是"职责量"

任务书把行数当职责量的代理（「不是"它有多少行"，是"它混装了几个职责"」——
但**前提仍然是行数**）。用 block-comment 感知的解析器实测（脚本见 §9 口径 A）：

| 文件 | 总行 | 注释行 | 注释占比 | **代码行** | **代码占比** |
|---|---:|---:|---:|---:|---:|
| `quality-gates.ts` | 2512 | 833 | 33% | **1544** | 61% |
| `tools.ts` | 2227 | 1445 | **64%** | **640** | **28%** |
| `mutation.ts` | 1692 | 498 | 29% | **1088** | 64% |
| `state.ts` | 1504 | 502 | 33% | **918** | 61% |
| `members.ts` | 1465 | 605 | 41% | **797** | 54% |
| `worktree.ts` | 1296 | 790 | **60%** | **458** | **35%** |
| `scheduler.ts` | 1246 | 539 | 43% | **663** | 53% |

★★ **这条改变了 M 线的整个论证**：
- `tools.ts` **2227 行里只有 640 行是代码**（28%）⇒ 它是**被注释撑大的**，不是"职责混装"。
  为它写一个 M3「拆分」任务的**收益要先论证** —— 因为**拆注释不减少代码复杂度**。
- `worktree.ts` 同理（60% 注释 / 458 行代码）。
- **真正"代码多"的是** `quality-gates.ts`（1544）· `mutation.ts`（1088）· `state.ts`（918）。
⇒ **本文对每个文件都给出"代码行"口径**，并据此排优先级（§8）。

★ **注意这不是说注释没用** —— 本仓的注释承载**实测记录与裁定理由**（例如 `quality-gates.ts` 的
`t43` / `t54` 记录）。**本文的论点是：注释量不能用来论证"该拆"**，因为拆注释对复杂度**零收益**。

### 0.3 `mutation.ts` 与 `worktree.ts` 是 **fork 全新文件**，上游冲突面 = 0
★ **口径提醒**：下文对二者有**两个不同的「零」**，不要混：
· **零上游冲突面**（上游无此文件）—— 两者都成立；
· **零 import**（纯函数模块）—— **只有 `mutation.ts` 成立**；`worktree.ts` 有 3 个 `node:` builtin import（见 §4）。

```sh
$ git cat-file -e upstream/main:src/mutation.ts 2>/dev/null && echo PRESENT || echo ABSENT
ABSENT
$ git cat-file -e upstream/main:src/worktree.ts 2>/dev/null && echo PRESENT || echo ABSENT
ABSENT
```

⇒ 这两个文件**上游不存在**（`git show upstream/main:src/<f>.ts | wc -l` ⇒ 0）。
★ 任务书说「至少 `tools.ts` 是」会加大冲突面 —— **对**；但它没说的另一半是：
**这两个文件拆分对上游冲突面零影响**（上游根本没有它们）。
⇒ **优先级应当据此调整**：先拆**零冲突面**的，再拆有冲突面的（§8）。

---

## 1. 逐文件职责地图

每个文件给出三段：**(a) 它混装了几件事** · **(b) 每件事的符号 + 行范围** · **(c) 建议拆成几块 + 搬运性质**。

★ **关于"可纯搬运"这个词（任务书硬纪律要求加限定）**：
本文一律写作「**逻辑等价搬运**」，定义是：**导出集合与行为在拆分前后逐条相等**，
**不是"不产生 diff"** —— 因为改 `src/` 会触发构建链（`rootDir=src`、**173 个被跟踪的 `lib/` 产物**），
产物必然重算。凡本文写「逻辑等价搬运」处，都同时给出**该等价性的验证方式**（通常是对拍导出集合）。

---

### 1.1 `src/quality-gates.ts` — 2512 行 / **1544 代码行** / 68 个导出

**混装了 6 件事**（不是"纯谓词 + 校验器 + 裁决"三合一 —— 任务书/计划给的这张三分法与实测不符）：

| # | 职责 | 符号（行号） | 行范围 | 规模 |
|---|---|---|---|---|
| **Q1** | **纯路径谓词**（无 I/O、无 team 状态） | `normalizeWorkspacePath:269` · `pathMatchesScope:285` · `isDefaultExcludedPath` · `classifyChangedPath:315` · `collectChangedPaths:643` · `inScopeOverlap:663` · `PathClassification:51` | `~259-370` · `~643-742` | ~210 行 |
| **Q2** | **文本/语料谓词**（从字符串里读出东西） | `repoPathsNamedIn:771` · `verifyTargetOf:785` · `armsNamedIn:802` · `subjectTermsIn:830` | `~771-889` | ~120 行 |
| **Q3** | **契约校验与修订** | `CreateTaskInput:53` · `ValidateCreateTaskResult:121` · `validateCreateTask:1011` · `amendTaskContract:1881` · `ContractAmendmentInput:1850` · `AmendTaskContractResult:1858` | `~53-128` · `~1011-1631` · `~1850-2005` | **~750 行** ← 最大 |
| **Q4** | **完工裁决与修复判定** | `QualityCompletionUpdate:129` · `QualityCompletionResult:139` · `repairEvidenceFiles:371` · `repairCompletionVerdict:478` · `RepairCompletionContext:509` · `GATE_INPUT_FIELDS:549` · `traceEvidenceConsumer:574` · `EvidenceConsumerReading:556` · `evaluateQualityCompletion:1686` · `repairScopeFromFindings:1832` | `~129-154` · `~371-638` · `~1686-1849` | ~600 行 |
| **Q5** | **交付与覆盖矩阵** | `CoverageRow:179` · `DeliveryResult:186` · `buildCoverageMatrix:2080` · `canDeclareDelivery:2095` · `planQualityFollowUp:2006` · `PlannedFollowUpTask:155` · `PlanQualityFollowUpResult:172` · `defaultQualityDeliveryGraph:2347` | `~179-190` · `~2006-2154` · `~2347-2411` | ~350 行 |
| **Q6** | **守卫与规范化**（`is*` / `normalize*` / `sanitize*` / 文案） | `isReviewPolicy:248` · `isReviewFinding:2174` · `isAcceptanceResult:2185` · `isCommandResult:2192` · `isTaskRevision:2200` · `normalizeBlankOptionalTaskFields:2234` · `hasValidQualityTaskFields:2251` · `isReviewVerdict:2304` · `isReviewedCheckVerdict:2329` · `sanitizeReview*:2337/2342` · `looksLikeGateTestContract:2333` · `qualityPlanningPrompt:2412` · `describeQualityLoop:2426` · `resumeTeamState:2156` · `QualityLoop*:198-207` · `isTaskEvidence:2470` · `appendTaskEvidence:2482` | `~2174-2512` | ~340 行 |

**另有 1 个跨类职责**：`readContractGateVerdict:1649` + `ContractGateReading:1634`
—— 它**读判据的裁决**（`gates: {...}`），**与 gates 层耦合**，不属于以上 6 类中的任何一类。

**★ 混杂处（可从源码核对）**：
- **Q1（纯谓词）与 Q3（契约校验）共处一个文件**：而 `src/gates/{admission,dispatch}/*.ts` **只 import Q1**
  （`grep -rn "from '../../quality-gates" src/gates/` ⇒ absorb/checkpoint/convene/changed-paths 四文件），
  它们**拿不到也永远不该拿到 Q3**。⇒ **Q1 是判据层真正的公共面**，被混在这里。
- ★ **本文件 import `node:fs`**（`:7` `import { existsSync, readFileSync } from 'node:fs'`）——
  与 `src/gates/**`（**零 I/O import**）形成对照。⇒ **Q1 若与 Q3 同文件，判据层就"间接"依赖了 I/O 模块**
  （`grep -rn "from 'node:" src/gates/*/*.ts` ⇒ **无输出**，那是现状；
  但它们 import `quality-gates.ts`，而后者 import `node:fs`）⇒ ★ **这是一个真实的现状矛盾**，见 §2。

**建议拆 4 块**（不是 6，理由见下）：

| 块 | 内容 | 搬运性质 | 验证方式 |
|---|---|---|---|
| **QG-A · 纯路径与文本谓词** | Q1 + Q2 + `PathClassification` | **逻辑等价搬运** | 导出集合对拍；`src/gates/**` 的 4 处 import 改指新文件 |
| **QG-B · 契约校验与修订** | Q3 | **逻辑等价搬运** | 导出集合对拍 |
| **QG-C · 完工裁决与修复** | Q4 + `readContractGateVerdict` | **逻辑等价搬运**（但见 §2 的 I/O 争议） | 导出集合对拍 |
| **QG-D · 交付/覆盖/守卫/文案** | Q5 + Q6 | **逻辑等价搬运** | 导出集合对拍 |

★ **为什么不拆 6 块**：Q5 与 Q6 之间**有真实调用**（`canDeclareDelivery` 用 `isReviewFinding` 等守卫），
拆开会让"守卫"变成两个模块都要的公共件 —— **那是造一个新的公共面**，与本任务目的相反。

★ **上游冲突面**：**有**（上游此文件 2109 行，是 fork 的**主要改造对象之一**）。
`git diff --numstat upstream/main HEAD -- src/quality-gates.ts` ⇒ **+1360 / −957**（two-dot）。
⇒ 拆它**会加大冲突面**（§3）。

---

### 1.2 `src/tools.ts` — 2227 行 / **仅 640 代码行（28%）** / 13 个导出

★★ **这是本次分析最反直觉的一条：`tools.ts` 的 2227 行里 1445 行是注释。**
实测最大的一段"空洞"：**`:1240-1728` 共 ~490 行，非注释非空行为 0**（脚本见 §9 口径 B）。

**混装了 5 件事**：

| # | 职责 | 符号（行号） | 行范围 | 代码规模 |
|---|---|---|---|---|
| **T1** | **工具注册主体**（`defineTool` × 全部 agent_teams_* 工具） | `registerAgentTeamsTools:1729` · `memberRuntime:2218` | `1729-2226` | **~490 行** ← 唯一的大块 |
| **T2** | **派发/探活记账**（内存表 + 快照） | `waitRecordSnapshot:848` · `waitWindowSnapshot:870` · `resetWaitRecords:883` · `runtimeGateLogSnapshot:837` · `recordDispatchStart:1033` · 常量 `DEFAULT_PROBE_INTERVAL_MS_FALLBACK:1003` · `WAIT_WINDOW_STALE_MS:1004` | `837-1002` · `1003-1212` | ~290 行 |
| **T3** | **staged plan 提示词构造**（纯字符串） | `stagedPlanApprovedContext:596` · `stagedPlanDiscardContext:606` · `stagedPlanFeedbackContext:616` | `596-836` | ~30 行代码 + ~210 行注释 |
| **T4** | **base revision 持久化**（**I/O**） | `rememberWorktreeBase:254` · `persistTaskBaseRevision:285` · `readWorkspaceFile:412` | `254-483` | ~230 行 |
| **T5** | **staged graph 校验** | `requireStagedTeam:484` · `validateStagedGraph:493` · `haltTeamWork:535` | `484-595` | ~110 行 |
| **T6** | **会话内容观察**（判据输入面） | `sessionSpokeWithContent:1213` | `1213-1239` | ~27 行 |

**★ 混杂处的证据**：`T1`（工具注册）**独占 1729–2226**，而它前面的 **1500 行**是
**T2–T6 五件互不相关的事** + **490 行注释**。
⇒ 所谓"`tools.ts` 职责混装"，**实测的形态是**：一个 490 行的注册函数 + 五件小工具 + 一堵注释墙。

**建议拆 3 块**：

| 块 | 内容 | 搬运性质 |
|---|---|---|
| **T-A · 工具注册主体** | T1 | **逻辑等价搬运**（导出集合对拍：仅 `registerAgentTeamsTools`） |
| **T-B · 运行时记账** | T2 + T6（都是"给判据喂观察"） | **逻辑等价搬运** |
| **T-C · staged plan + base 持久化 + graph 校验** | T3 + T4 + T5 | ★ **需先裁定**：T4 带 I/O，T3 是纯字符串 —— **性质不同，不该同块**。⇒ **建议 T-C 再分两块**（见下） |

★ **修正后的建议 = 4 块**：T-A（注册）· T-B（记账+观察）· T-C1（staged plan 纯字符串）· T-C2（base 持久化 + graph 校验，带 I/O）。

★ **上游冲突面：最大**（见 §3）：
```sh
$ git diff --numstat upstream/main HEAD -- src/tools.ts
1685    2335    src/tools.ts        # two-dot：fork 相对上游 HEAD
$ git diff --numstat 98aac03 upstream/main -- src/tools.ts
395     90      src/tools.ts        # 上游自己在同一时期也改了它
```
⇒ **双方都在动它** ⇒ 这是 7 个文件里**唯一"双向大改"**的（§3 表）。

---

### 1.3 `src/mutation.ts` — 1692 行 / **1088 代码行** / 57 个导出 / ★ **零 import**

★★ **它是 7 个文件里唯一"零 import"的** ⇒ **纯函数模块，拆分零环风险**（§4）。

**混装了 4 件事**：

| # | 职责 | 符号（行号） | 行范围 |
|---|---|---|---|
| **M1** | **变异算子目录与常量**（数据） | `MutationOperator:47` · `MutationLayer:56` · `L1_OPERATORS:65` · `L2_OPERATORS:78` · `DEFAULT_OPERATORS:85` · `OFTEN_EQUIVALENT:100` · `DEFAULT_MAX_PER_OPERATOR:136` · `DEFAULT_MAX_MUTANTS:139` · `MIN_SCORED_FOR_VERDICT:166` · `MutantOutcome:44` | `44-177` |
| **M2** | **变异体生成与去噪**（文本级） | `lineOf:313` · `isChangedLine:320` · `isInsideComment:332` · `isInsideString:362` · `isSkippableOccurrence:391` · `capMutants:178` · `generateMutants:491` · `loadInvariants:545` · `verifyAnchors:581` · `GenerateOptions:473` · `Mutant:223` · `LineRange:244` · `InvariantDefinition:213` · `MutantInvariant:202` | `178-624` |
| **M3** | **测试套件判读**（跑测试的产物） | `probeReach:655` · `ProbeReach:625` · `parseTestSummary:718` · `TestSummary:710` · `failingFiles:754` · `classifyRun:780` · `MutantRun:250` · `MutantResult:280` · `SuiteTarget:292` · `MutationTarget:298` | `625-835` |
| **M4** | **覆盖率解析与打分** | `MutationDisposition:836` · `MutationTotals:842` · `LayerScore:858` · `SurvivingMutant:870` · `ExpectRedViolation:882` · `MutationReport:890` · `ScoreInput:913` · `CoverageFileReading:932` · `coverageUnmeasured:943` · `parseNodeCoverageReport:979` · `matchCoverageFile:1021` · `readExplicitExecutedLines:1052` · `readExplicitTestsByLine:1076` · `parsePerTestCoverageBlock:1108` · `LineCoverageReading:1151` · `MutationCoverage:1153` · `resolveMutationCoverage:1178` · **`scoreMutants:1248`（~200 行）** · `isDecorative:1451` · `MutationEngineInput:1465` · `mirrorMutants:1662` · `noScorableMutants:1686` | `836-1691` |

**建议拆 4 块**：M1+M2（生成）· M3（判读）· M4（覆盖率）· 打分（`scoreMutants` + `isDecorative`）
⇒ **全部是逻辑等价搬运**（零 import、零环风险、导出集合对拍即可）。

★ **上游冲突面：零**（上游无此文件）。

---

### 1.4 `src/state.ts` — 1504 行 / **918 代码行** / 54 个导出

**混装了 6 件事**：

| # | 职责 | 符号（行号） | 行范围 |
|---|---|---|---|
| **S1** | **依赖图判定** | `unsatisfiedDependencies:169` · `DependencyOutcome:214` · `FAILURE_KINDS:235` · `failureKindOf:295` · `dependencyOutcomeOf:248` · `DependencyStatus:322` · `dependencyStatuses:339` · `describeDependencyOutcomes:364` | `169-408` |
| **S2** | **交付记录** | `buildDeliveryRecord:409` · `summariseDeliveries:480` · `describeDeliveries:551` | `409-570` |
| **S3** | **任务状态机** | `TASK_TRANSITIONS:571` · `transitionError:586` · `activateTaskAttempt:605` · `beginTaskAttempt:618` · `cancelUnfinishedTask:636` · `invalidateTaskAttempt:646` | `571-701` |
| **S4** | **持久化与锁**（**I/O**） | `readTeamSync:702` · `readRetiredMemberIdsSync:738` · `AtomicReplacePrimitives:1056` · `AtomicReplaceOptions:1063` · `replaceFileAtomicOrDirect`（非导出，`~1070-1240`）· `teamLockQueueKeys:86` · `sanitizeKey:116` · `CAPTAIN_KEY:48` · `createMessage:842` | `48-168` · `702-1055` · `1056-1241` |
| **S5** | **形状守卫** | `isTeamTask:1242` | `1242-1453`（**212 行** ← 单函数） |
| **S6** | ★ **视觉投影** | `VisualTaskState:1454` · `taskVisualState:1461` · `taskDepthsById:1481` | `1454-1503` |

**★ 混杂处（可从源码核对，且两处是真问题）**：

1. ★★ **S6（视觉投影）是 UI 关心的事，却住在 `state.ts`（持久化+状态机）里**。
   它的消费者**只有 `src/snapshot.ts`**：
   ```sh
   $ grep -rn "taskVisualState\|taskDepthsById" src/ --include=*.ts | grep -v "^src/state.ts"
   src/snapshot.ts:19:  taskDepthsById, taskVisualState,
   src/snapshot.ts:196:  const depths = taskDepthsById(tasks)
   src/snapshot.ts:348:      state: taskVisualState(task.status, task.dependencies, tasks),
   ```
   ⇒ **S6 的落点是 `snapshot.ts`，不是 `state.ts`**（搬它是逻辑等价搬运，但要改 `snapshot.ts` 的 import）。

2. ★★ **`VisualTaskState` 被声明了两次**（`state.ts:1454` **与** `snapshot.ts:25`）：
   ```sh
   $ grep -rn "export type VisualTaskState" src/
   src/state.ts:1454:export type VisualTaskState = 'blocked' | 'open' | 'running' | 'completed' | 'failed' | 'cancelled'
   src/snapshot.ts:25:export type VisualTaskState = 'blocked' | 'open' | 'running' | 'completed' | 'failed' | 'cancelled'
   ```
   ⇒ **两份逐字相同的类型定义**。这不是"混装"，是**重复**。★ 它**不需要判定就能确认**是缺陷：
   两处一旦漂移，"跨模块传的这个类型"与"那个类型"会**静默不兼容**。**归 §2 的"非拆分类发现"。**

3. **S4 独占 ~460 行（含 ~170 行的原子替换）**，而它与 S1/S2/S3/S5/S6 **零调用关系**
   （它提供的是"读写"，那五件是"算"）⇒ **最干净的一条切缝**。

**建议拆 4 块**：

| 块 | 内容 | 搬运性质 |
|---|---|---|
| **S-A · 派生读数** | S1 + S2 + S6 | **逻辑等价搬运**（S6 需改 `snapshot.ts` 的 import） |
| **S-B · 状态机** | S3 | **逻辑等价搬运** |
| **S-C · 持久化与原子替换**（I/O） | S4 | **逻辑等价搬运** |
| **S-D · 形状守卫** | S5 | **逻辑等价搬运** |

★ **附带修掉重复**：`VisualTaskState` 的两处定义收敛为一处（**这会改行为吗？** 不会 ——
两个类型逐字相同；但**必须先确认没有第三方依赖"它们是两个类型"**，见 §2-C）。

★ **上游冲突面：有**（上游 1285 行）。`git diff --numstat upstream/main HEAD -- src/state.ts` ⇒ **+448 / −229**（two-dot）。

---

### 1.5 `src/members.ts` — 1465 行 / **797 代码行** / 41 个导出

**混装了 6 件事**：

| # | 职责 | 符号（行号） | 行范围 |
|---|---|---|---|
| **MB1** | **LLM 路由与回退** | `MemberRuntimeConfig:42` · `MemberLlmSelection:54` · `MemberLlmSelectionRequest:66` · `MemberSelectionRuntime:80` · `isFallbackFailureCode:123` · `selectFallbackRoute:128` · `installMemberSelectionRuntime:355` | `42-122` · `123-354` · `355-531` |
| **MB2** | **人格与欢迎语构造**（纯字符串） | `PERSONA_PROTOCOL_MAX_CHARS:29` · `memberPersona:532` · `memberWelcome:574` | `29-41` · `532-734` |
| **MB3** | **成员生命周期守卫** | `interruptMember:735` · `installRetiredMemberGuard:755` · `installMemberDelegationGuard:763` | `735-825` |
| **MB4** | **活动与存活读数** | `memberActivity:826` · `MemberLiveness:898` · `LivenessReadout:927` · `DRIVER_STATUS_UNREADABLE:932` · `MEMBER_NEVER_SPAWNED:935` · `memberLiveness:951` | `826-997` |
| **MB5** | **搁浅工作/工作树读数** | `strandedWork:998` · `StrandedWorktrees:1048` · `FrozenWorktree:1054` · `FrozenCandidate:1064` · `strandedWorktrees:1102` · `describeStrandedWorktrees:1147` | `998-1214` |
| **MB6** | **子代理投影** | `LiveSubagent:1215` · `SubagentProjection:1235` · `MemberSubagents:1246` · `AGENT_ENUMERATION_UNAVAILABLE:1255` | `1215-1465` |

**★ 混杂处**：**MB1（LLM 路由，~490 行）与 MB4/MB5/MB6（"读成员状态"，~470 行）是两件完全不同的事** ——
前者是**配置与容错**，后者是**观察面**。而 `installMemberSelectionRuntime:355`（~177 行）
与 `installRetiredMemberGuard:755`（~70 行）**都叫 `install*`，却是两类东西**
（一个是模型选择运行时、一个是会话守卫）。

**建议拆 3 块**：MB1（路由）· MB2+MB3（构造与守卫）· MB4+MB5+MB6（观察面）
★ 均为**逻辑等价搬运**。

★ **上游冲突面**：有（上游 1094 行）；two-dot ⇒ **+713 / −342**。

---

### 1.6 `src/worktree.ts` — 1296 行 / **仅 458 代码行（35%）** / 21 个导出 / ★ **零项目依赖**（但有 3 个 `node:` builtin import）

**混装了 5 件事**：

| # | 职责 | 符号（行号） | 行范围 |
|---|---|---|---|
| **W1** | **支持性探测** | `WorktreeResult:43` · `WorktreeRefusal:57` · `detectWorktreeSupport:111` | `43-146` |
| **W2** | **创建与命名** | `CreateWorktreeOptions:147` · `worktreeDirName:193` · `createTaskWorktree:213` | `147-251` |
| **W3** | **依赖供给（硬链接）** | `ProvisionOptions:252` · `HardLinkTree:295` · `defaultHardLinkTree:325` · `ProvisionMode:356` · `ProvisionResult:358` · `provisionWorktreeDependencies:454` | `252-527` |
| **W4** | **提交与指向** | `CommitWorktreeResult:569` · `CommitWorktreeOptions:577` · `commitWorktree:599` · `worktreePromptLine:528` · `isWorktreePointer:1290` | `528-652` · `1280-1296` |
| **W5** | **回收判定与叙述** | `WorktreeReclaimability:757` · `judgeWorktreeReclaimable:814`（**~435 行** ← 单函数最大） · `describeReclaimability:1249` · `describeWorktree:653` | `653-756` · `757-1279` · `1249-1289` |

**★ 混杂处**：`judgeWorktreeReclaimable:814-1248` **单函数 435 行**
⇒ 这不是"文件混装"，是**一个函数太大**。★ **拆文件解决不了它** ——
需要在函数内部切（但那**会改行为**，因为它的内部顺序可能承载语义）。**归 §2 的"非拆分类发现"。**

**建议拆 3 块**：W1+W2（探测与创建）· W3（供给）· W4+W5（提交/指向/回收）
★ **逻辑等价搬运**（无项目内 import ⇒ 零环风险；但它是**唯一带 I/O 的 fork-新文件**：`node:child_process` + `node:fs`，见 §4）；`describe*` 两个可归 W5 或独立，但**它们正是 t33 发现的可达性盲区**
（`describeReclaimability` 被 `scripts/worktree-reclaim.mjs` 消费）⇒ **别拆到没人 import 的地方**，见 §2-D。

★ **上游冲突面：零**（上游无此文件）。

---

### 1.7 `src/scheduler.ts` — 1246 行 / **663 代码行** / 13 个导出

**混装了 5 件事**：

| # | 职责 | 符号（行号） | 行范围 |
|---|---|---|---|
| **SC1** | **配置常量** | `DEPENDENCY_OUTPUT_MAX_CHARS:47` · `DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS:49` · `DELIVER_TIMEOUT_MS:64` | `47-63` |
| **SC2** | **依赖注入计划** | `DependencyInjectionPlan:97` · `planDependencyInjection:138` | `97-153` |
| **SC3** | **调度器装配** | `SchedulerConfig:154` · `TeamScheduler:248` · `installTeamScheduler:647` | `154-247` · `647-1246` |
| **SC4** | **依赖产出收集与格式化** | `DependencyOutput:256` · `DispatchTicket:292` · `collectCompletedDependencyOutputs:397` · `formatDependencyOutputs:463` | `256-562` |
| **SC5** | **派发提示词构造**（纯字符串） | `assignmentPrompt:563` | `563-646` |

**★ 混杂处**：`installTeamScheduler:647-1246` = **~600 行**，占全文件近一半。
⇒ 与 `worktree.ts` 同形：**一个 install 函数太大**，而不是"5 件事均等混装"。

**建议拆 3 块**：SC1（常量）+ SC2（计划）· SC4+SC5（产出与提示词）· SC3（装配，最大）
★ **逻辑等价搬运**。

★ **上游冲突面**：有（上游 554 行）；two-dot ⇒ **+738 / −46**（fork 改得多，上游几乎没动）。

---

## 2. ★ 非拆分类发现（拆文件解决不了的，但比拆分更值得先修）

**这些不属于"职责混装"，但我在做地图时撞见，如实记下**（★ = 我判定为真实缺陷）。

| # | 发现 | 证据（可复跑） | 为什么"拆文件"解决不了 |
|---|---|---|---|
| **★ A** | **`VisualTaskState` 被逐字声明两次** | `grep -rn "export type VisualTaskState" src/` ⇒ `state.ts:1454` **与** `snapshot.ts:25`，两行**逐字相同** | 它是**重复**，不是混装。拆 `state.ts` 只会让重复移位 —— 必须**收敛为一处** |
| **★ B** | **`quality-gates.ts` import `node:fs`，而 `src/gates/**` 依赖它** | `sed -n '7p' src/quality-gates.ts` ⇒ `import { existsSync, readFileSync } from 'node:fs'`；`grep -rn "from 'node:" src/gates/*/*.ts` ⇒ **无输出** | 判据层**自己**零 I/O，但 import 的模块**有** I/O ⇒ **"判据不 import I/O"这条不变量在传递闭包上不成立**。拆 QG-A（纯谓词）出去**恰好能修它** → ★ **所以 QG-A 的拆法不是审美，是纪律要求** |
| **★ C** | **`judgeWorktreeReclaimable` 单函数 435 行** | `worktree.ts:814-1248` | 拆**文件**不动**函数**。要拆函数**必改行为**（内部顺序可能承载语义） |
| **★ D** | **`describeReclaimability` 的可达性靠"动态 import 的脚本"** | t33 实测：`worktree-reclaim.mjs:126/233/294` 消费它，而该脚本被 `update-task.ts:728` `pluginRoot()` 动态 import | 拆它时要**确认新落点仍被那条链可达**，否则**又制造一个孤岛**（t33 的第 12 类风险） |
| **E** | **`install*` 命名混淆三类不同东西** | `installTeamScheduler`（scheduler）· `installMemberSelectionRuntime`（members）· `installRetiredMemberGuard` / `installMemberDelegationGuard`（members）· `installWorktree*`? | 拆文件时**按 install 归类**会把不同职责放一起 —— 本文按**职责**而非**命名前缀**归块 |

---

## 3. ★ 上游冲突面：逐文件实测（two-dot，t12 已纠正的口径）

★ **口径声明**：用 **two-dot** `git diff --numstat upstream/main HEAD -- <f>`，
它列的是「fork 相对上游 `HEAD` 的改动量」。**它不等于"上游冲突面"本身** ——
真正的冲突面还取决于**上游自己也改了没有**，所以下表**两栏都给**。

| 文件 | 上游存在? | 上游行数 | **fork 改动（two-dot）** | **上游自身改动（merge-base→upstream）** | 冲突风险 |
|---|---|---:|---|---|---|
| `tools.ts` | ✅ | 2877 | **+1685 / −2335** | **+395 / −90** | ★★★ **双向大改** |
| `quality-gates.ts` | ✅ | 2109 | **+1360 / −957** | （见下注） | ★★ **双向** |
| `members.ts` | ✅ | 1094 | +713 / −342 | — | ★★ 中 |
| `scheduler.ts` | ✅ | 554 | +738 / −46 | — | ★ 中（fork 改得多，上游几乎没动） |
| `state.ts` | ✅ | 1285 | +448 / −229 | — | ★ 中 |
| `mutation.ts` | ❌ **无** | 0 | **+1692 / −0** | **0** | ✅ **零** |
| `worktree.ts` | ❌ **无** | 0 | **+1296 / −0** | **0** | ✅ **零** |

```sh
# 复现（逐文件）
$ git diff --numstat upstream/main HEAD -- src/tools.ts src/quality-gates.ts src/members.ts \
      src/scheduler.ts src/state.ts src/mutation.ts src/worktree.ts
1685    2335    src/tools.ts
1360    957     src/quality-gates.ts
713     342     src/members.ts
738     46      src/scheduler.ts
448     229     src/state.ts
1692    0       src/mutation.ts
1296    0       src/worktree.ts
```

★★ **任务书说「至少 `tools.ts` 是」—— 对，但它漏了更重要的一半**：
**`mutation.ts`（1692 行）与 `worktree.ts`（1296 行）合计 2988 行是 fork 全新文件，冲突面为零。**
⇒ **拆这两个对"同步上游"零代价**，而拆 `tools.ts` 的代价最大。**§8 按此排优先级。**

★ 另：`quality-gates.ts` 的"上游自身改动"我**没有**单列（它在本轮被我用来验证 `tools.ts` 的口径，
未逐一测），**标为未测**而不是填一个数。

---

## 4. 环风险（决定"逻辑等价搬运"能不能成立）

```sh
$ for f in quality-gates tools mutation state members worktree scheduler; do
    printf "%-16s -> " "$f.ts"; grep -oE "from '\./[a-z-]+\.ts'" src/$f.ts | sed "s/from '\.\///;s/\.ts'//" | sort -u | tr '\n' ' '; echo; done
quality-gates.ts -> types
tools.ts         -> events harness-compat mailbox members profiles quality-gates scheduler state types
mutation.ts      ->            ★ 零 import（纯函数）
state.ts         -> quality-gates types
members.ts       -> events harness-compat mailbox state types
worktree.ts      ->            ★ 无项目内 import（但有 node:child_process/fs/path，此 grep 只抓项目内）
scheduler.ts     -> mailbox members state types worktree
```

**读出来的三件事**：
1. ★ **`mutation.ts` 零 import、`worktree.ts` 无项目内 import**（只 import `node:child_process` / `node:fs` / `node:path`，见 `:39-41`）⇒ **拆它们不可能造环**，是**最安全的两个**。
   ★ 但**两者性质不同**：`mutation.ts` 纯函数；`worktree.ts` **带 I/O**（而 `src/gates/**` 的零 I/O 不变量**不依赖**它）。
2. ★ **`tools.ts` 依赖 9 个模块**（最多）⇒ 拆它时**任何新块都可能在环上**。
   且 `src/tools/*.ts` 有 4 个文件**反向 import `tools.ts`**（`update-task` / `message` / `amend-task` / `index`）
   ⇒ **`tools.ts` 处在环的关键位置**。★ 这是"拆 `tools.ts` 要额外小心"的**源码级理由**。
3. `quality-gates.ts` 被 **13 处** import（含 `src/gates/**` 4 处）⇒ 拆它要改 13 处 import，
   **但都是单向**（没有文件被它反向 import）⇒ 环风险低、**改动面广**。

---

## 5. 拆分建议汇总（按"代码行"排序，不按总行）

| 优先级 | 文件 | 代码行 | 建议块数 | 全部逻辑等价搬运? | 上游冲突 |
|---:|---|---:|---:|---|---|
| 1 | `mutation.ts` | 1088 | 4 | ✅ 是（★ 零 import，纯函数） | ✅ 零 |
| 2 | `quality-gates.ts` | 1544 | 4 | ✅ 是（但 QG-A 出去会**修掉 §2-B**） | ★★ 双向 |
| 3 | `worktree.ts` | 458 | 3 | ⚠️ 除 `judgeWorktreeReclaimable`（435 行单函数）外是 | ✅ 零（但带 I/O） |
| 4 | `state.ts` | 918 | 4 | ✅ 是（+ 顺带收敛 §2-A 的重复） | ★ 中 |
| 5 | `scheduler.ts` | 663 | 3 | ✅ 是 | ★ 中 |
| 6 | `members.ts` | 797 | 3 | ✅ 是 | ★★ 中 |
| 7 | `tools.ts` | **640** | 4 | ✅ 是，**但环风险最高** | ★★★ 双向大改 |

★ **注意 `tools.ts` 排最后**：它是**总行数第二大**（2227）但**代码行最少之一**（640，仅高于 `worktree` 的 458），
且**冲突面最大 + 环位置最关键** ⇒ **收益最低、风险最高**。
⇒ **这与计划 §3-M 把 `tools.ts` 列为 M3（第二个做）的顺序相反**，建议重排（见 §6）。

---

## 6. ★ 与计划 §3-M 的三处不符（供 M2–M4 定序参考）

| 计划原文 | 本文实测 | 影响 |
|---|---|---|
| M2 = `quality-gates.ts`「**纯谓词 + 校验器 + 裁决**三合一」 | 实测是 **6 件事**（§1.1），三分法与源码不符 | M2 的 inScope 若按三分法写，会漏 Q2/Q5/Q6 |
| M3 = `tools.ts`（第二个做） | 它代码行最少之一、冲突面最大、环位置最关键 | **顺序建议反转**：先 M1 收益高的（`mutation.ts` 零冲突面） |
| §3-M 的风险段只提 `tools.ts` 加大冲突面 | `mutation.ts`/`worktree.ts` 冲突面**为零** | 计划漏了"有两块可以零代价拆"这个**利好** |

---

## 7. 关于"可纯搬运"这个词（按任务书硬纪律）

本文**一律写「逻辑等价搬运」**，并给出定义与验证方式：

> **逻辑等价搬运** = 拆分前后**导出集合逐条相等** 且 **行为不变**。
> **它不是"不产生 diff"** —— 改 `src/` 必触发构建链（`rootDir=src`、**173 个被跟踪的 `lib/` 产物**），
> 产物必然重算。⇒ **每一次拆分都会产生 `lib/` 的 diff，那是预期的，不是"行为变了"。**

**验证方式（M2–M4 应照此做，而不是"跑测试绿了"）**：
```sh
# 搬运前、搬运后各跑一次，两份输出必须逐字相等
grep -hoE "^export (function|const|class|interface|type) [A-Za-z_$][A-Za-z0-9_$]*" src/<old>.ts | sort > /tmp/before.txt
cat src/<new-a>.ts src/<new-b>.ts | grep -hoE "^export (function|const|class|interface|type) [A-Za-z_$][A-Za-z0-9_$]*" | sort > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt && echo "导出集合相等"
```
★ **`lib/` 产物的 diff 必须单独记账**，不能与"行为变了"混为一谈。

---

## 7c. ★★ M3 执行记录：QG-A 已拆分，**传递闭包不再带 I/O**（t59）

> 本节是 **M3 的实做记录**，也是 §1.1 那条「QG-A 拆出去会修掉 §2-B」的**兑现证明**。

### 7c.1 拆分结果

| 文件 | 行数 | 内容 |
|---|---:|---|
| **新增** `src/quality-gates/predicates.ts` | 285 | **QG-A**：Q1（纯路径谓词）+ Q2（文本谓词）+ `PathClassification` + 两个私有 helper |
| `src/quality-gates.ts` | 2248 → 2265 | 去掉 QG-A 实现；**保留导出面**（见 7c.2） |
| `src/gates/{admission,dispatch}/*.ts` | 各 **1 行** | import 改指 `../../quality-gates/predicates.ts` |

★ **QG-A 的精确成员**（**不照抄 §1.1 的近似行号，我重新核过**）：
`PathClassification`(51) · `normalizeWorkspacePath`(269) · `pathMatchesScope`(285) ·
`isDefaultExcluded`(303, 私有) · `classifyChangedPath`(315) · `collectChangedPaths`(643) ·
`inScopeOverlap`(663) · `looksLikeRepoPath`(750, 私有) · `normalizeRepoPath`(759, 私有) ·
`repoPathsNamedIn`(771) · `verifyTargetOf`(785) · `armsNamedIn`(802) · `subjectTermsIn`(830) · `GENERIC_TERMS`(849)

### 7c.2 ★ 一个必须写下的接线形状：`import` 与 `export … from` **并存**

```ts
import { normalizeWorkspacePath, /* …9 个… */ } from './quality-gates/predicates.ts'  // ← 本文件内部要用
export { normalizeWorkspacePath, /* …9 个… */ } from './quality-gates/predicates.ts'  // ← 对外保持导出面
```
★ **两者缺一都不行**，我实测各撞一次：
- **只 `export … from`** ⇒ 本文件内部 8 处调用报 **TS2304 Cannot find name**（`export-from` 不建本地绑定）；
- **只 `import`** ⇒ 导出面塌掉（外部消费者取不到）。

### 7c.3 ★★ 硬验收②：传递闭包不再带 I/O（拆前有路径 / 拆后无）

**可复跑检查器**（跟相对 import 走，看是否到达 `node:*`；剥离注释以免"注释里提到"被算成引用）：

```python
# /tmp/ioclosure.py  ——  python3 /tmp/ioclosure.py <entry.ts> [...]
import re, sys, io, os
def resolve(base, rel):
    p = os.path.normpath(os.path.join(os.path.dirname(base), rel))
    for c in (p, p + '.ts'):
        if os.path.exists(c): return c
    return None
def strip(t):
    t = re.sub(r'/\*.*?\*/', '', t, flags=re.S)
    return re.sub(r'//[^\n]*', '', t)
IMP = re.compile(r"^\s*(?:import|export)[^'\"]*?from\s*['\"]([^'\"]+)['\"]", re.M)
def closure(entry):
    seen, stack, hits = set(), [entry], []
    while stack:
        cur = stack.pop()
        if cur in seen or not os.path.exists(cur): continue
        seen.add(cur)
        t = strip(io.open(cur, encoding='utf-8', errors='replace').read())
        hits += [(cur, ni) for ni in re.findall(r"from\s*['\"](node:[^'\"]+)['\"]", t)]
        for rel in IMP.findall(t):
            if rel.startswith('.'):
                r = resolve(cur, rel)
                if r and r not in seen: stack.append(r)
    return seen, hits
for e in sys.argv[1:]:
    files, hits = closure(e)
    print(f"── {e}  可达 {len(files)} 文件")
    print(("★ 到达 I/O: " + str(hits)) if hits else "OK 未到达任何 node:*")
```

| | `changed-paths` | `absorb` | `checkpoint` | `convene` |
|---|---|---|---|---|
| **拆前** | ★ 到达 `node:fs`/`node:path`/`node:url`（经 `quality-gates.ts`） | 同 | 同 | 同 |
| **拆后** | **OK 未到达任何 `node:*`** | OK | OK | OK |

```
# 拆前（HEAD，实测）
── src/gates/dispatch/changed-paths.ts   可达文件数: 6
   ★ 到达 I/O: src/quality-gates.ts  --node:fs-->
   ★ 到达 I/O: src/quality-gates.ts  --node:path-->
   ★ 到达 I/O: src/quality-gates.ts  --node:url-->
# 拆后
── src/gates/dispatch/changed-paths.ts   可达文件数: 5
   OK 未到达任何 node:* I/O
```

★★ **最硬的一份证据：在【编译产物】上同样成立**（同一算法改走 `lib/**/*.js`）：
```
── lib/gates/dispatch/changed-paths.js → OK      ── lib/gates/admission/absorb.js      → OK
── lib/gates/admission/checkpoint.js    → OK      ── lib/gates/admission/convene.js     → OK
```
⇒ **不是"源码看着干净"，而是"装上去的那份也不带 I/O"。**

★ **`quality-gates.ts` 自己仍 import `node:fs`** —— 刻意保留：`checkTaskPremises`(890)
与 `baselinePin`(1456) **确实要做文件系统检查**（前者按设计读工作树）。它们**不是判据层可达的**
（那 4 个 gates 文件不取它们）⇒ 闭包干净。

### 7c.4 ★ 执行中发现的 §1.1 边界问题（如实记录）

§1.1 给 Q2 的范围 `~771-889` 是按"下一个顶层声明"推的，于是**含进了 `structurallyImpossiblePath`(875)**
—— 而**那个函数带 I/O**（`:881 existsSync`）。★ 我**没有照抄该范围**：按"这个函数纯不纯"逐个判，
把带 I/O 的两件（`structurallyImpossiblePath` / `checkTaskPremises`）**留在 `quality-gates.ts`**。
⇒ **§1.1 的行范围确如它自陈的是近似；而"Q2 纯"这个结论需要这条修正才成立。**

### 7c.5 ★ 硬验收④：反向半边（可复跑）

```sh
$ python3 /tmp/exportcheck.py /tmp/qg-orig.ts          # 正向
OK 导出集合逐条相等（67 个）                            # exit=0
$ sed -i '' 's/export function classifyChangedPath/function classifyChangedPath/' src/quality-gates/predicates.ts
$ python3 /tmp/exportcheck.py /tmp/qg-orig.ts          # 反向
*** 导出集合不等: before=67 after=66
  只在拆分前: ['classifyChangedPath']                   # exit=1 ★ 报错
$ git checkout -- src/quality-gates/predicates.ts      # 还原
```
★ **而我第一版对拍脚本再次没有分辨力**：它把桶的 `export {…} from` 名单 **union** 进 after 集
⇒ 桶自己仍列着 `classifyChangedPath` ⇒ **测不出来**（t52 踩过同一个坑，这次我**先测反向半边**才发现）。
⇒ 正确口径 = **只比对"直接声明"**（桶算指针不算源），并由 `tsc` 兜"桶是否解得开"。
★ 本轮 `tsc` **同时**抓到了它：`TS2459 … declares 'classifyChangedPath' locally, but it is not exported`。

### 7c.6 导出面与净变化

```sh
$ python3 /tmp/exportcheck.py /tmp/qg-orig.ts   # 源码：直接声明 67 == 67（符号级含 re-export 为 69 == 69）
$ npx tsc -p tsconfig.json --noEmit             # exit=0
$ pnpm build                                    # exit=0；新增 lib/quality-gates/predicates.js + 其 d.ts
$ # lib/types/quality-gates.d.ts 导出面：before 69 == after 69
```

★ **基线口径修正（与 t52 同）**：任务书给 **1415 pass / 19 fail**，而我在**动任何代码之前**
实测本 worktree 基线 = **1413 pass / 20 fail**（`tests 1471`）⇒ 差异先于我的改动存在。

★★ **一处【净新失败】，性质与此前的抖动不同 —— 必须留下**：
`scripts/verify-gates-integration.test.mjs:695`（"④ 每条判据只 import registry.ts…"）报：
```
dispatch/changed-paths.ts imports "../../quality-gates/predicates.ts"
```
**成因**：该夹具持有一份**显式 allowlist**（`:719-766`），逐行列出**允许判据 import 的共享纯模块**，
每条都附**理由**与**先例引用**（`../requires.ts`(t6) · `./kind-requirements.ts`(t54) · `../budget-stop.ts`(2026-10-12)）。
`'../../quality-gates.ts'` **本来就在名单里**；我把它换成新路径 ⇒ 不在名单 ⇒ 判负。

★ **我没有放宽这个断言，也没有改这个夹具**（`scripts/` 在 outOfScope，
且"不许为了让测试变绿而放宽断言"是硬纪律）。
**实测：只加一行 allowlist 即可全绿** —— 临时加
`|| specifier === '../../quality-gates/predicates.ts'` ⇒ 该夹具 **exit=0、19 个 ✔**；
★ **已还原**（`git status --porcelain -- scripts/` ⇒ 空）。
⇒ **这一行**（连同它需要的**理由注释**，按该名单既有格式）**需由拥有 `scripts/` 写域的人加**。
★ 它**不是放宽**，而是该名单的**第四个同类实例**：`predicates.ts` 与
`kind-requirements.ts` / `budget-stop.ts` 完全同形 —— 在 `src/gates/` 外、**不是判据**
（不 export `id`/`point`/`gate`）、**零 `node:` import**、不带任何一条判据的语义。
★ 而且它**比 `../../quality-gates.ts` 那一条更该在名单里**：后者**带 I/O**，前者**不带**
—— 这正是本次拆分的全部目的。

---

## 8. 优先级建议（按"收益 ÷ 风险"）

1. ★ **`mutation.ts`**（1088 代码行，零 import，零冲突面）—— 最安全、收益明确。
2. ★ **`quality-gates.ts`** QG-A 单独先出（**修掉 §2-B 的 I/O 传递闭包问题**），其余三块随后。
3. **`state.ts`**（顺带收敛 §2-A 的重复类型）。
4. **`scheduler.ts` / `members.ts`**（中等）。
5. ⚠️ **`worktree.ts`** —— 文件级搬运可行，但 **`judgeWorktreeReclaimable` 435 行单函数**要单独定夺（拆它会改行为）。
6. ⚠️ **`tools.ts`** —— **建议最后**，且**先论证"注释占 64%"这件事是否真的需要拆**（§0.2）。

★ **另外建议先做一件不改代码的事**：把 §2-A（重复的 `VisualTaskState`）单独立一个**极小的任务** ——
它是**已确认的缺陷**，且修它**零风险**，不需要等 M2–M4 的拆分。

---

## 9. 复现命令与脚本（本文全部读数的来源）

```sh
cd /Users/abab/Desktop/agent-teams-dev    # HEAD 5cc8e40
```

**口径 A —— 代码/注释比（block-comment 感知）**
```sh
python3 - <<'PY'
import io
for f in ['quality-gates.ts','tools.ts','mutation.ts','state.ts','members.ts','worktree.ts','scheduler.ts']:
    lines = io.open(f'src/{f}', encoding='utf-8').read().split('\n')
    in_block, code = False, 0
    for l in lines:
        s = l.strip()
        if in_block:
            if '*/' in s: in_block = False
            continue
        if s.startswith('/*') and '*/' not in s: in_block = True; continue
        if s.startswith(('//','*','/*')) or s == '': continue
        code += 1
    print(f"{f}: {code} code lines / {len(lines)} total = {code*100//len(lines)}%")
PY
```

**口径 B —— `tools.ts` 的注释墙（:1240-1728 非注释非空行为 0）**
```sh
$ awk 'NR>=1240 && NR<=1728' src/tools.ts | grep -cvE '^\s*($|//|\*|/\*)'
0
```

**口径 C —— 逐文件导出清单（本文每张表的来源）**
```sh
$ grep -nE "^export (function|const|interface|type|class)" src/<f>.ts
```

**口径 D —— 上游冲突面（两栏）**
```sh
$ git diff --numstat upstream/main HEAD -- src/<f>.ts        # fork 改动
$ git diff --numstat 98aac03 upstream/main -- src/<f>.ts     # 上游自身改动
$ git cat-file -e upstream/main:src/<f>.ts 2>/dev/null && echo PRESENT || echo ABSENT
```

---

## 10. 本报告的局限（明确留白）

1. **行范围是"声明起点"**：本文给的行范围取自**顶层声明的起始行**，
   **未逐函数解析结束行**（那需要 AST）。⇒ 因此**相邻块的边界是近似的**，可能有几十行误差。
   ★ 这对"混装了几件事"的判断**无影响**（那由符号清单支撑），但**不能当作精确切片指令**。
2. **`quality-gates.ts` 的"上游自身改动"未单列**（§3 已标未测）。
3. **未做跨文件符号级依赖图**：本文的环分析是**模块级**（`import` 边），
   **不是符号级**（"哪个函数调哪个函数"）。⇒ 拆块时的**具体调用边**仍需 M2–M4 自己核。
4. **未评估拆分对构建时间的影响**（改 `src/` 会触发 173 个 `lib/` 产物的重算）。
5. **未跑任何构建/测试**：本任务是只读分析，`git status --porcelain -- src/` ⇒ 空（见下）。

```sh
$ git status --porcelain -- src/ scripts/
（空）
```

---

*本文件只写 `docs/MODULE-MAP.md`。未改动任何 `src/`、`scripts/`、`lib/` 文件。基线 HEAD `5cc8e40`。*
