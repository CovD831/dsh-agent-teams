/**
 * ── `completion.verify-rerun` 的三臂夹具 ────────────────────────────────────────
 *
 * 契约要求每条判据自带三臂（`docs/GATE-REGISTRY.md` §6）：
 *
 *   臂 1（伪造臂）：判据【应该拦住】的输入        ⇒ 期望 blocked
 *   臂 2（未测量臂）：没能测量的情形              ⇒ 期望 unmeasured（★ 不是 ok）
 *   臂 3（对照臂）：完全合法的输入                ⇒ 期望 ok
 *
 * ★ 缺任何一臂，这条判据不算完成。理由是实测的（2026-10-05）：t2 那一轮我的
 *   契约写错了，而它与"判据抓到了伪造"在日志里同形；**只有对照臂能区分
 *   「判据有效」与「判据在乱拒」**。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gate, appliesTo, id, point } from '../lib/gates/completion/verify-rerun.js'

/**
 * 收窄助手。★ 它们不只是为了让 TS 闭嘴 —— 它们把"这条断言期望哪一种裁决"
 * 写进了断言本身，于是"我期望被拒"与"我期望未测量"在测试里也不同形。
 */
function expectBlocked(v) {
  if (v.ok !== false || !('blockers' in v)) {
    throw new Error(`expected a blocked verdict, got ${JSON.stringify(v)}`)
  }
  return v.blockers
}
function expectUnmeasured(v) {
  if (v.ok !== false || !('unmeasured' in v)) {
    throw new Error(`expected an unmeasured verdict, got ${JSON.stringify(v)}`)
  }
  return v.unmeasured
}
function expectOk(v) {
  if (v.ok !== true) throw new Error(`expected an ok verdict, got ${JSON.stringify(v)}`)
  return v
}



/** 一个最小 context。exec 用一个可控的表。 */
function ctx({ verify, claimed, exits, exec }) {
  return {
    wantsCompleted: true,
    taskNotTerminal: true,
    task: { id: 't1', verify, commandsRun: claimed },
    update: { commandsRun: claimed },
    execVerifyCommand: exec ?? (async (command) => {
      const value = (exits ?? {})[command]
      if (value === undefined) throw new Error(`no stubbed exit code for ${command}`)
      return value
    }),
  }
}

test('臂 1 ★ 伪造臂：成员报 passed 而重跑非零 ⇒ 被拒，且报错说得清是哪条命令', async () => {
  const verdict = await gate(ctx({
    verify: ['test -f a.txt', 'test -d b'],
    claimed: [
      { command: 'test -f a.txt', status: 'passed', exitCode: 0 },
      { command: 'test -d b', status: 'passed', exitCode: 0 },
    ],
    exits: { 'test -f a.txt': 1, 'test -d b': 0 },
  }))
  const blockers = expectBlocked(verdict)
  assert.equal(blockers.length, 1, '★ 只报真的对不上的那条，不连坐')
  assert.match(blockers[0], /re-executed by the quality gate exited 1/)
  assert.match(blockers[0], /while the member reported passed/)
  assert.match(blockers[0], /test -f a\.txt/, '★ 必须指名是哪条命令')
})

test('臂 1b ★ 伪造臂：两条都伪造 ⇒ 两条都报（不短路）', async () => {
  const verdict = await gate(ctx({
    verify: ['a', 'b'],
    claimed: [{ command: 'a', status: 'passed' }, { command: 'b', status: 'passed' }],
    exits: { a: 1, b: 2 },
  }))
  assert.equal(expectBlocked(verdict).length, 2, '★ 一次给全，而不是修一个又冒一个')
})

test('臂 1c 成员自报 failed 而重跑 failed ⇒ 不拦（那不是伪造，是如实）', async () => {
  const verdict = await gate(ctx({
    verify: ['a'],
    claimed: [{ command: 'a', status: 'failed', exitCode: 1 }],
    exits: { a: 1 },
  }))
  /**
   * ★ 这条防的是"把如实报失败也当成伪造拦掉" —— 拦它会教成员谎报通过。
   *   （如实失败该由上游 `verify failure must fail the task` 那条规则处理。）
   */
  assert.equal(verdict.ok, true)
})

test('臂 2 ★ 未测量臂：没有执行器 ⇒ unmeasured，不是 ok', async () => {
  const verdict = await gate({
    wantsCompleted: true, taskNotTerminal: true,
    task: { verify: ['a'] }, update: {},
    execVerifyCommand: undefined,
  })
  assert.match(expectUnmeasured(verdict), /re-execution is unavailable/)
  /**
   * ★ 这是本判据最重要的一条：一个不能重跑的判据如果返回 ok，就是
   *   "装上了但从不生效" —— 比没装更坏，因为它让人以为验过了。
   */
  assert.equal(verdict.ok, false)
  assert.equal('blockers' in verdict, false, '★ 未测量不是"发现了问题"')
})

test('臂 2b ★ 未测量臂：执行器抛错 ⇒ unmeasured（不是"命令失败"）', async () => {
  const verdict = await gate(ctx({
    verify: ['a'], claimed: [],
    exec: async () => { throw new Error('spawn EAGAIN') },
  }))
  assert.match(expectUnmeasured(verdict), /raised: spawn EAGAIN/)
  assert.equal('blockers' in verdict, false, '★ 基础设施故障不得伪装成一个关于工作的结论')
})

test('臂 2c 未测量臂：执行器返回非整数 ⇒ unmeasured', async () => {
  const verdict = await gate(ctx({ verify: ['a'], claimed: [], exec: async () => undefined }))
  assert.match(expectUnmeasured(verdict), /non-integer exit code/)
})

test('臂 3 ★ 对照臂：真实工作 ⇒ ok，且交出判据层亲眼看到的重跑结果', async () => {
  const verdict = await gate(ctx({
    verify: ['a', 'b'],
    claimed: [{ command: 'a', status: 'passed' }, { command: 'b', status: 'passed' }],
    exits: { a: 0, b: 0 },
  }))
  const accepted = expectOk(verdict)
  const reruns = accepted.reruns ?? []
  assert.equal(reruns.length, 2)
  /**
   * ★ 通过时也要交出 reruns：让落盘的 exitCode 是【判据层看到的】那个。
   *   否则"通过"这条路径上，成员填的 exitCode 仍然留在记录里。
   */
  assert.deepEqual(reruns.map((r) => [r.command, r.exitCode, r.status]), [
    ['a', 0, 'passed'], ['b', 0, 'passed'],
  ])
  assert.match(reruns[0].evidence, /re-executed by the quality gate on/)
})

test('⑨ appliesTo ★ 三个条件缺一不可（每个都有实测依据）', () => {
  const base = { wantsCompleted: true, taskNotTerminal: true, task: { verify: ['a'] } }
  assert.equal(appliesTo(base), true)
  // 不是尝试 completed ⇒ 没有裁决要复核
  assert.equal(appliesTo({ ...base, wantsCompleted: false }), false)
  // ★ 终态 ⇒ issue159 的补证据路径，不是新的完成裁决
  assert.equal(appliesTo({ ...base, taskNotTerminal: false }), false, '★ 补证据不该被今天的命令重新审判')
  // 没声明 verify ⇒ 没有可重跑的东西
  assert.equal(appliesTo({ ...base, task: { verify: [] } }), false)
  assert.equal(appliesTo({ ...base, task: {} }), false)
  assert.equal(appliesTo(undefined), false)
})

test('⑩ 判据元数据：id / point 与注册表的插入点一致', () => {
  assert.equal(id, 'completion.verify-rerun')
  assert.equal(point, 'completion')
})
