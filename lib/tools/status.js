// ── src/tools/status.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。
import { registry } from "../gates/index.js";
import { mailboxContent, readCurrentMailbox } from "../mailbox.js";
import { TERMINAL_TASK_STATUSES } from "../types.js";
import { defineTool } from '@deepseek-ai/dsh-tools';
import { join } from 'node:path';
import { diagnosticFields, evaluateRuntimeGates, inputSurfaceOf, inputSurfaceSchema, clearRestartRequest, moduleFreshness, moduleFreshnessMessage, readPlanReview, restartQueueFrom, restartQueueMessage, observeMemberActivity, observeMemberConvergence, requireCaptain, requireFreshParticipant, requireParticipantTeam, stateRootOf, teamLockKey, workspaceOf } from "./shared/entities.js";
import { memberActivity, memberLiveness, strandedWork, strandedWorktrees, describeStrandedWorktrees, describeTeamShape, shapeExecutionFor } from "../members.js";
import { sessionLeadsTeam } from "../lineage.js";
import { deliveryAuditFor } from "../artifacts.js";
import { identityOfTeam, liveRefsOf } from "../members.js";
/**
 * ★★ t84：检出那一支的读数（t80 建的），接到 `deployment.worktree`。
 *   ★ 它与 `moduleFreshness`（进程那一支）**并列而不合并** —— 见下面那段长注释。
 */
import { describeBaselineFreshness, gitChangedPaths, worktreeBaselineFreshness } from "../harness-compat.js";
import { worktreeDirName } from "../worktree.js";
import { CAPTAIN_KEY, acknowledgeMailbox, buildCoverageMatrix, canDeclareDelivery, describeQualityLoop, failureKindOf, taskKindOf, withTeamLock } from "../state.js";
/**
 * ── ★★★ N5 / t8：计划审查环的读数 ────────────────────────────────────────────────
 * ★ 从 `../quality-gates.ts` **直取**而不经 `state.ts` 中转：`src/state.ts` 不在本任务
 *   写域里，而工具模块直取 `quality-gates.ts` 是本仓既有形态
 *   （`src/tools/create.ts:15`、`src/tools/edit-plan.ts:24`、`src/tools/update-task.ts:123`）。
 * ★ 与上面那行 `describeQualityLoop`（经 `state.ts`）**并列存在**是刻意的：
 *   两个环各读各的读数，不给对方开第二跳。
 */
import { describePlanLoop } from "../quality-gates.js";
import { renderStatus } from "./shared/entities.js";
/**
 * ── ★★★ A1：`/state` 的判据视图（四类明细）──────────────────────────────────────
 *
 * ── 它补的缺口 ────────────────────────────────────────────────────────────────
 *
 * MEASURED（计划 F3，本任务复现）：`ran: GateRunEntry[]` **产出即被丢弃** ——
 * `grep -rn "\.ran\b" src/` 在 `registry.ts` 之外**零消费**。判据层每一轮都在
 * 逐条算结论，而那些结论**从来没有出口**：`/state` 今天只送 `runtime_gates` 一格。
 * ⇒ client 只能看到"这个位置跑了几条"（`gates_evaluated`），看不到**是哪几条、
 *   每一条什么裁决**。于是"判据在起作用"这件事在 UI 上**不可证**。
 *
 * ── 为什么分组在【服务端】做（X2，用户已拍板）───────────────────────────────────
 *
 * `ran[]` 是**位置级**的：`registry.evaluate(point, ctx)` 一次调用的产物
 * （`registry.ts:676-677` 的 `if (reg.point !== point) continue` 保证它只含该位置的判据）。
 * ⇒ 有两条路：
 *     (i)  **服务端分组** ⇒ `/state` 送 `{ delivery: [...], runtime: [...] }`
 *     (ii) 扁平数组 + 每格加 `point` ⇒ ★ 那**必须给 `GateRunEntry` 加字段**，
 *          等于**改 `registry.ts` 的形状**，而它是上游不存在的新目录、D 线之外的改动。
 * ⇒ 选 **(i)**：不改 `registry.ts` 一个字节，代价只是载荷多一层嵌套。
 *   ★ 可核：`git diff --stat src/gates/registry.ts` 必须为空。
 *
 * ── ★★ 四类，且第 ④ 类不许漏 ──────────────────────────────────────────────────
 *
 *   ① `points`   —— 六个插入点的**三态聚合**（每点一个计数；★ 含"未检查"那一态）
 *   ② `active`   —— **活跃**判据明细（正在跑的：`ok` / `blocked` / `unmeasured`）
 *   ③ `abnormal` —— **异常**判据明细（`blocked` / `unmeasured` —— 即"没通过"或"测不了"）
 *   ④ `unchecked`—— ★ **「未检查」明细**（`skippedAll` 在场的位置）
 *
 * ★★ ②③ 有重叠是**刻意的**，不是 bug：②回答"现在有什么在动"，③回答"哪里不对劲"。
 *   把它们合成一类会让"正在跑且正常"与"正在跑但没过"在读数上同形 ——
 *   而《四符号纪律》要的正是这两者**不同形**（`⊘`/`✓`/`✗`/`○`）。
 *
 * ── ★★★ 每条明细带【显式布尔】`observed`（不许用 `undefined` 冒充 `false`）────────
 *
 * t41 的理由逐字：只送 `verdict` 时，`observed:true` 与 `observed:false`
 * **都读成 `'blocked'`** ⇒ **client 画不出"观察模式"底纹**。
 * ⇒ 本函数对**每一条**明细**恒写出** `observed: <boolean>`：
 *      · 源码 `GateRunEntry.observed` **只在**"开火了但裁决被放过"时为 `true`，其余**缺席**；
 *      · 缺席的语义是"**没被放过**"，而它与"不适用"（`skipped`）**不同形**。
 *   ⇒ 出口处把它**显式化**：缺席 ⇒ `false`。**而三态的分辨力不靠这个字段，靠 `verdict`**
 *      （`skipped` 与 `blocked+observed:false` 仍不同形）。
 *   ★ 契约 C1 说的"不许 `observed:false` 与缺席并存"是**在 `ran[]` 层**的约束
 *     （那里字段缺席本身携带信息）；到了 `/state` 这一层，**必须**显式化，
 *     否则消费方（client）拿不到画底纹所需的布尔 —— 这正是 t41 的验收要求。
 *     两层的差别写在这里，**不许**把 `ran[]` 的规则照搬到出口上。
 */
/** 载荷预算：活跃明细的上界（契约实测；防止把全量 17 条送出去）。 */
const ACTIVE_LIMIT = 4;
/** 载荷预算：异常明细的上界（契约实测 10–12；取 12）。 */
const ABNORMAL_LIMIT = 12;
/**
 * 六个插入点里，**`status` 自己不求值**的那四个。
 *
 * ★ 写死成常量而不是从 `INSERTION_POINTS` 里减：`INSERTION_POINTS` 是
 *   `registry.ts` 的形状（X2 裁定不碰它），而这里要表达的是
 *   **`status` 这个调用点的知识** —— "我手里只有哪两个位置的 ctx"。
 *   ⇒ 两者是**不同的东西**，用减法会把它们绑在一起（将来 `status` 多求值一个位置时，
 *     常量与减法会分叉，而分叉在读数上同形）。
 * ★ 顺序与 `INSERTION_POINTS` 一致（admission → contract → dispatch → completion），
 *   只为让 `/state` 的输出稳定可读，**不是**流程顺序的判据。
 */
const NOT_EVALUATED_IN_STATUS = ['admission', 'contract', 'dispatch', 'completion'];
/** `ran[]` 的一格 ⇒ 出口的一格（`observed` 在这里**显式化**）。 */
function toViewEntry(entry) {
    return {
        id: entry.id,
        verdict: entry.verdict,
        /**
         * ★ 恒写出：`entry.observed === true` ⇒ `true`；缺席 / 非 `true` ⇒ `false`。
         *   ★ 用 `=== true` 而不是 `Boolean(...)`：后者会把任何真值当 `true`，
         *     而这一格的类型是 `boolean | undefined` ⇒ 只有 `true` 才算"被放过"。
         */
        observed: entry.observed === true,
        ...entry.count === undefined ? {} : { count: entry.count },
        ...entry.produced === undefined ? {} : { produced: entry.produced },
    };
}
/**
 * 把若干份**位置级** `ran[]` 组装成判据视图。
 *
 * @param inputs 每个位置一份：`{ point, registered, evaluated, ran, skippedAll }`
 *   ★ 它们**只由调用方**（本文件里那两处求值）填，本函数**不自己求值** ——
 *     求值需要每个位置的 ctx，而 `status` 手里只有 delivery / runtime 两份。
 *     ⇒ 「六个插入点的聚合」**报告的是"注册了几条 + 有没有求值"**，
 *       而不是"六个位置都跑过了" —— 后者 `status` 做不到，写了就是编。
 */
function buildGateView(inputs) {
    const points = [];
    const activeAll = [];
    const abnormalAll = [];
    const unchecked = [];
    for (const input of inputs) {
        const entries = input.ran.map(toViewEntry);
        const count = (verdict) => entries.filter((entry) => entry.verdict === verdict).length;
        const point = {
            point: input.point,
            registered: input.registered,
            evaluated: input.evaluated,
            ok: count('ok'),
            blocked: count('blocked'),
            unmeasured: count('unmeasured'),
            skipped: count('skipped'),
        };
        points.push(point);
        /**
         * ★ 第 ④ 类的判据写死：**`skippedAll` 在场**（`registered > 0` 而 `evaluated === 0`）。
         *   ★ 不许用 `evaluated === 0` 单独判 —— 空位置（`registered === 0`）也是
         *     `evaluated === 0`，而"这里本来就没挂判据"与"挂了但一条都没检查"是
         *     **两件相反的事**（前者正常，后者是 t58 修的那个缺陷）。
         *     源码 `registry.ts:886-896` 逐字给出三分，这里只认第三格。
         */
        if (input.skippedAll !== undefined && input.registered > 0 && input.evaluated === 0) {
            unchecked.push(point);
        }
        for (const entry of entries) {
            /** ② 活跃 = 真的跑过的三态（`skipped` 不算"在动" —— 它根本没跑）。 */
            if (entry.verdict !== 'skipped')
                activeAll.push(entry);
            /** ③ 异常 = 没通过 + 测不了。★ `ok` 与 `skipped` 都不算异常。 */
            if (entry.verdict === 'blocked' || entry.verdict === 'unmeasured')
                abnormalAll.push(entry);
        }
    }
    return {
        points,
        active: activeAll.slice(0, ACTIVE_LIMIT),
        abnormal: abnormalAll.slice(0, ABNORMAL_LIMIT),
        unchecked,
        /** ★ 截断数**如实报**："没送出去"与"没有"必须不同形。 */
        truncated: {
            active: Math.max(0, activeAll.length - ACTIVE_LIMIT),
            abnormal: Math.max(0, abnormalAll.length - ABNORMAL_LIMIT),
        },
    };
}
/**
 * 一条判据明细的 schema。
 *
 * ★★ `observed` **required** 是这一格的全部要点（t41）：它必须**显式在场**，
 *   否则 client 拿不到画"观察模式"底纹所需的布尔。`required: true` 把这条纪律
 *   写进**契约**而不是只写在注释里 —— 一个漏写 `observed` 的实现会当场不匹配。
 */
const GATE_VIEW_ENTRY_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        id: { type: 'string', required: true },
        verdict: { type: 'string', required: true },
        /** ★★ 显式布尔，且**必填**（见上）。 */
        observed: { type: 'boolean', required: true },
        count: { type: 'number' },
        produced: { type: 'boolean' },
    },
};
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx, clock, runtime, scheduler, config) {
    ctx.tools.register(defineTool({
        name: 'agent_teams_status',
        description: 'Team snapshot: members with live activity and tasks with status/assignee/dependencies/output. Captains also see every team mailbox; members see only their own inbox. Use after mailbox progress deliveries or for an explicit status request. After dispatch, end your turn while members work; do not repeatedly poll.',
        parameters: {},
        output: {
            /**
             * ── ★★ 这一格此前是 `additionalProperties: true, properties: {}`（t14 修）────
             *
             * MEASURED（2026-10-06，t14）：`agent_teams_status` 是**唯一**一个"看起来没坏"
             * 的工具 —— 上面那条臂跑到它的时候是绿的。而它绿的原因不是"声明对了"，
             * 是**它什么都没声明**：一个 `additionalProperties: true` 的空 schema
             * 接受任何对象，于是"字段加进去了"与"字段被声明了"在这里**同形**。
             *
             * ⇒ 这是同族缺陷的**另一种极端**，而且比 `additionalProperties: false` 那种
             *   更难发现：前者至少会当场炸（本任务就是被炸出来的），后者**永远安静**，
             *   直到有人真的想用 schema 读这份快照为止。
             *
             * ★ 修成闭合声明：`status` 的快照字段全部列出，四个诊断字段里它真的会返回的
             *   两格（`input_surface` / `runtime_gates`）由 `diagnosticFields` 取。
             * ★ 修成闭合声明。★ 而**这一版不是第一版**：第一版我手写了十来个"看起来该有"
             *   的属性，`scripts/capabilities.test.mjs` 当场在真实路径上炸了 ——
             *
             *     tool "agent_teams_status" returned invalid output:
             *     "value.halted" / "value.escalated" / "value.loop_state" /
             *     "value.loop_summary" / "value.deliverable" / "value.coverage" /
             *     "value.delivery" / "value.member_inbox" / "value.member_inboxes" /
             *     "value.mailbox_warnings" / "value.mailbox_warning_count"
             *     — not a declared property (additionalProperties: false)
             *
             *   ⇒ **同一个缺陷、同一个方向、同一个下午**：手写一份声明面，它必然落后于
             *     真实的产出面。把这一格改成 `additionalProperties: true` 会让我自己的
             *     夹具全绿，而那等于把 `status` 退回原样（"没声明"与"声明对了"再次同形）。
             *   ⇒ 所以下面这张属性表是**照着 `execute` 的返回对象逐个抄下来的**
             *     （见 `const result = { … }`），并由
             *     `scripts/gate-tool-output-schema.test.mjs` 的臂 4 逐工具核对。
             */
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    team_id: { type: 'string' },
                    team_name: { type: 'string' },
                    /**
                     * ── ★★★ 2026-10-20：这个队**声明了什么形态**、以及**它是不是真那样在跑** ──
                     *
                     * `src/capabilities.ts:185` 与 `src/types.ts:1273` 早就引用了一个叫
                     * `describeTeamShape` 的出口，而它**此前不存在** —— 注释里写好了去向、
                     * 代码里没有那一步（本仓记账的那类形态）。
                     * ⇒ 现在它真的存在，并且由这一格接上。
                     *
                     * ★★ 三格**并列而不合并**，因为它们是三个不同的事实：
                     *   `shape`            —— **声明**（缺席 = 存量队，判不了，**不是**任何一种）
                     *   `execution`        —— **执行读数**的三态（not-applicable / measured / unmeasured）
                     *   `execution_violations` —— 干过活却一个临时 worker 都没派的成员
                     *   ★ 把后两者合成一个布尔，"合规"与"我没能测"就会同形 —— 而那正是
                     *     上一轮形态验证记下的那个缺口。
                     */
                    team_shape: { type: 'string', required: true },
                    shape_execution: { type: 'string', required: true },
                    shape_violations: { type: 'array', required: true, items: { type: 'string' } },
                    description: { type: 'string' },
                    phase: { type: 'string' },
                    /**
                     * 质量循环的五个读数（`describeQualityLoop`）—— 第一版全漏了。
                     * ★ 类型逐条对着 `QualityLoopSnapshot` 抄：`deliverable` 是 **boolean**
                     *   （我第一版写成 string，TS2322 当场指出）—— 这正好说明"声明面必须与
                     *   真实的产出面逐字一致"不是一句口号：类型系统在这里就是第一道臂。
                     */
                    halted: { type: 'boolean' },
                    escalated: { type: 'boolean' },
                    loop_state: { type: 'string' },
                    loop_summary: { type: 'string' },
                    deliverable: { type: 'boolean' },
                    /**
                     * ★ `coverage` 是**数组**（每条目标一条 `{goal_item, task_ids, status, evidence?}`），
                     *   不是对象 —— 我第一版写成 object，TS2322 当场指出。逐条对着
                     *   `canDeclareDelivery` 的返回抄。
                     */
                    coverage: { type: 'array', items: { type: 'json' } },
                    /**
                     * ★ `delivery` 是**这一格自己的**嵌套：它的字段集由本文件产出，
                     *   所以闭合声明。它的 `input_surface` 是 delivery 位置的核对结论
                     *   —— 挂在这里而不是顶层，与 `execute` 里的落点逐字一致。
                     */
                    delivery: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            ok: { type: 'boolean' },
                            /**
                             * ── ★★ 这个位置的三态各有自己的字段（t35 / f-0017）────────────────────
                             *
                             * MEASURED（verifier6 的普查臂 1/2/3）：此前这里**只有** `blockers`，
                             * 而"没能测量"在 `execute` 里被**拼进 blockers 数组**
                             * （`could not measure: …`）。
                             *
                             * ⇒ 后果不是"措辞不够清楚"，是**结构上无处安放**：这个对象是
                             *   `additionalProperties: false`，字段集就是上面那几个 ——
                             *   于是"没能测量"**只能**挤进 `blockers`。
                             *
                             * ★ 而 `blockers` 的原意是「**测出来了、是坏的**」。把"没能测量"
                             *   并进去，等于把两种相反的事实放进同一个出口：
                             *
                             *     测到了问题  ⇒ 去修产物
                             *     没能测量    ⇒ 去接线 / 去看基础设施
                             *
                             * ★★ 而 `delivery` 今天**恒** unmeasured（`coverage` 与 `convergence`
                             *   两格在没有 goal 矩阵 / 没有成员观察时必报）⇒ 那是一条**每次都出现**
                             *   的假拒绝理由。一个恒常出现的假告警不会只是"多报一次"，它会教人
                             *   **永久忽略整个 `blockers` 字段** —— 那正是本队反复记账的代价。
                             *
                             * ⇒ 与**同位置的另一个入口** `declare_delivery` 同形：它早已用独立分支
                             *   （`throwWithSurface`）把 unmeasured 与 blockers 分开。两处的 ctx
                             *   逐字段相同（刻意设计）⇒ **ctx 相同保护不了消费方式**，
                             *   读法必须各自正确。
                             *
                             * ★ 缺席（`undefined`）与空串不同形：没产出这一格 ⇒ 属性不出现。
                             */
                            unmeasured: { type: 'string' },
                            blockers: { type: 'array', items: { type: 'string' } },
                            gates_evaluated: { type: 'number' },
                            input_surface: inputSurfaceSchema(),
                        },
                    },
                    /**
                     * ★ `runtime_gates` 是顶层那一格（`runtimeRecord`）；泛用名 `input_surface`
                     *   **不在顶层** —— delivery 的核对结论挂在 `delivery.input_surface` 里。
                     *   ⇒ 这里只取 `runtimeGates`，不取 `inputSurface`：
                     *     声明一个它从不返回的字段，与漏声明一个是同一条错误的两个方向。
                     */
                    /**
                     * ── ★★ 部署状态：**从插件进程**读到的构建新鲜度（t34 / f-0027）─────────────
                     *
                     * ── 它修的是什么 ──────────────────────────────────────────────────────────
                     *
                     * MEASURED（f-0027，captain 记的）：此前 captain 只能**用命令行**问检测器：
                     *
                     *     node -e "import('./lib/tools.js').then(m => m.moduleFreshness())"
                     *
                     * ★ 而那条命令**每次都起一个新进程**、加载**最新的** `lib/` ⇒
                     *   它读到的 `loaded` 永远是它自己刚加载的那一份 ⇒ **必然报 `current`**。
                     *   ⇒ 「重启后检测器说 current」那句话**从来没有测过插件进程**。
                     *
                     *   证据（他实测的两次读数）：`loaded` 从 `b2103754…` 变成 `670b5c22…`
                     *   —— 而那是**两个命令行进程各自加载的**，不是插件进程变过。
                     *
                     * ★ 形态：**「读错位置的出口」的又一实例** ——
                     *   从一个不属于那个位置的地方读了值。
                     *
                     * ── 为什么挂在 `status` 上 ───────────────────────────────────────────────────
                     *
                     *   `status` 是 captain **与成员**都会调的读取入口，而新鲜度是"这个进程"的属性
                     *   —— 谁调它，读到的都是**同一个插件进程**的真相。
                     *   ⇒ 一次 `status` 就能回答"我该不该重载"，不必再猜。
                     *
                     * ── ★ 三态不同形，且**不参与裁决** ─────────────────────────────────────────
                     *
                     *   `current` / `stale` / `unknown` 三态由 `ModuleFreshness` 给出，
                     *   而**读不到**与**一致**必须不同形（`unknown` ≠ `current`）。
                     *   ★ 它是**部署状态的读数**，不是判据结论 ⇒ **不得**让 `status` 因此拒绝。
                     *     让它有否决权会把"这个进程旧了"变成"你这次读取失败"。
                     */
                    /**
                     * ── ★★ 重载排队状态（t49）──────────────────────────────────────────────
                     *
                     * ★ 它回答 captain 的一个具体问题：**我现在能不能继续派发？**
                     *   一旦有申请在排队，答案就是"不要" —— 因为每派发一个新任务，
                     *   就把闸门推得更远（用户的实测矛盾正是这样形成的）。
                     *
                     * ★★ 三态不同形（本队反复学到的那条）：
                     *     `none`    —— 没申请
                     *     `waiting` —— 已申请且**等得到**（附 `waiting_on`）
                     *     `stuck`   —— 已申请但**等不到**（要人工介入）
                     *   ★ 把后两者写成同一形状，读的人会**一直等一个不会发生的事**。
                     */
                    reload: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            /** `'none'` / `'waiting'` / `'stuck'` —— 三态。 */
                            status: { type: 'string', required: true },
                            /** ★ `'waiting'` 与 `'stuck'` 时在场：申请的时刻。 */
                            requested_at: { type: 'number' },
                            /** ★ 还要等哪些任务（`none` 时缺席）。 */
                            waiting_on: { type: 'array', items: { type: 'string' } },
                            /** ★ `true` = **不要继续派发**（申请在排队）。 */
                            hold_dispatch: { type: 'boolean', required: true },
                            /** ★ `stuck` 时的成因（`waiting` 时缺席 ⇒ 两态不同形）。 */
                            reason: { type: 'string' },
                            /** ★ 一句人话。 */
                            message: { type: 'string', required: true },
                        },
                    },
                    deployment: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            /** ★ 三态之一；**`unknown` 必须与 `current` 不同形**。 */
                            status: { type: 'string', required: true },
                            /** 加载时读到的那份指纹（`unknown` 且加载时也读不到 ⇒ 缺席）。 */
                            loaded: { type: 'string' },
                            /** 此刻盘上的指纹（`unknown` 且盘上也读不到 ⇒ 缺席）。 */
                            on_disk: { type: 'string' },
                            /** 未能测量时的成因（`unknown` 时在场）。 */
                            reason: { type: 'string' },
                            /** ★ 一句人话（含"该不该重载"）。 */
                            message: { type: 'string', required: true },
                            /**
                             * ── ★★ f-0026：两个 git 维的字段（与 `loaded` / `on_disk` 并列）──────
                             *
                             * ★ 它们**不合成一个布尔**：`output` 维问的是「盘上自本进程启动以来
                             *   有没有被 rebuild 过」，`commit` 维问的是「本进程加载的是哪个
                             *   commit 的代码」—— 两个问句，各自可读。
                             *
                             * ★ 这正是本任务要修的那一格：进程启动【之前】盘上就已经是当前版时，
                             *   两个 output 相等 ⇒ 旧读数恒报 `current`，而那时的代码仍可能是
                             *   更早 commit 的。⇒ 少了这一维，那个情形**没有任何出口报得出来**。
                             */
                            built_commit: { type: 'string' },
                            head: { type: 'string' },
                            /** 落后的是哪一维（`stale` 时在场；`content` / `commit` / `both`）。 */
                            stale_why: { type: 'string' },
                            /** ★ 落后于哪个提交（只在 commit 维真的落后时在场）。 */
                            behind: { type: 'string' },
                            /**
                             * ── ★★★ t84：**检出**那一支 —— 与上面那一支并列，不合并 ──────────────
                             *
                             *   上面问「**这个进程**手里的是旧代码吗」；这里问「**这个检出**比主干旧吗」。
                             *   ★ 两者独立，而补救动作不同（重启 vs 重切分支）。
                             *
                             * ★ 而它**嵌一层**是因为名字冲突：上面那个 `behind` 是 **string**（一个 hash），
                             *   这里的是 **number**（一个计数）。摊平会让读的人拿错。
                             */
                            worktree: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    /** ★ 三态之一：`current` / `behind` / `undecidable`。 */
                                    status: { type: 'string', required: true },
                                    /** ★ 落后几个提交（**计数**，只在 `behind` 时在场）。 */
                                    behind: { type: 'number' },
                                    /** 主干的尖端（`current` / `behind` 时在场）—— 人可据此核对。 */
                                    trunk: { type: 'string' },
                                    /** 本检出的 HEAD。 */
                                    head: { type: 'string' },
                                    /** 未能测量时的成因（`undecidable` 时在场）。 */
                                    reason: { type: 'string' },
                                    /** ★ 一句人话（含后果与补救动作）。 */
                                    message: { type: 'string', required: true },
                                },
                            },
                        },
                    },
                    ...diagnosticFields({ runtimeGates: true }),
                    /**
                     * ── ★★★ A1：判据视图的 schema ────────────────────────────────────────────
                     *
                     * ★ 为什么这里**不用** `{ type: 'json' }`（`runtimeGatesSchema` 用的那个）：
                     *   那一格的措辞理由是"**这一格里的东西不属于本文件**"（`runtime_gates`
                     *   装的是判据注册表的裁决形状）。而 `gate_view` 是**本文件自己组装**的
                     *   （`buildGateView`），它的形状**属于本文件** ⇒ 该写全。
                     *   ⇒ ★ 这是**刻意的不同**，不是遗漏：形状的"家"在哪，schema 就该写到哪。
                     *
                     * ★ 四类字段**全部 required**：它们**恒在场**（见上面 `gate_view: gateView`
                     *   的注释）。空数组是合法值，**字段缺席不是**。
                     */
                    gate_view: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            points: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    additionalProperties: false,
                                    properties: {
                                        point: { type: 'string', required: true },
                                        registered: { type: 'number', required: true },
                                        evaluated: { type: 'number', required: true },
                                        ok: { type: 'number', required: true },
                                        blocked: { type: 'number', required: true },
                                        unmeasured: { type: 'number', required: true },
                                        skipped: { type: 'number', required: true },
                                    },
                                },
                            },
                            active: { type: 'array', items: GATE_VIEW_ENTRY_SCHEMA },
                            abnormal: { type: 'array', items: GATE_VIEW_ENTRY_SCHEMA },
                            /**
                             * ★★ 第 ④ 类：**「未检查」**（`skippedAll` 在场的位置）。
                             *   它是 t41 新增的那一格，**不许漏** —— 漏了之后"挂了判据却一条没检查"
                             *   就只剩 `evaluated: 0`，而那个数与"空位置"同形（两者都是 0）。
                             */
                            unchecked: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    additionalProperties: false,
                                    properties: {
                                        point: { type: 'string', required: true },
                                        registered: { type: 'number', required: true },
                                        evaluated: { type: 'number', required: true },
                                    },
                                },
                            },
                            /** ★ 截断读数：被上界截掉的条数（"没送"与"没有"不同形）。 */
                            truncated: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    active: { type: 'number', required: true },
                                    abnormal: { type: 'number', required: true },
                                },
                            },
                        },
                    },
                    profile: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {
                            name: { type: 'string' },
                            protocol: { type: 'string' },
                            task_planning: { type: 'string' },
                        },
                    },
                    viewer: { type: 'string' },
                    /**
                     * ── ★★★ t4：成员行上的【会话存活读数】───────────────────────────────────
                     *
                     * 见 `src/members.ts` 的 `LivenessReadout` —— 它是本任务的全部意义：
                     * 一个成员死了而 `status` 仍是 `working` 时，此前**没有任何一格**
                     * 能把这件事说出来（DISPATCH-RULES §39）。
                     *
                     * ★ 声明在这里的另一半理由是**结果判据**：这一格若只改产出、不改 schema，
                     *   宿主会在 `createSuccessResult` 里当场拒掉**每一次** `status` 调用
                     *   （`additionalProperties` 在这里是 `true`，所以这次不会 —— 但若有人
                     *   以后把它收紧成 `false`，声明必须已经在了）。★ 本队记账第 9 次
                     *   （"改产出、没改声明"）就是这么发生的。
                     */
                    members: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: true,
                            properties: {
                                /** ★ 三态之一：`live` / `not-live` / `could-not-measure`（外加 `never-spawned`）。 */
                                liveness: { type: 'string' },
                                /** ★ 存活读数的细分（`driver-absent` / `live-running` / …）。 */
                                liveness_readout: { type: 'string' },
                                /** ★ 未能测量时的成因（`could-not-measure` 时在场）。 */
                                liveness_reason: { type: 'string' },
                                /** ★ 名下有在飞任务而会话已不在 ⇒ 有一份工作悬在半空。 */
                                stranded: { type: 'boolean' },
                                /** ★ 悬着的那几个任务 id（`stranded` 时在场）。 */
                                stranded_tasks: { type: 'array', items: { type: 'string' } },
                            },
                        },
                    },
                    tasks: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: true,
                            properties: {
                                /**
                                 * ── ★★★ t12：一次 `failed` 的细分 ──────────────────────────────────
                                 *
                                 * 三态，且三者在**读法上不同形**（见上面 `execute` 里那段：
                                 * `inconclusive` = "审查者找到了问题，这一步做对了"，
                                 * `failed_delivery` = "交付物确实坏了"，
                                 * `failed_context` = "没有证据说它坏了" —— 缺省即最保守）。
                                 *
                                 * ★ 它**只**在 `status === 'failed'` 时在场；其余任务上缺席 =
                                 *   "这一格对它不适用"（与 `reload` / `deployment` 同一条纪律）。
                                 */
                                failure_kind: { type: 'string' },
                            },
                        },
                    },
                    captain_inbox: {
                        type: 'array',
                        items: { type: 'object', additionalProperties: true, properties: {} },
                    },
                    /** ★ 成员视角的两格收件箱 + 两格告警 —— 第一版也全漏了。 */
                    member_inbox: {
                        type: 'array',
                        items: { type: 'object', additionalProperties: true, properties: {} },
                    },
                    member_inboxes: { type: 'object', additionalProperties: true, properties: {} },
                    mailbox_warnings: { type: 'array', items: { type: 'string' } },
                    mailbox_warning_count: { type: 'number' },
                    /**
                     * ── ★★★ t4：残留 `working` 的**后果面**（DISPATCH-RULES §39.2）──────────
                     *
                     * ★ 为什么它**必须**与 `members[].liveness` 并列，而不是被它代替：
                     *   「那个成员会话没了」这句事实**不改变任何人的下一步** —— 队长会想
                     *   "那我重派"，而重派救不回那棵树的产物（新会话从当前 HEAD 起）。
                     *   真正决定下一步的是"有没有东西会因此丢掉"。
                     *
                     * ★ 三态：`clear` / `frozen` / `could-not-measure`。
                     *   `clear` 与 `could-not-measure` **必须不同形** —— 后者被读成前者，
                     *   会让一次 git 故障变成一句"没有东西会丢"，而那正是抢救那一步的
                     *   唯一依据。
                     */
                    stranded_work: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            /** ★ 三态之一。 */
                            status: { type: 'string', required: true },
                            /** ★ 一句人话（含**补救动作**）。 */
                            message: { type: 'string', required: true },
                            /** ★ 读了几个成员的树（`clear` / `frozen` 时在场）。 */
                            checked: { type: 'number' },
                            /** ★ 冻着的树（`frozen` 时在场）—— 逐棵给出**抢救落点**。 */
                            worktrees: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    additionalProperties: false,
                                    properties: {
                                        path: { type: 'string', required: true },
                                        name: { type: 'string', required: true },
                                        dirty: { type: 'number', required: true },
                                    },
                                },
                            },
                            /** ★ 未能测量时的成因（`could-not-measure` 时在场）。 */
                            reason: { type: 'string' },
                        },
                    },
                    /**
                     * ── ★★★ t6（N3）：计划审查读数 ────────────────────────────────────────────
                     *
                     * ★ 形状**属于本文件吗**？—— 属于（`readPlanReview` 在 `shared/entities.ts`，
                     *   而它的聚合规则是这一格的定义）。⇒ 按本文件 `gate_view` 那条纪律，
                     *   形状的"家"在哪，schema 就写到哪：**写全**，不用 `{ type: 'json' }`。
                     *
                     * ★★ 三态**全部**在同一条 `state` 上分开，而 `readout` 那一栏**只在
                     *   `measured` 时出现** —— 缺了它，`unmeasured` 与"读到一份全是 0 的读数"
                     *   在 `Object.hasOwn` 那一层同形。
                     */
                    plan_review: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            /** ★ `measured` / `unmeasured` —— 两态。 */
                            state: { type: 'string', required: true },
                            /** ★ `unmeasured` 时的成因（`why` **不**与"没有缺口"同形）。 */
                            why: { type: 'string' },
                            readout: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    /** 读到的契约条数（**不是**"有几条合格"）。 */
                                    total: { type: 'number', required: true },
                                    /**
                                     * ★★ 契约原文要求的**三态同形**：`present` / `missing` / `unmeasured`
                                     *   **逐字**出现在这里，**不折成布尔**。
                                     *   `present: true` 与 `missing` / `unmeasured` 会读成同一件事，
                                     *   而它们的下一步动作相反（一个不用管、一个去补、一个去接线）。
                                     */
                                    overall: { type: 'string', required: true },
                                    detail: { type: 'string', required: true },
                                    /**
                                     * ★ 第二个问句（见 `readPlanReview` 那段裁定）：只看
                                     *   **契约要求的那几问**。与 `overall` 并列，不互相顶替。
                                     */
                                    applicable_overall: { type: 'string', required: true },
                                    /**
                                     * ★ 三档计数。**缺席 = 三档没读出来**（成因在 `tiers_why`）——
                                     *   不许折成 `{small:0,large:0,unmeasurable:0}`：三个 0 是
                                     *   "这一队真的没有大活"，而读不出来是"我不知道"。
                                     */
                                    tiers: {
                                        type: 'object',
                                        additionalProperties: false,
                                        properties: {
                                            small: { type: 'number', required: true },
                                            large: { type: 'number', required: true },
                                            unmeasurable: { type: 'number', required: true },
                                        },
                                    },
                                    tiers_why: { type: 'string' },
                                    questions: {
                                        type: 'array',
                                        required: true,
                                        items: {
                                            type: 'object',
                                            additionalProperties: false,
                                            properties: {
                                                key: { type: 'string', required: true },
                                                question: { type: 'string', required: true },
                                                present: { type: 'number', required: true },
                                                missing: { type: 'number', required: true },
                                                unmeasured: { type: 'number', required: true },
                                                /**
                                                 * ★ 第四格：**契约不要求**这一问（见 `readPlanReview` 的裁定）。
                                                 *   ★ 它**不是** `present` 的别名 —— 混进去就是把
                                                 *     "根本没有这一格"洗成"这一格合格了"。
                                                 */
                                                not_applicable: { type: 'number', required: true },
                                            },
                                        },
                                    },
                                    /** ★ 「缺哪一问」的**逐条名单**（不只是计数）。 */
                                    gaps: {
                                        type: 'array',
                                        required: true,
                                        items: {
                                            type: 'object',
                                            additionalProperties: false,
                                            properties: {
                                                id: { type: 'string', required: true },
                                                key: { type: 'string', required: true },
                                                /** ★ `missing`（填了但读不出读数）与 `unmeasured`（没有那一格）不同形。 */
                                                status: { type: 'string', required: true },
                                                detail: { type: 'string', required: true },
                                            },
                                        },
                                    },
                                    /** ★ 「不适用」的逐条名单 —— 与 `gaps` **分开**（那是噪音，这不是缺口）。 */
                                    not_applicable: {
                                        type: 'array',
                                        required: true,
                                        items: {
                                            type: 'object',
                                            additionalProperties: false,
                                            properties: {
                                                id: { type: 'string', required: true },
                                                key: { type: 'string', required: true },
                                                why: { type: 'string', required: true },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    /**
                     * ── ★★★ N5 / t8：计划审查环（`agent_teams_status` 的 `planLoop` 一节）────────
                     *
                     * 用户原话（m01373）：
                     * > 「加进去，然后计划是否能开始跑也是希望有一个门禁把关，
                     * >   其实就是计划的审查循环是否可以结束的问题。」
                     *
                     * ★★★ **为什么这一节必须存在**（N5.13）：改之前，`planReviewState` / 轮次
                     *   在 status 里**一格都没有**，而 `approveStagedTeam` 又 `delete` 掉
                     *   `planReviewState` ⇒ 「这个计划审了几轮才通过」这条读数**在批准之后永久消失**，
                     *   而那恰恰是自迭代最需要的那一条。
                     *   ★ 更糟的是同一行 `phase: team.phase ?? 'running'` 会把一个**还是 staged
                     *     的团队**读成 `running` —— N5.13 说"读不到"是**低估**，读到的是**错的**。
                     *
                     * ★★ 四格 `{state, rounds, maxRounds, reason}` 全部 `required`：
                     *   缺任何一格都会让"这个环会不会自己停"退回成"去读散文"。
                     *
                     * ★★ 三态**不同形**（本仓那条最贵的纪律）：
                     *   `state` 的五态里 `escalated` 与 `approved` 互为否定，**不许折成布尔** ——
                     *   `halted` / `reviewing` / `awaiting-review` 都不是这两者之一，
                     *   而"折成 canEnd: false"会让一个**被人停住的**计划与一个**审到顶的**计划同形，
                     *   两者的下一步动作相反（一个去 resume，一个去归零）。
                     *   ⇒ 所以 `canEnd` 只作为**便捷**并列给出，权威读数是 `state`。
                     *
                     * ★★ `roundsSource` 是第三个不能省的三态格：存量团队**没有**
                     *   `planReviewRounds` ⇒ 我们按 `0` 读，而"我把它读成 0"与"它确实是 0"
                     *   必须不同形 —— 后者会让存量团队看起来像"审了 0 轮就通过"。
                     *
                     * ★ `surfaces` 是**读数不是闸**：分档层（large 必须带 reviewed 戳）已被
                     *   对抗性审查推翻并**明文砍掉**，不许重装。理由：它的判据方向是**反的**
                     *   （奖励少写 inScope、惩罚诚实声明），且能被被审方自己缩域绕过。
                     *   所以这一格一个字都不参与放行，只回答"这一份计划被看清楚了没有"。
                     */
                    plan_loop: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            /**
                             * ★ 五态，**逐字**：`halted` / `awaiting-review` / `reviewing` / `escalated` / `approved`。
                             *   顺序即语义（判定顺序写在 `describePlanLoop` 上）。
                             */
                            state: { type: 'string', required: true },
                            /** ★ 已发生的轮次。★ 与 `roundsSource` 一起读，否则"0"有两种含义。 */
                            rounds: { type: 'number', required: true },
                            /** ★ 模块常量上限（**不是**从 `reviewPolicy` 取 —— 见那里注释）。 */
                            maxRounds: { type: 'number', required: true },
                            /** ★★ 这一层真正的产出：逐字说清"为什么还不能结束"。 */
                            reason: { type: 'string', required: true },
                            /** ★ 便捷读数；**权威**是 `state`（见上面那条折成布尔的警告）。 */
                            canEnd: { type: 'boolean', required: true },
                            /**
                             * ★ `persisted`（盘上有真值）/ `absent`（存量团队，按 0 读）。
                             *   ★ 不许并进 `rounds` —— 那会让"读成 0"与"确实是 0"同形。
                             */
                            roundsSource: { type: 'string', required: true },
                            /**
                             * ★★ 契约表面的三态读数（**读，不拦**）。
                             *   `readable` / `unreadable`（真缺口，写类任务没有 inScope）/
                             *   `notApplicable`（噪音，非写类任务本来就不要求）。
                             *   ★ 后两者并成一个"缺"会让噪音淹没缺口；并成一个"齐"会让缺口消失。
                             */
                            surfaces: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    total: { type: 'number', required: true },
                                    readable: { type: 'number', required: true },
                                    unreadable: { type: 'number', required: true },
                                    /** ★ 逐条点名，不只是计数 —— 计数不是证据，只有"哪几条"是。 */
                                    unreadableIds: { type: 'array', required: true, items: { type: 'string' } },
                                    notApplicable: { type: 'number', required: true },
                                    notApplicableIds: { type: 'array', required: true, items: { type: 'string' } },
                                },
                            },
                        },
                    },
                },
            },
            render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
        },
        async execute(_args, exec) {
            const caller = requireCaptain(exec);
            const workspace = workspaceOf(caller);
            const stateRoot = stateRootOf(workspace, config);
            const located = await requireParticipantTeam(workspace, config, caller);
            /**
             * ── ★★★ #176（乙）：队长那一半走活的 fork 链（t98）─────────────────────────
             * ★ 这里决定"要不要 kick 队" —— 若 fork 出来的队长认不出自己的队，
             *   那一次 kick 会**静默不发生**（而"没 kick"与"没什么可 kick"同形）。
             */
            if (sessionLeadsTeam(caller.id, identityOfTeam(located), liveRefsOf(ctx))) {
                await scheduler.kickTeam(workspace, located.id, caller);
            }
            const { team, identity } = await withTeamLock(teamLockKey(stateRoot, located.id), () => requireFreshParticipant(stateRoot, located.id, caller.id));
            const activity = memberActivity(ctx, team.members.map((member) => member.id));
            /**
             * ── ★★★ t4：`working` 是【残留状态】—— 这里第一次给它一个出口 ───────────────
             *
             * MEASURED（DISPATCH-RULES §39）：用户说「没有成员在跑」，而检测器说
             * 「在推进（成员 working: pipeline-author, decompose-author, wire-author）」。
             * 队长发探针 ⇒ **`active teammate not found`** ⇒ 那三个会话**不在了**，
             * 而 `team.json` 里的 `working` 是残留。
             *
             * ★ 结构上为什么此前看不见：检测器已有的信号是「`status === 'idle'` 而名下
             *   有未完成」；残留 `working` 是**反过来**的（`status === 'working'` 而
             *   会话不在），而 `team.json` 里【没有任何一格】表示"那个会话还活着"。
             *
             * ── ★★ 而它**不需要队长手工发探针** ─────────────────────────────────────────
             *
             * `memberLiveness` 问的是 `ctx.agents.get(id)` —— 那正是
             * `deliverToMemberDetailed` 投递给那个成员时会走的那条路（投递失败的那一刻
             * 就是 `active teammate not found`），只是**不投递**。
             * ⇒ 判据旁路、不改系统、不需人为触发。
             *
             * ── ★★★ 而它**不能**拒绝（验收第 3 条）──────────────────────────────────────
             *
             * `memberLiveness` 返回的每一支都带 `rejects: false`（**字面量类型**）——
             * 于是"拿它当拒绝理由"这件事**编译不过**（见 `members.ts` 的
             * `LivenessReadout`）。这是类型级的保证，不是约定。
             */
            const livenessById = new Map(team.members.map((member) => [member.name, memberLiveness(ctx, member)]));
            /** ★ 在飞的任务 = 非终态、且真的有人认领 —— 这正是"悬在半空"的那部分。 */
            const openTasksByMember = new Map();
            for (const task of team.tasks) {
                if (TERMINAL_TASK_STATUSES.includes(task.status))
                    continue;
                const assignee = task.assignee;
                if (assignee === undefined || assignee === '')
                    continue;
                openTasksByMember.set(assignee, [...openTasksByMember.get(assignee) ?? [], task.id]);
            }
            const members = team.members
                .filter((member) => member.status !== 'removed')
                .map((member) => {
                const live = livenessById.get(member.name) ?? memberLiveness(ctx, member);
                const open = openTasksByMember.get(member.name) ?? [];
                const stranded = strandedWork(live, open);
                return {
                    name: member.name,
                    role: member.role ?? '',
                    provider: member.provider ?? '',
                    model: member.model ?? '',
                    reasoning_effort: member.reasoningEffort ?? '',
                    status: member.status,
                    activity: member.id !== '' ? (activity.get(member.id) ?? 'unknown') : 'unspawned',
                    /**
                     * ★ 五态**各自在场**（不是"只有异常时才有"）：缺席与"没有这个概念"
                     *   同形，而"没能测量"必须看得见 —— 同 `deployment` / `reload` 那条纪律。
                     */
                    liveness: live.state,
                    liveness_readout: live.readout,
                    ...live.state !== 'could-not-measure' ? {} : { liveness_reason: live.reason },
                    /**
                     * ★ 两格并列、**不合并**：`stranded` 是"记录说它有事、而会话没了"，
                     *   而真正要人去做的动作挂在下面的 `stranded_work` 上。
                     *   把它折成一个布尔会让读的人以为"重派一次就行"。
                     */
                    stranded,
                    ...stranded ? { stranded_tasks: open } : {},
                    ...member.spawnError === undefined ? {} : { spawn_error: member.spawnError },
                };
            });
            /**
             * ── ★★★ t4：残留 `working` 的**后果面**（§39.2）────────────────────────────
             *
             * 「会话没了」本身不改变下一步；改变下一步的是「有没有东西会因此丢掉」。
             * §39.2 逐字记着那个代价：t39 的树 12 个文件未提交（含 300 行改动），
             * 而"按 working 当它在跑而等着"⇒ 那些改动**永远冻在那儿**。
             *
             * ★ 树名必须用 `worktreeDirName(teamId, taskId)` 算（`task-<team>-<task>`）——
             *   它与建树、找树用的是**同一个函数**。按成员名拼是**第二份真相**，而它会
             *   静默地读一个不存在的目录（实测：本格第一版就是这么错的）。
             */
            const frozenCandidates = members
                .filter((member) => member.liveness === 'not-live' && member.stranded === true)
                .flatMap((member) => (openTasksByMember.get(member.name) ?? []).map((taskId) => ({
                member: member.name,
                path: join(workspace, '.agent-teams', 'worktrees', worktreeDirName(located.id, taskId)),
                name: worktreeDirName(located.id, taskId),
            })));
            const strandedWorktreesReadout = strandedWorktrees(frozenCandidates, (tree) => {
                const dirty = gitChangedPaths(tree);
                return dirty === undefined ? undefined : dirty.length;
            });
            const tasks = team.tasks.map((task) => ({
                id: task.id,
                subject: task.subject,
                status: task.status,
                assignee: task.assignee ?? '',
                dependencies: task.dependencies,
                attempt: task.attempt ?? 0,
                attempt_id: task.attemptId ?? '',
                reassigning: task.reassigning === true,
                kind: taskKindOf(task),
                ...task.round === undefined ? {} : { round: task.round },
                ...task.verdict === undefined ? {} : { verdict: task.verdict },
                /**
                 * ── ★★★ t12：`failure_kind` —— 把已经算好的细分**送到读者手里**────────────
                 *
                 * ── 它修的是什么（本任务的全部意义）──────────────────────────────────────────
                 *
                 * MEASURED（开工时的普查）：`failureKindOf` 在 `src/state.ts` 里**早就**实现了
                 * 四态细分（t26 做的），判据顺序是"最确定 → 最保守"：
                 *
                 *     ① `inconclusive`     —— 有 verdict 的失败（`needs_revision` / `reject`）
                 *         ★ 它是 review/requirements 类任务的**结论**：那类任务的性质就是"找问题"，
                 *           找到即交付 ⇒ **它不是"做砸了"**。
                 *     ② `failed_delivery`  —— 有**实测证据**说交付物本身坏了（验收项 failed /
                 *                             verify 命令非 0 退出）。
                 *     ③ `failed_context`   —— 两条都不成立 ⇒ 最保守的缺省。
                 *
                 * ★★ 而它**一个 `src/` 消费者都没有**：`grep -rn failureKindOf src/`
                 *   只命中 `state.ts` 自己（下游只有一条**测试**在用）。
                 *   而本工具投影任务时此前只交 `status: task.status` ——
                 *   ⇒ **正确的区分被算出来，然后在到达任何读者之前被丢掉**。
                 *
                 * ── 为什么这比"少一个字段"更贵 ────────────────────────────────────────────────
                 *
                 * 丢掉它之后，读者手上只剩 `status === 'failed'` 这一个读数，而它把两种**相反**
                 * 的事实压成同一个形状：
                 *
                 *     「我让审查者挑毛病，它挑了 3 条出来」 ⇒ 这一步**成功了**（该修就修）
                 *     「交付物真的坏了，verify 非 0」       ⇒ 这一步**失败**了（要重做）
                 *
                 * ⇒ 补教动作完全不同，而它们在下游眼里同形。这正是本队反复记账的那条形态。
                 *
                 * ── ★ 只在 `status === 'failed'` 时在场（刻意收窄）────────────────────────────
                 *
                 * `failureKindOf` 的语义就是"**细分一次 `failed`**"（见 `src/state.ts` 的文件头）。
                 * 一条 completed / cancelled / 未终态的任务没有"哪一种失败"可言 ——
                 * 给它们也挂一个 `failure_kind` 会让读的人以为那一格对它们有意义
                 * （而 `failed_context` 恰恰是"没有证据说它坏了"的缺省，挂在一条**成功**的
                 * 任务上会被读成"这条成功了，但交付物可疑"）。
                 * ⇒ 缺席 = "这一格对这条任务不适用"，与"它没好"不同形（同 `deployment` /
                 *   `reload` 那条纪律）。★ `failureKindOf` 本身也**只**接受 `status === 'failed'`
                 *   的任务（`dependencyOutcomeOf` 在调它之前已经把其余分支都分流出去了）。
                 *
                 * ★ 不用 `...task.status !== 'failed' ? {} : {...}` 之外的任何条件：
                 *   判据是**唯一一份**（`state.ts`），本文件**不重算**它 ——
                 *   重算会造出第二份真相，而两份真相会慢慢分叉（本队记账的那条）。
                 */
                ...task.status !== 'failed' ? {} : { failure_kind: failureKindOf(task) },
                ...task.supplementalEvidence === undefined ? {} : { supplemental_evidence: JSON.stringify(task.supplementalEvidence) },
                findings_open: (task.findings ?? []).filter((finding) => finding.resolved !== true).length,
                ...task.profileSeedId === undefined ? {} : { seed_id: task.profileSeedId },
                ...task.output !== undefined ? { output: task.output } : {},
                /**
                 * ── ★★★ S2：`gate_evaluation` —— 把已落盘的判据结果**交出去** ─────────────
                 *
                 * S1（`t71`）把一次 completion 求值的结果写进了 `task.gateEvaluation`；
                 * 而在这里之前，投影任务的行一个字段都没转发它 ⇒ **正确地算出来、
                 * 正确地落了盘，然后在到达任何读者之前被丢掉**（与 `failure_kind`
                 * 在 t12 之前同一形态）。
                 *
                 * ── ★★ 三态在**本出口**上必须不同形（本仓的中心纪律）──────────────────
                 *
                 * · **字段缺席** —— 这条任务**从来没求值过** completion 判据
                 *                  （中间更新 / 终态补证据那条路径）。
                 * · **`ran: []`**  —— 求值了，但**一条判据都没跑**
                 *                  （空位置 `registered === 0`；或全跳过，`skippedAll` 在场）。
                 * · **有内容**     —— 求值了，`ran[]` 里带裁决。
                 *
                 * ★ 缺席必须用"**整个 key 不出现**"表达 —— **不许**用 `ran: []` 或
                 *   一个 `ok: true` 的空记录冒充：那会让"这一步没被检查"与
                 *   "这一步检查了、没事"在读取端同形，而二者的处置恰好相反
                 *   （`types.ts` 该字段的长注释逐字警告过）。
                 *
                 * ★ 它**原样转发**：不重算、不化简 `ran[]`（`skipped` 与 `observed`
                 *   条目原样保留）—— 这里是**记录**，不是结论的改写。
                 *
                 * ── ★ 为什么是 `JSON.stringify` 而不是直接塞对象 ──────────────────────
                 *
                 * 本工具的产出面要求 `Record<string, JsonValue>`，而 `GateEvaluationRecord`
                 * 是 interface（没有隐式索引签名）⇒ 直接塞进去过不了类型。
                 * ★ 这里**沿用紧邻那一行** `supplemental_evidence` 的既有做法，
                 *   而不是自己发明一个 `as unknown as JsonValue`：那样做会被"像是有关无处
                 *   不在对象的人"顺手按字段访问，而它其实是被计值序列化过的文本。
                 * ★ 缺席仍然是【整个 key 不出现】—— stringify 只在字段在场时发生。
                 */
                ...task.gateEvaluation === undefined
                    ? {}
                    : { gate_evaluation: JSON.stringify(task.gateEvaluation) },
            }));
            const mailboxWarnings = [];
            let mailboxWarningCount = 0;
            const reportMalformed = (agentKey) => (lineNumber) => {
                mailboxWarningCount += 1;
                if (mailboxWarnings.length < 10) {
                    mailboxWarnings.push(`${agentKey} mailbox line ${lineNumber}`);
                }
            };
            const captainInbox = identity.kind === 'captain'
                ? await readCurrentMailbox(stateRoot, team.id, CAPTAIN_KEY, reportMalformed(CAPTAIN_KEY))
                : [];
            const ownInbox = identity.kind === 'member' ? (await readCurrentMailbox(stateRoot, team.id, identity.name)).slice(0, 10) : [];
            const memberInboxes = {};
            const visibleMembers = identity.kind === 'captain'
                ? members
                : members.filter((member) => member.name === identity.name);
            for (const member of visibleMembers) {
                const messages = await readCurrentMailbox(stateRoot, team.id, member.name, reportMalformed(member.name));
                if (messages.length > 0) {
                    memberInboxes[member.name] = {
                        count: messages.length,
                        latest: messages[messages.length - 1]?.content.slice(0, 200) ?? '',
                    };
                }
            }
            const coverage = buildCoverageMatrix([...new Set(team.tasks.flatMap((item) => item.coverageOf ?? []))], team.tasks).map((row) => ({
                goal_item: row.goal_item,
                task_ids: [...row.task_ids],
                status: row.status,
                ...row.evidence === undefined ? {} : { evidence: row.evidence },
            }));
            const deliveryCheck = canDeclareDelivery(team, await deliveryAuditFor(workspace, team));
            /**
             * ── ★ delivery 位置：**报告**在这里，**拒绝**在 declare_delivery（t18/B2）────
             *
             * MEASURED（2026-10-05，本队 t16/t17）：本工具此前直接调用拒绝逻辑
             * （`rejectOnDeliveryGates`），于是一个团队只要还没收敛，队长**连"现在什么情况"
             * 都读不到** —— 而读不到状态正是他判断"该不该让它收敛"的前提。**死结**：
             *
             *     想看状态 ⇒ 被拒（因为没收敛）
             *     想让成员收敛 ⇒ 得先看状态
             *
             * ★ 根因是**「唯一的读取点」被当成了「宣告点」**。它们是两件事：
             *     · 读取（本工具）—— 随时都该能发生，否则队长瞎着眼
             *     · 宣告（`agent_teams_declare_delivery`）—— 那才是该被拒绝的那一刻
             *
             * ⇒ 现在这里**只求值、只报告**：裁决并进返回值的 `delivery` 字段（连同判据层的
             *   blockers），流程照常。拒绝由新增的 `agent_teams_declare_delivery` 承载
             *   —— **delivery 判据仍然真的会拦，只是拦在它该拦的那一步**。
             */
            const memberConvergence = observeMemberConvergence(ctx, team);
            /**
             * ── ★ 调用点②（第三条入口）：读一次会话日志，看每个成员还在不在动 ─────────
             *
             * 这里是**最自然**的观察点，理由有两条，缺一条都不够：
             *
             *   ① 它本来就在读会话（`observeMemberConvergence` 已走同一个入口），所以多读
             *      一遍 `assistant/message` **不引入新的 I/O**；
             *   ② 它是探活的**驱动时刻**（用户已裁定：10 分钟探活一次）。判据只在被调用的
             *      那一刻才说话，而"被调用"发生在这里 —— 所以**观测与探活必须是同一刻**，
             *      否则判据读到的是一个上次探活留下的陈旧读数，而它看起来与新鲜读数同形。
             *
             * ★ 观察**先于**求值：本段在下面的 `evaluateRuntimeGates` 之前跑，于是这一次
             *   求值读到的 `lastActivityAt` 是刚刚观察到的。反过来会让一次探活永远是
             *   "上一次"的视图 —— 而那正是"两次探活读数没变 ⇒ 报警"的假阳性来源。
             *
             * ★ 对**每个**未结束任务的成员都观察，不只是当前忙的那些：一个成员可能刚刚
             *   产出、然后回到 idle，而"它动过"这件事必须留在记录里（否则下一次探活会
             *   把它读成"从派发到现在一直没动"）。
             */
            const now = clock();
            for (const task of team.tasks) {
                if (TERMINAL_TASK_STATUSES.includes(task.status))
                    continue;
                if (task.assignee === undefined || task.assignee === CAPTAIN_KEY)
                    continue;
                const activeMember = team.members.find(candidate => candidate.name === task.assignee);
                if (activeMember === undefined || activeMember.id === '')
                    continue;
                observeMemberActivity(ctx, activeMember.id, task.attemptId, now);
            }
            const deliveryContext = {
                team,
                gate: deliveryCheck,
                coverage,
                members: memberConvergence.observed,
                ...memberConvergence.bypassed.length === 0 ? {} : { member_convergence_bypassed: memberConvergence.bypassed },
            };
            /**
             * ★ 只报告：这里**不**抛错。`delivery` 字段要把【两边的结论】都交出去 ——
             *   上游 `canDeclareDelivery` 的 blockers 与判据层的裁决，缺一样读日志的人就
             *   分不出"是契约层面不允许"还是"是某条判据发现了问题"。
             */
            /**
             * ★ 输入面核对（t10）：求值之前，对着**同一个** ctx。这里与 `task-status`
             *   是**两个**调用点，各自核对一次 —— 不是因为会得到不同结论，而是因为
             *   "报告"与"宣告"这两个入口必须都读得出输入面缺没缺（只在一个入口核对，
             *   另一个入口的缺失就成了只能靠日志碰运气看见的东西）。
             */
            const deliveryInputSurface = inputSurfaceOf('delivery', deliveryContext);
            const deliveryEvaluation = await registry.evaluate('delivery', deliveryContext);
            const runtimeRecord = await evaluateRuntimeGates(ctx, 'task-status', deliveryContext, clock);
            /**
             * ── ★★★ A1：判据视图（四类明细，分组由服务端做）────────────────────────────
             *
             * ★ **只组装 `status` 手里真的有的东西**，不假装六个位置都跑过：
             *   · `delivery` —— `status` 确实调了 `evaluate('delivery', …)`，
             *     于是它的 `ran[]` 是**真的读数**；
             *   · `runtime` —— 走 `evaluateRuntimeGates`，也是真的；
             *   · 其余四个位置 —— `status` **没有**它们的 ctx ⇒ 只报**静态注册数**
             *     （`registry.count(point)`）与 `evaluated: 0`。
             *
             * ★★ 为什么后面四个不写 `skippedAll`：`skippedAll` 的语义是
             *   「**挂了判据、但一条都没检查**」（`registry.ts:886-896` 的第三格）。
             *   而在这里，"没检查"的成因是 **`status` 没去求值**，不是判据被跳过。
             *   把两者写成同一个形状，会把"我没问"读成"它没跑" —— 正是本仓记账最久的形态。
             *   ⇒ 它们**不进第 ④ 类**，且 `evaluated: 0` 配 `registered: N` 已足以区分
             *     "有判据但本轮未在 status 里求值"。
             */
            const deliveryGates = registry.list().delivery ?? [];
            const gateView = buildGateView([
                ...deliveryGates.length === 0 ? [] : [{
                        point: 'delivery',
                        registered: deliveryGates.length,
                        evaluated: deliveryEvaluation.evaluated,
                        ran: deliveryEvaluation.ran,
                        ...deliveryEvaluation.skippedAll === undefined ? {} : { skippedAll: deliveryEvaluation.skippedAll },
                    }],
                ...runtimeRecord === undefined ? [] : [{
                        point: 'runtime',
                        registered: registry.count('runtime'),
                        /** ★ runtime 那一格是 `JsonValue`（别人的形状）⇒ 只取能读的字段，读不出就不编。 */
                        evaluated: typeof runtimeRecord.evaluated === 'number'
                            ? runtimeRecord.evaluated : 0,
                        ran: Array.isArray(runtimeRecord.ran)
                            ? runtimeRecord.ran
                            : [],
                        ...(typeof runtimeRecord.skippedAll === 'string'
                            ? { skippedAll: runtimeRecord.skippedAll } : {}),
                    }],
                ...NOT_EVALUATED_IN_STATUS
                    .filter((point) => registry.count(point) > 0)
                    .map((point) => ({
                    point: point,
                    registered: registry.count(point),
                    evaluated: 0,
                    ran: [],
                })),
            ]);
            /**
             * ★★ t3：这条日志**保留**（给人看）；结构化出口挂在下面 `delivery` 字段里的
             *   `input_surface`。两条并存 —— 只留日志的出口在日志被截断时与"输入面齐"同形。
             */
            if (deliveryInputSurface !== undefined && deliveryInputSurface.incomplete > 0) {
                ctx.logger.warn(`agent-teams: the status read reached the delivery gate with an unfinished input surface (recorded, not rejected): ${deliveryInputSurface.missing.join('; ')}`);
            }
            const delivery = {
                ok: deliveryEvaluation.ok === false ? false : deliveryCheck.ok,
                /**
                 * ── ★★ "没能测量"有**自己的**出口，不再拼进 blockers（t35 / f-0017）─────────
                 *
                 * MEASURED（verifier6 的普查臂 1/2/3）此前这里是：
                 *
                 *     blockers: [ ..., ...deliveryEvaluation.unmeasured === undefined
                 *                    ? [] : [`could not measure: ${deliveryEvaluation.unmeasured}`] ]
                 *
                 * ⇒ 把「没能测量」写进了「测出来了、是坏的」那个数组。★ 而这不是措辞问题：
                 *   读者按字段名判断**该去修什么**，而两种事实的补救动作相反：
                 *
                 *     测到了问题  ⇒ 去修产物（交付确实不合格）
                 *     没能测量    ⇒ 去接线（这一格根本没被读到）
                 *
                 * ★★ 更贵的是它的**恒常性**：`delivery` 今天恒 unmeasured（`coverage` 与
                 *   `convergence` 在没有 goal 矩阵 / 成员观察时必报）⇒ **每一次** status 都往
                 *   `blockers` 里加一条。一个每次都出现的假告警，代价不是"多读一行"，
                 *   是教人**永久忽略 `blockers`** —— 那时真正的问题也一起被忽略。
                 *
                 * ★ 与同位置的 `declare_delivery` 同形：它早就是独立分支（`throwWithSurface`
                 *   带着 `could not measure` 的措辞拒绝），而 status 把它并进 blockers。
                 *   两处 ctx 逐字段相同（刻意设计）⇒ **ctx 相同保护不了消费方式**。
                 *
                 * ★ `undefined` 与空串不同形：没产出 ⇒ 属性**不出现**（与 `input_surface`
                 *   同一条纪律）。写一个 `unmeasured: undefined` 会让"没测到"与"有一个空的
                 *   测量结果"在 `Object.hasOwn` 那一层同形。
                 */
                ...deliveryEvaluation.unmeasured === undefined ? {} : { unmeasured: deliveryEvaluation.unmeasured },
                blockers: [
                    ...deliveryCheck.blockers,
                    ...deliveryEvaluation.blockers,
                ],
                /**
                 * ★ 判据层有没有就交付说话。`false` 表示这个位置这一轮没有任何判据求值
                 *   —— 与"判据都通过了"不同形（那正是本队反复强调的那条分界）。
                 */
                gates_evaluated: deliveryEvaluation.evaluated,
                /**
                 * ── ★★ t3：核对结论**随这次读取一起交出去**（与 runtime 同形）───────────
                 *
                 * ★ 挂在这里而不是 `result` 的顶层：它说的**就是**这次交付位置求值的输入面，
                 *   而 `delivery` 已经是"这次交付裁决"的落点（`ok` / `blockers` /
                 *   `gates_evaluated`）。顶层多一个同名字段会让"哪一份属于哪个位置"读不出来，
                 *   而本队已经吃过"读错位置的出口"那一次（挂 A 位置却读 B 位置独有字段）。
                 *
                 * ★ 三态：都齐（`incomplete: 0`）/ 有缺格（`N` + `missing`）/ 这个位置这一轮
                 *   没挂判据（**字段不出现** —— 不是 `ok`）。
                 */
                ...deliveryInputSurface === undefined ? {} : { input_surface: deliveryInputSurface },
            };
            /**
             * ── ★★★ t6（N3）：计划审查的那一格 ──────────────────────────────────────────
             *
             * ── 为什么挂在这里 ────────────────────────────────────────────────────────────
             *
             * MEASURED（开工普查，本次改动**之前**）：四问与分档只被 `scripts/*.test.mjs`
             * 调用，`src/` 里的生产调用点是 **0** ⇒ 「没审过的计划不该直接派」这条判据
             * 在盘上**只有装置、没有读者**。
             *
             * ★ 那句话原本是一条可复跑命令（grep 这个函数名，闭括号）⇒ 0 行。
             *   而本次改动落地后，**这条注释自己就成了那第 3 条命中** —— 命令与结论
             *   互相引用，复跑出来的数永远对不上注释里写的数。（所以现在这里刻意
             *   **不写**那个带闭括号的字面量；要看改后读数，去看 `plan_review` 那一格。）
             *   它记的是【改前】的事实，改后的读数在返回值里，不在注释里。
             *
             * ★ `status` 是本队唯一一个**每次收口后必然被读**的出口（captain 与成员都在读）
             *   ⇒ 把一格读数接在这里，意味着"没有审到的计划"这件事**不需要任何人记得去问**。
             *   这正是 t34（`deployment`）与 t49（`reload`）踩出来的同一条路 ——
             *   而本文件 5833 行那段 MEASURED 记的是它的反面：**加了返回值却没渲染**
             *   会让队长把"渲染里没有"读成"宿主没有这个字段"，并据此把整条链冻住。
             *   ⇒ 所以这一格在 `renderStatus` 里**必须**也出现（见那里的注释）。
             *
             * ── ★★ 与 `planReviewState` **不是一件事**（契约原文逐字警告过）──────────────
             *
             *   `planReviewState`（`'awaiting_review' | 'awaiting_feedback'`）是**暂存计划的阶段**
             *   —— 它挂在 `team.json` 上，说的是"这份计划还没被批准"。
             *   本格（`plan_review`）说的是"**已经建出来的任务**，它们的契约里那四问有没有读数"。
             *   ★ 两者同名不许互相顶替：阶段是**流程状态**，审查是**读数**。
             *     一个 `awaiting_review` 的队照样可能每条任务的四问都齐 ——
             *     也可能一条都没有；把两者并成一格，会让"还没走到"与"走到了但没填"同形。
             *
             * ── ★★★ 三态：`unmeasured` **不降级**，`0` **不冒充**读数 ─────────────────────
             *
             *   读到了 ⇒ `state: 'measured'` + 完整 `readout`
             *   读不到 ⇒ `state: 'unmeasured'` + `why`（**没有** `readout` 那一栏）
             *   ★ 而 `readout.tiers === undefined` 也自带 `tiersWhy` ——
             *     "三档没读出来"与"三档都是 0"必须不同形（后者是"这一队真的没有大活"）。
             */
            const planReview = await readPlanReview({ tasks: team.tasks });
            const loop = describeQualityLoop(team);
            /**
             * ★★ 形态的执行读数**算一次、三处用**（声明 / 状态 / 违规名单）。
             *   三次各算一遍会读三遍会话枚举 —— 而那不是风格问题：面板是轮询的，
             *   每次多两遍 `ctx.agents.list()` 直接变成延迟。更糟的是三次读数可能落在
             *   **不同的时刻**，于是"声明说在跑、违规名单却来自另一次读"这种矛盾自证不出来。
             */
            const shapeExecution = shapeExecutionFor(ctx, team);
            /**
             * ★★★ N5 / t8：计划环的读数。**紧挨着 `describeQualityLoop`** —— 两个环同形并列，
             *   而它们读**不同的状态位**（`escalated` vs `planReviewEscalated`），
             *   把它们放在一起是为了让"谁读了哪一位"在源码里一眼可见
             *   （N5.14 那条教训：复用别人的状态位之前先数它有**几个清除点**）。
             *
             * ★ 纯函数、零 I/O ⇒ 放在 `readPlanReview`（那个是 async 的动态导入）**之后**
             *   不影响任何时序。
             */
            const planLoop = describePlanLoop(team);
            const result = {
                team_id: team.id,
                team_name: team.name,
                description: team.description ?? '',
                phase: team.phase ?? 'running',
                /**
                 * ── ★★★ 形态：声明 + 执行，两句话，不合并 ────────────────────────────────
                 *
                 * 见 `members.ts` 的 `describeTeamShape`。★ 这一格存在的理由是上一轮
                 * 形态验证的结论：**`shape` 是一条声明，而"声明有没有被执行"此前没有读数。**
                 * 一个 `shape: 'dispatch'` 的队如果成员全都自己干活，没有任何东西会红。
                 *
                 * ★ 三态在**值**上不同形：
                 *   `shape_execution` = `'not-applicable'` ⇒ 这个队没有这个说法
                 *                     = `'measured'`       ⇒ 读了（`shape_violations` 才是结论）
                 *                     = `'unmeasured'`     ⇒ 判不了（**不是**"没有违规"）
                 * 而 `shape_violations` **恒在场**（空数组 = 读了、确实没有违规）——
                 *   字段缺席会让"没违规"与"这一格不存在"同形。
                 */
                team_shape: describeTeamShape(team.shape, shapeExecution),
                shape_execution: shapeExecution.status,
                shape_violations: shapeExecution.status === 'measured' ? [...shapeExecution.violations] : [],
                halted: loop.halted,
                escalated: loop.escalated,
                loop_state: loop.state,
                loop_summary: loop.summary,
                deliverable: loop.deliverable,
                coverage,
                delivery,
                ...team.profile === undefined ? {} : {
                    profile: {
                        name: team.profile.name,
                        ...team.profile.protocol === undefined
                            ? {}
                            : { protocol: team.profile.protocol.slice(0, 240) },
                        ...team.profile.taskPlanning === undefined ? {} : { task_planning: team.profile.taskPlanning },
                    },
                },
                viewer: identity.name,
                /**
                 * ── ★★★ A1：判据视图（四类明细）────────────────────────────────────────────
                 *
                 * ★ 挂在**顶层**（与 `runtime_gates` 同级），理由与 `runtime_gates` 相同：
                 *   它**不是**某一个位置的裁决，而是**跨位置**的一份视图 ——
                 *   挂进 `delivery` 会让"哪一份属于哪个位置"读不出来（本文件上面那段
                 *   `input_surface` 的注释记的正是这个教训）。
                 *
                 * ★ 恒在场（不写 `undefined`）：与 `observed` / `outputs` 同一条纪律 ——
                 *   调用方不必写 `?? …`，而"判据视图"这件事**永远有个形状**，即使某一类为空。
                 *   （空数组 ≠ 字段缺席："这一类现在没有"与"这个字段不存在"必须不同形。）
                 */
                gate_view: gateView,
                ...runtimeRecord === undefined ? {} : { runtime_gates: runtimeRecord },
                /**
                 * ── ★★ 从**这个插件进程**读到的构建新鲜度（t34 / f-0027）──────────────────
                 *
                 * 挂在 `status` 的返回值上，于是**一次 status 调用**就回答了
                 * "我该不该重载" —— 而不是像此前那样用命令行去问一个**别的进程**
                 * （那永远报 `current`，见 schema 里那段 MEASURED）。
                 *
                 * ★ 字段名用 `on_disk`（下划线）与其余工具字段一致；
                 *   而内部的 `ModuleFreshness` 是 `onDisk`（驼峰）—— 这里做一次**显式映射**。
                 *   ⇒ 同一个概念在两个命名空间各有一个拼法，而映射只写一次、只写在这里。
                 *
                 * ★ **恒在场**（读不到也算在场，值里带 `reason`）：与 `observed` / `outputs`
                 *   同一条纪律 —— 调用方不必写 `?? …`，而"没能测量"由 `status: 'unknown'`
                 *   表达，不靠**字段缺席**（缺席与"没有这个概念"同形）。
                 */
                /**
                 * ── ★★ 重载排队（t49）：读一次，顺带【自动收口】────────────────────────────
                 *
                 * ★ 这一格同时做两件事，而它们必须一起做（否则会分叉）：
                 *   ① 报出三态（captain 据此决定要不要继续派发）
                 *   ② **若申请还在排队且已经等到** ⇒ 触发那次重载
                 *
                 * ★ 为什么把"自动重载"挂在 `status` 上：
                 *   `status` 是**唯一一个**每次收口后必然被读的出口
                 *   （captain 与成员都在读它）。⇒ 把它挂在这里，意味着
                 *   **"工作收口"到"重载发生"之间不需要任何人再记得做一件事** ——
                 *   而那正是本任务的全部意义：用户的矛盾是"没人会记得"造成的。
                 *
                 *   ★ 而它**不改变 `status` 的裁决**：`status` 从不拒绝，
                 *     这一格只报告 + 触发一个**已经获准**的动作（闸门在排队时就判过了）。
                 */
                reload: (() => {
                    const tasksNow = tasks.map((task) => ({ id: task.id, status: task.status }));
                    const state = restartQueueFrom(tasksNow);
                    /**
                     * ★ **自动收口**：申请在排队、且名单已经空了 ⇒ 现在就是那一刻。
                     *   ★ 而"名单空了"要用 `queue_state.waitingOn.length === 0` 判 ——
                     *     不是"任务表里没有 in_progress"，因为那两者在
                     *     "某个被等待的任务被删掉"时会**不同形**（那时是 `stuck`，不是可重载）。
                     */
                    if (state.status === 'waiting' && state.waitingOn.length === 0) {
                        const fiber = ctx.fiber;
                        if (typeof fiber?.restart === 'function') {
                            clearRestartRequest();
                            ctx.logger.info('agent-teams: the queued reload is now due (nothing is in flight) — reloading');
                            void fiber.restart().catch((error) => {
                                ctx.logger.error(`agent-teams: queued reload failed: ${String(error)}`);
                            });
                        }
                        else {
                            ctx.logger.error('agent-teams: a reload is due but this host does not expose fiber.restart');
                        }
                    }
                    return {
                        status: state.status,
                        /** ★ `true` = **不要继续派发**（`none` 时为 false）。 */
                        hold_dispatch: state.status !== 'none',
                        message: restartQueueMessage(state),
                        ...state.status === 'none' ? {} : { requested_at: state.requestedAt, waiting_on: state.waitingOn },
                        ...state.status === 'stuck' ? { reason: state.reason } : {},
                    };
                })(),
                deployment: (() => {
                    const freshness = moduleFreshness();
                    /**
                     * ★ 逐字段**显式映射**，不用展开运算符糊过去：
                     *   `ModuleFreshness` 是三态联合，只有 `current` / `stale` 才有 `onDisk`。
                     *   ⇒ 用展开写会命中 TS2339（我第一版就是）—— 而那恰好说明
                     *     "三态在类型上真的不同形"，不是一句注释。
                     */
                    const base = {
                        status: freshness.status,
                        message: moduleFreshnessMessage(freshness),
                        ...freshness.loaded === undefined ? {} : { loaded: freshness.loaded },
                        /**
                         * ★★ f-0026：两个 git 维的字段与 `loaded` / `on_disk` **并列**，
                         *   不合成一个布尔 ——「内容变没变」与「代码落后没落后」是两个问句。
                         *   ★ `behind` 只在 commit 维真的落后时出现；它指明落后于哪个提交，
                         *     因为只说"旧了"仍然要人去猜从哪旧起。
                         */
                        ...freshness.commit === undefined ? {} : { built_commit: freshness.commit },
                        ...freshness.head === undefined ? {} : { head: freshness.head },
                    };
                    if (freshness.status === 'unknown')
                        return { ...base, reason: freshness.reason };
                    return {
                        ...base,
                        on_disk: freshness.onDisk,
                        ...freshness.status !== 'stale' ? {} : { stale_why: freshness.why },
                        ...freshness.status !== 'stale' || freshness.behind === undefined ? {} : { behind: freshness.behind },
                        /**
                         * ── ★★★ t84：检出那一支（**与进程那一支并列，而不是合并**）───────────────
                         *
                         * ── 它回答的是另一个问句 ────────────────────────────────────────────────
                         *
                         *   上面那一支问：「**这个进程**手里的是旧代码吗」（主体 = 进程）
                         *   这一支问    ：「**这个检出**比主干旧吗」      （主体 = 目录）
                         *
                         *   ★ 两者**独立**（MEASURED：同一时刻同时读，进程 stale 而检出 current）。
                         *     ⇒ 合并会让"我该重启"与"我该重切分支"**同形** ——
                         *       而那两个补救动作完全不同。
                         *
                         * ── ★★ 为什么嵌一层，而不是把字段摊平 ──────────────────────────────────
                         *
                         *   两处都有一个叫 `behind` 的字段，而**类型不同**：
                         *
                         *     `deployment.behind`          ⇒ **string**（那个 hash：我在哪构建的）
                         *     `deployment.worktree.behind` ⇒ **number**（落后几个提交）
                         *
                         *   ⇒ ★ 摊平会让读的人拿错 —— 那是本队记账的
                         *     「守卫检查了另一个同名的东西」的近亲。嵌一层让两个 behind 各有归属。
                         *
                         * ── ★★ 为什么接【这一格】而不新开一条通路 ──────────────────────────────
                         *
                         *   t34 的先例在这里同样成立：`status` 是【每次收口后必然被读】的出口，
                         *   而"我这个检出旧不旧"恰恰是**每个 worktree worker 收口时**最需要知道的事
                         *   （t72 读到 28 条红而主树 4 条 · t70 报了一条已修好的缺口 —— 都栽在它上面）。
                         *
                         *   ★ 而不新开一格的理由是决定性的：本队那条纪律 ——
                         *     **一个没有人读的读数，与没有那个读数在观测上完全相同。**
                         *     新开一格可能永远没人读；扩一个**已经在被读**的格子不会。
                         *
                         *   ★ 而它**不**走 t76/t83 那条"由调用方注入"的路 —— 那是给**判据**读的
                         *     （判据不读盘），而这一格是给**人和成员**读的。两个方向，两个出口。
                         */
                        worktree: (() => {
                            const baseline = worktreeBaselineFreshness(workspace);
                            if (baseline.status === 'undecidable') {
                                return {
                                    status: baseline.status,
                                    reason: baseline.reason,
                                    message: describeBaselineFreshness(baseline),
                                };
                            }
                            return {
                                status: baseline.status,
                                behind: baseline.behind,
                                trunk: baseline.trunk,
                                head: baseline.head,
                                message: describeBaselineFreshness(baseline),
                            };
                        })(),
                    };
                })(),
                members,
                tasks,
                captain_inbox: captainInbox.slice(0, 10).map((message) => ({
                    from: message.from,
                    content: mailboxContent(message),
                    ts: message.ts,
                })),
                member_inbox: ownInbox.map(message => ({ from: message.from, content: mailboxContent(message), ts: message.ts })),
                member_inboxes: memberInboxes,
                mailbox_warnings: mailboxWarnings,
                mailbox_warning_count: mailboxWarningCount,
                /**
                 * ★★★ t4：残留 `working` 的后果面 —— 与顶层并列，**不**并进 `members`。
                 *
                 * 读的人要一眼能回答"我现在该不该去抢救"。把它塞进每一行成员里，
                 * 这个问句就要先把整个名单扫一遍才能回答 —— 而它是**动作导向**的那一格。
                 */
                stranded_work: {
                    status: strandedWorktreesReadout.status,
                    message: describeStrandedWorktrees(strandedWorktreesReadout),
                    ...strandedWorktreesReadout.status === 'could-not-measure'
                        ? { reason: strandedWorktreesReadout.reason }
                        : { checked: strandedWorktreesReadout.checked },
                    ...strandedWorktreesReadout.status !== 'frozen' ? {} : { worktrees: strandedWorktreesReadout.worktrees.map((tree) => ({ path: tree.path, name: tree.name, dirty: tree.dirty })) },
                },
                /**
                 * ── ★★★ t6（N3）：计划审查读数（四问 × 每条契约 + 三档计数）──────────────
                 *
                 * ★ 恒在场（`state` 那一格恒有值）：与 `observed` / `outputs` / `deployment`
                 *   同一条纪律 —— "没能测量"由 `state: 'unmeasured'` 表达，**不靠字段缺席**
                 *   （缺席与"没有这个概念"同形）。
                 *
                 * ★★ 逐字段**显式映射**（与上面 `deployment` 里 `onDisk` → `on_disk` 同一做法，
                 *   理由也一样）：`PlanReviewReadout` 是内部的驼峰面，工具输出是下划线面。
                 *   ⇒ 用展开运算符糊过去会让"两处拼法"的映射散落在两处；写在这里只有一处。
                 *   ★ 而 `readout` 只在 `measured` 时出现 —— 三态不许同形。
                 */
                plan_review: planReview.state === 'unmeasured'
                    ? { state: planReview.state, ...planReview.why === undefined ? {} : { why: planReview.why } }
                    : {
                        state: planReview.state,
                        readout: (() => {
                            const readout = planReview.readout;
                            /** ★ 防御：`measured` 而没有 `readout` 是**本调用点的缺陷**，不许印成"没问题"。 */
                            if (readout === undefined) {
                                return {
                                    total: 0,
                                    overall: 'unmeasured',
                                    detail: 'the reading reported `measured` but carried no readout — that is a defect at the call site, not a clean plan',
                                    applicable_overall: 'unmeasured',
                                    tiers_why: 'the reading carried no readout, so the tiers could not be read either',
                                    questions: [],
                                    gaps: [],
                                    not_applicable: [],
                                };
                            }
                            return {
                                total: readout.total,
                                overall: readout.overall,
                                detail: readout.detail,
                                applicable_overall: readout.applicableOverall,
                                ...readout.tiers === undefined ? {} : { tiers: readout.tiers },
                                ...readout.tiersWhy === undefined ? {} : { tiers_why: readout.tiersWhy },
                                questions: readout.questions.map((item) => ({
                                    key: item.key,
                                    question: item.question,
                                    present: item.present,
                                    missing: item.missing,
                                    unmeasured: item.unmeasured,
                                    not_applicable: item.notApplicable,
                                })),
                                gaps: readout.gaps.map((gap) => ({
                                    id: gap.id,
                                    key: gap.key,
                                    status: gap.status,
                                    detail: gap.detail,
                                })),
                                not_applicable: readout.notApplicable.map((entry) => ({
                                    id: entry.id,
                                    key: entry.key,
                                    why: entry.why,
                                })),
                            };
                        })(),
                    },
                /**
                 * ── ★★★ N5 / t8：计划审查环的四格 + 两个三态读数（见 schema 里那段长注释）──────
                 *
                 * ★ 恒在场（不写 `undefined`、不做条件展开）：`describePlanLoop` 对**任何**
                 *   `TeamState` 都有答案 —— 五态里没有"读不出来"那一态，因为它的输入全部在
                 *   盘上（`halted` / `planReviewEscalated` / `planReviewRounds` / `phase` /
                 *   `planReviewState`）。⇒ 若这里写成条件展开，"这一节缺席"就会与
                 *   "这个团队不存在"同形，而那是本仓已经记账过好几次的合流。
                 *
                 * ★★ `roundsSource` 与 `surfaces` 是**两个独立的三态**，都不许折：
                 *   - `roundsSource: 'absent'` ⇒ 存量团队，`rounds: 0` 是**读出来的 0**，不是实测的 0；
                 *   - `surfaces.unreadable > 0` ⇒ 真缺口（写类任务没有 inScope），
                 *     而 `notApplicable` 多的那些是**噪音** —— 两者并成一个数会让噪音淹没缺口。
                 *
                 * ★ 用 `snake_case` 对齐本文件的输出约定（`plan_review` / `loop_state` /
                 *   `loop_summary` / `rounds`）。★ 与计划文档里的 `planLoop` 写法不同，
                 *   已在交付说明里点明理由：这个文件的输出面**全部**是 snake_case，
                 *   在这里开一个 camelCase 的例外才是真正的不一致。
                 */
                plan_loop: {
                    state: planLoop.state,
                    rounds: planLoop.rounds,
                    maxRounds: planLoop.maxRounds,
                    reason: planLoop.reason,
                    canEnd: planLoop.canEnd,
                    roundsSource: planLoop.roundsSource,
                    surfaces: {
                        total: planLoop.surfaces.total,
                        readable: planLoop.surfaces.readable,
                        unreadable: planLoop.surfaces.unreadable,
                        unreadableIds: [...planLoop.surfaces.unreadableIds],
                        notApplicable: planLoop.surfaces.notApplicable,
                        notApplicableIds: [...planLoop.surfaces.notApplicableIds],
                    },
                },
            };
            const acknowledged = identity.kind === 'captain'
                ? captainInbox.slice(0, 10).map(message => message.id)
                : ownInbox.map(message => message.id);
            if (acknowledged.length > 0) {
                await withTeamLock(teamLockKey(stateRoot, team.id), () => (acknowledgeMailbox(stateRoot, team.id, identity.kind === 'captain' ? CAPTAIN_KEY : identity.name, acknowledged)));
            }
            return result;
        },
    }));
}
