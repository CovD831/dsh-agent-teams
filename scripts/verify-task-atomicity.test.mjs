/**
 * ── ★ 独立验证（t43）：「任务原子化判据」（t38）真的可判吗？────────────────────────
 *
 * ── 为什么这一条特别需要独立验证 ────────────────────────────────────────────────
 *
 * 它声称判的是「**这个任务失败时能不能归因到一个原因**」。而"原子"与"不原子"的边界
 * 是模糊的 —— 而**模糊的判据最容易退化成形状检查**：它检查的东西看起来对
 * （"inScope 里有目录条目"确实读得出），却与它声称要判的东西（失败可归因）无关。
 *
 * ⇒ 本文件的立场（契约原话）：**不采信 t38 的报告**，自己构造契约，
 *   走真实入口（`lib/gates/contract/task-atomicity.js`），
 *   看裁决是否与**我自己的独立判断**一致。
 *
 * ★ 而"我的独立判断"必须写在文件里、可复核 —— 否则它就是另一个不可检验的主张。
 *   每一条臂下面都写了「我判它是什么、依据是什么」。
 *
 * ── 五臂 ────────────────────────────────────────────────────────────────────
 *
 *   臂 1  三态真的不同形（ok / blocked / unmeasured 两两不同）
 *   臂 2  ★ 「判不了」不被读成「原子」（本队明令禁止的合流）
 *   臂 3  ★ 误报面：已知原子的契约不许被判 blocked
 *   臂 4  ★★ 核心命中：这个信号判的是【写法】还是【工作】？—— 决定性对照对
 *   臂 5  定向突变：去掉裁决分支 ⇒ 对应臂红
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const GATE = await import('../lib/gates/contract/task-atomicity.js')

/** 把一个裁决读成它的出口名 —— **这是本文件唯一的读数装置**。 */
function exitOf(verdict) {
  if (verdict === null || typeof verdict !== 'object') return 'malformed'
  if (verdict.ok === true) return 'ok'
  if (typeof verdict.unmeasured === 'string' && verdict.unmeasured.trim() !== '') {
    return Array.isArray(verdict.blockers) && verdict.blockers.length > 0 ? 'both' : 'unmeasured'
  }
  if (Array.isArray(verdict.blockers) && verdict.blockers.length > 0) return 'blocked'
  return 'neither'
}

/** 跑一次判据（含 appliesTo）。抛错本身是一个读数，不许被吞掉。 */
async function judge(task) {
  const ctx = { task }
  let applies
  try { applies = GATE.appliesTo(ctx) } catch (error) { return { exit: 'appliesThrew', raw: String(error?.message ?? error) } }
  if (applies !== true) return { exit: 'skipped' }
  try { return { exit: exitOf(await GATE.gate(ctx)) } } catch (error) { return { exit: 'threw', raw: String(error?.message ?? error) } }
}

/** 造一个质量类契约（判据只对这些 kind 开口）。 */
const contract = (fields) => ({ kind: 'implementation', ...fields })

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：三态真的不同形
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 我的独立判断 ──────────────────────────────────────────────────────────────
 *
 *   这个契约失败时能不能归因到一个原因？
 *     ① 改一个文件、一条 verify      ⇒ **能**（红就是那一条）      ⇒ 期望 ok
 *     ② 新建/重组一个目录            ⇒ **不能**（失败模式是开放的） ⇒ 期望 blocked
 *     ③ verify 与 inScope 都没有     ⇒ **说不出**（没得看）        ⇒ 期望 unmeasured
 *
 * ⇒ 三种判断各自对应一个出口，且**两两不同形**。这一臂钉的就是这件事。
 */
test('臂 1 ★ 三态两两不同形：ok / blocked / unmeasured 各自对应我的一种独立判断', async () => {
  const atomic = await judge(contract({ id: 'a', inScope: ['src/a.ts'], verify: ['node --test scripts/x.test.mjs'] }))
  const notAtomic = await judge(contract({ id: 'n', inScope: ['src/newdir/'], verify: ['pnpm verify'] }))
  const cannotTell = await judge(contract({ id: 'u' }))

  console.log(`    ℹ 我判"原子"   ⇒ ${atomic.exit}`)
  console.log(`    ℹ 我判"不原子" ⇒ ${notAtomic.exit}`)
  console.log(`    ℹ 我判"判不了" ⇒ ${cannotTell.exit}`)

  assert.equal(atomic.exit, 'ok', '★ 我独立判它原子，判据却不同意')
  assert.equal(notAtomic.exit, 'blocked', '★ 我独立判它不原子，判据却不同意')
  assert.equal(cannotTell.exit, 'unmeasured', '★ 我独立判它"说不出"，判据却不同意')

  /** ★ 两两不同形 —— 逐对写，不循环（漏掉哪一对都看不出来）。 */
  assert.notEqual(atomic.exit, notAtomic.exit, '★ ok 与 blocked 必须不同形')
  assert.notEqual(atomic.exit, cannotTell.exit, '★ ok 与 unmeasured 必须不同形')
  assert.notEqual(notAtomic.exit, cannotTell.exit, '★ blocked 与 unmeasured 必须不同形')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★「判不了」不被读成「原子」
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这是本队明令禁止的合流，也是最容易写错的一格 ────────────────────────────────
 *
 *   一个**什么都没写**的契约（没有 verify、没有 inScope）—— 我判它"说不出"。
 *   而一个图省事的实现会写：
 *
 *       const surfaces = task.verify ?? []          // ← 缺席读成空
 *       if (surfaces.length <= 1) return ok()       // ← 于是"没写"被判成"原子"
 *
 *   ⇒ 那样"契约没写清"与"契约写得原子"在读数上同形 —— 而前者恰恰是**最该被说出来**的
 *     （一个连判别面都没写的契约，它的失败必然不可归因）。
 *
 * ★ 本臂钉：**凡是"我没得看"的输入，一律不许落在 ok 上。** 逐个构造。
 */
test('臂 2 ★ 「判不了」不许被读成「原子」—— 凡是我没得看的输入，都不许落 ok', async () => {
  /**
   * 逐个构造"没得看"的形状。★ 每一条都写清**为什么我没得看** ——
   * 否则这一臂就是在断言一个我讲不出理由的清单。
   */
  const cannotTell = [
    ['两者都缺席', contract({ id: 'u1' })],
    ['两者都是 null', contract({ id: 'u2', verify: null, inScope: null })],
    ['verify 非数组', contract({ id: 'u3', verify: 'pnpm verify' })],
    ['inScope 非数组', contract({ id: 'u4', inScope: 'src/a.ts' })],
    ['verify 全空白且无 inScope', contract({ id: 'u5', verify: ['', '   '] })],
    ['task 为 null', contract({ id: 'u6', task: null })],
    ['没有 task 字段', { kind: 'implementation' }],
  ]

  for (const [label, task] of cannotTell) {
    const verdict = await judge(task)
    console.log(`    ℹ 判不了·${label.padEnd(18)} ⇒ ${verdict.exit}`)
    assert.notEqual(
      verdict.exit, 'ok',
      `★ 「${label}」被判成了 ok —— "我没得看"被读成了"我看了，它原子"。\n`
      + '   这是本队明令禁止的合流：一个连判别面都没写的契约，它的失败必然不可归因，\n'
      + '   却被报成"原子" ⇒ 读日志的人会以为它检查过了。',
    )
  }

  /**
   * ★ 反向半边（缺了它，本臂在"一律 unmeasured"的实现上照样绿）：
   *   一个**写得清楚**的原子契约必须仍然 ok。
   */
  const healthy = await judge(contract({ id: 'ok', inScope: ['src/a.ts'], verify: ['pnpm verify'] }))
  assert.equal(
    healthy.exit, 'ok',
    '★ 一个写得清楚的原子契约被判成了非 ok —— 那本臂的"不许落 ok"那一半是在"一律拒绝"的实现上也会绿',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★ 误报面 —— 已知原子的契约不许被判 blocked
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 我的独立判断：下面每一条**都是原子的**，理由写在注释里 ────────────────────────
 *
 * ★ 这一臂存在的理由（t38 自己的实测）：它第一版在真实语料上 **39/39 恒红**。
 *   一条恒红的判据会卡死一切诚实的工作 —— 而它当时**看不出**恒红，
 *   因为它的 11 条自造臂全绿。⇒ 误报面必须被**单独**钉住。
 */
test('臂 3 ★ 误报面：我已经独立判定为「原子」的契约，不许被判 blocked', async () => {
  /**
   * ★ 每一条都是**我在真实项目里见过的形状**（不是为判据量身定做的输入）——
   *   这是本臂与"自造臂"的区别所在。
   */
  const atomicContracts = [
    ['单文件 + 单 verify', contract({ id: 'p1', inScope: ['src/a.ts'], verify: ['node --test scripts/x.test.mjs'] })],
    ['单文件 + 仓库惯例的多条 verify（build/typecheck/套件/verify）', contract({ id: 'p2', inScope: ['src/a.ts'], verify: ['pnpm build', 'pnpm typecheck', 'node --test scripts/x.test.mjs', 'pnpm test:gates', 'pnpm verify'] })],
    ['纯文档单文件', contract({ id: 'p3', inScope: ['docs/PLAN.md'], verify: ['pnpm verify'] })],
    ['src 与 lib 同族（本仓库强制的同步改动）', contract({ id: 'p4', inScope: ['src/a.ts', 'lib/a.js'], verify: ['pnpm build'] })],
    ['同目录多文件（一件事，拆成几个文件）', contract({ id: 'p5', inScope: ['src/x.ts', 'src/y.ts'], verify: ['pnpm verify'] })],
    /**
     * ★ 跨目录 —— 这一条是 t38 自己实测出的**误报**形状：
     *   它曾用"inScope 跨组"判不原子，于是 t45（scripts+docs）、t47
     *   （package.json+scripts+docs）被误报。而那些是**很正当的单一工作**
     *   （写一个脚本，顺手更新说明它的文档）。
     */
    ['跨目录的单一工作（写脚本 + 更新它的文档）', contract({ id: 'p6', inScope: ['scripts/x.mjs', 'docs/x.md'], verify: ['pnpm verify'] })],
    ['包配置 + 脚本 + 文档', contract({ id: 'p7', inScope: ['package.json', 'scripts/x.mjs', 'docs/x.md'], verify: ['pnpm verify'] })],
  ]

  const falsePositives = []
  for (const [label, task] of atomicContracts) {
    const verdict = await judge(task)
    console.log(`    ℹ 我判原子·${label.padEnd(44)} ⇒ ${verdict.exit}`)
    if (verdict.exit === 'blocked' || verdict.exit === 'unmeasured') falsePositives.push(`${label} ⇒ ${verdict.exit}`)
  }

  assert.deepEqual(
    falsePositives, [],
    '★ 误报：下面这些契约我已独立判定为**原子**，判据却否定了它们：\n'
    + falsePositives.map((line) => `  · ${line}`).join('\n')
    + '\n★ 一条会误报的判据与一条恒红的一样会卡死诚实的工作（t38 第一版 39/39 恒红就是这样）。',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★★ 核心命中：这个信号判的是【写法】还是【工作】？
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这是本任务最重要的一臂，也是我独立判断与判据**分歧**的地方 ────────────────────
 *
 * ── 判据声称它判的是 ──────────────────────────────────────────────────────────
 *
 *   「inScope 里有【目录条目】⇒ 这个任务会创建/重组一个目录 ⇒ 结构改动 ⇒ 不原子」
 *   （源码 task-atomicity.ts:444-456，注释里写得很清楚）
 *
 * ── 而它实际判的是 ────────────────────────────────────────────────────────────
 *
 *       const directoryEntries = (inScope ?? []).filter((path) => path.trim().endsWith('/'))
 *       const touchesNewStructure = directoryEntries.length > 0
 *
 *   ⇒ 它**只看字符串的最后一个字符**。它从不检查那个路径是不是目录、是不是**新建**的、
 *     甚至是不是个**存在**的路径。
 *
 * ── 决定性对照对（本臂的核心）─────────────────────────────────────────────────
 *
 *   取**同一件工作**，只差一个字符（尾斜杠）：
 *
 *       ["src/registry.ts", "src/index.ts"]              ⇒ ?
 *       ["src/registry.ts", "src/index.ts", "src/"]      ⇒ ?
 *
 *   ★ 两边的**工作完全相同**（都不新建目录 —— 只是改了目录下已有的两个文件）。
 *     若判据判的是"会不会新建目录"，两者必须**同裁**。
 *     ⇒ 若两者不同裁，那它判的是**写法**，与它声称的东西无关 ——
 *       那正是契约里说的「换了名字的形状检查」。
 *
 * ── 我的独立判断 ──────────────────────────────────────────────────────────────
 *
 *   这两份契约**都是原子的**：改两个已有文件，失败时红在哪一条一目了然。
 *   ⇒ 我判两者都应当 ok。判据对第二份报了 blocked ⇒ **分歧**，如实报出。
 */
test('臂 4 ★★ 核心：只差一个尾斜杠的【同一件工作】必须同裁 —— 否则判的是写法，不是工作', async () => {
  /**
   * ★ 对照组：**同一件工作**的两种写法。两边的文件列表逐项相同，
   *   唯一的差别是第二份多了一个 `"src/"` 条目。
   */
  const withoutSlash = contract({
    id: 'ctrl-a',
    inScope: ['src/registry.ts', 'src/index.ts'],
    verify: ['node --test scripts/x.test.mjs'],
  })
  const withSlash = contract({
    id: 'ctrl-b',
    inScope: ['src/registry.ts', 'src/index.ts', 'src/'],
    verify: ['node --test scripts/x.test.mjs'],
  })

  const a = await judge(withoutSlash)
  const b = await judge(withSlash)
  console.log(`    ℹ ["src/registry.ts","src/index.ts"]            ⇒ ${a.exit}`)
  console.log(`    ℹ ["src/registry.ts","src/index.ts","src/"]     ⇒ ${b.exit}`)

  /**
   * ★★ 第二组（更尖锐）：把**一个文件**的契约写成"它所在的目录"。
   *   `["src/a.ts"]` 与 `["src/"]` 在**工作语义上**是同一个目录下的东西，
   *   而后者根本不指名任何文件 —— 它连"要改什么"都没说清。
   */
  const oneFile = contract({ id: 'ctrl-c', inScope: ['src/a.ts'], verify: ['pnpm verify'] })
  const itsDir = contract({ id: 'ctrl-d', inScope: ['src/'], verify: ['pnpm verify'] })
  const c = await judge(oneFile)
  const d = await judge(itsDir)
  console.log(`    ℹ ["src/a.ts"]  （改一个文件）                    ⇒ ${c.exit}`)
  console.log(`    ℹ ["src/"]      （同一个目录，不指名文件）          ⇒ ${d.exit}`)

  /**
   * ── ★ 我的独立判断（写在这里供复核）────────────────────────────────────────────
   *
   *   ① 对照 A / B：**同一件工作**（改目录下两个已有文件）。
   *      ⇒ 我判：**两者都原子**。理由：失败时红在哪一条改动的是一目了然的 ——
   *        这正是"原子"要保的东西（归因成本）。多写一个目录条目**不改变**这件事。
   *
   *   ② 对照 C / D：**「要改什么」的两种写法**。
   *      ⇒ 我判：C 原子（指名了一个文件）；D 我**说不出**（它只给了一个目录，
   *        没说改哪个文件 —— 但也**没说**要新建它）。★ 无论怎么判，D 都**不该**
   *        比 C 更"确定地不原子"：它给出的信息**更少**，不是更多。
   */
  const sameWork = a.exit === b.exit
  assert.ok(
    sameWork,
    '★ 判据对【同一件工作】的两种写法给了不同裁决：\n'
    + `    · ["src/registry.ts","src/index.ts"]          ⇒ ${a.exit}\n`
    + `    · ["src/registry.ts","src/index.ts","src/"]   ⇒ ${b.exit}\n`
    + '★ 这两边的**工作完全相同**（都只是改目录下已有的两个文件，都不新建目录），\n'
    + '  唯一的差别是第二个字符串以 "/" 结尾。\n'
    + '⇒ 判据说它判的是「会不会创建/重组一个目录」，而它实际上判的是**字符串的最后一个字符**：\n'
    + '  `task-atomicity.ts:444` 只做 `path.trim().endsWith("/")`，从不检查那个路径是不是目录、\n'
    + '  是不是新建的、甚至是不是存在的路径。\n'
    + '★ 这就是契约里点名的那个形态 ——「换了名字的形状检查」：检查的东西读得出，\n'
    + '  而它与它声称要判的东西（失败能否归因）无关。',
  )

  /**
   * ★ 第二条半边：D 给出的信息**比 C 少**，所以它不该被判得更"确定"。
   *   ★ 这里**不断言** D 应当是 ok 还是 unmeasured（那取决于产品想怎么定义"目录条目"）——
   *     只断言那个**单调性**：information(D) < information(C) ⇒ certainty(D) <= certainty(C)。
   */
  assert.notEqual(
    d.exit, 'ok',
    '★ 一个**只给目录、不指名任何文件**的 inScope 被判成了 ok（= "它原子"）——\n'
    + '   而它比 ["src/a.ts"] 给出的信息**更少**。信息更少却判定更确定，是判据读错了东西。',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：定向突变 —— 去掉裁决分支 ⇒ 对应臂红
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 规则二后半句 ──────────────────────────────────────────────────────────────
 *
 * 「把机制单独去掉，臂必须红。」
 *
 * ★ 本臂用**对照实现**做这件事（本任务 inScope 只有这一个 scripts/ 文件，不许改 src/）：
 *   拿同一批输入喂三个端点，看臂 1/2/3 的断言是否**只在真判据上成立**。
 *
 *   real        —— 真判据
 *   alwaysOk      —— 去掉 blocked 分支（对所有输入说 ok）
 *   alwaysUnmeasured —— 去掉 ok 分支（对所有输入说 unmeasured）
 *
 * ★ 并如实记一笔（t20/t27 的教训）：**"本来就已经红"的臂无法用突变归因** ——
 *   所以本臂不声称"我突变了产品"，它声称的是"同一条断言在这三个端点下结论不同"。
 */
test('臂 5 ★ 定向突变：去掉 blocked 分支 / 去掉 ok 分支 ⇒ 臂 1/2/3 的断言必须翻脸', async () => {
  const real = { gate: (ctx) => GATE.gate(ctx), appliesTo: () => true }
  const alwaysOk = { appliesTo: () => true, gate: () => ({ ok: true }) }
  const alwaysUnmeasured = { appliesTo: () => true, gate: () => ({ ok: false, unmeasured: 'mutated' }) }

  const inputs = [
    contract({ id: 'm1', inScope: ['src/a.ts'], verify: ['pnpm verify'] }),
    contract({ id: 'm2', inScope: ['src/newdir/'], verify: ['pnpm verify'] }),
    contract({ id: 'm3' }),
  ]

  const exitsOf = async (implementation) => {
    const out = []
    for (const task of inputs) out.push(exitOf(await implementation.gate({ task })))
    return out
  }

  const realExits = await exitsOf(real)
  const okExits = await exitsOf(alwaysOk)
  const unmeasuredExits = await exitsOf(alwaysUnmeasured)
  console.log(`    ℹ real               ⇒ ${JSON.stringify(realExits)}`)
  console.log(`    ℹ 去掉 blocked 分支  ⇒ ${JSON.stringify(okExits)}`)
  console.log(`    ℹ 去掉 ok 分支       ⇒ ${JSON.stringify(unmeasuredExits)}`)

  /** 真判据：三种输入给出三种裁决 —— 臂 1 的断言在它上面成立。 */
  assert.deepEqual(realExits, ['ok', 'blocked', 'unmeasured'], '★ 真判据没有把三种输入分开')
  assert.equal(new Set(realExits).size, 3, '★ 真判据的三态必须两两不同形')

  /**
   * ★ 去掉 blocked 分支 ⇒ 臂 1 的 `notEqual(atomic, notAtomic)` 不再成立，
   *   且臂 2 的"不许落 ok"会被 `unmeasured` 那条输入撞红。
   */
  assert.notDeepEqual(
    okExits, realExits,
    '★ 去掉 blocked 分支后裁决没变 —— 那说明臂 1 测的不是那个分支',
  )
  assert.equal(okExits[2], 'ok', '★ 去掉 blocked 分支后，"判不了"的输入也变成 ok —— 臂 2 应当抓到它')

  /**
   * ★ 去掉 ok 分支 ⇒ 臂 3 的"已知原子不许 blocked/unmeasured"会红。
   */
  assert.notDeepEqual(
    unmeasuredExits, realExits,
    '★ 去掉 ok 分支后裁决没变 —— 那说明臂 3 测的不是那个分支',
  )
  assert.equal(unmeasuredExits[0], 'unmeasured', '★ 去掉 ok 分支后，原子契约也变成 unmeasured —— 臂 3 应当抓到它')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：真实语料上的分布 —— 不是"通过"，而是"它在真实输入上是什么样"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂把 t38 的语料读数**独立重算一遍**（不采信它的报告）──────────────────────
 *
 * ★ 目的不是断定"它对/错"，而是把**分布**摆出来 —— 因为一条判据在真实语料上的形状
 *   比任何单条输入都更能说明它是变量还是常数。
 *
 * ★ 而且这一臂刻意**不写成"必须 ok 多少条"** —— 那是把语料快照写成不变量。
 *   它断言的是两件不随语料变的事：
 *     ① 不许在真实语料上抛错；
 *     ② 分布必须是**可读的**（五态分开数，尤其 `skipped` 不许并进 `ok`）。
 */
test('臂 6 真实语料分布（独立重算）：它在这批真实任务上是什么形状', async () => {
  const corpusPath = '.agent-teams/planning-loop/team.json'
  let tasks
  try {
    const document = JSON.parse(readFileSync(corpusPath, 'utf8'))
    tasks = document.tasks ?? document
  } catch {
    /**
     * ★ 语料读不到时**必须报出来**，而不是静默跳过 —— 否则本臂会变成"永远绿"。
     *   用 `assert.ok` 而不是 `return`：一个"读不到就跳过"的臂是恒真的。
     */
    assert.fail(`★ 读不到语料 ${corpusPath} —— 本臂无法成立（而"读不到就跳过"正是恒真写法）`)
  }
  assert.ok(Array.isArray(tasks) && tasks.length > 0, '★ 语料为空')

  const counts = { ok: 0, blocked: 0, unmeasured: 0, skipped: 0, threw: 0, appliesThrew: 0 }
  const blockedIds = []
  for (const task of tasks) {
    const verdict = await judge(task)
    if (verdict.exit === 'skipped') counts.skipped += 1
    else if (verdict.exit === 'threw' || verdict.exit === 'malformed' || verdict.exit === 'neither') counts.threw += 1
    else if (verdict.exit === 'appliesThrew') counts.appliesThrew += 1
    else counts[verdict.exit] += 1
    if (verdict.exit === 'blocked') blockedIds.push(task.id)
  }

  console.log(`    ℹ 真实语料 ${tasks.length} 条 ⇒ ${JSON.stringify(counts)}`)
  console.log(`    ℹ 被判 blocked 的：${blockedIds.join(', ') || '(无)'}`)

  /** ★ 不许在真实语料上抛错 —— 这与判据的语义无关，任何判据都不该炸。 */
  assert.equal(counts.threw, 0, '★ 判据在真实语料上抛错')
  assert.equal(counts.appliesThrew, 0, '★ 判据的 appliesTo 在真实语料上抛错')

  /**
   * ★ 分布必须可读：`skipped`（appliesTo 为假）与 `ok`（判过且通过）**不同形**。
   *   把它们并起来会让"这条判据对这批语料全都不适用"读成"它全都通过了"。
   */
  assert.equal(
    counts.ok + counts.blocked + counts.unmeasured + counts.skipped, tasks.length,
    '★ 五态之和不等于语料条数 —— 有输入落进了没有名字的出口',
  )
})
