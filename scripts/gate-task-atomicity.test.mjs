/**
 * ── 判据 `contract.task-atomicity` 的臂（t38）────────────────────────────────────
 *
 * 契约要求每条判据自带三臂（`docs/GATE-REGISTRY.md` §6）。本文件按那条结构组织，
 * 并额外钉两格本任务特有的东西：
 *
 *   · ★ **恒红防护**：`src/` 与 `lib/` 必须算**同一个概念**，
 *     否则每一个改了源码的任务都会被判"不原子"（那是恒红 —— 阻断一切诚实工作）。
 *   · ★ **误报的如实记录**：它是启发式判据，本文件把**已知会误报的情形**
 *     写成臂，而不是假装它不会误报。
 *
 * ── 它防的是什么失效（用户裁定 + 实测）────────────────────────────────────────
 *
 * 「除了写域不重叠、需要并行之外，任务还要**尽可能原子化**，以便失败后能最好
 *   直接归因到某个问题。」
 * ★ absorb-dev 的原话：「我不想在一个 attempt 里同时做『搬运 3302 行』和
 *   『重接 57 个依赖』两件事 —— 那样一旦全量红了，我分不清是搬运错了还是重接错了。」
 * ⇒ **一个 attempt 里有两类可能的原因时，失败不可归因。**
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  appliesTo,
  commandFootprint,
  conjoinedVerbs,
  discriminatingSurfaces,
  gate,
  id,
  point,
  scopeGroups,
} from '../lib/gates/contract/task-atomicity.js'

/** 收窄助手：把"期望哪一种裁决"写进断言本身（三态在测试里也不同形）。 */
function expectBlocked(verdict) {
  if (verdict.ok !== false || !('blockers' in verdict)) {
    throw new Error(`expected a blocked verdict, got ${JSON.stringify(verdict)}`)
  }
  return verdict.blockers
}
function expectUnmeasured(verdict) {
  if (verdict.ok !== false || !('unmeasured' in verdict)) {
    throw new Error(`expected an unmeasured verdict, got ${JSON.stringify(verdict)}`)
  }
  return verdict.unmeasured
}
function expectOk(verdict) {
  if (verdict.ok !== true) throw new Error(`expected an ok verdict, got ${JSON.stringify(verdict)}`)
  return verdict
}

/** 一个质量类契约（判据只对这类说话）。 */
function qualityCtx(overrides = {}) {
  return { task: { kind: 'implementation', ...overrides } }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（对照臂）：原子 ⇒ ok，且交出读数
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 对照臂：一条判别面 + 一组写域 ⇒ ok，且**交出读数**', async () => {
  const verdict = expectOk(await gate(qualityCtx({
    verify: ['node --test scripts/a.test.mjs'],
    /** ★ `src/` + `lib/` 是同一概念 —— 这正是"改了源码就得改产物"的正常形状。 */
    inScope: ['src/a.ts', 'lib/a.js'],
  })))
  /**
   * ★ 通过时**必须交出读数**："我看着 atomic"没有信息量；
   *   "判别面 1 条、写域 1 组"才有 —— 而它能被独立复核（与 `verify-command` 同构）。
   */
  assert.deepEqual(verdict.atomicityReadout, {
    /** ★ 主信号：inScope 里【没有目录条目】⇒ 这是"改既有文件"的形状。 */
    directoryEntries: 0,
    discriminatingSurfaces: 1,
    scopeGroups: 1,
    conjoinedVerbs: [],
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★ 诱导复现臂）：已知不原子的契约 ⇒ blocked + 可执行的拆分建议
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 2（诱导复现）：两条互不相关的 verify ⇒ blocked，且给出**可执行**的拆分建议', async () => {
  /**
   * ── ★★ 这一臂复现的是用户裁定里那个真实形状 ──────────────────────────────────
   *
   * 「改 A 文件并重构 B 模块」+ 两条互不相关的 verify ⇒ 全量红时分不清是哪一类。
   * ⇒ 判据必须 blocked，而**建议必须可执行**（读的人能照着建两个任务）。
   */
  /**
   * ★★ 本臂的输入在 t38 实测后被**改过一次**，而那次改动值得记：
   *
   * 第一版用的是「两条互不相关的 verify」+ 只含**文件**的 inScope，
   * 而它在**真实语料**上判 39/39 blocked（verify 条数是仓库惯例的常数，不是变量）。
   * ⇒ 那一版是**恒红**，而本臂当时全绿 —— 因为它的输入是我自己造的。
   *
   * ★ 现在它用**语料实测出来的那个信号**（结构改动）：inScope 里有**目录条目**。
   *   而 t30/t39 的真实 inScope 正是 `src/tools/`、`lib/tools/` 这种目录。
   */
  const blockers = expectBlocked(await gate(qualityCtx({
    objective: 'split src/tools.ts: move 3302 lines into src/tools/ and rewire 57 dependents',
    verify: ['pnpm build', 'pnpm typecheck', 'node --test scripts/move.test.mjs', 'pnpm test:gates', 'pnpm verify'],
    /** ★ 目录条目 = 这个任务会**创建/重组一个目录** —— 那是结构改动，失败原因开放。 */
    inScope: ['src/tools.ts', 'src/tools/', 'lib/tools/', 'lib/types/tools/'],
  })))

  const text = blockers.join('\n')
  assert.match(text, /not atomic/, '★ 必须明说"不原子"')
  /**
   * ★ 而它必须说清**为什么** —— 归因，不是大小。
   *   一条只说"这个任务太大了"的理由，读的人无法据此行动。
   */
  assert.match(
    text, /attribut/i,
    `★ 理由必须落在【归因】上（那是这条判据的全部内容），不是"任务大"。实测：${text.slice(0, 300)}`,
  )
  /** ★ 而建议要**可执行**：带上拆分后每个任务该拿的 inScope。 */
  assert.match(text, /split it into atomic tasks/, '★ 必须给出拆分建议')
  assert.match(text, /src\/tools\//, '★ 建议里要能看到目录条目')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★ 未测量臂）：判不了 ⇒ unmeasured，**绝不当成 ok**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3（未测量臂）：verify 与 inScope 都缺席 ⇒ unmeasured，不是 ok', async () => {
  const reason = expectUnmeasured(await gate(qualityCtx({ subject: 'something' })))
  assert.match(reason, /cannot judge/i, '★ 必须说清"判不了"')
  assert.match(
    reason, /NOT the same as "atomic"/i,
    '★ 而必须**显式**说"这不等同于原子" —— 那正是本判据最容易做错的一格',
  )
  /**
   * ★ 反向半边（防恒真）：同一份契约**补上** verify ⇒ 必须变成 ok。
   *   缺了这一半，"报 unmeasured"可能来自一个恒报 unmeasured 的实现。
   */
  assert.equal(
    (await gate(qualityCtx({ subject: 'something', verify: ['node --test scripts/a.test.mjs'] }))).ok, true,
    '★ 补上判别面之后必须能判 —— 否则上面那条 unmeasured 是恒真的',
  )
})

test('★ 臂 3b（第二态未测量）：verify 在场但**全是空串** ⇒ 仍然是 unmeasured', async () => {
  /**
   * ★ 这是"在场但不可判"那一格：`verify: ['']` 不是"一条判别面"，
   *   而数出来会报"0 个原因" —— 对一个**什么都没写下来**的任务说"0 个原因"，
   *   读起来像"它是原子的"。⇒ 必须 unmeasured。
   */
  const reason = expectUnmeasured(await gate(qualityCtx({ verify: ['', '   '] })))
  assert.match(reason, /blank/i, `★ 必须说清"清单在、但每一条都是空的"。实测：${reason.slice(0, 200)}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★★ 恒红防护臂）：src/lib 是同一概念
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 4（恒红防护）：`src/` 与 `lib/` 必须算**同一个概念**', async () => {
  /**
   * ── ★★ 为什么这一格是这条判据的生死线 ────────────────────────────────────────
   *
   * 本仓库强制 `lib/` 与 `src/` 同步（`contract.build-artifact-scope` 整整一条判据
   * 在讲它）⇒ **每一个**改了源码的任务，按设计也会改 `lib/`。
   *
   * ⇒ 若把这两者算成"两个概念上独立的文件组"，那么**每一个**这样的任务
   *   都会被判"不原子" —— 那不是发现缺陷，那是**恒红**。
   *   而恒红比恒真更坏：恒真让人看不见问题，**恒红阻断所有诚实的工作**。
   */
  assert.deepEqual(
    scopeGroups(['src/gates/registry.ts', 'lib/gates/registry.js']),
    ['src'],
    '★ 源码与它自己的构建产物是**同一个概念** —— 算成两组会让每个任务恒红',
  )
  assert.equal(
    (await gate(qualityCtx({
      verify: ['node --test scripts/a.test.mjs'],
      inScope: ['src/gates/registry.ts', 'lib/gates/registry.js'],
    }))).ok, true,
    '★ 而它在裁决上也必须是 ok（不只是 `scopeGroups` 的输出好看）',
  )

  /**
   * ── ★★ 而反向半边在 t38 实测后**被改过**，而那次改动本身是结论的一部分 ──────────
   *
   * 第一版这里断言：`src/` + `docs/` ⇒ **blocked**（跨两个真独立的组）。
   *
   * ★ 而语料从 39 条长到 44 条时出现了反例：
   *   · t45 `scripts/*.mjs + docs/*.md`（加一个探针并写它的说明）
   *   · t47 `package.json + scripts/* + docs/*`（把台账 HTML 接进流程）
   *   ⇒ 它们是**两件很正当的单一工作**，却被判"不原子"。
   *
   * ★ 根因：**"跨目录"是文档工作的常态** —— 写脚本的人**总是**同时改
   *   `scripts/` 与 `docs/`（说明跟着代码走）。
   * ⇒ `scopeGroups` 这个信号**从未被反例检验过**（第一版语料里没有跨组的原子任务，
   *   于是"跨组"与"不原子"恰好不冲突）—— 而它一遇到新样本就失效。
   *
   * ⇒ 所以现在：`scopeGroups` **仍然算、仍然报**（它是读数），但**不参与裁决**。
   */
  assert.deepEqual(
    scopeGroups(['src/a.ts', 'docs/a.md']), ['docs', 'src'],
    '★ 它仍然**算得出来**（读数是读数）—— 只是不再拿它判',
  )
  assert.equal(
    (await gate(qualityCtx({
      verify: ['node --test scripts/a.test.mjs'],
      inScope: ['src/a.ts', 'docs/a.md'],
    }))).ok, true,
    '★ 跨目录**不再**判 blocked：那信号在 t45/t47 上被证伪了（"跨目录"是文档工作的常态）。'
    + ' 若这里变红，说明有人又把一个没被反例检验过的信号接回了裁决',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★ 口径臂）：同一条命令的不同写法 = 同一个覆盖面
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5（口径）：同一条命令的不同写法不许被算成两个判别面', async () => {
  /**
   * ★ 一条"用字符串相等判覆盖面"的实现会在这里红：
   *   `node --test a.mjs` 与 `node --test ./a.mjs` 是**同一条命令**。
   */
  assert.deepEqual(commandFootprint('node --test ./scripts/a.test.mjs'), ['scripts/a.test.mjs'])
  assert.equal(
    discriminatingSurfaces([
      'node --test scripts/a.test.mjs',
      'node --test ./scripts/a.test.mjs',
      'node --test scripts/a.test.mjs --test-reporter=tap',
    ]).length,
    1,
    '★ 三种写法是同一条命令 ⇒ 只算**一个**判别面',
  )
  /**
   * ★ 反向半边：**真的**两条命令仍然算两面。
   */
  assert.equal(
    discriminatingSurfaces(['node --test scripts/a.test.mjs', 'node --test scripts/b.test.mjs']).length,
    2,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6（★ 误报臂）：把已知会误报的情形**写成断言**，而不是假装它不存在
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 6（误报的诚实边界）：一个**新建目录的原子任务**会被误报 —— 而这是已知代价', async () => {
  /**
   * ── ★★ 为什么把"它会误报"写成一条臂 ──────────────────────────────────────────
   *
   * 本队的定论：「**噪音会教人忽略门禁，与误报同样有害。**」
   * ⇒ 一条启发式判据**必须**把误报面写下来，否则下一个人遇到它时会以为判据错了
   *   （而它其实**按设计**这么做），于是否决整条判据。
   *
   * ── 而这条边界是**语料实测**给出的，不是想出来的 ─────────────────────────────
   *
   * 语料里只有 **2 个正例**（t30/t39），而它们恰好都是"要新建目录"的任务
   * ⇒ "目录条目"与"不原子"在那份样本上**重合**，而两个假设**无法分辨**。
   *   ★ 一个**新建目录的原子任务**（下面这个）会被误伤，而语料里没有样本能证伪它。
   */
  const atomicButCreatesDirectory = await gate(qualityCtx({
    objective: 'add a new fixtures directory with a single seed file',
    verify: ['node --test scripts/seed.test.mjs'],
    /** ★ 而这是**一件事**：新建一个目录并放一个文件。 */
    inScope: ['scripts/fixtures/'],
  }))
  assert.equal(
    atomicButCreatesDirectory.ok, false,
    '★ 本判据**会**报它（这是已知代价，不是缺陷）—— 若这里变绿，说明那个信号被改弱了，'
    + '请重新论证而不是删臂',
  )

  /**
   * ★ 反向半边（防恒真）：**不新建目录**的同形状任务必须放行。
   *   缺了这一半，本臂对"一个恒 blocked 的实现"没有分辨力。
   */
  const atomicTouchesExistingOnly = await gate(qualityCtx({
    objective: 'add one assertion to an existing fixture',
    verify: ['node --test scripts/seed.test.mjs'],
    inScope: ['scripts/seed.test.mjs'],
  }))
  assert.equal(
    atomicTouchesExistingOnly.ok, true,
    '★ 只改既有文件 ⇒ 必须放行（否则上面那条"它会报"是恒真的）',
  )
})

test('★ 臂 7（信号 ③ 的边界）：只有并列动词、判别面只有一条 ⇒ 仍须 ok', async () => {
  /**
   * ★ 自然语言不可靠 ⇒ 它**不许**单独把裁决推到 blocked。
   *   缺了这一臂，一个"看到两个动词就报"的实现会漏过整条判据的其余部分。
   */
  const verdict = expectOk(await gate(qualityCtx({
    objective: 'move the registry and rewire the dependents',
    verify: ['node --test scripts/move.test.mjs'],
    inScope: ['src/gates/registry.ts', 'lib/gates/registry.js'],
  })))
  /**
   * ★ 而它**确实**被读出来了 —— 只是不进裁决。
   *   "读出来了但不判"与"没读"必须不同形（否则读的人无从判断它是否在工作）。
   */
  assert.ok(
    verdict.atomicityReadout.conjoinedVerbs.length >= 2,
    `★ 并列动词要**读出来**（旁证），只是不判。实测：${JSON.stringify(verdict.atomicityReadout.conjoinedVerbs)}`,
  )
})

test('★ 臂 7b（信号 ③ 的判据）：连词是必要条件 —— 两个动词没有连词时不算并列', () => {
  /**
   * ★ "并列"的判据是**连词**，不是"动词出现次数"。
   *   一句话里两个动词若不并列（一个修饰另一个），它们不是两个交付。
   */
  assert.deepEqual(conjoinedVerbs('fix the parser'), [])
  assert.ok(conjoinedVerbs('move the registry and rewire the dependents').length >= 2)
  assert.ok(conjoinedVerbs('搬运 3302 行，并重接 57 个依赖').length >= 2, '★ 中文连词也要认')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8（appliesTo 臂）：只对质量类说话
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 8（闸门）：只对质量类任务说话 —— work 类不判原子性', async () => {
  /**
   * ★ 为什么不判 `work` 类：它们的契约**本来就不要求** verify / inScope
   *   （与 `contract.build-artifact-scope` 的同一段论证）。对它们判原子性
   *   会在每一个普通任务上产出噪音 —— 而噪音会教人忽略门禁。
   */
  assert.equal(appliesTo(qualityCtx()), true)
  assert.equal(appliesTo({ task: { kind: 'repair' } }), true)
  assert.equal(appliesTo({ task: { kind: 'work' } }), false, '★ work 类不判（它没有那几格的契约要求）')
  assert.equal(appliesTo({ task: {} }), false, '★ kind 缺席 = work（与 `taskKindOf` 同一口径）')
  assert.equal(appliesTo({}), false)
  assert.equal(appliesTo(undefined), false)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9（元数据臂）：id / point 与注册表的插入点一致
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 9（★ 未接线臂，t38 最重要的形状）：它**刻意不在**装配清单里', async () => {
  assert.equal(id, 'contract.task-atomicity')
  assert.equal(point, 'contract')

  /**
   * ── ★★ 为什么这一臂断言的是"**不在**清单里" ────────────────────────────────────
   *
   * MEASURED（t38 实测，本任务最重要的结论）：
   *
   *   ① 它**曾在真实语料上恒红**：第一版拿真实 39 条质量任务跑 ⇒ 39/39 blocked
   *      （根因：verify 条数是仓库惯例的常数，见判据文件头）。
   *   ② 修好之后语料上干净了（37 ok / 2 blocked，那 2 条正是已知不原子的）
   *      —— ★ 但语料只有 **2 个正例**，而它们恰好都是"要新建目录"的
   *      ⇒ "目录条目"与"不原子"在样本上**重合**，两个假设**无法分辨**。
   *   ③ 而它有一条**真实的危害**：没有 verify/inScope 时它报 `unmeasured`，
   *      而在这个插件里 **`unmeasured` 等于拒绝** ⇒ 一旦接线，
   *      **没有 verify 的任务全部建不出来**（`pnpm verify` 的生命周期检查当场红）。
   *
   * ⇒ 按用户裁定（"先软后硬"）：它是**诊断**，不是 blocker。**不接进清单。**
   *   它的调用方是 `scripts/gate-task-atomicity-corpus.test.mjs` ——
   *   那份夹具对**真实任务**跑它并输出读数，那才是它现在唯一能产出的价值：**攒语料**。
   *
   * ★ 反向半边（防恒真）：**直接 import 也必须能跑出裁决** ——
   *   否则"不接线"会退化成"它根本没工作"，而两者在读数上同形
   *   （本队记账：「一个没有调用方的修法，与没有修法在观测上完全相同」）。
   */
  const { registry } = await import('../lib/gates/index.js')
  const listed = registry.list().contract.map((entry) => entry.id)
  assert.equal(
    listed.includes('contract.task-atomicity'), false,
    `★ 它**刻意不在**装配清单里（它是诊断，不是 blocker；接线会让没有 verify 的任务全部建不出来）。`
    + ` 实测 contract 位置：${JSON.stringify(listed)}`,
  )

  /** ★ 而它**确实工作**：直接调用能给出裁决 —— 不接线 ≠ 没实现。 */
  const verdict = await gate(qualityCtx({
    verify: ['node --test scripts/a.test.mjs'],
    inScope: ['src/a.ts'],
  }))
  assert.equal(verdict.ok, true, '★ 直接调用必须给出裁决 —— "没接线"不许退化成"没工作"')
})
