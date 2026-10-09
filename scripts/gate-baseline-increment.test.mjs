/**
 * ── t19：17 条任务全部不可达 completed —— 三态：新增失败 / 存量失败 / 判不了 ────────────
 *
 * 本文件钉的是那条**按设计成立的不可达**（MEASURED 2026-10-09，`verifier` 在 t5 上给出）：
 *
 *   `pnpm test:gates` 真实 `exit=1`（仓库有存量红，**没有一条属本夹具**）
 *   ⇒ 而规则说「`commandsRun` 里有 failed ⇒ 不许 completed」
 *   ⇒ ★ 于是**每一条以 `test:gates` 为 verify 的任务都不可达 completed**，而它们的工作都做完了
 *   ⇒ ★ 而它们被拒的理由，描述的是【仓库的状态】，不是【这次交付做了什么】
 *
 * ── ★ 正确的分界：这次交付有没有【新增】失败 ──────────────────────────────────────
 *
 *   `no-new-failures` ⇒ 失败**逐条都在钉住的基线里** ⇒ 允许 completed（★ 而留痕）
 *   `new-failures`    ⇒ 至少一条不在基线里 ⇒ 只能 failed（**这一半不许放宽**）
 *   `undecidable`     ⇒ 读不到证据行 / 读不到基线 ⇒ 如实说判不了，★ **绝不当成第一态**
 *
 * ── ★★★ 而本任务真正的发现（主树里两处堵点，只有一个认基线）───────────────────────
 *
 * 主树里此前已有 `classifyVerifyFailures`（三态、集合比对、逐条指名）——
 * 而它**到不了**，因为 `verifyCovered` 在同一份 `commandsRun` 上**无条件**要求每条 `verify`
 * 都是 `passed`，而它**不认基线**：
 *
 *   MEASURED（本任务实测，同一份输入只动 `verify` 列表）：
 *     verify = ['pnpm test:gates']（该命令红、失败全在基线里）
 *       ⇒ `{ ok:false, error:'… requires a passed commandsRun entry for every verify command' }`
 *       ★ 那句来自 `verifyCovered`，**不是**三态裁决 —— 放行【到不了】
 *     verify 只声明会绿的那条、把红的放进 commandsRun 但不列进 verify
 *       ⇒ `{ ok:true, notes:['… all in the pinned baseline …'] }`
 *   ⇒ ★ 同一个仓库事实，只因【它有没有被列进 verify】而给出相反裁决。
 *
 * ⇒ 本任务把 `verifyCovered` 改成**复用同一个** `classifyVerifyFailures`：
 *   一条 `failed` 的命令，只有当它的失败逐条都在基线里时才算"覆盖"。
 *
 * ── ★ 定向突变（打红本文件的五条路）─────────────────────────────────────────────
 *
 *   a) 把 `undecidable` 并进 `no-new-failures`（读不到也放行）⇒ 臂 3 红
 *   b) 把存量名单换成**计数**（不说哪几条）⇒ 臂 2 红
 *   c) 把 `new-failures` 也放过（放宽那一半）⇒ 臂 4 红
 *   d) 让 `verifyCovered` 回到"无条件要求 passed"⇒ 臂 1 红（★ 本任务的核心）
 *   e) 让判据不再说出基线是什么（`at`/`by` 缺失）⇒ 臂 5 红
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { evaluateQualityCompletion } from '../lib/quality-gates.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8')

/**
 * ★ 基线清单**从盘上读**（不是抄一份常量）——
 *   抄一份会在 t18 那份清单更新时静默过期，而"我的副本"与"判据读的那份"分叉之后，
 *   本文件测的就不再是判据看到的那个基线了。
 */
const BASELINE = JSON.parse(read('scripts/fixtures/baseline-known-failures.json'))
const KNOWN = BASELINE.knownFailures.map((entry) => entry.test)

/** 一个把 `test:gates` 列为 verify 的 implementation 任务（那正是 17 条任务的形状）。 */
function task() {
  return {
    id: 't19-probe', kind: 'implementation', status: 'in_progress',
    inScope: ['src/a.ts'], verify: ['pnpm test:gates'], acceptance: ['a'],
  }
}

/** 一个"除了 commandsRun 之外全部合法"的完成态更新 —— ★ 只动那一个自变量。 */
function update(commandsRun) {
  return {
    status: 'completed',
    acceptanceResults: [{ criterion: 'a', status: 'passed' }],
    changedPaths: ['src/a.ts'],
    commandsRun,
  }
}

/** 判定结果压成三态里的一态（★ 而它**必须**分得开 —— 那是本任务的核心）。 */
function stateOf(result) {
  if (result.ok === true) return 'allowed'
  if (result.requiredStatus === 'failed') return 'refused-new-failures'
  return 'other'
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★★★ 三态不同形（本任务的核心 —— 存量红必须能通过）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★★★ 存量红、新增 0 ⇒ **允许 completed**（而它此前不可达 —— 17 条任务全被这条挡住）', () => {
  /**
   * ── 本臂钉的就是那条不可达 ────────────────────────────────────────────────────
   *
   * MEASURED（修前）：同一份输入下它回的是
   *   「implementation completion requires a passed commandsRun entry for every verify command」
   * ★ 而那句来自 `verifyCovered` —— 它**不认基线**，于是三态的放行被架空。
   *
   * ★ 定向突变 d（让 `verifyCovered` 回到"无条件要求 passed"）⇒ 本臂红。
   */
  const result = evaluateQualityCompletion(task(), update([
    { command: 'pnpm test:gates', status: 'failed', failures: [KNOWN[0], KNOWN[1]] },
  ]))
  assert.equal(
    result.ok, true,
    '★★★ 两条失败**都在钉住的基线里** ⇒ 允许 completed。'
    + '★ 修前它回的是 `verifyCovered` 那句（"requires a passed commandsRun entry for every verify command"）'
    + ' ⇒ 而那句说的是【仓库有红】，不是【这次交付新增了红】—— 两者是不同的量。'
    + `实测裁决：${JSON.stringify(result).slice(0, 220)}`,
  )
  /** ★ 而"允许"必须**留痕**（否则"通过了"与"没遇到失败"同形）。 */
  assert.ok(
    Array.isArray(result.notes) && result.notes.length > 0,
    '★ 放行必须留痕 —— 否则读的人无法区分"它真的没新增红"与"它只是没跑到那条判据"',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★ 「存量失败」必须**逐条指名**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 2：存量/新增失败必须**逐条指名**（fixture + 臂名），不许一句「仓库有存量红」', () => {
  /**
   * ★ 为什么这是硬要求：一句"仓库有存量红"与"我不知道是哪几条"同形 ——
   *   而读的人要能**去核那一条**（打开那个 fixture、找到那个臂名）。
   * ★ 定向突变 b（把名单换成计数）⇒ 本臂红。
   */
  const fresh = '★ 臂 99：一个凭空捏造的红（不在任何清单里）'
  const refused = evaluateQualityCompletion(task(), update([
    { command: 'pnpm test:gates', status: 'failed', failures: [KNOWN[0], fresh] },
  ]))
  assert.equal(stateOf(refused), 'refused-new-failures', '★ 有一条不在基线里 ⇒ 必须拒')
  assert.ok(
    String(refused.error).includes(fresh),
    `★★ 拒的措辞必须**点名那一条新红**（读的人要能去核它）：${String(refused.error).slice(0, 200)}`,
  )
  assert.ok(
    String(refused.error).includes(KNOWN[0]),
    '★ 而**基线里那条**也必须出现 —— 否则读的人无法分辨"哪条是旧的、哪条是新的"',
  )

  /** ★ 反向半边：允许那一支的措辞必须说出**条数**与**它都在基线里**，而不是一句"通过了"。 */
  const allowed = evaluateQualityCompletion(task(), update([
    { command: 'pnpm test:gates', status: 'failed', failures: [KNOWN[0], KNOWN[1]] },
  ]))
  assert.ok(
    /2 verify failure/.test(allowed.notes.join(' ')),
    `★ 留痕必须说出**几条**（本处应为 2）：${allowed.notes.join(' ')}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★★★ 判不了 ⇒ `unmeasured`，**绝不当成**「存量」
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★★★ 读不到失败明细 ⇒ 判不了 ⇒ **必须拒**（绝不当成"没有新增"）', () => {
  /**
   * ── 这是全库那条最贵的纪律在这一格上的落点 ────────────────────────────────────
   *
   * 「"我没能测量"不得读成"它没问题"」。
   * ⇒ 读不到**失败明细**（`failures` 不在场）时，判据**说不出**哪几条失败了
   *   ⇒ ★ 那就不许推断"它们可能都在基线里"。
   *
   * ★ 定向突变 a（把 `undecidable` 并进 `no-new-failures`）⇒ 本臂红。
   */
  const undecidable = evaluateQualityCompletion(task(), update([
    { command: 'pnpm test:gates', status: 'failed' },
  ]))
  assert.equal(
    stateOf(undecidable), 'refused-new-failures',
    '★★★ 命令红了而**说不出哪几条** ⇒ 必须拒。把它读成"存量"就等于说"仓库里没有新的红"，'
    + '而那个结论**没有任何证据**。★ 定向突变 a ⇒ 本臂红',
  )
  assert.match(
    String(undecidable.error), /could not be measured|not.*measured/i,
    '★ 而措辞必须**说清是"判不了"**（不是"你新增了失败"）—— 两种拒的补救动作不同：'
    + '一个去改代码，一个去找证据',
  )

  /** ★ 而"失败明细不是字符串"也是判不了（形状坏 ⇒ 不猜）。 */
  const badShape = evaluateQualityCompletion(task(), update([
    { command: 'pnpm test:gates', status: 'failed', failures: [42] },
  ]))
  assert.equal(stateOf(badShape), 'refused-new-failures', '★ 形状坏 ⇒ 判不了 ⇒ 拒（不许跳过坏的那条看剩下的）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★ 不许放宽 —— 新增失败仍必须 failed
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 4：放宽的是【增量 vs 存量】，**不是**【失败能不能通过】', () => {
  /**
   * ★ 缺了本臂就无法区分"修好了"与"把那条规则删了"：
   *   一个**无条件放行**的实现同样能过臂 1 ——
   *   而它比原缺陷更坏：**本任务自己的红再也没人管**。
   *
   * ★ 定向突变 c（把 `new-failures` 也放过）⇒ 本臂红。
   */
  const novel = evaluateQualityCompletion(task(), update([
    { command: 'pnpm test:gates', status: 'failed', failures: ['★ 本任务自己引入的红'] },
  ]))
  assert.equal(
    stateOf(novel), 'refused-new-failures',
    '★★ 本任务自己引入的失败**仍然必须 failed** —— 放宽的那一半是【这条红是不是这次带来的】，'
    + '而**不是**【失败能不能让任务通过】。定向突变 c ⇒ 本臂红',
  )
  assert.equal(
    novel.requiredStatus, 'failed',
    '★ 而它必须**明确要求 failed**（不是"拒了但没说该去哪"）—— 交完成态的人需要知道该交什么',
  )

  /** ★ 对照臂：把那条新红换成基线里的一条 ⇒ 立刻放行（证明"拒"是由**那一条**决定的）。 */
  const sameInputExceptThatOne = evaluateQualityCompletion(task(), update([
    { command: 'pnpm test:gates', status: 'failed', failures: [KNOWN[5]] },
  ]))
  assert.equal(
    sameInputExceptThatOne.ok, true,
    '★ 对照：只把那一格从"新增的红"换成"基线里的红" ⇒ 必须放行。'
    + '缺这一条，本臂无法区分"判据有效"与"判据在乱拒"',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★ 判据必须说出「基线是什么」（commit 或 ref）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5：判据必须说出**基线是什么**（哪个 commit / 谁钉的）—— 否则"存量"没有参照物', () => {
  /**
   * ── 一个说不出自己参照物的判断，读的人**无从核它** ────────────────────────────
   *
   * "这几条在基线里" —— 哪一次测的基线？那时的红是哪几条？
   * ★ 两个问题都必须有答案，否则"存量"在这句话里只是一个**承诺**，不是一个事实。
   *
   * ★ 定向突变 e（让判据不再说出 `at`/`by`）⇒ 本臂红。
   * ★ 而**反向半边**：那一格必须来自**盘上那份清单**，不是硬编码一个好看的字符串。
   */
  const allowed = evaluateQualityCompletion(task(), update([
    { command: 'pnpm test:gates', status: 'failed', failures: [KNOWN[0]] },
  ]))
  assert.equal(allowed.ok, true, '★ 前置：这一格必须允许（否则测不到留痕）')
  const note = allowed.notes.join(' ')
  const pinnedAt = String(BASELINE._verified_at).trim().split(/[\s（(]/)[0]
  assert.ok(
    note.includes(pinnedAt),
    `★★ 留痕必须说出基线**是在哪个 commit 上测的**（盘上那份说 \`${pinnedAt}\`）：${note}`,
  )
  assert.match(
    note, /pinned by/i,
    `★ 而它还要说出**谁钉的**（否则"这份基线可信吗"无从追问）：${note}`,
  )

  /** ★ 而拒的那一支也要带上参照物 —— 读的人要知道"跟什么比"才得出"它是新的"。 */
  const refused = evaluateQualityCompletion(task(), update([
    { command: 'pnpm test:gates', status: 'failed', failures: ['★ 新的红'] },
  ]))
  assert.ok(
    String(refused.error).includes(pinnedAt),
    `★★ 拒的那一支也必须说出参照物（"跟 \`${pinnedAt}\` 比它才是新的"）：${String(refused.error).slice(0, 200)}`,
  )

  /**
   * ★★ 反向半边（防"硬编码一个好看的 ref"）：盘上那份清单**必须真的**带这两格，
   *   否则判据是从别处编出来的 —— 而那与"我核对过那份清单"同形。
   */
  assert.ok(
    typeof BASELINE._verified_at === 'string' && BASELINE._verified_at.trim() !== '',
    '★ 盘上那份清单必须带 `_verified_at` —— 否则判据说出的是一个它无法核对的参照物',
  )
  assert.ok(
    typeof BASELINE._pinned_by === 'string' && BASELINE._pinned_by.trim() !== '',
    '★ 盘上那份清单必须带 `_pinned_by`',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：★ 与 t18 的清单口径一致（同一条失败在两处必须同判）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 6：存量清单与 `baseline-known-failures.json` 的口径一致（同一条失败在两处同判）', () => {
  /**
   * ── 两处对同一个名字必须给出同一个答案 ────────────────────────────────────────
   *
   * ★ 逐条拿**盘上那份清单里的每一个名字**去问判据：它们都必须被认作"存量"
   *   （即：单独喂那一条 ⇒ 允许通过）。
   *   ⇒ 任何一条在读清单里却在判据里被判成"新的" ⇒ 两处口径分叉，红。
   *
   * ★ 而这是**逐条**的（不是"随机抽一条"）：一条不一致就足以说明有病。
   */
  assert.ok(KNOWN.length > 0, '★ 清单为空时"逐条一致"恒真 —— 它至少要有几条')
  const mismatched = []
  for (const name of KNOWN) {
    const result = evaluateQualityCompletion(task(), update([
      { command: 'pnpm test:gates', status: 'failed', failures: [name] },
    ]))
    if (result.ok !== true) mismatched.push(name)
  }
  assert.deepEqual(
    mismatched, [],
    `★★ 这些失败在盘上的清单里、而被判据判成了"新的" ${JSON.stringify(mismatched.slice(0, 5))}`
    + `（共 ${mismatched.length} 条）—— 两处口径分叉了。`
    + '★ 修法：让两处同源，而不是各自维护一份',
  )
})
