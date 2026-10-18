/**
 * ── 「成团之前」这个【位置】的三臂夹具（t5）─────────────────────────────────────
 *
 * 被测的不是一条判据的语义（那在 `<id>.test.mjs` 里），也不是装配点的校验
 * （那在 `gate-index-assembly.test.mjs` 里），而是**一个新位置本身**：
 *
 *     ① 它真的被编排层认识吗（能被 `evaluate` 到，不是一个只在数组里躺着的字符串）；
 *     ② 一条判据都没有时它会不会误伤（空位置必须放行）；
 *     ③ 它与既有的 `contract` 位置**互不影响**（两类缺陷不许同形）。
 *
 * ── ★ 它防的是什么失效（本任务存在的理由）──────────────────────────────────────
 *
 * 本轮要做的三件事（检查点触发 / 吸收痕迹 / 成团闸门）**全部发生在成团之前**，
 * 而注册表原有的五个位置全部在成团【之后】。零覆盖的那一段里，最自然的偷懒是
 * 把这些判据塞进 `contract` —— 那是错的：
 *
 *     `contract`  判的是：这个契约合不合法（inScope 声明 / verify 可判性）
 *     `admission` 判的是：这份需求 / 计划够不够格进场（有产物 / 审过了 / 无待确认问题）
 *
 * ⇒ 合成一个位置，会让"契约写错了"与"根本不该进场"在日志里同形，而两者的补救
 *   动作完全不同（改契约 vs 回去接着聊）。本文件第 3 节把这条**当作可执行断言**：
 *   两个位置各有各的判据、各开各的火、谁也管不着谁。
 *
 * ── ★★ 本文件**刻意不写**的一句话（本队已因这类棘轮返工多次）──────────────────
 *
 * `admission` 现在一条判据都没有 —— 但那**不是不变量**，它是"t5 只加位置"这个
 * 当前状态的快照。t6/t7/t8 会往里挂判据（检查点 / 吸收 / 成团闸门），
 * 而一条把「它现在为空」写成断言的夹具，会在队友接上第一条判据的那一刻按设计变红
 * —— 那时红的原因与"位置没接好"毫无关系，于是下一个人只能来删断言（棘轮）。
 *
 * ⇒ 本文件断言的一律是**机制的形状**：
 *     · 位置存在、能被求值（接了就该被跑到）；
 *     · 空注册表在**任何**位置上都放行（用**新建的空实例**表达，与哪个位置当前
 *       接了什么都不相干）；
 *     · 两个位置互不影响（各挂各的探针，各读各的裁决）。
 *
 * ── 三臂 ─────────────────────────────────────────────────────────────────────
 *
 *   臂 1（对照臂）：`admission` 上挂一条 ok 的判据 ⇒ 它**真的被跑到**（`ran` 里
 *                   有它、`evaluated: 1`）。缺了它，下面两臂在"位置压根调不到"时
 *                   照样是绿的。
 *   臂 2（反向臂）：一条判据都不挂 ⇒ 放行，且与"挂了但全跳过"**不同形**
 *                   （`registered` / `skippedAll` 分得开）。
 *   臂 3（隔离臂）：`admission` 与 `contract` 各挂一条 blocked 探针 ⇒ 每个位置只
 *                   被自己那条影响；一次 `contract` 求值不碰 `admission`，反之亦然。
 *
 * ── ★ 定向突变（打红它的是哪一次改动）──────────────────────────────────────────
 *
 *   ① 把 `'admission'` 从 `src/gates/registry.ts` 的 `INSERTION_POINTS` 里拿掉 ⇒
 *      `register({point: 'admission'})` 当场抛 `unknown insertion point` ⇒ 三条臂
 *      全部红（声明即证据：位置是**注册表**认识的，不是钳进夹具里的一个字符串）。
 *   ② 把 `evaluate('admission', …)` 的**分派**改成忽略这个位置（例如按旧的五个
 *      位置白名单过滤）⇒ 臂 1 红（探针没被跑到），而臂 2 仍然绿 —— 这正是
 *      "空位置放行"与"位置可达"必须分成两条臂的理由：合成一条的话，
 *      "压根调不到"会伪装成"空位置照常放行"。
 *   ③ 把两个位置的求值互相串起来（例如 `evaluate('contract')` 顺带跑 admission）
 *      ⇒ 臂 3 红。
 *
 * ★ 与 `gate-position-wiring.test.mjs` 的分工：那一份测的是**真实调用点**（走工具
 *   入口，证明编排层真的会在这个位置求值）；本文件测的是**位置自身**的形状。
 *   两者都必须存在 —— 一个没有调用点的位置，在注册表这一层照样完全正常。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registry, buildRegistry } from '../lib/gates/index.js'
import { createGateRegistry, INSERTION_POINTS, ok, blocked } from '../lib/gates/registry.js'

/**
 * ── ★★ 下半场：接线普查的夹具臂（t4）─────────────────────────────────────────────
 *
 * 本文件上半场三臂测的是**位置自身**的形状（能被求值到 / 空位置放行 / 互不影响）。
 * 从第 4 臂起，同一个 `admission` 位置被换到**另一个问题**上看：
 *
 *     它到底有没有被**任何** `src/` 代码求值？
 *
 * ★ 为什么要合进这一个文件而不是新开一份：两条验收指向的其实是同一个位置的
 *   两半 —— "位置在注册表里是好的"（上半场）与"位置在流程里**真的被调用**"
 *   （下半场）。分成两个文件，第一半绿、第二半红时，读日志的人要先猜该看哪一份。
 *
 * ★★ 而它们**不是**同一件事（这是本组臂存在的理由）：
 *   一个位置可以在 `INSERTION_POINTS` 里、`buildRegistry().list()` 里有它的键、
 *   `evaluate('admission', {})` 也能跑 —— 而**全仓没有一个调用点**。
 *   那时"它永远不会跑"与"它跑了且通过了"在日志里**同形**。
 */
const CENSUS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CENSUS_SCRIPT = join(CENSUS_ROOT, 'scripts', 'gate-wiring-census.mjs')

/** 位置的名字本身就是本任务的一条验收：判的是**准入**，不是契约合法性。 */
const POINT = 'admission'

/**
 * 一个装了指定判据的**新建**注册表。
 *
 * ★ 不碰进程级单例：单例是**别的用例正在用**的那一份清单（`gate-position-wiring`
 *   会往它上面挂探针）。往它上面挂一条"admission 探针"会让同进程的普查夹具
 *   （「11 条判据」那一类）凭空多一条，而它红起来的样子与"这里缺陷"毫无关系。
 */
function withGates(entries) {
  const r = createGateRegistry()
  for (const entry of entries) r.register(entry)
  return r
}

/** 一条探针判据（每条只对**自己那个位置**的求值说话）。 */
function probe(id, point, verdict) {
  return { id, point, description: `probe for ${point}`, gate: () => verdict }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（对照臂）：这个位置真的能被 evaluate 到
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 对照臂：admission 能被 evaluate 到 —— 挂一条判据，它就真的跑', async () => {
  /**
   * ★ 缺了这一臂，下面两臂在"位置压根调不到"时会全绿：一个 `evaluate` 认不出
   *   `admission` 的实现，同样不会报错、同样不会误伤空位置。
   */
  assert.ok(
    INSERTION_POINTS.includes(POINT),
    `★ 注册表必须在 INSERTION_POINTS 里认识 "${POINT}" —— 定向突变：把它从那个数组里拿掉，本条与下面每一条都红`,
  )

  const r = withGates([
    probe('admission.probe.ran', POINT, ok()),
    /** ★ 同一次求值里还有一条会开火的：把"跑到了"与"跑通了"分开看。 */
    probe('admission.probe.fired', POINT, blocked('this requirement has not been reviewed yet')),
  ])
  const evaluation = await r.evaluate(POINT, {})

  const entry = evaluation.ran.find((item) => item.id === 'admission.probe.ran')
  assert.ok(
    entry !== undefined,
    `★ "${POINT}" 上注册的判据没有出现在 run["${POINT}"] 的 ran 里 —— 它被注册到了一个不会跑的位置，`
    + `而"位置不存在"与"位置存在但一条都没跑"在返回值里必须不同形。实际 ran：${JSON.stringify(evaluation.ran)}`,
  )
  assert.equal(entry.verdict, 'ok')
  assert.equal(evaluation.registered, 2, '★ 这个位置上挂了两条，就得如实数到两条')
  assert.equal(evaluation.evaluated, 2, '★ 两条都真的跑了（不是 skipped）')
  assert.equal(evaluation.ok, false, '★ 其中一条开火了 ⇒ 这个位置的裁决是被拒的')
  assert.deepEqual(
    evaluation.blockers,
    ['[admission.probe.fired] this requirement has not been reviewed yet'],
    '★ 判据的原话必须带着它自己的 id 出现在 blocker 里 —— 否则读日志的人不知道是谁说的话',
  )

  /**
   * ★ 位置还会**穿过装配层**：`buildRegistry()` 交出的单例必须也认识它
   *   （`list()` 的键是从 `INSERTION_POINTS` 派生的，所以它必须出现在键里）。
   *   一个只在 `registry.ts` 里加、而装配层读不到的读法，会让控制台少一整行。
   */
  const built = buildRegistry()
  assert.ok(
    Object.keys(built.list()).includes(POINT),
    `★ 装配点交出的清单里必须有 "${POINT}" 这一格（空位置也是）—— 否则控制台看不出这个位置还没接判据`,
  )
  /**
   * ── ★★★ t85：这一格从「断言为空」改成「断言**正好**是那三条」──────────────────────
   *
   * ★ **它原来是什么**（`t5` 落的那一版）：
   * ```js
   * assert.deepEqual(built.list()[POINT], [],
   *   '★ 本任务只加位置、不加判据：真实清单里 admission 位置这一轮不该有任何判据'
   *   + '（★ 这一条是【当下快照】，t6/t7/t8 接上第一条判据时应当删掉它，而不是让它在队友那里红）')
   * ```
   * ★ **改前它防的是什么**：它防的是「`t5` **顺手**往 admission 挂了判据」——
   *   `t5` 的任务范围**只有"加位置"**，一条判据都不该加。而"这一轮不该有"
   *   是一个**当下快照**，不是不变量 —— 它自己的报文就写明了这一点。
   *
   * ★ **为什么现在要改**：`t85` **就是那句"t6/t7/t8 接上第一条判据"** 所指的那一步。
   *   ⇒ 到了这一刻，`built.list().admission` **按设计**不再是 `[]`。
   *   ★ 而它**不是"坏了"**：`index.ts` 顶部两段注释**逐字预告了**今天
   *     （「接上第一条判据的那一刻它就会**按设计变红**，而不是发现有东西坏了」）。
   *
   * ★★ **这不是放宽 —— 是收紧**：原来只断言"是空的"（对**内容**毫无约束）。
   *   现在断言**正好是那三个 id**（顺序固定）⇒ 它现在还能回答
   *   "**接上的是不是那三条**"与"**有没有人顺手多挂一条**"，
   *   而这两件事**旧版本都答不出来**（空数组对内容零信息）。
   *   ★ 而"空位置"这一格**并没有消失**：`admission` 位置上"没有判据"的语义
   *     由**臂 2**（用一个真的新建空实例）继续守着 —— 那才是它的正确归宿。
   */
  assert.deepEqual(
    built.list()[POINT].map((entry) => entry.id),
    ['admission.absorb', 'admission.checkpoint', 'admission.convene'],
    '★★ t85 已接：`admission` 位置上**正好**是那三条判据（按 `ALL_GATES` 的书写顺序）。'
    + '★ 接一条就多一条的写法见这里原来的报文；而"空位置"的语义由臂 2 守。'
    + '★ 若这里多出第四条，说明有人**绕过 `ALL_GATES` 的清单**挂了判据 —— 那正是本条要抓的。',
  )
  void registry
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（反向臂）：空位置不报错 —— 而且它不许与"挂了但全跳过"同形
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 反向臂：admission 一条判据都没有 ⇒ 放行，且与「有判据却全跳过」不同形', async () => {
  /**
   * ★ 空位置的语义要用**一个真的新建的空实例**表达，而不是 `registry.count(POINT) === 0`
   *   —— 后者会把"这个位置此刻恰好为空"写成不变量（见文件头那段）。
   *   空实例与"哪个位置当前接了什么"完全无关，所以它永远测的是同一件事。
   */
  const empty = createGateRegistry()
  const verdict = await empty.evaluate(POINT, {})
  assert.equal(verdict.ok, true, `★ 空位置必须放行 —— 把"这里还没接判据"判成拒绝是误伤，会卡死流程`)
  assert.deepEqual(verdict.ran, [], '★ 空位置：一条都没跑（不是"跑了一条什么都对的判据"）')
  assert.equal(verdict.registered, 0)
  assert.equal(verdict.evaluated, 0)
  assert.equal(verdict.skipped, 0)
  assert.equal(
    verdict.skippedAll, undefined,
    '★ 空位置【不得】产出"这一步没被检查"的说明 —— 那是"有判据却全跳过"的形态，两者混起来，'
    + '一次静默全跳过会伪装成"这个位置本来就没判据"',
  )

  /** 对照：同一个位置、**有**判据但全被跳过 —— 两者必须不同形。 */
  const allSkipped = withGates([
    { ...probe('admission.probe.skipped', POINT, blocked('would have fired')), appliesTo: () => false },
  ])
  const skipped = await allSkipped.evaluate(POINT, {})
  /**
   * ── ★★★ t69：这一条断言的是【t58 之前】的口径，而 t58 有意改掉了它 ─────────────
   *
   * 原文（本行此前）：`assert.equal(skipped.ok, true, '★ 全跳过同样不翻成 ok:false…')`
   *
   * MEASURED：t58 把「有判据却一条没跑」从 `ok:true` 改成 **`ok:false`**，
   * 理由写在 `registry.ts` 那一支的注释里（逐字）：
   *
   *     ok:false · blockers:[] · unmeasured:undefined · skippedAll:在场  ← 这一步没被检查
   *     ok:false · blockers:[…]                          · skippedAll:缺席  ← 判据说有问题
   *     ok:false · unmeasured:在场                        · skippedAll:缺席  ← 判据说测不了
   *
   * ⇒ ★ 也就是："**这一步没被检查**"不许与"检查了、通过了"同形 ——
   *   而那正是本队那条最贵的纪律（不把没测到并进通过）。
   *
   * ★★ 所以本行是**夹具过期**（口径被有意改了，而臂没跟上），不是真实缺陷：
   *   它断言的是旧决定，而旧决定被推翻时留下了它。⇒ 修法是**改夹具**，
   *   **不是**把 `registry.ts` 改回去（那是 out-of-scope，且会把一条正确的口径弄坏）。
   *   ★ 而"哪一个是对的"有据可查：`registry.ts` 那一支带着完整的论证与三态表，
   *     而这一行只有一句"那是正常情形"—— 前者是决定，后者是被推翻的默认。
   *
   * ★ 而**空位置**那一半（`verdict.ok === true`）**一个字没动**（见上面第 159 行）：
   *   空位置仍是放行 —— 两者仍然不同形，而**差别现在同时体现在 `ok` 与 `skippedAll` 上**。
   */
  assert.equal(skipped.ok, false, '★ t58 之后：全跳过 ⇒ ok:false（"没被检查"不许读成"通过"）')
  assert.equal(skipped.unmeasured, undefined, '★ 而它不是"没能测量" —— 第三种形态，两者不许同形')
  assert.deepEqual(skipped.blockers, [], '★ 也不是"判据说有问题"')
  assert.equal(skipped.registered, 1)
  assert.equal(skipped.evaluated, 0)
  assert.equal(typeof skipped.skippedAll, 'string', '★ 有判据却一条没跑 ⇒ 必须留下那句话')
  assert.notDeepEqual(
    { registered: verdict.registered, skippedAll: verdict.skippedAll },
    { registered: skipped.registered, skippedAll: skipped.skippedAll },
    '★ "这里还没有判据"与"有判据却一条没跑"必须不同形 —— 合成一条断言，位置一旦接上判据就会静默地改变读法',
  )

  /**
   * ★ 同一件事在**每一个**位置上都成立（不是给 admission 开的特例）：
   *   定向突变 = 在 `evaluate` 里给新位置开一条"永远返回失败"的分支 ⇒ 本条红。
   */
  for (const point of INSERTION_POINTS) {
    const perPoint = await createGateRegistry().evaluate(point, {})
    assert.equal(perPoint.ok, true, `★ 空注册表在 "${point}" 必须放行`)
    assert.deepEqual(perPoint.ran, [])
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（隔离臂）：admission 与 contract 互不影响
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 隔离臂：admission 与 contract 各开各的火 —— 两个位置不许互相影响', async () => {
  /**
   * ── 这一臂测的是本任务验收里的那一句：「两类缺陷不许同形」────────────────────
   *
   * `contract` 判契约合不合法，`admission` 判够不够格进场。判据挂在位置上
   * （契约 §1），所以"两个位置互不影响"是**位置机制**的性质，不是某条判据的语义。
   * 把这条性质写成可执行断言，是因为它最容易被一次"顺手复用"改坏 ——
   * 例如让 `evaluate('contract', …)` 连带跑一遍前缀位置。
   */
  const r = withGates([
    probe('admission.gate', POINT, blocked('the plan has an unreviewed revision')),
    probe('contract.gate', 'contract', blocked('inScope names a path the task may not touch')),
  ])

  const atAdmission = await r.evaluate(POINT, {})
  assert.deepEqual(
    atAdmission.blockers,
    ['[admission.gate] the plan has an unreviewed revision'],
    '★ admission 的求值只许听见 admission 的判据 —— contract 的话跑到这里，就等于"契约不合法"被读成了"不准进场"',
  )
  assert.deepEqual(
    atAdmission.ran.map((item) => item.id),
    ['admission.gate'],
    '★ 别的位置的判据不许出现在这次 ran 里',
  )

  const atContract = await r.evaluate('contract', {})
  assert.deepEqual(
    atContract.blockers,
    ['[contract.gate] inScope names a path the task may not touch'],
    '★ 反向半边：contract 的求值也只许听见它自己的判据 —— 缺了这一半，"两个位置互不影响"是恒真的',
  )
  assert.deepEqual(atContract.ran.map((item) => item.id), ['contract.gate'])

  /**
   * ★ 两半都要在：一条只断言"admission 没听见 contract"的臂，在一个
   *   **所有位置共用一个判据池**的实现上照样绿（那时两边都会听见对方，只要对方
   *   恰好没开火就看不出来）—— 所以这里让两条探针**都开火**，且原文不同。
   */
  assert.notDeepEqual(atAdmission.blockers, atContract.blockers)

  /**
   * ★ 而且这个隔离不是"因为 contract 位置恰好为空"：先证明 contract 真的有判据
   *   （`registered === 1`），再证明它没跑到 admission 那边。
   */
  assert.equal(atContract.registered, 1)
  assert.equal(atAdmission.registered, 1)

  /**
   * ★ 第三条半边（**换了谁空谁满**仍成立）：把 contract 那一条摘掉之后，
   *   admission 的读数一个字都不许变 —— 否则上面那两半可能只是"两个位置都空"。
   */
  assert.equal(r.unregister('contract.gate'), true)
  const afterRemoval = await r.evaluate(POINT, {})
  assert.deepEqual(
    afterRemoval.blockers, atAdmission.blockers,
    '★ 摘掉 contract 的判据不许改 admission 的裁决 —— 两个位置的判据集合是各自独立的',
  )
  assert.deepEqual((await r.evaluate('contract', {})).blockers, [], '★ 而 contract 那边确实回到了空位置')
})

/** 跑一次普查；`env` 用于臂 6（默认清掉继承来的 root，免得夹具受宿主环境影响）。 */
function runCensus({ root, extraArgs = [], env = {}, registryRoot = CENSUS_ROOT } = {}) {
  /**
   * ★ 夹具树只提供**源码树**，注册表仍取本仓的真实注册表（`--registry ROOT`）。
   *   两件事分开摆是本文件的口径：被测的是"给定注册表 × 给定源码树 ⇒ 什么接线读数"，
   *   不是"这条命令能不能把本仓注册表载进来"。
   */
  const args = [CENSUS_SCRIPT, '--registry', registryRoot, ...(root === undefined ? [] : ['--root', root]), ...extraArgs]
  const baseEnv = { ...process.env }
  delete baseEnv.GATE_WIRING_CENSUS_ROOT
  delete baseEnv.GATE_WIRING_CENSUS_REGISTRY
  const result = spawnSync(process.execPath, args, {
    cwd: CENSUS_ROOT,
    encoding: 'utf8',
    env: { ...baseEnv, ...env },
  })
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', code: result.status }
}

/** 跑 `--json` 并解析；没跑成时直接失败（那是夹具自己的错误，不是被测结论）。 */
function runCensusJson(options) {
  const run = runCensus({ ...options, extraArgs: ['--json', ...(options?.extraArgs ?? [])] })
  assert.equal(run.code, 0, `★ 夹具树应当跑成。退码=${run.code} stdout=${run.stdout} stderr=${run.stderr}`)
  return JSON.parse(run.stdout)
}

/** 建一棵临时源码树；`files` 是 `相对路径 -> 内容`。返回清理函数与根目录。 */
function makeTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'gate-wiring-census-'))
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = join(root, relativePath)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content)
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/**
 * 合成的 `src/tools/status.ts`：状态视图的四格各一个位置。
 *
 *   `delivery`  ← 直接 `.evaluate('delivery', …)`                    ⇒ shown
 *   `runtime`   ← 只经由 `evaluateHelperGates`（import 自本仓另一个文件）⇒ shown
 *   `contract`  ← 不求值，且**声明**在 `NOT_EVALUATED_IN_STATUS`      ⇒ not-shown (declared)
 *   `dispatch`  ← 不求值，且**没有**声明                              ⇒ not-shown (undeclared)
 *
 * ★ 用**真实注册表里的位置名**是刻意的：夹具树只替换源码面（`src/`），
 *   注册表仍是本仓那一份。若用 `wired-a` 这类合成名字，读数只会全落进
 *   `unknownPointCalls`，于是本文件就测不到任何真实形状。
 */
const STATUS_FIXTURE = `import { evaluateHelperGates } from './shared/entities.ts'

const NOT_EVALUATED_IN_STATUS = ['contract'] as const

export async function buildStatus(registry: any) {
  const recorded = await registry.evaluate('delivery', {})
  const viaHelper = await evaluateHelperGates(registry, ctx => ctx)
  return { recorded, viaHelper, notEvaluated: NOT_EVALUATED_IN_STATUS }
}
`

const ENTITIES_FIXTURE = `/**
 * ★ 注释里也有一个 .evaluate('runtime', …) —— 但那一次是被人写在文档里的
 *   示例，不是调用点（臂 3 用同一形状钉住"注释不算接线"）。
 */
export const NOTE = 'evaluate'

export async function evaluateHelperGates(registry: any, contextOf: (input: any) => any) {
  return registry.evaluate('runtime', contextOf({}))
}
`

/**
 * 合成的 `src/index.ts`：真调用点 + 三种**假调用点**（各一）。
 *
 *   真：`contract`、`dispatch`、`delivery`（后者在 status.ts 也有一个）
 *   注释里：`admission`            ⇒ 仍须落在 zero
 *   字符串里：`collection`          ⇒ 仍须落在 zero
 *   动态位置名：`completion`        ⇒ 仍须落在 zero，且进 `dynamicCalls`
 */
const SRC_FIXTURE = `import { buildStatus } from './tools/status.ts'

export async function boot(registry: any) {
  await registry.evaluate('contract', {})
  await registry.evaluate('dispatch', {})
  // registry.evaluate('admission', {})
  const label = "registry.evaluate('collection', {})"
  const point = 'completion'
  await registry.evaluate(point, {})
  return { label, status: await buildStatus(registry) }
}
`

/**
 * 合成树的标准内容。三态与四格的分配（位置名全部取自**真实注册表**）：
 *
 *   wired  (4)  contract  dispatch  delivery  runtime
 *   zero   (3)  admission（零调用点）· collection（只在字符串里）· completion（只有动态调用）
 *   vacant (0)  真实注册表里每个位置都至少有一条判据 ⇒ 合成树里造不出 vacant
 *
 * ★ `vacant` 在这一臂里**读数为 0 本身是要被断言的**：它证明"空位置"这一格
 *   不是靠"没有位置"来凑数的（若扫描器把 vacant 并进 zero，zero 会变成 4）。
 */
function standardTree(extraFiles = {}) {
  return makeTree({
    'src/index.ts': SRC_FIXTURE,
    'src/tools/status.ts': STATUS_FIXTURE,
    'src/tools/shared/entities.ts': ENTITIES_FIXTURE,
    ...extraFiles,
  })
}

/** 合成树里每个位置应当落到哪一格 —— 臂 1/2/3 共用的唯一真值。 */
const EXPECTED = Object.freeze({
  wired: ['contract', 'dispatch', 'delivery', 'runtime'],
  zero: ['admission', 'collection', 'completion'],
  vacant: [],
  shown: ['delivery', 'runtime'],
  declared: ['contract'],
  undeclared: ['dispatch'],
})

/** 每个臂共用的一行"这个位置在哪"—— 读数里要指名文件与行号。 */
function siteLabels(entry) {
  return entry.sites.map((site) => `${site.file}:${site.line}`)
}

// ── 臂 1 ──────────────────────────────────────────────────────────────────────

test('臂 4 ★ 三态互斥：wired / zero / vacant 各归其位，三桶两两不相交、并集是全集', () => {
  const tree = standardTree()
  try {
    const census = runCensusJson({ root: tree.root })
    assert.equal(census.status, 'ran')
    assert.equal(census.exitCode, 0)

    /** ★ 注册表里的**每个**位置都必须落进且只落进一格。 */
    const buckets = {
      wired: census.states.wired.points,
      zero: census.states.zero.points,
      vacant: census.states.vacant.points,
    }
    const all = [...buckets.wired, ...buckets.zero, ...buckets.vacant]
    assert.equal(new Set(all).size, all.length, `★ 有位置同时落进两格：${all.join(', ')}`)
    assert.deepEqual(
      [...all].sort(), [...census.registry.insertionPoints].sort(),
      '★ 三桶的并集必须是注册表的全集 —— 漏掉一格就等于那个位置不可见',
    )

    assert.deepEqual([...buckets.wired].sort(), [...EXPECTED.wired].sort(), `实测：${JSON.stringify(buckets.wired)}`)
    assert.deepEqual([...buckets.zero].sort(), [...EXPECTED.zero].sort(), `实测：${JSON.stringify(buckets.zero)}`)
    assert.deepEqual(buckets.vacant, EXPECTED.vacant, `实测：${JSON.stringify(buckets.vacant)}`)

    /**
     * ★★ 这一臂的**核心**：`已接线` 的读数不能是"位置总数"的别名。
     *   把所有位置都算成已接线，是这类普查最经典的自欺（它**永远绿**）。
     */
    assert.notEqual(
      census.states.wired.count, census.registry.points,
      '★ 「已接线」不许等于「位置总数」—— 那会让普查永远报平安',
    )

    /**
     * ★ 零求值那一格必须带上"被空转的判据条数"，否则读表的人只看见
     *   3 个位置名，看不见那背后有几条判据在空转。
     */
    const zeroGates = census.gates.filter((gate) => gate.state === 'zero')
    assert.equal(census.states.zero.gates, zeroGates.length)
    assert.ok(census.states.zero.gates > 0, '★ 零求值的位置上必须真的有判据 —— 否则它该落进 vacant')

    /**
     * ★ 反向半边：**每条**判据都必须挂在自己位置上（`zero` 位置上的判据
     *   不许因为是"全局第一个"就被算到别的桶里）。
     */
    for (const gate of zeroGates) {
      assert.ok(EXPECTED.zero.includes(gate.point), `实测：${JSON.stringify(gate)}`)
    }
  } finally {
    tree.cleanup()
  }
})

// ── 臂 2 ──────────────────────────────────────────────────────────────────────

test('臂 5 ★ 状态视图子读数：直接 / helper / 声明过 / 没声明 —— 四格各一，不互相粘连', () => {
  const tree = standardTree()
  try {
    const census = runCensusJson({ root: tree.root })
    assert.equal(census.statusView.available, true)

    const viewOf = (point) => census.points.find((entry) => entry.point === point)?.statusView

    assert.equal(viewOf('delivery'), 'shown', '★ 直接调用的位置必须算"显示"')
    /**
     * ★★ 这一格是本臂最贵的：`runtime` 在合成 `status.ts` 里**一个字都没有**，
     *   它只经过 `evaluateHelperGates`。若解析只做一层 grep，它会被读成
     *   `not-shown` —— 而那会把一个真的会开火的判据记成"控制台看不见"。
     */
    assert.equal(
      viewOf('runtime'), 'shown',
      `★ 经 helper 求值的位置也必须算"显示"。实测：${JSON.stringify(census.statusView.viaHelpers)}`,
    )
    assert.deepEqual(census.statusView.viaHelpers.map((helper) => helper.binding), ['evaluateHelperGates'])

    assert.equal(
      viewOf('contract'), 'not-shown (declared)',
      '★ 状态视图不求值、但自己声明过不懂这个位置 ⇒ declared',
    )
    assert.equal(
      viewOf('dispatch'), 'not-shown (undeclared)',
      '★ 没声明也求值不到 ⇒ undeclared（这一格是**独立的读数缺口**，不许并进 declared）',
    )

    /**
     * ★ 声明面必须被**逐字**读出来：`contract` 在清单里、`dispatch` 不在。
     *   若把整份 `NOT_EVALUATED_IN_STATUS` 读成"所有不求值的位置都已声明"，
     *   `dispatch` 那一点读数缺口就会被静默销账。
     */
    assert.deepEqual(census.statusView.declaredNotEvaluated, ['contract'])

    /** ★ 两个子读数之和 = 已接线总数；而 `已接线` 本身**不等于** `已接线且显示`。 */
    const { wiredShown, wiredNotShown, wired } = census.states
    assert.equal(wiredShown.count + wiredNotShown.count, wired.count, '★ 子读数必须刚好分完已接线这一格')
    assert.deepEqual([...wiredShown.points].sort(), [...EXPECTED.shown].sort(), `实测：${JSON.stringify(wiredShown)}`)
    assert.deepEqual(
      [...wiredNotShown.points].sort(), [...EXPECTED.declared, ...EXPECTED.undeclared].sort(),
      `实测：${JSON.stringify(wiredNotShown)}`,
    )
    assert.notEqual(wiredShown.count, wired.count, '★ 「显示」不许等于「已接线」')

    /**
     * ★ 而状态视图这一格**只对已接线位置有意义**：零求值 / 空位置一律 `null`，
     *   不许被读成 `not-shown`（那是把一个"没人调用"的位置说成"状态视图不显示它"）。
     */
    for (const entry of census.points) {
      if (entry.state === 'wired') continue
      assert.equal(entry.statusView, null, `★ 非已接线位置不许带状态视图读数。实测：${JSON.stringify(entry)}`)
    }
  } finally {
    tree.cleanup()
  }
})

// ── 臂 3 ──────────────────────────────────────────────────────────────────────

test('臂 6 ★ 注释 / 字符串 / 动态位置名都不算接线 —— 只有代码里的字面量调用点算', () => {
  const tree = standardTree()
  try {
    const census = runCensusJson({ root: tree.root })
    const wired = census.states.wired.points

    /**
     * ★★ 这三条是本文件存在的理由。本仓注释里到处是
     *   `registry.evaluate('admission', …)`；一个 grep 口径的扫描器会把
     *   "零求值"读成"已接线"，而那是一条**永远绿**的读数。
     *
     *   夹具树把它们三个**都**摆在 `src/index.ts` 里，而 `admission` 在真实
     *   注册表里确有判据 ⇒ 一旦扫描器吃下注释里的那行，`admission` 就会从
     *   `zero` 跳进 `wired`，下面臂 1 的 `EXPECTED.zero` 也会一起变红。
     */
    assert.ok(!wired.includes('admission'), `★ 注释里的调用点不算接线。实测 wired=${JSON.stringify(wired)}`)
    assert.ok(!wired.includes('collection'), `★ 字符串字面量里的那一段文字不算接线。实测 wired=${JSON.stringify(wired)}`)
    assert.ok(!wired.includes('completion'), `★ 动态位置名不算接线。实测 wired=${JSON.stringify(wired)}`)

    /**
     * ★ 认不出 ≠ 接了线：`.evaluate(point, …)` 无法被证明接到哪个位置，
     *   于是它进 `dynamicCalls` 而不是 `wired` —— 而且**要能被指名**，
     *   否则读日志的人不知道是哪一行没认出来。
     */
    assert.equal(census.dynamicCalls.length, 1, `实测：${JSON.stringify(census.dynamicCalls)}`)
    assert.equal(census.dynamicCalls[0].file, 'src/index.ts')
    assert.ok(
      census.dynamicCalls[0].text.includes('.evaluate(point'),
      `★ 动态调用点要能在读数里被指名。实测：${census.dynamicCalls[0].text}`,
    )

    /** ★ 三条假调用点不许在读数里留下别的痕迹（它们本来就不是调用点）。 */
    assert.deepEqual(
      census.unknownPointCalls, [],
      `★ 假调用点不许被读成"指向未注册位置的调用"。实测：${JSON.stringify(census.unknownPointCalls)}`,
    )

    /**
     * ★ 真调用点仍然要指名**文件与行号**：`contract` 在 `src/index.ts` 第 4 行
     *   （`SRC_FIXTURE` 里第 1 行是 import，第 3 行是函数头）。行号错了，
     *   下一个人按读数去改代码会改到别处。
     */
    const contract = census.points.find((entry) => entry.point === 'contract')
    assert.deepEqual(siteLabels(contract), ['src/index.ts:4'], `实测：${JSON.stringify(contract.sites)}`)

    /**
     * ★ 反向半边：`entities.ts` 的注释里也写着 `evaluate('runtime', …)`，
     *   而那个位置**真的**也有调用点 ⇒ 它必须仍在 wired 里。
     *   注释既不加分（臂 3 上半）也不减分（这一条）。
     */
    assert.ok(wired.includes('runtime'))
  } finally {
    tree.cleanup()
  }
})

// ── 臂 7 ──────────────────────────────────────────────────────────────────────

test('臂 7 ★ 没跑成 ≠ 零求值：源树认不出时退码 2、说明原因，且一个接线读数都不输出', () => {
  /**
   * ★★ 本臂钉住的是**缺席**的形状。三条"没跑成"各一例：
   *   ① 根目录根本不存在；② 有 `src/` 但里面没有源码；③ 没有 `src/`。
   */
  const missingRoot = join(tmpdir(), `gate-wiring-census-does-not-exist-${process.pid}-${Date.now()}`)
  const emptyTree = makeTree({ 'src/.keep': '' })
  const noSrcTree = makeTree({ 'lib/index.js': 'export const x = 1\n' })
  try {
    for (const [label, root] of [
      ['根目录不存在', missingRoot],
      ['src 里没有源码', emptyTree.root],
      ['没有 src', noSrcTree.root],
    ]) {
      const run = runCensus({ root, extraArgs: ['--json'] })
      assert.equal(run.code, 2, `★ ${label} 必须报「没跑成」而不是跑出一张空表。stdout=${run.stdout}`)
      const payload = JSON.parse(run.stdout)
      assert.equal(payload.status, 'not-run', `★ ${label} 的 status 必须是 not-run`)
      assert.equal(payload.exitCode, 2)
      assert.equal(typeof payload.reason, 'string')
      assert.ok(payload.reason.length > 0, `★ ${label} 的「没跑成」必须说明原因（空原因＝下一个人只能猜）`)
      /**
       * ★★ 最关键的半边：没跑成时**不许**带 `states` —— 一张全是 0 的两态表
       *   会被读成"普查跑了、全都没接线"，或者更糟："全都没事"。
       */
      assert.equal(payload.states, undefined, `★ ${label} 的输出不许带 states（缺席不是 0）。实测：${JSON.stringify(Object.keys(payload))}`)
      assert.equal(payload.points, undefined, `★ ${label} 的输出不许带 points`)

      /** ★ 人读的输出也必须把"没跑成"写在脸上，而不是打一张空表。 */
      const human = runCensus({ root })
      assert.equal(human.code, 2)
      assert.match(human.stdout, /没跑成/, `★ 人读口径也要报「没跑成」。实测：${human.stdout}`)
      assert.match(human.stdout, /reason:/, '★ 而且要给出原因')
      assert.doesNotMatch(human.stdout, /已接线 \(wired\):\s+\d+ point/, '★ 人读口径不许顺带打出两态表')
    }

    /**
     * ★ 参数错误也是"没跑成"（不是"跑出来全员已接线"）。而 `--json` 在这里
     *   也要给出机器可读的形状，否则调用方只能靠 stderr 判错。
     */
    const badArg = runCensus({ extraArgs: ['--nonsense'] })
    assert.equal(badArg.code, 2)
    assert.match(badArg.stdout, /没跑成/)
    assert.match(badArg.stdout, /unknown argument: --nonsense/)
  } finally {
    emptyTree.cleanup()
    noSrcTree.cleanup()
  }
})

// ── 臂 5 ──────────────────────────────────────────────────────────────────────

test('臂 8 ★ 真实仓库对照臂：三条读数自洽，且「已接线」不是「位置总数」的别名', () => {
  const census = runCensusJson({})
  assert.equal(census.status, 'ran')
  assert.equal(census.exitCode, 0)
  assert.ok(census.src.sourceFiles > 0, '★ 真实 src/ 必须扫到源码')

  const { wired, zero, vacant, wiredShown, wiredNotShown } = census.states
  assert.equal(
    wired.count + zero.count + vacant.count, census.registry.points,
    '★ 三态之和必须等于注册表位置数（否则有位置凭空消失）',
  )
  assert.equal(wiredShown.count + wiredNotShown.count, wired.count)
  assert.ok(wired.count > 0, '★ 真实仓库里必须**至少有一个**已接线位置 —— 否则读数表本身没在测东西')
  assert.ok(wired.count < census.registry.points, '★ 也不许把全部位置都读成已接线')
  /**
   * ★ 真实仓库的**当前**读数（本任务只出读数，不接线）：`admission` 零求值。
   *   写死它是刻意的 —— 它不是不变量，而是「这条读数确实测到了东西」的对照；
   *   谁把它接上线，这条就会变红**并且应当变红**（那时请把这一格改成新的实况）。
   */
  assert.ok(zero.points.includes('admission'), `实测 zero=${JSON.stringify(zero.points)}`)
  assert.ok(zero.gates > 0, '★ 零求值那一格必须带上被空转的判据条数（0 条就没东西可空转了）')
})

// ── 臂 6 ──────────────────────────────────────────────────────────────────────

test('臂 9 ★ --root 覆盖 GATE_WIRING_CENSUS_ROOT，且 --json 是机器可读的', () => {
  const first = standardTree()
  const second = standardTree({ 'src/extra.ts': "export const onlyHere = 1\n" })
  try {
    /**
     * ★ 两棵树都能跑成 —— 先用读数证明"两棵树**确实不同**"，
     *   否则下面的"命令行优先"可能只是两次都读了同一个默认地点。
     */
    const viaFirst = runCensusJson({ root: first.root })
    const viaSecond = runCensusJson({ root: second.root })
    assert.equal(viaFirst.src.sourceFiles + 1, viaSecond.src.sourceFiles, '★ 第二棵树必须多一个源文件')

    /** ★ 环境变量指向第一棵、命令行指向第二棵 ⇒ 必须读第二棵（命令行优先）。 */
    const precedence = runCensus({ root: second.root, extraArgs: ['--json'], env: { GATE_WIRING_CENSUS_ROOT: first.root } })
    assert.equal(precedence.code, 0)
    assert.equal(
      JSON.parse(precedence.stdout).src.sourceFiles, viaSecond.src.sourceFiles,
      '★ --root 必须压过环境变量（否则夹具会被宿主环境影响而随机变红）',
    )

    /** ★ 只用环境变量也能跑（没有 --root 时的另一条入口）。 */
    const envOnly = runCensus({ extraArgs: ['--json'], env: { GATE_WIRING_CENSUS_ROOT: first.root } })
    assert.equal(envOnly.code, 0)
    assert.equal(JSON.parse(envOnly.stdout).src.sourceFiles, viaFirst.src.sourceFiles)

    /**
     * ★ `--json` 的输出必须是**能被机器读完的**：一次 `JSON.parse` 就要成，
     *   而且关键读数都在（不是把给人看的表塞进 JSON 字符串里）。
     */
    for (const key of ['status', 'exitCode', 'registry', 'states', 'points', 'gates']) {
      assert.ok(Object.hasOwn(viaFirst, key), `★ JSON 里缺 ${key}`)
    }
    assert.equal(typeof viaFirst.states.zero.count, 'number')
  } finally {
    first.cleanup()
    second.cleanup()
  }
})

// ── 臂 10 ─────────────────────────────────────────────────────────────────────

test('臂 10 ★ 空位置（vacant）不许并进零求值 —— 用一份合成注册表把这一格真的造出来', () => {
  /**
   * ── ★★ 这一臂为什么必须存在（它是被一次**变异存活**逼出来的）────────────────────
   *
   * 真实注册表里**每个**插入点都至少挂着一条判据 ⇒ 合成源码树上 `vacant` 恒为 0，
   * 于是"扫描器把空位置并进零求值"这样一个改动，在上面所有臂下**全绿通过**。
   * 那正是本队记账的形态：**一格读数因为造不出来，就等于没人守**。
   *
   * ⇒ 这一臂用 `--registry` 把注册表本身也换成合成的一份：位置 `vacant-point`
   *   上一条判据都没有，位置 `zero-point` 上有一条、而 `src/` 里没有调用点。
   *   两格读出来必须**不同** —— 否则"这里本来就没判据"会污染缺陷读数。
   */
  const registryTree = makeTree({
    'lib/gates/registry.js': [
      "export const INSERTION_POINTS = ['zero-point', 'vacant-point']",
      '',
      'export function createGateRegistry() {',
      '  const points = new Map(INSERTION_POINTS.map((point) => [point, []]))',
      '  return {',
      '    register(entry) { points.get(entry.point).push(entry) },',
      '  }',
      '}',
      '',
    ].join('\n'),
    'lib/gates/index.js': [
      "import { INSERTION_POINTS } from './registry.js'",
      '',
      'export function buildRegistry() {',
      '  const list = Object.fromEntries(INSERTION_POINTS.map((point) => [point, []]))',
      "  list['zero-point'].push({ id: 'zero-point.only', point: 'zero-point', description: 'never evaluated' })",
      '  return { list: () => list }',
      '}',
      '',
    ].join('\n'),
  })
  const sourceTree = makeTree({
    'src/index.ts': 'export const nothing = 1\n',
  })
  try {
    const run = runCensus({ root: sourceTree.root, extraArgs: ['--json'], registryRoot: registryTree.root })
    assert.equal(run.code, 0, `★ 合成注册表也必须跑成。退码=${run.code} ${run.stdout}`)
    const census = JSON.parse(run.stdout)
    assert.deepEqual([...census.states.zero.points], ['zero-point'], `实测：${JSON.stringify(census.states.zero)}`)
    assert.deepEqual(
      [...census.states.vacant.points], ['vacant-point'],
      '★ 一条判据都没有的位置必须落进 vacant；把它并进 zero 会让缺陷读数被"这里本来就没判据"污染',
    )
    assert.equal(census.states.zero.count, 1)
    assert.equal(census.states.vacant.count, 1)
    assert.equal(census.states.vacant.gates, 0, '★ 空位置上"被空转的判据条数"必须是 0')
  } finally {
    registryTree.cleanup()
    sourceTree.cleanup()
  }
})
