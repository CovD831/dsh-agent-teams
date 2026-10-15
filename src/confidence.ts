/**
 * ── F 线 · 数据飞轮的心脏：confidence ────────────────────────────────────────────
 *
 * 参照：腾讯 TeamAI 的 `docs/designs/git-native-memory.md`（外部材料，不在本仓）。
 * 飞轮形状：`write → index → search → vote → rank → better search`。
 *
 * ★★★ **心脏是两个分开的计数**，不是一个：
 *
 * | 计数 | 何时 +1 | 含义 |
 * |---|---|---|
 * | {@link UsageTally.recalled} | 检索**命中**它 | "它被**找到**过几次" |
 * | {@link UsageTally.upvoted} | ★ **采纳证据**（agent 真的**打开了**它） | "它被**用上**了几次" |
 *
 * ── ★★★ 为什么**不可合并**（这是整份设计最讲究的一处）──────────────────────────
 *
 *   · 只数 `recalled` ⇒ 一个**总被搜到、却从不被采纳**的条目**显得很热**；
 *   · 只数 `upvoted` ⇒ **丢掉了"曝光度"**这个信息；
 *   · **两个一起** ⇒ 才分得清「**没人搜它**」与「**搜到了但没人用**」。
 *
 * ⇒ 而这正是本仓记账最久的形态：**"没找到"与"确实没有"同形**。
 *   ★ 所以本模块**不提供**任何把它们加起来的函数 —— 合并本身就是要防的事，
 *     提供一个 `total()` 就等于把那个缺陷做成 API（见 {@link confidenceOf} 的注释：
 *     两个计数各自**分维度**参与，从不先求和）。
 *
 * ── ★★ 缺失 ≠ 0（腾讯原文逐字）────────────────────────────────────────────────
 *
 *   「**No missing metric is converted into a fabricated zero**」
 *
 * ⇒ 本模块里"没有这个读数"是一个**独立的一态**（`undefined`），**永不并进 0**。
 *   ★ 差别是实质的：`upvoted: undefined`（没人记过）与 `upvoted: 0`（记过，确实没人采纳）
 *     **补救动作相反** —— 前者要"去记"，后者要"去改这个条目"。
 *   合并它们＝把"还没测"读成"测出来是零"，而后者会**直接驱动归档**。
 */

/**
 * ── F1：一个条目的**使用读数** —— 两个计数**分开**，且各自可缺席 ──────────────────
 *
 * ★ 每一格都是 `number | undefined`，**不是** `number`：
 *   缺席是"没有这个读数"，与"读数是 0"**不同形**。见文件头「缺失 ≠ 0」。
 */
export interface UsageTally {
  /** 检索**命中**它的次数。缺席 ⇒ 没有这个读数（**不是 0**）。 */
  readonly recalled?: number
  /** ★ **采纳**它的次数（agent 真的打开了它）。缺席 ⇒ 没有这个读数（**不是 0**）。 */
  readonly upvoted?: number
  /**
   * 贡献者**名单**（不是计数）—— ★ 存名单而不是存数字，因为
   * 「≥2 contributors」这条晋升条件要的**恰恰是"是不是两个不同的人"**，
   * 而一个 `contributors: 3` 的计数**无法**回答"这 3 次是不是同一个人做的"
   * （那正是"一个偏方变成全队默认"的入口）。
   */
  readonly contributors?: readonly string[]
  /** 这个条目**第一次出现**的时间（ISO 串或 epoch ms）。缺席 ⇒ 年龄判不了。 */
  readonly firstSeenAt?: string | number
}

/** 把一个可能缺席的计数读成 `number | undefined` —— **绝不**`?? 0`。 */
function optionalCount(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

/** 把一个可能缺席的时间读成 epoch ms —— 读不出来 ⇒ `undefined`（不猜）。 */
function optionalEpoch(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * ── F1：**累积** —— 从事件到计数 ────────────────────────────────────────────────
 *
 * ★ 两个事件**各加各的**，且**永不互相推导**：
 *   · `recall` —— 检索命中 ⇒ `recalled + 1`（**不动** `upvoted`）；
 *   · `adopt`  —— 采纳证据（打开了它）⇒ `upvoted + 1`（**不动** `recalled`）。
 *
 * ★★ 为什么 `adopt` **不**顺带把 `recalled` 也 +1：那会把"曝光度"这条信息**污染** ——
 *   一个被采纳的条目**必然**先被搜到过，但**反过来不成立**；
 *   若 adopt 也增 recall，就再也分不出"搜到 100 次采纳 1 次"与"搜到 1 次采纳 1 次"。
 *   ⇒ 两条流水线**各自记账**，由调用方在它真正观察到那个事件时调用对应的那个函数。
 *
 * ★ 缺席的累加：`undefined + 1 = 1` —— 这是**第一次记账**，不是在补一个零。
 *   仍不满足"缺失 ≠ 0"的**是**另一种写法（`(tally.recalled ?? 0) + 1` 在**读取**时补零），
 *   那种写法会让"从没记过"与"记过 0 次"在**读出**时合流；本函数只在**写入方向**物化一个新值。
 */
export function tallyRecall(tally: UsageTally): UsageTally {
  const current = optionalCount(tally.recalled)
  return { ...tally, recalled: (current ?? 0) + 1 }
}

export function tallyAdopt(tally: UsageTally, contributor: string): UsageTally {
  const current = optionalCount(tally.upvoted)
  const people = tally.contributors === undefined ? [] : [...tally.contributors]
  if (!people.includes(contributor)) people.push(contributor)
  return { ...tally, upvoted: (current ?? 0) + 1, contributors: people }
}

/**
 * ── F1：confidence 的**读法** ───────────────────────────────────────────────────
 *
 * ★★ 腾讯原文**没有给出公式**，只给了两条阈值（0.90 / 0.15）与那个飞轮形状。
 *   ⇒ 我按**设计必须满足的性质**反推一个，并把性质写成断言（见 §自证）：
 *
 *   性质 1：**采纳率**驱动 —— `confidence ≈ upvoted / recalled`。
 *     ★ 这是整份设计的目的所在：「总被搜到而从不被采纳」必须**显得冷**。
 *     若用 `upvoted / total`（把两个计数先加起来），那个"总被搜到"的条目
 *     会因为分母里混进了自己的曝光量而**被推高** —— 那正是要防的形态。
 *   性质 2：**样本量不足时不许给高 confidence** —— 采纳 1 次/搜索 1 次
 *     的 100% 不该等于"晋升"。⇒ 用**小样本收缩**：把观测按 `k` 次往 0.5 拉，
 *     于是 1/1 与 50/50 的读数**不同形**（前者远低于后者）。
 *   性质 3：**任一侧决定性缺失** ⇒ 返回 `undefined`（**判不了**），**不是 0**。
 *
 * ★ 公式：`confidence = (upvoted + k/2) / (recalled + k)`，`k = 2`。
 *   · 1/1  ⇒ (1+1)/(1+2) = 0.667
 *   · 50/50 ⇒ (50+1)/(50+2) = 0.981  ← 同样的采纳率，样本量把它推过 0.90
 *   · 100/1 ⇒ (1+1)/(100+2) = 0.020  ← ★ "总被搜到而从不采纳" 确实显得冷
 *   · 0/0  ⇒ (0+1)/(0+2) = 0.5      ← 没有观测 ⇒ 中立，**不是 0 也不是 1**
 */
export function confidenceOf(tally: UsageTally, k = 2): number | undefined {
  const recalled = optionalCount(tally.recalled)
  const upvoted = optionalCount(tally.upvoted)
  /**
   * ★★★ 关键的一条：**任一侧缺席 ⇒ 判不了**（返回 `undefined`），**永不补 0**。
   *   ★ 为什么不能补：`recalled` 缺席而补 0 ⇒ 分母变 0 ⇒ 一个**从没被搜过**的条目
   *     会被算成 `(upvoted + 1)/2`，在 upvoted≥1 时**接近 1** ⇒ **直接晋升** ——
   *     而真相是"没人搜过它"。这正是"缺失填 0"最危险的落点。
   */
  if (recalled === undefined || upvoted === undefined) return undefined
  if (recalled < 0 || upvoted < 0) return undefined
  const smoothed = (upvoted + k / 2) / (recalled + k)
  /** ★ 采纳次数不可能超过命中次数；矛盾读数 ⇒ 判不了，不猜。 */
  if (upvoted > recalled) return undefined
  return smoothed
}

/**
 * ── F2：双阈值 —— **三态**，不是二值 ─────────────────────────────────────────────
 *
 * ★ 腾讯给的是**两个**阈值，从而把区间切成**三段**：
 *   `promote`（≥0.90）／**`observe`（0.15 ≤ c < 0.90，很宽）**／`archive`（<0.15）。
 *
 * ★★ 中间那一段**不是"待定"而是**一个正式的归宿** —— 与门禁注册表的
 *   `ok`/`blocked`/`unmeasured` 三态**同构**：`unmeasured` 不是"还没测出结果"的临时态，
 *   它是"我判不了"这个**结论本身**。同一个纪律：**别把"还没成熟"读成"不合格"**。
 */
export type FlywheelVerdict = 'promote' | 'observe' | 'archive' | 'unmeasured'

export const PROMOTE_THRESHOLD = 0.90
export const ARCHIVE_THRESHOLD = 0.15

export interface FlywheelReading {
  /** ★ 四态：`promote` / `observe` / `archive` / **`unmeasured`**（判不了）。 */
  readonly verdict: FlywheelVerdict
  /** `undefined` ⇒ 判不了（**不是 0**）。 */
  readonly confidence: number | undefined
  /** 逐条的**机械理由** —— 四条件里哪几条过、哪几条没过。 */
  readonly reasons: readonly string[]
  /** ★ 四条件的**逐条**读数（缺哪条一眼可见，而不是只给个 false）。 */
  readonly conditions: {
    readonly confidence: boolean | undefined
    readonly upvotes: boolean | undefined
    readonly contributors: boolean | undefined
    readonly age: boolean | undefined
  }
}

/**
 * ── F2：**四条件齐全**才晋升 ────────────────────────────────────────────────────
 *
 * 腾讯原文的四条件：
 *   `confidence ≥ 0.90` ∧ `≥5 upvotes` ∧ `≥2 contributors` ∧ `存在 ≥ 14 天`
 *
 * ★★★ 为什么**一条都不能少** —— 它们直接回答那条尖锐质疑：
 *   「**how do you stop one bad workaround from becoming the team's default
 *     after a few successful runs?**」
 *
 *   · **只有 confidence** ⇒ 一个人试了 5 次、成 5 次 ⇒ confidence 高 ⇒ **立刻全队默认**。
 *     而那 5 次可能全是**同一个人在同一台机器上**成功的。
 *   · **`≥2 contributors`** ⇒ 挡住"一个人的偏方"：必须**有第二个人独立地**用上它。
 *   · **`≥14 天`** ⇒ 挡住"几天内连续试了几次"：让结论**经得起时间**。
 *   ⇒ ★ 只抄 confidence 会**重犯**那个问题，所以四条件在代码里是 **AND**，不是打分。
 *
 * ★ 任一条件**读不出来** ⇒ 该条为 `undefined` ⇒ **不晋升**（`unmeasured`），
 *   而不是当作"通过"。见文件头「缺失 ≠ 0」。
 */
export interface PromotePolicy {
  readonly minConfidence: number
  readonly minUpvotes: number
  readonly minContributors: number
  readonly minAgeDays: number
}

export const DEFAULT_PROMOTE_POLICY: PromotePolicy = {
  minConfidence: PROMOTE_THRESHOLD,
  minUpvotes: 5,
  minContributors: 2,
  minAgeDays: 14,
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 读一条条目的飞轮裁决 —— ★ 双阈值 + 四条件，**缺失一律判不了**。
 *
 * @param tally 使用读数（两个计数分开、各自可缺席）
 * @param now 当前时间（epoch ms）—— 由调用方注入，便于夹具复现
 * @param policy 四条件阈值（默认 {@link DEFAULT_PROMOTE_POLICY}）
 */
export function readFlywheel(
  tally: UsageTally,
  now: number,
  policy: PromotePolicy = DEFAULT_PROMOTE_POLICY,
): FlywheelReading {
  const confidence = confidenceOf(tally)
  const upvoted = optionalCount(tally.upvoted)
  const people = tally.contributors
  const contributors = people === undefined ? undefined : new Set(people).size
  const firstSeen = optionalEpoch(tally.firstSeenAt)
  const ageDays = firstSeen === undefined ? undefined : (now - firstSeen) / DAY_MS

  const conditions = {
    confidence: confidence === undefined ? undefined : confidence >= policy.minConfidence,
    upvotes: upvoted === undefined ? undefined : upvoted >= policy.minUpvotes,
    contributors: contributors === undefined ? undefined : contributors >= policy.minContributors,
    age: ageDays === undefined ? undefined : ageDays >= policy.minAgeDays,
  }

  const reasons: string[] = []
  for (const [name, ok, detail] of [
    ['confidence', conditions.confidence, confidence === undefined ? '读不出来（缺 recalled 或 upvoted）' : confidence.toFixed(3)],
    ['upvotes', conditions.upvotes, upvoted === undefined ? '读不出来（缺 upvoted）' : String(upvoted)],
    ['contributors', conditions.contributors, contributors === undefined ? '读不出来（缺 contributors）' : String(contributors)],
    ['age', conditions.age, ageDays === undefined ? '读不出来（缺 firstSeenAt）' : `${ageDays.toFixed(1)} 天`],
  ] as const) {
    reasons.push(ok === undefined
      ? `★ ${name}：**判不了**（${detail}）—— 缺失不等于不满足，也不等于满足`
      : `${ok ? '✓' : '✗'} ${name}：${detail}`)
  }

  /**
   * ★ 归档是**单条件**（`confidence < 0.15`）—— 与晋升**不对称**，这是刻意的：
   *   晋升要求"经得起时间和多人"，归档只要求"它确实没用"。
   *   ★ 但 `confidence === undefined` ⇒ **既不能归档也不能晋升** ⇒ `unmeasured`：
   *     把"没有读数"读成"低分"会**直接归档**一个可能只是没人记过的条目。
   */
  if (confidence === undefined) {
    return { verdict: 'unmeasured', confidence, reasons, conditions }
  }
  /** ★ 任一条件读不出来 ⇒ 不晋升。**不许**把 `undefined` 当作"通过"。 */
  const allFourKnown = Object.values(conditions).every((v) => v !== undefined)
  if (allFourKnown && Object.values(conditions).every((v) => v === true)) {
    return { verdict: 'promote', confidence, reasons, conditions }
  }
  if (confidence < ARCHIVE_THRESHOLD) {
    return { verdict: 'archive', confidence, reasons, conditions }
  }
  /**
   * ★ 到了这里有两种情况，**它们不同形**：
   *   · 四条件**都读出来**了，但没全过 ⇒ `observe`（观察区，**正式归宿**）；
   *   · 有条件**读不出来** ⇒ 也落 `observe`，但 `reasons` 里那几条会写明"判不了"。
   *   ★ 之所以不把后者单列第五态：它的**动作与观察区相同**（都是"再等等、继续攒"），
   *     而把差异放在 `reasons` 里 —— 读的人能看到**具体缺哪一条**。
   */
  return { verdict: 'observe', confidence, reasons, conditions }
}

/**
 * ── ★★ reflect 层：**刻意不做** ────────────────────────────────────────────────
 *
 * 腾讯**自己推迟了**这一层，原文理由：「**needs 20+ learnings**」、
 * 「The knowledge base is **still cold-starting; not enough data**」。
 *
 * ★★ 而我们的处境**更该推迟**：我们有 **384 条卡点，但 confidence 是 0** ——
 *   即**"热"在数量上，不"热"在质量信号上**。
 *   ★ 本模块的全部产出都是**累积出来的行为读数**（recalled/upvoted/contributors/age），
 *     而它们**今天一条都还没有**。⇒ 在这一步之前去做 reflect，
 *     等于在**没有读数的库**上做"反思"，而那正是腾讯点名要避免的那个错。
 *
 * ★ 所以这里**没有** `reflect()`。等的条件是可判的：本模块的读数一旦**真的**攒起来
 *   （而不是我们去写一段把 0 当数据的代码），那一层才有输入。
 *   ★ 判据不是"我们觉得够了"，而是**库里真有条目进入 `promote`**。
 */
export const REFLECT_DEFERRED_REASON =
  '腾讯原文：needs 20+ learnings / the knowledge base is still cold-starting。'
  + '★ 我们的库有 384 条卡点但 confidence 全为 0 ⇒ 热在数量、冷在质量信号。'
  + '⇒ 在读数攒起来之前不做 reflect 层（做了就是在没读数的库上反思）。'
