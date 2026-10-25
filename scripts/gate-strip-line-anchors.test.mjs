/**
 * ── ★★★ t96（吸收上游 #174 的一半）：行号锚点剥除 + 未验证声明 ─────────────────────
 *
 * ── 上游逐字（v0.1.23 `648fd9a`）────────────────────────────────────────────────
 *
 * > 「#174 Auto-generated repair work orders were frozen at finding-generation time.
 * >   They now record the workspace snapshot …, are flagged stale …, and
 * >   their acceptance **loses drifting line anchors** and
 * >   **states that the plugin did not verify the finding's claims.**」
 *
 * ★ 本夹具只钉**可独立吸收的一半**（行号剥离 + 未验证声明）；
 *   snapshot/stale 那一半需要内容摘要（S1 的模型），**刻意不做**（见交付文档 §6）。
 *
 * ── 根因（写进被测源码的注释，这里复述给读夹具的人）──────────────────────────────
 *
 *   一条 finding 带 `file + line`，`requiredFix` 文本里常写 `file.ts:42`。
 *   任何一次编辑落在那行**之上**，下游所有行号平移 ⇒ acceptance 文本
 *   指向的不再是那条 finding。能活过编辑的是**文件路径 + 修复措辞本身**（内容锚点）。
 *
 * ── 本夹具钉的五件事 ────────────────────────────────────────────────────────────
 *
 *   臂 1（反向半边 A）：`src/a.ts:42` / `foo.go:503-505` **必须被剥掉**
 *   臂 2（反向半边 B）：`12:30`（时间）/ URL / 版本段 **必须原样保留** —— 不许一刀切
 *   臂 3（反向半边 C）：同一条 acceptance **同时**有行号与时间 ⇒ 剥行号、留时间
 *   臂 4（落点）：走**真实编排路径** `planQualityFollowUp` ⇒ 修复任务的 acceptance
 *              ① 行号已剥 ② 未验证声明恒在场（且在 requirements 轮次同样在场）
 *   臂 5（纯函数）：同一输入两次调用 ⇒ 同一输出（不改写其余内容）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { stripLineAnchors, planQualityFollowUp } = await import('../lib/quality-gates.js')

/** 一条最小的 finding（只填本判据读的几格）。 */
const finding = (id, file, requiredFix, line) => ({ id, severity: 'high', file, line, problem: 'p', requiredFix })

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★★ 反向半边 A：该剥的必须被剥掉
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 1（反向半边 A）：`src/a.ts:42` 与 `foo.go:503-505` 必须被剥掉（路径保留）', () => {
  /** ★ 路径本体**必须留下** —— 那是能活过编辑的内容锚点的一部分。 */
  assert.equal(stripLineAnchors('fix the parser in src/a.ts:42'), 'fix the parser in src/a.ts')
  assert.equal(stripLineAnchors('rework deliver.go:503-505'), 'rework deliver.go')
  assert.equal(stripLineAnchors('see lib/x.ts:12 for the wire format'), 'see lib/x.ts for the wire format')
  /** ★ 裸文件名 + 行号同剥（`README.md:3`）。 */
  assert.equal(stripLineAnchors('update README.md:3'), 'update README.md')
  /** ★ 一段文本里的多个锚点全部剥掉。 */
  assert.equal(
    stripLineAnchors('fix src/a.ts:42 and then re-check lib/y.ts:7-9'),
    'fix src/a.ts and then re-check lib/y.ts',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★★ 反向半边 B：不该剥的不许剥（不许一刀切）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2（反向半边 B）：`12:30`（时间）、URL、版本段必须原样保留', () => {
  /** ★ 时间：`12:30` 前面没有"路径形态的词"（无扩展名点、无斜杠）⇒ 不匹配。 */
  assert.equal(stripLineAnchors('the gate fired at 12:30'), 'the gate fired at 12:30')
  assert.equal(stripLineAnchors('run it daily at 9:15-9:45'), 'run it daily at 9:15-9:45')
  /** ★ URL：`:`
   * 前是 `//`（lookbehind 排除）。 */
  assert.equal(stripLineAnchors('see https://example.com/docs for details'), 'see https://example.com/docs for details')
  assert.equal(stripLineAnchors('curl http://localhost:3000/health'), 'curl http://localhost:3000/health')
  /** ★ 版本段：`v1:2` 的 `1` 前是 `v`（路径字符），但 `v1` 不是文件形态 ——
   *   lookbehind 的词要求它前面还有路径字符或它是文件形态本身 ⇒ 这里不剥。 */
  assert.equal(stripLineAnchors('schema v1:2 is legacy'), 'schema v1:2 is legacy')
  /** ★ 比例/比分（裸数字:数字）。 */
  assert.equal(stripLineAnchors('ratio is 3:1 now'), 'ratio is 3:1 now')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★★ 反向半边 C：同一条里行号与时间并存 ⇒ 剥行号、留时间
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3（反向半边 C）：一条 acceptance 同时有行号与时间 ⇒ 剥行号而保留时间', () => {
  const mixed = 'the gate at 12:30 fired again because src/a.ts:42 still caches; see https://example.com/x and v1:2 notes'
  assert.equal(
    stripLineAnchors(mixed),
    'the gate at 12:30 fired again because src/a.ts still caches; see https://example.com/x and v1:2 notes',
    '★ 一刀切的实现（剥所有 `:数字`）会当场红：时间和 URL 必须幸存',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★★ 落点：走真实编排路径 ⇒ ① 行号已剥 ② 未验证声明恒在场
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 4：真实编排路径 planQualityFollowUp ⇒ 修复任务 acceptance 已剥行号 + 未验证声明在场', () => {
  const closed = {
    id: 'review-1', kind: 'review', status: 'failed', verdict: 'needs_revision',
    subject: 'review-1',
    findings: [
      finding('F1', 'src/a.ts', 'fix the parser at src/a.ts:42 first, then the cache in lib/c.ts:8', 42),
      finding('F2', 'docs/d.md', 'the deadline note at 12:30 in docs/d.md:5 is stale', 5),
    ],
    reviewedTaskId: 'impl-1', round: 1,
  }
  const impl = { id: 'impl-1', kind: 'implementation', status: 'completed', subject: 'impl', assignee: 'alice' }
  const team = {
    id: 'team1', phase: 'running', halted: false,
    members: [
      { id: 'm1', name: 'alice', status: 'active' },
      { id: 'm2', name: 'bob', status: 'active' },
    ],
    tasks: [impl, closed],
  }
  const planned = planQualityFollowUp(team, closed)
  const repair = planned.created.find((task) => task.kind === 'repair')
  assert.notEqual(repair, undefined, '★ 前提：正常支必须产出修复任务')
  /** ① 行号已剥（含 `:8` 这种单行与路径混排）。 */
  const fix1 = repair.acceptance.find((item) => item.includes('src/a.ts'))
  assert.ok(fix1 !== undefined, '★ 修复任务的 acceptance 里有 F1 的条目')
  assert.doesNotMatch(fix1, /:\d+/, `★ 行号锚点必须已被剥掉（实测：${fix1}）`)
  assert.ok(fix1.includes('src/a.ts') && fix1.includes('lib/c.ts'), '★ 文件路径必须保留（内容锚点）')
  const fix2 = repair.acceptance.find((item) => item.includes('docs/d.md'))
  assert.ok(fix2 !== undefined, '★ F2 的条目在场')
  /** ★★ 反向半边 C 在编排路径上复验：同一条里时间 `12:30` 幸存、行号 `:5` 被剥。 */
  assert.ok(fix2.includes('12:30'), `★ 时间必须幸存（实测：${fix2}）`)
  assert.doesNotMatch(fix2, /d\.md:5/, `★ 行号必须被剥（实测：${fix2}）`)
  /** ② 未验证声明 —— 上游逐字要求；它必须**恒在场**（最后一条）。 */
  const disclaimer = repair.acceptance[repair.acceptance.length - 1]
  assert.match(disclaimer, /NOT verified/i, `★ 声明必须说"插件没有验证过这些发现"（实测：${disclaimer}）`)
  assert.match(disclaimer, /verify each against the current code/i, '★ 声明要指出补救动作：先核对再修')
  /** ★ 而行号被剥不许把 finding 条目剥空 —— 空条目会被当成"没有内容"。 */
  for (const item of repair.acceptance) assert.ok(item.trim() !== '', '★ 剥离不许产出空条目')
})

test('★★ 臂 4b：requirements 轮次同样过剥离 + 声明在场', () => {
  const closed = {
    id: 'req-1', kind: 'requirements', status: 'failed', verdict: 'needs_revision',
    subject: 'req-1',
    findings: [finding('R1', 'docs/req.md', 'clause in docs/req.md:9 conflicts with the 12:30 cutoff', 9)],
    round: 1,
  }
  const team = {
    id: 'team2', phase: 'running', halted: false,
    members: [{ id: 'm1', name: 'alice', status: 'active' }],
    tasks: [closed],
  }
  const planned = planQualityFollowUp(team, closed)
  const next = planned.created.find((task) => task.kind === 'requirements')
  assert.notEqual(next, undefined, '★ 前提：requirements 轮次必须产出任务')
  const clause = next.acceptance.find((item) => item.includes('docs/req.md'))
  assert.ok(clause !== undefined, '★ 条目在场')
  assert.doesNotMatch(clause, /req\.md:9/, `★ 行号已剥（实测：${clause}）`)
  assert.ok(clause.includes('12:30'), `★ 时间幸存（实测：${clause}）`)
  const disclaimer = next.acceptance[next.acceptance.length - 1]
  assert.match(disclaimer, /NOT verified/i, '★ 未验证声明在 requirements 轮次同样恒在场')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★ 纯函数：同输入 ⇒ 同输出；零输入变化 ⇒ 零输出变化
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5：stripLineAnchors 是纯函数 —— 同输入两次调用同输出；无锚点文本逐字不变', () => {
  const withAnchors = 'fix src/a.ts:42 and meet at 12:30'
  assert.equal(stripLineAnchors(withAnchors), stripLineAnchors(withAnchors), '★ 两次调用同输出（引用透明）')
  /** ★ 无锚点的文本必须逐字不变（剥除不碰任何别的东西）。 */
  const plain = 'the gate fired at 12:30; see https://example.com and schema v1:2'
  assert.equal(stripLineAnchors(plain), plain, '★ 无锚点 ⇒ 逐字不变')
  /** ★ 空串与无变化输入。 */
  assert.equal(stripLineAnchors(''), '')
})
