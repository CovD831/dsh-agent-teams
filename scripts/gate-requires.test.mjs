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
  assert.match(evaluation.requires.checks[0].skippedBecause, /appliesTo/, '★ 跳过要说得清为什么')

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
