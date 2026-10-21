/**
 * ── ★★★ 提案必须有**生产写方**（R2.2 / N2 的第 ② 步）────────────────────────────────
 *
 * ── 这个文件抓的是什么 ────────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-21 审计）：
 *
 * ```
 * $ grep -rn "createTaskParamsOf(" src/ --include=*.ts | grep -v propose.ts   ⇒ 空
 * $ ls .agent-teams/evolution/                                                ⇒ index.json  signals.jsonl
 *                                                                               （没有 proposals.jsonl）
 * $ grep -rn "routeSignals(" src/ | grep -v propose.ts                        ⇒ 唯一调用方是 readProposalPipeline
 * ```
 *
 * ⇒ ★★ 整条流水线在**读的时候现算**：`snapshot` 每次点开面板都把同一批信号重算一遍提案，
 *   然后把它们**丢掉**（不落盘、不派发）。于是：
 *
 * ```
 * 读数上说得出「产出了 2 份提案」    ← 这是真的
 * 而盘上从来没有过一份提案            ← 这也是真的
 * ⇒ 「算出来了」与「有过」不同形，而它们在面板上同形。
 * ```
 *
 * ── ★ 本任务只做**最小**的一步：让盘上真的有提案 ───────────────────────────────────
 *
 * **不做**：不派发（`createTaskParamsOf` → `create_task` 仍然是人的动作）。
 * ⇒ 所以 `R2.2`（提案真的变成过一条任务）**仍然是 gap** —— 本条不声称它闭合了。
 *   一条"写了但没人读"的记录与一条"根本没写过"的记录不同，而它与"派发过"也不同。
 *
 * ── ★★ 三条臂是这一组的骨架 ──────────────────────────────────────────────────────
 *
 * ```
 * 臂 1  一条 rejection 信号 ⇒ 盘上出现一份提案，且形状可喂 create_task
 * 臂 2  一条 success 信号  ⇒ **不**产出提案（modality=none 是决定，不是"忘了写"）
 * 臂 3  ★ 并发 20 次 ⇒ 提案 id **不撞车**（分配与占用是一步）
 * ```
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { observe } = await import(join(ROOT, 'lib', 'evolution', 'collect.js'))
const { proposalsPathOf } = await import(join(ROOT, 'lib', 'evolution', 'proposals.js'))
const { CREATE_TASK_PARAM_KEYS, unknownCreateTaskKeys } = await import(join(ROOT, 'lib', 'evolution', 'propose.js'))

/** 一个临时 stateRoot，跑完删掉。 */
async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'proposal-writer-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

/** 读盘上的提案（逐行 parse；坏行单独计数，不许静默丢）。 */
async function proposalsOnDisk(stateRoot) {
  const path = proposalsPathOf(stateRoot)
  if (!existsSync(path)) return { rows: [], bad: 0, absent: true }
  const text = await readFile(path, 'utf8')
  const rows = []
  let bad = 0
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      rows.push(JSON.parse(line))
    } catch {
      bad += 1
    }
  }
  return { rows, bad, absent: false }
}

/** 走**真实入口**采集一条信号（不直接写盘：那会绕开被测的那条路径）。 */
async function observeOne(stateRoot, patch = {}) {
  return observe({
    stateRoot,
    where: 'validateCreateTask',
    message: 'create_task rejected: inScope declares no build artifact under "lib/"',
    kind: ['unwired'],
    component: 'contract',
    signalKind: 'rejection',
    now: Date.now(),
    /** ★ 与生产同形：`evaluateCollection` 缺席 ⇒ 采集判据不跑、但写盘照旧。 */
    warn: () => {},
    ...patch,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★ 一条 rejection ⇒ 盘上出现一份提案，且形状可喂 create_task
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 1：一条 rejection 信号 ⇒ `proposals.jsonl` 出现，且提案的形状可喂 `create_task`', async (t) => {
  const stateRoot = await workspace(t)
  const signalId = await observeOne(stateRoot)
  assert.equal(typeof signalId, 'string', '前提：信号本身要写成功')

  const onDisk = await proposalsOnDisk(stateRoot)
  assert.equal(onDisk.absent, false, '★★ 盘上没有 `proposals.jsonl` —— 这正是本条要修的那一格')
  assert.equal(onDisk.bad, 0, '★ 坏行 ⇒ 提案流不可读，而"读不出来"与"没有提案"必须不同形')
  assert.equal(onDisk.rows.length, 1, '★★ 一条 rejection 应当产出**恰好一份**提案')

  const proposal = onDisk.rows[0]
  assert.match(proposal.id, /^p-\d{4}$/, '★ id 形状与 `e-` / `f-` 同族')
  assert.deepEqual(proposal.from, [signalId], '★★ `from` 必须回溯到那条信号（否则这份提案永远说不清从哪来）')
  assert.equal(typeof proposal.contract?.acceptance?.length, 'number')
  assert.ok(proposal.contract.acceptance.length >= 1, '★ 空验收的契约在派发闸门上会被拒 —— 写出来就是假的')
  assert.deepEqual(
    unknownCreateTaskKeys(proposal.contract),
    [],
    '★★ 契约里不许有 `create_task` 不认的键（`additionalProperties: false` 会拒掉它），'
    + `认的键：${CREATE_TASK_PARAM_KEYS.join(', ')}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：success 不产出提案（none 是一个**决定**，不是"忘了写"）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 2：一条 `success` 信号 ⇒ **不**产出提案（`none` 是决定，不是遗漏）', async (t) => {
  const stateRoot = await workspace(t)
  await observeOne(stateRoot, { signalKind: 'success', message: 'a change landed and the reading improved' })
  const onDisk = await proposalsOnDisk(stateRoot)
  /** ★ 文件**在**、而**0 条** —— 与"文件不存在"必须不同形。 */
  assert.equal(onDisk.absent, false, '★ 分流跑过了就应当把文件建出来（哪怕 0 条）')
  assert.deepEqual(onDisk.rows, [], '★★ success ⇒ modality=none ⇒ 没有要改的东西')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★ 并发 ⇒ 提案 id 不撞车
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 3：并发 20 次采集 ⇒ 20 份提案，id **无重复**（分配与占用是一步）', async (t) => {
  const stateRoot = await workspace(t)
  await Promise.all(Array.from({ length: 20 }, (_, index) => observeOne(stateRoot, {
    message: `concurrency probe #${index}`,
  })))
  const onDisk = await proposalsOnDisk(stateRoot)
  assert.equal(onDisk.bad, 0)
  assert.equal(onDisk.rows.length, 20, `★ 应当产出 20 份提案，实测 ${onDisk.rows.length} 份`)
  const ids = onDisk.rows.map((row) => row.id)
  assert.equal(
    new Set(ids).size, ids.length,
    '★★ 提案 id 撞车 ⇒ 被覆盖的那一份与"没发生过"同形 —— 这正是 t93 在 signals 上修过的那个缺陷',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：反向半边 —— 采集本身坏了，提案也不许把这次拒绝变成异常
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 4（反向半边）：`stateRoot` 指向一个不可能写入的位置 ⇒ `observe` 仍返回 `undefined` 而**不抛**', async () => {
  const value = await observeOne('/dev/null/not-a-directory')
  assert.equal(value, undefined, '★★ 采集是**旁路**：它坏了不许把一次拒绝变成一次异常')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：提案只写一次（重放同一条信号不许重复产出）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 5：同一批采集调两次 ⇒ 两份**不同**提案（一条信号一次，不是去重后的全局集合）', async (t) => {
  const stateRoot = await workspace(t)
  await observeOne(stateRoot, { message: 'first' })
  await observeOne(stateRoot, { message: 'second' })
  const onDisk = await proposalsOnDisk(stateRoot)
  assert.equal(onDisk.rows.length, 2)
  assert.deepEqual(
    onDisk.rows.map((row) => row.id).sort(), ['p-0001', 'p-0002'],
    '★ id 从既有最大编号推进 —— 不许每次从 1 开始（那会让第二份覆盖第一份的编号空间）',
  )
})
