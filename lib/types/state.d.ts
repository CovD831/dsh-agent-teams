/**
 * Team state persistence and pure team-logic rules.
 *
 * State lives on disk under `<workspace>/<stateDir>/<teamId>/`:
 * - `team.json` — the durable {@link TeamState} record
 * - `inbox/<agentKey>.jsonl` — one JSONL mailbox per agent (`captain` or a
 *   member name), mirroring the Claude Code AgentTeams mailbox layout
 *
 * All mutations run through an in-process per-team queue so read-modify-write
 * stays serial; `fs/promises` is used directly because the plugin owns this
 * bookkeeping (host-plane state, like session persistence) and the abstract
 * `fs` service offers no directory deletion.
 * @module dsh-agent-teams/state
 */
import { type DeliveryOutcome, type DeliveryRecord, type TaskStatus, type TeamMessage, type TeamState, type TeamTask } from './types.ts';
export { amendTaskContract, buildCoverageMatrix, canDeclareDelivery, classifyChangedPath, collectChangedPaths, defaultQualityDeliveryGraph, describeQualityLoop, evaluateQualityCompletion, hasValidQualityTaskFields, isQualityKind, isTaskRevision, normalizeBlankOptionalTaskFields, pathMatchesScope, planQualityFollowUp, qualityPlanningPrompt, resumeTeamState, sanitizeReviewAcceptance, sanitizeReviewObjective, taskKindOf, validateCreateTask, } from './quality-gates.ts';
export type { ContractAmendmentInput } from './quality-gates.ts';
/** Mailbox key of the captain. */
export declare const CAPTAIN_KEY = "captain";
/**
 * Serialize mutations of one team across the whole process.
 * @param key - the team id (or any mutation scope).
 * @param fn - the mutation to run exclusively.
 * @returns the mutation's result.
 */
export declare function withTeamLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
/**
 * Keys with an in-process lock queue (held or waiting), snapshot for
 * diagnostics and leak checks. The queue promises themselves stay private.
 */
export declare function teamLockQueueKeys(): readonly string[];
/**
 * Fold a free-form name into a safe path/key segment.
 *
 * Unicode letters and digits survive, so CJK/Cyrillic/Greek names stay
 * distinct and readable; everything else — spaces, punctuation, path
 * separators, control characters — folds to `-`. An ASCII-only whitelist
 * mapped *every* non-Latin name onto one shared fallback, which silently
 * merged their mailboxes and rejected the second such member as a duplicate.
 *
 * A name with no letters or digits at all (pure emoji or punctuation) cannot
 * yield a readable key, so it gets a digest rather than a shared constant.
 * Over-long names are truncated with a digest appended, so names sharing a
 * long prefix stay distinct and the result stays within filesystem limits
 * (CJK costs 3 bytes per character in UTF-8).
 *
 * @param name - any user-supplied name.
 * @returns a non-empty key safe as a single path segment.
 */
export declare function sanitizeKey(name: string): string;
/**
 * ── ★★ 依赖是否满足：判「终态」，不是判「completed」──────────────────────────────
 *
 * MEASURED（2026-10-07，本机复现）：这一行此前是
 *
 *     return dependencies.filter((id) => byId.get(id)?.status !== 'completed')
 *
 * 它把「还没做完」与「做完了、结果是坏的」读成同一件事。而 failed / cancelled
 * **也是终态**（`TASK_TRANSITIONS` 里两者都没有出边）⇒ 一条 failed 的上游会把
 * 整条下游【永久】锁死：
 *
 *     t18 ← t17(failed)   ⇒ t18 永远不 ready，永远不会被派发
 *     t21 ← t20(failed)   ⇒ 同上
 *
 * 而本轮的 t17 / t20 恰恰是**如实报告**：t17 的交付物已经并入、t20 的普查
 * 正是它该红的那一份。机制把「诚实地说这份工作有问题」判成了「这份工作不存在」，
 * 于是【如实报告会受到惩罚】—— 那会把成员推向"为了让下游能开工而谎报 completed"，
 * 而那条路正是整个判据层存在的理由（不采信自述）。
 *
 * ── ★ 「终态即满足」不是放宽，是换一个更准的问题 ────────────────────────────────
 *
 *     「上游做完了吗」        —— 旧口径读不出来（failed 与 pending 同形）
 *     「上游还欠不欠工作」    —— 新口径：终态 = 不再欠工作 = 依赖这件事已经了结
 *
 * 依赖要的是**因果上的了结**，不是**结果上的赞许**。上游失败了，下游要做的
 * 不是"等一个永远不会到来的 completed"，而是"带着这个事实往下走"。
 *
 * ── ★★ 但"能开工"不等于"下游不知道发生了什么" ──────────────────────────────────
 *
 * 全都放行会带来一个新风险：**下游看不见上游是哪种终态**。用户裁定的是乙：
 * 不替下游做决定，而是把状态交出去 —— 也就是**在这里只回答"欠不欠工作"**，
 * 把"上游最后落在哪"交给 {@link dependencyOutcomes}（同一个文件、同一条口径）。
 *
 * ★ 两条出口必须分开读，不许合成一个布尔：合成之后"上游全做完了"与
 * "上游全失败了但都了结了"在调用方眼里同形，而它们的补救动作完全不同
 * （继续往下 vs 先看那份失败报告）。
 *
 * @param tasks - the team's tasks.
 * @param dependencies - task ids the candidate depends on.
 * @returns the ids that are still unsatisfied, empty when claimable.
 */
export declare function unsatisfiedDependencies(tasks: TeamTask[], dependencies: string[]): string[];
/**
 * ── ★★ 一个依赖【最后落在哪】—— 把上游的终态原样交给下游 ─────────────────────────
 *
 * 用户裁定的口径（乙）：**全都终态即满足，但下游能读到上游是哪种终态。**
 * 判据层不替下游决定"这份失败要不要紧"，它只负责**不把那个事实藏起来**。
 *
 * ── 为什么失败要细分（用户裁定）────────────────────────────────────────────────
 *
 * 一个裸 `failed` 把三件不同的事压成一件，而它们的补救动作完全不同：
 *
 *     failed_delivery —— 交付物【真的有问题】（判据抓到了伪造 / 测试没红 / 工作没到）
 *     failed_context  —— 环境或口径使它无法以 completed 收口（缺依赖、非 git、
 *                        契约本身自相矛盾）—— ★ 交付物不一定有问题
 *     inconclusive    —— 任务的性质就是"找问题"，而它【找到了】
 *                        （一次普查报出缺陷、一次审查给出 needs_revision）
 *                        —— ★ 这正是 "failed" 这个词最不该覆盖的那一类
 *
 * ★ 本轮的 t17 / t20 都落第三类：它们的"失败"就是它们的交付。
 *   不细分，下游（和读日志的人）只能看到一个 failed，于是【如实报告】
 *   与【真的做砸了】永远同形 —— 而那是本队记账最久的那个形态。
 *
 * ── 分类器刻意是「纯函数 + 只读已有的字段」────────────────────────────────────
 *
 * 它不改变任何任务的 status、不写任何东西、不认识工具层。它只是把一条已经
 * 发生的终态**读成一个可比较的值**，好让下游与报告都能问"这是哪一种"。
 * ★ 缺席（老记录、工作区里的历史任务）落 `failed_context` 而不是编一个
 *   `failed_delivery`：**读不到的成因不许推断成"交付物坏了"** ——
 *   那个方向会给一个没人检查过的任务扣上最重的帽子。
 */
/** 一条依赖最后落在哪。★ 三态 + 三种汇总，不是两个布尔。 */
export type DependencyOutcome = 'completed' | 'failed_delivery' | 'failed_context' | 'inconclusive' | 'cancelled'
/**
 * ── ★★ 交付合格、而门拦着（t55）──────────────────────────────────────────────
 *
 * 它**不是** `cancelled` 的一种：`cancelled` 说"被中止了"，而这一格说
 * "做完了、交付是好的，**只是记录不了**"。
 * ★ 下游据此可以**继续**（上游确实了结了），而它同时读得出"那一份是合格的"。
 *   把两者合成一个，会让"上面被中止了"与"上面做完了但没人验收"在下游眼里同形 ——
 *   而它们的补救动作不同（重排 vs 直接往下走）。
 */
 | 'delivered_blocked';
/**
 * 一次 failed 的细分。★ 取值与 `output` / `verdict` 上的既有事实**一一对应**，
 * 不引入新的写入口（本轮不改 `src/tools.ts`）。
 */
export declare const FAILURE_KINDS: readonly ["failed_delivery", "failed_context", "inconclusive"];
export type FailureKind = (typeof FAILURE_KINDS)[number];
/**
 * 把一条终态任务读成 {@link DependencyOutcome}。
 *
 * ★ 它只读**已经写在任务上**的事实（`status` / `verdict` / `acceptanceResults` /
 *   `commandsRun`），不读时钟、不读盘、不调用任何判据 —— 所以它可以在任何
 *   消费者（调度器、报告、下游提示）里被同一个引用调用，而不会有两份真相。
 *
 * @param task - the dependency task. `undefined` ⇒ 未知 id，如实报 `'failed_context'`
 *   （"这条依赖我读不到"不是"它做完了"）。
 */
export declare function dependencyOutcomeOf(task: TeamTask | undefined): DependencyOutcome;
/**
 * 细分一次 `failed`。**顺序即优先级**（下面三条各自排除前面那些）。
 *
 * ★ 判据的顺序是从"最确定"到"最保守"：
 *
 *   ① `inconclusive` —— 有 `verdict` 的失败，是 review/requirements 类的**结论型**任务，
 *      它的失败**就是**它查出了问题（`needs_revision` / `reject`）。这一类任务的性质
 *      是"找问题"，找到即交付 ⇒ 这不是"做砸了"。
 *   ② `failed_delivery` —— 有**实测证据**说交付物本身是坏的：验收项里有 failed，
 *      或 verify 命令里有非 0 退出。这是可指名的、可复核的"东西不对"。
 *   ③ `failed_context` —— 上面两条都不成立：没有结论、没有一条实测说交付物坏了。
 *      ⇒ 最保守的读法，也是**缺省**（见下面那段实测记录）。
 *
 * ★★ 为什么 `failed_context` 是缺省而不是 `failed_delivery`（这条是刻意的）：
 *   「没有证据说它坏了」与「有证据说它好了」是两件事。缺省成 failed_delivery
 *   会让每一个**没人检查过**的失败都被扣上"交付物有问题"，而下游据此可能
 *   直接放弃 —— 那是把"没测到"并进"测出来是坏的"，与并进"通过"同源。
 */
export declare function failureKindOf(task: TeamTask): FailureKind;
/**
 * ── ★★ 依赖的全貌：每一条依赖的 id + 终态 + 是否已经了结 ─────────────────────────
 *
 * 这是 {@link unsatisfiedDependencies} 的**信息面**版本，两个问题一起回答：
 *
 *     「下游能不能开工」        —— `satisfied`
 *     「上游最后落在哪」        —— `outcome`
 *
 * ★ 它**不**取代 `unsatisfiedDependencies`，两者必须都能被读到：
 *   前者是闸门（调度器用它决定派不派），后者是证据（下游与报告用它决定
 *   "带着什么往下走"）。合成一个"能开工 + 一个布尔"会让第二件事消失。
 *
 * ★ 顺序与 `dependencies` 一致（不是重排、不是去重）：调用方交进来的顺序
 *   就是它读得出的顺序，一个"顺手按 id 排序"的实现会让两份读数对不上。
 */
export interface DependencyStatus {
    /** 依赖的任务 id，原样交回。 */
    id: string;
    /** 这条依赖最后落在哪。★ 未知 id / 非终态都落 `failed_context`（见上）。 */
    outcome: DependencyOutcome;
    /** ★ 这条依赖**已经了结**吗 —— 与 `unsatisfiedDependencies` 判的是同一个问题。 */
    satisfied: boolean;
    /** 任务在盘上的状态；未知 id 缺席（不是编一个 `pending`）。 */
    status?: TaskStatus;
}
/**
 * 把一组依赖读成 {@link DependencyStatus} 的清单。
 *
 * @param tasks - the team's tasks.
 * @param dependencies - task ids the candidate depends on.
 */
export declare function dependencyStatuses(tasks: readonly TeamTask[], dependencies: readonly string[]): DependencyStatus[];
/**
 * 下游一句话能读到的"上游怎么了"。
 *
 * ★ 只在**有值得说的事**时产出内容：全 completed 时返回空串。
 *   一个把"上游全都好好地做完了"也渲染成一行的实现，会让真正需要看的那一行
 *   （上游失败了、而它是哪一种）淹没在每次派发都出现的噪音里 ——
 *   而噪音会教人忽略告警（requires.ts 那一条的同源）。
 *
 * ★ 它**不**决定下游该怎么做（不写"请先修复"、"请不要继续"）。用户裁定的口径是
 *   "把状态交出去"：这句话是**读数**，不是指示。加一句祈使句就等于替下游做了决定，
 *   而下游知道的东西比这里多（它知道自己的 objective）。
 */
export declare function describeDependencyOutcomes(statuses: readonly DependencyStatus[]): string;
/**
 * ── ★★ 把一次收口记下来：**为什么**这个任务停在终态（t55）────────────────────────
 *
 * ── 它补的是什么（MEASURED，2026-10-07）──────────────────────────────────────
 *
 * 今天 16 个任务全部由 captain 代落终态，**多数交付物合格**（25/25 夹具、
 * `pnpm verify exit=0`），而它们被记成 `cancelled`。⇒ 台账读不出「哪些真做完了」。
 *
 * 本函数是那个"读得出"的落点：**落终态的同时，把成因与门的原话一起记下来**。
 *
 * ── ★★ 它【不】改 `status`，也不替调用方挑 status（刻意的分工）──────────────────
 *
 * 调用方仍然自己决定落 `cancelled` / `failed` / `completed`（那是它的裁决，
 * 本文件不做编排）。本函数只回答**另一个问题**：「这一次为什么是这样」。
 *
 * ⇒ 两个轴各归各的：`status` 说"停在哪一点"，`delivery.outcome` 说"为什么停在那里"。
 *   ★ 这也是为什么本函数**不校验** status 与 outcome 的搭配：
 *     一个 `cancelled` + `delivered_blocked` 是**完全正常**的组合
 *     （"我中止了它，因为门拦着而交付是好的"），而那正是今天的真实形态。
 *
 * ── ★ 校验的是**证据的完整性**，不是"这个组合对不对"
 *
 *   `delivered_blocked` / `gate_fault` ⇒ **必须**带 `gateRefusals`（门的拒绝原文）
 *   `not_delivered`                    ⇒ **必须**带 `reason`（哪一点坏了）
 *
 * ★ 为什么这两条是硬要求：**少了它们，三种收口在读的人眼里同形** ——
 *   而"同形"正是本任务要消灭的东西。一个只有 `outcome` 一个词的记录，
 *   与没有记录相比只多了一个标签；而标签是会腐烂的（本项目的开场白）。
 *
 * @returns 记录本身，或一句说清缺什么的人话（**不是**抛错 ——
 *   调用方在"记不下来"与"记得不对"之间需要能分辨，见下面的返回值形状）。
 */
export declare function buildDeliveryRecord(input: {
    outcome?: unknown;
    gateRefusals?: unknown;
    reason?: unknown;
    by?: unknown;
    at?: unknown;
}): {
    ok: true;
    record: DeliveryRecord;
} | {
    ok: false;
    error: string;
};
/**
 * ── ★★ 「有多少任务卡在门上、各是哪个门」—— 台账的那一格读数（t55）──────────────
 *
 * 用户原话（痛点）：**「什么时候触发也是凭我的个人经验」**。
 * 同一件事在收口这一侧的形状是：**"无人值守还差什么"只能靠人手工数卡点**。
 * ⇒ 本函数把那个手工动作变成一次可复现的读数。
 *
 * ── 它回答什么，以及**不**回答什么 ────────────────────────────────────────────
 *
 *   回答：`status` 的分布 × `delivery.outcome` 的分布 × **每一道门各拦了几次**
 *   不回答：哪一份交付物"更好"（那要人看内容，本函数只受理已记录的事实）
 *
 * ── ★ 为什么按 `gateRefusals` 里的**判据 id** 分组，而不是按整句原文 ─────────────
 *
 * 判据的原文里带着**每次都不一样**的细节（路径、版本号、计数）——
 * 按整句分组会让每一个实例各自成一类，于是"哪一道门拦得最多"永远读不出来
 * （本队记账的「守卫检查了另一个同名的东西」在统计上的形态）。
 * ⇒ 从原文里**只取 `[judge.id]` 那一段**（判据自己写在开头的稳定标识）。
 *   ★ 取不到 id 的原文**单独归一类**（`unattributed`），不许静默丢掉 ——
 *     丢掉的正是"这条拒绝到底来自哪道门"这个问题的答案。
 */
export declare function summariseDeliveries(tasks: readonly TeamTask[]): {
    total: number;
    terminal: number;
    /** 已收口、但**没有**记录成因的终态任务数（★ 读数里的缺口本身也要看得见）。 */
    unrecorded: number;
    byOutcome: Record<DeliveryOutcome, number>;
    /** 门 id → 它拦了几次。★ 取不到 id 的落在 `unattributed`。 */
    byGate: Record<string, number>;
};
/**
 * 把 {@link summariseDeliveries} 的读数渲染成人话（给报告/状态读）。
 *
 * ★ 只在**有值得说的事**时产出内容（全 `completed` 时返回空串）——
 *   一个每次状态读取都渲染一行的实现，会让真正要看的那一行淹没在噪音里。
 * ★ 而且它**如实报缺口**（`unrecorded`）：一个"看起来完整"的台账比一个
 *   承认自己有洞的台账更危险。
 */
export declare function describeDeliveries(summary: ReturnType<typeof summariseDeliveries>): string;
/**
 * The allowed task status transitions, keyed by current status.
 * Terminal statuses have no outgoing transitions.
 */
export declare const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>>;
/**
 * Validate one task status transition.
 * @param current - the task's current status.
 * @param next - the requested status.
 * @returns the transition error, or undefined when allowed.
 */
export declare function transitionError(current: TaskStatus, next: TaskStatus): string | undefined;
/** Activate the task's current generation for one owner and return its capability id. */
export declare function activateTaskAttempt(task: TeamTask, assignee: string): string;
/** Start a fresh task generation for one owner. */
export declare function beginTaskAttempt(task: TeamTask, assignee: string): string;
/**
 * Revoke the current worker immediately. Clearing its capability makes old
 * updates stale; a separate handoff generation serializes async quiescence.
 */
/** Cancel one unfinished task without returning it to the ready pool. */
export declare function cancelUnfinishedTask(task: TeamTask, output?: string): void;
export declare function invalidateTaskAttempt(task: TeamTask, nextAssignee?: string, reassigning?: boolean): void;
/**
 * Create the team directory structure and the initial team record.
 * @param stateRoot - resolved absolute state root directory.
 * @param state - the initial team record.
 */
export declare function createTeamDir(stateRoot: string, state: TeamState): Promise<void>;
/**
 * Read one team record; `undefined` when absent.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team's sanitized id.
 */
export declare function readTeam(stateRoot: string, teamId: string): Promise<TeamState | undefined>;
/**
 * Synchronously read one team record while a continuable child is being
 * composed. Harness requires child setup contributions to be synchronous;
 * this narrow boundary lets a cold-resumed member restore its durable model
 * selection before its first request can be published.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team's sanitized id.
 * @returns the team record, or `undefined` when absent.
 */
export declare function readTeamSync(stateRoot: string, teamId: string): TeamState | undefined;
/**
 * Persist one team record (inside the caller's lock).
 * @param stateRoot - resolved absolute state root directory.
 * @param state - the record to persist.
 */
export declare function writeTeam(stateRoot: string, state: TeamState): Promise<void>;
/** Synchronous role hydration before the host's first prompt assembly. */
export declare function readRetiredMemberIdsSync(stateRoot: string): Set<string>;
export declare function readRetiredMemberIds(stateRoot: string): Promise<Set<string>>;
/** Atomically add session ids to the durable retired-member deny-list. */
export declare function recordRetiredMemberIds(stateRoot: string, memberIds: readonly string[]): Promise<void>;
/**
 * Find the team owned by one captain session (at most one per captain).
 * @param stateRoot - resolved absolute state root directory.
 * @param captainSessionId - the owning session id.
 * @returns the team record, or undefined when the captain leads no team.
 */
export declare function findTeamByCaptain(stateRoot: string, captainSessionId: string): Promise<TeamState | undefined>;
/**
 * Find the team in which one session is an active participant.
 * Captains match `captainSessionId`; members match their durable child session
 * id. Removed members no longer have access to team-scoped tools.
 * @param stateRoot - resolved absolute state root directory.
 * @param agentSessionId - calling captain/member session id.
 * @returns the team record, or undefined when the caller belongs to no team.
 */
export declare function findTeamByParticipant(stateRoot: string, agentSessionId: string): Promise<TeamState | undefined>;
/** Build a fresh message record. */
export declare function createMessage(from: string, to: string, content: string): TeamMessage;
/**
 * Append one message to an agent's mailbox (JSONL).
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 * @param agentKey - `captain` or a member name.
 * @param message - the message to append.
 */
export declare function appendMailbox(stateRoot: string, teamId: string, agentKey: string, message: TeamMessage): Promise<void>;
/**
 * Read one agent's whole mailbox, oldest first.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 * @param agentKey - `captain` or a member name.
 * @param onMalformedLine - optional diagnostic hook; malformed records are
 * skipped so one manually damaged line cannot make the whole team unreadable.
 * @returns the messages, empty when the mailbox does not exist yet.
 */
export declare function readMailbox(stateRoot: string, teamId: string, agentKey: string, onMalformedLine?: (lineNumber: number, error: unknown) => void): Promise<TeamMessage[]>;
/** Read only messages that have not been acknowledged by their recipient. */
export declare function readUnreadMailbox(stateRoot: string, teamId: string, agentKey: string, onMalformedLine?: (lineNumber: number, error: unknown) => void): Promise<TeamMessage[]>;
/** Pending delivery is distinct from delivered-but-not-yet-read input. */
export declare function readPendingMailbox(stateRoot: string, teamId: string, agentKey: string): Promise<TeamMessage[]>;
/** Lease selected fallback messages to one delivery path. */
export declare function claimMailboxDelivery(stateRoot: string, teamId: string, agentKey: string, messageIds: readonly string[]): Promise<void>;
/** Release a failed delivery lease so the scheduler can retry it later. */
export declare function releaseMailboxDelivery(stateRoot: string, teamId: string, agentKey: string, messageIds: readonly string[]): Promise<void>;
/**
 * Mark selected durable mailbox records delivered/read while preserving
 * malformed lines for diagnostics. Callers serialize this with the team lock.
 */
export declare function acknowledgeMailbox(stateRoot: string, teamId: string, agentKey: string, messageIds: readonly string[]): Promise<void>;
/** Acceptance by Harness is not evidence that a model step consumed input. */
export declare function markMailboxDelivered(stateRoot: string, teamId: string, agentKey: string, ids: readonly string[]): Promise<void>;
export declare function discardMailboxMessages(stateRoot: string, teamId: string, agentKey: string, ids: readonly string[]): Promise<void>;
/** Filesystem primitives used by {@link replaceFileAtomicOrDirect}; injectable for tests. */
export interface AtomicReplacePrimitives {
    rename: (from: string, to: string) => Promise<void>;
    writeFile: (file: string, content: string) => Promise<void>;
    remove: (file: string) => Promise<void>;
}
/** Tuning knobs for {@link replaceFileAtomicOrDirect} (defaults match production). */
export interface AtomicReplaceOptions {
    /** Rename attempts before the direct-write fallback (default 3). */
    retries?: number;
    /** Delay between rename attempts in ms (default 50). */
    retryDelayMs?: number;
}
/**
 * Replace `file` with `content`, preferring an atomic same-directory rename of
 * an already-written temp file.
 *
 * On Windows, `rename(tmp, file)` over an existing target throws EPERM while
 * any other process keeps the target open without FILE_SHARE_DELETE (editors,
 * indexers, antivirus scans, preview panes). By that point the payload has
 * already been fully written to the temp file, so a direct overwrite of the
 * target is a content-equivalent degraded path: retry the rename a few times
 * (transient locks clear quickly), then write the target in place. Every path
 * removes the temp file; when both the atomic rename and the direct write
 * fail, the combined error surfaces as an {@link AggregateError}.
 *
 * @returns nothing once the file has been replaced by one of the two paths.
 */
export declare function replaceFileAtomicOrDirect(temporary: string, file: string, content: string, primitives: AtomicReplacePrimitives, options?: AtomicReplaceOptions): Promise<void>;
export declare function isTeamTask(value: unknown): value is TeamTask;
/**
 * Remove a team's whole directory (members should be interrupted first).
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export declare function removeTeamDir(stateRoot: string, teamId: string): Promise<void>;
/**
 * Archive a team instead of deleting it: the whole directory (team.json with
 * tasks and dependency graph, plus the mailboxes) moves under
 * `<stateRoot>/archive/<teamId>/` so later sessions can review how tasks were
 * planned and rebuild dependency relationships. The archive directory has no
 * team.json of its own, so the live activity scan skips it naturally.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export declare function archiveTeamDir(stateRoot: string, teamId: string): Promise<void>;
/**
 * Read one archived team (already moved under `archive/`), or undefined when
 * it was never archived.
 * @param stateRoot - resolved absolute state root directory.
 * @param teamId - the team id.
 */
export declare function readArchivedTeam(stateRoot: string, teamId: string): Promise<TeamState | undefined>;
/**
 * List every archived team id under the state root.
 * @param stateRoot - resolved absolute state root directory.
 * @returns the archived team ids, empty when the archive does not exist.
 */
export declare function listArchivedTeamIds(stateRoot: string): Promise<string[]>;
/** Visual task state for the activity panel. */
export type VisualTaskState = 'blocked' | 'open' | 'running' | 'completed' | 'failed' | 'cancelled';
/**
 * The visual state of one task: `running` while in_progress, `completed`
 * when done, `failed`/`cancelled` when terminal without success, `blocked`
 * while any dependency is unfinished, else `open`.
 */
export declare function taskVisualState(status: string, dependencies: readonly string[], tasks: readonly TeamTask[]): VisualTaskState;
/**
 * Longest dependency path depth per task id (each depth = one lane column).
 */
export declare function taskDepthsById(tasks: readonly TeamTask[]): Map<string, number>;
