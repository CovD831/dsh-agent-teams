/**
 * ── 判据装配点（`src/gates/index.ts`）的三臂夹具 ────────────────────────────────
 *
 * 这是契约要求的那三臂（`docs/GATE-REGISTRY.md` §6），只不过被测的不是一条判据的
 * 语义，而是【装配点本身】—— 四条并行判据要落进来，装配点错了的表现是：
 * 一条判据**看起来接上了、其实没接上**（或反过来，接上了两条一样的）。
 *
 *   臂 1（伪造臂）：一个缺导出 / 非法 appliesTo 的模块
 *                    ⇒ 期望装配【当场抛错】，而不是静默地少一条判据
 *   臂 2（未测量臂）：一个还没接上的槽位（注释占位 / 缺席的模块）
 *                    ⇒ 期望它与"接上了"【不同形】，且不产出半条判据
 *   臂 3（对照臂）：正常的装配点
 *                    ⇒ 期望现有两条判据的元数据与契约里写的一致、且真的会开火
 *
 * ── 它防的是什么失效（MEASURED / 可复现）───────────────────────────────────────
 *
 * ① 【静默丢弃】：装配循环里判据模块是 `import * as` 的袋子。一个模块若把
 *    `appliesTo` 写成非函数（例如 `export const appliesTo = true`），
 *    `typeof module.appliesTo === 'function'` 为假 ⇒ 它被丢掉，而 register()
 *    看不见这次丢弃（它只校验它【读到】的字段）⇒ 一条本该只对
 *    implementation/repair 生效的判据，会变成对 review 也生效并开始乱拒。
 *    这在日志里与"这条判据就是这样"完全同形。
 *
 * ② 【有 0 个读者的约定】：四条并行判据的模块路径 / 导出名 / id / point 是本轮
 *    唯一的跨人约定（写在 index.ts 的注释里）。注释写错了没有任何东西会响 ——
 *    所以这里钉住"约定确实被写下来了"，而不是钉住"某个人的实现对不对"。
 *
 * ★ 这里【不】import 那四条判据（它们还不存在）。缺模块是"未接"，不是"失败"：
 *   把还没写的判据当成测试失败，会逼人写假夹具来让测试变绿。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRegistry, registry } from '../lib/gates/index.js'

/** 本仓库根（夹具要读源文件，import 的是编译产物 —— 与现有 24 个测试同构）。 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8')

/**
 * ── 从【装配点源码】读出"哪几个槽位真的接上了" ──────────────────────────────────
 *
 * ★ 为什么不用手抄的常量：手抄的那份会在别人接槽位时过期，于是夹具要么按设计变红
 *   （棘轮，会阻塞所有人），要么被迫删掉。改从源码读之后，夹具对"接上的槽位"是
 *   【断言形状】而不是【断言数量】—— 数量由被测量的树枝决定，不由夹具决定。
 *
 * ★ 判据的状态只有两个来源，不用第三个：import 行在不在（binding 是否已绑定）
 *   + ALL_GATES 里有没有它。注释只是给人看的转述，它由臂 3b 单独钉住。
 */
function wiringState() {
  const source = read('src/gates/index.ts')
  const listBody = source.match(/const ALL_GATES = \[([\s\S]*?)\] as const/)?.[1]
  if (listBody === undefined) {
    throw new Error('★ 装配锚点失效：src/gates/index.ts 里找不到 `const ALL_GATES = [...] as const` —— 夹具必须跟着看清新形状，而不是静默变成一条恒真的断言')
  }
  const listed = new Set([...listBody.matchAll(/^\s{2}([A-Za-z_][\w]*),$/gm)].map((match) => match[1]))
  return {
    source,
    /** 某个导出名是否真的进了注册清单。 */
    isListed: (binding) => listed.has(binding),
    /** 某个导出名是否被 import 绑定过（无论有没有进清单）。 */
    isImported: (binding) => new RegExp(`^import \\* as ${binding} from '`, 'm').test(source),
  }
}

/** 装配点里【声明已接】的槽位任务号集合。 */
function wiredPlaces() {
  const state = wiringState()
  const wired = new Set()
  for (const place of ASSEMBLY_PLACES) {
    if (!state.isImported(place.binding)) continue
    if (!state.isListed(place.binding)) continue
    wired.add(place.task)
  }
  // 反向校验：ALL_GATES 里出现了约定之外的绑定名 ⇒ 有人绕过约定加了判据。
  const known = new Set([...ASSEMBLY_PLACES.map((place) => place.binding), 'verifyRerun', 'changedPaths'])
  const listedButUnknown = [...state.source.matchAll(/^\s{2}([A-Za-z_][\w]*),$/gm)]
    .map((match) => match[1])
    .filter((binding) => !known.has(binding))
  if (listedButUnknown.length > 0) {
    throw new Error(`★ ALL_GATES 里出现了约定表之外的绑定名：${listedButUnknown.join(', ')} —— 加判据要走四条并行约定的那一行，否则冲突面会重新扩散`)
  }
  return wired
}

/** 登记表里某条判据挂在哪。 */
function registeredPointOf(id, list) {
  return Object.entries(list).find(([, entries]) => entries.some((entry) => entry.id === id))?.[0]
}

/** 已接槽位里挂在某个位置上的条数（与 count() 相减用）。 */
function countFromPlaces(point) {
  return ASSEMBLY_PLACES.filter((place) => place.point === point && wiredPlaces().has(place.task)).length
}

/** 约定表里 id → task 的反查（用于"少了一条"的归属判断）。 */
function taskOf(id) {
  return ASSEMBLY_PLACES.find((place) => place.id === id)?.task
}

/**
 * 注册表库本身。★ 显式地读出来 —— 臂 1b/1c 要证明的是【注册表】的行为，
 * 而它们同时也是"装配层为什么必须自己校验"的依据。
 */
async function registryLibrary() {
  return import('../lib/gates/registry.js')
}

/**
 * ★ 本轮四条并行判据的【约定表】—— 唯一权威副本在 `src/gates/index.ts` 的注释里。
 *   这里把它抄成数据，是为了让"注释被改坏"能被自动发现。
 */
const ASSEMBLY_PLACES = [
  { task: 'T1', path: './dispatch/worktree.ts', binding: 'worktree', id: 'dispatch.worktree', point: 'dispatch' },
  { task: 'T2', path: './completion/r5.ts', binding: 'r5', id: 'completion.r5', point: 'completion' },
  { task: 'T3', path: './completion/mutation.ts', binding: 'mutation', id: 'completion.mutation', point: 'completion' },
  { task: 'T4', path: './completion/backtest.ts', binding: 'backtest', id: 'completion.backtest', point: 'completion' },
]

/** 一个最小的、合法的判据模块（对照臂用）。 */
function goodModule(overrides = {}) {
  return {
    id: 'completion.placeholder',
    point: 'completion',
    description: '占位判据',
    gate: () => ({ ok: true }),
    ...overrides,
  }
}

/**
 * ── 臂 1（伪造臂）：判据模块少一个导出 ⇒ 装配时就抛错 ─────────────────────────
 *
 * ★ 这一臂走【真实的装配路径】，不是在生产代码里开一个只给测试用的口子。
 *   路径：src/gates/index.ts ──tsc──▶ lib/gates/index.js ──把一个合法模块
 *   的 `gate` 字段删掉（模拟"少一个导出"）──▶ 真实的装配校验读它。
 *   四条判据接进来时走的是【同一条】。
 */
function expectThrow(label, fn) {
  try {
    fn()
  } catch (error) {
    return String(error?.message ?? error)
  }
  throw new Error(`expected a throw, but it returned normally: ${label}`)
}

test('臂 1 ★ 伪造臂：判据模块缺 gate ⇒ 装配校验当场抛错，并指名缺的是哪一件', async () => {
  const { asRegistration } = await import('../lib/gates/index.js')
  assert.equal(typeof asRegistration, 'function', '★ 装配校验必须是可测的一个纯函数，而不是埋在循环里')
  const message = expectThrow('missing gate', () => asRegistration({ ...goodModule(), gate: undefined }))
  assert.match(message, /gate/, '★ 报错必须指名缺的是哪一件')
  assert.match(message, /id, point, description and gate/, '★ 报错必须说清一条判据模块要交几个名字')
  // 顺带：合法的模块必须原样通过（否则这条校验就是"在乱拒"）
  assert.equal(asRegistration(goodModule()).id, 'completion.placeholder')
})

test('臂 1b ★ 伪造臂：非函数 appliesTo ⇒ 装配抛错，而不是被静默丢掉', async () => {
  /**
   * ★ 先钉住"装配层不管会发生什么"：把非函数 appliesTo 交给【注册表】，它不报错 ——
   *   register() 只读 `typeof appliesTo === 'function'` 这个判断，非函数直接落进
   *   false 分支 ⇒ 字段被丢掉，且没有任何记录。MEASURED：`hasAppliesTo: false`，
   *   与"这条判据本来就没有 appliesTo"完全同形。
   */
  const { createGateRegistry } = await registryLibrary()
  const r = createGateRegistry()
  const forged = { ...goodModule(), appliesTo: true }
  r.register({ ...forged, ...(typeof forged.appliesTo === 'function' ? { appliesTo: forged.appliesTo } : {}) })
  assert.equal(
    r.list().completion[0].hasAppliesTo,
    false,
    '★ MEASURED：非函数 appliesTo 被静默丢掉 —— 一条只对某些 kind 生效的判据会变成对全部 kind 生效，而日志里看不出',
  )
  // 装配层必须把这件事变回一个【当场可见】的错误。
  const { asRegistration } = await import('../lib/gates/index.js')
  const message = expectThrow('non-function appliesTo', () => asRegistration(forged))
  assert.match(message, /appliesTo/, '★ 报错必须指名是哪个字段')
  assert.match(message, /not a function/)
  // 对照：函数形态（哪怕返回 false）必须原样通过 —— 校验只拦形状，不拦语义。
  assert.equal(typeof asRegistration(goodModule({ appliesTo: () => false })).appliesTo, 'function')
})

test('臂 1c ★ 伪造臂：id 撞车 ⇒ 抛错（"我换了一条"与"两条都在、后一条赢了"不可同形）', async () => {
  const { createGateRegistry } = await registryLibrary()
  const r = createGateRegistry()
  r.register({ ...goodModule(), gate: () => ({ ok: true }) })
  assert.throws(
    () => r.register({ ...goodModule(), description: '另一条', gate: () => ({ ok: false, blockers: ['x'] }) }),
    /already registered/,
    '★ 四条并行判据共用一份清单 ⇒ id 撞车必须在装配时就炸，而不是让先注册的那条静默失效',
  )
})

test('臂 1d ★ 伪造臂：gate 不是函数 ⇒ 抛错（否则"装上了但裁决不了"）', async () => {
  const { asRegistration } = await import('../lib/gates/index.js')
  const message = expectThrow('gate:true', () => asRegistration({ ...goodModule(), gate: true }))
  assert.match(message, /"gate"/, '★ 报错必须指名是哪个导出')
  assert.match(message, /not a function/)
  assert.match(message, /completion\.placeholder/, '★ 报错必须指名是哪个模块 —— 四条并行时"哪一条"就是全部信息')
  // 连 id 都缺的时候也要说得出话（不能只说一个空字符串）
  assert.match(
    expectThrow('no id', () => asRegistration({ point: 'dispatch', description: 'd', gate: () => ({ ok: true }) })),
    /\(a gate module\) does not export id/,
  )
})

/**
 * ── 臂 2（未测量臂）：槽位的两种状态必须【不同形】─────────────────────────────
 *
 * ★ 一条「接上了」的判据与一条「没接上」的判据，在登记表里的形状必须不同：
 *   已接 ⇒ 出现且 id/point/描述齐备；未接 ⇒ 【不出现】。
 *
 * ★ 为什么两条都要断言：只断言"未接的确实缺席"的话，一个把【已接的也报成未接】
 *   的实现会全绿 —— 而那正好是本节要防的失效（把"没接上"与"接上了"读成同一件事）。
 *   所以 【已接集合 ∪ 未接集合 == 约定表的四项】 必须被钉住。
 *
 * ★ 棘轮已拆除（2026-10-05，t7 收口）：此前这一臂断言"四条槽位都没接"，任何人
 *   接上一个槽位它就按设计变红。现在它从【装配点源码】读出实际状态，于是无论
 *   四条接了几条都成立 —— 除非有人漏接、或接上后形状不对。
 */
test('臂 2 ★ 未测量臂：已接的槽位形状对、未接的槽位确实缺席（两者不同形）', () => {
  const list = registry.list()
  /** 登记表里【真的存在】的判据（id → 条目），与装配点的源码状态无关。 */
  const registered = new Map(Object.values(list).flat().map((entry) => [entry.id, entry]))
  /** 装配点里【声明已接】的槽位（从源码读，不经手抄）。 */
  const wired = wiredPlaces()

  for (const place of ASSEMBLY_PLACES) {
    const entry = registered.get(place.id)
    if (wired.has(place.task)) {
      assert.ok(entry, `★ ${place.task} 在装配点里声明已接（${place.binding} 已进 ALL_GATES），登记表里就必须有 ${place.id}`)
      assert.equal(entry.id, place.id, `★ ${place.task} 接上的必须是约定表里的那个 id`)
      assert.equal(
        registeredPointOf(place.id, list),
        place.point,
        `★ ${place.task} 的 point 必须是 ${place.point} —— 挂错位置等于它永不被求值（位置才是流程的形状）`,
      )
      assert.ok(entry.description.trim().length > 0, `★ ${place.task} 的描述为空 ⇒ 控制台上看不见这条判据装了没有`)
      assert.equal(
        entry.hasAppliesTo,
        true,
        `★ ${place.task} 的判据要按 kind 收窄（见各判据的 appliesTo）；这里为 false 说明它落进了"对全部 kind 生效"那条静默路径`,
      )
    } else {
      assert.equal(entry, undefined, `★ ${place.task} 在装配点里还是注释占位，登记表里就不该有 ${place.id}`)
    }
  }

  /**
   * ★ 锚点：约定表的四项必须被【完全划分】成已接/未接两类，没有第三态。
   *   一个把已接槽位读成未接的实现（或反过来）会在这里红。
   */
  const wiredInContract = ASSEMBLY_PLACES.filter((place) => wired.has(place.task)).map((place) => place.task)
  assert.deepEqual(
    [...wired].sort(),
    wiredInContract.sort(),
    '★ 装配点里出现了一个不在约定表里的槽位（或漏了一个）—— 四条并行唯一的跨人约定被改动了',
  )

  // 探针/占位判据绝不进真实注册表。
  assert.deepEqual(
    [...registered.keys()].filter((id) => id.includes('placeholder') || id.startsWith('probe')),
    [],
    '★ 探针/占位判据不得出现在真实注册表里',
  )
  // 空位置与"接上了"不同形：contract/delivery/runtime 至今没有任何判据。
  for (const point of ['contract', 'delivery', 'runtime']) {
    const entries = Object.entries(list).find(([name]) => name === point)?.[1] ?? []
    assert.deepEqual(entries, [], `★ ${point} 位置如实为空 —— 空位置与"接上了"必须不同形`)
  }
  assert.equal(
    registry.count('completion'),
    1 + countFromPlaces('completion'),
    '★ completion 的条数必须等于"既有 verify-rerun + 已接槽位"，多一条少一条都要说得出为什么',
  )
  assert.equal(registry.count('dispatch'), 1 + countFromPlaces('dispatch'))
})

/**
 * ── 对照臂（臂 3）：真实的装配点 ─────────────────────────────────────────────
 */
test('臂 3 ★ 对照臂：登记表里每一条判据都用【同一条装配路径】装配，且形状齐备', () => {
  const list = registry.list()
  const entries = Object.values(list).flat()
  const known = ['completion.verify-rerun', 'dispatch.changed-paths', ...ASSEMBLY_PLACES.map((place) => place.id)]

  /**
   * ★ 不钉死 count，钉【归属】：登记表里出现的每一条，必须是"既有两条 + 约定表四条"
   *   之一。多了 ⇒ 有人绕过装配点注册（编排层将读到一份不是这份清单的东西）；
   *   少了 ⇒ 有人把判据摘掉了。
   */
  assert.deepEqual(
    entries.map((entry) => entry.id).filter((id) => !known.includes(id)),
    [],
    '★ 出现了不在装配清单里的判据 —— 加判据要走 gates/index.ts 的清单，不是别处',
  )
  for (const id of known) {
    assert.ok(
      entries.some((entry) => entry.id === id) || !wiredPlaces().has(taskOf(id)),
      `★ ${id} 既不在登记表里、也没在装配点声明未接 —— 它就这样消失了`,
    )
  }

  assert.deepEqual(
    Object.keys(list),
    ['contract', 'dispatch', 'completion', 'delivery', 'runtime'],
    '★ 五个位置都要出现（空位置也是），否则控制台看不出哪个位置还没接',
  )
  for (const entry of entries) {
    assert.ok(entry.description.trim().length > 0, '★ 描述是控制台渲染的东西：空描述 = 看不见这条判据装了什么')
  }
})

test('臂 3b ★ 对照臂：三条 completion 判据会同一次求值一起跑 ⇒ 顺序必须是钉住的', () => {
  const state = wiringState()
  /**
   * ★ 顺序是三条 completion 判据唯一共享的东西：它们在同一位置 ⇒ 同一次
   *   evaluate 里一起跑。这里断言的是【ALL_GATES 的真实书写顺序】，不是注释位置。
   *
   * ★ 只对【已接】的三条断言：把还没接的拼成 'r5, mutation, backtest' 是把夹具
   *   变成一个棘轮（一接就红）。但在位的必须相对有序 —— 这才是可执行的约定。
   */
  const listBody = state.source.match(/const ALL_GATES = \[([\s\S]*?)\] as const/)?.[1] ?? ''
  assert.notEqual(listBody, '', '★ 装配锚点失效：ALL_GATES 的形状变了，夹具必须跟着看清它')
  const listed = [...listBody.matchAll(/^\s{2}([A-Za-z_][\w]*),$/gm)].map((match) => match[1])
  const wiredInOrder = listed.filter((binding) => ['r5', 'mutation', 'backtest'].includes(binding))
  const canonical = ['r5', 'mutation', 'backtest'].filter((binding) => wiredInOrder.includes(binding))
  assert.deepEqual(
    wiredInOrder,
    canonical,
    '★ 已接的 completion 判据必须按 r5 → mutation → backtest 的相对顺序落表（先机械重跑，后起进程）',
  )
  // 与位置无关地钉住"先机械、后最贵"这条意图：backtest 不许插到任何一条机械判据前面。
  for (const binding of ['r5', 'mutation']) {
    if (!wiredInOrder.includes(binding)) continue
    assert.ok(
      wiredInOrder.indexOf(binding) < wiredInOrder.indexOf('backtest') || !wiredInOrder.includes('backtest'),
      `★ ${binding} 必须排在 backtest 之前`,
    )
  }
  // 注释槽位必须与真实清单一一对应：不然"注释说已接、代码没接"会无人发现。
  const placeholders = [...state.source.matchAll(/^\s*\/\/ (T\d) ——— (待接|已接)：(\w+)$/gm)]
  assert.deepEqual(
    placeholders.map((match) => [match[1], match[3]]),
    ASSEMBLY_PLACES.map((place) => [place.task, place.binding]),
    '★ 登记表里的四行槽位（一人一行）就是求值顺序与归属的唯一约定',
  )
  // ★ 注释与代码不许打架：注释说「已接」而清单里没有（或反过来）是最坏的一种，
  //   因为它让"接上了"与"没接上"在给人看的那一面同形。
  for (const [task, , binding] of placeholders.map((match) => [match[1], match[2], match[3]])) {
    const claimsWired = state.source.includes(`// ${task} ——— 已接：${binding}`)
    assert.equal(
      state.isListed(binding),
      claimsWired,
      `★ ${task}/${binding} 的注释与 ALL_GATES 不一致：注释说${claimsWired ? '已接' : '未接'}，清单里${state.isListed(binding) ? '有' : '没有'}它`,
    )
  }
})

test('臂 3c ★ 对照臂：约定表（路径 / 导出名 / id / point）确实写在装配点里', () => {
  const source = read('src/gates/index.ts')
  for (const place of ASSEMBLY_PLACES) {
    assert.ok(
      source.includes(`import * as ${place.binding} from '${place.path}'`),
      `★ ${place.task} 的 import 槽位必须写死在装配点里（导出名 ${place.binding}）`,
    )
    assert.ok(source.includes(place.id), `★ ${place.task} 的 id ${place.id} 必须写死在装配点里`)
    const pair = new RegExp(`id = '${place.id.replace('.', '\\.')}' · point = '${place.point}'`)
    assert.ok(pair.test(source), `★ ${place.task} 的 id 与 point 必须成对写死（写错 point 会撞上 unknown insertion point）`)
  }
  // 一个人一行、互不越界：别名必须互不相同，否则两个人会在同一条 import 行上冲突。
  const bindings = ASSEMBLY_PLACES.map((place) => place.binding)
  assert.equal(new Set(bindings).size, bindings.length, '★ import 绑定名是冲突面，必须互不相同')
})

test('臂 3d ★ 对照臂：登记表是装配点里【唯一】的清单（没有人偷偷在别处注册）', async () => {
  const empty = buildRegistry()
  const verdict = await empty.evaluate('delivery', {})
  assert.equal(verdict.ok, true)
  assert.deepEqual(verdict.ran, [], '★ 空位置放行，且 ran 为空 —— 不是"跑了一条什么都对的判据"')
  // 进程级单例与新建的注册表必须是同一份清单的两个实例（否则编排层读到的不是这份清单）
  assert.deepEqual(
    empty.list(),
    registry.list(),
    '★ registry 单例与 buildRegistry() 必须同源 —— 否则"接上了"与"编排层读到了"会不同形',
  )
  // 已接的每一条都要能被 evaluate 真的跑到（注册 ≠ 会被求值：point 挂错位置就是这种失败）。
  for (const place of ASSEMBLY_PLACES) {
    if (!wiredPlaces().has(place.task)) continue
    const ran = await empty.evaluate(place.point, undefined)
    assert.ok(
      ran.ran.some((entry) => entry.id === place.id),
      `★ ${place.task} 接了却没在 ${place.point} 的求值里出现 —— 它被注册到了一个永不被跑的位置`,
    )
  }
})
