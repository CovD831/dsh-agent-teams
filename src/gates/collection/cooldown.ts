/**
 * ── `collection.cooldown` ——— 这个来源**是不是刚说过话**（t86）──────────────────────
 *
 * 依据：`docs/COLLECTION-POINT-AND-EVALUATORS.md` §1.2 行 2
 *   「同一来源 N 分钟内 ⇒ ★ 不采（MemOS 的 `cooldownMs`）」
 *
 * ── ★ 它与 `dedupe` **问的不是同一个问题**（这一点决定了两条都必须在）──────────
 *
 * ```
 * dedupe    —— 「这条**内容**是不是已经有过？」     （按 内容 判）
 * cooldown  —— 「这个**来源**是不是刚说过话？」     （按 来源+时间 判）
 * ```
 * ★ 两者的失败**不同形**，所以不许合并：
 *   · 只留 `dedupe` ⇒ 一个来源在 10 秒内报了 **5 条不同**的缺陷，5 条全采
 *     （它们是不同的内容 ⇒ dedupe 放行）—— 而那时**还没有人来得及处理第一条**；
 *   · 只留 `cooldown` ⇒ 同一个缺陷隔天又来一次，冷却窗早过了 ⇒ 照采
 *     （而那正是 161 次那个形状）。
 * ⇒ ★★ 两条**互补**，不是重复。
 *
 * ── ★ 为什么"来源缺席"是 `unmeasured` 而不是 `ok` ──────────────────────────────
 *
 * 说不出这条信号**来自谁**时，"它是不是刚说过话"**根本无从谈起**。
 * ★ 若判 `ok`，那么"没有来源信息"与"来源很勤"会走向**同一个结局（都采）** ——
 *   而它们是两件事：前者是**归因缺口**（要么补来源，要么承认抓不到），
 *   后者是**真的发生了太多次**。
 */

import { blocked, ok, unmeasured, type GateVerdict } from '../registry.ts'
import { COOLDOWN_MS, type CollectionContext } from './shared.ts'

export const id = 'collection.cooldown'
export const point = 'collection'
export const description =
  '这个来源**是不是刚说过话**（同一来源 N 分钟内）——是 ⇒ 不采；说不出它来自谁 ⇒ unmeasured'

export const requires = ['candidate', 'index'] as const

/** ★ 窗口长度在 `shared.ts`（与 `dedupe` 共用同一份形状，避免两处各写一个数）。 */
export { COOLDOWN_MS }

export function evaluateCollectionCooldown(context: CollectionContext): GateVerdict {
  const { candidate, index } = context
  if (candidate === undefined) {
    return unmeasured('collection.cooldown: no candidate was supplied')
  }
  if (index === undefined) {
    return unmeasured('collection.cooldown: no index was supplied; without the per-source last-seen times a cooldown cannot be measured')
  }
  /**
   * ★★ 来源缺席 ⇒ `unmeasured`：**说不出它来自谁**，就意味着这一格测不了。
   *   它**不是** `ok` —— 见文件头那两段。
   */
  if (candidate.source === undefined || candidate.source === '') {
    return unmeasured(
      'collection.cooldown: this signal carries no source, so whether that source has just spoken cannot be decided '
      + '(a missing source is an attribution gap, not a quiet source)',
    )
  }
  const last = index.lastBySource.get(candidate.source)
  /** ★ 这个来源**从没说过话** ⇒ 冷却窗无从谈起 ⇒ 放行（第一次说话总是该被听到）。 */
  if (last === undefined) return ok()
  /**
   * ★ 时钟倒流（候选的 `at` 早于上一次）：**判不了**，不是"没超时"。
   *   ★ 实测依据：本仓的台账里时间是可被注入的（夹具会伪造 `at`），
   *     而"倒流"与"刚说过"若都判 `blocked`，两种完全不同的事实会合流。
   */
  if (candidate.at < last) {
    return unmeasured(
      `collection.cooldown: the candidate is stamped ${candidate.at} but source "${candidate.source}" was last seen at ${last} — `
      + 'the clock went backwards, so elapsed time cannot be measured',
    )
  }
  const elapsed = candidate.at - last
  if (elapsed < COOLDOWN_MS) {
    return blocked(
      `collection.cooldown: source "${candidate.source}" spoke ${Math.round(elapsed / 1000)}s ago `
      + `(cooldown is ${Math.round(COOLDOWN_MS / 1000)}s) — refused; too soon after the previous signal from the same source`,
    )
  }
  return ok()
}

/** 注册表要的入口。 */
/**
 * ── ★ 何时适用：**有候选信号**时才跑 ─────────────────────────────────────────────
 *
 * ★ 与既有 17 条判据同一条纪律（`gate-index-assembly` 臂 2 逐字要求
 *   `hasAppliesTo === true`）：判据必须**按 kind 收窄**，否则它落进
 *   "对全部 kind 生效"那条**静默路径** —— 而那条路径下"不适用"与"跑了且没事"同形。
 *
 * ★ 而**缺输入不算不适用**：`candidate` 缺席 ⇒ 本判据仍进裁决，
 *   由 `gate()` 返回 `unmeasured`（见该函数）。"没测到"与"不适用"必须分开。
 */
export function appliesTo(context: CollectionContext | undefined): boolean {
  return context?.candidate !== undefined
}

export function gate(context: CollectionContext): GateVerdict {
  return evaluateCollectionCooldown(context)
}
