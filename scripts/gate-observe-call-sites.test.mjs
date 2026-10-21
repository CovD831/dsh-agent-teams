/**
 * ── ★★★ 采集的**每一个**调用点都必须喂齐输入面（R11.4 / N1.2 的第三处）───────────────
 *
 * ── 这个文件抓的是什么 ────────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-21 审计）：
 *
 * ```
 * $ grep -rn "loadIndex" src/ --include=*.ts | grep -v evolution/
 *   src/tools/shared/entities.ts:5163  ✅  source ✅
 *   src/tools/create-task.ts:628       ✅  source ✅
 *   src/tools.ts:2380                  ❌  source ❌   ← edit_plan 汇合点
 * ```
 *
 * ★★ 而**修复之后落盘的那 5 条信号全部来自 `edit_plan`**：
 *
 * ```
 * e-0045..e-0049  edit_plan  ["dedupe:unmeasured","cooldown:unmeasured",
 *                             "attributable:unmeasured","immunity:ok"]
 * ```
 *
 * ⇒ **修好的两条路一条新信号都没产出过，还在出货的那条正是没修的那条。**
 *   这是「看起来修了」最贵的一种形态：读数上 `collected` 有了（R11.2 绿），
 *   而三条判据仍然 `unmeasured` —— 两个读数各自都没错，合起来才说得清问题。
 *
 * ── ★ 判据为什么是"按调用点逐个数"，而不是一条 grep ───────────────────────────────
 *
 * 一条 `grep -c source: src/tools.ts` 会被**任何**一处 `source:` 满足 ——
 * 包括与 `observe` 无关的代码。⇒ 本文件按 `void observe({ … })` **切块**，
 * 逐块问"这一块的输入面齐不齐"。它问的是**每一个**调用点，不是一个总和。
 *
 * ── 臂 3 是这一组里最要紧的一条 ──────────────────────────────────────────────────
 *
 * 「缺的格子**被点名**」：只报"有一处不齐"会让人去猜是哪一处、缺哪一格。
 * 而本仓记账过的最贵形态正是"一个读数说得出有问题、说不出是什么问题"。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toolsSourceFiles } from './tools-source.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const { stripComments } = await import(join(ROOT, 'scripts', 'requirements-claims.mjs'))

/**
 * 把一份源码切成「每一个 `void observe({ … })` 调用块」。
 *
 * ★ 用**大括号配平**而不是正则到行尾：`observe` 的参数是一个对象字面量，
 *   跨二十几行，且里面有嵌套对象（`evaluateCollection: async (…) => …`）。
 *   按行切会把 `evaluateCollection` 的**闭包体**切出去，于是"有没有 loadIndex"
 *   会在一个不属于它的块里被答成有。
 */
function observeBlocks(file) {
  const text = stripComments(readFileSync(file, 'utf8'))
  const blocks = []
  const marker = /void observe\(\{/g
  let match
  while ((match = marker.exec(text)) !== null) {
    const start = match.index
    const open = text.indexOf('{', start)
    let depth = 0
    let end = open
    for (let index = open; index < text.length; index += 1) {
      if (text[index] === '{') depth += 1
      else if (text[index] === '}') {
        depth -= 1
        if (depth === 0) {
          end = index
          break
        }
      }
    }
    blocks.push({ file, body: text.slice(open, end + 1), line: text.slice(0, start).split('\n').length })
  }
  return blocks
}

/** 全部调用点（跨 `src/tools/**` 与 `src/tools.ts`）。 */
function allCallSites() {
  return toolsSourceFiles().flatMap((file) => observeBlocks(file))
}

/** 一个调用块里有没有某一格（只看**顶层键**：`\n  key:` 或 `key:` 后接冒号）。 */
function hasKey(body, key) {
  return new RegExp(`(^|[\\s{,])${key}\\s*:`, 'm').test(body)
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★ 核心臂 —— 每一个调用点都喂了 source 与 loadIndex
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 1：每一个 `void observe({…})` 调用点都喂了 `source` 与 `loadIndex`', () => {
  const sites = allCallSites()
  assert.ok(sites.length >= 3, `★ 只找到 ${sites.length} 个采集调用点 —— 少于 3 个说明切块器坏了，而不是"都齐了"`)
  const incomplete = sites
    .filter((site) => !hasKey(site.body, 'source') || !hasKey(site.body, 'loadIndex'))
    .map((site) => `${site.file}:${site.line} `
      + `source=${hasKey(site.body, 'source')} loadIndex=${hasKey(site.body, 'loadIndex')}`)
  assert.deepEqual(
    incomplete, [],
    '★★ 采集调用点的输入面不齐 ⇒ `cooldown` 会答 unmeasured，而**那个数看起来像判据不行**，'
    + '不像一个没接的格子。修法：给那一处补 `source: <where 的字面量>` 与 `loadIndex`。',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：调用点数量本身是一个读数（少一个 ⇒ 有人把采集拆了）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 2：采集调用点的**数量**恰好是 3（三个汇合点，不是"至少有一个"）', () => {
  /** ★ 用**相对仓库根**的路径，不用 `slice(-2)` —— 后者会把 `shared/entities.ts` 与
   *  `tools/shared/entities.ts` 压成同一个名字，而"三个调用点来自两个文件"与
   *  "三个调用点来自三个文件"在读数是不同的事。 */
  const files = allCallSites()
    .map((site) => site.file.slice(ROOT.length + 1))
    .sort()
  assert.deepEqual(
    files,
    ['src/tools.ts', 'src/tools/create-task.ts', 'src/tools/shared/entities.ts'],
    '★ 三个汇合点：`edit_plan`（B）· `validateCreateTask` · `captureFriction`。'
    + '少一个不是"更干净"，是有一条拒绝路径不再进台账。',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：缺的那一格必须被**点名**（不许只说"有一处不齐"）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 3：不齐时，报错里必须点名**是哪个文件哪一行、缺哪一格**', (t) => {
  const fake = [{ file: 'src/fake.ts', line: 42, body: '{ stateRoot, evaluateCollection }' }]
  t.diagnostic('本条臂的可打印形状（同一段拼接逻辑，供复核）：')
  const rendered = fake
    .filter((site) => !hasKey(site.body, 'source') || !hasKey(site.body, 'loadIndex'))
    .map((site) => `${site.file}:${site.line} source=${hasKey(site.body, 'source')} loadIndex=${hasKey(site.body, 'loadIndex')}`)
  t.diagnostic(rendered.join('\n'))
  assert.deepEqual(rendered, ['src/fake.ts:42 source=false loadIndex=false'])
  assert.ok(rendered[0].includes('src/fake.ts') && rendered[0].includes('42'))
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：`evaluateCollection` 必须在场（否则整条采集不会跑）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 4：每一个调用点都喂了 `evaluateCollection`（否则四条判据一条都不会跑）', () => {
  const missing = allCallSites()
    .filter((site) => !hasKey(site.body, 'evaluateCollection'))
    .map((site) => `${site.file}:${site.line}`)
  assert.deepEqual(missing, [])
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：反向半边 —— 切块器真的能切开（不是把整个文件当一个块）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 5（反向半边）：三个调用点被切成**三个**互不相同的块', (t) => {
  const sites = allCallSites()
  const bodies = new Set(sites.map((site) => site.body))
  assert.equal(bodies.size, sites.length, '★ 两个调用点共用一个块 ⇒ 切块器把整份文件当成了一块')
  for (const site of sites) {
    assert.ok(site.body.length < 4000, `★ ${site.file}:${site.line} 的块有 ${site.body.length} 字符 —— 大得像整个文件`)
    assert.ok(site.body.startsWith('{') && site.body.endsWith('}'), `★ ${site.file}:${site.line} 的块不是一个大括号配平的片断`)
  }
  t.diagnostic(sites.map((site) => `${site.file}:${site.line} (${site.body.length} chars)`).join('\n'))
})
