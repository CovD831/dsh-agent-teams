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
export type TaskStatus = 'pending' | 'claimed' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
/** Statuses after which a task can no longer be claimed or worked on. */
export declare const TERMINAL_TASK_STATUSES: readonly TaskStatus[];
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
export type DeliveryOutcome = 'delivered_blocked' | 'not_delivered' | 'gate_fault';
export declare const DELIVERY_OUTCOMES: readonly DeliveryOutcome[];
/**
 * 一次收口的记录：**谁**把它落成终态、**为什么**、以及**门说了什么**。
 *
 * ★ 它挂在任务上（与 `verdict` / `findings` 平级），不改 `status` 的取值域 ——
 *   见 {@link DeliveryOutcome} 里那段"为什么不新增一个 status"。
 */
export interface DeliveryRecord {
    /** 三种收口之一。★ 三态不同形，因为补救动作不同。 */
    outcome: DeliveryOutcome;
    /**
     * ── ★★ 门给的**拒绝原文**（`delivered_blocked` / `gate_fault` 时必填）──────────
     *
     * 判据的原话。★ 少了它，这一格与"做坏了"在读的人眼里同形 ——
     * 而"哪一道门拦的、它到底说了什么"正是下一个人（或下一个会话）唯一的线索。
     *
     * ★ 它**不是**摘要、不是转述：转述会丢掉判据自己那句话里的限定语，
     *   而那正是判断"门是不是错了"的依据。
     */
    gateRefusals?: string[];
    /** 人话一句：为什么这么收口。★ 可选，但 `not_delivered` 时应当有。 */
    reason?: string;
    /** 落这一笔的人 / 角色（`captain`、成员名…）。 */
    by?: string;
    /** 落笔时刻（epoch ms）。★ 由调用方注入，本文件不读时钟。 */
    at?: number;
}
/** Structured quality-gate kind. Absent / unknown values are treated as `work`. */
export type TaskKind = 'requirements' | 'implementation' | 'verification' | 'review' | 'repair' | 'integration' | 'work';
export declare const TASK_KINDS: readonly TaskKind[];
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
export declare const KINDS_NEEDING_WORKTREE: readonly TaskKind[];
/** 这个 kind 会不会被派发到隔离 worktree（⇒ 它有父版本可对照）。 */
export declare function needsWorktreeFor(kind: string | undefined): boolean;
/** Review / requirements conclusion. Only `pass` may complete those kinds. */
export type ReviewVerdict = 'pass' | 'needs_revision' | 'reject';
export declare const REVIEW_VERDICTS: readonly ReviewVerdict[];
/** Finding severity used by review / requirements output. */
export type FindingSeverity = 'low' | 'medium' | 'high' | 'blocker';
export declare const FINDING_SEVERITIES: readonly FindingSeverity[];
/** One structured review finding. */
export interface ReviewFinding {
    /** Stable id, for example `SEC-001`. */
    id: string;
    severity: FindingSeverity;
    file?: string;
    line?: number;
    problem: string;
    requiredFix: string;
    resolved?: boolean;
}
/** One acceptance criterion result recorded at completion. */
export interface AcceptanceResult {
    criterion: string;
    status: 'passed' | 'failed';
    evidence?: string;
}
/** One verification command result recorded at completion. */
export interface CommandResult {
    command: string;
    status: 'passed' | 'failed';
    exitCode?: number;
    evidence?: string;
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
    failures?: readonly string[];
}
/** Profile / team review-loop limits. */
export interface ReviewPolicy {
    requirementsMinRounds?: number;
    requirementsMaxRounds?: number;
    codeMaxRounds?: number;
    maxRepairAttempts?: number;
    requiredReviewers?: string[];
}
/** One captain-only contract amendment recorded on a quality task. */
export interface TaskRevision {
    /** Epoch ms when the amendment was applied. */
    at: number;
    /** Identity that applied it (`captain`). */
    by: string;
    /** Why the previous contract was wrong; kept for the audit trail. */
    reason: string;
    /** Amended contract field names (`objective`, `acceptance`, …). */
    fields: string[];
    /** Previous values of the amended fields; fields absent before are omitted. */
    previous: Record<string, unknown>;
}
/** Append-only observations; never replace the terminal verdict or unlock a gate. */
export interface TaskEvidence {
    at: number;
    by: string;
    attempt: number;
    attemptId?: string;
    note?: string;
    acceptanceResults?: AcceptanceResult[];
    commandsRun?: CommandResult[];
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
    at: number;
    /** Identity that performed the review (`adversarial`, `captain`, …). */
    by: string;
    /** Per-question verdicts; a bare boolean would be indistinguishable from one here. */
    checks: ReviewedCheck[];
}
/** 五问里的一问：它是哪一问、结论是什么、为什么。 */
export interface ReviewedCheck {
    /** Question id (`scope`, `prerequisite`, `move`, `acceptance`, `boundary`, …). */
    id: string;
    /**
     * ★★★ 三态，且**不许合并**（全库那条最贵的纪律）：
     *     `pass` / `fail` / `unmeasured`
     *   ⇒ 而 `unmeasured` **绝不并进 `pass`** —— "我没能审明白"与"审过了，没问题"不同形。
     */
    verdict: string;
    /** Why this verdict — the reading that produced it. */
    why?: string;
}
/** One task of a team's task list. */
export interface TeamTask {
    /** Stable task id from the profile template; absent for ad-hoc tasks. */
    profileSeedId?: string;
    /** Stable task id within the team (`t1`, `t2`, …). */
    id: string;
    /** Brief title for the task. */
    subject: string;
    /** What needs to be done. */
    description?: string;
    status: TaskStatus;
    /** Member name (or `captain`) the task is assigned to; unassigned tasks await a claim. */
    assignee?: string;
    /**
     * ── ★★ 它为什么停在终态（t55）────────────────────────────────────────────────
     *
     * 与 `status` **平级、不同轴**：`status` 说"停在哪一点"，本格说"为什么停在那里"。
     * ★ 缺席是**正常**的（多数任务不需要）：一个自己走到 `completed` 的任务
     *   没有任何"为什么停下"要交代 —— 它的 status 已经把话说完了。
     * ⇒ "缺席"与"记了 `not_delivered`"必须不同形（前者是"无需解释"，
     *   后者是"解释是：东西坏了"）。
     */
    delivery?: DeliveryRecord;
    /** Task ids that must reach `completed` before this task can be claimed. */
    dependencies: string[];
    /** The worker's written result, set when the task completes or fails. */
    output?: string;
    /** Monotonic execution generation. Reassignment/retry invalidates every older attempt. */
    attempt?: number;
    /** Capability for the current claimed/in-progress attempt. Members must present it when updating. */
    attemptId?: string;
    /** Opaque generation for a revocation/handoff that has not started its next attempt yet. */
    handoffId?: string;
    /** Previous activation retained until a handoff drain succeeds (retryable). */
    handoffFromMemberId?: string;
    /** A handoff is quiescing the old owner; the scheduler must not dispatch it yet. */
    reassigning?: boolean;
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
        at: number;
        /** 当时那一代的 attempt 序号 —— ★ 缺了它，旧失败与本次失败同形。 */
        attempt: number;
        /** 投递是怎么失败的（底层错误原文）。 */
        reason: string;
    };
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
    deliverableCommit?: string;
    /** Quality-gate kind. Missing values are treated as `work`. */
    kind?: TaskKind;
    /** Review / requirements / repair loop index, 1-based when present. */
    round?: number;
    verdict?: ReviewVerdict;
    findings?: ReviewFinding[];
    objective?: string;
    inScope?: string[];
    outOfScope?: string[];
    acceptance?: string[];
    verify?: string[];
    deliverables?: string[];
    nonGoals?: string[];
    changedPaths?: string[];
    acceptanceResults?: AcceptanceResult[];
    commandsRun?: CommandResult[];
    /** Supplemental observations, attributed to their original execution generation. */
    supplementalEvidence?: TaskEvidence[];
    reviewedTaskId?: string;
    reviewedAttempt?: number;
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
    reviewed?: ReviewedStamp;
    /** Repair source: the implementation / previous successful artifact. */
    sourceTaskId?: string;
    sourceFindingIds?: string[];
    /** User-constraint / goal items this task claims to cover. */
    coverageOf?: string[];
    /** Captain-only contract amendments, oldest first (see amendTaskContract). */
    revisions?: TaskRevision[];
    createdAt: number;
    updatedAt: number;
}
/** Member lifecycle status. */
export type MemberStatus = 'idle' | 'working' | 'removed';
/** One team member: a continuable subagent plus its team-side record. */
export interface TeamMember {
    /** Durable continuable subagent session id (empty until spawned). */
    id: string;
    /** Unique display name inside the team. */
    name: string;
    /** Role description, e.g. `researcher`, `engineer`, `reviewer`. */
    role?: string;
    /** Resolved LLM provider route captured when this member was created. */
    provider?: string;
    /** Resolved model captured when this member was created. */
    model?: string;
    /** Resolved reasoning effort captured from the captain or target model default. */
    reasoningEffort?: string;
    /** Prompt specific to this member's execution turns. */
    executionPrompt?: string;
    /** Configured second-choice route. */
    fallback?: TeamModelFallback;
    /** Active route after fallback, without changing the primary descriptor route. */
    activeProvider?: string;
    activeModel?: string;
    /** Whether the fallback route is currently active. */
    fallbackActive?: boolean;
    joinedAt: number;
    status: MemberStatus;
    /** Execution admission is closed while a failed/pending handoff is drained. */
    stopping?: boolean;
    /**
     * Last member-start failure, recorded so the captain can see why a member
     * never acquired a session instead of observing an unexplained `unspawned`
     * member. Cleared by the next successful start.
     */
    spawnError?: string;
}
/** One mailbox message. */
export interface TeamMessage {
    id: string;
    /** `captain` or a member name. */
    from: string;
    /** `captain` or a member name. */
    to: string;
    content: string;
    ts: number;
    /** Process-local delivery lease; prevents fallback and direct delivery racing. */
    deliveryClaimedAt?: number;
    /** Set after the durable message was accepted by the recipient's live Harness inbox. */
    deliveredAt?: number;
    /** Set once the recipient has consumed or been shown the durable fallback. */
    readAt?: number;
    /** Guidance is scoped to the recipient's execution generation, when present. */
    taskId?: string;
    attemptId?: string;
    /** Source execution generation, independent of the recipient guidance generation. */
    sourceTaskId?: string;
    sourceAttemptId?: string;
    sourceTaskStatus?: TaskStatus;
    /** Cancelled delivery is retained for audit but must not wake the recipient. */
    discardedAt?: number;
}
/** Snapshot of the named profile used to seed a team. */
export interface TeamModelFallback {
    provider: string;
    model: string;
}
export interface TeamProfileSnapshot {
    name: string;
    description?: string;
    protocol?: string;
    executionPrompt?: string;
    fallback?: TeamModelFallback;
    /** Frozen planning mode: captain plans the graph; seed keeps template tasks. */
    taskPlanning?: 'captain' | 'seed';
    /** Frozen review-loop policy from the creating profile. */
    reviewPolicy?: ReviewPolicy;
}
/** The full durable team record. */
export interface TeamState {
    /** Original team name. */
    name: string;
    /** Sanitized directory id; the team's stable identity. */
    id: string;
    /** Team purpose/goal. */
    description?: string;
    /** Immutable named profile snapshot, when created from a profile. */
    profile?: TeamProfileSnapshot;
    /** Session id of the captain agent that owns this team. */
    captainSessionId: string;
    createdAt: number;
    /** Teammates only; the captain is implicit (the owning session). */
    members: TeamMember[];
    tasks: TeamTask[];
    /** Monotonic task id counter. */
    taskSeq: number;
    /**
     * Two-phase execution lifecycle. Missing means `running` for durable
     * compatibility with teams created before staging existed.
     */
    phase?: 'staged' | 'running';
    /**
     * Human-facing review sub-state while `phase` is `staged`. Missing staged
     * records are treated as `awaiting_review` for backward compatibility.
     * `awaiting_feedback` means the user returned to chat and the Captain must
     * ask what should change before editing this same draft.
     */
    planReviewState?: 'awaiting_review' | 'awaiting_feedback';
    /** Timestamp written only after a staged plan is explicitly approved. */
    approvedAt?: number;
    /**
     * Human halt from the captain chat. The team remains on disk, members stay
     * available, and unfinished work is cancelled until the captain resumes.
     */
    halted?: boolean;
    /** Timestamp of the latest human halt, when present. */
    haltedAt?: number;
    /** Review-loop policy snapshot copied from the creating profile, when present. */
    reviewPolicy?: ReviewPolicy;
    /** Set when an automatic review/repair loop hits its configured ceiling. */
    escalated?: boolean;
}
