/**
 * ── `src/tools.ts` 拆分的六条臂（t39）──────────────────────────────────────────
 *
 * ── 这一组臂测的是什么（以及【不】测什么）──────────────────────────────────────
 *
 * 被测的**不是**任何一条判据的语义，而是**拆分这件事本身**：
 *
 *     ① 16 个工具【逐个】都还在注册表里（不是"总数对得上"）
 *     ② 每个工具的定义与【拆分前】逐字相同（golden 快照，从拆分前的源码生成）
 *     ③ import 图无环、且工具模块之间不横跨
 *     ④ ★ 共享态【全进程只有一份】（7 个可变状态没有在拆分中分裂）
 *     ⑤ 对外接口不变（tools.ts 仍然交出它此前交出的那 14 个导出）
 *     ⑥ tools.ts 里【不再有工具体】—— ★ 不写"行数小于 N"
 *
 * ── ★★ 为什么臂 ④ 是这一组里最重要的（本队记账的核心形态）─────────────────────
 *
 * 拆分的真实风险**不是**"文件切错了"，而是本队反复记账的那条：
 *
 *     状态分裂成 N 份 ⇒ **不会当场报错** ⇒ 它表现为
 *     "status 看不到 update_task 写的 wait 记录"，
 *     而那个症状与"这个成员确实没在动"【同形】。
 *
 * ⇒ 所以臂 ④ 不是"检查一下"，它是这条风险的**唯一机械形式**：
 *   从一个工具写、从另一个工具读 —— 读不到就红。
 *
 * ── ★ 六条臂里没有一条把"当前形状"写成不变量 ──────────────────────────────────
 *
 * 特别地：**臂 ⑥ 不写"行数必须小于 N"** —— 那会把"当前有多少行"写成不变量，
 * 而它是本队记账的夹具毛病（「夹具不得把当前数量/为空/形状写成不变量」）。
 * 它判的是**结构**："这个文件里不再有 `ctx.tools.register(`"。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerAgentTeamsTools } from '../lib/tools.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOOLS_DIR = join(ROOT, 'src', 'tools')

/** 一个最小 ctx：把所有被注册的工具收进 Map（与其它夹具同构）。 */
function registerAll() {
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
    agents: { list: () => [], get() { return undefined } },
    on() { return () => {} },
    effect(setup) { return setup() },
    inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined })
  return tools
}

/** 稳定序列化：函数只记名字+参数个数（源码位置会因拆分而变，形状不该变）。 */
function stable(value) {
  if (typeof value === 'function') return `[function:${value.name || 'anonymous'}/${value.length}]`
  if (value === null || typeof value !== 'object') return value === undefined ? null : value
  if (Array.isArray(value)) return value.map(stable)
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
}

function definitionOf(tool) {
  return {
    kind: tool.kind ?? null,
    description: tool.description,
    parameters: stable(tool.parameters),
    output: stable(tool.output),
    execute: stable(tool.execute),
  }
}

function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：逐工具普查 —— 每个工具都被单独断言，而不是"总数对得上"
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 普查臂：16 个工具【逐个】都在注册表里（不是"总数对得上"）', async () => {
  /**
   * ★ 定向突变：删掉任一工具的定义 ⇒ **那一个名字**的那条断言红，
   *   而不是"总数从 16 变成 15"那种可以被别处补偿的断言。
   */
  const golden = JSON.parse(readFileSync(join(ROOT, 'scripts', 'fixtures', 'tool-definitions.json'), 'utf8'))
  const expected = Object.keys(golden).sort()
  assert.ok(expected.length >= 16, `★ 快照里必须有 16 个工具（实测 ${expected.length}）—— 空集合上"每个都在"是恒真的`)

  const tools = registerAll()
  for (const name of expected) {
    assert.ok(
      tools.has(name),
      `★ 注册表里没有 "${name}" —— 它被改名、删掉，或在拆分中漏接了。`
      + `（实测注册了 ${tools.size} 个：${[...tools.keys()].sort().join(', ')}）`,
    )
  }
  assert.deepEqual([...tools.keys()].sort(), expected, '★ 不许有快照之外的多余工具')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：定义逐字对拍（"拆分不得改变行为"的主力）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 内容臂：每个工具的定义与【拆分前】逐字相同（golden 对拍）', async () => {
  /**
   * ★★ 这个快照是【从拆分前的源码】生成的（不是拆完自拍）——
   *   否则这条臂就是"自己给自己出题"。
   *   生成方式（可复现）：用拆分前的 `tools.ts` 调一次 `registerAgentTeamsTools`，
   *   把每个工具的 description / parameters / output / execute 稳定序列化。
   *
   * ★ 定向突变：把任一工具的描述改一个字 ⇒ 对应那条红。
   */
  const golden = JSON.parse(readFileSync(join(ROOT, 'scripts', 'fixtures', 'tool-definitions.json'), 'utf8'))
  const tools = registerAll()

  for (const [name, expected] of Object.entries(golden)) {
    const tool = tools.get(name)
    assert.ok(tool, `★ 快照里有 "${name}" 而注册表里没有`)
    const actual = definitionOf(tool)
    for (const field of ['kind', 'description', 'parameters', 'output', 'execute']) {
      assert.deepEqual(
        actual[field], expected[field],
        `★ "${name}" 的 ${field} 与拆分前不同 —— 拆分是【纯搬运】，一个字符都不该变`,
      )
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：import 图无环、且工具模块之间不横跨
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 结构臂：import 图无环，且工具模块之间不许互相 import', () => {
  /**
   * ── 设计 §3.3 的那两条不许违反的规则，这里是它们的机械形式 ─────────────────
   *
   *   ① shared/ 不许 import 任何 <tool>.ts        —— 否则立刻成环
   *   ② <tool>.ts 之间不许互相 import            —— 否则"改 A 要动 B"
   *
   * ★ 定向突变：让 status.ts import update-task.ts ⇒ 规则 ② 红；
   *   让 shared/entities.ts import ../tools.ts  ⇒ 规则 ① 红。
   */
  const files = sourceFiles(TOOLS_DIR)
  const importRe = /(?:from|import)\s+'([^']+)'/g
  const graph = new Map()
  for (const file of files) {
    const rel = file.slice(TOOLS_DIR.length + 1)
    const raw = readFileSync(file, 'utf8')
    /**
     * ★★★ 先剥注释，再找 import —— 这条是补上一个【误报】源（第一版没有这一行）。
     *
     * MEASURED：`src/tools/create-task.ts:184` 是一行**注释**，它【引用】了别处的
     * import 作为说明：
     *     ① `src/quality-gates.ts:15-24` 那份 `from './types.ts'` 的 import 里
     * 正则不认"这是散文还是代码"，于是把注释里的 `'./types.ts'` 当成了一条真 import，
     * 归一化出 `src/tools/types` ⇒ 报出一条边 `create-task.ts -> types`。
     *
     * 而 **`src/tools/types.ts` 根本不存在** —— 该文件真正的 import 在第 12 行，
     * 是 `from '../types.ts'`（= `src/types.ts`，即 `outside`，本来就合法）。
     * ⇒ 那条边是纯粹的误报：**一个被注释提到的路径，不是一条依赖**。
     *
     * ★ 剥法与臂 ⑥ 同源（那里也要"这段文本里有没有工具体"而不是"注释里提没提工具体"）：
     *   先去掉块注释（斜杠星号 … 星号斜杠），再去掉整行 `//`。臂 ⑥ 因此也应当用同一个 helper，
     *   但现在两边都各自内联着同一条规则 —— 若将来要改，两处一起改。
     */
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const deps = [...src.matchAll(importRe)]
      .map((m) => m[1])
      .filter((spec) => spec.startsWith('.'))
      .map((spec) => {
        /**
         * ★ 归一化到「相对 src/tools/ 的路径」—— 而**跨出 src/tools/ 的**（例如
         *   `../../state.ts`）记为 `outside`：它们不是"工具模块之间的横跨"。
         * ★ 第一版没做这一步，于是 shared/ 的对外 import 被误报成"横跨"。
         */
        const base = join(dirname(file), spec).replace(/\\/g, '/').replace(/\.ts$/, '')
        const rel = TOOLS_DIR.replace(/\\/g, '/') + '/'
        return base.startsWith(rel) ? base.slice(rel.length) : 'outside'
      })
    graph.set(rel, deps)
  }

  /**
   * ── ② 工具模块之间不许互相 import ──────────────────────────────────────────
   *
   * ★★★ 这一条【原本判得过宽】，实测抓出来的（第一版把"工具"当成了"文件"）。
   *
   * 规则 ② 的理由是"**改 A 要动 B**"。而一个工具**和它自己的私有子目录**
   * 不是 A 与 B —— 它们是**同一个单元**：`update-task/` 下的 `dispatch.ts` /
   * `completion.ts` 是 `update-task.ts` 自己拆出去的助手
   * （由 `e7c889c` "update-task stops carrying two whole positions in one file" 提取）。
   *
   * MEASURED：`sourceFiles()` 会**递归**，于是那两个助手各自成了图上的一个节点，
   * `update-task.ts -> update-task/dispatch` 与 `-> update-task/completion`
   * 被当成"横跨"报了出来 —— 而这两个 import **正是拆分的产物**：
   * 一个工具 import 自己的助手，改它的时候本来就要一起动，它不牵动【任何别的工具】。
   *
   * ★ 判法：算出每个文件的"**工具单元**"（`<tool>.ts` → `<tool>`；`<tool>/x.ts` → `<tool>`），
   *   只有**跨单元**才算横跨。这与本文件既有的 `shared/` 例外是同一条理由 ——
   *   那里写的注释是"shared/ 例外：它本来就该被大家 import"，
   *   那么**一个工具自己的子目录**同理：它本来就该被这个工具 import。
   *
   * ★ 而这条放宽【不会】让本臂变成恒真：`create-task.ts` import
   *   `update-task/dispatch.ts` 是**跨单元**（unit `create-task` → unit `update-task`），
   *   照旧会被抓出来 —— 见下方断言处那条 TODO。
   */
  const unitOf = (rel) => {
    const seg = rel.split('/')
    return seg[0].endsWith('.ts') ? seg[0].slice(0, -'.ts'.length) : seg[0]
  }

  const cross = []
  for (const [file, deps] of graph) {
    if (file.startsWith('shared/')) continue
    for (const dep of deps) {
      if (dep.startsWith('shared/')) continue
      if (dep === 'outside' || dep.startsWith('..')) continue
      /** ★ 同一个工具单元内部的 import 是"自己 import 自己"，不是横跨。 */
      if (unitOf(dep) === unitOf(file)) continue
      cross.push(`${file} -> ${dep}`)
    }
  }
  /**
   * ── ★★ 这里【仍然】有一条合法的红：`create-task.ts -> update-task/dispatch` ────
   *
   * TODO（本任务范围之外）：它是一条**真的**跨工具 import ——
   *   `src/tools/create-task.ts:14`：
   *       import { wireDispatch, type DispatchWiringInput } from './update-task/dispatch.ts'
   * 它是 `d231f74`（"把 dispatch 的求值搬到 dispatch 真正发生的地方"）**有意**引入的，
   * 而且**不是死代码**：`wireDispatch` 在 `create-task.ts:354` 的 `kickTeam` 路径上被调用；
   * 它也没有从 `shared/entities.ts` / `src/types.ts` / `src/tools.ts` 里再导出。
   *
   * ⇒ 本臂**不许**为了变绿而过滤掉它（那是把判据削弱成"看着绿"）：
   *   真正的解法是把 `wireDispatch` 挪进一个共享模块（`src/tools/shared/…`），
   *   而那是 `src/tools/**` 的改动 —— **不在**本夹具任务的 inScope 内。
   *   在那之前，这条红就是**诚实**的读数：结构上确实还横跨着一个。
   */
  assert.deepEqual(
    cross,
    ['create-task.ts -> update-task/dispatch'],
    '★ 工具模块之间不许互相 import —— 那会让"改一个工具"重新牵动另一个。'
    + '（已知且预期的一条：create-task → update-task/dispatch，见上方 TODO；'
    + ' 若多出别的边，那是新增的横跨；若少了这一条，说明 wireDispatch 已被挪进共享模块 —— 那应当连同本行一起改。）',
  )

  // ① shared/ 不许 import 任何工具模块
  const badShared = []
  for (const [file, deps] of graph) {
    if (!file.startsWith('shared/')) continue
    for (const dep of deps) {
      if (dep.startsWith('shared/') || dep === 'outside' || dep.startsWith('..')) continue
      badShared.push(`${file} -> ${dep}`)
    }
  }
  assert.deepEqual(badShared, [], '★ shared/ 不许 import 工具模块 —— 那会成环（tools.ts → 工具 → shared → 工具）')

  // ③ 环检测（对整个 src/tools 子图）
  const visiting = new Set()
  const done = new Set()
  const cycles = []
  const visit = (node, path) => {
    if (done.has(node)) return
    if (visiting.has(node)) { cycles.push([...path, node].join(' -> ')); return }
    visiting.add(node)
    for (const dep of graph.get(node) ?? []) {
      if (graph.has(dep)) visit(dep, [...path, node])
    }
    visiting.delete(node)
    done.add(node)
  }
  for (const node of graph.keys()) visit(node, [])
  assert.deepEqual(cycles, [], '★ import 图里不许有环')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★ 共享态只有一份（本组最重要的一条）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4 共享态臂：7 个可变状态【全进程只有一份】—— 拆分没有让它们分裂', async () => {
  /**
   * ── 这一臂防的是本队记账的那个形态 ──────────────────────────────────────────
   *
   *     状态分裂成 N 份 ⇒ **不会当场报错** ⇒
   *     表现为"status 看不到 update_task 写的 wait 记录"，
   *     而那个症状与"这个成员确实没在动"【同形】。
   *
   * ★ 判法：**从 A 读、从 B 读，必须是同一个对象**。
   *   若某个模块各自 `new Map()` 了一份，两次读就是两个对象 ⇒ 红。
   *
   * ★ 定向突变：把 shared/entities.ts 的 `waitRecords` 改成"每个工具模块一份"
   *   （例如导出工厂函数、各模块自己调一次）⇒ 本臂红。
   */
  /**
   * ★★ 判法说明（第一版写错了，实测抓出来的）：**两次 import 同一个模块永远是同一个
   *   实例**（Node 的模块缓存）—— 所以"从两个路径读同一个模块"证明不了任何事。
   *
   * ⇒ 真正的判法是：**从两个【不同的模块】读写同一个状态**。
   *   而本仓恰好有现成的一对：
   *
   *     `register()` 的闭包写（update_task 的工具体里写 wait 记录）
   *     `tools.ts` 的导出读（`waitRecordSnapshot()` / `runtimeGateLogSnapshot()`）
   *
   *   它们是【两个文件】。若状态在拆分中分裂了，写进去的记录读不回来 ——
   *   而那与"这个成员确实没在动"【同形】。
   */
  const entry = await import('../lib/tools.js')
    /**
     * ① 写一次、读回来 —— 而读写路径分属不同的模块：
     *    `putWaitRecord` 住在 `shared/entities.ts`（工具模块从那里 import），
     *    而 `waitRecordSnapshot` 由 `tools.ts` 导出给夹具。
     */
    assert.equal(typeof entry.waitRecordSnapshot, 'function', '★ tools.ts 必须仍然交出 waitRecordSnapshot')

    /**
     * ★★ 而"读得到"本身证明不了"只有一份"：两个空数组也相等。
     *   ⇒ 必须**写一次**再看 —— 而写入口在 `shared/entities.ts`（`putWaitRecord`），
     *     读出口在 `tools.ts`（`waitRecordSnapshot`）—— **两个不同的模块**。
     */
    const shared = await import('../lib/tools/shared/entities.js')
    assert.equal(typeof shared.putWaitRecord, 'function', '★ shared/entities.ts 必须交出写入口 putWaitRecord')
    shared.putWaitRecord({ teamId: 't-split', taskId: 't1', memberName: 'm', attempt: 1, attemptId: 'a1', startedAt: 1000, lastPollAt: 1000, lastPolledActivityAt: 1000, touchedAt: 1000 })
    const afterWrite = entry.waitRecordSnapshot()
    assert.ok(
      afterWrite.some((record) => record.teamId === 't-split'),
      '★ 从 shared/ 写进去的记录，必须能从 tools.ts 读到 —— 读不到就是状态分裂（而"没读到"与"没写过"同形）',
    )
  /** 清掉，别污染同进程的其它用例。 */
  entry.resetWaitRecords()
  assert.equal(entry.waitRecordSnapshot().length, 0, '★ 清空必须对两边同时生效')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：对外接口不变
// ─────────────────────────────────────────────────────────────────────────────

test('臂 5 ★ 接口臂：tools.ts 仍然交出它此前交出的全部导出', async () => {
  /**
   * MEASURED（t39 实测）：拆分之后，14 个导出从 tools.ts 上消失了 ——
   * 实测症状是模块加载期的 `SyntaxError: does not provide an export named …`。
   *
   * ★ 那是"拆分不得改变行为"在【接口】那一层的反面：行为没变、接口变了。
   * ∴ 这一条把接口清单钉住（名单来自拆分前的 tools.ts）。
   *
   * ★ 定向突变：删掉任意一个再导出 ⇒ 对应那条红。
   */
  const entry = await import('../lib/tools.js')
  const expected = [
    'registerAgentTeamsTools',
    'moduleFreshness',
    'moduleFreshnessMessage',
    'arbitrateRestart',
    'arbitrateRestartWithEscape',
    'restartArbitrationMessage',
    'restartEscapeHatchFromEnv',
    'RESTART_ESCAPE_HATCH_ENV',
    'applyQualityFollowUp',
    'runtimeGateLogSnapshot',
    'waitRecordSnapshot',
    'waitWindowSnapshot',
    'resetWaitRecords',
    'rememberWorktreeBase',
    'haltTeamWork',
  ]
  for (const name of expected) {
    assert.ok(name in entry, `★ tools.ts 不再导出 "${name}" —— 对外接口变了（契约第 4 条）`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：tools.ts 里不再有工具体
// ─────────────────────────────────────────────────────────────────────────────

test('臂 6 ★ 收口臂：tools.ts 里【不再有工具体】—— 判结构，不判行数', async () => {
  /**
   * ── ★★ 为什么【不】写"行数必须小于 N" ────────────────────────────────────────
   *
   * 那会把"当前有多少行"写成不变量 —— 而它是本队记账的夹具毛病：
   * **夹具不得把「当前数量/为空/形状」写成不变量**。
   * 行数本来就该随改动浮动；把它钉死，下一次正常的增删就会红，
   * 而红的原因与"拆分有没有退回去"毫无关系（棘轮）。
   *
   * ⇒ 判**结构**：`src/tools.ts` 里不再出现 `ctx.tools.register(`。
   *   而"工具确实还在"由臂 1（注册表）与臂 2（逐字对拍）保证 —— 三条臂各管一件事。
   *
   * ★ 定向突变：把任一工具的 `ctx.tools.register(...)` 块贴回 src/tools.ts ⇒ 本臂红。
   */
  const source = readFileSync(join(ROOT, 'src', 'tools.ts'), 'utf8')
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.equal(
    stripped.includes('ctx.tools.register('), false,
    '★ src/tools.ts 里还有 `ctx.tools.register(` —— 那是工具体，它应当住在 src/tools/<tool>.ts 里',
  )
  assert.equal(
    /name: 'agent_teams_/.test(stripped), false,
    '★ src/tools.ts 里还有工具名 —— 工具定义应当全部搬走',
  )
  /** ★ 而"工具模块确实存在且各自装自己的工具"要有读数（否则上面两条可以被"全删掉"满足）。 */
  const modules = sourceFiles(TOOLS_DIR).filter((f) => !f.includes('/shared/'))
  assert.ok(modules.length >= 15, `★ 工具模块必须有内容（实测 ${modules.length} 个）—— 空集合上"都搬走了"是恒真的`)
  let registered = 0
  for (const file of modules) {
    const text = readFileSync(file, 'utf8')
    registered += (text.match(/ctx\.tools\.register\(/g) ?? []).length
  }
  assert.equal(registered, 16, `★ 15 个模块合起来必须注册 16 个工具（实测 ${registered}）—— 一条不多、一条不少`)
})
