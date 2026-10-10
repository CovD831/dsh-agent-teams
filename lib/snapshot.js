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
import { memberActivity, memberLiveness, strandedWork, strandedWorktrees } from "./members.js";
import { gitChangedPaths } from "./harness-compat.js";
import { worktreeDirName } from "./worktree.js";
import { CAPTAIN_KEY, listArchivedTeamIds, readArchivedTeam, readUnreadMailbox, readTeam, taskDepthsById, taskVisualState, } from "./state.js";
import { TERMINAL_TASK_STATUSES } from "./types.js";
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
            updatedAt: task.updatedAt,
        })),
        messageCount: captainInbox.length
            + members.reduce((count, member) => count + member.unread, 0),
        captainInbox: captainInbox.slice(-5).map((message) => ({
            from: message.from,
            content: message.content,
        })),
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
