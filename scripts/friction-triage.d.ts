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

/**
 * ── ★★★ t60（N4）：判据 id 的三态读数 —— 契约 §5 **N-a** 的落点 ──────────────────────
 *
 * 契约 N-a 逐字：「`auto.gates[]` 是 N4 要消费的新字段 ⇒ N4 的接口面**必须先声明它**；
 * 否则 N4 的读数**静默变空**，而**「字段没了」与「卡点本来就没有」同形**。」
 *
 * ⇒ 这里就是"先声明它"那一半：`from` **必填**，于是"我读到的是全量吗"
 *   在**类型层**就答得出来（不必去读 `why` 里那句话猜）。
 *
 *     'gates' ⇒ 权威全量（`auto.gates[]` 在场）
 *     'gate'  ⇒ ★ **回退**：只有标量 `gate`（= 首位，非首位判据**丢了**）
 *     'none'  ⇒ 两种都没有 —— 这条记录**没记到判据**
 *
 * ★ 三态**不许合并**：把 `'gate'` 与 `'gates'` 合成一个 `string[]`，会让
 *   "我只有首位、可能还漏了别的" 与 "这就是全部" **同形** —— 那正是 N-a 要防的。
 */
export interface FrictionAutoGateRead {
  /** 读到的判据 id（**保序**；`from === 'gates'` 时是权威全量）。 */
  readonly ids: readonly string[]
  /** ★ 这份 id 是从哪读来的（必填 —— 见上）。 */
  readonly from: 'gates' | 'gate' | 'none'
}

/** 把一条 `auto` 读成三态（★ 只读；不改记录、不写盘）。 */
export function readGateIds(origin: unknown): FrictionAutoGateRead

/**
 * `actionForFriction(record)` 的返回。
 *
 * ★ `gates` / `gatesFrom` **只在 `action === 'auto-recorded'` 时在场** ——
 *   它们是那条读数的产物，别的分支没有判据可报。
 * ★ 而 `gates` 与记录里的标量 `gate` **不是同一格**：`gate` 是兼容标量（契约 N-c，
 *   `noteStall` 的标量相等依赖它），`gates` 是**权威全量**。
 */
export interface FrictionAction {
  readonly action: string
  readonly why: string
  /** 全量被拒判据（保序）。 */
  readonly gates?: readonly string[]
  /** ★ 那份 `gates` 的来源（三态之一）。 */
  readonly gatesFrom?: 'gates' | 'gate' | 'none'
  /** 走标题前缀回退时在场。 */
  readonly via?: string
}

export function actionForFriction(record: unknown): FrictionAction
