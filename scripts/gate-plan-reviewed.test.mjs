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
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { gate, appliesTo, id, point, REVIEW_QUESTION_IDS } from '../lib/gates/dispatch/plan-reviewed.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8')

/** 一份**完整的** `reviewed`（五问逐条 `pass`）—— 对照臂与正向臂都用它。 */
function completeReviewed(overrides = {}) {
  return {
    at: 1_700_000_000_123,
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

  const absent = await gate({ task: { id: 't-absent' } })
  assert.equal(absent.ok, false, '★★ 没有 reviewed ⇒ 拦住（用户原话：必须先审一遍才能派）')
  assert.equal(absent.unmeasured, undefined, '★ 缺席不是 unmeasured —— 那是"读不到"，而这里读得到：那一格确实不在')
  assert.ok(Array.isArray(absent.blockers) && absent.blockers.length > 0, '★ 而它必须说得出**为什么**拦')

  const broken = await gate({ task: { id: 't-broken', reviewed: { at: 1, by: 'x', checks: 'not-an-array' } } })
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
  const verdict = await gate({ task: { id: 't-unmeasured', reviewed: { at: 1, by: 'x', checks } } })

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
  const settled = await gate({ task: { id: 't-settled', reviewed: { at: 1, by: 'x', checks } } })
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
  const absent = await gate({ task: { id: 't' } })
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
        at: 1, by: 'x',
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
  const failed = await gate({ task: { id: 't3', reviewed: { at: 1, by: 'x', checks: withFail } } })
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

test('★ 臂 6：`appliesTo` 只对"有一个 task"的 ctx 说话（而**不**问它审没审）', () => {
  /**
   * ★★ 关键：`appliesTo` **不许**把"没审"当作闸门 ——
   *   那会让判据在**最该说话的那一刻**（没审的项目要派）**根本不跑**，
   *   而"没跑"与"没装"在读数上同形。
   *   ⇒ 闸门问的是"有没有一个任务"，而"审没审"是本判据要回答的问题。
   */
  assert.equal(appliesTo({ task: { id: 'a' } }), true, '★ 没审的任务**必须**进求值 —— 那是本判据存在的理由')
  assert.equal(appliesTo({ task: { id: 'a', reviewed: completeReviewed() } }), true, '★ 审过的也要进（它要走 ok 那一支）')
  assert.equal(appliesTo(undefined), false, '★ 没有 ctx ⇒ 不适用（★ 定向突变 d：让它恒真 ⇒ 本断言红）')
  assert.equal(appliesTo({}), false, '★ 没有 task ⇒ 不适用')
  assert.equal(appliesTo({ task: null }), false, '★ task 为 null ⇒ 不适用')
  /**
   * ★★ 而 `appliesTo` 必须**读得进**那一格：一个"恒真"的实现（`return true`）
   *   会连"没有 ctx"也判适用 ⇒ 于是它在**结构上不可能**被注册表跳过。
   *   ★ 这就是定向突变 d 要抓的形态，而它必须由**上面那三条 false** 抓到 ——
   *     只断言 `true` 的臂会让"恒真"照绿（★ 我第一版就是这样，实测发现的）。
   */
  const trueCases = [{ task: { id: 'a' } }, { task: { id: 'a', reviewed: completeReviewed() } }]
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
    { label: '② 没有 reviewed', input: { task: { id: 'r2' } } },
    { label: '③ reviewed 在场但形状坏（checks 不是数组）', input: { task: { id: 'r3', reviewed: { at: 1, by: 'x', checks: 'nope' } } } },
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
