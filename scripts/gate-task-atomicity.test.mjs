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
  description,
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

test('★ 臂 6（误报的诚实边界）：一个**新建目录的原子任务**会被报 —— 而这是已知代价', async () => {
  /**
   * ── ★★ 为什么把"它会误报"写成一条臂 ──────────────────────────────────────────
   *
   * 本队的定论：「**噪音会教人忽略门禁，与误报同样有害。**」
   * ⇒ 一条启发式判据**必须**把误报面写下来，否则下一个人遇到它时会以为判据错了
   *   （而它其实**按设计**这么做），于是否决整条判据。
   *
   * ── ★★ 理由改准了：它红**不是**因为"字符串以 `/` 结尾" ─────────────────────────
   *
   * 改前这条臂把 `['scripts/fixtures/']` 当成"会红"，而那时判据用的信号是
   * 「inScope 里有目录条目（字符串以 `/` 结尾）」—— 那是一个**末字符**读数。
   *
   * ⇒ **最终裁定 γ** 之下它红，理由是：
   *   **这份声明里出现了一段写域（`scripts/fixtures`），而它没说明那个目录下的哪一格**。
   *   ★ 一句话：它判的是"这份声明有没有说清那个目录下的**哪一格**"，
   *     而那正是可归因性的**形式**。
   *   ★★ 而它**不是**因为"字符串以 / 结尾"：`'scripts/fixtures'`（**不带**尾斜杠）
   *     与 `'scripts/fixtures/'` 是**同一个键、同一条理由**（见 γ-2 的同族归一化）。
   *   ⇒ 裁决的依据是**声明面的形状**（有没有写域），不是**写法**（末尾那个字符）。
   *
   * ── 而这条边界是**语料实测**给出的，不是想出来的 ─────────────────────────────
   *
   * 语料里只有 **2 个正例**（t30/t39），而它们恰好都是"要新建目录"的任务
   * ⇒ "写域声明"与"不原子"在那份样本上**重合**，而两个假设**无法分辨**。
   *   ★ 一个**新建目录的原子任务**（下面这个）会被误伤，而语料里没有样本能证伪它。
   *   ⇒ ★ 代价仍在：本判据**不接生产**（t38 刻意如此）。
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
   * ★ 而理由必须点名**那条真的把它判红的信号**（t3 的新口径）——
   *   一条"理由与判据不一致"的 blocker 会让读的人去改没用的地方。
   */
  assert.match(
    expectBlocked(atomicButCreatesDirectory).join('\n'), /scripts\/fixtures\//u,
    '★ 理由必须指名那个**写域前缀**（`scripts/fixtures/`）—— '
    + '而不是笼统地说"有目录条目"。\n'
    + '   ★ 而它**不许**说成"字符串以 / 结尾"：`\'scripts/fixtures\'`（不带尾斜杠）'
    + '与 `\'scripts/fixtures/\'` 是同一个键、同一条理由（γ 的同族归一化）。',
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

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6b ★★★：判据**不读盘** —— 一个**一定存在**的目录，仍然 blocked
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 本臂钉的是契约 §2 性质 1（纯函数：不 import 任何 I/O）的**可观察后果**──
 *
 * ── 它要说什么 ───────────────────────────────────────────────────────────────
 *
 *   `src/gates/` 是**绝对肯定在盘上**的目录（本判据自己就住在 `src/gates/contract/`）。
 *   而判据**仍然 blocked** —— 因为它判不了"是否新建"（**它不读盘**），
 *   它判的是"这份声明有没有说清那个目录下的**哪一格**"。
 *
 * ── ★★ t3-R2（裁定 B）把本臂的**对照对**换掉了，而它要钉的那件事一字没变 ────────────
 *
 *   改前的一对是：
 *     ① `['src/gates/']`                         ⇒ blocked
 *     ② `['src/gates/','src/gates/registry.ts']` ⇒ ok        ← 靠"被覆盖"放行
 *   ★ 而裁定 B 说：**写域声明一律开火**（不许用"被更具体的声明覆盖"豁免它）——
 *     因为"这个目录下有没有**未列出的**路径"**不读盘就推不出来**。
 *   ⇒ ② 现在也是 blocked。★ 那不是本臂被改弱，而恰恰是"不读盘"这条性质
 *     **更彻底地**成立了：连"我列了其中一个文件"都不能让判据**假装**它知道了整个目录。
 *
 *   ⇒ 新的对照对（同样只差"说没说清那一格"）：
 *     ① `['src/gates/']`          ⇒ blocked，读数是 `['src/gates']`
 *     ② `['src/gates/','src/gates/registry.ts']`
 *        ⇒ ★ **也是** blocked，而读数**仍然是** `['src/gates']`
 *   ★ ② 里那个具名文件（`src/gates/registry.ts`）**被写域键 `src/gates` 覆盖**
 *     （它以 `src/gates/` 开头）⇒ 它自己**不进**读数。
 *   ⇒ 于是本臂现在钉的是 B 之下**两条各自独立的性质**：
 *     · 一个**一定在盘上**的目录 ⇒ 仍然 blocked（裁决依据不是"盘上有没有"）；
 *     · 而**具名文件被更宽的写域覆盖**这件事**仍然被算**（② 的读数里没有那个文件，
 *       尽管它是被显式列出来的）—— ★ 覆盖判定**没有**被这次口径变更删掉，
 *       它只是不再用来豁免**写域**。
 */
test('★★★ 臂 6b（不读盘）：`src/gates/` 这种**一定存在**的目录，仍然 blocked', async () => {
  /** ① 存在，而"这个目录下有什么"没被说清 ⇒ 必须 blocked。 */
  const existsButUncovered = await gate(qualityCtx({
    objective: 'rework the gate directory layout',
    verify: ['node --test scripts/a.test.mjs'],
    /**
     * ★ `src/gates/` **一定在盘上**（本判据就住在 `src/gates/contract/`）。
     *   而判据**仍然**要报它 —— 因为**它不读盘（性质 1），所以它判不了"是否新建"**。
     *   它判的是：这份声明有没有说清那个目录下的哪一格。
     */
    inScope: ['src/gates/'],
  }))
  assert.equal(
    existsButUncovered.ok, false,
    '★ 一个**一定存在**的目录（`src/gates/`）⇒ **必须仍然 blocked**。\n'
    + '   若这里变绿，说明裁决依据变成了"盘上有没有这个目录"（= 读了盘），\n'
    + '   而那违反 `docs/GATE-REGISTRY.md` 性质 1：纯函数，I/O 由调用方注入。',
  )
  assert.match(
    expectBlocked(existsButUncovered).join('\n'), /src\/gates\//u,
    '★ 理由必须指名那个前缀（`src/gates/`）—— 读的人要能去核，而不是只看一个布尔',
  )

  /**
   * ★★ 第二半（★ t3-R2 换了对照对，理由见上）：**同一个**在盘上的目录，
   *   只**多列了里面的一个具名文件** ⇒ ★ 仍然 blocked（B 就是这么定的），
   *   而**读数**证明"这个具名文件落在那个写域里"这件事**仍然被算**。
   *
   *   ★ 这一半防的东西**没变**：它防"把裁决建立在盘上有没有"，
   *     同时防"覆盖判定被整个删掉"（那样 ② 的读数里会**多出**那个具名文件）。
   */
  const sameDirectoryButNamed = await gate(qualityCtx({
    objective: 'rework the gate directory layout',
    verify: ['node --test scripts/a.test.mjs'],
    /** ★ 同一件事，而这一句**多列了**那个目录下的一个具名文件。 */
    inScope: ['src/gates/', 'src/gates/registry.ts'],
  }))
  assert.equal(
    sameDirectoryButNamed.ok, false,
    '★ B 之下：**写域声明一律开火** ⇒ 这里仍然是 blocked。\n'
    + '   ★ 而这不是"本臂被改弱"，恰恰是"不读盘"更彻底地成立：\n'
    + '     列出目录里的**一个**文件，**不意味着**那个目录下**没有别的**文件 ——\n'
    + '     而"有没有别的"在不读盘的前提下**推不出来**（裁定 B 的原话）。',
  )
  assert.equal(
    sameDirectoryButNamed.atomicityReadout, undefined,
    '★ blocked 的裁决**不许**带 `atomicityReadout` —— 那是 ok 分支才有的读数形状',
  )
  /**
   * ★★ 而这是**覆盖判定仍然活着**的直接证据：② 显式列了 `src/gates/registry.ts`，
   *   而它在读数里**不在**（被写域键 `src/gates` 覆盖掉了）⇒ 读数与 ① 相同。
   *   ⇒ 若哪天有人把覆盖判定整个删掉，这里会变成 `['src/gates','src/gates/registry.ts']` ⇒ 红。
   */
  const { uncoveredDirectoryPrefixes } = await import('../lib/gates/contract/task-atomicity.js')
  assert.deepEqual(
    uncoveredDirectoryPrefixes(['src/gates/', 'src/gates/registry.ts']), ['src/gates'],
    '★ 具名文件 `src/gates/registry.ts` **被写域键 `src/gates` 覆盖** ⇒ 它不进读数。\n'
    + '   ★ 覆盖判定在 B 之下**仍然在起作用**（它只是不再用来豁免**写域**）；\n'
    + '     若这里出现那个文件，说明覆盖判定被整个删掉了 —— 那 B 的一半也没了。',
  )
})

/**
 * ── ★★★ 臂 6c（静态臂）：判据**没有 import 任何 I/O**（契约 §2 性质 1 的**静态**证据）──
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 *   臂 6b 钉的是性质 1 的**行为**（`src/gates/` 一定在盘上却仍 blocked）。
 *   而一条**行为**断言可以被一个"读了盘但读错了"的实现骗过去 ——
 *   例如 `existsSync` 写了却写反了分支。⇒ 本臂补的是**静态**那一半：
 *   直接读判据的**源码文本**，断言里面**根本没有**任何 I/O 调用面。
 *
 * ── 为什么它对 B（裁定）特别重要 ──────────────────────────────────────────────
 *
 *   裁定 B 说"写域一律开火，因为**判据不读盘**，所以'这个目录下有没有未列出的路径'
 *   在字符串层面推不出来"。★ 那句话的**全部**依据就是"它不读盘"这一条。
 *   ⇒ 若有谁日后为了让 `['src/registry.ts','src/index.ts']` 落 ok 而**去读盘**
 *     （"看看 src/ 下还有没有别的文件"），那么 B 的论证前提就**当场消失**，
 *     而本臂会红 —— 它是那句论证的**守卫**。
 *
 * ★ 它断言的是**否定**（"没有 I/O 面"），所以必须对着**源码文本**读，
 *   而不是对着编译产物 —— 编译产物会带上打包器的注入。
 */
test('★★★ 臂 6c（静态臂）：判据源码里**没有**任何 I/O —— 它是"不读盘"那句论证的守卫', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync('src/gates/contract/task-atomicity.ts', 'utf8')

  /**
   * ★★ **必须先剥掉注释** —— 否则本臂会**反过来**惩罚诚实：
   *   判据源码里恰恰**写着** `existsSync`（第 209 行，用来说明"为什么**不**用它"：
   *   「用 `existsSync` 会让判据 import I/O（违反契约 §2 性质 1）」）。
   *   ⇒ 直接扫全文会把"解释自己为什么不读盘"这句话当成"它读盘" ⇒ 本臂**恒红**，
   *     而恒红会教人把这条守卫删掉。
   *   ★ 口径：**只看可执行代码**。注释是给人读的，它出现 I/O 的名字是**证据**，
   *     不是**违规**。
   */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/[^\n]*/gu, '$1')

  /**
   * ★ 正面先钉一件事：剥注释**真的生效且没有剥过头** —— 否则下面的"没有 I/O"是恒真的。
   *   ★ 判据还是**代码**（有一批 `export function` 与 `return`），而不是被剥成空串。
   *   ★ 这里**不**用"字符数比例"当判据：本判据的文件头是**很长的论证性注释**
   *     （实测 32299 字符里只有 9623 是代码，比例 ≈ 0.30）—— 用一个比例阈值
   *     会把"这份文件写了很多论证"误判成"剥离正则坏了"。★ 而那种误判会让
   *     下一个人去调那个魔数，而不是去看真正该看的东西。
   *   ⇒ 改成**结构**判据：剥完之后那些函数签名与返回语句**仍然在**。
   */
  assert.match(
    code, /export function uncoveredDirectoryPrefixes/u,
    '★ 剥掉注释后的源码里没有 `uncoveredDirectoryPrefixes` —— 本臂读错了文件，或注释剥离把代码也剥掉了',
  )
  assert.match(
    code, /export function pathKey/u,
    '★ 剥掉注释后 `pathKey` 不见了 —— 注释剥离把代码剥掉了',
  )
  assert.match(
    code, /export function declaresScope/u,
    '★ 剥掉注释后 `declaresScope` 不见了 —— 注释剥离把代码剥掉了',
  )
  assert.match(
    code, /\breturn\b/u,
    '★ 剥掉注释后连 `return` 都没有了 —— 剩下的不是代码',
  )
  assert.ok(
    code.length > 3000,
    '★ 剥注释后剩下的代码**太少** ⇒ 剥离正则写坏了，下面的"没有 I/O"会是恒真的\n'
    + `   剥后 ${code.length} 字符（本判据的代码部分实测约 9600 字符）`,
  )
  assert.match(
    source, /existsSync/u,
    '★ 原文里应当**有** `existsSync`（在注释里，用来说明为什么不读盘）—— '
    + '它不在了说明注释被改过，那本臂"剥注释才通过"这件事就没被真正检验',
  )
  assert.doesNotMatch(
    code, /existsSync/u,
    '★ `existsSync` 应当只出现在**注释**里；剥掉注释后它还在 ⇒ 它进了可执行代码',
  )

  /**
   * ★ 而这是被禁的那批 I/O 面：模块 import、以及任何一个会碰磁盘的调用。
   *   ★ 逐个列出而不是只查 `node:fs` —— 因为 `process.binding`、`import('fs')`
   *     这类写法能绕过只查 import 的断言。
   */
  const FORBIDDEN = [
    /from\s+['"]node:fs/u,
    /from\s+['"]fs['"]/u,
    /from\s+['"]node:fs\/promises['"]/u,
    /\bexistsSync\b/u,
    /\breaddirSync\b/u,
    /\bstatSync\b/u,
    /\baccessSync\b/u,
    /\breadFileSync\b/u,
    /\brequire\s*\(/u,
  ]
  const hits = FORBIDDEN.filter((pattern) => pattern.test(code)).map((pattern) => String(pattern))
  assert.deepEqual(
    hits, [],
    '★ 判据的**可执行代码**里出现了 I/O 面：' + JSON.stringify(hits) + '\n'
    + '   `docs/GATE-REGISTRY.md` §2 性质 1：判据是**纯数据变换**，I/O 由调用方注入。\n'
    + '   ★ 而这一条对裁定 B 尤其关键：B 的全部依据是"判据不读盘 ⇒ '
    + '     「这个目录下有没有未列出的路径」在字符串层面推不出来"。\n'
    + '     若这里出现了 I/O，"不读盘"就不成立了，B 的论证前提随之消失。',
  )

  /**
   * ★★ 反向半边（防恒真）：把**同一批模式**喂给一段**故意含 I/O** 的文本，
   *   断言它们**确实**能命中 —— 否则上面的 `deepEqual([], …)` 可能只是
   *   因为那批正则全都写错了（那是最容易发生的静默失败）。
   */
  const probe = "import { existsSync } from 'node:fs'\nconst x = readdirSync('.')"
  const probeHits = FORBIDDEN.filter((pattern) => pattern.test(probe))
  assert.ok(
    probeHits.length >= 3,
    '★ 那批 I/O 模式在**故意含 I/O** 的样本上一个都没命中 ⇒ 上面"没有 I/O"的结论是恒真的（正则是坏的）\n'
    + `   实际命中 ${probeHits.length} 条：${JSON.stringify(probeHits.map(String))}`,
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

test('★★ 臂 9（★ 接线臂，t4）：它**在**装配清单里 —— 而"接线"不再等于"会拒绝"', async () => {
  assert.equal(id, 'contract.task-atomicity')
  assert.equal(point, 'contract')

  /**
   * ── ★★★ 本臂改口了，而改口的理由必须写在这里（否则读的人会以为有人拆了一条约束）──
   *
   * 改前它断言的是「它**刻意不在**装配清单里」。那条断言在当时是**对的**，
   * 而它描述的是【一个我们正在改变的决定】：
   *
   *   MEASURED（t38）：它曾在真实语料上恒红（39/39 blocked），修好后语料上干净，
   *   而语料只有 **2 个正例** ⇒ "目录条目"与"不原子"在样本上重合，两个假设无法分辨。
   *   ⇒ 按用户裁定（"先软后硬"）：那时**不接进清单**。
   *
   * ★★ 而 t4 接线时，它那条**真正的顾虑**被量清了，而它不是"别接线"：
   *
   *     ① `appliesTo` 为 true 的有**六类**（`QUALITY_KINDS`：requirements /
   *        implementation / verification / review / repair / integration）；
   *     ② 而契约层只强制**两类**要 inScope/verify（`WRITE_KINDS`：implementation / repair）；
   *     ③ ⇒ ★ 于是 requirements / verification / review / integration 这**四类**
   *        会走到 contract 位置 ⇒ 本判据报 `unmeasured` ⇒ 而**契约层把 unmeasured 当拒绝**
   *        ⇒ **一个"有 verify 的 review 任务"会被拒**。
   *
   *   ⇒ ★ 所以危害是真的，而它的**根因不是这条判据，是【契约层把 `unmeasured` 当拒绝】**。
   *     那正是本队那条：**「没能测量」并进「没通过」**。
   *
   * ★ 而本臂因此分成两半，而它们**必须不同形**：
   *
   *   A. **它接线了**（本任务交付，现在绿）
   *   B. ★ **而"接线"不该等于"会拒绝"**（现在【红】—— 那是一条**待修读数**，
   *      根因在契约层，归第二步那条任务修）
   *
   *   ⇒ ★★ 一条**有据的红**与一条**回归**必须不同形：本臂的红成因写在断言信息里，
   *     而它会在第二步（契约层区分 unmeasured / blocked）落地后**自动转绿**。
   */
  const { registry } = await import('../lib/gates/index.js')
  const listed = registry.list().contract.map((entry) => entry.id)
  assert.equal(
    listed.includes('contract.task-atomicity'), true,
    `★★ 它必须在装配清单里 —— 此前它在盘上而一次都不会跑（那是本任务要消灭的缺口）。`
    + ` 实测 contract 位置：${JSON.stringify(listed)}`,
  )

  /** ★ 反向半边（防恒真）：**直接 import 也必须能跑出裁决** —— "接线"与"能工作"是两件事。 */
  const verdict = await gate(qualityCtx({
    verify: ['node --test scripts/a.test.mjs'],
    inScope: ['src/a.ts'],
  }))
  assert.equal(verdict.ok, true, '★ 直接调用必须给出裁决 —— 接线不许退化成"它其实不工作"')

  /**
   * ── ★★★ B 半：**一个没有 inScope 的 review 任务，不许因为这条判据的 `unmeasured` 而被拒** ──
   *
   * MEASURED（t4 实测，两次独立）：
   *
   *     registry.evaluate('contract', { task: { kind: 'implementation', verify: ['true'] } })
   *     ⇒ ok = false · unmeasured = YES
   *
   * ★ 而 `review` 这一类**过得了契约层**（`WRITE_KINDS` 不含它）⇒ 它会真的走到这里。
   *
   * ⇒ ★ 本断言【现在会红】，而那是一条**真的待修读数**：
   *   成因是【契约层把 `unmeasured` 当拒绝】—— 那是「**没能测量**并进**没通过**」，
   *   也是 `src/tools/delivery.ts` 早就定过口径的那一条
   *   （"一个安全约束**不触发**时，应当放行并留下它没被检查的痕迹"，见那里 96-100 行）。
   *
   * ★★ 而与 `task-atomicity.ts` 本身无关：那条判据**诚实地**说了"我说不出"
   *   （那是对的）—— 错的是**读它的人把"说不出"读成了"不行"**。
   */
  const reviewWithoutScope = await registry.evaluate('contract', {
    task: { id: 't4-probe-review', kind: 'review', objective: 'probe: a review task with no inScope' },
  })
  assert.equal(
    reviewWithoutScope.ok, true,
    '★★★ 一个 `review` 任务（没有 inScope —— 而契约层**不要求**它有）走到 contract 位置时，'
    + '**不许**因为 `contract.task-atomicity` 报 `unmeasured` 而被拒。\n'
    + '    ⇒ 实测：`ok` = ' + String(reviewWithoutScope.ok)
    + ' · `unmeasured` = ' + (reviewWithoutScope.unmeasured === undefined ? 'none' : 'YES')
    + '\n    ⇒ ★ 这是一条【待修读数】，而它的根因是【契约层把 `unmeasured` 当拒绝】——'
    + ' 即「**没能测量**并进**没通过**」。\n'
    + '    ⇒ 它与该判据本身无关：判定诚实地说了"我说不出"（那是对的）；'
    + '错的是**读它的人**把"说不出"读成了"不行"。\n'
    + '    ⇒ 归第二步那条任务（让契约层像 `delivery.ts:96-100` 那样区分二者）；'
    + '    那一步落地后本断言**自动转绿，本文件一个字都不用改**。',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 10：★★★ 声明臂 —— 那句给人看的话【不许】声称它判"原子性"（t75）
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 10 声明臂：`description` 必须如实说它判【形状】，不许声称判"原子性"', async () => {
  /**
   * ── ★★★ 这一臂是 t75 的核心交付 ─────────────────────────────────────────────
   *
   * MEASURED（t75）：本判据的**代码**只做 `path.trim().endsWith('/')`，
   * 而它的 `description`（★ `registry.ts` 明说 "the console renders it"，
   * 即**给人看的那一句**）写的是「这个任务的契约够不够原子」。
   *
   * ⇒ ★ 读的人从那句话得到的结论，与代码能给出的结论**不同**。
   *   而本判据【不接生产】⇒ 它几乎没有运行期危害；
   *   ⇒ **那句话就是它全部的产出** —— 而它是一句做不到的承诺。
   *
   * ★★ 而它与今天记了一整天的那条同族：
   *   **一句话里的每个名词，能不能指出它的来源？**
   *   这里"原子性"这个词的来源是 —— **没有**。代码里没有任何东西在判它。
   *
   * ★ 定向突变：把 `description` 改回"够不够原子" ⇒ 本臂红。
   */
  assert.equal(typeof description, 'string', '★ 它必须有一句给人看的说明（注册表要求非空）')

  const OVERCLAIMS = [/够不够原子/, /是不是原子/, /判断.{0,6}原子性/]
  for (const pattern of OVERCLAIMS) {
    assert.doesNotMatch(
      description, pattern,
      `★ \`description\` 里出现了承诺性措辞 ${pattern} —— 而代码只做 \`endsWith('/')\`。`
      + ' ★ 而 \`description\` 是【控制台渲染给读的人看的那一句】⇒ 它就是本判据全部的产出，'
      + ' 所以它必须如实说"判的是形状"。',
    )
  }

  /** ★ 反向半边（防恒真）：它必须**说清自己判的是什么** —— 不能只是删掉那句话。 */
  assert.match(description, /形状/, '★ 必须明说判的是【声明面的形状】—— 而不是把"原子"那些字删了了事')
  assert.match(description, /征兆/, '★ 而"形状不等于结论"要写出来（形状只是"可能不可归因"的一个征兆）')
  assert.match(description, /不接生产/, '★ "它不接生产"必须写在给人看的那一句里（否则读者会以为它在把关）')
})
