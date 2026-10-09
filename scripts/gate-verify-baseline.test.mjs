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
import { readFileSync } from 'node:fs'
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

test('★★★ 臂 1：失败【逐条都在基线里】⇒ 那条规则【不开火】', () => {
  /**
   * ★★ 第一版这条断言只写了 `doesNotMatch(/NOT in the pinned baseline/)` ——
   *   ★ 而定向突变（把判据退回"一律拒"）**没有让它红**，因为它没有断言"放行"，
   *     只断言了"不说那句话"，而旧行为说的是【另一句】。
   *   ⇒ ★ 修法：断言【它越过了那条规则】—— 用"它到达了下一个拒绝点"来证明。
   *     `verification completion requires a passed commandsRun entry…` 是那条规则**之后**的规则，
   *     所以"报的是它"就证明【基线那条没拦】。
   */
  const result = evaluateQualityCompletion(task(), update([known[0].test, known[1].test]))
  assert.equal(firedNewFailureRule(result), false, '★ 全在基线里 ⇒ 那条规则不许开火')
  assert.match(
    refusal(result),
    /requires a passed commandsRun entry/,
    '★ 而它必须【越过】基线那条，走到后面那条 —— 报别的话说明我没测到这条',
  )
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

test('★★ 臂 5：基线清单读不出来 ⇒ 判不了（不许读成"基线是空的"）', () => {
  /**
   * ★ 反向半边：`baselineKnownFailures()` 读不到时必须返回 `undefined`（判不了），
   *   而【不是】空数组 —— 空数组意味着"仓库里没有存量红"，而那是错的。
   *   ★ 本臂用源码文本核那一条（本脚本不 import 产品内部函数）。
   */
  const src = readFileSync(join(ROOT, 'src', 'quality-gates.ts'), 'utf8')
  assert.match(
    src,
    /return names\.length === 0 \? undefined : names/,
    '★ 空清单必须落 `undefined`（判不了），而不是空数组（"没有存量红"）',
  )
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
