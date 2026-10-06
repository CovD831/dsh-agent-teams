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
import { buildRegistry, registry, gateModuleViews, asRegistration } from '../lib/gates/index.js'
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
  /**
   * ★ t6：runtime 位置的第一条判据。它的 point 是 `runtime` —— 而 runtime 是
   *   【过程约束】，它的 blocked 不进裁决（契约 §5）。这一点不影响登记表的形状：
   *   登记问的是"它装在哪个位置、会不会被求值"，而"裁决算不算数"是调用方的事。
   */
  { binding: 'runtimeLiveness', id: 'runtime.liveness', point: 'runtime' },
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

test('臂 1e ★ 伪造臂：`requires` 声明必须被装配层【原样转发】，不许被白名单吃掉', async () => {
  /**
   * ── MEASURED（2026-10-06，t3 = dispatch 位置的接线任务）────────────────────────
   *
   * 判据文件写了 `export const requires = [...]`，`requires.ts` 的核对层也建好了，
   * 而 `asRegistration` 只转发 id/point/description/gate/appliesTo ⇒
   * `registry.list()` 里 **`hasRequires: false`**，于是"这条判据声明过输入面"
   * 与"它压根没声明"读起来一模一样。
   *
   * ★ 形状与前五次同形问题完全一致：**声明写对了、机制也建好了、而中间那个
   *   白名单没列它**。所以这条臂必须问【装配层】，不能只问判据模块 ——
   *   后者在缺陷存在时照样是绿的。
   *
   * ★ 修法的边界：`appliesTo` 的缺席必须继续是"不转发"（那是可选格，缺省 =
   *   全部适用），而 `requires` 的缺席必须是"不转发但可读为没声明"。两者都
   *   不许被编成空数组 —— 空数组的语义是"声明过、不需要任何一格"，完全不同。
   */
  const { asRegistration, createGateRegistry } = await import('../lib/gates/index.js')

  const forwarded = asRegistration(goodModule({ requires: ['task.kind'] }))
  assert.deepEqual(forwarded.requires, ['task.kind'], '★ 声明必须原样穿过装配层')
  assert.deepEqual(
    asRegistration(goodModule()).requires,
    undefined,
    '★ 没声明 ⇒ 不许被编成空数组（"还没写"与"不需要"不同形，见 requires.ts）',
  )
  assert.deepEqual(
    asRegistration(goodModule({ requires: [] })).requires,
    [],
    '★ 而声明了空数组要保留下来 —— 那是一条【有内容的】声明',
  )

  // 端到端：走真实注册表，`list()` 上读得到（控制台的数据源）
  const r = createGateRegistry()
  r.register(asRegistration(goodModule({ requires: ['task.kind'] })))
  r.register({ ...goodModule(), id: 'completion.undeclared' })
  assert.equal(r.list().completion[0].hasRequires, true, '★ 控制台要读得出"声明过输入面"')
  assert.deepEqual(r.list().completion[0].requires, ['task.kind'])
  assert.equal(r.list().completion[1].hasRequires, false, '★ 没声明与声明了空数组不同形')

  // 而【真实装配清单】里已经声明过的判据，一个都不许在路上丢掉
  const { registry } = await import('../lib/gates/index.js')
  const lost = Object.values(registry.list()).flat()
    .filter((entry) => entry.requires !== undefined && !entry.hasRequires)
    .map((entry) => entry.id)
  assert.deepEqual(lost, [], '★ 声明了 requires 却读成"没声明" ⇒ 装配层又把某一条吃掉了')
  const declared = Object.values(registry.list()).flat().filter((entry) => entry.hasRequires).map((entry) => entry.id)
  assert.ok(
    declared.length >= 2,
    `★ 至少 dispatch 位置的两条要声明了（t3 的产物）；实际读到 ${declared.length} 条：${declared.join(', ')}`,
  )
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

/**
 * ── 臂 3e/3f/3g：集成收口（t4）—— 新判据第一次上线时，那件【不要写在这里】的事 ──
 *
 * 契约对刚上线的判据有一条要求：**先在观察模式下跑一轮**（只记录、不拒绝）。
 * 落到装配点上，最自然的写法是在 `src/gates/index.ts` 里加一句
 *
 *     registry.observe('runtime.liveness', { reason: 'first deployment' })
 *
 * ★ 那是错的，而且不是风格问题：**写下去之后，观察期在生产里等于没有**。
 *   两个时刻的时序（臂 3e 把它测成一条可执行的断言）：
 *     · `export const registry = buildRegistry()` 在**模块加载时**就建好了；
 *     · 插件 `apply()` 在**之后**才跑，守卫与调度器的安装也都在那之后。
 *   ⇒ 观察期只活在"加载完成"与"`apply()` 跑完"之间那个没有调用者的窗口里 ——
 *     而那个窗口在生产里不存在（谁也不会在第一行 import 与 apply 之间插一手）。
 *   注册表 §3.5 决定 ② 早就把这条读法否掉了，原话是「观察集是**运行时数据**，
 *   不是注册字段」，理由正是本队实测过的那条：改代码 → 漏了 build →
 *   装的位置跑的是旧代码。
 *
 * ⇒ 观察开关有两个**已经存在**的入口，装配点一个都不该加：
 *     · `AGENT_TEAMS_OBSERVE_GATES=runtime.liveness`（部署改动，不改代码）；
 *     · `registry.observe(id, { reason })`（运行时调用，改这一次运行）。
 *   3e 钉"装配点里没有第三句话"，3g 钉"那两个入口真的能开"。
 */

/** 装配点源码里真的出现的 `registry.observe(...)` / `.unobserve(...)`（注释里提到它不算）。 */
function observeCallsInAssembly() {
  const withoutComments = wiringState().source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  return [...withoutComments.matchAll(/\bregistry\s*\.\s*(?:un)?observe\s*\(/g)].map((match) => match[0])
}

test('臂 3e ★ 集成臂：装配点【不】写死观察开关 —— 观察期是运行时数据，写进清单就等于没有观察期', () => {
  /**
   * ★ MEASURED（可复现）：把 `registry.observe('runtime.liveness')` 写进装配点之后，
   *   两件事同时发生，而它们在日志里完全同形：
   *     · 单例的观察集被**产品**改过了 —— 夹具想清场只能 `unobserve()`，
   *       于是清场清掉的是产品写下的那一句，"观察期生效"与"被夹具关掉"分不开；
   *     · 观察期的时间窗 = import 与 apply 之间 —— 生产里没有夹在中间的人。
   */
  assert.deepEqual(
    observeCallsInAssembly(),
    [],
    '★ 装配点里出现了 registry.observe(...) / unobserve(...)：观察开关走 AGENT_TEAMS_OBSERVE_GATES 或运行时调用，'
    + '不要写进这一份清单 —— 单例在模块加载时就建好了，写在这里的观察期到 apply() 之前就结束（等于没有），'
    + '而夹具随后 unobserve() 清掉的正是这一句，于是"观察生效"与"被夹具关掉"同形',
  )

  /**
   * ★ 反向的一半（缺了它这条断言是恒真的）：**在有人要求它观察的时候，装配点仍然
   *   不许自己多写这一句**。"没人观察时才干净"测不出上面那个缺陷 —— 缺陷恰恰是在
   *   "配置要它观察"的时候被写下去的。
   */
  const observing = createGateRegistry({ observeFromEnv: 'runtime.liveness' })
  assert.deepEqual(
    observeCallsInAssembly(),
    [],
    '★ 观察名单生效时装配点更不该自己写 observe —— 那会让"配置要它观察"与"清单写死它观察"同形',
  )
  assert.equal(
    observing.isObserving('runtime.liveness'),
    true,
    '★ 对照：一份真的带观察名单的注册表，它的观察状态来自**配置**（装配点一个字没改）',
  )
})

/** 真实判据模块的产物路径（与臂 1/1d 一样，走 `lib/`，不碰源码）。 */
const LIVENESS_MODULE = '../lib/gates/runtime/liveness.js'

/** 「开火了」的那份上下文：两个探活的最后活动时刻相同 ⇒ 判据会告警。 */
function stuckContext() {
  return {
    event: 'runtime-liveness',
    task: { id: 't1', assignee: 'worker' },
    wait: {
      now: 1_000_000 + 600_000,
      startedAt: 1_000_000,
      lastActivityAt: 5,
      previousPollAt: 1_000_000,
      previousLastActivityAt: 5,
    },
  }
}

test('臂 3f ★ 集成臂：runtime 上"观察模式"与"不拒绝流程"是双保险 —— 放行的是同一组裁决，而告警没有被吃掉', async () => {
  /**
   * ★ 本臂回答一个**只能实测**的问题：这条判据第一次上线，契约要求它在观察模式
   *   下跑一轮；而 runtime 位置本来就有硬要求"不得拒绝任务"。两者同时生效时谁说话？
   *
   *   ★ 先把一格看清：`registry.evaluate('runtime', …)` 的返回值在任何情况下都只是
   *     数据 —— 要不要据此拒绝由调用方决定（`src/tools.ts` 的 `evaluateRuntimeGates`
   *     对 runtime 只记一行日志）。所以这里"观察模式放行的不是流程"，而是**这一格
   *     自己的裁决字段**：
   *       · 平时：   开火 ⇒ `ok:false` + `blockers:[原文]`
   *       · 观察中： 开火 ⇒ `ok:true`  + `blockers:[]` + `observed.blockers:[原文]`
   *     两者对流程的影响都是零（这就是"双保险"），但**读日志的人**读到的东西不同 ——
   *     而本队已经栽过一次「把没测到并进通过」，所以这里钉的是：观察期里那条告警
   *     仍然在返回值里，没有被观察开关吃掉。
   *
   *   ⇒ 四组读数两两不同形，缺任何一组，别的组都会退化成恒真。
   */
  const context = stuckContext()

  /**
   * ① 不适用 ⇒ 判据没跑。它与"跑了、没发现问题"必须不同形。
   *
   * ★ 这里【不】硬编码一个"肯定不适用"的事件名：V3-1 的修复正是**在改那份事件
   *   白名单**（`appliesTo` 从只认 `runtime-liveness` 改成按 `LIVENESS_EVENTS`
   *   收窄），硬编码就会把别人的一次正当修改读成"我这里红了"。⇒ 从判据自己
   *   导出的白名单里**推**一个不适用的事件，测的是机制（不适用的事件不许被求值），
   *   不是某一份名单当前的成员。
   */
  const liveness = await import(LIVENESS_MODULE)
  const knownEvents = ['runtime-liveness', 'task-status', 'task-created', 'task-update', 'task-update-settled', 'delivery-declared']
  const notAProbeEvent = knownEvents.find((name) => liveness.appliesTo({ event: name }) !== true)
  assert.ok(
    notAProbeEvent !== undefined,
    '★ 六个调用点事件里必须至少有一个【不是】探活：一条对所有事件都开口的判据会让每次工具调用都背上探活读数',
  )
  assert.equal(liveness.appliesTo({ event: 'runtime-liveness' }), true, '★ 显式的探活事件必须永远在名单里（夹具与将来的显式探活入口用它）')

  const notApplicable = await registry.evaluate('runtime', { event: notAProbeEvent })
  assert.equal(notApplicable.evaluated, 0, `★ 不适用的事件（${notAProbeEvent}）⇒ 这一轮没有判据被求值`)
  assert.equal(notApplicable.registered, 1, '★ 而不适用 ≠ 位置为空：判据仍然注册着')
  assert.deepEqual(notApplicable.blockers, [], '★ "没跑"不许在任何字段上读成"发现问题"')

  /** ② 不在观察 ⇒ 告警进 `blockers`。 */
  const strict = await registry.evaluate('runtime', context)
  assert.equal(strict.ok, false, '★ 缺省 = 有否决权（注册表 §3.5 决定 ①）')
  assert.equal(strict.blockers.length, 1, '★ 开火了就必须交出一条原文')
  assert.match(strict.blockers[0], /liveness alarm, not a rejection/, '★ 原文要说清它不打断任何东西')

  /**
   * ③ 在观察 ⇒ **同一段原文**进 `observed.blockers`，`blockers` 空。
   *
   * ★ 用 `try/finally` 包住：单例上的观察集是**进程级**状态，泄漏出去会让同一次
   *   运行里别的用例读到另一套门禁（注册表 §3.5 决定 ② 的原文）。
   */
  const before = registry.observingIds()
  registry.observe('runtime.liveness', { reason: 't4: first deployment — observe one round before it gets a say' })
  try {
    const observing = await registry.evaluate('runtime', context)
    assert.equal(observing.ok, true, '★ 观察中 ⇒ 这条裁决不拦（对 runtime 而言它本来也拦不了任何东西 —— 双保险）')
    assert.deepEqual(observing.blockers, [], '★ 放过的那条不许同时留在 blockers 里 —— 否则"放过"与"没放过"同形')
    assert.equal(observing.observedBlockers, 1, '★ 但它必须被【计数】—— 观察期不是静默期')
    assert.equal(observing.observed.blockers.length, 1)
    /**
     * ★★ 本臂的核心断言：观察期**没有**把告警吃掉。同一份上下文、同一条判据，
     *   ② 与 ③ 交出的原文必须**逐字相同**，差别只在它落在哪个字段。
     *   打红它的定向突变是"观察分支直接把裁决丢掉"（不 push 进 `observedBlockers`）——
     *   那时 ③ 变成一份完全空的读数，而 `ok:true` 会让它读起来像"探过了，没事"。
     */
    assert.equal(
      observing.observed.blockers[0],
      strict.blockers[0],
      '★ 观察期与被拦下必须是【同一段原文】—— 否则读 observed 的人看到的是另一句话',
    )
    assert.equal(observing.ran[0].observed, true, '★ "开火了但被放过"必须在 ran[] 里带标记')
    assert.equal(strict.ran[0].observed, undefined, '★ 而没被放过的那一条不带这个标记（两者不同形）')
  } finally {
    registry.unobserve('runtime.liveness')
  }
  assert.deepEqual(registry.observingIds(), before, '★ 进程级观察集必须回到本臂进场时的样子（不许泄漏给别的用例）')

  /** ④ 收尾后立刻复查：观察确实结束了 —— 否则上面那三条全是恒真。 */
  const after = await registry.evaluate('runtime', context)
  assert.equal(after.ok, false, '★ unobserve 之后这条判据必须恢复它本来的裁决形状')
  assert.equal(after.observedBlockers, undefined, '★ "观察期什么都没发生"与"放过了一条真实发现"必须不同形')
})

test('臂 3g ★ 集成臂：观察名单的两个入口都真的能开 —— 而装配点一行不改', async () => {
  /**
   * ★ 臂 3e 说"不要写进装配点"，本臂说"那不写进去要靠什么"。两个入口都要**实测**
   *   能开 —— 否则 3e 就成了一条"要求一件做不到的事"的规则。
   *
   * ★ 这里用**新建实例**，不碰单例：环境变量是在 `createGateRegistry()` 构造时
   *   读一次的，拿单例测它就得去动 `process.env` 这个全局状态（会让用例互相污染，
   *   注册表自己的注释把那列为"最难归因的一类缺陷"）。
   */
  const module = await import(LIVENESS_MODULE)
  const { asRegistration } = await import('../lib/gates/index.js')
  const build = (observeFromEnv) => {
    const r = createGateRegistry(observeFromEnv === undefined ? {} : { observeFromEnv })
    r.register(asRegistration(module))
    return r
  }
  const context = stuckContext()

  /** ① 环境变量入口：没设 / 设了 / 空串 —— 三者必须可分辨。 */
  const unlisted = await build(undefined).evaluate('runtime', context)
  assert.equal(unlisted.ok, false, '★ 没设环境变量 ⇒ 判据有否决权（缺省不放宽）')
  assert.equal(unlisted.observedBlockers, undefined)

  const listed = await build('runtime.liveness').evaluate('runtime', context)
  assert.equal(listed.ok, true, '★ 名单里有它 ⇒ 观察期生效 —— 不改代码、不改装配点、不需要 build')
  assert.equal(listed.observedBlockers, 1, '★ 而且放过的那条被记下来了')

  const blank = await build('   ,  ').evaluate('runtime', context)
  assert.equal(blank.ok, false, '★ 空串/全空白 ⇒ 等价于没设（一个空的环境变量不是"有人在观察"）')

  /** ② 运行时调用入口：不碰 env、也不碰装配点。 */
  const runtime = build(undefined)
  runtime.observe('runtime.liveness', { reason: 'observe one round before it gets a say' })
  const observed = await runtime.evaluate('runtime', context)
  assert.equal(observed.ok, true, '★ 运行时 observe ⇒ 同一份清单、同一条判据，裁决被放过')
  assert.equal(
    observed.observed.blockers[0],
    unlisted.blockers[0],
    '★ 两个入口放过的必须是同一条发现（原文逐字相同）',
  )
  runtime.unobserve('runtime.liveness')
  assert.equal((await runtime.evaluate('runtime', context)).ok, false, '★ unobserve ⇒ 立刻恢复（同样不需要 build）')

  /** ★ 三个入口都走完，装配点里仍然没有第三句话 —— 本臂全程没有碰那个文件。 */
  assert.deepEqual(observeCallsInAssembly(), [], '★ 两个入口都跑完，装配点里仍然没有第三句话')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4/4b/4c：集成收口（t9）—— 输入面声明机制的覆盖率、软硬状态与读数出口
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 为什么这三臂属于【装配点】的夹具，而不是某个位置的夹具 ──────────────────────
 *
 * MEASURED（2026-10-06，t9 集成收口）：`requires` 这套东西的**声明面**长在每条判据
 * 上，而**能不能被核对的唯一真值来源**是装配点送进注册表的那份清单
 * （`asRegistration` → `registry.list()` → `gateModuleViews()`）。
 *
 * ⇒ "有没有判据没声明 requires"这个问题，**只有从装配点看才问得全**：某个位置的
 *   夹具只能看见它自己那几条，而漏网的恰恰是"没人想起来去问"的那一条。
 *   这与臂 1e（`requires` 必须被装配层原样转发）是同一条链的两端：
 *   1e 钉"声明了的不许被吃掉"，4 钉"每条都必须声明"。
 */

/** 一条判据的 `requires` 声明面（从**注册表**读，不从源码文本读）。 */
function declaredSurface() {
  const list = registry.list()
  return Object.entries(list).flatMap(([point, entries]) =>
    entries.map((entry) => ({
      point,
      id: entry.id,
      hasRequires: entry.hasRequires,
      requires: entry.requires,
    })))
}

test('臂 4 ★ 集成臂：六位置 × 每条判据都必须声明 requires —— 「漏网」在这里是机械读数，不是人眼审查', () => {
  /**
   * ── 这一臂钉的是本任务的**目标本身** ──────────────────────────────────────────
   *
   * 本轮要消灭的是"输入面每一格手工接"。而声明面若有一条判据**没写** `requires`，
   * 那么它的输入面就回到了老路上 —— 那一格没有任何东西在核。
   *
   * ★ 为什么断言写成"逐条列名"而不是"计数 >= N"：计数会让"新增一条没声明的判据、
   *   同时删掉一条已声明的"这种交换在读数上同形。列出**具体是谁**，
   *   漏网的那一条就有名字。
   *
   * ★ 反向半边（防恒真）：下面同时断言"注册表里确实有判据"以及"至少有一条判据的
   *   声明非空" —— 否则一个空注册表会让本臂全绿，而它看起来像"全都声明好了"。
   */
  const declarations = declaredSurface()
  assert.ok(
    declarations.length > 0,
    '★ 注册表里必须真的有判据 —— 否则下面那句"没有漏网"是恒真的（空集合上没有反例）',
  )

  const undeclared = declarations.filter((entry) => !entry.hasRequires)
  assert.deepEqual(
    undeclared.map((entry) => `${entry.point}/${entry.id}`),
    [],
    '★ 有判据没有声明 requires ⇒ 它的输入面回到了"手工接"的老路（本轮要消灭的正是这个形状）。'
    + '修法：在判据模块里写 export const requires: CtxPaths<那个判据自己的 Context>[] = [...]',
  )

  /**
   * ★ 声明**非空**也必须被钉住：`requires: []` 是合法的（"它不依赖 ctx 任何一格"），
   *   但它必须是**有人想过**的结论，不是"还没写"的伪装。本轮 11 条判据**全部**非空
   *   —— 所以这里断言"非空条数 == 总条数"，任何一条退化成空数组都会红，
   *   从而逼作者在注释里说明为什么它一格都不需要。
   *
   *   ★ 这一句与上面那句**不是重复**：上面问"声明了没有"，这里问"声明的内容是不是
   *     空壳"。两件事分别对应两种不同的偷懒方式。
   */
  const empty = declarations.filter((entry) => entry.hasRequires && (entry.requires?.length ?? 0) === 0)
  assert.deepEqual(
    empty.map((entry) => `${entry.point}/${entry.id}`),
    [],
    '★ 有判据声明了空的 requires —— 若它真的不依赖任何一格，请在判据里写明理由；'
    + '若它是"还没想好"，那正是本机制要抓的形态',
  )

  /**
   * ★ 六位置的可读读数：每个位置各有几条、其中几条声明了。这是给 t9 报告的**同一个数字**，
   *   所以它必须由机器算出来，而不是报告里手写一遍（手写的那份会过期）。
   */
  const census = Object.fromEntries(
    ['contract', 'dispatch', 'completion', 'delivery', 'runtime'].map((point) => [
      point,
      declarations.filter((entry) => entry.point === point).length,
    ]),
  )
  assert.deepEqual(
    census,
    { contract: 2, dispatch: 2, completion: 4, delivery: 2, runtime: 1 },
    '★ 六位置的判据分布变了 —— 变动本身不是错，但"每条都声明了输入面"这句话必须在新分布上仍然成立',
  )
})

test('臂 4b ★ 集成臂：核对机制现在是【软的】—— 而硬化开关是显式的、关得掉、且真的接得上', async () => {
  /**
   * ── 用户裁定"先软后硬"，那么"现在是软的"必须是一条【机械读数】 ────────────────
   *
   * ★ 为什么不能只靠读 `requires.ts` 的注释：注解里写"缺省 observe"与运行时真的是
   *   observe，是两件事。而"硬化开关存在"与"硬化开关接得上"更是两件事 ——
   *   本项目已经栽过一次：**机制建好了，而中间那个白名单没列它**（臂 1e）。
   *
   * ★ 用**真实的 `completion.r5`**（从 `lib/` 读，与臂 1/1d 同一条纪律），不是探针：
   *   本臂要证明的是"真实的 11 条判据里有一条、在真实注册表上会被这样对待"。
   */
  const r5 = await import('../lib/gates/completion/r5.js')
  const point = 'completion'
  /**
   * ★ 一份能让 `completion.r5` **适用**、且必然**缺格**的 ctx：
   *   它的 `appliesTo` 在 `wantsCompleted === true` 且 kind 是 implementation/repair 时为真，
   *   而它声明了 7 格 —— 这里只给 1 格 ⇒ 缺格是构造出来的，不是碰巧。
   */
  const thinContext = {
    task: { kind: 'implementation' },
    wantsCompleted: true,
    taskNotTerminal: true,
    update: { newTestFiles: ['scripts/x.test.mjs'] },
  }

  /** ① 缺省（不设环境变量）⇒ 缺格被**记录**，而裁决一个字都不改。 */
  const soft = createGateRegistry()
  soft.register(asRegistration(r5))
  const softResult = await soft.evaluate(point, thinContext)
  assert.equal(softResult.evaluated, 1, '★ 前提：这条判据真的跑了（跳过的判据不会被核对，本臂也就什么都没测到）')
  assert.ok(
    softResult.requires.incomplete > 0,
    '★ 前提：这份 ctx 上确实有缺格 —— 否则下面的"没被拒"是恒真的',
  )
  assert.deepEqual(
    softResult.blockers, [],
    '★ 缺省必须是【软的】：核对不许把缺格并进 blockers（"先软后硬"的字面落点）',
  )
  assert.ok(softResult.requires.incomplete > 0, '★ 而记录必须照常（不拒绝 ≠ 不记录）')

  /** ② 硬化 ⇒ **同一份 ctx、同一条判据**的缺格变成 blocker，且措辞指名"是输入面"。 */
  const hard = createGateRegistry({ enforceRequiresFromEnv: '1' })
  hard.register(asRegistration(r5))
  const hardResult = await hard.evaluate(point, thinContext)
  assert.equal(hardResult.ok, false, '★ 硬化下缺格必须被拒（否则这个开关是个装饰）')
  assert.ok(
    hardResult.blockers.some((item) => /the input surface is not wired/.test(item)),
    '★ 而且读得出是【核对层】拒的 —— 否则读日志的人要在一堆判据结论里找原因',
  )
  /**
   * ★ 两半必须同时成立（否则断言可被"恒拒"满足）：软的那次**真的没拒**。
   *   上面 ① 已经断言过，这里再对拍一次两者在同一条判据上的差别，防止
   *   "硬化"与"缺省"读到的是同一份结果。
   */
  assert.notDeepEqual(
    hardResult.blockers, softResult.blockers,
    '★ 硬化与缺省必须不同形 —— 否则"开关生效了"这句话读不出来',
  )

  /** ③ 开关关得掉：`=0` / 空串 / 全空白 ⇒ 回到软的（三个相反的写法必须与"没设"同形）。 */
  for (const off of ['0', '', '   ']) {
    const back = createGateRegistry({ enforceRequiresFromEnv: off })
    back.register(asRegistration(r5))
    const result = await back.evaluate(point, thinContext)
    assert.deepEqual(
      result.blockers, [],
      `★ AGENT_TEAMS_ENFORCE_REQUIRES=${JSON.stringify(off)} 必须等价于"关掉" `
      + '—— 一个"非空即硬化"的读法会把它拧到最硬，而它在日志里读起来像"我关掉了"',
    )
    assert.ok(result.requires.incomplete > 0, '★ 关掉的是【硬化】，不是【记录】')
  }
})

test('臂 4c ★ 集成臂（读数出口）：核对结论的【可读出口】必须不止一条路径 —— 只写日志的出口在断言层面与"没核对"同形', () => {
  /**
   * ── MEASURED（2026-10-06，t9 集成收口）：出口是不对称的 ────────────────────────
   *
   * 六处 `auditGateRequires(...)` 调用点里：
   *   · **runtime** 把核对结论**随记录交出去**（`runtime_gates.input_surface`）——
   *     结构化的、断言读得到的出口；
   *   · 其余五处（contract / dispatch / completion / delivery ×2）**只有一个
   *     `logger.warn`** —— 日志被截断或被关掉时，它与"输入面是齐的"同形。
   *
   * ★ 这不是"日志不好"，而是**同一个结论只有一条读取路径**时的固有弱点：本队
   *   已经栽过一次同名形态 —— `gate-input-wiring.test.mjs` 臂 8 的第一版就是
   *   "挂在 contract 位置、却去读只有 runtime 才有的 `input_surface`" ⇒ 断言**恒真**。
   *
   * ★ 所以本臂钉的是**这条不对称本身**，而不是"要求五处都补字段"（那是 t9 契约
   *   之外的改动，且五处都是异步/异常路径，改形状要单独评估）：
   *   · 哪一处有结构化出口、哪一处只有日志 —— 必须**说得清**；
   *   · 有结构化出口的那一处，它必须真的在场（否则读者以为有、实际读不到）。
   *
   * ⇒ 将来任何人给 contract/dispatch/completion/delivery 补上结构化出口，
   *   本臂的名单会立刻红 —— 逼他把这句话改对，而不是让一份过期的名单留在注释里。
   */
  assert.deepEqual(
    STRUCTURED_OUTLET_POINTS,
    ['runtime'],
    '★ 有结构化 `input_surface` 出口的位置名单变了 —— 变动本身可能是好事（补出口），'
    + '但"哪些位置只能从日志读"这句话必须同时改对，否则下一位按它去找字段会读到一个不存在的出口（那正是臂 8 第一版恒真的原因）',
  )
  /** 反向：只写日志 ≠ 没核对 —— 五处都必须真的调用了核对（否则"出口在哪"无从谈起）。 */
  assert.ok(
    AUDIT_CALL_SITES.length >= 6,
    `★ 调用点少于 6 处：本次接线的主语是"八处调用点都要核对"，实际读到 ${AUDIT_CALL_SITES.length} 处`,
  )
  for (const site of AUDIT_CALL_SITES) {
    assert.ok(
      STRUCTURED_OUTLET_POINTS.includes(site.point) || site.logsGaps,
      `★ ${site.point} 位置（${site.varName}）既不交结构化出口、也不写缺格日志 ⇒ 那处核对的结果没有任何读者`,
    )
  }
})

/**
 * 结构化出口（`input_surface`）所在的**位置名** —— 从源码里读出来，不手抄。
 *
 * 口径：`input_surface` 是 `evaluateRuntimeGates` 的返回字段，而那个函数**只**核对
 * `runtime`。所以判法是从每个 `input_surface:` 字面量**向前**找到最近的
 * `auditGateRequires('<point>'` —— 那一处就是它的产出者。
 *
 * ★ 必须先去掉注释：装配点里也**写着** `input_surface` 这个词（在解释它的那段
 *   长注释里），而注释里的那一次出现会让"最近的 audit 调用"指向另一条位置。
 *   这与本文件 `observeCallsInAssembly` 的纪律同源 —— 注释是给人看的转述，
 *   夹具读的必须是真的代码。
 *
 * ★ 这里刻意不写死 `'runtime'`：写死之后，"有人给某个位置补上了结构化出口"与
 *   "名单过时了"在断言层面同形，而本臂要的正是让那个变化**可见**。
 */
const STRUCTURED_OUTLET_POINTS = (() => {
  const code = wiringState().source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const found = new Set()
  for (const match of code.matchAll(/input_surface:/g)) {
    const before = code.slice(0, match.index)
    const owner = [...before.matchAll(/auditGateRequires\('(\w+)'/g)].pop()
    if (owner !== undefined) found.add(owner[1])
  }
  return [...found].sort()
})()

/** 装配点里对 `auditGateRequires` 的每一次调用（变量名 / 位置 / 有没有写缺格日志）。 */
const AUDIT_CALL_SITES = (() => {
  const source = wiringState().source
  const lines = source.split('\n')
  const sites = []
  lines.forEach((line, index) => {
    const match = line.match(/(?:const\s+)?(\w+)\s*=\s*auditGateRequires\('(\w+)'/)
    if (!match) return
    const window = lines.slice(index, index + 80).join('\n')
    sites.push({
      point: match[2],
      varName: match[1],
      line: line.trim(),
      logsGaps: new RegExp(`${match[1]}\\.missing`).test(window),
    })
  })
  return sites
})()

test('臂 4d ★ 集成臂：装配层交出的声明面就是注册表读到的那一份（`gateModuleViews` 与 `list()` 不许分叉）', () => {
  /**
   * ── 为什么这一臂必须存在（两条已实测的分叉形态）──────────────────────────────
   *
   * ① t3 的 defect：`asRegistration` 不转发 `requires` ⇒ `list()` 读成
   *    `hasRequires:false`，"声明过"与"没声明"同形（臂 1e 钉住）。
   * ② t10 的第一版 defect：核对层改去读**静态的 `ALL_GATES`** ⇒ 运行期注册进来的
   *    判据"根本不存在"，核对报出的是一份**关于别的判据**的结论，而它读起来完全正常。
   *
   * 两次都不是"某处写错"，是**同一件事有两个来源**。⇒ 唯一真值 = 注册表。
   * 本臂把这个不变量写成断言：`gateModuleViews()` 的每一条都必须能在 `list()` 里
   * 逐字段找到，且**集合相等**（不是包含 —— 包含会漏掉"凭空多出来一条"）。
   */
  const fromList = declaredSurface()
    .map((entry) => `${entry.point}\u0000${entry.id}\u0000${entry.hasRequires}\u0000${JSON.stringify(entry.requires ?? null)}`)
    .sort()
  const fromViews = gateModuleViews()
    .map((view) => `${view.point}\u0000${view.id}\u0000${view.hasRequires}\u0000${JSON.stringify(view.requires ?? null)}`)
    .sort()
  assert.deepEqual(
    fromViews,
    fromList,
    '★ 装配层交出的声明面与注册表读到的那一份分叉了 —— 而分叉之后，核对会给出一个关于【另一份清单】的结论，读起来完全正常',
  )
  assert.ok(fromList.length > 0, '★ 集合相等在空集合上恒真 —— 注册表必须真的有判据')
})
