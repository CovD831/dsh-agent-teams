#!/usr/bin/env node
/**
 * ── ★★★ 逐臂隔离检查：把"整份跑绿 ⇒ 每条臂单独也绿"从**信念**变成**证据** ──────────
 *
 * 用法：
 * ```sh
 *   node scripts/arm-isolation-check.mjs <test-file> [--pattern <regex>] [--timeout <ms>]
 * ```
 *
 * ── 为什么需要这个脚本（实测，不是假设）────────────────────────────────────────
 *
 * `scripts/readout-container.test.mjs` **旧版**（383 行 / 8 臂）出现过这一幕：
 *
 * ```
 *   整份跑     8 pass / 0 fail        ← 看起来全绿
 *   逐臂单跑   臂 4 ✗  臂 5 ✗  臂 6 ✗  ← 三条单独跑都红
 * ```
 *
 * 原因：那三条读的是**臂 3 先登记了 evidence** 这个**执行顺序**留下的副作用。
 * 整份跑时顺序恰好对 ⇒ **永远发现不了**。而 `node --test` 默认就是顺序跑，
 * ⇒ "整份绿"这个信号对**顺序依赖**是**结构性盲**的。
 *
 * ★ 它的坏法比"红"更糟：顺序依赖的夹具**在 CI 上长期全绿**，一旦有人
 *   ① 给某条臂加 `.skip`、② 调整声明顺序、③ 单独跑一条臂去调试，
 *   就会撞上一片看起来"莫名"的红，然后被误判成"夹具坏在当下"而不是"夹具不可拆"。
 *
 * ── 本脚本做什么（三步，全部只读）─────────────────────────────────────────────
 *
 * ① **整份**跑一次 `node --test --test-reporter=tap <file>`，从 TAP 里取臂名。
 *    ★ **不解析源码**（不 `grep test(`）：源码里的 `test(` 可能出现在注释、
 *      字符串、模板里，正则猜名字必然猜错；TAP 的 `ok N - <name>` 是**运行期事实**。
 * ② 对每条臂单独跑 `node --test --test-name-pattern=<转义后的名字> <file>`。
 * ③ 出矩阵：`整份 / 单跑`，并把两类异常分开点名。
 *
 * ── 两类异常（本脚本存在的全部理由）──────────────────────────────────────────
 *
 * ```
 *   [顺序依赖]  整份 ok 、单跑 FAIL    ⇒ 这条臂靠别的手臂的副作用活着 ⇒ 夹具不可拆
 *   [只单跑红]  整份 FAIL、单跑 ok      ⇒ 另一类问题（整份里被别的手臂污染 / 状态串了）
 * ```
 *
 * ★ 退出码：**只有"每条臂整份 ok 且单跑 ok"才 0**；任何一行出现异常都是 1
 *   （包括"整份就红"。理由：本脚本不能因为"单跑碰巧绿了"就给一份**红的夹具**发通行证）。
 *   用法/环境错误（文件不存在、臂名提取失败）是 2。
 *
 * ── ★★★ 本族地雷：**退出码 0 不等于"跑到了"**（本脚本的第一性判据）──────────────
 *
 * 实测（node v22.22，见 `--help` 同款措辞）：
 *
 * ```
 *   node --test --test-name-pattern='<匹配不到任何东西的名字>' <file>
 *     ⇒ 退出码 0，TAP 里还报 `# tests 1 / # pass 1`（那 1 条是文件级的壳，不是你的臂）
 * ```
 *
 * ⇒ 任何"只看退出码"的逐臂检查，都会把**写错/漏转义的名字报成"全部单跑通过"**。
 *   这是今晚同一族的第四颗雷（前三颗都是"绿了但没跑到"）。
 *
 * ⇒ **本脚本的"单跑 ok"判据 = ① 退出码 0 ∧ ② TAP 里出现该臂名的非 skip 结果行 ∧ ③ 它们全 ok。**
 *   缺 ② 就是 `NO-RUN`（不是 ok）；缺 ③ 就是 `FAIL`。判据写在 `singles` 那一段，改之前先读这段。
 *
 * ── 三条实现纪律（都是为了不给出**假绿**）──────────────────────────────────────
 *
 * ★ **"单跑 ok" 必须是"这条臂真的跑了且过了"**，不是"退出码 0"（见上一节）。
 *   所以单跑也用 TAP，并要求输出里**存在该臂名的非 skip 结果**才算数。
 *
 * ★ **超时算 FAIL 并标注 `TIME`**（默认 120s/臂）。不许挂死：到点按**进程组**杀
 *   （`node --test` 会把夹具塞进子进程，只杀父进程会留下孤儿）。
 *
 * ★ **臂名按字面转义**后喂给 `--test-name-pattern`。臂名里全是 `()〔〕{}★⇒…`，
 *   漏一个就变成"过滤掉全部用例 ⇒ 假绿"（见上）。
 *   ★ 另有一层易漏的转义：**TAP reporter 自己会转义名字**（`\`→`\\`、`#`→`\#`），
 *   不还原就会"多转义一次 ⇒ 匹配不到 ⇒ 退出码 0"。见 `unescapeTapName`。
 *
 * ── 已知边界（如实声明，不要当成"覆盖了"）────────────────────────────────────
 *
 * ① 臂名里若**字面包含** ` # SKIP` / ` # TODO`，TAP 解析会把它当指令（极罕见）。
 * ② 只覆盖**同文件内**的顺序依赖。跨文件的（`--test` 多文件共享状态）不在范围内：
 *    本脚本一条臂一个进程，天然没有跨文件污染，也就测不到它。
 * ③ 不判断"依赖"的性质：单跑红只说明**它需要别人留下的东西**，不说明是谁留的。
 * ④ 对齐：状态列在前、臂名在后 ⇒ 不需要 CJK 宽度表就能对齐（★ 不引宽度表：
 *    锚点/星号/破折号是 East Asian Ambiguous，按列数对齐会**看起来对齐而实际不对**）。
 */
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import process from 'node:process'

const USAGE = `用法：node scripts/arm-isolation-check.mjs <test-file> [选项]

  <test-file>           要检查的测试文件（只读，本脚本不写它）

选项：
  --pattern <regex>     只检查臂名匹配该正则的臂（默认全部）
  --timeout <ms>        每条臂单跑的超时，默认 120000；超时计 FAIL 并标注 TIME（不会挂死：到点按进程组杀）
  --full-timeout <ms>   整份跑（用来提取臂名）的超时，默认 300000
  --concurrency <n>     并发跑几条臂（默认 1）。★ 默认 1 是刻意的：并行会引入
                        共享临时目录/端口的争用，那是另一类红，会污染本脚本的信号
  --json                输出机器可读摘要（矩阵仍在 stderr，方便人看）
  --verbose             额外打印每条臂的耗时；失败时附 TAP 失败片段
  --truncate <n>        矩阵里臂名截断到 n 个字符（默认 0 = 不截断）
  -h, --help            显示本帮助

退出码：0 = 每条臂整份 ok 且单跑 ok；1 = 发现异常；2 = 用法/环境错误（提取不到臂名等）
★ 判据不是退出码：--test-name-pattern 匹配不到任何东西时 node 也返回 0（还报 pass 1）
  ⇒ "单跑 ok" 要求 TAP 里**真的出现该臂名的非 skip 结果行**，否则这一行标 NO-RUN（不是 ok）
`

// ── 参数 ───────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    file: null,
    pattern: null,
    timeoutMs: 120_000,
    fullTimeoutMs: 300_000,
    concurrency: 1,
    json: false,
    verbose: false,
    truncate: 0,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const takeValue = (name) => {
      const eq = arg.indexOf('=')
      if (eq !== -1) return arg.slice(eq + 1)
      i += 1
      if (i >= argv.length) throw new Error(`${name} 缺少值`)
      return argv[i]
    }
    if (arg === '-h' || arg === '--help') return { help: true }
    else if (arg === '--json') opts.json = true
    else if (arg === '--verbose') opts.verbose = true
    else if (arg.startsWith('--pattern')) opts.pattern = takeValue('--pattern')
    else if (arg.startsWith('--full-timeout')) opts.fullTimeoutMs = Number(takeValue('--full-timeout'))
    else if (arg.startsWith('--timeout')) opts.timeoutMs = Number(takeValue('--timeout'))
    else if (arg.startsWith('--concurrency')) opts.concurrency = Number(takeValue('--concurrency'))
    else if (arg.startsWith('--truncate')) opts.truncate = Number(takeValue('--truncate'))
    else if (arg.startsWith('-')) throw new Error(`未知选项：${arg}`)
    else if (opts.file === null) opts.file = arg
    else throw new Error(`多余的参数：${arg}`)
  }
  if (!opts.file) throw new Error('缺少 <test-file>')
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) throw new Error('--timeout 必须是正数（毫秒）')
  if (!Number.isFinite(opts.fullTimeoutMs) || opts.fullTimeoutMs <= 0) throw new Error('--full-timeout 必须是正数（毫秒）')
  if (!Number.isFinite(opts.concurrency) || opts.concurrency < 1) throw new Error('--concurrency 必须是 >= 1 的整数')
  return opts
}

/** ★ 唯一一处正则转义：臂名要**逐字**喂给 `--test-name-pattern`，任何元字符漏转义都会
 *  变成"匹配到别的臂"或"一条都匹配不到"——后者会被误读成**全绿**。 */
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ── 跑一次 `node --test`（带超时 + 进程组清理）──────────────────────────────────

const liveChildren = new Set()

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
    else child.kill('SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* 已经没了 */
    }
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of liveChildren) killTree(child)
    process.exit(130)
  })
}

const MAX_CAPTURE = 8 * 1024 * 1024

/**
 * @returns {Promise<{ timedOut: boolean, code: number|null, signal: string|null, stdout: string, stderr: string, durationMs: number }>}
 */
function runTap(file, { namePattern, timeoutMs, label }) {
  return new Promise((resolvePromise) => {
    const args = ['--test', '--test-reporter=tap']
    if (namePattern !== null && namePattern !== undefined) args.push(`--test-name-pattern=${namePattern}`)
    args.push(file)

    const startedAt = Date.now()
    // ★ detached ⇒ 自成进程组 ⇒ 超时时能连 `node --test` 派生的夹具子进程一起杀掉
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    liveChildren.add(child)

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs)

    const collect = (chunk, sink) => {
      const text = chunk.toString('utf8')
      if (sink === 'out' && stdout.length < MAX_CAPTURE) stdout += text
      else if (sink === 'err' && stderr.length < MAX_CAPTURE) stderr += text
    }
    child.stdout.on('data', (chunk) => collect(chunk, 'out'))
    child.stderr.on('data', (chunk) => collect(chunk, 'err'))

    const finish = (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      liveChildren.delete(child)
      // 超时后进程组里可能还有残渣，再补一刀（幂等）
      if (timedOut) killTree(child)
      resolvePromise({
        timedOut,
        code,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        label,
      })
    }

    child.on('error', (error) => {
      stderr += `\n[arm-isolation-check] 无法启动子进程：${error.message}\n`
      finish(null, null)
    })
    child.on('close', (code, signal) => finish(code, signal))
  })
}

// ── TAP 解析：只认 `ok / not ok` 行，其余（YAML 诊断块、stdout 注释）一律跳过 ──────

const TEST_LINE_RE = /^(not ok|ok)\b\s*(\d+)?\s*(?:-\s*)?(.*)$/

/**
 * ★★★ TAP 的**描述符转义**（实测，node v22.22）：`\\` → `\\\\`、`#` → `\\#`。
 *
 * ```
 *   真实臂名   A 单反斜杠 \ 尾巴        TAP 里   A 单反斜杠 \\ 尾巴
 *   真实臂名   B 井号 # 尾巴            TAP 里   B 井号 \# 尾巴
 *   真实臂名   C 双反斜杠 \\ 尾巴       TAP 里   C 双反斜杠 \\\\ 尾巴
 * ```
 *
 * ⇒ 不还原的话，带 `\` 或 `#` 的臂名会被**多转义一次**再喂给 `--test-name-pattern`，
 *   结果是"一条都匹配不到 ⇒ 退出码 0" ⇒ **这条臂假绿**。
 *   （本脚本自己就踩过：`臂 4 反斜杠 \ 与点 .` 单跑返回 0 但一条没跑。）
 *
 * ★ 单趟扫描，不能先 `replace(/\\\\/g,'\\')` 再 `replace(/\\#/g,'#')`：
 *   `\\\\` 先变成 `\\`，第二步会把它误当转义序列。
 */
function unescapeTapName(raw) {
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '\\' && (raw[i + 1] === '\\' || raw[i + 1] === '#')) {
      out += raw[i + 1]
      i += 1
    } else {
      out += raw[i]
    }
  }
  return out
}

/**
 * @returns {Array<{ depth: number, ok: boolean, skip: boolean, todo: boolean, name: string, path: string, pathTrusted: boolean, order: number }>}
 */
function parseTap(text) {
  const entries = []
  /** `# Subtest:` 头栈：用来还原「套件 > 子测试」的完整名字（--test-name-pattern 匹配的正是完整名） */
  const stack = []
  let inYaml = false

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const trimmed = line.trim()
    if (!trimmed) continue

    if (inYaml) {
      if (trimmed === '...') inYaml = false
      continue
    }
    if (trimmed === '---') {
      inYaml = true
      continue
    }
    if (trimmed.startsWith('TAP version') || trimmed.startsWith('#')) {
      const header = /^#\s*Subtest:\s*(.*)$/.exec(trimmed)
      if (header) {
        const depth = line.length - line.trimStart().length
        while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop()
        stack.push({ depth, name: unescapeTapName(header[1]) })
      }
      continue
    }

    const match = TEST_LINE_RE.exec(trimmed)
    if (!match) continue
    const ok = match[1] === 'ok'
    let rest = match[3] ?? ''
    let skip = false
    let todo = false
    // ★ 指令检测必须在**还原转义之前**做：臂名里的字面 `#` 在 TAP 里是 `\#`，
    //   还原成 `#` 后再检测就会把 `… \ # SKIP …` 这种名字误判成 skip 指令。
    const directive = /\s+#\s*(SKIP|TODO)\b(.*)$/i.exec(rest)
    if (directive) {
      skip = directive[1].toUpperCase() === 'SKIP'
      todo = directive[1].toUpperCase() === 'TODO'
      rest = rest.slice(0, directive.index)
    }
    const name = unescapeTapName(rest.trim())
    const depth = line.length - line.trimStart().length

    while (stack.length > 0 && stack[stack.length - 1].depth > depth) stack.pop()
    const top = stack[stack.length - 1]
    const pathTrusted = Boolean(top && top.depth === depth && top.name === name)
    const path = pathTrusted ? stack.map((frame) => frame.name).join(' ') : name

    entries.push({ depth, ok, skip, todo, name, path, pathTrusted, order: entries.length })
  }
  return entries
}

/** 叶子 = 没有子条目的条目。臂 = 叶子。
 *
 * ★ 两个方向都看，因为 TAP 里**套件自身的结果行排在它的子测试之后**：
 *
 * ```
 *    # Subtest: 外层 (suite)        ← 头，没有结果行
 *        ok 1 - 内层 A              ← 子（先出结果）
 *        not ok 2 - 内层 B
 *    not ok 1 - 外层 (suite)        ← 父亲的结果行在**后面**
 * ```
 *
 * ⇒ 只看"后面还有没有更深的行"会把**套件**误当叶子（于是把一条 suite 当成一条臂去单跑，
 *   它的"红"其实是子测试的红，会把隔离结论搅浑）。 */
function leafEntries(entries) {
  const leaves = []
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]
    const hasChildBefore = i > 0 && entries[i - 1].depth > entry.depth
    let hasChildAfter = false
    for (let j = i + 1; j < entries.length; j += 1) {
      if (entries[j].depth <= entry.depth) break
      hasChildAfter = true
      break
    }
    if (!hasChildBefore && !hasChildAfter) leaves.push(entry)
  }
  return leaves
}

// ── 输出 ───────────────────────────────────────────────────────────────────────

const pad = (text, width) => text + ' '.repeat(Math.max(0, width - text.length))
const shorten = (text, limit) => (limit > 0 && text.length > limit ? `${text.slice(0, limit - 1)}…` : text)
const STATUS = { ok: 'ok', fail: 'FAIL', skip: 'skip', timeout: 'TIME', missing: 'NO-RUN' }

/** 从失败的 TAP 输出里摘前几行失败原因，够贴 PR 就行 */
function failureHint(text, limit = 6) {
  const lines = []
  let inYaml = false
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const trimmed = line.trim()
    if (trimmed === '---') {
      inYaml = true
      continue
    }
    if (inYaml) {
      if (trimmed === '...') {
        inYaml = false
        if (lines.length > 0) break
        continue
      }
      if (/^(error|code|failureType|expected|actual|operator):/.test(trimmed)) lines.push(trimmed)
      else if (/^-?\s{2,}/.test(line) && lines.length > 0 && !/^\s*(stack|at |file:)/.test(line)) {
        lines.push(trimmed)
      }
      if (lines.length >= limit) break
    }
  }
  return lines
}

// ── 主流程 ─────────────────────────────────────────────────────────────────────

async function pool(items, concurrency, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`arm-isolation-check: ${error.message}\n\n${USAGE}`)
    return 2
  }
  if (opts.help) {
    process.stdout.write(USAGE)
    return 0
  }

  if (!existsSync(opts.file) || !statSync(opts.file).isFile()) {
    process.stderr.write(`arm-isolation-check: 文件不存在：${opts.file}\n`)
    return 2
  }

  const emit = (text) => process.stderr.write(`${text}\n`)

  emit(`arm-isolation-check ▸ ${opts.file}`)
  emit(`  node ${process.version} | 超时 ${opts.timeoutMs}ms/臂（整份 ${opts.fullTimeoutMs}ms）| 并发 ${opts.concurrency}`)

  // ① 整份跑
  const full = await runTap(opts.file, { namePattern: null, timeoutMs: opts.fullTimeoutMs, label: 'full' })
  if (full.timedOut) {
    emit(`\n✗ 整份跑超时（>${opts.fullTimeoutMs}ms）⇒ 无法提取臂名。先把整份跑通，或调大 --full-timeout。`)
    return 2
  }
  const fullEntries = parseTap(full.stdout)
  let arms = leafEntries(fullEntries)

  // ★ 整份跑在**加载阶段**就炸掉时，TAP 只有一条以文件名命名的条目 ⇒ 那不是臂。
  const looksLikeFileLevelFailure =
    arms.length === 0 || (arms.length === 1 && full.code !== 0 && /\.(?:[cm]?[jt]s)$/.test(arms[0].name))
  if (looksLikeFileLevelFailure) {
    emit('\n✗ 提取不到臂名：整份跑在加载/声明阶段就失败了，没有可检查的臂。')
    emit('  ⇒ 先修整份（本脚本不能替代"夹具本身是红的"这件事）。')
    // ★ 加载期崩栈在 TAP 的**头部**（`# Error [ERR_MODULE_NOT_FOUND]: …`），结果摘要在**尾部**
    //   ⇒ 两头都摘；只摘一头会漏掉真正的原因。
    const head = full.stdout.split('\n').filter((line) => line.trim() !== '').slice(0, 12)
    emit('  TAP 头部（崩栈）：')
    for (const line of head) emit(`    ${line}`)
    emit('  TAP 尾部（结果摘要）：')
    for (const line of full.stdout.trimEnd().split('\n').slice(-8)) emit(`    ${line}`)
    for (const line of full.stderr.trimEnd().split('\n').slice(-8)) if (line.trim()) emit(`    ${line}`)
    return 2
  }

  if (opts.pattern) {
    let filter
    try {
      filter = new RegExp(opts.pattern)
    } catch (error) {
      process.stderr.write(`arm-isolation-check: --pattern 不是合法正则：${error.message}\n`)
      return 2
    }
    arms = arms.filter((arm) => filter.test(arm.path))
    if (arms.length === 0) {
      process.stderr.write(`arm-isolation-check: --pattern 没有匹配任何臂（共 ${leafEntries(fullEntries).length} 条）\n`)
      return 2
    }
  }

  const untrusted = arms.filter((arm) => !arm.pathTrusted)
  emit(`  整份：${arms.length} 条臂（退出码 ${full.code ?? 'null'}，${full.durationMs}ms）`)
  if (untrusted.length > 0) {
    emit(`  ⚠ ${untrusted.length} 条臂的完整名无法从 TAP 的 # Subtest 头还原，退化为裸名匹配：`)
    for (const arm of untrusted.slice(0, 3)) emit(`      · ${arm.path}`)
  }

  // ② 逐臂单跑
  emit('')
  const singles = await pool(arms, opts.concurrency, async (arm, index) => {
    const pattern = escapeRegex(arm.path)
    const result = await runTap(opts.file, { namePattern: pattern, timeoutMs: opts.timeoutMs, label: arm.path })
    const entries = parseTap(result.stdout)
    // ★ "跑了" ≠ "退出码 0"：模式写错会让 node 过滤掉全部用例并返回 0 ⇒ 必须看到这条臂的结果行
    const matched = entries.filter((entry) => entry.name === arm.name)
    const ran = matched.filter((entry) => !entry.skip && !entry.todo)
    const ok = result.code === 0 && ran.length > 0 && ran.every((entry) => entry.ok)
    process.stderr.write(
      `  [${index + 1}/${arms.length}] ${ok ? 'ok  ' : result.timedOut ? 'TIME' : 'FAIL'} ${arm.path}${opts.verbose ? ` (${result.durationMs}ms)` : ''}\n`,
    )
    return {
      arm,
      pattern,
      ranCount: ran.length,
      ok,
      timedOut: result.timedOut,
      code: result.code,
      signal: result.signal,
      durationMs: result.durationMs,
      hint: ok ? [] : failureHint(result.stdout),
      output: result.stdout,
    }
  })

  // ③ 矩阵
  const fullSkippedInFullRun = new Set(arms.filter((arm) => arm.skip).map((arm) => arm.path))
  const rows = arms.map((arm, index) => {
    const single = singles[index]
    const fullStatus = arm.skip ? STATUS.skip : arm.ok ? STATUS.ok : STATUS.fail
    // ★ 「单跑 ok」的判据是**看到了这条臂的非 skip 结果行**，不是退出码：
    //   --test-name-pattern 匹配不到任何东西时 node 会把用例全过滤掉并返回 0。
    const singleStatus = single.timedOut
      ? STATUS.timeout
      : single.ranCount > 0
        ? (single.ok ? STATUS.ok : STATUS.fail)
        : arm.skip
          ? STATUS.skip
          : STATUS.missing
    let anomaly = null
    if (fullStatus !== STATUS.skip) {
      if (fullStatus === STATUS.ok && singleStatus !== STATUS.ok) anomaly = '顺序依赖'
      else if (fullStatus === STATUS.fail && singleStatus === STATUS.ok) anomaly = '只整份红'
      else if (fullStatus === STATUS.fail && singleStatus !== STATUS.ok) anomaly = '两者都红'
    }
    return { arm, single, fullStatus, singleStatus, anomaly, index: index + 1 }
  })

  const orderDependent = rows.filter((row) => row.anomaly === '顺序依赖')
  const fullOnlyRed = rows.filter((row) => row.anomaly === '只整份红')
  const bothRed = rows.filter((row) => row.anomaly === '两者都红')
  const patternMissed = singles.filter((single) => !single.ok && single.ranCount === 0 && !single.timedOut)
  const truncated = rows.map((row) => shorten(row.arm.path, opts.truncate))

  emit('')
  // ★ 状态列在前（ASCII，定宽）、臂名在后（不定宽）⇒ 对齐**不需要** CJK 宽度表。
  //   表头这几个汉字（整/份/单/跑/臂）都是 East Asian Wide，按 2 列算即可：
  //   3 + 「整份」(4+2) + 「单跑」(4+4) + 臂  —— 这是**唯一**一处硬编码列宽，字符集固定。
  emit(`#  ${'整份'}  ${'单跑'}    ${'臂'}`)
  emit('-'.repeat(58))
  for (const row of rows) {
    const note = row.anomaly === '顺序依赖'
      ? row.singleStatus === STATUS.timeout
        ? `   ← 整份绿、单跑超时（>${opts.timeoutMs}ms）：它单独跑会挂死，或不靠别人的副作用就不退出`
        : row.singleStatus === STATUS.missing
          ? '   ← 整份绿、单跑没跑到它：模式没匹配上（见下方警告），**不是 ok**'
          : '   ← 整份绿、单跑红：它依赖别的手臂留下的副作用'
      : row.anomaly === '只整份红'
        ? '   ← 单跑绿、整份红：整份里被别的臂污染 / 状态串了'
        : row.anomaly === '两者都红'
          ? '   ← 整份红、单跑也红：它自己坏了（不是隔离问题）'
          : ''
    emit(`${pad(String(row.index), 3)}${pad(row.fullStatus, 6)}${pad(row.singleStatus, 8)}${truncated[row.index - 1]}${note}`)
  }

  if (opts.verbose) {
    for (const row of rows) {
      if (row.anomaly === null) continue
      emit('')
      emit(`  ── #${row.index} ${row.arm.path}`)
      emit(`     pattern = ${row.single.pattern}`)
      emit(`     单跑退出码 ${row.single.code}${row.single.signal ? ` (signal ${row.single.signal})` : ''} | 跑到 ${row.single.ranCount} 条 | ${row.single.durationMs}ms`)
      for (const line of row.single.hint) emit(`     | ${line}`)
    }
  }
  if (patternMissed.length > 0) {
    emit('')
    emit(`⚠ ${patternMissed.length} 条臂的单跑里没有出现该臂的结果行 ⇒ 模式没匹配上（转义/名字漂移）。`)
    emit('  这不算"单跑 ok"：node 会把用例全过滤掉并返回 0，只读退出码就会假绿。')
  }
  if (fullSkippedInFullRun.size > 0) {
    emit(`  注：${fullSkippedInFullRun.size} 条臂在整份里被 skip，未计入隔离结论。`)
  }

  // ④ 结论
  const bad = rows.filter((row) => row.anomaly !== null)
  const orderDepRed = orderDependent.filter((row) => row.singleStatus === STATUS.fail)
  const orderDepOdd = orderDependent.filter((row) => row.singleStatus !== STATUS.fail)
  emit('')
  if (bad.length === 0) {
    // ★ 有 --pattern 时不许说"本夹具可逐臂单跑"：那是对**整份夹具**的宣称，而只查了一个子集。
    emit(
      opts.pattern
        ? `结论：--pattern '${opts.pattern}' 过滤后的 ${rows.length} 条臂 整份 ok / 单跑 ok（**不是**对整个夹具的结论）。`
        : `结论：${rows.length} 条臂 整份 ok / 单跑 ok —— 未发现顺序依赖，本夹具可逐臂单跑。`,
    )
  } else {
    const detail = []
    if (orderDepRed.length > 0) {
      detail.push(`${orderDepRed.length} 条臂整份绿但单跑红（#${orderDepRed.map((row) => row.index).join(', #')}）⇒ 本夹具**不可拆**：它们依赖别的手臂的副作用`)
    }
    if (orderDepOdd.length > 0) {
      detail.push(`${orderDepOdd.length} 条臂整份绿但单跑不是 ok（#${orderDepOdd.map((row) => row.index).join(', #')}，超时/没跑到）⇒ 本夹具**不可拆**：单独跑时这条臂不稳`)
    }
    if (fullOnlyRed.length > 0) {
      detail.push(`${fullOnlyRed.length} 条臂单跑绿但整份红（#${fullOnlyRed.map((row) => row.index).join(', #')}）⇒ 整份里被别人的状态污染`)
    }
    if (bothRed.length > 0) {
      detail.push(`${bothRed.length} 条臂整份红、单跑也红（#${bothRed.map((row) => row.index).join(', #')}）⇒ 它自己坏了，先修它`)
    }
    emit(`结论：${detail.length > 0 ? detail.join('；') : `${bad.length} 条臂异常`}。`)
  }

  const summary = {
    file: opts.file,
    node: process.version,
    timeoutMs: opts.timeoutMs,
    fullTimeoutMs: opts.fullTimeoutMs,
    fullRun: { code: full.code, timedOut: full.timedOut, durationMs: full.durationMs, armCount: rows.length },
    arms: rows.map((row) => ({
      index: row.index,
      name: row.arm.path,
      pattern: row.single.pattern,
      full: row.fullStatus,
      single: row.singleStatus,
      anomaly: row.anomaly,
      singleExitCode: row.single.code,
      singleDurationMs: row.single.durationMs,
      singleMatchedTests: row.single.ranCount,
    })),
    orderDependent: orderDependent.map((row) => row.index),
    fullOnlyRed: fullOnlyRed.map((row) => row.index),
    bothRed: bothRed.map((row) => row.index),
    verdict: bad.length === 0 ? 'isolated' : 'not-isolated',
  }
  if (opts.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)

  return bad.length === 0 ? 0 : 1
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    process.stderr.write(`arm-isolation-check: 内部错误：${error?.stack ?? error}\n`)
    process.exitCode = 2
  },
)
