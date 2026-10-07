/**
 * ── `dispatch.changed-paths` 的三臂夹具 ────────────────────────────────────────
 *
 * 契约要求每条判据自带三臂（`docs/GATE-REGISTRY.md` §6）：
 *
 *   臂 1（伪造臂）：成员自报的 changedPaths 【与其会话里真实发生过的写入对不上】
 *                   ⇒ 期望 blocked
 *   臂 2（未测量臂）：拿不到该成员的会话事件（没有 observation） ⇒ 期望 unmeasured
 *                     ★ 不是 ok —— 没能观察就不能声称它诚实
 *   臂 3（对照臂）：自报的与观察到的【一致】 ⇒ 期望 ok
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-05）：`changedPaths` 是**成员自己填的一串字符串**。上游只校验
 * 它的【形状】（是不是 workspace 相对、是否落在 inScope/outOfScope 内），从不校验
 * 它是否【对应任何真实发生过的写入】。
 *
 * ⇒ 一个成员可以零工作、自报一组漂亮的 inScope 路径，而判据层无从分辨。
 *   这与 `verify-rerun` 堵住的那个洞是【同源】的：把判据的输入交给被判的一方。
 *
 * ★ 为什么它不是 verify-rerun 的重复：verify-rerun 检查【命令真的跑了吗】，
 *   本判据检查【文件真的是这个成员动的吗】。一个成员可以真跑命令却虚报改动。
 *
 * ── 归属证据从哪来（★ 这是本判据的关键，也是它不需要 worktree 的原因）──────────
 *
 * `dsh-tool-fs` 给每次写入/编辑的 `tool/result` 挂 `meta.diffs: [{path, oldText, newText}]`
 * （已从 app.asar 抽出该包源码核实：`isFileDiff` 要求 `path: string`）。
 * 而这些事件可以由插件已有的 `sessionOwnEvents(memberAgent.session)` 读到。
 *
 * ⇒ 归因走【会话事件】，不走 cwd，所以绕开 START-HERE §5②「不能改 cwd」的限制。
 * ⇒ 判据本身仍是纯数据变换：调用方把观察结果传进来，判据不 import 任何 I/O。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gate, appliesTo, id, point, requires } from '../lib/gates/dispatch/changed-paths.js'

/**
 * 收窄助手。★ 它们把"这条断言期望哪一种裁决"写进断言本身，
 * 于是"我期望被拒"与"我期望未测量"在测试里也不同形（与 verify-rerun 的夹具同构）。
 */
function expectBlocked(v) {
  if (v.ok !== false || !('blockers' in v)) {
    throw new Error(`expected a blocked verdict, got ${JSON.stringify(v)}`)
  }
  return v.blockers
}
function expectUnmeasured(v) {
  if (v.ok !== false || !('unmeasured' in v)) {
    throw new Error(`expected an unmeasured verdict, got ${JSON.stringify(v)}`)
  }
  return v.unmeasured
}
function expectOk(v) {
  if (v.ok !== true) throw new Error(`expected an ok verdict, got ${JSON.stringify(v)}`)
  return v
}

/** 一个最小 context：任务契约 + 成员自报 + 观察到的真实写入（+ 工作区观察，t17）。 */
function ctx({ inScope = [], outOfScope = [], changedPaths, observed, hasObservation = true, gitObserved, observedWorkspaces }) {
  return {
    task: { id: 't1', kind: 'implementation', inScope, outOfScope },
    update: { changedPaths },
    observedChangedPaths: hasObservation ? (observed ?? []) : undefined,
    /**
     * ★ t17：第二观察面（工作区）。
     *   **不传** ⇒ 这一格缺席 ⇒ 判据退回**原口径**（只看会话事件）。
     *   要表达"读了工作区、它是干净的"必须**显式**传 `[]` —— 缺席与空数组
     *   在这条判据里从来不是同一件事（与 `observedChangedPaths` 同一纪律）。
     */
    ...gitObserved === undefined ? {} : { gitChangedPaths: gitObserved },
    /**
     * ★★ t59：**看了几棵树**（读数）。
     *
     *   ★ 而它与 `gitChangedPaths` 同一纪律：**不传 ⇒ 缺席**（不是 `1`）。
     *     从前那句话里的数字是 `?? 1` 兜出来的 —— 于是"没喂"与"喂了 1"
     *     在措辞上同形，而那条断言因此**从来没有真的测到过它声称的东西**。
     *     ⇒ 现在不传 ⇒ 那句话【不声称数字】（见 changed-paths.ts 的三支）。
     */
    ...observedWorkspaces === undefined ? {} : { observedWorkspaces },
  }
}

test('臂 1 ★ 伪造臂：自报改了一个从没被写过的文件 ⇒ 被拒，且指名那个文件', async () => {
  const verdict = await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts', 'src/b.ts'],
    // 真实只写过 src/a.ts
    observed: ['src/a.ts'],
  }))
  const blockers = expectBlocked(verdict)
  assert.equal(blockers.length, 1, '★ 只报真的对不上的那个，不连坐')
  assert.match(blockers[0], /src\/b\.ts/, '★ 必须指名是哪个文件')
  assert.match(blockers[0], /no write to it was ever observed/, '★ 必须说清是哪一类问题')
})

test('臂 1b ★ 伪造臂：零工作却自报一串漂亮的 inScope 路径 ⇒ 全报（不短路）', async () => {
  const verdict = await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts', 'src/b.ts'],
    observed: [],
  }))
  assert.equal(expectBlocked(verdict).length, 2, '★ 一次给全，而不是修一个又冒一个')
})

test('臂 1c ★ 伪造臂：真实写过但【没自报】⇒ 被拒（隐瞒改动与虚报改动同样危险）', async () => {
  const verdict = await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts'],
    observed: ['src/a.ts', 'src/secret.ts'],
  }))
  const blockers = expectBlocked(verdict)
  assert.equal(blockers.length, 1)
  assert.match(blockers[0], /src\/secret\.ts/)
  assert.match(blockers[0], /not reported/)
})

test('臂 2 ★ 未测量臂：拿不到该成员的会话事件 ⇒ unmeasured，不是 ok', async () => {
  const verdict = await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts'],
    hasObservation: false,
  }))
  const reason = expectUnmeasured(verdict)
  assert.match(reason, /could not be observed|no session events/i)
})

test('臂 3 ★ 对照臂：自报与观察一致 ⇒ ok（证明判据不误伤正常成员）', async () => {
  const verdict = await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts', 'src/b.ts'],
    observed: ['src/b.ts', 'src/a.ts'],
  }))
  expectOk(verdict)
})

test('臂 3b 对照臂：顺序不同不算不一致（集合语义，不是序列语义）', async () => {
  const verdict = await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts', 'src/b.ts'],
    observed: ['src/b.ts', 'src/a.ts'],
  }))
  expectOk(verdict)
})

test('臂 3c 对照臂：同路径重复出现 ⇒ 按集合去重后仍一致', async () => {
  const verdict = await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts', 'src/a.ts'],
    observed: ['src/a.ts'],
  }))
  expectOk(verdict)
})

test('appliesTo ★ 三个条件缺一不可', async () => {
  // 有变更声明 + 非终态 + 有观察 ⇒ 生效
  assert.equal(appliesTo({
    task: { id: 't1', kind: 'implementation' },
    update: { changedPaths: ['src/a.ts'] },
    observedChangedPaths: [],
  }), true)
  // 没声明 changedPaths ⇒ 不生效（没有可核对的东西）
  assert.equal(appliesTo({
    task: { id: 't1', kind: 'implementation' },
    update: {},
    observedChangedPaths: [],
  }), false)
})

test('判据元数据：id / point 与注册表的插入点一致', async () => {
  assert.equal(id, 'dispatch.changed-paths')
  assert.equal(point, 'dispatch')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 输入面（t6 的 B 层 + A 层）：声明与实测必须一致
// ─────────────────────────────────────────────────────────────────────────────
//
// 这一节有一条**独立的轴**：它不问"判据算得对不对"（上面几条已经问了），
// 它问「这条判据要的输入，是不是真的被接上了」—— 而那是上一轮五次同形缺陷
// 全部落在的那一格（inScope 缺席 → verify 缺席 → 执行器缺席 → event 名不匹配
// → 窗口表没接线），五次都不是判据写错。

test('★ 输入面声明：`requires` 与本判据的未测量臂【逐条对齐】', () => {
  /**
   * ── ★ 这条断言存在的原因：声明与未测量臂不一致就是【新的静默失效】─────────────
   *
   * 判据在某个输入缺席时说"我没能测量"，而 `requires` 里没有那一格 ⇒ 核对层
   * 永远不会报它缺 ⇒ 那次未测量在核对结果里是**看不见的**。于是"接线漏了一格"
   * 与"这条判据本来就只需要这些"同形 —— 正是本机制要消灭的东西。
   *
   * ⇒ 钉法：直接问 `gate()` 本人。把 `observedChangedPaths` 拿掉，判据必须
   *   说 unmeasured；而那个格必须出现在 requires 里。
   */
  assert.deepEqual([...requires], ['observedChangedPaths'], '★ 本判据要 ctx 的哪几格，只此一格')

  // 把声明的每一格逐一拿掉 ⇒ 判据必须「说不出话」（unmeasured），而不是 ok
  const full = {
    task: { id: 't1', kind: 'implementation', inScope: ['src/'] },
    update: { changedPaths: ['src/a.ts'] },
    observedChangedPaths: ['src/a.ts'],
  }
  assert.equal(gate(full).ok, true, '★ 前提：一格不缺时它是 ok —— 否则下面那条"拿掉一格"证明不了任何事')

  assert.equal(
    gate({ ...full, observedChangedPaths: undefined }).ok,
    false,
    '★ 声明的这一格缺席 ⇒ 判据必须说不出话；若它仍返回 ok，那这一格就不该进 requires',
  )
  assert.match(
    String(gate({ ...full, observedChangedPaths: undefined }).unmeasured),
    /could not be observed/,
    '★ 而且要是"未能观察"这一类，不是"发现问题"那一类',
  )

  /**
   * ★ 反向：**没**声明的格子被拿掉，判据【不许】改变形状。
   *   闸门那两格（task.kind / update.changedPaths）缺席时的正确行为是
   *   `appliesTo` 为假 ⇒ 这条判据根本不被求值 —— 那是"不适用"，不是"缺输入"。
   *   把它们也写进 requires 会把每一次 review 类派发都报成缺格（噪音）。
   */
  assert.equal(requires.includes('task.kind'), false, '★ 闸门格不进 requires：不适用不报')
  assert.equal(requires.includes('update.changedPaths'), false, '★ 同上')
})

test('★ 输入面接线：注册表里读得到声明（转发链上一格都不许漏）', async () => {
  /**
   * ── MEASURED（2026-10-06，本任务）：这条断言上一个版本是【红的】─────────────
   *
   * 判据文件声明了 `requires`、核对层也建好了，而 `asRegistration`（装配点）
   * 只转发 id/point/description/gate/appliesTo ⇒ `registry.list()` 里
   * **这一格不存在**，于是控制台读到的"没声明"与真的没声明同形。
   *
   * 这个缺陷的形状与前五次同形问题完全一样：**声明写对了、机制也建好了、
   * 而中间那个白名单没列它** —— 于是它静默地不生效。所以这一条不能只读
   * 判据模块的导出（那会绿），必须读【注册表】。
   */
  const { registry } = await import('../lib/gates/index.js')
  const listed = registry.list().dispatch.find((entry) => entry.id === id)
  assert.ok(listed, '★ 这条判据必须在 dispatch 位置的注册清单里')
  assert.equal(listed.hasRequires, true, '★ `hasRequires` 必须为真 —— 否则装配层又把声明吃掉了')
  assert.deepEqual(listed.requires, ['observedChangedPaths'], '★ 转发之后要逐字等于判据自己的声明')
})

test('★ A 层核对：适用而缺观察 ⇒ 核对【报出缺的是那一格】；不适用 ⇒ 不报', async () => {
  const { registry } = await import('../lib/gates/index.js')

  /**
   * ★ 只在 `dispatch.changed-paths` 自己那一格上断言，不去读同一位置上
   *   `dispatch.worktree` 的读数 —— 那条判据有自己的输入面（另一份写域），
   *   把它的结论混进来，会让本文件在别人改它的时候变红。
   */
  const mine = (evaluation) => evaluation.requires.checks.find((check) => check.id === id)

  // ① 声明了、观察也注入了 ⇒ ok（对照臂）
  const injected = await registry.evaluate('dispatch', {
    task: { id: 't1', kind: 'implementation', inScope: ['src/'] },
    update: { changedPaths: ['src/a.ts'] },
    observedChangedPaths: ['src/a.ts'],
  })
  assert.equal(mine(injected).status, 'ok', '★ 注入了观察 ⇒ 这一格要读成"在场"')
  assert.deepEqual(mine(injected).present, ['observedChangedPaths'])
  assert.deepEqual(mine(injected).missing, [])

  // ② 适用（kind+changedPaths 都在）但没有观察 ⇒ 核对必须【报出它缺】——这是 t3 的验收点
  const withoutObservation = await registry.evaluate('dispatch', {
    task: { id: 't1', kind: 'implementation', inScope: ['src/'] },
    update: { changedPaths: ['src/a.ts'] },
  })
  assert.equal(mine(withoutObservation).status, 'incomplete', '★ 输入面缺一格 ⇒ 核对必须报出来')
  assert.deepEqual(mine(withoutObservation).missing, ['observedChangedPaths'], '★ 而且要指名是【哪一格】')
  assert.match(
    withoutObservation.requires.missing.join('\n'),
    /observedChangedPaths/,
    '★ 人话清单里也要指名道姓',
  )

  // ③ 不适用（非 implementation/repair）⇒ 这一格缺席【不报】—— 不制造噪音
  const notApplicable = await registry.evaluate('dispatch', { task: { id: 't1', kind: 'review' }, update: {} })
  assert.equal(mine(notApplicable).status, 'skipped', '★ 不适用 ⇒ 没核对，且与"核对了、都齐"不同形')
  assert.equal(notApplicable.requires.incomplete, 0, '★ 不适用不许产出噪音')

  // ④ 观察到了、但确实没有写入（`[]`）⇒ 在场，不是缺格
  const observedNothing = await registry.evaluate('dispatch', {
    task: { id: 't1', kind: 'implementation' },
    update: { changedPaths: ['src/a.ts'] },
    observedChangedPaths: [],
  })
  assert.equal(
    mine(observedNothing).status,
    'ok',
    '★ `[]` = "看过了、确实没写"，与"没看过"必须不同形（判据自己用 blocked 区分这两件事）',
  )
  assert.equal(
    gate({ task: { id: 't1', kind: 'implementation' }, update: { changedPaths: ['src/a.ts'] }, observedChangedPaths: [] }).ok,
    false,
    '★ 而`[]` 下自报了一条虚构改动 ⇒ 判据必须拒绝它（"在场"不等于"通过"）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// t17：第二观察面（工作区）—— 「写入在别的 session」与「零工作却自报」必须不同形
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★ 这三臂防的是什么失效（MEASURED，三人独立复现，含 captain 本人）───────────
 *
 * `observedChangedPaths` 只看得见**本 session** 的写入，于是 `[]` 有两种成因，
 * 而它们在返回值上**逐字同形**：
 *
 *   (i)  写入发生在**另一个 session** —— captain 用 `cp` 并入、成员被 retire 后
 *        换人。改动**真实存在于工作区**，而本 session 一条写入都没有。
 *        ⇒ 诚实申报被读成"虚报" ⇒ **每一个被重派/并入的 attempt 都交不出终态**。
 *   (ii) **零工作却自报改动** —— 本判据存在的理由（曾经的 `{"ok": true}` 漏洞）。
 *
 * 三人各自撞上：point-dev（t14 收口）、admission-dev（t13）、captain（接管 t14）。
 * 填空数组又被 r5/mutation 拒（它们要一个可测范围）⇒ **两条判据各自都对，
 * 合起来没有任何合法输入**。
 *
 * ⇒ 修法：补一格"别处"的证据（工作区）。改动**真的存在**这件事与"是谁写的"无关。
 * ★ 而门**没有被拆**：一个路径必须**两个观察面都没有**才算虚报（见臂 3）。
 */

test('★ t17 臂 1（对照臂）：本 session 有真实写入 ⇒ ok（原有行为一字不变）', async () => {
  const v = await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts'],
    observed: ['src/a.ts'],
    gitObserved: ['src/a.ts'],
  }))
  const ok = expectOk(v)
  assert.deepEqual(ok.verifiedChangedPaths, ['src/a.ts'])
})

test('★ t17 臂 2（新能力臂）：写入在【别的 session】，而工作区里确实脏 ⇒ ok', async () => {
  /**
   * ★ 这一臂就是本任务存在的理由。修之前它与臂 3 的输出**逐字相同**。
   */
  const v = await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/tools.ts'],
    observed: [],
    gitObserved: ['src/tools.ts'],
  }))
  const ok = expectOk(v)
  /**
   * ★ 产出里必须带着那条路径 —— 它在**工作区面**被核对过，是"判据层亲眼看到的
   *   真实改动"。漏掉它会让记录少一条**已核实**的路径，而"少一条"与"没核对过"同形。
   */
  assert.deepEqual(
    ok.verifiedChangedPaths, ['src/tools.ts'],
    '★ 在别的 session 里写的路径，一旦被工作区面核实，就必须出现在 verifiedChangedPaths 里',
  )

  /**
   * ★ 与臂 1 的交出物**相等是刻意的**，不是缺陷：
   *   `verifiedChangedPaths` 回答的是「哪几条路径被核实了」，而不是
   *   「是哪一面核实的」。两条路都核实了同一条路径 ⇒ 交出同一份集合。
   *
   * ★ MEASURED（本臂第一版写错过）：我原先在这里断言 `notDeepEqual`，
   *   理由是"读的人要能分出是哪一面证实的" —— **那是我替判据发明的一个需求**。
   *   真正需要区分的两种情形（放行 vs 判虚报）由 `ok` 本身分开（臂 2 vs 臂 3），
   *   而"两条独立证据指向同一结论"恰恰应当收敛成同一个结论。
   *   ⇒ 把它写成不相等，等于要求判据把**证据来源**也编码进产出 ——
   *     那是另一种"两份真相"。
   */
  assert.deepEqual(
    await gate(ctx({ inScope: ['src/'], changedPaths: ['src/tools.ts'], observed: ['src/tools.ts'], gitObserved: ['src/tools.ts'] })),
    v,
    '★ 两条独立证据核实同一条路径 ⇒ 同一份产出（产出说的是"核实了什么"，不是"谁核实的"）',
  )
})

test('★ t17 臂 3（伪造臂，★ 门必须保住）：零工作却自报改动 ⇒ 仍然被拒', async () => {
  /**
   * ── ★★ 这一臂是硬约束：修法【不得】让"零真实工作 + 自报 changedPaths"变得可接受 ──
   *
   * 那道门的历史：上游只校验 changedPaths 的**形状**，从不校验它是否对应任何
   * 真实发生过的写入 ⇒ 一个成员可以零工作、自报一组漂亮的 inScope 路径，
   * 而判据层无从分辨 ⇒ `evaluateQualityCompletion` 返回 `{"ok": true}`。
   *
   * ★ 下面三个子情形逐条钉住它。**缺任何一个，这道门就有一个可以钻的角**：
   */
  /**
   * ① 两个观察面**都在场**、且都是空的（工作区也干净）⇒ 虚报。
   *    ★ 这是最完整的一格证据："你没写过，工作区也没有"。
   */
  const bothEmpty = expectBlocked(await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts', 'src/b.ts'],
    observed: [],
    gitObserved: [],
    /**
     * ★★ t59：**必须喂这个数** —— 而这条臂此前【从来没喂过】它 ──────────────────
     *
     * MEASURED（t59）：本臂断言了「说清看了几棵树」，而它从未给过 `observedWorkspaces`
     * ⇒ 那句话里的数字来自 `?? 1` 那个**兜底值**，而断言照样通过。
     * ★ 也就是说：**它断言的那个性质从来没有被真的测到过** ——
     *   它测的是"那句话里有一个数字"，而不是"那个数字是真的"。
     * ⇒ 现在喂一个**非 1** 的值：只有【真的读了这个数】的实现才说得对。
     */
    observedWorkspaces: 3,
  })))
  assert.equal(bothEmpty.length, 2, '★ 两条虚构路径都要报出来（不短路）')
  /**
   * ── ★★ 断言的是【意图】，不是那句旧措辞（t41 改口径）────────────────────────────
   *
   * 本行原先断言 `/not a changed path in the working tree either/` —— 而那句话
   * 在 t41 之后**必然要改**，理由是它当时是一句**假话**：
   *
   *   f-0023：成员在 worktree 里真的改了文件，而工作区面只看了**队长那棵树**，
   *   却断言"工作区里也没有"。⇒ 它替一个**没查过**的地方作了证。
   *
   * ★ 所以现在钉的是那一格证据的**意图**：说清"看了**几棵**树、而路径不在其中任何一棵里"。
   *   一个"看了 1 棵"与"看了 43 棵"都报同一句话的实现会在这里红
   *   —— 因为"任何"必须由**真实计数**支撑，而不是由措辞假装。
   */
  assert.match(
    bothEmpty[0],
    /not observed anywhere it could have happened/,
    '★ 措辞要说清：这条路径在【任何】它可能出现的地方都没被观察到',
  )
  assert.match(
    bothEmpty[0],
    /not in any of the 3 workspace\(s\) that were checked/,
    '★ 而且要说清【看了几棵树】，且那个数必须是【喂进去的那个】—— '
    + '写死 \d+ 的话，一个兜底成 1 的实现也能过（而那正是 t59 修的缺陷）',
  )
  /**
   * ★ 反向半边：那句旧措辞**不许**再出现 —— 它是 f-0023 里被成员读到的**假话**。
   */
  assert.doesNotMatch(
    bothEmpty[0],
    /not a changed path in the working tree either/,
    '★ 旧措辞断言了"工作区里也没有"，而它只查过一棵树 —— 那句话本身是 f-0023 的一部分',
  )

  /**
   * ② 工作区面**读不到**（`undefined`）⇒ 退回原口径，**仍然判虚报**。
   *    ★ 这是"没有新证据"不是"证据表明它诚实"—— 缺了这一格，
   *      一次 git 故障就能把这道门整个绕过去。
   */
  const gitUnreadable = expectBlocked(await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts'],
    observed: [],
    // gitObserved 不传 ⇒ 这一格缺席
  })))
  assert.match(
    gitUnreadable[0], /no write to it was ever observed in this member's session/,
    '★ 读不到工作区时退回原口径（不能借机放宽）',
  )
  assert.doesNotMatch(
    gitUnreadable[0], /working tree/,
    '★ 而措辞不许声称"工作区里也没有" —— 那一次我们根本没读到工作区（那是谎话）',
  )

  /**
   * ③ ★ 最容易漏的那一格（captain 点名）：重派场景下，reported 里**混着**
   *    "历史里有"与"历史里没有"的两条路径 ⇒ 前者放行、后者仍判虚报。
   *    ★ 它防的是"整批放行"：一个按调用整体放宽的实现会在这里红。
   */
  const mixed = expectBlocked(await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/tools.ts', 'src/ghost.ts'],
    observed: [],
    gitObserved: ['src/tools.ts'],
  })))
  assert.equal(mixed.length, 1, '★ 只许报那条两个面都没有的路径')
  assert.match(mixed[0], /src\/ghost\.ts/, '★ 指名的是【虚构的那一条】')
  assert.doesNotMatch(mixed[0], /src\/tools\.ts/, '★ 工作区里确实存在的那条不许被连带拒绝')

  /**
   * ④ 工作区面在场、报告里**漏报**了会话里真实写过的路径 ⇒ 仍然按"隐瞒"拒绝
   *    （与虚报对称的那一半，t17 没有改动它）。
   */
  const concealed = expectBlocked(await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/a.ts'],
    observed: ['src/a.ts', 'src/b.ts'],
    gitObserved: ['src/a.ts', 'src/b.ts'],
  })))
  assert.match(concealed[0], /was not reported/, '★ 隐瞒改动与虚报改动必须同样危险')
})

test('★ t17 臂 4（三态臂）：工作区面的缺席与空数组【不同形】', async () => {
  /**
   * ★ 与 `observedChangedPaths` 同一纪律：`undefined`（没能观察）与 `[]`
   *   （观察了、工作区是干净的）必须分得开。把前者当成后者，会让一次 git 故障
   *   被读成一个关于成员工作的结论。
   *
   * ★ 这一臂的可证伪形式：**同一份其余 ctx**，只改这一格 ⇒ 裁决的形状必须变。
   */
  const base = { inScope: ['src/'], changedPaths: ['src/a.ts'], observed: [] }
  const absent = await gate(ctx(base))
  const empty = await gate(ctx({ ...base, gitObserved: [] }))

  assert.equal(absent.ok, false)
  assert.equal(empty.ok, false)
  // 两者都被拒（都该拒），但**措辞不同形** —— 读日志的人要能看出用了几格证据。
  assert.notDeepEqual(
    expectBlocked(absent), expectBlocked(empty),
    '★ "读不到工作区"与"工作区是干净的"必须不同形 —— 否则一次 git 故障会伪装成一份关于成员的结论',
  )

  /**
   * ★ 反向半边（防恒真）：**同一份 ctx 跑两次**必须逐字相同 ——
   *   判据是纯数据变换，没有隐藏状态。缺了这一半，"不同形"可能只是随机。
   */
  assert.deepEqual(await gate(ctx(base)), absent, '★ 判据必须确定：同一份输入两次跑出逐字相同的裁决')
})

test('★ t17 臂 5（★ 诚实边界臂）：工作区面【不为归属作证】—— 这一格判据测不了什么', async () => {
  /**
   * ── ★★ 这条臂钉的是本修法**明知**留下的边界，而不是一个缺陷被我藏起来 ─────────
   *
   * 对抗性自审（我对自己刚写的修法做的）：如果一个**零工作**的成员报了一条
   * **恰好被别人改脏**的路径，工作区面会为它作证 ⇒ 放行。
   *
   * ★ 为什么接受它：
   *   · 本判据说到底只回答**"这条改动真的存在吗"**，它**不回答"是谁改的"**——
   *     `git status` 不知道作者（全队共用一个目录，START-HERE §5③ 已写明）。
   *     归属由**会话事件**那一格回答，两格合起来才完整。
   *   · 关键：一个零工作的成员**无法凭空造出一个脏文件**。要让那个路径变脏，
   *     他真的得动那个文件 —— 而"真的动过"本身就是工作的一点。
   *   · 而下游的 r5 / mutation / backtest 仍然要求**可测的真实范围**；
   *     本判据放宽的是"能不能申报"，不是"能不能通过"。
   *
   * ★★ 为什么必须有一条臂把它**写下来**：一个不被写明的边界，下一个人会以为
   *   它是漏洞并去"修"它 —— 而"修"它的方向（要求工作区面证明归属）在物理上
   *   做不到，只会让这道门重新变成恒红。把它钉成断言，是为了让**取舍**留痕。
   */
  const v = await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/other-task.ts'],
    observed: [],
    gitObserved: ['src/other-task.ts'],
  }))
  expectOk(v)

  /**
   * ★ 而这道门仍然拦得住【凭空捏造】的那一条 —— 两个面都没有 ⇒ 拒。
   *   缺了这一半，上面那条"接受"就变成了"什么都接受"（恒真）。
   */
  expectBlocked(await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/other-task.ts', 'src/invented.ts'],
    observed: [],
    gitObserved: ['src/other-task.ts'],
  })))
})

// ─────────────────────────────────────────────────────────────────────────────
// t41 / f-0023：观察面必须**看到成员真正干活的那棵树**
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★ 这一节修的是什么（今天拦了成员 4 次，含本任务作者本人）────────────────────
 *
 * `gitChangedPaths(workspace)` 的入参是**队长的**工作区。而被派发了 worktree 的成员
 * 在**自己的检出目录**里干活 —— 那是另一棵树：
 *
 *     /repo                                    ← 判据看的
 *     /repo/.agent-teams/worktrees/task-t41    ← 成员真正改的地方
 *
 * ⇒ 成员改了 worktree 里的文件、如实申报，两个观察面**都**看不到它：
 *
 *     observedChangedPaths  只看得见本 session 的写入（换过会话就没有）
 *     gitChangedPaths       问的是队长那棵树，那里确实没脏
 *
 * ⇒ 诚实的申报被判成虚报，而成员**拿不到任何合法输入**：
 *   填真实路径被本条拒、填空数组被 completion 门拒（r5/mutation 要范围）。
 *   ★ 两条判据各自都对，合起来没有任何合法输入（t32 实测的双向死锁）。
 *
 * ── 本节的臂用**真的 git 仓库**构造，不用替身 ────────────────────────────────────
 *
 * ★ 这是刻意的：本缺陷的要害正是"判据问错了**哪一棵树**"，而那只有在一个真实的
 *   目录布局上才可判定。用替身（手写一串路径喂给判据）会把"看哪棵树"这件事
 *   变成**由夹具自己假设**的东西 —— 那就测不到这个缺陷了。
 */

/** 造一个"主工作区 + 其下的一个成员 worktree"的真实布局。 */
async function realLayoutFixture() {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
  const { execFileSync } = await import('node:child_process')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const main = mkdtempSync(join(tmpdir(), 'f0023-main-'))
  const git = (cwd) => (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

  /** 主工作区：一个提交、干净。 */
  git(main)(['init', '-q', '.'])
  mkdirSync(join(main, 'src'), { recursive: true })
  writeFileSync(join(main, 'src', 'shared.ts'), 'base\n')
  git(main)(['add', '-A'])
  git(main)(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])

  /**
   * 成员 worktree：**独立的检出**（与真实布局一致 —— 它们不是 `git worktree add`
   * 的链接工作树，各自有自己的 `.git`，所以主库里 `git worktree list` 看不到它们）。
   */
  const worktree = join(main, '.agent-teams', 'worktrees', 'task-t41')
  mkdirSync(worktree, { recursive: true })
  git(worktree)(['init', '-q', '.'])
  mkdirSync(join(worktree, 'src'), { recursive: true })
  writeFileSync(join(worktree, 'src', 'member-only.ts'), 'base\n')
  git(worktree)(['add', '-A'])
  git(worktree)(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])

  /** ★ 成员在**自己的**树里改一个文件 —— 而主工作区那一份**不动**。 */
  writeFileSync(join(worktree, 'src', 'member-only.ts'), 'changed by the member\n')

  return { main, worktree }
}

test('★★ t41 臂 6（★ 诱导复现，f-0023 的核心）：只在 worktree 里改的文件 ⇒ 申报它【通过】', async () => {
  const { workspaceAndWorktreeChangedPaths } = await import('../lib/harness-compat.js')
  const { main, worktree } = await realLayoutFixture()

  /**
   * ★ 前置：确认这**确实是** f-0023 的那个布局 —— 文件在 worktree 里改了，
   *   而主工作区那一份没改。缺了这一句，下面的断言可能在一个别的布局上通过。
   */
  const mainDirty = (await import('../lib/harness-compat.js')).gitChangedPaths(main)
  assert.equal(
    mainDirty.includes('src/member-only.ts'), false,
    '★ 前置：主工作区里那一份【必须】是干净的（否则这测的不是 f-0023 的布局）',
  )

  /**
   * ★★ 关键断言：新的观察面**必须看得见** worktree 里的那一条。
   *
   * ★ 而在修之前它看不见 —— 于是判据把一次诚实的申报读成虚报。
   */
  const seen = workspaceAndWorktreeChangedPaths(main)
  assert.notEqual(seen, undefined, '★ 前置：主工作区是真实仓库 ⇒ 这一格必须有观察')
  assert.equal(
    seen.includes('src/member-only.ts'), true,
    `★ 观察面看不到 worktree 里的改动 —— 那正是 f-0023。实测看到的：${JSON.stringify(seen)}`,
  )

  /**
   * ★★ 而它必须让**判据放行**：把这一格喂给真实的 `gate`，申报那条路径。
   *   ★ 这一条是端到端的（不是"函数返回了对的东西"）—— 判据才是被修的那个东西。
   */
  const verdict = expectOk(await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/member-only.ts'],
    observed: [],
    gitObserved: seen,
  })))
  /**
   * ★★ 断言"那条路径**在**产出里"，而**不是**"产出恰好只有那一条"。
   *
   * MEASURED（本臂第一版，当场抓出来）：主工作区里那个装 worktree 的目录
   * （`.agent-teams/`）是 **untracked** 的 ⇒ `git status --porcelain` 把它报出来
   * ⇒ 并集里多一条 `.agent-teams/`，而 `verifiedChangedPaths` 是**两个观察面的并集**。
   *
   * ★ 那条多余路径**无害且正确**：它确实在主工作区里是脏的（一个新目录），
   *   而判据的判定用不到它（`fabricated` 只问"reported 的每一条**是否在**观察面里"，
   *   多出来的条目不影响任何一条 reported 的判定）。
   *
   * ★ 而把它断言成"恰好一条"会让这条臂**测一件与 f-0023 无关的事**：
   *   它会在任何让主工作区多出 untracked 文件的改动上变红 —— 包括**合法**的改动。
   *   ⇒ 那正是本队记过的"把当下快照写成不变量"。
   *
   * ★ 所以钉的是 f-0023 的**性质**：那条只在 worktree 里改过的路径，**必须**被核实。
   */
  assert.ok(
    verdict.verifiedChangedPaths.includes('src/member-only.ts'),
    `★ 在 worktree 里被核实的路径必须进 verifiedChangedPaths（一条**已核实**的改动）。实测：${JSON.stringify(verdict.verifiedChangedPaths)}`,
  )
  /** ★ 而那棵树确实还在原地（本臂没有把它挪走/删掉）。 */
  assert.notEqual(worktree, undefined)
})

test('★★★ t41 臂 7（★ 反向半边）：任何工作区里都没有的路径 ⇒ 必须【仍被拒】', async () => {
  const { workspaceAndWorktreeChangedPaths } = await import('../lib/harness-compat.js')
  const { main } = await realLayoutFixture()

  /**
   * ── 这一臂是**硬约束**：修法不许把判据退化成"什么都放行" ────────────────────────
   *
   * 扩大观察面很容易顺手放宽判定（"worktree 存在 ⇒ 就信你"）。而那会让
   * 「零真实工作 + 自报一组漂亮的路径」重新变得可接受 —— 本判据存在的**全部理由**。
   *
   * ★ 可执行形式：观察面**真的扩大了**（臂 6 已证它能看见 worktree），
   *   而一条**哪个树里都没有**的路径仍然被拒。两臂合起来才排除了"放宽"。
   */
  const seen = workspaceAndWorktreeChangedPaths(main)
  assert.notEqual(seen, undefined)

  const blockers = expectBlocked(await gate(ctx({
    inScope: ['src/'],
    changedPaths: ['src/invented-nowhere.ts'],
    observed: [],
    gitObserved: seen,
    /**
     * ★★ t59：同上 —— 这条臂也从未喂过计数，而它断言的正是"计数是真的"。
     *   ⇒ 喂一个非 1 的值，让它真的测到那件事。
     */
    observedWorkspaces: 4,
  })))
  assert.equal(blockers.length, 1)
  /**
   * ★ 而那句话必须说清**看过了几棵树** —— 不是"工作区里也没有"（那是一句只查过
   *   一棵树却断言一切的假话，f-0023 的原文）。
   */
  assert.match(blockers[0], /not observed anywhere it could have happened/)
  assert.match(
    blockers[0], /not in any of the 4 workspace\(s\) that were checked/,
    '★ 那个数必须是【喂进去的那个】（不是兜底值）',
  )
  assert.doesNotMatch(blockers[0], /not a changed path in the working tree either/)
})

test('★ t41 臂 8（三态不变）：主工作区读不到 ⇒ 整格 unmeasured，而不是"并集为空"', async () => {
  const { workspaceAndWorktreeChangedPaths } = await import('../lib/harness-compat.js')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  /**
   * ★ 与 `gitChangedPaths` 的**三态逐条对齐**（不另发明）：
   *   主工作区不是 git 仓库 ⇒ 这一格**没能观察** ⇒ `undefined`（不是 `[]`）。
   *
   * ★ 为什么这条重要：一个"读不到就当作空并集"的实现会把**一次 git 故障**
   *   读成"工作区是干净的" ⇒ 于是一个诚实的申报被判虚报。
   *   那是"把没测到并进结论"，正是本队那一条跨层纪律要防的。
   */
  const notARepo = mkdtempSync(join(tmpdir(), 'f0023-norepo-'))
  assert.equal(
    workspaceAndWorktreeChangedPaths(notARepo), undefined,
    '★ 不是 git 仓库 ⇒ 整格没能观察（`undefined`），绝不是空数组',
  )
})

test('★ t41 臂 9（对照臂）：没有 worktree 目录时，并集【等于】主工作区那一份', async () => {
  const { gitChangedPaths, workspaceAndWorktreeChangedPaths } = await import('../lib/harness-compat.js')
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
  const { execFileSync } = await import('node:child_process')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  /**
   * ★ 缺了这一半，"看见 worktree"可能顺手改变了**已有**的口径
   *   （例如把主工作区的路径也换成别的拼法）。⇒ 无 worktree 时两者必须**逐字相同**。
   */
  const main = mkdtempSync(join(tmpdir(), 'f0023-nowt-'))
  const git = (args) => execFileSync('git', args, { cwd: main, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q', '.'])
  mkdirSync(join(main, 'src'), { recursive: true })
  writeFileSync(join(main, 'src', 'a.ts'), 'x\n')
  git(['add', '-A'])
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])
  writeFileSync(join(main, 'src', 'a.ts'), 'y\n')

  assert.deepEqual(
    workspaceAndWorktreeChangedPaths(main), gitChangedPaths(main),
    '★ 没有成员 worktree 时，并集必须与原有的工作区面【逐字相同】—— 改动不许动到既有口径',
  )
})
