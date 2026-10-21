/**
 * ── ★★★ `lib/client.js` 必须**字节可复现**（R19.1）──────────────────────────────────
 *
 * ── 这个文件抓的是什么 ────────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-22，同一个 commit、两棵树、同一份 src/）：
 *
 * ```
 * 主树   /Users/abab/Desktop/agent-teams-dev  ⇒ lib/client.js md5 f8567dd035e6…
 * worktree /tmp/wtt                            ⇒ lib/client.js md5 5690c8bbbf65…
 * ⇒ 同一份 src/、同一个 tsdown 配置，产出**字节不同**
 * ```
 *
 * ── 根因 ────────────────────────────────────────────────────────────────────────
 *
 * lightningcss 的 CSS Modules `[hash]` 由 **`filename`** 派生，而 `tsdown.config.ts`
 * 原来传的是 `filename: fileId`（**绝对路径**）⇒ 类名 radix 随树的**位置**变。
 * ★ 而 `lib/client.js` 是被**提交进仓库**的产物 ⇒ 每换一次树就多 484 行纯路径 diff。
 *
 * ── ★★ 为什么这不是"worktree 的固有属性"（推翻旧判断）──────────────────────────────
 *
 * `docs/REQUIREMENTS.md` §19 原文逐字：「主树可复现，worktree 不可复现。
 * **这不是缺陷，是 worktree 的固有属性。**」
 * ⇒ **那句话错了一半**：不可复现的成因是**我们给一个会哈希路径的工具传了绝对路径**，
 *   而 worktree 只是让这个 bug **显形**（同一条相对路径在两棵树里绝对路径不同）。
 *   「worktree 让它显形」≠「worktree 是它的理由」。
 *
 * ── 本文件钉住的读数是**判据本身**（不是"我这次跑了一下")────────────────────────────
 *
 * 它**不**去 build 两棵树（那要几分钟且依赖磁盘布局）。它钉的是**成因**：
 * ```
 * ① 传给 lightningcss 的 `filename` **不许**是绝对路径
 * ② 它必须是**相对仓库根**的 POSIX 形式（`a/b.css`，不是 `a\b.css`）
 * ③ ★ 反向半边：一个绝对路径喂进同一个派生函数，**必须**得出不同的类名
 * ```
 * ★ ③ 是这一组里最要紧的一条：没有它，「类名与路径无关」就只能靠读代码相信。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { stripComments } = await import(join(ROOT, 'scripts', 'requirements-claims.mjs'))

const CONFIG = stripComments(readFileSync(join(ROOT, 'tsdown.config.ts'), 'utf8'))

/**
 * 取 `transform({ … })` 里 `filename:` 那一行的**表达式**（剥注释后的源码文本）。
 * ★ 取表达式而不是"文件里有没有 `relative(`" —— 后者会被任何一处 `relative` 满足。
 */
function filenameExpression() {
  /**
   * ★★ 取到**行尾**而不是第一个逗号：`relative(ROOT_DIR, fileId).split(sep).join('/')`
   *   本身含逗号（`relative(a, b)` 的实参分隔）。
   *   MEASURED（本条的第一版红在这里）：按第一个逗号截断 ⇒ 表达式被截成
   *   `relative(ROOT_DIR` ⇒ 臂 2 判"没有 POSIX 归一化"，而**代码里其实有** ——
   *   一个取值器截断导致的**假红**，与被测代码无关。
   */
  const match = /transform\(\{[\s\S]*?filename:\s*(.+),\s*\n/.exec(CONFIG)
  assert.ok(match !== null, '★ 找不到 `transform({ … filename: … })` —— 配置形状变了，本条判据要跟着改')
  return match[1].trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：不许把绝对路径交给 lightningcss
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 1：CSS Modules 的 `filename` **不是**绝对路径（不是裸 `fileId`）', () => {
  const expression = filenameExpression()
  assert.notEqual(
    expression, 'fileId',
    '★★ 传裸 `fileId`（绝对路径）⇒ `[hash]` 随树的位置变 ⇒ 产物不可复现（R19.1 的根因）',
  )
  assert.match(
    expression, /relative\(/,
    '★ 必须用 `relative(...)` 把绝对路径折成相对路径；否则同一条路径在两棵树里哈希不同',
  )
  assert.doesNotMatch(expression, /^(['"`])?\//, '★ 不许出现以 `/` 开头的字面量绝对路径')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：`.split(sep).join('/')` —— Windows 上也要产出同一份哈希
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 2：相对路径被折成 **POSIX** 形式（`sep` → `/`）', () => {
  const expression = filenameExpression()
  assert.match(
    expression, /split\(sep\)\.join\(['"]\/['"]\)/,
    '★★ 不归一化分隔符 ⇒ Windows 上 `a\\b.css` 与 Linux 上 `a/b.css` 哈希不同（同一份 src 两个产物）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★ 反向半边 —— 绝对路径**确实**会改变哈希（证明这条判据有判别力）
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 3（反向半边）：同一个派生，喂绝对路径与相对路径**得不同类名**', async () => {
  const { transform } = await import('lightningcss')
  const css = Buffer.from('.a { color: red }\n.b { color: blue }\n')
  const names = (filename) => {
    const out = transform({ filename, code: css, cssModules: { pattern: '[hash]_[local]' }, minify: true })
    return Object.entries(out.exports ?? {}).sort(([x], [y]) => (x < y ? -1 : 1)).map(([, value]) => value.name).join(',')
  }
  const relativeName = names('src/client/ActivityPanel.module.css')
  const absoluteName = names('/Users/someone/a-very-long-different-path/src/client/ActivityPanel.module.css')
  const absoluteName2 = names('/tmp/another-totally-different-root/src/client/ActivityPanel.module.css')
  assert.notEqual(
    relativeName, absoluteName,
    '★★ 判据的前提：绝对路径**确实**会改变类名 —— 否则臂 1 是恒真的（"防了一个不会发生的事"）',
  )
  assert.notEqual(absoluteName, absoluteName2, '★★ 两个不同的绝对根 ⇒ 两套不同的类名（这就是"换树就脏"）')
  /** ★ 而**同一条相对路径**两次 ⇒ 必须一致（这条是"可复现"的正面）。 */
  assert.equal(relativeName, names('src/client/ActivityPanel.module.css'))
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：产物里不许出现**本机绝对路径**作为 CSS 类名的一部分
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 4：`lib/client.js` 里没有以仓库绝对路径开头的 **CSS 类名**', () => {
  const bundle = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  /**
   * ★★ 只查**类名位置**，不查整份文件：esbuild 的 `//#region` 注释里确实会带
   *   绝对路径（那是 module id，不参与 CSS）。若查整份文件，这条臂会
   *   因为一个**无害的注释**永远红 —— 而一个恒红的臂会被学会忽略。
   */
  const classNames = [...bundle.matchAll(/\.([A-Za-z0-9_-]*_[A-Za-z0-9_-]+)/g)].map((match) => match[1])
  const fromRoot = classNames.filter((name) => name.includes('Users') || name.includes('private') || name.includes('Desktop'))
  assert.deepEqual(
    fromRoot.slice(0, 5), [],
    '★★ 类名里出现绝对路径 ⇒ 又回到"换一棵树就多 484 行 diff"',
  )
})
