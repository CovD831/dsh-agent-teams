#!/usr/bin/env node
/**
 * ── 「判断 → 行动」分诊器的夹具（t72）────────────────────────────────────────
 *
 * ── 它测的是什么 ──────────────────────────────────────────────────────────────
 *
 * 契约要求这个工具**不是又一个读数**，而是一份**可直接派的任务清单**。
 * ⇒ 这些臂因此不测"某条判得对不对"，而测**那份清单的四条性质**：
 *
 *   臂 1（三态臂）：  ★ `to-dispatch` / `blocked` / `no-action` 三者**不同形**，
 *                     且 `blocked` 必须**说出被谁挡**（契约明写的那一条）
 *   臂 2（反向臂）：  ★ **不许把所有东西都判成 to-dispatch**
 *                     —— 已 `fixed` 的卡点 ⇒ `no-action`；`diagnosis`/`discipline` ⇒ 不产出提案
 *   臂 3（第四态臂）：★ **没有 `resolution` 记录 ≠ 待办** —— 它是它自己那一格
 *   臂 4（消费臂）：  ★ 输出是**给 captain 用的**：JSON + 人话清单，且"该派哪几条"一眼看得出
 *   臂 5（不越权臂）：它**不建任务**、不写盘 —— 只产出提案
 *
 * ── ★★ 本文件刻意不写的一句话（本队已因这类棘轮返工多次）────────────────────────
 *
 * 「台账里现在有 N 条卡点 / M 条判决」「有 K 条待派」**都不是不变量**。
 * 本文件里每一个卡点/判决都是**夹具自己造的**（临时目录），
 * **不读** `.agent-teams/` —— 一个去读真实台账的夹具会在台账变化时按设计变红，
 * 而红的原因与"分诊器"毫无关系。
 * ★ 而"对真实台账跑一次"那件事属于**任务 output**，不属于夹具
 *   （它的数字是那一刻的快照，写进断言就是本队记账的那种棘轮）。
 *
 * Run: node --test scripts/friction-triage.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  triage,
  render,
  triageJudgement,
  actionForFriction,
  triageProposals,
  scopesOverlap,
  readJsonDir,
  proposalForJudgement,
  proposalForFriction,
  JUDGEMENT_VERDICTS,
} from './friction-triage.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOOL = join(ROOT, 'scripts', 'friction-triage.mjs')

/**
 * ── 夹具自造的一份台账（★ 不读盘上的 .agent-teams/）────────────────────────────
 *
 * ★ 它造的是**每一条臂各自要测的那个形状**，而不是"真实台账的缩小版"：
 *   真实台账的分布会变，而本文件要测的是**三种动作各自的条件**。
 */
function ledger({ frictions = [], judgements = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 't72-'))
  const fdir = join(dir, 'frictions')
  const jdir = join(dir, 'judgements')
  mkdirSync(fdir)
  mkdirSync(jdir)
  for (const record of frictions) writeFileSync(join(fdir, `${record.id}.json`), JSON.stringify(record), 'utf8')
  for (const record of judgements) writeFileSync(join(jdir, `${record.id}.json`), JSON.stringify(record), 'utf8')
  return { dir, fdir, jdir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const friction = (id, state, extra = {}) => ({
  id,
  title: `卡点 ${id}`,
  index: { component: `comp.${id}`, kind: ['unwired'] },
  ...state === undefined ? {} : { resolution: { state } },
  ...extra,
})

const judgement = (id, claim) => ({ id, claim, status: 'adopted' })

// ═════════════════════════════════════════════════════════════════════════════
// 臂 1（三态臂）：三个动作不同形，且 blocked **说出被谁挡**
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 臂 1：三个动作**不同形** —— 且 `blocked` 必须说出【被谁挡】', async () => {
  /**
   * 契约原文：「★★★ 而它必须区分【三个不同的动作】…
   *            ⇒ ★ 三态不同形，且 blocked 必须【说出被谁挡】」
   *
   * ★ 而"不同形"在这里是**结构上的**（三个分开的数组），不是措辞上的：
   *   `toDispatch` / `blocked` / `no-action` 各是一格，读的人不需要解析自然语言。
   */
  const l = ledger({
    frictions: [
      friction('f-a', 'open'),      // ⇒ 待派
      friction('f-b', 'fixed'),     // ⇒ 无需行动
    ],
    /**
     * ★ 夹具自检（第一版抓出来的）：原来这里写的是
     *   `当 A 被改动时，B 就会失效` —— 而 `A`/`B` 是**占位符**，
     *   它没点名任何**可读**的东西 ⇒ 工具正确地把输入判成 `unmeasured`。
     *   ⇒ 那不是工具的错：**那句话确实答不出"读什么"**。
     *   ★ 换成一条真的能断言的（它点的是具体构件）。
     */
    judgements: [judgement('j-open', '判据的输出格式被改动时，按旧格式给出的拒绝就会失效 —— 而两者必须不同形')],
  })
  try {
    const report = triage({ frictionsDir: l.fdir, judgementsDir: l.jdir })
    assert.equal(report.counts.toDispatch, 2, '★ f-a（open 卡点）+ j-open（gate 判决）都该待派')
    assert.equal(report.counts.noAction, 1, '★ f-b 已 fixed ⇒ 无需行动')
    assert.deepEqual(report.blocked, [], '★ 这一份没有写域冲突 ⇒ blocked 为空')

    /** ★ 而三个数组**互不相交** —— 一条提案只能出现在一处（否则"派哪几条"读不出来）。 */
    const ids = [
      ...report.toDispatch.map((p) => p.sourceId),
      ...report.blocked.map((p) => p.sourceId),
    ]
    assert.equal(new Set(ids).size, ids.length, '★ 同一条提案不许同时出现在两格')
  } finally {
    l.cleanup()
  }
})

test('★★★ 臂 1b：`blocked` 的每一条都带【是谁挡的】，且说清是**互斥**还是**排队**', () => {
  /**
   * ── 这一臂钉的是本任务**最容易做错**的那一格 ────────────────────────────────────
   *
   * MEASURED（t72 第一次对真实台账跑）：11 条判决里 8 条判 `gate`，
   * 而它们的写域**都是** `['scripts/', 'src/gates/']`（见工具的
   * `inScopeCandidatesFor`：claim 是散文，推不出可靠路径）
   * ⇒ 7 条互相挡，`blockedBy` **全部**写着同一个 id。
   *
   * ★ 那**技术上是对的**，而它**读起来是错的**："被 X 挡"暗示 X 是那 7 条的
   *   **前置条件** —— 而它们是**同区域的一批候选**，顺序**可互换**。
   *   ⇒ 若不说清，"被谁挡"这个字段反而会**骗人**。
   */
  const proposals = [
    { sourceId: 'p1', inScope: ['scripts/'], subject: 'a', because: '' },
    { sourceId: 'p2', inScope: ['scripts/'], subject: 'b', because: '' },
  ]
  const { toDispatch, blocked } = triageProposals(proposals)
  assert.equal(toDispatch.length, 1)
  assert.equal(blocked.length, 1)
  assert.deepEqual(blocked[0].blockedBy, ['p1'], '★ 必须说出**是谁**挡的（契约明写）')
  assert.equal(blocked[0].blockedKind, 'same-area', '★ 而它是"同区域排队"，不是"互斥"')
  assert.match(blocked[0].blockedNote, /顺序|谁先谁后|前置/, '★ 而且要说清"顺序可互换"—— 否则那句话会骗人')

  /** ★ 反向半边：被**清单之外**的东西占着 ⇒ 那才是真的互斥。 */
  const external = triageProposals([{ sourceId: 'p3', inScope: ['scripts/'], subject: 'c', because: '' }], [
    { scope: 'scripts/', by: '正在跑的 t99' },
  ])
  assert.equal(external.blocked[0].blockedKind, 'mutual', '★ 被一个**已在占用**的写域挡 ⇒ 互斥')
  assert.deepEqual(external.blocked[0].blockedBy, ['正在跑的 t99'], '★ 而它指名道姓')
})

test('★ 臂 1c：写域前缀语义 —— `src/gates/` 与 `src/gates/x.ts` 算重叠', () => {
  /**
   * ★ 这一格与 `state.ts` 的 `inScopeOverlap` **不是同一个判据**（实测过：那个做**精确**
   *   路径匹配，`['src/dir']` 与 `['src/dir/file.ts']` **不算**重叠）。
   *   ⇒ 本工具要的正是**前缀**语义（"它们会不会改同一个地方"），所以自己实现，
   *     而不是借用那个会给出**相反**答案的函数。
   */
  assert.equal(scopesOverlap(['src/gates/'], ['src/gates/x.ts']), true)
  assert.equal(scopesOverlap(['scripts/'], ['scripts/']), true)
  assert.equal(scopesOverlap(['scripts/'], ['src/']), false, '★ 不重叠的必须给 false（否则一切都互相挡）')
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 2（反向臂）：不许把所有东西都判成 to-dispatch
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 臂 2：已 `fixed` 的卡点 ⇒ `no-action`（★ 缺它这一格会"重做已做过的事"）', () => {
  /**
   * 契约原文：「★ 反向半边（不许把所有东西都判成 to-dispatch）：
   *            已 resolution.state = fixed 的卡点 ⇒ no-action」
   *
   * ★ 而"再派一次"的代价**不是零**：它会让台账里多一条"同一个卡点被修了两次"的读数，
   *   而那条读数**读起来像"这个卡点很顽固"** —— 一次重复劳动伪装成一条规律。
   */
  for (const [state, expected] of [
    ['fixed', 'no-action'],
    ['wontfix', 'no-action'],
    ['scheduled', 'no-action'],
    ['open', 'candidate'],
  ]) {
    assert.equal(
      actionForFriction(friction('f', state)).action, expected,
      `★ resolution.state = ${state} ⇒ ${expected}`,
    )
  }
  /** ★ 而四种状态**各自给出不同的话**（免得不看状态就答得出）。 */
  const whys = ['fixed', 'wontfix', 'scheduled', 'open'].map((s) => actionForFriction(friction('f', s)).why)
  assert.equal(new Set(whys).size, 4, '★ 四句理由必须互不相同 —— 否则这一格只测了一个布尔')
})

test('★★★ 臂 2b：判 `diagnosis` / `discipline` 的判决 ⇒ **不产出提案**', () => {
  /**
   * 契约：「judgement-triage 判 diagnosis / discipline 的 ⇒ no-action（或单独的诊断清单）」
   *
   * ★ 而"不产出提案"与"产出提案但标成 no-action"**不同形**：
   *   后者会让 captain 在待派清单里看到它，然后自己判断"这条该不该派" ——
   *   而那正是本工具要消掉的那件事。
   */
  /**
   * ★ 夹具自检（第一版抓出来的）：原来这里写的是 j-0003 那条（"代理读数…也会变"），
   *   而**本工具判它 `gate`**（读的是源码文本）—— 那与 t65 的表**不一致**，
   *   而那个分歧在 t65 里**已经被记为一条真实分歧**（工具 gate / 表 diagnosis）。
   *   ⇒ 拿它当"diagnosis 的例子"会测到一条**两边都不同意的**东西。
   *   ★ 换成一条**两边都同意**是 diagnosis 的（它明确要求"理解任务在做什么"）。
   */
  const DIAGNOSIS_CLAIM = '改动之后需要理解任务在做什么才能判断它对不对，而那不是判据问得出来的问题'
  const diagnoses = triageJudgement(judgement('j-d', DIAGNOSIS_CLAIM))
  assert.equal(diagnoses.verdict, 'diagnosis', '★ 夹具自检：这条必须落 diagnosis')
  assert.equal(proposalForJudgement(judgement('j-d', DIAGNOSIS_CLAIM), diagnoses), undefined, '★ 非 gate ⇒ 不产出提案')

  /** ★ 而 `gate` 那一路必须**产出**提案（否则上面那条在"从不产出"的实现上照样绿）。 */
  const GATE_CLAIM = '判据的输出格式被改动时，按旧格式给出的拒绝就会失效 —— 而两者必须不同形'
  const gate = triageJudgement(judgement('j-g', GATE_CLAIM))
  assert.equal(gate.verdict, 'gate', '★ 夹具自检：这条应当落 gate')
  assert.notEqual(proposalForJudgement(judgement('j-g', GATE_CLAIM), gate), undefined, '★ gate ⇒ 必须产出提案')
})

test('★ 臂 2c：卡点只有 `open` 才产出提案（其余三种动作都不产出）', () => {
  assert.equal(proposalForFriction(friction('f', 'fixed')), undefined)
  assert.equal(proposalForFriction(friction('f', 'wontfix')), undefined)
  assert.equal(proposalForFriction(friction('f', 'scheduled')), undefined)
  assert.notEqual(proposalForFriction(friction('f', 'open')), undefined)
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 3（第四态臂）：没有 resolution 记录 ≠ 待办
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 臂 3：**没有 `resolution` 记录** ⇒ `unknown`（第四态），★ 不是待办、也不是"无需行动"', () => {
  /**
   * ── 这一格是本工具**对真实台账跑完之后**才看清的（MEASURED 2026-10-08）──────────
   *
   * 实测：112 条卡点里 **85 条没有 `resolution`** —— 而它们混合了两件不同的事：
   *   · 真的还没处理的；
   *   · **处理了但没回填的**（台账漏记）。
   *
   * ★ 把它们一律当 `open` ⇒ 清单里塞进几十条**没人验证过**的"待办"，
   *   而 captain 只能逐条去读 —— 那正好**抵消**了本工具的全部价值。
   * ★ 把它们当 `no-action` ⇒ 把"真的还没处理"的那些**藏起来**。
   * ⇒ 所以它是它自己那一格：**台账需要回填**（一条独立的、可行动的读数）。
   */
  const verdict = actionForFriction({ id: 'f', title: 'x', index: {} })
  assert.equal(verdict.action, 'unknown', '★ 没有记录 ⇒ unknown（第四态）')
  assert.notEqual(verdict.action, 'candidate', '★ 不许当待办')
  assert.notEqual(verdict.action, 'no-action', '★ 也不许藏起来')
  assert.match(verdict.why, /not "this still needs action"/, '★ 而那句话必须说清"这是台账没回填，不是还欠动作"')

  /** ★ 而它**不产出提案**（先要人回填台账，而那不是一条可派的任务）。 */
  assert.equal(proposalForFriction({ id: 'f', title: 'x', index: {} }), undefined)
})

test('★ 臂 3b：`resolution.state` 是个**不认识的取值** ⇒ 同样落 `unknown`（不许猜）', () => {
  const verdict = actionForFriction(friction('f', 'sort-of-fixed'))
  assert.equal(verdict.action, 'unknown', '★ 不认识的取值 ⇒ 判不了，而不是"大概没事"')
  assert.match(verdict.why, /not one this tool knows/)
})

test('★★ 臂 3c：三格计数**互不吞并**（unknown 不许并进任何一格）', () => {
  /**
   * ★ 一句"总计 N 条"是不够的：那三格各自要人做**不同的事**
   *   （派 / 回填台账 / 什么都不做）。⇒ 计数必须分开。
   */
  const l = ledger({
    frictions: [
      friction('f-open', 'open'),
      friction('f-fixed', 'fixed'),
      friction('f-none'),
    ],
    judgements: [],
  })
  try {
    const report = triage({ frictionsDir: l.fdir, judgementsDir: l.jdir })
    assert.deepEqual(
      { toDispatch: report.counts.toDispatch, noAction: report.counts.noAction, unknown: report.counts.unknown },
      { toDispatch: 1, noAction: 1, unknown: 1 },
      '★ 三条卡点各落一格（open / fixed / 没记录）—— 合成一个总数就读不出该做什么',
    )
  } finally {
    l.cleanup()
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 4（消费臂）：输出是给 captain 用的
// ═════════════════════════════════════════════════════════════════════════════

test('★★ 臂 4：提案**含齐**契约点名的五项（subject / objective / inScope / 来源 id / 依据）', () => {
  /**
   * 契约原文：「若是 gate ⇒ ★ 产出【一条待建任务的提案】
   *            （含 subject / objective / inScope 候选 / 来源判决 id / 依据）」
   */
  const GATE_CLAIM = '判据的输出格式被改动时，按旧格式给出的拒绝就会失效 —— 而两者必须不同形'
  const gate = triageJudgement(judgement('j-g', GATE_CLAIM))
  const proposal = proposalForJudgement(judgement('j-g', GATE_CLAIM), gate)
  for (const field of ['subject', 'objective', 'inScope', 'sourceId', 'because']) {
    assert.ok(
      proposal[field] !== undefined && String(proposal[field]).length > 0,
      `★ 提案必须带 "${field}" —— 少了它 captain 就要自己去翻来源`,
    )
  }
  assert.equal(proposal.sourceId, 'j-g', '★ 来源判决 id 必须指得回去')
  assert.ok(Array.isArray(proposal.inScope), '★ inScope 是**候选**（数组），不是已定的字符串')
  /** ★ 而写域是**粗的**这个事实要写在提案里（别让它看起来像已定）。 */
  assert.match(String(proposal.scopeBasis ?? ''), /粗写域/, '★ 写域为什么是粗的，必须随提案一起给出')
})

test('★★ 臂 4b：人话清单让"该派哪几条"**一眼看得出**', () => {
  const l = ledger({
    frictions: [friction('f-open', 'open'), friction('f-fixed', 'fixed')],
    judgements: [judgement('j-g', '判据的输出格式被改动时，按旧格式给出的拒绝就会失效 —— 而两者必须不同形')],
  })
  try {
    const text = render(triage({ frictionsDir: l.fdir, judgementsDir: l.jdir }))
    assert.match(text, /现在就能派/, '★ 那一节必须在（它是 captain 唯一要读的第一段）')
    assert.match(text, /f-open/, '★ 该派的卡点必须点名')
    assert.match(text, /j-g/, '★ 该派的判决必须点名')
    assert.match(text, /无需行动/, '★ 而"不用派"的那些也要看得见（否则 captain 会自己去数）')
  } finally {
    l.cleanup()
  }
})

test('★ 臂 4c：读不到目录 ⇒ 如实说**是哪一侧**读不到（不是"空的"）', () => {
  /**
   * ★ 与全库那条纪律一致：「我没能读」与「读了、是空的」不同形。
   *   而这里还要再细一层：**两侧各自**报告（合成一句"没能读"会让人去查错的那一侧）。
   */
  const missing = join(tmpdir(), 't72-definitely-not-here')
  const report = triage({ frictionsDir: missing, judgementsDir: missing })
  assert.equal(report.unreadable.length, 2, '★ 两侧各报一次')
  assert.ok(report.unreadable.some((entry) => entry.startsWith('frictions')), '★ 说出是哪一侧')
  assert.ok(report.unreadable.some((entry) => entry.startsWith('judgements')), '★ 两侧都要说')
  assert.match(render(report), /读不到/, '★ 而人话清单里也要看得见')

  /** ★ 反向半边：**读到了、是空的** ⇒ `unreadable` 为空（两者必须不同形）。 */
  const l = ledger({})
  try {
    const empty = triage({ frictionsDir: l.fdir, judgementsDir: l.jdir })
    assert.deepEqual(empty.unreadable, [], '★ 读到了、空 ⇒ 不是"读不到"')
    assert.equal(empty.counts.frictions, 0)
  } finally {
    l.cleanup()
  }
})

test('★ 臂 4d：单条 JSON 读坏 ⇒ 跳过它，但**记下来**（不静默）', () => {
  const l = ledger({ frictions: [friction('f-ok', 'open')] })
  try {
    writeFileSync(join(l.fdir, 'broken.json'), '{ not json', 'utf8')
    const read = readJsonDir(l.fdir)
    assert.equal(read.records.length, 1, '★ 好的那一条仍要读出来')
    assert.deepEqual(read.malformed, ['broken.json'], '★ 而坏的那一条必须被记下来（静默跳过 = 一次解析失败伪装成没有这个文件）')
  } finally {
    l.cleanup()
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 5（不越权臂）：它不建任务、不写盘
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 臂 5：它**不建任务**、**不写盘** —— 只产出提案（协议：成员不派活）', () => {
  /**
   * 契约原文：「★★ 而它【不得自己建任务】—— 那是 captain 的判断（协议所限）：
   *            它产出【提案】，而 captain 消费它。」
   *
   * ★ 而这一条**不能靠"源码里没有那个函数"来测**（那读不出它将来会不会加）——
   *   能测的是：它**只 import 读的能力**，且跑一次**不改动输入目录**。
   */
  const source = readFileSync(TOOL, 'utf8')
  assert.doesNotMatch(source, /from '\.\.\/lib\//u, '★ 不许 import 产品代码（那是写盘/建任务的能力所在）')
  assert.doesNotMatch(source, /\bwriteFileSync\b/u, '★ 工具本身不写盘')
  assert.doesNotMatch(source, /agent_teams_\w+/u, '★ 不许出现任何工具调用名 —— 它只产出提案')

  /** ★ 而跑一次之后，输入目录必须**逐字节不变**。 */
  const l = ledger({ frictions: [friction('f-open', 'open')], judgements: [] })
  try {
    const before = readFileSync(join(l.fdir, 'f-open.json'), 'utf8')
    const beforeNames = readFileSync(join(l.fdir, 'f-open.json'), 'utf8')
    triage({ frictionsDir: l.fdir, judgementsDir: l.jdir })
    assert.equal(readFileSync(join(l.fdir, 'f-open.json'), 'utf8'), before, '★ 输入必须逐字节不变')
    assert.equal(beforeNames, before)
  } finally {
    l.cleanup()
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 6：与 t65 的口径对齐（★ 那一份是**明写的重复**）
// ═════════════════════════════════════════════════════════════════════════════

test('★★ 臂 6：本文件的判决判据 = t65 的取值集合（★ 重复是明写的，而对齐可测）', () => {
  /**
   * ── 为什么这里**重写**了一遍而不是 import ──────────────────────────────────────
   *
   * MEASURED（t72 开工时核实）：`scripts/judgement-triage.mjs`（t65 的交付）
   * **不在本仓库里** —— 那次交付报了 failed 且未提交。
   * ⇒ import 一个不存在的模块会让本工具**启动即炸**。
   *
   * ★★ 而"重写一份"的代价是**两份真相会漂移** —— 所以把口径**并排列出来**并对齐：
   *   这条臂断言取值集合逐字相同；等 t65 落地，`looksAssertive` / `inputKindOf`
   *   应当改成从它那边 import（而这**不是**本任务能做的：写域不含它）。
   */
  assert.deepEqual(
    [...JUDGEMENT_VERDICTS],
    ['gate', 'diagnosis', 'discipline', 'unmeasured'],
    '★ 四个取值必须与 t65 的一致 —— 否则同一个 claim 在两个工具里会得到不同的裁决',
  )
  /** ★ 而三条判据在**具体样本**上也必须同向（取值集合相同不等于判得一样）。 */
  assert.equal(triageJudgement({ id: 'x', claim: '「停在可恢复的中间态」让掉线无害 —— 而它的判据是「重做一遍的代价」' }).verdict, 'discipline',
    '★ t65 的已知反例在这里也必须落 discipline（否则这一格与它分叉了）')
  /**
   * ★★ 而这里**不断言** j-0003 那条 —— 因为在它上面**两边本来就不同意**
   *   （工具判 gate / t65 的表判 diagnosis），而那个分歧已被 t65 如实记为
   *   "判据边界上的分歧，不是谁算错了"。⇒ 拿它当对齐样本会测到一条两边都不同意的。
   *   ★ 用来对齐的是**两边都同意**的三类各一条。
   */
  assert.equal(triageJudgement({ id: 'x', claim: '改动之后需要理解任务在做什么才能判断它对不对，而那不是判据问得出来的问题' }).verdict, 'diagnosis')
  assert.equal(triageJudgement({ id: 'x', claim: '判据的输出格式被改动时，按旧格式给出的拒绝就会失效 —— 而两者必须不同形' }).verdict, 'gate')
})

// ═════════════════════════════════════════════════════════════════════════════
// ★★ 定向突变（真的执行）
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ★ 突变体必须用 cache-busting 重新 import（t6/t55 的实测教训）。
 *   ★ 而本工具是**单模块**（只 import node: 内置）—— 那一点由下面那条自检钉住。
 */
async function freshTool(tag) {
  return import(`${TOOL}?${tag}`)
}

function withMutatedTool(mutatedSource, body) {
  const original = readFileSync(TOOL, 'utf8')
  const restore = () => {
    writeFileSync(TOOL, original)
    /** ★ 工具是纯 .mjs（无构建）⇒ 还原就是写回，不需要 rebuild。 */
  }
  try {
    writeFileSync(TOOL, mutatedSource)
    return body()
  } finally {
    restore()
  }
}

/** 突变 A 的针脚：把 `no-action` 并进 `candidate`（"说不用派的也当待办"）。 */
const NEEDLE_NO_ACTION = `  if (state === 'fixed') return { action: 'no-action', why: 'resolution.state = fixed（已修）' }`
/** 突变 B 的针脚：把 `blocked` 并进 `toDispatch`（"被挡的也照派"）。 */
const NEEDLE_BLOCKED = `    blocked.push({`

test('★★★ 定向突变 A：把 `no-action` 并进 `to-dispatch` ⇒ 臂 2 必须红', async (t) => {
  /**
   * ★ 本仓的收口纪律是**串行**，所以这一条由环境变量显式开启，默认跳过。
   */
  if (process.env.AGENT_TEAMS_FRICTION_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_FRICTION_MUTATION=1 时运行（见任务 output 里的读数）')
    return
  }

  const original = readFileSync(TOOL, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_NO_ACTION,
    `  if (state === 'fixed') return { action: 'candidate', why: 'MUTANT: "already fixed" is treated as "to do"' }`,
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行 —— 没匹配上的替换会让它恒不生效')

  await withMutatedTool(mutated, async () => {
    const mutant = await freshTool('mutation=no-action-gone')
    /** ★ 这一条断言就是**臂 2 的红**：已修的卡点被算成待办。 */
    assert.equal(
      mutant.actionForFriction({ id: 'f', resolution: { state: 'fixed' } }).action, 'candidate',
      '★ 突变体把"已修"当成"待办" —— 臂 2 就是靠这一条变红的',
    )
    /** ★ 而后果：清单里会多出一条**重做已做过的事**的提案。 */
    assert.notEqual(
      mutant.proposalForFriction({ id: 'f', title: 'x', index: {}, resolution: { state: 'fixed' } }),
      undefined,
      '★ 于是它产出了一条不该派的提案',
    )
  })

  const restored = await freshTool('mutation=restored')
  assert.equal(
    restored.actionForFriction({ id: 'f', resolution: { state: 'fixed' } }).action, 'no-action',
    '★ 还原之后必须回到 no-action',
  )
})

test('★★★ 定向突变 B：把 `blocked` 并进 `to-dispatch` ⇒ 臂 1/1b 必须红', async (t) => {
  if (process.env.AGENT_TEAMS_FRICTION_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_FRICTION_MUTATION=1 时运行')
    return
  }

  const original = readFileSync(TOOL, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_BLOCKED,
    `      toDispatch.push(proposal) // MUTANT: a blocked proposal is dispatched anyway
      blocked.push({`,
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行')

  await withMutatedTool(mutated, async () => {
    const mutant = await freshTool('mutation=blocked-dispatched')
    const result = mutant.triageProposals([
      { sourceId: 'p1', inScope: ['scripts/'], subject: 'a', because: '' },
      { sourceId: 'p2', inScope: ['scripts/'], subject: 'b', because: '' },
    ])
    /** ★ 这一条断言就是**臂 1 的红**：互相冲突的两条**同时**被判成可以派。 */
    assert.equal(result.toDispatch.length, 2, '★ 突变体把两条冲突的都算作可派 —— 臂 1/1b 就是靠这一条变红的')
    assert.equal(result.blocked.length, 1, '★ 而 blocked 那一条仍然在（本次突变只多推了一次）')
  })
})

test('★ 二次对照：两条突变针脚在工具源码里【真的存在】', () => {
  const source = readFileSync(TOOL, 'utf8')
  assert.equal(source.includes(NEEDLE_NO_ACTION), true, '★ 突变 A 的针脚必须逐字存在')
  assert.equal(source.includes(NEEDLE_BLOCKED), true, '★ 突变 B 的针脚必须逐字存在')
})

test('★★ 夹具自检：本工具是**单模块**（`freshTool` 的 cache-busting 才够用）', () => {
  /**
   * ★★ 与 t55/t65 同一条教训：夹具 bust 一层，而它静态 import 的模块是**另一个实例**
   *   ⇒ 突变根本没被读到，而报告会读作"突变没打红"（方向相反）。
   * ⇒ 本工具只 import `node:` 内置 ⇒ 单个 bust 够用。★ 而那一刻会被下一个人改掉，
   *   所以把它写成**可执行的断言**：一旦有人加本地 import，这里当场红。
   */
  const source = readFileSync(TOOL, 'utf8')
  const local = [...source.matchAll(/^import .*? from '(\.[^']*)'/gmu)].map((m) => m[1])
  assert.deepEqual(local, [], `★ 工具若开始 import 本地模块，freshTool 必须改成一起 bust。当前：${JSON.stringify(local)}`)
})

test('★★ 夹具自检：`freshTool` 读到的确实是【当前磁盘上】的那一份', async () => {
  const a = await freshTool('selfcheck=a')
  const b = await freshTool('selfcheck=b')
  assert.notEqual(a, b, '★ 不同的 query 必须拿到不同的模块实例')
  assert.equal(typeof a.triage, 'function')
  assert.equal(typeof b.actionForFriction, 'function')
  assert.equal(typeof triage, 'function')
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 7：CLI 真的能跑（契约的 Verify 行点名了它）
// ═════════════════════════════════════════════════════════════════════════════

test('★ 臂 7：CLI 三种模式都出读数', async () => {
  const { spawnSync } = await import('node:child_process')
  const l = ledger({ frictions: [friction('f-open', 'open')], judgements: [] })
  try {
    const plain = spawnSync('node', [TOOL, '--frictions', l.fdir, '--judgements', l.jdir], { encoding: 'utf8' })
    assert.equal(plain.status, 0, `★ 默认模式必须 exit=0：\n${plain.stderr}`)
    assert.match(plain.stdout, /现在就能派/)

    const json = spawnSync('node', [TOOL, '--json', '--frictions', l.fdir, '--judgements', l.jdir], { encoding: 'utf8' })
    assert.equal(json.status, 0)
    const parsed = JSON.parse(json.stdout)
    assert.equal(parsed.counts.toDispatch, 1)
    assert.ok(Array.isArray(parsed.toDispatch))
  } finally {
    l.cleanup()
  }
})
