/**
 * Durable AgentTeams state types.
 *
 * A team is one directory under the state root holding `team.json` plus an
 * `inbox/` of per-agent JSONL mailboxes. Members are continuable subagents
 * whose durable child session ids are recorded in the team file, so a team
 * survives harness restarts.
 * @module dsh-agent-teams/types
 */
/** Statuses after which a task can no longer be claimed or worked on. */
export const TERMINAL_TASK_STATUSES = ['completed', 'failed', 'cancelled'];
export const DELIVERY_OUTCOMES = [
    'delivered_blocked',
    'not_delivered',
    'gate_fault',
];
export const TASK_KINDS = [
    'requirements',
    'implementation',
    'verification',
    'review',
    'repair',
    'integration',
    'work',
];
/**
 * ── ★★★ 哪些 kind 会被派发到一个【隔离的 worktree】────────────────────────────
 *
 * ★ 这是**唯一的一份真值**，两个读者从它取，而不是各自写一遍：
 *
 *     · `src/scheduler.ts` 的 `needsWorktree` —— **建不建**树（派发那一刻）
 *     · `src/tools/shared/entities.ts` 的 `resolveBaseRevision` —— 判"没有基准"
 *       是**按设计没有**还是**本该有却丢了**
 *
 * ── 为什么必须只有一份（MEASURED，本队记账最久的形态）──────────────────────────
 *
 * 两处各写一份 `kind === 'implementation' || kind === 'repair'` 会**分叉**，
 * 而分叉之后 `判据说它该有、而调度器从没建过` 在日志里同形 —— 那正是本任务修的那一格：
 *
 *     调度器：非 implementation/repair ⇒ 从不建树 ⇒ 基准**从来没有**存在过
 *     判据  ：`attempt > 0` 而没有基准 ⇒ 读成"本该有却丢了" ⇒ **拒绝**
 *     ⇒ ★ 任何非 implementation/repair 的任务，只要被重派过一次，就**再也交不上终态**
 *     ⇒ 而它被拒的理由，描述的原因**从来没有发生过**
 *
 * ★ 放在 `types.ts` 而不是别处，是因为它是**叶子模块**（不 import 任何东西），
 *   而 `scheduler.ts` 与 `tools/shared/entities.ts` **都已经** import 它
 *   ⇒ 两边共用它不会造出新的 import 环（环会让"改一个工具牵动另一个"，本仓库禁止）。
 *
 * ★ 它与 `completion.backtest` 的 `baselineAbsent` **一一对应**（判据不发明新词汇）：
 *     非本集合的 kind ⇒ `'no-worktree'` ⇒ 判据**报告而不拒绝**（环境不是工作的问题）
 *     本集合的 kind   ⇒ `'not-recorded'` ⇒ 判据**仍然拒绝**（本该有的丢了，要有人看）
 */
export const KINDS_NEEDING_WORKTREE = ['implementation', 'repair'];
/** 这个 kind 会不会被派发到隔离 worktree（⇒ 它有父版本可对照）。 */
export function needsWorktreeFor(kind) {
    return kind !== undefined && KINDS_NEEDING_WORKTREE.includes(kind);
}
export const REVIEW_VERDICTS = ['pass', 'needs_revision', 'reject'];
export const FINDING_SEVERITIES = ['low', 'medium', 'high', 'blocker'];
/** 上述取值的运行期清单（与 `state.ts` 的 `FAILURE_KINDS` 同源，由夹具逐字比对）。 */
export const FAILURE_KIND_NAMES = ['failed_delivery', 'failed_context', 'inconclusive'];
/**
 * 上述取值的运行期清单（与 `gates/registry.ts` 的 `INSERTION_POINTS` **同源同序**，
 * 由一条夹具逐字比对；★ 该夹具已注册进 `test:gates`）。
 */
export const GATE_INSERTION_POINTS = [
    'admission',
    'contract',
    'dispatch',
    'completion',
    'delivery',
    'runtime',
    'collection',
];
/**
 * ── ★★★ C1 的判据本体：这一次拒绝之后，任务**有没有继续往下走** ──────────────────
 *
 * 用户裁定（`docs/PENDING-FRICTION-REFORM.md` §0，逐字）：
 *   「卡点就是让任务停下来的地方」「如果不阻塞任务，其实不算卡点」。
 * ⇒ 判据是机械的：**同一个 `(taskId, gateId)` 被拒 ≥2 次 = 停住了**。
 *
 * ── ★★★ 为什么它住在这里（一个 **零 import 的叶子模块**），而不是住在 tools/ ────
 *
 * MEASURED（t24，由 t6 的持有者先撞上并逐条复现）：
 * 本函数原先住在 `src/tools/shared/entities.ts`，于是**判据层没法用它** ——
 *
 *     runtime/stall.ts -> tools/shared/entities.ts -> gates/index.ts -> runtime/stall.ts
 *                                                       ↑ 成环
 *
 * 因为 `entities.ts:27` import 了 `gates/index.ts`，而 `gates/index.ts` import 每一条判据。
 * ⇒ 判据层若要用它，只有两条路：**复制一份**（第二个真相，本仓反复记账的形态）
 *   或**成环**。两条都不可接受。
 *
 * ★ 而本仓有一条**实测出来的不变量**：`grep -rn "from '../../tools" src/gates/` 是空的 ——
 *   **判据层是一个不 import tools/ 任何东西的纯模块**。这条不变量是承重的（它让判据
 *   可以在没有 tools 层的情况下单测、且不会与状态层互相锁死）。
 * ⇒ 所以正确的修法是**把判据搬到双方都能 import 的叶子上**，而不是让判据层破例。
 *
 * ★★ 为什么这个叶子是 `types.ts`：它**一个 import 都没有**（本文件是纯类型声明），
 *   因此谁 import 它都不会成环。而 `TaskStall` / `StallState` **本来就住在这里**
 *   ⇒ 搬家之后，**类型与它的观察者同处一室**，比原来（类型在 types.ts、判据在
 *   entities.ts）**更内聚**，而不是更散。
 *
 * ★★★ 而这条性质**必须被机械守住**：`types.ts` 之所以是叶子，**只因为**它没有任何
 *   import。一行 import 就会把它变成图上的一个节点，于是这个环会在**下一层**重新长出来
 *   （而且长得更隐蔽：报错会指向别的文件）。⇒ 夹具里有一条臂断言本文件**零 import**。
 *   见 `scripts/gate-stall-leaf-home.test.mjs` 臂 4。
 *
 * ── ★★ 为什么"同一个判据"必须是键的一部分 ────────────────────────────────────
 *
 * 五个**不同**的判据各拒一次是**五件不同的事**（成员每次都在改，只是每次
 * 撞上另一条门）。把它们数成一个数字会让"每次都被不同的门拦"读成"卡在同一处"
 * —— 而那正好是本任务要消灭的那个合流（换成计数版本）。
 *
 * ── ★★ 为什么 N 是【可注入】的（本仓教训，逐字）───────────────────────────────
 *
 * `docs/PENDING-FRICTION-REFORM.md` §2：「`with-timeout` 那族缺陷连躲三次，
 * 根因都是『上限是硬编码常量，短测试复现不了』」⇒ N 必须能注入。
 * ★ 而注入的是**上限**，不是判据本身 —— 判据仍然只有一处实现。
 * ★ 注入口是环境变量（与 `restartEscapeHatchFromEnv` 同一形态：**明写的、可核的**），
 *   缺省 2（用户已确认）。★ 读不出数就**回落缺省**，而不是当成 0：
 *   一个坏值会让每一片拒绝都变成卡点（或一条都不变）。
 */
export const STALL_REPEAT_THRESHOLD = 2;
/**
 * 读 N（`AGENT_TEAMS_STALL_REPEAT_THRESHOLD`）。
 *
 * ★ 坏值 / 空白 ⇒ **回落缺省**，而不是当成 0（那会让每一片拒绝都变成卡点）
 *   也不是抛错（一个因为参数没写对就炸的守卫会被关掉）。
 */
export function stallRepeatThreshold(env = process.env) {
    const raw = env.AGENT_TEAMS_STALL_REPEAT_THRESHOLD;
    if (raw === undefined || raw.trim() === '')
        return STALL_REPEAT_THRESHOLD;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1)
        return STALL_REPEAT_THRESHOLD;
    return parsed;
}
/**
 * ── ★★★ 算出这一次拒绝之后任务停没停（C1 的判据本体）────────────────────────────
 *
 * 输入：这个任务**上一次**的 `stall` 读数（`task.stall`，可能缺席）+ 这一次的判据 id。
 * 输出：三态观察（`first` / `repeated` / `unknown`）。
 *
 * ── ★ 为什么密钥是 `(gate, point)` 而不只是 `gate` ──────────────────────────────
 *
 * 判据 id 在注册表里**唯一**（`completion.mutation` 只有一个位置），所以
 * 只按 gate 判就已经够了。★ 而 `point` **也**要一起比，是因为判据 id 读不出来时
 * （`unknown` 那一态）`gate` 是 `undefined`：那时若只比 `undefined === undefined`，
 * **两条毫不相干的、都读不出 id 的拒绝**会被算成"同一个判据拒了两次"。
 * ⇒ 加上 `point`，两处都读不出来时也要求位置相同。
 *   ★ 而它仍然可能把同一个位置上的两条**不同**判据算成一条 —— 所以那条路上
 *     我们落的是 `unknown`（保守：不惊动人），而不是 `repeated`。
 */
export function observeStall(previous, gate, point, 
/** ★ 这一次之前这个 `(task, gate)` 已经被拒了几次（由任务级读出，可注入）。 */
priorCount = 0, threshold = stallRepeatThreshold()) {
    /**
     * ★ 判据 id 读不出来 ⇒ **判不了**（第三态）。★ 不许并进另外两态：
     *   并进 `first` 是把"读不到"说成"它没停"；并进 `repeated` 是把
     *   **每一条**读不出 id 的拒绝都变成卡点（那 207 条就全回来了）。
     */
    if (gate === undefined || gate.trim() === '') {
        return { stalled: false, count: priorCount + 1, basis: 'unknown' };
    }
    const sameGate = previous !== undefined
        && previous.gate === gate
        && previous.point === point;
    const count = sameGate ? (previous.count ?? 0) + 1 : priorCount + 1;
    const stalled = sameGate && count >= threshold;
    return { stalled, count, basis: stalled ? 'repeated' : 'first' };
    /**
     * ★ 【时间】刻意**不**参与判定：用"过了多久"当判据会让**同一份输入**
     *   在快机器与慢机器上给出不同裁决，而那是本仓 `with-timeout` 那族缺陷的
     *   同一形态（`docs/PENDING-FRICTION-REFORM.md` §2 记的正是它）。
     *   判据只用**次数** —— 次数与机器速度无关。
     */
}
/**
 * ── ★★★ t19：把"这一次执行"追加进历史（**唯一被允许的写操作**）──────────────────
 *
 * ★★ 它【只追加】，从不改写 —— 那不是一个风格选择，是这一格能不能被信任的前提：
 *   一条历史元素记的是**当时发生了什么**。允许改它等于允许"过去"被推翻，
 *   而那样一来"它失败过两次"这句话就不可依赖了（本仓那条：
 *   **记录被改写之后不可重算**）。
 *
 * ★ 为什么它是**纯函数**（改传入的 task，返回它）：调用点在 `update-task.ts` 的
 *   终态分支里 —— 那里已经持有 `fresh` 那一份权威状态（在锁里）。
 *   ⇒ 让它在这里**再读一次盘**会读到另一个时刻的事实（与 C1 的 `observeStall`
 *     同一条纪律：别让判据自己去找状态）。
 *
 * ── ★★ 三态：它**不制造空数组** ────────────────────────────────────────────────
 *
 * 第一次调用**建立**数组；在那之前 `executions` **缺席**。
 * ⇒ "从未跑到终态"（缺席）与"跑到过终态但记录是空的"（空数组）不同形 ——
 *   而后者**永远不会出现**，因为本函数只在追加时建立它。
 */
export function appendExecution(task, execution) {
    /**
     * ★ 数组**原地** push：`task.executions` 是这条任务自己的历史，
     *   而调用方持有的是同一份对象（在锁里）。
     * ★ 缺席 ⇒ 先建空数组 ⇒ 于是"第一条"与"第 N 条"走**同一条**代码路径
     *   （两处各写一遍会让它们在"第一条要不要建数组"上分叉）。
     */
    const history = task.executions ?? [];
    history.push(execution);
    task.executions = history;
    return execution;
}
export function summariseExecutions(task) {
    const history = task.executions;
    /** ★ 缺席 ⇒ 一次都还没跑到终态。**不许**读成 `first-pass`（那是"跑过一次且成了"）。 */
    if (history === undefined || history.length === 0) {
        return { rounds: 0, failures: 0 };
    }
    const rounds = history.length;
    const failures = history.filter((entry) => entry.status === 'failed').length;
    const maxRounds = history.map((entry) => entry.round).filter((round) => typeof round === 'number');
    const last = history[history.length - 1];
    /**
     * ★ 末次是不是"好的" —— 判据是 `status === 'completed'`。
     *   ★ 而 `failed` 里面**混着两种东西**（`needs_revision` 的否定结论 vs 东西真的坏了，
     *     见 t12 的 `failure_kind`）—— 但对**收敛**这个问句而言两者一样：
     *     那一次没有走到 `completed` ⇒ 循环还要继续。
     *   ⇒ 所以这里**只用 status**，不替读取端解释 verdict（那件事归 t12/t13）。
     */
    const lastSucceeded = last !== undefined && last.status === 'completed';
    const outcome = lastSucceeded
        ? (failures > 0 ? 'converged' : 'first-pass')
        : (failures > 0 ? 'still-failing' : undefined);
    return {
        rounds,
        failures,
        ...maxRounds.length === 0 ? {} : { maxRound: Math.max(...maxRounds) },
        ...outcome === undefined ? {} : { outcome },
    };
}
