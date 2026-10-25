#!/usr/bin/env node
/**
 * ── P2 · 按改动面选夹具（快环的选择器）──────────────────────────────────────────
 *
 * **输入**：一组"改动了什么"的路径（相对仓库根，POSIX 风格）。
 * **输出**：该跑的夹具清单（相对 `scripts/`），**按名字排序**（顺序稳定 ⇒ 读数可复跑）。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────────────
 *
 * MEASURED（队长，`docs/EFFICIENCY-PROBE.md`）：全环 `test:gates` 88 个夹具 **39.8s**，
 * 而**其余 21 步全是亚秒级** ⇒ **唯一的瓶颈就是它**。⇒ 迭代时不该跑全部。
 *
 * ★ 而"少跑"必须**有判据**，否则它会退化成"跑得少的那些绿了就说绿"。
 *   本文件给的判据是：**改动面 ∩ 夹具的读取面 ≠ ∅**。
 *
 * ── ★★★ 约束二（计划 §7 逐字）：全仓扫描夹具**豁免**裁剪 ────────────────────────
 *
 * > 「它们**扫全仓** ⇒ **任何改动都可能影响它们**；按 `inScope` 跳过它们，
 * >   跳过的恰恰是"管 `inScope` 之外"的那一类。」
 *
 * ⇒ 本选择器**永远**把「全仓扫描夹具」加进结果，**不参与**任何裁剪判断。
 *   这一条是**硬编码在流程里**的（见 `ALWAYS`），不是"记得把它们放进去"。
 *
 * **口径（t44 已复核，两个都对，本文件用 A）**：
 *   A: `grep -lE "walk\(|readdirSync" scripts/gate-*.test.mjs`  ⇒ **17**（宽）
 *   B: `grep -l  "readdirSync"      scripts/gate-*.test.mjs`  ⇒ 15
 * ★ 用 A —— 才涵盖"任何改动都可能影响"的**完整**集合。
 *
 * ── ★★ 选择规则（不猜：只读夹具自己的源码）─────────────────────────────────────
 *
 * 一个夹具 `f` 被选中，当且仅当**至少一条**成立：
 *
 *   ① `f` 是**全仓扫描**的（豁免，恒选）；
 *   ② 改动路径**直接就是** `scripts/<f>`（改了夹具自己）；
 *   ③ 改动路径出现在 `f` 的**源码文本**里 —— 形如 `src/…` / `scripts/…` / `lib/…`
 *      的**路径字面量**。★ 这是"这个夹具读过什么"的**可核代理**：
 *      夹具若要读一个文件，它**必须**把那个路径写下来（本仓的夹具全是这么写的）。
 *
 * ★ ③ 是**代理读数**，所以它有**两个方向**：
 *     · **可能多选**（夹具里提到某路径但只在注释里）—— 多选**是安全的**（多跑不误判）；
 *     · **绝不漏掉"碰了全仓"的** —— 因为那一类被 ① 兜住。
 *   ⇒ ★ 而一般情形下它**可能漏掉**一个"读了某文件却没把路径写下来"的夹具。
 *     那正是 ① 存在的原因，也是本条口径的**边界**（见 `docs/P-LINE-EFFICIENCY.md` §5）。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 全仓扫描夹具的**判定**（口径 A）—— 与 `docs/P-LINE-EFFICIENCY.md` §4 逐字同源。
 *
 * ★ **实测复跑**（2026-10-15）：`grep -lE "walk\(|readdirSync" scripts/gate-*.test.mjs | wc -l` ⇒ **17**。
 * ★ 本函数与那条 grep **必须一致** —— 所以在 `docs/` 里写明了两者，且由
 *   `scripts/verify-fast.mjs` 的一条自检断言它们相等（口径漂了会红）。
 */
export function isRepoWideScanner(source) {
  return /walk\(|readdirSync/.test(source)
}

/** 所有 `gate-*.test.mjs`（与 `package.json` 的 `test:gates` 同一个集合的**起点**）。 */
export function gateFixtures() {
  return readdirSync(join(ROOT, 'scripts'))
    .filter((name) => /^gate-.*\.test\.mjs$/.test(name))
    .sort()
}

/**
 * 从一个夹具的源码里抽出它引用的**仓库路径字面量**。
 *
 * ★ 只认**带目录前缀**的形状（`src/…` / `scripts/…` / `lib/…` / `docs/…` / `test/…`），
 *   因为裸文件名（如 `fixtures/x.json`）无法区分是仓库路径还是相对路径。
 *   ★ 抽出来的东西**仅供参考**（用于匹配），**不**被当作"它一定读了这些"。
 */
export function referencedRepoPaths(source) {
  const found = new Set()
  const pattern = /\b(src|scripts|lib|docs|test)\/([A-Za-z0-9_.@/-]+)/g
  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}/${match[2]}`)
  }
  return [...found]
}

/**
 * 选出该跑的夹具。
 *
 * @param changed 本次改动的路径（相对仓库根）。**空数组 = 没有改动面** ⇒ 只跑豁免集合。
 * @returns `{ selected, always, total, why }`
 *   ★ `why` 逐条给出"它为什么被选中"—— 让读数**可解释**，而不是一个黑盒清单。
 */
export function selectFixtures(changed) {
  const all = gateFixtures()
  const changedSet = changed.map((path) => path.replace(/^\.\//, '')).sort()
  const selected = new Map()
  const always = []

  for (const fixture of all) {
    const source = readFileSync(join(ROOT, 'scripts', fixture), 'utf8')
    const reasons = []
    /** ① 全仓扫描 ⇒ **豁免**，恒选。 */
    if (isRepoWideScanner(source)) {
      reasons.push('repo-wide scanner (exempt from inScope trimming)')
      always.push(fixture)
    }
    /** ② 夹具自己被改。 */
    if (changedSet.includes(`scripts/${fixture}`)) reasons.push('the fixture itself changed')
    /** ③ 改动路径出现在它的源码里。 */
    for (const path of changedSet) {
      if (path === `scripts/${fixture}`) continue
      if (referencedRepoPaths(source).includes(path)) reasons.push(`reads ${path}`)
    }
    if (reasons.length > 0) selected.set(fixture, reasons)
  }

  return {
    selected: [...selected.keys()].sort(),
    always: always.sort(),
    total: all.length,
    why: selected,
  }
}

/** CLI：`node scripts/select-fixtures.mjs <path>...` 或 `--changed-from-git`。 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  let changed = args
  if (args.includes('--changed-from-git')) {
    const { execFileSync } = await import('node:child_process')
    changed = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').map((line) => line.trim()).filter((line) => line !== '')
  }
  const result = selectFixtures(changed)
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    process.stdout.write(`changed: ${changed.length} path(s)\n`)
    process.stdout.write(`selected ${result.selected.length} / ${result.total} fixtures`
      + ` (of which ${result.always.length} repo-wide scanners are exempt)\n`)
    for (const fixture of result.selected) {
      process.stdout.write(`  ${fixture}  ← ${result.why.get(fixture).join('; ')}\n`)
    }
  }
}
