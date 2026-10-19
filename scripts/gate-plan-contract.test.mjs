/**
 * ── ★★★ 建队时能不能【表达】质量契约（本夹具钉住的那条缝）─────────────────────────
 *
 * ── 缺陷形态（一句话）────────────────────────────────────────────────────────
 *
 * 队长协议 rule 3 逐字要求：
 *   `Every task needs a subject; pass kind and assignee explicitly when the plan specifies them.`
 * 而 `agent_teams_create({plan:{tasks}})` 的 schema **只声明了 5 个键**且
 * `additionalProperties: false` ⇒ 宿主校验器（`@deepseek-ai/dsh-tools` `lib/index.js:467`）
 * 逐字拒绝：
 *   `"tasks[0].kind" is not a declared property (additionalProperties: false)`
 *
 * ⇒ **提示词说可以，工具说不可以。** 两个口径，一个动作。
 *
 * ★ 而它的后果不是"少一个可选字段"：`kind` 决定一条任务走不走质量门，
 *   而质量门要求 objective+acceptance（implementation/repair 还要 inScope+verify）。
 *   于是 `defaultQualityDeliveryGraph()`（`quality-gates.ts:2520`）那五条标准草稿
 *   **一条也落不了地** —— 它的每一个契约字段都无处可放。
 *   ⇒ 这才是那个生成器零调用方的**机制原因**，不是"队长忘了用"。
 *
 * ── 这个夹具测什么（以及【不】测什么）────────────────────────────────────────
 *
 * 测：**契约字段能不能经由建队路径真的落到任务记录上**，以及
 *     **不合法的契约会不会在建队那一刻就被拒**。
 *
 * 不测：`validateCreateTask` 自己的判据语义（那由 `quality-gates-tdd` 覆盖）。
 *   本夹具只验证"那一套判据在**这条路径上**也被跑了一遍"。
 *
 * ── ★ 五条臂的分工 ───────────────────────────────────────────────────────────
 *
 *   ① 透传臂：完整质量契约 ⇒ 逐字段落到 `TeamTask` 上（不是"没报错"）
 *   ② 缺省臂：老五键 ⇒ 落盘记录**逐字不变**（不新增任何契约键）
 *   ③ 拒绝臂：质量 kind 缺契约 ⇒ **建队那一刻**拒，且错误里指名缺什么
 *   ④ 拼写臂：`kind` 拼错 ⇒ 拒（否则会被 `taskKindOf` 静默读成 `'work'`）
 *   ⑤ 对称臂：profile 路径与 inline-plan 路径**同源**（同一个 `makeTask`）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveTeamProfile } from '../lib/profiles.js'
import { registerAgentTeamsTools } from '../lib/tools.js'
import { readTeamSync } from '../lib/state.js'

const cleanups = []
test.after?.(() => {
  for (const dir of cleanups) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})

/**
 * ★ 真的插件 ctx + 真的 `agent_teams_create`（与 `gate-profile-models` 同构）。
 *
 * 手搓一份假 ctx 测的是夹具，不是产品代码 —— 而本夹具要证的正是
 * "**建队工具**这条路能不能把契约送到任务记录上"，所以必须走真的注册表。
 */
function pluginFixture(workspace) {
  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined },
      list() { return [] },
      sendMessage: async () => 'msg-0',
      [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { list: () => [], get() { return undefined } },
    on() { return () => {} },
    effect(setup) { return setup() },
    inject() { return () => {} },
    llm: { resolveCallConfig: async (cfg) => ({ ...cfg }), listModels: async () => [] },
  }
  const captain = {
    id: 'captain-session', status: 'idle',
    session: {
      header: { cwd: workspace }, events: [],
      requestHeader() { return { config: { provider: 'p', model: 'captain-default' } } },
    },
    options: { provider: 'p', model: 'captain-default' },
    steer() {},
  }
  registerAgentTeamsTools(ctx, {
    stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined,
  })
  const call = (name, args) => tools.get(name).execute(args, { agent: captain, signal: new AbortController().signal })
  return { call, tools }
}

/** 起一份最小的 profile 配置并解析它 —— 走的就是 `agent_teams_create` 的那条路。 */
function resolveWith(tasks) {
  return resolveTeamProfile(
    {
      demo: {
        taskPlanning: 'seed',
        members: [{ name: 'worker' }],
        tasks: tasks.map((task) => ({ assignee: 'worker', ...task })),
      },
    },
    'demo',
    8,
  )
}

test('臂 1 ★ 透传臂：完整质量契约经建队路径【逐字段】落到任务记录上', () => {
  /**
   * ★ 判据是"落到了"，不是"没报错" —— 一个只把入参收下、然后丢掉一半字段的实现
   *   在"没抛异常"这一维上与正确实现**同形**。所以逐字段断言。
   */
  const profile = resolveWith([{
    id: 'impl',
    subject: 'implement it',
    kind: 'implementation',
    objective: 'Make the thing work',
    acceptance: ['the thing works'],
    verify: ['pnpm test'],
    inScope: ['src/'],
    outOfScope: ['docs/'],
    deliverables: ['src/thing.ts'],
    nonGoals: ['do not rewrite the world'],
    coverageOf: ['goal-1'],
    round: 2,
    model: 'some-model',
    reasoning_effort: 'high',
  }])
  assert.equal(profile.tasks.length, 1, '★ 一条模板必须解析成一条任务')
  const [task] = profile.tasks
  assert.equal(task.kind, 'implementation', '★ kind 没落下来 ⇒ 任务会被当成 work，质量门根本不跑')
  assert.equal(task.objective, 'Make the thing work')
  assert.deepEqual(task.acceptance, ['the thing works'])
  assert.deepEqual(task.verify, ['pnpm test'])
  assert.deepEqual(task.inScope, ['src/'])
  assert.deepEqual(task.outOfScope, ['docs/'])
  assert.deepEqual(task.deliverables, ['src/thing.ts'])
  assert.deepEqual(task.nonGoals, ['do not rewrite the world'])
  assert.deepEqual(task.coverageOf, ['goal-1'])
  assert.equal(task.round, 2)
  assert.equal(task.model, 'some-model')
  assert.equal(task.reasoningEffort, 'high', '★ snake_case 入口 ⇒ camelCase 记录（与成员那一格同源）')
})

test('臂 2 ★ 缺省臂：只有老五键的模板，落盘记录【不新增】任何契约键', () => {
  /**
   * ★★ 这一条是**反向半边**，而且它与臂 1 同等重要。
   *
   * `entities.ts:5524` 那段注释逐字写着「`kind` **不传**」以及理由：
   *   "那会让这条路径建的与别的路径建的在 `kind` 一格上从**同形**变成**不同形**"
   *   （一个有关键、一个没键）。本改造**不推翻**它：缺省仍然是**不写**。
   *
   * ⇒ 若有人为了"顺手补全"而给缺省也填上 `kind: 'work'`，这条臂必须红 ——
   *   因为那会让**所有**既有种子任务的落盘形状变掉。
   */
  const profile = resolveWith([{ id: 'plain', subject: 'just do it' }])
  const [task] = profile.tasks
  for (const key of ['kind', 'objective', 'acceptance', 'verify', 'inScope',
    'outOfScope', 'deliverables', 'nonGoals', 'coverageOf', 'round', 'model', 'reasoningEffort']) {
    assert.equal(
      Object.hasOwn(task, key), false,
      `★ 没写 "${key}" 的模板不该凭空多出这一格 —— 那会改掉既有种子任务的落盘形状`,
    )
  }
})

test('臂 3 ★ 拒绝臂：质量 kind 缺契约 ⇒ 在【建队那一刻】拒，且错误指名缺什么', () => {
  /**
   * ★ 为什么必须在建队那一刻拒（而不是等到派发时由 `validateCreateTask` 拒）：
   *
   *   `create({plan})` 是**一次原子调用**。若契约不合法却先把队建出来，
   *   人看到的是"计划已批准、任务已建好"，而盘上躺着一队**注定被弹回**的任务。
   *   那时错误离原因已经隔了一次人的确认动作。
   *
   * ★ 而判据必须**复用** `validateCreateTask` 而不是重写 —— 本臂断言的正是
   *   "它的原话出现在错误里"（`require at least one acceptance criterion`），
   *   这是"复用了那一套，而不是又写了一份"的机械证据。
   */
  assert.throws(
    () => resolveWith([{ id: 'r', subject: 'x', kind: 'requirements', objective: 'o' }]),
    /requirements tasks require at least one acceptance criterion/,
    '★ 质量 kind 缺 acceptance 必须在建队时被拒，且错误要说清缺的是什么',
  )
  assert.throws(
    () => resolveWith([{ id: 'i', subject: 'x', kind: 'implementation', objective: 'o', acceptance: ['a'], inScope: ['src/'] }]),
    /implementation tasks require a non-empty verify list/,
    '★ 写类 kind 缺 verify 必须被拒（这一条是"写"独有的，requirements 不要求）',
  )
  assert.throws(
    () => resolveWith([{ id: 'i', subject: 'x', kind: 'implementation', objective: 'o', acceptance: ['a'], verify: ['pnpm test'] }]),
    /implementation tasks require a non-empty inScope/,
    '★ 写类 kind 缺 inScope 必须被拒',
  )
})

test('臂 4 ★ 拼写臂：kind 拼错必须【当场】拒，不许静默降级成 work', () => {
  /**
   * ★ 这是一条**静默降级**的防口：`taskKindOf(task)?.kind ?? 'work'`
   *   会把任何读不懂的 kind 当成 `'work'`。若入口不校验，一条
   *   `kind: 'implmentation'` 的任务会建成、派发、完成 —— 全程不报错，
   *   而质量门**一次都没跑**。那种"做完了但其实没进门"正是本仓最贵的失效形态。
   */
  assert.throws(
    () => resolveWith([{ id: 'x', subject: 'x', kind: 'implmentation' }]),
    /kind must be one of: requirements, implementation, verification, review, repair, integration, work/,
    '★ 拼错的 kind 必须被点名拒绝，并把合法值列出来',
  )
})

test('臂 5 ★ 对称臂：profile 路径与 inline-plan 路径经【同一个】映射落到任务上', () => {
  /**
   * ★ `agent_teams_create` 的两条建队路（`--profile` 与 `plan:`）最后都走
   *   `initializeProfileTeam` → `resolveTeamProfile` → `makeTask`。
   *   本臂用**同一份 tasks 形状**分别从"命名 profile"与"内联 plan"入口进入，
   *   断言得到的契约字段逐字段相同 —— 若有人给其中一条加了特判，这条臂红。
   *
   * ★ 而它测的是"同源"，不是"两条路都工作" —— 后者是臂 1 的事。
   */
  const tasks = [{
    id: 'impl', subject: 'do it', assignee: 'worker', kind: 'implementation',
    objective: 'o', acceptance: ['a'], verify: ['pnpm test'], inScope: ['src/'],
  }]
  const named = resolveTeamProfile(
    { demo: { taskPlanning: 'seed', members: [{ name: 'worker' }], tasks } },
    'demo',
    8,
  )
  const inline = resolveTeamProfile(
    { 'inline-plan': { taskPlanning: 'seed', members: [{ name: 'worker' }], tasks } },
    'inline-plan',
    8,
  )
  const pick = (profile) => {
    const { id, subject, kind, objective, acceptance, verify, inScope } = profile.tasks[0]
    return { id, subject, kind, objective, acceptance, verify, inScope }
  }
  assert.deepEqual(pick(inline), pick(named), '★ 两条建队路必须交出同一份契约形状')
})

test('臂 6 ★ 端到端臂：真跑 create({plan}) ⇒ 契约进【盘上的任务记录】（不是进 profile）', async () => {
  /**
   * ── ★★★ 这一条是臂 1 的**反向半边**，而且它是我做定向突变时才发现的缺口 ──────
   *
   * MEASURED（本轮，M4 突变）：把 `entities.ts` 里 `makeTask` 的
   * `kind: template.kind` 改成 `kind: undefined`（即**掐断透传**）、重新构建，
   * 然后跑臂 1–5 —— **5/5 全绿**。
   *
   * 原因是臂 1–5 全部断言在 `resolveTeamProfile()` 的**返回值**上，
   * 而 `resolveTeamProfile` 只是 `profiles.ts` 那一层；真正把
   * `NormalizedProfileTask` 搬成 `TeamTask` 的是 `initializeProfileTeam` 里的
   * `makeTask({...})`（`entities.ts:5531`）。
   * ⇒ **夹具停在了中间层**，于是"解析器认识这一格"与"它真的落了盘"在读数上同形。
   *   这正是本仓反复记账的形态：*两件不同的事在读数里同形*。
   *
   * ★ 所以这条臂必须走**真的工具 + 真的盘**：调 `agent_teams_create({plan})`，
   *   再用 `readTeamSync` 读回来。它测的是"落到了"，而这恰好是 M4 打不红的那一格。
   */
  const workspace = mkdtempSync(join(tmpdir(), 'plan-contract-e2e-'))
  cleanups.push(workspace)
  const { call } = pluginFixture(workspace)

  await call('agent_teams_create', {
    name: 'ContractTeam',
    approval: 'required',
    plan: {
      members: [{ name: 'worker' }],
      tasks: [
        {
          id: 'impl',
          subject: 'implement it',
          assignee: 'worker',
          kind: 'implementation',
          objective: 'Make it work',
          acceptance: ['it works'],
          verify: ['pnpm test'],
          inScope: ['src/'],
          outOfScope: ['docs/'],
        },
        { id: 'plain', subject: 'ordinary work', assignee: 'worker', dependencies: ['impl'] },
      ],
    },
  })

  const onDisk = readTeamSync(join(workspace, '.agent-teams'), 'contractteam')
  assert.equal(onDisk.tasks.length, 2, '★ 两条模板必须真的落成两条任务')

  const impl = onDisk.tasks.find((task) => task.profileSeedId === 'impl')
  const plain = onDisk.tasks.find((task) => task.profileSeedId === 'plain')
  assert.ok(impl && plain, '★ 两条任务都要带着 seed id 落盘（否则无法归属）')

  /**
   * ★ 判据是**盘上的记录**，逐字段。若只断言"返回值里有 kind"，
   *   M4 那种"解析器认识、映射丢掉"的实现仍然全绿。
   */
  assert.equal(impl.kind, 'implementation', '★ kind 没落盘 ⇒ 这条任务会被当成 work，质量门根本不跑')
  assert.equal(impl.objective, 'Make it work')
  assert.deepEqual(impl.acceptance, ['it works'])
  assert.deepEqual(impl.verify, ['pnpm test'])
  assert.deepEqual(impl.inScope, ['src/'])
  assert.deepEqual(impl.outOfScope, ['docs/'])

  /**
   * ★ 反向半边：没写契约的那条**不许**凭空多出契约键。
   *   与臂 2 同一条纪律，只是这里的"落盘"是真的盘，不是解析器的返回值。
   */
  for (const key of ['kind', 'objective', 'acceptance', 'verify', 'inScope', 'outOfScope']) {
    assert.equal(
      Object.hasOwn(plain, key), false,
      `★ 没写 "${key}" 的种子任务不该凭空多出这一格 —— 那会改掉既有种子任务的落盘形状`,
    )
  }
})

test('臂 7 ★ quality 模式：一张图从生成器走到【盘上】，且占位值必须被覆盖', async () => {
  /**
   * ── ★★★ 这一条钉的是「机制写好了、队长不会用」那一路的**最后一段** ──────────────
   *
   * BEFORE（本轮实测）：`defaultQualityDeliveryGraph()` **零调用方**
   *   —— `grep -rn "defaultQualityDeliveryGraph(" src/` 只命中定义本身。
   *   而队长协议第 8 条要求的那张五段图，正是它产出的。
   *
   * ★ 光把 schema 的格打开**不够**：能表达 ≠ 会表达。队长仍要自己逐条写五条任务，
   *   而那五条里的拓扑、`DEFAULT_REVIEW_OBJECTIVE`、`DEFAULT_REVIEW_ACCEPTANCE`、
   *   以及"review 该审哪一条"都是生成器已经知道的。
   *   ⇒ 本臂钉的是 `plan.quality` 这一个**出口**：给目标 + 人 + 路径 + 命令，
   *     图由生成器铺，落到**盘上的任务记录**。
   *
   * ★★ 两条负向半边（它们才是这条臂真正的价值）：
   *   ① `tasks` 与 `quality` 同时给 ⇒ 拒（两张图混在一起，没有可读的规则说谁赢）
   *   ② 生成器的 `inScope: ['src/']` / `verify: ['pnpm test']` 是**占位**，
   *      而 `qualityPlanningPrompt()` 第 4 条自己逐字写着 `never assume src/ or pnpm test`
   *      ⇒ 调用方不覆盖就必须**拒**，不许把 `pnpm test` 落进一条真实的交付任务。
   */
  const workspace = mkdtempSync(join(tmpdir(), 'plan-quality-e2e-'))
  cleanups.push(workspace)
  const { call } = pluginFixture(workspace)

  await call('agent_teams_create', {
    name: 'QualityTeam',
    approval: 'required',
    plan: {
      members: [{ name: 'dev' }, { name: 'rev' }],
      quality: {
        goal: 'ship the parser',
        implementer: 'dev',
        reviewer: 'rev',
        inScope: ['src/parser/'],
        verify: ['pnpm vitest run'],
      },
    },
  })

  const onDisk = readTeamSync(join(workspace, '.agent-teams'), 'qualityteam')
  assert.deepEqual(
    onDisk.tasks.map((task) => task.kind),
    ['requirements', 'implementation', 'verification', 'review', 'integration'],
    '★ 五段顺序必须逐条落盘（生成器铺的图，不是手写）',
  )

  const [req, impl, verify, review, integration] = onDisk.tasks
  assert.deepEqual(req.dependencies, [], '★ requirements 是根')
  assert.deepEqual(impl.dependencies, [req.id], '★ implementation 依赖 requirements')
  assert.deepEqual(verify.dependencies, [impl.id])
  assert.deepEqual(review.dependencies, [verify.id])
  assert.deepEqual(integration.dependencies, [review.id], '★ integration 依赖 review 轮一')

  /**
   * ★★ 占位覆盖的**正向**读数：盘上必须是调用方给的那两个值，
   *   而**不许**是生成器的 `['src/']` / `['pnpm test']`。
   */
  assert.deepEqual(impl.inScope, ['src/parser/'], '★ 占位 src/ 必须被覆盖')
  assert.deepEqual(impl.verify, ['pnpm vitest run'], '★ 占位 pnpm test 必须被覆盖')

  /**
   * ★ `reviewedTaskId` 必须已经过 `seedToActual` 换成**真实 id**。
   *   落成种子 id（`'implementation'`）会让校验器判 `does not exist`，而那条错误的
   *   表现离原因很远 —— 它长得像"审查任务建不出来"。
   */
  assert.equal(review.reviewedTaskId, impl.id, '★ review 必须指向真实 id，不是种子 id')
  assert.equal(review.reviewedTaskId, 't2', '★ 具体是哪一条：implementation 是第二条')

  /**
   * ★ 三条负向：每一条都必须在**建队那一刻**拒。
   */
  await assert.rejects(
    () => call('agent_teams_create', {
      name: 'BothTeam',
      plan: {
        members: [{ name: 'dev' }],
        tasks: [{ id: 'a', subject: 's', assignee: 'dev' }],
        quality: { goal: 'g', implementer: 'dev', reviewer: 'dev', inScope: ['s'], verify: ['v'] },
      },
    }),
    /mutually exclusive/,
    '★ 两张图混在一起必须拒（没有可读的规则说谁赢）',
  )
  await assert.rejects(
    () => call('agent_teams_create', {
      name: 'NoScopeTeam',
      plan: { members: [{ name: 'dev' }], quality: { goal: 'g', implementer: 'dev', reviewer: 'dev' } },
    }),
    /inScope/,
    '★ 不覆盖占位 inScope/verify ⇒ 拒（占位值不许静默落盘成一条真实任务的契约）',
  )
})

test('臂 8 ★ quality 模式：不给 analyst 也必须能建出队（且回退是 analyst←implementer）', async () => {
  /**
   * ── 这一条钉的是**一条真实会挡路的缺口**，不是我假想的 ──────────────────────────
   *
   * MEASURED（本轮）：`plan.quality` 只给 goal/implementer/reviewer 时，
   * `defaultQualityDeliveryGraph()` 的 requirements 草稿 `assignee: input.analyst`
   * 是 `undefined` ⇒ `normalizeTask` 逐字拒：
   *   `profile task "requirements-round-1" is missing an assignee`
   *
   * ★ 而"不给 analyst"是**最自然的写法**：一支两人的队里，需求通常就是实现者自己提的。
   *   一条只在"必须多给一个 analyst 人"时才走得通的入口，等于没打通。
   *
   * ── ★ 判据的两面 ──────────────────────────────────────────────────────────────
   *   正向：不给 analyst ⇒ requirements 落在 implementer 身上，队能建出来。
   *   反向：**给了** analyst ⇒ 必须用给的，不许被回退吞掉（回退是可覆盖的缺省，
   *         不是硬编码）。
   */
  const workspace = mkdtempSync(join(tmpdir(), 'plan-quality-analyst-'))
  cleanups.push(workspace)
  const { call } = pluginFixture(workspace)

  await call('agent_teams_create', {
    name: 'NoAnalystTeam',
    approval: 'required',
    plan: {
      members: [{ name: 'dev' }, { name: 'rev' }],
      quality: {
        goal: 'ship the parser',
        implementer: 'dev',
        reviewer: 'rev',
        inScope: ['src/parser/'],
        verify: ['pnpm vitest run'],
      },
    },
  })
  const team = readTeamSync(join(workspace, '.agent-teams'), 'noanalystteam')
  const requirements = team.tasks.find((task) => task.kind === 'requirements')
  assert.equal(requirements?.assignee, 'dev', '★ 不给 analyst ⇒ 回退到 implementer')

  /* ── 反向半边：给了 analyst 就必须用它 ── */
  const workspace2 = mkdtempSync(join(tmpdir(), 'plan-quality-analyst2-'))
  cleanups.push(workspace2)
  const second = pluginFixture(workspace2)
  await second.call('agent_teams_create', {
    name: 'WithAnalystTeam',
    approval: 'required',
    plan: {
      members: [{ name: 'dev' }, { name: 'rev' }, { name: 'ana' }],
      quality: {
        goal: 'ship the parser',
        implementer: 'dev',
        reviewer: 'rev',
        analyst: 'ana',
        inScope: ['src/parser/'],
        verify: ['pnpm vitest run'],
      },
    },
  })
  const team2 = readTeamSync(join(workspace2, '.agent-teams'), 'withanalystteam')
  assert.equal(
    team2.tasks.find((task) => task.kind === 'requirements')?.assignee,
    'ana',
    '★ 给了 analyst ⇒ 必须用给的（回退是可覆盖的缺省，不是硬编码）',
  )
})
