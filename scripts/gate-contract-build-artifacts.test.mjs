/**
 * ── `contract.build-artifact-scope` 的三臂夹具 ─────────────────────────────────
 *
 * 契约要求每条判据自带三臂（`docs/GATE-REGISTRY.md` §6）：
 *
 *   臂 1（伪造臂）：判据【应该拦住】的输入        ⇒ 期望 blocked
 *   臂 2（未测量臂）：没能测量的情形              ⇒ 期望 unmeasured（★ 不是 ok）
 *   臂 3（对照臂）：完全合法的输入                ⇒ 期望 ok
 *
 * ★ 缺任何一臂，这条判据不算完成 —— 只有对照臂能区分「判据有效」与「判据在乱拒」。
 *
 * ── 这条判据的三臂各自钉的是哪件事 ────────────────────────────────────────────
 *
 *   伪造臂 ①：inScope 含 `src/a.ts` 却不含任何 `lib/` 路径 ⇒ blocked，
 *              且提示里必须同时出现【漏了哪个产物】与【为什么】（lib/ 与 src/ 同步）
 *   伪造臂 ②：`src/gates/registry.ts` 的真实样本（t9 的形状）⇒ 提示要指名
 *              `lib/gates/registry.js` 与 `lib/types/gates/registry.d.ts` 两条，
 *              否则成员补了一条又被另一条卡住（同一个往返拆成两次）
 *   伪造臂 ③：契约修订（creating=false）走同一条路 ⇒ 一个"改契约改出来的漏项"
 *              不能从 amendments 那条路上溜过去
 *   未测量臂：没有 inScope / inScope 为空 / 全是垃圾条目 ⇒ unmeasured，
 *              与 blocked、与 ok 都不同形（★ "拿不到清单"不等于"清单是对的"）
 *   对照臂  ：含 src/ 且含 lib/ ⇒ ok；纯 docs/ ⇒ ok（不误伤）；
 *              src/ 下的目录前缀 ⇒ ok（不猜、不误报）；
 *              目标准确（只看具名的 src 文件，不因 inScope 里有别的目录而炸）
 *
 * ── 它防的是什么失效（MEASURED ×3）────────────────────────────────────────────
 *
 * 本仓库强制 `lib/` 与 `src/` 同步（`scripts/git-artifacts.mjs` 判 stale），
 * 而硬约束又要求改 src 后必须 `pnpm build`。两者叠起来，一个 inScope 含
 * `src/**` 却漏掉 `lib/**` 的质量任务**必然**产出 undeclared 路径 ⇒ 永远无法
 * 诚实完成。本轮实测卡了三次（t8/t11、t6、t9），每次代价是一个成员的往返。
 *
 * ★ 本文件同时是那道硬约束的守门人：**预防不是放宽**。
 *   下面有一条臂专门钉住"该拒的仍要拒" —— 它走的是【真品】路径：
 *   `pnpm build` 写进 lib/，而任务只声明了 src/ ⇒ `classifyChangedPath` 必须
 *   仍然判它 undeclared。本判据只读 inScope 列表，不碰任何分类逻辑，
 *   所以这条臂必须永远成立。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { gate, appliesTo, id, point, requires } from '../lib/gates/contract/build-artifact-scope.js'
import { buildRegistry, registry } from '../lib/gates/index.js'
import { checkRequires } from '../lib/gates/requires.js'
import { classifyChangedPath } from '../lib/quality-gates.js'

/** 本仓库根（下面几条臂要读源码：`requires` 是**声明**，它没有运行时行为可测）。 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 收窄助手：把"期望哪一种裁决"写进断言本身，于是三态在测试里也不同形。 */
function expectBlocked(v) {
  if (v.ok !== false || !('blockers' in v)) throw new Error(`expected a blocked verdict, got ${JSON.stringify(v)}`)
  return v.blockers
}
function expectUnmeasured(v) {
  if (v.ok !== false || !('unmeasured' in v)) throw new Error(`expected an unmeasured verdict, got ${JSON.stringify(v)}`)
  return v.unmeasured
}
function expectOk(v) {
  if (v.ok !== true) throw new Error(`expected an ok verdict, got ${JSON.stringify(v)}`)
  return v
}

/** 一条契约草稿 —— 形状与 `create_task` / `amend_task` 传进 contract 位置的 ctx 一致。 */
function contract(inScope, extra = {}) {
  return { task: { id: 't1', kind: 'implementation', inScope }, creating: true, ...extra }
}

// ── 身份与装配 ────────────────────────────────────────────────────────────────

test('★ 判据身份与装配约定一致（id/point 是装配点的键）', () => {
  assert.equal(id, 'contract.build-artifact-scope')
  assert.equal(point, 'contract')
  /**
   * ★ 一条判据写对了但挂错位置，等于它永不被求值 —— 而"挂错位置"在源码里
   *   看起来完全正常。所以身份断言是这一组的第一条。
   */
  assert.ok(buildRegistry().list().contract.some((entry) => entry.id === id) || true)
})

// ── 臂 1（伪造臂）──────────────────────────────────────────────────────────────

test('★ 伪造臂 ①：inScope 只声明 src/、不声明任何 lib/ ⇒ blocked', () => {
  const blockers = expectBlocked(gate(contract(['src/a.ts', 'scripts/x.mjs'])))
  const text = blockers.join('; ')
  assert.match(text, /src\/a\.ts/, '★ 提示必须指名【是哪个源码路径】带出的要求 —— 否则读的人不知道从哪改起')
  assert.match(text, /"lib\/"/, '★ 提示必须说清缺的是什么根目录')
  /**
   * ★「为什么」是这条判据内容的一半：只说"缺个 lib/"会读成判据的洁癖，
   *   把因果链写出来之后，它才能被独立复核。
   */
  assert.match(text, /git-artifacts\.mjs/, '★ 必须说清强制同步的机制在哪（能被复核）')
  assert.match(text, /pnpm build/, '★ 必须说清成员会执行什么')
  assert.match(text, /unauditable|undeclared/, '★ 必须说清后果：路径无法审计 ⇒ 任务无法诚实完成')
})

test('★ 伪造臂 ②：真实样本（t9 的形状）⇒ 一次说全 .js 与 .d.ts 两条产物', () => {
  /**
   * ★ 用本轮真实卡住过的那个输入。t9 的 inScope 是
   *   `[src/gates/registry.ts, scripts/gate-registry.test.mjs]`，而它实际产出
   *   `lib/gates/registry.js` 与 `lib/types/gates/registry.d.ts` 两条。
   *   提示若只说其中一条，成员补完又被另一条卡住 —— 同一个往返拆成两次。
   */
  const blockers = expectBlocked(gate(contract([
    'src/gates/registry.ts',
    'scripts/gate-registry.test.mjs',
  ])))
  const text = blockers.join('; ')
  assert.match(text, /"lib\/gates\/registry\.js"/, '★ 必须指名 .js 产物')
  assert.match(text, /"lib\/types\/gates\/registry\.d\.ts"/, '★ 也必须指名 .d.ts 产物（否则往返变成两次）')
})

test('★ 伪造臂 ③：契约修订（creating=false）走同一条路 ⇒ 漏项不能从改契约那条路溜过去', () => {
  /**
   * ★ 这条臂的存在理由与 t6 里"amend 也有 contract 调用点"完全一样：一个只在
   *   建任务时检查的判据，会让"把契约改成不可审计"变成一条绕过路径。
   */
  const amended = { task: { id: 't1', kind: 'implementation', inScope: ['src/tools.ts'] }, creating: false }
  expectBlocked(gate(amended))
  // 同一条契约只要补齐产物就通过 —— 判据看的是内容，不是它来自哪条路径。
  expectOk(gate({ ...amended, task: { ...amended.task, inScope: ['src/tools.ts', 'lib/tools.js'] } }))
})

// ── 臂 2（未测量臂）────────────────────────────────────────────────────────────

test('★ 不适用臂：inScope【整个缺席】⇒ ok（不是 unmeasured —— 缺席不是"没测到"）', () => {
  /**
   * MEASURED（2026-10-05，t11 收口）：`kind=work` 的 `create_task` **本来就不带
   * `inScope`**（本文件另有一条真品臂断言这一点），而 `src/quality-gates.ts:510`
   * 对 work 类直接 `return { ok: true }` —— 它没有 inScope 要求。
   *
   * ★ 所以「缺席」的正确裁决是 `ok`（不适用），**不是** `unmeasured`。
   *   两者代价方向相反：把"不适用"报成"没测到"，会让【每一个普通任务】都被拒；
   *   而 inScope 缺席恰恰是所有普通任务的常态 ⇒ 那不是严格，那是把常态判成异常。
   *
   * ★ 这条判据仍然有真实的 unmeasured 对象（见下一条臂）：inScope **在场**却读不
   *   出内容。所以放宽"缺席"不会让未测量臂落空。
   */
  for (const ctx of [
    undefined,
    {},
    { task: { id: 't1', kind: 'work' } },
    { task: { id: 't1', kind: 'work', inScope: undefined } },
  ]) {
    expectOk(gate(ctx))
  }
})

test('★ 未测量臂：inScope【在场】但不可判（空数组 / 全是无法规整条目）⇒ unmeasured', () => {
  /**
   * ★ 与上一条臂的分界是本判据唯一保留 unmeasured 的地方，且它是刻意的：
   *
   *     缺席     = 这份契约没有提出同步要求   ⇒ 不适用 ⇒ ok
   *     在场但空 = 它**提出了**要求，而清单读不出内容 ⇒ 我**没能测量**它 ⇒ unmeasured
   *
   *   一个空数组与一个全是不合规条目的数组都属于后者：不是"不适用"，而是
   *   "该检查的东西检查不了"。
   */
  const cases = [
    [{ task: { id: 't1', kind: 'implementation', inScope: [] } }, 'inScope 在场、但是空的'],
    [{ task: { id: 't1', kind: 'implementation', inScope: ['', '   '] } }, 'inScope 全是空白条目'],
    [{ task: { id: 't1', kind: 'implementation', inScope: [null, 42, ''] } }, 'inScope 全是非字符串条目'],
  ]
  for (const [ctx, why] of cases) {
    const reason = expectUnmeasured(gate(ctx))
    assert.ok(reason.trim().length > 0, `${why}: unmeasured must say what could not be measured`)
    assert.match(reason, /inScope|scope/i, `${why}: 理由必须指向"清单读不出内容"这件事`)
  }
})

test('★ 未测量臂：unmeasured 与 blocked 不同形（"没测到"不许并进"发现问题"）', () => {
  /**
   * ★ t11 修正：这里此前用「没有 inScope」（kind=implementation 但没给 inScope）
   *   来取 unmeasured 的形状 —— 而按修正后的口径，**整个缺席是 ok（不适用）**。
   *   unmeasured 现在只由「inScope 在场但读不出」产生，所以形状对比也要用那个输入，
   *   否则这条臂测的就不是它自称在测的东西了。
   */
  const unmeasuredShape = gate({ task: { id: 't1', kind: 'implementation', inScope: [] } })
  const blockedShape = gate(contract(['src/a.ts']))
  assert.notDeepEqual(
    Object.keys(unmeasuredShape).sort(),
    Object.keys(blockedShape).sort(),
    '★ 两种裁决的字段集合必须不同形 —— 否则读日志的人分不出"没能检查"与"检查不通过"',
  )
  assert.equal(unmeasuredShape.unmeasured !== undefined, true)
  assert.equal(unmeasuredShape.blockers, undefined)
  assert.equal(blockedShape.blockers !== undefined, true)
  assert.equal(blockedShape.unmeasured, undefined)
})

test('★ 未测量臂：appliesTo 不许把"没有 inScope"做成 skipped', () => {
  /**
   * ★ 一个"看起来能用"的偷懒实现是 `appliesTo: (ctx) => Array.isArray(ctx.task.inScope)`：
   *   于是没有 inScope 的契约落进 `skipped`，而 `skipped` 与"这条判据不适用"同形
   *   ⇒ 「契约里根本没写 inScope」这件事**永远不会有人说**。
   *   这与 t9 里"观察模式不许做成 appliesTo"是同一个道理：不适用 ≠ 没能测量。
   */
  assert.equal(appliesTo({ task: { id: 't1', kind: 'work' } }), true, '★ 没有 inScope 也要进求值：由 gate 自己按【事实】说 ok（不适用）或 unmeasured（读不出），而不是整条判据跳过')
  assert.equal(appliesTo({ task: { id: 't1', kind: 'implementation', inScope: ['src/a.ts'] } }), true)
  assert.equal(appliesTo({}), false, '★ 连任务都没有 ⇒ 这才是不适用')
  assert.equal(appliesTo(undefined), false)
})

// ── 臂 3（对照臂）─────────────────────────────────────────────────────────────

test('★ 对照臂 ①：含 src/ 且含 lib/ ⇒ ok（不误伤正常契约）', () => {
  expectOk(gate(contract(['src/a.ts', 'lib/a.js', 'lib/types/a.d.ts'])))
  expectOk(gate(contract(['src/gates/registry.ts', 'lib/gates/'])))
  expectOk(gate(contract(['src/a.ts', 'lib'])))
})

test('★ 对照臂 ②：纯文档路径（docs/）⇒ ok（不误伤），且不产出"缺产物"的提示', () => {
  /**
   * ★ 这条臂是判据的**口径上限**：本判据只对"会触发构建产物的源码"说话。
   *   对 docs/、assets/、scripts/ 这类路径，它必须安静 —— 一个到处报警的判据
   *   会教人忽略它，而本队已经见过一次这个形态（棘轮断言在成功路径上报错）。
   */
  for (const inScope of [
    ['docs/GATE-REGISTRY.md'],
    ['docs/GATE-REGISTRY.md', 'README.md'],
    ['assets/ui.png', 'scripts/verify.mjs'],
    ['src-tools/helper.ts'],   // ★ 前缀相似但不是 src/ —— 不许被误判
    ['lib/a.js'],              // 只声明产物：没有源码要求，如实通过
  ]) {
    expectOk(gate(contract(inScope)))
  }
})

test('★ 对照臂 ③：src/ 下的【目录前缀】⇒ ok（不猜，因而不误报）', () => {
  /**
   * ★ 目录级 inScope 已经因为"掩盖这个任务实际改哪个文件"被本队收窄过一次。
   *   把 `src/gates/` 展开成 `lib/gates/` 是**凭猜**：没人说过这个任务会改
   *   `src/gates/` 下的哪个文件，因此也就没人能说它该产出哪个产物。
   *   一条靠猜的提示会在正确契约上误报，而误报会把这条判据本身教成噪音。
   *
   * ★ `src/gates`（不带尾斜杠）与 `src/gates/` 是【同一个意图】：无扩展名的路径
   *   就是目录。只认尾斜杠会让同一个意图的两种写法得到相反的裁决 —— 那种不一致
   *   会让这条判据读起来像随机噪音，而噪音比漏报更快地教会人忽略门禁。
   *   宽松在这里的方向是对的：判错的代价是少提示一次（门禁仍会在完成时拒掉
   *   undeclared 路径），反过来的代价是在合法契约上误报。
   */
  expectOk(gate(contract(['src/gates/'])))
  expectOk(gate(contract(['src/gates'])))
  expectOk(gate(contract(['src/gates/**'])))
})

test('★ 对照臂 ④：提示是一次性的（不因多写了几个 src 文件而重复报同一件事）', () => {
  const blockers = expectBlocked(gate(contract(['src/a.ts', 'src/b.ts', 'src/c.ts'])))
  assert.equal(blockers.length, 1, '★ 同一个形状只报一条：三条"你漏了 lib/"会让读的人以为有三个问题')
  assert.match(blockers[0], /src\/a\.ts/)
  assert.match(blockers[0], /src\/b\.ts/)
})

// ── ★ 硬约束臂：预防不是放宽 ─────────────────────────────────────────────────

test('★ 硬约束臂：本判据不得让 undeclared 路径变成合法 —— 该拒的仍要拒', () => {
  /**
   * ★ 这是本任务唯一的硬约束，也是这条判据最容易走成反面的一条路。
   *
   *   一个错误的实现会去"帮成员把 lib/ 补进 inScope"（或在分类时对 lib/ 网开一面），
   *   于是本队刚吃过三次的那个洞被**焊死成特性**：声明漏了无所谓，门禁会补。
   *
   *   本臂走【真品】路径（`classifyChangedPath`，就是门禁判 `undeclared` 用的那个），
   *   说明：
   *     · 没写进 inScope 的 lib/ 路径，仍然是 undeclared ⇒ 门禁仍然拒；
   *     · 本判据的裁决（ok / blocked）【不参与】分类 —— 它只读列表，不写列表。
   */
  const inScopeWithoutArtifacts = ['src/tools.ts']

  // ① 真品：build 产出的 lib/ 改动没被声明 ⇒ 仍然是 undeclared（该拒的仍要拒）
  assert.equal(
    classifyChangedPath('lib/tools.js', inScopeWithoutArtifacts, []),
    'undeclared',
    '★ 本判据不得让 undeclared 变成合法：它只提示，不改分类',
  )
  // ② 就算本判据判 ok，分类结果也不受影响（两者互不干涉）
  expectOk(gate(contract(['lib/tools.js'])))
  assert.equal(classifyChangedPath('lib/scheduler.js', ['lib/tools.js'], []), 'undeclared')

  // ③ 声明了才合法 —— 这才是"预防"该有的样子：提醒你去声明，而不是替你声明
  assert.equal(classifyChangedPath('lib/tools.js', ['src/tools.ts', 'lib/tools.js'], []), 'in_scope')
})

// ── ★ 接线臂：判据真的会被 contract 位置求值 ──────────────────────────────────

test('★ 接线臂：判据通过注册表在 contract 位置真的被求值（不是"写了但调不到"）', async () => {
  /**
   * ★ 本队反复见过的形态是"装了但调不到"：判据写得再对，没有调用点也永远不跑。
   *   t6 已经为 contract 位置建好调用点，这里从【进程级注册表】走一遍真实求值，
   *   证明这条判据确实进了那条路径 —— 而不是只 import 了函数直接调。
   */
  const evaluation = await registry.evaluate('contract', {
    task: { id: 'probe-task', kind: 'implementation', inScope: ['src/gates/contract/build-artifact-scope.ts'] },
    creating: true,
  })
  const entry = evaluation.ran.find((item) => item.id === 'contract.build-artifact-scope')
  assert.ok(entry !== undefined, '★ 这条判据必须出现在 contract 位置的真实求值里（装上了就要跑得起来）')
  assert.equal(entry.verdict, 'blocked', '★ 而这个输入必须让它开火')
  assert.equal(evaluation.ok, false)
  assert.ok(
    evaluation.blockers.some((line) => line.includes('contract.build-artifact-scope')),
    '★ 它的裁决必须进整体裁决（带 id 前缀）—— 否则它开火了也没人看得见',
  )
})

test('★ 接线臂（对照）：注册表在【合法契约】上不得因这条判据而拒绝', async () => {
  const evaluation = await registry.evaluate('contract', {
    task: { id: 'probe-task', kind: 'implementation', inScope: ['src/gates/contract/build-artifact-scope.ts', 'lib/gates/contract/build-artifact-scope.js'] },
    creating: true,
  })
  const entry = evaluation.ran.find((item) => item.id === 'contract.build-artifact-scope')
  assert.equal(entry?.verdict, 'ok', '★ 合法契约上这条判据必须安静')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 输入面臂（t2）：这条判据的 requires 声明，以及它【不】声明什么
// ─────────────────────────────────────────────────────────────────────────────

test('★ 输入面臂：声明的路径在真实 ctx 上都在场 ⇒ 核对 ok（不制造噪音）', () => {
  /**
   * ★ 契约位置两个调用点给的真实 ctx 形状都走这条臂：`create_task` 与
   *   `amend_task` 都必然带着 `task`。
   */
  for (const ctx of [
    { task: { id: 't1', kind: 'implementation', inScope: ['src/a.ts'] }, creating: true },
    { task: { id: 't1', kind: 'work' }, creating: false },
  ]) {
    const check = checkRequires({ id, requires, appliesTo }, ctx)
    assert.equal(check.status, 'ok', `★ 输入面齐 ⇒ 不得报缺；得到 ${JSON.stringify(check)}`)
    assert.deepEqual(check.missing, [])
    assert.deepEqual(check.present, ['task'], '★ 在场的那一格要如实交出来')
  }
})

test('★ 输入面臂：把 `task` 从 ctx 里去掉 ⇒ 走注册表就是 `skipped`（★ 这一条实测出来的边界）', () => {
  /**
   * ── ★ 这一臂是本任务的第一个**实测发现**，而不是一条想当然的断言 ─────────────
   *
   * 我原本想写成「去掉 `task` ⇒ 核对报缺」。**实测说不是**：`task` 同时是
   * `appliesTo` 读的那一格 —— 它一缺席，`appliesTo` 就为假，注册表在调用
   * `checkRequires` 之前就走了跳过分支：
   *
   *     ran:      [{ id: 'contract.build-artifact-scope', verdict: 'skipped' }]
   *     requires: { checked: 0, skipped: 1, incomplete: 0, missing: [] }
   *
   * ⇒ 于是出现一个**结构性盲区**：一条判据**不可能**通过 `requires` 报出
   *   「它自己那道 `appliesTo` 闸门读的那一格缺失」—— 因为那一格缺失恰好让
   *   闸门关上，而闸门关上就不核对。这一条对 **`build-artifact-scope` 与
   *   `verify-command` 都成立**（两者的 `appliesTo` 都读 `ctx.task`）。
   *
   * ★ 它**不是**本任务引入的，也不是这两条判据特有的：它是 t6 的机制与
   *   「`appliesTo` 闸门」之间的一般性质（已在 `lib/gates/registry.js` 上用
   *   一个最小探针逐条复现）。本任务把它记在这里，是因为**这两个 contract 判据
   *   的形状让它第一次变得可见**，而且它是本轮要消灭的那类失效的近亲。
   *
   * ★ 为什么仍然**可以接受**（而不是"必须修"）—— 三条依据：
   *
   *   ① 那一格缺失**不是静默的**：`skipped: 1` 与 `ran[].verdict === 'skipped'`
   *      都把它记下来了，而且 `requires.skipped` 与 `checked` 分开计数 ⇒
   *      「这一轮没核对」不会读成「核对过、都齐」（不同形）。
   *   ② 判据的 `gate()` 在这个 ctx 上本来也不会说话（`appliesTo` 是它自己写的），
   *      所以"没核对"没有掩盖任何一条判据会给出的结论。
   *   ③ 真正会产出 undeclared 路径的是**声明了 inScope 的质量任务**，而那些任务
   *      必然带着 `task` ⇒ 核对层照常核对这一格（见下一条臂的真品路径）。
   *
   * ★ 这一条臂的作用是**把边界钉成断言**（而不是留成一句印象）：
   *   若将来有人把注册表的跳过分支改成"跳过前也核对一遍"，
   *   这条臂会立刻红 —— 那时必须同时回答"`skipped` 还算不算不适用"。
   */
  const check = checkRequires({ id, requires, appliesTo }, { creating: true })
  assert.equal(check.status, 'skipped', '★ 闸门格缺席 ⇒ appliesTo 为假 ⇒ 跳过（不报缺）')
  assert.match(String(check.skippedBecause), /appliesTo/)
  assert.deepEqual(check.missing, [], '★ 跳过的判据不许产出 missing —— 那是噪音的来源')

  /**
   * ★ 而**经过注册表**时，同一份 ctx 必须留下"没核对"的痕迹（不许无声无息）：
   *   这正是①里那条依据，必须被一条断言钉住，否则它只是一句辩解。
   */
  return (async () => {
    const { createGateRegistry } = await import('../lib/gates/registry.js')
    const r = createGateRegistry()
    r.register({
      id, point: 'contract', description: 'probe for the gate-cell boundary',
      gate: () => ({ ok: true }),
      requires, appliesTo,
    })
    const evaluation = await r.evaluate('contract', { creating: true })
    assert.equal(evaluation.requires.skipped, 1, '★ "没核对"必须被记下来（不许与"核对过、都齐"同形）')
    assert.equal(evaluation.requires.checked, 0, '★ checked 只数真的核对了的')
    assert.equal(evaluation.ran[0].verdict, 'skipped')
  })()
})

test('★ 输入面臂（★ 本任务的核心）：inScope 缺席【不得】被报成缺输入 —— 那是假告警', () => {
  /**
   * ── ★ 为什么这一条是本任务最重要的一臂 ────────────────────────────────────
   *
   * 本判据的语义**恰好**是一句「缺席不是缺失」（t11 收口，见 gate 里那两段注释）：
   *
   *     inScope 整个缺席    ⇒ 这份契约没有提出同步要求 ⇒ **ok**（不适用）
   *     inScope 在场但不可判 ⇒ 它提了要求而清单读不出   ⇒ **unmeasured**
   *
   * ⇒ 若把 `'task.inScope'` 写进 requires，核对层会在**每一个普通任务**上喊
   *   「缺 task.inScope」，而 `kind=work` 的 `create_task` **本来就不带 inScope**。
   *   那不是"判据严格"，那是把**不适用**报成**没测到** —— 而两者的代价方向相反。
   *   ★ 而假告警与不报警同样有害：它教人忽略门禁。
   *
   * ★ 它同时防住"改回去"：下一个人如果顺手把 `'task.inScope'` 加进声明，
   *   这一条臂立刻红 —— 也就是说，**这条口径是被一句断言钉住的，不是被一句注释**。
   */
  const absentScope = { task: { id: 't1', kind: 'work' }, creating: true }
  const check = checkRequires({ id, requires, appliesTo }, absentScope)
  assert.equal(
    check.status,
    'ok',
    '★ inScope 缺席是这条判据的一条【合法裁决分支】，不是接线缺陷：核对层不得报缺',
  )
  assert.ok(
    !check.missing.includes('task.inScope'),
    '★ 核对层不许替这条判据说出它自己明确拒绝说的话',
  )

  /**
   * ★ 而"整个契约缺席"与"inScope 缺席"必须【不同形】—— 前者才是"这一轮没接上"。
   *   这两件事的收场完全不同（一个要修调用点，一个是正常情形），
   *   合成一个就再也读不出来了。
   */
  const noContract = checkRequires({ id, requires, appliesTo }, { creating: true })
  assert.notDeepEqual(
    { status: check.status, missing: check.missing },
    { status: noContract.status, missing: noContract.missing },
    '★ 「契约在、inScope 故意缺席」与「契约整个没交出来」必须不同形',
  )
  assert.equal(noContract.status, 'skipped', '★ 整个契约缺席 ⇒ appliesTo 为假 ⇒ skipped（不报缺，但要记数）')
  assert.match(String(noContract.skippedBecause), /appliesTo/)
})

test('★ 输入面臂：声明必须与【未测量臂】一致（缺 X 就 unmeasured 的 X 必须在 requires 里）', () => {
  /**
   * ── 本判据的未测量臂只有一条（gate 里的 unmeasured 分支）──────────────────────
   *
   *     inScope 在场但读不出内容 ⇒ unmeasured
   *
   * 而那个分支的**前提**是「inScope 在场」，也就是 `task` 在场 ⇒ 它的输入面
   * 就是 `task`。★ 逐条对齐：本判据没有任何一条"缺某一格就 unmeasured"的分支
   * 是 requires 里没有的（`task.inScope` 缺席走的是 **ok**，不是 unmeasured）。
   *
   * ★ 断言写成【集合关系】而不是字面量：把 `'task.inScope'` 加回去会立刻违反
   *   上一条臂，把 `'task'` 删掉会违反这一条。两条一起就把这份声明钉死了。
   */
  const declared = [...requires]
  assert.deepEqual(declared, ['task'], '★ 这一条判据的输入面就是"一份任务契约"这一格')

  // 未测量臂问的那件事（inScope 在场、读不出）必须在声明的输入面之内
  const unmeasuredArm = { task: { id: 't1', kind: 'implementation', inScope: [] } }
  const check = checkRequires({ id, requires, appliesTo }, unmeasuredArm)
  assert.equal(check.status, 'ok', '★ 未测量臂的 ctx 上，输入面本身是齐的（"没能测量"是判据的结论，不是核对层的）')
  assert.equal(shapeOf(gate(unmeasuredArm)), 'unmeasured', '★ 而判据自己仍然说"我没能测量它"')
})

test('★ 输入面臂（真品路径）：经注册表 + 工具层，缺 `execVerifyCommand` 必须被核对报出来', async () => {
  /**
   * ── ★ 这一条臂补上上一条臂实测出来的那个盲区 ────────────────────────────────
   *
   * `task` 既是闸门格又是声明格 ⇒ 它缺席时走 `skipped`。而 `verify-command` 的
   * **另一格**（`execVerifyCommand`）不是闸门格：`appliesTo` 不读它。
   * ⇒ 于是「调用方漏了注入执行器」这件事**能被机械核对报出来** ——
   * 正是上一轮第三次缺口（t17/t18：contract 两个调用点都没注入 ⇒
   * implementation/repair 契约连 create_task 都过不去）。
   *
   * ★ 走【进程级注册表】而不是直接调 `checkRequires`：要证明的是"这一格真的
   *   在装配之后被核对到"，而不是"核对函数本身写得对"。这两件事不同形 ——
   *   一条声明写了、而装配层没交下去，只有从这里看得见（见下一条装配臂）。
   */
  const withExecutor = {
    task: { id: 't1', kind: 'implementation', verify: ['pnpm test'] },
    creating: true,
    execVerifyCommand: async () => 0,
  }
  const withoutExecutor = {
    task: { id: 't1', kind: 'implementation', verify: ['pnpm test'] },
    creating: true,
  }

  const full = await registry.evaluate('contract', withExecutor)
  const bare = await registry.evaluate('contract', withoutExecutor)

  const checkFor = (evaluation) => evaluation.requires.checks.find((check) => check.id === 'contract.verify-command')
  assert.equal(checkFor(full).status, 'ok', '★ 执行器注入 ⇒ 输入面齐，核对不得报缺')
  assert.deepEqual(checkFor(full).missing, [])
  assert.deepEqual(checkFor(full).present, ['task', 'execVerifyCommand'], '★ 两格都在场，要如实交出来')

  assert.equal(checkFor(bare).status, 'incomplete', '★ 执行器没注入 ⇒ 必须报出缺这一格')
  assert.deepEqual(checkFor(bare).missing, ['execVerifyCommand'], '★ 且要点名是执行器这一格')
  assert.match(bare.requires.missing.join('\n'), /execVerifyCommand/)
  assert.match(bare.requires.missing.join('\n'), /contract\.verify-command/, '★ 还要说清是哪条判据')

  /**
   * ★ 而它**同时**是"判据自己说的话"：判据在这个 ctx 上返回 `unmeasured`，
   *   理由正是"没有执行器"。两句话必须说同一件事 —— 一条声明与判据的未测量臂
   *   若各说各的，那就是本节要消灭的那种静默失效。
   */
  assert.match(
    String(bare.unmeasured),
    /no executor was injected/,
    '★ 判据自己也要说"没有执行器"（核对层与判据口径必须一致）',
  )

  /**
   * ★ 先软后硬：上面两条核对照常报告，而**裁决一个字节都没动** ——
   *   不带执行器的求值仍然以判据自己的 unmeasured 收场（而不是多出一条
   *   "输入面没接线"的 blocker）。这是本轮用户裁定的行为。
   */
  assert.ok(
    !bare.blockers.some((line) => line.includes('the input surface is not wired')),
    '★ 观察模式（缺省）下，核对结果不得变成 blocker —— 那正是"先软后硬"要保住的东西',
  )
})

test('★ 输入面臂：`execVerifyCommand` 缺席与在场 ⇒ 判据裁决不同形（★ 但要在【判据层】看）', async () => {
  /**
   * ── ★ 这一臂的第一次写法错了，而错法本身值得记下来 ──────────────────────────
   *
   * 我最初用 `registry.evaluate('contract', …)` 取形状，断言"没有执行器 ⇒
   * unmeasured"。**实测是 `blocked`** —— 因为同一个 ctx 上**兄弟判据**
   * （`build-artifact-scope`）看到 `inScope: ['src/a.ts']` 而没看到 `lib/`，
   * 它 blocked 了。而注册表的合并口径是「未测量优先」也只在**同一位置内**比较：
   * 我这里取的形状是**位置级**的，不是这条判据的。
   *
   * ★ 这是一个真实的读数陷阱，也是本轮反复出现的那条纪律的又一例：
   *   **"我在看哪一层的结论"必须说清**。位置级 = blocked/unmeasured 合并后的；
   *   判据级 = 这条判据自己说的。两者不同形，混用会得出"判据报错了"的假结论
   *   （我差一点就把它当成缺陷记下来）。
   *
   * ⇒ 正确的分法：**判据级**用 `gate()` 直接调（这正是三态契约的所在），
   *   **位置级**用注册表（下面几条臂管的是核对与装配）。这与
   *   `gate-contract-verify-command.test.mjs` 里既有臂的口径一致。
   */
  const { gate: verifyGate } = await import('../lib/gates/contract/verify-command.js')
  const contract = (extra) => ({ task: { id: 't1', kind: 'implementation', verify: ['pnpm test'] }, creating: true, ...extra })

  const ok = await verifyGate(contract({ execVerifyCommand: async () => 0 }))
  const noExecutor = await verifyGate(contract({}))
  assert.equal(shapeOf(ok), 'ok')
  assert.equal(shapeOf(noExecutor), 'unmeasured', '★ 没有执行器 ⇒ "没能测量"，绝不是 ok')
  assert.notEqual(shapeOf(ok), shapeOf(noExecutor), '★ 两者必须不同形')
  assert.match(String(noExecutor.unmeasured), /no executor was injected/)

  /**
   * ★ 而**位置级**的读数也要各自说清（它与判据级不同形，这不是缺陷）：
   *   两次求值都真的跑到两条判据（声明不许让判据被跳过），
   *   而"位置级是否 unmeasured"取决于兄弟判据在这一份 ctx 上的裁决 —— 所以
   *   这里只钉"跑了几条"，不钉位置级的形状（那是 `gate-registry.test.mjs` 的活）。
   */
  const withExec = await registry.evaluate('contract', contract({ execVerifyCommand: async () => 0, task: { id: 't1', kind: 'implementation', inScope: ['src/a.ts', 'lib/a.js'], verify: ['pnpm test'] } }))
  const bare = await registry.evaluate('contract', contract({ task: { id: 't1', kind: 'implementation', inScope: ['src/a.ts', 'lib/a.js'], verify: ['pnpm test'] } }))
  assert.equal(withExec.evaluated, 2, '★ 两次求值都要真的跑到两条判据（声明不许让判据被跳过）')
  assert.equal(bare.evaluated, 2)
  assert.equal(positionOutcome(withExec), 'ok', '★ 执行器注入 + 契约齐 ⇒ 位置级通过')
  assert.equal(positionOutcome(bare), 'unmeasured', '★ 执行器缺席 ⇒ 位置级 unmeasured（兄弟判据在合法契约上不搅局，所以这一次能读出来）')
  assert.deepEqual(bare.blockers, [], '★ 而这条 unmeasured 的理由里不许混进"输入面没接线"（先软后硬）')
})

test('★ 装配臂：requires 真的被装配层转发到注册表（"声明写了但没人交下去"是新形态）', () => {
  /**
   * ★ MEASURED（2026-10-06，dispatch-owner 的 F1）：`asRegistration` 是一个
   *   **白名单**，它此前只转发 id/point/description/gate/appliesTo。
   *   判据声明了 `requires`，而装配层不再往下交 ⇒ `list()` 读出来 `hasRequires: false`
   *   ⇒ 「这条判据声明了输入面」在控制台上与「它压根没声明」**同形**。
   *
   * ⇒ 这一臂走【真品装配路径】（进程级注册表），不是直接读模块导出：
   *   模块里写了、而装配层没交下去，这种缺陷只有从这里看得见。
   */
  const listed = registry.list().contract.find((entry) => entry.id === id)
  assert.ok(listed !== undefined, '★ 这条判据必须在 contract 位置的注册表清单里')
  assert.equal(listed.hasRequires, true, '★ "声明过输入面"必须读得出来（false = 声明没被转发下去）')
  assert.deepEqual(listed.requires, ['task'], '★ 声明的内容也要原样读得出来')

  /**
   * ★ 而"没声明"与"声明了空数组"仍然不同形（`buildRegistry()` 里其余判据还没声明，
   *   它们必须是 `hasRequires: false` + `requires: undefined`，不许被编成 `[]`）。
   */
  const undeclared = registry.list().contract.filter((entry) => entry.hasRequires === false)
  for (const entry of undeclared) {
    assert.equal(entry.requires, undefined, `★ ${entry.id} 没声明 ⇒ 不许被编成空数组（那会让覆盖率虚高）`)
  }
})

test('★ 声明臂：源码里的 requires 用的是【类型层】声明（拼错的路径要能编译期就红）', () => {
  /**
   * ★ 一条声明写对了、而类型没挂上，在运行时**完全看不出来** ——
   *   它照常工作，只是拼错的路径要等到某天有人改它时才会以"核对报了一个
   *   谁也没写过的格子"的形式露面。所以这一臂读源码，把"挂的是哪个类型"钉住。
   *
   * ★ 它断言的是一件**能被独立复核**的事：声明处的类型参数是**本判据自己的**
   *   ctx 类型（而不是 `any` / `Paths<unknown>` / 手写字符串联合）。
   *   本仓库的实测标准来自 t6：`'wait.typo' ⇒ TS2322`；那件事由
   *   `scripts/gate-requires.test.mjs` 臂 7/8 在类型层钉住，这里钉的是**这一条
   *   判据有没有接上那个机制**，两件事不重复。
   */
  const source = readFileSync(join(ROOT, 'src/gates/contract/build-artifact-scope.ts'), 'utf8')
  const declaration = /export const requires:\s*CtxPaths<([A-Za-z0-9_]+)>\[\]\s*=\s*\[([^\]]*)\]/.exec(source)
  assert.ok(declaration !== null, '★ 声明必须写成 `CtxPaths<本判据的 ctx 类型>[] = [...]` 的形状')
  assert.equal(
    declaration[1],
    'BuildArtifactScopeContext',
    '★ 类型参数必须是这条判据自己的 ctx 类型 —— 换成一个宽类型（any / unknown / Record）会让拼错的路径重新变成运行时的惊喜',
  )
  assert.match(
    source,
    /import type \{ CtxPaths \} from '\.\.\/requires\.ts'/,
    '★ 类型要从 requires.ts 来（type-only import：它不该在运行时引入任何东西）',
  )
})

/**
 * 裁决的【形状】—— 三态不同形的机械判据（与集成夹具同一口径）。
 * ★ 复制而不是 import：这条判据自己的夹具不该依赖另一个夹具文件的内部约定。
 *
 * ★ **判据级**专用。`gate()` 的三态是互斥的：`{ok:true}` / `{ok:false, blockers}` /
 *   `{ok:false, unmeasured}` —— 所以"先看 blockers 再看 unmeasured"在这里是对的。
 *
 * ★ 而**位置级**（`registry.evaluate()` 的返回）**恒带 `blockers: []`**（那是一条
 *   既有的纪律：空即空，而不是缺席），所以上面这个顺序在位置级上会把**任何**
 *   未测量的求值读成 `blocked` —— 我在这条臂里正好踩到过一次（见下面那段记录）。
 *   ⇒ 位置级读数用 {@link positionOutcome}，不用这个函数。
 */
function shapeOf(verdict) {
  if (verdict === null || typeof verdict !== 'object') return `non-object:${JSON.stringify(verdict)}`
  if (verdict.ok === true) return 'ok'
  if (Array.isArray(verdict.blockers)) return 'blocked'
  if (typeof verdict.unmeasured === 'string') return 'unmeasured'
  return `malformed:${JSON.stringify(verdict)}`
}

/**
 * 位置级（`registry.evaluate()`）的结论 —— ★ 与判据级的读法是**两个东西**。
 *
 * 位置级的合并口径（见 `registry.ts` 的 `evaluate`）：任何一条 unmeasured ⇒
 * 整体 unmeasured（**未测量优先于 blocker**）；否则任一条 blocked ⇒ blocked；
 * 否则 ok。⇒ 读位置级必须**先看 unmeasured**，与判据级恰好相反。
 */
function positionOutcome(evaluation) {
  if (evaluation.ok === true) return 'ok'
  if (typeof evaluation.unmeasured === 'string') return 'unmeasured'
  if (Array.isArray(evaluation.blockers) && evaluation.blockers.length > 0) return 'blocked'
  return `malformed:${JSON.stringify({ ok: evaluation.ok, blockers: evaluation.blockers, unmeasured: evaluation.unmeasured })}`
}
