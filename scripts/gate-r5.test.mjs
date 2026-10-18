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
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { gate, appliesTo, id, parseKindRequirements, point } from '../lib/gates/completion/r5.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

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
    /**
     * ★ t54：kind 需求表 —— 由调用方注入（判据不读盘）。
     *   本夹具用**真的那张表**（从盘上读），于是这些臂测的仍是真实行为。
     */
    loadKindRequirements: () => parseKindRequirements(JSON.parse(readFileSync(join(ROOT, 'src', 'gates', 'completion', 'kind-requirements.json'), 'utf8'))),
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
test('⑨ appliesTo：只有【表说它要 r5】且声明了新增测试的任务才被管', () => {
  /**
   * ★ t54：`base` 必须带上**表** —— 否则 `appliesTo` 问不出"这个 kind 要不要 r5"
   *   ⇒ 它一律返回 false（沉默），而那是"没能测量"，不是"不需要"。
   *   ★ 用**真的那张表**（从盘上读），于是本臂测的仍是真实行为。
   */
  const TABLE = parseKindRequirements(JSON.parse(readFileSync(join(ROOT, 'src', 'gates', 'completion', 'kind-requirements.json'), 'utf8')))
  const base = {
    loadKindRequirements: () => TABLE,
    wantsCompleted: true,
    taskNotTerminal: true,
    task: { kind: 'implementation' },
    update: { newTestFiles: ['scripts/a.test.mjs'] },
  }
  assert.equal(appliesTo(base), true)
  /**
   * ★ t54：`repair` 现在**不**要求 r5（表里有理由：判别证据是**既有夹具**，不是新测试）。
   *   ⇒ 而这一格是本任务**刻意**改变的 —— 从"跟着 implementation 一起被管"
   *     改成"按自己的理由不被管"。
   */
  assert.equal(
    appliesTo({ ...base, task: { kind: 'repair' } }), false,
    '★ t54：repair **不要求** r5 —— 它要的是既有夹具能判别（t31）',
  )
  /**
   * ── ★★★ t69：这一行此前把 `verification` 也列进"不该被 R5 管" ─────────────────
   *
   * MEASURED（t69）：`src/gates/completion/kind-requirements.json` 里
   * `verification` 的 `requiredGates` 是 **`['completion.r5']`** —— 也就是说
   * **表说它要 R5**，而这条断言说它不该被管。两者**直接冲突**。
   *
   * ★★ 而更值得记的是：**那张表与它自己的 `because` 也冲突**（逐字引用）：
   *
   *     "a verification task adds no behaviour, so there is nothing new for r5/mutation
   *      to discriminate … **Not required: r5** (no new behaviour to pin), mutation …"
   *
   * ⇒ 数据（`requiredGates`）说"要 r5"，同一行的理由（`because`）说"不要 r5"。
   *   **两者必有一个错**，而"哪个错"需要人裁 —— 我不猜。
   *
   * ★ 所以本行当时的立场是：**如实对齐当时的数据**（门读的是数据，不是 `because`），
   *   并把那个冲突写在这里与 `docs/BASELINE-RED.md` 里。
   *   ★ 而 `src/gates/completion/` **不在 t69 的写域里** ⇒ 那时**不能**去改那张表，
   *     也不该把这条断言改成"两边都行"（那会让冲突**消失**，而本队的纪律是：
   *     把缺陷写成不变量、与把它删掉，都不是修好它）。
   *
   * ── ★★★ t73：那个冲突**已经被裁了**，而本行随之回到它本来该有的读数 ──────────
   *
   * 裁定：**数据错了，`because` 是对的**。证据（t73 真跑 r5 的 `gate()`）：
   *   verification 任务按定义**不新增测试** ⇒ 开着 r5 时它必然落
   *   「none of the 0 reported file(s) resolve to a test path」⇒ `unmeasured`，
   *   而完工位置对 `unmeasured` 的处置是**拒绝** ⇒ **每一个 verification 任务都无法完工**。
   * ⇒ 所以它现在与 `work`/`review`/`requirements`/`integration` **同一组**：
   *   r5 不管它。★ 而这不是"放宽"—— 它换回了 `backtest`（那条门问的是真问题），
   *   理由与实测写在 `kind-requirements.json` 的 `_history` 里。
   */
  for (const kind of ['work', 'review', 'requirements', 'integration', 'verification']) {
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
  /** ★ t54：带上表 —— 否则 kind 那一格先让 `appliesTo` 返回 false，而本臂测的是**另外两格**。 */
  const TABLE9B = parseKindRequirements(JSON.parse(readFileSync(join(ROOT, 'src', 'gates', 'completion', 'kind-requirements.json'), 'utf8')))
  const base = { loadKindRequirements: () => TABLE9B, wantsCompleted: true, taskNotTerminal: true, task: { kind: 'implementation' }, update: { newTestFiles: ['scripts/a.test.mjs'] } }

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
  /**
   * ★ 允许清单是【两个】接口文件，不是一个：注册表的裁决构造器，加上 t6 的
   *   `requires.ts`（它只定义"这条判据要 ctx 的哪几格"这一个声明，自身不 import
   *   任何东西、也不含任何判据语义）。
   *
   * ★ 断言仍然是【逐条列举】而不是"不超过白名单"：多一个 import 就会红，
   *   因为这一条真正防的是"判据自己去做 I/O 了"（`node:fs` / `node:child_process`），
   *   而放宽成前缀匹配会让 `../registry-io.ts` 这种东西悄悄进来。
   */
  /**
   * ★ t54：多了 `./kind-requirements.ts` —— 而它与 `../requires.ts` **同一类**：
   *   纯函数、无 I/O、无判据语义（见那个文件的文件头）。
   *   ★ 而它**不是**一条判据：本判据与它是"用户与共享模块"，不是"判据与判据"。
   */
  assert.deepEqual(
    imports, ['../registry.ts', '../requires.ts', './kind-requirements.ts'],
    '★ 判据只许 import 注册表的裁决构造器、requires 的声明类型、以及共享的纯函数模块',
  )
  assert.equal(/\bimport\s*\(/.test(source), false, '★ 动态 import 会绕过上面那条白名单')
  assert.equal(/\brequire\s*\(/.test(source), false)
  // 对照：没有执行器时它【说"我没测成"】，而不是"通过"
  /**
   * ★ t54：这一份 ctx 是**内联**的（不走上面的 helper）⇒ 也必须带表 ——
   *   否则先触发的是"表没能被咨询"那条 unmeasured，
   *   而本臂要证明的是"**没有执行器**时它说我没测成"。
   */
  const TABLE_11 = parseKindRequirements(JSON.parse(readFileSync(join(ROOT, 'src', 'gates', 'completion', 'kind-requirements.json'), 'utf8')))
  const verdict = await gate({ loadKindRequirements: () => TABLE_11, task: { kind: 'implementation' }, update: { newTestFiles: ['scripts/a.test.mjs'] }, scanDirs: ['scripts'] })
  assert.equal(verdict.ok, false)
  assert.match(expectUnmeasured(verdict), /no revision runner was injected/)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 20（t17 · 粒度）：★★★ 「重构 + 新增臂」不许被判成装饰性 ──────────────────────
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★★ 本臂钉的是那条**结构性假红**（t17）───────────────────────────────────────
 *
 * MEASURED（t17）：本判据此前把**整个测试文件**当成一个单位跑两次，只要父版本
 * `exit 0` 就判"装饰性"。
 *
 *   ⇒ ★ 而"重构 + 新增臂"的交付里，**同一个文件**在父版本上本来就绿
 *     （它是个早已存在的文件），而这次真正的工作是**往里加了几条臂**
 *     ⇒ 那些新臂**被判成了装饰品**，而它们恰恰是这次交付的证据。
 *   ⇒ ★ 红的不是"这条测试没用"，而是"我按文件看，看不到新臂" —— 结构性假红。
 *
 * ★ 定向突变 a（改回按文件判：`parentExit === 0` 就进 `fabricated`）⇒ 本臂红。
 */

/** 一份 `node --test` spec reporter 的输出 —— 只列出跑了哪些臂。 */
function specReport(arms) {
  return [...arms.map((arm) => `✔ ${arm} (1.234ms)`), 'ℹ tests ' + arms.length, 'ℹ pass ' + arms.length, 'ℹ fail 0'].join('\n')
}

/** 一个按版本给输出的执行器：`parent` / `fixed` 各自是 `{exitCode, output}` 或只有 exitCode。 */
function armRunner(parent, fixed) {
  return async (_test, revision) => (revision === 'working-tree' ? fixed : parent)
}

test('臂 20 ★★★ 重构 + 新增臂 ⇒ **不许**判装饰性（而它此前判了 —— 结构性假红）', async () => {
  /**
   * ★ 本臂的输入是那条真实形状：**同一个文件**，父版本上绿，而工作区里多了两条臂。
   */
  const verdict = await gate(ctx({
    runTestOnRevision: armRunner(
      { exitCode: 0, output: specReport(['臂 1：这个文件本来就有的']) },
      { exitCode: 0, output: specReport(['臂 1：这个文件本来就有的', '★ 臂 2：本次新增的', '★ 臂 3：本次新增的']) },
    ),
  }))
  assert.equal(
    verdict.ok, true,
    '★★★ 同一文件里**新增了臂** ⇒ 它不是装饰品，**即使整个文件在父版本上就是绿的**。'
    + '★ 修前它按【文件】判（父版本 exit 0 ⇒ 装饰性）⇒ 而这次交付的臂被判成了装饰品。'
    + `实测裁决：${JSON.stringify(verdict).slice(0, 240)}`,
  )
  /** ★ 而它必须**说出**那两条新臂 —— 否则读的人无法核"到底新增了什么"。 */
  const evidence = verdict.r5?.evidence ?? []
  assert.equal(evidence.length, 1, '★ 必须有一格"新增臂"的读数')
  assert.deepEqual(
    evidence[0].newArms.sort(), ['★ 臂 2：本次新增的', '★ 臂 3：本次新增的'],
    '★★ 它必须**逐条指名**新增的臂（不是一句"有新东西"）—— 读的人要能去核那两条',
  )
})

test('臂 20b ★★ 反向半边：真正的装饰性**仍然**被判出（一律放过 ⇒ 本臂红）', async () => {
  /**
   * ★ 缺了本臂就无法区分"修好了"与"把那条规则删了"：
   *   一个**一律放行**的实现同样能过臂 20 —— 而它比原缺陷更坏
   *   （真正的装饰性测试再也没人管）。
   *
   * ★ 定向突变 b（一律放过）⇒ 本臂红。
   */
  const same = specReport(['臂 1：本来就有的'])
  const verdict = await gate(ctx({
    runTestOnRevision: armRunner({ exitCode: 0, output: same }, { exitCode: 0, output: same }),
  }))
  assert.equal(verdict.ok, false, '★★ 两边臂集合**相同**、而父版本上就绿 ⇒ 那是真装饰性 ⇒ 必须拒')
  assert.match(
    String(verdict.blockers), /decorative/i,
    '★ 而措辞必须说清是**装饰性**（"它在父版本上就过了，证明不了什么"）',
  )

  /** ★ 而"修复版本上红"也要拒（两边都没绿过 ⇒ 它不是这次修复的证据）。 */
  const neverGreen = await gate(ctx({
    runTestOnRevision: armRunner({ exitCode: 0, output: same }, { exitCode: 1, output: same }),
  }))
  assert.equal(neverGreen.ok, false, '★ 两边臂集合相同 ⇒ 走老口径 ⇒ 父版本绿而修复版本红 ⇒ 装饰性')
})

test('臂 20c ★★ 三态不同形：装饰性 / 有真臂 / 判不了（三者两两不同）', async () => {
  /**
   * ── ★★★ 三态各自对应**一件不同的事**，而补救动作不同 ──────────────────────────
   *
   *   装饰性     ⇒ `blocked`："这条测试证明不了这次修复" ⇒ 去**改那条测试**
   *   有真臂     ⇒ `ok` + `evidence` 非空："这文件里有父版本上没有的臂" ⇒ 放行
   *   判不了     ⇒ `unmeasured`：读不到臂名单 / 读不到输出 ⇒ 去**补那个读数**
   *
   * ★ 而本任务新增的是**第二态**：它此前**不存在**（只有"按文件判"的两种结果）。
   */
  const novel = await gate(ctx({
    runTestOnRevision: armRunner(
      { exitCode: 0, output: specReport(['臂 1']) },
      { exitCode: 0, output: specReport(['臂 1', '★ 臂 2']) },
    ),
  }))
  const decorative = await gate(ctx({
    runTestOnRevision: armRunner(
      { exitCode: 0, output: specReport(['臂 1']) },
      { exitCode: 0, output: specReport(['臂 1']) },
    ),
  }))

  /** ★ "有真臂"与"装饰性"必须不同形：一个 `ok` + `evidence` 非空，另一个 `blocked`。 */
  assert.equal(novel.ok, true, '★ 有真臂 ⇒ ok')
  assert.ok((novel.r5?.evidence ?? []).length > 0, '★ 且 `evidence` 非空 —— 那**就是**"有真臂"那一格')
  assert.equal(decorative.ok, false, '★ 装饰性 ⇒ 不 ok')
  assert.equal(decorative.r5, undefined, '★ 而它**不带** `r5` 读数 —— 两个终态的形状必须能分开')
  assert.notDeepEqual(
    { ok: novel.ok, evidence: (novel.r5?.evidence ?? []).length > 0 },
    { ok: decorative.ok, evidence: (decorative.r5?.evidence ?? []).length > 0 },
    '★★ 两态必须两两不同形（否则"拿到了强证据"与"只拿到弱证据"在读的人眼里同形）',
  )

  /** ★ 第三态：执行器抛错 ⇒ `unmeasured`（而**不是**装饰性）。 */
  const couldNotRun = await gate(ctx({
    runTestOnRevision: async (_test, revision) => {
      if (revision === 'working-tree') throw new Error('the runner blew up')
      return { exitCode: 0, output: specReport(['臂 1']) }
    },
  }))
  assert.equal(couldNotRun.ok, false, '★ 跑不了 ⇒ 不 ok')
  assert.ok(
    typeof couldNotRun.unmeasured === 'string' && couldNotRun.unmeasured !== '',
    '★★ 而它必须落 `unmeasured` —— 把一次基础设施故障说成"这条测试是装饰品"，'
    + '就是让一个故障伪装成一个关于工作的结论',
  )
  assert.equal(couldNotRun.r5, undefined, '★ 判不了 ⇒ 不带 `r5` 读数')
})

test('臂 20d ★ 臂名的解析：两种报告格式都认，且**耗时尾巴不算名字**', async () => {
  /**
   * ── ★★ 为什么这一条必须有 ────────────────────────────────────────────────────
   *
   * 判据要"新增臂"，就必须能读**臂名**。而：
   *   · TAP reporter（`ok 1 - 名字`）与 spec reporter（`✔ 名字`）都要认；
   *   · ★★ 而**耗时尾巴必须去掉** —— 否则同一条臂在两次运行里因耗时不同
   *     （`(1.2ms)` vs `(2.3ms)`）变成**两个名字** ⇒ "新增臂"**永远非空** ⇒ 本判据恒真。
   *
   * ★ 那是一条**恒真**的判据的典型形状：它看起来在工作，而它什么都没在判。
   */
  const viaTap = await gate(ctx({
    runTestOnRevision: armRunner(
      { exitCode: 0, output: 'ok 1 - 臂 1\nok 2 - 臂 2\n# pass 2\n# fail 0' },
      { exitCode: 0, output: 'ok 1 - 臂 1\nok 2 - 臂 2\nok 3 - ★ 臂 3\n# pass 3\n# fail 0' },
    ),
  }))
  assert.equal(viaTap.ok, true, '★ TAP reporter 也要能读出臂名（`ok N - 名字`）')
  assert.deepEqual((viaTap.r5?.evidence ?? [])[0]?.newArms, ['★ 臂 3'], '★ 而它必须认出 TAP 里那条新臂')

  /** ★★ 耗时不同、名字相同 ⇒ 新增臂必须为**空**（否则恒真）。 */
  const sameArmsDifferentTiming = await gate(ctx({
    runTestOnRevision: armRunner(
      { exitCode: 0, output: '✔ 臂 1 (1.2ms)\n✔ 臂 2 (9.9ms)' },
      { exitCode: 0, output: '✔ 臂 1 (8.8ms)\n✔ 臂 2 (0.1ms)' },
    ),
  }))
  assert.equal(
    sameArmsDifferentTiming.ok, false,
    '★★ 两次运行**耗时不同而臂名相同** ⇒ 新增臂为空 ⇒ 走老口径 ⇒ 装饰性。'
    + '★ 若耗时没被去掉，这条会变成"新增了两条臂"而**恒真地放行** —— 那是一条不判任何事的判据',
  )
})

test('臂 20e ★★ 读数：`evidence` 与 `verified` 必须**分别**读出来（不许合并成一个布尔）', async () => {
  /**
   * ── ★★ 两个格子的**强度不同** ────────────────────────────────────────────────
   *
   *   `verified` —— "这个文件在父版本与工作区上各是什么退出码"（老口径，弱）
   *   `evidence` —— "这文件里**有一条臂父版本上没有**"（新口径，强）
   *
   * ★ 合并成一个布尔之后，读的人**无法分辨**"我拿到了强证据"与"我只拿到了弱证据"。
   *   ⇒ 那正是本仓那条纪律：**两种不同的东西不许同形**。
   */
  const verdict = await gate(ctx({
    runTestOnRevision: armRunner(
      { exitCode: 0, output: specReport(['臂 1']) },
      { exitCode: 0, output: specReport(['臂 1', '★ 臂 2']) },
    ),
  }))
  assert.equal(verdict.ok, true, '★ 前置')
  assert.ok(Array.isArray(verdict.r5?.verified), '★ `verified` 必须在（每个文件两轮退出码）')
  assert.ok(Array.isArray(verdict.r5?.evidence), '★ `evidence` 必须在（新增臂的那一格）')
  assert.equal(verdict.r5.verified.length, 1, '★ 一个目标文件 ⇒ `verified` 一条')
  assert.equal(verdict.r5.evidence.length, 1, '★ 而 `evidence` 也只有那条有新增臂的')
  console.log(`★ 两个读数分别读出来（t17）：verified=${JSON.stringify(verdict.r5.verified)} · evidence 的新增臂=${JSON.stringify(verdict.r5.evidence[0].newArms)}`)
})

/* ─────────────────────────────────────────────────────────────────────────────
 * ── ★★★ 臂 4（2026-10-19）：注入面必须真的把 `output` 交到判据手上
 *
 * ── 这一臂防的是什么 ────────────────────────────────────────────────────────────
 *
 * `r5` 的契约一直写着 `runTestOnRevision → { exitCode?, output? }`
 * （`src/gates/completion/r5.ts:299`），而**生产注入点**此前只交 `exitCode`。
 * 于是：
 *
 *     parseNodeTestReport('')  →  undefined  →  newArms 恒 undefined
 *     → 永远退回按文件判 → 任何「父版本绿 + 工作区绿」都被读成"装饰品"
 *
 * ⇒ 那条按【臂】判的分支（t17 加的）**从未生效过**。而它从未生效这件事，
 *   在判据自己的夹具里**看不出来** —— 因为夹具一直在喂 `output`（上一行的
 *   `output: exitCode === 0 ? 'ok' : 'AssertionError'`）。
 *
 * ★ 所以本臂**不看判据**，它看**接线**：真去读生产注入点的源码，断言
 *   `runTestOnRevision` 那一段对**两轮**（父版本 / working-tree）都返回了 `output`。
 *
 * ★ 为什么不做成"跑一次真的" —— 那要建 git 仓库、要 build、要 30 秒，而
 *   本条要钉的是一个**结构事实**：那一行有没有把 output 交出去。
 *   ★ 而纯源码断言的危险是"文字在、语义不对"：所以下面同时断言
 *     `runInDetachedRevision` 的调用处带着 `captureOutput: true` ——
 *     只写 `output:` 而没让执行器捕获，那个字段会是 undefined，与不写同形。
 * ───────────────────────────────────────────────────────────────────────────── */

test('★ 臂 4：生产注入点必须把 output 交到判据手上（两轮都要，且要让执行器真的捕获）', () => {
  const source = readFileSync(join(ROOT, 'src/tools/update-task/completion.ts'), 'utf8')
  const start = source.indexOf('runTestOnRevision:')
  assert.ok(start > 0, '★ 前置：生产注入点必须还在（改名了就要同步改本臂，不许静默失效）')
  /** 注入点那一段：到下一个注入键为止。 */
  const nextKey = source.indexOf('\n  readFile:', start)
  assert.ok(nextKey > start, '★ 前置：注入点的边界必须读得出来')
  const block = source.slice(start, nextKey)

  assert.match(block, /runVerifyCommandCaptured/,
    '★ working-tree 那一轮必须用**捕获版**执行器 —— 用 runVerifyCommand 拿不到 stdout，'
    + 'output 会是空串，与"没交"同形')
  assert.match(block, /captureOutput:\s*true/,
    '★ 父版本那一轮必须让 runInDetachedRevision **真的捕获** —— '
    + '只写 output: 而没开捕获，那个字段会是 undefined')
  const outputs = block.match(/output:/g) ?? []
  assert.equal(outputs.length, 2,
    '★ 两轮（父版本 / working-tree）都必须交 output —— 按臂判是差集，缺一半就恒为空')

  /** ★ 反向半边：判据侧必须**真的读**它（否则交出来也没人用，与本臂要防的同形）。 */
  const r5 = readFileSync(join(ROOT, 'src/gates/completion/r5.ts'), 'utf8')
  assert.match(r5, /parseNodeTestReport\(/,
    '★ 判据侧必须仍在解析输出 —— 否则交出来的 output 没人读')
})
