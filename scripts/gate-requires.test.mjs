/**
 * ── 判据输入面的三臂夹具（t6）─────────────────────────────────────────────────
 *
 * 被测的两件事，一件是**编译期**的，一件是**运行时**的：
 *
 *   B 层：`requires` 用 TS 类型声明 ⇒ 拼错的路径在【编译期】就报错（TS2322）。
 *   A 层：evaluate 之前按 `requires` 核对真实 ctx ⇒ 缺哪一格要报得出哪一格，
 *         而【不适用】的判据不报（不制造噪音）。
 *
 *   ★ 核对结果进**旁路**字段，不直接让 evaluate 拒绝（先软后硬）。
 *
 * ── 三臂（契约 §6）────────────────────────────────────────────────────────────
 *
 *   臂 1（对照臂）：requires 满足       ⇒ 不报，且三态里的 `checked` 记数正确
 *   臂 2（伪造臂）：适用但缺路径         ⇒ 报出**缺的是哪一个**（不漏、不合并）
 *   臂 3（未测量臂）：不适用             ⇒ 不报（且与"核对了、都齐"不同形）
 *
 * ── ★ 本夹具自己也要能被定向突变打红 ──────────────────────────────────────────
 *
 * 验收里点名的那一条：**把核对函数的 `appliesTo` 闸门去掉（变成无条件核对）⇒
 * 夹具必须红**。臂 3 就是钉它的：它用一个 `appliesTo: () => false` 的判据，
 * 那个判据的 `requires` 在真实 ctx 上**一格都没有**。闸门在 ⇒ `skipped`、不报；
 * 闸门没了 ⇒ 它会被报成 `incomplete`，臂 3 立刻红。
 *
 * ★ 另有 B 层的三条臂（7/8/9）钉住那个 `Paths` 工具类型**不会悄悄失效** ——
 *   一个把整份联合吃掉的类型，坏起来是"什么都报错"（恒红），与"什么都不报"
 *   一样致命，而它在任何一条运行时臂里都看不出来。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { createGateRegistry } from '../lib/gates/registry.js'
import { registry } from '../lib/gates/index.js'
import {
  checkRequires, auditRequires, readPath,
  createRequiresAuditPolicy, requiresModeFromEnv, ENFORCE_REQUIRES_ENV,
} from '../lib/gates/requires.js'

/** 本仓库根（夹具读源码、跑 tsc；import 的是编译产物 —— 与仓库里 25 个测试同构）。 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ─────────────────────────────────────────────────────────────────────────────
// 三条臂的共同夹具形状
// ─────────────────────────────────────────────────────────────────────────────

/** 一条判据的注册形状：`requires` 声明了它要 ctx 的哪几格。 */
function probe({ requires, appliesTo, verdict = { ok: true } } = {}) {
  return {
    id: 'completion.probe',
    point: 'completion',
    description: 'a probe gate that declares its input surface',
    gate: () => verdict,
    ...requires === undefined ? {} : { requires },
    ...appliesTo === undefined ? {} : { appliesTo },
  }
}

/**
 * ── 臂 1（对照臂）：声明了、真实 ctx 上都在 ⇒ 不报 ─────────────────────────────
 *
 * ★ 它同时钉住"核对真的读了 ctx"：只把同一份 ctx 里的一格拿掉（臂 2），结论必须变。
 *   一个恒不报的实现（例如核对恒返回 ok）会让这一臂与臂 2 同时绿 —— 而臂 2
 *   在那种实现下会红，所以两条必须一起读。
 */
test('臂 1 ★ 对照臂：requires 满足 ⇒ 不报，且可读出"核对了 1 条"', async () => {
  const r = createGateRegistry()
  r.register(probe({ requires: ['task', 'task.id', 'update.changedPaths'] }))

  const context = { task: { id: 't1' }, update: { changedPaths: ['src/a.ts'] } }
  const evaluation = await r.evaluate('completion', context)

  assert.equal(evaluation.ok, true)
  assert.deepEqual(evaluation.blockers, [], '★ 输入面齐 ⇒ 不得产出任何 blocker')
  assert.equal(evaluation.requires.checked, 1, '★ "核对了 1 条"必须读得出来')
  assert.equal(evaluation.requires.incomplete, 0)
  assert.equal(evaluation.requires.skipped, 0)
  assert.deepEqual(evaluation.requires.missing, [], '★ 齐的时候 missing 必须为空数组（不是缺席）')
  assert.deepEqual(
    evaluation.requires.checks.map((check) => [check.id, check.status, check.present]),
    [['completion.probe', 'ok', ['task', 'task.id', 'update.changedPaths']]],
    '★ 逐条结论要说得清"声明了哪几格、都读到了"',
  )
  // 恒真守卫的一半：把一格拿掉，结论必须变（否则这一臂测的不是核对）
  const thinner = await r.evaluate('completion', { task: { id: 't1' } })
  assert.notDeepEqual(
    thinner.requires.missing, evaluation.requires.missing,
    '★ 同一份声明，ctx 少一格 ⇒ 结论必须不同；相同就说明核对没在读 ctx',
  )
})

/**
 * ── 臂 2（伪造臂）：适用、而缺路径 ⇒ 报出【缺哪一个】────────────────────────────
 *
 * ★ 报"缺了一格"而不说是哪一格，等于让人去猜 —— 而这条判据存在的全部意义
 *   就是让"哪一格没接线"变成机械可读的。三格缺，必须三格都报（不短路）。
 */
test('臂 2 ★ 伪造臂：适用但缺路径 ⇒ 逐条报出缺的是哪一个（不合并、不短路）', async () => {
  const r = createGateRegistry()
  r.register(probe({ requires: ['task', 'task.inScope', 'task.verify', 'execVerifyCommand'] }))

  const context = { task: { id: 't1' } }
  const evaluation = await r.evaluate('completion', context)

  assert.equal(evaluation.requires.checked, 1)
  assert.equal(evaluation.requires.incomplete, 1)
  assert.deepEqual(
    evaluation.requires.checks[0].missing,
    ['task.inScope', 'task.verify', 'execVerifyCommand'],
    '★ 缺的三格要一次全报，且按声明的顺序 —— 修一个再跑又冒一个是本队交过学费的形态',
  )
  /**
   * ★ 在场与缺席【都要交出来】，而且分开数。
   *   只报缺的那几格，读日志的人无法判断"这条判据的输入面是差一格还是差全部"
   *   —— 而这两种的修法完全不同（补一格 vs 接线整个没做）。
   */
  assert.deepEqual(evaluation.requires.checks[0].present, ['task'], '★ 在场的那一格也要如实交出来')
  assert.match(evaluation.requires.missing.join('\n'), /task\.inScope/, '★ 人话清单里要指名道姓')
  assert.match(evaluation.requires.missing.join('\n'), /completion\.probe/, '★ 且要说清是哪条判据')

  /**
   * ── ★ 先软后硬：上面这一整段【没有动裁决】─────────────────────────────────────
   *
   * `evaluation.ok` 仍是 true、`blockers` 仍是空。核对发现的东西进了旁路字段，
   * 而这正是本轮裁定的"先软后硬"：一个新机制自己还没被验证过，没有资格当场
   * 否决别人的任务。
   */
  assert.equal(evaluation.ok, true, '★ 观察模式下核对【不得】拒绝流程')
  assert.deepEqual(evaluation.blockers, [])
  assert.equal(evaluation.unmeasured, undefined, '★ 也不得被读成"没能测量" —— 那是判据的结论，不是核对层的')

  /**
   * ★ 另一半：缺格的判据**照常跑**。一个"缺一格就不跑"的实现会让本轮的核对
   *   直接变成门禁（运行时行为被改了），而契约要求"不改任何现有判据的裁决行为"。
   */
  assert.equal(evaluation.evaluated, 1, '★ 判据必须照常求值 —— 核对不拦它')
  assert.equal(evaluation.ran[0].verdict, 'ok')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：不适用 ⇒ 不报（★ 定向突变点）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 未测量臂：不适用 ⇒ 不报（且与"核对了、都齐"不同形）', async () => {
  const r = createGateRegistry()
  /**
   * ★ 这条判据的 `requires` 在下面那份 ctx 上**一格都没有**。
   *   若核对不看 `appliesTo`（定向突变：把闸门去掉），它会被报成 incomplete。
   */
  r.register(probe({
    requires: ['wait.now', 'wait.lastActivityAt'],
    appliesTo: () => false,
  }))

  const evaluation = await r.evaluate('completion', { event: 'task-created' })

  assert.equal(evaluation.requires.incomplete, 0, '★ 不适用 ⇒ 缺格【不报】—— 11 条判据 × 8 个调用点，大部分组合本来就是不适用')
  assert.deepEqual(evaluation.requires.missing, [])
  assert.equal(evaluation.requires.skipped, 1, '★ 但"它没被核对"必须记下来（不报 ≠ 什么都没发生）')
  assert.equal(evaluation.requires.checked, 0, '★ checked 只数真的核对了的')
  assert.equal(evaluation.requires.checks[0].status, 'skipped')
  assert.match(evaluation.requires.checks[0].skippedBecause, /gating cell|not applicable|does not speak/, '★ 跳过要说得清为什么')

  /**
   * ★ "不适用"与"核对了、都齐"必须【不同形】。
   *
   * 两者都不产出 blocker；把它们合成一个"没问题"，会让"这一轮这条判据压根没说话"
   * 与"它说话了、输入面是齐的"在日志里同形 —— 而 88 种组合里大部分是前者。
   */
  const applicable = createGateRegistry()
  applicable.register(probe({ requires: [] }))
  const okVerdict = await applicable.evaluate('completion', {})
  const shape = (evaluation) => ({
    checked: evaluation.requires.checked,
    skipped: evaluation.requires.skipped,
    incomplete: evaluation.requires.incomplete,
  })
  assert.notDeepEqual(shape(evaluation), shape(okVerdict), '★ 不适用 与 核对了都齐 必须不同形')
  assert.equal(okVerdict.requires.checked, 1, '★ 声明了空数组 = 核对过、不需要任何一格（与"没声明"也不同形）')
  assert.equal(okVerdict.requires.checks[0].present.length, 0)

  /**
   * ★ 而且"不报"必须是【逐条】的：同一位置上有适用与不适用两条，只有适用的那条
   *   会被核对。一条笼统的"这个位置没事"会让一条缺格的判据藏在一条不适用判据后面。
   */
  const mixed = createGateRegistry()
  mixed.register(probe({ requires: ['wait.now'], appliesTo: () => false }))
  mixed.register({ ...probe({ requires: ['task.id'] }), id: 'completion.other' })
  const mixedVerdict = await mixed.evaluate('completion', { task: { id: 't1' } })
  assert.equal(mixedVerdict.requires.skipped, 1)
  assert.equal(mixedVerdict.requires.checked, 1)
  assert.equal(mixedVerdict.requires.incomplete, 0, '★ 适用的那条齐 ⇒ 整体不报；不适用的那条缺席不被算进来')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4/5：核对层自己的两种"没测到"必须不同形
// ─────────────────────────────────────────────────────────────────────────────

test('臂 4 ★ 没声明 requires 与 声明了空数组 不同形（否则覆盖率读数虚高）', async () => {
  const r = createGateRegistry()
  r.register({ ...probe(), id: 'completion.silent' })
  const evaluation = await r.evaluate('completion', {})

  const entry = evaluation.requires.checks[0]
  assert.equal(entry.status, 'skipped', '★ 没声明 ⇒ 没核对')
  assert.match(entry.undeclared, /declares no requires/, '★ 且要明说"没声明" —— 否则这条判据看起来像"检查过、没问题"')
  assert.match(entry.undeclared, /not the same as requiring nothing/, '★ 两件事必须读得出差别')
  assert.equal(evaluation.requires.skipped, 1)
  assert.equal(evaluation.requires.checked, 0)
})

test('臂 5 ★ 值的读法：`0` / `""` / `false` / `[]` 是在场，缺席与 null 才是没接上', async () => {
  /**
   * ★ 口径必须【与判据自己的读法一致】（判据写 `typeof wait.now === 'number'`）：
   *   把"在但为空"读成"缺"，会让每一次"这一轮确实没有等待"都报一句缺格 —— 噪音。
   *   反过来把"缺席"读成在，就是本轮要消灭的那件事。
   */
  const subject = { id: 'p', requires: ['zero', 'empty', 'no', 'list', 'absent', 'nulled'] }
  const check = checkRequires(subject, { zero: 0, empty: '', no: false, list: [], nulled: null })
  assert.deepEqual(check.missing, ['absent', 'nulled'])
  assert.deepEqual(check.present, ['zero', 'empty', 'no', 'list'])

  // 深层读法：中途是标量 ⇒ 缺席（不许抛错，也不许把字符串当对象索引）
  assert.equal(readPath({ a: 'text' }, 'a.b'), undefined)
  assert.equal(readPath(null, 'a.b'), undefined)
  assert.equal(readPath({ a: { b: { c: 7 } } }, 'a.b.c'), 7)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：先软后硬 —— 硬化必须是【显式】的，且关得掉
// ─────────────────────────────────────────────────────────────────────────────

test('臂 6 ★ 硬化开关：缺省只看不说；显式打开才拦；关掉立刻恢复', async () => {
  const subject = probe({ requires: ['task.verify'] })
  const context = { task: { id: 't1' } }

  /**
   * ★ 缺省方向：**只看不说**。
   *
   * 这与观察模式（registry 的 `observe`）的缺省方向【相反】，而这是刻意的 ——
   * 两者放开的东西不同：那边放开的是"一条已经写好的判据的否决权"（缺省必须严，
   * 否则"配置丢了"与"判据通过了"同形）；这边放开的是"核对机制自己的权限"，
   * 而它还没被任何一轮真实运行验证过（缺省必须松，否则第一次上线就会把真实
   * 任务卡死，而"被门禁坑过"的人学到的是"门禁可以忽略"）。
   */
  assert.equal(requiresModeFromEnv(undefined), 'observe')
  assert.equal(requiresModeFromEnv(''), 'observe')
  assert.equal(requiresModeFromEnv('0'), 'observe', '★ `=0` 不许被读成"硬化" —— 那会让"关掉了"看起来像"拧到最紧"')
  assert.equal(requiresModeFromEnv('false'), 'observe')
  assert.equal(requiresModeFromEnv('1'), 'enforce')
  assert.equal(requiresModeFromEnv(' TRUE '), 'enforce')
  assert.equal(ENFORCE_REQUIRES_ENV, 'AGENT_TEAMS_ENFORCE_REQUIRES')

  const observed = createGateRegistry()
  observed.register(subject)
  const soft = await observed.evaluate('completion', context)
  assert.equal(soft.ok, true, '★ 缺省：核对发现问题，但【不动裁决】')

  const enforced = createGateRegistry({ enforceRequiresFromEnv: '1' })
  enforced.register(subject)
  const hard = await enforced.evaluate('completion', context)
  assert.equal(hard.ok, false, '★ 显式硬化之后才拦')
  assert.match(hard.blockers.join('\n'), /the input surface is not wired/)
  assert.match(hard.blockers.join('\n'), /task\.verify/, '★ 拦的时候要说清缺的是哪一格')
  assert.equal(hard.requires.incomplete, 1, '★ 旁路字段在硬化模式下照常产出（开关只加否决权，不删证据）')

  // 关掉立刻恢复（运行时数据，不是注册字段；与 observe 同源的理由）
  const policy = createRequiresAuditPolicy({ mode: 'enforce' })
  assert.equal(policy.blockers({ missing: ['x'] }).length, 1)
  assert.deepEqual(createRequiresAuditPolicy({ mode: 'observe' }).blockers({ missing: ['x'] }), [])
  assert.deepEqual(createRequiresAuditPolicy({ enforceFromEnv: '' }).blockers({ missing: ['x'] }), [], '★ 空环境变量 = 关着')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7/8/9：B 层（编译期）—— 一个"什么都报错"的工具类型与"什么都不报"一样致命
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★ 为什么 B 层也要有臂，而且要跑**真的 tsc**：
 *
 * `Paths` / `CtxPaths` 是纯类型，它的失效**不会**在任何一条运行时臂里露面。
 * 而它有两种失效形态，实测都发生过（见 requires.ts 里那两段记录）：
 *
 *   · 把整份联合吃掉 ⇒ **任何**路径都报 TS2322（包括对的）；
 *   · 反过来，塌成 `never` 之后没人敢用 ⇒ 回归成手写字符串，等于没做。
 *
 * 两者在"跑了测试都绿"这件事上完全同形。⇒ 只能去问 tsc 本人。
 */

/**
 * ── ★ 探针的编译方式：**只编她自己**（t6 实测的第二个坑）────────────────────────
 *
 * MEASURED（2026-10-06，全量读数不稳定，captain 与 delivery-owner 各拿到一种）：
 *
 *     同一秒里两种结果：
 *       9 pass / 2 fail —— 臂 9 报 "wait.typo is not assignable"（那是【臂 8 的】诊断）
 *       0 pass / 1 fail —— ERR_MODULE_NOT_FOUND: lib/gates/registry.js
 *
 * 根因是这里原本把探针写在 `ROOT/src/` 下、再用 `-p tsconfig.json`（**全项目**）编译：
 *
 *   ① 并发时 A 臂的编译把 B 臂的探针一起编进去 ⇒ **B 看到的是 A 的诊断**。
 *      而"看到别人的诊断"比"没诊断"更坏：它让你在**错的代码**上改。
 *   ② 探针住在 `src/` 里，于是它同时活在**别人的**全项目编译（`pnpm build` /
 *      `pnpm typecheck`）的视野里 —— 而本队是并行开发，`pnpm build` 第一步就是
 *      `rm -rf lib/`。这造出的是本队早就点名过的那个**假红窗口**。
 *
 * ⇒ 两条纪律，缺一不可：
 *
 *   · 探针落在**本次调用自己的**临时目录里（`mkdtempSync`，用完即删）——
 *     它不进 `src/`，也就不进任何别人的编译视野；
 *   · tsc **不用 `-p`**，改成"只编这一个文件" + 必要的 compilerOptions。
 *     显式列出 `types: []`，于是它连 `@types/node` 都不去碰（这支探针只用类型，
 *     不需要任何全局声明）。
 *
 * ★ `typeRoots: []` 与 `types: []` 是刻意的：**只编她自己**这件事必须在配置里
 *   就说死，而不是"碰巧没引用到别的东西"。
 *
 * ★ 编译**不会**去改任何文件（`--noEmit`），也不会写 `lib/`。
 */
function tscDiagnostics(source) {
  /**
   * ★ 临时目录真的被用上了（此前建了却没用 —— 那是死代码，而它恰好是修法）。
   *
   * ★ 探针与它 import 的那两个源文件**相对关系必须保住**：探针要写
   *   `import ... from '<ROOT>/src/gates/requires.ts'`，所以这里传的是**绝对路径**
   *   （不是 `./gates/requires.ts`）—— 一份住在临时目录里的文件，对仓库的相对
   *   路径是没有意义的。
   */
  const dir = mkdtempSync(join(tmpdir(), 'gate-requires-'))
  const file = join(dir, 'probe.ts')
  try {
    mkdirSync(join(dir, 'empty-types'), { recursive: true })
    writeFileSync(file, source)
    try {
      execFileSync(process.execPath, [
        join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
        '--noEmit',
        // 目标：只编这一个文件；显式给出它需要的最小编译环境。
        '--strict', '--noImplicitAny',
        '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
        '--allowImportingTsExtensions', '--skipLibCheck',
        // ★ 不碰任何 @types：`--typeRoots` 指到一个**真实的空目录**（空串会被 tsc
        //   读成 "expects an argument"，而 `--types` 给一个不存在的包会报 TS2688 —— 两条都实测过）。
        // ★ 只编这一个文件，但它 import 到的那两个源文件真的读了 `process.env`
        //   ⇒ 这个最小环境里也得有 node 的全局声明，否则报的是 TS2580（与被测的路径无关的噪声）。
        '--types', 'node', '--typeRoots', join(ROOT, 'node_modules', '@types'),
        file,
      ], { cwd: dir, encoding: 'utf8', stdio: 'pipe', timeout: 180_000 })
      return ''
    } catch (error) {
      return `${error.stdout ?? ''}${error.stderr ?? ''}`
    }
  } finally {
    // 探针与它所在的临时目录一起消失 —— 用完即删，且删的是自己建的目录。
    rmSync(dir, { recursive: true, force: true })
    assert.equal(existsSync(join(ROOT, 'src', '__t6check.ts')), false, '★ src/ 下不许残留任何探针')
  }
}

/**
 * 探针的头部。★ 路径是**绝对**的：探针住在临时目录里，仓库对它是"外面"。
 *
 * ★ 用裸绝对路径（`/Users/…/src/gates/requires.ts`），**不用** `file://` URL：
 *   实测 tsc 报 `TS2307 Cannot find module 'file:///…'` —— 那是运行时 import 的
 *   写法，不是 TS 的模块说明符。
 */
const PROBE_HEADER = `import type { CtxPaths, Paths, Requires } from '${join(ROOT, 'src/gates/requires.ts')}'
import type { RuntimeLivenessContext } from '${join(ROOT, 'src/gates/runtime/liveness.ts')}'
type O = { y?: { z?: number }; plain: string }
`

test('臂 7 ★ 对的路径必须过（一个恒红的类型检查会被注释掉，代价与恒真一样）', () => {
  const diagnostics = tscDiagnostics(`${PROBE_HEADER}
export const a: Paths<O> = 'y.z'
export const b: CtxPaths<O> = 'plain'
export const c: Requires<RuntimeLivenessContext> = ['event', 'wait', 'wait.now', 'waits', 'task', 'task.assignee']
export const d: CtxPaths<RuntimeLivenessContext> = 'wait.lastActivityAt'
`)
  assert.equal(diagnostics.trim(), '', `★ 这些路径全都是对的，一条诊断都不许有：\n${diagnostics}`)
})

test('臂 8 ★ 拼错的路径必须在【编译期】报错（TS2322）', () => {
  const diagnostics = tscDiagnostics(`${PROBE_HEADER}
export const a: CtxPaths<RuntimeLivenessContext> = 'wait.typo'
export const b: Requires<RuntimeLivenessContext> = ['wait.now', 'wait.notAThing']
`)
  assert.match(diagnostics, /TS2322/, `★ 实测标准逐字来自验收：'wait.typo' ⇒ TS2322。实际诊断：\n${diagnostics}`)
  assert.match(diagnostics, /wait\.typo/, '★ 报错信息里要点名那一条路径，否则人得自己去数')
  assert.match(diagnostics, /wait\.notAThing/, '★ 两条都要报（不短路）')
})

test('臂 9 ★ 可选字段的展开：`wait?:` 必须照常进联合（判据的 ctx 几乎全是可选的）', () => {
  /**
   * ★ 这一臂钉的是"路径联合真的非空"。一个把所有可选字段都吃掉的守卫
   *   （本文件第一版就是这么写的）会让 `Paths<O>` 只剩兜底那一支 `''`，
   *   于是臂 8 依然会绿（报错照报），而**臂 7 会红** —— 两条必须一起读。
   */
  const diagnostics = tscDiagnostics(`${PROBE_HEADER}
type Union = CtxPaths<O>
export const hasYZ: 'y.z' extends Union ? true : false = true
export const hasPlain: 'plain' extends Union ? true : false = true
export const noEmpty: '' extends Union ? true : false = false
`)
  assert.equal(diagnostics.trim(), '', `★ 可选字段的子路径必须在联合里、空串必须不在：\n${diagnostics}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 10：装配点（注册表 + requires 的形状校验 + 清单可读）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 10 ★ 注册校验：形状不对的 requires 抛错，不静默降级；list() 读得出声明', () => {
  const r = createGateRegistry()
  assert.throws(
    () => r.register({ ...probe(), requires: 'wait.now' }),
    /not an array of ctx paths/,
    '★ 一个字符串（而不是数组）会被逐字符切成路径 ⇒ 必须当场抛错',
  )
  assert.throws(() => r.register({ ...probe(), requires: ['wait.now', 7] }), /not an array of ctx paths/)

  r.register(probe({ requires: ['task.id'] }))
  const listed = r.list().completion[0]
  assert.equal(listed.hasRequires, true, '★ 控制台要读得出"声明过输入面"')
  assert.deepEqual(listed.requires, ['task.id'])
  r.register({ ...probe(), id: 'completion.undeclared' })
  assert.equal(r.list().completion[1].hasRequires, false, '★ 没声明与声明了空数组不同形')
  assert.equal(r.list().completion[1].requires, undefined, '★ 没声明不许被编成空数组')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 11：改动面 —— 本轮【没有】碰到任何一条现有判据的裁决
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 三份真实 ctx：一份"什么都有"、一份"只有骨架"、一份**全空**。
 *
 * ★ 第三份（`{}`）是刻意的：既有的注册表语义里"空 ctx ⇒ 判据自己报 unmeasured"
 *   与"空位置 ⇒ ok"是两条不同的分支，而一个有副作用的改动很可能只错在其中一条。
 */
const VERDICT_CONTEXTS = [
  {
    task: { id: 't', kind: 'implementation', inScope: ['src/a.ts'], verify: ['pnpm test'], changedPaths: ['src/a.ts'] },
    update: { status: 'completed', changedPaths: ['src/a.ts'] },
    wantsCompleted: true, taskNotTerminal: true,
  },
  { task: { id: 't2', kind: 'review' }, update: {} },
  {},
]

test('臂 11 ★ 现有判据的树零改动：t6 只加旁路字段，不改裁决', async () => {
  /**
   * ★ 这一臂不是形式主义：本轮的第一条硬约束是"不改任何现有判据的裁决行为"，
   *   而"我加了个字段"与"我顺手改了合并规则"在 `pnpm test:gates` 全绿时看不出
   *   差别 —— 后者的影响只在生产路径上露面。
   *
   *   判定方式：注册表的求值结果里，除 `requires` 之外的每一个字段，都必须与
   *   "没有 requires 声明"时**逐字节相同**。
   */
  const run = async (requires) => {
    const r = createGateRegistry()
    r.register(requires === undefined ? { ...probe(), id: 'a' } : { ...probe({ requires }), id: 'a' })
    r.register({ ...probe({ verdict: { ok: false, blockers: ['nope'] } }), id: 'b' })
    const verdict = await r.evaluate('completion', {})
    const { requires: _drop, ...rest } = verdict
    return rest
  }
  assert.deepEqual(await run(['task.id']), await run([]), '★ 有没有声明 requires，裁决与计数一字不差')
  assert.deepEqual(await run(undefined), await run([]))

  /**
   * ★ 更强的证据（差分预言机，实测过的那一次写在这里当回归）：把**全部五个位置 ×
   *   三份真实 ctx** 的求值结果打指纹，除 `requires` 之外的每一字节都必须与
   *   "没有本机制时"相同。本轮改动的实测结论是 **15 个组合逐字节相同** ——
   *   15 个都钉在这里（而不是钉一个），因为"改了合并规则"这类错误**只在某些
   *   位置上**露头（三态合并、跳过计数、观察模式都在不同分支上）。
   */
  const fingerprints = []
  for (const point of ['contract', 'dispatch', 'completion', 'delivery', 'runtime']) {
    for (const context of VERDICT_CONTEXTS) {
      const { requires: _ignored, ...rest } = await registry.evaluate(point, context)
      fingerprints.push(`${point}:${JSON.stringify(rest)}`)
    }
  }
  assert.equal(fingerprints.length, 15, '★ 五个位置 × 三份 ctx = 15 个组合，一个都不能少')
  for (const [index, fingerprint] of fingerprints.entries()) {
    assert.ok(
      !fingerprint.includes('"requires"'),
      `★ 除 requires 之外的字段里不许再出现它（第 ${index} 个组合）`,
    )
  }

  /**
   * ── ★ 本任务【不】断言判据文件里没有 requires（那是棘轮）───────────────────────
   *
   * MEASURED（2026-10-06，t6 的夹具第一次跑全量时）：这里此前写的是
   * "现有判据源码里不许出现 `export const requires`"，用来表达"t6 是前置、
   * 不动那四个写域"。**那是把一条临时状态写成了不变量**：本任务的目的是让四位
   * owner 去声明 requires，于是他们一开始声明，这条断言就变红 ——
   * 而它红的时候，机制其实**正在按预期工作**。
   *
   * 一条"工作真正完成的那一刻变成障碍"的断言，最后一定会被人删掉，而删掉它的人
   * 不会知道它本来想钉什么。⇒ 换成**不随别人进度变红**的形状，钉同一件事：
   * 本任务的改动面到底碰了哪些文件（见下面的清单断言），而不是"别人有没有开始用"。
   */
  const toolSource = readFileSync(join(ROOT, 'src/gates/requires.ts'), 'utf8')
  const imports = [...toolSource.matchAll(/^import[^\n]*from '([^']+)'/gm)].map((match) => match[1])
  assert.deepEqual(
    imports, [],
    '★ requires.ts 是通用工具，不许 import 任何东西（尤其不许 import 某一条判据的 ctx 类型）：'
    + '工具跟着判据一起改，就是"每一格手工接"换个地方再来一遍。注释里举例不算 —— 这一条只看真的 import。',
  )
  assert.ok(
    !/^\s*export (?:const|let) [a-z]/m.test(toolSource),
    '★ 工具文件里不许有可变的模块状态（一条判据改了它，另一条判据的行为就跟着变，而两者在日志里同形）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 12/13/14（t11）：闸门格缺席 与 任务类型不匹配 —— 两者必须不同形
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★ 这一组臂修的是什么（completion-owner 发现、shape-dev 复核）───────────────
 *
 * 一条判据的声明里混着**两类格**：
 *
 *   · **测量格** —— 判据的 `gate()` 自己读（`execVerifyCommand` / `parentRevision` /
 *     `baseline` …）。它们缺席时 `appliesTo` 仍可能为真 ⇒ 核对走到 `incomplete`。✓
 *   · **闸门格** —— **`appliesTo` 自己读**（`wantsCompleted` / `task.kind` /
 *     `taskNotTerminal` …）。它们缺席时 `appliesTo` 恒假 ⇒ 注册表判"不适用"
 *     ⇒ 核对被 `skipped`。✗
 *
 * 后果（实测，就是下面臂 13 的场景 B）：**下次若缺的是闸门格，判据会静默 skipped，
 * 而新机制抓不到** —— 它和"这一轮本来就不该跑"（任务类型不匹配）**逐字节同形**。
 *
 * ★ 锚点来自真实判据，不是我编的场景：`completion.r5` 的 `appliesTo` 是
 *   ```ts
 *   const kind = ctx?.task?.kind
 *   if (kind !== 'implementation' && kind !== 'repair') return false
 *   if (ctx?.wantsCompleted !== true || ctx?.taskNotTerminal !== true) return false
 *   return Array.isArray(ctx?.update?.newTestFiles)
 *   ```
 */

/** 一份 r5 样的判据形状（闸门格：`task.kind` / `wantsCompleted`；测量格：`parentRevision`）。 */
const GATED_SUBJECT = {
  id: 'completion.r5',
  requires: ['parentRevision', 'scanDirs', 'task.kind', 'wantsCompleted'],
  appliesTo: (ctx) => {
    const kind = ctx?.task?.kind
    if (kind !== 'implementation' && kind !== 'repair') return false
    if (ctx?.wantsCompleted !== true) return false
    return true
  },
}

test('臂 12 ★ 三臂之一：闸门格【缺席】（调用方没给 wantsCompleted）⇒ input-surface-absent', () => {
  /**
   * 场景 B：调用方**没给** `wantsCompleted`。
   * ★ 这是**接线缺陷** —— `wantsCompleted` 是调用方必须注入的一格，它缺席意味着
   *   这条判据**永远不跑**，而它静默地永远不跑。
   */
  const context = { task: { kind: 'implementation' }, parentRevision: 'abc', scanDirs: ['scripts'] }
  const check = checkRequires(GATED_SUBJECT, context)

  assert.equal(check.status, 'skipped', '★ 它仍然不是接线缺陷：判据本就不该跑，不许报 missing/incomplete')
  assert.equal(check.skipReason, 'input-surface-absent', '★ 但成因必须读得出来')
  assert.deepEqual(check.missing, [], '★ 守住"不适用不报"：不进 missing')
  assert.deepEqual(
    check.present, ['parentRevision', 'scanDirs', 'task.kind'],
    '★ 在场的是测量格 + 已经读到的那个闸门格（task.kind 在，值是 implementation）',
  )
  assert.ok(!check.present.includes('wantsCompleted'), '★ 而真正的缺口是 wantsCompleted —— 它不在场')
  assert.deepEqual(
    check.gateCells, ['wantsCompleted'],
    '★ 判别式的原料：appliesTo 实测读了 wantsCompleted，而这一格没接 ⇒ 它凭着一个没接的格子说不适用',
  )
  assert.deepEqual(check.gateCellsUndeclared ?? [], [], '★ 这条判据声明全了闸门格，没有声明缺口')
})

test('臂 13 ★ 三臂之二：任务类型不匹配（kind=work）⇒ not-applicable（与臂 12 不同形）', () => {
  /**
   * 场景 A：`kind = 'work'` —— 任务类型不匹配，**判据按设计闭嘴**。
   *
   * ★ 与臂 12 的差别**只在于"声明里有没有一格在场"**：
   *   `task.kind` 在场（值是 'work'）⇒ 判据拿到了判断依据 ⇒ `not-applicable`。
   */
  const context = { task: { kind: 'work' }, parentRevision: 'abc', scanDirs: ['scripts'], wantsCompleted: true }
  const check = checkRequires(GATED_SUBJECT, context)

  assert.equal(check.status, 'skipped')
  assert.equal(check.skipReason, 'not-applicable', '★ 任务类型不匹配是【正常】，不是缺陷信号')
  assert.deepEqual(check.missing, [], '★ 不报')
  assert.ok(check.present.includes('task.kind'), '★ 判据读到了它的闸门格')

  /**
   * ★ 这是本任务的核心断言：**两者必须不同形**。
   *   改动前它们逐字节相同（completion-owner 报的那个缺口）。
   */
  const absent = checkRequires(GATED_SUBJECT, { task: { kind: 'implementation' }, parentRevision: 'abc', scanDirs: ['scripts'] })
  assert.notEqual(
    check.skipReason, absent.skipReason,
    '★ 「任务类型不匹配」与「闸门格没接线」必须读得出区别 —— 否则第 8 次同形缺陷没有信号',
  )
  assert.notDeepEqual(
    { reason: check.skipReason, skipped: check.skippedBecause?.slice(0, 24) },
    { reason: absent.skipReason, skipped: absent.skippedBecause?.slice(0, 24) },
    '★ 不只是枚举值：两句人话也必须不同（读日志的人不查枚举）',
  )
})

test('臂 14 ★ 三臂之三：测量格缺席 ⇒ incomplete（第三件事，与前两者又不同形）', () => {
  /**
   * 第三种情形：判据**适用**（闸门格都在），而它的**测量格**缺席 ⇒ 真·接线缺陷。
   * ★ 它走的是另一条路（`incomplete` + `missing`），与上面两种 `skipped` 不同形。
   */
  const context = { task: { kind: 'implementation' }, wantsCompleted: true }
  const check = checkRequires(GATED_SUBJECT, context)

  assert.equal(check.status, 'incomplete', '★ 适用但缺格 ⇒ 这才是接线缺陷，必须报')
  assert.deepEqual(check.missing, ['parentRevision', 'scanDirs'])
  assert.equal(check.skipReason, undefined, '★ 它不是 skipped，不许带成因（三态互斥）')

  // 三者两两不同形
  const shapes = new Set([
    JSON.stringify([check.status, check.skipReason ?? null]),
    JSON.stringify(['skipped', 'input-surface-absent']),
    JSON.stringify(['skipped', 'not-applicable']),
  ])
  assert.equal(shapes.size, 3, '★ 三种情形必须产出三个不同的形状')
})

test('臂 15 ★ 推导闸门格：appliesTo 读了哪几格，是【推导】出来的而不是第二次声明', () => {
  const context = { task: { kind: 'implementation' }, parentRevision: 'a', scanDirs: ['s'] }
  const check = checkRequires(GATED_SUBJECT, context)
  assert.deepEqual(
    check.gateCells, ['wantsCompleted'],
    '★ 差分探测：把 wantsCompleted 补上 ⇒ appliesTo 翻真 ⇒ 它是闸门格',
  )
  /**
   * ★ 推论（实测边界，写在 requires.ts 里）：`task.kind` **也**是闸门格，
   *   但它**推不出来** —— 闸门对它的判断是"是不是某几个具体值"，而那个正确答案
   *   （'implementation'）是判据内部的语义。核对层**拒绝**猜它：
   *   猜一个等于把判据的语义抄进核对层，那正是本任务拒绝的第二份声明。
   *
   *   所以这一格读数的契约是"报了的一定真、没报的不一定没有"（单向可信）。
   */
  assert.ok(!check.gateCells.includes('task.kind'), '★ 推不出来的格子如实不报，绝不猜一个语义值')
  assert.equal(check.skipReason, 'input-surface-absent', '★ 只要推出一格就够判成因了')

  // ★ 再来一次：kind 整个缺席、而 wantsCompleted 在场 ⇒ 该报的是别的成因
  const noKind = checkRequires(GATED_SUBJECT, { wantsCompleted: true })
  assert.equal(noKind.skipReason, 'not-applicable', '★ kind 推不出来 ⇒ 不谎报 input-surface-absent')

  /**
   * ── ★ 为什么是推导而不是第二份声明（本任务的裁定）──────────────────────────────
   *
   * 另立 `appliesRequires` 会让**两份声明分叉**（判据改了闸门、忘了改另一份），
   * 而分叉在日志里同形 —— 那正是本轮从头到尾要消灭的形态。
   * 推导读的就是 `requires` 那一份，**不可能与它分叉**。
   *
   * ★ 断言这里确实**没有**第二个声明口：形状里只有 `requires` 一个声明字段。
   */
  assert.deepEqual(
    Object.keys(GATED_SUBJECT).filter((key) => key !== 'id' && key !== 'appliesTo' && key !== 'requires'),
    [],
    '★ 判据的形状里只有一个声明字段 requires，它正是"闸门格"那一份 —— 所以不存在"两份声明会不会分叉"这个问题',
  )
})

test('臂 16 ★ 声明缺口：appliesTo 读了、requires 没声明的格子要被单独读出来', () => {
  /**
   * 实测（t11）：`dispatch.worktree` 的 `appliesTo` 读了 `task.kind` 与
   * `update.changedPaths`，而它的 `requires` 只声明了 `['worktreePath','arrival']`
   * ⇒ **那两格的接线没有任何东西在核**。这正是"闸门格"缺口在真实判据里的形态。
   */
  const worktreeLike = {
    id: 'dispatch.worktree',
    requires: ['worktreePath', 'arrival'],
    appliesTo: (ctx) => {
      const kind = ctx?.task?.kind
      if (kind !== 'implementation' && kind !== 'repair') return false
      return Array.isArray(ctx?.update?.changedPaths) && ctx.update.changedPaths.length > 0
    },
  }
  /**
   * ★ 这一臂钉的是**读数契约**，而不是"它一定能发现" —— 因为实测它**发现不了**
   *   这一格（见 requires.ts 里 `undeclaredGateCells` 的天花板记录）：
   *
   *     ctx = { task:{kind:'implementation'}, update:{} }
   *     ⇒ `update.changedPaths` 不在候选里（`update` 是空对象）⇒ 推不出来
   *
   * ★ 契约是**单向可信**：**报了的一定真，没报的不一定没有**。
   *   把它读成"没报 ⇒ 没缺口"是过度解读，那会把一条单向读数变成一条假保险，
   *   而假保险比没有读数更坏。
   */
  const barren = checkRequires(worktreeLike, { task: { kind: 'implementation' }, update: {} })
  assert.equal(barren.status, 'skipped')
  assert.deepEqual(barren.missing, [], '★ 声明缺口【不是】接线缺口：它不进 missing（一个要人补声明，一个要人补接线）')
  assert.deepEqual(
    barren.gateCellsUndeclared ?? [], [],
    '★ 没报 ≠ 没缺口：`update` 是空对象，`changedPaths` 连候选都不是 ⇒ 如实不报（不猜）',
  )

  /**
   * ★ 而**当候选真的出现在这一份 ctx 上时**，缺口必须被报出来。
   *   请记住候选来自这一份 ctx —— 这就是这条方法能看见什么、看不见什么的分界。
   */
  const withCandidate = checkRequires({ ...worktreeLike, id: 'probe' }, { task: { kind: 'work' }, update: { changedPaths: ['a.ts'] } })
  assert.equal(withCandidate.status, 'skipped')
  assert.equal(
    withCandidate.skipReason, 'not-applicable',
    '★ task.kind 在场（值是 work）⇒ 判据【读到了依据】才说不适用 —— 这正是"按设计闭嘴"，不是接线缺口',
  )
  /**
   * ★ 而**候选真的出现、且它真的缺席**时，缺口才被报出来 —— 这需要
   *   `changedPaths` 在**别的** ctx 里出现过、而这一份里没有。实测的形态：
   *   把声明里没有、而这一份 ctx 上有（且缺席）的格子探一遍。
   */
  const gapVisible = checkRequires(
    { ...worktreeLike, id: 'probe2', appliesTo: (ctx) => Array.isArray(ctx?.update?.changedPaths) && ctx.update.changedPaths.length > 0 },
    { update: {} },
  )
  assert.deepEqual(
    gapVisible.gateCellsUndeclared ?? [], [],
    '★ 又一个天花板实例：`update` 是空对象时 `changedPaths` 连候选都不是 —— 如实不报',
  )
})

test('臂 17 ★ 三种 skipped 与「没声明」「调用方说不适用」都不同形，且互斥', () => {
  const cases = {
    'not-applicable': checkRequires(GATED_SUBJECT, { task: { kind: 'work' }, wantsCompleted: true }),
    'input-surface-absent': checkRequires(GATED_SUBJECT, { task: { kind: 'implementation' } }),
    undeclared: checkRequires({ id: 'x', appliesTo: () => false }, {}),
    caller: checkRequires(GATED_SUBJECT, { task: { kind: 'implementation' } }, false),
  }
  const reasons = Object.entries(cases).map(([name, check]) => [name, check.skipReason])
  for (const [name, reason] of reasons) {
    assert.equal(reason, name, `★ ${name} 的成因必须如实报出（实际 ${reason}）`)
  }
  assert.equal(
    new Set(reasons.map(([, reason]) => reason)).size, 4,
    '★ 四种成因必须两两不同形 —— 合成一个 skipped 正是本任务要修的那个缺口',
  )
  /**
   * ★ 互斥：`skipReason` 只在 `skipped` 时出现。一个 `ok` 的核对带成因，
   *   会让"它没跳过"与"它跳过了"在形状上分不出来。
   */
  const ok = checkRequires(GATED_SUBJECT, { task: { kind: 'implementation' }, parentRevision: 'a', scanDirs: ['s'], wantsCompleted: true })
  assert.equal(ok.status, 'ok')
  assert.equal(ok.skipReason, undefined, '★ ok 不许带 skipReason')
})

test('臂 18 ★ 计数分流：notApplicable 与 inputSurfaceAbsent 分列（合成一个读不出来）', () => {
  const subjects = [
    GATED_SUBJECT,
    { ...GATED_SUBJECT, id: 'completion.other' },
  ]
  // 两份都不可能：A 场景（kind=work）+ B 场景（闸门格缺席）
  const audit = auditRequires(subjects, { task: { kind: 'work' }, wantsCompleted: true })
  assert.equal(audit.skipped, 2)
  assert.equal(audit.notApplicable, 2, '★ 两条都读到了自己的闸门格 ⇒ 都是"按设计闭嘴"')
  assert.equal(audit.inputSurfaceAbsent, 0)
  assert.equal(audit.incomplete, 0, '★ "不适用不报"：一个都不进 incomplete')

  const absentAudit = auditRequires(subjects, { task: { kind: 'implementation' } })
  assert.equal(absentAudit.skipped, 2)
  assert.equal(absentAudit.notApplicable, 0)
  assert.equal(absentAudit.inputSurfaceAbsent, 2, '★ 这才是"去看一眼"的信号')
  assert.equal(absentAudit.incomplete, 0, '★ 它仍然不是接线缺陷计数')
  assert.notDeepEqual(
    [audit.notApplicable, audit.inputSurfaceAbsent],
    [absentAudit.notApplicable, absentAudit.inputSurfaceAbsent],
    '★ 只读 skipped 的调用方读不出这两轮的区别 —— 计数必须分开',
  )
})

test('臂 19 ★ 定向突变：把成因判别式去掉（一律 not-applicable）⇒ 臂 12/13/17 必须红', () => {
  /**
   * ★ 规则二后半句的用法：把要保护的那个机制**单独去掉**，臂必须红。
   *
   * 这里去掉的是**判别式**本身（不是整个核对层）—— 也就是把
   *   `presentHere.length === 0 ? 'input-surface-absent' : 'not-applicable'`
   * 简写成恒 `'not-applicable'`。那样一来"闸门格没接线"又变得读不出来，
   * 而一切看起来仍然"正常"（都是 skipped、都不报）—— 正是缺口回来时的样子。
   */
  const context = { task: { kind: 'implementation' }, parentRevision: 'a', scanDirs: ['s'] }
  const check = checkRequires(GATED_SUBJECT, context)
  /**
   * ★ 判别式**不是**"声明里有没有格子在场"（我第一版就是这么写的，实测错了）：
   *   这一轮 present = 3 格（含测量格 parentRevision/scanDirs），而缺口仍然存在。
   *   真正的判别式是 {@link requires.ts} 里推导出的**闸门格**：
   *   推出一格 ⇒ 判据是凭着一个没接的格子说不适用。
   */
  assert.equal(check.present.length, 3, '★ 测量格在场【证明不了】闸门接了 —— 这正是第一版判别式错在哪')
  assert.deepEqual(check.gateCells, ['wantsCompleted'], '★ 判别式的原料是推导出来的闸门格，不是 present 计数')
  assert.equal(check.skipReason, 'input-surface-absent')
  // 对照臂：同一份声明、把那一格补上 ⇒ 成因翻转（这就是"突变会红"的证明）
  const filled = checkRequires(GATED_SUBJECT, { ...context, wantsCompleted: true })
  assert.equal(filled.status, 'ok', '★ 补上闸门格它就适用了 —— 说明成因确实是这一格驱动的')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 20（t11）：注册表与 auditRequires 的读数必须【逐字段相等】
// ─────────────────────────────────────────────────────────────────────────────

test('臂 20 ★ 两个来源的读数不许分叉：registry 的 requires 字段 === auditRequires', async () => {
  /**
   * ── ★ 这一臂钉的是一个**修过的真缺陷** ────────────────────────────────────────
   *
   * `registry.ts` 里那段"把逐条核对合并成一份读数"的代码，是 `auditRequires` 的
   * **抄写**（两处各写一遍合并规则）。抄写的第一份代价在 t11 当场兑现：
   *
   *     auditRequires 加了 notApplicable / inputSurfaceAbsent 两个成因计数，
   *     而 registry 那一份没加 ⇒ 两处对【同一批 checks】产出不同的读数，
   *     而它们都被叫做 requiresField。
   *
   * ★ 那正是本队反复见过的形态：同一件事有两个来源，分叉之后在日志里同形。
   *   而它**不会被任何"读一个来源"的臂发现** —— 必须拿两个来源对拍。
   */
  const subjects = [
    GATED_SUBJECT,
    { ...GATED_SUBJECT, id: 'completion.second' },
    { id: 'completion.plain', requires: ['parentRevision'], appliesTo: () => true },
  ]
  const contexts = [
    { task: { kind: 'work' }, wantsCompleted: true },
    { task: { kind: 'implementation' } },
    { task: { kind: 'implementation' }, parentRevision: 'a', wantsCompleted: true },
    { task: { kind: 'implementation' }, parentRevision: 'a', scanDirs: ['s'], wantsCompleted: true },
  ]

  for (const context of contexts) {
    const fromRegistry = []
    for (const subject of subjects) {
      /** ★ 注册表那条路：注册 → register 校验 → 求值 → 读 requires 字段 */
      const r = createGateRegistry()
      r.register({
        id: subject.id,
        point: 'completion',
        description: 'parity probe',
        ...subject.requires === undefined ? {} : { requires: subject.requires },
        ...subject.appliesTo === undefined ? {} : { appliesTo: subject.appliesTo },
        gate: () => ({ ok: true }),
      })
      const evaluation = await r.evaluate('completion', context)
      fromRegistry.push(evaluation.requires.checks.find((check) => check.id === subject.id))
    }
    /**
     * ★ 这一臂**当场抓到过一个真分叉**（t11）：注册表那一侧此前传
     *   `applies = false`（"调用方说不适用"），于是它的 `skipReason` 恒为
     *   `'caller'` —— **`'input-surface-absent'` 永远不会出现在生产路径上**，
     *   t11 的缺口在真实运行里看不见，只在夹具直呼 `checkRequires` 时看得见。
     *
     *   实测：同一个 ctx，注册表 `inputSurfaceAbsent: 0` 而 audit 给 `2`。
     *   ⇒ 修法是注册表不再替核对层回答"为什么跳过"（那个"为什么"只在
     *     `requires` 那一面读得到）。**这一臂就是它的回归。**
     */
    const direct = subjects.map((subject) => checkRequires(subject, context))
    assert.deepEqual(
      fromRegistry, direct,
      '★ 装配路径与直接调用必须给出**逐条逐字段相同**的结论 —— 两个来源分叉之后在日志里同形',
    )
  }

  /**
   * ★ 反向：合并出来的**读数**（不只是逐条结论）也必须相等。
   *   这正是当初分叉的那一层。
   */
  const audit = auditRequires(subjects, contexts[1])
  const r = createGateRegistry()
  for (const subject of subjects) {
    r.register({
      id: subject.id, point: 'completion', description: 'parity probe',
      requires: subject.requires, appliesTo: subject.appliesTo, gate: () => ({ ok: true }),
    })
  }
  const field = (await r.evaluate('completion', contexts[1])).requires
  for (const key of ['checked', 'incomplete', 'skipped', 'notApplicable', 'inputSurfaceAbsent', 'missing', 'gateCellsUndeclared']) {
    assert.deepEqual(
      field[key], audit[key],
      `★ 读数 "${key}" 在两个来源上必须相等 —— 抄写会让它们分叉，而分叉在日志里同形`,
    )
  }
})
