/**
 * ── 判据：liveness（探活 —— 卡死报警 + 定期告知）────────────────────────────────
 *
 * 插入点：`runtime`（跨步骤的过程约束，契约 §5）
 * id     ：`runtime.liveness`
 *
 * ── ★ 它不是「硬超时」，是「周期性探活」—— 这个区别是根本的 ────────────────────
 *
 * ```
 * 硬超时：t=30min ⇒ 判定失败 ⇒ 结束等待      与「任务本来要多久」【无关】
 * 探活：  t=10,20,30min ⇒ 每次问「还健康吗」
 *         · 健康 ⇒ 继续等，不打断
 *         · 异常 ⇒ 报警
 * ```
 *
 * 用户原话：「有的任务确实超过 30min，10min 或 5min 探活一次比较好」。
 * ⇒ 本判据【永不】因为"等了太久"而说一句话。它只问一个更窄、也更可判定的事实：
 *   **上一次探活与这一次探活之间，它动过没有。**
 *
 * 源项目的实测缺口（`~/Desktop/自动化开发插件/src/core/with-timeout.mjs` 的文件头）：
 * 六条等子代理的通道里一条有超时、一条没有 ⇒ 循环 **63 分钟零进展**，
 * 而**没有任何一句话说它在等什么**。本判据的两半正好对着这两件事：
 *
 *   ① 卡死了   —— 两次探活，最后活动时刻没变 ⇒ `blocked`（作为【告警】，不是拒绝）
 *   ③ 定期告知 —— 不判断健康，只报「还在跑，已 N 分钟」⇒ `ok` + 一份可读的产出
 *
 * ✗ 「没进展」【不做】（用户已裁定）。「思考很久」与「卡住」在观察上同形 ——
 *   一个在两次探活之间没产出的成员，可能只是在想。判它必然误报，而误报会教人
 *   忽略这条判据。本判据**只比较两端**：`lastActivityAt` 变了没有。
 *
 * ── ★ 它是【有状态】的（本插件第一条用到契约 §5 那个许可的判据）───────────────
 *
 * ```
 * 「超时了吗」只需要：等了多久 + 一个阈值
 * 「还健康吗」需要：  等了多久 + 它现在还在动吗 + ★ 上一次探查时它在哪
 * ```
 *
 * ★ 但状态【不放在本文件里】。放在这里的代价是实测过的：判据层是一个纯模块，
 *   它被五个不同的调用点（以及夹具、以及进程级单例）使用 —— 一份藏在模块作用域里
 *   的"上次探活记录"会让同一条等待在夹具之间互相污染，而那种缺陷只在长会话里出现。
 * ⇒ 状态由**调用方**持有（每条等待一份记录），经 `wait.previous` 注入；
 *   本文件对同一份输入【永远给同一个裁决】（纯函数），因此可测、可重放。
 *
 * ── 三条不可协商的性质（契约 §2）──────────────────────────────────────────────
 *
 * ① 纯数据变换：不 import 任何 I/O，**不调 `Date.now()`**。时钟（`wait.now`）、
 *    等待起点（`wait.startedAt`）、最后活动时刻（`wait.lastActivityAt`）全部由
 *    调用方注入 —— 因为会话事件**不带时间戳**（`assistant/message` 只有内容），
 *    「最后活动时刻」只能在观察到产出的那一刻【记下来】，本判据无从自己读它。
 * ② 不调用别的判据。
 * ③ 三态：ok / blocked / unmeasured，且后两者不同形。
 *
 * ── ★ 它不能拒绝任务（契约 §5 硬要求）─────────────────────────────────────────
 *
 * `runtime` 位置管的是"过程健不健康"，不是"这一步过不过"。`blocked` 在这里的语义是
 * **报警 + 证据**，它落进运行日志与工具结果的 `runtime_gates` 字段，供控制台与交付
 * 时判读；调用方【不得】据此拒掉任何任务。拒任务该由 `completion` 位置上的一条判据
 * 去读这条记录（§5 原话），而不是让过程约束当场把任务卡死。
 */
import { type GateVerdict } from '../registry.ts';
export declare const id = "runtime.liveness";
export declare const point = "runtime";
export declare const description = "\u5468\u671F\u6027\u63A2\u6D3B\uFF1A\u4E24\u6B21\u63A2\u6D3B\u4E4B\u95F4\u6700\u540E\u6D3B\u52A8\u65F6\u523B\u6CA1\u53D8 \u21D2 \u544A\u8B66\u300C\u5361\u6B7B\u4E86\u300D\uFF1B\u8FD8\u5728\u6D3B\u52A8 \u21D2 \u53EA\u62A5\u300C\u8FD8\u5728\u8DD1\uFF0C\u5DF2 N \u5206\u949F\u300D\u3002\u6C38\u4E0D\u56E0\u4E3A\u7B49\u592A\u4E45\u800C\u8BF4\u8BDD\uFF08\u5B83\u662F\u63A2\u6D3B\uFF0C\u4E0D\u662F\u786C\u8D85\u65F6\uFF09\uFF0C\u4E5F\u4E0D\u62D2\u7EDD\u4EFB\u52A1\uFF08\u5951\u7EA6 \u00A75\uFF09";
/** 探活间隔（毫秒）。用户裁定 10 分钟 —— 5 分钟对长任务太频繁、日志会被刷屏。 */
export declare const DEFAULT_LIVENESS_INTERVAL_MS: number;
/**
 * 本判据要不要开口 —— 只认它自己的事件。
 *
 * ★ 为什么【不】对所有 runtime 事件说话：其余五个调用点（`task-created` /
 *   `task-update` / `task-update-settled` / `task-status` / `delivery-declared`）
 *   根本不是"一次探活"，在那里说"我测不到时钟"会让每一条工具调用都背上一句
 *   未测量的噪音 —— 而噪音是"让判据被关掉"最快的路。
 *
 * ★ 而它**不**在"能开口却缺输入"时闭嘴：那种情形由 `gate` 说 `unmeasured`
 *   （见下面的"缺省方向"）。**不适用**与**没能测量**必须不同形 —— 用 `appliesTo`
 *   去藏"我拿不到时钟"，就是把「没测到」并进「通过」的那条老路。
 */
export declare function appliesTo(ctx: RuntimeLivenessContext | undefined): boolean;
export interface RuntimeLivenessContext {
    /** 六个调用点里 discriminator 之一；本判据只认 `runtime-liveness`。 */
    event?: string;
    /**
     * ── ★ 等待的观察面（本判据需要的输入，由调用方注入）───────────────────────────
     *
     * `undefined` 与"字段缺席"是两个不同的东西，但**在这里它们都是没测到**：
     * 一个是"整份观察面没给我"，一个是"给了但里面没有那一项"。
     * 唯一的例外是 `wait` 整个缺席 —— 那说明这个事件类型没有挂 runtime 判据，
     * 本判据根本不会跑（`appliesTo` 已经挡掉了）。
     */
    wait?: {
        /** 这次等待的起点（ms epoch）。onDispatched 那一刻记下 ⇒ ★ 它必须由调用方给。 */
        startedAt?: number;
        /** 最近一次【观察到产出】的时刻（有 assistant/message 才算在动；status 抖动不算）。 */
        lastActivityAt?: number;
        /** ★ 本次探活的时钟读数。判据自己不读表 —— 见文件头性质 ①。 */
        now?: number;
        /** 探活间隔；非法或缺席 ⇒ 落到 `DEFAULT_LIVENESS_INTERVAL_MS`（绝不抛错）。 */
        intervalMs?: number;
        /**
         * ── ★ 「这是不是第一次探活」由【字段在不在】决定，不由计数值决定 ──────────────
         *
         * 约定来自 t5（等待记录的持有者）：他给我一个 `previousPollAt`，
         * **缺席 ⇒ 这是第一次**。
         *
         * ★ 为什么不用 `pollCount`：那个数是他记的，而"第一次"是**这次求值**的性质。
         *   他记错一次（例如重派发后没清零），两次探活就会被读成一次 ⇒ **永远不报警** ——
         *   而一个永不报警的探活判据，与没装它在日志里同形。字段在不在是判据自己读得到的，
         *   一个计数不是。
         */
        previousPollAt?: number;
        /**
         * ★ 上一次探活时读到的【最后活动时刻】—— 没有它，① 卡死那一半就不可判定。
         *
         * ★ 这条不是可选的装饰：`previousPollAt` 只回答"这是不是第二次"，不回答
         *   "上一次它在哪"。少了这个读数，每一次探活都只能走"第一次"那条路 ⇒
         *   判据**永远不报警**，而它读起来一切正常（`ok`、有 message、有 wait_ms）。
         *   这正是本队反复见过的"装了但从不生效"。
         */
        previousLastActivityAt?: number;
    };
    /** 给产出用的标识（哪个任务/哪个成员在这次等待里）。缺省不影响裁决。 */
    task?: {
        id?: string;
        assignee?: string;
    };
}
export declare function gate(ctx: RuntimeLivenessContext): GateVerdict;
