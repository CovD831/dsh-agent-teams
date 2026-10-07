/**
 * ── 工具的 output schema 必须接受【自己真的会返回的】字段（t14）──────────────────
 *
 * 本夹具钉的不是某条判据的语义，也不是某个工具的字段对不对 —— 它钉的是**声明面与
 * 产出面一致**：一个工具 `output.schema` 里声明的东西，必须容得下它 `execute`
 * 真的会交出去的值；而它真的会交出去的值，必须**全部**被声明。
 *
 * ── 它防的是什么失效（MEASURED，本队同族形态第 9 次）──────────────────────────
 *
 * MEASURED（2026-10-06，captain 实调 `create_task` 时复现）：
 *
 *     15 个工具的 `output.schema` 全部是 `additionalProperties: false`，
 *     而 t3/t7 的调用点接线往**返回值**里加了四个诊断字段
 *     （`input_surface` / `runtime_gates` / `dispatch_input_surface` /
 *      `completion_input_surface`）——【声明它们的地方（schema）没跟上】。
 *
 *     ⇒ 加了字段的返回值通不过自己的 schema。宿主在 `createSuccessResult` 里抛：
 *
 *        ToolOutputError: "value.input_surface" is not a declared property
 *                         (additionalProperties: false)
 *
 *   ★ 与前八次同形：**改了产出，没改声明**。区别只在于这次的"声明"是一份
 *     JSON Schema，而不是一个白名单数组。
 *
 * ── 为什么它必须走【宿主的校验器】而不是自己写一遍判断 ──────────────────────────
 *
 * 宿主真的用的是 `validateJsonSchemaValue(tool.output.schema, value, 'value')`
 * （见 `@deepseek-ai/dsh-tools` 的 `createSuccessResult`）。夹具**调同一个函数** ——
 * 自己写一份"字段在不在 properties 里"的判断是**第二份真相**：
 * 它会与宿主的语义（`required` / `enum` / 嵌套 / 三态）慢慢分叉，而分叉之后
 * "夹具说通过了"与"宿主真的会接受"在断言层面不再同形。那正是本任务要消灭的形状。
 *
 * ── ★ 两条纪律（本队已记账的恒真写法）──────────────────────────────────────────
 *
 * ① **不许只断言"字段在 properties 里"**：那对 `required` / 类型 / 嵌套
 *    **一无所知** —— 一个 `input_surface: { type: 'string' }` 的声明能过那种断言，
 *    而它会把每一次真实返回炸掉。⇒ 本夹具一律**真值走一遍校验器**。
 * ② **不许拿"当前有几个工具"当不变量**：工具会增删（本文件从 12 写到 15 就是
 *    一次）。⇒ 工具清单**从注册表读**（真的 `registerAgentTeamsTools`），
 *    期望值由**产出面**推，不由夹具手抄。
 *
 * ── 臂 ───────────────────────────────────────────────────────────────────────
 *
 *   臂 1（对照臂）  ：每个工具用它**自己的**真实字段集走一次校验 ⇒ 必须通过
 *   臂 2（伪造臂）  ：把某个工具的诊断字段**单独**从 schema 拿掉 ⇒ 那一条必须红
 *   臂 3（反向臂）  ：工具**没有声明**的字段不许被它接受（防止用 `additionalProperties:
 *                     true` 把整件事糊过去 —— 那是同族的**另一种极端**）
 *   臂 4（产出面臂）：声明面必须**覆盖**真实的产出面（逐个工具核对）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'

import { registerAgentTeamsTools } from '../lib/tools.js'
// ★ t39：工具的源码面现在是 src/tools.ts + src/tools/**（见该模块的文件头）
import { toolsSource } from './tools-source.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * ── 把工具注册进一个**最小但够真**的 ctx ────────────────────────────────────────
 *
 * ★ 用真实的 `registerAgentTeamsTools`（与仓库里其它夹具同构）而不是手搓工具表：
 *   手搓的那份测的是夹具，不是产品代码 —— 它不会因为 `tools.ts` 里少声明一个字段
 *   而红。本夹具的全部价值就在于"读的是产品真的交出去的那份 schema"。
 */
function toolsUnderTest() {
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
  registerAgentTeamsTools(ctx, {
    stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined,
  })
  return tools
}

/** 一份形状合法的输入面读数（三态里的"有缺格"那一种：`incomplete > 0` 且带名单）。 */
function inputSurfaceSample() {
  return {
    checked: 2,
    incomplete: 1,
    skipped: 0,
    missing: ['[dispatch.changed-paths] declares 1 ctx path(s) that this context does not carry: worktreePath'],
  }
}

/** 一份形状合法的 runtime 裁决记录（`registry.evaluate` 的裁决 + `outcome`）。 */
function runtimeGatesSample() {
  return {
    ok: true,
    blockers: [],
    ran: [{ id: 'runtime.liveness', verdict: 'ok' }],
    outputs: {},
    evaluated: 1,
    skipped: 0,
    registered: 1,
    observed: { blockers: [], unmeasured: [] },
    outcome: 'ok',
    input_surface: inputSurfaceSample(),
  }
}

/**
 * ── ★ 每个工具**真实的**诊断字段产出面 ──────────────────────────────────────────
 *
 * 这张表是**从 `src/tools.ts` 的产出面读出来的**（谁在返回对象里挂了哪一格），
 * 不是从 schema 读的 —— 从 schema 读会让整个夹具变成恒真（"声明了什么就断言什么"，
 * 一个字段都不声明也照样绿，而那正是本任务要抓的形态）。
 *
 * ★ 值一律是**真实的形状**（结构化的读数对象），不是 `{}` 或字符串：一个把
 *   `input_surface` 声明成 `{ type: 'string' }` 的实现必须在这里红。
 */
const DIAGNOSTIC_FIELDS = {
  input_surface: inputSurfaceSample,
  runtime_gates: runtimeGatesSample,
  dispatch_input_surface: inputSurfaceSample,
  completion_input_surface: inputSurfaceSample,
}

/**
 * 工具 → 它会产出的诊断字段。**依据是 `src/tools.ts` 的返回语句**（见下每条注释）。
 *
 * ★ 这张表是夹具里唯一手写的东西，而它**必须**手写：它是"产出面"这个自变量本身。
 *   把它换成从 schema 推，就等于用被测物定义期望值。
 * ★ 它的正确性由臂 4 反向兜住：表里列了、而源码里其实没产出的字段 ⇒ 会红
 *   （"声明了一个它从来不返回的字段"与"没声明一个它真的返回的字段"是同一条错误的
 *   两个方向，本队两个都要防）。
 */
const EMITTERS = {
  // execute 的返回里挂了 contractGateSurface(input_surface) 与 contractRuntimeRecord(runtime_gates)
  agent_teams_create_task: ['input_surface', 'runtime_gates'],
  // 一次调用穿过两个位置 ⇒ 挂两格**位置名**；另有 runtimeGateRecord
  agent_teams_update_task: ['runtime_gates', 'dispatch_input_surface', 'completion_input_surface'],
  // 改契约那条路：amended.input_surface
  agent_teams_amend_task: ['input_surface'],
  /**
   * 快照：`runtime_gates` 在**顶层**（`runtimeRecord`）；而 `input_surface`
   * 挂在**嵌套的 `delivery` 里**（`delivery.input_surface`）—— 不是顶层。
   *
   * ★ MEASURED（t14，我第一版把这张表写错了）：表里写成顶层 `input_surface`
   *   ⇒ 臂 1 报"status 通不过自己的 schema"，而**真实原因是我的表指错了位置**，
   *   不是 schema 错了。这正是本队记账的「读错位置的出口」那一类 —— 只不过这次
   *   读错位置的是**夹具**。⇒ 修法是让这张表带上路径（见 `NESTED`），
   *   而不是把 schema 改宽去迁就一个错的自变量。
   */
  agent_teams_status: ['runtime_gates'],
  // 宣告交付：deliveryInputSurface(input_surface)
  agent_teams_declare_delivery: ['input_surface'],
}

/**
 * ── ★ 嵌套的出口：`{ 工具: [ {path, field} ] }` ─────────────────────────────────
 *
 * MEASURED（t14）：`agent_teams_status` 的 `input_surface` **不在顶层** ——
 * 它在 `delivery.input_surface`（"这次交付位置求值的输入面"挂在"这次交付裁决"的
 * 落点上，见 `execute` 里那段注释）。我第一版把 `EMITTERS` 写成顶层，
 * 于是臂 1 报了一个**假**失败：真正错的是夹具指错了位置，不是 schema。
 *
 * ★ 这正是本队记账的「读错位置的出口」那一类 —— 只不过这次读错位置的是夹具自己。
 *   ⇒ 修法是把**路径**登记清楚，而不是把 schema 改宽去迁就一个错的自变量。
 */
const NESTED_EMITTERS = {
  agent_teams_status: [{ path: ['delivery', 'input_surface'], field: 'input_surface' }],
}

/** 按 `path` 把一个诊断字段挂到（可能嵌套的）值上。 */
function attachNested(value, path, field) {
  const clone = { ...value }
  let cursor = clone
  for (const key of path.slice(0, -1)) {
    cursor[key] = { ...(cursor[key] ?? {}) }
    cursor = cursor[key]
  }
  cursor[path[path.length - 1]] = DIAGNOSTIC_FIELDS[field]()
  return clone
}

/** 为某个工具造一份"最少但合法"的返回值，并按需挂上诊断字段。 */
function valueFor(schema, fields) {
  const properties = schema.properties ?? {}
  const required = new Set([...(schema.required ?? [])])
  for (const [name, spec] of Object.entries(properties)) {
    if (spec?.required === true) required.add(name)
  }
  const value = {}
  for (const name of required) {
    const spec = properties[name] ?? {}
    value[name] = spec.type === 'number' ? 1
      : spec.type === 'boolean' ? true
        : spec.type === 'array' ? []
          : spec.type === 'object' ? {}
            : 'x'
  }
  for (const field of fields) value[field] = DIAGNOSTIC_FIELDS[field]()
  return value
}

/**
 * ── ★★ 产出面的【唯一真值来源】：`src/tools.ts` 的源码（t15）────────────────────
 *
 * MEASURED（2026-10-06，t15 开工时实测的现状）：
 *
 *   t14 的臂 1 遍历的是**手写的 `EMITTERS` 表（6 个条目）**，而注册表里有
 *   **15 个工具** ⇒ **10 个工具从未被直接校验**
 *   （create / edit_plan / approve / add_member / remove_member / reassign_task /
 *     claim_task / send_message / resume / delete）。
 *
 *   ★ 这正是本任务要防的那个形状**再次出现在夹具自己身上**：
 *     「声明落在实现后面」。t14 修好了产品代码里的那一份；
 *     t15 修的是**普查本身**那一份 —— 一份手写的表，就是一个会腐烂的声明面。
 *
 * ⇒ 现在**枚举来源是注册表**（全部工具），**期望值来源是源码**（每个工具自己的块）。
 *   手写的 `EMITTERS` 降级成一条**参考**：它的正确性由臂 4 与源码对账，
 *   而它**不再决定**普查的范围。
 */
const TOOLS_SOURCE = toolsSource()
/** ★ 剥注释：注释里大量讨论这些字段名（本文件与 `tools.ts` 自己都是证据）。 */
const TOOLS_CODE = TOOLS_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** 一个工具 `defineTool({...})` 的代码块（按大括号配平）。 */
function sourceBlockOf(name) {
  const m = new RegExp(`name: '${name}'`).exec(TOOLS_CODE)
  assert.ok(m !== null, `★ 源码里找不到工具 "${name}" —— 它被改名或删掉了，普查必须跟着看清新形状`)
  const start = TOOLS_CODE.lastIndexOf('defineTool({', m.index)
  assert.ok(start >= 0, `★ "${name}" 不在一个 defineTool(...) 里 —— 解析锚点失效`)
  let depth = 0
  for (let k = TOOLS_CODE.indexOf('{', start); k < TOOLS_CODE.length; k += 1) {
    if (TOOLS_CODE[k] === '{') depth += 1
    else if (TOOLS_CODE[k] === '}') {
      depth -= 1
      if (depth === 0) return TOOLS_CODE.slice(start, k)
    }
  }
  throw new Error(`★ "${name}" 的 defineTool 块括号不配平`)
}

/**
 * 产出语句的形状。★ 只认**字面量键名**。
 *
 * MEASURED（t14 臂 4 第一版）：规则里带了 `...InputSurface` 这种宽松形态，
 * 把 `dispatchInputSurface` 误当成 `input_surface` 的产出 ⇒ 报在错的地方。
 */
const EMIT_PATTERNS = {
  input_surface: /[{,]\s*input_surface\s*:/,
  runtime_gates: /[{,]\s*runtime_gates\s*:/,
  dispatch_input_surface: /[{,]\s*dispatch_input_surface\s*:/,
  completion_input_surface: /[{,]\s*completion_input_surface\s*:/,
}

/** 变量名 → 字段名（对象本身就是要挂上去的值，不带键名）。 */
const EMIT_VARIABLES = {
  input_surface: /\b(?:contractGateSurface|deliveryInputSurface|amended\.input_surface|amendContractSurface\b)/,
  runtime_gates: /\b(?:runtimeGateRecord|contractRuntimeRecord|runtimeRecord|runtimeInputSurface\b)/,
}

/** 这个工具**真的会产出**哪几格诊断字段（从它自己的源码块推）。 */
function emittedFieldsOf(name) {
  const block = sourceBlockOf(name)
  return Object.keys(EMIT_PATTERNS).filter(
    (field) => EMIT_PATTERNS[field].test(block) || (EMIT_VARIABLES[field]?.test(block) ?? false),
  )
}

/**
 * 这个工具产出某一格时，它挂**在哪儿**。
 *
 * ★ 只有 `agent_teams_status` 的 `input_surface` 是嵌套的（`delivery.input_surface`）——
 *   用一张**显式**的路径表记录，而不是靠正则去猜层级（猜层级需要 AST 级分析，
 *   而它带来的假阴性比它挡住的假阳性更贵）。
 * ★ 路径表漏登记会被**臂 1** 抓到：那时挂在顶层会被 schema 拒绝 ⇒ 红。
 */
const NESTED_PATHS = {
  agent_teams_status: { input_surface: ['delivery', 'input_surface'] },
}

/** 某个工具产出某一格时的落点（缺省顶层）。 */
function pathOf(name, field) {
  return NESTED_PATHS[name]?.[field] ?? [field]
}

/** 某个工具的**完整**返回值：它自己的基线值 + 它真的会产出的每一格。 */
function fullValueForAll(schema, name, fields = emittedFieldsOf(name)) {
  let value = valueFor(schema, [])
  for (const field of fields) {
    value = attachNested(value, pathOf(name, field), field)
  }
  return value
}

/** 走**宿主自己的**校验器（`createSuccessResult` 用的就是它）。 */
function violationsOf(schema, value) {
  return validateJsonSchemaValue(schema, value, 'value')
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（对照臂）：每个工具用它自己的真实字段集 ⇒ 必须通过
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 对照臂：每个工具带上它会返回的诊断字段 ⇒ 通过自己的 output schema', () => {
  /**
   * ★ 这一臂就是本任务验收的那条：**加了字段的返回值必须过得了自己的 schema**。
   *   基线（未修时）它红，且报错逐字是：
   *     "value.input_surface" is not a declared property (additionalProperties: false)
   */
  const tools = toolsUnderTest()
  assert.ok(tools.size > 0, '★ 注册表里必须真的有工具 —— 空集合上"每个都通过"是恒真的')

  /**
   * ── ★★ 枚举来源 = **注册表里的全部工具**（t15 的核心修法）──────────────────────
   *
   * t14 的这里写的是 `Object.entries(EMITTERS)` —— **手写表**。手写表就是一份
   * 会腐烂的声明面：新工具加进来、或者既有工具新增一格产出，**普查根本不会走到它**。
   * 而本队记账的第 9 次正是"声明落在实现后面"。
   *
   * ⇒ 现在遍历 `tools`（真的 `registerAgentTeamsTools` 注册出来的 15 个）。
   *   每一格的期望值由**它自己的源码块**推（`emittedFieldsOf`）——
   *   于是"新工具"与"新字段"都会**自动**进入普查，不需要有人来改这张表。
   */
  const failures = []
  for (const [name, tool] of tools) {
    const schema = tool.output?.schema
    assert.ok(schema !== undefined, `★ "${name}" 必须有 output schema —— 没有 schema 就没有"声明面"可言`)
    const expected = emittedFieldsOf(name)
    const violations = violationsOf(schema, fullValueForAll(schema, name, expected))
    if (violations.length > 0) {
      failures.push(`${name}${expected.length === 0 ? '' : ` (${expected.join(', ')})`}: ${violations.join('; ')}`)
    }
  }
  assert.deepEqual(
    failures, [],
    '★ 工具的返回值通不过自己的 output schema —— 加字段的调用点改了，而**声明它的地方（schema）**没跟上'
    + '（本队同族形态第 9 次）。宿主会在 createSuccessResult 里抛 ToolOutputError，'
    + '于是这个工具**每次调用都失败**：\n' + failures.join('\n'),
  )

  /**
   * ★ 反向半边（防恒真）：修复前这些字段一个都没被声明 —— 所以上面那条
   *   "没有违规"必须有内容。做法：把诊断字段从值里拿掉之后，**同一份 value**
   *   仍然必须合法（说明违规确实来自诊断字段，而不是"这份 value 本来就不合法"）。
   *   ⇒ 只断言"不违规"会与"这份值本来就是坏的"混淆，两半合起来才不恒真。
   */
  for (const [name, tool] of tools) {
    const schema = tool.output.schema
    const plain = valueFor(schema, [])
    assert.deepEqual(
      violationsOf(schema, plain), [],
      `★ "${name}" 的**基线值**（不含任何诊断字段）必须本身合法 —— 否则臂 1 报的"通过"可能来自一份坏值`,
    )
    /**
     * ★ 第二个反向半边：逐个字段**单独**挂上去也必须通过。一次挂多个时，
     *   一个"只声明了第一个"的实现可能蒙混过关（violations 只报第一个缺失的）。
     */
    for (const field of emittedFieldsOf(name)) {
      const single = attachNested(plain, pathOf(name, field), field)
      assert.deepEqual(
        violationsOf(schema, single), [],
        `★ "${name}" 单独挂 "${pathOf(name, field).join('.')}" 时被自己的 schema 拒绝 —— 多字段同时挂会掩盖它`,
      )
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1b（普查臂，t15）：普查必须【遍历全部工具】而不是列举几个
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1b ★ 普查臂：枚举来源是注册表，不是一张手写的表 —— 每个工具都被走到', () => {
  /**
   * ── ★★ 这一臂就是 t15 的验收本身 ──────────────────────────────────────────────
   *
   * MEASURED（2026-10-06，t15 开工时）：t14 的臂 1 遍历 `EMITTERS`（6 条），
   * 而注册表有 15 个工具 ⇒ **10 个从未被校验**。修好之后，这里要把那条差距
   * **钉成一条可执行的断言**，否则它会以同样的形状再长回来。
   *
   * ★ 三件事必须同时成立，缺一个就有盲区：
   *   ① 每个工具都**解析得出源码块**（枚举来源是注册表 ⇒ 新工具自动进入普查）；
   *   ② 每个工具都**走得过校验器**（臂 1 做的那件事，这里复述它的覆盖面）；
   *   ③ 源码里**真的**认得出产出面的机制（否则 `emittedFieldsOf` 恒返回空数组，
   *      ①② 都会在"没有期望值"的情况下静默变绿 —— 那就是恒真）。
   *
   * ★ ③ 是这一臂最容易被写漏的一半：一个"总是返回 []"的扫描器会让整条普查
   *   对**所有**工具都通过，而它看起来完全正常。
   */
  const tools = toolsUnderTest()
  const names = [...tools.keys()]
  assert.ok(names.length > 0, '★ 注册表里必须真的有工具')

  /** ① 每个工具都解析得出源码块 —— 枚举来源是注册表，不是手写表。 */
  const unparsable = names.filter((name) => {
    try { sourceBlockOf(name); return false } catch { return true }
  })
  assert.deepEqual(
    unparsable, [],
    '★ 这些工具在注册表里、而源码里解析不出它的块 —— 普查会漏掉它们：\n' + unparsable.join('\n'),
  )

  /**
   * ② 覆盖面的机械读数：**注册表里的每一个**都必须进入普查范围。
   *    ★ 这里不写"必须等于 15"：工具会增删（t14 的记录就是 12→15）。
   *      断言的是**集合相等**：普查范围 == 注册表全集。
   */
  const censused = names.filter((name) => {
    const schema = tools.get(name).output?.schema
    if (schema === undefined) return false
    violationsOf(schema, fullValueForAll(schema, name))
    return true
  })
  assert.deepEqual(
    [...censused].sort(), [...names].sort(),
    `★ 普查范围必须等于注册表全集（注册表 ${names.length} 个，普查 ${censused.length} 个）——`
    + '差额就是"声明落在实现后面"会藏身的地方',
  )

  /**
   * ③ 反向半边（防恒真）：扫描器必须**真的认得出产出面**。
   *
   * ★ 做法是**两个方向**都问一遍：
   *   · 至少有一个工具被认出产出 ≥1 格（否则扫描器恒空 ⇒ 上面两条都没测到东西）；
   *   · 且被认出的那些格，与 `src/tools.ts` 里**真实的**产出语句对得上。
   * 一条"恒返回空"的扫描器能过 ① 和 ②（那时每个工具都"没有期望值"⇒ 都通过），
   * 而它什么都测不到 —— 这正是本队记账的恒真写法。
   */
  const withFields = names.filter((name) => emittedFieldsOf(name).length > 0)
  assert.ok(
    withFields.length > 0,
    '★ 没有任何工具被认出产出诊断字段 ⇒ `emittedFieldsOf` 恒返回空数组，'
    + '上面两条断言都在"没有期望值"上恒真（规则二点名的形态）',
  )
  /**
   * ★ 双向对账：扫描器说这个工具产出某格 ⇔ 源码的产出面里真的有那一格的语句。
   *   这一条把"扫描器的口径"钉在上面那组 `EMIT_PATTERNS` / `EMIT_VARIABLES` 上，
   *   而它们本身由臂 4 与源码文本对账。
   */
  const scanned = names.flatMap((name) => emittedFieldsOf(name).map((field) => `${name}.${field}`))
  assert.ok(
    scanned.length >= 5,
    `★ 扫描器认出的产出面太少（实测 ${scanned.length} 格）—— 一个退化的扫描器会让普查静默失去分辨力`,
  )
  for (const entry of scanned) {
    const [name, field] = [entry.slice(0, entry.lastIndexOf('.')), entry.slice(entry.lastIndexOf('.') + 1)]
    const block = sourceBlockOf(name)
    assert.ok(
      EMIT_PATTERNS[field].test(block) || (EMIT_VARIABLES[field]?.test(block) ?? false),
      `★ 扫描器说 "${entry}" 有产出，而它自己的规则在源码块里匹配不到 —— 扫描器与规则分叉了`,
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（伪造臂）：把某个工具的字段**单独**从 schema 拿掉 ⇒ 那一条必须红
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 伪造臂：把某个工具的诊断字段单独从 schema 拿掉 ⇒ 臂 1 的检查必须红', () => {
  /**
   * ── ★ 这是"定向突变能打红"的可执行形式（本队纪律）────────────────────────────
   *
   * 本队要求每个 finding 的修复都能用**一次定向突变**打红它，而规则二后半句更狠：
   * 「把要保护的机制**单独**去掉，臂必须红；绿 ⇒ 它测的不是它声称的东西」。
   *
   * ★ 这里**不**真的去改 `src/tools.ts` 再重建（那会让本文件无法与其它夹具并行跑，
   *   而且"改源码"正是 `verify-input-requires` 臂 11 点名不许做的事）。
   *   做法是从**真实的 schema** 上精确删掉那一格 —— 那正是"声明面没跟上"的
   *   最小复现，也是那个缺陷当初的真实形状。
   */
  const tools = toolsUnderTest()

  const notCaught = []
  /**
   * ★ 枚举来源同样是**注册表**（与臂 1 一致，t15）：每个工具、它源码里认出的每一格。
   *   t14 这里用的是手写的 `EMITTERS`/`NESTED_EMITTERS` ⇒ 突变只覆盖那 6 条。
   *   ⇒ 现在覆盖**全部工具的全部已识别产出格**。
   */
  const targets = [...tools.keys()].flatMap((name) =>
    emittedFieldsOf(name).map((field) => ({ name, field, path: pathOf(name, field) })))
  assert.ok(
    targets.length >= 2,
    `★ 至少要有两格参与突变（实测 ${targets.length}）—— 一格的话，"红了"可能只是那个恰好坏了`,
  )

  for (const { name, field: dropped, path } of targets) {
    const schema = tools.get(name).output.schema
    let mutated
    /**
     * 精确删掉那一格 —— 与缺陷当初的形状逐字相同。
     * ★ 嵌套的字段要在**它所在的那一层**删（顶层删不到它，而"删了一个不存在的东西"
     *   会让突变静默跑过、被读成"这条臂是绿的"—— 本队记账的第三种恒定写法）。
     */
    if (path.length === 1) {
      assert.ok(
        schema.properties?.[dropped] !== undefined,
        `★ 突变目标 "${name}.${dropped}" 不在真实 schema 里 —— 一条指向不存在的属性的突变会"跑过"而什么都不改。`
        + `实际声明：${JSON.stringify(Object.keys(schema.properties ?? {}))}`,
      )
      mutated = {
        ...schema,
        properties: Object.fromEntries(Object.entries(schema.properties).filter(([key]) => key !== dropped)),
      }
    } else {
      const [parent, leaf] = [path[path.length - 2], path[path.length - 1]]
      const parentSchema = schema.properties?.[parent]
      assert.ok(
        parentSchema?.properties?.[leaf] !== undefined,
        `★ 突变目标 "${name}.${path.join('.')}" 不在真实 schema 里（父层声明：`
        + `${JSON.stringify(Object.keys(parentSchema?.properties ?? {}))}）`,
      )
      mutated = {
        ...schema,
        properties: {
          ...schema.properties,
          [parent]: {
            ...parentSchema,
            properties: Object.fromEntries(Object.entries(parentSchema.properties).filter(([key]) => key !== leaf)),
          },
        },
      }
    }
    const violations = violationsOf(mutated, fullValueForAll(schema, name))
    if (violations.length === 0) notCaught.push(`${name}.${path.join('.')}`)
  }
  assert.deepEqual(
    notCaught, [],
    '★ 把这些字段从 schema 里**单独**拿掉之后，返回值**照样通过** ⇒ 臂 1 测的不是它声称的东西'
    + '（规则二后半句）。这些字段的声明是装饰性的：\n' + notCaught.join('\n'),
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（反向臂）：没声明的字段不许被接受 —— 防止用"全开放"糊过去
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 反向臂：工具不许接受自己【没有声明】的诊断字段', () => {
  /**
   * ── ★ 这一臂钉的是同族缺陷的**另一种极端**（MEASURED：`agent_teams_status`）──
   *
   * 修这个缺陷时最容易走的一条歪路是：把 schema 改成
   * `additionalProperties: true`。那样臂 1 **立刻全绿**，而"字段加进去了"与
   * "字段被声明了"重新变成同形 —— 下一次加字段时，声明面依然不会跟上，
   * 只是这一次没有人会被炸出来。
   *
   * ★ 实测（t14）：`agent_teams_status` 修前**正是**这个形状
   *   （`additionalProperties: true, properties: {}`）—— 它在"被自己的 schema 拒绝"
   *   那条臂上**是绿的**，而它绿的原因不是声明对了，是它什么都没声明。
   *   ⇒ 一个只测"接受自己字段"的夹具会**放过**这个工具。
   */
  const tools = toolsUnderTest()
  const tooPermissive = []
  for (const [name, tool] of tools) {
    const schema = tool.output?.schema
    if (schema === undefined) continue
    if (schema.additionalProperties === true) {
      tooPermissive.push(`${name}: additionalProperties: true（声明面是空的，"加了字段"与"声明了字段"同形）`)
      continue
    }
    /**
     * 再问一次更难的：**未声明**的诊断字段必须被拒。
     * ★ 只对"并非产出面"的那些字段断言 —— 产出面里的字段本来就该被接受（臂 1）。
     * ★ 枚举来源同臂 1：**注册表**（t15）。原先读手写的 `EMITTERS` ⇒ 那 10 个
     *   未登记的工具在这里会被判成"一笔都没产出" ⇒ 四个字段全部要求被拒，
     *   读数看着严格、其实测的是"表里没有它"。
     */
    const declared = new Set(Object.keys(schema.properties ?? {}))
    const emits = new Set(emittedFieldsOf(name))
    for (const field of Object.keys(DIAGNOSTIC_FIELDS)) {
      if (declared.has(field) || emits.has(field)) continue
      const violations = violationsOf(schema, valueFor(schema, [field]))
      if (violations.length === 0) {
        tooPermissive.push(`${name}: 接受了它没有声明的 "${field}"`)
      }
    }
  }
  assert.deepEqual(
    tooPermissive, [],
    '★ 工具的 schema 把没声明的东西也放行了 —— 那样"字段加进去了"与"字段被声明了"在断言层面同形，'
    + '下一次加字段时声明面依然不会跟上（只是没人再被炸出来）。本队同族形态第 9 次就是这么发生的：\n'
    + tooPermissive.join('\n'),
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（产出面臂）：声明面必须**覆盖**真实的产出面
// ─────────────────────────────────────────────────────────────────────────────

test('臂 4 ★ 对账臂：手写的 EMITTERS 参考表必须与【源码产出面】一致（两个方向）', () => {
  /**
   * ── ★ t15 之后这一臂的角色变了，值得说清楚 ────────────────────────────────────
   *
   * t14 时 `EMITTERS` 是**普查的自变量**（臂 1 遍历它）—— 于是它既是"期望值"又是
   * "范围"，两个职责叠在一张手写表上。t15 把**范围**拿走了（改成遍历注册表），
   * 把**期望值**也拿走了（改成从每个工具自己的源码块推）。
   *
   * ⇒ 这张手写表现在只剩一个职责：**一份人可读的参考**（它把"哪个工具挂哪一格、
   *   为什么"写成人话，对读代码的人有用）。而参考也会腐烂 —— 所以本臂把它与
   *   **唯一真值来源**（源码扫描器）对账，两个方向都要空。
   *
   * ★ 两个方向各自防一件事（合并起来才是"表没错"）：
   *   · 表太**宽**：列了源码里其实不产出的格 ⇒ 会误导读它的人；
   *   · 表太**窄**：漏了源码里真产出的格 ⇒ 读它的人以为那一格没人管。
   * 两个方向都**不再**影响普查覆盖面（臂 1/1b 用注册表 + 源码），
   * 所以这里的红是"参考该更新了"，不是"产品坏了"。
   */
  const tools = toolsUnderTest()
  const names = [...tools.keys()]

  /** 参考表里的条目：顶层 + 嵌套，展平成 `{ name, field }`。 */
  const listed = [
    ...Object.entries(EMITTERS).flatMap(([name, fields]) => fields.map((field) => ({ name, field }))),
    ...Object.entries(NESTED_EMITTERS).flatMap(([name, entries]) => entries.map((entry) => ({ name, field: entry.field }))),
  ]
  assert.ok(listed.length > 0, '★ 参考表是空的 —— 那样下面两句"对得上"都是恒真的')

  const mismatches = []
  /** 方向 ①（表太宽）：表里列的每一格，源码产出面里必须真的有。 */
  for (const { name, field } of listed) {
    if (!names.includes(name)) {
      mismatches.push(`${name}: 参考表里列了它，而注册表里没有这个工具（工具被改名/删除了）`)
      continue
    }
    if (!emittedFieldsOf(name).includes(field)) {
      mismatches.push(`${name}: 参考表列了 "${field}"，而源码的产出面里找不到它（表太宽 ⇒ 读它的人被误导）`)
    }
  }
  /** 方向 ②（表太窄）：源码产出面里认出的每一格，参考表里必须登记。 */
  for (const name of names) {
    const listedFields = listed.filter((entry) => entry.name === name).map((entry) => entry.field)
    for (const field of emittedFieldsOf(name)) {
      if (!listedFields.includes(field)) {
        mismatches.push(`${name}: 源码产出面里有 "${field}"，而参考表没登记它（表太窄 ⇒ 读它的人以为这一格没人管）`)
      }
    }
  }
  assert.deepEqual(
    mismatches, [],
    '★ 手写的参考表与源码产出面不一致（两个方向都必须空）：\n' + mismatches.join('\n'),
  )

  /**
   * ★ 反向半边（防恒真）：扫描器认出的产出面必须**非空** ——
   *   一个把所有工具都解析成空块的扫描器会让上面两段"对得上"在空集合上成立，
   *   而它什么都没测到。这一半与臂 1b 的第 ③ 条是同一件事实的两个读法。
   */
  const covered = names.reduce((sum, name) => sum + emittedFieldsOf(name).length, 0)
  assert.ok(
    covered >= 4,
    `★ 全部工具被认出的产出面加起来至少要有 4 格（实测 ${covered}）—— 空集合上"都对得上"是恒真的`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 / 6（t35 / f-0017）：`delivery` 的"没能测量"必须有**自己的** schema 槽位
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 为什么这一节属于【本文件】──────────────────────────────────────────────────
 *
 * 本文件守的是「工具的输出 schema 必须接受它自己会返回的东西」。
 * 而 f-0017 的修法**正是**在这一层：`status` 的 `delivery` 对象拿到了一个新字段
 * `unmeasured`。★ 若只改产出、不改 schema，宿主会当场拒掉那一次返回 ——
 * 那正是本文件臂 1 存在的理由（t14 那一类，已经发生过一次）。
 *
 * ⇒ 所以这里钉两件**不同**的事，缺一不可：
 *   ① 产出面**确实**带上那一格（不是"schema 声明了、代码没产出"）
 *   ② 那一格**过得了** `additionalProperties: false` 的 schema（不是"产出了、schema 不认"）
 *
 * ★ 而它同时钉住 f-0017 的**要害**：`unmeasured` 不许再出现在 `blockers` 里。
 *   两半一起断言，是因为"两处都写"会让任何一个单独的半边都绿。
 */

/** 一个最小但够真的插件实例（与其它臂同形）。 */
async function statusFixture() {
  const { registerAgentTeamsTools } = await import('../lib/tools.js')
  const { createTeamDir } = await import('../lib/state.js')
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { execFileSync } = await import('node:child_process')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const ws = mkdtempSync(join(tmpdir(), 't35-delivery-'))
  const git = (args) => execFileSync('git', args, { cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q', '.'])
  writeFileSync(join(ws, 'a.ts'), 'a\n')
  git(['add', '-A'])
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])
  /**
   * ★ 关键：`members` 非空是刻意的 —— `delivery.convergence` 在**没有成员观察**时
   *   必报 unmeasured，于是这一格可以被真实地诱导出来（不是构造的）。
   */
  await createTeamDir(join(ws, '.agent-teams'), {
    phase: 'running', id: 'team', name: 'T', captainSessionId: 'cap', createdAt: 1, taskSeq: 0,
    members: [{ id: 'm1', name: 'w', status: 'working', joinedAt: 1 }], tasks: [],
  })

  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined }, list() { return [] },
      sendMessage: async () => 'msg-0', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { get() { return undefined } },
    on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined })
  const agent = { id: 'cap', status: 'idle', session: { header: { cwd: ws }, events: [] }, steer() {} }
  return { call: (name, args) => tools.get(name).execute(args, { agent, signal: new AbortController().signal }), tools }
}

test('★ 臂 5（t35 / f-0017）：`delivery` 的 unmeasured 有【自己的】字段，且不进 blockers', async () => {
  const { call, tools } = await statusFixture()
  const statusTool = tools.get('agent_teams_status')
  const result = await call('agent_teams_status', {})
  const delivery = result.delivery
  assert.notEqual(delivery, undefined, '★ 前置：delivery 必须在场')

  /**
   * ★ ① 产出面**确实**带那一格。
   *   本臂的 ctx（有成员、没有 goal 矩阵）会让 `delivery.convergence` 报 unmeasured
   *   ⇒ 那一格必须出现在返回值里。
   */
  assert.equal(
    Object.hasOwn(delivery, 'unmeasured'), true,
    `★ delivery 没有自己的 unmeasured 字段（实测字段：${Object.keys(delivery).join(', ')}）—— `
    + '"没能测量"只能挤进 blockers，于是它与"发现了问题"走同一出口',
  )
  assert.equal(typeof delivery.unmeasured, 'string')

  /**
   * ★★ ② 反向半边：那句"没能测量"**不许**同时出现在 blockers 里。
   *   缺了这一半，"两处都写"会蒙过去 —— 而那是**两份真相**（同一事实两个出口，会分叉）。
   */
  const leaked = (delivery.blockers ?? []).filter((line) => /could not measure/i.test(String(line)))
  assert.deepEqual(
    leaked, [],
    '★ "没能测量"被同时写进了 blockers：\n' + leaked.map((l) => `  · ${l}`).join('\n'),
  )

  /**
   * ★★★ ③ **过得了它自己的 schema** —— 这是本文件的看家本领，也是 f-0017 的修法
   *   必须同时改 schema 的理由（`delivery` 是 `additionalProperties: false`）。
   *   ★ 直接拿真实返回值去问宿主校验器，而不是"看一眼 schema 里有没有那个键"：
   *     后者在"声明了但拼错位置"时照样绿。
   */
  const schema = statusTool?.output ?? statusTool?.parameters?.output ?? statusTool?.outputSchema
  const surface = schema ?? (statusTool?.parameters ?? {}).output
  if (surface !== undefined) {
    const violations = violationsOf(surface, result)
    assert.deepEqual(
      violations, [],
      '★ status 的返回值过不了自己的 output schema（`delivery.unmeasured` 是不是没进 properties？）：\n'
      + violations.map((v) => `  · ${String(v)}`).join('\n'),
    )
  }
})

test('★ 臂 6（t35 的对照臂）：delivery 报 unmeasured 时，**它不是**一条"交付被拒的理由"', async () => {
  const { call } = await statusFixture()
  const result = await call('agent_teams_status', {})
  const delivery = result.delivery

  /**
   * ★ 本臂钉住 f-0017 的**代价**那一半：`blockers` 的原意是「测出来了、是坏的」。
   *   ⇒ 一个**只有** unmeasured 的场景里，`blockers` 里**不许**出现它的影子。
   *
   * ★ 而 status 是**报告**入口：它不许因为"没能测量"而拒绝（那是 f-0003 的形态 ——
   *   把"没能测量"当成一条拒绝理由）。⇒ 这次调用必须正常返回。
   */
  assert.equal(typeof result.team_id, 'string', '★ status 照常返回（报告入口不因"没能测量"拒绝）')
  const measurementInBlockers = (delivery.blockers ?? []).filter((line) => /could not measure/i.test(String(line)))
  assert.deepEqual(measurementInBlockers, [], '★ 那句"没能测量"不许出现在 blockers 里')

  /**
   * ★ 反向半边（缺了它，本臂在"什么都不报"的实现上照样绿）：那一格必须**说出来**。
   *   一次未能测量变成一片静默，与"测过了、没问题"在读者眼里同形。
   */
  assert.equal(
    Object.hasOwn(delivery, 'unmeasured'), true,
    '★ 调用点把那条 unmeasured 完全丢掉了 —— 那比读错更坏：静默与"测过了"同形',
  )
})
