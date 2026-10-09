/**
 * ── ★★★ `scripts/friction-triage.mjs` 的**最小类型面**（t26）─────────────────────────
 *
 * ── 为什么需要这个文件（而不是 `@ts-expect-error`）──────────────────────────────
 *
 * `scripts/` 在 `tsconfig.json` 的 `rootDir = "src"` **之外**，且这个 `.mjs` 没有
 * 类型声明 ⇒ 任何 `src/` 侧对它的引用都会落 `TS2307`。
 *
 * ★ 而本任务的裁定（captain，A1）选了**补一个最小声明**，理由值得写下来：
 *
 *     `@ts-expect-error` 会让「**这个模块不存在**」与「**这个模块存在而类型不对**」
 *     读成同一件事 —— 而那正是本仓那条最贵纪律的同形
 *     （「没能测量」不得读成「测得了零」）。
 *
 *   ⇒ 补声明之后，上面那两种情形**不同形**：
 *     · 模块真的不在 ⇒ 动态 `import` 在**运行时**抛（一条可读的读数）；
 *     · 模块在而导出改名 ⇒ 这里的声明与它**对不上**，而 `tsc`/臂会当场说清是哪一格。
 *
 * ── 口径：只声明**实际用到的那几个**导出 ─────────────────────────────────────────
 *
 * ★ 不是把 39 个导出全抄一遍。抄一遍会造出**第二份真值**，而它会在
 *   `friction-triage.mjs` 演进时静默过期 —— 那时本文件就成了一处**假的**接口描述。
 * ⇒ 只声明调用方真正读的那几格，且**形状取窄**（读不到就说"读不到"）。
 *
 * ★ 而"它仍然对得上"这件事由 `scripts/gate-experience-dispatch.test.mjs` 的
 *   一条臂盯着（它会在运行时核这几个导出真的存在且是函数）。
 */

/** `dispatchable` 里的一条**可派**提案：它带着完整契约与派工理由。 */
export interface DispatchableReadyEntry {
  /** 来源（卡点 / 判决的 id）。 */
  readonly proposal?: { readonly sourceId?: string }
  readonly tier?: { readonly tier?: string }
  /**
   * ★ 审查过的契约 —— **直接挂在条目上**（实测形状，见 t26；不是嵌在 `emitted` 里）。
   *   `ready` 池里它只可能是 `emitReviewedContract` 给的（主干有一条结构性断言盯着）。
   */
  readonly contract?: Record<string, unknown>
}

/**
 * ── ★★★ 四态（而它们**不许合并**）────────────────────────────────────────────────
 *
 * 契约逐字：「只派【小档 + 审查通过 + 契约完整】的那一类：大档进 `awaitingRuling`、
 * 审不过进 `rejected`、契约不全进 `cannotEmit` —— ★ 四态不许合并」。
 *
 * ★ `awaitingRuling` **是一个队列，不是一个错误**（用户原话：「大货是不应该直接派的。
 *   需要我裁决的就留下来」）⇒ 它的长度是一条**该被测量的读数**。
 */
export interface DispatchableResult {
  readonly ready: readonly DispatchableReadyEntry[]
  readonly awaitingRuling: readonly unknown[]
  readonly rejected: readonly unknown[]
  readonly cannotEmit: readonly unknown[]
  readonly decomposed: readonly unknown[]
  readonly blockedCount?: number
  readonly notReadyBecause?: Record<string, number>
}

/** `triage({ frictionsDir, judgementsDir, occupied })` 的返回 —— 只声明调用方读的那几格。 */
export interface TriageReport {
  /** ★ 读不到的那几侧（**空数组**才是"都读到了"）。 */
  readonly unreadable?: readonly string[]
  readonly counts?: Record<string, number>
  readonly toDispatch?: readonly unknown[]
  readonly blocked?: readonly unknown[]
}

export function triage(options?: {
  readonly frictionsDir?: string
  readonly judgementsDir?: string
  readonly occupied?: readonly unknown[]
}): TriageReport

export function dispatchable(report: TriageReport, options?: Record<string, unknown>): DispatchableResult
