/**
 * ── 「本进程持有的模块是旧的」必须可检测、可上报（t23 / C）────────────────────────
 *
 * ── 它防的是什么失效（MEASURED，本轮**五次**拦截）────────────────────────────────
 *
 * 本队今晚被同一个东西拦了 5 次（t14 / t17 / t19 / t22 / t23 开工），而每一次的
 * **表面理由都不同**：
 *
 *     · `dispatch.changed-paths` 说「你虚报改动」
 *     · `completion.backtest`    说「基准不可得」
 *     · `claim_task`             说「依赖未满足」
 *
 * ⇒ 而真相只有一个：**进程加载的是构建前的模块**。
 *   ★ 形态：**一个机制级的失效，伪装成一条业务规则**。
 *     代价不是"重载一次"，而是"**每一轮都重新误诊一次**"。
 *
 * ── 为什么 ESM 让这件事必然发生（机制级解释）───────────────────────────────────
 *
 * `import { f } from './state.ts'` 建立的是**命名绑定**，在**模块求值时**建立，
 * 之后**永远指向同一个函数对象**。⇒ 盘上 `.js` 被 `pnpm build` 覆盖后，进程里那个
 * 函数还是旧的 —— 因为它的**闭包环境**也是旧的。
 * ★ 所以"每次调用时求值"这句话不精确：函数体确实每次跑，但它**本身**是从旧实例拿来的。
 *
 * ── ★★ 本夹具钉什么、不钉什么（边界写清）────────────────────────────────────────
 *
 *   钉：**该不该重载**（stamp 不一致 ⇒ 报）。
 *   **不**钉：哪一段是旧的 —— 那需要模块图内省，做不干净，而 5 次拦截里真正需要的
 *     判断是前者。
 *   ★ 已知边界（**写成断言，防止下一个人去修一个修不了的东西**）：
 *     即使 stamp 一致，也可能有段落是旧的。这一格本读数**测不了**，
 *     它必须在措辞里说明，而不是假装覆盖。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { moduleFreshness, moduleFreshnessMessage } from '../lib/tools.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STAMP = join(ROOT, 'lib', 'git-artifact-stamp.json')

/** 改盘上的 stamp，跑一段，**无论成败都还原** —— 绝不把仓库留在脏状态。 */
function withStampOutput(output, run) {
  const original = readFileSync(STAMP, 'utf8')
  try {
    const parsed = JSON.parse(original)
    writeFileSync(STAMP, `${JSON.stringify({ ...parsed, output }, null, 2)}\n`, 'utf8')
    return run()
  } finally {
    writeFileSync(STAMP, original, 'utf8')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（对照臂）：一致 ⇒ current，且**不阻止任何东西**
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 对照臂：盘上与加载时一致 ⇒ current', () => {
  const freshness = moduleFreshness()
  assert.equal(freshness.status, 'current', `实测：${JSON.stringify(freshness)}`)
  assert.equal(typeof freshness.loaded, 'string', '★ 一致时要把两个指纹都交出来（否则人没法核对）')
  assert.equal(freshness.loaded, freshness.onDisk)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★ 核心臂）：盘上变了而进程没重载 ⇒ 必须报 stale
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 2（核心）：盘上的构建变了、而本进程没重载 ⇒ 必须报 stale，并说"请重载"', () => {
  /**
   * ── ★ 这是本任务存在的理由的可执行形式 ────────────────────────────────────────
   *
   * 它**必须**能区分"我持有旧模块"与"我持有当前模块"。一个恒为 `current` 的实现
   * 会让本臂红 —— 而那正是今晚 5 次误诊能够发生的原因。
   */
  const freshness = withStampOutput('deadbeef'.repeat(8), () => moduleFreshness())
  assert.equal(
    freshness.status, 'stale',
    `★ 盘上的 stamp 已经变了，而本进程加载的还是旧的那一份 ⇒ 必须报 stale。实测：${JSON.stringify(freshness)}`,
  )
  assert.equal(typeof freshness.loaded, 'string')
  assert.equal(typeof freshness.onDisk, 'string')
  assert.notEqual(freshness.loaded, freshness.onDisk, '★ 两个指纹必须真的不同（否则"不一致"没有依据）')

  /**
   * ★★ 措辞**不许用业务语气**。这是本任务要消灭的那个伪装本身：
   *   它不能读起来像"你的申报有问题"，而要读起来像"**这个进程该重载了**"。
   *   ⇒ 断言两半：说清"旧"、且说清"动作是重载"。
   */
  const message = moduleFreshnessMessage(freshness)
  assert.match(message, /OLDER|old/i, `★ 必须说清"它比盘上旧"。实测：${message}`)
  assert.match(message, /reload/i, `★ 而必须给出动作（重载）—— 否则读的人仍然要去猜。实测：${message}`)
  assert.doesNotMatch(
    message, /rejected|not declared|blocked/i,
    '★ 措辞不许像一条业务规则（那正是它要消灭的伪装）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★ 三态臂）：读不到 stamp 必须与「一致」不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3（三态）：读不到 stamp ⇒ unknown，且**与 current 不同形**', () => {
  /**
   * ── ★ 这一臂防的是本队反复记账的那条合流 ──────────────────────────────────────
   *
   * 把「读不到」读成「一致」会让 **"我没能检查" 伪装成 "检查过了，是新的"** ——
   * 而那正是本任务要消灭的那个形态的**又一次出现**（只不过换了一层）。
   */
  const freshness = withStampOutput(undefined, () => {
    /** 模拟"盘上读不到 stamp"：把文件移开。 */
    const original = readFileSync(STAMP, 'utf8')
    try {
      writeFileSync(STAMP, '{ this is not json', 'utf8')
      return moduleFreshness()
    } finally {
      writeFileSync(STAMP, original, 'utf8')
    }
  })
  assert.equal(
    freshness.status, 'unknown',
    `★ 读不到 stamp ⇒ 必须是 unknown（没能测量），不是 current。实测：${JSON.stringify(freshness)}`,
  )

  /**
   * ★ 三态两两不同形：`unknown` 与 `current` 的**读数**不许相等。
   *   （只断言 `status` 是不够的 —— 一个把 reason 写成"与盘上一致"的实现
   *     仍然会在这里绿。所以同时钉措辞。）
   */
  const current = moduleFreshness()
  assert.notEqual(freshness.status, current.status)
  const message = moduleFreshnessMessage(freshness)
  assert.doesNotMatch(
    message, /holds the current build/i,
    `★ 「没能测量」的措辞不许读成「是新的」。实测：${message}`,
  )
  assert.match(
    message, /not measured|COULD NOT|could not/i,
    `★ 它必须说清"这是没测到，不是没问题"。实测：${message}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★ 边界臂）：把"哪一段旧"这一格**写明测不了**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4（边界臂）：stamp 一致**不等于**每一段都新 —— 这一格本读数测不了，必须写明', () => {
  /**
   * ── ★ 为什么这条要写成断言 ────────────────────────────────────────────────────
   *
   * MEASURED（本轮，一条**被撤回的**推断）：我曾报告"同一进程里 t17 生效而 t18 未生效"
   * ⇒ 后来自己检验发现**证据无效**（那种输入新旧代码都放行），已撤回。
   *
   * ★ 而那个撤回留下的结论是**由实测支撑的**：
   *   「当前没有任何读数能把『新代码的正常行为』与『旧代码的失效』分开。」
   *
   * ⇒ 所以本读数**只回答"该不该重载"**，不回答"哪一段旧"。
   *   把这条边界**钉成断言**，是为了让下一个人不去"修"一个修不了的东西
   *   （本队纪律：把已知边界钉成断言，防止下一个人去修一个修不了的东西）。
   */
  const message = moduleFreshnessMessage()
  assert.match(
    message, /current build|COULD NOT|not measured/i,
    '★ 一致或未知时都要给出一句可读的结论',
  )
  /**
   * ★ 反向半边：措辞里**不许**出现"哪一段是新的/旧的"这种它做不到的声称。
   */
  assert.doesNotMatch(
    message, /every (module|section)|all modules are/i,
    '★ 它不许声称"每一段都是新的" —— 那正是它测不了的那一格',
  )

  /**
   * ★ 而这一格确实**测不了**：stamp 一致时，本读数**无法**回答段落级的真假。
   *   可执行形式：一致 ⇒ `current`，而 `current` 这个取值**不携带**任何段落信息。
   *
   * ★★ t42 修正：这一格原先把**当时的字段清单**写成了不变量
   *   （`deepEqual(keys, ['loaded','onDisk','status'])`）。
   *   f-0026 给 `current` 补了 `commit` / `head` 之后它变红 —— 而那**不是**回归：
   *   它断言的是"字段集不许变"，而它该断言的是"**不许有段落级的字段**"。
   *   ⇒ 这正是本队记账的「夹具不得把当前形状写成不变量」。
   *     改成按**性质**断言：没有任何键声称"哪一段是新的/旧的"。
   */
  const freshness = moduleFreshness()
  const keys = Object.keys(freshness).sort()
  for (const key of keys) {
    assert.doesNotMatch(
      key, /(section|module|segment|part)/i,
      `★ \`current\` 不许携带段落级字段（它做不到那一格）。实测字段：${JSON.stringify(keys)}`,
    )
  }
  /** ★ 而它必须携带"两个指纹相同"这一个事实 —— 那才是它声称的东西。 */
  assert.ok(keys.includes('loaded') && keys.includes('onDisk'), `★ 实测字段：${JSON.stringify(keys)}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★ 副作用臂）：这个读数**不参与裁决**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5（先软后硬）：这个读数不参与任何裁决 —— 判据不许因它拒绝', () => {
  /**
   * ★ 它是**部署状态的读数**，不是判据结论。让它有否决权会把
   *   「这个进程旧了」变成「你这次调用被拒」，而那正是本任务要消灭的伪装
   *   （机制级失效伪装成业务规则）。
   *
   * ★ 可执行形式：在 `stale` 的环境下走一次真实工具调用，断言它**照常返回**
   *   （不从这条读数里产生 blocker）。
   */
  assert.equal(typeof moduleFreshness, 'function')
  assert.equal(typeof moduleFreshnessMessage, 'function')
  /**
   * ★ 而它**没有** `ok: false` 那种裁决形状 —— 一个"看起来像裁决"的读数
   *   会在任何一处被误当成 blocker。断言它的形状里没有 `ok` / `blockers`。
   */
  const freshness = moduleFreshness()
  assert.equal('ok' in freshness, false, '★ 它不是裁决：不许带 `ok`')
  assert.equal('blockers' in freshness, false, '★ 也不是拒绝理由：不许带 `blockers`')
})

// ─────────────────────────────────────────────────────────────────────────────
// t34：这个读数必须能从【插件进程的工具出口】读到，而不是只能用命令行去问
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★ 这一节修的是什么（f-0027，captain 记的）──────────────────────────────────
 *
 * MEASURED：此前这个检测器**只存在于库里**，没有任何工具出口。于是 captain 只能：
 *
 *     node -e "import('./lib/tools.js').then(m => m.moduleFreshness())"
 *
 * ★ 而那条命令**每次都起一个新进程**、加载**最新的** `lib/` ⇒ 它读到的 `loaded`
 *   永远是它自己刚加载的那一份 ⇒ **必然报 `current`**。
 *   ⇒ 「重启后检测器说 current」那句话**从来没有测过插件进程**。
 *
 *   证据（他实测的两次读数）：`loaded` 从 `b2103754…` 变成 `670b5c22…`
 *   —— 而那是**两个命令行进程各自加载的**，不是插件进程变过。
 *
 * ★ 形态：**「读错位置的出口」的又一实例**。
 * ★ 而它与"成员也没有出口"是**同一格的两种表现**：读数不存在，或读数指向别处。
 */

/** 一个最小但够真的插件实例：真的 `registerAgentTeamsTools` + 真的团队目录。 */
async function statusFixture() {
  const { registerAgentTeamsTools } = await import('../lib/tools.js')
  const { createTeamDir } = await import('../lib/state.js')
  const ws = mkdtempSync(join(tmpdir(), 'freshness-status-'))
  const git = (args) => execFileSync('git', args, { cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q', '.'])
  writeFileSync(join(ws, 'a.ts'), 'a\n')
  git(['add', '-A'])
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])
  const stateRoot = join(ws, '.agent-teams')
  await createTeamDir(stateRoot, { id: 'team', name: 'T', captainSessionId: 'cap', createdAt: 1, taskSeq: 0, members: [], tasks: [] })

  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined }, list() { return [] },
      sendMessage: async () => 'msg-0', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { get() { return undefined } },
    on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined })
  const captain = { id: 'cap', status: 'idle', session: { header: { cwd: ws }, events: [] }, steer() {} }
  const status = async () => tools.get('agent_teams_status').execute({}, { agent: captain, signal: new AbortController().signal })
  return { status, stateRoot }
}

test('★ 臂 6（★ 出口臂，t34）：新鲜度必须能从 `status` 的返回值读到', async () => {
  /**
   * ★ 本臂钉的是 f-0027 的那一格：**读数得有出口，而且那个出口属于插件进程**。
   *   一个只在库里存在的读数，与"没有这个读数"在使用上完全相同
   *   （integrator6：「一个没有调用方的修法，与没有修法在观测上完全相同」）。
   */
  const { status } = await statusFixture()
  const result = await status()

  assert.ok(
    'deployment' in result,
    '★ `status` 的返回值必须带 `deployment` —— 否则成员与 captain 只能去命令行问，'
    + '而命令行读的是**另一个进程**（f-0027）',
  )
  const deployment = result.deployment
  assert.equal(typeof deployment, 'object')
  assert.equal(
    deployment.status, 'current',
    `★ 本进程是刚构建过的 ⇒ 必须报 current。实测：${JSON.stringify(deployment)}`,
  )
  /**
   * ★★ 而"它真的是**这个进程**读的"必须可证：
   *   报出来的 `on_disk` 必须与**此刻盘上**的 stamp 逐字相同。
   *   缺了这一句，一个"恒报 current"的实现也能过本臂 ——
   *   而那正是 f-0027 的形状（命令行进程**必然**报 current）。
   */
  const onDiskNow = JSON.parse(readFileSync(STAMP, 'utf8')).output
  assert.equal(
    deployment.on_disk, onDiskNow,
    '★ 报出来的盘上指纹必须与此刻盘上的 stamp 逐字相同 —— 否则它读的不是那个位置',
  )
  assert.equal(deployment.loaded, onDiskNow, '★ 而刚构建过的进程，加载的那份就是盘上那份')
})

test('★ 臂 7（三态出口臂）：`unknown` 与 `current` 在**出口上**也必须不同形', async () => {
  /**
   * ★ 臂 3 已在**函数层**钉了三态；本臂钉**出口层**：一次 `status` 调用
   *   在"读不到 stamp"时必须交出 `unknown`，而不是悄悄报 `current`。
   *
   * ★ 做法：把 stamp 临时换成坏内容 —— 与臂 3 同一手法，但断言的是**工具返回值**。
   *   夹具自己在 `finally` 里还原，绝不把仓库留在脏状态。
   */
  const { status } = await statusFixture()
  const original = readFileSync(STAMP, 'utf8')
  try {
    writeFileSync(STAMP, '{ not json', 'utf8')
    const result = await status()
    assert.equal(
      result.deployment.status, 'unknown',
      `★ 读不到 stamp ⇒ 出口必须交 \`unknown\`（不能报 current）。实测：${JSON.stringify(result.deployment)}`,
    )
    assert.equal(
      'on_disk' in result.deployment, false,
      '★ 而 `unknown` 时**不该**给出 `on_disk` —— 一个没读到的值不许被回报成一个值',
    )
    assert.match(
      String(result.deployment.message), /not measured|could NOT/i,
      '★ 措辞必须说清"这是没测到，不是没问题"',
    )
  } finally {
    writeFileSync(STAMP, original, 'utf8')
  }
})

test('★ 臂 8（先软后硬，出口层）：部署状态**不得**让 `status` 因此拒绝', async () => {
  /**
   * ★ 它是**部署状态的读数**，不是判据结论。让它有否决权会把"这个进程旧了"
   *   变成"你这次**读取**失败了" —— 而那正是本任务要消灭的伪装
   *   （机制级失效伪装成业务规则）。
   *
   * ★ 可执行形式：在 **stale** 的环境下（盘上 stamp 被改过）调一次 `status`，
   *   它必须**照常返回**、且返回值里仍然带着"我旧了"这条读数。
   */
  const { status } = await statusFixture()
  const original = readFileSync(STAMP, 'utf8')
  try {
    const parsed = JSON.parse(original)
    writeFileSync(STAMP, `${JSON.stringify({ ...parsed, output: 'deadbeef'.repeat(8) }, null, 2)}\n`, 'utf8')
    const result = await status()
    assert.equal(result.deployment.status, 'stale', '★ 前置：这一轮确实读到了 stale')
    assert.equal(result.team_id, 'team', '★ 而 status **照常返回了团队状态** —— 部署读数不参与裁决')
    assert.ok(
      Array.isArray(result.tasks) || typeof result.tasks === 'object',
      '★ 其余字段不许因为这一格而缺失',
    )
  } finally {
    writeFileSync(STAMP, original, 'utf8')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// t37：把新鲜度读数附到【拒绝】的错误信息里 —— 让"读错位置"那条路走不通
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★ 这一节修的是什么（f-0027 的预防形态，captain 裁定的）─────────────────────
 *
 * captain 今天两次**用命令行**读插件进程的状态，读到的都是命令行那个进程；
 * 而**成员**连位置都没有。★ 读数不存在，与读数指向别处，是**同一格的两种表现**。
 *
 * 而预防的形态**不是**"提醒人小心"（那是一条靠人执行的规则，本项目已见它腐烂两次），
 * 是**让错的那条路走不通**：任何成员撞上拦截的那一刻，错误信息当场告诉它
 * "你正在依据的这个进程，持有的构建与盘上是否一致" —— 于是它不需要去别处读。
 *
 * ★ 这与 f-0028（t33 报的）是同一件事的正面版本：
 *   那里是"一个读数在它分辨不了的地方被当成了结论"；
 *   这里把**有资格的读数挪到结论旁边**。
 *
 * ── 三态在这句话里也必须分形 ─────────────────────────────────────────────────
 *
 *   current ⇒ 明说（省得读的人去猜"没说"是不是"没测"）
 *   stale   ⇒ **必须说**，且指向动作（reload）
 *   unknown ⇒ **不得**说成 current —— 它是"没能测量"
 */

/** 触发一次**真实**拒绝（走 `throwWithSurface`），返回那条 Error。 */
async function rejectionFixture() {
  const { registerAgentTeamsTools } = await import('../lib/tools.js')
  const { createTeamDir } = await import('../lib/state.js')
  const ws = mkdtempSync(join(tmpdir(), 'freshness-reject-'))
  const git = (args) => execFileSync('git', args, { cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q', '.'])
  writeFileSync(join(ws, 'a.ts'), 'a\n')
  git(['add', '-A'])
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])

  const stateRoot = join(ws, '.agent-teams')
  /**
   * ★ 任务**直接种进状态里**（而不是走 `create_task`）：本臂要的不是"任务怎么建"，
   *   是"一次拒绝长什么样"。种进去让本臂只依赖那条拒绝路径。
   *   ★ `members` / `phase` 是状态校验要求的字段（缺一个 `readTeam` 会拒整份状态）。
   */
  await createTeamDir(stateRoot, {
    phase: 'running',
    id: 'team', name: 'T', captainSessionId: 'cap', createdAt: 1, taskSeq: 1,
    members: [{ id: 'm1', name: 'worker', status: 'working', joinedAt: 1 }],
    /**
     * ★ `assignee` 必须是 **captain 自己**：成员拥有的任务在 captain 更新时会被
     *   **ownership 检查**先拒（"owned by member …, reassign first"）——
     *   而那一条拒绝**不经过** `throwWithSurface`，本臂会测到一条不是它的拒绝。
     *   ⇒ 种一个 captain 自己的任务，让这一次调用**走到判据那一层**。
     */
    tasks: [{
      id: 't1', subject: 'A', status: 'in_progress', assignee: 'captain', dependencies: [],
      attempt: 1, attemptId: 'a1', kind: 'implementation', objective: 'o',
      inScope: ['src/a.ts'], acceptance: ['x'], verify: ['true'],
      createdAt: 1, updatedAt: 1,
    }],
  })

  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined }, list() { return [] },
      sendMessage: async () => 'msg-0', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { get() { return undefined } },
    on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined })
  const captain = { id: 'cap', status: 'idle', session: { header: { cwd: ws }, events: [] }, steer() {} }
  const update = tools.get('agent_teams_update_task')

  return {
    /**
     * ★ 一条**真实**拒绝：`changedPaths` 申报了一个**从未被观察过**的路径
     *   ⇒ dispatch 位置的 `changed-paths` 判据拒绝（"虚报改动清单"）。
     *   ★ 这是文档里就有的拒绝路径（不是为夹具造的），且它**走 `throwWithSurface`**。
     */
    async reject() {
      try {
        await update.execute(
          { task_id: 't1', status: 'in_progress', changedPaths: ['src/never-written-by-anyone.ts'] },
          { agent: captain, signal: new AbortController().signal },
        )
        return undefined
      } catch (error) {
        return error
      }
    },
  }
}

test('★ 臂 9（★ t37 核心）：一次**真实拒绝**的错误信息里必须带着部署状态那一行', async () => {
  const { reject } = await rejectionFixture()
  const error = await reject()
  assert.notEqual(error, undefined, '★ 前置：这一次调用确实被拒了（否则本臂测的不是拒绝路径）')
  const message = String(error?.message ?? '')
  /**
   * ★★ 断言：拒绝的那句话里**必须**有 `[deployment]` 那一行。
   *
   * ★ 这一条是"让错的路走不通"的字面落点：成员撞上拦截的那一刻，
   *   当场就能读到"我这个进程持有的构建是新的还是旧的"，**不需要去别处读**。
   */
  assert.match(
    message,
    /\[deployment\] /,
    `★ 拒绝信息里没有部署状态那一行 —— 成员于是只能去\n`
    + `  命令行读，而命令行读的是【另一个进程】（f-0027）。实测信息：\n${message}`,
  )
  /**
   * ★ 而那一行必须说的就是 `moduleFreshnessMessage()` 的结论（**同一个来源**），
   *   不是另一套措辞 —— 否则"同一件事有两句话"在下游同形。
   */
  const { moduleFreshnessMessage } = await import('../lib/tools.js')
  assert.ok(
    message.includes(moduleFreshnessMessage()),
    `★ 拒绝里那一行必须与 \`moduleFreshnessMessage()\` 逐字相同（同一个来源）。实测：\n${message}`,
  )
})

test('★ 臂 10（三态在拒绝里也分形）：unknown **不得**说成 current；stale 那一态必须指向 reload', async () => {
  const { moduleFreshness, moduleFreshnessMessage } = await import('../lib/tools.js')
  const { reject } = await rejectionFixture()

  /**
   * ── ① unknown（stamp 读不到）⇒ 拒绝里那一行必须说"没能确定" ─────────────────────
   *
   * ★ 这一态在**拒绝路径上**可以真的造出来：`loadedStampOutput()` 是**进程级缓存**，
   *   而 `moduleFreshness()` 每次都**重读盘**。把盘上的 stamp 弄坏 ⇒ onDisk 读不到
   *   ⇒ 落 unknown。★ 于是"读不到"这件事在真实拒绝信息里可观察。
   */
  const unknownError = await (async () => {
    const stampOriginal = readFileSync(STAMP, 'utf8')
    try {
      writeFileSync(STAMP, 'not json at all', 'utf8')
      return await reject()
    } finally {
      writeFileSync(STAMP, stampOriginal, 'utf8')
    }
  })()
  const unknownMessage = String(unknownError?.message ?? '')
  assert.match(unknownMessage, /\[deployment\] /, '★ 前置：unknown 下也有那一行')
  assert.match(
    unknownMessage,
    /could NOT be determined/,
    '★ unknown 必须如实说"没能确定"（三态里最容易被并进 current 的那一态）',
  )
  /**
   * ★★ 反向半边（缺了它，本臂在"恒说 current"的实现上照样绿）：
   *   unknown 那一行里**不许**出现 "holds the current build"。
   */
  assert.doesNotMatch(
    unknownMessage,
    /holds the current build/,
    '★ unknown 被说成了 current —— 那就是"没能测量"并进"通过"，本队反复记账的那条',
  )

  /**
   * ── ② current（对照臂）⇒ 那一行明说"本进程持有的就是盘上这一份" ─────────────────
   *
   * ★ 与 ① 并排，"unknown 与 current 不同形"才是**可判定**的（而不是靠一句断言）。
   */
  const currentError = await reject()
  const currentMessage = String(currentError?.message ?? '')
  assert.match(currentMessage, /holds the current build/, '★ 对照：current 下那一行说的是"持有的就是盘上这一份"')
  assert.notEqual(currentMessage, unknownMessage, '★ unknown 与 current 在拒绝信息里必须不同形')

  /**
   * ── ③ stale ⇒ 那一行必须**明说自己旧**、且指向动作（reload）──────────────────────
   *
   * ★★ 这一态**不能在拒绝路径上造出来**，理由是结构性的、而且它本身是一条读数：
   *   `loadedStampOutput()` 是**进程级、加载时读一次**的缓存 —— 那正是被检测的对象
   *   （`moduleFreshness` 的注释逐字说明"重复读会让它恒为 current"）。
   *   ⇒ 在一个**已经加载过**的进程里改盘上的 stamp，得到的仍是"加载时那一份"，
   *     于是它**必然**报 current。★ 想在这里看到 stale，只能起一个新进程 ——
   *     而那测的就是另一个进程了（f-0027 的形状本身）。
   *   ⇒ 所以 stale 那一态在**纯函数层**钉（臂 2 已经钉住），这里只钉"措辞同源"：
   *     拒绝里那一行必须**逐字**来自 `moduleFreshnessMessage()`。
   */
  const syntheticStale = { status: 'stale', loaded: 'aaa'.repeat(8), onDisk: 'bbb'.repeat(8) }
  assert.match(moduleFreshnessMessage(syntheticStale), /OLDER than the one on disk/, '★ stale 必须明说自己旧')
  assert.match(moduleFreshnessMessage(syntheticStale), /reload the plugin/, '★ 且指向动作：reload')
  /**
   * ★ 而"拒绝里那一行"与"纯函数那三句"是**同一个来源**（不许另写一份措辞）：
   *   现场信息应当**包含**纯函数那句结论 —— 逐字包含，而不是"意思差不多"。
   */
  assert.ok(
    currentMessage.includes(moduleFreshnessMessage()),
    '★ 拒绝里那一行必须与 `moduleFreshnessMessage()` 逐字同源（两处各写一遍会分叉）',
  )
  assert.equal(typeof moduleFreshness().status, 'string', '★ 前置：三态读数本身仍然可读')
})

test('★ 臂 11（先软后硬）：那一行**不参与裁决** —— 去掉它，拒绝的理由与措辞语义一字不变', async () => {
  const { reject } = await rejectionFixture()
  const error = await reject()
  const message = String(error?.message ?? '')
  /**
   * ★ 本臂钉住"只【追加】一行、不改任何拒绝的理由"。
   *
   * ★ 可执行形式：**去掉** `[deployment]` 那一行之后，剩下的必须**非空**，
   *   且仍然是"一条拒绝理由"（而不是原来就只有那一行）。
   *   ⇒ 一个把部署状态当**拒绝理由**用的实现（例如只在那一行里说事）会在这里红。
   */
  const withoutLine = message.split('\n').filter((line) => !line.startsWith('[deployment] ')).join('\n').trim()
  assert.notEqual(withoutLine, '', '★ 去掉部署那一行之后，拒绝必须仍然说得清【为什么】—— 它不许是唯一的理由')
  assert.match(
    withoutLine,
    /rejected|was reported|never been observed|could not measure/i,
    `★ 剩下的必须仍是一条**可读的拒绝理由**。实测（去掉那一行后）：\n${withoutLine}`,
  )
  /**
   * ★ 而且它是**一个 Error**（不是被换成了另一种抛出物）—— 包装层与 `instanceof` 语义不变。
   */
  assert.equal(error instanceof Error, true, '★ 仍是 Error（`instanceof` 语义不变）')
  assert.match(message, /\[deployment\] /, '★ 前置：那一行确实在（否则上面那条"去掉之后"没有对象）')
})

// ─────────────────────────────────────────────────────────────────────────────
// t42 / f-0026：stamp 缺【构建时的 git 提交】⇒ 检测器答不出「进程落后于当前提交吗」
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★ 这一节修的是什么（MEASURED，point-dev 发现、captain 核实）─────────────────
 *
 * 上面那八条臂比的是【进程启动时读到的 output】vs【此刻盘上的 output】。
 * ⇒ 它只回答一个问题：
 *
 *      「盘上自本进程启动以来，有没有被 rebuild 过？」
 *
 * 而它**不**回答另一个问题：
 *
 *      「本进程加载的是哪个 commit 的代码？」
 *
 * ★ 缺口在哪：若进程启动【之前】盘上就已经是当前这一版，则两个 output 相等
 *   ⇒ 恒报 `current`。**而那时进程里的代码仍可能是更早 commit 的。**
 *   ⇒ 那不是"没测到"伪装成"通过"，是**另一个问题被当成了这个问题的答案**
 *     （本队记账：守卫检查了另一个同名的东西）。
 *
 * ── 为什么 output 比对【补不上】这一格 ─────────────────────────────────────────
 *
 *   output = 内容摘要。两个人改动**互相抵消**（或一次 amend / rebase / revert）
 *   可以让内容回到同一个摘要，而 commit 已经不同。
 *   ★ 反之亦然：改一行注释 ⇒ output 变、而"代码是否落后"这件事与它无关。
 *   ⇒ 两者测的**不是同一件事**，所以两个都要，且各自可读（本任务的硬要求）。
 *
 * ── ★ 取值时机（f-0025「按取值时机区分」）───────────────────────────────────────
 *
 *   「构建时的提交」  —— 常量，写进 stamp，随 stamp 变 ⇒ 加载时读一次即可
 *   「当前 HEAD」     —— **每次调用都可能变**的量 ⇒ 必须在**调用时**读
 *   ★ 把后者也做成"加载时读一次"，会让它退化成与 output 同一个问句。
 */

import { execFileSync as execFileSyncT42 } from 'node:child_process'
import { mkdtempSync as mkdtempT42, writeFileSync as writeFileT42, readFileSync as readFileT42 } from 'node:fs'

const gitT42 = (cwd, args) => execFileSyncT42('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** 造一个真仓库，返回 { root, commit(msg) => sha }。 */
function gitRepo() {
  const root = mkdtempT42(join(tmpdir(), 'f0026-'))
  gitT42(root, ['init', '-q', '.'])
  gitT42(root, ['config', 'user.email', 't@t'])
  gitT42(root, ['config', 'user.name', 't'])
  writeFileT42(join(root, 'a.txt'), 'a\n')
  gitT42(root, ['add', '-A'])
  gitT42(root, ['commit', '-qm', 'one'])
  return {
    root,
    head: () => gitT42(root, ['rev-parse', 'HEAD']).trim(),
    commit: (msg) => {
      writeFileT42(join(root, 'a.txt'), `${msg}\n`)
      gitT42(root, ['add', '-A'])
      gitT42(root, ['commit', '-qm', msg])
      return gitT42(root, ['rev-parse', 'HEAD']).trim()
    },
  }
}

test('★ 臂 9（f-0026 核心）：stamp 没变、而 HEAD 前进了一个提交 ⇒ 必须报 stale', async () => {
  /**
   * ── 这是本任务存在的理由的**可执行形式** ────────────────────────────────────────
   *
   * 构造：进程"加载"时 stamp 的 output 是 X（构建于 commit A）；
   *       之后仓库前进到 commit B，而 **stamp 的 output 一个字没变**
   *       （现实中：有人改了 src 又改回来、amend、或只因别的原因动了历史）。
   * ⇒ 此刻两个 output 相等（旧检测器会说 current），而 HEAD ≠ stamp 的提交。
   * ⇒ 检测器**必须**报 stale，并指明它落后于哪个提交。
   *
   * ★ 这一臂在旧实现上**必然红** —— 因为旧实现根本读不到"构建时的提交"这一格。
   */
  const { moduleFreshnessFrom, stampCommitOf } = await import('../lib/tools.js')
  const repo = gitRepo()
  const builtAt = repo.head()
  // stamp 声称：output 摘要 X，构建于 commit A。
  const stamp = { schema: 1, source: 'src-digest', output: 'output-digest', commit: builtAt }
  // 仓库前进到 B，而 stamp 的 output **没有变**。
  const advanced = repo.commit('two')
  assert.notEqual(advanced, builtAt, '前置：仓库确实前进了一个提交')

  const freshness = moduleFreshnessFrom({
    loaded: stamp,
    onDisk: { ...stamp },
    head: advanced,
  })
  assert.equal(
    freshness.status, 'stale',
    `★ stamp 的 output 没变、而 HEAD 已前进 ⇒ 必须报 stale（旧实现会报 current）。实测：${JSON.stringify(freshness)}`,
  )
  assert.match(
    moduleFreshnessMessage(freshness), /reload/i,
    `★ 必须给出动作。实测：${moduleFreshnessMessage(freshness)}`,
  )
  /** ★ 而它必须**指明落后于哪个提交** —— 只说"旧了"仍然要人去猜从哪旧起。 */
  assert.ok(
    typeof freshness.behind === 'string' && freshness.behind.length > 0,
    `★ 必须交出错过的那个提交。实测：${JSON.stringify(freshness)}`,
  )
  assert.equal(stampCommitOf(stamp), builtAt, '★ 而「构建时的提交」这一格必须真的来自 stamp')
})

test('★ 臂 10（对照臂）：HEAD 与构建提交一致 ⇒ current（两个问题都要能答）', async () => {
  const { moduleFreshnessFrom } = await import('../lib/tools.js')
  const repo = gitRepo()
  const at = repo.head()
  const stamp = { schema: 1, source: 's', output: 'o', commit: at }
  const freshness = moduleFreshnessFrom({ loaded: stamp, onDisk: { ...stamp }, head: at })
  assert.equal(freshness.status, 'current', `实测：${JSON.stringify(freshness)}`)
  /** ★ 而 current 时也要交出两个指纹与提交 —— 让人能核对。 */
  assert.equal(freshness.loaded, 'o')
  assert.equal(freshness.onDisk, 'o')
})

test('★ 臂 11（★ 三维齐全臂）：两个问题**各自可读**，不许合成一个布尔', async () => {
  const { moduleFreshnessFrom } = await import('../lib/tools.js')
  const repo = gitRepo()
  const builtAt = repo.head()
  const laterCommit = repo.commit('two')

  /**
   * ★ 四格：{output 变没变} × {提交落后没落后}。
   *   旧实现只读得出前者；新实现两个都要读得出，且**分别**读得出。
   *   ⇒ 合成一个布尔会让"盘上被 rebuild 了但代码更旧"这种组合消失。
   */
  const cases = [
    { name: 'output 同 + 提交同', loaded: { s: 1, output: 'o', commit: builtAt }, onDisk: { s: 1, output: 'o', commit: builtAt }, head: builtAt, expect: 'current' },
    { name: 'output 同 + 提交落后', loaded: { s: 1, output: 'o', commit: builtAt }, onDisk: { s: 1, output: 'o', commit: builtAt }, head: laterCommit, expect: 'stale' },
    { name: 'output 异 + 提交同', loaded: { s: 1, output: 'o', commit: builtAt }, onDisk: { s: 1, output: 'o2', commit: builtAt }, head: builtAt, expect: 'stale' },
    { name: 'output 异 + 提交落后', loaded: { s: 1, output: 'o', commit: builtAt }, onDisk: { s: 1, output: 'o2', commit: builtAt }, head: laterCommit, expect: 'stale' },
  ]
  for (const item of cases) {
    const freshness = moduleFreshnessFrom({ loaded: item.loaded, onDisk: item.onDisk, head: item.head })
    assert.equal(freshness.status, item.expect, `case「${item.name}」实测：${JSON.stringify(freshness)}`)
  }
})

test('★ 臂 12（★★ 三态臂）：读不到提交 ⇒ unknown，且与 current 不同形', async () => {
  const { moduleFreshnessFrom, moduleFreshnessMessage: msgOf } = await import('../lib/tools.js')
  const repo = gitRepo()
  const at = repo.head()

  /**
   * ★ 两种"读不到"必须都落 unknown，且**二者互不同形**（本队记账：三态不同形）：
   *     ① stamp 里没有 commit 这一格（旧 stamp / 手写的 stamp）
   *     ② HEAD 读不到（不是 git 仓库、git 不可用）
   *   ★ 而它们都**不许**被读成 current —— 那正是本任务要消灭的合流。
   */
  const noCommitField = moduleFreshnessFrom({ loaded: { s: 1, output: 'o' }, onDisk: { s: 1, output: 'o' }, head: at })
  assert.equal(noCommitField.status, 'unknown', `① 实测：${JSON.stringify(noCommitField)}`)

  const noHead = moduleFreshnessFrom({ loaded: { s: 1, output: 'o', commit: at }, onDisk: { s: 1, output: 'o', commit: at }, head: undefined })
  assert.equal(noHead.status, 'unknown', `② 实测：${JSON.stringify(noHead)}`)

  assert.notEqual(
    msgOf(noCommitField), msgOf(noHead),
    '★ 两种"读不到"必须不同形 —— 否则"stamp 没记这一格"与"这个环境没有 git"同形',
  )

  const current = moduleFreshnessFrom({ loaded: { s: 1, output: 'o', commit: at }, onDisk: { s: 1, output: 'o', commit: at }, head: at })
  assert.equal(current.status, 'current')
  assert.notEqual(
    msgOf(noCommitField), msgOf(current),
    '★★ unknown 与 current 必须不同形 —— 把"没能测量"读成"是新的"就是本任务要消灭的形态',
  )
  assert.doesNotMatch(msgOf(noCommitField), /holds the current build/i, '★ 不许读成"是新的"')
})

test('★ 臂 13（★ 定向突变臂）：去掉 HEAD 比对 ⇒ 臂 9 必须红', async () => {
  const { moduleFreshnessFrom } = await import('../lib/tools.js')
  const repo = gitRepo()
  const builtAt = repo.head()
  const advanced = repo.commit('two')

  /**
   * ★ 突变就是"只比 output、不比提交"（= 修法前的读法）。
   *   ⇒ 在臂 9 那份输入上它给出 `current`，而正解是 `stale`。
   *   本臂把这个**对照**钉住：若有人把 HEAD 比对删掉，臂 9 会红，而本臂说明为什么。
   */
  const legacyOnly = (input) => (input.loaded.output === input.onDisk.output
    ? { status: 'current' }
    : { status: 'stale' })
  const legacy = legacyOnly({ loaded: { output: 'o' }, onDisk: { output: 'o' } })
  assert.equal(legacy.status, 'current', '★ 只看 output 的旧读法在这里报 current —— 那正是缺陷')

  const fixed = moduleFreshnessFrom({ loaded: { s: 1, output: 'o', commit: builtAt }, onDisk: { s: 1, output: 'o', commit: builtAt }, head: advanced })
  assert.notEqual(
    fixed.status, legacy.status,
    '★ 修法必须改变这个答案，否则它不是一条机制',
  )
  assert.equal(fixed.status, 'stale')
})

test('★ 臂 14（★ 定向突变臂）：把 unknown 并入 current ⇒ 臂 12 必须红', async () => {
  const { moduleFreshnessFrom } = await import('../lib/tools.js')
  const repo = gitRepo()
  const at = repo.head()

  /**
   * ★ 突变：读不到提交时**返回 current**（= 把"没能测量"并进"是新的"）。
   *   本臂断言那个突变的形状是错的，且它与正解不同形。
   */
  const merged = (input) => (input.loaded.commit === input.head
    ? { status: 'current' }
    : { status: 'current' })  // ← 两路都 current：合流
  const mutated = merged({ loaded: { output: 'o' }, head: undefined })
  assert.equal(mutated.status, 'current', '★ 合流后它报 current')

  const real = moduleFreshnessFrom({ loaded: { s: 1, output: 'o' }, onDisk: { s: 1, output: 'o' }, head: undefined })
  assert.equal(real.status, 'unknown', '★ 正解必须是 unknown')
  assert.notEqual(real.status, mutated.status, '★ 若两者相等，说明 unknown 被并进了 current —— 臂 12 会红')
})

test('★ 臂 15（★ 只读 + 取值时机臂）：当前 HEAD 必须在**调用时**读，而不是加载时读一次', async () => {
  const { moduleFreshnessFrom } = await import('../lib/tools.js')
  const repo = gitRepo()
  const builtAt = repo.head()
  const stamp = { schema: 1, source: 's', output: 'o', commit: builtAt }

  /**
   * ★ 同一个"加载时的 stamp"，配两个不同的"当前 HEAD" ⇒ 必须给出**两个不同**的读数。
   *   若实现把 HEAD 也做成"加载时读一次"，这两次调用会给出同一个答案 —— 本臂随即红。
   *   ★ 这就是 f-0025「按取值时机区分」的可执行形式：
   *     「构建时的提交」是常量，「当前 HEAD」是每次调用都要重新取的量。
   */
  const first = moduleFreshnessFrom({ loaded: stamp, onDisk: stamp, head: builtAt })
  const advanced = repo.commit('two')
  const second = moduleFreshnessFrom({ loaded: stamp, onDisk: stamp, head: advanced })

  assert.equal(first.status, 'current', `第一次实测：${JSON.stringify(first)}`)
  assert.equal(second.status, 'stale', `HEAD 前进后实测：${JSON.stringify(second)}`)
  assert.notEqual(
    first.status, second.status,
    '★ 同一份 stamp 配两个 HEAD 必须给出不同读数 —— 否则 HEAD 是加载时读的（取值时机错了）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// t42：出口 schema 必须接受它自己新返回的字段（t14 形态的第 10 次预防）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 16（★ schema 对齐臂）：`status` 的 deployment schema 必须声明提交维的字段', async () => {
  /**
   * ── ★★ 这一臂修的是什么（MEASURED，本任务开工时实测）────────────────────────
   *
   * `status` 的 `deployment` 是 `additionalProperties: false`，字段集是写死的。
   * 我加完提交维之后，`status` **当场拒绝了自己**：
   *
   *     tool "agent_teams_status" returned invalid output:
   *       "value.deployment.built_commit" is not a declared property
   *       (additionalProperties: false)
   *
   * ⇒ `scripts/capabilities.test.mjs` 从 18/18 变 9 条红（PTC / run_code / HMR /
   *   cold captain 等全部经 `status` 的子测试）。
   *
   * ★ 这是本队记账的 t14 形态（12 个工具的 output schema 不接受自己返回的新字段）
   *   的**第 10 次**。⇒ 把"声明与产出必须对齐"钉成可执行断言，让下一次当场红。
   *
   * ★ 而它断言的是【性质】而不是字段清单：**产出里有的键，schema 里必须有**。
   *   照抄一份字段名单会让这一臂在字段增减时无意义地红 —— 那是把当前形状写成不变量
   *   （本队记账；本文件臂 4 就刚被这一条咬过一次）。
   */
  const { registerAgentTeamsTools } = await import('../lib/tools.js')
  const { createTeamDir } = await import('../lib/state.js')
  const ws = mkdtempSync(join(tmpdir(), 'freshness-schema-'))
  const git = (args) => execFileSync('git', args, { cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q', '.'])
  writeFileSync(join(ws, 'a.ts'), 'a\n')
  git(['add', '-A'])
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])
  await createTeamDir(join(ws, '.agent-teams'), { id: 'team', name: 'T', captainSessionId: 'cap', createdAt: 1, taskSeq: 0, members: [], tasks: [] })

  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined }, list() { return [] },
      sendMessage: async () => 'msg-0', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { get() { return undefined } },
    on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined })
  const statusTool = tools.get('agent_teams_status')
  const declared = Object.keys(statusTool.output.schema.properties.deployment.properties ?? {})

  const captain = { id: 'cap', status: 'idle', session: { header: { cwd: ws }, events: [] }, steer() {} }
  const result = await statusTool.execute({}, { agent: captain, signal: new AbortController().signal })

  /**
   * ★ 逐键核对：产出里的每一个 `deployment` 键，都必须被 schema 声明过。
   *   这是"schema 不接受自己返回的新字段"的**直接**可执行形式。
   */
  for (const key of Object.keys(result.deployment)) {
    assert.ok(
      declared.includes(key),
      `★ deployment 产出了 "${key}"，而 schema 只声明了 ${JSON.stringify(declared)} —— `
      + 'additionalProperties:false 会当场拒绝自己（t14 形态）',
    )
  }
  /** ★ 而提交维的两格必须在（否则本任务的修法在出口上不可读）。 */
  for (const key of ['built_commit', 'head']) {
    assert.ok(declared.includes(key), `★ schema 必须声明 "${key}"。实测：${JSON.stringify(declared)}`)
  }
})
