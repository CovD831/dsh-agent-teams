/**
 * ── 采集层的**共用输入形状**（t86）────────────────────────────────────────────────
 *
 * ★ 为什么这四条判据要有一份共用形状：它们的输入**是同一件事的四个不同问法** ——
 *   "这条信号该不该进库"。若各写各的 ctx，那么"它们看的是不是同一条信号"
 *   就没有任何地方能保证，而四条判据一旦看的不是同一件事，
 *   它们的裁决**合起来就没有意义**（一条说"重复"、另一条说"来源太勤"，
 *   而两条说的可能根本不是同一条信号）。
 *
 * ── ★★ 纯函数级：本目录**不 import 任何 I/O** ─────────────────────────────────
 *
 * 与 `src/gates/admission/*` 同一条纪律：判据不做 I/O，**已有索引由调用方注入**。
 * 理由在本仓被记过不止一次，最贵的一条是：
 *   「一个判据若自己去读文件，它就有了 I/O；更坏的是，
 *     **'当时读到的内容'与'现在的样子'会由同一次读产生** ⇒ 两者恒等 ⇒ 判据恒真。」
 * ⇒ 所以"窗口内已有的信号"必须是**交进来的**一个快照，不是判据自己去查的东西。
 *
 * ── ★ 三态在采集层的**具体含义**（这是本层与别处最不一样的地方）──────────────
 *
 * 前六个位置的 `blocked` 说的是"这件事不许做"。而采集层的 `blocked`
 * 说的是"**这条信号不采**" —— 那**不是错误**，是**正常结局**：
 *
 *     ok         ⇒ 采（这条信号有价值，进库）
 *     blocked    ⇒ ★ **不采**（重复 / 太勤 / 已知噪声）—— 但**要加计数**，
 *                  否则"我们拒了多少"这件事没人读得到
 *     unmeasured ⇒ ★ **判不了该不该采**（例如落不到任何 component）
 *                  ⇒ 既不采、也不假装"采了没问题"
 *
 * ★★ 为什么"落不到 component"必须是 `unmeasured` 而**不是** `blocked`：
 *   两者补救动作相反 —— `blocked` 是"这条不该采"（下游啥也不做），
 *   `unmeasured` 是"**我说不出它是什么**"（要么改信号，要么补归因）。
 *   把后者写成前者，会让"归因机制有缺口"与"这条信号没价值"**同形**。
 */

import type { GateVerdict } from '../registry.ts'

/**
 * 一条**待判**的采集信号。
 *
 * ★ 它是"一条候选记录"，不是"一条已入库的记录" —— 判据要回答的正是
 *   "它该不该变成后者"。
 */
export interface CollectionCandidate {
  /** 信号类别（如 `unwired` / `misclassified`）。★ 参与去重键。 */
  readonly kind: readonly string[]
  /**
   * 它归属的组件（如 `dispatch` / `completion.r5`）。
   * ★ **缺席即"落不到 component"** —— 那是 `collection.attributable` 那一格要判的；
   *   刻意**不用空串冒充缺席**（"没有"与"有但是空的"是两件事）。
   */
  readonly component?: string
  /** 判据说出来的原话。★ 参与去重键 —— 它是"同一件事"的第三段。 */
  readonly message: string
  /**
   * 这条信号来自**谁**（成员 / 工具 / 会话）。`collection.cooldown` 按它计窗口。
   * ★ 缺席 ⇒ cooldown **判不了**（不是"刚说过"）—— 见该判据的注释。
   */
  readonly source?: string
  /** 这条信号被观察到的那一刻（毫秒）。★ 窗口计算全靠它，判据自己不取时。 */
  readonly at: number
}

/**
 * 窗口内**已有**的索引 —— ★ **由调用方注入**（判据不查库）。
 *
 * ★ 三份而不是一份，因为三条判据问的是三个不同的问题：
 *   · `seen`      —— 去重键集合（`kind|component|message`）
 *   · `lastBySource` —— 每个来源**上一次**被采的时刻
 *   · `counts`    —— 去重键 → 已有的重复次数（用于"只加计数"）
 */
export interface CollectionIndex {
  /** 已采过的**去重键**（`dedupeKeyOf` 算出来的那种字符串）。 */
  readonly seen: ReadonlySet<string>
  /** 每个来源**上一次被采**的时刻（毫秒）。缺席 = 这个来源没说过话。 */
  readonly lastBySource: ReadonlyMap<string, number>
  /** 去重键 → 它已经出现过几次（**含**已被拒的那些）。 */
  readonly counts: ReadonlyMap<string, number>
}

/** 四条的共用 ctx —— 调用方注入形如 `{ candidate, index }`。 */
export interface CollectionContext {
  readonly candidate?: CollectionCandidate
  readonly index?: CollectionIndex
}

/**
 * ── ★★ 去重键：`kind` + `component` + `message` 三段 ────────────────────────────
 *
 * ★ 与契约逐字一致（`docs/COLLECTION-POINT-AND-EVALUATORS.md` §1.2 的行 1）：
 *   「同一 `(kind, component, message)` 已存在 ⇒ ★ 只加计数」。
 *
 * ★★ **三段缺一不可**，而每一段缺了会漏掉一整类重复：
 *   · 去掉 `kind`      ⇒ `dispatch·unwired` 与 `dispatch·<别的>` 会被当成同一条；
 *   · 去掉 `component` ⇒ ★★ **这正是本仓那 161 次重复会消失的地方** ——
 *     同一条 `unwired` 文案挂在不同 component 上，是**两件事**，不是重复；
 *   · 去掉 `message`   ⇒ 同一个组件的两条**不同**缺陷会被合并成一条（**少采**）。
 *
 * ★ `kind` 是数组（一条信号可以属于多个类别）⇒ **先排序再 join**：
 *   否则 `['a','b']` 与 `['b','a']` 会算出两个不同的键，
 *   于是**同一条信号被采两次** —— 而那正是本层要防的东西。
 */
export function dedupeKeyOf(candidate: Pick<CollectionCandidate, 'kind' | 'component' | 'message'>): string {
  const kinds = [...candidate.kind].sort().join(',')
  return `${kinds}|${candidate.component ?? ''}|${candidate.message}`
}

/**
 * ── ★★★ N1.2：信号「来源」的**唯一**口径 —— 写端与索引端都调这一个函数 ────────────
 *
 * ── 它修的是什么（MEASURED，本任务的第二处焊点）────────────────────────────────
 *
 *   `collection.cooldown` 的 `requires = ['candidate', 'index']`，而它还要读
 *   `candidate.source` —— **三个调用点一个都没传 `source`** ⇒ 即使把 `index` 接上，
 *   它仍然答 `unmeasured`（"this signal carries no source"）。
 *   ★★ 也就是说：只接 `index` 会让 `unmeasured` 从 **34 变成 34**，
 *     而原因从"没有索引"换成"没有来源" —— 读数不变，**看起来像修了**。
 *     这正是本任务要防的那个形态（一个数没动，而它的解释换了）。
 *
 * ── ★★★ 为什么必须是【一个函数】，而不是两端各拼一次 ──────────────────────────
 *
 *   索引那一侧（`deriveCollectionIndex`）要从**盘上已有的行**重建 `lastBySource`；
 *   写那一侧要算出 `candidate.source` 去查它。
 *   ★ 若两处各拼一次字符串，它们会在某一天分叉 ——
 *     而分叉的表现是**冷却窗永远不命中**（每一行都被读成"新的来源"⇒ 恒 ok）。
 *     那与"cooldown 没接上"在读数上**同形**，于是没人会发现。
 *
 * ── ★ 为什么**只取 `where`**（粗粒度）—— 这是计划 §2.1 明写「必须由 N1 定下来」的那一格 ──
 *
 *   `docs/SELF-ITERATION-PLAN.md` §2.1 把两个选项与各自的收益靶都算出来了：
 *     传 `where`（粗）              ⇒ 冷却 5 分钟窗会挡 **15** 条（当前语料复算 **18**）
 *     传 `where + gateId`（细）     ⇒ 只挡 **13** 条（当前语料复算 **16**）
 *   ★ 这里选**粗**的那一个，理由不是"数大好看"，而是两条：
 *     ① 粗 == `scripts/evolution-readout.mjs` 打印的 **`wouldBlock` 第一行**（key=where）。
 *        两者同一个口径 ⇒ **读数脚本能真的核对生产实现**，而不是拿两把尺子比。
 *        细口径那一行也照印，作对照。
 *     ② ★ 粒度越细，拦得越少。而本任务要防的**反面**正是"cooldown 装上了却永不拦"
 *        （`wouldBlock` = 0 与整列 `unmeasured` 是**同一种静默**，只是换了个说法）。
 *        ⇒ 在"可能多拦"与"可能永不拦"之间，取多拦那一边，并由读数把代价印出来。
 *
 *   ★ `gateId` / `tool` 仍在**参数形状**里（不是死代码）：台账 `source` 对象本来就有它们，
 *     这个函数是"从台账那一格算键"的唯一入口；将来若要改细口径，只改这一处。
 *     现在它们在**注释里明写被刻意排除**，而不是被悄悄忘掉。
 */
export function sourceKeyOf(source: {
  readonly where: string
  readonly gateId?: string
  readonly tool?: string
}): string {
  return source.where
}

/**
 * `cooldown` 的窗口长度（毫秒）。
 *
 * ★ 依据 `docs/COLLECTION-POINT-AND-EVALUATORS.md` §1.2 行 2：「同一来源 N 分钟内 ⇒ 不采」
 *   （MemOS 的 `cooldownMs` 那一节）。
 * ★ **5 分钟**：它要挡的是"同一个来源在**同一次对话/同一轮**里反复报告",
 *   而不是"这个来源以后不许再报告" —— 后者是去重键的活。
 *   ★ 窗口取太长会把"隔天又发生一次"也吞掉，而那正是**该采**的（时间跨度是信息）。
 */
export const COOLDOWN_MS = 5 * 60 * 1000

/** 一个判据的裁决 —— 直接复用注册表的三态（不新造形状）。 */
export type CollectionVerdict = GateVerdict
