// ── src/tools/restart.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。
import { defineTool } from '@deepseek-ai/dsh-tools';
import { RESTART_ESCAPE_HATCH_ENV, arbitrateRestartWithEscape, requireCaptain, requireCaptainTeam, restartArbitrationMessage, restartEscapeHatchFromEnv, stateRootOf, teamLockKey, workspaceOf } from "./shared/entities.js";
import { readTeam, withTeamLock } from "../state.js";
/**
 * ★ t49：排队状态机已搬到 `shared/entities.ts` —— 因为
 *   **工具模块之间不许互相 import**（`gate-tool-split` 臂 3）：
 *   `status.ts` 要读它、`restart.ts` 要写它，而那两个都是工具模块。
 *   ⇒ 放在 `shared/` 是这一条约束的**正确解**，不是绕过它。
 *   ★ 而那一条约束本身有道理：跨模块 import 会让"改一个工具"重新牵动另一个。
 */
import { clearRestartRequest, requestRestart } from "./shared/entities.js";
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx, config) {
    ctx.tools.register(defineTool({
        name: 'agent_teams_restart',
        description: 'Captain-only: reload this plugin so subsequent calls run the code now on disk. Use after a gate/tool change has been built AND verified. This is an ARBITRATION, not a re-check: it does not re-run the verdict — it only asks whether a passing verdict exists and whether any task is in progress. Refuses when either precondition fails, and says which one.',
        parameters: {
            /**
             * ★ `verdict` 由**调用方**交进来，而不是本工具去跑 `pnpm verify`：
             *   那正是"仲裁"与"状态检查"的分界 —— 判决已经跑完了（用户裁定），
             *   这里只接受它的**结论**。做成必填 ⇒ 一次不说结论的调用是本工具**拒收**的，
             *   而不是被当成"判决通过了"。
             */
            verdict: {
                type: 'string',
                required: true,
                enum: ['passed'],
                description: 'The already-completed verdict for the code now on disk. Only "passed" is accepted; this tool deliberately does not re-run the verdict.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    restarted: { type: 'boolean', required: true },
                    /** `'verdict-passed-and-no-work-in-flight'` / `'escape-hatch'`。 */
                    reason: { type: 'string', required: true },
                    /** ★ 被挡时说明**是哪一条前置**不满足（三态可读）。 */
                    blocked_by: { type: 'string' },
                    detail: { type: 'string' },
                    in_flight: { type: 'array', items: { type: 'string' } },
                    /**
                     * ★ t49：被拒时**是否已进入队列**（`true` = 收口后会**自动**重载）。
                     *   ★ 与 `restarted: false` 并列而不是替代它 ——
                     *     "这次没重载"与"它排上队了"是两件事，都要读得出来。
                     */
                    queued: { type: 'boolean' },
                    /** ★ 排队状态：`'waiting'`（会收敛）。 */
                    queue_state: { type: 'string' },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: value.restarted
                        ? `Plugin reloaded (${value.reason}). Subsequent calls run the code now on disk.`
                        : `Reload refused (${value.blocked_by}): ${value.detail ?? ''}`,
                }],
        },
        async execute(args, exec) {
            const captain = requireCaptain(exec);
            const workspace = workspaceOf(captain);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, captain);
            /**
             * ★ 前置二的输入面：从**耐久态**读全部任务的 status（不是从内存缓存）。
             *   理由与判据层同源：内存缓存会与耐久态分叉，而分叉之后
             *   "闸门看到的工作"与"真实在跑的工作"不同形。
             */
            const tasks = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                const fresh = await readTeam(stateRoot, team.id);
                return (fresh?.tasks ?? []).map((task) => ({ id: task.id, status: task.status }));
            });
            const arbitration = arbitrateRestartWithEscape({ verdictPassed: args.verdict === 'passed', tasks }, restartEscapeHatchFromEnv(process.env[RESTART_ESCAPE_HATCH_ENV]));
            if (!arbitration.allowed) {
                /**
                 * ── ★★ 被拒 ≠ 失败：它进入队列（t49 的核心）──────────────────────────────
                 *
                 * ★ 而**只有**「有工作在跑」那一条可以排队 —— 理由是结构性的：
                 *
                 *     `work-in-flight` 会因为**工作收口**而消失 ⇒ 等它是有意义的。
                 *     `no-passing-verdict` **不会**因为任何人收口而出现 ⇒
                 *     排队等判决永远是白等（而它该做的是回去跑 verify）。
                 *
                 *   ⇒ 让后者也排队，会把"回去改代码"伪装成"等一会儿就好了" ——
                 *     而那正是本队记账的"把一个该行动的时刻伪装成一个该等待的时刻"。
                 *
                 *   ★ 而 `stuck`（第三态）由 `restartQueueFrom` 判定：等待名单里的任务
                 *     若**不在任务表里**（被删了），它永远不会收口 ⇒ 那一等不会有结果。
                 */
                if (arbitration.blockedBy === 'work-in-flight') {
                    requestRestart(arbitration.inFlight, Date.now());
                    ctx.logger.info(`agent-teams: reload QUEUED — it will run automatically once ${arbitration.inFlight.join(', ')} finish `
                        + '(no new work will be dispatched while the request is pending)');
                }
                ctx.logger.warn(`agent-teams: reload refused — ${restartArbitrationMessage(arbitration)}`);
                const queued = arbitration.blockedBy === 'work-in-flight';
                return {
                    restarted: false,
                    reason: arbitration.blockedBy,
                    blocked_by: arbitration.blockedBy,
                    detail: arbitration.detail,
                    ...arbitration.blockedBy === 'work-in-flight' ? { in_flight: arbitration.inFlight } : {},
                    ...queued ? { queued: true, queue_state: 'waiting' } : {},
                };
            }
            /**
             * ★ 逃生口被**用过**时要留痕：一次"明知有工作在跑仍然重载"必须读得出来，
             *   否则它与"闸门本来就开着"在日志里同形（本队记账的合流形态）。
             */
            if (arbitration.reason === 'escape-hatch') {
                ctx.logger.warn(`agent-teams: reload used the escape hatch (${RESTART_ESCAPE_HATCH_ENV}=1), bypassing "${arbitration.bypassed}"`);
            }
            /**
             * ★ **不**用 `appendTeamEvent`：重载是**进程级动作**，不是团队生命周期事件。
             *   团队事件类型的并集（`AgentTeamsEventType`）里每一个都是"团队发生了什么"，
             *   而"这个进程换了代码"不属于那一类。
             *   ⇒ 强行塞进去要改 `src/event-types.ts`（**不在本任务 inScope**），
             *     而它会让那一份并集多出一个语义不同类的成员 —— 读者会以为团队状态变了。
             *   ★ 而它**没有因此变得不可读**：下面两处 logger 记录了成功/逃生口/失败三种情形，
             *     与 `moduleFreshness` 的出口同一条纪律（进程级事实走日志，不走团队状态）。
             */
            ctx.logger.info(`agent-teams: reloading the plugin (${arbitration.reason})`);
            /**
             * ★ 重载真的发生了 ⇒ 消费掉那条申请。
             *   ★ 若不消费，它会一直留在 `status` 里说"已申请" ——
             *     而那会让下一次读取把它读成"还有一次重载在等"（幽灵申请）。
             */
            clearRestartRequest();
            /**
             * ── 能力来源：cordis 的 `fiber.restart()`（已核实存在）──────────────────────
             *
             * 「Dispose and immediately reload this plugin with its current config.」
             *
             * ★ 与 **HMR** 的关键区别（本队已否决 HMR）：HMR 是**文件一变就换**（无闸门），
             *   而这里是一个**显式动作**，且它的前置是一个**已完成的判决**。
             *   ⇒ 两者在"什么时候换代码"上完全不同：一个由文件系统决定，一个由仲裁决定。
             *
             * ★ 重载**在本工具返回之后**发生（`restart()` 会 dispose 当前 fiber，
             *   而它的返回值已经不再需要本 fiber 存活）—— 所以这里**不 await**，
             *   否则调用方会等一个"永远不会返回"的承诺。
             */
            const fiber = ctx.fiber;
            if (typeof fiber?.restart !== 'function') {
                /**
                 * ★ 拿不到 `fiber.restart` ⇒ **不是"重载成功"**，也不是静默失败：
                 *   宿主形态不支持时要说出来（与"我持有旧模块"同一条纪律：读得出来才算数）。
                 */
                ctx.logger.error('agent-teams: this host does not expose fiber.restart, so the plugin could not be reloaded');
                return {
                    restarted: false,
                    reason: arbitration.reason,
                    blocked_by: 'host-cannot-restart',
                    detail: 'this host does not expose fiber.restart; reload the plugin externally',
                };
            }
            void fiber.restart().catch((error) => {
                ctx.logger.error(`agent-teams: plugin restart failed: ${String(error)}`);
            });
            return { restarted: true, reason: arbitration.reason };
        },
    }));
}
