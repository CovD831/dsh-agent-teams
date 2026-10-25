/**
 * AgentTeams conversation card: the lightweight in-conversation summary for
 * one team — the captain's whale avatar and name, the member roster as
 * clickable whale avatars (opening the member's subagent transcript), and
 * an "activity panel" button that re-activates the top-right floater.
 *
 * The floater and this card share the `agent-teams:open-panel` window event
 * so the card can summon the panel even after it was closed (or when an old
 * session is re-opened for review).
 * @module dsh-agent-teams/client/card
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  getActivitySnapshotsSnapshot,
  monitorAgentTeam,
  subscribeActivitySnapshots,
  type ActivityTeam,
} from './activity-monitor.ts'
import type { AgentTeamsCardData } from './agent-teams-card-definition.ts'
import { readoutSummaryOf, readoutBadgeLabel, type ReadoutSlot, type ReadoutSummary } from './activity-model.ts'
/** ★ t80：`LEAD_ART` 已从本文件的 import 里去掉（卡片不再显示队长头像；资源仍在 artwork.ts）。 */
import { memberArtUrl } from './artwork.ts'
import css from './AgentTeamsCard.module.css'

/** Window event name the floater listens for to open itself. */
export const OPEN_PANEL_EVENT = 'agent-teams:open-panel'

/** Navigation action injected from the plugin's own SessionsService access. */
export interface AgentTeamsCardInjected {
  readonly workspaceBridge?: { getSnapshot: () => unknown; subscribe: (listener: () => void) => () => void }
  readonly openMember: (parentId: SessionId, childId: SessionId) => void
}

/** Complete keyed Chat renderer props. */
export type AgentTeamsCardProps =
  PropsRuntime<'conversation.chat.node', 'agent-teams'>
  & PropsLocale<'agentTeams'>
  & AgentTeamsCardInjected

/** Open the matching team view, carrying this team's summary
 * so the panel can show it even when the team no longer exists on disk
 * (historical session review). */
export function openActivityPanel(data: AgentTeamsCardData): void {
  window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, {
    detail: {
      teamId: data.teamId,
      captainSessionId: data.captainSessionId,
      teamName: data.teamName,
      members: data.members,
    },
  }))
}

/** Render one durable team as a compact conversation card. */
const noWorkspace = () => undefined
const noSubscription = () => () => {}

/* ─────────────────────────────────────────────────────────────────────────────
 * ── ★★★ 读数槽位读端（readout-panel，2026-10-24）────────────────────────────────
 *
 * 三条读数线（evidence / pairing / backends）写出的 `team.readouts` 此前没有任何
 * UI 读它。这里把它画成三行：槽位名 + 五态徽标 + summary。
 *
 * ★ not-wired 必须显式显示"未接线"——用"—"/空白会与"没接线"同形，正是要防的。
 * ★ unmeasured 的 reason 原样显示（可折叠）；measured 的 summary 原样显示，
 *   其 detail 折叠在"明细"里；partial / no-discrimination 各显"未测路径"与"无判别力 + why"。
 * ★ 纯展示，无交互状态机，无 innerHTML。evidence 的 unmeasured 徽标显式写「自述·未复核」。
 * @module dsh-agent-teams/client/card/readout-slots
 */

const READOUT_SLOT_NAMES: Readonly<Record<keyof ReadoutSummary, string>> = {
  evidence: '证据链',
  pairing: '软硬配对',
  backends: '后端能力位',
}

const READOUT_SLOT_ORDER = ['evidence', 'pairing', 'backends'] as const

function ReadoutBadge({ kind, slotKey }: { kind: ReadoutSlot['kind']; slotKey: string }) {
  return <span className={`${css.readoutBadge} ${css[`badge_${kind}`]}`}>{readoutBadgeLabel(kind, slotKey)}</span>
}

function ReadoutSlotRow({ slotKey, name, slot }: { slotKey: string; name: string; slot: ReadoutSlot }) {
  if (slot.kind === 'not-wired') {
    return (
      <div className={css.readoutRow}>
        <span className={css.readoutName}>{name}</span>
        <ReadoutBadge kind="not-wired" slotKey={slotKey} />
        <span className={css.readoutSummary}>未接线</span>
      </div>
    )
  }
  if (slot.kind === 'unmeasured') {
    return (
      <div className={css.readoutRow}>
        <span className={css.readoutName}>{name}</span>
        <ReadoutBadge kind="unmeasured" slotKey={slotKey} />
        <details className={css.readoutReason}>
          <summary>{slot.reason.length > 48 ? `${slot.reason.slice(0, 48)}…` : slot.reason}</summary>
          <span className={css.readoutDetail}>{slot.reason}</span>
        </details>
      </div>
    )
  }
  if (slot.kind === 'partial') {
    // 后端读到了，但某块能力位没测成：summary 给规模，unknown 只列路径，不许拍平成附注
    return (
      <div className={css.readoutRow}>
        <span className={css.readoutName}>{name}</span>
        <ReadoutBadge kind="partial" slotKey={slotKey} />
        <span className={css.readoutSummary}>{slot.summary}</span>
        <details className={css.readoutReason}>
          <summary>未测：{slot.unknown.join('、')}</summary>
          <span className={css.readoutDetail}>{slot.unknown.join('\n')}</span>
        </details>
      </div>
    )
  }
  if (slot.kind === 'no-discrimination') {
    // pairing 是恒真式（22 项全是 {true,true}）：不许渲染成绿色"成对"，明确"无判别力" + why
    return (
      <div className={css.readoutRow}>
        <span className={css.readoutName}>{name}</span>
        <ReadoutBadge kind="no-discrimination" slotKey={slotKey} />
        <span className={css.readoutSummary}>{slot.summary}</span>
        <details className={css.readoutReason}>
          <summary>本读数无判别力</summary>
          <span className={css.readoutDetail}>{slot.why}</span>
        </details>
      </div>
    )
  }
  // measured
  return (
    <div className={css.readoutRow}>
      <span className={css.readoutName}>{name}</span>
      <ReadoutBadge kind="measured" slotKey={slotKey} />
      <span className={css.readoutSummary}>{slot.summary}</span>
      {slot.detail.length > 0 && (
        <details className={css.readoutReason}>
          <summary>明细</summary>
          <span className={css.readoutDetail}>{slot.detail.join('\n')}</span>
        </details>
      )}
    </div>
  )
}

function ReadoutSlots({ team }: { team: ActivityTeam }) {
  const summary = readoutSummaryOf(team)
  return (
    <div className={css.readouts} data-readout-slots>
      {READOUT_SLOT_ORDER.map((key) => (
        <ReadoutSlotRow key={key} slotKey={key} name={READOUT_SLOT_NAMES[key]} slot={summary[key]} />
      ))}
    </div>
  )
}

export function AgentTeamsCard({ node, openMember, sessionId, t, workspaceBridge }: AgentTeamsCardProps) {
  const native = useSyncExternalStore(workspaceBridge?.subscribe ?? noSubscription, workspaceBridge?.getSnapshot ?? noWorkspace)
  const location = node.location
  // Closed turns render their card through the official, non-folding turn tail.
  if (native && (location.kind === 'turn' || location.kind === 'step') && location.turn.status === 'closed') return null
  return <AgentTeamsSummary data={node.data} openMember={openMember} sessionId={sessionId} t={t} />
}

export function AgentTeamsSummary({ data, openMember, sessionId, t }: AgentTeamsCardInjected & PropsLocale<'agentTeams'> & {
  data: AgentTeamsCardData; sessionId: string
}) {
  // `conversation.chat.node` is session-scoped, so its framework-owned id is
  // a stable owner even while another conversation becomes current.
  const owner = data.captainSessionId || sessionId
  const { teams, archivedTeams } = useSyncExternalStore(
    subscribeActivitySnapshots,
    getActivitySnapshotsSnapshot,
  )
  useEffect(() => {
    return monitorAgentTeam(owner, data.teamId)
  }, [data.teamId, owner])
  const snapshot = teams.find((team) => team.teamId === data.teamId && (owner === '' || team.captainSessionId === owner))
    ?? archivedTeams.find((team) => team.teamId === data.teamId && (owner === '' || team.captainSessionId === owner))
  const resolved = useMemo<AgentTeamsCardData>(() => ({
    ...data,
    captainSessionId: snapshot?.captainSessionId ?? owner,
    teamName: snapshot?.name ?? data.teamName,
    members: snapshot?.members.map((member) => ({ id: member.id, name: member.name, role: member.role })) ?? data.members,
  }), [data, owner, snapshot])
  return (
    <section className={css.root} data-agent-teams-card data-team-id={resolved.teamId}>
      <header className={css.head}>
        {/**
          * ★★★ t80 缺陷③：卡片顶部的队长头像**不再显示**（用户截图：「队长的图标还在」）。
          *   ★ 删的是**显示**，不是**资源** —— `LEAD_ART` 的取值仍在 `artwork.ts` 里，
          *     被 `verify.mjs:311` 的打包契约钉着（删图会红一条 host 侧契约）。
          */}
        <span className={css.teamName} title={resolved.teamName}>{resolved.teamName}</span>
        <span className={css.memberCount}>{t('card.memberCount', { count: resolved.members.length })}</span>
        <button
          type="button"
          className={css.panelButton}
          onClick={() => { openActivityPanel(resolved) }}
          aria-label={t('workspace.focus')}
          title={t('workspace.focus')}
        >
          {t('workspace.focus')}
        </button>
      </header>
      {resolved.members.length > 0 && (
        <div className={css.members}>
          {resolved.members.map((member) => (
            <button
              type="button"
              key={member.id || member.name}
              className={css.member}
              onClick={() => {
                if (member.id !== '') openMember(owner as SessionId, member.id as SessionId)
              }}
              title={member.role === '' ? member.name : `${member.name} · ${member.role}`}
            >
              {memberArtUrl(member.name, member.role) !== null ? (
                <img className={css.memberArt} src={memberArtUrl(member.name, member.role) ?? ''} alt="" aria-hidden />
              ) : (
                <span className={css.memberInitial}>{member.name.trim().slice(0, 1).toUpperCase() || '?'}</span>
              )}
              <span className={css.memberName}>{member.name}</span>
            </button>
          ))}
        </div>
      )}
      {snapshot && <ReadoutSlots team={snapshot} />}
    </section>
  )
}
