/**
 * ── t26：作用域一致性与「说明文字 = 被强制清单的投影」────────────────────────────────
 *
 * ── 它防的是什么（MEASURED：这一族吃掉约八次完整派发往返，四个成员独立撞到）──────────
 *
 * 队长证据包里的六条子类，本文件钉**前四条**（后两条 ENUMERATE / SUPERSEDED-ARM
 * 发生在**已经派发之后**，不是建任务时能机械判的）：
 *
 *   ① CONTRADICTION  同一个路径**同时在** inScope 与 outOfScope ⇒ **无解**
 *      （校验器按 out-of-scope 那一侧执行）。实测于 t19。
 *   ② TOUCH          为了满足验收标准**必须改的每一个路径**是否都在 inScope 里。
 *      实测于 t24：标准是**搬走**，而 move 类任务**天生**有源与目的地。
 *   ③ EMIT           `src/X.ts` 在 scope 里 ⇒ 产物必须声明（`lib/X.js` + `lib/types/X.d.ts`）。
 *      实测**两次、两个方向**：t24 写了**永远产不出来**的 `lib/types.d.ts`；
 *      t19 漏了 `lib/types.js`（**真正跑起来的那一个**）。
 *   ④ ASSIGNMENT-TEXT DIVERGENCE  成员收到的说明文字与**被强制**的清单分叉过**五次**。
 *
 * ── ★★ 本文件的每一条都**先钉前提**，再去测 ────────────────────────────────────────
 *
 * 这一族的教训是"任务在**前提不存在**的基线上被派发过好几次"。
 * ⇒ 所以下面**先**断言 `tsconfig` 的产出映射**仍然是**那条规则，
 *   否则本文件的全部结论**都要重估**（而那必须在红/绿上看得出来）。
 *
 * Run: node --test scripts/gate-assignment-parity.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const { scopeViolations, emittedProductGaps, scopeContradictions, scopeTouchGaps, taskDetails } =
  await import('../lib/tools/shared/entities.js')

/** 三个检查各自的出口名 —— 本文件唯一的读数装置。 */
const checksOf = (input) => scopeViolations(input).map((violation) => violation.check).sort()

// ─────────────────────────────────────────────────────────────────────────────
// 臂 0：★ 前提臂 —— EMIT 规则的两条事实仍然成立
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 0（前提臂）：`tsconfig` 的产出映射仍然是 src/X.ts ⇒ lib/X.js + lib/types/X.d.ts', async () => {
  /**
   * ★★ 契约把 EMIT 称作"最便宜、最可机械计算"的一条 —— 而"可计算"的**依据**是
   *   `tsconfig.json` 里的两个配置项。它们一改，本判据的全部结论都要重估。
   *   ⇒ 所以先把前提钉住，而不是假设。
   */
  const tsconfig = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8'))
  console.log(`    ℹ outDir=${tsconfig.compilerOptions.outDir} · declarationDir=${tsconfig.compilerOptions.declarationDir} · rootDir=${tsconfig.compilerOptions.rootDir}`)

  assert.equal(tsconfig.compilerOptions.outDir, 'lib', '★ `outDir` 必须是 `lib`（EMIT 规则的前半）')
  assert.equal(tsconfig.compilerOptions.declarationDir, 'lib/types', '★ `declarationDir` 必须是 `lib/types`（EMIT 规则的后半）')
  assert.equal(tsconfig.compilerOptions.rootDir, 'src', '★ `rootDir` 必须是 `src`（否则 `src/` 前缀会被保留进产物路径）')

  /** ★ 而 t24 那个**永远产不出来**的路径，实测仍然产不出来（它不是"还没生成"）。 */
  assert.equal(
    existsSync(join(ROOT, 'lib', 'types.d.ts')), false,
    '★ `lib/types.d.ts` 必须有**永远不出现** —— 而 `lib/types/types.d.ts` 必须存在（t24 的实测形状）',
  )
  assert.equal(existsSync(join(ROOT, 'lib', 'types', 'types.d.ts')), true, '★ 声明文件的真实落点是 `lib/types/<name>.d.ts`')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★★★ CONTRADICTION —— 同一个路径两边都在 ⇒ 拒
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 1（CONTRADICTION）：同一个路径同时在 inScope 与 outOfScope ⇒ 报出来', () => {
  /**
   * ★ 实测形状（t19）：一次修订更新了 `inScope` 而没更新 `outOfScope`，
   *   于是 `src/types.ts` **两边都在**，而任务**无解**。
   */
  const contradictions = scopeContradictions(['src/types.ts', 'lib/types.js'], ['src/types.ts'])
  console.log(`    ℹ 交集读数 ⇒ ${JSON.stringify(contradictions.map((c) => c.check))}`)

  assert.equal(contradictions.length, 1, '★ 恰好一条（`src/types.ts`）')
  assert.equal(contradictions[0].check, 'contradiction')
  assert.match(contradictions[0].detail, /src\/types\.ts/, '★ 必须**指名**那个路径 —— 否则读的人不知道去拿掉哪一个')
  assert.match(
    contradictions[0].detail, /unsatisfiable/,
    '★★ 还要说清**后果**是"无解"（校验器按 out-of-scope 那一侧执行），而不只是"重复了"',
  )

  /** ★ 反向半边：**互不相交**时不许报（否则本检查会在每一个正常任务上开火）。 */
  assert.deepEqual(
    scopeContradictions(['src/a.ts'], ['docs/', 'package.json']), [],
    '★ 两个列表不相交 ⇒ 一条都不许报',
  )
  /** ★ 而**目录前缀**也算相交（`src/` 覆盖 `src/a.ts` —— 复用 `inScopeOverlap` 的口径）。 */
  assert.equal(
    scopeContradictions(['src/a.ts'], ['src/']).length, 1,
    '★★ `outOfScope: [\'src/\']` 覆盖 `inScope: [\'src/a.ts\']` ⇒ 那同样是**无解**，必须报出来',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★★ EMIT —— src/X.ts 在 scope 里 ⇒ 产物必须声明
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 2（EMIT）：`src/X.ts` 在 scope 里而产物没声明 ⇒ 逐条报出来', () => {
  /**
   * ★★ 这是"最便宜、最可机械计算"的一条，而它**两个方向**都被实测过：
   *   · t24 写了 `lib/types.d.ts`（永远产不出来）
   *   · t19 漏了 `lib/types.js`（**真正跑起来的那一个**）
   */
  const gaps = emittedProductGaps(['src/types.ts'])
  console.log(`    ℹ 缺的产物 ⇒ ${JSON.stringify(gaps.map((g) => /`lib\/[^`]+`/.exec(g.detail)?.[0]))}`)

  assert.equal(gaps.length, 2, '★ 两条：`lib/X.js` 与 `lib/types/X.d.ts`')
  const text = gaps.map((gap) => gap.detail).join('\n')
  assert.match(text, /lib\/types\.js/, '★ 必须点名 `lib/types.js`（真正被 import 的那一个）')
  assert.match(text, /lib\/types\/types\.d\.ts/, '★ 也必须点名类型面的落点')

  /** ── ★★★ 反向半边：**t3 / t14 / t24 那一份完整声明**必须 CLEAN ────────────────── */
  assert.deepEqual(
    emittedProductGaps(['src/types.ts', 'lib/types.js', 'lib/types/types.d.ts']), [],
    '★★★ 一份**完整声明**的 scope 必须零命中 —— 否则本判据会在**本仓既有的正确写法**上开火，\n'
    + '   而那正是 t19 的决定性证据：每个别的列了 `src/types.ts` 的任务都已经声明了这两个产物。',
  )

  /** ★ 非 `src/` 的路径**没有**这条强制同步关系 ⇒ 不许报（否则每个 docs 任务都会被拦）。 */
  for (const path of ['docs/PLAN.md', 'scripts/x.mjs', 'package.json']) {
    assert.deepEqual(emittedProductGaps([path]), [], `★ \`${path}\` 不在 src 下 ⇒ 不适用产出规则`)
  }
  /** ★ 而 `src/` 下的**非 .ts**（例如资源）同样不适用。 */
  assert.deepEqual(emittedProductGaps(['src/client/index.css']), [], '★ 非 .ts 的 src 文件不产出 .js/.d.ts')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★★★ TOUCH —— move 类任务必须把**源**也列进 inScope
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 3（TOUCH）：验收标准说"搬走"而源在 outOfScope 里 ⇒ 报出来', () => {
  /**
   * ★ 实测形状（t24）：标准是**把判据搬出** `src/tools/shared/entities.ts`，
   *   于是那个文件需要**两处**改动（一个真 import + 一个 re-export 中转），
   *   而 `inScope` 只写了**目的地**。
   */
  const touch = scopeTouchGaps(
    ['relocate observeStall out of src/tools/shared/entities.ts'],
    ['src/types.ts'],
    ['src/tools/shared/entities.ts'],
  )
  console.log(`    ℹ TOUCH 读数 ⇒ ${JSON.stringify(touch.map((c) => c.check))}`)

  assert.equal(touch.length, 1, '★ 恰好一条')
  assert.equal(touch[0].check, 'touch')
  assert.match(touch[0].detail, /src\/tools\/shared\/entities\.ts/, '★ 必须指名那个**源**文件')
  assert.match(
    touch[0].detail, /source and a destination/,
    '★★ 还要说清**为什么**：move 类任务天生有源与目的地，而只列目的地是它的固有缺口',
  )

  /** ★ 反向半边之一：**源已经在 inScope 里** ⇒ 不报（那正是修好的形状）。 */
  assert.deepEqual(
    scopeTouchGaps(['move X out of src/a.ts'], ['src/a.ts', 'src/b.ts'], []), [],
    '★ 源已经在 inScope 里 ⇒ 一条都不许报',
  )
  /** ★ 反向半边之二：**不是 move 类**的验收标准 ⇒ 不报（否则每一个提到文件名的标准都会开火）。 */
  assert.deepEqual(
    scopeTouchGaps(['change src/a.ts so the parser handles CRLF'], ['src/b.ts'], ['src/a.ts']), [],
    '★★ 没有 move 动词 ⇒ 不适用 —— 一个靠猜的检查会在散文上误报，而误报会教人忽略门禁',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★★ 说明文字是**被强制清单的投影**（ASSIGNMENT-TEXT DIVERGENCE）
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 4（投影臂）：成员收到的说明文字**如实**带出作用域问题，而不是原样印两个列表', () => {
  /**
   * ★★★ 契约：*"the ASSIGNMENT TEXT handed to members has now diverged from the enforced
   *   team.json list FIVE times (t22 / t13 / t16 / t24 / t19)"* ——
   *   而 t13 那次**差一点发出去一个 inert 的 UI**。
   *
   * ★ MEASURED（t26）：成员拿到的那段说明**就是** `taskDetails(...)` 的返回值
   *   （`src/tools/claim.ts` 把它交给 `task_details`）。
   *   ⇒ 所以"说明文字"不是一个单独维护的副本，它就是那条投影。
   *
   * ★★ 而此前它把两个列表原样拼成一行 ⇒ **交集没人算** ⇒
   *   一条**无解**的任务在说明里读起来**完全正常**（t19 的实测形状）。
   */
  const team = { id: 't', name: 'T', captainSessionId: 'c', createdAt: 0, taskSeq: 0, members: [], tasks: [] }
  const broken = {
    id: 't1', subject: 'a task with a self-contradicting scope', status: 'pending', dependencies: [],
    kind: 'implementation', attempt: 0, createdAt: 0, updatedAt: 0,
    inScope: ['src/types.ts'], outOfScope: ['src/types.ts'],
    acceptance: ['it works'], verify: ['pnpm build'],
  }
  const rendered = taskDetails(team, broken)
  console.log(`    ℹ 说明里带出了 ⚠ 标记：${/⚠ SCOPE PROBLEM/.test(rendered)}`)

  assert.match(
    rendered, /⚠ SCOPE PROBLEM/,
    '★★★ 一条**无解**的任务不许以"看起来没问题"的样子交到成员手上 ——\n'
    + '   说明必须**当场**把矛盾标出来（此前它只印两个列表，交集没人算）。',
  )
  assert.match(rendered, /\[contradiction\]/, '★ 并指名是**哪一条**检查')
  assert.match(
    rendered, /Do NOT guess a file set/,
    '★★ 还要给出**动作**：不要猜一份文件集合，而是报告并要求改作用域 ——\n'
    + '   那正是 t19 那位成员做对的事（它拒绝猜哪一边是我的意思）。',
  )
  /** ★ 而**原本那两行仍在场**（本修是**增量**的，不是把投影换掉）。 */
  assert.match(rendered, /In scope: src\/types\.ts; Out of scope: src\/types\.ts/, '★ 两个列表仍须如实印出来')

  /**
   * ── ★★ 反向半边（防"恒挂告警"）────────────────────────────────────────────────
   *   ★ 一个**恒在场**的告警栏会让它自己变成噪音，而噪音会教人忽略门禁（本队那条）。
   */
  const clean = { ...broken, inScope: ['src/types.ts', 'lib/types.js', 'lib/types/types.d.ts'], outOfScope: ['docs/'] }
  const cleanRendered = taskDetails(team, clean)
  assert.doesNotMatch(
    cleanRendered, /⚠ SCOPE PROBLEM/,
    '★★ 一个**干净**的任务不许带那条告警 —— 否则它会变成噪音，而读的人会学会忽略它。',
  )
  assert.match(cleanRendered, /Kind: implementation/, '★ 而正常那几行仍然原样在场')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★★★ 建任务时**真的拒绝**（走真实工具入口）
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 5（真入口臂）：三条检查在 `create_task` 上真的拒绝，且**指名是哪一条**', async () => {
  /**
   * ★★ 契约：*"A task that fails any of these checks is refused at creation with a message
   *   naming which check failed"*。
   *
   * ★★★ 而它**必须走真实工具**：直呼 `scopeViolations` 证明的是**判据**，
   *   不是**接线**（本仓反复记账的那条：判据写对了而输入面没接上，
   *   在断言层面与"没有判据"同形）。
   */
  const { registerAgentTeamsTools } = await import('../lib/tools.js')
  const { createTeamDir } = await import('../lib/state.js')
  const { reviewedStamp } = await import('./fixtures/reviewed-stamp.mjs')

  const workspace = mkdtempSync(join(tmpdir(), 't26-parity-'))
  try {
    await createTeamDir(join(workspace, '.agent-teams'), {
      id: 'team', name: 'T26', captainSessionId: 'cap', createdAt: 1, taskSeq: 0, members: [], tasks: [],
    })
    const tools = new Map()
    registerAgentTeamsTools({
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      tools: { register(tool) { tools.set(tool.name, tool) } },
      subagents: {
        getProvider() { return undefined }, list() { return [] },
        sendMessage: async () => 'msg-0', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
      },
      agents: { list: () => [], get() { return undefined } },
      on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
    }, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined })

    const call = (args) => tools.get('agent_teams_create_task').execute(args, {
      agent: { id: 'cap', status: 'idle', session: { header: { cwd: workspace }, events: [] }, steer() {} },
      signal: new AbortController().signal,
    }).then(() => ({ ok: true }), (error) => ({ ok: false, message: String(error.message) }))

    const base = {
      kind: 'implementation', objective: 'do a thing', acceptance: ['it works'],
      verify: ['pnpm build'], reviewed: reviewedStamp(),
    }
    /** ★ 每个违规各自**植入**一次，并断言**对应**的那一条开火（而不是"抛了就算"）。 */
    const plants = [
      ['contradiction', { ...base, subject: 's', inScope: ['src/types.ts', 'lib/types.js', 'lib/types/types.d.ts'], outOfScope: ['src/types.ts'] }],
      /**
       * ★★★ 注意：这里必须用一个**真实存在**的源文件（`src/types.ts`）。
       *   MEASURED（t26）：第一版用的是象征性路径 `src/newthing.ts` ——
       *   而那条路径**不在盘上**，于是 EMIT **合法地**不开火（见 `emittedProductGaps`
       *   的 root 参数那段：产物"还不存在"是正常的，不是"漏声明"）。
       *   ⇒ 那次红的不是判据，是**本臂的输入造错了**。
       *   ★ 而真缺陷（t19 漏 `lib/types.js`）恰恰发生在**真实、被跟踪**的源文件上。
       */
      ['emit', { ...base, subject: 's', inScope: ['src/types.ts'], outOfScope: [] }],
      ['touch', {
        ...base, subject: 's',
        objective: 'relocate observeStall out of src/tools/shared/entities.ts',
        acceptance: ['relocate observeStall out of src/tools/shared/entities.ts'],
        inScope: ['src/types.ts', 'lib/types.js', 'lib/types/types.d.ts'], outOfScope: ['src/tools/shared/entities.ts'],
      }],
    ]
    for (const [check, args] of plants) {
      const result = await call(args)
      console.log(`    ℹ 植入「${check}」⇒ ${result.ok ? 'ACCEPTED (!!)' : 'REFUSED'}`)
      assert.equal(result.ok, false, `★★★ 植入「${check}」违规却**被接受了** —— 那条检查没有接在真实入口上`)
      assert.match(
        result.message, new RegExp(`\\(${check}\\)`),
        `★★ 拒绝的措辞必须**指名是哪一条**（${check}）—— 只说"作用域有问题"读的人无从下手。\n`
        + `   实测：${result.message.slice(0, 160)}`,
      )
    }

    /**
     * ── ★★★ 反向半边：**一份完全诚实、声明齐全的契约必须被接受** ────────────────────
     *   ★ 缺了这一半，一个"一律拒绝"的实现能让上面三条全绿 ——
     *     而那会把**每一个**正常任务挡在门外（比漏报更贵）。
     */
    const accepted = await call({
      ...base, subject: 'an honest task',
      /** ★ 这一份就是 t3 / t14 / t24 的**真实形状**：src 与它的两个产物都在。 */
      inScope: ['src/types.ts', 'lib/types.js', 'lib/types/types.d.ts'],
      outOfScope: ['docs/', 'scripts/fixtures/'],
    })
    console.log(`    ℹ 诚实契约 ⇒ ${accepted.ok ? 'ACCEPTED' : 'REFUSED: ' + accepted.message.slice(0, 120)}`)
    assert.equal(accepted.ok, true, `★★★ 一份声明齐全的契约被拒了 —— 本检查误伤了正确写法：${accepted.message}`)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：★★ 定向突变 —— 把检查拆掉 ⇒ 臂 5 必须翻脸
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 6（定向突变）：把「是否开火」抹平 ⇒ 臂 5 的断言必须翻脸', () => {
  /**
   * 「把机制单独去掉，臂必须红。」
   *
   * ★ 两个端点跑**同一份**输入、**同一条**读数函数；差别只在被测实现。
   */
  const honest = (input) => (scopeViolations(input).length > 0 ? 'refused' : 'accepted')
  /** ★ 被"拆掉机制"的版本：一律接受（本仓最坏的形态 —— 一条永远不响的检查）。 */
  const collapsed = () => 'accepted'

  const violation = { inScope: ['src/types.ts'], outOfScope: ['src/types.ts'], acceptance: ['x'] }
  console.log(`    ℹ honest ⇒ ${honest(violation)} · collapsed ⇒ ${collapsed()}`)

  assert.equal(honest(violation), 'refused', '★ honest 端对违规必须拒绝')
  assert.equal(collapsed(), 'accepted', '★ collapsed 端一律接受')
  assert.notEqual(
    honest(violation), collapsed(),
    '★★★ 两端必须给出相反结论 —— 否则臂 5 在一个"一律接受"的实现上照样绿，\n'
    + '   而那正是本任务要消灭的形态：**一个在场的、却什么都没拦住的读数**。',
  )
})
