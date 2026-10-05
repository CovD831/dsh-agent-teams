/**
 * ── `completion.r5` 的三臂夹具（红前绿后）──────────────────────────────────────
 *
 * 契约要求每条判据自带三臂（`docs/GATE-REGISTRY.md` §6）。本判据的三臂是：
 *
 *   臂 1（伪造臂）：一条【装饰性测试】—— 在父版本上也绿
 *                   ⇒ 期望 blocked，且【指名是哪一条测试】
 *   臂 2（未测量臂）：拿不到父版本（没有 worktree）
 *                     ⇒ 期望 unmeasured，★ 不是 ok，且与 blocked 不同形
 *   臂 3（对照臂）：真能在父版本变红、在修复版本变绿的测试
 *                   ⇒ 期望 ok，且交出两轮观测
 *
 * ★ 缺任何一臂，这条判据不算完成。理由是这个仓库已经踩过的：
 *   t2 那一轮"判据抓到了伪造"与"我的契约写错了"在日志里同形，
 *   只有对照臂能区分「判据有效」与「判据在乱拒」（START-HERE §4）。
 *
 * ── 这一臂与"判据自己是不是装饰品"是同构的 ────────────────────────────────────
 *
 * 本判据问的是"你交付的测试真的测到了东西吗"。所以夹具必须能证明【本判据自己】
 * 也测到了东西：臂 2 之所以必须是 unmeasured 而不是 ok，臂 1 之所以必须指名
 * 是哪条测试，都是为了让"这条判据装上了"与"这条判据在自我背书"不同形。
 *
 * ★ 执行器是【假的 git】：两行表就能造出"父版本红、修复版本绿"。
 *   这正是"判据是纯数据变换、I/O 由调用方注入"那条纪律换来的东西 ——
 *   判据自己 import 了 node:child_process 的话，这一整套夹具就得真的建仓库。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gate, appliesTo, id, point } from '../lib/gates/completion/r5.js'

/** 收窄助手：把"这条断言期望哪一种裁决"写进断言本身（三态必须不同形）。 */
function expectBlocked(v) {
  if (v.ok !== false || !('blockers' in v)) throw new Error(`expected a blocked verdict, got ${JSON.stringify(v)}`)
  return v.blockers
}
function expectUnmeasured(v) {
  if (v.ok !== false || !('unmeasured' in v)) throw new Error(`expected an unmeasured verdict, got ${JSON.stringify(v)}`)
  return v.unmeasured
}
function expectOk(v) {
  if (v.ok !== true) throw new Error(`expected an ok verdict, got ${JSON.stringify(v)}`)
  return v
}

const SCAN_DIRS = ['scripts']
const PARENT = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

/**
 * 一个【假 git / 假测试运行器】。`exits[revision][test]` 给出退出码。
 * 记录它被问过什么，好让断言能钉住"判据真的在父版本上跑过"。
 */
function stubRunner(exits, calls = []) {
  const runner = async (name, revision) => {
    calls.push({ test: name, revision })
    const table = exits[revision]
    if (table === undefined) throw new Error(`revision ${revision} not found`)
    // 两种形态都试：`node --test` 报的是它第一次遇到该文件时的路径形态。
    const exitCode = table[name] ?? table[name.split('/').pop()]
    if (exitCode === undefined) throw new Error(`no entry point matching "${name}"`)
    return { exitCode, output: exitCode === 0 ? 'ok' : 'AssertionError' }
  }
  runner.calls = calls
  return runner
}

/** 一条"真测试"的退出码表：父版本红，修复版本绿。 */
function r5Exits(...tests) {
  return {
    [PARENT]: Object.fromEntries(tests.map((name) => [name, 1])),
    'working-tree': Object.fromEntries(tests.map((name) => [name, 0])),
  }
}

function ctx(overrides = {}) {
  return {
    wantsCompleted: true,
    taskNotTerminal: true,
    task: { id: 't9', kind: 'implementation', inScope: ['scripts/gate-r5.test.mjs'] },
    update: { newTestFiles: ['scripts/gate-r5.test.mjs'] },
    parentRevision: PARENT,
    scanDirs: SCAN_DIRS,
    runTestOnRevision: stubRunner(r5Exits('scripts/gate-r5.test.mjs')),
    ...overrides,
  }
}

// ── 臂 1（伪造臂）：装饰性测试 ────────────────────────────────────────────────

test('臂 1 ★ 伪造臂：新测试在父版本上也通过 ⇒ blocked，且指名是哪条测试', async () => {
  const verdict = await gate(ctx({
    runTestOnRevision: stubRunner({
      [PARENT]: { 'scripts/gate-r5.test.mjs': 0 },        // ★ 装饰品：改之前就是绿的
      'working-tree': { 'scripts/gate-r5.test.mjs': 0 },
    }),
  }))
  const blockers = expectBlocked(verdict)
  assert.equal(blockers.length, 1)
  assert.match(blockers[0], /decorative test/, '★ 必须说清问题是"它没测到东西"')
  assert.match(blockers[0], /gate-r5\.test\.mjs/, '★ 必须指名是哪一条测试 —— 四条并行时"哪一条"就是全部信息')
  assert.match(blockers[0], /already passed on the parent revision/, '★ 理由必须是可复核的：父版本 exit 0')
})

test('臂 1b ★ 伪造臂：两条新测试里只有一条是装饰品 ⇒ 只报那一条（不连坐）', async () => {
  const verdict = await gate(ctx({
    update: { newTestFiles: ['scripts/gate-r5.test.mjs', 'scripts/gate-index-assembly.test.mjs'] },
    runTestOnRevision: stubRunner({
      [PARENT]: { 'scripts/gate-r5.test.mjs': 1, 'scripts/gate-index-assembly.test.mjs': 0 },
      'working-tree': { 'scripts/gate-r5.test.mjs': 0, 'scripts/gate-index-assembly.test.mjs': 0 },
    }),
  }))
  const blockers = expectBlocked(verdict)
  assert.equal(blockers.length, 1, '★ 只报真的没红的那些；一次给全但不是全都报')
  assert.match(blockers[0], /gate-index-assembly\.test\.mjs/)
  assert.doesNotMatch(blockers[0], /gate-r5\.test\.mjs/)
})

test('臂 1c ★ 伪造臂：两次都红（与既有失败绑定）⇒ blocked，且两个退出码都要报出来', async () => {
  /**
   * ★ 口径取严的理由：一条与无关失败绑定的测试，两次都红 ⇒ 它既没有"在父版本上红"
   *   （红的原因是别的），也没有"在修复版本上绿"。留下宽松口径就等于留下一个
   *   只在第一次运行时关掉的检查 —— 之后它永远说不了这条测试什么，而报告里
   *   依旧写着 "R5 ok"。
   */
  const verdict = await gate(ctx({
    runTestOnRevision: stubRunner({
      [PARENT]: { 'scripts/gate-r5.test.mjs': 1 },
      'working-tree': { 'scripts/gate-r5.test.mjs': 1 },
    }),
  }))
  const blockers = expectBlocked(verdict)
  assert.match(blockers[0], /failed on both revisions/)
  assert.match(blockers[0], /parent exit 1, fixed exit 1/, '★ 两个数字都要在场，读者才能自己判断')
})

test('臂 1d ★ 伪造臂：文件条数与运行器发现的测试条数对不上 ⇒ 说得出是哪些【文件】', async () => {
  const verdict = await gate(ctx({
    update: { newTestFiles: ['scripts/gate-r5.test.mjs'] },
    runTestOnRevision: stubRunner({
      [PARENT]: { 'scripts/gate-r5.test.mjs': 1, 'scripts/other.test.mjs': 0 },
      'working-tree': { 'scripts/gate-r5.test.mjs': 0, 'scripts/other.test.mjs': 0 },
    }),
  }))
  /**
   * ★ 这一臂钉的是"收窄不是靠猜"：只有一个文件被声明 ⇒ 只有它被问过。
   *   判据不做目录扫描（它不 import 任何 I/O），所以它测到的就是它被声明的那些。
   */
  const accepted = expectOk(verdict)
  assert.deepEqual(accepted.r5.verified.map((item) => item.test), ['scripts/gate-r5.test.mjs'])
})

// ── 臂 2（未测量臂）：拿不到父版本 ───────────────────────────────────────────

test('臂 2 ★ 未测量臂：没有 worktree（拿不到父版本）⇒ unmeasured，不是 ok', async () => {
  const verdict = await gate(ctx({ parentRevision: undefined }))
  const reason = expectUnmeasured(verdict)
  assert.match(reason, /no parent revision is available/)
  assert.match(reason, /isolated worktree/, '★ 必须说清是"隔不了"，不是"不需要隔离"')
  /**
   * ★ 这是本判据最重要的一条：判据返回 ok 就等于说"检查通过了"，
   *   而此刻我们连父版本都没有。把"没隔离"并进"通过"，正是它存在的理由。
   */
  assert.equal(verdict.ok, false)
  assert.equal('blockers' in verdict, false, '★ 未测量不是"发现了问题"：两者不同形')
})

test('臂 2b ★ 未测量臂：父版本是空串/空白 ⇒ 同样是 unmeasured（不伪造一个版本）', async () => {
  for (const bad of ['', '   ']) {
    const verdict = await gate(ctx({ parentRevision: bad }))
    assert.match(expectUnmeasured(verdict), /no parent revision is available/)
  }
})

test('臂 2c ★ 未测量臂：执行器抛错（checkout 失败 / 环境没准备好）⇒ unmeasured，不是"测试失败"', async () => {
  const verdict = await gate(ctx({
    runTestOnRevision: async () => { throw new Error('git checkout failed: no such revision') },
  }))
  const reason = expectUnmeasured(verdict)
  assert.match(reason, /could not run/)
  assert.match(reason, /git checkout failed/)
  assert.equal('blockers' in verdict, false, '★ 基础设施故障不得伪装成一个关于工作的结论')
})

test('臂 2d ★ 未测量臂：运行器交回半截结果（没有退出码）⇒ unmeasured，不是通过', async () => {
  const verdict = await gate(ctx({
    runTestOnRevision: async (_name, revision) => revision === PARENT ? { output: 'truncated' } : { exitCode: 0 },
  }))
  assert.match(expectUnmeasured(verdict), /returned no integer exit code/)
})

test('臂 2e ★ 未测量臂：一个测试文件都没声明（只报了实现文件）⇒ unmeasured，不是 ok', async () => {
  const verdict = await gate(ctx({ update: { newTestFiles: ['src/gates/completion/r5.ts'] } }))
  /**
   * ★ 这一臂挡住最容易的"自我背书"：什么都没找到 ⇒ 若返回 ok，
   *   这条判据在任何没有新测试的任务上都是一句"通过"。
   *   注意措辞【不是】"某条测试是装饰品"—— 我们连那条测试都没找到。
   *   执行器在场（ctx 的默认值），所以这条 unmeasured 只可能来自"没找到测试文件"。
   */
  assert.match(expectUnmeasured(verdict), /could not locate the new test files/)
  assert.match(expectUnmeasured(verdict), /none of the 1 reported file/)
})

test('臂 2f ★ 未测量臂：没给扫描范围 ⇒ unmeasured（不猜一个默认目录）', async () => {
  const verdict = await gate(ctx({ scanDirs: undefined }))
  /**
   * ★ 用一个没有根据的默认值会把"我没能测量"伪装成一次真测量：
   *   运行器返回 []，而空集会被当成"没有新测试要查" ⇒ ok。
   */
  assert.match(expectUnmeasured(verdict), /no scan directories were declared/)
})

test('臂 2g ★ 未测量臂：没注入执行器 ⇒ unmeasured（判据不自己起进程）', async () => {
  const verdict = await gate(ctx({ runTestOnRevision: undefined }))
  assert.match(expectUnmeasured(verdict), /no revision runner was injected/)
})

/**
 * ── 臂 3（对照臂）：真测试 ──────────────────────────────────────────────────
 */
test('臂 3 ★ 对照臂：真能在父版本变红、在修复版本变绿的测试 ⇒ ok，且交出两轮观测', async () => {
  const calls = []
  const verdict = await gate(ctx({ runTestOnRevision: stubRunner(r5Exits('scripts/gate-r5.test.mjs'), calls) }))
  const accepted = expectOk(verdict)
  assert.equal(accepted.r5.parentRevision, PARENT, '★ 通过时也要说清"对着哪个父版本测的"')
  assert.deepEqual(accepted.r5.verified, [
    { test: 'scripts/gate-r5.test.mjs', parentExitCode: 1, fixedExitCode: 0 },
  ])
  /**
   * ★ 钉住"真的在父版本上跑过"：只跑修复版本的话，装饰性测试与真测试都是绿的，
   *   判据就完全失去区分能力 —— 而那正是它唯一要做的事。
   */
  assert.deepEqual(calls.map((call) => call.revision), [PARENT, 'working-tree'])
})

test('臂 3b ★ 对照臂：两种文件名形态（相对路径 / 裸基名）都能对上', async () => {
  /**
   * ★ `node --test` 报的是"它第一次遇到该文件时的路径形态"，可能是
   *   `gate-r5.test.mjs` 也可能是 `scripts/gate-r5.test.mjs`。
   *   只看一种形态，就会出现"父版本上真的红了、却因为名字对不上被判没测到"——
   *   一次测量失败伪装成一条装饰性测试。
   *   两个子臂：表里只写裸基名 / 只写相对路径，都必须能被对上。
   */
  const base = {
    [PARENT]: { 'gate-r5.test.mjs': 1 },
    'working-tree': { 'gate-r5.test.mjs': 0 },
  }
  const accepted = expectOk(await gate(ctx({ runTestOnRevision: stubRunner(base) })))
  assert.equal(accepted.r5.verified[0].test, 'scripts/gate-r5.test.mjs', '运行器报裸基名时，声明里的相对路径必须对得上')

  const relative = {
    [PARENT]: { 'scripts/gate-r5.test.mjs': 1 },
    'working-tree': { 'scripts/gate-r5.test.mjs': 0 },
  }
  const calls = []
  const second = expectOk(await gate(ctx({ runTestOnRevision: stubRunner(relative, calls) })))
  assert.equal(second.r5.verified[0].test, 'scripts/gate-r5.test.mjs', '运行器报相对路径时同样要对得上')
  /**
   * ★ 反面：一条【别的】测试是装饰品 ⇒ 仍然 blocked。
   *   这一条防的是"为了能对上名字而放宽成子串匹配"——子串会把
   *   `a.test.mjs` 与 `b/a.test.mjs` 混起来（跨目录同名）。
   *   被声明的测试（`scripts/gate-r5.test.mjs`）在父版本上没红 ⇒ 它就是装饰品，
   *   而另一条绿的测试不能替它把报告变绿。
   */
  const other = {
    [PARENT]: { 'scripts/gate-r5.test.mjs': 0, 'other.test.mjs': 0 },
    'working-tree': { 'scripts/gate-r5.test.mjs': 0, 'other.test.mjs': 0 },
  }
  assert.match(
    expectBlocked(await gate(ctx({ runTestOnRevision: stubRunner(other) })))[0],
    /decorative test/,
  )
})

test('臂 3c ★ 对照臂：多条真测试一次全过（不短路、也不误伤）', async () => {
  const tests = ['scripts/gate-r5.test.mjs', 'scripts/gate-index-assembly.test.mjs', 'scripts/worktree-isolation.test.mjs']
  const verdict = await gate(ctx({
    update: { newTestFiles: tests },
    runTestOnRevision: stubRunner(r5Exits(...tests)),
  }))
  const accepted = expectOk(verdict)
  assert.equal(accepted.r5.verified.length, 3)
  assert.ok(accepted.r5.verified.every((item) => item.parentExitCode !== 0 && item.fixedExitCode === 0))
})

test('臂 3d ★ 对照臂：声明里夹着非测试文件（实现文件）时，只检查测试', async () => {
  const verdict = await gate(ctx({
    update: { newTestFiles: ['src/gates/completion/r5.ts', 'scripts/gate-r5.test.mjs'] },
    runTestOnRevision: stubRunner(r5Exits('scripts/gate-r5.test.mjs')),
  }))
  const accepted = expectOk(verdict)
  assert.deepEqual(accepted.r5.verified.map((item) => item.test), ['scripts/gate-r5.test.mjs'])
})

/**
 * ── 判定谁该被这条判据管 ────────────────────────────────────────────────────
 */
test('⑨ appliesTo：只有声明了新增测试的 implementation / repair 才被管', () => {
  const base = { wantsCompleted: true, taskNotTerminal: true, task: { kind: 'implementation' }, update: { newTestFiles: ['scripts/a.test.mjs'] } }
  assert.equal(appliesTo(base), true)
  assert.equal(appliesTo({ ...base, task: { kind: 'repair' } }), true)
  // ★ 别的类别本就不该填 newTestFiles；对它们做核对会把"本就不该填"误判成"漏报"
  for (const kind of ['work', 'review', 'requirements', 'verification', 'integration']) {
    assert.equal(appliesTo({ ...base, task: { kind } }), false, `${kind} 不该被 R5 管`)
  }
  // 没声明新测试 ⇒ 没有"新测试"这个对象
  assert.equal(appliesTo({ ...base, update: {} }), false)
  assert.equal(appliesTo({ ...base, update: undefined }), false)
  /**
   * ★ 声明了【空数组】仍然要被管：由 gate 去说 unmeasured。
   *   在这里返回 false 会让"声明了但一个都没落"静默地不产生任何裁决 ——
   *   那与"压根没声明"同形，而这两件事不是一回事。
   */
  assert.equal(appliesTo({ ...base, update: { newTestFiles: [] } }), true)
  assert.equal(appliesTo(undefined), false)
})

/**
 * ── ★ 完成意图守卫（MEASURED：这一条本夹具【原本没有】，所以缺陷没被发现）───────
 *
 * 上面 ⑨ 的 `base` 一直带着 `wantsCompleted: true`，于是它从来没有测过
 * "不是试图 completed 时会不会被审判"。而真实缺陷正是躲在这个空缺里：
 *
 *     本判据此前只看 kind + newTestFiles ⇒ 成员【刚开工】的 in_progress 更新
 *     也被 R5 审判，而那时父版本/扫描范围都还不存在 ⇒ update_task 被拒。
 *     lifecycle-verify 实测断在 `:801`，正是那条 in_progress。
 *
 * ★ 为什么这条必须存在：三条兄弟判据（verify-rerun / mutation / backtest）都带
 *   这两个守卫，只有 R5 没有 —— 而"唯一不同"正是最该被机械钉住的东西。
 *   夹具只测了"该管的被管"，没测"不该管的不管"，缺陷就在那半边。
 */
test('⑨b ★ 完成意图守卫：不是试图 completed / 已是终态 ⇒ 一律不求值（与三条兄弟判据同口径）', () => {
  const base = { wantsCompleted: true, taskNotTerminal: true, task: { kind: 'implementation' }, update: { newTestFiles: ['scripts/a.test.mjs'] } }

  /**
   * ★ 成员【刚开工】（in_progress）：没有任何完成裁决要复核。
   *   这一条如果变红，意味着"开始干活"那一步会被"红前绿后"拒绝 ——
   *   而那时还没有父版本可比较，判据只能 unmeasured ⇒ 任务永远开不了工。
   */
  assert.equal(
    appliesTo({ ...base, wantsCompleted: false }),
    false,
    '★ in_progress 时不得求值 —— 否则一条"我开始干活了"的更新会被红前绿后审判并拒绝',
  )
  /**
   * ★ 终态补证据（issue159 路径）：不是新的完成裁决，与 verify-rerun / mutation
   *   同一口径。补证据不该被今天的测试重新审判。
   */
  assert.equal(appliesTo({ ...base, taskNotTerminal: false }), false)
  // 两个守卫都缺席时同样不求值（把它们并成一个判断也可以，但行为必须一致）
  assert.equal(appliesTo({ ...base, wantsCompleted: undefined, taskNotTerminal: undefined }), false)
  /**
   * ★ 只缺一个也必须挡住 —— 防止将来有人把 `&&` 写成 `||`：
   *   那样"终态补证据"会被重新审判（verify-rerun 明确不这么做）。
   */
  assert.equal(appliesTo({ ...base, wantsCompleted: true, taskNotTerminal: false }), false)
  assert.equal(appliesTo({ ...base, wantsCompleted: false, taskNotTerminal: true }), false)
  // 对照：两个守卫都在 ⇒ 仍然求值（这一条证明上面不是"一律不求值"的空转）
  assert.equal(appliesTo(base), true)
})

test('⑩ 判据元数据：id / point 与装配约定表一致（装配点那行写死的就是这两个值）', () => {
  assert.equal(id, 'completion.r5')
  assert.equal(point, 'completion')
})

/**
 * ── 纯数据变换（★ 判据层唯一那条纪律的机械检查）──────────────────────────────
 */
test('⑪ 纯数据变换：判据不 import 任何 I/O，执行器只能由调用方注入', async () => {
  const { readFileSync } = await import('node:fs')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const source = readFileSync(join(root, 'src/gates/completion/r5.ts'), 'utf8')
  /**
   * ★ import 语句里出现这些 ⇒ 判据自己去做 I/O 了，于是它的行为不再能被
   *   一个纯数据的夹具钉住（START-HERE §3 的纪律）。
   *   在这里断言【import 子句】而不是"源码里出现某个字符串"：注释里必须能
   *   自由地提到 node:fs，那正是解释"为什么不许 import 它"的地方。
   */
  const imports = [...source.matchAll(/^\s*import[\s\S]*?from\s*'([^']+)'/gm)].map((match) => match[1])
  assert.deepEqual(imports, ['../registry.ts'], '★ 判据只许 import 注册表的三种裁决构造器')
  assert.equal(/\bimport\s*\(/.test(source), false, '★ 动态 import 会绕过上面那条白名单')
  assert.equal(/\brequire\s*\(/.test(source), false)
  // 对照：没有执行器时它【说"我没测成"】，而不是"通过"
  const verdict = await gate({ task: { kind: 'implementation' }, update: { newTestFiles: ['scripts/a.test.mjs'] }, scanDirs: ['scripts'] })
  assert.equal(verdict.ok, false)
  assert.match(expectUnmeasured(verdict), /no revision runner was injected/)
})
