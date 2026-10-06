/**
 * Pure quality-gate rules: contracts, path audit, completion, follow-up,
 * coverage, and resume. Tools and persistence call these; they do not I/O.
 * @module dsh-agent-teams/quality-gates
 */
import { type AcceptanceResult, type CommandResult, type FindingSeverity, type ReviewFinding, type ReviewPolicy, type ReviewVerdict, type TaskKind, type TaskEvidence, type TaskRevision, type TaskStatus, type TeamState, type TeamTask } from './types.ts';
declare const QUALITY_KINDS: readonly TaskKind[];
declare const WRITE_KINDS: readonly TaskKind[];
declare const DEFAULT_REVIEW_POLICY: Required<Pick<ReviewPolicy, 'requirementsMinRounds' | 'requirementsMaxRounds' | 'codeMaxRounds' | 'maxRepairAttempts'>>;
export type PathClassification = 'in_scope' | 'out_of_scope' | 'undeclared' | 'illegal';
export interface CreateTaskInput {
    subject: string;
    description?: string;
    dependencies?: string[];
    assignee?: string;
    kind?: TaskKind;
    round?: number;
    objective?: string;
    inScope?: string[];
    outOfScope?: string[];
    acceptance?: string[];
    verify?: string[];
    deliverables?: string[];
    nonGoals?: string[];
    reviewedTaskId?: string;
    sourceTaskId?: string;
    sourceFindingIds?: string[];
    coverageOf?: string[];
    resume?: boolean;
    resumeReason?: string;
}
export interface ValidateCreateTaskResult {
    ok: boolean;
    error?: string;
    kind?: TaskKind;
    task?: Partial<TeamTask>;
    team?: TeamState;
}
export interface QualityCompletionUpdate {
    status?: TaskStatus;
    output?: string;
    verdict?: ReviewVerdict;
    findings?: ReviewFinding[];
    changedPaths?: string[];
    acceptanceResults?: AcceptanceResult[];
    commandsRun?: CommandResult[];
}
export interface QualityCompletionResult {
    ok: boolean;
    error?: string;
    requiredStatus?: TaskStatus;
}
export interface PlannedFollowUpTask {
    id?: string;
    kind: TaskKind;
    subject?: string;
    assignee?: string;
    dependencies?: string[];
    round?: number;
    objective?: string;
    inScope?: string[];
    outOfScope?: string[];
    acceptance?: string[];
    verify?: string[];
    sourceTaskId?: string;
    sourceFindingIds?: string[];
    reviewedTaskId?: string;
}
export interface PlanQualityFollowUpResult {
    created: PlannedFollowUpTask[];
    tasks: PlannedFollowUpTask[];
    escalated?: boolean;
    status?: 'escalated';
}
export interface CoverageRow {
    goal_item: string;
    task_ids: string[];
    status: 'missing' | 'in_progress' | 'passed' | 'blocked';
    evidence?: string;
}
export interface DeliveryResult {
    ok: boolean;
    blockers: string[];
}
export interface ResumeTeamResult {
    ok?: boolean;
    status: 'resumed' | 'already_running' | 'rejected';
    team?: TeamState;
    error?: string;
}
export type QualityLoopState = 'running' | 'halted' | 'escalated' | 'deliverable' | 'blocked';
export interface QualityLoopSnapshot {
    state: QualityLoopState;
    halted: boolean;
    escalated: boolean;
    deliverable: boolean;
    summary: string;
}
export interface QualityGraphDraft {
    subject: string;
    kind: TaskKind;
    assignee?: string;
    dependencies: string[];
    objective: string;
    acceptance: string[];
    inScope?: string[];
    verify?: string[];
    coverageOf?: string[];
}
export declare const DEFAULT_REVIEW_ACCEPTANCE: readonly ["The latest implementation meets the user goal", "No unresolved blocker or high findings"];
export declare const DEFAULT_REVIEW_OBJECTIVE = "Review whether the latest implementation satisfies the user goal";
export declare function taskKindOf(task: Pick<TeamTask, 'kind'> | undefined): TaskKind;
export declare function isQualityKind(kind: TaskKind | undefined): boolean;
export declare function resolveReviewPolicy(policy: ReviewPolicy | undefined): Required<typeof DEFAULT_REVIEW_POLICY> & ReviewPolicy;
export declare function isReviewPolicy(value: unknown): value is ReviewPolicy;
/** Normalize a workspace-relative POSIX path. `undefined` means illegal. */
export declare function normalizeWorkspacePath(path: string): string | undefined;
export declare function pathMatchesScope(path: string, pattern: string): boolean;
export declare function classifyChangedPath(path: string, inScope?: readonly string[], outOfScope?: readonly string[]): PathClassification;
/**
 * ── ★★ f-0020：repair 的判别力证据，不是「本次新增的测试」───────────────────────
 *
 * ── 它修的是什么（MEASURED：本队 6 次同形终止，全部由 captain 代落终态）─────────
 *
 *     t13 / t16 / t19 / t25 / t26 cancelled · t27 failed
 *
 * 原因不是交付物有问题，而是三道完工门的**问句与 repair 的验收不是同一件事**：
 *
 *     r5 / mutation 度量：「为【新工作】写了新测试吗」   ← 输入面 = `newTestFiles`
 *     repair 的验收    ：「改了【既有】夹具后它仍能判别吗」← 净改动全在既有文件上
 *
 * ⇒ `newTestFiles` 对一份 repair 恒为 `[]`（它数的是"新增"，而 repair 一个都没新增），
 *   于是 r5 报 `unmeasured`（"none of the 0 reported file(s)…"）、mutation 拿不到
 *   杀手套件。判据**没有撒谎** —— 它诚实地说"我没能测量"。
 *   但一个恒常的 `unmeasured` 同样**交不出终态** ⇒ 无人值守退化成 captain 逐个手收。
 *
 * ── ★★ 这一格**只换了文件来源**，没有降低判别的强度 ─────────────────────────────
 *
 * 判据问的仍是同一个问题：「这条夹具**还能不能抓住缺陷**」。
 * 变的只是"拿哪些文件去问"：
 *
 *     旧：本次【新增】的测试文件        ⇒ 对 repair 是空集 ⇒ 恒 unmeasured
 *     新：本次【改动过的既有的】测试夹具 ⇒ repair 的真实证据 ⇒ 可测量
 *
 * ★ 而"装饰性测试"这一路**一步都没让**：一条恒绿的既有夹具同样过不了 r5
 *   （它在父版本上就绿 ⇒ `decorative test` 拒绝）。见夹具的臂 3（定向突变）。
 *   ⇒ 换句话说：**"是不是新文件"是无关的；"它还能不能判别"才是问题。**
 *     旧口径读的是前者，代价是把后者的答案一起丢掉了。
 *
 * ── 三态（与 `observedChangedPaths` / `gitChangedPaths` 逐条对齐）──────────────
 *
 *   观察面缺席（`undefined`）    ⇒ 本函数返回 `[]`，且调用方**必须**报 unmeasured
 *        —— "我没能观察" 与 "观察了、确实没有" 不同形（本队记账最久的那条界线）。
 *   观察到了、一条夹具都没改动  ⇒ `[]`，同样是 unmeasured（没有可测量的判别力）。
 *   观察到了、改了既有夹具      ⇒ 那些路径 —— r5 拿它们去跑红前绿后。
 *
 * ★ 为什么不做成"猜一个默认目录"：猜出来的路径会让运行器返回 `[]`，
 *   而空集会被读成"没有新测试要查" ⇒ **ok**。那是把"没测到"并进"通过"，
 *   正是 r5 的注释里已经点名过的那个坑（"用没有根据的默认值…⇒ ok"）。
 *
 * @param ctx - 一份完成更新的上下文（任务是 `repair` / `implementation`）。
 * @returns 应当被当作判别力证据去测量的测试夹具路径（workspace 相对，已去重排序）。
 */
export declare function repairEvidenceFiles(ctx: RepairCompletionContext | undefined): string[];
/**
 * ── ★★ repair 的完工裁决：把「判别力证据」与「测量」分开报 ──────────────────────
 *
 * 这一格**不自己跑测试**（本文件保持零 I/O 的纪律）—— 它只回答一个可以在数据上
 * 回答的问题：**这份 repair 有没有可测量的判别力证据**。
 *
 *   有 ⇒ `{ ok: true, evidence }`，调用方拿它去注入 r5/mutation
 *        （于是 r5 能跑红前绿后，装饰品照旧被拒）。
 *   没有 ⇒ `{ ok: false, unmeasured }`，且**必须**是 unmeasured 而不是 blocked：
 *        没有夹具不等于"夹具是装饰品"（那是关于工作的结论，需要真的测过才能说）。
 *        两者不同形 —— 把"我没能测量"说成"它有问题"，是反向的同一类错误。
 *
 * ★ 两句话必须不同形（本队记账）：
 *     (i)  没能观察文件改动        ⇒ "could not observe any file change"
 *     (ii) 观察到了、但没有既有夹具 ⇒ "the repair changed no test fixture"
 *   否则"我瞎了"与"我看清了、确实没有"在日志里同形。
 */
export declare function repairCompletionVerdict(ctx: RepairCompletionContext | undefined): RepairCompletionResult;
export interface RepairCompletionContext {
    task?: {
        id?: string;
        kind?: string;
        inScope?: string[];
        changedPaths?: string[];
    };
    update?: {
        changedPaths?: string[];
        newTestFiles?: string[];
    };
    [key: string]: unknown;
}
export type RepairCompletionResult = {
    ok: true;
    evidence: string[];
} | {
    ok: false;
    unmeasured: string;
};
export declare function collectChangedPaths(gitStatusText: string): string[];
export declare function inScopeOverlap(left: readonly string[] | undefined, right: readonly string[] | undefined): string[];
export declare function validateCreateTask(team: TeamState, input: CreateTaskInput): ValidateCreateTaskResult;
/**
 * ── ★ 这一条判据【已搬到注册表】────────────────────────────────────────────────
 *
 * 重跑 verify 的逻辑现在在 `src/gates/completion/verify-rerun.mjs`，由
 * `src/gates/index.mjs` 装配、`tools.ts` 通过
 * `registry.evaluate('completion', ...)` 调用。
 *
 * ★ 为什么搬走：留在这里会是**同一个规则的第二份实现**（§3.6）——
 *   两处都实现"重跑 verify"，改一处不改另一处时，其中一份变成死代码而没人知道。
 *   本文件（`quality-gates.ts`）保持【零 I/O 的纯规则】这一纪律，判据层在它外面。
 */
export declare function evaluateQualityCompletion(task: TeamTask, update: QualityCompletionUpdate): QualityCompletionResult;
/**
 * Derive the repair round's inScope from the findings that caused it.
 *
 * `finding.file` records where the problem was OBSERVED, but the fix often
 * targets a different file named in `requiredFix` (docs vs sample data,
 * config vs code). Deriving the scope from both keeps the auto-generated
 * repair contract satisfiable; deriving from `file` alone can produce a
 * contract where the acceptance ("edit README.md") names a path the scope
 * forbids, so no honest completion exists and the repair dead-locks.
 *
 * Absolute and otherwise illegal paths are dropped (they can never match
 * workspace-relative scope patterns anyway); when nothing legal remains,
 * the source task's own inScope is kept as the fallback. Over-inclusion is
 * accepted: inScope is an audit upper bound, and the requiredFix text still
 * tells the implementer what to touch.
 *
 * Keep all derived paths until the generator resolves inherited exclusions;
 * filtering first would silently discard a required fix target.
 */
export declare function repairScopeFromFindings(findings: readonly ReviewFinding[], fallback: string[] | undefined): string[] | undefined;
/** Captain-only amendment payload: replacement values for contract fields. */
export interface ContractAmendmentInput {
    objective?: string;
    acceptance?: string[];
    verify?: string[];
    inScope?: string[];
    outOfScope?: string[];
}
export interface AmendTaskContractResult {
    ok: boolean;
    error?: string;
    task?: TeamTask;
    revision?: TaskRevision;
}
/**
 * Controlled contract amendment (the pure rule; tooling keeps it
 * captain-only). When a quality contract is wrong — a verify command that
 * cannot pass, an inScope that forbids the file the objective names — the
 * worker has no honest completion and either dead-locks or games the gate.
 * Instead the captain may fix the contract mid-flight: every amendment is
 * recorded on the task as a {@link TaskRevision} (previous values + reason),
 * and once a review/requirements task has passed judgment on this task the
 * contract is frozen. Amendments replace whole fields (lists are full
 * replacements, not deltas); the implementer re-reads the amended contract
 * before its next quality gate. Completion gates need no special casing:
 * they read the task's current fields, so they naturally evaluate the
 * amended contract.
 */
export declare function amendTaskContract(team: TeamState, task: TeamTask, input: ContractAmendmentInput, by: string, reason: string): AmendTaskContractResult;
export declare function planQualityFollowUp(team: TeamState, closed: TeamTask): PlanQualityFollowUpResult;
export declare function buildCoverageMatrix(goalItems: readonly string[], tasks: readonly TeamTask[]): CoverageRow[];
export declare function canDeclareDelivery(team: TeamState): DeliveryResult;
export declare function resumeTeamState(team: TeamState, reason: string): ResumeTeamResult;
export declare function isReviewFinding(value: unknown): value is ReviewFinding;
export declare function isAcceptanceResult(value: unknown): value is AcceptanceResult;
export declare function isCommandResult(value: unknown): value is CommandResult;
export declare function isTaskRevision(value: unknown): value is TaskRevision;
/**
 * Normalize blank optional task fields to omitted ("blank means absent").
 * Blank string scalars are deleted; string lists have blank entries filtered
 * out, and a list that only contained blanks is omitted entirely. Non-blank
 * values and every other field are passed through untouched, so durable-state
 * validation stays strict.
 */
export declare function normalizeBlankOptionalTaskFields<T extends object>(task: T): T;
export declare function hasValidQualityTaskFields(value: Record<string, unknown>): boolean;
export declare function isTaskKind(value: unknown): value is TaskKind;
export declare function isReviewVerdict(value: unknown): value is ReviewVerdict;
export declare function isFindingSeverity(value: unknown): value is FindingSeverity;
export declare function looksLikeGateTestContract(value: string | undefined): boolean;
export declare function sanitizeReviewObjective(value: string | undefined, fallback?: string): string;
export declare function sanitizeReviewAcceptance(values: readonly string[] | undefined): string[];
export declare function defaultQualityDeliveryGraph(input: {
    goal: string;
    implementer?: string;
    reviewer?: string;
    analyst?: string;
    tester?: string;
    integrator?: string;
}): QualityGraphDraft[];
export declare function qualityPlanningPrompt(): string;
export declare function describeQualityLoop(team: TeamState): QualityLoopSnapshot;
export { QUALITY_KINDS, WRITE_KINDS };
/** Persisted evidence must remain loadable after process restart. */
export declare function isTaskEvidence(value: unknown): value is TaskEvidence;
/** Append observations without mutating the original result or its completion time. */
export declare function appendTaskEvidence(task: TeamTask, input: QualityCompletionUpdate & {
    evidence_note?: string;
}, by: string): boolean;
