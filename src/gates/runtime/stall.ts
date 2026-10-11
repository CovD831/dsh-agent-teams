/**
 * ── C4：机械化的停滞哨兵（t6）────────────────────────────────────────────────────
 *
 * 契约原话：*"a mechanical stall sentinel … It decides 'the task has stopped' by:
 * the same (taskId, attemptId) rejected by the same gate >= N times (N injectable,
 * default 2), or sitting in in_progress beyond N rounds. … It must NOT rely on a
 * member honestly reporting that it is stuck."*
 *
 * ── 它防的是什么（用户原话，这份文件的全部依据）────────────────────────────────────
 *
 * > 「卡点就是让任务停下来的地方……而很多停下来的卡点，都是可以自己去解决的。」
 *
 * ★★ 而"任务停下来了"**不能**靠成员自报：一个卡住的成员**恰恰是最不可能
 *   如实报告"我卡住了"的那一个**（它可能一直在重试、也可能已经放弃但还在产出日志）。
 *   ⇒ 所以本判据读的是**机械的事实**：任务记录上那个已经被数出来的拒绝次数与状态。
 *
 * ── ★★★ 判据的输入是【C1 已经解码好的状态】，不是重新数一遍 ────────────────────────
 *
 * `TaskStall`（`src/types.ts` 里那个零 import 的叶子）逐字带着：
 *
 *     state: 'trying' | 'stalled'   ← ★ C1 已经判完了
 *     count: number                 ← 这个 `(task, gate)` 被拒了几次（含第一次）
 *     gate? / point                 ← 是谁拒的（读不出来 ⇒ 缺席，不猜）
 *
 * ⇒ ★★ 本判据**不重新实现**那个计数：本仓最贵的一条纪律是"一个判据只有一个来源"
 *   （`docs/GATE-REGISTRY.md`；t6 三次失败的记录里也有它）。
 *   再数一遍就是**第二份真相**，而两份会漂移。
 *
 * ── ★★★ 为什么可以直接读 `ctx.team.tasks[].stall`（而不是 import C1 的纯函数）──────
 *
 * MEASURED（t6 attempt 4，本 worktree 的基线 88d1bdd）：
 *
 *     `src/tools/shared/entities.ts:27  import { registry } from '../../gates/index.ts'`
 *
 * ⇒ 若本判据 `import { observeStall } from '../../tools/shared/entities.ts'`，
 *   就形成 **cycle**：`gates/runtime/stall.ts → tools/shared/entities.ts → gates/index.ts → 本文件`。
 *   ★ 而 gates 层今天**不 import 任何 tools/**（`grep -rn "from '../../tools" src/gates/` 为空）——
 *     那条纯度是**载荷**，不是风格。
 *
 * ⇒ ★ 而**不需要**那个 import：`TaskStall` 住在 `src/types.ts`（**零 import 的叶子**），
 *   运行时判据经由 `ctx.team` 拿到**整个 TeamState**（`evaluateRuntimeGates` 把
 *   `source.team` 原样交给判据）⇒ 本判据直接读那个**已经解码好**的字段。
 *   ★ 于是既没有 cycle，也没有第二份计数 —— 两个约束同时满足。
 *
 * ── ★★ 它【不能拒绝任务】，而那是**类型**保证的，不是约定 ──────────────────────────
 *
 * `evaluateRuntimeGates` 在 runtime 位置**只记录、不拒绝**（契约 §5）。
 * 而 liveness 依赖"约定 + 调用方"来避免拒绝 —— t6 要比它**更强**：
 * 本文件导出的 `gate` 的返回类型被**收窄到 `GateVerdict` 里不拒绝的那一半**
 * （`StallVerdict`，见下）。⇒ ★ 一个 `return blocked([...])` 在这里是**TS2322**，
 *   而不是一次 code review 才能发现的事。验收第 2 条点名的就是这一格。
 *
 * @module dsh-agent-teams/gates/runtime/stall
 */

import type { TaskStall, TeamTask } from '../../types.ts'
import { unmeasured, type GateVerdict } from '../registry.ts'
import type { CtxPaths } from '../requires.ts'

export const id = 'runtime.stall'
export const point = 'runtime'
export const description =
  '★ 它判的是【这个任务是不是停下来了】—— 依据是任务记录上**已经被数出来**的事实：'
  + '同一个 (task, gate) 被拒的次数 ≥ N，或任务在 in_progress 上超过了 N 轮。'
  + '★ 它**不读成员的自报**（一个卡住的成员恰恰最不可能如实说"我卡住了"）。'
  + '★ 它【记录，不拒绝】：runtime 位置的裁决不得阻止流程。'
  + '★ 而"说不出"（任务面整个没接上）是**第三态**，绝不当成"没人停住"。'

/**
 * ── ★★★ 本判据的返回类型：**不拒绝的那一半**（验收第 2 条）───────────────────────
 *
 * `GateVerdict` 是三态联合，其中 `{ok:false; blockers:[...]}` 是"拒绝"。
 * ★ 把返回类型收窄到**排除那一支** ⇒ "本判据不能拒绝"从一个**约定**
 *   变成**编译期的事实**：写 `return blocked([...])` 当场 TS2322。
 *
 * ★ 为什么不是"把 GateVerdict 改宽/改窄"：那是**共享**类型，别的判据需要那一支。
 *   这里收窄的是**本文件导出的那一个函数**的签名。
 */
export type StallVerdict =
  | { ok: true; [produced: string]: unknown }
  | { ok: false; unmeasured: string }

/** 本判据开口的事件白名单（与 liveness 同一形状：判据自己决定说不说话）。 */
export const STALL_EVENTS: readonly string[] = ['task-status', 'task-update-settled', 'delivery-declared']

/**
 * ── ★ 默认 N（同一个 (task, gate) 被拒几次算"停下来"）───────────────────────────
 *
 * 契约原话：*"N injectable, default 2"*。
 * ★ 而**可注入**这一条是有历史的：`docs/PENDING-FRICTION-REFORM.md` 逐字写着
 *   「N 必须可注入」—— 一个写死的阈值会在别的仓库形态里要么永远不响、要么吵个不停，
 *   而两种都读不出来（一个恒不响的哨兵与没装它在观测上同形）。
 */
export const DEFAULT_STALL_ROUNDS = 2

export interface RuntimeStallContext {
  /** 六个调用点里 discriminator 之一；本判据只在 {@link STALL_EVENTS} 上开口。 */
  event?: string
  /**
   * ── ★ 团队面：**整个 TeamState**（`tasks[]` 是本判据唯一真正需要的东西）───────
   *
   * ★ 缺席 ⇒ **没能测量**（不是"没人停住"）：那说明这一轮没接上团队。
   *   `team.tasks` 缺席 ⇒ 同样 `unmeasured` —— "观察面没给我"与"我看了、没人停住"
   *   必须不同形，而前者被读成后者就是一个**恒不响的哨兵**。
   */
  team?: { id?: string; tasks?: TeamTask[] }
  /**
   * ── ★★ N：可注入（验收第 3 条）────────────────────────────────────────────────
   *
   * 缺席或非法 ⇒ {@link DEFAULT_STALL_ROUNDS}（**绝不抛错**：一个判据不该
   * 因为配置没给而炸掉整个 runtime 位置）。
   * ★ 而它同时**进入读数**（`threshold` 随产出交出去）——
   *   `docs/PENDING-FRICTION-REFORM.md` §6 那条：**一个数必须与它的量具一起读**，
   *   否则"被拒 3 次"在 N=2 与 N=5 下读起来一样，而它们的含义相反。
   */
  rounds?: number
}

export const requires: CtxPaths<RuntimeStallContext>[] = ['event', 'team']

/** N 的解析：非法/缺省 ⇒ 默认值（**不抛错** —— 见上面那段）。 */
export function stallRoundsOf(raw: number | undefined): number {
  if (raw === undefined || !Number.isInteger(raw) || raw < 1) return DEFAULT_STALL_ROUNDS
  return raw
}

export function appliesTo(ctx: RuntimeStallContext | undefined): boolean {
  if (ctx === undefined) return false
  return STALL_EVENTS.includes(String(ctx.event))
}

/**
 * ── ★★★ 三态，且**三者不同形**（验收第 4 条）───────────────────────────────────
 *
 *     ① `ok: true` + `stalled_count: 0`        —— 看了，没有人停下来
 *     ② `ok: true` + `stalled_count > 0`       —— 看了，**有人停下来了**（逐条指名）
 *     ③ `ok: false` + `unmeasured`             —— **没能测量**（团队面没接上）
 *
 * ★★ 而 ② 与 ① **都落在 `ok: true` 上**，因为本判据**不拒绝**（runtime 位置的纪律）。
 *   ⇒ 于是"有人停下来"这件事必须靠 `stalled_count` 与 `observations` **读出来**，
 *     不能只靠 `ok`。★ 这正是 liveness 的同一形状（它也用 `stuck_count`）。
 * ★★★ 而 ③ **绝不许**并进 ①：把"没测到"读成"没人停住"就是一个**恒不响的哨兵**,
 *   而它与"哨兵工作且无人停住"在 `ok:true` 上同形 —— 那正是本任务要消灭的合流。
 *
 * ★ 还有一个**第四读数**（不是第四态）：`evaluated` 的"没得看"。
 *   任务面在场但一条 `in_progress` 都没有 ⇒ **不是** unmeasured：
 *   那是"看了，此刻没有在跑的任务"（正常情形），与 liveness 的 `waits: []` 同源。
 */
/**
 * ── `attempt` 的读法：**缺席 ⇒ 第一轮**（`0`），而不是"不知道" ─────────────────────
 *
 * `TeamTask.attempt?` 是可选的（`src/types.ts:330`）。★ 而"从没尝试过"在这里
 * 有**界定过的**含义（`0`）—— 与 `TaskStall` 缺席 = "从未被拒"同一条纪律。
 * ★★ 反过来说：若把它读成 `undefined` 再参与比较，类型上就不成立，
 *   而强行比较会得到 `false` ⇒ **永远不报 rounds 那一支**，
 *   而那正好是"最安静的停摆"（见下面 `observeOne` 的注释）。
 */
function attemptOf(task: TeamTask): number {
  const raw = task.attempt
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

export interface StallObservation {
  taskId: string
  /** 这个 `(task, gate)` 被拒了几次（**直接来自 C1 的读数**，本判据不重数）。 */
  count: number
  /** 谁拒的（可能缺席 —— 读不出来就不猜，见 C1 的 `unknown` basis）。 */
  gate?: string
  point?: string
  /**
   * 它是怎么被判为停下的：`repeats`（同一个 (task,gate) 被拒 ≥ N 次）
   * 或 `rounds`（在 in_progress 上超过 N 轮）。★ 两种**不同形** ——
   * 因为补救动作不同：一个去看那条判据为什么反复拒，一个去看这个任务为什么一直没完成。
   */
  basis: 'repeats' | 'rounds'
}

/**
 * 一条任务"停下来了吗"。
 *
 * ★ 纯函数：不读盘、不读表、不记日志（契约 §2 性质 1 —— 判据是纯数据变换）。
 */
function observeOne(
  task: TeamTask,
  threshold: number,
): StallObservation | undefined {
  /**
   * ── `stall` 缺席 ⇒ **从未被拒**（C1 的第三态）⇒ 不是停下 ─────────────────────
   *   ★ 而不是"我不知道"：`TaskStall` 的缺席在这个仓里有**界定过的**含义
   *     （`src/types.ts` 逐字写着"这里刻意没有第三态：本字段缺席就是第三态"）。
   *   ⇒ 只有**任务面整个缺席**才是"没能测量"（见 `gate`）。
   */
  const stall = task.stall as TaskStall | undefined
  if (stall === undefined) {
    /**
     * ★ 另一半：**没有任何拒绝记录**、而任务已经跑了超过 N 轮 ⇒ 也停下。
     *   契约原话："or sitting in in_progress beyond N rounds"。
     *   ★ 这一支很重要：一个**从不被拒**的任务可以卡在 in_progress 上（成员跑了、
     *     没交回任何东西）—— 而那**不会有** `stall` 记录。
     *   ⇒ 少了这一支，最安静的那种停摆**恰好**是本判据看不见的。
     */
    const attempt = attemptOf(task)
    if (task.status === 'in_progress' && attempt > threshold) {
      return { taskId: task.id, count: attempt, basis: 'rounds' }
    }
    return undefined
  }
  /**
   * ★ 判据 ①（repeats）：`state === 'stalled'` **或** `count >= N`。
   *
   * ★ 为什么要看 `state` 而**不只看** `count`：`state` 是 C1 的**结论**
   *   （它按 `(task, gate, point)` 分键判的）。**只看 count 会把它读漏**：
   *   C1 可能已经判 `stalled` 而那个数的语义与这里的 N 并不等价。
   *   ⇒ 两个来源**互相印证**，任一成立即"停下"（而它们都在场时读数是同一个任务）。
   */
  if (stall.state === 'stalled' || stall.count >= threshold) {
    return {
      taskId: task.id,
      count: stall.count,
      ...stall.gate === undefined ? {} : { gate: stall.gate },
      point: stall.point,
      basis: 'repeats',
    }
  }
  /** ★ ②（rounds）：没有反复拒绝，但这个尝试已经跑过 N 轮了。 */
  const attempt = attemptOf(task)
  if (task.status === 'in_progress' && attempt > threshold) {
    return {
      taskId: task.id,
      count: attempt,
      ...stall.gate === undefined ? {} : { gate: stall.gate },
      point: stall.point,
      basis: 'rounds',
    }
  }
  return undefined
}

/**
 * ── 判据本体 ────────────────────────────────────────────────────────────────────
 *
 * ★★ 返回类型是 {@link StallVerdict} —— **它排除了 `blockers` 那一支**。
 *   于是"本判据不能拒绝任务"是**编译期**的事实（验收第 2 条）。
 */
export function gate(ctx: RuntimeStallContext): StallVerdict {
  const team = ctx?.team
  /**
   * ── 第三态：**没能测量** ──────────────────────────────────────────────────────
   *
   * MEASURED 的纪律（与 liveness 同一段论证）：`team` 缺席 = 这一轮团队面没接上；
   * `team.tasks` 缺席 = 给了团队、而里面没有我要的那一格。
   * ★ 两者都**不是**"没人停住" —— 而那正是最危险的误读：
   *   一个恒 unmeasured 的哨兵是**吵**，一个恒 ok 的哨兵是**哑**，哑的那个更坏。
   */
  if (team === undefined) {
    return unmeasured(
      'cannot tell whether any task has stalled: the team observation was not injected at this event, '
      + 'so the task records (which carry the already-decoded stall state) were never read',
    ) as StallVerdict
  }
  if (!Array.isArray(team.tasks)) {
    return unmeasured(
      'cannot tell whether any task has stalled: the team observation was injected but carries no task list, '
      + 'so there is nothing to read — "no tasks to read" is not "no task has stalled"',
    ) as StallVerdict
  }

  /**
   * ★ N 随读数一起交出去（见 `RuntimeStallContext.rounds` 那段：
   *   一个数必须与它的量具一起读）。
   */
  const threshold = stallRoundsOf(ctx?.rounds)
  /** ★ 只看**没结束的**：已完成的尝试不是"停下"，它是在做/做完了。 */
  const running = team.tasks.filter((task) => task.status === 'in_progress')
  const observations = running
    .map((task) => observeOne(task, threshold))
    .filter((entry): entry is StallObservation => entry !== undefined)

  return {
    ok: true,
    /** ★ 量具：读 `count` 的人必须同时读得到这个数（否则 N=2 与 N=5 同形）。 */
    threshold,
    /** ★ 看了几条（空面与"看了没人停"必须不同形 —— 见下面 `examined` 的注释）。 */
    examined: running.length,
    stalled_count: observations.length,
    observations,
  }
}
