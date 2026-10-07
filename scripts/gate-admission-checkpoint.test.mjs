/**
 * ── `admission.checkpoint` 的三臂夹具（产物相对上次审查变了没有）────────────────
 *
 * 契约要求每条判据自带三臂（`docs/GATE-REGISTRY.md` §6）。本判据的三臂是：
 *
 *   臂 1（伪造臂）：产物相对**上次审查时的 git 版本**变了 ⇒ 期望 blocked（触发再审）
 *                   ★ 且必须指名【哪份文档、从哪个版本到哪个版本、距上次多久】
 *   臂 2（未测量臂）：读不到会话事件 / 不是 git 仓库 / 拿不到版本
 *                     ⇒ 期望 unmeasured，★ 不是 ok，且与 blocked 不同形
 *   臂 3（对照臂）：版本**没变** ⇒ 期望 ok（证明判据不误伤"审过了、没动"的产物）
 *
 * ★ 缺任何一臂，这条判据不算完成。理由是这个仓库踩过的：只有对照臂能区分
 *   「判据有效」与「判据在乱拒」（START-HERE §4）。
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * 用户原话，就是这一整段存在的理由：
 *
 *     「以前这些都是手动做的，什么时候触发也是凭我的个人经验。」
 *
 * ⇒「凭经验决定何时触发」= 靠人执行的规则，而本项目文档已反复证明这类规则会腐烂。
 *   本判据把触发换成一个机械可判的问题：**产物相对上次审查时的版本变了没有**。
 *
 * ── ★ 本文件刻意不写的一句话（本队已因这类棘轮返工多次）──────────────────────────
 *
 * 「真实 ctx 上还没有 `checkpoint` 这一格」「registry 里还没有这条判据」
 * —— 这些都是**接线还没做时的快照**（调用点与装配属 t10），**不是不变量**。
 * 夹具一个字节都不许把它写成断言：一旦接线落地，那种断言会在队友那里按设计变红，
 * 而红的原因与"判据坏了"毫无关系。
 *
 * ⇒ 本文件断言的一律是**判据自身的性质**（给定什么样的读数，判据说什么）。
 *
 * ── ★★ 本文件最贵的一条臂：unmeasured ≠ ok ────────────────────────────────────
 *
 * 验收单列了一条：「★ unmeasured 与 ok 必须不同形：拿不到版本 ≠ 没改动」。
 * 它的反面（把"拿不到版本"读成"没改动"）是本判据**最容易写、而且错了以后看起来最好**
 * 的实现：`current === reviewed` 与 `(current ?? reviewed) === reviewed` 在
 * "读到了"这条路径上逐字同形，只在**读不到**时分开 —— 而那正是非 git 仓库的样子
 * （判据在最需要它的地方永远沉默，沉默的样子与"审过了、没问题"一模一样）。
 *
 * ⇒ 臂 2 有一条专门跑**真的非 git 目录**的子臂（不是构造一个 `undefined` 字段），
 *   而且它同时断言"那一支的形状里没有 `ok`"。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

/**
 * ★ 从 `../lib` 读（和每一条既有判据夹具一样）：测的是**真的会被装配层装上**的
 *   那一份代码，而不是 `src/` 里的一份平行副本。
 */
import { gate, appliesTo, id, point, requires } from '../lib/gates/admission/checkpoint.js'
import { checkRequires } from '../lib/gates/requires.js'
import { createGateRegistry } from '../lib/gates/registry.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GATE_SOURCE = join(ROOT, 'src', 'gates', 'admission', 'checkpoint.ts')
const BUILT_GATE = join(ROOT, 'lib', 'gates', 'admission', 'checkpoint.js')

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

const DOC = 'docs/REQUIREMENTS.md'
const OTHER_DOC = 'docs/PLAN.md'
/** 两个不同的 git 版本。用短的假 rev —— 判据只做字符串比较，不认识 git。 */
const REV_A = 'a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4'
const REV_B = 'b9c8d7e6b9c8d7e6b9c8d7e6b9c8d7e6b9c8d7e6'
/** 一个固定的"现在"，好让"距上次多久"这条断言不依赖跑夹具的墙钟。 */
const NOW = 1_800_000_000_000

/**
 * 一个最小 ctx。**每一格都显式给值**，好让每条臂只改它要测的那一格
 * —— 一个"顺手把别的格也拿掉"的夹具会让失败的归因失效。
 */
function ctx(overrides = {}) {
  return {
    task: { id: 't6', kind: 'requirements' },
    documents: [DOC],
    /** 产物现在的 git 版本（调用方跑 git rev-parse 读到）。 */
    currentRevisions: { [DOC]: REV_B },
    /** 上次审查时的 git 版本（调用方从审查记录里读到）。 */
    reviewedRevisions: { [DOC]: REV_A },
    /** 会话事件里观察到这个主会话真的写过的产物。 */
    observedDocumentWrites: [DOC],
    /** 上次审查的时刻 / 现在。75 分钟 ⇒ 人话是 "75m ago"。 */
    reviewedAt: NOW - 75 * 60 * 1000,
    now: NOW,
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（伪造臂）：产物相对上次审查的版本【变了】⇒ 触发再审
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 伪造臂：产物相对上次审查的版本变了 ⇒ blocked（触发再审）', () => {
  const verdict = gate(ctx())
  const blockers = expectBlocked(verdict)
  assert.equal(blockers.length, 1, '★ 只报真的动过的那一份，不连坐')
  assert.match(blockers[0], /docs\/REQUIREMENTS\.md/, '★ 必须指名是哪份文档（验收 ②）')
  assert.match(blockers[0], /UNREVIEWED change/, '★ 必须说清是哪一类问题：未审改动，而不是别的')
})

test('★ 臂 1 的证据必须说清【哪份文档、从哪个版本到哪个版本、距上次多久】（验收 ②）', () => {
  /**
   * ── 这一条是本任务验收单列出来的那一句的落点 ──────────────────────────────────
   *
   * 用户要的不是"你该审了"，而是**可以据以行动、也可以据以反驳**的读数。
   * 一句笼统的告警与"没说话"在下游同形 —— 而这条判据的全部价值就是把
   * 「什么时候审」变成一个**可读的**读数，而不是一次经验判断。
   *
   * ⇒ 三样东西各断言一次，且**逐字**断言版本号：一个把两个版本都写成 "changed"
   *   的实现会通过"提到了版本"的弱断言，却答不出"从哪个版本到哪个版本"。
   */
  const blockers = expectBlocked(gate(ctx()))
  const line = blockers.join('\n')
  assert.match(line, /docs\/REQUIREMENTS\.md/, '★ ① 哪份文档')
  assert.match(line, new RegExp(REV_A), '★ ② 从哪个版本（上次审查时的 rev 必须逐字出现，不是一个占位词）')
  assert.match(line, new RegExp(REV_B), '★ ② 到哪个版本（现在的 rev 也必须逐字出现）')
  assert.match(line, /75m ago/, '★ ③ 距上次多久（人话，不是毫秒数）')
  /** ★ 方向也要能读出来：谁在前谁在后。只列两个 rev 而不说谁到谁，读不出方向。 */
  assert.match(line, /reviewed at .* and is now at /, '★ 两个版本的方向必须写出来（"从 A 到 B"）')
})

test('★ 臂 1b：一次给全 —— 三份产物都动过就报三条，不短路', () => {
  const blockers = expectBlocked(gate(ctx({
    documents: [DOC, OTHER_DOC, 'docs/DECISIONS.md'],
    currentRevisions: { [DOC]: REV_B, [OTHER_DOC]: REV_B, 'docs/DECISIONS.md': REV_B },
    reviewedRevisions: { [DOC]: REV_A, [OTHER_DOC]: REV_A, 'docs/DECISIONS.md': REV_A },
    observedDocumentWrites: [DOC, OTHER_DOC, 'docs/DECISIONS.md'],
  })))
  assert.equal(blockers.length, 3, '★ 一次给全，而不是修一份又冒一份（本队的不短路纪律）')
  for (const path of [DOC, OTHER_DOC, 'docs/DECISIONS.md']) {
    assert.ok(blockers.some((line) => line.includes(path)), `★ "${path}" 必须被点名`)
  }
})

test('★ 臂 1c：从没审过的产物 ⇒ 也是未审改动，★ 但与「从 A 变到 B」不同形', () => {
  /**
   * ── 为什么这一支必须存在，且必须与 `moved` 分开写 ──────────────────────────────
   *
   * 一个**从没被审查过**的产物与一个**刚审过**的产物，在任何"看着挺全"的检查下
   * 同形（都在盘上、都非空）—— 而"这份需求从没被对抗性审查过"恰恰是用户要消灭
   * 的那件事。⇒ 它必须触发。
   *
   * ★ 但它不能复用 `moved` 那句话：一句话不能同时说"从 A 变到 B"与"根本没有 A"。
   *   把两者合成一句，读日志的人无法区分"我上次审完你又改了"与"我从来没审过"，
   *   而两者的补救动作不同（再审一遍 vs 第一次审）。
   */
  const blockers = expectBlocked(gate(ctx({ reviewedRevisions: {} })))
  assert.equal(blockers.length, 1)
  assert.match(blockers[0], /docs\/REQUIREMENTS\.md/)
  assert.match(blockers[0], /NEVER been reviewed/, '★ 这一支说"从没审过"，不说"从 A 变到 B"')
  assert.doesNotMatch(blockers[0], /reviewed at .* and is now at /, '★ 而且不许伪造出一个"上次审查的版本"')
})

test('★ 臂 1d：审查记录坏了（值不是版本）⇒ ★ 与"从没审过"不同形', () => {
  /**
   * ── 一条坏掉的记录不是一个不存在的记录 ────────────────────────────────────────
   *
   * 补救动作完全不同：**去修记录** vs **去开一轮审查**。把坏的读成"从没审过"
   * 会让判据常态化地多开审查 —— 而"多开"这个方向不但烧预算，更**掩盖**了
   * 审查记录正在腐烂这个事实（本队记账的"把没测到并进某个结论"的同源形态）。
   */
  const verdict = gate(ctx({ reviewedRevisions: { [DOC]: '' } }))
  const reason = expectUnmeasured(verdict)
  assert.match(reason, /not a revision at all/, '★ 坏记录 ⇒ 未测量，且说清是"记录坏了"')
  assert.doesNotMatch(reason, /NEVER been reviewed/, '★ 不许把"记录坏了"读成"从没审过"')

  /** ★ 反向半边：一个**合法**的记录不许被读成坏的。 */
  assert.equal(gate(ctx({ reviewedRevisions: { [DOC]: REV_A } })).ok, false)
  assert.equal(expectBlocked(gate(ctx({ reviewedRevisions: { [DOC]: REV_A } }))).length, 1)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（未测量臂）：读不到事件 / 非 git / 拿不到版本 ⇒ unmeasured，★ 不是 ok
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 未测量臂：拿不到"现在的版本"⇒ unmeasured，不是 ok', () => {
  const reason = expectUnmeasured(gate(ctx({ currentRevisions: undefined })))
  assert.match(reason, /could not be observed/, '★ 必须说清是"没能观察"，不是"没改动"')
  assert.match(reason, /not measured/, '★ 而且要把"这不是没改动"写出来')
})

test('臂 2b ★ 未测量臂：拿不到"上次审查的版本"⇒ unmeasured，不是 ok', () => {
  const reason = expectUnmeasured(gate(ctx({ reviewedRevisions: undefined })))
  assert.match(reason, /could not be observed/)
})

test('★★ 臂 2c：★ unmeasured 与 ok 必须【不同形】（验收 ⑤）', () => {
  /**
   * ── 这是本任务验收里单列的一条，也是本判据最容易写错的地方 ────────────────────
   *
   * "拿不到版本"与"没改动"如果只差一句措辞，那么任何**只读 `ok`** 的调用方
   * （编排层就是只读 `ok` / `blockers` / `unmeasured` 的）会把它们读成同一件事：
   * "不用再审"。于是这条判据在最需要它的地方（非 git 仓库、读不到记录）
   * **永远沉默**，而沉默的样子与"审过了、没问题"一模一样。
   *
   * ⇒ 形状上的三条断言，缺一不可：
   *     ① 两条出口的 `ok` 值不同（恒真写法里"都是 false"是不够的，见 ②③）；
   *     ② 未测量那一支**带着 `unmeasured` 字段**，而 ok 那一支**没有**；
   *     ③ ok 那一支**没有 `blockers`**（否则它就在说"发现问题"）。
   * ★ 一条只断言 `expectUnmeasured` 能跑通的臂在"把两边都返回 unmeasured"的实现上
   *   照样绿 —— 所以这里**同时**把 ok 那一支的形状钉住。
   */
  const un = gate(ctx({ currentRevisions: undefined }))
  const fine = gate(ctx({ currentRevisions: { [DOC]: REV_A } }))

  assert.equal(un.ok, false)
  assert.equal(fine.ok, true)
  assert.equal(typeof un.unmeasured, 'string', '★ 未测量那一支必须带 unmeasured')
  assert.equal('unmeasured' in fine, false, '★ 而 ok 那一支不许带它 —— 这是"不同形"的字面落点')
  assert.equal('blockers' in un, false, '★ 未测量不许带 blockers')
  assert.equal('blockers' in fine, false, '★ ok 也不许带 blockers')
  assert.notDeepEqual(Object.keys(un).sort(), Object.keys(fine).sort(), '★ 两支的字段集合必须真的不同')
})

test('★★ 臂 2d：★ 非 git 仓库 / 读不到该文件的版本 ⇒ 未测量，【绝不是 ok】（真的跑 git 看一眼）', () => {
  /**
   * ── 为什么这一条要**真的建一个非 git 目录**，而不是构造一个 `undefined` ────────
   *
   * 构造出来的 `undefined` 只能证明"判据处理了一个 `undefined`"。而这一条要证明的
   * 是**真实的那个形状**：在一个没有 git 的目录里，`git rev-parse HEAD:docs/x.md`
   * 会以一个**具体的**失败退出 —— 它对每一份产物都不产出版本。
   * ⇒ 判据必须把那一组读数读成"没能测量"，而不是任何一个版本。
   *
   * ★ 同时断言那个失败**真的发生了**（退出码非 0 且 **没有任何 stdout**）。
   *   一条只断言"判据返回 unmeasured"的臂，在一个"git 命令其实成功了、而夹具把
   *   输出读丢了"的世界里照样绿 —— 那时测的是夹具，不是判据。
   */
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'checkpoint-nongit-')))
  try {
    writeFileSync(join(dir, 'REQUIREMENTS.md'), '# 需求\n')
    const probe = spawnSync('git', ['rev-parse', 'HEAD:REQUIREMENTS.md'], { cwd: dir, encoding: 'utf8' })
    assert.notEqual(probe.status, 0, '★ 夹具前提：非 git 目录里 rev-parse 必须失败')
    assert.equal(String(probe.stdout ?? '').trim(), '', '★ 而且它不产出任何版本 —— 这正是"读不到"的样子')

    /**
     * 调用方如实把"读不到"交出来（每一份都是 `undefined`）⇒ 判据必须落 unmeasured。
     * ★ `{ 'REQUIREMENTS.md': undefined }` 与"整个对象缺席"形状不同、结论相同：
     *   两者都答不了"变了没有"。这里覆盖的是**每份产物各自读不到**那一支。
     */
    const verdict = gate(ctx({
      documents: ['REQUIREMENTS.md'],
      currentRevisions: { 'REQUIREMENTS.md': undefined },
      reviewedRevisions: { 'REQUIREMENTS.md': REV_A },
      observedDocumentWrites: [],
    }))
    const reason = expectUnmeasured(verdict)
    assert.match(reason, /no readable current git revision|could not be measured/, '★ 必须说清是"读不到版本"')
    assert.match(reason, /non-git repository|untracked file|failed read/, '★ 而且要把"为什么读不到"的候选说出来，而不是一句"测不了"')

    /**
     * ★★ 对照：把同一份产物在一个**真的 git 仓库**里读一次 ⇒ 必须能比、且能报出改动。
     *   缺了这一半，上面那条在"判据对所有输入都返回 unmeasured"的实现上照样绿。
     */
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'checkpoint-git-')))
    try {
      const run = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
      assert.equal(run(['init', '-q']).status, 0)
      assert.equal(run(['config', 'user.email', 'checkpoint@test']).status, 0)
      assert.equal(run(['config', 'user.name', 'checkpoint']).status, 0)
      writeFileSync(join(repo, 'REQUIREMENTS.md'), '# 需求 v1\n')
      assert.equal(run(['add', 'REQUIREMENTS.md']).status, 0)
      assert.equal(run(['commit', '-q', '-m', 'v1']).status, 0)
      const revA = String(run(['rev-parse', 'HEAD:REQUIREMENTS.md']).stdout).trim()
      assert.match(revA, /^[0-9a-f]{40}$/, '★ 夹具前提：真的读到了一个 git rev')

      writeFileSync(join(repo, 'REQUIREMENTS.md'), '# 需求 v2（吸收了审查意见）\n')
      assert.equal(run(['add', 'REQUIREMENTS.md']).status, 0)
      assert.equal(run(['commit', '-q', '-m', 'v2']).status, 0)
      const revB = String(run(['rev-parse', 'HEAD:REQUIREMENTS.md']).stdout).trim()
      assert.notEqual(revA, revB, '★ 两次提交必须是两个不同的版本 —— 否则下面那条对照是恒假的')

      const real = gate(ctx({
        documents: ['REQUIREMENTS.md'],
        currentRevisions: { 'REQUIREMENTS.md': revB },
        reviewedRevisions: { 'REQUIREMENTS.md': revA },
        observedDocumentWrites: ['REQUIREMENTS.md'],
      }))
      const realBlockers = expectBlocked(real)
      assert.match(realBlockers.join('\n'), new RegExp(revA))
      assert.match(realBlockers.join('\n'), new RegExp(revB))
      assert.notDeepEqual(
        Object.keys(real).sort(), Object.keys(verdict).sort(),
        '★ 同一条判据在"真的读到版本"与"读不到版本"两种输入下，出口形状必须不同形',
      )
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('臂 2e ★ 未测量臂：会话事件那一格的形状不对（不是列表）⇒ unmeasured', () => {
  const reason = expectUnmeasured(gate(ctx({ observedDocumentWrites: 'docs/REQUIREMENTS.md' })))
  assert.match(reason, /not a list/)
  assert.match(reason, /not measured/)
})

test('★★ 臂 2f：★ 「观察了、确实没写过」(=`[]`) 与「没能观察」(=`undefined`) 不同形', () => {
  /**
   * ── 本队已经立过多次的一条界线 ────────────────────────────────────────────────
   *
   * `observedDocumentWrites: []` 是一次**在場的观察**（有人真的看过会话事件，
   * 结论是"这个主会话没写过产物"）；`undefined` 是**没能观察**。
   *
   * ★ 而这里有一条**刻意的口径**，必须被钉住，否则下一位读者会以为它是缺陷：
   *
   *     版本面**已经独立**回答了"变了没有" —— 两个版本字符串不等，这件事不因为
   *     "我没看见谁写的"而变得不确定。所以事件格缺席时，**裁决不变**（仍然是
   *     blocked），它降级的是**证据的完整性**（"谁写的"那一句），不是那个事实。
   *
   * ⇒ 把一个"事件读不到"翻成 unmeasured 的实现，会让判据在"有人改了产物、
   *   而事件读不到"时**永远沉默** —— 而那正是它最需要说话的时刻。
   *
   * ★ 对照：`observedDocumentWrites: []` 时裁决**同样**是 blocked（版本不会因为
   *   "这一侧没写过"就变回去），但它**不许**在告警里声称"this session wrote it"。
   *   那是两句不同的话，而合成一句会让"别人改的"读成"我改的"。
   */
  const noObservation = gate(ctx({ observedDocumentWrites: undefined }))
  assert.equal(expectBlocked(noObservation).length, 1, '★ 版本面已经测到的事实，不因事件读不到而消失')
  assert.match(
    noObservation.blockers.join('\n'),
    /write history could not be observed/,
    '★ 但它必须在证据里如实说"谁写的不知道"—— 少说这一句，就是拿一次观察失败冒充一次干净的归因',
  )

  const observedNone = gate(ctx({ observedDocumentWrites: [] }))
  assert.equal(expectBlocked(observedNone).length, 1, '★ 观察到"没写过"同样不改版本面的结论')
  assert.doesNotMatch(
    observedNone.blockers.join('\n'),
    /this session wrote it/,
    '★ 而它**不许**声称是这一侧写的 —— 观察到的事实与没观察到的推断必须不同形',
  )

  /** ★ 两条之间的差别正是"在场 vs 缺席"，而不是"另一个裁决"。 */
  assert.notDeepEqual(
    noObservation.blockers, observedNone.blockers,
    '★ "没能观察"与"观察到没写过"必须在读数里不同形（本队那条纪律的字面落点）',
  )

  /** ★ 反面：真的观察到了写入 ⇒ 才允许说出"this session wrote it"。 */
  assert.match(expectBlocked(gate(ctx())).join('\n'), /this session wrote it/)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（对照臂）：版本没变 ⇒ ok（判据不误伤"审过了、没动"的产物）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 对照臂：产物没动过 ⇒ ok（证明判据不误伤正常情形）', () => {
  /**
   * ★ 缺了这一臂就无法区分"判据有效"与"判据在乱拒"（START-HERE §4）：
   *   一个 `return blocked([...])` 的判据会让上面每一条臂都绿。
   */
  expectOk(gate(ctx({
    documents: [DOC, OTHER_DOC],
    currentRevisions: { [DOC]: REV_A, [OTHER_DOC]: REV_B },
    reviewedRevisions: { [DOC]: REV_A, [OTHER_DOC]: REV_B },
  })))
})

test('臂 3b ★ 对照臂：多份产物、顺序无关 —— 逐份比较，不是"任一份相同就 ok"', () => {
  /**
   * ★ 一条很自然的错误实现是 `documents.some(...)` / `visible()` 之类的"扫到一个
   *   相同就放行"。它在只有一份产物的夹具上完全看不出来。
   * ⇒ 这里**同时**放两份：一份没变、一份变了 —— 结论必须是 blocked，且**只点名变了的那份**。
   */
  const blockers = expectBlocked(gate(ctx({
    documents: [DOC, OTHER_DOC],
    currentRevisions: { [DOC]: REV_A, [OTHER_DOC]: REV_B },
    reviewedRevisions: { [DOC]: REV_A, [OTHER_DOC]: REV_A },
  })))
  assert.equal(blockers.length, 1, '★ 只报动了的那一份')
  assert.match(blockers[0], /docs\/PLAN\.md/)
  assert.doesNotMatch(blockers.join('\n'), /docs\/REQUIREMENTS\.md/, '★ 没动的那份不许出现在告警里（噪音 = 教人忽略门禁）')

  /** ★ 而**整个**文档集都没变 ⇒ ok（反向半边：上一条不许恒真）。 */
  expectOk(gate(ctx({
    documents: [DOC, OTHER_DOC],
    currentRevisions: { [DOC]: REV_A, [OTHER_DOC]: REV_A },
    reviewedRevisions: { [DOC]: REV_A, [OTHER_DOC]: REV_A },
  })))
})

test('臂 3c ★ 对照臂：产物清单为空【不是】"没问题"，是可判定的事实 ⇒ blocked', () => {
  /**
   * ★ 与 `admission.absorb` 同一条：缺席（不知道产物是什么）与空数组（知道、而
   *   它确实是空的）必须不同形。前者 ⇒ unmeasured，后者 ⇒ blocked。
   *
   *   把空数组读成 ok，会让"这一轮压根没有产物"在读数里变成"产物都审过了"
   *   —— 那正是本任务要消灭的合流形态。
   */
  const blockers = expectBlocked(gate(ctx({ documents: [], currentRevisions: {}, reviewedRevisions: {} })))
  assert.match(blockers.join('\n'), /declares no requirement\/plan document at all/)
})

test('臂 3d ★ 对照臂：非法路径单独交出来，不静默丢弃', () => {
  /**
   * ★ "这一份没被比较"与"这一份没变"必须不同形。静默丢一个绝对路径，会让
   *   "有人交了一份比不出来的产物"读成"那份产物很干净"。
   *   同一个形状本队已经在 `dispatch.changed-paths` 的 `bucket` 里处理过。
   */
  const blockers = expectBlocked(gate(ctx({
    documents: ['/abs/REQUIREMENTS.md', '../outside/PLAN.md'],
    currentRevisions: {},
    reviewedRevisions: {},
    observedDocumentWrites: [],
  })))
  assert.equal(blockers.length, 2, '★ 两条非法路径各自报出来')
  assert.match(blockers.join('\n'), /not a workspace-relative path/)
})

// ─────────────────────────────────────────────────────────────────────────────
// 闸门与输入面（appliesTo / requires）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 闸门：没交产物清单 ⇒ 这条判据不说话（skipped），★ 而不是开火说"你没有产物"', () => {
  /**
   * ── 闸门管"说不说话"，requires 管"说话时缺不缺输入"（requires.ts 那一节）───────
   *
   * `documents` 缺席 = "这一轮没人问这件事"，不是"产物一个都没有"。
   * 把两者合成一个 ⇒ 每一次与准入无关的求值都会产出一条"你没有产物"的 blocker，
   * 而噪音会教人忽略门禁 —— 与误报同样有害。
   */
  assert.equal(appliesTo(ctx()), true, '★ 交了清单 ⇒ 说话')
  assert.equal(appliesTo({}), false, '★ 没交清单 ⇒ 不说话')
  assert.equal(appliesTo(undefined), false, '★ 连 ctx 都没有 ⇒ 不说话')
  assert.equal(appliesTo({ documents: 'docs/REQUIREMENTS.md' }), false, '★ 形状不是列表 ⇒ 不说话（而不是"有产物、形状不对"就开火）')

  /** ★ 而"不说话"是**真的没进裁决** —— 用注册表问一次，而不是只问 `appliesTo`。 */
  const r = createGateRegistry()
  r.register({ id, point, description: 'x', gate, appliesTo, requires })
  return r.evaluate(point, {}).then((evaluation) => {
    assert.equal(evaluation.evaluated, 0)
    assert.equal(evaluation.skipped, 1)
    /**
     * ★★★ t69：这一条断言的是【t58 之前】的口径（**夹具过期**，不是真实缺陷）。
     *   t58 有意把「有判据却一条没跑」改成 `ok:false`，且本队那条纪律正对着它：
     *   **"这一步没被检查"不许读成"通过"**（不把没测到并进通过）。
     *   ★ 修法是改夹具（不是把 registry 改回去 —— 那是 out-of-scope，且会弄坏正确口径）。
     */
    assert.equal(evaluation.ok, false, '★ t58 之后：全跳过 ⇒ ok:false（"没被检查"不许读成"通过"）')
    assert.deepEqual(evaluation.blockers, [])
  })
})

test('★ 闸门在【成团之前】的位置上真的会跑 —— 不是"注册了但调不到"', async () => {
  /**
   * ★ 本队记账过五次"装了但调不到"。这里用**真的注册表**问一次：
   *   把这条判据交进去，它必须出现在 `admission` 的求值结果里。
   *
   * ★ 而这里**刻意不写**"注册表现在有几条判据" —— 那是接线快照，不是不变量。
   */
  const r = createGateRegistry()
  r.register({ id, point, description: 'x', gate, appliesTo, requires })
  const evaluation = await r.evaluate(point, ctx())
  assert.equal(evaluation.registered, 1)
  assert.equal(evaluation.evaluated, 1, '★ 适用 ⇒ 真的跑了（不是 skipped）')
  assert.equal(evaluation.ok, false, '★ 这一轮有未审改动 ⇒ 位置整体不放行')
  assert.equal(evaluation.blockers.length, 1)
  assert.match(evaluation.blockers[0], new RegExp(`\\[${id.replace('.', '\\.')}\\]`), '★ 开火时带判据 id 前缀')
})

test('★ 输入面：`requires` 声明了四格，且闸门格【不进】requires', () => {
  /**
   * ── 声明与未测量臂必须逐条对齐 ────────────────────────────────────────────────
   *
   * 判据说"缺 X 就 unmeasured"，X 就必须出现在声明里。本判据的四格各自对着
   * `gate()` 里的一处 `unmeasured`：
   *
   *     documents              ⇒ "the … documents … could not be observed"
   *     currentRevisions       ⇒ "the current git revision … could not be observed"
   *     reviewedRevisions      ⇒ "the git revision … were last reviewed at … could not be observed"
   *     observedDocumentWrites ⇒ "write history was injected in a shape that is not a list"
   *
   * ★ 反向：`task.kind` / `task.id` / `reviewedAt` / `now` **不许**进 requires。
   *   前三格里，`reviewedAt` / `now` 是**可选**的（缺席只少一句人话，裁决不变）——
   *   声明它们会让核对层在每一个没注入时钟的调用点上报缺格，而那是正常情形。
   */
  assert.deepEqual([...requires].sort(), [
    'currentRevisions',
    'documents',
    'observedDocumentWrites',
    'reviewedRevisions',
  ])
  for (const gateCell of ['task.kind', 'task', 'reviewedAt', 'now']) {
    assert.equal(requires.includes(gateCell), false, `★ "${gateCell}" 不进 requires：缺席不是"缺输入"（闸门 / 可选）`)
  }
})

test('★ A 层核对：适用而缺一格 ⇒ 核对报出缺的是哪一格；不适用 ⇒ 不报（不制造噪音）', () => {
  const subject = { id, requires, appliesTo }

  /** ① 声明齐了 ⇒ ok（对照臂）。 */
  const injected = checkRequires(subject, ctx(), true)
  assert.equal(injected.status, 'ok')
  assert.deepEqual(injected.missing, [])
  assert.deepEqual([...injected.present].sort(), [...requires].sort())

  /** ② 适用、但没接上观察面 ⇒ 必须指名报缺。 */
  const missing = checkRequires(subject, { documents: [DOC] }, true)
  assert.equal(missing.status, 'incomplete')
  assert.deepEqual(
    [...missing.missing].sort(),
    ['currentRevisions', 'observedDocumentWrites', 'reviewedRevisions'],
    '★ 缺哪几格就报哪几格',
  )

  /** ③ 不适用（这一轮没人问准入）⇒ 一格缺席**不报**—— 不制造噪音。 */
  const notApplicable = checkRequires(subject, {})
  assert.equal(notApplicable.status, 'skipped')
  assert.deepEqual(notApplicable.missing, [], '★ 不适用不许产出噪音')
})

test('★ A 层核对：`observedDocumentWrites: []` 是【在场】的观察，不是缺格', () => {
  const check = checkRequires({ id, requires, appliesTo }, ctx({ observedDocumentWrites: [] }), true)
  assert.equal(check.status, 'ok', '★ `[]` 是"观察了、确实没写过"，与 `undefined`（没能观察）不同形')
  assert.deepEqual(check.present, [...requires])
})

// ─────────────────────────────────────────────────────────────────────────────
// "距上次多久"这一句本身的形状（三态：说得出来 / 说不出来 / 时钟倒退）
// ─────────────────────────────────────────────────────────────────────────────

test('★ "距上次多久"：缺时钟 ⇒ 少说一句，但裁决【不变】（可选格不是闸门）', () => {
  /**
   * ★ 一条把"没有时钟"翻成 unmeasured 的实现，会让判据在任何没注入时钟的调用点
   *   **永远沉默** —— 而"距上次多久"只是让告警更好读，它不是触发条件的一部分。
   *   触发条件只有一条：**两个版本不等**。
   */
  const withoutClock = gate(ctx({ reviewedAt: undefined, now: undefined }))
  const withClock = gate(ctx())
  assert.equal(expectBlocked(withoutClock).length, 1, '★ 缺时钟照样触发')
  assert.doesNotMatch(withoutClock.blockers.join('\n'), /ago/, '★ 但不说"距上次多久"（不许用 0 兜底）')
  assert.match(withClock.blockers.join('\n'), /ago/, '★ 有钟时要说出来')

  /** ★ 而且两句必须真的不同 —— 缺时钟时说了一句假的"0s ago"，这条会红。 */
  assert.notDeepEqual(withoutClock.blockers, withClock.blockers)
})

test('★ "距上次多久"：时钟倒退不许折成 0（"记录里的时刻在未来"必须说出来）', () => {
  /**
   * ── 一个用 0 兜底的实现会掩盖一个真实的形态 ────────────────────────────────────
   *
   * `reviewedAt > now` 在恢复自另一个进程、时钟漂移、注入写反了的时候都会发生。
   * 把它折成 "0s ago" 会让"记录看起来来自未来"读作"刚刚审过"—— 而后者是
   * 一个**关于工作进度的结论**。两者必须不同形。
   */
  const blockers = expectBlocked(gate(ctx({ reviewedAt: NOW + 60 * 60 * 1000 })))
  assert.match(blockers.join('\n'), /FUTURE/, '★ 时钟倒退必须如实说出来')
  assert.doesNotMatch(blockers.join('\n'), /\b0s ago\b/, '★ 不许折成"刚刚审过"')
})

test('★ "距上次多久"的人话刻度：秒 / 分 / 小时三档都给得出', () => {
  const line = (offsetMs) => expectBlocked(gate(ctx({ reviewedAt: NOW - offsetMs }))).join('\n')
  assert.match(line(30 * 1000), /30s ago/)
  assert.match(line(75 * 60 * 1000), /75m ago/)
  assert.match(line(3 * 60 * 60 * 1000), /3\.0h ago/)
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 定向突变（真的执行）：把"版本变了没"的比较改成【恒真】与【恒假】⇒ 对应臂红
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 为什么这两次突变要**真的跑**，而不是写在注释里 ────────────────────────────────
 *
 * 契约 §8.5 规则二：「没被突变抓住的修复，等于没修」。而它的后半句更狠：
 * **一条恒真的断言会在"突变全红"的表象下活下来**。所以本文件不是"声称"这两次
 * 突变能打红对应的臂，而是把它们跑出来：
 *
 *     ① 备份 `src/gates/admission/checkpoint.ts`
 *     ② 把那次版本比较改成恒真（一律算变过）/ 恒假（一律算没变）
 *     ③ 重新 build 出 `lib/`（整个仓库的夹具读的都是 lib/，所以必须真的重建）
 *     ④ 用臂 1 / 臂 3 的输入再问一次 ⇒ **恒真必须让臂 3 红、恒假必须让臂 1 红**
 *     ⑤ 还原源码、重新 build，并断言还原之后的裁决与突变前**逐字相等**
 *
 * ★ 第 ⑤ 步不是礼节：没有它，一次中途失败会把一条被突变的判据留在盘上，
 *   而此后所有夹具都在测一份没人认得的代码 —— 那比突变本身坏得多。
 *
 * ★ 顺序是【串行】的，而且必须：`pnpm build` 会先 `rm -rf lib/`（clean-build），
 *   并行跑两个 build 会让另一个进程读到半个 lib/。本文件因此不做任何并行突变。
 */
function withBuiltGate(mutatedSource, body) {
  const original = readFileSync(GATE_SOURCE, 'utf8')
  const backup = `${BUILT_GATE}.checkpoint-mutation-backup`
  const hadBuilt = existsSync(BUILT_GATE)
  if (hadBuilt) writeFileSync(backup, readFileSync(BUILT_GATE, 'utf8'))
  try {
    writeFileSync(GATE_SOURCE, mutatedSource)
    const built = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: true })
    assert.equal(built.status, 0, `★ 突变体必须编译得过（否则这次突变测的是 tsc，不是判据的裁决）:\n${built.stdout}\n${built.stderr}`)
    /**
     * ★ 返回 body 的返回值，**并保证还原发生在它之后** —— body 是 async 的
     *   （它要 `await freshGate(...)`）。一个不 await 的 `finally` 会在
     *   "突变体还没被读到"时就把源码写回去，于是那个模块实例读到的是**还原后的**
     *   lib/ —— 而检查结果是"突变没生效"。★ 那正是本文件顶部那段实测记录的孪生形态。
     */
    const result = body()
    if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
      return result.then(
        (value) => { restore(); return value },
        (error) => { restore(); throw error },
      )
    }
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }

  function restore() {
    writeFileSync(GATE_SOURCE, original)
    const restored = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: true })
    assert.equal(restored.status, 0, `★ 还原之后必须能重新 build 成功:\n${restored.stdout}\n${restored.stderr}`)
    if (hadBuilt) rmSync(backup, { force: true })
  }
}

/** 两次突变的针脚（★ 逐字，且下面有专门一条断言它们在源码里真的存在）。 */
const NEEDLE_COMPARE = `    if (reviewed.revision === now.revision) unchanged.push(path)`
const NEEDLE_MOVED = `    else moved.push({ path, from: reviewed.revision, to: now.revision })`

/**
 * ── ★★ 突变体必须用【重新 import】拿到，不许用文件顶部那个绑定 ──────────────────
 *
 * MEASURED（本任务第一次跑突变臂，夹具自己抓出来的）：第一版在突变体里调的是
 * 文件顶部 `import { gate } from '../lib/…'` 的那个绑定 —— 而它在**文件加载时**
 * 就已经解析完了。于是：
 *
 *     ① 突变体被写进 src/、`pnpm build` 真的重建了 lib/；
 *     ② 而 `gate(...)` 仍然指向**加载时那一份**（未被突变的）模块；
 *     ③ 断言"突变体必须让没改动也报出来" ⇒ 拿到 `true` ⇒ **红**。
 *
 * ★ 它的坏法是本队记账的那一种的**镜像**，而且第一次跑就露出来了：
 *   报告会读作"这次突变没能打红对应的臂 ⇒ 那条臂可能是恒真的"——
 *   而事实恰好相反：**突变从来没有被跑过**。一个"突变没生效但报告说生效了"
 *   的夹具，与一条恒真的断言一样，会把下一个人送到错误的方向上。
 *
 * ⇒ 突变体一律走 `freshGate()`：**带 cache-busting 的 query 重新 import**，
 *   读到的就是刚刚 build 出来的那一份。
 */
async function freshGate(tag) {
  const module = await import(`${BUILT_GATE}?${tag}`)
  return module.gate
}

test('★★ 夹具自检：`freshGate` 读到的确实是【当前磁盘上】的 lib，而不是加载时的旧绑定', async () => {
  /**
   * ★ 这条不测判据，测的是上面那条突变臂**赖以成立的前提**：突变臂全部经由
   *   `freshGate` 拿判据函数。把 `freshGate` 换成顶部那个 `gate` 绑定，
   *   两次突变都会变成"什么都没测"，而报告里它们会读作"突变没打红"。
   *
   * ★ 它做的是**一次真实的判别**，不是"断言 freshGate 是个函数"：
   *   同一个模块用两个不同的 query 各 import 一次 ⇒ 拿到的是两个**不同的模块实例**
   *   （而不是同一个被缓存的绑定）；同时断言它导出的 `id` / `point` 与文件顶部
   *   那个绑定读到的一致（说明 freshGate 指向的确实是**同一条**判据，不是碰巧
   *   存在的另一个文件）。
   */
  const a = await import(`${BUILT_GATE}?selfcheck=a`)
  const b = await import(`${BUILT_GATE}?selfcheck=b`)
  assert.notEqual(a, b, '★ 不同的 query 必须拿到不同的模块实例 —— 否则 cache-busting 没生效，突变臂会静默地测旧代码')
  assert.equal(a.id, id, '★ freshGate 读到的必须是同一条判据（id 一致），不是碰巧存在的另一个文件')
  assert.equal(a.point, point)
  assert.equal(typeof a.gate, 'function')
  assert.equal(typeof b.gate, 'function')
  /** ★ 顶部那个绑定也得是对的（基线与臂 1~3 走的都是它）。 */
  assert.equal(typeof gate, 'function')
  assert.equal(await freshGate('selfcheck=c').then((fn) => fn(ctx()).ok), false, '★ 而且它读到的那一份必须真的能裁决')
})

test('★ 定向突变：把「版本变了没」的比较改成【恒真】⇒ 臂 3（对照臂）必须红', async (t) => {
  /**
   * ★ 本仓的收口纪律是**串行**（`rm -rf lib/` 的窗口会让并行读到假红），所以这一条
   *   由环境变量显式开启，默认跳过，由本任务的验证读数那次单独运行。
   *
   * ★ 但"默认跳过"在这里**不是**把机制关掉：跳过的成因由环境变量显式表达，
   *   而运行它的那一次读数会记在任务的 output 里 —— 缺了那次读数，本臂不算数。
   */
  if (process.env.AGENT_TEAMS_CHECKPOINT_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_CHECKPOINT_MUTATION=1 时运行（见任务 output 里的读数）')
    return
  }

  const runAll = (fn) => ({
    moved: fn(ctx()).ok,
    unchanged: fn(ctx({ currentRevisions: { [DOC]: REV_A } })).ok,
    neverReviewed: fn(ctx({ reviewedRevisions: {} })).ok,
  })

  /** ★ 基线也走 `freshGate`：三种读数来自**同一个**模块实例上的**同一份**代码。 */
  const baselineGate = await freshGate('mutation=baseline')
  const baseline = runAll(baselineGate)
  assert.deepEqual(
    baseline,
    { moved: false, unchanged: true, neverReviewed: false },
    '★ 突变之前：动了要报、没动要放行、从没审过要报 —— 否则下面测的不是突变，是别的东西',
  )

  /**
   * ── 突变体 A：版本比较【恒真】（"一律算变过"）────────────────────────────────
   *
   * ★ `replaceAll` 之后**必须断言真的替换到了**：一次没匹配上的 `replace` 会让
   *   突变体与基线逐字相同，于是下面"变了"这件事变成恒假 —— 那是本队记账的
   *   第二种恒真写法（恒红）的镜像：**突变没生效，而报告说它生效了**。
   */
  const original = readFileSync(GATE_SOURCE, 'utf8')
  const mutatedAlwaysMoved = original.replaceAll(
    NEEDLE_COMPARE,
    `    if (false) unchanged.push(path) // MUTANT A: "unchanged" is unreachable`,
  )
  assert.notEqual(mutatedAlwaysMoved, original, '★ 突变必须真的改到那次比较 —— 没匹配上的替换会让这次突变恒不生效')

  await withBuiltGate(mutatedAlwaysMoved, async () => {
    /** ★ 走 `freshGate`：顶部那个绑定指向**加载时**那一份，突变体在它上面不可见。 */
    const mutated = runAll(await freshGate('mutation=always-moved'))
    /**
     * ★ 这一条断言就是**臂 3 的红**：在"一律算变过"的突变体上，臂 3 的输入
     *   （版本没变）**不再被放行** —— 而一个把对照臂写成"随便什么输入都返回 ok"
     *   的夹具在这里照样绿，所以下面还断言了 `moved` / `neverReviewed` 的读数。
     */
    assert.equal(mutated.unchanged, false, '★ 突变体必须让"没改动"也报出来 —— 臂 3 就是靠这一条变红的')
    assert.notDeepEqual(mutated, baseline, '★ 突变体与基线的裁决必须真的不同 —— 相同说明这次突变什么都没测到')
  })

  /**
   * ── 突变体 B：版本比较【恒假】（"一律算没变"）────────────────────────────────
   *
   * ★ 这一支比 A 更值得跑：它是**验收 ⑤ 的反面**（"拿不到版本 ≠ 没改动"的镜像，
   *   即"版本不等也当没改变"），而它的坏法正是本队记账的"把没测到并进通过"。
   */
  const mutatedAlwaysSame = original.replaceAll(
    NEEDLE_MOVED,
    `    else { /* MUTANT B: a changed revision is silently treated as unchanged */ }`,
  )
  assert.notEqual(mutatedAlwaysSame, original)

  await withBuiltGate(mutatedAlwaysSame, async () => {
    const mutated = runAll(await freshGate('mutation=always-same'))
    /** ★ 臂 1 的红：有未审改动却放行了。 */
    assert.equal(mutated.moved, true, '★ 突变体必须放行"有未审改动" —— 臂 1 就是靠这一条变红的')
    assert.equal(mutated.unchanged, true)
    /**
     * ★ 而 `neverReviewed` **仍是 false**：本次突变只拆掉"两个版本不等"那一半，
     *   "从没审过"那一半独立在另一支上 —— 于是这条断言同时也证明
     *   **两条半边各自独立**，不是一个布尔把两件事一起放行。
     *   （这正是本队记账的第四种恒真写法"守卫检查了另一个同名的东西"的反面：
     *     一个把两件事合成一个判断的实现，会让这一条断言在突变体上红。）
     */
    assert.equal(mutated.neverReviewed, false, '★ 另外半条半边不受影响（"从没审过"是独立的一支）')
    assert.notDeepEqual(mutated, baseline)
  })

  /**
   * ★ 还原之后逐字相等：一次中途失败会把一条被突变的判据留在盘上，那比突变本身坏得多。
   *   ★ 同样走 `freshGate`（一个新的 query ⇒ 一个新的模块实例）—— 用旧实例读到的
   *   是**突变体**，那样这条断言会在还原成功时反而变红，把一个好状态报成坏状态。
   */
  assert.deepEqual(
    runAll(await freshGate('mutation=restored')),
    baseline,
    '★ 还原之后必须与突变前逐字一致 —— 否则盘上留着一份没人认得的判据',
  )
})

test('★ 二次对照：两次突变的针脚在源码里【真的存在】（否则它们改的是一个不存在的字符串）', () => {
  /**
   * ★ 这条不测判据，测的是上面那两次突变**赖以成立的前提**。针脚写错一个字符，
   *   上面的突变就会静默变成"什么都没改"，而报告里它会读作"突变没打红 ⇒ 臂是恒真的"
   *   —— 一个**方向相反**的结论。
   *
   *   定向突变：把 checkpoint.ts 里那两行的空白改掉 ⇒ 本条红（且红得比上面那条早）。
   */
  const source = readFileSync(GATE_SOURCE, 'utf8')
  assert.equal(source.includes(NEEDLE_COMPARE), true, '★ 突变 A 的针脚必须逐字存在于 checkpoint.ts')
  assert.equal(source.includes(NEEDLE_MOVED), true, '★ 突变 B 的针脚必须逐字存在于 checkpoint.ts')
})

// ─────────────────────────────────────────────────────────────────────────────
// 装配形状：交给注册表时不会当场抛错（缺导出 / point 写错都是启动即炸）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 装配形状：这条判据交出装配层读的四个名字，且 point 是 admission', () => {
  /**
   * ★ 装配层读的是 `id / point / description / gate`（+ 可选 `appliesTo` / `requires`），
   *   而"少一个导出"不是"还没写完"，是**这里会当场抛错**（见 gates/index.ts 的
   *   `asRegistration`）。所以这里逐条点名，而不是依赖"import 成功了就算有"。
   */
  assert.equal(typeof id, 'string')
  assert.match(id, /^admission\./)
  assert.equal(point, 'admission', '★ 它判的是【准入】，不是契约合法性 —— 挂错位置会让两类缺陷同形')
  assert.equal(typeof gate, 'function')
  assert.equal(typeof appliesTo, 'function')
  assert.ok(Array.isArray(requires))
})
