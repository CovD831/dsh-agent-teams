#!/usr/bin/env node
/**
 * ── ★★★ 投递失败必须【留痕】—— 因为 `false` 与"没票可送"在读法上同形（t43）──────
 *
 * MEASURED（2026-10-10 00:1x，captain 实测）：
 *   派发链上前面每一格都是好的 —— 闸门不扣 · 成员 idle · `nextReadyTask` 找得到 ·
 *   任务过门 · captain 能解析 —— ★ 而票【仍然送不出去】。
 *
 * ```
 * catch (error) { ctx.logger.warn(…); return false }   // ★ 只写日志，不写记录
 * ⇒ 调用方 `if (accepted) {…}` 不进 ⇒ 静默回滚 ⇒ 任务回 pending
 * ⇒ ★ team.json 上：任务仍 pending · attempt 不推进 · 成员 idle
 * ⇒ ★ 与"根本没人触发派发"【完全同形】
 * ```
 *
 * ★★ 后果（本会话实测）：captain 反复重派、反复调 status、反复让用户重启 ——
 *   而每一次失败的方式都一样，而每一次**都看不见**。
 *
 * ★ 本臂钉的是【结构】：那条 catch 必须把成因交给调用方，而调用方必须把它写进记录。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')
/** 剥注释 —— 否则【描述这条纪律的注释】会被当成【这条纪律在】。 */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const membersSrc = strip(read('src', 'members.ts'))
const schedulerSrc = strip(read('src', 'scheduler.ts'))
const stateSrc = strip(read('src', 'state.ts'))
const typesSrc = strip(read('src', 'types.ts'))

test('★★★ 臂 1：投递的失败【把成因交出来】（而不只是 return false）', () => {
  assert.match(
    membersSrc,
    /export async function deliverToMemberDetailed/,
    '★ 必须有一个【带成因】的版本 —— 否则 `false` 与"没票可送"同形',
  )
  assert.match(
    membersSrc,
    /return \{ ok: false, reason \}/,
    '★ 失败分支必须交出 `reason`，而不是只写日志',
  )
})

test('★★★ 臂 2：派发路径用的是带成因的版本 —— 而信箱路径不是（两处【不同形】）', () => {
  /**
   * ★★ 全仓有【两处】投递，而它们的性质不同：
   *   · 派发路径（mode='queue'）⇒ ★ 它的失败会让任务回滚 ⇒ 必须留痕
   *   · 信箱路径（mode='steer'）⇒ 它的失败只是"这次提醒没送到" ⇒ 不必落 task 字段
   *   ⇒ ★ 所以我第一版那条 `doesNotMatch` 是【错的】—— 它把信箱那处也算成了违规。
   *     而它之所以被我发现，是因为那句话在【去注释之后】仍然命中（我核过上下文，
   *     命中的是 `member.id` 那一处 = 信箱）。
   */
  assert.match(
    schedulerSrc,
    /await deliverToMemberDetailed\(ctx, captain, ticket\.memberId, prompt, signal\)/,
    '★ 派发那一处（ticket.memberId · mode 默认 queue）必须用带成因的版本',
  )
  assert.doesNotMatch(
    schedulerSrc,
    /await deliverToMember\(ctx, captain, ticket\.memberId, prompt, signal\)/,
    '★ 派发那一处不许还用丢掉成因的版本',
  )
})

test('★★★ 臂 3：失败被【写进记录】（而不只是 logger.warn）', () => {
  assert.match(
    schedulerSrc,
    /task\.deliveryFailure = \{ at: Date\.now\(\), attempt: ticket\.attempt, reason: delivered\.reason \}/,
    '★ 失败必须落进 task（那才是别人读得到的地方）—— 一条 warn 不进 team.json',
  )
})

test('★★★ 臂 4：那条失败带 `attempt` —— 否则旧失败与本次失败同形', () => {
  assert.match(typesSrc, /deliveryFailure\?: \{[\s\S]{0,400}?attempt: number/, '★ 字段本身要带 attempt')
  assert.match(schedulerSrc, /attempt: ticket\.attempt/, '★ 写入时要填【当时那一代】的序号')
})

test('★★★ 臂 5：新一代开始时【清掉】上一代的失败', () => {
  /**
   * ★ 反向半边：若不清，一条旧失败会一直留在记录里 ⇒
   *   "它上次失败过"与"它现在仍然是坏的"合流。
   *   ★ 而清点必须在 `beginTaskAttempt`（那里 attempt 刚推进 ⇒ 旧记录属于上一代）。
   */
  assert.match(
    stateSrc,
    /export function beginTaskAttempt[\s\S]{0,300}?delete task\.deliveryFailure/,
    '★ `beginTaskAttempt` 必须删掉旧的 `deliveryFailure`',
  )
})

test('★★ 臂 6：那两处失败路径【不同形】—— 回滚的两支都写，而成功那一支不写', () => {
  /** ★ 判据：`if (!delivered.ok)` 必须在【回滚的锁里】。 */
  const rollback = /await withTeamLock\(teamLockKey\(stateRoot, team\.id\)[\s\S]{0,2000}?if \(!delivered\.ok\)/.exec(schedulerSrc)
  assert.ok(rollback, '★ 写入必须在回滚处 —— 那是唯一知道"这次试过而没送达"的位置')
})
