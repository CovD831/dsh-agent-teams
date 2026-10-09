/**
 * ── t26：卡点/判决 ⇒ 任务 —— 那条线**此前没有生产调用方** ────────────────────────────
 *
 * ── 本臂钉的是什么 ─────────────────────────────────────────────────────────────
 *
 * `scripts/friction-triage.mjs` 早已能把卡点/判决变成一份**审查过的、分好档的**任务契约
 * （`triage` → `runPipeline` → `emitReviewedContract` → `dispatchable` 四态）。
 * ★ 而它此前**零生产调用方**：`src/` 里对它的引用**全部在注释里**，
 *   真正 `import` 它的只有 `scripts/*.test.mjs` ⇒ 盘上的卡点**没有任何东西**
 *   把它们变成任务。
 *
 * ⇒ 这是本会话第 8 个「机制建好了，没有接线」。★ 而它**与那 31 条孤儿不同族**：
 *   那些是"一个导出零调用方"（修法是**接线**），而本条的机制住在
 *   【生产代码够不到的一层】（`scripts/` 在 `tsconfig` 的 `rootDir="src"` 之外）
 *   ⇒ 修法是**让它够得到**（动态 `import` + `pluginRoot()`）。
 *
 * ── ★ 边界：本条只加**调用方**，不改判据语义 ──────────────────────────────────────
 *
 * 分档（`tierOf`）、五问（`adversarialReview`）、四态（`dispatchable`）都由
 * `friction-triage.mjs` 实现且**一个字没动**。用户 §38 那条判据由它实现，
 * 而本调用方只负责把它的结论**读出来并如实交出去**。
 *
 * ── ★ 定向突变（打红本文件的四条路）─────────────────────────────────────────────
 *
 *   a) 删掉调用（`readExperienceDispatch` 不再调 `triage`/`dispatchable`）⇒ 臂 1 红
 *   b) 把 `awaitingRuling` 静默丢弃（不进读数）⇒ 臂 3 红
 *   c) 把 `unreadable`（没能读）并进 `ok`（读成"没有待派的"）⇒ 臂 4 红
 *   d) 把四态合并成一个数字（`ready + awaitingRuling + …`）⇒ 臂 3/5 红
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { pluginRoot, readExperienceDispatch } from '../lib/tools/shared/entities.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 一个"**读得到而确实没有东西**"的目录（与"读不到"**不同形**）。
 *
 * ★ MEASURED（我第一版写错了）：我原本只 `join` 出一个路径而**没有建那个目录**
 *   ⇒ `readJsonDir` 对它报"读不到" ⇒ 于是"只有一侧读不到"那一臂**两侧都读不到**，
 *     断言就红在一个与它想测的东西无关的地方。
 * ✓ 修法：**真的建它**（`mkdirSync` with `recursive`）。
 */
function emptyDir(label) {
  const dir = join(ROOT, '.t26-empty', label)
  mkdirSync(dir, { recursive: true })
  return dir
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★★★ 那条线**有生产调用方** —— 而它真的把卡点读成了提案
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★★★ 卡点/判决 ⇒ 任务的那条线**有生产调用方**（而它此前零调用方）', async () => {
  /**
   * ── 为什么这一臂必须存在 ────────────────────────────────────────────────────
   *
   * 「机制建好了，没有接线」这个病在本会话数到了 8 次。★ 而它的判据不是
   *  "文件在不在"（它一直在），而是 **"有没有东西在【生产路径】上调用它"**。
   *
   * ★ 所以本臂**不读源码**（读源码会被注释里的名字骗过 —— 那正是本条的形态：
   *   `src/` 里 grep 得到 `friction-triage` 五次，**全在注释里**）。
   *   它**真的调一次**，并断言拿回来的东西是判据层算出来的那种形状。
   *
   * ★ 定向突变 a（删掉调用）⇒ 本臂红。
   */
  const result = await readExperienceDispatch({
    frictionsDir: '/nonexistent-t26-frictions',
    judgementsDir: '/nonexistent-t26-judgements',
  })
  /**
   * ★★ 关键：**它读到了判据层的结论**（`readout` 在场）。
   *   一个"零调用方"的实现在这里会崩、或者回一个没有 `readout` 的空壳。
   *   ★ 而"我没能读"那一态**也带 `readout`**（判据层照常算，只是它说两侧读不到）
   *     —— 见臂 4。所以本臂断言的是"调用真的发生了"，而 `state` 由后面几臂判。
   */
  assert.notEqual(
    result.readout, undefined,
    '★★★ 这个调用必须真的走一遍 `triage` + `dispatchable` ⇒ 拿回判据层算出的四态读数。'
    + '★ 它回 `undefined` 就意味着那条线**没有调用方**（本任务要修的那个缺口）',
  )
  assert.equal(typeof result.readout.ready, 'number', '★ `ready` 必须是判据层给的条数')
  assert.equal(typeof result.readout.awaitingRuling, 'number', '★ 而 `awaitingRuling` 也要在')

  /**
   * ★★ 而"它真的调了**那两格**"这件事，由**注入点**再证一次：
   *   换掉装载 ⇒ 若调用方真的走它，读数就该跟着变。
   */
  let triageCalled = 0
  let dispatchableCalled = 0
  await readExperienceDispatch({
    loadModule: async () => ({
      triage: () => {
        triageCalled += 1
        return { unreadable: [], toDispatch: [], blocked: [] }
      },
      dispatchable: () => {
        dispatchableCalled += 1
        return { ready: [], awaitingRuling: [], rejected: [], cannotEmit: [], decomposed: [] }
      },
    }),
  })
  assert.equal(triageCalled, 1, '★ `triage` 必须被调用**恰好一次**')
  assert.equal(dispatchableCalled, 1, '★ `dispatchable` 必须被调用**恰好一次**')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★★ 对**真实存量**跑一次（那条线不是摆设）
// ─────────────────────────────────────────────────────────────────────────────

test('★★★★ 臂 2：对**盘上的真实卡点/判决**跑一次 —— 那条线真的产出提案', async (t) => {
  /**
   * ── 为什么这一臂不能省 ──────────────────────────────────────────────────────
   *
   * 臂 1 用**假目录**证明"调用发生了"。而一个"调了但什么也算不出来"的实现
   * 同样能过臂 1 —— 而它对本任务**毫无价值**。
   *
   * ⇒ 本臂用**盘上真实的那份存量**跑：若那条线通了，它必须算出提案。
   *
   * ★ 而它**不断言具体的条数** —— 卡点目录会增长，条数是**读数**不是不变量。
   *   （把"恰好 N 条"写死，会让下一次有人记录一条卡点时本臂无缘无故地红。）
   */
  const frictionsDir = join(pluginRoot(), '.agent-teams', 'frictions')
  const judgementsDir = join(pluginRoot(), '.agent-teams', 'judgements')
  /**
   * ★ 真实存量在**工作区**里（`.agent-teams` 是 gitignored）⇒ 一棵干净的树里没有它。
   *   ⇒ 那种情况下**如实 skip**，而不是把"没有数据"读成"通过"。
   *   ★ 而 skip 与 pass 在 `node --test` 的报告里**不同形**（`skipped` 那一格）。
   */
  if (!existsSync(frictionsDir)) {
    t.skip(`no live friction corpus at ${frictionsDir} (it is gitignored, so a clean worktree has none)`)
    return
  }

  const result = await readExperienceDispatch({ frictionsDir, judgementsDir })
  assert.equal(
    result.state, 'ok',
    `★ 真实的两侧都读得到 ⇒ 必须是 \`ok\`（实测 unreadable=${JSON.stringify(result.unreadable)}）`,
  )
  const readout = result.readout
  assert.notEqual(readout, undefined, '★ 而它必须交出读数')
  const total = readout.ready + readout.awaitingRuling + readout.rejected + readout.cannotEmit + readout.decomposed
  console.log(
    `★ t26 对真实存量跑一次：ready=${readout.ready} · awaitingRuling=${readout.awaitingRuling}`
    + ` · rejected=${readout.rejected} · cannotEmit=${readout.cannotEmit} · decomposed=${readout.decomposed}`
    + ` · contracts=${readout.contracts.length}`,
  )
  /**
   * ★ 而"这条线通了"的**判据**是：它至少算出了一个数**或**明确说出四态都是 0。
   *   两条路都算通过 —— 而它们是**可分辨的**（前者 `contracts` 非空，后者四态全 0）。
   */
  assert.ok(
    total >= 0 && Array.isArray(readout.contracts),
    '★ 四态与契约表都必须真的被算出来（不是 undefined 拼成的假形状）',
  )
  /** ★★ 而 `ready` 与 `contracts` **不同形**：一条 `ready` 而拿不到契约 ⇒ 那是上游缺口，必须在读数里可见。 */
  assert.ok(
    readout.contracts.length <= readout.ready,
    `★ 契约数不许**多于**可派数（${readout.contracts.length} > ${readout.ready}）—— 那说明它数错了地方`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★★★ 四态**不许合并**，且 `awaitingRuling` 是一条**该被测量的读数**
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 3：四态分别可读，`awaitingRuling` 是一条**读数**而**不是**一个错误', async () => {
  /**
   * ── 用户 §38 的判据 ──────────────────────────────────────────────────────────
   *
   *   「需要人拍板是**缺陷指标**，不是交付方式。」
   *
   * ⇒ 所以 `awaitingRuling` 的**长度本身**就是一条读数：它长了说明
   *   "能自己解决的事太少"，而那正是要消灭的那个指标。
   *
   * ★★★ 而它对**自动派工**有一条硬边界：**不许自派"要人拍板"的那一类**。
   *   ⇒ 所以"大档"必须**留在队列里**，而**不许**被静默丢弃 ——
   *     丢弃会让"没人拍板的事"从读数里消失，于是缺陷指标**永远看起来是 0**。
   *
   * ★ 定向突变 b（把 `awaitingRuling` 静默丢弃）⇒ 本臂红。
   * ★ 定向突变 d（四态合并成一个数字）⇒ 本臂红。
   */
  const result = await readExperienceDispatch({
    loadModule: async () => ({
      triage: () => ({ unreadable: [] }),
      /** ★ 判据层判出：1 条可派、2 条等人拍板、3 条审不过、4 条契约不全。 */
      dispatchable: () => ({
        ready: [{ sourceId: 'r-1', contract: { subject: 's', objective: 'o', inScope: ['a'], acceptance: ['b'], verify: ['c'] } }],
        awaitingRuling: [{ sourceId: 'a-1' }, { sourceId: 'a-2' }],
        rejected: [{}, {}, {}],
        cannotEmit: [{}, {}, {}, {}],
        decomposed: [],
        notReadyBecause: { large: 2, decomposed: 0, notReviewed: 3, contractIncomplete: 4, scopeBlocked: 0 },
      }),
    }),
  })
  const readout = result.readout
  assert.notEqual(readout, undefined, '★ 读数必须在')

  /** ★★★ 四态**各自**可读，且值对得上判据层给的（不许合并）。 */
  assert.equal(readout.ready, 1, '★ ready 必须是**它自己那一格**（不是合计）')
  assert.equal(
    readout.awaitingRuling, 2,
    '★★★ `awaitingRuling` 必须**留在读数里**、值等于判据层给的 2。'
    + '★ 静默丢弃它会让"没人拍板的事"从读数里消失 ⇒ 用户 §38 那个缺陷指标**永远看起来是 0**。'
    + '定向突变 b ⇒ 本臂红',
  )
  assert.equal(readout.rejected, 3, '★ rejected 独立一格')
  assert.equal(readout.cannotEmit, 4, '★ cannotEmit 独立一格')

  /** ★ 而"为什么没进 ready"必须**分栏**报（主干的 stage → 那一栏的名字）。 */
  assert.equal(readout.notReadyBecause.large, 2, '★ "因为它是大活"必须单独可读')
  assert.equal(readout.notReadyBecause.notReviewed, 3, '★ "因为审不过"必须单独可读')
  assert.equal(readout.notReadyBecause.contractIncomplete, 4, '★ "因为契约不全"必须单独可读')

  /** ★★ 而"可派"与"拿到了契约"**不同形**（前者是判断，后者是产物）。 */
  assert.equal(readout.contracts.length, 1, '★ 那 1 条可派的契约必须被取出来')
  assert.equal(readout.contracts[0]?.contract?.['subject'], 's', '★ 而它取的是**契约本体**')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★★ 三态如实 —— 「我没能读」**绝不许**说成「没有待派的」
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 4：「没能读」与「看了，确实没有」必须**不同形**', async () => {
  /**
   * ── 本仓那条最贵纪律在这一格上的落点 ────────────────────────────────────────
   *
   *   「我没能读」  ⇒ ★ 我**根本不知道**有多少（`partial` / `unmeasured`）
   *   「看了，确实没有」⇒ ★ 我知道：**确实是 0**（`ok` + 全 0）
   *
   * ★★ 合并它们会让"卡点目录写错了"伪装成"一切都好" —— 而那正是本会话
   *   反复出现的形态（把一个故障读成一个关于工作的结论）。
   *
   * ★ 定向突变 c（把 `unreadable` 并进 `ok`）⇒ 本臂红。
   */
  /** ① 两侧都读不到 ⇒ `partial`，且**逐侧指名**。 */
  const bothGone = await readExperienceDispatch({
    frictionsDir: '/definitely-not-here-frictions',
    judgementsDir: '/definitely-not-here-judgements',
  })
  assert.equal(bothGone.state, 'partial', '★ 有一侧读不到 ⇒ `partial`（**不是** `ok`）')
  assert.equal(bothGone.unreadable.length, 2, '★★ 必须**逐侧指名**是哪两处读不到（不是一句"没能读"）')
  assert.ok(
    bothGone.unreadable.some((side) => side.includes('frictions'))
    && bothGone.unreadable.some((side) => side.includes('judgements')),
    `★★ 两侧都要点名（实测：${JSON.stringify(bothGone.unreadable)}）—— 否则读的人不知道该去修哪一处`,
  )

  /** ② 一侧读不到 ⇒ 仍然 `partial`（**不是** `ok`）—— 而那正是"没能读"的分界。 */
  const oneGone = await readExperienceDispatch({
    frictionsDir: '/definitely-not-here-frictions',
    judgementsDir: emptyDir('judgements'),
  })
  assert.equal(
    oneGone.state, 'partial',
    '★★ 只要**有一侧**读不到就是 `partial` —— 把一侧的失败读成"另一侧没问题所以整体没问题"，'
    + '会让一半的存量静默地不被看见',
  )
  assert.equal(oneGone.unreadable.length, 1, '★ 而它指名的**只有**读不到的那一侧')

  /** ③ ★★ 两侧都读到、而确实没有 ⇒ `ok` + 全 0（与 ①② 不同形）。 */
  const genuinelyEmpty = await readExperienceDispatch({
    loadModule: async () => ({
      triage: () => ({ unreadable: [] }),
      dispatchable: () => ({ ready: [], awaitingRuling: [], rejected: [], cannotEmit: [], decomposed: [] }),
    }),
  })
  assert.equal(
    genuinelyEmpty.state, 'ok',
    '★★ "我读了，确实没有" ⇒ `ok`。★ 它与 ① 的 `partial` **必须不同形** —— '
    + '否则"没能读"与"确实没有"在读数上合流，而那正是本仓那条最贵纪律要拦的',
  )
  assert.equal(genuinelyEmpty.readout?.ready, 0, '★ 而它是**确定的 0**（不是 undefined）')

  /** ④ ★ 模块引不进来 ⇒ `unmeasured`，且说清**为什么**（与"两侧读不到"不同形）。 */
  const moduleGone = await readExperienceDispatch({
    loadModule: async () => { throw new Error('the module is gone') },
  })
  assert.equal(moduleGone.state, 'unmeasured', '★ 模块引不进来 ⇒ `unmeasured`（不是 `partial`）')
  assert.ok(
    String(moduleGone.why).includes('could not be loaded'),
    `★ 而它必须说清是【装载失败】（与"两侧读不到"的补救动作不同）：${String(moduleGone.why)}`,
  )
  assert.equal(moduleGone.readout, undefined, '★ 它没算出来 ⇒ 读数**缺席**（而不是一个全 0 的假读数）')

  /** ⑤ ★★ 导出改名 ⇒ 也是 `unmeasured`，而**措辞不同**（"形状变了" ≠ "模块不在"）。 */
  const renamed = await readExperienceDispatch({
    loadModule: async () => ({ triage: undefined, dispatchable: undefined }),
  })
  assert.equal(renamed.state, 'unmeasured', '★ 导出改名 ⇒ `unmeasured`')
  assert.ok(
    String(renamed.why).includes('no longer exports'),
    `★★ 而它与 ④ 的措辞必须**不同** —— "模块不在盘上"与"模块在而导出变了"的补救动作不同：${String(renamed.why)}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★ 派出的契约必须**一个字段不缺**（自动派工，缺项会在下游变不可判）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5：可派的契约必须带**完整契约**（subject/objective/inScope/acceptance/verify 一个不缺）', async () => {
  /**
   * ★ 为什么这是硬要求：这是**自动**派工 —— 没有人在建任务那一刻补字段。
   *   一份缺 `acceptance` 的契约会在下游变成**不可判**（谁也不知道它做完了没有）。
   *
   * ★ 而它**不断言 `friction-triage` 怎么做这件事**（那是它的判据）
   *   —— 它只断言**本调用方交出去的那份**字段齐。
   */
  const result = await readExperienceDispatch({
    loadModule: async () => ({
      triage: () => ({ unreadable: [] }),
      dispatchable: () => ({
        ready: [{
          sourceId: 'r-1',
          tier: { tier: 'small' },
          contract: {
            subject: '一个题目', objective: '一个目标', kind: 'implementation',
            inScope: ['src/a.ts'], acceptance: ['一条验收'], verify: ['node --test scripts/a.test.mjs'],
          },
        }],
        awaitingRuling: [], rejected: [], cannotEmit: [], decomposed: [],
      }),
    }),
  })
  const contract = result.readout?.contracts[0]
  assert.notEqual(contract, undefined, '★ 前置：那一条可派的提案必须交出契约')
  for (const field of ['subject', 'objective', 'inScope', 'acceptance', 'verify']) {
    const value = contract?.contract?.[field]
    const present = Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim() !== ''
    assert.ok(
      present,
      `★★ 自动派工的契约必须带 \`${field}\` —— 缺它的契约会在下游变成**不可判**`
      + `（没有人在建任务那一刻补字段）。实测该字段 = ${JSON.stringify(value)}`,
    )
  }
  /** ★ 而来源与档位要一起交出去（读的人要知道"这条是从哪个卡点来的、判成哪一档"）。 */
  assert.equal(contract?.sourceId, 'r-1', '★ 契约要带**来源**（哪个卡点/判决）')
  assert.equal(contract?.tier, 'small', '★ 而档位要带 —— 派工的人需要知道它为什么可派')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：★★ 幂等 —— 同一个来源不许被变成两条任务
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 6：**幂等** —— 同一来源跑两次给出**同一个**契约（不许产生第二条）', async () => {
  /**
   * ── 为什么这条是硬要求（而不是"好习惯"）───────────────────────────────────────
   *
   * 这条线是**自动**跑的。若它不幂等，那么每次触发都会**再建一条同样的任务** ——
   * 而 297 条卡点的存量意味着"跑一次"与"跑十次"会给出**十个不同的任务数**。
   * ★ 那会让"+N 条任务"这个读数**完全失去意义**（它测的是触发次数，不是工作量）。
   *
   * ★ 而幂等的实现**不归本调用方**（`triageProposals(proposals, occupied)` 用
   *   `occupied` 做去重，那是判据层的活）—— 本臂要证的是**调用方把 `occupied` 传下去了**，
   *   于是同一份占用跑两次给出同一份 `ready`。
   *
   * ★ 定向突变：不把 `occupied` 传给 `triage` ⇒ 本臂红。
   */
  const seen = []
  const loadModule = async () => ({
    triage: (options) => {
      /** ★ 记下调用方**真的**把 `occupied` 递进来了（那是幂等的入口）。 */
      seen.push(options?.occupied)
      return { unreadable: [] }
    },
    dispatchable: () => ({ ready: [], awaitingRuling: [], rejected: [], cannotEmit: [], decomposed: [] }),
  })
  const occupied = ['src/tools/update-task.ts']
  await readExperienceDispatch({ loadModule, occupied })
  await readExperienceDispatch({ loadModule, occupied })
  assert.equal(seen.length, 2, '★ 两次调用都发生了')
  assert.deepEqual(seen[0], occupied, '★★ `occupied`（已被占用的写域）必须传给 `triage` —— 那是幂等的入口')
  assert.deepEqual(
    seen[1], occupied,
    '★★ 而**第二次**也要传同一份 —— 不传它就等于"每次触发都当作全新"，'
    + '于是同一个卡点会被建成两条任务（而任务数会变成触发次数的读数）',
  )
})
