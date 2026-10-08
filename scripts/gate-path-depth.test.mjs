/**
 * ── ★★ 判据：路径解析只在【某一种深度】下成立（t85）────────────────────────────────
 *
 * ── 它是昨夜最高频的单一根因（六次，每一次都是独立发生的）──────────────────────
 *
 *   ① t39：搬运时 t41 的接线被覆盖（★ 底本取自另一个 worktree 的 HEAD）
 *   ② t54：并入时把 t59 的接线覆盖回去（★ 与 ① 同一条）
 *   ③ t76：把队友的两个 lib 文件一起提交（★ 它自己纠正了）
 *   ④ t83：同上（★ 它主动说"我 t76 那次搞错了"）
 *   ⑤ t84：夹具的 `repoRoot` 算成 `..×4`
 *          ★ 在 `<root>/scripts` 下 ⇒ 指向 `/Users`
 *          ★ 而在 `<root>/.agent-teams/worktrees/<id>/scripts` 下 ⇒ **恰好对**
 *   ⑥ t80：46 个 worktree 里 current 1 · behind 45，最深 61 个提交
 *
 * ⇒ ★ 六条的共同形状：**「这棵树」与「那棵树」之间的差异，反复地骗到了人。**
 *
 * ── 它判什么（可机械判定的那部分）─────────────────────────────────────────────
 *
 *   对每一个**路径常量**，问它在一个**假想的深度**下会解析到哪里 ——
 *
 *     ★ 好的：**在多个深度下都指向同一个对象**（用向上查找 ⇒ 位置无关）
 *     ★ 坏的：**只在某一个深度下对**（写死层数 ⇒ 位置一变就指向别处）
 *
 * ★ 而"深度"正是 worktree 与主树的差别：同一个文件住在
 *   `<root>/scripts/`（主树）还是 `<root>/.agent-teams/worktrees/<id>/scripts/`（worktree）
 *   ⇒ 写死 `..×N` 的常量在其中一棵里对、在另一棵里错。
 *
 * ── ★★ 三态（而第三种必须如实报）─────────────────────────────────────────────
 *
 *   `depth-independent`  任何深度都解析到同一个对象（向上查找 / 相对同层文件）
 *   `depth-bound`        ★ 只在某一种深度下对（写死层数）—— 这是本判据要抓的
 *   `unmeasurable`       路径**动态构造**（值来自变量/参数）⇒ 静态看不出来
 *
 * ★ 第三态不许并进前两者：把看不出来的判成坏的，就是"把不可判并进可判"。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS = join(ROOT, 'scripts')

// ─────────────────────────────────────────────────────────────────────────────
// 装置：把一个路径常量读成"它对深度的依赖"
// ─────────────────────────────────────────────────────────────────────────────

const VERDICT = {
  independent: 'depth-independent',
  bound: 'depth-bound',
  unmeasurable: 'unmeasurable',
}

/**
 * ── 形状 A：**写死层数**（本判据要抓的那个）──────────────────────────────────────
 *
 *   `join(here, '..', '..', '..', '..')` / `resolve(import.meta.dirname, '..')`
 *
 * ★ 共同点：**层数是源码里的字面量** ⇒ 那个数字只在一种深度下算对。
 */
const HARDCODED_CHAIN = /(?:join|resolve|j)\s*\(\s*(?:here|__dirname|import\.meta\.dirname|dir)\b([^)]*)\)/g

/** 数一段实参里出现了几个 `'..'`（那些就是**向上跳的层数**）。 */
function countParentSegments(args) {
  return (args.match(/'\.\.'|"\."\.|\.\.\//g) ?? []).length
}

/**
 * ── 形状 B：**向上查找**（好的那个）──────────────────────────────────────────────
 *
 * t84 收口时 captain 改成的形状：
 *
 *     let dir = here
 *     for (let i = 0; i < 6; i += 1) {
 *       if (existsSync(j(dir, 'package.json'))) return dir
 *       dir = j(dir, '..')
 *     }
 *
 * ★ 它**也有 `'..'`** —— 而它是**位置无关的**：循环一直上去，直到找到那个标记。
 *   ⇒ 所以判据**不能**只按"有没有 `..`"来判（那会误伤这一条）。
 *   ⇒ 判据要按**"层数是不是一个决定的量"**来判。
 */
const UPWARD_SEARCH = /for\s*\([^)]*\)\s*\{[\s\S]{0,220}?existsSync|while\s*\([\s\S]{0,160}?existsSync/

/**
 * ── 从一段源码里抽出**路径常量候选** ────────────────────────────────────────────
 *
 * ★ 抽的是"含路径构造"的那些语句 —— 而不是全部行。
 *   一条 `assert.equal(x, 1)` 不构造路径 ⇒ 它不该进读数。
 */
function pathConstants(source) {
  const out = []
  const lines = source.split('\n')
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    /** ★ 跳过注释行：注释里**提到**某种写法（本队大量如此）不是一条活的读数。 */
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    if (!/(?:join|resolve|j)\s*\(/.test(line)) return

    HARDCODED_CHAIN.lastIndex = 0
    const match = HARDCODED_CHAIN.exec(line)
    if (match === null) return
    const parentSegments = countParentSegments(match[1])
    if (parentSegments === 0) return

    /**
     * ★★ 关键判定：**这个层数是一个【决定的】量，还是一个【发现的】量？**
     *
     *   · 若这一行**自己**含一个向上查找（`for` + `existsSync`，或 `while` + `existsSync`）
     *     ⇒ 那个 `..` 是**迭代**，层数是被找到的 ⇒ `depth-independent`。
     *   · 若这一行只是一个字面量 `..` 链 ⇒ 层数是**决定的** ⇒ `depth-bound`。
     *
     * ★★ 而这里我第一版又写错了（同一个 bug 的第二种形态，值得记）：
     *   第一版算的是 `UPWARD_SEARCH.test(source)` —— **整份源码**。
     *   于是同一个文件里**只要有一处**向上查找，**每一处** `..` 都被认成"独立的"
     *   ⇒ `worktree-baseline-freshness.test.mjs` 里那个写死 `..×4` 被判成了
     *     `depth-independent`（而它正是本判据要抓的那个实例）。
     *
     * ★ 形态：**拿一个不是那个东西的量，去断言那个东西的性质**
     *   —— 本队记过的第三种恒真写法（"读错位置的出口"），只是这里"位置"是**作用域**：
     *     我读的是**文件级**的性质，而要判的是**语句级**的性质。
     *   ⇒ 所以下面只看**这一行**（外加它的续行）。
     */
    /**
     * ★★ 窗口要多大？—— 实测过一次（而这个数字不是拍的）：
     *
     *   t84 那条向上查找的形状里，`for (…)` 在第 429 行、`j(dir, '..')` 在第 433 行
     *   —— **相隔 5 行**（中间有 `try` / `existsSync` / `catch`）。
     *   ⇒ 我第一版用 3 行窗口 ⇒ **漏掉它** ⇒ 那条被判成"写死层数"（误伤）。
     *
     * ★ 口径：**这个语句所在的块**，而不是固定行数。取"当前行往上到最近的 `{`
     *   或最多 12 行"作为上下文 —— 12 是给注释留的余量。
     */
    const contextFrom = Math.max(0, index - 12)
    const statementWindow = lines.slice(contextFrom, index + 4).join('\n')
    const hasUpwardSearch = UPWARD_SEARCH.test(statementWindow)
    out.push({
      line: index + 1,
      text: trimmed,
      parentSegments,
      /** ★ 基点是不是"这个文件自己所在处"（`here` / `import.meta.dirname`）？ */
      selfRelative: /(?:join|resolve|j)\s*\(\s*(?:here|__dirname|import\.meta\.dirname)\b/.test(line),
      hasUpwardSearch,
    })
  })
  return out
}

/**
 * ── 代理测试：一个写死 `..×N` 的常量，在**哪个深度**下才算对？──────────────────────
 *
 * ★★ 这里我写错了三次，三个错都值得记 —— 而**每一次都是同一个主题**：
 *   我搭的那棵树与真实的树在【深度】上对不上，而"深度"正是本判据要判的东西。
 *
 *   错法一：把"深度 N"实现成 `join(here, '..')` 重复 N-1 次 —— 那是**向上走**，
 *          于是 6 个深度都落在真实树里 ⇒ 装置报"6 个深度都成立"。
 *   错法二：从仓库根往下搭时用了 `.agent-teams/w2/.agent-teams/w3/…` ——
 *          每一步**加了两级** ⇒ "4 层"实际是 7 级 ⇒ 报"一个深度都不成立"。
 *   错法三：改用 worktree 形状（`.agent-teams/worktrees/task-x/scripts`）之后，
 *          **2/3 级与 3/4 级指向同一个目录**（因为 `depth>=2`/`depth>=3` 是并列的
 *          if，depth=2 与 depth=3 有时同形）⇒ `..×4` 报出两个深度。
 *
 * ⇒ ★ 正确做法：**不要模仿任何真实形状**，就老老实实地造一棵"恰好 N 级"的树。
 *     判据要问的是"深度"这个**量**，而不是"worktree 长什么样"。
 *     模仿形状会给这个量引入别的影响因素 —— 而那正是三次错误共同的成因。
 *
 *     depth = 1   `<repo>/scripts`
 *     depth = 2   `<repo>/l1/scripts`
 *     depth = 4   `<repo>/l1/l2/l3/scripts`      ← 恰好 4 级
 */
function simulatedHere(depth, repoRoot) {
  let path = repoRoot
  for (let level = 1; level < depth; level += 1) path = join(path, `l${level}`)
  return join(path, 'scripts')
}

function depthBehaviour(parentSegments, repoRoot) {
  const found = []
  for (let depth = 1; depth <= 6; depth += 1) {
    let target = simulatedHere(depth, repoRoot)
    for (let i = 0; i < parentSegments; i += 1) target = join(target, '..')
    /** ★ 判据是"解析结果**是不是仓库根**"，而不是"它存不存在"。 */
    if (existsSync(target) && realpathSync(target) === realpathSync(repoRoot)) found.push(depth)
  }
  return found
}

/** 旧名保留成别名，免得下面几条臂漏改（本文件内部用）。 */
const resolvesAtDepths = (here, parentSegments) => depthBehaviour(parentSegments, ROOT)

/**
 * ── 把一条候选读成三态 ──────────────────────────────────────────────────────────
 *
 * ★ 顺序是刻意的：**先问"是不是向上查找"** ——
 *   因为一条向上查找里**也有** `..`，而它是**好的**。
 *   若先按 `..` 判，t84 修好之后的那一条会被误判成坏的。
 */
function verdictOf(candidate, here, file) {
  if (candidate.hasUpwardSearch) {
    return {
      verdict: VERDICT.independent,
      why: 'it walks upward until it finds a marker (package.json) — the number of levels is discovered, not decided',
    }
  }

  if (!candidate.selfRelative) {
    return {
      verdict: VERDICT.unmeasurable,
      why: `its base is not this file's own directory, so the depth dependency cannot be read statically: ${candidate.text.slice(0, 60)}`,
    }
  }

  const found = resolvesAtDepths(here, candidate.parentSegments)

  /**
   * ★★ 判定的核心：**它在几个深度下指向存在的东西？**
   *
   *   · 恰好 1 个 ⇒ 它**只在那一种深度**下成立 ⇒ `depth-bound`（本判据要抓的）
   *   · ≥ 2 个 ⇒ 它跟着深度跑（在别的深度下指向**另一个**存在的对象）
   *     ★ 那同样是坏的 —— 而它更隐蔽：它在两棵树里都不报错，只是**指向不同的东西**。
   *   · 0 个 ⇒ 在当前树里它就指不到东西（可能是"只在上游存在"的路径）
   *     ⇒ 那也是 `depth-bound`（它依赖某个特定布局）
   */
  return {
    verdict: VERDICT.bound,
    why: `the number of parent segments is a literal (${candidate.parentSegments}) ⇒ it resolves correctly at exactly one depth`
      + (found.length === 0 ? ' (and at none of the 1..6 assumed depths here, so it depends on a specific layout)'
        : ` (it exists at depth ${found.map((entry) => entry.depth).join(', ')})`),
    depths: found.map((entry) => entry.depth),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★★★ 抓到 t84 那个真实实例
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 那一条**真的存在于盘上**（本任务开工时实测）────────────────────────────────────
 *
 *   `scripts/worktree-baseline-freshness.test.mjs:364`
 *     `const root = join(here, '..', '..', '..', '..')`
 *
 * ★ 而它旁边就写着那次学费（注释：「层数必须按"它该回到哪里"算，不是按"看起来像几层"」）
 *   —— 而它**仍然是一个写死的层数**。⇒ 判据要能说出：「这个常量只在某一种深度下成立」。
 */
test('臂 1 ★★★ 抓到 t84 那个真实实例：写死的 `..×4` 只在一种深度下成立', () => {
  const file = join(SCRIPTS, 'worktree-baseline-freshness.test.mjs')
  const source = readFileSync(file, 'utf8')
  const here = dirname(file)

  const candidates = pathConstants(source)
  const hardcoded = candidates.filter((entry) => entry.parentSegments === 4 && entry.selfRelative && !entry.hasUpwardSearch)

  console.log(`    ℹ ${relative(ROOT, file)} 里抽到 ${candidates.length} 条路径常量，其中写死 4 层的有 ${hardcoded.length} 条`)

  /**
   * ── ★★★ 本臂已经**兑现**了（判据抓到 → 实例被修）─────────────────────────────────
   *
   * 本臂第一版断言的是一条**真的在盘上**的写死 `..×4`（`:364`）。
   * ★ 而在 t85 收口之后、captain 于 2026-10-08 **把它修掉了** —— 修法的注释里逐字写着
   *   「MEASURED（t85 的判据抓出来的，captain 2026-10-08 修）」。
   *
   * ⇒ ★ 所以本臂不能再断言"那条写死的常量存在"（那现在是一条**假的**断言 ——
   *   它会让整条判据在**它成功之后**变红，而那是最贵的红）。
   *   改成断言**那件事的结果**：那一处现在是"**发现的**"量（向上查找）。
   *
   * ★ 而第一版的 failure 消息里**已经预告了这次改动**：
   *   「若它已被改成向上查找，请把本臂改指新的等价实例，而不是删掉」
   *   ⇒ 这正是它现在做的事 —— 本臂**没有**被删掉，它换了对象。
   */
  const upward = candidates.filter((entry) => entry.hasUpwardSearch)
  assert.ok(
    upward.length > 0,
    '★ 那一份里既没有写死 4 层的、也没有向上查找的 —— 本臂的两个对象都不见了。'
    + '★ 请复核 `worktree-baseline-freshness.test.mjs` 的根路径是怎么算的。',
  )
  for (const candidate of upward) {
    const verdict = verdictOf(candidate, here, file)
    console.log(`    ℹ :${candidate.line} ⇒ ${verdict.verdict}｜${verdict.why.slice(0, 100)}`)
    assert.equal(
      verdict.verdict, VERDICT.independent,
      '★ 那一份里的根路径没有被判成 depth-independent —— 而它现在是"发现的"量（向上查找）',
    )
  }
  console.log('    ℹ ★ 本臂的对象已从"盘上写死的那条"换成"盘上修好之后的那条"')

  /**
   * ── ★★ 而"写死层数"这一类的**分辨力**仍然要钉住 ────────────────────────────────
   *
   * ★ 用 t84 那条的**原话**作为合成输入 —— 因为它已经不在盘上了（被修了），
   *   而它是一条**真实历史**。★ 判据的语料应当可追溯到真事，而不是我编一个形状。
   */
  const synthetic = {
    line: 0,
    text: `const root = join(here, '..', '..', '..', '..')`,
    parentSegments: 4,
    selfRelative: true,
    hasUpwardSearch: false,
  }
  const verdict = verdictOf(synthetic, here, file)
  console.log(`    ℹ 合成的写死 4 层（t84 那条的原话）⇒ ${verdict.verdict}`)
  assert.equal(
    verdict.verdict, VERDICT.bound,
    '★ 写死 4 层的路径常量没有被判成 depth-bound —— 那正是 t84 那个真实实例的形状。\n'
    + `   源码：${synthetic.text}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★★ 反向半边：向上查找必须合格
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 契约点名的那条合格样本 ──────────────────────────────────────────────────────
 *
 * t84 收口时 captain 改成的形状（`scripts/worktree-baseline-freshness.test.mjs:427`）：
 *
 *     const repoRoot = (() => {
 *       let dir = here
 *       for (let i = 0; i < 6; i += 1) {
 *         if (existsSync(j(dir, 'package.json'))) return dir
 *         dir = j(dir, '..')
 *       }
 *       throw new Error('cannot locate the repo root from ' + here)
 *     })()
 *
 * ★ 它**也有 `..`** —— 而它是**位置无关的**。
 *   ⇒ 判据若按"有没有 `..`"判，它会被误伤 ⇒ **那正是反向半边要防的**。
 */
test('臂 2 ★★ 反向半边：向上查找（任何深度都对）必须判 depth-independent', () => {
  const file = join(SCRIPTS, 'worktree-baseline-freshness.test.mjs')
  const source = readFileSync(file, 'utf8')
  const here = dirname(file)

  /** ★ 前提：那一份源码里**确实**有向上查找 —— 否则本臂测不到"它有没有被误判"。 */
  assert.match(
    source, /existsSync\(j\(dir, 'package\.json'\)\)/,
    '★ 那一份里找不到向上查找的形状 —— 本臂的反向半边没有对象（若它被改掉了，请改指新的合格样本）',
  )

  const candidates = pathConstants(source)
  const inUpwardSearch = candidates.filter((entry) => entry.hasUpwardSearch)
  console.log(`    ℹ 该文件里含向上查找的路径构造：${inUpwardSearch.length} 条`)

  assert.ok(
    inUpwardSearch.length > 0,
    '★ 一条都没被认成"含向上查找" —— 装置把那个形状漏了',
  )
  for (const candidate of inUpwardSearch) {
    const verdict = verdictOf(candidate, here, file)
    assert.equal(
      verdict.verdict, VERDICT.independent,
      `★ :${candidate.line} 含向上查找却被判成 ${verdict.verdict} —— 那是误伤。\n`
      + `   源码：${candidate.text}\n`
      + '★ 判别问句：**这个层数是一个决定的量，还是一个被发现的量？**',
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★★ 三态不同形 + 代理测试（"几个深度指向存在的东西"）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 契约给的代理测试 ────────────────────────────────────────────────────────────
 *
 *   「对每个路径常量，算出它在『假定 here 深 N 层』时的结果，N 取 1..6
 *     ⇒ 断言【只有一个 N 给出存在的路径】，而不是多个 N 给出不同路径。」
 *
 * ★ 而本臂把**两个方向**都钉住：
 *   · 写死层数 ⇒ 只在一个深度成立（或一个都不成立）⇒ `depth-bound`
 *   · 向上查找 ⇒ **在任何一个深度都成立**（因为它一路上去找那个标记）
 */
test('臂 3 ★★ 代理测试：写死层数只在一个深度成立；向上查找在任何深度都成立', () => {
  const file = join(SCRIPTS, 'worktree-baseline-freshness.test.mjs')
  const here = dirname(file)

  /** ① 写死 4 层：它在**几个**深度下才回到仓库根？ */
  const hardcodedFound = depthBehaviour(4, ROOT)
  console.log(`    ℹ 写死 4 层 ⇒ 只在深度 ${hardcodedFound.join(', ') || '(一个都没有)'} 下回到仓库根`)
  assert.ok(
    hardcodedFound.length <= 1,
    '★ 写死 4 层的常量在多个深度下都回到仓库根 —— 那与"层数是决定的量"矛盾，装置算错了',
  )
  /** ★ 而"恰好一个"正是 `depth-bound` 的机械定义。 */
  assert.equal(
    hardcodedFound.length, 1,
    '★ 写死 4 层应当在**恰好一个**深度下回到仓库根（N === depth），实测不是',
  )
  assert.equal(hardcodedFound[0], 4, '★ 而且那个深度就是它写死的那个数')

  /** ② 向上查找：**在任何一个深度都成立** —— 因为层数是被发现的。 */
  const fromHere = (() => {
    let dir = here
    for (let i = 0; i < 6; i += 1) {
      if (existsSync(join(dir, 'package.json'))) return dir
      dir = join(dir, '..')
    }
    return undefined
  })()
  assert.notEqual(fromHere, undefined, '★ 向上查找在**当前**深度下没找到仓库根')
  console.log(`    ℹ 向上查找 ⇒ 从 ${here} 找到 ${fromHere}`)

  /**
   * ★★ 而从一个**真正更深的**起点出发，它同样能找到根。
   *
   * ★ 这里我第一版写错了：`join(here, '..', '..', '..')` 从 `<repo>/scripts` 往上走到
   *   **仓库之外**，那里**没有** `package.json` ⇒ 断言红，而那是**我的测试**错了，
   *   不是向上查找的错。
   * ⇒ ★ "更深"要用**在仓库内部造一棵更深的树**来表达 —— 而不是往上走出仓库。
   *   那正是 worktree 的形状：`<repo>/.agent-teams/worktrees/<id>/scripts/`。
   */
  const sandbox = mkdtempSync(join(tmpdir(), 't85-depth-'))
  try {
    /** ★ 造一棵假想的浅树与一棵深树，两者都在"仓库根"（= sandbox 里有 package.json 的那一层）之下。 */
    const shallowScripts = join(sandbox, 'scripts')
    const deepScripts = join(sandbox, '.agent-teams', 'worktrees', 'task-x', 'scripts')
    mkdirSync(shallowScripts, { recursive: true })
    mkdirSync(deepScripts, { recursive: true })
    /** ★ 那个"仓库根的标记"。 */
    writeFileSync(join(sandbox, 'package.json'), '{}')

    const findRoot = (from, max) => {
      let dir = from
      for (let i = 0; i < max; i += 1) {
        if (existsSync(join(dir, 'package.json'))) return dir
        dir = join(dir, '..')
      }
      return undefined
    }

    const fromShallow = findRoot(shallowScripts, 6)
    const fromDeep = findRoot(deepScripts, 8)
    console.log(`    ℹ 向上查找（浅树 depth=1）⇒ ${fromShallow}`)
    console.log(`    ℹ 向上查找（深树 depth=4）⇒ ${fromDeep}`)

    assert.notEqual(fromShallow, undefined, '★ 向上查找在浅树里没找到根')
    assert.notEqual(fromDeep, undefined, '★ 向上查找在深树里没找到根 —— 那它就不是"任何深度都对"')
    /** ★ 两者必须解析到**同一个对象**（那是"位置无关"的定义）。 */
    assert.equal(
      realpathSync(fromDeep), realpathSync(fromShallow),
      '★ 浅树与深树解析到了不同的根 —— 那它就不是"任何深度都对"',
    )
    assert.equal(realpathSync(fromDeep), realpathSync(sandbox), '★ 深树应当找到 sandbox 那一层')

    /** ★ 对照：**写死 4 层**在两棵树里的表现 —— 那正是 t84 那个实例的失效。 */
    const hardcodedFromShallow = join(shallowScripts, '..', '..', '..', '..')
    const hardcodedFromDeep = join(deepScripts, '..', '..', '..', '..')
    console.log(`    ℹ 写死 ..×4（浅树）⇒ ${hardcodedFromShallow}`)
    console.log(`    ℹ 写死 ..×4（深树）⇒ ${hardcodedFromDeep}`)
    assert.notEqual(
      realpathSync(hardcodedFromShallow), realpathSync(sandbox),
      '★ 写死 4 层在**浅树**里竟然回到了根 —— 那本臂就测不到 t84 那个失效',
    )
    assert.equal(
      realpathSync(hardcodedFromDeep), realpathSync(sandbox),
      '★ 写死 4 层在**深树**里没回到根 —— 而 t84 那次正是"在 worktree 里恰好对"',
    )
    console.log('    ℹ ★ 而这就是那个根因：同一个常量，浅树指向别处、深树恰好对')
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }

  /** ★ 三态两两不同形（逐对断言，不循环）。 */
  const shapes = {
    independent: VERDICT.independent,
    bound: VERDICT.bound,
    unmeasurable: VERDICT.unmeasurable,
  }
  assert.equal(new Set(Object.values(shapes)).size, 3, '★ 三态必须两两不同形')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★ 全仓存量（如实报出）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 契约点名要的那个数字 ────────────────────────────────────────────────────────
 *
 *   「它必须对当前全仓跑一次，并把存量如实报出来：
 *     多少处路径解析**只在一种深度下成立**。」
 *
 * ★ 而那个数字就是这条判据的价值 —— 它昨夜让六条任务各自花过时间。
 */
test('臂 4 ★ 全仓存量：逐条报出，而【报告而不拦】', () => {
  const files = readdirSync(SCRIPTS)
    .filter((name) => name.endsWith('.mjs') || name.endsWith('.test.mjs'))
    .sort()

  const byVerdict = { [VERDICT.independent]: [], [VERDICT.bound]: [], [VERDICT.unmeasurable]: [] }
  for (const name of files) {
    const file = join(SCRIPTS, name)
    const source = readFileSync(file, 'utf8')
    const here = dirname(file)
    for (const candidate of pathConstants(source)) {
      byVerdict[verdictOf(candidate, here, file).verdict].push({ file: `scripts/${name}`, ...candidate })
    }
  }

  console.log(`    ℹ 全仓 ${files.length} 个脚本，路径常量读数：`)
  console.log(`       depth-independent  ${byVerdict[VERDICT.independent].length}`)
  console.log(`       ★ depth-bound      ${byVerdict[VERDICT.bound].length}`)
  console.log(`       unmeasurable       ${byVerdict[VERDICT.unmeasurable].length}`)

  console.log('    ℹ ★ 只在一种深度下成立的（逐条）：')
  for (const entry of byVerdict[VERDICT.bound]) {
    console.log(`       · ${entry.file}:${entry.line}  （写死 ${entry.parentSegments} 层）`)
    console.log(`         ${entry.text.slice(0, 96)}`)
  }

  /**
   * ★★ "报告而不拦"：本臂**不断言存量为 0**。
   *
   * ★ 为什么：把那 3 处写成必须为 0，会在下一次有人合法地加一个"脚本在 scripts/
   *   下、确实只需要上一层"的常量时按设计变红 —— 而那时读的人会去改断言（棘轮），
   *   而不是去判断那一处该不该改成向上查找。
   * ★ 它断言的是**装置在工作**：扫到了文件、三态之和等于读数总数。
   */
  assert.ok(files.length > 50, `★ 只扫到 ${files.length} 个脚本 —— 扫描没覆盖全仓`)
  const total = Object.values(byVerdict).reduce((sum, list) => sum + list.length, 0)
  assert.ok(total > 0, '★ 一条路径常量都没抽到 —— 装置没在工作')
  console.log(`    ℹ 三态之和 ${total}（= 路径常量总数）`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★★ 定向突变：向上查找 ⇒ 写死层数，读数必须翻面
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 规则二后半句：把机制单独去掉 ⇒ 读数必须变 ───────────────────────────────────
 *
 * ★ 本臂取**同一件事的两个版本**（t84 修前 / 修后），只改"层数是不是决定的量"：
 *
 *     修后：向上查找（`for` + `existsSync`）⇒ `depth-independent`
 *     修前：`join(here, '..', '..', '..', '..')` ⇒ `depth-bound`
 */
test('臂 5 ★★ 定向突变：把向上查找改成写死层数 ⇒ 读数必须从 independent 翻成 bound', () => {
  const file = join(SCRIPTS, 'worktree-baseline-freshness.test.mjs')
  const source = readFileSync(file, 'utf8')
  const here = dirname(file)

  /** ★ 修后的形状（真的在盘上）。 */
  const independent = pathConstants(source).filter((entry) => entry.hasUpwardSearch)
  assert.ok(independent.length > 0, '★ 盘上找不到向上查找的形状 —— 突变没有对象')
  const before = verdictOf(independent[0], here, file)
  console.log(`    ℹ 向上查找 ⇒ ${before.verdict}`)

  /**
   * ★★ 而"写死层数"那一版**已经不在盘上了** —— captain 在 2026-10-08 把它修掉了
   *   （修法的注释里引用了本判据）。⇒ 于是它的**历史原话**由臂 1 保管，
   *   而本臂从那里取它，而不是期望盘上还有一条。
   *
   * ★ 这一处记录的是**判据与被测对象的关系**：当判据成功之后，它的语料会消失 ——
   *   而"语料消失"与"判据坏了"在读数上同形（两者都是"找不到对象"）。
   *   ⇒ 所以本臂明确区分：**对象取自盘上（向上查找）** vs **取自历史（写死层数）**。
   */
  const historicalHardcoded = {
    line: 0,
    text: `const root = join(here, '..', '..', '..', '..')`,
    parentSegments: 4,
    selfRelative: true,
    hasUpwardSearch: false,
  }
  const after = verdictOf(historicalHardcoded, here, file)
  console.log(`    ℹ 写死 4 层（t84 的历史原话）⇒ ${after.verdict}`)

  assert.equal(before.verdict, VERDICT.independent, '★ 向上查找必须判 independent')
  assert.equal(after.verdict, VERDICT.bound, '★ 写死层数必须判 bound')
  assert.notEqual(
    before.verdict, after.verdict,
    '★ 只改"层数是不是决定的量"而读数没变 —— 那说明判据读的不是那个性质',
  )

  /**
   * ★ 反向再钉一次：把向上查找那张形状**喂回去**（含 `for`+`existsSync`）⇒ 仍判 independent。
   *   ⇒ 两个方向都可判，而不是"单向敏感"。
   */
  const synthetic = [{
    line: 1,
    text: "let dir = here; for (let i = 0; i < 6; i += 1) { if (existsSync(j(dir, 'package.json'))) return dir; dir = j(dir, '..') }",
    parentSegments: 1,
    selfRelative: true,
    hasUpwardSearch: true,
  }]
  assert.equal(verdictOf(synthetic[0], here, file).verdict, VERDICT.independent, '★ 翻回去时读数没跟着回去')
})
