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
 * ── ★ V3-1（blocker）：本判据此前【在所有真实路径上恒为 skipped】──────────────
 *
 * MEASURED（2026-10-06，verifier3 / t3 的独立验证）：六处调用点传的 event 是
 * `member-dispatched` / `task-created` / `task-update` / `task-update-settled` /
 * `task-status` / `delivery-declared`，**没有任何一处**是 `'runtime-liveness'`。
 * 而本判据此前只认后者 ⇒ 它挂上去了，却一次都没跑过：
 *
 *     evaluate('runtime', {event:'task-status'})  ⇒ ok, evaluated: 0, skipped: 1
 *
 * ⇒ 源项目那个「63 分钟零进展，而没有任何一句话说它在等什么」的缺口，
 *   在本插件里**原样存在**：判据写得对，但它的输入面没接上。
 *
 * ── 修法：判据自己按【事件白名单】决定说不说话 ─────────────────────────────────
 *
 * ★ 为什么不改调用点（把某处的 event 改成 `'runtime-liveness'`）：探活本质是
 *   **跨步骤的比较**，它需要在**每次有人来看状态时**求值 —— 而那正是 `task-status`。
 *   把判据钉死在一个事件上，等于把"周期性"这件事交给某一个调用点去记。
 *
 * ★ 而白名单是**硬约束**，不是"全都跑，跑不动就 unmeasured"：后者会让五个无关的
 *   调用点每次都报一句"我没能测量" —— 噪音盖过信号，而那正是"教人忽略门禁"的
 *   另一种形态。⇒ 不该发言的事件上，它必须明确地【不适用】（`appliesTo` 为假），
 *   而不是"跑了但测不成"。这两种必须不同形（GATE-REGISTRY §8.5 规则一）。
 *
 * ★ 为什么是 `task-status`（而不是另外五个）：它是**时刻驱动**的那一个 ——
 *   用户裁定的"10 分钟探活一次"就发生在查状态时。其余五个是"这件事发生了"的
 *   通知，不是"现在几点了"的探问；在那里比较"两次探活"没有意义（同一个事件在
 *   一次调用里至多发生一次）。
 *
 * ★ `'runtime-liveness'` 这个自造事件仍留在白名单里：夹具与将来的显式探活入口
 *   用它。删掉它会让一大批直接拷 ctx 的臂无谓地变成 skipped。
 *
 * ★ 它**不**在"能开口却缺输入"时闭嘴：那种情形由 `gate` 说 `unmeasured`
 *   （见下面的"缺省方向"）。**不适用**与**没能测量**必须不同形 —— 用 `appliesTo`
 *   去藏"我拿不到时钟"，就是把「没测到」并进「通过」的那条老路。
 */
export declare const LIVENESS_EVENTS: readonly string[];
export declare function appliesTo(ctx: RuntimeLivenessContext | undefined): boolean;
export interface RuntimeLivenessContext {
    /** 六个调用点里 discriminator 之一；本判据只在 {@link LIVENESS_EVENTS} 上开口。 */
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
        /** 这次等待属于哪个任务/成员 —— 用来让告警**指名道姓**（团队级复数面上尤其重要）。 */
        taskId?: string;
        memberName?: string;
        attemptId?: string;
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
    /**
     * ── ★ 团队级观察面：`waits`（复数）─────────────────────────────────────────────
     *
     * `task-status` / `delivery-declared` 这两个调用点拿不到"某一个任务"，
     * 它们交的是"这个队里每个未结束尝试一条"（见 `teamWaitObservations`）。
     * 判据**不**把它们合成一条裁决 —— N 个等待是 N 个独立的事实，
     * "A 卡死了"不该被"B 在动"冲淡，也不该反过来。
     *
     * ★ 复数与单数**不同形**（与 `members` / `wait` 那两条分界同源）：
     *   · `waits: []`   —— 观察了，这个队**此刻没有人在等**
     *   · `waits` 缺席 —— 没能观察
     *   两者都**不是**"探过了、都健康"。
     */
    waits?: ReadonlyArray<WaitObservation>;
    /** 给产出用的标识（哪个任务/哪个成员在这次等待里）。缺省不影响裁决。 */
    task?: {
        id?: string;
        assignee?: string;
    };
}
/** 一份等待观察（`ctx.wait` 与 `ctx.waits[]` 是同一形状）。 */
export type WaitObservation = NonNullable<RuntimeLivenessContext['wait']>;
/**
 * ── ★ 单数 / 复数：两种观察面，一个判据 ────────────────────────────────────────
 *
 * `gate` 只做**分派**，真正的探活在 {@link probeOne} 里。这样"哪些结论有证据"
 * 这类问题只有一处要读，而两个形状各自的分界（见下）也各自只有一处。
 */
export declare function gate(ctx: RuntimeLivenessContext): GateVerdict;
