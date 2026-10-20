/**
 * ── `agent_teams_review_plan` 的臂（t7 / N6）────────────────────────────────
 *
 * 本文件钉的是**一条流程缺口**，不是一个工具好不好用：
 *
 *   `dispatch.plan-reviewed` 会拒掉任何没有 `reviewed` 戳的任务，
 *   而**全仓没有任何工具能产出那个戳** ⇒ 被门禁判的那一方只能手写 JSON 自签。
 *
 *   原文（`.agent-teams/frictions/f-0395.json` 的 title，逐字）：
 *
 *     [rejection — not a blocker] create_task rejected: [dispatch.plan-reviewed]
 *     this plan has not been reviewed: no `reviewed` stamp is attached, and dispatch
 *     requires one (see docs/PLAN-REVIEW.md §8 — admission is "worth doing" AND
 *     "reviewed" AND "atomic"). ★ It is missing all 5 questions: `scope`,
 *     `prerequisite`, `move`, `acceptance`, `boundary`. ★ That absence is NOT an
 *     error — it is the normal state of "this route did not run the automatic
 *     review"; it only means the review has to happen before dispatch, not that
 *     something went wrong.
 *
 * ⇒ 这是「闸只会拦、不会带你过」。
 *
 * ── ★★★ 修法**不是**让 create_task 自己盖章 ────────────────────────────────
 *
 * ★ 自动盖章会让 `dispatch.plan-reviewed` **永远通过**，而那道门存在的全部理由
 *   就是"审没审过"这件事本身要有读数。⇒ 本工具**只**把审查结论摆出来；
 *   **是否调用它**是调用方的一个显式动作。臂 1 与臂 2 一起钉这一点：
 *   臂 1 说"有戳 ⇒ 过"，臂 2 说"没戳 ⇒ 仍然逐字被拒"。
 *
 * ── ★★★ 三态纪律：审查不过就**不发戳** ──────────────────────────────────────
 *
 *   passed        ⇒ 发戳（五问逐条 pass + 四问逐条 present）
 *   needs-review  ⇒ ★ 不发戳，逐条列出"哪一问没判出来 + 补救动作"（臂 5）
 *   rejected      ⇒ ★ 不发戳，逐条列出"哪一问没过 + 补救动作"（臂 4/6/7）
 *   模块不在      ⇒ ★ 不发戳，而 `unmeasured` 有值（臂 10）——「读不出」≠「没过」
 *
 *   ★ 一个"形状合法但内容没过"的戳比没有戳更坏：它过得去 `readReviewed`，
 *     而它把"我判不了"洗成了"审过了"。
 *
 * ── ★ 定向突变（打红本文件的十条路；每条都真跑过，读数见下方各臂注释）────────
 *
 *   a) 让 `stampable` 恒 true（不管 outcome）          ⇒ 臂 4/5/6/7 红
 *   b) needs-review 也发戳                             ⇒ 臂 5 红
 *   c) 删掉四问（`checkPlanReview`）那一支              ⇒ 臂 8 红
 *   d) 删掉分档（`tierOf`）那一支                       ⇒ 臂 9 红
 *   e) 不发戳时把 `reviewed: null` 塞进去（键不缺席）   ⇒ 臂 3 红
 *   f) 模块加载失败时装成"没有 refusals 就是通过"        ⇒ 臂 10 红
 *   g) 让 `create_task` 在没戳时自动补一个戳             ⇒ 臂 2 红（★ 最重要的一条）
 *   h) 把 `(at)` 那条检查删掉（早于门的戳照发）          ⇒ 臂 11 红
 *   i) 五问里少答一问也发戳                             ⇒ 臂 12 红
 *   j) `by` 空串也照发（`validateCreateTask` 会拒）      ⇒ 臂 13 红
 *
 * ── ★ 两条纪律 ──────────────────────────────────────────────────────────────
 *
 * ① 不许把"当前有几个工具"写成不变量（`TEAM_TOOL_NAMES.length` 由真源读）。
 * ② 凡断言"戳可用"，一律**走一次真的 `validateCreateTask`**，而不是自己看形状 ——
 *    否则夹具与宿主会慢慢分叉。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { reviewAndStamp } from '../lib/tools/review-plan.js'
import { validateCreateTask, isReviewedCheckVerdict } from '../lib/quality-gates.js'
import { TEAM_TOOL_NAMES, MEMBER_TOOL_NAMES, CAPTAIN_TOOL_NAMES } from '../lib/tool-names.js'
import { registerAgentTeamsTools } from '../lib/tools.js'
import { PLAN_REVIEWED_GATE_ONLINE_AT, REVIEW_QUESTION_IDS, gate as planReviewedGate } from '../lib/gates/dispatch/plan-reviewed.js'

/**
 * ★ 本文件现在住在 `scripts/`（**移动前**在 `scripts/tools/`）——
 *   所以根目录是**两层**而不是三层。
 *   MEASURED（移动时踩到）：多算一层会让 ROOT 变成 `/Users/abab/Desktop`，
 *   而它的表现不是路径看着不对，是 `ENOENT: .../lib/tools/review-plan.js`
 *   —— 一个**看着像产物没生成**的错误，实际是根算错了一层。
 */
/**
 * ★★ `REVIEW_PLAN_ROOT` **覆盖**（2026-10-20 加，臂 15 需要）──────────────────────
 *
 * MEASURED（臂 15 的第一次修法）：把突变挪到私有副本之后，臂 15 **仍然零条红** ——
 *   因为子进程跑的虽然是同一个文件，而它里面 `import('../lib/…')` 相对
 *   **本文件位置**解析 ⇒ 仍然读**主树**的 `lib/` ⇒ 副本上的突变根本没人读。
 *   ★ 这与本仓那条"我在错的地方读"同族：**改的是副本，量的是原树**。
 *
 * ⇒ 子进程用 `REVIEW_PLAN_ROOT=<scratch>` 启动，于是它 import 的、读的、
 *   断言的都是**副本** —— 那才是"突变真的生效了"这个主张能被证明的唯一方式。
 */
const ROOT = process.env.REVIEW_PLAN_ROOT ?? dirname(dirname(fileURLToPath(import.meta.url)))

/** 一条**真的能过审**的契约 —— 臂 1/2/3 的对照物。每一格都是必要的。 */
const GOOD_CONTRACT = Object.freeze({
  subject: '把 plan-reviewed 闸的发戳一侧接上',
  kind: 'implementation',
  objective: 'f-0395：这道闸只会拒、不会带人过 —— 不做的话，被它拦下的每一次派发都只能手写 JSON 自签',
  inScope: ['src/tools/review-plan.ts'],
  outOfScope: ['src/types.ts'],
  acceptance: ['`node --test scripts/gate-review-plan.test.mjs` 的通过数必须从 12 涨到 13'],
  verify: ['node --test scripts/gate-review-plan.test.mjs'],
  dependencies: [],
})

/** 一个**必定**能过审的时刻（门上线之后）。 */
const NOW = PLAN_REVIEWED_GATE_ONLINE_AT + 86_400_000

/**
 * 一条空团队 —— `validateCreateTask(team, input)` 要它只为读 `team.tasks`
 * （依赖 / inScope 重叠 / halt 三件事）。这里三件都无关，所以空表就够。
 * ★ 不在这里造一棵假树：那会把"团队长什么样"变成第二份真相。
 */
const EMPTY_TEAM = Object.freeze({
  id: 'team', name: 'T', captainSessionId: 'cap', createdAt: 1,
  phase: 'running', taskSeq: 0, members: [], tasks: [],
})

/**
 * ── ★★ 子进程的环境（臂 15 用）──────────────────────────────────────────────
 *
 * ★ 必须**摘掉** `NODE_TEST_CONTEXT`：`node --test` 会把它塞进环境，
 *   而一个继承了它的**孙子**进程会以为自己就是那个测试子进程 —— 于是它不跑
 *   测试运行器、直接退出，`execFileSync` 拿到**空输出**。
 *   MEASURED（本臂第一版）：`stdout.length === 0` ⇒ 「没有任何臂变红」的假红。
 *   ⇒ 这不是"突变没生效"，是**读数的通道被环境变量堵住了**。
 *   ★ 而那正是本队记账过的那种形态：一个读数在错的地方读，得到 0 而不是"读不到"。
 */
function childEnv() {
  const env = { ...process.env, REVIEW_PLAN_MUTATION_CHILD: '1' }
  delete env['NODE_TEST_CONTEXT']
  delete env['NODE_OPTIONS']
  return env
}

/**
 * ★ `.agent-teams/frictions/f-0395.json` 的 `title`，逐字（见臂 2 的说明）。
 */
const F0395_TITLE = '[rejection — not a blocker] create_task rejected: [dispatch.plan-reviewed] '
  + 'this plan has not been reviewed: no `reviewed` stamp is attached, and dispatch requires one '
  + '(see docs/PLAN-REVIEW.md §8 — admission is "worth doing" AND "reviewed" AND "atomic"). '
  + '★ It is missing all 5 questions: `scope`, `prerequisite`, `move`, `acceptance`, `boundary`. '
  + '★ That absence is NOT an error — it is the normal state of "this route did not run the automatic review"; '
  + 'it only means the review has to happen before dispatch, not that something went wrong.'

async function stampFor(overrides = {}, options = {}) {
  return reviewAndStamp({
    contract: { ...GOOD_CONTRACT, ...overrides },
    at: options.at ?? NOW,
    by: options.by ?? 'captain',
    ...options.loadCheck === undefined ? {} : { loadCheck: options.loadCheck },
    ...options.loadTriage === undefined ? {} : { loadTriage: options.loadTriage },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★ 对照臂：一条真的能过审的契约 ⇒ 发戳，而那个戳**真的**过得去
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 对照臂：能过审的契约 ⇒ 发戳；戳走一次真的 `validateCreateTask` 必须无错', async () => {
  const readout = await stampFor()
  assert.equal(readout.stampable, true, `★ 前置：这条契约必须能过审（refusals=${JSON.stringify(readout.refusals)}）`)
  assert.notEqual(readout.reviewed, undefined, '★ stampable=true 时 reviewed 必须在场')

  /**
   * ★★ 关键：戳的可用性**由宿主自己的校验器**说了算，不由本夹具看形状。
   *   `validateCreateTask` 是 create_task 真正会调的那个函数 —— 它通过了，
   *   才说明这个戳"能直接当 create_task.reviewed 用"。
   */
  const verdict = validateCreateTask(EMPTY_TEAM, { ...GOOD_CONTRACT, reviewed: readout.reviewed })
  assert.equal(verdict.ok, true, `★ 本工具发的戳必须过得了 create_task 的校验（实测：${verdict.error ?? ''}）`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★★★ 不管线（本文件最贵的一条）：没戳的 create_task 仍然逐字被拒
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 2 不管线：不调本工具 ⇒ `dispatch.plan-reviewed` 仍然逐字拒绝（f-0395 原文不变）', async () => {
  /**
   * ★ 这一臂防的是**整个任务最坏的解法**：让 create_task 自己盖章。
   *   那种改法会让下面这条判据永远通过，而它存在的理由就是"审没审过。
   */
  /**
   * ★ 这段文字**逐字**抄自 `.agent-teams/frictions/f-0395.json`（2026-10-20 的盘面）。
   *
   * ★ 为什么要抄一份常量、而不是直接读那个文件：`.agent-teams/` 是 gitignore 的
   *   （`.gitignore:4`），干净 worktree 里**没有**它 —— 直接读会让本臂在隔离
   *   worktree 里以 `ENOENT` 红，而那与"措辞改没改"毫无关系。
   *   ⇒ 措辞钉在这里；盘面在的时候（队长工作区）**额外**对拍一次。
   */
  const decision = planReviewedGate({
    task: {
      id: 't-x',
      createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 1000,
      /* ★ 刻意不给 reviewed */
    },
  })
  assert.equal(decision.ok, false, '★ 没有戳 ⇒ 必须被拒（否则本任务改坏了）')
  assert.equal(decision.unmeasured, undefined, '★ 缺戳是"还没审"，不是"判不了"')
  assert.equal(decision.blockers.length, 1)

  /**
   * ★★ 措辞必须与 f-0395 里那一条**逐字**相同。
   *
   * ★ 断言写成 `f0395.title.endsWith(gate 的话)` —— 因为 title 前面还挂着
   *   `[rejection — not a blocker] create_task rejected: [dispatch.plan-reviewed] `
   *   这段信封。这样两边任一侧被改字都会红，而断言本身不依赖信封格式。
   */
  assert.ok(
    F0395_TITLE.endsWith(decision.blockers[0]),
    '★ 拒绝措辞与 f-0395 里那一条不再逐字相同 —— 那么"这个缺陷修没修"就没有读数了\n'
    + `  f-0395 尾部: …${F0395_TITLE.slice(-120)}\n`
    + `  当前判据  : …${decision.blockers[0].slice(-120)}`,
  )

  /**
   * ★ 盘面在的时候再对拍一次（隔离 worktree 里没有 `.agent-teams/` ⇒ 跳过这一半）。
   *   ★ 而"跳过"必须**看得出来**：它打印一行说明，而不是静默地少测一件事。
   */
  const ledger = join(ROOT, '.agent-teams', 'frictions', 'f-0395.json')
  if (existsSync(ledger)) {
    const f0395 = JSON.parse(readFileSync(ledger, 'utf8'))
    assert.equal(
      f0395.title, F0395_TITLE,
      '★ 盘上那一条 f-0395 与这里的常量分叉了 —— 两个读数必须同源',
    )
  } else {
    console.log('  (本 worktree 没有 .agent-teams/ ⇒ 只核对常量，不核对盘面)')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★ 三态臂：不发戳时 `reviewed` **缺席**，不是 `null`
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 三态臂：不发戳时 `reviewed` 键**缺席**（不是 null、不是 {}）', async () => {
  const rejected = await stampFor({ acceptance: [] })
  assert.equal(rejected.stampable, false, '★ 前置：这条必须被拒')
  /**
   * ★ 为什么"缺席"比 `null` 重要：`create_task` 的参数校验里
   *   `reviewed !== undefined` 才会进校验 —— 一个 `null` 会进去，然后报
   *   "reviewed is present but is not an object"。那会把"没审"读成"审的格式坏了"。
   */
  assert.equal('reviewed' in rejected, false, '★ 不发戳时 reviewed 必须缺席 —— 不是 null、不是空对象')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★ rejected：逐条列出哪一问没过 **并且** 给补救动作
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 3b（枢纽臂）：`refusals` 非空 ⇒ `stampable` **必须**是 false，且没有任何戳', async () => {
  /**
   * ── ★★★ 这一臂补的是臂 3/4/5 共同的一个洞（2026-10-20 实测）───────────────
   *
   * MEASURED（臂 15 的定向突变）：把
   *   `const stampable = refusals.length === 0 && review.outcome === 'passed'`
   * 改成 `const stampable = true` 之后 —— **14 条臂一条都没红**。
   *
   * 根因不是"夹具不判乱发戳"：臂 3/4/5 都只断言 **`refusals` 里有什么**，
   * 而 `stampable` 那一格**没有任何臂直接读它**。于是：
   *
   *   有 refusals（审没过）+ stampable=true（照样盖章）  ⇒ 14 条臂**全绿**
   *
   * ★★ 而这正是最坏的那一种：**闸在拦，而戳照样发。**
   *   读 refusals 的人看到"拦住了 2 条"，读 reviewed 的人看到"审过了" ——
   *   两个读数都对，而它们说的是相反的事。本仓记过的那条母题：
   *   **判据算对了，但它读的输入不是你以为的那个。**
   *
   * ⇒ 这一臂把"拦"与"盖章"两格**合起来**问一次：
   *   `refusals.length > 0` ⇔ `stampable === false` ⇔ `reviewed` 缺席。
   *   三者必须**同进同退**。
   */
  for (const [label, patch] of [
    ['acceptance 空', { acceptance: [] }],
    ['boundary 冲突', { outOfScope: ['src/tools/'] }],
    ['objective 缺席', { objective: undefined }],
  ]) {
    const readout = await stampFor(patch)
    assert.ok(
      Array.isArray(readout.refusals) && readout.refusals.length > 0,
      `★ 前提：${label} 必须产出一条 refusal（实测 ${JSON.stringify(readout.refusals)}）`,
    )
    assert.equal(
      readout.stampable, false,
      `★★★ ${label}：有 ${readout.refusals.length} 条 refusal ⇒ stampable 必须是 false。`
      + ' ★ 它若为 true，就是"闸在拦、而戳照样发" —— 两个读数都对、说的却是相反的事',
    )
    assert.equal(
      'reviewed' in readout, false,
      `★★ 而 stampable=false 时 reviewed 必须**缺席**（不是 null）`,
    )
    assert.equal(
      readout.unmeasured, undefined,
      '★ 这条契约是**判过了**（有 refusals），不是"判不了" —— 两者不许同形',
    )
  }
})

test('臂 4 ★ rejected：不发戳，且逐条列出没过的那一问 + 补救动作', async () => {
  const readout = await stampFor({ acceptance: [] })
  assert.equal(readout.stampable, false)
  const acceptance = readout.refusals.find((item) => item.id === 'acceptance')
  assert.notEqual(acceptance, undefined, '★ 空 acceptance 必须让 `acceptance` 这一问进 refusals')
  assert.equal(acceptance.verdict, 'fail', '★ 空 acceptance 是 fail，不是 unmeasured')
  assert.notEqual(acceptance.why, '', '★ 必须给理由')
  /**
   * ★ 补救动作必须**逐问写死**，不能是笼统一句"请改进计划" ——
   *   后者让读的人不知道下一步做什么。
   */
  assert.match(acceptance.remedy, /定向突变/u, '★ acceptance 的补救动作必须说清"换成一条能被一次定向突变判红的"')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★ needs-review：★ 与 rejected 形态不同（这是三态纪律的核心）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5 needs-review：不发戳，而 refusals 里的 verdict 是 `unmeasured`（不是 `fail`）', async () => {
  /**
   * `src/tools/` 以 `/` 结尾 ⇒ `adversarialReview` 的 scope 与 boundary 两问
   * 都判"收窄不到具体文件 ⇒ 我判不了"⇒ outcome=needs-review。
   */
  const readout = await stampFor({ inScope: ['src/tools/'] })
  assert.equal(readout.stampable, false, '★ needs-review 也不发戳')
  const unmeasured = readout.refusals.filter((item) => item.verdict === 'unmeasured')
  assert.ok(unmeasured.length >= 1, `★ needs-review 必须留下 unmeasured 的痕迹（实测 refusals=${JSON.stringify(readout.refusals.map((r) => `${r.id}:${r.verdict}`))}）`)
  /**
   * ★★ 三态纪律：needs-review 与 rejected **不许同形**。
   *   它们都拒绝发戳，但下一步动作相反 —— 一个"去改"，一个"去补判据"。
   */
  const rejected = await stampFor({ acceptance: [] })
  assert.notDeepEqual(
    readout.refusals.map((r) => r.verdict),
    rejected.refusals.map((r) => r.verdict),
    '★ needs-review 与 rejected 的 refusals 形状不许相同 —— 否则"我判不了"与"它没过"读作同一件事',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6 ★ boundary：产物被自己的 outOfScope 挡住 ⇒ 不发戳
// ─────────────────────────────────────────────────────────────────────────────

test('臂 6 ★ boundary：产物落进自己的 outOfScope ⇒ 不发戳（"那条任务永远做不完"）', async () => {
  const readout = await stampFor({ outOfScope: ['src/tools/review-plan.ts'] })
  const boundary = readout.refusals.find((item) => item.id === 'boundary')
  assert.notEqual(boundary, undefined, '★ 产物与 outOfScope 相交必须让 boundary 进 refusals')
  assert.equal(boundary.verdict, 'fail')
  assert.equal(readout.stampable, false)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7 ★ 恒真 acceptance：拦住"恰好落一栏"那种写法
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 7 恒真 acceptance：`不能为空` 这种写法不发戳', async () => {
  /**
   * ★ 这一格选 `不能为空` 而不是"必须有文件"：后者**不**在
   *   `looksTautological` 的正则里（那条是 `要有.{0,4}文件`，要"要有"两字）。
   *   ★ 若我按直觉写"必须有文件"，本臂会以"恒真 acceptance 必须被拦"红 ——
   *   而红的原因是**我的夹具猜错了那条正则**，不是代码坏了。
   *   教训：夹具里凡引用另一份实现的判据，先读它，别猜。
   */
  const readout = await stampFor({
    acceptance: ['这个字段不能为空', '`node --test` 的通过数必须从 15 涨到 16'],
  })
  const acceptance = readout.refusals.find((item) => item.id === 'acceptance')
  assert.notEqual(acceptance, undefined, '★ 恒真 acceptance 必须被拦')
  assert.match(acceptance.why, /恒真/u, '★ 理由必须说"恒真"，而不是只说"不合格"')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8 ★ 四问：计划本身没写清也不发戳（与五问**分属两组**）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 8 四问：objective 缺席 ⇒ `why-now` 进 refusals，且不发戳（与五问分开两组）', async () => {
  const readout = await stampFor({ objective: undefined })
  assert.equal(readout.stampable, false)
  const whyNow = readout.refusals.find((item) => item.id === 'why-now')
  assert.notEqual(whyNow, undefined, '★ objective 缺席必须让 `why-now` 进 refusals')
  /**
   * ★ 五问（scope/prerequisite/move/acceptance/boundary）与四问
   *   （why-now/steps/invariant-reading/stop-points）**不是同一件事**：
   *   前者问"这份契约能不能派"，后者问"计划本身写清了吗"。
   *   本臂钉的是：后者也真的挡在发戳前面 —— 否则"四问"只是一份好看的报告。
   */
  assert.equal(
    REVIEW_QUESTION_IDS.some((id) => id === 'why-now'), false,
    '★ `why-now` 不是五问之一 —— 两组的名单必须分得开',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9 ★ 分档：大活先拆，不发戳
// ─────────────────────────────────────────────────────────────────────────────

test('臂 9 ★ 分档：大活（要搬/要拆）⇒ 不发戳，`(tier)` 进 refusals 且带 nextStep', async () => {
  const readout = await stampFor({
    objective: '把 src/a.ts 与 src/b.ts 合并重组，抽出公共部分',
    inScope: ['src/a.ts', 'src/b.ts'],
  })
  assert.equal(readout.tier.tier, 'large', `★ 前置：这两条信号必须判 large（实测 ${readout.tier.tier}）`)
  const tierRefusal = readout.refusals.find((item) => item.id === '(tier)')
  assert.notEqual(tierRefusal, undefined, '★ 大活必须进 refusals')
  assert.equal(readout.stampable, false)
  assert.equal(readout.tier.nextStep, 'decompose', '★ 大活的下一步是拆，不是盖章')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 10 ★★ 「读不出」≠「没过」：模块不在时 unmeasured 有值、refusals 为空
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 10 三态之三：模块加载失败 ⇒ `unmeasured` 有值、`refusals` 为空、不发戳', async () => {
  const readout = await stampFor({}, {
    loadCheck: async () => { throw new Error('module not shipped') },
  })
  assert.equal(readout.stampable, false, '★ 读不出发戳')
  assert.notEqual(readout.unmeasured, undefined, '★ 必须有 unmeasured 成因')
  assert.match(readout.unmeasured, /module not shipped/u)
  /**
   * ★★ 这一条是三态纪律里最容易做错的一格：
   *   模块不在 ⇒ `refusals` 是**空的**（因为一条结论都没产出来），
   *   ★ 若代码写成 `stampable = refusals.length === 0`，它就会在这里**发戳** ——
   *   把"我读不出"洗成"审过了"。臂 10 就是那条定向突变的靶子。
   */
  assert.deepEqual(readout.refusals, [], '★ 读不出时没有任何"没过"的结论 —— refusals 必须为空')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 11 ★ 时刻：比门还早的戳不许发
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 11 时刻：早于 `PLAN_REVIEWED_GATE_ONLINE_AT` 的时刻不发戳（`stampImpossibility` 会拒）', async () => {
  const readout = await stampFor({}, { at: PLAN_REVIEWED_GATE_ONLINE_AT - 1 })
  assert.equal(readout.stampable, false, '★ 一个比门还早的戳不可能是这条路盖出来的')
  const atRefusal = readout.refusals.find((item) => item.id === '(at)')
  assert.notEqual(atRefusal, undefined)
  assert.match(atRefusal.remedy, /伪造/u, '★ 补救动作必须说清"改晚是伪造"，否则下一个人会去改数字')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 12 ★ 五问签全：戳必须答满 `REVIEW_QUESTION_IDS` 的每一问
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 12 签全：戳的 checks 必须**逐条**答满五问（少一问，派发时就会被拒）', async () => {
  const readout = await stampFor()
  assert.notEqual(readout.reviewed, undefined)
  const answered = readout.reviewed.checks.map((check) => check.id)
  for (const id of REVIEW_QUESTION_IDS) {
    assert.ok(answered.includes(id), `★ 戳里缺了 \`${id}\` 这一问 —— 派发那一刻会被 dispatch.plan-reviewed 拒掉`)
  }
  /**
   * ★ 反向：戳里**多**出来的也要能看出来。五问是闸那边读的名单，
   *   本工具的 checks 直接来自 `adversarialReview`，两边同源（不手抄）。
   */
  assert.deepEqual(
    [...answered].sort(), [...REVIEW_QUESTION_IDS].sort(),
    '★ 戳答的问句集合必须与 `REVIEW_QUESTION_IDS` 逐条相同（不多不少）',
  )
  for (const check of readout.reviewed.checks) {
    assert.equal(isReviewedCheckVerdict(check.verdict), true, `★ \`${check.id}\` 的 verdict "${check.verdict}" 不在宿主认可的三态里`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 13 ★ `by` 不许空：空串会让整个戳被 create_task 拒
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 13 `by`：戳的 by 必须是非空字符串（否则 create_task 会以 "who performed the review" 拒掉）', async () => {
  const readout = await stampFor({}, { by: 'captain' })
  assert.notEqual(readout.reviewed, undefined)
  assert.equal(typeof readout.reviewed.by, 'string')
  assert.notEqual(readout.reviewed.by.trim(), '', '★ by 空串会让 validateCreateTask 拒掉整个戳')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 14 ★ 上线两步走：工具真的注册了，且真的进了 captain-only 名单
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 14 上线：`agent_teams_review_plan` 既在注册表里，也在 `TEAM_TOOL_NAMES` 里', async () => {
  /**
   * ★ 这一臂钉的是 `src/tool-names.ts` 第 19 行的判决（逐字）：
   *   「一个新工具的上线是【两处同时】的动作，不是一个"事后补登记"」。
   *   只注册不登记 ⇒ 成员看得见它（deny 列表由 TEAM_TOOL_NAMES 算出），
   *   而成员调它得到的是"你没资格"，不是"这条工具不存在"。
   */
  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined }, list() { return [] },
      sendMessage: async () => 'msg-0', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { list: () => [], get: () => undefined },
    on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined })

  assert.ok(tools.has('agent_teams_review_plan'), '★ 注册表里没有它 —— 那这条工具根本没上线')
  assert.ok(TEAM_TOOL_NAMES.includes('agent_teams_review_plan'), '★ `TEAM_TOOL_NAMES` 里没有它 —— 上线只做了一半')
  /**
   * ★ 而它必须 captain-only：戳是 `create_task.reviewed`，`create_task` 本身就是 captain-only
   *   （同一条准入面）。★ 数量由真源读，不由夹具手抄。
   */
  assert.equal(MEMBER_TOOL_NAMES.includes('agent_teams_review_plan'), false, '★ 它不是成员工具')
  assert.ok(CAPTAIN_TOOL_NAMES.includes('agent_teams_review_plan'), '★ 它必须在 captain-only 名单里')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 15 ★★ 夹具自检（定向突变）：把 `stampable` 改成恒 true ⇒ 必须有臂变红
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 15 夹具自检：真的做一次定向突变（`stampable` 恒 true）⇒ 必须有臂红，然后逐字节还原', async (t) => {
  /**
   * ★★ 防自递归：本臂用**子进程**重跑本文件，而子进程又会跑到臂 15 ——
   *   无限递归。⇒ 子进程里用环境变量跳过它自己。
   *   ★ 而"跳过"必须留下痕迹（`t.skip` 会打印原因），不能静默。
   */
  if (process.env.REVIEW_PLAN_MUTATION_CHILD === '1') {
    t.skip('★ 这是突变子进程：臂 15 跳过它自己（否则无限递归）')
    return
  }
  /**
   * ── 为什么要跑一次**真的**突变，而不是在注释里写"突变会红" ──────────────────
   *
   * 一个夹具能红，只证明"这一行断言被执行到了"；它**不能**证明"这条断言真的
   * 在判那件事"。⇒ 定向突变是唯一能证明后者的读数：如果我把被判的那件事
   * 改坏，而夹具**仍然全绿**，那这个夹具就是在测别的东西。
   *
   * ★ 突变的靶子选 `reviewAndStamp` 的落盘一行（`const stampable = refusals.length === 0 && review.outcome === 'passed'`），
   *   因为它是三态纪律的枢纽：把它改成恒 true，就是不审也发戳。
   *
   * ★ 只在 `lib/`（产物）上做，然后**逐字节还原**；`src/` 一个字节都不碰。
   */
  /**
   * ── ★★★ 突变必须打在**私有副本**上，不许碰共享的 `lib/`（2026-10-20 改）────────
   *
   * MEASURED：本臂原来直接 `writeFileSync` 到共享的 `lib/tools/review-plan.js`
   * （虽然 finally 里逐字节还原），而 `scripts/gate-shared-artifact-writes.test.mjs`
   * 的臂 4 当场抓到：
   *   「出现了【新的】共享写入 … 实测新增：["scripts/gate-review-plan.test.mjs:486 → shared alias", …]」
   *
   * ★★ 那个判据是对的，而理由不是"你还原得不够快"：**一次并行跑里，
   *   别的夹具可能正好在那一刻读 `lib/tools/review-plan.js`** ——
   *   它读到的是一份**被突变过的**产物，而失败会记在它头上。
   *   这与 `build-atomic` 那条「在共享 lib 上跑 rm -rf ⇒ 49 个夹具报
   *   ERR_MODULE_NOT_FOUND」是**同一个形状**（入口不同，窗口相同）。
   *
   * ⇒ 修法：把整个 `lib/` 复制到一棵临时树，在**副本**上突变，子进程也从副本里 import。
   */
  const scratch = mkdtempSync(join(tmpdir(), 'review-plan-mut-'))
  let sutPath
  let original
  /**
   * ★ 靶子逐字抄自 `lib/tools/review-plan.js:285` 的**产物**（单引号，esbuild 不改引号）。
   *   ⇒ 若哪天源码改了措辞而这里没跟上，本臂会以"突变靶子没找到"红 —— 那是**对的**：
   *     一个找不到靶子的突变臂证明不了任何事。
   */
  const target = "const stampable = refusals.length === 0 && review.outcome === 'passed';"  
  const mutated = 'const stampable = true;'

  let redArms = []
  try {
    /**
     * ★ 复制 `lib/` 到私有树 —— **只读共享，只写副本**。
     *   `cpSync` 带 `recursive`；`node_modules` 用软链（只读且省掉几百 MB）。
     */
    /**
     * ★★ 副本目录名用 `tree/` 而不是 `lib/` 这类**共享别名**
     *   （`scripts/gate-shared-artifact-writes.test.mjs` 的臂 4 会按**目标路径的字面**
     *    分类，而 `…/lib` 与仓库自己的 `lib/` 同形 ⇒ 它把那句 `cpSync` 报成"新的共享写入"。
     *    ★ 那个判据**是对的**：从字面读，一个叫 `lib` 的写目标与共享目录无法区分。
     *    修法不是加白名单，而是**让目标名本身可区分**（该判据自己的注释就这么写）。
     */
    cpSync(join(ROOT, 'lib'), join(scratch, 'tree', 'lib'), { recursive: true })
    cpSync(join(ROOT, 'package.json'), join(scratch, 'tree', 'package.json'))
    /**
     * ── ★★★ `scripts/` 也**必须**复制（2026-10-20 实测）──────────────────────────
     *
     * MEASURED：只复制 `lib/` 时，副本里 `reviewAndStamp` 的**每一块读数都读不出来**
     *   （`plan-review-check.mjs` / `friction-triage.mjs` 在 `scripts/` 下，
     *   而 `REVIEW_PLAN_ROOT` 指向副本 ⇒ 找不到它们）
     *   ⇒ 它走 `unmeasurableReadout` 那条**早退**路径 ⇒ `stampable` 恒 false
     *   ⇒ **突变 `stampable = true` 对早退路径无效** ⇒ 臂 15 零条红。
     *   ★ 而那个零条红**不是**"夹具不判乱发戳"：它测的是**一棵缺文件的树**。
     *     这又是本仓那条"我在错的地方读"：量的是副本，而副本本身不完整。
     */
    cpSync(join(ROOT, 'scripts'), join(scratch, 'tree', 'scripts'), { recursive: true })
    try { symlinkSync(join(ROOT, 'node_modules'), join(scratch, 'node_modules'), 'dir') } catch { /* 已存在 */ }
    sutPath = join(scratch, 'tree', 'lib', 'tools', 'review-plan.js')
    original = readFileSync(sutPath, 'utf8')
    assert.ok(original.includes(target), `★ 突变靶子没找到（副本）—— 那么本臂证明不了任何事（找的是: ${target}）`)
    writeFileSync(sutPath, original.replace(target, mutated), 'utf8')
    /**
     * ★ 用**子进程**重跑本文件：同进程里 `lib/` 已被 import 进模块缓存，
     *   改了文件也不会重新求值（那条路会得到一个恒绿的假读数）。
     */
    const { execFileSync } = await import('node:child_process')
    let stdout = ''
    try {
      /**
         * ★★ 必须用**相对路径** `scripts/<本文件名>`，不是 `fileURLToPath(import.meta.url)`。
         *   MEASURED：后者是**主树**的绝对路径 ⇒ 子进程从副本 cwd 启动，
         *   跑的仍然是主树那份测试文件（import 副本、断言旧文件）⇒ 16 条臂全绿，
         *   而突变明明生效了。★ 改成相对路径之后，cwd=scratch 才真的选到副本。
         */
        stdout = execFileSync(process.execPath, ['--test', 'scripts/gate-review-plan.test.mjs'], {
        /**
         * ★★ `cwd` 必须是**副本**：子进程跑的是 `scripts/gate-review-plan.test.mjs`
         *   这个**相对路径**，而它会相对于 cwd 解析 ⇒ cwd 若是主树，
         *   跑的就是主树里那份（import 副本、断言旧文件）—— 
         *   MEASURED：那样 16 条臂**全绿**，而突变明明生效了。
         */
        cwd: join(scratch, 'tree'),
        encoding: 'utf8',
        timeout: 120_000,
        /**
         * ★★ `REVIEW_PLAN_ROOT` 指到**副本**：子进程里 `ROOT` 取它，于是
         *   `import('../lib/…')` 读到的是副本里那份**被突变过的**产物。
         *   ★ `cwd` 仍留 `ROOT`：脚本自身的路径不变（它仍然是本文件）。
         */
        env: { ...childEnv(), REVIEW_PLAN_ROOT: join(scratch, 'tree') },
      })
    } catch (error) {
      stdout = `${error.stdout ?? ''}${error.stderr ?? ''}`
    }
    redArms = (stdout.match(/^✖ (臂[^\n(]*)/gmu) ?? []).map((line) => line.trim())
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  /**
   * ★ 现在**不需要**"逐字节还原共享文件"了 —— 因为从来没碰过它。
   *   而更要紧的是：**共享 `lib/` 在整个臂执行期间一个字节都没变**，
   *   于是并行的别的夹具不可能读到被突变过的产物。
   */
  assert.equal(existsSync(join(scratch, 'tree', 'lib', 'tools', 'review-plan.js')), false, '★ 私有副本必须被清掉')
  /**
   * ★ 只要求"至少一条红"，而不是"某一条红"：靶子是三态枢纽，
   *   臂 3/4/5/6/7/9/10/11 里任何一条抓得住都算夹具活着。
   *   而"一条都没红"就是夹具死了 —— 那是最坏的情况，必须让它自己红。
   */
  assert.ok(
    redArms.length >= 1,
    '★ 把 `stampable` 改成恒 true 之后【没有任何臂变红】—— 那这个夹具根本没在判"会不会乱发戳"',
  )
})
