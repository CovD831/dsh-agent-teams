/**
 * ── t22：契约"看着在、其实是空的"必须被拒 ────────────────────────────────────────
 *
 * ── ★★★ 它修的是什么（MEASURED，本轮真事）──────────────────────────────────────
 *
 * 本队的 **t1** 是经 `create({plan:{members,tasks}})`（staged-plan 简写）建的。
 * 那条路**结构上**只持久化 subject/description ⇒ 它的 objective / inScope /
 * acceptance / verify **全部缺席**，连 `kind` 都没有。
 *
 * 认领它的成员收到一份 payload，**每一个契约格都是空的**，而它**分不出**：
 *
 *     「这条任务不需要契约」      （合法：`work` 类按表就是不要求）
 *     「这条任务的契约丢了」      （缺陷：t1 就是这一条）
 *
 * 两者在载荷上**同形**。那位成员**正确地拒绝猜** —— 而"正确地拒绝"的代价是一次
 * 完整的派工往返。⇒ 一个不那么小心的成员会**编一个文件集合**出来：要么占掉
 * 别人的在飞工作，要么什么都不提交。
 *
 * ★ 这正是本队一直在修的那个形状：**一个读数看着在、其实是空的。**
 *
 * ── ★★★ 本文件的臂与它们各自防的坏法 ────────────────────────────────────────────
 *
 *   臂 1  ★ 正向：质量类任务的契约缺格 ⇒ **拒**，且**指名缺哪几格**
 *   臂 2  ★★ 反向（控制臂）：`work` 类**明确不要求** ⇒ **放行**，
 *          并**把"为什么不需要"说出来** —— 否则这条修法会变成"一律要求契约"
 *   臂 3  ★★★ 三态：`kind` 在场 ≠ `kind` 缺席 —— 第三态**不许**并进另外两个
 *   臂 4  ★★★ 前置臂（定向突变）：把判据拆掉 ⇒ 本臂**必须**红
 *   臂 5  ★★ 真入口：在**真的 edit_plan 工具**上复现"空契约任务进入可认领状态"
 *   臂 6  ★ 同源臂：判据不许在本文件里被**重写**一份
 *
 * ── ★ 为什么臂 5 必须在**真工具**上跑 ────────────────────────────────────────────
 *
 * 契约要求「The defect is reproduced at the real entry point」。而一个只在
 * 纯函数上测的夹具，测的是**判据**，不是**接线** —— 本仓反复记账的那条：
 * 判据写对了而它的输入面没接上，在断言层面与"没判据"同形。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { contractRequirement, WRITE_KINDS } from '../lib/tools/edit-plan.js'
import { isQualityKind } from '../lib/quality-gates.js'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = join(REPO_ROOT, 'src', 'tools', 'edit-plan.ts')

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★ 正向臂）：质量类任务的契约缺格 ⇒ 拒，且**指名缺哪几格**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1：质量类 kind 的契约缺格 ⇒ 拒绝，且**指名**缺的是哪几格', () => {
  /**
   * ★ 契约要求「The refusal names WHICH fields are missing」。
   *   ⇒ 断言的是**那几格的名字在场**，而不是"抛了一个错" ——
   *     一个只说"契约不完整"的拒绝会让下一个人去**猜**，
   *     而猜在这里的后果就是**编一个文件集合**（这正是 t1 那位成员拒绝做的事）。
   */
  const empty = contractRequirement('implementation', {})
  assert.deepEqual(
    empty.missing, ['objective', 'acceptance', 'inScope', 'verify'],
    `★ implementation 一并是"质量类"与"写类" ⇒ 四格都要求。实测：${JSON.stringify(empty.missing)}`,
  )
  assert.equal(empty.unknownKind, false, '★ kind 在场 ⇒ 不是第三态')

  /** ★ 而只填一部分 ⇒ 只报**还缺的那几格**（不是把四格全报一遍）。 */
  const partial = contractRequirement('implementation', {
    objective: 'do the thing', acceptance: ['it works'],
  })
  assert.deepEqual(
    partial.missing, ['inScope', 'verify'],
    `★ 已经填了的不许再报 —— 报满了会让读的人重填一遍已填的格。实测：${JSON.stringify(partial.missing)}`,
  )

  /** ★ 而**填空格**不算填（`'   '` 与缺席同形，本仓记过）。 */
  assert.deepEqual(
    contractRequirement('implementation', { objective: '   ', acceptance: [], inScope: [''], verify: [''] }).missing,
    ['objective', 'acceptance', 'inScope', 'verify'],
    '★★ 空白串与空白列表**不算填了** —— 否则"写了个空格"就能过这一关',
  )

  /** ★ 而 quality 与 write 两类**各自**的要求都要满足（`implementation` 是两者之交）。 */
  assert.ok(isQualityKind('implementation'), '★ 前置：implementation 是质量类')
  assert.ok(WRITE_KINDS.includes('implementation'), '★ 前置：implementation 也 是写类')

  /** ★ 只属于质量类的（review）：要 objective/acceptance，**不**要 inScope/verify。 */
  assert.deepEqual(
    contractRequirement('review', {}).missing, ['objective', 'acceptance'],
    '★ review 是质量类而非写类 ⇒ 只要求那两格（表里 has `review` 的 requiredGates 与 because 为证）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★★★ 控制臂）：`work` 类**明确不要求** ⇒ 放行 —— 修法不许变成"一律要求契约"
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 2（控制臂）：`work`/`requirements` 类**明确不要求**契约 ⇒ 必须放行（否则本修法就是"一律要求"）', () => {
  /**
   * ── ★ 为什么这一条是控制臂，以及它防的是什么 ────────────────────────────────────
   *
   * 契约原话：「A kind=work task that genuinely needs no contract still works and is
   * honestly represented -- the fix must not force every research task to carry an
   * acceptance list it does not need」。
   *
   * ★★ 而一个"一律要求契约"的实现会让臂 1**全绿**（它拒绝得更多）——
   *   和本队记过的那条同形（「正向臂只喂『该被拒』的输入，所以它测不出『一律拒绝』」）。
   *   ⇒ 唯一能把"真的在分类"与"一律要求"分开的，就是喂一条**该被放行**的任务。
   */
  /**
   * ── ★★★ 而"不要求契约"的 kind **只有 `work` 一个** —— 而这是量出来的，不是推的 ──
   *
   * MEASURED（本臂第一版在这里判错了，值得记下来）：我起初把 `requirements` 也算进
   * "不要求"，理由是 `kind-requirements.json` 里它的 `requiredGates` 是空数组。
   * ★ 而那**答的是另一个问题**：
   *     `kind-requirements.json` 说的是「完工时要**哪几条门**」；
   *     `validateCreateTask` 说的是「建任务时要**哪几格契约**」。
   *   两者是**两个轴** —— `requirements` 不要门（产出是散文），但它**要** objective+acceptance
   *   （没有那两格，那条任务连"要写什么需求"都没说清）。
   * ⇒ 实测（本臂读的就是真函数）：`validateCreateTask({kind})` 对
   *   requirements/review/verification/implementation/repair/integration **全部**
   *   报 "requires a non-empty objective"；**只有 `work` 报 OK**。
   *   （见 `isQualityKind` —— 它的定义恰是 `kind !== undefined && kind !== 'work' && …`。）
   */
  const requirement = contractRequirement('work', {})
  assert.deepEqual(
    requirement.required, [],
    '★★★ kind "work" 那一条 `because` 逐字：'
    + '"work is the kind whose contract deliberately does not require a verify list or an inScope at all"',
  )
  assert.deepEqual(requirement.missing, [], '★★ 于是"缺格"是**空的** ⇒ 放行，而不是拒绝')
  assert.equal(
    requirement.unknownKind, false,
    '★★★ 而它与第三态（kind 缺席）**不同形** —— 两者都给出空 required，'
    + ' 所以必须由 unknownKind 把它们分开，否则"明确不要求"与"判不了"会合流',
  )
  /** ★ 对照：其余六个 kind（含 `requirements`）都**要**契约 —— 证明"只有 work 不要求"。 */
  for (const kind of ['requirements', 'review', 'verification', 'implementation', 'repair', 'integration']) {
    assert.ok(
      contractRequirement(kind, {}).required.length > 0,
      `★★ kind "${kind}" 是质量类 ⇒ **要**契约（实测 validateCreateTask 对它报 "requires a non-empty objective"）`
    )
  }
  /** ★ 对照：同一个空对象，换个 kind 就要求了 ⇒ 证明这一格真的在读 kind。 */
  assert.deepEqual(contractRequirement('work', {}).required, [], '★ work 不要求')
  assert.notDeepEqual(
    contractRequirement('implementation', {}).required, [],
    '★ 而 implementation 要求 —— 同一个空输入，裁决**不同形**，这就是分辨力',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★★★ 三态臂）：`kind` 缺席 ⇒ **判不了**，不许并进另外两态
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 3（三态）：`kind` 缺席 ⇒ 判不了，**不许**被读成"不要求"或"要求"', () => {
  /**
   * ── ★ 这一格正是 t1 的真实形态 ────────────────────────────────────────────────
   *
   * MEASURED（真台账）：本队的 t1 **`kind` 是缺席的**（连同 objective/inScope/
   * acceptance/verify 一起缺席）。⇒ 那种任务不只是"契约空"，是**连它该不该有契约
   * 都判不了** —— 而那恰恰是认领它的成员读到的形状。
   *
   * ★★ 而它**不许**并进另外两态，两个方向都错：
   *   · 并进"不要求" ⇒ **每一条没声明 kind 的任务都合法**，于是缺陷隐身
   *     （`taskKindOf` 把缺席读成 `'work'` —— 那是**运行时**的容错缺省，
   *      而"没声明 kind"与"声明了 work"是两件事）
   *   · 并进"要求"     ⇒ 每一条 work 任务都被挡死
   */
  const unknown = contractRequirement(undefined, {})
  assert.equal(unknown.unknownKind, true, '★★ kind 缺席 ⇒ 第三态**必须**可读出来')
  assert.deepEqual(unknown.required, [], '★ 而它的 required 是空的 —— 正因为如此，它必须靠 unknownKind 辨认')
  assert.notDeepEqual(
    unknown, contractRequirement('work', {}),
    '★★★ "判不了"与"明确不要求"必须不同形 —— 两者 required/missing 都是空的，'
    + ' 所以区分它们的那一格（unknownKind）是**唯一**的判别面',
  )
  assert.equal(contractRequirement('work', {}).unknownKind, false, '★ 而 work 是"明确不要求"，不是"判不了"')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★★★ 定向突变臂）：把判据拆掉 ⇒ 本臂必须红
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 4（定向突变）：把"要求哪几格"抹平 ⇒ 臂 1 与臂 2 中**至少一条**必须红', () => {
  /**
   * ── ★ 为什么"有断言"与"断言在起作用"是两件事 ──────────────────────────────────
   *
   * 臂 1 断言"质量类缺格 ⇒ 拒"，臂 2 断言"work ⇒ 不拒"。而**一条恒拒绝的实现**
   * 会让臂 1 全绿（它拒得更多）⇒ 只有臂 2 会红。
   * ⇒ 所以这里**当场施加突变、当场跑、当场读回**，而不是声称"它会长红"
   *   （那是关于动作的猜想，本仓 §6 经验 F 记过）。
   *
   * ── 突变体：把 kind 的分支**抹掉**（一律要求四格）───────────────────────────────
   *
   * ★ 按**内容**定位，不按行号猜（本仓记过"夹具用 indexOf 应用变异体、打到别的行"）。
   */
  /**
   * ── ★★ 突变体的做法：**只复制那一个源文件**，其余靠软链 ───────────────────────
   *
   * ★ MEASURED（本臂第一版）：我 `cp -R node_modules`（1.6 GB）⇒ 磁盘被写满、
   *   `ENOSPC`。判据**不需要**那些依赖：本臂只读 `contractRequirement` 一个纯函数。
   * ★ 而 `src/` 也只有三个文件是它真正依赖的（types / quality-gates / edit-plan）。
   */
  /**
   * ── ★★★ 突变打在**构建产物**上（`lib/tools/edit-plan.js`）────────────────────────
   *
   * MEASURED（本臂前三版，值得记下来）：我先试着对**源码 `.ts`** 做突变 ——
   *   正则删 `import type` ⇒ `SyntaxError: Missing initializer in const declaration`
   *   （`readonly TaskKind[]` 的标注留下了）；删类型标注 ⇒ `Unexpected token 'export'`
   *   （TS 的 `interface` 不是 JS）；改用**真的 tsc** 编译那一个文件 ⇒ 因为
   *   `node:path` / `@deepseek-ai/*` 在临时树里解析不到而报 TS2307，且它**仍然**
   *   输出一份加载不了的 JS。
   *
   * ★★ 而"手搓一条把 TS 剥成 JS 的管线"本身就是一条**会腐烂的规则**：它只要在
   *   有人加一个类型语法时错一次，而那时红出来的是"突变体加载不了"——与
   *   "突变被逮住"在退出码上**同形**。本仓反复记账的正是这一条。
   *
   * ⇒ 所以突变打在**产物**上：`lib/` 是 `tsc` 已经编译好的**合法 JS**，
   *   改它不需要任何转译，而且它**就是运行时真正被加载的那一份**。
   */
  const libSource = join(REPO_ROOT, 'lib', 'tools', 'edit-plan.js')
  const built = readFileSync(libSource, 'utf8')
  /**
   * ★ 按**内容**定位突变点，不按行号猜（本仓记过"夹具用 indexOf 应用变异体、
   *   打到别的行 + 基线红"那四个坏读数）。找不到 ⇒ **当场红**，不静默跳过。
   */
  const qualityGuard = /if \(isQualityKind\(kind\)\)\s*\n\s*required\.push\('objective', 'acceptance'\);/u
  const writeGuard = /if \(WRITE_KINDS\.includes\(kind\)\)\s*\n\s*required\.push\('inScope', 'verify'\);/u
  assert.match(built, qualityGuard, '★ 突变臂前置：要在产物里找到决定"质量类要那两格"的那一句')
  assert.match(built, writeGuard, '★ 突变臂前置：要在产物里找到决定"写类要那两格"的那一句')

  /** ★ 突变体 = **把两个 kind 分支的条件去掉** ⇒ 一律要求四格（最小形态）。 */
  const mutated = built
    .replace(qualityGuard, "required.push('objective', 'acceptance');")
    .replace(writeGuard, "required.push('inScope', 'verify');")

  const dir = mkdtempSync(join(tmpdir(), 'empty-contract-mutant-'))
  try {
    /**
     * ★★ 用**复制**而不是软链：本仓 t3 那次实测过 —— 软链的文件会被 Node 解成
     *   realpath，于是**突变体在盘上而没有任何代码读它**（exit 0、读数与未突变逐字相同）。
     * ★ 只复制**那一棵树的一个文件**加它的两个依赖，其余靠软链目录（`node_modules`）。
     */
    /**
     * ★★ 复制**整棵 `lib/`**（3.3 MB 的 JS 产物，不是 1.6 GB 的 node_modules）——
     *   MEASURED：只复制那一个文件时，它 import 的 `./shared/entities.js` 找不到
     *   （`ERR_MODULE_NOT_FOUND`），而那个红**与"突变被逮住"同形**。
     * ★ 复制而不是软链：软链会被解成 realpath ⇒ 突变体在盘上而无人读它（t3 记过）。
     */
    cpSync(join(REPO_ROOT, 'lib'), join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'lib', 'tools', 'edit-plan.js'), mutated, 'utf8')
    /**
     * ★ 软链 `node_modules` **目录** —— 与上面那条不同形：这里被复制的是
     *   **被改的那一个模块**（真文件），软链只解决"去哪儿找第三方包"。
     */
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(dir, 'node_modules'))

    const runProbe = (entry, label) => {
      const probe = join(dir, `probe-${label}.mjs`)
      writeFileSync(probe, [
        `const m = await import('file://${entry.replace(/\\/gu, '/')}')`,
        `process.stdout.write(JSON.stringify(m.contractRequirement('work', {}).required))`,
        '',
      ].join('\n'), 'utf8')
      return spawnSync('node', [probe], { encoding: 'utf8', cwd: dir })
    }

    /**
     * ── 读数 ①（前置）：**未突变**时 "work ⇒ 不要求" 必须成立 ───────────────────────
     * ★ 缺了它，"突变后变红"可能只是因为探针本身坏了
     *   （本仓记过：同一个坏 harness，基线红）。
     */
    const control = runProbe(join(REPO_ROOT, 'lib', 'tools', 'edit-plan.js'), 'control')
    assert.equal(control.status, 0, `★ 前置：未突变的探针必须跑得起来。实测 stderr=${String(control.stderr).slice(0, 400)}`)
    assert.deepEqual(JSON.parse(control.stdout), [], '★ 前置：未突变时 work **不要求**任何格（这就是臂 2）')

    /**
     * ── 读数 ②（★ 交付读数）：突变体的读数是**被改坏的** ───────────────────────────
     * ★ 读的是**被加载的那一份的行为**，不是盘上的字面量 ——
     *   这正是为了抓住"变异体在盘上而无人读它"那个静默坏法。
     */
    const mutant = runProbe(join(dir, 'lib', 'tools', 'edit-plan.js'), 'mutant')
    assert.equal(mutant.status, 0, `★★ 突变体探针必须跑得起来。实测 stderr=${String(mutant.stderr).slice(0, 500)}`)
    assert.deepEqual(
      JSON.parse(mutant.stdout), ['objective', 'acceptance', 'inScope', 'verify'],
      '★★★ 定向突变：把 kind 的分类拆掉（一律要求四格）之后，`work` 的读数**必须**变成"要求四格" —— '
      + '若它仍是空的，说明探针读到的不是突变体（本仓 t3 记过那个静默坏法：'
      + '突变体在盘上而没有任何代码读它，读数与未突变**逐字相同**）',
    )
    /** ★ 对照对：同一个输入、两棵树 ⇒ 读数必须**不同形**。 */
    assert.notDeepEqual(
      JSON.parse(mutant.stdout), JSON.parse(control.stdout),
      '★★★ 对照对：唯一的自变量是那两格判据 ⇒ 读数必须不同 —— 否则本臂证明不了"分类在起作用"',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★★ 真入口臂）：在**真的** edit_plan 工具上复现缺陷，且证明修法接上了
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 5：在**真的 edit_plan 工具**上验证 —— 空契约任务不许带着"看起来有人打理过"的形状进入可认领状态', async () => {
  /**
   * ── ★ 契约要求「The defect is reproduced at the real entry point」──────────────
   *
   * ★★ 而"真入口"意味着**走真工具**：`agent_teams_edit_plan`，而不是直接调
   *   `contractRequirement`。本仓反复记账的形状：判据写对了而输入面没接上，
   *   在断言层面与"没有判据"同形 ⇒ 只有走真工具才能证明**接线**通了。
   */
  const { registerAgentTeamsTools } = await import('../lib/tools.js')
  const { createTeamDir } = await import('../lib/state.js')

  const workspace = mkdtempSync(join(tmpdir(), 'empty-contract-'))
  const stateRoot = join(workspace, '.agent-teams')
  const tools = new Map()
  const warnings = []
  const ctx = {
    logger: { debug() {}, info() {}, warn(m) { warnings.push(m) }, error(m) { warnings.push(m) } },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined }, list() { return [] },
      sendMessage: async () => 'msg-0', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { list: () => [], get() { return undefined } },
    llm: { async resolveCallConfig(config) { return config }, async listModels() { return [] } },
    on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, {
    stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined,
  })

  try {
    /** 一条**空契约但可认领**的任务 —— 这正是 t1 的形状（kind 缺席、四格缺席）。 */
    await createTeamDir(stateRoot, {
      id: 'team', name: 'T', captainSessionId: 'cap', createdAt: 1, taskSeq: 1,
      members: [{ id: 'm1', name: 'worker', status: 'working', joinedAt: 1 }],
      tasks: [{
        id: 't1', subject: 'a staged-plan task', status: 'pending', dependencies: [],
        attempt: 0, createdAt: 1, updatedAt: 1,
      }],
    })
    const captain = {
      id: 'cap', status: 'working', steer() {},
      session: { header: { cwd: workspace, id: 'sess-cap' }, events: [], ownEvents() { return [] } },
    }
    const call = (args) => tools.get('agent_teams_edit_plan').execute(args, { agent: captain, signal: new AbortController().signal })

    /**
     * ── ★★★ 那一格：`update_task` 试图"打理一下"这条空契约任务 ─────────────────────
     *
     * ★ 而这条任务 **kind 缺席** ⇒ `contractRequirement(undefined, …)` 落**第三态**。
     *   ⇒ 判据**不许**在这里装作判过：它既不要求（那会把每一条 work 任务挡死），
     *     也不放行成"明确不要求"（那会让缺陷隐身）。
     *   ⇒ 所以本臂断言的是**那一格读数被如实保留**（见下面两半）。
     */
    const before = JSON.parse(readFileSync(join(stateRoot, 'team', 'team.json'), 'utf8'))
    const target = before.tasks.find((t) => t.id === 't1')
    assert.equal(target.kind, undefined, '★★ 前置：这条任务的 kind **缺席** —— 这正是 t1 的真实形态')
    assert.equal(target.objective, undefined, '★★ 前置：而它的 objective 也缺席（"看着在、其实是空的"）')
    assert.equal(
      target.status, 'pending',
      '★★★ 缺陷的实物：这样一条任务**处在可认领状态**，而它连"该不该有契约"都判不了',
    )

    /**
     * ── ★★★ 那一格：`kind` 缺席 ⇒ 判据必须**说出"判不了"**，不许静默成 `work` ─────────
     *
     * MEASURED（本臂第一版**是恒真的**，值得记下来）：我起初写成
     * 「要么被拒、要么被放行」—— 而**两种行为都满足它** ⇒ 把判据整条删掉之后
     * 本臂**照样绿**。那正是验收里那句"an arm shows the pre-fix behaviour red"
     * 要防的东西：一条无论实现对错都通过的臂，与没有这条臂在观测上相同。
     *
     * ⇒ 现在它断言的是**一条有方向的判据**：
     *   一条 `kind` 缺席的任务**不许**被静默当成 `work`（那会让缺陷隐身），
     *   而**必须**留下"判不了"的读数。判据是机械的：
     *
     *     contractRequirement(undefined, …)  ⇒  unknownKind === true
     *
     * ★ 而在**真工具**上验证它：走一次 `update_task`，然后读那条任务，
     *   断言那一格仍然可判为第三态 —— 且**这条判据在修法被拆掉之后必须失效**。
     */
    const outcome = await call({
      operations: [{ action: 'update_task', task_id: 't1', assignee: 'worker' }],
    }).then(() => 'allowed', (error) => String(error.message))

    /** ★ 放行或被拒都可以 —— 但**必须**留下第三态的读数（下面两条断言把方向钉住）。 */
    const requirement = contractRequirement(target.kind, target)
    assert.equal(
      requirement.unknownKind, true,
      '★★★ 一条 `kind` 缺席的任务，其"该不该有契约"必须是**判不了**（第三态）。'
      + ' 若这里读到 false，说明判据把它当成了某个具体 kind（例如 `work`）—— '
      + '而那正是本任务要修的那个隐身：**"没声明 kind"与"声明了 work"在读数上合流**。'
      + ` 实测：${JSON.stringify(requirement)}`,
    )
    /**
     * ★★ 反向半边：**质量类**的缺格必须真的被拒 —— 这一条才是"修法接上了"的证据。
     *   做法：把同一条任务改成质量类（走真工具做不到，所以直接读判据并断言它有方向），
     *   并断言**放行只可能发生在第三态或"明确不要求"**，绝不发生在"质量类而缺格"上。
     */
    /**
     * ── ★★★ t22 修正：这条断言**曾经是恒真的**，现在改成**有方向的** ──────────────────
     *
     * MEASURED（t22 实测）：第一版写的是 `outcome === 'allowed' || requirement.missing.length > 0`。
     * ★ 而那条断言**无论实现对错都通过** —— 放行满足前半、拒绝满足后半。
     *   它与"没有这条断言"在观测上相同，而这正是验收里那句
     *   "an arm shows the pre-fix behaviour red" 要防的东西。
     *
     * ★★ 而实测同时暴露了**判据本身的缺口**：`kind` 缺席且四格全空时
     *   `contractRequirement` 交回 `missing: []` ⇒ 闸门不开火 ⇒ 那条任务
     *   **真的被放行**（修前实测 `outcome='allowed'`），而它随后仍可认领。
     *   ⇒ 于是本臂现在断言的是**那个缺陷被关上了**：
     */
    assert.notEqual(
      outcome, 'allowed',
      '★★★ 一条 `kind` 缺席、四格全空的任务**不许**被放行 —— 那正是本任务要修的 t1 缺陷：\n'
      + '   "判不了它需不需要契约" 与 "它的契约在途中丢了" 对认领的人是**同形**的。\n'
      + '   ★ 修前实测 outcome=allowed（缺陷在），修后必须是拒绝。',
    )
    /** ★ 而拒绝的措辞必须说清**它是第三态**，不是"质量类缺格"。 */
    assert.match(
      String(outcome), /no declared kind/,
      '★★ 拒绝必须指名根因是"**没声明 kind**"，而不是"某个 kind 缺了某几格" ——\n'
      + '   两者的补救动作相反：一个先去声明 kind，一个去补具体那几格。\n'
      + `   实测：${String(outcome).slice(0, 220)}`,
    )
    assert.match(
      String(outcome), /This is NOT "a task that needs no contract"/,
      '★ 而它必须**明确区分**"不需要契约"（work 类）与"判不了"（kind 缺席）—— 那是验收第 2/4 条',
    )
    /** ★★ 而这条臂的**可证伪性**由臂 4 的对照读数保证（同一份判据、突变体上换读数）。 */
    assert.deepEqual(
      contractRequirement('implementation', {}).missing,
      ['objective', 'acceptance', 'inScope', 'verify'],
      '★★★ 而**质量类**的缺格必须被指名 —— 这是"本修法真的在分类"的读数，'
      + ' 它必须与上面那条第三态**不同形**（一个 missing 非空、一个 unknownKind 真）',
    )
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6（★ 同源臂）：不许在本文件里**重写**一份 kind 规则
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 6：kind 规则**只有一份** —— edit-plan 借用 quality-gates 的谓词，不自己重写', () => {
  /**
   * ★ 本仓反复记账的形态：一个判据两处实现 ⇒ 第二处是第二个真相，
   *   而两份会随下一次改动分叉（分叉后"从哪个入口建的任务要求更松"在读数上同形）。
   *
   * ★ 判据：edit-plan.ts 必须**import** isQualityKind，而**不许**自己列出
   *   哪些 kind 是质量类（那会是一份硬编码的名单，且必然与 quality-gates 漂开）。
   */
  const source = readFileSync(SOURCE, 'utf8')
  assert.match(
    source, /import\s*\{[^}]*isQualityKind[^}]*\}\s*from\s*'\.\.\/quality-gates\.ts'/u,
    '★★ edit-plan 必须**借用** quality-gates 的 `isQualityKind` —— 那是"哪种 kind 要契约"的唯一来源',
  )
  /**
   * ★ 反向半边：**不许**在本文件里出现一份质量 kind 的硬编码名单
   *   （`'review'`/`'verification'`/… 被写进一个数组）。
   */
  const hardcoded = /\[\s*['"](?:requirements|verification|review|integration|implementation|repair)['"][^\]]*\]/u
  assert.doesNotMatch(
    source.split('export const WRITE_KINDS')[0] + source.split('export const WRITE_KINDS')[1].split('\n').slice(1).join('\n'),
    hardcoded,
    '★★ 除 `WRITE_KINDS`（它本身就是 quality-gates 里同一对概念的镜像）之外，'
    + '本文件不许再列一份 kind 名单 —— 两份名单会漂开',
  )
  /** ★ 而 `WRITE_KINDS` 必须与 quality-gates 的那一对**一致**（可核）。 */
  assert.deepEqual([...WRITE_KINDS], ['implementation', 'repair'], '★ WRITE_KINDS 与 quality-gates 的同一对')
})
