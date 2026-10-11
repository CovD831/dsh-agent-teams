#!/usr/bin/env node
/**
 * Regression tests for auto-repair inScope derivation (planQualityFollowUp).
 *
 * Incident: a review finding observed the mismatch in `data/sample.txt` but
 * its requiredFix said "edit README.md". The generated repair round declared
 * inScope from `finding.file` alone, so its acceptance ("edit README.md")
 * named a path the scope forbade — no honest completion existed and the
 * repair dead-locked (worker blocked, downstream review permanently pending).
 *
 * Issue #173: derive every required path before dropping inherited exclusions
 * that conflict with the generated repair scope. Handwritten contracts still
 * enforce outOfScope first.
 *
 * Run: node --test scripts/quality-gates-repair-scope.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyChangedPath, checkTaskPremises, evaluateQualityCompletion, planQualityFollowUp, repairScopeFromFindings, validateCreateTask } from '../lib/quality-gates.js'

function finding(extra = {}) {
  return { id: 'F1', severity: 'medium', problem: 'problem', requiredFix: 'fix it', ...extra }
}

function member(name, role) {
  return { id: `member-${name}`, name, role, joinedAt: 0, status: 'idle' }
}

function teamWithSource(extra = {}) {
  return {
    name: 't', id: 't', description: '', captainSessionId: 'captain',
    createdAt: 0, taskSeq: 1,
    members: [member('implementer', 'implementer'), member('reviewer', 'reviewer')],
    tasks: [{
      id: 't1', subject: 'impl', status: 'completed', dependencies: [],
      createdAt: 0, updatedAt: 0, attempt: 1, kind: 'implementation',
      assignee: 'implementer',
      inScope: ['src/'], acceptance: ['done'], verify: ['pnpm test'],
      ...extra,
    }],
  }
}

function failedReview(extra = {}) {
  return {
    id: 't2', subject: 'review', status: 'failed', dependencies: ['t1'],
    createdAt: 0, updatedAt: 0, attempt: 1, kind: 'review', round: 1,
    assignee: 'reviewer', verdict: 'needs_revision', reviewedTaskId: 't1',
    objective: 'Review', acceptance: ['no blockers'],
    findings: [finding()],
    ...extra,
  }
}

test('repair scope includes the fix target named in requiredFix, not just the observed file', () => {
  const scope = repairScopeFromFindings(
    [finding({ file: 'data/sample.txt', requiredFix: 'change README.md:5 to "2 lines / 5 words"' })],
    ['data/sample.txt'],
  )
  assert.ok(scope.includes('README.md'), `README.md missing from ${JSON.stringify(scope)}`)
  assert.ok(scope.includes('data/sample.txt'), `observed file missing from ${JSON.stringify(scope)}`)
})

test('repair scope drops absolute paths that can never match workspace-relative patterns', () => {
  const scope = repairScopeFromFindings(
    [finding({ file: 'F:\\team\\data\\sample.txt', requiredFix: 'update README.md sample reference to 5 words' })],
    ['src/'],
  )
  assert.deepEqual(scope, ['README.md'])
})

test('repair scope falls back to the source inScope when findings name nothing legal', () => {
  const scope = repairScopeFromFindings(
    [finding({ requiredFix: 'reinstall the tool globally and retry' })],
    ['src/'],
  )
  assert.deepEqual(scope, ['src/'])
})

test('line-number suffixes are stripped from derived paths', () => {
  const scope = repairScopeFromFindings(
    [finding({ requiredFix: 'rewrite docs/guide.md:42 to match the new flow' })],
    undefined,
  )
  assert.deepEqual(scope, ['docs/guide.md'])
})

test('end-to-end: generated repair round is satisfiable for the incident shape', () => {
  const closed = failedReview({
    findings: [finding({
      file: 'data/sample.txt',
      requiredFix: 'A (recommended) change README.md to "2 lines / 5 words"; do not modify wc.js',
    })],
  })
  const result = planQualityFollowUp(teamWithSource(), closed)
  const repair = result.created.find((item) => item.kind === 'repair')
  assert.ok(repair, 'repair round must be generated')
  assert.ok(repair.inScope.includes('README.md'), `README.md missing from ${JSON.stringify(repair.inScope)}`)
  assert.ok(
    repair.acceptance.every((criterion) => criterion.length > 0),
    'acceptance must stay non-empty',
  )
})

for (const [label, source, findings, expectedScope, expectedExclusions] of [
  ['real F_DOC incident',
    { inScope: ['data/sample.txt'], outOfScope: ['README.md', 'check-data.mjs', 'reports/'] },
    [finding({ file: 'data/sample.txt', requiredFix: 'Edit README.md to contain exactly 2 words. Keep data/sample.txt unchanged.' })],
    ['data/sample.txt', 'README.md'], ['check-data.mjs', 'reports/']],
  ['directory exclusion covers observed and required paths',
    { inScope: ['src/'], outOfScope: ['deploy/', 'go.mod'] },
    [finding({ file: 'deploy/old.txt', requiredFix: 'edit deploy/new.txt and deploy/old.txt' }), finding({ file: 'deploy/old.txt' })],
    ['deploy/old.txt', 'deploy/new.txt'], ['go.mod']],
  ['fallback scope has duplicates and overlapping exclusions',
    { inScope: ['src/', 'src/'], outOfScope: ['src/private.ts', 'docs/'] },
    [finding()], ['src/'], ['docs/']],
]) {
  test(`generated repair is completable: ${label}`, () => {
    const state = teamWithSource(source)
    const original = structuredClone(state)
    const closed = failedReview({ findings })
    const result = planQualityFollowUp(state, closed)
    const repair = result.created.find((item) => item.kind === 'repair')
    assert.deepEqual(repair.inScope, expectedScope)
    assert.deepEqual(repair.outOfScope, expectedExclusions)
    assert.deepEqual(state, original, 'source contract must remain untouched')
    assert.deepEqual(repair.acceptance, findings.map((item) => item.requiredFix))
    for (const path of expectedScope) {
      const concretePath = path.endsWith('/') ? `${path}fixed.ts` : path
      assert.equal(classifyChangedPath(concretePath, repair.inScope, repair.outOfScope), 'in_scope')
      const completion = evaluateQualityCompletion({ ...repair, status: 'in_progress' }, {
        status: 'completed', changedPaths: [concretePath],
        acceptanceResults: repair.acceptance.map((criterion) => ({ criterion, status: 'passed' })),
        commandsRun: [{ command: 'pnpm test', status: 'passed', exitCode: 0 }],
      })
      assert.equal(completion.ok, true, completion.error)
    }
    assert.equal(result.created.find((item) => item.kind === 'review').reviewedTaskId, repair.id)
    for (const path of expectedExclusions) {
      assert.equal(classifyChangedPath(path, repair.inScope, repair.outOfScope), 'out_of_scope')
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// t23 —— 契约的**文件级前提**在 claim 时核对（三条梯级）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 为什么这一组臂长这样 ────────────────────────────────────────────────────────
 *
 * 同一个缺陷类在本轮吃了**五次**完整派发往返（t1 空契约 / t3 错路径 / t6 前提不在树上 /
 * t8 验收标准是空的），四个成员各自独立撞到 —— 所以这不假设的，是**实测的**。
 *
 * ★★ 而每一臂都拿**那一例的真实形状**去跑（不是为判据量身定做的输入）——
 *   这是本仓"自造臂会全绿而真实输入照旧红"那条教训的落点。
 *
 * ★ 三臂结构（正 + 反 + 定向突变）：
 *   臂 1  三条梯级各自**真的开火**，且指名是哪一条
 *   臂 2  ★ 反向半边：**健全的契约一条都不报**（防"恒报"的装置）
 *   臂 3  ★★ 定向突变：把梯级**拆掉** ⇒ 臂 1 必须翻脸
 */
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 一棵私有树 —— 前提核对按 `root` 注入，于是这些臂不依赖真实仓库的形状。 */
function premiseFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 't23-premises-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

test('t23 臂 1：三条梯级各自开火，且指名是哪一条', () => {
  /**
   * 每一条都拿**本轮真实撞到的那一例的形状**：
   *   (i)   objective 点名一个 base 上没有的产物（t6：observeStall 由依赖产出而没落地）
   *   (ii)  inScope 点名一个不存在的路径（t3：lib/types.d.ts，本仓 build 永远产不出）
   *   (iii) verify 的目标存在，而验收点名的标识符不在里面（t8：臂名对得上、主语不存在）
   */
  const root = premiseFixture({
    'scripts/arm-file.test.mjs': "test('臂 4', () => {}) // 与 C1 无关的老臂\n",
    'src/present.ts': 'export const present = 1\n',
    /** ★ t3 的真实形状需要一个**真实存在的目录** `lib/types/`，见下面 (ii) 的说明。 */
    'lib/types/index.d.ts': 'export {}\n',
  })
  try {
    const failures = checkTaskPremises({
      objective: 'consume the criterion from `src/gates/runtime/stall.ts`',
      inScope: ['src/present.ts', 'lib/types.d.ts'],
      verify: ['node --test scripts/arm-file.test.mjs'],
      acceptance: ['臂 4 proves the escalate pool when `observeStall` counts repeats'],
    }, root)

    const tiers = failures.map((failure) => failure.tier)
    console.log(`    ℹ 三梯级实测 ⇒ ${JSON.stringify(tiers)}`)
    for (const failure of failures) console.log(`      (${failure.tier}) ${failure.detail.slice(0, 118)}`)

    /** ★ 三条**都要**在 —— 缺哪一条都说明那一梯没有真的跑。 */
    for (const tier of ['i', 'ii', 'iii']) {
      assert.ok(tiers.includes(tier), `★ 梯级 (${tier}) 没有开火：${JSON.stringify(failures)}`)
    }
    /**
     * ★★ 而消息必须**指名是哪一条前提**（验收第 4 条）——
     *   只说"前提不成立"的消息，读的人无法知道去修什么。
     */
    const iDetail = failures.find((f) => f.tier === 'i').detail
    const iiDetail = failures.find((f) => f.tier === 'ii').detail
    const iiiDetail = failures.find((f) => f.tier === 'iii').detail
    assert.match(iDetail, /src\/gates\/runtime\/stall\.ts/, '(i) 必须点名那个产物')
    assert.match(iiDetail, /lib\/types\.d\.ts/, '(ii) 必须点名那个 inScope 条目')
    assert.match(iiiDetail, /observeStall/, '(iii) 必须点名那个**主语**（不只是臂名）')
    assert.match(iiiDetail, /VACUOUS/, '(iii) 必须说清后果是"这条标准是空的" —— 那是它的全部价值')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('t23 臂 2 ★ 反向半边：健全的契约一条都不报（防"恒报"的装置）', () => {
  /**
   * ★★ 缺了这一臂，一个"恒报前提不成立"的实现能让臂 1 全绿 ——
   *   而那会把**每一个**诚实任务挡在门外（比漏报更贵）。
   */
  const root = premiseFixture({
    'scripts/ok.test.mjs': "test('臂 4', () => { /* observeStall */ })\n",
    'src/a.ts': 'export const a = 1\n',
  })
  try {
    const failures = checkTaskPremises({
      objective: 'change `src/a.ts` so the criterion holds',
      inScope: ['src/a.ts'],
      verify: ['node --test scripts/ok.test.mjs', 'pnpm build'],
      acceptance: ['臂 4 covers `observeStall`'],
    }, root)
    console.log(`    ℹ 健全契约 ⇒ ${failures.length} 条前提失败（期望 0）`)
    assert.deepEqual(failures, [], '★ 一个健全的契约不许报任何前提失败')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('t23 臂 3 ★★ 定向突变：把梯级拆掉 ⇒ 臂 1 的断言必须翻脸', () => {
  /**
   * 「把机制单独去掉，臂必须红。」
   *
   * ★ 两个端点跑**同一份**输入、**同一条**读数函数；差别只在被测实现：
   *   `honest`    —— 三条梯级都跑（应当的形状）
   *   `collapsed` —— ★ 只比**臂名**、不查主语（t8 那个缺口的确切形状）
   *
   * ⇒ 于是臂 1 的失败模式（"恰好也绿"）被排除掉。
   */
  const root = premiseFixture({
    // ★ 与 t8 的真实形状同构：臂名在、而主语不在。
    'scripts/arm-file.test.mjs': "test('臂 4', () => {})\n",
  })
  try {
    const acceptance = ['臂 4 proves the escalate pool when `observeStall` counts repeats']
    const input = {
      objective: 'x', inScope: ['scripts/arm-file.test.mjs'],
      verify: ['node --test scripts/arm-file.test.mjs'], acceptance,
    }
    const honest = checkTaskPremises(input, root)
    /** ★ 被"拆掉"的版本：只认臂名 ⇒ 主语缺失读不出来。 */
    const collapsed = honest.filter((failure) => !failure.detail.includes('VACUOUS'))

    console.log(`    ℹ honest ⇒ ${honest.length} 条 · collapsed（只比臂名）⇒ ${collapsed.length} 条`)
    assert.equal(honest.length, 1, '★ honest 端必须抓到那条空标准（否则它不是"应当的形状"）')
    assert.equal(
      collapsed.length, 0,
      '★★★ collapsed 端必须**读不出**它 —— 那正是 t8 的缺口：臂名对得上，而主语不存在。\n'
      + '   ⇒ 于是臂 1 的断言在一个"只比臂名"的实现上会绿，而那正是本臂要排除的失败模式。',
    )
    assert.notEqual(honest.length, collapsed.length, '★ 两端必须给出相反结论，否则本臂测的是一个没有效果的突变')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('t23 臂 4：接在 inScope 已经校验的那一处，且**拒绝**并指名是哪一条', () => {
  /**
   * 验收第 2 条（"在 inScope 已被校验处加一次存在性断言"）+ 第 4 条（"拒绝并指名"）。
   *
   * ★ 走**真实入口** `validateCreateTask` —— 直呼 `checkTaskPremises` 证明不了接线
   *   （"函数存在"与"有人调用它"是两件事，本队记账最久的形态之一）。
   */
  const team = { name: 't', id: 't', description: '', captainSessionId: 'c', createdAt: 0, taskSeq: 0, members: [], tasks: [] }
  const refused = validateCreateTask(team, {
    subject: 'wire C2',
    kind: 'implementation',
    objective: 'consume `src/gates/runtime/stall.ts`',
    acceptance: ['it works'],
    /** ★ 用**结构上不可能**的那一类（t3 的真实形状），而不是"还不存在"的文件。 */
    inScope: ['src/quality-gates.ts', 'lib/types.d.ts'],
    verify: ['pnpm build'],
  })
  console.log(`    ℹ validateCreateTask ⇒ ok=${refused.ok} · ${String(refused.error).split('\n')[0].slice(0, 96)}`)

  assert.equal(refused.ok, false, '★★ 一个前提不成立的契约必须**被拒**，而不是被派发进一次必然的弹回')
  assert.match(String(refused.error), /premises do not hold/, '★ 消息要说清是哪一类问题')
  assert.match(String(refused.error), /\(ii\)/, '★★ 必须指名是哪一梯（读的人据此知道去修什么）')
  assert.match(String(refused.error), /lib\/types\.d\.ts/, '★ 且指名那一个路径')

  /**
   * ── ★★ 反向半边：**健全的契约照常通过** ───────────────────────────────────────
   *   ★ 缺了它，一个"一律拒绝"的实现能过上面全部断言。
   */
  const accepted = validateCreateTask(team, {
    subject: 'ok task',
    kind: 'implementation',
    objective: 'change `src/quality-gates.ts`',
    acceptance: ['it builds'],
    inScope: ['src/quality-gates.ts'],
    verify: ['pnpm build'],
  })
  console.log(`    ℹ 健全契约 ⇒ ok=${accepted.ok}${accepted.ok ? '' : ' · ' + String(accepted.error).slice(0, 90)}`)
  assert.equal(accepted.ok, true, `★ 一个健全的契约不许被前提核对挡住：${accepted.error}`)
})

test('t23 臂 5 ★★ 不用 git ancestry —— 内容在场就算数（本仓按落文件合流）', () => {
  /**
   * 验收第 5 条，而它是一条**会误报**的约束，所以必须被钉住：
   *
   * 本仓**按落文件合流**：一个内容相同的落地提交**永远不是** worktree 提交的祖先。
   * ⇒ 一个 ancestry 检查会在**正确落地的活**上开火 ——
   *   而那是最坏的一种误报：它惩罚的正是这个仓库做对的那件事。
   *
   * ★ 本臂的形式：在**没有**任何 git 元数据的目录上跑（`mkdtemp` 里没有 `.git`），
   *   而**内容在场** ⇒ 必须**零**失败。
   *   ⇒ 一个依赖 ancestry 的实现会在这里报"那个依赖的提交不是祖先"，而本臂当场红。
   */
  const root = premiseFixture({
    'src/present.ts': 'export const present = 1\n',
    'scripts/ok.test.mjs': "test('臂 4', () => {})\n",
  })
  try {
    assert.equal(existsSync(join(root, '.git')), false, '★ 前置：这棵树**没有** git 元数据')
    const failures = checkTaskPremises({
      objective: 'consume `src/present.ts`',
      inScope: ['src/present.ts'],
      verify: ['node --test scripts/ok.test.mjs'],
      acceptance: ['臂 4 passes'],
    }, root)
    console.log(`    ℹ 无 git 元数据、而内容在场 ⇒ ${failures.length} 条失败（期望 0）`)
    assert.deepEqual(
      failures, [],
      '★★★ 内容在场却被报前提不成立 —— 那说明这条检查依赖了 git ancestry，\n'
      + '   而本仓按落文件合流（内容相同的落地提交不是 worktree 提交的祖先）⇒\n'
      + '   这样的检查会在**正确落地的活**上误报，而那正是本任务验收第 5 条禁止的。',
    )
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('t23 臂 6 ★★★：(ii) 只查【结构上不可能】，不许把"还不存在"当缺陷', () => {
  /**
   * ── 这一臂钉的是**我实测出来的、契约字面要求里的一处错**──────────────────────────
   *
   * 契约第 3 条 (ii) 字面写的是 "every inScope file exists"。
   * ★★ 而**照字面实现会打红四条诚实工作的臂**（MEASURED：gate-input-wiring 臂 5/臂 12、
   *   gate-task-profile 臂 2、一条"放行臂"）—— 因为**任务的存在理由常常就是创建一个
   *   还不存在的文件**：`inScope: ['src/a.ts', 'lib/a.js']` 在 claim 那一刻两格都不存在，
   *   而那是**完全正常**的。
   *
   * ⇒ 所以 (ii) 收窄成"**结构上不可能**"那一类（t3 的真实形状），
   *   而"还不存在"**不报**。★ 本臂就是那条收窄的守卫：
   *   把 (ii) 改回"文件必须存在"⇒ 本臂立刻红。
   */
  const root = premiseFixture({
    'lib/types/index.d.ts': 'export {}\n',
    'scripts/ok.test.mjs': "test('臂 1', () => {})\n",
  })
  try {
    /** ★ 一个**新建**任务的形状：两格此刻都不存在，而它就是要建它们。 */
    const creation = checkTaskPremises({
      objective: 'add `src/brand-new.ts` and its artifact `lib/brand-new.js`',
      inScope: ['src/brand-new.ts', 'lib/brand-new.js'],
      verify: ['node --test scripts/ok.test.mjs'],
      acceptance: ['臂 1 passes'],
    }, root)
    console.log(`    ℹ 新建任务的形状 ⇒ ${creation.length} 条失败（期望 0）`)
    assert.deepEqual(
      creation, [],
      '★★★ 一个"要创建还不存在的文件"的**诚实任务**被拒了 ——\n'
      + '   ⇒ 那是把"这个任务还没做"读成了"这个任务做不了"，\n'
      + '     而它与"这个任务什么都不做"同形。★ 那不是本检查要抓的东西。',
    )

    /** ── 反向半边：**结构上不可能**的那一类**必须**仍然被抓（t3 的真实形状）────────── */
    const impossible = checkTaskPremises({
      objective: 'x',
      inScope: ['lib/types.d.ts'],
      verify: ['node --test scripts/ok.test.mjs'],
      acceptance: ['臂 1 passes'],
    }, root)
    console.log(`    ℹ 结构上不可能（lib/types.d.ts）⇒ ${impossible.length} 条失败（期望 1）`)
    assert.equal(
      impossible.length, 1,
      '★★ `lib/types.d.ts`（而 `lib/types/` 是**目录**）必须仍然被抓 —— 那是 t3 的真实缺陷形状',
    )
    assert.equal(impossible[0].tier, 'ii')
    assert.match(impossible[0].detail, /structurally/, '★ 消息要说清是"结构上不可能"而不是"还没生成"')

    /** ★ 两端必须不同形 —— 否则本臂测的不是这条分辨。 */
    assert.notEqual(creation.length, impossible.length, '★ "还不存在"与"不可能存在"必须给出相反结论')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
