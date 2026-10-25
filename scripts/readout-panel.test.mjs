/**
 * ── 读数读端（readout-panel）判别力证明：12 臂 ───────────────────────────────────
 *
 * 验的是 `readoutSummaryOf` + `readoutBadgeLabel`（src/client/activity-model.ts）
 * 的**五态分流**，不是"函数存在"。五态必须**不同形**是整条产品线的命门：
 *
 *   臂 1  ★  整个 `readouts` 缺席            ⇒ 三格全 `not-wired`
 *   臂 2  ★  空容器 `{ readouts: {} }`        ⇒ 三格全 `not-wired`（与臂 1 同形）
 *   臂 3  ★  键在但 `{ unmeasured: '…' }`     ⇒ `unmeasured`，reason 原样带出
 *   臂 4  ★  空表 `{ providers: [] }`          ⇒ `measured` 且 summary **明说为 0**
 *   臂 5     evidence 有值（reverified:'yes'）⇒ `measured`，detail 含键名 closures
 *   臂 6     三格齐全                          ⇒ 全 `measured`，无 `not-wired`
 *   臂 7  ★  backends 嵌一层 `capability.<id>.unmeasured` ⇒ `partial`（unknown 含路径）
 *   臂 8  ★  pairing `discrimination:'none'`  ⇒ `no-discrimination`（why 原样）
 *   臂 9     pairing `discrimination:'full'`  ⇒ `measured`（不是 no-discrimination）
 *   臂 10 ★  evidence `reverified:'unknown'` 且 N>0 ⇒ `unmeasured` +「自述·未复核」+ 带 N 条
 *   臂 11 ★  evidence `reverified:'unknown'` 且 entries=[]（0 条）⇒ `measured`，summary 含「0 条」
 *   臂 12 ★  evidence `reverified:'unknown'` 且 entries=3 条 ⇒ `unmeasured` 且 reason 含「3 条」
 *
 * 突变验证（见报告）：去掉嵌套探测 ⇒ 臂 7 红；去掉 discrimination 判断 ⇒ 臂 8 红；
 *                       把 `${n} 条` 从 reason 去掉 ⇒ 臂 12 红。
 *
 * ★ 用 `.mjs` + 类型剥离：直接 import `../src/client/activity-model.ts`
 *   （Node 22 的 `--experimental-strip-types`，仓库先例 scripts/gate-tally.test.mts）。
 *
 * 跑法：`node --experimental-strip-types --test scripts/readout-panel.test.mjs`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readoutSummaryOf, readoutBadgeLabel } from '../src/client/activity-model.ts'

test('臂 1：{} 无 readouts ⇒ 三格全 not-wired', () => {
  const r = readoutSummaryOf({})
  assert.equal(r.evidence.kind, 'not-wired')
  assert.equal(r.pairing.kind, 'not-wired')
  assert.equal(r.backends.kind, 'not-wired')
})

test('臂 2：{ readouts: {} } 空容器 ⇒ 三格全 not-wired（与臂 1 同形）', () => {
  const r = readoutSummaryOf({ readouts: {} })
  assert.equal(r.evidence.kind, 'not-wired')
  assert.equal(r.pairing.kind, 'not-wired')
  assert.equal(r.backends.kind, 'not-wired')
  assert.deepEqual(r, readoutSummaryOf({}))
})

test('臂 3：pairing 在且 unmeasured ⇒ unmeasured + reason 原样；其余 not-wired', () => {
  const r = readoutSummaryOf({ readouts: { pairing: { unmeasured: 'provider threw' } } })
  assert.equal(r.pairing.kind, 'unmeasured')
  assert.equal(r.pairing.reason, 'provider threw')
  assert.equal(r.evidence.kind, 'not-wired')
  assert.equal(r.backends.kind, 'not-wired')
})

test('臂 4：backends 空表 { providers: [] } ⇒ measured 且 summary 明说为 0，≠ not-wired', () => {
  const r = readoutSummaryOf({ readouts: { backends: { providers: [] } } })
  assert.equal(r.backends.kind, 'measured')
  assert.match(r.backends.summary, /0/)
  assert.notEqual(r.backends.kind, 'not-wired')
  assert.notDeepEqual(r.backends, { kind: 'not-wired' })
})

test('臂 5：evidence 有值且 reverified:\'yes\' ⇒ measured，detail 含键名 closures', () => {
  const r = readoutSummaryOf({ readouts: { evidence: { closures: 2, unclosed: 0, reverified: 'yes' } } })
  assert.equal(r.evidence.kind, 'measured')
  assert.ok(
    r.evidence.detail.some((line) => line.includes('closures')),
    `detail 应含键名 closures，实际：${JSON.stringify(r.evidence.detail)}`,
  )
})

test('臂 6：三格齐全 ⇒ 全 measured，无 not-wired', () => {
  const r = readoutSummaryOf({
    readouts: {
      evidence: { closures: 1, unclosed: 0, reverified: 'yes' },
      pairing: { 'gate.a': { hasSoft: true, hasHard: true } },
      backends: { providers: ['x'], capability: { x: {} } },
    },
  })
  assert.equal(r.evidence.kind, 'measured')
  assert.equal(r.pairing.kind, 'measured')
  assert.equal(r.backends.kind, 'measured')
  assert.notEqual(r.evidence.kind, 'not-wired')
  assert.notEqual(r.pairing.kind, 'not-wired')
  assert.notEqual(r.backends.kind, 'not-wired')
})

test('臂 7：backends 嵌一层 capability.<id>.unmeasured ⇒ partial，unknown 含路径', () => {
  const r = readoutSummaryOf({
    readouts: { backends: { providers: ['claude'], capability: { claude: { unmeasured: 'unknown-backend: x' } } } },
  })
  assert.equal(r.backends.kind, 'partial')
  assert.ok(
    r.backends.unknown.includes('capability.claude'),
    `unknown 应含 'capability.claude'，实际：${JSON.stringify(r.backends.unknown)}`,
  )
  // summary 仍给规模，且 unknown 是路径、不含拍平的原因文本
  assert.match(r.backends.summary, /1 项/)
})

test('臂 8：pairing discrimination:\'none\' ⇒ no-discrimination，why 原样带出', () => {
  const why = '22 项全是 {true,true}，无判别力'
  const r = readoutSummaryOf({ readouts: { pairing: { entries: 22, discrimination: 'none', why } } })
  assert.equal(r.pairing.kind, 'no-discrimination')
  assert.equal(r.pairing.why, why)
  assert.match(r.pairing.summary, /无判别力/)
})

test('臂 9：pairing discrimination:\'full\' ⇒ measured，不是 no-discrimination', () => {
  const r = readoutSummaryOf({
    readouts: { pairing: { entries: 22, discrimination: 'full', gateA: { hasSoft: false, hasHard: true } } },
  })
  assert.equal(r.pairing.kind, 'measured')
  assert.notEqual(r.pairing.kind, 'no-discrimination')
})

test('臂 10：evidence reverified:\'unknown\' 且 N>0 ⇒ unmeasured + 徽标「自述·未复核」+ 带 N 条', () => {
  const r = readoutSummaryOf({ readouts: { evidence: { entries: [1], reverified: 'unknown' } } })
  assert.equal(r.evidence.kind, 'unmeasured')
  assert.ok(r.evidence.reason.includes('自述·未复核'))
  assert.ok(r.evidence.reason.includes('1 条'))
  // 渲染路径上取得到的徽标文案
  assert.ok(readoutBadgeLabel(r.evidence.kind, 'evidence').includes('自述·未复核'))
  // evidence 不许以「已测」出现
  assert.notEqual(readoutBadgeLabel(r.evidence.kind, 'evidence'), '已测')
})

test('臂 11：evidence reverified:\'unknown\' 且 entries=[]（0 条）⇒ measured，summary 含「0 条」', () => {
  const r = readoutSummaryOf({ readouts: { evidence: { entries: [], reverified: 'unknown' } } })
  assert.equal(r.evidence.kind, 'measured')
  assert.ok(r.evidence.summary.includes('0 条'), `summary 应含「0 条」，实际：${r.evidence.summary}`)
  // 0 条必须和「没接线 / 没复核」不同形
  assert.notEqual(r.evidence.kind, 'not-wired')
  assert.notEqual(readoutBadgeLabel(r.evidence.kind, 'evidence'), '自述·未复核')
})

test('臂 12：evidence reverified:\'unknown\' 且 entries=3 条 ⇒ unmeasured 且 reason 含「3 条」', () => {
  const r = readoutSummaryOf({ readouts: { evidence: { entries: [1, 2, 3], reverified: 'unknown' } } })
  assert.equal(r.evidence.kind, 'unmeasured')
  assert.ok(r.evidence.reason.includes('3 条'), `reason 应含「3 条」，实际：${r.evidence.reason}`)
  assert.ok(r.evidence.reason.includes('自述·未复核'))
})
