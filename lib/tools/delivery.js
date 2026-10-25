// ── src/tools/delivery.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。
import { appendTeamEvent, captainSessionOf } from "../events.js";
import { registry } from "../gates/index.js";
import { deliveryAuditFor } from "../artifacts.js";
import { defineTool } from '@deepseek-ai/dsh-tools';
import { diagnosticFields, evaluateRuntimeGates, inputSurfaceOf, observeMemberConvergence, requireCaptain, requireCaptainTeam, appendWorkspaceAuditRecord, readWorkspaceAuditRecords, registeredWorkspaceTitle, resolveTargetWorkspace, stateRootOf, throwWithSurface, withInputSurfaceOnError, workspaceOf } from "./shared/entities.js";
import { buildCoverageMatrix, canDeclareDelivery, describeQualityLoop } from "../state.js";
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
/**
 * ★ t109：读回审计记录（出口用）。★ 读失败**不抛** —— 见调用点的理由。
 */
async function auditTrailFor(ctx, stateRoot) {
    try {
        return await readWorkspaceAuditRecords(stateRoot);
    }
    catch (error) {
        ctx.logger.warn(`agent-teams: could not read the workspace audit trail: ${String(error)}`);
        return [];
    }
}
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
        parameters: {
            /**
             * ── ★★★ t109：**点名一个已注册的工作区**（不传 ⇒ 与改动前逐字相同）──────────
             *
             * 用户裁定：「我需要一个**权限非常大**的主会话，它可以**操纵不同的工作区**。」
             *
             * ★★ **默认完全不变**：不传这一格时，落点仍由 `workspaceOf(caller)` 决定 ——
             *   而 `resolveTargetWorkspace` 在"不传"那一支**直接委托**给它，
             *   并且**完全不碰 `ctx`**（实测：碰了会让 4 个既有夹具红）。
             *
             * ★★★ 而**传了未注册的** ⇒ **拒绝并给理由**，★ **绝不静默回退到自己那个** ——
             *   否则「点错了一个区」与「没点名」在读端**完全同形**。
             */
            workspace: {
                type: 'string',
                description: 'Optional. A registered workspace path or title to read delivery state from, instead of your own workspace. An unregistered name is REJECTED (it does not silently fall back to your own workspace). Omit to keep the previous behaviour.',
            },
        },
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
                    /**
                     * ── ★★★ t109（裁定甲③）：**"必须能从某个出口读到"** ────────────────────────
                     *
                     * ★ 读的是**落盘那份**（`.agent-teams/audit/workspace.jsonl`）——
                     *   因为事件流那条今天不产生任何记录（宿主 59 个已知类型里 `agent-teams` 0 个）。
                     *
                     * ★ 只在**点名了工作区**时在场（`undefined` = 这次没跨区）。
                     *   ★★ 缺席与"空数组"不同形：前者是"没做跨区操作"，后者是"做了、但一条都没记上"。
                     */
                    workspace_audit: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                at: { type: 'number', required: true },
                                actor: { type: 'string', required: true },
                                callerWorkspace: { type: 'string', required: true },
                                targetWorkspace: { type: 'string', required: true },
                                targetTitle: { type: 'string', required: true },
                                tool: { type: 'string', required: true },
                                /** ★ 取值域与 `WorkspaceAuditRecord.action` 逐字一致（单件事）。 */
                                action: { type: 'string', enum: ['read-delivery'], required: true },
                            },
                        },
                    },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: value.declared
                        ? `Delivery declared for team ${value.team_id} (${value.gates_evaluated} delivery gate(s) evaluated).`
                        : `Delivery refused for team ${value.team_id}: ${value.blockers.join('; ')}`,
                }],
        },
        async execute(args, exec) {
            const caller = requireCaptain(exec);
            /**
             * ── ★★★ t109：落点从【隐式】变成【可点名】，而默认逐字不变 ───────────────────
             * ★ 不传 ⇒ `resolveTargetWorkspace` **委托给 `workspaceOf(caller)`**（同一行）。
             * ★ 传了未注册的 ⇒ **抛错**；传了已注册的 ⇒ 用它。
             */
            const target = resolveTargetWorkspace(ctx, caller, typeof args.workspace === 'string' ? args.workspace : undefined);
            const workspace = target.workspace;
            const stateRoot = stateRootOf(workspace, config);
            const team = await requireCaptainTeam(workspace, config, caller);
            /**
             * ── ★★★ t109：审计 —— **与能力一起上**，而且【成功也要记】 ─────────────────────
             *
             * ★★ 位置在"**已确认能操作这个区**"之后：若放在 `requireCaptainTeam` 之前，
             *   一次**点错区**也会留下"跨区操作"的记录，而那次操作**实际没发生** ⇒ 台账比事实多。
             *
             * ★★★ 为什么**成功路径**必须记（硬边界③）：
             *   失败会抛、会被看见；而**成功的跨区操作是静默的** —— 没有别的出口能发现它。
             *
             * ★ `action` 只写 `'read-delivery'`（**单件事**）：本工具一次调用**只读**那个区。
             *   ★★ 将来若加写，**必须是新取值**，不许复用（见 `event-types.ts`）。
             */
            if (target.explicit) {
                const audit = {
                    actor: caller.id,
                    callerWorkspace: workspaceOf(caller),
                    targetWorkspace: workspace,
                    targetTitle: registeredWorkspaceTitle(ctx, workspace) ?? workspace,
                    tool: 'agent_teams_declare_delivery',
                    /** ★ **单件事**：本工具一次调用只**读**那个区，不改它。 */
                    action: 'read-delivery',
                };
                /**
                 * ★★★ **落盘那条（主）** —— 裁定甲的理由：
                 *   宿主的已知事件类型里 `agent-teams` **一个都没有**（实测 59 个里 0 个），
                 *   于是 `appendTeamEvent` 会**静默 return** ⇒ 只写事件流的话，
                 *   一次跨区操作**不留任何痕迹** ⇒ "审计"是空的。
                 * ⇒ 所以磁盘是**权威源**（`events.ts:33-38` 逐字也是这么说的）。
                 *
                 * ★ 失败**不阻断**跨区读（先软后硬，与本仓 `recordFriction` 同一纪律）：
                 *   审计写不进去**不该**让一次只读操作失败；
                 *   ★★ 但它**必须被看见** ⇒ 走 `logger.warn`（与 t89 同款）。
                 */
                try {
                    await appendWorkspaceAuditRecord(stateRoot, { at: Date.now(), ...audit });
                }
                catch (error) {
                    ctx.logger.warn(`agent-teams: could not persist the workspace audit record (the read still happened): ${String(error)}`);
                }
                /**
                 * ★★ **事件流那条（次，保留）** —— 宿主将来支持时它自然生效。
                 *   ★ 不为它做什么特殊处理：`appendTeamEvent` 自己就"containing failures"。
                 */
                appendTeamEvent(ctx, captainSessionOf(ctx, team.captainSessionId, caller.session), 'agent-teams/workspace-audited', {
                    teamId: team.id,
                    ...audit,
                });
            }
            const coverage = buildCoverageMatrix([...new Set(team.tasks.flatMap((item) => item.coverageOf ?? []))], team.tasks);
            const deliveryCheck = canDeclareDelivery(team, await deliveryAuditFor(workspace, team));
            const memberConvergence = observeMemberConvergence(ctx, team);
            const deliveryContext = {
                team,
                gate: deliveryCheck,
                coverage,
                members: memberConvergence.observed,
                /**
                 * ★ 被略过的成员留名（t46）：驱动不在场 ⇒ 该成员不可观察。它不进判据的
                 *   观察面（判据不为它发言，也不为它定罪），但宣告方必须说得出
                 *   "这一维这次对谁不可用" —— 否则"略过一个成员"与"这个队没有成员"同形。
                 */
                ...memberConvergence.bypassed.length === 0 ? {} : { member_convergence_bypassed: memberConvergence.bypassed },
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
            /**
             * ── ★★★ t64：先区分「没检查」与「真的被拒」─────────────────────────────────
             *
             * MEASURED（t58 第一半之后，本任务的实测）：
             *
             *     `registry.evaluate('delivery', {})` ⇒ `ok:false` + `skippedAll` 在场
             *       （该位置挂了 2 条判据，而这一轮一条都没适用）
             *     ⇒ 而下面那一行读 `ok === false` 就拒 ⇒ **把"没检查"变成了"假拒绝"**。
             *
             * ★ 而基线（t58 之前）这里是 `ok:true`（放行）——
             *   所以这是 t58 带来的**新**后果，而它是**不可接受**的：
             *   一个安全约束**不触发**时，正确的形状不是「拒绝一切」，而是
             *   「放行，并留下它没被检查的痕迹」。
             *
             * ── 三态（契约要求：三者不同形）──────────────────────────────────────────
             *
             *     ① 没检查（`ok:false` + `skippedAll`）    ⇒ **放行** + 告警（不拒绝）
             *     ② 检查了而通过（`ok:true`）              ⇒ 放行，不告警
             *     ③ 检查了而拒绝（blockers / unmeasured）  ⇒ 拒绝（下面的分支不变）
             *
             * ★ 而 `unmeasured`（判据跑了、说它测不了）**仍然拒绝** ——
             *   那是既有语义，本任务不动它。它与①的差别是 `evaluated`：① 是
             *   `evaluated === 0`（一条都没跑），`unmeasured` 是 `evaluated >= 1`。
             *   ⇒ 两者**不同形**，而这条区分由注册表保证（t58 第一半）。
             *
             * ★ 为什么用 `skippedAll` 而不是 `evaluated === 0` 作为判据：
             *   `skippedAll` 是注册表**显式**产出的那个说明（"这一步没被检查"）；
             *   而 `evaluated === 0` 在空位置（`registered === 0`）上也成立 ——
             *   那时它是"这里本来就没有判据"，是正常情形。⇒ 用前者更精确。
             */
            const notChecked = evaluation.ok === false && evaluation.skippedAll !== undefined;
            if (notChecked) {
                ctx.logger.warn(`agent-teams: declare_delivery reached the delivery gate with nothing evaluated (${evaluation.registered} registered, all skipped); delivery was NOT checked — allowing it through, because "not checked" is not "refused"`);
            }
            if (!notChecked && (evaluation.ok === false || deliveryCheck.ok === false)) {
                if (evaluation.unmeasured !== undefined) {
                    throwWithSurface(`declare_delivery rejected: the delivery gate could not measure (${evaluation.unmeasured})`, deliveryInputSurface);
                }
                throwWithSurface(`declare_delivery rejected: ${[
                    ...deliveryCheck.blockers,
                    ...evaluation.blockers,
                ].join('; ')}`, deliveryInputSurface);
            }
            /**
             * ★ t64：这条告警**上移进了 `notChecked` 分支**（见上面那段）。
             *   ★ 合并而不是保留两处：同一件事报两遍会让"这两条日志说的是不是同一件事"
             *     变成一个要读两处才能回答的问题 —— 而它们是同一件事。
             *   ★ 而措辞变了：新的一句把**判定**也说出来（"allowing it through,
             *     because not-checked is not refused"），旧的那句只说"was not checked"。
             *     ⇒ 一个只说"没检查"而裁决却是"拒绝"的告警，正是 t64 要修的那个矛盾。
             */
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
                /**
                 * ★★★ 出口：把**落盘**的审计读回来报告（裁定甲③）。
                 * ★★ 只在这次真的点名了工作区时读 —— "没跨区"与"跨区了但没有记录"必须不同形。
                 * ★ 读失败**不阻断**（那次跨区读已经发生了）：抛会让一次**已经成功**的只读操作看起来失败。
                 */
                ...target.explicit ? { workspace_audit: await auditTrailFor(ctx, stateRoot) } : {},
            };
        },
    })));
}
