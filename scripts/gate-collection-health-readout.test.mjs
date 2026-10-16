/**
 * ── ★★★ t101：采集健康读数【存在】── 读 signals.jsonl + collectionHealthOf 接上生产出口 ──
 *
 * ── 缺口（`EVOLUTION-WIRING-GAP.md` §1 逐字）────────────────────────────────────
 *
 *   `health.ts` 此前**零消费者** —— `collectionHealthOf` 能算，但从没有任何生产路径算过它。
 *   ★ 而"造一个函数 + 一个夹具"不会改变那件事 ⇒ 本夹具钉的是**两段接线**：
 *
 *     ① `readSignalsHealth`（`src/evolution/read.ts`）：读真实 jsonl → 三态 → `HealthRecord[]`
 *     ② `assembleTeamSnapshot`（`src/snapshot.ts`）：**生产出口**（`/state` 路由经
 *        `collectTeamsActivity` 走到这里）真的调用上面那条链
 *
 * ── 本夹具钉的五件事 ────────────────────────────────────────────────────────────
 *
 *   臂 1（反向半边 A）：文件【缺席】⇒ `unmeasured` + `file-absent`（不是空读数、不是 0）
 *   臂 2（反向半边 B）：文件在但零记录 ⇒ `measured` + `records: []`（★ 与 A 不同形）
 *   臂 3（反向半边 C）：一行坏 JSON ⇒ 只跳那一行（`skippedMalformed` 计数），其余照常算
 *   臂 4（读数本身）：两代形状并存（t88 带空格 / t87 不带）都能 parse；
 *                      redundancy 按"不去重"的口径算（撞号是 redundancy 该测的东西）
 *   臂 5（★ 生产出口）：真实 `assembleTeamSnapshot` ⇒ 快照上有 `collectionHealth`
 *                      （有信号）/ 缺席（无信号）—— 证明它**不是零调用**
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { readSignalsHealth } = await import('../lib/evolution/read.js')
const { collectionHealthOf } = await import('../lib/evolution/health.js')
const { assembleTeamSnapshot } = await import('../lib/snapshot.js')

/** 内存版 readFile（生产给 fs/promises.readFile；夹具注入内存版 —— 读与算解耦）。 */
const memFs = (files) => async (path) => {
  const hit = files[path]
  if (hit === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
  return hit
}

const stateRoot = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 't101-'))
  mkdirSync(join(dir, 'evolution'), { recursive: true })
  if (files[join(dir, 'evolution', 'signals.jsonl')] !== undefined) {
    writeFileSync(join(dir, 'evolution', 'signals.jsonl'), files[join(dir, 'evolution', 'signals.jsonl')], 'utf8')
  }
  return dir
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★★ 反向半边 A：文件缺席 ⇒ unmeasured（不是空读数、不是 0）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 1（反向半边 A）：signals.jsonl 缺席 ⇒ unmeasured + file-absent（读数无对象）', async () => {
  const dir = stateRoot({})
  const read = await readSignalsHealth(dir, memFs({}))
  assert.equal(read.status, 'unmeasured', `★ 必须是 unmeasured（实测 ${read.status}）`)
  assert.equal(read.reason, 'file-absent', '★ 理由点名 file-absent')
  /** ★ 与"空读数"不同形：unmeasured 时 records 必为空且没有 refused/skipped 可言。 */
  assert.deepEqual(read.records, [])
  assert.equal(read.refused, undefined, '★ 文件缺席时 refused 缺席（没有行可言，不补 0）')
  assert.equal(read.totalLines, undefined, '★ 行数也缺席（没有行可言）')
  /** ★ 而它喂给 collectionHealthOf 的世界：调用方见到 unmeasured ⇒ 整格缺席（臂 5 验证）。 */
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★★ 反向半边 B：文件在但零记录 ⇒ 与缺席不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2（反向半边 B）：文件在但没有任何记录 ⇒ measured + 空集（与文件缺席不同形）', async () => {
  const dir = stateRoot({ [join('(ROOT)', 'evolution', 'signals.jsonl')]: '' })
  // 用真实路径重放：
  const dir2 = stateRoot({})
  writeFileSync(join(dir2, 'evolution', 'signals.jsonl'), '', 'utf8')
  const read = await readSignalsHealth(dir2, memFs({ [join(dir2, 'evolution', 'signals.jsonl')]: '' }))
  assert.equal(read.status, 'measured', `★ 文件在 ⇒ measured（哪怕零条；实测 ${read.status}）`)
  assert.deepEqual(read.records, [], '★ 零条记录如实给空集')
  assert.equal(read.status !== 'unmeasured', true, '★★ 与臂 1 的 unmeasured 不同形')
  /** ★ 空集口径：redundancy/coverage = 0（health.ts 的空集纪律），refused 空对象。 */
  const health = collectionHealthOf(read.records, read.refused ?? {})
  assert.equal(health.redundancy, 0, '★ 空集 ⇒ redundancy 0（不是 1 —— checkEmptyIsNotPerfect）')
  assert.equal(health.coverage, 0, '★ 空集 ⇒ coverage 0')
  assert.deepEqual(health.refused, {}, '★ 没有任何拒 Absolut')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★★ 反向半边 C：一行坏 JSON ⇒ 只跳那一行
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3（反向半边 C）：一行坏 JSON ⇒ 只跳那一行（skippedMalformed 计数），其余照常算', async () => {
  const good1 = JSON.stringify({ id: 'e-0001', at: '2026-10-13T11:56:23+08:00', kind: 'rejection', source: { where: 'contract' } })
  const good2 = JSON.stringify({ id: 'e-0002', at: '2026-10-14T11:56:23+08:00', kind: 'rejection', source: { where: 'contract' } })
  const dir = stateRoot({})
  const p = join(dir, 'evolution', 'signals.jsonl')
  writeFileSync(p, [good1, '{"id": "e-broken", "at": ', good2].join('\n') + '\n', 'utf8')
  const read = await readSignalsHealth(dir, memFs({ [p]: [good1, '{"id": "e-broken", "at": ', good2].join('\n') + '\n' }))
  assert.equal(read.status, 'measured', '★ 文件在 ⇒ measured（坏行不改变这一态）')
  assert.equal(read.records.length, 2, `★ 两条好行照常进读数（实测 ${read.records.length}）`)
  assert.equal(read.skippedMalformed, 1, `★★ 坏行被【计数地】跳过（实测 ${read.skippedMalformed}）—— 不静默`)
  assert.equal(read.totalLines, 4, '★ 总行数给分母（3 行内容 + 末尾换行产生的空行）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★★ 读数本身：两代形状并存都 parse；redundancy 不去重（撞号是它该测的）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 4：两代形状并存（t88 带空格 / t87 不带）都能 parse；refused 从自带 verdicts 数', async () => {
  /** ★ 逐字复刻两种真实形状：t88 冒号后带空格；t87 无空格（`JSON.stringify(signal)` 默认）。 */
  const t88 = `{"id": "e-0001", "at": "2026-10-13T11:56:23+08:00", "kind": "rejection", "title": "x", "source": {"where": "contract", "gateId": "contract.task-atomicity"}, "routing": {"decision": "hard", "why": "w"}, "message": "m"}`
  const t87 = JSON.stringify({ id: 'e-0006', at: '2026-10-16T06:10:44+08:00', kind: 'rejection', message: 'm', source: { where: 'validateCreateTask', tool: 'agent_teams_create_task' }, collection: { collected: false, verdicts: [{ gateId: 'collection.dedupe', verdict: 'ok' }, { gateId: 'collection.attributable', verdict: 'unmeasured' }] } })
  const t87refused = JSON.stringify({ id: 'e-0007', at: '2026-10-16T07:00:00+08:00', kind: 'rejection', message: 'm2', source: { where: 'validateCreateTask' }, collection: { collected: false, verdicts: [{ gateId: 'collection.attributable', verdict: 'false' }] } })
  const dir = stateRoot({})
  const p = join(dir, 'evolution', 'signals.jsonl')
  const text = [t88, t87, t87refused].join('\n') + '\n'
  writeFileSync(p, text, 'utf8')
  const read = await readSignalsHealth(dir, memFs({ [p]: text }))
  assert.equal(read.status, 'measured', '★ 两代形状都 measured')
  assert.equal(read.records.length, 3, `★ 三行全 parse（实测 ${read.records.length}）—— 不许假设形状`)
  /** ★ refused 从每行自带的 verdicts 数（`ok` 之外各一次）：dedupe ok 不算；attributable unmeasured+false 各一次。 */
  assert.deepEqual(read.refused, { 'collection.attributable': 2 }, `★ refused 按判据 id 分组（实测 ${JSON.stringify(read.refused)}）`)
  /** ★ 而这三条都落 (where, kind) 桶：contract/rejection 与 validateCreateTask/rejection。 */
  const health = collectionHealthOf(read.records, read.refused ?? {})
  assert.equal(health.buckets.length, 2, `★ 两代信号按 source.where 分桶（实测 ${health.buckets.length} 桶）`)
  assert.equal(health.refused['collection.attributable'], 2, '★ refused 透传进 health')
})

test('★★ 臂 4b：重复 id 不去重 —— 撞号正是 redundancy 该测的东西', async () => {
  /** ★ 任务书背景：signals.jsonl 现有 5 组重复 id —— ★ 不许顺手去重（那会让 redundancy 恒为 1）。 */
  const line = (n, where) => JSON.stringify({ id: `e-${String(n).padStart(4, '0')}`, at: '2026-10-16T06:10:44+08:00', kind: 'rejection', message: 'm', source: { where } })
  const dir = stateRoot({})
  const p = join(dir, 'evolution', 'signals.jsonl')
  const text = [line(1, 'contract'), line(1, 'contract')].join('\n') + '\n'   // 同 id 两次（撞号复现）
  writeFileSync(p, text, 'utf8')
  const read = await readSignalsHealth(dir, memFs({ [p]: text }))
  assert.equal(read.records.length, 2, '★ 两条都进读数（不去重）')
  const health = collectionHealthOf(read.records, read.refused ?? {})
  assert.equal(health.buckets.length, 1, '★ 同桶两条 ⇒ 1 个桶')
  assert.equal(health.redundancy, 1 / 2, '★ redundancy = 唯一对数/总数 = 1/2 —— 两条同桶把 redundancy 压到 0.5（撞号/同形正是它要暴露的；不去重才看得出）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★★ 生产出口：真实 assembleTeamSnapshot ⇒ 快照上有 collectionHealth（不是零调用）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 5：真实 assembleTeamSnapshot ⇒ collectionHealth 在快照上（有信号）/ 缺席（文件缺席）', async (t) => {
  const { createTeamDir } = await import('../lib/state.js')
  const { Context } = await import('@deepseek-ai/cordis')
  const { registerAgentTeamsTools } = await import('../lib/tools.js')

  /** 一个最小 ctx（与其它夹具同构）。 */
  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined }, list() { return [] },
      sendMessage: async () => 'msg-0', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { get() { return undefined } },
    llm: { async resolveCallConfig(config) { return config }, async listModels() { return [] } },
    on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined })

  /** 队 A：有 signals.jsonl（2 条，两代形状）⇒ collectionHealth 在场。 */
  const dirA = mkdtempSync(join(tmpdir(), 't101-teamA-'))
  await createTeamDir(join(dirA, '.agent-teams'), {
    id: 'teamA', name: 'A', captainSessionId: 'cap', createdAt: 1, taskSeq: 0, members: [], tasks: [],
  })
  mkdirSync(join(dirA, '.agent-teams', 'evolution'), { recursive: true })
  writeFileSync(
    join(dirA, '.agent-teams', 'evolution', 'signals.jsonl'),
    [
      `{"id": "e-0001", "at": "2026-10-13T11:56:23+08:00", "kind": "rejection", "title": "x", "source": {"where": "contract"}, "message": "m"}`,
      JSON.stringify({ id: 'e-0002', at: '2026-10-16T06:10:44+08:00', kind: 'rejection', message: 'm', source: { where: 'validateCreateTask' }, collection: { collected: false, verdicts: [{ gateId: 'collection.attributable', verdict: 'false' }] } }),
    ].join('\n') + '\n',
    'utf8',
  )

  /** 队 B：无 signals.jsonl ⇒ collectionHealth 缺席（且不是空读数）。 */
  const dirB = mkdtempSync(join(tmpdir(), 't101-teamB-'))
  await createTeamDir(join(dirB, '.agent-teams'), {
    id: 'teamB', name: 'B', captainSessionId: 'cap', createdAt: 1, taskSeq: 0, members: [], tasks: [],
  })

  const snapA = await assembleTeamSnapshot(ctx, join(dirA, '.agent-teams'), dirA, {
    id: 'teamA', name: 'A', captainSessionId: 'cap', phase: 'running', createdAt: 1, members: [], tasks: [],
  })
  assert.notEqual(snapA.collectionHealth, undefined, '★★ 队 A（有信号文件）⇒ collectionHealth 在快照上 —— collectionHealthOf 不再零调用')
  assert.equal(snapA.collectionHealth.readout.status, 'measured')
  assert.equal(snapA.collectionHealth.readout.records.length, 2)
  assert.ok(snapA.collectionHealth.health.buckets.length >= 1, '★ buckets 有内容')
  assert.equal(snapA.collectionHealth.health.refused['collection.attributable'], 1, '★ refused 透传')
  assert.equal(snapA.collectionHealthUnmeasurable, undefined, '★ 算出来了 ⇒ 不可测格缺席')

  const snapB = await assembleTeamSnapshot(ctx, join(dirB, '.agent-teams'), dirB, {
    id: 'teamB', name: 'B', captainSessionId: 'cap', phase: 'running', createdAt: 1, members: [], tasks: [],
  })
  assert.equal(snapB.collectionHealth, undefined, '★★ 队 B（文件缺席）⇒ collectionHealth 整格缺席（unmeasured，不是空读数）')
  assert.equal(snapB.collectionHealthUnmeasurable, undefined, '★ 文件缺席是正常态 ⇒ 不可测格也缺席（缺席 ≠ 异常）')

  for (const dir of [dirA, dirB]) rmSync(dir, { recursive: true, force: true })
})
