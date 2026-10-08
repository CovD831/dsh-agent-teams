#!/usr/bin/env node
/**
 * ── j-0002 判据化：「同一件工作的两种写法必须同裁」───────────────────────────────
 *
 * ── ★★ 它要产出的不是【一个判据】，而是一条【通用夹具形状】────────────────────────
 *
 *   「对每一条判据，构造『同一件工作的两种写法』的对照对，断言两者同裁。」
 *
 * ★ 而那件事有一半可机械化、一半不可：
 *
 *     ✅ **同裁断言**是可机械化的（跑两次、比裁决）
 *     ❌ **构造哪一对**不可机械化 —— 它需要理解那个判据在判什么
 *
 *   ⇒ 所以形状是：**通用夹具（本文件）+ 每条判据手工提供一对**（下面的 `PAIRS`）。
 *
 * ── ★★★ 它为什么存在（MEASURED，t43 已验过一次）──────────────────────────────────
 *
 *   `contract.task-atomicity` 曾断言「inScope 里有目录条目 ⇒ 会新建目录 ⇒ 不原子」，
 *   而它的实现只做 `path.trim().endsWith('/')`。⇒ 实测：
 *
 *       ['src/registry.ts', 'src/index.ts']          ⇒ ok
 *       ['src/registry.ts', 'src/index.ts', 'src/']  ⇒ blocked
 *
 *   ★ 而那两边做的是**同一件事**（都在 `src/` 下干活）。
 *   ⇒ 即：那个判据判的不是「工作」，而是「**写法**」。
 *   （★ 那条判据后来被退役了 —— 见下面 §'为什么清单里没有 task-atomicity'。）
 *
 * ── ★ 三态（不得合并）────────────────────────────────────────────────────────────
 *
 *     `same`              同裁 ⇒ 合格
 *     `diverges`          不同裁 ⇒ ★ 判据判的是写法（**这是要报的缺陷**）
 *     `cannot-construct`  无法构造对照对 ⇒ ★ **必须附理由**（而不是悄悄跳过）
 *
 * ── ★★ 反向半边（不许恒绿）─────────────────────────────────────────────────────
 *
 *   对照对必须是【同一件工作】的两种写法。**若两边做的事不同，对照不成立** ——
 *   而"同裁"可以靠"两边本来就不同"来伪造。⇒ 每条 pair 必须自证（`sameWorkBecause`），
 *   而本文件断言它非空，且断言两种写法**确实不同**（否则它测的是一个恒等式）。
 *
 * ── ★★★ 数据为什么内联在本文件里（而不是一个 JSON）──────────────────────────────
 *
 *   t77 曾把这两个清单放在 `scripts/fixtures/falsification-pairs.json` 里。
 *   ★ 而那份 JSON **从未被提交**（全仓 untracked）⇒ 于是它**腐烂了**：
 *     两次普查都写着一条**早已退役**的判据（`contract.task-atomicity`），
 *     而那让本条判据的三个臂**长期红着**，却没人知道它红的是什么。
 *
 *   ⇒ 所以本版把数据**内联**：一个判据的数据与它的判据放在一起，
 *     它们会**一起**被 commit、一起被看、一起腐烂（如果会的话）。
 *     ★ 这不是"省一个文件"，而是把"两份真相"合成一份 —— 本队反复记账的那条。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registry } from '../lib/gates/index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 注册表里【全部】判据的 id（按位置分组，组内保持注册顺序）。 */
function allGateIds() {
  const ids = []
  for (const gates of Object.values(registry.list())) for (const gate of gates) ids.push(gate.id)
  return ids
}

/**
 * ── ★★ 跑一条判据，返回它的裁决**形状**（而不是"ok/blocked"四个字母）──────────────
 *
 * ★ 为什么要一个"形状"而不是布尔：三态（ok / blocked / unmeasured）里，
 *   **`unmeasured` 与 `ok` 不同形**，而把它们并成一个布尔会让本夹具
 *   在"两边都 unmeasured"时判成"同裁" —— 而那正是本队记账最久的那条界线
 *   （「没能测量」不许并进「通过」）。
 */
function verdictShape(verdict) {
  if (verdict === null || typeof verdict !== 'object') return 'malformed'
  if (verdict.ok === true) return 'ok'
  if (typeof verdict.unmeasured === 'string' && verdict.unmeasured.trim() !== '') {
    return Array.isArray(verdict.blockers) && verdict.blockers.length > 0 ? 'blocked+unmeasured' : 'unmeasured'
  }
  if (Array.isArray(verdict.blockers) && verdict.blockers.length > 0) return 'blocked'
  return 'malformed'
}

/** 对一条判据求值（走**真实注册表**，不是直接 import 那个函数）。 */
async function evaluate(gateId, taskExtra) {
  const byPoint = registry.list()
  const owner = Object.entries(byPoint).find(([, gates]) => gates.some((gate) => gate.id === gateId))?.[0]
  if (owner === undefined) {
    return { missing: true, shape: 'gate-not-in-registry' }
  }
  const evaluation = await registry.evaluate(owner, baseContext(owner, taskExtra))
  /**
   * ★★ 形状要**按注册表返回的真实类型**读（本文件第一版在这里当场炸了）──────────────
   *
   * MEASURED：`GateEvaluation.unmeasured` 是一个**字符串**（不是数组），
   * 而本文件第一版照抄了别处的 `evaluation.unmeasured.length` ——
   * 于是 `undefined.length` 抛 `TypeError`。
   *
   * ★ 形态：**照抄一份"看着一样"的写法而没核对它在读什么** ——
   *   与本队记过的"把 `__dirname` 抄进 ESM"是同一类（编得过、跑到那一行才炸）。
   * ⇒ 现在逐格用 `typeof` / `Array.isArray` 读**真实类型**。
   */
  const unmeasuredText = typeof evaluation.unmeasured === 'string' && evaluation.unmeasured.trim() !== ''
    ? evaluation.unmeasured
    : undefined
  const blockerList = Array.isArray(evaluation.blockers) ? evaluation.blockers : []
  return {
    missing: false,
    evaluation,
    shape: verdictShape({
      ok: evaluation.ok,
      ...(unmeasuredText === undefined ? {} : { unmeasured: unmeasuredText }),
      ...(blockerList.length > 0 ? { blockers: blockerList } : {}),
    }),
  }
}

/**
 * ── 一个"够用"的基础 ctx ────────────────────────────────────────────────────────
 *
 * ★ 它只提供**让判据能说话**的最小面；而对照对各自的差异由 `extra` 带进来。
 *   ⇒ 于是"两次求值的唯一差别是写法"这句话是**结构上**成立的（同一个 base）。
 *
 * ── ★★★ `update` 必须**逐格合并**，不能整块被 `...extra` 顶掉（本文件第一版在这里恒真）──
 *
 * MEASURED（本文件第一版，被定向突变当场抓出来）：
 *
 *   第一版写的是 `update: { status:'completed', changedPaths:['src/a.ts'], … }, …, ...extra`
 *   ⇒ 而对照对的数据是**嵌在 `update` 里**的（`writingA.update.changedPaths` 那种形状）。
 *     于是 `...extra` 把 `update` 整块**覆盖**成 `{status, changedPaths:[…], newTestFiles}`
 *     —— ★ 那串 `['./src/a.ts']` **从来没有到达判据**。
 *
 *   ⇒ 后果：两次求值喂的是**同一份默认输入** ⇒ 当然"同裁" ⇒ 臂 1 **恒真**。
 *     ★ 而那正是本队记账的第一种恒真写法，且它**只在定向突变下才现形**：
 *       我把 changed-paths 改成"按写法判"，臂 1 **仍然是绿的**。
 *
 * ⇒ 修法：`update` 显式**展开合并**（默认值在前、`extra.update` 在后），
 *   而顶层其余各格照旧。★ 于是"对照对真的到达了判据"这件事是结构上成立的。
 */
function baseContext(point, extra) {
  const { update, ...rest } = extra ?? {}
  return {
    task: { id: 'pair-probe', kind: 'implementation', verify: ['node -e "process.exit(0)"'], acceptance: ['a'], ...rest.task },
    creating: true,
    /** ★ 逐格合并：默认值打底，对照对的那几格覆盖上去（而不是整块替换）。 */
    update: { status: 'completed', changedPaths: ['src/a.ts'], newTestFiles: ['scripts/x.test.mjs'], ...update },
    changedPaths: ['src/a.ts'],
    event: 'task-status',
    team: { id: 'team', name: 'Pairs', tasks: [], members: [] },
    ...rest,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 对照对清单（手工构造：那需要理解每条判据在判什么）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★ 每一条都必须自证「两边是同一件工作」（`sameWorkBecause`）──────────────────
 *
 *   ★ 而两端必须**真的不同**（`notDeepEqual` 断言）—— 否则测的是恒等式。
 *   ★★ 而两端都必须是**实质性**的裁决（不许两边都 `unmeasured`）——
 *      "都没测到"两边当然相同，但那不是"同裁"，是**什么都没测**。
 *      本文件把这条写成显式断言（见臂 1）。
 */
const PAIRS = [
  {
    gateId: 'dispatch.changed-paths',
    comment: '★ 同一条路径的两种写法（相对写法 vs 显式 `./` 前缀）⇒ 两边都核得过去 ⇒ 应当同裁。',
    writingA: { update: { changedPaths: ['src/a.ts'] }, observedChangedPaths: ['src/a.ts'], gitChangedPaths: ['src/a.ts'] },
    writingB: { update: { changedPaths: ['./src/a.ts'] }, observedChangedPaths: ['src/a.ts'], gitChangedPaths: ['src/a.ts'] },
    sameWorkBecause:
      '两边申报的是【同一条路径】（`normalizeWorkspacePath` 把 `./src/a.ts` 与 `src/a.ts` 规整成同一个），'
      + '而观察面（会话 + 工作区）逐字相同 ⇒ 描述的是同一件工作，只是写法不同。',
  },
  {
    gateId: 'dispatch.changed-paths',
    comment:
      '★ 同一条【不存在的】路径的两种写法 ⇒ 两边都该被判虚报（blocked）。'
      + '★ 这一对比上面那条更有分辨力：它证明判据不是只会说 ok。',
    writingA: { update: { changedPaths: ['src/never-written.ts'] }, observedChangedPaths: [], gitChangedPaths: [] },
    writingB: { update: { changedPaths: ['./src/never-written.ts'] }, observedChangedPaths: [], gitChangedPaths: [] },
    sameWorkBecause:
      '两边申报的是同一条【从未被观察到的】路径，只是写法不同（`./` 前缀）。'
      + '★ 而两个观察面都**显式**给了空数组（不是缺席）⇒ 两边都是「观察了、确实没有」，'
      + '于是两边都该同样地被判虚报。',
  },
]

/**
 * ── 「无法构造对照对」的那几条 ──────────────────────────────────────────────────
 *
 * ★★★ 而这是本任务的价值所在：**普查会报出一个数字**（能构造几条 / 不能几条）。
 * ★ 而"不能"**必须附理由** —— 一个没有理由的跳过与"这个判据没问题"同形。
 *
 * ★ 理由必须**实质**（本文件断言长度 > 30）：它要说清**为什么这条判据的输入里
 *   不存在"同一件工作的两种写法"这回事**，而不是"我们没做"。
 */
const NOT_CONSTRUCTIBLE = new Map([
  [
    'runtime.liveness',
    '它的判别面是【事件名】（`ctx.event` ∈ LIVENESS_EVENTS），而"事件"没有"两种写法" ——'
    + '一个事件要么是这个字符串、要么是别的。⇒ ★ 它不是"构造不出来"，而是**这条判据的输入里'
    + '不存在"同一件工作的两种写法"这回事**（它的输入是枚举里的一个值，不是一件工作的描述）。',
  ],
  [
    'delivery.convergence',
    '它的判别面是【成员的收敛态】（白名单 idle/reported）。★ 而"收敛"是一个**状态**，'
    + '不是一个可以用两种写法描述的工作 ⇒ 同一种收敛态只有一种写法。'
    + '★ 而它**可以**被另一种对照覆盖（"状态枚举"与"写法"是两种不同的东西），'
    + '但那不是本夹具的形状（本夹具只管"同一件工作的两种写法"）。',
  ],
  [
    'completion.mutation',
    '它的判别面是【变异体被杀死的比例】—— 而那要求真的跑测试。'
    + '★ 而"两种写法"要成立，得让两边**产生同一批变异体**；'
    + '那需要构造两棵内容等价的代码树，而那不是"写法"层面的差别。'
    + '⇒ ★ 构造不出来的是【等价的变异体集】，而不是写法。',
  ],
  [
    'completion.backtest',
    '它的判别面是【基准是否绿 + 选测来源是否明】—— 两边都要求真的跑测试。'
    + '★ 而"同一件工作"在这里意味着**同一批被选中的测试**；'
    + '要让两种写法选出同一批，得先让依赖图等价 ⇒ 那又回到"构造等价的代码树"。',
  ],
  [
    'completion.r5',
    '它的判别面是【新测试在父版本上红、在修复版本上绿】—— 两个版本都要真的有测试运行。'
    + '★ 而"写法"的差异（例如路径的 `./` 前缀）会被 `newTestFiles` 的规整吃掉，'
    + '而规整**之后**的两种写法是**同一个字符串** ⇒ 那不是"两种写法"，那是同一个输入。',
  ],
  [
    'completion.verify-rerun',
    '它的判别面是【重跑的 exitCode 与自报的是否一致】—— 而它**要求真的执行那条命令**。'
    + '★ 而"两种写法"在这里只能是命令的写法（空格数、引号），'
    + '而那属于 **`contract.verify-command` 的判别面**（命令可判性），不是这一条的。'
    + '⇒ 把它算在 verify-rerun 头上，会让"命令写法"这一个缺陷被**记两次**。',
  ],
  [
    'contract.verify-command',
    '它的判别面是【这条命令判不判得出来】—— 而"写法"是**它的输入**，不是它的判据。'
    + '★ 实测：`verify: ["true"]` 与 `verify: [" true "]` 两边都是 `unmeasured` ——'
    + '因为两者都要先有**命令可判性**这一格被喂满才会说话。'
    + '⇒ ★ 两边都 `unmeasured` **不是同裁**，是"两边都没测到"（本文件用臂 1 的'
    + '「不许两边都 unmeasured」把这条排除掉）。',
  ],
  [
    'contract.build-artifact-scope',
    '它的判别面是【inScope 里有没有 `src/**` 却没声明对应的 `lib/**` 产物】——'
    + '★ 而"两种写法"要成立，得让两边**指向同一批源文件**；'
    + '实测：`inScope: ["src/", "lib/a.js"]` 与 `["src/a.ts", "lib/a.js"]` 两边都是 `unmeasured`，'
    + '因为该判据要的那一格（`inScope` 与构建产物的对应关系）在这个最小 ctx 里读不到。'
    + '⇒ ★ 真正能构造出一对的地方在【产物映射】那一层，而那需要一份真实的构建产物清单。',
  ],
  [
    'dispatch.worktree',
    '它的判别面是【这次工作有没有真的落在隔离 worktree 里】—— 那是一个**位置事实**。'
    + '★ 而"两种写法"要成立，得让两个不同的路径指向**同一个 worktree**；'
    + '而 worktree 路径的差异（`../wt-a` vs `../wt-b`）是**两件不同的工作**，不是两种写法。'
    + '★ 实测：两者都是 `blocked`，但那是"两边都没在 worktree 里" —— 不是同裁。',
  ],
  [
    'delivery.coverage',
    '它的判别面是【每个目标条目有没有任务声称覆盖它】—— 而目标条目是**数据**，'
    + '不是可以用两种写法描述的"工作"。★ 一条 `goal_item` 的两种写法（大小写？空格？）'
    + '是不是"同一件工作"，取决于**目标本身怎么定义**，而那是调用方的事，不是这条判据的判别面。',
  ],
])

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★ 核心臂）：每一条对照对必须**同裁**
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 1（核心）：同一件工作的两种写法 ⇒ 必须**同裁**', async () => {
  /**
   * ★ 反向半边（防恒真）：清单**不许为空**，且每条都要自证"两边是同一件工作"。
   */
  assert.ok(PAIRS.length > 0, '★ 对照对清单不许为空 —— 否则本臂在空集合上恒真')

  const failures = []
  for (const pair of PAIRS) {
    assert.ok(
      typeof pair.sameWorkBecause === 'string' && pair.sameWorkBecause.trim() !== '',
      `★ "${pair.gateId}" 的对照对必须自证「两边是同一件工作」——`
      + ' 否则「同裁」可以靠"两边本来就不同"来伪造',
    )
    /** ★★ 两种写法本身必须**真的不同** —— 否则这条 pair 测的是一个恒等式。 */
    assert.notDeepEqual(
      pair.writingA, pair.writingB,
      `★ "${pair.gateId}" 的两种写法必须真的不同 —— 否则它测的是恒等式，不是对照`,
    )

    const a = await evaluate(pair.gateId, pair.writingA)
    const b = await evaluate(pair.gateId, pair.writingB)

    /**
     * ★★ 而它必须**真的跑了那条判据**（不是"判据不在注册表里"）——
     *   一个已退役的 id 会让两边都落 `gate-not-in-registry`，而那**看起来像同裁**。
     *
     *   MEASURED（本判据上一版，t77）：它的两条 pair 都指向 `contract.task-atomicity`，
     *   而那条判据**已经被退役**（全仓 grep：零个注册）⇒ 本臂长期红着一句
     *   「注册表里没有判据 … 它可能被改名或删除了」。★ 那条红是**对的** ——
     *   而它红的原因与"写法"无关，是**数据腐烂**。
     */
    assert.equal(a.missing, false, `★ 注册表里没有判据 "${pair.gateId}" —— 它可能被改名或删除了`)
    assert.equal(b.missing, false, `★ 注册表里没有判据 "${pair.gateId}"`)

    /**
     * ★★★ 两边都 `unmeasured` **不算同裁**（本文件的第一版在这里差点恒真）。
     *
     *   理由与 `verdictShape` 的存在同源：`unmeasured` 是"没能测量"，
     *   而"两边都没能测量"与"两边测了、结论相同"是**两件事**。
     *   把它算成同裁，会让这条判据在**任何**未接线的判据上都"通过"。
     */
    assert.notEqual(
      a.shape, 'unmeasured',
      `★ "${pair.gateId}" 的两种写法**都**是 unmeasured —— 那不是"同裁"，是两边都没测到。`
      + ' ⇒ 这一对没有判别力（它证明不了判据同裁），请换一对能真的跑出裁决的输入。',
    )

    if (a.shape !== b.shape) {
      failures.push(
        `${pair.gateId}: 写法 A ⇒ ${a.shape} ｜ 写法 B ⇒ ${b.shape}`
        + `\n    而两边是同一件工作：${pair.sameWorkBecause}`,
      )
    }
  }
  assert.deepEqual(
    failures, [],
    '★ 这些判据对【同一件工作的两种写法】给了**不同的裁决** —— 即：它们判的是写法，不是工作',
  )
  console.log(`[j-0002 对照] ${PAIRS.length} 条对照对全部同裁`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★★★ 普查臂）：对注册表里**每一条**判据报出三态
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 2（普查臂）：对注册表里**每一条**判据报出三态，且「无法构造」必须附理由', () => {
  /**
   * ── 这一臂的产出是**那个数字**（契约：「那个数字就是它的价值」）─────────────────
   *
   * ★ 而它同时守住一条纪律：**每一条判据都必须落到三态之一** ——
   *   既没有对照对、也没有"无法构造"理由的那些，就是**被静默跳过**的。
   *   ★ 而"静默跳过"与"这个判据没问题"在读数上同形 —— 那正是本夹具要消灭的形态。
   */
  const ids = allGateIds()
  assert.ok(ids.length >= 10, `★ 注册表里必须有足够的判据（实测 ${ids.length}）—— 否则普查没有意义`)

  const paired = new Set(PAIRS.map((pair) => pair.gateId))
  const same = []
  const notConstructible = []
  const unknown = []

  for (const id of ids) {
    if (paired.has(id)) { same.push(id); continue }
    if (NOT_CONSTRUCTIBLE.has(id)) { notConstructible.push(id); continue }
    unknown.push(id)
  }

  /**
   * ★★ 三态**互不同形**，且这里把它们**分开报**（而不是合成一个计数）。
   */
  console.log(
    `[j-0002 普查] 注册表 ${ids.length} 条判据 —— `
    + `有对照对 ${same.length} · 无法构造（附理由）${notConstructible.length} · ★ 两者皆无 ${unknown.length}`,
  )
  for (const id of unknown) console.log(`    ✗ ${id} —— 既没有对照对、也没有"无法构造"的理由`)

  /**
   * ★★★ 硬断言 ①：**不许有"两者皆无"的**。
   *   那正是"静默跳过"，而它与"这个判据没问题"同形。
   */
  assert.deepEqual(
    unknown, [],
    '★★ 这些判据既没有对照对、也没有"无法构造"的理由 ⇒ 它们**被静默跳过了**。'
    + '\n   而"静默跳过"与"这个判据没问题"在读数上同形 —— 那正是本夹具要消灭的形态。\n'
    + `   逐条：${unknown.join(', ')}`,
  )

  /**
   * ★★ 硬断言 ②：每一条"无法构造"的理由都必须**实质**（而不是占位符）。
   */
  for (const [id, why] of NOT_CONSTRUCTIBLE) {
    assert.ok(why.length > 30, `★ "${id}" 的"无法构造"理由必须**实质**（实测 ${why.length} 字）："${why}"`)
  }

  /**
   * ★ 硬断言 ③：`NOT_CONSTRUCTIBLE` 里**不许**出现已经不在注册表里的判据 ——
   *   那正是本判据上一版腐烂掉的那个形态（理由是写给一条不存在的判据的）。
   */
  const staleReasons = [...NOT_CONSTRUCTIBLE.keys()].filter((id) => !ids.includes(id))
  assert.deepEqual(
    staleReasons, [],
    '★★ 这些"无法构造"的理由是写给【不在注册表里】的判据的 —— 数据腐烂了：\n  '
    + staleReasons.join('\n  '),
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★ 三态臂）：`same` / `diverges` / `cannot-construct` 互不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3（三态臂）：`same` / `diverges` / `cannot-construct` 三态互不同形', async () => {
  /**
   * ★ 三态必须**可分辨**：一个"同裁"、一个"不同裁"、一个"构造不出来"，
   *   而它们的补救动作完全不同（放行 / 报缺陷 / 说明为什么）。
   */
  const samePair = await evaluate('dispatch.changed-paths', PAIRS[0].writingA)
  const samePairB = await evaluate('dispatch.changed-paths', PAIRS[0].writingB)
  assert.equal(samePair.shape, samePairB.shape, '★ 前置：第一对确实同裁')

  /** ★ 而 `diverges` 那一个状态**必须真的可达** —— 用一个会分的输入证明。 */
  const diverging = await evaluate('dispatch.changed-paths', {
    changedPaths: ['src/a.ts'], observedChangedPaths: [], gitChangedPaths: [],
  })
  assert.notEqual(
    diverging.shape, samePair.shape,
    '★ 前置：确实存在会"不同裁"的输入（否则 `diverges` 那一态是死的）',
  )

  /** ★ `cannot-construct` 是**白名单那一态**，与上面两者不同形（它是给判据的，不是给输入的）。 */
  const states = new Set([samePair.shape, diverging.shape, 'cannot-construct'])
  assert.equal(states.size, 3, '★ 三态必须两两不同形')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★★ 反向半边）：若两边做的事【不同】⇒ 对照不成立
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 4（反向半边）：若两边做的事【不同】⇒ 对照不成立（不许拿它冒充同裁）', async () => {
  /**
   * ── 这一臂防的是什么 ────────────────────────────────────────────────────────────
   *
   * ★ "同裁"可以靠"两边本来就不同"来伪造：随便挑两个输入，它们当然同裁。
   *   ⇒ 所以每条 pair 必须自证"两边是同一件工作"，且两端必须真的不同。
   *
   * ★★ 而这一臂**亲手构造一次反例**，证明"两边不同 ⇒ 不同裁"是真的可发生的 ——
   *   否则"同裁"可能只是"这个判据对什么都放行"。
   */
  const a = await evaluate('dispatch.changed-paths', {
    changedPaths: ['src/a.ts'], observedChangedPaths: ['src/a.ts'], gitChangedPaths: ['src/a.ts'],
  })
  /**
   * ★★ 反例必须**真的会分** —— 而本文件第一版挑错了一对（MEASURED，当场红）：
   *
   *   第一版拿 `['src/a.ts']` vs `['src/a.ts','src/never-written.ts']` 当"不同工作"。
   *   而两者**都是 blocked**（多申报一条从没写过的路径 ⇒ 仍然被拒）——
   *   于是"前置"那条断言红了。★ 而它红得**对**：那一对根本不是"不同裁"的证据。
   *
   * ⇒ 真正会分的那一对是【真的做了工作】vs【凭空申报】：
   *     A: changedPaths=['src/a.ts'] 且观察面也证实了它   ⇒ **ok**
   *     B: changedPaths=['src/never.ts'] 且观察面是空的   ⇒ **blocked**
   */
  const differentWork = await evaluate('dispatch.changed-paths', {
    changedPaths: ['src/never-written.ts'], observedChangedPaths: [], gitChangedPaths: [],
  })
  assert.notEqual(
    a.shape, differentWork.shape,
    '★ 前置：两边做【不同】的工作时必须不同裁 —— 否则本判据对什么都放行（恒真），'
    + ' 而"同裁"那句话就没有意义了\n'
    + `  实测：真做了工作 ⇒ ${a.shape} ｜ 凭空申报 ⇒ ${differentWork.shape}`,
  )

  /**
   * ★ 而"两边不同"必须**真的可分辨**：上面那对的两个输入至少有一处不同。
   */
  assert.notDeepEqual(
    { changedPaths: ['src/a.ts'], observedChangedPaths: ['src/a.ts'], gitChangedPaths: ['src/a.ts'] },
    { changedPaths: ['src/never-written.ts'], observedChangedPaths: [], gitChangedPaths: [] },
  )

  /**
   * ★★ 而 `PAIRS` 里每一条的两端都必须**真的不同**（再钉一次，针对清单本身）。
   */
  for (const pair of PAIRS) {
    assert.notDeepEqual(pair.writingA, pair.writingB, `★ "${pair.gateId}" 的两端不许逐字相同`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★★ 自证臂）：本清单**不会因为判据退役而静默失效**
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 5（自证臂）：清单引用的每个 id 都必须在注册表里 —— 否则那是数据腐烂', () => {
  /**
   * ── 这一臂是**本判据上一版的死因**（t77），所以它必须自己守着 ────────────────────
   *
   * MEASURED：上一版的两条 pair 都指向 `contract.task-atomicity`，而那条判据
   * **已被退役** ⇒ 三个臂长期红着，报的却是一句"它可能被改名或删除了"。
   * ★ 那条红是对的，而它红的原因与"写法"**无关** —— 是**数据腐烂**。
   *
   * ⇒ 本臂把"清单与注册表必须对得上"变成一条**显式**的断言：
   *   任何一条 pair 或 reason 指向不存在的判据 ⇒ 立刻红，且红里说清是**哪些**。
   */
  const ids = new Set(allGateIds())
  const referenced = [
    ...PAIRS.map((pair) => pair.gateId),
    ...NOT_CONSTRUCTIBLE.keys(),
  ]
  const stale = [...new Set(referenced)].filter((id) => !ids.has(id))
  assert.deepEqual(
    stale, [],
    '★★ 本清单引用了【不在注册表里】的判据 —— 数据腐烂了：\n  '
    + stale.map((id) => `${id}（在 PAIRS 或 NOT_CONSTRUCTIBLE 里，而注册表没有它）`).join('\n  ')
    + '\n   ⇒ 修法不是删掉那一行，而是**先弄清楚那条判据去哪了**'
    + '（退役？改名？）再决定：换成新的、还是把理由一起改掉。',
  )
})
