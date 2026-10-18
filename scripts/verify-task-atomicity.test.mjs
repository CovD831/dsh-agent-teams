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
 *   臂 4  ★★ 核心命中：裁决**只由写域条目决定**（γ-1 结构性 + γ-2 同族归一化）
 *   臂 4b ★★★ 同一目录的 `src/` 与 `src` 必须同裁，且各自独立可判
 *   臂 5  定向突变：去掉裁决分支 ⇒ 对应臂红
 *   臂 6  真实语料分布（独立重算）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerAgentTeamsTools } from '../lib/tools.js'
import { registry } from '../lib/gates/index.js'
import { contractUnmeasuredOf } from '../lib/tools/shared/entities.js'
import { createTeamDir } from '../lib/state.js'
import { reviewedStamp } from './fixtures/reviewed-stamp.mjs'

const GATE = await import('../lib/gates/contract/task-atomicity.js')

/** 臂 7/8 造的临时工作区（进程退出时清掉，与 `verify-unmeasured-consumers` 同构）。 */
const cleanups = []
process.on('exit', () => {
  for (const dir of cleanups) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})

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
 * ── 这是本任务最重要的一臂 —— 它独立判定了"这个信号判的是【写法】还是【工作】"────────
 *
 * ── 判据声称它判的是 ──────────────────────────────────────────────────────────
 *
 *   「inScope 里有【没被更具体声明覆盖的目录前缀】⇒ 这个任务会创建/重组一个目录
 *     ⇒ 结构改动 ⇒ 不原子」
 *
 * ── 而它此前实际判的是（t43 的读数，t3 已修）────────────────────────────────────
 *
 *       const directoryEntries = (inScope ?? []).filter((path) => path.trim().endsWith('/'))
 *       const touchesNewStructure = directoryEntries.length > 0
 *
 *   ⇒ 它**只看字符串的最后一个字符**。它从不检查那个路径是不是目录、是不是**新建**的、
 *     甚至是不是个**存在**的路径。★ 于是它判的是【写法】。
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
 *   ★ 旧的实现给第一份报 ok、第二份报 blocked ⇒ 那是**按写法裁决**（t43 如实报出）。
 *
 * ── ★★★ 最终裁定 γ：本臂**不再**断言这两份"同裁" ────────────────────────────────
 *
 *   ★ γ 的口径：**写域条目一律开火；具名文件不产生额外信号。**（即上面那个已落稿的实现。）
 *
 *   ★ 而"同裁"（`a.exit === b.exit`）在**最终裁定 γ** 之下**被撤掉了**，
 *     因为它在『不读盘』这条**不可协商性质**下**做不到**：
 *     字符串里没有 bit 表示"这份清单是否穷尽该目录"。
 *
 *   ⇒ ★ 本臂改成断言**两条机械规则**（γ-1 / γ-2），逐条都实测过 —— 见下面两组断言。
 *     ★ 而 φ（撤回）这件事**如实写在这里**：**不许**把它读成"已修好"或"同裁成立"。
 */
test('臂 4 ★★ 核心：裁决**只由写域条目决定** —— 具名条目的多寡与写法都不许翻它', async () => {
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
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * ── ★★★ 如实降级：本臂**不再**断言这两份同裁（最终裁定 γ）────────────────────
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * ★ 本臂**不再**断言 `['src/registry.ts','src/index.ts']` 与加 `'src/'` 的那份**同裁** ——
   *   因为那在『不读盘』这条不可协商性质下**做不到**（字符串里没有 bit 表示
   *   "这份清单是否穷尽该目录"）。
   *
   * MEASURED：前者 ok、后者 blocked，静态读数都受『声明面里有没有写域条目』决定，
   *   而**具名条目的多寡不影响任何一方**（见 γ-1 的读数断言）。
   *   ⇒ 差异来自『声明面有没有写域』，**不是**来自『列出文件的多少』—— 后者才是 t43
   *     指认的缺陷，而它已被 γ-1 结构性排除。
   *   ⇒ 这条性质由【已知边界】承担：**同级写域的 `['src/','src/x/']` ⇒ 读数两个键、理由报两条**
   *     （两个写域 = 两条要求；"写域被写域覆盖"的区分需要读盘，而判据不读盘）。
   *     ★ MEASURED：读数 `['src','src/x']`，理由里逐条出现 `"src/"` 与 `"src/x/"` ——
   *       **不**是"只报最深那条"（那需要读盘才知道哪条真的被覆盖）。
   *
   * ★★ 所以下面那两条 `assert.equal(a.exit, …)` / `assert.equal(b.exit, …)` 仍然保留
   *   （它们是**读数**，把"前者 ok、后者 blocked"这件事钉在案上），
   *   而**撤掉的是那条 `assert.ok(a.exit === b.exit)`**。
   *
   * ★ 而本臂**不被删除**、断言**不被改弱**成 `assert.ok(true)`：
   *   它换成了下面两条**机械规则**（γ-1 结构性 + γ-2 同族归一化），
   *   两条都**实测过**，且**比原来那条更难被一个退化实现满足**。
   */
  console.log(`    ℹ MEASURED（已知边界，不再是断言）：无写域 ⇒ ${a.exit}   有写域 ⇒ ${b.exit}   差异来自声明面，不是列出文件的多少`)

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * ── ★★★ γ-1：**结构性** —— 判据的裁决**只由写域条目决定** ─────────────────────
   * ═══════════════════════════════════════════════════════════════════════════
   *
   *   对**任意**一组具名文件，**追加/删除具名条目不改变裁决**。
   *
   * ★ 实现方式：用**导出的纯函数** `uncoveredDirectoryPrefixes`（**不经过 `gate`**）——
   *   这样读数**可比**，而且它测的正是"裁决的依据"本身，而不是一个被包装过的出口名。
   *
   * ★ 对每一组写域写法 `S ∈ { ['src/'], ['src'], ['./src/'], ['src\\'] }`：
   *
   *     uncoveredDirectoryPrefixes([...S, 'src/a.ts'])            === uncoveredDirectoryPrefixes(S)
   *     uncoveredDirectoryPrefixes([...S, 'src/b.ts','src/c.ts']) === uncoveredDirectoryPrefixes(S)
   *
   *   ★★ 并断言它**非空** —— 否则一个"恒空实现"也能满足上面两条相等。
   *
   * ── ★ 这一条把 t43 那个缺陷**结构性**钉死 ────────────────────────────────────
   *
   *   t43 指认的缺陷是"**列了几个文件就翻裁决**"（旧实现只做 `endsWith('/')`，
   *   于是具名条目的多寡与写法直接决定裁决）。
   *   γ-1 要求的正是它的反面：**裁决不随列出的文件多寡而变**。
   *
   * ★ 而它**不是恒真**的：本块末尾用一次**定向突变**（见臂 5 与下方 try 块）
   *   证明"把 `pathKey` 退化成只 `trim()`"会让它红。
   */
  const uncoveredOf = (scope) => GATE.uncoveredDirectoryPrefixes(scope)
  assert.equal(
    typeof uncoveredOf, 'function',
    '★ `uncoveredDirectoryPrefixes` 必须被导出（γ-1 的读数装置，不是内部细节）',
  )

  /**
   * ★ `'src\\'` 在 JS 源码里要写成 `'src\\\\'`（一个反斜杠）——
   *   它是 Windows 写法，`pathKey` 会把它折成 `'src'`。
   */
  const scopeSpellings = [
    { label: '写域写成 `src/`', scope: ['src/'] },
    { label: '写域写成 `src`', scope: ['src'] },
    { label: '写域写成 `./src/`', scope: ['./src/'] },
    { label: '写域写成 `src\\`（反斜杠）', scope: ['src\\'] },
  ]
  for (const { label, scope } of scopeSpellings) {
    const base = uncoveredOf(scope)
    const plusOne = uncoveredOf([...scope, 'src/a.ts'])
    const plusTwo = uncoveredOf([...scope, 'src/b.ts', 'src/c.ts'])
    console.log(`    ℹ γ-1 ${label.padEnd(28)} base=${JSON.stringify(base)} +1=${JSON.stringify(plusOne)} +2=${JSON.stringify(plusTwo)}`)

    /**
     * ★★ 先断言**非空** —— 否则下面两条"相等"是被"什么都返回空"满足的（恒真）。
     *   这**不是**形式主义：`['src/']` 若返回 `[]`，那么"加几个具名文件读数不变"
     *   在**任何**实现上都成立（`[] === []`），γ-1 就完全没有分辨力。
     */
    assert.ok(
      base.length > 0,
      `★ γ-1：【${label}】的读数**为空** ⇒ 下面两条"加具名条目读数不变"是恒真的\n`
      + `   （一个"什么都返回空"的实现也能满足它）⇒ γ-1 失去分辨力。\n`
      + `   实测读数：${JSON.stringify(base)}`,
    )
    assert.deepEqual(
      plusOne, base,
      `★ γ-1 失败：【${label}】追加**一个**具名条目后裁决**变了** ——\n`
      + `    · 原声明            ${JSON.stringify(scope)} ⇒ 读数 ${JSON.stringify(base)}\n`
      + `    · 追加 'src/a.ts'   ⇒ 读数 ${JSON.stringify(plusOne)}\n`
      + '★ 这正是 t43 指认的缺陷形态：**列了几个文件就翻裁决**。\n'
      + '  γ-1 要求裁决**只由写域条目决定** —— 具名条目不许产生任何额外信号。',
    )
    assert.deepEqual(
      plusTwo, base,
      `★ γ-1 失败：【${label}】追加**两个**具名条目后裁决**变了** ——\n`
      + `    · 原声明            ${JSON.stringify(scope)} ⇒ 读数 ${JSON.stringify(base)}\n`
      + `    · 追加 'src/b.ts','src/c.ts' ⇒ 读数 ${JSON.stringify(plusTwo)}\n`
      + '★ 同上：具名条目的**多寡**不许影响裁决。',
    )
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * ── ★★★ γ-2：**同族归一化** —— 同一段写域的四种写法裁决相同、读数相同 ──────────
   * ═══════════════════════════════════════════════════════════════════════════
   *
   *   `'src/'` / `'src'` / `'./src/'` / `'  src/  '` 是**同一段写域**的四种写法
   *   ⇒ 判据必须给**同一个裁决**（`assert.equal(exitA, exitB)`）
   *     **且**同一个读数（`assert.deepEqual(readoutA, readoutB)`）。
   *
   * ── ★ 这一条覆盖 brief 里"文件夹形态 vs 目录形态必须同裁"的**本意** ─────────────
   *
   *   brief 那句话的本意是：**同一段写域的写法差别不许翻裁决** ——
   *   而不是"具名文件列表与写域之间必须同裁"（那一件事做不到，见上面的如实降级）。
   *   ⇒ γ-2 钉的正是那个**做得到**的本意。
   */
  const family = ['src/', 'src', './src/', '  src/  ']
  const familyReadouts = family.map((entry) => uncoveredOf([entry]))
  const familyExits = []
  for (const entry of family) {
    familyExits.push((await judge(contract({ id: `fam-${entry}`, inScope: [entry], verify: ['pnpm verify'] }))).exit)
  }
  family.forEach((entry, index) => {
    console.log(`    ℹ γ-2 ${JSON.stringify(entry).padEnd(12)} ⇒ exit=${familyExits[index]}  readout=${JSON.stringify(familyReadouts[index])}`)
  })

  assert.ok(
    familyReadouts[0].length > 0,
    '★ γ-2：读数为空 ⇒ "四种写法读数相同"是恒真的（恒空实现也能满足）—— γ-2 失去分辨力',
  )
  for (let index = 1; index < family.length; index += 1) {
    assert.equal(
      familyExits[index], familyExits[0],
      `★ γ-2 失败（裁决）：同一段写域的两种写法给了**不同裁决** ——\n`
      + `    · ${JSON.stringify(family[0])} ⇒ ${familyExits[0]}\n`
      + `    · ${JSON.stringify(family[index])} ⇒ ${familyExits[index]}\n`
      + '★ 两边只差**格式**（尾斜杠 / `./` 前缀 / 首尾空白）—— 那是**写法**，不是工作。',
    )
    assert.deepEqual(
      familyReadouts[index], familyReadouts[0],
      `★ γ-2 失败（读数）：同一段写域的两种写法给了**不同读数** ——\n`
      + `    · ${JSON.stringify(family[0])} ⇒ ${JSON.stringify(familyReadouts[0])}\n`
      + `    · ${JSON.stringify(family[index])} ⇒ ${JSON.stringify(familyReadouts[index])}\n`
      + '★ 裁决相同还不够：**读数**也必须相同 —— 否则内部键没被真正归一化，'
      + '只是碰巧落在同一个出口上。',
    )
  }


  /**
   * ── ★★ 这两条把"两个落点"钉在案上 —— 它们是**读数**，不是"同裁"断言 ─────────────
   *
   *   ★ γ 之后本臂**不再**要求 `a.exit === b.exit`（理由见上面的如实降级）——
   *     而这两条断言**仍然必须留着**：它们把 MEASURED 的那对读数
   *     （前者 ok、后者 blocked）写死，否则"两者不同裁"这件事会变成
   *     一句没人能复核的**注释**。
   *
   *   ★★ 而它们**同时**是 γ-1 的第二个入口：`a` 与 `b` 只差一个**写域条目**
   *     （具名条目逐字相同）⇒ 它们的差异**只能**来自那个写域，
   *     不许来自"列了几个具名文件"。
   *
   *   ★ 一个"对**所有**输入都说 ok"的实现会被下面第二条红掉 ——
   *     所以本臂没有退化成恒真。
   */
  assert.equal(
    a.exit, 'ok',
    '★ `["src/registry.ts","src/index.ts"]` 落在 ok —— 这两条都是**具名文件**'
    + '（`declaresScope` 为 false），而它们**互不覆盖** ⇒ 它们自己也不开火。\n'
    + '★ 这与臂 3 的 p1/p4/p5/p7 是同一条口径（它们形状相同）⇒ 若这里变成 blocked，'
    + '臂 3 会在同样的形状上红 6 条。',
  )
  assert.equal(
    b.exit, 'blocked',
    '★ `["src/registry.ts","src/index.ts","src/"]` 必须 blocked —— '
    + '那一份多了一个**写域声明** `"src/"`，而 γ 说：**写域条目一律开火**。\n'
    + '   ★ 它**不许**因为"`src/registry.ts` 以 `"src/"` 开头 ⇒ 覆盖"而被豁免 ——'
    + ' 判据**不读盘**，"这个目录下有没有**未列出的**路径"在字符串层面**推不出来**。\n'
    + '   ★★ 而这一对**不同裁**，正是本臂**撤掉**"同裁"断言的原因（如实降级）——'
    + ' 见上面那段"★ 本臂不再断言什么"。★ 不许把它读成"已修好"。',
  )

  /**
   * ★ 第二条半边：D 给出的信息**比 C 少**，所以它不该被判得更"确定"。
   *   ★ 这里**不断言** D 应当是 ok 还是 unmeasured（那取决于产品想怎么定义"目录条目"）——
   *     只断言那个**单调性**：information(D) < information(C) ⇒ certainty(D) <= certainty(C)。
   *   ★★ 在裁定 B 之下 C 是 ok、D 是 blocked，所以这条半边**仍然成立**。
   */
  assert.notEqual(
    d.exit, 'ok',
    '★ 一个**只给目录、不指名任何文件**的 inScope 被判成了 ok（= "它原子"）——\n'
    + '   而它比 ["src/a.ts"] 给出的信息**更少**。信息更少却判定更确定，是判据读错了东西。',
  )

  /**
   * ── ★★★ 已知边界（★ γ 明令：这条性质**由已知边界承担**，一个字都不许含糊）─────────
   *
   *   "**是否穷尽**"这一类问题在**不读盘**的判据上**做不到**：
   *
   *     `['src/registry.ts','src/index.ts']`  —— 没写写域，落 ok
   *     `['src/','src/x/']`                  —— 写了两个写域，落 blocked
   *
   *   ★ 而这两条**不是**"一条穷尽、一条不穷尽"的区分 —— 判据无从知道穷尽与否。
   *     ⇒ 它判的是**声明面有没有出现写域**，不是"盘上是不是只有那些文件"。
   *
   *   ★★ γ 的**本意**：两个写域 = 两条要求 ⇒ 都进清单；而"**写域被写域覆盖**"
   *     （哪条真的被更深的写域收进去了）这个区分**需要读盘** ⇒ 判据**做不到**它。
   *
   *     MEASURED（★ 逐条实测，别照抄一句更漂亮的话）：
   *       `uncoveredDirectoryPrefixes(['src/','src/x/'])` ⇒ `['src','src/x']`（**两个键**）
   *       理由文本 ⇒ `... names 2 directory prefix(es) ("src/", "src/x/") ...`
   *       ⇒ ★ **两条都报**，**不是**"只报最深那条"。
   *       ★ 为什么"只报最深"做不到：那需要知道 `src/` 下的 `src/x/` 是否已被收进去 ——
   *         即"盘上还有没有别的" ⇒ 读盘。⇒ 那就违反了性质 1。
   *
   *   ★ 而**这不是假阴性**：在 γ 之下它不是缺陷，
   *     而是"**判据不读盘**"这条**不可协商性质**的直接后果。
   */
  const namedOnly = await judge(contract({ id: 'edge-named', inScope: ['src/registry.ts', 'src/index.ts'], verify: ['pnpm verify'] }))
  const scopeOnly = await judge(contract({ id: 'edge-scope', inScope: ['src/', 'src/x/'], verify: ['pnpm verify'] }))
  console.log(`    ℹ 已知边界·无写域声明 ⇒ ${namedOnly.exit}   有写域声明 ⇒ ${scopeOnly.exit}`)
  assert.equal(
    namedOnly.exit, 'ok',
    '★ 无写域声明 ⇒ 按具名文件判 ⇒ ok（与臂 3 同口径）',
  )
  assert.equal(
    scopeOnly.exit, 'blocked',
    '★ 有写域声明 ⇒ 一律开火 ⇒ blocked（γ：写域条目一律开火）',
  )
  /**
   * ★★ 而"同一条规则"这件事在这里被显式钉住：两条输入的裁决**不同**，
   *   而差异的**唯一**来源是"有没有写域声明" —— 不是"谁更穷尽"
   *   （那个判据**无从知道**，因为它**不读盘**）。
   */
  assert.notEqual(
    namedOnly.exit, scopeOnly.exit,
    '★ 这一条**故意**断言两者裁决不同 —— 而它不是"穷尽 vs 不穷尽"的区分，\n'
    + '   而是"声明面里有没有写域"的区分：判据**不读盘**，所以它判不了穷尽。\n'
    + '   ★ 若这里相等，说明写域这个信号整个失效了（那才是真的坏）——\n'
    + '     但**不要**把它读成"判据能分辨穷尽"：它不能，那是已知边界。',
  )

  /**
   * ★★ γ 明令的**已知边界**读数：同级写域 —— `['src/','src/x/']` **两条都开火**。
   *
   *   ★ "两个写域 = 两条要求"：**写域被写域覆盖**的区分**需要读盘**，
   *     判据做不到 ⇒ 它把两条**都**报出来（读数两个键），而裁决仍然只是 blocked。
   *   ★ 这一条**故意**不断言"只报 src/x" —— 那样写就是**替一个不读盘的判据
   *     断言了一件它无从知道的事**（"src/ 下没有别的写域，且它已被 src/x/ 完全覆盖"）。
   */
  assert.deepEqual(
    uncoveredOf(['src/', 'src/x/']), ['src', 'src/x'],
    '★ 已知边界：同级写域 ⇒ **两条都开火**（读数两个键，理由里两条都出现），裁决取 `.length > 0` ⇒ blocked。\n'
    + '   ★ "写域被写域覆盖"的区分**需要读盘**，判据做不到 —— 所以它**不**承诺"只报最深那条"。\n'
    + '   ★ 若这里变成 `[\'src/x\']`，说明有人把"写域被写域覆盖"也做进了覆盖判定 ——\n'
    + '     那需要**读盘**，会违反契约 §2 性质 1（臂 6c 静态钉着它）。',
  )

  /**
   * ★★ 而"具名文件多寡不改变裁决"这件事，在**这一对**上也有一个显式读数 ——
   *   这是 γ-1 的同宗旨、更**具体**的那块（`['src/x/','src/x/y.ts']` vs
   *   `['src/x/','src/x/z.ts']`：换掉具名文件 ⇒ 裁决与读数都不变）。
   */
  const namedY = uncoveredOf(['src/x/', 'src/x/y.ts'])
  const namedZ = uncoveredOf(['src/x/', 'src/x/z.ts'])
  console.log(`    ℹ 具名文件多寡：['src/x/','src/x/y.ts'] ⇒ ${JSON.stringify(namedY)}   ['src/x/','src/x/z.ts'] ⇒ ${JSON.stringify(namedZ)}`)
  assert.deepEqual(
    namedY, namedZ,
    '★ 换掉那个具名文件（`y.ts` → `z.ts`）读数就变了 ⇒ 具名条目在产生**额外信号**，'
    + '而 γ 说它**不许**（写域条目一律开火，具名文件不产生额外信号）。',
  )
  assert.deepEqual(
    namedY, ['src/x'],
    '★ `[\'src/x/\',\'src/x/y.ts\']` ⇒ 读数是 `[\'src/x\']`：\n'
    + '   · `\'src/x/\'` 是**写域键** ⇒ 进读数（它是"一段没说清的面"）；\n'
    + '   · `\'src/x/y.ts\'` 是**具名文件键** ⇒ **不进**读数（它是一个**点**，不是面）——\n'
    + '     判据**不读盘**，所以它没有理由把"某个具名文件"也当成一段写域。\n'
    + '   ★ 可见"写域条目多寡"决定读数，"具名条目"不决定 —— 这就是 γ 的口径。',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4b ★★★：同一目录的两种形态（`src/` 与 `src`）必须同裁，且各自独立可判
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 本臂是 t3 的验收项：它钉的是**归一化**本身 ──────────────────────────────────
 *
 * ── 要说什么 ─────────────────────────────────────────────────────────────────
 *
 *   同一个目录写成 `'src/'` 与写成 `'src'`（不带斜杠）是**同一件工作**
 *   ⇒ 判据必须给**同一个裁决**。★ 而这正是旧实现做不到的那件事：
 *   旧信号判的是**字符串最后一个字符**，于是 `'src/'` 红、`'src'` 绿。
 *
 * ── 三块，缺一块本臂就是假的 ───────────────────────────────────────────────────
 *
 *   ① **成对同裁**（核心）：逐条循环对照两种写法 ⇒ `assert.equal(withSlash.exit, withoutSlash.exit)`
 *   ② ★ **反向半边**：缺了它，①在一个"什么都返回空"的实现上**照样绿**
 *      ⇒ 所以单独拿 `uncoveredDirectoryPrefixes` 做一次读数对照，
 *        并断言那个读数**不是恒 0**
 *   ③ ◆ **反向突变**：在夹具里**局部复制**一份 lib 源码、把覆盖判定改坏，
 *      看判据立刻变成什么形状 —— 这一半问的是"覆盖判定到底有没有在起作用"
 *      （★ 实测的方向是：改坏之后它**多拦**，也就是开始误报；而不是"放过"。
 *
 * ★ 关于 ② 的那个"不是恒 0"：`uncoveredDirectoryPrefixes(['src/a.ts','src/'])`
 *   必须 `> 0`（`'src'` 被 `'src/a.ts'` 覆盖吗？**不** —— `'src/a.ts'` 不以
 *   `'src' + '/'` 开头吗？★ 它**是**以 `'src/'` 开头的 ⇒ 所以它**是**被覆盖的）。
 *   ⇒ 所以这里用一份**真的没被覆盖**的输入：`['src/a.ts','src/newdir/']`
 *     ⇒ 读数必须是 `['src/newdir']`，非空。
 *   ★ 而"两种写法读数相等"这句话在两个读法上都成立：
 *     被覆盖的那种（`[] === []`）与没被覆盖的那种（`['src/newdir'] === ['src/newdir']`）。
 *     ② 钉的是**后者**，因为前者在恒空实现上也是真的。
 */

/** 跑一次判据，同时把"读数"也取出来（`gate` 的 ok 分支才有 `atomicityReadout`）。 */
async function judgeWithReadout(task) {
  const verdict = await judge(task)
  let readout
  try {
    const raw = await GATE.gate({ task })
    readout = raw?.atomicityReadout ?? null
  } catch { readout = null }
  return { ...verdict, readout }
}

test('臂 4b ★★★ 同一目录的 `src/` 与 `src` 必须同裁 —— 且各自独立可判（不是恒空实现）', async () => {
  /**
   * ── ① 成对同裁：逐条对照"同一件工作的两种写法"────────────────────────────────
   *
   * ★ 每一对里，`…/` 与 `…` 的差别**只有那个尾斜杠** —— 别的条目逐字相同。
   * ★ 而这些对**仍然同裁**（B 之后落点变了，但"同裁"没变）：
   *   两种写法归一化后是**同一个键集** ⇒ 它们必然落在同一个裁决上。
   */
  const pairs = [
    ['改两个已有文件 + 目录条目（写域）', ['src/registry.ts', 'src/index.ts', 'src/'], ['src/registry.ts', 'src/index.ts', 'src']],
    ['只给一个目录（写域）', ['src/'], ['src']],
    ['单文件 + 目录（写域）', ['src/a.ts', 'src/'], ['src/a.ts', 'src']],
    ['跨目录的两个面（两个写域）', ['src/x/', 'docs/y/'], ['src/x', 'docs/y']],
  ]

  for (const [label, withSlashScope, withoutSlashScope] of pairs) {
    const withSlash = await judge(contract({ id: `pair-${label}`, inScope: withSlashScope, verify: ['pnpm verify'] }))
    const withoutSlash = await judge(contract({ id: `pair-${label}`, inScope: withoutSlashScope, verify: ['pnpm verify'] }))
    console.log(`    ℹ ${label.padEnd(30)} '…/' ⇒ ${withSlash.exit.padEnd(10)} '…' ⇒ ${withoutSlash.exit}`)
    assert.equal(
      withSlash.exit, withoutSlash.exit,
      `★ 【${label}】同一件工作的两种写法裁决不同：\n`
      + `    · ${JSON.stringify(withSlashScope)}   ⇒ ${withSlash.exit}\n`
      + `    · ${JSON.stringify(withoutSlashScope)} ⇒ ${withoutSlash.exit}\n`
      + '★ 两边只差一个尾斜杠 —— 那是**写法**，不是工作。\n'
      + '  若判据判的是"这个目录下有没有说清"，两者归一化后是**同一个键集**，必须同裁。',
    )
  }

  /**
   * ★★ ②（t3-R2 按裁定 B 更新了期望读数）────────────────────────────────────────────
   *
   *   B 之后 `uncoveredDirectoryPrefixes` 的口径是：
   *     · **写域键**（`declaresScope` 真）⇒ **无条件**进读数（**不看**覆盖）；
   *     · **具名文件键** ⇒ 只在**没被覆盖**时进读数。
   *
   *   ⇒ 所以"被覆盖 ⇒ 读数为空"这条**只在具名文件键上**还成立：
   */
  const uncoveredOf = (scope) => GATE.uncoveredDirectoryPrefixes(scope)
  assert.equal(
    typeof uncoveredOf, 'function',
    '★ `uncoveredDirectoryPrefixes` 必须被导出（它是本修法的读数装置，不是内部细节）',
  )

  /**
   * ★ 具名文件被更宽的写域覆盖 ⇒ 它**不进**读数（★ 覆盖判定在 B 之下**仍然活着**）。
   *   `['src/registry.ts','src/']`：`'src/registry.ts'` 是具名文件、被写域键 `'src'`
   *   覆盖 ⇒ 它不进读数；而 `'src'` 是写域 ⇒ **它进** ⇒ 读数是 `['src']`。
   *
   *   ★ 改写前这里期望的是 `[]`（口径 C：写域被覆盖就不算）—— 那已被裁定 B 撤销。
   *     ⇒ 而"两种写法的读数必须相同"这条**没变**（归一化仍然是同一个键）。
   */
  const coveredWithSlash = uncoveredOf(['src/registry.ts', 'src/'])
  const coveredWithoutSlash = uncoveredOf(['src/registry.ts', 'src'])
  console.log(`    ℹ 读数（含写域）    '…/' ⇒ ${JSON.stringify(coveredWithSlash)}   '…' ⇒ ${JSON.stringify(coveredWithoutSlash)}`)
  assert.deepEqual(coveredWithSlash, coveredWithoutSlash, '★ 同一形状：两种写法的读数必须相同（归一化生效）')
  assert.deepEqual(
    coveredWithSlash, ['src'],
    '★ `[\'src/registry.ts\',\'src/\']` 的读数必须是 `[\'src\']` —— 裁定 γ：\n'
    + '   · `\'src/\'` 是**写域键** ⇒ 进读数（它是"一段没说清的面"）；\n'
    + '   · `\'src/registry.ts\'` 是**具名文件键** ⇒ **不进**读数（它是一个**点**，不是面）。\n'
    + '   ★ 若读数是 `[]`，说明写域开火被退回成了口径 C（写域可被更具体声明豁免）；\n'
    + '     若读数是 `[\'src\',\'src/registry.ts\']`，说明具名文件键被错误地收进了清单。',
  )

  /**
   * ★★ 而这一半是防恒空的那一半：**写域**的形状读数必须**非空**。
   *   `['src/a.ts','src/newdir/']`：`'src/a.ts'` 是**具名文件** ⇒ 不进读数；
   *   而 `'src/newdir'` 是**写域** ⇒ 进读数 ⇒ 读数是 `['src/newdir']`。
   *
   * ★ 缺了这一断言，"两种写法都返回空"这件事就是被一个"什么都返回空"的实现做出来的 ——
   *   而那正是本臂 ① 恒真的那种退化。
   */
  const openWithSlash = uncoveredOf(['src/a.ts', 'src/newdir/'])
  const openWithoutSlash = uncoveredOf(['src/a.ts', 'src/newdir'])
  console.log(`    ℹ 读数（含写域）    '…/' ⇒ ${JSON.stringify(openWithSlash)}   '…' ⇒ ${JSON.stringify(openWithoutSlash)}`)
  assert.deepEqual(openWithSlash, openWithoutSlash, '★ 同一形状：两种写法的读数必须相同（归一化生效）')
  assert.deepEqual(
    openWithSlash, ['src/newdir'],
    '★ `[\'src/a.ts\',\'src/newdir/\']` 的读数必须是 `[\'src/newdir\']` —— 裁定 γ：\n'
    + '   清单里**只收写域键**（`\'src/newdir\'`），**不收**具名文件键（`\'src/a.ts\'`）。\n'
    + '   ★ 空读数说明写域开火没了；出现 `\'src/a.ts\'` 说明具名文件键被收了进来 ——\n'
    + '     而那会让**真实 94 条语料全部 blocked**（实测：ok 0 / blocked 94），'
    + '     即判据恒红（t38 花整轮修掉的病）。',
  )
  assert.ok(
    openWithSlash.length > 0,
    '★ 读数**不是恒 0**：否则上面的"两种写法读数相等"是被"什么都返回空"实现的（本臂 ① 会恒真）',
  )

  /**
   * ── ◆ ③ 反向突变（★ t3-R2 按**最终裁定 γ** 重新选点，理由见下）──────────────────
   *
   * ── ★★★ 为什么必须重新选点（两轮都撞到同一件事，这不是"把本块改弱了"）────────────
   *
   *   · 口径 C 时本块用 `['src/a.ts','src/x/','src/x/y.ts']`（真实现 ok / 突变 blocked）。
   *   · 裁定 B 时那一对已经**两边都 blocked** ⇒ 失去区分度，我改成
   *     "覆盖恒 false ⇒ 读数变长"。
   *   · ★★ 而**最终裁定 γ** 把返回值收成 `keys.filter((key) => scopeKeys.has(key))`
   *     —— 覆盖判定（`isCovered`）**不再出现在返回值里**，它成了**死代码**。
   *     ⇒ 实测：把 `isCovered` 改成恒 false，**读数与裁决一个字符都不变**
   *       ⇒ 那个突变**没有区分度**了，留着它就是一条**恒绿**的假臂。
   *
   * ── ★ 新的选点：突变**真正在裁决里的那个谓词** —— `declaresScope` ────────────────
   *
   *   γ 之下"裁决 = 写域键进清单"，所以**唯一**能推动裁决的就是 `declaresScope`。
   *   ⇒ 把它改成**恒真**（每条声明都算写域）⇒ 清单变成"所有键" ⇒
   *     `['src/a.ts']` 这类**具名文件**也会开火 ⇒ 判据开始**多报**。
   *
   *     真实现（declaresScope 正常）⇒ `['src/a.ts']` ⇒ 读数 `[]`   ⇒ **ok**
   *     突变版（declaresScope 恒真）⇒ `['src/a.ts']` ⇒ 读数 `['src/a.ts']` ⇒ **blocked**
   *
   *   ★ 而"该拦的仍然被拦"那一半由 `['src/']` 钉住：写域键**无论突变与否**都开火
   *     ⇒ 真实现与突变版**都** blocked ⇒ 判据不是"恒不拦"。
   *   ★ 这一块因此比原来**更强**：它突变的是**裁决真正依赖的那一个谓词**。
   *
   * 做法（★ 本任务 inScope 只有这一个 scripts/ 文件，**不许**改 `lib/**` ——
   *   那会污染别人同时跑的夹具 ⇒ 用**进程内局部复制**）：
   *
   *   ① 从磁盘读 `lib/gates/contract/task-atomicity.js` 的**源码文本**；
   *   ② 用**正则**把 `declaresScope` 改坏（恒真 ⇒ 每条都是写域）；
   *      ★ 替换不中时 `assert.fail` —— 静默不中会让本臂恒真；
   *   ③ 写成临时文件，用**带 cache-busting 查询串**的动态 import 加载；
   *   ④ `try/finally` 删掉临时文件（不许留垃圾在树里）；
   *   ⑤ 断言：**具名文件在真实现上放行、在突变版上被拦**（裁决真的由这个谓词驱动），
   *      且 `['src/']` **两边都 blocked**（该拦的仍然被拦）。
   */
  const libSource = readFileSync('lib/gates/contract/task-atomicity.js', 'utf8')
  /**
   * ★ `declaresScope` 的**函数体第一行**（编译后）形如：
   *     export function declaresScope(entry) {
   *         const raw = entry.trim().replace(/\\/gu, '/');
   * ⇒ 在函数体开头插入 `return true;`（恒真 ⇒ 每条声明都算写域）。
   */
  const MUTATION = /(export function declaresScope\(entry\) \{\n)/u
  if (!MUTATION.test(libSource)) {
    /**
     * ★ 退化成源码文本断言（brief §8 明令：**不许静默跳过**，并要如实写明原因）。
     *   走到这里说明编译产物换了形状（例如被 esbuild 重写）⇒ 文本替换不再可靠。
     */
    console.log('    ℹ 突变半边退化成【源码文本断言】：编译产物里找不到 `declaresScope` 的函数头')
    assert.match(
      libSource, /declaresScope/u,
      '★ `declaresScope` 在编译产物里**必须**存在（γ 之下它是裁决唯一依赖的谓词）—— '
      + '★ 本臂退化成文本断言，因为它的函数头在 lib 文本里找不到 '
      + '（编译产物换了形状 ⇒ 进程内文本替换不再可靠）',
    )
    return
  }

  /**
   * ★ 临时文件写在**本文件旁边**（`scripts/`）而不是 `lib/**` ——
   *   只有这样才能保证"跑完删掉、不污染别人的夹具"。
   *
   * ★★ 而写在 `scripts/` 就带来第二件事：编译产物里那句
   *   `import ... from '../registry.js'` 是相对 **`lib/gates/contract/`** 写的
   *   ⇒ 从 `scripts/` 解析会指向仓库根下的 `registry.js`（**不存在**）。
   *   ⇒ 所以本臂要把那句相对路径**一并改写成指向 `lib/gates/`**。
   *   ★ 这一步**也是 `assert.notEqual` 盯着的**（替换不中 ⇒ 立刻红，不静默）。
   */
  /**
   * ★★ 而编译产物里那句 import 用的是**双引号**（`tsc` 的产物风格：
   *   `import { blocked, unmeasured } from "../registry.js";`）——
   *   所以这条正则**两种引号都认**（只认单引号会让本臂在"替换不中"上红，
   *   而那是夹具写错了，不是判据有问题）。
   */
  const IMPORT_REWRITE = /from (['"])\.\.\/registry\.js\1/u
  const stamp = `${process.pid}-${Date.now()}`
  const tempPath = new URL(`./.mutant-task-atomicity-${stamp}.mjs`, import.meta.url)
  const mutatedSource = libSource
    /** ★ 恒真：每条声明都算"一段写域" ⇒ 具名文件也会开火 ⇒ 判据开始多报。 */
    .replace(MUTATION, '$1    return true;\n')
    .replace(IMPORT_REWRITE, "from '../lib/gates/registry.js'")
  assert.notEqual(
    mutatedSource, libSource,
    '★ `declaresScope` 恒真的替换没有生效 —— 那本臂的"突变版会多拦"就是恒假的（静默失败）',
  )
  assert.match(
    mutatedSource, /return true;/u,
    '★ 突变体里没插进 `return true;` —— 突变没生效，本臂会恒绿',
  )
  assert.match(
    mutatedSource, /from '\.\.\/lib\/gates\/registry\.js'/u,
    '★ 相对 import 的改写没有生效 —— 突变模块会解析不到 `registry.js` 而抛 ERR_MODULE_NOT_FOUND，'
    + '那会让本臂的突变半边变成"因为报错所以红"，而不是"因为谓词被改坏所以多拦"',
  )

  const { writeFileSync, unlinkSync } = await import('node:fs')
  let mutated
  let mutatedExits
  try {
    writeFileSync(tempPath, mutatedSource, 'utf8')
    /** ★ cache-busting 查询串：同一个进程里多次 import 必须拿到**新的**模块实例。 */
    mutated = await import(`${tempPath.href}?v=${stamp}`)
    const judgeMutated = async (scope) => {
      const raw = await mutated.gate({ task: contract({ id: 'm', inScope: scope, verify: ['pnpm verify'] }) })
      return exitOf(raw)
    }
    mutatedExits = {
      /** ★ 具名文件 —— 真实现放行，而变异体（写域恒真）会拦它。 */
      namedFile: await judgeMutated(['src/a.ts']),
      /** ★ 真写域 —— 两边都该拦（判据不是"恒不拦"）。 */
      stillBlocked: await judgeMutated(['src/']),
    }
  } finally {
    /** ★ 不许留垃圾在树里（无论上面抛没抛都要删）。 */
    try { unlinkSync(tempPath) } catch { /* 已经不在盘上就算了 */ }
  }

  const realExits = {
    namedFile: (await judge(contract({ id: 'r1', inScope: ['src/a.ts'], verify: ['pnpm verify'] }))).exit,
    stillBlocked: (await judge(contract({ id: 'r2', inScope: ['src/'], verify: ['pnpm verify'] }))).exit,
  }
  console.log(`    ℹ 真实现   ['src/a.ts'] ⇒ ${realExits.namedFile}   ['src/'] ⇒ ${realExits.stillBlocked}`)
  console.log(`    ℹ 突变版（declaresScope 恒真）同一组输入 ⇒ ${mutatedExits.namedFile}   ${mutatedExits.stillBlocked}`)

  /**
   * ★★ 这几条断言合起来才是"`declaresScope` 真的在驱动裁决、而该拦的仍然被拦"：
   *
   *   ① 真实现：`['src/a.ts']`（**具名文件**，不是写域）⇒ 读数空 ⇒ **ok**；
   *   ② 突变版（写域恒真）：同一个输入 ⇒ `'src/a.ts'` 也被算成一段写域
   *      ⇒ 读数 `['src/a.ts']` ⇒ **blocked**。★ 这就证明裁决**真的**由这个谓词驱动；
   *   ③ 而 `['src/']`（真写域）在**两边都 blocked** ⇒ 判据不是"恒不拦"。
   *
   *   ★ 若 ① 与 ② 相同，说明 `declaresScope` 没有在参与裁决（本块恒真）。
   */
  const mutatedReadout = mutated.uncoveredDirectoryPrefixes(['src/a.ts'])
  const realReadout = GATE.uncoveredDirectoryPrefixes(['src/a.ts'])
  console.log(`    ℹ 读数       真实现 ⇒ ${JSON.stringify(realReadout)}   突变版 ⇒ ${JSON.stringify(mutatedReadout)}`)
  assert.deepEqual(
    realReadout, [],
    '★ 真实现：`\'src/a.ts\'` 是**具名文件**（`declaresScope` 为 false）⇒ 不进清单 ⇒ 读数为空',
  )
  assert.deepEqual(
    mutatedReadout, ['src/a.ts'],
    '★ 突变版（`declaresScope` 恒真）：`\'src/a.ts\'` 也被当成一段写域 ⇒ 进清单。\n'
    + '   ★ 若这里与真实现相同，说明 `declaresScope` 根本没在参与裁决（本块恒真）。',
  )
  assert.notDeepEqual(
    realReadout, mutatedReadout,
    '★ 把 `declaresScope` 改成恒真之后，读数**没有变** —— '
    + '那说明那个谓词根本没在起作用，本块是恒真的',
  )
  assert.equal(
    realExits.namedFile, 'ok',
    '★ 真实现：`[\'src/a.ts\']`（只有一个具名文件、无写域声明）必须 **ok** —— '
    + '★ 这条同时是**恒红防护**：若它 blocked，则真实 94 条语料会**全部** blocked（实测 ok 0 / blocked 94）。',
  )
  assert.equal(
    mutatedExits.namedFile, 'blocked',
    '★ 突变版（`declaresScope` 恒真）把同一个输入判成 blocked ⇒ 那个谓词确实在驱动裁决',
  )
  assert.equal(
    realExits.stillBlocked, 'blocked',
    '★ `[\'src/\']` 在真实现上必须 blocked —— 它是一段写域，是真信号',
  )
  assert.equal(
    mutatedExits.stillBlocked, 'blocked',
    '★ 而突变版对它也仍然 blocked ⇒ 判据不是"恒不拦"',
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
  /**
   * ── ★★ 语料位置：给【候选】而不是一个死路径（2026-10-10 修）────────────────────
   *
   * MEASURED：此前写死 `.agent-teams/planning-loop/team.json`，而那棵团队后来被
   * **归档**到 `.agent-teams/archive/planning-loop/team.json` ⇒ 本臂永久红。
   * ★ 而它红的原因与"判据对真实语料的分布"**无关** —— 是路径没跟上归档。
   *
   * ⇒ 修法：按顺序试候选（活跃位置 → 归档位置）。
   *   ★ 而**纪律一字不变**：全都读不到时仍然 `assert.fail`，
   *     **绝不**静默跳过 —— 一个"读不到就跳过"的臂是恒真的（见下面那段注释）。
   */
  const corpusCandidates = [
    '.agent-teams/planning-loop/team.json',
    '.agent-teams/archive/planning-loop/team.json',
  ]
  let tasks
  let foundPath
  for (const candidate of corpusCandidates) {
    try {
      const document = JSON.parse(readFileSync(candidate, 'utf8'))
      tasks = document.tasks ?? document
      foundPath = candidate
      break
    } catch { /* 试下一个候选 */ }
  }
  if (foundPath === undefined) {
    /**
     * ★ 语料读不到时**必须报出来**，而不是静默跳过 —— 否则本臂会变成"永远绿"。
     *   用 `assert.fail` 而不是 `return`：一个"读不到就跳过"的臂是恒真的。
     */
    assert.fail(
      `★ 读不到语料（试过 ${corpusCandidates.join(' / ')}）`
      + ` —— 本臂无法成立（而"读不到就跳过"正是恒真写法）`,
    )
  }
  assert.ok(Array.isArray(tasks) && tasks.length > 0, `★ 语料为空（${foundPath}）`)

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

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7（t5）：★★★ 「没能测量」在【契约位置】不许被读成「拒绝」—— 走真实入口
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂补的是一整类缺口：**判据全对，而读它的那一层读错了**──────────────────
 *
 * 本文件上面六条臂全部走 `GATE.gate(...)`（**判据级**）—— 它们证明的是
 * 「这条判据的三个出口是诚实且不同形的」。★ 而 t5 的实测缺口**不在这条判据里**：
 *
 *     MEASURED（t5，两次独立；`scripts/gate-task-atomicity.test.mjs` 臂 9 复现）：
 *
 *       registry.evaluate('contract', { task: { kind: 'review', objective: '…' } })
 *         ⇒ ok = false · unmeasured = YES
 *
 *   ⇒ 而 `review` 这一类**过得了契约层**（`WRITE_KINDS` 只有 implementation / repair
 *     ⇒ 它**不被要求**有 inScope）⇒ 它会真的走到契约位置 ⇒ 上一层把「我说不出」
 *     读成了「不行」⇒ **一个合法的 review 任务建不出来**。
 *
 * ★★ 而这是本队记账最久的合流：**「没能测量」并进「没通过」**。
 *   它也是 `src/tools/delivery.ts:96-100` 早就定过口径的那一条 ——
 *   "一个安全约束**不触发**时，应当放行并留下它没被检查的痕迹"。
 *
 * ── ★ 为什么这一臂必须走【工具入口】而不是直呼注册表 ──────────────────────────
 *
 * 与 `scripts/verify-unmeasured-consumers.test.mjs` 同一条纪律：
 * **直呼 `registry.evaluate` 证明不了"读它的那一层怎么读"** ——
 * 注册表本身一直是对的（它如实报了 `unmeasured`）。缺口在调用方。
 * ⇒ 本臂走 `agent_teams_create_task`，因为那才是"一个 review 任务能不能建出来"的真问题。
 *
 * ★ 而"能建出来"不是唯一要钉的：**那条事实必须仍然读得出来**（验收第 2 条）。
 *   三处出口逐处断言 —— 只钉"没被拒"会放过"静默丢掉"这个更坏的形态：
 *   **放行 + 无声** = 一条可见的缺口被换成一条看不见的缺口。那正是本队禁止的合流，
 *   只是这次它藏在"修好了一个 bug"里面。
 */

/** 一个最小但【真的】插件 ctx —— 与 `verify-unmeasured-consumers.test.mjs` 同构。 */
async function pluginFixture() {
  const workspace = mkdtempSync(join(tmpdir(), 't5-reader-'))
  cleanups.push(workspace)
  /**
   * ★ 契约要能走到 contract 位置，团队里必须先有一个可被 review 的任务
   *   （`review` 这类要求 `reviewedTaskId` 指向一个真实存在的任务）。
   */
  await createTeamDir(join(workspace, '.agent-teams'), {
    id: 'team', name: 'T5Reader', captainSessionId: 'captain-session',
    createdAt: 1, taskSeq: 1, members: [],
    tasks: [{
      id: 't1', seq: 1, subject: 'the target being reviewed', kind: 'implementation',
      status: 'completed', objective: 'x', acceptance: ['a'],
      inScope: ['src/a.ts'], verify: ['true'], createdAt: 1, updatedAt: 1, dependencies: [],
    }],
  })
  const tools = new Map()
  /** 告警是"放行时留痕"的出口之一 ⇒ 必须真的收集，而不是丢掉。 */
  const warnings = []
  const ctx = {
    logger: {
      debug() {}, info() {},
      warn(message) { warnings.push(String(message)) },
      error(message) { warnings.push(String(message)) },
    },
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
  }
  registerAgentTeamsTools(ctx, {
    stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined,
  })
  const call = async (name, args) => {
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`tool "${name}" was not registered`)
    return await tool.execute(args, {
      agent: { id: 'captain-session', status: 'idle', session: { header: { cwd: workspace }, events: [] }, steer() {} },
      signal: new AbortController().signal,
    })
  }
  return { call, warnings, workspace }
}

/**
 * 跑一次调用并把它抛出的错读回来 —— **不抛错同样是一个读数**。
 *
 * ★ t5：`error` 本体也要交出来，而不是只交一句 message。
 *   理由：结构化痕迹（`contract_unmeasured`）挂在**异常对象**上，而
 *   "只读 message"的读者会把它整条丢掉 —— 那样本臂就只能靠正则匹配措辞，
 *   分辨不出"这条痕迹真的到得了调用方"与"它只是被写进了一句话里"。
 */
async function attempt(fn) {
  try { return { threw: false, value: await fn() } } catch (error) {
    return {
      threw: true,
      error,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

test('★★★ 臂 7（t5·真实入口）：契约位置「没能测量」必须**拒绝且可分辨** —— 三种成因在工具结果上不同形', async () => {
  const fixture = await pluginFixture()
  /**
   * ── ★★★ 这一臂的形状**改过一次**，而改口的理由必须写在臂里 ─────────────────────
   *
   * 第一版断言的是"一个没有 inScope 的 `review` 任务**不该被拒**"（放行 + 留痕），
   * 依据是 `scripts/gate-task-atomicity.test.mjs` 臂 9 里那条 `ok === true`。
   *
   * ★ 而实测当场打红 `scripts/gate-position-wiring.test.mjs` 臂 2 —— 那条臂在基线上
   *   是**绿的**（26/26）且**不在** `baseline-known-failures.json` 里 ⇒ 那是回归。
   * ★★ 更硬的理由：**契约位置拒绝 unmeasured 是刻意的**。
   *   `src/gates/contract/verify-command.ts:88-97` 写死了这个口径，并指出它若放行，
   *   t17/t18 实测过的**一道永远关着的门**会被读成"没检查"而放过去：
   *   **一个判不了契约的任务不许静默进入工作。**
   *
   * ⇒ 本臂因此**换成**它真正该钉的东西（★ 而它比第一版更宽，不是更窄）：
   *
   *     ① 拒绝**保留**（那个决定是刻意的，不许被随手拆掉）
   *     ② 而拒绝必须**可分辨**：「没能测量」读起来**不许**像「发现了问题」
   *     ③ 而那条事实必须**留痕**，三处出口都要活着
   *
   * ★ 为什么这不是"把断言改软"：第一版只钉了"没被拒"这一件事，
   *   而它**完全可以**在一个"一律放行"的坏实现上通过。本版钉的三条**互相约束**：
   *   ① 与臂 8（真 blocked 仍然拒）成对，"一律放行"与"一律拒"两侧都被夹住；
   *   ② 是措辞的分辨率；③ 是"留痕"不许退化成静默。
   *   ⇒ 一个坏实现现在**没有**能同时过这三条的自由度。
   */
  const unmeasuredProbe = `t5.probe.unmeasured.${Math.random().toString(36).slice(2)}`
  registry.register({
    id: unmeasuredProbe,
    point: 'contract',
    description: 't5 probe: a contract gate that honestly cannot measure',
    gate: () => ({ ok: false, unmeasured: 'the t5 probe could not measure this contract' }),
  })
  let thrown
  try {
    const created = await attempt(() => fixture.call('agent_teams_create_task', {
      subject: 'probe: a review task with no inScope',
      kind: 'review',
      objective: 'probe: a review task with no inScope',
      acceptance: ['the contract position must keep rejecting, but legibly'],
      reviewedTaskId: 't1',
      reviewed: reviewedStamp(),
    }))
    thrown = created
  } finally {
    registry.unregister(unmeasuredProbe)
  }

  console.log(`    ℹ create_task(unmeasured 探针在场) ⇒ threw=${thrown.threw}`
    + `${thrown.threw ? ` · ${thrown.message.split('\n')[0].slice(0, 130)}` : ''}`)

  /**
   * ── ① 拒绝**保留** ──────────────────────────────────────────────────────────
   *   ★ 反向半边：这条在"放行"的实现上红。而"放行"是被裁定驳回的那一版。
   *   ★ 并指出这是**刻意**的，不是漏改：见 `verify-command.ts:88-97`。
   */
  assert.equal(
    thrown.threw, true,
    '★ 契约位置没有拒绝「没能测量」—— 而那是**刻意保留**的口径：\n'
    + '   一个判不了契约的任务不许静默进入工作（见 src/gates/contract/verify-command.ts:88-97，'
    + '   以及 t17/t18 实测过的"一道永远关着的门"）。',
  )

  /**
   * ── ② **可分辨**：「没能测量」不许读成「发现了问题」────────────────────────────
   *   ★ 这正是 `gate-position-wiring.test.mjs` 臂 2 钉的同一条性质 —— 本臂在
   *     **真实入口**上再钉一次（那条臂在别的文件、别的 ctx 上）。
   *   ★ 两种成因的**补救动作相反**（补输入面 vs 改契约）⇒ 读的人不能靠猜。
   */
  assert.match(
    thrown.message, /could not measure/,
    '★★★ 这次拒绝**没有说**"判据没能测量" —— 而它与"判据发现了问题"的补救动作相反：\n'
    + '   前者去补判据缺的那一格输入，后者去改契约。\n'
    + `   实测：${thrown.message.split('\n')[0].slice(0, 200)}`,
  )
  assert.doesNotMatch(
    thrown.message, /found problems/i,
    '★ 这次拒绝把"没能测量"说成了"发现了问题" —— 那是本队记账最久的合流（「没能测量」并进「没通过」）',
  )

  /**
   * ── ③ 三处出口都活着（★ 与 `verify-unmeasured-consumers` 同一条纪律：
   *       只有一条出口时，"没留痕"与"留了痕但没读到"同形）───────────────────────
   *
   *   ★★ 而第三处（结构化）之所以走**异常**而不是返回值：本函数在"没能测量"这一支
   *     是**抛错**的 ⇒ 抛出之后的 `return` 永远走不到 ⇒ 挂在返回值上的那份是**死**的。
   *     captain 裁定 (e)：一个永远填不上的字段要么接到抛出侧，要么删掉。
   *   ⇒ 下面断言它真的随**异常**走到了调用方（那个异常就是 `attempt` 抓到的那个）。
   */
  const unmeasuredText = contractUnmeasuredOf(thrown.error)
  assert.equal(
    typeof unmeasuredText, 'string',
    '★ 异常上没有 `contract_unmeasured` —— "判据说它测不了"在**结构化出口**上缺席。\n'
    + '   于是读的人只能去正则匹配一句英文才能分辨这到底是哪一种拒绝。\n'
    + '   ★ 而它必须挂在**异常**上：本函数在"没能测量"这一支抛错，返回值那一份永远走不到。',
  )
  assert.match(
    String(unmeasuredText), /t5 probe could not measure/,
    '★ 那条结构化痕迹里必须带着**判据的原话** —— 一句只有类型没有内容的字段，读的人无从补救',
  )
})

test('★★★ 臂 8（t5·反向半边）：契约真的报 blocked 时，仍然必须拒 —— 放行不许变成"一律放行"', async () => {
  const fixture = await pluginFixture()
  /**
   * 造一条**真的会被判 blocked** 的契约：`inScope` 里有目录条目 ⇒
   * `contract.task-atomicity` 判"不原子"（那是它的 blocked 出口，不是 unmeasured）。
   * ★ 用 `kind: 'implementation'`（`WRITE_KINDS` 之一）—— 它本来就要求 inScope/verify，
   *   于是这次拒绝**不依赖**本任务的改动，它是这条判据一直以来的正常开火。
   */
  const rejected = await attempt(() => fixture.call('agent_teams_create_task', {
    subject: 'probe: a genuinely non-atomic contract',
    kind: 'implementation',
    objective: 'split src/tools.ts and rewire the dependents',
    acceptance: ['x'],
    inScope: ['src/tools.ts', 'src/tools/', 'lib/tools/'],
    verify: ['true'],
    reviewed: reviewedStamp(),
  }))

  console.log(`    ℹ create_task(真不原子的契约) ⇒ threw=${rejected.threw}`
    + `${rejected.threw ? ` · ${rejected.message.slice(0, 130)}` : ` · task_id=${rejected.value?.task_id}`}`)

  assert.equal(
    rejected.threw, true,
    '★ 一条**真的不原子**的契约没有被拒 —— 那说明改动把"放行没能测量"做成了"一律放行"。\n'
    + '   ★ 这是本臂存在的全部理由：臂 7 单独存在时，一个"永远不拒"的实现能通过它。',
  )
  assert.match(
    rejected.message, /rejected/i,
    '★ 真拒绝的措辞里必须有 "rejected" —— 那与臂 7 放行时的 "was NOT checked" 必须不同形',
  )
  /**
   * ★ 反向半边之二：这次拒绝**不许**自称"没能测量"。
   *   `blockers` 与 `unmeasured` 是互斥的两个主张（"发现了问题" vs "我说不出"），
   *   混起来会让读的人去补一个其实不缺的输入面。
   */
  assert.doesNotMatch(
    rejected.message, /could not measure/i,
    '★ 一次真拒绝自称"没能测量" —— 两个出口合流了。补救动作相反：这条该去改契约，'
    + '而不是去补输入面。',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9（t5）：★★★ 位置归属 —— **completion 位置那一条是刻意不同的，且必须被钉住**
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 验收第 4 条：**completion 位置「unmeasured 也拒」的行为必须可证不变**────────────
 *
 * ★★ 这一条最容易被改错，所以值得把两处的**同名不同义**写清楚：
 *
 *     契约位置（本任务改的）      unmeasured ⇒ **放行** + 留痕
 *     completion 位置             unmeasured ⇒ 算进 `completionNotChecked` ⇒ **放行**
 *
 *   ⇒ 两处**恰恰是同一条口径**（"没能检查"不是"拒绝"），不是相反的。
 *     t42 早就把 completion 那一处改成了这样，并把理由写进代码：
 *
 *       MEASURED（2026-10-09，verifier 报的两个终态拒绝原文）：
 *         completed ⇒ rejected: the completion gate could not measure (…)
 *         failed    ⇒ ★ 同一条，逐字相同
 *       ⇒ 判据说"我是报告，不是拒绝"，而调用方读成了 "rejected"。
 *
 * ── ★ 那么"刻意不同"的是哪一条？── 是【dispatch 位置的 not-checked 语义】与
 *    【`blockers` 那一半】—— 而它们**都不归本任务**（见下）。
 *
 * ── ★★ 钉它的臂是哪一条（验收要求指名）────────────────────────────────────────
 *
 *     ★ `scripts/gate-update-task-unmeasured.test.mjs` 的**臂 2**
 *       （`completionNotChecked` 必须同时认 `skippedAll` 与 `unmeasured`）
 *       与**臂 4**（`blockers` 仍然拒 —— 反向半边）
 *     ★ 而 `scripts/gate-update-task-unmeasured.test.mjs` 的**臂 3** 钉"两处形状一致"
 *
 *   ⇒ 本臂**不重复**它们（重复的守卫生出两份真相）。它做的是另一件事：
 *     **把"哪一条臂钉的是哪一处"写成一份可核对的归属表**，并当场验证那份表指向的
 *     文件与臂**真的存在** —— 否则"它由别处钉住"会退化成一句主张。
 */
test('★★★ 臂 9（t5·归属表）：completion 位置的 unmeasured 语义由**哪条臂**钉住 —— 可核对，不是一句主张', async () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
  const guard = join(ROOT, 'scripts', 'gate-update-task-unmeasured.test.mjs')

  /**
   * ★ 归属表：每一条写清"哪一处语义 / 由哪个夹具的哪条臂钉住 / 判据是什么"。
   *   三条**互不重复**，因为它们钉的是三件不同的事。
   */
  const ownership = [
    {
      site: 'completion 位置：unmeasured ⇒ 算进 completionNotChecked ⇒ 放行',
      fixture: 'scripts/gate-update-task-unmeasured.test.mjs',
      arm: '★★★ 臂 2：completion 位置同样（两处同一口径）',
      why: '断言 `completionNotChecked` 的定义里认了 `unmeasured` —— 即 completion 对"测不了"的处置是放行而不是拒绝',
    },
    {
      site: 'completion 位置：blockers ⇒ 仍然拒（反向半边）',
      fixture: 'scripts/gate-update-task-unmeasured.test.mjs',
      arm: '★★★ 臂 4：`blockers` 仍然拒（那一半不许放宽）',
      why: '断言拒绝点仍存在且只在 `!completionNotChecked && ok === false` 时触发 —— 缺了它，一个"一律放过"的实现照样绿',
    },
    {
      site: 'dispatch 与 completion 两处的口径必须一致（只改一处会分叉）',
      fixture: 'scripts/gate-update-task-unmeasured.test.mjs',
      arm: '★★★ 臂 3：两处的定义【形状一致】',
      why: '取出两处的定义比较"认了哪几种成因"—— 分叉后「哪一处放行」在日志里同形',
    },
  ]

  /** ★ 前置：那份夹具必须**真的在盘上** —— 否则归属表指着一个不存在的守卫。 */
  assert.ok(
    existsSync(guard),
    `★ 归属表指向 ${'scripts/gate-update-task-unmeasured.test.mjs'}，而它不存在 ⇒ "由别处钉住"是一句空话`,
  )
  const guardSource = readFileSync(guard, 'utf8')
  for (const entry of ownership) {
    assert.ok(
      guardSource.includes(entry.arm),
      `★ 归属表里这条臂在 ${entry.fixture} 里找不到：${entry.arm}\n`
      + '   ★ 一条被改名/删掉的臂会让"它由别处钉住"变成一句**无法复核的主张** —— '
      + '而本队对归属的纪律是：**能指出来源才算数**。',
    )
  }
  for (const entry of ownership) console.log(`    ℹ ${entry.arm} → ${entry.fixture}`)

  /**
   * ★★ 并**当场独立复核** completion 那一处的口径（不采信上面那张表）：
   *   读源码里 `completionNotChecked` 的定义，断言它认 `unmeasured` 且**不认** `blockers`。
   *   ★ 读的是**定义本身**，不是整个文件 —— 文件里别处提到 `blockers` 不构成本条的读数。
   */
  const updateTaskSource = readFileSync(join(ROOT, 'src', 'tools', 'update-task.ts'), 'utf8')
  const definition = /const completionNotChecked = ([\s\S]{0,300}?\)\n)/.exec(updateTaskSource)
  assert.ok(definition !== null, '★ 找不到 `completionNotChecked` 的定义 —— 归属表里那三条臂钉的东西不在原位了')
  assert.match(
    definition[1], /unmeasured !== undefined/,
    '★★★ completion 位置不再把 `unmeasured` 算作"没能检查" ⇒ 它**开始拒绝**"测不了"的完工报告。\n'
    + '   ★ 那是 t42 明确修掉的形态（"判据说我是报告不是拒绝，而调用方读成 refused"），'
    + '     ⇒ 本任务对契约位置的改动**不许**把它顺手翻回去。',
  )
  assert.doesNotMatch(
    definition[1], /blockers/,
    '★ `blockers` 被算进了 `completionNotChecked` ⇒ 一次**真实的问题发现**被读成"没能检查"而放行。\n'
    + '   ★ 那一半是刻意保留的（臂 4 钉住它），不许因为本任务而放宽。',
  )
})
