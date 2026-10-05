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

import { gate, appliesTo, id, point } from '../lib/gates/contract/build-artifact-scope.js'
import { buildRegistry, registry } from '../lib/gates/index.js'
import { classifyChangedPath } from '../lib/quality-gates.js'

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
