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

/**
 * ── ★ t13 复审记录：本文件的臂 2e / 2e′ / 2f 与"污染检查"是为一个真实缺陷加的 ──────
 *
 * 缺陷：条件 ③ 把「`open-questions.json` 没被接上」读成「没有未回答的问题」——
 * 缺席与 `[]` 返回**逐字相同的 JSON**（都 `ok`、都 `noPendingQuestion: true`）。
 * 成因：交付的源码里留着一个定向突变的变异体（`MUTANT C`），而不是逻辑写错。
 * ⇒ 三件事同时落地：① 缺席落 unmeasured；② 形状坏落**另一个** unmeasured；
 *   ③ 一条**不依赖任何突变是否还原**的污染检查，防它再被交付。
 */

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
 * ── ★ 上游 absorb 的另外两态（t25 补）────────────────────────────────────────────
 *
 * ★ 三条各写一次，且**文本刻意不同**：这样"本判据有没有把上游的原文带上来"
 *   才是可判的（若都用同一句话，"带没带"就看不出来）。
 */
const ABSORB_BLOCKED = {
  ok: false,
  blockers: ['the claim of absorption is false: the artefact was not changed by this session'],
}
const ABSORB_UNMEASURED = {
  ok: false,
  unmeasured: 'the write history could not be observed, so whether the session really absorbed the review could not be observed',
}

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

test('★★ 臂 2e（t13 的真缺陷）：提问表【缺席】⇒ unmeasured，与 `[]`（ok）【返回不同的 JSON】', () => {
  /**
   * ── 这一臂钉的是什么 ────────────────────────────────────────────────────────
   *
   * MEASURED（t13 修复前，基线逐字复现）：`openQuestions` **缺席**与 `[]` 返回
   * **完全相同的 JSON** —— 两者都 `ok`、都 `conditions.noPendingQuestion: true`。
   * 也就是说：
   *
   *     调用方根本没接 `open-questions.json` ⇒ 判据说"问题都答完了" ⇒ 自动成团
   *
   * ★ 这正是本队那条纪律（"绝不把没测到并进通过"）要防的事，只是被并进去的
   *   不是整条判据，而是**第 ③ 条**。
   *
   * ⇒ 本臂的第一条断言就是那次缺陷的**字面落点**：两者的 JSON 必须不同。
   *   它比"逐字段比较"更强 —— 它把"同形"这件事本身判成红，而不是列举字段
   *   （逐字段列举会在判据将来多交一个字段时静默地漏掉那个字段）。
   */
  const absent = gate(ctx({ openQuestions: undefined }))
  const empty = expectOk(gate(ctx({ openQuestions: [] })))
  assert.notEqual(
    JSON.stringify(absent), JSON.stringify(empty),
    '★ 缺席与空数组必须【不同形】—— 修复前它们逐字相同（都 ok、都 noPendingQuestion:true），'
    + '"没人接这张表"于是被读成了"问题都答完了"',
  )
  const reason = expectUnmeasured(absent)
  assert.match(reason, /condition ③/)
  /**
   * ★ 而这句话必须说清**是哪种没测到**：缺席的补救是"去接线"，不是"去回答问题"。
   */
  assert.match(reason, /could not be observed at all/, '★ 必须说清是"压根没人接"，而不是"读到了但读不懂"')
  assert.match(
    reason,
    /not the same as "the questions are all answered"/,
    '★ 界线必须写在理由里 —— 读日志的人要能直接看出这条不是"问题都答完了"',
  )
  assert.equal(empty.conveneReport.conditions.noPendingQuestion, true, '★ 而 `[]` 仍然表示"问题都答完了"（不误伤）')
})

test('★★ 臂 2e′：缺席 与 形状坏 —— 两种"没能测量"必须【不同形】（补救动作不同）', () => {
  /**
   * ── 为什么这一条与臂 2e 分开 ─────────────────────────────────────────────────
   *
   * 条件 ③ 有两种"没能测量"，而它们的**补救动作完全不同**：
   *
   *     缺席（`undefined` / `null`）⇒ **去接线**（编排层还没把这格交进来）
   *     形状坏（非数组 / 含非法条目）⇒ **去修调用方**（交了，但交错了）
   *
   * ★ 修复前两者共用**同一句话** ⇒ 按前者去修一个其实是后者的问题会白跑一轮。
   *   这与本队反复记账的"两种东西同名"同族，只是这里被合成的是**两种没测到**。
   */
  const absent = expectUnmeasured(gate(ctx({ openQuestions: undefined })))
  const nullish = expectUnmeasured(gate(ctx({ openQuestions: null })))
  const malformed = expectUnmeasured(gate(ctx({ openQuestions: 'not-a-list' })))
  assert.equal(
    new Set([absent, nullish, malformed]).size, 2,
    '★ `undefined` 与 `null` 是同一种（缺席），而"非数组"是另一种（形状坏）—— 必须恰好两句不同的话',
  )
  assert.match(absent, /could not be observed at all/)
  assert.match(malformed, /injected in a shape that is not a list/, '★ 形状坏那一句必须说清"交错了"')
  assert.notEqual(absent, malformed)
  /**
   * ★ 而形状坏那一句要**说清是哪一格坏了** —— 一个笼统的"形状不对"要人自己去猜
   *   （文件里第 3 条？还是整个顶层？），那等于把排查工作退还给读日志的人。
   */
  const badEntry = expectUnmeasured(gate(ctx({ openQuestions: ['q1', 42] })))
  assert.match(badEntry, /entry 1/, '★ 必须指到**哪一个条目**坏了（0 基下标 = 1 指第二项）')
  assert.match(badEntry, /not a non-empty question string/)
})

test('★ 臂 2f：提问表的形状坏了（含非字符串条目）⇒ unmeasured，不许"忽略它、看剩下的"', () => {
  /**
   * ★ 一个 `['q1', 42]` 里那个 `42` **可能**是一条真的未回答问题。
   *   静默丢掉它 ⇒ "有一条读不懂的问题"被读成"问题都答完了"（本任务要消灭的方向）。
   *   反过来"看不懂就拒绝"也不对：那会在一次**错的接线**上开火。
   *   ⇒ 正确落点是第三态。
   *
   * ★ 每一种坏形状都**不许**与 `[]`（读到、空的 ⇒ ok）同形 —— 这是这一族的共同判据。
   */
  for (const broken of [['q1', 42], ['q1', ''], ['q1', '   '], [''], [null], 'not-a-list', { questions: [] }, 42]) {
    const verdict = gate(ctx({ openQuestions: broken }))
    const reason = expectUnmeasured(verdict)
    assert.match(reason, /condition ③/, `★ 形状 ${JSON.stringify(broken)} 必须落 unmeasured`)
    assert.notEqual(
      JSON.stringify(verdict), JSON.stringify(gate(ctx({ openQuestions: [] }))),
      `★ 形状 ${JSON.stringify(broken)} 不许与"读到、空的"同形 —— 否则"读不懂"被读成"问题都答完了"`,
    )
  }
})

/**
 * ── ★★ 条件 ④（吸收）：本任务 t25 补的那一条 ────────────────────────────────────
 *
 * ── 它防的是什么失效 ────────────────────────────────────────────────────────
 *
 * MEASURED（t20 普查命中、captain 复现、本任务逐字复核）：补上条件 ④ **之前**，
 * `convene` 对 `admission.absorb` 的裁决**完全无视** —— 四种吸收态返回**完全相同的
 * 裁决**（都 `ok`、都 `autoApprove: true`）：
 *
 *     absorb = ok          ⇒ ok（正确）
 *     absorb = blocked     ⇒ ok   ✘ 上游已经开火，成团闸门替它签了字
 *     absorb = unmeasured  ⇒ ok   ✘ 不知道吸收发没发生，却宣布够格
 *     absorb 键缺席         ⇒ ok   ✘ 上游压根没跑
 *
 * ★ 而代价特别高：用户裁定「判据全过 ⇒ 可自动成团，**不需要用户点头**」
 *   ⇒ 一个"不确定有没有吸收"的时刻会**在没有人的情况下**成团。
 *
 * ★★ 而它的形状是本队记过的第四种恒真写法（**读错位置的出口**）最隐蔽的形态：
 *   `UPSTREAM_ABSORB` 此前**出现在代码里**（`conveneReport.upstreamStates` 的回显），
 *   于是日志里能看到 absorb 的态 —— 看起来像"读了"，实际对裁决零影响。
 *   ⇒ "被记录下来"与"被用来判定"是两件事，而它们在日志里长得一样。
 */

test('★★ 臂 1f（t25 的真缺陷）：上游 absorb 报 blocked ⇒ blocked，且复述上游的【原文证据】', () => {
  const blockers = expectBlocked(gate(ctx({
    upstream: { 'admission.checkpoint': CHECKPOINT_OK, 'admission.absorb': ABSORB_BLOCKED },
  })))
  assert.ok(blockers.length >= 1, '★ 必须拒绝')
  const joined = blockers.join('\n')
  assert.match(joined, /condition ④/, '★ 必须点名是条件 ④ —— 否则读日志的人不知道缺的是"吸收"还是"再审"')
  assert.match(joined, /could NOT be established/, '★ 必须说清缺的是什么（吸收没成立）')
  /**
   * ★★ 这一条是"读上游结论、不重算"的可观测落点：上游 blocker 的**原文**必须被带过来。
   *   本判据的输入里没有任何"吸收痕迹"（它只有上游裁决），所以拿不到这段文本。
   */
  assert.match(joined, /the claim of absorption is false/, '★ 必须复述上游裁决的原文证据')
  assert.doesNotMatch(joined, /condition ②/, '★ 不许连坐：checkpoint 这一格是健康的')
})

test('★★ 臂 2i（t25 的真缺陷）：上游 absorb 报 unmeasured ⇒ 本判据【跟着 unmeasured】，绝不是 ok', () => {
  const verdict = gate(ctx({
    upstream: { 'admission.checkpoint': CHECKPOINT_OK, 'admission.absorb': ABSORB_UNMEASURED },
  }))
  const reason = expectUnmeasured(verdict)
  assert.match(reason, /condition ④/, '★ 必须点名条件 ④')
  assert.match(reason, /could NOT be measured/, '★ 必须说清是"没能测量"')
  assert.match(reason, /could not observe the absorption/, '★ 必须把上游那句理由带出来')
  /**
   * ★ 形状断言（不是措辞断言）：unmeasured 这一支里**没有** `ok:true`，也**没有** `blockers`。
   */
  assert.equal('blockers' in verdict, false, '★ unmeasured 不许同时带 blockers')
  assert.equal(verdict.ok, false)
})

test('★★ 臂 2j（t25 的真缺陷）：上游【压根没有】absorb 这个键 ⇒ unmeasured（不是"吸收没问题"）', () => {
  const reason = expectUnmeasured(gate(ctx({
    upstream: { 'admission.checkpoint': CHECKPOINT_OK },
  })))
  assert.match(reason, /condition ④/, '★ 缺的是条件 ④')
  assert.match(reason, /did not run in this step/, '★ 必须说清是"上游没跑"，不是"上游说没事"')
  assert.match(reason, /never spoke is not a gate that said "yes"/, '★ 界线必须写在理由里')
})

test('★★★ 臂 2k（t25 的核心断言）：四种吸收态的裁决**必须两两不同形** —— 尤其是 ok 与其余三种', () => {
  /**
   * ── 这一条是 t20 普查臂 1 的**同构断言**，写在判据自己的夹具里 ────────────────────
   *
   * 普查臂 1 是**外部**检查（从真实注册表读这条判据）；这一条是**内部**回归
   * （判据自己的三臂）。★ 两者都要有：外部那条防止"判据整体烂掉"，内部这条
   * 让"补上条件 ④ 的人"在**改动的当次**就看见它。
   *
   * ★ 断言的形态刻意选"两两不同形"而不是"逐个举例"：
   *   逐个举例会在将来多一个态时静默漏掉那个态 —— 那是本队记过的"漏记的那几条
   *   会静默地不报 unmeasured，读起来就像它们通过了"。
   */
  const states = {
    ok: ABSORB_OK,
    blocked: ABSORB_BLOCKED,
    unmeasured: ABSORB_UNMEASURED,
    /** ★ 键缺席：上游没跑。 */
    absent: undefined,
  }
  const reads = {}
  for (const [name, absorb] of Object.entries(states)) {
    const upstream = absorb === undefined
      ? { 'admission.checkpoint': CHECKPOINT_OK }
      : { 'admission.checkpoint': CHECKPOINT_OK, 'admission.absorb': absorb }
    const whole = gate(ctx({ upstream }))
    reads[name] = {
      /** ★ 只取**裁决**三格 —— 不取 upstreamStates（那是回显，会掩盖合流，见下）。 */
      decision: JSON.stringify({ ok: whole.ok, blockers: whole.blockers, unmeasured: whole.unmeasured }),
      autoApprove: whole.conveneReport?.autoApprove,
    }
  }
  /**
   * ★★ 第一条断言就是那次缺陷的**字面落点**：四种态的裁决必须两两不同。
   *   修复前它们**逐字相同**（`new Set(...).size === 1`）。
   *
   * ★ 这里刻意**不把 `upstreamStates` 算进 decision**：修复前那份回显就已经
   *   是四态不同的（它照抄上游的态），所以把它算进去会让本臂在**有缺陷的实现上
   *   也绿** —— 那正是"读错位置的出口"在夹具里的翻版：测了一个会变的东西，
   *   而它与"裁决变了"无关。★ 判断"回显"与"判定"的差别，就靠把回显排除在外。
   */
  assert.equal(
    new Set(Object.values(reads).map((entry) => entry.decision)).size, 4,
    '★ 四种吸收态必须给出四种不同的裁决 —— 修复前它们返回完全相同的 JSON（都 ok）',
  )
  /**
   * ★★ 第二条：**只有 ok 态**才产出 `autoApprove: true`。
   *   其余三态必须是 `undefined`（没产出）—— 而"没产出"与"false"不同形：
   *   前者是"这条判据没说可以"，后者会被误读成"它说了不可以"。
   *   ★ 判据只在 ok 时交出产出（与 absorb 的 `absorbReport` 同一条纪律）。
   */
  assert.equal(reads.ok.autoApprove, true, '★ 吸收成立 ⇒ 确实产出 autoApprove: true')
  for (const name of ['blocked', 'unmeasured', 'absent']) {
    assert.equal(
      reads[name].autoApprove, undefined,
      `★ absorb=${name} 时**不许**产出 autoApprove —— 而这一格的代价是"真的会成团"（用户裁定不需要点头）`,
    )
  }
})

test('★ 臂 2l：整个 `upstream` 缺席 ⇒ unmeasured（"没人接线"与"上游都说没事"不同形）', () => {
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

test('臂 3 ★ 对照臂：产物非空 + 无未审改动 + 无待确认问题 + 吸收成立 ⇒ ok，且交出逐条证据', () => {
  const verdict = expectOk(gate(ctx()))
  const report = verdict.conveneReport
  assert.notEqual(report, undefined, '★ ok 时必须交出产出（编排层据此调 approve）')
  assert.deepEqual(
    report.conditions,
    { artefactPresent: true, noUnreviewedChange: true, noPendingQuestion: true, absorptionEstablished: true },
    '★ 四条各自的读数都要交出来 —— 一句"够格了"与"什么都没查"在下游同形',
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
  assert.match(report.evidence.join('\n'), /①/, '★ 证据要逐条给：① 产物 ② 无未审改动 ③ 无未答问题 ④ 吸收成立')
  assert.match(report.evidence.join('\n'), /②/)
  assert.match(report.evidence.join('\n'), /③/)
  assert.match(report.evidence.join('\n'), /④/)
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
    /**
     * ★★ 注意这里**必须把 absorb 那一格补回健康态**（本任务 t25 补条件 ④ 之后的修正）。
     *
     * `ctx({ upstream: {...} })` 是**整体替换** `upstream`（不是深合并）⇒ 只写 checkpoint
     * 会让 `admission.absorb` 那一格**缺席**。补上条件 ④ 之前那是无所谓的（没人读它）；
     * 补上之后，缺席的 absorb 会让**每一个样本**都落 `unmeasured`（condition ④），
     * 于是这条臂测的就不再是"两个读数对不对得上"，而是条件 ④ 的缺格分支 ——
     * ★ 一个**变量不唯一**的臂：它看起来还在验 checkpoint，实际验的是 absorb。
     */
    const mine = gate(ctx({ upstream: { 'admission.checkpoint': sample, 'admission.absorb': ABSORB_OK } }))
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
 *     ③ 重新编译出 `lib/gates/admission/convene.js`（夹具读的是 lib/，必须真的重建；
 *        口径见下面 `serverBuild()` —— 只建服务端那一份）
 *     ④ 用对应那条臂的输入再问一次 ⇒ **必须红**
 *     ⑤ 还原源码、重新编译，并断言还原之后的裁决与突变前**逐字相等**
 *
 * ★★ 第 ⑤ 步不是礼节 —— 而且本文件在写法上比 t7 更保守，因为 t7 在这里踩过坑：
 *   「还原写在 `finally` 里且带断言 ⇒ 断言一失败，变异体永久留在盘上」。
 *   ⇒ 本文件的三条纪律：
 *     · 还原放在**最外层**（`try/finally` 包住整个突变体，包括断言）；
 *     · 还原函数**永不抛**（内部的 build 失败只记在 `restoreError` 上）；
 *     · `process.on('exit')` **兜底**：即使进程被测试框架半路终止（或某处
 *       `process.exit` 被调），源码也一定被写回。
 *
 * ★★ 而 t13 的事故证明这三条**还不够**：会话被中断时 `exit` 钩子没有机会跑，
 *   于是变异体被提交进了仓库。⇒ 本文件另加一条**总是运行**的污染检查
 *   （见文件末尾那条臂：它只读盘上的字节，不依赖任何突变是否还原成功）。
 *
 * ★ 顺序是【串行】的，而且必须：编译会先 `rm -rf lib/`（clean-build），
 *   并行跑两个编译会让另一个进程读到半个 lib/。本文件因此不做任何并行突变。
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
  /**
   * ★ 突变 E 的针脚：条件 ③ 读那一格的那一行本身。
   *   在**收窄之前**改写它，才能单独打中"缺席"这一支（见突变 E 的实测记录）。
   */
  questionsRead: `  const questions = pendingQuestions(ctx?.openQuestions)`,
  /**
   * ── ★★ 突变 F 的针脚（t25）：条件 ④ 的两处入口 ────────────────────────────────
   *
   * 这两根一起改，才等价于"把吸收裁决**改回吞掉**"（本任务验收单列的那一条）：
   *
   *   ① 键缺席那一支的入口            —— 改成恒假 ⇒ 缺席不再落 unmeasured
   *   ② `readUpstreamState` 的**调用** —— 改成恒 `'ok'` ⇒ blocked/unmeasured 都不再分形
   *
   * ★ 只改①会让 blocked/unmeasured 掉进②，只改②会让缺席掉进① ——
   *   **一支会替另一支挡下同一份输入**（与条件 ① ③ 的实测同形）。
   */
  absorbMissingBranch: `  if (!(UPSTREAM_ABSORB in upstream)) {`,
  absorbStateRead: `    const absorbState = readUpstreamState(absorbVerdict)`,
}

let restoreError = null

/**
 * ── ★★ 突变臂只需要【服务端】那一份构建（本任务 t13 实测出来的）─────────────────
 *
 * `pnpm build` = clean-build → `tsc -p tsconfig.json` → `tsc -p tsconfig.client.json`
 * → tsdown → git-artifacts。而本夹具读的只有 `lib/gates/admission/convene.js`，
 * 那是**第一个 tsc** 的产物 —— client 那一份与本判据毫无关系。
 *
 * MEASURED（t13）：突变臂原先跑整套 `pnpm build`，它会在**两次不同的场合**红，
 * 而两次都与本判据无关：
 *
 *   ① `tsconfig.client.json` 在 worktree 里会因为客户端 peer 依赖
 *      （`@deepseek-ai/dsh-client-ui-conversation/client` 一类）解析不到而报十几条
 *      `TS2307` —— 那些错**没有一条**在 `convene.ts` 里。
 *   ② ★★ 更隐蔽的一次：本任务与**兄弟 worktree**（`task-t14`）都在跑构建，
 *      而两者的 `node_modules` 是**同一个目录的两个符号链接**（worktree 不带
 *      node_modules，只能链回主工作区）。⇒ 一次 `tsc` 可能在另一个进程刚写坏
 *      中间态时读到它，报出一堆**在别的文件里**的错。
 *
 * ★ 两次红的形状**完全一样**（"突变体必须编译得过"），而它们要说的事完全不同：
 *   前者是环境，后者是并发。★ 而最坏的一种误读是：把它当成"判据的突变体有问题"
 *   —— 于是下一个人去改一个本来正确的判据（本队记账的"方向相反"）。
 *
 * ⇒ 口径：只重建它**真正需要**的那一份（clean-build + 服务端 tsc），
 *   并且**只把 `convene.ts` 自己的编译错误当成本次突变的结果**；别的文件报错
 *   ⇒ 重试（最多 3 次，串行），仍失败才如实报出"这一次没能测"（而不是报成
 *   "突变没打红"）。★ 与本队那条纪律一致：**没能测量 ≠ 测到了问题**。
 */
function serverBuild() {
  const clean = spawnSync('node', ['scripts/clean-build.mjs'], { cwd: ROOT, encoding: 'utf8' })
  if (clean.status !== 0) return clean
  return spawnSync('npx', ['tsc', '-p', 'tsconfig.json'], { cwd: ROOT, encoding: 'utf8', shell: true })
}

/** 编译输出里，**属于被判据突变的那一份**的错误（其余是环境 / 并发噪声）。 */
function errorsInGate(result) {
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`
  return text.split('\n').filter((line) => /error TS\d+/.test(line))
}

/**
 * 跑一次服务端构建，**并确认它真的编译过了 `convene.ts`**。
 *
 * 返回 `{ result, ownErrors, foreignErrors }`：
 *   · `ownErrors`     —— 落在 `convene.ts` 上的错误 ⇒ 这次突变真的编译不过，**是发现**
 *   · `foreignErrors` —— 落在别的文件上的错误 ⇒ 环境 / 兄弟 worktree 的并发噪声
 *
 * ★ "别的文件报错"不许被当成"突变体有问题"：它对本次突变**什么都没测到**。
 */
function buildForMutation() {
  const result = serverBuild()
  const all = errorsInGate(result)
  const own = all.filter((line) => line.includes('src/gates/admission/convene.ts'))
  const foreign = all.filter((line) => !line.includes('src/gates/admission/convene.ts'))
  return { result, ownErrors: own, foreignErrors: foreign }
}

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
    const built = serverBuild()
    /**
     * ★ 还原的验收标准是"那份产物回到了突变前的字节" —— 而不是"tsc 退出码为 0"：
     *   并发噪声会让退出码非 0，而产物其实是对的。
     */
    if (built.status !== 0) {
      const now = existsSync(BUILT_GATE) ? readFileSync(BUILT_GATE, 'utf8') : ''
      if (now.includes('MUTANT')) {
        restoreError = `★ 还原之后 build 失败、且盘上仍是变异体：\n${built.stdout}\n${built.stderr}`
      }
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
    /**
     * ★ 重试只为**别的文件**的报错（环境 / 并发）—— `convene.ts` 自己的错立即判定，
     *   否则重试会把一条真实的编译发现拖成"最终报成没能测量"。
     */
    let built = buildForMutation()
    for (let attempt = 0; attempt < 2 && built.ownErrors.length === 0 && built.result.status !== 0; attempt += 1) {
      built = buildForMutation()
    }
    assert.equal(
      built.ownErrors.length, 0,
      `★ 突变体必须编译得过（否则这次突变测的是 tsc，不是判据的裁决）:\n${built.ownErrors.join('\n')}`,
    )
    assert.equal(
      built.result.status, 0,
      '★ 这一次突变没能测量：服务端构建连续失败，而报错**不在** convene.ts 里（环境 / 兄弟 worktree 的并发）。'
      + '★ 这不是"突变没打红对应臂" —— 是**什么都没测到**，两者的补救动作相反：\n'
      + `${built.result.stdout}\n${built.result.stderr}`,
    )
    /**
     * ★ 编译过了还不算数：**断言那份产物真的被重建了**。一次"tsc 说没问题、
     *   而 lib/ 里还是旧字节"（增量缓存 / 时间戳同秒）会让下面每一次
     *   突变读数都测到基线 —— 而报告会读作"突变没打红对应臂 ⇒ 那条臂可能是恒真的"，
     *   一个**方向相反**的结论。
     */
    const builtNow = readFileSync(BUILT_GATE, 'utf8')
    assert.equal(
      builtNow.includes('MUTANT'), true,
      '★ 突变体必须真的落到 lib/ 里 —— 否则下面的读数测的是基线，而报告会说"突变没生效"',
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
   * ★ 各个读数，各自对应一条条件 —— 它们是**基线**，也是每次突变之后的探针。
   *   全部走 `freshGate`：这些读数必须来自**同一个**模块实例上的**同一份**代码。
   *
   * ★★ MEASURED（t25）：下面每一格只要改 `upstream`，就**必须把另一格补回健康态** ——
   *   `ctx({ upstream: {...} })` 是整体替换，不是深合并。补上条件 ④ 之前无所谓
   *   （没人读 absorb）；补上之后，少写一格会让该探针落进**条件 ④ 的缺格分支**，
   *   于是"它拒了"这件事与它声称要测的那条条件无关 —— **变量不唯一**的臂。
   */
  const probe = (fn) => ({
    /** 臂 3（对照臂）的输入：四条都过。 */
    allPass: fn(ctx()).ok,
    /** 臂 1a：产物为空。 */
    noArtefact: fn(ctx({ producedDocuments: [] })).ok,
    /** 臂 1b：上游 checkpoint 说有未审改动（absorb 保持健康）。 */
    unreviewed: fn(ctx({ upstream: { 'admission.checkpoint': CHECKPOINT_BLOCKED, 'admission.absorb': ABSORB_OK } })).ok,
    /** 臂 1c：还有没回答的问题。 */
    pending: fn(ctx({ openQuestions: ['still open?'] })).ok,
    /** ★ 臂 2a：上游 checkpoint 自己没能测量（absorb 保持健康）。 */
    upstreamUnmeasured: fn(ctx({ upstream: { 'admission.checkpoint': CHECKPOINT_UNMEASURED, 'admission.absorb': ABSORB_OK } })).ok,
    /**
     * ★★ 臂 2e 的探针（t13 新增）：提问表**缺席**。
     *   它是那次修复的**字面落点** —— 修复前这一格与"`[]`（读到、空的）"同形。
     */
    questionsAbsent: fn(ctx({ openQuestions: undefined })).ok,
    /** ★ 臂 2e′ 的探针：提问表的形状坏掉（非数组）。 */
    questionsMalformed: fn(ctx({ openQuestions: 'not-a-list' })).ok,
    /**
     * ── ★★★ t25 的四个探针：吸收裁决的四态（本任务修复的字面落点）─────────────
     *
     * ★ 修复前这四格**全部**返回 `true`（四态同形、都自动成团）；
     *   修复后只有 `absorbOk` 返回 `true`，其余三格返回 `false`。
     *   ⇒ 突变 F 必须让其中**至少三格**同时翻面（见下面突变 F 的断言）。
     */
    absorbOk: fn(ctx({ upstream: { 'admission.checkpoint': CHECKPOINT_OK, 'admission.absorb': ABSORB_OK } })).ok,
    absorbBlocked: fn(ctx({ upstream: { 'admission.checkpoint': CHECKPOINT_OK, 'admission.absorb': ABSORB_BLOCKED } })).ok,
    absorbUnmeasured: fn(ctx({ upstream: { 'admission.checkpoint': CHECKPOINT_OK, 'admission.absorb': ABSORB_UNMEASURED } })).ok,
    /** ★ 键缺席：上游 absorb 压根没跑（只交 checkpoint 那一格）。 */
    absorbAbsent: fn(ctx({ upstream: { 'admission.checkpoint': CHECKPOINT_OK } })).ok,
  })

  const baseline = probe(await freshGate('mutation=baseline'))
  /**
   * ★ 基线本身必须是对的（否则下面几次突变测的不是突变，是别的东西）：
   *   四条都过要放行；每条缺一次都要拒；"没能测量"也要拒。
   */
  assert.deepEqual(
    baseline,
    {
      allPass: true,
      noArtefact: false,
      unreviewed: false,
      pending: false,
      upstreamUnmeasured: false,
      questionsAbsent: false,
      questionsMalformed: false,
      /** ★★ t25：只有 ok 态放行 —— 其余三态都必须被拒。 */
      absorbOk: true,
      absorbBlocked: false,
      absorbUnmeasured: false,
      absorbAbsent: false,
    },
    '★ 突变之前：四条都过要放行、每条缺失都要拒、各种"没能测量"也要拒 —— 否则下面测的不是突变',
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
      /**
       * ★ 而**三种"没能测量"**也必须跟着红（它们同属条件 ③ 的门口）——
       *   若某一格仍然被拒，说明那一格其实挂在别处（读错位置的出口）。
       */
      assert.equal(mutated.questionsAbsent, true, '★ 提问表缺席也必须跟着放行（同属条件 ③ 的这一格）')
      assert.equal(mutated.questionsMalformed, true, '★ 提问表形状坏也必须跟着放行')
      assert.notDeepEqual(mutated, baseline)
      assert.equal(mutated.noArtefact, false, '★ 条件 ① 不受影响')
      assert.equal(mutated.unreviewed, false, '★ 条件 ② 不受影响')
      assert.equal(mutated.upstreamUnmeasured, false, '★ 条件 ② 的"没能测量"不受影响（另一条条件的另一格）')
    },
  )

  /**
   * ── ★★ 突变 E（t13 验收单列的那一条）：把【缺席分支】改回 ok ⇒ 对应臂必须红 ──────
   *
   * 契约的验收逐字写的是：「定向突变能打红：**把缺席分支改回 ok** ⇒ 对应臂必须红」。
   * ⇒ 这一支就是那一句话的字面执行：把条件 ③ 里"缺席 ⇒ 没能测量"那一支**单独**
   *   改成"当它是空的、放行"，然后确认臂 2e（以及探针 `questionsAbsent`）**红**。
   *
   * ★ 它**必须是一条独立的突变**，不能靠突变 C 代替：C 砍的是整个条件 ③ 的门口
   *   （连"还有未回答的问题"一起放行），那种红证明不了"缺席这一支**单独**
   *   被夹具钉住了"。而本任务要修的是一个**只在缺席这一支上**的缺陷 ——
   *   一次"砍掉整条条件"的突变会在修复前**也**变红（因为 `[]` 与"有问题"都变了），
   *   于是它区分不出"修好了"与"没修好"。
   *
   * ★★ 而且这一支的形态正是**修复前盘上那个变异体**的形态（`!MUTATED` 恒假短路
   *   ⇒ 缺席与其他 `[]` 一样走放行）：它是这次事故的**回归测试**。
   *
   * ★★ MEASURED（这一支的前两版，都自己抓出来了，而它们的坏法**不一样**）：
   *
   *   第一版：把两支一起改成
   *     `if (false) {…} else if (questions.state === 'read' && pending > 0)`
   *   ⇒ 形状坏**也一起被放行**了（`pendingQuestions` 对形状坏返回的 `state` 也是
   *     `'unmeasured'`，第一支一死它就掉进最后的 `else`）⇒ 断言"形状坏不受影响"红。
   *   ★ 那条红不是判据的缺陷，是这次突变**没有单独打中缺席那一支**。
   *
   *   第二版：改成 `if (questions.state === 'unmeasured' && questions.reason !== 'absent')`
   *   ⇒ **编译不过**（TS2367）：在 `state === 'unmeasured'` 的收窄里，`reason`
   *     只可能是 `'malformed'`，那个比较被 TS 判为恒真。
   *   ★ 这条编译错误本身是**有用的读数**：它说明"按 reason 区分"必须发生在
   *     **收窄之前**，否则那个判断在类型上就是多余的 —— 而那正是"守卫检查了
   *     另一个同名的东西"的形状（守卫看着一个已经不可能的值）。
   *
   *   ⇒ 第三版（正确）：在**进入条件 ③ 之前**就把"缺席"那一格改写成
   *     "读到、空的"，其余形状原样不动。★ 这才是"把缺席分支改回 ok"的最小形态：
   *     它只动**缺席**，"形状坏"与"还有问题"都照原样走自己的支。
   */
  await withBuiltGate(
    mutate([
      [
        NEEDLES.questionsRead,
        `  const questions = ctx?.openQuestions === undefined || ctx?.openQuestions === null\n`
        + `    ? { state: 'read' as const, pending: [] as string[], reason: 'absent' as const, detail: '' } // MUTANT E: the "absent" branch is read as "no pending question" (the t13 defect)\n`
        + `    : pendingQuestions(ctx?.openQuestions)`,
        'absent branch only',
      ],
    ], 'the absent branch (t13)'),
    async () => {
      const mutated = probe(await freshGate('mutation=absent-read-as-ok'))
      /**
       * ★ 验收的字面落点：**缺席被放行了**（而它必须被拒）。
       *   这正是修复前盘上的读数（`questionsAbsent === true`）。
       */
      assert.equal(
        mutated.questionsAbsent, true,
        '★ 突变体必须把"提问表缺席"读成"没有未回答的问题" —— 臂 2e 就是靠这一条变红的',
      )
      /**
       * ★★ 而"形状坏"那一格**仍然被拒** —— 本次突变只动缺席那一支。
       *   它同时钉住两件事：
       *     ① 缺席与形状坏**真的是两支**（不是同一个守卫的两次现身）；
       *     ② 突变 E 打红的确实是**缺席**那一条臂，而不是碰巧把整条条件放行了。
       */
      assert.equal(
        mutated.questionsMalformed, false,
        '★ 形状坏那一支必须【不受本次突变影响】—— 它证明打红的是"缺席"这一条臂，不是整条条件',
      )
      assert.notDeepEqual(mutated, baseline)
      assert.equal(mutated.allPass, true, '★ 而"三条都过"仍然放行（这个突变体不是一个乱拒的实现）')
      assert.equal(mutated.pending, false, '★ "还有未回答的问题"也必须仍然被拒（它不在本次突变的范围内）')
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
   * ── ★★ 突变 F（t25 验收单列的那一条）：把【吸收裁决改回吞掉】⇒ 对应臂必须红 ──────
   *
   * 契约的验收逐字写的是：「定向突变能打红：**把吸收裁决改回吞掉** ⇒ 臂 1 必须红」。
   * ⇒ 这一支就是那句话的字面执行：把条件 ④ 的两处入口一起改回"无视 absorb"，
   *   然后确认四个吸收探针**同时翻面**（这正是修复前盘上的读数）。
   *
   * ★★ 这一支的形态**就是那个被修掉的缺陷本身**（`UPSTREAM_ABSORB` 只作回显、
   *   不进任何判定）⇒ 它同时是这次缺陷的**回归测试**：只要有人再把这一支拆掉，
   *   三个 absorb 探针会立刻同时变红。
   *
   * ★ 两根针脚必须**一起**改（见 NEEDLES 的注释）：只改一根时另一根会替它挡下
   *   同一份输入 —— 与条件 ① ③ 的实测同形。
   */
  await withBuiltGate(
    mutate([
      [
        `export function gate(ctx: ConveneContext): GateVerdict {`,
        `const ABSORB_MUTATED: boolean = true // MUTANT F: the absorption verdict is swallowed again (the t25 defect)\nexport function gate(ctx: ConveneContext): GateVerdict {`,
        'mutant F flag',
      ],
      [
        NEEDLES.absorbMissingBranch,
        `  if (!ABSORB_MUTATED && !(UPSTREAM_ABSORB in upstream)) { // MUTANT F: a missing absorb verdict is read as "absorption holds"`,
        'missing absorb branch',
      ],
      [
        NEEDLES.absorbStateRead,
        `    const absorbState = ABSORB_MUTATED ? 'ok' as const : readUpstreamState(absorbVerdict) // MUTANT F: blocked/unmeasured are swallowed`,
        'absorb state read',
      ],
    ], 'the absorption verdict (t25)'),
    async () => {
      const mutated = probe(await freshGate('mutation=absorb-swallowed'))
      /**
       * ★★ 关键断言：三个非 ok 态**必须同时翻面** —— 这正是修复前的读数
       *   （四态同形、都 `ok`、都自动成团）。
       *
       * ★ 若只有其中一两格翻面，说明这两根针脚**没有覆盖全部三态**
       *   （例如只改了 blocked 那一支）—— 那种突变体打红的是一个**更窄**的机制，
       *   而报告会读作"这条臂是恒真的"。
       */
      assert.equal(mutated.absorbBlocked, true, '★ 突变体必须放行"吸收被上游拒了" —— 臂 1f 就是靠这一条变红的')
      assert.equal(mutated.absorbUnmeasured, true, '★ 突变体必须放行"吸收没能测量" —— 臂 2i 就是靠这一条变红的')
      assert.equal(mutated.absorbAbsent, true, '★ 突变体必须放行"上游没跑" —— 臂 2j 就是靠这一条变红的')
      /**
       * ★ 而"四条都过"仍然放行：这个突变体不是一个乱拒的实现。
       */
      assert.equal(mutated.absorbOk, true, '★ ok 态仍然放行（突变体不是"一律拒绝"）')
      assert.equal(mutated.allPass, true, '★ 全健康仍然放行')
      /**
       * ★★ 反向半边（缺了它，本突变臂在"整条判据恒 ok"的实现上也会绿）：
       *   另外三条条件**必须不受影响** —— 本次突变只动吸收那一支。
       */
      assert.equal(mutated.noArtefact, false, '★ 条件 ① 不受影响')
      assert.equal(mutated.unreviewed, false, '★ 条件 ②（checkpoint）不受影响')
      assert.equal(mutated.pending, false, '★ 条件 ③ 不受影响')
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
// ★★ 污染检查：盘上【不许】留着变异体（t13 的事故就是这条缺失造成的）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 污染检查（总是运行）：src 与 lib 里都不许残留 `MUTANT` 标记 —— 交付的代码必须是判据本体', () => {
  /**
   * ── 这条臂是怎么来的（一次真实事故，t13 的根因）────────────────────────────────
   *
   * MEASURED（2026-10-06）：本文件的突变臂**原本已有**三重还原保护 ——
   * 还原放最外层、还原函数永不抛、`process.on('exit')` 兜底。而它们**全都没能**
   * 挡住这次事故，因为会话在突变进行中被**中断**了（不是测试失败、也不是正常退出：
   * 进程被直接终止，`exit` 钩子没有机会跑）。
   *
   * 后果：`QUESTIONS_MUTATED = true` 这个**变异体**被提交进了 `ad6a5b6`/`ad7a3ed`，
   * 于是交付的 `convene.ts` 里，条件 ③ 的两支被一个恒假短路挡住：
   *
   *     调用方根本没接 `open-questions.json` ⇒ 判据说"问题都答完了"
   *
   * ★ 而这件事**已经越过了一道防线**：本文件里有一条对应的臂（臂 2e，
   *   在修复时被加强为"缺席与空数组的 JSON 必须不同"），它在污染状态下**确实红了**。
   *   只是那次红被当成"突变臂失败"而没有回头查盘上的源码 ——
   *   ★ 这正是本队记账过的那种误读：**一次红的原因可能是变异体还在盘上，
   *     而不是臂本身有问题。**
   *
   * ── 这条臂为什么能挡住它 ────────────────────────────────────────────────────
   *
   * 它**不依赖任何突变是否跑过、是否还原成功**：它只读**磁盘上的字节**，
   * 而且**总是运行**（不需要 `AGENT_TEAMS_CONVENE_MUTATION=1`）。
   * ⇒ 任何残留的变异体都会让这条臂在下一次测试运行的第一时间变红，
   *   并**在红里说出"是变异体没还原"**，而不是让人去怀疑判据的语义。
   *
   * ★ 它同时检查 `lib/`：夹具读的是 `lib/`（真正会被装配层装上的那一份），
   *   所以一个"src 干净、lib 还脏"的中间态同样会骗过所有语义臂 ——
   *   而它正是"改了源码忘了 build"的形态（本队记账多次）。
   */
  const sources = { 'src/gates/admission/convene.ts': GATE_SOURCE, 'lib/gates/admission/convene.js': BUILT_GATE }
  for (const [label, path] of Object.entries(sources)) {
    assert.equal(existsSync(path), true, `★ ${label} 必须存在（否则下面这条检查是恒真的）`)
    const text = readFileSync(path, 'utf8')
    /**
     * ── ★★ 只扫【可执行代码】，不扫注释（本臂第一版就是在这里红的）───────────────
     *
     * MEASURED：第一版直接扫全文 ⇒ **当场红**，而红的位置是 `convene.ts` 文件头
     * 那段注释 —— 它正在*描述*这次事故（"检查源码里没有 `MUTANT` 标记"）。
     *
     * ★ 一个检出器**把对坏形态的说明当成坏形态**，是本队已经记过的形态
     *   （"读错位置的出口"）：它检查的位置（全文）不是它声称的位置（可执行代码）。
     *   夹具自己写下的教训必须**逐字**避开它，否则这条臂会把每一个如实记录
     *   这次事故的人都判成违规 —— 而那正是让一条好臂被人删掉的方式。
     *
     * ⇒ 口径：去掉行注释与块注释之后**再**找标记。
     *   ★ 而 `lib/` 是 tsc 编译产物：它的块注释会被保留，同样要去掉。
     */
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释（含文件头）
      .replace(/^\s*\/\/.*$/gm, '')       // 整行行注释
    /**
     * ★ 只找**变异体的标记**（`MUTANT` 是全部突变臂统一使用的记号），
     *   不扫别的词。★ 而去注释之后必须**仍有可执行代码** —— 一个把所有东西都剥掉的
     *   检出器在"一行代码都不剩"时恒绿（那正是恒真）。
     */
    assert.ok(
      code.length > text.length * 0.3,
      `★ ${label} 去注释吃掉了 ${(100 - code.length / text.length * 100).toFixed(0)}% 的文本 —— 去注释不该把可执行部分也带走`,
    )
    const marks = code.split('\n')
      .map((line, index) => ({ line, number: index + 1 }))
      .filter((entry) => entry.line.includes('MUTANT'))
    assert.deepEqual(
      marks.map((entry) => `${label}:${entry.number}`), [],
      `★ ${label} 里残留着变异体（定向突变没有还原）—— 交付的代码必须是判据本体，不是突变体。\n`
      + marks.map((entry) => `  ${entry.number}: ${entry.line.trim()}`).join('\n')
      + '\n⇒ 还原源码并重新 `pnpm build`。'
      /**
       * ★ 而且这条红必须指出**这不是判据的语义缺陷** —— 一次被误读的红会让人
       *   去改一个本来正确的判据（本队记账的"方向相反"）。
       */
      + '\n   ★ 注意：这条红说的是"盘上留着突变体"，不是"判据的语义写错了"。',
    )
  }
  /**
   * ── ★ 反向自证（缺了它，上面那条检出器可能是**恒真**的）────────────────────────
   *
   * 拿一段真的坏形态喂给它，必须命中；拿一段**只在注释里提到改动标记**的喂给它，
   * 必须放过。★ 坏形态样本用**拼接**构造，于是本文件源码里不存在那串字面量
   * —— 否则上面那条 `deepEqual` 会把样本自己当成违规（自指，本队记过同形的坑）。
   */
  const offending = `const ${'MUT'}ANT_FLAG = true`
  const explanatory = `// this comment explains the ${'MUT'}ANT_FLAG marker`
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.equal(strip(offending).includes('MUTANT'), true, '★ 检出器对一段真的变异体没有命中 —— 它是恒真的')
  assert.equal(strip(explanatory).includes('MUTANT'), false, '★ 检出器误伤了注释里对变异体的说明 —— 那是本队记过的"读错位置的出口"')
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
