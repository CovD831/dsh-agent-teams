/**
 * One durable member of a team, as a single row on screen one.
 *
 * ── ★★★ 这一屏要回答什么（用户原话）────────────────────────────────────────────
 *
 *   "is the whole team working, and who is doing what"
 *
 * 而用户对第一屏的**结构**要求是：显示**持久成员**，点开一个成员就看到它底下的
 * **子代理**，轮次信息**一起**给出来（"round data moves UP into screen one"）。
 *
 * ── 一行的四件事（缺一件就是一个"看起来正常但读不出东西"的格子）──────────────
 *
 *   ① 身份      —— 头像 + 名字 + 角色
 *   ② 模型      —— 它跑在哪个路由上（未启动的成员就地可改，复用既有选择器）
 *   ③ 在做什么  —— 当前任务 id + 任务名，读不出就说清是"读不出"
 *   ④ 计时      —— worked N / waiting N / idle / unknown，★ **从不空白**
 *
 * 展开后是它底下的子代理（数据由 R1/t27 送到 /state），每个**各自**说明它在做什么。
 *
 * ── ★ 反例：为什么计时必须单独一个组件 ────────────────────────────────────────
 *
 * 秒表若挂在**这一行**上，一行一 tick ⇒ 整队每秒重渲染。所以时长交给
 * {@link MemberClock}（它自己拥有表），本组件**不持有** `now`。
 * @module dsh-agent-teams/client/member-row
 */

import { useCallback, type CSSProperties } from 'react'
import {
  compactModelLabel,
  doingLineCandidates,
  GATE_GLYPH,
  latestOwnedTask,
  memberClock,
  memberClockStamp,
  memberGateReadouts,
  memberGateTone,
  memberHistoryState,
  memberRowKey,
  memberRound,
  memberSubagentReadout,
  memberRouteLabel,
  stageGateRows,
  stageGroupState,
  segmentAbsence,
  subagentTone,
  taskStage,
  FLOW_STAGES,
  type ClockTask,
  type FlowStage,
  type GateRowView,
  type LoopTask,
  type MemberClockKind,
  type LoopTone,
  type MemberGateReadout,
  type MemberSubagent,
  type SegmentAbsence,
  type StageGroupView,
} from './activity-model.ts'
import { MemberClock } from './MemberClock.tsx'
import { MemberModelField, memberModelEditability } from './StagingPlanEditor.tsx'
import { IconChevronDownOutline14 } from './icons.tsx'
import type { ActivityMember, ActivityTask, ActivityTeam } from './activity-monitor.ts'
import type { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { AgentTeamsLocaleKey, AgentTeamsTranslate } from './locales.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import css from './ActivityPanel.module.css'

/**
 * ★ t16 遗留：成员模型控件的行内样式。
 *
 * 原来它是 `ActivityPanel.tsx` 里的一个局部常量；R2 把它连同控件一起搬到这里，
 * 因为**用的那一行**才是它的归属。颜色仍然只来自宿主 `--dsw-alias-*` token。
 */
const MEMBER_MODEL_LINE_STYLE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, padding: '2px 6px 0 60px',
}

/**
 * What the row needs from one member row of the `/state` payload.
 *
 * ★ R1/t27 added `subagents` / `liveSubagents` / `subagentsReason` to the wire
 *   payload, but `ActivityMember` (src/client/activity-monitor.ts) is OUT of
 *   this task's scope. Widening structurally here keeps the reading honest:
 *   the panel reads the fields that are actually on the wire, and the day the
 *   base interface catches up this alias collapses to `ActivityMember`.
 */
export type MemberRowMember = ActivityMember & {
  readonly subagents?: string
  readonly liveSubagents?: readonly MemberSubagent[]
  readonly subagentsReason?: string
  /** ★ R1/t27: the member's highest task round, absent when it has none. */
  readonly round?: number
}

/**
 * One task as the row reads it, plus the S2 gate field when the wire carried it.
 *
 * ★ `gateEvaluation` is read **structurally**, not typed from `ActivityTask`:
 *   `src/client/activity-monitor.ts` declares a `src/tools/status.ts` field name
 *   (`gateEvaluation`) while the status tool actually serialises it to
 *   `gate_evaluation` **string**. Reading loosely here keeps the panel honest
 *   about both spellings instead of silently seeing `undefined` forever.
 */
export type MemberRowTask = ActivityTask & {
  readonly gateEvaluation?: unknown
  readonly gate_evaluation?: unknown
}

/** Presentation tone of one member's status dot (moved verbatim from the panel). */
export type MemberDotTone = 'running' | 'stalled' | 'delivered' | 'idle' | 'dormant'

/** Context flags that decide which member dot tone applies. */
export interface MemberDotContext {
  readonly discarded?: boolean
  readonly stopped?: boolean
  readonly staged?: boolean
  readonly historic?: boolean
}

/**
 * The tone of one member's status dot.
 *
 * ★ Liveness is read BEFORE `activity`, and the order is the whole point:
 *   `activity` is a durable field that keeps saying `working` after the member's
 *   session dies, so a dead member would keep a "running" dot forever — the
 *   residual reading task t4 exists to remove. A member whose session is gone
 *   while its work is still open therefore reads `stalled` (amber), not `running`.
 *
 * ★ When the host publishes no liveness field, this falls back to `activity`
 *   exactly as before rather than inferring a state nobody measured.
 */
export function memberDotTone(member: MemberRowMember, context: MemberDotContext): MemberDotTone {
  if (context.discarded === true || context.staged === true) return 'dormant'
  if (context.stopped === true || context.historic === true) return 'idle'
  const liveness = member.liveness
  if (liveness !== undefined && liveness !== '') {
    if (liveness === 'working') return 'running'
    if (liveness === 'not-live') return 'stalled'
    if (liveness === 'never-spawned') return 'dormant'
    /** `idle` / `could-not-measure`: alive but not driving, or unmeasured. */
    return 'idle'
  }
  if (member.activity === 'working') return 'running'
  return member.activity === 'idle' ? 'idle' : 'dormant'
}

/**
 * Locale key for one member-level gate verdict.
 *
 * ★ Reuses **existing** keys rather than adding any: `src/client/locales.ts` is
 *   out of this task's scope, and every one of these four already says the
 *   right thing in both dictionaries.
 */
const MEMBER_GATE_LABEL: Readonly<Record<string, AgentTeamsLocaleKey>> = {
  ok: 'round.tone.completed',
  blocked: 'round.tone.failed',
  unmeasured: 'round.tone.unmeasured',
  observed: 'round.tone.converging',
}

/**
 * The one symbol for the compact band (`docs/B-VISUAL-SPEC.md` 四符号).
 *
 * ★ `⊘` never collapses into `✓`: an all-skipped run has `evaluated === 0`,
 *   so it **cannot** be a pass — see reverse-edge B in {@link memberGateReadouts}.
 */
const MEMBER_GATE_MARK: Readonly<Record<string, string>> = {
  ok: '✓',
  blocked: '✗',
  unmeasured: '●',
  observed: '✗',
}

/**
 * ── ★★★ S3：按【成员】渲染判据裁决（默认精简层）────────────────────────────────
 *
 * ★★ 主屏是【成员】；点开成员才是【约束的体现】（用户的裁定）。所以这一层只给
 *   **当前阶段的一句话裁决**，逐条判据的明细留给展开层。
 *
 * ★★ **四种答案不合流**（本队记账最久的形态）：
 *   · `absent`  ⇒ 「读不出」  ★ 绝不印成「全通过」（反向半边 A）
 *   · `empty`   ⇒ 「⊘ 未检查」★ 绝不印成「✓ 通过」（反向半边 B）
 *   · `verdict` ⇒ 裁决符号 + 人话
 *
 * @param readout - the one task's readout for this member.
 * @param t - locale lookup.
 */
export function memberGateBand(
  readout: MemberGateReadout | undefined,
  t: AgentTeamsTranslate,
): { readonly mark: string; readonly tone: string; readonly text: string } {
  if (readout === undefined || readout.state === 'absent') {
    return { mark: '·', tone: 'absent', text: t('task.status.notRun') }
  }
  if (readout.state === 'empty') return { mark: '⊘', tone: 'skipped', text: t('round.tone.unmeasured') }
  return {
    mark: MEMBER_GATE_MARK[readout.verdict] ?? '✓',
    tone: readout.verdict,
    text: t(MEMBER_GATE_LABEL[readout.verdict] ?? 'round.tone.completed'),
  }
}


/**
 * ── ★★★ t80 缺陷②：把"**本轮真跑了的**"与"**没有落盘读数的**"分开 ────────────────
 *
 * ── 根因（MEASURED，用户截图：「展开详情之后会很杂乱」）──────────────────────────
 *
 * MEASURED（从 team.json 读 t79）：`gateEvaluation.ran` **只有 4 条**，全在
 * `completion` 段；而 UI 展开态把 `registry.list()` 的**全部 17 条**都列了出来
 * ⇒ 其余 **13 条**没有裁决 ⇒ 逐条都是 `registered`（○）。
 *
 * ⇒ ★★ 于是展开态把**两件不同的事**并列了：
 *
 *     "注册表里有哪些判据"    ← 17 条（一份**清单**）
 *     "这次实际跑了哪些判据"  ←  4 条（一个**事实**）
 *
 * ⇒ 13 个 ○ 淹没 4 条真实裁决 ⇒ **看起来像"什么都没跑"**。
 *
 * ★★★ 而"看起来什么都没跑"是**误导**：它**不是没跑**，是**其余段的结果不落盘**
 *   —— 那是甲方案的已知边界（只有 `completion` 段写 `task.gateEvaluation`）。
 *
 * ⇒ 所以切成两块，且**两块的措辞必须不同形**：
 *   · `ran`    —— 这一轮**真的**有裁决（`hasVerdicts`），逐条列出；
 *   · `silent` —— **没有落盘读数**，折叠成一行计数（**不是**"没跑"）。
 *
 * ★ 空段（`rows.length === 0`）**两块都不进** —— `admission 0 条` 不显示。
 *   而"不显示"与"显示 0 条"必须不同形：后者会让人以为那个位置**该有**判据却没有。
 *
 * ★ `hasVerdicts` 才是"有没有裁决"的**唯一**判据 —— 不是 `rows.some(r => r.state === 'passed')`：
 *   一个"跑了 4 条、全部 unmeasured"的段**有裁决**（只是结论不好看），
 *   按状态去推会把它错读成"没有读数"（实测变异体 M7 钉住这一点）。
 * @param groups - every stage group derived for this row.
 * @returns the two blocks, each in flow order.
 */
export function splitStageGroups(groups: readonly StageGroupView[]): {
  readonly ran: readonly StageGroupView[]
  readonly silent: readonly StageGroupView[]
} {
  const nonEmpty = groups.filter((group) => group.rows.length > 0)
  return {
    ran: nonEmpty.filter((group) => group.hasVerdicts),
    silent: nonEmpty.filter((group) => !group.hasVerdicts),
  }
}

/** Total criteria across one block of stage groups. */
export function stageGroupCount(groups: readonly StageGroupView[]): number {
  return groups.reduce((total, group) => total + group.rows.length, 0)
}

/**
 * ── ★★★ v4：一根判据的**全部阶段分组**（展开态画的就是这个）────────────────────
 *
 * 规格 §5：按**阶段**分组，每段给整段形状 + 逐条 `id` + `description`。
 *
 * ★★ **甲方案的边界落在这里**（与 `stageGateRows` 同一条纪律）：
 *   只有 `completion` 段有落盘裁决 ⇒ 其余段**逐条只能是 ○/·**，
 *   绝不许从别处推一个 `✓` 出来。`hasVerdicts` 就是那条边界的**可读标记**。
 *
 * ★ 目录（`catalog`）来自 `/state` 的 `gateCatalog` —— 它是**每份快照都带**的
 *   静态清单，于是"换掉一条判据 ⇒ UI 自动跟着变"（可插拔）。
 * @param stage - the stage this member's current task is in, or undefined.
 * @param catalog - the registered criteria for every stage.
 * @param evaluation - the completion-stage verdicts, when the wire carried them.
 * @returns one group per stage, in flow order; `rows` is empty for empty stages.
 */
export function stageGroups(
  stage: FlowStage | undefined,
  catalog: readonly { readonly point: string; readonly gates: readonly { readonly id: string; readonly description: string; readonly observing: boolean }[] }[],
  evaluation: unknown,
  /**
   * ── ★★ t81：按**段**的落盘裁决（`TeamTask.gateEvaluations`）──────────────────────
   *
   * ★ **首选**读它；`evaluation`（S1 的单段 `gateEvaluation`）降级为
   *   **completion 段的兼容来源** —— 服务端两格在 completion 段上冗余但一致。
   * ★ `reached`：这条任务**走到过**哪些段。由 `stage`（现在在哪一段）+ 落盘事实推。
   */
  evaluations?: unknown,
): StageGroupView[] {
  const evaluationView = readEvaluationView(evaluation)
  const byPoint = readEvaluationsByPoint(evaluations)
  /**
   * ★★ 「走到了吗」的**机械依据**：落盘里**有这一段的键**，或这一段的层级是任务级
   *   而任务当前正处在它**或更后面**的段。
   * ★ 而这里刻意**不**用"有键"单一判据：`contract` 段在 `create_task` 时就落了，
   *   而一个只跑到 `dispatch` 的任务，它的 `completion` **没有键** ⇒ 应报 `notReached`
   *   （★ 反向半边 A：不许把"还没到"说成"没读数"）。
   *   ⇒ 所以用"**当前段之后**"这一点来区分：当前段**之前或就是**它 ⇒ 走到过。
   */
  const stageIndex = stage === undefined ? -1 : FLOW_STAGES.indexOf(stage)
  return catalog.map((point) => {
    const here = point.point as FlowStage
    const stageVerdicts = byPoint.get(here)
      /** ★ completion 段的兼容来源：S1 的单段字段。 */
      ?? (here === 'completion' ? evaluationView : undefined)
    const rows = stageGateRows(here, point.gates, evaluationView, stageVerdicts)
    const state = stageGroupState(here, rows, evaluationView, stageVerdicts)
    /**
     * ★ 该段**有没有**裁决：按段字段在场，或 completion 的兼容来源在场。
     */
    const hasVerdicts = stageVerdicts !== undefined
    /**
     * ★★ t81：没有裁决时，给出**成因**（四者不同形）。
     *   ★ 只在该段**没有**裁决时才算 —— 有裁决就不该报"为什么没有"。
     */
    const absence = hasVerdicts
      ? undefined
      : segmentAbsence(
          here,
          point.gates.length,
          /** ★ "走到过"= 这一段的键在落盘里，或任务当前段已经**越过**它。 */
          byPoint.has(here) || (stageIndex >= 0 && stageIndex >= FLOW_STAGES.indexOf(here)),
        )
    return { stage: here, state, hasVerdicts, absence, rows }
  })
}

/**
 * ── ★★★ t81：一段"没有裁决"的成因 → **它该说哪句话** ─────────────────────────────
 *
 * ★ 四者**不同句**（而不是四者同印一个 ○）：补救动作不同 ⇒ 措辞不许同形。
 *   · `noGate`     ⇒ 判据自己该接线（或删掉）—— **不是**任务的问题
 *   · `teamLevel`  ⇒ 去团队级/事件级的读数里看 —— **永远**不会出现在任务上
 *   · `notReached` ⇒ 等 —— 它会自己出现
 *   · `notRecorded`⇒ 想知道上一代说了什么 ⇒ 看**历史**（`executions[]`）
 * ★ 类型是 `Record<SegmentAbsence, …>` ⇒ 将来加第五种成因时，**这里编译期就红**
 *   （而不是印出一个空字符串）。
 */
const ABSENCE_LOCALE_KEY: Readonly<Record<SegmentAbsence, AgentTeamsLocaleKey>> = {
  noGate: 'member.gates.absence.noGate',
  teamLevel: 'member.gates.absence.teamLevel',
  notReached: 'member.gates.absence.notReached',
  notRecorded: 'member.gates.absence.notRecorded',
}

/** The glyph for one row, from the single table in activity-model. */
function rowGlyph(row: GateRowView): string {
  return GATE_GLYPH[row.state]
}

/**
 * ── ★★★ v4：行 2 的"**在做什么测试**" ──────────────────────────────────────────
 *
 * ★ 规格 §3：测试段来自 `registry.list()[该段]` 的 **id 后缀**。
 *   取后缀而不是整条 id：整条 `completion.mutation` 在行 2 上太长，
 *   而后缀 `mutation` 才是"哪一条测试"的可读部分 —— 完整 id 留在 `title` 上。
 *
 * ★★ 而"在跑哪一条"**优先取**逐条里 `running` 的那条：
 *   一句"completion 段 · mutation"里的 `mutation` 若与正在跑的那条无关，
 *   读者会以为整段都在跑它。都没有在跑 ⇒ 退回**第一条**（该段有判据可报）。
 *
 * ★ 该段**没有**判据 ⇒ 返回 `''`（行 2 就不出这一段，而不是印一个空占位）。
 * @param group - the stage group the member's current task is in.
 * @returns the short test label, or '' when the stage has no criteria.
 */
function testLabelOf(group: StageGroupView): string {
  if (group.rows.length === 0) return ''
  const running = group.rows.find((row) => row.state === 'running')
  const chosen = running ?? group.rows[0]!
  /** ★ id 形如 `completion.mutation` ⇒ 取最后一个点号之后那一段。 */
  const parts = chosen.id.split('.')
  return parts[parts.length - 1] ?? chosen.id
}

/**
 * The stage a member's row should report: the one its **current task** is in.
 *
 * ★ 用 `current`（`currentTask` 解析出来的那条），缺席时退回名下第一条非终结任务 ——
 *   与 `memberDoingText` 的口径同源，否则"在做什么"与"在哪个阶段"会指向两条任务。
 * @param current - the resolved current task, when there is one.
 * @param owned - every task assigned to this member.
 * @returns the stage, or undefined when the spec says to omit it.
 */
function currentStage(current: MemberRowTask | undefined, owned: readonly MemberRowTask[]): FlowStage | undefined {
  const task = current ?? owned.find((candidate) => candidate.status !== 'completed' && candidate.status !== 'failed' && candidate.status !== 'cancelled')
  if (task === undefined) return undefined
  const hasEvaluation = (task as { readonly gateEvaluation?: unknown }).gateEvaluation !== undefined
    && (task as { readonly gateEvaluation?: unknown }).gateEvaluation !== null
  return taskStage(task.status, hasEvaluation)
}

/**
 * Widen the wire's raw gate field into the view the stage helpers read.
 *
 * ★ 复用 `memberGateReadouts` 的**同一个**解析口径（它已经处理了"字符串 / 对象 /
 *   读不出"三种到达方式）—— 不在这里写第二份，否则两处会漂移。
 * @param raw - the raw `gateEvaluation` field.
 * @returns the parsed view, or undefined when unreadable/absent.
 */
function readEvaluationView(raw: unknown): Parameters<typeof stageGroupState>[2] {
  if (raw === undefined || raw === null || raw === '') return undefined
  const readout = memberGateReadouts([{ id: 'probe', gateEvaluation: raw }]).get('probe')
  if (readout === undefined || readout.state !== 'verdict') return undefined
  return readout.evaluation
}

/**
 * ── ★★ t81：把按段字段（`gateEvaluations`）解析成 `段 -> 裁决视图` ─────────────────
 *
 * ★ **逐段解析、逐段独立**：某一段解析失败**只影响那一段**（它退回"没有裁决"），
 *   而**不许**让一整条任务的六段一起塌掉 —— 那会把"这一段坏了"读成"全都没跑"。
 *
 * ★★ 缺席与空**不同形**：
 *   · 键**不在** ⇒ 该段**没有落盘**（成因由 `segmentAbsence` 再细分）；
 *   · 键在、而值是空/坏 ⇒ 解析不出视图 ⇒ **同样算"没有裁决"**（不编一个 `ok`）。
 *   ★ 两者在这里**合流成"没有裁决"是对的** —— 因为本函数只回答"有没有可渲染的裁决"，
 *     而"为什么没有"由 `segmentAbsence` 单独回答（那是**另一个问题**，见它的注释）。
 *
 * @param raw - the raw `gateEvaluations` field off the task, when the wire carried it.
 */
function readEvaluationsByPoint(raw: unknown): ReadonlyMap<FlowStage, Parameters<typeof stageGroupState>[3] & object> {
  const out = new Map<FlowStage, NonNullable<Parameters<typeof stageGroupState>[3]>>()
  if (raw === undefined || raw === null || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(FLOW_STAGES as readonly string[]).includes(key)) continue
    const view = readEvaluationView(value)
    if (view !== undefined) out.set(key as FlowStage, view)
  }
  return out
}

/**
 * What this member is doing right now, in one line.
 *
 * ★ Every branch says *something*: a member with no current task reads a sentence
 *   rather than an empty line, because "this cell has nothing" and "this member has
 *   nothing to do" must not look the same.
 *
 * ── ★★★ D12：句子**不只一句**（用户从截图发现的缺陷）──────────────────────────
 *
 * MEASURED：改前这里只有一个兜底 `return`，于是**四种情形同形**。用户截图里
 * 决定性的一对照 —— `ui-engineer`（完成 0 · 失败 1）与 `ui-dissect`（完成 12 ·
 * 失败 3）主行**都是**「等待队长派工」。而这两件事的处置**相反**：
 *   · 有历史（做完了在等下一件）⇒ 队长**欠它**一个任务；
 *   · 无历史（生成后没派过活）  ⇒ 它**还没参与过**。
 *
 * ★ 纪律与紧邻的注释同源：**"空 vs 非空"防住了，"干完了 vs 没开始"没防住。**
 *   所以这里必须**四种不同形**，而不是"有任务 / 没任务"两分。
 * @param member - the member row.
 * @param current - the member's task that `currentTask` names, when it resolves.
 * @param owned - every task assigned to this member.
 * @param t - locale lookup.
 */
export function memberDoingText(
  member: MemberRowMember,
  current: ActivityTask | undefined,
  owned: readonly ActivityTask[],
  t: AgentTeamsTranslate,
): string {
  if (current !== undefined) {
    const subject = current.subject.replace(/^开发\s*/u, '').trim()
    return subject === ''
      ? t('member.doing.task', { taskId: current.id })
      : t('member.doing.taskSubject', { taskId: current.id, subject })
  }
  if (member.activity === 'working') return t('member.status.working')
  const history = memberHistoryState(owned)
  if (history === 'open') {
    const open = owned.filter((task) => task.state !== 'completed' && task.state !== 'failed' && task.state !== 'cancelled')
    return t('member.doing.task', { taskId: open[0]!.id })
  }
  /**
   * ★ 下面三句**必须**互不相同 —— "拆开了"与"拆了个恒等的"在屏幕上同形，
   *   而反向半边 A/B 就是用来挡住后者的（见 docs/D12-STATUS-COLLAPSE.md）。
   */
  if (history === 'failed') {
    return t('member.status.awaitingRedispatch', { taskId: latestTerminalId(owned) })
  }
  if (history === 'finished') {
    return t('member.status.awaitingAssignment', { taskId: latestCompletedId(owned) })
  }
  return t('member.status.waitingAssignment')
}

/** Id of the newest terminal task owned by this member (D12's failure line). */
function latestTerminalId(owned: readonly ActivityTask[]): string {
  const terminal = owned.filter((task) => task.state === 'completed' || task.state === 'failed' || task.state === 'cancelled')
  return latestOwnedTask(terminal)?.id ?? ''
}

/**
 * Id of the newest **completed** task owned by this member (D12's finished line).
 *
 * ★ 单独取 completed，而不是"最新那条终结任务"：最新那条可能是 cancelled，
 *   而"已完成 tN · 待派工"里的 tN 必须是**真的完成了的那个**，
 *   否则这句话会把一件被取消的任务说成已完成。
 */
function latestCompletedId(owned: readonly ActivityTask[]): string {
  const completed = owned.filter((task) => task.status === 'completed')
  return latestOwnedTask(completed)?.id ?? ''
}

/**
 * What one subagent is doing, in one line.
 *
 * ★ The host hands the raw session status through; an unrecognised value reads
 *   "状态未知" instead of being rounded to "工作中".
 * @param subagent - one live subagent from the /state payload.
 * @param t - locale lookup.
 */
export function subagentDoingText(subagent: MemberSubagent, t: AgentTeamsTranslate): string {
  const tone = subagentTone(subagent.status)
  if (tone === 'working') return t('subagent.doing.working')
  if (tone === 'idle') return t('subagent.doing.idle')
  return t('subagent.doing.unknown', { status: subagent.status })
}

/** Locale key for one elapsed readout's inline label (used by the row's aria text). */
const CLOCK_LABEL: Readonly<Record<MemberClockKind, 'member.clock.working' | 'member.clock.waiting' | 'member.clock.idle' | 'member.clock.unknown'>> = {
  running: 'member.clock.working',
  stale: 'member.clock.waiting',
  idle: 'member.clock.idle',
  unknown: 'member.clock.unknown',
}

/**
 * Locale key for one round tone.
 *
 * ★ Typed against {@link AgentTeamsLocaleKey} rather than `string` so a typo is
 *   a typecheck failure, not a key that silently renders as its own id.
 */
const ROUND_TONE_LABEL: Readonly<Record<LoopTone, AgentTeamsLocaleKey>> = {
  converging: 'round.tone.converging',
  failed: 'round.tone.failed',
  unmeasured: 'round.tone.unmeasured',
  running: 'round.tone.running',
  open: 'round.tone.open',
  blocked: 'task.status.claimed',
  completed: 'round.tone.completed',
  cancelled: 'task.status.cancelled',
}

export type MemberRowProps = {
  readonly team: ActivityTeam
  readonly member: MemberRowMember
  /**
   * ★ S3：宽到 {@link MemberRowTask} —— 它需要读 `gate_evaluation`（status 工具
   *   序列化后的那一格），而 `ActivityTask` 尚未声明它。ActivityTask 兼容 widening，
   *   所以既有调用方（`MemberScreen` 传 `team.tasks`）**一行不用改**。
   */
  readonly tasks: readonly MemberRowTask[]
  /**
   * ★ 模型这一格由**调用方**算好交进来（面板用 `memberRouteLabel` 算一次）。
   *   判定口径只有一份：这里只负责**画**。
   */
  readonly memberModel?: string
  /** `memberModelEditability` 的三态读数，同样由调用方算好。 */
  readonly memberModelEditable?: 'editable' | 'sealed' | 'unknown'
  readonly expanded: boolean
  readonly onToggle: (key: string) => void
  readonly onOpenSubagent: (childId: string) => void
  readonly onSelectTask?: (id: string | null) => void
  readonly modelDirectory?: ModelDirectory
  readonly t: AgentTeamsTranslate
  readonly historic?: boolean
  readonly discarded?: boolean
  readonly stopped?: boolean
  /** Frozen observation instant; when omitted the clock owns a real timer. */
  readonly frozenNow?: number
}

/** One registered stage of the forwarded criterion catalog. */
export interface MemberGateCatalogEntry {
  readonly point: string
  readonly registered: number
  readonly gates: readonly { readonly id: string; readonly description: string; readonly observing: boolean }[]
}

/**
 * ── ★★★ v4：从团队快照里读**判据清单**（转发过来的那一格）──────────────────────
 *
 * ★ 这是"**可插拔**"的落点：UI **不硬编码**任何判据名，只读 `id` + `description`。
 *   换掉一条判据（改 `src/gates/**`）⇒ 两者都变 ⇒ UI 自动跟着变，不用改代码。
 *
 * ★ **结构化读取**而不是给 `ActivityTeam` 加字段：`activity-monitor.ts` **不在**
 *   本任务的写域里（与 `MemberRow.tsx` 上 `subagents` / `round` 同一条先例 ——
 *   面板读**线上真的有的**字段，等基类追上来时这个别名自然收敛）。
 *
 * ★ **缺席**（老快照没有这一格）⇒ 空数组 ⇒ 展开层报"读不到判据清单"。
 *   这与"注册了 0 条"**不同形** —— 前者是"我没读到"，后者是"确实没有"。
 * @param team - the team snapshot as it arrived on the wire.
 * @returns the catalog entries, or an empty array when the wire omitted them.
 */
function gateCatalogOf(team: ActivityTeam): readonly MemberGateCatalogEntry[] {
  const raw = (team as { readonly gateCatalog?: unknown }).gateCatalog
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is MemberGateCatalogEntry => (
    typeof entry === 'object' && entry !== null
    && typeof (entry as { readonly point?: unknown }).point === 'string'
    && Array.isArray((entry as { readonly gates?: unknown }).gates)
  ))
}

/**
 * One member row: identity, model, current work, elapsed state; expansion
 * reveals the live subagents underneath it.
 */
export function MemberRow({
  team, member, tasks, expanded, onToggle, onOpenSubagent, onSelectTask,
  modelDirectory, t, historic = false, discarded = false, stopped = false, frozenNow,
  memberModel: memberModelProp, memberModelEditable: editableProp,
}: MemberRowProps) {
  const key = memberRowKey(member)
  const owned = tasks.filter((task) => task.assignee === member.name)
  const current = owned.find((task) => task.id === member.currentTask)
  const memberModel = memberModelProp ?? memberRouteLabel(member)
  const editable = editableProp ?? memberModelEditability(member)
  const clock = memberClock(member, tasks as readonly ClockTask[], frozenNow ?? Date.now())
  const stamp = clock.stamp ?? memberClockStamp(member, tasks as readonly ClockTask[])
  const round = memberRound(owned as readonly LoopTask[])
  const subs = memberSubagentReadout(member)
  /**
   * ★★ 判据清单**就地**从 `team` 上读 —— 不由调用方当 prop 传进来。
   *
   * ── 为什么（这是**写域**上的约束，不是风格偏好）────────────────────────────────
   *
   * 我第一版把它做成 prop，于是必须改 `MemberScreen.tsx` 去传 —— 而
   * **`MemberScreen.tsx` 不在本任务的 `inScope` 里**（闸门当场拒了，它是对的）。
   * ★ 而**就地读更好**：本行已经拿到了 `team`（它就在 props 上），再要调用方
   *   把 `team` 里的同一格拆出来单独传一遍是**多余的一跳**，而且多一个会漂移的接口。
   */
  const catalog = gateCatalogOf(team)
  const dotTone = memberDotTone(member, { discarded, stopped, staged: team.phase === 'staged', historic })
  /**
   * ── ★★★ "它在做什么"，以及**三态下的终态口径**（原来长在面板里）─────────────
   *
   * ★ 一条被放弃的计划里的成员**不是**"待执行"：它**根本不会被创建**。
   *   MEASURED 的判据见 locales 的 `member.status.discarded` /
   *   `member.status.stopped` —— 两条文案说的都是"这一行不会再有下一步了"，
   *   而"待执行"会让读者以为它在排队。
   * ★ 计划待确认（`staged`）同样有自己的口径：它尚未被创建。
   */
  const doing = discarded
    ? t('member.status.discarded')
    : stopped
      ? t('member.status.stopped')
      : team.phase === 'staged'
        ? t('member.status.staged')
        : memberDoingText(member, current, owned, t)
  /**
   * ── ★★★ v4（甲）：行 2 = `第 N 轮 · 阶段 · 测试` ──────────────────────────────
   *
   * ★ 阶段**从任务状态推出**（`taskStage`），测试名从**转发过来的判据清单**里取 ——
   *   两处都不硬编码，于是换掉一条判据 ⇒ 行 2 自动跟着变（可插拔）。
   * ★ 候选按优先级排好（先省"测试"，再省"阶段"），渲染层取第一个放得下的。
   */
  const stage = currentStage(current, owned)
  const groups = stageGroups(
    stage,
    catalog,
    current?.gateEvaluation,
    /** ★★ t81：按段字段（首选读法）。 */
    (current as { readonly gateEvaluations?: unknown } | undefined)?.gateEvaluations,
  )
  const stageGroup = stage === undefined ? undefined : groups.find((group) => group.stage === stage)
  const testLabel = stageGroup === undefined ? '' : testLabelOf(stageGroup)
  /**
   * ★★★ t80 缺陷①：轮次**在这里、且只在这里**渲染一次。
   *
   * ★ 经 `t('member.round.mark')` 而不是硬编码「第 N 轮」两步好处：
   *   · 这个词条仍是轮次的**唯一**出处（臂 25b 逐字钉住它出现在**本行**里）；
   *   · 缺席（没有带轮次的任务）⇒ `''` ⇒ **整段不出现**，而不是印"第 0 轮"
   *     （"没有轮次概念"与"第 0 轮"必须不同形）。
   */
  const roundLabel = round === undefined ? '' : t('member.round.mark', { round: round.round })
  /**
   * ★★ `doingLineCandidates` 内部硬编码了 `第 N 轮`（它在 `activity-model.ts` 里，
   *   **不在本任务写域**）⇒ 这里把那一小段**替换**为词条渲染的结果。
   *   MEASURED：不替换的话臂 25b 会红 —— 它逐字断言 `member.round.mark:2`
   *   出现在**本行**的渲染结果里，而硬编码那串**绕开了词条**。
   * ★ 只在行首匹配（`startsWith`），不会误伤任务名里恰好含同样字样的情形。
   */
  /**
   * ★★ 替换的是候选**首段**（第一个 ` · ` 之前那段）—— 而不是 `startsWith('第 N 轮')`：
   *   词条渲染出来的是 `t('member.round.mark', …)` 的结果，它在真实 locale 下正好是
   *   「第 N 轮」，但在**夹具的 t 桩**下是 `member.round.mark:2` ⇒ 按字面 startsWith 匹配
   *   会**匹配不上、静默不替换**（而"没替换"与"替换了"在屏幕上同形 —— 正是本仓纪律
   *   要挡的那种）。⇒ 按**位置**（首段）替换，与文案无关。
   */
  const line2 = roundLabel === ''
    ? doingLineCandidates(round?.round, stage, testLabel)
    : doingLineCandidates(round?.round, stage, testLabel).map((candidate) => {
      const separator = candidate.indexOf(' · ')
      return separator === -1 ? roundLabel : `${roundLabel}${candidate.slice(separator)}`
    })
  /**
   * ★★★ t80 缺陷②：把分组切成「本轮真跑了的」与「没有落盘读数的」两块。
   *   ★ 读数在**渲染期之外**算（纯函数）⇒ 两块的分辨力可以被独立检验，
   *     而不是藏在一个组件的分支里。
   */
  const split = splitStageGroups(groups)
  const toggle = useCallback(() => { onToggle(key) }, [key, onToggle])

  return (
    <div
      className={css.memberBlock}
      data-activity={member.activity}
      data-member-key={key}
      data-member-expanded={expanded ? 'true' : 'false'}
      /**
       * ★★ 旧探针 `data-member-gate-tone` 的别名（见 `memberGateTone` 的注释）：
       *   改前它长在那个"一句话裁决"的 band 上；v4 把那句话换成**阶段分组**，
       *   于是同一个 tone 改由"当前那一段的形状"推出 —— 探针名与词表都不变。
       */
      data-member-gate-tone={memberGateTone(stage, groups)}
    >
      {/**
        * ★ 一行 = 一个按钮：点击**展开/收起**（用户要的"点开一个成员看它底下的子代理"）。
        *   打开成员会话的入口移到展开层里，于是"展开"与"跳转"不再抢同一个点击 ——
        *   原来点这一行会**直接离开面板**，那让"看它底下的东西"根本无从谈起。
        */}
      <button
        type="button"
        className={css.memberRow}
        data-activity={member.activity}
        data-member-toggle={key}
        aria-expanded={expanded}
        onClick={toggle}
      >
        {/**
          * ★★★ v4：**唯一保留的图元**是这一颗 3.5px 状态点。
          *   它是**信息**（liveness 三态），不是装饰 —— 所以它留下，
          *   而头像/立绘/徽章（纯装饰）按用户裁定整块去掉。
          *
          * ★ 读 liveness **先于** activity：`activity` 是持久字段，
          *   会话死了它仍说 `working` —— 那正是 t4 要移除的残留读数。
          */}
        <span
          className={css.memberDot}
          data-tone={dotTone}
          role="img"
          aria-label={t(CLOCK_LABEL[clock.kind], { elapsed: '' })}
        />
        <span className={css.memberInfo}>
          <span className={css.memberLine}>
            <span className={css.memberName}>{member.name}</span>
            {/**
              * ── ★★ `data-unread`：**头像去掉了，但这个事实不能跟着丢**──────────────
              *
              * 改前它长在 `memberAvatar` 上（`data-unread={member.unread > 0}`）——
              * 而那一整块被用户裁定去掉（它是装饰）。但"这个成员有未读"是一个
              * **读数**，不是装饰 ⇒ 它必须留在**行**上。
              * ★ 本仓纪律：去掉一块**装饰**不许顺手丢掉一个**事实** ——
              *   而臂 27 正是逐条比对这个的（`data-*` 一个都不许无声消失）。
              */}
            {member.unread > 0 && <span className={css.memberUnread} data-unread="true" aria-hidden />}
            {member.role !== '' && <span className={css.memberRole}>{member.role}</span>}
            {/**
              * ── ★★ 模型：**行内文字**，不是徽章（用户投诉的 "badge-like elements"）────
              *
              * ★ v4 **保留**这一格：用户裁定去掉的是"**徽章**"（`:463` 之前那个药丸形状），
              *   而这里从那时起就已经是行内文字（`compactModelLabel` 只印末段）。
              *   它回答的是"它跑在哪个路由上" —— 一个**读数**，不是装饰。
              * ★ 完整路由留在 `title` / `aria-label` / `data-member-model` 上，
              *   可见的只有末段（不许撑破面板）。臂 25a / 26 逐字钉住这四点。
              */}
            {memberModel !== '' && (
              <span
                className={css.memberModel}
                role="img"
                data-member-model={memberModel}
                data-member-model-state={editable}
                title={editable === 'sealed' ? t('member.model.sealedReason') : memberModel}
                aria-label={memberModel}
              >
                {compactModelLabel(memberModel)}
              </span>
            )}
            {/**
              * ── ★ v4：状态短语**移到行 1 的右端**（规格 §3 的"行 1 = 名字 + 状态短语"）──
              *   字数最多的两格（状态短语、行 2）因此各占一行，不再互相挤。
              */}
            <span className={css.memberStatusLine} title={doing}>{doing}</span>
            <span className={css.memberStatusTail}>
              {/* ★ 时长：**它自己**拥有秒表（见 MemberClock），本行不持有 now。 */}
              <MemberClock kind={clock.kind} stamp={stamp} frozenNow={frozenNow} t={t} />
            </span>
            <IconChevronDownOutline14 />
          </span>
          {/**
            * ── ★★★ v4 行 2：`第 N 轮 · 阶段 · 测试` ────────────────────────────────
            *
            * ★ 三段**按优先级组装**，`data-line2-level` 如实标出用的是第几档候选
            *   （0 = 最全）—— 于是"截断了没有、截掉了哪一段"是**可读的**，
            *   而不是要靠量宽度才知道。
            *
            * ── ★★★ t80 缺陷①：**这一行现在是"第 N 轮"的唯一出处** ─────────────────
            *
            * MEASURED（用户截图）：「第几轮是重复的，有两个」—— 改前**两块**都印轮次：
            *   · 本行（`memberStageLine`）印 `第 N 轮 · 阶段 · 测试`
            *   · 下面那个 `memberRoundLine` 又印一次 `第 N 轮` + 「本轮已完成」
            * ⇒ 同一个事实印两遍。
            *
            * ★ 修法不是删掉旧块（它**不是纯冗余**：含可点的任务 id 按钮），
            *   而是**把按钮并进来**、把旧块里**重复的那两句**删掉。
            *   于是：轮次说**一次**，任务 id 仍然可点 —— 一个事实一个出处。
            */}
          <span className={css.memberStageLine} data-line2={line2[0]} data-line2-level={0}>
            {line2[0]}
            {/**
              * ★★ 任务 id 按钮：从旧 `memberRoundLine` **并入**这里。
              *   点它 ⇒ `onSelectTask(id)`（跳到那条任务）—— 这个功能不许随重复文字一起消失。
              */}
            {round !== undefined && round.tasks.length > 0 && (
              <span
                className={css.memberStageTasks}
                /**
                 * ★★ `data-member-round` 与 `data-tone` 两个探针**原样保留**（臂 27 依赖）：
                 *   它们原来长在 `memberRoundLine` 那个 `<div>` 上，现在长在这里 ——
                 *   位置变了，事实与探针名都没变。
                 */
                data-member-round={round.round}
                data-tone={discarded ? 'cancelled' : round.tone}
              >
                {round.tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={css.memberRoundTask}
                    data-tone={discarded ? 'cancelled' : task.round === undefined ? 'open' : round.tone}
                    onClick={(event) => {
                      /** ★ 这一行整体是个展开/收起的 `<button>` ⇒ 必须拦住冒泡，否则点任务会顺带折叠。 */
                      event.stopPropagation()
                      onSelectTask?.(task.id)
                    }}
                    title={`${task.id}`}
                  >
                    {task.id}
                  </button>
                ))}
              </span>
            )}
          </span>
        </span>
      </button>

      {/* ★ t16：可就地改模型的成员 —— 复用**既有**选择器，不是第二份。 */}
      {editable === 'editable' && modelDirectory !== undefined && !discarded && !stopped && team.phase !== 'staged' && (
        <div style={MEMBER_MODEL_LINE_STYLE} data-member-model-editable>
          <MemberModelField
            team={team}
            member={member}
            modelDirectory={modelDirectory}
            disabledReason={undefined}
            t={t}
          />
        </div>
      )}

      {/**
        * ── ★★★ t80 缺陷①：**旧轮次块已被删除**（用户截图：「第几轮是重复的，有两个」）──
        *
        * 它原来在这里印 `第 N 轮` + 「本轮已完成」+ 任务 id 按钮，而"第 N 轮"与
        * 上面第 2 行**逐字重复** ⇒ 同一个事实两个出处。用户看出来了。
        *
        * ★ 而它不是**纯**冗余：任务 id 按钮（可点、跳任务）与两个探针
        *   （`data-member-round` / `data-tone`，臂 27 依赖）都从它来 ——
        *   所以修法是**把它们并进第 2 行**，而不是"看到重复就删掉整块"。
        *
        * ★ 净效果：轮次说**一次**，任务 id 仍可点，两个探针仍在。
        */}

      {expanded && (
        <div className={css.memberSubagents} data-member-subagents={key}>
          {/**
            * ★ 窄面板把角色和模型从成员行上拿掉，完整值在这里换行显示。
            *   收起时被省略的"正在做什么"也在展开层里给全文，不靠 title 才能读完。
            */}
          <div className={css.memberExpandedFacts}>
            {member.role !== '' && <span className={css.memberExpandedRole}>{member.role}</span>}
            {memberModel !== '' && <span className={css.memberExpandedModel}>{memberModel}</span>}
            <span className={css.memberExpandedDoing}>{doing}</span>
          </div>
          {/**
            * ── ★★★ v4 展开层：**按阶段分组**（规格 §5）────────────────────────────
            *
            * 用户要看的第二件是"**他在做什么测试**"，而"这些测试信息需要是可插拔的"。
            * 所以这一段**不硬编码任何判据名**：分组的骨架来自转发过来的 `gateCatalog`，
            * 逐条的 `id` + `description` 直接印出来 ⇒ 换掉一条判据，界面自动变。
            *
            * ── ★★★ t80 缺陷②：**两块，不是一个平铺列表**（用户：「展开详情之后会很杂乱」）
            *
            * MEASURED：`gateEvaluation.ran` 只有 **4 条**（全在 completion 段），
            * 而改前把 `registry.list()` 的**全部 17 条**平铺出来 ⇒ 其余 13 条是 ○
            * ⇒ 13 个 ○ 淹没 4 条真实裁决 ⇒ **看起来像"什么都没跑"**。
            *
            * ★★ 而那是**误导**：其余段**不是没跑，是结果不落盘**（甲方案边界）。
            * ⇒ 拆成两块，且**两块的措辞不同形**：
            *   · 上块 `ran`    —— 「本轮跑了 N 条判据」，逐条列；
            *   · 下块 `silent` —— 「其余 N 条在别的段 —— **本轮没有落盘读数**」，
            *     折叠成**一行**计数（★ 不许逐条列 13 个 ○）。
            *
            * ★★★ 两条反向半边仍然落在这里：
            *   · **A** —— 目录缺席 ⇒ 报"读不到清单"，**一个 ✓ 都不印**；
            *   · **B** —— `skippedAll` 在场 ⇒ ⊘（且与 ○ **不同色**），**绝不是 ✓**。
            */}
          {catalog.length === 0 ? (
            <span className={css.memberGateNote} data-member-gates={key} data-member-gates-readout="no-catalog">
              {t('member.gates.noCatalog')}
            </span>
          ) : (
            /**
              * ★ 空段（`rows.length === 0`）**两块都不进** ⇒ `admission 0 条` 不显示
              *   （规格硬约束 4）。而"不显示"与"显示 0 条"不同形 —— 后者会让人以为
              *   那个位置该有判据却没有。
              */
            <div className={css.memberStageBlocks} data-member-gates={key}>
              {/* ── 上块：本轮**真的**跑了的 ─────────────────────────────────── */}
              {split.ran.length > 0 && (
                <ul className={css.memberGateList} data-gate-block="ran">
                  <li className={css.memberStageSummary} data-gate-block-summary="ran">
                    <span className={css.memberStageMark} data-stage-mark="passed">✓</span>
                    <span className={css.memberStageSummaryText}>
                      {t('member.gates.ranSummary', {
                        count: String(stageGroupCount(split.ran)),
                        stages: split.ran.map((group) => group.stage).join('、'),
                      })}
                    </span>
                  </li>
                  {split.ran.map((group) => (
                    <li
                      key={group.stage}
                      className={css.memberStageGroup}
                      data-member-stage={group.stage}
                      /**
                       * ★★ 三个**旧探针**在这里以别名保留（臂 27 逐条比对 `data-*`）：
                       *   `data-member-gate` / `-state` / `-readout` 原来长在那个
                       *   "一句话裁决"的 band 上，而 band 被 v4 的**阶段分组**取代。
                       *   ⇒ 事实没丢（段的形状还在），只是换了一层承载 ——
                       *     所以这里如实给出同名探针，而不是让它们**无声消失**。
                       */
                      data-member-gate={key}
                      data-member-gate-state={group.state}
                      data-member-gate-readout={group.hasVerdicts ? 'verdict' : 'registered'}
                      data-member-stage-state={group.state}
                      data-stage-state={group.state}
                      data-stage-has-verdicts={group.hasVerdicts ? 'true' : 'false'}
                      /**
                       * ── ★★★ t81：一段"**没有裁决**"的**成因**（四者不同形）────────────────
                       *
                       * ★ `absence` 只在**没有裁决**时在场（有裁决 ⇒ 不报"为什么没有"）。
                       * ★★ 这一格是**可机读**的判别面 —— 与 `data-member-gate-state` 同一条纪律：
                       *   读取端不该靠措辞去猜这段属于哪一种"没有"。
                       *   ★ 而这正是本仓记账最久的形态的**落点**：
                       *     没有这一格时，「真的没判据」「不是任务级」「还没走到」「这一代没记」
                       *     **在 DOM 上同形**（都是一个 ○）。
                       */
                      data-stage-absence={group.absence ?? 'none'}
                    >
                      <span className={css.memberStageHead}>
                        <span className={css.memberStageMark} data-stage-mark={group.state}>{GATE_GLYPH[group.state]}</span>
                        <span className={css.memberStageName}>{group.stage}</span>
                        <span className={css.memberStageCount}>
                          {/**
                            * ★★ t81：**没有裁决**时，显示的是**成因**，不是"N 条判据" ——
                            *   因为"这一段有几条判据"与"为什么它没有裁决"是**两个问题**，
                            *   而后者才是读者此刻要的。
                            * ★ 有裁决 ⇒ 照旧报条数（`member.gates.count`）。
                            */}
                          {group.absence === undefined
                            ? t('member.gates.count', { count: String(group.rows.length) })
                            : t(ABSENCE_LOCALE_KEY[group.absence])}
                        </span>
                      </span>
                      <StageRows rows={group.rows} />
                    </li>
                  ))}
                </ul>
              )}

              {/* ── 下块：**没有落盘读数**（★ 不是"没跑"）─────────────────────── */}
              {split.silent.length > 0 && (
                <ul
                  className={css.memberGateList}
                  data-gate-block="silent"
                  /**
                   * ★★ 这一格的 `data-*` 名就是**判据**：它说"这里没有落盘读数"，
                   *   而不是"这些判据没跑"。两者在报告里必须不同形。
                   */
                  data-gate-readout-absent={String(stageGroupCount(split.silent))}
                >
                  <li className={css.memberStageSummary} data-gate-block-summary="silent">
                    <span className={css.memberStageMark} data-stage-mark="registered">○</span>
                    <span className={css.memberStageSummaryText}>
                      {t('member.gates.silentSummary', { count: String(stageGroupCount(split.silent)) })}
                    </span>
                    {/**
                      * ★★ 逐段给一行计数，**用 `member.gates.noVerdicts`** ——
                      *   它逐字说的就是"结果不落盘"，正是这一块的语义。
                      *   ★ 这样那个词条**仍然有人用**：一个被 v4 换掉用法的词条若只是
                      *     留在词典里没人引用，它就是新的死文案（本仓记账最久的形态之一）。
                      *   ★★ 而"逐段一行"**不是**"逐条列 ○" —— 规格硬约束 1 禁的是后者。
                      */}
                    <span className={css.memberStageSummaryDetail}>
                      {split.silent
                        .map((group) => `${group.stage} ${t('member.gates.noVerdicts', { count: String(group.rows.length) })}`)
                        .join(' · ')}
                    </span>
                  </li>
                </ul>
              )}
            </div>
          )}
          {/**
            * ★★★ 三态：`observed` + 空 ⇒ "**读了**，真的没有"；
            *   `could-not-measure` ⇒ "**没读成**"。后者必须带上成因，
            *   否则它与前者在读者眼里同形。
            */}
          {subs.state === 'could-not-measure' ? (
            <span className={css.memberSubagentNote} data-subagent-readout="could-not-measure" title={subs.reason}>
              {t('subagent.unmeasured', { reason: subs.reason ?? '' })}
            </span>
          ) : subs.subagents.length === 0 ? (
            <span className={css.memberSubagentNote} data-subagent-readout="observed-empty">
              {t('subagent.none')}
            </span>
          ) : (
            <ul className={css.memberSubagentList}>
              {subs.subagents.map((subagent) => (
                <li key={subagent.id} className={css.memberSubagent} data-subagent-id={subagent.id} data-tone={subagentTone(subagent.status)}>
                  <span className={css.memberSubagentDot} data-tone={subagentTone(subagent.status)} aria-hidden />
                  <button
                    type="button"
                    className={css.memberSubagentOpen}
                    data-subagent-open={subagent.id}
                    onClick={() => { onOpenSubagent(subagent.id) }}
                    title={subagent.id}
                  >
                    <span className={css.memberSubagentLabel}>
                      {subagent.label !== '' ? subagent.label : subagent.id}
                    </span>
                    <span className={css.memberSubagentDoing}>{subagentDoingText(subagent, t)}</span>
                  </button>
                  <span className={css.memberSubagentMode}>
                    {subagent.mode === undefined ? '' : t(subagent.mode === 'continuable' ? 'subagent.mode.continuable' : 'subagent.mode.oneShot')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className={css.memberOpenSession}
            data-member-open-session={member.id}
            disabled={member.id === ''}
            title={member.id === '' ? t('member.openSession.unavailable') : t('member.openSession')}
            onClick={() => {
              if (member.id === '') return
              onOpenSubagent(member.id)
            }}
          >
            {t('member.openSession')}
          </button>
        </div>
      )}
    </div>
  )
}

/** Exported for the panel: the session id a member's transcript lives under. */
export type MemberSessionId = SessionId

/**
 * ── ★★★ t80：一个阶段里**逐条**判据的列表 ──────────────────────────────────────
 *
 * ★ 抽成组件而不是内联，理由与 `StageRows` 这个名字同一件：**两块（ran / silent）
 *   共用同一套逐条渲染**时，抽出来才能保证"跑了的"与"没读数的"**不会各写一份**
 *   —— 而两份一定会漂移（本仓判据：「第二份实现一定会漂移」）。
 *
 * ★ 每条自带 `data-gate-state`（六态之一）与它自己的符号 ⇒
 *   "通过了 / 没跑 / 跳过了"三者在 DOM 上就是三个不同的值。
 * ★★ 旧探针 `data-verdict` / `data-observed` 以**别名**保留在这里（臂 27 逐条比对
 *   `data-*`）：逐条裁决原来印在 `memberGateEntry` 那一族上，v4 换了承载
 *   （`data-gate-state`），但**事实是同一件**。`data-observed` 只在"观察模式放过"
 *   时为 `'true'` 在场 —— 与旧处同一缺席语义（**不是 false，是不在**）。
 * @param rows - the criteria to draw, in registration order.
 */
function StageRows({ rows }: { readonly rows: readonly GateRowView[] }): JSX.Element {
  if (rows.length === 0) return <></>
  return (
    <ul className={css.memberStageRows}>
      {rows.map((row) => (
        <li
          key={row.id}
          className={css.memberStageRow}
          data-gate-id={row.id}
          data-gate-state={row.state}
          data-gate-observing={row.observing ? 'true' : 'false'}
          data-verdict={row.state === 'passed' ? 'ok' : row.state === 'skipped' ? 'skipped' : row.state === 'observed' ? 'blocked' : undefined}
          data-observed={row.state === 'observed' ? 'true' : undefined}
        >
          <span className={css.memberStageRowMark} data-gate-mark={row.state}>{rowGlyph(row)}</span>
          <span className={css.memberStageRowId} title={row.id}>{row.id}</span>
          <span className={css.memberStageRowDesc}>{row.description}</span>
        </li>
      ))}
    </ul>
  )
}
