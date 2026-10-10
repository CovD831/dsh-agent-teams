import { AgentTeamsRuntime } from './shared/entities.ts';
import type { Context } from '@deepseek-ai/cordis';
/**
 * ── ★★★ 交付完成后**按任务**回收它的那棵 worktree（t-concurrency-1-t2）───────────────
 *
 * ── 它防的是什么失效（MEASURED）─────────────────────────────────────────────────
 *
 * `scripts/worktree-reclaim.mjs` 与 `src/worktree.ts` 的 `judgeWorktreeReclaimable`
 * 都是**写好了的**，而**全仓零调用方**：
 *
 *     $ grep -rn "judgeWorktreeReclaimable" src/          ⇒ 只有定义处
 *     $ grep -rn "worktree-reclaim" src/                  ⇒ 0 处
 *
 * ⇒ 后果：`lib/` 里那份判定**从未在生产路径上被执行过一次**，
 *   而盘上 46 棵 worktree 只得靠人手动 `--apply` 清 —— 用户原话是
 *   「不能每次都让我手动清理，得有一个自动清理的机制」。
 * ★ 而"一条没接线的判据"与"一条不存在的判据"，在"该不该删"这件事上**没有区别**。
 *
 * ── ★★★ 判据只有一份真值：**本函数不自己判断能不能删** ─────────────────────────────
 *
 * 能不能回收由 `judgeWorktreeReclaimable`（权威实现，`src/worktree.ts:528`）
 * 说了算 —— 它是「已提交的部分被主干吸收」∧「未提交的源码没有一份是历史里不存在的」
 * 两个条件的合取。**这里一行 `git` 都不跑**：
 *
 *   · ★ 不许 `git merge-base --is-ancestor`（那只是上面 (a) 那一半）；
 *   · ★ 不许 `git status --porcelain` + 唯一 blob 的手写推理（那是 (b) 那一半）；
 *   · ★ 不许多一份"吸收/唯一工作"的实现 —— 两份实现分叉时**没有任何东西会发现**，
 *     而分叉的代价是删掉唯一的那份产物（本仓 `task-t64` 实测过：7 个源码文件
 *     68KB/69KB 级，内容不在任何提交里）。
 *
 * ⇒ 本函数只做四件事：**读开关 → 加载模块 → 拿它的裁决 → 只对 `reclaimable` 落地删除**。
 *
 * ── ★★★★★ 入口条件（round-2 修复的那一格，MEASURED）──────────────────────────────
 *
 * **调用方在每一次终态转换、只要那棵树在，就调用本函数** —— 与"这一轮提交成了没有"无关。
 *
 * ★ 为什么这一格曾经是错的（round-1 的 blocker，reviewer 两次实测）：`commitWorktree`
 *   **只在 worktree 里**提交、从**不**合进 `main` ⇒ 提交刚成功的那一刻，树 HEAD 是一个
 *   全新 commit，按定义**不是** `main` 的祖先 ⇒ 权威判据必然答 `keep / not-absorbed`。
 *   ⇒ 把入口设在"提交成功"那一支 = 把入口设在**唯一一个判据必然说不的时刻**。
 * ★ 而**唯一可达**的"已吸收"形状是**没有新改动**的那一次（`commit === undefined`）：
 *   产物早先已被合流、这次本来就没东西要提交 —— 它也**走不到**那个分支。
 * ⇒ 修正：**树在 ⇒ 就判**。今天判 `keep` 是**正确的中间态**（产物还没合流），
 *   而**下一次**这条任务落终态时会再判一次 —— 那时才删。
 *   ★ 判据仍然只有 `judgeWorktree` 一条；本层**不**新增任何"吸收与否"的推理。
 *
 * ── ★★ 为什么**不**用 `planReclaim`（它是同一个脚本里的另一条）────────────────────
 *
 * `planReclaim` 扫的是**整棵** `<repo>/.agent-teams/worktrees/`（`listWorktrees(repo)`）
 * ⇒ 它是"全仓大扫除"，它删的树与**这条任务**没有关系。
 * ★ 而这里要的是**按任务**回收：只动 `this task` 那一棵。
 * ⇒ 所以只用**纯裁决**那一半（`judgeWorktree`），删除由本函数自己对**那一条路径**做。
 *
 * ── ★★★ 只读裁决：判定这一步**不可能**删掉任何东西 ────────────────────────────────
 *
 * `judgeWorktree` 的可见副作用面**只有 `git` 的只读查询**：
 *   `rev-parse` / `merge-base --is-ancestor` / `rev-list --count` /
 *   `status --porcelain` / `hash-object` / `log --find-object`。
 * 它【不】调用 `rmSync`、不写文件、不改仓库状态 —— 删除**只**发生在下面那一处，
 * 且被 `verdict.status === 'reclaimable'` 门住。⇒ "判定"与"删除"是**两个**动作，
 * 而不是"一次调用顺手删了"。
 *
 * ── ★★ 三态不同形，且 `undecidable` 绝不并进 `reclaimable` ────────────────────────
 *
 *   `reclaimable` ⇒ 删，并记一条 info（含模块自己的人话）。
 *   `keep`       ⇒ **不删**，把模块自己的措辞记下来（`reason` / `detail` / `orphaned`）。
 *   `undecidable`⇒ **不删**，记 `why` —— 「判不了」是**没测到**，不是"可以删"。
 * ★ 任一情形都留下**一行可读的日志**：没有静默分支（那会让"没回收"与"没跑"同形）。
 *
 * ── ★★ 它【绝不】改判这条任务 ──────────────────────────────────────────────────
 *
 * 提交失败、模块加载不了、删除抛错 —— **一律只记 warn**，不 throw、不动 `task.status`、
 * 不写 `task.deliveryFailure`。★ 回收是**记账之外**的清理，不是裁决：
 * 把"清理没成"读成"交付失败"，会让成员去重做已经做对的工作（本仓记账过的那一类浪费）。
 *
 * @returns 一条**可读的**读数（也给夹具断言用）；任何失败都落在 `outcome: 'failed'`。
 */
export declare function reclaimWorktreeAfterDelivery(options: {
    /** 那条任务的隔离检出（`createTaskWorktree` 的确定性命名，调用方已算好）。 */
    worktree: string;
    /** 主仓库根 —— 权威判据的 `repo`。 */
    repo: string;
    /** 只用于日志：哪条任务被回收了。 */
    taskId: string;
    /** 只用于日志：这条读数属于哪个已落终态的状态。 */
    status: string;
    /**
     * ── ★ 只用于**日志措辞**：这一轮的提交成了没有（`reclaimWorktreeAfterDelivery` 的入口）──
     *
     * `'committed'`          —— 刚交付了一个 commit（而它按定义**还没**被合流 ⇒ 今天多半是 `keep`）
     * `'nothing-to-commit'`  —— 树是干净的（★ 这一格才是"已吸收"通常被发现的地方）
     * `'commit-failed'`      —— 提交没成（★ 回收**仍然照判**：能不能删与记账成没成无关）
     *
     * ★★ 它**绝不**参与"能不能删" —— 那件事只有 `judgeWorktree` 说。
     *   把它做成输入会让本层出现**第二条判据**，而那正是本任务要消灭的形态。
     *   它只让日志能分出"刚交付、还没合流"与"没有新改动、只是重判"这两种情形。
     */
    commitOutcome?: 'committed' | 'nothing-to-commit' | 'commit-failed';
    /** ★ 注入点：默认走 `pluginRoot()` 动态 import（见下）。 */
    logger: {
        info: (message: string) => void;
        warn: (message: string) => void;
    };
    /** ★ 注入点（夹具用）：默认 `process.env`。 */
    env?: Record<string, string | undefined>;
    /** ★ 注入点（夹具用）：默认动态 import 那个脚本。 */
    loadJudge?: () => Promise<ReclaimJudgeModule>;
    /**
     * ★ 注入点（夹具用）：默认走 {@link ReclaimJudgeModule.removeWorktree}。
     *
     * ★★ 签名【不变】（`(path: string) => void`）—— 既有的夹具臂照旧注入，
     *   而**默认值**换了出处：它不再是这里的一句裸 `rmSync`，而是模块里那个
     *   「连 git 台账一起清」的唯一出处（见 `removeWorktree` 的文件头）。
     */
    remove?: (path: string) => void;
    /** 主干引用（默认 `main`，与权威实现一致）。 */
    mainRef?: string;
}): Promise<ReclaimOutcome>;
/**
 * ── ★★★★★ 扫一遍**已经终态**的任务，把它们早已被吸收的树收掉（defect 2）─────────────
 *
 * ── 它修的是什么缺陷（MEASURED，本任务的由来）───────────────────────────────────
 *
 * {@link reclaimWorktreeAfterDelivery} 只在**终态转换那一刻**被判一次。而它的
 * `keep / not-absorbed` 那条读数里**自己写着**"将在下一次终态转换时重判"。
 *
 * ★★ 而对一条**已经**终态、此后不再更新的任务，那个"下一次"**永远不会来**：
 *   没有 `update_task` 调用 ⇒ 没有终态转换 ⇒ 没有任何时刻会重判它
 *   ⇒ 一棵产物早已被合流进主干的树，**永久**留在盘上，
 *     而盘上的读数与"这条任务还在跑"同形。
 *
 * ── ★★★ 判据仍然只有一份真值 ────────────────────────────────────────────────────
 *
 * 本函数**一行"吸收与否"的推理都没有**：它把每一棵终态任务的树交给模块的
 * `scanTerminalWorktrees`（它再交给 `judgeWorktree` → `judgeWorktreeReclaimable`）。
 * ⇒ 与 CLI、与逐任务那条接线，三条路的答案来自**同一个函数引用**。
 *
 * ── ★★ 它在**名单层面**就保证"非终态不判、不删"─────────────────────────────────
 *   `scanTerminalWorktrees` 在判定之前就把非终态剔掉（见模块里那一节）。
 *   本层**不重做**那个筛选 —— 再筛一遍就是第二个出处。
 *
 * ── ★★ 三态不同形：只有 `reclaimable` 被删 ──────────────────────────────────────
 *   `keep`（未吸收 / 有唯一产物）与 `undecidable`（没测到）**绝不**被删。
 *   ★ 而它把三者的**数量**如实交出去（`kept` / `undecidable`），
 *     否则"扫了 0 棵"与"扫了 20 棵但一棵都不该删"在读数上同形。
 *
 * ── ★★★ 它【不】改任何任务状态，而且【绝不】往外抛 ──────────────────────────────
 *
 * 模块加载失败、判据抛错、删除抛错 —— 一律只记一条**可读的 warn** 并记进读数。
 * ★ 理由与逐任务那条逐字相同：回收是**记账之外**的清理，不是裁决。
 *   把"清理没成"读成"交付失败"，会让成员去重做已经做对的工作。
 * ★ 而"删不掉"必须留下可读痕迹（`failures`）——一个静默失败的删除与"没删"同形，
 *   而盘上留下的那棵树没人会知道。
 *
 * @returns 一条**可读的**读数（也给夹具断言用）；任何失败都不改变它的返回形状。
 */
export declare function reclaimTerminalWorktrees(options: {
    /** 主仓库根 —— 权威判据的 `repo`，也是 `.agent-teams/worktrees/` 的父目录。 */
    repo: string;
    /** 这一轮**落盘之后**的任务清单（★ 传 `fresh.tasks`，不是调用前那份）。 */
    tasks: readonly {
        id: string;
        status: string;
    }[];
    /** 团队 id —— 路径名的那一位（见 `worktreeDirName`）。 */
    teamId?: string;
    /** ★ 只用于日志。 */
    logger: {
        info: (message: string) => void;
        warn: (message: string) => void;
    };
    /** ★ 注入点（夹具用）：默认 `process.env`。 */
    env?: Record<string, string | undefined>;
    /** ★ 注入点（夹具用）：默认动态 import 那个脚本。 */
    loadJudge?: () => Promise<ReclaimJudgeModule>;
    /**
     * ★ 注入点（夹具用）：默认走 {@link ReclaimJudgeModule.removeWorktree}。
     *   签名与 {@link reclaimWorktreeAfterDelivery} 的那一格**刻意保持一致**。
     */
    remove?: (path: string) => void;
    /** 主干引用（默认 `main`，与权威实现一致）。 */
    mainRef?: string;
}): Promise<{
    scanned: number;
    reclaimed: string[];
    kept: number;
    undecidable: number;
    skipped: string;
}>;
/** `scripts/worktree-reclaim.mjs` 里本调用方**真正用到**的那几格（见该模块的导出）。 */
interface ReclaimJudgeModule {
    /** ★ 关掉它的开关**名字**（本函数从这里取，不重打字面量）。 */
    readonly RECLAIM_OFF_ENV: string;
    /** ★ 纯裁决 —— 只读，不删（见文件头的"只读裁决"那一节）。 */
    readonly judgeWorktree: (options: {
        repo: string;
        worktree: string;
        mainRef?: string;
    }) => ReclaimVerdict | Promise<ReclaimVerdict>;
    /**
     * ── ★★★ 删除的**唯一出处**：删目录 ∧ 清 git 的 worktree 台账 ────────────────────
     *
     * ★ 为什么删除也要走模块（而不是在这里写 `rmSync`）：
     *   裸 `rmSync` 会在 `git worktree list` 里留下一条 `prunable` 幽灵
     *   （目录没了、台账还在，而且它不会自己消失）——
     *   那正是本任务修的 defect 1，而它有**两处**删除点。
     *   ⇒ 两份实现分叉时，"哪一处留下了幽灵"在下游完全读不出来。
     *
     * ★ 它是**同步**的：契约就是"删完才算完"，而调用方在它抛出时要留痕
     *   （见下面 `reclaimable` 那一支的 catch）。★ 它会**抛**，绝不静默失败。
     */
    readonly removeWorktree: (options: {
        repo: string;
        worktree: string;
    }) => void;
    /**
     * ★★ 生产扫描器用的那一格（`scanTerminalWorktrees` → `isTerminalTask` 已在
     *   模块内部用它）—— 这里只借 `worktreeDirName` 之外的那份**纯规划**能力：
     *   见下面 `reclaimTerminalWorktrees`。
     */
    readonly scanTerminalWorktrees: (options: {
        repo: string;
        tasks: readonly {
            id: string;
            status: string;
            teamId?: string;
        }[];
        mainRef?: string;
    }) => {
        scanned: readonly ReclaimVerdict[];
        reclaimable: readonly ReclaimVerdict[];
        kept: readonly ReclaimVerdict[];
        undecidable: readonly ReclaimVerdict[];
    };
}
/** 权威裁决的三态 —— 字段**互不共用**（`reclaimable` 没有 `reason`，`undecidable` 没有 `detail`）。 */
type ReclaimVerdict = {
    readonly status: 'reclaimable' | 'keep' | 'undecidable';
    /**
     * ★★ 被判的那条**绝对路径** —— 由 `judgeWorktree` 原样填（见 `scripts/worktree-reclaim.mjs`）。
     *
     * ★ 为什么扫描器**必须**用它、而不自己再算一遍路径：
     *   扫描器（`scanTerminalWorktrees`）已经在模块里用 `worktreeDirName` 算过一次
     *   ⇒ 再算一遍就是第二个出处，而它与第一个分叉时删的是**另一条路径**
     *   （那正是"删错树"这种最贵的失效的形态）。
     *   ★ 这里只**读**它，不重算。
     */
    readonly worktree?: string;
    readonly reason?: string;
    readonly why?: string;
    readonly detail?: string;
    readonly human?: string;
};
/** 本函数交出的读数。★ 四态**互不同形**：删了 / 保住了 / 判不了 / 没成。 */
export interface ReclaimOutcome {
    readonly outcome: 'reclaimed' | 'kept' | 'undecidable' | 'skipped-off-switch' | 'failed';
    readonly worktree: string;
    readonly why?: string;
}
import type { ToolsConfig } from './shared/entities.ts';
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export declare function register(ctx: Context, clock: any, runtime: AgentTeamsRuntime, scheduler: any, config: ToolsConfig): void;
export {};
