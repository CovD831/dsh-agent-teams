// ── src/tools/update-task.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。
import { appendTeamEvent, captainSessionOf } from "../events.js";
/**
 * ── ★★★ kind 需求表的**同步**读取（t54）─────────────────────────────────────────
 *
 * ★ 为什么在这里而不在 `shared/entities.ts`：`update-task.ts` 是 completion 位置
 *   **唯一**的求值点（`registry.evaluate('completion', …)` 全仓只有一处），
 *   而 t54 的 inScope 正好包含它。
 *
 * ★ 为什么**同步**：`appliesTo` 是同步契约，而 kind 守卫住在那里
 *   （`verify-command` 的 `appliesTo` 不读表，所以它那格可以异步；这张表不行）。
 *
 * ★ 为什么**每次读、不缓存**：缓存会让"改表"在下一次**进程重启**前不生效 ——
 *   而那正是 t53/t54 要消灭的东西（改它读的东西不该需要换进程）。
 *
 * ★ 四态**互不同形**（`absent` / `malformed` 在这里判，`loaded` / `kind-unknown`
 *   由判据层判）⇒ 后三者让门降级成 `unmeasured`，**绝不静默退化成"不需要门"**。
 */
function loadKindRequirementsSync() {
    /**
     * ★★ MEASURED（我在夹具里当场撞到）：这里原本写的是 `__dirname` ——
     *   而它是 **CJS** 的变量，在 ESM 模块里**不存在** ⇒ 运行到这一行就
     *   `ReferenceError: __dirname is not defined`。
     *
     * ★ 形态：**它能编过、也能 build，只在真的执行到那一行时才炸** ——
     *   而那正好是"读表"这条路径 ⇒ 每一个走到它的任务都会失败。
     *   ⇒ 与 t53 那条 `loadVerifyCommandRules` 用的是同一条正确写法：
     *     `dirname(fileURLToPath(import.meta.url))`。
     */
    /**
     * ★★ MEASURED（第二个我只能靠【跑】才发现的错）：层数错了。
     *
     *   本文件是 `src/tools/update-task.ts` ⇒ 构建后是 `lib/tools/update-task.js`
     *   ⇒ `here = <root>/lib/tools`。
     *   ⇒ 到仓库根要 `..` **两次**（`lib/tools` → `lib` → 根），
     *     候选 2 到 `src/` 要**三次**。
     *
     *   ★ 而我第一版照抄了 t53 的层数 —— 那一条在 `lib/tools/shared/entities.js`
     *     （**深一层**）⇒ 它 `..` 两次到根，本文件 `..` 两次才到 `lib`。
     *     ⇒ **两条候选路径都不存在** ⇒ 读表恒 `absent` ⇒ 每条走到完工门的任务
     *       都会拿到 unmeasured（而不是它该得的裁决）。
     *
     * ★ 形态（与 `__dirname` 那条同类）：**编得过、build 得过、typecheck 过得** ——
     *   只有**真的执行到那一行**才现形。而"照抄一份看着一样的代码"是它的成因。
     * ★ 判别动作：**抄路径常量之前，先数一遍自己在哪一层。**
     */
    const here = dirname(fileURLToPath(import.meta.url));
    /**
     * ★★ 层数是**数出来**的，不是抄来的（见上面那段）：
     *
     *     here = <root>/lib/tools
     *     <root>/lib/gates/completion/…  ⇒ `..` × 1（tools → lib）
     *     <root>/src/gates/completion/…  ⇒ `..` × 2（tools → lib → root）
     *
     * ★ 而第一条**当下不存在**（`tsc` 不复制 `.json`，与 t53 的同一个事实）——
     *   它留在那里是为了"哪天构建把 JSON 带过来了"那一刻自动生效，
     *   而**第二条是此刻真正起作用的那条**。
     */
    const candidates = [
        join(here, '..', 'gates', 'completion', 'kind-requirements.json'),
        join(here, '..', '..', 'src', 'gates', 'completion', 'kind-requirements.json'),
        /**
         * ── ★★ 第三条：从 **cwd** 找（MEASURED，且它是第三个"只有跑才现形"的错）──────
         *
         * ★ 成因：`gate-readout-uniform` 把源码 **bundle 到一个临时目录**再 import ——
         *   于是 `import.meta.url` 指向那个临时目录，前两条候选**都不存在**
         *   ⇒ 表读成 `absent` ⇒ 三条门全 `appliesTo===false` ⇒ 位置级 `checked:0, skipped:4`。
         *
         * ★ 形态（与前两个同类，但这次是**位置被搬走**而不是算错）：
         *   「路径**相对谁**」这件事，在"文件被搬到别处运行"时会失效；
         *   而它编得过、build 得过，**只有那种运行方式**才现形。
         *
         * ★ 为什么 `cwd` 是对的补充（而不是"碰运气"）：数据文件是**插件自己的**，
         *   而插件的根就是**跑它的那个工作目录**（`pnpm test` / `node --test` 都从仓库根跑）。
         *   ★ 而它排在前两条**之后**：那两条是"跟着模块走"（更精确），
         *     这一条是"跟着调用方走"（更鲁棒）。⇒ 精确的优先，鲁棒的兜底。
         */
        join(process.cwd(), 'src', 'gates', 'completion', 'kind-requirements.json'),
    ];
    let lastError = '';
    for (const candidate of candidates) {
        try {
            return parseKindRequirements(JSON.parse(readFileSync(candidate, 'utf8')));
        }
        catch (error) {
            lastError = `${candidate}: ${String(error?.message ?? error)}`;
        }
    }
    return { status: 'absent', reason: `the kind-requirements table could not be read from any known location (${lastError})` };
}
/**
 * ── ★★ t67：问表「这个 kind 要求哪些门」—— 而**答不出来时返回 `undefined`** ──────
 *
 * 它是给 {@link traceEvidenceConsumer} 用的那一格输入。
 *
 * ★ `undefined` 的三种成因（表读不到 / 表坏 / 表里没有这个 kind）**都必须落 undefined**：
 *   "我问不出这个 kind 要什么门"与"它不要任何门"是**两件事** ——
 *   后者会让 `produced`（生产了、没人读）被误报成 `consumed`（有人读）。
 *   ⇒ 而那是一句**反过来的假结论**：把缺陷说成正常。
 *
 * ★ 而它与判据层那条纪律逐字对齐（`kind-requirements.ts` 的四态：
 *   `absent` / `malformed` / `kind-unknown` 让门降级成 `unmeasured`，
 *   **绝不静默退化成"不需要门"**）。
 */
function requiredGateIdsFor(kind) {
    const load = loadKindRequirementsSync();
    if (load.status !== 'loaded')
        return undefined;
    const requirement = typeof kind === 'string' ? load.requirements.byKind.get(kind) : undefined;
    if (requirement === undefined)
        return undefined;
    return requirement.requiredGates;
}
import { registry } from "../gates/index.js";
import { observedChangedPaths } from "../harness-compat.js";
import { mailboxPrompt } from "../mailbox.js";
import { appendTaskEvidence, repairCompletionVerdict, traceEvidenceConsumer } from "../quality-gates.js";
import { TERMINAL_TASK_STATUSES } from "../types.js";
import { defineTool } from '@deepseek-ai/dsh-tools';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
/**
 * ★ t54：kind 需求表的**校验器**从判据那边借来（它是纯函数，不读盘）。
 * ★ 方向不会成环：`r5.ts` 只 import `../registry.ts` / `../requires.ts`。
 */
import { parseKindRequirements } from "../gates/completion/kind-requirements.js";
import { changedLineNumbers, deriveScanDirs, diagnosticFields, evaluateRuntimeGates, mergeRerunIntoCommandsRun, observeMemberActivity, recordFriction, requireCaptain, requireFreshParticipant, requireParticipantTeam, requireTask, resolveBaseRevision, stateRootOf, teamLockKey, throwWithSurface, withInputSurfaceOnError, workspaceOf, } from "./shared/entities.js";
import { wireDispatch } from "./update-task/dispatch.js";
import { wireCompletion } from "./update-task/completion.js";
import { CAPTAIN_KEY, appendMailbox, createMessage, evaluateQualityCompletion, markMailboxDelivered, normalizeBlankOptionalTaskFields, transitionError, withTeamLock, writeTeam } from "../state.js";
import { steerCaptainReport } from "../tools.js";
import { applyQualityFollowUp, parseAcceptanceResults, parseCommandResults, parseFindings } from "./shared/entities.js";
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx, clock, runtime, scheduler, config) {
    ctx.tools.register(withInputSurfaceOnError(defineTool({
        name: 'agent_teams_update_task',
        description: 'Update a task status/output. Members must supply the current attempt_id returned by claim_task; stale attempts are rejected after takeover/reassignment. Terminal results are immutable, but owners and the captain can append acceptanceResults/commandsRun/evidence_note as attributed supplemental evidence, without reclaiming or changing the verdict. A captain must use reassign_task(assignee="captain") before updating active member-owned work.',
        parameters: {
            task_id: { type: 'string', required: true, description: 'The task id to update.' },
            attempt_id: { type: 'string', description: 'Members must explicitly include the current attempt_id from their assignment/claim in EVERY update, including failed reviews with findings. If omitted, retry with the same current id; omission does not revoke the attempt.' },
            status: {
                type: 'string',
                enum: ['in_progress', 'completed', 'failed', 'cancelled'],
                description: 'New status (in_progress, completed, failed, cancelled).',
            },
            output: { type: 'string', description: 'Original result summary; immutable after completion/failure.' },
            evidence_note: { type: 'string', description: 'Append-only supplementary observation on a terminal task. Does not reopen work or change the original result.' },
            verdict: {
                type: 'string',
                enum: ['pass', 'needs_revision', 'reject'],
                description: 'Required for completing requirements/review. needs_revision and reject must fail the task.',
            },
            findings: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        id: { type: 'string', required: true },
                        severity: { type: 'string', enum: ['low', 'medium', 'high', 'blocker'], required: true },
                        problem: { type: 'string', required: true },
                        requiredFix: { type: 'string', required: true },
                        file: { type: 'string' },
                        line: { type: 'number' },
                        resolved: { type: 'boolean' },
                    },
                },
                description: 'Structured review findings. Required when verdict is needs_revision or reject; each item needs id, severity, problem, and requiredFix.',
            },
            changedPaths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Workspace-relative POSIX paths changed by this implementation/repair.',
            },
            acceptanceResults: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        criterion: { type: 'string', required: true },
                        status: { type: 'string', enum: ['passed', 'failed'], required: true },
                        evidence: { type: 'string' },
                    },
                },
                description: 'Acceptance evidence in contract order: {criterion, status:"passed"|"failed", evidence?}. Supply one item per acceptance criterion.',
            },
            commandsRun: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        command: { type: 'string', required: true },
                        status: { type: 'string', enum: ['passed', 'failed'], required: true },
                        exitCode: { type: 'number' },
                        evidence: { type: 'string' },
                    },
                },
                description: 'Verification evidence in contract order: {command, status:"passed"|"failed", exitCode?, evidence?}. Supply one item per verify command.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    /**
                     * ★★ t14：`update_task` 是**唯一**穿过两个位置的工具，所以它挂的是
                     *   两格**位置名**（`dispatch_input_surface` / `completion_input_surface`）
                     *   —— 那正是"哪一个位置缺哪一格"读得出来的依据（见
                     *   `withInputSurfaceOnError` 的 `field` 参数）。
                     *
                     * ★ 它**不挂**泛用的 `input_surface`：成功路径上这个工具从不产出它
                     *   （在 `execute` 的返回对象里可以逐个字段核）。⇒ schema 也不许声明它，
                     *   否则"这个工具会返回这个字段"与"它从来不返回"在声明面同形 ——
                     *   而那正是本任务要消灭的形状。拒绝路径上边界**会**补一个泛用名，
                     *   但那次调用已经失败了，走的是 `error` 而不是工具结果值。
                     */
                    ...diagnosticFields({ runtimeGates: true, dispatchInputSurface: true, completionInputSurface: true }),
                    task_id: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    output: { type: 'string' },
                    attempt: { type: 'number', required: true },
                    attempt_id: { type: 'string' },
                    evidence_count: { type: 'number' },
                    follow_up: { type: 'string' },
                },
            },
            render: (args, value) => [{
                    type: 'text',
                    text: `Task ${value.task_id} attempt ${value.attempt} → ${value.status}${value.output !== undefined ? `\nOutput: ${value.output}` : ''}${value.evidence_count === undefined ? '' : `\nSupplemental evidence records: ${value.evidence_count}. Original result unchanged.`}${value.follow_up ? `\n${value.follow_up}` : ''}`,
                }],
        },
        async execute(args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireParticipantTeam(workspace, config, caller);
            let followUpMessage;
            const updated = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id);
                const task = requireTask(fresh, args.task_id);
                if (identity.kind === 'captain'
                    && task.assignee !== undefined
                    && task.assignee !== CAPTAIN_KEY
                    && !TERMINAL_TASK_STATUSES.includes(task.status)
                    && !(args.status === 'cancelled' && task.status === 'pending' && (task.attempt ?? 0) === 0 && task.reassigning !== true)) {
                    throw new Error(`task ${task.id} is owned by member "${task.assignee}"; call agent_teams_reassign_task with assignee="captain" before takeover`);
                }
                if (identity.kind === 'member') {
                    if (task.assignee !== identity.name) {
                        throw new Error(`task ${task.id} is assigned to "${task.assignee ?? 'nobody'}", not you`);
                    }
                    if (task.attemptId !== undefined && (args.attempt_id === undefined || args.attempt_id.trim() === '')) {
                        throw new Error(`missing attempt_id for task ${task.id}. Retry this update with attempt_id="${task.attemptId}" from your current assignment. This is a missing parameter, not a revoked attempt; do not restart the work or request reassignment.`);
                    }
                    if (task.attemptId !== undefined && args.attempt_id !== task.attemptId) {
                        throw new Error(`stale attempt for task ${task.id}: expected the current attempt_id; stop work and request fresh assignment`);
                    }
                }
                if (TERMINAL_TASK_STATUSES.includes(task.status)) {
                    const appended = appendTaskEvidence(task, {
                        ...args, findings: parseFindings(args.findings), changedPaths: normalizeBlankOptionalTaskFields(args).changedPaths,
                        acceptanceResults: parseAcceptanceResults(args.acceptanceResults), commandsRun: parseCommandResults(args.commandsRun),
                    }, identity.name);
                    if (appended)
                        await writeTeam(stateRoot, fresh);
                    return {
                        evidence_count: task.supplementalEvidence?.length ?? 0,
                        task_id: task.id,
                        status: task.status,
                        attempt: task.attempt ?? 0,
                        ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
                        ...task.output !== undefined ? { output: task.output } : {},
                    };
                }
                if (args.evidence_note?.trim())
                    throw new Error('evidence_note is for terminal tasks; record active work with output and structured evidence');
                // Blank optional list entries (e.g. changedPaths:[""]) must not be
                // persisted: hasValidQualityTaskFields rejects them on reload and
                // would brick the whole team state (issue #105 class).
                const input = normalizeBlankOptionalTaskFields(args);
                const findings = parseFindings(args.findings);
                const acceptanceResults = parseAcceptanceResults(args.acceptanceResults);
                const commandsRun = parseCommandResults(args.commandsRun);
                /**
                 * ── ★ 判据层（可插拔）────────────────────────────────────────────────────
                 *
                 * 这一段此前【硬编码】了"重跑 verify"这一条判据。现在它只是
                 * `registry.evaluate('completion', ...)` 的一次调用 —— 编排层不知道
                 * 那个位置挂了哪些判据、也不知道它们的语义（契约 `docs/GATE-REGISTRY.md` §8）。
                 *
                 * ⇒ 换/加/删判据 = 改 `src/gates/index.mjs` 的清单一行，**不碰本文件**。
                 *
                 * 执行器在这里注入（本文件是这一层唯一做 I/O 的地方；判据本身是纯数据变换）。
                 * 只在【非终态 → completed】时给出执行器：终态补证据（issue159）不是新的
                 * 完成裁决。判据自己 `appliesTo` 也会跳过那种情形 —— 两处都表达同一条边界，
                 * 是因为执行器缺席这条路径也必须能被审计。
                 */
                /**
                 * ── ★ 归属证据：这个成员【真的写过】哪些文件 ─────────────────────────────
                 *
                 * `dispatch.changed-paths` 需要"自报的 changedPaths 与真实写入是否对得上"。
                 * 真相来自该成员自己的会话事件（dsh-tool-fs 挂在 tool/result 上的 meta.diffs），
                 * 经 `observedChangedPaths(caller.session)` 折叠成一组路径。
                 *
                 * ★ 这正是 START-HERE §5③ 那个"共同障碍"的解法：git 只知道工作区脏了，
                 *   而会话事件是逐成员的 ⇒ 不需要 worktree，也不需要改 cwd（§5②）。
                 *
                 * ★ 队长代报（caller 是队长）时拿不到成员会话 ⇒ 观察缺席 ⇒ 判据 unmeasured，
                 *   而不是被当成通过。这是刻意的：没能观察就不能声称它诚实。
                 */
                /**
                 * ★ 输入面核对（t10）：**求值之前**，按每条判据声明的 `requires` 核对这份
                 *   真实 ctx。★ 它是**旁路数据** —— 下面的拒绝逻辑一个字都不看它：
                 *   核对报缺时流程照常走完（先软后硬，用户裁定）。见 {@link auditGateRequires}。
                 *
                 * ★ 这份 ctx 是【构造一次、用两次】的同一个对象（核对一次、求值一次）：
                 *   写成两份字面量会让"核对的 ctx"与"求值的 ctx"在多一次改动之后分叉，
                 *   而分叉之后核对结果会变成关于**另一份 ctx** 的结论 —— 它读起来完全正常。
                 */
                /**
                 * ── ★★★ t70：dispatch 那一整段已搬到 `./update-task/dispatch.ts` ────────────
                 * ★ 搬运**逐字**：`gate-update-task-injections` 逐条断言那 4 格注入仍在、
                 *   且**右侧表达式逐字相同**（★ 那条护栏第一次实战就抓到我改了右侧）。
                 */
                const dispatchWiring = await wireDispatch({
                    task,
                    changedPaths: input.changedPaths,
                    caller: caller,
                    workspace,
                    registry: registry,
                });
                const dispatchContext = dispatchWiring.context;
                const dispatchInputSurface = dispatchWiring.inputSurface;
                const dispatchGates = dispatchWiring.gates;
                /**
                 * ── ★ runtime 位置（跨步骤的过程约束，契约 §5）───────────────────────────
                 *
                 * 成员开始干活 + 改契约/建任务之后，把"这一步发生过"交给 runtime 判据。
                 * ★ 它返回任何裁决都【不得阻止流程】—— 上面 dispatch 位置的拒绝逻辑在本
                 *   调用点之后照常执行，本调用点对控制流零影响。理由见 `evaluateRuntimeGates`。
                 */
                let runtimeGateRecord = await evaluateRuntimeGates(ctx, 'task-update', {
                    team: fresh,
                    task,
                    update: { status: args.status, output: args.output, verdict: args.verdict },
                    updateGate: dispatchGates,
                    wantsCompleted: args.status === 'completed',
                }, clock);
                if (dispatchGates.ok === false) {
                    /**
                     * ★★ t22：在卡点发生的此刻记账（含 ctx 快照 + 事件定位 + 机制状态）。
                     *   与 contract 那处同一条纪律：**旁路、不改裁决、失败只写 warn**。
                     */
                    const frictionMessage = dispatchGates.unmeasured !== undefined
                        ? `update_task rejected: the dispatch gate could not measure (${dispatchGates.unmeasured})`
                        : `update_task rejected: ${dispatchGates.blockers.join('; ')}`;
                    void recordFriction({
                        stateRoot,
                        point: 'dispatch',
                        message: frictionMessage,
                        context: dispatchContext,
                        mechanismState: { inputSurface: dispatchInputSurface, gates: dispatchGates },
                        session: caller.session,
                        taskId: task.id,
                        teamId: team.id,
                        tool: 'agent_teams_update_task',
                        ...dispatchGates.unmeasured === undefined ? {} : { couldNotObserve: [String(dispatchGates.unmeasured)] },
                    }).then((id) => {
                        if (id === undefined)
                            ctx.logger.warn(`agent-teams: could not record the friction at the dispatch gate (${frictionMessage})`);
                    });
                    if (dispatchGates.unmeasured !== undefined) {
                        /**
                         * ★ 未测量与"发现问题"不同形（§3.4）。措辞必须分开 —— 读日志的人要能
                         *   看出"判据没能测量"，而不是"判据发现了问题"。
                         */
                        throwWithSurface(frictionMessage, dispatchInputSurface, 'dispatch_input_surface');
                    }
                    throwWithSurface(frictionMessage, dispatchInputSurface, 'dispatch_input_surface');
                }
                /**
                 * ★ 输入面缺格 ⇒ **只说、不拒**（先软后硬）。它放在上面的拒绝逻辑【之后】，
                 *   不是为了顺序好看：放在之前会让"核对报缺"看起来像拒绝的理由，
                 *   而本机制的裁决权是零。措辞与判据的 `unmeasured` 不同形 ——
                 *   那是"判据测不了"，这是"调用方没把这一格交出去"。
                 *
                 * ★★ t3：这条日志**保留**（给人看）；结构化出口本体在下面返回值的
                 *   `input_surface` 里（`dispatchInputSurface`）。两条并存，缺一不可。
                 */
                if (dispatchInputSurface !== undefined && dispatchInputSurface.incomplete > 0) {
                    ctx.logger.warn(`agent-teams: update_task reached the dispatch gate with an unfinished input surface (recorded, not rejected): ${dispatchInputSurface.missing.join('; ')}`);
                }
                /**
                 * ── ★ 注入面：让每条判据拿到它声明的输入（缺则缺席，不注入空值）─────────
                 *
                 * 每一项都只做【读】。拿不到 ⇒ 该字段不出现在 ctx 里 ⇒ 判据自己说
                 * "我没能测量"。**绝不在这里替判据决定"那就算通过"。**
                 */
                const changedFiles = input.changedPaths ?? task.changedPaths ?? [];
                /**
                 * ★ t18：这里与 `baseline` 用**同一个解析**（内存 → 落盘 → 明确没有）。
                 *   理由：`parentRevision` 喂给 R5（红前绿后），它与回测问的是同一件事
                 *   ——"改动之前的那个版本是什么"。两处若用不同来源，会出现
                 *   「R5 说父版本是 A、回测说基线是 B」这种自相矛盾，而它在日志里同形。
                 */
                const baseResolutionForLines = resolveBaseRevision(task);
                const worktreeBase = baseResolutionForLines.kind === 'resolved' ? baseResolutionForLines.revision : undefined;
                const [changedLines, observedFiles] = await Promise.all([
                    changedLineNumbers(workspace, worktreeBase),
                    Promise.resolve(observedChangedPaths(caller.session)),
                ]);
                /**
                 * `newTestFiles`：本任务【新增】的测试文件。
                 *
                 * 来源是会话事件里观察到的写入（与 dispatch.changed-paths 同一入口），
                 * 取那些"在声明范围内、且看起来是测试"的路径。
                 * ★ 观察不到（`undefined`）⇒ 不注入 ⇒ r5 的 appliesTo 为假 ⇒ skipped。
                 *   这与"观察到了、确实没有新测试"（`[]`）不同形 —— 后者仍是 skipped
                 *   （没有测试就没有红前绿后可测），但成因不同，判据自己会表达。
                 */
                /**
                 * `newTestFiles`：本任务【新增】的测试文件。
                 *
                 * 来源是会话事件里观察到的写入（与 dispatch.changed-paths 同一入口），
                 * 取那些看起来是测试的路径。
                 *
                 * ★ 只在【这一次确实试图置为 completed】时注入 —— 这是刻意的调用方纪律，
                 *   与 `execVerifyCommand` 的既有先例一致（那条也只在"非终态 → completed"
                 *   时给出执行器）。
                 *
                 * 由来（MEASURED，2026-10-05，t7）：`completion.r5` 的 `appliesTo` 只问
                 * `kind ∈ {implementation, repair}` 与 `newTestFiles` 是否为数组，**不看
                 * 完成意图** —— 而它的三条兄弟判据（verify-rerun / mutation / backtest）
                 * 都带 `wantsCompleted === true` 守卫。实测：
                 *
                 *     r5.appliesTo({ kind:'implementation', newTestFiles:[…], wantsCompleted:false }) ⇒ true
                 *
                 * 于是"成员开始干活"（in_progress）那一步也会被"红前绿后"审判，而那时
                 * 父版本/扫描范围都还没有 ⇒ 一条【开始工作】的更新被 rejected。
                 * 这个缺陷此前被"newTestFiles 永不注入"掩盖着（r5 恒 skipped），注入面一补齐
                 * 就露出来。⇒ 在这里收口：不把"有没有新测试"这件事在非完成更新里提出去，
                 * 于是 r5 在那些更新上按自己的契约 skipped，与三条兄弟判据行为一致。
                 *
                 * ★ 观察不到写入（`undefined`）⇒ 不注入（不是注入 `[]`）—— 缺席意味着
                 *   "我没能观察"，而 `[]` 意味着"观察了、确实没有新测试"。两者不同形。
                 */
                const isTestPath = (path) => /(^|\/)(test|tests|__tests__)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
                /** 观察到的测试文件（杀变异体用）—— 与"本次新增"无关，既有的也算。 */
                const observedTestFiles = observedFiles === undefined ? undefined : observedFiles.filter(isTestPath);
                const newTestFiles = args.status !== 'completed' || observedTestFiles === undefined
                    ? undefined
                    : observedTestFiles;
                /**
                 * ── ★★ 判别力证据：把 t31 的修法接到真实路径（t33 / f-0020 的最后一格）─────
                 *
                 * ── 缺口是什么（integrator6 报，captain 核实）─────────────────────────────
                 *
                 * `repairEvidenceFiles` / `repairCompletionVerdict`（`quality-gates.ts`）
                 * 修好了一件事：**repair 的判别力证据来自"改动过的既有夹具"，而不是"新增的测试"**
                 * —— 对 repair 而言后者恒为空集，于是 r5 恒报
                 * `none of the 0 reported file(s)` ⇒ **恒 unmeasured ⇒ repair 永远交不出终态**。
                 *
                 * ★ 但那两个函数**零调用方**（除它们自己的夹具外）。integrator6 的原话：
                 *   「**一个没有调用方的修法，与没有修法在观测上完全相同。**」
                 *   ⇒ 它把缺口如实写成臂 9，而不是用"夹具 10/10 绿"冒充已修好。
                 *
                 * ── 接线的口径（**不是**"让 r5 变宽松"）──────────────────────────────────
                 *
                 * 判据问的仍然是同一个问题：「**这条夹具还能不能抓住缺陷**」。
                 * 变的只是**拿哪些文件去问**：
                 *
                 *     旧：本次【新增】的测试文件  ⇒ 对 repair 恒空 ⇒ 恒 unmeasured
                 *     新：本次【改动过的既有夹具】⇒ repair 的真实证据 ⇒ 可测量
                 *
                 * ★ 而"装饰性测试"这一路**一步都没让**：一条恒绿的既有夹具同样过不了 r5
                 *   （它在父版本上就绿 ⇒ `decorative test` 拒绝）。见夹具臂 3 与臂 4。
                 *
                 * ── 三态：与 `newTestFiles` 同一纪律 ──────────────────────────────────────
                 *
                 * ★ 只在【非终态 → completed】时给出（与 `execVerifyCommand` / `newTestFiles`
                 *   的既有先例一致）—— 否则"成员开始干活"那一步也会被"红前绿后"审判。
                 *
                 * ★★ 但它**不**以"会话观察到了写入"为条件 —— 这一点是本任务的要害（t33 实测）：
                 *
                 *   `repairEvidenceFiles` 读的是**任务契约**（`update.changedPaths` /
                 *   `task.changedPaths`），**不是**会话事件。⇒ 会话观察缺席时它照样答得出来，
                 *   而那**正是** f-0020 的场景：repair 的净改动落在既有夹具上，
                 *   而"这个成员写过它"这件事未必在会话事件里。
                 *
                 *   MEASURED（t33 第一版写错了）：我原先把它 guard 在
                 *   `observedFiles === undefined` 上 ⇒ 与 `newTestFiles` **同一个条件**
                 *   ⇒ 两者一起为空 ⇒ r5 仍报 "none of the 0 reported file(s)"
                 *   ⇒ **接线等于没接**（定向突变实测：去掉接线后臂照样绿）。
                 *   ★ 形态：把新口径挂到旧口径的闸门上，于是它继承了旧口径的盲区。
                 */
                const repairEvidence = args.status !== 'completed'
                    ? undefined
                    : repairCompletionVerdict({
                        task: { id: task.id, kind: task.kind, inScope: task.inScope, changedPaths: changedFiles },
                        update: {
                            changedPaths: input.changedPaths,
                            ...observedTestFiles === undefined ? {} : { newTestFiles: observedTestFiles },
                        },
                    });
                /**
                 * ★ 把两格**合并**成 r5 要的那一格，且合并规则是刻意的：
                 *   · `newTestFiles` 是"本次观察到的测试写入"（既有口径，**保留**）；
                 *   · `repairEvidence` 是"改动过的既有夹具里**还能判别**的那些"（新增口径）。
                 *   ⇒ 取**并集**并排序。取交集会让任一侧单独成立的情形丢失；
                 *     只取后者会让 implementation 类的既有行为改变（那不是本任务该动的）。
                 *
                 * ★ 而 `repairEvidenceFiles` **本身**已做筛选（是测试夹具、落在写域里、
                 *   去重排序），所以这里不再筛第二遍 —— 两处筛选会慢慢分叉，而分叉之后
                 *   "r5 看到的文件"与"quality-gates 认为的证据"不再同形。
                 */
                const discriminatingFiles = repairEvidence === undefined || repairEvidence.ok === false
                    ? newTestFiles
                    : observedTestFiles === undefined
                        ? repairEvidence.evidence
                        : [...new Set([...observedTestFiles, ...repairEvidence.evidence])].sort();
                /**
                 * ★ `repairEvidence.ok === false` 时**不把它并进拒绝**：它是 unmeasured
                 *   （"没能测量"），而本调用点的裁决由 r5/mutation 自己说 ——
                 *   在这里抢先拒绝会让"没测到"伪装成"发现了问题"（反向的同一类错误）。
                 */
                if (repairEvidence !== undefined && repairEvidence.ok === false) {
                    ctx.logger.warn(`agent-teams: repair completion evidence is unmeasured (recorded, not rejected): ${repairEvidence.unmeasured}`);
                }
                /**
                 * ── ★★★ t67：`killerSuites` 的文件清单 = 两条供给链的并集 ─────────────────
                 *
                 * MEASURED（本任务复现）：t54 之后，`discriminatingFiles` 的唯一消费者
                 * （r5）对 repair 不再生效 ⇒ 那条证据**没人读**；而 mutation（repair
                 * **要求**的门）读的 `killerSuites` 此前只来自 **会话事件**。
                 * 于是在 f-0020 那个形状里（会话观察缺席）：
                 *
                 *     repairEvidence  从**任务契约**读出了那份夹具 ⇒ 喂给 newTestFiles ⇒ 没人读
                 *     observedTestFiles 缺席                        ⇒ killerSuites 不注入 ⇒ mutation 空手
                 *
                 * ⇒ 证据落在没人读的那一格，而**该读它的那一格**空着。
                 *
                 * ── 三态，且**与原来那条纪律逐条对齐** ──────────────────────────────────
                 *
                 *   `undefined` —— ★ 两条链**都没能观察**（会话读不到 **且** 契约没给出）
                 *                  ⇒ 不注入 ⇒ mutation 自己报 unmeasured。**不猜、不回退到全套。**
                 *   `[]`        —— 两条链都观察到了、**确实没有**可用的套件
                 *                  ⇒ 不注入（理由同上：空清单不是"用一个空集去杀变异体"）
                 *   `[...]`     —— 并集，去重排序
                 *
                 * ★ 而"两条链都没能观察"与"确实没有"在这里**同形地被处理**（都不注入）——
                 *   那不是合流：判据那一侧对"没注入"给出的**是同一句话**（unmeasured），
                 *   而它是对的那句话（这两种情形下它都确实没有可杀的东西）。
                 *   ★ 真正的合流风险在**别处**，本任务把它留在它的原处：
                 *     `repairEvidence.ok === false` 的两种成因（没能观察 / 观察到了、确实没有）
                 *     在 `repairCompletionVerdict` 里是**两句不同的话**，而上面那条 warn 照旧打出。
                 */
                const killerSuiteFiles = observedTestFiles === undefined && (repairEvidence === undefined || repairEvidence.ok === false)
                    ? undefined
                    : [...new Set([
                            ...(observedTestFiles ?? []),
                            ...(repairEvidence !== undefined && repairEvidence.ok === true ? repairEvidence.evidence : []),
                        ])].sort();
                /**
                 * ── ★★★ t67：把"这份证据有没有人读"变成一条**可读的**读数 ─────────────────
                 *
                 * MEASURED：`discriminatingFiles` 被生产出来、而 t54 之后它在 repair 上
                 * **没有消费者** —— 而那是**沉默的**：没有任何一行日志会说这件事。
                 * ⇒ 下一个会话只会看到 `repairEvidence.ok === true`，然后以为一切正常。
                 *
                 * ★ 所以这里在**生产出证据的那一刻**问一次"谁会读它"，并把
                 *   `produced`（生产了、没人读）**记下来**。
                 *
                 * ★★ 而它**不拒绝任何东西**：证据没人读 ≠ 任务做错了（契约明说
                 *   "不会阻断任何任务"）。⇒ 它只 `warn` 一行，与上面那条 unmeasured 的
                 *   warn 同一形状。★ 把"没人读"当拒绝会让**每一个 repair 任务**都失败 ——
                 *   那是把一条**读数**当成了裁决。
                 *
                 * ★ 而这正是它要修的那件事的字面落点：**第二种状态必须可读**。
                 */
                if (discriminatingFiles !== undefined && discriminatingFiles.length > 0) {
                    const reading = traceEvidenceConsumer('newTestFiles', requiredGateIdsFor(task.kind));
                    if (reading.status === 'produced') {
                        ctx.logger.warn(`agent-teams: repair discriminating evidence was produced (${discriminatingFiles.length} file(s)) `
                            + `but nothing consumes it on kind=${task.kind ?? 'work'}: ${reading.detail}. `
                            + 'Recorded, not rejected — produced-and-unconsumed is a supply/consumer fact, not a failure of the work.');
                    }
                }
                /**
                 * ── ★★★ t70：completion 那一整段（271 行）已搬到
                 *    `./update-task/completion.ts` ─────────────────────────────────────────
                 *
                 * ★ 搬运**逐字**被钉住：`gate-update-task-injections` 逐条断言拆前那 17 格
                 *   注入仍在对的位置、且**右侧表达式逐字相同**。
                 *   MEASURED：那条护栏第一次实战就抓到了我自己（我把 dispatch 的
                 *   `changedPaths: input.changedPaths` 顺手改成了 `[...input.changedPaths]`）。
                 *   ⇒ **丢的不是格名，而是格的右侧。**
                 *
                 * ★ 而本段的边界是**数出来的**（271 行：从 `baselineExit` 到求值），
                 *   不是"看着像哪儿断了就在哪儿断"。
                 */
                const completionWiring = await wireCompletion({
                    workspace, task, input, args, changedFiles, changedLines,
                    discriminatingFiles, worktreeBase, repairEvidence, findings,
                    acceptanceResults, commandsRun, newTestFiles, observedTestFiles,
                    killerSuiteFiles, gate: evaluateQualityCompletion, resolveBaseRevision,
                    deriveScanDirs, loadKindRequirementsSync, registry,
                });
                const completionContext = completionWiring.context;
                const completionInputSurface = completionWiring.inputSurface;
                const completionGates = completionWiring.gates;
                /** ★ `wantsCompleted` 在段内算出、而段外还要用 ⇒ 由模块交出来。 */
                const wantsCompleted = completionWiring.wantsCompleted;
                /**
                 * ── ★ t13 的运行时出口：有判据、却一条都没跑 ────────────────────────────
                 *
                 * `evaluated === 0 && registered > 0` 意味着这一轮**没有任何判据真的检查过**
                 * 这个完成动作，而 `ok` 仍为 true。**只告警、不拒绝** —— 拒绝会把"这个位置
                 * 这一轮没有适用判据"（正常情形）变成流程卡死，那正是 t13 明确要求保住的边界。
                 * 但它必须【可读】：否则一次静默全跳过只有 `ok: true` 留给读日志的人。
                 */
                if (completionGates.evaluated === 0 && completionGates.registered > 0) {
                    ctx.logger.warn(`agent-teams: update_task for task "${task.id}" reached completion with no gate evaluated (${completionGates.registered} registered, all skipped); this step was not checked`);
                }
                /**
                 * ★ 输入面缺格 ⇒ **只说、不拒**（先软后硬），放在拒绝逻辑**之前**是因为
                 *   它与下面三个分支讲的不是同一件事，而"这次完成本来会被拒"与"这次完成
                 *   的输入面没接完"必须都能读到 —— 只读到前者会让人以为是判据的结论。
                 *   与 t13 那条（`evaluated === 0`）也**不同形**：那是"判据一条都没跑"，
                 *   这是"判据跑了、而它要的某一格调用方没交"。
                 *
                 * ★★ t3：这条日志**保留**（给人看）；结构化出口本体在下面返回值的
                 *   `input_surface` 里（`completionInputSurface`）。两条并存。
                 */
                if (completionInputSurface !== undefined && completionInputSurface.incomplete > 0) {
                    ctx.logger.warn(`agent-teams: update_task for task "${task.id}" reached completion with an unfinished input surface (recorded, not rejected): ${completionInputSurface.missing.join('; ')}`);
                }
                if (completionGates.ok === false) {
                    /**
                     * ★★ t22：在卡点发生的此刻记账。★ 这一处尤其重要 —— 本轮被它拦住的
                     *   次数最多（三道完工门），而事后补的材料恰恰读不出"当时缺的是哪一格"。
                     */
                    const frictionMessage = completionGates.unmeasured !== undefined
                        ? `update_task rejected: the completion gate could not measure (${completionGates.unmeasured})`
                        : `update_task rejected: ${completionGates.blockers.join('; ')}`;
                    void recordFriction({
                        stateRoot,
                        point: 'completion',
                        message: frictionMessage,
                        context: completionContext,
                        mechanismState: { inputSurface: completionInputSurface, gates: completionGates },
                        session: caller.session,
                        taskId: task.id,
                        teamId: team.id,
                        tool: 'agent_teams_update_task',
                        ...completionGates.unmeasured === undefined ? {} : { couldNotObserve: [String(completionGates.unmeasured)] },
                    }).then((id) => {
                        if (id === undefined)
                            ctx.logger.warn(`agent-teams: could not record the friction at the completion gate (${frictionMessage})`);
                    });
                    if (completionGates.unmeasured !== undefined) {
                        /**
                         * ★ 未测量与"发现问题"不同形（§3.4）。措辞必须分开 —— 读日志的人要能
                         *   看出"判据没能测量"，而不是"判据发现了问题"。
                         */
                        throwWithSurface(frictionMessage, completionInputSurface, 'completion_input_surface');
                    }
                    throwWithSurface(frictionMessage, completionInputSurface, 'completion_input_surface');
                }
                /**
                 * 判据【通过时】交出的产出：把判据层亲眼看到的 exitCode 并回 commandsRun，
                 * 让落盘的是它看到的那个，而不是成员自报的。
                 */
                const producedReruns = (completionGates.outputs['completion.verify-rerun']?.reruns ?? []);
                const mergedCommandsRun = producedReruns.length > 0
                    ? mergeRerunIntoCommandsRun(commandsRun ?? task.commandsRun, producedReruns)
                    : commandsRun;
                const gate = evaluateQualityCompletion(task, {
                    status: args.status,
                    output: args.output,
                    verdict: args.verdict,
                    findings,
                    changedPaths: input.changedPaths,
                    acceptanceResults,
                    commandsRun: mergedCommandsRun ?? commandsRun,
                });
                if (!gate.ok)
                    throw new Error(gate.error ?? 'update_task rejected by quality gates');
                if (args.status !== undefined) {
                    const transition = transitionError(task.status, args.status);
                    if (transition !== undefined)
                        throw new Error(transition);
                    task.status = args.status;
                }
                if (args.output !== undefined)
                    task.output = args.output;
                if (args.verdict !== undefined)
                    task.verdict = args.verdict;
                if (findings !== undefined)
                    task.findings = findings;
                if (input.changedPaths !== undefined)
                    task.changedPaths = input.changedPaths;
                if (acceptanceResults !== undefined)
                    task.acceptanceResults = acceptanceResults;
                if (commandsRun !== undefined)
                    task.commandsRun = commandsRun;
                task.updatedAt = Date.now();
                const priorDependencies = new Map(fresh.tasks.map(item => [item.id, [...item.dependencies]]));
                const followUp = (task.status === 'failed' && (task.verdict === 'needs_revision' || task.verdict === 'reject'))
                    ? applyQualityFollowUp(fresh, task)
                    : undefined;
                let followUpSummary;
                if ((followUp?.created.length ?? 0) > 0) {
                    const rewired = fresh.tasks.filter(item => priorDependencies.has(item.id) && JSON.stringify(priorDependencies.get(item.id)) !== JSON.stringify(item.dependencies));
                    followUpSummary = `Automatic quality follow-up for ${task.id}: ${followUp.created.map(item => `${item.id} (${item.kind}, owner=${item.assignee ?? 'unassigned'}, deps=${item.dependencies.join(',') || 'none'})`).join('; ')}.${rewired.length ? ` Updated dependencies: ${rewired.map(item => `${item.id} -> ${item.dependencies.join(',')}`).join('; ')}.` : ''} Use these tasks; do not create duplicate repair/review work.`;
                    followUpMessage = createMessage(CAPTAIN_KEY, CAPTAIN_KEY, followUpSummary);
                }
                if (followUp?.escalated === true) {
                    await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, createMessage(CAPTAIN_KEY, CAPTAIN_KEY, `Quality-gate loop escalated after ${task.id} (${task.kind ?? 'review'} verdict=${task.verdict}). Automatic repair/review stopped.`));
                }
                await writeTeam(stateRoot, fresh);
                /**
                 * ── ★★ 成员提交一次更新 ⇒ 顺手**读一遍它的会话日志**（这是第二个观察时刻）──
                 *
                 * ── 两个"看起来都行"、而只有一个是错的写法 ─────────────────────────────
                 *
                 * ✗ 错的：把**这次工具调用**当成一次产出（`args.output` 非空 ⇒ 记一次活动）。
                 *   它错得很像对的（"产出当场就在手上，何必去翻日志"），而后果是**关掉判据**：
                 *   一个卡死的成员，只要它的工具还在被调用（重试、心跳、空转），
                 *   `lastActivityAt` 就会被反复刷新 ⇒ 两次探活读数一直在变 ⇒ **永远不报警**。
                 *   而那正是探活存在的全部理由。用户已裁定活动的定义是
                 *   「**以产出为准（有 `assistant/message` 才算在动；`status` 可能因别的原因
                 *   抖动）**」—— 工具参数**不是** `assistant/message`。
                 *
                 * ✓ 对的：在这里**读一次该成员的会话日志**（`observeMemberActivity`），
                 *   与 `observeMemberConvergence` 同源、与探活同一个判据面。**产物仍然是
                 *   `assistant/message`**，所以它不会把"工具被调用"读成"在动"：一个只被
                 *   反复调用工具、却一句话都没说的成员，指纹不变 ⇒ 什么都不记。
                 *
                 * ── 为什么需要这第二个时刻（只留派发 + 探活是不够的）─────────────────────
                 *
                 * 观察时刻越多，活动时刻越**接近真实**。只留两个的话，最坏情形是：
                 *
                 *     成员在 T1..T2 之间一直在产出，而队长直到 T3 才查一次状态
                 *     ⇒ 判据在 T3 才第一次看见那些产出 ⇒ `lastActivityAt = T3`
                 *
                 * 这不是假报警（那一轮反而看不到"没动"），但它是**迟到的观察**：在 T1 与 T3
                 * 之间的任何一次探活，都会把"它其实一直在动"读成"它没动"。而
                 * `agent_teams_update_task` 是**成员每次交进展都会经过的那一步** ——
                 * 用它当观察时刻，代价是一次已有的会话读，换来的是探测精度。
                 *
                 * ★ 它**不能替代**探活时刻：一个成员可能长时间只在写文件、跑命令，
                 *   一条更新都不发 —— 那时只有 `agent_teams_status` 能观察到它。
                 *   两个时刻都要，因为探活问的是"它还在动吗"，而"动"发生在任何时刻。
                 */
                {
                    const activeMember = fresh.members.find(candidate => candidate.name === task.assignee);
                    if (identity.kind === 'member' && activeMember !== undefined && activeMember.id !== '') {
                        observeMemberActivity(ctx, activeMember.id, task.attemptId, clock());
                    }
                }
                /**
                 * ── ★ runtime 位置：这一步【做完了】（契约 §5）───────────────────────────
                 *
                 * 上面的调用点看的是"意图"（`args.status`），这里看的是"结果"（落盘后的 task）。
                 * 两者不同形不是重复：一条运行判据可能想问"这个成员是不是在一个已超时的会话里
                 * 报了完成"—— 而在意图那一刻还看不出来。仍然：**任何裁决都不阻止流程** ——
                 * 状态已经写下去了，本调用点做的事只有记录。
                 */
                runtimeGateRecord = await evaluateRuntimeGates(ctx, 'task-update-settled', {
                    team: fresh,
                    task,
                    update: { status: task.status, output: task.output, verdict: task.verdict },
                    updateGate: completionGates,
                    wantsCompleted,
                }, clock);
                if (followUpMessage !== undefined)
                    await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, followUpMessage);
                appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-updated', {
                    teamId: fresh.id,
                    taskId: task.id,
                    status: task.status,
                    ...task.assignee !== undefined ? { assignee: task.assignee } : {},
                    ...task.output !== undefined ? { output: task.output } : {},
                    ...task.verdict === undefined ? {} : { verdict: task.verdict },
                    ...task.round === undefined ? {} : { round: task.round },
                });
                for (const created of followUp?.created ?? []) {
                    appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-created', {
                        teamId: fresh.id,
                        taskId: created.id,
                        subject: created.subject,
                        dependencies: created.dependencies,
                        ...created.assignee === undefined ? {} : { assignee: created.assignee },
                        ...created.kind === undefined ? {} : { kind: created.kind },
                        ...created.round === undefined ? {} : { round: created.round },
                    });
                }
                return {
                    ...followUpSummary === undefined ? {} : { follow_up: followUpSummary },
                    task_id: task.id,
                    status: task.status,
                    attempt: task.attempt ?? 0,
                    ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
                    ...task.output !== undefined ? { output: task.output } : {},
                    /**
                     * ★ runtime 位置的裁决【随返回值一起交出去】。
                     *
                     * 缺席（这个事件类型没有挂 runtime 判据）⇒ 字段不出现。**不是** `ok` ——
                     * 把"这里没有过程约束"读成"过程约束通过了"，正是三态要防的那种合流。
                     */
                    ...runtimeGateRecord === undefined ? {} : { runtime_gates: runtimeGateRecord },
                    /**
                     * ── ★★ t3：**同一次 `update_task`** 走的是**两个**位置 ────────────────────
                     *
                     * 这一行之前，这两个位置的核对结论只有一个 `logger.warn`（见上面那两处
                     * 分支）。⇒ 一次 `update_task` 被拒或成功之后，"**这两个位置的输入面
                     * 接没接全**"在返回值里读不到 —— 而它们恰恰是历史上的缺陷集中地
                     * （`observedChangedPaths` / 三个执行器 / `parentRevision` 都缺过一次）。
                     *
                     * ★ 两处**各挂各的、不合并**：它们核对的是两份不同的 ctx（一个是
                     *   `{task, update, observedChangedPaths}`，一个是那份最长的 completion ctx），
                     *   合成一份会让"哪一个位置缺哪一格"重新变得读不出来 —— 那正是本任务
                     *   要消灭的形状。字段名相同（都与 runtime 同形），但挂的位置区分得开。
                     *
                     * ★ 三态（两处各自独立）：
                     *   · 都齐            ⇒ 字段在场，`incomplete: 0`
                     *   · 有缺格          ⇒ 字段在场，`incomplete: N` + `missing` 名单
                     *   · 这个位置没判据  ⇒ 字段不出现（**不是** `ok`）
                     */
                    ...dispatchInputSurface === undefined ? {} : { dispatch_input_surface: dispatchInputSurface },
                    ...completionInputSurface === undefined ? {} : { completion_input_surface: completionInputSurface },
                };
            });
            if (followUpMessage !== undefined) {
                const captain = ctx.agents.get(team.captainSessionId);
                if (captain !== undefined && steerCaptainReport(captain, CAPTAIN_KEY, followUpMessage.content, mailboxPrompt(team.id, CAPTAIN_KEY, [followUpMessage]))) {
                    await withTeamLock(teamLockKey(stateRoot, team.id), () => markMailboxDelivered(stateRoot, team.id, CAPTAIN_KEY, [followUpMessage.id]));
                }
            }
            await scheduler.kickTeam(workspace, team.id, team.captainSessionId === caller.id ? caller : undefined);
            return updated;
        },
    })));
}
