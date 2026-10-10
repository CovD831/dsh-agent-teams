#!/usr/bin/env node
/**
 * ── 给当前生效的 dsh profile 打开【模块】热重载（HMR）────────────────────────────
 *
 * ── 它解决的是什么 ────────────────────────────────────────────────────────────
 *
 * 本插件以 `link:` 挂在 `~/.dsh/profiles/<profile>/node_modules/@nanmicoder/dsh-agent-teams`
 * ⇒ 改 `src/**` 之后 `pnpm build` 产出的 `lib/**`，**正在跑的宿主进程**仍然持有旧模块。
 * ESM 的绑定在模块求值时建立，之后永远指向同一个函数对象（`docs/MODULE-RELOAD.md` §一）。
 *
 * 官方版自带的 `@deepseek-ai/dsh-hmr` 能换掉模块 —— 而它**默认只监听配置**：
 *
 *     dsh-base 逐字：
 *         # Profile configuration reloads by default; module roots are opt-in.
 *         - id: hmr
 *           name: '@deepseek-ai/dsh-hmr'
 *           disabled: !!js "!ctx.get('profileContext')"
 *           config:
 *             root: []          ← ★ [] = 只监听配置，不监听模块
 *
 * ⇒ 本脚本把 `root` 打开，并**显式写 `base`**（见下）。
 *
 * ── ★★ 为什么必须显式写 `base`（否则这次改动是静默无效的）─────────────────────
 *
 * `@deepseek-ai/dsh-hmr` 的实现逐字（app.asar 内）：
 *
 *     this.baseDir = fileURLToPath(new URL(config.base || ".", ctx.baseUrl));
 *
 * ⇒ `base` 缺省是 `"."`，而它相对 **`ctx.baseUrl`（= profile 目录）** 解析。
 *   不写 `base` ⇒ watcher 去盯 `~/.dsh/profiles/<profile>` ⇒ **我们的源码不在那里**
 *   ⇒ 一切看起来都配好了，而一个事件都不会来。
 *
 * ★ 这一条在本仓已被独立记过一次（`docs/RESEARCH-RESTART-FREE.md` §6.2 的
 *   "base + root 这一对是关键"），而本脚本把它变成机械的。
 *
 * ── ★★★ 为什么 `base` 指向仓库根、而不是指向 `lib/` ───────────────────────────────
 *
 * 文档逐字：「Watched module paths use Node ESM resolution's `realpathSync()` spelling
 * ... so file events match the module cache.」
 *
 * 实测（本脚本的作者核过，2026-10-10）：
 *   · `realpathSync(symlink)` ⇒ `/Users/abab/Desktop/agent-teams-dev`
 *   · `import.meta.resolve`（宿主走 ESM 这侧）⇒ `file:///.../agent-teams-dev/lib/index.js`
 *   · 最小复现：经 symlink import 与经真实路径 import 拿到【同一个模块对象】
 *     ⇒ Node 的 ESM 缓存键**确实做了 realpath 归一**
 * ⇒ 所以文件事件算出的路径，与缓存里那个键，是同一个字符串。盯仓库根即可覆盖 `lib/`。
 *
 * ── 边界（如实写出来，不夸大）─────────────────────────────────────────────────
 *
 *   ✓ 它改的是【当前生效 profile】的 patch 文件
 *   ✗ 它**不重启宿主** —— 而 `hmr` 这一行要在 apply 时读入 ⇒ 这一次重启免不了
 *   ✗ 它不保证"换树能触发重载"：`pnpm build` 的 publish 是两次 rename
 *     （`lib → lib.old`、`lib.tmp → lib`），那会换掉目录 inode。
 *     chokidar 对这种情形报不报事件，**读代码断不出来，只能重启后实测**。
 *   ⇒ 所以本脚本只做"把开关打开"，并把验证方法打出来。
 *
 * 用法:
 *   node scripts/enable-hmr.mjs            # 干跑：只说它要改什么
 *   node scripts/enable-hmr.mjs --apply    # 真的改（先备份）
 *   node scripts/enable-hmr.mjs --check    # 只回答"现在开着吗"
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, realpathSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

/** 仓库根 = 本脚本所在目录的上一级（★ 与 pluginRoot() 同一个量，但那条路要经 lib/）。 */
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** HMR 的包名 —— 官方版是 `dsh-hmr`；旧的 cordis 版是 `cordis-plugin-hmr`。 */
const HMR_PACKAGE = '@deepseek-ai/dsh-hmr'

/**
 * ── 哪个 profile 在生效 ────────────────────────────────────────────────────────
 *
 * ★ 这里【不猜】。两种判据都会说话，而**不一致时本脚本拒绝动手**：
 *
 *   ① 权威来源：`~/.dsh/profiles/<name>/node_modules/@nanmicoder/dsh-agent-teams`
 *      是不是一个指向本仓的 symlink ⇒ 那个 profile 真的挂着我们这个插件。
 *      —— 这条比"某个 UI 状态文件说 active_profile 是谁"更硬：它说的是
 *         "这个 profile 的模块图里真的有我们"，而不是"UI 认为它是活的"。
 *
 *   ② 环境变量 `DSH_PROFILE`（若宿主导出）—— 只作**交叉核对**。
 *
 * ★★ 为什么不直接用 `~/.dsh/storages/workspace.json` 或 tauri 的 `.store.dat`：
 *   本机实测过它们**会指向另一个壳**（`.store.dat` 说 `active_profile: "tauri"`，
 *   而宿主进程的 `cwd` 是 `~/.dsh/profiles/desktop`）。
 *   ⇒ 拿一个"UI 记得的那个"去改配置，会改到**一个根本没在跑的 profile** 上，
 *     而那与"改对了"在读数上同形。这正是本仓记账最久的那条形状。
 */
function profileCandidates() {
  const dir = join(homedir(), '.dsh', 'profiles')
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readFileNames(dir)) {
    const pluginLink = join(dir, name, 'node_modules', '@nanmicoder', 'dsh-agent-teams')
    if (!existsSync(pluginLink)) continue
    let target
    try { target = realpathSync(pluginLink) } catch { continue }
    if (target !== REPO_ROOT) continue
    out.push({ name, dir: join(dir, name), patch: join(dir, name, 'cordis.patch.yml'), linksTo: target })
  }
  return out
}

function readFileNames(dir) {
  return readdirSync(dir).filter((name) => !name.startsWith('.'))
}

/** 已存在的 hmr 行（按 `- id: hmr` 定位其所在块）。 */
function findHmrBlock(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => /^-\s*id:\s*hmr\s*$/.test(line.trim()) || /^-\s*id:\s*"hmr"\s*$/.test(line.trim()))
  if (start === -1) return undefined
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^-\s/.test(lines[i])) { end = i; break }
  }
  return { start, end, text: lines.slice(start, end).join('\n') }
}

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const checkOnly = args.includes('--check')

const candidates = profileCandidates()

console.log('── 打开模块 HMR ──────────────────────────────────────────')
console.log(`  仓库根            ${REPO_ROOT}`)
console.log(`  HMR 包名          ${HMR_PACKAGE}`)
console.log()

if (candidates.length === 0) {
  console.error('★ 没有找到任何 profile 通过 symlink 挂着本仓。')
  console.error('  期望: ~/.dsh/profiles/<name>/node_modules/@nanmicoder/dsh-agent-teams -> 本仓')
  console.error('  ⇒ 先确认插件是用 link: 装进 profile 的（见 AGENTS.md 的 profile 挂载约定）。')
  process.exit(2)
}

if (candidates.length > 1) {
  console.error(`★★ 有 ${candidates.length} 个 profile 都挂着本仓 ⇒ 本脚本【拒绝猜】要改哪一个：`)
  for (const c of candidates) console.error(`     · ${c.name}  (${c.patch})`)
  console.error('  ⇒ 请人工确认后直接编辑那一个文件的 cordis.patch.yml。')
  process.exit(3)
}

const profile = candidates[0]
console.log(`  生效 profile      ${profile.name}`)
console.log(`  它的 patch        ${profile.patch}`)
console.log()

if (!existsSync(profile.patch)) {
  console.error(`★ profile patch 不存在: ${profile.patch}`)
  process.exit(2)
}

const original = readFileSync(profile.patch, 'utf8')
const block = findHmrBlock(original)

/**
 * 要插入/替换的那一段。
 *
 * ★ `disabled: false` 是显式写法。dsh-base 里那一行是
 *   `disabled: !!js "!ctx.get('profileContext')"`，在桌面壳里为 false（= 开着）
 *   ⇒ 两者在桌面壳等价；写死 `false` 更明确，且不吃 `!!js` 那个扩展。
 */
const DESIRED = [
  `- id: hmr`,
  `  name: '${HMR_PACKAGE}'`,
  `  disabled: false`,
  `  config:`,
  `    # ★ 必须写 base：缺省是 profile 目录，而源码不在那里（=> 静默无效）。`,
  `    base: ${new URL(`file://${REPO_ROOT}`).href}`,
  `    root: ["."]`,
  `    ignored:`,
  `      - '**/node_modules'`,
  `      - '**/.*'`,
  `      - 'cache'`,
  `      - 'data'`,
  `    debounce: 100`,
].join('\n')

if (checkOnly) {
  if (block === undefined) {
    console.log('⇒ ★ 未配置：profile patch 里没有 hmr 行 ⇒ 模块热重载【不生效】（改代码要重启）。')
    process.exit(1)
  }
  const hasBase = /^\s*base:\s*\S/m.test(block.text)
  const hasRoot = /^\s*root:\s*\[/m.test(block.text)
  const emptyRoot = /^\s*root:\s*\[\s*\]/m.test(block.text)
  console.log('⇒ 已存在 hmr 行，现状：')
  console.log(`     base 在场   ${hasBase ? '是' : '★ 否 ⇒ watcher 盯的是 profile 目录，模块改动看不到'}`)
  console.log(`     root 在场   ${hasRoot ? (emptyRoot ? '★ 是但为 [] ⇒ 只监听配置，不监听模块' : '是且非空') : '否'}`)
  process.exit(hasBase && hasRoot && !emptyRoot ? 0 : 1)
}

/** 幂等：已经是我们想要的样子 ⇒ 不动文件。 */
function alreadyDesired(text) {
  if (block === undefined) return false
  const wantBase = new URL(`file://${REPO_ROOT}`).href
  return block.text.includes(wantBase)
    && /^\s*root:\s*\["?\."?\]/m.test(block.text)
    && !/root:\s*\[\s*\]/.test(block.text)
}

if (alreadyDesired(original)) {
  console.log('⇒ ★ 已经是打开状态（base 与 root 都对）—— 没有改动任何文件。')
  console.log()
  printNextSteps(profile)
  process.exit(0)
}

let updated
if (block === undefined) {
  const sep = original.endsWith('\n') ? '' : '\n'
  updated = `${original}${sep}\n# ── 模块热重载（由 scripts/enable-hmr.mjs 写入）────────────────────\n`
    + `#   打开 root 之后，改 src/** → pnpm build 即生效，不必重启宿主。\n`
    + `#   ★ base 必须显式写：缺省是 profile 目录，而源码不在那里。\n`
    + `${DESIRED}\n`
  console.log('  动作              追加 hmr 行（文件里此前没有）')
} else {
  const lines = original.split('\n')
  updated = [...lines.slice(0, block.start), DESIRED, ...lines.slice(block.end)].join('\n')
  console.log('  动作              替换已有的 hmr 行')
}

console.log()
if (!apply) {
  console.log('── 干跑（没有改动任何文件）──────────────────────────────')
  console.log('  将要写入的段落：')
  console.log(DESIRED.split('\n').map((l) => `    ${l}`).join('\n'))
  console.log()
  console.log('  ⇒ 真要写入：node scripts/enable-hmr.mjs --apply')
  process.exit(0)
}

/** 备份：沿用该目录既有的命名习惯（`cordis.patch.yml.bak-<YYYYMMDD>`）。 */
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const backup = `${profile.patch}.bak-${stamp}`
/**
 * ── ★ 写不进去时要说清【是哪一种写不进去】────────────────────────────────────────
 *
 * MEASURED（2026-10-10，本条的作者在受沙箱限制的会话里跑 --apply）：
 *   `writeFileSync` 抛 `EPERM`，而脚本此前**没有捕获它** ⇒ 一层裸栈。
 *   而那一层栈里没有一句话说"这是权限/沙箱问题，不是配置问题"——
 *   读的人会以为脚本坏了。
 *
 * ★ 与本队那条三态纪律同源：`EPERM`（做不到）与"配错了"必须不同形，
 *   而它们的**处置完全不同**（一个去换权限，一个去改内容）。
 *
 * ★ `EPERM` 尤其值得点名：它在本机**不等于**文件不可写
 *   （`-rw-------` 且属主是本人）—— 它是一次**沙箱拒绝**。
 *   ⇒ 所以那句话要把这个区别说出来，否则下一个人会去 `chmod`。
 */
try {
  if (!existsSync(backup)) copyFileSync(profile.patch, backup)
  writeFileSync(profile.patch, updated)
} catch (error) {
  const code = error?.code ?? '(无 code)'
  console.error()
  console.error(`★ 写不进去：${profile.patch}`)
  console.error(`  错误码            ${code}`)
  console.error(`  原错误            ${error?.message ?? String(error)}`)
  console.error()
  if (code === 'EPERM' || code === 'EACCES') {
    console.error('  ⇒ ★ 这是一次【权限/沙箱拒绝】，不是"这个文件的内容不对"。')
    console.error('     profile 目录在会话工作区之外 ⇒ 受沙箱限制的进程写不了它。')
    console.error('     处置：在一个【不受该限制】的终端里重跑本命令，或者手工粘贴下面这一段。')
  }
  console.error()
  console.error('── 请把下面这一段追加到那个文件末尾 ──────────────────────')
  console.error()
  console.error(DESIRED)
  console.error()
  process.exit(4)
}

console.log(`  ★ 已写入          ${profile.patch}`)
console.log(`  ★ 备份            ${backup}`)
console.log()
printNextSteps(profile)

function printNextSteps(profile) {
  console.log('── 下一步（顺序不能反）──────────────────────────────────')
  console.log()
  console.log('  ① ★ 必须先重启宿主一次 —— hmr 这一行要在 apply 时读入，')
  console.log('     所以它自己免不了这一次。当前宿主：')
  console.log('         kill -TERM <hostPid>')
  console.log('     宿主 = 在 127.0.0.1:<guiPort> 上 LISTEN 的那个 DeepSeek 进程。')
  console.log('     找它:  lsof -nP -iTCP -sTCP:LISTEN | grep DeepSeek')
  console.log()
  console.log('  ② 重启后确认开着：node scripts/enable-hmr.mjs --check')
  console.log()
  console.log('  ③ 验证重载（由可靠到不可靠）：')
  console.log('     a) 改一个字符串 → 只跑 tsc → 等过 awaitWriteFinish 的 2 秒窗口 → 看宿主日志')
  console.log('     b) 跑一次完整 pnpm build → 看那次原子换树有没有被上报')
  console.log('        ★ b 是对一个【读代码断不出来】的行为的实测：publish 会换掉 lib/ 的')
  console.log('          inode（两次 rename），chokidar 报不报事件只能实测。')
  console.log('     c) 若 b 不触发 ⇒ watcher 跟丢了 inode ⇒ 退路是把 base 指向 lib/，')
  console.log('        或回到"每次 build 后重启"（= 现状，不会更坏）。')
  console.log()
  console.log('  ★ 模型看不到重载：dsh-hmr 文档逐字 —— "`ctx.hmr` adds no model-facing')
  console.log('    tools or messages." ⇒ 验证只能靠宿主日志，没有捷径。')
}
