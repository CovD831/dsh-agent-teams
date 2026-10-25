/**
 * ── 线 A：证据投影（`readouts.evidence`）—— **只做投影，不改存储** ─────────────────
 *
 * ── 裁定（`docs/TEAM-CONTROL-PLANE-SPEC.md` §23.1，终裁）────────────────────────
 *
 * ```
 *   一条读数改完之后，如果不去重算它，会不会自己变？
 *     会变 ⇒ 它是投影（可以现算、可以放在容器里）
 *     不变 ⇒ 它是第二份真相（必须删掉一个）
 * ```
 * ⇒ `readouts.evidence` 被判为**投影**：可以建，**只读不存**，每次现算。
 *   两条硬约束逐字写在这里，因为它们决定了本文件**不长成什么样**：
 *
 *    1. **投影层不许新增任何持久化字段。** 想给读数加缓存"提性能"就是第二份真相；
 *       缓存与投影的区别是：**投影没有写入端**。
 *    2. 本文件**不写** `task`，**不改** `gateEvaluations` / `gateEvaluation`，
 *       不碰 `src/gates/registry.ts`、`state/tasks.ts` 的 `gateEvaluationRecordOf`、
 *       以及 `gateEvaluations.contract` 那一组白名单 —— 那是另一条线的工作。
 *
 * ── 两条 durable 证据流（都带 `at` + `attemptId`）────────────────────────────────
 *
 * | 流 | 字段 | 写点 |
 * |---|---|---|
 * | `task.executions[]` | `at` `attempt` `attemptId` `status` `round` `verdict` `failureKind` `by` | `src/tools/update-task.ts:2188` |
 * | `task.supplementalEvidence[]` | `at` `by` `attempt` `attemptId` `note` `acceptanceResults` `commandsRun` | `src/quality-gates.ts:3853` |
 *
 * ── ★★★ 实测事实（伪造代价审计 2026-10-24 报，我逐条复核并补了两条正面对照）
 *
 * ```
 *   grep -c "executions" src/state.ts                       ⇒ 0
 *   hasValidQualityTaskFields(src/quality-gates.ts:3179)     ⇒ 校验了 supplementalEvidence，
 *                                                              但**没有**校验 executions
 *   MEASURED（我的臂 11）：一条 executions: [{}] 的 team.json **能被 readTeam 读回来**
 *   MEASURED（同一臂）：同一份记录里 supplementalEvidence 缺 by ⇒ readTeam 直接拒
 * ```
 * ⇒ 两条流的**校验强度不同**：`supplementalEvidence` 有 durable 校验（写不进非法值），
 *   `executions` **完全没有**。所以"记录是合法的"这句话只对前者成立。
 * ★ 本文件因此**自己校验它读到的那几格**（见 {@link problemsOf}）——
 *   这不是额外防御，而是 `executions` 当前**唯一**的一道关。
 * ★ 而**把校验补到持久面**（让非法记录根本写不进去）是另一件事 —— 那会动 durable 面，
 *   今晚不做。如实记在这里：**别以为 `executions` 被校验过。**
 *
 * ── ★ 两条流**都要**被投影 ─────────────────────────────────────────────────────
 *
 * 它们回答的是不同的问题：`executions` 是"这一次尝试落到了什么终态"，
 * `supplementalEvidence` 是"落终态之后补上的观察"。只投一条会让"补上的观察"
 * 在读数上不存在，而它恰恰是最常被追问的那一半（"你说过了，凭什么"）。
 *
 * ── ★★★ `evidenceId` 的派生：`task.id + attemptId + at`，**不读时钟** ────────────
 *
 * ```
 *   task.execution#<taskId>/<attemptId>/<at>
 *   task.evidence#<taskId>/<attemptId>/<at>
 * ```
 *
 * ★ 三个理由，都是纪律：
 *   ① **`at` 是"读数据"，不是"读墙钟"** —— 读数提供者必须**确定性**
 *      （同一个 stateRoot 两次收集必须给出同一个 `evidenceId`，否则 golden 对比
 *      永远抖动）。本文件里没有任何 `Date.now()`。
 *   ② **不许给 `registry.evaluate` 注入一个 `now`** —— 那不是本线的改动面。
 *   ③ 前缀区分两条流，于是**同一 (taskId, attemptId, at)** 落在两条流上不会撞 id。
 *
 * ★ **段分隔用 `/`**（`encodeURIComponent` 会把段内的 `/` 编成 `%2F`）：
 *   若用 `.` 之类做分隔，`("a", "b.1")` 与 `("a.b", "1")` 会派生出同一个 id。
 * ★ `attemptId` **缺席不编一个**（`TeamTask.attemptId` 的注释逐字要求）：
 *   缺席段是空串，而合法 `attemptId` 必然非空 ⇒ 两者不会同形。
 *
 * ── ★★★ 三条"写着不许、代码也必须挡"的防线（审计实测出来的三个坏法）────────────
 *
 * ```
 *   输入                       旧行为（缺陷）                     今天
 *   executions: [{}]          产出 task.execution#t2//undefined  ⇒ 该条落 unmeasured，不拼 id
 *   两条完全相同的记录         产出同一个 evidenceId 两次          ⇒ 只输出一条，并记 duplicatesDropped
 *   两条 id 相同、内容不同     静默丢一条                          ⇒ 整条读数落 unmeasured 并点名
 * ```
 * ★ 第三条的选择是刻意的：**"两条不同的证据撞了 id"必须让整格不可用**。
 *   静默留一条会让人以为"这里只有一条证据"，而实际是"这里有两条，我分不出真假"。
 *
 * ── ★★★ `reverified`：本读数**不许**以"已测量"的姿态单独出现 ──────────────────────
 *
 * MEASURED（伪造代价审计 2026-10-24，我复核）：
 * ```
 *   grep -rn "supplementalEvidence" src/gates/     ⇒ 0 处读取
 *   completion/verify-rerun.ts:88-93 的 appliesTo 要求 taskNotTerminal === true
 *   而 appendTaskEvidence 要求**终态**（quality-gates.ts:3854）
 * ```
 * ⇒ `supplementalEvidence` 可以一次 `update_task` 就写进去，而
 *   **补证据这条路，正好是 verify-rerun 刻意跳过的那条。**
 *   于是这条路写下的任何东西都**没有任何判据复核过** —— 它是自述。
 *
 * ⇒ 所以每条证据带一格 `reverified`：
 * ```
 *   'yes'     gateEvaluations.completion 里 completion.verify-rerun 真的重跑过命令，且全绿
 *   'no'      重跑过，且至少一条 failed
 *   'unknown' **没有可用的重跑记录**（含"这条任务从没求值过 completion"）
 * ```
 * ★ `unknown` **不是** `no`：前者是"没人复核过"，后者是"复核了、没过"。
 *   把前者写进后者，会让"没测到"冒充"测到了且不通过" —— 本仓最贵那条形态的镜像。
 * ★ 判定**只读** `gateEvaluations.completion`（裁定）。旧数据只有单段 `gateEvaluation`
 *   时落 `unknown` —— 保守方向是对的（`unknown` 不会冒充 `yes`）。
 *   ★ **不**退回读 `task.commandsRun` / `supplementalEvidence[].commandsRun`：那是**自报**，
 *     而本格存在的全部意义就是把自报与复核分开。
 *
 * ── ★ 三态在**本模块内部**同样分形 ────────────────────────────────────────────
 *
 * ```
 *   { entries: [ …证据… ], duplicatesDropped }                    ⇒ 测到了（可能零条）
 *   { entries: [ …, { unmeasured: 'invalid-evidence: …' } ] }       ⇒ 某一条坏 ⇒ **那一条**落 unmeasured
 *   { unmeasured: 'duplicate-evidence-id: …' }                      ⇒ 整格不可用（id 撞了且内容不同）
 *   { unmeasured: 'no-team: …' / 'no-region: …' }                   ⇒ 盘上都读不到
 * ```
 * ★ 单条坏不许把整格拉黑：一条脏记录不该让其余 N 条真证据消失（那会让人以为"这个队没有证据"）。
 *   而"整格不可用"只留给**分不出真假**那一种。
 *
 * ── ★ 已知缺口（与线 C 同一条，记在 `src/backends.ts` 文件头）────────────────────
 *
 * §23.1 要求"一次读盘、多格共享"，而 `ReadoutContext` 没有共享读取句柄 ⇒ 线 A 与线 C
 * 各读一次 `team.json`。**不用模块级缓存去凑**（那是有写入端的第二份真相）。
 *
 * @module dsh-agent-teams/evidence
 */

import type { ReadoutProvider } from './readouts.ts'
import { readTeamEx } from './state.ts'
import type {
  AcceptanceResult,
  CommandResult,
  FailureKindName,
  ReviewVerdict,
  TaskEvidence,
  TaskExecution,
  TaskStatus,
  TeamState,
  TeamTask,
} from './types.ts'

/** 两条流的名字（也是 `evidenceId` 的前缀）。 */
export type EvidenceStream = 'execution' | 'supplemental'

/**
 * 这条证据**有没有被判据复核过**（三态，见文件头那段实测）。
 *
 * ★ `'unknown'` **绝不并进** `'no'`：前者是"没人复核"，后者是"复核了、没过"。
 */
export type ReverificationState = 'yes' | 'no' | 'unknown'

/**
 * 一条投影出来的证据。
 *
 * ★ 它**不重新解释**任何字段：源记录上有的就原样带过来（三态字段缺席就仍然缺席）。
 *   投影的职责是"按证据的身份把它摊平到一处"，不是"用我自己的话再讲一遍"。
 */
export interface EvidenceEntry {
  /** 稳定 id（见文件头：`task.id + attemptId + at` 派生）。 */
  readonly evidenceId: string
  readonly taskId: string
  readonly stream: EvidenceStream
  /** 证据发生时刻（**数据**里的 `at`，不是墙钟）。 */
  readonly at: number
  /** 第几次尝试（与 `TeamTask.attempt` 同一套编号）。 */
  readonly attempt: number
  /** 那一代的 capability；**缺席 = 当时没有**（不编一个）。 */
  readonly attemptId?: string
  /** 终态（只有 `executions` 有；`supplementalEvidence` 是补证据，没有终态可言）。 */
  readonly status?: TaskStatus
  /** 收敛循环第几轮（缺席 = 不是一轮）。 */
  readonly round?: number
  /** 审查裁决（缺席 = 没有裁决，不是"裁决为空"）。 */
  readonly verdict?: ReviewVerdict
  /** 失败成因（只有 `failed` 才可能有）。 */
  readonly failureKind?: FailureKindName
  /** 谁落的 / 谁补的。 */
  readonly by?: string
  /** 补证据时的说明（只有 `supplementalEvidence` 有）。 */
  readonly note?: string
  /** 补证据时逐条验收结果（只有 `supplementalEvidence` 有）。 */
  readonly acceptanceResults?: readonly AcceptanceResult[]
  /** 补证据时跑过的命令（只有 `supplementalEvidence` 有）。 */
  readonly commandsRun?: readonly CommandResult[]
  /**
   * 这条证据有没有被判据复核过（**逐条**带，因为它决定"这条能不能当证据读"）。
   * ★ 它是**任务级**事实的逐条投影（同一条任务的几条证据共用同一个值）；
   *   加这一格的理由见文件头：没有它，"补证据"会以"已测量"的姿态出现在界面上。
   */
  readonly reverified: ReverificationState
}

/** 一条**投不出来**的证据（坏到无法建立身份 / 无法生成 id）。 */
export interface UnprojectableEvidence {
  /** 为什么投不出来（带上下文：哪个任务的哪条流的第几个元素）。 */
  readonly unmeasured: string
  readonly taskId: string
  readonly stream: EvidenceStream
  /** 它在该流里的下标（0 起）—— 好让人能照着去盘上找那一条。 */
  readonly index: number
}

/** `entries` 里的一格：要么是一条证据，要么是一句"这条投不出来"。 */
export type EvidenceCell = EvidenceEntry | UnprojectableEvidence

/** 正常态的读数形状（"测到了"，可能零条）。 */
export interface EvidenceReadout {
  /** 这个队有多少条任务（= `team.tasks.length`，零也照报）。 */
  readonly tasks: number
  /** 摊平后的格子：证据在前（按 `at` 升序），"投不出来"的在后（见 {@link projectEvidence}）。 */
  readonly entries: readonly EvidenceCell[]
  /**
   * 因为**与已有证据完全相同**而被收起的重复条数。
   *
   * ★ 为什么要报这个数而不是静默去重：静默去重会让"盘上有两条一样的记录"
   *   与"盘上只有一条"同形 —— 而前者是**写点出问题**的信号（同一代被追加了两次），
   *   值得有人看见。
   */
  readonly duplicatesDropped: number
  /**
   * ── 整格的**复核状态**（本读数能不能当证据读的那一格）────────────────────────
   *
   * ★ 读端按这一格决定要不要打"自述·未复核"的标（`src/client/activity-model.ts`
   *   的 `withReverified` 就只认这一格）—— 没有它，界面又会把"一次 update_task
   *   伪造的补证据"显示成一条正常证据。
   *
   * ★★ 它**不是**第二个真相：它由 {@link reverificationSummaryOf} 从 `entries`
   *   **算出来**（最弱一环聚合：任何一条 `unknown` ⇒ 整格 `unknown`），
   *   所以它不可能与 `entries[].reverified` 分叉 —— 而逐条那一格保留下来，
   *   是因为"哪一条没被复核"才是排障时要问的问题。
   */
  readonly reverified: ReverificationState
}

/**
 * 把逐条的复核状态聚合成**整格**的那一格（最弱一环）。
 *
 * 规则（顺序有意义）：
 * ```
 *   没有任何证据（零条 / 全部投不出来）  ⇒ 'unknown'   —— 什么都没被复核过，不许说 'yes'
 *   有任何一条 'unknown'                 ⇒ 'unknown'   —— 最弱一环：那一条只是自述
 *   否则任何一条 'no'                    ⇒ 'no'        —— 复核了、没过
 *   其余                                 ⇒ 'yes'
 * ```
 * ★ `'unknown'` 优先于 `'no'`：`'no'` 至少是一次**真的测量**（复核过且失败），
 *   它不需要"自述"这个警告；而 `'unknown'` 的那一条仍然混在同一个读数里。
 *   把整格标成 `'no'` 会让"其中一条没被复核"这件事消失。
 */
export function reverificationSummaryOf(cells: readonly EvidenceCell[]): ReverificationState {
  const states = cells.flatMap((cell) => ('evidenceId' in cell ? [cell.reverified] : []))
  if (states.length === 0) return 'unknown'
  if (states.includes('unknown')) return 'unknown'
  if (states.includes('no')) return 'no'
  return 'yes'
}

/** 投影的结果：要么是一份读数，要么是"整格不可用"（id 撞了且内容不同）。 */
export type EvidenceProjection = EvidenceReadout | { readonly unmeasured: string }

/**
 * 派生一条证据的稳定 id。
 *
 * ★ **前置条件**：`at` 必须是有限数、`attemptId` 必须是非空串或缺席。
 *   `projectEvidence` 在调它之前先校验；**坏数据不许走到这里** ——
 *   否则会拼出 `…/t2//undefined`，而那种 id "寻址不到任何东西"却看起来正常。
 */
export function evidenceIdOf(stream: EvidenceStream, taskId: string, attemptId: string | undefined, at: number): string {
  const prefix = stream === 'execution' ? 'task.execution' : 'task.evidence'
  const attemptSegment = attemptId === undefined ? '' : encodeURIComponent(attemptId)
  return `${prefix}#${encodeURIComponent(taskId)}/${attemptSegment}/${at}`
}

/** 只把**在场**的键放进去（缺席的键不许出现成 `undefined`）。 */
function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>
}

/** 一个值是不是普通对象（不是 null / 不是数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 稳定序列化（键排序）：用于"两条 id 相同的证据内容是否相同"的比较。 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'object' && item !== null && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : item)
}

/**
 * ── `reverified` 的**唯一**派生点 ────────────────────────────────────────────────
 *
 * @param task - durable 任务记录。
 * @returns 三态 + 一句成因（成因给夹具与排障用，不逐条塞进读数）。
 *
 * ★ 派生链**只读一处**：`task.gateEvaluations.completion.outputs['completion.verify-rerun'].reruns`
 *   （那是 `completion.verify-rerun` 判据的产物，落盘经 `gateEvaluationRecordOf`
 *   的 `outputs` 白名单逐键抄写，`state/tasks.ts:173`）。
 * ★ 落 `'unknown'` 的四种情形（各自可区分，`why` 里说清）：
 *   ① 这条任务从没求值过 completion（`gateEvaluations.completion` 缺席）
 *   ② 求值过，但那次没有产出 `completion.verify-rerun` 的产物
 *   ③ 产物在，但 `reruns` 不是数组
 *   ④ `reruns` 是空的 / 里面没有一条可读的 `CommandResult`
 */
export function reverificationOf(task: TeamTask): { readonly state: ReverificationState; readonly why: string } {
  const completion = task.gateEvaluations?.completion
  if (completion === undefined) {
    return { state: 'unknown', why: 'gateEvaluations.completion is absent: this task was never evaluated by the completion gates, so nothing re-executed its declared verify commands' }
  }
  const outputs: unknown = completion.outputs
  const produced = isRecord(outputs) ? outputs['completion.verify-rerun'] : undefined
  if (!isRecord(produced)) {
    return { state: 'unknown', why: 'the completion evaluation recorded no "completion.verify-rerun" output, so no rerun result exists for this generation' }
  }
  const reruns: unknown = produced['reruns']
  if (!Array.isArray(reruns)) {
    return { state: 'unknown', why: 'the "completion.verify-rerun" output has no "reruns" array, so what it produced cannot be read as rerun results' }
  }
  const usable = reruns.filter((row): row is { status: 'passed' | 'failed' } =>
    isRecord(row) && (row['status'] === 'passed' || row['status'] === 'failed'))
  if (usable.length === 0) {
    return { state: 'unknown', why: `the "completion.verify-rerun" output carries ${reruns.length} entry(ies) but none is a CommandResult with a passed/failed status, so nothing can be concluded about re-verification` }
  }
  const failed = usable.filter((row) => row.status === 'failed').length
  if (failed > 0) {
    return { state: 'no', why: `the quality gate re-executed the declared verify command(s) and ${failed} of ${usable.length} failed` }
  }
  return { state: 'yes', why: `the quality gate re-executed all ${usable.length} declared verify command(s) and every one passed` }
}

/**
 * 一条证据**坏在哪**（空数组 = 可以投影）。
 *
 * ★ 校验的正是 `evidenceId` 依赖的那几格（`at` / `attemptId`），加上两条流各自的
 *   **身份字段**（`executions[].status` / `supplementalEvidence[].by`）。
 *   `attempt` 一起校验：它是"第几次"的唯一凭据，缺了这条证据就无法归代。
 * ★ 措辞刻意不写"undefined"这个词：本文件里它只应该以**没有这个键**的形态出现，
 *   让断言 `!json.includes('//undefined')` 保持锋利（否则消息里的散文会污染判据）。
 */
function problemsOf(stream: EvidenceStream, element: unknown): string[] {
  if (!isRecord(element)) {
    return [`the element is not an object (got ${Array.isArray(element) ? 'an array' : element === null ? 'null' : typeof element})`]
  }
  const problems: string[] = []
  const at = element['at']
  if (typeof at !== 'number' || !Number.isFinite(at)) {
    problems.push('`at` is missing or not a finite number, and `at` is one segment of the evidence id, so without it the id would address nothing')
  }
  const attempt = element['attempt']
  if (typeof attempt !== 'number' || !Number.isSafeInteger(attempt) || attempt < 0) {
    problems.push('`attempt` is missing or not a safe integer >= 0, so this element cannot be attributed to a generation')
  }
  const attemptId = element['attemptId']
  if (attemptId !== undefined && (typeof attemptId !== 'string' || attemptId === '')) {
    problems.push('`attemptId` is present but not a non-empty string; an absent attempt id must stay absent instead of becoming a blank segment')
  }
  if (stream === 'execution') {
    if (typeof element['status'] !== 'string' || element['status'] === '') {
      problems.push('`status` is missing: an execution is "one attempt reached a terminal state", so without it there is no attempt to record')
    }
  } else if (typeof element['by'] !== 'string' || element['by'] === '') {
    problems.push('`by` is missing: supplemental evidence must be attributable to somebody')
  }
  return problems
}

/** 把一条 `executions[]` 元素投成证据（**调用方已校验**）。 */
function entryOfExecution(taskId: string, execution: TaskExecution, reverified: ReverificationState): EvidenceEntry {
  return {
    evidenceId: evidenceIdOf('execution', taskId, execution.attemptId, execution.at),
    taskId,
    stream: 'execution',
    at: execution.at,
    attempt: execution.attempt,
    ...optional('attemptId', execution.attemptId),
    status: execution.status,
    ...optional('round', execution.round),
    ...optional('verdict', execution.verdict),
    ...optional('failureKind', execution.failureKind),
    ...optional('by', execution.by),
    reverified,
  }
}

/** 把一条 `supplementalEvidence[]` 元素投成证据（**调用方已校验**）。 */
function entryOfSupplement(taskId: string, supplemental: TaskEvidence, reverified: ReverificationState): EvidenceEntry {
  return {
    evidenceId: evidenceIdOf('supplemental', taskId, supplemental.attemptId, supplemental.at),
    taskId,
    stream: 'supplemental',
    at: supplemental.at,
    attempt: supplemental.attempt,
    ...optional('attemptId', supplemental.attemptId),
    ...optional('note', supplemental.note),
    by: supplemental.by,
    ...optional('acceptanceResults', supplemental.acceptanceResults),
    ...optional('commandsRun', supplemental.commandsRun),
    reverified,
  }
}

/**
 * 把一份 team 记录投影成 `readouts.evidence`（**纯函数，不改入参**）。
 *
 * ── 三条防线（对应文件头那张表）──────────────────────────────────────────────
 * ① 每一格先过 {@link problemsOf}：坏的那一条落 `{ unmeasured }`，**不拼 id**；
 * ② `evidenceId` 生成后**去重**：内容完全相同的只留一条（计数进 `duplicatesDropped`）；
 * ③ 同 id 但**内容不同** ⇒ 整份读数 `{ unmeasured: 'duplicate-evidence-id: …' }`
 *    （"我分不出真假"必须让整格不可用，而不是静默留一条）。
 *
 * ── 排序 ────────────────────────────────────────────────────────────────────
 * · 证据格子按 `(at, evidenceId)` 升序 —— `at` 是源的排序依据，id 是稳定次级键；
 *   没有这一步，读数会依赖 `team.tasks` 的顺序（golden 对比会红得莫名其妙）。
 * · "投不出来"的格子**排在证据之后**，按生成序（任务序 → 流序 → 下标序）：
 *   它们没有合法的 `at`，混进 `at` 排序会让"它排在哪"变成一个假问题。
 */
export function projectEvidence(team: TeamState): EvidenceProjection {
  const measured: EvidenceEntry[] = []
  const unprojectable: UnprojectableEvidence[] = []
  const byId = new Map<string, EvidenceEntry>()
  const conflicts: string[] = []
  let duplicatesDropped = 0

  for (const task of team.tasks) {
    /**
     * ★ `reverified` 是**任务级**事实：同一条任务的所有证据共用它。
     *   ⇒ 每条任务只派生一次（也让派生成本不随证据条数放大）。
     */
    const reverified = reverificationOf(task).state

    const streams: Array<{ label: string; stream: EvidenceStream; rows: readonly unknown[] }> = [
      { label: 'executions', stream: 'execution', rows: (task.executions ?? []) as readonly unknown[] },
      { label: 'supplementalEvidence', stream: 'supplemental', rows: (task.supplementalEvidence ?? []) as readonly unknown[] },
    ]

    for (const { label, stream, rows } of streams) {
      for (const [index, element] of rows.entries()) {
        const problems = problemsOf(stream, element)
        if (problems.length > 0) {
          unprojectable.push({
            unmeasured: `invalid-evidence: ${label}[${index}] of task "${task.id}" cannot be projected — ${problems.join('; ')}; dropping it keeps the remaining evidence readable, and inventing an id for it would produce a trace id that addresses nothing`,
            taskId: task.id,
            stream,
            index,
          })
          continue
        }
        const entry = stream === 'execution'
          ? entryOfExecution(task.id, element as TaskExecution, reverified)
          : entryOfSupplement(task.id, element as TaskEvidence, reverified)

        const prior = byId.get(entry.evidenceId)
        if (prior === undefined) {
          byId.set(entry.evidenceId, entry)
          measured.push(entry)
          continue
        }
        if (canonical(prior) === canonical(entry)) {
          /** ② 完全相同的重复：只留一条，但**计数**（静默去重会让"写点重复写了"消失）。 */
          duplicatesDropped += 1
          continue
        }
        /** ③ 同 id 不同内容：记下冲突，最后整格不可用（两条都点名）。 */
        conflicts.push(`"${entry.evidenceId}" is claimed by ${prior.taskId}/${prior.stream} and by ${entry.taskId}/${entry.stream} with different content`)
      }
    }
  }

  if (conflicts.length > 0) {
    return {
      unmeasured: `duplicate-evidence-id: ${conflicts.length} evidence id(s) are claimed by records whose content differs — ${conflicts.join(' | ')}. This slot is reported unmeasured as a whole because keeping either copy would silently hide that two different pieces of evidence claim one trace id, and a trace id that answers to two things answers to neither`,
    }
  }

  measured.sort((left, right) => left.at === right.at
    ? left.evidenceId.localeCompare(right.evidenceId)
    : left.at - right.at)

  return { tasks: team.tasks.length, entries: [...measured, ...unprojectable], duplicatesDropped, reverified: reverificationSummaryOf([...measured, ...unprojectable]) }
}

/**
 * 线 A 的读数提供者。
 *
 * 产出（正常，含"测了但零条"）：
 * ```ts
 * { tasks: 1, duplicatesDropped: 0,
 *   entries: [ { evidenceId: 'task.execution#t1//1792838580000', …, reverified: 'unknown' } ] }
 * ```
 * 产出（读不成 / 整格不可用，各自一句原因，**不带空数组**）：
 * ```ts
 * { unmeasured: 'no-region: …' } | { unmeasured: 'no-team: …' } | { unmeasured: 'duplicate-evidence-id: …' }
 * ```
 *
 * ★ 不 `try`/`catch`（见文件头）。
 * ★ 不读 `historic`：归档队的历史证据照样是盘上的事实。
 */
export const provideEvidenceReadout: ReadoutProvider = async ({ teamId, stateRoot }) => {
  const read = await readTeamEx(stateRoot, teamId)

  if (read.kind === 'no-region') {
    return {
      unmeasured: `no-region: the state root "${stateRoot}" is not a readable directory, so the evidence of team "${teamId}" could not be looked up at all — this is "the region (workspace state dir) is wrong or unreadable", not "this team produced no evidence"`,
    }
  }
  if (read.kind === 'no-team') {
    return {
      unmeasured: `no-team: the state root "${stateRoot}" is readable but has no team "${teamId}" (expected ${stateRoot}/${teamId}/team.json) — this is "that team is not here (archived / never created)", not "this team produced no evidence"`,
    }
  }

  return projectEvidence(read.team)
}
