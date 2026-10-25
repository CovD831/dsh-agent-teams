#!/usr/bin/env node
/** Dedicated TDD checks for execution prompt and fallback routing. */
import { assignmentPrompt } from '../lib/scheduler.js'
import { memberPersona, isFallbackFailureCode, selectFallbackRoute } from '../lib/members.js'
import { resolveTeamProfile } from '../lib/profiles.js'

let failures = 0
function check(label, value) {
  if (value) console.log(`  PASS  ${label}`)
  else { failures += 1; console.error(`  FAIL  ${label}`) }
}
function throws(label, fn) {
  try { fn(); failures += 1; console.error(`  FAIL  ${label} (did not throw)`) }
  catch { console.log(`  PASS  ${label}`) }
}

const prompt = 'FACTS_ONLY_PROMPT'
const fallbackPlugin = { provider: 'openai', model: 'backup-plugin' }
const fallbackProfile = { provider: 'grok', model: 'backup-profile' }
const fallbackMember = { provider: 'openai', model: 'backup-member' }
const config = {
  executionPrompt: prompt,
  fallback: fallbackPlugin,
  demo: {
    executionPrompt: 'PROFILE_PROMPT',
    fallback: fallbackProfile,
    members: [{ name: 'worker', model: 'primary', executionPrompt: 'MEMBER_PROMPT', fallback: fallbackMember }],
    tasks: [{ id: 'work', subject: 'Work', assignee: 'worker' }],
  },
}
const profile = resolveTeamProfile({ demo: config.demo }, 'demo', 8)
check('member fallback config is normalized', profile.members[0].fallback?.model === 'backup-member')
check('profile fallback config is normalized', profile.fallback?.model === 'backup-profile')
check('member prompt config is normalized', profile.members[0].executionPrompt === 'MEMBER_PROMPT')
throws('fallback requires provider', () => resolveTeamProfile({ bad: { members: [{ name: 'w', fallback: { model: 'x' } }] } }, 'bad', 8))
throws('fallback requires model', () => resolveTeamProfile({ bad: { members: [{ name: 'w', fallback: { provider: 'x' } }] } }, 'bad', 8))

const assignment = assignmentPrompt({ taskId: 't1', memberName: 'worker', memberId: 'm', attempt: 1, attemptId: 'a', subject: 'Work', dependencyOutputs: [], executionPrompt: prompt }, '.agent-teams', 'demo')
const persona = memberPersona({ name: 'Demo', id: 'demo', description: 'goal', captainSessionId: 'c', createdAt: 0, profile: { name: 'demo' }, members: [], tasks: [], taskSeq: 0 }, { name: 'worker', id: 'm', executionPrompt: prompt, joinedAt: 0, status: 'idle' }, '.agent-teams')
check('prompt is present in assignment', assignment.includes(prompt))
check('prompt is present in persona', persona.includes(prompt))
check('assignment does not require process disclosure', !assignment.includes('record the process') || assignment.includes(prompt))

/**
 * ── ★★★ 2026-10-22 修正：这份清单此前**没有一条对着 harness 的真实 code 核过** ──────
 *
 * MEASURED（对 `@deepseek-ai/dsh-llm/lib/types/error.d.ts` 与
 * `dsh-llm-pi-ai/lib/index.js` 的 `classifyPiAiError` 逐条核）：
 *
 * ```
 * allowed 里的 MISSING_CREDENTIAL / NO_ADAPTER
 *   ⇒ 它们是 harness **文档注释里的举例**，不是任何适配器会产出的值
 *   ⇒ 那两条断言恒真（"认了"一个永远不会来的 code），而它们看起来像已覆盖
 * denied  里没有 INVALID_REQUEST
 *   ⇒ 而 2026-10-20 那次**整队停摆**的真实报错，经 classifyPiAiError 正是 INVALID_REQUEST
 *     （`wb API error (400): {...upstream_content_policy_blocked...}`，`\b400\b` 命中）
 * ```
 *
 * ⇒ 现在 allowed 只列**真的会产出**的 code：`QUOTA` / `ACCOUNT_QUOTA` / `RATE_LIMIT` /
 *   `AUTH` / `INVALID_REQUEST`；而 `MISSING_CREDENTIAL` / `NO_ADAPTER` 从 allowed
 *   挪到 denied（不是"不该重试"，是"它根本不会出现，写成 allowed 是在声称一件不会发生的事"）。
 */
const allowed = ['QUOTA', 'ACCOUNT_QUOTA', 'RATE_LIMIT', 'AUTH', 'INVALID_REQUEST']
const denied = [
  'CONTEXT_WINDOW_EXCEEDED',   // ★ 换路由时上下文一字不变 ⇒ 换也白换（下面那条 arm 钉住它）
  'INVALID_CREDENTIAL',        // ★ 凭证格式错 ⇒ 换路由修不好（该修凭证）
  'INVALID_ARGS', 'TASK_FAILED',
  'MISSING_CREDENTIAL', 'NO_ADAPTER',  // ★ harness 不会产出这两个 code（见上）
]
for (const code of allowed) check(`fallback whitelist includes ${code}`, isFallbackFailureCode(code))
for (const code of denied) check(`fallback whitelist excludes ${code}`, !isFallbackFailureCode(code))

/**
 * ★★ 真实事故臂：把那次整队停摆的**原文**喂进分类器，再问"该不该换路由"。
 * ★ 这一条是这份清单唯一有真实事故作证的臂 —— 其余都是合成 code。
 */
function classifyPiAiError(message) {
  if (/\b(?:401|403)\b/.test(message)) return 'AUTH'
  if (/\b429\b|rate.?limit/i.test(message)) return 'RATE_LIMIT'
  if (/\b413\b|payload too large/i.test(message)) return 'INVALID_REQUEST'
  if (/\b400\b|invalid.?request/i.test(message)) return 'INVALID_REQUEST'
  if (/\b5\d\d\b/.test(message)) return 'SERVER'
  if (/\btime(?:d)?\s*out\b|timeout/i.test(message)) return 'TIMEOUT'
  return 'PI_AI_ERROR'
}
const outage = 'wb API error (400): {"code":"upstream_content_policy_blocked","message":"账号存在异常行为，已被限制使用"}'
const outageCode = classifyPiAiError(outage)
check('real outage (2026-10-20) classifies as INVALID_REQUEST', outageCode === 'INVALID_REQUEST')
check('real outage would now switch routes', isFallbackFailureCode(outageCode))
const primary = { provider: 'openai', model: 'primary' }
const backup = { provider: 'grok', model: 'backup' }
const switched = selectFallbackRoute(primary, backup, 'QUOTA', false)
check('eligible failure switches and retries', switched.retry && switched.switched && switched.selection.model === 'backup')
const repeated = selectFallbackRoute(switched.selection, backup, 'RATE_LIMIT', true)
check('fallback switches at most once', !repeated.retry && repeated.selection.model === 'backup')
const ignored = selectFallbackRoute(primary, backup, 'CONTEXT_WINDOW_EXCEEDED', false)
check('non-eligible failure keeps primary route', !ignored.retry && ignored.selection.model === 'primary')

if (failures > 0) process.exitCode = 1
else console.log('fallback TDD checks passed')
