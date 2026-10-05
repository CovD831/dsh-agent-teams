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
/**
 * ★ 空注册表的语义要用一个**真的新建的空实例**表达，而不是借某个"当前恰好为空"
 *   的位置（见臂 3d 的注释：那会把临时状态写成不变量）。
 */
import { createGateRegistry, INSERTION_POINTS } from '../lib/gates/registry.js'

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
  // 反向校验：那四条【并行约定槽位】要么完整接上、要么完整缺席 —— 不许半接。
  /**
   * ★ 这里此前是「ALL_GATES 里出现约定表之外的绑定名 ⇒ 抛错」。它把一个**临时状态**
   *   当成了契约：那张表钉的是"四条并行判据谁改哪一行"，而 contract / delivery /
   *   runtime 三个位置的判据**本来就超出那张表**（本轮 t7/t8/t10 正是在往里加）。
   *   于是"有人绕过约定加了判据"与"有人往一个还没有约定的位置加了判据"在日志里同形
   *   —— 而后者恰恰是本轮的目标。
   *
   * ★ 改成：新位置的判据在下面的 NEW_POSITION_GATES 里【登记】即可，不禁止。
   *   这与 t11 的规则同源 —— **夹具不得把「某个位置当前为空」写成不变量，它测的
   *   应当是机制的形状（接了就该被跑到），不是当前的接线数量。**
   *
   * ★ 而"绕过约定"这一半并没有被丢掉：未登记的绑定名仍然抛错，只是合法的登记
   *   出口从"四条槽位表"扩到了"四条槽位表 + 新位置清单"。清单是显式的 ——
   *   往新位置接判据的人要在这里写一行，而不是悄悄塞进 ALL_GATES 就完事。
   */
  const known = new Set([...ASSEMBLY_PLACES.map((place) => place.binding), 'verifyRerun', 'changedPaths'])
  const listedButUnknown = [...state.source.matchAll(/^\s{2}([A-Za-z_][\w]*),$/gm)]
    .map((match) => match[1])
    .filter((binding) => !known.has(binding) && !NEW_POSITION_GATES.some((gate) => gate.binding === binding))
  if (listedButUnknown.length > 0) {
    throw new Error(
      `★ ALL_GATES 里出现了本文件不认识的绑定名：${listedButUnknown.join(', ')} —— 新位置的判据要在本文件的 NEW_POSITION_GATES 里登记（连同 id 与 point），`
      + '否则"接了判据"与"有人绕过装配点塞了一条"在日志里同形',
    )
  }
  return wired
}

/**
 * ── 新位置（contract / delivery / runtime）已接的判据 ──────────────────────────
 *
 * ★ 与 ASSEMBLY_PLACES 的分工：那张表是**四条并行判据的写域约定**（任务号 → 路径 →
 *   绑定名 → id → point），它管的是"谁改哪一行"。这张表是**新位置的接线登记**：
 *   t6 为三个位置建了调用点，t7/t8/t10 往里挂判据，而它们没有"一行一人"的原始约定。
 *
 * ★ 登记的意义不是形式主义：不登记 ⇒ 夹具无法区分"新位置接了一条判据"与
 *   "有人绕过装配点注册"。而本文件的臂 2/3/3d 正是靠这两张表断言
 *   "登记表里的每一条都能在装配点找到来源"。
 *
 * ★ 往这里加一行的人同时要保证：该判据真的会进对应 point 的求值（臂 3d 会核）。
 */
const NEW_POSITION_GATES = [
  { binding: 'buildArtifactScope', id: 'contract.build-artifact-scope', point: 'contract' },
  { binding: 'contractVerifyCommand', id: 'contract.verify-command', point: 'contract' },
  { binding: 'deliveryCoverage', id: 'delivery.coverage', point: 'delivery' },
  { binding: 'deliveryConvergence', id: 'delivery.convergence', point: 'delivery' },
]

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
  /**
   * ── 本轮（contract / delivery / runtime 三个空位置）的槽位 ─────────────────
   *
   * T10 已接：`contract.build-artifact-scope`（inScope 含 src/ 却漏 lib/ 产物）。
   * 其余两条（t7 = contract.verify-command、t8 = delivery.coverage）在各自任务里落，
   * 落之前它们**不在**这份表里 —— 于是"少了"与"表里没有"仍然不同形。
   */
  { task: 'T10', path: './contract/build-artifact-scope.ts', binding: 'buildArtifactScope', id: 'contract.build-artifact-scope', point: 'contract' },
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
  // 空位置与"接上了"不同形：**空位置才**必须是一条都没有。
  //
  // ★ MEASURED（2026-10-05，t10 接上 contract 位置的第一条判据时）：这一条此前写死
  //   「contract/delivery/runtime 三个位置至今没有任何判据」，于是**任何**往这三个
  //   位置接判据的任务都会把它撞红 —— 一条把"还没接"当不变量的断言，会在工作真正
  //   完成的那一刻变成障碍（棘轮）。⇒ 改成按【装配点源码】算期望：一个位置该有几条，
  //   由"约定表里已接的槽位数"决定，不由夹具手抄。空位置仍然必须如实为空。
  /**
   * ★ 新位置（contract / delivery / runtime）：条数由【装配点源码 + 新位置登记表】
   *   决定，不由夹具手抄。
   *
   *   MEASURED（2026-10-05，t10 接上 contract 位置第一条判据时）：这一段此前是
   *   「三个位置至今没有任何判据」，于是**任何**往这三个位置接判据的任务都会把它撞红。
   *   一条把"还没接"写成不变量的断言，恰好在工作真正完成的那一刻变成障碍 —— 那是棘轮。
   *
   *   ⇒ 现在它与 completion / dispatch 用同一条口径：期望条数 = 装配点里已接的条数。
   *     于是「空位置如实为空」与「接上了就得被看见」两件事同时成立，而**夹具不再
   *     需要有人去改它**：接一条，期望就 +1。
   */
  for (const point of ['contract', 'delivery', 'runtime']) {
    const entries = Object.entries(list).find(([name]) => name === point)?.[1] ?? []
    const expected = newPositionGateIds(point)
    assert.equal(
      entries.length,
      expected.length,
      `★ ${point} 位置该有 ${expected.length} 条（由装配点的 import + 清单 + NEW_POSITION_GATES 决定）；`
      + `空位置与"接上了"必须不同形，多一条少一条都要说得出为什么。实际：${JSON.stringify(entries.map((entry) => entry.id))}`,
    )
    for (const entry of entries) {
      assert.ok(
        expected.includes(entry.id),
        `★ ${point} 位置上出现了装配点清单之外的判据 ${entry.id} —— 它绕过了 src/gates/index.ts 那一份清单`,
      )
    }
    // 反向：登记了却没接上 ⇒ 也是一条说不清的差异。
    for (const id of expected) {
      assert.ok(
        entries.some((entry) => entry.id === id),
        `★ ${point} 位置登记了 ${id}，登记表里却没有它 —— 它被"接上了"却没进装配点`,
      )
    }
  }
  assert.equal(
    registry.count('completion'),
    1 + countFromPlaces('completion'),
    '★ completion 的条数必须等于"既有 verify-rerun + 已接槽位"，多一条少一条都要说得出为什么',
  )
  assert.equal(registry.count('dispatch'), 1 + countFromPlaces('dispatch'))
})

/**
 * 某个新位置【应该】有几条、分别是哪几条 —— 从装配点源码与 NEW_POSITION_GATES 推。
 *
 * ★ 口径与 `wiredPlaces()` 一致：**登记的绑定名必须同时被 import 且进了 ALL_GATES**，
 *   否则"登记了但没接上"会被算成已接（而那正是"装了但调不到"的静态版本）。
 */
function newPositionGateIds(point) {
  const state = wiringState()
  return NEW_POSITION_GATES
    .filter((gate) => gate.point === point)
    .filter((gate) => state.isImported(gate.binding) && state.isListed(gate.binding))
    .map((gate) => gate.id)
    .sort()
}

/**
 * ── 对照臂（臂 3）：真实的装配点 ─────────────────────────────────────────────
 */
test('臂 3 ★ 对照臂：登记表里每一条判据都用【同一条装配路径】装配，且形状齐备', () => {
  const list = registry.list()
  const entries = Object.values(list).flat()
  const known = [
    'completion.verify-rerun',
    'dispatch.changed-paths',
    ...ASSEMBLY_PLACES.map((place) => place.id),
    ...NEW_POSITION_GATES.map((gate) => gate.id),
  ]

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
  //
  // ★ MEASURED（2026-10-05，t10 落 contract 位置时）：这里原先把槽位注释的**行数**
  //   与约定表**数组**做了 deepEqual，于是往表里加一条槽位（而不在 ALL_GATES 里
  //   手写那一行注释）会让它红 —— 而"表里多了一条槽位"本来正是接入面在扩大的
  //   表现。⇒ 改成【逐条断言】：约定表里的每个槽位都必须在源码里有一条对应的
  //   `// T? ——— 已接：<binding>`，多出来的槽位不许沉默（要么注释、要么别进表）。
  const placeholders = [...state.source.matchAll(/^\s*(?:\*|\/\/) (T\d+) ——— (待接|已接)：([A-Za-z_][\w]*)/gm)]
    .map((match) => [match[1], match[3]])
  for (const place of ASSEMBLY_PLACES) {
    assert.ok(
      placeholders.some(([task, binding]) => task === place.task && binding === place.binding),
      `★ 约定表里的槽位 ${place.task}（${place.binding}）在装配点源码里没有对应的注释槽位 `
      + `（写成 \`// ${place.task} ——— 已接：${place.binding}\`）—— 一条只活在夹具里的槽位，读源码的人看不见`,
    )
  }
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
  const built = buildRegistry()
  /**
   * ★ 这里此前用 `evaluate('delivery', {})` —— delivery 位置当时是空的，于是
   *   "ran 为空"成立。t8/t11 把两条 delivery 判据接上之后，同一次求值里它们会
   *   （按各自 appliesTo 被）跳过一次，ran 就不再为空。
   *
   *   实测的教训（2026-10-05，t11）：**不要用一个"当前恰好为空"的位置去表达
   *   "空注册表放行"**。那会把临时状态写成不变量 —— 接一条判据就红，而红的原因
   *   与"有人偷偷注册"毫无关系。空注册表的语义用一个**真的新建的空实例**表达，
   *   与任何位置当前接了什么都无关。
   */
  const fresh = createGateRegistry()
  for (const point of INSERTION_POINTS) {
    const verdict = await fresh.evaluate(point, {})
    assert.equal(verdict.ok, true, `★ 空注册表在 ${point} 必须放行`)
    assert.deepEqual(verdict.ran, [], '★ 空注册表放行，且 ran 为空 —— 不是"跑了一条什么都对的判据"')
    assert.equal(verdict.registered, 0, '★ 空注册表：registered=0（空位置与"全跳过"不同形）')
  }
  // 进程级单例与新建的注册表必须是同一份清单的两个实例（否则编排层读到的不是这份清单）
  assert.deepEqual(
    built.list(),
    registry.list(),
    '★ registry 单例与 buildRegistry() 必须同源 —— 否则"接上了"与"编排层读到了"会不同形',
  )
  /**
   * ★ 已接的每一条都要能被 evaluate 真的跑到（注册 ≠ 会被求值：point 挂错位置
   *   就是这种失败）。**四条并行槽位与新位置的判据都走这一条** —— 它测的是
   *   机制的形状（接了就该被跑到），不是当前的接线数量。
   */
  const wiredEntries = [
    ...ASSEMBLY_PLACES.filter((place) => wiredPlaces().has(place.task)),
    ...NEW_POSITION_GATES.filter((gate) => {
      const state = wiringState()
      return state.isImported(gate.binding) && state.isListed(gate.binding)
    }),
  ]
  for (const place of wiredEntries) {
    const ran = await built.evaluate(place.point, undefined)
    assert.ok(
      ran.ran.some((entry) => entry.id === place.id),
      `★ ${place.id} 接了却没在 ${place.point} 的求值里出现 —— 它被注册到了一个永不被跑的位置`,
    )
  }
})
