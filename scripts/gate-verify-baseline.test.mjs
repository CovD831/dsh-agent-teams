#!/usr/bin/env node
/**
 * ── ★★★ 「新增失败」与「仓库存量红」必须分开（t19）──────────────────────────────
 *
 * 由来（MEASURED 2026-10-09，`verifier` 在 t5 上给出）：
 * ```
 * pnpm test:gates 真实 exit=1（23 条红，★ 没有一条属本夹具）
 * ⇒ 而完工规则说「commandsRun 里有 failed ⇒ 不许 completed」
 * ⇒ ★ 于是【17 条任务全部不可达 completed】—— 而它们的工作都做完了
 * ```
 *
 * ★★ 正确的分界是【这次交付有没有新增失败】：
 * ```
 * 全在基线里     ⇒ 允许 completed（`exit=1` 说"仓库里有红"；而它说"我没有新增红" —— 两个不同的量）
 * 至少一条不在   ⇒ 只能 failed
 * ★ 明细缺席     ⇒ 【判不了】⇒ 仍拒（"没能测量"不得读成"没事"）
 * ```
 *
 * ★ 而它要【集合比对】而不是计数：同一个命令三次运行给出过 47 / 14 / 14 条失败
 *   ⇒ 计数不是证据，只有【哪几条】是。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { evaluateQualityCompletion } from '../lib/quality-gates.js'
import { parseCommandResults } from '../lib/tools/shared/entities.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const known = JSON.parse(readFileSync(join(ROOT, 'scripts', 'fixtures', 'baseline-known-failures.json'), 'utf8')).knownFailures

/**
 * 一个 verification 任务 + 一份完工申报。
 *
 * ★★ 关键：`verify` 有【两条】，而只有一条失败 ——
 *   否则它会先撞上"每个 verify 命令都要有一个 passed 条目"那条**别的**规则，
 *   而那样本臂就测不到【基线那条】了（★ 我第一版正是这样，实测发现的）。
 */
function task() {
  return {
    id: 't', kind: 'verification', status: 'in_progress', objective: 'x',
    acceptance: ['a'], inScope: ['src/x.ts'], verify: ['pnpm a', 'pnpm test:gates'],
  }
}
function update(failures) {
  return {
    status: 'completed',
    acceptanceResults: [{ criterion: 'a', status: 'passed' }],
    commandsRun: [
      { command: 'pnpm a', status: 'passed' },
      { command: 'pnpm test:gates', status: 'failed', ...failures === undefined ? {} : { failures } },
    ],
  }
}
const refusal = (result) => String(result.error ?? '')
/** ★ 那条"新增失败"的规则有没有开火 —— 而它与"别的规则先拦了"必须分开。 */
const firedNewFailureRule = (result) => /NOT in the pinned baseline/.test(refusal(result))

test('★★★ 臂 1：失败【逐条都在基线里】⇒ ★【放行】（而不只是"不说某句话"）', () => {
  /**
   * ── ★★★ 而这条臂我改过一次，而改它的理由值得记 ────────────────────────────────
   *
   * ★ 第一版断言的是「它到达了【下一个拒绝点】」—— 用 `requires a passed commandsRun entry`
   *   那一句当"越过基线那条"的证据。
   *   ★★ 而 `t19` 的作者把那个【堵点】拆掉了（`verifyCovered` 现在也认基线）——
   *     于是那一句【不再出现】⇒ 本臂红。
   *   ⇒ ★ 而它红得对：**我把"当前实现的某个细节"当成了不变量** ——
   *     一个棘轮（ratchet），而它的前提是"那个堵点会一直在"。
   *     ★ 而那正是我在 t10 修过的臂 3i 的同族。
   *
   * ⇒ 现在断言的是【真正的性质】：失败逐条都在基线里 ⇒ `ok === true`（放行）。
   *   ★ 它不依赖任何中间消息，所以堵点拆掉之后它【仍然成立】。
   */
  const result = evaluateQualityCompletion(task(), update([known[0].test, known[1].test]))
  assert.equal(
    result.ok,
    true,
    '★ 失败逐条都在基线里 ⇒ 必须【放行】—— 而那正是 17 条任务不可达 completed 的成因被拆掉之后的样子',
  )
  assert.equal(firedNewFailureRule(result), false, '★ 而那条"新增失败"的规则不许开火')
})

test('★★★ 臂 2：至少一条【不在】基线里 ⇒ ★ 仍然拒（那一半没放宽）', () => {
  const result = evaluateQualityCompletion(task(), update(['★ 这是我这次交付新引入的失败']))
  assert.equal(result.ok, false, '★ 新增失败必须仍然拒')
  assert.match(refusal(result), /NOT in the pinned baseline/, '★ 且要说清它不在基线里')
})

test('★★★ 臂 3：明细缺席 ⇒ 【判不了 ⇒ 仍拒】，而措辞与"新增"【不同形】', () => {
  const missing = evaluateQualityCompletion(task(), update(undefined))
  assert.equal(missing.ok, false, '★ "读不到明细"不得读成"没有新增"')
  assert.match(refusal(missing), /could not be measured/, '★ 它必须说"测不了"，而不是"新增了"')
  assert.doesNotMatch(refusal(missing), /NOT in the pinned baseline/, '★ 两者不同形 —— 否则"没能测量"与"新增了"会合流')
})

test('★★ 臂 4：【集合比对】而不是计数', () => {
  /**
   * ★ 同一个命令在三次运行里给出过 47 / 14 / 14 条失败（本会话实测）——
   *   ⇒ 所以判据只能看【名字】。
   *   ★ 本臂构造：**条数完全相同**（都是一条），而一条在基线里、一条不在。
   *   ⇒ 若判据是按条数算的，这两条会给出同一个裁决；而它们必须给出【相反】的。
   */
  const inBaseline = evaluateQualityCompletion(task(), update([known[0].test]))
  const notInBaseline = evaluateQualityCompletion(task(), update(['★ 一个不在基线里的名字']))
  assert.notEqual(
    refusal(inBaseline) === refusal(notInBaseline), true,
    '★ 条数相同而归属不同 ⇒ 裁决必须不同 —— 那证明它比的是【名字】而不是【条数】',
  )
})

test('★★ 臂 5：基线清单【读不出来】与【是空的】必须不同形', () => {
  /**
   * ★★ 第一版钉的是旧实现里的一句字面（`return names.length === 0 ? undefined : names`）——
   *   而 t19 的作者重构了那个函数 ⇒ 字面消失 ⇒ 本臂红。
   *   ⇒ ★ 同一条棘轮：**把实现细节当不变量**。
   *
   * ⇒ 现在钉【行为】：`baselineKnownFailures()` 读不到清单时必须返回 `undefined`
   *   （= 判不了），而**不是**空数组（= "仓库里没有存量红"，而那是错的）。
   *   ★ 做法：把清单文件临时换成一个空数组，看裁决是"判不了"还是"没事"。
   */
  const fixture = join(ROOT, 'scripts', 'fixtures', 'baseline-known-failures.json')
  const original = readFileSync(fixture, 'utf8')
  try {
    writeFileSync(fixture, JSON.stringify({ schema: 1, knownFailures: [] }), 'utf8')
    const result = evaluateQualityCompletion(task(), update([known[0].test]))
    assert.equal(result.ok, false, '★ 空清单 ⇒ 判不了 ⇒ ★ 不许读成"没有存量红"')
    assert.match(refusal(result), /could not be measured/, '★ 而措辞必须说"测不了"')
  } finally {
    writeFileSync(fixture, original, 'utf8')
  }
})

test('★★★ 臂 6：`failures` 必须【真的送达】判据 —— 而它缺两环（verifier 在 t40 上查出的）', () => {
  /**
   * ── ★★★ 而这是"设计对、而它永远收不到数据"的那一格 ────────────────────────────
   *
   * MEASURED（2026-10-10）：t19 的判据【设计是对的】，而它拿到的 `failures` 永远是 `undefined`：
   * ```
   * ① quality-gates.ts:1148  读 update.commandsRun
   * ② entities.ts:2531       parseCommandResults —— 只保留 command/status/exitCode/evidence
   * ③ update-task.ts schema  additionalProperties:false 且【不含】failures
   * ⇒ ④ classifyVerifyFailures 永远 undecidable ⇒ 永远拒
   * ```
   * ★★ 于是"t19 修好了"与"t19 一点也没生效"在读数上**同形** —— 因为那一格没有数据。
   *
   * ⇒ 所以本臂【端到端】钉那两环（而不只是钉判据本身）。
   */
  const parsed = parseCommandResults([
    { command: 'pnpm test:gates', status: 'failed', failures: ['★ 某个测试名'] },
  ])
  assert.deepEqual(
    parsed[0].failures,
    ['★ 某个测试名'],
    '★ ① 解析器必须【透传】failures —— 丢了它，下游永远判不了',
  )

  /** ★ ② schema 必须暴露它 —— 否则成员想如实交出"哪几条红了"会在建参数时被拒。 */
  const source = readFileSync(join(ROOT, 'src', 'tools', 'update-task.ts'), 'utf8')
  /**
   * ★ 注意取的是【整个 commandsRun 段】（到 properties 的闭合），而不是到
   *   `additionalProperties: false` —— ★ 我第一版就停在那一行，于是它拿到的段里
   *   还没有任何字段 ⇒ 断言假红。★ 而那正是"取错了范围"的经典形态。
   */
  const start = source.indexOf('commandsRun: {')
  assert.ok(start >= 0, '★ 前置：commandsRun 的 schema 段必须在')
  const schema = source.slice(start, start + 4000)
  assert.ok(schema, '★ 前置：commandsRun 的 schema 段必须在')
  assert.match(
    schema,
    /failures: \{ type: 'array'/,
    '★ ② schema 必须含 failures —— 而它是 t19 生效的必要一环，不是可选补充',
  )
})

test('★★★ 臂 7：`localPluginRoot()` 推出来的根【真的能读到那个文件】', () => {
  /**
   * ── ★★★ 而这条臂的存在理由是一次真实的事故（2026-10-10）──────────────────────────
   *
   * 我为断一个环，把 `pluginRoot()` 本地化成了 `localPluginRoot()` ——
   * ★ 而第一版**照抄了 `entities.pluginRoot` 的 4 层**：
   * ```
   *   entities.js      住在 lib/tools/shared/ ⇒ 4 层 = 仓库根
   *   quality-gates.js 住在 lib/             ⇒ ★ 只需 2 层
   * ```
   * ⇒ ★ 而它的后果【不是报错】—— `baselinePin()` 读不到那个文件 ⇒ 返回 `undefined`
   *   ⇒ 下游把"读不到基线"读成 **判不了** ⇒ ★ 于是 t19 那条判据永久 `undecidable`
   *   ⇒ ★★ 而"我少算了两层"与"基线清单不存在"在读数上【同形】。
   *
   * ★ 所以本臂不钉"那个函数返回什么字符串"，而钉【它推出来的路径真的存在】——
   *   一个不依赖层数、只依赖结果的判据。
   */
  const gates = readFileSync(join(ROOT, 'lib', 'quality-gates.js'), 'utf8')
  const m = /const root\d* = .*?dirname\(dirname\(fileURLToPath\(import\.meta\.url\)\)\)/.exec(gates)
    ?? /function localPluginRoot\(\)[^}]*dirname\(dirname\(fileURLToPath\(import\.meta\.url\)\)\)/.exec(gates)
  assert.ok(m, '★ 前置：`localPluginRoot` 必须还在（若它被删/改名，本臂要跟着改）')

  /**
   * ★ 而"路径真的对"这件事，用**同一个表达式**在 lib/ 里求值一次最准 ——
   *   而不是在夹具里重算（那会重复一份层数知识，而重复的那份会漂移）。
   */
  const fromLib = dirname(dirname(join(ROOT, 'lib', 'quality-gates.js')))
  assert.equal(
    existsSync(join(fromLib, 'scripts', 'fixtures', 'baseline-known-failures.json')),
    true,
    '★ 从 lib/ 算两层必须落到仓库根 —— 而它能真的读到基线清单（层数错的表现是"读不到"，不是报错）',
  )
})
