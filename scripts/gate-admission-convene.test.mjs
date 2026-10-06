/**
 * ── `admission.convene` 的三臂夹具（循环够了没有 —— 自动成团的三条件）────────────
 *
 * 契约要求每条判据自带三臂（`docs/GATE-REGISTRY.md` §6）。本判据的三臂是：
 *
 *   臂 1（伪造臂）：三条**各自**被伪造一次，每次只伪造一条 ⇒ 期望 blocked，
 *                   ★ 且必须指名**缺的是哪一条**（三条不许合成一句）
 *                   ★ 外加：三条全过但**破了成员上限** ⇒ 也是 blocked，
 *                     而那一条 blocker 说的是"要人确认"，与"循环没走完"**不同形**
 *   臂 2（未测量臂）：观察面没接上（没有产物表 / 上游没跑 / 没有提问表 /
 *                   上游自己就是 unmeasured）⇒ 期望 unmeasured，★ 不是 ok
 *                   ★★ 其中最关键的一条：**上游 checkpoint 是 unmeasured ⇒ 本判据跟着
 *                      unmeasured**（"拿不到版本" ≠ "没有未审改动"）
 *   臂 3（对照臂）：三条都过（且没破上限）⇒ 期望 ok（证明判据不误伤"真的够格"）
 *
 * ★ 缺任何一臂，这条判据不算完成：只有对照臂能区分「判据有效」与「判据在乱拒」。
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * 用户对这一段的形态要求是原话：
 *
 *     「产物非空 + 无未审改动 + 无待确认问题 ⇒ 自动成团（用户明确不需要点头）」
 *
 * 而在此之前"要不要成团"是一条靠人的经验执行的规则（用户原话：
 * 「以前这些都是手动做的，什么时候触发也是凭我的个人经验」）。
 *
 * ── ★★ 本文件最贵的一条臂：上游 unmeasured ⇒ 本判据跟着 unmeasured ─────────────
 *
 * 它的反面（把上游的 unmeasured 折成"那就当没改动"）是本判据**最容易写、
 * 而且错了以后看起来最好**的实现：一个 `?? 'ok'` 的兜底让三条全部"够格"，
 * 而成团恰好在"git 读不出、没人接线"时最危险 ——
 * 那正是本队反复记账的「把没测到并进通过」。
 *
 * ⇒ 臂 2 里有一条**专门**跑它，而且同时断言那一支的形状里**没有** ok。
 *
 * ── ★ 本文件刻意不写的一句话（本队已因这类棘轮返工多次）──────────────────────────
 *
 * 「真实 ctx 上现在还没有 `upstream` 这一格」「registry 里还没有这条判据」
 * —— 这些都是**接线还没做时的快照**（调用点与装配属 t10），**不是不变量**。
 * 夹具一个字节都不许把它写成断言：一旦接线落地，那种断言会在队友那里按设计变红，
 * 而红的原因与"判据坏了"毫无关系。⇒ 本文件断言的一律是**判据自身的性质**。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

/**
 * ★ 从 `../lib` 读（和每一条既有判据夹具一样）：测的是**真的会被装配层装上**的
 *   那一份代码，而不是 `src/` 里的一份平行副本。
 */
import { gate, appliesTo, id, point, requires } from '../lib/gates/admission/convene.js'
import { verdictState as checkpointVerdictState } from '../lib/gates/admission/checkpoint.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GATE_SOURCE = join(ROOT, 'src', 'gates', 'admission', 'convene.ts')
const BUILT_GATE = join(ROOT, 'lib', 'gates', 'admission', 'convene.js')

/** 收窄助手：把"这条断言期望哪一种裁决"写进断言本身（三态必须不同形）。 */
function expectBlocked(v) {
  if (v.ok !== false || !('blockers' in v)) throw new Error(`expected a blocked verdict, got ${JSON.stringify(v)}`)
  return v.blockers
}
function expectUnmeasured(v) {
  if (v.ok !== false || !('unmeasured' in v)) throw new Error(`expected an unmeasured verdict, got ${JSON.stringify(v)}`)
  return v.unmeasured
}
function expectOk(v) {
  if (v.ok !== true) throw new Error(`expected an ok verdict, got ${JSON.stringify(v)}`)
  return v
}

const DOC = 'docs/REQUIREMENTS.md'
const OTHER_DOC = 'docs/PLAN.md'

/**
 * ── 一份上游裁决"形状合法"吗（★ 与判据内部那条读法**独立**地写一次）────────────
 *
 * 合法 = `ok:true`，或者 `ok:false` 且**恰好一个**出口在场（blockers 非空 / unmeasured 非空）。
 * 其余（非对象、`ok:false` 两个出口都在、`ok:false` 两个出口都没有）都是坏形状。
 *
 * ★ 为什么这条臂要自己写一遍、而不是从判据里导出：导出的那一刻，这条臂就成了
 *   "拿判据的实现去验判据的实现"（恒真）。它必须是一条**独立**的形状判读 ——
 *   而两份判读是否一致，正是这条臂要测的东西。
 * ★ 也不拿 checkpoint 的 `verdictState` 当基准：它只有三态，对坏形状有兜底。
 */
function mineWellFormedShape(verdict) {
  if (verdict === null || typeof verdict !== 'object' || Array.isArray(verdict)) return false
  if (verdict.ok === true) return true
  if (verdict.ok !== false) return false
  const hasBlockers = Array.isArray(verdict.blockers) && verdict.blockers.length > 0
  const hasUnmeasured = typeof verdict.unmeasured === 'string' && verdict.unmeasured.trim() !== ''
  return hasBlockers !== hasUnmeasured
}

/** 上游两条判据的裁决 —— 三条形状各写一次，好让每条臂只改它要测的那一格。 */
const CHECKPOINT_OK = { ok: true }
const CHECKPOINT_BLOCKED = { ok: false, blockers: ['"docs/REQUIREMENTS.md" has an UNREVIEWED change: it was reviewed at aaa and is now at bbb'] }
const CHECKPOINT_UNMEASURED = { ok: false, unmeasured: 'the current git revision of the produced documents could not be observed' }
const ABSORB_OK = { ok: true }

/**
 * 一个最小 ctx。**每一格都显式给值**，好让每条臂只改它要测的那一格
 * —— 一个"顺手把别的格也拿掉"的夹具会让失败的归因失效。
 */
function ctx(overrides = {}) {
  return {
    task: { id: 't8', kind: 'requirement' },
    team: { id: 'planning-loop', name: 'planning-loop' },
    producedDocuments: [DOC],
    /** ★★ 上游裁决：第 ② 条**唯一合法的**证据来源（不重算 git）。 */
    upstream: { 'admission.checkpoint': CHECKPOINT_OK, 'admission.absorb': ABSORB_OK },
    /** `open-questions.json` 的观察：读到了，且是空的。 */
    openQuestions: [],
    /** 成员规模：没超。 */
    memberCap: { current: 3, max: 8 },
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（伪造臂）：三条各自被伪造一次 ⇒ 每次只说缺哪一条
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1a ★ 伪造臂：产物为空 ⇒ blocked，且说清是【条件 ①】缺东西', () => {
  const blockers = expectBlocked(gate(ctx({ producedDocuments: [] })))
  assert.equal(blockers.length, 1, '★ 这一次只该有"没有产物"一条结论，不连坐别的条件')
  assert.match(blockers[0], /condition ①/, '★ 必须点名是哪一条条件 —— 三条合成一句会让补救动作无从下手')
  assert.match(blockers[0], /NO requirement\/plan document/, '★ 必须说清缺的是什么（没有产物），而不是笼统一句"不够格"')
  /**
   * ★ 反向：不许在同一份输入上把另外两条也判成缺 —— 那会让"只有一个问题"读起来像
   *   "哪儿都是问题"（噪音会教人忽略门禁）。
   */
  assert.doesNotMatch(blockers.join('\n'), /condition ②/)
  assert.doesNotMatch(blockers.join('\n'), /condition ③/)
})

test('臂 1b ★ 伪造臂：上游检查点报了「有未审改动」⇒ blocked，且复述上游的【原文证据】', () => {
  const blockers = expectBlocked(gate(ctx({
    upstream: { 'admission.checkpoint': CHECKPOINT_BLOCKED, 'admission.absorb': ABSORB_OK },
  })))
  assert.equal(blockers.length, 1)
  assert.match(blockers[0], /condition ②/, '★ 必须点名条件 ②')
  assert.match(blockers[0], /UNREVIEWED change/i, '★ 必须说清缺的是什么（有未审改动）')
  /**
   * ★★ 这一条是本判据"读上游结论、不重算"的**可观测落点**：
   *   上游 blocker 的原文（`reviewed at aaa and is now at bbb`）必须被**带过来**。
   *   一个自己重算 git 的实现拿不到这段文本（它的输入里只有产物路径），
   *   所以本条同时钉住了"证据来自上游那一份裁决"这件事本身。
   */
  assert.match(blockers[0], /reviewed at aaa and is now at bbb/, '★ 必须复述上游裁决的原文证据 —— 否则"读的是上游的结论"没有可观察的落点')
  assert.doesNotMatch(blockers.join('\n'), /condition ①/)
})

test('臂 1c ★ 伪造臂：还有没回答的问题 ⇒ blocked，且**指名**那几条问题', () => {
  const blockers = expectBlocked(gate(ctx({ openQuestions: ['成团后成员名要不要回收？'] })))
  assert.equal(blockers.length, 1)
  assert.match(blockers[0], /condition ③/, '★ 必须点名条件 ③')
  assert.match(blockers[0], /成团后成员名要不要回收？/, '★ 必须把**问题原文**带出来：读日志的人要能直接去回答它')
  /**
   * ★ 用户裁定「否则第③条无法机械判定」—— 这条臂就是那句话的落点：
   *   一个只存在于会话里的"我还有两个问题"是不可观察的；
   *   结构化之后，"未回答的问题"变成一个**可数**的量（这里断言了条数）。
   */
  assert.match(blockers[0], /1 question\(s\)/, '★ 未回答的问题必须是个**可数的量**，不是一句"好像还有问题"')
})

test('★★ 臂 1d：三条全过、但破了【成员数上限】⇒ blocked，且那一条与"循环没走完"不同形', () => {
  const blockers = expectBlocked(gate(ctx({ memberCap: { current: 9, max: 8 } })))
  assert.equal(blockers.length, 1)
  /**
   * ★ 用户裁定的两半都要成立：
   *   ① 内容够格 ⇒ 本来可以自动成团；
   *   ② 但破上限 ⇒ **不自动**，回到要人确认。
   *   而这条 blocker 必须**读起来不像**"循环没走完" —— 两者的补救动作完全不同
   *   （去问人 vs 回去再审）。
   */
  assert.match(blockers[0], /member names are a non-renewable resource/, '★ 必须说清为什么上限要人拍板（用户给的理由）')
  assert.match(blockers[0], /needs a person to confirm/, '★ 必须说清补救动作是"要人确认"，不是"再审一轮"')
  assert.doesNotMatch(blockers[0], /condition ①|condition ②|condition ③/, '★ 它【不是】第四条验收 —— 三条都过了才会走到这里')
  assert.match(blockers[0], /① ② ③ all hold/, '★ 并且必须自己说清"三条都过了"—— 否则它读起来像另一条内容缺陷')
})

test('★ 臂 1e：上限可以【刚好用满】（`>` 不是 `>=`）—— 误伤的代价比漏报更贵', () => {
  /**
   * ★ 这条臂防的是一次**误伤**：把 `current > max` 写成 `current >= max`
   *   会把每一个"刚好用满上限"的团队判成超标。而本队那条跨层规则说
   *   误伤的代价比漏报更贵。★ 它同时是一次对照 —— 若不写，臂 1d 的
   *   "破上限 ⇒ blocked" 无法与"任何成员数 ⇒ blocked"区分开。
   */
  const verdict = expectOk(gate(ctx({ memberCap: { current: 8, max: 8 } })))
  assert.equal(verdict.conveneReport.autoApprove, true, '★ 刚好用满上限 ⇒ 仍然够格自动成团')
  assert.match(verdict.conveneReport.evidence.join('\n'), /8 of 8/, '★ 而且读数要如实写出"8 of 8"')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（未测量臂）：观察面没接上 ⇒ unmeasured，★ 且与 blocked 不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2a（本文件最贵的一条）：上游检查点【没能测量】⇒ 本判据【跟着 unmeasured】，绝不是 ok', () => {
  const verdict = gate(ctx({
    upstream: { 'admission.checkpoint': CHECKPOINT_UNMEASURED, 'admission.absorb': ABSORB_OK },
  }))
  const reason = expectUnmeasured(verdict)
  /**
   * ★★ 这是验收里单列的那一条：「拿不到版本」与「没有未审改动」必须**不同形**。
   *
   *   反面（`upstream.checkpoint.ok ?? true`）读起来最好：三条全"够格"、自动成团，
   *   而成团恰好在 git 读不出来时最危险。
   */
  assert.match(reason, /condition ②/, '★ 缺的是条件 ②，必须点名')
  assert.match(reason, /NOT automatically convenable/, '★ 必须说清后果：这个团队【不能】自动成团')
  assert.match(
    reason,
    /could not read the revision/,
    '★ 必须把上游那句"没能测量"的理由带出来 —— 否则读日志的人无法知道去修哪一格',
  )
  /**
   * ★ 形状断言（不是措辞断言）：unmeasured 这一支的返回对象里**没有** `ok:true`，
   *   也**没有** `blockers` —— 三态是靠**字段**分形的，不是靠自然语言。
   */
  assert.equal('blockers' in verdict, false, '★ unmeasured 不许同时带 blockers（两种主张不许混在一个裁决里）')
  assert.equal(verdict.ok, false)
})

test('★ 臂 2b：产物表【缺席】⇒ unmeasured（且与"产物为空 ⇒ blocked"不同形）', () => {
  const reason = expectUnmeasured(gate(ctx({ producedDocuments: undefined })))
  assert.match(reason, /producedDocuments was not provided/)
  /**
   * ★★ 这一条与臂 1a 是一对：同一个"没有产物"的表面现象，两条**相反**的补救动作。
   *   把两者合成一个 `?? []` 会让"没人接线"与"确实没写需求"在日志里同形。
   */
  const blockedOne = expectBlocked(gate(ctx({ producedDocuments: [] })))
  assert.notDeepEqual(
    { ok: false, unmeasured: reason },
    { ok: false, blockers: blockedOne },
    '★ "没能观察产物表"与"产物集是空的"必须不同形 —— 补救动作是去接线 vs 回去写需求',
  )
})

test('★ 臂 2c：上游【压根没有】checkpoint 这个键 ⇒ unmeasured（不是"没有未审改动"）', () => {
  const reason = expectUnmeasured(gate(ctx({ upstream: {} })))
  assert.match(reason, /condition ②/, '★ 缺的是条件 ②')
  assert.match(reason, /did not run in this step/, '★ 必须说清是"上游没跑"，不是"上游说没事"')
  assert.match(reason, /never spoke is not a gate that said "yes"/, '★ 而这句话就是那条界线的字面表达')
})

test('★ 臂 2d：上游裁决【形状坏了】⇒ unmeasured（不许挑一个看起来更严重的读）', () => {
  /**
   * ★ 三种坏形状各试一次：非对象 / 既没有 blockers 也没有 unmeasured 的 `ok:false` /
   *   两个出口**同时**在（矛盾的裁决）。★ 后者与注册表 `assertVerdict` 的口径一致：
   *   "发现问题"与"没能测量"是两个不同的主张，两者都在场时是**读不懂**，不是"挑一个"。
   */
  const malformed = [
    'a string, not a verdict',
    { ok: false },
    { ok: false, blockers: ['something'], unmeasured: 'and also could not measure' },
    null,
  ]
  for (const broken of malformed) {
    const reason = expectUnmeasured(gate(ctx({ upstream: { 'admission.checkpoint': broken } })))
    assert.match(reason, /is not a verdict at all/, `★ 形状 ${JSON.stringify(broken)} 必须落 unmeasured`)
  }
})

test('★ 臂 2e：提问表【缺席】⇒ unmeasured（不是"没有未回答问题"）', () => {
  const reason = expectUnmeasured(gate(ctx({ openQuestions: undefined })))
  assert.match(reason, /condition ③/)
  assert.match(reason, /could not be observed/)
  /**
   * ★ 与臂 1c 是一对：`undefined`（没读到）与 `[]`（读到、空的）**不同形**。
   *   合成一个 `?? []` 会让"没人接 open-questions.json"读成"问题都答完了"。
   */
  const empty = expectOk(gate(ctx({ openQuestions: [] })))
  assert.equal(empty.conveneReport.conditions.noPendingQuestion, true)
})

test('★ 臂 2f：提问表的形状坏了（含非字符串条目）⇒ unmeasured，不许"忽略它、看剩下的"', () => {
  /**
   * ★ 一个 `['q1', 42]` 里那个 `42` **可能**是一条真的未回答问题。
   *   静默丢掉它 ⇒ "有一条读不懂的问题"被读成"问题都答完了"（本任务要消灭的方向）。
   *   反过来"看不懂就拒绝"也不对：那会在一次**错的接线**上开火。
   *   ⇒ 正确落点是第三态。
   */
  for (const broken of [['q1', 42], ['q1', ''], ['q1', '   '], 'not-a-list', { questions: [] }]) {
    const reason = expectUnmeasured(gate(ctx({ openQuestions: broken })))
    assert.match(reason, /condition ③/, `★ 形状 ${JSON.stringify(broken)} 必须落 unmeasured`)
  }
})

test('★ 臂 2g：整个 `upstream` 缺席 ⇒ unmeasured（"没人接线"与"上游都说没事"不同形）', () => {
  const reason = expectUnmeasured(gate(ctx({ upstream: undefined })))
  assert.match(reason, /were not provided/)
  assert.match(reason, /this is "not measured", not "the loop is done"/, '★ 界线必须写在理由里')
})

test('★★ 臂 2h：三种"没能测量"【互不同形】—— 一格没接上不掩盖另外两格', () => {
  /**
   * ★ 三条各缺一格，读数必须**逐条可分辨**（都报 condition ② 会让读日志的人
   *   以为只有一处在漏）。★ 而且它们都不许是 ok。
   */
  const reads = {
    noDocuments: expectUnmeasured(gate(ctx({ producedDocuments: undefined }))),
    noUpstream: expectUnmeasured(gate(ctx({ upstream: {} }))),
    noQuestions: expectUnmeasured(gate(ctx({ openQuestions: undefined }))),
  }
  assert.equal(new Set(Object.values(reads)).size, 3, '★ 三种缺口必须给出三句不同的话（否则"缺哪一格"不可读）')
  for (const [name, reason] of Object.entries(reads)) {
    assert.notEqual(reason.trim(), '', `${name} 的 unmeasured 必须说清为什么`)
  }
  /**
   * ★ 而在**有 blocked** 的时候，"另外一格没测到"必须**同时被说出来**
   *   （不被 blocked 吞掉）—— 它是一份真实的发现，只是没有否决权。
   */
  const both = expectBlocked(gate(ctx({ producedDocuments: [], openQuestions: undefined })))
  assert.equal(both.length, 2, '★ 一条 blocked + 一条"另外还有一格没测到"')
  assert.match(both.join('\n'), /separately, 1 of the three condition\(s\) could not be measured/)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（对照臂）：三条都过 ⇒ ok
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 对照臂：产物非空 + 无未审改动 + 无待确认问题 ⇒ ok，且交出逐条证据', () => {
  const verdict = expectOk(gate(ctx()))
  const report = verdict.conveneReport
  assert.notEqual(report, undefined, '★ ok 时必须交出产出（编排层据此调 approve）')
  assert.deepEqual(
    report.conditions,
    { artefactPresent: true, noUnreviewedChange: true, noPendingQuestion: true },
    '★ 三条各自的读数都要交出来 —— 一句"够格了"与"什么都没查"在下游同形',
  )
  assert.equal(report.autoApprove, true, '★ 用户裁定：判据全过 ⇒ 可自动成团，不需要点头')
  assert.deepEqual(report.producedDocuments, [DOC])
  /**
   * ★ 上游两侧的态**原样交回**（不是折算成布尔）：编排层要能用同一份真值回答
   *   "是检查点说的、还是吸收说的" —— 与"两份真相"相对的那条纪律。
   */
  assert.equal(report.upstreamStates['admission.checkpoint'], 'ok')
  assert.equal(report.upstreamStates['admission.absorb'], 'ok')
  assert.deepEqual(report.memberCap, { state: 'within', current: 3, max: 8 })
  assert.match(report.evidence.join('\n'), /①/, '★ 证据要逐条给：① 产物 ② 无未审改动 ③ 无未答问题')
  assert.match(report.evidence.join('\n'), /②/)
  assert.match(report.evidence.join('\n'), /③/)
})

test('★ 臂 3b：成员上限【没能核对】⇒ 不阻断成团，但证据里必须留下这句话', () => {
  /**
   * ★ 理由（写在 interface 注释里）：上限是一条**兜底开关**，"团队现在几个人"
   *   不是循环的一部分 —— 它缺席不该把一条内容上完全够格的裁决翻成拒绝。
   *   ★ 但"没能核对上限"必须**留下来**，否则"上线了、只是没接规模"与
   *   "规模核对过了、没超"在证据上同形（同一套纪律用在证据层）。
   */
  const verdict = expectOk(gate(ctx({ memberCap: undefined })))
  assert.deepEqual(verdict.conveneReport.memberCap, { state: 'unmeasured' }, '★ 上限那一格如实交出 unmeasured')
  assert.match(
    verdict.conveneReport.evidence.join('\n'),
    /member cap could not be checked/,
    '★ 没能核对上限必须留下痕迹 —— 否则它与"核对过了、没超"同形',
  )
})

test('★ 臂 3c：`appliesTo` 恒真 —— 成团检查不许在某个 kind 上静默消失', () => {
  /**
   * ★ 与另外两条准入判据**刻意不同**：那两条问的是"某一件事发生了没有"，
   *   没有那件事时"不适用"；本判据问的是"成团这个动作的前置条件"，
   *   而它在**每一次成团尝试**上都被问起。
   *   ⇒ 一个"产物为空、什么都没接上"的 ctx 恰恰是它**最需要**开口的情形。
   */
  const shapes = [
    undefined,
    {},
    { task: { kind: 'implementation' } },
    { producedDocuments: [] },
    { openQuestions: ['still open'] },
  ]
  for (const shape of shapes) {
    assert.equal(appliesTo(shape), true, `★ appliesTo 对 ${JSON.stringify(shape)} 必须为真（否则成团检查会在一部分任务上消失）`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 一致性：本判据对"上游裁决三态"的读数必须与 checkpoint 自己的读数一致
// ─────────────────────────────────────────────────────────────────────────────

test('★ 漂移检查：本判据对上游三态的读数与 checkpoint 自己的 `verdictState` 一致', () => {
  /**
   * ── 为什么要写这一条（以及它为什么不违反"判据之间不互相调用"）───────────────
   *
   * 本判据**故意**没有 import `checkpoint.ts` 的 `verdictState`（契约 §2：
   * 判据之间不互相调用）—— 于是"什么是一个合法的裁决"这个理解在**两个文件里
   * 各写了一份**。★ 重复本身有代价：两处会漂移，而漂移的样子是
   * "上游说没能测量、下游读成了没事"。
   *
   * ⇒ 这一条不是把两份实现合成一份（那会重新引入依赖），而是**在夹具里**
   *   把同三份输入同时喂给两边，断言它们的读数**逐字一致**。漂移会在夹具里
   *   当场变红，而不是靠人记得同步。
   *
   * ★ 用 `gate()` 的**外部可观察**读数做比较（那条 blocked/unmeasured 的路径），
   *   而不是把本判据的内部函数导出：一个只给夹具开的窗口会让"实现"与
   *   "夹具看到的"变成两个东西。
   */
  const samples = [
    CHECKPOINT_OK,
    CHECKPOINT_BLOCKED,
    CHECKPOINT_UNMEASURED,
    { ok: false, blockers: ['x'], unmeasured: 'y' },
    { ok: false },
    'not-a-verdict',
  ]
  for (const sample of samples) {
    const mine = gate(ctx({ upstream: { 'admission.checkpoint': sample } }))
    const theirs = checkpointVerdictState(sample)
    /**
     * ★ 映射（逐条，刻意写全而不是用一个表达式）：
     *     checkpoint 'ok'          ⇒ 本判据 ok（条件 ② 过）
     *     checkpoint 'blocked'     ⇒ 本判据 blocked（条件 ②）
     *     checkpoint 'unmeasured'  ⇒ 本判据 unmeasured
     *     形状坏（裁决不是一个裁决）⇒ ★ 本判据 unmeasured —— **有意的分歧**，见下
     *
     * ★★ 而"形状坏"这一类比 `verdictState` 的三态**宽**：它把 `{ok:false}` 读作
     *   `blocked`（那边只有三态，兜底就是 blocked），而本判据读作"读不懂"。
     *   ⇒ 一致性检查必须**先按裁决的形状分类**，而不是拿 `verdictState` 的三态
     *     当基准去套 —— 后者会把那一处**有意的**分歧报成漂移。
     *
     *   MEASURED（本夹具第一次跑，自己抓出来的）：第一版就是这么写的，
     *   于是它对 `{ok:false}` 期望 blocked、拿到 unmeasured 而红。
     *   ★ 那一条红**不是**漂移 —— 它是这条臂自己的判据写错了（把"两份实现是否一致"
     *     与"其中一份对形状坏的输入怎么兜底"混成了一件事）。修的是**这条臂**，
     *     不是判据：判据的读法是对的，而且方向保守。
     */
    const wellFormed = mineWellFormedShape(sample)
    if (!wellFormed) {
      assert.equal(
        typeof expectUnmeasured(mine), 'string',
        `★ ${JSON.stringify(sample)}：形状坏的裁决 ⇒ 本判据必须落 unmeasured（读不懂 ≠ 测到了问题）`,
      )
      continue
    }
    if (theirs === 'ok') assert.equal(mine.ok, true, `★ ${JSON.stringify(sample)}：上游 ok ⇒ 本判据必须放行`)
    else if (theirs === 'blocked') assert.equal(expectBlocked(mine).join('\n').includes('condition ②'), true, `★ ${JSON.stringify(sample)}：上游 blocked ⇒ 条件 ② 必须报出来`)
    else assert.equal(typeof expectUnmeasured(mine), 'string', `★ ${JSON.stringify(sample)}：上游 unmeasured ⇒ 本判据必须跟着 unmeasured`)
  }
  /**
   * ★ 那一处**有意的分歧**，单独钉住（它是本判据与 checkpoint 唯一不同的取舍，
   *   而不写下来就会被下一个人当成 bug 去"修"）：
   *
   *   `verdictState({ok:false})`（一个 `ok:false` 却两个出口都没有的裁决）
   *   在 checkpoint 那边读作 `blocked`（它的兜底：不是 unmeasured 就是 blocked），
   *   而本判据把它读作 **unmeasured** —— 因为"上游交了一份我读不懂的裁决"
   *   与"上游测到了问题"是两件不同的事，而**没能测量**才是准确的那一个。
   *   ★ 方向是**保守**的（拒绝自动成团），所以它不会把危险的情形放过去。
   */
  assert.equal(checkpointVerdictState({ ok: false }), 'blocked', '★ checkpoint 的兜底读法（这是它那边的口径）')
  assert.match(
    expectUnmeasured(gate(ctx({ upstream: { 'admission.checkpoint': { ok: false } } }))),
    /is not a verdict at all/,
    '★ 而本判据把它读作"读不懂"（unmeasured）—— 这是有意的分歧，方向保守',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 定向突变（真的执行）：把三条各自单独去掉 ⇒ 对应臂必须红
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 为什么这三次突变要**真的跑**，而不是写在注释里 ────────────────────────────────
 *
 * 契约 §8.5 规则二：「没被突变抓住的修复，等于没修」，而后半句更狠：
 * **把机制单独去掉，臂必须红**。所以本文件不是"声称"这三次突变能打红对应的臂，
 * 而是把它们跑出来：
 *
 *     ① 备份 `src/gates/admission/convene.ts`
 *     ② 把某一条条件的判定去掉（改成"这条永远成立"）
 *     ③ 重新 build 出 `lib/`（整个仓库的夹具读的都是 lib/，必须真的重建）
 *     ④ 用对应那条臂的输入再问一次 ⇒ **必须红**
 *     ⑤ 还原源码、重新 build，并断言还原之后的裁决与突变前**逐字相等**
 *
 * ★★ 第 ⑤ 步不是礼节 —— 而且本文件在写法上比 t7 更保守，因为 t7 在这里踩过坑：
 *   「还原写在 `finally` 里且带断言 ⇒ 断言一失败，变异体永久留在盘上」。
 *   ⇒ 本文件的三条纪律：
 *     · 还原放在**最外层**（`try/finally` 包住整个突变体，包括断言）；
 *     · 还原函数**永不抛**（内部的 build 失败只记在 `restoreError` 上）；
 *     · `process.on('exit')` **兜底**：即使进程被测试框架半路终止（或某处
 *       `process.exit` 被调），源码也一定被写回。
 *
 * ★ 顺序是【串行】的，而且必须：`pnpm build` 会先 `rm -rf lib/`（clean-build），
 *   并行跑两个 build 会让另一个进程读到半个 lib/。本文件因此不做任何并行突变。
 */

/** 三次突变的针脚（★ 逐字，且末尾有专门一条断言它们在源码里真的存在）。 */
const NEEDLES = {
  /**
   * 条件 ①：它**有两支**（空集 ⇒ blocked、全非法 ⇒ unmeasured），两支共用同一个
   * 判别量 `legalDocuments.length === 0`。砍条件 ① 必须**两支一起砍** ——
   * 只砍一支时另一支会替它挡下同一份输入（见下面突变 A 的实测记录）。
   */
  artefactEmpty: `  if (legalDocuments.length === 0 && illegalDocuments.length === 0) {`,
  artefactAllIllegal: `  } else if (legalDocuments.length === 0) {`,
  /** 条件 ②：`state === 'ok'` 那一支 —— 把它改成恒真即"上游说什么都不报"。 */
  unreviewedOkBranch: `    if (state === 'ok') {`,
  /**
   * 条件 ③：它**也有两支出**（还有未回答的问题 / 提问表读不到 ⇒ 没能测量），
   * 两支都挂在 `questions` 那一格上（与条件 ① 同形，砍一支会被另一支顶上来）。
   */
  pending: `  } else if (questions.pending.length > 0) {`,
  questionsUnmeasured: `  if (questions.state === 'unmeasured') {`,
}

let restoreError = null

/**
 * 把源码与 lib 还原到突变前的状态。★ **永不抛**（见上面第 ⑤ 步的三条纪律）。
 */
function restore(source, original) {
  try {
    writeFileSync(source, original)
  } catch (error) {
    restoreError = `★ 还原源码失败：${String(error)}`
    return
  }
  try {
    const built = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: true })
    if (built.status !== 0) {
      restoreError = `★ 还原之后 build 失败（盘上的 lib/ 与被还原的 src 不同步）：\n${built.stdout}\n${built.stderr}`
    }
  } catch (error) {
    restoreError = `★ 还原之后 build 抛出：${String(error)}`
  }
}

async function withBuiltGate(mutatedSource, body) {
  const original = readFileSync(GATE_SOURCE, 'utf8')
  const builtBackup = `${BUILT_GATE}.convene-mutation-backup`
  const hadBuilt = existsSync(BUILT_GATE)
  if (hadBuilt) writeFileSync(builtBackup, readFileSync(BUILT_GATE, 'utf8'))
  /** ★ 兜底：进程以任何方式离开，源码都必须被写回。 */
  const onExit = () => { try { writeFileSync(GATE_SOURCE, original) } catch { /* 兜底里不许再抛 */ } }
  process.on('exit', onExit)
  try {
    writeFileSync(GATE_SOURCE, mutatedSource)
    const built = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: true })
    assert.equal(
      built.status, 0,
      `★ 突变体必须编译得过（否则这次突变测的是 tsc，不是判据的裁决）:\n${built.stdout}\n${built.stderr}`,
    )
    const result = body()
    if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
      return result.then(
        (value) => { restore(GATE_SOURCE, original); return value },
        (error) => { restore(GATE_SOURCE, original); throw error },
      )
    }
    restore(GATE_SOURCE, original)
    return result
  } catch (error) {
    restore(GATE_SOURCE, original)
    throw error
  } finally {
    process.off('exit', onExit)
    if (hadBuilt) { try { rmSync(builtBackup, { force: true }) } catch { /* 清理失败不改裁决 */ } }
  }
}

/**
 * ── ★★ 突变体必须用【重新 import】拿到，不许用文件顶部那个绑定 ──────────────────
 *
 * MEASURED（t7 的同类夹具，第一次跑就抓出来的）：文件顶部的 `import { gate }` 在
 * **文件加载时**就解析完了。于是突变体写进 src/、build 也真的重建了 lib/，
 * 而 `gate(...)` 仍然指向**加载时那一份**（未被突变的）模块 ⇒ 报告读作
 * "突变没能打红对应的臂 ⇒ 那条臂可能是恒真的"，而事实恰好相反：
 * **突变从来没有被跑过**。
 *
 * ⇒ 突变体一律走 `freshGate()`：带 cache-busting 的 query 重新 import。
 */
async function freshGate(tag) {
  const module = await import(`${BUILT_GATE}?${tag}`)
  return module.gate
}

test('★★ 夹具自检：`freshGate` 读到的确实是【当前磁盘上】的 lib，而不是加载时的旧绑定', async () => {
  /**
   * ★ 这条不测判据，测的是上面那三次突变**赖以成立的前提**。
   *   把 `freshGate` 换成顶部那个 `gate` 绑定，三次突变都会变成"什么都没测"，
   *   而报告里它们会读作"突变没打红"。
   */
  const a = await import(`${BUILT_GATE}?selfcheck=a`)
  const b = await import(`${BUILT_GATE}?selfcheck=b`)
  assert.notEqual(a, b, '★ 不同的 query 必须拿到不同的模块实例 —— 否则 cache-busting 没生效')
  assert.equal(a.id, id, '★ freshGate 读到的必须是同一条判据，不是碰巧存在的另一个文件')
  assert.equal(a.point, point)
  assert.equal(typeof b.gate, 'function')
  assert.equal(typeof gate, 'function', '★ 顶部那个绑定也得是对的（基线与臂 1~3 走的都是它）')
  assert.equal((await freshGate('selfcheck=c'))(ctx()).ok, true, '★ 而且它读到的那一份必须真的能裁决')
})

test('★ 定向突变：三条条件【各自】单独去掉 ⇒ 对应臂必须红', async (t) => {
  /**
   * ★ 本仓的收口纪律是**串行**（`rm -rf lib/` 的窗口会让并行读到假红），所以这一条
   *   由环境变量显式开启，默认跳过，由本任务的验证读数那次单独运行。
   *   ★ 但"默认跳过"不是把机制关掉：跳过的成因由环境变量显式表达，
   *     而运行它的那一次读数会记在任务的 output 里 —— 缺了那次读数，本臂不算数。
   */
  if (process.env.AGENT_TEAMS_CONVENE_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_CONVENE_MUTATION=1 时运行（见任务 output 里的读数）')
    return
  }

  /**
   * ★ 三种读数，各自对应一条条件 —— 它们是**基线**，也是每次突变之后的探针。
   *   全部走 `freshGate`：三种读数必须来自**同一个**模块实例上的**同一份**代码。
   */
  const probe = (fn) => ({
    /** 臂 3（对照臂）的输入：三条都过。 */
    allPass: fn(ctx()).ok,
    /** 臂 1a：产物为空。 */
    noArtefact: fn(ctx({ producedDocuments: [] })).ok,
    /** 臂 1b：上游说有未审改动。 */
    unreviewed: fn(ctx({ upstream: { 'admission.checkpoint': CHECKPOINT_BLOCKED } })).ok,
    /** 臂 1c：还有没回答的问题。 */
    pending: fn(ctx({ openQuestions: ['still open?'] })).ok,
    /** ★ 臂 2a：上游自己没能测量 —— 这一格是"跟着 unmeasured"的探针。 */
    upstreamUnmeasured: fn(ctx({ upstream: { 'admission.checkpoint': CHECKPOINT_UNMEASURED } })).ok,
  })

  const baseline = probe(await freshGate('mutation=baseline'))
  /**
   * ★ 基线本身必须是对的（否则下面三次突变测的不是突变，是别的东西）：
   *   三条都过要放行；三条各自缺一次都要拒。
   */
  assert.deepEqual(
    baseline,
    { allPass: true, noArtefact: false, unreviewed: false, pending: false, upstreamUnmeasured: false },
    '★ 突变之前：三条都过要放行、每条缺失都要拒、上游没能测量也要拒 —— 否则下面测的不是突变',
  )

  const original = readFileSync(GATE_SOURCE, 'utf8')
  /**
   * ★ `replaceAll` 之后**必须断言真的替换到了**：一次没匹配上的 replace 会让
   *   突变体与基线逐字相同，于是下面"这条条件被去掉了"变成恒假 ——
   *   那是本队记账的第二种恒真写法（恒红）的镜像：**突变没生效，而报告说它生效了**。
   *
   * ★★ 支持**多针脚**（一次突变改多处），因为"把一条条件单独去掉"有时要动的不止一行：
   *   条件 ① 的两支共用同一个判别量，只改一行会让另一支顶上来（实测，见突变 A）。
   */
  const mutate = (edits, label) => {
    let mutated = original
    for (const [needle, replacement, part] of edits) {
      assert.equal(mutated.includes(needle), true, `★ 突变针脚（${label} / ${part}）必须逐字存在于 convene.ts：${JSON.stringify(needle)}`)
      const next = mutated.replace(needle, replacement)
      assert.notEqual(next, mutated, `★ 突变（${label} / ${part}）必须真的改到那一行 —— 没匹配上的替换会让这次突变恒不生效`)
      mutated = next
    }
    assert.notEqual(mutated, original, `★ 突变（${label}）必须真的改到源码`)
    return mutated
  }

  /**
   * ── 突变 A：条件 ①（产物非空）—— 把"没有产物"这条判定整个拿掉 ─────────────────
   *
   * ★★ MEASURED（本夹具第一次跑突变臂，自己抓出来的）：第一版只砍了
   *   `if (legalDocuments.length === 0 && illegalDocuments.length === 0)` 那一行
   *   （改成 `if (false && …)`），断言"产物为空必须不再被拒" ⇒ **仍然被拒**。
   *
   *   为什么：条件 ① 有**两支**（空集 ⇒ blocked、全非法 ⇒ unmeasured），
   *   砍掉第一支之后，空集掉进了第二支 ⇒ 兜底给了 unmeasured ⇒ `noArtefact` 仍是 false。
   *
   *   ★ 那条红**不是**判据的缺陷 —— 它是这次突变**没有把机制单独去掉**。
   *     "把机制单独去掉"要求砍掉的是**这条条件本身**，而不是它的一支：
   *     只砍一支时，另一支会替它挡下同一份输入，于是臂不红，
   *     而报告会读作"这条臂可能是恒真的"——一个**方向相反**的结论。
   *   ⇒ 突变 A 把**两支的判别量一起**改掉。
   *
   * ★★ MEASURED（第二版）：把判别量换成字面量 `false` **编译不过** ——
   *   `if (false) {…} else if (false) {…}` 之后，后面 `else` 支里对 `documents`
   *   的使用失去了前面 `Array.isArray(documents)` 带来的**收窄**（TS18048）。
   *   而夹具把"突变体编译不过"如实报成红（那是对的：这次突变测的会是 tsc）。
   *
   *   ⇒ 修法：判别量换成一个**声明为 `false` 的常量**（`const ARTEFACT_MUTATED = false`），
   *     并把两支的条件都改成它。TS 仍然按 `boolean` 收窄（不是字面量 false），
   *     于是编译得过，而运行时两支都不进 ⇒ 条件 ① 真的被单独去掉了。
   */
  await withBuiltGate(
    mutate([
      [
        `export function gate(ctx: ConveneContext): GateVerdict {`,
        `const ARTEFACT_MUTATED: boolean = false // MUTANT A: condition ① removed (both branches)\nexport function gate(ctx: ConveneContext): GateVerdict {`,
        'mutant A flag',
      ],
      [
        NEEDLES.artefactEmpty,
        `  if (ARTEFACT_MUTATED) { // MUTANT A: an empty set is no longer refused`,
        'empty set',
      ],
      [
        NEEDLES.artefactAllIllegal,
        `  } else if (ARTEFACT_MUTATED) { // MUTANT A: an all-illegal set is no longer reported`,
        'all-illegal set',
      ],
    ], 'condition ①'),
    async () => {
      const mutated = probe(await freshGate('mutation=no-artefact-condition'))
      /** ★ 臂 1a 的红：产物为空【不再被拒】。 */
      assert.equal(mutated.noArtefact, true, '★ 突变体必须放行"没有产物" —— 臂 1a 就是靠这一条变红的')
      assert.notDeepEqual(mutated, baseline, '★ 突变体与基线的裁决必须真的不同 —— 相同说明这次突变什么都没测到')
      /**
       * ★ 另外两条条件的臂**仍须为 false**：这次突变只拆掉条件 ①，
       *   ② ③ 各自独立。一个把三条合成一个布尔的实现会让这一条红。
       */
      assert.equal(mutated.unreviewed, false, '★ 条件 ② 不受影响（三条各自独立）')
      assert.equal(mutated.pending, false, '★ 条件 ③ 不受影响')
    },
  )

  /**
   * ── 突变 B：条件 ②（无未审改动）—— 把"上游说了什么"整个吃掉 ───────────────────
   *
   * ★★ MEASURED（第三版之前的两次尝试，都自己抓出来了）：只砍 `state === 'blocked'`
   *   那一支 ⇒ 臂 1b **仍然被拒**（它掉进了下面的 `else` ⇒ malformed ⇒ unmeasured）。
   *   与突变 A 是同一个形态：**一条条件有多个出口，只砍一个，另一个会顶上来。**
   *
   *   ⇒ 砍的是"`state !== 'ok'` 的一切都被报出来"这件事本身：把 `if (state === 'ok')`
   *     改成恒真。★ 仍然用**带类型的常量**（不是字面量 `true`）—— 与突变 A 同一条
   *     实测理由（字面量会让后面几支失去可达性/收窄，而 `tsc` 会先红）。
   *
   * ★ 而这一支的**关键反向断言**在下面：条件 ② 有两件事（"有未审改动"与"没能测量
   *   版本"），本次突变把**两件一起**砍掉；臂 2a 的探针 `upstreamUnmeasured` 必须
   *   跟着红。若它不红，说明"没能测量"那一支其实挂在别的地方（读错位置的出口）。
   */
  await withBuiltGate(
    mutate([
      [
        `export function gate(ctx: ConveneContext): GateVerdict {`,
        `const UNREVIEWED_MUTATED: boolean = true // MUTANT B: condition ② removed (upstream says nothing that stops a team)\nexport function gate(ctx: ConveneContext): GateVerdict {`,
        'mutant B flag',
      ],
      [
        NEEDLES.unreviewedOkBranch,
        `    if (UNREVIEWED_MUTATED) { // MUTANT B: whatever the upstream verdict said is not reported`,
        'upstream reported anything',
      ],
    ], 'condition ②'),
    async () => {
      const mutated = probe(await freshGate('mutation=no-unreviewed-condition'))
      /** ★ 臂 1b 的红：上游说有未审改动【不再被拒】。 */
      assert.equal(mutated.unreviewed, true, '★ 突变体必须放行"有未审改动" —— 臂 1b 就是靠这一条变红的')
      assert.notDeepEqual(mutated, baseline)
      assert.equal(mutated.noArtefact, false, '★ 条件 ① 不受影响')
      assert.equal(mutated.pending, false, '★ 条件 ③ 不受影响')
      /**
       * ★★ 而这一支的**关键反向断言**：条件 ② 有**两件事**（"有未审改动"与
       *   "没能测量版本"），而本次突变把**上游的一切**都吃掉了（`if (state === 'ok')`
       *   恒真）⇒ 臂 2a 的探针 `upstreamUnmeasured` **也必须跟着红**。
       *
       *   ★ 它证明的是这条突变**真的**砍在条件 ② 上（而不是只砍了一个出口）：
       *     一个"两个出口合成一句"的实现会让这条断言在基线时就红；
       *     而一个只砍掉 `blocked` 那一支的突变，会让它**仍然为 false**
       *     —— 那正是本突变第一版失败的样子（实测，见上面的记录）。
       */
      assert.equal(
        mutated.upstreamUnmeasured, true,
        '★ 上游"没能测量"也必须跟着放行 —— 本次突变砍的是"上游说什么都会报"这件事本身，不是其中一个出口',
      )
    },
  )

  /**
   * ── 突变 C：条件 ③（无待确认问题）—— 把"还有问题 / 读不到提问表"整个吃掉 ───────
   *
   * ★ 与突变 B 同形：条件 ③ 也有**两个出口**（"还有没回答的问题"与"没能观察提问表"），
   *   而它们共用同一个判别量 `questions.state` ⇒ 砍的是 `if (questions.state === 'unmeasured')`
   *   那一支的入口，把两个出口一起变成不可达。
   */
  await withBuiltGate(
    mutate([
      [
        `export function gate(ctx: ConveneContext): GateVerdict {`,
        `const QUESTIONS_MUTATED: boolean = true // MUTANT C: condition ③ removed (both exits)\nexport function gate(ctx: ConveneContext): GateVerdict {`,
        'mutant C flag',
      ],
      [
        NEEDLES.pending,
        `  } else if (!QUESTIONS_MUTATED && questions.pending.length > 0) { // MUTANT C: pending questions are no longer refused`,
        'pending question',
      ],
      [
        NEEDLES.questionsUnmeasured,
        `  if (!QUESTIONS_MUTATED && questions.state === 'unmeasured') { // MUTANT C: an unreadable question list is no longer "not measured"`,
        'unreadable question list',
      ],
    ], 'condition ③'),
    async () => {
      const mutated = probe(await freshGate('mutation=no-pending-condition'))
      /** ★ 臂 1c 的红：还有没回答的问题【不再被拒】。 */
      assert.equal(mutated.pending, true, '★ 突变体必须放行"还有未回答的问题" —— 臂 1c 就是靠这一条变红的')
      assert.notDeepEqual(mutated, baseline)
      assert.equal(mutated.noArtefact, false, '★ 条件 ① 不受影响')
      assert.equal(mutated.unreviewed, false, '★ 条件 ② 不受影响')
    },
  )

  /**
   * ── 突变 D：把【整条判据的否决权】去掉（"机制被单独去掉"的最极端形态）──────────
   *
   * ★ 这一支回答一个否则没人回答的问题：上面三次突变各自打红一条臂，但**它们都
   *   还留着另外两条条件在拒绝**。于是一个"三条全不设防、一律放行"的实现会不会
   *   照样被抓住？⇒ 这一支把它跑出来。
   *
   * ★★ MEASURED（第一次尝试）：写成"在 `gate` 开头直接 `return {ok:true}`"
   *   ⇒ **编译失败**（TS18048 ×4）：提前 return 让后面所有分支失去了
   *   `Array.isArray(documents)` / `upstream` 检查带来的**收窄**。
   *   夹具如实把它报成红（"这次突变测的是 tsc，不是判据的裁决"）—— 那条读数是对的。
   *
   *   ⇒ 修法：不提前 return，改在**两个收口判定**上（`blockers.length > 0`
   *     与 `unmeasuredReasons.length > 0`）加一个带类型的短路常量。
   *     所有分支与收窄原样保留，只是没有一条能真的拒绝 —— 这正是"机制被去掉、
   *     形状还在"的样子，也正是规则二后半句要打的那种实现。
   */
  await withBuiltGate(
    mutate([
      [
        `export function gate(ctx: ConveneContext): GateVerdict {`,
        `const REJECTION_MUTATED: boolean = true // MUTANT D: the whole rejection mechanism removed\nexport function gate(ctx: ConveneContext): GateVerdict {`,
        'mutant D flag',
      ],
      [
        `  if (blockers.length > 0) {`,
        `  if (!REJECTION_MUTATED && blockers.length > 0) { // MUTANT D: blockers no longer refuse`,
        'blockers exit',
      ],
      [
        `  if (unmeasuredReasons.length > 0) {`,
        `  if (!REJECTION_MUTATED && unmeasuredReasons.length > 0) { // MUTANT D: "not measured" no longer refuses`,
        'unmeasured exit',
      ],
    ], 'whole mechanism'),
    async () => {
      const mutated = probe(await freshGate('mutation=always-ok'))
      /**
       * ★ 一个"什么都不拒绝"的判据必须让**每一条**拒绝臂同时红 ——
       *   若某一条臂在这个突变体上**仍然绿**，那条臂就是**恒真**的
       *   （它拒绝的原因不是这条判据的机制，而是别的东西）。
       */
      for (const [name, reading] of Object.entries(mutated)) {
        assert.equal(reading, true, `★ 突变体 D（一律放行）必须让 "${name}" 也变红 —— 它仍然绿说明那条臂是恒真的`)
      }
      assert.notDeepEqual(mutated, baseline)
    },
  )

  /**
   * ★ 还原之后逐字相等：一次中途失败会把一条被突变的判据留在盘上，那比突变本身坏得多。
   *   ★ 同样走 `freshGate`（一个新的 query ⇒ 一个新的模块实例）—— 用旧实例读到的
   *   是**突变体**，那样这条断言会在还原成功时反而变红，把一个好状态报成坏状态。
   */
  assert.deepEqual(
    probe(await freshGate('mutation=restored')),
    baseline,
    '★ 还原之后必须与突变前逐字一致 —— 否则盘上留着一份没人认得的判据',
  )
  assert.equal(restoreError, null, `★ 还原过程本身不许出错：${restoreError}`)
})

test('★ 二次对照：三次突变的针脚在源码里【真的存在】（否则它们改的是一个不存在的字符串）', () => {
  /**
   * ★ 这条不测判据，测的是上面那三次突变**赖以成立的前提**。针脚写错一个字符，
   *   上面的突变就会静默变成"什么都没改"，而报告里它会读作"突变没打红 ⇒ 臂是恒真的"
   *   —— 一个**方向相反**的结论。
   *
   *   ★ 默认跳过的那一臂之外，这一条**总是**跑：因为"针脚存在"与"能不能跑 build"
   *     无关，它是一个纯文本事实。
   */
  const source = readFileSync(GATE_SOURCE, 'utf8')
  for (const [label, needle] of Object.entries(NEEDLES)) {
    assert.equal(source.includes(needle), true, `★ 突变针脚（${label}）必须逐字存在于 convene.ts：${JSON.stringify(needle)}`)
  }
  /**
   * ★★ 而条件 ① 的**两根针脚必须落在不同的分支上** —— 它们若逐字相同，
   *   `mutate` 里第二次 `replace` 会改到**同一处**（第一根已经被换掉了），
   *   于是"两支一起砍"变成"砍一支" —— 而报告会读作"臂可能恒真"。
   *   （这正是突变 A 第一版失败的那个形态，这里把它钉成可执行的。）
   */
  assert.notEqual(
    NEEDLES.artefactEmpty, NEEDLES.artefactAllIllegal,
    '★ 条件 ① 的两支必须各有一根不同的针脚 —— 相同的话第二次替换会落在同一处',
  )
  /**
   * ★ 突变 A 的判别量针脚（`export function gate(...)`）必须存在，且**只出现一次**
   *   —— 出现两次会让 `replace` 改到第一处（函数签名那一个）而语义不明。
   */
  const gateSignature = `export function gate(ctx: ConveneContext): GateVerdict {`
  assert.equal(
    source.split(gateSignature).length - 1, 1,
    '★ 突变 A/B/C 的判别量都插在 `export function gate` 之前 —— 那条签名必须唯一，否则替换落在哪一处不可知',
  )
  /**
   * ★ 条件 ② ③ 的两根针脚也必须在**不同的分支**上（与条件 ① 同一条理由）。
   */
  assert.notEqual(NEEDLES.pending, NEEDLES.questionsUnmeasured, '★ 条件 ③ 的两支必须各有一根不同的针脚')
})

// ─────────────────────────────────────────────────────────────────────────────
// 装配形状 + 输入面声明
// ─────────────────────────────────────────────────────────────────────────────

test('★ 装配形状：这条判据交出装配层读的四个名字，且 id / point 符合 t9 的期望', () => {
  assert.equal(typeof id, 'string')
  /**
   * ★ id 是 `admission.convene` —— 独立验证（t9）按**这个后缀**在真实注册表里
   *   找成团判据（`EXPECTED[].hint`）。两边必须逐字一致，否则它的 B 类臂会一直
   *   报"判据不在盘上"，而那是它自己的诚实读法，不是它写错了。
   */
  assert.equal(id, 'admission.convene', '★ 与 t9 期望的 id 一致')
  assert.match(id, /^admission\./)
  assert.equal(point, 'admission', '★ 它判的是【准入】（够不够格进场 / 能不能成团），不是契约合法性')
  assert.equal(typeof gate, 'function')
  assert.equal(typeof appliesTo, 'function')
  assert.ok(Array.isArray(requires))
})

test('★ 输入面声明：`producedDocuments` 与 `upstream` 被声明，`openQuestions` / `memberCap` 刻意不声明', () => {
  /**
   * ★ 声明的取舍写在 convene.ts 的注释里，这条把它钉成可执行的：
   *   · `upstream` **必须**声明 —— 它是条件 ② 唯一合法的证据来源，
   *     "上游裁决没接上"必须被核对层读成**缺输入**；
   *   · `openQuestions` / `memberCap` **不进声明** —— 它们各自的"没接线"由判据
   *     自己说（而且说得更细：unmeasured vs 证据里一句），声明它们只会制造噪音
   *     （与 runtime.liveness 把 `wait` 单数排除在声明外同一条口径）。
   */
  assert.deepEqual([...requires].sort(), ['producedDocuments', 'upstream'], '★ 声明面必须恰好是这两格')
})
