#!/usr/bin/env node
/**
 * ── t11：`validateCreateTask` 对 `reviewed` 那一格的校验 —— 而它是**三态** ────────────
 *
 * ── 用户原话（这一格存在的理由，逐字）────────────────────────────────────────────
 *
 *   「因为有的任务是自动生成的，有的任务是需要问过我之后再生成、再派发的。
 *     对于问过我、我裁决过的任务，在生成计划时就没有走自动生成的那一步，
 *     也就没有『已审查』的字段，**那它就需要被审查一遍**。」
 *
 * ⇒ ★ 路由规则：**带 `reviewed` ⇒ 放行；不带 ⇒ 派之前必须先审一遍**。
 *   而"不带"是**正常状态**，不是错误。
 *
 * ── ★★★ 「区分『缺失』与『类型错』」在这里的确切落点（§54 那条口径）──────────────
 *
 * ★ 它**不是**"两种都要报错，只是措辞不同" —— 那是最容易被读错的一版：
 *
 *     缺席           ⇒ ★ **通过**（`ok: true`）。它是"还没审"，不是"缺了一格必填"。
 *     在场而形状坏    ⇒ 拒绝，而消息**指名"在场而形状坏"**，并说清**坏在哪**。
 *
 * ★★ 而这一文件要钉的正是**那两者不同形** —— 因为后果是具体的：
 *   一个说成 `reviewed is required` 的消息会让读的人去**补一个字段**，
 *   而那条任务**本来就有那一格**（只是内容坏了）⇒ 他去补的东西已经在。
 *   ⇒ ★ 那是本队记账过的形态：**一个错误的措辞让人去做另一件事。**
 *
 * ── 而本文件为什么必须有【对照臂】──────────────────────────────────────────────
 *
 * ★ 契约逐字：「★ 对照臂：合法 `reviewed`（`{at, by, checks[]}` 齐全）必须通过校验 ——
 *   缺对照臂就**无法区分「校验有效」与「校验在乱拒」**。」
 *   ★★ 而这条不是形式：一个"一律拒绝"的实现会让上面每一条"形状坏 ⇒ 拒绝"**照样绿**，
 *     而它把**每一条正当的审查**也一并拒了。⇒ 对照臂是那两条断言的反面半边。
 *
 * Run: node --test scripts/gate-reviewed-validation.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILT = join(ROOT, 'lib', 'quality-gates.js')
const SOURCE = join(ROOT, 'src', 'quality-gates.ts')

/** 走**构建产物**（`validateCreateTask` 在 `lib/quality-gates.js` 里）。 */
async function validator() {
  const mod = await import(`${BUILT}?hook=reviewed-validation`)
  return mod.validateCreateTask
}

/** 一个最小的 TeamState（够 `validateCreateTask` 走完；本格与 team 内容无关）。 */
const teamState = () => ({ id: 'gate-reviewed-validation', tasks: [], members: [], createdAt: 1, updatedAt: 1 })

/** 一条最小的合法建任务入参；`reviewed` 由各臂自己给。 */
const input = (extra = {}) => ({ subject: '校验臂用的一条任务', kind: 'work', ...extra })

/** 一条**良构**的 reviewed（各臂的基准）。 */
const validStamp = () => ({
  at: 1_700_000_000_000,
  by: 'adversarial',
  checks: [{ id: 'scope', verdict: 'pass', why: '写域是具体文件' }],
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 1：★ 缺席 ⇒ 通过（它不许变成必填）
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 臂 1：`reviewed` **缺席** ⇒ 校验通过 —— 它绝不许变成必填', async () => {
  /**
   * ── 契约逐字：「★ 不带 `reviewed` 建任务**照常成功**（它不许变成必填）」────────────
   *
   * ★★ 而这一条**不是形式**：把 `reviewed` 变成必填，会让**每一条手工裁决过的任务**
   *   都无法建出来 —— 而那一类任务正是这条规则要服务的那一类。
   *   ⇒ ★ 于是"加了一格校验"会把它要修的那件事**弄得更坏**。
   */
  const validate = await validator()
  const result = validate(teamState(), input())

  assert.equal(result.ok, true, '★★ 不带 reviewed 必须**通过** —— 它是"还没审"的正常状态，不是缺了一格必填')
  assert.equal(result.error, undefined, '★ 通过时不许留下任何 error 文本（一个空串也算"说了一句话"）')
})

test('★★★ 臂 1b（反向半边）：也**不许**变成"必须在场但可以为空" —— 空对象要拒', async () => {
  /**
   * ★ 反向半边：上面那条只证明"缺席放行"，而一个"一律放行"的实现会**照样绿**。
   *   ⇒ 所以这里钉另一侧：**在场就必须是良构的** —— 一个 `{}` 不是良构。
   *
   * ★★ 而 `{}` 这一格特别要紧：它是最容易被当成"约等于还没审"的形状，
   *   而它其实是**一个残缺的登记** —— 两者补救动作不同（一个不用管、一个要去补全）。
   */
  const validate = await validator()
  const result = validate(teamState(), input({ reviewed: {} }))
  assert.equal(result.ok, false, '★ `reviewed: {}` 必须被拒 —— 一个残缺的登记不是"还没审"')
  assert.match(result.error, /reviewed/u, '★ 消息必须指名是 `reviewed` 那一格')
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 2：★ 对照臂 —— 合法 reviewed 必须通过
// ═════════════════════════════════════════════════════════════════════════════

test('★★★★ 臂 2（对照臂）：合法 `{at, by, checks[]}` 必须**通过** —— 否则分不出"校验有效"与"乱拒"', async () => {
  /**
   * ── 契约逐字：「★ 对照臂：合法 `reviewed`（`{at, by, checks[]}` 齐全）必须通过校验 ——
   *            缺对照臂就**无法区分「校验有效」与「校验在乱拒」**」──────────────────────
   *
   * ★★ 而这是本文件**最要紧的一条**：下面臂 3 的每一条都说"形状坏 ⇒ 拒绝"，
   *   而一个**一律拒绝**的实现会让它们**全部照样绿** ⇒ 而那会把每一条正当的审查也拒掉。
   *   ⇒ 所以本臂是那两条断言的**反面半边**，缺了它，"校验有效"与"校验在乱拒"同形。
   */
  const validate = await validator()
  const stamp = validStamp()
  const result = validate(teamState(), input({ reviewed: stamp }))

  assert.equal(result.ok, true, '★★ 一条良构的 reviewed 必须**通过**（否则那两条"拒绝"的臂无意义）')
  assert.equal(result.error, undefined)

  /** ★ 而**空 `checks`** 也是合法的 —— 它说的是"审了、一条都没记"（与"没审"不同形）。 */
  const emptyChecks = validate(teamState(), input({ reviewed: { at: 1, by: 'captain', checks: [] } }))
  assert.equal(emptyChecks.ok, true, '★ `checks: []` 合法 —— "审了但一条都没记"与"没审"是两件事')
  /** ★ 而 `why` 是可选的（只有 `id` 与 `verdict` 必填）。 */
  const noWhy = validate(teamState(), input({ reviewed: { at: 1, by: 'captain', checks: [{ id: 'scope', verdict: 'pass' }] } }))
  assert.equal(noWhy.ok, true, '★ `why` 可选')
  /** ★ 而三态里的每一态都要被接受（尤其 `unmeasured` —— 它不许被认成"取值非法"）。 */
  for (const verdict of ['pass', 'fail', 'unmeasured']) {
    const one = validate(teamState(), input({ reviewed: { at: 1, by: 'captain', checks: [{ id: 'scope', verdict }] } }))
    assert.equal(one.ok, true, `★ verdict="${verdict}" 必须被接受（它是三态之一）`)
  }

  /**
   * ── ★★★ 而这条对照臂**当场抓到了一个真错**（本文件最值钱的一次 MEASURED）───────────
   *
   * ★ 实现的第一版拿 `isReviewVerdict`（即 `REVIEW_VERDICTS` = `pass / needs_revision / reject`）
   *   去判**逐条 check** 的 `verdict` —— 而那两套取值的**对象不同**：
   *
   *     `REVIEW_VERDICTS`  ⇒ 一条**任务**的审查结论
   *     逐条 check 的       ⇒ **一问**的结论（`pass / fail / unmeasured`）
   *
   *   ⇒ 于是 `verdict: 'fail'` 与 `'unmeasured'` 被**错误地拒掉** ——
   *     即「一个审查说它有问题」这件事**传不进契约**。
   *
   * ★★ 而抓到它的就是上面这三行（`for (const verdict of …)`）——
   *   **若没有对照臂，臂 3 那一串"形状坏 ⇒ 拒绝"会全部照样绿**，
   *   而实现会把每一条正当的逐条结论一并拒掉。
   *   ⇒ ★ 那就是契约为什么要那条对照臂：**缺它就无法区分"校验有效"与"校验在乱拒"。**
   *
   * ★ 而"用哪一套取值"不是措辞问题 —— 它是**这一格的对象是什么**的问题。
   */
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 3：★ 形状坏 ⇒ 拒绝，而**消息区分「缺失」与「类型错」**
// ═════════════════════════════════════════════════════════════════════════════

test('★★★★★ 臂 3：形状坏的四种子形态各自被拒，且消息**指名坏在哪**', async () => {
  /**
   * ── 契约逐字：「`reviewed` 在场但形状坏（非对象 / checks 非数组）⇒ `validateCreateTask`
   *            报错」────────────────────────────────────────────────────────────────
   *
   * ★★ 而"逐项指名"是本臂的实质（与 `profiles.ts` 那条 `X must be an array` 同一口径）：
   *   读的人要能**直接去修那一项**，而不是把整个 `reviewed` 重写一遍。
   */
  const validate = await validator()
  const cases = [
    { label: '非对象（字符串）', reviewed: 'yes', expect: /not an object/u },
    { label: '非对象（布尔 true）', reviewed: true, expect: /not an object/u },
    { label: '非对象（数组）', reviewed: [1], expect: /not an object/u },
    { label: '非对象（null）', reviewed: null, expect: /not an object/u },
    { label: 'at 不是数', reviewed: { at: 'now', by: 'a', checks: [] }, expect: /reviewed\.at/u },
    { label: 'by 为空串', reviewed: { at: 1, by: '  ', checks: [] }, expect: /reviewed\.by/u },
    { label: 'checks 非数组', reviewed: { at: 1, by: 'a', checks: 'pass' }, expect: /reviewed\.checks must be an array/u },
    { label: 'checks 元素非对象', reviewed: { at: 1, by: 'a', checks: ['scope'] }, expect: /checks\[0\]/u },
    { label: 'checks 元素缺 id', reviewed: { at: 1, by: 'a', checks: [{ verdict: 'pass' }] }, expect: /checks\[0\]\.id/u },
    { label: 'verdict 认不得', reviewed: { at: 1, by: 'a', checks: [{ id: 'scope', verdict: 'maybe' }] }, expect: /reviewed\.checks\[0\]\.verdict/u },
  ]
  for (const item of cases) {
    const result = validate(teamState(), input({ reviewed: item.reviewed }))
    console.log(`    ℹ ${item.label.padEnd(22)} ok=${result.ok}`)
    assert.equal(result.ok, false, `★ ${item.label} 必须被拒`)
    assert.match(result.error, item.expect, `★ ${item.label} 的消息必须指名坏在哪（契约要求"逐项指名"）`)
  }
})

test('★★★★★ 臂 3b：★ 消息**区分「缺失」与「类型错」** —— 而那是 §54 那条口径的落点', async () => {
  /**
   * ── 契约逐字：「…**且报错消息区分「缺失」与「类型错」**（本仓库 §54 已定的口径）」──────
   *
   * ★★★ 而"区分"在这里**不是**"两种都要报错、只是措辞不同" —— 那是最容易读错的一版。
   *   确切的落点是：
   *
   *     缺席         ⇒ ★ **通过**（不是错误）
   *     在场而形状坏  ⇒ 拒绝，而消息说清**它在场、只是坏了**
   *
   * ★★ 为什么这一点必须可核（后果是具体的）：
   *   一个说成 `reviewed is required` 的消息会让读的人去**补一个字段**，
   *   而那条任务**本来就有那一格**（只是内容坏了）⇒ 他去补的东西已经在。
   *   ⇒ ★ 那是本队记账过的形态：**一个错误的措辞让人去做另一件事。**
   *
   * ★ 所以本臂钉三件事：
   *   ① 形状坏的消息里**要点明"它在场"**（不许读起来像"缺了它"）
   *   ② 缺席与形状坏的 **`ok` 值不同**（`true` vs `false`）—— 两者不同形
   *   ③ 而形状坏的消息**不许**出现"required / 必填"这类**缺失向**的措辞
   */
  const validate = await validator()

  const absent = validate(teamState(), input())
  const malformed = validate(teamState(), input({ reviewed: 'yes' }))

  /** ② 两者不同形（一个通过、一个拒绝）—— ★ 而这是"区分"最硬的那一半。 */
  assert.equal(absent.ok, true, '★ 缺席 ⇒ 通过')
  assert.equal(malformed.ok, false, '★ 在场而形状坏 ⇒ 拒绝')

  /** ① 而形状坏的消息必须**点明它在场**。 */
  assert.match(
    malformed.error, /is present/u,
    '★★ 形状坏的消息必须点明"它**在场**" —— 否则读的人会以为那一格缺了，而去补一个已经在的字段',
  )

  /** ③ 而它**不许**是"缺失向"的措辞。 */
  assert.equal(
    /\brequired\b|必填|is missing|must be provided/u.test(malformed.error), false,
    '★★ 形状坏的消息里出现了"缺失向"的措辞（required / 必填 / missing）—— 而那会把"内容坏了"读成"字段缺了"',
  )

  /**
   * ★★ ④ 而最后一条是**反向**的：两种形状坏（非对象 / checks 非数组）的消息
   *   **必须互不相同** —— 否则"坏在哪"就没有被指名（两条不同的错读起来一样）。
   */
  const wrongShape = validate(teamState(), input({ reviewed: 'yes' })).error
  const wrongChecks = validate(teamState(), input({ reviewed: { at: 1, by: 'a', checks: 'pass' } })).error
  assert.notEqual(wrongShape, wrongChecks, '★★ 两种不同的形状坏必须给出**不同的**消息（否则"坏在哪"没被指名）')
})

test('★★★ 臂 3c：★ 那条消息**不在**源码里写成"必填"（接线读数：读源码字面）', async () => {
  /**
   * ★ 为什么要读源码：上面 3b 的 ③ 是在**一条**输入上跑的 —— 而实现里可能
   *   另有别的分支写着"缺失向"的措辞。⇒ 本臂把**整段**扫一遍：
   *   **`reviewed` 那条校验里的每一条 `error` 都不许用"缺失向"的措辞。**
   *
   * ★★ 而它同时是一条**接线读数**：一个把 `reviewed` 加进"必填清单"的实现，
   *   会在这里当场红（而那一格是 t11 的边界逐字禁止的）。
   */
  const source = await import('node:fs').then((m) => m.readFileSync(SOURCE, 'utf8'))
  const start = source.indexOf('if (input.reviewed !== undefined) {')
  assert.notEqual(start, -1, '★ 读不到那条校验的开头 —— 本臂无法成立（而"读不到就跳过"是恒真写法）')
  /** ★ 取那一整段（到它后面的 `const dependencies` 为止 —— 那是本文件的上一处锚点）。 */
  const end = source.indexOf('const dependencies = input.dependencies', start)
  const block = source.slice(start, end === -1 ? start + 4000 : end)
  console.log(`    ℹ 那条校验的长度：${block.length} 字符`)

  /** ★ 而那一段里**必须**有条件判它是不是一个对象（否则形状坏会被静默接受）。 */
  assert.match(block, /isRecord\(reviewed\)/u, '★★ 必须用 `isRecord` 判"它是不是一个对象"（那正是"类型错"那一半）')
  assert.match(block, /Array\.isArray\(reviewed\['checks'\]\)/u, '★★ 必须单独判 `checks` 是不是数组')

  /** ★ 而"缺失向"的措辞不许出现在**任何一条 error 的字符串里**。 */
  const errors = [...block.matchAll(/error: ([^\n]*(?:\n\s*\+[^\n]*)*)/gu)].map((m) => m[1])
  assert.ok(errors.length > 0, '★ 那一段里读不到任何 error 文本 —— 本臂无法成立')
  for (const text of errors) {
    assert.equal(
      /\brequired\b|必填/u.test(text), false,
      `★★ 那段里有一条 error 用了"缺失向"的措辞：${text.slice(0, 80)} —— 而"在场而坏"不许读成"缺了它"`,
    )
  }
})
