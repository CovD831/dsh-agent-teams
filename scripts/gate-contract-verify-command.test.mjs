/**
 * ── `contract.verify-command` 的三臂夹具 ───────────────────────────────────────
 *
 * 契约要求每条判据自带三臂（`docs/GATE-REGISTRY.md` §6）：
 *
 *   臂 1（伪造臂）  ：判据【应该拦住】的输入        ⇒ 期望 blocked，且说清错在哪
 *   臂 2（未测量臂）：没能测量的情形                ⇒ 期望 unmeasured（★ 不是 ok）
 *   臂 3（对照臂）  ：完全合法的输入                ⇒ 期望 ok（不误伤）
 *
 * ★ 缺任何一臂，这条判据不算完成 —— 只有对照臂能区分「判据有效」与「判据在乱拒」。
 *
 * ── 这条判据防的是什么（MEASURED，2026-10-05）──────────────────────────────────
 *
 * 契约的 `verify` 是一条命令。一条**永远失败**的命令会让任务无法诚实地完成，
 * 而它与"工作做错了"在退出码上同形。本轮实测的形状（START-HERE §6③ 的原话）：
 *
 *     grep -qx 7 <(wc -l < file)
 *
 * `wc -l` 打印的是右对齐的数字（`"      7"`），而 `grep -x` 要整行相等 ⇒
 * 永远不匹配 ⇒ 永远红。本文件把这条命令的形状钉成一条臂，并**真的执行一次**
 * 同一个形状去取那个非零退出码（不是靠注释声称它会失败）。
 *
 * ── 本文件里的臂，逐一对应验收里的哪一条 ──────────────────────────────────────
 *
 *   对照臂   ：一个可判的 verify 命令 ⇒ ok（并在注入了执行器时交出跑过的证据）
 *   伪造臂 ① ：`grep -qx 7 <(wc -l < file)`（实测形状）⇒ blocked，且指名错在哪
 *   伪造臂 ② ：写死的真 / 假（`true` / `false`）⇒ blocked
 *   伪造臂 ③ ：空命令（`""` / `"   "`）⇒ blocked（★ 空命令的退出码是 0，
 *              那会被读成"验过了"）
 *   伪造臂 ④ ：命令不存在（真的跑一次，拿 127）⇒ blocked，且允许"127 也可能是
 *              执行器超时"这一保留（见下面那条臂的说明）
 *   未测量臂 ：拿不到命令 / 没有执行器 ⇒ unmeasured，与 ok、blocked 都不同形
 *
 * ★ 还有两条本队特有的臂（"装了但调不到"）：
 *   · 接线臂：从【进程级注册表】在 `contract` 位置真的求值一次；
 *   · 放行臂：真的走一次 `create_task`（t6 的调用点），证明这条判据会拦到工具层，
 *     而它判 ok 时可判性【不阻止】任何东西（它不拒绝缺少 verify 的契约）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { gate, appliesTo, verifyCommandProblems, shellTokens, id, point, requires } from '../lib/gates/contract/verify-command.js'
import { registry } from '../lib/gates/index.js'
import { checkRequires } from '../lib/gates/requires.js'
import { registerAgentTeamsTools } from '../lib/tools.js'
import { createTeamDir } from '../lib/state.js'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

/** 本仓库根（输入面臂要读源码：`requires` 是**声明**，它没有运行时行为可测）。 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ── 三态的收窄助手：把"期望哪一种裁决"写进断言本身，于是三态在测试里也不同形 ── */

function expectBlocked(v) {
  if (v.ok !== false || !Array.isArray(v.blockers)) {
    throw new Error(`expected a blocked verdict, got ${JSON.stringify(v)}`)
  }
  return v.blockers
}
function expectUnmeasured(v) {
  if (v.ok !== false || typeof v.unmeasured !== 'string') {
    throw new Error(`expected an unmeasured verdict, got ${JSON.stringify(v)}`)
  }
  return v.unmeasured
}
function expectOk(v) {
  if (v.ok !== true) throw new Error(`expected an ok verdict, got ${JSON.stringify(v)}`)
  return v
}
/** 裁决的【形状】—— 三态不同形的机械判据（与集成夹具同一口径）。 */
function shapeOf(v) {
  if (v === null || typeof v !== 'object') return `non-object:${JSON.stringify(v)}`
  if (v.ok === true) return 'ok'
  if (Array.isArray(v.blockers)) return 'blocked'
  if (typeof v.unmeasured === 'string') return 'unmeasured'
  return `malformed:${JSON.stringify(v)}`
}
/** 一条契约草稿 —— 形状与 `create_task` / `amend_task` 传进 contract 位置的 ctx 一致。 */
function contract(verify, extra = {}) {
  return { task: { id: 't1', kind: 'implementation', verify }, creating: true, ...extra }
}

/** 真的跑一条命令，返回它的退出码（**不是**假装 —— 这条判据的伪造臂要靠它取证）。 */
function runForExitCode(command, cwd) {
  return runInShell('/bin/sh', command, cwd)
}
/** 换一台壳跑（用来把"壳本身不解析这条命令"与"这条命令匹配不上"分开）。 */
function runInShell(shell, command, cwd) {
  return new Promise((resolve) => {
    const child = spawn(shell, ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', () => {})
    child.stderr.on('data', () => {})
    child.on('error', () => resolve(127))
    child.on('close', (code) => resolve(code ?? 125))
  })
}
/** 那台壳在不在：不在 ⇒ undefined（这一条观察对本次运行【不可用】，而不是失败）。 */
async function runWithShell(shell, command, cwd) {
  const probe = await runInShell(shell, 'exit 0', cwd)
  if (probe === 127) return undefined
  return await runInShell(shell, command, cwd)
}

/* ── 身份与装配 ──────────────────────────────────────────────────────────────── */

test('★ 判据身份与装配约定一致（id/point 是装配点的键）', () => {
  assert.equal(id, 'contract.verify-command')
  assert.equal(point, 'contract')
  /**
   * ★ 一条判据写对了但挂错位置，等于它永不被求值 —— 而"挂错位置"在源码里看起来
   *   完全正常。所以身份断言是这一组的第一条。
   *   ★ 本轮 inScope 不含 `src/gates/index.ts`（那是 captain 的装配点），所以这里
   *     只断言身份，装配由 captain 那一行决定；接线本身由下面的接线臂从注册表证明。
   */
  assert.equal(typeof gate, 'function')
  assert.equal(typeof appliesTo, 'function')
})

/* ── 臂 3（对照臂）：可判的命令必须过 ─────────────────────────────────────────── */

test('★ 对照臂：一条可判的 verify 命令 ⇒ ok（★ 且不得乱拒）', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gate-verify-ok-'))
  try {
    writeFileSync(join(directory, 'count.txt'), Array.from({ length: 7 }, (_, i) => `line ${i + 1}`).join('\n') + '\n')
    /**
     * ★ 一条【真的可判】的 verify：它依赖产物的内容（文件里有几行非空行），
     *   所以工作做对了它绿、做错了它红 —— 这正是本判据要求的那种命令。
     */
    const command = 'test "$(grep -c . count.txt)" = "7"'
    /**
     * ★ 先证明这条命令在这个目录里真的能绿 —— 否则"判据没有误伤"这件事
     *   会建立在一个连自己都跑不通的命令上。
     */
    assert.equal(await runForExitCode(command, directory), 0, 'the control command must really exit 0')
    const verdict = await gate(contract([command], { execVerifyCommand: (c) => runForExitCode(c, directory) }))
    expectOk(verdict)
    /** ★ 通过时也要交出跑过的证据（不是只留下"看着没问题"）。 */
    assert.equal(verdict.verifyProbe?.length, 1)
    assert.equal(verdict.verifyProbe[0].exitCode, 0)
    assert.equal(verdict.verifyProbe[0].status, 'passed')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('★ 对照臂（静态）：本仓库真实用过的 verify 命令都不得被判据拦下', () => {
  /**
   * ★ 这一臂防的是"判据在乱拒"。清单里的每一条都是本仓库/本队真实出现过的
   *   命令形状（来自 scripts/*.mjs 的夹具与任务契约）。一条把 `node --test`
   *   判成"不可判"的静态规则会把所有质量任务卡死 —— 那正是最贵的那种失效。
   */
  const realistic = [
    'pnpm build',
    'pnpm typecheck',
    'node --test scripts/gate-x.test.mjs',
    'node --test *',
    'grep -c "foo" src/a.ts',
    '! grep -qiE "rollback" file.md',
    'test -f lib/index.js',
    'git diff --quiet HEAD -- src/',
    'node scripts/verify.mjs && pnpm test:gates',
  ]
  for (const command of realistic) {
    assert.deepEqual(
      verifyCommandProblems(command),
      [],
      `a realistic verify command was judged unjudgeable: ${JSON.stringify(command)}`,
    )
  }
})

/* ── 臂 1（伪造臂）────────────────────────────────────────────────────────────── */

test('★ 伪造臂 ①：实测形状 `grep -qx 7 <(wc -l < file)`（前导空格卡死整行匹配）⇒ blocked', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gate-verify-grep-'))
  try {
    /**
     * ★ 前导空白是【实测】的，不是推断的：先让 `wc -l` 自己把它打印出来，
     *   再把这条观察钉进断言 —— 这是"错在哪"这句话的证据。
     */
    writeFileSync(join(directory, 'count.txt'), Array.from({ length: 7 }, (_, i) => `line ${i + 1}`).join('\n') + '\n')
    const printed = await new Promise((resolve) => {
      const child = spawn('/bin/sh', ['-c', 'wc -l < count.txt'], {
        cwd: directory, stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      child.stdout.on('data', (chunk) => { out += chunk })
      child.on('close', () => resolve(out))
      child.on('error', () => resolve(''))
    })
    assert.match(printed, /^\s+7\s*$/, `wc -l must really pad the count with leading blanks, got ${JSON.stringify(printed)}`)

    const command = 'grep -qx 7 <(wc -l < count.txt)'
    /**
     * ★ 真的跑一次，取那个非零退出码 —— 这条臂的"永远失败"是观察到的，
     *   不是注释里声称的。
     *
     * ★ 两台壳的实测都记在这里，因为**它们都不是 0**，而"为什么不是 0"有两层：
     *
     *     /bin/sh（POSIX；macOS 上是 bash 3.2 的兼容模式）
     *         ⇒ 退出 2：`syntax error near unexpected token '('`
     *           —— 这一台壳【压根不解析】进程替换。一条连语法都过不去的
     *             verify 命令当然永远不可能绿。
     *     bash / zsh（真的支持 `<(…)`）
     *         ⇒ 退出 1：`wc -l` 打印右对齐的数字（`"      7"`），
     *           而 `grep -x` 要整行相等 ⇒ 永远不匹配。
     *
     * 所以这条臂断的是"这条命令在可用的壳里都拿不到 0"，并逐台给出原因 ——
     * 一个只断 `1` 的写法会把上面第一层事实整个丢掉（本文件最初就是这么写的，
     * 而它在本机立刻变红：`runVerifyCommand` 用的正是 `/bin/sh`）。
     */
    const exitCode = await runForExitCode(command, directory)
    assert.notEqual(exitCode, 0, 'the measured shape must never exit 0')
    assert.ok(
      [1, 2].includes(exitCode),
      `expected the POSIX shell to report either a syntax error (2) or "no match" (1), got ${exitCode}`,
    )

    /** 再让一台【真的支持进程替换】的壳跑同一条命令：它证明的是第二层（前导空白）。 */
    const bashish = await runWithShell('bash', command, directory)
    if (bashish !== undefined) {
      assert.equal(bashish, 1, `a shell that supports <(...) must really fail with "no match" (1); got ${bashish}`)
    }

    const blockers = expectBlocked(await gate(contract([command], { execVerifyCommand: (c) => runForExitCode(c, directory) })))
    const text = blockers.join('\n')
    /** ★ 必须说清【错在哪】，而不是只说"这条命令不好"。 */
    assert.match(text, /whole-line|-x/, 'the reason must name the whole-line match')
    assert.match(text, /wc -l|process substitution|output/i, 'the reason must name the command whose output is being matched')
    assert.match(text, /whitespace|blank/, 'the reason must name whitespace as the deciding factor (that is the actual defect)')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('★ 伪造臂 ②：写死的真 / 假 ⇒ blocked（退出码与工作无关）', async () => {
  const fabricatedTrue = expectBlocked(await gate(contract(['true'], { execVerifyCommand: async () => 0 })))
  assert.match(fabricatedTrue.join('\n'), /cannot fail|cannot certify/i)

  const fabricatedFalse = expectBlocked(await gate(contract(['false'], { execVerifyCommand: async () => 1 })))
  assert.match(fabricatedFalse.join('\n'), /never be completed|could never|cannot/i)

  /**
   * ★ 常量命令即便这一次的退出码"看起来对"也要被拒：`true` 永远绿 ⇒ 它证明不了
   *   任何关于工作的事。把恒真的命令当成"通过"正是本队最警惕的合流。
   */
  const constantAlsoGreen = expectBlocked(await gate(contract(['true'], { execVerifyCommand: async () => 0 })))
  assert.match(constantAlsoGreen.join('\n'), /\[always-green\]/)

  /**
   * ★ `false` 在【没有执行器】时也不能变成"没测到就算过"：它是一条静态可见的缺陷，
   *   unmeasured 的那句话里必须带着它（"我没测到"与"我什么都没说"不同形）。
   */
  const noExecFalse = expectUnmeasured(await gate(contract(['false'])))
  assert.match(noExecFalse, /always-red|never be completed/i)
})

test('★ 伪造臂 ③：空命令 ⇒ blocked（★ 空命令的退出码是 0，会被读成"验过了"）', async () => {
  for (const blank of ['', '   ', '\t']) {
    const blockers = expectBlocked(await gate(contract([blank], { execVerifyCommand: async () => 0 })))
    assert.match(blockers.join('\n'), /blank|empty/i, `a blank verify entry must be reported, got ${JSON.stringify(blockers)}`)
  }
  /**
   * ★ 与"清单为空"不同形：清单空 = 没有可判的东西（unmeasured）；
   *   清单里是空条目 = 有一条命令，而它给不出信息（blocked）。
   */
  const emptyList = await gate(contract([]))
  assert.equal(shapeOf(emptyList), 'unmeasured')
  assert.notEqual(shapeOf(emptyList), shapeOf(await gate(contract(['   '], { execVerifyCommand: async () => 0 }))))
})

test('★ 伪造臂 ④：命令根本不存在（真的跑一次，拿 127）⇒ blocked，且不许说成"没能测量"', async () => {
  const command = 'definitely-not-a-command-xyz --strict'
  const directory = mkdtempSync(join(tmpdir(), 'gate-verify-127-'))
  try {
    const exitCode = await runForExitCode(command, directory)
    assert.equal(exitCode, 127, 'the shell must really report 127 for an unknown command')

    const blockers = expectBlocked(await gate(contract([command], { execVerifyCommand: async () => 127 })))
    const text = blockers.join('\n')
    /**
     * ★ 保留（read this before tightening the assertion）：本仓库生产路径上的
     *   执行器是 `runVerifyCommand`，它把【超时】也映射成 125 —— 但 127 只由
     *   "命令不存在"产生。所以 127 ⇒ 契约写了一条执行不了的东西，这是一个
     *   **关于契约的结论**，不是一次测量失败。
     */
    assert.match(text, /127/, 'the reason must quote the observed exit code')
    assert.match(text, /could not find|not found|cannot be executed/i)
    assert.match(text, /never pass its own verify/i)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

/* ── 臂 2（未测量臂）────────────────────────────────────────────────────────── */

test('★ 未测量臂：命令在场但读不出来 / 没有执行器 ⇒ unmeasured，与 ok、blocked 都不同形', async () => {
  /**
   * ★ t17 修正：这里此前把「契约里根本没有 verify 字段」列为未测量臂的第 ① 条。
   *   那是**口径错误**：字段整个缺席 = 这份契约没有提出可判性要求 = **不适用 ⇒ ok**，
   *   而 unmeasured 在本插件里等于拒绝 ⇒ 会挡住每一个 `kind=work` 的普通任务。
   *
   *   与 t11 对 `build-artifact-scope` 的修法逐字同构：
   *     不适用（缺席）      ⇒ ok
   *     提了要求但读不出来  ⇒ unmeasured
   *   这一条臂现在只钉后者，前者由下面的【不适用臂】单独钉。
   */
  /** ① 字段在，但不是数组（"它提了要求，而那个要求读不出来"）。 */
  assert.equal(shapeOf(await gate({ task: { id: 't1', kind: 'implementation', verify: 'pnpm test' } })), 'unmeasured')

  /** ② 清单为空 ⇒ 提了要求、却没有可判的东西（★ 不是 ok）。 */
  assert.equal(shapeOf(await gate(contract([]))), 'unmeasured')

  /** ③ ★ 核心：一条【可判】的命令，但没有执行器 ⇒ 仍然 unmeasured。 */
  const staticallyFineButNeverRun = await gate(contract(['node --test scripts/x.test.mjs']))
  const neverRun = expectUnmeasured(staticallyFineButNeverRun)
  assert.match(neverRun, /never actually run|no executor/i)
  assert.ok(neverRun.trim().length > 0, 'unmeasured must say what could not be measured')

  /** ⑤ 执行器抛错 ⇒ unmeasured，不是"命令失败"。 */
  const threw = await gate(contract(['pnpm test'], { execVerifyCommand: async () => { throw new Error('spawn EACCES') } }))
  assert.match(expectUnmeasured(threw), /spawn EACCES/)

  /** ⑥ 执行器给了个非整数 ⇒ 说不清红绿 ⇒ unmeasured。 */
  const nonInteger = await gate(contract(['pnpm test'], { execVerifyCommand: async () => undefined }))
  assert.match(expectUnmeasured(nonInteger), /non-integer/)

  /** ★ 三态互不相同 —— "未测到"绝不等于"通过"，也绝不等于"发现的问题"。 */
  const okArm = await gate(contract(['pnpm build'], { execVerifyCommand: async () => 0 }))
  const blockedArm = await gate(contract(['false'], { execVerifyCommand: async () => 1 }))
  assert.notEqual(shapeOf(neverRun), shapeOf(okArm))
  assert.notEqual(shapeOf(neverRun), shapeOf(blockedArm))
  assert.notEqual(shapeOf(blockedArm), shapeOf(okArm))
})

test('★ appliesTo：契约在场就生效（★ 不把"没有 verify"写成 skipped）', () => {
  assert.equal(appliesTo(contract(['pnpm test'])), true)
  /** 没有 verify 字段 ⇒ 仍然生效：那正是未测量臂要表达的东西。 */
  assert.equal(appliesTo({ task: { id: 't1', kind: 'work' } }), true)
  /** 连 task 都没有 ⇒ 这个位置这一轮没有契约可看，跳过。 */
  assert.equal(appliesTo({ creating: true }), false)
  assert.equal(appliesTo(undefined), false)
})

/* ── 静态规则的边界：不误伤，也不放过 ───────────────────────────────────────── */

test('★ 边界：`-w` 词匹配、无 `-x` 的管道、里层命令的本分都不算缺陷（不误伤）', () => {
  /**
   * ★ `-w`（词匹配）不要求整行相等，前导空格不影响它 ⇒ 它【不是】那条被实测的
   *   形状。把 `-w` 也算进来的话，一条真实可判的命令会被拒 —— 误伤比漏报更贵。
   */
  assert.deepEqual(verifyCommandProblems('grep -wq 7 <(wc -l < count.txt)'), [])
  /** 没有 `-x`，同样不误伤。 */
  assert.deepEqual(verifyCommandProblems('grep -q 7 <(wc -l < count.txt)'), [])
  /**
   * ★ 里层命令自己永远进不了"被判定"的位置（它先于外层求值）⇒ 不拿它当外层判。
   *   `grep -q 7 <(grep -qx 7 file)` 的外层是 `grep -q 7 @nested@`（无 -x）。
   */
  assert.deepEqual(verifyCommandProblems('grep -q 7 <(grep -qx 7 file)'), [])
  /**
   * ★ 引号里的空串是 `grep` 的一个真实模式（"匹配空行"），不是"空命令"。
   */
  assert.deepEqual(verifyCommandProblems("grep -c '' file.txt"), [])
  /** 组合短选项里的 `x` 也算整行匹配（`-qx` 正是实测的那个写法）。 */
  assert.equal(verifyCommandProblems('grep -qx 7 <(wc -l < f)').length, 1)
  assert.equal(verifyCommandProblems('grep --line-regexp 7 <(wc -l < f)').length, 1)
})

test('★ 边界：词法（`shellTokens` 的引号保留与嵌套括号配对）不把命令切错', () => {
  /**
   * ★ 引号必须【留在词里】：`unquote` 靠它认出"这一整个 token 是被引起来的"。
   *   一个在引号内吞掉闭合引号的实现会把 `"a b"` 切成 `"a b` —— 而它接着会喂给
   *   "空命令"与"整行匹配"两条规则，两条都会判错（本文件正是这样抓到它的）。
   */
  assert.deepEqual(shellTokens('grep -q "a b" file'), ['grep', '-q', '"a b"', 'file'])
  assert.deepEqual(shellTokens("node -e 'x'"), ['node', '-e', "'x'"])
  /**
   * ★ 嵌套的括号必须配对：`$(echo $(date))` 只算【一层】里层命令。
   *   一个按第一个 `)` 就截断的实现会把外层切错，于是后面的规则作用在错的字符串上。
   */
  assert.deepEqual(verifyCommandProblems('test "$(echo $(date))" != ""'), [])
  /** 进程替换同样算里层命令，且外层保住"有目标"这个形状。 */
  assert.deepEqual(verifyCommandProblems('grep -qx 7 <(wc -l < f)').length, 1)
})

/* ── 接线臂：判据真的会在 contract 位置被求值 ────────────────────────────────── */

test('★ 接线臂：判据通过【进程级注册表】在 contract 位置真的被求值（不是"写了但调不到"）', async () => {
  if (!registry.list().contract.some((entry) => entry.id === id)) {
    /**
     * ★ 装配点（`src/gates/index.ts`）不在本任务的 inScope 里。一条判据文件写完
     *   但没被注册，就是本队反复见过的"装了但调不到"—— 所以这里**不是静默跳过**，
     *   而是把"还没接上"这件事当面说出来，并注明它由谁决定。
     */
    assert.equal(
      registry.list().contract.some((entry) => entry.id === id),
      false,
      'this gate is not registered yet; the assembly line in src/gates/index.ts is owned by the captain',
    )
    return
  }
  const evaluation = await registry.evaluate('contract', {
    task: { id: 'probe-task', kind: 'implementation', verify: ['grep -qx 7 <(wc -l < count.txt)'] },
    creating: true,
    execVerifyCommand: async () => 1,
  })
  const entry = evaluation.ran.find((item) => item.id === id)
  assert.ok(entry !== undefined, '★ 这条判据必须出现在 contract 位置的真实求值里（装上了就要跑得起来）')
  assert.equal(entry.verdict, 'blocked')
  assert.ok(
    evaluation.blockers.some((line) => line.includes(id)),
    '★ 它的裁决必须进整体裁决（带 id 前缀）—— 否则它开火了也没人看得见',
  )
})

/* ── 放行臂：真的走一次 create_task（t6 的调用点），证明它拦得到、也不乱拦 ──────── */

function pluginFixture(workspace) {
  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined },
      list() { return [] },
      sendMessage: async () => 'msg-0',
      [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { get() { return undefined } },
    on() { return () => {} },
    effect(setup) { return setup() },
    inject() { return () => {} },
  }
  const config = { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined }
  registerAgentTeamsTools(ctx, config)
  const agent = { id: 'captain-session', status: 'idle', session: { header: { cwd: workspace }, events: [] }, steer() {} }
  return async (name, args) => {
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`tool "${name}" was not registered`)
    return await tool.execute(args, { agent, signal: new AbortController().signal })
  }
}

test('★ 放行臂：一条【不可判】的契约被拒，而"可判率"判据自己从不拒绝（缺 verify 不拦）', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'gate-verify-wiring-'))
  try {
    await createTeamDir(join(workspace, '.agent-teams'), {
      id: 'team', name: 'Verify', captainSessionId: 'captain-session', createdAt: 1, taskSeq: 0, members: [], tasks: [],
    })
    const call = pluginFixture(workspace)
    const registered = registry.list().contract.some((entry) => entry.id === id)

    /**
     * ★ ① "缺 verify 不得被本判据拦下" —— 这一条【与装配无关】，因为它直接问的是
     *   判据自己的裁决：`work` 类契约没有 verify 是正常情形，它必须安静。
     *
     *   ★ t17 修正：这里此前断言的是 `unmeasured`，而注释写的是 "must never be a
     *     refusal" —— **断言与它自己的理由自相矛盾**。在本插件里 `unmeasured` 就等于
     *     拒绝（`rejectOnContractGates` 对 unmeasured 抛错），所以那条断言实际把
     *     "缺 verify 的正常情形"判成了拒绝 ⇒ **所有 kind=work 的任务都建不出来**
     *     （实测打红 `scripts/stress-verify.mjs`）。
     *
     *   正确裁决是 `ok`（不适用）。依据两处：
     *     · `src/quality-gates.ts:510` —— work 类 `return { ok: true }`，本就没有 verify 要求；
     *     · `src/quality-gates.ts` 的 `WRITE_KINDS` 分支 —— 写类任务在**建任务时**就被
     *       要求"非空 verify 清单"，所以"verify 缺席"不可能是一份坏契约溜进来。
     */
    const noVerify = await gate({ task: { id: 't1', kind: 'work' }, creating: true })
    assert.equal(
      shapeOf(noVerify),
      'ok',
      'a work contract without verify is "not applicable", not "nothing to measure" — a normal task must stay creatable',
    )
    assert.equal('blockers' in noVerify, false)
    assert.equal(
      'unmeasured' in noVerify,
      false,
      '★ 缺 verify 不得是 unmeasured：那在本插件里等于拒绝，会把每一个普通任务挡在门外',
    )
    const withoutExec = await gate(contract(['node --test scripts/x.test.mjs']))
    assert.equal(shapeOf(withoutExec), 'unmeasured', 'a judgeable command with no executor is still not a pass and not a refusal')

    /**
     * ★ ② 同一个 `create_task` 真的走一次（t6 的调用点）。`work` 类契约下，
     *   `contract.build-artifact-scope`（兄弟判据）也会说"没拿到 inScope ⇒ 没能测量"，
     *   所以这里断言的是【拒绝理由里没有本判据】—— 那正是"它不乱拦"的机械证据。
     */
    let rejected = null
    try {
      const created = await call('agent_teams_create_task', { subject: 'ordinary work without verify' })
      assert.equal(created.status, 'pending')
    } catch (error) {
      rejected = error.message
    }
    if (rejected !== null) {
      assert.doesNotMatch(
        rejected,
        new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `★ this create_task was refused by some other contract gate; it must not have been refused by ${id}`,
      )
    }

    /** ★ ③ 一条【不可判】的契约必须被拒 —— 只要本判据已经接上装配。 */
    const fabricated = 'grep -qx 7 <(wc -l < count.txt)'
    let fabricatedRejected = null
    try {
      await call('agent_teams_create_task', {
        subject: 'write the fraction',
        kind: 'implementation',
        objective: 'the ratio is printed as a whole number',
        inScope: ['src/ratio.ts', 'lib/ratio.js', 'lib/types/ratio.d.ts'],
        acceptance: ['ratio is exact'],
        verify: [fabricated],
      })
    } catch (error) {
      fabricatedRejected = error.message
    }
    const selfRegistered = registry.list().contract.some((entry) => entry.id === id)
    if (!selfRegistered) {
      /**
       * ★ 装配点（`src/gates/index.ts`）不在本任务的 inScope 里，它由 captain 收口。
       *   在被接上之前，本队的"装了但调不到"正是这个形态 —— 所以这条臂**不是静默
       *   跳过**，而是把事实当面说出来（且它会在接上之后自动变成真品断言）。
       */
      assert.equal(
        registered,
        false,
        'this arm expects the gate to be unregistered at this point; if the captain wired it, rerun',
      )
      return
    }
    assert.ok(fabricatedRejected !== null, '★ a contract whose verify can never pass must be refused when the task is created')
    assert.match(fabricatedRejected, /create_task rejected/)
    assert.match(
      fabricatedRejected,
      new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      '★ the rejection must carry the gate id (so "who said it" is not lost)',
    )
    assert.match(fabricatedRejected, /whole-line|-x/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

/* ── 臂 6（t17）：不适用臂 —— 与 t11 的 build-artifact-scope 同构 ─────────────── */

test('★ 不适用臂（t17）：verify【整个缺席】⇒ ok，不是 unmeasured', async () => {
  /**
   * ★ 这条修的是与 t11 同一个缺陷、同一张验收表：
   *
   *     t11：inScope 缺席 ⇒ unmeasured ⇒ 所有普通任务建不出来
   *     t17：verify  缺席 ⇒ unmeasured ⇒ 所有普通任务建不出来
   *
   *   依据（两处，都在 `src/quality-gates.ts`）：
   *     · `if (kind === 'work') return { ok: true }` —— work 类**本就没有** verify 要求；
   *     · `WRITE_KINDS` 分支 —— 写类任务在【建任务时】就要求非空 verify 清单，
   *       所以"整个缺席"不可能是一份坏契约溜进来。
   *
   * ★ 而 unmeasured 在本插件里等于**拒绝**（`rejectOnContractGates` 对 unmeasured 抛错），
   *   所以这个口径错误不是"少检查了一点"，是**把所有普通任务挡在门外**。
   */
  for (const kind of ['work', undefined, 'unspecified']) {
    const verdict = await gate({ task: { id: 't1', ...kind === undefined ? {} : { kind } }, creating: true })
    assert.equal(
      shapeOf(verdict),
      'ok',
      `a ${kind ?? 'kind-less'} contract with no verify list is "not applicable", not "nothing to measure"`,
    )
    assert.equal('unmeasured' in verdict, false, '★ 缺席不得是 unmeasured')
    assert.equal('blockers' in verdict, false)
  }
})

test('★ 不适用臂（t17）：同一次求值里，"缺席 ⇒ ok" 与 "在场但读不出 ⇒ unmeasured" 不同形', async () => {
  /**
   * ★ 与 t11 的修法逐字同构的那条分界：
   *     不适用（整个缺席）      ⇒ ok
   *     提了要求但读不出来      ⇒ unmeasured
   *   两边的字段集合必须不同形 —— 否则"这份契约没有提出要求"与
   *   "它提了要求而我没能检查"在日志里同形，而它们的下一步动作完全相反。
   */
  const absent = await gate({ task: { id: 't1', kind: 'work' }, creating: true })
  const unreadable = await gate({ task: { id: 't1', kind: 'implementation', verify: [] }, creating: true })
  assert.equal(shapeOf(absent), 'ok')
  assert.equal(shapeOf(unreadable), 'unmeasured')
  assert.notDeepEqual(
    Object.keys(absent).sort(),
    Object.keys(unreadable).sort(),
    '★ 「没有这个要求」与「有这个要求而我没测成」必须不同形',
  )
})

/* ─────────────────────────────────────────────────────────────────────────────
 * ★ 输入面臂（t2）：这条判据声明了它【需要执行器才说得出话】
 * ───────────────────────────────────────────────────────────────────────────── */

test('★ 输入面臂：执行器注入 ⇒ 核对 ok；没注入 ⇒ 逐条报出缺 `execVerifyCommand`', () => {
  /**
   * ── ★ 本条判据正是上一轮五次缺口里的**第三次「执行器缺席」**──────────────────
   *
   * MEASURED（2026-10-05，t17/t18）：contract 的两个调用点都没注入 `execVerifyCommand`
   * ⇒ 本判据在生产路径上**永远** `unmeasured` ⇒ 而 unmeasured 等于拒绝
   * ⇒ **implementation / repair 这类必须验的契约连 create_task 都过不去**。
   *
   * ⇒ 这一格必须进 `requires`：它缺席不是"判据安静一点"，而是"判据说不出它唯一
   *   想说的事"。核对层报出它，与判据自己报 unmeasured 是**同一句话的两种说法**。
   *
   * ★ 与 `contract.build-artifact-scope` 恰好相反的口径（两条合起来才完整）：
   *   那边【可选地读】的东西不进 requires（缺席是它的一条合法裁决）；
   *   这边【需要它才说得出话】的东西必须进。
   */
  const declared = [...requires]
  assert.deepEqual(declared, ['task', 'execVerifyCommand'], '★ 声明就是这两格：一份契约 + 一个执行器')

  const withExecutor = {
    task: { id: 't1', kind: 'implementation', verify: ['pnpm test'] },
    creating: true,
    execVerifyCommand: async () => 0,
  }
  const withoutExecutor = {
    task: { id: 't1', kind: 'implementation', verify: ['pnpm test'] },
    creating: true,
  }

  const full = checkRequires({ id, requires, appliesTo }, withExecutor)
  assert.equal(full.status, 'ok', '★ 两格都在场 ⇒ 不报')
  assert.deepEqual(full.present, ['task', 'execVerifyCommand'], '★ 在场的那两格要如实交出来')
  assert.deepEqual(full.missing, [])

  const bare = checkRequires({ id, requires, appliesTo }, withoutExecutor)
  assert.equal(bare.status, 'incomplete', '★ 执行器没注入 ⇒ 必须报缺')
  assert.deepEqual(bare.missing, ['execVerifyCommand'], '★ 点名缺的是执行器这一格，不是"task"')
  assert.deepEqual(bare.present, ['task'])
})

test('★ 输入面臂：核对层的结论与判据自己的 unmeasured 说【同一件事】', async () => {
  /**
   * ★ 一条声明与判据的未测量臂若各说各的，那就是新的静默失效 ——
   *   "缺 X 就 unmeasured"里的 X 必须出现在 requires 里（t2 验收 ②）。
   *
   * 本判据的 unmeasured 分支逐条对齐（也写在源码里那份声明的注释里）：
   *
   *     "no executor was injected …"                ⇒ execVerifyCommand ✔ 在 requires
   *     "declares a verify value that is not a list" ⇒ task             ✔ 在 requires
   *     "declares an empty verify list"              ⇒ task.verify      ✘ 不在（可选）
   *
   * ⇒ 唯一"缺 X 就 unmeasured 而 X 不在 requires 里"的是 `task.verify`，
   *   而它**不是遗漏**：t17 的收口定下"verify 整个缺席 ⇒ ok（不适用）"，
   *   所以它的缺席是一条**合法裁决**，由 gate 自己的分支持有（下面第三条断言钉住）。
   */
  const noExecutor = { task: { id: 't1', kind: 'implementation', verify: ['pnpm test'] }, creating: true }
  const check = checkRequires({ id, requires, appliesTo }, noExecutor)
  assert.deepEqual(check.missing, ['execVerifyCommand'])
  assert.match(
    expectUnmeasured(await gate(noExecutor)),
    /no executor was injected/,
    '★ 判据自己也说"没有执行器"：两句话必须同源',
  )

  /**
   * ★ 而 `task.verify` 的缺席【不得】被核对层报成缺 —— 那是 t17 那条修过的边界：
   *   `kind=work` 的普通任务本来就不带 verify，报缺会把每一个普通任务变成假告警。
   */
  const workContract = { task: { id: 't1', kind: 'work' }, creating: true, execVerifyCommand: async () => 0 }
  const workCheck = checkRequires({ id, requires, appliesTo }, workContract)
  assert.equal(workCheck.status, 'ok', '★ verify 缺席是"不适用"，不是"输入没接上"')
  assert.ok(!workCheck.missing.includes('task.verify'), '★ 核对层不许替这条判据说出它自己拒绝说的话')
  assert.equal(shapeOf(await gate(workContract)), 'ok', '★ 而判据自己在这一格上也判 ok（两者的口径一致）')
})

test('★ 输入面臂（真品路径）：经注册表，缺执行器必须进 `requires.missing`（不能只是判据自己嘀咕）', async () => {
  /**
   * ★ 这一臂走【进程级注册表】。理由与 `build-artifact-scope` 那边的装配臂同源：
   *   模块里写了 `export const requires`、而装配层（`asRegistration` 的白名单）
   *   没往下交，这种缺陷**只有从注册表看得见** —— MEASURED（2026-10-06，
   *   dispatch-owner 的 F1）：那正是本轮出现过一次的真实形态。
   */
  const evaluation = await registry.evaluate('contract', {
    task: { id: 't1', kind: 'implementation', verify: ['pnpm test'] },
    creating: true,
  })
  const check = evaluation.requires.checks.find((item) => item.id === id)
  assert.ok(check !== undefined, '★ 这条判据必须出现在 contract 位置的核对结论里')
  assert.equal(check.status, 'incomplete', '★ 没注入执行器 ⇒ 核对必须报出这一格')
  assert.deepEqual(check.missing, ['execVerifyCommand'])
  assert.match(evaluation.requires.missing.join('\n'), /execVerifyCommand/, '★ 人话清单里要指名道姓')
  assert.match(evaluation.requires.missing.join('\n'), new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '★ 且要说清是哪条判据')

  /**
   * ★ 先软后硬：上面这一整段**没有动裁决** —— 那次求值仍然是判据自己的
   *   `unmeasured`，而不是多出一条"输入面没接线"的 blocker。
   */
  assert.ok(
    !evaluation.blockers.some((line) => line.includes('the input surface is not wired')),
    '★ 观察模式（缺省）下核对结果不得变成 blocker',
  )

  /** ★ 另一半：注入执行器之后，同一份声明必须安静。 */
  const full = await registry.evaluate('contract', {
    task: { id: 't1', kind: 'implementation', inScope: ['src/a.ts', 'lib/a.js'], verify: ['pnpm test'] },
    creating: true,
    execVerifyCommand: async () => 0,
  })
  const fullCheck = full.requires.checks.find((item) => item.id === id)
  assert.equal(fullCheck.status, 'ok', '★ 执行器注入 ⇒ 核对不得报缺')
  assert.deepEqual(fullCheck.present, ['task', 'execVerifyCommand'])
})

test('★ 装配臂：requires 真的被装配层转发到注册表（"声明写了但没人交下去"是新形态）', () => {
  const listed = registry.list().contract.find((entry) => entry.id === id)
  assert.ok(listed !== undefined, '★ 这条判据必须在注册表清单里')
  assert.equal(listed.hasRequires, true, '★ "声明过输入面"必须读得出来（false = 声明没被转发下去）')
  assert.deepEqual(listed.requires, ['task', 'execVerifyCommand'], '★ 声明的内容也要原样读得出来')
})

test('★ 声明臂：源码里的 requires 用的是【类型层】声明（拼错的路径要能编译期就红）', () => {
  /**
   * ★ 运行时看不出一条声明"有没有挂上类型" —— 它照常工作，只是拼错的路径要等到
   *   某天有人改它时才以"核对报了一个谁也没写过的格子"的形式露面。
   */
  const source = readFileSync(join(ROOT, 'src/gates/contract/verify-command.ts'), 'utf8')
  const declaration = /export const requires:\s*CtxPaths<([A-Za-z0-9_]+)>\[\]\s*=\s*\[([^\]]*)\]/.exec(source)
  assert.ok(declaration !== null, '★ 声明必须写成 `CtxPaths<本判据的 ctx 类型>[] = [...]` 的形状')
  assert.equal(
    declaration[1],
    'VerifyCommandContext',
    '★ 类型参数必须是这条判据自己的 ctx 类型 —— 换成宽类型会让拼错的路径重新变成运行时的惊喜',
  )
  assert.match(source, /import type \{ CtxPaths \} from '\.\.\/requires\.ts'/, '★ 类型要从 requires.ts 来（type-only import）')
})

test('★ 输入面臂（对照）：上一轮那个真实缺口形状 —— 完整调用点的 ctx 必须一格不缺', async () => {
  /**
   * ★ 这一臂把"t18 修好之后的生产形状"钉成一条正品断言：`create_task` 的
   *   contract 调用点注入的就是 `{ team, task, creating: true, execVerifyCommand }`。
   *   在这里复现那一份 ctx，核对必须 **ok**。
   *
   * ⇒ 于是"有人把注入那一行删了"这件事会**同时**打红两处：
   *   工具层的放行臂（下面的 `create_task` 真品路径）与本夹具的这几条 ——
   *   而它在本轮之前是**只能靠人眼审查**的。
   */
  const realShape = {
    team: { id: 'team', tasks: [] },
    task: { id: 't1', kind: 'implementation', inScope: ['src/a.ts'], verify: ['pnpm test'] },
    creating: true,
    execVerifyCommand: (command) => runForExitCode(command, process.cwd()),
  }
  const check = checkRequires({ id, requires, appliesTo }, realShape)
  assert.equal(check.status, 'ok', `★ 生产调用点的 ctx 必须一格不缺；得到 ${JSON.stringify(check)}`)

  /**
   * ★ 规则二后半句的判法：把**这一格**单独去掉（其余一律不动），核对必须变结论。
   *   一条恒不报的实现会让上面那条与这一条同时绿 —— 所以两条必须一起读。
   */
  const { execVerifyCommand: _dropped, ...withoutInjection } = realShape
  const degraded = checkRequires({ id, requires, appliesTo }, withoutInjection)
  assert.equal(degraded.status, 'incomplete', '★ 把注入那一行去掉 ⇒ 核对必须报缺（它测的就是这件事）')
  assert.deepEqual(degraded.missing, ['execVerifyCommand'])
})
