/**
 * ── 完工门的【kind 需求表】：三态 + 改表立刻生效（t54）────────────────────────────
 *
 * ── MEASURED：这个缺口的形状 ──────────────────────────────────────────────────
 *
 * 三条门（r5 / mutation / backtest）此前各自写死：
 *
 *     if (kind !== 'implementation' && kind !== 'repair') return false
 *
 * ★ 而 `TASK_KINDS` 有 **7 个** ⇒ **5 个 kind 完全没有完工门**。
 * ★★ 而那不是设计 —— **没有任何地方说"verification 类任务不需要新测试"**，
 *   它只是【默认】：门写死了只认两个 kind，其余的它就**不说话**。
 *
 * ★ 量化（今天的真实语料，51 个任务）：
 *
 *     repair 19 · implementation 17              ⇒ 有门
 *     verification 8 · integration 6 · work 1    ⇒ ★ 完全没有门
 *     ⇒ **15/51 = 29% 的任务，完工时那三条门一条都不会说话。**
 *
 * ── ★ 本文件钉四件事 ──────────────────────────────────────────────────────────
 *
 *   ① 表把【默认】变成【决定】：每个 kind 明写要什么，或明写为什么不要（空数组带理由）
 *   ② 三态不同形：表读不到 / 格式坏 / **表里没有这个 kind**
 *      ⇒ ★ 三者都**不得静默退化成"这个 kind 不需要门"**
 *   ③ 反向半边：implementation 仍要求三样；repair 仍要求既有夹具能判别
 *   ④ ★★ 改表 ⇒ **立刻生效**（不 build、不重载），含反向半边
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  appliesTo as r5AppliesTo,
  gate as r5Gate,
  gateRequirementFor,
  parseKindRequirements,
} from '../lib/gates/completion/r5.js'
import * as backtest from '../lib/gates/completion/backtest.js'
import * as mutation from '../lib/gates/completion/mutation.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RULES_PATH = join(ROOT, 'src', 'gates', 'completion', 'kind-requirements.json')

/** 真的那张表（从**盘上**读，与生产同一条数据）。 */
function realTable() {
  return parseKindRequirements(JSON.parse(readFileSync(RULES_PATH, 'utf8')))
}

/** 一个"什么闸门都满足"的 ctx；`load` 是那张表。 */
function ctxFor(kind, load, extra = {}) {
  return {
    task: { id: 't1', kind },
    update: { changedPaths: ['src/a.ts'], newTestFiles: ['scripts/x.test.mjs'] },
    wantsCompleted: true,
    taskNotTerminal: true,
    loadKindRequirements: () => load,
    ...extra,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★ 决定臂）：每一个 kind 都有【明写的决定】，而不是默认
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 1（★ 决定臂）：7 个 kind 逐个都有决定 —— 且空数组**必须带理由**', () => {
  /**
   * ★★ 这是本任务的核心："不要求"是一条**决定**，而它要有理由。
   *   没有理由的空数组就是默认 —— 而"默认"正是这次要消灭的东西。
   */
  const load = realTable()
  assert.equal(load.status, 'loaded', `★ 真的那张表必须可解析。实测：${JSON.stringify(load)}`)

  /** ★ 七个 kind 一个不少（`TASK_KINDS` 的那七个）。 */
  const TASK_KINDS = ['requirements', 'implementation', 'verification', 'review', 'repair', 'integration', 'work']
  assert.deepEqual(
    load.requirements.knownKinds, [...TASK_KINDS].sort(),
    '★ 表必须覆盖 `TASK_KINDS` 的**每一个** kind —— 漏一个就多一类"没有门"的任务（正是本任务要消灭的）',
  )

  for (const kind of TASK_KINDS) {
    const entry = load.requirements.byKind.get(kind)
    assert.ok(entry !== undefined, `★ ${kind} 必须在表里`)
    assert.ok(
      typeof entry.because === 'string' && entry.because.trim() !== '',
      `★ ${kind} 必须有理由 —— 包括（尤其）"不要求任何门"的那几个：`
      + ' 没有理由的空数组是**默认**，不是决定',
    )
  }

  /**
   * ★ 反向半边（防恒真）：**空数组确实存在**，且它们**都有理由**。
   *   缺这一半，一个"每个 kind 都要求三样门"的表也能过上面全部断言。
   */
  const empties = TASK_KINDS.filter((kind) => load.requirements.byKind.get(kind)?.requiredGates.length === 0)
  assert.ok(empties.length > 0, '★ "有理由地不要求"必须真的出现（否则上面那条对"全都要求"没有分辨力）')
  for (const kind of empties) {
    assert.ok(load.requirements.byKind.get(kind)?.because.length > 40,
      `★ ${kind} 的空数组必须带一条**实质**理由，不是占位`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★ 反向半边臂）：不许因为数据化而放松既有两条
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2（★ 反向半边）：implementation 仍要求三样；repair 仍要求既有夹具能判别', () => {
  /**
   * ★★ 契约的原话：「不许退化成恒不通过 —— implementation 仍要求新测试 + mutation；
   *   repair 仍要求既有夹具能判别（**不能因为数据化而把这两条放松**）」。
   */
  const load = realTable()
  assert.deepEqual(
    [...load.requirements.byKind.get('implementation')?.requiredGates].sort(),
    ['completion.backtest', 'completion.mutation', 'completion.r5'],
    '★ implementation 三样都要（数据化不许放松它）',
  )
  assert.deepEqual(
    [...load.requirements.byKind.get('repair')?.requiredGates].sort(),
    ['completion.backtest', 'completion.mutation'],
    '★ repair 要 mutation + backtest（★ 判别证据是**既有夹具**，不是新测试 —— t31 已建）',
  )

  /**
   * ★ 而在**行为**上也必须成立（不只是表里写着）。
   *
   * ★★ 而 `repair` **刻意不要求 r5** —— 因为 r5 问的是"**新**测试红前绿后"，
   *   而修复类的判别证据是**既有夹具**（t31 已建：一个既有夹具的判决翻转）。
   *   ⇒ 若在这里要求 r5，会逼成员写**装饰性的新测试** —— 而那不是判别证据。
   */
  for (const kind of ['implementation', 'repair']) {
    assert.equal(mutation.appliesTo(ctxFor(kind, load)), true, `★ ${kind} ⇒ mutation 必须生效`)
    assert.equal(backtest.appliesTo(ctxFor(kind, load)), true, `★ ${kind} ⇒ backtest 必须生效`)
  }
  assert.equal(r5AppliesTo(ctxFor('implementation', load)), true, '★ implementation ⇒ r5 必须生效')
  assert.equal(
    r5AppliesTo(ctxFor('repair', load)), false,
    '★ repair **刻意不要求** r5 —— 它的判别证据是既有夹具，不是新测试（t31）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★★ 三态臂）：读不到 / 格式坏 / 表里没有这个 kind —— 三者不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 3（★ 三态臂）：表不可用的三种成因**互不同形**，且都**不得**静默当成"不需要门"', async () => {
  /**
   * ── ★★★ 本队记账最久的那条界线 ────────────────────────────────────────────────
   *
   *   「表里没有这个 kind」 **不等于** 「这个 kind 不要求任何门」。
   *
   *     前者是**没能测量**（表没覆盖它）；后者是一个**有理由的决定**
   *     （`requiredGates: []` 且带 `because`）。
   *
   * ★ 而它们最容易合流的地方是 `appliesTo`：表不可用时 `appliesTo` 返回 `false`
   *   （门不说话），而那与"这个 kind 有理由地不要求它"**在读数上完全同形**。
   * ⇒ 所以 `gate()` 必须再问一次表，把两者分开。
   */
  const absent = { status: 'absent', reason: 'the table file was not found (probe)' }
  const malformed = parseKindRequirements({ kinds: 'not an array' })
  const kindUnknown = (() => {
    const load = realTable()
    assert.equal(load.status, 'loaded')
    /** ★ 一份**读得到、形状对**、但**没有 `integration`** 的表。 */
    return parseKindRequirements({
      kinds: [{ kind: 'implementation', requiredGates: ['completion.r5'], because: 'probe' }],
    })
  })()

  /**
   * ★ 每态的**标识**用它在消息里真的出现的那句话 —— 而不是我自己编的标签。
   *   ★ MEASURED（本臂第一版）：我给第三态编了 `kind-unknown` 这个标签，
   *     而判据说的是 `is not in the table` ⇒ 断言在**一个正确**的消息上红了。
   *   ⇒ 标识取"这一态区别于其它两态的那句话"。
   */
  const cases = [
    { name: 'absent', load: absent, kind: 'implementation', marker: /absent/ },
    { name: 'malformed', load: malformed, kind: 'implementation', marker: /malformed/ },
    { name: 'kind-unknown', load: kindUnknown, kind: 'integration', marker: /is not in the table/ },
  ]
  const texts = []
  for (const item of cases) {
    /**
     * ★ `appliesTo` 会返回 false（门不说话）—— 那是**第一步**，而它必须**不是终点**。
     */
    assert.equal(
      r5AppliesTo(ctxFor(item.kind, item.load)), false,
      `★ ${item.name}：门在表不可用时**不说话**（这是对的 —— 它不该拿一张读不到的表去判）`,
    )
    /** ★★ 而**开火处**必须把它说成"没能测量"，而不是让沉默冒充"不需要门"。 */
    const verdict = await r5Gate(ctxFor(item.kind, item.load, { runTestOnRevision: async () => ({ exitCode: 1 }), scanDirs: ['scripts'] }))
    assert.equal(verdict.ok, false, `★ ${item.name} 不许报 ok`)
    assert.ok('unmeasured' in verdict, `★ ${item.name} 必须报 **unmeasured**（没能测量），实测：${JSON.stringify(verdict).slice(0, 200)}`)
    texts.push(String(verdict.unmeasured))
    assert.match(
      String(verdict.unmeasured), item.marker,
      `★ ${item.name} 必须**自报其成因**（三态不同形），实测：${String(verdict.unmeasured).slice(0, 160)}`,
    )
    /**
     * ★ 而它**绝不**可以说成"这个 kind 不需要它"。
     *
     * ★ 措辞的口径要**窄而准**：只禁"把它说成不需要"这几种说法，
     *   而**不**禁"gate"这个词本身 —— 判据的消息里出现 "no gate could be…"
     *   是**描述没能测量**，而不是"这个 kind 不需要门"。
     *   ⇒ 宽口径（例如禁 /no gate/i）会把正确的话报成违规。
     */
    /**
     * ★★ MEASURED（本臂第一版把**正确的话**报成违规）：判据的消息里**刻意**含一句
     *   免责声明 —— `… is NOT "this kind does not need R5"`。
     *   而宽口径的禁词会把**那句免责声明本身**当成违规。
     *
     * ★ 形态（与今天那几条同族）：**我禁的那个模式，同时出现在
     *   "错误的断言"与"对那个错误的否定"里** —— 而两者必须分得开。
     *
     * ⇒ 口径：**先剥掉那句免责声明**，再禁。若剥掉之后仍出现"不需要"的说法，
     *   那才是真的把它说成了不需要。
     */
    const claim = String(verdict.unmeasured).replace(/is NOT\s+"[^"]*"/g, '')
    assert.doesNotMatch(
      claim,
      /(kind|it) (does not need|doesn't need)|is not required for this kind|no gate applies/i,
      `★ ${item.name} 不许被说成"这个 kind 不需要它" —— 那会把「没能测量」变成「测了，没问题」`,
    )
    /** ★ 反向半边：那句免责声明**必须**在（它正是两态分得开的证据）。 */
    assert.match(
      String(verdict.unmeasured), /is NOT\s+"this kind does not need/i,
      `★ 判据必须**明说**"这不等同于这个 kind 不需要它" —— 缺了它就与"沉默放行"同形`,
    )
  }
  /** ★ 三态**两两不同形**。 */
  assert.equal(new Set(texts).size, 3, '★ 三态的措辞必须两两不同形')

  /**
   * ★★ 而**真正**的"有理由地不要求"必须具备**另一个形状**：
   *   门不说话**且 gate() 不报 unmeasured**（那条路连 `appliesTo` 都过不去）。
   *   ⇒ 它不会进 `gate()`，所以它不可能与上面三种混在一起 —— 而那正是设计。
   */
  const load = realTable()
  assert.equal(r5AppliesTo(ctxFor('requirements', load)), false, '★ requirements 有理由地不要求 r5')
  assert.equal(
    gateRequirementFor(load, 'requirements', 'completion.r5').status, 'not-required',
    '★ 而那是 `not-required`（有理由），**不是** `unknown`（没能测量）—— 两者在这条出口上不同形',
  )
  assert.equal(
    gateRequirementFor(load, 'not-a-kind', 'completion.r5').status, 'unknown',
    '★ 表里没有的 kind 是 `unknown` —— 与 `not-required` 不同形',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★★ 数据臂）：表从【代码】挪进【运行时读的数据】—— 改它立刻生效
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 4（★ 改表立刻生效）：把某条门加进某个 kind 的要求里 ⇒ 立刻生效（不碰 .ts）', () => {
  /**
   * ★★ 与 t53 的臂同构，而这一次是那条能力的**第一次实际使用** ——
   *   不是为了证明它能行，而是为了让这张表**真的可以被调**。
   *
   * ★ 做法：只在内存里换一份**表**（模拟"盘上的数据变了"），而门**每次求值都读**它。
   */
  const load = realTable()
  const kind = 'verification'

  /** ★ 反向半边（先做）：原表下 `verification` **不要求** r5。 */
  assert.equal(
    r5AppliesTo(ctxFor(kind, load)), false,
    '★ 原表下 verification 不要求 r5 ⇒ 下面那条"变了"必须来自表，不是来自恒真',
  )

  /** ★ 而把 r5 加进 `verification` 的要求里 ⇒ 同一段代码立刻改变行为。 */
  const mutated = parseKindRequirements({
    kinds: [...load.requirements.knownKinds].map((k) => ({
      kind: k,
      requiredGates: k === kind
        ? [...load.requirements.byKind.get(k)?.requiredGates, 'completion.r5']
        : [...load.requirements.byKind.get(k)?.requiredGates],
      because: load.requirements.byKind.get(k)?.because,
    })),
  })
  assert.equal(mutated.status, 'loaded')
  assert.equal(
    r5AppliesTo(ctxFor(kind, mutated)), true,
    '★ 把 r5 加进表里 ⇒ 同一条门**立刻**对 verification 生效（★ 全程未改任何 .ts）',
  )
  /** ★ 而它**没有**波及其它 kind（证明我们改的是那一行，不是整张表）。 */
  assert.equal(
    r5AppliesTo(ctxFor('requirements', mutated)), false,
    '★ 只改了 verification 那一行 ⇒ requirements 不受影响',
  )
})

test('★ 臂 4b（★ 删掉一行立刻生效）：把 implementation 那一行删掉 ⇒ 它不再被要求', () => {
  /**
   * ★ 契约要求：「把表里 implementation 的那一行删掉 ⇒ 对应臂红」。
   *   等价的可执行形式：删掉之后，`gateRequirementFor` 对它报 **`kind-unknown`**
   *   （而不是"不要求"）⇒ 门降级成 unmeasured ⇒ **不会静默放行**。
   */
  const load = realTable()
  const withoutImplementation = parseKindRequirements({
    kinds: [...load.requirements.knownKinds]
      .filter((k) => k !== 'implementation')
      .map((k) => ({
        kind: k,
        requiredGates: [...load.requirements.byKind.get(k)?.requiredGates],
        because: load.requirements.byKind.get(k)?.because,
      })),
  })
  assert.equal(withoutImplementation.status, 'loaded')
  assert.equal(
    gateRequirementFor(withoutImplementation, 'implementation', 'completion.r5').status, 'unknown',
    '★ 删掉那一行 ⇒ `kind-unknown`（**不是** `not-required`）—— 门因此报 unmeasured，而不是放行',
  )
  assert.notEqual(
    gateRequirementFor(withoutImplementation, 'implementation', 'completion.r5').status,
    gateRequirementFor(load, 'requirements', 'completion.r5').status,
    '★ "表里没有它"与"有理由地不要求"必须**不同形**',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★ 表/逻辑分离臂）：数据文件里不许有判定逻辑
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 5（★ 表/逻辑分离）：数据文件里**不许**有判定逻辑', () => {
  /**
   * ★★ 与 t53 同一条纪律：为了"数据化"而把逻辑也搬进数据，
   *   会造出一个**不可测的解释器**。
   * ★ 口径（可机械判）：值只能是字符串 / 数组 / 布尔；**不许**出现
   *   `if` / `when` / `then` / `match` / `eval` / `condition` / `fn` / `code` 这类键。
   */
  const raw = JSON.parse(readFileSync(RULES_PATH, 'utf8'))
  const LOGIC_KEYS = /^(if|when|then|else|match|eval|expr|condition|predicate|handler|fn|function|code)$/i
  const offenders = []
  const walk = (node, path) => {
    if (Array.isArray(node)) { node.forEach((item, i) => walk(item, `${path}[${i}]`)); return }
    if (node === null || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (LOGIC_KEYS.test(key)) offenders.push(`${path}.${key}`)
      walk(value, `${path}.${key}`)
    }
  }
  walk(raw, 'kindRequirements')
  assert.deepEqual(
    offenders, [],
    '★ 数据文件里出现了像"逻辑"的键 ⇒ 它正在变成不可测的解释器；'
    + '★ 表（每个 kind 要哪些门）进数据，逻辑（怎么用表判）留在代码里',
  )
  /** ★ 反向半边：那份数据**确实**带着表（否则"没有逻辑键"在空对象上恒真）。 */
  assert.ok(Array.isArray(raw.kinds) && raw.kinds.length > 0, '★ kinds 必须真的有内容')
})
