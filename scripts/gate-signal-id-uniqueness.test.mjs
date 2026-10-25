#!/usr/bin/env node
/**
 * ── 判据：信号流的 **id 不许撞车**（t93）──────────────────────────────────────────
 *
 * ── 它防的是一个**真缺陷**（MEASURED，2026-10-16）────────────────────────────────
 *
 * `.agent-teams/evolution/signals.jsonl` 里，**五种 id 各出现两次**
 * （`e-0001` … `e-0005`），原因是 `nextSignalId` 只认得**一种序列化格式**：
 *
 * ```
 * t88 手工补录的 10 行： {"id": "e-0001", …}   ← ★ 冒号后有空格
 * t87 appendSignal 写的： {"id":"e-0001",…}     ← ★ 无空格
 * 旧正则            ： /"id":"e-(\d+)"/         ← ★ 只认第二种
 * ⇒ 那 10 行对 max 完全不可见 ⇒ max 从 0 起算 ⇒ 分配 e-0001 ⇒ 覆盖已存在的 e-0001
 * ```
 *
 * ★★ 后果不是"编号难看"：**`e-0001` 指向两条不同的记录**
 *   ⇒ **任何按 id 回溯的读取端会读到错的那条**。
 *
 * ── ★★★ 而本文件测的**不是**"正则补了 `\s*` 没有"（那只是本次的修法）──────────────
 *
 * 它测的是两条**性质**，两者都与"具体怎么写正则"无关：
 *
 *   ① **读得到**：混有**任意空白写法**时，已用的最大编号必须被认出来
 *      ⇒ 分配出的 id **不许撞已存在的任何一个**。
 *   ② **并发不撞**：**并发**两次"分配并追加" ⇒ **两个不同的 id**。
 *
 * ★ 而 ① 的**边界**写着：本判据**不承诺** reader 认得出**任何** JSON 写法
 *   （例如 `{"id" : "e-1"}` 这种编号未补零的）—— 它承诺的是**两种已实测存在的写法**，
 *   外加**容忍空白**的正则兜底。★ 把边界写成"认识所有格式"是一种**假保证**。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const {
  maxSignalNumberIn,
  nextSignalId,
  duplicateSignalIds,
  appendSignalClaimingId,
  signalsPathOf,
} = await import('../lib/evolution/collect.js')

/** 造一个临时 stateRoot。 */
async function scratch() {
  return await mkdtemp(join(tmpdir(), 't93-ids-'))
}

/** 一条最信号的形状（id 由调用方定）。 */
const signalWithId = (id) => ({
  id,
  at: 1,
  kind: 'rejection',
  source: { where: 't93-fixture' },
  message: `probe ${id}`,
  collection: { collected: true },
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 1：★★ 混有【两种写法】⇒ max 必须被认出来（这是撞车的根因，也是核心）
 * ───────────────────────────────────────────────────────────────────────────── */

test('★★ 臂 1：两种序列化格式共存 ⇒ 已用的最大编号必须被读到（不许漏掉带空格的那些）', () => {
  /**
   * ★★ **这条臂的形状就是那次事故**：带空格的在前、无空格的在中间。
   *   旧正则（`/"id":"e-(\d+)"/`）对这段的读数会是 **9**（只看到无空格那行）
   *   ⇒ 分配出 `e-0010` ⇒ **撞上已存在的 `e-0010`**。
   */
  const mixed = [
    '{"id": "e-0003", "kind":"a"}',       // ★ 带空格（t88 的形状）
    '{"id":"e-0009","kind":"b"}',         // ★ 无空格（t87 的形状）
    '{"id" :  "e-0005", "kind":"c"}',     // ★ 冒号两侧都有空格
    '{"id"  :"e-0012","kind":"d"}',       // ★ 左有右无
    '{"id": "e-0007", "kind":"e"}',       // ★ 带空格
  ].join('\n')

  const max = maxSignalNumberIn(mixed)
  assert.equal(max, 12,
    '★ 混有带空格（`"id": "x"`）与无空格（`"id":"x"`）两种写法时，'
    + '已用的最大编号必须是 **12**。'
    + `实测 ${max} —— ★ 若得到 9，就是旧缺陷：带空格的那些**完全不可见**`
    + '（而那 5 行里的 e-0012 会让下一次分配撞上它）。')

  /** ★ 而分配出的 id 必须**大于**全部已存在的（这一格才是"不撞"的直接读数）。 */
  const allocated = `e-${String(max + 1).padStart(4, '0')}`
  assert.ok(max + 1 > 12,
    `★ 分配出的 ${allocated} 必须大于已用的 12 —— 否则它会撞上 e-0012 那一行`)
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 2：★★ 反向半边 A —— **真的建一个文件**，两种写法各一行，然后分配
 * ───────────────────────────────────────────────────────────────────────────── */

test('★★ 臂 2（反向半边 A）：文件里两种写法各一行 ⇒ `nextSignalId` 不许撞已存在的任何一个', async () => {
  const root = await scratch()
  try {
    await mkdir(join(root, 'evolution'), { recursive: true })
    /**
     * ★ **两种写法各一行，且"带空格的那一行编号更大"** ——
     *   这样"漏掉带空格的行"⇒ 分配出的 id **必然撞上**它。
     *   ★ 这是刻意的：若把带空格那行设成**更小**的编号，旧缺陷也会"侥幸不撞"，
     *     那条臂就**测不出东西**。
     */
    const spacedBigger = '{"id": "e-0007", "kind":"spaced"}\n'
    const tightSmaller = '{"id":"e-0002","kind":"tight"}\n'
    await writeFile(signalsPathOf(root), spacedBigger + tightSmaller, 'utf8')

    const allocated = await nextSignalId(root)
    const existing = ['e-0007', 'e-0002']
    assert.ok(!existing.includes(allocated),
      `★ 分配出的 ${allocated} 撞上了已存在的 ${existing.join(' / ')} —— `
      + '那就是旧缺陷：带空格的那一行对 max 不可见。'
      + '（★ 判据：**带空格那行编号更大**时，"漏掉它"必然导致相撞。）')
    assert.equal(allocated, 'e-0008',
      `★ 既用的最大是 7（带空格那行）⇒ 下一个必须是 e-0008；实测 ${allocated}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 3：★★★ 反向半边 B —— **并发两次分配并追加 ⇒ 两个不同的 id**
 * ───────────────────────────────────────────────────────────────────────────── */

test('★★★ 臂 3（反向半边 B）：并发两次 appendSignalClaimingId ⇒ 两个不同的 id，且两条都能读回', async () => {
  const root = await scratch()
  try {
    /**
     * ★★ **这条臂测的是"读-算-写"那个竞态**，与序列化格式无关 ——
     *   即使正则完全正确，两个并发调用者也会读到同一个 max。
     *   ★ 对照（本任务实测）：把三段**拆开**跑 12 次并发 ⇒ **12 个 id 全是 e-0001**（unique 1/12）。
     */
    const [a, b] = await Promise.all([
      appendSignalClaimingId(root, signalWithId),
      appendSignalClaimingId(root, signalWithId),
    ])
    assert.ok(a !== undefined && b !== undefined,
      `★ 两次追加都必须成功（实测 ${a} / ${b}）—— 返回 undefined 是"写不进去"，不是"没撞车"`)
    assert.notEqual(a, b,
      `★★ 并发两次分配必须得到**不同**的 id，实测两次都是 ${a} —— `
      + '那说明"读 max → 算 id → 追加"这一段**没有被串行化**')

    /** ★★ 而"两个 id"还不够：**两条都得真的在盘上、且都能 parse**。 */
    const text = await readFile(signalsPathOf(root), 'utf8')
    const lines = text.split('\n').filter((line) => line !== '')
    assert.equal(lines.length, 2, `★ 两次调用 ⇒ 盘上必须正好 2 行，实测 ${lines.length}`)
    const idsOnDisk = lines.map((line) => {
      const parsed = JSON.parse(line)
      return parsed.id
    })
    assert.deepEqual([...idsOnDisk].sort(), [a, b].sort(),
      '★ 盘上的 id 必须**正好**是那两次返回的（"返回了但没写进去"与"写进去了"不许同形）')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 4：★★ 并发压力（12 次）—— 让"偶尔不撞"与"真的串行"分开
 * ───────────────────────────────────────────────────────────────────────────── */

test('★★ 臂 4：12 次并发 ⇒ 12 个不同 id（"偶尔对了"与"串行化生效了"必须分开）', async () => {
  const root = await scratch()
  try {
    /**
     * ★ 为什么 2 次不够：并发只有两条时，调度**可能**恰好把它们分开
     *   ⇒ 一个**坏**实现也可能侥幸给出两个不同 id。
     *   ★★ 12 次把"侥幸"压到很低（实测：拆开跑的 12 次并发 ⇒ **unique 1/12**）。
     */
    const ids = await Promise.all(Array.from({ length: 12 }, () => appendSignalClaimingId(root, signalWithId)))
    const unique = new Set(ids)
    assert.equal(unique.size, 12,
      `★★ 12 次并发必须给出 **12 个不同**的 id，实测 ${unique.size} 个（${ids.join(' ')}）`)

    const text = await readFile(signalsPathOf(root), 'utf8')
    const lines = text.split('\n').filter((line) => line !== '')
    assert.equal(lines.length, 12, `★ 12 次调用 ⇒ 盘上 12 行，实测 ${lines.length}`)
    /** ★ 每一行都要能 parse（"行数对"与"行内容对"是两件事）。 */
    for (const [index, line] of lines.entries()) {
      assert.doesNotThrow(() => JSON.parse(line), `★ 第 ${index + 1} 行必须是合法 JSON`)
    }
    /** ★ 而编号必须**连续**（1..12）—— 那说明它们真的在同一条序列上。 */
    const numbers = [...unique].map((id) => Number(/-(\d+)$/.exec(id)?.[1])).sort((x, y) => x - y)
    assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      '★ 12 个 id 必须**连续**（1..12）—— 有空洞说明有编号被跳过（或撞掉了一条）')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 5：★★ 既有的撞车是**可区分的读数**（不许静默修好、也不许静默无视）
 * ───────────────────────────────────────────────────────────────────────────── */

test('★★ 臂 5：`duplicateSignalIds` 报出「哪个 id 撞了、撞在第几行」', () => {
  /**
   * ★ 那五组撞车是**既成事实**（审计数据不许改写）⇒ 正确的处置是
   *   **让读取端能先问一句**，而不是把数据改掉让它们"看起来没撞过"。
   *   ★★ 静默重编号会让「**它曾经撞过**」与「**它从来没撞过**」**同形**
   *     —— 那正是本仓记账最久的形态。
   */
  const text = [
    '{"id": "e-0001", "kind":"a"}',   // 第 1 行（带空格）
    '{"id":"e-0002","kind":"b"}',     // 第 2 行
    '{"id":"e-0001","kind":"c"}',     // 第 3 行 ← ★ 与第 1 行撞
    '{"id": "e-0003", "kind":"d"}',   // 第 4 行
  ].join('\n')

  const duplicates = duplicateSignalIds(text)
  assert.deepEqual(duplicates, [{ id: 'e-0001', lines: [1, 3] }],
    '★ 必须报出**撞的是哪个 id**（e-0001）与**撞在哪两行**（1 与 3）—— '
    + '只报"有重复"读的人不知道去查哪里。'
    + `实测 ${JSON.stringify(duplicates)}`)

  /** ★ 对照：**没有重复**时它必须为空（否则"报重复"是恒真的，等于没报）。 */
  const clean = ['{"id":"e-0001"}', '{"id":"e-0002"}'].join('\n')
  assert.deepEqual(duplicateSignalIds(clean), [],
    '★ 对照：没有重复时必须是空 —— 否则上面那条断言没有分辨力')
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 6：★ 前提臂 —— 本判据**真的能看见那个文件名**（否则上面全是空话）
 * ───────────────────────────────────────────────────────────────────────────── */

test('★ 臂 6（前提）：`signalsPathOf` 指向 `evolution/signals.jsonl`，且空文件从 1 起', async () => {
  /**
   * ★ 没有这一臂，上面每一臂都可能在与"一个根本不存在的文件"交互 ——
   *   而那种失败与"文件是空的"**同形**。
   */
  const root = await scratch()
  try {
    assert.equal(signalsPathOf(root), join(root, 'evolution', 'signals.jsonl'),
      '★ 路径必须由 `stateRoot` 推出（不许猜）')
    /** ★ 文件不存在 ⇒ 从 1 开始（**不是**"猜一个大的"）。 */
    assert.equal(await nextSignalId(root), 'e-0001',
      '★ 台账不存在时，第一个 id 必须是 e-0001')
    /** ★ 而空串的读数是 0（不是 1，也不是抛）。 */
    assert.equal(maxSignalNumberIn(''), 0, '★ 空文本 ⇒ 最大编号 0（没有任何已用的）')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
