/**
 * ── 「同一条 verify 命令，建契约时 vs 完成时结论一样吗」的臂（2026-10-21，施工单序 4）──
 *
 * ── 它补的是什么（MEASURED，`docs/OUTPUTS-CONSUMER-AUDIT.md` 的 (a)-4）──────────
 *
 * 同一条命令被跑了**两次**：
 *   `contract.verify-command`  建契约那一刻 ⇒ `gateEvaluations.contract.outputs.verifyProbe`
 *   `completion.verify-rerun`  成员汇报完成时 ⇒ `outputs.reruns`
 *
 * 实测：盘上 **44 条**任务**同时**带着这两份读数 ⇒ 而**没有任何一处代码把它们放在一起看**。
 * ⇒ "同一命令两次结论不一致"这件事，今天**一个字都读不出来**。
 *
 * ── 三态（★ `unmeasured` 不并进 `agree`）────────────────────────────────────────
 *
 *   `agree`      —— 两份都在，逐条一致
 *   `disagree`   —— 有命令的结论不同（`changed` 里逐条给）
 *   `unmeasured` —— 缺一份 / 无共同命令 ⇒ ★ **"没法比"与"比过、一样"不同形**
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { compareVerifyProbe } = await import(join(ROOT, 'lib', 'quality-gates.js'))

const run = (command, exitCode) => ({ command, exitCode, status: exitCode === 0 ? 'passed' : 'failed' })

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★ 伪造臂）：两次结论不同 ⇒ disagree，且**指名**是哪条命令
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1（伪造臂）：同一命令前后结论不同 ⇒ disagree，并指名命令与两端的结论', () => {
  /**
   * 定向突变：把 `if (atContractVerdict !== atCompletionVerdict)` 改成 `if (false)` ⇒ 本臂红。
   */
  const reading = compareVerifyProbe([run('tsc', 0), run('vitest', 0)], [run('tsc', 0), run('vitest', 1)])
  assert.equal(reading.status, 'disagree')
  assert.equal(reading.changed.length, 1, '★ 只报真的变了的那条，不连坐')
  assert.equal(reading.changed[0].command, 'vitest')
  assert.equal(reading.changed[0].atContract, 'passed')
  assert.equal(reading.changed[0].atCompletion, 'failed')
  assert.equal(reading.compared, 2, '★ 参与比对的条数要说得出（分母）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★★★ 核心臂）：`failed → passed` 才是真正要紧的那一种
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 2：契约时 **failed**、完成时 **passed** ⇒ 仍然 disagree（且这一格是信号）', () => {
  /**
   * ── 为什么它比"弄坏了"更要紧 ────────────────────────────────────────────────
   *
   * `contract.verify-command` 存在的**全部理由**是拦掉"判不出真假"的契约，
   * 它自己的措辞逐字：
   *   「A verify command must be able to **go green when the work was done
   *     and red when it was not**」
   *
   * ⇒ 若建契约时它就是 `failed`，那说明**那条命令当初就分不出真假**；
   *   而契约仍被接受、最后它"过了" —— 那正是那条判据**在该说话的时候没说**。
   *
   * ★ 定向突变：把 `changed.push` 那一支改成只在 `passed → failed` 时记 ⇒ 本臂红。
   */
  const reading = compareVerifyProbe([run('flaky', 1)], [run('flaky', 0)])
  assert.equal(reading.status, 'disagree', '★★ 方向变了也是变了 —— 而且这个方向更要紧')
  assert.deepEqual(reading.changed[0], { command: 'flaky', atContract: 'failed', atCompletion: 'passed' })
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★★ 对照臂）：两次一致 ⇒ agree（反向半边）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3（对照臂）：两次逐条一致 ⇒ agree（防"恒 disagree"）', () => {
  const reading = compareVerifyProbe([run('tsc', 0), run('vitest', 0)], [run('tsc', 0), run('vitest', 0)])
  assert.equal(reading.status, 'agree')
  assert.deepEqual(reading.changed, [], '★ agree 时名单必须为空（不是"没填"）')
  assert.equal(reading.compared, 2)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★★★ 未测量臂）：缺一份 ⇒ unmeasured，**绝不**并进 agree
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 4（未测量臂）：缺一份 ⇒ unmeasured，且三种成因**措辞不同**', () => {
  /**
   * ★★★ 这条防的是本仓最贵的那个合流："我没能比"被读成"比过、一样"。
   *   定向突变：把两支 `unmeasured` 改成 `agree` ⇒ 本臂红。
   */
  const missingProbe = compareVerifyProbe(undefined, [run('tsc', 0)])
  const missingReruns = compareVerifyProbe([run('tsc', 0)], undefined)
  const noCommon = compareVerifyProbe([run('tsc', 0)], [run('other', 0)])

  for (const reading of [missingProbe, missingReruns, noCommon]) {
    assert.equal(reading.status, 'unmeasured', '★★ 比不了 ⇒ 判不了，**不是**"一样"')
    assert.notEqual(reading.status, 'agree', '★★★ "我没法比"与"比过、一样"不同形')
    assert.equal(reading.compared, 0, '★ 一条都没比成 ⇒ 分母是 0（不是"比了 0 条且都一致"）')
    assert.ok((reading.why ?? '').length > 0, '★ 成因必说清')
  }
  /** ★★ 三种"比不了"的成因**两两不同**，因为补救动作不同。 */
  const whys = [missingProbe.why, missingReruns.why, noCommon.why]
  assert.equal(new Set(whys).size, 3, '★★ 三种"比不了"必须三句不同的话')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★ 口径臂）：读 `exitCode`（机械），读不到才退 `status`（自报）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5：结论优先读 `exitCode`，读不到才退 `status`', () => {
  /**
   * ★ 与 `completion.verify-rerun` 同一条纪律：**不采信自报**。
   *   一条 `status:'passed'` 而 `exitCode:1` 的记录必须读成 failed。
   * 定向突变：把 `typeof run?.exitCode === 'number'` 那一支删掉 ⇒ 本臂红。
   */
  const lying = compareVerifyProbe(
    [{ command: 'tsc', exitCode: 0, status: 'passed' }],
    [{ command: 'tsc', exitCode: 1, status: 'passed' }],
  )
  assert.equal(lying.status, 'disagree', '★★ 自报 passed 而 exitCode=1 ⇒ 必须读成 failed')
  assert.equal(lying.changed[0].atCompletion, 'failed')
})
