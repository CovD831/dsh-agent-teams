/**
 * The captain row: who is coordinating, and what it is doing right now.
 *
 * ── ★★★ R4：这是从 `ActivityPanel.tsx` 里**整块搬出来**的（纯搬运）──────────────
 *
 * 它原来长在 `TeamSection` 的返回体里（`css.captainNode` 那一块）。搬出来是因为
 * 成员屏需要它，而成员屏现在有自己的模块 —— 留在面板里会让"这一屏由谁组成"
 * 只能靠读一个 1171 行的文件回答。
 *
 * ★ 每一行、每一个 `data-*` 探针、每一句文案都原样保留：搬动不得改变渲染结果。
 *   `scripts/workspace-activity.test.mjs` 的 R4 集合臂会把这一点**机械地**核一遍。
 * @module dsh-agent-teams/client/captain-node
 */

/**
 * ★ t80：`LEAD_ART` 的 import 已删 —— 本组件不再显示队长头像。
 *   ★ **资源仍在** `artwork.ts` 里（`verify.mjs:311` 的打包契约钉着它）。
 */
import { WorkGlyph } from './DependencyGraph.tsx'
import type { AgentTeamsTranslate } from './locales.ts'
import css from './ActivityPanel.module.css'

export type CaptainNodeProps = {
  /** Which copy the summary line shows; the three states are exclusive. */
  readonly discarded: boolean
  readonly captainBusy: boolean
  readonly busyCount: number
  readonly allCompleted: boolean
  readonly allSettled: boolean
  /** `staged` plans have not been created yet, so their copy is its own case. */
  readonly staged: boolean
  readonly awaitingFeedback: boolean
  readonly assignedCount: number
  /** Already-joined captain task ids, for the takeover copy. */
  readonly captainTaskIds: string
  readonly taskCount: number
  readonly memberCount: number
  readonly t: AgentTeamsTranslate
}

/**
 * Render the captain row.
 *
 * ★ 文案的分支顺序**原样保留**：discarded > captainBusy > staged > 默认。
 *   重排它会让两张不同的读数在某些输入上换位 —— 而那正是"搬动改了行为"。
 * ★ t80：头像那一格已按用户裁定去掉（见返回体里的注释）；其余逐行未动。
 */
export function CaptainNode({
  discarded, captainBusy, busyCount, allCompleted, allSettled, staged, awaitingFeedback,
  assignedCount, captainTaskIds, taskCount, memberCount, t,
}: CaptainNodeProps): JSX.Element {
  return (
    <div className={css.captainNode}>
      {/**
        * ── ★★★ t80 缺陷③：队长头像**不再显示**（用户截图：「队长的图标还在」）────────
        *
        * ★ 删的是**显示**，不是**资源**：`artwork.ts` 的 `LEAD_ART` 原样保留 ——
        *   `team-lead-v2.png` 在 `scripts/verify.mjs:311` 的打包契约清单里，
        *   删图会红一条 **host 侧**契约（不在本任务写域）。
        * ★ 连 `css.captainAvatar` 那个空壳一起去掉：留一个空的定位容器会让网格的
        *   "头像列"仍然占位 —— 那看起来像"图没加载出来"，是另一种误导。
        *   列宽由 CSS 侧把 `grid-template-columns` 的头像列去掉来收。
        */}
      <span className={css.captainInfo}>
        <span className={css.captainLine}>
          <span className={css.captainName}>{t('captain.name')}</span>
          <span className={css.captainRole}>{t('captain.role')}</span>
        </span>
        <span className={css.captainSummary}>{discarded
          ? t('captain.summary.discarded', { tasks: taskCount, members: memberCount })
          : captainBusy
            ? t('captain.summary.withTakeover', { tasks: assignedCount, captainTasks: captainTaskIds })
          : staged
            ? t(awaitingFeedback
              ? 'captain.summary.awaitingFeedback'
              : 'captain.summary.staged', { tasks: taskCount, members: memberCount })
            : t('captain.summary', { tasks: assignedCount, members: memberCount })}</span>
      </span>
      <span className={css.captainState} data-busy={captainBusy || busyCount > 0}>
        <WorkGlyph active={captainBusy || busyCount > 0} />
        {discarded
          ? t('captain.state.discarded')
          : captainBusy
            ? t('captain.state.takeover', { tasks: captainTaskIds })
          : staged
            ? t(awaitingFeedback
              ? 'captain.state.awaitingFeedback'
              : 'captain.state.staged')
          : busyCount > 0
            ? t('captain.state.working', { count: busyCount })
            : t(allCompleted
              ? 'captain.state.collected'
              : allSettled
                ? 'captain.state.settled'
                : 'captain.state.waiting')}
      </span>
    </div>
  )
}
