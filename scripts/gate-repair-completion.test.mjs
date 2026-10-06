#!/usr/bin/env node
/**
 * ── f-0020：repair 类任务与 TDD 完工门不匹配（无人值守的硬阻断）──────────────────
 *
 * ── 它修的是什么 ───────────────────────────────────────────────────────────────
 *
 * 本队已 **6 次**同形终止（t13/t16/t19/t25/t26 cancelled、t27 failed），全部由
 * captain 代落终态。原因不是交付物有问题，而是三道完工门的**问句与 repair 的
 * 验收不是同一件事**：
 *
 *   r5 / mutation 度量「为**新工作**写了新测试」—— 它们的输入面是 `newTestFiles`，
 *   而那是【本次新增】的测试文件。repair 的验收却是
 *   「修改**既有**夹具后它仍能判别」⇒ 净改动全落在既有文件上 ⇒ newTestFiles = 0。
 *
 *   实测（t27，本机复现）：
 *     r5.appliesTo(...) ⇒ true          （kind=repair 且 newTestFiles 是数组）
 *     r5.gate(...)      ⇒ unmeasured
 *       "R5 could not locate the new test files: none of the 0 reported file(s)
 *        resolve to a test path inside ["scripts"]"
 *   ⇒ 判据**诚实地说它没能测量**（它没有把"没测到"并进"通过"，这一点是对的），
 *     但一个诚实的 `unmeasured` 同样**交不出终态** —— 而它是恒常的、结构性的。
 *
 * ── ★★ 必须保住的原意（这是本任务最容易做错的一格）────────────────────────────
 *
 * r5/mutation 防的是【装饰性测试】：为新工作写测试，却抓不住缺陷（突变体存活即拒绝）。
 *
 * ⇒ 修法**不得**让「只更新既有夹具、而夹具不再能判别」变成可接受。
 *   本文件第 3 节用【定向突变】把这条钉死：构造那个情形 ⇒ 必须被拒。
 *
 *   判别的分界线（本修法的全部内容）：
 *     既有夹具**仍然能判别** ⇒ 它在父版本上红（或它能杀死变异体）⇒ 放行
 *     既有夹具**不再能判别** ⇒ 它在哪个版本上都绿        ⇒ 拒绝
 *   ★ 「更新的文件是不是新的」是**无关的**；「它还能不能抓住缺陷」才是问题。
 *     旧口径读的是前者（newTestFiles），而它把后者的答案一起丢掉了。
 *
 * Run: node --test scripts/gate-repair-completion.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { repairEvidenceFiles, repairCompletionVerdict } from '../lib/quality-gates.js'
import * as r5 from '../lib/gates/completion/r5.js'

/** 一条既有夹具（repair 会改它，但它不是"新增"的）。 */
const EXISTING_FIXTURE = 'scripts/gate-repair-completion.test.mjs'

/**
 * ★ 一个 worktree worker 的处境（模拟）。
 *
 * 它是 repair 类；它的净改动全落在**既有**夹具上（`newTestFiles` 因此是 `[]`）；
 * 它有一个父版本可对照。这正是 t27 实测的那份 ctx。
 */
function worktreeWorkerCtx(overrides = {}) {
  return {
    task: { id: 't27', kind: 'repair', inScope: [EXISTING_FIXTURE] },
    // ★ 净改动【全在既有夹具上】—— 这正是 t27 实测的形状（+139/-19 全在既有文件）。
    //   而 newTestFiles 是空集：它数的是"新增"，repair 一个都没新增。
    update: { changedPaths: [EXISTING_FIXTURE], newTestFiles: [] },
    wantsCompleted: true,
    taskNotTerminal: true,
    parentRevision: '25a3320',
    scanDirs: ['scripts'],
    /** 默认：这条既有夹具仍然能判别 —— 在父版本上红、在修复版本上绿。 */
    runTestOnRevision: async (_test, revision) => ({ exitCode: revision === 'working-tree' ? 0 : 1 }),
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 既有夹具【被更新】且【仍能判别】⇒ 必须放行（6 次同形终止的正面）
// ─────────────────────────────────────────────────────────────────────────────

test('arm 1 — a repair that updates an EXISTING fixture which still discriminates is allowed', async () => {
  const files = repairEvidenceFiles(worktreeWorkerCtx())
  assert.deepEqual(
    files, [EXISTING_FIXTURE],
    `the fixture the repair actually edited must be treated as evidence; got ${JSON.stringify(files)}`,
  )
})

test('arm 2 — and r5 then measures it instead of saying "none of the 0 reported file(s)"', async () => {
  const ctx = worktreeWorkerCtx({
    update: { changedPaths: [EXISTING_FIXTURE], newTestFiles: repairEvidenceFiles(worktreeWorkerCtx()) },
  })
  assert.equal(r5.appliesTo(ctx), true)
  const verdict = await r5.gate(ctx)
  assert.equal(verdict.ok, true, `expected r5 to pass, got ${JSON.stringify(verdict)}`)
  // ★ 通过时也必须交出两轮观测，而不是只说"过了"。
  assert.equal(verdict.r5.verified.length, 1)
  assert.equal(verdict.r5.verified[0].parentExitCode, 1)
  assert.equal(verdict.r5.verified[0].fixedExitCode, 0)
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. ★★ 定向突变：只更新既有夹具，而夹具【不再能判别】⇒ 必须被拒
//    —— 这是"保住 r5/mutation 原意"的那一格，也是本修法的唯一守门人
// ─────────────────────────────────────────────────────────────────────────────

test('arm 3 — DIRECTED MUTATION: an existing fixture that no longer discriminates is REJECTED', async () => {
  const ctx = worktreeWorkerCtx({
    update: { changedPaths: [EXISTING_FIXTURE], newTestFiles: repairEvidenceFiles(worktreeWorkerCtx()) },
    /**
     * 突变就在于"这两个退出码变成同一个"：
     * 夹具被改成恒绿 ⇒ 它不再区分"修好了"与"没修"。
     * ★ 这正是装饰性测试的定义，只是它这次落在一个【既有】文件上。
     */
    runTestOnRevision: async () => ({ exitCode: 0 }),
  })
  const verdict = await r5.gate(ctx)
  assert.equal(verdict.ok, false, 'a fixture that always passes must not be accepted')
  assert.equal(verdict.unmeasured, undefined, 'this is a finding about the work, not a measurement failure')
  assert.ok(
    verdict.blockers.some((item) => item.includes('decorative test')),
    `expected a decorative-test blocker naming the fixture; got ${JSON.stringify(verdict.blockers)}`,
  )
})

test('arm 4 — the paired half: a fixture red on BOTH revisions never turned green, so it is not evidence either', async () => {
  const ctx = worktreeWorkerCtx({
    update: { changedPaths: [EXISTING_FIXTURE], newTestFiles: repairEvidenceFiles(worktreeWorkerCtx()) },
    runTestOnRevision: async () => ({ exitCode: 1 }),
  })
  const verdict = await r5.gate(ctx)
  assert.equal(verdict.ok, false)
  assert.ok(
    verdict.blockers.some((item) => item.includes('never turned green')),
    `expected the "red twice" blocker; got ${JSON.stringify(verdict.blockers)}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. 三态不同形：仍然拿不到判别力证据 ⇒ unmeasured，绝不并进 ok
// ─────────────────────────────────────────────────────────────────────────────

test('arm 5 — no discriminating fixture at all is still unmeasured, never ok', async () => {
  // 一个只改了产物的 repair：没有任何夹具被更新 ⇒ 没有可测量的判别力。
  const ctx = worktreeWorkerCtx({
    task: { id: 't9', kind: 'repair', inScope: ['src/impl.ts'] },
    update: { changedPaths: ['src/impl.ts'], newTestFiles: [] },
    runTestOnRevision: async () => ({ exitCode: 0 }),
  })
  const files = repairEvidenceFiles(ctx)
  assert.deepEqual(files, [], 'a repair that touched no fixture has no discriminating evidence')
  const verdict = repairCompletionVerdict(ctx)
  assert.equal(verdict.ok, false)
  assert.equal(typeof verdict.unmeasured, 'string', 'silence about evidence must read as unmeasured, not ok')
})

test('arm 6 — undefined observation stays distinct from an observed-empty one', () => {
  // ★ "我没能观察" 与 "观察了、确实没有" 不同形（本队记账最久的那条界线）。
  const notObserved = repairCompletionVerdict(worktreeWorkerCtx({ update: {} }))
  const observedEmpty = repairCompletionVerdict(worktreeWorkerCtx({
    task: { id: 't9', kind: 'repair', inScope: ['src/impl.ts'] },
    update: { changedPaths: ['src/impl.ts'], newTestFiles: [] },
  }))
  assert.equal(typeof notObserved.unmeasured, 'string')
  assert.equal(typeof observedEmpty.unmeasured, 'string')
  assert.notEqual(
    notObserved.unmeasured, observedEmpty.unmeasured,
    'failing to observe and observing nothing must not be the same sentence',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. 关掉机制 ⇒ 臂必须红（规则二后半句）
// ─────────────────────────────────────────────────────────────────────────────

test('arm 7 — with the mechanism removed, arms 1-2 must go red', async () => {
  /**
   * ★ 把修法单独去掉，等价于"evidence 只取自 newTestFiles"：
   *   这时 repairEvidenceFiles 对一份净改动全在既有文件上的 repair 返回 []，
   *   于是臂 1 与臂 2 都塌回原来的失败态。
   *   本臂【复现那个形状】并断言它确实是坏的 —— 若有人把修法删掉，
   *   这一个断言会连同臂 1/2 一起红。
   */
  const legacy = (ctx) => (Array.isArray(ctx?.update?.newTestFiles) ? ctx.update.newTestFiles : [])
  const ctx = worktreeWorkerCtx()
  assert.deepEqual(legacy(ctx), [], 'the pre-fix reading finds nothing — that is the defect')
  assert.notDeepEqual(
    legacy(ctx), repairEvidenceFiles(ctx),
    'the mechanism must change this answer, otherwise it is not a mechanism',
  )
  const legacyR5 = await r5.gate({ ...ctx, update: { newTestFiles: legacy(ctx) } })
  assert.equal(legacyR5.ok, false, 'without the mechanism the worker cannot close out')
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. worktree worker 的处境（端到端模拟）
// ─────────────────────────────────────────────────────────────────────────────

test('arm 8 — a simulated worktree worker now has an honest path to a terminal state', async () => {
  /**
   * 这是 f-0020 的**收口断言**：模拟一个 worktree worker 的三道门处境，
   * 断言它不再被结构性挡住。
   *
   * ★ 只断言【可判别性】这一道（r5）。changedPaths 与 backtest 基线各有独立任务
   *   （t17/t23 那条链、t18），本任务不越界宣称它们已修好 —— 那会把
   *   "没测到的两条"并进"已通过"。
   */
  const ctx = worktreeWorkerCtx()
  const evidence = repairEvidenceFiles(ctx)
  assert.ok(evidence.length > 0, 'the worker must have discriminating evidence to declare')

  const verdict = await r5.gate({ ...ctx, update: { newTestFiles: evidence } })
  assert.equal(verdict.ok, true, `the worker must be able to close out; got ${JSON.stringify(verdict)}`)

  // 而"装饰品"那一路仍然关着 —— 修复没有把门整体拆掉。
  const decorative = await r5.gate({
    ...ctx,
    update: { newTestFiles: evidence },
    runTestOnRevision: async () => ({ exitCode: 0 }),
  })
  assert.equal(decorative.ok, false, 'the decorative path must stay closed after the repair')
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. ★★ 接线缺口（必须【显式】记账，不许被"夹具全绿"掩盖）
// ─────────────────────────────────────────────────────────────────────────────

test('arm 9 — WIRING GAP: the real path still reports unmeasured until the caller supplies the evidence', async () => {
  /**
   * ★ 这一臂是【诚实的缺口声明】，不是一条"已经修好了"的证据。
   *
   * `repairEvidenceFiles` 必须由**调用方**把结果交给 r5（`update.newTestFiles`）。
   * 而那个调用方是 `src/tools.ts` 的完成注入面 —— **本任务的 outOfScope**。
   *
   * ⇒ 于是修法本身对了，但**真实路径仍然是 unmeasured**：一个没有任何调用方的
   *   修复，与"没修"在可观测行为上同形。这正是本队记账的
   *   「假面可能替真实路径挡路」—— 夹具全绿而真实路径照样红。
   *
   * ★ 用一条断言把这件事钉在盘上：**当** tools.ts 接上线，这一臂会翻面
   *   （从 unmeasured 变成 ok），而翻面的那一刻就是缺口真正关闭的证据。
   *   ⇒ 在那之前，任何"f-0020 已修好"的说法都是没有根据的。
   */
  const asToolsBuildsItToday = {
    ...worktreeWorkerCtx(),
    update: { changedPaths: [EXISTING_FIXTURE], newTestFiles: [] },
  }
  const verdict = await r5.gate(asToolsBuildsItToday)
  assert.equal(
    verdict.ok, false,
    'if this now passes, src/tools.ts has been wired to repairEvidenceFiles — flip this arm and record it',
  )
  assert.match(
    String(verdict.unmeasured), /none of the 0 reported file\(s\)/,
    'the gap must stay visible in the exact wording that t27/t25/t16/t13 hit',
  )
})

test('arm 10 — the evidence this task supplies is exactly what closes arm 9', () => {
  const ctx = worktreeWorkerCtx()
  const evidence = repairEvidenceFiles(ctx)
  assert.deepEqual(evidence, [EXISTING_FIXTURE])
  // ★ 反过来说明 arm 9 的翻面条件就是"调用方把这一格传下去"。
  assert.notDeepEqual(evidence, ctx.update.newTestFiles, 'the gap is real: today the caller sends []')
})
