// ── src/tools/reassign.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。
import { appendTeamEvent } from "../events.js";
import { defineTool } from '@deepseek-ai/dsh-tools';
import { captainOpenTask, memberOpenTask, requireCaptain, requireCaptainTeam, requireFreshCaptainTeam, requireMember, requireTask, stateRootOf, stopTeamMemberActivations, teamLockKey, workspaceOf } from "./shared/entities.js";
import { CAPTAIN_KEY, beginTaskAttempt, discardMailboxMessages, invalidateTaskAttempt, readTeam, readUnreadMailbox, unsatisfiedDependencies, withTeamLock, writeTeam } from "../state.js";
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx, scheduler, config) {
    ctx.tools.register(defineTool({
        name: 'agent_teams_reassign_task',
        description: 'Atomically retry, reassign, or let the captain take over one ready unfinished/failed task. The old attempt is revoked before its member is interrupted, so late updates cannot overwrite the new owner. Use assignee="captain" only when you will finish that task in this turn; a captain can own only one unfinished takeover at a time, and an unfinished takeover returns to the member pool when the captain becomes idle.',
        parameters: {
            task_id: { type: 'string', required: true, description: 'Task to retry/reassign.' },
            assignee: { type: 'string', required: true, description: 'Active member name, or "captain" for captain takeover.' },
            reason: { type: 'string', description: 'Why the task is being retried or reassigned.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    task_id: { type: 'string', required: true },
                    previous_assignee: { type: 'string', required: true },
                    assignee: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    attempt: { type: 'number', required: true },
                    attempt_id: { type: 'string' },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `Task ${value.task_id} reassigned ${value.previous_assignee || 'unassigned'} → ${value.assignee} (attempt ${value.attempt}, status ${value.status}${value.attempt_id ? `, attempt_id ${value.attempt_id}` : ''}).`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            const target = args.assignee.trim();
            if (target === '')
                throw new Error('reassignment assignee must not be empty');
            const revoked = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const task = requireTask(fresh, args.task_id);
                if (task.status === 'completed')
                    throw new Error(`completed task ${task.id} is immutable and cannot be reassigned`);
                if (task.reassigning === true) {
                    const previousMember = fresh.members.find(member => member.id === task.handoffFromMemberId && member.stopping === true);
                    if (task.assignee !== target || previousMember === undefined)
                        throw new Error(`task ${task.id} is already being reassigned`);
                    return { previousAssignee: previousMember.name, previousMember: { ...previousMember }, handoffId: task.handoffId };
                }
                const targetMember = target === CAPTAIN_KEY ? undefined : requireMember(fresh, target);
                if (target === CAPTAIN_KEY) {
                    const busy = captainOpenTask(fresh, task.id);
                    if (busy !== undefined) {
                        throw new Error(`captain is busy with ${busy.id}; complete or reassign it before taking over ${task.id}`);
                    }
                    const pending = unsatisfiedDependencies(fresh.tasks, task.dependencies);
                    if (pending.length > 0) {
                        throw new Error(`task ${task.id} is blocked by unfinished dependencies: ${pending.join(', ')} — complete them before captain takeover`);
                    }
                }
                else if (targetMember !== undefined) {
                    const busy = memberOpenTask(fresh, targetMember.name, task.id);
                    if (busy !== undefined) {
                        throw new Error(`member "${targetMember.name}" is busy with ${busy.id}; finish or reassign it first`);
                    }
                }
                const previousAssignee = task.assignee ?? '';
                const previousMember = (task.status !== 'claimed' && task.status !== 'in_progress')
                    || task.assignee === undefined || task.assignee === CAPTAIN_KEY
                    ? undefined
                    : fresh.members.find(member => member.name === task.assignee && member.status !== 'removed');
                invalidateTaskAttempt(task, target, true);
                if (previousMember !== undefined) {
                    previousMember.stopping = true;
                    task.handoffFromMemberId = previousMember.id;
                    await discardMailboxMessages(stateRoot, fresh.id, previousMember.name, (await readUnreadMailbox(stateRoot, fresh.id, previousMember.name)).map(message => message.id));
                }
                await writeTeam(stateRoot, fresh);
                return {
                    previousAssignee,
                    previousMember: previousMember === undefined ? undefined : { ...previousMember },
                    handoffId: task.handoffId,
                };
            });
            let quiescenceError;
            if (revoked.previousMember !== undefined) {
                try {
                    await stopTeamMemberActivations(ctx, captain, [revoked.previousMember], exec.signal);
                }
                catch (error) {
                    quiescenceError = error;
                }
            }
            await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const task = requireTask(fresh, args.task_id);
                if (task.handoffId !== revoked.handoffId || task.assignee !== target || task.reassigning !== true) {
                    throw new Error(`task ${task.id} changed during reassignment; refusing to overwrite the newer state`);
                }
                task.reassigning = quiescenceError !== undefined;
                if (quiescenceError === undefined) {
                    const previous = fresh.members.find(member => member.id === revoked.previousMember?.id);
                    if (previous !== undefined)
                        delete previous.stopping;
                    delete task.handoffFromMemberId;
                }
                if (quiescenceError === undefined && target === CAPTAIN_KEY) {
                    beginTaskAttempt(task, CAPTAIN_KEY);
                    // The captain is already in the turn that requested takeover; there
                    // is no later member claim handshake to move claimed -> in_progress.
                    task.status = 'in_progress';
                    task.updatedAt = Date.now();
                }
                await writeTeam(stateRoot, fresh);
                appendTeamEvent(ctx, captain.session, 'agent-teams/task-updated', {
                    teamId: fresh.id,
                    taskId: task.id,
                    status: task.status,
                    assignee: task.assignee,
                    ...args.reason === undefined ? {} : { output: `Reassigned: ${args.reason}` },
                });
            });
            if (quiescenceError !== undefined)
                throw quiescenceError;
            if (target !== CAPTAIN_KEY)
                await scheduler.kickMember(workspace, team.id, target, captain);
            const current = await readTeam(stateRoot, team.id);
            const task = current === undefined ? undefined : requireTask(current, args.task_id);
            if (task === undefined)
                throw new Error(`team "${team.name}" ended during reassignment`);
            return {
                task_id: task.id,
                previous_assignee: revoked.previousAssignee,
                assignee: task.assignee ?? '',
                status: task.status,
                attempt: task.attempt ?? 0,
                ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
            };
        },
    }));
}
