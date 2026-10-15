/**
 * Team activity snapshot assembly for the activity panel.
 *
 * Server-side assembly mirrors the Claude Code desktop teamWatcher: read the
 * durable team files (the truth source) and enrich with live subagent
 * activity, so the panel always reflects the on-disk state even when a model
 * skipped a tool "ritual" (e.g. not calling update_task on completion).
 * @module dsh-agent-teams/snapshot
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { memberActivity, memberLiveness, strandedWork, strandedWorktrees, liveSessionRefs, attributeSubagents, memberSubagents } from "./members.js";
import { gitChangedPaths } from "./harness-compat.js";
import { worktreeDirName } from "./worktree.js";
import { CAPTAIN_KEY, failureKindOf, listArchivedTeamIds, readArchivedTeam, readUnreadMailbox, readTeam, taskDepthsById, taskVisualState, } from "./state.js";
import { TERMINAL_TASK_STATUSES } from "./types.js";
import { registry, INSERTION_POINTS } from "./gates/index.js";
/**
 * ── ★★★ v4：把判据清单投影成 UI 读得懂的形状（registry.list() 的转发）────────────
 *
 * ★ **为什么必须在这一侧做**：`registry.list()` 的条目里带 `appliesTo`
 *   （**函数**，不能过 JSON）与 `requires`（输入面声明）—— 那些是**求值侧**的东西。
 *   UI 要的是"这个阶段挂着哪些判据、它们各自是什么"，即 `id` + `description`。
 *   ⇒ 在**服务端**就投影掉，于是线上穿的全是可序列化的、且**没有多余的内部形状**。
 *
 * ★ 六个位置**逐个出现**（含 `gates: []` 的空位置）：空位置与缺席必须不同形。
 * @returns one catalog row per insertion point, in the registry's own order.
 */
export function gateCatalogForUi() {
    const listed = registry.list();
    return INSERTION_POINTS.map((point) => {
        const gates = listed[point] ?? [];
        return {
            point,
            registered: gates.length,
            gates: gates.map((gate) => ({
                id: gate.id,
                description: gate.description,
                observing: gate.observing,
            })),
        };
    });
}
/** The current task of a member: its first unfinished owned task. */
function currentTaskOf(memberName, tasks) {
    for (const task of tasks) {
        if (task.status === 'in_progress' && task.assignee === memberName)
            return task.id;
    }
    return '';
}
/** Compact `provider/model` route for the activity panel, or just the model. */
export function memberModelRoute(member) {
    if (member === undefined)
        return '';
    const provider = member.provider?.trim() ?? '';
    const model = member.model?.trim() ?? '';
    if (provider !== '' && model !== '')
        return `${provider}/${model}`;
    return model;
}
/**
 * Assemble one team snapshot from its durable files plus live activity.
 * @param ctx - the plugin context (injects `subagents`, used for activity).
 * @param stateRoot - resolved absolute state root of the owning workspace.
 * @param workspace - display name of the owning workspace.
 * @param state - the durable team record.
 * @returns the panel snapshot.
 */
export async function assembleTeamSnapshot(ctx, stateRoot, workspace, state, options = {}) {
    const tasks = state.tasks;
    const depths = taskDepthsById(tasks);
    const roster = options.includeRemoved === true
        ? state.members
        : state.members.filter((member) => member.status !== 'removed');
    const activity = options.historic === true
        ? new Map()
        : memberActivity(ctx, roster.map((member) => member.id));
    /**
     * ── ★★★ t27：枚举**一次**活会话，然后按父会话归组（全员共用那一份）───────────────
     *
     * ★ 为什么只枚举**一次**而不是每个成员各枚举一次：`ctx.agents.list()` 是
     *   O(全会话) 的，而按成员各调一次会让这一份快照变成 O(成员 × 全会话) ——
     *   面板是轮询的，那个乘积会直接变成 UI 的延迟。
     *
     * ★ 归档团队（`historic`）**不读**：那些会话按定义已经停了，读它会报一整排
     *   "没有子代理"，而那是关于"它是历史"的**已知事实**，不是一次观测
     *   （与 `memberLiveness` 的归档支同一条口径）。
     *
     * ★★ 三态在这里被**如实传递**：枚举读不到 ⇒ `projection` 报
     *   `could-not-measure` ⇒ `attribution` 是 `undefined` ⇒ 每个成员的
     *   `subagents` 都是 `could-not-measure`（**不是**空数组）。
     *   这条链上任何一环把它圆成"空"，面板就会静默地说"没有子代理"。
     */
    const projection = options.historic === true ? undefined : liveSessionRefs(ctx);
    /**
     * ★ 归组只在**读到了**的时候做。`undefined` 是"这一层没能观察"的载体 ——
     *   而 `attributeSubagents` 永不返回 `undefined`，所以两者不同形。
     */
    const attribution = projection?.status !== 'observed'
        ? undefined
        : attributeSubagents(projection.subagents, roster.map((member) => member.id));
    const unreadByMember = new Map();
    for (const member of roster) {
        try {
            unreadByMember.set(member.name, (await readUnreadMailbox(stateRoot, state.id, member.name)).length);
        }
        catch (error) {
            ctx.logger.warn(`agent-teams: mailbox read failed for ${member.name}: ${String(error)}`);
            unreadByMember.set(member.name, 0);
        }
    }
    const members = roster.map((member) => {
        const owned = tasks.filter((task) => task.assignee === member.name);
        const done = owned.filter((task) => task.status === 'completed').length;
        /**
         * ★ t4：存活读数与 `activity` **并列**。历史（归档）团队没有"活着"可言
         *   —— 它的会话按定义已经停了，所以那一支**不读**（读它会报一整队 `not-live`，
         *   而那是一条关于"它是历史"的已知事实，不是一次故障）。
         */
        const live = options.historic === true ? undefined : memberLiveness(ctx, member);
        const open = owned.filter((task) => !TERMINAL_TASK_STATUSES.includes(task.status)).map((task) => task.id);
        /**
         * ★ t27：这个成员名下的活子代理。归档团队支报 `observed` + 空数组 ——
         *   那些会话按定义已经停了（"它是历史"是一个**已知事实**，不是一次观测），
         *   与 `liveness` 的归档支同一条口径。
         */
        const subs = options.historic === true
            ? { status: 'observed', subagents: [] }
            : memberSubagents(ctx, member.id, attribution, projection?.status === 'observed' ? undefined : projection?.reason);
        /**
         * ★ 轮次：这个成员名下**有轮次的任务**里最大的那一轮。
         *   缺省（没有任务带 `round`）⇒ 这一格**缺席**，而不是 `0` ——
         *   "没有轮次概念"与"第 0 轮"必须不同形。
         */
        const rounds = owned.map((task) => task.round).filter((round) => typeof round === 'number');
        return {
            id: member.id,
            name: member.name,
            role: member.role ?? '',
            provider: member.provider?.trim() ?? '',
            model: member.model?.trim() ?? '',
            reasoningEffort: member.reasoningEffort?.trim() ?? '',
            executionPrompt: member.executionPrompt ?? '',
            status: member.status,
            activity: options.historic === true
                ? 'idle'
                : member.id !== ''
                    ? (activity.get(member.id) === 'running'
                        ? 'working'
                        : activity.get(member.id) === 'idle' || activity.get(member.id) === 'ready'
                            ? 'idle'
                            : 'unknown')
                    : 'idle',
            /**
             * ★ 归档团队支：`liveness` 报 `could-not-measure` 而不是 `not-live` ——
             *   因为"历史团队的会话停了"是**可判定的**（它是历史），而 `not-live` 的
             *   含义是"它本该在跑而现在不在" ⇒ 把那件事报成 `not-live` 会让每一份
             *   历史快照都带着一整队假死亡告警（而那正是"恒常告警会被永久忽略"）。
             */
            liveness: live === undefined ? 'could-not-measure' : live.state,
            livenessReadout: live === undefined ? 'driver-status-unreadable' : live.readout,
            ...live?.state !== 'could-not-measure' ? {} : {
                livenessReason: live?.reason ?? 'this is an archived team, so whether its member sessions are alive is not a question about the present',
            },
            stranded: live !== undefined && strandedWork(live, open),
            subagents: subs.status,
            liveSubagents: subs.subagents,
            ...subs.reason === undefined ? {} : { subagentsReason: subs.reason },
            ...rounds.length === 0 ? {} : { round: Math.max(...rounds) },
            progress: owned.length === 0 ? 0 : Math.round((done / owned.length) * 100),
            done,
            total: owned.length,
            currentTask: currentTaskOf(member.name, tasks),
            unread: unreadByMember.get(member.name) ?? 0,
        };
    });
    /**
     * ★ 冻着的树：只有**真的有**死掉的成员时才去读 git（干净的情形零成本）。
     *
     * ★ 用 `workspace`（面板显示的那个工作区根）而不是 `stateRoot` 去拼路径：
     *   `.agent-teams/worktrees/<name>` 的父目录是**工作区**，而 `stateRoot` 可能
     *   被配置到别处（`stateDir`）。两者在缺省下相同，但用错了那一格会在一次
     *   自定义 `stateDir` 下静默地读一个不存在的目录 ⇒ 恒报"没有东西会丢"。
     * ★ 树名用 `worktreeDirName`（与建树、找树同一个函数）—— 按成员名拼是第二份真相。
     */
    const frozenCandidates = members
        .filter((member) => member.liveness === 'not-live' && member.stranded)
        .flatMap((member) => tasks
        .filter((task) => task.assignee === member.name && !TERMINAL_TASK_STATUSES.includes(task.status))
        .map((task) => ({
        member: member.name,
        path: join(workspace, '.agent-teams', 'worktrees', worktreeDirName(state.id, task.id)),
        name: worktreeDirName(state.id, task.id),
    })));
    const strandedWorkReadout = strandedWorktrees(frozenCandidates, (tree) => {
        const dirty = gitChangedPaths(tree);
        return dirty === undefined ? undefined : dirty.length;
    });
    const captainInbox = await readUnreadMailbox(stateRoot, state.id, CAPTAIN_KEY);
    return {
        workspace,
        teamId: state.id,
        name: state.name,
        ...state.description !== undefined ? { description: state.description } : {},
        captainSessionId: state.captainSessionId,
        phase: state.phase ?? 'running',
        ...state.phase === 'staged'
            ? { planReviewState: state.planReviewState ?? 'awaiting_review' }
            : {},
        ...state.halted === true ? { halted: true } : {},
        members,
        strandedWork: strandedWorkReadout,
        /**
         * ★★★ t27：父会话定不下来的活子代理（见 `TeamActivitySnapshot` 上那段）。
         *   ★ 归档团队支 ⇒ `attribution` 缺席 ⇒ 空数组：那些会话已经停了，
         *     "没有正在跑的外来子代理"是一个**已知事实**，不是一次观测。
         */
        unattributedSubagents: attribution?.unattributed ?? [],
        tasks: tasks.map((task) => ({
            id: task.id,
            subject: task.subject,
            description: task.description ?? '',
            status: task.status,
            state: taskVisualState(task.status, task.dependencies, tasks),
            assignee: task.assignee ?? '',
            model: memberModelRoute(roster.find((member) => member.name === task.assignee)),
            dependencies: task.dependencies,
            depth: depths.get(task.id) ?? 0,
            ...task.kind === undefined ? {} : { kind: task.kind },
            ...task.round === undefined ? {} : { round: task.round },
            ...task.verdict === undefined ? {} : { verdict: task.verdict },
            /**
             * ── ★★★ t78：把**判据结果**也送到浏览器（最后那一跳）─────────────────────────
             *
             * ── 它修的是什么（MEASURED）────────────────────────────────────────────────────
             *
             * 本仓存在**两个互不相连**的 `/state`：
             *
             *     · **client 真正轮询的那个** → `collectTeamsActivity`（本函数）
             *     · status 工具的返回值       → `src/tools/status.ts`
             *
             * MEASURED（队长实测 `lib/client.js` 的引用计数）：
             *
             *     failure_kind   : 0 处
             *     attempt_id     : 0 处
             *     findings_open  : 0 处
             *     gate_evaluation: 0 处   ← ★ 连刚加的也没有
             *
             * ⇒ **status 工具的返回值【根本不流向浏览器】** ⇒ 做在 `status.ts` 里的那一跳
             *   落在**UI 不读的通道**上。⇒ 本行就是把判据结果接到**UI 真读的那条路**上。
             *
             * ── ★ 缺字段的语义（与上面 `kind` / `round` / `verdict` 逐字相同的先例）───────
             *
             * 用**展开式**而不是 `gateEvaluation: task.gateEvaluation`：
             *
             *     展开式：  key **整个不出现**   ⇒ "**从来没求值过**"
             *     赋值式：  key 出现、值为 undefined ⇒ 与"求值了但没有数据"**同形**
             *
             * ★ 而这两件事必须不同形（本仓三态纪律）：前者是"这一格没有任何读数"，
             *   后者是"读了、但读出来是空的"。客户端的 `readGateEvaluation` 靠
             *   **key 在不在**把前者读成 `absent` ⇒ 缺字段**不许**被填成空对象或 fake `ok`。
             */
            ...task.gateEvaluation === undefined ? {} : { gateEvaluation: task.gateEvaluation },
            /**
             * ── ★★★ `failed` 的【三种】成因（t13 的客户端那一半）──────────────────────
             *
             * `status` 只有一个值 `failed`，而它同时盖着三件补救动作完全不同的事：
             *
             *     inconclusive    —— 这个任务的性质就是"找问题"，而它【找到了】
             *                        （审查给了 needs_revision / reject）
             *     failed_delivery —— 交付物【真的坏了】（验收项 failed / verify 非 0）
             *     failed_context  —— 没有测到任何证据（★ 缺省，最保守）
             *
             * ★ 把它们压成一个 `failed`，面板就只能画成红色 —— 于是"这道门做成了它
             *   该做的事"被读成"东西做砸了"。分类的判据**不在本文件**：它逐字来自
             *   `src/state.ts` 的 `failureKindOf`，这里只是把它【交出去】。
             *
             * ★ 只在 `status === 'failed'` 时在场 —— 于是"不适用"与"三种之一"不同形：
             *   一个没有失败的任务不带这一格，而不是带一个假的 `failed_context`。
             */
            ...task.status !== 'failed' ? {} : { failureKind: failureKindOf(task) },
            updatedAt: task.updatedAt,
        })),
        messageCount: captainInbox.length
            + members.reduce((count, member) => count + member.unread, 0),
        captainInbox: captainInbox.slice(-5).map((message) => ({
            from: message.from,
            content: message.content,
        })),
        /**
         * ── ★★★ v4：判据**清单**（最后一跳，与 t78 的 gateEvaluation 同构）──────────────
         *
         * `registry.list()` 原本只在 `src/tools/status.ts` 被读，而那是**UI 不读的通道**。
         * 这一行把它接到 UI **真读**的那条路上（`collectTeamsActivity`），
         * 于是展开态才有"这个阶段挂着哪些判据、各自是什么"可画。
         *
         * ★ 它是**静态目录**：判据注册表在模块加载时就建好，与任务状态无关。
         *   所以它每份快照都带同一份 —— 这正是"可插拔"成立的前提（换判据 ⇒ UI 自动变）。
         */
        gateCatalog: gateCatalogForUi(),
    };
}
/**
 * Collect every team under the given workspace state roots.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs (resolved absolute roots).
 * @returns the snapshots in stable order (workspace, then team id).
 */
export async function collectTeamsActivity(ctx, roots) {
    const snapshots = [];
    for (const root of roots) {
        let entries;
        try {
            entries = await readdir(root.stateRoot, { withFileTypes: true });
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                continue;
            }
            throw error;
        }
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            try {
                const state = await readTeam(root.stateRoot, entry.name);
                if (state === undefined)
                    continue;
                snapshots.push(await assembleTeamSnapshot(ctx, root.stateRoot, root.workspace, state));
            }
            catch {
                ctx.logger.warn(`agent-teams: skipped unreadable team state "${entry.name}" in workspace "${root.workspace}"`);
            }
        }
    }
    return snapshots;
}
/**
 * Collect every archived team under the given workspace state roots (the
 * `archive/` subdirectory of each state root). Used by the historic panel
 * path to restore full team detail after deletion.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs.
 * @returns the archived snapshots in stable order.
 */
export async function collectArchivedTeamsActivity(ctx, roots) {
    const snapshots = [];
    for (const root of roots) {
        for (const teamId of await listArchivedTeamIds(root.stateRoot)) {
            try {
                const state = await readArchivedTeam(root.stateRoot, teamId);
                if (state === undefined)
                    continue;
                snapshots.push(await assembleTeamSnapshot(ctx, join(root.stateRoot, 'archive'), root.workspace, state, { includeRemoved: true, historic: true }));
            }
            catch {
                ctx.logger.warn(`agent-teams: skipped unreadable archived team "${teamId}" in workspace "${root.workspace}"`);
            }
        }
    }
    return snapshots;
}
