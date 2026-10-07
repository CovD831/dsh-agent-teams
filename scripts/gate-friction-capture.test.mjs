/**
 * ── 卡点台账：在【发生时】记，且记录必须【能重放】（t22 / f-0014）──────────────────
 *
 * 契约见 `.agent-teams/frictions/README.md`。本文件钉的不是某条判据的语义，
 * 而是**台账机制本身**：卡点发生时落下的那条记录，能不能支撑"再发生一次"。
 *
 * ── 它防的是什么失效（MEASURED，本轮试跑）──────────────────────────────────────
 *
 * 第一轮台账记了 12 条卡点，**12/12 条 `replayable: false`** —— 三样全是空的：
 *
 *     · `scene.ctx`               全 null ⇒ 重建不出当时的输入
 *     · `context.eventRefs`       指不到事件 ⇒ 原始观测存在但不可定位
 *     · `observed.mechanismState` 全 null ⇒ 拿不到判据当时的完整输出
 *
 * f-0014 的结论：「记录必须在【卡点发生时】做，**事后补是补不上的**」——
 * 事后拿得到的只有任务 output（已经过一轮解释）与 git 历史（只有文件的 revision）。
 *
 * ── ★★ 第一臂是"隔离臂"，而它是被实测逼出来的 ───────────────────────────────────
 *
 * MEASURED（2026-07-22 实测）：本夹具第一版复用了一个**进程级单值** stateRoot
 * （`cwd + stateDir`）⇒ 夹具与成员各自临时工作区里发生的卡点，**全部被写进了
 * 主树那份团队真台账**。一次夹具跑动就往真台账里塞 6 条假卡点，而它们在读取端
 * 与真卡点**同形**（只有 `scene.team` 是占位名才勉强看得出）。
 *
 * ★ 形态与 f-0022 同源：「夹具造出的东西与产品造出的东西在返回值上同形」——
 *   只不过这里是**写进同一个文件**。而台账是"记录"，被污染之后**不可重算**
 *   （README 第一条纪律：原始现象丢了就完了）。
 * ⇒ 所以本文件第一条臂就钉"写到哪儿"，而不是最后一条。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { registerAgentTeamsTools } from '../lib/tools.js'
import { createTeamDir } from '../lib/state.js'

/**
 * 一个可用的夹具：临时工作区 + 真实 git 仓库 + 一个团队 + 一个成员。
 *
 * ★ 全程**不碰主树**：`stateDir` 走临时目录 ⇒ 台账落在它自己那里。
 */
function fixture({ withSession = true } = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'friction-'))
  const git = (args) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q', '.'])
  writeFileSync(join(workspace, 'a.ts'), 'a\n')
  git(['add', '-A'])
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])

  const stateRoot = join(workspace, '.agent-teams')
  const tools = new Map()
  const warnings = []
  const ctx = {
    logger: { debug() {}, info() {}, warn(m) { warnings.push(m) }, error(m) { warnings.push(m) } },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined }, list() { return [] },
      sendMessage: async () => 'msg-0', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { get() { return undefined } },
    on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, {
    stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined,
  })
  return { workspace, stateRoot, tools, warnings, member: (id) => memberAgent(id, workspace, withSession) }
}

function memberAgent(id, workspace, withSession) {
  const diffs = [{ path: 'a.ts', oldText: 'a', newText: 'b' }]
  const events = withSession ? [{ type: 'tool/result', meta: { diffs } }] : []
  return {
    id, status: 'working', steer() {},
    session: { header: { cwd: workspace, id: `sess-${id}` }, events, ownEvents() { return events } },
  }
}

/** 建一个带一条未完成质量任务的团队。 */
async function seedTeam(stateRoot, taskId, overrides = {}) {
  await createTeamDir(stateRoot, {
    id: 'team', name: 'T', captainSessionId: 'cap', createdAt: 1, taskSeq: 1,
    members: [{ id: 'm1', name: 'worker', status: 'working', joinedAt: 1 }],
    tasks: [{
      id: taskId, subject: 'x', status: 'in_progress', assignee: 'worker', dependencies: [],
      attempt: 1, attemptId: 'a1', kind: 'repair', objective: 'o', inScope: ['a.ts'],
      acceptance: ['x'], verify: ['true'], changedPaths: ['a.ts'], createdAt: 1, updatedAt: 1,
      ...overrides,
    }],
  })
}

/** 读这个夹具自己工作区里的台账（**不读主树那份**）。 */
function frictionRecords(stateRoot) {
  const dir = join(stateRoot, 'frictions')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => /^f-\d+\.json$/.test(name))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')))
}

/** 触发一次判据拒绝：走真实工具入口。 */
async function rejectOnce(f, taskId = 't1') {
  return f.tools.get('agent_teams_update_task').execute(
    {
      task_id: taskId, attempt_id: 'a1', status: 'completed', changedPaths: ['a.ts'],
      acceptanceResults: [{ criterion: 'c', status: 'passed' }],
      commandsRun: [{ command: 'true', status: 'passed', exitCode: 0 }],
    },
    { agent: f.member('m1'), signal: new AbortController().signal },
  ).then(() => undefined).catch((error) => String(error.message))
}

/** 落盘是异步的（拒绝路径不许等它）—— 等一小会儿再读。 */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 300))
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★ 隔离臂）：台账必须落在【这个团队自己的】目录里
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 隔离臂：卡点记进本团队自己的 stateRoot —— 不许污染别处的台账', async () => {
  /**
   * ★ 本臂的来历写在文件头：第一版用进程级单值 ⇒ 夹具的卡点写进了主树真台账。
   *   ⇒ 断言必须落在"**写到哪儿**"，而不只是"有没有写"。
   *
   * ★ 做法：这个夹具的 `stateRoot` 在临时目录里 ⇒ 只要记录出现在**那里**，
   *   就说明它没有跑到别处去。真正的台账在 `cwd/.agent-teams/frictions`
   *   —— 本臂同时断言**那个**目录没有因这次调用而改变。
   */
  const f = fixture()
  await seedTeam(f.stateRoot, 't1')
  await rejectOnce(f)
  await settle()

  const mine = frictionRecords(f.stateRoot)
  assert.ok(
    mine.length > 0,
    '★ 卡点必须落进【本团队自己的】stateRoot —— 一条都没有说明记录跑了或落到了别处',
  )

  /**
   * ★ 反向半边：主树的台账**不许**因这次调用而多东西。
   *   （这条是真正防污染的：上面那条只证明"我这儿有"，它证明"别人那儿没有"。）
   */
  const mainLedger = join(process.cwd(), '.agent-teams', 'frictions')
  const mainCountBefore = existsSync(mainLedger)
    ? readdirSync(mainLedger).filter((name) => /^f-\d+\.json$/.test(name)).length
    : 0
  await rejectOnce(f, 't1')
  await settle()
  const mainCountAfter = existsSync(mainLedger)
    ? readdirSync(mainLedger).filter((name) => /^f-\d+\.json$/.test(name)).length
    : 0
  assert.equal(
    mainCountAfter, mainCountBefore,
    '★ 一次夹具调用不得往【主树那份团队真台账】里加东西 —— 那是不可重算的记录，'
    + `污染之后与真卡点同形。实测 ${mainCountBefore} ⇒ ${mainCountAfter}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★ 核心臂）：三样缺一不可 —— 它们是"事后补不上"的那三样
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 记录臂：ctx 快照 / 事件定位 / 机制状态 —— 三样都在，缺一即不可重放', async () => {
  /**
   * ★ 这三样不是"最好有"，而是 f-0014 实测出来的**充要条件**：
   *   缺任何一样，那条记录就 `replayable:false`（第一轮 12/12 都是这样）。
   */
  const f = fixture()
  await seedTeam(f.stateRoot, 't1')
  await rejectOnce(f)
  await settle()

  const [record] = frictionRecords(f.stateRoot)
  assert.ok(record !== undefined, '★ 必须先有一条记录')

  /** ① ctx 快照：判据真的读到的那一份。 */
  assert.notEqual(
    record.scene.ctx, null,
    '★ ① `scene.ctx` 不许是 null —— 第一轮的 12 条全是 null，于是**重建不出当时的输入**',
  )
  assert.equal(typeof record.scene.ctx, 'object', '★ 而它必须是结构化快照（不是一句人话）')
  /**
   * ★ 快照要**真的含判据要的那几格**，而不只是一个空对象：
   *   一个 `{}` 会让上面两条全绿，而它什么也重放不出来。
   */
  assert.ok(
    Object.keys(record.scene.ctx).length > 0,
    '★ 快照不能是空对象 —— 空的 ctx 与"没记 ctx"在重放时同形',
  )

  /** ② 事件定位：会话 id + 事件序号。 */
  assert.ok(Array.isArray(record.context.eventRefs), '★ ② `eventRefs` 必须是数组（哪怕是解释为什么没有）')
  assert.ok(record.context.eventRefs.length > 0, '★ 而它不许为空 —— 空的定位与"没有观测"同形')
  assert.match(
    String(record.context.eventRefs.join(' ')), /tool\/result/,
    '★ 定位要指到**具体的事件类别**，而不只是"某个会话"',
  )

  /** ③ 机制状态：输入面核对结论 + 判据裁决。 */
  assert.notEqual(
    record.observed.mechanismState, null,
    '★ ③ `mechanismState` 不许是 null —— 第一轮全是 null，于是拿不到判据当时的输出',
  )

  /**
   * ★ `index.replayable` 必须**由证据推出来**，不是一个写死的 true。
   *   本臂的构造里事件可读 ⇒ 它应为 true；而下面臂 3 构造不可读 ⇒ 必须为 false。
   *   （两臂合起来才证明这一格"不是装饰"。）
   */
  assert.equal(record.index.replayable, true, '★ 三样齐备 ⇒ 这条记录声明自己可重放')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★ 反向臂）：拿不到事件定位时，必须如实说 **不可重放**
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 反向臂：事件读不到 ⇒ replayable:false 且写进 unknown（不许假装完整）', async () => {
  /**
   * ── ★ 本臂防的是"把没记到的东西写成没发生" ────────────────────────────────────
   *
   * f-0014 里那条最有价值的观察是：**`replayable` 这一格本身就起作用了** ——
   * 「它让『读得懂』与『能重放』不同形。若没有这一格，这 12 条会被读成『完整的记录』」。
   *
   * ⇒ 所以：拿不到事件定位时，记录必须**如实标 false**，并把"没拿到什么"
   *   写进 `unknown`。留空会被读取端读成"当时没有"，而那与"我没记到"是两件事。
   */
  const f = fixture({ withSession: false })
  await seedTeam(f.stateRoot, 't1')
  await rejectOnce(f)
  await settle()

  const [record] = frictionRecords(f.stateRoot)
  assert.ok(record !== undefined, '★ 即使拿不到事件，卡点本身仍然要记下来（记不下与没卡点是两件事）')

  assert.equal(
    record.index.replayable, false,
    '★ 拿不到事件定位 ⇒ 必须如实标 `replayable: false`；标 true 就是把「读得懂」当成「能重放」',
  )
  assert.ok(
    Array.isArray(record.unknown) && record.unknown.length > 0,
    '★ 而且"没拿到什么"必须写进 `unknown` —— 留空会被读成"当时没有"',
  )
  assert.ok(
    record.unknown.some((item) => /event|session/i.test(String(item))),
    `★ 那一条要说清缺的是【事件定位】。实测：${JSON.stringify(record.unknown)}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★ 重放臂）：拿记录去重跑那条判据 —— 卡点必须**再发生一次**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4（★ 本条是"记录 vs 日志"的分水岭）：用记录重跑，卡点必须再发生一次', async () => {
  /**
   * ── ★★ 为什么这一臂是本文件的核心 ──────────────────────────────────────────────
   *
   * 一条"写下来了"的记录与一条"**能重放**"的记录，在其它所有臂上都同形：
   * 两者都有 ctx、都有 eventRefs、都 `replayable: true`。
   * ⇒ 唯一能把它们分开的判据是：**拿这条记录去重跑，卡点再现一次**。
   *
   * ★ 做法（不引入新接口）：用记录里的 `scene.ctx` 作为输入，直接喂给那条判据的
   *   `gate()`，断言它**仍然拒绝**。这就是"卡点能再发生一次"的可执行形式。
   */
  const f = fixture()
  await seedTeam(f.stateRoot, 't1')
  await rejectOnce(f)
  await settle()

  const [record] = frictionRecords(f.stateRoot)
  assert.ok(record !== undefined)
  assert.equal(
    record.index.replayable, true,
    '★ 前置：这条记录声称自己可重放 —— 否则下面测的是一个不可重放的东西',
  )

  /**
   * ── ★★★ 重放的正确形式：把那些**函数**从宿主重新注入（t79）───────────────────
   *
   * MEASURED（本任务定位）：`toReplayableSnapshot` 把每一个函数序列化成
   * `{ __absent: 'function' }` —— 而那是**忠实**的（函数进不了 JSON）。
   * ⇒ 于是重放时 `loadKindRequirements` 那个位置上是**对象**，
   *   `loadKindRequirementsOfHost` 读 `typeof !== 'function'` ⇒ kind 表不可用
   *   ⇒ `mutation.appliesTo` 返回 false ⇒ **门不说话** ⇒ 裁决落到 `verify-rerun`。
   *
   * ★ 所以重放**必须**从宿主重新注入那些函数，而不是拿 JSON 里的占位对象凑合。
   *   ★ 而注入什么、由谁决定：由**这个夹具**决定（它就是"重放宿主"）。
   *     生产里那一份由 `src/tools/update-task.ts` 注入 —— 两者**同一批名字**。
   */
  const { registry } = await import('../lib/gates/index.js')
  const { rehydrateReplayCtx } = await import('../lib/tools/shared/entities.js')
  const point = record.index.component

  /**
   * ★ 注入表：本夹具能提供的、与生产同形的实现。
   *   ★ 而**故意不提供全部** —— 下面要证明"缺一格"会被如实报出来，
   *     而不是像从前那样静默跑到另一条分支上。
   */
  /**
   * ★★★ 而 `loadKindRequirements` 必须交一份【真的表】（t79 实测的关键一格）─────
   *
   * MEASURED：我第一版给的是 `() => ({})` —— 那会被 `parseKindRequirements`
   *   判成 `malformed`（"no kinds array"）⇒ 与"没注入"**在后果上相同**：
   *   `mutation.appliesTo` 返回 false ⇒ 门沉默 ⇒ 裁决落到 `verify-rerun`。
   *
   * ⇒ ★ 于是"重新注入"这件事**必须注入一个形状正确的东西**，
   *   否则那一步是仪式性的（它跑了、而判据读到的仍然是"用不了"）。
   * ★ 而这一条正是本任务最有价值的发现：**"注入了"与"注入的东西能用"是两件事。**
   */
  const { parseKindRequirements } = await import('../lib/gates/completion/kind-requirements.js')
  const { readFileSync } = await import('node:fs')
  const kindTable = parseKindRequirements(JSON.parse(readFileSync(
    new URL('../src/gates/completion/kind-requirements.json', import.meta.url), 'utf8',
  )))
  assert.equal(kindTable.status, 'loaded', '★ 前置：那一份表必须真的读得出来（否则本臂测的是坏表）')

  const injections = {
    loadKindRequirements: () => kindTable,
    loadRules: () => ({}),
    readFile: () => undefined,
    runTest: () => undefined,
    /**
     * ★ 而 `execVerifyCommand` 也在注入表里 —— 缺它时 `verify-rerun` 会报
     *   `unmeasured` 并**成为裁决**，那同样把 `mutation` 挡住。
     *   ★ 而这不是"为了让它绿而凑齐"：生产里那一格**本来就是接上的**
     *     （`src/tools/update-task.ts` 注入 `runVerifyCommand`）——
     *     重放要复现生产，就必须也接上它。
     */
    execVerifyCommand: async () => 0,
  }
  const { ctx: replayedCtx, injected, unreplayable } = rehydrateReplayCtx(record.scene.ctx, injections)

  /** ★ 前置：至少真的重注入了一格 —— 否则本臂测的是"什么都没注入"。 */
  assert.ok(
    injected.includes('loadKindRequirements'),
    `★ 那**关键的一格**必须被重新注入（它就是分叉的根因）。实测注入的：${JSON.stringify(injected)}`,
  )
  /**
   * ★★ 而"注入不了的那几格"必须**如实列出来** —— 这一条就是本任务要的
   *   「分叉可见」（选项 ② 的价值）与「重放更真」（选项 ① 的价值）的**合取**：
   *   ① 让能注入的注入了；② 把注入不了的**说出来**，而不是让它静默。
   */
  assert.ok(
    Array.isArray(unreplayable),
    '★ 注入不了的那几格必须被列出来（它们是"重放做不到"的如实读数）',
  )

  const replay = await registry.evaluate(point, replayedCtx)
  assert.equal(
    replay.ok, false,
    `★ 用（重新注入后的）记录 ctx 重跑 "${point}" 必须以**拒绝**结束（卡点再现）—— `
    + `若它是 ok，说明这份 ctx 不足以重放那个卡点，而"可重放"这句话就是假的。`
    + ` 实测：${JSON.stringify(replay).slice(0, 300)}`,
  )

  /**
   * ── ★★ 三态不同形（契约要求）─────────────────────────────────────────────────
   *
   *     `consistent`  —— 重放与记录落到**同一个判据**上
   *     `diverged`    —— 落到了别的判据上（★ 并说清**分在哪一格**）
   *     `unmeasurable`—— 重放**跑不起来**（注入不了 ⇒ 不许假装跑过）
   *
   * ★ 而这三者必须**不同形**：把 `diverged` 读成 `consistent` 就是本任务修的那个缺陷；
   *   把 `unmeasurable` 并进任何一者，就是"没测到并进通过/不通过"。
   */
  const recorded = String(record.title ?? '')
  const replayed = String(replay.unmeasured ?? replay.blockers?.join('; ') ?? '')
  const recordedGate = /\[([\w.-]+)\]/.exec(recorded)?.[1]
  const replayedGate = /\[([\w.-]+)\]/.exec(replayed)?.[1]
  assert.notEqual(recordedGate, undefined, `★ 记录里必须带有判据 id（否则无从比对）：${recorded.slice(0, 120)}`)

  assert.equal(
    replayedGate, recordedGate,
    `★ 重放必须落到**同一个判据**上。记录里是「[${recordedGate}]」，`
    + `重放得到「[${replayedGate}]」——`
    + ` 分叉说明 ctx 里有**重放兑现不了**的东西，而判据因此跑到了另一条分支上。`
    + ` ★ 而本任务已修的是：那一格现在会被【重新注入】（注入的：${JSON.stringify(injected)}），`
    + ` 注入不了的会被如实列出（${JSON.stringify(unreplayable)}）。`
    + ` 完整重放：${JSON.stringify(replay).slice(0, 300)}`,
  )

  /**
   * ── ★★★ 反向半边（“仍能抓住真分叉”）─────────────────────────────────────────
   *
   *   本臂必须**仍能**在真分叉上变红 —— 否则它只是"我把它改成绿了"。
   *   ⇒ 构造一个**故意缺注入**的重放：不给 `loadKindRequirements`
   *     ⇒ 分叉必须**再次出现**（落到 verify-rerun 而不是 mutation）。
   *
   * ★ 缺了这一半，一个"无论输入如何都返回同一个 id"的实现会让本臂恒真。
   */
  const broken = rehydrateReplayCtx(record.scene.ctx, { ...injections, loadKindRequirements: undefined })
  assert.ok(
    broken.unreplayable.includes('loadKindRequirements'),
    '★ 不给那一格 ⇒ 它必须出现在 `unreplayable` 里（而不是被静默忽略）',
  )
  const brokenReplay = await registry.evaluate(point, broken.ctx)
  const brokenReplayed = String(brokenReplay.unmeasured ?? brokenReplay.blockers?.join('; ') ?? '')
  const brokenGate = /\[([\w.-]+)\]/.exec(brokenReplayed)?.[1]
  assert.notEqual(
    brokenGate, recordedGate,
    `★ ★ 反向半边：把关键那一格**拿掉**之后，重放必须**再次分叉**（否则本臂对"真分叉"没有分辨力）。`
    + ` 记录里是「[${recordedGate}]」，缺注入时得到「[${brokenGate}]」`,
  )
})
