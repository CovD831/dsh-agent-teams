// ── src/tools/create-task.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。
import { appendTeamEvent, captainSessionOf } from "../events.js";
import { snapshotReviewedArtifacts } from "../artifacts.js";
import { defineTool } from '@deepseek-ai/dsh-tools';
import { diagnosticFields, evaluateRuntimeGates, gateIdFromMessage, loadCollectionIndexFor, makeTask, recordFriction, rejectOnContractGates, requireCaptain, requireCaptainTeam, requireFreshCaptainTeam, requireMember, runVerifyCommand, scopeViolations, stateRootOf, throwWithSurface, teamLockKey, withInputSurfaceOnError, workspaceOf, loadVerifyCommandRules, } from "./shared/entities.js";
import { gateEvaluationRecordOf, normalizeBlankOptionalTaskFields, resumeTeamState, sanitizeReviewAcceptance, sanitizeReviewObjective, taskKindOf, validateCreateTask, withTeamLock, writeTeam } from "../state.js";
import { TERMINAL_TASK_STATUSES } from "../types.js";
import { registry } from "../gates/index.js";
/** ★ t87：采集层（汇合点 C 的调用方）。 */
import { observe } from "../evolution/collect.js";
import { wireDispatch } from "./update-task/dispatch.js";
/**
 * ── ★★★ t14：**每一次执行**的模型绑定 —— 任务自己声明"哪个模型跑它" ──────────────
 *
 * ── 它替换掉的那个更粗的框法 ──────────────────────────────────────────────────
 *
 * 最初的框法是"改**成员**的模型"。而那个框法定不了位：一个持久成员在
 * **多轮里执行许多不同的任务** ⇒ "这个成员的模型"**指不出"这个结果是谁产出的"**。
 *
 * ★ 而这里换成**任务自己带**：每个任务声明它由哪个模型执行 —— 因为
 *   **真正需要归属的是【那条结果】，而不是【那台机器】。**
 *   来源：@linxin666/dsh-web-all 的 task-board 设计（每条 task 自带 model +
 *   `executions[]` 历史 —— 于是**一次运行是历史里的一个元素，而不是一次状态转换**）。
 *
 * ── ★★ 而"已执行"的封条是【fail-closed】的（本任务的核心约束）────────────────────
 *
 * MEASURED / 逐条推理：**改一个【已经在跑】的任务的模型会毁掉归属** ——
 *   "这条结果是谁产出的"从那一刻起**没有唯一答案**。
 * ⇒ 用户明确接受**推迟**这件事。⇒ 于是这里**不许**悄悄放开它：
 *   一旦这条任务**执行过**，绑定就是**封条**，改它 ⇒ **拒绝**（不是警告）。
 *
 * ★ 三态里"拒绝了"与"没说话"必须不同形 —— 所以拒绝走一条**可辨认的措辞**
 *   （见 `MODEL_BINDING_SEALED_CODE`），而不是静默 no-op。
 *
 * ── ★★ 而这条封条的判据是【借来的】，并且逐字保留了它的宽口径 ────────────────────
 *
 * 借源 `canEditTaskContent()` 的口径是：**只有从未开始的任务**才可编辑内容。
 * 本文件把它落成同一条谓词 —— 三个条件是**或**的关系，缺一不可：
 *
 *   · `attempt > 0`              —— 已经被认领/执行过（代数已经推进）
 *   · status ∈ claimed|in_progress —— 正在跑（`attempt` 可能还没落盘）
 *   · status ∈ 终态               —— 已收口（有产物，归属已经写死）
 *
 * ★ 为什么终态也要算"封死"：一个 `completed` 的任务**已经有产物**了，
 *   而它的绑定正是那个产物的归属 —— 那时候改绑定比"在跑时改"**更坏**，
 *   因为那条结果已经交付、已经被引用。
 */
export const MODEL_BINDING_SEALED_CODE = 'model_binding_sealed';
/**
 * 这条任务的**模型绑定是否已经封死**（= 已经执行过 ⇒ 不许再改）。
 *
 * ★ 抽成**一个**导出谓词、而不是在调用点内联三个条件：因为"哪几种任务算已执行"
 *   是**一条**规则。内联会让它在下一次加状态时**只改一处、漏另一处**，
 *   而那正是本队记账里"同一条规则的两个副本慢慢分叉"的形状。
 *
 * ★★ 而终态那份清单**不在这里重写一遍** —— 它 import 自 `src/types.ts` 的
 *   `TERMINAL_TASK_STATUSES`（全仓同一个定义）。
 *   ★ 我第一版在这里抄了一份 `['completed','failed','cancelled']`，而那是本文件
 *     正在记账的那个错**本身**：加一个终态时，两处会分叉，而分叉的表现是
 *     "新终态的任务可以悄悄改绑定"（一条**静默**的归属漏洞）。
 *   ⇒ 一个**定义**只许有一份。
 *
 * @param task - 任何带 `attempt` / `status` 的任务形状（夹具可以只给这两格）。
 * @returns true ⇒ 绑定已封死，改它必须**拒绝**。
 */
export function modelBindingIsSealed(task) {
    if ((task.attempt ?? 0) > 0)
        return true;
    if (task.status === 'claimed' || task.status === 'in_progress')
        return true;
    return TERMINAL_TASK_STATUSES.includes(task.status ?? '');
}
/**
 * 从**任务记录**里读出它的模型绑定（缺席 = 这条任务没声明 ⇒ 走成员自己的路由）。
 *
 * ★ 读的是【任务记录】而不是【成员记录】：这正是本任务替换掉的那个框法的落点 ——
 *   归属要挂在**结果**上，而结果是任务产出的。
 */
export function modelBindingOf(task) {
    const model = task.model?.trim();
    if (model === undefined || model === '')
        return undefined;
    const reasoningEffort = task.reasoningEffort?.trim();
    return {
        model,
        ...reasoningEffort === undefined || reasoningEffort === '' ? {} : { reasoningEffort },
    };
}
/**
 * 把「绑定」与「执行那台机器实际冻住的路由」对照，交出**可审计的读数**。
 *
 * ★ 不比较就不叫查实：只把 `model` 原样回读，**证明不了**它不是"记了却没用上"。
 */
export function describeModelBindingPropagation(binding, memberModel) {
    const observed = memberModel?.trim();
    if (observed === undefined || observed === '') {
        return {
            model: binding.model,
            note: 'the binding is recorded on the task; this team has no member route to compare it against, so whether it reaches the worker is NOT established',
        };
    }
    const enforced = observed === binding.model;
    return {
        ...{ enforced },
        model: binding.model,
        member_model: observed,
        note: enforced
            ? 'the binding matches the route frozen into the member descriptor at creation, so a dispatched worker runs this model'
            : `the binding is recorded but NOT applied: dispatch carries no route, and the member descriptor is frozen at "${observed}" — a worker dispatched from it still runs "${observed}", not "${binding.model}"`,
    };
}
/**
 * 这次 create 调用要把**哪一格绑定**挂到**新任务**上。
 *
 * ── ★★★ 它存在的理由：一个参数、两种用途，而它们不许混 ────────────────────────────
 *
 * `agent_teams_create_task` 的 `model` 参数有**两个**用途：
 *
 *   · 建一条新任务时 ⇒ 它是**新任务的**绑定
 *   · `bindModelTo` 改一条已存在任务的绑定时 ⇒ 它是**那条任务的**新绑定
 *
 * ★ 两者的区别在**写完之后**才看得出来（一条记录多了一格 vs 另一条记录被改了），
 *   而"分不开"的后果是具体的：一次改绑定会**顺手**给新建的那条也记上同一个模型 ——
 *   读的人看到两条任务的绑定一起变了，**归因不到是哪一次调用干的**。
 *
 * ⇒ 所以这里把它变成**显式的**：正在重新绑定时，新任务**不**继承那一格。
 *
 * @returns 要挂在新任务上的绑定；`undefined` ⇒ **这一格一个键都不写**。
 */
export function describeModelBindingForCreate(input) {
    if (input.rebinding)
        return undefined;
    const model = input.model?.trim();
    if (model === undefined || model === '')
        return undefined;
    const reasoningEffort = input.reasoningEffort?.trim();
    return {
        model,
        ...reasoningEffort === undefined || reasoningEffort === '' ? {} : { reasoningEffort },
    };
}
/**
 * 把一条任务的绑定变成**可交出去的读数**（含"它到底到不到得了执行的那台机器"）。
 *
 * ★ 抽成一个函数、两处调用（新建 / 只改绑定），是为了让**两条路交出同一种形状的
 *   读数** —— 否则"改绑定得到的结论"与"建任务得到的结论"会在字段上慢慢分叉，
 *   而分叉之后读的人分不清自己在读哪一种。
 */
function bindingOutcomeFor(team, rebound, created) {
    const taskId = rebound.task_id;
    const assignee = team.tasks.find((candidate) => candidate.id === taskId)?.assignee;
    const memberModel = typeof assignee === 'string'
        ? team.members.find((candidate) => candidate.name === assignee && candidate.status !== 'removed')?.model
        : undefined;
    const binding = created ?? { model: rebound.model, ...rebound.reasoningEffort === undefined ? {} : { reasoningEffort: rebound.reasoningEffort } };
    return { model_binding: { ...describeModelBindingPropagation(binding, memberModel), task_id: taskId } };
}
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
            /**
             * ── ★★★ t14：这条任务由**哪个模型**执行（每次执行的绑定）───────────────────
             *
             * ★ 为什么挂在**任务**上而不是成员上：一个持久成员跨多轮执行许多不同的任务
             *   ⇒ "这个成员的模型"指不出"这条结果是谁产出的"。而绑定挂在这里，
             *   **每一条结果的归属都有唯一答案。**
             *
             * ★ 三态（与全仓纪律同源）：给了 ⇒ 记下并**从记录里读得回来**；
             *   不给 ⇒ **这一格不被写**（不写 `undefined`/`null`，因为"没声明"与
             *   "声明了空"在读取方眼里必须不同形）；给了空串 ⇒ 拒绝（不是一个模型）。
             *
             * ★★ 而"审的任务可以用与它判的实现不同的模型"是**两格各自声明**就够了 ——
             *   审查任务的绑定写在审查任务上，实现的绑写写在实现任务上，两边都读得回来。
             */
            model: { type: 'string', description: 'The model that runs THIS task. Recorded on the task record so the result keeps a single, answerable attribution even though one durable member executes many tasks across rounds. A review task may declare a different model from the implementation it judges.' },
            reasoning_effort: { type: 'string', description: 'Optional reasoning effort for this task\'s model binding. Only meaningful together with model; "default" forces the target model\'s own default.' },
            resume: { type: 'boolean', description: 'If true, clear halted in the same lock before creating the task.' },
            resumeReason: { type: 'string', description: 'Required non-empty reason when resume=true.' },
            /**
             * ── ★★★ t14：**重新绑定**一条已存在任务的模型 —— 而它是 fail-closed 的 ─────────
             *
             * ★ 为什么要有这一格：没有它，绑定就只能"建的时候定一次"，
             *   而"定错了要改"是真实存在的（建错了模型、或者建完才发现要换）。
             *
             * ★★ 而它**只在任务【还没执行】时**允许 —— 见 `modelBindingIsSealed`。
             *   一旦执行过 ⇒ **拒绝**（`model_binding_sealed`），不是警告后照做。
             */
            bindModelTo: { type: 'string', description: 'Rebind the model of an EXISTING task id. Fail-closed: refused once that task has executed (attempt > 0, claimed/in_progress, or settled).' },
            bindModelReasoningEffort: { type: 'string', description: 'Optional reasoning effort for the rebind requested by bindModelTo.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    /**
                     * ── ★★★ t39：`dispatchInputSurface: true` —— 而它正是本队同族形态第 9 次的形状 ──
                     *
                     * ★ MEASURED（我这次接线当场撞到，由 `gate-tool-output-schema` 臂 1 抓住）：
                     *   ```
                     *   工具的返回值通不过自己的 output schema —— 加字段的调用点改了，
                     *   而**声明它的地方（schema）**没跟上 …
                     *   突变目标 "agent_teams_create_task.dispatch_input_surface" 不在真实 schema 里
                     *   ```
                     *   ⇒ ★ 我把 `dispatch_input_surface` 加进了**返回值**，却没加进 **schema** ⇒
                     *     宿主会在 `createSuccessResult` 里抛 `ToolOutputError` ⇒ **这个工具每次调用都失败**。
                     *
                     * ★★ 而它值得记下来：**"返回值多一格"与"schema 多一格"是两个改动点，
                     *   而漏掉后者的表现是【工具整个坏掉】，不是"少一个字段"。**
                     *   ⇒ 它坏得比"少一格"严重，而发现它要靠**对照臂**（臂 1 拿 schema 去校验返回值）。
                     */
                    ...diagnosticFields({ inputSurface: true, runtimeGates: true, dispatchInputSurface: true }),
                    task_id: { type: 'string', required: true },
                    subject: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    kind: { type: 'string', required: true },
                    assignee: { type: 'string' },
                    /**
                     * ── ★★★ t14：绑定的**回读面** —— 与"记下去了"必须不同形 ──────────────────
                     *
                     * ★ 为什么要有这一格：`output.schema` 是 `additionalProperties: false`
                     *   ⇒ **声明面与产出面必须一致**（本队同族形态第 9 次，见 :113 的记账）。
                     *   加了返回值却没加这里 ⇒ 宿主在 `createSuccessResult` 里抛
                     *   `ToolOutputError` ⇒ **每次调用都失败**。
                     *
                     * ★ 三态：
                     *   · `model_binding` 在场      ⇒ 这条任务声明了绑定（内含 `enforced` 读数）
                     *   · 这一格**缺席**            ⇒ 没声明（不写 `null`：那与"声明了空"同形）
                     *   · `model_binding_refused` 在场 ⇒ ★ 一次**被拒绝**的改绑定：
                     *     它不是"没说话"，措辞与 code 都交出去，读的人能一眼分辨
                     */
                    model_binding: {
                        type: 'object',
                        additionalProperties: false,
                        /**
                         * ★ `model_binding` 这一格**不是 required 的** —— 它有三态（见上），
                         *   而"没声明绑定"是其中**合法的一态**（那一刻这一格本来就缺席）。
                         *   ⇒ ★ 所以臂 8 的对照半边改去拿掉一个**真的必填**的字段（`task_id`），
                         *     而不是拿掉这一格 —— 后者在 schema 上**本来就不该报违规**。
                         *     MEASURED：我第一版就是拿它当对照，于是那条断言红，
                         *     而它红得**对**：那条对照本身是错的。
                         */
                        properties: {
                            model: { type: 'string', required: true },
                            reasoning_effort: { type: 'string' },
                            enforced: { type: 'boolean' },
                            member_model: { type: 'string' },
                            task_id: { type: 'string' },
                            note: { type: 'string', required: true },
                        },
                    },
                    model_binding_refused: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            code: { type: 'string', required: true },
                            task_id: { type: 'string', required: true },
                            reason: { type: 'string', required: true },
                        },
                    },
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
                /**
                 * ── ★★★ t14：改绑定那条路 —— 在【任何改动之前】先定生死 ────────────────────
                 *
                 * ★ 顺序是要紧的：**拒绝必须发生在写任何东西之前**。
                 *   若把守卫放在半路（改了一半再拒绝），一次拒绝就会留下**半改的**记录 ——
                 *   而"拒绝了"与"改坏了"在读取方眼里必须不同形。
                 *
                 * ★ 三态：
                 *   · 没传 `bindModelTo`        ⇒ 这条路不走（**不猜**，也不报"拒绝"）
                 *   · 传了、任务**未执行**      ⇒ 放行，改绑定 + 留痕
                 *   · 传了、任务**已执行**      ⇒ ★ **拒绝**（`model_binding_sealed`）
                 *
                 * ★★ 这里是**先查、后改**，而查用的是 `modelBindingIsSealed`（**一个**谓词）——
                 *   三个条件**不在这里内联**：内联会让"哪几种算已执行"出现第二份副本，
                 *   而两份副本会慢慢分叉（本队记账里最常见的形状）。
                 */
                const rebindTarget = typeof input.bindModelTo === 'string' ? input.bindModelTo.trim() : '';
                let rebound;
                if (rebindTarget !== '') {
                    const target = fresh.tasks.find((candidate) => candidate.id === rebindTarget);
                    if (target === undefined)
                        throw new Error(`bindModelTo: task "${rebindTarget}" does not exist in team "${fresh.name}"`);
                    const newModel = typeof input.model === 'string' ? input.model.trim() : '';
                    if (newModel === '')
                        throw new Error('bindModelTo requires a non-empty model to bind to');
                    if (modelBindingIsSealed(target)) {
                        /**
                         * ── ★★★ 拒绝 —— 而且**明确说出为什么**（不许静默 no-op）──────────────────
                         *
                         * ★ 措辞里带 `code`，是因为读的人要能**机械分辨**"这次是封条拒了它"，
                         *   而不是"它悄悄没生效"。两件事在只看最终记录时**完全同形**。
                         *
                         * ★ 而拒绝的理由要**指名是哪一条**（`attempt` 推进过 / 正在跑 / 已收口）——
                         *   否则读的人拿不到"它凭什么不能再改"的证据。
                         *
                         * ★★ 抛出（而不是静默返回）：一次**被拒绝**的改绑定必须让调用方**当场知道**。
                         *   静默返回一个"看起来成功"的结果，会让调用方以为绑定改了 ——
                         *   而那正是本契约第五格要消灭的形状。
                         *   ★ 而这条拒绝**发生在写任何东西之前**（此刻 `fresh` 一个字段都没动过），
                         *     所以它留不下半改的记录 —— "拒绝了"与"改坏了"因此不同形。
                         */
                        const why = (target.attempt ?? 0) > 0
                            ? `it has already executed (attempt ${target.attempt})`
                            : target.status === 'claimed' || target.status === 'in_progress'
                                ? `it is running (status "${target.status}")`
                                : `it has settled (status "${target.status}")`;
                        throw Object.assign(new Error(`${MODEL_BINDING_SEALED_CODE}: task "${target.id}" refuses a model binding change because ${why} — changing the model of a task that has already run destroys attribution ("which model produced this result?"), so the binding is fail-closed.`), { model_binding_refused: { code: MODEL_BINDING_SEALED_CODE, task_id: target.id } });
                    }
                    const effort = typeof input.bindModelReasoningEffort === 'string' ? input.bindModelReasoningEffort.trim() : '';
                    target.model = newModel;
                    /**
                     * ★ 三态：没给档位 ⇒ **删掉旧的**（不是留着上一任的档位 —— 那会与新的
                     *   模型**错配**，而档位 id 是**绑定到某个具体模型的能力**上的）；
                     *   `"default"` ⇒ 同样删掉（= 让目标模型用自己的默认）；
                     *   给了别的 ⇒ 记下。
                     */
                    if (effort === '' || effort === 'default')
                        delete target.reasoningEffort;
                    else
                        target.reasoningEffort = effort;
                    target.updatedAt = Date.now();
                    rebound = {
                        task_id: target.id,
                        model: newModel,
                        ...target.reasoningEffort === undefined ? {} : { reasoningEffort: target.reasoningEffort },
                    };
                }
                /**
                 * ── ★★★ 只改绑定：一次**不建新任务**的改绑定 ────────────────────────────────
                 *
                 * ★ 为什么这条早退要存在：改绑定与建任务是**两件事**。若改绑定被迫
                 *   顺带建一条新任务，调用方就会为了改一个模型而**污染任务列表** ——
                 *   而那条多余的任务与"真的想建的任务"在记录里**同形**。
                 *
                 * ★ 判据是 `subject` —— 但**不是"缺了就当作改绑定"**（我第一版是那样写的，
                 *   而它有个真实的坏处）：`subject` 是建任务的必填，所以"缺了它"在**正常**
                 *   调用里只会由**参数错误**造成 ⇒ 拿它当判据，会让一次"忘了写 subject 的
                 *   建任务"**静默变成**一次改绑定（于是那条任务没被建出来，而调用方以为建了）。
                 *   ⇒ ★ 改判据为**显式的**：**只在真的给了 `bindModelTo` 时**才走这条路。
                 *     于是"没给 subject 的建任务"照样走它该走的那条路（并在校验处报错）。
                 *
                 * ★★ 而这条路上**不跑 create/dispatch 那两道门**：这一刻**没有东西被建、
                 *   也没有东西被派发** ⇒ 拿"这条新任务该不该被派发"去拦一次改绑定，
                 *   是**判据与落点错配**（本队记账里那条："判据没有错，落点错了"）。
                 *   ⇒ 而它不跑门也**不是旁路**：改绑定只动 `model`/`reasoningEffort` 两格，
                 *     不新建任何东西、不改变任务图 —— 门要拦的那些事在它身上**不存在**。
                 */
                if (rebindTarget !== '') {
                    await writeTeam(stateRoot, fresh);
                    const bound = fresh.tasks.find((candidate) => candidate.id === rebound.task_id);
                    return {
                        task_id: rebound.task_id,
                        subject: bound.subject,
                        status: bound.status,
                        kind: taskKindOf(bound),
                        ...bindingOutcomeFor(fresh, rebound, undefined),
                    };
                }
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
                /**
                 * ── ★★★ t87 · 汇合点 C：**契约类拒绝**（规格 §1 的表）─────────────────────
                 *
                 * ★ 为什么在这里而不是在 `validateCreateTask` 内部：
                 *   `validateCreateTask`（`quality-gates.ts:843`）是一个**纯函数** ——
                 *   它**返回** `{ ok: false, error }` 而**不抛**，且**没有 `ctx`/`stateRoot`**
                 *   （t87 实测：那一整个函数里没有 `await`、没有 `node:` import、没有任何 ctx）。
                 *   ⇒ ★ 它**结构上无法**调采集（那需要 stateRoot 与一个写盘）。
                 *   ★★ 而把 I/O 塞进一个纯函数会破坏"判据层零 I/O"那条载荷级不变量
                 *     （`src/gates/runtime/stall.ts` 的注释逐字：「那条纯度是载荷,不是风格」）。
                 *   ⇒ 所以采集落在**调用方**（这里有 ctx 与 stateRoot）——那也正是"不侵入"的落点。
                 *
                 * ★★ 时序：`void observe(...)` **不 await**，然后**原样抛** ——
                 *   采集是旁路，**不许**把一次拒绝变成一次等待（反向半边 C）。
                 */
                if (!gate.ok) {
                    const contractMessage = gate.error ?? 'create_task rejected by quality gates';
                    void observe({
                        stateRoot,
                        where: 'validateCreateTask',
                        message: contractMessage,
                        kind: ['unwired'],
                        component: 'contract',
                        tool: 'agent_teams_create_task',
                        now: Date.now(),
                        evaluateCollection: async (context) => registry.evaluate('collection', context),
                        /**
                         * ── ★★★ N1.2：`source` 与 `index` 同时接上（之前两格都没有）──────────────
                         *
                         * ★ `source` 取 `where` 的字面量（粗粒度，计划 §2.1 裁定）——
                         *   ★ 不给的话 `cooldown` 仍答 unmeasured（"carries no source"），
                         *     于是读数从 34 变 34，只是理由换了 ⇒ 看起来像修了。
                         * ★ `loadIndex` 惰性：本处 `void observe(...)` 不 await，
                         *   读盘发生在不被等待的那一段里 ⇒ 拒绝路径立刻抛（原时序不变）。
                         */
                        source: 'validateCreateTask',
                        loadIndex: async () => await loadCollectionIndexFor(stateRoot),
                        warn: (note) => ctx.logger.warn(note),
                    });
                    throw new Error(contractMessage);
                }
                /**
                 * ── ★★★ t26：作用域的一致性检查（**建任务的那一刻**）────────────────────────
                 *
                 * 契约原话：*"A task that fails any of these checks is refused at creation
                 * with a message naming which check failed"*。
                 *
                 * 位置是刻意的：**紧挨着** `validateCreateTask` —— 那里已经在校验 inScope / verify /
                 * acceptance，而这三条检查读的正是同一份输入。⇒ 成本是几次字符串比较，
                 * 而不是一整次派发往返（本轮这一族缺陷吃掉了约八次）。
                 *
                 * ── 三条各自实测过（队长证据包，四个成员独立撞到）────────────────────────────
                 *
                 *   · `contradiction`（t19）：`src/types.ts` 同时在 inScope 与 outOfScope
                 *     ⇒ 而校验器**按 out-of-scope 那一侧执行** ⇒ 任务**无解**。
                 *   · `emit`（t24 / t19）：`lib/types.d.ts` 是**永远产不出来**的路径；
                 *     而 t19 漏了 `lib/types.js`（**真正跑起来的那一个**）。
                 *     ★★ 决定性证据：每个别的列了 `src/types.ts` 的任务都已经声明了它
                 *     ⇒ 那从来不是判断，只是一次分叉。
                 *   · `touch`（t24）：验收标准是**把东西搬出**一个文件，而那个文件在 outOfScope 里
                 *     ⇒ move 类任务**天生**有源与目的地，而只列目的地。
                 *
                 * ★ 只对**质量类**跑？**不**：`contradiction` 与 `emit` 对任何 kind 都成立
                 *   （一个 `work` 任务同样可以自相矛盾、同样可以漏声明产物）。
                 *   ⇒ 三条都对**所有**任务跑 —— 它们是**文件清单的性质**，与 kind 无关。
                 */
                const scopeProblems = scopeViolations({
                    inScope: input.inScope,
                    outOfScope: input.outOfScope,
                    acceptance: input.acceptance,
                });
                if (scopeProblems.length > 0) {
                    const lines = scopeProblems.map((problem) => `  (${problem.check}) ${problem.detail}`);
                    throw new Error(`create_task refused: the scope is internally inconsistent (contract defect, NOT an unmeasured reason) — ${scopeProblems.length} problem(s):\n`
                        + `${lines.join('\n')}\n`
                        + '★ 每一条都是**当场算出来的**，不是形容词。修法：\n'
                        + '  (contradiction) 从 outOfScope 里拿掉那个路径，或从 inScope 里拿掉它 —— 不能两边都在；\n'
                        + '  (emit) 把产物加进 inScope（src/X.ts ⇒ lib/X.js 与 lib/types/X.d.ts）；\n'
                        + '  (touch) 把**源**文件也加进 inScope —— move 类任务要改源与目的地两处。\n'
                        + '★★ 用 `refused` 而不是 `rejected`：本仓的 `rejected` 前缀专指**判据拒绝**，'
                        + '而这一条是**契约形状**问题（当场算出来的三态之一）。两者同前缀会让'
                        + '`gate-update-task-unmeasured` 那条臂分不清"真拒绝"与"没能测量"。');
                }
                if (fresh.halted === true) {
                    const resumed = resumeTeamState(fresh, args.resumeReason ?? '');
                    if (resumed.status !== 'resumed' || resumed.team === undefined) {
                        throw new Error(resumed.error ?? 'team is halted; call agent_teams_resume or pass resume=true with resumeReason');
                    }
                    fresh.halted = false;
                    fresh.haltedAt = undefined;
                    /**
                     * ★★★ 2026-10-20：与 `src/tools/resume.ts` 同一处修复 —— 显式归零必须**落盘**。
                     *   见那里那段长注释（MEASURED：归零此前只活在返回值里，一个字节都没写）。
                     *   ★ 两处**必须同时修**：只修一处会让"走哪条路恢复"决定归零生不生效，
                     *     而那种分叉在盘上读不出区别。
                     */
                    if (resumed.clearedPlanReview === true && resumed.team !== undefined) {
                        fresh.planReviewRounds = resumed.team.planReviewRounds;
                        fresh.planReviewEscalated = resumed.team.planReviewEscalated;
                    }
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
                /**
                 * ── ★★★ t14：这次 create 要挂上去的绑定 ────────────────────────────────────
                 *
                 * ★ 若这次调用是**改一条已存在任务的绑定**（`bindModelTo`），
                 *   那么 `model` 那一格属于**那条任务**，而**不属于**这次新建的这条：
                 *   把它一并写进新任务，会让一次"改绑定"顺手给另一条任务也改了绑定 ——
                 *   而那正是"一次调用影响了两条记录"的形状（读的人分不清是谁改的）。
                 *
                 * ⇒ 两种用途**互斥地**取用同一个 `model` 参数，而这里明确写下哪一种是哪一种。
                 */
                const binding = describeModelBindingForCreate({
                    model: input.model,
                    reasoningEffort: input.reasoning_effort,
                    rebinding: rebindTarget !== '',
                });
                /**
                 * ── ★★★ t117：构造走**唯一的** `makeTask`（`tools/shared/entities.ts`）────────
                 *
                 * ★ 本路径是四条里**字段最多**的一条（它承载完整的质量契约），
                 *   所以它是 `makeTask` 的**超集**用例 —— 其余三条是它的子集。
                 *   ⇒ 统一之后，新字段只加在 `TaskDraft` 与 `makeTask` 一处。
                 *
                 * ★★ 两次 sanitize 的**不变式**：`objective` / `acceptance` 在上面
                 *   （`:684-689`）已按 kind 算好，而 `makeTask` 内部对
                 *   `kind ∈ {review, requirements}` **再算一次**。两者必须一致：
                 *     · `sanitizeReviewObjective` —— 幂等（`nonemptyString` + `trim`，
                 *       缺省值本身非空且不像闸门测试契约 ⇒ 第二次返回同一值）
                 *     · `sanitizeReviewAcceptance` —— **不幂等**：喂空数组会注入
                 *       `DEFAULT_REVIEW_ACCEPTANCE`。⇒ ★ 上面那次必须**先**发生，
                 *       否则这里的入参是 `undefined` 而 `makeTask` 会拿到 `undefined`
                 *       走 `[...(undefined ?? [])]` 为空 —— 与今天的行为不同。
                 *   ⇒ 因此**不删**上面那两行；这里传的是已算好的 `objective` / `acceptance`。
                 */
                /**
                 * ── ★★★ t117：构造走**唯一的** `makeTask`，但 `reviewed` 这一格**留在本文件** ──
                 *
                 * ★ 为什么不把它一并交给 `makeTask`：
                 *   t9（P2c）的 acc4 逐字要求「透传链**四处都在**：schema / 入参 /
                 *   validateCreateTask / 落盘」，且它的 subject 明写「**单文件**」——
                 *   那条契约检查的正是"这条链没有被拆散到多个文件里"。
                 *   ⇒ 把落盘那一站挪进 `tools/shared/entities.ts` 会让那条验收件变红，
                 *     而它是 t6（独立审查，completed/pass）逐行核过的产物。
                 *   ★ 我**不改别人已通过的验收件**，也不为重构解散已裁定的实施条款。
                 *   ⇒ 这一格在本文件里原样保留，`makeTask` 的 `TaskDraft` **不收** `reviewed`。
                 *
                 * ★ 代价（如实记账）：`makeTask` 对 `reviewed` 不是完整覆盖 —— 它少一格。
                 *   故 `TaskDraft` 里没有 `reviewed` 字段，编译器会挡住"误以为它能造这一格"的调用。
                 */
                /**
                 * ── ★★★ 2026-10-20：戳在**落盘那一刻**就绑定它审过的字节（方向 A）────────────
                 *
                 * ── 它修的是什么（MEASURED，`node scripts/reviewed-stamp-census.mjs`）──────
                 *
                 * 盘上 **90 个** `reviewed.at` 早于这道门上线，且**全部**同时早于它们自己的
                 * `createdAt`（实测：85 个集中在 `agent-teams-refactor`，`at - createdAt`
                 * 恒为 **-365 天 ±0.4 天** ⇒ 一次批量回填把年份写错了一年；其余 5 个在
                 * `mutation-quality`，同一批）。而它们的 `why` 是**逐条真写的**
                 * （83/85 条互不相同）⇒ ★ **审查是真的，只有那个数字是错的。**
                 *
                 * ★★ 而"那个数字错了"这件事**只可能被一个数字发现**，因为戳**不指向任何东西**：
                 *   `{at, by, checks[]}` 里没有任何一格说"我审的是什么"。
                 *   ⇒ 于是 ① 无法核对这份戳与它声称审过的东西是否对得上；
                 *     ② 改一个 `at` 就能让一条假戳变成"可能"（而**改数字的成本是零**）。
                 *
                 * ── 所以：把戳绑到**它审的字节**上 ────────────────────────────────────────────
                 *
                 *   绑定 = 这条任务 `inScope` 的每个文件在**此刻**的 `sha256`
                 *   ⇒ 于是"这份戳审的是什么"变成一个**可核的事实**，而不是一个 `at` 数字。
                 *   ★ `update_task` 落判决时已经在做同一件事（`reviewedArtifacts`，t97）——
                 *     这里是**同一条纪律的第二个落点**：建任务那一刻的戳也要能对账。
                 *
                 * ★★ 三态，且**缺席不许落成空数组**：
                 *   · 读到了 ⇒ 写进去（可能是空数组：这条任务的 `inScope` 一个文件都没匹配上）
                 *   · 读不到 ⇒ **一个键都不写**（= "没绑定"，`ArtifactBinding` 的 `unbound` 那一支）
                 *     ★ 写一个空数组会说"它绑定了、绑的是零个文件"，而真相是"我们没能读出来"。
                 *   · 没有 `reviewed` ⇒ 不绑（没有戳就没有审过什么，绑一份没有对象的摘要没有意义）
                 *
                 * ★ 与 `update_task` 那处**同一份实现**（`snapshotReviewedArtifacts`），
                 *   不新造第二条读字节的路径。
                 */
                const reviewedArtifacts = input.reviewed === undefined || (input.inScope ?? []).length === 0
                    ? undefined
                    : await (async () => {
                        try {
                            const snapshot = await snapshotReviewedArtifacts(workspace, input.inScope ?? []);
                            return snapshot.reviewedArtifacts;
                        }
                        catch (reason) {
                            ctx.logger.warn(`agent-teams: could not snapshot reviewed artifacts for the new task (recorded, not thrown): ${String(reason)}`);
                            return undefined;
                        }
                    })();
                const task = {
                    ...makeTask({
                        id: `t${fresh.taskSeq + 1}`,
                        subject: args.subject,
                        description: args.description,
                        assignee: args.assignee,
                        dependencies,
                        kind,
                        round: args.round,
                        objective,
                        inScope: input.inScope,
                        outOfScope: input.outOfScope,
                        acceptance,
                        verify: input.verify,
                        deliverables: input.deliverables,
                        nonGoals: input.nonGoals,
                        reviewedTaskId: input.reviewedTaskId,
                        sourceTaskId: input.sourceTaskId,
                        sourceFindingIds: input.sourceFindingIds,
                        coverageOf: input.coverageOf,
                        /**
                         * ── ★★★ t14：把绑定写进【任务记录】—— 三态，而"没声明"要真的不同形 ─────────
                         *
                         * ★ 沿用同一形态（`=== undefined ? {} : {...}`）：没声明时**一个键都不写**，
                         *   而不是写 `model: undefined`。理由与下面 `reviewed` 那条**同源**：
                         *   一个"在场但是空"的模型与"这条任务没声明绑定"在读取方眼里同形 ——
                         *   而"谁跑的这一条"正是本任务要让它**唯一可答**的那件事。
                         *
                         * ★★ 而 `normalizeBlankOptionalTaskFields` 已经把空串摘掉了（issue #105
                         *   那个"模型把可选参数物化成 `""`"的形状）⇒ 走到这里的 `model` 要么是
                         *   一个非空的模型名，要么**不在场** —— 不存在第三种。
                         */
                        model: binding?.model,
                        reasoningEffort: binding?.reasoningEffort,
                    }),
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
                     *
                     * ★★ 而这一格**刻意**不交给 `makeTask`：t9（P2c）的 acc4 逐字要求
                     *   透传链「四处都在」且 subject 明写「单文件」，它检查的正是
                     *   "这条链没有被拆散到多个文件"。挪进 `makeTask` 会让 t6 逐行核过的
                     *   那条验收件变红。⇒ 保留在这里，`TaskDraft` 因此**不收** `reviewed`。
                     */
                    ...input.reviewed === undefined ? {} : { reviewed: input.reviewed },
                    /**
                     * ★ 戳审过的字节（见上面那段）。★ **只在真的读到时有这一格** ——
                     *   写空数组会让"没绑上"与"绑了零个文件"同形（`ArtifactBinding` 的
                     *   `unbound` 那一支正是靠"这一格不在场"来读的）。
                     */
                    ...reviewedArtifacts === undefined ? {} : { reviewedArtifacts },
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
                /**
                 * ── ★★★ t81：把**契约段**的判据裁决落盘到这条任务 ────────────────────────────
                 *
                 * ★ 在此之前这句裁决**从不离开** `rejectOnContractGates`（t81 开工勘查实测：
                 *   它只用于当场裁决 / 措辞 / 台账，**通过路径上被丢弃** —— 本仓自记 F3 的形态）。
                 *   ⇒ `rejectOnContractGates` 现在把它随 `gates` 带出来（本文件上一行的返回值里）。
                 *
                 * ★★ 只在**真的求值过**时才写（`contractGateSurface === undefined` ⇒ 不写）：
                 *   与 `gateEvaluation` 那条注释同一条纪律 —— 「落盘只在真的求值过时发生」。
                 *   ★ 一个恒在场的空记录会让「这一步没被检查」与「检查了且没事」同形。
                 *
                 * ★ 落点在 `writeTeam`(:782)**之前** ⇒ 写进 `task` 就随之持久化。
                 * ★ 与 `gateEvaluation` 并存（那一格是 S1 的 completion 单段形状，既有读者依赖它）。
                 */
                if (contractGateSurface !== undefined) {
                    ;
                    (task.gateEvaluations ??= {}).contract = gateEvaluationRecordOf(contractGateSurface.gates);
                }
                /**
                 * ── ★★★ t14：绑定的回读 + **传播读数**（在落盘之前算，读的是刚写下的那一条）──
                 *
                 * ★ 为什么必须**查实**而不是原样回读：只把 `model` 抄一遍**证明不了**
                 *   它不是"记了却从没被用上"。⇒ 这里把它与**执行那台机器真正冻住的路由**
                 *   对照 —— 对照不上就**明说没生效**（见 `describeModelBindingPropagation`）。
                 *
                 * ★ 成员的"冻结路由"取**这一次的目标成员**（`args.assignee`）：
                 *   任务派给谁，就与谁对照 —— 与一个无关成员对照会得出无意义的读数。
                 *   ★ 池任务（无 assignee）**没有**可对照的对象 ⇒ 如实报"未能判定"
                 *     （`enforced` 缺席），而不是猜一个 `false`。
                 */
                const boundTaskId = rebound === undefined ? task.id : rebound.task_id;
                const bindingOutcome = rebound !== undefined
                    ? bindingOutcomeFor(fresh, rebound, undefined)['model_binding']
                    : binding === undefined
                        ? undefined
                        : bindingOutcomeFor(fresh, { task_id: task.id, ...binding }, undefined)['model_binding'];
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
                /**
                 * ── ★★★ t39：`dispatch` 插入点的【唯一求值处】────────────────────────────────
                 *
                 * 用户原话（这条规则存在的理由，逐字）：
                 *   「带 `reviewed` ⇒ 放行；不带 ⇒ **派发【前】必须先审一遍**」
                 *
                 * ★★ 而"派发前"就是**这一刻**：锁外那一行 `scheduler.kickTeam(...)` 把这条活
                 *   交给成员 —— 那是【队长 → 成员】的那一下。
                 *
                 * ── 为什么它从这里来（t39 的修法）────────────────────────────────────────────
                 *
                 * ★ 此前它求值在 `update_task` 里，而那里**没有任何一次**是派发：
                 *     `in_progress` 是成员**报到**、`completed`/`failed` 收口、`cancelled` 撤销。
                 *   ⇒ 于是每一次状态更新都过这道门，而本队 39 条任务里 0 条带 `reviewed`
                 *     ⇒ "没审"是默认状态 ⇒ **每一次状态转换都被拒**（t10 实测 11 条误拒）。
                 *
                 * ★★★ 一般形式（本队今晚第五次，与 t4 同族）：
                 * > 一条本意是"提醒"的规则，若落在【所有人都经过的求值点上】，
                 * > 而它的默认状态在真实语料里是绝大多数 ⇒ 那么它的默认状态就成了【拒绝】。
                 *   ⇒ ★ **判据没有错，落点错了。** 判据与它的三态一个字没动。
                 *
                 * ★ 而"那一半没被放宽"：一个真正被派发而没有 `reviewed` 的任务**仍然被拦** ——
                 *   只是它现在拦在**派发**这一侧，而不是每一次状态更新上。
                 */
                const dispatchWiring = await wireDispatch({
                    /**
                     * ── ★★★ 必须交【整条 task】，不是我挑几格拼的 ──────────────────────────────
                     *
                     * ★ 我第一版传的是 `{ id, reviewed }` —— 而那是**静默失效**，实测抓到的：
                     *   ```
                     *   dispatch surface = {"checked":0,"incomplete":0,"skipped":3,"missing":[]}
                     *   ```
                     *   ⇒ 三条 dispatch 判据**全部 skipped**。
                     *
                     * ★★ 逐条成因（两条来自"缺格"，一条更隐蔽）：
                     *   · `changed-paths` / `worktree` 的 `appliesTo` 读 `ctx.task.kind`
                     *     ⇒ 我漏了 `kind` ⇒ 它们对【每一条】任务都不适用
                     *   · ★ `plan-reviewed` 的 `appliesTo` 读 `createdAt`（`predatesThisGate`）
                     *     ⇒ 我漏了 `createdAt` ⇒ `predatesThisGate` 返回 **true**（"缺就读作早于本门"）
                     *       ⇒ ★ 于是**连它自己也被跳过** ⇒ 我这次接线**一个字也没生效**
                     *
                     * ★★★ 而那条最值得记：**"漏传一格"的表现是【判据说"不适用"】，不是报错。**
                     *   寄存器如实报 `skipped: 3`，而"跳过了"与"跑了而结论是通过"在本队
                     *   记账里是【不同形】的两件事 —— 但那要靠人去看 `skipped` 才认得出来。
                     *   ⇒ ★ 所以这里交**整条 task**：判据按它声明的 `requires` 自己去取，
                     *     而不是由调用方【替它挑】哪几格够用。挑漏一格的代价是静默失效。
                     */
                    task,
                    changedPaths: undefined,
                    caller: captain,
                    workspace,
                    registry: registry,
                });
                const dispatchGates = dispatchWiring.gates;
                (task.gateEvaluations ??= {}).dispatch = gateEvaluationRecordOf(dispatchGates);
                /**
                 * ★★ t81：第二次落盘 —— 只为把上一行那句裁决持久化。
                 *   ★ 位置在这里是**必须的**（dispatch 求值在锁内、且在第一次 writeTeam 之后）；
                 *     而"第二次写"本身是安全的：`fresh` 是同一个活对象，
                 *     两次之间**没有任何地方重读盘上文件**（t81 实测确认），
                 *     所以第二写不会用陈旧快照覆盖第一写。
                 */
                await writeTeam(stateRoot, fresh);
                /**
                 * ── ★★★ t24：判据读到的那一份 ctx —— **必须由接线交出**，不在这里重造 ──────────
                 *
                 * `wireDispatch` 返回的 `context` 就是它拿去核对与求值的那一份（构造一次、用两次）。
                 * ★ 在调用点重写一份字面量会让"记进台账的 ctx"与"判据当时读到的 ctx"
                 *   在下一次改动之后**分叉**，而分叉后那条记录重放出来的是另一个时刻的输入
                 *   （台账的全部意义是"当时那一份"，见 f-0014）。
                 */
                const dispatchContext = dispatchWiring.context;
                const dispatchSurface = dispatchWiring.inputSurface;
                /**
                 * ── ★★ 三态（与 `update_task` 原来那一套【逐字同源】，只是搬了地方）────────────
                 *
                 *   `blockers`                 ⇒ **拒绝**（"我检查了而它不行"）
                 *   `unmeasured` / `skippedAll` ⇒ **放行 + 告警**（"我没能检查"≠"它不行"）
                 *     ★ 而那正是 t42 那条口径：一个安全约束**不触发**时应当放行并留痕。
                 *
                 * ── ★★★ 而第三态：`blockers` 与 `unmeasured` **同时**在场 ────────────────────
                 *
                 * MEASURED（`src/gates/registry.ts:982-987`）：聚合体在有 unmeasured 时
                 *   **原样透出 `blockers`** ⇒ 「一条判据发现问题、另一条测不成」是可达的。
                 * ★ 只问"有没有 unmeasured 的成因"会让那一格**带着 blocker 一起放行**，
                 *   而两者的补救动作**相反**。⇒ 第三个合取项 `blockers.length === 0`。
                 * ★ 反向半边不动：纯 `unmeasured`（或 `skippedAll`）仍然放行 + 告警。
                 */
                const dispatchNotChecked = dispatchGates.ok === false
                    && (dispatchGates.skippedAll !== undefined || dispatchGates.unmeasured !== undefined)
                    && dispatchGates.blockers.length === 0;
                if (dispatchNotChecked) {
                    const why = dispatchGates.unmeasured !== undefined
                        ? `the dispatch step could not be measured (${dispatchGates.unmeasured})`
                        : `nothing was evaluated (${dispatchGates.registered} registered, all skipped)`;
                    ctx.logger.warn(`agent-teams: create_task reached the dispatch gate and ${why}; the dispatch step was NOT checked — allowing it through, because "not checked" is not "refused"`);
                }
                if (dispatchSurface !== undefined && dispatchSurface.incomplete > 0) {
                    ctx.logger.warn(`agent-teams: create_task reached the dispatch gate with an unfinished input surface (recorded, not rejected): ${dispatchSurface.missing.join('; ')}`);
                }
                if (!dispatchNotChecked && dispatchGates.ok === false) {
                    /**
                     * ── ★★ 措辞与 `update_task` 那处同源，而【抛出方式】也必须同源 ──────────────
                     *
                     * ★ 措辞同源（`… rejected: …`）：读日志的人要在两处认出**同一条判据**。
                     *
                     * ★★ 而用 `throwWithSurface` 而不是裸 `throw new Error` —— 理由是
                     *   **FINDING-1 / t42** 那条：**拒绝恰恰是最需要读到"结论"的那一刻**。
                     *   · 裸 `throw` ⇒ 异常上**不带** `agentTeamsInputSurface` ⇒
                     *     工具边界搬不出结论 ⇒ 调用方只看到一句消息
                     *   · `throwWithSurface` ⇒ 异常上带着它 ⇒ 边界把它搬到 `error.input_surface`
                     *   ⇒ ★ 于是"是判据拒了它"与"是契约不合法"在调用方那一侧**不同形**。
                     *
                     * ★ 而本文件此前【没有】导入过 `throwWithSurface`（它整篇用裸
                     *   `throw new Error`）—— 那对"契约校验"那类拒绝够用（它们没有"输入面结论"），
                     *   但对**判据产生的拒绝**不够，因为判据的结论要交出去。
                     */
                    /**
                     * ── ★★★ t24：卡点发生时【当场记账】—— 与 `throwWithSurface` 在同一条路径上 ──
                     *
                     * MEASURED（2026-10-14 队长复核）：`dispatch` 点上一共 67 条记录，
                     *   **最后一条在 2026-10-09**；根因是一个可定位的提交 ——
                     *   `d231f74 fix(t39): move the dispatch evaluation to where dispatch actually happens`
                     *   把求值搬到这里，而**记账没有跟着搬**：
                     *     删除的 `recordFriction` 调用 **2 处**（`point: 'dispatch'`），新增 **0 处**。
                     *   ⇒ 全仓一度只剩 completion（`update-task.ts`）与 contract（`entities.ts`）两处。
                     *
                     * ★★★ 而它的形状是本队记账里最贵的那一条（与 t39 拆 `tools.ts` 时把 t41 的
                     *   接线搬回旧版**同族**）：
                     * > **一次纯搬运，少搬了"改动的可见面"，而没有任何东西报错。**
                     *   ⇒ 判据照常拒绝、日志照常有、`throwWithSurface` 照常带结论 ——
                     *     唯一消失的是**台账那一格**，而它是"事后补不上"的那一份材料
                     *     （f-0014：记录必须在卡点发生时做，事后补是补不上的）。
                     *   ★ 而它**没有任何一条臂**要求「拒绝 ⇒ 台账 +1」（completion / contract
                     *     两处各自有臂，`dispatch` 这一格没有）⇒ 于是它静默了 5 天。
                     *   ⇒ 本任务配的守门臂（`scripts/gate-friction-capture.test.mjs` 的臂 9）
                     *     钉的就是这一格：把下面这段注释掉，那条臂**必须**红。
                     *
                     * ★★ 形状**逐字照抄** `src/tools/update-task.ts:1513` 那处（不另发明字段）：
                     *   同一份 `frictionMessage`、同一个 `stateRoot`（**本团队自己的**，
                     *   不许用进程级单值 —— 见 `recordFriction` 里那段实测）、同一组
                     *   `context` / `mechanismState` / `session` / `taskId` / `teamId` / `tool` / `auto`。
                     *
                     * ★ 它是**【旁路】动作**：`void … .then(warn)`，写盘失败只写一条 warn
                     *   —— **不改裁决**，下面的拒绝措辞与抛出方式一个字不变。
                     *   （理由与 `rejectOnContractGates` 那处相同：拒绝路径必须立刻抛出去，
                     *   不许因为"写台账慢"而把一次判据拒绝变成一次等待。）
                     */
                    const frictionMessage = `create_task rejected: ${dispatchGates.blockers.join('; ')}`;
                    void recordFriction({
                        stateRoot,
                        /** ★ t87：采集层写失败的告警出口（旁路；见 FrictionCapture.warn）。 */
                        warn: (message) => ctx.logger.warn(message),
                        point: 'dispatch',
                        message: frictionMessage,
                        context: dispatchContext,
                        mechanismState: { inputSurface: dispatchSurface, gates: dispatchGates },
                        session: captain.session,
                        taskId: task.id,
                        teamId: team.id,
                        tool: 'create_task',
                        /**
                         * ★★★ t91：这条是**自动记录**的 —— 本分支就是拒绝路径
                         *   （判据拒绝的那一下没有人做过决定 ⇒ 它没有 `resolution.state` 是设计如此）。
                         *   ⇒ 声明出来，分诊器才不会把它算进「台账待回填」。
                         *
                         * ★★ 工具名与**契约位那条**同源（`rejectOnContractGates` 的 `what` = `create_task`）：
                         *   同一个工具在两个插入点上必须用**同一个名字**，否则分诊器会把同一件事
                         *   读成两件事（而"两处各拼一遍"正是本仓反复记账的分叉形态）。
                         */
                        auto: {
                            tool: 'create_task',
                            point: 'dispatch',
                            ...gateIdFromMessage(frictionMessage) === undefined ? {} : { gate: gateIdFromMessage(frictionMessage) },
                        },
                    }).then((id) => {
                        if (id === undefined)
                            ctx.logger.warn(`agent-teams: could not record the friction at the dispatch gate (${frictionMessage})`);
                    });
                    throwWithSurface(frictionMessage, dispatchSurface, 'dispatch_input_surface');
                }
                const dispatchVerdict = dispatchSurface === undefined ? {} : { dispatch_input_surface: dispatchSurface };
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
                    /**
                     * ── ★★ t81 修正：只 spread **schema 声明过的那一格** ─────────────────────────
                     *
                     * MEASURED（t81 实测打红 `gate-task-model-binding.test.mjs` 臂 8）：
                     *   本处此前 spread **整个** `contractGateSurface`。而 t81 给那个返回值
                     *   **新增了 `gates` 一格**（为了让契约裁决能落盘）⇒ 它会**原样漏进工具返回值**
                     *   ⇒ 撞上 `additionalProperties: false`：
                     *   `'"value.gates" is not a declared property'`。
                     *
                     * ★★ 这是**真缺陷**、不是夹具过严：`gates` 是**内部实现细节**
                     *   （给落盘用的），**不是**这个工具的对外契约 ⇒ 不该出现在 output 里。
                     * ★ 修法：**显式只取声明过的那一格**，而不是 spread 整个对象 ——
                     *   以后返回值再加内部字段也不会自动漏出去。
                     */
                    ...contractGateSurface === undefined ? {} : { input_surface: contractGateSurface.input_surface },
                    ...task.assignee !== undefined ? { assignee: task.assignee } : {},
                    ...contractRuntimeRecord === undefined ? {} : { runtime_gates: contractRuntimeRecord },
                    /**
                     * ★★★ t39：`dispatch` 那一格的求值结论 —— 在**锁内**求值，随返回值交出去。
                     *
                     * ★ 为什么在锁内：判据读的是 `ctx.task.reviewed`，而那必须是**这一条任务
                     *   刚写下去的那一格**（锁外读会与锁内的那一条分叉）。
                     */
                    ...dispatchVerdict,
                    /**
                     * ── ★★★ t14：把绑定的**回读 + 传播读数**交出去 ─────────────────────────────
                     *
                     * ★ 三态，而三者**互不同形**：
                     *   · 新建/重绑**声明了**绑定 ⇒ `model_binding` 在场（带 `enforced` 读数）
                     *   · **没声明**             ⇒ 这一格**缺席**（不写 `null` —— 那与"声明了空"同形）
                     *   · **改绑定被拒**         ⇒ `model_binding_refused` 在场（code + reason）
                     *
                     * ★★ 为什么拒绝那条**走不到这里**（见下面 `catch` 之外的设计）：拒绝是
                     *   **抛出去的**，所以调用方在异常上拿到它 —— 而"抛"与"静默返回"的区别
                     *   正是本契约第五格要钉的东西。这一格留在 schema 里，是因为
                     *   `additionalProperties: false` 要求**声明面与产出面一致**，
                     *   而拒绝形状是宿主跨边界搬运 `model_binding_refused` 时的声明。
                     */
                    ...bindingOutcome === undefined ? {} : { model_binding: bindingOutcome },
                };
            });
            await scheduler.kickTeam(workspace, team.id, captain);
            return created;
        },
    })));
}
