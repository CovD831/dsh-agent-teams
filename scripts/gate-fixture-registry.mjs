#!/usr/bin/env node
/**
 * ── 夹具登记普查：`scripts/` 下有多少测试夹具**从未被任何入口点引用** ──────────────
 *
 * ── 它防的是什么（这是本文件存在的唯一理由）────────────────────────────────────
 *
 * 一个没人跑的夹具**不会红**。它既保护不了任何东西，也不会有人发现它没用 ——
 * 于是它会一直躺在那里，读起来像一份保障。上一个 DAG 里同一个人就造出过两个
 * 这样的文件。⇒ 本脚本把这件事变成一个可复跑的**读数**，而不是靠人记得。
 *
 * ── ★ 夹具集合的定义（显式、可审）────────────────────────────────────────────
 *
 *     夹具 := `scripts/**` 下的任意 `*.test.mjs`（递归，含 `scripts/fixtures/**`）
 *
 * ★ 为什么把 `scripts/fixtures/**` 也算进来：它们是**真的测试**（`node --test` 直接
 *   跑它们），只是住在 `fixtures/` 子目录里。把它们排除会让普查对"这个目录下的
 *   游离夹具"完全失明 —— 而那正是本脚本要抓的形状。
 * ★ 为什么不算 `scripts/fixtures/*.mjs`（非 `.test.mjs`）：那些是**被 import 的助手**
 *   （如 `reviewed-stamp.mjs`）。它们没有"被跑"这个属性，所以不适用"登记"这个概念。
 *   ⇒ 口径：**只有 `*.test.mjs` 是夹具**。
 *
 * ── ★ "已注册"的定义（模型必须诚实，所以它写在这里）────────────────────────────
 *
 *     一个夹具【已注册】 ⇔ 存在一条**可执行的**入口，它会在某种运行方式下
 *     把这个文件当成测试跑起来。
 *
 * 本脚本建模了三类入口，全部从**仓库里可读的事实**推出（不硬编码清单）：
 *
 *   ① `package.json` 的 `scripts` 条目
 *      · 取命令里的 `scripts/…` 词元；含 `*`/`?` 的词元按**文件系统展开**；
 *      · 顺着 `pnpm <name>` / `npm run <name>` 做**传递闭包**（本仓的
 *        `verify` → `verify:gates` → `test:gates` 就是这条链）。
 *      · ★ 本仓**没有** `test` 脚本 ⇒ `pnpm test` 不是入口（详见报告里的展开一节）。
 *
 *   ② CI 工作流里**直接**写的 `node --test …` 参数
 *      （`.github/workflows/*.yml`）。本仓 `verify.yml` 正是这样跑
 *      `scripts/fixtures/*-case.test.mjs` 的 —— 那条路径在 package.json 里根本没有。
 *
 *   ③ 可达的**目录扫描器**（repo-local runner）
 *      · 可达 := 该模块出现在 ①/② 的命令词元里，或**被它们传递地相对 import**；
 *      · 扫描器 := 源码里 `readdirSync(…)` 附近有一个能匹配 `.test.mjs` 的**正则字面量**。
 *      · 本仓实例：`scripts/select-fixtures.mjs:65` 的 `/^gate-.*\.test\.mjs$/`
 *        （由 `scripts/verify-fast.mjs` import，而 `verify:fast` 是 package.json 脚本）。
 *
 * ★★ **不能判定的，就说 `undecidable`，绝不默认成"已注册"**。触发条件（都是显式的）：
 *    · 某个可达模块里出现了 `.test.mjs` + `readdirSync`，但它扫的图案**无法静态解析**
 *      （没有正则字面量）；
 *    · 某个可达模块在 `spawn`/`execFile`/`execSync` + `--test` 的一行里**字面**出现了
 *      某个夹具的文件名，而模型没有为它建立出任何路由（动态拼路径）。
 *   ⇒ 这两条都是"模型看不见它怎么被跑"，而不是"它没被跑"。两者不同形，必须分开。
 *
 * ★★ 一个**非**触发条件（容易写错的地方）：文档 / 注释里**提到**了某个夹具，不算注册。
 *   本仓的 `scripts/worktree-commit.test.mjs` 就被 `worktree-reclaim.mjs` 的注释点名，
 *   被 `docs/` 点名 —— 而它一次都没被跑过。⇒ 模型把它们记进 `mentions`（作为证据），
 *   但**不**据此改成已注册。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────────
 *
 *     node scripts/gate-fixture-registry.mjs                 # 人读的报告
 *     node scripts/gate-fixture-registry.mjs --json          # 机器读（稳定 schema）
 *     node scripts/gate-fixture-registry.mjs --root <dir>    # 换根（测试用合成树）
 *     GATE_FIXTURE_REGISTRY_ROOT=<dir>                       # 同上，环境变量形式
 *
 * ★ `--root` 与 `GATE_FIXTURE_REGISTRY_ROOT` 让夹具能在一棵**合成的**小树上取证，
 *   而不是只能对着真仓打折。优先级：`--root` > 环境变量 > 本文件所在的仓库根。
 *
 * ── 退出码 ──────────────────────────────────────────────────────────────────
 *
 *     0 = 普查**跑完了**（哪怕它发现了未注册夹具 —— 发现不是失败）
 *     2 = 跑不了（`<root>/scripts` 不存在 / 不是目录 / 读不了）
 *          ⇒ ★ 此时**绝不**打印"全部已注册"的读数；它连 registered/unregistered
 *            两个槽都不输出（缺席与"零"必须不同形）。
 *
 * ── 纪律 ────────────────────────────────────────────────────────────────────
 *
 * ★ 只读：本脚本不 import 任何写 API，不碰 `scripts/`、`src/`、`lib/`、`package.json`。
 * ★ 离线、确定：无网络、无时间戳、无随机数；所有清单按码位序排序，两次运行逐字节相同。
 * ★ 两态**永不合并**：`registered` 与 `unregistered` 是两个独立的槽与两个独立的计数
 *   （另有一个独立的 `undecidable` 槽）。任何"把没测到并在已注册里"的写法都违反本文件。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCHEMA = 1
const ENV_ROOT = 'GATE_FIXTURE_REGISTRY_ROOT'
const FIXTURE_PATTERN = 'scripts/**/*.test.mjs'
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ─────────────────────────────────────────────────────────────────────────────
// 小工具
// ─────────────────────────────────────────────────────────────────────────────

/** 路径比较用**码位序**，不用 localeCompare —— 后者随 locale 变，会让读数不可复跑。 */
function sortStrings(list) {
  return [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

function toPosix(path) {
  return sep === '/' ? path : path.split(sep).join('/')
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

function readJson(path) {
  const text = readText(path)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** 递归列文件（相对 root 的 posix 路径），跳过 `node_modules` / `.git`。 */
function walkFiles(rootDir, startRel, options = {}) {
  const { skipDir = [] } = options
  const out = []
  const walk = (relDir) => {
    let entries
    try {
      entries = readdirSync(relDir === '' ? rootDir : join(rootDir, relDir), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (skipDir.includes(entry.name)) continue
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`
      if (entry.isDirectory()) walk(rel)
      else if (entry.isFile()) out.push(rel)
    }
  }
  walk(startRel)
  return sortStrings(out)
}

// ─────────────────────────────────────────────────────────────────────────────
// 夹具枚举：`scripts/**` 下的 `*.test.mjs`
// ─────────────────────────────────────────────────────────────────────────────

function listFixtures(rootDir) {
  return walkFiles(rootDir, 'scripts', { skipDir: ['node_modules', '.git'] })
    .filter((rel) => rel.endsWith('.test.mjs'))
}

// ─────────────────────────────────────────────────────────────────────────────
// shell 词元 → 文件（含 `*`/`?` 的按文件系统展开）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 展开一个 glob 词元（只支持 `*` 与 `?`；**不支持** `{}` 与 `**` —— 本仓没有用到，
 * 而假装支持会让一个不匹配静默地变成"零文件"，那与"没有这个夹具"同形）。
 *
 * ★ 语义按 **shell**（POSIX sh / CI 里的 bash）来：`*` 不跨 `/`。
 *   ★ 而它在 Windows 的 cmd.exe 下**不会展开** —— 那是本仓 `test:gates` 的一条真实
 *     脆弱面（CI 里 `shell: bash` 才把它兜住），报告里会写出来。
 */
function expandGlob(rootDir, pattern) {
  const normalized = toPosix(pattern)
  if (!/[*?]/.test(normalized)) {
    const abs = join(rootDir, ...normalized.split('/'))
    return existsSync(abs) && statSync(abs).isFile() ? [normalized] : []
  }
  const segments = normalized.split('/')
  const firstWild = segments.findIndex((segment) => /[*?]/.test(segment))
  if (firstWild === -1) return []
  const baseSegments = segments.slice(0, firstWild)
  const restPattern = segments.slice(firstWild).join('/')
  const baseRel = baseSegments.join('/')
  const baseAbs = baseRel === '' ? rootDir : join(rootDir, ...baseSegments)
  let baseStat
  try {
    baseStat = statSync(baseAbs)
  } catch {
    return []
  }
  if (!baseStat.isDirectory()) return []

  const escapeRegex = (text) => text.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const source = restPattern
    .split('/')
    .map((segment) => escapeRegex(segment).replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'))
    .join('/')
  const matcher = new RegExp(`^${source}$`)

  const found = []
  for (const rel of walkFiles(rootDir, baseRel, { skipDir: ['node_modules', '.git'] })) {
    const tail = baseRel === '' ? rel : rel.slice(baseRel.length + 1)
    if (matcher.test(tail)) found.push(rel)
  }
  return sortStrings(found)
}

/** 命令 → 词元（去引号）。足够解析本仓的 package.json 命令；不做完整 shell 解析。 */
function tokenizeCommand(command) {
  return command
    .split(/\s+/)
    .map((token) => token.replace(/^['"]|['"]$/g, ''))
    .filter((token) => token !== '')
}

/**
 * 一个词元"看起来像仓库里的脚本文件"吗？
 * ★ 必须同时接受 `scripts/x.test.mjs`、`./scripts/x.test.mjs` 与 `scripts/gate-*.test.mjs`
 *   （带 glob 的形态）—— 只认前两种会让 `test:gates` 的 glob 词元整个漏掉，
 *   而漏掉的表现恰好是"什么都没注册"（本文件实测踩过这一格）。
 */
const SCRIPT_PATH_TOKEN = /^(?:\.\/)?(?:[\w.@*-]+\/)*[\w.@*-]+\.(?:mjs|cjs|js)$/

// ─────────────────────────────────────────────────────────────────────────────
// 入口点：package.json 脚本（含 pnpm/npm 传递闭包）+ CI 里的 node --test
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 从命令里抽出**指向仓库文件的词元**并展开成真实文件。
 * 返回 [{ file, token }]。
 */
function expandCommandTokens(rootDir, command) {
  const out = []
  const seen = new Set()
  for (const token of tokenizeCommand(command)) {
    const clean = toPosix(token).replace(/^\.\//, '')
    if (!SCRIPT_PATH_TOKEN.test(clean)) continue
    for (const file of expandGlob(rootDir, clean)) {
      const key = `${file}\u0000${clean}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ file, token: clean })
    }
  }
  return out
}

/**
 * 走完 package.json 的 scripts 图。
 * 返回 { commands: [{entryId, command, via}], scripts }。
 *
 * ★ 传递闭包是**必须**的：本仓 `verify` 一条命令里串了 20 多个 `pnpm xxx`，
 *   而真正跑夹具的是最底下的 `test:gates`。只看一层会把 100+ 个夹具误判成未注册。
 */
function collectNpmScriptCommands(pkg) {
  const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
  const commands = []
  const seen = new Set()
  const walk = (name, via, depth) => {
    if (depth > 16 || seen.has(name)) return
    seen.add(name)
    const command = scripts[name]
    if (typeof command !== 'string') return
    commands.push({ entryId: `package.json#${name}`, command, via })
    for (const match of command.matchAll(/\b(?:pnpm|npm)\s+(?:run\s+|exec\s+)?([A-Za-z0-9:._-]+)/g)) {
      const target = match[1]
      if (Object.prototype.hasOwnProperty.call(scripts, target)) walk(target, [...via, name], depth + 1)
    }
  }
  for (const name of sortStrings(Object.keys(scripts))) walk(name, [], 0)
  return { commands, scripts }
}

function collectCiCommands(rootDir) {
  const dir = join(rootDir, '.github', 'workflows')
  let names
  try {
    names = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name))
  } catch {
    return { files: [], commands: [] }
  }
  const files = sortStrings(names).map((name) => `.github/workflows/${name}`)
  const commands = []
  for (const rel of files) {
    const text = readText(join(rootDir, ...rel.split('/')))
    if (text === undefined) continue
    for (const [index, line] of text.split('\n').entries()) {
      /** 只认**直接写的** `node --test …`：这是 CI 绕过 package.json 去跑夹具的唯一入口。 */
      const match = line.match(/\bnode\s+--test\s+(.+)$/)
      if (!match) continue
      commands.push({
        entryId: `${rel}:${index + 1}`,
        command: match[1].trim(),
        via: [],
      })
    }
  }
  return { files, commands }
}

// ─────────────────────────────────────────────────────────────────────────────
// 可达模块（用于目录扫描器）
// ─────────────────────────────────────────────────────────────────────────────

const RELATIVE_IMPORT = /\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g

/** 从一个模块出发，收集它（相对）import 到的、仍在仓库内的模块。 */
function followImports(rootDir, startFiles) {
  const reached = new Set(startFiles)
  const queue = [...startFiles]
  while (queue.length > 0) {
    const file = queue.shift()
    const text = readText(join(rootDir, ...file.split('/')))
    if (text === undefined) continue
    for (const match of text.matchAll(RELATIVE_IMPORT)) {
      const specifier = match[1] ?? match[2]
      if (specifier === undefined) continue
      const resolved = resolveRelativeModule(file, specifier)
      if (resolved === undefined || reached.has(resolved)) continue
      if (!existsSync(join(rootDir, ...resolved.split('/')))) continue
      reached.add(resolved)
      queue.push(resolved)
    }
  }
  return sortStrings([...reached])
}

function resolveRelativeModule(fromRel, specifier) {
  const base = toPosix(join(dirname(fromRel), specifier))
  const parts = []
  for (const part of base.split('/')) {
    if (part === '.' || part === '') continue
    if (part === '..') {
      if (parts.length === 0) return undefined
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

// ─────────────────────────────────────────────────────────────────────────────
// 目录扫描器：`readdirSync(…)` + 一个能匹配 `.test.mjs` 的正则字面量
// ─────────────────────────────────────────────────────────────────────────────

/** 正则字面量（不跨行；本仓的扫描图案都是一行）。 */
const REGEX_LITERAL = /\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[dgimsuvy]*/g

/**
 * 在一个模块里找"会枚举夹具"的图案。
 *
 * 返回 [{ matcher, evidence, resolvable }]：
 *   · resolvable=true  ⇒ 图案可静态解析，`matcher` 能对 basename / 相对路径判定；
 *   · resolvable=false ⇒ 出现了 `readdirSync` + `.test.mjs`，但图案读不出来。
 */
function findDirectoryScanners(rootDir, file) {
  const text = readText(join(rootDir, ...file.split('/')))
  if (text === undefined) return []
  const lines = text.split('\n')
  const out = []
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(REGEX_LITERAL)) {
      const literal = match[0]
      /** 只关心"能匹配 `.test.mjs`"的图案。字面量里必须是 `\.test\.mjs`。 */
      if (!literal.includes('\\.test\\.mjs')) continue
      const contextStart = Math.max(0, index - 3)
      const context = lines.slice(contextStart, index + 1).join('\n')
      const isDirectoryScan = /readdirSync\s*\(/.test(context)
      const body = literal.replace(/\/[dgimsuvy]*$/, '').slice(1, -1)
      let matcher
      try {
        matcher = new RegExp(body)
      } catch {
        matcher = undefined
      }
      out.push({
        matcher,
        resolvable: matcher !== undefined,
        evidence: `${file}:${index + 1} ${truncate(line.trim(), 150)}`,
        directoryScan: isDirectoryScan,
      })
    }
  }
  return out
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

// ─────────────────────────────────────────────────────────────────────────────
// 主普查
// ─────────────────────────────────────────────────────────────────────────────

function buildReport(rootDir) {
  const fixtures = listFixtures(rootDir)
  const pkg = readJson(join(rootDir, 'package.json'))
  const { commands: npmCommands, scripts } = collectNpmScriptCommands(pkg)
  const ci = collectCiCommands(rootDir)
  const allCommands = [...npmCommands, ...ci.commands]

  /** fixture → route[]；route = { kind, entryId, token, via } */
  const routes = new Map()
  const addRoute = (file, route) => {
    if (!routes.has(file)) routes.set(file, [])
    const list = routes.get(file)
    const key = `${route.kind}\u0000${route.entryId}\u0000${route.token}\u0000${(route.via ?? []).join('>')}`
    if (list.some((existing) => existing.key === key)) return
    list.push({ ...route, key })
  }

  /** 命令词元直接点到的**全部**仓库文件（用于计算可达 runner 模块）。 */
  const commandFiles = new Set()
  for (const { entryId, command, via } of allCommands) {
    for (const { file, token } of expandCommandTokens(rootDir, command)) {
      commandFiles.add(file)
      addRoute(file, { kind: entryId.startsWith('package.json#') ? 'npm-script' : 'ci', entryId, token, via })
    }
  }

  /**
   * 可达模块：出现在命令词元里的仓库文件（glob 展开后），再沿相对 import 传递。
   * ★ 只走**非夹具**模块 —— 夹具自己 import 的东西不构成"该夹具被跑"。
   */
  const reachableModules = followImports(rootDir, [...commandFiles]).filter((file) => !file.endsWith('.test.mjs'))

  /** 目录扫描器：只认**可达**模块里的（不可达的扫描器不会跑，不能当入口）。 */
  const scanners = []
  let unresolvableScanners = 0
  for (const file of reachableModules) {
    for (const scanner of findDirectoryScanners(rootDir, file)) {
      if (!scanner.directoryScan) continue
      if (!scanner.resolvable) {
        unresolvableScanners += 1
        continue
      }
      scanners.push({ file, ...scanner })
    }
  }

  for (const fixture of fixtures) {
    const basename = fixture.split('/').pop()
    for (const scanner of scanners) {
      if (scanner.matcher.test(basename) || scanner.matcher.test(fixture)) {
        addRoute(fixture, { kind: 'runner-scan', entryId: scanner.file, token: scanner.matcher.source, via: [] })
      }
    }
  }

  const registered = []
  const unregistered = []
  const undecidable = []

  for (const fixture of fixtures) {
    const found = routes.get(fixture) ?? []
    if (found.length > 0) {
      const ordered = [...found].sort(compareRoutes)
      registered.push({ path: fixture, entry: describeRoute(ordered[0]), routes: ordered.map(describeRoute), routeCount: ordered.length })
      continue
    }
    /** 未注册：先看它是不是"模型看不见怎么被跑"（⇒ undecidable），否则如实未注册。 */
    const reasons = []
    if (unresolvableScanners > 0) {
      reasons.push(`存在 ${unresolvableScanners} 个可达的目录扫描器，其图案无法静态解析`)
    }
    const dynamicHits = findDynamicSpawnHits(rootDir, reachableModules, fixture)
    if (dynamicHits.length > 0) reasons.push(...dynamicHits)
    if (reasons.length > 0) {
      undecidable.push({ path: fixture, reasons, searched: describeSearched(npmCommands, ci, reachableModules, scanners) })
      continue
    }
    unregistered.push({
      path: fixture,
      searched: describeSearched(npmCommands, ci, reachableModules, scanners),
      mentions: findMentions(rootDir, reachableModules, fixture),
    })
  }

  const scriptFacts = describeScriptFacts(rootDir, scripts)
  return {
    schema: SCHEMA,
    root: rootDir,
    fixturePattern: FIXTURE_PATTERN,
    entryPoints: describeEntryPoints(npmCommands, ci, scanners),
    scripts: scriptFacts,
    registered: { count: registered.length, fixtures: registered },
    unregistered: { count: unregistered.length, fixtures: unregistered },
    undecidable: { count: undecidable.length, fixtures: undecidable },
    total: fixtures.length,
  }
}

/** 路由排序：直连词元优先于 glob，glob 优先于目录扫描；同档按入口名。 */
function compareRoutes(a, b) {
  const rank = (route) => (route.kind === 'runner-scan' ? 2 : route.token.includes('*') || route.token.includes('?') ? 1 : 0)
  const byRank = rank(a) - rank(b)
  if (byRank !== 0) return byRank
  if (a.entryId !== b.entryId) return a.entryId < b.entryId ? -1 : 1
  return a.token < b.token ? -1 : a.token > b.token ? 1 : 0
}

function describeRoute(route) {
  const via = route.via && route.via.length > 0 ? ` (via ${route.via.map((name) => `pnpm ${name}`).join(' → ')})` : ''
  const label = route.kind === 'runner-scan' ? 'runner-scan' : route.kind === 'ci' ? 'ci' : 'npm-script'
  return `${label} ${route.entryId} [${route.token}]${via}`
}

function describeEntryPoints(npmCommands, ci, scanners) {
  return {
    npmScriptCount: Object.keys(npmCommands).length,
    npmCommands: npmCommands.length,
    ciFiles: ci.files,
    ciCommands: ci.commands.length,
    directoryScanners: scanners.map((scanner) => scanner.evidence),
  }
}

function describeSearched(npmCommands, ci, reachableModules, scanners) {
  return {
    npmScripts: npmCommands.map((entry) => entry.entryId),
    ciFiles: ci.files,
    reachableModules,
    directoryScanners: scanners.map((scanner) => scanner.evidence),
  }
}

/** 动态 spawn 的痕迹：可达模块里同一行同时出现 `--test` 与该夹具的文件名。 */
function findDynamicSpawnHits(rootDir, reachableModules, fixture) {
  const basename = fixture.split('/').pop()
  const hits = []
  for (const file of reachableModules) {
    const text = readText(join(rootDir, ...file.split('/')))
    if (text === undefined) continue
    for (const [index, line] of text.split('\n').entries()) {
      if (!line.includes(basename)) continue
      if (!/--test|\.test\.mjs/.test(line)) continue
      if (!/\b(?:spawn|execFile|execFileSync|execSync|exec)\s*\(/.test(line)) continue
      hits.push(`${file}:${index + 1} 动态跑测试且字面提到本夹具，但模型没能建立路由：${truncate(line.trim(), 140)}`)
    }
  }
  return hits
}

/**
 * 提到 ≠ 注册。这里只为**未注册**夹具收集"被 prose 点名过"的证据，
 * 让人一眼看到"它看起来像被引用过，但那些引用都不会跑它"。
 */
function findMentions(rootDir, reachableModules, fixture) {
  const basename = fixture.split('/').pop()
  const candidates = new Set(reachableModules.map((file) => file))
  const docFiles = [
    ...walkFiles(rootDir, 'docs', { skipDir: ['node_modules', '.git'] }),
    ...walkFiles(rootDir, '', { skipDir: ['node_modules', '.git', 'docs', 'scripts', 'src', 'lib'] }).filter((rel) => /\.(?:md|html)$/.test(rel)),
  ]
  let checked = 0
  const mentions = []
  for (const rel of sortStrings([...docFiles])) {
    if (checked > 400 || mentions.length >= 5) break
    let size
    try {
      size = statSync(join(rootDir, ...rel.split('/'))).size
    } catch {
      continue
    }
    if (size > 300_000) continue
    checked += 1
    candidates.add(rel)
  }
  for (const rel of sortStrings([...candidates])) {
    if (mentions.length >= 5) break
    const text = readText(join(rootDir, ...rel.split('/')))
    if (text === undefined || !text.includes(basename)) continue
    const index = text.split('\n').findIndex((line) => line.includes(basename))
    if (index === -1) continue
    mentions.push(`${rel}:${index + 1}`)
  }
  return mentions
}

// ─────────────────────────────────────────────────────────────────────────────
// `test` / `test:gates` 的**实际**展开（验收 4：必须写清，不许猜）
// ─────────────────────────────────────────────────────────────────────────────

function describeScriptFacts(rootDir, scripts) {
  const hasTestScript = Object.prototype.hasOwnProperty.call(scripts, 'test')
  const testGates = typeof scripts['test:gates'] === 'string' ? scripts['test:gates'] : undefined
  const facts = {
    hasTestScript,
    test: hasTestScript ? scripts.test : null,
    testGates: null,
  }
  if (testGates === undefined) return facts
  const tokens = tokenizeCommand(testGates).filter((token) => token.startsWith('scripts/'))
  const globTokens = tokens.filter((token) => /[*?]/.test(token))
  const explicitTokens = tokens.filter((token) => !/[*?]/.test(token))
  const globMatched = new Set()
  for (const token of globTokens) for (const file of expandGlob(rootDir, token)) globMatched.add(file)
  const explicitMatched = explicitTokens.filter((token) => existsSync(join(rootDir, ...toPosix(token).split('/'))))
  const explicitMissing = explicitTokens.filter((token) => !existsSync(join(rootDir, ...toPosix(token).split('/'))))
  const globOnly = sortStrings([...globMatched].filter((file) => !explicitMatched.includes(file)))
  const explicitOnly = sortStrings(explicitMatched.filter((file) => !globMatched.has(file)))
  const union = sortStrings(new Set([...globMatched, ...explicitMatched]))
  facts.testGates = {
    command: testGates,
    tokens: tokenizeCommand(testGates).length,
    pathTokens: tokens.length,
    globTokens,
    explicitTokenCount: explicitTokens.length,
    explicitMissing,
    globMatchCount: globMatched.size,
    explicitMatchCount: explicitMatched.length,
    bothCount: explicitMatched.length - explicitOnly.length,
    globOnly,
    explicitOnly,
    fileCount: union.length,
    /** shell 承担 `*` 展开；Windows cmd.exe 不展开它 —— CI 里靠 `shell: bash` 兜住。 */
    globExpandedBy: 'shell',
    files: union,
  }
  return facts
}

// ─────────────────────────────────────────────────────────────────────────────
// 输出
// ─────────────────────────────────────────────────────────────────────────────

function renderText(report) {
  const lines = []
  const push = (line = '') => lines.push(line)
  push('── 夹具登记普查（gate-fixture-registry）──────────────────────────────────')
  push(`root: ${report.root}`)
  push(`夹具定义: ${report.fixturePattern}（递归；含 scripts/fixtures/**）`)
  push(`入口点: ${report.entryPoints.npmCommands} 条 package.json 命令`
    + ` + ${report.entryPoints.ciCommands} 条 CI 直跑命令`
    + ` + ${report.entryPoints.directoryScanners.length} 个可达目录扫描图案`)
  push('')
  push(`── 已注册（${report.registered.count}）──────────────────────────────────`)
  for (const fixture of report.registered.fixtures) {
    const more = fixture.routeCount > 1 ? `  (+${fixture.routeCount - 1} 条其它入口)` : ''
    push(`已注册  ${fixture.path}  ← ${fixture.entry}${more}`)
  }
  push('')
  push(`── 未注册（${report.unregistered.count}）────────────────────────────────`)
  if (report.unregistered.count === 0) {
    push('（无）')
  } else {
    for (const fixture of report.unregistered.fixtures) {
      push(`未注册  ${fixture.path}`)
      push(`    searched: ${fixture.searched.npmScripts.length} 条 package.json 命令词元（glob 已按 shell 展开）；`
        + `${fixture.searched.ciFiles.length} 个 CI 工作流的直接 node --test；`
        + `${fixture.searched.reachableModules.length} 个可达 runner 模块；`
        + `${fixture.searched.directoryScanners.length} 个目录扫描图案`)
      const mentions = fixture.mentions.length === 0 ? '（无）' : fixture.mentions.join('、')
      push(`    mentions(仅文字提及，不会跑它): ${mentions}`)
    }
  }
  if (report.undecidable.count > 0) {
    push('')
    push(`── 未判定（${report.undecidable.count}）—— 模型看不见它怎么被跑，不并进任何一态 ──`)
    for (const fixture of report.undecidable.fixtures) {
      push(`undecidable  ${fixture.path}`)
      for (const reason of fixture.reasons) push(`    reason: ${reason}`)
    }
  }
  push('')
  push('── 总计 ────────────────────────────────────────────────────────────────')
  push(`total=${report.total}  registered=${report.registered.count}`
    + `  unregistered=${report.unregistered.count}  undecidable=${report.undecidable.count}`)
  push(`registered + unregistered + undecidable === total: `
    + `${report.registered.count + report.unregistered.count + report.undecidable.count === report.total}`)
  push('')
  push('── 脚本展开方式（验收 4：实际读数，不是复述）──────────────────────────')
  const facts = report.scripts
  if (!facts.hasTestScript) {
    push('test: ★ 不存在 —— package.json 里没有 `test` 脚本，所以 `pnpm test` / `npm test` 不是入口。')
  } else {
    push(`test: ${facts.test}`)
  }
  if (facts.testGates === null) {
    push('test:gates: ★ 不存在')
  } else {
    const gate = facts.testGates
    push(`test:gates: ${truncate(gate.command, 120)}`)
    push(`  · 词元 ${gate.tokens} 个，其中指向 scripts/ 的 ${gate.pathTokens} 个`)
    push(`  · glob 词元 ${gate.globTokens.length} 个：${gate.globTokens.join(' ') || '（无）'}`
      + ` ⇒ 按文件系统展开得 ${gate.globMatchCount} 个文件`)
    push(`  · 显式 .mjs 参数 ${gate.explicitTokenCount} 个 ⇒ 实际存在 ${gate.explicitMatchCount} 个`
      + `（缺失 ${gate.explicitMissing.length} 个）`)
    push(`  · glob 已覆盖其中 ${gate.bothCount} 个；glob 额外带来 ${gate.globOnly.length} 个；`
      + `仅显式列出、glob 抓不到 ${gate.explicitOnly.length} 个`)
    push(`  · ★ 并集 = ${gate.fileCount} 个不同的夹具文件被这一条脚本跑起来`)
    push(`  · ★ glob 由 ${gate.globExpandedBy} 展开：POSIX sh / bash 会展开；Windows cmd.exe 不会`
      + `（CI 里靠 \`shell: bash\` 兜住，但那不是 package.json 自己保证的）`)
  }
  return `${lines.join('\n')}\n`
}

function renderJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`
}

// ─────────────────────────────────────────────────────────────────────────────
// 入口
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = { json: false, help: false, root: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--root') {
      index += 1
      options.root = argv[index]
    } else if (arg.startsWith('--root=')) options.root = arg.slice('--root='.length)
    else return { ...options, unknown: arg }
  }
  return options
}

function usage() {
  return [
    '用法: node scripts/gate-fixture-registry.mjs [--root <dir>] [--json] [--help]',
    '',
    '  普查 scripts/**/*.test.mjs，把【已注册】与【未注册】两态分别列出并给出证据行。',
    '',
    '  --root <dir>   换一个根目录（测试用合成树）；也可用环境变量 ' + ENV_ROOT,
    '  --json         输出稳定 schema 的机器读数（stdout 上只有 JSON）',
    '  --help         本说明',
    '',
    '退出码: 0 = 普查完成（含"发现未注册夹具"）；2 = 跑不了（scripts/ 不可识别）',
  ].join('\n')
}

function main(argv) {
  const options = parseArgs(argv)
  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return 0
  }
  if (options.unknown !== undefined) {
    process.stderr.write(`gate-fixture-registry: 不认识的参数 ${options.unknown}\n${usage()}\n`)
    return 2
  }
  const requestedRoot = options.root ?? process.env[ENV_ROOT] ?? REPO_ROOT
  const rootDir = join(requestedRoot)

  /** 可识别性：`<root>/scripts` 必须是一个**读得了的目录**。 */
  let scriptsStat
  try {
    scriptsStat = statSync(join(rootDir, 'scripts'))
  } catch {
    return fail(options, `在 ${rootDir} 下找不到可识别的 scripts/ 目录`)
  }
  if (!scriptsStat.isDirectory()) {
    return fail(options, `${join(rootDir, 'scripts')} 不是目录`)
  }
  try {
    readdirSync(join(rootDir, 'scripts'))
  } catch {
    return fail(options, `${join(rootDir, 'scripts')} 读不了`)
  }

  const report = buildReport(rootDir)
  /**
   * ★ 0 个夹具**不是**"全部已注册"：它可能是"这个根根本不对"。
   *   所以单独说一句，并把它写进 JSON 的一个字段。
   */
  const emptyWarning = report.total === 0
  process.stdout.write(options.json ? renderJson({ ...report, emptyWarning }) : renderText(report))
  if (emptyWarning) {
    process.stderr.write('gate-fixture-registry: ⚠ scripts/ 下一个 *.test.mjs 都没有 —— 这是"什么都没找到"，不是"全部已注册"\n')
  }
  return 0
}

function fail(options, reason) {
  /** ★ 这里**不**输出 registered/unregistered 两个槽 —— 缺席与"零"必须不同形。 */
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ schema: SCHEMA, status: 'error', reason }, null, 2)}\n`)
  }
  process.stderr.write(`gate-fixture-registry: 无法普查 —— ${reason}\n`)
  return 2
}

process.exitCode = main(process.argv.slice(2))

export { buildReport, expandGlob, listFixtures }
