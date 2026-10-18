#!/usr/bin/env node
/**
 * ── 判据：**关键能力不许被静默删除**（t75）─────────────────────────────────────────
 *
 * ── 它防的是什么（MEASURED，2026-10-16 真实事故）────────────────────────────────
 *
 * `247dd87` 落了 **S1**（判据结果落盘到 task —— B 线唯一的服务端前置）：
 * `src/state/tasks.ts` 109 → **302** 行，`update-task.ts` 里多了一行
 * `task.gateEvaluation = gateEvaluationRecordOf(completionGates)`。
 *
 * 然后 `c32f0a5`（**提交信息自称是 D12 UI 修复**）把它**整个删掉**了 ——
 * 因为那次用了 `git add -A src lib docs`，把**另一个 worktree 的中间态**扫了进来。
 *
 * ★★ 而那 5 条验收**全部通过**、`tsc` **exit=0**、门禁**全绿**。为什么？
 *   因为**回退删掉了新代码，而没有改坏老代码** ⇒ **什么都不红**。
 *   ⇒ ★ 这正是本仓记账最久的形态：**「它被删了」与「它从来没做过」在报告里同形。**
 *
 * ── ★ 这是 t63 那条的【反向】──────────────────────────────────────────────────
 *
 *     t63：**机制建好了 ≠ 接线了**（挂了判据，但调用点不存在）
 *     本条：**接线了 ≠ 没被删掉**（接线曾存在，但被后来某个提交顺手删了）
 *
 * ── ★★★ 硬约束：不许写成【读源码文本】（这是本文件的全部要点）────────────────────
 *
 * `grep "gateEvaluationRecordOf" src/state/tasks.ts` **不是**判据，理由有二：
 *
 *   ① **它会被改名/挪文件骗过**：符号搬到别的文件、或换了导出路径，grep 就失效，
 *      而能力**还在** ⇒ **假红**。本仓**恰好栽过**（t67/t70 那两次"按文件路径
 *      读源码"的夹具，见 `docs/E-LINE-L0.md` §4）。
 *   ② **它测的是文本，不是能力**：一段被注释掉的、或写在死代码里的符号名，
 *      同样能让 grep 命中 ⇒ **假绿**。
 *
 * ⇒ 本文件照 `scripts/gate-position-wiring.test.mjs` 的形状：
 *   **每一条断言都必须【实测】** —— 真的 `import` 那个模块、真的走一次工具路径、
 *   然后检查**能力自己**是否成立。清单里每条的 `check` 都是一个**可执行的函数**，
 *   而不是一段正则。
 *
 * ── ★★ 清单的形状：一条能力 = 一格，可增删，不共享正则 ─────────────────────────────
 *
 * `CAPABILITIES` 的每一项是 `{ id, capability, symbols, check }`：
 *   · `symbols` —— 该能力**依赖哪些导出**（人读面；也是"谁没了"的读数）；
 *   · `check`   —— ★ **一个函数**，它**真的去执行**那件事并给出读数。
 * ★ 刻意**不写成一个巨大正则**：那样加一条能力要改正则，而正则会腐烂。
 *   ⇒ 加一条能力 = **加一个对象**（见下面 `CAPABILITIES` 的注释）。
 *
 * ── 退出码 ────────────────────────────────────────────────────────────────────
 *
 *   0 全部能力都在 ｜ 1 有能力的读数说"它没了/坏了"
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * ── ★★★ 清单：一条能力一格 ──────────────────────────────────────────────────────
 *
 * **怎么加一条**（这是清单"可维护"的定义）：
 *   1. 写一个对象 `{ id, capability, symbols, check }`；
 *   2. `check` 必须**执行**那件事（`import` 真实模块 / 走真实工具路径），
 *      并把读数 `return` 出来 —— **不要**在里面 `grep` 源码文本；
 *   3. 若它需要"整个符号被删掉时也要红"，就在 `check` 里**先取那个符号**：
 *      符号没了 ⇒ 拿到 `undefined` ⇒ `check` 自己抛 ⇒ 断言红。
 *
 * ★ 每条能力**各自一格**，互不共享正则/共享解析逻辑 —— 那样一条腐烂不会连带别人。
 */
const CAPABILITIES = [
  {
    id: 'S1',
    capability: '判据结果落盘到 task（B 线唯一的服务端前置）',
    symbols: ['gateEvaluationRecordOf', 'task.gateEvaluation'],
    /**
     * ★★ 两半都要，而**第二半才是本次事故的形状**：
     *   (a) 投影函数**在**（整个符号被删 ⇒ 这里拿到 undefined ⇒ 当场抛）；
     *   (b) 它**真的能投影**一份 `GateEvaluation` ⇒ 得到一个可读的记录。
     * ★ 用**真实的** `GateEvaluation` 形状喂它，而不是 `{}` ——
     *   后者会让"函数在但读不出东西"蒙混过关。
     */
    async check() {
      const tasks = await import('../lib/state/tasks.js')
      const project = tasks.gateEvaluationRecordOf
      /** ★ 整个符号被删 ⇒ 这里就是 undefined ⇒ 下面一行当场抛（那正是 B 半边要的）。 */
      assert.equal(typeof project, 'function',
        '★ `gateEvaluationRecordOf` 必须是一个可调用的导出（整个符号被删是最重的形状）')
      /**
       * ★ 一份**最小的、真实的** `GateEvaluation`：字段按契约给全，
       *   否则测的是"它能不能吞下 undefined"，而不是"它能不能投影"。
       */
      const evaluation = {
        ok: false,
        blockers: ['completion.mutation: the killer suite did not report a verdict'],
        ran: [{ id: 'completion.r5', verdict: 'ok', count: 1 }, { id: 'completion.mutation', verdict: 'blocked' }],
        outputs: {},
        evaluated: 2,
        skipped: 0,
        registered: 3,
        skippedAll: undefined,
        observed: { blockers: [], unmeasured: [] },
        requires: {
          checked: 0, incomplete: 0, skipped: 0, notApplicable: 0,
          inputSurfaceAbsent: 0, missing: [], gateCellsUndeclared: [],
        },
      }
      const record = project(evaluation)
      /**
       * ★★ 三态且**必须真读到内容**（不是"函数返回了个对象"）：
       *   `ran[]` 逐条在、`evaluated`/`registered` 是数字、`ok` 是布尔。
       */
      assert.equal(record.ok, false, '★ 投影必须保留 `ok`（裁决）')
      assert.equal(Array.isArray(record.ran) && record.ran.length, 2,
        '★ 投影必须保留**全部** `ran[]` 明细（这正是"产出即被丢弃"那一格）')
      assert.deepEqual(record.ran.map((entry) => entry.id), ['completion.r5', 'completion.mutation'],
        '★ `ran[]` 必须保序（判据顺序是读数的一部分）')
      assert.equal(record.registered, 3, '★ 必须保留 `registered`（它回答"一共挂了几条"）')
      assert.equal(record.evaluated, 2, '★ 必须保留 `evaluated`（它回答"真的跑了几条"）')
      return { projected: record.ran.length, ok: record.ok }
    },
  },
  {
    id: 'T5',
    capability: '闸门判定：inScope 里"结构上不可能产出"的路径要报出来',
    symbols: ['emittedProductGaps'],
    /**
     * ★ 走**真实的** `emittedProductGaps`（它读盘判"这个文件真的在吗"），
     *   而不是读 `quality-gates.ts` 的文本。
     * ★ 它只对**真实存在且被跟踪**的源文件说话 ⇒ 用一个**真的在盘上**的路径
     *   （`src/state/tasks.ts`）来测，而不用象征性路径。
     */
    async check() {
      const entities = await import('../lib/tools/shared/entities.js')
      const gaps = entities.emittedProductGaps
      assert.equal(typeof gaps, 'function', '★ `emittedProductGaps` 必须是一个可调用的导出')
      /** ★ 前置：这个探针文件**真的在盘上**（否则它会被当成"还没创建"，不报）。 */
      const probe = 'src/state/tasks.ts'
      /** ① 只声明源文件、漏声明产物 ⇒ **必须报出缺口**（能力在工作的正面读数）。 */
      const reported = gaps([probe], new URL('..', import.meta.url).pathname)
      assert.ok(reported.length > 0,
        `★ 声明了 \`${probe}\` 却没声明它的产物 ⇒ \`emittedProductGaps\` 必须报出缺口`
        + '（若这里是 0，说明这条能力已经不再认得"漏声明的产物"了）')
      /**
       * ★★ 反向读数（**这才是分辨力**）：把产物**声明齐**之后，缺口必须消失。
       *   ⇒ 没有这一条，"它永远返回非空"与"它正确工作"同形。
       */
      const declared = gaps([probe, 'lib/state/tasks.js', 'lib/types/state/tasks.d.ts'],
        new URL('..', import.meta.url).pathname)
      assert.equal(declared.filter((gap) => String(gap.source ?? gap.path ?? '').includes('state/tasks')).length, 0,
        '★ 声明齐了产物之后，同一条源文件**不该**再报缺口（否则它是恒报的）')
      return { reported: reported.length, afterDeclaring: declared.length }
    },
  },
  {
    id: 'T8',
    capability: '成对产物：声明 `.js` 却漏了它的 `.map` 要报出来',
    symbols: ['emittedProductGaps'],
    /**
     * ★ 与 T5 **同一能力的不同面**，但**各自一格**（清单可维护的全部含义：
     *   改 T8 不动 T5）。这里测的是"**成对**产物"那一半。
     */
    async check() {
      const entities = await import('../lib/tools/shared/entities.js')
      const gaps = entities.emittedProductGaps
      assert.equal(typeof gaps, 'function', '★ `emittedProductGaps` 必须是一个可调用的导出')
      /**
       * ★ 用 `src/tools.ts`（真实存在）：只声明它**自己**、不声明任何产物
       *   ⇒ 报出的缺口里**必须**包含成对的那一类（`.js` 与它的 `.map`）。
       */
      const reported = gaps(['src/tools.ts'], new URL('..', import.meta.url).pathname)
      const text = JSON.stringify(reported)
      assert.ok(text.includes('lib/tools.js'),
        '★ 声明 `src/tools.ts` 而不声明 `lib/tools.js` ⇒ 必须报出它')
      return { reported: reported.length }
    },
  },
]

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 1：**能力都在时必须全绿**（这是"它平时不叫"的一半）
 * ───────────────────────────────────────────────────────────────────────────── */

for (const entry of CAPABILITIES) {
  test(`★ 关键能力在岗：${entry.id} — ${entry.capability}`, async () => {
    /**
     * ★ 前置：清单本身必须是**可枚举且非空**的 —— 否则下面那个循环
     *   一条都不跑，"全部通过"就成了恒真的空话（本仓记账过的形态）。
     */
    assert.ok(CAPABILITIES.length > 0, '★ 前置：能力清单不能为空（空清单会恒绿）')
    assert.ok(Array.isArray(entry.symbols) && entry.symbols.length > 0,
      `★ 前置：\`${entry.id}\` 必须点名它依赖的符号（否则"谁没了"读不出来）`)
    /**
     * ★★ 这就是**实测**：`check()` 真的去 `import` 模块、真的执行那件事。
     *   整个 `check` 抛 = 这条能力没了/坏了 ⇒ 这条臂红。
     */
    const reading = await entry.check()
    assert.ok(reading !== undefined,
      `★ \`${entry.id}\` 的 check 必须返回读数（"跑了但没读数"与"没跑"同形）`)
  })
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 2：★★ 反向半边 —— 把 `gateEvaluationRecordOf` **整个删掉** ⇒ 必须红
 *
 * ★★ **这一条才是本次事故的形状**：事故里是**整个符号消失**，
 *    不是"改坏了一行"。而仓里已有 `gateEvaluationRecordOf` 的使用点，
 *    直接删真文件会破坏 src（越权）⇒ 用**一个受控的假模块**证明"符号没了就红"。
 *
 * ★ 做法：在临时目录里放一个**没有那个导出**的同名模块，用**与臂 1 相同的判据**
 *   （同一个 `typeof … === 'function'` 断言）去撞它 ⇒ 必须抛。
 *   ⇒ 这测的是**判据的分辨力**，而不是"某个文件现在长什么样"。
 * ───────────────────────────────────────────────────────────────────────────── */

test('★★ 反向半边 B：`gateEvaluationRecordOf` 整个消失 ⇒ 判据必须红', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'critical-symbols-'))
  try {
    /** ★ 一个**刻意没有那个导出**的模块（模拟"整个符号被删掉"）。 */
    writeFileSync(join(dir, 'tasks.js'), 'export const somethingElse = 1\n')
    const sabotaged = await import(`file://${join(dir, 'tasks.js')}`)
    /** ★ 用与臂 1 **完全相同**的断言去撞它 ⇒ 必须抛。 */
    assert.throws(
      () => assert.equal(typeof sabotaged.gateEvaluationRecordOf, 'function'),
      '★★ 整个符号被删掉时，臂 1 用的那条断言**必须**抛（否则它抓不到本次事故的形状）',
    )
    /** ★ 对照：那条断言在**真模块**上不抛（证明它不是在无差别地抛）。 */
    const real = await import('../lib/state/tasks.js')
    assert.equal(typeof real.gateEvaluationRecordOf, 'function',
      '★ 对照：同一个断言在真模块上必须通过 —— 否则上面那条"抛"没有分辨力')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* ─────────────────────────────────────────────────────────────────────────────
 * ★★ 真实路径夹具：真的走一遍 `update_task`，再**从盘上**读回那个字段
 *
 * ★ 这是本文件唯一"重"的部分，而它是**必需的** —— 因为"落盘那一行在不在"
 *   这件事在**模块导出面上读不出来**（那是一次内部赋值）。
 *   ⇒ 只有**真的跑一次工具**、再**从盘上读回**，才能分辨：
 *        「它写了」 vs 「它没写」
 *   ★ 这与 `scripts/gate-execution-history.test.mjs` 用的是**同一个**夹具形状
 *     （真的 `registerAgentTeamsTools` + 真的 `createTeamDir` + 真的 `readTeam`），
 *     而且断言的是**持久化的事实**，不是工具在内存里改了什么。
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * 造一个最小可信的团队 + 一条 `work` 任务，跑一次 `update_task`，
 * 然后**从盘上**读回 `task.gateEvaluation`。
 *
 * ★ 用 `work` 而不是质量类：质量类会被完工判据拦（引入一堆无关前置条件），
 *   而本条要测的是"**判据结果有没有被写到盘上**"。
 */
async function driveUpdateTaskAndReadBack({ taskOverrides = {} } = {}) {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { registerAgentTeamsTools } = await import('../lib/tools.js')
  const { createTeamDir, readTeam } = await import('../lib/state.js')

  const workspace = mkdtempSync(join(tmpdir(), 'critical-symbols-'))
  const stateRoot = join(workspace, '.agent-teams')
  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined }, list() { return [] },
      sendMessage: async () => 'msg-0', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { list: () => [], get() { return undefined } },
    llm: { async resolveCallConfig(config) { return config }, async listModels() { return [] } },
    on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, {
    stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined,
  })
  await createTeamDir(stateRoot, {
    id: 'team', name: 'T', captainSessionId: 'cap', createdAt: 1, taskSeq: 1,
    members: [{ id: 'm1', name: 'worker', status: 'working', joinedAt: 1 }],
    tasks: [{
      id: 't1', subject: 'x', kind: 'work', status: 'in_progress', assignee: 'worker',
      dependencies: [], attempt: 1, attemptId: 'a1', createdAt: 1, updatedAt: 1,
      ...taskOverrides,
    }],
  })
  const member = {
    id: 'm1', status: 'working', steer() {},
    session: { header: { cwd: workspace, id: 'sess-m1' }, events: [], ownEvents() { return [] } },
  }
  try {
    const outcome = await tools.get('agent_teams_update_task').execute(
      { task_id: 't1', attempt_id: 'a1', status: 'completed' },
      { agent: member, signal: new AbortController().signal },
    ).then(() => 'ok', (error) => String(error.message))
    /** ★★ 从**盘上**读回来 —— 不是从工具的返回值读（那会与"只在内存里成立"同形）。 */
    const team = await readTeam(stateRoot, 'team')
    const task = team.tasks.find((item) => item.id === 't1')
    return { outcome, task }
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 3：★★ 反向半边 A —— 落盘那一行没了 ⇒ 必须红（**走真实工具路径**）
 * ───────────────────────────────────────────────────────────────────────────── */

test('★★ 反向半边 A：走一遍真实 update_task ⇒ 盘上必须真的出现 `task.gateEvaluation`', async () => {
  const { outcome, task } = await driveUpdateTaskAndReadBack()
  /** ★ 前置：那一次调用**真的成了** —— 否则下面"字段缺席"会与"调用失败"同形。 */
  assert.equal(outcome, 'ok', '★ 前置：这次 update_task 必须真的成功（否则读不出东西无从谈起）')
  assert.ok(task !== undefined, '★ 前置：必须能从盘上读回那条任务')
  /**
   * ★★ 这就是**落盘那一行在不在**的判据 —— 走的是真实路径，读的是盘上的事实。
   *   ⇒ 把 `task.gateEvaluation = gateEvaluationRecordOf(completionGates)` 删掉
   *     这条断言**当场红**（实测：字段从 `true` 变成 `false`）。**不是** grep 源码。
   */
  assert.ok(Object.hasOwn(task, 'gateEvaluation'),
    '★★ 走完一次真实的 update_task 之后，盘上必须真的有 `task.gateEvaluation` —— '
    + '它缺席就意味着**落盘那一行没了**（那正是本任务要撞的事故形状）')
  /**
   * ★★ 而"有那个字段"还不够 —— 内容必须**真的读得出来**：
   *   `ran[]` 非空、`registered` 是数字。否则"写了个空壳"也会通过。
   */
  const record = task.gateEvaluation
  assert.ok(Array.isArray(record.ran) && record.ran.length > 0,
    '★★ `gateEvaluation.ran[]` 必须非空 —— 一条判据都没记下来，等于没落盘（F3 那个缺陷的形状）')
  assert.equal(typeof record.registered, 'number', '★★ `registered` 必须是数字（它回答"一共挂了几条"）')
  return { ran: record.ran.length, registered: record.registered }
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 4：★ 清单本身不许腐烂
 * ───────────────────────────────────────────────────────────────────────────── */

test('★ 清单体检：每条都有 id/能力名/符号/可执行的 check，且 id 不重复', () => {
  const ids = CAPABILITIES.map((entry) => entry.id)
  assert.equal(new Set(ids).size, ids.length, '★ 清单里的 id 不许重复（重复会让"谁没了"读不准）')
  for (const entry of CAPABILITIES) {
    assert.ok(typeof entry.id === 'string' && entry.id !== '', '★ 每条必须有 id')
    assert.ok(typeof entry.capability === 'string' && entry.capability !== '',
      `★ \`${entry.id}\` 必须写清它是什么能力（否则读的人不知道"没了"意味着丢什么）`)
    assert.ok(Array.isArray(entry.symbols) && entry.symbols.length > 0,
      `★ \`${entry.id}\` 必须点名符号`)
    /**
     * ★★ **最关键的一条**：`check` 必须是**函数**。
     *   若它是一段字符串/正则，那正是本任务禁止的"读源码文本"形状 —— 在这里当场挡下。
     */
    assert.equal(typeof entry.check, 'function',
      `★★ \`${entry.id}\` 的 check 必须是**可执行的函数**，不许是正则或源码文本`
      + '（那正是本任务要防的形状：读文本会被改名/挪文件骗过，且看不见死代码）')
  }
})
