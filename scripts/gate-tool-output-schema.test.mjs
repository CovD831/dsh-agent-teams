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

/** 某个工具的**完整**返回值：顶层字段 + 嵌套出口。 */
function fullValueFor(schema, name) {
  let value = valueFor(schema, EMITTERS[name] ?? [])
  for (const nested of NESTED_EMITTERS[name] ?? []) {
    value = attachNested(value, nested.path, nested.field)
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

  const failures = []
  for (const [name, fields] of Object.entries(EMITTERS)) {
    const tool = tools.get(name)
    assert.ok(tool !== undefined, `★ 工具 "${name}" 必须在注册表里（它被 EMITTERS 列为产出面之一）`)
    const schema = tool.output?.schema
    assert.ok(schema !== undefined, `★ "${name}" 必须有 output schema —— 没有 schema 就没有"声明面"可言`)
    const violations = violationsOf(schema, fullValueFor(schema, name))
    if (violations.length > 0) failures.push(`${name} (${fields.join(', ')}): ${violations.join('; ')}`)
  }
  assert.deepEqual(
    failures, [],
    '★ 工具的返回值通不过自己的 output schema —— 加字段的调用点改了，而**声明它的地方（schema）**没跟上'
    + '（本队同族形态第 9 次）。宿主会在 createSuccessResult 里抛 ToolOutputError，'
    + '于是这个工具**每次调用都失败**：\n' + failures.join('\n'),
  )

  /**
   * ★ 反向半边（防恒真）：**修复前**这些字段一个都没被声明 —— 所以上面那条
   *   "没有违规"必须有内容。做法：把诊断字段从值里拿掉之后，**同一份 value**
   *   仍然必须合法（说明违规确实来自诊断字段，而不是"这份 value 本来就不合法"）。
   *   ⇒ 只断言"不违规"会与"这份值本来就是坏的"混淆，两半合起来才不恒真。
   */
  for (const [name, fields] of Object.entries(EMITTERS)) {
    const schema = tools.get(name).output.schema
    const plain = valueFor(schema, [])
    assert.deepEqual(
      violationsOf(schema, plain), [],
      `★ "${name}" 的**基线值**（不含任何诊断字段）必须本身合法 —— 否则臂 1 报的"通过"可能来自一份坏值`,
    )
    /**
     * ★ 第二个反向半边：逐个字段**单独**挂上去也必须通过。一次挂多个时，
     *   一个"只声明了第一个"的实现可能蒙混过关（violations 只报第一个缺失的）。
     */
    for (const field of fields) {
      const single = { ...plain, [field]: DIAGNOSTIC_FIELDS[field]() }
      assert.deepEqual(
        violationsOf(schema, single), [],
        `★ "${name}" 单独挂顶层 "${field}" 时被自己的 schema 拒绝 —— 多字段同时挂会掩盖它`,
      )
    }
    for (const nested of NESTED_EMITTERS[name] ?? []) {
      const single = attachNested(plain, nested.path, nested.field)
      assert.deepEqual(
        violationsOf(schema, single), [],
        `★ "${name}" 单独挂嵌套 "${nested.path.join('.')}" 时被自己的 schema 拒绝`,
      )
    }
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
  assert.ok(
    Object.keys(EMITTERS).length >= 2,
    '★ 至少要有两个工具参与突变（一个的话，"红了"可能只是那个恰好坏了）',
  )

  const notCaught = []
  /** 顶层字段 + 嵌套字段一起做突变（两者都是"声明面没跟上"的真实形态）。 */
  const targets = [
    ...Object.entries(EMITTERS).flatMap(([name, fields]) => fields.map((field) => ({ name, field, nested: undefined }))),
    ...Object.entries(NESTED_EMITTERS).flatMap(([name, entries]) => entries.map((entry) => ({ name, field: entry.field, nested: entry.path }))),
  ]
  for (const { name, field: dropped, nested } of targets) {
    {
      const schema = tools.get(name).output.schema
      /**
       * 精确删掉那一格 —— 与缺陷当初的形状逐字相同。
       * ★ 嵌套的字段要在**它所在的那一层**删（顶层删不到它，而"删了一个不存在的东西"
       *   会让突变静默跑过、被读成"这条臂是绿的"—— 本队记账的第三种恒定写法）。
       */
      let mutated
      if (nested === undefined) {
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
        const [parent, leaf] = [nested[nested.length - 2], nested[nested.length - 1]]
        const parentSchema = schema.properties?.[parent]
        assert.ok(
          parentSchema?.properties?.[leaf] !== undefined,
          `★ 突变目标 "${name}.${nested.join('.')}" 不在真实 schema 里（父层声明：`
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
      const violations = violationsOf(mutated, fullValueFor(schema, name))
      if (violations.length === 0) notCaught.push(`${name}.${nested === undefined ? dropped : nested.join('.')}`)
    }
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
     */
    const declared = new Set(Object.keys(schema.properties ?? {}))
    const emits = new Set(EMITTERS[name] ?? [])
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

test('臂 4 ★ 产出面臂：EMITTERS 表与源码里真实的产出面对得上（两个方向都要）', () => {
  /**
   * ── 为什么这一臂必须从**源码**读，而不是从 schema 读 ────────────────────────────
   *
   * 臂 1 的自变量是 `EMITTERS`（"这个工具真的会产出哪些字段"）。它手写。
   * ⇒ 它太**宽**（列了一个源码里其实不产出的字段）会让臂 1 断言一个不存在的东西；
   *   太**窄**（漏了一个真的产出的字段）会让那个字段永远不被覆盖 ——
   *   而那正是本缺陷的成因本身（"有一个字段没人声明"）。
   *
   * ⇒ 两个方向都要机械核对，且核对的是**源码文本里的产出语句**。
   *
   * ★ 这是**文本级**的证据，不是语义级的 —— 它足够回答本臂的问题（"返回语句里
   *   有没有挂这一格"），而不必去执行 15 个工具的完整路径（那需要真实的团队状态、
   *   锁与调度器，代价远大于它回答的问题）。
   */
  const source = readFileSync(join(ROOT, 'src', 'tools.ts'), 'utf8')
  /**
   * ★ 剥注释：注释里大量讨论这些字段名（本文件自己就是证据），把它们算进来会让
   *   读数虚高，而虚高的读数会让真正漏接的那一处藏起来。
   */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  /** 每个工具 `defineTool({...})` 的代码块（按大括号配平，从 `name:` 往回找 `defineTool`）。 */
  function blockOf(name) {
    const m = new RegExp(`name: '${name}'`).exec(code)
    assert.ok(m !== null, `★ 源码里找不到工具 "${name}" —— 它被改名或删掉了，本臂必须跟着看清新形状`)
    const start = code.lastIndexOf('defineTool({', m.index)
    assert.ok(start >= 0, `★ "${name}" 不在一个 defineTool(...) 里 —— 夹具的解析锚点失效`)
    let depth = 0
    for (let k = code.indexOf('{', start); k < code.length; k += 1) {
      if (code[k] === '{') depth += 1
      else if (code[k] === '}') {
        depth -= 1
        if (depth === 0) return { block: code.slice(start, k), start, end: k }
      }
    }
    throw new Error(`★ "${name}" 的 defineTool 块括号不配平 —— 夹具必须看清它`)
  }

  /**
   * ★ 产出语句的形状：`{ …:<field> }` 的挂法（`...x === undefined ? {} : { input_surface: … }`）
   *   与 `x: { input_surface: … }` 的直接挂法都算。
   *
   * ★★ MEASURED（本臂第一版就栽在这里）：第一版的 `input_surface` 规则里带了
   *   一条 `\.\.\.[\w.]*(?:…|InputSurface|…)[\w]*[,\s]` —— 它把 `dispatchInputSurface`
   *   当成了 `input_surface` 的产出 ⇒ `update_task` 被误报成"产出泛用名"。
   *   而那个工具在**成功路径**上从不产出泛用名（只有两个位置名）。
   *   ⇒ 一条太松的正则会让本臂把"表太窄"喊在错的地方，而**真的**漏登记的那一格
   *     反而被噪音盖住。所以每条规则都**只认字面量键名**。
   */
  const EMIT_PATTERNS = {
    input_surface: /[{,]\s*input_surface\s*:/,
    runtime_gates: /[{,]\s*runtime_gates\s*:/,
    dispatch_input_surface: /[{,]\s*dispatch_input_surface\s*:/,
    completion_input_surface: /[{,]\s*completion_input_surface\s*:/,
  }

  /**
   * ★ 变量名 → 字段名的挂法（`...contractGateSurface === undefined ? {} : contractGateSurface`）。
   *   这一类**不带键名**（对象本身就是要挂上去的值），所以上面那组字面量规则看不见它。
   *   ⇒ 单独认：一个以这些名字结尾的变量被展开进返回值，等价于挂了对应字段。
   */
  const EMIT_VARIABLES = {
    input_surface: /\b(?:contractGateSurface|deliveryInputSurface|amended\.input_surface|amendContractSurface\b)/,
    runtime_gates: /\b(?:runtimeGateRecord|contractRuntimeRecord|runtimeRecord|runtimeInputSurface\b)/,
  }

  const mismatches = []
  const allRegistered = {
    ...Object.fromEntries(Object.entries(EMITTERS).map(([name, fields]) => [name, fields])),
    ...Object.fromEntries(Object.entries(NESTED_EMITTERS).map(([name, entries]) => [name, entries.map((entry) => entry.field)])),
  }
  for (const [name, declaredFields] of Object.entries(allRegistered)) {
    const { block } = blockOf(name)
    for (const field of declaredFields) {
      const emitted = EMIT_PATTERNS[field].test(block) || (EMIT_VARIABLES[field]?.test(block) ?? false)
      if (!emitted) {
        mismatches.push(`${name}: 登记了 "${field}"，而源码的产出面里找不到它（表太宽 ⇒ 臂 1 在断言一个不存在的东西）`)
      }
    }
  }

  /**
   * ★ 反向：源码里**真的挂了**这些字段的工具，必须出现在 EMITTERS 里。
   *   （缺了这一半，一个新加产出、却忘了登记的工具会静默地不被覆盖 ——
   *     而那正是本缺陷当初的形状。）
   */
  const toolNames = [...new Set([...code.matchAll(/name: '(agent_teams_\w+)'/g)].map((m) => m[1]))]
  assert.ok(toolNames.length > 0, '★ 一个工具都没解析出来 ⇒ 上面的锚点失效')
  for (const name of toolNames) {
    const { block } = blockOf(name)
    const emits = [
      ...Object.entries(EMIT_PATTERNS).filter(([, pattern]) => pattern.test(block)).map(([field]) => field),
      ...Object.entries(EMIT_VARIABLES).filter(([, pattern]) => pattern.test(block)).map(([field]) => field),
    ]
    /**
     * ★ 一个字段只要被**登记在案**即可 —— 无论登记在顶层（`EMITTERS`）还是
     *   嵌套（`NESTED_EMITTERS`）。本臂问的是"这个工具产出这一格了吗、有人管它吗"，
     *   而"它挂在哪一层"由 `NESTED_EMITTERS` 单独记录（臂 1 用它取正确的落点）。
     *
     * ★ 为什么本臂**不必**分辨层级：`-U0` 的块级扫描看得见"这个工具挂了
     *   `input_surface`"这个事实，却看不出它在返回对象的哪一层 —— 而要判断层级
     *   就得做 AST 级的分析，那与本臂回答的问题（"有没有漏登记"）不相称。
     *   ⇒ 层级由 `NESTED_EMITTERS` + 臂 1 的真实校验负责；
     *     本臂只保证**没有一格没人登记**。
     */
    const listed = [
      ...(EMITTERS[name] ?? []),
      ...(NESTED_EMITTERS[name] ?? []).map((entry) => entry.field),
    ]
    for (const field of emits) {
      if (!listed.includes(field)) {
        mismatches.push(`${name}: 源码产出面里有 "${field}"，而 EMITTERS/NESTED_EMITTERS 都没有登记它（表太窄 ⇒ 这个字段永远不被覆盖）`)
      }
    }
  }
  assert.deepEqual(
    mismatches, [],
    '★ `EMITTERS` 表与源码里真实的产出面不一致（两个方向都必须空）—— 这张表是臂 1 的自变量，'
    + '它错了，臂 1 就在测一个不存在的东西：\n' + mismatches.join('\n'),
  )

  /**
   * ★ 反向半边（防恒真）：解析出来的产出面必须**非空** ——
   *   一个把所有工具都解析成空块的实现会让上面两段全绿，而它什么都没测到。
   */
  const covered = Object.values(EMITTERS).flat().length
  assert.ok(covered >= 4, `★ 产出面加起来至少要覆盖 4 格（实测 ${covered}）—— 空集合上"都对得上"是恒真的`)
})
