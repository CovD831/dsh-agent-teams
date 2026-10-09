#!/usr/bin/env node
/**
 * ── ★★★ 「没能检查」不是「拒绝」—— 两个位置、两种成因（t42）─────────────────────
 *
 * 由来（MEASURED 2026-10-09，`verifier` 在 t5 上给出**两个终态的拒绝原文**）：
 * ```
 * completed ⇒ rejected: the completion gate could not measure (…)
 * failed    ⇒ rejected: ★ 同一条，逐字相同
 * ```
 * ★ 而那条判据**在自己的措辞里**写着 "so it is reported rather than refused"
 *   ⇒ 判据说"我是报告，不是拒绝"，而调用方读成了 "rejected"。
 *
 * ★★ 这一格已经出现过三次，而每次只修了一半：
 * ```
 * t16  `skippedAll` 那一格（"一条判据都没跑"）
 * t14  `skippedAll` 那一格（dispatch / completion 两处）
 * t42  ★ `unmeasured` 那一格（"跑了而这一步测不成"）—— 本次
 * ```
 *
 * ★★★ 而本臂钉的是**两处同一口径**（只修一处 ⇒ 它们会分叉，
 *   而分叉后「哪一处放行」在日志里同形）。
 *
 * ★ 判据是源码文本（本脚本不 import 产品）—— 而它钉的是**结构**，不是措辞：
 *   `NotChecked` 的定义里必须【两种成因都在】，且**两个位置都要**。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'src', 'tools', 'update-task.ts'), 'utf8')

/** 剥掉注释 —— 否则【描述这条纪律的注释】会被当成【这条纪律在】。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
const code = stripComments(SRC)

test('★★★ 臂 1：dispatch 位置把 `unmeasured` 也算作「没能检查」', () => {
  assert.match(
    code,
    /const dispatchNotChecked = [\s\S]{0,200}?dispatchGates\.unmeasured !== undefined/,
    '★ `dispatchNotChecked` 必须同时认 `skippedAll` 与 `unmeasured` —— 两者都是"我没能检查"',
  )
})

test('★★★ 臂 2：completion 位置同样（两处同一口径）', () => {
  assert.match(
    code,
    /const completionNotChecked = [\s\S]{0,200}?completionGates\.unmeasured !== undefined/,
    '★ `completionNotChecked` 必须与 dispatch 位置同形 —— 只改一处会让它们分叉',
  )
})

test('★★★ 臂 3：两处的定义【形状一致】—— 这是"同一口径"的可机械判读', () => {
  /**
   * ★ 判据：把两处的定义各取出来，比较【它们认了哪几种成因】。
   *   ★ 而不是比较文本（那会因为变量名不同而误报）。
   */
  /**
   * ★ 定义是**多行**的（`= x\n && (a || b)`）⇒ 正则必须跨行取到【闭合括号】，
   *   而不是取到第一个换行 —— 我第一版就是这样，于是它读到了半句。
   */
  const dispatch = /const dispatchNotChecked = ([\s\S]{0,300}?\)\n)/.exec(code)
  const completion = /const completionNotChecked = ([\s\S]{0,300}?\)\n)/.exec(code)
  assert.ok(dispatch && completion, '★ 两处的定义都必须在')
  for (const [label, body] of [['dispatch', dispatch[1]], ['completion', completion[1]]]) {
    assert.match(body, /skippedAll !== undefined/, `★ ${label} 必须认 skippedAll`)
    assert.match(body, /unmeasured !== undefined/, `★ ${label} 必须认 unmeasured`)
    assert.doesNotMatch(body, /blockers/, `★ ${label} 不许把 blockers 也算进"没能检查" —— 那一种才该拒`)
  }
})

test('★★★ 臂 4：`blockers` 仍然拒（那一半不许放宽）', () => {
  /**
   * ★ 反向半边：两个拒绝点仍须存在，且仍然只在 `!NotChecked && ok === false` 时触发。
   *   ★ 缺了它，本臂在"一律放过"的实现上照样绿 —— 而那正是最坏的形态。
   */
  const refusals = [...code.matchAll(/if \(!(dispatch|completion)NotChecked && (\w+)Gates\.ok === false\)/g)]
  assert.equal(refusals.length, 2, `★ 两处拒绝点都必须仍在（实测 ${refusals.length} 处）`)
})

test('★★ 臂 5：那两种成因在【警告里可分辨】—— 而措辞不许都叫 rejected', () => {
  /**
   * ★ `verifier` 报的那条最难反驳的证据是：判据说 "reported rather than refused"，
   *   而**同一句话的谓语**是 `update_task rejected:`。
   *   ⇒ ★ 所以警告里必须说出**是哪种成因**，而不是笼统一句。
   */
  assert.match(code, /could not be measured/, '★ unmeasured 那一支要说"测不成"')
  assert.match(code, /nothing was evaluated/, '★ skippedAll 那一支要说"没跑"')
  /**
   * ★ 而"rejected"只该出现在【真拒绝】那两处（dispatch / completion 各一处）。
   *   ★ 注释里的不算（那是描述这个动作的文字）—— 所以数的是**代码里**的模板字符串。
   */
  const rejected = [...code.matchAll(/`update_task rejected:/g)].length
  assert.equal(rejected, 2, `★ "rejected" 只该出现在真正的拒绝那两处（实测 ${rejected}）`)
})
