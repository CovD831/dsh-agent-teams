/**
 * ── ★★★ P3 · 拆解阶段：大档 → 机械拆成子提案 → 审拆法 → 回到流水线 ────────────────
 *
 * ── 用户原话（这一阶段存在的理由，逐字）─────────────────────────────────────────
 *
 *   「一开始都是去对符合条件的任务产出契约之类的东西，然后可能有的契约根据一些
 *     判定认为不符合原子化的条件，那就得去拆」
 *
 * ── 本文件钉的四件事（而它们各自可核）───────────────────────────────────────────
 *
 *   ① ★ **纯机械、零 token** —— 拆法只按 `tierOf` 已有的三条信号切边界。
 *      而它不是一句承诺：下面有臂证明**同一个输入两次给出同一个结果**，
 *      且**没有任何模型调用**（本文件不 import 任何 LLM 客户端，见臂 D1）。
 *   ② ★ **大档必然经过拆解**（主干上，两个出口都走它）。
 *   ③ ★★ **拆不动时留在队列并指名哪一问** —— 绝不静默降级成一个大任务。
 *   ④ ★ **递归上限 2 层** —— 到顶的子提案留在队列（不是被丢掉，也不是被派出去）。
 *
 * ── ★★ 边界两条（契约点名）────────────────────────────────────────────────────
 *
 *   · **不改回** `friction-triage.mjs` 里那两处反向判断（`!== 'decomposed'` /
 *     `process.argv[1] !== undefined`）—— 臂 A1/A2 逐字钉住它们。
 *   · **落点用锚点字符串不用行号** —— 那两处臂读的是**源码文本里的锚点**，
 *     行号漂了它们仍然绿（而改回 `===` 它们当场红）。
 *
 * Run: node --test scripts/decompose.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MAX_DECOMPOSE_DEPTH,
  decompose,
  decomposeContract,
  dispatchable,
  mechanicalDecompose,
  runPipeline,
  tierOf,
} from './friction-triage.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOOL = join(ROOT, 'scripts', 'friction-triage.mjs')
const SOURCE = readFileSync(TOOL, 'utf8')

/** 一条大活：跨两个现有源码文件（信号 A）。 */
const bigProposal = (extra = {}) => ({
  source: 'judgement', sourceId: 'big-1', kind: 'implementation',
  subject: '判据：某事必须不同形', objective: '把这两处合起来改',
  inScope: ['src/a.ts', 'src/b.ts'],
  acceptance: ['★ 它必须能红'], verify: ['pnpm test:gates'],
  ...extra,
})

const team = (members = []) => ({ members, tasks: [], unreadable: undefined })

// ─────────────────────────────────────────────────────────────────────────────
// 臂 A ★★★ 两条锚点：改回任一处 ⇒ 当场红（契约点名）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 A1 ★★★ 锚点：**不许**改回反向判断（`!== \'decomposed\'`）—— 改回会让 P3 整个不可用', () => {
  /**
   * ── 为什么这一条是【锚点】而不是行号 ────────────────────────────────────────────
   *
   * ★ t14 的教训：行号在同一个任务内漂过 28 行。⇒ 所以这里读的是**那一句话本身**：
   *
   *     if (outcome.status !== 'decomposed') {
   *
   * ★★ 而改回 `===` 的后果是**实的**：那一条判断的意思是"**还没拆**才走下面那条路"，
   *   改回 `===` 会把它反过来 ⇒ P3 的递归那一支**永远走不到**（拆解阶段整个不可用）。
   */
  assert.match(
    SOURCE, /outcome\.status !== 'decomposed'/u,
    '★★★ `!==` 必须原样在（`!== \'decomposed\'`）。改回 `===` 会让整个拆解阶段不可用：'
    + '那条判断问的是"还没拆吗"，反过来之后递归那一支永远走不到。',
  )
  /**
   * ★★ 而负向那一半必须**精确到那一处**，不能全文搜 `=== 'decomposed'` ——
   *   那个写法在别处是**合法**的（例如 `decompose` 里问"它拆了吗"、以及递归那道门）。
   *   ⇒ 全文搜会误报（第一版就是这么红的），而"误报"与"真红"在读数上同形。
   *   ⇒ 所以这里钉的是**那一行本身**：`if (outcome.status !== 'decomposed') {`。
   */
  /**
   * ★★ 而负向那一半**必须把注释剥掉再搜** —— 因为源码里【有一段注释】逐字写着那个
   *   错误形状（"if (outcome.status === 'decomposed') { …拒绝… }   ← 反了"）。
   *   ⇒ 不剥注释会**误报**（第一版就是这么红的），而"误报"与"真红"在读数上同形。
   */
  const codeOnly = SOURCE
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\*/u.test(line) && !/^\s*\/\//u.test(line))
    .join('\n')
  assert.equal(
    /if \(outcome\.status === 'decomposed'\)/.test(codeOnly), false,
    '★★★ 可执行代码里出现了 `if (outcome.status === \'decomposed\')` —— 那是那处反向判断'
    + '被改回的**确切形状**，而它会让 P3 的拆解阶段静默失效（拆不动的东西进不了递归那一支）。',
  )
  assert.match(SOURCE, /if \(outcome\.status !== 'decomposed'\) \{/u,
    '★ 而那一行的**完整形状**（含 `if (` 与结尾 `{`）必须在 —— 它才是锚点。',
  )
})

test('臂 A2 ★★★ 锚点：**不许**改回 CLI 入口判定（`process.argv[1] !== undefined`）', () => {
  /**
   * ★★ 改回 `===` 的后果：整条 CLI 静默失效 —— **stdout 0 字节 / exit 0**，
   *   而那在 CI 里与「成功」同形（这是本队记账过的最贵的一种失败）。
   */
  assert.match(
    SOURCE, /process\.argv\[1\] !== undefined/u,
    '★★★ `process.argv[1] !== undefined` 必须原样在。改回 `===` 会让整条 CLI 静默失效：'
    + 'stdout 0 字节、exit 0 —— 而在 CI 里那与"成功"同形。',
  )
  assert.equal(
    /process\.argv\[1\] === undefined/.test(SOURCE), false,
    '★★★ 源码里出现了 CLI 入口判定的反向写法 ⇒ 那条 CLI 不会再跑，'
    + '而它失败的方式是"什么都不输出、退出码 0"。',
  )
})

test('臂 A3 ★★ 两条锚点都真的被用到（不是两句死代码）', () => {
  /** ★ 一条锚点若只出现在这里、而产品代码里没有消费者，那本文件就是在钉一份注释。 */
  const usesReverse = SOURCE.split('\n').filter((line) => line.includes("!== 'decomposed'")).length
  assert.ok(usesReverse >= 1, '★ `!== \'decomposed\'` 必须在产品代码里真的被用到')
  const invoked = SOURCE.split('\n').filter((line) => line.trimStart().startsWith('if (invokedDirectly)')).length
  assert.ok(invoked >= 1, '★ 而 CLI 那一条判定必须真的被 `if (invokedDirectly)` 消费')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 B ★★★ 大档必然经过拆解，且拆出来的东西真的变小了
// ─────────────────────────────────────────────────────────────────────────────

test('臂 B1 ★★★ 大档必然经过拆解（主干上）—— 定向突变：让它绕过分档 ⇒ 本臂红', () => {
  const outcome = runPipeline(bigProposal(), team([{ name: 'a', status: 'idle' }]))
  assert.equal(outcome.tier.tier, 'large', '★ 前置：它必须被判大档')
  assert.ok(outcome.trace.includes('tier'), '★ 而它必须**走过**分档那一站（trace 可核）')
  assert.equal(outcome.stage, 'decomposed',
    '★★ 大档必须被拆（P3 落地后这是主干上的一条硬性阶段）')
  assert.equal(outcome.emitted, undefined,
    '★★★ 而它**绝不许**拿到契约 —— "派出的不应该有大活"')
  assert.equal(outcome.decomposition?.decomposed, true, '★ 而那一格要报出"真的拆了"')
  assert.ok(outcome.decomposition.count >= 2, '★ 两条文件写域 ⇒ 至少 2 条子活')
})

test('臂 B2 ★★★ 拆出来的子活**真的变小了**（信号集合真包含于原来）', () => {
  const outcome = runPipeline(bigProposal(), team([{ name: 'a', status: 'idle' }]))
  const children = outcome.runs.map((run) => run.child)
  assert.ok(children.length >= 2, '★ 前置：拆出了多条')

  /**
   * ★★ 判据：每条子活**都**比原来小 —— 而那不是一个主观判断，用的是**同一条 `tierOf`**。
   *   ★ 而"小"的定义要精确：不是"必须判小档"（一条目录搬运子活天然仍带信号 B），
   *     而是**它的信号集合严格小于原来的**（见 `mechanicalDecompose` 里那段）。
   */
  const original = tierOf(bigProposal(), { exists: () => false })
  const originalCount = Object.values(original.signals).filter(Boolean).length
  assert.equal(originalCount, 1, '★ 前置：原提案只有信号 A')

  for (const child of children) {
    const verdict = tierOf(child, { exists: () => false })
    const childCount = Object.values(verdict.signals).filter(Boolean).length
    assert.ok(childCount < originalCount,
      `★★ 子活 ${JSON.stringify(child.inScope)} 的信号数 ${childCount} 没有小于原来的 ${originalCount}`
      + ' —— 那说明这次拆解没消灭大档（只是把大活换了个名字）。')
  }
})

test('臂 B3 ★★★ 子活**回到流水线入口**（递归），而不是就地宣布合格', () => {
  const outcome = runPipeline(bigProposal(), team([{ name: 'a', status: 'idle' }]))
  assert.ok(outcome.trace.includes('recurse'), '★ 主干必须记下"递归回去"这一步（trace 可核）')
  assert.ok(Array.isArray(outcome.runs) && outcome.runs.length >= 2,
    '★ 而每条子活**各自**有一条完整的运行记录（不是只报一个条数）')
  for (const run of outcome.runs) {
    assert.ok(typeof run.stage === 'string', '★ 每条子活都要有它自己的结论')
    assert.ok(Array.isArray(run.trace) && run.trace.length > 0, '★ 以及它自己走过的路')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 C ★★★ 拆不动时留在队列并指名哪一问（绝不静默降级）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 C1 ★★★ 递归到顶 ⇒ 留在队列 + 指名哪一问（绝不静默降级成一个大任务）', () => {
  const tier = { tier: 'large', why: 'spans 2 existing source files', blockingQuestion: 'it spans 2 files' }
  const contract = { sourceId: 'c-1', inScope: ['src/a.ts', 'src/b.ts'], objective: '改这两处' }

  const atCeiling = decompose(tier, contract, { depth: MAX_DECOMPOSE_DEPTH })
  assert.equal(atCeiling.status, 'unmeasured', '★ 到顶 ⇒ 如实落 unmeasured（不许编一个"拆完了"）')
  assert.equal(atCeiling.decomposed, false, '★ 而它**没有**拆出东西 —— 那一格不许被填成 true')
  assert.equal(atCeiling.children, undefined, '★★ 绝不许交出一个空数组（那是"这条活凭空消失了"）')
  assert.notEqual(atCeiling.blockingQuestion, undefined, '★★★ 必须【指名哪一问】')
  assert.equal(atCeiling.blockingQuestion, 'it spans 2 files', '★ 而那一问就是分档给的那一条')
  assert.ok(atCeiling.missing.length > 0, '★ 而"缺什么"要逐项说清')
})

test('臂 C2 ★★★ "拆不动"在主干上落 `awaitingRuling`（留在队列），而**不在** ready', () => {
  /**
   * ★ 造一条**到顶**的：让拆解器每次把同一个多文件大活还回来 ⇒ 递归到顶。
   *   ★ 而它必须**留在队列**（awaitingRuling）—— 那正是"绝不静默降级成一个大任务"。
   */
  const stubborn = ({ depth }) => depth >= MAX_DECOMPOSE_DEPTH
    ? undefined
    : [{ sourceId: `c${depth}`, kind: 'implementation', subject: 's', objective: '拆分', acceptance: ['x'], verify: ['pnpm test:gates'], inScope: ['src/x.ts', 'src/y.ts', `src/z${depth}.ts`] }]

  const outcome = runPipeline(bigProposal({ sourceId: 'stubborn-1' }), {
    ...team([{ name: 'a', status: 'idle' }]), decomposer: stubborn,
  })
  assert.equal(outcome.stage, 'decomposed', '★ 第一层拆得动')
  const depth1 = outcome.runs[0]
  assert.equal(depth1.stage, 'decomposed', '★ 第二层也拆得动')
  const depth2 = depth1.runs[0]
  assert.equal(depth2.stage, 'awaitingRuling',
    '★★★ 到顶那一条必须**留在队列**（awaitingRuling）—— 不许静默降级成一个大任务派出去')
  assert.notEqual(depth2.decomposition?.blockingQuestion, undefined, '★★★ 而它必须**指名哪一问**')
  assert.match(String(depth2.decomposition?.why ?? ''), /递归/u, '★ 而理由要说清是"到顶"（不是"我不会"）')
})

test('臂 C3 ★★★ 留在队列的那一条**不在** ready 里（跨栏可核）', () => {
  const stubborn = ({ depth }) => depth >= MAX_DECOMPOSE_DEPTH
    ? undefined
    : [{ sourceId: `c${depth}`, kind: 'implementation', subject: 's', objective: '拆分', acceptance: ['x'], verify: ['pnpm test:gates'], inScope: ['src/x.ts', 'src/y.ts', `src/z${depth}.ts`] }]
  const result = dispatchable(
    { toDispatch: [bigProposal({ sourceId: 's-1' })], blocked: [], noAction: [], autoRecorded: [], unknown: [] },
    { ...team([{ name: 'a', status: 'idle' }]), decomposer: stubborn },
  )
  const allIds = (list) => list.map((entry) => entry.sourceId)
  assert.deepEqual(allIds(result.decomposed), ['s-1'], '★ 它进拆解那一栏')
  assert.equal(result.ready.some((entry) => entry.sourceId === 's-1'), false,
    '★★★ 而它**绝不许**出现在 ready 里 —— 那正是"大活从拆解里溜进 ready"')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 D ★★★ 零 token（纯机械）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 D1 ★★★ 零 token：拆解路径**不 import 任何模型客户端**', () => {
  /**
   * ★ 契约：「拆解**零 token**（不调用任何模型）」。
   *   ⇒ 本臂读**源码文本**：`friction-triage.mjs` 里不许出现任何 LLM 客户端 import。
   *   ★ 而那是一条**可核的**断言（不是"我保证"）：一个 import 就能让本臂红。
   */
  const importLines = SOURCE.split('\n').filter((line) => /^\s*import\s/u.test(line) || /require\(/u.test(line))
  const forbidden = /openai|anthropic|@deepseek|dsh-agent|llm|completion|chat\.|model|prompt\(/iu
  for (const line of importLines) {
    assert.equal(forbidden.test(line), false,
      `★★ 拆解路径里出现了疑似模型调用的依赖：${line.trim()}\n`
      + '★ 契约要求拆解【零 token】—— 它必须只按 tierOf 的三条信号切边界。')
  }
})

test('臂 D2 ★★★ 零 token：拆解是**纯函数** —— 同一输入两次给出同一结果', () => {
  const tier = tierOf(bigProposal(), { exists: () => false })
  const first = mechanicalDecompose({ tier, proposal: bigProposal(), depth: 0 })
  const second = mechanicalDecompose({ tier, proposal: bigProposal(), depth: 0 })
  assert.deepEqual(first, second,
    '★★ 拆解必须是纯函数：同一 (tier, proposal, depth) 两次给出同一结果。'
    + '一个有随机性/模型参与的拆解器会让"拆法可复现"这句话不成立。')
  /** ★ 而它不读盘：`exists` 缺省仍能跑（存在性只经由 `tier.signals` 进来）。 */
  assert.equal(first.status, 'decomposed', '★ 而它照常拆得动')
})

test('臂 D3 ★★ 零 token：拆法**只按三条信号**切（换掉信号 ⇒ 换掉拆法）', () => {
  /**
   * ★ 反向半边：若拆法读了别的东西（模型、文件内容、时间），那么**同一份写域、
   *   不同的 `tier.signals`** 会给出**同样的**拆法 —— 而那说明信号没起作用。
   */
  /**
   * ★★ 写域要**同时**含"多条文件"与"一个新目录" —— 否则两条信号里的某一条
   *   产不出子活，而那会让"换信号换不换拆法"这件事测不出来。
   */
  const proposal = bigProposal({ inScope: ['src/a.ts', 'src/b.ts', 'src/newdir/'] })
  const onlyA = mechanicalDecompose({
    tier: { tier: 'large', signals: { multipleFiles: true, restructuresDirectory: false, movesExistingCode: false } },
    proposal, depth: 0,
  })
  const onlyB = mechanicalDecompose({
    tier: { tier: 'large', signals: { multipleFiles: false, restructuresDirectory: true, movesExistingCode: false } },
    proposal, depth: 0,
  })
  assert.deepEqual(onlyA.children.map((child) => child.inScope), [['src/a.ts'], ['src/b.ts']],
    '★ 只开信号 A ⇒ 只按文件切')
  assert.deepEqual(onlyB.children.map((child) => child.inScope), [['src/newdir/']],
    '★ 只开信号 B ⇒ 只按目录切（而"重组目录"本身就是一条原子搬运）')
  assert.notDeepEqual(
    onlyA.children.map((child) => child.inScope),
    onlyB.children.map((child) => child.inScope),
    '★★ 信号不同 ⇒ 拆法必须不同（否则说明拆法读的不是信号）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 E ★★ 审拆法：拆法本身要过五问
// ─────────────────────────────────────────────────────────────────────────────

test('臂 E1 ★★ 拆法本身要过五问（复用 adversarialReview，不为拆解另写一套）', () => {
  const outcome = runPipeline(bigProposal(), team([{ name: 'a', status: 'idle' }]))
  assert.notEqual(outcome.decompositionReview, undefined, '★ 拆法必须被审（五问那一站）')
  /**
   * ⚠️ MEASURED（P3 当场抓出来）：那一格叫 **`outcome`**，**不是** `status`。
   *   ★ 而我在产品代码里第一版写的就是 `status` ⇒ 那个 `!== 'rejected'` **恒真**
   *     ⇒ 审拆法那道门**被静默跳过**（"门守住了"与"门读了 undefined"同形）。
   *   ⇒ 所以本臂钉的是**那个字段名**：它错了，门就没了。
   */
  assert.equal(typeof outcome.decompositionReview.outcome, 'string',
    '★★ 审查结论那一格叫 `outcome`（不是 `status`）—— 读错字段名会让那道门**恒真**，'
    + '而"门守住了"与"门读了 undefined"在读数上同形。')
  assert.ok(Array.isArray(outcome.decompositionReview.checks), '★ 而五个问的逐条结论要在')
  assert.ok(Array.isArray(outcome.decompositionReview.failedIds), '★ 以及"哪几问真的失败了"')
  /** ★ 而它**不是**一个给拆解另写的审查器：源码里那处必须调用同一个 `adversarialReview`。 */
  assert.match(SOURCE, /const decompositionReview = adversarialReview\(/u,
    '★ 拆法那一站必须**复用** `adversarialReview`（同一个函数、同一套五问）——'
    + '为拆解另写一套会让两份分叉，而分叉之后"审过了"在日志里同形。');
})

test('臂 E2 ★★ 审拆法没过 ⇒ 子活**留在队列**（不许"拆了就算过"）', () => {
  /**
   * ★ 造一个**拆得动**、而审查会拒的拆法：子活的任务语与原样同形 ⇒ 五问里那一条会拒。
   *   ★ 而它必须留在 awaitingRuling，且理由指名哪一问。
   */
  const outcome = runPipeline(bigProposal({ sourceId: 'e2-1' }), {
    ...team([{ name: 'a', status: 'idle' }]),
    /** ★ 一个"合法但薄弱"的拆法：写域变了，而 objective 一字不改（审查会挑）。 */
    decomposer: () => [
      { sourceId: 'e2-a', kind: 'implementation', subject: 's', objective: '把这两处合起来改', acceptance: ['x'], verify: ['pnpm test:gates'], inScope: ['src/a.ts'] },
    ],
  })
  /** ★ 它只要**留在了队列**（而不是被静默放行）就满足本臂的要求。 */
  assert.notEqual(outcome.stage, 'ready', '★★ 一审没过的拆法**绝不许**进 ready')
  assert.notEqual(outcome.decompositionReview, undefined, '★ 而审查结论必须在返回值里')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 F ★★ 递归上限 2 层（数字本身可核）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 F1 ★★ 递归上限是 **2**，且到顶时子提案留在队列', () => {
  assert.equal(MAX_DECOMPOSE_DEPTH, 2, '★ 契约点名的上限是 2 层')
  const tier = { tier: 'large', why: 'spans 2 files', blockingQuestion: 'q' }
  const contract = { sourceId: 'f-1', inScope: ['src/a.ts', 'src/b.ts'], objective: '改这两处' }
  for (const depth of [0, 1]) {
    assert.equal(decompose(tier, contract, { depth }).status, 'decomposed', `★ depth=${depth} 时应照常拆`)
  }
  for (const depth of [2, 3, 9]) {
    const out = decompose(tier, contract, { depth })
    assert.equal(out.status, 'unmeasured', `★ depth=${depth}（≥ 上限）时必须停 —— 过深的拆解要人拍板`)
    assert.equal(out.children, undefined, '★ 而它不许交出子活')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 G ★★ 两条非法拆法当场拒（P3 的验收网）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 G1 ★★★ 拆出 0 条 ⇒ 当场拒（那不是"拆完了"，是"这条活凭空消失了"）', () => {
  const tier = { tier: 'large', why: 'spans 2 files', blockingQuestion: 'q' }
  const contract = { sourceId: 'g-1', inScope: ['src/a.ts', 'src/b.ts'], objective: '改这两处' }
  const empty = decomposeContract(contract, tier, { depth: 0, decomposer: () => [] })
  assert.equal(empty.status, 'unmeasured', '★ 拆出 0 条必须被拒')
  assert.equal(empty.children, undefined, '★ 而它不许把空数组交给下游当子提案')
})

test('臂 G2 ★★★ 拆出来的与原样同形 ⇒ 当场拒（下一轮还会被判大档）', () => {
  const tier = { tier: 'large', why: 'spans 2 files', blockingQuestion: 'q' }
  const contract = { sourceId: 'g-2', inScope: ['src/a.ts', 'src/b.ts'], objective: '改这两处' }
  const sameShape = decomposeContract(contract, tier, {
    depth: 0,
    decomposer: () => [{ sourceId: 'child-1', inScope: [...contract.inScope], objective: '同一条活' }],
  })
  assert.equal(sameShape.status, 'unmeasured', '★ 与原样同形必须被拒')
  assert.equal(sameShape.children, undefined, '★ 而它不许把那个"子活"放下去')
})

test('臂 G3 ★★ 反面对照：**合法**的拆法必须被放行（否则上面两条可能是"一律拒绝"）', () => {
  const tier = { tier: 'large', why: 'spans 2 files', blockingQuestion: 'q' }
  const contract = { sourceId: 'g-3', inScope: ['src/a.ts', 'src/b.ts'], objective: '改这两处' }
  const legal = decomposeContract(contract, tier, {
    depth: 0,
    decomposer: () => [
      { sourceId: 'child-a', inScope: ['src/a.ts'], objective: '只改 a' },
      { sourceId: 'child-b', inScope: ['src/b.ts'], objective: '只改 b' },
    ],
  })
  assert.equal(legal.status, 'decomposed', '★ 写域真的变小了 ⇒ 那是合法拆法，不许一律拒绝')
  assert.equal(legal.children.length, 2, '★ 而那两条子活要真的交下去')
})
