/**
 * ── 判据：派发前必须**审过** —— 带 `reviewed` 放行；不带 ⇒ 先审一遍 ────────────────
 *
 * 插入点：`dispatch`（成员即将开工的那一刻）
 *
 * ── 用户已定的路由规则（本判据的全部内容，原文）────────────────────────────────
 *
 *   「带 `reviewed` ⇒ 放行；不带 ⇒ **必须先审一遍才能派**。
 *     ★ 而『不带』**不是错误** —— 它是『这条路没走自动生成』的正常状态。」
 *
 * ⇒ ★ 这一句里有**两件事**，而它们必须不同形：
 *     ① `reviewed` 在场且**审得过**  ⇒ 放行
 *     ② `reviewed` 缺席              ⇒ **拦住**（不是"判错了"，是"这件事还没做"）
 *   ★ 而"拦住"与"判错"的补救动作不同：前者去**审**，后者去**改**。
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * MEASURED：`docs/PLAN-REVIEW.md` §8 写的准入是**三条都要**：
 *   ① to-dispatch（值得做）② **审查通过（带 `reviewed`）** ③ 分档是【小档】
 * 而 ② 此前**没有任何东西在读** —— `reviewed` 那一格由 t2 建好了形状，
 * 却没有任何判据在派发前问它。
 * ⇒ 于是"派出的不应该有大活 / 没审过的不该直接派"这句话**只活在文档里**。
 * ★ 这与 `admission` 未接线、`reviewStateOf` 没有调用方是**同一个形状**：
 *   **机制在，而流程没走。**
 *
 * ── ★★★ 三态（且三者两两不同形）────────────────────────────────────────────────
 *
 *   `ok`          —— 带了 `reviewed`，且**五问里没有一问是 `fail` / `unmeasured`**
 *   `blocked`     —— `reviewed` **缺席**（★ 而措辞必须**指名它缺哪一问**）
 *   `unmeasured`  —— `reviewed` **在场而形状坏**（读不出它审了什么）
 *
 * ★★ 为什么"形状坏"是 `unmeasured` 而不是 `blocked`：
 *   一个形状坏掉的 `reviewed` 与一个"审过了、五问都写了"的，在**"有没有这一格"**
 *   这个读数上同形 —— 而它们完全不同（一个是"我审了、记录坏了"，一个是"我没审"）。
 *   ⇒ 把前者读成后者，等于**把一次真实的审查扔进"没审"里**（那会让人重审一遍，
 *     而重审的代价与"从没审过"是一样的）。
 *
 * ★★ 而 `unmeasured` **绝不并进 `ok`**（全库那条最贵的纪律）：
 *   "我没能把它审明白"与"审过了，没问题"不同形。
 *
 * ── ★ 它是**纯数据变换**（契约硬要求）────────────────────────────────────────────
 *
 * 本文件不 import 任何 I/O（不读盘、不碰网络、不看时钟）。五问的名单来自**注入的** ctx
 * 或本文件的常量 —— 判据不知道 `reviewed` 是怎么来的，只知道它长什么样。
 * ★ 这条有它的臂（读源码里的 import 字面量），因为"偷偷加一个 fs import"
 *   在**运行时的返回值上完全看不出来**。
 */
/**
 * ── 五问的**权威名单**：每问都对着一次真实事故 ────────────────────────────────────
 *
 * ★ 与 `scripts/friction-triage.mjs` 的 `REVIEW_CHECKS` **同一份内容**，
 *   而这里是它的**只读镜像**（那份在 `scripts/`，判据层不该 import 脚本目录 ——
 *   那会让"判据是纯数据变换"这条纪律破一个口）。
 *
 * ★★ 而两份必须**逐条对齐**（id 与条数）：本判据的臂里有一条钉住这件事 ——
 *   分叉之后"判据说它缺 scope、而审查程序根本不问 scope"在日志里同形。
 */
export declare const REVIEW_QUESTION_IDS: readonly string[];
export declare const id = "dispatch.plan-reviewed";
export declare const point = "dispatch";
export declare const description: string;
/**
 * 输入面声明：本判据只读契约上的 `task.reviewed` 这一格。
 *
 * ★ 而它**不声明**五问的名单 —— 那是本判据自己的常量（它判的是"审没审"，
 *   而不是"审查程序问了什么"）。两份对齐由臂钉住，不由 `requires` 表达。
 */
export declare const requires: readonly ["task.reviewed"];
export interface PlanReviewedContext {
    task?: {
        id?: string;
        /**
         * ★★★ 任务【何时建的】—— 它决定这道门要不要对这条任务说话。
         *
         * 本题的缺陷形状（MEASURED 2026-10-09）：一道**新上线的**门对**它出现之前**
         * 建的任务一律判 `blocked` ⇒ 全队每一次状态转换都被拒。
         *   ⇒ 而 `createdAt` 正是"它在这道门之前存不存在"的那处读数。
         *   ★ 读不出时（非数 / 缺席）按【偏宽】处理（落 `unmeasured`）。
         */
        createdAt?: unknown;
        reviewed?: {
            at?: unknown;
            by?: unknown;
            checks?: unknown;
        };
    };
}
/**
 * 只对**要派发**的那一刻说话。
 *
 * ★ 与 `dispatch.changed-paths` / `dispatch.worktree` 同一套闸门口径：
 *   本判据问的是"这份计划能不能派"，而那与**改了什么文件**无关
 *   ⇒ 它的闸门是 `update.status === 'in_progress'`（成员即将开工）。
 *
 * ★ 而它**不看 kind**：用户那条规则对**所有**要派的活都成立
 *   （"没审过的不该直接派" —— 没有说"只对某几类"）。
 */
export declare function appliesTo(ctx: PlanReviewedContext | undefined): boolean;
/**
 * ── ★★★ 这道门【何时上线】—— 而它是一处单一真值 ─────────────────────────────────
 *
 * MEASURED（2026-10-09，两位成员独立普查 + captain 复算）：
 *   本队 **39 条任务里 0 条**带 `reviewed` 戳，而它们**全部建于**这道门之前。
 *   ⇒ 门对它们一律判 `blocked` ⇒ 每一次状态转换都被拒 ⇒ 全队停摆。
 *
 * ★★ 所以这里需要一处"这道门从何时起存在"的读数 —— 而它**不需要一张新表**:
 *   它就是【本判据进 `ALL_GATES` 的那个提交的时刻】，而那个时刻是可核的：
 *     `git log -S"dispatchPlanReviewed" -- src/gates/index.ts` ⇒ `99e8fe3`（2026-10-09 09:33:50 +0800）
 *
 * ★ 为什么写成一个常量而不是运行时去问 git：
 *   · 判据在**每一次派发**时被求值，而读 git 是子进程 ⇒ 太贵
 *   · 而"这道门何时上线"是**一次性的历史事实**，它不会变
 *   ⇒ ★ 而它的**可核性**由一条夹具保证（夹具断言这个常量与 git 里那个提交对得上），
 *     而不是由"记得同步改两处"保证。
 *
 * ★★ 而两个时刻的**不同源**是一个必须处理的前提：
 *   `Task.createdAt` 由 `team.json` 写（墙钟），而本常量来自 git 的提交时刻（另一个墙钟）
 *   ⇒ 边界附近可能误判 ⇒ ★ **宁可偏宽**（不确定时落 `unmeasured`，而不是 `blocked`）——
 *     而那与三态纪律一致：「没能测量」不得读成「拒绝」。
 */
export declare const PLAN_REVIEWED_GATE_ONLINE_AT: number;
/**
 * ── 三态裁决 ──────────────────────────────────────────────────────────────────
 *
 * ★★ 而 `blocked` 那一支的措辞必须**指名它缺哪一问**（契约硬要求）——
 *   一句"你该审了"与"我不知道你缺什么"同形，而补救的人需要知道的正是**缺哪一问**。
 */
export declare function gate(ctx: PlanReviewedContext): {
    ok: true;
    reviewedReadout: Record<string, unknown>;
} | {
    ok: false;
    blockers: string[];
} | {
    ok: false;
    unmeasured: string;
};
