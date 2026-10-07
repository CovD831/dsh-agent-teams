// ── src/tools/delivery.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。
import { registry } from "../gates/index.js";
import { defineTool } from '@deepseek-ai/dsh-tools';
import { diagnosticFields, evaluateRuntimeGates, inputSurfaceOf, observeMemberConvergence, requireCaptain, requireCaptainTeam, stateRootOf, throwWithSurface, withInputSurfaceOnError, workspaceOf } from "./shared/entities.js";
import { buildCoverageMatrix, canDeclareDelivery, describeQualityLoop } from "../state.js";
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx, clock, config) {
    ctx.tools.register(withInputSurfaceOnError(defineTool({
        name: 'agent_teams_declare_delivery',
        /**
         * ★ 这是 delivery 位置的【宣告点】（t18/B2）。
         *
         * 为什么必须单独存在一个工具：delivery 位置的判据（coverage / convergence）是
         * **裁决**，而裁决需要一个名副其实的落点。此前它挂在 `agent_teams_status` 上
         * —— 那是个**读取**操作，于是一个还没收敛的团队连"现在什么情况"都读不到，
         * 队长瞎着眼修不了任何东西。**「唯一的读取点」不等于「宣告点」。**
         *
         * ⇒ 读取（status）随时能发生、只报告；宣告（本工具）才被拒绝。
         */
        description: 'Captain-only delivery declaration: asks the delivery insertion point whether this team may be reported to the user as delivered, and REFUSES when it may not (uncovered goals, members that never converged, unfinished quality gates). Use it right before telling the user the work is done. agent_teams_status only REPORTS the same verdict without refusing, so reading team state never blocks.',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    ...diagnosticFields({ inputSurface: true }),
                    team_id: { type: 'string', required: true },
                    declared: { type: 'boolean', required: true },
                    blockers: { type: 'array', items: { type: 'string' }, required: true },
                    gates_evaluated: { type: 'number', required: true },
                    loop_state: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: value.declared
                        ? `Delivery declared for team ${value.team_id} (${value.gates_evaluated} delivery gate(s) evaluated).`
                        : `Delivery refused for team ${value.team_id}: ${value.blockers.join('; ')}`,
                }],
        },
        async execute(_args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, caller);
            const coverage = buildCoverageMatrix([...new Set(team.tasks.flatMap((item) => item.coverageOf ?? []))], team.tasks);
            const deliveryCheck = canDeclareDelivery(team);
            const memberConvergence = observeMemberConvergence(ctx, team);
            const deliveryContext = {
                team,
                gate: deliveryCheck,
                coverage,
                ...memberConvergence === undefined ? {} : { members: memberConvergence },
            };
            /**
             * ★ 与 status 用【同一个】求值面：报告与宣告必须读同一份事实，否则
             *   "status 说能交、declare 说不能"会成为一个新的、更难查的不一致。
             *
             * ★ 输入面核对（t10）：同样在求值之前、对着同一个 ctx。★ 它**不参与**下面
             *   的拒绝 —— 核对报缺时这条宣告照常走完（先软后硬）。一个自己还没被验证过
             *   的新机制当场否决交付，正是本队反复踩的形态。
             */
            const deliveryInputSurface = inputSurfaceOf('delivery', deliveryContext);
            const evaluation = await registry.evaluate('delivery', deliveryContext);
            const loop = describeQualityLoop(team);
            /**
             * ★ `unmeasured` 与 `blockers` 必须【不同形】（契约 §3.4）：前者是"没能测量"，
             *   后者是"发现了问题"。合并成一句话会让读日志的人把"没测成"读成"查出了问题"。
             *   ——这正是既有 `rejectOnDeliveryGates` 的分法，这里与它同形。
             *
             * ★★ t3：两处拒绝都改成 `throwWithSurface` —— 被拒的宣告里，
             *   "是交付本身不允许"与"是这个位置的输入面没接完"必须**同时读得到**。
             */
            if (evaluation.ok === false || deliveryCheck.ok === false) {
                if (evaluation.unmeasured !== undefined) {
                    throwWithSurface(`declare_delivery rejected: the delivery gate could not measure (${evaluation.unmeasured})`, deliveryInputSurface);
                }
                throwWithSurface(`declare_delivery rejected: ${[
                    ...deliveryCheck.blockers,
                    ...evaluation.blockers,
                ].join('; ')}`, deliveryInputSurface);
            }
            if (evaluation.evaluated === 0 && evaluation.registered > 0) {
                ctx.logger.warn(`agent-teams: declare_delivery reached the delivery gate with no gate evaluated (${evaluation.registered} registered, all skipped); delivery was not checked`);
            }
            /**
             * ★★ t3：这条日志**保留**（给人看）；结构化出口在下面返回值的 `input_surface`。
             */
            if (deliveryInputSurface !== undefined && deliveryInputSurface.incomplete > 0) {
                ctx.logger.warn(`agent-teams: declare_delivery reached the delivery gate with an unfinished input surface (recorded, not rejected): ${deliveryInputSurface.missing.join('; ')}`);
            }
            await evaluateRuntimeGates(ctx, 'delivery-declared', deliveryContext, clock);
            void stateRoot;
            return {
                team_id: team.id,
                declared: true,
                blockers: [],
                gates_evaluated: evaluation.evaluated,
                loop_state: loop.state,
                /**
                 * ★★ 与 `agent_teams_status` 完全同一个形状（同一个构造点、同一个字段名）：
                 *   那两个入口是同一份核对的两个时刻，"报告"与"宣告"读到的结论必须可机械比对，
                 *   否则"status 说输入面齐、declare 说有缺格"会成为一个新的、更难查的不一致。
                 *   三态同前：齐（0）/ 有缺格（N + 名单）/ 这个位置没判据（字段不出现）。
                 */
                ...deliveryInputSurface === undefined ? {} : { input_surface: deliveryInputSurface },
            };
        },
    })));
}
