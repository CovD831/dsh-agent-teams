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
import { CAPTAIN_KEY, failureKindOf, listArchivedTeamIds, readArchivedTeam, readMailbox, readTeam, readUnreadMailbox, taskDepthsById, taskVisualState, } from "./state.js";
import { TERMINAL_TASK_STATUSES } from "./types.js";
import { registry, INSERTION_POINTS } from "./gates/index.js";
/**
 * ── ★★★ 读数槽位容器（2026-10-23）：四条并行线的**唯一**汇合点 ────────────────
 *
 * 证据链 / 软硬配对 / 后端能力位 / 模板库四条线都要把读数暴露给 UI，而出口只有
 * 本文件那个 `return { … }`。四条线各自往那里加一行就是四次对**同一行**的编辑。
 * ⇒ 读数经 `readouts.ts` 的**预置槽位**挂载：四条线各改自己那一行，
 *   本文件只认这一个入口，加第五条线**不用改本文件**。
 *
 * ★ `readouts.ts` 是**零 import 叶子**（不 import 任何模块，含 src 内的），
 *   所以它不会把任何加载顺序 / 循环引用变成四条线共同的故障面。
 */
import { collectReadouts } from "./readouts.js";
/**
 * ── ★ 副作用 import：四条线的读数装配清单 ────────────────────────────────────────
 *
 * `contributeReadout` 是**模块顶层副作用**：某个模块被 import 一次，它才登记一次。
 * ⇒ 不 import 这个清单 ⇒ **没有人登记任何槽位** ⇒ `collectReadouts()` 恒返回 `{}`
 *   ⇒ `readouts` 整格缺席 ⇒ 面板看起来"那条线没做"。
 *
 * MEASURED（2026-10-23）：本行加上之前，`contributeReadout` 的外部调用点 = 0。
 * 见 `src/readouts/index.ts` 文件头（四条线各占一行，不要重排）。
 */
import "./readouts/index.js";
/**
 * ── ★★★ t101：采集健康读数（health.ts 的**第一个生产消费者**）────────────────────────
 *
 * 背景（`EVOLUTION-WIRING-GAP.md` §1）：`collectionHealthOf` 能算但从**没有任何生产路径
 * 算过它**（health.ts 零消费者）⇒ "把采集读数画到界面上"在那之前是**不可能的** ——
 * 读数从未存在过。本模块把「读 `signals.jsonl` → `collectionHealthOf` → 快照」接成一条线。
 */
import { collectionHealthOf } from "./evolution/health.js";
import { readSignalsHealth } from "./evolution/read.js";
/**
 * ── ★★★ t4 / N2：分流层的**生产出口**（`propose.ts` + `history.ts` 的第一个生产消费者）──
 *
 * 背景（`docs/EVOLUTION-WIRING-GAP.md` §1）：`propose.ts` 零消费者、`history.ts` 零消费者
 * ⇒ "把一条信号转成一个提案"这一步**在代码里存在、而没有任何路径走过它**。
 * 本节把它接在与 `collectionHealth` **同一条路**上（`/state` → `collectTeamsActivity`
 * → `assembleTeamSnapshot`）—— 于是"产出了提案"这件事第一次**在盘上读得到**。
 */
import { readProposalPipeline } from "./evolution/index.js";
/**
 * ── ★★★ 2026-10-22：评估器的**第一个生产消费者**（R6.2）──────────────────────────────
 *
 * 背景（MEASURED 2026-10-22）：`src/evaluator/` 三文件在 `src/` 里**零外部消费者** ——
 * 收益判据写对了、也测过，而**没有任何生产路径读过它**。
 *
 * ★★ 它为什么接在**这里**而不是 evolution 里（需求 §1 规则 A / §3）：
 * ```
 * evolution → 只许被 import，不许反向 import 别人
 * evaluator → 独立模块，剥注释后零 import 于 evolution / gates
 * ⇒ 两边都不能 import 对方
 * ⇒ 而"收益"这件事**同时需要两边的产物**：提案的 `effect` 靶（evolution）+ 信号窗口计数（evolution）
 * ⇒ 唯一的正确落点是**同时看得见两边的装配层**（本文件）
 * ```
 * ★ 而 `evaluator` 侧因此**不认识** `Proposal` / `EvolutionSignal` —— 它只收
 *   `{ id, at, effect }` 这个最小结构（见 `effectReadoutOf` 的注释）。
 */
import { effectReadoutOf } from "./evaluator/effect.js";
/**
 * ── ★★★ t100：一封信箱消息的**完整投影**（九格）────────────────────────────────────
 *
 * MEASURED（t100 开工实测）：本接口此前**只有两格**（`from` / `content`），
 * 而信箱的 jsonl 里有**十个**字段：
 * ```
 * ['content','deliveredAt','deliveredAt','from','id','readAt',
 *  'sourceAttemptId','sourceTaskId','sourceTaskStatus','to','ts']
 * ```
 * ⇒ ★★ 那时**丢掉八个**（`id` · `to` · `ts` · `readAt` · `sourceAttemptId` ·
 *   `sourceTaskId` · `sourceTaskStatus` · `deliveredAt`）。
 *
 * ── ★★★ 而"丢掉的字段"里有两个是**做不了别的事**的原因 ──────────────────────────
 *
 *   · **`taskId`**（← `sourceTaskId`）—— ★ **一条对话线程的分组键**。
 *     实测：同一 `sourceTaskId` 有多条的**有 9 个任务** ⇒
 *     ★ "一条线程" = **一组共享 `sourceTaskId` 的消息**，
 *     而"成员来的=提问 / captain 来的=裁决"**天然成对**。
 *     没有这一格，UI **只能**把消息摊成一条时间线，**分不出**哪些是同一件事的往返。
 *   · **`ts`** —— 排序与显示都要它。★ 没有它，"谁先谁后"只能靠**数组序**猜，
 *     而数组序是**投影顺序**，不是**时间顺序**（两者在截断后会分叉）。
 *
 * ★ 与 `TeamMessage` 的关系：**投影**，不是替代。
 *   ★★ 几格是**缺席可能**的（`taskId?` / `attemptId?` / `taskStatus?`）——
 *     它们**真的可能没有**（一封非"按任务"的消息），而**缺席 ≠ 空串**：
 *     前者是"这封信不属于任何任务"，后者是"它属于一个名字为空的任务"。
 */
/**
 * ── ★★ t100：快照里最多投影几封 captain 信箱的消息 ────────────────────────────────
 *
 * ★ 上限必须有：`/state` 是**每次轮询**都要传的载荷，而信箱实测 108 条、正文可能很长。
 * ★★ 而超过它时**必须报出截了多少条**（见 `TeamActivitySnapshot.captainInboxOmitted`）——
 *   静默截断会让"被截掉"与"没发过"同形。
 *
 * ★ 为什么取 5：与改造前的 `slice(-5)` **同一个数** ——
 *   本轮改的是"**投影几格**"与"**读哪些**"，**不是**"投影多少条"。
 *   把条数一起改大，会让"字段变多"与"载荷变大"这两个读数混在一起、无法归因。
 */
export const MAILBOX_PROJECTION_LIMIT = 5;
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
/**
 * ── ★★★ 快照交给读数 provider 的 context（**导出是为了可直测**，2026-10-24）──────────
 *
 * ── 为什么要提成纯函数并导出 ──────────────────────────────────────────────────
 *
 * 这三格的构造规则以前**只存在于 `assembleTeamSnapshot` 的函数体里**，于是它只能通过
 * 「某个 provider 收到什么」被**间接**观察到。而 provider 是四条线各自写的 ——
 * 一条**不读** `stateRoot` 的 provider（只报静态能力位那种）会让"传错了"在读数上
 * 完全看不出来 ⇒ 那条不变量**无守卫**（实测：夹具里把 `stateRoot` 改成 `''`，
 * 若四条线都不读它，9 条臂全绿）。
 *
 * ⇒ 提成纯函数之后，夹具可以直接断言**它自己的输出**，与任何 provider 的行为无关。
 *   这钉住的是"**这个函数不篡改任何一格**"。
 *
 * ── ★★★ 它钉不住的：**调用点**（这条别漏读）──────────────────────────────────────
 *
 * MEASURED（2026-10-24）：把本函数的**调用参数**改成 `readoutContextOf(state.id, '', …)`
 * （即真的把空串传下去），夹具的 `readoutContextOf` 臂**照样绿** —— 因为它断言的是
 * `readoutContextOf('/a/b') === '/a/b'`，看不见"谁在用它、用什么参数调它"。
 *
 * ⇒ 所以本函数把 M8 的守卫**从"取决于 provider 写法"收窄到"函数契约 + 调用点两半"**：
 *   · 函数契约 —— 已由夹具无条件钉住；
 *   · 调用点   —— 由"快照真的把 context 交给了 provider 且值原样进 `readouts`"那条臂
 *     钉住，而它需要主实例上还有空槽位（四线全落后不适用，夹具会打印"无守卫"）。
 *   ★ 要无条件钉住调用点，需要**在调用点上可观察**（注入 / 回显）—— **未做**。
 *     在那之前，别把这条函数的存在读成"调用点也被守住了"。
 *
 * ── ★★ 三条"不许兜底"（每一格都原样，越"聪明"越错）────────────────────────────
 *
 *   · `stateRoot` **不许**兜底成 `'.'` / `process.cwd()` / `stateRoot || '/'`：
 *     空串是一个**真实的传错形态**（形参没接上就成了 `''`）。若在这里兜底成 `'.'`，
 *     那个缺陷就永远看不见了 —— 而 provider 会去读一个"看起来合法"的错目录。
 *   · `historic` **不许**折算成 `historic ?? false` 之外的东西：它必须是
 *     `options.historic === true` 的结果，而不是"真值判断"（`options.historic`
 *     的非法值不该被悄悄圆成 `true`）。
 *   · `teamId` 原样过（它是 durable 目录名，不做 trim / normalize ——
 *     归一化会让"读错了队"与"读到了空"同形）。
 *
 * @param teamId - 团队 id（`state.id`，durable 目录名）。
 * @param stateRoot - 该团队所在 workspace 的 durable 根（`assembleTeamSnapshot` 的形参）。
 * @param historic - 这是不是**归档团队**的投影（`options.historic === true`）。
 * @returns 交给 `collectReadouts` 的那一份（三格原样）。
 */
export function readoutContextOf(teamId, stateRoot, historic) {
    return { teamId, stateRoot, historic };
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
    /**
     * ── ★★★ t100：读**全部**信箱，而不是只读未读 ──────────────────────────────────
     *
     * MEASURED（t100 开工实测）：这里此前是 `readUnreadMailbox(...)`。
     * ★★ 而"未读"是**读的那一刻**的状态 ⇒ **一旦读过，那条就从快照里消失**
     *   ⇒ ★★★ 后果：**对话线程会自己变短** ——
     *     而"消息没了"与"从来没发过"在界面上**同形**（本仓记账最久的形态）。
     *
     * ★ 为什么现在只读未读会**特别**坏（以前不那么明显）：
     *   本轮把投影扩到九格、并引入 `taskId` 作为**线程分组键** ⇒
     *   ★ 一条线程现在要显示「**提问 → 裁决**」的**往返**。
     *   而裁决一旦被判据/成员读过，它就消失 ⇒ **往返只剩一半**，
     *   而"只问没答"与"根本没问"在界面上同形。
     *
     * ★★ 所以读**全部** —— `readMailbox` 是既有的"读全部"入口
     *   （`readUnreadMailbox` 就是它再 filter 一次，实测两行）。
     *   ⇒ 这**不是**新开一条读路径，是**改用**既有那条。
     * ★ 而"已读/未读"这件事**没有丢**：`read` 那一格（← `readAt`）如实带着它。
     */
    /**
     * ── ★★★ t100（反向半边 C）：**空信箱**与**读不到信箱**必须不同形 ───────────────────
     *
     * MEASURED（t100 开工实测，两条既有行为）：
     * ```
     * 信箱文件不存在 ⇒ readMailbox 返回 []      （"确实没有"）
     * 信箱文件读不了 ⇒ readMailbox **抛错**     （"没能测量"）
     * ```
     * ★★ 而本调用此前**不接错** ⇒ 抛出后被 `collectTeamsActivity` 的
     *   `catch { logger.warn(...) }` 吞掉 ⇒ **整支队伍从快照列表里消失**。
     *   ★★★ 于是"这支队读不到"与"这支队不存在"在**面板上同形** ——
     *     而那正是本仓记账最久的形态，只是换了个入口。
     *
     * ⇒ 修法：**接住它**，并把那一态**如实投影出来**（`captainInboxUnreadable`）。
     *   ★ 三态**互不同形**：缺席（读到了）· 在场（读不到）· `[]`（读到了、确实没有）。
     */
    let captainInbox = [];
    let captainInboxUnreadable;
    try {
        /**
         * ★★ 而**只**滤掉"已丢弃"，**不**滤"已读" —— 两者的过滤意图不同：
         *   · `readAt` 在场  ⇒ ★ **不该**让它消失（那正是本任务要修的：线程自己变短）
         *   · `discardedAt` 在场 ⇒ ★ **是另一种状态**（那封信被显式作废了：
         *     `discardMailboxMessages` 在 create-task / members / reassign 三处被真的调用）
         *
         * ★★★ 为什么这一句是**必要的**而不是"顺手加的"：
         *   MEASURED（t100 实测）：`readMailbox` **不**滤 `discardedAt`
         *   （`readUnreadMailbox` 才滤，它滤的**两半**是 `readAt` + `discardedAt`）。
         *   ⇒ 我这次把调用从后者换成前者，**会顺手把"已丢弃"的信也放出来**，
         *     而它们在九格里**没有对应的格** ⇒ 读起来与普通消息**同形**。
         *   ★★ 那是**我自己引入的回归**，不是我该修的那个缺陷 ⇒ 在这里堵掉。
         *   ★ 若将来要让"已丢弃"可见，那需要**第 10 格**，而那是**形态决策**
         *     （任务书给的是九格）⇒ 由队长裁定，我不擅自加。
         */
        captainInbox = (await readMailbox(stateRoot, state.id, CAPTAIN_KEY))
            .filter((message) => message.discardedAt === undefined);
    }
    catch (error) {
        /**
         * ★★ **不**让整支队消失：信箱读不了是**一个字段**的问题，
         *   而不是"这支队伍不存在"。⇒ 降级成"这一格读不到"，其余照常投影。
         */
        captainInboxUnreadable = String(error?.message ?? error);
    }
    /**
     * ── ★★★ t101：算采集健康读数（health.ts 的第一个生产消费者）──────────────────────
     *
     * ★ 落点在**快照组装**（`/state` 路由经 `collectTeamsActivity` 走到这里）——
     *   那是 UI **真读**的通道；接在这里之后，`collectionHealthOf` 在 `src/` 里
     *   第一次有了【非测试】调用方（判据：grep 可核）。
     *
     * ★ 归档团队（`historic`）**不算**：归档团队的 `stateRoot` 指向 archive 树，
     *   其 signals.jsonl 不是"采集流水线"的现役读数 —— 读了会把历史树混进现役面板
     *   （与 `historic` 对活会话的同一条口径，见上面的 `projection`）。
     */
    let collectionHealth;
    let collectionHealthUnmeasurable;
    if (options.historic === true) {
        collectionHealthUnmeasurable = 'archived team: the collection pipeline readout is only computed for live teams';
    }
    else {
        try {
            const readout = await readSignalsHealth(stateRoot, async (path, encoding) => {
                const { readFile } = await import('node:fs/promises');
                return readFile(path, encoding);
            });
            if (readout.status === 'unmeasured') {
                /** ★ 文件缺席（`file-absent`）＝ 流水线没开过 ⇒ `collectionHealth` 整格缺席（**不是**空读数）。 */
                collectionHealth = undefined;
            }
            else {
                /**
                 * ★ `refused`：从**每条信号自带**的 `collection.verdicts` 数（`ok` 之外的裁决）——
                 *   **转发**已有裁决，**不重跑判据**（t87 的硬约束 3 同一条）。
                 *   ★ 坏行/无该格的行 ⇒ 它们没有 refused 可言，照实不数（不补 0）。
                 */
                collectionHealth = { health: collectionHealthOf(readout.records, readout.refused), readout };
            }
        }
        catch (error) {
            /** ★ 算不了是**异常**（读文件抛了 ENOENT 之外的错等）—— 与"文件缺席"不同形。 */
            collectionHealthUnmeasurable = String(error?.message ?? error);
        }
    }
    /**
     * ── ★★★ t4 / N2：算分流读数（`propose.ts` / `history.ts` 的第一个生产消费者）────────
     *
     * ★ 落点与 `collectionHealth` **完全相同**（`/state` → `collectTeamsActivity` → 这里）——
     *   理由也一样：那是 UI **真读**的通道。接在这里之后，
     *   `routeSignals` / `readProposalPipeline` 在 `src/` 里第一次有了【非测试】调用方。
     *
     * ★★ 读**同一份** `signals.jsonl`，**不**再开第二个口径：`readProposalPipeline` 内部
     *   用的是 `signalsPathOf(stateRoot)`（与 `readSignalsHealth` 同一个函数）——
     *   所以"两个读数看的是不是同一份文件"在这份形状下**写不出分叉**。
     *
     * ★★ 归档团队（`historic`）同样**不算**：理由与上面那格逐字相同（archive 树的
     *   `signals.jsonl` 不是现役读数）。★ 但**措辞不同形**：这里留给它一条
     *   `proposalPipelineUnmeasurable`，而不是让整格静默缺席 ——
     *   因为归档团队**确实**有一条"为什么这格算不出来"的原因可讲。
     */
    let proposalPipeline;
    let proposalPipelineUnmeasurable;
    if (options.historic === true) {
        proposalPipelineUnmeasurable = 'archived team: the routing readout is only computed for live teams';
    }
    else {
        try {
            const readout = await readProposalPipeline(stateRoot, async (path, encoding) => {
                const { readFile } = await import('node:fs/promises');
                return readFile(path, encoding);
            });
            /**
             * ★★ `unmeasured` ⇒ 整格缺席（**不是**空读数）：
             *   把"流水线没开过"投影成 `{ total: 0, produced: 0, none: 0 }` 会让它与
             *   "开了、看了 0 条、确实没有提案"同形 —— 而两者的补救动作相反。
             */
            if (readout.status === 'unmeasured') {
                proposalPipeline = undefined;
            }
            else {
                proposalPipeline = readout;
            }
        }
        catch (error) {
            /** ★ 算不了是**异常** —— 与"文件缺席"不同形（同 `collectionHealthUnmeasurable` 口径）。 */
            proposalPipelineUnmeasurable = String(error?.message ?? error);
        }
    }
    /**
     * ── ★★★ 2026-10-22：收益读数（`src/evaluator/` 的**第一个**生产消费者）──────────────
     *
     * ── 它要回答的那个问句 ────────────────────────────────────────────────────────
     *
     * ```
     * 一份提案（"让 edit_plan 这个入口不再拒绝"）生效之后，
     * 它指向的那个桶（`edit_plan|rejection`）**降了吗**？
     * ```
     *
     * ★★ 为什么它必须在**生产**路径上（而不是只在夹具里）：
     *   §6 硬门槛②要求"证明收益"。而收益只能回答一次"**前后两个窗口**"的问题 ——
     *   那是本仓 §2 里 ③ 评估器独立存在的全部理由。
     *   一个"算得出来而没人算"的评估器，与一个不存在的评估器，在**用户能不能因此改变
     *   行为**这个问句上完全同形（MEASURED：`grep -rn "from.*evaluator/" src/` ⇒ 空）。
     *
     * ── ★★ 输入从哪来（**三样都在盘上，不加数据通道**）──────────────────────────────
     *
     * ```
     * ① 待评估对象 = `storedProposals`（盘上**真的**存下来的提案，不是现算的）
     *    ★ 用 stored 而不是 `routing.proposals` 是刻意的：现算的那批"每次点开面板都重算"，
     *      拿它们算收益等于"用想象的东西衡量现实"。
     * ② 每条提案的时刻 = `proposal.at`（前后窗口的分界点）
     * ③ 窗口计数 = **同一份** `signals.jsonl`（`bucketCounts` 已经在上面算过了，
     *    而这里是按**时间窗**数 —— 两个口径不同，所以各算各的，不共用）✅
     * ```
     *
     * ── ★★★ 三态与"缺席"的关系（四个值两两不同形）───────────────────────────────────
     *
     * ```
     * 没有 storedProposals / 没有一条带靶   ⇒ `undefined`      —— 这一问**没被问过**
     * 有靶但 before.count === 0            ⇒ unmeasured 行     —— 问了，**答不了**（无基线）
     * 有基线且降了                          ⇒ improved 行       —— 答了
     * 有基线但没降                          ⇒ unchanged 行      —— 答了，答案是不好
     * ```
     *
     * ★★ 所以 `effectReadout` 缺席与 `unmeasured > 0` **不是**一回事：
     *   前者去接线，后者去攒数据。合并之后这两种动作指向同一个地方，而它们相反。
     */
    let effectReadout;
    if (options.historic !== true && proposalPipeline?.storedProposals !== undefined) {
        /**
         * ★ 窗口计数器：按 `at` 数**同一份**信号台账里的条数。
         *   ★★ 口径必须与 `propose.ts` 的 `effectOf` / 上面的 `bucketCounts` **逐字相同**
         *     （`component ← source.where`、`kind ← [kind]`，缺席落 `(unattributed)` / `(unclassified)`）——
         *     否则"提案指向的桶"与"我们数的桶"是两个不同的桶，而收益会在两个桶之间比。
         */
        const signalPoints = [];
        try {
            const { readFile: read } = await import('node:fs/promises');
            const text = await read(join(stateRoot, 'evolution', 'signals.jsonl'), 'utf8');
            for (const line of text.split('\n')) {
                if (line.trim() === '')
                    continue;
                let row;
                try {
                    row = JSON.parse(line);
                }
                catch {
                    continue;
                }
                /** ★ `at` 两种形状（字符串日期 / 数字）都要认 —— 台账里**两种都有**（实测 10 条字符串）。 */
                const at = typeof row.at === 'number' ? row.at : typeof row.at === 'string' ? Date.parse(row.at) : Number.NaN;
                if (!Number.isFinite(at))
                    continue;
                const where = typeof row.source?.where === 'string' && row.source.where.trim() !== ''
                    ? row.source.where
                    : '(unattributed)';
                const kind = typeof row.kind === 'string' && row.kind.trim() !== '' ? row.kind : '(unclassified)';
                signalPoints.push({ at, key: `${where}|${kind}` });
            }
        }
        catch {
            /** ★ 读不到 ⇒ **整格缺席**（不编一个空窗口 —— 那会把"没读到"读成"那个窗口里一条都没有"）。 */
            signalPoints.length = 0;
        }
        if (signalPoints.length > 0) {
            const count = (window) => signalPoints.filter((point) => point.at >= window.from && point.at < window.to && true).length;
            /**
             * ★★ 上面那个 `count` 只是**总数**；而 `effectReadingOf` 要的是**按桶**数。
             *   ⇒ 所以按桶各给一个计数器（`effectReadoutOf` 每个 subject 会自己的 `bucketKey` 用）。
             *   ★ 这条注释写在这里是因为"一个计数器数所有桶"是这一格最容易犯的错 ——
             *     那样会在"整个台账降了"与"这个桶降了"之间合流。
             */
            const countFor = (bucketKey) => (window) => signalPoints.filter((point) => point.at >= window.from && point.at < window.to && point.key === bucketKey).length;
            const subjects = proposalPipeline.storedProposals.flatMap((proposal) => {
                const effect = proposal.routing?.effect;
                /**
                 * ★★ `RoutingEffectRef` 是 `string | {component, kind}` 两态（`evolution/types.ts:162`）。
                 *   **只有结构化那一态能算收益** —— 描述性字符串说不出"哪个桶该降"。
                 *   ⇒ 字符串靶**不进** `subjects`（和"没有靶"同一处置）：
                 *     它与"没被问过"不同，但与"问不了"是同一件事，而**两者都不该被计数**。
                 *   ★ 若把字符串靶也算进去并判 `unmeasured`，会把"靶不成形"与"没基线"合流 ——
                 *     而前者要改提案的形状，后者要等数据。
                 */
                if (effect === undefined || typeof effect === 'string')
                    return [];
                return [{ id: proposal.id, at: proposal.at, effect }];
            });
            if (subjects.length > 0) {
                /**
                 * ★ 逐条各算各的桶：`effectReadoutOf` 收**一个**计数器，所以这里按 subject 逐个调，
                 *   再拼成同一份读数 —— 而**三态计数**仍由它统一算（不在这里数）。
                 *   ★ 若把这一步写成"先按桶分组再调一次"，分组逻辑就成了第二份桶键口径。
                 */
                const rows = [];
                for (const subject of subjects) {
                    const one = effectReadoutOf([subject], countFor(`${subject.effect.component}|${[...subject.effect.kind].sort().join(',')}`), Date.now());
                    rows.push(...one.rows);
                }
                const tally = (verdict) => rows.filter((row) => row.verdict === verdict).length;
                effectReadout = {
                    considered: rows.length,
                    improved: tally('improved'),
                    unchanged: tally('unchanged'),
                    unmeasured: tally('unmeasured'),
                    rows,
                };
            }
        }
    }
    /**
     * ── ★★★ 读数槽位（2026-10-23）：四条并行线经 `readouts.ts` 挂上来的那一格 ──────────
     *
     * ★ 只给**只有这一层拿得到**的三样：`state.id` / `stateRoot` / `options.historic`。
     *   · `stateRoot` 在**本函数作用域里有**（形参），所以给；provider 靠
     *     `stateRoot + teamId` 自己读盘 —— 那才是"读数=现读"，而不是读一份
     *     组装那一刻的旧副本。
     *   · 归档支（`historic`）必须如实传：那些团队的会话按定义已经停了，
     *     "活着"类读数在那一支**不该去探**（探了会报一整排"没在跑"，
     *     而那是关于"它是历史"的已知事实，不是一次观测）。
     * ★ **不**传的几格及理由写在 `readouts.ts` 的 `ReadoutContext` 上（workspace 是
     *   显示名；`state`/`tasks` 与 `ctx` 要 import，会破坏零依赖叶子）。
     * ★ `collectReadouts` 永不抛出（它自己逐槽位 try/catch），所以这里不需要守卫 ——
     *   一条读数的故障不许把整份快照带走。
     */
    const readoutField = await collectReadouts(readoutContextOf(state.id, stateRoot, options.historic === true));
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
             * ── ★★ t81：按**段**的判据裁决（`gateEvaluations`）—— 与上一格同构转发 ────────────
             *
             * ★ 为什么**照抄**上面那条展开式而不是合并两个字段：同一条三态纪律 ——
             *     `...task.gateEvaluations === undefined ? {} : {...}`
             *   key **整个不出现** ⇒ "这条任务一个段都没落过盘"；
             *   key 出现而某段缺席 ⇒ "那一段没走到 / 不是任务级"。
             *   ★ 两者**不同形**，客户端的四态判定靠的就是这个差别。
             *
             * ★ 而**不在这里**补齐 delivery/runtime 两段：它们**不是任务级事实**
             *   （团队级/事件级）⇒ 补一个会让读取端以为"判过而通过了"。
             *   ★ UI 侧必须把它们显示成「团队级」，不是 ○、更不是 ✓。
             * ★ 也不补齐 admission：它**已注册 3 条判据，但生产零求值点**（全仓没有
             *   `evaluate('admission', …)` 调用）⇒ 任务级**永远**拿不到它的裁决
             *   ⇒ UI 显示「0 条」。★ 这两件事在 UI 上同形，而补救动作相反：
             *   前者是"该段没有这个说法"，后者是"有判据但没接线"。
             */
            ...task.gateEvaluations === undefined ? {} : { gateEvaluations: task.gateEvaluations },
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
        /**
         * ★★★ t100：投影**九格**（此前只有两格：`from` / `content`）。
         *
         * ★ 逐格说明**为什么它必须在**（不是"顺手多给几格"）：
         *   · `id`         —— 定位一封信（点开、引用、去重**都**要它）
         *   · `to`         —— 收件人。★ 有了它，"谁发给谁"才**可读**；
         *                    而从 `from` 反推收件人**做不到**（同一个 `from` 可以发给多个）
         *   · `ts`         —— ★ **排序与显示**。★ 没有它只能靠**数组序**猜先后，
         *                    而数组序是**投影顺序**、不是时间顺序（截断后会分叉）
         *   · `taskId`     —— ★★ **一条线程的分组键**（`sourceTaskId`）
         *   · `attemptId`  —— 这条消息**针对哪一代**（同一任务多代时不能混）
         *   · `taskStatus` —— ★ 写信**当时**任务是什么状态（事后会变，所以要记当时的）
         *   · `read`       —— ★ 已读/未读。★ 而"已读"**不再**让它从投影里消失
         *   · `from`·`content` —— 原有的两格
         */
        captainInbox: captainInbox.slice(-MAILBOX_PROJECTION_LIMIT).map((message) => ({
            id: message.id,
            from: message.from,
            to: message.to,
            content: message.content,
            ts: message.ts,
            /** ★ 缺席时**整个键不出现** —— "不属于任何任务"与"属于一个空名字的任务"不同形。 */
            ...message.sourceTaskId === undefined ? {} : { taskId: message.sourceTaskId },
            ...message.sourceAttemptId === undefined ? {} : { attemptId: message.sourceAttemptId },
            ...message.sourceTaskStatus === undefined ? {} : { taskStatus: message.sourceTaskStatus },
            read: message.readAt !== undefined,
        })),
        /**
         * ── ★★ t100：截断**必须**有明确读数 ────────────────────────────────────────────
         *
         * ★ 为什么要设上限：信箱实测有 **108 条**，而正文可能很长 ——
         *   全量塞进快照会撑爆载荷（而 `/state` 是**每次轮询**都要传的）。
         * ★★ 而超过上限时**必须报出截了多少条**：
         *   ★ 静默截断会让"**被截掉**"与"**没发过**"同形 ——
         *     而那是本任务要修的那条形态的**同一个形状**（只是换了个入口）。
         *
         * ★ 这一格**只在真的截了**的时候在场（`undefined` = 没截）。
         *   ★★ 与"截了 0 条"不同形：后者是"截过、但一条都没超"。
         */
        ...captainInbox.length > MAILBOX_PROJECTION_LIMIT
            ? {
                captainInboxOmitted: captainInbox.length - MAILBOX_PROJECTION_LIMIT,
                captainInboxTotal: captainInbox.length,
            }
            : {},
        /**
         * ★★ t100（反向半边 C）：读不出来时**如实标出**，且**只在真的读不出来时在场**。
         * ★ 缺席 = 读到了（可能是空的）⇒ 与"读不到"不同形。
         */
        ...captainInboxUnreadable === undefined ? {} : { captainInboxUnreadable },
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
        /**
         * ── ★★★ t101：采集健康读数（只【算出来】时在场）───────────────────────────────
         *
         * · `collectionHealth` **缺席** = 文件缺席（`file-absent`，流水线没开过）——
         *   ★ **不是**空读数：空读数会把"没开过"读成"开了没采到"。
         *   ★ 在场时自带两半：`health`（collectionHealthOf 的产出）+ `readout`（三态 + 坏行计数）。
         * · `collectionHealthUnmeasurable` **在场** = 真的算不了（异常）—— 与缺席**不同形**。
         */
        ...collectionHealth === undefined ? {} : { collectionHealth },
        ...collectionHealthUnmeasurable === undefined ? {} : { collectionHealthUnmeasurable },
        /**
         * ── ★★★ t4 / N2：分流读数（只【算出来】时在场）─────────────────────────────────
         *
         * · `proposalPipeline` **缺席** = `signals.jsonl` 没开过（流水线没走过）。
         * · `proposalPipelineUnmeasurable` **在场** = 真的算不了（异常 / 归档团队）。
         * ★ 两者不同形：前者是**正常态**（还没开始采集），后者是**异常**。
         */
        ...proposalPipeline === undefined ? {} : { proposalPipeline },
        ...proposalPipelineUnmeasurable === undefined ? {} : { proposalPipelineUnmeasurable },
        /** ★ 2026-10-22：收益读数（缺席 = 没有一条提案带结构化靶 ⇒ 这一问没被问过）。 */
        ...effectReadout === undefined ? {} : { effectReadout },
        /**
         * ── ★★★ 读数槽位（2026-10-23）───────────────────────────────────────────────
         *
         * ★ 与任务卡的字面写法差一处（见交付说明「偏差点」）：卡上写 `...readoutField`，
         *   而 `collectReadouts` 返回的是 `{ evidence: …, pairing: … }` —— 直接展开会把
         *   四个槽位摊在**快照顶层**，而接口那格叫 `readouts`、验收读的是
         *   `snapshot.readouts.evidence`。⇒ 这里包一层，并对空表做"整格缺席"。
         *
         * 展开后：**没登记的槽位不出现**（键都没有）；登记了但没测成的槽位值是
         * `{ unmeasured: '…' }`。★ 于是"四条线一条都没接"时这一行展开成空的，
         * `readouts` 那格**缺席** —— 与"接了但没测成"（在场且带 `unmeasured`）不同形。
         */
        ...Object.keys(readoutField).length === 0 ? {} : { readouts: readoutField },
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
