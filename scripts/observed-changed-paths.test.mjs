/**
 * ── `observedChangedPaths` 的夹具 ──────────────────────────────────────────────
 *
 * 这是 `dispatch.changed-paths` 判据的【证据来源】。判据本身已经有三臂
 * （`gate-changed-paths.test.mjs`），但它喂给判据的那个观察结果在这里产生
 * ⇒ 观察本身也必须被钉住，否则判据是在拿一个没被验证过的输入做裁决。
 *
 * ★ 最关键的一条：`undefined`（没能测量）与 `[]`（测了，是零）必须不同形。
 *   把它们混起来，一次读取失败就会伪装成"这个成员没动过任何文件"。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { observedChangedPaths } from '../lib/harness-compat.js'

/** 一个只带 ownEvents 的最小 Session 替身。 */
function session(events) {
  return { ownEvents: () => events, header: {} }
}

/** 一条带 meta.diffs 的 tool/result，形状与 dsh-tool-fs 的 isFileDiff 一致。 */
function toolResult(diffs) {
  return { type: 'tool/result', turn: 1, step: 1, meta: { diffs } }
}

test('★ 对照臂：读出真实写入过的路径', () => {
  const paths = observedChangedPaths(session([
    toolResult([{ path: 'src/a.ts', oldText: 'x', newText: 'y' }]),
    toolResult([{ path: 'src/b.ts', oldText: null, newText: 'new' }]),
  ]))
  assert.deepEqual(paths, ['src/a.ts', 'src/b.ts'])
})

test('★ 未测量臂：没有 tool/result ⇒ undefined（不是 []）', () => {
  const paths = observedChangedPaths(session([
    { type: 'user/message', turn: 1, step: 1 },
  ]))
  assert.equal(paths, undefined, '★ 读不到 ≠ 没改动')
})

test('★ 未测量臂：读不到事件（ownEvents 抛错）⇒ undefined', () => {
  const broken = { ownEvents: () => { throw new Error('log unavailable') }, header: {} }
  assert.equal(observedChangedPaths(broken), undefined)
})

test('★ 测了是零：有 tool/result 但都没有 diffs ⇒ []（不是 undefined）', () => {
  const paths = observedChangedPaths(session([
    { type: 'tool/result', turn: 1, step: 1, meta: { path: 'src/a.ts', offset: 0, lines: 10 } },
  ]))
  assert.deepEqual(paths, [], '★ 这条夹具就是"测了是零"与"没能测量"的分界')
})

test('畸形 meta 不抛错，且不被当成路径', () => {
  const paths = observedChangedPaths(session([
    { type: 'tool/result', meta: null },
    { type: 'tool/result', meta: { diffs: 'not-an-array' } },
    { type: 'tool/result', meta: { diffs: [null, 42, { path: 123 }] } },
  ]))
  assert.deepEqual(paths, [], '★ 形状不认识 ⇒ 不采信，但不是崩')
})

test('重复路径去重', () => {
  const paths = observedChangedPaths(session([
    toolResult([{ path: 'src/a.ts', oldText: null, newText: 'x' }]),
    toolResult([{ path: 'src/a.ts', oldText: 'x', newText: 'y' }]),
  ]))
  assert.deepEqual(paths, ['src/a.ts'])
})
