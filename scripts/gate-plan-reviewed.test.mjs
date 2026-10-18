/**
 * ── 判据 `dispatch.plan-reviewed` 的三臂夹具（t8）────────────────────────────────
 *
 * 本文件钉的是**用户已定的路由规则**在判据层上的落点：
 *
 *   「带 `reviewed` ⇒ 放行；不带 ⇒ **必须先审一遍才能派**。
 *     ★ 而『不带』**不是错误** —— 它是『这条路没走自动生成』的正常状态。」
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * `docs/PLAN-REVIEW.md` §8 的准入是**三条都要**（值得做 / **审查通过（带 reviewed）** / 原子级），
 * 而 ② 此前**没有任何东西在读**：`reviewed` 的形状由 t2 建好了，却没有任何判据在派发前问它。
 * ⇒ 于是"没审过的不该直接派"这句话**只活在文档里**。
 * ★ 与 `admission` 未接线、`reviewStateOf` 没有调用方是**同一个形状**：机制在，而流程没走。
 *
 * ── ★ 定向突变（打红本文件的五条路）───────────────────────────────────────────
 *
 *   a) 把 `unmeasured` 那一支并进 `ok`（形状坏也放行）⇒ 臂 2 红
 *   b) 让 `blocked` 的措辞不指名缺哪一问（只说"你该审了"）⇒ 臂 3 红
 *   c) 加一个 `fs` import（判据不再是纯数据变换）⇒ 臂 5 红
 *   d) 删掉 `appliesTo`（于是它对任何 ctx 都开火，包括没有 task 的）⇒ 臂 6 红
 *   e) 五问名单与 `friction-triage` 的 `REVIEW_CHECKS` 分叉 ⇒ 臂 4 红
 *
 * ★★★ 2026-10-19 追加（`reviewed.at` 的时间不可能）—— 定向突变（打红臂 10–14）：
 *
 *   f) 删掉 `stampImpossibility` 那一支（`at` 又变回只抄进读数）⇒ 臂 10 红
 *   g) 让"不可能"变成**恒拒**（不看 `at` 就拒）⇒ 臂 11 红（晚于门的戳被拒）
 *   h) 把 `at` 读不出（缺席 / 非有限数）折成"不可能"⇒ 臂 12、13 红
 *   i) 把时间检查挪到形状检查**之前** ⇒ 臂 14 红（形状坏 + 一年前 ⇒ 变成 blocked 而非 unmeasured）
 *   j) 措辞只说"implausible"而不给两个时刻与差值 ⇒ 臂 10 红（那一条断言里三个读数都在）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { gate, appliesTo, id, point, REVIEW_QUESTION_IDS, PLAN_REVIEWED_GATE_ONLINE_AT } from '../lib/gates/dispatch/plan-reviewed.js'
import { description } from '../lib/gates/dispatch/plan-reviewed.js'
import { createGateRegistry, blocked } from '../lib/gates/registry.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8')

/**
 * ★ 一个**可信**的戳时刻（门上线 + 1 天）—— 本文件里所有"不是在测时间"的夹具都用它。
 *
 * ★ 为什么不是随手写个 `1`：一个 `at: 1` 的夹具能通过，**只是因为**时间检查排在
 *   形状/五问检查**之后**（见臂 14）。于是十几条臂都在**静默依赖一个顺序**——
 *   哪天有人把时间检查挪前面（那是臂 14 专门要抓的突变），它们才会一起红，
 *   而红的地方离真正的原因很远。
 *   ⇒ 用可信的时刻，让"依赖顺序"这件事只剩臂 14 一处**显式**的。
 */
const TRUSTWORTHY_AT = PLAN_REVIEWED_GATE_ONLINE_AT + 86_400_000

/**
 * 一份**完整的** `reviewed`（五问逐条 `pass`）—— 对照臂与正向臂都用它。
 *
 * ★★★ `at` 必须**不早于**这道门上线（2026-10-19）：判据现在会读 `reviewed.at`，
 *   一个早于门存在的戳被判"时间上不可能" ⇒ 落 `blocked`。
 *   本夹具此前写 `1_700_000_000_123`（2023-11-14）—— 它自己就是普查里那 95 个
 *   不可能戳之一。★ 而这不是"为了让它过而改数字"：一条真的审查**只能**发生在门上线之后，
 *   早于门的时刻**不可能**是这条路盖出来的。
 */
function completeReviewed(overrides = {}) {
  return {
    at: TRUSTWORTHY_AT,
    by: 'adversarial',
    checks: REVIEW_QUESTION_IDS.map((questionId) => ({ id: questionId, verdict: 'pass', why: `${questionId} checked` })),
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★★★ 三态不同形（ok / blocked / unmeasured）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★★★ 三态不同形：带且五问无 fail/unmeasured ⇒ ok；缺席 ⇒ blocked；形状坏 ⇒ unmeasured', async () => {
  /**
   * ── 三态各自对应**一件不同的事**，而补救动作不同 ──────────────────────────────
   *
   *   `ok`          ⇒ 审过了、五问都答了、没有 fail/unmeasured ⇒ 放行
   *   `blocked`     ⇒ 根本没审 ⇒ 去**审**
   *   `unmeasured`  ⇒ 审了而记录读不出来 ⇒ 去**修记录**（★ 而不是"重审一遍"）
   *
   * ★ 而"缺席"与"在场但坏"**必须不同形**：前者是"我没审"，后者是"我审了、记录坏了"。
   *   把后者读成前者，等于**把一次真实的审查扔进"没审"里** —— 而重审的代价与从没审过一样。
   */
  const ok = await gate({ task: { id: 't-ok', reviewed: completeReviewed() } })
  assert.equal(ok.ok, true, '★ 带了完整 reviewed（五问全 pass）⇒ 必须放行')

  /**
   * ★★ 而这一条测的是【新任务】的缺席（闸门上线之后建的）——
   *   所以它必须给出一个【晚于闸门】的 createdAt：不给的话，偏宽规则会把它读成存量，
   *   而那样它就测的是另一件事了（存量 ⇒ unmeasured）。
   *   ★ 见臂 9b/9d：那两条分别钉"新任务 ⇒ blocked"与"读不出 ⇒ 偏宽"。
   */
  const absent = await gate({ task: { id: 't-absent', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000 } })
  assert.equal(absent.ok, false, '★★ 没有 reviewed ⇒ 拦住（用户原话：必须先审一遍才能派）')
  assert.equal(absent.unmeasured, undefined, '★ 缺席不是 unmeasured —— 那是"读不到"，而这里读得到：那一格确实不在')
  assert.ok(Array.isArray(absent.blockers) && absent.blockers.length > 0, '★ 而它必须说得出**为什么**拦')

  const broken = await gate({ task: { id: 't-broken', reviewed: { at: TRUSTWORTHY_AT, by: 'x', checks: 'not-an-array' } } })
  assert.equal(broken.ok, false, '★★ 形状坏 ⇒ 拦住')
  assert.equal(broken.blockers, undefined, '★★★ 形状坏**不是** blocked —— 那两个字段必须不同形')
  assert.ok(typeof broken.unmeasured === 'string' && broken.unmeasured.length > 0, '★ 而它必须如实说"读不到什么"')

  /** ★ 三个形状（哪一格在场）两两不同形 —— 这才是"三态"的机械形式。 */
  const shapeOf = (v) => ({ ok: v.ok, blockers: Array.isArray(v.blockers), unmeasured: typeof v.unmeasured === 'string' })
  assert.notDeepEqual(shapeOf(ok), shapeOf(absent), '①与②必须不同形')
  assert.notDeepEqual(shapeOf(ok), shapeOf(broken), '①与③必须不同形')
  assert.notDeepEqual(shapeOf(absent), shapeOf(broken), '②与③必须不同形')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★★ `unmeasured` **绝不并进 `ok`**
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★★★ 五问里有 `unmeasured` ⇒ **不许**放行（"没能审明白" ≠ "审过了"）', async () => {
  /**
   * ── 这是全库那条最贵的纪律在这一格上的落点 ────────────────────────────────────
   *
   * MEASURED（`scripts/friction-triage.mjs` 的 `REVIEW_CHECKS` 逐字）：
   *   「`unmeasured` **绝不并进 `pass`**：那是本队那条最贵的纪律。且它让整条审查落
   *     `needs-review`（**不是**盖章）」
   *
   * ★ 定向突变 a（把这一支并进 `ok`）⇒ 本臂红。
   */
  const checks = REVIEW_QUESTION_IDS.map((questionId) => ({ id: questionId, verdict: 'pass', why: 'ok' }))
  checks[2] = { id: REVIEW_QUESTION_IDS[2], verdict: 'unmeasured', why: 'no specifics to ask about' }
  const verdict = await gate({ task: { id: 't-unmeasured', reviewed: { at: TRUSTWORTHY_AT, by: 'x', checks } } })

  assert.equal(verdict.ok, false, '★★★ 五问里有一问 `unmeasured` ⇒ **必须拦住**。定向突变 a ⇒ 本臂红')
  assert.equal(
    verdict.unmeasured, undefined,
    '★ 而它不是"读不到整份记录"（那才是 unmeasured）—— 整份是**读得到的**，'
    + '是**其中一问**没能settle ⇒ 所以落在 blockers，而措辞必须指认它',
  )
  assert.ok(
    JSON.stringify(verdict.blockers).includes(REVIEW_QUESTION_IDS[2]),
    `★ 措辞必须指认**是哪一问**没能settle（预期含 \`${REVIEW_QUESTION_IDS[2]}\`）：${JSON.stringify(verdict.blockers)}`,
  )

  /** ★ 反半边：同一份 checks 把那一问改成 `pass` ⇒ 必须放行（否则本臂是"恒拒"） */
  checks[2] = { id: REVIEW_QUESTION_IDS[2], verdict: 'pass', why: 'settled' }
  const settled = await gate({ task: { id: 't-settled', reviewed: { at: PLAN_REVIEWED_GATE_ONLINE_AT + 86_400_000, by: 'x', checks } } })
  assert.equal(settled.ok, true, '★ 反半边：五问全 pass ⇒ 必须放行 —— 否则本臂测的是"它恒拒"')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★ `blocked` 必须**指名它缺哪一问**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3：`blocked` 的措辞必须**指名它缺哪一问**（不是一句「你该审了」）', async () => {
  /**
   * ★ 为什么这是硬要求：一句"你该审了"与"我不知道你缺什么"同形 ——
   *   而补救的人需要知道的正是**缺哪一问**（他要照着那几问去审）。
   * ★ 定向突变 b（让措辞不指名）⇒ 本臂红。
   */
  /** ★ 测的是【新任务】的 blocked 措辞 ⇒ 必须晚于闸门（否则偏宽规则把它读成存量）。 */
  const absent = await gate({ task: { id: 't', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000 } })
  const text = absent.blockers.join(' ')
  for (const questionId of REVIEW_QUESTION_IDS) {
    assert.ok(
      text.includes(questionId),
      `★ 缺席时措辞必须**逐条列出五问**（缺的是"\`${questionId}\`"）：${text.slice(0, 200)}`,
    )
  }
  /**
   * ★ 而它必须同时说清「不带**不是错误**」（用户原话）——
   *   否则读的人会以为流程坏了，而它其实只是"这条路没走自动生成"。
   */
  assert.match(text, /not an error|NOT an error/i, '★ 必须说清"不带不是错误"（用户原话）')

  /** ★ 半份：只答了三问 ⇒ 必须指名**缺哪两问**（而不是笼统说"审得不全"）。 */
  const partial = await gate({
    task: {
      id: 't2',
      reviewed: {
        at: TRUSTWORTHY_AT, by: 'x',
        checks: REVIEW_QUESTION_IDS.slice(0, 3).map((questionId) => ({ id: questionId, verdict: 'pass' })),
      },
    },
  })
  assert.equal(partial.ok, false, '★ 只答了三问 ⇒ 拦住（"没问过" ≠ "问了、过了"）')
  const partialText = partial.blockers.join(' ')
  for (const questionId of REVIEW_QUESTION_IDS.slice(3)) {
    assert.ok(partialText.includes(questionId), `★ 必须指名缺的那一问 \`${questionId}\`：${partialText}`)
  }
  for (const answered of REVIEW_QUESTION_IDS.slice(0, 3)) {
    assert.ok(
      !new RegExp(`missing: [^.]*${answered}`).test(partialText),
      `★ 而**答过的**那一问不许被列为"missing"（\`${answered}\`）—— 那会让补救的人去重审一遍已答的`,
    )
  }

  /** ★ 而 `fail` 也要附上**为什么**（一条不说原因的 fail 与"我不知道哪不对"同形）。 */
  const withFail = REVIEW_QUESTION_IDS.map((questionId) => ({ id: questionId, verdict: 'pass' }))
  withFail[0] = { id: REVIEW_QUESTION_IDS[0], verdict: 'fail', why: 'inScope misses two files' }
  const failed = await gate({ task: { id: 't3', reviewed: { at: TRUSTWORTHY_AT, by: 'x', checks: withFail } } })
  assert.equal(failed.ok, false, '★ 有一问 fail ⇒ 拦住')
  assert.ok(
    failed.blockers.join(' ').includes('inScope misses two files'),
    '★ `fail` 必须把**判据原文**（why）带出来 —— 否则读的人只知道"没过"，不知道哪里不过',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★ 五问名单必须与 `friction-triage` 的 `REVIEW_CHECKS` **逐条对齐**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4：五问名单必须与 `friction-triage` 的 `REVIEW_CHECKS` **逐条对齐**', () => {
  /**
   * ── 为什么这一条必须钉（本队记账最久的形态）───────────────────────────────────
   *
   * 审查程序（`scripts/friction-triage.mjs` 的 `REVIEW_CHECKS`）问五问，
   * 而本判据（`src/gates/`）也有一份五问名单 —— **两份**。
   * ⇒ 分叉之后「判据说它缺 `scope`、而审查程序根本不问 `scope`」在日志里同形。
   *
   * ★ 定向突变 e（让两份分叉）⇒ 本臂红。
   * ★ 反向半边：名单必须非空（否则"逐条对齐"在空集上恒真）。
   */
  const source = read('scripts/friction-triage.mjs')
  const body = source.match(/export const REVIEW_CHECKS = Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1]
  assert.notEqual(
    body, undefined,
    '★ 找不到 `REVIEW_CHECKS` —— 审查程序那一份的**形状变了**，本臂必须跟着看清它，'
    + '而不是静默变成一条恒真的断言',
  )
  const theirs = [...body.matchAll(/\{\s*id:\s*'([^']+)'/g)].map((match) => match[1])
  assert.ok(theirs.length > 0, '★ 审查程序的名单为空时"逐条对齐"恒真 —— 它至少要有五问')
  assert.deepEqual(
    [...REVIEW_QUESTION_IDS], theirs,
    '★★ 两处五问名单**分叉了** —— 而分叉之后"判据说它缺某一问、而审查程序根本不问那一问"'
    + '在日志里同形。\n'
    + `    判据层（src/gates/dispatch/plan-reviewed.ts）：${JSON.stringify([...REVIEW_QUESTION_IDS])}\n`
    + `    审查程序（scripts/friction-triage.mjs）：${JSON.stringify(theirs)}\n`
    + '★ 修法：让两边同源，或把这条对齐写成显式的（而不是靠"记得同步改两处"）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★★ 判据是**纯数据变换** —— 不 import 任何 I/O
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 5：判据不 import 任何 I/O（不读盘、不碰网络、不看时钟）', () => {
  /**
   * ── 为什么这一条必须**读源码的 import 字面量**而不是运行时断言 ─────────────────
   *
   * 契约要求「判据是纯数据变换：不 import 任何 I/O」。而**偷偷加一个 `fs` import
   * 在运行时的返回值上完全看不出来** —— 一个读了盘、却把结果藏起来的判据，
   * 与一个没读盘的判据在 `gate()` 的输出上同形。
   * ⇒ 必须钉**声明的字面**（那是"一个断言的正确观测面在哪"的又一实例）。
   *
   * ★ 定向突变 c（加一个 `fs` import）⇒ 本臂红。
   */
  const source = read('src/gates/dispatch/plan-reviewed.ts')
  const imports = [...source.matchAll(/^\s*import\s[^\n]*?from\s+'([^']+)'/gm)].map((match) => match[1])
  assert.deepEqual(
    imports, [],
    `★ 判据 import 了东西：${JSON.stringify(imports)} —— 它必须是**纯数据变换**：`
    + '执行器由调用方注入（见 registry 的 `execVerifyCommand` 先例），'
    + '拿不到观察就 `unmeasured`，而不是自己去读。★ 定向突变 c ⇒ 本臂红',
  )
  /** ★ 也不许用动态 `import(...)` 绕过去。 */
  assert.doesNotMatch(source, /\bimport\s*\(/, '★ 动态 `import(...)` 同样是 I/O —— 不许用它绕开上面那条')
  /** ★ 也不许出现"读时钟"这类隐藏的非确定性输入。 */
  assert.doesNotMatch(source, /Date\.now|performance\.now|new Date\(\)/, '★ 判据不许自己读时钟（那会让同一次输入两次跑出不同裁决）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：★ 闸门口径 —— 只对"有一个任务"的 ctx 说话
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 6：`appliesTo` 问"有没有 task"与"这道门对它适不适用"（而**不**问它审没审）', () => {
  /**
   * ★★ 关键：`appliesTo` **不许**把"没审"当作闸门 ——
   *   那会让判据在**最该说话的那一刻**（没审的项目要派）**根本不跑**，
   *   而"没跑"与"没装"在读数上同形。
   *   ⇒ 闸门问的是"有没有一个任务"，而"审没审"是本判据要回答的问题。
   */
  /**
   * ★★ 而这两条【必须给一个晚于闸门的 createdAt】—— 因为它们测的是
   *   "新任务的没审 / 审过"，而不是存量（存量由臂 9a 测，它落"不适用"）。
   *   ★ 不给时间戳 ⇒ 偏宽规则判"不适用" ⇒ 那两条就测的是另一件事了。
   */
  const fresh = PLAN_REVIEWED_GATE_ONLINE_AT + 60_000
  assert.equal(appliesTo({ task: { id: 'a', createdAt: fresh } }), true, '★ 没审的新任务**必须**进求值 —— 那是本判据存在的理由')
  assert.equal(appliesTo({ task: { id: 'a', createdAt: fresh, reviewed: completeReviewed() } }), true, '★ 审过的也要进（它要走 ok 那一支）')
  assert.equal(appliesTo(undefined), false, '★ 没有 ctx ⇒ 不适用（★ 定向突变 d：让它恒真 ⇒ 本断言红）')
  assert.equal(appliesTo({}), false, '★ 没有 task ⇒ 不适用')
  assert.equal(appliesTo({ task: null }), false, '★ task 为 null ⇒ 不适用')
  /**
   * ★★ 而 `appliesTo` 必须**读得进**那一格：一个"恒真"的实现（`return true`）
   *   会连"没有 ctx"也判适用 ⇒ 于是它在**结构上不可能**被注册表跳过。
   *   ★ 这就是定向突变 d 要抓的形态，而它必须由**上面那三条 false** 抓到 ——
   *     只断言 `true` 的臂会让"恒真"照绿（★ 我第一版就是这样，实测发现的）。
   */
  const trueCases = [{ task: { id: 'a', createdAt: fresh } }, { task: { id: 'a', createdAt: fresh, reviewed: completeReviewed() } }]
  const falseCases = [undefined, {}, { task: null }]
  for (const ctx of trueCases) assert.equal(appliesTo(ctx), true, `★ 适用：${JSON.stringify(ctx)?.slice(0, 60)}`)
  for (const ctx of falseCases) {
    assert.equal(
      appliesTo(ctx), false,
      `★ **不**适用：${JSON.stringify(ctx) ?? 'undefined'} —— 一条恒真的 appliesTo 会让判据在任何 ctx 上开火，`
      + '而"它永远说话"与"它该说话时说话"在读数上同形（定向突变 d ⇒ 本断言红）',
    )
  }

  /** ★ 元数据臂：id/point 必须与装配点的插入点一致（t10 会用到它们）。 */
  assert.equal(id, 'dispatch.plan-reviewed', '★ id 必须逐字（注册表对重复 id 是抛错，不是覆盖）')
  assert.equal(point, 'dispatch', '★ point 必须是 `dispatch`（挂错位置等于它永不被求值）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7：★ 读数进报告 —— 三种输入上 `gate()` 的裁决各是什么
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 7（读数臂）：三种输入上的裁决，逐条给出', async () => {
  /**
   * ── 本臂是**读数臂**：它把三种输入的裁决打印出来，供报告直接引用 ────────────────
   *   ★ 而它也断言 `ok` 那一支必须交出**判据层亲眼读到的读数**（不是成员自报的那一句）。
   */
  const cases = [
    { label: '① 带完整 reviewed（五问全 pass）', input: { task: { id: 'r1', reviewed: completeReviewed() } } },
    { label: '② 没有 reviewed（新任务）', input: { task: { id: 'r2', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000 } } },
    { label: '③ reviewed 在场但形状坏（checks 不是数组）', input: { task: { id: 'r3', reviewed: { at: TRUSTWORTHY_AT, by: 'x', checks: 'nope' } } } },
  ]
  const readouts = []
  for (const item of cases) {
    const verdict = await gate(item.input)
    const outcome = verdict.ok === true ? 'ok' : verdict.unmeasured !== undefined ? 'unmeasured' : 'blocked'
    readouts.push(`${item.label} ⇒ ${outcome}`)
  }
  console.log(`★ plan-reviewed 在三种输入上的裁决：`)
  for (const line of readouts) console.log(`   · ${line}`)

  /** ★ 三种输入的裁决必须**三者互不相同**（否则"三态"在那个维度上没有信息量）。 */
  const outcomes = readouts.map((line) => line.split('⇒ ')[1])
  assert.deepEqual(
    [...new Set(outcomes)].length, 3,
    `★ 三种输入给出 ${new Set(outcomes).size} 种裁决（应为 3）—— 若有两种同形，那一维就没有信息量：${JSON.stringify(readouts)}`,
  )

  /** ★ 而 `ok` 那一支必须交出读数（逐条五问的 verdict），否则"过了"只是一个布尔。 */
  const ok = await gate({ task: { id: 'r-ok', reviewed: completeReviewed() } })
  assert.equal(ok.ok, true, '★ 前置：这一格必须 ok')
  const readout = ok.reviewedReadout
  assert.notEqual(readout, undefined, '★ ok 那一支必须交出 `reviewedReadout` —— 否则读的人要回去翻 `reviewed`')
  assert.equal(readout.by, 'adversarial', '★ 读数里要有"谁审的"')
  assert.equal(Array.isArray(readout.answered) && readout.answered.length, REVIEW_QUESTION_IDS.length, '★ 读数里要**逐条**给出五问各自的 verdict')
  console.log(`   · ok 那一支的读数：by=${readout.by} · answered=${readout.answered.map((entry) => `${entry.id}:${entry.verdict}`).join(' ')}`)
})

/**
 * ── ★★★ 臂 9：存量 vs 新任务（F21）──────────────────────────────────────────────
 *
 * 由来（MEASURED 2026-10-09，两位成员独立普查 + captain 复算）：
 *   本队 **39 条任务里 0 条**带 `reviewed` 戳，而它们**全部建于**这道门之前
 *   ⇒ 门对它们一律判 `blocked` ⇒ 每一次状态转换都被拒 ⇒ **全队停摆**。
 *
 * ★★ 而那不是"它们没审" —— 是【这条路由在它们建的时候还不存在】。
 *   把两者读成同一件事，会让「我还没审」（一条待办）与
 *   「这条老任务被永久冻住」（一条缺陷）**同形**。
 *
 * ⇒ ★ 存量落 `unmeasured`，新任务缺席仍 `blocked`。**两半都要钉。**
 */
test('★★★ 臂 9a：存量任务（早于闸门）⇒ ★【不适用】—— appliesTo 为 false，判据不开口', () => {
  /**
   * ── ★★★ 而我第一版把存量落成 `unmeasured`，而那是【错的】──────────────────────
   *
   * `docs/GATE-REGISTRY.md` 规则一逐字：
   *   > **「可判定的事实」不得写成「没能测量」**
   *   > 正确的表达：**不适用 ⇒ `ok`**（并要与「测过了」不同形，带跳过之类的标记）
   *
   * ★ 而"这条任务早于闸门"是**完全可判定**的（`createdAt` 是个数、上线时刻是常量）
   *   ⇒ 它既不是 `unmeasured`（我没能测），也不是 `blocked`（违规）。
   *   ⇒ ★ 它是【不适用】—— 而正确的落点是 `appliesTo` 返回 false，
   *     因为只有那样注册表才如实报 `skipped`（"跳过了"与"跑了而通过"不同形）。
   */
  const before = PLAN_REVIEWED_GATE_ONLINE_AT - 60_000
  assert.equal(
    appliesTo({ task: { id: 'legacy', createdAt: before } }),
    false,
    '★ 存量任务对这道门【不适用】⇒ appliesTo 必须为 false（那让注册表报 skipped）',
  )
})

test('★★★ 臂 9b：新任务（晚于闸门）⇒ appliesTo 为 true，且缺席仍然 blocked', () => {
  const after = PLAN_REVIEWED_GATE_ONLINE_AT + 60_000
  const ctx = { task: { id: 'fresh', createdAt: after } }
  assert.equal(appliesTo(ctx), true, '★ 新任务适用这道门')
  const verdict = gate(ctx)
  assert.equal(verdict.ok, false)
  assert.ok(
    verdict.blockers !== undefined,
    '★ 闸门上线之后建的任务，缺席必须仍然 blocked —— 这一半不许放宽',
  )
  assert.equal(verdict.unmeasured, undefined, '★ 新任务缺席不是 unmeasured —— 那是"没审"，是可判定的')
})

test('★★★ 臂 9c：两者必须【不同形】—— 一个不开口，一个开口而拒绝', () => {
  const legacy = { task: { id: 'legacy', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT - 60_000 } }
  const fresh = { task: { id: 'fresh', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000 } }
  assert.notEqual(
    appliesTo(legacy),
    appliesTo(fresh),
    '★ 存量与新任务若同形，那"这道门对它不适用"就与"它没审"分不开了',
  )
})

test('★★ 臂 9d：createdAt 读不出 ⇒ ★【偏宽 = 不适用】', () => {
  /**
   * ★ 宁可偏宽的理由：`createdAt`（team.json 写的墙钟）与闸门上线时刻（git 写的）
   *   **不同源** ⇒ 边界附近可能误判 ⇒ 不确定时不得把它读成"适用而拒绝"。
   *   ★ 而"偏宽"在这里的具体形状是 `appliesTo === false`（不开口），
   *     不是 `unmeasured`（开口而说测不了）—— 因为后者仍会被调用方读成拒绝。
   */
  for (const task of [{ id: 'x' }, { id: 'y', createdAt: 'not a number' }, { id: 'z', createdAt: Number.NaN }]) {
    assert.equal(
      appliesTo({ task }),
      false,
      `★ createdAt 读不出时应当偏宽（不适用），而 ${JSON.stringify(task)} 被判成了适用`,
    )
  }
})

test('★★★ 臂 9e：闸门上线时刻与 git 对得上（那处单一真值是可核的）', () => {
  /**
   * ★ 这道门的"何时上线"是一个**历史事实**，而它不是运行时读的（太贵）——
   *   所以它的正确性必须由【这一条臂】保证，而不是靠"记得同步改两处"。
   *   ★ 判据：那个常量对应 `dispatchPlanReviewed` 进 `ALL_GATES` 的提交时刻。
   */
  const iso = execFileSync('git', ['log', '-1', '--format=%cI', '-SdispatchPlanReviewed', '--', 'src/gates/index.ts'], {
    cwd: join(dirname(fileURLToPath(import.meta.url)), '..'),
    encoding: 'utf8',
  }).trim()
  assert.notEqual(iso, '', '★ git 里找不到那次接线 —— 而"闸门何时上线"就无从核起')
  assert.equal(
    Date.parse(iso),
    PLAN_REVIEWED_GATE_ONLINE_AT,
    '★ 常量与 git 里那次接线对不上 ⇒ 存量/新任务的分界会漂移',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 10–14：★★★ `reviewed.at` 的【时间不可能】（2026-10-19 补）
// ─────────────────────────────────────────────────────────────────────────────
/**
 * ── 为什么需要这一组臂 ────────────────────────────────────────────────────────────
 *
 * MEASURED（`node scripts/reviewed-stamp-census.mjs`）：盘上带戳任务 **151**，
 *   其中 **95** 条 `reviewed.at` 早于这道门上线，而那 95 条的任务**全部晚于**这道门
 *   （合法的"老任务当然没有戳"一条都没有）。
 *
 * ★★ 判据此前只读 `checks` 的形状、五问齐不齐、有没有 fail/unmeasured ——
 *   `at` 被**原样抄进读数**却从不与任何东西比较 ⇒ 一份"五问齐全、why 写得很漂亮、
 *   `at` 指向一年前"的戳能**一路通过**。门问的是「五问都答了吗」，
 *   而**不是**「这份记录有可能是真的吗」。
 *
 * ★ 方向（已定，不再讨论）：
 *     `at <  PLAN_REVIEWED_GATE_ONLINE_AT` ⇒ **不可能** ⇒ `blocked`（可判定的事实）
 *     `at >= PLAN_REVIEWED_GATE_ONLINE_AT` ⇒ 可能     ⇒ 原来的通过路径
 *     `at` 缺席 / 不是有限数                ⇒ ★ **不判不可能**（行为原样不动）
 * ★ 而**不是** `at < task.createdAt`：`reviewed` 是 `create_task` 的输入 ——
 *   先审、盖章、再建任务 ⇒ 戳早于任务创建是**这条路的设计**。
 */

/** 一年前（一个**不可能**的戳时刻）—— 三个不可能臂共用。 */
const ONE_YEAR_BEFORE_GATE = PLAN_REVIEWED_GATE_ONLINE_AT - 365 * 24 * 60 * 60 * 1000

test('臂 10 ★★★ 早于门上线 ⇒ 时间上不可能 ⇒ blocked（带 kind 记号），且措辞**指名两个时刻与差值**', async () => {
  /**
   * ── 本臂钉三件事 ────────────────────────────────────────────────────────────────
   *   ① 结论：`ok: false` 且落在 `blockers`（★ **不是** `unmeasured`：
   *      两个数一比就出结论 ⇒ 它是可判定的事实，不是"没能测量"）
   *   ② 形状：它与"没审"（`blocked` 而另一条措辞）**不同形** ⇒ `blockedKind` 记号
   *   ③ 措辞：必须**指名 `reviewed.at`、门上线时刻、以及差值**（契约硬要求）
   *
   * ★ 定向突变 f（删掉 `stampImpossibility` 那一支）⇒ 本臂红（`ok` 会变成 true）。
   * ★ 定向突变 j（措辞只说 "implausible" 而不给两个时刻与差值）⇒ 本臂红（下面三条断言）。
   */
  const verdict = await gate({
    task: { id: 't-impossible', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000, reviewed: completeReviewed({ at: ONE_YEAR_BEFORE_GATE }) },
  })

  assert.equal(verdict.ok, false, '★★★ 早于门上线一年的戳 ⇒ **必须拦住**。定向突变 f ⇒ 本臂红')
  assert.equal(verdict.unmeasured, undefined, '★★ 而它**不是** unmeasured —— 可判定的事实不得写成"没能测量"')
  assert.ok(Array.isArray(verdict.blockers) && verdict.blockers.length > 0, '★ 它必须说得出为什么拦（blockers）')

  /** ② 与"没审"不同形：两者都 `ok:false` + `blockers`，靠机械记号分开。 */
  const absent = await gate({ task: { id: 't-none', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000 } })
  assert.equal(absent.ok, false, '★ 前置：没审也是 ok:false')
  assert.notDeepEqual(
    { kind: verdict.blockedKind, blockers: Array.isArray(verdict.blockers) },
    { kind: absent.blockedKind, blockers: Array.isArray(absent.blockers) },
    '★★★ "时间不可能"与"没审"必须**不同形** —— 两者的补救动作不同（重盖 vs 去审），'
    + '若读数同形，读端只能靠措辞猜。★ 定向突变：去掉 `blockedKind` ⇒ 本断言红',
  )
  assert.equal(verdict.blockedKind, 'reviewed-stamp-impossible', '★ "不可能"必须有它自己的机械记号')
  assert.equal(absent.blockedKind, undefined, '★ 而"没审"不带这个记号（否则两个记号就没有区分力）')

  /** ③ 措辞必须**指名两个时刻与差值**。 */
  const text = verdict.blockers.join(' ')
  assert.ok(
    text.includes(new Date(ONE_YEAR_BEFORE_GATE).toISOString()),
    `★★★ 措辞必须给出 \`reviewed.at\` 的 ISO 渲染（${new Date(ONE_YEAR_BEFORE_GATE).toISOString()}）：${text}`,
  )
  assert.ok(
    text.includes(new Date(PLAN_REVIEWED_GATE_ONLINE_AT).toISOString()),
    `★★★ 措辞必须给出**门上线时刻**的 ISO 渲染（${new Date(PLAN_REVIEWED_GATE_ONLINE_AT).toISOString()}）：${text}`,
  )
  const delta = PLAN_REVIEWED_GATE_ONLINE_AT - ONE_YEAR_BEFORE_GATE
  assert.ok(
    text.includes(String(delta)) || text.includes('365.00 days'),
    `★★★ 措辞必须给出**差值**（${delta} ms / 365.00 days）—— 只说"不可能"与"我不知道差多远"同形：${text}`,
  )
})

test('★★★ 臂 11（反半边）：晚于 / 恰好等于门上线的戳 ⇒ **必须放行**（否则臂 10 是"恒拒"）', async () => {
  /**
   * ── 反半边是**必须**的 ────────────────────────────────────────────────────────
   *   一条"恒拒"的实现会让臂 10 全绿而机制完全没用：它拒掉**所有**戳，
   *   包括那些真的在门上线之后盖的。
   *   ★ 边界落在**闭区间**：`at === 门上线时刻` 是可能的（那一刻这条路刚存在）。
   *
   * ★ 定向突变 g（不看 `at` 就拒 / 把 `>=` 写成 `>`）⇒ 本臂红。
   */
  for (const [label, at] of [
    ['晚一天', PLAN_REVIEWED_GATE_ONLINE_AT + 86_400_000],
    ['恰好等于门上线时刻', PLAN_REVIEWED_GATE_ONLINE_AT],
    ['晚一毫秒', PLAN_REVIEWED_GATE_ONLINE_AT + 1],
  ]) {
    const verdict = await gate({ task: { id: `t-${at}`, createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000, reviewed: completeReviewed({ at }) } })
    assert.equal(verdict.ok, true, `★★★ ${label}的戳是**可能**的 ⇒ 必须放行（定向突变 g ⇒ 本臂红）`)
    assert.equal(verdict.blockedKind, undefined, `★ 放行的裁决不许带"不可能"的记号（${label}）`)
  }
})

test('★★ 臂 12：`at` **缺席** ⇒ 不判不可能（不新增拒绝，行为原样不动）', async () => {
  /**
   * ── 为什么"缺席"不是"不可能" ───────────────────────────────────────────────────
   *   "这一格没写完"与"这一格写着一年前"是**两件事**：前者该由补齐记录解决，
   *   后者是记录**不可能成立**。★ 而本判据此前对缺席的 `at` 是放行的 ——
   *   不得因为新增了时间检查就把它顺手变成拒绝（那是**超出契约的行为变更**）。
   *
   * ★ 定向突变 h（把读不出的 `at` 折成"不可能"）⇒ 本臂红。
   */
  const cases = [
    ['完全没有 at 这一格', { by: 'adversarial', checks: completeReviewed().checks }],
    ['at 是 undefined', completeReviewed({ at: undefined })],
    ['at 是 null', completeReviewed({ at: null })],
  ]
  for (const [label, reviewed] of cases) {
    const verdict = await gate({ task: { id: 't-noat', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000, reviewed } })
    assert.equal(verdict.ok, true, `★★ ${label} ⇒ 不判不可能（定向突变 h ⇒ 本臂红）`)
    assert.equal(verdict.blockedKind, undefined, `★ 而不许给它盖上"不可能"的记号（${label}）`)
  }
})

test('★★ 臂 13：`at` **不是有限数** ⇒ 不判不可能（"读不出"不得读成"拒绝"）', async () => {
  /**
   * ── 五种常见的"读不出" ────────────────────────────────────────────────────────
   *   少一种，就有一类戳会被静默地判成"不可能"。
   *   ★ 方向与普查（`scripts/reviewed-stamp-census.mjs`）**不同**：
   *     普查把它落 `unreadable`（**不是** `plausible`，因为它要回答"这戳真的吗"）；
   *     而判据这层**不新增拒绝** —— 它只说"我不能据此判不可能"。
   *     两者不矛盾：一个说"我读不出，别算它可信"，一个说"我读不出，所以不额外拒它"。
   *
   * ★ 定向突变 h（把非有限数折成"不可能"）⇒ 本臂红。
   */
  const cases = [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['字符串 \'not a number\'', 'not a number'],
    ['字符串 \'0\'', '0'],
  ]
  for (const [label, at] of cases) {
    const verdict = await gate({ task: { id: 't-nan', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000, reviewed: completeReviewed({ at }) } })
    assert.equal(verdict.ok, true, `★★ at 是 ${label} ⇒ **不判不可能**（定向突变 h ⇒ 本臂红）`)
    assert.equal(verdict.blockedKind, undefined, `★ 而它也不许带"不可能"的记号（${label}）`)
  }
})

test('★★★ 臂 14：形状坏 + 一年前的戳 ⇒ 仍然是 `unmeasured`（★ 时间检查在形状检查**之后**）', async () => {
  /**
   * ── 为什么顺序要紧 ──────────────────────────────────────────────────────────────
   *   一份**连读都读不出**的戳，它上面的 `at` 也是读不出的读数 ——
   *   拿它的 `at` 去宣判"时间不可能"会把**首要**问题（记录坏了）藏起来，
   *   让补救的人先去改时间戳，而记录本身仍然不可读。
   *
   * ★ 而两种结论的补救动作不同：`unmeasured` ⇒ 去**修记录**；`blocked(不可能)` ⇒ 去**重盖**。
   *
   * ★ 定向突变 i（把时间检查挪到形状检查**之前**）⇒ 本臂红。
   */
  const verdict = await gate({
    task: {
      id: 't-broken-old',
      createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000,
      reviewed: { at: ONE_YEAR_BEFORE_GATE, by: 'x', checks: 'not-an-array' },
    },
  })
  assert.equal(verdict.ok, false, '★ 拦住')
  assert.equal(verdict.blockers, undefined, '★★★ 形状坏 + 一年前 ⇒ **仍然是 unmeasured**，不是 blocked（定向突变 i ⇒ 本臂红）')
  assert.ok(typeof verdict.unmeasured === 'string' && verdict.unmeasured.length > 0, '★★ 它必须如实说"读不到什么"')
  assert.equal(verdict.blockedKind, undefined, '★ 而"读不出记录"不许带"时间不可能"的记号 —— 那是另一件事')

  /**
   * ★ 而**反半边**：同一份记录只把 `checks` 修好（`at` 仍是一年前）⇒ 现在它读得出、
   *   于是时间检查才轮到它 ⇒ `blocked`。这证明两个结论**各归各的**，而不是一个吞掉另一个。
   */
  const repaired = await gate({
    task: {
      id: 't-repaired',
      createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000,
      reviewed: completeReviewed({ at: ONE_YEAR_BEFORE_GATE }),
    },
  })
  assert.equal(repaired.ok, false, '★ 修好形状之后，一年前的 at 仍然把它挡住')
  assert.equal(repaired.unmeasured, undefined, '★ 而这一次不是 unmeasured —— 记录读得出了')
  assert.equal(repaired.blockedKind, 'reviewed-stamp-impossible', '★★ 两个结论各归各的：记录坏了 ⇒ unmeasured；记录读得出而时间不可能 ⇒ blocked')
})


// ─────────────────────────────────────────────────────────────────────────────
// 臂 15–19：★★★ 越界的戳（F1）—— 不可渲染 ≠ 一条裁决
// ─────────────────────────────────────────────────────────────────────────────
//
// ── 本节治的是什么（MEASURED 2026-10-19，本任务复现的读数）──────────────────────
//
//   守卫当时只挡非有限数（`!Number.isFinite`）。而 `|at| > 8.64e15` 的戳
//   **是有限数**，却**没有对应的时刻** ⇒ 渲染那一行抛异常：
//
//        at = -1e300             => THREW RangeError: Invalid time value
//        at = -8640000000000001  => THREW RangeError: Invalid time value
//        at = +8640000000000001  => {"ok":true,...}          ← 而这不是守住了它
//        at = +1e300             => {"ok":true,...}          ← 是 `at >= 门上线` 先返回
//        at = NaN                => {"ok":true,...}   (读数里 at 渲染成 null)
//        at = Infinity           => {"ok":true,...}   (同上)
//
//   ☆ 异常不是裁决：它绕过三态判定，穿出 `gate()`，再穿出整条
//     `evaluate('dispatch', …)` —— 同一次求值里**别的判据**的可读 blocker 一起丢。
//
// ── 归到哪一档：跟随 `NaN`（= `undefined`，不判不可能）─────────────────────────
//
//   ① 这个值是**读不出来的时刻**，不是"我算了一下发现它做不到" ⇒ 与臂 12/13 同族；
//   ② 归 `unmeasured` 会在这条判据上新增一个"部分读不出"的档，而臂 13 已经立了
//      「读不出不得读成拒绝」的口径 ⇒ 两种归法会给出**不同形**的读数，而它们
//      描述的是同一件事（这个数不是时刻）。
//   ⇒ ★ 本节的臂把"与 `NaN` 同档"钉成**结构逐字同形**（`deepEqual` 两个裁决），
//     而不是只断言"没抛" —— 后者在一个返回垃圾字符串的实现上也会绿。

/**
 * ★ 三个**越界**的时刻：一个巨大负数、两个恰好在可表示范围外一毫秒的数。
 *   ★ 两侧都要：负向越界曾**实测复现**抛穿，而正向越界**不抛**只是因为比较顺序
 *     偶然挡住了它 —— 把 `>=` 写成 `>` 就立刻抛。（见下面的读数）
 */
const OUT_OF_RANGE_INSTANTS = [
  ['-1e300（有限数，但不是一个时刻）', -1e300],
  ['-8640000000000001（负向越界一毫秒）', -8_640_000_000_000_001],
  ['+8640000000000001（正向越界一毫秒）', 8_640_000_000_000_001],
]

/**
 * ★ 越界戳的**期望裁决** = `NaN` 戳的裁决。两次调用同一个 `gate()`，
 *   一份带越界 `at`、一份带 `NaN`，只差那一个输入 ⇒ 两个读数必须逐字同形。
 */
const NAN_VERDICT = await gate({
  task: { id: 't-nan-baseline', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000, reviewed: completeReviewed({ at: Number.NaN }) },
})

test('臂 15 ★★★ 越界的戳与 `NaN` 同档：不抛、不判不可能，且裁决与 `NaN` **逐字同形**', async () => {
  /**
   * ── 三件事一起钉（少一件就有一种实现能蒙过）──────────────────────────────────
   *   ① **不抛** —— 异常不是裁决（定向突变：把守卫改回只挡非有限数 ⇒ 本臂红成 RangeError）
   *   ② 不落 `blocked`、不带 `reviewed-stamp-impossible` 记号 —— 不许把"读不出"折成"拒绝"
   *   ③ ★ 与 `NaN` 那一档 `deepEqual` —— 这才机械地证明越界值**从未**被交给渲染那一行
   *     （一个"吞掉异常、返回垃圾字符串"的实现会在这里与 `NaN` 档不同形）
   */
  for (const [label, at] of OUT_OF_RANGE_INSTANTS) {
    let verdict
    try {
      verdict = await gate({
        task: { id: `t-oor-${at}`, createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000, reviewed: completeReviewed({ at }) },
      })
    } catch (error) {
      assert.fail(
        `★★★ \`reviewed.at = ${label}\` **抛了** ${error?.constructor?.name}: ${error?.message} —— `
        + '异常不是裁决：它绕过三态判定并穿出整条 evaluate，把同一次求值里别的判据一起弄丢。'
        + '★ 定向突变（把 stampImpossibility 的守卫改回只挡非有限数）⇒ 本条红，且红因正是这个 RangeError',
      )
    }

    assert.equal(verdict.ok, true, `★★ ${label} ⇒ 与 \`NaN\` 同档（不判不可能）；定向突变 ⇒ 本断言红`)
    assert.equal(verdict.blockedKind, undefined, `★ ${label} 不许带"时间不可能"的记号 —— 那不是一条可判定的事实`)
    assert.equal(verdict.blockers, undefined, `★★ ${label} 不许生成"时间不可能"的措辞（blocked 那支的字段必须缺席）`)

    /**
     * ③ ★ 结构逐字同形：只差 `at` 一个输入，两个裁决必须 `deepEqual`。
     *   ★ 比较的是**裁决**（`ok` / `blockers` / `unmeasured` / `blockedKind` + 读数里
     *     五问各自的 verdict）—— 而那正是三态判定读的那几格。
     *   ★ `readout.at` 那一格**故意不参与**：它不是裁决，而且 `NaN` 与越界值在它上面
     *     本来就不同形（`NaN` 那一格只收有限数）。臂 18 单独钉那一格。
     */
    const verdictShape = (value) => value.ok === true
      ? { ok: true, by: value.reviewedReadout?.by, answered: value.reviewedReadout?.answered }
      : { ok: false, blockers: value.blockers, unmeasured: value.unmeasured, blockedKind: value.blockedKind }
    assert.deepEqual(
      verdictShape(verdict), verdictShape(NAN_VERDICT),
      `★★★ \`at = ${label}\` 的裁决必须与 \`at = NaN\` 的裁决**逐字同形**。\n`
      + '   两者描述的是同一件事（这个值不是一个时刻）。若它们不同形，说明越界值被交给了渲染那一行，'
      + '   而它给出的那个字符串既不是时刻、也不是"读不出" —— 那比抛更难归因。\n'
      + `   越界：${JSON.stringify(verdictShape(verdict))}\n   NaN：${JSON.stringify(verdictShape(NAN_VERDICT))}`,
    )
  }
})

test('臂 16 ★★★ 三个越界输入**各自**一条断言：两侧都不抛（负向 2 条 + 正向 1 条）', async () => {
  /**
   * ── 为什么要**逐条**给，而不是循环里一条 `assert` ────────────────────────────────
   *   原文的缺陷只在**负向**实测复现；正向"不抛"是**偶然**（`at >= 门上线` 先返回）。
   *   一条循环断言在负向红了之后就不再走正向 ⇒ 正向那条**永远不会被执行到**，
   *   于是"两侧都不抛"这句话没有任何读数支撑。
   *   ⇒ 三条断言各自独立，红哪一条就指名哪一条。
   *
   * ★ 定向突变（守卫改回只挡非有限数）⇒ 第 1、2 条红（RangeError），第 3 条**仍绿**
   *   —— 那正是原文漏掉它的方式；而只要有人把比较顺序动一下，第 3 条也会红。
   */

  // ① 负向：巨大负数（离谱到连"天"都数不清）
  let negativeHuge
  try {
    negativeHuge = await gate({
      task: { id: 't-oor-neg-huge', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000, reviewed: completeReviewed({ at: -1e300 }) },
    })
  } catch (error) {
    assert.fail(`★★★ at = -1e300 ⇒ 抛了 ${error?.constructor?.name}: ${error?.message}（负向越界不许抛）`)
  }
  assert.equal(negativeHuge.ok, true, '★ at = -1e300 ⇒ 不判不可能（与 NaN 同档），绝不抛')

  // ② 负向：恰好越界一毫秒（边界是**闭**8.64e15，所以 ±1 已经出界）
  let negativeEdge
  try {
    negativeEdge = await gate({
      task: { id: 't-oor-neg-edge', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000, reviewed: completeReviewed({ at: -8_640_000_000_000_001 }) },
    })
  } catch (error) {
    assert.fail(`★★★ at = -8640000000000001 ⇒ 抛了 ${error?.constructor?.name}: ${error?.message}（负向边界外一毫秒不许抛）`)
  }
  assert.equal(negativeEdge.ok, true, '★ at = -8640000000000001 ⇒ 不判不可能（与 NaN 同档），绝不抛')

  // ③ 正向：恰好越界一毫秒（★ 原文这条"不抛"是顺序偶然，必须单独钉住）
  let positiveEdge
  try {
    positiveEdge = await gate({
      task: { id: 't-oor-pos-edge', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000, reviewed: completeReviewed({ at: 8_640_000_000_000_001 }) },
    })
  } catch (error) {
    assert.fail(`★★★ at = +8640000000000001 ⇒ 抛了 ${error?.constructor?.name}: ${error?.message}（正向边界外一毫秒不许抛）`)
  }
  assert.equal(positiveEdge.ok, true, '★★ at = +8640000000000001 ⇒ 不判不可能，绝不抛 —— 原文它"不抛"只因为 `at >= 门上线` 先返回，那是偶然')

  /** ★ 而可表示范围的**边界本身**仍然是一个时刻（闭区间）—— 它不许被顺手判成读不出。 */
  const atBoundary = await gate({
    task: { id: 't-boundary', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000, reviewed: completeReviewed({ at: 8.64e15 }) },
  })
  assert.equal(atBoundary.ok, true, '★ at = 8.64e15（边界上，仍可表示）⇒ ok —— 守卫挡的是**越界**，不是这个边界')
})

test('臂 17 ★★★ 判据边界不外溢：同一次 `evaluate` 里别的判据的可读 blocker 仍在', async () => {
  /**
   * ── 这是"异常不是裁决"的**代价读数** ─────────────────────────────────────────────
   *   一条越界戳此前会让整条 `evaluate('dispatch', …)` 抛 `RangeError`，
   *   于是同一次求值里**另一条正常的 blocked 判据**给出的成因也一起消失 ——
   *   修的人看到的是一个异常，而不知道"killer suite 没报裁决"这件事。
   *
   * ★ 而本臂**不去改注册表**（`src/gates/registry.ts` 在 outOfScope 里）：
   *   它证明的是**这个外溢被 plan-reviewed 这一侧治好了** —— 同一份注册表、同一个
   *   `evaluate`，只要 plan-reviewed 不再抛，那条 blocked 的成因就读得到。
   *
   * ── 反半边（必须）────────────────────────────────────────────────────────────────
   *   若不抛是因为"判据被跳过"（`appliesTo` 假），本臂同样会绿 —— 而那是另一种病。
   *   ⇒ 下面断言 `ran` 里 plan-reviewed **真的跑了**且裁决是 `ok`，不是 `skipped`。
   */
  const registry = createGateRegistry()
  /** ① 一条**正常的**可读 blocker —— 它必须活下来。 */
  registry.register({
    id: 'dispatch.probe.killer-suite',
    point: 'dispatch',
    description: 'probe: a plain, readable blocker that must survive a sibling gate',
    gate: () => blocked('the killer suite reported no verdict'),
  })
  /** ② 真的 plan-reviewed（不是探针）—— 带一个**越界**的戳。 */
  registry.register({ id, point, description, gate, appliesTo })

  let evaluation
  try {
    evaluation = await registry.evaluate('dispatch', {
      task: { id: 't-bleed', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000, reviewed: completeReviewed({ at: -1e300 }) },
    })
  } catch (error) {
    assert.fail(
      `★★★ \`evaluate('dispatch', …)\` 抛了 ${error?.constructor?.name}: ${error?.message} —— `
      + '一条越界的戳把整条求值带走了：同一次求值里另一条 blocked 的成因**一起丢失**。'
      + '★ 定向突变（把守卫改回只挡非有限数）⇒ 本条红，红因正是这个 RangeError',
    )
  }

  assert.equal(evaluation.blockers.length, 1, `★★ ① 那条 blocker 必须仍在（实际 ${evaluation.blockers.length} 条）：${JSON.stringify(evaluation.blockers)}`)
  assert.equal(
    evaluation.blockers[0], '[dispatch.probe.killer-suite] the killer suite reported no verdict',
    '★★★ 另一条判据的成因必须**逐字**读得到 —— 越界的 plan-reviewed 不许把它带走',
  )

  /** ★ 反半边：plan-reviewed 必须**真的跑了**（不是被 `appliesTo` 跳过而"恰好没抛"）。 */
  const ran = evaluation.ran.find((entry) => entry.id === id)
  assert.notEqual(ran, undefined, `★★ plan-reviewed 必须出现在 ran 里（注册表认得这个 id：${id}）`)
  assert.equal(ran.verdict, 'ok', `★★ 而且它是**跑出了裁决**的（不是 skipped）：${JSON.stringify(ran)}`)
})

test('臂 18 ★★ 读数：三个越界输入 + `NaN` 各自的裁决，以及越界值从未交给渲染', async () => {
  /**
   * ── 本臂是**读数臂**：它把越界那三条的裁决打印出来，供报告直接引用 ─────────────────
   *   同时它单独钉住一件臂 15 只用 `deepEqual` 间接钉的事：
   *   越界值**没有被渲染成任何字符串**（读数的 `at` 那一格与 `NaN` 一样是 `null`）。
   */
  const lines = []
  for (const [label, at] of OUT_OF_RANGE_INSTANTS) {
    const verdict = await gate({
      task: { id: `t-read-${at}`, createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000, reviewed: completeReviewed({ at }) },
    })
    lines.push(`${label} ⇒ ${verdict.ok ? 'ok' : 'not-ok'} · blockedKind=${String(verdict.blockedKind)} · at=${JSON.stringify(verdict.reviewedReadout?.at)}`)
    /**
     * ★ 读数的 `at` 那一格：它只收**有限数**，所以越界值会**逐字**被抄进来
     *   （`-1e300` 是有限数）—— ★ 而它**没有**被交给渲染那一行，所以既没抛、
     *   也没变成一个垃圾字符串：裁决整条是 `ok`，`blockers` 缺席（见臂 15）。
     *   ★ 这一格**不是裁决**，本臂只把它如实报出来 —— 别拿它当"折掉了"的证据。
     */
    assert.equal(verdict.reviewedReadout?.at, at, `★ ${label} ⇒ 读数里的 at 如实抄回那个有限数（它不是渲染结果）`)
  }
  console.log('★ 越界戳的裁决读数：')
  for (const line of lines) console.log(`   · ${line}`)

  /** ★ 一条**可表示**的时刻仍然照常进读数 —— 否则上面那三条"都是 null"就失去了区分力。 */
  const normal = await gate({ task: { id: 't-read-normal', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000, reviewed: completeReviewed() } })
  assert.equal(normal.reviewedReadout?.at, TRUSTWORTHY_AT, '★ 可信的时刻必须逐字进读数（它不是 null）—— 上面三条才因此有信息量')
  console.log(`   · 可信的时刻 ⇒ at=${normal.reviewedReadout.at}`)
})

test('臂 19 ★★★ 判据仍是一条可判定的事实：越界**只在**渲染边界上，不是把时间检查整个关掉', async () => {
  /**
   * ── 反半边：治 F1 不能顺手废掉臂 10 那套时间检查 ───────────────────────────────────
   *   一个"只要 `at` 不在 `[门上线, 8.64e15]` 里就不判不可能"的实现会让越界臂全绿，
   *   同时**静默地**放行所有早于门上线一年的戳 —— 那是把整台机器关掉。
   *   ⇒ 本臂在同一份夹具里重新钉一次：越界被折进"读不出"，而**可表示**的早于门
   *     上线的戳仍然 `blocked` + 带 `reviewed-stamp-impossible` 记号。
   */
  const impossible = await gate({
    task: { id: 't-still-impossible', createdAt: PLAN_REVIEWED_GATE_ONLINE_AT + 60_000, reviewed: completeReviewed({ at: ONE_YEAR_BEFORE_GATE }) },
  })
  assert.equal(impossible.ok, false, '★★ 可表示的、早于门上线一年的戳 ⇒ 仍然 blocked（F1 的修法不许把它放过去）')
  assert.equal(impossible.blockedKind, 'reviewed-stamp-impossible', '★★ 而记号仍在')
  assert.ok(Array.isArray(impossible.blockers) && impossible.blockers.length > 0, '★ 措辞仍在')

  /** ★ 而它仍然**指名两个时刻与差值**（越界分支的加入不许把这条措辞弄坏）。 */
  const text = impossible.blockers.join(' ')
  assert.ok(text.includes(new Date(ONE_YEAR_BEFORE_GATE).toISOString()), `★★ 措辞里仍然要有戳的 ISO 渲染：${text}`)
  assert.ok(text.includes(new Date(PLAN_REVIEWED_GATE_ONLINE_AT).toISOString()), `★★ 措辞里仍然要有门上线时刻的 ISO 渲染：${text}`)
})
