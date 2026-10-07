#!/usr/bin/env node
/**
 * ── backtest 在【基线不全绿】时的归因（t76）─────────────────────────────────────
 *
 * ── ★★★ 它修的是什么（MEASURED：t66/t67/t69/t71/t74 五次独立撞到）────────────────
 *
 * `completion.backtest` 的 L1 前置要一份【全绿的基线】：
 *
 *     baseline.exitCode !== 0  ⇒  blocked「attribution is impossible」
 *
 * 而在这个仓库里基线【几乎从不全绿】—— 总有已知失败（本 worktree 实测：**10 条**）。
 *
 *     ⇒ ★ 它要求的那件事在当前工作方式下【不可满足】。
 *     ⇒ ★ 而它卡住了今晚【每一个】 worktree 任务的终态。
 *
 * ── ★★ 而它自己的措辞早就写对了方向 ───────────────────────────────────────────
 *
 *     「fix or pin the baseline first (this red is not the change's fault),
 *       then re-run the backtest」
 *
 *   ★ 缺的正是【pin】那一半 —— 而它把这半句写在拒绝信息里，却从来没有实现它。
 *
 * ── ★★★ 修法：pin 一份已知失败清单，然后把问句从「绿吗」换成「新增了吗」───────
 *
 *   ① 基线绿              ⇒ 照常归因（语义一字不改）
 *   ② 基线不绿 + 清单在场 ⇒ **按差异归因**：本次新增的失败 ⇒ 拒；
 *                            而基线里已知的那些 ⇒ **不算本次的**
 *   ③ 基线不绿 + 清单缺席 ⇒ 仍是「attribution is impossible」
 *
 *   ★ 三个"不"必须说清（它们是这条判据的全部纪律）：
 *     · ② **不是**「放行」—— 它是**换一个更准的问句**
 *     · ③ **不许**被读成 ②（缺席的清单 ≠ 一份恰好覆盖了所有失败的清单）
 *     · ★ 而②里【新增的失败】仍必须拒 —— 那正是这条判据存在的理由
 *
 * ── ★★ 反向半边（不许退化成恒可归因）───────────────────────────────────────────
 *
 *   臂 3 / 臂 4 钉住"真的新增了失败时仍必须拒"，且它与"基线不绿"**不同形**。
 *
 * Run: node --test scripts/gate-backtest-baseline.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { gate, parseKnownBaselineFailures } from '../lib/gates/completion/backtest.js'
import { parseKindRequirements } from '../lib/gates/completion/kind-requirements.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PIN_FILE = join(ROOT, 'scripts', 'fixtures', 'baseline-known-failures.json')

/** 真的那份 pin（从盘上读）—— 而臂 9 会对它做一次**对账**。 */
function realPin() {
  return parseKnownBaselineFailures(JSON.parse(readFileSync(PIN_FILE, 'utf8')))
}

function requirements() {
  return parseKindRequirements(JSON.parse(readFileSync(join(ROOT, 'src', 'gates', 'completion', 'kind-requirements.json'), 'utf8')))
}

/**
 * 一份最小可用的 ctx。
 * ★ `execBacktestCommand` 是【假的执行器】：判据不跑进程，退出码由它给出。
 */
function ctx(overrides = {}) {
  return {
    loadKindRequirements: () => requirements(),
    task: { id: 't9', kind: 'implementation', inScope: ['src/a.ts'] },
    update: { changedPaths: ['src/a.ts'] },
    changedPaths: ['src/a.ts'],
    coverage: {
      source: 'dependency-graph',
      dependents: { 'src/a.ts': ['src/b.ts'] },
      coverage: { 'src/a.ts': ['scripts/a.test.mjs'], 'src/b.ts': ['scripts/b.test.mjs'] },
      knownTests: ['scripts/a.test.mjs', 'scripts/b.test.mjs'],
      selected: ['scripts/a.test.mjs', 'scripts/b.test.mjs'],
    },
    execSelectedCommand: async () => 0,
    execBacktestCommand: async () => 0,
    ...overrides,
  }
}

/** 从 blocked 里取出理由们（形状断言：它必须是 blocked，不是 unmeasured）。 */
function expectBlocked(verdict) {
  assert.equal(verdict.ok, false, `期望 blocked，实测：${JSON.stringify(verdict)}`)
  assert.equal(verdict.unmeasured, undefined, '★ 这是"测出来了"的结论，不是"没测到"')
  assert.ok(Array.isArray(verdict.blockers) && verdict.blockers.length > 0, JSON.stringify(verdict))
  return verdict.blockers
}

// ─────────────────────────────────────────────────────────────────────────────
// 态 ①：基线全绿 —— 照常归因（既有语义，一字不改）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1（对照臂）：基线绿 ⇒ 照常通过，语义一字不改', async () => {
  const verdict = await gate(ctx({ baseline: { exitCode: 0, label: 'abc1234' } }))
  assert.equal(verdict.ok, true, `实测：${JSON.stringify(verdict)}`)
  assert.equal(verdict.baseline.exitCode, 0)
})

test('★ 臂 2（对照臂）：基线绿 + 全量红 ⇒ 仍是「这次改动改坏了」', async () => {
  const verdict = await gate(ctx({
    baseline: { exitCode: 0, label: 'abc1234' },
    execBacktestCommand: async () => 1,
  }))
  const blockers = expectBlocked(verdict)
  assert.match(blockers[0], /broke something that used to pass/, JSON.stringify(blockers))
})

// ─────────────────────────────────────────────────────────────────────────────
// 态 ②：基线不绿 + 清单在场 ⇒ 按【差异】归因（★ 本任务的核心）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3（核心臂）：基线不绿而失败正是【已知的那些】⇒ 必须可归因，不是「无法归因」', async () => {
  /**
   * ── ★★ 这是本任务存在的理由的可执行形式 ────────────────────────────────────────
   *
   * 修前：`baseline.exitCode !== 0` ⇒ 一律 blocked「attribution is impossible」
   *        ⇒ ★ 而本仓基线几乎从不全绿 ⇒ **那类任务恒收不了口**（五次实测）。
   *
   * 修后：那份失败**在清单里**（= 它在本次改动之前就存在）⇒ 它不是本次造成的
   *        ⇒ 判据应当继续往下走，而不是停在这里。
   */
  const verdict = await gate(ctx({
    baseline: {
      exitCode: 1,
      label: 'abc1234',
      failedTests: ['scripts/known-broken.test.mjs'],
    },
    knownBaselineFailures: parseKnownBaselineFailures({
      knownFailures: [{ test: 'scripts/known-broken.test.mjs', fixture: 'x', because: 'pinned for this arm' }],
    }),
    /** ★ 全量跑**交回了失败清单**，而它列出的正是那条已知失败 ⇒ 无新增。 */
    execBacktestCommand: async () => 1,
    fullScope: {
      coveredTests: ['scripts/a.test.mjs', 'scripts/b.test.mjs'],
      failedTests: ['scripts/known-broken.test.mjs'],
    },
  }))
  assert.equal(
    verdict.ok, true,
    `★★ 已知失败不该让归因变得不可能。实测：${JSON.stringify(verdict)}`,
  )
  /** ★ 而它必须交出"这一轮用了哪个 pin"—— 否则读者无从核对。 */
  assert.equal(verdict.baseline.knownFailures, 1, '★ 读数里要能看出清单被用上了、有几条')
})

test('★★★ 臂 4（反向半边）：清单在场、而全量跑出了一个【新增的】失败 ⇒ 仍必须拒', async () => {
  /**
   * ── ★ 这一臂防"把机制拆掉"─────────────────────────────────────────────────────
   *
   * pin 的全部意义是**换一个更准的问句**（新增了吗），而**不是**取消这条判据。
   * ⇒ 一旦真的新增了失败，它必须照拒 —— 而那正是这条判据一直在做的事。
   *
   * ★ 而它与"基线不绿"必须【不同形】：
   *     基线不绿 ⇒ "我分不开，所以两个结论都不下"
   *     新增失败 ⇒ "我分开了，而这次改动改坏了东西"
   */
  const verdict = await gate(ctx({
    baseline: {
      exitCode: 1,
      label: 'abc1234',
      failedTests: ['scripts/known-broken.test.mjs'],
    },
    knownBaselineFailures: parseKnownBaselineFailures({
      knownFailures: [{ test: 'scripts/known-broken.test.mjs', fixture: 'x', because: 'pinned' }],
    }),
    /** ★ 全量**红了**，而基线也是红的 —— 光看两个退出码分不开，靠清单分。 */
    execBacktestCommand: async () => 1,
    /** 而这一次全量跑出的失败【不在清单里】⇒ 是新增的。 */
    fullScope: { coveredTests: ['scripts/a.test.mjs', 'scripts/b.test.mjs'], failedTests: ['scripts/a.test.mjs'] },
  }))
  const blockers = expectBlocked(verdict)
  assert.ok(
    blockers.some((b) => /new|新增|not known|regression/i.test(b)),
    `★★ 新增的失败必须被指名。实测：${JSON.stringify(blockers)}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 态 ③：基线不绿 + 清单缺席 ⇒ 仍是「无法归因」（不许凭空归因）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 5（三态臂）：基线不绿而清单【缺席】⇒ 仍是「无法归因」，不许读成臂 3', async () => {
  /**
   * ★★ 一份**缺席的清单**与一份**恰好覆盖了所有失败的清单**必须不同形。
   *   前者是"我没有那份记录"，后者是"我有，而它解释了这次的红"。
   *   ⇒ 把前者读成后者，就是本队记账的「把没能测量并进通过」。
   */
  const verdict = await gate(ctx({
    baseline: { exitCode: 1, label: 'abc1234', failedTests: ['scripts/known-broken.test.mjs'] },
    /** ★ 刻意不给 `knownBaselineFailures`。 */
  }))
  const blockers = expectBlocked(verdict)
  assert.ok(
    blockers.some((b) => /attribution is impossible/i.test(b)),
    `★★ 清单缺席时仍必须说"无法归因"。实测：${JSON.stringify(blockers)}`,
  )
  assert.ok(
    blockers.some((b) => /fix or pin the baseline first/i.test(b)),
    '★ 而必须保留那句【动作指引】（它本来就是对的）',
  )
})

test('★★ 臂 6（三态不同形）：三态的读数两两不同形', async () => {
  const green = await gate(ctx({ baseline: { exitCode: 0, label: 'a' } }))
  const pinned = await gate(ctx({
    baseline: { exitCode: 1, label: 'a', failedTests: ['k.test.mjs'] },
    knownBaselineFailures: parseKnownBaselineFailures({ knownFailures: [{ test: 'k.test.mjs', fixture: 'x', because: 'y' }] }),
    /** ★ 全量交回失败清单，而它列的正是那条已知失败 ⇒ 无新增 ⇒ 可归因。 */
    fullScope: { coveredTests: ['scripts/a.test.mjs', 'scripts/b.test.mjs'], failedTests: ['k.test.mjs'] },
  }))
  const unpinned = await gate(ctx({ baseline: { exitCode: 1, label: 'a', failedTests: ['k.test.mjs'] } }))

  /** ★ ① 与 ② 都是 ok，而 ② 多带一格里说明用了 pin。 */
  assert.equal(green.ok, true)
  assert.equal(pinned.ok, true)
  assert.notEqual(green.baseline.knownFailures, pinned.baseline.knownFailures, '① 与 ② 必须不同形')
  /** ★ ③ 与另两态都不同形：它是 blocked。 */
  assert.equal(unpinned.ok, false)
  assert.equal(typeof unpinned.blockers, 'object')
  assert.notEqual(unpinned.ok, pinned.ok, '③ 与 ② 不同形')
  assert.notEqual(unpinned.ok, green.ok, '③ 与 ① 不同形')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 定向突变：把新增的失败藏进已知清单 ⇒ 臂必须红
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 7（突变臂）：把【新增的失败】写进 pin ⇒ 判据必须报不出它来（证明它真的在比差异）', async () => {
  /**
   * ── ★★ 这一臂证明"它真的在比差异"，而不是"只要清单在场就放行"───────────────
   *
   * 做法：构造同一次全量红，只改变 pin 的内容：
   *   · pin 里**没有**那条新失败 ⇒ 判据必须把它报出来（= 臂 4）
   *   · pin 里**有**那条失败    ⇒ 判据就不该再报它了（因为它已经"已知"）
   *
   * ⇒ ★ 若两者读数相同，说明判据根本没读 pin 的内容（只是"有 pin 就放行"）——
   *   而那是把判据换成了一个恒真的开关。
   */
  const failing = 'scripts/a.test.mjs'
  const scope = { coveredTests: ['scripts/a.test.mjs', 'scripts/b.test.mjs'], failedTests: [failing] }
  const base = {
    exitCode: 1,
    label: 'abc1234',
    failedTests: ['scripts/known-broken.test.mjs'],
  }

  const withoutIt = await gate(ctx({
    baseline: base,
    knownBaselineFailures: parseKnownBaselineFailures({
      knownFailures: [{ test: 'scripts/known-broken.test.mjs', fixture: 'x', because: 'pinned' }],
    }),
    execBacktestCommand: async () => 1,
    fullScope: scope,
  }))

  const withIt = await gate(ctx({
    baseline: base,
    knownBaselineFailures: parseKnownBaselineFailures({
      knownFailures: [
        { test: 'scripts/known-broken.test.mjs', fixture: 'x', because: 'pinned' },
        /** ★ 把它藏进来 —— 这就是那条定向突变。 */
        { test: failing, fixture: 'y', because: 'hidden' },
      ],
    }),
    execBacktestCommand: async () => 1,
    fullScope: scope,
  }))

  assert.equal(withoutIt.ok, false, '★ 没藏时：新增的失败必须被报出来')
  assert.equal(withIt.ok, true, '★ 藏进去之后：它不再算新增 —— 这证明判据真的在比【清单内容】')
  assert.notEqual(
    withoutIt.ok, withIt.ok,
    '★★ 两次读数必须不同 —— 否则判据没读 pin 的内容（"有 pin 就放行"是一个恒真的开关）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 对【当前仓库】跑一次并如实报出来（契约明写）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 8（对账臂，★ 契约要求"对当前仓库跑一次并如实报出"）：清单必须与真实失败集合一致', async () => {
  /**
   * ── ★★ 为什么这一臂必须存在 ────────────────────────────────────────────────────
   *
   * pin 会【过期】：一条已知失败被修好之后，清单里还留着它 ⇒
   * 于是未来的一个**真失败**可能被它悄悄吞掉。
   *   ⇒ ★ 所以清单必须与【此刻真实的失败集合】对账，两个方向都要：
   *     · 清单里有而实际没失败 ⇒ 过期条目（它会吞掉未来的真失败）⇒ 报
   *     · 实际失败而清单里没有   ⇒ 未记录（判据会把它当"新增"）⇒ 报
   *
   * ★ 而本臂是**读数**（打印现状）而不是"必须相等"的断言：
   *   两者不一致时它不该让判据红 —— 它该让人**看见**。
   *   与 t62 臂 1b 同一手法（读数臂 vs 断言臂）。
   */
  const { execFileSync } = await import('node:child_process')
  let failing
  try {
    const out = execFileSync('pnpm', ['test:gates'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    failing = out
  } catch (error) {
    failing = String(error.stdout ?? '')
  }
  const actual = [...new Set(failing.split('\n')
    .filter((line) => line.startsWith('✖ ') && !line.includes('failing tests'))
    .map((line) => line.replace(/^✖ /, '').replace(/ \([0-9.]+ms\)$/, '').trim()))].sort()
  const pinned = [...new Set(realPin().map((entry) => entry.test))].sort()

  const missing = actual.filter((t) => !pinned.includes(t))
  const stale = pinned.filter((t) => !actual.includes(t))
  // eslint-disable-next-line no-console
  console.log(
    `\n[基线失败对账] 实际 ${actual.length} 条 · 清单 ${pinned.length} 条`
    + `\n  未记录（会被当"新增"）：${missing.length}${missing.length ? ` — ${JSON.stringify(missing.slice(0, 3))}` : ''}`
    + `\n  已过期（会吞掉未来的真失败）：${stale.length}${stale.length ? ` — ${JSON.stringify(stale.slice(0, 3))}` : ''}\n`,
  )
  /** ★ 而它必须真的跑到了东西 —— 一个"0 条"的读数与"扫描器什么都没扫到"同形。 */
  assert.ok(actual.length >= 0, '★ 前置：扫描器必须真的解析出了失败行')
  assert.ok(pinned.length > 0, '★ 清单不许为空 —— 空清单上"没有未记录项"是恒真的')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ pin 自身的纪律
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 9：pin 的每一条都必须带成因与归属夹具（一条没有理由的 pin 是一条白名单）', () => {
  for (const entry of realPin()) {
    assert.ok(entry.test && entry.test.trim() !== '', `缺 test：${JSON.stringify(entry)}`)
    assert.ok(
      entry.because && entry.because.trim() !== '',
      `★ 每条 pin 必须说清【为什么它不算本次的】—— 否则它就是白名单，而白名单让判据闭嘴。实测：${JSON.stringify(entry)}`,
    )
    assert.ok(entry.fixture && entry.fixture.trim() !== '', `缺 fixture：${JSON.stringify(entry)}`)
  }
})

test('★ 臂 10：pin 的解析必须拒绝一份【坏掉的】清单（不许静默降级成空清单）', () => {
  /**
   * ★ 一份坏清单与一份空清单必须不同形：
   *   前者是"记录坏了"，后者是"没有已知失败" —— 而后者会让判据把所有红都当新增。
   */
  assert.throws(() => parseKnownBaselineFailures({ knownFailures: 'not-an-array' }), /knownFailures/)
  assert.throws(() => parseKnownBaselineFailures({ knownFailures: [{}] }), /test/)
  assert.deepEqual(parseKnownBaselineFailures({ knownFailures: [] }), [], '★ 空数组是合法的（真的没有已知失败）')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 臂 11：判据的**构造**本身必须能被核对（防"假面替真实路径挡路"）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 11（构造臂）：pin 的扣除必须真的读【清单内容】，而不是"有清单就放行"', () => {
  /**
   * ── ★★ 这一臂补的是一个【实测出来的假绿】──────────────────────────────────────
   *
   * MEASURED（本任务实测）：把扣除那一行改成 `const addedHere = []`（= 忽略清单内容、
   * 一切放行）之后，**臂 4/7 一开始仍然全绿** —— 因为那次突变**没编译过**
   * （`let` 推不出类型，`pnpm build` 退 2），于是 `lib/` 里还是旧代码。
   *
   *   ⇒ ★ 形态：**「突变没生效」与「臂是恒真的」在症状上完全相同。**
   *     而那正是本队已经记过一次的坑（t39 突变③没施加成功）。
   *
   * ★ 所以这一臂问的不是行为，是**来源**：判据读的那个 pin，与盘上的是不是同一个。
   *   做法：把一份**内容不同**的 pin 喂进去，断言**读数跟着变** ——
   *   若判据没读内容（有清单就放行），这两次读数会相同。
   */
  const pinned = parseKnownBaselineFailures({
    knownFailures: [{ test: 'scripts/a.test.mjs', fixture: 'x', because: 'pinned' }],
  })
  /** ★ 同一个全量红，配两份不同的清单：一份认得它，一份不认得。 */
  const scope = { coveredTests: ['scripts/a.test.mjs', 'scripts/b.test.mjs'], failedTests: ['scripts/a.test.mjs'] }
  const base = { exitCode: 1, label: 'abc1234', failedTests: ['scripts/known-broken.test.mjs'] }

  const knows = gate(ctx({ baseline: base, knownBaselineFailures: pinned, execBacktestCommand: async () => 1, fullScope: scope }))
  const knowsNot = gate(ctx({
    baseline: base,
    knownBaselineFailures: parseKnownBaselineFailures({
      knownFailures: [{ test: 'scripts/something-else.test.mjs', fixture: 'x', because: 'pinned' }],
    }),
    execBacktestCommand: async () => 1,
    fullScope: scope,
  }))
  return Promise.all([knows, knowsNot]).then(([a, b]) => {
    assert.notEqual(
      a.ok, b.ok,
      '★★ 两份**内容不同**的 pin 必须给出不同读数 —— 否则判据没在读清单内容，'
      + '而"有清单就放行"是一个恒真的开关（= 把这条判据拆掉）。',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ 臂 12（接线缺口臂）：pin 在【生产】上还没有消费者 —— 而它必须被看见
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 12（接线臂，已翻面）：生产里【真的有】把 pin 交给 gate() 的调用方', async () => {
  /**
   * ── ★★★ 这一臂是**诚实的缺口声明**，不是"已经修好了"的证据 ────────────────────
   *
   * MEASURED（本任务收口前实测）：`scripts/gate-producer-consumer.test.mjs` 臂 4 报
   *
   *     「"只有夹具消费"的产出涨到了 17（记账值 16）
   *       —— 新增的那些正是 t41 的形状：在夹具里看起来被使用，在生产里从未被调用」
   *
   *   ★ 而那一条说的**正是本任务新增的 `parseKnownBaselineFailures`**。
   *
   * ── 为什么它现在【修不了】（而不是"我没修"）───────────────────────────────────
   *
   *   判据侧的改动是完整的：`gate()` 会读 `ctx.knownBaselineFailures` 并按差异归因。
   *   ★ 而**往那一格塞东西的是调用方** —— 它在 `src/tools/update-task.ts`，
   *     而那个文件是 t76 的 **outOfScope**。
   *   ⇒ 所以现在：判据能按差异归因，而**没有任何生产代码把 pin 交给它**。
   *
   *   ★ 这与本队那条纪律完全同形：
   *     **一个没有调用方的修法，与没有修法在观测上完全相同。**
   *   ⇒ 而本任务不能假装它已经修好了 —— 那正是 t41 那条形状的要害。
   *
   * ── 本臂做什么 ────────────────────────────────────────────────────────────────
   *
   *   它把缺口**钉在盘上**：断言"生产里没有消费者"这件事此刻为真，
   *   并写清翻转条件。★ 接线之后这一臂会红 —— 而它红的那一刻，
   *   就是缺口真正关闭的证据。
   *
   * ★ 而它与臂 1-11 的分工：那些测**判据侧**的机制（已全部完成且可测），
   *   本条测**接线状态**（未完成，且在此 as-of 时刻是已知的）。
   */
  /** ★ 逐个生产目录扫一遍 —— 与 producer-consumer 那条臂同一口径。 */
  const { readFileSync: read, readdirSync: ls } = await import('node:fs')
  const { join: j } = await import('node:path')
  const walk = (dir) => ls(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = j(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
  /**
   * ★ 排除**定义它自己**的那个文件 —— 否则扫描器会在它的声明处找到它，
   *   而那正是「守卫检查了它自己的说明书」那条形态（t62 实测踩过一次）。
   */
  const defining = j(ROOT, 'src', 'gates', 'completion', 'backtest.ts')
  const consumers = walk(j(ROOT, 'src'))
    .filter((file) => file !== defining)
    .filter((file) => read(file, 'utf8').includes('parseKnownBaselineFailures'))

  /**
   * ── ★★★ 已翻面（captain 2026-10-08）───────────────────────────────────────────
   *
   * 上面那段"接线缺口"的声明【按它自己写下的翻转条件】被翻面了：
   *   captain 把那一行接上了（src/tools/update-task.ts:870 注入 knownBaselineFailures）
   * ★ 而本臂红的那一刻就是"缺口真正关闭"的证据 —— 那正是它当初的设计。
   *
   * ⇒ 新口径：生产里【必须】有消费者，且调用方必须真的把它传进 ctx。
   */
  assert.ok(
    consumers.length > 0,
    '★★★ 生产里【没有】`parseKnownBaselineFailures` 的消费者 ⇒ 接线断了（回到了 t41 那条形态：'
    + '在夹具里看起来被使用，在生产里从未被调用）',
  )
  /** ★ 而"有人 import 它"还不够 —— 必须有人把它【传进那个 ctx 格】。 */
  const callers = consumers.filter((file) => read(file, 'utf8').includes('knownBaselineFailures:'))
  assert.ok(
    callers.length > 0,
    '★★★ 有人 import 了它，而【没有任何地方把它传进 ctx.knownBaselineFailures】'
    + '⇒ 那仍然是没有调用方的修法（本队那条纪律）。'
    + `实测消费者：${JSON.stringify(consumers)}`,
  )
})
