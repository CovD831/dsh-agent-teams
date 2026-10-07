/**
 * ── f-0020 的另一半：completion 门的双向死锁（t44：先复现，再定修法）──────────────
 *
 * ── 这个文件的第一要务是【复现】，而不是修 ────────────────────────────────────
 *
 * 契约的原话：「★ 第一步是【复现今天的死锁】…若现在通过了 ⇒ 死锁已解，
 *              如实报「已解」而不是硬修」。
 *
 * ⇒ 本文件因此分成两半，而**第一半是主菜**：
 *
 *   第一半（复现）：把一个真实的 worktree worker 场景喂给**真实装配**，
 *                   逐条问"还剩哪一道门在拒"。
 *   第二半（定修法）：把复现的结论变成可执行的臂 + 一条能打红它的定向突变。
 *
 * ── ★★ 复现的结论（本文件实测，2026-10-07）──────────────────────────────────────
 *
 * ```
 *   A. 没有可判证据、键【缺席】（今天的真实形态）  ⇒ r5 不在 unmeasured 里 ⇒ 【已解】
 *   B. 有可判证据（注入夹具）                      ⇒ r5 不在 unmeasured 里 ⇒ 【已解】
 *   C. 空数组（discriminatingFiles = []）          ⇒ r5 【重新】出现在 unmeasured ⇒ 仍在
 * ```
 *
 * ⇒ **死锁的一半已解**（t41 把观察面扩到「主树 ∪ worktree」，于是申报的真实路径
 *   不再被 changedPaths 判据拒；而"没有可判证据"时 `newTestFiles` 键**缺席**，
 *   `r5.appliesTo` 为假 ⇒ 判据正确跳过）。
 *
 * ⇒ 而 C 那一格**仍然是一道永远关着的门**，且它是**可达的**：
 *
 *     一份只改了非测试文件的 repair
 *       ⇒ `observedTestFiles === []`（观察到了、确实没有测试写入）
 *       ⇒ 且 `repairCompletionVerdict.ok === false`（没有可判夹具）
 *       ⇒ `discriminatingFiles = []`（调用方的回落）
 *       ⇒ `r5.appliesTo` 为真（它只问 `Array.isArray`）
 *       ⇒ 进 ③ 支 ⇒ 恒 `unmeasured` ⇒ **永远交不出终态**
 *
 * ── ★★★ 而这个形状最反直觉的一点，值得单独写下来 ─────────────────────────────
 *
 *     **空数组比没有数组更坏。**
 *
 *   `{}`（键缺席）⇒ `appliesTo` 为假 ⇒ 判据**跳过** ⇒ 不阻断。
 *   `{ newTestFiles: [] }` ⇒ `appliesTo` 为真 ⇒ 判据开火 ⇒ 恒拒。
 *
 * ⇒ 这是本队记账的「触发点偏了」的第二次发作（第一次是 t40 的 inScope 覆盖检查）：
 *   一条规则在**它没有对象可判**的时候仍然开火，而开火产物是一个恒常的拒绝。
 *
 * ── 修法（落在 `src/quality-gates.ts`，t44 的 inScope）────────────────────────
 *
 * `repairCompletionVerdict` 多交一格 `discriminable`：**这次到底有没有可判的对象**。
 *
 *     discriminable: false ⇒ ★ 调用方**不要注入** `newTestFiles`
 *                            （让它缺席 ⇒ r5 正确跳过，与 verify-rerun 对空 verify
 *                             的处理逐字同形：`ctx.task.verify.length > 0` 才开火）
 *
 * ★★ 而这一格**不是**"放宽"，也不是 `ok` 的同义改写 —— 这是本文件最重要的边界：
 *
 *     discriminable: false ⇒ "没有对象可判" ⇒ 那条判据**不说话**
 *     有对象、而对象**不判别** ⇒ 仍然 `discriminable: true` ⇒ 照常被 r5 拒
 *
 * ⇒ 见"定向突变"那一节：把 `discriminable` 改成恒 `false` ⇒ 那条
 *   「改了夹具、而夹具不再能判别 ⇒ 必须被拒」的臂**必须红**。
 *   换句话说：本格放宽的是「没有对象」，**绝不是**「对象不合格」。
 *
 * ── ★ 本文件刻意不写的一句话（本队已因这类棘轮返工多次）────────────────────────
 *
 * 「注册表现在有几条判据」「某个任务 id 现在是什么状态」**都不是不变量**。
 * 本文件的场景全部是**自己造的**（临时目录 + 自己写的 ctx），
 * 不读盘上真实的 team.json —— 一个去读真实团队的夹具会在下一次团队重建时
 * 按设计变红，而红的原因与"死锁"毫无关系。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { repairCompletionVerdict, repairEvidenceFiles } from '../lib/quality-gates.js'
import * as r5 from '../lib/gates/completion/r5.js'

import { kindRequirementsTable } from './kind-requirements-table.mjs'
import { parseKindRequirements } from '../lib/gates/completion/r5.js'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GATE_SOURCE = join(ROOT, 'src', 'quality-gates.ts')
const BUILT_GATE = join(ROOT, 'lib', 'quality-gates.js')

/** 一个真实的 worktree worker 形状：改动落在测试夹具上（t40 的实测形态）。 */
const FIXTURE = 'scripts/gate-inscope-overlap.test.mjs'
const IMPL = 'src/quality-gates.ts'

/**
 * ★ 走**真实装配**（`buildRegistry()`），而不是只调一条判据 ——
 *   复现要回答的是"还剩哪一道门在拒"，那就必须看**整个位置**的合并结论。
 */
async function evaluateCompletion(ctx) {
  const { buildRegistry } = await import('../lib/gates/index.js')
  return buildRegistry().evaluate('completion', ctx)
}

/** 真实路径上，没有可判证据时 `discriminatingFiles` 是 undefined ⇒ 键缺席。 */
function worktreeWorkerCtx({ newTestFiles } = {}) {
  return {
    /**
     * ★ t54：kind 需求表 —— 由调用方注入（判据不读盘）。
     *   缺了它三条门都问不出"这个 kind 要不要我"，而那是「没能测量」，不是本臂要测的东西。
     */
    loadKindRequirements: () => TABLE,
    task: { id: 't44', kind: 'repair', inScope: [IMPL, FIXTURE], changedPaths: [IMPL, FIXTURE] },
    update: {
      status: 'completed',
      changedPaths: [IMPL, FIXTURE],
      ...newTestFiles === undefined ? {} : { newTestFiles },
    },
    wantsCompleted: true,
    taskNotTerminal: true,
    scanDirs: ['scripts'],
    parentRevision: 'HEAD',
    /** 夹具在父版本上红、在修复版本上绿 —— 它是**能判别**的那种。 */
    runTestOnRevision: async (_test, revision) => ({ exitCode: revision === 'working-tree' ? 0 : 1 }),
  }
}

const r5Unmeasured = (evaluation) => (evaluation.unmeasured ?? '').includes('[completion.r5]')

// ═════════════════════════════════════════════════════════════════════════════
// 第一半：复现 —— 逐条问"还剩哪一道门在拒"
// ═════════════════════════════════════════════════════════════════════════════


const TABLE = kindRequirementsTable(parseKindRequirements)

test('★★ 复现 A：没有可判证据、键【缺席】（今天的真实形态）⇒ r5 不阻断 —— 这半【已解】', async () => {
  /**
   * ★ 这一条记的是**"已解"这个结论本身**，而它与"硬修一个不存在的问题"
   *   必须不同形（契约原话）。
   *
   * 为什么它会解：`discriminatingFiles` 在"没有可判证据"时是 `undefined`
   * ⇒ `newTestFiles` 键**缺席** ⇒ `r5.appliesTo` 为假 ⇒ 判据跳过 ⇒ 不进 unmeasured。
   */
  const evaluation = await evaluateCompletion(worktreeWorkerCtx())
  assert.equal(
    r5Unmeasured(evaluation), false,
    `★ r5 不该再阻断这个形态（t41 之后它已解）：${evaluation.unmeasured}`,
  )
  /** ★ 而 r5 是**跳过**，不是"通过" —— 两者必须不同形（跳过 = 它不说话）。 */
  assert.equal(r5.appliesTo(worktreeWorkerCtx()), false, '★ 键缺席 ⇒ 判据跳过（不是"它说通过了"）')
})

test('★★ 复现 B：有可判证据（注入夹具）⇒ r5 真的跑，且通过', async () => {
  /**
   * ★ 缺了这条，"已解"可能只是"判据从不运行"—— 而那与"死锁解了"在读数上同形。
   *   这一臂证明：有证据时 r5 **真的测量**，且判据给出的是 ok。
   */
  const verdict = await r5.gate({ ...worktreeWorkerCtx({ newTestFiles: [FIXTURE] }) })
  assert.equal(verdict.ok, true, `★ 有可判证据时 r5 必须真的测量并通过：${JSON.stringify(verdict)}`)
  assert.deepEqual(
    verdict.r5.verified.map((item) => item.test), [FIXTURE],
    '★ 而且它验的就是那份夹具（不是空集被当成"没有测试要查"）',
  )
})

test('★★ 复现 C（★ t54 后**已改口径**）：repair + 空数组**不再**进 r5 —— 而 implementation 仍然进', async () => {
  /**
   * ── ★★ 这一条的口径在 t54 之后**反过来了**，而那个反转是本任务最实质的一个后果 ──
   *
   * MEASURED（t48/t27 记录的那条死锁）：`repair` + `newTestFiles: []`
   *   ⇒ `r5.appliesTo` 为真 ⇒ 进那一支 ⇒ **恒 unmeasured** ⇒ 恒交不出终态。
   *   而今天 16 个任务里绝大多数是 repair ⇒ 那是无人值守最大的那类阻断。
   *
   * ★ 而 t54 把 kind 守卫移进数据表，并对 `repair` 做了**明写的决定**：
   *
   *     repair 要 mutation + backtest，**不要 r5**
   *     理由：「修复类的判别证据是【既有夹具】改变判决（t31 已建）；
   *            在这里要求新测试会把成员推向写**装饰性的**测试」
   *
   * ⇒ ★ 于是**那条死锁路径在 repair 上不可达了** ——
   *   不是"修好了那一支"，而是"repair 根本不进那条路"。
   *
   * ★ 而**机制本身仍在**：`implementation` + 空数组照样会走到 r5（表说它要 r5）。
   *   ⇒ 所以下面**两半都要断言**：不然后半句会变成"死锁被悄悄修掉了"的错觉。
   */
  const repairEval = await evaluateCompletion(worktreeWorkerCtx({ newTestFiles: [] }))
  assert.equal(
    r5Unmeasured(repairEval), false,
    '★ t54：repair 不再进 r5 ⇒ 那一支不再被它踩到（而死锁的机制本身没有被删）',
  )

  /**
   * ★★ 而**死锁的机制仍在** —— 换一个表说"要 r5"的 kind，同一种输入仍走进那一支。
   *   ★ 缺了这一半，上面那条断言在"r5 被整个删掉"的实现上也成立。
   */
  const implCtx = { ...worktreeWorkerCtx({ newTestFiles: [] }), task: { id: 't44', kind: 'implementation', inScope: [IMPL, FIXTURE], changedPaths: [IMPL, FIXTURE] } }
  const implEval = await evaluateCompletion(implCtx)
  assert.equal(
    r5Unmeasured(implEval), true,
    '★ 死锁的**机制**仍在：表说要 r5 的 kind + 空数组 ⇒ 仍然开火并恒拒',
  )
  assert.match(
    String(implEval.unmeasured), /none of the 0 reported file\(s\)/,
    '★ 逐字记下它的措辞（那一句就是死锁的读数）',
  )
})

test('★★ 复现 C2：那一格是【可达的】—— 只改非测试文件的 repair 就会走到它', async () => {
  /**
   * ── 为什么必须证明"可达" ──────────────────────────────────────────────────────
   *
   * 一条只在理论输入上存在的缺口，与一条**每一份"只改源码"的 repair 都会撞上**的
   * 缺口，是完全不同的两件事。契约要求"诱导复现"，指的就是后者。
   *
   * ★ 本条走真实推导链，而不是硬造一个空数组：
   *
   *     一份只改了 `src/quality-gates.ts` 的 repair（**没碰任何测试文件**）
   *       ⇒ `repairEvidenceFiles` 为空（没有测试夹具）
   *       ⇒ `repairCompletionVerdict.ok === false`
   *       ⇒ 调用方回落 ⇒ `discriminatingFiles` 为空 ⇒ r5 开火
   */
  const nonTestOnly = {
    task: { kind: 'repair', inScope: [IMPL], changedPaths: [IMPL] },
    update: { changedPaths: [IMPL] },
  }
  assert.deepEqual(repairEvidenceFiles(nonTestOnly), [], '★ 只改源码 ⇒ 一条夹具都拿不到（前提）')
  const verdict = repairCompletionVerdict(nonTestOnly)
  assert.equal(verdict.ok, false, '★ 于是这一格说"没有可测量的判别力证据"（前提）')
  /**
   * ★ 而"观察到了、确实没有"与"没能观察"必须不同形（本队记账最久的那条界线）：
   *   前者带 `changed.length`，后者说 "no file change was observed"。
   */
  assert.doesNotMatch(verdict.unmeasured, /no file change was observed/, '★ 这是"观察到了、确实没有"，不是"没能观察"')
})

// ═════════════════════════════════════════════════════════════════════════════
// 第二半：修法 —— `discriminable` 把"有没有可判的对象"交出去
// ═════════════════════════════════════════════════════════════════════════════

test('★★ 修法：`discriminable: false` 让调用方【不注入】空数组 ⇒ r5 正确跳过', async () => {
  /**
   * ★ 这一条是修法的**全部内容**：把"没有可判的对象"这个事实交出去，
   *   好让调用方**不注入** `newTestFiles`（而是让它缺席）。
   *
   * ★ 为什么这一格必须有：调用方今天回落到 `newTestFiles`（= 空数组），
   *   而"空数组 ⇒ r5 开火 ⇒ 恒拒"正是复现 C。调用方**没有别的办法**知道
   *   "这次到底有没有对象" —— 它只能重新推导一遍 `repairEvidenceFiles`，
   *   而那会变成两份推导（它们会漂移，且漂移后两者读起来都正常）。
   */
  const noEvidence = repairCompletionVerdict({
    task: { kind: 'repair', inScope: [IMPL], changedPaths: [IMPL] },
    update: { changedPaths: [IMPL], newTestFiles: [] },
  })
  assert.equal(noEvidence.ok, false)
  assert.equal(noEvidence.discriminable, false, '★ 没有可判的对象 ⇒ 这一格必须是 false')

  /**
   * ★★ 而"按它行事"的效果必须**真的**看得见：不注入 ⇒ 判据跳过 ⇒ 不阻断。
   *   只断言 `discriminable === false` 是不够的 —— 一个"拒不拒绝都同形"的
   *   读数在日志里救不了任何人。这里把**后果**也钉住。
   */
  const evaluation = await evaluateCompletion(worktreeWorkerCtx())
  assert.equal(r5Unmeasured(evaluation), false, '★ 不注入 ⇒ r5 不阻断（与复现 A 同一个机制）')
})

test('★★ 修法 B：有可判证据时 `discriminable: true` —— 这一格【不许恒 false】', async () => {
  /**
   * ── 缺了这条，一个"恒 false"的实现会全绿 ──────────────────────────────────────
   *
   * `discriminable: false` 的效果是"让判据跳过"。一个**恒** `false` 的实现
   * 会让 r5 在**所有**输入上都跳过 —— 包括"改了夹具、而夹具是装饰品"那种。
   * ⇒ 那条护栏就没了，而本文件的每一条"跳过"断言都会替它鼓掌。
   */
  const withEvidence = repairCompletionVerdict({
    task: { kind: 'repair', inScope: [IMPL, FIXTURE], changedPaths: [IMPL, FIXTURE] },
    update: { changedPaths: [IMPL, FIXTURE], newTestFiles: [] },
  })
  assert.equal(withEvidence.ok, true)
  assert.equal(withEvidence.discriminable, true, '★ 有对象可判 ⇒ 这一格必须是 true')
  assert.deepEqual(withEvidence.evidence, [FIXTURE], '★ 而且要交出那几个对象')
})

test('★★ 修法 C：`discriminable` 与 `ok` 【不是】同一件事（不许合成一格）', () => {
  /**
   * ── 两份读数，回答两个问题 ────────────────────────────────────────────────────
   *
   *     `ok === true`   ⇒ 有证据，**去测量它们**
   *     `discriminable` ⇒ 这一次**有没有东西可测**
   *
   * ★ 它们三个分支上**都不同值**（见下表），所以合并任何一个都会丢信息：
   *
   *     分支                      ok      discriminable
   *     有证据                    true    true
   *     观察了、没有对象          false   false
   *     没能观察                  false   false
   *
   * ⇒ 第 2、3 行在 `ok` 上同形，而在**成因**上不同形（措辞不同）。
   *   本臂把三行都钉住，好让"合成一个布尔"这个自然的偷懒**当场红**。
   */
  const branches = {
    hasEvidence: repairCompletionVerdict({ task: { kind: 'repair', inScope: [FIXTURE], changedPaths: [FIXTURE] }, update: { changedPaths: [FIXTURE] } }),
    observedNoObject: repairCompletionVerdict({ task: { kind: 'repair', inScope: [IMPL], changedPaths: [IMPL] }, update: { changedPaths: [IMPL] } }),
    notObserved: repairCompletionVerdict({ task: { kind: 'repair' } }),
  }
  assert.equal(branches.hasEvidence.ok, true)
  assert.equal(branches.hasEvidence.discriminable, true)
  assert.equal(branches.observedNoObject.ok, false)
  assert.equal(branches.observedNoObject.discriminable, false)
  assert.equal(branches.notObserved.ok, false)
  assert.equal(branches.notObserved.discriminable, false)
  /** ★ 而第 2、3 行的**成因**必须不同形（否则"我瞎了"与"我看清了、确实没有"同形）。 */
  assert.notEqual(
    branches.observedNoObject.unmeasured, branches.notObserved.unmeasured,
    '★ "观察到了、确实没有对象"与"没能观察"必须是两句不同的话',
  )
})

// ═════════════════════════════════════════════════════════════════════════════
// ★★ 反向半边：不许退化成不把关
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 反向半边：装饰性夹具（它不再判别）⇒ 仍然必须被拒', async () => {
  /**
   * ── 这一臂是本文件存在的另一半理由 ────────────────────────────────────────────
   *
   * 本任务做的是**让一条判据在"没有对象"时跳过**。而"跳过"这个动作有一个
   * 很自然的过度写法：让它**总是**跳过。那个实现在上面每条"跳过"断言上都绿 ——
   * 而它会把 r5 防的东西（**装饰性测试**：为新工作写测试却抓不住缺陷）整个放掉。
   *
   * ★ 分界线（本修法的全部内容，也写在 `src/quality-gates.ts` 的注释里）：
   *
   *     没有对象可判                        ⇒ 跳过（本格放宽的**只有**这一种）
   *     有对象、而对象**不判别**（哪个版本都绿）⇒ 仍然拒绝 ← 本条钉的就是它
   */
  const decorative = await r5.gate({
    ...worktreeWorkerCtx({ newTestFiles: [FIXTURE] }),
    /** ★ 那条夹具在**两个版本上都绿** ⇒ 它抓不住任何东西 ⇒ 装饰品。 */
    runTestOnRevision: async () => ({ exitCode: 0 }),
  })
  assert.equal(
    decorative.ok, false,
    `★ 装饰性夹具必须仍然被拒 —— 修法放宽的是"没有对象"，绝不是"对象不合格"：${JSON.stringify(decorative)}`,
  )
  assert.match(String(decorative.unmeasured ?? decorative.blockers ?? ''), /decorative|never failed/, '★ 而且理由要说清是"它不判别"')
})

test('★★ 反向半边 B：链断了/父版本拿不到 ⇒ 仍 unmeasured（不许并进通过）', async () => {
  /**
   * ★ 与 `verify-rerun` / `mutation` 同一条纪律：**没能测量**绝不会变成**通过**。
   *   本任务只让"没有对象"这一种情形跳过；其余每一种 unmeasured 都必须原样保留。
   */
  const noParent = await r5.gate({
    ...worktreeWorkerCtx({ newTestFiles: [FIXTURE] }),
    parentRevision: undefined,
  })
  assert.equal(noParent.ok, false, '★ 拿不到父版本 ⇒ unmeasured，不是 ok')
  assert.match(String(noParent.unmeasured), /parent revision/, '★ 且说清是"拿不到父版本"')
})

// ═════════════════════════════════════════════════════════════════════════════
// ★★ 定向突变（真的执行）
// ═════════════════════════════════════════════════════════════════════════════

function withBuiltGate(mutatedSource, body) {
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

/** ★ 突变体必须用 cache-busting 重新 import（t6 的实测教训：顶部绑定指向加载时那一份）。 */
async function freshGate(tag) {
  return import(`${BUILT_GATE}?${tag}`)
}

/**
 * ★ 突变的针脚与**它为什么是这个方向**（这一段是本任务最值得留下来的一课）
 *
 * 契约要的方向是「把某个判据的 unmeasured 分支去掉 ⇒ 对应臂红」。
 * 我先试了"把 `discriminable` 改成恒 false"，而**它编译不过**：
 *
 *     src/quality-gates.ts(457,28): error TS2322:
 *       Type '{ ok: true; evidence: string[]; discriminable: false; }' is not
 *       assignable to type 'RepairCompletionResult'.
 *
 * ★ 原因是**类型本身把那条不变量写进去了**：
 *     `{ ok: true; evidence: string[]; discriminable: true }`
 *   ⇒ `ok === true` 与 `discriminable === true` 在类型层**互为充要**，改不坏。
 *   ★ 这不是坏消息 —— 它是"两条读数不许矛盾"这条纪律的编译期落点。
 *     夹具如实报了"突变体必须编译得过（否则这次突变测的是 tsc，不是行为）"，
 *     而那正是这条断言的用处：**它拦住了一次测错东西的突变**。
 *
 * ⇒ 换个**可编译**且**真的改变行为**的方向：让"观察到了、没有对象"那一支
 *   谎报 `discriminable: true` ⇒ 调用方于是会注入空数组 ⇒ f-0020 的第二半**复发**。
 *   那正是本任务要防的形态，而它必须能被臂抓住。
 */
const NEEDLE_NO_OBJECT_BRANCH = `  return {
    ok: false,
    discriminable: false,
    unmeasured:
      \`the repair completion could not be judged: none of the \${changed.length} changed file(s) \``

test('★ 定向突变：把 `discriminable` 改成【恒 false】⇒ 反向半边必须红（放宽变成了不把关）', async (t) => {
  /**
   * ★ 本仓的收口纪律是**串行**（`rm -rf lib/` 的窗口会让并行读到假红），所以这一条
   *   由环境变量显式开启，默认跳过，由本任务的验证读数那次单独运行。
   */
  if (process.env.AGENT_TEAMS_DEADLOCK_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_DEADLOCK_MUTATION=1 时运行（见任务 output 里的读数）')
    return
  }

  const withEvidence = {
    task: { kind: 'repair', inScope: [FIXTURE], changedPaths: [FIXTURE] },
    update: { changedPaths: [FIXTURE] },
  }
  /** ★ 本突变瞄准的那一支：**观察到了、但没有可判的对象**（复现 C2 的形状）。 */
  const observedNoObject = {
    task: { kind: 'repair', inScope: [IMPL], changedPaths: [IMPL] },
    update: { changedPaths: [IMPL] },
  }
  /**
   * ★ 突变体上的注册表：`buildRegistry()` 每次调用都**新建**一个实例，所以
   *   它读到的就是刚刚 build 出来的那一份 —— 不需要 cache-busting
   *   （bust 的是 `import` 的模块缓存，而这里要的是一条新的注册表）。
   */
  const mutantRegistry = async () => {
    const { buildRegistry } = await import(`${join(ROOT, 'lib', 'gates', 'index.js')}?mutation=claims-an-object`)
    return buildRegistry()
  }
  /**
   * ★ 基线（**突变之前**）的同一份读数。★ 必须在这里、`withBuiltGate` 之**外**取：
   *   一旦 build 被换成突变体，`lib/` 里的一切都是突变过的 —— 在那一刻再算一次
   *   "基线"，算出来的其实是突变体自己，两边会**同形**，而那次突变于是什么都没证明。
   *   （本任务第一版就是这么写的，实测在这条断言上红。）
   */
  /**
   * ── 基线（**突变之前**取，见下）────────────────────────────────────────────────
   *
   * ★ 三份读数，各钉一件事：
   *   ① 有证据时 `discriminable === true` 且交出夹具（否则下面测的不是突变）；
   *   ② **缺席**形态 ⇒ r5 不阻断（复现 A：这一半已解）；
   *   ③ **空数组**形态 ⇒ r5 阻断（复现 C：这一半仍在，而它正是危险的来源）。
   *
   * ★ ①③ 必须在这里、`withBuiltGate` 之**外**取：一旦 build 换成突变体，
   *   `lib/` 里的一切都是突变过的 —— 在那一刻再算"基线"，算出来的是突变体自己，
   *   两边同形，那次突变于是什么都没证明。（本任务第一版就这么写过。）
   */
  const baselineGate = await freshGate('mutation=baseline')
  const baseline = {
    discriminable: baselineGate.repairCompletionVerdict(withEvidence).discriminable,
    evidence: baselineGate.repairCompletionVerdict(withEvidence).evidence,
  }
  assert.deepEqual(
    baseline, { discriminable: true, evidence: [FIXTURE] },
    '★ 突变之前：有证据 ⇒ discriminable 为真、交出那条夹具',
  )
  const absentBlocks = r5Unmeasured(await evaluateCompletion(worktreeWorkerCtx()))
  const emptyArrayBlocks = r5Unmeasured(await evaluateCompletion(worktreeWorkerCtx({ newTestFiles: [] })))
  assert.equal(absentBlocks, false, '★ 基线：**缺席** ⇒ r5 跳过（复现 A：已解）')
  assert.equal(emptyArrayBlocks, true, '★ 基线：**空数组** ⇒ r5 恒拒（复现 C：仍在）')

  /**
   * ── 突变体：让"观察到了、没有对象"那一支谎报 `discriminable: true` ──────────────
   *
   * ★ 它复现的正是 f-0020 第二半：调用方拿到"有对象" ⇒ **注入空数组** ⇒ r5 开火
   *   ⇒ 恒拒。也就是说，这个谎报会把上面 `absentBlocks === false` 那一条**治好的**
   *   情形重新关掉 —— 而那正是我们要能抓住的退化。
   *
   * ★ 为什么不写成"把 `discriminable` 改成恒 false"（契约字面的那个方向）：
   *   它**编译不过** —— 类型里写着 `{ ok: true; evidence: string[]; discriminable: true }`，
   *   于是 `ok===true` 与 `discriminable===true` 在类型层互为充要，改不坏。
   *   夹具如实报了"突变体必须编译得过"，而那正是那条断言的用处：
   *   它拦住了一次**测错东西**的突变。⇒ 换一个可编译、且真的改变行为的反向写法。
   *
   * ★ `replaceAll` 之后**必须断言真的替换到了**：一次没匹配上的 `replace` 会让
   *   突变体与基线逐字相同，于是"变了没有"变成恒假 —— 而报告会说"突变没打红"。
   */
  const original = readFileSync(GATE_SOURCE, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_NO_OBJECT_BRANCH,
    /* MUTANT: this branch claims an object exists */ NEEDLE_NO_OBJECT_BRANCH.replace('discriminable: false', 'discriminable: true'),
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行 —— 没匹配上的替换会让它恒不生效')

  await withBuiltGate(mutated, async () => {
    const mutant = await freshGate('mutation=claims-an-object')
    /** ★ 突变体的读法反了：它说"有对象"。 */
    assert.equal(
      mutant.repairCompletionVerdict(observedNoObject).discriminable, true,
      '★ 突变体谎报"有对象" —— 那正是 f-0020 第二半复发的形状',
    )
    /**
     * ★ 并把**后果**钉住：按这个谎报行事 ⇒ 调用方注入空数组 ⇒ r5 开火 ⇒ 恒拒。
     *   只断言那一格变了是不够的 —— 一个"读数变了但没人受它影响"的突变
     *   在日志里救不了任何人。
     */
    assert.equal(
      r5Unmeasured(await evaluateCompletion(worktreeWorkerCtx({ newTestFiles: [] }))), true,
      '★ 谎报"有对象"会让空数组被注入 ⇒ r5 恒拒 ⇒ 死锁复发',
    )
    /** ★ 而基线那一份（**缺席**形态）曾经不阻断 —— 两边的读数必须不同形。 */
    assert.notEqual(absentBlocks, emptyArrayBlocks, '★ 缺席与空数组本来就不同形（这是基线自己就有的对照）')
  })

  /** ★ 还原之后逐字相等：一次中途失败会把一份被突变的实现留在盘上。 */
  const restored = await freshGate('mutation=restored')
  assert.deepEqual(
    {
      discriminable: restored.repairCompletionVerdict(withEvidence).discriminable,
      evidence: restored.repairCompletionVerdict(withEvidence).evidence,
    },
    baseline,
    '★ 还原之后必须与突变前逐字一致 —— 否则盘上留着一份没人认得的实现',
  )
})

test('★ 二次对照：突变针脚在源码里【真的存在】', () => {
  assert.equal(
    readFileSync(GATE_SOURCE, 'utf8').includes(NEEDLE_NO_OBJECT_BRANCH), true,
    '★ 突变针脚必须逐字存在于 quality-gates.ts —— 它不在了，"定向突变"就是在改一个不存在的字符串',
  )
})

test('★★ 夹具自检：`freshGate` 读到的确实是【当前磁盘上】的 lib', async () => {
  const a = await freshGate('selfcheck=a')
  const b = await freshGate('selfcheck=b')
  assert.notEqual(a, b, '★ 不同的 query 必须拿到不同的模块实例 —— 否则突变臂会静默地测旧代码')
  assert.equal(typeof a.repairCompletionVerdict, 'function')
  assert.equal(typeof b.repairEvidenceFiles, 'function')
  assert.equal(typeof repairCompletionVerdict, 'function')
})
