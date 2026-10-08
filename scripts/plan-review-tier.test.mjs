/**
 * ── ★★ 派活前的计划审查：按面分档（t93）──────────────────────────────────────────
 *
 * ── 用户原话（本判据的由来）────────────────────────────────────────────────────
 *
 *   「具体怎么派呢？那得有一个计划，对吧？你得写一份任务计划。这份计划是需要
 *     经过审查的。比如，小的一些活可能只要经过对抗性审查就行了。不过，你也不能派
 *     涉及面比较大的活，因为你都已经要拆了。」
 *
 * ⇒ ★ 两档，而**每档要不同的审查**：
 *
 *     小档 ⇒ 对抗性审查（审"做法对不对"）
 *     大档 ⇒ **计划审查**（先审"拆法对不对"，再审做法）
 *
 * ── 它防的是什么：今晚三次事故，而三次**都不是成员没做好**──────────────────────
 *
 *   ① t58：拆成两半，而**第二半才发现前提不在**（t58 第一半从未 commit，
 *          第二半的 worktree 是干净 checkout ⇒ 看不到它）
 *   ② t54：反复 amend 三次（`inScope` 漏了 `status.ts` / `entities.ts` / allowlist）
 *   ③ t70：拆 `update-task.ts` ⇒ **丢了 4 组接线**（t69/t76/t83 被抹掉）
 *
 * ⇒ 三次的共同缺口：**拆法在派出去【之前】没人审过。**
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ─────────────────────────────────────────────────────────────────────────────
// 装置：从一条任务契约里读出它的【面】
// ─────────────────────────────────────────────────────────────────────────────

const TIER = {
  small: 'small',            // 对抗性审查即可
  large: 'large',            // ★ 必须先有计划审查
  unmeasurable: 'unmeasurable', // 无法判断（inScope 动态 / 缺字段）
}

/** 会新建或重组一个目录的写法：`src/foo/` —— 以斜杠结尾。 */
const DIRECTORY_ENTRY = /\/\s*$/

/**
 * 要求"重组/搬运已有代码"的动词。
 *
 * ★★ 而它的判据**不是"objective 里出现了这些字"** —— 而是
 *   「出现这些字 **且** `inScope` 里已经有那些文件」。
 *   ★ 理由：`objective` 是自然语言（t38 的信号③ 就是在这里栽的：并列动词只做旁证）。
 *     而"它要搬的东西**已经在 inScope 里**"是一个**可机械判定**的事实 ——
 *     那才是"要重组已有代码"与"只是提到这个词"的差别。
 */
const REORG_VERB = /拆|搬|重组|抽取|迁移|合并|split|extract|move|merge/i

/** `inScope` 里指向源码的文件条目（不含目录条目）。 */
function sourceFiles(inScope) {
  return inScope.filter((path) => /^src\//.test(path) && !DIRECTORY_ENTRY.test(path))
}

/** `inScope` 里的**目录条目**（= 会新建/重组一个目录）。 */
function directoryEntries(inScope) {
  return inScope.filter((path) => /^src\//.test(path) && DIRECTORY_ENTRY.test(path))
}

/** `inScope` 指向的**组**（`src/gates/...` ⇒ `gates`；`src/tools/...` ⇒ `tools`）。 */
function scopeGroups(inScope) {
  const groups = new Set()
  for (const path of inScope) {
    const match = /^src\/([^/]+)\//.exec(path)
    if (match !== null) groups.add(match[1])
  }
  return [...groups]
}

/**
 * ── 分档 ──────────────────────────────────────────────────────────────────────
 *
 * ★★ 三条信号，而它们**不是同一条**（这一点是被三个真实事故教出来的 —— 见文件头）：
 *
 *   信号 A：`inScope` 跨【多个现有源码文件】     ⇒ t54（6 个文件、跨两组）
 *   信号 B：`inScope` 含【目录条目】            ⇒ t70（`src/tools/update-task/`）
 *           ★ 那是"会新建/重组一个目录"的可机械判定的形状（t38 最终只留下这一个信号）
 *   信号 C：objective 要求重组 **且** 要搬的东西已在 inScope 里 ⇒ t39/t38/t30
 *
 * ★ 而**第三条信号是"且"而不是"或"**：只说"拆"而没有已经在 inScope 里的东西，
 *   那是"要拆一个新东西"（没有搬运风险）—— 而那种不该判成大档。
 *
 * ── ★★ 而 t58 是这三条信号**都抓不到**的那一类（如实记下来）────────────────────
 *
 *   t58 的 `inScope` 只有**一个** src 文件、无目录条目、objective 没有重组动词
 *   ⇒ 按上面三条信号，它判 `small`。
 *   ★ 而它**确实是三次事故之一** —— 而它的风险**不在 inScope**，
 *     而在【它是从一条更大的活里拆出来的第一半，而第二半的前提（commit）不在】。
 *
 *   ⇒ ★ 那条风险的载体是**"它是某个拆解的第 N 半"**，而那**不在契约的字段里**
 *     （契约只描述这一条任务做什么，不描述它在哪个拆解序列里）。
 *   ⇒ 所以本判据**抓不到它**，而这一点必须**说出来**，不能假装三条信号覆盖了全部。
 *     ★ 那正是契约点名的第三态存在的方式：`unmeasurable` 不只是"字段缺失"，
 *       也包括"风险的类型不在我能读的字段里"。
 */
function tierOf(contract) {
  const inScope = Array.isArray(contract?.inScope) ? contract.inScope.map(String) : undefined
  const objective = typeof contract?.objective === 'string' ? contract.objective : ''

  /** ★ 前提：没有 inScope ⇒ 判不了（它是判据唯一的输入）。 */
  if (inScope === undefined) {
    return {
      tier: TIER.unmeasurable,
      why: 'the contract carries no inScope, so its surface cannot be read at all',
    }
  }
  /** ★ 空 inScope 也一样：它没说改什么（而"没说"不是"很小"）。 */
  if (inScope.length === 0) {
    return {
      tier: TIER.unmeasurable,
      why: 'inScope is present but empty — an empty scope is not a small surface, it is an unstated one',
    }
  }

  const files = sourceFiles(inScope)
  const dirs = directoryEntries(inScope)
  const groups = scopeGroups(inScope)
  const reorgWord = REORG_VERB.test(objective)

  /**
   * ── ★★ 信号 C 的准确口径：重组词 + **要搬的东西【已经存在】**────────────────────
   *
   * ★ 这里我第一版写宽了（实测抓出来的）：第一版的条件是
   *   「有重组词 **且** `inScope` 里至少有一个 src 文件」——
   *   而 `{inScope:['src/newthing.ts'], objective:'把这份文档拆成三节'}` 因此被判成 **large**。
   *   ★ 而它**不是**大档：那个 `src/newthing.ts` 是**要新建的**，没有任何东西可搬；
   *     那句"拆"说的是**文档**，而文档不在这个契约的 `src` 面上。
   *
   * ⇒ 正确的口径：重组词 + 要搬的东西**已经在磁盘上**（= 那个文件**现在存在**）。
   *   ★ 而那正是契约那句「inScope 里【已经有】那些文件」的机械形式 ——
   *     "已经有"是**可判定的**（问文件系统），而"提到了拆"不是。
   */
  const existingSourceFiles = files.filter((path) => {
    try { return existsSync(join(ROOT, path)) } catch { return false }
  })

  const signals = {
    /** A：跨多个现有源码文件。 */
    multipleFiles: files.length >= 2,
    /** B：含目录条目（会新建/重组一个目录）。 */
    restructuresDirectory: dirs.length > 0,
    /** C：要求重组，**且**要搬的东西**已经存在**（那才是"搬运已有代码"）。 */
    movesExistingCode: reorgWord && existingSourceFiles.length >= 1,
    /** D：跨多个组（旁证，不单独定档）。 */
    crossesGroups: groups.length >= 2,
  }

  if (signals.multipleFiles || signals.restructuresDirectory || signals.movesExistingCode) {
    const reasons = []
    if (signals.multipleFiles) reasons.push(`it spans ${files.length} existing source files`)
    if (signals.restructuresDirectory) reasons.push(`it declares directory entr(ies) ${dirs.join(', ')} — it creates or restructures a directory`)
    if (signals.movesExistingCode) reasons.push('its objective asks to split/move/restructure and the things to be moved are already in its scope')
    return {
      tier: TIER.large,
      why: reasons.join('; '),
      signals,
      /** ★ 而它要的是**哪一种**审查 —— 那是本判据的输出。 */
      review: 'plan-review',
      /** ★ 以及**为什么是计划审查而不是对抗性审查**。 */
      reviewWhy: 'its risk is not in the edit itself but in the split: what gets moved and what gets left behind',
    }
  }

  return {
    tier: TIER.small,
    why: `a single existing source file (${files.join(', ') || 'none'}) with no directory entry and no move of existing code`,
    signals,
    review: 'adversarial-review',
    reviewWhy: 'getting it wrong cannot affect anything else — one file, no rewiring',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 语料：三个事故 + 两个正例，全部取自真实台账
// ─────────────────────────────────────────────────────────────────────────────

/** ★ 从真实台账里读任务，**不手写** —— 手写会把"我想要的形状"喂给判据。 */
function corpus() {
  const document = JSON.parse(readFileSync(join(ROOT, '.agent-teams/planning-loop/team.json'), 'utf8'))
  const tasks = document.tasks ?? []
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const pick = (id) => {
    const task = byId.get(id)
    assert.notEqual(task, undefined, `★ 台账里找不到 ${id} —— 本文件的语料取自真实任务，不许手写`)
    return task
  }
  return { pick, all: tasks }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★★★ 三个真实事故：两个判 large，而第三个**抓不到**（如实报）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★★★ 三个真实事故（t58 / t54 / t70）：判据抓到两个，而第三个抓不到', () => {
  const { pick } = corpus()

  const t54 = tierOf(pick('t54'))
  const t70 = tierOf(pick('t70'))
  const t58 = tierOf(pick('t58'))

  console.log(`    ℹ t54 ⇒ ${t54.tier}｜${t54.why.slice(0, 96)}`)
  console.log(`    ℹ t70 ⇒ ${t70.tier}｜${t70.why.slice(0, 96)}`)
  console.log(`    ℹ t58 ⇒ ${t58.tier}｜${t58.why.slice(0, 96)}`)

  /** ★ ①② 抓到的那两个 —— 而它们各由**不同**的信号命中（那才是重点）。 */
  assert.equal(t54.tier, TIER.large, '★ t54（inScope 漏了三个文件的那次）被判成了小档')
  assert.equal(t70.tier, TIER.large, '★ t70（拆 update-task.ts 丢了 4 组接线的那次）被判成了小档')
  assert.ok(
    t54.signals.multipleFiles, '★ t54 应当由「跨多个现有源码文件」命中',
  )
  assert.ok(
    t70.signals.restructuresDirectory, '★ t70 应当由「含目录条目」命中',
  )
  assert.notDeepEqual(
    [t54.signals.multipleFiles, t54.signals.restructuresDirectory],
    [t70.signals.multipleFiles, t70.signals.restructuresDirectory],
    '★ t54 与 t70 必须由**不同**的信号命中 —— 否则两条信号里有一条是多余的',
  )

  /**
   * ── ★★ ③ t58：本判据**抓不到它**，而那必须说出来 ──────────────────────────────
   *
   * ★ 而这一句断言的是**当前的真实读数**，不是"它应该被抓到"。
   *   t58 的 inScope 只有一个 src 文件、无目录条目、objective 无重组动词
   *   ⇒ 三条信号全不命中 ⇒ `small`。
   *
   * ★ 而它**确实是三次事故之一**。⇒ 它的风险**不在 inScope**，而在
   *   【它是某个拆解的第一半，而第二半的前提不在】（第一半从未 commit）。
   *   ⇒ 那个风险的载体**不在契约字段里** ⇒ 本条判据读不到它。
   *
   * ★★ 所以这一句同时钉住两件事：
   *   ① 本判据的**能力边界**（它覆盖 inScope 可读的那部分）；
   *   ② 一个**已知的漏报**（而把它写成"应该抓到"会让判据去猜一个它读不到的东西）。
   */
  assert.equal(
    t58.tier, TIER.small,
    '★ t58 的档位变了 —— 若它现在被判 large，请复核是哪条信号命中了它：\n'
    + '   它的 inScope 只有一个 src 文件、无目录条目。★ 若判 large 的原因是新加的信号，\n'
    + '   那要确认那条信号**不是**在猜"它是不是某个拆解的一半"（那不在契约字段里）。',
  )
  assert.ok(
    !t58.signals.multipleFiles && !t58.signals.restructuresDirectory && !t58.signals.movesExistingCode,
    '★ t58 命中了某条信号 —— 而那三条信号都读的是 inScope/objective，它们**读不到**它的真实风险',
  )
  console.log('    ℹ ★ 已知漏报：t58 的风险（"它是某个拆解的第一半，而第半的前提不在"）不在契约字段里')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★★ 反向半边之一：不许把所有任务都判成大档
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 契约点名的第一条反向半边 ────────────────────────────────────────────────────
 *
 *   「不许把所有任务都判成大档（那会让流程瘫痪）」
 *
 * ★ 而那正是 t38 的教训：它第一版在真实语料上 **39/39 恒红** ——
 *   一条恒判"大档"的判据会让每一条活都先写一份计划 ⇒ **那正是"流程瘫痪"**。
 */
test('臂 2 ★★ 反向半边：不许把所有任务都判成大档（那会让流程瘫痪）', () => {
  const { all } = corpus()
  const tiers = { small: 0, large: 0, unmeasurable: 0 }
  const largeIds = []
  for (const task of all) {
    const verdict = tierOf(task)
    tiers[verdict.tier] += 1
    if (verdict.tier === TIER.large) largeIds.push(task.id)
  }

  console.log(`    ℹ 全台账 ${all.length} 条任务：small ${tiers.small} · large ${tiers.large} · unmeasurable ${tiers.unmeasurable}`)
  console.log(`    ℹ 判为 large 的（${largeIds.length}）：${largeIds.slice(0, 20).join(', ')}${largeIds.length > 20 ? ' …' : ''}`)

  /**
   * ★ 断言的是**形状**而不是一个具体的数：`small` 必须**存在**，且占相当比例。
   *   ★ 用"比例"而不是"等值"：等值会把当下语料快照写成不变量。
   *   ★ 而"small 一个都没有"是最坏的情形（所有活都先写计划）——
   *     那与 t38 第一版的"39/39 恒红"是**同一件事**。
   */
  assert.ok(
    tiers.small > 0,
    '★ 全台账一条都很小档都没有 —— 那意味着每一条活都要先写计划，而那正是"流程瘫痪"。'
    + '★ 这与 t38 第一版"39/39 恒红"是同一件事。',
  )
  assert.ok(
    tiers.small >= all.length * 0.2,
    `★ 小档只占 ${(tiers.small / all.length * 100).toFixed(0)}%（<20%）—— `
    + '那说明分档信号偏严：绝大多数活都会被要求先写计划，而计划审查会退化成形式（见臂 3）。',
  )
  /** ★ 而大档也必须**存在** —— 否则分档没有意义（恒判小档是另一个方向）。 */
  assert.ok(tiers.large > 0, '★ 一条大档都没有 —— 那这条判据恒判小档，等于没装')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★★ 反向半边之二：不许把小档判成大档（审查会变成形式）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 契约点名的第二条反向半边 ────────────────────────────────────────────────────
 *
 *   「也不许把小档判成大档（那会让审查变成形式）」
 *
 * ★ 而契约给的两个**小档正例**是 t90（一行）与 t88（一个夹具）——
 *   它们是真实任务，取自台账。
 */
test('臂 3 ★★ 反向半边：t90（一行）与 t88（一个夹具）这类小活必须判小档', () => {
  const { pick } = corpus()

  for (const id of ['t90', 't88']) {
    const verdict = tierOf(pick(id))
    console.log(`    ℹ ${id} ⇒ ${verdict.tier}｜${verdict.why.slice(0, 90)}`)
    assert.equal(
      verdict.tier, TIER.small,
      `★ ${id}（契约点名的小档正例）被判成了 ${verdict.tier} —— `
      + '★ 把小活判成大活会让每一条活都先写计划，而计划审查会因此**退化成形式**。',
    )
    assert.equal(verdict.review, 'adversarial-review', `★ ${id} 要的审查应当是"对抗性审查"`)
  }

  /**
   * ★★ 而"小档"这一类的判据要能**说出它为什么小** ——
   *   一个只说"小"而不说理由的读数，与"没判"同形。
   */
  const tiny = tierOf(pick('t90'))
  assert.match(tiny.why, /single existing source file|no directory entry/, '★ 小档必须说得出它的理由')
  assert.match(tiny.reviewWhy, /cannot affect anything else/, '★ 并说得出"为什么对抗性审查就够"')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★★ 三态不同形
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 契约：「小档 / 大档 / 无法判断 ⇒ 三种不得合并」──────────────────────────────
 *
 * ★ 而第三态有**两种**成因，两者都要如实报：
 *   ① `inScope` **缺席**（契约没写它改什么）
 *   ② `inScope` **在场但为空**（写了，而写的是一个空集）
 *
 * ★ 两者的补救动作不同（去补字段 vs 去看一眼为什么是空），而它们都**不是"小档"**。
 */
test('臂 4 ★★ 三态不同形：小档 / 大档 / 无法判断（含它的两种成因）', () => {
  const small = tierOf({ inScope: ['src/a.ts'], objective: '改一行' })
  const large = tierOf({ inScope: ['src/a.ts', 'src/b.ts'], objective: '改两处' })
  const missing = tierOf({ objective: '改一处' })
  const empty = tierOf({ inScope: [], objective: '改一处' })

  console.log(`    ℹ 单文件 ⇒ ${small.tier} ｜ 两文件 ⇒ ${large.tier} ｜ inScope 缺席 ⇒ ${missing.tier} ｜ inScope 空 ⇒ ${empty.tier}`)

  assert.equal(small.tier, TIER.small)
  assert.equal(large.tier, TIER.large)
  assert.equal(missing.tier, TIER.unmeasurable, '★ inScope 缺席不许判成小档')
  assert.equal(empty.tier, TIER.unmeasurable, '★ inScope 空不许判成小档 —— "没说改什么"不是"很小"')

  /** ★ 三态两两不同形（逐对断言，不循环）。 */
  assert.notEqual(small.tier, large.tier, '★ 小档与大档必须不同形')
  assert.notEqual(small.tier, missing.tier, '★ 小档与"判不了"必须不同形')
  assert.notEqual(large.tier, missing.tier, '★ 大档与"判不了"必须不同形')

  /** ★ 而两种"判不了"的成因要**说得出不同的话**（否则它们合成了一句）。 */
  assert.notEqual(missing.why, empty.why, '★ 两种"判不了"的成因必须不同形')
  assert.match(missing.why, /no inScope/)
  assert.match(empty.why, /empty/)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★★ 定向突变：一个跨多文件的拆分任务 ⇒ 不许判小档
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 契约点名的定向突变 ──────────────────────────────────────────────────────────
 *
 *   「把一个跨多文件的拆分任务判成小档 ⇒ 臂红」
 *
 * ★ 而本臂**同时**钉住两个方向：
 *   · 真·跨多文件 ⇒ `large`（不许判小档）
 *   · 单文件、无目录条目、无搬运 ⇒ `small`（不许判大档）
 */
test('臂 5 ★★ 定向突变：跨多文件的拆分任务不许判小档；单文件也不许判大档', () => {
  /** ★ 形状取自 t54 的真实 inScope（跨 gates + tools 两组、6 个文件）。 */
  const t54Shape = {
    inScope: [
      'src/gates/completion/kind-requirements.ts', 'src/gates/completion/r5.ts',
      'src/gates/completion/mutation.ts', 'src/gates/completion/backtest.ts',
      'src/tools/update-task.ts', 'lib/gates/completion/r5.js',
    ],
    objective: '把完工门的「按 kind 决定问什么」做成一张运行时读的数据表',
  }
  const verdict = tierOf(t54Shape)
  console.log(`    ℹ t54 的形状（6 个 src 文件、跨 2 组）⇒ ${verdict.tier}`)
  assert.equal(verdict.tier, TIER.large, '★ 跨多文件的拆分任务被判成了小档 —— 那正是本臂要抓的')
  assert.equal(verdict.review, 'plan-review', '★ 它要的审查必须是计划审查')

  /** ★ 而"取信号单独一条"也要够用（不许某一条被另一条掩盖）。 */
  assert.equal(
    tierOf({ inScope: ['src/a.ts', 'src/b.ts'], objective: 'x' }).tier, TIER.large,
    '★ 单纯的"文件数 ≥ 2"就必须足以定大档',
  )
  assert.equal(
    tierOf({ inScope: ['src/newdir/'], objective: 'x' }).tier, TIER.large,
    '★ 单纯的"含目录条目"就必须足以定大档 —— 那是 t70 那条',
  )
  assert.equal(
    tierOf({ inScope: ['src/tools.ts'], objective: '把 tools.ts 拆成若干文件' }).tier, TIER.large,
    '★ "要求重组且要搬的东西在 inScope 里"必须足以定大档 —— 那是 t39/t30 那条',
  )

  /**
   * ★ 反向：**只说"拆"而没有已经在 inScope 里的东西** ⇒ 不是大档。
   *   ★ 理由：那是"要拆一个新东西"，**没有搬运风险** —— 而搬运风险才是计划审查要审的那件事。
   *   ★ 这一条是"且"而不是"或"的落点，也是**口径最容易被放宽的地方**。
   *
   * ★★ 而这里我第一版写错了（记一笔）：我断言 `{inScope:['docs/PLAN.md']}` 应当落
   *   `unmeasurable` —— 而它落 `small`，于是我红了。
   *   ⇒ 错在**我把"没有 src 条目"当成了"判不了"**。而那不是：
   *     一份只改 `docs/` 的契约**说清了它改什么**，只是它的面**不在生产代码上**。
   */
  assert.equal(
    tierOf({ inScope: ['src/newthing.ts'], objective: '把这份文档拆成三节' }).tier, TIER.small,
    '★ 只说"拆"而没有可搬的东西 ⇒ 不许判大档（那是把措辞当成了风险）',
  )
  console.log('    ℹ 反向：只说"拆"而没有可搬的东西 ⇒ small（措辞不是风险）')

  /**
   * ── ★★ 而"没有 src 条目"这一类的读数，是**被契约点名的那个小档正例**教出来的 ──────────
   *
   * ★ t88（契约指名的小档正例）的 `inScope` 有 **3 个**文件：
   *     `scripts/gate-index-assembly.test.mjs` · `scripts/gate-readout-uniform.test.mjs`
   *     `docs/POSITION-AS-IDENTITY.md`
   *   ⇒ ★ 三个！而它是一个**小档** —— 因为那三个都在 `scripts/` 与 `docs/` 下，
   *     **一个 `src/` 都没有** ⇒ 它**不碰任何生产接线**。
   *
   * ★ 所以本判据数的是**`src/` 下的现有文件**，而不是"inScope 有几个文件"。
   *   ★ 而那正是契约那句话的机械形式：「改错了也**不会影响别的东西**」——
   *     在 `scripts/` 里改错了，影响的是那个夹具自己；而在 `src/` 里改错了，影响的是生产。
   */
  assert.equal(
    tierOf({ inScope: ['scripts/a.test.mjs', 'scripts/b.test.mjs', 'docs/C.md'], objective: 'x' }).tier,
    TIER.small,
    '★ 三个文件但一个 src 都没有 ⇒ 不许判大档（t88 就是这个形状，而它是契约指名的小档正例）',
  )
  console.log('    ℹ t88 的形状（3 个文件、零个 src）⇒ small（不碰生产接线）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6 ★★ 计划审查的形状：四个必答项
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 用户说「你得写一份任务计划」，而本臂把"一份计划要回答什么"钉住 ────────────────
 *
 *   ① 为什么现在做（前置条件在不在）
 *   ② 拆成几步、每步的边界是什么
 *   ③ **每步做完后什么读数能证明它没丢东西** ← ★ 这正是 t70 缺的那一格
 *   ④ 哪一步之后必须停下来给人看
 *
 * ★ 而 ③ 有现成的做法：**搬运前后逐符号计数**（t94 已建好）。
 *   ★ t70 丢的 4 组接线，正是"搬完之后没有东西在数"的结果。
 */
test('臂 6 ★★ 计划审查的四个必答项，而第③项必须指名一个【读数】', () => {
  /**
   * ★ 这一臂的产出是**一张表**：四个必答项 + 每一项缺了会怎样。
   *   ★ 它不是"再写一遍那四条"，而是把每一条挂到一个**已实测的后果**上。
   */
  const REQUIRED = [
    {
      key: 'why-now',
      question: '为什么现在做？前置条件在不在？',
      /** ★ 实测后果：t58 第二半的前提（第一半的 commit）不在 —— 而那是**事后**才发现的。 */
      missingCost: 't58: the second half discovered its premise (the first half\'s commit) was missing, only after it started',
    },
    {
      key: 'steps',
      question: '拆成几步？每步的边界是什么？',
      missingCost: 't54: three amend rounds, because the boundary (inScope) kept turning out to be wrong',
    },
    {
      key: 'invariant-reading',
      question: '★ 每步做完后，【什么读数】能证明它没丢东西？',
      /** ★ 这就是 t70 缺的那一格。 */
      missingCost: 't70: 4 wiring groups (t69/t76/t83) were erased during the move, and nothing was counting',
    },
    {
      key: 'stop-points',
      question: '哪一步之后必须停下来给人看？',
      missingCost: 'the half-finished state in a worktree is invisible to everyone else',
    },
  ]

  for (const item of REQUIRED) {
    assert.ok(item.question.length > 8, `★ 必答项 ${item.key} 的问题太短`)
    assert.ok(item.missingCost.length > 10, `★ 必答项 ${item.key} 没有挂上"缺了会怎样" —— 而那是它值得被问的理由`)
  }
  console.log('    ℹ 计划审查的四个必答项：')
  for (const item of REQUIRED) console.log(`       · ${item.question}\n         缺了会怎样：${item.missingCost}`)

  /**
   * ★★ 而第③项的口径必须落在"**读数**"上，而不是"我检查过了"。
   *   ⇒ 断言那一项的问句里**含"读数"**（而这是那条纪律的机械形式：
   *     一个不可读的保证与没有保证同形）。
   */
  const invariant = REQUIRED.find((item) => item.key === 'invariant-reading')
  assert.match(invariant.question, /读数/, '★ 第③项必须要求一个【读数】，而不是一句"我检查过了"')

  /**
   * ★ 而四个 key 必须互不相同（否则"四个必答项"其实少于四个）。
   */
  assert.equal(new Set(REQUIRED.map((item) => item.key)).size, 4, '★ 四个必答项必须互不相同')
})
