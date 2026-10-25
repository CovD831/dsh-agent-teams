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

import { ok, unmeasured, type GateVerdict } from '../registry.ts'
import type { CtxPaths } from '../requires.ts'

export const id = 'runtime.shape-execution'
export const point = 'runtime'
export const description =
  '声明 shape=dispatch 的队，成员必须真的为任务派临时 worker；一个干完过活却一个都没派的成员 ⇒ 形态没有被执行（只报告，不拒绝 —— runtime 位置纪律）'

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
export const requires: CtxPaths<ShapeExecutionContext>[] = ['event', 'team']

/** 本判据只在**过程**幂点上开口（任务状态变更 / 交付宣告）。 */
export const SHAPE_EXECUTION_EVENTS = Object.freeze(['task-status', 'delivery-declared'])

export interface ShapeExecutionContext {
  /** 六个调用点里 discriminator 之一；本判据只在 {@link SHAPE_EXECUTION_EVENTS} 上开口。 */
  event?: string
  /** 团队面：只要 `shape`（闸门）与 `tasks`（谁干过活）两格。 */
  team?: { id?: string; shape?: 'dispatch' | 'flat'; tasks?: readonly unknown[] }
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
    status: 'not-applicable' | 'measured' | 'unmeasured'
    violations?: readonly string[]
    reason?: string
  }
}

export function appliesTo(ctx: ShapeExecutionContext | undefined): boolean {
  if (ctx === undefined) return false
  if (!SHAPE_EXECUTION_EVENTS.includes(String(ctx.event))) return false
  /**
   * ★ 只在**声明了 dispatch** 的队上开口。`flat` 与**缺席**都不开口，且两者不同：
   *   前者是"我知道自己在用扁平形态"，后者是"这一格上线前的存量队，判不了"。
   *   ★ 但两者对本判据的**结论**相同（都不适用），所以它们**不需要**分叉 ——
   *     分叉发生在 `team.json` 的读取侧（`shapeExecutionOf`），不在闸门这里。
   */
  return ctx.team?.shape === 'dispatch'
}

export function gate(ctx: ShapeExecutionContext): GateVerdict {
  const injected = ctx?.shapeExecution
  /**
   * ★ 没注入 ⇒ **没能测量**。这一支是整条判据的要害：
   *   一个"读不到派工"却报 `ok` 的实现，会让所有队看起来都合规 ——
   *   而那正是本判据存在的理由被抹掉的形状。
   */
  if (injected === undefined) {
    return unmeasured(
      'the dispatch history of this team was not injected, so whether its members actually spawned temporary workers could not be decided',
    )
  }
  if (injected.status === 'unmeasured') {
    return unmeasured(
      `the dispatch history could not be read (${injected.reason ?? 'no reason given'}), so whether this dispatch team actually dispatched could not be decided`,
    )
  }
  /**
   * ★ `not-applicable` 在这里**不该出现**（闸门已经只放 dispatch 队进来）。
   *   ⇒ 若出现，说明调用方注入的读数与它交给闸门的 `team.shape` **不是同一份事实** ——
   *     那是一个接线矛盾，如实报成 `unmeasured`，**不**圆成 `ok`
   *     （"两份真相冲突"与"测量通过"不同形）。
   */
  if (injected.status === 'not-applicable') {
    return unmeasured(
      `the injected dispatch readout says this team is not a dispatch team, while the gate was reached as one (team.shape === 'dispatch'); two sources disagree about the same fact, so nothing can be concluded`,
    )
  }
  const violations = injected.violations ?? []
  /**
   * ★ `ok` 的额外字段就是**产出**（`registry.evaluate` 会把除 `ok` 以外的键
   *   收进 `outputs[gateId]`）。⇒ 违规名单靠产出读，不靠 `ok`。
   */
  return {
    ok: true,
    /**
     * ★ 三档计数：违规的 / 合规的（`evaluated` 里的 `checked`）。
     *   读的人要能回答"这条判据这一轮到底看了几个人" ——
     *   一个只说"0 条违规"的读数，与"一个成员都没看"同形。
     */
    shape_violations: [...violations],
    shape_violation_count: violations.length,
  }
}
