/**
 * ── 变异测试判据（`completion.mutation` + `src/mutation.ts`）的三臂夹具 ────────────
 *
 * 契约要求每条判据自带三臂（`docs/GATE-REGISTRY.md` §6）：
 *
 *   臂 1（伪造臂）：装饰性测试 —— 交付的测试对变异体【全部存活】
 *                   ⇒ 期望 blocked，且【报出存活数与覆盖范围】（不是一个光秃秃的分数）
 *   臂 1b（伪造臂）：范围外的变异不被计入 —— 只有【改动行】进分母
 *   臂 2（未测量臂）：杀手套件【够不到】被变异文件 ⇒ 期望 unmeasured
 *                     ★ 不是"全存活" —— 那是把【探针的失败】报成【被测物的失败】
 *   臂 3（对照臂）：足够强的测试杀掉变异体 ⇒ 期望 ok（证明判据不误伤正常成员）
 *
 * ── 它防的是什么失效（MEASURED，借鉴项目的一轮真实交付）─────────────────────────
 *
 * 一个任务加了 25KB 的测试文件、全套绿、审查也过了 —— 而把 `||` 翻成 `&&` 之后
 * 【一条红的都没有】。套件是装饰性的，而它在日志里与"做完了"完全同形。
 * `completion.verify-rerun` 堵不住它（命令真跑了），
 * `dispatch.changed-paths` 也堵不住它（文件真是它动的）。本条问的是第三个问题：
 * 【把实现改坏，测试会不会红】。
 *
 * ── ★ 本夹具的结构：同一个判据，同一批变异体，两个套件 ──────────────────────────
 *
 *   fixtures/mutation-sut.mjs       被变异的实现（7 个分支的治理路由 + 入口准入）
 *   fixtures/mutation-hollow.test.mjs   装饰性套件（绿，且几乎不断言任何分支）
 *   fixtures/mutation-rigorous.test.mjs 严格套件（把每个分支的行为都钉死）
 *
 * ⇒ 伪装的差别【就是】测量本身：相同变异体、不同杀伤率。
 *
 * ── 为什么夹具自己起子进程 ────────────────────────────────────────────────────
 *
 * 判据是纯数据变换（I/O 由调用方注入），但"注入什么"必须是真的：本夹具用一个
 * 临时目录（SUT 的 copy）当写域、用 `node --test` 起真实 runner。判据拿到的
 * 是真实的退出码与真实的汇总行 —— 不是替身。
 *
 * ★ 下面每一个 `writeFileSync` 的目标路径都由夹具自己 `join(tmpdir(), ...)` 得出，
 *   并就地校验落在临时目录内再调用；绝不触碰 workspace 里的任何文件。
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { gate, appliesTo, id, point, DEFAULT_MIN_KILL_RATE } from '../lib/gates/completion/mutation.js'
import { parseTestSummary } from '../lib/mutation.js'

const run = promisify(execFile)

/**
 * ── ★ 夹具的语料【内联】在本文件里，不落到别的文件 ──────────────────────────────
 *
 * 理由不是省文件，是两件实测的事：
 *
 *   ① 【写域】本任务的 inScope 只有三个路径。任何额外的夹具文件都会被判成
 *      `undeclared`（`classifyChangedPath` 实测）⇒ 一份好端端的夹具会因为
 *      "它落在哪" 而不是 "它测什么" 被拒。
 *   ② 【隔离】内联之后夹具自给自足：它只往 `mkdtempSync` 出来的沙箱写，
 *      **一次都不读不写共享仓库** ⇒ 整包并行跑时不可能被别的套件的 git 活动干扰。
 *
 * ── 被变异对象（SUT）：形状取自那个 MEASURED 的失效 ───────────────────────────
 *
 * "一个任务加了 25KB 的测试文件、全套绿、审查通过 —— 而把 `||` 翻成 `&&`
 *  之后一条红的都没有。" 这里缩成两个函数：一个 7 分支的治理路由 + 一个准入判断。
 */
const SUT_SOURCE = `/**
 * 被变异对象（SUT）。workspace 里的这一份永远是好的 —— 它只被写进沙箱。
 */

/** 把一个请求路由到某个记忆域。7 个分支 —— 就是文档里那个"治理路由"。 */
export function routeMemoryDomain(request) {
  if (request === null || request === undefined) return 'none'
  if (request.scope === 'session' && request.actor === undefined) return 'deny'
  if (request.scope === 'session' && request.actor !== undefined) return 'session'
  if (request.scope === 'user' && request.authorized !== true) return 'deny'
  if (request.scope === 'user' && request.authorized === true) return 'user'
  if (request.scope === 'global' || request.privileged === true) return 'global'
  return 'none'
}

/** 一个值必须为正才能被准入。 */
export function admit(value) {
  return value > 0
}

/** 只有在失败是瞬时的【且】预算还有剩时才重试。 */
export function shouldRetry(attempt, budget, transient) {
  return attempt < budget && transient === true
}
`

/**
 * 【装饰性】套件 —— 它绿、它有若干条测试，而它几乎什么都没测。
 *
 * 每一条断言要么是同义反复（`typeof` 检查、字符串的真值），要么只走分支的一个
 * 侧面而让算子完全不可观测。
 *
 * ★ 这个文件是被【实测】调过的，不是凭感觉写的：第一版写得太"能测"了，杀伤率跑到
 *   0.6 —— 因为它不小心把 `{scope:'user', authorized:true}` 那条分支钉住了，判据
 *   于是没有把"装饰性"认出来。修法是把断言退回到只碰一个分支、且那个分支在算子
 *   两侧取值相同的位置。
 */
const HOLLOW_SUITE = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeMemoryDomain, admit, shouldRetry } from './mutation-sut.mjs'

test('routing returns a string', () => {
  // ★ 同义反复：无论路由到哪个域，它都是字符串。
  assert.equal(typeof routeMemoryDomain({ scope: 'session', actor: 'a1' }), 'string')
})

test('routing returns a non-empty string for a known scope', () => {
  // ★ 同义反复：'session' 与 'deny' 都不为空 ⇒ 分支走哪边都过。
  assert.ok(routeMemoryDomain({ scope: 'session' }).length > 0)
})

test('routing result is one of the documented domains', () => {
  // ★ 只能证明"它在词表里"，证明不了"它选对了哪一个"。
  const domains = ['none', 'deny', 'session', 'user', 'global']
  assert.ok(domains.includes(routeMemoryDomain({ scope: 'user' })))
})

test('routing does not throw on a plain object', () => {
  assert.doesNotThrow(() => routeMemoryDomain({ scope: 'global' }))
})

test('admit returns a boolean', () => {
  // ★ 同义反复：\`value > 0\` 与 \`value >= 0\` 都返回布尔。
  assert.equal(typeof admit(-1), 'boolean')
})

test('admit does not throw for a large value', () => {
  assert.doesNotThrow(() => admit(1e9))
})

test('shouldRetry returns a boolean', () => {
  // ★ 同义反复：算子的任何一侧都返回布尔。
  assert.equal(typeof shouldRetry(0, 3, true), 'boolean')
})

test('shouldRetry does not throw when given no arguments', () => {
  assert.doesNotThrow(() => shouldRetry())
})

test('module exports the expected functions', () => {
  // ★ 这几条证明的是"文件能被 import"，不是"里面的逻辑对"。
  assert.equal(typeof routeMemoryDomain, 'function')
  assert.equal(typeof admit, 'function')
  assert.equal(typeof shouldRetry, 'function')
})
`

/**
 * 【严格】套件 —— 同一份实现，断言把每个分支的行为都钉死。
 *
 * 拿它跑变异测试、再拿装饰性套件跑同一批变异体，两者的杀伤率之差【就是】测量本身。
 * ★ 它是判据的【对照臂】：缺了它就无法区分"判据有效"与"判据在乱拒"。
 */
const RIGOROUS_SUITE = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeMemoryDomain, admit, shouldRetry } from './mutation-sut.mjs'

test('null and undefined both route to none', () => {
  assert.equal(routeMemoryDomain(null), 'none')
  assert.equal(routeMemoryDomain(undefined), 'none')
})

test('session scope WITHOUT an actor is denied', () => {
  assert.equal(routeMemoryDomain({ scope: 'session' }), 'deny')
})

test('session scope WITH an actor is admitted', () => {
  assert.equal(routeMemoryDomain({ scope: 'session', actor: 'a1' }), 'session')
})

test('user scope WITHOUT authorization is denied', () => {
  assert.equal(routeMemoryDomain({ scope: 'user' }), 'deny')
  assert.equal(routeMemoryDomain({ scope: 'user', authorized: false }), 'deny')
})

test('user scope WITH authorization is admitted', () => {
  assert.equal(routeMemoryDomain({ scope: 'user', authorized: true }), 'user')
})

test('global scope is admitted on the scope alone', () => {
  assert.equal(routeMemoryDomain({ scope: 'global' }), 'global')
})

test('privileged admits even without a recognized scope', () => {
  assert.equal(routeMemoryDomain({ scope: 'weird', privileged: true }), 'global')
})

test('an unrecognized scope with no privilege falls through to none', () => {
  assert.equal(routeMemoryDomain({ scope: 'weird' }), 'none')
})

test('admit rejects zero and negatives, accepts positives', () => {
  assert.equal(admit(0), false, 'zero must not be admitted')
  assert.equal(admit(-1), false)
  assert.equal(admit(1), true)
})

test('shouldRetry requires BOTH a remaining budget AND a transient failure', () => {
  assert.equal(shouldRetry(0, 3, true), true)
  assert.equal(shouldRetry(0, 3, false), false, 'non-transient must not retry')
  assert.equal(shouldRetry(0, 3, undefined), false, 'unknown transience must not retry')
  assert.equal(shouldRetry(3, 3, true), false, 'exhausted budget must not retry')
  assert.equal(shouldRetry(4, 3, true), false)
})
`

/**
 * ★ L3 契约违反体的定义：违反契约 C，不是改一个符号。
 *
 * `admit-rejects-zero` 就是那个实测同形：把 `value > 0` 写成 `value >= 0` 之后，
 * 边界被静默放宽 —— 它【不是语法错误】，看起来完全正常，通用算子永远抓不到它
 * （那里没有任何符号被改错）。这正是 L3 存在的理由。
 *
 * `expect_red` 会被【严格核对】（R3）：实测过一次手写的 expect_red 是错的，
 * 真正变红的是另外两个文件。
 */
const INVARIANTS = [
  {
    id: 'session-scope-without-actor',
    invariant: 'session scope without an actor is denied',
    contract: 'scripts/fixtures/mutation-contract.md#C-1',
    file: 'mutation-sut.mjs',
    mutate: {
      find: "if (request.scope === 'session' && request.actor === undefined) return 'deny'",
      replace: "if (request.scope === 'session' && request.actor === undefined) return 'session'",
    },
    expect_red: ['mutation-rigorous.test.mjs'],
  },
  {
    id: 'user-scope-requires-authorization',
    invariant: 'user scope requires explicit authorization',
    contract: 'scripts/fixtures/mutation-contract.md#C-2',
    file: 'mutation-sut.mjs',
    mutate: {
      find: "if (request.scope === 'user' && request.authorized !== true) return 'deny'",
      replace: "if (request.scope === 'user' && request.authorized !== true) return 'user'",
    },
    expect_red: ['mutation-rigorous.test.mjs'],
  },
  {
    id: 'admit-rejects-zero',
    invariant: 'zero must not be admitted',
    contract: 'scripts/fixtures/mutation-contract.md#A-1',
    file: 'mutation-sut.mjs',
    mutate: { find: '  return value > 0', replace: '  return value >= 0' },
    expect_red: ['mutation-rigorous.test.mjs'],
  },
]

/** 一个只在本次夹具里存在的沙箱：SUT 的副本 + 它的套件。 */
let sandbox
let sutPath
let hollowPath
let rigorousPath
let sutSource

/**
 * ★ 写域守卫：任何写入都必须落在本次夹具的沙箱里。
 *   夹具会【改坏】被测文件，一个写错的目标路径就是在毁别人的仓库。
 */
function guardedWrite(path, contents) {
  const target = resolve(path)
  if (!target.startsWith(resolve(sandbox) + '/')) {
    throw new Error(`the fixture tried to write outside its sandbox: ${target}`)
  }
  writeFileSync(target, contents)
}

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'gate-mutation-'))
  sutPath = join(sandbox, 'mutation-sut.mjs')
  hollowPath = join(sandbox, 'mutation-hollow.test.mjs')
  rigorousPath = join(sandbox, 'mutation-rigorous.test.mjs')
  writeFileSync(sutPath, SUT_SOURCE)
  writeFileSync(hollowPath, HOLLOW_SUITE)
  writeFileSync(rigorousPath, RIGOROUS_SUITE)
  sutSource = readFileSync(sutPath, 'utf8')
})

after(() => {
  if (sandbox !== undefined) rmSync(sandbox, { recursive: true, force: true })
})

function expectBlocked(verdict) {
  if (verdict.ok !== false || !('blockers' in verdict)) {
    throw new Error(`expected a blocked verdict, got ${JSON.stringify(verdict)}`)
  }
  return verdict.blockers
}
function expectUnmeasured(verdict) {
  if (verdict.ok !== false || !('unmeasured' in verdict)) {
    throw new Error(`expected an unmeasured verdict, got ${JSON.stringify(verdict)}`)
  }
  return verdict.unmeasured
}
function expectOk(verdict) {
  if (verdict.ok !== true) throw new Error(`expected an ok verdict, got ${JSON.stringify(verdict)}`)
  return verdict
}

/**
 * 判据的 context —— 真实 I/O 注入。
 *
 * ★ 与生产接线的差别只有一处：这里的写域是沙箱里的副本，所以夹具可以放心地
 *   把它改坏再还原。判据看到的接口（readFile / runTest / writeFile）与生产一致。
 */
/**
 * ★ 子进程环境：清掉 `NODE_TEST*` 与 `NODE_OPTIONS`。
 *
 * MEASURED（本轮夹具第一次跑就撞上）：夹具自己跑在 `node --test` 里，环境里的
 * `NODE_TEST_CONTEXT` 会让子进程变成【子报告器】—— 它不再打印 `ℹ pass N` 汇总行，
 * 于是判据读不到汇总、把一次本该测到的东西报成"没能测量"。
 *
 * ⇒ 这条同时说明为什么"未测量"必须能与真实结论分开：夹具环境造成的假 unmeasured
 *   与"套件真的够不到"在旧形态下会长得一模一样。
 */
function childEnv() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('NODE_TEST') || key === 'NODE_OPTIONS') delete env[key]
  }
  return env
}

/**
 * ★ 改动行是 git 给的【离散行号】，不是一对 (起, 止)。
 *   这里默认覆盖 SUT 的全部行 —— 也就是"整个文件都是本次改动的"，
 *   臂 1b 再用一个更窄的集合证明范围限制真的生效。
 */
function allLines() {
  return sutSource.split('\n').map((_, index) => index + 1)
}

function context({ suite, changedFiles = ['mutation-sut.mjs'], changedLines, ...rest } = {}) {
  const suitePath = suite === 'hollow' ? hollowPath : rigorousPath
  return {
    task: { id: 't-fixture', kind: 'implementation' },
    wantsCompleted: true,
    taskNotTerminal: true,
    changedFiles,
    changedLines: changedLines ?? allLines(),
    readFile: (path) => readFileSync(join(sandbox, path), 'utf8'),
    /**
     * ★ 套件用【绝对路径】读：它来自命令模板，而 `readFile` 收的是 workspace
     *   相对路径。混用会让一次 ENOENT 被读成"套件够不到" —— 把一次读取失败
     *   伪装成一条关于覆盖的结论，正是探针射程要防的形态。
     */
    readSuite: (path) => readFileSync(resolve(path), 'utf8'),
    writeFile: (path, contents) => guardedWrite(join(sandbox, path), contents),
    runTest: async (command) => {
      try {
        /**
         * ★ 两条都是踩出来的，不是防御性编程：
         *
         *   · `shell: true` —— 判据给出的命令模板是 `node --test *`（`*` 已被替换成
         *     套件路径列表），它是一条【命令行】而不是 argv。生产接线走的是同一条
         *     形态（`runVerifyCommand` 也是 shell），夹具必须一致，否则测的是一套
         *     不存在的接口。
         *
         *   · `env` 里清掉 `NODE_TEST*` / `NODE_OPTIONS` —— MEASURED：夹具自己跑在
         *     `node --test` 里，那会通过环境把子进程变成【子报告器】，于是子进程
         *     不再打印汇总行 ⇒ 判据读不到 `pass/fail` ⇒ 一次本该测到的东西被读成
         *     "没能测量"。也就是说，夹具的环境会让被测判据产生假 unmeasured，
         *     而 unmeasured 与真实结论在这一点上必须分得开。
         */
        const { stdout, stderr } = await run(command, { cwd: sandbox, shell: true, env: childEnv() })
        return { exitCode: 0, stdout, stderr }
      } catch (error) {
        return { exitCode: error.code ?? -1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
      }
    },
    testCommand: `node --test *`,
    killerSuites: [{ id: suitePath, files: [suitePath] }],
    ...rest,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★ 伪造臂：装饰性套件 ⇒ blocked，且必须报出存活数与覆盖范围
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 伪造臂：装饰性测试（变异体全部存活）⇒ blocked，并报出存活数与覆盖范围', async () => {
  const verdict = await gate(context({ suite: 'hollow' }))
  const blockers = expectBlocked(verdict)
  const joined = blockers.join('\n')

  assert.match(joined, /decorative/, '★ 必须点名这是"装饰性测试"，而不是只说一个数字')
  assert.match(joined, /mutation score/, '★ 必须给出杀伤率')
  assert.match(joined, /survived/, '★ 必须报出【存活数】')
  assert.match(joined, /survivor: /, '★ 必须逐条列出存活体：读日志的人要能看见"哪一条活着"')
  assert.match(joined, /coverage: /, '★ 必须报出【覆盖范围】—— 否则"分数低"与"范围选错了"分不开')

  /**
   * ★ 对照的是【同一个判据、同一批变异体、另一个套件】（臂 3）：装饰性套件的
   *   杀伤率必须显著低于严格套件。若两者相同，测量本身没有区分力。
   */
  const rigorous = expectOk(await gate(context({ suite: 'rigorous' })))
  assert.ok(
    rigorous.mutationScore > 0.9,
    `★ 严格套件应该杀掉几乎全部变异体，实际 ${rigorous.mutationScore}（对照臂失败 ⇒ 判据在乱拒，不是在测装饰性）`,
  )
})

test('臂 1b ★ 伪造臂：只有【改动行范围】进分母 —— 范围外的区域不进这个分数', async () => {
  /**
   * 只有 SUT 的函数体是本次改动（前面的注释块不是实现的任何一部分）。
   * 若判据按【全文件】变异，注释块不会贡献变异体，但**行数**会进覆盖范围；
   * 更要紧的是：改动范围窄时，分母必须【真的变窄】。
   *
   * ★ 这里故意不用注释块当"范围"：那样一条变异体都生不出来，报告会正确地
   *   说"这次测量无话可说"—— 那是另一条臂（见下方"无可变异体"的夹具），
   *   不是本条要证明的事。
   */
  const lines = sutSource.split('\n')
  const admitLine = lines.findIndex((line) => line.includes("return value > 0")) + 1
  const retryLine = lines.findIndex((line) => line.includes('return attempt < budget')) + 1
  assert.ok(admitLine > 0 && retryLine > 0, 'fixture 变了：找不到 admit / shouldRetry 的实现行')

  // 范围 A：只含 admit 那一行。范围 B：含 admit 与 shouldRetry 两处。
  const narrow = expectOk(await gate(context({ suite: 'rigorous', changedLines: [admitLine] })))
  const wide = expectOk(await gate(context({ suite: 'rigorous', changedLines: [admitLine, retryLine] })))

  assert.ok(
    (narrow.mutationReport?.totals?.scored ?? 0) < (wide.mutationReport?.totals?.scored ?? 0),
    `★ 分母必须真的随改动行集合变窄：窄=${narrow.mutationReport?.totals?.scored} 宽=${wide.mutationReport?.totals?.scored}`,
  )
  /** 报告的覆盖范围必须如实写出被变异的行区间，而不是文件全长。 */
  assert.match(narrow.scope, new RegExp(`lines ${admitLine}-${admitLine}\\b`), '★ 报告必须写清覆盖范围')
  assert.doesNotMatch(narrow.scope, /lines 1-\d+/, `★ 范围外（第 1 行起）不得进覆盖范围：${narrow.scope}`)
})

test('臂 1c ★ 伪造臂：改动行里没有可变异算子 ⇒ unmeasured，不是"完全覆盖"', async () => {
  /** 改动全是注释 ⇒ 一条变异体也生不出来。这与"测试很强"必须不同形。 */
  const verdict = await gate(context({ suite: 'rigorous', changedLines: [1, 2, 3, 4, 5] }))
  const reason = expectUnmeasured(verdict)
  assert.match(reason, /没有一条可计分变异体|无话可说/, '★ 必须说清"这次测量无话可说"')
  assert.doesNotMatch(reason, /fully covered|完全覆盖[^"）]*$/, '★ 绝不能说成"完全覆盖"')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★ 未测量臂：杀手套件够不到被变异文件
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 未测量臂：杀手套件够不到被变异文件 ⇒ unmeasured，不是"全存活"', async () => {
  /**
   * MEASURED（借鉴项目 RUN-009，本形态在该项目里犯过【九次】）：
   * 评分器变异 `bin/workbench-loop.mjs`，却拿 `test/escalation.test.mjs` 当杀手套件，
   * 而那个文件里 grep 该模块名 = 0 ⇒ 该文件每一个变异体都【必然】存活。
   * 输出读起来是"测试不够"，事实是"探针指错了"。
   */
  const unrelated = join(sandbox, 'unrelated.test.mjs')
  guardedWrite(unrelated, "import { test } from 'node:test'\ntest('nothing to do with the SUT', () => {})\n")

  const verdict = await gate(context({ suite: 'rigorous', killerSuites: [{ id: unrelated, files: [unrelated] }] }))

  const reason = expectUnmeasured(verdict)
  assert.match(reason, /够不到|reach/i, '★ 未测量必须说清"够不到"')
  assert.match(reason, /关于探针的事实/, '★ 必须点名这是【探针】的事实，不是测试的事实')
  /**
   * ★ 判据的【裁决形状】里不许出现任何关于测试的结论。
   *
   *   注意这里不能对整段 reason 做 /存活/ 匹配：reason【必须】解释"这些变异体
   *   必然存活"才能说清为什么这条测量无效 —— 那句话是在陈述探针的事实。
   *   要钉的是【结构】：未测量的裁决里没有 mutationScore / survivingMutants
   *   这些会被下游当结论用的字段。
   */
  assert.equal(verdict.mutationScore, undefined, '★ 未测量不得携带分数 —— 一个分数会被下游当成测量结果')
  assert.equal(verdict.mutationReport, undefined, '★ 未测量不得携带报告')
  assert.equal(verdict.killed, undefined, '★ 未测量不得携带"杀死数"')
  assert.equal(verdict.survived, undefined, '★ 未测量不得携带"存活数"')
})

test('臂 2b 未测量臂：没有声明杀手套件 ⇒ unmeasured（不回退全套，也不记成全存活）', async () => {
  const verdict = await gate(context({ suite: 'rigorous', killerSuites: [] }))
  const reason = expectUnmeasured(verdict)
  assert.match(reason, /杀手套件|killer suite/i)
})

test('臂 2c 未测量臂：拿不到 git 改动行 ⇒ unmeasured（绝不退回全文件变异）', async () => {
  /**
   * ★ 这里必须用 `withChangedLines` 显式把它设成 undefined。
   *
   *   第一版写的是 `context({ changedLines: undefined })` —— 而 `context()` 的默认值
   *   是 `changedLines ?? allLines()`，`undefined` 会命中默认分支 ⇒ 这条臂【根本没跑
   *   到它要测的那条路径】，而它看起来是绿的（实际上是"测了别的东西"）。
   *   "没传参"与"传了 undefined"必须不同形 —— 这正是本判据在别处的同一条纪律。
   */
  const ctx = context({ suite: 'rigorous' })
  ctx.changedLines = undefined
  const reason = expectUnmeasured(await gate(ctx))
  assert.match(reason, /全文件变异|whole-file/i, '★ 必须说清"退回全文件会扭曲分数"，而不是悄悄退回去')
  assert.match(reason, /分母|denominator/i)
})

test('臂 2d 未测量臂：没有注入执行器 ⇒ unmeasured，不是 ok', async () => {
  const ctx = context({ suite: 'rigorous' })
  delete ctx.runTest
  const reason = expectUnmeasured(await gate(ctx))
  assert.match(reason, /runTest/)
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ L3：契约违反体（不是改符号，是违反契约 C）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * L3 与 L1/L2 的区别是【本质】的，不是分类学：
 *
 *   L1/L2 改一个符号。实测能抓到"改错了符号"。
 *   L3 违反一条【项目契约】—— 它【不是语法错误】，看起来完全正常。
 *
 * 下面这条 `admit-rejects-zero` 就是那个实测形态：把 `value > 0` 写成 `value >= 0`
 * 之后，边界被静默放宽，而通用算子永远抓不到它（那里没有符号被改错）。
 */
const invariants = INVARIANTS

test('臂 L3-1 ★ 对照臂：声明了 expect_red 的契约违反体被【严格套件】杀掉，且红的正是声明的那个文件', async () => {
  const verdict = expectOk(await gate(context({ suite: 'rigorous', invariants })))
  const l3 = verdict.mutationReport.byLayer.L3
  assert.equal(l3.total, 3, `★ 三条 L3 契约违反体都要被计分，实际 ${l3.total}`)
  assert.equal(l3.killed, 3, `★ 严格套件必须杀掉全部三条，实际 killed=${l3.killed} survived=${l3.survived}`)
  /**
   * ★ R3：`expect_red` 被【严格核对】。
   *   实测（借鉴项目）：一条手写的 expect_red 是错的 —— 真正变红的是另外两个文件。
   *   所以这里核的是"你点名的那个文件红了"，不是"反正有东西红了"。
   */
  assert.deepEqual(verdict.mutationReport.expectRedViolations, [], '★ 声明与实际必须一致，否则声明是错的')
})

test('臂 L3-2 ★ 伪造臂：装饰性套件杀不掉契约违反体（L3 覆盖掉到 0）', async () => {
  const verdict = await gate(context({ suite: 'hollow', invariants }))
  const blockers = expectBlocked(verdict)
  assert.match(blockers.join('\n'), /decorative/)
  const l3 = verdict.mutationReport?.byLayer?.L3
  if (l3 !== undefined) assert.equal(l3.killed, 0, `★ 装饰性套件不该杀掉任何契约违反体，实际 ${l3.killed}`)
})

test('臂 L3-3 ★ 伪造臂：锚点在声明的文件里找不到 ⇒ unmeasured（绝不静默跳过）', async () => {
  /**
   * ★ 静默跳过一条坏锚点，就会报出一份【并不存在的 L3 覆盖】—— 那正好是我们
   *   最该看见的那次失效（契约被删了 / 片段漂移了）。
   */
  const broken = [{ ...invariants[0], mutate: { find: 'this anchor does not exist anywhere', replace: 'x' } }]
  const reason = expectUnmeasured(await gate(context({ suite: 'rigorous', invariants: broken })))
  assert.match(reason, /anchor not found|锚点/i)
})

test('臂 L3-4 ★ 伪造臂：锚点落在【改动行范围外】⇒ unmeasured（与全文件变异是同一个错误）', async () => {
  /** 只改 admit 那一行，却想变异 router 里的契约锚点 —— 那是在变异本次没碰的区域。 */
  const lines = sutSource.split('\n')
  const admitLine = lines.findIndex((line) => line.includes('return value > 0')) + 1
  const sessionInvariant = invariants.find((item) => item.id === 'session-scope-without-actor')
  assert.ok(sessionInvariant !== undefined, 'fixture 变了')

  const reason = expectUnmeasured(
    await gate(context({ suite: 'rigorous', changedLines: [admitLine], invariants: [sessionInvariant] })),
  )
  assert.match(reason, /changed-line ranges|改动行范围/i)
})

test('臂 L3-5 ★ 定义缺件 ⇒ unmeasured（不静默跳过坏定义）', async () => {
  const incomplete = [{ id: 'no-contract', invariant: 'x', file: 'mutation-sut.mjs', mutate: { find: 'a', replace: 'b' } }]
  const reason = expectUnmeasured(await gate(context({ suite: 'rigorous', invariants: incomplete })))
  assert.match(reason, /missing required field|contract/i)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★ 对照臂：足够强的测试杀掉变异体 ⇒ ok
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 对照臂：足够强的测试杀掉变异体 ⇒ ok（证明判据不误伤正常成员）', async () => {
  const verdict = expectOk(await gate(context({ suite: 'rigorous' })))
  assert.ok(verdict.mutationScore >= DEFAULT_MIN_KILL_RATE, `★ 实际 ${verdict.mutationScore}`)
  assert.ok(verdict.killed > 0, '★ 必须真的杀掉了一些变异体 —— 否则"ok"可能是"什么也没测"')
  assert.ok(Array.isArray(verdict.corpus) && verdict.corpus.length > 0, '★ 语料（覆盖到的文件）必须被交出去')
})

test('臂 3b 对照臂：沙箱里的 SUT 在测量后被【逐字节还原】', async () => {
  expectOk(await gate(context({ suite: 'rigorous' })))
  assert.equal(readFileSync(sutPath, 'utf8'), sutSource, '★ 一次没还原的测量既不干净也不可信')
})

test('臂 3c 对照臂：appliesTo 的三个条件缺一不可', async () => {
  assert.equal(appliesTo({ task: { kind: 'implementation' }, wantsCompleted: true, taskNotTerminal: true }), true)
  // 终态补证据（issue159）不是新的完成裁决 ⇒ 不生效
  assert.equal(appliesTo({ task: { kind: 'implementation' }, wantsCompleted: true, taskNotTerminal: false }), false)
  // review/requirements 不写 changedPaths ⇒ 没有可变异的东西
  assert.equal(appliesTo({ task: { kind: 'review' }, wantsCompleted: true, taskNotTerminal: true }), false)
  // 中间状态没有裁决要复核
  assert.equal(appliesTo({ task: { kind: 'implementation' }, wantsCompleted: false, taskNotTerminal: true }), false)
})

test('臂 3d 判据元数据：id / point 与注册表的插入点一致', () => {
  assert.equal(id, 'completion.mutation')
  assert.equal(point, 'completion')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 对照臂的"反面"：本夹具的装饰性套件必须【真的】是装饰性的
// ─────────────────────────────────────────────────────────────────────────────

test('夹具自检：hollow 套件在基线下是绿的（否则臂 1 证明不了任何事）', async () => {
  const { stdout } = await run(`node --test ${hollowPath}`, { cwd: sandbox, shell: true, env: childEnv() }).catch((error) => ({
    stdout: error.stdout ?? '',
  }))
  const summary = parseTestSummary(stdout)
  assert.equal(summary.fail, 0, '★ hollow 套件必须绿 —— 一个本来就红的套件"发现"不了任何东西')
  assert.ok(summary.pass >= 5, `★ hollow 套件要有若干条测试，实际 pass=${summary.pass}`)
})

test('夹具自检：rigorous 套件在基线下也是绿的（否则对照臂是拿一个坏套件在比）', async () => {
  const { stdout } = await run(`node --test ${rigorousPath}`, { cwd: sandbox, shell: true, env: childEnv() }).catch((error) => ({
    stdout: error.stdout ?? '',
  }))
  assert.equal(parseTestSummary(stdout).fail, 0)
})
