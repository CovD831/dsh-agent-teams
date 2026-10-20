/**
 * ── `collected` 三态的臂（N1 / t2 的实现，t15 复核后补）────────────────────────
 *
 * ── 为什么这个文件存在（t15 的读数，不是我的判断）───────────────────────────
 *
 * t15 的定向突变 C：**删掉顶层 `collected`** ⇒ 全量套件**零条新增红**。
 * 而 `collected` 正是 N1 的三条验收之一（"采了 / 不采 / 判不了"不同形）。
 * ⇒ 一个**修好了而没有任何东西守着的格**，与一个**没修的格**在今天就同形，
 *   在下一次改它时分形。
 *
 * ★ 现有的 `scripts/gate-collection-health-readout.test.mjs` 里也有 `collected`
 *   字样 —— 但那是**夹具的输入**（造一行带 `collected: false` 的历史信号），
 *   不是"新写入的行必须带这个键"的断言。两者读起来像同一件事，测的是两件事。
 *
 * ── 这一组臂钉三件事 ─────────────────────────────────────────────────────────
 *
 *   ① `collectedFieldOf` 的**三个输入给出三个不同的值**（纯函数层）
 *   ② `observe()` 真写出去的那一行**一定带这个键**（写盘层；`undefined` 会
 *      被 `JSON.stringify` 静默丢掉 —— 那是 N1.1 的真根因）
 *   ③ ★ 反向半边：把 `collected` 从落盘对象里删掉 ⇒ ① 或 ② 必须红
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { collectedFieldOf, observe } = await import(join(ROOT, 'lib', 'evolution', 'collect.js'))

/** 读台账（`signals.jsonl`），逐行 parse。缺文件 ⇒ 空数组（**不是**错误）。 */
function readSignals(stateRoot) {
  const file = join(stateRoot, 'evolution', 'signals.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：纯函数层 —— 三个输入三个值，且**不许有两种输入落同一个值**
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 1：`collectedFieldOf` 三态 —— 三个输入给出三个**互不相同**的值', () => {
  const yes = collectedFieldOf({ collected: true })
  const no = collectedFieldOf({ collected: false })
  const unknown = collectedFieldOf({ collected: undefined })

  assert.equal(yes, 'collected')
  assert.equal(no, 'skipped')
  assert.equal(unknown, 'unmeasured')

  /**
   * ★ 这一条比上面三条更要紧：逐条相等只证明"每个输入映射对了"，
   *   而**三个值互不相同**才证明"三态没有在某个输入上合流"。
   */
  assert.equal(new Set([yes, no, unknown]).size, 3, '★ 三个值必须互不相同 —— 否则某两态在读数上同形')

  /**
   * ★★ 反向对照：把两个不同的输入映到同一个值，就**必须**被这条抓到。
   *   （用一次本地重实现来演示判据的方向，而不是相信上面三行永远对。）
   */
  const collapsed = (d) => (d.collected === true ? 'collected' : 'unmeasured')  // 故意把 false 并进 unmeasured
  assert.equal(
    new Set([collapsed({ collected: true }), collapsed({ collected: false }), collapsed({ collected: undefined })]).size,
    2,
    '★ 一个把 false 并进 unmeasured 的实现只给出 2 个值 —— 本臂第一条断言会红',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★★ 写盘层 —— `observe()` 写出的那一行**一定带 `collected` 键**
// ─────────────────────────────────────────────────────────────────────────────
test('★★★ 臂 2（落盘臂）：`observe()` 写出的行一定带 `collected` 键（`undefined` 会被 JSON.stringify 丢掉）', async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), 'collected-'))
  try {
    /**
     * ★ 三条路径各写一行，覆盖三态：
     *   · 没有 `evaluateCollection`   ⇒ `collection.collected === undefined` ⇒ `'unmeasured'`
     *   · 判据全部 ok                 ⇒ `true`  ⇒ `'collected'`
     *   · 判据有一条 blocked          ⇒ `false` ⇒ **不写这一行**（那是判据的决定，不是遗漏）
     *
     * ★ 而 ③ 那条**不写**本身也要有读数：`observe` 返回 `undefined`，台账不增长。
     *   若把"不采"也写成一行，那"判据说不采"与"采了但内容空"会同形。
     */
    await observe({
      stateRoot, where: 'arms/probe-a', message: 'no collection evaluator', now: 1,
    })
    await observe({
      stateRoot, where: 'arms/probe-b', message: 'all gates ok', now: 2,
      evaluateCollection: async () => ({ ok: true, blockers: [], ran: [] }),
    })
    const skipped = await observe({
      stateRoot, where: 'arms/probe-c', message: 'a gate said no', now: 3,
      evaluateCollection: async () => ({ ok: false, blockers: ['nope'], ran: [] }),
    })

    const rows = readSignals(stateRoot)
    assert.equal(rows.length, 2, `★ 只有两行落盘（第三条判据说"不采"）。实测 ${rows.length} 行：${JSON.stringify(rows.map((r) => r.source?.where))}`)
    assert.equal(skipped, undefined, '★ 判据说"不采" ⇒ observe 返回 undefined（不是抛，也不是写一行空的）')
    assert.equal(rows.some((r) => r.source?.where === 'arms/probe-c'), false, '★ "不采"的那条不许出现在台账里')

    for (const row of rows) {
      /**
       * ★★★ 这就是 N1.1 的真根因：`undefined` 会被 `JSON.stringify` **静默丢掉**，
       *   于是"这一格没写"与"这一格的值是 undefined"在盘上同形。
       *   ⇒ 写侧必须把 `undefined` 换成 `null`，键**永远在场**。
       */
      assert.equal(
        'collected' in row, true,
        `★★★ 每一行都必须带 collected 键（实测缺：${JSON.stringify(row.source?.where)}）——`
        + ' ★ 缺了它就说明写侧把 undefined 交给了 JSON.stringify，而那个键会被静默吃掉',
      )
      assert.equal(
        ['collected', 'skipped', 'unmeasured'].includes(row.collected), true,
        `★ collected 的值必须是三态之一，实测 ${JSON.stringify(row.collected)}`,
      )
    }

    const byWhere = new Map(rows.map((r) => [r.source?.where, r.collected]))
    assert.equal(byWhere.get('arms/probe-a'), 'unmeasured', '★ 没有判据 ⇒ unmeasured（不是 collected、也不是 skipped）')
    assert.equal(byWhere.get('arms/probe-b'), 'collected', '★ 判据全 ok ⇒ collected')
  } finally {
    rmSync(stateRoot, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★★ 反向半边 —— 这一组臂真的会因为"没写 collected"而红
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 3（反向半边）：这一组臂的判据**真的**会因为键丢失而红', async () => {
  /**
   * ★ 不能只说"臂 2 会红" —— 要在**这里**演示一次键被丢掉之后，同一段断言真的失败。
   *   做法：拿一行真的写出来的记录，删掉那一格，再跑同一条断言逻辑。
   *   ★ 这不是重实现 product —— 它证的是**断言本身**的方向：
   *     若 `'collected' in row` 对一个正常行答 true，那对删除后的行必须答 false。
   */
  const stateRoot = mkdtempSync(join(tmpdir(), 'collected-neg-'))
  try {
    await observe({
      stateRoot, where: 'arms/probe-neg', message: 'neg control', now: 4,
      evaluateCollection: async () => ({ ok: true, blockers: [], ran: [] }),
    })
    const [row] = readSignals(stateRoot)
    assert.ok(row !== undefined, '★ 前提：至少写出了一行')
    assert.equal('collected' in row, true, '★ 正常行带这一格')

    /** ★ 模拟"写侧把它丢了"：`JSON.stringify` 之后 `undefined` 消失，等价于删掉这个键。 */
    const dropped = JSON.parse(JSON.stringify({ ...row, collected: undefined }))
    assert.equal(
      'collected' in dropped, false,
      '★★★ 删掉这一格之后 `in` 必须答 false —— 否则臂 2 的那条断言是恒真的，它测不到任何东西',
    )
  } finally {
    rmSync(stateRoot, { recursive: true, force: true })
  }
})
