/**
 * ── ★ 语料夹具范式（t46）：防「夹具全绿而真实语料恒红」────────────────────────────
 *
 * ── 它防的是什么失效（MEASURED，2026-10-07，point-dev 在 t38 上实测）─────────────
 *
 *     一条判据的 **11 条自造输入的臂全绿**，
 *     而同一个实现在**全部 39 条真实任务**上 **39/39 恒红**。
 *
 * ★ 两者都是真的，且互不矛盾 —— 因为那 11 条臂的输入**全是夹具自己造的**：
 *   每一个都恰好落在"这条判据打算判的那个形状"上。而真实语料里没长成那样的任务
 *   被它一律判红。⇒ **「夹具全绿」与「它在真实语料上成立」是两件事**，
 *   而当时没有任何机制能分辨这两句话。
 *
 * ── 本文件建立的东西：一条【把真实语料当输入】的检查动作 ─────────────────────────
 *
 * ★ 它不是新判据，而是一条**夹具范式**：给每条判据算一次它在真实语料上的**分布**
 *   （ok / blocked / unmeasured / skipped 各多少条），并断言这个分布没有退化成
 *   下面两种形状之一：
 *
 *     ① 恒红      —— 对所有真实输入都说"不好"
 *     ② 恒不触发  —— 对所有真实输入都说 ok
 *
 *   ★ 两者的共同点才是要害：**它们都与它声称要判的东西无关**。
 *     一条恒红的判据与一条恒 ok 的判据，在"它到底判了什么"这个问题上同样空洞 ——
 *     而它们的臂都可以是全绿的（只要臂喂的是自造输入）。
 *
 * ── 判据不变量的口径（本文件最容易被写错的地方）───────────────────────────────
 *
 * 本文件断言的是**分布的形状**，不是**具体的数**。差别很要紧：
 *
 *     ✘ 不许写：`assert.equal(okCount, 36)`      —— 那是把当下的语料快照写成不变量
 *                                                （语料一改就红，与"判据坏了"无关）
 *     ✔ 应当写：`assert.ok(okCount > 0 && blockedCount > 0)`
 *                                                —— "两侧都出现过"才是它对语料敏感的证据
 *
 * ★ 而"两侧都出现过"这条本身也要小心：有些判据**本来**就极少触发（例如
 *   `contract.verify-command` 只把 127/恒真/恒假 当契约缺陷，而"测试失败"不是
 *   它的业务）——⇒ 本文件对这些判据断言的是**"在会触发的输入上确实触发"**
 *   （见臂 3 的探针语料），而不是"在真实语料上必须有 blocked"。
 *   把后者写成断言，等于要求判据在语料上乱开火 —— 那是误报。
 *
 * ── 臂的划分 ────────────────────────────────────────────────────────────────
 *
 *   臂 1  语料本身可信：条数与形状，且**不是自造的**（可追溯到源）
 *   臂 2  建-产物-范围：真实语料上两侧都出现（它对语料敏感）
 *   臂 3  verify-command：真实语料上恒不触发是**正确**的，但换到会触发的语料上必须触发
 *   臂 4  ★ 定向突变：把一条判据改成恒红 / 恒不触发 ⇒ 本文件的形状断言必须红
 *   臂 5  范式可复制：任何一条 contract 判据都能被同一个装置算分布（并报出读数）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ─────────────────────────────────────────────────────────────────────────────
// 装置：把一份语料喂给一条判据，读出它的【分布】
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★ 这就是"可复制的范式"本体 ────────────────────────────────────────────────
 *
 * 给一条判据 + 一份语料 ⇒ 一个分布。四态分开数，**一个都不许并**：
 *
 *   ok / blocked / unmeasured / skipped（不适用）/ threw（判据自己炸了）
 *
 * ★ 为什么 `threw` 要单独成一态：一条在真实语料上抛错的判据，与一条返回 blocked 的
 *   判据在**调用方**眼里同形（都是"这一步没通过"），而它们的补救动作完全不同
 *   （修判据 vs 修契约）。★ 而且语料夹具是**唯一**能看见这个差别的地方 ——
 *   单条臂喂的输入通常都被小心翼翼地构造过，不会让判据炸。
 *
 * ★ 为什么 `skipped` 要单独成一态：`appliesTo` 为假 ⇒ 判据**根本没跑**。
 *   把它并进 `ok` 会让"这条判据对这批语料全都不适用"读成"它全都通过了" ——
 *   而那正是本队反复记的那个形态（"没测到"并进"通过"）。
 */
async function distributionOf(gate, corpus, makeContext) {
  const counts = { ok: 0, blocked: 0, unmeasured: 0, skipped: 0, threw: 0 }
  const evidence = { blocked: [], unmeasured: [], threw: [] }

  for (const item of corpus) {
    const context = makeContext(item)

    /**
     * ★ `appliesTo` 先判：它说"不适用"⇒ 这条语料上的读数是 `skipped`，
     *   而**不进**下面任何一个出口。★ 它自己抛错也算 `threw`（不是 skipped）——
     *   一个会炸的 `appliesTo` 比一个返回 false 的更坏：它会让整条判据说不出话。
     */
    let applies = true
    try {
      applies = typeof gate.appliesTo === 'function' ? gate.appliesTo(context) : true
    } catch {
      counts.threw += 1
      evidence.threw.push(`${item.id}: appliesTo threw`)
      continue
    }
    if (applies !== true) { counts.skipped += 1; continue }

    let verdict
    try {
      verdict = await gate.gate(context)
    } catch (error) {
      counts.threw += 1
      evidence.threw.push(`${item.id}: ${String(error?.message ?? error).slice(0, 70)}`)
      continue
    }

    if (verdict?.ok === true) { counts.ok += 1; continue }
    if (typeof verdict?.unmeasured === 'string') {
      counts.unmeasured += 1
      evidence.unmeasured.push(`${item.id}: ${verdict.unmeasured.slice(0, 70)}`)
      continue
    }
    if (Array.isArray(verdict?.blockers) && verdict.blockers.length > 0) {
      counts.blocked += 1
      evidence.blocked.push(`${item.id}: ${verdict.blockers[0].slice(0, 70)}`)
      continue
    }
    /** 形状非法的裁决：它既不是 ok 也不是任何一条已知出口。**必须**被看见。 */
    counts.threw += 1
    evidence.threw.push(`${item.id}: malformed verdict ${JSON.stringify(verdict).slice(0, 60)}`)
  }

  return { counts, evidence, total: corpus.length }
}

/** 「它真的开过火吗」—— 把"说不好"的两个出口合起来看（blocked 或 unmeasured 都算开口）。 */
const spokeCount = (distribution) => distribution.counts.blocked + distribution.counts.unmeasured

// ─────────────────────────────────────────────────────────────────────────────
// 载入：固定语料 + 被测判据（★ 全部从 lib/ 走真实入口）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★ 为什么读 `lib/` 而不是 `src/`：运行时真加载的是构建产物 ─────────────────────
 * 硬约束：`link:` 指向源码 ⇒ 必须 build。一个"改了 src 忘了 build"的判据在 src 上
 * 是新的、在 lib 上是旧的 —— 而真实语料夹具要照的正是**会跑的那一份**。
 */
const CORPUS_FILE = join(ROOT, 'scripts/fixtures/gate-corpus.json')
const corpusDocument = JSON.parse(readFileSync(CORPUS_FILE, 'utf8'))
const CORPUS = corpusDocument.tasks

const buildArtifactScope = await import(new URL('../lib/gates/contract/build-artifact-scope.js', import.meta.url).href)
const verifyCommand = await import(new URL('../lib/gates/contract/verify-command.js', import.meta.url).href)

/**
 * 一条"命令跑得起来、而且真的跑绿了"的执行器。
 *
 * ★ 它**不是**在假装工作：`contract.verify-command` 会把命令真的跑一遍来区分
 *   "永远红/永远绿"与"跟着工作变"。喂一个恒定值会让它看见一个恒定的世界 ——
 *   那与喂一条恒红的命令在效果上同形（都让判据看到"不随工作变化"）。
 *   ⇒ 所以这里给的是**恒 0**：语义上等于"每条命令在正确的工作上都跑绿"，
 *     于是判据**不**应当因它开火。这正好让真实语料上的读数落在"ok"那一侧，
 *     而"它是否会对最明显的坏契约开火"由臂 3 用探针语料单独问。
 */
const executorThatAlwaysPasses = async () => 0

/** 判据 → 它的 ctx 构造器（每个位置读的格子不同）。 */
const TARGETS = [
  {
    id: 'contract.build-artifact-scope',
    gate: buildArtifactScope,
    makeContext: (task) => ({ task }),
  },
  {
    id: 'contract.verify-command',
    gate: verifyCommand,
    makeContext: (task) => ({ task, execVerifyCommand: executorThatAlwaysPasses }),
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：语料本身可信 —— 且它必须**不是自造的**
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂防的是什么 ────────────────────────────────────────────────────────────
 *
 * 一条"语料夹具"若它的语料是**自己编的**，那它就退化成了又一份自造输入的臂 ——
 * 而本任务存在的全部理由就是那种臂分辨不出问题。
 *
 * ⇒ 本臂断言三件事，让语料**不可能**被悄悄换成自造输入：
 *   ① 每一条都带 `id`（可追溯到真实任务）；
 *   ② 条数不低于一个下限（下界，不是等值 —— 语料会随项目长大）；
 *   ③ 形状里带着真实语料特有的**多样性**（多种 kind，且有正例与反例并存）——
 *      一份"每条都长得一样"的语料，测的是一条判据在同一个点上的重复读数。
 *
 * ★ 为什么不断言"恰好 43 条"：那是把当下的语料快照写成不变量。
 *   下界 >= 20 才是那个不随语料增长而变化、且仍能防"语料被掏空"的口径。
 */
test('臂 1 ★ 语料可信：来自真实 team.json（带 id / 有规模下界 / 形状多样），不是自造输入', () => {
  assert.ok(
    Array.isArray(CORPUS) && CORPUS.length > 0,
    '★ 语料为空 —— 一个空的语料夹具会对所有判据报"零条读数"，而它看起来像"一切正常"',
  )
  assert.ok(
    CORPUS.length >= 20,
    `★ 语料只有 ${CORPUS.length} 条（下界 20）—— 语料被掏空之后，这套装置会静默地什么都测不到。`
    + '★ 用下界而不是等值：等值会把当下快照写成不变量，语料一长就红',
  )

  /** ① 每条都要能追溯到真实任务。 */
  for (const task of CORPUS) {
    assert.equal(
      typeof task.id, 'string',
      '★ 语料里有一条没有 id —— 它无法追溯到真实任务，于是它可能是一条自造输入',
    )
    assert.notEqual(task.id.trim(), '', `★ 空 id 的语料条目：${JSON.stringify(task).slice(0, 80)}`)
  }
  const ids = CORPUS.map((task) => task.id)
  assert.equal(new Set(ids).size, ids.length, '★ 语料里有重复 id —— 同一件事被数两次会让分布读数失真')

  /**
   * ② 形状多样性：`kind` 至少出现三种。
   *
   * ★ 这不是为了好看：`appliesTo` 常常按 `kind` 分流，一份 kind 单一的语料会让
   *   "这条判据对所有 kind 都乱开火"与"它只对 quality 开火"**读数相同**。
   */
  const kinds = new Set(CORPUS.map((task) => task.kind).filter((kind) => typeof kind === 'string'))
  assert.ok(
    kinds.size >= 3,
    `★ 语料只覆盖 ${kinds.size} 种 kind（${[...kinds].join(', ')}）—— 一份 kind 单一的语料看不出 appliesTo 是否按 kind 分流`,
  )

  /**
   * ③ ★ 正例与反例都在：既有"声明了 src/ 却没声明 lib/"的任务，也有不这样的。
   *
   * 这是**这一份语料**能测出 `build-artifact-scope` 两种读数的前提。
   * ★ 断言的是"两侧都非空"，不是具体条数 —— 后者是快照。
   */
  const declaresSourceWithoutArtifact = CORPUS.filter((task) => {
    const scope = Array.isArray(task.inScope) ? task.inScope.map(String) : []
    return scope.some((path) => path.startsWith('src/')) && !scope.some((path) => path.startsWith('lib/'))
  })
  console.log(`    ℹ 语料 ${CORPUS.length} 条 · kind ${kinds.size} 种 · 其中"声明 src/ 未声明 lib/" ${declaresSourceWithoutArtifact.length} 条`)
  assert.ok(
    declaresSourceWithoutArtifact.length > 0,
    '★ 语料里没有一条"声明 src/ 未声明 lib/"—— 那 build-artifact-scope 在它上面的读数会退化成单一侧，'
    + '而本夹具会看不出它是否还对语料敏感',
  )
  assert.ok(
    declaresSourceWithoutArtifact.length < CORPUS.length,
    '★ 语料里**每一条**都是"声明 src/ 未声明 lib/"—— 那样两侧只剩一侧，同样测不出敏感度',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：build-artifact-scope —— 真实语料上两侧都出现
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂是"恒红 / 恒不触发"两条退化线的落点 ──────────────────────────────────
 *
 * `contract.build-artifact-scope` 声称：本仓库把 `lib/` 与 `src/` 锁在一起，
 * 所以「声明了 src/ 却没声明 lib/」的契约将来必然产生未声明的改动 ⇒ 它要求补声明。
 *
 *   恒红      ⇒ 它会对**所有**真实任务这么说（连没碰 src/ 的 docs 任务也骂）—— 与语料无关
 *   恒不触发  ⇒ 它对**所有**真实任务都说 ok（连真的漏了 lib/ 的也不说）—— 同样与语料无关
 *
 * ⇒ 本臂断言真实语料上**两侧都出现过**。这恰好把两条退化线都堵住：
 *   任何一侧为 0，就说明这条判据在这份语料上没有分辨力。
 */
test('臂 2 ★ build-artifact-scope：真实语料上两侧都出现（既不该恒红，也不该恒不触发）', async () => {
  const target = TARGETS.find((entry) => entry.id === 'contract.build-artifact-scope')
  const distribution = await distributionOf(target.gate, CORPUS, target.makeContext)

  console.log(`    ℹ ${target.id} 在 ${distribution.total} 条真实语料上的分布：${JSON.stringify(distribution.counts)}`)
  for (const line of distribution.evidence.blocked.slice(0, 2)) console.log(`    ℹ blocked 例：${line}`)

  /** ★ 判据不许在真实语料上抛错 —— 那是它自己坏了，不是契约有问题。 */
  assert.equal(
    distribution.counts.threw, 0,
    '★ 判据在真实语料上抛错了 —— 这与"它判出了 blocked"在调用方眼里同形，'
    + '而补救动作完全不同（修判据 vs 修契约）：\n' + distribution.evidence.threw.slice(0, 5).join('\n'),
  )

  /** ★ 退化线 ①：恒红。 */
  assert.ok(
    distribution.counts.blocked < distribution.total,
    `★ 恒红：这条判据对**全部 ${distribution.total} 条**真实任务都说不好。`
    + '⇒ 它已然与"这批任务里到底哪一份漏声明了 lib/"无关 —— 正是 t38 上实测到的那个形状',
  )
  /** ★ 退化线 ②：恒不触发。 */
  assert.ok(
    distribution.counts.blocked > 0,
    `★ 恒不触发：这条判据对**全部 ${distribution.total} 条**真实任务都说 ok。`
    + '⇒ 它对自己声称要抓的那个形状（声明了 src/ 却没声明 lib/）毫无反应',
  )

  /**
   * ★ 而且它必须是**真的开过口**（blocked 不是被 unmeasured 顶替的）——
   *   一条对所有语料报"我没能测量"的判据同样什么都没判。
   */
  assert.ok(
    distribution.counts.unmeasured < distribution.total,
    '★ 这条判据对全部真实语料都报"没能测量" —— 与恒红同为"什么都没判"',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：verify-command —— 恒不触发在真实语料上是【对】的，但换语料必须触发
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂是本文件最容易被写错的地方，所以它单独成臂 ────────────────────────────
 *
 * `contract.verify-command` 在真实语料上**全部 ok**（实测 43/43）。按臂 2 的口径，
 * 一个偷懒的结论是"它恒不触发 ⇒ 退化"——**那是错的**：
 *
 * ★ 这条判据**故意只把"契约自己不可判"当成缺陷**（`false` / `true` / 空白 / 127），
 *   而**"命令跑了但失败"不是它的业务** —— 那说明**工作**没做完，不是**契约**写坏了。
 *   （源码 src/gates/contract/verify-command.ts:523-533 明确只对 127 开火。）
 *   ⇒ 真实语料里每条命令都能跑、只不过"现在还没通过"，于是全 ok 是**正确读数**。
 *
 * ⇒ 所以这条判据的语料夹具**不能**用"真实语料上必须有 blocked"来断言 ——
 *   那等于要求它对正常契约误报。它该被问的是另一个问题：
 *
 *     ★ **"在会触发的输入上，它确实触发吗？"**
 *
 *   ⇒ 本臂用一小段**探针语料**（不是真实语料，而是本队实测过的几种坏契约）来问它。
 *     并且把"真实语料上恒不触发"这件事本身也断言下来 —— 那是**设计意图**，
 *     不是缺陷；将来有人让它对正常契约误报，这一句会红。
 */
test('臂 3 ★ verify-command：真实语料上恒不触发是【对的】；换到会触发的语料上必须触发', async () => {
  const target = TARGETS.find((entry) => entry.id === 'contract.verify-command')

  /** ── 半边 A：真实语料上的读数（= 设计意图）────────────────────────────────── */
  const onRealCorpus = await distributionOf(target.gate, CORPUS, target.makeContext)
  console.log(`    ℹ ${target.id} 在 ${onRealCorpus.total} 条真实语料上的分布：${JSON.stringify(onRealCorpus.counts)}`)

  assert.equal(
    onRealCorpus.counts.threw, 0,
    '★ 判据在真实语料上抛错：\n' + onRealCorpus.evidence.threw.slice(0, 5).join('\n'),
  )
  assert.equal(
    onRealCorpus.counts.blocked, 0,
    '★ 这条判据对**真实语料**开了火 —— 它的业务是"契约自己不可判"，而"命令跑了没通过"'
    + '是**工作**没做完、不是契约写坏。对正常契约开火就是误报：\n'
    + onRealCorpus.evidence.blocked.slice(0, 3).join('\n'),
  )
  assert.equal(
    onRealCorpus.counts.unmeasured, 0,
    '★ 真实语料上出现 unmeasured —— 执行器已经注入了，所以这条路径不该被走到',
  )

  /** ── 半边 B：会触发的语料上，它必须触发（★ 这一半才是"它有分辨力"的证据）──── */
  /**
   * ★ 探针语料：本队实测过的四种"契约自己不可判"。
   *   ★ 它们**不是**自造的形状 —— 每一条都对应本队真出现过的一次实测：
   *     `false`      ⇒ 永远红（判据自己的 `always-red` 静态分支）
   *     `true`       ⇒ 永远绿（不许拿它当验证）
   *     `'   '`      ⇒ 空白命令（shell 对空命令退 0）
   *     `'no-such-command-xyz'` ⇒ 跑起来 127（契约指名了一个不存在的东西）
   */
  const probeCorpus = [
    { id: 'probe/always-red', kind: 'implementation', verify: ['false'] },
    { id: 'probe/always-green', kind: 'implementation', verify: ['true'] },
    { id: 'probe/blank', kind: 'implementation', verify: ['   '] },
    { id: 'probe/missing-binary', kind: 'implementation', verify: ['no-such-command-xyz'] },
  ]
  const onProbes = await distributionOf(
    target.gate,
    probeCorpus,
    /**
     * ★ 执行器在这里**真的模拟 127**（命令不存在）—— 而其它探针返回 0。
     *   于是"判据能不能在真跑一次之后认出坏契约"这件事也被测到了，
     *   而不是只测它的静态分支。
     */
    (item) => ({
      task: item,
      execVerifyCommand: async (command) => (command.includes('no-such-command') ? 127 : 0),
    }),
  )
  console.log(`    ℹ 探针语料（${probeCorpus.length} 条会触发的坏契约）上的分布：${JSON.stringify(onProbes.counts)}`)

  assert.ok(
    spokeCount(onProbes) > 0,
    '★ 这条判据在**会触发的语料**上也一声不吭 —— 那它才是真的恒不触发。'
    + '★ 这一句是本臂存在的理由：单看真实语料，"设计上很少触发"与"坏了、从不触发"读数相同',
  )
  assert.equal(
    onProbes.counts.threw, 0,
    '★ 判据在探针语料上抛错：\n' + onProbes.evidence.threw.slice(0, 5).join('\n'),
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★ 定向突变：把判据改成恒红 / 恒不触发 ⇒ 形状断言必须红
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 规则二后半句：「把机制单独去掉，臂必须红」────────────────────────────────────
 *
 * 本臂要证明的是：**臂 2 的那两条断言测的确实是"这条判据对语料敏感"**，
 * 而不是"恰好也看到了一个非零的数"。
 *
 * ★ 为什么用对照实现而不是改产品源码：本任务 inScope 只有两个 `scripts/` 文件，
 *   改 `src/` 不在范围内。⇒ 用**同一条语料**喂三个端点：
 *
 *     real        —— 真实判据
 *     alwaysRed   —— 恒红（对所有输入都说不好）
 *     alwaysOk    —— 恒不触发（对所有输入都说 ok）
 *
 *   然后断言：臂 2 的两条断言**只在 real 上同时成立**，两个退化端各被一条抓住。
 *   ⇒ 这把"臂 2 恰好也绿"排除掉了。
 *
 * ★★ 并如实记一笔（t20/t27 的教训）：一次"本来就已经红"的臂无法用突变区分
 *   "测到了机制"与"恰好在报别的问题"。⇒ 本臂不声称"我突变了产品"，
 *   它声称的是"**同一条语料**在这三个端点下，臂 2 的两句话给出不同的结论"。
 *
 * ── ★★ 而源码级定向突变也**真的跑过两次**（记录如下，含还原）────────────────────
 *
 * 改的是 `lib/gates/contract/build-artifact-scope.js`（构建产物 —— 见下面的理由），
 * 每次改动 ⇒ 立刻跑本文件：
 *
 *   ① 恒红：把它的**三个 `ok` 出口**全改成 `blocked([...])`
 *      ⇒ 分布变 `{ok:0, blocked:43}` ⇒ **臂 2 红**（"不许恒红"那句）+ 臂 4 红
 *
 *   ② 恒不触发：把它的 `blocked(blockers)` 出口改成 `ok()`
 *      ⇒ 分布变 `{ok:43, blocked:0}` ⇒ **臂 2 红**（"不许恒不触发"那句）+ 臂 4 红
 *
 *   ⇒ 两个退化方向**各自**被臂 2 的一条**不同**断言抓住（实测：恒红端 min
 *     `blocked === total`，恒不触发端 `blocked === 0`）—— 所以那两句都不是多余的。
 *
 *   ★ 还原：两次都用 `cp` 回到备份，实测与备份**逐字节相同**；全仓可执行代码
 *     （剥注释、查 `src/` 与 `lib/`）`MUTANT|MUTATION|MUTATED` 命中数为 **0**。
 *
 *   ★ 为什么在 `lib/` 上做而不是 `src/`：本任务 inScope 只有两个 `scripts/` 文件，
 *     不许碰 `src/`。而 `lib/` 是**构建产物**（可由 `pnpm build` 再生）——
 *     在它上面做一次可还原的模拟，等价于"手工制造那个退化实现"，
 *     且不触碰任何源文件。★ 这与本队另两条任务的处置一致。
 */
test('臂 4 ★ 定向突变：恒红 / 恒不触发 两个退化端，必须各自被臂 2 的一条断言抓住', async () => {
  const target = TARGETS.find((entry) => entry.id === 'contract.build-artifact-scope')

  /** 三个端点。★ 两个退化端是**故意造的坏实现** —— 它们模拟"判据与语料无关"。 */
  const real = target.gate
  const alwaysRed = { gate: () => ({ ok: false, blockers: ['this task is not acceptable'] }) }
  const alwaysOk = { gate: () => ({ ok: true }) }

  const realDistribution = await distributionOf(real, CORPUS, target.makeContext)
  const redDistribution = await distributionOf(alwaysRed, CORPUS, target.makeContext)
  const okDistribution = await distributionOf(alwaysOk, CORPUS, target.makeContext)

  console.log(`    ℹ real      ⇒ ${JSON.stringify(realDistribution.counts)}`)
  console.log(`    ℹ alwaysRed ⇒ ${JSON.stringify(redDistribution.counts)}`)
  console.log(`    ℹ alwaysOk  ⇒ ${JSON.stringify(okDistribution.counts)}`)

  /**
   * ★ 臂 2 的两条断言，在这里**逐字复用**（不是"重写一遍同样的意思"）——
   *   这样"突变打红臂 2"这句话才是真的：红的是同一条断言。
   */
  const degenerates = (distribution) =>
    distribution.counts.blocked >= distribution.total || distribution.counts.blocked === 0

  assert.equal(
    degenerates(realDistribution), false,
    '★ 真实判据在真实语料上退化了 —— 臂 2 会红，而本臂的对照失去意义',
  )
  assert.equal(
    degenerates(redDistribution), true,
    '★ 恒红端**没有**被判成退化 —— 那说明臂 2 的"不许恒红"那句是恒真的（它抓不住任何东西）',
  )
  assert.equal(
    degenerates(okDistribution), true,
    '★ 恒不触发端**没有**被判成退化 —— 那说明臂 2 的"不许恒不触发"那句是恒真的',
  )

  /**
   * ★ 反过来说清楚两个退化端是**分别**被不同那一句抓住的 —— 否则"能抓住"这件事
   *   可能只是同一个条件在起作用（那样其中一句就是多余的）。
   */
  assert.ok(
    redDistribution.counts.blocked === CORPUS.length,
    '★ 恒红端应当是"全部 blocked"这一侧',
  )
  assert.equal(okDistribution.counts.blocked, 0, '★ 恒不触发端应当是"零 blocked"这一侧')
  assert.notEqual(
    redDistribution.counts.blocked, okDistribution.counts.blocked,
    '★ 两个退化端在语料上给出了同一个读数 —— 那说明它们不是两个可分辨的退化方向',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：范式可复制 —— 任何一条 contract 判据都能被同一个装置算分布
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂把"范式"这件事从一次性的检查变成可继承的东西 ──────────────────────────
 *
 * ★ 契约要求"给出可复制的范式"。复制性不是靠一段说明，而是靠**装置本身**
 *   对任意判据都能用 —— 所以本臂把**注册表里 contract 位置的每一条判据**
 *   都过一遍同一个 `distributionOf`，并断言：
 *
 *     ① 每一条都能被算出一个分布（装置对它们都可用）；
 *     ② **每一条都没有在真实语料上抛错**（★ 这条是通用的，不随判据语义变化）；
 *     ③ 并**逐个打印**读数 —— 让"我跑过了"与"我没跑"在下一次评审时不同形。
 *
 * ★ 为什么不断言"每条都有 blocked"：那会把"这条判据设计上很少触发"读成缺陷
 *   （见臂 3 的完整理由）。通用的不变量只有"不许抛错"与"不许全 unmeasured"。
 */
test('臂 5 ★ 范式可复制：contract 位置的每一条判据都能算出分布，且都不在语料上抛错', async () => {
  const { registry } = await import(new URL('../lib/gates/index.js', import.meta.url).href)

  const listed = registry.list()
  const contractGates = listed.contract ?? []
  assert.ok(
    contractGates.length >= 2,
    `★ contract 位置此刻只有 ${contractGates.length} 条判据（下界 2：build-artifact-scope / verify-command）`,
  )

  const readings = []
  for (const entry of contractGates) {
    /**
     * ★ 按 **id** 从 lib/ 里取那条判据的模块 —— 而不是从注册表上取函数：
     *   注册表不交出 `gate`（它只交清单），而"用哪一份实现算分布"必须明确。
     *   ★ 若某个 id 对不上文件（改名/新增），这里会**报出来**而不是静默跳过：
     *     一个静默跳过的条目正是"没查"伪装成"查了没问题"。
     */
    const moduleName = entry.id.split('.').slice(1).join('.')
    let module
    try {
      module = await import(new URL(`../lib/gates/contract/${moduleName}.js`, import.meta.url).href)
    } catch {
      readings.push({ id: entry.id, note: `★ 找不到对应的 lib 模块（contract/${moduleName}.js）—— 本范式漏了它` })
      continue
    }
    assert.equal(
      typeof module.gate, 'function',
      `★ ${entry.id} 的模块没有导出 gate —— 本范式无法为它算分布`,
    )

    const distribution = await distributionOf(
      module,
      CORPUS,
      (task) => ({ task, execVerifyCommand: executorThatAlwaysPasses }),
    )
    readings.push({ id: entry.id, counts: distribution.counts, total: distribution.total, threw: distribution.evidence.threw })

    /**
     * ★ 通用不变量 ①：不许在真实语料上抛错。
     *   它是**与判据语义无关**的那一条 —— 任何判据在任何语料上都不该炸。
     */
    assert.equal(
      distribution.counts.threw, 0,
      `★ ${entry.id} 在真实语料上抛错：\n` + distribution.evidence.threw.slice(0, 5).join('\n'),
    )
    /**
     * ★ 通用不变量 ②：不许对全部语料都报"没能测量"。
     *   ★ 比它弱一档的是"不许 0 条读数"—— 一个把语料全判成 skipped 的判据，
     *     分布会全落在 skipped 上，而那也是"什么都没判"。
     */
    assert.ok(
      distribution.counts.ok + distribution.counts.blocked > 0,
      `★ ${entry.id} 对全部 ${distribution.total} 条真实语料既没说 ok 也没说 blocked`
      + `（分布 ${JSON.stringify(distribution.counts)}）⇒ 它在这份语料上没有任何结论`,
    )
  }

  /** ★ 逐个打印 —— "我跑过了"必须有可见的痕迹，否则它与"我没跑"同形。 */
  for (const reading of readings) {
    console.log(reading.note !== undefined
      ? `    ℹ ${reading.id.padEnd(28)} ${reading.note}`
      : `    ℹ ${reading.id.padEnd(28)} ${JSON.stringify(reading.counts)}`)
  }
  assert.equal(
    readings.length, contractGates.length,
    '★ 有判据没有被算到分布 —— 那它就没有被这条范式覆盖',
  )
})
