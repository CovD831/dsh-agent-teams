#!/usr/bin/env node
/**
 * ── golden 快照的【重新生成】路径 ──────────────────────────────────────────────
 *
 * ★ 为什么要有这个文件（2026-10-07，t42 上暴露）：
 *
 *   `scripts/fixtures/tool-definitions.json` 是 t39 创建的 —— 而它当时是
 *   **用一条一次性命令**生成的，`scripts/` 里【没有任何写它的代码】
 *   （grep writeFileSync 全仓 = 0）。
 *
 *   ⇒ 后果：那次以后，任何人想更新它都只能【手工改那一格】。
 *     而手工改一格与重新生成，在【当下】看起来一样（都得把那几格放进去），
 *     在【下一次】不同形：
 *       · 手工改   ⇒ 它变成一个需要人记得维护的【声明面】
 *       · 重新生成 ⇒ 它仍然是从活注册表【取来的】
 *
 *   ★ 而"一个只能在创建时正确的产物，会在下一次改动时变成一个障碍"——
 *     这正是本队反复记账的那条形态的一个长相。
 *
 * ★ 而它的原料本来就在（`scripts/gate-tool-split.test.mjs` 里有 registerAll /
 *   definitionOf / stable 三段）。本文件把它们反向用一次 —— 于是 golden
 *   与那条对拍臂【共用同一套序列化规则】，而"两边各写一份"的分叉由此消失。
 *
 * ★ 用法：
 *     node scripts/tool-definitions.mjs --write     # 重新生成
 *     node scripts/tool-definitions.mjs             # 只打印（干跑）
 *     node scripts/tool-definitions.mjs --check     # 与盘上比对，不等则 exit 1
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = join(ROOT, 'scripts', 'fixtures', 'tool-definitions.json')

/**
 * ★ 稳定序列化：函数只记 `[function:name/arity]`。
 *
 * MEASURED（写在 gate-tool-split.test.mjs 里，此处沿用同一条规则）：
 * **源码位置会因拆分而变，而形状不该变** —— 所以不能把函数体或它的位置写进快照。
 * 而这与"golden 要能分辨真变化"不冲突：签名变了（改名/改参数个数）它照样不同。
 */
const stable = (v) =>
  typeof v === 'function'
    ? `[function:${v.name || 'anonymous'}/${v.length}]`
    : v === undefined
      ? null
      : v === null || typeof v !== 'object'
        ? v
        : Array.isArray(v)
          ? v.map(stable)
          : Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]))

/** 与夹具同构的最小 ctx —— ★ 唯一来源：让注册真的发生，而不是造一份假的。 */
function minimalContext() {
  const tools = new Map()
  return {
    tools,
    ctx: {
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
      effect(scope) { return scope() },
      inject() { return () => {} },
    },
  }
}

/** 从【活注册表】取全部工具定义 —— 不是手抄，也不是从源码文本解析。 */
export async function toolDefinitions() {
  const { registerAgentTeamsTools } = await import(join(ROOT, 'lib', 'tools.js'))
  const { tools, ctx } = minimalContext()
  registerAgentTeamsTools(ctx, {
    stateDir: '.agent-teams',
    memberProvider: 'spawn',
    maxMembers: 8,
    profiles: {},
    fallback: undefined,
  })
  const definitionOf = (tool) => ({
    kind: tool.kind ?? null,
    description: tool.description,
    parameters: stable(tool.parameters),
    output: stable(tool.output),
    execute: stable(tool.execute),
  })
  return Object.fromEntries([...tools.keys()].sort().map((name) => [name, definitionOf(tools.get(name))]))
}

const serialize = (defs) => `${JSON.stringify(defs, null, 2)}\n`

async function main() {
  const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--check') ? 'check' : 'print'
  const defs = await toolDefinitions()
  const text = serialize(defs)

  if (mode === 'print') {
    process.stdout.write(text)
    return
  }

  if (mode === 'check') {
    let onDisk
    try {
      onDisk = readFileSync(TARGET, 'utf8')
    } catch {
      console.error(`tool-definitions: ${TARGET} 读不到 —— 先跑 --write`)
      process.exit(1)
    }
    if (onDisk !== text) {
      /**
       * ★ 失败时【说得出是哪一格不同】—— 否则"快照过期"与"有人改坏了"
       *   在读的人眼里是同一个形状。而那正是本队记账最久的那条界线。
       */
      const before = JSON.parse(onDisk)
      const changed = Object.keys(defs).filter(
        (name) => JSON.stringify(before[name]) !== JSON.stringify(defs[name]),
      )
      const added = Object.keys(defs).filter((name) => before[name] === undefined)
      const removed = Object.keys(before).filter((name) => defs[name] === undefined)
      console.error('tool-definitions: 快照与活注册表不一致')
      if (added.length) console.error(`  ★ 新增工具：${added.join(', ')}`)
      if (removed.length) console.error(`  ★ 消失工具：${removed.join(', ')}`)
      if (changed.length) console.error(`  ★ 定义变了：${changed.join(', ')}`)
      console.error('  ⇒ 若这是【有意的】定义变更，跑 --write 重新生成；否则那是回归。')
      process.exit(1)
    }
    console.log(`tool-definitions: ${Object.keys(defs).length} 个工具，与活注册表一致`)
    return
  }

  writeFileSync(TARGET, text)
  console.log(`tool-definitions: 已重新生成 ${Object.keys(defs).length} 个工具 ⇒ ${TARGET}`)
}

main().catch((error) => {
  console.error(`tool-definitions: ${error?.stack ?? error}`)
  process.exit(1)
})
