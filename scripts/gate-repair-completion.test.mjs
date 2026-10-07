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
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repairEvidenceFiles, repairCompletionVerdict } from '../lib/quality-gates.js'
import * as r5 from '../lib/gates/completion/r5.js'
// ★ t39：工具的源码面现在是 src/tools.ts + src/tools/**（见该模块的文件头）
import { toolsSource } from './tools-source.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * ── ★★ 端到端驱动：走**真实的 `update_task` 入口**（t33 的核心证据）─────────────
 *
 * ── 为什么必须端到端 ──────────────────────────────────────────────────────────
 *
 * 上面 arm 1-8 直接调 `r5.gate()`，证明的是**机制本身对**。
 * 而 f-0020 的缺口恰恰不是"机制不对" —— 是**机制没被调用**
 * （integrator6：「一个没有调用方的修法，与没有修法在观测上完全相同」）。
 * ⇒ 只有走真实入口，才能证明**那根线接上了**。
 *
 * ── 它造的是什么场景 ──────────────────────────────────────────────────────────
 *
 * 一个 repair 类任务：净改动全落在**既有夹具**上（`newTestFiles` 为空 —— 这正是
 * repair 的形状），而那条夹具**仍能判别**（在父版本上红、在修复版本上绿）。
 *
 * ★ 返回 `{ kind, ok, measured, reason }` 四格，因为本臂要区分三种结局：
 *     · `ok: true` 且 measured 含既有夹具      ⇒ 接线成功（arm 9）
 *     ⇒ `ok: false` 且理由含 decorative        ⇒ 门保住了（arm 9b）
 *     · 理由含 "none of the 0 reported file(s)" ⇒ **接线没落地**（翻面前那版）
 */
async function realPathRepair({ repairing = true, decorative = false } = {}) {
  const { registerAgentTeamsTools } = await import('../lib/tools.js')
  const { createTeamDir } = await import('../lib/state.js')

  const workspace = mkdtempSync(join(tmpdir(), 'repair-e2e-'))
  const git = (args) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q', '.'])
  /** ★ 既有夹具真的存在（否则 r5 的路径解析会先失败，那是另一个原因的红）。 */
  mkdirSync(join(workspace, 'scripts'), { recursive: true })
  writeFileSync(
    join(workspace, 'scripts', 'existing.test.mjs'),
    "import test from 'node:test'\nimport assert from 'node:assert/strict'\n"
    + "import { a } from '../src.ts'\n"
    + "test('pins the original behaviour', () => { assert.equal(a(1, 1), 2) })\n",
  )
  writeFileSync(join(workspace, 'src.ts'), 'export function a(x, y) { return x + 1 }\n')
  git(['add', '-A'])
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])
  const base = git(['rev-parse', 'HEAD']).trim()

  /**
   * ★ 现在**真的改一次**（提交之后再改 ⇒ 工作区是脏的）：
   *   · 源文件：改动落在**可变异的一行**上（mutation 要它定位可变异范围）；
   *   · 既有夹具：改动让它引用新的返回值（r5 的判别力证据来自它）。
   * ★ 两个都要**真的写到盘上** —— 只申报不写，`dispatch.changed-paths` 会先拒
   *   （那正是它该做的），而那时本臂读到的是另一条判据的话。
   */
  writeFileSync(join(workspace, 'src.ts'), 'export function a(x, y) { return x + 2 }\n')
  if (!decorative) {
    /**
     * ★ 仍能判别，且**真的能被 `node --test` 跑出摘要**（mutation 要读 `ℹ pass N`）。
     *   · 在**修复版本**上：a() 返回 2 ⇒ 这条断言绿；
     *   · 在**父版本**上：a() 返回 1 ⇒ 红（这正是"它还能判别"的证据）。
     * ★ 用真实的 `node:test` 格式而不是裸断言 —— 裸断言跑出来的输出里
     *   没有汇总行，mutation 会报 "did not report a readable summary"，
     *   而那是**另一个原因的红**（夹具没写对，不是接线没生效）。
     */
    writeFileSync(
      join(workspace, 'scripts', 'existing.test.mjs'),
      /**
       * ★ 自包含：**不 import 那个 `.ts`** —— `node --test` 直接跑 `.mjs` 时
       *   解析不了 `.ts` 的导入（那会让套件跑不起来 ⇒ mutation 报
       *   "did not report a readable summary"，而那是**另一个原因的红**）。
       *   本臂要验的是"接线把判别力证据交下去了吗"，不是"Node 能不能跑 ts"。
       */
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\n"
      + "import { a } from '../src.ts'\n"
      + "test('the repaired behaviour is pinned', () => { assert.equal(a(1, 1), 3) })\n",
    )
  } else {
    /**
     * ★ 装饰性：一条**在哪个版本上都绿**的既有夹具 —— 它不再判别任何东西。
     *   门必须仍然拒绝它（这是"翻面不得以放宽为代价"的那一半）。
     */
    writeFileSync(
      join(workspace, 'scripts', 'existing.test.mjs'),
      "// this fixture asserts nothing about the change\n",
    )
  }

  const stateRoot = join(workspace, '.agent-teams')
  await createTeamDir(stateRoot, {
    id: 'team', name: 'T', captainSessionId: 'cap', createdAt: 1, taskSeq: 1,
    members: [{ id: 'm1', name: 'worker', status: 'working', joinedAt: 1 }],
    tasks: [{
      id: 't1', subject: 'repair it', status: 'in_progress', assignee: 'worker', dependencies: [],
      attempt: 1, attemptId: 'a1', kind: 'repair', objective: 'o',
      inScope: ['scripts/existing.test.mjs', 'src.ts'], acceptance: ['x'], verify: ['true'],
      createdAt: 1, updatedAt: 1,
      /**
       * ★ 净改动**全在既有夹具上** —— 这正是 t27 实测的形状（+139/-19 全在既有文件）。
       *   而 `newTestFiles` 因此是空集：它数的是"新增"，repair 一个都没新增。
       */
      changedPaths: ['scripts/existing.test.mjs', 'src.ts'],
      /** ★ t18 的父版本记录：让 backtest 拿得到 baseline（与本次接线无关，但不给会先红）。 */
      baseRevision: base,
    }],
  })

  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined }, list() { return [] },
      sendMessage: async () => 'msg-0', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { get() { return undefined } },
    on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, {
    stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined,
  })

  /**
   * ★ 成员的会话里**观察到**那条既有夹具被改过 —— 这是 `observedFiles` 的来源，
   *   也是 `repairEvidenceFiles` 的输入面。
   */
  /**
   * ── ★★ 为什么会话里【观察不到任何写入】（这是本臂的分水岭）──────────────────
   *
   * MEASURED（t33 第一版把这一点做错了）：我原先让会话事件里带着
   * `meta.diffs`，于是 `observedTestFiles` 非空 ⇒ `newTestFiles` 非空
   * ⇒ **r5 本来就能跑**，而那意味着**接线取不取用根本看不出差别**
   * （定向突变实测：去掉接线后臂 9 照样绿 —— 一条测不到机制的臂）。
   *
   * ⇒ 真正的 repair 形状是：文件的改动由**任务契约**（`changedPaths`）声明，
   *   而**本 session 的观察里没有它**（成员改的是既有夹具，宿主事件未覆盖到）。
   *   此时：
   *     · 旧口径（只传 `newTestFiles`）⇒ 空 ⇒ r5 恒报 "none of the 0 reported file(s)"
   *     · 新口径（接线传 `repairEvidenceFiles`）⇒ 从 `changedPaths` 取到既有夹具 ⇒ 可测
   *   ★ 于是这条臂**只在接线存在时**才可能通过 —— 那才是它该测的东西。
   */
  const diffs = []
  void diffs
  const member = {
    id: 'm1', status: 'working', steer() {},
    session: {
      header: { cwd: workspace, id: 'sess-m1' },
      events: [{ type: 'tool/result', meta: { diffs } }],
      ownEvents() { return [{ type: 'tool/result', meta: { diffs } }] },
    },
  }

  const message = await tools.get('agent_teams_update_task').execute(
    {
      task_id: 't1', attempt_id: 'a1', status: 'completed', changedPaths: ['scripts/existing.test.mjs', 'src.ts'],
      acceptanceResults: [{ criterion: 'c', status: 'passed' }],
      commandsRun: [{ command: 'true', status: 'passed', exitCode: 0 }],
    },
    { agent: member, signal: new AbortController().signal },
  ).then(() => undefined).catch((error) => String(error.message))

  void repairing
  void decorative
  /**
   * ★ 把结果压成四格。三种结局各自不同形（本队纪律：三态不许合并）：
   *   ok           ⇒ 接线成功
   *   decorative   ⇒ 门保住了（既有夹具不再能判别）
   *   none-of-zero ⇒ **接线没落地**（翻面前那版的形状）
   *   其它         ⇒ 别的输入面缺（与本次接线无关，如实交出来）
   */
  const text = String(message ?? '')
  if (message === undefined) return { ok: true, kind: 'completed', measured: ['scripts/existing.test.mjs'], reason: '' }
  if (/none of the 0 reported file\(s\)/.test(text)) return { ok: false, kind: 'unmeasured-none-of-zero', measured: [], reason: text }
  if (/decorative/i.test(text)) return { ok: false, kind: 'decorative', measured: [], reason: text }
  return { ok: false, kind: 'other', measured: [], reason: text }
}

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

test('arm 9 — ★ FLIPPED (t33): the real path no longer reports the f-0020 wording', async () => {
  /**
   * ── ★★ 这一臂【翻面了】，而那一刻就是 f-0020 真正关闭的证据 ────────────────────
   *
   * ── 它翻面之前是什么 ──────────────────────────────────────────────────────────
   *
   * 上一版断言：真实路径**仍然**报
   *   "R5 could not locate the new test files: none of the 0 reported file(s)…"
   * —— 因为 `repairEvidenceFiles` / `repairCompletionVerdict` 虽写好了却**零调用方**
   * （调用点在 `src/tools.ts` 的完成注入面，当时不在 inScope）。
   *
   *   integrator6 的原话：「**一个没有调用方的修法，与没有修法在观测上完全相同。**」
   *   ⇒ 它没用"夹具 10/10 绿"冒充已修好，而是把缺口**如实写成一条臂**。
   *
   * ── 现在：那句话消失了 ────────────────────────────────────────────────────────
   *
   * t33 接上了调用点，于是 r5 收到的是 `discriminatingFiles`（含既有夹具）。
   * ★ 本臂钉的是**那一句话不再出现** —— 它是 f-0020 的**指名字样**，
   *   而它在真实路径上消失，正是"接线生效"的直接证据。
   *
   * ── ★★ 诚实边界：这一臂**测不到**"整条链 ok" ──────────────────────────────────
   *
   * MEASURED（t33 实测，已独立复现）：真实路径仍然红，但红的理由**换成了 mutation**：
   *   "the killer suite did not report a readable summary (exitCode 0)"
   *
   * 而那不是接线的问题 —— 是 **`node:test` 的环境限制**：
   *   从**一个 `node --test` 进程里**再起 `node --test` 会被**跳过**：
   *     "node:test run() is being called recursively within a test file. skipping running files."
   *   而 mutation 的 `runTest` 恰恰要走 `/bin/sh` 起子进程。
   *
   * ⇒ **在夹具里无法让真实路径走完 mutation 的成功分支**。这是环境事实，不是缺陷。
   *   ⇒ 所以本臂断言的是**能够观测**的那一半（f-0020 的指名字样消失），
   *     并把测不了的那一半**写在这里**，而不是假装覆盖了它（本队纪律）。
   *   ★ 独立的复现（在一次真实的 `update_task` 里跑那条套件）确认它单独跑是绿的：
   *     `ℹ tests 1 / ℹ pass 1 / ℹ fail 0`
   */
  const verdict = await realPathRepair({})
  assert.notEqual(
    verdict.kind, 'unmeasured-none-of-zero',
    '★ 真实路径仍报 "none of the 0 reported file(s)" ⇒ 接线没落地（这正是翻面要抓的）',
  )
  /**
   * ★ 而它换成了 mutation 的环境限制 —— 那**不是** f-0020 的缺口。
   *   本断言把两者分开：一个不许被读成另一个。
   */
  assert.match(
    verdict.reason, /mutation/i,
    `★ 接线后真实路径的下一道坎应当是 mutation（而不是 r5 的 none-of-zero）。实测：${verdict.reason}`,
  )
})

test('arm 9b — ★ the paired half: decorative evidence is still rejected by the mechanism', async () => {
  /**
   * ★ 翻面**不得**以放宽为代价。
   *
   * ★ 边界（与 arm 9 同一条）：在夹具里真实路径走不完 mutation，
   *   所以"装饰性夹具被真实路径拒绝"这件事**测不到**（环境限制）。
   *   ⇒ 本臂断言**能测到的那一半**：同一个 ctx 下，`repairCompletionVerdict`
   *     对"改了既有夹具"给证据，而对"没改任何夹具"给 unmeasured ——
   *     后者不构成判别力证据，因而**不可能**让 r5 通过。
   */
  const withFixture = repairCompletionVerdict({
    task: { id: 't1', kind: 'repair', inScope: [EXISTING_FIXTURE] },
    update: { changedPaths: [EXISTING_FIXTURE] },
  })
  assert.equal(withFixture.ok, true, '★ 改了既有夹具 ⇒ 有判别力证据')
  assert.deepEqual(withFixture.evidence, [EXISTING_FIXTURE])

  const withoutFixture = repairCompletionVerdict({
    task: { id: 't1', kind: 'repair', inScope: [EXISTING_FIXTURE] },
    update: { changedPaths: ['src/impl.ts'] },
  })
  assert.equal(
    withoutFixture.ok, false,
    '★ 只改了实现、没碰任何夹具 ⇒ **没有**判别力证据 ⇒ unmeasured（不许被读成 ok）',
  )
  assert.match(String(withoutFixture.unmeasured), /none of the \d+ changed file\(s\) is a test fixture/)

  /**
   * ★ 而"装饰性"这一路的拒绝由 arm 3 / arm 4 在**判据层**钉住
   *   （两条都走 `r5.gate()`，不受 `node:test` 嵌套限制影响）。
   */
  const decorative = await r5.gate({
    ...worktreeWorkerCtx(),
    update: { changedPaths: [EXISTING_FIXTURE], newTestFiles: [EXISTING_FIXTURE] },
    runTestOnRevision: async () => ({ exitCode: 0 }),
  })
  assert.equal(decorative.ok, false, '★ 在哪个版本上都绿的既有夹具必须被拒')
  assert.match(String(decorative.blockers ?? decorative.unmeasured), /decorative/i)
})

test('arm 11 — DIRECTED MUTATION: removing the wiring must send the real path back to unmeasured', () => {
  /**
   * ── ★ 规则二后半句的可执行形式 ────────────────────────────────────────────────
   *
   * 「把要保护的机制**单独**去掉，臂必须红」—— 而这里"机制"就是那一行接线。
   * ⇒ 本臂读源码确认接线**存在**，且**在真实路径上**（不是只在夹具里）。
   *
   * ★ 为什么读源码而不是真的改它再重建：本文件与其它夹具**并行跑**，
   *   改 `src/tools.ts` 会污染同进程的别的用例（本队已因此返工过）。
   *   而"接线在不在"是一个**文本级**的事实，读得准就够了 ——
   *   真正的行为证据由 arm 9/9b 的端到端读数给出（那才是主语）。
   */
  const source = toolsSource()
  assert.match(
    source, /repairCompletionVerdict\(/,
    '★ 调用点必须真的调用它 —— 一个没有调用方的修法与没有修法在观测上完全相同',
  )
  assert.match(
    source, /discriminatingFiles === undefined \? \{\} : \{ newTestFiles: discriminatingFiles \}/,
    '★ 而且它的产出必须**交给 r5 收的那一格**（只在本地算完就是没接线）',
  )
  assert.match(
    source, /repairEvidence\.evidence/,
    '★ 并进的是 `evidence`（判别力证据本身），不是别的字段',
  )
})

test('arm 10 — the evidence this task supplies is exactly what closes arm 9', () => {
  const ctx = worktreeWorkerCtx()
  const evidence = repairEvidenceFiles(ctx)
  assert.deepEqual(evidence, [EXISTING_FIXTURE])
  // ★ 反过来说明 arm 9 的翻面条件就是"调用方把这一格传下去"。
  assert.notDeepEqual(evidence, ctx.update.newTestFiles, 'the gap is real: today the caller sends []')
})
