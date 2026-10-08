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
  /** ★ t91：自动记录与待回填的分格（含那条可见的回退）。 */
  titleRejectionOrigin,
  /** ★ t95（缺口 B）：可执行的派发指令。 */
  emitTaskContract,
  recommendAssignee,
  dispatchable,
  renderDispatchable,
  /** ★ t97：审查前移到生成那一刻。 */
  adversarialReview,
  emitReviewedContract,
  narrowScope,
  slugFromClaim,
  slugFromId,
  reviewStateOf,
  looksTautological,
  REVIEW_CHECKS,
  /** ★ t78：这三个现在从 t65 那边 re-export（臂 6 断言**同一性**）。 */
  looksAssertive,
  inputKindOf,
  SHAPE_BY_INPUT,
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
// 臂 9（★★★ t91）：自动记录 ≠ 待回填
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 臂 9：**自动记录**与「待回填」是两格 —— ★ 而它们此前被算成同一类', () => {
  /**
   * ── 这一格就是本任务的交付 ────────────────────────────────────────────────────
   *
   * MEASURED（t91 实测当前台账 203 条）：**167 条是自动记录的拒绝**，
   * 而真正需要人看的是 **9**（人记的、而没有 state）。
   * ★ 此前它们合成一格 ⇒ 报出 176 —— **一个误导的数字**：
   *   它把"不需要回填"与"还没回填"算成同一类，而两者的补救动作相反
   *   （前者什么都不用做，后者要人去补一个 state）。
   */
  const auto = actionForFriction({ id: 'f-a', title: 'update_task rejected: …', auto: { tool: 'agent_teams_update_task', point: 'completion', gate: 'completion.backtest' } })
  assert.equal(auto.action, 'auto-recorded', '★ 带 auto 的 ⇒ 单独那一格')
  assert.notEqual(auto.action, 'unknown', '★ 不许并进"待回填"')
  assert.notEqual(auto.action, 'no-action', '★ 也不许并进"无需行动"（那是"处理过了"，与"不需要处理"不同）')

  const manual = actionForFriction({ id: 'f-m', title: '夹具硬编码了行号', index: {} })
  assert.equal(manual.action, 'unknown', '★ 人记的、没有 state ⇒ 待回填')

  /** ★ 而两者的话必须**不同形**（合成一句会让读的人分不出要不要动手）。 */
  assert.notEqual(auto.why, manual.why)
  assert.match(auto.why, /不要求人回填/, '★ 自动那一格必须明说"不用人管"')
})

test('★★★ 臂 9b：反向半边 —— 自动记录**已有 resolution** 时仍按那个 resolution 走', () => {
  /**
   * 契约原文：「★ 反向半边：不许把有待处理的自动条目也一并放过 ——
   *           若某条自动记录**已经有 resolution**，它仍该按那个 resolution 走。」
   *
   * ★ 而这条的**顺序**是判据本身：先看 `state`、再看 `auto`。
   *   ⇒ 一个把顺序反过来的实现在下面第二条上会答 `auto-recorded`
   *     ⇒ **漏掉一条真的待办**。
   */
  const autoFixed = { id: 'f', title: 'update_task rejected: …', auto: { tool: 't', point: 'completion' }, resolution: { state: 'fixed' } }
  assert.equal(actionForFriction(autoFixed).action, 'no-action', '★ 自动 + fixed ⇒ 按 fixed 走（已修）')

  const autoOpen = { id: 'f', title: 'update_task rejected: …', auto: { tool: 't', point: 'completion' }, resolution: { state: 'open' } }
  assert.equal(
    actionForFriction(autoOpen).action, 'candidate',
    '★★ 自动 + open ⇒ **仍然是一条待办** —— 顺序反过来会让它被放过（漏掉一条真的待办）',
  )
})

test('★★★ 臂 9c：`auto` 那格的**向后兼容**回退 —— 而它必须**可见**', () => {
  /**
   * MEASURED（t91）：`auto` 字段是本轮才加的，而台账里现存的 167 条自动记录
   * **写于它之前** ⇒ 若只看新字段，本修复对已有台账**完全无效**（那个数字仍是 176）。
   *
   * ★ 所以有一条**明写的回退**（title 前缀 `<tool> rejected`）。
   *   ★★ 而它是一条**代理读数**（j-0003：代理读数在它所代理的东西没变时也会变）——
   *      所以命中的条目**带标记**（`via: 'title-fallback'`），而我们能读到"还有多少条在吃回退"。
   */
  const legacy = { id: 'f-old', title: 'update_task rejected: [completion.backtest] …', resolution: { blocking: false } }
  const verdict = actionForFriction(legacy)
  assert.equal(verdict.action, 'auto-recorded', '★ 老记录也要落那一格（否则本修复对已有台账无效）')
  assert.equal(verdict.via, 'title-fallback', '★★ 而它必须**标出来**是回退认的 —— 否则那段回退什么时候能删就无从知道')
  assert.match(verdict.why, /title 前缀/, '★ 理由里要说清它是怎么认出来的')

  /** ★ 反向半边：**人工**的标题不该被认成自动的（否则方向反过来的同一个误导）。 */
  assert.equal(
    actionForFriction({ id: 'f-m', title: '夹具硬编码了行号', index: {} }).action, 'unknown',
    '★ 一条人工记录不许被回退认成自动 —— 那会让"真的需要人看"被藏起来',
  )
  /** ★ 而**窄名单**：一个恰好以 `foo rejected` 开头的标题不该被认。 */
  assert.equal(titleRejectionOrigin({ title: 'foo rejected: whatever' }), undefined)
  assert.equal(titleRejectionOrigin({ title: 'update_task rejected: x' }), 'update_task')
})

test('★★ 臂 9d：那两格**分开计数**（合成一个数字正是本任务要消掉的）', () => {
  const l = ledger({
    frictions: [
      { ...friction('f-auto', undefined), title: 'update_task rejected: x' },
      { ...friction('f-manual', undefined), title: '人记的一条' },
      friction('f-fixed', 'fixed'),
    ],
    judgements: [],
  })
  try {
    const report = triage({ frictionsDir: l.fdir, judgementsDir: l.jdir })
    assert.equal(report.counts.autoRecorded, 1, '★ 自动那一格')
    assert.equal(report.counts.unknown, 1, '★ 待回填那一格')
    assert.equal(report.counts.noAction, 1)
    /** ★ 而人话清单里两个数字都要看得见（合成一句会让读的人以为 176 条都等着他）。 */
    const text = render(report)
    assert.match(text, /台账待回填 1/, '★ 待回填那个数字必须在')
    assert.match(text, /自动记录 1/, '★ 而自动那一格也必须单列')
  } finally {
    l.cleanup()
  }
})

test('★★ 臂 9e：自动条目的**内容一个字都不少**（只是不再要求人回填）', async () => {
  /**
   * 契约原文：「★★ 而它必须保住：自动条目的内容不能丢 —— 它们仍要能在 HTML 里读、
   *            仍要能被判据扫。只是它们不再要求人给一个 resolution。」
   *
   * ★ 所以本任务是**加一格**（`auto`），**没有**动 `resolution` / `message` / `context`。
   *   ⇒ 这一臂断言：自动记录**仍然**有 `resolution`（"当时还没修"是事实）、
   *     仍然有 `title`，只是被分诊器**换了一格**读。
   */
  const record = { id: 'f', title: 'update_task rejected: [completion.backtest] x', resolution: { blocking: false, fix: 'unfixed: recorded at the moment it happened' }, observed: { verdict: { ok: false } } }
  assert.equal(record.resolution.state, undefined, '★ 夹具自检：老的自动记录确实没有 state')
  assert.equal(actionForFriction(record).action, 'auto-recorded')
  /** ★ 而记录本身**没有被工具改动**（它是纯读的）—— 内容照旧可读。 */
  assert.equal(record.title, 'update_task rejected: [completion.backtest] x')
  assert.notEqual(record.resolution, undefined, '★ 那一格没有被删（删了会让"当时还没修"这个事实消失）')
})

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
  /**
   * ── ★★★ t95：这一条原来是 `doesNotMatch(source, /agent_teams_\w+/)` ─────────────
   *
   * 它的**意图**是"它不调用任何工具，只产出提案"。而 t95 之后这个工具**打印**
   * 建议的调用（`agent_teams_create_task({…})` 那一行是**给人看/给 captain 复制**的），
   * ⇒ 那条宽断言把"提到那个名字"与"调用那个工具"**合成了一件事**。
   *
   * ★ 而它是本队记账过的那种错：**断言检查的是名字，而不是那件事。**
   *   （"守卫检查了另一个同名的东西"）
   *
   * ── 修法：断言**真的性质**（三条，各自可核）────────────────────────────────────
   *   ① 不 import 任何**能建任务/写盘**的东西（产品代码）
   *   ② 不 import 工具的注册面（`@deepseek-ai/dsh-tools` 之类）
   *   ③ 出现 `agent_teams_*` 的地方**必须是字符串或注释**，不是调用
   */
  assert.doesNotMatch(source, /from '@[\w/-]+'/u, '★ 不许 import 工具 SDK —— 那才有注册/调用能力')
  /** ★ ③ 逐行核：含 `agent_teams_` 的行必须是**注释或模板字符串**，不是可执行的调用。 */
  const offending = source.split('\n')
    .map((line, index) => ({ line: line.trim(), index: index + 1 }))
    .filter((entry) => /agent_teams_\w+/u.test(entry.line))
    .filter((entry) => !/^(\*|\/\/|\/\*)/u.test(entry.line))
    .filter((entry) => !/`/u.test(entry.line) && !/'/u.test(entry.line) && !/"/u.test(entry.line))
  assert.deepEqual(
    offending, [],
    '★ 含 `agent_teams_*` 的行必须落在**注释或字符串**里 —— 一个真的调用会让它出现在代码里：'
    + JSON.stringify(offending),
  )

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

test('★★★ 臂 6：判决判据**就是** judgement-triage 的那一个实现（★ 同一性，不是"取值碰巧相同"）', async () => {
  /**
   * ── ★★★ t78：这条臂从"对拍两份实现"换成"证明**只有一份**" ──────────────────────
   *
   * t72 时它是这么写的（逐字保留）：
   *   「MEASURED（t72 开工时核实）：`judgement-triage.mjs`（t65 的交付）**不在本仓库里**
   *     ⇒ import 一个不存在的模块会让本工具**启动即炸**。
   *     ★★ 而"重写一份"的代价是**两份真相会漂移** —— 所以把口径并排列出来并对齐。」
   *
   * ⇒ ★ 那个前提在 5d91625 满足了 ⇒ 本文件现在是 **re-export**，而不是第二份实现。
   *
   * ── ★★ 为什么"同一性"比"取值一致"强一级 ──────────────────────────────────────
   *
   *   旧的那条臂：断言两边的**取值**一致 ⇒ 两份实现可以**碰巧**一致，也可以各自漂移
   *              （而漂移只会在某天某条 claim 上现形）
   *   新的那条臂：断言 `===` ⇒ **漂移在结构上不可能** —— 因为没有第二份
   */
  const upstream = await import('./judgement-triage.mjs')
  assert.equal(
    triageJudgement, upstream.triage,
    '★ 本文件导出的必须**就是** judgement-triage 的那个函数对象 —— '
    + '一旦有人把它改回本地实现，这一条立刻红（那正是本臂要测的"出处"）',
  )
  assert.equal(looksAssertive, upstream.looksAssertive, '★ looksAssertive 同理')
  assert.equal(inputKindOf, upstream.inputKindOf, '★ inputKindOf 同理')
  assert.equal(SHAPE_BY_INPUT, upstream.SHAPE_BY_INPUT, '★ 形状表同理（同一个对象，不是一份副本）')
  /** ★ 取值集合也同一性对齐（而**不是**手抄一份去比 —— 那又会变成两份真相）。 */
  assert.equal(JUDGEMENT_VERDICTS, upstream.VERDICTS, '★ 四个取值必须是**同一个**冻结数组')

  /**
   * ★★ 而三条判据在**具体样本**上仍然要断言（同一性只保证"不漂移"，
   *   不保证"这些样本的答案是我们要的"）。
   */
  assert.equal(triageJudgement({ id: 'x', claim: '「停在可恢复的中间态」让掉线无害 —— 而它的判据是「重做一遍的代价」' }).verdict, 'discipline',
    '★ t65 的已知反例必须落 discipline')
  assert.equal(triageJudgement({ id: 'x', claim: '改动之后需要理解任务在做什么才能判断它对不对，而那不是判据问得出来的问题' }).verdict, 'diagnosis')
  assert.equal(triageJudgement({ id: 'x', claim: '判据的输出格式被改动时，按旧格式给出的拒绝就会失效 —— 而两者必须不同形' }).verdict, 'gate')

  /** ★★★ 而 j-0003 那条分歧现在**变成了同一份实现的内部一致性** —— 那正是它该有的结果。 */
  assert.equal(
    triageJudgement({ id: 'j-0003', claim: '「代理读数在它所代理的东西没变时也会变」' }).verdict,
    upstream.triage({ id: 'j-0003', claim: '「代理读数在它所代理的东西没变时也会变」' }).verdict,
    '★ 同一个 claim 不可能得到两个答案 —— 而那正是 t72 那条"刻意不对拍"的分歧的归宿',
  )
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 8（三态臂）：模块在 / 模块缺 / 判不了 —— ★ 三者不许合并
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 臂 8：模块**移走**时给出可读的失败 —— ★ 而不是静默地降级成"判不了"', async () => {
  /**
   * ── 契约原文：「★ 三态不同形：import 成功 / import 失败（模块缺）时的行为 /
   *              无法判断 ⇒ 三者不得合并（现在若 import 一个不存在的模块会直接崩）」
   *
   * ── ★★★ 而这里要做一个**判断**，它本身就是本任务的交付之一 ──────────────────────
   *
   * 一个"模块缺 ⇒ 静默降级成 `unmeasured`"的实现**看起来更稳**，而它是**错的**：
   * 它会把"**这个模块还没落地**"（一次真实的安装/合并缺陷）与
   * "**这一条 claim 判不了**"（一个正常的第四态）**合成同一种读数** ——
   * 而两者的补救动作**相反**：一个去补模块，一个去改 claim。
   *
   * ★ 那正是本队记账的形态：**把基础设施工况伪装成关于数据的结论。**
   *
   * ⇒ 所以三态是这么分的，而三者各自**可读**：
   *
   *     loaded    —— 正常：照常判
   *     absent    —— ★ **明确的失败**（ESM 解析器给的 `ERR_MODULE_NOT_FOUND`，带文件名）
   *     （没有第三态）—— 为什么没有：本文件**不猜**模块在不在，所以
   *                       "我判不了"这件事在**模块这一层**上不存在
   *
   * ★ 而这条臂**真的把模块移走**再跑（不是 mock）—— 否则它测的是"我 mock 得对不对"。
   */
  const { spawnSync } = await import('node:child_process')
  const { renameSync } = await import('node:fs')
  const upstream = join(ROOT, 'scripts', 'judgement-triage.mjs')
  const parked = join(ROOT, 'scripts', 'judgement-triage.mjs.t78-parked')
  const l = ledger({ frictions: [], judgements: [] })
  let moved = false
  try {
    renameSync(upstream, parked)
    moved = true
    const run = spawnSync('node', [TOOL, '--frictions', l.fdir, '--judgements', l.jdir], { encoding: 'utf8' })
    assert.notEqual(run.status, 0, '★ 模块缺 ⇒ 必须**失败**，不许静默地出一个"都判不了"的清单')
    assert.match(
      `${run.stderr}${run.stdout}`,
      /judgement-triage\.mjs|ERR_MODULE_NOT_FOUND/u,
      '★ 而失败必须**指出是哪个模块** —— 否则读的人不知道去补什么',
    )
  } finally {
    if (moved) renameSync(parked, upstream)
    l.cleanup()
  }
})

test('★★ 臂 8b：模块**在**的时候，三态里的 `loaded` 那一态是可读的（而不是靠"没崩"推出来）', async () => {
  /**
   * ★ 反向半边：上面那条臂只证明了"缺的时候会失败" ——
   *   一个**恒失败**的实现（比如 import 写错路径）在那条臂上照样绿。
   * ⇒ 所以这一条断言"在的时候它真的工作"：跑一次并拿到正常的四格计数。
   */
  const { spawnSync } = await import('node:child_process')
  const l = ledger({ frictions: [friction('f-open', 'open')], judgements: [] })
  try {
    const run = spawnSync('node', [TOOL, '--json', '--frictions', l.fdir, '--judgements', l.jdir], { encoding: 'utf8' })
    assert.equal(run.status, 0, `★ 模块在 ⇒ 必须能跑：\n${run.stderr}`)
    assert.equal(JSON.parse(run.stdout).counts.toDispatch, 1)
  } finally {
    l.cleanup()
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// ★★ 定向突变（真的执行）
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ★ 突变体必须用 cache-busting 重新 import（t6/t55 的实测教训）。
 *   ★ 而本工具是**单模块**（只 import node: 内置）—— 那一点由下面那条自检钉住。
 */
async function freshTool(tag) {
  /**
   * ── ★★★ t78：bust 必须**跟着依赖走**（那条自检就是为这一刻写的）────────────────
   *
   * MEASURED（t78）：t72 时本工具只 import `node:` 内置 ⇒ `import(TOOL + '?tag')`
   * 一层就够。而 t78 把三条判断改成了 `import './judgement-triage.mjs'` ——
   * ★ 于是那个**裸路径**与夹具用 `?tag` 拿到的那一份是**两个模块实例**。
   *
   * ★ 而那正是本队记账过的坑（t55 同型：夹具只 bust 了 `state.js`，
   *   而它静态 import 的 `types.js` 是裸路径 ⇒ 突变根本没被读到，
   *   而报告会读作"突变没打红"——**方向恰好相反**）。
   *
   * ⇒ 修法：**带上那个依赖的 query**，让被 import 的那一份也是新的。
   *   ★ 而这条自检（"本工具是单模块"）当时写下来就是为了在这一刻红 —— 它真的红了。
   */
  return import(`${TOOL}?${tag}&dep=judgement-triage`)
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
/** ★★★ 突变 C 的针脚（t91）：把**自动记录**并进待回填（= 本任务修之前的样子）。 */
const NEEDLE_AUTO_SPLIT = `  const titleFallback = titleRejectionOrigin(record)`
/** ★★★ 突变 D 的针脚（t95）：把 **blocked** 也算进 dispatchable。 */
const NEEDLE_DISPATCHABLE = `  for (const proposal of report?.toDispatch ?? []) {`
/** ★★★ 突变 E 的针脚（t97）：把**审不过的**也盖上 reviewed。 */
const NEEDLE_REVIEW_OUTCOME = `  const outcome = failed.length > 0 ? 'rejected' : unmeasured.length > 0 ? 'needs-review' : 'passed'`

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

test('★★ 夹具自检：`freshTool` 的 bust 覆盖了工具的**全部本地依赖**', () => {
  /**
   * ── ★★★ t78：这条自检原来的口径是"本工具是单模块"，而它**当场红了** ────────────
   *
   * 原文（逐字保留）：
   *   「本工具只 import `node:` 内置 ⇒ 单个 bust 够用。★ 而那一刻会被下一个人改掉，
   *     所以把它写成**可执行的断言**：一旦有人加本地 import，这里当场红。」
   *
   * ⇒ ★ 它**按设计红了**（t78 加了 `import './judgement-triage.mjs'`），
   *   而那正是它存在的意义：它在"突变静默地测旧代码"**之前**就响了。
   *
   * ── 而新的口径不是"没有本地依赖"（那已经假了），而是**bust 覆盖了它们** ────────
   *
   * ★ 断言两件事：
   *   ① 工具**确实**有本地依赖了（否则这条自检会在有人把 import 删掉时静默地失去意义）
   *   ② `freshTool` 的 query **提到了每一个**本地依赖的模块名
   *      ⇒ 一个"加了 import 却忘了改 bust"的改动会让 ② 当场红
   */
  const toolSource = readFileSync(TOOL, 'utf8')
  const deps = [...toolSource.matchAll(/^import .*? from '(\.\/[^']*)'/gmu)].map((m) => m[1])
  assert.ok(deps.length > 0, '★ t78 之后本工具**有**本地依赖了 —— 若这里为空，说明有人把它删了（那本条自检要跟着改回去）')

  const helperSource = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const bust = /import\(`\$\{TOOL\}\?\$\{tag\}([^`]*)`\)/u.exec(helperSource)
  assert.ok(bust !== null, '★ `freshTool` 必须仍然用 `?tag` 的形式 bust（找不到说明它被重写了）')
  for (const dep of deps) {
    const name = dep.replace(/^\.\//u, '').replace(/\.mjs$/u, '')
    assert.ok(
      bust[1].includes(name),
      `★ \`freshTool\` 的 bust query 里**没有提到**依赖 "${dep}" ⇒ 突变会静默地测旧代码（t55 的实测形态）。`
      + `当前 query 尾部：${JSON.stringify(bust[1])}`,
    )
  }
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

test('★★★ 定向突变 C：把「自动记录」并回「待回填」⇒ 臂 9 必须红', async (t) => {
  /**
   * ── 这就是本任务修之前的样子 ─────────────────────────────────────────────────
   *
   * ★ 把那条回退去掉 ⇒ 老记录落回 `unknown` ⇒ 那个数字从 9 涨回 176。
   *   ★ 而这正是本任务要消掉的那个误导。
   */
  if (process.env.AGENT_TEAMS_FRICTION_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_FRICTION_MUTATION=1 时运行')
    return
  }

  const original = readFileSync(TOOL, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_AUTO_SPLIT,
    `  const titleFallback = undefined // MUTANT: auto records fall back into "needs backfill"
  void titleRejectionOrigin`,
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行')

  await withMutatedTool(mutated, async () => {
    const mutant = await freshTool('mutation=auto-merged-back')
    /** ★ 这一条断言就是**臂 9 的红**：老记录（只有 title 前缀）不再被分出去。 */
    assert.equal(
      mutant.actionForFriction({ id: 'f-old', title: 'update_task rejected: x', resolution: {} }).action,
      'unknown',
      '★ 去掉回退之后自动记录落回"待回填" —— 臂 9/9c 就是靠这一条变红的',
    )
    /** ★ 而后果：那个数字涨回去。 */
    assert.notEqual(
      mutant.triage({ frictionsDir: '/nonexistent', judgementsDir: '/nonexistent' }).counts.autoRecorded,
      undefined,
    )
  })

  const restored = await freshTool('mutation=restored-auto')
  assert.equal(
    restored.actionForFriction({ id: 'f-old', title: 'update_task rejected: x', resolution: {} }).action,
    'auto-recorded',
    '★ 还原之后必须回到 auto-recorded',
  )
})

test('★★ 二次对照（t91）：突变 C 的针脚在源码里真的存在', () => {
  assert.equal(readFileSync(TOOL, 'utf8').includes(NEEDLE_AUTO_SPLIT), true, '★ 突变 C 的针脚必须逐字存在')
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 10（★★★ t95 / 缺口 B）：从"它说值得做"到"有人能立刻开始做"
// ═════════════════════════════════════════════════════════════════════════════

/** 一份**完整**的提案（可执行的那一种）。 */
const executableProposal = (extra = {}) => ({
  source: 'judgement', sourceId: 'j-x', kind: 'implementation',
  subject: '判据：某事必须不同形', objective: '那条判据要能对某个输入返回真/假',
  inScope: ['scripts/', 'src/gates/'], acceptance: ['★ 它必须能红'], verify: ['pnpm test:gates'],
  because: 'judgement-triage 判它 gate',
  ...extra,
})

const team = (members, tasks = []) => ({ members, tasks, unreadable: undefined })

test('★★★ 臂 10：`emitTaskContract` 产出的契约**含齐** `create_task` 的必填项', () => {
  /**
   * ── 而"含齐"是**对着 create_task 的 schema** 说的，不是我觉得够了 ────────────────
   *
   * MEASURED（从 `src/tools/create-task.ts` 读的）：`subject` 必填；
   * 质量类要 `objective` + `acceptance`；`implementation`/`repair` 要 `verify`。
   */
  const emitted = emitTaskContract(executableProposal(), team([{ name: 'a', status: 'idle' }]))
  assert.equal(emitted.status, 'executable')
  const c = emitted.contract
  for (const field of ['subject', 'kind', 'objective', 'inScope', 'acceptance', 'verify']) {
    assert.ok(c[field] !== undefined && String(c[field]).length > 0, `★ 契约必须带 "${field}"`)
  }
  /** ★ 而 `lib/` 必须进 outOfScope（本队口径：它由 build 生成）。 */
  assert.deepEqual(c.outOfScope, ['lib/',], '★ 声明了 src/ ⇒ 必须同时声明不许手改 lib/')
})

test('★★★ 臂 10b：**契约生成不出来**是第三态 —— ★ 附"缺什么"，且与"被挡"不同形', () => {
  /**
   * 契约原文：「★ 三态不同形：可派 / 不可派（附被谁挡）/ **无法生成契约**（附缺什么）」
   *
   * ★ 而"缺什么"必须**逐项列出来**：一句"信息不足"会让读的人再来问一次，
   *   而那正是本任务要消掉的那一步。
   */
  const noAcceptance = emitTaskContract(executableProposal({ acceptance: [] }), team([{ name: 'a', status: 'idle' }]))
  assert.equal(noAcceptance.status, 'cannot-emit', '★ 缺必填项 ⇒ 第三态')
  assert.notEqual(noAcceptance.status, 'blocked', '★ 它与"被写域挡"不同形')
  assert.ok(
    noAcceptance.missing.some((item) => item.includes('acceptance')),
    '★ 必须**指名**缺的是哪一项',
  )
  /** ★ 而一个认不出的 kind ⇒ 确切地说出来（不猜一个）。 */
  const weirdKind = emitTaskContract(executableProposal({ kind: 'nonsense' }), team([{ name: 'a', status: 'idle' }]))
  assert.equal(weirdKind.status, 'cannot-emit')
  assert.ok(weirdKind.missing.some((item) => item.includes('kind')), '★ 说出是 kind 那一项')
})

test('★★★ 臂 10c：派工建议**带可核的理由** —— 而且理由是「既往写域重叠」那个事实', () => {
  /**
   * 契约原文：「★★★ 而派工建议必须给出【可核的理由】：为什么是这个成员
   *            （专长匹配？上下文在手？而不是「随便一个空闲的」）…
   *            ⇒ 不给理由的建议，与一条「请自己挑」在观测上同形。」
   */
  const picked = recommendAssignee(executableProposal(), team(
    [{ name: 'expert', status: 'idle' }, { name: 'other', status: 'idle' }],
    [
      { id: 't1', assignee: 'expert', inScope: ['scripts/gate-x.test.mjs'] },
      { id: 't2', assignee: 'other', inScope: ['docs/README.md'] },
    ],
  ))
  assert.equal(picked.member, 'expert', '★ 履历碰得上写域的那个')
  assert.equal(picked.groundedInTrackRecord, true, '★ 而"碰得上"这件事必须是个**读数**')
  assert.ok(picked.reasons.some((r) => /履历重叠/u.test(r)), '★ 理由要说清"凭什么是他"')
  /** ★ 而"为什么不给别人"也必须在 —— 只给结论的话读的人要自己去比。 */
  assert.equal(picked.whyNot.other !== undefined, true, '★ 要说清**为什么不是别人**')
  assert.ok(picked.reasons.some((r) => /为什么是现在/u.test(r)), '★ 以及"为什么现在"')
})

test('★★★ 臂 10d：**匹配不上时不硬凑** —— 如实说"那只是谁空闲，不是谁擅长"', () => {
  /**
   * ★ 而这一格是契约点名要避免的那个东西：「随便一个空闲的」。
   *   一个"总能挑出一个人"的实现在臂 10c 上完全绿 —— 而它在没人匹配时**会撒谎**。
   */
  const picked = recommendAssignee(executableProposal(), team(
    [{ name: 'a', status: 'idle' }],
    [{ id: 't1', assignee: 'a', inScope: ['docs/完全不相干.md'] }],
  ))
  assert.equal(picked.groundedInTrackRecord, false, '★ 履历碰不上 ⇒ 那个读数必须是 false')
  assert.ok(
    picked.reasons.some((r) => /没有谁的既往写域碰得上/u.test(r)),
    '★★ 必须**说出来** —— 否则那条建议读起来像"他擅长它"，而它其实只是"他闲着"',
  )
})

test('★★★ 臂 10e：团队读不到 ≠ 没人空闲（★ 三态不同形）', () => {
  /**
   * ★ MEASURED（t95 第一版）：团队读不到时我原来答的是"没有空闲成员（0 人…）"——
   *   那把它伪装成了"我看了，确实没人"，而事实是**我没能看**。
   * ★ 两者的补救动作相反：一个等腾出来，一个去修那格读数。
   */
  const blind = recommendAssignee(executableProposal(), { members: [], tasks: [], unreadable: '团队状态读不到（/x）' })
  assert.equal(blind.unreadable, true)
  assert.ok(blind.reasons.some((r) => /我没能读到团队状态/u.test(r)), '★ 要说清"我没能看"')
  assert.ok(
    !blind.reasons.some((r) => /没有空闲成员/u.test(r)),
    '★★ 不许把它说成"没人空闲" —— 那正是"把基础设施工况伪装成关于数据的结论"',
  )

  /** ★ 而"读到了、里面没有成员"是**第三格**（与上面两格都不同形）。 */
  const empty = recommendAssignee(executableProposal(), team([]))
  assert.equal(empty.unreadable, undefined)
  assert.ok(empty.reasons.some((r) => /没有成员/u.test(r)), '★ 读到了、空的 ⇒ 说"没有成员"')

  /** ★ 而"读到了、都忙"是我最初那一格。 */
  const allBusy = recommendAssignee(executableProposal(), team([{ name: 'a', status: 'working' }]))
  assert.ok(allBusy.reasons.some((r) => /没有空闲成员/u.test(r)), '★ 都忙 ⇒ 说"没有空闲成员"')
})

test('★★★ 臂 10f：反向半边 —— `dispatchable` **只**收 to-dispatch（不许混进 blocked / no-action）', () => {
  /**
   * 契约原文：「★ 反向半边：不许把 blocked 的算进 dispatchable；
   *            不许把 no-action 的算进去。」
   *
   * ★ 而这条臂与 t72 的臂 1/1b 是**同一族**（那条测"blocked 不许并进 toDispatch"）——
   *   这一条测它的下游：即使 toDispatch 那一格是对的，`dispatchable` 也不许**自己**
   *   再去读别的格。
   */
  const report = {
    toDispatch: [executableProposal({ sourceId: 'ok' })],
    blocked: [executableProposal({ sourceId: 'blocked-1' })],
    noAction: [{ id: 'na-1' }],
    autoRecorded: [],
    unknown: [],
  }
  const result = dispatchable(report, team([{ name: 'a', status: 'idle' }]))
  assert.deepEqual(result.ready.map((entry) => entry.sourceId), ['ok'], '★ 只收 to-dispatch')
  assert.equal(result.blockedCount, 1, '★ 而 blocked 只作为**计数**出现，不作为可派项')
  /** ★ 而人话输出里不许出现那条被挡的 id 作为"可建"。 */
  const text = renderDispatchable(result)
  assert.doesNotMatch(text.split('契约生成不出来')[0], /blocked-1/u, '★ 被挡的不许出现在"现在就能建"那一段')
})

test('★★ 臂 10g：`--dispatchable` 的人话输出**一句话就能照做**', () => {
  const result = dispatchable(
    { toDispatch: [executableProposal()], blocked: [], noAction: [], autoRecorded: [], unknown: [] },
    team([{ name: 'a', status: 'idle' }], [{ id: 't1', assignee: 'a', inScope: ['scripts/'] }]),
  )
  const text = renderDispatchable(result)
  /** ★ 它必须给出一行**可复制的调用**（那是"可执行"的字面意思）。 */
  assert.match(text, /agent_teams_create_task\(/u, '★ 要给出可直接照抄的调用')
  assert.match(text, /assignee   : a/u, '★ 以及指派给谁')
  assert.match(text, /理由：/u, '★ 以及理由')
})

test('★★★ 定向突变 D（t95）：把 **blocked** 也算进 `dispatchable` ⇒ 臂 10f 必须红', async (t) => {
  /**
   * 契约原文：「★ 定向突变能打红：把一条 blocked 的算进 dispatchable ⇒ 臂红
   *            （那正是 t72 已有的臂 1/1b，保住它们）。」
   *
   * ★ 而那正是用户裁定"写域冲突就先别派"要避免的东西 ——
   *   派出去的两条会改同一片文件。
   */
  if (process.env.AGENT_TEAMS_FRICTION_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_FRICTION_MUTATION=1 时运行')
    return
  }

  const original = readFileSync(TOOL, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_DISPATCHABLE,
    `  for (const proposal of [...(report?.toDispatch ?? []), ...(report?.blocked ?? [])]) { // MUTANT: blocked is dispatched too`,
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行')

  await withMutatedTool(mutated, async () => {
    const mutant = await freshTool('mutation=t95-blocked-dispatched')
    const result = mutant.dispatchable({
      toDispatch: [{ sourceId: 'ok', subject: 's', objective: 'o', kind: 'implementation', inScope: ['scripts/'], acceptance: ['a'], verify: ['v'] }],
      blocked: [{ sourceId: 'blocked-1', subject: 's2', objective: 'o2', kind: 'implementation', inScope: ['scripts/'], acceptance: ['a'], verify: ['v'] }],
    }, { members: [{ name: 'a', status: 'idle' }], tasks: [] })
    /** ★ 这一条断言就是**臂 10f 的红**。 */
    assert.deepEqual(
      result.ready.map((entry) => entry.sourceId).sort(), ['blocked-1', 'ok'],
      '★ 突变体把被挡的也列进"现在就能建" —— 臂 10f 就是靠这一条变红的',
    )
  })

  const restored = await freshTool('mutation=t95-restored-dispatchable')
  /**
   * ★★ MEASURED（t97）：这一份夹具原先是 `kind:'work'` + 没有 acceptance。
   *   而 t97 之后 `dispatchable` 走**带审查**的那条路 ⇒ 缺 acceptance 那一问落 `fail`
   *   ⇒ 它连 `ready` 都进不去（`rejected`）。
   *   ★ 而那是**对的**（"没有 acceptance ⇒ 建出去也没人判它做没做对"），
   *     不是本突变要测的东西 ⇒ 夹具补上 acceptance。
   */
  const withAcceptance = (id) => ({
    sourceId: id, subject: 's', objective: 'o', kind: 'implementation',
    inScope: ['scripts/gate-j-0001.test.mjs', 'src/gates/index.ts'],
    acceptance: ['★ 它必须能对某个输入返回真/假'], verify: ['pnpm test:gates'],
  })
  assert.deepEqual(
    restored.dispatchable({
      toDispatch: [withAcceptance('ok')],
      blocked: [withAcceptance('blocked-1')],
    }, { members: [{ name: 'a', status: 'idle' }], tasks: [] }).ready.map((e) => e.sourceId),
    ['ok'],
    '★ 还原之后只剩 to-dispatch 那一条',
  )
})

test('★★ 二次对照（t95）：突变 D 的针脚在源码里真的存在', () => {
  assert.equal(readFileSync(TOOL, 'utf8').includes(NEEDLE_DISPATCHABLE), true, '★ 突变 D 的针脚必须逐字存在')
})

test('★★★ 夹具自检（t95）：每一条突变臂用的 tag **必须唯一**', () => {
  /**
   * ── ★★★ MEASURED（t95，全跑时才现形）─────────────────────────────────────────
   *
   * 我新加的突变 D 用了 `'mutation=blocked-dispatched'` —— 而 t72 的突变 B **同名**。
   * ⇒ Node 按 URL 缓存模块 ⇒ **D 拿到的是 B 加载过的那一份**（一个 t72 时代的实现）
   * ⇒ D 的断言读到 `['ok']` 而不是 `['blocked-1','ok']` ⇒ **这条突变臂假红**
   *   （而它在**单跑**时是绿的 —— 因为那时没有别人先加载过那个 tag）。
   *
   * ★★ 而那正是本队记账过的形态的近亲：**假面替真实路径挡了路** ——
   *   这里"挡路"的是**缓存里那个装对了的旧模块**。
   * ★ 而它特别阴：它只在**全跑**时红，于是读的人会去查产品代码。
   *
   * ⇒ 把"tag 必须唯一"写成可执行的断言：加一条新突变臂而忘了换 tag ⇒ 这里当场红。
   */
  const helperSource = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const tags = [...helperSource.matchAll(/freshTool\('([^']+)'\)/gu)].map((match) => match[1])
  const seen = new Map()
  const duplicates = []
  for (const tag of tags) {
    if (seen.has(tag)) duplicates.push(tag)
    seen.set(tag, true)
  }
  assert.deepEqual(
    [...new Set(duplicates)], [],
    '★ 这些 tag 被两条臂共用 ⇒ Node 会复用缓存里的那个模块实例 ⇒ **后一条臂会读到前一条的版本**'
    + `（全跑时假红、单跑时绿）。当前重复：${JSON.stringify([...new Set(duplicates)])}`,
  )
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 11（★★★ t97）：审查前移到生成那一刻
// ═════════════════════════════════════════════════════════════════════════════

/** 一份**写域已收窄**的提案（生成时就能被审的那种）。 */
const reviewedProposal = (extra = {}) => ({
  source: 'judgement', sourceId: 'j-0099', kind: 'gate',
  subject: '判据：某事必须不同形', objective: '当某个字段缺席时，那个位置必须报出来 —— 而两者必须不同形',
  inScope: ['scripts/gate-j-0099.test.mjs', 'src/gates/index.ts'],
  acceptance: ['★ 它必须能对某个输入返回真/假'], verify: ['pnpm test:gates'],
  because: 'x', ...extra,
})

test('★★★ 臂 11：审过的契约**带 `reviewed`**，而它逐条写着五问的结果', () => {
  /**
   * 用户原话：「生成完的任务，可以带一个『已审查』的字段。」
   * ★ 而"带了"不够 —— 它必须**逐条写着五问的结果**，否则那一格只是"我审过了"这句话。
   */
  const emitted = emitReviewedContract(reviewedProposal(), { members: [{ name: 'a', status: 'idle' }], tasks: [] })
  assert.equal(emitted.status, 'executable')
  assert.notEqual(emitted.contract.reviewed, undefined, '★ 审过了 ⇒ 契约里有 reviewed')
  assert.equal(emitted.contract.reviewed.by, 'adversarial')
  assert.equal(emitted.contract.reviewed.checks.length, REVIEW_CHECKS.length, '★ 五问逐条都要在场')
  for (const id of ['scope', 'prerequisite', 'move', 'acceptance', 'boundary']) {
    assert.ok(emitted.contract.reviewed.checks.some((c) => c.id === id), `★ 缺了第 "${id}" 问`)
  }
})

test('★★★ 臂 11b：**审不过 ⇒ 不产出可派契约**，而是退回并**指名哪一问**', () => {
  /**
   * 契约原文：「不通过 ⇒ 不产出可派契约，而是产出退回理由并**指名哪一问没过**。」
   *
   * ★ 一句"审查没通过"与"没有审查"在观测上同形 —— 读的人不知道要改什么。
   */
  /**
   * ★ 夹具自检（t97 实测抓出来）：第一版我拿「acceptance 为空」当这一条的例子，
   *   而**空 acceptance 在 t95 那一层就被挡了**（`cannot-emit`）⇒ 审查根本轮不到。
   *   ★ 所以这里用一个**只有审查能抓**的毛病：一条**恒真**的 acceptance。
   */
  const rejected = emitReviewedContract(
    reviewedProposal({ acceptance: ['★★ 它必须有非空的 acceptance'] }), { members: [], tasks: [] },
  )
  assert.equal(rejected.status, 'rejected', '★ 验收那一问没过 ⇒ 退回')
  assert.equal(rejected.contract, undefined, '★★ **不产出可派契约**')
  assert.ok(rejected.rejectedBecause.some((r) => r.startsWith('acceptance：')), '★ 指名是哪一问')
})

test('★★★ 臂 11c：三态不同形 —— reviewed / needs-review / rejected', () => {
  /**
   * 契约原文：「★ 三态不同形：reviewed（盖章）/ needs-review（没走自动生成那条路）/
   *            rejected（审了而没过）⇒ 三种不得合并。
   *            ★ 而 needs-review 不是错误 —— 它是『这条路没走自动生成』的正常状态。」
   */
  /** ① 盖章 */
  const passed = emitReviewedContract(reviewedProposal(), { members: [], tasks: [] })
  assert.equal(passed.review.outcome, 'passed')
  assert.equal(reviewStateOf(passed.contract).state, 'reviewed')

  /** ② needs-review：**没走自动生成那条路** —— 一份手工拟的契约（没有 reviewed 那一格）。 */
  const manual = { subject: 's', kind: 'work', inScope: ['docs/x.md'] }
  const state = reviewStateOf(manual)
  assert.equal(state.state, 'needs-review', '★ 不带 reviewed ⇒ 必须先审一遍')
  assert.match(state.why, /不是错误/u, '★ 而它必须说清"那不是错误"（否则读的人会去修一个不存在的问题）')

  /** ③ rejected（★ 用只有审查能抓的那个毛病 —— 见臂 11b 的夹具自检）*/
  const rejected = emitReviewedContract(
    reviewedProposal({ acceptance: ['★★ 它必须有非空的 acceptance'] }), { members: [], tasks: [] },
  )
  assert.equal(rejected.status, 'rejected')
  assert.notEqual(rejected.status, 'executable', '★ "审了没过"与"审过了"不同形')
})

test('★★★ 臂 11d：反向半边 —— **问不出答案不许并进通过**（`unmeasured` 不落盖章）', () => {
  /**
   * 契约原文：「★★ 反向半边：不许把所有东西都判 reviewed（那等于没审）——
   *            问不出答案的必须落到 needs-review 或 rejected，不许并进 reviewed
   *            （那是把没测到并进通过）。」
   *
   * ★★ 而这一格是本文件里**最贵**的一条：一个"总能盖章"的实现在臂 11 上完全绿。
   */
  /** ★★ ① 收窄**推不出来**（卡点侧）⇒ 那一问落 `unmeasured` ⇒ needs-review，**不盖章**。 */
  const coarseEmit = emitReviewedContract(
    { source: 'friction', sourceId: 'f-1', kind: 'repair', subject: 's', objective: 'o',
      inScope: ['comp.x'], acceptance: ['★ x'], verify: ['pnpm test:gates'], because: 'y' },
    { members: [], tasks: [] },
  )
  assert.equal(coarseEmit.scope.status, 'coarse', '★ 夹具自检：这条的写域推不出来')
  assert.equal(coarseEmit.review.outcome, 'needs-review', '★ 问不出来 ⇒ needs-review')
  assert.equal(coarseEmit.contract.reviewed, undefined, '★★★ 问不出来 ⇒ **契约里不许有 reviewed**')

  /** ★ ② 而**目录级**写域（即使没经过收窄）也是同一格。 */
  const coarse = adversarialReview({ inScope: ['scripts/'], acceptance: ['★ 能红'], verify: ['pnpm test:gates'] })
  assert.equal(coarse.outcome, 'needs-review', '★ 写域问不出来 ⇒ needs-review，**不盖章**')
  assert.ok(coarse.unmeasuredIds.includes('scope'))

  /**
   * ★ 而"越界"那一问在**没有具体产物路径**时同样是 `unmeasured`
   *   （不是"不冲突" —— 那是把判不了读成没问题）。
   */
  const noPaths = adversarialReview({ inScope: ['scripts/'], outOfScope: ['lib/'], acceptance: ['★ x'], verify: [] })
  assert.ok(noPaths.unmeasuredIds.includes('boundary'), '★ 没有具体产物 ⇒ 越界那一问也判不了')
})

test('★★★ 臂 11e：五问各自**真的会红**（不是装饰性的清单）', () => {
  /**
   * ★ 一个把五问都写成 `return pass` 的实现在臂 11 上也绿。
   *   ⇒ 逐问造一个**它会抓住的**毛病，断言那一问落 `fail`。
   */
  const cases = [
    ['scope', { inScope: [], acceptance: ['x'], verify: [] }, '没有任何写域'],
    ['acceptance', { inScope: ['a.ts'], acceptance: ['★★ 它必须有非空的文件'], verify: [] }, '恒真'],
    ['move', { inScope: ['a.ts'], acceptance: ['x'], verify: [], movesFiles: true }, '没有核对手段'],
    ['boundary', { inScope: ['lib/x.js'], outOfScope: ['lib/'], acceptance: ['x'], verify: [] }, '永远做不完'],
    ['prerequisite', { inScope: ['a.ts'], acceptance: ['x'], verify: [], prerequisiteAbsent: '它要的那条判据还没落地' }, '还没落地'],
  ]
  for (const [id, contract, needle] of cases) {
    const review = adversarialReview(contract)
    const check = review.checks.find((c) => c.id === id)
    assert.equal(check.verdict, 'fail', `★ "${id}" 问必须能抓住这个毛病`)
    assert.match(check.why, new RegExp(needle, 'u'), `★ 而理由要说清是什么毛病`)
    assert.equal(review.outcome, 'rejected', '★ 有 fail ⇒ rejected')
  }
})

test('★★★ 臂 11f：`looksTautological` 只认**结构上恒真**的，不是"我觉得不够具体"', () => {
  /**
   * ★ 宽了会把好断言判红（而那会让审查变成一个必须绕过的障碍）；
   *   窄了会让恒真的漏过去（t94 的"恰好落一栏"就是它）。
   */
  assert.equal(looksTautological('★★ 它必须有非空的 acceptance'), true)
  assert.equal(looksTautological('★ 那个文件必须存在'), true)
  assert.equal(looksTautological('★ 一次定向突变能让它红'), false, '★ 这条**可判真假**')
  assert.equal(looksTautological('★ 三态不同形：判不了 / 通过 / 拒绝'), false)
})

test('★★★ 臂 11g：写域收窄 —— 而"推不出来"时**如实标 coarse**（不编）', () => {
  /**
   * 契约原文：「让契约的 inScope 收窄到它实际会产出的文件
   *            （若推不出来 ⇒ ★ 如实标 coarse，并说明为什么）。」
   */
  /** ① 判决侧 ⇒ 收窄到**两个具体文件**（不再有目录级的格子）。 */
  const narrowed = narrowScope(reviewedProposal(), {})
  assert.equal(narrowed.status, 'narrowed')
  assert.equal(narrowed.inScope.some((s) => s.endsWith('/')), false, '★ 收窄后**不许**再有目录级写域')
  assert.ok(narrowed.inScope.includes('scripts/gate-j-0099.test.mjs'), '★ 而产物那个文件必须在')

  /** ② ★ 卡点侧推不出来 ⇒ `coarse`，且**说明为什么**。 */
  const coarse = narrowScope({ source: 'friction', sourceId: 'f-1', inScope: ['comp.x'] }, {})
  assert.equal(coarse.status, 'coarse')
  assert.match(coarse.why, /编.*没有依据|没有依据/u, '★ 必须说清"为什么不推一个具体的"')

  /** ③ ★ 一个**不像判决 id** 的 sourceId ⇒ 也推不出来（不许硬凑）。 */
  const weird = narrowScope({ source: 'judgement', sourceId: 'whatever', inScope: ['scripts/'], objective: '中文散文' }, {})
  assert.equal(weird.status, 'coarse')
})

test('★★★ 臂 11h：slug 的两个来源，而**不猜**的那个方向也要钉住', () => {
  /**
   * ★ ① claim 里的英文标识符 ⇒ 它讲的**就是那个东西**。
   * ★ ② 判决 id ⇒ 一条判决一个夹具文件是本仓库的**命名约定**（可核，不是编的）。
   * ★ ③ 两者都没有 ⇒ `undefined`（**不猜**：音译一个中文短语就是编）。
   */
  assert.equal(slugFromClaim('`changed-paths` 那一格必须与 worktree 观察面同源'), 'changed-paths')
  assert.equal(slugFromClaim('gate-index-assembly 的清单必须覆盖新文件'), 'gate-index-assembly')
  assert.equal(slugFromClaim('「尾斜杠对照对」—— 用两种写法把形状检查与真判断分开'), undefined, '★ 中文散文 ⇒ 不音译')
  assert.equal(slugFromId('j-0002'), 'j-0002')
  assert.equal(slugFromId('whatever'), undefined, '★ 不是判决 id 的形状 ⇒ 不认')
})

test('★★★ 定向突变 E（t97）：把**审不过的**也判成 passed ⇒ 臂 11b/11c/11e 必须红', async (t) => {
  /**
   * 契约原文：「★ 定向突变能打红：**把一条审不过的契约盖上 reviewed** ⇒ 臂红。」
   * ★ 而那正是"审查变成了盖章仪式"那个失效形态。
   */
  if (process.env.AGENT_TEAMS_FRICTION_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_FRICTION_MUTATION=1 时运行')
    return
  }
  const original = readFileSync(TOOL, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_REVIEW_OUTCOME,
    "  const outcome = 'passed' // MUTANT: everything passes review",
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行')

  await withMutatedTool(mutated, async () => {
    const mutant = await freshTool('mutation=t97-review-always-passes')
    /** ★ 这一条断言就是**臂 11b/11c/11e 的红**。 */
    assert.equal(
      mutant.adversarialReview({ inScope: [], acceptance: ['x'], verify: [] }).outcome, 'passed',
      '★ 突变体把恒真的 acceptance / 空写域也判过 —— 臂 11e 就是靠这一条变红的',
    )
  })
  const restored = await freshTool('mutation=t97-restored-review')
  assert.equal(
    restored.adversarialReview({ inScope: [], acceptance: ['x'], verify: [] }).outcome, 'rejected',
    '★ 还原后必须回到 rejected',
  )
})

test('★★★ 定向突变 F（t97）：把 `unmeasured` 并进 `passed` ⇒ 臂 11d 必须红', async (t) => {
  /**
   * 契约原文：「把一条 **needs-review** 并进 reviewed ⇒ 臂红」
   * ★★ 那正是本队那条最贵的纪律在**这一个出口上**的落点：**把没测到并进通过。**
   *
   * ★ 而这个突变要改**两处** `unmeasured`（写域那一问 + 越界那一问）——
   *   只改一处的话第三态还在，那就**没测到这条臂**（夹具自检抓过一次）。
   */
  if (process.env.AGENT_TEAMS_FRICTION_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_FRICTION_MUTATION=1 时运行')
    return
  }
  const original = readFileSync(TOOL, 'utf8')
  const mutated = original
    .replaceAll(NEEDLE_REVIEW_OUTCOME, "  const outcome = 'passed' // MUTANT: unmeasured is folded into passed")
    /**
     * ★ 而"写域"那一问的 verdict 是从 `scopeVerdict` 算出来的（**不是**一个 `'unmeasured'` 字面量）
     *   ⇒ 必须**一起改那一行**，否则第三态还在，而这个突变就没测到那条臂
     *   （MEASURED：第一版只改了字面量那一处，于是 `scope` 仍答 unmeasured ⇒ 这条臂假红）。
     */
    .replaceAll("      verdict: coarse.length === 0 ? 'pass' : 'unmeasured',",
               "      verdict: 'pass', // MUTANT: the scope question never says unmeasured")
    .replaceAll("      verdict: 'unmeasured',", "      verdict: 'pass', // MUTANT: this question never says unmeasured")
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行')

  await withMutatedTool(mutated, async () => {
    const mutant = await freshTool('mutation=t97-unmeasured-into-passed')
    const review = mutant.adversarialReview({ inScope: ['scripts/'], acceptance: ['★ 能红'], verify: [] })
    assert.equal(review.outcome, 'passed', '★ 突变体把"问不出来"并进了"通过" —— 臂 11d 就是靠这一条变红的')
    assert.deepEqual(review.unmeasuredIds, [], '★ 第三态整个消失了')
  })
  const restored = await freshTool('mutation=t97-restored-unmeasured')
  assert.equal(
    restored.adversarialReview({ inScope: ['scripts/'], acceptance: ['★ 能红'], verify: [] }).outcome,
    'needs-review',
    '★ 还原后必须回到 needs-review',
  )
})

test('★★ 二次对照（t97）：突变 E/F 的针脚在源码里真的存在', () => {
  assert.equal(readFileSync(TOOL, 'utf8').includes(NEEDLE_REVIEW_OUTCOME), true, '★ 针脚必须逐字存在')
})

// ─────────────────────────────────────────────────────────────────────────────
// t98 ★★★ 大活不直接派：分档是派发的第三条准入
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 用户原话（本组臂的由来）────────────────────────────────────────────────────
 *
 *   「1. 小货的处理：如果判断出来不需要我来做裁决，你就可以自己去走那条自动路。
 *     生成完内容后，审一遍，找机会就可以直接派了。
 *    2. 大货的处理：大货是不应该直接派的。需要我裁决的就留下来，等问完我的意见、
 *      裁决完之后，你再生成、审查，然后才能派货。因为我们之前做的是那种原子化
 *      拆解的审查（或者说是门禁），**所以派出的不应该有大活**。」
 *
 * ⇒ ★ `dispatchable` 的准入从两条变成【三条都要】：
 *     ① to-dispatch（值得做）  ② 审查通过（带 reviewed）  ③ ★ 分档是**小档**
 */

test('★★★ 臂 T98a：判成大档的任务**不许**出现在 dispatchable 的 ready 里', () => {
  /**
   * ★ 一条大活与一条小活放进同一个 `toDispatch`：
   *   小活 ⇒ ready；大活 ⇒ **awaitingRuling**（而它**不在** ready 里）。
   */
  const large = executableProposal({
    sourceId: 'large-1',
    inScope: ['src/a.ts', 'src/b.ts'],
    objective: '把这两处合起来改',
  })
  const small = executableProposal({ sourceId: 'small-1', inScope: ['src/a.ts'], objective: '改一行' })

  const result = dispatchable(
    { toDispatch: [large, small], blocked: [], noAction: [], autoRecorded: [], unknown: [] },
    team([{ name: 'a', status: 'idle' }]),
  )

  console.log(`    ℹ ready: ${JSON.stringify(result.ready.map((e) => e.sourceId))}`)
  console.log(`    ℹ awaitingRuling: ${JSON.stringify(result.awaitingRuling.map((e) => e.sourceId))}`)

  assert.deepEqual(result.ready.map((e) => e.sourceId), ['small-1'], '★ 只有小档能进 ready')
  assert.deepEqual(result.awaitingRuling.map((e) => e.sourceId), ['large-1'], '★ 大档必须进等人裁决的队列')
  /** ★ 而它**绝不许**同时出现在 ready 里（那是本任务要防的那件事）。 */
  assert.equal(
    result.ready.some((e) => e.sourceId === 'large-1'), false,
    '★ 一条大档进了 dispatchable —— 「派出的不应该有大活」',
  )
})

test('★★★ 臂 T98b：大活必须说得出【它大在哪】与【卡在哪一问上】—— 不许只给一个"大"字', () => {
  /**
   * ★ 用户裁决时需要知道它大在哪（是写域跨了多文件？还是要重组已有代码？还是前置不明？）
   *   ⇒ 所以队列里每一条都要带**理由**与**那一问**。
   */
  const result = dispatchable(
    {
      toDispatch: [executableProposal({ sourceId: 'large-multi', inScope: ['src/a.ts', 'src/b.ts'], objective: 'x' })],
      blocked: [], noAction: [], autoRecorded: [], unknown: [],
    },
    team([{ name: 'a', status: 'idle' }]),
  )
  const entry = result.awaitingRuling[0]
  assert.notEqual(entry, undefined, '★ 那条大活没进队列')
  assert.match(entry.whyLarge, /spans 2 existing source files/u, '★ 必须说得出它大在哪')
  assert.equal(typeof entry.blockingQuestion, 'string', '★ 必须带"卡在哪一问"')
  assert.ok(entry.blockingQuestion.length > 10, '★ 那一问不能是一句空话')
  assert.equal(entry.nextStep, 'decompose', '★ 而下一步是【拆解】，不是【再生成】')

  /** ★ 而人话输出里那两行必须都在（否则读的人只看到一个"大"字）。 */
  const text = renderDispatchable(result)
  assert.match(text, /它大在哪：/u, '★ 人话输出必须给出"它大在哪"')
  assert.match(text, /★ 卡在哪一问：/u, '★ 以及"卡在哪一问"')
})

test('★★★ 臂 T98c：三种处置**不同形**（可派 / 等人裁决 / 不可派）', () => {
  /**
   * ★ 契约：「三种不得合并。★ 而「等人裁决」是一个【队列】，不是错误。」
   *
   * ⇒ 本臂逐个构造三种，并断言它们落在**三个不同的格**里。
   */
  const small = executableProposal({ sourceId: 'ok', inScope: ['src/a.ts'], objective: '改一行' })
  const large = executableProposal({ sourceId: 'big', inScope: ['src/a.ts', 'src/b.ts'], objective: 'x' })
  /** ★ 第三种："不可派" —— 这里用"契约不完整"（缺 acceptance）来代表它。 */
  const incomplete = executableProposal({ sourceId: 'inc', inScope: ['src/c.ts'], objective: 'y', acceptance: [] })

  const result = dispatchable(
    { toDispatch: [small, large, incomplete], blocked: [], noAction: [], autoRecorded: [], unknown: [] },
    team([{ name: 'a', status: 'idle' }]),
  )
  console.log(`    ℹ ready ${JSON.stringify(result.ready.map((e) => e.sourceId))}`
    + ` · awaitingRuling ${JSON.stringify(result.awaitingRuling.map((e) => e.sourceId))}`
    + ` · cannotEmit ${JSON.stringify(result.cannotEmit.map((e) => e.sourceId))}`)

  assert.deepEqual(result.ready.map((e) => e.sourceId), ['ok'])
  assert.deepEqual(result.awaitingRuling.map((e) => e.sourceId), ['big'])
  assert.deepEqual(result.cannotEmit.map((e) => e.sourceId), ['inc'])
  /** ★ 三格两两不相交（逐对断言，不循环）。 */
  const sets = [result.ready, result.awaitingRuling, result.cannotEmit].map((list) => new Set(list.map((e) => e.sourceId)))
  for (const id of sets[0]) {
    assert.equal(sets[1].has(id), false, `★ ${id} 同时出现在 ready 与 awaitingRuling`)
    assert.equal(sets[2].has(id), false, `★ ${id} 同时出现在 ready 与 cannotEmit`)
  }
  for (const id of sets[1]) assert.equal(sets[2].has(id), false, `★ ${id} 同时出现在 awaitingRuling 与 cannotEmit`)
})

test('★★ 臂 T98d：**分栏报** —— 每条为什么没进 ready，而不是一个笼统的 blocked', () => {
  /**
   * ★ 契约：「缺任何一条都不进 dispatchable，而每条缺什么要【分栏报】。」
   */
  const result = dispatchable(
    {
      toDispatch: [
        executableProposal({ sourceId: 'big', inScope: ['src/a.ts', 'src/b.ts'], objective: 'x' }),
        executableProposal({ sourceId: 'inc', inScope: ['src/c.ts'], objective: 'y', acceptance: [] }),
      ],
      blocked: [executableProposal({ sourceId: 'blocked-1' })],
      noAction: [], autoRecorded: [], unknown: [],
    },
    team([{ name: 'a', status: 'idle' }]),
  )
  console.log(`    ℹ notReadyBecause = ${JSON.stringify(result.notReadyBecause)}`)
  assert.equal(result.notReadyBecause.large, 1, '★ "大档"那一栏要数出来')
  assert.equal(result.notReadyBecause.contractIncomplete, 1, '★ "契约不全"那一栏也要数出来')
  assert.equal(result.blockedCount, 1, '★ 写域被挡是另一栏')

  /** ★ 而人话输出里那**一栏一行**必须在场。 */
  const text = renderDispatchable(result)
  assert.match(text, /分栏（为什么没进/u, '★ 必须分栏报')
  assert.match(text, /大档等人裁决 1/u, '★ 大档那一栏的计数必须可读')
})

test('★★ 臂 T98e：反向半边 —— 不许把小档判成大档（那会让裁决变成形式）', () => {
  /**
   * ★ 契约：「不许把所有东西都判成大档（那会让队列爆掉、派发停摆）——
   *          也不许把小档判成大档（那会让裁决变成形式）。」
   *
   * ⇒ 本臂用**单文件、无目录条目、无可搬的东西**的形状，断言它进 ready。
   */
  const small = executableProposal({
    sourceId: 'small-1', inScope: ['src/a.ts'],
    /** ★ 带一个"拆"字，**而它没有可搬的东西**（`src/a.ts` 未必存在）——
     *    所以措辞不许把它抬成大档。 */
    objective: '把这个函数拆成两半',
  })
  const result = dispatchable(
    { toDispatch: [small], blocked: [], noAction: [], autoRecorded: [], unknown: [] },
    team([{ name: 'a', status: 'idle' }], [{ id: 't1', assignee: 'a', inScope: ['scripts/'] }]),
  )
  assert.deepEqual(
    result.ready.map((e) => e.sourceId), ['small-1'],
    '★ 一条单文件活被判成了大档 —— 那会让每一条活都进裁决队列，而裁决会因此变成形式',
  )
  assert.equal(result.awaitingRuling.length, 0, '★ 队列不许收它')
})

test('★★ 臂 T98f：`unmeasurable` 既不许进 ready，也不许混进"等人裁决"', () => {
  /**
   * ★ `inScope` 缺席/为空 ⇒ 分档**判不了** ⇒ 它既不是小档也不是大档。
   *   ★ 而它与大档的处置**不同**：大档要**裁决**，它要**补信息**。
   *
   * ★ 而这条臂防的是"把不可判并进可判"——本队记过的那种合流。
   */
  const noScope = executableProposal({ sourceId: 'unknown-1', inScope: [], objective: 'z' })
  const result = dispatchable(
    { toDispatch: [noScope], blocked: [], noAction: [], autoRecorded: [], unknown: [] },
    team([{ name: 'a', status: 'idle' }]),
  )
  console.log(`    ℹ ready ${result.ready.length} · awaitingRuling ${result.awaitingRuling.length} · cannotEmit ${result.cannotEmit.length}`)
  assert.equal(result.ready.length, 0, '★ "判不了"绝不许并进"可派"')
  assert.equal(result.awaitingRuling.length, 0, '★ 也不许并进"等人裁决"——它要补的是信息，不是裁决')
  assert.equal(result.cannotEmit.length, 1, '★ 它落在"契约不完整"那一格（缺的是 inScope）')
  assert.equal(result.notReadyBecause.contractIncomplete, 1)
})
