/**
 * ── 判据：声明了 `shape: 'dispatch'` 的队，成员**真的**在派临时 worker 吗 ────────────
 *
 * 插入点：`runtime`（跨步骤的过程约束，契约 §5）
 * id     ：`runtime.shape-execution`
 *
 * ── 它防的是什么失效（MEASURED，上一轮形态验证亲手撞上）──────────────────────────
 *
 * 用户 2026-10-20 裁定乙方案：`team.json` 落一个 `shape` 位，成员提示按它选。
 * 那一轮真的跑通了一个 `shape: 'dispatch'` 的队（`dispatch-shape-probe`），
 * 派工也确实发生了。**而验证它是靠队长手工看会话文件** —— 那不是判据。
 *
 * `docs/SHAPE-VERIFICATION-PROBE-1.md` §4 逐字记着这个缺口：
 *
 *   「**`shape` 是一条声明，而"声明有没有被执行"今天没有读数。**
 *     一个 `shape: 'dispatch'` 的队如果成员全都自己干活，
 *     **没有任何一条臂会红**。」
 *
 * ⇒ 本判据就是那一条臂。它问的是一个**可判定**的事实：
 *
 *     这个队声明了 dispatch，而某个成员**干完过活**，却**一个临时 worker 都没派**。
 *
 * ★ 两格都必须成立才算违规。只看"没派"会把**还没开工的成员**判成违规
 *   （它没有机会派工），而那会马上教会人忽略这条判据。
 *
 * ── ★★★ 三态，且三者两两不同形（契约 §3.4）────────────────────────────────────
 *
 *   `ok`（`status: 'measured'`）      —— 读了；`shape_violations` 是违规成员名
 *   `ok`（`status: 'not-applicable'`）—— 这个队不是 dispatch 形态（**合法的常态**）
 *   `unmeasured`                      —— 输入面读不到（派工读数拿不到）
 *
 * ★★ 前两者**都落在 `ok`** 上，因为 runtime 位置的纪律是**不拒绝任务**（契约 §5）。
 *   于是"这个队违规了"必须靠 `outputs.shape_violations` 读出来，不能只靠 `ok` ——
 *   与 `runtime.liveness` 的 `stuck_count` / `runtime.stall` 的 `stalled_count` 同形。
 *
 * ★★★ 而 `unmeasured` **绝不并进** `ok`：把"没测到"读成"没有违规"，就是一个
 *   **恒不响的哨兵** —— 而它与"哨兵工作了、没人违规"在 `ok:true` 上同形。
 *   这一条是本仓记录最久的那次合流，这里再钉一次。
 *
 * ── 它【为什么】现在不拒绝 ─────────────────────────────────────────────────────
 *
 * 一条判据第一次上线就否决派发，会把"我的读数可能有 bug"变成"所有队都停下来"。
 * 本仓的既有做法是先进观察集（`AGENT_TEAMS_OBSERVE_GATES`），让它在真实语料上
 * 跑一轮再由人决定要不要升级为拒绝。★ 而它在这里连 `blockers` 都产不出来 ——
 * runtime 位置的裁决**只被记录**（见 `evaluateRuntimeGates` 的调用点）。
 */
import { type GateVerdict } from '../registry.ts';
import type { CtxPaths } from '../requires.ts';
export declare const id = "runtime.shape-execution";
export declare const point = "runtime";
export declare const description = "\u58F0\u660E shape=dispatch \u7684\u961F\uFF0C\u6210\u5458\u5FC5\u987B\u771F\u7684\u4E3A\u4EFB\u52A1\u6D3E\u4E34\u65F6 worker\uFF1B\u4E00\u4E2A\u5E72\u5B8C\u8FC7\u6D3B\u5374\u4E00\u4E2A\u90FD\u6CA1\u6D3E\u7684\u6210\u5458 \u21D2 \u5F62\u6001\u6CA1\u6709\u88AB\u6267\u884C\uFF08\u53EA\u62A5\u544A\uFF0C\u4E0D\u62D2\u7EDD \u2014\u2014 runtime \u4F4D\u7F6E\u7EAA\u5F8B\uFF09";
/**
 * ── 输入面：只声明 `event` 与 `team`，**不**声明 `shapeExecution` ──────────────────
 *
 * ★ 与 `delivery.coverage` 不声明 `coverage` 是**同一条理由**：
 *   `shapeExecution` 缺席是**本判据的一条合法输入**（⇒ `unmeasured`，一条裁决），
 *   而声明进 `requires` 会让核对层把它同时报成"接线缺陷"。
 *   ⇒ 把一条**裁决**报成一次**缺陷**，会让这条判据唯一正确的未测量支在硬化之后
 *     被拦成故障 —— 一个永远关着的门。
 *
 * ★ `team` 声明但不写子路径：整格在不在是 `appliesTo` 的闸门；
 *   而 `team.shape` 缺席**不影响**裁决（它只影响闸门）。
 */
export declare const requires: CtxPaths<ShapeExecutionContext>[];
/** 本判据只在**过程**幂点上开口（任务状态变更 / 交付宣告）。 */
export declare const SHAPE_EXECUTION_EVENTS: readonly string[];
export interface ShapeExecutionContext {
    /** 六个调用点里 discriminator 之一；本判据只在 {@link SHAPE_EXECUTION_EVENTS} 上开口。 */
    event?: string;
    /** 团队面：只要 `shape`（闸门）与 `tasks`（谁干过活）两格。 */
    team?: {
        id?: string;
        shape?: 'dispatch' | 'flat';
        tasks?: readonly unknown[];
    };
    /**
     * ── ★★ 注入的派工读数（由调用方算一次）────────────────────────────────────────
     *
     * 形状见 `members.ts` 的 `ShapeExecutionReadout`（三态：not-applicable / measured /
     * unmeasured）。**缺席 ⇒ 没能测量**，不是"没有违规"。
     *
     * ★ 为什么由调用方注入而不是判据自己读会话：契约 §2 性质 1 —— 判据不 import I/O。
     *   会话事件只有 `ctx.agents` 那头读得到，而判据层拿不到 `ctx`。
     */
    shapeExecution?: {
        status: 'not-applicable' | 'measured' | 'unmeasured';
        violations?: readonly string[];
        reason?: string;
    };
}
export declare function appliesTo(ctx: ShapeExecutionContext | undefined): boolean;
export declare function gate(ctx: ShapeExecutionContext): GateVerdict;
