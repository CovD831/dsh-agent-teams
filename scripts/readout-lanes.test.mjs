/**
 * ── 三条读数线的夹具（线A 证据投影 / 线B 软硬配对 / 线C 后端能力位）──────────────
 *
 * 本文件钉的是**三条线自己的读数语义**，而容器语义在
 * `scripts/readout-container.test.mjs`（10 臂）里已经钉完了 —— 两者不重叠：
 *
 * ```
 *   容器夹具    provider 抛错 / undefined / 未登记 ⇒ 容器怎么落（与内容无关）
 *   本文件      provider **算出来的东西对不对**（内容、三态前缀、双向闭合、id 稳定）
 * ```
 *
 * ── ★ 跑法（本机所有 node 命令都必须去掉宿主 shim）──────────────────────────────
 *
 * ```sh
 *   env -u NODE_OPTIONS node --test scripts/readout-lanes.test.mjs
 * ```
 * ★ 直接 `import '../src/*.ts'`（不是 `lib/*.js`）：Node 22.19+ 默认剥离类型，
 *   于是本夹具**零构建依赖**，测的一定是 `src` 的当下代码而不是上一版产物。
 *   同理见 `scripts/readout-container.test.mjs` 文件头那段实测记账。
 *
 * ── ★★★ 夹具数据纪律（本文件最容易出假绿的地方，逐条都踩过）─────────────────────
 *
 * ```
 * ★ MEASURED（readout-container 的记账）：同一份 team 记录，快照侧【不校验】、
 *   写盘侧【强校验】⇒ 用 JS 对象构造的夹具可以全绿，而同一份数据写进盘就是非法的。
 * ★ MEASURED（线C 的记账）：一份"能过校验"的记录仍可能缺掉被测逻辑赖以工作的那一格
 *   （`members[].provider` 缺席 ⇒ 任何读它推后端的实现都只能返回 unmeasured）。
 * ```
 * ⇒ 所以本文件的做法是：
 *   ① **所有** team.json 都由下面几个 `fixture*` 函数造，且它们写出的形状会被
 *      **臂 0** 用真的 `readTeam` 读回来验证一遍（"我造的数据合法"必须是一条断言，
 *      不是一句假设）；
 *   ② 被测的那几格（`provider` / `executions` / `supplementalEvidence`）**必须有真值**，
 *      否则读数会退化成 unmeasured，而 unmeasured 与"真读到了但为空"在断言上很难分。
 *
 * ── ★ 每条臂的**判别力**（MEASURED，不是声明：8 个定向突变逐个施加、跑完即逐字节复原）──
 *
 * ```
 *   突变                                        变红的臂
 *   M1 backends 去掉 `raw.trim()`               臂 2、臂 3
 *   M2 去重先 `Set` 后 `trim`（顺序反了）        臂 3
 *   M3 `no-team` 的文案合并成 `no-region`        臂 1
 *   M4 evidenceId 里掺 `Date.now()`              臂 8
 *   M5 投影里往 `task` 上写一格                  臂 9
 *   M6 `hasSoft` 写死 false（不查侧表）          臂 7
 *   M7 `pairingOf` 不调双向校验                  臂 5、臂 6
 *   M8 装配清单漏掉 backends 那一行              臂 10
 *   ── 加固后（伪造代价审计之后）新增 5 条 ↴ ─────────────────────────────
 *   H1 放过 `problemsOf`（坏数据直接拼 id）       臂 11
 *   H2 去掉 evidenceId 去重                      臂 12、臂 13
 *   H3 同 id 不同内容时静默留一条                臂 13
 *   H4 `discrimination` 写死成 'none'            臂 14
 *   H5 `reverified` 把 unknown 写成 no           臂 15
 *   H6 整格 `reverified` 写死 'yes'（不看 entries）臂 9、臂 15
 * ```
 * ★ 复原后源文件的 sha256 全部一致（改动是**可逆**的，这是取证的前提）。
 * ★ 一处**如实记账的盲区**：`no-region` 与 `no-provider-record` 的**互换**
 *   （把 no-provider-record 写成 no-region）只有臂 1 的正则会在一条上红 ——
 *   它们的区分力来自"三句互不相同"那条 `Set` 断言，而不是各自的语义；
 *   要更强就得把三句的**补救动作**也写进断言，而那属于契约（未做）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根（本文件在 `scripts/` 下）。 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * ★ 三条线的模块直接 import `src`（理由见文件头）。
 * ★ 最后那个 `snapshot.ts` 带着**副作用 import**：它会把 `src/readouts/index.ts`
 *   （装配清单）拉起来 ⇒ 三条线的 provider 各自认领槽位。端到端臂要的就是这个。
 */
const backends = await import('../src/backends.ts')
const evidence = await import('../src/evidence.ts')
const pairing = await import('../src/gates/pairing.ts')
const { readTeam } = await import('../src/state.ts')
const { assembleTeamSnapshot } = await import('../src/snapshot.ts')

// ─────────────────────────────────────────────────────────────────────────────
// 夹具：三份**真的能过 `readTeam`** 的 team 记录
// ─────────────────────────────────────────────────────────────────────────────

/** 一个成员（★ `status` 只能取 `idle|working|removed`；`joinedAt` 必填）。 */
const fixtureMember = (name, provider, extra = {}) => ({
  id: `m-${name}`,
  name,
  status: 'idle',
  joinedAt: 1000,
  ...provider === undefined ? {} : { provider },
  model: 'fake-model',
  ...extra,
})

/**
 * 一条任务。
 * ★ `executions` / `supplementalEvidence` 是**本夹具的被测格**，所以由调用方给真值。
 * ★ `createdAt` / `updatedAt` / `dependencies` 是 `isTeamTask` 的必填格。
 */
const fixtureTask = (id, extra = {}) => ({
  id,
  subject: `task ${id}`,
  status: 'completed',
  assignee: 'alice',
  dependencies: [],
  createdAt: 1000,
  updatedAt: 2000,
  attempt: 1,
  attemptId: 'cap-1',
  ...extra,
})

/** 一条 execution（写点：`src/tools/update-task.ts:2188`）。 */
const fixtureExecution = (extra = {}) => ({
  at: 1792838580000,
  attempt: 1,
  attemptId: 'cap-1',
  status: 'completed',
  round: 2,
  verdict: 'pass',
  by: 'alice',
  ...extra,
})

/** 一条 supplementalEvidence（写点：`src/quality-gates.ts:3853`）。 */
const fixtureSupplement = (extra = {}) => ({
  at: 1792838590000,
  by: 'alice',
  attempt: 1,
  attemptId: 'cap-1',
  note: 're-ran verify after the repair',
  commandsRun: [{ command: 'pnpm verify', status: 'passed', exitCode: 0 }],
  ...extra,
})

/**
 * 一份**落盘形状**的 completion 判据记录（`gateEvaluationRecordOf` 的投影形状）。
 *
 * ★ 只有 `outputs['completion.verify-rerun'].reruns` 是被测的那一格（`reverified` 的唯一来源）；
 *   其余格按 `GateEvaluationRecord` 的真实形状填齐，避免夹具数据比记录"少一块"
 *   （少了会让下一个人以为落盘记录没有那些格）。
 */
const fixtureGateEvaluation = (reruns) => ({
  ok: true,
  blockers: [],
  ran: [{ id: 'completion.verify-rerun', verdict: 'ok', produced: true }],
  outputs: { 'completion.verify-rerun': { reruns } },
  evaluated: 1,
  skipped: 0,
  registered: 1,
  observed: { blockers: [], unmeasured: [] },
  requires: { checked: 0, incomplete: 1, skipped: 0, notApplicable: 0, inputSurfaceAbsent: 0, missing: [], gateCellsUndeclared: [] },
})

/** 一份 team 记录。 */
const fixtureTeam = (id, { members, tasks = [] }) => ({
  id,
  name: `team-${id}`,
  description: 'fixture',
  phase: 'running',
  captainSessionId: 'session-probe',
  createdAt: 1000,
  members,
  tasks,
  taskSeq: tasks.length,
})

/**
 * 造一个**临时 stateRoot**。
 *
 * @param teamId - 队 id（也是目录名）；`undefined` ⇒ 只建根、不建队（`no-team` 臂）。
 * @param record - 要写进 `<root>/<teamId>/team.json` 的记录；`undefined` ⇒ 不写（`no-team`）。
 */
const makeRoot = (teamId, record) => {
  const root = mkdtempSync(join(tmpdir(), 'readout-lanes-'))
  if (teamId !== undefined && record !== undefined) {
    mkdirSync(join(root, teamId), { recursive: true })
    writeFileSync(join(root, teamId, 'team.json'), JSON.stringify(record), 'utf8')
  }
  return root
}

/** 一份"线上会见到"的最小 ctx（`assembleTeamSnapshot` 只碰这两个成员）。 */
const context = () => ({ agents: { list: () => [], get: () => undefined }, logger: { warn: () => {} } })

// ─────────────────────────────────────────────────────────────────────────────
// 臂 0 前提：夹具造的数据**真的**是合法 durable 记录
// ─────────────────────────────────────────────────────────────────────────────

test('臂 0 前提：三份夹具 team.json 都能被真 readTeam 读回来（含 provider 为空白串那一份）', async () => {
  /**
   * ★ 为什么它必须是一条臂：本文件后面所有断言都建立在"盘上那份记录是真的"上。
   *   若夹具写出的形状不合法，`readTeamEx` 会抛（invalid state）⇒ 三条线全部落
   *   `unmeasured` ⇒ 那时本文件的断言会红在**别的原因**上，而修的人会去改被测代码
   *   （那是本仓记账最久的一种误导）。
   * ★ 尤其 `provider: ''` / `'   '` 这两份：它们要被 **readTeam 接受**，
   *   否则"空白 provider 不进 providers"这条臂测的就不是被测代码，而是
   *   "记录非法"。实测 `isOptionalString` 对空串是放行的（`src/state.ts:1210`）。
   */
  const shapes = [
    ['normal', fixtureTeam('t1', { members: [fixtureMember('alice', 'fake')] })],
    ['blank', fixtureTeam('t1', { members: [fixtureMember('alice', ''), fixtureMember('bob', '   ')] })],
    ['no-provider', fixtureTeam('t1', { members: [fixtureMember('alice', undefined)] })],
    ['with-evidence', fixtureTeam('t1', {
      members: [fixtureMember('alice', 'fake')],
      tasks: [fixtureTask('task-1', { executions: [fixtureExecution()], supplementalEvidence: [fixtureSupplement()] })],
    })],
  ]

  for (const [label, record] of shapes) {
    const root = makeRoot('t1', record)
    try {
      const read = await readTeam(root, 't1')
      assert.notEqual(read, undefined, `★ 夹具 ${label} 写进盘后 readTeam 必须读得回来（读不回来说明夹具数据非法，后面的臂全部作废）`)
      assert.equal(read.members.length, record.members.length, `★ 夹具 ${label} 的成员数必须原样读回`)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }

  console.log(`  臂0 ▸ 4 份夹具记录都能被 readTeam 读回（含 provider 为 '' / '   ' 的那一份）`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 线C 四态：三支失败各一句、前缀不许合并
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 线C 四态：no-region / no-team / no-provider-record 各自一句，且互不相同', async () => {
  const root = makeRoot('t1', fixtureTeam('t1', { members: [fixtureMember('alice', undefined)] }))
  /** ★ 一个"路径写成了文件"的根：`readTeamEx` 对非目录报 `no-region`（不是 `no-team`）。 */
  const fileRoot = join(root, 'a-file-not-a-dir')
  writeFileSync(fileRoot, 'not a directory', 'utf8')
  try {
    /** ① 区不在（路径根本不存在）。 */
    const noRegion = await backends.provideBackendsReadout({ teamId: 't1', stateRoot: join(root, 'no-such-root'), historic: false })
    /** ①' 区"在"但不是目录 —— 与 ① 同归宿，但不是同一个成因（这条也钉住，防止实现只看 ENOENT）。 */
    const noRegionFile = await backends.provideBackendsReadout({ teamId: 't1', stateRoot: fileRoot, historic: false })
    /** ② 区在，队不在。 */
    const noTeam = await backends.provideBackendsReadout({ teamId: 'ghost-team', stateRoot: root, historic: false })
    /** ③ 队读到了，但没有一个成员记下 provider。 */
    const noProvider = await backends.provideBackendsReadout({ teamId: 't1', stateRoot: root, historic: false })

    assert.match(noRegion.unmeasured ?? '', /^no-region: /, `★ 区不在必须报 no-region，实际 ${JSON.stringify(noRegion)}`)
    assert.match(noRegionFile.unmeasured ?? '', /^no-region: /, `★ 路径写成文件同样是 no-region，实际 ${JSON.stringify(noRegionFile)}`)
    assert.match(noTeam.unmeasured ?? '', /^no-team: /, `★ 区在但队不在必须报 no-team，实际 ${JSON.stringify(noTeam)}`)
    assert.match(noProvider.unmeasured ?? '', /^no-provider-record: /, `★ 队读到了但无 provider 记录必须报 no-provider-record，实际 ${JSON.stringify(noProvider)}`)

    /** ★ 三句必须**互不相同**（"不许合并"这条只能这样钉：合并的实现会让两句相等）。 */
    const reasons = [noRegion.unmeasured, noTeam.unmeasured, noProvider.unmeasured]
    assert.equal(new Set(reasons).size, 3, `★ 三支原因必须各不相同的三句，实际 ${JSON.stringify(reasons)}`)

    /**
     * ★ 失败态**不带 `providers: []`**：一个空数组会让"没读成"与"读成了、零个"
     *   在只读 `providers.length` 的 UI 上同形。
     */
    for (const reading of [noRegion, noTeam, noProvider]) {
      assert.equal('providers' in reading, false, `★ 未测量态不许带 providers 键（否则与"测到了零个"同形），实际 ${JSON.stringify(reading)}`)
    }

    console.log(`  臂1 ▸ no-region / no-team / no-provider-record 三句互不相同，且都不带 providers 键`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 线C 假阳性：空白 provider 不是"一个叫空串的后端"
// ─────────────────────────────────────────────────────────────────────────────

test("臂 2 线C 假阳性：provider 为 '' 或 '   ' 的成员不进 providers，真的那个照样在", async () => {
  const record = fixtureTeam('t1', {
    members: [fixtureMember('alice', ''), fixtureMember('bob', '   '), fixtureMember('carol', 'fake')],
  })
  const root = makeRoot('t1', record)
  try {
    const reading = await backends.provideBackendsReadout({ teamId: 't1', stateRoot: root, historic: false })
    assert.deepEqual(reading.providers, ['fake'], `★ 只有真实后端该进清单，实际 ${JSON.stringify(reading.providers)}`)
    assert.equal(reading.providers.includes(''), false, '★ 空串不是后端')
    assert.equal(reading.providers.includes('   '), false, '★ 全空白不是后端')
    console.log(`  臂2 ▸ providers = ${JSON.stringify(reading.providers)}（两个空白成员被剔除）`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 线C 去重：'fake' 与 ' fake ' 是同一个后端
// ─────────────────────────────────────────────────────────────────────────────

test("臂 3 线C 去重：'fake' + ' fake ' 两个成员 ⇒ providers 长度为 1 且值是 trim 过的", async () => {
  const record = fixtureTeam('t1', {
    members: [fixtureMember('alice', 'fake'), fixtureMember('bob', ' fake ')],
  })
  const root = makeRoot('t1', record)
  try {
    const reading = await backends.provideBackendsReadout({ teamId: 't1', stateRoot: root, historic: false })
    assert.equal(reading.providers.length, 1, `★ 去重后必须只有 1 个后端，实际 ${JSON.stringify(reading.providers)}（先 Set 后 trim 的实现会在这里报 2）`)
    assert.equal(reading.providers[0], 'fake', '★ 存进去的必须是 trim 之后的值')
    /** ★ 能力位按 provider 收格 ⇒ 去重失败时这里会多一格；顺带钉住键集与 providers 一致。 */
    assert.deepEqual(Object.keys(reading.capability), ['fake'], `★ capability 的键必须与 providers 一一对应，实际 ${JSON.stringify(Object.keys(reading.capability))}`)
    console.log(`  臂3 ▸ providers = ${JSON.stringify(reading.providers)} | capability keys = ${JSON.stringify(Object.keys(reading.capability))}`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 线C 能力位：未声明 ⇒ unknown-backend（不是五位 false）；声明 ⇒ 带 source
// ─────────────────────────────────────────────────────────────────────────────

test('臂 4 线C 能力位：查不到的 provider 落 unknown-backend（不猜）；声明过的带 source:declared；半张表抛错', async () => {
  /**
   * ① **今天真实的读法**：`DECLARED_BACKENDS` 里没有任何条目（那是一个决定，
   *    理由写在 `src/backends.ts` 的表注释里：盘上没有任何一处能支撑取值 ⇒ 填进去就是猜）。
   *    ⇒ 于是每个 provider 都必须是 `unknown-backend: …`。
   */
  const root = makeRoot('t1', fixtureTeam('t1', { members: [fixtureMember('alice', 'fake')] }))
  try {
    const reading = await backends.provideBackendsReadout({ teamId: 't1', stateRoot: root, historic: false })
    const fake = reading.capability.fake
    assert.equal(typeof fake.unmeasured, 'string', `★ 表里查不到 ⇒ { unmeasured }，实际 ${JSON.stringify(fake)}`)
    assert.match(fake.unmeasured, /^unknown-backend: /, '★ 前缀必须是 unknown-backend')
    assert.match(fake.unmeasured, /"fake"/, '★ 原因里必须点名是哪个后端')
    /**
     * ★ **不许**退化成"五位都是 false"：那读起来是"查过了，它什么都不会"。
     *   这一条只能靠"没有 capabilities 键"来钉。
     */
    assert.equal('capabilities' in fake, false, `★ 未声明不许产出能力位（哪怕全是 false），实际 ${JSON.stringify(fake)}`)

    /**
     * ② **已声明那一支**（用注入的声明表驱动 —— 见 `capabilityOf` 的注释：
     *    参数化的用途是让两支都能被钉住，生产路径永远用缺省表）。
     *    ★ 这里断的是**形状**：五位齐全 + `source: 'declared'`。
     */
    const table = { 'declared-backend': Object.fromEntries(backends.BACKEND_CAPABILITY_BITS.map((bit) => [bit, bit === 'canExec'])) }
    const declared = backends.capabilityOf('declared-backend', table)
    assert.equal(declared.source, 'declared', '★ 声明出来的能力位必须带 source:declared（"声明的"与"验证过的"要能一眼分开）')
    assert.deepEqual(Object.keys(declared.capabilities).sort(), [...backends.BACKEND_CAPABILITY_BITS].sort(), '★ 五位必须齐全')
    assert.equal(declared.capabilities.canExec, true, '★ 声明的值必须原样带出（不许在这里改写语义）')

    /** ③ **半张表**抛错：缺一位的声明比没有声明更危险（"没声明这一位"会被读成 false）。 */
    assert.throws(
      () => backends.capabilityOf('half', { half: { canExec: true } }),
      /incomplete/,
      '★ 半张能力位表必须当场抛错，不许产出部分能力',
    )

    /**
     * ④ 真实表本身的**形状**（今天为空，将来会有人填）：
     *    每一条都必须五位齐全 —— 这条断言对空表也成立（`every` 在空集上为真），
     *    所以它**不是**在把"今天为空"写成不变量（本仓那条纪律：
     *    夹具不许把"现在没有"写成断言）。
     */
    for (const [id, entry] of Object.entries(backends.DECLARED_BACKENDS)) {
      assert.deepEqual(Object.keys(entry).sort(), [...backends.BACKEND_CAPABILITY_BITS].sort(), `★ 声明表里的 "${id}" 必须五位齐全`)
    }

    console.log(`  臂4 ▸ unknown-backend: ${fake.unmeasured.slice(0, 48)}… | declared 支 source=${declared.source} | 半张表抛错 | DECLARED_BACKENDS 条目数 = ${Object.keys(backends.DECLARED_BACKENDS).length}`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 线B 双向校验（一）：侧表多一个 unknown id ⇒ 抛错
// ─────────────────────────────────────────────────────────────────────────────

test('臂 5 线B 双向校验：侧表多一个未注册的 id ⇒ 抛错并点名它；soft 空白串也抛', async () => {
  const registered = await pairing.registeredGateIds()
  assert.ok(registered.length > 0, '★ 前提：注册表非空（否则下面的"少一个 id"臂没有意义）')

  /**
   * ★ 构造"侧表里多了一个 key"：从注册表里**借一份少了一个 id 的清单**。
   *   等价形态、且不依赖"哪个 id 将来会被删"（把当下的 id 列表写成断言是另一种错误）。
   */
  const dropped = registered[registered.length - 1]
  const shrunk = registered.filter((id) => id !== dropped)
  assert.throws(
    () => pairing.pairingOf(shrunk),
    (error) => {
      assert.match(error.message, /not registered gates/, '★ 报错必须说清是"侧表多了 key"这一支')
      assert.ok(error.message.includes(dropped), `★ 报错必须点名那个 ghost id（${dropped}），实际：${error.message}`)
      return true
    },
    '★ 侧表多一个未注册的 id 必须抛错（否则那条说明会永远读成"已配对"）',
  )

  /** ★ 另一支：行在、`soft` 是空白串。它会被读成 hasSoft=true —— 而"有行"≠"那行说了话"。 */
  const blankTable = Object.fromEntries([...registered].map((id) => [id, { soft: id === dropped ? '   ' : 'ok' }]))
  assert.throws(() => pairing.pairingOf(registered, blankTable), /blank "soft"/, '★ 空白 soft 必须抛错')

  console.log(`  臂5 ▸ 少注册一个 id（${dropped}）⇒ 抛错并点名；空白 soft ⇒ 抛错`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6 线B 双向校验（二）：少一个已注册 id ⇒ 抛错且**列出缺哪些**
// ─────────────────────────────────────────────────────────────────────────────

test('臂 6 线B 双向校验：注册表里有、侧表里没有的 id ⇒ 抛错且把缺失 id 全部列出', async () => {
  const registered = await pairing.registeredGateIds()
  /** ★ 故意摘掉两条：只报第一条的实现会让人改 N 轮。 */
  const unpaired = registered.slice(0, 2)
  const table = Object.fromEntries([...registered].filter((id) => !unpaired.includes(id)).map((id) => [id, { soft: 'still here' }]))
  const reduced = Object.fromEntries(Object.entries(pairing.PAIRING).filter(([id]) => !unpaired.includes(id)))

  assert.throws(
    () => pairing.pairingOf(registered, { ...reduced, ...table }),
    (error) => {
      assert.match(error.message, /have no side-table row/, '★ 报错必须说清是"新判据没配 soft"这一支')
      for (const id of unpaired) assert.ok(error.message.includes(id), `★ 缺失的 id 必须逐个列出（漏了 ${id}），实际：${error.message}`)
      return true
    },
    '★ 已注册但没配 soft 的判据必须抛错 —— 这是"单边不许生效"唯一能被机器抓住的地方',
  )

  console.log(`  臂6 ▸ 摘掉 ${JSON.stringify(unpaired)} ⇒ 抛错且两条都被点名`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7 线B 真实闭合：真注册表 + 真侧表 ⇒ 每条 {hasSoft:true,hasHard:true}
// ─────────────────────────────────────────────────────────────────────────────

test('臂 7 线B 真实闭合：读数键集 === 注册表 id 集，每条两个布尔，且读数自报 discrimination（今天必须是 none，不许冒充 22 项成对）', async () => {
  const registered = await pairing.registeredGateIds()

  /** ★ 不带注入表 ⇒ 走的就是生产路径（真注册表 + 真侧表）。 */
  const reading = await pairing.providePairingReadout({ teamId: 't1', stateRoot: '/tmp', historic: false })

  assert.deepEqual(Object.keys(reading.entries), registered, '★ 读数的键集与顺序必须等于注册表（少一条 = 有一条判据没报；多一条 = 凭空造）')

  for (const [id, cell] of Object.entries(reading.entries)) {
    assert.deepEqual(Object.keys(cell).sort(), ['hasHard', 'hasSoft'], `★ "${id}" 只能有这两个布尔（三态是前端派生的事，多一个键就是第二表达）`)
    assert.equal(typeof cell.hasSoft, 'boolean', `★ "${id}".hasSoft 必须是布尔`)
    assert.equal(typeof cell.hasHard, 'boolean', `★ "${id}".hasHard 必须是布尔`)
    assert.equal(cell.hasSoft, true, `★ "${id}" 必须配了 soft（真侧表与真注册表必须闭合）`)
    assert.equal(cell.hasHard, true, `★ "${id}" 在注册表里 ⇒ 它有一条可执行判据（注册表拒绝 gate 非函数的注册）`)
  }

  /**
   * ── ★★★ 本臂真正的价值：**读数自己说"我今天没有判别力"** ────────────────────────
   *
   * 上一版把 22 行 `{true,true}` 直接交给界面 ⇒ 界面显示「22 项成对」，而那是恒真式。
   * 现在 `discrimination` 是**从 entries 算出来的**：只要取值组合只有一种，它必须是
   * `'none'`，并且必须带一句 `why`。
   * ★ 反向钉住（它不许被写死成常量）：见臂 14 —— 人为造一个 `false` ⇒ 必须变 `'full'`。
   */
  assert.equal(reading.discrimination, 'none', `★ 今天 22 行取值全同 ⇒ discrimination 必须是 'none'，实际 ${JSON.stringify(reading.discrimination)}`)
  assert.equal(typeof reading.why, 'string', '★ discrimination:none 时必须有 why（说明为什么它今天没有判别力）')
  assert.match(reading.why, /hasHard is true by construction/, '★ why 必须点名 hasHard 的成因（注册表不交 gate 函数）')
  assert.match(reading.why, /must not be rendered as/, '★ why 必须明确禁止把它渲染成"成对"')

  /** ★ 侧表里每条 soft 都是**一句话**，不是占位符（长度是廉价的代理，但空白串已被臂5 钉住）。 */
  for (const [id, row] of Object.entries(pairing.PAIRING)) {
    assert.equal(typeof row.soft, 'string', `★ 侧表 "${id}".soft 必须是字符串`)
    assert.ok(row.soft.trim().length >= 12, `★ 侧表 "${id}".soft 太短（${row.soft.length} 字），像占位符而不是人读说明`)
  }

  assert.deepEqual(pairing.pairingDrift(registered), { unknown: [], missing: [], blank: [] }, '★ 真表与真注册表必须零漂移')
  console.log(`  臂7 ▸ ${registered.length} 条判据全部 {hasSoft:true, hasHard:true} | discrimination=${reading.discrimination} | 侧表 ${Object.keys(pairing.PAIRING).length} 行 | 零漂移`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8 线A 投影：两条流都投出来，evidenceId 稳定且不撞
// ─────────────────────────────────────────────────────────────────────────────

test('臂 8 线A 投影：两条流都被投出来，同一份数据两次得到同一批 evidenceId，且两条流前缀不撞', async () => {
  const record = fixtureTeam('t1', {
    members: [fixtureMember('alice', 'fake')],
    tasks: [fixtureTask('task-1', {
      executions: [fixtureExecution({ at: 1792838580000 }), fixtureExecution({ at: 1792838580500, status: 'failed', verdict: 'needs_revision', round: 1 })],
      supplementalEvidence: [fixtureSupplement({ at: 1792838590000 })],
    })],
  })
  const root = makeRoot('t1', record)
  try {
    const first = await evidence.provideEvidenceReadout({ teamId: 't1', stateRoot: root, historic: false })
    const second = await evidence.provideEvidenceReadout({ teamId: 't1', stateRoot: root, historic: false })

    /** ① 两条流都在（只投一条的实现会缺掉另一支）。 */
    const streams = new Set(first.entries.map((entry) => entry.stream))
    assert.deepEqual([...streams].sort(), ['execution', 'supplemental'], `★ 两条流都必须被投影，实际 ${JSON.stringify([...streams])}`)
    assert.equal(first.entries.length, 3, `★ 期望 3 条证据（2 executions + 1 supplemental），实际 ${first.entries.length}`)

    /** ② **稳定性**：同一份数据跑两次，id 逐个相同（掺了 `Date.now()` 的实现会在这里红）。 */
    assert.deepEqual(second, first, '★ 同一份数据两次收集必须逐字段相同（读数提供者必须确定性）')
    assert.deepEqual(second.entries.map((entry) => entry.evidenceId), first.entries.map((entry) => entry.evidenceId), '★ evidenceId 必须稳定')

    /** ③ id 里必须**读得出来源**（task.id + attemptId + at），且 id 互不相同。 */
    const ids = first.entries.map((entry) => entry.evidenceId)
    assert.equal(new Set(ids).size, ids.length, `★ evidenceId 必须互不相同，实际 ${JSON.stringify(ids)}`)
    for (const entry of first.entries) {
      assert.ok(entry.evidenceId.startsWith(`task.${entry.stream === 'execution' ? 'execution' : 'evidence'}#`), `★ id 前缀必须标明流，实际 ${entry.evidenceId}`)
      assert.ok(entry.evidenceId.includes(entry.taskId), `★ id 必须含 taskId，实际 ${entry.evidenceId}`)
      assert.ok(entry.evidenceId.includes(String(entry.at)), `★ id 必须含 at，实际 ${entry.evidenceId}`)
      assert.ok(entry.evidenceId.includes('cap-1'), `★ id 必须含 attemptId，实际 ${entry.evidenceId}`)
    }

    /** ④ 排序确定（按 at），且字段原样带出（三态字段缺席就仍然缺席）。 */
    assert.deepEqual(first.entries.map((entry) => entry.at), [...first.entries.map((entry) => entry.at)].sort((a, b) => a - b), '★ 证据必须按 at 升序（golden 对比要靠它）')
    const failed = first.entries.find((entry) => entry.status === 'failed')
    assert.ok(failed !== undefined, '★ 前提：第二条 execution（status=failed）必须被投影出来')
    assert.equal(failed.failureKind, undefined, '★ 源里没有 failureKind ⇒ 投影里不许出现（缺席 ≠ 空值）')

    console.log(`  臂8 ▸ ${first.entries.length} 条证据（流：${[...streams].join('+')}）| id 稳定 ✓ | 例：${ids[0]}`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9 线A 只读不存：投影不改入参、不改盘
// ─────────────────────────────────────────────────────────────────────────────

test('臂 9 线A 只读不存：投影前后入参深相等、盘上 team.json 字节不变（投影没有写入端）', async () => {
  const record = fixtureTeam('t1', {
    members: [fixtureMember('alice', 'fake')],
    tasks: [fixtureTask('task-1', { executions: [fixtureExecution()], supplementalEvidence: [fixtureSupplement()] })],
  })
  const root = makeRoot('t1', record)
  const teamJson = join(root, 't1', 'team.json')
  try {
    const beforeBytes = readFileSync(teamJson, 'utf8')
    const beforeTeam = JSON.parse(beforeBytes)

    const reading = await evidence.provideEvidenceReadout({ teamId: 't1', stateRoot: root, historic: false })
    assert.ok(reading.entries.length > 0, '★ 前提：这份夹具确实投影出了证据')

    /** ① 入参没被改（投影里任何"往 task 上补一格"的写法都会让这条红）。 */
    assert.deepEqual(JSON.parse(beforeBytes), beforeTeam, '★ 投影不许改盘上的记录')
    /** ② 盘上字节没变（更严：连键序/缩进都不许动 —— 说明根本没写）。 */
    assert.equal(readFileSync(teamJson, 'utf8'), beforeBytes, '★ 投影不许写盘（连格式化都不许）')

    /** ③ `projectEvidence` 是纯函数：同一个记录对象调两次得到同一个结果，且记录本身不变。 */
    const clone = JSON.parse(JSON.stringify(beforeTeam))
    const projected = evidence.projectEvidence(clone)
    assert.deepEqual(clone, beforeTeam, '★ projectEvidence 不许改入参对象')
    assert.deepEqual(evidence.projectEvidence(clone), projected, '★ projectEvidence 必须是确定性的')

    /** ④ 空证据的队要落 `{ tasks: n, entries: [], duplicatesDropped: 0 }`（"测了、零条"不是 unmeasured）。 */
    const emptyRoot = makeRoot('e1', fixtureTeam('e1', { members: [fixtureMember('alice', 'fake')] }))
    try {
      const emptyReading = await evidence.provideEvidenceReadout({ teamId: 'e1', stateRoot: emptyRoot, historic: false })
      assert.deepEqual(emptyReading, { tasks: 0, entries: [], duplicatesDropped: 0, reverified: 'unknown' }, `★ 没有证据的队必须报"测到了零条"，实际 ${JSON.stringify(emptyReading)}`)
    } finally { rmSync(emptyRoot, { recursive: true, force: true }) }

    console.log(`  臂9 ▸ 入参未变 / 盘上字节未变 / 纯函数确定性 ✓ | 空队 = { tasks: 0, entries: [], duplicatesDropped: 0 }`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 10 端到端：真 stateRoot + 真快照 ⇒ readouts 三个 key 都在
// ─────────────────────────────────────────────────────────────────────────────

test('臂 10 端到端：真 team.json（含带 executions 的任务）走真快照 ⇒ readouts 里 evidence / pairing / backends 三格都在且不是 unmeasured', async () => {
  const record = fixtureTeam('t1', {
    members: [fixtureMember('alice', 'fake')],
    tasks: [fixtureTask('task-1', { executions: [fixtureExecution()], supplementalEvidence: [fixtureSupplement()] })],
  })
  const root = makeRoot('t1', record)
  try {
    /**
     * ★ 快照的 `state` 形参与盘上那份**同源**（同一个 `record` 序列化两次）：
     *   两份手写的记录会在某次改动后分叉，而那正是"两处真相"。
     * ★ 三条线的 provider 都只认 `Context 的 teamId/stateRoot` ⇒ 它们读的是**盘**，
     *   这条臂因此同时证明了"装上了"与"读得到"。
     */
    const snapshot = await assembleTeamSnapshot(context(), root, '/tmp/ws', record, {})

    assert.ok(snapshot.readouts !== undefined, '★ 三条线都落地 ⇒ 快照里 readouts 必须在场')
    for (const key of ['evidence', 'pairing', 'backends']) {
      assert.ok(key in snapshot.readouts, `★ 快照 readouts 缺少 "${key}"（装配清单漏了那一行 / 该槽位没被认领）`)
      assert.equal(snapshot.readouts[key]?.unmeasured, undefined, `★ "${key}" 落在了 unmeasured：${JSON.stringify(snapshot.readouts[key])}`)
    }

    /** 内容对不对：三格各自给一句可读的读数（不是"在场但空"）。 */
    assert.deepEqual(snapshot.readouts.backends.providers, ['fake'], `★ 后端清单必须来自盘上的 members[].provider，实际 ${JSON.stringify(snapshot.readouts.backends.providers)}`)
    assert.equal(snapshot.readouts.evidence.entries.length, 2, `★ 两条证据流各一条 ⇒ 2 条，实际 ${snapshot.readouts.evidence.entries.length}`)
    assert.equal(Object.keys(snapshot.readouts.pairing.entries).length, (await pairing.registeredGateIds()).length, '★ 配对格数必须等于注册判据数')
    /** ★ 判别力必须随读数一起出门（否则 UI 又会把 22 行恒真式渲染成"22 项成对"）。 */
    assert.equal(snapshot.readouts.pairing.discrimination, 'none', '★ 快照里的配对读数必须自带 discrimination，且今天必须是 none')

    console.log(`  臂10 ▸ readouts keys = ${JSON.stringify(Object.keys(snapshot.readouts))} | backends.providers = ${JSON.stringify(snapshot.readouts.backends.providers)} | evidence.entries = ${snapshot.readouts.evidence.entries.length} | pairing 格数 = ${Object.keys(snapshot.readouts.pairing.entries).length} | discrimination = ${snapshot.readouts.pairing.discrimination}`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 11 ★★★ 线A 防线①：`executions: [{}]` 不许拼出 `//undefined`
// ─────────────────────────────────────────────────────────────────────────────

test('臂 11 ★★★ 线A 防线①：坏掉的 execution 落 unmeasured 且**不拼 id**（全份序列化里不许出现 //undefined）', async () => {
  /**
   * ── 审计实测的坏法（伪造代价审计 2026-10-24）────────────────────────────────
   *
   * ```
   *   executions: [{}]  ⇒  产出 task.execution#t2//undefined
   * ```
   * ★ 而 `executions` **不在 durable 校验面**（`grep -c executions src/state.ts` ⇒ 0；
   *   `hasValidQualityTaskFields` 校验了 `supplementalEvidence` 却没校验 `executions`）
   *   ⇒ 这条脏记录**能过 `readTeam` 的全部校验**，一路读进投影。
   * ⇒ 一个"看起来正常、却寻址不到任何东西"的 trace id，比没有 id 更坏。
   *
   * ★ 本臂把这条实测事实**也变成断言**（下面 ① 那一步）：如果哪天有人给
   *   `executions` 补上了 durable 校验，那一步会红 —— 那时的正确处置是
   *   **删掉本臂 ① 并把投影层的防线降级为"第二道"**，而不是删掉整个臂。
   */
  const record = fixtureTeam('t1', {
    members: [fixtureMember('alice', 'fake')],
    tasks: [fixtureTask('task-2', {
      /** ★ 一条完全空的（`at` / `attempt` / `attemptId` / `status` 全缺），加一条好的作对照。 */
      executions: [{}, fixtureExecution({ at: 1792838580000 })],
    })],
  })
  const root = makeRoot('t1', record)
  try {
    /**
     * ① 前提取证：**盘上这份记录是合法的**（`readTeam` 能读回来）。
     *    ⇒ 于是"坏 execution 会到达投影层"不是推测，而是被这条路证明的。
     *    注意：`supplementalEvidence` 由 `isTaskEvidence` 校验（缺 `by` 会被拒），
     *    所以"坏 supplemental"那一条**只能在内存里构造**（见本臂 ④）。
     */
    const onDisk = await readTeam(root, 't1')
    assert.notEqual(onDisk, undefined, '★ 前提：executions 不在 durable 校验面 ⇒ 含一条 `{}` 的 team.json 仍必须能被 readTeam 读回')
    assert.equal(onDisk.tasks[0].executions.length, 2, '★ 前提：两条 execution（一条空、一条好）都要被读回来')

    const reading = await evidence.provideEvidenceReadout({ teamId: 't1', stateRoot: root, historic: false })

    /** ② **整份序列化**里不许出现 `//undefined` —— 这是"拼了 id"的唯一硬证据。 */
    const serialized = JSON.stringify(reading)
    assert.equal(serialized.includes('//undefined'), false, `★ 不许出现 //undefined 段（说明坏数据走到了 id 派生那一步），实际 ${serialized}`)
    assert.equal(serialized.includes('undefined'), false, `★ 更严：整份读数里不许出现 undefined 这个词（含散文），实际 ${serialized}`)

    /** ③ 坏的那条落 unmeasured 格子，且**带上下文**（哪个任务的哪条流第几个）。 */
    const unmeasured = reading.entries.filter((cell) => cell.unmeasured !== undefined)
    assert.equal(unmeasured.length, 1, `★ 期望 1 条坏证据落一格，实际 ${JSON.stringify(unmeasured)}`)
    const reason = unmeasured[0].unmeasured
    assert.ok(reason.includes('executions[0]') && reason.includes('task "task-2"'), `★ 原因必须指明位置（executions[0] / 任务 id），实际 ${reason}`)
    assert.ok(reason.includes('cannot be projected'), '★ 原因必须说清"投不出来"，而不是含糊一句')
    assert.ok(reason.includes('`at` is missing'), '★ 必须点名缺的是 `at`（它是 id 的一段）')

    /** ④ **单条坏不许连坐**：那条合法的 execution 必须仍被投影，且 id 逐字正确。 */
    const good = reading.entries.filter((cell) => cell.evidenceId !== undefined)
    assert.equal(good.length, 1, `★ 那条合法的 execution 必须仍被投影，实际 ${JSON.stringify(good.map((cell) => cell.evidenceId))}`)
    assert.equal(good[0].evidenceId, 'task.execution#task-2/cap-1/1792838580000', '★ 合法那条的 id 必须与派生规则逐字一致')

    /**
     * ⑤ 另一条流同样要挡：`supplementalEvidence` 缺 `by`（无法归属）。
     *    ★ 它写不进盘（`isTaskEvidence` 会拒），所以直接在内存里喂 `projectEvidence` ——
     *      而"写不进盘"恰恰说明这条流的校验面是**真的存在**的。
     */
    const inMemory = evidence.projectEvidence({
      id: 't1',
      name: 'team-t1',
      captainSessionId: 'session-probe',
      createdAt: 1000,
      members: [fixtureMember('alice', 'fake')],
      tasks: [fixtureTask('task-3', { supplementalEvidence: [{ at: 1792838590000, attempt: 1, note: 'no attributor' }] })],
      taskSeq: 1,
    })
    const supplementReason = inMemory.entries.find((cell) => cell.unmeasured !== undefined)?.unmeasured ?? ''
    assert.ok(supplementReason.includes('supplementalEvidence[0]'), `★ 另一条流同样要指明位置，实际 ${supplementReason}`)
    assert.ok(supplementReason.includes('`by` is missing'), `★ 必须点名缺的是 by，实际 ${supplementReason}`)

    console.log('  臂11 ▸ 盘上 executions:[{}] 合法且被读回 ⇒ 落 unmeasured（不拼 id）| 好的那条仍在 | 序列化里无 undefined | supplemental 缺 by 同样被挡')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 12 ★★★ 线A 防线②：内容完全相同的重复 ⇒ 只留一条，但**计数**
// ─────────────────────────────────────────────────────────────────────────────

test('臂 12 ★★★ 线A 防线②：两条完全相同的记录 ⇒ 只输出一条，duplicatesDropped=1（不静默去重）', async () => {
  const identical = fixtureExecution()
  const record = fixtureTeam('t1', {
    members: [fixtureMember('alice', 'fake')],
    tasks: [fixtureTask('task-3', {
      /** ★ 同一代、同一时刻被追加了两次 —— 写点重复写的真实形态。 */
      executions: [identical, { ...identical }],
    })],
  })
  const root = makeRoot('t1', record)
  try {
    const reading = await evidence.provideEvidenceReadout({ teamId: 't1', stateRoot: root, historic: false })

    const ids = reading.entries.map((cell) => cell.evidenceId)
    assert.equal(ids.length, 1, `★ 同一个 evidenceId 不许输出两条，实际 ${JSON.stringify(ids)}`)
    assert.equal(new Set(ids).size, ids.length, '★ evidenceId 必须唯一')
    /** ★ 关键：去重**不许静默** —— 否则"盘上重复写了"与"只写了一次"同形。 */
    assert.equal(reading.duplicatesDropped, 1, `★ 必须报出去重了 1 条，实际 ${reading.duplicatesDropped}`)

    console.log(`  臂12 ▸ 2 条相同记录 ⇒ entries 1 条 + duplicatesDropped=1（去重有账）`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 13 ★★★ 线A 防线③：同 id 但内容不同 ⇒ **整格不可用**并点名两边
// ─────────────────────────────────────────────────────────────────────────────

test('臂 13 ★★★ 线A 防线③：同一个 evidenceId 被两份不同内容认领 ⇒ 整条读数 unmeasured 并点名两边', async () => {
  const base = fixtureExecution({ at: 1792838580000 })
  /**
   * ★ 这里刻意**只在内存里构造**（不写盘、不走 readTeam）：
   *   盘上"两条同 id 的任务"会被 `isTeamTask` 的唯一性检查拒掉 —— 也就是说
   *   **这道防线只能在投影层被触发**（撞车的两条可以来自两条不同的流 / 两条不同的任务，
   *   而 task id 相同只是最直观的造法）。
   *   ⇒ 本臂钉的是 `projectEvidence` **自己**的那道防线，不是 durable 校验那道。
   */
  const conflicting = {
    id: 't1',
    name: 'team-t1',
    captainSessionId: 'session-probe',
    createdAt: 1000,
    members: [fixtureMember('alice', 'fake')],
    tasks: [
      fixtureTask('task-4', { executions: [base] }),
      fixtureTask('task-4', { executions: [{ ...base, status: 'failed' }] }),
    ],
    taskSeq: 2,
  }

  const reading = evidence.projectEvidence(conflicting)

  assert.equal(typeof reading.unmeasured, 'string', `★ 同 id 不同内容 ⇒ 整份读数必须 unmeasured，实际 ${JSON.stringify(reading).slice(0, 400)}`)
  assert.match(reading.unmeasured, /^duplicate-evidence-id: /, '★ 前缀必须是 duplicate-evidence-id（可 grep、且与 invalid-evidence 不同形）')
  assert.match(reading.unmeasured, /task-4/, '★ 必须点名是哪条任务')
  assert.match(reading.unmeasured, /execution/, '★ 必须点名是哪条流')
  /** ★ 两条都点名（"哪两条撞了"是排障的第一问）。 */
  assert.match(reading.unmeasured, /is claimed by .* and by /, '★ 必须说清"两条各自是谁"')
  /** ★ 整格不可用时**不许**偷偷带一份 entries（那会让读的人以为剩下的还能用）。 */
  assert.equal('entries' in reading, false, `★ 整格不可用时不许带 entries，实际 ${JSON.stringify(reading).slice(0, 200)}`)

  /**
   * ★ 对照：把两条改成**内容相同** ⇒ 不许整格不可用（否则这道防线就变成了"但凡重复就报警"，
   *   而那会把写点重复写这种小事升级成整格读不出来）。
   */
  const same = evidence.projectEvidence({
    ...conflicting,
    tasks: [
      fixtureTask('task-4', { executions: [base] }),
      fixtureTask('task-4', { executions: [{ ...base }] }),
    ],
  })
  assert.equal(same.unmeasured, undefined, `★ 内容相同的重复只许去重，不许落 unmeasured，实际 ${JSON.stringify(same).slice(0, 300)}`)

  console.log(`  臂13 ▸ 同 id 不同内容 ⇒ ${reading.unmeasured.slice(0, 60)}… | 对照（内容相同）⇒ 只去重`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 14 ★★★ 线B discrimination：从数据算，不是常量
// ─────────────────────────────────────────────────────────────────────────────

test('臂 14 ★★★ 线B discrimination：全部相同 ⇒ none；人为造一个 false ⇒ full（注入判定，不改生产表）', async () => {
  const registered = await pairing.registeredGateIds()

  /**
   * ① 生产路径：全同 ⇒ `none`（臂 7 已钉）。
   * ② 注入一个"有一条判据没有可执行判据"的判定 ⇒ 必须**自己**变 `full`。
   *    ★ 这条是一个**反向钉住**：它证明 `discrimination` 不是常量。
   *      没有它，任何人都可以把 `discrimination` 写死成 `'none'`（或 `'full'`）而不被抓住。
   *    ★ 用注入的 `hardOf` 而不是改生产表：生产表是契约数据，夹具不许动它
   *      （"改数据让断言变绿"是本仓明令禁止的那一类）。
   */
  const allSame = pairing.pairingOf(registered)
  assert.equal(allSame.discrimination, 'none', '★ 全同 ⇒ none')
  assert.equal(typeof allSame.why, 'string', '★ none 必须带 why')

  const oneDifferent = pairing.pairingOf(registered, pairing.PAIRING, (id) => id !== registered[0])
  assert.equal(oneDifferent.discrimination, 'full', `★ 有一条不同 ⇒ 必须变 full，实际 ${oneDifferent.discrimination}`)
  assert.equal('why' in oneDifferent, false, '★ full 时 why 必须**缺席**（不写空串：缺席 ≠ 空）')
  assert.equal(oneDifferent.entries[registered[0]].hasHard, false, '★ 注入的判定必须真的落到那一格上（否则 full 是假的）')

  /** ③ 形状封闭：读数**恰好**三格（多一格就是又长出一份没人审的输入面）。 */
  assert.deepEqual(Object.keys(allSame).sort(), ['discrimination', 'entries', 'why'], '★ none 分支恰好 entries/discrimination/why')
  assert.deepEqual(Object.keys(oneDifferent).sort(), ['discrimination', 'entries'], '★ full 分支恰好 entries/discrimination')

  console.log(`  臂14 ▸ 全同 ⇒ none（带 why）| 注入一个 false ⇒ full（why 缺席）| 判别力是算出来的`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 15 ★★★ 线A `reverified` 三态：无记录 = unknown，绝不冒充当 no / yes
// ─────────────────────────────────────────────────────────────────────────────

test('臂 15 ★★★ 线A reverified 三态：有全绿重跑⇒yes / 有失败⇒no / 无 completion 记录⇒unknown（补证据那条路永远是 unknown）', async () => {
  /**
   * ── 为什么这条臂是本次修改的核心 ────────────────────────────────────────────
   *
   * 审计实测：`supplementalEvidence` 可以一次 `update_task` 就写进去，而
   * `completion.verify-rerun` 的 `appliesTo` 要求 `taskNotTerminal === true`，
   * 补证据却要求终态 ⇒ **补证据这条路正好是 verify-rerun 跳过的那条**。
   * ⇒ 这条路写下的东西**没有任何判据复核过**，读数必须自己说出来。
   *
   * ★ 三态各自一条任务，且第四格是**对照**：只有补证据（没有 completion 记录）的任务
   *   必须是 `unknown` —— 若哪天有人把 `unknown` 实现成 `no` 或 `yes`，这一条红。
   */
  const record = fixtureTeam('t1', {
    members: [fixtureMember('alice', 'fake')],
    tasks: [
      /** ① 重跑过、全绿 ⇒ yes */
      fixtureTask('t-yes', {
        executions: [fixtureExecution({ at: 1792838581000 })],
        gateEvaluations: { completion: fixtureGateEvaluation([{ command: 'pnpm verify', status: 'passed', exitCode: 0 }]) },
      }),
      /** ② 重跑过、有一条 failed ⇒ no */
      fixtureTask('t-no', {
        executions: [fixtureExecution({ at: 1792838582000 })],
        gateEvaluations: { completion: fixtureGateEvaluation([{ command: 'pnpm verify', status: 'failed', exitCode: 1 }]) },
      }),
      /** ③ 从没求值过 completion ⇒ unknown；★ 而且它的证据**全部来自补证据那一流**（伪造的典型形态） */
      fixtureTask('t-supplement-only', {
        supplementalEvidence: [fixtureSupplement({ at: 1792838583000 })],
      }),
      /** ④ 求值过、但那次没有产出 verify-rerun 的 reruns ⇒ 仍是 unknown（不许当成 no） */
      fixtureTask('t-empty-reruns', {
        executions: [fixtureExecution({ at: 1792838584000 })],
        gateEvaluations: { completion: fixtureGateEvaluation([]) },
      }),
    ],
  })
  const root = makeRoot('t1', record)
  try {
    const reading = await evidence.provideEvidenceReadout({ teamId: 't1', stateRoot: root, historic: false })
    const stateOf = (taskId) => reading.entries.find((cell) => cell.taskId === taskId)?.reverified

    assert.equal(stateOf('t-yes'), 'yes', '★ 重跑全绿 ⇒ yes')
    assert.equal(stateOf('t-no'), 'no', '★ 重跑有失败 ⇒ no（"复核了、没过"与"没人复核"不同形）')
    assert.equal(stateOf('t-supplement-only'), 'unknown', '★ 只有补证据、没有 completion 记录 ⇒ 必须是 unknown（这是本次审计的核心形状）')
    assert.equal(stateOf('t-empty-reruns'), 'unknown', '★ reruns 为空 ⇒ 仍是 unknown，绝不冒充 no')

    /** ★ 三态都在场（否则"三态"只是纸上写的）。 */
    const states = new Set(reading.entries.map((cell) => cell.reverified))
    assert.deepEqual([...states].sort(), ['no', 'unknown', 'yes'], `★ 三种取值都要被真实覆盖，实际 ${JSON.stringify([...states])}`)

    /**
     * ── ★★★ 整格那一格（读端 `withReverified` 只认它）────────────────────────────
     *
     * ★ 它是**算出来的**，不是写死的：`reverificationSummaryOf(entries)` 必须与它逐字相等。
     *   这条断言的作用是"两处表达不许分叉"—— 一层是逐条精度，一层是整格结论。
     * ★ 聚合规则里 `unknown` 优先于 `no`：本夹具恰好 yes/no/unknown 三种都有，
     *   所以整格必须是 `unknown`（有一条纯自述的证据混在里面）——
     *   若把整格标成 `no`，那条"没人复核过"的证据就被"复核了、没过"吞掉了。
     */
    assert.equal(reading.reverified, 'unknown', `★ 混合态下整格必须取最弱一环 unknown，实际 ${reading.reverified}`)
    assert.equal(evidence.reverificationSummaryOf(reading.entries), reading.reverified, '★ 整格那一格必须由 entries 算出来（不许成为第二份真相）')

    /** ★ 对照：全绿的一队 ⇒ 整格 yes；零证据 ⇒ unknown（不是 yes）。 */
    const allYes = evidence.projectEvidence({
      id: 't9',
      name: 'team-t9',
      captainSessionId: 'session-probe',
      createdAt: 1000,
      members: [fixtureMember('alice', 'fake')],
      tasks: [fixtureTask('t-all-yes', {
        executions: [fixtureExecution()],
        gateEvaluations: { completion: fixtureGateEvaluation([{ command: 'pnpm verify', status: 'passed', exitCode: 0 }]) },
      })],
      taskSeq: 1,
    })
    assert.equal(allYes.reverified, 'yes', `★ 全部复核全绿 ⇒ 整格 yes，实际 ${allYes.reverified}`)
    assert.equal(evidence.reverificationSummaryOf([]), 'unknown', '★ 零条证据 ⇒ unknown（什么都没复核过，不许说 yes）')

    /** ★ 派生函数的成因必须可区分（unknown 的四种来源各自说得出话）。 */
    const whyOf = (taskId) => evidence.reverificationOf(record.tasks.find((task) => task.id === taskId)).why
    assert.match(whyOf('t-supplement-only'), /gateEvaluations\.completion is absent/, '★ 成因①：completion 缺席')
    assert.match(whyOf('t-empty-reruns'), /none is a CommandResult/, '★ 成因④：reruns 里没有可用条目')

    console.log(`  臂15 ▸ 逐条: t-yes=yes / t-no=no / t-supplement-only=unknown / t-empty-reruns=unknown | 整格=${reading.reverified}（最弱一环）| 全绿队=yes | 零证据=unknown`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
