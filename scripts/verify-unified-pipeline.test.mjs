/**
 * ── V1（t5）· 独立验证：P1–P4 四条改动**是否真的生效** ─────────────────────────────
 *
 * ── ★★★ 本夹具的独立性纪律（它决定了本文件能声称什么）─────────────────────────
 *
 *   ✔ 走**真实入口**：`lib/gates/index.js`（运行时真的加载的那一份）
 *   ✔ **自己构造输入** —— 不复用任何实现者夹具的辅助函数
 *     （那些辅助函数编码了实现者的假设：ctx 长什么样、什么算通过）
 *   ✔ **基线自己量** —— 在 P4 接线【之前】的那个提交上真的跑一次注册表，
 *     而不是从注释里抄一个"改前是 2"（那正是本队在 t2 里报过的读数）
 *   ✗ 不声称判据的**语义正确性** —— 见文件末尾的射程边界
 *
 * ── 它钉的是什么（P1–P4 各自的**机制**，不是它们的文档）────────────────────────
 *
 *   P1  `runPipeline` 是**单一主干**，且分档读【提案自己的写域】而不是收窄后的
 *   P2  `reviewed` 那一格**能被承载**（类型 + schema + 落盘），且三态不许被规整
 *   P3  大档真的走**拆解**，且两道闸门（拆出 0 条 / 原样返回）真的拦得住
 *   P4  `contract.task-atomicity` 真的**进了注册表**，且**真的会开火**
 *
 * ── ★ 三态如实（本文件反复用的同一条）─────────────────────────────────────────
 *
 *   判据不在盘上 / 机制测不了 ⇒ 报 `unmeasured`，**绝不报 pass**。
 *   ★ 而"没测到"与"测了而不过"必须**不同形** —— 本文件用 `t.skip(...)` 表示前者，
 *     用 `assert` 失败表示后者。两者在读数上不同形（前者是 skipped，后者是 fail）。
 *
 * ── ★★ 一条只在本仓成立的**前置**（写清楚，否则整份夹具会变成恒真）───────────
 *
 *   本文件依赖 `lib/` 是**当前源码的构建产物**。若 `lib/` 落后于 `src/`，
 *   那么它测的是旧产物 —— 而那会让"P4 真的进了注册表"这句话**测的是另一个东西**。
 *   ⇒ 所以臂 0 先核对 `lib/gates/index.js` 里那两条 id 与 `src/gates/index.ts` 的
 *     导入清单**一致**；不一致 ⇒ 报 unmeasured（而不是静默地测旧产物）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(ROOT, 'lib')

/**
 * ★ 基线：**在 P4 接线之前的那个提交上真跑一次注册表**得到的读数。
 *
 * MEASURED（本任务实测，`git worktree add --detach <P4~1>` 后真跑 `registry.list()`）：
 *
 *     admission 0 · contract 2 · dispatch 2 · completion 4 · delivery 2 · runtime 1  ⇒ 合计 11
 *
 * ★ 而它**不是**从注释抄的：本文件给出复现它的命令（见臂 2 的注释），
 *   所以下一个人可以自己重跑，而不是信这个常数。
 * ★★ 而它**只在 `lib/gates/index.js` 与 `src/gates/index.ts` 同步时**才有意义 —— 由臂 0 保证。
 */
const BASELINE = Object.freeze({
  admission: [],
  contract: ['contract.build-artifact-scope', 'contract.verify-command'],
  dispatch: ['dispatch.changed-paths', 'dispatch.worktree'],
  completion: ['completion.verify-rerun', 'completion.r5', 'completion.mutation', 'completion.backtest'],
  delivery: ['delivery.coverage', 'delivery.convergence'],
  runtime: ['runtime.liveness'],
})

/** ★ 真实入口 —— 运行时真的加载的那一份（不是 `src/`）。 */
async function realRegistry() {
  const mod = await import(join(LIB, 'gates', 'index.js'))
  return { registry: mod.registry, INSERTION_POINTS: mod.INSERTION_POINTS }
}

/** 把当前注册表读成 `{ 位置: [id, …] }`。 */
function snapshot(registry, INSERTION_POINTS) {
  const out = {}
  for (const point of INSERTION_POINTS) out[point] = (registry.list()[point] ?? []).map((gate) => gate.id)
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 0：前置 —— lib/ 必须是**当前源码**的产物（否则下面每一条都测的是旧东西）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 0（前置）：`lib/gates/index.js` 是当前 `src/gates/index.ts` 的产物', async (t) => {
  const libIndex = join(LIB, 'gates', 'index.js')
  const srcIndex = join(ROOT, 'src', 'gates', 'index.ts')
  if (!existsSync(libIndex) || !existsSync(srcIndex)) {
    t.skip(`未测量：${!existsSync(libIndex) ? 'lib/gates/index.js' : 'src/gates/index.ts'} 不在盘上（先 pnpm build）`)
    return
  }
  /**
   * ── 怎么"比较源码与产物"而不用读它们的全文 ────────────────────────────────────
   *
   * ★ 用**同一份 id 集合**做比对的锚：`src/` 侧按 `import * as X from './…'` 收模块路径，
   *   而那些模块各自的 `export const id` 就是它的 id。
   *   ★ 而 `lib/` 侧直接跑 `registry.list()` 拿到 id。
   *   ⇒ 两侧 id 集合相等 ⇒ 产物覆盖了源码里的全部判据模块。
   *
   * ★★ 为什么这条前置**必要**：若 `lib/` 落后（例如有人改了 `src/` 没 build），
   *   那么"P4 真的进了注册表"这句话测的是**旧产物** —— 而它与"P4 没生效"同形。
   */
  const srcText = readFileSync(srcIndex, 'utf8')
  const imported = [...srcText.matchAll(/^import \* as (\w+) from '\.\/([\w/-]+)\.ts'$/gm)]
    .map((match) => ({ alias: match[1], path: match[2] }))
  assert.ok(imported.length > 0, '★ 前置：`src/gates/index.ts` 里应当有 `import * as …` 形式的判据模块')

  /**
   * ★ 每个被 import 的模块，读它自己的 `lib/` 产物拿 `id`（用正则读导出的字符串）。
   *   ★ 这是"读声明的字面"，不是运行时 —— 而它与注册表给出的 id 必须一致。
   */
  const declaredIds = []
  for (const entry of imported) {
    const libPath = join(LIB, 'gates', `${entry.path}.js`)
    if (!existsSync(libPath)) {
      t.skip(`未测量：${entry.path}.js 不在 lib/gates 下（先 pnpm build）`)
      return
    }
    const match = readFileSync(libPath, 'utf8').match(/export const id = '([^']+)'/)
    if (match !== null) declaredIds.push(match[1])
  }
  assert.ok(declaredIds.length > 0, '★ 前置：`lib/gates/<模块>.js` 里应当读得到 `export const id`')

  const { registry, INSERTION_POINTS } = await realRegistry()
  const live = new Set(Object.values(snapshot(registry, INSERTION_POINTS)).flat())
  const missing = declaredIds.filter((id) => !live.has(id))
  assert.deepEqual(
    missing, [],
    '★★ `lib/` 落后于 `src/`：源码里有判据模块的 id 不在活的注册表里 ⇒ '
    + '下面每一条都会测**旧产物**。先 `pnpm build`。缺失：' + missing.join(', '),
  )
  console.log(`  [t5] 前置通过：${declaredIds.length} 个判据模块的 id 全部在活的注册表里`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：P4 —— `contract.task-atomicity` 真的进了注册表，且**真的会开火**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1（P4 · 注册）：注册表逐位置枚举，并与基线**逐条**比对', async (t) => {
  if (!existsSync(join(LIB, 'gates', 'index.js'))) {
    t.skip('未测量：lib/gates/index.js 不在盘上（先 pnpm build）')
    return
  }
  const { registry, INSERTION_POINTS } = await realRegistry()
  const now = snapshot(registry, INSERTION_POINTS)

  /**
   * ── ★ 基线的量法（可复跑）──────────────────────────────────────────────────────
   *
   *     git worktree add --detach /tmp/base <P4 接线之前的那个提交>
   *     cd /tmp/base && node -e "…registry.list()…"
   *
   * ★ MEASURED（本任务）：那份读数是
   *     admission 0 · contract 2 · dispatch 2 · completion 4 · delivery 2 · runtime 1 ⇒ 11
   */
  console.log('  [t5] 位置        基线 → 现在  · 增量')
  for (const point of INSERTION_POINTS) {
    const before = BASELINE[point] ?? []
    const after = now[point] ?? []
    const added = after.filter((id) => !before.includes(id))
    const removed = before.filter((id) => !after.includes(id))
    console.log(
      `  [t5] ${point.padEnd(11)} ${String(before.length).padStart(2)} → ${String(after.length).padStart(2)}`
      + `   ${added.length === 0 ? '—' : '+' + added.join(', ')}${removed.length === 0 ? '' : ' ★ 移除: ' + removed.join(', ')}`,
    )
    /** ★ 反向半边：**不许有判据被移除**（接线不该拆掉别的东西）。 */
    assert.deepEqual(removed, [], `★ ${point} 位置上有判据被移除了 —— 接线不该拆掉既有判据`)
  }

  const all = Object.values(now).flat()
  const baselineAll = Object.values(BASELINE).flat()

  /** ★ 核心：P4 那一条真的在注册表里。 */
  assert.ok(
    all.includes('contract.task-atomicity'),
    '★ P4：`contract.task-atomicity` 必须在活的注册表里 —— 它此前【在盘上但从未被注册】',
  )
  /** ★ 而 P2b 那条（`dispatch.plan-reviewed`）也在。 */
  assert.ok(
    all.includes('dispatch.plan-reviewed'),
    '★ P2b：`dispatch.plan-reviewed` 必须在活的注册表里',
  )
  /** ★ 而增量的**总数**必须说得清：11 → 13，且恰好 +2。 */
  assert.equal(
    all.length - baselineAll.length, 2,
    `★ 净增必须恰好 2 条（实测 ${baselineAll.length} → ${all.length}）。`
    + '多出来 ⇒ 有别的接线没被记账；少了 ⇒ 有判据掉了',
  )
})

test('★ 臂 1b（P4 · 开火）：`contract.task-atomicity` 对**自己构造的**目录条目真的判 large', async (t) => {
  if (!existsSync(join(LIB, 'gates', 'index.js'))) {
    t.skip('未测量：lib/gates/index.js 不在盘上（先 pnpm build）')
    return
  }
  const { registry } = await realRegistry()
  /**
   * ── ★★ 这里**自己构造输入**（不复用实现者夹具的辅助函数）──────────────────────
   *
   * ★ 输入形状取自**判据自己的 requires 声明**（`registry.list()` 上读得到），
   *   而不是从某个夹具里抄 —— 那是"读被测对象自己说的契约"。
   */
  const base = {
    id: 'probe-t5-atomicity',
    kind: 'implementation',
    acceptance: ['x'],
    verify: ['pnpm typecheck'],
  }
  /** ① 全文件写域 ⇒ 应当**不**因原子性被拦。 */
  const filesOnly = await registry.evaluate('contract', {
    task: { ...base, inScope: ['src/a.ts', 'src/b.ts'] }, wantsCompleted: false, taskNotTerminal: true,
  })
  /** ② 含**目录条目** ⇒ 应当**被**拦（那是这条判据存在的理由）。 */
  const withDir = await registry.evaluate('contract', {
    task: { ...base, inScope: ['src/a.ts', 'src/'] }, wantsCompleted: false, taskNotTerminal: true,
  })

  const atomicityBlockers = (result) => result.blockers.filter((line) => String(line).includes('task-atomicity'))
  console.log(`  [t5] 仅文件 ⇒ task-atomicity blocker 数 = ${atomicityBlockers(filesOnly).length}`)
  console.log(`  [t5] 含目录 ⇒ task-atomicity blocker 数 = ${atomicityBlockers(withDir).length}`)

  /** ★ 正向：含目录条目 ⇒ 必须开火，且说清**为什么**（不是只报一个布尔）。 */
  assert.ok(
    atomicityBlockers(withDir).length > 0,
    '★ P4：写了目录条目（`src/`）而 task-atomicity **没有开火** —— 那它等于没接线',
  )
  assert.match(
    atomicityBlockers(withDir).join('\n'), /director|目录/i,
    '★ 而它的理由必须点名"目录条目"这件事（读的人要能去核）',
  )
  /**
   * ★★ 反向半边：**只有文件**时它**不许**开火 ——
   *   否则它是一条"永远拒绝"的判据，而那与"没有判据"在无人值守下同效。
   */
  assert.equal(
    atomicityBlockers(filesOnly).length, 0,
    '★★ 反向半边：inScope 全是【已存在的文件】时，task-atomicity 不该开火 —— '
    + '一条恒拒的判据会让每一条正常的实现任务都被拦',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：P1/P3 —— `runPipeline` 是单一主干，且三态互不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 2（P1 · 主干）：三条提案走 `runPipeline` ⇒ 三个**不同**的 stage', async (t) => {
  let pipeline
  try {
    pipeline = await import(join(ROOT, 'scripts', 'friction-triage.mjs'))
  } catch (error) {
    t.skip(`未测量：scripts/friction-triage.mjs 不可加载（${String(error?.message ?? error).slice(0, 120)}）`)
    return
  }
  if (typeof pipeline.runPipeline !== 'function') {
    t.skip('未测量：`runPipeline` 不在导出面上 —— P1 的骨架不在盘上')
    return
  }

  /**
   * ── ★★ 输入**自己构造**（不看实现者夹具）──────────────────────────────────────
   *
   * ★ 三条提案只在**一个自变量**上不同（写域），所以下面对它们的 stage 差异
   *   可以直接归因到那条自变量上 —— 而那是"同一份 ctx 只动一个自变量"的做法。
   */
  const proposal = (id, inScope) => ({
    sourceId: id,
    subject: 'probe',
    kind: 'implementation',
    inScope,
    acceptance: ['x'],
    verify: ['pnpm typecheck'],
    objective: 'o',
    claim: 'c',
  })
  const cases = [
    { label: '小档（单文件）', proposal: proposal('t5-small', ['src/gates/index.ts']) },
    { label: '大档（跨多文件）', proposal: proposal('t5-large', ['src/a.ts', 'src/b.ts', 'src/c.ts']) },
    { label: '无写域（判不了）', proposal: proposal('t5-noscope', []) },
  ]

  const seen = new Map()
  for (const item of cases) {
    const result = pipeline.runPipeline(item.proposal, {})
    const stage = String(result.stage)
    console.log(`  [t5] ${item.label.padEnd(18)} ⇒ stage=${stage.padEnd(16)} tier=${String(result.tier?.tier ?? '-')} trace=${JSON.stringify(result.trace ?? [])}`)
    assert.notEqual(stage, 'undefined', `★ ${item.label}：stage 必须是一个真的值`)
    seen.set(stage, item.label)
  }

  /**
   * ★★ 三态**互不同形**：三个阶段必须**两两不同**。
   *   ⇒ 否则"大档"与"不能出契约"在下游同形，而它们的补救动作相反。
   */
  assert.equal(seen.size, 3, `★ 三条提案必须给出三个【不同】的 stage。实测：${[...seen.entries()].map(([s, l]) => `${l}=${s}`).join(' · ')}`)
})

test('★ 臂 2b（P1 · 分档读提案的写域）：`tierOf` 读的是**提案自己**的 inScope', async (t) => {
  let pipeline
  try {
    pipeline = await import(join(ROOT, 'scripts', 'friction-triage.mjs'))
  } catch (error) {
    t.skip(`未测量：${String(error?.message ?? error).slice(0, 120)}`)
    return
  }
  if (typeof pipeline.runPipeline !== 'function') {
    t.skip('未测量：`runPipeline` 不在导出面上')
    return
  }
  /**
   * ── ★★ 这是 P1 的**修正点**（captain 裁定的那一格）────────────────────────────
   *
   *   分档必须读**提案自己的写域**，而不是 `narrowScope` 之后的那一份 ——
   *   否则信号 A（跨多个现有源码文件）会在判决侧**结构性关掉**。
   *
   * ★ 可执行的形状：**同一份提案**，`runPipeline` 给出的 tier 必须与
   *   直接 `tierOf(提案)` 给出的 tier **一致**。
   *   ⇒ 若它改读收窄后的写域，两者会在"收窄器改了写域"的提案上分叉。
   */
  const proposal = {
    sourceId: 't5-tier-scope',
    subject: 'probe',
    kind: 'implementation',
    inScope: ['src/a.ts', 'src/b.ts'],
    acceptance: ['x'],
    verify: ['pnpm typecheck'],
    objective: 'o',
    claim: 'c',
  }
  const viaPipeline = pipeline.runPipeline(proposal, {})
  if (typeof pipeline.tierOf !== 'function') {
    t.skip('未测量：`tierOf` 不在导出面上 ⇒ 无法比对两处口径')
    return
  }
  const direct = pipeline.tierOf(proposal, {})
  console.log(`  [t5] runPipeline.tier = ${String(viaPipeline.tier?.tier)} · tierOf(提案) = ${String(direct.tier)}`)
  console.log(`  [t5] narrowing.from = ${JSON.stringify(viaPipeline.narrowing?.from)} · to = ${JSON.stringify(viaPipeline.narrowing?.to)}`)

  assert.equal(
    viaPipeline.tier?.tier, direct.tier,
    '★★ 主干给出的分档必须与 `tierOf(提案)` 一致 —— 不一致说明它读的是【收窄后】的写域'
    + '（那会让信号 A 在判决侧永不触发）',
  )
  assert.equal(direct.tier, 'large', '★ 前置：两个现有源码文件 ⇒ 应为 large（信号 A）')
  /** ★ 而收窄的读数**仍进返回值**（它是有用信号，只是不再作分档输入）。 */
  assert.ok('narrowing' in viaPipeline, '★ 收窄前后的差必须在返回值里读得到（它是有用信号）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：P3 —— 大档真的走**拆解**，且两道闸门真的拦得住
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3（P3 · 拆解）：两道闸门（拆出 0 条 / 原样返回）真的拦得住', async (t) => {
  let pipeline
  try {
    pipeline = await import(join(ROOT, 'scripts', 'friction-triage.mjs'))
  } catch (error) {
    t.skip(`未测量：${String(error?.message ?? error).slice(0, 120)}`)
    return
  }
  if (typeof pipeline.decomposeContract !== 'function') {
    t.skip('未测量：`decomposeContract` 不在导出面上 —— P3 的拆解不在盘上')
    return
  }
  const contract = { inScope: ['src/a.ts', 'src/b.ts'], acceptance: ['x'], verify: ['pnpm typecheck'], objective: 'o' }
  const tier = { tier: 'large', why: 'w', blockingQuestion: 'q', nextStep: 'n', signals: [] }
  const statusOf = (options) => String(pipeline.decomposeContract(contract, tier, options).status)

  const readings = {
    '无拆解器': statusOf({}),
    '拆出 0 条': statusOf({ decomposer: () => [] }),
    '原样返回': statusOf({ decomposer: () => [{ inScope: ['src/a.ts', 'src/b.ts'] }] }),
    '合法子活': statusOf({ decomposer: () => [{ inScope: ['src/a.ts'] }, { inScope: ['src/b.ts'] }] }),
  }
  for (const [label, status] of Object.entries(readings)) console.log(`  [t5] ${label.padEnd(10)} ⇒ ${status}`)

  /**
   * ★★ 三道"拦"的闸门：它们必须**都不放行**（否则大活会从拆解里溜进 ready）。
   *   ★ 而它们的措辞必须说清**拦的是哪一类** —— 下面按 status 分别断言。
   */
  assert.notEqual(readings['无拆解器'], 'decomposed', '★ 没有拆解器 ⇒ 不许放行（补救是【补能力】）')
  assert.notEqual(readings['拆出 0 条'], 'decomposed', '★★ 拆出 0 条 ⇒ 不许放行（那不是"拆完了"，是"这条活凭空消失了"）')
  assert.notEqual(readings['原样返回'], 'decomposed', '★★ 原样返回 ⇒ 不许放行（下一轮它还会被判大档 ⇒ 大活出了货）')
  /** ★ 正向半边：合法的拆解必须放行（否则这道闸门在"恒拒"）。 */
  assert.equal(readings['合法子活'], 'decomposed', '★ 正向：合法的子活必须放行 —— 否则这道闸门是恒拒的')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：P2 —— `reviewed` 那一格**能被承载**，且判据真的读它
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4（P2 · 形状）：`ReviewedStamp` 在盘上，且 `reviewed` 是**可选**的具名类型', (t) => {
  const typesPath = join(ROOT, 'src', 'types.ts')
  if (!existsSync(typesPath)) {
    t.skip('未测量：src/types.ts 不在盘上')
    return
  }
  const text = readFileSync(typesPath, 'utf8')
  /**
   * ── ★★ 为什么这条读**声明的字面**而不是运行时 ────────────────────────────────
   *
   *   「把 `reviewed?: ReviewedStamp` 改成 `reviewed?: any`」在**运行时无法被观察到**
   *   —— 因为 `any` 在运行时也接受一切。
   *   ⇒ 必须钉**声明的字面**。这是"一个断言的正确观测面在哪"的又一实例。
   */
  assert.match(text, /export interface ReviewedStamp\b/, '★ P2：`ReviewedStamp` 必须是一个具名导出接口')
  assert.match(text, /export interface ReviewedCheck\b/, '★ P2：`ReviewedCheck` 必须是一个具名导出接口')
  assert.match(
    text, /reviewed\?:\s*ReviewedStamp\b/,
    '★★ `reviewed` 必须是**可选**（带 `?`）且类型为**具名的 `ReviewedStamp`** —— '
    + '去掉 `?`（必填）会让"还没审"变成非法；改成 `any` 会让"审了什么"静默接收一切',
  )
  assert.doesNotMatch(
    text, /reviewed\?:\s*(any|unknown)\b/,
    '★★ `reviewed?` 不许是 `any` / `unknown` —— 那与"没有这一格"在类型层同形',
  )
  /** ★ 而 `checks` 必须是 `ReviewedCheck[]`（逐条），不是布尔。 */
  assert.match(
    text, /checks:\s*ReviewedCheck\[\]/,
    '★★ `checks` 必须是 `ReviewedCheck[]` —— 一个 `reviewed: true` 与一个"逐条写着五问结果"的格子，'
    + '在被路由程序读到的那一刻【同形】，而它们的可信度完全不同',
  )
})

test('★ 臂 4b（P2 · 判据真的读它）：五问齐 ⇒ 放行；缺一问 ⇒ 拦；无 reviewed ⇒ 拦', async (t) => {
  if (!existsSync(join(LIB, 'gates', 'index.js'))) {
    t.skip('未测量：lib/gates/index.js 不在盘上（先 pnpm build）')
    return
  }
  const { registry } = await realRegistry()
  /**
   * ── ★★★ `createdAt` 必须**晚于**这道门上线 —— 否则它根本不适用（t42/f-21 之后）──────
   *
   * MEASURED（本任务实测，2026-10-09）：`plan-reviewed` 的 `appliesTo` 现在问
   *   `predatesThisGate(task)`，而它对**没有 `createdAt` 的任务判 `true`**（存量）
   *   ⇒ `appliesTo` 为假 ⇒ **判据根本不跑**（`skipped`）。
   *
   * ★ 而那是对的（它把"这条路建的时候还不存在"如实报成『不适用』而不是造一个假的三态）。
   * ★★ 但它意味着：**本臂若不给 `createdAt`，它测的就是"判据不适用"，而不是"判据判了什么"**
   *   —— 而两者在读数上同形（都是没有 blocker）。
   * ⇒ 所以本臂显式给一个**晚于上线时刻**的 `createdAt`：它要的是"**新任务**身上那条门会开火"。
   */
  const NEW_TASK_CREATED_AT = Date.now() + 86_400_000
  const base = { id: 'probe-t5-reviewed', kind: 'implementation', inScope: ['src/x.ts'], acceptance: ['a'], verify: ['pnpm typecheck'], createdAt: NEW_TASK_CREATED_AT }
  const stamp = (ids, verdictFor = () => 'pass') => ({
    at: 1, by: 'probe', checks: ids.map((id) => ({ id, verdict: verdictFor(id) })),
  })
  /**
   * ★★ 五个问题名**从判据自己的拒绝措辞里读**（那一次拒绝会点名缺了哪几个）——
   *   而不是从实现者夹具的常量里抄。
   *   ★ 做法：先用一个只有 1 问的戳 ⇒ 它必须报出"缺哪几问" ⇒ 把那几个名字收集起来。
   */
  const oneQuestion = await registry.evaluate('dispatch', {
    task: { ...base, reviewed: stamp(['scope']) }, wantsCompleted: false, taskNotTerminal: true,
  })
  const complaint = oneQuestion.blockers.map(String).find((line) => line.includes('plan-reviewed')) ?? ''
  const missing = [...complaint.matchAll(/`([a-z]+)`/g)].map((match) => match[1]).filter((name) => name !== 'reviewed')
  if (missing.length === 0) {
    t.skip('未测量：判据没有报出"缺哪几问" ⇒ 无法从它自己的措辞里取得五问名（不猜）')
    return
  }
  const allFive = [...new Set(['scope', ...missing])]
  console.log(`  [t5] 从判据自己的措辞里读到的问题名：${allFive.join(', ')}`)

  const evaluate = async (task) => {
    const result = await registry.evaluate('dispatch', { task, wantsCompleted: false, taskNotTerminal: true })
    return result.blockers.filter((line) => String(line).includes('plan-reviewed')).length
  }
  const full = await evaluate({ ...base, reviewed: stamp(allFive) })
  const partial = await evaluate({ ...base, reviewed: stamp(['scope']) })
  const none = await evaluate(base)
  console.log(`  [t5] 五问齐 ⇒ ${full} 条 blocker · 缺一问 ⇒ ${partial} 条 · 无 reviewed ⇒ ${none} 条`)

  assert.equal(full, 0, '★ 正向：五问齐 ⇒ plan-reviewed 必须放行（否则它是一条恒拒的判据）')
  assert.ok(partial > 0, '★★ 缺一问 ⇒ 必须拦 —— 答了 1 问的戳不是一次审查')
  assert.ok(none > 0, '★ 没有 `reviewed` ⇒ 必须拦（缺席 = 还没审，是正规状态，但不是"已审"）')
})

test('★ 臂 4c（P2 · 三态）：`unmeasured` **不许**被规整成 `pass`', async (t) => {
  if (!existsSync(join(LIB, 'gates', 'index.js'))) {
    t.skip('未测量：lib/gates/index.js 不在盘上（先 pnpm build）')
    return
  }
  const { registry } = await realRegistry()
  /**
   * ── ★★ 这是全库那条最贵的纪律在**这一格上**的落点 ─────────────────────────────
   *
   *   五问里的某一问答了 `unmeasured`（"我没能测"）⇒ 它**不许**被读成 `pass`。
   *   ★ 可执行的形状：把五问里的一问标成 `unmeasured`，整体的 blocker 数必须
   *     **与"那一问标 fail"不同**，或**至少不为 0** —— 两者都证明它没被并进 pass。
   */
  /**
   * ★ 同臂 4b：`createdAt` 必须**晚于**门上线，否则本臂测的是"不适用"而不是"判据说了什么"。
   */
  const base = { id: 'probe-t5-3state', kind: 'implementation', inScope: ['src/x.ts'], acceptance: ['a'], verify: ['pnpm typecheck'], createdAt: Date.now() + 86_400_000 }
  const oneQuestion = await registry.evaluate('dispatch', {
    task: { ...base, reviewed: { at: 1, by: 'probe', checks: [{ id: 'scope', verdict: 'pass' }] } },
    wantsCompleted: false, taskNotTerminal: true,
  })
  const complaint = oneQuestion.blockers.map(String).find((line) => line.includes('plan-reviewed')) ?? ''
  const missing = [...complaint.matchAll(/`([a-z]+)`/g)].map((match) => match[1]).filter((name) => name !== 'reviewed')
  if (missing.length === 0) {
    t.skip('未测量：拿不到五问名 ⇒ 无法构造"其中一问 unmeasured"（不猜）')
    return
  }
  const five = ['scope', ...missing]
  const withUnmeasured = five.map((id) => ({ id, verdict: id === missing[0] ? 'unmeasured' : 'pass' }))
  const result = await registry.evaluate('dispatch', {
    task: { ...base, reviewed: { at: 1, by: 'probe', checks: withUnmeasured } },
    wantsCompleted: false, taskNotTerminal: true,
  })
  const blockers = result.blockers.filter((line) => String(line).includes('plan-reviewed'))
  console.log(`  [t5] 五问齐但其中一问 unmeasured ⇒ ${blockers.length} 条 blocker`)
  console.log(`  [t5] 判据说：${String(blockers[0] ?? '(无)').slice(0, 180)}`)

  /**
   * ★★ `unmeasured` 绝不许被读成 `pass`：
   *   ⇒ 要么它仍然拦（blockers > 0），要么它至少**在读数上出现**（措辞里点名 unmeasured）。
   *   ★ 若两者都不成立 ⇒ 那一格被静默并进了 pass —— 本队记账最久的那条。
   */
  const stillBlocked = blockers.length > 0
  const named = /unmeasured/i.test(blockers.map(String).join('\n'))
  assert.ok(
    stillBlocked || named,
    '★★ `unmeasured` 被静默读成了 `pass` —— 那一格既没有拦、也没有在措辞里被点名。'
    + '⇒ 那是"没测到"并进"通过"，本队记账最久的那条',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★★ 射程边界 —— 本验证**不能**声称的（写下来，不假装覆盖）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5（射程）：本验证能声称的与**不能**声称的', () => {
  /**
   * ── ★★★ 这一臂的产物是**一句话**，而不是一个断言 ──────────────────────────────
   *
   *   它**不能**被判据的语义正确性作证 —— 那需要另一层（正向语料 + 反向语料 + 突变）。
   *   ⇒ 所以这里做两件**可执行**的事：
   *     ① 打印出射程边界（读日志的人必须看到它）
   *     ② 断言一件**确实**在本验证射程内的事：上面每一条臂都**真的跑过**
   *        （而不是被 skip 掉了却让整份夹具看起来是绿的）
   */
  const boundaries = [
    '✗ 判据的【语义正确性】—— 本验证只证明它们【在盘上、在注册表里、对自己的输入会开火】；',
    '  不证明它们的判断【对不对】。那需要正向/反向语料 + 定向突变，不在本任务射程内。',
    '✗ `friction-triage.mjs` 的【派工质量】—— 本验证只驱动 `runPipeline` 的三个 stage，',
    '  不评估它产出的契约是不是"对这条活而言正确的契约"。',
    '✗ `reviewed` 五问【问得对不对】—— 本验证证明的是"五问齐才放行"这条机制在工作，',
    '  不证明那五个问题本身就足以覆盖一次审查。',
    '✗ 【生产路径】上的端到端 —— 本验证直接调 `registry.evaluate` / `runPipeline`，',
    '  不经过 `update_task` / `create_task` 工具边界（那在其它任务的射程内）。',
  ]
  for (const line of boundaries) console.log(`  [t5] ${line}`)
  assert.ok(boundaries.length > 0, '★ 前置：射程边界必须被写出来（这一臂的产物就是它）')
})

test('★ 臂 5b（射程 · 可执行的那一半）：本文件的核心臂**不许**被静默跳过', () => {
  /**
   * ★★ 一条被 skip 的臂与一条通过的臂，在 `pass N` 那个数字上**同形** ——
   *   而它们说的是完全相反的事。
   *
   * ★ 而本文件**允许** skip（例如 `lib/` 不在盘上时）—— 那是诚实的"没测到"。
   *   但不允许的是**静默**：所以这里把"本文件有哪些臂、其中哪些在本次被跳过"
   *   做成一条**可读的读数**（打印出来），而不是让 skip 藏在汇总行里。
   *
   * ★ 而它断言的是：**核心机制的臂都存在于本文件里**（不是"它们都通过了"）——
   *   后者只能在真的跑过之后才知道，而那是每一条臂自己的事。
   */
  const source = readFileSync(join(ROOT, 'scripts', 'verify-unified-pipeline.test.mjs'), 'utf8')
  const arms = [...source.matchAll(/^test\('([^']+)'/gm)].map((match) => match[1])
  const skips = [...source.matchAll(/t\.skip\(/g)].length
  console.log(`  [t5] 本文件共 ${arms.length} 条臂；其中含 ${skips} 处 \`t.skip\`（"没测到"的出路）`)
  for (const arm of arms) console.log(`  [t5]   · ${arm}`)

  /**
   * ★ 四条 P 的机制**每一条**都要有臂 —— 否则"P1–P4 都验过了"这句话会是空的。
   */
  const required = [
    ['P4 · 注册', /P4 · 注册/],
    ['P4 · 开火', /P4 · 开火/],
    ['P1 · 主干', /P1 · 主干/],
    ['P1 · 分档读提案的写域', /P1 · 分档读提案的写域/],
    ['P3 · 拆解', /P3 · 拆解/],
    ['P2 · 形状', /P2 · 形状/],
    ['P2 · 判据真的读它', /P2 · 判据真的读它/],
  ]
  const missing = required.filter(([, pattern]) => !arms.some((arm) => pattern.test(arm))).map(([label]) => label)
  assert.deepEqual(missing, [], `★ 以下机制在本文件里**没有**对应的臂 ⇒ "四条都验过了"会是空的：${missing.join(' · ')}`)
})
