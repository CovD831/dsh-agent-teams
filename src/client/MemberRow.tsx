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
  latestOwnedTask,
  memberClock,
  memberClockStamp,
  memberGateReadouts,
  memberHistoryState,
  memberRowKey,
  memberRound,
  memberSubagentReadout,
  memberRouteLabel,
  subagentTone,
  type ClockTask,
  type LoopTask,
  type MemberClockKind,
  type LoopTone,
  type MemberGateReadout,
  type MemberSubagent,
} from './activity-model.ts'
import { MemberClock } from './MemberClock.tsx'
import { MemberModelField, memberModelEditability } from './StagingPlanEditor.tsx'
import { ACTION_ART, memberArtUrl } from './artwork.ts'
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

/** Initial-letter fallback for unmatched roles. */
function memberInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?'
}

function stableHash(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

const ACCENTS = [
  'var(--dsw-alias-state-business-primary)',
  'var(--dsw-alias-state-success-primary)',
  'var(--dsw-alias-state-error-primary)',
  'var(--dsw-alias-state-warn-primary)',
  'var(--dsw-alias-label-tertiary)',
] as const

function accentOf(id: string): string {
  return ACCENTS[stableHash(id) % ACCENTS.length] ?? ACCENTS[0]
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
   * ── ★ S3：该成员名下每条任务的判据裁决（精简层）──────────────────────────────
   *
   * ★ 读数在**渲染期之外**算（`memberGateReadouts` 是纯函数），这样四种答案的
   *   分辨力可以被独立检验 —— 而不是藏在一个组件的分支里。
   */
  const gates = memberGateReadouts(owned as readonly MemberRowTask[])
  const gateBand = memberGateBand(gates.get(latestOwnedTask(owned)?.id ?? ''), t)
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
  const art = memberArtUrl(member.name, member.role)
  const toggle = useCallback(() => { onToggle(key) }, [key, onToggle])

  return (
    <div
      className={css.memberBlock}
      data-activity={member.activity}
      data-member-key={key}
      data-member-expanded={expanded ? 'true' : 'false'}
    >
      <span className={css.memberBranch} aria-hidden><span /></span>
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
        <span className={css.memberAvatar} data-unread={member.unread > 0}>
          {art !== null
            ? <img className={css.memberArt} src={art} alt="" aria-hidden />
            : <span className={css.memberInitial} style={{ background: accentOf(member.id) }}>{memberInitial(member.name)}</span>}
          <img className={css.stateArt} data-activity={member.activity} src={ACTION_ART[member.activity]} alt="" aria-hidden />
        </span>
        {/**
          * ★ 第一方 16px 状态点，读 liveness **先于** activity：
          *   `activity` 是持久字段，会话死了它仍说 `working` —— 那正是 t4 要移除的残留读数。
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
            {member.role !== '' && <span className={css.memberRole}>{member.role}</span>}
            {/**
              * ── ★ S3 精简层：当前阶段裁决的一句话（默认可见）─────────────────
              *
              * ★ `data-member-gate-tone` 是四态的**机械探针**：
              *   `absent` / `skipped` / `ok` / `blocked` / `unmeasured` / `observed`
              *   —— 「读不出」与「全通过」必须落到**不同的 tone**，
              *   否则它们在报告里同形（反向半边 A）。
              */}
            {owned.length > 0 && (
              <span
                className={css.memberGateBand}
                data-member-gate-tone={gateBand.tone}
                title={gateBand.text}
              >
                <span className={css.memberGateMark}>{gateBand.mark}</span>
                <span className={css.memberGateText}>{gateBand.text}</span>
              </span>
            )}
            {/**
              * ★ 模型：**行内文字**，不再是药丸（用户投诉的"badge-like elements"）。
              *   完整路由留在 title / aria-label / data-member-model 上，可见的是末段。
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
            <IconChevronDownOutline14 />
          </span>
          <span className={css.memberStatusLine}>{doing}</span>
        </span>
        <span className={css.memberStatusTail}>
          {/* ★ 时长：**它自己**拥有秒表（见 MemberClock），本行不持有 now。 */}
          <MemberClock kind={clock.kind} stamp={stamp} frozenNow={frozenNow} t={t} />
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
        * ── ★★★ 轮次：**行内**，就在这一行上（用户原话：round data moves UP）───────
        *
        * ★ 缺席（这个成员名下没有带轮次的任务）⇒ **整块不渲染**，
        *   而不是印一个"第 0 轮" —— "没有轮次概念"与"第 0 轮"必须不同形。
        */}
      {round !== undefined && (
        <div className={css.memberRoundLine} data-member-round={round.round} data-tone={discarded ? 'cancelled' : round.tone}>
          <span className={css.memberRoundMark}>{t('member.round.mark', { round: round.round })}</span>
          <span className={css.memberRoundTone}>
            {discarded ? t('task.status.notRun') : t(ROUND_TONE_LABEL[round.tone])}
          </span>
          <span className={css.memberRoundTasks}>
            {round.tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                className={css.memberRoundTask}
                data-tone={discarded ? 'cancelled' : task.round === undefined ? 'open' : round.tone}
                onClick={() => { onSelectTask?.(task.id) }}
                title={`${task.id}`}
              >
                {task.id}
              </button>
            ))}
          </span>
        </div>
      )}

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
            * ── ★★★ S3 展开层（用户：点开成员才看【约束的体现】）────────────────
            *
            * 精简层给一句话裁决；**逐条约束**在这里 —— 这是"我们造了很多判据、
            * 做了很多约束"真正 VISIBLE 的那一层。
            *
            * ★★★ 四态在展开层同样**不合流**：
            *   · `absent`  ⇒ 「读不出」—— **不列任何判据**（列也列不出来）
            *   · `empty`   ⇒ 「⊘ 跑了 0 条 / 跳过 N 条」+ skippedAll 原文
            *   · `verdict` ⇒ 逐条 `<id> <符号>`，observed 的条目带自己的标记
            *
            * ★ 与精简层同源：两者读的是同一个 `memberGateReadouts`，
            *   不可能出现"一句话说通过、展开写着有 blocker"的分叉。
            */}
          {owned.length > 0 && (
            <ul className={css.memberGateList} data-member-gates={key}>
              {owned.map((task) => {
                const readout = gates.get(task.id)
                return (
                  <li key={task.id} className={css.memberGateItem} data-member-gate={task.id} data-member-gate-state={readout?.state ?? 'absent'}>
                    <button
                      type="button"
                      className={css.memberGateTask}
                      onClick={() => { onSelectTask?.(task.id) }}
                      title={task.id}
                    >{task.id}</button>
                    {readout === undefined || readout.state === 'absent'
                      ? <span className={css.memberGateNote} data-member-gate-readout="absent">{t('task.status.notRun')}</span>
                      : readout.state === 'empty'
                        ? (
                          <span className={css.memberGateNote} data-member-gate-readout="empty" title={readout.skippedAll ?? ''}>
                            {`⊘ 0 跑 / ${readout.registered} 跳过`}
                          </span>
                        )
                        : (
                          <span className={css.memberGateEntries}>
                            {readout.evaluation.ran.map((entry) => (
                              <span
                                key={entry.id}
                                className={css.memberGateEntry}
                                data-verdict={entry.verdict}
                                data-observed={entry.observed === true ? 'true' : undefined}
                                title={entry.observed === true ? `${entry.id} · 观察模式放过` : entry.id}
                              >
                                <span className={css.memberGateEntryMark}>
                                  {entry.verdict === 'ok' ? '✓' : entry.verdict === 'skipped' ? '⊘' : entry.verdict === 'unmeasured' ? '●' : '✗'}
                                </span>
                                <span className={css.memberGateEntryId}>{entry.id}</span>
                              </span>
                            ))}
                          </span>
                        )}
                  </li>
                )
              })}
            </ul>
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
