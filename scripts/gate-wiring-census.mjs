#!/usr/bin/env node
/**
 * ── 判据接线普查（gate-wiring census）—— **只出读数，不接线** ─────────────────────
 *
 * 它回答的问题只有一句：
 *
 *     注册表里那 N 条判据，在 `src/` 里**到底有没有人去求值**？
 *
 * ── ★ 为什么需要它（本任务存在的理由）──────────────────────────────────────────
 *
 * 本仓记账最久的形态是 `unwired`（**装了但调不到**）：一条判据在 `ALL_GATES` 里
 * 排得整整齐齐、在 `/state` 里也能数到 `registered: 1`，而全仓**没有一个**
 * `.evaluate('<它那个位置>'` 调用点 —— 于是它**永远不会跑**，而这件事与
 * "跑了但通过了"在日志里**同形**（两者都什么也不发生）。
 *
 * 普查把这两件事在**读数上**分开，而不是去接线：接线会改行为，那需要人拍板。
 * ⇒ 本脚本**不 import `src/`、不改任何文件、不联网**，只读源码 + 读注册表。
 *
 * ── ★★ 三态（互斥，一个位置只能落一格）──────────────────────────────────────────
 *
 *   `wired`   已接线：`src` 里**至少有一个**真实的 `.evaluate('<point>', …)` 调用点。
 *   `zero`    零求值：位置上有**已注册判据**，而 `src` 里**一个调用点都没有**。
 *             ★ 这是缺陷态，也是本脚本存在的理由。
 *   `vacant`  空位置：位置上**一条判据都没注册**，也没有调用点。
 *             ★ 三态必须分开：把 `vacant` 并进 `zero` 会让"这里本来就没判据"
 *             污染缺陷读数；并进 `wired` 则更坏 —— 那正是"没接线"被读成"接了"。
 *
 * ── ★★ 已接线的两个子读数（也不是同一件事）──────────────────────────────────────
 *
 *   `wired-shown`      已接线**且**状态视图（`/state`）会求值它；
 *   `wired-not-shown`  已接线**但**状态视图不显示它。
 *
 * 后者的读法：`src/tools/status.ts` 只为它手里**有 ctx** 的位置求值，其余位置
 * 只报 `registered` / `evaluated: 0`（见该文件里 `NOT_EVALUATED_IN_STATUS` 的长注释）。
 * ⇒ "判据在流程里真的开火"与"控制台上看得到它开火"是两件事，本脚本拒绝把
 *   没有状态出口的已接线位置算成"显示"。
 *
 * 状态视图的求值面按**两层**解析，缺一层就会误报"不显示"：
 *   ① `status.ts` 里的字面调用点（`.evaluate('<point>'`）；
 *   ② `status.ts` import 的**本仓导出函数**体内的字面调用点（实测：`runtime`
 *      只经由 `evaluateRuntimeGates` 间接求值，直接 grep status.ts 会漏掉它）。
 * ★ 解析只做**一跳**（helper 自己的函数体，不追 helper 的 helper）—— 本仓的
 *   实际形状如此；跳数不足会在读数里表现为"not-shown"，而不是静默算成 shown。
 *
 * ── ★★★ 扫描口径（去注释，且不吃字符串里的假调用）────────────────────────────────
 *
 * 用 `grep` 扫 `.evaluate(` 会把**注释**里的示例算成调用点（本仓注释里到处是
 * `registry.evaluate('completion', …)`），于是"没接线"被读成"接了线"。
 * ⇒ 本脚本先跑一个**逐字符词法器**：块注释 `/* *\/`、行注释 `//` 一律抹成空格
 *   （换行保留 ⇒ 行号不变），字符串内部**打标记**；只有 **`.` 在代码里、
 *   参数字面量在字符串里**的匹配才算调用点。
 *   ★ 因此注释里的 `.evaluate('admission', …)` 与字符串字面量里的同一段文字
 *     **都不算**接线 —— 两者各有一条夹具臂。
 *
 * ── 运行方式与出口 ───────────────────────────────────────────────────────────────
 *
 *   node scripts/gate-wiring-census.mjs [--root <dir>] [--json]
 *
 *   `--root <dir>`   扫哪棵树（默认：本脚本所在仓库根）。也认环境变量
 *                    `GATE_WIRING_CENSUS_ROOT`（命令行优先）。夹具用它指向
 *                    `os.tmpdir()` 下的假源码树。
 *   `--json`         机器可读输出（夹具读它）；默认是人读的三态表。
 *
 *   退出码 **0**：普查**跑完了**（哪怕读到零求值 —— 缺陷是读数，不是脚本失败）。
 *   退出码 **2**：普查**没跑成**（`src/` 认不出 / 扫描失败 / 注册表载入失败 /
 *                 参数错误）。★ 这时**不输出任何接线读数** —— 没跑成不是
 *                 "全员已接线"，也不是"零求值"，它自成一态，并**必须说明原因**。
 *
 * 输出只走 stdout/stderr；不写文件、不联网、不碰 `src/` `lib/` `package.json`。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..')

/** 扫描的源码后缀（真实仓库是 `.ts`；带上 js 系是为了让夹具树不必伪装成 TS）。 */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])
/** 目录遍历时跳过的名字（不是源码面，且会拖慢/成环）。 */
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'coverage'])

/**
 * 一次「没跑成」：reason 是给人的原因，**必须**出现在输出里。
 * ★ 用异常而不是返回值，是为了让"哪里没读成"在 main 的一个 catch 里收口。
 */
class CensusNotRun extends Error {}

function parseArgs(argv) {
  let root = process.env.GATE_WIRING_CENSUS_ROOT ?? DEFAULT_ROOT
  let registryRoot = process.env.GATE_WIRING_CENSUS_REGISTRY ?? DEFAULT_ROOT
  let json = false
  const takeValue = (arg, index, flag) => {
    const value = argv[index + 1]
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new CensusNotRun(`${flag} requires a directory argument`)
    }
    return value
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') { json = true; continue }
    if (arg === '--root') { root = takeValue(arg, index, '--root'); index += 1; continue }
    if (arg.startsWith('--root=')) {
      const value = arg.slice('--root='.length)
      if (value === '') throw new CensusNotRun('--root requires a directory argument')
      root = value
      continue
    }
    if (arg === '--registry') { registryRoot = takeValue(arg, index, '--registry'); index += 1; continue }
    if (arg.startsWith('--registry=')) {
      const value = arg.slice('--registry='.length)
      if (value === '') throw new CensusNotRun('--registry requires a directory argument')
      registryRoot = value
      continue
    }
    throw new CensusNotRun(
      `unknown argument: ${arg} (usage: node scripts/gate-wiring-census.mjs [--root <dir>] [--registry <dir>] [--json])`,
    )
  }
  return { root: resolve(root), registryRoot: resolve(registryRoot), json }
}

/**
 * 逐字符词法器：把注释抹成空格（换行保留），并给每个字符打上类别标记。
 *
 * 标记：`0` 代码 / `1` 字符串内部 / `2` 注释。
 * ★ 字符串**内容保留**（位置名本身就在字符串里），只是打标记；调用点判定要求
 *   `.` 落在代码里、参数字面量落在字符串里（见 `findEvaluateCalls`）。
 *
 * @param {string} text - 源文件原文
 * @returns {{ code: string, mask: Uint8Array }} `code` 与原文**等长**、换行位置不变
 */
function lex(text) {
  const out = []
  const mask = new Uint8Array(text.length)
  let state = 'code'
  /** 当前字符串是用哪个引号打开的（`'` / `"` / `` ` ``）—— 关它必须是同一个。 */
  let quote = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (state === 'code') {
      if (char === '/' && next === '/') {
        out.push('  '); mask[index] = 2; mask[index + 1] = 2; index += 1; state = 'line'; continue
      }
      if (char === '/' && next === '*') {
        out.push('  '); mask[index] = 2; mask[index + 1] = 2; index += 1; state = 'block'; continue
      }
      out.push(char)
      if (char === "'" || char === '"' || char === '`') { state = 'string'; quote = char }
      continue
    }
    if (state === 'line') {
      if (char === '\n') { state = 'code'; out.push('\n') } else { mask[index] = 2; out.push(' ') }
      continue
    }
    if (state === 'block') {
      if (char === '*' && next === '/') {
        mask[index] = 2; mask[index + 1] = 2; out.push('  '); index += 1; state = 'code'; continue
      }
      mask[index] = 2
      out.push(char === '\n' ? '\n' : ' ')
      continue
    }
    /** state === 'string' */
    mask[index] = 1
    out.push(char)
    if (char === '\\') {
      if (index + 1 < text.length) { index += 1; mask[index] = 1; out.push(text[index]) }
      continue
    }
    /** ★ 关引号必须是**同一个**引号：`"…'…"` 里的那个 `'` 不结束字符串。 */
    if (char === quote) { state = 'code'; quote = '' }
  }
  return { code: out.join(''), mask }
}

/** 1-based 行号（与编辑器/grep 的口径一致）。 */
function lineAt(code, index) {
  let line = 1
  for (let cursor = 0; cursor < index; cursor += 1) if (code.charCodeAt(cursor) === 10) line += 1
  return line
}

/**
 * 找出一段代码里的 `.evaluate(...)` 调用点。
 *
 * 判为**字面量调用点**的三个条件（缺一不可，见文件头的扫描口径）：
 *   ① `.` 落在代码里（不在注释 / 字符串里）；
 *   ② 括号后的第一个实参是一个**纯字面量**字符串（位置名或变量名，不含插值）；
 *   ③ 该实参的字面量本身处在字符串状态里。
 *
 * 拿不到纯字面量的（例如 `.evaluate(point, …)`）进 `dynamic`，**不算接线** ——
 * 一个"位置名是运行时算出来的"调用点无法被证明接到了哪个位置，把它并进
 * `wired` 就是把"认不出"读成"接了"。
 *
 * @returns {{ literal: Array<{ point: string, line: number }>, dynamic: Array<{ line: number, text: string }> }}
 */
function findEvaluateCalls(code, mask) {
  const literal = []
  const dynamic = []
  const callPattern = /\.\s*evaluate\s*\(/g
  let match
  while ((match = callPattern.exec(code)) !== null) {
    const dot = match.index
    if (mask[dot] !== 0) continue
    let cursor = dot + match[0].length
    while (cursor < code.length && /\s/.test(code[cursor])) cursor += 1
    const quote = code[cursor]
    /**
     * ★ 开引号本身落在**代码**里（`mask === 0`），字符串**内容**才被标记为 1
     *   （见 `lex` —— 开/闭引号都不打标记，这样"注释里的引号"与"字符串里的引号"
     *   在 mask 上不同形）。⇒ 这里检查的是开引号 + 紧随其后的内容标记。
     */
    const opening = (quote === "'" || quote === '"' || quote === '`') && mask[cursor] === 0 && mask[cursor + 1] === 1
    if (opening) {
      let scan = cursor + 1
      let value = ''
      let closed = false
      let pure = true
      while (scan < code.length) {
        const char = code[scan]
        if (char === '\\' || char === '\n' || (quote === '`' && char === '$')) { pure = false; break }
        if (char === quote) { closed = true; break }
        value += char
        scan += 1
      }
      if (closed && pure) {
        literal.push({ point: value, line: lineAt(code, dot) })
        callPattern.lastIndex = scan + 1
        continue
      }
    }
    const snippet = code.slice(dot, Math.min(dot + 100, code.length)).split('\n')[0].trim()
    dynamic.push({ line: lineAt(code, dot), text: snippet })
  }
  return { literal, dynamic }
}

/** 递归收集源码文件（确定性顺序；不跟随符号链接）。 */
function collectSourceFiles(directory) {
  const files = []
  const walk = (current) => {
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        walk(absolute)
        continue
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(absolute)
    }
  }
  walk(directory)
  return files
}

/**
 * 扫一棵树：`<root>/src` 必须认得出、非空、可读；否则抛 `CensusNotRun`。
 *
 * ★ 三条"没跑成"必须与"零求值"分开：目录不存在 / 存在但没有源码 / 读文件失败。
 *   任何一条被吞掉，输出就会变成一张"全部已接线"的空表 —— 而那正是本任务
 *   验收 4 要防的事。
 */
function scanTree(root) {
  let stats
  try {
    stats = statSync(root)
  } catch (error) {
    throw new CensusNotRun(`root is not readable: ${root} (${error.message})`)
  }
  if (!stats.isDirectory()) throw new CensusNotRun(`root is not a directory: ${root}`)
  const srcDirectory = join(root, 'src')
  let srcStats
  try {
    srcStats = statSync(srcDirectory)
  } catch {
    throw new CensusNotRun(`src directory is not identifiable: ${srcDirectory} does not exist`)
  }
  if (!srcStats.isDirectory()) throw new CensusNotRun(`src directory is not identifiable: ${srcDirectory} is not a directory`)
  let absoluteFiles
  try {
    absoluteFiles = collectSourceFiles(srcDirectory)
  } catch (error) {
    throw new CensusNotRun(`src scan failed under ${srcDirectory}: ${error.message}`)
  }
  if (absoluteFiles.length === 0) {
    throw new CensusNotRun(`src directory is not identifiable: ${srcDirectory} contains no source files (${[...SOURCE_EXTENSIONS].join(', ')})`)
  }
  const files = []
  for (const absolute of absoluteFiles) {
    const relativePath = relative(root, absolute).split(sep).join('/')
    let raw
    try {
      raw = readFileSync(absolute, 'utf8')
    } catch (error) {
      throw new CensusNotRun(`src scan failed reading ${relativePath}: ${error.message}`)
    }
    const { code, mask } = lex(raw)
    files.push({ absolute, relativePath, code, mask })
  }
  return { srcDirectory, files }
}

/**
 * 读出 `src/tools/status.ts` 的**求值面**：它自己字面求值哪些位置，以及它 import
 * 的本仓 helper 体内求值哪些位置（一跳；见文件头）。
 *
 * 同时读出 `NOT_EVALUATED_IN_STATUS`（如果它还叫这个名字）以区分：
 *   · 状态视图不求值、且**自己声明过**不懂这个位置 ⇒ `not-shown (declared)`；
 *   · 状态视图不求值、且**没有声明** ⇒ `not-shown (undeclared)`。
 * ★ 后者是一个**独立的读数缺口**（例如后来新增的 `collection` 位置）：
 *   它与"声明了不求值"在日志里若同形，补台账的人会以为已经交代过了。
 */
function resolveStatusView(files) {
  const statusFile = files.find((file) => file.relativePath === 'src/tools/status.ts')
  if (statusFile === undefined) {
    return {
      available: false,
      relativePath: 'src/tools/status.ts',
      reason: 'src/tools/status.ts is not readable — the status-view axis is unavailable (it is NOT merged into "shown")',
      measuredEvaluated: [],
      declaredNotEvaluated: null,
      viaHelpers: [],
    }
  }
  const direct = findEvaluateCalls(statusFile.code, statusFile.mask).literal.map((site) => site.point)
  /** helper 定义表：导出函数的函数体（到第一条顶格 `}` 为止）—— 本仓的书写形状。 */
  const definitions = new Map()
  for (const file of files) {
    for (const found of file.code.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      const start = found.index
      const end = file.code.indexOf('\n}', start)
      definitions.set(found[1], { file, body: file.code.slice(start, end === -1 ? file.code.length : end), mask: file.mask })
    }
    for (const found of file.code.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=/g)) {
      const start = found.index
      const end = file.code.indexOf('\n}', start)
      definitions.set(found[1], { file, body: file.code.slice(start, end === -1 ? file.code.length : end), mask: file.mask })
    }
  }
  /**
   * 解析 status.ts 的具名 import：`import { a, b as c, type T } from './x.ts'`。
   * ★ 只认**值**导入（`type` 导入不可能被调用，解析它会把类型名误报成接线）。
   */
  const viaHelpers = []
  const points = new Set(direct)
  for (const imported of statusFile.code.matchAll(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*['"][^'"]+['"]/g)) {
    for (const entry of imported[1].split(',')) {
      const cleaned = entry.trim()
      if (cleaned === '' || /^type\s/.test(cleaned)) continue
      const parts = cleaned.split(/\s+as\s+/)
      const exportedName = parts[0].trim()
      const binding = (parts[1] ?? parts[0]).trim()
      const definition = definitions.get(exportedName) ?? definitions.get(binding)
      if (definition === undefined) continue
      /**
       * ★ 函数体切片会带上文件里**后面**的代码，于是同一文件里另一个函数的调用点
       *   可能被算进来。用标记检查挡住：调用点必须在 body 范围内 —— 这里用
       *   `findEvaluateCalls` 对 body 求，再按 body 去掉内容前的偏移对齐 mask。
       *   简化做法：对 body 重新 lex 一次（body 是原文子串，重 lex 与整文件一致）。
       */
      const relLex = lex(definition.body)
      const foundPoints = findEvaluateCalls(relLex.code, relLex.mask).literal.map((site) => site.point)
      if (foundPoints.length === 0) continue
      viaHelpers.push({ binding, exportedName, relativePath: definition.file.relativePath, points: [...new Set(foundPoints)] })
      for (const point of foundPoints) points.add(point)
    }
  }
  const declared = statusFile.code.match(/NOT_EVALUATED_IN_STATUS\s*(?::[^=]*)?=\s*\[([\s\S]*?)\]/)
  const declaredNotEvaluated = declared === null
    ? null
    : [...declared[1].matchAll(/['"]([A-Za-z0-9_.:-]+)['"]/g)].map((item) => item[1])
  return {
    available: true,
    relativePath: statusFile.relativePath,
    measuredEvaluated: [...points].sort(),
    directEvaluated: [...new Set(direct)].sort(),
    viaHelpers,
    declaredNotEvaluated,
  }
}

/**
 * 载入注册表（被接线普查的对象），失败 ⇒ 没跑成。
 *
 * `registryRoot` 默认是**本脚本所在的仓库**（真实注册表）。`--registry <dir>` 可以
 * 指向另一棵树的 `lib/gates/{index.js,registry.js}` —— 夹具用它把"源码树"与
 * "注册表"两件事分开摆：被测的是**接线读数**，不是"能不能把本仓的注册表载进来"。
 * ★ 刻意**不**从 `--root` 推导注册表位置：真实仓库里两者相同，但夹具树里
 *   `src/` 是合成的、`lib/` 却仍是真仓库的 —— 从 `--root` 推导会让夹具树
 *   直接"没跑成"（而那不是要被测的东西）。
 */
async function loadRegistry(registryRoot = DEFAULT_ROOT) {
  const modulePath = join(registryRoot, 'lib', 'gates', 'index.js')
  const registryModulePath = join(registryRoot, 'lib', 'gates', 'registry.js')
  let gates
  let registry
  try {
    gates = await import(pathToFileURL(modulePath).href)
    registry = await import(pathToFileURL(registryModulePath).href)
  } catch (error) {
    throw new CensusNotRun(`gate registry could not be loaded from ${modulePath}: ${error.message}`)
  }
  if (typeof gates.buildRegistry !== 'function') {
    throw new CensusNotRun(`gate registry could not be loaded: ${modulePath} does not export buildRegistry()`)
  }
  if (!Array.isArray(registry.INSERTION_POINTS)) {
    throw new CensusNotRun(`gate registry could not be loaded: ${registryModulePath} does not export INSERTION_POINTS`)
  }
  const list = gates.buildRegistry().list()
  return { list, insertionPoints: [...registry.INSERTION_POINTS], root: registryRoot }
}

/** 两态（wired/zero/vacant）与状态视图子读数的唯一产出点。 */
function buildCensus({ root, scan, registry, statusView }) {
  const callsByPoint = new Map()
  const dynamicCalls = []
  const unknownPoints = new Map()
  for (const file of scan.files) {
    const found = findEvaluateCalls(file.code, file.mask)
    for (const site of found.literal) {
      const bucket = callsByPoint.get(site.point) ?? []
      bucket.push({ file: file.relativePath, line: site.line })
      callsByPoint.set(site.point, bucket)
    }
    for (const site of found.dynamic) dynamicCalls.push({ file: file.relativePath, line: site.line, text: site.text })
  }
  for (const point of callsByPoint.keys()) {
    if (!registry.insertionPoints.includes(point)) unknownPoints.set(point, callsByPoint.get(point))
  }

  const statusViewFor = (point) => {
    if (!statusView.available) return 'unknown'
    if (statusView.measuredEvaluated.includes(point)) return 'shown'
    if ((statusView.declaredNotEvaluated ?? []).includes(point)) return 'not-shown (declared)'
    return 'not-shown (undeclared)'
  }

  const points = registry.insertionPoints.map((point) => {
    const gates = registry.list[point] ?? []
    const sites = [...(callsByPoint.get(point) ?? [])].sort((left, right) => (
      left.file < right.file ? -1 : left.file > right.file ? 1 : left.line - right.line
    ))
    const state = sites.length > 0 ? 'wired' : gates.length > 0 ? 'zero' : 'vacant'
    /** ★ 状态视图这一格只对**已接线**的位置有意义（零求值/空位置谈不上"显不显示"）。 */
    return { point, state, statusView: state === 'wired' ? statusViewFor(point) : null, registered: gates.length, gates, sites }
  })
  /**
   * ★ 互斥性在这里**结构性**保证，而不是靠调用方记得：`state` 是三选一的分支，
   *   同一个位置不可能同时进两个桶。
   */

  const pointIds = (state) => points.filter((entry) => entry.state === state).map((entry) => entry.point)
  const gateCount = (state) => points.filter((entry) => entry.state === state).reduce((total, entry) => total + entry.registered, 0)
  const wiredShown = points.filter((entry) => entry.state === 'wired' && entry.statusView === 'shown')
  const wiredNotShown = points.filter((entry) => entry.state === 'wired' && entry.statusView.startsWith('not-shown'))
  const wiredUnknown = points.filter((entry) => entry.state === 'wired' && entry.statusView === 'unknown')
  const sumGates = (subset) => subset.reduce((total, entry) => total + entry.registered, 0)

  const gates = points.flatMap((entry) => entry.gates.map((gate) => ({
    id: gate.id,
    point: entry.point,
    state: entry.state,
    statusView: entry.statusView,
  })))

  return {
    status: 'ran',
    exitCode: 0,
    root,
    src: { directory: relative(root, scan.srcDirectory).split(sep).join('/') || '.', sourceFiles: scan.files.length },
    registry: {
      insertionPoints: registry.insertionPoints,
      points: registry.insertionPoints.length,
      gates: gates.length,
    },
    statusView,
    /**
     * ★ 这些桶**互斥且键名分开** —— 没有任何一个计数是"总数"的别名。
     *   夹具臂 5 逐条钉住：交集为空、并集是全集、`wired.count !== registry.points`。
     */
    states: {
      wired: { count: pointIds('wired').length, points: pointIds('wired'), gates: gateCount('wired') },
      zero: { count: pointIds('zero').length, points: pointIds('zero'), gates: gateCount('zero') },
      vacant: { count: pointIds('vacant').length, points: pointIds('vacant'), gates: gateCount('vacant') },
      wiredShown: { count: wiredShown.length, points: wiredShown.map((entry) => entry.point), gates: sumGates(wiredShown) },
      wiredNotShown: { count: wiredNotShown.length, points: wiredNotShown.map((entry) => entry.point), gates: sumGates(wiredNotShown) },
      wiredStatusUnknown: { count: wiredUnknown.length, points: wiredUnknown.map((entry) => entry.point), gates: sumGates(wiredUnknown) },
    },
    points: points.map((entry) => ({
      point: entry.point,
      state: entry.state,
      statusView: entry.statusView,
      registered: entry.registered,
      sites: entry.sites,
      gateIds: entry.gates.map((gate) => gate.id),
    })),
    gates,
    unknownPointCalls: [...unknownPoints.entries()].map(([point, sites]) => ({ point, sites })),
    dynamicCalls,
  }
}

function renderText(census) {
  const lines = []
  lines.push('gate-wiring-census · 判据接线普查（只出读数，不接线）')
  lines.push(`root: ${census.root}`)
  lines.push(`src: ${census.src.directory} — ${census.src.sourceFiles} source files`)
  lines.push(`registry: ${census.registry.points} insertion points · ${census.registry.gates} registered gates`)
  if (census.statusView.available) {
    lines.push(
      `status view: ${census.statusView.relativePath} · measured-evaluated: ${census.statusView.measuredEvaluated.join(', ') || '(none)'}`
      + ` · declared-not-evaluated: ${(census.statusView.declaredNotEvaluated ?? []).join(', ') || '(none)'}`,
    )
    for (const helper of census.statusView.viaHelpers) {
      lines.push(`  via ${helper.binding}() in ${helper.relativePath} ⇒ ${helper.points.join(', ')}`)
    }
  } else {
    lines.push(`status view: unavailable — ${census.statusView.reason}`)
  }
  lines.push('')
  const { states } = census
  lines.push('── 两态（互斥；下面两个子读数不并态）──────────────────────────')
  lines.push(`已接线 (wired):      ${states.wired.count} point(s) · ${states.wired.gates} gate(s) — ${states.wired.points.join(', ') || '(none)'}`)
  lines.push(`  ├ 已接线且状态视图显示:    ${states.wiredShown.count} point(s) · ${states.wiredShown.gates} gate(s) — ${states.wiredShown.points.join(', ') || '(none)'}`)
  lines.push(`  └ 已接线但状态视图不显示:  ${states.wiredNotShown.count} point(s) · ${states.wiredNotShown.gates} gate(s) — ${states.wiredNotShown.points.join(', ') || '(none)'}`)
  if (states.wiredStatusUnknown.count > 0) {
    lines.push(`     ? 状态视图不可用（不并进任何一格）: ${states.wiredStatusUnknown.count} point(s) · ${states.wiredStatusUnknown.gates} gate(s) — ${states.wiredStatusUnknown.points.join(', ')}`)
  }
  lines.push(`零求值 (zero):       ${states.zero.count} point(s) · ${states.zero.gates} gate(s) — ${states.zero.points.join(', ') || '(none)'}`)
  lines.push(`空位置 (vacant):     ${states.vacant.count} point(s) · ${states.vacant.gates} gate(s) — ${states.vacant.points.join(', ') || '(none)'}`)
  lines.push('')
  lines.push('── 每个插入点 ────────────────────────────────────────────────')
  const header = `${'point'.padEnd(12)}${'state'.padEnd(8)}${'registered'.padEnd(12)}${'sites'.padEnd(7)}${'status-view'.padEnd(26)}sites`
  lines.push(header)
  for (const entry of census.points) {
    const where = entry.sites.length === 0
      ? '—'
      : entry.sites.map((site) => `${site.file}:${site.line}`).join(', ')
    lines.push(
      `${entry.point.padEnd(12)}${entry.state.padEnd(8)}${String(entry.registered).padEnd(12)}${String(entry.sites.length).padEnd(7)}${(entry.statusView ?? '—').padEnd(26)}${where}`,
    )
  }
  lines.push('')
  lines.push('── 每条判据 ──────────────────────────────────────────────────')
  for (const gate of census.gates) {
    lines.push(`[${gate.state}] ${gate.id.padEnd(38)} (${gate.point})`)
  }
  if (census.dynamicCalls.length > 0) {
    lines.push('')
    lines.push(`★ 动态求值点（位置名不是字面量，未计入接线读数）: ${census.dynamicCalls.length}`)
    for (const call of census.dynamicCalls) lines.push(`  ${call.file}:${call.line} — ${call.text}`)
  }
  if (census.unknownPointCalls.length > 0) {
    lines.push('')
    lines.push('★ 指向未注册位置的求值点（注册表不认识它，未计入接线读数）:')
    for (const call of census.unknownPointCalls) {
      lines.push(`  ${call.point} — ${call.sites.map((site) => `${site.file}:${site.line}`).join(', ')}`)
    }
  }
  return lines.join('\n')
}

function notRun({ json, root, reason }) {
  if (json === true) {
    process.stdout.write(`${JSON.stringify({ status: 'not-run', exitCode: 2, root, reason }, null, 2)}\n`)
  } else {
    process.stdout.write([
      'gate-wiring-census · 判据接线普查（只出读数，不接线）',
      `root: ${root}`,
      '没跑成 (NOT RUN)',
      `reason: ${reason}`,
      '→ 本次普查没有结论：两态一格都不输出（缺席不是 0，更不是「全员已接线」）。',
      '',
    ].join('\n'))
  }
  process.exitCode = 2
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    notRun({ json: process.argv.includes('--json'), root: process.cwd(), reason: error.message })
    return
  }
  try {
    const scan = scanTree(options.root)
    const registry = await loadRegistry(options.registryRoot)
    const statusView = resolveStatusView(scan.files)
    const census = buildCensus({ root: options.root, scan, registry, statusView })
    if (options.json) process.stdout.write(`${JSON.stringify(census, null, 2)}\n`)
    else process.stdout.write(`${renderText(census)}\n`)
    process.exitCode = 0
  } catch (error) {
    if (error instanceof CensusNotRun) {
      notRun({ json: options.json, root: options.root, reason: error.message })
      return
    }
    notRun({ json: options.json, root: options.root, reason: `census failed: ${error.stack ?? error.message}` })
  }
}

await main()
