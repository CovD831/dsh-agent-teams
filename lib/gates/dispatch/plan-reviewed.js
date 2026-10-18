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
 *   `ok`          —— 带了 `reviewed`，且**五问里没有一问是 `fail` / `unmeasured`**，
 *                    且戳的 `at` **不早于**这道门上线的时刻（见下面的"第四个问题"）
 *   `blocked`     —— `reviewed` **缺席**（★ 而措辞必须**指名它缺哪一问**）
 *                    ★ 或者：`ok:false` 的**第二种** —— `at` 早于门上线 ⇒ 时间上不可能
 *                    （两者都落在 `blockers`，而 `blockedKind` 是分开它们的机械记号）
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
 * ── ★★★ 第四个问题：这个戳的**时刻**有可能是真的吗？（2026-10-19 补）────────────────
 *
 * MEASURED（`node scripts/reviewed-stamp-census.mjs`）：盘上带戳任务 **151**，
 *   其中 **95** 条的 `reviewed.at` 早于这道门上线的时刻，而那 95 条的任务**全部晚于**
 *   这道门（合法的"老任务当然没有戳"一条都没有）
 *   ⇒ 这不是"老数据没清"，是**新任务带着一份比机制更老的戳**。
 *
 * ★★ 而本判据此前只读 `checks` 的形状、五问是否齐全、有没有 fail/unmeasured ——
 *   `at` 被**原样抄进读数**却从不与任何东西比较 ⇒ 一份"五问齐全、why 写得很漂亮、
 *   `at` 指向一年前"的戳能**一路通过**。门问的是「五问都答了吗」，
 *   而**不是**「这份记录有可能是真的吗」。
 *
 *   `reviewed.at <  PLAN_REVIEWED_GATE_ONLINE_AT` ⇒ ★ **不可能**（可判定的事实）
 *   `reviewed.at >= PLAN_REVIEWED_GATE_ONLINE_AT` ⇒ 可能 ⇒ 走原来的通过路径
 *   `at` 缺席 / 不是有限数                        ⇒ ★ **不判不可能**（原样不动）
 *
 * ★ 为什么"早于门"不可能：`reviewed` 是**先审后建**（`create_task` 的输入参数），
 *   而"派发前必须审过"这条路在门上线那一刻之前**还不存在** ⇒ 一条早于它存在的戳
 *   不可能是这条路审出来的，它是**从别处带来的**。
 * ★ 而**不是** `at < createdAt`：那才是正常形态（先审、再建）——
 *   拿它当异常会把这条路由的设计本身判成违规。
 *
 * ★★ 为什么落 `blocked` 而不是 `unmeasured`：`docs/GATE-REGISTRY.md` 规则一
 *   ——「可判定的事实」不得写成「没能测量」。两个数一比就出结论。
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
export const REVIEW_QUESTION_IDS = Object.freeze([
    'scope', // 写域：inScope 是否覆盖了它要改的全部？（t54 漏了三个文件）
    'prerequisite', // 前置：它依赖的东西在不在？（t58 第二半的前提不在）
    'move', // 搬运：若它要搬东西 ⇒ 有没有核对手段？（t70 丢 4 组接线）
    'acceptance', // 验收：acceptance 能不能判真假？会不会恒真？（t94 的"恰好落一栏"）
    'boundary', // 越界：outOfScope 是否挡住了它会碰到的东西？
]);
export const id = 'dispatch.plan-reviewed';
export const point = 'dispatch';
export const description = '★ 派发前：这份计划**审过了吗**？—— 带 `reviewed` 且五问无 fail/unmeasured ⇒ 放行；'
    + '不带 ⇒ 拦住（★ 而"不带"是正常状态，不是错误：它是"这条路没走自动生成"）；'
    + '带了而形状坏 ⇒ 读不出它审了什么 ⇒ unmeasured（★ 绝不并进通过）；'
    + '带了的戳还必须是**时间上可能**的：`reviewed.at` 早于本判据上线的时刻 ⇒ 不可能（可判定的事实，'
    + '落拦住而不是"没能测量"）；`at` 缺席或不是有限数 ⇒ 不判不可能（行为原样不动）。';
/**
 * 输入面声明：本判据只读契约上的 `task.reviewed` 这一格。
 *
 * ★ 而它**不声明**五问的名单 —— 那是本判据自己的常量（它判的是"审没审"，
 *   而不是"审查程序问了什么"）。两份对齐由臂钉住，不由 `requires` 表达。
 */
export const requires = ['task.reviewed'];
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
export function appliesTo(ctx) {
    if (ctx === undefined || ctx === null)
        return false;
    const task = ctx.task;
    if (task === undefined || task === null)
        return false;
    /**
     * ★ 这里只问"有没有一个任务"—— 而**不**问"它审没审"：
     *   后者是本判据要回答的问题，不是它适不适用的闸门。
     *   ★ 把"没审"写进 `appliesTo` ⇒ 判据**根本不跑** ⇒ 与"没装"同形。
     */
    if (typeof task !== 'object')
        return false;
    /**
     * ── ★★★ 存量任务：这道门对它【不适用】（2026-10-09，两处规则一起定的）──────
     *
     * MEASURED：本队 **39 条任务里 0 条**带 `reviewed` 戳，而**全部建于**这道门之前
     *   ⇒ 这道门对它们一律开口 ⇒ **每一次状态转换都被拒** ⇒ 全队停摆。
     *
     * ★★ 而我第一版把存量落成 `unmeasured` —— **那违反了本仓一条跨层规则**
     *   （`docs/GATE-REGISTRY.md` 规则一，逐字）：
     *   > **「可判定的事实」不得写成「没能测量」**
     *   > 正确的表达：**不适用 ⇒ `ok`**（并要与「测过了」不同形，带跳过之类的标记）
     *
     *   ★ 而"这条任务早于闸门"是**完全可判定**的（`createdAt` 是个数、上线时刻是常量，
     *     两者一比就出结论）⇒ 它既不是 `unmeasured`（我没能测），也不是 `blocked`（违规）。
     *   ⇒ ★ 它是【不适用】：**这条路在它建的时候还不存在，所以它不可能有那一格。**
     *
     * ★★★ 而"不适用"的正确落点是【`appliesTo` 返回 false】，而不是在 `gate` 里造一个
     *   假的三态 —— 因为只有前者能让注册表如实报 `skipped`，而"跳过了"与
     *   "跑了而结论是通过"是【不同形】的两件事（本队记账最久的那条）。
     *
     * ★ 而新任务（晚于上线时刻）⇒ `appliesTo` 仍为真 ⇒ 缺席仍然 `blocked`（那一半没放宽）。
     */
    return !predatesThisGate(task);
}
/** 一条 check 的三态（与 `src/types.ts` 的 `ReviewedCheck.verdict` 同一套取值）。 */
const VERDICT_PASS = 'pass';
const VERDICT_FAIL = 'fail';
const VERDICT_UNMEASURED = 'unmeasured';
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
 *
 * ★★★ 2026-10-19：它现在被**两个方向**使用，而两个方向**故意相反**：
 *   · `Task.createdAt <= 本常量` ⇒ 存量 ⇒ `appliesTo` 假（偏宽：不开口）
 *   · `reviewed.at <  本常量` ⇒ 时间上不可能 ⇒ `gate` 拦住（偏严：可判定的事实）
 *   ⇒ 不是同一个比较抄了两遍：前者问"这条路在它建的时候存不存在"，
 *     后者问"这条路有可能盖出这个戳吗"。两问共用一个**历史事实**，所以共用一处常量。
 */
export const PLAN_REVIEWED_GATE_ONLINE_AT = Date.parse('2026-10-09T09:33:50+08:00');
/**
 * ── ★★★ 一个**时刻**可被渲染的上界：`|ms| <= 8.64e15`（2026-10-19，F1）─────────
 *
 * MEASURED（本任务复现）：`reviewed.at = ±(8.64e15 + 1)` 已经在**可表示范围之外**
 *   —— `isoInstant()` 那一行的 `RangeError: Invalid time value` 不是因为它拿到了
 *   `NaN`，而是因为那个毫秒数**不存在对应的时刻**。
 *
 * ★ 为什么它是常量而不是每次现算：它与 `PLAN_REVIEWED_GATE_ONLINE_AT` 同一性质 ——
 *   一个**不会变的事实**（那个 API 的可表示范围），而不是一次测量。
 *   ★ 而它比 `Number.isFinite` 更窄：`1e300` 是有限数，但它不是一个时刻。
 */
const MAX_RENDERABLE_INSTANT = 8.64e15;
/**
 * 一条任务是否【早于这道门】。
 *
 * ★ 三条边界，逐条说清（宁可偏宽）：
 *   · `createdAt` 读不出（不是数）⇒ ★ 判 `true`（"我不知道它何时建的" ⇒ 不拒绝）
 *   · `createdAt` 早于上线时刻     ⇒ `true`（存量）
 *   · `createdAt` 晚于上线时刻     ⇒ `false`（新任务 ⇒ 缺席仍然 blocked）
 *   ★ 而"恰好相等"落 `true`（偏宽那一侧）。
 */
function predatesThisGate(task) {
    const createdAt = task?.createdAt;
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt))
        return true;
    return createdAt <= PLAN_REVIEWED_GATE_ONLINE_AT;
}
/**
 * 一个时刻的 UTC/ISO 渲染。
 *
 * ★ 带参数的构造是**纯换算**：给一个已知毫秒数 → 一个固定字符串，它不读墙钟。
 *   本文件那条"不读时钟"的臂 ban 的是**零参**的构造，以及两个直接读墙钟的入口
 *   ——它们让同一次输入两次跑出不同裁决。把一个**已知**毫秒数渲染成人读形式不会。
 *   ★ 注：本段注释**不写那几个字面**，因为那条臂是拿正则扫源码文本的
 *     （扫到的第一版就是被自己的注释打红的 —— 记在此处当路标）。
 */
function isoInstant(instant) {
    /**
     * ★★★ `|instant| > 8.64e15` ⇒ 那个渲染入口**抛 RangeError**（2026-10-19）。
     *
     * MEASURED（本任务的缺陷现场）：`reviewed.at = -1e300` 一路走到这一行，抛
     *   `RangeError: Invalid time value` —— 它不是一条裁决，而是一个异常，
     *   于是它**绕过**三态判定，穿出 `gate()`，再穿出整条 `evaluate('dispatch', …)`
     *   ⇒ 同一次求值里别的判据的可读 blocker 一起丢（那是本条要治的外溢）。
     *
     * ★ 而 8.64e15 是那个 API 的**可表示边界**（±100 000 000 天），不是我们定的：
     *   边界两侧是**两件不同的事** —— 之内可以渲染成人读时刻，之外根本没有那一刻。
     *   ⇒ 无论「越界」被归到哪一档，这一行都**不许**再抛：它只回答"渲染得出吗"。
     */
    if (!Number.isFinite(instant) || Math.abs(instant) > MAX_RENDERABLE_INSTANT)
        return undefined;
    return new Date(instant).toISOString();
}
/**
 * ── ★★★ 一份戳的**时刻**有可能来自这条路由吗？（2026-10-19）────────────────────────
 *
 * 返回 `undefined` ⇒ **不判不可能**：可能（`at >= 上线时刻`），**或**读不出
 * （缺席 / 不是有限数 / ★ **有限但超出一个时刻可表示的范围**）。三种都走今天
 * 原来的那条路 —— 这不是"漏判"，是**故意不动**：
 *   · `at` 缺席是"这一格没写完"，而它与"这一格写着一年前"是**不同的事**，
 *     前者该由补齐记录解决，后者是记录不可能成立；
 *   · `at` 不是有限数 ⇒ 读不出 ⇒ 按本仓那条纪律（「没能测量」不得读成「拒绝」），
 *     不许把它折成不可能。
 *   · ★ 有限但越界（`|at| > 8.64e15`）⇒ **同一个道理**：那个毫秒数没有对应的时刻，
 *     所以它仍然是一个**读不出来的读数**，而不是一条"我算出了它不可能"的事实
 *     （2026-10-19，F1；见 `stampImpossibility` 里那两道挡）。
 *
 * ★★ 而**不是** `at < task.createdAt`：`reviewed` 是 `create_task` 的输入参数，
 *   审查先发生、盖章、然后才建任务 ⇒ 戳早于任务创建是**这条路的设计**。
 *   拿 `< createdAt` 当异常会把正常形态判成违规（第一版就这么判反过，记在此处当路标）。
 *
 * ★ 方向（已定，不再讨论）：
 *   `at <  PLAN_REVIEWED_GATE_ONLINE_AT` ⇒ 不可能（早于这条路由存在）
 *   `at >= PLAN_REVIEWED_GATE_ONLINE_AT` ⇒ 可能（原来的通过路径）
 */
function stampImpossibility(at) {
    /**
     * ── ★★★ 两道挡（2026-10-19，F1）─────────────────────────────────────────────
     *
     * ① 读不出「一个数」⇒ 不判不可能（`NaN` / `±Infinity` / 字符串 / 缺席）。
     * ② ★ 读得出是数，但它**超出一个时刻可表示的范围** ⇒ 与 ① **同一档**。
     *
     * MEASURED（本任务复现，不是推论）：只挡非有限数时，
     *   `at = -1e300`、`at = -8640000000000001` 抛 `RangeError: Invalid time value`；
     *   而 `at = +8640000000000001` / `+1e300` **不抛** —— 那不是这道挡守住了它，
     *   是下面 `at >= 门上线` 先返回了。⇒ 正向越界的"不抛"是**偶然**，
     *   把 `>=` 换成 `>` 或者移动顺序，它立刻开始抛。两道都要挡才不靠顺序。
     *
     * ★ 为什么落 `undefined`（= 不判不可能）而不是 `unmeasured`：
     *   与 ① 逐字同理 —— 这个值是**读不出来的时刻**，不是"我算了一下发现它不可能"。
     *   折成 `blocked` 会把「读不出」写成「拒绝」（本仓那条最贵的纪律）；
     *   折成 `unmeasured` 则要在这条判据上新增一个"部分读不出"的档，而 `NaN`
     *   那一档已经定了**不新增拒绝**（夹具的臂 13 / 12 钉着）⇒ 两者必须同形。
     *   ⇒ ★ 越界与 `NaN` 同档：**不判不可能，行为原样不动**。
     */
    if (typeof at !== 'number' || !Number.isFinite(at))
        return undefined;
    if (Math.abs(at) > MAX_RENDERABLE_INSTANT)
        return undefined;
    if (at >= PLAN_REVIEWED_GATE_ONLINE_AT)
        return undefined;
    const delta = PLAN_REVIEWED_GATE_ONLINE_AT - at;
    const days = (delta / 86_400_000).toFixed(2);
    /**
     * ★★★ 措辞必须**指名两个时刻与差值**（契约硬要求）。
     *   一句"这个戳不可能"与"我不知道它为什么不可能"同形 ——
     *   而读的人要判断"这份记录是不是从别处带来的"，需要知道的正是**差多远**。
     */
    /**
     * ★ 两个渲染各自可能给不出字符串（越界 / 非有限数）—— 但走到这一行时它们**都**在
     *   可表示范围内（两道挡已经在上面把越界挡掉了），所以这里是**兜底而不是主路径**：
     *   真出现 `undefined` 也只是措辞退化成一个可读的占位，**绝不抛**。
     *   ★ 夹具钉的是更强的形式：越界值**根本到不了**这一行（它的裁决与 `NaN` 逐字同形）。
     */
    const rendered = isoInstant(at) ?? `the instant ${String(at)} ms`;
    const online = isoInstant(PLAN_REVIEWED_GATE_ONLINE_AT) ?? `the instant ${PLAN_REVIEWED_GATE_ONLINE_AT} ms`;
    return `the \`reviewed\` stamp is timestamped ${rendered}, which is ${days} days and ${delta} ms `
        + `EARLIER than the moment this gate went online (${online}). `
        + '★ A stamp older than the route that could have produced it cannot have come from that route: '
        + 'the "review before dispatch" path did not exist yet, so this stamp was brought in from elsewhere. '
        + '★ This is a decidable fact about the record (two instants compared), not a failure to measure — '
        + 'so it stops dispatch instead of reading as `unmeasured`. '
        + '★ The fix is to re-stamp it against the artefacts it actually reviewed; rewriting `at` to a later '
        + 'instant would be forgery, and re-running the whole review is not the same thing.';
}
/**
 * 把 `reviewed` 压成**可判的形状**，或如实说读不出什么。
 *
 * ★ 返回三态：`{ kind: 'readable' | 'shaped-wrong' | 'absent' }`
 */
function readReviewed(reviewed) {
    /** ① 缺席 —— 而它与"在场但坏"**不同形**（见文件头）。 */
    if (reviewed === undefined || reviewed === null)
        return { kind: 'absent' };
    if (typeof reviewed !== 'object' || Array.isArray(reviewed)) {
        return { kind: 'shaped-wrong', why: `\`reviewed\` is a ${Array.isArray(reviewed) ? 'array' : typeof reviewed}, not a stamp object` };
    }
    const stamp = reviewed;
    if (!Array.isArray(stamp.checks)) {
        return { kind: 'shaped-wrong', why: '`reviewed.checks` is not an array — a stamp without its per-question verdicts cannot be read' };
    }
    /**
     * ★★ 逐条读，而**任何一条形状坏 ⇒ 整份不可读**（不是"跳过坏的、看剩下的"）：
     *   跳过坏的那条会让一份**部分损坏**的记录读起来像"其余都过了"。
     */
    const checks = [];
    for (const [index, raw] of stamp.checks.entries()) {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
            return { kind: 'shaped-wrong', why: `\`reviewed.checks[${index}]\` is not an object` };
        }
        const entry = raw;
        if (typeof entry.id !== 'string' || entry.id.trim() === '') {
            return { kind: 'shaped-wrong', why: `\`reviewed.checks[${index}].id\` is missing — a verdict with no question attached answers nothing` };
        }
        if (typeof entry.verdict !== 'string' || entry.verdict.trim() === '') {
            return { kind: 'shaped-wrong', why: `\`reviewed.checks[${index}].verdict\` is missing — that question was stamped with no conclusion` };
        }
        checks.push({
            id: entry.id.trim(),
            verdict: entry.verdict.trim(),
            ...typeof entry.why === 'string' ? { why: entry.why } : {},
        });
    }
    return { kind: 'readable', checks };
}
/**
 * ── 三态裁决 ──────────────────────────────────────────────────────────────────
 *
 * ★★ 而 `blocked` 那一支的措辞必须**指名它缺哪一问**（契约硬要求）——
 *   一句"你该审了"与"我不知道你缺什么"同形，而补救的人需要知道的正是**缺哪一问**。
 */
export function gate(ctx) {
    const read = readReviewed(ctx?.task?.reviewed);
    /** ── 第三态：在场而形状坏 ⇒ `unmeasured`（读不出它审了什么）──────────────────── */
    if (read.kind === 'shaped-wrong') {
        return {
            ok: false,
            unmeasured: `a \`reviewed\` stamp is present but could not be read: ${read.why}. `
                + '★ This is NOT "not reviewed" — a review DID happen and its record is broken; '
                + 'rewriting the stamp is the fix, and re-running the whole review is not the same thing.',
        };
    }
    /** ── 第二态：缺席 ⇒ `blocked`，而**指名它缺哪一问**──────────────────────────── */
    if (read.kind === 'absent') {
        /**
         * ── ★★★ 存量：这条任务在【这道门存在之前】就被建了 ─────────────────────────
         *
         * MEASURED（2026-10-09，两位成员独立普查 + captain 复算）：
         *   本队 **39 条任务里 0 条**带 `reviewed` 戳 —— 而它们**全部建于** t8/t10 之前，
         *   即那条审查在那时候**还不存在**。
         *   ⇒ ★ 而这道门对它们一律判 `blocked` ⇒ **每一次状态转换都被拒**（含终态）
         *     ⇒ 全队停摆。
         *
         * ★★ 而那不是"它们没审" —— 是【这条路由在它们建的时候还不存在】。
         *   把两者读成同一件事，会让「我还没审」（一条待办）与
         *   「这条老任务被永久冻住」（一条缺陷）**同形**。
         *
         * ⇒ ★ 所以存量落 `unmeasured`（"我没能审，因为它在这道门之前"），而不是 `blocked`。
         *   ★ 而那与三态纪律逐字同源：「没能测量」不得读成「拒绝」，也不得读成「通过」。
         *
         * ★ 而它与 t19（存量失败 vs 新增失败）是**同一族的第二个实例**：
         *   共同形式 = **一条闸门要知道「它管的东西在它出现之前存不存在」。**
         */
        /**
         * ★★ 措辞逐条给出**五问各自的 id 与它问什么** —— 因为"缺哪一问"就是"五问都缺"，
         *   而读的人需要的正是那五问的名字（他要照着去审）。
         *   ★ 而它同时说清"不带**不是错误**"（用户原话），否则读的人会以为流程坏了。
         */
        return {
            ok: false,
            blockers: [
                'this plan has not been reviewed: no `reviewed` stamp is attached, and dispatch requires one '
                    + '(see docs/PLAN-REVIEW.md §8 — admission is "worth doing" AND "reviewed" AND "atomic"). '
                    + `★ It is missing all ${REVIEW_QUESTION_IDS.length} questions: ${REVIEW_QUESTION_IDS.map((questionId) => `\`${questionId}\``).join(', ')}. `
                    + '★ That absence is NOT an error — it is the normal state of "this route did not run the automatic review"; '
                    + 'it only means the review has to happen before dispatch, not that something went wrong.',
            ],
        };
    }
    /**
     * ── 第一态：可读 ⇒ 逐条查五问 ─────────────────────────────────────────────────
     *
     * ★★ 而"没有 `fail`/`unmeasured`"**还不够**：五问必须**逐条在场**。
     *   一个只写了三问的 `reviewed` 与一个写全了的，在"有没有 fail"这个读数上同形
     *   ⇒ 而缺的那两问**没有人问过**，那与"问了、过了"完全不同。
     */
    const byId = new Map(read.checks.map((check) => [check.id, check]));
    const missing = REVIEW_QUESTION_IDS.filter((questionId) => !byId.has(questionId));
    const failing = read.checks.filter((check) => check.verdict === VERDICT_FAIL);
    const unmeasured = read.checks.filter((check) => check.verdict === VERDICT_UNMEASURED);
    if (missing.length > 0) {
        return {
            ok: false,
            blockers: [
                `the \`reviewed\` stamp does not answer every required question — missing: ${missing.map((questionId) => `\`${questionId}\``).join(', ')}. `
                    + `★ A stamp that answers ${read.checks.length} of ${REVIEW_QUESTION_IDS.length} questions is not a review: `
                    + 'the unanswered ones were never asked, and "never asked" is not "asked and passed".',
            ],
        };
    }
    /**
     * ★★★ `unmeasured` **绝不并进 `ok`**（全库那条最贵的纪律）。
     *   "我没能把它审明白"与"审过了，没问题"不同形 ⇒ 它必须**挡住派发**，
     *   而措辞要说清是**哪几问**没能审明白（补救动作是"去把那几问审出来"）。
     */
    if (unmeasured.length > 0) {
        return {
            ok: false,
            blockers: [
                `the review could not settle ${unmeasured.length} question(s): `
                    + unmeasured.map((check) => `\`${check.id}\`${check.why === undefined ? '' : ` (${check.why})`}`).join('; ')
                    + '. ★ "Could not measure" must not be read as "measured and fine" — settle those questions before dispatching.',
            ],
        };
    }
    if (failing.length > 0) {
        return {
            ok: false,
            blockers: failing.map((check) => `the review failed \`${check.id}\`${check.why === undefined ? '' : `: ${check.why}`}`),
        };
    }
    /**
     * ── ★★★ 第四个问题：这份戳的**时刻**有可能是真的吗？（2026-10-19 补）──────────────
     *
     * ★ 位置是**故意最后**的：一份戳若已经在"问题答没答全 / 有没有 fail / 有没有
     *   unmeasured"上出了结论，那一结论才是补救的人第一步要处理的 ——
     *   而时间不可能是在**表面上完整**的戳上才需要单独说出来的另一件事。
     *   ★ 这一点由夹具的臂钉住（形状坏 + 一年前 ⇒ 仍然是 `unmeasured`，不是这里的 `blocked`）。
     *
     * ★★ 而它落 `blockers`（**不是** `unmeasured`）：两个时刻一比就出结论，它是**可判定的事实**
     *   —— `docs/GATE-REGISTRY.md` 规则一：「可判定的事实」不得写成「没能测量」。
     *
     * ★ 而 `blockedKind` 是"不可能"与"没审"这两个 `ok:false` **不同形**的机械记号：
     *   两者都落 `blockers`，若不留记号，读端只能靠措辞猜是哪一种 ——
     *   而它们的补救动作不同（**重盖** vs **去审**）。
     */
    const impossibility = stampImpossibility(ctx?.task?.reviewed?.at);
    if (impossibility !== undefined) {
        return {
            ok: false,
            blockedKind: 'reviewed-stamp-impossible',
            blockers: [impossibility],
        };
    }
    /**
     * ── `ok`：而它交出**判据层亲眼读到的读数**（不是成员自报的那一句）──────────────
     *   ★ 逐条给出五问各自的 verdict，于是读的人不必回去翻 `reviewed` 就知道它审了什么。
     */
    return {
        ok: true,
        reviewedReadout: {
            by: typeof ctx?.task?.reviewed?.by === 'string' ? ctx.task.reviewed.by : '(unlabelled)',
            at: typeof ctx?.task?.reviewed?.at === 'number' ? ctx.task.reviewed.at : null,
            answered: REVIEW_QUESTION_IDS.map((questionId) => ({
                id: questionId,
                verdict: byId.get(questionId)?.verdict ?? '(missing)',
            })),
        },
    };
}
