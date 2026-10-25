/** Session-owned entry points: a persistent title action and a durable turn card. */
import { useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { AgentTeamsSummary, openActivityPanel, type AgentTeamsCardInjected } from './AgentTeamsCard.tsx'
import { getActivitySnapshotsSnapshot, subscribeActivitySnapshots } from './activity-monitor.ts'
import { teamCardsForTurn } from './agent-teams-card-definition.ts'
/**
 * ★ t80：`LEAD_ART` 的 import 已删 —— 聊天入口不再显示队长头像。
 *   ★ **资源仍在** `artwork.ts`（`verify.mjs:311` 的打包契约钉着 `team-lead-v2.png`）。
 */
import css from './AgentTeamsCard.module.css'

export function TeamChatEntry({ sessionId, t }: PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'agentTeams'>) {
  const { teams, archivedTeams } = useSyncExternalStore(subscribeActivitySnapshots, getActivitySnapshotsSnapshot)
  const team = [...teams, ...archivedTeams].find(team => team.captainSessionId === sessionId)
  if (!team) return null
  return <button className={css.chatEntry} data-team-chat-entry type="button" title={t('workspace.focus')}
    onClick={() => openActivityPanel({ teamId: team.teamId, captainSessionId: sessionId, teamName: team.name, members: team.members })}>
    {t('workspace.focus')}
  </button>
}

export function TeamTurnCard({ sessionId, turn, useChat, t, openMember }: PropsRuntime<'conversation.chat.turnTail'> & PropsLocale<'agentTeams'> & AgentTeamsCardInjected) {
  const nodes = useChat(snapshot => snapshot.nodes)
  const cards = teamCardsForTurn(nodes.values(), turn.turn)
  if (turn.status !== 'closed' || cards.length === 0) return null
  return <div className={css.turnCards} data-team-turn-cards>{cards.map(node => <AgentTeamsSummary key={node.key}
    data={node.data as import('./agent-teams-card-definition.ts').AgentTeamsCardData}
    sessionId={sessionId} t={t} openMember={openMember} />)}</div>
}
