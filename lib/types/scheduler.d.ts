/**
 * Event-driven shared task scheduler.
 *
 * Claude Code teammates keep polling the shared task list after a turn. DSH
 * continuable agents instead expose explicit idle/running edges, so this
 * scheduler closes the same loop without keeping a polling turn alive: every
 * idle edge and every task-graph mutation attempts one atomic claim and wakes
 * the selected durable member. A resident member that becomes idle while it
 * still owns an open attempt is parked: only an explicit captain reassignment
 * may rotate that capability. Automatic retry is reserved for cold recovery,
 * when this process has not observed the durable owner settle its open attempt.
 * @module dsh-agent-teams/scheduler
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { TaskStatus, TeamTask } from './types.ts';
/** Per-dependency output cap in the assignment prompt. */
export declare const DEPENDENCY_OUTPUT_MAX_CHARS = 2000;
/** Combined dependency-output budget in the assignment prompt. */
export declare const DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS = 12000;
export interface SchedulerConfig {
    readonly stateDir: string;
    readonly executionPrompt?: string;
    readonly dispatch?: (captain: Agent, teamId: string, memberName: string, text: string, signal: AbortSignal, mode: 'queue' | 'steer', attemptId?: string) => Promise<boolean>;
    /**
     * 建出隔离检出时报告它的基准版本（`worktree.base`）。
     *
     * ★ 这是 R5 / 回测唯一的父版本来源。判据层在成员【汇报完成】时需要它，
     *   而那时派发已经结束 ⇒ 由调用方在这里记下来。
     *   不回调 ⇒ 判据说"我没能测量"（诚实），**不会**拿一个猜的版本去比较。
     */
    readonly onWorktree?: (taskId: string, base: string) => void;
    /**
     * ── ★ runtime 位置的接线点：一个成员【真的被派发出去】了 ─────────────────────
     *
     * 契约 `docs/GATE-REGISTRY.md` §5 给 `runtime` 写的例子正是这一条：
     * 「在成员被派发时启动 / 超时 ⇒ 产生一条记录 / 它不直接拒任务」。所以本回调
     * **只能记录**：调度器不读它的返回值，也没有可读的返回值 ⇒ 过程约束无法
     * 拒绝派发（§5 硬要求）。
     *
     * ★ 时机：投递【被接受之后】才回调。投递失败会走下面那条回滚路径（任务回
     *   pending、成员回 idle），那一次不是"派发过"；把失败也记成一次派发，会让
     *   运行判据读到一个从未发生的事件。
     *
     * ★ `dispatchedAt`（t5）：这次派发【被接受的那一刻】。
     *   探活判据要问的头一个问题是「这个成员等了多久」，而答案是"现在 − 起点"——
     *   起点只能在这里取得，因为渡过了这一步，派发就结束了。
     *   呼叫方拿它去记一条等待记录（见 `tools.ts` 的 `recordDispatchStart`）。
     */
    readonly onDispatched?: (event: {
        /**
         * ★ 这一次派发属于哪个团队（t5）。
         *
         * 等待记录要一个键，而 `taskId`（`t1`、`t2`…）**只在团队内唯一** —— 两个团队的
         * `t1` 会撞在同一个键上，于是"读了另一个团队的等待"。`teamId` 是让它唯一的
         * 那一半，而它只在这里可得（调度器手上有，回调的其余字段里没有）。
         */
        readonly teamId: string;
        readonly taskId: string;
        readonly memberName: string;
        readonly memberId: string;
        readonly attempt: number;
        readonly attemptId: string;
        readonly kind: string;
        /** ★ 派发被接受的那一刻（ms epoch），取自 {@link SchedulerConfig.now}。 */
        readonly dispatchedAt: number;
        /**
         * ── ★ 这一次派发是【连续】还是【重来】（V3-2/t9 的判别面）─────────────────────
         *
         * 真 = 调度器只是给一个**已经在等待的**持久尝试补一次投递（status ⇒ kickTeam
         * 那条路）⇒ 这一次等待是**连续**的，探活窗口必须继承；假 = **新的**尝试
         * （重派发 / 首次派发）⇒ 开一个新窗口。
         *
         * ★ 为什么不用 `attempt` 计数判别：`beginTaskAttempt` 在**两条路上都会**让
         *   `attempt += 1`（实测：kickTeam 给闲成员补投递也跳号），所以计数分不出
         *   这两种。而"是不是在补一次已有的等待"只有调度器知道 —— 它在这里交出来。
         */
        readonly continued: boolean;
        readonly worktreePath?: string;
        readonly worktreeUnavailable?: string;
    }) => void;
    /**
     * ── ★ 时钟（t5）：调度器<b>不</b>自己读 `Date.now()` ───────────────────────────
     *
     * 它是可注入的，理由与判据层那条纪律同源（契约 §2 性质 1）：**I/O 与时钟
     * 由调用方给**。这里的时间戳会经 `onDispatched.dispatchedAt` 流进等待记录，
     * 而判据拿它算"等了多久"。
     *
     * ★ 缺省 `Date.now` 是给生产用的，**不是给夹具用的**：夹具注入假时钟才能
     *   在不真等 10 分钟的情况下构造"两次探活之间没有任何产出"。
     *   —— 一个不能注入时钟的探活判据，只能靠真等来测，而真等的夹具没人跑。
     */
    readonly now?: () => number;
}
export interface TeamScheduler {
    /** Try to give every genuinely idle/ready member one unit of ready work. */
    kickTeam(workspace: string, teamId: string, captain?: Agent): Promise<void>;
    /** Try to flush fallback mail or give one member one ready task. */
    kickMember(workspace: string, teamId: string, memberName: string, captain?: Agent): Promise<void>;
}
/** One completed recursive dependency shown to the assignee. */
export interface DependencyOutput {
    readonly id: string;
    readonly subject: string;
    readonly profileSeedId?: string;
    readonly output?: string;
    /**
     * ── ★★ 上游最后落在哪个【终态】—— t28 加的第七格 ────────────────────────────
     *
     * 它修复的是 f-0018：t26 修好了「终态该不该放行下游」，但没修「放行之后下游
     * 拿不拿得到上游的结论」。实测基线（本任务复现）：一条 failed 上游解锁了下游，
     * 而下游拿到的派发文本是
     *
     *     Completed dependency results:
     *     (none)
     *
     * —— 解锁了、却什么都没拿到。那与「这条依赖根本不存在」在文本里**同形**，
     * 而它们的补救动作完全相反（一条是"上面出过事，先看看"，一条是"没有前置"）。
     *
     * ── 为什么这一格是 `status` 而不是分类后的 outcome ────────────────────────
     *
     * 分类（failed_delivery / failed_context / inconclusive）是 `src/state.ts` 的
     * `dependencyOutcomeOf` 的职责（t26 已实现）。★ 本模块**不重算它**：
     *
     *   · 本模块在 t28 的契约里只能动 `src/scheduler.ts`，而 `src/state.ts` 的那套
     *     分类在**本 worktree 的 HEAD 上还不存在**（t26 未提交）；
     *   · 更要紧的是**口径**：调度器的职责是"把上游的结论交给下游"，
     *     不是"替它下判断"。在这里再算一遍分类就是两份真相 —— 本队记账过三次。
     *     真值只有一份（state.ts 的 `dependencyOutcomeOf`），下游按 id 去问它即可。
     *
     * ⇒ 这一格交出的是**终态本身**（`completed` / `failed` / `cancelled`），
     *   它是下游能自己往下问的那个事实，而且它**不会腐烂**：
     *   分类规则改了，这一格不用跟着改。
     */
    readonly status?: TaskStatus;
}
export interface DispatchTicket {
    readonly taskId: string;
    readonly memberName: string;
    readonly memberId: string;
    readonly attempt: number;
    readonly attemptId: string;
    readonly previousAssignee?: string;
    /** True when this ticket rotates an unobserved durable open attempt. */
    readonly recoveredOwned: boolean;
    /** Original task generation, used to restore a failed automatic recovery. */
    readonly previousStatus?: 'claimed' | 'in_progress';
    readonly previousAttempt?: number;
    readonly previousAttemptId?: string;
    readonly previousResult?: Pick<TeamTask, 'output' | 'verdict' | 'findings' | 'changedPaths' | 'acceptanceResults' | 'commandsRun'>;
    readonly subject: string;
    readonly description?: string;
    readonly teamDescription?: string;
    readonly profileProtocol?: string;
    readonly profileSeedId?: string;
    readonly dependencyOutputs: readonly DependencyOutput[];
    readonly executionPrompt?: string;
    readonly kind?: string;
    readonly round?: number;
    readonly objective?: string;
    readonly inScope?: readonly string[];
    readonly outOfScope?: readonly string[];
    readonly acceptance?: readonly string[];
    readonly verify?: readonly string[];
    readonly reviewedTaskId?: string;
    /**
     * ★ 该任务的隔离工作目录（worktree 的绝对路径）。
     *   缺席 ⇒ 没有隔离 ⇒ 提示里【不】产出伪造的工作目录指令。
     */
    readonly worktreePath?: string;
    /** 该 worktree 里缺失的 gitignore 条目（如 node_modules）—— 必须告诉成员。 */
    readonly worktreeMissingIgnored?: readonly string[];
    /**
     * ── ★【未隔离】这件事本身要留下痕迹 ──────────────────────────────────────────
     *
     * 降级派发（非 git 仓库）时带着它。理由：一次 `logger.warn` 不是一条记录 ——
     * 它随进程消失，而"这个任务是在没有隔离的地方做的"是一个【关于这份工作的
     * 事实】，读日志的人（以及依赖父版本的判据）必须能看见它。
     *
     * ★ 它与 `worktreePath === undefined` 必须【不同形】：
     *   `worktreeUnavailable` 有值 ⇒ 问过 git 了，这个仓库【不支持】隔离 ⇒ 成员
     *     应当知道，且 R5/变异那类判据会因此 unmeasured；
     *   两者都缺席 ⇒ 这个任务【本来就不需要】隔离（review/requirements 这类只读任务）。
     *   把这两件事混起来，一次"环境不支持"就会伪装成"这一步不需要"。
     */
    readonly worktreeUnavailable?: string;
}
/**
 * ── ★★ 递归收集【已了结】的上游及其结论（t28 修 f-0018）─────────────────────────
 *
 * 按拓扑序（依赖在前、下游在后）收集 `taskId` 的祖先。环只截断那一条分支。
 *
 * ── MEASURED（2026-10-07，本任务复现的基线）────────────────────────────────────
 *
 * 这一行此前是：
 *
 *     return ordered
 *       .filter(task => task.status === 'completed')
 *
 * ⇒ 它把 failed / cancelled 的上游**整个丢掉**。而 t26 刚把依赖口径改成
 *   「终态即满足」⇒ 下游会因为一条 failed 上游而**开工**，然后拿到：
 *
 *     Completed dependency results:
 *     (none)
 *
 * ★ 那是本队记账的"把没测到并进通过"在同一条链上的第二次发作，只是这次
 *   并进去的是**整个上游**：
 *
 *     下游看不见的那件事（"上面失败了"）
 *     在下游眼里与"没有前置依赖"长得一模一样
 *
 * ── 修法是换一个更准的问题 ────────────────────────────────────────────────────
 *
 *     「哪些上游【成功了】」        —— 旧口径（下游于是永远不知道别的终态存在）
 *     「哪些上游【已经了结】」      —— 新口径（终态 = 不再欠工作 = 有结论可交）
 *
 * ── ★ 但"交出去"与"审核过"是两件事 ──────────────────────────────────────────
 *
 * 本函数**只负责把结论交出去**：它不判定那份 failed 要不要紧、不替下游决定
 * 该不该继续。用户裁定的口径是乙 —— "不替下游做决定，而是把状态交出去"。
 * 所以每一项都带 {@link DependencyOutput.status}，下游据此自己决定。
 *
 * ★ 而"还没了结"的上游**仍然不进来**：pending / claimed / in_progress 的任务
 *   没有结论可交（它还在写）。把它们也塞进来会让下游读到半截输出，
 *   而"上游还在做"与"上游做完了、结果是这样"必须不同形。
 *
 * ★ 函数的**名字**保留 `collectCompletedDependencyOutputs`：它在 `src/tools.ts`
 *   与 `scripts/verify.mjs` 里各有一个已经存在的调用者，而两者都在本任务的
 *   Out of scope 里。改名会让那两个文件立刻编译不过 —— 那是把一次口径修复
 *   变成一次跨文件重构。口径的说明在这里，名字的历史包袱留一行注释交代。
 */
export declare function collectCompletedDependencyOutputs(tasks: readonly TeamTask[], taskId: string, warn?: (message: string) => void): DependencyOutput[];
/**
 * ── ★★ 把已了结的依赖渲染成下游读得懂的一段（t28）─────────────────────────────
 *
 * 每条带上它的**终态**。这一格不是装饰：t28 修的正是"下游解锁了却拿不到东西"，
 * 而只把 output 印出来还不够 —— 一条 `failed` 上游与一条 `completed` 上游
 * 如果都只印出一行文字，下游仍然读不出"上面出过事"。
 *
 * ★ 渲染成 `[failed]` 这样的标记，而不是把 status 塞在正文里：
 *   下游（以及读日志的人）要能**一眼**扫出哪几条不是 completed，
 *   而一行正文里的一个词做不到这件事。
 *
 * ★ 缺席 `status` 时**不印任何标记**（只印老的形状）：
 *   一个伪造 `[completed]` 的兜底会让"这一项没带终态"与"它真的成功了"同形 ——
 *   而那是本次修复要消灭的形态本身。
 */
export declare function formatDependencyOutputs(items: readonly DependencyOutput[]): string;
export declare function assignmentPrompt(ticket: DispatchTicket, stateDir: string, teamId: string): string;
/** Install one scheduler and its member activity observer. */
export declare function installTeamScheduler(ctx: Context, config: SchedulerConfig): TeamScheduler;
