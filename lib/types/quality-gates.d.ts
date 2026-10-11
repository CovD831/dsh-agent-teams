/**
 * Pure quality-gate rules: contracts, path audit, completion, follow-up,
 * coverage, and resume. Tools and persistence call these; they do not I/O.
 * @module dsh-agent-teams/quality-gates
 */
import { type AcceptanceResult, type CommandResult, type FindingSeverity, type ReviewFinding, type ReviewPolicy, type ReviewedStamp, type ReviewVerdict, type TaskKind, type TaskEvidence, type TaskRevision, type TaskStatus, type TeamState, type TeamTask } from './types.ts';
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
    /**
     * ── ★★★ t11：那一格「已审查」的盖章 —— 而它可选，**但一旦在场就要形状正确** ──────
     *
     * ★ 三态（而三者不同形 —— 契约点名的那一条）：
     *
     *     缺席            ⇒ ★ **通过**。它不是错误 —— 它是"这条路没走自动生成"
     *                        （问过用户、用户裁决过的）的正规形态。
     *     在场且形状正确   ⇒ 通过
     *     在场而形状坏     ⇒ ★ **拒绝**，而消息要**说清是"形状坏"**，
     *                        不是"缺了什么" —— 见 `validateCreateTask` 里那一格。
     *
     * ★ 而"区分缺失与类型错"是 §54 那条口径在**这一格**上的落点：
     *   一个说成 `reviewed is required` 的消息会把"在场而坏"读成"缺失"，
     *   而两者的**补救动作相反**（一个去补字段、一个去修那个字段的内容）。
     */
    reviewed?: ReviewedStamp;
    reviewedTaskId?: string;
    sourceTaskId?: string;
    sourceFindingIds?: string[];
    coverageOf?: string[];
    resume?: boolean;
    resumeReason?: string;
    /**
     * ── ★★ 这次校验里，`inScope` 是不是【真的被改的那个字段】（t40 修 f-0019 的第二半）──
     *
     * ── 它修的是什么 ────────────────────────────────────────────────────────────
     *
     * MEASURED（2026-10-07，captain 实测）：他在清空 `t18` 的 **dependencies**
     * （为一个合法依赖链重新接线），却被一条**关于 inScope 的**规则拦住 ——
     * 而他一个字节的 inScope 都没碰。
     *
     * 根因是触发点偏了：`updatePlanBatch` 对每个 `update_task` 变更**整任务重校验**，
     * 于是"改依赖/改描述"这类改动会连带把 inScope 的重叠检查再跑一遍。
     * ⇒ 一条规则在**它没被触碰**的时候开火，而它的错误信息还在谈论 inScope ——
     *   读的人会去翻 inScope，而问题根本不在那里。
     *
     * ── 三态：`undefined` 不是 `false`（这条与全库的纪律一致）────────────────────
     *
     *     `undefined` ⇒ 【没有声明】⇒ 保持**今天的行为**（照常检查）
     *     `false`     ⇒ 调用方明确说"这次改的不是 inScope" ⇒ 跳过重叠判定
     *     `true`      ⇒ 调用方明确说"inScope 在场且是被校验的字段" ⇒ 照常检查
     *
     * ★ 缺省方向是**照常检查**，不是跳过：`undefined` 落回今天的行为，
     *   所以一个还没接线的调用方不会**静默地**失去这条护栏。
     *   反过来（缺省跳过）会让"调用方忘了传"与"确实不该检查"同形 ——
     *   而那正是本库记账最久的形态。
     *
     * ★ 为什么这个判定必须在**判据侧**而不是调用方侧：
     *   调用方侧收口只挡住"那一次调用"，任何别的调用方仍会踩到同一个坑；
     *   而"这条规则在它没被触碰时不该开火"是**规则自己的性质**。
     */
    inScopeTouched?: boolean;
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
    /**
     * ── ★★★ 通过时也要说得出**凭什么**（t19 验收第 5 条）────────────────────────────
     *
     * 本字段是那条"允许 completed，因为失败都在基线里"留下的**读数**。
     * ★ 缺了它，「通过」与「没有遇到失败」在读的人眼里**同形** ——
     *   而"通过了，因为这几条都在 `<commit>` 的基线里"是**可核的**那一句。
     * ★ 而它**不是**一块放行牌：它只在 `ok === true` 且确有存量失败时出现，
     *   而"该不该放行"由上面的三态裁决决定，不由这里决定。
     */
    notes?: string[];
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
 *
 * ── ★★★ 而上面那个 `unmeasured` **还不够**：它是 f-0020 的另一半 ─────────────────
 *
 * MEASURED（2026-10-07，t44 复现；本队 t26/t28/t32/t40/t41 五次同形终止）：
 *
 *     「带 changedPaths ⇒ changedPaths 判据拒；不带 ⇒ completion 门拒」
 *
 * t41 修好了第一半（观察面从主树扩到「主树 ∪ 成员 worktree」）。而第二半仍在，
 * 且它的形状是**反直觉的**：
 *
 *     一份【确实把证据交齐了】的 repair，在真实路径上拿到的 `newTestFiles`
 *     是**空数组**（不是缺席）⇒ `r5.appliesTo` 为真（它只问 `Array.isArray`）
 *     ⇒ 进 `gate()` ③ 支 ⇒ 恒 `unmeasured` ⇒ **永远交不出终态**
 *
 * ★ 而**缺席**（`undefined`）反而**不会**被拒：`appliesTo` 为假 ⇒ 判据直接跳过。
 *   ⇒ **空数组比没有数组更坏** —— 它触发一次永远不可能通过的检查。
 *   这是本队记账的「触发点偏了」的第二次发作（第一次是 t40 的 inScope 覆盖检查）：
 *   一条规则在**它没有对象可判**的时候仍然开火，而它开火的产物是一个恒常的拒绝。
 *
 * ── 所以这一格要**多交一个事实**：这次到底有没有"可判的对象" ────────────────────
 *
 * 调用方需要区分三件事，而它们今天被压成了两件：
 *
 *     `evidence` 非空        ⇒ 去测量那些文件（正常路径）
 *     `evidence` 空 + 有观察 ⇒ ★【没有可判的对象】⇒ 调用方**必须不要**注入空数组，
 *                              否则就是上面那个恒常拒绝（f-0020 的第二半）
 *     `evidence` 空 + 无观察 ⇒ 没能观察（unmeasured，保留原样）
 *
 * ★ 这就是新增的 `discriminable` 那一格：`false` 时调用方**不注入** `newTestFiles`
 *   （让它缺席），于是 r5 正确地跳过 —— 与 `verify-rerun` 对空 `verify` 的处理
 *   逐字同形（`ctx.task.verify.length > 0` 才开火）。
 *   ⇒ **不是放宽**：没有任何证据被跳过，因为**本来就没有证据可跳**。
 *     而"有证据、但证据不判别"那一路**一步都没让** —— 见夹具的定向突变臂。
 *
 * ★ 为什么把这件事放在本文件而不是让调用方自己看 `evidence.length === 0`：
 *   调用方已经**写着**那个判断，而它写成 `repairEvidence.ok === false ? newTestFiles`
 *   —— 也就是回落到空数组。要点不是"再写一遍"，是**把口径放在产生它的地方**：
 *   "有没有可判的对象" 是这一格的知识，调用方不该重新推导一遍
 *   （两份推导会漂移，而漂移之后两者读起来都正常 —— 本队记账过）。
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
/**
 * ── ★★★ 「判别证据」这条供给链，喂给了哪一格，而那一格有没有人读（t67）──────────
 *
 * ── 它修的是什么（MEASURED，2026-10-07/08）────────────────────────────────────
 *
 * `discriminatingFiles → newTestFiles` 这条链的**唯一消费者是 r5**。
 * 而 kind 需求表说 **repair 不要求 r5** ⇒ 那条证据在 repair 上**没人读**，
 * 而它**仍然被生产出来**。
 *
 * ★ 而那正是本队反复记账的形态：
 *     **一个没有调用方的产出，与没有那个产出在观测上完全相同。**
 *
 * ── ★★ 为什么它必须【可读】，而不能停在"我们知道它没人读"──────────────────────
 *
 * 今天的它**是沉默的**：没有任何一行日志、任何一个返回值会告诉你
 * "这份证据生产出来了、而没人消费它"。⇒ 下一个会话只会看到
 * `repairEvidence.ok === true` 然后以为一切正常。
 *
 * ⇒ 所以本函数把那条链的**每一格**都变成可读的读数，而它有三态（★ 不同形）：
 *
 *     `consumed`    —— 有判据真的会读它（★ 由 kind 需求表回答，不是猜）
 *     `produced`    —— 生产出来了，而**没有**任何门会读（★ 沉默的那一格，现在可读）
 *     `unmeasured`  —— **无法判断**（需求表读不到 / 这个 kind 不在表里）
 *
 * ── ★ 为什么"有没有人读"要问【表】，而不是在这里写一张名单 ────────────────────
 *
 * 判据的 kind → 门 的映射**已经在 `kind-requirements.json` 里**（t54 建的）。
 * 在这里再写一张"谁读 newTestFiles"的名单，就是**两份真相** ——
 * 而它们会漂移，漂移之后两边读起来都正常。⇒ 问表。
 *
 * ★ 而"哪条判据读哪一格"这件事**仍然是本文件的知识**（`GATE_INPUT_FIELDS`）——
 *   它是"判据的输入面"这一事实，不是"某个 kind 要什么门"那个决定。
 *   两者不同轴：前者随判据实现变，后者随项目决定变。
 */
export declare const GATE_INPUT_FIELDS: Readonly<Record<string, readonly string[]>>;
/** 一条供给链的读数。★ 三态，且第二种**必须**可读（那正是本任务要修的）。 */
export interface EvidenceConsumerReading {
    /** 这份证据落在哪一格（`update.<field>`）。 */
    field: string;
    status: 'consumed' | 'produced' | 'unmeasured';
    /** 读它的门的 id（`consumed` 时非空）。 */
    consumers: string[];
    /** 人话一句。★ 三种状态的措辞**必须不同形**。 */
    detail: string;
}
/**
 * 判定"这份候选证据会被谁读"。
 *
 * @param field - 证据落在哪一格（例如 `newTestFiles` / `killerSuites`）。
 * @param requiredGateIds - 这个 kind 要求的门的 id（来自需求表）。
 *        ★ 传 `undefined` ⇒ **无法判断**（表读不到 / 这个 kind 不在表里）
 *          ⇒ `unmeasured`，**不是** `produced`。
 */
export declare function traceEvidenceConsumer(field: string, requiredGateIds: readonly string[] | undefined): EvidenceConsumerReading;
/**
 * ── ★★ `discriminable`：这次到底有没有【可判的对象】（t44 加）──────────────────
 *
 * 它**不是** `ok` 的重复，也不是"能不能判"的同义改写 —— 两者回答不同的问题：
 *
 *     `ok === true`      ⇒ 有证据，**去测量它们**（`evidence` 非空）
 *     `discriminable`    ⇒ 这一次**有没有东西可测**
 *
 * 三态读数（调用方必须分开处理，合成一个布尔就会回到 f-0020）：
 *
 *     `{ ok: true,  discriminable: true,  evidence: [...] }`  ⇒ 注入 evidence
 *     `{ ok: false, discriminable: false, unmeasured: '…' }`  ⇒ ★ **不要注入**
 *     `{ ok: false, discriminable: true,  unmeasured: '…' }`  ⇒ 理论支（今天不产出）
 *
 * ★ 为什么 `false` 时调用方要"不要注入"而不是"注入空数组"：
 *   注入 `[]` 会让 `r5.appliesTo` 为真（它只问 `Array.isArray`）⇒ 进 ③ 支
 *   ⇒ 恒 `unmeasured` ⇒ **永远交不出终态**。而**缺席**会让 `appliesTo` 为假
 *   ⇒ 判据正确跳过。⇒ 空数组比没有数组更坏，这是本格的**全部理由**。
 *
 * ★★ 边界（刻意的，且必须有臂钉住）：`discriminable: false` **不表示**"这份工作
 *   没问题"。它表示"这条判据没有对象可判，所以它不说话"。
 *   ⇒ 一个**改了测试夹具、而那个夹具不再能判别**的 repair **仍然** `discriminable: true`
 *     （它有对象），于是照常被 r5 按红前绿后拒绝。★ 见夹具的定向突变臂：
 *     把这一格改成恒 `false` ⇒ 那条"装饰品必须被拒"的臂必须红。
 *   ⇒ 换句话说：本格放宽的是「没有对象」，**不是**「对象不合格」。
 */
export type RepairCompletionResult = {
    ok: true;
    evidence: string[];
    discriminable: true;
} | {
    ok: false;
    unmeasured: string;
    discriminable: boolean;
};
export declare function collectChangedPaths(gitStatusText: string): string[];
export declare function inScopeOverlap(left: readonly string[] | undefined, right: readonly string[] | undefined): string[];
/**
 * ── ★★★ t23：契约的【文件级前提】在**建任务时**就核对，而不是让成员在派发中途发现 ──────
 *
 * ── 它修的是什么（MEASURED：同一个缺陷类吃过**五次**完整往返，四个成员独立撞到）──────
 *
 *   t1 契约**整份是空的**（objective / inScope / acceptance / verify 全缺席）
 *      ⇒ 成员分不出"这个任务不需要契约"与"契约在途中丢了"。
 *   t3 契约点名 `lib/types.d.ts` —— 而本仓的 build **永远产不出那个路径**
 *      （`declarationDir` 是 `lib/types`）。
 *   t6 的 objective 点名 `observeStall`，由它的依赖 t3 产出 —— 而 t3 的交付是
 *      **worktree 局部的提交**，不是基线的祖先（本仓按【落文件】合流）
 *      ⇒ 那个产物**在它跑的那棵树上根本不存在**。
 *   t8 ★ **最强的一例**：它【被强制的 verify 命令】本身在基线上就编不出来 ——
 *      `scripts/gate-friction-capture.test.mjs` 在那个修订上**一个 C1 臂都没有**
 *      ⇒ 于是它的验收第 2 条**是空的**（那条要 gate 的 escalate 池在基线上不存在）。
 *      照写一个臂**能变绿而什么都没证明** —— 而"读起来像被验证过"正是本队存在的理由。
 *
 * ── 为什么放在这里（验收第 2 条）────────────────────────────────────────────────
 *
 * `validateCreateTask` **已经**在校验 `inScope` / `verify` / `acceptance`
 * （见下面那几个 `nonemptyStringList` 分支）⇒ 在这里加一道**存在性断言**，
 * 成本是一次 `existsSync`，而不是一整次派发往返。
 *
 * ── 三条梯级（验收第 3 条），每条各自可读、各自指名（验收第 4 条）──────────────
 *
 *   (i)   objective 里**点名**的产物存在
 *   (ii)  inScope 里**每一个**文件存在
 *   (iii) 每一条 verify 命令的**目标文件存在**，且**含验收标准点名的臂**
 *
 * ── ★★ 而它**不许**用 git ancestry（验收第 5 条）────────────────────────────────
 *
 * 本仓**按落文件合流**：一个内容相同的落地提交**永远不是** worktree 提交的祖先
 * ⇒ 祖先检查会在**正确落地的活**上误报，而那是最坏的一种误报
 *   （它惩罚的正是这个仓库做对的那件事）。
 * ⇒ 所以这里**一律按内容**判：文件在不在、里面有没有那句话。
 */
/** 一条被核对的前提；读得出来才算数 ⇒ 每条都带**它是哪一条**与**实测到的什么**。 */
export interface PremiseFailure {
    /** 梯级：(i) 目标产物 / (ii) inScope 文件 / (iii) verify 目标与臂。 */
    readonly tier: 'i' | 'ii' | 'iii';
    /** 人话，指名**哪一条前提**失败（验收第 4 条）。 */
    readonly detail: string;
}
/**
 * 从一段自由文本（objective / acceptance）里取出**看起来像仓库路径**的 token。
 *
 * ★ 口径刻意**保守**：只认反引号里的那一类（本仓的契约几乎总是这样写路径），
 *   以及裸的 `dir/file.ext` 形态。
 * ★★ 而"取不到"⇒ 返回空数组（**不猜**）：一个靠猜的检查会在别的措辞上误报，
 *   而误报会教人忽略门禁 —— 与漏报同样有害。
 */
export declare function repoPathsNamedIn(text: string): string[];
/** 一条 verify 命令里"被跑的那个文件"（`node --test <path>` / `node <path>`）。 */
export declare function verifyTargetOf(command: string): string | undefined;
/**
 * 一条验收标准"点名的臂"—— 例如 `scripts/gate-friction-capture.test.mjs` 里的 `臂 4`。
 *
 * ★ 这是 (iii) 的**要害**：文件存在**不等于**它里面那条臂存在。
 *   t8 那一例正是如此：文件在（51755 字节），而 **C1 的臂一个都没有**。
 */
export declare function armsNamedIn(text: string): string[];
/**
 * ── ★★★ t8 那一例的最强读数：**臂名存在，而它承载的东西不存在**────────────────────
 *
 * MEASURED（本任务实测，`git show ba5b23a:scripts/gate-friction-capture.test.mjs`）：
 *
 *     `臂 4` 在那个修订上**存在**（2 处）—— 而它是一个**与 C1 无关的**老臂：
 *         「臂 4（★ 重放臂）：拿记录去重跑那条判据 —— 卡点必须**再发生一次**」
 *     而 C1 的词汇（`observeStall` / `recordClass` / `FrictionRecordClass`）**零出现**。
 *
 * ⇒ ★★ 于是"验收说臂 4 证明 escalate 池"在那棵树上**是空的**：
 *   臂名对得上，而**它证明的东西不存在**。
 *   ⇒ 一个只比臂名的检查**会放它过去** —— 而那正是本任务要消灭的形态本身：
 *     **一条读起来像被验证过的标准，其实没有主语。**
 *
 * ── 所以这一梯补的是**主语**：验收标准里点名的标识符，必须在那个文件里真的出现 ────────
 *
 * ★ 口径保守（与 `repoPathsNamedIn` 同一条纪律）：只认**反引号里**、
 *   且形状像**代码标识符**（camelCase / snake_case / PascalCase，可带点）的那些。
 *   ⇒ 取不到 ⇒ 不报（**不猜**）：一个靠猜的检查会在散文上误报，
 *     而误报会教人忽略门禁 —— 与漏报同样有害。
 */
export declare function subjectTermsIn(text: string): string[];
export declare function checkTaskPremises(input: {
    objective?: string;
    acceptance?: readonly string[];
    inScope?: readonly string[];
    verify?: readonly string[];
}, root?: string): PremiseFailure[];
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
export type ContractGateDisposition = 'ok' | 'blocked' | 'unmeasured';
export interface ContractGateReading {
    /** ★ 三态之一 —— 而它决定**处置**，不是决定"要不要看一眼"。 */
    readonly disposition: ContractGateDisposition;
    /** ★ 要不要**拒绝**这次调用。`blocked` ⇒ 是；另两态 ⇒ 否。 */
    readonly rejects: boolean;
    /**
     * ★ 要不要**留痕**（"这一步没被检查"）。
     *   ★ 只有 `unmeasured` 为真 —— 它是那条口径的落点：**放行，但别静默**。
     *   ★ `ok` **不留痕**：一个每次都通过的判据不该把日志淹掉。
     */
    readonly leavesTrace: boolean;
    /** ★ 可读的理由（给人看的那一份）。三态**措辞不同形**。 */
    readonly reason: string;
}
export declare function readContractGateVerdict(gates: {
    readonly ok: boolean;
    readonly blockers: readonly string[];
    readonly unmeasured?: string | undefined;
}): ContractGateReading;
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
/**
 * ── ★★★ 逐条 check 的三态 —— 而它与 `REVIEW_VERDICTS` **是不同的东西** ──────────────
 *
 * MEASURED（t11 的对**对照臂**抓出来的）：第一版把 `reviewed.checks[i].verdict`
 * 拿 `isReviewVerdict` 去判 ⇒ `'fail'` 与 `'unmeasured'` 被**错误地拒掉**。
 *
 * ★ 两套取值的**对象不同**，而那正是它们必须分开的原因：
 *
 *     `REVIEW_VERDICTS`            `pass / needs_revision / reject`
 *       ⇒ 对象是**一条任务**的审查结论（`TeamTask.verdict`）
 *
 *     本常量                        `pass / fail / unmeasured`
 *       ⇒ 对象是**一问**（`ReviewedCheck`）的结论 ——
 *         三态，且 `unmeasured` **绝不并进 `pass`**（"我没能审明白"与"审过了"不同形）
 *
 * ★★ 而"用哪一套"不是一个措辞问题：拿错一套会让**每一条正当的 `fail` / `unmeasured`**
 *   都被拒 —— 即"一个审查说它有问题"这件事**传不进契约**。
 */
export declare const REVIEWED_CHECK_VERDICTS: readonly ["pass", "fail", "unmeasured"];
/** `ReviewedCheck.verdict` 的取值判定。★ 不是 `isReviewVerdict` —— 见上面那一格。 */
export declare function isReviewedCheckVerdict(value: unknown): boolean;
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
