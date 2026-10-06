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
import { gate, appliesTo, id, point, requires } from '../lib/gates/dispatch/changed-paths.js'

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

// ─────────────────────────────────────────────────────────────────────────────
// ★ 输入面（t6 的 B 层 + A 层）：声明与实测必须一致
// ─────────────────────────────────────────────────────────────────────────────
//
// 这一节有一条**独立的轴**：它不问"判据算得对不对"（上面几条已经问了），
// 它问「这条判据要的输入，是不是真的被接上了」—— 而那是上一轮五次同形缺陷
// 全部落在的那一格（inScope 缺席 → verify 缺席 → 执行器缺席 → event 名不匹配
// → 窗口表没接线），五次都不是判据写错。

test('★ 输入面声明：`requires` 与本判据的未测量臂【逐条对齐】', () => {
  /**
   * ── ★ 这条断言存在的原因：声明与未测量臂不一致就是【新的静默失效】─────────────
   *
   * 判据在某个输入缺席时说"我没能测量"，而 `requires` 里没有那一格 ⇒ 核对层
   * 永远不会报它缺 ⇒ 那次未测量在核对结果里是**看不见的**。于是"接线漏了一格"
   * 与"这条判据本来就只需要这些"同形 —— 正是本机制要消灭的东西。
   *
   * ⇒ 钉法：直接问 `gate()` 本人。把 `observedChangedPaths` 拿掉，判据必须
   *   说 unmeasured；而那个格必须出现在 requires 里。
   */
  assert.deepEqual([...requires], ['observedChangedPaths'], '★ 本判据要 ctx 的哪几格，只此一格')

  // 把声明的每一格逐一拿掉 ⇒ 判据必须「说不出话」（unmeasured），而不是 ok
  const full = {
    task: { id: 't1', kind: 'implementation', inScope: ['src/'] },
    update: { changedPaths: ['src/a.ts'] },
    observedChangedPaths: ['src/a.ts'],
  }
  assert.equal(gate(full).ok, true, '★ 前提：一格不缺时它是 ok —— 否则下面那条"拿掉一格"证明不了任何事')

  assert.equal(
    gate({ ...full, observedChangedPaths: undefined }).ok,
    false,
    '★ 声明的这一格缺席 ⇒ 判据必须说不出话；若它仍返回 ok，那这一格就不该进 requires',
  )
  assert.match(
    String(gate({ ...full, observedChangedPaths: undefined }).unmeasured),
    /could not be observed/,
    '★ 而且要是"未能观察"这一类，不是"发现问题"那一类',
  )

  /**
   * ★ 反向：**没**声明的格子被拿掉，判据【不许】改变形状。
   *   闸门那两格（task.kind / update.changedPaths）缺席时的正确行为是
   *   `appliesTo` 为假 ⇒ 这条判据根本不被求值 —— 那是"不适用"，不是"缺输入"。
   *   把它们也写进 requires 会把每一次 review 类派发都报成缺格（噪音）。
   */
  assert.equal(requires.includes('task.kind'), false, '★ 闸门格不进 requires：不适用不报')
  assert.equal(requires.includes('update.changedPaths'), false, '★ 同上')
})

test('★ 输入面接线：注册表里读得到声明（转发链上一格都不许漏）', async () => {
  /**
   * ── MEASURED（2026-10-06，本任务）：这条断言上一个版本是【红的】─────────────
   *
   * 判据文件声明了 `requires`、核对层也建好了，而 `asRegistration`（装配点）
   * 只转发 id/point/description/gate/appliesTo ⇒ `registry.list()` 里
   * **这一格不存在**，于是控制台读到的"没声明"与真的没声明同形。
   *
   * 这个缺陷的形状与前五次同形问题完全一样：**声明写对了、机制也建好了、
   * 而中间那个白名单没列它** —— 于是它静默地不生效。所以这一条不能只读
   * 判据模块的导出（那会绿），必须读【注册表】。
   */
  const { registry } = await import('../lib/gates/index.js')
  const listed = registry.list().dispatch.find((entry) => entry.id === id)
  assert.ok(listed, '★ 这条判据必须在 dispatch 位置的注册清单里')
  assert.equal(listed.hasRequires, true, '★ `hasRequires` 必须为真 —— 否则装配层又把声明吃掉了')
  assert.deepEqual(listed.requires, ['observedChangedPaths'], '★ 转发之后要逐字等于判据自己的声明')
})

test('★ A 层核对：适用而缺观察 ⇒ 核对【报出缺的是那一格】；不适用 ⇒ 不报', async () => {
  const { registry } = await import('../lib/gates/index.js')

  /**
   * ★ 只在 `dispatch.changed-paths` 自己那一格上断言，不去读同一位置上
   *   `dispatch.worktree` 的读数 —— 那条判据有自己的输入面（另一份写域），
   *   把它的结论混进来，会让本文件在别人改它的时候变红。
   */
  const mine = (evaluation) => evaluation.requires.checks.find((check) => check.id === id)

  // ① 声明了、观察也注入了 ⇒ ok（对照臂）
  const injected = await registry.evaluate('dispatch', {
    task: { id: 't1', kind: 'implementation', inScope: ['src/'] },
    update: { changedPaths: ['src/a.ts'] },
    observedChangedPaths: ['src/a.ts'],
  })
  assert.equal(mine(injected).status, 'ok', '★ 注入了观察 ⇒ 这一格要读成"在场"')
  assert.deepEqual(mine(injected).present, ['observedChangedPaths'])
  assert.deepEqual(mine(injected).missing, [])

  // ② 适用（kind+changedPaths 都在）但没有观察 ⇒ 核对必须【报出它缺】——这是 t3 的验收点
  const withoutObservation = await registry.evaluate('dispatch', {
    task: { id: 't1', kind: 'implementation', inScope: ['src/'] },
    update: { changedPaths: ['src/a.ts'] },
  })
  assert.equal(mine(withoutObservation).status, 'incomplete', '★ 输入面缺一格 ⇒ 核对必须报出来')
  assert.deepEqual(mine(withoutObservation).missing, ['observedChangedPaths'], '★ 而且要指名是【哪一格】')
  assert.match(
    withoutObservation.requires.missing.join('\n'),
    /observedChangedPaths/,
    '★ 人话清单里也要指名道姓',
  )

  // ③ 不适用（非 implementation/repair）⇒ 这一格缺席【不报】—— 不制造噪音
  const notApplicable = await registry.evaluate('dispatch', { task: { id: 't1', kind: 'review' }, update: {} })
  assert.equal(mine(notApplicable).status, 'skipped', '★ 不适用 ⇒ 没核对，且与"核对了、都齐"不同形')
  assert.equal(notApplicable.requires.incomplete, 0, '★ 不适用不许产出噪音')

  // ④ 观察到了、但确实没有写入（`[]`）⇒ 在场，不是缺格
  const observedNothing = await registry.evaluate('dispatch', {
    task: { id: 't1', kind: 'implementation' },
    update: { changedPaths: ['src/a.ts'] },
    observedChangedPaths: [],
  })
  assert.equal(
    mine(observedNothing).status,
    'ok',
    '★ `[]` = "看过了、确实没写"，与"没看过"必须不同形（判据自己用 blocked 区分这两件事）',
  )
  assert.equal(
    gate({ task: { id: 't1', kind: 'implementation' }, update: { changedPaths: ['src/a.ts'] }, observedChangedPaths: [] }).ok,
    false,
    '★ 而`[]` 下自报了一条虚构改动 ⇒ 判据必须拒绝它（"在场"不等于"通过"）',
  )
})
