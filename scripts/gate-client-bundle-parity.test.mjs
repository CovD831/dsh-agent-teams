import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ── ★★★ 臂：源码里的注册 id，必须【也在浏览器实际加载的那个 bundle 里】──────────────
 *
 * ── 它防的那个缺陷（MEASURED，2026-10-17，队长本人犯的）─────────────────────────
 *
 * 一个"回到工作区"的按钮写进了源码、过了 `tsc`、过了两个夹具、过了全量
 * ⇒ ★★ **而用户看不见它。**
 *
 * 根因：**本仓的 client 代码被构建两次**
 *
 *     ① tsdown 出【逐文件】产物 → `lib/client/*.js`
 *     ② ★ 而它【同时】打包     → `lib/client.js`（+ `.map`）
 *
 * ★★★ **而浏览器加载的是 ②**。那一次 `git add` 列了 ① 的三个文件，漏了 ②，
 * 于是修复在源码里、在逐文件产物里，**唯独不在页面加载的那个包里**。
 *
 * ★★ 而**没有任何既有夹具能抓到它**：它们都直接 `import` `lib/client/*.js`，
 * 而那正是【漏带的那一份之外】的产物 —— 判据看的和用户看的**不是同一个文件**。
 *
 * ── 所以这条臂钉的是什么 ─────────────────────────────────────────────────────────
 *
 * 不是"某个按钮在不在"（那还是手抄），而是：
 *
 *     ★ 源码 `src/client/index.tsx` 里每一个**注册 id**，
 *       都必须出现在 **`lib/client.js`** 里。
 *
 * ⇒ 判据的名单**从源码派生**，所以：
 *   · 加一个新注册点 ⇒ 自动被覆盖（不需要记得改这里）
 *   · 改了源码没重建   ⇒ ★ **当场红**
 *
 * ── 三个臂（★ 方向各不相同）──────────────────────────────────────────────────────
 *
 *   臂 1：★ 从源码抓 id，逐个断言在 bundle 里（那正是漏带能抓到的方向）
 *   臂 2：★ 反向半边 —— **人为从 bundle 里删掉一个 id ⇒ 臂 1 必须红**
 *         （否则臂 1 只是"当前看起来对"，无法区分"bundle 真的由源码生成"
 *           与"bundle 恰好含这些字符串"）
 *   臂 3：★ 先决条件 —— **bundle 必须存在且非空**
 *         （否则臂 1 在空文件上会以"0 处命中"的形态给出一个看着正常的读数）
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'src', 'client', 'index.tsx')
const BUNDLE = join(ROOT, 'lib', 'client.js')

/**
 * 从源码抓【注册 id】。
 *
 * ★ 形状来源（实测）：`index.tsx` 里注册点的写法是 `id: 'agent-teams-…'`，
 *   或 `key: SOME_CONST`（那个常量定义在同文件里，值是同一个字符串）。
 *   ⇒ 所以只抓 `id: '<字面量>'` 这一种，**并且**它必须以 `agent-teams-` 开头 ——
 *   那是本插件注册点的前缀，而别的 `id:`（例如内部状态）不该被算进来。
 */
function registrationIdsFromSource() {
  const source = readFileSync(SOURCE, 'utf8')
  const ids = new Set()
  for (const match of source.matchAll(/\bid:\s*'([^']+)'/gu)) {
    if (match[1].startsWith('agent-teams-')) ids.add(match[1])
  }
  return [...ids].sort()
}

test('★★★ 臂 1：源码里的每个注册 id，都必须在 lib/client.js（浏览器加载的那个 bundle）里', () => {
  assert.ok(existsSync(SOURCE), `★ 源码 ${SOURCE} 不存在 —— 臂要读的文件先得在`)
  assert.ok(existsSync(BUNDLE), `★ ${BUNDLE} 不存在 —— 而那是浏览器真正加载的文件`)

  const ids = registrationIdsFromSource()
  assert.ok(
    ids.length >= 4,
    `★ 只从源码抓到 ${ids.length} 个注册 id —— 太少，判据在空集上恒真。`
    + `（实测抓到的：${ids.join(', ') || '（空）'}）`,
  )

  const bundle = readFileSync(BUNDLE, 'utf8')
  const missing = ids.filter((id) => !bundle.includes(id))

  assert.deepEqual(
    missing, [],
    `★★ 这些注册 id 在源码里有，而【不在 lib/client.js 里】：\n`
    + `${missing.map((id) => `      ${id}`).join('\n')}\n`
    + '  ⇒ ★★★ 而那是【浏览器真正加载的那个文件】。'
    + '本仓 client 代码构建两次：逐文件产物在 `lib/client/*.js`，'
    + '而**打包产物是 `lib/client.js`** —— 页面只加载后者。\n'
    + '  ★ 所以"源码改了、夹具绿了、用户看不见"的成因就是漏了后者。\n'
    + '  ★★ 正确做法：`pnpm build` 之后把 **`lib/client.js` 与 `lib/client.js.map`** 一起提交。',
  )
})

test('★★ 臂 2（反向半边）：从 bundle 里删掉一个 id ⇒ 臂 1 的判据必须红', () => {
  const ids = registrationIdsFromSource()
  assert.ok(ids.length > 0, '★ 源码里一个注册 id 都没抓到 ⇒ 这条反向半边无从下手')

  const bundle = readFileSync(BUNDLE, 'utf8')
  const target = ids[0]
  assert.ok(bundle.includes(target), `★ 前提：${target} 本来在 bundle 里（否则删了也不产生差）`)

  /**
   * ★ 在【内存里】模拟"bundle 漏带这一个 id"，复算臂 1 的判据。
   *   ★ 不在磁盘上改 —— 那会让一个只读的臂变成会改产物的臂。
   */
  const mutated = bundle.split(target).join('__REMOVED__')
  const missingAfter = ids.filter((id) => !mutated.includes(id))

  assert.deepEqual(
    missingAfter, [target],
    '★ 反向半边失败：把 ${target} 从 bundle 里抹掉之后，`missing` 应当【恰好】是它。'
    + '若不是，说明臂 1 的比对口径与这条模拟不一致 ⇒ 臂 1 没有它声称的判别力。',
  )
})

test('★ 臂 3（先决条件）：bundle 必须存在且非空', () => {
  assert.ok(existsSync(BUNDLE), `★ ${BUNDLE} 不存在`)
  const size = readFileSync(BUNDLE, 'utf8').length
  assert.ok(
    size > 100_000,
    `★ bundle 只有 ${size} 字符 —— 一个明显过小的 bundle 会让臂 1 在"几乎什么都没有"的文件上跑，`
    + '而那种情况下"没找到"与"确实不含"同形。'
    + '（本仓实测约 427 KB。）',
  )
})
