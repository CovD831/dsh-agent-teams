/**
 * Durable AgentTeams state types.
 *
 * A team is one directory under the state root holding `team.json` plus an
 * `inbox/` of per-agent JSONL mailboxes. Members are continuable subagents
 * whose durable child session ids are recorded in the team file, so a team
 * survives harness restarts.
 * @module dsh-agent-teams/types
 */

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

export const TASK_KINDS: readonly TaskKind[] = [
  'requirements',
  'implementation',
  'verification',
  'review',
  'repair',
  'integration',
  'work',
]

/** Review / requirements conclusion. Only `pass` may complete those kinds. */
export type ReviewVerdict = 'pass' | 'needs_revision' | 'reject'

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
  /** Supplemental observations, attributed to their original execution generation. */
  supplementalEvidence?: TaskEvidence[]
  reviewedTaskId?: string
  reviewedAttempt?: number
  /** Repair source: the implementation / previous successful artifact. */
  sourceTaskId?: string
  sourceFindingIds?: string[]
  /** User-constraint / goal items this task claims to cover. */
  coverageOf?: string[]
  /** Captain-only contract amendments, oldest first (see amendTaskContract). */
  revisions?: TaskRevision[]
  createdAt: number
  updatedAt: number
}

/** Member lifecycle status. */
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
}
