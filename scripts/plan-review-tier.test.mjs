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

/**
 * ── ★★★ t98：分档现在是【从 triage 脚本 import 的单一真值】──────────────────────
 *
 * ★ 本文件此前**自己实现**了一份 `tierOf`。而 t98 把同一条逻辑也用在了
 *   `friction-triage.mjs` 的派发准入上 ⇒ 于是**同一件事有两份实现**。
 *
 * ★★ 而那正是本队反复记的那个形态：**两份实现会分叉，而分叉之后
 *   "判据说它大、而派发池把它放出去了"在日志里同形。**
 *
 * ⇒ 所以现在只有**一份**实现（`friction-triage.mjs` 导出的 `tierOf`），
 *   而本文件 import 它 —— 判据的装置与派发的准入读**同一份**分档。
 *
 * ★ 而 `TIER` 也一起 import（常量同样不许有两份）。
 */
import { tierOf, TIER } from './friction-triage.mjs'


// ─────────────────────────────────────────────────────────────────────────────
// 语料：三个事故 + 两个正例，全部取自真实台账
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★ 从真实台账里读任务，**不手写** —— 手写会把"我想要的形状"喂给判据 ──────────
 *
 * ★★ t98 修：语料此前只从 `ROOT/.agent-teams/...` 读，而 `ROOT` 是**这个夹具所在的树**
 *   ⇒ 在一个**干净 checkout**（worktree）里，`.agent-teams/` 是 gitignored 的、
 *   **根本不在** ⇒ 三条依赖语料的臂全部 ENOENT 红。
 *
 * ★ 而那条"读数"只在**主树**里成立 —— 它与 t84 那条硬编码 `..×4`、
 *   t80 那 45 个落后的 worktree **是同一族**：
 *   「这棵树里验证过的东西，在另一棵树里还成立吗？」
 *
 * ⇒ 正确做法：**向上找那份台账**（主树与 worktree 都能找到），
 *   而不是假设它就在 `ROOT` 下面 —— 那正是 captain 在 t84 给的那个形状
 *   （「从 here 向上找到含 marker 的那一层」）。
 */
function locateLedger() {
  let dir = ROOT
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, '.agent-teams/planning-loop/team.json')
    if (existsSync(candidate)) return candidate
    dir = join(dir, '..')
  }
  return undefined
}

const LEDGER = locateLedger()

/**
 * ★ 而"找不到台账"要**如实话**，而不是假装它不在 ⇒ 依赖语料的那三条臂在那种
 *   情形下**报出来并跳过**，而不是红。
 *
 * ★ 理由：那三条臂测的是"判据对**真实语料**的读数"；一个没有语料的树里，
 *   那个问题**问不出来** —— 而"问不出来"与"答错了"**不同形**。
 *   ★ 而其它三条臂（三态 / 突变 / 必答项）**不依赖语料**，它们在任何树里都跑。
 */
function corpusOrSkip(t) {
  if (LEDGER === undefined) {
    console.log(
      '    ℹ ★ 本树里找不到 `.agent-teams/planning-loop/team.json`（干净 checkout ⇒ 它被 gitignore）'
      + '⇒ 这一条**问不出来**，跳过。★ 而那不是"通过"。',
    )
    t.skip('the ledger is not present in this checkout — the question cannot be asked here')
    return undefined
  }
  const document = JSON.parse(readFileSync(LEDGER, 'utf8'))
  const tasks = document.tasks ?? []
  const byId = new Map(tasks.map((task) => [task.id, task]))
  console.log(`    ℹ 语料：${LEDGER}`)
  return {
    all: tasks,
    pick: (id) => {
      const task = byId.get(id)
      assert.notEqual(task, undefined, `★ 台账里找不到 ${id} —— 本文件的语料取自真实任务，不许手写`)
      return task
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★★★ 三个真实事故：两个判 large，而第三个**抓不到**（如实报）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★★★ 三个真实事故（t58 / t54 / t70）：判据抓到两个，而第三个抓不到', async (t) => {
  const data = corpusOrSkip(t)
  if (data === undefined) return
  const { pick } = data

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

  /**
   * ── ★★ 而 t70 由**哪一条**信号命中，会随【它做完没有】而变（实测）──────────────
   *
   * MEASURED（t98）：t70 的 `inScope` 含 `src/tools/update-task/` ——
   *   · 在**它还没做**时，那个目录**不存在** ⇒ 信号 B（会新建一个目录）命中
   *   · 在**它做完之后**，那个目录**存在了** ⇒ 信号 B 不命中，
   *     而信号 C（重组词 + 要搬的东西已存在）命中 ⇒ ★ **仍然判 `large`**
   *
   * ⇒ ★ 所以这里**不许**断言"必须由信号 B 命中" —— 那是一条**关于当前台账快照**
   *   的断言，而它会在 t70 完成之后变成假的（而它此刻**已经**是假的）。
   *   ★ 本队记过这个形态：「夹具不得把『当前数量/为空/形状』写成不变量」。
   *
   * ★ 而**真正该钉住的那条性质**是：**它仍然被抓住了，而它与 t54 由不同的信号抓住。**
   */
  const t70Hits = Object.entries(t70.signals).filter(([, hit]) => hit).map(([key]) => key)
  console.log(`    ℹ t70 由哪条信号命中：${t70Hits.join(', ') || '(无)'}`)
  assert.ok(
    t70Hits.length > 0,
    '★ t70 一条信号都没命中 —— 而它是一条真实的大活（拆 update-task.ts 丢了 4 组接线）',
  )
  assert.equal(
    t70.signals.multipleFiles, false,
    '★ t54 与 t70 不该由同一条信号命中 —— 否则三条信号里有一条是多余的',
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
test('臂 2 ★★ 反向半边：不许把所有任务都判成大档（那会让流程瘫痪）', async (t) => {
  const data = corpusOrSkip(t)
  if (data === undefined) return
  const { all } = data
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
test('臂 3 ★★ 反向半边：t90（一行）与 t88（一个夹具）这类小活必须判小档', async (t) => {
  const data = corpusOrSkip(t)
  if (data === undefined) return
  const { pick } = data

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
