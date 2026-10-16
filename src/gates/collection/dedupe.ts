/**
 * ── `collection.dedupe` ——— 这条信号与窗口内已有的**是不是同一件事**（t86）──────────
 *
 * ── ★★★ 它防的是本仓**实测过**的那个形状（不是设想）──────────────────────────────
 *
 * MEASURED（372 条台账，2026-10-16）：
 * ```
 * 唯一 (component, kind) 对 = 54
 * ★ 前两条就占 85.5%:
 *     dispatch   · unwired   161 条 · 2026-10-07 → 10-14
 *     completion · unwired   157 条 · 2026-10-07 → 10-10
 * ⇒ ★★ 同一个 unwired 在 dispatch 上重复了 161 次、持续 8 天，
 *    而【没有任何机制发现这件事】。
 * ```
 *
 * ⇒ ★ **本层要防的第一件事不是"采错的"，而是"采重复的"**。
 *   而本判据就是那个机制：**同样的三段已经见过 ⇒ 不采，只加计数。**
 *
 * ── ★★ 为什么"只加计数"而不是"什么都不做" ────────────────────────────────────
 *
 * 若有重复就**静默丢掉**，那么"这条发生了 161 次"这件事**读不出来** ——
 * 而 161 与 1 的区别**恰恰是唯一值得知道的信息**（它说明这个缺陷**一直在发生**）。
 * ⇒ 所以裁决是 `blocked`（不采），而**计数**由索引那一侧加 ——
 *   而那个计数就是 `CollectionHealth.redundancy` 的分子分母原料。
 *
 * ── ★ 纯函数：本文件不 import 任何 I/O ────────────────────────────────────────
 *
 * "窗口内已有的信号"是**调用方注入**的一份快照（见 `shared.ts` 的长注释）。
 */

import { blocked, ok, unmeasured, type GateVerdict } from '../registry.ts'
import { dedupeKeyOf, type CollectionContext } from './shared.ts'

export const id = 'collection.dedupe'
export const point = 'collection'
export const description =
  '这条信号与窗口内已有的**是不是同一件事**（同 kind + component + message）——是 ⇒ 不采，只加计数；判不了 ⇒ unmeasured'

export const requires = ['candidate', 'index'] as const

/**
 * ★ 单条求值：输入 = 一条候选 + 已有索引，输出 = 三态。
 *
 * 三态各自的含义（★ 这三行是本次实现的口径，别处不许另立）：
 * ```
 * ok         ⇒ 没见过 ⇒ 采
 * blocked    ⇒ ★ 见过 ⇒ 不采（但计数要加 —— 见文件头）
 * unmeasured ⇒ 判不了（候选或缺席，或缺索引）
 * ```
 */
export function evaluateCollectionDedupe(context: CollectionContext): GateVerdict {
  const { candidate, index } = context
  /**
   * ★ 缺输入 ⇒ `unmeasured`，**不是** `ok`。
   *   理由与全仓一致："没测到"不许并进"测出来了没问题" ——
   *   而在这里尤其致命：缺索引时判 `ok` 会把**每一条**都放行，
   *   于是去重**静默失效**，而读数上看起来一切正常。
   */
  if (candidate === undefined) {
    return unmeasured('collection.dedupe: no candidate was supplied; whether this signal is a duplicate cannot be decided')
  }
  if (index === undefined) {
    return unmeasured('collection.dedupe: no index was supplied; without the window of already-collected signals a duplicate cannot be told from a first sighting')
  }
  const key = dedupeKeyOf(candidate)
  if (index.seen.has(key)) {
    /**
     * ★★ **本层要拦的那一格**：同三段已见过。
     *   ★ 报错信息里带上**它已经出现过几次** —— "又来了"与"来了第 161 次"
     *     读起来必须是两件事（那是 redundancy 那个读数的由来）。
     */
    const prior = index.counts.get(key) ?? 1
    return blocked(
      `collection.dedupe: this signal is the same as one already collected `
      + `(kind=[${[...candidate.kind].sort().join(', ')}] component=${candidate.component ?? '(none)'} `
      + `message=${JSON.stringify(candidate.message)}); seen ${prior} time(s) before — `
      + `refused, and the existing count is incremented instead`,
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
  return evaluateCollectionDedupe(context)
}
