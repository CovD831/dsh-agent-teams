#!/usr/bin/env node
/**
 * ── 「repair 的判别证据」这条供给链与消费链的对齐（t67）────────────────────────
 *
 * ── 它修的是什么（MEASURED，2026-10-07/08）────────────────────────────────────
 *
 * `discriminatingFiles → newTestFiles` 这条链的**唯一消费者是 r5**。
 * 而 t54 的 kind 需求表说 **repair 不要求 r5** ⇒ 那条证据在 repair 上
 * **没有消费者**，而它**仍然被生产出来**。
 *
 * ★ 而那正是本队反复记账的形态：
 *     **一个没有调用方的产出，与没有那个产出在观测上完全相同。**
 *
 * ── ★★★ 而本任务的交付不是「把断线接回去」────────────────────────────────────
 *
 * 契约原文：「交付不是『修一条断链』，而是【明写它落在哪一格】」——
 * 因为**原来的接法本身可能就不对**。
 *
 * 实测发现（本任务）：
 *
 *     `killerSuites`（mutation 读的那一格）此前的**唯一**来源是
 *     `observedTestFiles`（**会话事件**）
 *     ⇒ 而 f-0020 那个形状里，会话观察**恰恰是缺席的**（那正是它的成因）
 *     ⇒ mutation 拿不到任何套件
 *     ⇒ ★ 而**同一时刻**，`repairEvidence` 从**任务契约**读出了那份夹具，
 *       喂给了 `newTestFiles` —— **而没人读那一格**
 *
 * ⇒ 不是"松了一根线"，是**线接错了插座**。
 *
 * ── 而需求表自己写着该接哪一格 ────────────────────────────────────────────────
 *
 * `kind-requirements.json` 的 repair 一节逐字写着：
 *
 *     "Mutation stays because it is what proves the discriminating fixture
 *      really discriminates"
 *
 * ⇒ ★ 设计意图早就说了：**证明那份夹具真的能判别**是 mutation 的活。
 *
 * ── 三态（★ 而第二种**必须可读**）──────────────────────────────────────────────
 *
 *     `consumed`   —— 有判据真的会读它（由 kind 需求表回答）
 *     `produced`   —— 生产出来了，而**没有任何门会读**（★ 以前它是沉默的）
 *     `unmeasured` —— **无法判断**（表读不到 / 这个 kind 不在表里）
 *
 * ── ★ 本文件刻意不写的一句话（本队已因这类棘轮返工多次）────────────────────────
 *
 * 「现在有几条链」「表里有几个 kind」**都不是不变量**。
 * 本文件里的 kind 与门的清单是**夹具自己给的**，不读盘上那张表 ——
 * 一个去读真实表的夹具会在表被编辑时按设计变红，而红的原因与"供给/消费"无关。
 *
 * Run: node --test scripts/gate-repair-evidence-consumer.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import {
  traceEvidenceConsumer,
  GATE_INPUT_FIELDS,
  repairEvidenceFiles,
  repairCompletionVerdict,
} from '../lib/quality-gates.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GATE_SOURCE = join(ROOT, 'src', 'quality-gates.ts')
const BUILT_GATE = join(ROOT, 'lib', 'quality-gates.js')

/** 表里那两个 kind 各自要求的门（★ 夹具自己写，不读盘上的表）。 */
const REPAIR_GATES = ['completion.mutation', 'completion.backtest']
const IMPL_GATES = ['completion.r5', 'completion.mutation', 'completion.backtest']

/** 一份 repair 的真实形状：改的是**既有夹具**（t31 建立的形状）。 */
const FIXTURE = 'scripts/gate-repair-evidence-consumer.test.mjs'
function repairCtx(overrides = {}) {
  return {
    task: { id: 't', kind: 'repair', inScope: [FIXTURE], changedPaths: [FIXTURE] },
    update: { changedPaths: [FIXTURE], newTestFiles: [] },
    ...overrides,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 臂 1：★ 那句"生产了、没人读"必须**可读**（本任务的核心）
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 臂 1：repair 上 `newTestFiles` 是 `produced` —— ★ 而这个状态以前是**沉默的**', () => {
  /**
   * ── 这一臂就是本任务的交付 ────────────────────────────────────────────────────
   *
   * 契约原文：「证据被生产而无消费者 ⇒ ★ 而第二种必须【可读】——
   *            现在它是沉默的（没有人会从日志里看出来）」
   *
   * ★ 断言的是**状态本身**，不是一句措辞：`produced` 与 `consumed` /
   *   `unmeasured` 是三个不同的取值，所以读的人不需要解析自然语言。
   */
  const reading = traceEvidenceConsumer('newTestFiles', REPAIR_GATES)
  assert.equal(reading.status, 'produced', '★ repair 不要求 r5 ⇒ 那份证据没人读')
  assert.deepEqual(reading.consumers, [], '★ 而它必须如实报"消费者为空"')
  /**
   * ★ 而 detail 必须说清**两条**：谁**本来**会读它、以及**为什么这次没读到**。
   *   只说"没人读"会让读的人以为是判据不存在，而不是"这个 kind 不要它"。
   */
  assert.match(reading.detail, /completion\.r5/, '★ 要说清"谁本来会读它"')
  assert.match(reading.detail, /does not require/, '★ 以及"为什么这次没读到"')
})

test('★★ 臂 1b：那个状态**以前**是沉默的 —— 而它现在有了一句人话', () => {
  /**
   * ★ 这一臂钉的是"可读"这件事本身：一个只返回 `{ status: 'produced' }`
   *   而不给 `detail` 的实现，会让读日志的人**仍然**不知道发生了什么
   *   —— 那只是把沉默从"没有字段"搬到了"有一个看不懂的字段"。
   */
  const reading = traceEvidenceConsumer('newTestFiles', REPAIR_GATES)
  assert.equal(typeof reading.detail, 'string')
  assert.notEqual(reading.detail.trim(), '', '★ 它必须给出一句能读的人话')
  /** ★ 而三种状态的措辞**必须互不相同**（否则"可读"只是形状上的）。 */
  const consumed = traceEvidenceConsumer('newTestFiles', IMPL_GATES)
  const unmeasured = traceEvidenceConsumer('newTestFiles', undefined)
  assert.notEqual(reading.detail, consumed.detail)
  assert.notEqual(reading.detail, unmeasured.detail)
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 2（反向半边）：不许退化成恒 `produced`
// ═════════════════════════════════════════════════════════════════════════════

test('★★ 臂 2：implementation 上**同一条**证据是 `consumed` —— ★ 缺它这一格会恒 `produced`', () => {
  /**
   * ★ 一个 `return 'produced'` 的实现在臂 1 上**完全绿** —— 而它会把
   *   "这份证据有人读"也说成"没人读"。
   * ⇒ 必须同时断言：同一个字段在**要求 r5 的 kind** 上是 `consumed`。
   */
  const reading = traceEvidenceConsumer('newTestFiles', IMPL_GATES)
  assert.equal(reading.status, 'consumed')
  assert.deepEqual(reading.consumers, ['completion.r5'], '★ 而且指名是**哪条判据**读它')
})

test('★★ 臂 2b：`killerSuites` 在 repair 上是 `consumed`（mutation 是 repair 要求的门）', () => {
  /**
   * ★ 这一条是"接对了插座"的读数：t67 之后，那份证据**确实**走到了一扇
   *   repair 要求的门上（mutation）。
   *   ★ 而它与臂 1 成对：同一个 kind、同一份证据，**一格没人读、另一格有人读**。
   */
  const reading = traceEvidenceConsumer('killerSuites', REPAIR_GATES)
  assert.equal(reading.status, 'consumed')
  assert.deepEqual(reading.consumers, ['completion.mutation'])
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 3：第四态 —— 表读不到 ⇒ `unmeasured`，**不许**降级成 `produced`
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 臂 3：表读不到 ⇒ `unmeasured`，★ **不许**说成 `produced`', () => {
  /**
   * ── 这一格是本库最贵的那条纪律的落点 ────────────────────────────────────────
   *
   * 「'判不了'与'判了'必须不同形」。
   *
   * ★ 而这里的**方向**特别要紧：一个把"表读不到"降级成 `produced` 的实现，
   *   会报出一句**反过来的假结论** —— 它说"这份证据没人读"，而事实是
   *   **"我不知道谁读它"**。
   *   ⇒ 那会让一个**健康的**实现被记成有缺陷，而缺陷被记成正常时一样坏。
   *
   * ★ 与判据层那条纪律逐字对齐：`kind-requirements.ts` 的
   *   `absent` / `malformed` / `kind-unknown` 让门降级成 `unmeasured`，
   *   **绝不静默退化成"不需要门"**。
   */
  const reading = traceEvidenceConsumer('newTestFiles', undefined)
  assert.equal(reading.status, 'unmeasured')
  assert.notEqual(reading.status, 'produced', '★ "判不了"与"判了、没人读"必须不同形')
  assert.notEqual(reading.status, 'consumed', '★ 也不许说成"有人读"')
  assert.match(reading.detail, /could not be judged/, '★ 措辞要说清"我没能判"')
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 4：★ 必须可实测 —— 断言证据**走到了某一格并被某条判据读到**
// ═════════════════════════════════════════════════════════════════════════════

test('★★ 臂 4：证据**真的**从契约读出来、并走到 mutation 读的那一格', () => {
  /**
   * 契约原文：「★ 必须可实测：断言 discriminatingFiles 被生产出来之后走到某一格，
   *            并被某条判据真的读到 —— 而不是只断言它被算出来了」
   *
   * ★ 所以这一条走**三步**，每步各断言一件事：
   *   ① 证据被**生产**出来（从任务契约，不是会话事件）
   *   ② 它**走到**了 `killerSuites` 那一格（t67 的修法）
   *   ③ 而**那条判据**（mutation）是 repair 要求的门 ⇒ 它会被读到
   */
  /** ① 生产：从**契约**读（不是会话事件 —— 那正是 f-0020 的形状）。 */
  const produced = repairEvidenceFiles(repairCtx())
  assert.deepEqual(produced, [FIXTURE], '★ 证据必须从 changedPaths 读出来（契约，不是会话）')
  const verdict = repairCompletionVerdict(repairCtx())
  assert.equal(verdict.ok, true)
  assert.equal(verdict.discriminable, true)

  /** ② 走到哪一格：那两格各自"谁读它"。 */
  const asNewTestFiles = traceEvidenceConsumer('newTestFiles', REPAIR_GATES)
  const asKillerSuites = traceEvidenceConsumer('killerSuites', REPAIR_GATES)
  assert.equal(asNewTestFiles.status, 'produced', '★ newTestFiles 那一格：没人读（r5 对 repair 不要求）')
  assert.equal(asKillerSuites.status, 'consumed', '★ killerSuites 那一格：mutation 读它')

  /** ③ 而 mutation 是 repair 要求的门 ⇒ 那份证据**真的会被读到**。 */
  assert.ok(
    REPAIR_GATES.includes('completion.mutation'),
    '★ 夹具自检：mutation 是 repair 要求的门（表里这么写的）',
  )
  /**
   * ★★ 而本修法的全部内容就在这两行之间：
   *   同一份证据（`produced`），**修之前只喂给 `newTestFiles`**（没人读），
   *   **修之后也喂给 `killerSuites`**（mutation 读）⇒ 它有了消费者。
   */
  assert.ok(
    GATE_INPUT_FIELDS['completion.mutation'].includes('killerSuites'),
    '★ mutation 的输入面是 killerSuites —— 所以证据要落到那一格才会被读',
  )
})

test('★★ 臂 4b：`GATE_INPUT_FIELDS` 是"哪条判据读哪一格"的**唯一声明处**', () => {
  /**
   * ★ 若判据的输入面在别处又声明一次，就会有两份真相 —— 而它们会漂移，
   *   漂移之后两边读起来都正常（本队记账过三次）。
   *
   * ★ 而这一条**不断言**"这就是全部"，它断言的是**这几条**在表里、
   *   且与本任务那条链有关的两格都对得上。
   */
  assert.deepEqual(GATE_INPUT_FIELDS['completion.r5'], ['newTestFiles'], '★ r5 读的**唯一**是 newTestFiles')
  assert.ok(
    GATE_INPUT_FIELDS['completion.mutation'].includes('killerSuites'),
    '★ mutation 读 killerSuites',
  )
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 5（反向半边）：不许为了让这条绿而**删掉那条供给**
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 臂 5：那条供给**仍然在生产** —— ★ 不许把问题"消失"掉', () => {
  /**
   * ── 契约原文：「★ 反向半边：不许为了让这条绿而【删掉那条供给】
   *              （那会让问题消失而不是解决）—— 要么让它有消费者，
   *              要么明写它为什么被生产」
   *
   * ★ 而本任务选的是**让它在别处有消费者**（killerSuites），
   *   **同时保留** `newTestFiles` 那条供给（implementation 上它仍然有人读）。
   *
   * ⇒ 所以这一条断言：**两个 kind 上那条供给都还在**。
   *   一个"把 discriminatingFiles 整个删掉"的实现会让 `produced` 消失 ——
   *   而那不是修好，是**让读数消失**（本队记账：把缺陷删掉不是修好它）。
   */
  const repair = repairCompletionVerdict(repairCtx())
  assert.equal(repair.ok, true, '★ repair 上那条供给必须仍然被生产出来')
  assert.deepEqual(repair.evidence, [FIXTURE])

  const impl = repairCompletionVerdict({
    task: { id: 't', kind: 'implementation', inScope: [FIXTURE], changedPaths: [FIXTURE] },
    update: { changedPaths: [FIXTURE] },
  })
  assert.equal(impl.ok, true, '★ implementation 上它也仍然被生产出来')
  assert.deepEqual(impl.evidence, [FIXTURE])
})

test('★ 臂 5b：`discriminable: false` 那一支仍然在（★ 没人读 ≠ 没有可判的对象）', () => {
  /**
   * ★ 两种"空"必须不同形（t44 建立的）：
   *   · 有证据 ⇒ `discriminable: true`
   *   · 观察了、没有可判的对象 ⇒ `discriminable: false` + 说清为什么
   * ⇒ 而本修法一个字都没动它 —— 它只是**多接了一格消费者**。
   */
  const noFixture = repairCompletionVerdict({
    task: { id: 't', kind: 'repair', inScope: ['src/a.ts'], changedPaths: ['src/a.ts'] },
    update: { changedPaths: ['src/a.ts'] },
  })
  assert.equal(noFixture.ok, false)
  assert.equal(noFixture.discriminable, false)
  /**
   * ★ 夹具自检（本任务实测抓出来的）：第一版这里写的是 `/no test fixture/`，
   *   而实际原文是 "none of the 2 changed file(s) **is a test fixture** that can
   *   demonstrate the fix" —— 语义一样，措辞不同。
   *   ⇒ 断言必须对着**真的说过的话**，否则它会红在一个与主张无关的措辞上。
   */
  assert.match(
    noFixture.unmeasured, /none of the \d+ changed file\(s\) is a test fixture/,
    '★ 理由要说清"改的没有一条是夹具"',
  )
})

// ═════════════════════════════════════════════════════════════════════════════
// ★★ 定向突变（真的执行）
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ★ 突变体必须用 cache-busting 重新 import（t6/t55 的实测教训）。
 *   ★ 而本模块**没有本地 import** ⇒ 单个 bust 是够的；那一点由下面那条自检钉住。
 */
async function freshGate(tag) {
  return import(`${BUILT_GATE}?${tag}`)
}

/**
 * ★★★ `restore` **必须重新 build**（本任务实测抓出来的）
 *
 * MEASURED：第一版的 `restore` 只把源码写回去、**不重建 lib/**。于是：
 *   · 突变体那次 build 留在 `lib/quality-gates.js` 里；
 *   · 后续的臂（它们用**文件顶部**那个 import 绑定读 lib/）读到的仍是**突变体**；
 *   · 于是**臂 3**（"表读不到 ⇒ unmeasured"）在一个已经被还原的源码上红，
 *     而它红的原因是**盘上留着一份没人认得的构建产物** —— 与那一条臂的主张无关。
 *
 * ★ 而它与本队那条纪律同源：**突变体与它的还原必须是成对的**，
 *   否则"半还原的树"会让后续读数全部失真，而那比突变本身坏得多。
 *   （t55 是同型的：那次是"只还原两个文件里的一个"。）
 */
function withMutatedGate(mutatedSource, body) {
  const original = readFileSync(GATE_SOURCE, 'utf8')
  const restore = () => {
    writeFileSync(GATE_SOURCE, original)
    const rebuilt = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: true })
    assert.equal(rebuilt.status, 0, `★ 还原之后必须能重新 build 成功:\n${rebuilt.stdout}\n${rebuilt.stderr}`)
  }
  try {
    writeFileSync(GATE_SOURCE, mutatedSource)
    const built = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: true })
    assert.equal(built.status, 0, `★ 突变体必须编译得过（否则这次突变测的是 tsc，不是行为）:\n${built.stdout}\n${built.stderr}`)
    const result = body()
    if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
      return result.then(
        (value) => { restore(); return value },
        (error) => { restore(); throw error },
      )
    }
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}

/** 突变 A 的针脚：把 `killerSuites` 的消费者拿掉（= t67 修之前的样子）。 */
const NEEDLE_MUTATION_CONSUMER = `  'completion.mutation': ['killerSuites'],`

test('★★ 定向突变 A：把 `killerSuites` 的消费者去掉 ⇒ 臂 2b/臂 4 必须红', async (t) => {
  /**
   * ★ 本仓的收口纪律是**串行**（`rm -rf lib/` 的窗口会让并行读到假红），
   *   所以这一条由环境变量显式开启，默认跳过。
   */
  if (process.env.AGENT_TEAMS_EVIDENCE_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_EVIDENCE_MUTATION=1 时运行（见任务 output 里的读数）')
    return
  }

  const original = readFileSync(GATE_SOURCE, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_MUTATION_CONSUMER,
    `  'completion.mutation': [], // MUTANT: the consumer is gone`,
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行 —— 没匹配上的替换会让它恒不生效')

  await withMutatedGate(mutated, async () => {
    const mutant = await freshGate('mutation=consumer-gone')
    /**
     * ★ 这一条断言就是**臂 2b 的红**：`killerSuites` 不再有消费者
     *   ⇒ 那份证据在两个 kind 上都无人读 ⇒ 本任务要修的形态**复发**。
     */
    assert.equal(
      mutant.traceEvidenceConsumer('killerSuites', REPAIR_GATES).status, 'produced',
      '★ 去掉消费者之后 killerSuites 变成"生产了、没人读" —— 臂 2b 就是靠这一条变红的',
    )
    /** ★ 而 arm 4 的三步链也在那一格断掉。 */
    assert.equal(
      mutant.traceEvidenceConsumer('killerSuites', REPAIR_GATES).consumers.length, 0,
      '★ 消费者名单必须为空',
    )
  })

  /** ★ 还原之后逐字相等。 */
  const restored = await freshGate('mutation=restored')
  assert.equal(
    restored.traceEvidenceConsumer('killerSuites', REPAIR_GATES).status, 'consumed',
    '★ 还原之后必须回到 consumed',
  )
})

/** 突变 B 的针脚：把"表读不到"降级成 `produced`（第四态被并进第二态）。 */
const NEEDLE_UNMEASURED_BRANCH = `      status: 'unmeasured',
      consumers: [],
      detail: \`whether anything reads "\${field}" could not be judged`

test('★★★ 定向突变 B：把"表读不到"降级成 `produced` ⇒ 臂 3 必须红', async (t) => {
  /**
   * ★ 这一条测的是**第四态**：把"判不了"并进"判了"。
   *   ★ 而它的坏法特别阴：它报出一句**反过来的假结论** ——
   *     说"这份证据没人读"，而事实是"我不知道谁读它"。
   */
  if (process.env.AGENT_TEAMS_EVIDENCE_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_EVIDENCE_MUTATION=1 时运行')
    return
  }

  const original = readFileSync(GATE_SOURCE, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_UNMEASURED_BRANCH,
    `      status: 'produced', // MUTANT: "could not judge" is reported as "judged"
      consumers: [],
      detail: \`whether anything reads "\${field}" could not be judged`,
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行')

  await withMutatedGate(mutated, async () => {
    const mutant = await freshGate('mutation=fourth-state-gone')
    assert.equal(
      mutant.traceEvidenceConsumer('newTestFiles', undefined).status, 'produced',
      '★ 突变体把第四态并进了第二态 —— 臂 3 就是靠这一条变红的',
    )
  })
})

test('★ 二次对照：两条突变针脚在源码里【真的存在】', () => {
  const source = readFileSync(GATE_SOURCE, 'utf8')
  assert.equal(source.includes(NEEDLE_MUTATION_CONSUMER), true, '★ 突变 A 的针脚必须逐字存在')
  assert.equal(source.includes(NEEDLE_UNMEASURED_BRANCH), true, '★ 突变 B 的针脚必须逐字存在')
})

test('★★ 夹具自检：`freshGate` 的 cache-busting 够用（本模块无本地 import）', () => {
  /**
   * ★★ 与 t55 同一条教训：夹具只 bust 了一层，而它静态 import 的模块
   *   是**另一个实例** ⇒ 突变根本没被读到，而报告会读作"突变没打红"（方向相反）。
   *
   * ⇒ 本模块今天**没有**本地 import（只 import 内部同包模块时也会成链 ——
   *   而那条链上的每一个都不带 query）。
   * ★ 所以这里断言的是：**突变针脚所在的模块，与夹具 import 的是同一个文件**。
   */
  assert.equal(
    readFileSync(BUILT_GATE, 'utf8').includes(NEEDLE_MUTATION_CONSUMER), true,
    '★ 针脚必须真的出现在**构建产物**里 —— 否则突变改的是源码，而夹具读的是另一个文件',
  )
})

test('★★ 夹具自检：`freshGate` 读到的确实是【当前磁盘上】的那一份', async () => {
  const a = await freshGate('selfcheck=a')
  const b = await freshGate('selfcheck=b')
  assert.notEqual(a, b, '★ 不同的 query 必须拿到不同的模块实例 —— 否则突变臂会静默地测旧代码')
  assert.equal(typeof a.traceEvidenceConsumer, 'function')
  assert.equal(typeof b.repairEvidenceFiles, 'function')
  assert.equal(typeof traceEvidenceConsumer, 'function')
})
