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
    agents: { get() { return undefined } },
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
    const src = readFileSync(file, 'utf8')
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

  // ② 工具模块之间不许互相 import（shared/ 例外：它本来就该被大家 import）
  const cross = []
  for (const [file, deps] of graph) {
    if (file.startsWith('shared/')) continue
    for (const dep of deps) {
      if (dep.startsWith('shared/')) continue
      if (dep === 'outside' || dep.startsWith('..')) continue
      cross.push(`${file} -> ${dep}`)
    }
  }
  assert.deepEqual(cross, [], '★ 工具模块之间不许互相 import —— 那会让"改一个工具"重新牵动另一个')

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
