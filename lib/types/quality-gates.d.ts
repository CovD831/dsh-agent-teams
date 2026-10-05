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
export declare function collectChangedPaths(gitStatusText: string): string[];
export declare function inScopeOverlap(left: readonly string[] | undefined, right: readonly string[] | undefined): string[];
export declare function validateCreateTask(team: TeamState, input: CreateTaskInput): ValidateCreateTaskResult;
/**
 * ── ★ 判据层自己执行 verify，不采信成员自报的 exitCode ────────────────────────────
 *
 * MEASURED（2026-10-05，gate-probe 探针，上游 v0.1.22）：一个成员【零真实工作】，
 * 提交两条 acceptanceResults 全 passed（evidence 里直接写 "FABRICATED"）+ 两条
 * commandsRun 全 passed（exitCode 填伪造的 0，命令根本没跑，产物文件不存在），
 * 任务被判 completed —— 与真实完成（t3 干净基线）在判据层【不可区分】。
 *
 * 根因：`evaluateQualityCompletion` 只比对【条数与 status】，而 status/exitCode
 * 都是【成员自报的】。这正是"把判据的输入交给被判的一方"。
 *
 * ⇒ 修复：判据层【自己重跑】verify 命令。执行器由调用方注入（保持本文件零 I/O
 * 的纯函数纪律——这是它架构里最好的部分，不该破坏）。执行器为 undefined 时
 * 退回当前行为（纯函数仍然可单测，旧测试全部不受影响）。
 */
/** 执行一条 verify 命令，返回真实退出码。由调用方注入；本文件不 import 任何 I/O。 */
export type VerifyCommandExecutor = (command: string) => Promise<number>;
export interface VerifyRerunResult {
    /** 每条 verify 命令的重跑结果，与 task.verify 顺序一致。 */
    reruns: readonly CommandResult[];
    /** 自报 passed 但重跑非零的命令（伪造的直接证据）。 */
    mismatches: readonly CommandResult[];
    /** 重跑发生时为 true；执行器缺席时为 false（此时结果为空数组）。 */
    executed: boolean;
}
/**
 * 重跑任务的全部 verify 命令并比对自报结果。
 * 纯数据变换：执行动作全部通过注入的 executor 发生。
 */
export declare function rerunVerifyCommands(task: TeamTask, update: QualityCompletionUpdate, executor: VerifyCommandExecutor | undefined): Promise<VerifyRerunResult>;
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
