/**
 * ── `dispatch.changed-paths` 的三臂夹具 ────────────────────────────────────────
 *
 * 契约要求每条判据自带三臂（`docs/GATE-REGISTRY.md` §6）：
 *
 *   臂 1（伪造臂）：成员自报的 changedPaths 【与其会话里真实发生过的写入对不上】
 *                   ⇒ 期望 blocked
 *   臂 2（未测量臂）：拿不到该成员的会话事件（没有 observation） ⇒ 期望 unmeasured
 *                     ★ 不是 ok —— 没能观察就不能声称它诚实
 *   臂 3（对照臂）：自报的与观察到的【一致】 ⇒ 期望 ok
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-05）：`changedPaths` 是**成员自己填的一串字符串**。上游只校验
 * 它的【形状】（是不是 workspace 相对、是否落在 inScope/outOfScope 内），从不校验
 * 它是否【对应任何真实发生过的写入】。
 *
 * ⇒ 一个成员可以零工作、自报一组漂亮的 inScope 路径，而判据层无从分辨。
 *   这与 `verify-rerun` 堵住的那个洞是【同源】的：把判据的输入交给被判的一方。
 *
 * ★ 为什么它不是 verify-rerun 的重复：verify-rerun 检查【命令真的跑了吗】，
 *   本判据检查【文件真的是这个成员动的吗】。一个成员可以真跑命令却虚报改动。
 *
 * ── 归属证据从哪来（★ 这是本判据的关键，也是它不需要 worktree 的原因）──────────
 *
 * `dsh-tool-fs` 给每次写入/编辑的 `tool/result` 挂 `meta.diffs: [{path, oldText, newText}]`
 * （已从 app.asar 抽出该包源码核实：`isFileDiff` 要求 `path: string`）。
 * 而这些事件可以由插件已有的 `sessionOwnEvents(memberAgent.session)` 读到。
 *
 * ⇒ 归因走【会话事件】，不走 cwd，所以绕开 START-HERE §5②「不能改 cwd」的限制。
 * ⇒ 判据本身仍是纯数据变换：调用方把观察结果传进来，判据不 import 任何 I/O。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gate, appliesTo, id, point } from '../lib/gates/dispatch/changed-paths.js'

/**
 * 收窄助手。★ 它们把"这条断言期望哪一种裁决"写进断言本身，
 * 于是"我期望被拒"与"我期望未测量"在测试里也不同形（与 verify-rerun 的夹具同构）。
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

/** 一个最小 context：任务契约 + 成员自报 + 观察到的真实写入。 */
function ctx({ inScope = [], outOfScope = [], changedPaths, observed, hasObservation = true }) {
  return {
    task: { id: 't1', kind: 'implementation', inScope, outOfScope },
    update: { changedPaths },
    observedChangedPaths: hasObservation ? (observed ?? []) : undefined,
  }
}

test('臂 1 ★ 伪造臂：自报改了一个从没被写过的文件 ⇒ 被拒，且指名那个文件', async () => {
  const verdict = await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts', 'src/b.ts'],
    // 真实只写过 src/a.ts
    observed: ['src/a.ts'],
  }))
  const blockers = expectBlocked(verdict)
  assert.equal(blockers.length, 1, '★ 只报真的对不上的那个，不连坐')
  assert.match(blockers[0], /src\/b\.ts/, '★ 必须指名是哪个文件')
  assert.match(blockers[0], /no write to it was ever observed/, '★ 必须说清是哪一类问题')
})

test('臂 1b ★ 伪造臂：零工作却自报一串漂亮的 inScope 路径 ⇒ 全报（不短路）', async () => {
  const verdict = await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts', 'src/b.ts'],
    observed: [],
  }))
  assert.equal(expectBlocked(verdict).length, 2, '★ 一次给全，而不是修一个又冒一个')
})

test('臂 1c ★ 伪造臂：真实写过但【没自报】⇒ 被拒（隐瞒改动与虚报改动同样危险）', async () => {
  const verdict = await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts'],
    observed: ['src/a.ts', 'src/secret.ts'],
  }))
  const blockers = expectBlocked(verdict)
  assert.equal(blockers.length, 1)
  assert.match(blockers[0], /src\/secret\.ts/)
  assert.match(blockers[0], /not reported/)
})

test('臂 2 ★ 未测量臂：拿不到该成员的会话事件 ⇒ unmeasured，不是 ok', async () => {
  const verdict = await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts'],
    hasObservation: false,
  }))
  const reason = expectUnmeasured(verdict)
  assert.match(reason, /could not be observed|no session events/i)
})

test('臂 3 ★ 对照臂：自报与观察一致 ⇒ ok（证明判据不误伤正常成员）', async () => {
  const verdict = await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts', 'src/b.ts'],
    observed: ['src/b.ts', 'src/a.ts'],
  }))
  expectOk(verdict)
})

test('臂 3b 对照臂：顺序不同不算不一致（集合语义，不是序列语义）', async () => {
  const verdict = await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts', 'src/b.ts'],
    observed: ['src/b.ts', 'src/a.ts'],
  }))
  expectOk(verdict)
})

test('臂 3c 对照臂：同路径重复出现 ⇒ 按集合去重后仍一致', async () => {
  const verdict = await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts', 'src/a.ts'],
    observed: ['src/a.ts'],
  }))
  expectOk(verdict)
})

test('appliesTo ★ 三个条件缺一不可', async () => {
  // 有变更声明 + 非终态 + 有观察 ⇒ 生效
  assert.equal(appliesTo({
    task: { id: 't1', kind: 'implementation' },
    update: { changedPaths: ['src/a.ts'] },
    observedChangedPaths: [],
  }), true)
  // 没声明 changedPaths ⇒ 不生效（没有可核对的东西）
  assert.equal(appliesTo({
    task: { id: 't1', kind: 'implementation' },
    update: {},
    observedChangedPaths: [],
  }), false)
})

test('判据元数据：id / point 与注册表的插入点一致', async () => {
  assert.equal(id, 'dispatch.changed-paths')
  assert.equal(point, 'dispatch')
})
