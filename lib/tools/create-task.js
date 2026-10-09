// ── src/tools/create-task.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。
import { appendTeamEvent, captainSessionOf } from "../events.js";
import { defineTool } from '@deepseek-ai/dsh-tools';
import { diagnosticFields, evaluateRuntimeGates, rejectOnContractGates, requireCaptain, requireCaptainTeam, requireFreshCaptainTeam, requireMember, runVerifyCommand, stateRootOf, teamLockKey, withInputSurfaceOnError, workspaceOf, loadVerifyCommandRules, } from "./shared/entities.js";
import { normalizeBlankOptionalTaskFields, resumeTeamState, sanitizeReviewAcceptance, sanitizeReviewObjective, taskKindOf, validateCreateTask, withTeamLock, writeTeam } from "../state.js";
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx, clock, runtime, scheduler, config) {
    ctx.tools.register(withInputSurfaceOnError(defineTool({
        name: 'agent_teams_create_task',
        description: 'Create a task in your team\'s task list. Use kind=work (default) for research, repository audits and general tasks. kind=review is only a quality gate for an existing implementation/repair task via reviewedTaskId. Every call must include a non-empty subject, including verification and review tasks. Tasks can depend on other tasks (dependencies): a task is only claimable once every dependency is completed. Optionally assign it to a member, who still claims it before working.',
        parameters: {
            subject: { type: 'string', required: true, description: 'Required non-empty title for this task. Never omit it, including for verification or review tasks.' },
            description: { type: 'string', description: 'What needs to be done, in detail.' },
            dependencies: {
                type: 'array',
                items: { type: 'string' },
                description: 'Task ids this task depends on (must be completed before this task can be claimed).',
            },
            assignee: { type: 'string', description: 'Member name when an owner is specified. Omission puts this task in the shared pool; roles, subjects and descriptions do not assign an owner.' },
            kind: {
                type: 'string',
                enum: ['work', 'requirements', 'implementation', 'verification', 'review', 'repair', 'integration'],
                description: 'Explicit task kind. Omission means work with no quality gates, even if the subject says implementation/review. Quality kinds require a contract. An implementation may be planned before requirements passes when its dependency chain includes that requirements task.',
            },
            round: { type: 'number', description: '1-based review / requirements / repair round.' },
            objective: { type: 'string', description: 'Required non-empty objective for quality kinds.' },
            inScope: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative POSIX paths this task may change.' },
            outOfScope: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative POSIX paths this task must not change.' },
            acceptance: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria. Required for quality kinds.' },
            verify: { type: 'array', items: { type: 'string' }, description: 'Verification commands. Required for implementation/repair.' },
            deliverables: { type: 'array', items: { type: 'string' }, description: 'Expected deliverable paths or names.' },
            nonGoals: { type: 'array', items: { type: 'string' }, description: 'Explicit non-goals.' },
            reviewedTaskId: { type: 'string', description: 'Existing AgentTeams implementation/repair task id. Required for kind=review; an external repository audit is kind=work.' },
            /**
             * ── ★★★ t9：那份「已审查」的盖章 —— 而它**不是必填** ────────────────────────
             *
             * ★ 路由规则（`friction-triage` 的 `reviewStateOf`）：带 `reviewed` ⇒ 放行；
             *   不带 ⇒ **派之前必须先审一遍**。
             *   ⇒ 而"不带"**不是错误** —— 它是"这条路没走自动生成"（问过用户、用户裁决过的）的正规形态。
             *   ★★ 所以这里**不许**把它标 required：标了会让每一条手工裁决的任务都建不出来，
             *     而那一类任务正是这条规则要服务的那一类。
             *
             * ★ 形状是 `{ at, by, checks[] }`（t2 在 `src/types.ts` 落的 `ReviewedStamp`）——
             *   逐条 checks 而不是一个布尔：**一个 `reviewed: true` 与一个"逐条写着五问结果"的格子，
             *   在被路由程序读到的那一刻同形**，而它们的可信度完全不同。
             */
            reviewed: {
                type: 'object',
                additionalProperties: false,
                description: 'A review stamp: {at, by, checks[]}. Optional — its absence means "not reviewed yet", which is a normal state (a task the user ruled on did not go through auto-generation).',
                properties: {
                    /**
                     * ── ★★ 而 `at` / `by` / `checks` 三个都是【必填的 **内部** 字段】──────────────
                     *
                     * ★ 而"必填"在这里有**两层**，不许混：
                     *     `reviewed` 这一格本身        ⇒ ★ **可选**（缺席 = 还没审，是正规状态）
                     *     一旦它在场，它的三个内部字段 ⇒ ★ **必填**（一个只带 `{by}` 的章子是残缺的）
                     *   ⇒ 而这两层各自说一件事：前者是"这条任务登记了没有"，后者是"那个登记全不全"。
                     *
                     * ★★ 而这一层必填**正是 t2 的 `ReviewedStamp` 的形态**（`at: number` /
                     *   `by: string` / `checks: ReviewedCheck[]` 三个都非可选）——
                     *   ⇒ 不写 `required: true` 会让 schema 推出**全可选**的形状，
                     *     而那与 `ReviewedStamp` **不匹配**（tsc 会当场指出，见本文件 :169 的那条错的来历）。
                     */
                    at: { type: 'number', required: true, description: 'Epoch ms when the review was stamped.' },
                    by: { type: 'string', required: true, description: 'Identity that performed the review (adversarial, captain, …).' },
                    checks: {
                        type: 'array',
                        required: true,
                        description: 'Per-question verdicts (pass / fail / unmeasured). A bare boolean would be indistinguishable from one here.',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                id: { type: 'string', required: true, description: 'Question id (scope, prerequisite, move, acceptance, boundary, …).' },
                                verdict: { type: 'string', required: true, description: 'pass / fail / unmeasured. unmeasured must NOT be folded into pass.' },
                                why: { type: 'string', description: 'Why this verdict — the reading that produced it.' },
                            },
                        },
                    },
                },
            },
            sourceTaskId: { type: 'string', description: 'Source implementation/artifact. Required for kind=repair.' },
            sourceFindingIds: { type: 'array', items: { type: 'string' }, description: 'Finding ids this repair must close.' },
            coverageOf: { type: 'array', items: { type: 'string' }, description: 'User-constraint / goal items this task covers.' },
            resume: { type: 'boolean', description: 'If true, clear halted in the same lock before creating the task.' },
            resumeReason: { type: 'string', description: 'Required non-empty reason when resume=true.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    ...diagnosticFields({ inputSurface: true, runtimeGates: true }),
                    task_id: { type: 'string', required: true },
                    subject: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    kind: { type: 'string', required: true },
                    assignee: { type: 'string' },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Task "${value.subject}" created as ${value.task_id} (status ${value.status}, kind ${value.kind}, ${value.assignee ? `assigned to ${value.assignee}` : 'unassigned shared pool'}).`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            // Some models materialize optional parameters as "" instead of omitting
            // them (issue #105). Normalize blank optional fields to omitted before
            // validation so a blank value can neither be rejected spuriously nor be
            // persisted into team.json, where it would brick the team on reload.
            const input = normalizeBlankOptionalTaskFields(args);
            const created = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const gate = validateCreateTask(fresh, {
                    subject: input.subject,
                    description: input.description,
                    dependencies: input.dependencies,
                    assignee: input.assignee,
                    kind: input.kind,
                    round: input.round,
                    objective: input.objective,
                    inScope: input.inScope,
                    outOfScope: input.outOfScope,
                    acceptance: input.acceptance,
                    verify: input.verify,
                    deliverables: input.deliverables,
                    nonGoals: input.nonGoals,
                    reviewedTaskId: input.reviewedTaskId,
                    /**
                     * ── ★★★ 这一行是"透传链的第三站"：把 `reviewed` **交给**校验 ──────────────
                     *
                     * ── ★★ 而它此刻**编译不过** —— 而那不是"这行写错了" ─────────────────────────
                     *
                     *       TS2353: 'reviewed' does not exist in type 'CreateTaskInput'
                     *
                     *   ★ 它是**类型系统在说「接收方还没声明这一格」**：
                     *     `validateCreateTask(team, input: CreateTaskInput)` 是**按参数类型**收的，
                     *     而 `CreateTaskInput`（`src/quality-gates.ts`）还没有 `reviewed` 那一格 ——
                     *     那一格的声明权在 **t11 的写域**（它的题目逐字是"区分缺失与类型错"）。
                     *
                     * ── ★★★ 而这构成一条【类型层的循环】（本任务实测出来的）────────────────────
                     *
                     *     t11 deps = [t9]      ⇒ t11 等 t9 的调用点
                     *     t9 的第三站           ⇒ 等 t11 的类型声明
                     *   ⇒ 两边互等 —— 而**只有一方是"改代码"、另一方是"写对了正确的调用"**。
                     *     本行属于后者：它**已经是对的**，只是接收方还没声明。
                     *
                     * ── ★ t11 落地时要做的是【两行】而不是一行（本任务逐条核实过）──────────────
                     *
                     *   ① `src/quality-gates.ts:15-24` 那份 `from './types.ts'` 的 import 里
                     *      **加 `type ReviewedStamp`** —— MEASURED：它现在**不在**那份清单里
                     *      （清单里有 `ReviewVerdict` / `TeamTask` / `TaskRevision` … 而没有 `ReviewedStamp`）。
                     *   ② `CreateTaskInput` 里加 `reviewed?: ReviewedStamp`。
                     *
                     * ★★ 而两行都做完之后，**本行会自动变绿** —— 不需要再改本文件一个字。
                     *   ⇒ 这正是本条注释该交出去的那条读数：**"谁还要做一件事"，以及"做完之后这里不用动"。**
                     *
                     * ── ★ 而它**不能**用本地收窄绕过（三条都实测过）──────────────────────────────
                     *
                     *     ① `input.reviewed as NonNullable<TeamTask['reviewed']>`
                     *     ② 本地类型别名 + 传更宽的形状
                     *     ③ 去掉本行（⇒ typecheck exit=0 · build exit=0，即前两站 + 落盘自洽）
                     *   ⇒ ★ ①② 都仍报同一条错 —— TypeScript 的 excess-property 检查
                     *     在【不改接收方】时必红。⇒ 所以本行**只能等** t11，没有第三条路。
                     */
                    reviewed: input.reviewed,
                    sourceTaskId: input.sourceTaskId,
                    sourceFindingIds: input.sourceFindingIds,
                    coverageOf: input.coverageOf,
                    resume: input.resume,
                    resumeReason: input.resumeReason,
                });
                if (!gate.ok)
                    throw new Error(gate.error ?? 'create_task rejected by quality gates');
                if (fresh.halted === true) {
                    const resumed = resumeTeamState(fresh, args.resumeReason ?? '');
                    if (resumed.status !== 'resumed' || resumed.team === undefined) {
                        throw new Error(resumed.error ?? 'team is halted; call agent_teams_resume or pass resume=true with resumeReason');
                    }
                    fresh.halted = false;
                    fresh.haltedAt = undefined;
                    appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-resumed', {
                        teamId: fresh.id,
                        reason: args.resumeReason ?? '',
                    });
                }
                const dependencies = args.dependencies ?? [];
                for (const dependency of dependencies) {
                    if (!fresh.tasks.some((task) => task.id === dependency)) {
                        throw new Error(`dependency "${dependency}" does not exist in team "${fresh.name}"`);
                    }
                }
                if (args.assignee !== undefined)
                    requireMember(fresh, args.assignee);
                const kind = gate.kind ?? 'work';
                const objective = kind === 'review' || kind === 'requirements'
                    ? sanitizeReviewObjective(input.objective)
                    : input.objective;
                const acceptance = kind === 'review' || kind === 'requirements'
                    ? sanitizeReviewAcceptance(input.acceptance)
                    : input.acceptance;
                const task = {
                    id: `t${fresh.taskSeq + 1}`,
                    subject: args.subject,
                    description: args.description,
                    status: 'pending',
                    assignee: args.assignee,
                    dependencies,
                    attempt: 0,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    kind,
                    ...args.round === undefined ? {} : { round: args.round },
                    ...objective === undefined ? {} : { objective },
                    ...input.inScope === undefined ? {} : { inScope: input.inScope },
                    ...input.outOfScope === undefined ? {} : { outOfScope: input.outOfScope },
                    ...acceptance === undefined ? {} : { acceptance },
                    ...input.verify === undefined ? {} : { verify: input.verify },
                    ...input.deliverables === undefined ? {} : { deliverables: input.deliverables },
                    ...input.nonGoals === undefined ? {} : { nonGoals: input.nonGoals },
                    ...input.reviewedTaskId === undefined ? {} : { reviewedTaskId: input.reviewedTaskId },
                    /**
                     * ── ★★★ 落盘：而"缺席"与"在场"必须**不同形** ────────────────────────────
                     *
                     * ★ 沿用同一形态（`=== undefined ? {} : {...}`）：缺席时**一个键都不写**，
                     *   而不是写一个 `reviewed: undefined` / `reviewed: null`。
                     *   ★★ 理由：`readTeamSync` 之后那些格子会被判"在场"，而一个"在场但是 null"
                     *     与"审过了、逐条写着结果"在**读取方**眼里同形 —— 而那正是本任务要防的。
                     *
                     * ★ 而形状坏（非对象 / checks 非数组）**在这里不许被静默丢**：
                     *   本任务把值**原样**写下去，于是坏形状会由校验（t11）拦下；
                     *   若这里顺手"清洗"，坏形状就会变成"没有这一格" —— 两者不可分。
                     */
                    ...input.reviewed === undefined ? {} : { reviewed: input.reviewed },
                    ...input.sourceTaskId === undefined ? {} : { sourceTaskId: input.sourceTaskId },
                    ...input.sourceFindingIds === undefined ? {} : { sourceFindingIds: input.sourceFindingIds },
                    ...input.coverageOf === undefined ? {} : { coverageOf: input.coverageOf },
                };
                fresh.taskSeq += 1;
                fresh.tasks.push(task);
                /**
                 * ── ★ contract 位置（契约 §1 ①：「建任务 / 改契约」）─────────────────────
                 *
                 * 位置是**既有契约校验之后**：`validateCreateTask` 已经先说了话（它不认识判据
                 * 层），本调用点只叠加。于是"这条契约本身合法吗"的既有裁决一点没变，而
                 * "这条契约可判吗"（例如 verify 命令能不能真的判定成功/失败）可以由判据层
                 * 接着问 —— 那正是 t7 要挂在这个位置上的东西。
                 *
                 * ★ 传【任务草稿】而不是 `args`：判据该读的是契约本身（objective / acceptance /
                 *   verify / inScope …），而 `args` 里混着工具参数（resume、round…）。
                 *
                 * ── ★ 注入执行器（t18，本队同一张验收表的第三格）─────────────────────────
                 *
                 * MEASURED（2026-10-05）：本调用点此前**没有** `execVerifyCommand`，于是
                 * `contract.verify-command` 在生产路径上**永远**返回 `unmeasured`
                 * （"no executor was injected … never actually run"）⇒ 调用方拒绝
                 * ⇒ **implementation / repair 这类必须验的契约连 create 都过不去**。
                 *
                 * ★ 这与 t6 修过的 `completion.verify-rerun` 缺执行器**同源**，也与 t17 修过的
                 *   "verify 缺席 ⇒ unmeasured"是同一格 —— 判据接进来了，而它的**输入面**没接。
                 *   本仓库对这条纪律的说法见契约 §2 性质 1：**判据不 import I/O，执行器由调用方注入**。
                 *
                 * ★ 复用 `runVerifyCommand`，与 completion 位置**同一个实现、同一个超时口径**
                 *   —— 不新造第二条"跑命令"的路径（两条路径会在超时/退出码语义上慢慢分叉，
                 *   而它们在日志里同形，那种分叉最难归因）。
                 */
                const contractGateSurface = await rejectOnContractGates(ctx, { team: fresh, task, creating: true }, 'create_task', stateRoot, {
                    execVerifyCommand: (command) => runVerifyCommand(workspace, command),
                    /**
                     * ── ★★★ t53：规则表**每次调用时读**（"改数据 ⇒ 立刻生效"的成立条件）──
                     *
                     * ★ 不缓存：缓存会让"改数据"在下一次**进程重启**前不生效 ——
                     *   而那正是本任务要消灭的东西（改它读的东西不该需要换进程）。
                     * ★ 也不在构建时内联（静态 import 会被 tsc 嵌进 lib/ ⇒ 改数据仍要 build）。
                     */
                    loadRules: () => loadVerifyCommandRules(workspace),
                });
                await writeTeam(stateRoot, fresh);
                /**
                 * ── ★ runtime 位置：跨步骤的过程约束 ──────────────────────────────────────
                 * 只记录，不拒绝（契约 §5）。`created: true` 是给"运行判据"的判别面 ——
                 * 一条判据可以只关心某些事件，判据层不替它猜。
                 */
                const contractRuntimeRecord = await evaluateRuntimeGates(ctx, 'task-created', {
                    team: fresh,
                    task,
                    created: true,
                }, clock);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/task-created', {
                    teamId: fresh.id,
                    taskId: task.id,
                    subject: task.subject,
                    dependencies: task.dependencies,
                    ...task.assignee !== undefined ? { assignee: task.assignee } : {},
                    ...task.kind === undefined ? {} : { kind: task.kind },
                    ...task.round === undefined ? {} : { round: task.round },
                });
                return {
                    task_id: task.id,
                    subject: task.subject,
                    status: task.status,
                    kind: taskKindOf(task),
                    /**
                     * ★★ t3：contract 位置的核对结论**随记录交出去**（与 runtime 同形）。
                     *   此前这里只有一个 `logger.warn` —— 日志被截断时，"报缺"与"输入面是齐的"
                     *   在返回值上同形。★ 三态：齐（`incomplete: 0`）/ 有缺格（`N` + `missing`）/
                     *   这个位置没判据（**字段不出现**，不是 `ok`）。
                     */
                    ...contractGateSurface === undefined ? {} : contractGateSurface,
                    ...task.assignee !== undefined ? { assignee: task.assignee } : {},
                    ...contractRuntimeRecord === undefined ? {} : { runtime_gates: contractRuntimeRecord },
                };
            });
            await scheduler.kickTeam(workspace, team.id, captain);
            return created;
        },
    })));
}
