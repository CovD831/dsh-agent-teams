#!/usr/bin/env node
/**
 * ── P1 · 快环（`pnpm verify:fast`）──────────────────────────────────────────────
 *
 * 跑**按改动面选出的**判据夹具（见 `scripts/select-fixtures.mjs`），而不是全部 88 个。
 * MEASURED（2026-10-15，本 worktree）：全环 88 个 ≈ **44s**；快环典型 **17–22 个**。
 *
 * ── ★★★ 约束一（计划 §7 逐字）：快环结果**不得进入任何终态裁决 / 派工判据** ────────
 *
 * > 「少跑夹具 ⇒ 判定面**变小** ⇒ 快环"绿"只说明"跑过的那部分绿"，**不说明整体通过**。
 * >   ★ 为什么必须有：**V 线（无人值守）正在制造"用快环结果做派工决策的诱惑"** ——
 * >   一旦有人那么做，"**没跑**"就会静默变成"**通过**"。"
 *
 * ★★ 而 t45 的 FF-3 指出：**此前它只是一句话，不是任务** ⇒ 本文件把它做成**可静态断言**。
 *
 * ── 怎么做到的（三条，各自可核）───────────────────────────────────────────────
 *
 * **① 产物落在"快环自己的"目录里，且带一个只读标记。**
 *    `verify:fast` 的产物写到 `.agent-teams/fast-ring/last-run.json`（gitignored），
 *    形状里**只有一个字段**：`{ mode: 'fast', ran: [...], skipped: [...], at }`。
 *    ★ **没有 `ok` / `verdict` / `blockers` / `gate`** —— 一个"通过与否"的字段，
 *      因为**快环没有资格下那个结论**（它没跑全部）。这是**结构上的**，
 *      而不是"记得不要写"。
 *
 * **② 静态断言：`src/` 里不许有人读这个产物。**
 *    `assertFastRingIsNonAuthoritative()` 扫 `src/**`，若出现
 *    `.agent-teams/fast-ring` / `fast-ring` / `verify:fast` 的**代码级引用**
 *    ⇒ **当场报红**。理由：那个目录之所以叫 `fast-ring`、之所以不在 `src/` 能算出的
 *    位置里，就是为了让"谁都在读它"这件事**可被机械检查**。
 *
 * **③ 反向半边（★ 最强的一条）：人为让快环结果流进 `verdict` ⇒ 断言必须红。**
 *    见 `scripts/verify-fast.mjs --self-test`：它**真的**去构造一份"被污染的"
 *    `src/` 副本（把 fast-ring 的读数写进一个 `verdict` 赋值），再跑同一条断言，
 *    断言**必须**报红。没有这一条的"检查"与"通过"在报告里**同形**。
 *
 * ── 退出码（★ 三态，不许合并）─────────────────────────────────────────────────
 *
 *     0  快环通过（**只代表"跑过的那部分"通过** —— 见上面的约束一）
 *     1  快环有失败
 *     2  **测不了**（选不出夹具 / 拉起失败）—— 与 0 不同形
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { gateFixtures, selectFixtures } from './select-fixtures.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 快环产物的目录名 —— **它是约束一的可检查面**。
 * ★ 改名会让 `assertFastRingIsNonAuthoritative()` 的扫描失去目标 ⇒ 两者必须一起改；
 *   而它们都在本文件里，且有一条自检（见 `--self-test`）。
 */
const MARKER = 'fast-ring'

/** 改动面：优先用显式参数，否则用 `git diff --name-only HEAD`。 */
function changedPaths(args) {
  const explicit = args.filter((arg) => !arg.startsWith('--'))
  if (explicit.length > 0) return explicit
  try {
    return execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').map((line) => line.trim()).filter((line) => line !== '')
  } catch {
    return []
  }
}

/**
 * ── ★★★ 约束一的静态断言（可复跑）──────────────────────────────────────────────
 *
 * 「快环结果不得进入任何终态裁决 / 派工判据」的**机械形式**：
 *   `src/**` 的**代码**里不许出现指向快环产物的引用。
 *
 * ★ 只扫**代码**（剥掉注释与字符串里的散文？—— 不，**连字符串也算**）：
 *   一个 `join(pluginRoot(), '.agent-teams', 'fast-ring')` 恰恰**就是**要说清的那种读法，
 *   而它藏在字符串里 ⇒ ★ **不许剥字符串**，否则这条断言抓不到它。
 *   （★ 注释**要**剥：本仓的注释里到处在**讨论**这件事 —— 讨论不是读取。）
 */
export function assertFastRingIsNonAuthoritative(rootDir = ROOT) {
  const offenders = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.tsx?$/.test(entry.name)) continue
      const raw = readFileSync(full, 'utf8')
      /** 剥注释（块 + 行），**保留**字符串。 */
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      for (const [lineNo, line] of code.split('\n').entries()) {
        if (line.includes(MARKER) || line.includes('verify:fast') || line.includes('fast_ring')) {
          offenders.push(`${full.slice(rootDir.length + 1)}:${lineNo + 1}: ${line.trim().slice(0, 120)}`)
        }
      }
    }
  }
  walk(join(rootDir, 'src'))
  return offenders
}

/**
 * ── ★★ 反向半边：证明上面那条断言**有分辨力** ────────────────────────────────────
 *
 * ★ 没有它，"检查通过"与"检查根本没在检查"在报告里**同形**（本仓记账最久的形态）。
 *
 * 做法：造一个**临时副本** `src/`，往里放一个**故意违规**的文件
 * （把快环读数写进一个 `verdict`），再跑**同一条**断言 ⇒ **必须**报出至少一条。
 * ★ 用的是**真函数**（不是另写一份逻辑）—— 否则测的是"反向半边自己"。
 */
export function selfTestReverseHalf() {
  /**
   * ★ 私有副本，不是共享树（`gate-shared-artifact-writes` 的判据要求）：
   *
   * 最初这里写的是 `join(ROOT, '.agent-teams', 'fast-ring-selftest')` —— 那是
   * **在共享树上写**，于是反向半边**自己**触发了「不许往共享处写」那条判据
   * （`scripts/verify-fast.mjs:118/119/120/128/134 → shared alias`）。
   *
   * ★ 而那条判据给的正确修法逐字是：「把写的地方挪到**【私有副本】**（见臂 3 的
   * 那种写法），**而不是加白名单**」。它第 42 行另写明「`mkdtempSync(join(tmpdir(), …))`
   * 是**本仓一贯的隔离手法**」。
   */
  const scratch = mkdtempSync(join(tmpdir(), 'fast-ring-selftest-'))
  mkdirSync(join(scratch, 'src'), { recursive: true })
  writeFileSync(join(scratch, 'src', 'offender.ts'), [
    '// a file that DOES read the fast ring — the assertion must catch this',
    'export function bad() {',
    "  const p = join(pluginRoot(), '.agent-teams', 'fast-ring', 'last-run.json')",
    "  return { verdict: readFileSync(p, 'utf8') }",
    '}',
  ].join('\n'))
  const found = assertFastRingIsNonAuthoritative(scratch)
  rmSync(scratch, { recursive: true, force: true })
  return found
}

/**
 * 写产物 —— ★ 形状里**刻意没有** `ok` / `verdict` / `blockers` / `gate`。
 *
 * ★★ 落在【私有副本】而不是共享树（`gate-shared-artifact-writes` 的判据要求）：
 *   最初这里写 `.agent-teams/fast-ring/last-run.json` —— 那**在共享树上写**，
 *   于是这条断言当场报出 5 处 `shared`（`scripts/verify-fast.mjs:118-134`）。
 *
 *   判据给的修法逐字是「把写的地方**挪到私有副本**，**而不是加白名单**」。
 *   而实测确认它可以挪：**全仓没有任何东西读 `last-run.json`**
 *   （`grep -rn "last-run.json" scripts/verify.mjs scripts/gate-*.test.mjs` ⇒ 空）。
 *   ⇒ 它是快环**自己**的运行记录，**没有第二方消费** —— 那不满足白名单
 *   "为什么它非写共享不可"那个唯一的问题，所以它不属于白名单那一档。
 *
 * ★ 而它同时也不再污染仓库：`mkdtempSync(join(tmpdir(), …))` 是本仓一贯的隔离手法
 *   （见该判据 :110）。★ 副作用：进程退出后这份记录不再留存 —— 那是**取舍**，
 *   而"不留痕"正是这条判据想要的那一边。
 */
function writeState(payload) {
  const dir = mkdtempSync(join(tmpdir(), 'fast-ring-state-'))
  writeFileSync(join(dir, 'last-run.json'), `${JSON.stringify(payload, null, 2)}\n`)
}

async function main(args) {
  /**
   * ── 自检模式（`--self-test`）：只跑静态断言与它的反向半边 ──────────────────────
   * ★ 它是**可独立复跑**的 —— 不依赖任何夹具，因此"约束一"可以在**任何时刻**被验证，
   *   而不必先跑一遍快环。
   */
  if (args.includes('--self-test')) {
    const real = assertFastRingIsNonAuthoritative()
    const planted = selfTestReverseHalf()
    process.stdout.write(`[fast-ring] constraint-1 static assertion\n`)
    process.stdout.write(`  real src/ offenders : ${real.length}`
      + `${real.length === 0 ? ' ✅' : ' ❌'}\n`)
    for (const line of real) process.stdout.write(`    ${line}\n`)
    process.stdout.write(`  reverse half (planted): ${planted.length}`
      + `${planted.length > 0 ? ' ✅ (the assertion has discriminating power)' : ' ❌ (it cannot fail — it is not an assertion)'}\n`)
    for (const line of planted) process.stdout.write(`    ${line}\n`)
    /**
     * ── ★★ 约束二的自检：全仓扫描夹具**必须恒在**快环里 ───────────────────────────
     *
     * ★ 契约口径 A 的读数（17）与 `isRepoWideScanner()` 的读数**必须相等** ——
     *   两者是**同一件事的两种表达**（一句 grep 与一个函数），而它们会分叉。
     *   ⇒ 把"相等"做成断言：口径漂了、或有人给豁免加了个"聪明"的跳过条件，都会红。
     *   ★ 而第二条断言是**约束二的实质**：**无论改动面是什么形状**，那 17 个**恒在**。
     */
    const wide = selectFixtures([]).always
    const shapes = [['src/foo.ts'], ['scripts/bar.mjs'], ['docs/baz.md'], [], ['README.md']]
    const staysEverywhere = shapes.every((changed) => {
      const picked = selectFixtures(changed).selected
      return wide.every((fixture) => picked.includes(fixture))
    })
    process.stdout.write(`[fast-ring] constraint-2 exemption\n`)
    process.stdout.write(`  repo-wide scanners always selected: ${wide.length}`
      + `${wide.length === 17 ? ' ✅ (matches grep -lE "walk\\(|readdirSync" 口径 A)' : ` ❌ (expected 17, got ${wide.length})`}\n`)
    process.stdout.write(`  exempt under every changed-path shape:`
      + ` ${shapes.length} shapes checked → ${staysEverywhere ? '✅ always present' : '❌ a shape dropped one'}\n`)
    return real.length === 0 && planted.length > 0 && wide.length === 17 && staysEverywhere ? 0 : 1
  }

  const changed = changedPaths(args)
  const { selected, always, total, why } = selectFixtures(changed)
  if (selected.length === 0) {
    process.stderr.write('[fast-ring] could not select any fixture ⇒ unmeasured (NOT "passed")\n')
    return 2
  }
  /**
   * ★★ 约束一：产物**先写，且只写"跑了什么 / 没跑什么"**。绝不写"通过与否"。
   *   ⇒ 下一个人（或 V 线）读到的是一份**清单**，不是一份**裁决**。
   *
   * ★ 形状里**刻意没有** `ok` / `verdict` / `blockers` / `gate` 四个字段 ——
   *   它们全都是"下结论"的词，而快环**没有资格**下那个结论。
   *   ★ 而"没跑的那部分"要说出来（`skipped`）：一份只说"我跑了什么"的清单会让人
   *     以为"没列出来的不存在" —— 那是本仓记账最久的形态。
   */
  writeState({
    mode: 'fast',
    at: new Date().toISOString(),
    ran: selected,
    skipped: gateFixtures().filter((name) => !selected.includes(name)),
    changed,
  })
  process.stdout.write(`[fast-ring] ${selected.length} / ${total} fixtures`
    + ` (repo-wide scanners exempt: ${always.length})\n`)
  process.stdout.write(`[fast-ring] NOTE: this ring is NOT a verdict — it ran a SUBSET.`
    + ` Delivery requires the full ring (\`pnpm verify\`).\n`)

  const files = selected.map((name) => join('scripts', name))
  const child = spawn(process.execPath, ['--test', ...files], { cwd: ROOT, stdio: 'inherit' })
  return await new Promise((resolve) => child.on('close', (code) => resolve(code === 0 ? 0 : 1)))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2))
}
