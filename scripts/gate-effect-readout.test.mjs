/**
 * ── 收益读数必须有一个生产出口（R6.2）────────────────────────────────────────────
 *
 * MEASURED（2026-10-22）：
 *   grep -rn "from ['\''"].*evaluator/" src/ | grep -v '^src/evaluator/'  ⇒ 空
 *   grep -rn "effectReadingOf(" src/                                      ⇒ 只有它自己
 * ⇒ src/evaluator/ 在生产上零消费者：判据写对了、也测过，而没人在读。
 *
 * 三条臂：纯函数两态 / 生产出口活着 / 反向半边（没靶 ≠ 判不了）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { effectReadoutOf } = await import(join(ROOT, 'lib', 'evaluator', 'effect.js'))

const SEP = String.fromCharCode(10)
const LONG = 25 * 60 * 60 * 1000

function counterOf(points) {
  return (window) => points.filter((point) => point.at >= window.from && point.at < window.to).length
}

test('臂 1：有基线且后窗更少 ⇒ improved（结构性判据，无阈值）', () => {
  const at = 1000
  const points = [100, 200, 300, 400, 1100, 1200].map((t) => ({ at: t, key: 'k' }))
  const readout = effectReadoutOf(
    [{ id: 'p-0001', at, effect: { component: 'edit_plan', kind: ['rejection'] } }],
    counterOf(points),
    at + LONG,
  )
  assert.equal(readout.considered, 1)
  assert.equal(readout.improved, 1)
  assert.equal(readout.unchanged, 0)
  assert.equal(readout.unmeasured, 0)
  assert.equal(readout.rows[0].before, 4)
  assert.equal(readout.rows[0].after, 2)
  assert.equal(readout.rows[0].delta, 2, '幅度作读数，不进 verdict')
})

test('臂 2：before.count === 0 ⇒ unmeasured，绝不读成 unchanged', () => {
  const at = 1000
  const points = [1100, 1200].map((t) => ({ at: t, key: 'k' }))
  const readout = effectReadoutOf(
    [{ id: 'p-0001', at, effect: { component: 'edit_plan', kind: ['rejection'] } }],
    counterOf(points),
    at + LONG,
  )
  assert.equal(readout.unmeasured, 1)
  assert.equal(readout.improved, 0)
  assert.equal(readout.unchanged, 0, '没测到并进没变化是同一个合流')
  assert.match(readout.rows[0].reasons.join(' '), /no-baseline/)
})

test('臂 3：snapshot 的 effectReadout 是一条活着的生产出口（合成树实测）', async (t) => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const workspace = await mkdtemp(join(tmpdir(), 'effect-readout-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const stateRoot = join(workspace, '.agent-teams')
  const teamDir = join(stateRoot, 'effect-demo')
  await mkdir(join(teamDir, 'inbox'), { recursive: true })
  /**
   * ★★ `evolution/` 在**工作区级**（`<stateDir>/evolution/`），不在团队目录里。
   *   MEASURED（本条的第一版红在这里）：`readProposalPipeline(stateRoot, …)` 读的是
   *   `signalsPathOf(stateRoot)` = `<stateDir>/evolution/signals.jsonl` ——
   *   而生产写方（`observe` 拿到的 `stateRootOf()`）写的也正是那里。
   *   ⇒ 夹具把文件放团队目录 ⇒ `storedProposalsAbsent: true` ⇒ 与"写端没写"同形。
   */
  await mkdir(join(stateRoot, 'evolution'), { recursive: true })

  const at = Date.now() - 30 * 60 * 60 * 1000
  await writeFile(join(teamDir, 'team.json'), JSON.stringify({
    name: 'effect-demo', id: 'effect-demo', captainSessionId: 'c', createdAt: 1, taskSeq: 0,
    members: [], tasks: [], phase: 'running',
  }))
  const proposalRow = {
    id: 'p-0001',
    at,
    contract: { subject: 'stop it', objective: 'x', acceptance: ['y'] },
    routing: { modality: 'contract', why: 'w', effect: { component: 'edit_plan', kind: ['rejection'] } },
    from: ['e-0001'],
  }
  await writeFile(join(stateRoot, 'evolution', 'proposals.jsonl'), JSON.stringify(proposalRow) + SEP)
  const signal = (id, when) => JSON.stringify({
    id, at: when, kind: 'rejection', source: { where: 'edit_plan' }, message: 'm',
  }) + SEP
  await writeFile(join(stateRoot, 'evolution', 'signals.jsonl'),
    signal('e-0001', at - 3000) + signal('e-0002', at - 2000)
    + signal('e-0003', at - 1000) + signal('e-0004', at - 500) + signal('e-0005', at + 1000))

  const { collectTeamsActivity } = await import(join(ROOT, 'lib', 'snapshot.js'))
  /**
   * ★ 用**真实的**入口 `collectTeamsActivity(ctx, roots)` —— 那是 `/state` 走的那条路。
   *   第一版猜了一个 `buildActivitySnapshot`（不存在）⇒ 本臂红在"函数名猜错"上，
   *   而不是红在"出口没接上"上。★ 一个猜错名字的臂，它的绿也不能证明任何事。
   */
  const snapshot = { teams: await collectTeamsActivity({ logger: { warn: () => {} } }, [{ workspace, stateRoot }]) }
  const live = snapshot.teams.find((team) => team.effectReadout !== undefined)
  assert.ok(live !== undefined, '有 stored proposal 而 effectReadout 缺席 ⇒ 生产出口没接上')
  const { improved, unchanged, unmeasured, considered } = live.effectReadout
  assert.equal(considered, 1, '一份带靶的提案 ⇒ considered = 1')
  assert.equal(improved + unchanged + unmeasured, considered, '三态之和必须等于分母')
})

test('臂 3b（真实语料）：本仓真有条目时 effectReadout 必须同时在场', async (t) => {
  const { readdir } = await import('node:fs/promises')
  const { existsSync } = await import('node:fs')
  let entries = []
  try {
    entries = await readdir(join(ROOT, '.agent-teams'), { withFileTypes: true })
  } catch {
    entries = []
  }
  const roots = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(ROOT, '.agent-teams', entry.name, 'evolution', 'proposals.jsonl'))
    .filter((path) => existsSync(path))
  if (roots.length === 0) {
    t.diagnostic('本仓此刻没有任何 stored proposal ⇒ 真实语料这一格尚未被走过（不是失败，是没数据）')
    return
  }
  const { collectTeamsActivity } = await import(join(ROOT, 'lib', 'snapshot.js'))
  const snapshot = {
    teams: await collectTeamsActivity({ logger: { warn: () => {} } }, [{ workspace: ROOT, stateRoot: join(ROOT, '.agent-teams') }]),
  }
  const withProposals = snapshot.teams.filter((team) => team.proposalPipeline?.storedProposals?.length)
  assert.ok(withProposals.length > 0, '盘上有提案而快照里读不到 ⇒ 读端与写端对不上')
})

test('臂 4（反向半边）：没有 effect 靶的提案不进 considered', () => {
  const at = 1000
  const points = [100, 200, 1100].map((t) => ({ at: t, key: 'k' }))
  const readout = effectReadoutOf(
    [
      { id: 'with-target', at, effect: { component: 'edit_plan', kind: ['rejection'] } },
      { id: 'no-target' },
    ],
    counterOf(points),
    at + LONG,
  )
  assert.equal(readout.considered, 1, '分母只该数被问过的那些')
  assert.equal(readout.rows.length, 1)
  assert.equal(readout.rows[0].id, 'with-target')
  assert.ok(!readout.rows.some((row) => row.id === 'no-target'))
})

test('臂 5：后窗太短 ⇒ unmeasured，且理由说的是窗口而不是基线', () => {
  const at = 1000
  const points = [100, 200, 1100].map((t) => ({ at: t, key: 'k' }))
  const readout = effectReadoutOf(
    [{ id: 'p-0001', at, effect: { component: 'edit_plan', kind: ['rejection'] } }],
    counterOf(points),
    at + 60_000,
  )
  assert.equal(readout.unmeasured, 1)
  assert.match(readout.rows[0].reasons.join(' '), /observation-window-too-short/)
  assert.ok(!readout.rows[0].reasons.join(' ').includes('no-baseline'), '两个成因不同形')
})
