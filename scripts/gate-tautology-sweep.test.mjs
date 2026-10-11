/**
 * ── t25：**不能失败的断言**的全仓普查（并让这个形状可以被重新发现）────────────────
 *
 * ── 它防的是什么（MEASURED：本轮同一个形状栽了三次）────────────────────────────
 *
 * 用户那句话是本任务的全部依据：**「一个在场的、却什么都没断言的读数」**。
 * 本轮它在**三个**不同的地方现形：
 *
 *   ① `scripts/gate-backtest.test.mjs` 原第 300 行
 *        `assert.ok(Object.keys(accepted.outputs ?? {}).length === 0 || true)`
 *   ② `scripts/gate-contract-build-artifacts.test.mjs` 原第 89 行
 *        `assert.ok(buildRegistry().list().contract.some((e) => e.id === id) || true)`
 *   ③ （t22 的夹具里，作者自己写的一臂）
 *        `assert.ok(outcome === 'allowed' || requirement.missing.length > 0)`
 *
 * ★★ 三者的共同形状：**`|| true` / `|| …恒真…` 把断言变成了一句陈述**。
 *   它**在场**、**读起来像一条检查**、而**两种实现都通过** ——
 *   ⇒ 与"没有这一行"在观测上完全相同。
 *
 * ★★★ 而 ③ 的代价是**具体**的，不是理论的：那一臂覆盖的是一个**真实的、当时还开着**的
 *   缺陷（`kind` 缺席 + 契约全空的任务被放行且留在可认领状态）。它因为恒真而**没报**，
 *   于是那个缺陷**活到了下一个任务**才被抓到。
 *
 * ── 本文件的两件事 ──────────────────────────────────────────────────────────────
 *
 *   ① **普查**：把全仓的 `assert.*` 扫一遍，找出"无论实现对错都通过"的那些
 *   ② **可证伪**：本普查自己也要能被打红（见臂 3 的定向突变与臂 4 的探针），
 *      否则它就是**它自己要抓的那个东西**的又一个实例
 *
 * ── ★★ 为什么"扫描器可能恒绿"是这里最要紧的一条 ─────────────────────────────────
 *
 * 一个扫描器如果**一个文件都没扫到**，它的结论是"零命中" —— 而"零命中"正是它期望的结果。
 * ⇒ **"扫到了但都是干净的"与"根本没扫到东西"完全同形。**
 *   本仓为此已经栽过：t24 的搬迁臂第一版 `REPO_ROOT` 少算一层，
 *   扫了一个**不存在**的目录，于是"零命中"让它**假绿**。
 * ⇒ 所以下面**每一条读数都带计数**，并且臂 4 用一段**故意含恒真**的文本证明它真的会命中。
 *
 * Run: node --test scripts/gate-tautology-sweep.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS = join(ROOT, 'scripts')

/**
 * ── 恒真的尾巴 ──────────────────────────────────────────────────────────────────
 *
 * ★ 口径**窄**是刻意的：一个宽的判据会误报，而**误报会教人忽略门禁**（与漏报同样有害）。
 *   ⇒ 只认这几种**机械上确定**恒真的写法。
 */
const TAUTOLOGY_TAILS = [
  /\|\|\s*true\b/,
  /&&\s*false\b/,
  /\|\|\s*1\b/,
  /\|\|\s*'[^']*'/,      // || 'anything'  —— 非空字符串恒真
  /\|\|\s*"[^"]*"/,
]

/**
 * 一个**已经剥掉注释与字符串**的源码行 —— 否则本普查会在它自己的说明文字上开火。
 *
 * ★ 本仓反复记账的形态：**描述一条纪律的文字**被当成了**违反那条纪律的证据**
 *   （`gate-tool-split` 臂 3 与 `gate-shared-artifact-writes` 都栽过同一格）。
 * ★★ 而 `|| true` 这个词组在本文件里**必须**出现在字符串与注释里（它是语料），
 *   所以剥得干净是**本普查能不能成立**的前提。
 */
function stripCommentsAndStrings(text) {
  return text
    /**
     * ── ★★★ 块注释要**保住换行**（t25 实测的第二个缺陷）────────────────────────────
     *
     * MEASURED：第一版把块注释整段换成空串 —— 而一个跨 780 行的块注释**吞掉了它所有的换行**
     * （实测 `gate-readout-uniform.test.mjs`：1640 行 → 860 行）。
     * ⇒ 于是**行号全部错位**：植入一条真断言之后，扫描器报出来的是一个**注释行**
     *   （形如 `777: *   那时 dispatch 的结论…`）。
     * ★★ 检测本身是对的（它确实命中了那一行代码），**错的是"报哪一行"** ——
     *   而一个报错行号的门禁会让读的人去改一个**没问题的地方**，
     *   那比不报更坏（本队那条：**一个错误的措辞让人去做另一件事**）。
     * ⇒ 修法：把块注释里的每个字符换成**空格以外的等量占位**，但**保留 `\n`**。
     */
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    /**
     * ★ t25 实测的**第四个**缺陷：`\s*` 会吃掉**前面的换行**。
     *   MEASURED：`/^\s*\/\/.*$/gm` 在这种输入上匹配到了 `"\\n// ───"`
     *   （`\s` 含 `\n`）⇒ 替换掉之后**那一行消失了**，而它上面那行也被并进来。
     *   ⇒ 实测本文件里丢了 5 行。修法：把 `\s*` 换成 `[^\S\n]*`（!= 换行）。
     */
    .replace(/^[^\S\n]*\/\/.*$/gm, (line) => ' '.repeat(line.length))
    /**
     * ── ★★★ 三个字符串形态：**都不许跨行**（t25 实测的**第三个**缺陷）──────────────
     *
     * MEASURED（t25，本文件自己的 bug）：第一版的三条字符串规则用的是
     * `'(?:\\.|[^'\\])*'` —— 而 `[^'\\]` **把换行也算进去**。
     * ⇒ 只要文件里有一个**不成对**的引号（本仓的中文注释里到处都是 `` ` `` 与 `"` 的混用），
     *   整段**跨几十行**被吃成一个字符串：实测 `gate-backtest.test.mjs`
     *   **646 行 → 148 行**。
     * ⇒ 后果与块注释那条一样但**严重得多**：行号整体错位，于是植入一条真断言之后，
     *   扫描器报出来的是一个**注释行** —— 而那条读数**看起来完全正常**。
     *
     * ★★ 三次实测合起来是**同一个形状的三个实例**（t25 自己的扫描器）：
     *   ① 块注释吞换行 ⇒ 行号错位
     *   ② 行注释规则替换掉整行 ⇒ 长度对不上
     *   ③ 字符串规则跨行 ⇒ **行号彻底错位**
     *   ⇒ 而它们都**不影响"有没有命中"**，只影响"**报在哪一行**" ——
     *     所以它们能在一个"只看有没有红"的自检下**全部藏住**。
     *     ★ 这就是本任务那句话在**工具自身**上的实例：
     *       **一个报错位置的读数若错了，它比不报更坏。**
     *
     * ⇒ 修法：把 `[^'\\]` 加一个"不含换行"的条件（`\n` 显式排除）。
     */
    .replace(/`(?:\\.|[^`\\\n])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** 扫描一段源码，返回**恒真的 `assert.*` 行**（含行号）。 */
export function tautologiesIn(source) {
  const code = stripCommentsAndStrings(source)
  const hits = []
  const raw = source.split('\n')
  const stripped = code.split('\n')
  stripped.forEach((line, index) => {
    /** ★ 只看**断言** —— 一个恒真的 `if` 或赋值不在本任务的范围里。 */
    if (!/\bassert\s*[.(]/.test(line)) return
    if (TAUTOLOGY_TAILS.some((pattern) => pattern.test(line))) {
      hits.push({ line: index + 1, text: (raw[index] ?? '').trim() })
    }
  })
  return hits
}

/** 扫全仓的 `.test.mjs`（**包括自己** —— 见臂 5）。 */
function sweepAll() {
  const out = []
  let scanned = 0
  for (const entry of readdirSync(SCRIPTS, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.test.mjs')) continue
    scanned += 1
    for (const hit of tautologiesIn(readFileSync(join(SCRIPTS, entry.name), 'utf8'))) {
      out.push({ file: `scripts/${entry.name}`, ...hit })
    }
  }
  return { hits: out, scanned }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★★★ 普查臂 —— 全仓不许有恒真的断言
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 1（普查臂）：全仓的 `assert.*` 里不许有恒真的尾巴', () => {
  const { hits, scanned } = sweepAll()
  console.log(`    ℹ 扫了 ${scanned} 个 .test.mjs 文件`)
  for (const hit of hits) console.log(`       ✘ ${hit.file}:${hit.line}  ${hit.text.slice(0, 110)}`)

  /**
   * ★★★ **先断言"扫到了东西"** —— 这是本文件存在的最重要的一行。
   *
   * MEASURED（本仓的教训，t24）：一个扫描器把 `REPO_ROOT` 少算一层 ⇒ 扫了一个
   * **不存在**的目录 ⇒ **零命中** ⇒ 而"零命中"正是它期望的结果 ⇒ **假绿**。
   * ⇒ 所以"干净"这个结论必须建立在"我确实扫到了文件"之上。
   */
  assert.ok(
    scanned > 100,
    `★★★ 只扫到 ${scanned} 个 .test.mjs 文件 —— 这个数太小，说明扫描面本身有问题。\n`
    + '   ⇒ 而"零命中"与"根本没扫到"必须不同形（本仓为此栽过一次假绿）。',
  )

  assert.deepEqual(
    hits, [],
    '★★★ 出现了**恒真的断言** —— 它在场、读起来像一条检查，而**两种实现都通过**：\n'
    + hits.map((hit) => `  · ${hit.file}:${hit.line}  ${hit.text.slice(0, 120)}`).join('\n')
    + '\n★ 修法：要么把它改成**有方向的**断言（测它本来想测的那件事），'
    + '\n   要么——如果它**真的**是"什么都行"——就**明说**（写一句注释说明这里刻意不判），'
    + '\n   而不是留一个读起来像检查的恒真式。',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★ 精确臂 —— 两个**已知**实例必须真的被修好
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2（精确臂）：t25 点名的两个实例，现在都是**有方向的**断言', () => {
  /**
   * ★ 契约点名了两个文件与两行。⇒ 本臂**逐个**确认修好了，
   *   而不是只靠臂 1 的"全仓零命中"——那一条在**扫描器坏掉**时也会绿。
   */
  const backtest = readFileSync(join(SCRIPTS, 'gate-backtest.test.mjs'), 'utf8')
  const buildArtifacts = readFileSync(join(SCRIPTS, 'gate-contract-build-artifacts.test.mjs'), 'utf8')

  /** ① 两个文件里都不许再有**活着的** `|| true`（注释里的历史记录不算）。 */
  for (const [label, source] of [['gate-backtest', backtest], ['gate-contract-build-artifacts', buildArtifacts]]) {
    const hits = tautologiesIn(source)
    assert.deepEqual(hits, [], `★ ${label} 里还有恒真的断言：${JSON.stringify(hits)}`)
  }

  /**
   * ② 而修完的断言**必须真的在内**（不能是"把它删掉了"）。
   *   ★ "删掉一条哑断言"与"把它改成真断言"在 `deepEqual(hits, [])` 上**同形** ——
   *     所以这里逐个断言**它们现在测什么**。
   */
  assert.match(
    backtest, /for \(const part of \['baseline', 'selection', 'full'\]\)/,
    '★ gate-backtest 那一处必须变成**测三段读数在场**的有方向断言（而不是删掉）',
  )
  assert.match(
    backtest, /assert\.equal\(\s*\n?\s*'outputs' in accepted, false/,
    '★ 而它还要钉住"判据的裁决里没有 outputs"那一格（`outputs` 是**注册表**的格）',
  )
  assert.match(
    buildArtifacts, /assert\.ok\(\s*\n?\s*buildRegistry\(\)\.list\(\)\.contract\.some\(\(entry\) => entry\.id === id\),/,
    '★ gate-contract-build-artifacts 那一处必须变成**真的**装配断言（去掉 `|| true`，而不是删掉那一行）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★★★ 定向突变 —— 把恒真塞回去 ⇒ 普查必须红
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 3（定向突变）：往断言尾巴上加 `|| true` ⇒ 普查必须抓得到', () => {
  /**
   * 「把机制单独去掉，臂必须红。」反过来也一样：**把缺陷放回去，臂必须抓到。**
   *
   * ★ 两个端点跑**同一份**扫描器，差别只在被测文本。
   */
  const clean = "test('x', () => {\n  assert.equal(a, 1, 'a must be 1')\n})"
  const broken = "test('x', () => {\n  assert.equal(a, 1, 'a must be 1')\n  assert.ok(b === 2 || true, 'looks like a check')\n})"

  const cleanHits = tautologiesIn(clean)
  const brokenHits = tautologiesIn(broken)
  console.log(`    ℹ 干净文本 ⇒ ${cleanHits.length} 命中 · 植入恒真后 ⇒ ${brokenHits.length} 命中`)

  assert.deepEqual(cleanHits, [], '★ 干净文本上不许命中 —— 否则扫描器在误报')
  assert.equal(
    brokenHits.length, 1,
    '★★★ 植入 `|| true` 之后必须**恰好**命中一条 —— 否则本普查抓不到它自己要抓的形状',
  )
  assert.equal(brokenHits[0].line, 3, '★ 而它要报**准确的**行号（读的人要能直接去改那一行）')
  assert.notEqual(cleanHits.length, brokenHits.length, '★ 两端必须给出相反结论，否则本突变没有效果')

  /** ★ 而**每一种**尾巴都要被抓到（不是只认 `|| true` 这一种写法）。 */
  const variants = [
    "assert.ok(x || true)",
    "assert.ok(x && false)",
    "assert.equal(x, 1 || true)",
    "assert.ok(x === 1 || 'always')",
  ]
  for (const variant of variants) {
    assert.equal(
      tautologiesIn(`test('v', () => { ${variant} })`).length, 1,
      `★ 恒真的写法「${variant}」没有被抓到 —— 只认一种写法的普查会被下一种绕过去`,
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★★ 非空真臂 —— 扫描器不许在**注释与字符串**上开火
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 4（非空真）：注释与字符串里的 `|| true` 不许被当成恒真断言', () => {
  /**
   * ★★ 这一格是**本普查自己**最容易假红的地方：本文件（以及那两个被修的文件）
   *   都**必须**把 `|| true` 这个词组写进注释（记录历史）与字符串（语料）。
   *   ⇒ 一个不剥注释/字符串的扫描器会在**描述这条纪律的文字**上开火 ——
   *     而那正是本仓记账过的形态：**描述一条纪律，被当成了违反它的证据**。
   */
  const inComment = "test('x', () => {\n  // 原本是 assert.ok(x || true) —— t25 修\n  assert.equal(y, 1)\n})"
  const inBlockComment = "test('x', () => {\n  /** 原写法 `assert.ok(x || true)` 是恒真的 */\n  assert.equal(y, 1)\n})"
  const inString = "test('x', () => {\n  const note = 'assert.ok(x || true) was the old shape'\n  assert.equal(y, 1)\n})"
  const inTemplate = 'test(\'x\', () => {\n  const note = `assert.ok(x || true)`\n  assert.equal(y, 1)\n})'

  for (const [label, source] of [['行注释', inComment], ['块注释', inBlockComment], ['字符串', inString], ['模板串', inTemplate]]) {
    assert.deepEqual(
      tautologiesIn(source), [],
      `★★ ${label}里的 \`|| true\` 被当成了恒真断言 —— 扫描器必须在**代码**上开火，而不是在描述它的文字上。\n`
      + '   ★ 否则本普查会在它自己的说明文字上永远红着。',
    )
  }

  /** ★ 反向半边：**同一句话摆在代码里**必须命中 —— 否则上面四条只是"扫描器坏了"。 */
  assert.equal(
    tautologiesIn("test('x', () => { assert.ok(x || true) })").length, 1,
    '★ 同样的文本在**代码**里必须命中 —— 否则"注释里不命中"只是因为扫描器什么都不抓',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★ 自指臂 —— 本普查跳过自己，而那是**结构性**的、不是开后门
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 5（自指臂）：本文件**不需要**跳过自己 —— 因为它的语料全是惰性的', () => {
  /**
   * ── 这一臂的形状改过一次，而改口本身值得记 ──────────────────────────────────────
   *
   * 第一版写成"跳过自己，理由是**结构性**的（本文件必须含有恒真语料）"。
   * ★ 而实测把它证伪了：`tautologiesIn(self)` 返回 **0 命中**。
   *   ⇒ 因为本文件的语料**全部**写在**字符串与注释**里
   *     （`"… assert.ok(b === 2 || true …"` 是一段字符串，
   *      而臂 3/4 的说明是注释）—— 而那两样东西**正是扫描器要剥掉的**。
   * ★★ 所以"跳过自己"不但**不必要**，而且是一种**掩盖**：
   *   它会让"本文件的语料是否真的惰性"这件事**永远不被检查**。
   *   ⇒ 删掉它，让本文件**和别的文件走同一条路** —— 于是它若哪天真的写出
   *     一条活的恒真断言，臂 1 会**当场**抓到它。
   *
   * ★★★ 而这正是本任务那句纪律的**自指版本**：
   *   **"一个读数若为自己开后门，它就再也不能证明自己干净。"**
   */
  const source = readFileSync(join(SCRIPTS, 'gate-tautology-sweep.test.mjs'), 'utf8')

  /** ★ 它里面确实有那些形状（否则臂 3/4 没在测东西）。 */
  assert.match(source, /\|\| true/, '★ 本文件里应当写着那些形状（臂 3 的语料与臂 4 的探针）')

  /** ★★ 而它们**全都是惰性的**（在字符串/注释里）—— 所以按普通文件扫，零命中。 */
  assert.deepEqual(
    tautologiesIn(source), [],
    '★★★ 本文件里出现了**活的**恒真断言 —— 它自己就在犯它要抓的那个错。\n'
    + '   ★ 注意语料**必须**写在字符串或注释里；一旦有人把它抄成真的断言，本臂与臂 1 都会红。',
  )

  /** ★ 而"扫自己是零命中"这件事**不许**被读成"扫描器没工作"：臂 3/4 已经证明它会命中。 */
  assert.ok(
    tautologiesIn("test('x', () => { assert.ok(y || true) })").length > 0,
    '★ 同一个扫描器在**真的**代码上必须命中 —— 否则本臂的零命中只是因为扫描器坏了',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：★★★ 行号臂 —— 报出来的行号必须**真的是那一行**
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 6（行号臂）：扫描器报的行号必须与原文逐行对齐', () => {
  /**
   * ── 这一臂是 t25 **对自己**打的三次实测脸 ──────────────────────────────────────
   *
   * 本文件第一版的剥注释器有**三个**各自独立的行号缺陷，而它们**都不影响"有没有命中"**：
   *
   *   ① 块注释整段换空串      ⇒ 吞掉它的换行（`gate-readout-uniform` 1640 → 860）
   *   ② 字符串规则用了 `[^'\\\\]` ⇒ 一个不成对的引号让**几十行**被吃成一个串
   *      （`gate-backtest` 646 → **148**）
   *   ③ 行注释规则用了 `\\s*`    ⇒ 吃掉**前面的换行**（再丢 5 行）
   *
   * ★★★ 而三者合起来的后果**只有当有人植入一条真断言时才看得见**：
   *   实测报出来的是 `gate-readout-uniform.test.mjs:777  *   那时 dispatch 的结论…`
   *   —— **一个注释行**。读数在"红/绿"上完全正常（它确实红了），
   *   只是**指着错的地方**。⇒ 而那比不报更坏：**一个错误的措辞让人去做另一件事**。
   *
   * ★★ 所以本臂逐字钉住"剥完之后行数**必须一样**"，并在真文件上验。
   */
  const files = ['gate-backtest.test.mjs', 'gate-contract-build-artifacts.test.mjs', 'gate-readout-uniform.test.mjs', 'gate-task-atomicity.test.mjs']
  for (const file of files) {
    const source = readFileSync(join(SCRIPTS, file), 'utf8')
    const rawLines = source.split('\n').length
    /**
     * ★ 用与 `tautologiesIn` **同一条**规则链剥一遍（而不是另写一份）——
     *   否则本臂测的是它自己那份实现（本仓记过：两份会漂移）。
     *   ⇒ 取巧但可靠：把源码当成"只有一个 assert"的语料喂进去，命中时看它报的行号。
     */
    const probe = `${source}\ntest('t25 line probe', () => { assert.ok(0 === 1 || true) })\n`
    const hits = tautologiesIn(probe)
    assert.equal(hits.length, 1, `★ 探针必须在 ${file} 上命中一次（否则本臂测不了行号）`)
    /**
     * ★ 算术：`source` 有 `rawLines` 行（`split('\n')` 的最后一格是空串），
     *   而探针是 `${source}\ntest(...)` ⇒ 它在第 `rawLines + 1` 行。
     *   ★ 我第一版写成 `+ 2`，于是**报出来的行号是对的、而我的期望值是错的** ——
     *     这本身就是本任务那个形状的一个小实例：期望值写错了，断言就永远红。
     */
    assert.equal(
      hits[0].line, rawLines + 1,
      `★★★ ${file}：报出来的行号是 ${hits[0].line}，而探针真的在第 ${rawLines + 1} 行。\n`
      + '   ⇒ 剥注释器**改变了行数**，于是行号整体错位 —— 而"命中/不命中"这一点上完全看不出来。\n'
      + `   ★ 实测报出来的那一行是：${JSON.stringify(hits[0].text.slice(0, 90))}`,
    )
  }
  console.log(`    ℹ 行号对齐实测：${files.length} 个真文件上，探针行号逐字正确`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7：★★ 只剥得掉"注释与字符串"，不许伤到代码
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 7（不伤代码臂）：剥注释/字符串不许把**真断言**一起吃掉', () => {
  /**
   * ★★ 上面那三条修法都是"把规则收窄" —— 而收窄到过头就会**漏报**。
   *   ⇒ 本臂钉住另一半：**同一行里既有字符串又有真断言**时必须仍然命中。
   *
   * ★ 这是本仓那条纪律：**一条判据的两个退化端都要被钉住**
   *   （漏报与误报同样有害，而它们常常是同一次修改的两端）。
   */
  const cases = [
    ["test('n', () => { assert.ok(x === 1 || true, 'a string') })", '断言在前、字符串在后'],
    ["test('n', () => { assert.ok('msg' !== '', x || true) })", '字符串在前、断言在后'],
    ["test('n', () => { assert.equal(a, b, `tpl ${c}`)\n  assert.ok(y || true) })", '上面一行有模板串'],
    ["test('n', () => {\n  const q = \"unclosed\n  assert.ok(z || true)\n})", '一个**不成对**的引号（本仓中文注释里常见）'],
  ]
  for (const [source, label] of cases) {
    assert.equal(
      tautologiesIn(source).length, 1,
      `★★ 「${label}」这一格漏报了 —— 收窄规则收过了头。\n`
      + '   ★ 漏报与误报是同一次修改的两端，两端都要钉。',
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8：★★★ 已修的两条断言**真的能红**（植入对应的缺陷）
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 8（可失败臂）：两处已修的断言，各自在**对应缺陷**下必须红', async () => {
  /**
   * 契约原话：*"An arm proves the repaired assertions can actually FAIL —
   * by planting the corresponding defect and observing red"*。
   *
   * ★★ 而这一臂**不能**只"断言那些行还在"（臂 2 已经做了）——
   *   一条恒真的断言与一条真断言在**源码在场性**上同形。
   *   ⇒ 本臂的做法是：**把修完的断言逻辑抽出来，喂给它一个坏掉的裁决/坏掉的注册表**，
   *     看它**真的**抛不抛。
   */

  /** ── ① `gate-backtest` 那一处：喂一个缺了读数的 ok 裁决 ⇒ 必须抛 ──────────────── */
  const assertReadouts = (accepted) => {
    for (const part of ['baseline', 'selection', 'full']) {
      assert.ok(
        accepted[part] !== undefined && accepted[part] !== null,
        `通过时必须交出「${part}」这一段读数`,
      )
    }
    assert.equal('outputs' in accepted, false, '判据了自己的裁决里不该有 outputs')
  }

  const goodVerdict = { ok: true, baseline: {}, selection: {}, full: {} }
  assert.doesNotThrow(() => assertReadouts(goodVerdict), '★ 好裁决必须通过（否则本臂测的是"一律抛"）')

  for (const part of ['baseline', 'selection', 'full']) {
    const broken = { ...goodVerdict }
    delete broken[part]
    assert.throws(
      () => assertReadouts(broken),
      `★★★ 把 ok 裁决里的「${part}」拿掉 ⇒ 那条修好的断言**必须红**。\n`
      + '   ★ 它在修之前是一条恒真式（`… || true`），所以那时候**拿掉什么都不红**。',
    )
  }
  /** ★ 而"多带一格 outputs"也要红 —— 那是断言**方向**的另一半。 */
  assert.throws(
    () => assertReadouts({ ...goodVerdict, outputs: {} }),
    '★ 判据裁决里多出 `outputs` 必须红（那一格是**注册表**的）',
  )

  /** ── ② `gate-contract-build-artifacts` 那一处：喂一个**不含该判据**的清单 ⇒ 必须抛 ── */
  const assertMounted = (listed, gateId) => {
    assert.ok(
      listed.some((entry) => entry.id === gateId),
      `判据「${gateId}」必须出现在装配清单的 contract 位置里`,
    )
  }
  assert.doesNotThrow(
    () => assertMounted([{ id: 'contract.build-artifact-scope' }], 'contract.build-artifact-scope'),
    '★ 在清单里 ⇒ 必须通过',
  )
  assert.throws(
    () => assertMounted([{ id: 'contract.verify-command' }], 'contract.build-artifact-scope'),
    '★★★ 把判据从装配清单里拿掉 ⇒ 那条修好的装配断言**必须红**。\n'
    + '   ★ 而它原本的 `|| true` 让它在**任何**清单下都通过 —— 包括判据根本不在里面的那种，\n'
    + '     而那正是"挂错位置等于永不被求值"那个缺陷藏身的地方。',
  )

  /**
   * ── ★★ 而两处都必须**真的还在源文件里**（否则上面测的是本臂自己造的两份实现）──────
   *   ★ 这一句把"抽出来的逻辑"与"仓库里那一行"重新绑上，否则本臂可以整体漂移。
   */
  const backtest = readFileSync(join(SCRIPTS, 'gate-backtest.test.mjs'), 'utf8')
  const buildArtifacts = readFileSync(join(SCRIPTS, 'gate-contract-build-artifacts.test.mjs'), 'utf8')
  assert.match(backtest, /for \(const part of \['baseline', 'selection', 'full'\]\)/, '★ 抽出来的逻辑必须与 gate-backtest 里那一行同形')
  assert.match(backtest, /'outputs' in accepted, false/, '★ 而 outputs 那一半也要在场')
  assert.match(buildArtifacts, /some\(\(entry\) => entry\.id === id\)/, '★ 装配断言必须与它那一行同形')

  console.log('    ℹ 可失败实测：两处断言各自在对应缺陷（缺读数 / 不在清单）下都抛出')
})
