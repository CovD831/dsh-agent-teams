/**
 * Screen one: the members, and what each of them is doing.
 *
 * ── ★★★ R4：这块内容原来内联在 `TeamSection` 的返回体里（纯搬运）─────────────────
 *
 * 用户对第一屏的口径（R2 立的）：「the first screen should show durable roles,
 * and clicking one expands to show the subagents working underneath it, together
 * with round information」。
 *
 * ★ 而它此前**没有自己的模块**：`TeamSection` 同时渲染两块屏，于是"第一屏由什么
 *   组成"只能靠读一个 1171 行的文件回答；两块屏共用一层容器网格，正是
 *   `docs/T30-LAYOUT-FINDING.md` 记下的那个布局缺陷的温床。
 *
 * ★ 这是**纯搬运**：队长行、终态提示、进度读数、成员开关与成员列表，逐块照搬，
 *   一个 `data-*` 探针、一句文案都没改。R4 的集合臂会机械核对这一点。
 * @module dsh-agent-teams/client/member-screen
 */

import { useCallback, useEffect, useState } from 'react'
import {
  memberRouteLabel,
  memberRowExpanded,
  memberRowKey,
  orderDelegationMembers,
  pruneMemberRows,
  taskModelLabel,
  toggleMemberRow,
  type MemberExpansion,
} from './activity-model.ts'
import type { ActivityMember, ActivityTask, ActivityTeam } from './activity-monitor.ts'
import type { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CaptainNode } from './CaptainNode.tsx'
import { Chevron } from './DependencyGraph.tsx'
import { MemberRow } from './MemberRow.tsx'
import { ProgressSummary } from './ProgressSummary.tsx'
import { memberModelEditability } from './StagingPlanEditor.tsx'
import type { AgentTeamsTranslate } from './locales.ts'
import css from './ActivityPanel.module.css'

/** The captain's members, and the state each one is in. */
export type MemberScreenProps = {
  readonly team: ActivityTeam
  readonly modelDirectory?: ModelDirectory
  readonly onNavigateMember: (childId: string) => void
  readonly onSelectTask: (id: string | null) => void
  readonly t: AgentTeamsTranslate
  readonly historic?: boolean
  readonly workspace?: boolean
  readonly discarded: boolean
  readonly stopped: boolean
  /** `staged` plans have not been created yet, so their copy is its own case. */
  readonly staged: boolean
  readonly awaitingFeedback: boolean
  readonly captainBusy: boolean
  readonly busyCount: number
  readonly allCompleted: boolean
  readonly allSettled: boolean
  readonly assignedCount: number
  readonly captainTaskIds: string
}

/**
 * Render screen one.
 *
 * ★ 成员的展开状态**留在这里**（而不是提到面板）：它是一个"这一屏看得怎么样"的
 *   本地读数，面板不需要知道它。而它按**成员 id** 存 —— 轮询会重排名册，
 *   按位置存会把一个成员的展开状态交给另一个成员。
 */
export function MemberScreen({
  team, modelDirectory, onNavigateMember, onSelectTask, t,
  historic = false, workspace = false, discarded, stopped, staged, awaitingFeedback,
  captainBusy, busyCount, allCompleted, allSettled, assignedCount, captainTaskIds,
}: MemberScreenProps) {
  /**
   * ★ 默认**收起**（`workspace` 时展开）：`memberRowExpanded` 对"没有条目"返回
   *   `false`，所以初值是一个**值**，不是一条缺席分支 —— 一次新渲染不可能顺手
   *   把每一行都打开。
   */
  const [membersOpen, setMembersOpen] = useState(workspace)
  const [expansion, setExpansion] = useState<MemberExpansion>(() => new Map())
  const toggleMember = useCallback((key: string): void => {
    setExpansion((current) => toggleMemberRow(current, key))
  }, [])
  /**
   * ★ 剪掉不在册的展开条目。放在 effect 里而**不是**渲染期：渲染必须是纯的。
   *   store 只在用户真的按过某一行时才有条目，所以这里剪的永远是"被重生成
   *   替换掉的那一行"留下的残条。
   */
  const rosterKey = team.members.map((member) => memberRowKey(member)).join('\u0000')
  useEffect(() => {
    setExpansion((current) => pruneMemberRows(current, rosterKey === '' ? [] : rosterKey.split('\u0000')))
  }, [rosterKey])

  const orderedMembers = orderDelegationMembers(team.members, team.tasks)
  /**
   * ★ "谁在动"这条折叠口径保留（issue #192）：收起时只列**还在动**的成员，
   *   展开时把已结束的也列出来并按结束时间倒序。原因没变 —— 一个不动的成员
   *   占着行会让"整队在不在动"这个第一问读不出来。
   */
  const runningMembers = orderedMembers.filter((member) => (
    member.activity === 'working' || member.status === 'working'
    || team.tasks.some((task) => task.assignee === member.name
      && (task.status === 'pending' || task.status === 'claimed' || task.status === 'in_progress'))
  ))
  const visibleMembers = membersOpen ? orderedMembers : runningMembers
  const hiddenFinishedCount = orderedMembers.length - visibleMembers.length
  const expandLabel = membersOpen
    ? t('members.collapse')
    : hiddenFinishedCount > 0
      ? t('members.expandFinished', { count: hiddenFinishedCount })
      : t('members.expand')

  return (
    <section className={css.delegationSection} aria-label={t('delegation.aria')} data-delegation-map>
      <CaptainNode
        discarded={discarded}
        captainBusy={captainBusy}
        busyCount={busyCount}
        allCompleted={allCompleted}
        allSettled={allSettled}
        staged={staged}
        awaitingFeedback={awaitingFeedback}
        assignedCount={assignedCount}
        captainTaskIds={captainTaskIds}
        taskCount={team.tasks.length}
        memberCount={team.members.length}
        t={t}
      />

      {/**
        * ── ★★★ 终态口径（"放弃了/停止了"**不是**"待执行"）─────────────────────
        *
        * ★ 成员行自己也会印这两句（`MemberRow`）；这一行是**团队级**的那一份，
        *   它先说话，于是下面每一行不必各自解释一次。
        */}
      {(discarded || stopped) && (
        <p className={css.teamTerminalNote} data-team-terminal={discarded ? 'discarded' : 'stopped'}>
          {discarded ? t('member.status.discarded') : t('member.status.stopped')}
        </p>
      )}

      <ProgressSummary team={team} t={t} discarded={discarded} />

      <button type="button" className={css.membersToggle} onClick={() => { setMembersOpen((current) => !current) }} aria-expanded={membersOpen} data-members-toggle>
        <span><Chevron open={membersOpen} />{t('members.toggle', { count: team.members.length })}</span>
        <span>{expandLabel}</span>
      </button>

      {(membersOpen || visibleMembers.length > 0) && <div className={css.delegationTree} data-member-rows={visibleMembers.length}>
        {team.members.length === 0 && <span className={css.emptyHint}>{t('members.empty')}</span>}
        {visibleMembers.map((member) => {
          const key = memberRowKey(member)
          /**
           * ── ★★ 面板在这一行上**探出**两件事，而不是"把它们交给子组件就算完"──
           *
           * ① `activity`：收起的成员列表要一眼看出"这一行在不在动"，
           *    而 `data-activity` 是宿主语义色（business color）挂上去的那个钩子。
           * ② `memberModel`：这个成员跑在哪个路由上 —— 用户要的第一屏是
           *    "谁在做什么"，而"用哪个模型做"是这件事的一部分。
           *
           * ★ 两格都是**读**，不是第二份真相：`MemberRow` 用的是同一个
           *   `memberRouteLabel` / `member.activity`，判定口径只有一个。
           */
          const memberModel = memberRouteLabel(member)
          /**
           * ★ "这个成员正在做什么"，到**任务 + 模型**这一层。
           *   读不出当前任务时不编一个（`member.status.working` 兜底）。
           */
          const currentTask = team.tasks.find((task) => task.id === member.currentTask
            && task.assignee === member.name)
          const doingModel = currentTask === undefined ? '' : taskModelLabel(currentTask, [member])
          const doingText = currentTask === undefined
            ? t('member.status.working')
            : doingModel === ''
              ? t('member.status.executing', { taskId: currentTask.id })
              : t('member.status.executingModel', { taskId: currentTask.id, model: doingModel })
          return (
            <div
              key={key}
              /**
               * ★ 槽的**布局类**由这一屏给：这一行有没有模型，这一层知道；
               *   而 `.memberModel` 是"就地省略号、不撑破面板"的排版口径。
               */
              className={memberModel === '' ? css.memberSlot : `${css.memberSlot} ${css.memberModel}`}
              data-activity={member.activity}
              data-member-doing={doingText}
            >
              <MemberRow
                team={team}
                member={member}
                tasks={team.tasks}
                memberModel={memberModel}
                memberModelEditable={memberModelEditability(member)}
                expanded={memberRowExpanded(expansion, key)}
                onToggle={toggleMember}
                onOpenSubagent={onNavigateMember}
                onSelectTask={onSelectTask}
                modelDirectory={modelDirectory}
                t={t}
                historic={historic}
                discarded={discarded}
                stopped={stopped}
              />
            </div>
          )
        })}
        </div>}
    </section>
  )
}

/** Re-exported so the panel keeps one import surface for the member row's types. */
export type { ActivityMember, ActivityTask }
