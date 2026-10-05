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

import { blocked, unmeasured, type GateVerdict } from '../registry.ts'

export const id = 'runtime.liveness'
export const point = 'runtime'
export const description =
  '周期性探活：两次探活之间最后活动时刻没变 ⇒ 告警「卡死了」；还在活动 ⇒ 只报「还在跑，已 N 分钟」。永不因为等太久而说话（它是探活，不是硬超时），也不拒绝任务（契约 §5）'

/** 探活间隔（毫秒）。用户裁定 10 分钟 —— 5 分钟对长任务太频繁、日志会被刷屏。 */
export const DEFAULT_LIVENESS_INTERVAL_MS = 10 * 60_000

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
export function appliesTo(ctx: RuntimeLivenessContext | undefined): boolean {
  return ctx?.event === 'runtime-liveness'
}

export interface RuntimeLivenessContext {
  /** 六个调用点里 discriminator 之一；本判据只认 `runtime-liveness`。 */
  event?: string
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
    startedAt?: number
    /** 最近一次【观察到产出】的时刻（有 assistant/message 才算在动；status 抖动不算）。 */
    lastActivityAt?: number
    /** ★ 本次探活的时钟读数。判据自己不读表 —— 见文件头性质 ①。 */
    now?: number
    /** 探活间隔；非法或缺席 ⇒ 落到 `DEFAULT_LIVENESS_INTERVAL_MS`（绝不抛错）。 */
    intervalMs?: number
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
    previousPollAt?: number
    /**
     * ★ 上一次探活时读到的【最后活动时刻】—— 没有它，① 卡死那一半就不可判定。
     *
     * ★ 这条不是可选的装饰：`previousPollAt` 只回答"这是不是第二次"，不回答
     *   "上一次它在哪"。少了这个读数，每一次探活都只能走"第一次"那条路 ⇒
     *   判据**永远不报警**，而它读起来一切正常（`ok`、有 message、有 wait_ms）。
     *   这正是本队反复见过的"装了但从不生效"。
     */
    previousLastActivityAt?: number
  }
  /** 给产出用的标识（哪个任务/哪个成员在这次等待里）。缺省不影响裁决。 */
  task?: { id?: string; assignee?: string }
}

/**
 * ── ★ 间隔参数的解析：非法值【不加界】而不是抛错 ───────────────────────────────
 *
 * 源项目先例的原文理由（`with-timeout.mjs`）：
 *
 * > `ms` 非法时【不加界】而不是抛错 —— 一个因为参数没写对就炸的守卫，会在第一次
 * > 出问题时被关掉。
 *
 * ★ 而本判据里"不加界"的语义与源项目**不同形**，这是刻意的：源项目不加界 = 永远
 *   不超时（等待继续）；本判据不加界 = 探活永不触发（等待继续，且【没有人说话】）。
 *   两者都是"不打断"，而本判据本来就从不打断 —— 所以这一步只影响"多久问一次"。
 *
 * ★ 缺省方向是【能说的那一侧】：参数没写对 ≠ 判据失效。0 / NaN / 负数 / Infinity /
 *   `null` / 非数 一律落回 10 分钟，于是"间隔写错了"与"探活根本不发生"不同形。
 *
 * ★ 而【缺席】与【给了个坏值】不同形：缺席是正常（用缺省、不留痕迹），给了坏值
 *   要留下 `interval_ignored`（见 `gate` 的产出）。把两者合成一个标记，会让每一次
 *   正常运行都带着一句"参数被忽略" —— 而人就会学会忽略它。
 */
function resolveIntervalMs(value: unknown): { ms: number; why?: string } {
  if (value === undefined) return { ms: DEFAULT_LIVENESS_INTERVAL_MS }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return {
      ms: DEFAULT_LIVENESS_INTERVAL_MS,
      why: `the probe interval ${JSON.stringify(value)} is not a finite positive number; the wait stays unbounded (the probe never fires on its own) and the default interval of ${DEFAULT_LIVENESS_INTERVAL_MS} ms is used instead of throwing`,
    }
  }
  return { ms: value }
}

/** 一个可读的时长（探活是人读的告警，不是给机器的日志行）。 */
function minutes(ms: number): string {
  return String(Math.round(ms / 60_000))
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function gate(ctx: RuntimeLivenessContext): GateVerdict {
  const wait = ctx?.wait
  const who = ctx?.task?.assignee !== undefined && ctx.task.assignee !== ''
    ? `member "${ctx.task.assignee}"`
    : ctx?.task?.id !== undefined && ctx.task.id !== ''
      ? `task ${ctx.task.id}`
      : 'the waiting step'

  /**
   * ── ★ 缺省方向：拿不到观察 ⇒ `unmeasured`，**不是** `ok` ───────────────────────
   *
   * MEASURED 的教训（本轮反复出现）：一条判据在拿不到它需要的观察时返回 `ok`，
   * 就是"装上了但从不生效"——比没装更坏，因为它会让人以为探过了。
   *
   * 这里的三项各自都是不可推断的：
   *   · `now`           —— 判据不读表（性质 ①），没有注入的时钟就没有"现在"
   *   · `startedAt`     —— 没有等待起点就说不出"已等 N 分钟"（第 ③ 种探活的最小面）
   *   · `lastActivityAt`—— 没有活动读数就无法比较两端（第 ① 种探活的最小面）
   *
   * ★ 它们【不】合成一句话：缺哪一项决定了这次探活能不能做，而"缺时钟"与
   *   "缺活动观察"是两种不同的基础设施缺失。
   */
  if (wait === undefined || wait === null) {
    return unmeasured(
      `the liveness probe received no wait observation at all, so whether ${who} is still making progress could not be determined (this is not evidence that it is alive)`,
    )
  }
  const missing: string[] = []
  if (!finite(wait.now)) missing.push('the clock reading (wait.now)')
  if (!finite(wait.startedAt)) missing.push('the start of the wait (wait.startedAt)')
  if (!finite(wait.lastActivityAt)) missing.push('the last observed activity (wait.lastActivityAt)')
  if (missing.length > 0) {
    return unmeasured(
      `the liveness probe is missing ${missing.join(' / ')}, so whether ${who} is still making progress could not be determined `
      + '(an unobserved wait is not a healthy one — and this is not evidence that it is stuck either)',
    )
  }

  const now = wait.now as number
  const startedAt = wait.startedAt as number
  const lastActivityAt = wait.lastActivityAt as number
  const { ms: intervalMs, why: intervalWhy } = resolveIntervalMs(wait.intervalMs)

  /**
   * ── ★ 时钟回拨（`now < previousPollAt`）⇒ `unmeasured` ────────────────────────
   *
   * 一个往回走的时钟让「这 10 分钟里它动过没有」这个问题**无法回答**：
   * 时长是负的，而"负的时长里没有活动"既不是"卡死"也不是"健康"。
   *
   * ★ 两种都不能选，各自都有明确的坏处：
   *   · 读成"刚活动过"（`ok`）—— 把一次**没能测量**并进了「通过」，正是本判据
   *     存在的理由要防的那件事；
   *   · 读成"超时了"（`blocked`）—— 一次时钟抖动会变成一条**假警报**，
   *     而假警报会教人忽略这条判据（用户裁定的那条理由，逐字适用）。
   * ⇒ 唯一的诚实答案是 `unmeasured`，并说清是时钟的问题，不是成员的问题。
   *
   * ★ 顺序：这一条在"第一次探活"**之后**判（没有可比对象时，回拨本来就测不出来）。
   *   反过来写会让"第一次探活 + 时钟回拨"落进 `unmeasured`，而第一次探活本来
   *   就没有"两个读数不可比"这件事 —— 它只有一端。
   */
  const hasPreviousProbe = finite(wait.previousPollAt)
  if (hasPreviousProbe && now < (wait.previousPollAt as number)) {
    return unmeasured(
      `the clock went backwards between the last liveness probe and this one for ${who} `
      + `(previous probe at ${wait.previousPollAt}, now ${now}); 'did anything happen in the last interval' cannot be answered from a negative interval `
      + '— this is a clock problem, not evidence that the member is stuck',
    )
  }

  const elapsed = now - startedAt
  /**
   * ── ★ 「第一次探活」= 【没有任何上一次记录】，由字段缺席判定 ───────────────────
   *
   * 唯一的判据是 `previousPollAt` 在不在（t5 的约定）。**不是**计数值、也**不是**
   * "上一次的活动读数在不在"：后者只在观察面读不到时才缺席，把它当成"第一次"
   * 会让一次读不到的观察被读成"这是第一次探活"，而不是"这一次没能比较"。
   *
   * ★ 而"第二次但缺活动读数"是**可判定的未测量**（t5 的两种情形：还没观察到任何
   *   产出 / 会话读不到）—— 它不是"第一次"，两者在诊断上不同形，在这里也不同形。
   */
  const previousActivityAt = wait.previousLastActivityAt
  const hasPreviousActivity = finite(previousActivityAt)

  /** 无论哪条路径都交出去的证据（判据的产物是【告警 + 证据】，契约 §5）。 */
  const evidence: Record<string, unknown> = {
    wait_ms: elapsed,
    startedAt,
    lastActivityAt,
    interval_ms: intervalMs,
    /**
     * ★ 上一次读到的活动时刻 —— 读不到就交 `null`，**不交 `undefined`**：
     *   `undefined` 在 JSON 里会整个字段消失，于是"我没有上一次的读数"与
     *   "这条判据不产出这个字段"同形。判据的产物要能被直接读。
     */
    previous_last_activity_at: hasPreviousActivity ? previousActivityAt : null,
    /**
     * ★ 这一次的活动对上一次是否有推进：
     *   `true` / `false` 是**测量结论**（比过了）；`null` 是**没能比较**
     *   （第一次探活，或这一次根本没拿到上一次的活动读数）。
     *   把 `null` 写成 `false` 会让"还没比过"读起来像"确认它没动" —— 那是假报警。
     */
    updated_since_previous_probe: hasPreviousActivity ? previousActivityAt !== lastActivityAt : null,
  }
  if (intervalWhy !== undefined) evidence['interval_ignored'] = intervalWhy

  /**
   * ── ① 第一次探活：没有可比对象 ⇒ 只报「还在跑，已 N 分钟」─────────────────────
   *
   * ★ 「没有上一次」既不是"健康"也不是"卡死"。卡死是一个【比较】的结论，比较需要
   *   两端；只有一端时唯一诚实的话是"它在跑、等了多久"。这里给 `ok`（它是探活的
   *   常规状态，不是"没测到"），但同时交出 `first_probe: true`，好让读日志的人
   *   分得出"第一次探活"与"第二次探活、确认它还在动"—— ★ 两者必须不同形，
   *   否则"我等了 10 分钟还没看过它"会读起来像"我确认过它还活着"。
   */
  if (!hasPreviousProbe) {
    return {
      ok: true,
      ...evidence,
      first_probe: true,
      alive: null,
      stuck: null,
      message: `${who} is still running: ${minutes(elapsed)} minute(s) of the ${minutes(intervalMs)}-minute probe interval have elapsed `
        + '(first probe — there is nothing to compare against yet, so this is not a health judgement)',
    }
  }

  /**
   * ── ★ 第二次探活、却拿不到上一次的活动读数 ⇒ `unmeasured`，不是"它还在跑" ──────
   *
   * t5 的两种情形都在这里落地：**还没观察到任何产出**（派发过、一条非空
   * `assistant/message` 都没有）与**读不到该成员的会话**（没有 live Agent / 成员
   * 从未 spawn）。两者在诊断上不同形，但在这个格子里是同一件事：没有可比的那一端。
   *
   * ★ 绝不能读成 `ok`（"它还在跑"）：那正是把「没能测量」并进「通过」的形态 ——
   *   而且是最难发现的一种，因为报告读起来完全正常（有 message、有 wait_ms）。
   */
  if (!hasPreviousActivity) {
    return unmeasured(
      `this is the second liveness probe for ${who} but the last activity reading of the previous probe is missing `
      + '(the session was unreadable, or no output had been observed yet), so whether it has moved since then could not be determined '
      + '— an uncomparable probe is not a healthy member',
    )
  }

  const moved = (previousActivityAt as number) > lastActivityAt
  const stuck = previousActivityAt === lastActivityAt

  /**
   * ── ①【卡死了】两次探活、最后活动时刻没变 ⇒ `blocked`（作为【告警】）───────────
   *
   * 这是机器可判的确定性事实：真的没动就是没动。它【不】读 status、不读输出长度、
   * 不猜"它是不是在想"—— 那些都只在"没进展"那一种里才有位置，而那一种被明确砍掉了。
   *
   * ★ 措辞必须让人知道「这不会打断任何东西」：读到这条告警的人要去**看一眼**，
   *   而不是等任务被掐掉（本判据没有掐的能力，这是契约 §5 的设计）。
   */
  if (stuck) {
    return blocked(
      `${who} has been waiting ${minutes(elapsed)} minute(s) and its last observed activity has not moved for a full ${minutes(intervalMs)}-minute probe interval `
      + `(last activity ${lastActivityAt} at both probes) — this is a liveness alarm, not a rejection: the task is not cancelled and nothing is unwound; `
      + 'check what it is waiting on',
      ...(intervalWhy === undefined ? [] : [intervalWhy]),
    )
  }

  /**
   * ── ③【定期告知】还在活动 ⇒ `ok` + 一份可读的产出 ──────────────────────────────
   *
   * 这个分支**不判断健康**，它只让等待【有话说】：源项目的缺口原话正是
   * 「没有任何一句话说它在等什么」。
   *
   * ★ 它【不】产出第三态（例如 `verdict: 'still-running'`）：`GateVerdict` 的三态是
   *   `ok / blocked / unmeasured`，多一态在 `assertVerdict` 那层是**抛错**，不是通过。
   *   "还在跑"这件事由 `alive: true` + `message` 表达，它就是 `ok`。
   *
   * ★ 时钟单调性：同一次等待里 `lastActivityAt` 只增不减。所以出现
   *   `previousActivity > lastActivityAt`（"上一次探查到的是更晚的时刻"）说明
   *   观察面自己不自洽（换了任务 / 缓存被清 / 时钟抖动），而不是"它动了"。
   *   ⇒ 照常报"还在跑"，但把这一事实写进证据里 —— **绝不当成卡死**（那是假警报），
   *     也绝不当成"动过"（那是把没测到并进通过）。
   */
  return {
    ok: true,
    ...evidence,
    first_probe: false,
    alive: true,
    stuck: false,
    ...moved ? { observation_inconsistent: `the last observed activity moved backwards (${previousActivityAt} -> ${lastActivityAt}); the wait observation is not self-consistent, so this probe reports "still running" rather than a health judgement` } : {},
    message: `${who} is still running: ${minutes(elapsed)} minute(s) elapsed and its observed activity moved within the last ${minutes(intervalMs)}-minute probe interval`,
  }
}
