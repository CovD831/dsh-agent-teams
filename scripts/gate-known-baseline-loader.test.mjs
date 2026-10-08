/**
 * ── ★★★ t23：已知失败清单【收不到】—— 装载器与判据各解一层，而 catch 吞掉了那个错 ──
 *
 * ── 本文件钉的不是判据的语义，而是【那一格的接线】──────────────────────────────
 *
 *     判据侧   `backtest.parseKnownBaselineFailures`   ← 语义正确，不动
 *     调用方   `completion.loadKnownBaselineFailures` ← ★ 解层解早了
 *
 * ── ★ 它防的是什么失效（MEASURED，t23 复现）─────────────────────────────────────
 *
 *     completion.ts:70    return parseKnownBaselineFailures(raw.knownFailures)  ← 传【数组】
 *     backtest.ts:191     (raw as …)?.knownFailures                            ← ★ 又解一层
 *     ⇒ undefined ⇒ :192 恒抛
 *     ⇒ completion.ts:71  catch { continue }  ★ 把那个错吞掉 ⇒ 返回 undefined
 *     ⇒ 判据永远看到「清单缺席」⇒ 永远走第三态「无法归因」
 *     ⇒ ★★ 清单做多少条都没用（18 条与 0 条在判据眼里【同形】）
 *
 * ── ★★ 而它藏得住的原因，就是本文件第 2 条验收要钉的那件事 ────────────────────
 *
 *   > **一个 `try/catch` 吞掉的异常，与"文件不存在"在读数上同形。**
 *   > **⇒ 于是"我接错了"与"它不在这儿"不可分 —— 而两者的补救动作相反。**
 *
 * ── ★★★ 三态（互不同形）──────────────────────────────────────────────────────
 *
 *     ① 清单在场且合法   ⇒ 返回 **N 条**（N = 该检出里清单的真实条数）
 *     ② 清单不存在       ⇒ `undefined`（缺席 —— 判据据此落第三态，正常）
 *     ③ 清单在场但读不了 ⇒ ★ **抛**（JSON 坏了 / 形状坏了）—— **不许**是 `undefined`
 *
 *   ★ 而 ② 与 ③ **必须不同形**：前者是"它不在这儿"，后者是"我接错了"。
 *
 * ── ★★ 避免白跑的读法（本任务验收最后一条）─────────────────────────────────────
 *
 *   **清单条数因检出而异**（成员 worktree 旧版 10 条 / 主树 18 条）。
 *   ⇒ 所以下面的断言【不写死条数】，而是**从同一份文件里现读**再比对 ——
 *     否则会在另一棵树上得到一条假红（或假绿）。
 *   ★ 这条纪律与 t23 的主题同源：**说清你读的是哪一棵树的那一份。**
 *
 * ── ★ 定向突变（打红本文件的几条路）────────────────────────────────────────────
 *
 *   a) 把装载器改回 `parseKnownBaselineFailures(raw.knownFailures)` ⇒ 臂 1 红
 *   b) 把判据改成兼容两种形状（数组也接受）⇒ 臂 2 红（反面臂失去意义）
 *   c) 把 `catch` 改回 `catch { continue }`（吞掉一切）⇒ 臂 3 红
 *   d) 让装载器在形状坏时返回 `undefined` ⇒ 臂 3 红（②与③同形）
 *   e) 删掉 `isMissingFileError`、改成"任何错误都 continue" ⇒ 臂 3 红
 *
 * Run: node --test scripts/gate-known-baseline-loader.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseKnownBaselineFailures } from '../lib/gates/completion/backtest.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** ★ 清单的**真实路径**：断言不写死条数，而是从这一份现读（见文件头"避免白跑的读法"）。 */
const FIXTURE = join(ROOT, 'scripts', 'fixtures', 'baseline-known-failures.json')

const cleanups = []
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 't23-loader-'))
  cleanups.push(dir)
  return dir
}
process.on('exit', () => {
  for (const dir of cleanups) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})

/**
 * ── ★★ 被测对象是【装载器那一格的形状】，而不是它的私有函数 ────────────────────
 *
 * `loadKnownBaselineFailures` 没有导出（它是 `completion.ts` 的内部函数），
 * 而本文件要问的恰恰是**那一格怎么接的**。⇒ 这里【逐字复刻】它的现有形状：
 * 从**真实源码**里抽出那一段，用受控的读盘函数喂它。
 *
 * ★ 为什么不是"再抄一遍"：抄一遍会与源码分叉，而分叉之后本文件测的是
 *   我抄的那一份，不是主树那一份 —— 那正是 t23 自己记的形状。
 * ⇒ 所以下面**从源码文本里取**（取不到就红，那本身就是一条接线读数）。
 */
function loaderSnippet() {
  const source = readFileSync(join(ROOT, 'src', 'tools', 'update-task', 'completion.ts'), 'utf8')
  const start = source.indexOf('function isMissingFileError')
  const end = source.indexOf('/** completion 位置需要的、来自调用方的输入')
  assert.ok(start > 0 && end > start,
    '★ 接线臂：装载器那一段必须能在源码里定位到（否则本夹具测的不是主树那一份）')
  return source.slice(start, end)
}

/**
 * 把装载器那一段源码变成可调用的函数 —— 注入一个受控的 `readFileSync`。
 *
 * ★ 注入而不是真读盘：本文件要构造"文件坏了"这种**主树里不存在**的状态。
 *
 * ★★ 而源码是 TypeScript ⇒ 取出来之后要**剥掉类型注解**才能 `new Function`。
 *    剥法是**机械的**（三条正则，见下），不解释语义：
 *      · 参数/变量上的 `: SomeType`（含 `ReturnType<…>` 这种带尖括号的）
 *      · `as { … }` 断言
 *      · 返回类型
 *    ★ 若哪天剥不动了，本函数会**抛**（而不是悄悄测错东西）——
 *      那本身就是一条接线读数：**被测对象与源码分叉了**。
 */
function stripTypes(code) {
  return code
    // `: ReturnType<typeof parseKnownBaselineFailures> | undefined` 等（在 `)` / `{` / `=` 之前）
    .replace(/:\s*ReturnType<[^;{=)]*?(?=[){=])/gu, '')
    // 形如 `: string` / `: unknown` / `: { a?: unknown }` 的注解
    .replace(/:\s*(?:unknown|string|number|boolean)\b/gu, '')
    .replace(/:\s*\{[^{}]*\}\s*(?=[),;=])/gu, '')
    // `as { knownFailures?: unknown }` 之类的断言
    .replace(/\s+as\s+\{[^{}]*\}/gu, '')
    // 函数返回类型 `): T {`
    .replace(/\)\s*:\s*[A-Za-z_$][\w$.]*(\[\])?\s*\{/gu, ') {')
}

/**
 * 把装载器那一段源码变成可调用的函数 —— 注入受控的 `readFileSync` 与 `import.meta.url`。
 *
 * ★ 注入而不是真读盘：本文件要构造"文件坏了"这种**主树里不存在**的状态。
 * ★★ 而 `import.meta.url` **不能在 `new Function` 体里出现**（它不是模块作用域）
 *    ⇒ 所以把它作为**参数**注入，源码里那句 `fileURLToPath(import.meta.url)`
 *      改写成 `fileURLToPath(moduleUrl)`。这是一处**机械替换**，不解释语义。
 */
function makeLoader() {
  const snippet = stripTypes(loaderSnippet())
    .replace(/import\.meta\.url/gu, 'moduleUrl')
  const body = `
    return (readFileSync, moduleUrl) => {
      ${snippet}
      return loadKnownBaselineFailures()
    }
  `
  try {
    // eslint-disable-next-line no-new-func
    return new Function('join', 'dirname', 'fileURLToPath', 'parseKnownBaselineFailures', body)(
      join, dirname, fileURLToPath, parseKnownBaselineFailures)
  } catch (error) {
    throw new Error(
      '★ 接线臂：装载器那一段源码剥类型之后仍不能求值 —— '
      + '说明本夹具与主树那一份【分叉了】，而分叉之后本文件测的就不是它。'
      + `原始错误：${String(error)}`,
    )
  }
}

/**
 * 一次调用装载器（注入受控的 readFileSync）。
 *
 * ★ `moduleUrl` 指向一个**不存在的目录** ⇒ 那两个候选路径都由 `fakeRead` 决定，
 *   于是每一臂都能独立控制"这一格读得到什么"。
 */
function runLoader(load, fakeRead) {
  return load(fakeRead, 'file:///t23-fixture/lib/tools/update-task/completion.js')
}

/** 受控读盘：`contents(path)` 返回字符串 ⇒ 读得到；抛 `code` ⇒ 模拟那种失败。 */
function fakeRead(contents, plan) {
  return (path) => {
    if (plan.missing === true) {
      const error = new Error('ENOENT: no such file or directory')
      error.code = 'ENOENT'
      throw error
    }
    const value = contents(path)
    if (typeof value === 'string') return value
    throw value
  }
}

/** 读真实的清单文本与条数（同一处来源 ⇒ 换检出也不会假红）。 */
const realText = readFileSync(FIXTURE, 'utf8')
const realCount = parseKnownBaselineFailures(JSON.parse(realText)).length

// ── 臂 1 ★★★ 正面臂：进场清单必须【真的到得了判据】─────────────────────────────
test('臂 1 ★★★ 正面：装载器交得出来 —— 清单在场且合法 ⇒ 判据得到 N 条（不是 undefined）', () => {
  const load = makeLoader()
  const result = runLoader(load, fakeRead(() => realText, {}))
  assert.notEqual(result, undefined,
    '★★★ 清单在场且合法时必须是【数组】。'
    + 'undefined 意味着"这份清单在判据眼里缺席" —— 而那正是 t23 修的双层解缺陷：'
    + '装载器传数组、判据又解一层 ⇒ 恒抛 ⇒ 被 catch 吞成 undefined ⇒ 判据永远收不到。')
  assert.ok(Array.isArray(result), `★ 必须是数组，实测 ${JSON.stringify(result)}`)
  assert.equal(result.length, realCount,
    `★★ 条数必须等于该检出里清单的真实条数（${realCount}）。`
    + '★ 而条数因检出而异（旧 worktree 10 条 / 主树 18 条）—— 所以这条断言从同一份文件现读，不写死。')
})

// ── 臂 1b ★★★ 解层口径【唯一】：判据只认一种形状（整份清单对象）───────────────
test('臂 1b ★★★ 解层口径唯一：判据必须【只认】整份清单对象，既不多解也不少解', () => {
  // ① 正确形状：整份清单对象 ⇒ 成功
  const ok = parseKnownBaselineFailures({ knownFailures: [{ test: 'a', because: 'b' }] })
  assert.equal(ok.length, 1, '① 正确形状（整份清单对象）⇒ 必须成功')

  /**
   * ② ★ 另一半：**一个裸数组必须【抛】**。
   *
   *   「解层只发生一次」这条口径**只有在判据拒绝另一种形状时才是可断言的** ——
   *   否则判据会变成"两种形状都收"，而那时装载器解早一层、解晚一层**都看不出来**，
   *   于是 t23 这个缺陷可以在"夹具全绿"的情况下重新长回来。
   *
   *   ★ 定向突变：把判据改成 `Array.isArray(raw) ? raw : raw?.knownFailures`
   *     （"兼容两种形状"）⇒ 本条红。而**只改判据不改装载器**时，
   *     臂 1 仍然是绿的（因为装载器传的是对象）—— 所以本条是那半边的唯一钉子。
   */
  assert.throws(
    () => parseKnownBaselineFailures([{ test: 'a', because: 'b' }]),
    /knownFailures` must be an array/,
    '② ★ 裸数组必须抛：判据只认【整份清单对象】这一种形状，'
    + '否则"解层只发生一次"不可断言 —— 而 t23 正是靠这条口径的唯一性防住双解/少解。',
  )
})

// ── 臂 2 ★★★ 反面臂：坏形状必须抛，且与正面臂不同形 ────────────────────────────
test('臂 2 ★★★ 反面：`{ knownFailures: "not-array" }` 必须抛 —— 与臂 1 不同形', () => {
  assert.throws(
    () => parseKnownBaselineFailures({ knownFailures: 'not-array' }),
    /knownFailures` must be an array/,
    '★★ 判据侧那条 throw 的意图：「抛错而不是返回 []，因为后者会让『清单坏了』读成『没有已知失败』」。'
    + '★ 而它与臂 1 必须不同形：臂 1 是"清单在、可用"⇒ 返回数组；本条是"清单坏了"⇒ 抛。',
  )
})

// ── 臂 3 ★★★ 反半边：清单【存在但坏了】必须不是沉默的 undefined ────────────────
test('臂 3 ★★★ 反半边：清单存在但 JSON 坏了 ⇒ 必须报出那个错，不是 undefined', () => {
  const load = makeLoader()
  assert.throws(
    () => runLoader(load, fakeRead(() => '{ this is not json', {})),
    /not valid JSON/,
    '★★★ "清单坏了"与"清单不存在"必须不同形。'
    + '被 `catch { continue }` 吞掉时，两者都落 undefined ⇒'
    + '「我接错了」与「它不在这儿」不可分 —— 而两者的补救动作相反。'
    + '★ 定向突变：只修双解层而不动那个 catch ⇒ 本条仍然红。',
  )
})

test('臂 3b ★★★ 反半边（形状坏了那一半）：清单在、JSON 合法、而形状坏 ⇒ 也必须抛', () => {
  const load = makeLoader()
  assert.throws(
    () => runLoader(load, fakeRead(() => JSON.stringify({ knownFailures: 'not-array' }), {})),
    /knownFailures` must be an array/,
    '★ 与臂 3 是**两件不同的坏**：那是 JSON 语法坏，这是 JSON 好而形状坏。'
    + '⇒ 两者都必须抛，而它们与"文件不存在"必须不同形。',
  )
})

// ── 臂 4 ★★ 缺席那一态：文件不存在 ⇒ undefined（正常，不是错）───────────────────
test('臂 4 ★★ 缺席态：候选都不存在 ⇒ undefined（"清单缺席"是正常读数，不是错误）', () => {
  const load = makeLoader()
  const result = runLoader(load, fakeRead(() => '', { missing: true }))
  assert.equal(result, undefined,
    '★ 判据的第三态「attribution is impossible」靠这一格区分：'
    + '「清单缺席」与「清单恰好覆盖了全部失败」必须不同形。'
    + '⇒ 所以这里**必须**是 undefined，而不是 [] 或抛。')
})

// ── 臂 5 ★★★ 三态两两不同形（一条断言遍历三态）──────────────────────────────────
test('臂 5 ★★★ 三态两两不同形：在场 / 缺席 / 在场但读不了 —— 返回值与措辞都不同', () => {
  const load = makeLoader()
  const present = runLoader(load, fakeRead(() => realText, {}))
  const absent = runLoader(load, fakeRead(() => '', { missing: true }))

  // 在场 ⇒ 数组；缺席 ⇒ undefined
  assert.ok(Array.isArray(present), '① 在场 ⇒ 数组')
  assert.equal(absent, undefined, '② 缺席 ⇒ undefined')
  assert.notDeepEqual(present, absent, '★ ①②必须不同形')

  // ③ 在场但读不了 ⇒ 抛（用一条独立的捕获读它的"形状"）
  let thrown
  try { runLoader(load, fakeRead(() => '{ nope', {})) } catch (error) { thrown = error }
  assert.ok(thrown instanceof Error, '③ 在场但读不了 ⇒ 必须抛出一个 Error')
  assert.notEqual(thrown.message, undefined, '★ 而它必须带一条可读的理由')

  // ★ 三者两两不同形：① 是数组、② 是 undefined、③ 是抛出的 Error
  assert.equal(typeof absent, 'undefined', '② 的形状是 undefined')
  assert.notEqual(typeof thrown, typeof absent, '★ ②与③不同形（一个是值，一个是抛出）')
})

// ── 臂 6 ★★ 候选列表语义：第一个不存在 ⇒ 试第二个（不许因"第一个没有"就报错）─────
test('臂 6 ★★ 候选列表：第一个候选不存在时【必须继续试下一个】', () => {
  let calls = 0
  const contents = () => { calls += 1; return realText }
  const load = makeLoader()
  // 先让第一次读抛 ENOENT，第二次给出真实文本
  let first = true
  const planfulRead = (path) => {
    if (first) { first = false; const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e }
    return contents(path)
  }
  const result = runLoader(load, planfulRead)
  assert.equal(calls, 1, '★ 前置：第二个候选真的被读了')
  assert.ok(Array.isArray(result) && result.length === realCount,
    '★★ "试下一个候选"这条语义必须保住：候选列表里第一个不存在是【正常】的。'
    + '⇒ 只有 ENOENT 才 continue；别的失败一律不许静默。')
})

// ── 臂 7 ★★ 反向半边：非 ENOENT 的读失败【不许】被当成"下一个候选" ──────────────
test('臂 7 ★★ 反向半边：读失败但不是 ENOENT（如 EACCES）⇒ 必须抛，不许 continue', () => {
  const load = makeLoader()
  const deniedRead = () => {
    const error = new Error('EACCES: permission denied')
    error.code = 'EACCES'
    throw error
  }
  assert.throws(
    () => runLoader(load, deniedRead),
    /could not read/,
    '★★ 若这里仍 continue，则"权限不足"与"文件不存在"同形 ——'
    + '而它们一个是配置错了、一个是这棵树没有这份清单，补救动作相反。'
    + '★ 定向突变：删掉 isMissingFileError、改成"任何错误都 continue" ⇒ 本条红。',
  )
})
