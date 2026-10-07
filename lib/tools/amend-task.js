// ── src/tools/amend-task.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。
import { appendTeamEvent, captainSessionOf } from "../events.js";
import { defineTool } from '@deepseek-ai/dsh-tools';
import { diagnosticFields, rejectOnContractGates, requireCaptain, requireCaptainTeam, requireFreshCaptainTeam, requireTask, runVerifyCommand, stateRootOf, teamLockKey, withInputSurfaceOnError, workspaceOf } from "./shared/entities.js";
import { CAPTAIN_KEY, amendTaskContract, normalizeBlankOptionalTaskFields, withTeamLock, writeTeam } from "../state.js";
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx, runtime, config) {
    ctx.tools.register(withInputSurfaceOnError(defineTool({
        name: 'agent_teams_amend_task',
        description: 'Captain-only controlled contract amendment for one non-terminal quality task: replace a wrong objective/acceptance/verify/inScope/outOfScope when the original contract makes honest completion impossible (for example a verify command that cannot pass, or an inScope that forbids the file the objective names). The amendment is appended to the task\'s revisions ledger with previous values and the reason, and is rejected once a review/requirements task has passed judgment on this task. Members cannot amend contracts; the implementer re-reads the amended contract before its next quality gate. Lists are full replacements, not deltas.',
        parameters: {
            task_id: { type: 'string', required: true, description: 'Task whose contract is being amended.' },
            reason: { type: 'string', required: true, description: 'Why the current contract is wrong; recorded in the revisions ledger.' },
            objective: { type: 'string', description: 'Replacement objective.' },
            acceptance: { type: 'array', items: { type: 'string' }, description: 'Replacement acceptance criteria (full list, not a delta).' },
            verify: { type: 'array', items: { type: 'string' }, description: 'Replacement verification commands (full list, not a delta).' },
            inScope: { type: 'array', items: { type: 'string' }, description: 'Replacement workspace-relative inScope paths (full list).' },
            outOfScope: { type: 'array', items: { type: 'string' }, description: 'Replacement workspace-relative outOfScope paths (full list).' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    ...diagnosticFields({ inputSurface: true }),
                    task_id: { type: 'string', required: true },
                    status: { type: 'string', required: true },
                    revised_fields: { type: 'string', required: true },
                    revision_count: { type: 'number', required: true },
                    contract: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `Task ${value.task_id} contract amended (${value.revised_fields}); ${value.revision_count} revision(s) on record, status ${value.status}. New contract: ${value.contract}`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            const amended = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id);
                const task = requireTask(fresh, args.task_id);
                const input = {
                    ...args.objective === undefined ? {} : { objective: args.objective },
                    ...args.acceptance === undefined ? {} : { acceptance: args.acceptance },
                    ...args.verify === undefined ? {} : { verify: args.verify },
                    ...args.inScope === undefined ? {} : { inScope: args.inScope },
                    ...args.outOfScope === undefined ? {} : { outOfScope: args.outOfScope },
                };
                const result = amendTaskContract(fresh, task, normalizeBlankOptionalTaskFields(input), CAPTAIN_KEY, args.reason);
                if (!result.ok || result.task === undefined) {
                    throw new Error(result.error ?? 'amend_task rejected by quality gates');
                }
                Object.assign(task, result.task);
                task.updatedAt = Date.now();
                /**
                 * ── ★ contract 位置（第二个切入点：「改契约」）─────────────────────────────
                 *
                 * 与建任务同一个位置、同一种叠加方式：`amendTaskContract` 先校验修订本身
                 * （它不认识判据层），判据层再问"修订后的契约可判吗"。理由与建任务处相同 ——
                 * 一条被改成不可判的 verify 命令（例如一个永远失败的 grep），若只在建任务时
                 * 检查，就会从"改契约"这条路上溜过去。
                 *
                 * ★ 执行器（t18）：与 create_task 处同一个注入、同一个实现。**两条路都必须注入**
                 *   —— 只修一条会让"改契约"变成绕过可判性检查的入口，而那正是本调用点存在的理由。
                 */
                const amendContractSurface = await rejectOnContractGates(ctx, {
                    team: fresh,
                    task,
                    creating: false,
                    amended: result.revision?.fields ?? [],
                    reason: args.reason,
                }, 'amend_task', stateRoot, {
                    execVerifyCommand: (command) => runVerifyCommand(workspace, command),
                });
                await writeTeam(stateRoot, fresh);
                return {
                    taskId: task.id,
                    status: task.status,
                    fields: result.revision?.fields ?? [],
                    revisionCount: task.revisions?.length ?? 0,
                    ...amendContractSurface === undefined ? {} : amendContractSurface,
                    contract: {
                        ...task.objective === undefined ? {} : { objective: task.objective },
                        ...task.acceptance === undefined ? {} : { acceptance: task.acceptance },
                        ...task.verify === undefined ? {} : { verify: task.verify },
                        ...task.inScope === undefined ? {} : { inScope: task.inScope },
                        ...task.outOfScope === undefined ? {} : { outOfScope: task.outOfScope },
                    },
                };
            });
            appendTeamEvent(ctx, captainSessionOf(ctx, team.captainSessionId, captain.session), 'agent-teams/task-amended', {
                teamId: team.id,
                taskId: amended.taskId,
                fields: amended.fields,
                reason: args.reason,
            });
            return {
                task_id: amended.taskId,
                status: amended.status,
                revised_fields: amended.fields.join(', '),
                revision_count: amended.revisionCount,
                /**
                 * ★★ t3：contract 位置的核对结论**随记录交出去**（与 runtime 同形）。
                 *   这是 contract 位置的**第二条路**（改契约）—— 两条路各挂各的：
                 *   只挂在建任务上，会让"改契约"这条路上的输入面缺失重新变成只能靠日志碰运气。
                 */
                ...amended.input_surface === undefined ? {} : { input_surface: amended.input_surface },
                contract: JSON.stringify(amended.contract),
            };
        },
    })));
}
