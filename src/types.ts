/**
 * Durable AgentTeams state types.
 *
 * A team is one directory under the state root holding `team.json` plus an
 * `inbox/` of per-agent JSONL mailboxes. Members are continuable subagents
 * whose durable child session ids are recorded in the team file, so a team
 * survives harness restarts.
 * @module dsh-agent-teams/types
 */

/**
 * The immutable effective tool restriction of one member.
 *
 * ★ 它住在**叶子**里（本文件零 import，见 `scripts/gate-stall-leaf-home.test.mjs`
 *   的地基臂）：`TeamMember.runtimeSetup` 是持久记录，持久记录的形状属于
 *   `types.ts`，而不是某一个接线模块。曾经把它放在 `harness-compat.ts`
 *   会让本文件反向 import 那个模块 —— 那条 import 会把叶子变成图上的节点，
 *   环会在下一层重新长出来，而报错会指向别的文件。
 */
export interface MemberToolFilter {
  /** Visible global tools; absent means "no allow-list" (everything not denied stays). */
  allow?: string[]
  /** Removed global tools; never empty (the captain-only deny list is always included). */
  deny: string[]
}

/** Task lifecycle statuses in progression order. */
export type TaskStatus =
  | 'pending'
  | 'claimed'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** Statuses after which a task can no longer be claimed or worked on. */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['completed', 'failed', 'cancelled']

/**
 * ── ★★ 任务【为什么停下】—— 与 `status` 是两个轴（t55 加）──────────────────────
 *
 * ── 它修的是什么（MEASURED，2026-10-07）──────────────────────────────────────
 *
 * 今天 16 个任务【全部】由 captain 代落终态，而其中多数**交付物是合格的**
 * （有 25/25 夹具、`pnpm verify exit=0`）。而它们的终态被落成 `cancelled`。
 *
 * ⇒ `cancelled` 的语义是「**被中止**」，不是「**做完了但记录不了**」。
 *   把后者记成前者，台账里就读不出「哪些真做完了」——
 *   而那让整个台账的**结论层**失去意义。
 *
 * ★ 这是本队那条记账的**第三种**形态：
 *     把缺陷写成不变量（不对）· 把它删掉（不对）· ★ **把它记成一个语义不对的终态**（本次）
 *
 * ── ★★ 为什么不新增一个 `TaskStatus`（这是本任务最重要的一个设计决定）────────
 *
 * 最自然的写法是往 `TaskStatus` 联合里加一个 `'delivered_blocked'`。**它做不到**，
 * 而且原因不是风格：`TaskStatus` 被两处**穷尽**使用 ——
 * `Record<TaskStatus, readonly TaskStatus[]>`（`src/state.ts` 与
 * `src/quality-gates.ts`）—— 加一个成员会让后者当场 `TS2741`
 * **而 `src/quality-gates.ts` 不在本任务的射程里**（实测确认过这条）。
 *
 * ⇒ 而"做不到"在这里恰好是**对的**，有两个更硬的理由：
 *
 *   ① **语义**：`status` 回答的是「它在生命周期的哪一点」（pending→claimed→…），
 *      而「交付合格但门拦着」回答的是「**它为什么停在那里**」。两者是**两个轴**。
 *      把它塞进 status 会让 `delivered_blocked` 与 `completed` 在同一个枚举里并列，
 *      读的人于是会以为它们是同一种东西的两种程度 —— 而它们的补救动作完全不同
 *      （人代落 / 无需动作）。
 *   ② **兼容**：留着 `status` 不变，所有既有消费者（调度器、看板、邮箱、
 *      判据注册表）**一个字都不用改**，而它们对"终态"的理解仍然正确 ——
 *      因为这件事的状态**就是**一个终态（它确实不再动了）。
 *
 * ⇒ 所以本任务加的是**一格记录**，不是一个新状态。而"记录"这条路的代价必须
 *   如实说出：**它不会自动让任何东西变好** —— 它只是让台账**读得出来**。
 *   真正让下一次不再发生，要靠门自己让路（那是 t54 那一侧的事）。
 *
 * ── ★★ 三态（★ 而它们的补救动作不同，所以必须不同形）──────────────────────────
 *
 *     `delivered_blocked` —— 交付**合格**，而**门拦着**（它没能测量，或它不该跑）
 *                            ⇒ 补救：人代落终态 / 改门
 *     `not_delivered`     —— 交付**不合格**（有实测证据说东西是坏的）
 *                            ⇒ 补救：**重做**
 *     `gate_fault`        —— **门自己错了**（它在自己不该跑的时候开火）
 *                            ⇒ 补救：**改门**
 *
 * ★ 三者**不许合流**：把 ② 记成 ① 会让"做坏了"读成"做完了"（反向的同一类错误）；
 *   把 ③ 记成 ② 会让"门有病"读成"活没干好"—— 而那正是今天 5 次同形终止的成因
 *   （判据在自己没有对象可判时开火，而读数看起来像"工作不合格"）。
 */
export type DeliveryOutcome =
  | 'delivered_blocked'
  | 'not_delivered'
  | 'gate_fault'

export const DELIVERY_OUTCOMES: readonly DeliveryOutcome[] = [
  'delivered_blocked',
  'not_delivered',
  'gate_fault',
]

/**
 * 一次收口的记录：**谁**把它落成终态、**为什么**、以及**门说了什么**。
 *
 * ★ 它挂在任务上（与 `verdict` / `findings` 平级），不改 `status` 的取值域 ——
 *   见 {@link DeliveryOutcome} 里那段"为什么不新增一个 status"。
 */
export interface DeliveryRecord {
  /** 三种收口之一。★ 三态不同形，因为补救动作不同。 */
  outcome: DeliveryOutcome
  /**
   * ── ★★ 门给的**拒绝原文**（`delivered_blocked` / `gate_fault` 时必填）──────────
   *
   * 判据的原话。★ 少了它，这一格与"做坏了"在读的人眼里同形 ——
   * 而"哪一道门拦的、它到底说了什么"正是下一个人（或下一个会话）唯一的线索。
   *
   * ★ 它**不是**摘要、不是转述：转述会丢掉判据自己那句话里的限定语，
   *   而那正是判断"门是不是错了"的依据。
   */
  gateRefusals?: string[]
  /** 人话一句：为什么这么收口。★ 可选，但 `not_delivered` 时应当有。 */
  reason?: string
  /** 落这一笔的人 / 角色（`captain`、成员名…）。 */
  by?: string
  /** 落笔时刻（epoch ms）。★ 由调用方注入，本文件不读时钟。 */
  at?: number
}

/** Structured quality-gate kind. Absent / unknown values are treated as `work`. */
export type TaskKind =
  | 'requirements'
  | 'implementation'
  | 'verification'
  | 'review'
  | 'repair'
  | 'integration'
  | 'work'

/**
 * ── ★★★ t97（S1）：哪几类 kind 的"完成"是**关于某个修订的判决** ─────────────────────
 *
 * 上游把它叫作 `VERDICT_KINDS`，用途是**筛**：只有这几类的完成才需要绑定字节。
 *
 * ★★ 判据是**语义的**：一次"完成"是不是在说「**这批字节**行不行」？
 *
 * | kind | 是判决吗 | 为什么 |
 * |---|---|---|
 * | `review` | ✅ | 它的 verdict 就是说"被审的那批字节行不行" |
 * | `requirements` | ✅ | 同理 —— 它判的是需求/契约那批材料 |
 * | `verification` | ✅ | 它判的是"这个实现过不过得了验证" |
 * | `implementation` · `repair` · `integration` | ❌ | 它们的完成是"**我把活干了**"，不判决任何字节 |
 * | `work` | ❌ | "我做完研究了" —— 同样不判决字节 |
 *
 * ★ 给非判决类也记一份绑定是**造一个不存在的语义**（"这次研究绑定了哪些字节"没有意义），
 *   而那会让读取端把"干活"读成"判决"。
 */
export const VERDICT_KINDS: readonly TaskKind[] = ['review', 'requirements', 'verification']

export const TASK_KINDS: readonly TaskKind[] = [
  'requirements',
  'implementation',
  'verification',
  'review',
  'repair',
  'integration',
  'work',
]

/**
 * ── ★★★ 哪些 kind 会被派发到一个【隔离的 worktree】────────────────────────────
 *
 * ★ 这是**唯一的一份真值**，两个读者从它取，而不是各自写一遍：
 *
 *     · `src/scheduler.ts` 的 `needsWorktree` —— **建不建**树（派发那一刻）
 *     · `src/tools/shared/entities.ts` 的 `resolveBaseRevision` —— 判"没有基准"
 *       是**按设计没有**还是**本该有却丢了**
 *
 * ── 为什么必须只有一份（MEASURED，本队记账最久的形态）──────────────────────────
 *
 * 两处各写一份 `kind === 'implementation' || kind === 'repair'` 会**分叉**，
 * 而分叉之后 `判据说它该有、而调度器从没建过` 在日志里同形 —— 那正是本任务修的那一格：
 *
 *     调度器：非 implementation/repair ⇒ 从不建树 ⇒ 基准**从来没有**存在过
 *     判据  ：`attempt > 0` 而没有基准 ⇒ 读成"本该有却丢了" ⇒ **拒绝**
 *     ⇒ ★ 任何非 implementation/repair 的任务，只要被重派过一次，就**再也交不上终态**
 *     ⇒ 而它被拒的理由，描述的原因**从来没有发生过**
 *
 * ★ 放在 `types.ts` 而不是别处，是因为它是**叶子模块**（不 import 任何东西），
 *   而 `scheduler.ts` 与 `tools/shared/entities.ts` **都已经** import 它
 *   ⇒ 两边共用它不会造出新的 import 环（环会让"改一个工具牵动另一个"，本仓库禁止）。
 *
 * ★ 它与 `completion.backtest` 的 `baselineAbsent` **一一对应**（判据不发明新词汇）：
 *     非本集合的 kind ⇒ `'no-worktree'` ⇒ 判据**报告而不拒绝**（环境不是工作的问题）
 *     本集合的 kind   ⇒ `'not-recorded'` ⇒ 判据**仍然拒绝**（本该有的丢了，要有人看）
 */
export const KINDS_NEEDING_WORKTREE: readonly TaskKind[] = ['implementation', 'repair']

/** 这个 kind 会不会被派发到隔离 worktree（⇒ 它有父版本可对照）。 */
export function needsWorktreeFor(kind: string | undefined): boolean {
  return kind !== undefined && (KINDS_NEEDING_WORKTREE as readonly string[]).includes(kind)
}

/** Review / requirements conclusion. Only `pass` may complete those kinds. */
export type ReviewVerdict = 'pass' | 'needs_revision' | 'reject'

/**
 * ── ★★★ t97：一次判决**绑定到的一份字节**（内容摘要）────────────────────────────────
 *
 * ★ `digest` 是**内容**摘要（sha256 of the file bytes 的 hex），
 *   **不是** git 对象名 —— 见 `TeamTask.reviewedArtifacts` 的注释（T7 的教训：
 *   `cherry-pick` 会改 hash 而字节不变）。
 *
 * ★ 由**调用方**算并传入（本仓同一条纪律：纯类型/纯函数不做 I/O）——
 *   先例是 `mutation-guard.ts`：「读文件、跑 git、算指纹全部由调用方注入」。
 */
/**
 * ── ★★★ t97（S1）：一份**工作时读到的字节**的摘要（上游 `ArtifactDigest`）──────────────
 *
 * ★ 与 {@link ReviewedArtifact} 是**同一个形状的两个名字**吗？**不是**：
 *   · `ReviewedArtifact` —— **判决落盘时**记下的（"我判的是这批字节"，是**历史**）；
 *   · `ArtifactDigest`   —— **当前**读到的（"现在是什么"，是**现状**）。
 *   ★★ 两者形状相同，而**语义相反** —— 恰如 `before`/`after`。
 *     合成一个名字会让"记下来的"与"读出来的"在读取端同形，
 *     而那正是这套机制要防的事（判决说的字节 vs 现在的字节）。
 */
export interface ArtifactDigest {
  /** workspace 相对路径（POSIX）。 */
  readonly path: string
  /** `sha256` 的 hex。★ 内容摘要，与 git 修订标识无关。 */
  readonly digest: string
}

/**
 * ── ★★★ t97（S1）：这次读取**没能完成**的部分 ────────────────────────────────────
 *
 * 上游逐字：
 * > 「Parts of the *current* read that could not be completed (expansion cap,
 * >   unreadable directory or file, illegal pattern). A non-empty list means
 * >   the audit itself is incomplete, so **no verdict may be confirmed from it**.」
 *
 * ★★ 这是"没能测量"那一态 —— 与"读到了、且一致"**必须不同形**：
 *   一份**不完整**的读取若被当成完整，会让"没读到"读成"没变"。
 * ★ 本任务(S1)只**记录**这些缺口，**不用**它们做裁决（那是 S3）。
 */
export interface ArtifactScopeGap {
  /** 没能完成的那一部分（一个路径或一个模式）。 */
  readonly ref: string
  /** 为什么没能完成。 */
  readonly why: string
}

export interface ReviewedArtifact {
  /** workspace 相对路径（POSIX）。 */
  readonly path: string
  /** `sha256` 的 hex。★ 摘要的是**内容**，与 git 的修订标识无关。 */
  readonly digest: string
}

export const REVIEW_VERDICTS: readonly ReviewVerdict[] = ['pass', 'needs_revision', 'reject']

/** Finding severity used by review / requirements output. */
export type FindingSeverity = 'low' | 'medium' | 'high' | 'blocker'

export const FINDING_SEVERITIES: readonly FindingSeverity[] = ['low', 'medium', 'high', 'blocker']

/** One structured review finding. */
export interface ReviewFinding {
  /** Stable id, for example `SEC-001`. */
  id: string
  severity: FindingSeverity
  file?: string
  line?: number
  problem: string
  requiredFix: string
  resolved?: boolean
}

/** One acceptance criterion result recorded at completion. */
export interface AcceptanceResult {
  criterion: string
  status: 'passed' | 'failed'
  evidence?: string
}

/** One verification command result recorded at completion. */
export interface CommandResult {
  command: string
  status: 'passed' | 'failed'
  exitCode?: number
  evidence?: string
  /**
   * ── ★★★ 这条命令失败的【是哪几条测试】—— 而它让"新增失败"可判定（t19）──────
   *
   * 由来（MEASURED 2026-10-09）：本仓有 18 条**存量红**，而完工规则原本说
   * 「commandsRun 里有 failed ⇒ 不许 completed」⇒ ★ 于是 17 条任务**全部不可达 completed**
   *   —— 而它们的工作都做完了。
   *
   * ★★ 而正确的分界是【这次交付有没有新增失败】：
   *   · `failures` 在场且逐条都在基线里 ⇒ 允许 completed（那不是撒谎: `exit=1` 说"仓库里有红"，
   *     而它说"我没有新增红" —— ★ 两者是不同的量）
   *   · 至少一条不在基线里 ⇒ 只能 failed
   *   · ★ `failures` 缺席 ⇒ **判不了**（不是"没有新增"）——
   *     因为"我没能测量"不得读成"没事"。
   *
   * ★ 而它必须是【名字】而不是计数：同一个命令在三次运行里给出过 47 / 14 / 14 条失败
   *   （本会话实测）⇒ ★ 计数不是证据，只有【哪几条】是。
   */
  failures?: readonly string[]
}

/** Profile / team review-loop limits. */
export interface ReviewPolicy {
  requirementsMinRounds?: number
  requirementsMaxRounds?: number
  codeMaxRounds?: number
  maxRepairAttempts?: number
  requiredReviewers?: string[]
}

/** One captain-only contract amendment recorded on a quality task. */
export interface TaskRevision {
  /** Epoch ms when the amendment was applied. */
  at: number
  /** Identity that applied it (`captain`). */
  by: string
  /** Why the previous contract was wrong; kept for the audit trail. */
  reason: string
  /** Amended contract field names (`objective`, `acceptance`, …). */
  fields: string[]
  /** Previous values of the amended fields; fields absent before are omitted. */
  previous: Record<string, unknown>
}

/** Append-only observations; never replace the terminal verdict or unlock a gate. */
export interface TaskEvidence {
  at: number
  by: string
  attempt: number
  attemptId?: string
  note?: string
  acceptanceResults?: AcceptanceResult[]
  commandsRun?: CommandResult[]
}

/**
 * ── ★★ 失败成因的取值 —— 而它**必须与 `state.ts` 的 `FAILURE_KINDS` 逐字相同** ──────
 *
 * ★ 为什么不 `import type { FailureKind } from './state.ts'`：
 *   **本文件是一个零 import 的叶子**（t24 立的规矩，且有一条臂直接断言它）。
 *   ⇒ 一旦这里 import 了 `state.ts`，叶子就变成图上的一个节点 ——
 *     而 `state.ts` 反过来 import 本文件 ⇒ **成环**。
 *
 * ★★ 而"不 import"的代价是**这里多了一份字面量**。⇒ 它必须有一条**机械的**保障，
 *   而不是靠"记得同步"（那是一条会腐烂的规则，本仓反复记账过）。
 *   ⇒ `scripts/gate-execution-history.test.mjs` 里有一条臂**逐字比对**
 *     这两处取值相等 —— 于是它们分叉的那一天，夹具当场红。
 */
export type FailureKindName = 'failed_delivery' | 'failed_context' | 'inconclusive'

/** 上述取值的运行期清单（与 `state.ts` 的 `FAILURE_KINDS` 同源，由夹具逐字比对）。 */
export const FAILURE_KIND_NAMES: readonly FailureKindName[] = ['failed_delivery', 'failed_context', 'inconclusive']


/**
 * ── ★★ t81：判据**插入点**的取值 —— 与 `gates/registry.ts` 的 `INSERTION_POINTS` 同源 ──
 *
 * ★ 为什么不 `import type { InsertionPoint } from './gates/registry.ts'`：
 *   **本文件是一个零 import 的叶子**（t24 立的规矩，且有**两条**臂逐字钉住它：
 *   `gate-runtime-stall.test.mjs` 的"零 import"臂与 `gate-stall-leaf-home.test.mjs` 的
 *   臂 4"前提臂"）。⇒ 一旦这里 import 了 gates，叶子就变成图上的一个节点 ——
 *   ★ 而**这是真的环**：实测 `src/gates/index.ts` **可达** `src/types.ts`
 *   （`gate-run-entry` / `GateRunEntry` 那条引用），所以反向 import 会成环。
 *
 * ★★ 与 `FailureKindName` **逐字同一条先例**（就在上面）：
 *   "不 import"的代价是**这里多一份字面量** ⇒ 它必须有一条**机械的**保障，
 *   而不是靠"记得同步"。
 *   ⇒ 由 `scripts/` 里的一条臂**逐字比对**本清单与 `INSERTION_POINTS` 相等
 *     （★ 且那条臂**已注册进 `test:gates` 的跑者** —— 不在跑者里的判据等于没有）。
 *
 * ★ 它是**顺序敏感**的：`GATE_INSERTION_POINTS` 的次序**必须**与 `INSERTION_POINTS` 一致，
 *   因为读取端（UI 的六段遍历、`stageGroupState`）按它铺开。⇒ 逐字比对是**含序**的比对。
 */
export type GateInsertionPoint =
  | 'admission'
  | 'contract'
  | 'dispatch'
  | 'completion'
  | 'delivery'
  | 'runtime'
  | 'collection'

/**
 * 上述取值的运行期清单（与 `gates/registry.ts` 的 `INSERTION_POINTS` **同源同序**，
 * 由一条夹具逐字比对；★ 该夹具已注册进 `test:gates`）。
 */
export const GATE_INSERTION_POINTS: readonly GateInsertionPoint[] = [
  'admission',
  'contract',
  'dispatch',
  'completion',
  'delivery',
  'runtime',
  'collection',
]

/**
 * ── ★★ t81：按**段**落盘的判据裁决（`TeamTask.gateEvaluations`）────────────────────
 *
 * ★ 为什么需要它（而 `gateEvaluation` 不够）：
 *   `gateEvaluation` 是**单段**的（S1 只落 `completion`）。若 `dispatch` 也写它，
 *   就会**覆盖** completion ⇒ 两段互相踩。⇒ 按段存。
 *
 * ★★ 只有**三个**段会出现在这里 —— 因为它们才是**任务级**的事实：
 *
 * | 段 | 层级 | 会落盘吗 |
 * |---|---|---|
 * | `contract` · `dispatch` · `completion` | ★ **任务级** | ✅ **会** |
 * | `delivery` | ⚠️ 团队级（`delivery.ts`：整个团队的交付，不是某条任务） | ❌ **永不** |
 * | `runtime` | ⚠️ 事件级（`evaluateRuntimeGates`：跨步骤的过程约束） | ❌ **永不** |
 * | `admission` | ★ **空段**：三条判据存在但**未注册**（`gates/admission/*.ts`） | ❌（真的 0 条） |
 *
 * ⇒ ★★ **不许为了"凑齐六段"而给 delivery/runtime 编一个 per-task 裁决** ——
 *   那会造出一个**错误的事实**。UI 必须把它们显示成"团队级/事件级，不在任务上"。
 *
 * ★★ 而"没有裁决"的**四种成因必须不同形**（这是 t81 的最终目的）：
 *   · 段**真的没判据**（`admission`）      ⇒ 显示 `0 条`
 *   · 段**不是任务级事实**（`delivery`/`runtime`）⇒ 显示 `团队级`
 *   · 任务**还没走到**该段                ⇒ 显示 `未开始`
 *   · 走了、但**这一代没记**（retry 清过）  ⇒ 显示 `未落盘`
 *   ★ 四者混成一个 `○` 就是本仓记账最久的形态。
 *
 * ★ 与 `gateEvaluation` 的关系：**并存**，不是替代。
 *   · `gateEvaluation` —— S1 的形状，**既有读者仍在依赖**（`snapshot.ts`、`status.ts`），
 *     且它就是 `completion` 段那一格（UI 侧作为**兼容来源**读它）。
 *   · `gateEvaluations` —— 按段的新字段；UI **优先**读它。
 *   ⇒ 两格在 completion 段上**冗余但一致**（与 `auto.gate` / `auto.gates` 同一取舍）。
 */
export type GateEvaluationByPoint = Partial<Record<GateInsertionPoint, GateEvaluationRecord>>

/**
 * ── ★★★ t19：一次执行的**历史元素**（`TaskExecution`）────────────────────────────
 *
 * 一条 = **一次尝试走到了终态**。`TeamTask.executions[]` 按发生顺序装它们。
 *
 * ── ★★ 为什么这些格各自都必须在这里（每一条都有出处）────────────────────────────
 *
 *   `at`         —— ★ 排序的依据。**没有它，"有序数组"这句话就没有证据**：
 *                   一个只有内容的数组，读取端无法分辨"先失败后通过"与反过来。
 *   `attempt`    —— 第几次（与 `TeamTask.attempt` 同一套编号），用来把历史元素
 *                   与"当时那一代的 capability"对上。
 *   `attemptId`  —— ★ 那一代的 capability。缺席 ⇒ 当时没有 attemptId
 *                   （例如 captain 代落终态）。**不许编一个**。
 *   `round`      —— 收敛循环的第几轮（review/repair 才有）。★ 而它是**当时**的读数，
 *                   所以必须**抄进历史**：`TeamTask.round` 会被下一轮覆盖。
 *   `status`     —— 那一次落到了什么终态（`completed`/`failed`/…）。
 *   `verdict`    —— 审查类任务的裁决（`pass`/`needs_revision`/…）。
 *                   ★★ 这一格**正是**"收敛"与"一串事故"的分水岭：
 *                     `needs_revision` 落成 `status: 'failed'` 时会**看起来像一次失败**，
 *                     而它其实是**那一步成功地产出了一个否定结论**（t12 的
 *                     `failure_kind = inconclusive` 说的同一件事）。
 *   `failureKind`—— 只是失败时才有；与 `state.ts` 的 `failureKindOf` 同一套取值。
 *
 * ── ★ 三态在这条元素里也必须分形 ──────────────────────────────────────────────
 *
 * `verdict` / `round` / `failureKind` 各自**缺席**都有意义，而不许与"有个空值"同形：
 *   · `round` 缺席  —— 这不是收敛循环里的一轮（`work` 类没有轮次）
 *   · `verdict` 缺席 —— 这一次没有裁决（不是"裁决为空"）
 * ⇒ 所以它们是**可选**的，且**不填 `undefined`**（`exactOptionalPropertyTypes` 同源纪律）。
 */
export interface TaskExecution {
  /** ★ 这一刻（墙钟）。**排序依据** —— 见上面的长注释。 */
  at: number
  /** 这是第几次尝试（与 `TeamTask.attempt` 同一套编号）。 */
  attempt: number
  /** 当时那一代的 capability；缺席 = 当时没有（**不编一个**）。 */
  attemptId?: string
  /** 当时落的终态。 */
  status: TaskStatus
  /** 收敛循环的第几轮（review/repair 才有；缺席 = 不是一轮）。 */
  round?: number
  /** 那一次的裁决（审查类才有；缺席 = 没有裁决，不是"裁决为空"）。 */
  verdict?: ReviewVerdict
  /** 失败时的成因分类；与 `failureKindOf` 同一套取值 —— 见 {@link FailureKindName}。 */
  failureKind?: FailureKindName
  /** 谁把它落到这个终态的（成员名 / `captain`）。 */
  by?: string
}

/**
 * ── S1：completion 判据结果的**落盘形状**（`TeamTask.gateEvaluation`）──────────────
 *
 * ★★ 为什么**不复用** `src/gates/registry.ts` 的 `GateEvaluation` 类型，而是在这里
 *   重新声明一份**结构相同**的形状：`src/types.ts` 是一个**零 import 的叶子**
 *   （t24 立的规矩，且有夹具逐字断言它）—— 它一旦 import `gates/registry.ts`
 *   就成了图上的一个节点，而 `registry` 反过来要用 `types` ⇒ **成环**。
 *   ★ 与 `FailureKindName` 在这里持一份字面量、由夹具逐字比对，是同一条取舍。
 *
 * ★ 字段集是 `GateEvaluation` 的**持久化投影**（不是全抄）：
 *   · `ran` 原样保留 —— `skipped` 条目保留为 `verdict: 'skipped'`（"判据没跑"是记录，
 *     不是丢掉）；`observed` 原样保留（"开火了、被放过"必须可读，符号表 #4 的数据源）。
 *   · `outputs` 保留 —— 判据的**产物**（如 verify-rerun 的 reruns）本来就是数据流的一部分。
 *   · `requires` 的投影保留（计数 + 人话清单，去掉当场日志才需要的 `checks[]`）—— S2 转发 /state 时要用。
 *   · **不保留**：`context`（太大、且属于"当时那一刻"，不是结论）。
 *
 * ★ 三态在**这个形状本身**上就是可读的（见 `TeamTask.gateEvaluation` 的长注释）：
 *   字段缺席 / `ran: []` / 有内容 —— 三者由**读取端**直接分辨，不需要第二套字段。
 */
export interface GateEvaluationRecord {
  /** 整体裁决：本次求值有没有产出【位置级】的拒绝。 */
  ok: boolean
  /** 位置级 blocker 原文（`[gate.id] …`）。空数组 = 没有位置级拒绝。 */
  blockers: string[]
  /** 判据【跑了】而说"测不了"时的原文；缺席 = 没有"测不了"。 */
  unmeasured?: string
  /**
   * 逐条判据的结论，按注册顺序。
   * ★ `skipped` 条目**原样保留**（"判据没跑"是记录，不是丢掉）——
   *   它与"这条判据不存在"必须不同形（`registry.ts:136` 逐字警告过）。
   */
  ran: GateRunEntryRecord[]
  /** 判据自己的产物（键 = 判据 id）。**空对象 ≠ 缺席**：缺席 = 没有任何产物。 */
  outputs: Record<string, Record<string, unknown>>
  /** 这次真的跑了（`verdict ≠ 'skipped'`）几条。`0` 且 `registered > 0` ⇒ 全跳过。 */
  evaluated: number
  /** 这次被 `appliesTo` 跳过几条。`evaluated + skipped` = 本次涉及的判据总数。 */
  skipped: number
  /** 该位置挂了几条判据（与上下文无关）。`0` = 空位置（正常情形）。 */
  registered: number
  /** 「挂了判据却一条没跑」的人话说明；缺席 = 不是这个情形（空位置不产出它）。 */
  skippedAll?: string
  /** 观察模式下开火并被放过的条数；缺席 = 这次没有（或没在观察）。 */
  observedBlockers?: number
  /** 被放过的裁决原文（观察模式）；缺席 = 没有。 */
  observed?: {
    blockers?: readonly string[]
    unmeasured?: readonly string[]
  }
  /** 输入面核对结论（结构 = `registry.ts` 的 `RequiresAuditFieldView` 的持久化投影）。 */
  requires?: GateRequiresSummary
}

/** 输入面核对结论的**落盘投影**（`registry.ts` 的 `RequiresAuditFieldView` 去掉 `checks[]` —— 那是给当场日志的，落盘只留计数与人话清单）。 */
export interface GateRequiresSummary {
  checked: number
  incomplete: number
  skipped: number
  notApplicable: number
  inputSurfaceAbsent: number
  /** 缺了格子的（接线缺陷）人话清单。 */
  missing: string[]
  /** 声明缺口（`appliesTo` 读了、`requires` 没声明）清单 —— 与 `missing` 不同形。 */
  gateCellsUndeclared: string[]
}

/** 逐条判据的落盘条目（结构 = `registry.ts` 的 `GateRunEntry`，见上为何重声明）。 */
export interface GateRunEntryRecord {
  id: string
  verdict: 'ok' | 'blocked' | 'unmeasured' | 'skipped'
  count?: number
  produced?: boolean
  /** 「开火了、裁决被观察模式放过」；缺席 = 不是这个情形（不许用 false 冒充缺席）。 */
  observed?: boolean
  /**
   * ── ★ 这一步【为什么没测成】（结构与 `registry.ts` 的 `GateRunEntry.reason` 逐字相同）──
   *
   * 它表示：这条判据**跑过了**，而它（或框架替它）给出的「没测成」成因原文。
   *
   * ★ 缺席的三态（刻意不合成一条 required 规则）：
   *   `verdict: 'unmeasured'` ⇒ **必在场且非空** · `blocked` / `skipped` ⇒ 允许缺席。
   *
   * ★ 与 `produced` 差在哪：`produced` 是关于**产物**的布尔（"交出了东西吗"）；
   *   这里回答的是"**为什么没交出**读数"。★ 与 `observed` 差在哪：`observed`
   *   回答"裁决**有没有被采纳**"（观察模式），与"为什么没测成"是两件事。
   *
   * ★ 旧记录没有这一格 ⇒ 读侧**必须**当它缺席，不许抛错（`team.json` 是历史文件）。
   */
  reason?: string
}

/**
 * ── ★★★ 那份「已审查」的**逐条读数**（而不是一句"审过了"）────────────────────────
 *
 * 用户原话（本字段存在的理由）：
 * > 「有的任务是自动生成的，有的任务是需要问过我之后再生成、再派发的。
 * >   对于问过我、我裁决过的任务，在生成计划时就没有走自动生成的那一步，
 * >   也就没有『已审查』的字段，那它就需要被审查一遍。」
 *
 * ⇒ ★ 所以「带 reviewed ⇒ 放行；不带 ⇒ 派之前必须先审一遍」是一条**路由规则**，
 *   而这一格就是那个判据读的东西。
 *
 * ── ★★ 而它必须带 `checks[]`，不能只带一个布尔 ─────────────────────────────────
 *
 * ★ 一个 `reviewed: true` 与一个"审过了、逐条写着五问结果"的格子，
 *   在被路由程序读到的那一刻**同形** —— 而它们的可信度完全不同。
 * ⇒ 所以这一格记的是**逐条结论**（哪一问、什么结论、为什么），
 *   而读取方可以据此判断它是不是一条有内容的审查（见 `friction-triage` 的 `reviewStateOf`）。
 *
 * ── ★ 三态不同形（与全库那条纪律一致）──────────────────────────────────────────
 *
 *     `reviewed` 在场           ⇒ 盖章了（附逐条 checks）
 *     `reviewed` 缺席           ⇒ ★ **不是错误** —— 它是"这条路没走自动生成"的正常状态
 *     `reviewed` 在场而形状坏   ⇒ ★ 拒绝（不许静默丢掉 —— 那会让"审过了"与"没审"同形）
 */
export interface ReviewedStamp {
  /** Epoch ms when the review was stamped. */
  at: number
  /** Identity that performed the review (`adversarial`, `captain`, …). */
  by: string
  /** Per-question verdicts; a bare boolean would be indistinguishable from one here. */
  checks: ReviewedCheck[]
}

/** 五问里的一问：它是哪一问、结论是什么、为什么。 */
export interface ReviewedCheck {
  /** Question id (`scope`, `prerequisite`, `move`, `acceptance`, `boundary`, …). */
  id: string
  /**
   * ★★★ 三态，且**不许合并**（全库那条最贵的纪律）：
   *     `pass` / `fail` / `unmeasured`
   *   ⇒ 而 `unmeasured` **绝不并进 `pass`** —— "我没能审明白"与"审过了，没问题"不同形。
   */
  verdict: string
  /** Why this verdict — the reading that produced it. */
  why?: string
}

/** One task of a team's task list. */
export interface TeamTask {
  /** Stable task id from the profile template; absent for ad-hoc tasks. */
  profileSeedId?: string
  /** Stable task id within the team (`t1`, `t2`, …). */
  id: string
  /** Brief title for the task. */
  subject: string
  /** What needs to be done. */
  description?: string
  status: TaskStatus
  /** Member name (or `captain`) the task is assigned to; unassigned tasks await a claim. */
  assignee?: string
  /**
   * ── ★★ 它为什么停在终态（t55）────────────────────────────────────────────────
   *
   * 与 `status` **平级、不同轴**：`status` 说"停在哪一点"，本格说"为什么停在那里"。
   * ★ 缺席是**正常**的（多数任务不需要）：一个自己走到 `completed` 的任务
   *   没有任何"为什么停下"要交代 —— 它的 status 已经把话说完了。
   * ⇒ "缺席"与"记了 `not_delivered`"必须不同形（前者是"无需解释"，
   *   后者是"解释是：东西坏了"）。
   */
  delivery?: DeliveryRecord
  /** Task ids that must reach `completed` before this task can be claimed. */
  dependencies: string[]
  /** The worker's written result, set when the task completes or fails. */
  output?: string
  /** Monotonic execution generation. Reassignment/retry invalidates every older attempt. */
  attempt?: number
  /** Capability for the current claimed/in-progress attempt. Members must present it when updating. */
  attemptId?: string
  /** Opaque generation for a revocation/handoff that has not started its next attempt yet. */
  handoffId?: string
  /** Previous activation retained until a handoff drain succeeds (retryable). */
  handoffFromMemberId?: string
  /** A handoff is quiescing the old owner; the scheduler must not dispatch it yet. */
  reassigning?: boolean
  /**
   * ── ★★★ 上一次【投递失败】的成因（t43）──────────────────────────────────────
   *
   * MEASURED（2026-10-10）：派发链上前面每一格都是好的，而票送不出去 ——
   *   因为 `deliverToMember` 的 catch **只写 `logger.warn`**，而 `warn` 不进 `team.json`。
   *   ⇒ 调用方 `if (accepted) {…}` 不进 ⇒ **静默回滚** ⇒ 任务回 pending。
   *   ⇒ ★ 而那与"根本没人触发派发"在 `team.json` 上**完全同形**。
   *
   * ★★ 后果（本会话实测）：captain 反复重派、反复调 status、反复让用户重启 ——
   *   而每一次失败的方式都一样，而**每一次都看不见**。
   *
   * ⇒ 所以失败必须落进【别人读得到的地方】。★ 而它同时要说清【是哪一次尝试】，
   *   否则一条旧的失败原因会与"这次又失败了"同形。
   */
  deliveryFailure?: {
    /** 何时失败（墙钟）。 */
    at: number
    /** 当时那一代的 attempt 序号 —— ★ 缺了它，旧失败与本次失败同形。 */
    attempt: number
    /** 投递是怎么失败的（底层错误原文）。 */
    reason: string
  }
  /**
   * ── ★★★ 这条任务的产物落在哪个 commit 上（2026-10-10 加的）──────────────────────
   *
   * MEASURED：在此之前本插件只建树、不提交 ⇒ integrator **没有东西可合**。
   * ⇒ 落终态时把 worktree 的改动提交，并把 commit 短 id 记在这里。
   *
   * ★ 它的用处是**具体的**：integrator 要合"哪些东西"这个问题，
   *   答案必须是一个**可寻址的 commit**，而不是"某棵树上曾经有过一些改动"。
   *
   * ★ 三态（与全仓纪律同源）：
   *   · 有值     —— 提交成功，这是它的短 id
   *   · 缺席     —— 要么不建树（review/requirements），要么树里没有改动
   *   · `deliveryFailure` 在场 —— ★ 那是**提交失败**，必须与上面两种不同形
   */
  deliverableCommit?: string
  /** Quality-gate kind. Missing values are treated as `work`. */
  kind?: TaskKind
  /** Review / requirements / repair loop index, 1-based when present. */
  round?: number
  verdict?: ReviewVerdict
  findings?: ReviewFinding[]
  objective?: string
  inScope?: string[]
  outOfScope?: string[]
  acceptance?: string[]
  verify?: string[]
  deliverables?: string[]
  nonGoals?: string[]
  changedPaths?: string[]
  acceptanceResults?: AcceptanceResult[]
  commandsRun?: CommandResult[]
  /**
   * ── ★★★ S1：completion 位置判据结果的【落盘】（此前：求值 → 裁决 → 丢弃）──────────
   *
   * MEASURED（t69 实测、队长复核）：`completion` 位置的判据只在
   * `src/tools/update-task/completion.ts` 的 `registry.evaluate('completion', …)`
   * 求值一次；它的结果曾用于【那一次】裁决，然后**没有任何地方持久化到 task**
   * （`grep -rn "gateResults|gate_runs|gateRun" src/state.ts …` ⇒ 空）。
   * ⇒ B 线"按成员呈现判据"缺的不是 UI，是【服务端没有按任务落盘的判据结果】。
   *
   * ── ★★ 三态（本任务的中心判据，三者必须不同形）────────────────────────────────
   *
   *   · **字段缺席**   —— 这条任务**从来没求值过** completion 判据
   *                      （比如一次 in_progress 的中间更新、或终态补证据路径）。
   *   · **`ran: []`**  —— 求值了，但**一条判据都没跑**（空位置：`registered === 0`；
   *                      或全被 `appliesTo` 跳过 —— 那 `skippedAll` 在场）。
   *   · **有内容**     —— 求值了，`ran[]` 里有带裁决的条目。
   *
   * ★★ **不许把"没求值"写成"求值了且通过"**：一个恒在场的空/通过记录会让
   *   "这一步没被检查"与"这一步检查了且没事"在读取端同形 —— 那正是
   *   `registry.ts` 的 `GateRunEntry.observed` 注释逐字警告过的合流形态。
   *   ⇒ 落盘只在**真的求值过**时发生（见 `update-task.ts` 的落盘点），且**原样**
   *   抄写 `GateEvaluation`（`ran[]` 原样进来，`skipped` 条目原样保留为
   *   `verdict: 'skipped'`）—— 本字段是**记录**，不是**结论的改写**。
   *
   * ★ 与 `auto`（卡点台账）的 `taskId`/`teamId`（t69）**是两件事**：
   *   那个是【卡点台账】的归属落盘；这个是【任务自己】的判据结果落盘。
   *
   * ★ 与 `TeamTask.verdict` 不同轴：那是"这次更新被不被接受"的裁决；
   *   这个是"判据看到了什么"的记录 —— 判据开火而流程被放行（观察模式）时，
   *   两者必须能各自读出来。
   */
  gateEvaluation?: GateEvaluationRecord
  /**
   * ── ★★ t81：按**段**落盘的判据裁决（见 {@link GateEvaluationByPoint}）──────────────
   *
   * ★ `gateEvaluation` **原样保留**（S1 的既有读者依赖它）；本字段是**并存**的按段版本。
   * ★ 只有任务级的三个段（`contract` / `dispatch` / `completion`）会出现；
   *   `delivery` / `runtime` **永不出现**（团队级/事件级），`admission` 是空段。
   * ★ 三种"缺席"**不同形**：键不在（没走到 / 不是任务级）vs 值在但 `ran: []`（走了、没判据跑）。
   */
  gateEvaluations?: GateEvaluationByPoint
  /** Supplemental observations, attributed to their original execution generation. */
  supplementalEvidence?: TaskEvidence[]
  /**
   * ── ★★★ t19：这条任务**跑过的每一次**，按发生顺序（`executions[]`）────────────────
   *
   * 借自 `@linxin666/dsh-web-all` 的 task-board：那边渲染的是 `task.executions.length`
   * 作为"跑了几次"，于是**一次运行是历史里的一个元素，而不是一次状态转换**。
   *
   * ── ★★ 它修的是什么（MEASURED，本轮真实发生的那件事）──────────────────────────
   *
   * 本插件此前把每一次尝试**塌缩成一个当前状态**：一次 `needs_revision` 的审查
   * 落成 `status: 'failed'`，而"它是那个收敛循环里的第 2 轮"这件事**从记录里消失了**。
   * ⇒ 一个收敛的循环（失败、失败、通过）在用户眼里**读成一串互不相干的红色失败**，
   *   而不是"它在第二轮修好了"。
   *
   * ── ★ 为什么是**数组**而不是把 `round`/`verdict` 填得更满 ───────────────────────
   *
   * 那些是**单值**字段（`attempt?: number` / `round?: number` / `verdict?: ReviewVerdict`）
   * —— 它们**天生只能表达"现在"**。而"它失败过两次然后通过了"问的是**过去**：
   * 单值字段无论填得多满，都答不了它（第二次会覆盖第一次）。
   * ⇒ 唯一能回答它的形状是**有序数组**。
   *
   * ── ★★ 三态（与全仓纪律同源）──────────────────────────────────────────────────
   *
   *   · 有元素 —— 跑过 N 次，按发生顺序排列
   *   · **缺席** —— ★ **从未跑到终态**（还在第一次里）⇒ 与"跑过 0 次"不同形
   *   · 空数组 —— ★ **不出现**：本字段只在**追加**时出现（见 `appendExecution`）
   *
   * ★ 为什么空数组不该出现：一个恒在场的空数组会让"还没跑过"与"跑过但记录丢了"
   *   在读取端**同形** —— 而那正是本队一直在修的那条。
   *
   * ── ★ 它**只追加，不改写**（append-only）────────────────────────────────────────
   *
   * 一条历史元素记的是**当时发生了什么**。允许改写它等于允许"过去"被推翻 ——
   * 而那样一来"它失败过两次"这句话就不可依赖了。⇒ 唯一被允许的写操作是 push。
   */
  executions?: TaskExecution[]
  reviewedTaskId?: string
  reviewedAttempt?: number
  /**
   * ── ★★★ t97（吸收上游 #161 的 **S1**）：这份判决**绑定到了哪些字节** ──────────────
   *
   * 上游 #161 的原始缺陷（逐字）：
   * > 「A **passing review was not bound to the revision it judged**……
   * >   it advertised "all gates passed" over **bytes that had since been edited or deleted**.」
   *
   * MEASURED（t97 开工实测）：本仓此前有 `baseRevision`，而它是**git 对象名**
   *   （`tools.ts` 的注释逐字：「base 是一个 git 对象名」）——
   *   ★ **它回答不了"漂了没有"**：`cherry-pick` / `rebase` 会改那个名字，
   *     而字节没变 ⇒ 用它当摘要会**在两个方向上误判**。
   *   ★★ 它还**只在** `recordBaseRevision` 那一处被写，与判决无关。
   *
   * ⇒ 这一格记的是**内容**摘要：`(路径, sha256(文件字节))`。
   *
   * ── ★★★ 而它会让【所有历史判决】立刻落 `unauditable gap` —— 那【是正确行为】──
   *
   * ```
   * 今天盘上的判决【都没有这一格】（本字段是本次新加的）
   * ⇒ 它们无法回答"我判的是哪批字节"
   * ⇒ 按上游的口径，它们必须被报成「早于内容绑定」（unauditable gap），
   *   ★ 【而不是】被读成"对当前字节的一次通过"。
   * ```
   * ★★ 那**不是副作用，是 ③ 的正确行为** —— 上游逐字：
   * > 「A verdict that **predates content binding** is reported as an
   * >   **unauditable gap** rather than being read as a pass over the current bytes.」
   * ★★ **别把"判据突然变严"当 bug**：它变严是因为此前它在**读一个它没有的信息**。
   *
   * ★ 缺席的语义（三态之一）：**没有这一格 = 早于内容绑定**。
   *   ★ 与"有这一格但是空数组"**不同形**：后者是"判过了、且它没绑定任何文件"。
   *
   * ★★ **本任务只做 S1**：记下来，并能回答那三个问题（无摘要 / 漂了 / 没漂）。
   *   判据逻辑（`verdictDrift` / `bindsRecordedRevision`）与 blocker/warning 分级是 S3/S4。
   */
  reviewedArtifacts?: readonly ReviewedArtifact[]
  /**
   * ── ★★★ t2：那份「已审查」的盖章 —— 而它**可选**，且缺席是正常状态 ────────────
   *
   * ★ 路由规则（`friction-triage` 的 `reviewStateOf`）：带 `reviewed` ⇒ 放行；
   *   不带 ⇒ **派之前必须先审一遍**。
   *   ⇒ 而"不带"**不是错误** —— 它是"这条路没走自动生成"（问过用户、用户裁决过的）的正规形态。
   *   ★★ 所以这一格**不许**变成必填：把它变成必填会让每一条手工裁决的任务都无法落盘，
   *     而那正是这条规则要服务的那一类任务。
   *
   * ★ 与 `reviewedTaskId` **是两件不同的事**：那个指的是"**哪一条**任务被审过"，
   *   而这一个记的是"**审的结果**"（逐条 checks）。两者可以各自在场、各自缺席。
   */
  reviewed?: ReviewedStamp
  /**
   * ── ★★★ t14：这条任务由**哪个模型**执行（每一次执行的绑定）──────────────────────
   *
   * ★ 为什么挂在**任务**上而不是**成员**上：一个持久成员在**多轮里执行许多不同的
   *   任务** ⇒ "这个成员的模型"**指不出"这条结果是谁产出的"**。
   *   而绑定挂在这里 ⇒ 每一条结果的归属**有唯一答案**。
   *   来源：@linxin666/dsh-web-all 的 task-board（每条 task 自带 model +
   *   `executions[]` —— **一次运行是历史里的一个元素，而不是一次状态转换**）。
   *
   * ★ 三态（与全仓纪律同源）：
   *   · 有值   —— 这条任务声明了由这个模型执行
   *   · 缺席   —— **没声明**（走该成员自己的路由；这是合法状态，不是错误）
   *
   * ★★ 而它一旦**执行过**就是**封条**：`modelBindingIsSealed` 判它，改 ⇒ **拒绝**。
   *   理由：改一条已跑过的任务的模型会**毁掉归属** ——
   *   "这条结果是谁产出的"从那一刻起没有唯一答案。用户明确接受**推迟**那件事。
   */
  model?: string
  /** 本条任务绑定的推理档位。★ 只有与 `model` **同时**在场才有意义。 */
  reasoningEffort?: string
  /** Repair source: the implementation / previous successful artifact. */
  sourceTaskId?: string
  sourceFindingIds?: string[]
  /** User-constraint / goal items this task claims to cover. */
  coverageOf?: string[]
  /** Captain-only contract amendments, oldest first (see amendTaskContract). */
  revisions?: TaskRevision[]
  createdAt: number
  updatedAt: number
  /**
   * ── ★★★「这次拒绝之后，任务有没有继续往下走」—— C1 的机械判据 ──────────────────
   *
   * 用户裁定（`docs/PENDING-FRICTION-REFORM.md` §0，逐字）：
   *   「卡点就是让任务停下来的地方」「如果不阻塞任务，其实不算卡点」。
   * ⇒ 卡点记的是【状态：任务停住了】，不是【事件：判据报错了】。
   *
   * ── 为什么它是一格【持久状态】而不是当场算出来的一个布尔 ──────────────────────
   *
   * 「有没有继续往下走」这句话在**一次**拒绝的那一下**无从判断** ——
   * 唯一能回答它的东西是【下一次拒绝】。一次拒绝之后成员改了字段再报，
   * 任务就继续走了；同样的拒绝再来一次，它才停住了。
   * ⇒ 所以判据必须是**跨调用**的，而跨调用就必须落盘（本格）。
   *
   * ── ★★ 三态（★ 而它们的补救动作不同 ⇒ 必须不同形）────────────────────────────
   *
   *     `trying`   —— 第一次被这条判据拒（★ 默认：自己先解，见 C2）
   *                   ⇒ 记 `rejections`（保留证据，**不是卡点**），不惊动人
   *     `stalled`  —— **同一个 `(taskId, gateId)`** 又拒了一次
   *                   ⇒ ★ 这才记 `frictions`（真卡点：任务确实停住了）
   *     （缺席）    —— 从未被拒过，或最近一次已放行
   *
   * ★ 三者不许合流：把 `trying` 并进 `stalled` 就是本任务要修的那个缺陷
   *   （207 条判据拒绝日志 ≠ 21 条真卡点）；把 `stalled` 并进 `trying`
   *   会让真正停住的任务**永远不产生卡点**（另一个方向的同一类错误）。
   *
   * ★ N = 2（用户已确认）：1 次是正常的"填错了改一下"，2 次说明它卡在同一个地方了。
   * ★ 本字段是**落盘的读数**，不是判据的输入 —— 判据看的是它，但改判据的 N
   *   不该需要改这里（见 `STALL_REPEAT_THRESHOLD`）。
   */
  stall?: TaskStall
}

/**
 * ── ★★ 同一条判据把同一件事拒了几次（C1）──────────────────────────────────────
 *
 * 键是 `(taskId, gateId)`：**同一个判据**重复拒绝**同一个任务**才算"停住"。
 * ★ 不是"被拒了几次" —— 五个不同判据各拒一次是**五件不同的事**，
 *   而把它们数成一个数字会让"每次都被不同的门拦"读成"卡在同一处"。
 */
export interface TaskStall {
  /** 最近一次拒绝它的判据 id（`completion.mutation` 那一类）。读不出来 ⇒ 缺席，不猜。 */
  gate?: string
  /** 判据位置（`contract` / `dispatch` / `completion` / …）。 */
  point: string
  /** ★ 三态：`trying`（还自己解得了）/ `stalled`（停住了）。 */
  state: StallState
  /** 这个 `(task, gate)` 被拒的次数（含第一次）。 */
  count: number
  /** 最近一次被拒的时刻（墙钟）。 */
  at: number
}

/**
 * ★ 三态里的**【两态】** —— 这里刻意没有第三态：本字段**缺席**就是第三态
 *   （"从未被拒"），而"缺席"与"记着一个值"必须不同形（本仓反复记账的那条）。
 */
export type StallState = 'trying' | 'stalled'

/**
 * ── ★★★ C1 的判据本体：这一次拒绝之后，任务**有没有继续往下走** ──────────────────
 *
 * 用户裁定（`docs/PENDING-FRICTION-REFORM.md` §0，逐字）：
 *   「卡点就是让任务停下来的地方」「如果不阻塞任务，其实不算卡点」。
 * ⇒ 判据是机械的：**同一个 `(taskId, gateId)` 被拒 ≥2 次 = 停住了**。
 *
 * ── ★★★ 为什么它住在这里（一个 **零 import 的叶子模块**），而不是住在 tools/ ────
 *
 * MEASURED（t24，由 t6 的持有者先撞上并逐条复现）：
 * 本函数原先住在 `src/tools/shared/entities.ts`，于是**判据层没法用它** ——
 *
 *     runtime/stall.ts -> tools/shared/entities.ts -> gates/index.ts -> runtime/stall.ts
 *                                                       ↑ 成环
 *
 * 因为 `entities.ts:27` import 了 `gates/index.ts`，而 `gates/index.ts` import 每一条判据。
 * ⇒ 判据层若要用它，只有两条路：**复制一份**（第二个真相，本仓反复记账的形态）
 *   或**成环**。两条都不可接受。
 *
 * ★ 而本仓有一条**实测出来的不变量**：`grep -rn "from '../../tools" src/gates/` 是空的 ——
 *   **判据层是一个不 import tools/ 任何东西的纯模块**。这条不变量是承重的（它让判据
 *   可以在没有 tools 层的情况下单测、且不会与状态层互相锁死）。
 * ⇒ 所以正确的修法是**把判据搬到双方都能 import 的叶子上**，而不是让判据层破例。
 *
 * ★★ 为什么这个叶子是 `types.ts`：它**一个 import 都没有**（本文件是纯类型声明），
 *   因此谁 import 它都不会成环。而 `TaskStall` / `StallState` **本来就住在这里**
 *   ⇒ 搬家之后，**类型与它的观察者同处一室**，比原来（类型在 types.ts、判据在
 *   entities.ts）**更内聚**，而不是更散。
 *
 * ★★★ 而这条性质**必须被机械守住**：`types.ts` 之所以是叶子，**只因为**它没有任何
 *   import。一行 import 就会把它变成图上的一个节点，于是这个环会在**下一层**重新长出来
 *   （而且长得更隐蔽：报错会指向别的文件）。⇒ 夹具里有一条臂断言本文件**零 import**。
 *   见 `scripts/gate-stall-leaf-home.test.mjs` 臂 4。
 *
 * ── ★★ 为什么"同一个判据"必须是键的一部分 ────────────────────────────────────
 *
 * 五个**不同**的判据各拒一次是**五件不同的事**（成员每次都在改，只是每次
 * 撞上另一条门）。把它们数成一个数字会让"每次都被不同的门拦"读成"卡在同一处"
 * —— 而那正好是本任务要消灭的那个合流（换成计数版本）。
 *
 * ── ★★ 为什么 N 是【可注入】的（本仓教训，逐字）───────────────────────────────
 *
 * `docs/PENDING-FRICTION-REFORM.md` §2：「`with-timeout` 那族缺陷连躲三次，
 * 根因都是『上限是硬编码常量，短测试复现不了』」⇒ N 必须能注入。
 * ★ 而注入的是**上限**，不是判据本身 —— 判据仍然只有一处实现。
 * ★ 注入口是环境变量（与 `restartEscapeHatchFromEnv` 同一形态：**明写的、可核的**），
 *   缺省 2（用户已确认）。★ 读不出数就**回落缺省**，而不是当成 0：
 *   一个坏值会让每一片拒绝都变成卡点（或一条都不变）。
 */
export const STALL_REPEAT_THRESHOLD = 2

/** ★ `observeStall` 的三态结论（见那里的长注释）。 */
export interface StallObservation {
  /** ★ 这是不是"任务已经停住"（= 同一 `(task, gate)` 被拒 ≥N 次）。 */
  stalled: boolean
  /** 这个 `(task, gate)` 被拒的次数（含这一次）。 */
  count: number
  /**
   * ★ 这个数字代表什么 —— **不许省略**。
   *
   *   `repeated`  —— 同一个判据重复拒绝（**这就是判据本身**）
   *   `first`     —— 第一次被拒（⇒ 还自己解得了）
   *   `unknown`   —— 判据 id 读不出来 ⇒ **判不了**
   *
   * ★ 第三态不许并进前两者：把 `unknown` 读成 `first` 会让"读不到 id"
   *   变成"它没停"（错的）；读成 `repeated` 会让每一条读不出 id 的拒绝
   *   都变成卡点（把 207 条又请回来）。
   *   ⇒ 落 `first`（保守：不惊动人）**并在记录里说清为什么判不了**。
   */
  basis: 'first' | 'repeated' | 'unknown'
}

/**
 * 读 N（`AGENT_TEAMS_STALL_REPEAT_THRESHOLD`）。
 *
 * ★ 坏值 / 空白 ⇒ **回落缺省**，而不是当成 0（那会让每一片拒绝都变成卡点）
 *   也不是抛错（一个因为参数没写对就炸的守卫会被关掉）。
 */
export function stallRepeatThreshold(env: Record<string, string | undefined> = process.env): number {
  const raw = env.AGENT_TEAMS_STALL_REPEAT_THRESHOLD
  if (raw === undefined || raw.trim() === '') return STALL_REPEAT_THRESHOLD
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) return STALL_REPEAT_THRESHOLD
  return parsed
}

/**
 * ── ★★★ 算出这一次拒绝之后任务停没停（C1 的判据本体）────────────────────────────
 *
 * 输入：这个任务**上一次**的 `stall` 读数（`task.stall`，可能缺席）+ 这一次的判据 id。
 * 输出：三态观察（`first` / `repeated` / `unknown`）。
 *
 * ── ★ 为什么密钥是 `(gate, point)` 而不只是 `gate` ──────────────────────────────
 *
 * 判据 id 在注册表里**唯一**（`completion.mutation` 只有一个位置），所以
 * 只按 gate 判就已经够了。★ 而 `point` **也**要一起比，是因为判据 id 读不出来时
 * （`unknown` 那一态）`gate` 是 `undefined`：那时若只比 `undefined === undefined`，
 * **两条毫不相干的、都读不出 id 的拒绝**会被算成"同一个判据拒了两次"。
 * ⇒ 加上 `point`，两处都读不出来时也要求位置相同。
 *   ★ 而它仍然可能把同一个位置上的两条**不同**判据算成一条 —— 所以那条路上
 *     我们落的是 `unknown`（保守：不惊动人），而不是 `repeated`。
 */
export function observeStall(
  previous: TaskStall | undefined,
  gate: string | undefined,
  point: string,
  /** ★ 这一次之前这个 `(task, gate)` 已经被拒了几次（由任务级读出，可注入）。 */
  priorCount = 0,
  threshold: number = stallRepeatThreshold(),
): StallObservation {
  /**
   * ★ 判据 id 读不出来 ⇒ **判不了**（第三态）。★ 不许并进另外两态：
   *   并进 `first` 是把"读不到"说成"它没停"；并进 `repeated` 是把
   *   **每一条**读不出 id 的拒绝都变成卡点（那 207 条就全回来了）。
   */
  if (gate === undefined || gate.trim() === '') {
    return { stalled: false, count: priorCount + 1, basis: 'unknown' }
  }
  const sameGate = previous !== undefined
    && previous.gate === gate
    && previous.point === point
  const count = sameGate ? (previous.count ?? 0) + 1 : priorCount + 1
  const stalled = sameGate && count >= threshold
  return { stalled, count, basis: stalled ? 'repeated' : 'first' }
  /**
   * ★ 【时间】刻意**不**参与判定：用"过了多久"当判据会让**同一份输入**
   *   在快机器与慢机器上给出不同裁决，而那是本仓 `with-timeout` 那族缺陷的
   *   同一形态（`docs/PENDING-FRICTION-REFORM.md` §2 记的正是它）。
   *   判据只用**次数** —— 次数与机器速度无关。
   */
}

/** 成员生命周期状态。 */
export type MemberStatus = 'idle' | 'working' | 'removed'

/** One team member: a continuable subagent plus its team-side record. */
export interface TeamMember {
  /** Durable continuable subagent session id (empty until spawned). */
  id: string
  /** Unique display name inside the team. */
  name: string
  /** Role description, e.g. `researcher`, `engineer`, `reviewer`. */
  role?: string
  /** Resolved LLM provider route captured when this member was created. */
  provider?: string
  /** Resolved model captured when this member was created. */
  model?: string
  /** Resolved reasoning effort captured from the captain or target model default. */
  reasoningEffort?: string
  /** Prompt specific to this member's execution turns. */
  executionPrompt?: string
  /** Configured second-choice route. */
  fallback?: TeamModelFallback
  /** Active route after fallback, without changing the primary descriptor route. */
  activeProvider?: string
  activeModel?: string
  /** Whether the fallback route is currently active. */
  fallbackActive?: boolean
  joinedAt: number
  status: MemberStatus
  /** Execution admission is closed while a failed/pending handoff is drained. */
  stopping?: boolean
  /**
   * Last member-start failure, recorded so the captain can see why a member
   * never acquired a session instead of observing an unexplained `unspawned`
   * member. Cleared by the next successful start.
   */
  spawnError?: string
  /**
   * ── ★★ 成员的"子域设置"，只在 managed activation 宿主上出现 ────────────────────
   *
   * MEASURED（0.2.1-rc.2）：宿主的 activation 请求里**不再有** persona /
   * toolFilter，新的 subagent descriptor 也不再持久化它们。
   * ⇒ 这两样改由本插件在子 ctx 上装（`systemPrompt.section` + `tools.restrict`）。
   *   而"装什么"必须能被**冷恢复**重放 —— 于是存进成员的持久记录。
   *
   * ★ 为什么不是从 descriptor 读回来：新宿主根本不写它。
   * ★ 为什么必须持久化而不是只放内存：进程重启后 `pendingSetup` 是空的，
   *   而成员会以 `runtimeSetup` 为唯一依据恢复自己的限制（读不到就拒绝恢复，
   *   见 `installMemberSelectionRuntime`）。
   */
  runtimeSetup?: { persona: string; toolFilter: MemberToolFilter }
}

/** One mailbox message. */
export interface TeamMessage {
  id: string
  /** `captain` or a member name. */
  from: string
  /** `captain` or a member name. */
  to: string
  content: string
  ts: number
  /** Process-local delivery lease; prevents fallback and direct delivery racing. */
  deliveryClaimedAt?: number
  /** Set after the durable message was accepted by the recipient's live Harness inbox. */
  deliveredAt?: number
  /** Set once the recipient has consumed or been shown the durable fallback. */
  readAt?: number
  /** Guidance is scoped to the recipient's execution generation, when present. */
  taskId?: string
  attemptId?: string
  /** Source execution generation, independent of the recipient guidance generation. */
  sourceTaskId?: string
  sourceAttemptId?: string
  sourceTaskStatus?: TaskStatus
  /** Cancelled delivery is retained for audit but must not wake the recipient. */
  discardedAt?: number
}

/** Snapshot of the named profile used to seed a team. */
export interface TeamModelFallback {
  provider: string
  model: string
}

export interface TeamProfileSnapshot {
  name: string
  description?: string
  protocol?: string
  executionPrompt?: string
  fallback?: TeamModelFallback
  /** Frozen planning mode: captain plans the graph; seed keeps template tasks. */
  taskPlanning?: 'captain' | 'seed'
  /** Frozen review-loop policy from the creating profile. */
  reviewPolicy?: ReviewPolicy
}

/** The full durable team record. */
export interface TeamState {
  /** Original team name. */
  name: string
  /** Sanitized directory id; the team's stable identity. */
  id: string
  /** Team purpose/goal. */
  description?: string
  /** Immutable named profile snapshot, when created from a profile. */
  profile?: TeamProfileSnapshot
  /** Session id of the captain agent that owns this team. */
  captainSessionId: string
  createdAt: number
  /** Teammates only; the captain is implicit (the owning session). */
  members: TeamMember[]
  tasks: TeamTask[]
  /** Monotonic task id counter. */
  taskSeq: number
  /**
   * Two-phase execution lifecycle. Missing means `running` for durable
   * compatibility with teams created before staging existed.
   */
  phase?: 'staged' | 'running'
  /**
   * Human-facing review sub-state while `phase` is `staged`. Missing staged
   * records are treated as `awaiting_review` for backward compatibility.
   * `awaiting_feedback` means the user returned to chat and the Captain must
   * ask what should change before editing this same draft.
   */
  planReviewState?: 'awaiting_review' | 'awaiting_feedback'
  /** Timestamp written only after a staged plan is explicitly approved. */
  approvedAt?: number
  /**
   * Human halt from the captain chat. The team remains on disk, members stay
   * available, and unfinished work is cancelled until the captain resumes.
   */
  halted?: boolean
  /** Timestamp of the latest human halt, when present. */
  haltedAt?: number
  /** Review-loop policy snapshot copied from the creating profile, when present. */
  reviewPolicy?: ReviewPolicy
  /** Set when an automatic review/repair loop hits its configured ceiling. */
  escalated?: boolean
  /**
   * ── ★★★ 计划审查环已经转了几轮（N5 / t8）────────────────────────────────────
   *
   * `edit_plan` **每调用一次** +1（★ 不是每个 operation +1 —— 一次调用含多个
   * operation 在语义上是**一轮反馈**；按 operation 计数会让一次批量修 5 处
   * 吃掉 5/3 轮，上限在第一次真实修订就打爆）。
   *
   * ★ 计数落点在 `updatePlanBatch` 的 `withTeamLock` 内、与"打回 awaiting_review"
   *   **同一个 `writeTeam`** 上（N5.12 漏洞 3：写在别处会让"打回"与"计数"在
   *   不同的事务边界上，一次在锁内失败的操作可能已经计了数却没打回，或反之）。
   *
   * ★★ 与 `planReviewState` **不同**：`approveStagedTeam` 会 `delete` 那一格
   *   （审查上下文随批准结束），但**不删这一格** —— 否则"这个计划审了几轮才通过"
   *   在批准之后永久丢失，而那正是自迭代最需要的那条读数（N5.13）。
   *
   * ★ 缺席 = 本轮之前建的队 ⇒ 读侧按 `0`，但 `describePlanLoop.roundsSource`
   *   会把它与"确实是 0"分开（三态纪律）。
   */
  planReviewRounds?: number
  /**
   * ── ★★★ 计划审查环已敲响上限（N5.14）─────────────────────────────────────────
   *
   * ★★ **本格归计划环独有 —— 不许复用 `team.escalated`**：
   *   `team.escalated` 是**质量环**的位，全仓**只有一个写入点**且**没有清除点**
   *   （`resume` 只清 `halted`），同时它还是两个交付阻断项的来源。
   *   ⇒ 若计划环写它，**一次计划超轮 = 整队永久不可交付，连 resume 都解不开**。
   *   ⇒ 通用教训：复用别人的状态位之前，先数它有**几个清除点**；
   *     只写不清的位对它自己的主人是对的，对借用它的人是陷阱。
   *
   * 清除点：下一次 `edit_plan` 打回 `awaiting_review` 时一并清（与计数同一处），
   * 以及 `resume` 的**显式归零**（`rounds = 0` + 清 flag）。
   *
   * ★★ 而"只清 flag 不归零"**不算解除**：那会让 `rounds >= maxRounds`
   *   在**同一份数据上立刻重新算出** escalated（审查者实测的死码）。
   */
  planReviewEscalated?: boolean
}

/**
 * ── ★★★ t19：把"这一次执行"追加进历史（**唯一被允许的写操作**）──────────────────
 *
 * ★★ 它【只追加】，从不改写 —— 那不是一个风格选择，是这一格能不能被信任的前提：
 *   一条历史元素记的是**当时发生了什么**。允许改它等于允许"过去"被推翻，
 *   而那样一来"它失败过两次"这句话就不可依赖了（本仓那条：
 *   **记录被改写之后不可重算**）。
 *
 * ★ 为什么它是**纯函数**（改传入的 task，返回它）：调用点在 `update-task.ts` 的
 *   终态分支里 —— 那里已经持有 `fresh` 那一份权威状态（在锁里）。
 *   ⇒ 让它在这里**再读一次盘**会读到另一个时刻的事实（与 C1 的 `observeStall`
 *     同一条纪律：别让判据自己去找状态）。
 *
 * ── ★★ 三态：它**不制造空数组** ────────────────────────────────────────────────
 *
 * 第一次调用**建立**数组；在那之前 `executions` **缺席**。
 * ⇒ "从未跑到终态"（缺席）与"跑到过终态但记录是空的"（空数组）不同形 ——
 *   而后者**永远不会出现**，因为本函数只在追加时建立它。
 */
export function appendExecution(task: TeamTask, execution: TaskExecution): TaskExecution {
  /**
   * ★ 数组**原地** push：`task.executions` 是这条任务自己的历史，
   *   而调用方持有的是同一份对象（在锁里）。
   * ★ 缺席 ⇒ 先建空数组 ⇒ 于是"第一条"与"第 N 条"走**同一条**代码路径
   *   （两处各写一遍会让它们在"第一条要不要建数组"上分叉）。
   */
  const history = task.executions ?? []
  history.push(execution)
  task.executions = history
  return execution
}

/**
 * ── ★★★ t19：把历史读成一句**人能读的**结论（"收敛了没有"）─────────────────────
 *
 * 用户的原话（本函数存在的理由）：
 *   「一个收敛的循环，在用户眼里读成一串互不相干的红色失败」。
 *
 * ★★ 而"收敛"与"一串事故"的**机械区别**只有一条：
 *   **最后一次是好的，而它前面有过不好的** —— 那就是收敛；
 *   最后一次也是不好的 ⇒ 那是**还没解决**（不是"收敛"）。
 *
 * ── ★ 三态（不是二态）──────────────────────────────────────────────────────────
 *
 *     `converged`     —— 末次成功，且此前有过失败（★ 这就是"失败两次然后通过"）
 *     `first-pass`    —— 一次就成（**没有**失败过）⇒ 与收敛**不同形**：
 *                        收敛的补救动作是"这个循环有效"，而这个什么都不用做
 *     `still-failing` —— 末次仍失败 ⇒ **还没收敛**（★ 不许并进 `converged`：
 *                        那会把"还没修好"读成"修好了"，方向反了）
 *
 * ★ `executions` 缺席（从未跑到终态）⇒ `rounds: 0` 而 `outcome: undefined` ——
 *   **不是** `first-pass`：一次都还没跑完，与"一次就成"不同形。
 */
export interface ExecutionHistorySummary {
  /** 跑到过终态的次数（`executions.length`；缺席 ⇒ 0）。 */
  rounds: number
  /** 见过的最大轮次号（`round` 的最大值；一个都没有 ⇒ 缺席）。 */
  maxRound?: number
  /** 三态结论；`executions` 缺席 ⇒ 缺席（**不是** `first-pass`）。 */
  outcome?: 'converged' | 'first-pass' | 'still-failing'
  /** 失败过几次（`status === 'failed'`）。 */
  failures: number
}

export function summariseExecutions(task: Pick<TeamTask, 'executions'>): ExecutionHistorySummary {
  const history = task.executions
  /** ★ 缺席 ⇒ 一次都还没跑到终态。**不许**读成 `first-pass`（那是"跑过一次且成了"）。 */
  if (history === undefined || history.length === 0) {
    return { rounds: 0, failures: 0 }
  }
  const rounds = history.length
  const failures = history.filter((entry) => entry.status === 'failed').length
  const maxRounds = history.map((entry) => entry.round).filter((round): round is number => typeof round === 'number')
  const last = history[history.length - 1]
  /**
   * ★ 末次是不是"好的" —— 判据是 `status === 'completed'`。
   *   ★ 而 `failed` 里面**混着两种东西**（`needs_revision` 的否定结论 vs 东西真的坏了，
   *     见 t12 的 `failure_kind`）—— 但对**收敛**这个问句而言两者一样：
   *     那一次没有走到 `completed` ⇒ 循环还要继续。
   *   ⇒ 所以这里**只用 status**，不替读取端解释 verdict（那件事归 t12/t13）。
   */
  const lastSucceeded = last !== undefined && last.status === 'completed'
  const outcome: ExecutionHistorySummary['outcome'] = lastSucceeded
    ? (failures > 0 ? 'converged' : 'first-pass')
    : (failures > 0 ? 'still-failing' : undefined)
  return {
    rounds,
    failures,
    ...maxRounds.length === 0 ? {} : { maxRound: Math.max(...maxRounds) },
    ...outcome === undefined ? {} : { outcome },
  }
}
