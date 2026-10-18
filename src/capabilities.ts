/** Stable, agent-scoped presentation. Business authority stays in the tools. */
import { onAgentReady } from './harness-compat.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readTeamSync, readRetiredMemberIdsSync } from './state.ts'
import type { TeamState } from './types.ts'
import { MEMBER_TOOL_NAMES, TEAM_TOOL_NAMES } from './tool-names.ts'

export const TEAM_ACTIVATION_PROMPT = 'AgentTeams (Agent Teams) provides multi-agent team collaboration. Apply these rules when the user requests it (including /agent-teams) or when continuing an existing team. Mentioning, quoting, discussing, or declining AgentTeams alone is not a request to start work.'
/**
 * ── ★★★ 成员提示词是**唯一**一处"成员能知道自己能派 subagent"的地方 ──────────────
 *
 * MEASURED（2026-10-18 夜里，这个缺口让我建出了一支**早期形态**的队）：
 *   · 实盘 `memberMaxDepth: 1`（`cordis.patch.yml:448`）⇒ 成员**确实能**派 subagent；
 *   · 但 `grep -c subagent` 在本文件与派发提示词里 = **0** ⇒ 权限给了、**没人告诉它**；
 *   · 而成员的工具出口只有 `send_message`（`scheduler.ts:643`）⇒ 它只会"汇报"。
 *   ⇒ 于是「持久记账点 + 每任务拉一对临时 worker/reviewer」那个形态，
 *     **只**存在于 `mutation-quality` 这类团队手工写进 `executionPrompt` 的文本里
 *     （`ledger` 逐字："memberMaxDepth 必须允许你派一层 sub-agent"）。
 *     没有那段文本的队，成员即使拿到 subagent 工具也不会用。
 *
 * ★ 措辞刻意**条件化**（"若你的人设把活派给帮手"），而不是"你可以派 subagent"：
 *   后者会让每个实现者成员都想把活再转包一层 —— 而那恰恰是**不**该发生的事
 *   （实现者的价值就是它自己在 worktree 里改文件）。
 *   这一段只把"人设说了要派"这件事从**不可能**变成**可能**。
 *
 * ★ 长度预算：本仓夹具 `scripts/capabilities.test.mjs` 断言 < 600 字节
 *   （`Buffer.byteLength(TEAM_MEMBER_PROMPT) < 600`），当前 544。
 *   ⇒ 这句话每加一个词都要重新量；把它写长会把那条断言撞红。
 */
export const TEAM_MEMBER_PROMPT = 'You are an AgentTeams member. Follow your assigned member persona and task contract. Use agent_teams_claim_task, agent_teams_update_task, agent_teams_send_message and agent_teams_status for your own work. Include the current attempt_id in updates; report completion or failure to the captain. Do not create, approve, edit or resume a team. If your durable membership is unavailable, report that to the parent instead of creating a replacement. If your persona delegates the work to helpers, spawn subagents for it rather than doing it yourself.'

interface Exposure {
  member: boolean
  dispose: () => void
}

interface CapabilityConfig {
  stateDir: string
  isPendingMember: (agent: Agent) => boolean
  captainPrompt: () => string
  order?: number
}

function stateRoot(agent: Agent, config: CapabilityConfig): string {
  return join(agent.session.header.cwd ?? process.cwd(), config.stateDir)
}

/** Synchronous startup/HMR hydration must finish before the first assembly. */
function currentTeam(agent: Agent, config: CapabilityConfig): TeamState | undefined {
  const root = stateRoot(agent, config)
  let entries
  try { entries = readdirSync(root, { withFileTypes: true }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let found: TeamState | undefined
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'archive') continue
    const team = readTeamSync(root, entry.name)
    if (team === undefined || (team.captainSessionId !== agent.id
      && !team.members.some(member => member.id === agent.id))) continue
    if (found !== undefined) throw new Error('ambiguous AgentTeams membership')
    found = team
  }
  return found
}

/** Call once, after all business definitions have registered. Never per member. */
export function installTeamCapabilities(ctx: Context, config: CapabilityConfig): void {
  const states = new WeakMap<Agent, Exposure>()
  const active = new Set<Exposure>()
  let mounted = true
  // Snapshot policy once: profiles, team state, and tool results must never
  // rewrite this prefix or control whether core instructions are available.
  const captainPrompt = `${TEAM_ACTIVATION_PROMPT}\n\n${config.captainPrompt()}`

  function attach(agent: Agent): Exposure {
    const prior = states.get(agent)
    if (prior !== undefined) return prior
    if (!mounted) throw new Error('AgentTeams capability provider is disposed')
    // Determine a member's role before its first request and retain it for the
    // lifetime of this scope. Team creation/archive must never rewrite the
    // captain's system/tools prefix, even after a long ordinary conversation.
    let member = config.isPendingMember(agent)
    try {
      member ||= readRetiredMemberIdsSync(stateRoot(agent, config)).has(agent.id)
      const team = currentTeam(agent, config)
      member ||= team !== undefined && team.captainSessionId !== agent.id
    } catch (error) {
      // Unrelated damaged state must not disable ordinary conversation.
      // Business tools still validate durable team state before acting.
      ctx.logger.warn(`agent-teams: capability hydration failed: ${String(error)}`)
    }
    const state: Exposure = { member, dispose: () => undefined }
    let revoke: (() => void) | undefined
    let disposed = false
    let releaseLifetime: (() => void) | undefined
    state.dispose = () => {
      if (disposed) return
      disposed = true
      revoke?.()
      releaseLifetime?.()
      states.delete(agent)
      active.delete(state)
    }
    states.set(agent, state)
    active.add(state)
    try {
      if (member) revoke = agent.ctx.tools.restrict({
        deny: TEAM_TOOL_NAMES.filter(name => !MEMBER_TOOL_NAMES.includes(name)),
      })
      releaseLifetime = agent.ctx.effect(() => state.dispose, 'agent-teams: capability lifetime')
      return state
    } catch (error) { state.dispose(); throw error }
  }

  ctx.systemPrompt.section({
    name: 'agent-teams:usage', order: config.order ?? 117,
    text: ({ agent }) => {
      return agent !== undefined && states.get(agent)?.member ? TEAM_MEMBER_PROMPT : captainPrompt
    },
  })
  onAgentReady(ctx, agent => { attach(agent) })
  ctx.effect(() => () => {
    mounted = false
    for (const state of [...active]) state.dispose()
  }, 'agent-teams: capability scopes')
  for (const agent of ctx.agents.list()) attach(agent)
}
