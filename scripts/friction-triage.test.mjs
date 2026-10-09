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
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
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
  /** ★ t113：**单一主干** —— 分类 → 契约 → 分档 → 拆解 → 生成即审查 → ready。 */
  runPipeline,
  tierOf,
  /** ★ 而 `TIER` 是分档那三态的名字（`small` / `large` / `unmeasurable`）。 */
  TIER,
  decompose,
  decomposeContract,
  OUTCOME_CONTRACT_SOURCE,
  /** ★ t78：这三个现在从 t65 那边 re-export（臂 6 断言**同一性**）。 */
  looksAssertive,
  inputKindOf,
  SHAPE_BY_INPUT,
} from './friction-triage.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOOL = join(ROOT, 'scripts', 'friction-triage.mjs')

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
  const { renameSync, mkdtempSync: mkdtemp, cpSync, rmSync: rmrf } = await import('node:fs')
  const { tmpdir } = await import('node:os')

  /**
   * ── ★★★ MEASURED（t113 补强杀伤率时抓出来）：这一条臂改过【共享状态】──────────────
   *
   * 它原来**直接在 `scripts/` 里 `rename` 那个模块**（移走 / 跑 / 移回）。
   * 而本轮新增了若干 `async` 的 CLI 臂（它们 `spawnSync('node', [TOOL, …])`）——
   * 那些臂 `await` 会让出事件循环 ⇒ 完全可能在"移走"这个窗口里启动子进程
   * ⇒ 子进程 import `TOOL` ⇒ `TOOL` 静态 import 那个刚被挪走的模块
   * ⇒ **`ERR_MODULE_NOT_FOUND`**，而那条 CLI 臂**以它自己的名义**报红。
   *
   * ★★ 症状是**间歇性假红**（每次红的臂不同、单独跑全绿），而根因是
   *   「一条臂改了别的臂也读的磁盘状态」⇒ 这条臂**不再是只读自己输入的**。
   *
   * ── 修法：把"模块缺"这件事搬到【一份私有副本】里做 ──────────────────────────────
   *
   * ★ 为什么不加锁（第一版就是那么写的，MEASURED ⇒ **更坏**）：
   *   ① `waitFor` + 标志位在有界的实现下会"白等然后照做" —— 那条臂**看起来测了**；
   *   ② `rename` 与 `spawn` 之间没有原子性，竞态窗口仍在；
   *   ③ ★ 最坏的一条：一旦 `finally` 没跑到，模块被遗留在 `parked`
   *      ⇒ **整个夹具文件加载失败**（比间歇红严重得多 —— 它把一条臂的失败
   *        放大成"这份夹具全废"）。
   *   ⇒ ★★ 而我加锁之后**真的把模块遗留过一次**（`Cannot find module …/judgement-triage.mjs`）。
   *
   * ★★★ 所以正确的修法是**消除共享状态的改写**，而不是给它加锁：
   *   把 `scripts/` 复制到一份临时目录，在**那里**移走模块并跑 ——
   *   那一份是我私有的，谁也读不到，**结构上不可能干扰任何别的臂**。
   *   ★ 而这条臂的意图（"真的把模块移走再跑"，不是 mock）**完整保住**。
   */
  const l = ledger({ frictions: [], judgements: [] })
  const sandbox = mkdtemp(join(tmpdir(), 't78-absent-'))
  try {
    /** ★ 抄一份 scripts/（只抄这次要用的两个文件就够 —— 少抄 = 少依赖）。 */
    cpSync(join(ROOT, 'scripts'), join(sandbox, 'scripts'), { recursive: true })
    const isolatedTool = join(sandbox, 'scripts', 'friction-triage.mjs')
    const isolatedUpstream = join(sandbox, 'scripts', 'judgement-triage.mjs')

    /** ★ 而在**副本**里把模块移走 —— 这一步改的是一份没人共享的磁盘状态。 */
    renameSync(isolatedUpstream, `${isolatedUpstream}.parked`)
    const run = spawnSync('node', [isolatedTool, '--frictions', l.fdir, '--judgements', l.jdir],
      { encoding: 'utf8', cwd: sandbox })
    assert.notEqual(run.status, 0, '★ 模块缺 ⇒ 必须**失败**，不许静默地出一个"都判不了"的清单')
    assert.match(
      `${run.stderr}${run.stdout}`,
      /judgement-triage\.mjs|ERR_MODULE_NOT_FOUND/u,
      '★ 而失败必须**指出是哪个模块** —— 否则读的人不知道去补什么',
    )

    /**
     * ★★ 反面对照（**这条修法自己的守卫**）：同一份副本、把模块放回去之后，
     *   它必须**能跑**。没有这一条，"隔离副本"若本身是坏的（例如少抄了一个文件），
     *   上面那条断言会因为**别的原因**失败而照样绿。
     */
    renameSync(`${isolatedUpstream}.parked`, isolatedUpstream)
    const ok = spawnSync('node', [isolatedTool, '--frictions', l.fdir, '--judgements', l.jdir],
      { encoding: 'utf8', cwd: sandbox })
    assert.equal(
      ok.status, 0,
      `★★ 同一份隔离副本、模块放回之后必须能跑（否则上面那条"模块缺会失败"可能因为别的原因成立）：\n${ok.stderr}`,
    )

    /** ★ 而**真实**的 `scripts/judgement-triage.mjs` 从头到尾**没有被碰过** —— 那正是这次修法的内容。 */
    assert.equal(
      existsSync(join(ROOT, 'scripts', 'judgement-triage.mjs')), true,
      '★★ 真实的模块必须在原处（这条臂**不许**再动共享状态）',
    )
  } finally {
    rmrf(sandbox, { recursive: true, force: true })
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

// ─────────────────────────────────────────────────────────────────────────────
// t113 ★★★ 单一主干：分类 → 契约 → **分档** → 拆解 → 生成即审查 → ready
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 本组臂的由来（用户原话，逐字）────────────────────────────────────────────────
 *
 *   「一开始都是去对符合条件的任务产出契约之类的东西，然后可能有的契约根据一些
 *     判定认为不符合原子化的条件，那就得去拆」
 *
 * ── 而它要消掉的那个缺陷（实测）─────────────────────────────────────────────────
 *
 * 此前有**三条独立出口**，各自走了流水线的不同片段，且**顺序不一致**：
 *
 *     `--emit-task <id>`   生成 → 审查            ★ **不分档**（大活也产出契约）
 *     `--dispatchable`     分档 → 生成 → 审查     顺序对，但只**列**不落地
 *     `--json`             只出分类报告            走不到契约
 *
 * ★ 根因：`tierOf` **只**在 `dispatchable()` 内部被调用 ⇒ `emitReviewedContract`
 *   自己不知道分档 ⇒「原子化判定」是**调用方记得去做的一步**，而不是流水线的一个阶段。
 *
 * ⇒ ★★ 于是同一提案走 `--emit-task` 出契约、走 `--dispatchable` 被判大档 ——
 *   两条路对**同一件工作**给出**相反处置**。本组的臂钉的就是这一条。
 */

/** ★ 与小档/大档**分明不同形**的第三格：`inScope` 为空 ⇒ 分档判不了。 */
test('★★★ 臂 T113a：主干是**唯一**的一条路 —— 两个出口对同一提案给出同一份分档', async () => {
  /**
   * ── 判据（契约逐字：「★ 同一提案走 `--emit-task` 与 `--dispatchable` 得到**相同**的
   *           分档与放行结论」）──────────────────────────────────────────────────
   *
   * ★ 而"相同"在这里是**可执行**的：`--tier <id>` 那一格印的就是
   *   `{ sourceId, outcome, tier }`，而 `--dispatchable --json` 的四格用的是
   *   **同一个** `entry.tier` 对象 ⇒ 两条出口的读数可以直接比。
   *
   * ★★ 而这条臂**端到端**跑 CLI（不是 import 函数）：它测的正是
   *   "两个**出口**给同一个答案" —— 而那件事只在 CLI 那一层才看得见。
   */
  const { spawnSync } = await import('node:child_process')
  /**
   * ★ 一小组判决，覆盖主干的每一格：
   *   `j-0001` ⇒ 小档（收窄到两个具体文件，无目录条目、无可搬的东西）
   *   `j-0002` ⇒ 大档（★ `narrowScope` 收窄不了 ⇒ 写域里留着 `src/gates/` 目录条目）
   *   `j-0003` ⇒ 判不了（`claim` 挑不出 slug、id 也不是判决 id 的形状 ⇒ 写域标 coarse）
   *              ★ 而 coarse 本身**不是** unmeasurable —— 它只是"没收窄"。
   *                ⇒ 所以第三格要另造：见下面那条 `dispatchable` 的直调。
   */
  const l = ledger({
    judgements: [
      judgement('j-0001', '`changed-paths` 那一格必须与 worktree 观察面同源'),
      judgement('j-0002', '那条判据要能对某个输入返回真/假'),
    ],
  })
  try {
    const argv = ['--frictions', l.fdir, '--judgements', l.jdir, '--team', l.dir]
    const dispatchableExit = spawnSync('node', [TOOL, ...argv, '--dispatchable', '--json'], { encoding: 'utf8' })
    assert.equal(dispatchableExit.status, 0, `★ --dispatchable 必须 exit=0：\n${dispatchableExit.stderr}`)
    const result = JSON.parse(dispatchableExit.stdout)

    /** ★ 把四格压成同一张表：`sourceId ⇒ { outcome, tier }`。 */
    const byExit = new Map()
    for (const entry of result.ready) byExit.set(entry.sourceId, { outcome: 'ready', tier: entry.tier })
    for (const entry of result.awaitingRuling) byExit.set(entry.sourceId, { outcome: 'awaitingRuling', tier: entry.tier })
    for (const entry of result.cannotEmit) byExit.set(entry.sourceId, { outcome: 'cannot-emit', tier: entry.tier })
    assert.ok(byExit.size > 0, '★ 夹具里至少要有一条走到主干上（否则这条臂什么都没测）')

    for (const sourceId of byExit.keys()) {
      const tierExit = spawnSync('node', [TOOL, ...argv, '--tier', sourceId, '--json'], { encoding: 'utf8' })
      assert.equal(tierExit.status, 0, `★ --tier ${sourceId} 必须 exit=0：\n${tierExit.stderr}`)
      const stubs = JSON.parse(tierExit.stdout)
      assert.equal(stubs.length, 1, `★ --tier ${sourceId} 必须给出恰好一条读数（★ 而它印的是**同一份**分档）`)
      const expected = byExit.get(sourceId)
      assert.equal(
        stubs[0].outcome, expected.outcome,
        `★ [${sourceId}] 两个出口的**放行结论**不一样：--tier 说 ${stubs[0].outcome}，--dispatchable 说 ${expected.outcome}`,
      )
      assert.deepEqual(
        stubs[0].tier, expected.tier,
        `★ [${sourceId}] 两个出口的**分档**不一样 —— 那正是本任务要消掉的那个缺陷`,
      )
    }

    /**
     * ── ★★★ 而下面这一段是**本臂的正面**（MEASURED：第一版漏了它）───────────────
     *
     * ★★ 第一版只比了 `--dispatchable` 与 `--tier` —— 而那两个出口**都调 `runPipeline`**
     *   ⇒ 把 `--emit-task` 换成旧的 `emitReviewedContract`（**绕过分档**）它们仍然相等
     *   ⇒ 那条突变**打不红**这条臂（实测：突变 H 下它照样绿）。
     *
     * ★★★ 而契约点名的配对恰恰是 **`--emit-task` ↔ `--dispatchable`** ——
     *   那正是本任务的行名（"同一提案走两个出口给出相反处置"）。
     *   ⇒ 所以这里**直接比这两个出口**，而比的是三样：
     *     ① 分档（`tier.tier`）
     *     ② 放行结论（`stage` ↔ 它落在哪一格）
     *     ③ ★ 而它**走过了分档那一站**（`trace` 里有 `tier`）——
     *        这一条正是"emit 绕过分档"唯一能露出来的地方。
     */
    const emitExit = spawnSync('node', [TOOL, ...argv, '--emit-task', 'j-0001', '--json'], { encoding: 'utf8' })
    assert.equal(emitExit.status, 0, `★ --emit-task 必须 exit=0：\n${emitExit.stderr}`)
    const viaEmit = JSON.parse(emitExit.stdout)

    /**
     * ★ 而 `--dispatchable` 那一侧的同一条读数：从四格里找出它，并把 stage 名字归一到
     *   `--emit-task` 用的那套（`ready` / `awaitingRuling` / `cannot-emit`）。
     */
    const emitRow = byExit.get('j-0001')
    assert.notEqual(emitRow, undefined, '★ j-0001 必须在 --dispatchable 的某一格里（否则没法比）')
    assert.equal(
      viaEmit.stage, emitRow.outcome,
      `★ 同一提案 ` + '`--emit-task` 说 ' - viaEmit.stage
      - `，而 ` + '`--dispatchable` 说 ' + emitRow.outcome
      + ' —— 「同一件工作、两个相反处置」正是本任务要消掉的那个缺陷',
    )
    assert.equal(
      viaEmit.tier.tier, emitRow.tier.tier,
      `★ 同一提案在两个出口上分到了不同的档（--emit-task=${viaEmit.tier.tier}，--dispatchable=${emitRow.tier.tier}）`,
    )
    assert.ok(
      Array.isArray(viaEmit.trace) && viaEmit.trace.includes('tier'),
      '★★ `--emit-task` 的路径里**没有分档那一站** —— 它就是靠"记得分档"在走的那个出口，'
      + `而"分档是硬性阶段"要求它必须经过。走过的：${JSON.stringify(viaEmit.trace)}`,
    )
  } finally {
    l.cleanup()
  }
})

test('★★★ 臂 T113b：大档**必然**经过分档阶段，绝不产出可派契约', () => {
  /**
   * ── 判据（契约逐字：「★ 大档提案**必然**经过分档阶段，绝不被
   *            `emitReviewedContract` **直接**产出契约」）────────────────────────────
   *
   * ★ 而"经过了分档"在这里是**可核的**：主干把走过的阶段写在 `trace` 里
   *   （它不是一个承诺，是一条走过的路）。
   *
   * ★★ 而"绝不被 `emitReviewedContract` 直接产出契约"是两件事，都要钉：
   *   ① 它**没有契约**（`emitted` 那一格缺席）—— 大活就不该拿到可派契约
   *   ② 它走的是**分档那一站之后**的那条路（`trace` 里有 `tier`）
   */
  const big = executableProposal({ sourceId: 'big-1', inScope: ['src/a.ts', 'src/b.ts'], objective: '把这两处合起来改' })
  const outcome = runPipeline(big, team([{ name: 'a', status: 'idle' }]))
  console.log(`    ℹ 大档 stage=${outcome.stage} · trace=${outcome.trace.join(' → ')} · 有契约=${outcome.emitted !== undefined}`)

  assert.equal(outcome.stage, 'awaitingRuling', '★ 大活不许进 ready（「派出的不应该有大活」）')
  assert.equal(outcome.tier.tier, 'large', '★ 而它的分档必须**说得出**是大档')
  assert.equal(
    outcome.emitted, undefined,
    '★ 大活拿到了契约 —— 而那条路正是"大活直接产出契约"（本任务的行名）',
  )
  assert.ok(
    outcome.trace.includes('tier'),
    `★ 它没有经过分档那一站 —— 而"分档是硬性阶段"正是本任务的全部内容。走过的：${outcome.trace.join(' → ')}`,
  )
  /** ★ 而它大在哪、卡在哪一问上，必须跟着走（用户裁决时要的正是这两样）。 */
  assert.match(outcome.entry.whyLarge, /spans 2 existing source files/u, '★ 必须说得出它大在哪')
  assert.equal(outcome.entry.nextStep, 'decompose', '★ 下一步是【拆解】')
})

test('★★★ 臂 T113c：小档走的是 ⑥→⑦，而它的契约**只能是**审查那一站给的', () => {
  /**
   * ★ 反向半边：不许为了"统一主干"把一条**小活**也拦下来 ——
   *   那会让派发停摆（而用户的原话是"小货…审一遍，找机会就可以直接派了"）。
   *
   * ★★ 而"契约来自审查那一站"是**可核的**：主干把来源写在 `method.source` 上，
   *   而它与 `OUTCOME_CONTRACT_SOURCE` 是同一个常数 ⇒
   *   一个绕过审查的实现**当场对不上**。
   */
  const small = executableProposal({
    /**
     * ★★★ MEASURED（本任务当场抓出来）：下面这两格**都不是随便写的** ────────────────
     *
     * ① `sourceId` 必须是**判决 id 的形状**（`j-NNNN`）：`narrowScope` 靠它收窄，
     *    而一个"不像判决 id"的 sourceId 会让收窄落 `coarse` ⇒ 写域那一问 `unmeasured`
     *    ⇒ 契约**不盖章**。★ 而那不是本臂要测的东西（本臂测"小档进 ready 且契约来自审查站"）。
     *
     * ② 而 `inScope` 给的是**收窄的结果**（两个具体文件）——
     *    于是 `scope` 与 `boundary` 两问都答得出来 ⇒ 五问全 `pass` ⇒ `reviewed` 真的盖上。
     */
    sourceId: 'j-0001',
    inScope: ['scripts/gate-j-0001.test.mjs', 'src/gates/index.ts'],
    objective: '那条判据要能对某个输入返回真/假',
  })
  const outcome = runPipeline(small, team([{ name: 'a', status: 'idle' }]))
  assert.equal(outcome.stage, 'ready', '★ 小档必须能进 ready')
  assert.equal(outcome.tier.tier, 'small')
  assert.deepEqual(outcome.trace, ['tier', 'review'], '★ 小档走的是 ③ → ⑥（不经过拆解）')
  assert.equal(
    outcome.method.source, OUTCOME_CONTRACT_SOURCE,
    '★ ready 池里那份契约的来源必须是 [审查那一站] —— 绕过去它就到不了这一格',
  )
  assert.equal(
    outcome.emitted.review.outcome, 'passed',
    '★ 全 pass 才盖章；它落的是 ' + outcome.emitted.review.outcome
    + `（unmeasured：${JSON.stringify(outcome.emitted.review.unmeasuredIds)}）`,
  )
  assert.ok(outcome.emitted.contract.reviewed !== undefined, '★ 而它必须盖了 reviewed（全 pass 才盖）')
})

test('★★★ 臂 T113d：`unmeasurable` 既不进 ready、也不进"等人裁决" —— 而它与大档**不同形**', () => {
  /**
   * ── 判据（契约逐字：「`unmeasurable`（inScope 缺席/为空）不许并进 ready，
   *            且与「大档」不同形（大档要裁决，它要补信息）」）────────────────────
   *
   * ★★ 两件事：
   *   ① 它**不在** ready 里，也**不在** awaitingRuling 里
   *   ② 而它与大档的**读数不同形**：大档带"卡在哪一问上"，它带"缺什么"
   */
  const noScope = executableProposal({ sourceId: 'unknown-1', inScope: [], objective: 'z' })
  const large = executableProposal({ sourceId: 'large-1', inScope: ['src/a.ts', 'src/b.ts'], objective: 'x' })
  const result = dispatchable(
    { toDispatch: [noScope, large], blocked: [], noAction: [], autoRecorded: [], unknown: [] },
    team([{ name: 'a', status: 'idle' }]),
  )
  console.log(`    ℹ ready ${result.ready.length} · awaitingRuling ${result.awaitingRuling.length} · cannotEmit ${result.cannotEmit.length}`)

  assert.equal(result.ready.length, 0, '★ "判不了"绝不许并进"可派"')
  assert.deepEqual(
    result.awaitingRuling.map((entry) => entry.sourceId), ['large-1'],
    '★ "判不了"不许并进"等人裁决" —— 那条队列要的是人拍板，而它缺的是【信息】',
  )
  assert.deepEqual(result.cannotEmit.map((entry) => entry.sourceId), ['unknown-1'])

  /** ★ 而两者的话必须**不同形**（否则读的人分不出"去补信息"还是"去拍板"）。 */
  const unmeasurable = result.cannotEmit[0]
  const ruling = result.awaitingRuling[0]
  assert.equal(unmeasurable.becauseTier, 'unmeasurable', '★ 它必须自报"分档判不了"')
  assert.ok(
    unmeasurable.missing.join(' ').length > 0,
    '★ 它必须逐项说出【缺什么】（那是"补信息"这一补救动作的全部内容）',
  )
  assert.equal(ruling.blockingQuestion !== undefined, true, '★ 大档那一格给的是"卡在哪一问上"（要人拍板）')
  assert.equal(
    typeof unmeasurable.blockingQuestion, 'undefined',
    '★★ 一个"判不了"的提案**没有资格**带"卡在哪一问上" —— 有那一句会让人以为它有东西可裁决',
  )
})

test('★★★ 臂 T113e：三态不同形 —— ok / blocked / unmeasured，而 `unmeasured` 绝不并进 `ok`', () => {
  /**
   * ── 判据（契约逐字：「三态不同形：ok / blocked / unmeasured ——
   *            `unmeasured` 绝不并进 `ok`」）────────────────────────────────────────
   *
   * ★ 本文件的多条臂各自钉过其中一对（1 / T98c / T98f），而这里钉的是
   *   **三格同时在场**：一条 ok、一条 unmeasured、一条被写域挡（blocked）。
   */
  const ok = executableProposal({ sourceId: 'ok-1', inScope: ['src/a.ts'], objective: '改一行' })
  const unmeasured = executableProposal({ sourceId: 'unmeasured-1', inScope: [], objective: 'z' })
  const result = dispatchable(
    {
      toDispatch: [ok, unmeasured],
      /** ★ 第三条**不在** `toDispatch` 里 —— 它被写域挡着（那是另一格，由 `--json` 给出）。 */
      blocked: [executableProposal({ sourceId: 'blocked-1' })],
      noAction: [], autoRecorded: [], unknown: [],
    },
    team([{ name: 'a', status: 'idle' }]),
  )
  const ids = {
    ready: result.ready.map((entry) => entry.sourceId),
    cannotEmit: result.cannotEmit.map((entry) => entry.sourceId),
    awaitingRuling: result.awaitingRuling.map((entry) => entry.sourceId),
  }
  console.log(`    ℹ ${JSON.stringify(ids)} · blockedCount=${result.blockedCount}`)

  assert.deepEqual(ids.ready, ['ok-1'])
  assert.deepEqual(ids.cannotEmit, ['unmeasured-1'], '★ 判不了的那一条落在它自己那一格')
  assert.deepEqual(ids.awaitingRuling, [], '★ 它不许并进"等人裁决"')
  assert.equal(result.blockedCount, 1, '★ 被写域挡的是第三格（一个读数，不是"可派"）')

  /** ★★ 而三格**两两不相交**：没有一条同时出现在两格里。 */
  const sets = [ids.ready, ids.cannotEmit, ids.awaitingRuling].map((list) => new Set(list))
  for (const id of sets[0]) {
    assert.equal(sets[1].has(id), false, `★ ${id} 同时在 ready 与 cannotEmit（"没测到"并进了"通过"）`)
    assert.equal(sets[2].has(id), false, `★ ${id} 同时在 ready 与 awaitingRuling`)
  }
  for (const id of sets[1]) assert.equal(sets[2].has(id), false, `★ ${id} 同时在 cannotEmit 与 awaitingRuling`)
  /** ★ 而"被挡"那一条**绝不**出现在任何一格（它由 blockedCount 单独读）。 */
  for (const list of Object.values(ids)) {
    assert.equal(list.includes('blocked-1'), false, '★ 被挡的那一条混进了主干的某一格')
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// t113 ★★★ 定向突变：主干上的"分档"拿掉 / `--emit-task` 绕过分档
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ★★★ 突变 G 的针脚：主干上那一站分档（拿掉它 ⇒ 回到"谁都能出契约"）。
 *
 * ★★ 而这一行在 t113 里改过一次（captain 裁定②）：分档的输入从**收窄后的契约**
 *   改成了**提案自己的写域** —— 见 `friction-triage.mjs` 文件头
 *   "用施工图判这块地原本多大"那一节。
 *   ★ 而针脚**跟着改**是对的：突变打的是**那一站**，不是某个字符串。
 */
const NEEDLE_TRUNK_TIER = `  const tier = tierOf(proposal, options)`
/** ★★★ 突变 H 的针脚：`--emit-task` 走的是主干（把它换成直调 ⇒ 那条出口就不分档了）。 */
const NEEDLE_EMIT_VIA_TRUNK = `      const outcome = runPipeline(proposal, teamState)`

test('★★★ 定向突变 G（t113）：把**分档**从主干上拿掉 ⇒ 臂 T113a/T113b 必须红', async (t) => {
  /**
   * ── 判据（契约逐字：「定向突变：把分档从主干拿掉 ⇒ 臂红」）──────────────────────
   *
   * ★ 而这一条突变要改**一处**就够 —— 因为主干**只有一条**。
   *   ★★ 那正是本任务的收获：改之前要改**两处**（`dispatchable` 与 `emit-task` 各一遍），
   *     而"只改了一处"会留下一半的分叉 ⇒ 判据也就钉不住。
   */
  if (process.env.AGENT_TEAMS_FRICTION_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_FRICTION_MUTATION=1 时运行')
    return
  }
  const original = readFileSync(TOOL, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_TRUNK_TIER,
    `  const tier = { tier: 'small', why: 'MUTANT: the trunk does not tier at all', review: 'adversarial-review' } // MUTANT`,
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行')

  await withMutatedTool(mutated, async () => {
    const mutant = await freshTool('mutation=t113-trunk-tier-removed')
    /** ★ 这一条断言就是**臂 T113b 的红**：大活直接出了契约（"派出的不应该有大活"被违反）。 */
    const big = mutant.runPipeline(
      { sourceId: 'big-1', kind: 'implementation', subject: 's', objective: '把这两处合起来改', inScope: ['src/a.ts', 'src/b.ts'], acceptance: ['★ 它必须能红'], verify: ['pnpm test:gates'] },
      { members: [{ name: 'a', status: 'idle' }], tasks: [] },
    )
    assert.equal(big.stage, 'ready', '★ 拿掉分档之后，大活**直接进 ready 并拿到契约** —— T113b 就是靠这一条变红的')
    assert.notEqual(big.emitted, undefined, '★ 而它真的拿到了契约（那正是"大活直接产出契约"）')
    assert.equal(big.tier.tier, 'small', '★ 分档那一站整个消失了（它现在恒答 small）')
  })

  const restored = await freshTool('mutation=t113-restored-trunk-tier')
  assert.equal(
    restored.runPipeline(
      { sourceId: 'big-1', kind: 'implementation', subject: 's', objective: '把这两处合起来改', inScope: ['src/a.ts', 'src/b.ts'], acceptance: ['★ 它必须能红'], verify: ['pnpm test:gates'] },
      { members: [{ name: 'a', status: 'idle' }], tasks: [] },
    ).stage,
    'awaitingRuling',
    '★ 还原后，大活必须回到"等人裁决"',
  )
})

test('★★★ 定向突变 H（t113）：让 `--emit-task` **绕过分档**（回到改动之前）⇒ 臂 T113a 必须红', async (t) => {
  /**
   * ── 判据（契约逐字：「定向突变：让 emit 绕过分档 ⇒ 臂红」）──────────────────────
   *
   * ★★ 而这一条突变就是**本任务修之前的那个实现**（逐字）：
   *
   *     const emitted = emitReviewedContract(proposal, teamState)
   *
   *   ⇒ `--emit-task` 于是**不分档**：一条大活会拿到一份盖了 `reviewed` 的契约，
   *     而**同一条**走 `--dispatchable` 会被判大档。
   *     ⇒ 两个出口对同一件工作给出**相反处置** —— 正是本任务的行名。
   *
   * ⚠️ 本臂改的是 **CLI 那一层**，所以它用 `spawnSync` 驱动**真实的两个出口**
   *    （而不是 import 函数 —— 那样测不到"出口"这件事）。
   */
  if (process.env.AGENT_TEAMS_FRICTION_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_FRICTION_MUTATION=1 时运行')
    return
  }
  const { spawnSync } = await import('node:child_process')
  const original = readFileSync(TOOL, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_EMIT_VIA_TRUNK,
    `      const outcome = (() => { const e = emitReviewedContract(proposal, teamState); return e.status === 'executable' ? { stage: 'ready', emitted: e, tier: { tier: 'small', why: 'MUTANT: emit does not tier' }, trace: ['contract', 'review'] } : { stage: 'cannot-emit', missing: e.missing, trace: ['contract'] } })() // MUTANT`,
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行')

  const l = ledger({ judgements: [judgement('j-0001', '`changed-paths` 那一格必须与 worktree 观察面同源')] })
  try {
    /** ★ ① 突变体上：`--emit-task` 走的是**没有分档**的那条路。 */
    writeFileSync(TOOL, mutated)
    const argv = ['--frictions', l.fdir, '--judgements', l.jdir, '--team', l.dir]
    const emitMutant = spawnSync('node', [TOOL, ...argv, '--emit-task', 'j-0001', '--json'], { encoding: 'utf8' })
    assert.equal(emitMutant.status, 0, `★ 突变体必须能跑：\n${emitMutant.stderr}`)
    const parsedMutant = JSON.parse(emitMutant.stdout)
    assert.equal(parsedMutant.stage, 'ready', '★ 突变体把那条活直接放了行')
    assert.equal(
      parsedMutant.trace.includes('tier'), false,
      '★★ 突变体的路径里**没有**分档那一站 —— 这就是"emit 绕过分档"，而 T113a 就是靠它变红的',
    )
    assert.equal(parsedMutant.tier.why, 'MUTANT: emit does not tier', '★ 它的"分档"是一个编出来的常数')
  } finally {
    writeFileSync(TOOL, original)
  }

  /** ★★ ② 还原之后：两个出口**都**经过分档（`trace` 里都有那一站）。 */
  const argv = ['--frictions', l.fdir, '--judgements', l.jdir, '--team', l.dir]
  const emit = spawnSync('node', [TOOL, ...argv, '--emit-task', 'j-0001', '--json'], { encoding: 'utf8' })
  assert.equal(emit.status, 0, `★ 还原后 --emit-task 必须 exit=0：\n${emit.stderr}`)
  const parsed = JSON.parse(emit.stdout)
  assert.equal(parsed.trace.includes('tier'), true, '★ 还原后 --emit-task 必须经过分档那一站')
  for (const sourceId of [parsed.sourceId]) {
    const dispatch = spawnSync('node', [TOOL, ...argv, '--dispatchable', '--json'], { encoding: 'utf8' })
    const result = JSON.parse(dispatch.stdout)
    const same = [...result.ready, ...result.awaitingRuling, ...result.cannotEmit].find((entry) => entry.sourceId === sourceId)
    assert.notEqual(same, undefined, '★ 那条活必须在 --dispatchable 的某一格里')
    assert.equal(same.tier.tier, parsed.tier.tier, `★ [${sourceId}] 两个出口的分档必须一致`)
  }
  l.cleanup()
})

test('★★ 二次对照（t113）：突变 G/H 的针脚在源码里真的存在', () => {
  const source = readFileSync(TOOL, 'utf8')
  assert.equal(source.includes(NEEDLE_TRUNK_TIER), true, '★ 突变 G 的针脚必须逐字存在')
  assert.equal(source.includes(NEEDLE_EMIT_VIA_TRUNK), true, '★ 突变 H 的针脚必须逐字存在')
  /**
   * ★★ 而主干**只有一条** —— 它是本任务的交付，而这里把它写成可执行的断言。
   *
   * ★ MEASURED：只数 `tierOf(` 会把**它自己的定义**也数进去（`export function tierOf(`）
   *   ⇒ 那一版断言报"出现 2 次"而**产品代码是对的**。
   *   ★ 修法：只数**调用**（`tierOf(` 后面跟着的不是 `contract, {`）。
   */
  const trunkCalls = [...source.matchAll(/tierOf\(\s*(?!contract, \{)/gu)].length
  assert.equal(
    trunkCalls, 1,
    `★ \`tierOf\` 在源码里被**调用**了 ${trunkCalls} 次 —— 而"分档是主干上的一站"要求它**只**有一处`
    + '（多一处就意味着又有一个出口在自己分档，而那正是本任务要消掉的那种分叉）。',
  )
  /** ★ 而那一处**必须在主干里**（而不是某个出口自己写的）。 */
  const trunk = source.slice(source.indexOf('function runStages'), source.indexOf('export function dispatchable'))
  assert.equal(trunk.includes('tierOf('), true, '★ 分档那一站必须在 `runStages`（主干）里面')
})

test('★★★ 臂 T113f：拆解器**还没落地**时，这一站如实落 `unmeasured`（★ 而不是编一个结果）', () => {
  /**
   * ── 而它为什么现在就要钉住（P3 还没做）──────────────────────────────────────────
   *
   * ★ 任务的边界逐字写着：「在 P3 完成前，③ 判为大档时走**现有的** `awaitingRuling`
   *   （行为不变）」。
   *
   * ★★ 而本条臂钉的是**这一站自己的诚实**：一条大活走到拆解，
   *   而拆解器**没有**给出结论时，它**不许**编：
   *
   *     编成 `[]`          ⇒ "拆完了、一条不用做"（一条编出来的结论）
   *     编成 `[原提案]`     ⇒ 大活**原样**进了下一轮（它只是绕了一圈，而下一轮会再判大档）
   *     `unmeasured`       ⇒ ★ "我还没学会怎么拆" —— 而它的补救动作是**填 P3**
   */
  const tier = { tier: 'large', why: 'spans 2 existing source files', blockingQuestion: 'it spans 2 existing source files' }
  const contract = { inScope: ['src/a.ts', 'src/b.ts'], objective: '把这两处合起来改' }

  /**
   * ⚠️ MEASURED：`decompose(tier, proposal)` 而 `decomposeContract(contract, tier)`
   *   —— ★ 两个函数的头两个参数**顺序相反**。我第一版按同一个顺序传，
   *     于是"它为什么该被拆"读到的是一句 `(分档没给理由)`。
   *   ★★ 而下面那一条断言**当场把它打红了** —— 夹具替我把自己的错传参拦住。
   */
  const absent = decompose(tier, contract, { depth: 0 })
  assert.equal(absent.status, 'unmeasured', '★ 拆解器没落地 ⇒ 如实落 unmeasured（不许编一个"拆完了"）')
  assert.equal(absent.decomposed, false, '★ 而它**没有**拆出东西 —— 那一格不许被填成 true')
  assert.ok(absent.missing.length > 0, '★ 而"缺什么"要逐项说清（读的人要能直接去补）')
  assert.match(
    absent.missing.join(' '), /P3/u,
    '★ 那一条必须**指名**它是 P3 的任务 —— 否则读的人不知道该去补什么',
  )

  /** ★★ 而"缺什么"里必须**带着这条活为什么该被拆**（那是拆解器的输入）。 */
  assert.match(absent.missing.join(' '), /spans 2 existing source files/u, '★ 必须说出它为什么该被拆')

  /**
   * ── ★ 而下面两个**非法**的拆法必须被当场拒掉 ────────────────────────────────────
   *
   * ★★★ 它们是给 P3 的验收网：一个"拆了个空的"、或"原样还回来"的拆解器，
   *   在这里**当场红** —— 而不是等到那条大活溜进 ready 之后才被发现。
   *
   * ⚠️ MEASURED：第一版**够不着**它们 —— `decomposeContract` 先 `return` 掉 `unmeasured`，
   *   ⇒ 那两道闸门在 P3 之前**永远不跑**（而"够不着"与"守住了"在读数上同形）。
   *   ⇒ 修法：`decompose` 接受一个**注入的拆解器**（`options.decomposer`），
   *     于是这里能喂进一个**故意坏掉**的它，把闸门**真的跑一遍**。
   */
  const empty = decomposeContract(contract, tier, { depth: 0, decomposer: () => [] })
  assert.equal(empty.status, 'unmeasured', '★ 拆出 0 条 ⇒ 那不是"拆完了"，是"这条活凭空消失了"')
  assert.equal(empty.children, undefined, '★ 而它**不许**把一个空数组交给下游当子提案')
  assert.match(empty.why, /0|凭空/u, '★ 必须说清它为什么被拒')

  /** ★★ 而"原样还回来"那一种（拆出来的子活与原来**同形**）也必须被拒。 */
  const sameShape = decomposeContract(contract, tier, {
    depth: 0,
    decomposer: () => [{ sourceId: 'child-1', inScope: [...contract.inScope], objective: '同一条活，只是换了个 id' }],
  })
  assert.equal(sameShape.status, 'unmeasured', '★ 拆出来的与原来同形 ⇒ 大活只是绕了一圈（下一轮还会被判大档）')
  assert.equal(sameShape.children, undefined, '★ 而它同样**不许**把那个"子活"放下去')
  assert.match(sameShape.why, /同形/u, '★ 必须说清它是"原样传下去"')

  /**
   * ★★★ 而反面对照：一个**合法**的拆法（写域真的变小了）必须被判 `decomposed` ——
   *   否则上面两条闸门可能是"一律拒绝"（而那会让拆解**永远无效**）。
   */
  const legal = decomposeContract(contract, tier, {
    depth: 0,
    decomposer: () => [
      { sourceId: 'child-a', inScope: ['src/a.ts'], objective: '只改 a' },
      { sourceId: 'child-b', inScope: ['src/b.ts'], objective: '只改 b' },
    ],
  })
  assert.equal(legal.status, 'decomposed', '★ 写域真的变小了 ⇒ 那是合法的拆法，不许一律拒绝')
  assert.equal(legal.children.length, 2, '★ 而那两条子活要真的交下去（回到 ② 各自再走一遍）')
})

test('★★★ 臂 T113g：`decomposition` 那一格**不许把"拆解器没落地"藏起来**', () => {
  /**
   * ── 它防的是什么 ────────────────────────────────────────────────────────────────
   *
   * ★ 本任务的边界说"P3 之前行为不变"（大档 ⇒ `awaitingRuling`）。
   * ★★ 而**行为不变**不等于"读数不变"：若把"拆解器还没落地"这句话省掉，
   *   那么队列里那一条**看起来**是一条正常的大活等人裁决 ——
   *   而人**会去裁决**，可他要裁决的"这么拆行不行"**根本没有被提出来**（没有拆法）。
   *
   * ⇒ ★ 那是本队记账过的形态：**把基础设施工况伪装成关于数据的结论**。
   *   ⇒ 所以这一格必须在读数里看得见（它不是错误，是一条读数）。
   */
  const big = executableProposal({ sourceId: 'big-1', inScope: ['src/a.ts', 'src/b.ts'], objective: '把这两处合起来改' })
  const outcome = runPipeline(big, team([{ name: 'a', status: 'idle' }]))

  assert.equal(outcome.stage, 'awaitingRuling', '★ P3 之前：大档仍然走现有的 awaitingRuling（行为不变）')
  assert.notEqual(outcome.decomposition, undefined, '★★ "拆解器还没落地"这件事**不许被藏起来**')
  assert.equal(outcome.decomposition.status, 'unmeasured', '★ 它的形状是 unmeasured（补救：填 P3）')
  assert.equal(outcome.decomposition.decomposed, false, '★ 而它**没有**拆出东西')
  assert.ok(
    outcome.decomposition.missing.join(' ').includes('P3'),
    '★ 而它必须指名那条补救动作（去填 P3），否则读的人只会看到"一条大活"',
  )
  /** ★ 而它**仍然在等人裁决** —— 两条读数同时在场，不互相吞并。 */
  assert.equal(outcome.entry.nextStep, 'decompose', '★ 而它**还要**被拆（下一步没变）')
})

test('★★★ 臂 T113h：拆解那一站**不许**静默吞掉一条提案（stage 认不出 ⇒ 当场炸）', () => {
  /**
   * ★ 反向半边：主干上每一格都必须在 `dispatchable` 的四格里**找得到去处**。
   *   ★★ 一个"认不出的 stage"若被静默跳过，那条提案会**凭空消失** ——
   *     而那正是本队记账的"一个读数悄悄少了一格"。
   *
   * ★ 而这条臂用的是**源码级**的检查：`COLUMN_BY_STAGE` 必须覆盖主干所有非 ready 的 stage。
   */
  const source = readFileSync(TOOL, 'utf8')
  /**
   * ⚠️ MEASURED：第一版写成 `/stage: '([a-z-]+)'/`（冒号后**没有**空白），
   *   而源码里是 `stage: 'awaitingRuling'`（冒号后有空格）⇒ 匹配数 0。
   *   ★★ 第二版改成允许空白，而它**仍然漏掉了 `awaitingRuling`** ——
   *     因为字符类里**只有小写**（`[a-z-]`），而 `R` 是大写
   *     ⇒ 那一条被我自己的正则静默地滤掉了，而报告里那一行读作"通过"。
   *   ★★★ 而这正是本队那条最贵的纪律的近亲：**一个没测到的东西，
   *     与"通过"在读数上同形** —— 所以我下面**另外**断言"认出的里面必须有它"。
   *   ⇒ 修法：字符类改成 `[A-Za-z-]`（stage 名是驼峰）。
   */
  const stages = [...source.matchAll(/stage:\s*'([A-Za-z-]+)'/gu)].map((match) => match[1])
  const unique = [...new Set(stages)]
  assert.ok(unique.length > 0, '★ 一个 stage 都没认出来 —— 这条自检就变成了"什么都没测到，却显示通过"')
  assert.ok(unique.includes('ready'), '★ 主干必须能落 ready（否则它什么都不放行）')
  assert.ok(unique.includes('awaitingRuling'), '★ 主干必须能落 awaitingRuling（大档那一格）')
  assert.ok(unique.includes('cannot-emit'), '★ 主干必须能落 cannot-emit（补信息那一格）')

  const table = /const COLUMN_BY_STAGE = \{([\s\S]*?)\n  \}/u.exec(source)
  assert.notEqual(table, null, '★ `COLUMN_BY_STAGE` 必须仍然在（它是"没进 ready"那一栏的唯一口径）')
  /**
   * ⚠️ MEASURED：第一版查的是 `'awaitingRuling'`（**带引号**），而源码里那张表的键
   *   `awaitingRuling` / `rejected` 是**不带引号**的（只有 `cannot-emit` 带，
   *   因为它有一个连字符）⇒ 那两条断言恒假。
   *   ★★ 而那不是"产品代码漏了一栏" —— 是**我的检查读错了形状**
   *     （一个"我读不出来"被读成了"它没有"）。⇒ 修法：两种写法都认。
   */
  const mentions = (body, stage) => body.includes(`'${stage}'`) || new RegExp(`(^|[\\s{,])${stage}\\s*:`, 'u').test(body)
  for (const stage of unique) {
    if (stage === 'ready') continue
    assert.ok(
      mentions(table[1], stage),
      `★ 主干能落 "${stage}" 而分栏表里**没有它** ⇒ 那一条会被静默漏计（读的人会以为那一类是 0 条）`,
    )
  }
})

test('★★★ 定向突变 G2（t113）：突变 G 下 **`--emit-task` 也**必须红（两个出口一起坏）', async (t) => {
  /**
   * ── ★ 它补的是什么 ──────────────────────────────────────────────────────────────
   *
   * ★ 上面那两条突变臂各自在**自己那一侧**跑（G 走函数、H 走 CLI）。
   *   而契约要的那一句是「同一提案走 `--emit-task` 与 `--dispatchable` 得到**相同**的
   *   分档与放行结论」—— ★ 它说的是**两个出口之间的关系**。
   *
   * ★★ 所以这里再补一条：把分档从主干拿掉之后，**两个出口必须一起错** ——
   *   而"一起错"这件事本身是**信息**：它证明这两个出口**共享**那条主干
   *   （一个各自实现的版本会让其中一个对、一个错）。
   */
  if (process.env.AGENT_TEAMS_FRICTION_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_FRICTION_MUTATION=1 时运行')
    return
  }
  const { spawnSync } = await import('node:child_process')
  const original = readFileSync(TOOL, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_TRUNK_TIER,
    `  const tier = { tier: 'small', why: 'MUTANT: the trunk does not tier at all', review: 'adversarial-review' } // MUTANT`,
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行')

  const l = ledger({ judgements: [judgement('j-0001', '`changed-paths` 那一格必须与 worktree 观察面同源')] })
  try {
    /** ★ ① 突变体上：两个出口**都**把那条活直接放了行，而 `trace` 里都没有分档那一站。 */
    writeFileSync(TOOL, mutated)
    const argv = ['--frictions', l.fdir, '--judgements', l.jdir, '--team', l.dir]
    const emit = JSON.parse(spawnSync('node', [TOOL, ...argv, '--emit-task', 'j-0001', '--json'], { encoding: 'utf8' }).stdout)
    const dispatch = JSON.parse(spawnSync('node', [TOOL, ...argv, '--dispatchable', '--json'], { encoding: 'utf8' }).stdout)
    const entry = [...dispatch.ready, ...dispatch.awaitingRuling, ...dispatch.cannotEmit]
      .find((row) => row.sourceId === 'j-0001') ?? dispatch.ready[0]

    /**
     * ⚠️ MEASURED：第一版断言 `emit.trace.includes('tier') === false` —— 而它**红了**，
     *   因为突变 G 拿掉的是**分档这件事**（`tierOf(...)` 换成一个常数），
     *   而 `trace` 那一站（`at('tier')`）**仍然被走过**。
     *   ★★ 那不是产品代码的问题 —— 是**我的断言钉错了东西**：
     *     `trace` 证明"这一站存在"，而它对"这一站**有没有真的判**"一无所知。
     *   ⇒ 修法：把它钉在**那个判据本身**上（`tier.why` 是不是那句编出来的常数）。
     */
    assert.equal(
      emit.tier.why, 'MUTANT: the trunk does not tier at all',
      '★ 突变体给的是一个**编出来的档位**（分档那一站不再真的判了）',
    )
    /** ★★ 而**两个出口一起**错 —— 那证明它们走的是同一条主干。 */
    assert.equal(
      emit.tier.tier, 'small',
      '★ 突变体把每一条都报成小档（于是大活也会被放行）',
    )
    assert.equal(entry.tier.tier, 'small', '★ `--dispatchable` 那一侧也被同一个突变改了 —— 两个出口共享主干')
    assert.equal(entry.tier.why, emit.tier.why, '★★ 两个出口给的是**同一句** why（同一个编出来的常数）')
  } finally {
    writeFileSync(TOOL, original)
    l.cleanup()
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// t113 ★★★★ captain 裁定②：分档读【提案自己的写域】，不是收窄后的
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ── 裁定原文（逐字，本组臂的由来）─────────────────────────────────────────────────
 *
 * > 分档问的是「这条活**本身**有多大」，
 * > 而 `narrowScope` 是**为了产出契约**做的一次收窄，发生在"已决定要做它"**之后**。
 * > 用收窄后的写域判"它大不大"，等于**用施工图判这块地原本多大**。
 *
 * ★★ 而它要防的后果是**具体的**：此前 `tierOf({...contract, inScope: narrow.inScope})`
 *   读的是**收窄器的输出** ⇒ 信号 A（跨多个现有源码文件 —— t54 教出来的那条）
 *   在判决侧**永不触发** ⇒ 一个真实事故的防线被**结构性**关掉。
 */

test('★★★★ 臂 T113i：分档读【提案自己的写域】—— 收窄不许改变一条活的大小', () => {
  /**
   * ── 契约新增验收项：「`tierOf(proposal)` 而非 `tierOf({...contract, inScope: narrow.inScope})`」
   *
   * ★★ 本臂的构造是**关键**：它必须同时满足两件事，否则它什么都没测 ——
   *
   *   ① 提案的写域**跨两个现有源码文件**（⇒ 信号 A 该触发 ⇒ 大档）
   *   ② 而 `narrowScope` **真的会把它收窄成两个具体文件**（⇒ 收窄后信号 A 消失）
   *
   *   ★ 只有 ① 而没有 ② ⇒ 收窄与否都一样，这条臂对"读哪一份"**无话可说**；
   *   ★ 只有 ② 而没有 ① ⇒ 它本来就是小档，断言不出"该是大档"。
   */
  const proposal = {
    source: 'judgement', sourceId: 'j-0002', kind: 'implementation', subject: 's',
    /** ★ 判决侧的 slug 来自它里面的**英文标识符**（`gate-index-assembly`）⇒ 收窄会生效。 */
    objective: 'gate-index-assembly 的清单必须覆盖新文件',
    inScope: ['src/a.ts', 'src/b.ts'],
    acceptance: ['★ 它必须能红'], verify: ['pnpm test:gates'],
  }

  /** ★ 前置一：收窄**真的**发生了（否则下面那条断言是同义反复）。 */
  const narrow = narrowScope(proposal, {})
  assert.equal(narrow.status, 'narrowed', '★ 夹具前提：这条提案必须能被收窄（否则本臂测不到"读哪一份"）')
  assert.notDeepEqual(narrow.inScope, proposal.inScope, '★ 夹具前提：收窄必须**真的改了**写域')
  assert.equal(
    narrow.inScope.some((entry) => entry === 'src/a.ts' || entry === 'src/b.ts'), false,
    '★ 夹具前提：收窄必须把那两个源码文件**换掉**（否则信号 A 不会消失）',
  )

  /**
   * ★★★ MEASURED（本任务当场抓出来，一次**假绿**）：第一版这里调的是
   *   `tierOf(proposal, …)` **直调** —— 而它测的是**那个函数本身**，
   *   不是**主干喂给它什么**。
   *   ⇒ 把主干回退成 `tierOf({ ...contract, inScope: narrow.inScope })` 时，
   *     这条臂**照样绿**（实测：回退下 T113i ✔、只有 T113j/T113k 红）。
   *   ★★ 而那正是本队那条：**一条钉在写法上的断言，与它要保护的那件事无关。**
   *
   * ⇒ 修法：**经主干**取读数（`runPipeline` 的 `tier` 就是主干喂出来的那一份）。
   *   ★ 而反面对照也必须经主干 —— 否则那个差是"两个直调之差"，不是"主干读哪一份"。
   */
  const outcome = runPipeline(proposal, team([{ name: 'a', status: 'idle' }]))
  assert.equal(
    outcome.tier.tier, TIER.large,
    '★ 跨两个现有源码文件的判决被判成了小档 —— 主干把【收窄后的写域】喂给了分档（= 用施工图判这块地原本多大）',
  )
  assert.equal(outcome.tier.signals.multipleFiles, true, '★ 而它必须是**信号 A** 触发的（不是别的信号碰巧也判大）')

  /**
   * ★ 反面对照（**同一个主干**、只换分档的输入）：把收窄后那一份喂进 `tierOf`
   *   ⇒ 它判小 —— 于是"主干读哪一份"这件事有一个**可观测的差**。
   *   ★★ 没有这个差，本臂就没有可测的东西（它只是在复述 `tierOf` 的实现）。
   */
  const onNarrowed = tierOf({ ...proposal, inScope: narrow.inScope }, { exists: () => true })
  assert.equal(
    onNarrowed.tier, TIER.small,
    '★ 夹具前提：收窄后的写域**确实**判小 —— 那个差就是本臂要量的东西',
  )
})

test('★★★★ 臂 T113j：信号 A 在判决侧真的能触发 ⇒ 那条活进【等人裁决】，不被直接放行', () => {
  /**
   * ── 契约新增验收项：「信号 A 在判决侧能再次触发：`inScope:['src/a.ts','src/b.ts']`
   *            的判决必须判 large」
   *
   * ★★ 而"判 large"**必须一路走到放行结论上**才有意义 ——
   *   一个"分档说 large、而放行照旧"的实现，等于把那个读数**读了不用**。
   *   ⇒ 所以本臂断言的是 `stage === 'awaitingRuling'`（不是 ready、也没有契约）。
   */
  const proposal = {
    source: 'judgement', sourceId: 'j-0002', kind: 'implementation', subject: 's',
    objective: 'gate-index-assembly 的清单必须覆盖新文件',
    inScope: ['src/a.ts', 'src/b.ts'],
    acceptance: ['★ 它必须能红'], verify: ['pnpm test:gates'],
  }
  const outcome = runPipeline(proposal, team([{ name: 'a', status: 'idle' }]))
  console.log(`    ℹ 判决侧跨两文件 ⇒ stage=${outcome.stage} · tier=${outcome.tier.tier} · 有契约=${outcome.emitted !== undefined}`)

  assert.equal(outcome.tier.tier, TIER.large, '★ 判决侧跨两个现有源码文件必须判 large（信号 A）')
  assert.equal(
    outcome.stage, 'awaitingRuling',
    '★ 它被判了大档，却没进"等人裁决" —— 那个分档读数**读了不用**',
  )
  assert.equal(outcome.emitted, undefined, '★ 大活不许拿到可派契约')

  /** ★ 而"它大在哪"必须一路带到队列条目上（用户裁决时要的正是这一句）。 */
  assert.match(
    outcome.entry.whyLarge, /spans 2 existing source files/u,
    '★ 队列条目必须说得出它是信号 A 判大的',
  )
})

test('★★★★ 臂 T113k：收窄的读数仍进返回值 —— 只是不再当分档输入', () => {
  /**
   * ── 契约新增验收项：「`narrow.inScope` 的读数仍进返回值（收窄前后的差是有用信号）
   *            只是不再作分档输入」
   *
   * ★★ 而"有用"必须**说得清它是哪一件事**：
   *   收窄把一个大面压成两个具体文件 ⇒ ★ **原始写域粗得没能指认对象**
   *   （判决侧 claim 是人话散文，推不出路径 —— 那正是 t72 那条实测）。
   *
   * ★ 所以 `narrowing` 那一格要**逐条可核**：`from` 是提案给的、`to` 是收窄器给的、
   *   `dropped` 是两者的差。
   */
  const proposal = {
    source: 'judgement', sourceId: 'j-0002', kind: 'implementation', subject: 's',
    objective: 'gate-index-assembly 的清单必须覆盖新文件',
    inScope: ['src/a.ts', 'src/b.ts'],
    acceptance: ['★ 它必须能红'], verify: ['pnpm test:gates'],
  }
  const outcome = runPipeline(proposal, team([{ name: 'a', status: 'idle' }]))

  assert.notEqual(outcome.narrowing, undefined, '★ 收窄的读数不许因为"不再当分档输入"就被丢掉')
  assert.deepEqual(outcome.narrowing.from, ['src/a.ts', 'src/b.ts'], '★ `from` 必须是【提案自己的】写域')
  assert.deepEqual(
    outcome.narrowing.to, narrowScope(proposal, {}).inScope,
    '★ `to` 必须是【收窄后、写进契约】的那一份',
  )
  assert.deepEqual(
    outcome.narrowing.dropped, ['src/a.ts', 'src/b.ts'],
    '★ 而"被收窄掉了哪些格子"必须看得见 —— 那是"原始写域粗"的证据',
  )
  assert.equal(outcome.narrowing.status, 'narrowed', '★ 而它的三态（narrowed/coarse/none）要如实带着')

  /**
   * ★★ 而**两个读数各说各的事**（不许合成一个）：
   *   `tier` 说"这条活多大" —— 它读 `from`
   *   `narrowing` 说"这次收窄干了什么" —— 它读 `from` 与 `to` 的差
   *   ★ 合成一个，就会让"收窄器坏了"与"这条活很小"在读数上同形。
   */
  assert.equal(outcome.tier.tier, TIER.large, '★ `tier` 说的是这条活的面')
  assert.equal(outcome.narrowing.status, 'narrowed', '★ 而 `narrowing` 说的是收窄干了什么 —— 两件事')
})

test('★★★★ 臂 T113l（反向半边）：收窄【推不出来】时，信号 A 照样触发', () => {
  /**
   * ★ 反向半边：判决侧也可能**收窄不了**（`narrowScope` 落 `coarse`）
   *   —— 那时写域原样留着。
   *
   * ★★ 而无论收窄推得出来推不出来，**分档读的都是同一份**（提案的写域）
   *   ⇒ 两条路的档位必须**一致**（这正是不再读收窄输出的意义：分档不再依赖收窄器的状态）。
   */
  const base = {
    source: 'judgement', sourceId: 'j-0002', kind: 'implementation', subject: 's',
    inScope: ['src/a.ts', 'src/b.ts'],
    acceptance: ['★ 它必须能红'], verify: ['pnpm test:gates'],
  }
  /** ★ ① 收窄得了（claim 里有英文 slug）。 */
  const narrowable = { ...base, objective: 'gate-index-assembly 的清单必须覆盖新文件' }
  /** ★ ② 收窄不了（claim 全是中文散文、id 也不是判决 id 的形状）。 */
  const coarse = { ...base, sourceId: 'whatever', objective: '「尾斜杠对照对」—— 用两种写法把形状检查与真判断分开' }

  assert.equal(narrowScope(narrowable, {}).status, 'narrowed', '★ 夹具前提：① 必须收窄得了')
  assert.equal(narrowScope(coarse, {}).status, 'coarse', '★ 夹具前提：② 必须收窄不了')

  const theTeam = team([{ name: 'a', status: 'idle' }])
  const a = runPipeline(narrowable, theTeam)
  const b = runPipeline(coarse, theTeam)
  assert.equal(a.tier.tier, TIER.large, '★ 收窄得了的那一条：信号 A ⇒ 大档')
  assert.equal(
    b.tier.tier, TIER.large,
    '★ 收窄不了的那一条也必须是大档 —— 分档若读收窄器的状态，这两条会被分成两档（而它们是同一件活的面）',
  )
  assert.deepEqual(
    a.tier.signals, b.tier.signals,
    '★ 两条的**信号**必须一模一样（它们读的是同一份写域的形状）',
  )
  /**
   * ★★ 而这一条**必须经主干**（同 T113i 的 MEASURED）：直调 `tierOf` 会让它在
   *   "主干读收窄后"那一版下**照样绿** —— 那样它就钉在写法上，而不是钉在裁定上。
   */
  assert.equal(a.stage, 'awaitingRuling', '★ 而两条都要一路走到"等人裁决"（分档读了要用）')
  assert.equal(b.stage, 'awaitingRuling', '★ 收窄推不出来的那一条也一样')
})

/**
 * ★★★★ 突变 I 的针脚（裁定②）：主干**喂给分档的**是提案自己的写域。
 *
 * ★ 它与突变 G 的针脚**不同**：
 *   G 打的是"分档那一站还在不在"（换成一个常数）
 *   I 打的是"分档那一站**读哪一份写域**"（提案 vs 收窄后的契约）
 * ⇒ 两条钉的是两件不同的事。
 */
const NEEDLE_TIER_INPUT = `  const tier = tierOf(proposal, options)`

test('★★★★ 定向突变 I（裁定②）：把分档的输入换回【收窄后的契约】⇒ 臂 T113i–l 必须红', async (t) => {
  /**
   * ── 这条突变就是**裁定②要修掉的那一版实现**（逐字）──────────────────────────────
   *
   *     const tier = tierOf({ ...contract, inScope: narrow.inScope }, options)
   *
   * ★★ 而它要防的后果是**结构性**的：信号 A（跨多个现有源码文件 —— t54 那条）
   *   在判决侧**永不触发** ⇒ 一个真实事故的防线被关掉，而**没有任何一行日志会说这件事**。
   *
   * ★★★ 而本条臂本身也踩过一个坑（MEASURED，见 T113i 的注释）：
   *   我最初的 T113i/T113l **直调 `tierOf`** ⇒ 在这条突变下**照样绿**
   *   （它们测的是那个函数，不是主干喂给它什么）。
   *   ⇒ 那说明"四条臂都红"这件事**必须先被量过**，否则一条钉在写法上的臂
   *     会被读成"这条判据守住了"。
   */
  if (process.env.AGENT_TEAMS_FRICTION_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_FRICTION_MUTATION=1 时运行')
    return
  }
  const original = readFileSync(TOOL, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_TIER_INPUT,
    `  const tier = tierOf({ ...contract, inScope: narrow.inScope }, options) // MUTANT: tiering reads the narrowed scope`,
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行')

  await withMutatedTool(mutated, async () => {
    const mutant = await freshTool('mutation=t113-tier-reads-narrowed')
    /** ★ 这一条断言就是**臂 T113i/j 的红**：判决侧跨两个源码文件被判成了小档。 */
    const outcome = mutant.runPipeline(
      {
        source: 'judgement', sourceId: 'j-0002', kind: 'implementation', subject: 's',
        objective: 'gate-index-assembly 的清单必须覆盖新文件',
        inScope: ['src/a.ts', 'src/b.ts'],
        acceptance: ['★ 它必须能红'], verify: ['pnpm test:gates'],
      },
      { members: [{ name: 'a', status: 'idle' }], tasks: [] },
    )
    assert.equal(
      outcome.tier.tier, 'small',
      '★ 突变体把一条跨两文件的判决判成了小档 —— 臂 T113i/j 就是靠这一条变红的',
    )
    assert.equal(
      outcome.stage, 'ready',
      '★★ 而它**因此被直接放行**了（信号 A 在判决侧被关掉 ⇒ 大活不再进裁决队列）',
    )
  })

  const restored = await freshTool('mutation=t113-restored-tier-input')
  assert.equal(
    restored.runPipeline(
      {
        source: 'judgement', sourceId: 'j-0002', kind: 'implementation', subject: 's',
        objective: 'gate-index-assembly 的清单必须覆盖新文件',
        inScope: ['src/a.ts', 'src/b.ts'],
        acceptance: ['★ 它必须能红'], verify: ['pnpm test:gates'],
      },
      { members: [{ name: 'a', status: 'idle' }], tasks: [] },
    ).tier.tier,
    'large',
    '★ 还原后必须回到 large（信号 A 重新触发）',
  )
})

test('★★ 二次对照（裁定②）：突变 I 的针脚在源码里真的存在', () => {
  assert.equal(readFileSync(TOOL, 'utf8').includes(NEEDLE_TIER_INPUT), true, '★ 突变 I 的针脚必须逐字存在')
})

// ═════════════════════════════════════════════════════════════════════════════
// t113 ★★★ 杀伤率补强：把【渲染分支的两侧】都走到
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ── 这一组是为什么存在（t13 的读数，逐字）─────────────────────────────────────────
 *
 *   `[completion.mutation] the delivered tests are decorative on the lines this task
 *    changed: mutation score 0.5 < 0.6 (63/126 mutant(s) survived)`
 *
 * ★★ 而它点名的那批存活体**有一个共同的形状** —— 全都是
 *   **`renderDispatchable` 那几个 `if (…length > 0)` 守卫**：
 *
 *     gt-to-ge@L2070/2083/2094/2101   ← `> 0` 换成 `>= 0`
 *     true-to-false@L2178             ← `=== true` 换成 `=== false`
 *     and-to-or@L2128/2262            ← `&&` 换成 `||`
 *
 * ★ 而那意味着**同一件事**：**这些分支的【假】那一侧从来没有被走到。**
 *   此前每条渲染臂给的都是**非空**队列 ⇒ `length > 0` 恒真
 *   ⇒ 把 `>` 改成 `>=` 读出来一模一样 ⇒ 变异体存活。
 *
 * ★★ 而"守卫恒真"不是小事：它意味着**"空的时候印什么"这件事从没被核过** ——
 *   一个印错的空清单（例如印出一整栏空的"等人裁决"）会让人以为有活等着裁决。
 */

test('★★★★ 臂 T113m：渲染的分支**两侧都走到** —— 三个队列都空时印什么', () => {
  /**
   * ★★ 本臂喂一份**三个队列全空、blockedCount = 0** 的结果 ——
   *   那是此前**从没被渲染过**的形状 ⇒ 四个 `> 0` 守卫的假侧同时被走到。
   *
   * ★ 而断言钉在**意图**上：空的时候**不许印出那一栏**。
   *   一个"印了一栏、只是里面写着（无）"的实现会让读的人以为有东西。
   */
  const empty = {
    ready: [], awaitingRuling: [], cannotEmit: [], rejected: [],
    blockedCount: 0,
    notReadyBecause: { large: 0, notReviewed: 0, contractIncomplete: 0, scopeBlocked: 0 },
  }
  const text = renderDispatchable(empty)
  console.log(`    ℹ 空结果的渲染：长度 ${text.length} · 行数 ${text.split('\n').length}`)

  /** ★ 那一栏**必须在**（"现在就能建（0）"是一个诚实的空读数）。 */
  assert.match(text, /现在就能建（0）/u, '★ 空清单也要印出"现在就能建（0）"，不是什么都不印')

  /**
   * ★★ 而三个**条件栏**在空的时候**一个都不许出现** ——
   *   这正是那四个守卫的**假侧**（把它们改成 `>= 0` ⇒ 这里当场红）。
   */
  assert.equal(text.includes('等人裁决（'), false, '★ 队列空时不许印"等人裁决"那一栏（`> 0` 的假侧）')
  assert.equal(text.includes('契约生成不出来（'), false, '★ 空时不许印"契约生成不出来"那一栏')
  assert.equal(text.includes('被写域挡着'), false, '★ blockedCount=0 时不许印"被写域挡着"那一行')
  assert.equal(text.includes('为什么不给别人'), false, '★ 没有 ready 条目时不许印"为什么不给别人"那一行')

  /** ★ 而分栏报照旧要在（它是**无条件**读数 —— 与上面三栏不同形）。 */
  assert.match(text, /分栏（为什么没进/u, '★ 分栏报是无条件读数，空结果也要有')
})

test('★★★★ 臂 T113n：`ready` 条目的 `whyNot` **两侧都走到**（有 / 没有）', () => {
  /**
   * ── 契约（t13 点名的 `gt-to-ge@L2070`）───────────────────────────────────────
   *
   * ★ L2070 = `if (Object.keys(entry.assignee.whyNot).length > 0)` ——
   *   即"**为什么不是别人**"那一行。此前**没有一条渲染臂**断言过它。
   *
   * ★ 而"有 whyNot"这个形状要自己造（`recommendAssignee` 只在**确实比较过别人**时才填）——
   *   所以这里直接把 `assignee` 换掉，而不是去构造一个能产生它的团队。
   */
  const withWhyNot = {
    sourceId: 'a-1', tier: { tier: 'small', why: 'w' },
    contract: { subject: 's1', kind: 'implementation', objective: 'o1', inScope: ['scripts/x.mjs'] },
    assignee: { member: 'a', reasons: ['理由一'], whyNot: { b: '写域重叠', c: '在忙' } },
    review: { outcome: 'passed', checks: [] },
  }
  const withoutWhyNot = {
    sourceId: 'a-2', tier: { tier: 'small', why: 'w' },
    contract: { subject: 's2', kind: 'implementation', objective: 'o2', inScope: ['scripts/y.mjs'] },
    assignee: { member: 'a', reasons: ['理由二'], whyNot: {} },
    review: { outcome: 'passed', checks: [] },
  }
  const text = renderDispatchable({
    ready: [withWhyNot, withoutWhyNot], awaitingRuling: [], cannotEmit: [], rejected: [],
    blockedCount: 0,
    notReadyBecause: { large: 0, notReviewed: 0, contractIncomplete: 0, scopeBlocked: 0 },
  })

  /** ★ 有 whyNot 的那一条 ⇒ 那一行**要在**，且两个名字都要印出来（`> 0` 的真侧）。 */
  assert.match(text, /为什么不给别人：/u, '★ 有 whyNot 时"为什么不给别人"那一行必须在')
  assert.match(text, /- b：写域重叠/u, '★ 而逐条理由要印出来')
  assert.match(text, /- c：在忙/u, '★ 每一条都在')

  /**
   * ★★ 而没有 whyNot 的那一条 ⇒ 那一行**不许**跟着出现。
   *   ★ 所以这条断言要**数次数**，不能问"在不在"：
   *     两个条目都印时，"第 2 条也印了" 与 "第 1 条印了" 在"存在性"上**同形**。
   *   ⇒ 恰好 1 次（只有第 1 条那一个 whyNot）。
   */
  const occurrences = text.split('为什么不给别人：').length - 1
  assert.equal(
    occurrences, 1,
    `★ "为什么不给别人"出现了 ${occurrences} 次 —— 而只有第 1 条有 whyNot ⇒ 空的那条也印了`,
  )
})

test('★★★★ 臂 T113o：被 **import** 时不许跑 CLI（`and-to-or@L2128` 的另一侧）', async () => {
  /**
   * ── 契约（t13 点名的 `and-to-or@L2128`）───────────────────────────────────────
   *
   * ★★ L2128 是 CLI 的入口判定：
   *
   *     process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href
   *
   *   ⇒ 把 `&&` 换成 `||` 之后，**任何 import** 都会被当成 CLI 调用 ⇒
   *     import 这个模块会**直接执行 CLI**（读 argv、印清单、可能设 exitCode）。
   *
   * ★ 而它此前存活，因为**没有一条臂从"被 import"这一侧断言过** ——
   *   臂 7 只测"当脚本跑"那一侧。⇒ 本臂把**被 import** 那一侧钉住。
   *
   * ★★★ 而它的判据钉的是**可观测的后果**，不是去读那个布尔：
   *   被 import 时**不许有 stdout 输出、不许设 exitCode** ——
   *   那是 `&&` 与 `||` 在**行为上**唯一分得开的地方。
   */
  const { spawnSync } = await import('node:child_process')
  /** ★ 一个只 import、不跑 CLI 的子进程；它把 stdout 的写抓下来。 */
  const probe = `
    const captured = []
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk, ...rest) => { captured.push(String(chunk)); return true }
    await import(${JSON.stringify(TOOL)})
    process.stdout.write = orig
    orig(JSON.stringify({ wrote: captured.length, exitCode: process.exitCode ?? null }))
  `
  const r = spawnSync('node', ['--input-type=module', '-e', probe], { encoding: 'utf8' })
  assert.equal(r.status, 0, `★ 子进程必须能跑：\n${r.stderr}`)
  const read = JSON.parse(r.stdout.trim().split('\n').pop())
  console.log(`    ℹ 被 import 时：wrote=${read.wrote} · exitCode=${read.exitCode}`)

  assert.equal(
    read.wrote, 0,
    '★★ 被 import 时它**印了东西** —— 那说明入口判定让"被 import"也走进了 CLI（and-to-or@L2128 的红）',
  )
  assert.equal(
    read.exitCode, null,
    '★★ 被 import 时它设了 exitCode —— 那是 CLI 路径的副作用，不该出现在 import 上',
  )

  /** ★ 反面对照：**当脚本跑**时它必须真的印清单（否则上面那条会因为"它从不输出"而恒真）。 */
  const l = ledger({ frictions: [friction('f-open', 'open')], judgements: [] })
  try {
    const run = spawnSync('node', [TOOL, '--frictions', l.fdir, '--judgements', l.jdir], { encoding: 'utf8' })
    assert.equal(run.status, 0, `★ 当脚本跑时 exit=0：\n${run.stderr}`)
    assert.ok(run.stdout.length > 0, '★ 反面对照：当脚本跑时**必须**有输出 —— 否则上面那条断言没有意义')
  } finally {
    l.cleanup()
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// t113 ★★★ 杀伤率补强（二）：把**消息文本本身**断言掉
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ── 这一组补的是同一类缺口，而它的形状值得写下来 ─────────────────────────────────
 *
 * ★★ `plus-to-minus` 有 22 条存活，而它们**几乎全是字符串拼接**：
 *
 *     why: '第一句。'
 *       + '第二句。'      ← 这一行被换成 `- '第二句。'`
 *
 * ★ 而 `'a' - 'b'` 在 JS 里**不是语法错**，它是 **`NaN`** ⇒ 那段文本变成 `[NaN]`
 *   ⇒ 只要有任何一条臂**断言了那句文本**，这个变异体就当场被杀。
 *
 * ⇒ ★★ 所以存活的原因不是"它不可杀"，而是**那几句文本从来没有人读过**：
 *   臂只断言了 `missing.length > 0` 或**另一条**消息里的一个字串。
 *   ★ 而那正是本队那条：**一条从没被读过的输出，与一条正确的输出同形。**
 */

test('★★★★ 臂 T113p：`decompose` 的 `why` **全文**被断言（不是只看长度）', () => {
  /**
   * ★★ 本臂把那段话**逐句**钉住 —— 而它此前只被 `assert.ok(missing.length > 0)` 间接碰过。
   *   ⇒ `+` 换成 `-` 会把它变成 `NaN`，而本臂当场红。
   */
  const tier = { tier: 'large', why: 'spans 2 files', blockingQuestion: 'q' }
  const out = decompose(tier, { inScope: ['src/a.ts', 'src/b.ts'] }, { depth: 0 })

  assert.equal(typeof out.why, 'string', '★ `why` 必须是一句**字符串**（`NaN` 会让这里红）')
  /** ★ 而"逐句在不在"是本臂的实质 —— 每一句都单独钉。 */
  assert.match(out.why, /我还没学会怎么把一条大活拆成原子活/u, '★ 第一句必须原样在里面')
  assert.match(out.why, /不许\*\*并进"可派"/u, '★ 第二句必须原样在里面（L1507 那一段）')
  assert.match(out.why, /也\*\*不许\*\*并进"等人裁决"/u, '★ 第三句必须原样在里面（L1508 那一段）')
  assert.match(out.why, /补的是 P3/u, '★ 而那个补救动作要看得见')
  /**
   * ★★ 而"不是 NaN"要**单独**钉一次：上面三条 `match` 在 `why` 是 `[NaN].toString()`
   *   （即字符串 `"NaN"`）时会全红 —— 但一个**更隐蔽**的实现（例如 `why` 变成
   *   只含第一句）会让它们中的一部分仍然绿。⇒ 这一条钉住**它没有丢掉任何一句**。
   */
  assert.equal(
    out.why.includes('NaN'), false,
    '★★ `why` 里出现了 "NaN" —— 那是字符串拼接被换成算术减法的特征（plus-to-minus 的红）',
  )

  /** ★ 而 `missing` 的三条也逐条钉（它们此前只被数了条数）。 */
  assert.equal(out.missing.length, 3, '★ 三条：拆解器本体 / 它为什么该被拆 / 它卡在哪一问')
  assert.match(out.missing[0], /拆解器本体（P3 的任务）/u, '★ 第一条要指名 P3')
  assert.match(out.missing[1], /spans 2 files/u, '★ 第二条要带上分档给的理由')
  assert.match(out.missing[2], /q/u, '★ 第三条要带上"卡在哪一问"')
})

test('★★★★ 臂 T113q：`decomposeContract` 两条拒绝理由**各自**被断言（不是只看一条）', () => {
  /**
   * ── 契约（t13 点名的 `plus-to-minus@L1572/1589`）──────────────────────────────
   *
   * ★★ 那两条 `why` 分别属于**两个不同的拒绝**：
   *
   *     L1572  拆出来的子活与原来**同形**   ⇒ "原样传下去"
   *     L1589  拆出 **0** 条                ⇒ "这条活凭空消失了"
   *
   * ★ 而它们此前只被 `/0|凭空/` 与 `/同形/` 那种**宽**匹配碰过 ——
   *   而宽匹配的危险恰恰是：它accepts 一个**被截断**的实现。
   *   ⇒ 本臂把两条**各自**逐句钉住。
   */
  const tier = { tier: 'large', why: 'w', blockingQuestion: 'q' }
  const contract = { inScope: ['src/a.ts', 'src/b.ts'], objective: 'o' }

  const empty = decomposeContract(contract, tier, { depth: 0, decomposer: () => [] })
  assert.equal(typeof empty.why, 'string', '★ 空拆法的 `why` 必须是字符串')
  assert.match(empty.why, /拆解给出了 \*\*0\*\* 条子活/u, '★ 它必须说清是 0 条')
  assert.match(empty.why, /这条活凭空消失了/u, '★ 以及那个后果')
  assert.match(empty.why, /不许并进 ready/u, '★ 以及"不许并进 ready"')

  const same = decomposeContract(contract, tier, {
    depth: 0,
    decomposer: () => [{ sourceId: 'c', inScope: [...contract.inScope], objective: 'o' }],
  })
  assert.equal(typeof same.why, 'string', '★ 同形拆法的 `why` 必须是字符串')
  assert.match(same.why, /与\*\*原契约同形\*\*/u, '★ 它必须说清是"与原来同形"')
  assert.match(same.why, /原样传下去/u, '★ 以及那个后果')
  assert.match(same.why, /不许并进 ready/u, '★ 以及"不许并进 ready"')

  /** ★★ 而两条理由必须**不同形**（否则读的人分不出该修哪一半的拆解器）。 */
  assert.notEqual(empty.why, same.why, '★ 两条拒绝理由必须不一样')
})

test('★★★★ 臂 T113r：分栏报那一行**逐格**被断言（`plus-to-minus@L2112/2113`）', () => {
  /**
   * ── 契约（t13 点名的 L2112/2113）─────────────────────────────────────────────
   *
   * ★★ 那两行是分栏报：
   *
   *     `大档等人裁决 ${columns.large ?? 0} · 审查没过 ${columns.notReviewed ?? 0}`
   *     + ` · 契约不全 ${columns.contractIncomplete ?? 0} · 写域被挡 ${result.blockedCount}`
   *
   * ★ 而它此前只被 `/大档等人裁决 1/` 碰过 **一格** —— 另外三格从没被读过。
   *   ⇒ 本臂把**四格**用**各不相同**的数喂进去，于是任何一格错位/丢失都当场红。
   */
  const one = (sourceId) => ({
    sourceId, tier: { tier: 'small', why: 'w' },
    contract: { subject: `s-${sourceId}`, kind: 'implementation', objective: 'o', inScope: ['scripts/x.mjs'] },
    assignee: { member: 'a', reasons: ['r'], whyNot: {} },
    review: { outcome: 'passed', checks: [] },
  })
  const text = renderDispatchable({
    ready: [one('r1'), one('r2')],
    /** ★ 大档 3 条 —— 以及每一条都要带裁决所需的两格（否则渲染会炸）。 */
    awaitingRuling: [1, 2, 3].map((i) => ({
      sourceId: `L${i}`, subject: `s${i}`, inScope: ['src/a.ts'],
      whyLarge: 'w', blockingQuestion: 'q', nextStep: 'decompose', signals: {},
    })),
    cannotEmit: [{ sourceId: 'c1', missing: ['缺 A'] }],
    rejected: [],
    /** ★ 写域被挡 5 条（与其它三格**都不同**）。 */
    blockedCount: 5,
    notReadyBecause: { large: 3, notReviewed: 4, contractIncomplete: 1, scopeBlocked: 5 },
  })
  console.log(`    ℹ 分栏行：${text.split('\n').filter((l) => l.includes('分栏（')).join('')}`)

  /**
   * ★★ 四格**各自**钉住，而它们的数**互不相同**（3 / 4 / 1 / 5）——
   *   于是"某两格串了"也会红，不只是"某一格没了"。
   */
  assert.match(text, /大档等人裁决 3/u, '★ 第一格（大档）')
  assert.match(text, /审查没过 4/u, '★ 第二格（审查没过）—— 而它此前从没被读过')
  assert.match(text, /契约不全 1/u, '★ 第三格（契约不全）')
  assert.match(text, /写域被挡 5/u, '★ 第四格（写域被挡）')

  /** ★ 而那一行里**不许出现 NaN**（那是拼接被换成减法时最容易漏过的一格）。 */
  assert.equal(text.includes('NaN'), false, '★★ 分栏报里出现了 NaN（plus-to-minus@L2112/2113 的红）')
})

test('★★★★ 臂 T113s：`--emit-task` 找不到 id 时的那段提示**逐句**被断言', async () => {
  /**
   * ── 契约（t13 点名的 `plus-to-minus@L2173`）───────────────────────────────────
   *
   * ★★ 那是 CLI 的"找不到"分支，而它**没有任何臂断言过它的文本** ——
   *   此前只测了 exitCode=1。⇒ 把拼接的 `+` 换成 `-` 会往输出里塞一个 `NaN`，
   *   而**没有人读那句话** ⇒ 变异体存活。
   *
   * ★ 而它的实用价值也是真的：那句"已看过的：…"是**唯一**告诉人
   *   "有哪些 id 是有效的"的地方。
   */
  const { spawnSync } = await import('node:child_process')
  const l = ledger({ frictions: [friction('f-open', 'open')], judgements: [] })
  try {
    const r = spawnSync('node', [TOOL, '--frictions', l.fdir, '--judgements', l.jdir, '--emit-task', 'nope-1'], { encoding: 'utf8' })
    assert.equal(r.status, 1, '★ 找不到 ⇒ exit=1')
    /** ★ 而下面两句**逐句**钉住 —— 它们是那条分支的全部内容。 */
    assert.match(r.stdout, /★ 找不到 "nope-1"/u, '★ 必须指名找不到的是哪一个 id')
    assert.match(r.stdout, /它既不在待派里，也不在被挡里/u, '★ 必须说清它是从哪两个池子找的')
    assert.match(r.stdout, /已看过的：/u, '★ 以及"已看过的"那一句（L2173 的拼接）')
    assert.equal(r.stdout.includes('NaN'), false, '★★ 输出里出现 NaN（plus-to-minus@L2173 的红）')
  } finally {
    l.cleanup()
  }
})

test('★★★★ 臂 T113t：`--emit-task` 打出【走过的阶段】与【分档】—— 逐句断言', async () => {
  /**
   * ── 契约（t13 点名的 `plus-to-minus@L2204` 那一组）──────────────────────────────
   *
   * ★★ `--emit-task` 的 ready 分支会印三行"人话"：
   *     分档：<档> —— <为什么>
   *     审查（五问）：<结论>
   *     走过的阶段：tier → review
   *
   * ★ 而"走过的阶段"那一行**是 t113 交付的证据本身**
   *   （它证明两个出口都经过分档那一站）—— 而它此前**从没被断言过文本**。
   */
  const { spawnSync } = await import('node:child_process')
  const l = ledger({ judgements: [judgement('j-0001', '`changed-paths` 那一格必须与 worktree 观察面同源')] })
  try {
    const r = spawnSync('node', [TOOL, '--frictions', l.fdir, '--judgements', l.jdir, '--team', l.dir, '--emit-task', 'j-0001'], { encoding: 'utf8' })
    assert.equal(r.status, 0, `★ 必须 exit=0：\n${r.stderr}`)
    assert.match(r.stdout, /★ 分档：small/u, '★ 必须印出档位')
    assert.match(r.stdout, /★ 审查（五问）：/u, '★ 必须印出审查结论')
    assert.match(r.stdout, /★ 写域：/u, '★ 必须印出写域收窄的结论')
    assert.match(r.stdout, /★ 派工理由：/u, '★ 必须印出派工理由')
    /**
     * ★★★ 而这一行是**本任务的交付证据**：两个出口都经过分档那一站。
     *   ⇒ 它必须在，且顺序必须是 `tier → review`。
     */
    assert.match(r.stdout, /★ 走过的阶段：tier → review/u, '★★ 必须印出走过的阶段（那是"分档是硬性阶段"的证据）')
    assert.equal(r.stdout.includes('NaN'), false, '★★ 输出里出现 NaN（plus-to-minus 那一组的红）')
  } finally {
    l.cleanup()
  }
})
