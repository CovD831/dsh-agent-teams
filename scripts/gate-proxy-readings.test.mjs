/**
 * ── ★★ j-0003 判据化（t81）：按【距离】取块的读数（**报告而不拦**）───────────────
 *
 * ── j-0003 说的是什么 ─────────────────────────────────────────────────────────
 *
 *     **「代理读数在它所代理的东西没变时也会变。」**
 *
 * ★ 这里的"代理"是**距离**（N 个字符 / N 行 / 某个偏移窗口），
 *   而被代理的是**"那个东西还在不在"**。
 *
 * ── 两个真实实例（今晚各出现过一次，而**两个都被修了**）────────────────────────
 *
 *   ① t49 的臂 7：`if (!arbitration.allowed)[\s\S]{0,400}?return \{`
 *      ⇒ 在拒绝分支里加了一段注释 ⇒ 距离变成 **1165** ⇒ 臂红，
 *      ★ 而**控制流一个字没变**。
 *        修法：按名字定位（`indexOf('if (!arbitration.allowed)')`）+ 结构配平
 *        （`balancedBlockFrom`）⇒ `scripts/gate-restart-arbitration.test.mjs:362`
 *
 *   ② t69 的 gate-index-assembly：`lines.slice(index, index + 80)` 里找 `${varName}.missing`
 *      ⇒ 加了 **4 行注释** ⇒ 那句日志掉出 80 行窗口 ⇒ 臂红，
 *      ★ 而**日志一个字没少**（`grep` 仍在）。
 *        修法：`new RegExp(`${varName}\\.missing`).test(source)` —— 全文找
 *        ⇒ `scripts/gate-index-assembly.test.mjs:1233`
 *
 * ★ 两者都**按距离取块**，而两者**都声称在测"那个东西还在不在"**。
 *
 * ── ★★★ 边界是【已裁】的（t65 与 captain 的那次分歧，2026-10-08）───────────────
 *
 *   · **工具答 gate**：断言**写出来之后**，它读的东西**现成可取吗**？
 *     ⇒ 距离 / 行号 / 缩进**都现成可取**（它们就在源码文本里）。
 *   · **captain 裁定【工具那一侧】**：
 *     「『构造它需要理解』是【作者】的属性，而它在**判据跑起来之后**就不存在了。」
 *
 *   ⇒ ★ 所以它**可机械化**。而那个"需要理解"的部分（"这个距离取法危不危险"）
 *     是**作者在写它的那一刻**的问题 —— 而工具能做的、也正是本判据做的，
 *     是**把它指出来**，让人在写/改的那一刻看见。
 *
 * ── ★★ 而它【报告而不拦】（这一条与 t60/t61/t62 那三条接缝判据**不同**）────────
 *
 *   j-0003 自己的 counterexample 明说：**有些代理读数是合理的**。
 *   ⇒ 所以本判据的产出是【标记 + 读数的性质】，**不是 blocked**。
 *   ★ 一条"把所有按位置取的全判成坏的"判据会**误伤**那些合理的用法，
 *     而误伤的代价是"人学会忽略这条判据" —— 那正是本队一直在防的。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ─────────────────────────────────────────────────────────────────────────────
// 装置：把一条"取块的断言"读成它的性质
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 三态 ────────────────────────────────────────────────────────────────────
 *
 *   `attribution-based` 按【归属】取 —— 按**名字/模式**在**全文**里找那个东西
 *                        ⇒ ★ 不受位置影响（那正是 t49/t69 修完之后的形状）
 *   `distance-based`    按【距离】取 —— `slice(i, i + N)` / `{0,N}` / 偏移窗口
 *                        ⇒ ★ 位置一变就失效（j-0003 的两个实例）
 *   `unmeasurable`       取块方式**动态构造**，静态看不出来
 *                        ⇒ ★ 与前两者**不同形**："看不出来"不许并进任何一边
 */
const READING = {
  attribution: 'attribution-based',
  distance: 'distance-based',
  unmeasurable: 'unmeasurable',
}

/**
 * ── ★★ 而"按距离取"必须再加一条限定：取的**对象**得是【源码文本】───────────────
 *
 * MEASURED（本任务第一次全仓跑，2026-10-08）：第一版只按形状匹配，
 * 于是存量报出 **65** 条 distance-based —— 而抽样三条全是**误报**：
 *
 *     html.slice(0, 200)        ← 把一个 HTML 字符串截短做展示
 *     missing.slice(0, 3)       ← 把一个错误清单截短做展示
 *     withRecord.slice(0, 200)  ← 把一个记录截短做展示
 *
 * ★ 三者都命中 `slice(x, N)`，而它们**都不是"从源码里取一段来做断言"** ——
 *   它们是**把值截短**。⇒ 判据读的是**形状的代理**，而不是它要判的那件事。
 *
 * ⇒ ★ 加一条限定：取的距离必须落在**源码文本**上（`source` / `body` / `lines` / …）。
 *   ★ 而那与两个真实实例逐字对齐：t69 的 `lines` 是 `source.split('\n')`，
 *     t49 的 `body` 就是源文本。
 *
 * ★★ 这条修法本身**是 j-0003 的又一次实例**（值得记）：
 *   第一版判据读的是"形状"，而被代理的是"**从源码里**按距离取一段"。
 *   ⇒ 形状没变而对象变了（值 vs 源码）时，第一版**照样命中** ——
 *     那就是"代理读数在它所代理的东西没变时也会变"的镜像：
 *     **它在它所代理的东西【变了】时也不变。**
 */

/** 一个像"源码文本"的标识符（两个真实实例的目标都长这样）。 */
const SOURCE_TEXT_HINT = /(?:^|[.\s(,])(?:\w*(?:source|body|text|lines|content|src|raw|code)\w*)/i

/**
 * ── 按【距离】取的形状（本判据要标记的那些）────────────────────────────────────
 *
 * ★ 只收**真的在"从源码里取一段"**的形状 —— 而它们的共同点是：
 *   **结果依赖"那个东西离锚点多远"**。
 */
const DISTANCE_PATTERNS = [
  {
    id: 'slice-with-literal-window',
    /** `.slice(<expr>, <expr> + N)` —— 窗口大小是**字面量**。 */
    pattern: /\.slice\(\s*[^,)]+\s*,\s*[^,)]+\+\s*\d+\s*\)/,
    why: 'a slice whose window size is a literal (slice(i, i + N)) — the result depends on HOW FAR the thing is',
  },
  {
    id: 'bounded-regex-gap',
    /** `{0,N}` / `{1,N}` —— 正则里的**有界距离**。 */
    pattern: /\{\s*\d+\s*,\s*\d+\s*\}/,
    why: 'a bounded regex gap ({0,N}) — it asserts the thing appears WITHIN N characters of the anchor',
  },
]

/**
 * ── 按【归属】取的形状（"直接读它要测的东西"）────────────────────────────────────
 *
 * ★ 它们的共同点：**在全文里找那个名字/模式** ⇒ 那个东西挪到哪里都找得到。
 *   ⇒ 这正是 j-0003 的 counterexample 说的那件事：
 *     **直接读它要测的东西 ⇒ 不会失效。**
 */
const ATTRIBUTION_PATTERNS = [
  {
    id: 'regex-test-on-source',
    /** `new RegExp('…').test(source)` / `re.test(fullText)` —— 对全文跑一个模式。 */
    pattern: /new\s+RegExp\([^)]*\)\s*\.test\(\s*\w+\s*\)|\.test\(\s*(?:source|body|text|fullText|whole)\s*\)/,
    why: 'a regex tested against the WHOLE source — the thing is found wherever it moved',
  },
  {
    id: 'includes-on-source',
    /** `source.includes('…')` —— 全文包含。 */
    pattern: /(?:source|body|text|fullText|whole|content)\s*\.\s*includes\(/,
    why: 'a full-text includes() — position-independent by construction',
  },
  {
    id: 'index-of-then-structural',
    /**
     * ★ 这一条是 t49 修完之后的形状：**按名字定位，然后按结构取**。
     *   `indexOf('if (!arbitration.allowed)')` + `balancedBlockFrom(...)`
     *   ⇒ 名字决定"从哪开始"，而**块的结束由配平决定**（不是距离）。
     */
    pattern: /balancedBlockFrom|balancedBlock|matchBalanced|extractBalanced/,
    why: 'located by NAME and closed by STRUCTURE (balanced block) — not by a distance',
  },
]

/**
 * ── 把一条语句读成它的性质 ──────────────────────────────────────────────────────
 *
 * ★ 顺序是刻意的：**先问归属**。
 *   因为一段代码可以**同时**含两种形状（例如 `indexOf(...)` 之后再 `slice`），
 *   而那时它**是不是**按距离取，取决于那个 `slice` 的第二个参数**是不是**算出来的距离。
 *   ⇒ 本函数只看**这一条语句里有没有 distance 形状**；有 ⇒ distance-based。
 *     ★ 而那正是 t49/t69 修好之后**没有**的东西（它们换成了全文/结构）。
 *
 * ★ 返回三态之一 + **理由**（理由是本判据的全部产出 —— 它不拦，所以它必须说清）。
 */
function readingOf(statement) {
  const hits = DISTANCE_PATTERNS.filter((entry) => entry.pattern.test(statement))

  if (hits.length > 0) {
    /**
     * ★★ 加这一条限定之后，"截短一个值来做展示"就不再命中 ——
     *   而那正是第一版 65 条里大部分误报的成因。
     *
     * ★ 若形状像"按距离取"而对象**不像源码文本** ⇒ 落 `unmeasurable`
     *   （"看不出来它取的是不是源码"），**不**硬判成 distance-based。
     *   把看不出来的判成坏的，就是"把不可判并进可判"。
     */
    if (!SOURCE_TEXT_HINT.test(statement)) {
      return {
        verdict: READING.unmeasurable,
        patternIds: hits.map((entry) => entry.id),
        why: `it takes a distance-shaped slice, but the target does not look like source text (so it may be truncating a VALUE for display rather than reading the source)`,
      }
    }
    return {
      verdict: READING.distance,
      patternIds: hits.map((entry) => entry.id),
      why: hits.map((entry) => entry.why).join('; '),
      /** ★ 而它会**怎么**失效 —— 那是读的人要的那个动作。 */
      failure: 'inserting or deleting unrelated lines (even a comment) changes the distance ⇒ this reading flips while the thing it claims to measure is unchanged',
    }
  }

  const attributionHits = ATTRIBUTION_PATTERNS.filter((entry) => entry.pattern.test(statement))
  if (attributionHits.length > 0) {
    return {
      verdict: READING.attribution,
      patternIds: attributionHits.map((entry) => entry.id),
      why: attributionHits.map((entry) => entry.why).join('; '),
    }
  }

  return { verdict: READING.unmeasurable, patternIds: [], why: 'no statically-recognisable block-extraction shape' }
}

/**
 * ── 从源码里抽出**候选语句** ────────────────────────────────────────────────────
 *
 * ★ 抽的是**含取块动作的那些行**，而不是全部行：
 *   一条 `assert.equal(x, 1)` 既不是 distance 也不是 attribution —— 它不取块。
 *   ⇒ 只让"含候选形状"的行进入读数，否则存量数字会被无关行稀释。
 *
 * ★ 而"含候选形状"用**两类模式一起**筛：只按 distance 筛会漏掉那些**应当**
 *   被判成 attribution 的行（于是"改好了"这件事在读数上看不见）。
 */
function candidateStatements(source) {
  const out = []
  source.split('\n').forEach((line, index) => {
    const trimmed = line.trim()
    /** ★ 跳过注释行：注释里**提到**旧写法（本队大量如此）不是一条活的读数。 */
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    const matches =
      DISTANCE_PATTERNS.some((entry) => entry.pattern.test(line)) ||
      ATTRIBUTION_PATTERNS.some((entry) => entry.pattern.test(line))
    if (matches) out.push({ line: index + 1, text: trimmed, ...readingOf(line) })
  })
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★★ 两个真实实例必须被检出（用它们**修之前**的形状）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂是"判据真的抓得到那两个实例"的证据 ────────────────────────────────────
 *
 * ★ 而那两处**现在都已经被修好了**（旧写法留在注释里、并在注释里写明为什么换掉）。
 *   ⇒ 所以本臂**不能**去盘上找它们（找不到）。
 *   ⇒ 它喂**它们当初的那一行源码**给装置 —— 而那一行是从两个真实提交/注释里抄来的原文。
 *
 * ★★ 而这也说明本判据的**用途**：它不是一个"事后抓坏人"的门，
 *   而是一面**写的时候就能照的镜子** —— 那与 captain 的裁定逐字一致
 *   （"构造它需要理解"是**作者**的属性）。
 */
test('臂 1 ★★ 两个真实实例：t49 的距离窗口 与 t69 的 80 行窗口，都必须被判 distance-based', () => {
  /** ★ 原文抄自 `scripts/gate-restart-arbitration.test.mjs:348` 的注释（t49 之前的写法）。 */
  const t49old = String.raw`  assert.match(body, /if \(!arbitration\.allowed\)[\s\S]{0,400}?return \{/)`
  /** ★ 原文抄自 `scripts/gate-index-assembly.test.mjs:1209` 的注释（t69 之前的写法）。 */
  const t69old = String.raw`    const window = lines.slice(index, index + 80).join('\n')`

  const a = readingOf(t49old)
  const b = readingOf(t69old)
  console.log(`    ℹ t49 旧写法 ⇒ ${a.verdict}｜${a.patternIds.join(', ')}`)
  console.log(`    ℹ t69 旧写法 ⇒ ${b.verdict}｜${b.patternIds.join(', ')}`)

  assert.equal(a.verdict, READING.distance, '★ t49 那条有界距离正则没有被判成 distance-based')
  assert.equal(b.verdict, READING.distance, '★ t69 那条 80 行窗口没有被判成 distance-based')

  /** ★ 而它们各自由**不同的形状**命中 —— 那说明模式集不是只认一种写法。 */
  assert.ok(a.patternIds.includes('bounded-regex-gap'), '★ t49 那条应当由"有界正则距离"命中')
  assert.ok(b.patternIds.includes('slice-with-literal-window'), '★ t69 那条应当由"字面量窗口 slice"命中')
  assert.notDeepEqual(a.patternIds, b.patternIds, '★ 两个实例必须由不同形状命中（否则模式集只认一种）')

  /** ★ 而每一条都要说得出**它怎么失效**。 */
  for (const reading of [a, b]) {
    assert.match(
      reading.failure, /inserting or deleting unrelated lines/,
      '★ 一条 distance-based 读数必须说清它的失效方式 —— 而本判据不拦，所以那句就是全部产出',
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★★ 反向半边：它们**修好之后**的形状必须判 attribution-based
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂防的是"把所有按位置取的全判成坏的"──────────────────────────────────────
 *
 * ★ j-0003 的 counterexample 明说：**有些代理读数是合理的**。
 *   而 t49/t69 修完之后的写法就是那个"合理"的标准形状：
 *
 *     t49：按**名字**定位 + 按**结构**配平（`balancedBlockFrom`）
 *     t69：`new RegExp(...).test(source)` —— 对**全文**跑模式
 *
 *   ⇒ ★ 两者都**不是**"按距离取"，而它们测的东西与之前**逐字相同**。
 *     它们只是把**代理**换成了**那个东西本身**。
 */
test('臂 2 ★★ 反向半边：修好之后的写法（按名字+结构 / 全文模式）必须判 attribution-based', () => {
  /** ★ 抄自 `scripts/gate-restart-arbitration.test.mjs:362`（t49 修完之后的形状）。 */
  const t49new = String.raw`  const refusalIf = body.indexOf('if (!arbitration.allowed)'); const refusalBlock = balancedBlockFrom(body, refusalIf)`
  /** ★ 抄自 `scripts/gate-index-assembly.test.mjs:1233`（t69 修完之后的形状）。 */
  const t69new = String.raw`      logsGaps: new RegExp(\`\${match[1]}\\.missing\`).test(source),`

  const a = readingOf(t49new)
  const b = readingOf(t69new)
  console.log(`    ℹ t49 新写法 ⇒ ${a.verdict}｜${a.patternIds.join(', ')}`)
  console.log(`    ℹ t69 新写法 ⇒ ${b.verdict}｜${b.patternIds.join(', ')}`)

  assert.equal(a.verdict, READING.attribution, '★ t49 修完之后的形状（名字+结构配平）没有被判成 attribution-based')
  assert.equal(b.verdict, READING.attribution, '★ t69 修完之后的形状（全文正则）没有被判成 attribution-based')

  /** ★ 三态两两不同形（逐对断言，不循环）。 */
  const distance = readingOf(String.raw`    const window = lines.slice(index, index + 80).join('\n')`)
  const unmeasurable = readingOf("const chunk = source.slice(start, computedEnd)")
  console.log(`    ℹ 动态构造的取块 ⇒ ${unmeasurable.verdict}`)
  assert.notEqual(a.verdict, distance.verdict, '★ attribution 与 distance 必须不同形')
  assert.notEqual(a.verdict, unmeasurable.verdict, '★ attribution 与 unmeasurable 必须不同形')
  assert.notEqual(distance.verdict, unmeasurable.verdict, '★ distance 与 unmeasurable 必须不同形')

  /**
   * ★ 而"看不出来"那一态**必须真的存在**：一个"距离是算出来的"取块
   *   （`slice(start, computedEnd)`）不许被硬判成 distance-based ——
   *   把看不出来的判成坏的，就是"把不可判并进可判"。
   */
  assert.equal(
    unmeasurable.verdict, READING.unmeasurable,
    '★ 一个动态构造的取块被硬判成了某一态 —— 而"看不出来"必须是它自己的那一态',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★ 报告而不拦：它不许产出 blocked
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂把"报告而不拦"写成一条**可执行**的性质 ────────────────────────────────
 *
 * ★ 而它是本判据与 t60/t61/t62 那三条接缝判据的**全部差别**：
 *   那三条**拦**（fail），这一条**只报**（diagnostic）。
 *
 * ⇒ 判据：**全仓扫完，无论发现多少 distance-based，本文件都不许 fail。**
 *   ★ 这一条同时是一道反向保护：将来有人"顺手"把它改成断言非零
 *     （那会在这条判据第一次真的抓到东西时把整个套件打红），这一臂会红。
 */
test('臂 3 ★ 报告而不拦：全仓扫一次，存量如实报出，而本判据无论如何不 fail', () => {
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.test.mjs')) files.push(full)
    }
  }
  walk(join(ROOT, 'scripts'))

  const byVerdict = { [READING.distance]: [], [READING.attribution]: [], [READING.unmeasurable]: [] }
  for (const file of files) {
    const rel = relative(ROOT, file).split('\\').join('/')
    for (const statement of candidateStatements(readFileSync(file, 'utf8'))) {
      byVerdict[statement.verdict].push({ file: rel, ...statement })
    }
  }

  console.log(`    ℹ 全仓 ${files.length} 个夹具，取块候选读数：`)
  console.log(`       attribution-based  ${byVerdict[READING.attribution].length}`)
  console.log(`       ★ distance-based   ${byVerdict[READING.distance].length}`)
  console.log(`       unmeasurable       ${byVerdict[READING.unmeasurable].length}`)

  /** ★ 存量逐条打印（按文件聚集）—— 那才是这条判据的产出。 */
  const byFile = new Map()
  for (const entry of byVerdict[READING.distance]) {
    if (!byFile.has(entry.file)) byFile.set(entry.file, [])
    byFile.get(entry.file).push(entry.line)
  }
  for (const [file, lines] of [...byFile].sort()) {
    console.log(`       · ${file}:${lines.join(',')}`)
  }

  /**
   * ★★ 而"报告而不拦"的机械形式：**本臂只断言装置在工作，不断言存量为零**。
   *   ⇒ 断言的是"扫描真的覆盖了文件"与"三态之和等于候选数"，而**不是**"distance 必须是 0"。
   *   ★ 把 distance 断言成 0 会在下一次有人合法地写一个窗口时按设计变红 ——
   *     而那时读的人会去改断言（棘轮），而不是去判断那个窗口合不合理。
   */
  assert.ok(files.length > 50, `★ 只扫到 ${files.length} 个夹具 —— 扫描没覆盖全仓`)
  const total = byVerdict[READING.distance].length + byVerdict[READING.attribution].length + byVerdict[READING.unmeasurable].length
  assert.ok(total > 0, '★ 一条候选读数都没有 —— 装置一个都没抓到（而"没抓到"与"都没有"同形）')
  console.log(`    ℹ 三态之和 ${total}（= 候选读数总数）`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★★ 定向突变：同一件事 —— attribution ⇒ distance ⇒ 读数必须变
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 规则二后半句：把机制单独去掉 ⇒ 读数必须变 ───────────────────────────────────
 *
 * ★ 本臂取**同一句话的两个版本**（t69 修前 / 修后），只改**取块方式**、
 *   不改它测的东西 —— 而读数必须从 `attribution-based` 翻成 `distance-based`。
 *   ⇒ 那就是"把机制单独去掉"在**读数判据**上的意思。
 */
test('臂 4 ★★ 定向突变：同一件事只换取块方式 ⇒ 读数必须翻面（attribution ⇄ distance）', () => {
  /** ★ 两版**测的是同一件事**："`dispatchInputSurface.missing` 这句日志在不在"。 */
  const attributionVersion = 'logsGaps: new RegExp(`${match[1]}\\\\.missing`).test(source)'
  const distanceVersion = "const window = lines.slice(index, index + 80).join('\\n'); const logsGaps = new RegExp(`${match[1]}\\\\.missing`).test(window)"

  const before = readingOf(attributionVersion)
  const after = readingOf(distanceVersion)
  console.log(`    ℹ 全文找（归属）  ⇒ ${before.verdict}`)
  console.log(`    ℹ 80 行窗口（距离）⇒ ${after.verdict}`)

  assert.equal(before.verdict, READING.attribution, '★ 全文找必须判 attribution-based')
  assert.equal(after.verdict, READING.distance, '★ 换成窗口之后必须判 distance-based')
  assert.notEqual(before.verdict, after.verdict, '★ 只换取块方式而读数没变 —— 那说明判据读的不是取块方式')

  /**
   * ★ 反向再钉一次：把距离**拿掉**（改回全文）⇒ 读数必须**翻回去**。
   *   ⇒ 两个方向都可判，而不是"单向敏感"。
   */
  assert.equal(readingOf(attributionVersion).verdict, READING.attribution, '★ 翻回去时读数没跟着回去')

  /**
   * ★★ 而本臂要顺带钉住一件事：**判据读的是取块方式，不是措辞**。
   *   ⇒ 两版都含 `new RegExp(...).test(...)`（都有 attribution 形状），
   *     而 distance 版**因为多了那个 `slice`** 被判成 distance-based。
   *   ★ 顺序是刻意的：**distance 优先** —— 因为"取块方式"里只要含一段按距离的，
   *     那条读数就会因位置而失效（无论它同时还做了什么）。
   */
  assert.ok(
    ATTRIBUTION_PATTERNS.some((entry) => entry.pattern.test(distanceVersion)),
    '★ 前提：distance 版里**确实也有** attribution 形状 —— 否则本臂测不到"优先级"这件事',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★★ 误报面：截短一个【值】不是"按距离从源码里取一段"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂是【本判据第二次踩到 j-0003】，而它要记下来 ────────────────────────────
 *
 * MEASURED（本任务第一次全仓跑）：第一版报出 **65** 条 distance-based，
 * 而抽样三条**全是误报**：
 *
 *     html.slice(0, 200)        ← 把 HTML 字符串截短做展示
 *     missing.slice(0, 3)       ← 把错误清单截短做展示
 *     withRecord.slice(0, 200)  ← 把记录截短做展示
 *
 * ★ 三者都命中 `slice(x, N)`，而它们**都不是"从源码里取一段来做断言"**。
 * ⇒ 第一版读的是**形状的代理**，而被代理的是"**从源码里**按距离取一段"。
 *
 * ★★ 而那正是 j-0003 的**镜像**：
 *     原命题：代理读数在它所代理的东西**没变**时也会变；
 *     我这一版：它在它所代理的东西**变了**时（值 → 源码）**也不变**。
 *   ⇒ 两个方向都要防 —— 而"加一条对象限定"就是第二个方向的那个动作。
 */
test('臂 5 ★★ 误报面：截短一个值（display truncation）不许被判成 distance-based', () => {
  /** ★ 三条**真实存在于本仓**（本任务全仓跑时抓到的）的展示式截短。 */
  const displayTruncations = [
    ['html 截短', String.raw`  const mutated = source.replace('writeFileSync(OUT, html)', "writeFileSync(OUT, html.slice(0, 200))")`],
    ['清单截短', String.raw`    + \`\n  未记录（会被当"新增"）：\${missing.length}\${missing.length ? \` — \${JSON.stringify(missing.slice(0, 3))}\` : ''}\``],
    ['记录截短', String.raw`    + \` 实测：\${withRecord.slice(0, 200)}\`,`],
  ]

  for (const [label, statement] of displayTruncations) {
    const reading = readingOf(statement)
    console.log(`    ℹ ${label} ⇒ ${reading.verdict}｜${reading.why.slice(0, 72)}`)
    assert.notEqual(
      reading.verdict, READING.distance,
      `★ 「${label}」被判成了 distance-based —— 而它是**把值截短做展示**，`
      + '不是"从源码里按距离取一段来做断言"。⇒ 那是判据在"读形状的代理"（j-0003 的镜像）。',
    )
  }

  /**
   * ★ 而反向半边：**真的**"从源码里按距离取"仍然必须判 distance-based ——
   *   否则这一臂会在"什么都不判成 distance"的实现上照样绿。
   */
  const genuine = readingOf(String.raw`    const window = lines.slice(index, index + 80).join('\n')`)
  assert.equal(genuine.verdict, READING.distance, '★ 真的源码窗口没有被判成 distance-based —— 那本判据就废了')
  console.log(`    ℹ 真源码窗口 ⇒ ${genuine.verdict}（反向半边 ✓）`)
})
