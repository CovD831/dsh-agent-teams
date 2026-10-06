/**
 * ── delivery + runtime 三条判据的【输入面】夹具（t5）────────────────────────────
 *
 * 本夹具测的不是判据的裁决（那三条各有自己的夹具：gate-delivery-coverage /
 * gate-runtime-liveness），测的是**它们的输入面声明**：
 *
 *   B 层：`requires` 用 TS 类型声明 ⇒ 拼错的路径在【编译期】报 TS2322。
 *   A 层：每条声明的那一格，在真实 ctx 上缺席时**核对层必须报出缺**。
 *
 * ── ★ 这三条各有【一个陷阱】，而三个陷阱指向同一件事 ──────────────────────────
 *
 *   · `delivery.coverage`    —— 「矩阵缺席」与「矩阵为空」不同形：
 *                               缺席 ⇒ `unmeasured`（没能测量）
 *                               空   ⇒ `ok`（测量结论：确实没有目标条目）
 *   · `delivery.convergence` —— 「从未 spawn」是**可判定的事实**（⇒ blocked），
 *                               不是「没能测量」（⇒ unmeasured）
 *   · `runtime.liveness`     —— 输入来自 `waitWindows`，那正是上一轮最后修的
 *                               那个「建好了但没接线」的点
 *
 * ★★ 三条陷阱的共同形状：**它们都不是"该声明什么路径"，而是"哪一格【不该】
 *    被声明成必填"**。
 *
 *   前两条里，某一格的**缺席本身就是判据的一条合法输入**：
 *
 *     coverage 缺席   ⇒ 判据说 unmeasured（正确裁决）
 *     members 缺席    ⇒ 判据说 unmeasured（正确裁决）
 *
 *   ⇒ 把这两格写进 `requires`，核对层会在同一个事实上报第二遍；而一旦硬化
 *     （`AGENT_TEAMS_ENFORCE_REQUIRES=1`），它会把判据**唯一正确的未测量裁决**
 *     拦成"接线缺陷"—— 一个"永远关着的门"。
 *
 *   ⇒ 所以本夹具里有一组【反向臂】：它们断言 `coverage` / `members` **不在**
 *     `requires` 里。这一组不是形式主义，它是本任务最重要的一条界线 ——
 *     而且它是**可被定向突变打红**的：把 `'coverage'` 加回声明，下面立刻红。
 *
 * ── ★ 为什么反向臂必须存在（"断言不得恒真"在本夹具里的落点）────────────────────
 *
 *   一个"只断言声明里有什么"的夹具，对"声明被写胖了"完全无感 —— 而写胖正是
 *   本任务这三条的真实风险（它们看着更"完整"、更"齐"）。加宽声明在任何一条
 *   正向臂上都不报错，只会在生产日志里变成噪音。
 *
 * ── 三组臂 ────────────────────────────────────────────────────────────────────
 *
 *   A 组（对照臂）：声明的每一格都在场 ⇒ `ok`、`incomplete === 0`
 *   B 组（伪造臂）：适用、而把声明的那一格拿掉 ⇒ 核对**必须报出缺的是哪一个**
 *   C 组（反向臂）：★ 那两格【不许】在声明里（缺席是合法输入，不是接线缺陷）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createGateRegistry } from '../lib/gates/registry.js'
import { checkRequires } from '../lib/gates/requires.js'

import {
  id as coverageId, requires as coverageRequires, appliesTo as coverageApplies,
} from '../lib/gates/delivery/coverage.js'
import {
  id as convergenceId, requires as convergenceRequires, appliesTo as convergenceApplies,
} from '../lib/gates/delivery/convergence.js'
import {
  id as livenessId, requires as livenessRequires, appliesTo as livenessApplies,
} from '../lib/gates/runtime/liveness.js'

// ─────────────────────────────────────────────────────────────────────────────
// 形状表 —— 本夹具的**唯一事实来源**
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★ `requires` 与 `appliesTo` 都从**判据模块本身**读，不在这里抄一遍：
 *   抄一遍的话，判据改了声明而夹具没改，两边会**各自正确、合起来错** ——
 *   那正是本队反复见过的"两份清单慢慢分叉，而分叉在日志里同形"。
 */
const GATES = [
  {
    label: 'delivery.coverage',
    id: coverageId,
    requires: coverageRequires,
    appliesTo: coverageApplies,
    /** 这一条真正会开火的位置上的 ctx（`delivery` 调用点构造的那一份）。 */
    context: { team: { id: 'team', members: [{ name: 'worker' }] }, coverage: [] },
    /** ★ 反向臂：这一格【不许】被声明成必填（它的缺席是一条合法输入）。 */
    mustNotRequire: 'coverage',
    mustNotRequireWhy: '矩阵缺席 ⇒ unmeasured 是本判据【唯一正确】的未测量臂，不是接线缺陷',
  },
  {
    label: 'delivery.convergence',
    id: convergenceId,
    requires: convergenceRequires,
    appliesTo: convergenceApplies,
    context: { team: { id: 'team', members: [{ name: 'worker' }] }, members: [{ name: 'worker', state: 'idle', spoke: true }] },
    mustNotRequire: 'members',
    mustNotRequireWhy: '拿不到成员状态 ⇒ unmeasured 是本判据的合法输入；且「从未 spawn」是可判定事实，不该被读成缺失',
  },
  {
    label: 'runtime.liveness',
    id: livenessId,
    requires: livenessRequires,
    appliesTo: livenessApplies,
    /** ★ 团队级调用点（`task-status`）的形状：`waits` 是复数面。 */
    context: { event: 'task-status', waits: [], team: { id: 'team', tasks: [] } },
    /**
     * ★ 这一条的陷阱是【反向的】：`waits` **必须**在声明里 ——
     *   它正是上一轮"建好了但没接线"的那一格。见下面 A 组的专门断言。
     */
    mustRequire: 'waits',
    mustRequireWhy: 'waitWindows 是上一轮"建好了但没接线"的点：不声明它，这张表没被读出来这件事就没人能机械地发现',
  },
]

/** 从 ctx 上抠掉一条路径（模拟"接线漏了这一格"）。 */
function without(context, path) {
  const clone = structuredClone(context)
  const segments = path.split('.')
  let cursor = clone
  for (const segment of segments.slice(0, -1)) {
    if (cursor === null || typeof cursor !== 'object') return clone
    cursor = cursor[segment]
  }
  if (cursor !== null && typeof cursor === 'object') delete cursor[segments[segments.length - 1]]
  return clone
}

// ─────────────────────────────────────────────────────────────────────────────
// A 组：对照臂 —— 声明的每一格都在场 ⇒ 不报
// ─────────────────────────────────────────────────────────────────────────────

test('A 组 ★ 对照臂：三条判据在它们真正开火的位置上，声明的每一格都在场 ⇒ 不报', async () => {
  const r = createGateRegistry()
  for (const gate of GATES) {
    const check = checkRequires({ id: gate.id, requires: gate.requires }, gate.context, gate.appliesTo(gate.context))
    assert.equal(
      check.status, 'ok',
      `★ ${gate.label}：在这份真实 ctx 上不该报缺格，实际 ${JSON.stringify(check)}`,
    )
    assert.deepEqual(check.missing, [], `★ ${gate.label}：missing 必须为空`)
  }

  /**
   * ★ 更强的一条：从**进程级注册表**真的求值一次，确认核对结果进了旁路字段。
   *   `checkRequires` 直接调用证明的是"核对函数对"，而从这里求值证明的是
   *   "这一格真的被接线读到了"—— 两者证明的不是同一件事（本队为这条分界
   *   已经交过学费：判据写得对，而调用点没接）。
   */
  const { registry } = await import('../lib/gates/index.js')
  const delivery = await registry.evaluate('delivery', GATES[0].context)
  const coverageCheck = delivery.requires.checks.find((entry) => entry.id === coverageId)
  assert.equal(coverageCheck.status, 'ok', `★ delivery 位置求值后，coverage 的输入面核对应为 ok：${JSON.stringify(coverageCheck)}`)

  const runtime = await registry.evaluate('runtime', GATES[2].context)
  const livenessCheck = runtime.requires.checks.find((entry) => entry.id === livenessId)
  assert.equal(livenessCheck.status, 'ok', `★ runtime 位置求值后，liveness 的输入面核对应为 ok：${JSON.stringify(livenessCheck)}`)
  assert.ok(livenessCheck.present.includes('waits'), '★ `waits` 必须在【真的读到了】的那一份里 —— 这一格正是本轮要抓的形状')
})

// ─────────────────────────────────────────────────────────────────────────────
// B 组：伪造臂 —— 逐格拿掉 ⇒ 核对必须报出【缺的是哪一个】
// ─────────────────────────────────────────────────────────────────────────────

test('B 组 ★ 伪造臂：声明的每一格逐格拿掉 ⇒ 核对必须指名报出它（一格一条断言）', () => {
  let asserted = 0
  for (const gate of GATES) {
    for (const path of gate.requires) {
      const check = checkRequires(
        { id: gate.id, requires: gate.requires },
        without(gate.context, path),
        true,
      )
      assert.equal(
        check.status, 'incomplete',
        `★ ${gate.label}：拿掉 '${path}' 之后核对必须报缺，实际 ${JSON.stringify(check)}`,
      )
      assert.ok(
        check.missing.includes(path),
        `★ ${gate.label}：缺的必须是 '${path}' 本身（要指名道姓），实际 ${JSON.stringify(check.missing)}`,
      )
      asserted += 1
    }
  }
  assert.ok(asserted >= 4, `★ 至少要逐格断言 4 次，实际 ${asserted}（声明被写空会让这一臂静默变成恒真）`)
})

test('B 组 ★ liveness：`waits` 拿掉 ⇒ 报缺（这正是"窗口表没接线"的机械形态）', () => {
  /**
   * ★ 这一臂是本轮的**核心回归**。上一轮那次缺陷正是：`waitWindows` 建好了、
   *   有界、有陈旧界限、注释写清了为什么，而**没有任何调用点把它读出来**。
   *   修复之前，这件事只有靠人读代码才能发现。
   *
   * ⇒ 现在它是机械的：把 `waits` 从 ctx 上拿掉（＝调用点没注入），
   *   核对层立刻指名报出 `runtime.liveness` 缺 `waits`。
   *
   *   定向突变：把 `liveness.ts` 的 requires 改成 `['event']` ⇒ 本条**必须红**
   *   （它报不出缺了）。这一条就是"机制被单独去掉、臂必须红"在本任务里的落点。
   */
  const check = checkRequires(
    { id: livenessId, requires: livenessRequires },
    { event: 'task-status', team: { id: 'team', tasks: [] } },
    true,
  )
  assert.equal(check.status, 'incomplete', '★ 没有 waits ⇒ 必须报缺，而不是静默 ok')
  assert.deepEqual(check.missing, ['waits'], '★ 缺的必须是 waits 这一格')
  assert.ok(check.present.includes('event'), '★ 在场的那一格（event）也要如实交出来')
})

// ─────────────────────────────────────────────────────────────────────────────
// C 组：反向臂 ★ 那两格【不许】在声明里 —— 本任务最重要的一条界线
// ─────────────────────────────────────────────────────────────────────────────

test('C 组 ★★ 反向臂：`coverage` / `members` 缺席是【合法输入】，不许被声明成必填', () => {
  for (const gate of GATES) {
    if (gate.mustNotRequire === undefined) continue
    assert.ok(
      !gate.requires.includes(gate.mustNotRequire),
      `★ ${gate.label}：'${gate.mustNotRequire}' 不许进 requires —— ${gate.mustNotRequireWhy}。`
      + '把它写进去，核对层会在这个事实上报第二遍，而硬化之后会把这条正确的未测量裁决拦成接线缺陷（永远关着的门）。',
    )
  }
})

test('C 组 ★★ 反向臂的实证：`coverage` 缺席 ⇒ 判据 unmeasured，而核对层【不】报它', async () => {
  /**
   * ★ 这一臂把 C 组从"读一遍声明"升级成"跑一次真实裁决"。它同时钉住两件事：
   *   ① 判据自己的裁决没被本轮的声明改动（缺席 ⇒ unmeasured，仍是 unmeasured）；
   *   ② 核对层对这一格**不说话**（`checked` 里没有它）。
   *
   *   两者合起来才是那个正确的分工：**缺席由判据的裁决表达，不由核对层表达。**
   *
   *   定向突变：把 `'coverage'` 加进 `coverage.ts` 的 requires ⇒ 本条**必须红**
   *   （核对层会开始报缺，与判据抢同一句话）。
   */
  const contextNoMatrix = { team: { id: 'team', members: [] } }
  const check = checkRequires(
    { id: coverageId, requires: coverageRequires },
    contextNoMatrix,
    coverageApplies(contextNoMatrix),
  )
  assert.equal(check.status, 'ok', '★ 不许把"矩阵缺席"报成缺格')
  assert.deepEqual(check.missing, [], '★ 缺口清单必须是空的 —— 这一格由判据的 unmeasured 臂持有')

  // ① 而判据自己仍然照常把这件事说成 unmeasured（本轮不改任何裁决）
  const { gate: coverageGate } = await import('../lib/gates/delivery/coverage.js')
  const verdict = coverageGate(contextNoMatrix)
  assert.equal(verdict.ok, false, '★ 矩阵缺席仍必须是 unmeasured（不是通过）')
  assert.equal(typeof verdict.unmeasured, 'string', '★ 且必须说清"没能测量"')
})

test('C 组 ★★ 反向臂的实证：拿不到成员状态 ⇒ 判据 unmeasured；而「从未 spawn」⇒ blocked（两者不同形）', async () => {
  /**
   * ★ 这一臂钉的是本任务点名的那条语义：**「从未 spawn」是可判定的事实**。
   *
   *   三种东西必须【互不同形】：
   *     members 缺席                      ⇒ unmeasured（没能测量）
   *     members 里有 never-spawned        ⇒ blocked（可判定的事实）
   *     members 里都收敛                  ⇒ ok
   *
   *   而核对层对**任何一种**都不该说话（`members` 不进 requires）。
   */
  const { gate: convergenceGate } = await import('../lib/gates/delivery/convergence.js')

  const shapeOf = (v) => (v.ok === true ? 'ok' : Array.isArray(v.blockers) ? 'blocked' : 'unmeasured')

  const unobserved = convergenceGate({ team: { id: 'team', members: [{ name: 'w' }] } })
  const neverSpawned = convergenceGate({
    team: { id: 'team', members: [{ name: 'w' }] },
    members: [{ name: 'w', state: 'never-spawned' }],
  })
  const converged = convergenceGate({
    team: { id: 'team', members: [{ name: 'w' }] },
    /**
     * ★ `spoke: true` 是**必须**给的，不是装饰：本判据的核心分界就是
     *   「`reported` 且说过话」（收敛）与「`idle` 但最后一句是空的」（没收敛）
     *   在观察上同形 —— 少了 `spoke` 这一位，判据**应该**报 `unmeasured`
     *   （它没有能力把两者分开）。我第一版漏了它，于是这一臂红在
     *   "expected ok, got unmeasured" —— 那是我夹具的错，不是判据的错。
     */
    members: [{ name: 'w', state: 'reported', spoke: true }],
  })

  assert.equal(shapeOf(unobserved), 'unmeasured', '★ 拿不到成员状态 ⇒ unmeasured')
  assert.equal(shapeOf(neverSpawned), 'blocked', '★ 从未 spawn 是【可判定的事实】⇒ blocked，不是 unmeasured')
  assert.equal(shapeOf(converged), 'ok')
  assert.notEqual(shapeOf(unobserved), shapeOf(neverSpawned), '★ 两者必须不同形')

  // ★ 而「从未 spawn」这条事实**不该**在核对层里出现 —— 它不是接线缺陷
  const check = checkRequires(
    { id: convergenceId, requires: convergenceRequires },
    { team: { id: 'team' }, members: [{ name: 'w', state: 'never-spawned' }] },
    convergenceApplies({ team: { id: 'team' } }),
  )
  assert.equal(check.status, 'ok', '★ 「从未 spawn」不许被核对层读成缺格 —— 那是把一个正确裁决误报成接线缺陷')
})

// ─────────────────────────────────────────────────────────────────────────────
// D 组：不适用 ⇒ 不报（噪音与误报同样有害）
// ─────────────────────────────────────────────────────────────────────────────

test('D 组 ★ 未测量臂：这三个位置上的【其他调用点】不适用 ⇒ 核对不报（不制造噪音）', () => {
  /**
   * ★ `liveness` 是这一组的最佳样本：六个 runtime 调用点里只有 `task-status`
   *   会让它开口，其余四个结构性拿不到 `waits`。若核对不看 `appliesTo`，
   *   它会在那四个点上每次报一句"缺 waits" —— 而那是**正常的**
   *   （判据在那四个点上本来就不说话）。
   *
   *   定向突变：把 `requires.ts` 里 `checkRequires` 的 appliesTo 闸门去掉
   *   ⇒ 本条**必须红**。
   */
  const elsewhere = [
    { gate: GATES[2], context: { event: 'member-dispatched' } },
    { gate: GATES[2], context: { event: 'task-update' } },
    { gate: GATES[0], context: {} },
    { gate: GATES[1], context: {} },
  ]
  for (const { gate, context } of elsewhere) {
    const applicable = gate.appliesTo(context)
    assert.equal(applicable, false, `★ ${gate.label} 在这份 ctx 上本来就不适用（这是本臂的前提）`)
    const check = checkRequires({ id: gate.id, requires: gate.requires }, context, applicable)
    assert.equal(check.status, 'skipped', `★ 不适用 ⇒ 必须 skipped，实际 ${JSON.stringify(check)}`)
    assert.deepEqual(check.missing, [], '★ 不适用 ⇒ 一个缺口都不许报')
  }
})

test('D 组 ★ liveness 的反向核对：`waits: []`（观察了、没人在等）是【在场】，不是缺格', () => {
  /**
   * ★ 与 C 组同源的界线，方向相反：`waits: []` 是"观察了，这个队此刻没有人在等"
   *   ⇒ **在场**（判据据此报 ok + skipped 标记）；`waits` 缺席才是"没能观察"。
   *
   *   核对层的口径（`isPresent`：只有 `undefined`/`null` 才算缺席）必须与判据
   *   自己的读法一致 —— 否则每一次"确实没人等待"都会被报成缺格，而那是噪音。
   */
  const check = checkRequires(
    { id: livenessId, requires: livenessRequires },
    { event: 'task-status', waits: [] },
    true,
  )
  assert.equal(check.status, 'ok', '★ 空数组是测量结论（没人在等），不是缺格')
  assert.ok(check.present.includes('waits'), '★ `waits: []` 必须在"在场"那一份里')
})
