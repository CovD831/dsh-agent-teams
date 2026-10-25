#!/usr/bin/env node
/**
 * ── ★★★ 本机的**互联网能力**（Agent Reach）—— 一条会说话的检查命令 ────────────────────
 *
 * ── 为什么这个文件存在 ──────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-21/22，两次）：
 * ```
 * web_search 工具      ⇒ HTTP 401，key 失效（"Your api key: ****dbc1 is invalid"）
 * web_fetch github.com ⇒ "URL hostname resolves to a non-public IP address"
 * ⇒ 我"搜索不到"，而用户已经两次让我去搜东西。
 * ```
 * ★★ 这不是"模型不会搜"，是**本机没有可用的互联网通道**。
 *   而"没有通道"与"搜了没结果"在对话里**同形** —— 用户只看到我在原地打转。
 *
 * ── 装了什么（用户 2026-10-22 授权）────────────────────────────────────────────
 *
 * ```
 * Agent Reach v1.5.0（Panniantong/Agent-Reach，MIT，10 万★）
 *   · 它是一个**选择器 / 安装器 / 体检器 / 路由器**，不是包装器
 *     （上游工具直连：Jina Reader · gh · yt-dlp · bili-cli · twitter-cli …）
 *   · 装在 `.agent-reach-venv/`（工作区内 —— 沙箱只允许写工作区，而它不该进版本控制）
 *   · 全网语义搜索走 Exa MCP（免费、无需 key），经 mcporter 调
 *     ⚠️ 而 mcporter 的 `--scope home` 要写 `~/.mcporter`（被沙箱拒）
 *     ⇒ 用 `--scope project` ⇒ 配置落在 `config/mcporter.json`（**进仓**，见下）
 * ```
 *
 * ── ★★ `config/mcporter.json` 为什么可以进仓 ──────────────────────────────────────
 *
 * 它只含一个**公开的** MCP 地址（`https://mcp.exa.ai/mcp`），**没有任何凭据**。
 * ★ 而它必须进仓：否则下一个人（或下一次会话）不知道搜索走的是哪条路，
 *   于是会重新踩一遍"401 / 非公网 IP"。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────────
 *
 *   node scripts/agent-reach.mjs doctor            # 哪些渠道通、哪些要配（只读）
 *   node scripts/agent-reach.mjs search "<query>"  # 全网语义搜索（Exa）
 *   node scripts/agent-reach.mjs read <url>        # 读任意网页（Jina Reader）
 *
 * ★ 三条都是**只读**：不改仓库、不写状态。
 *
 * @module dsh-agent-teams/scripts/agent-reach
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** ★ 工作区内的两个目录（已被 `.gitignore` 忽略）。 */
const VENV_BIN = join(ROOT, '.agent-reach-venv', 'bin', 'agent-reach')
const VENV_DIR = join(ROOT, '.agent-reach-venv', 'bin')
const MCPORTER = join(ROOT, '.agent-reach-npm', 'node_modules', '.bin', 'mcporter')
const NPM_BIN = join(ROOT, '.agent-reach-npm', 'node_modules', '.bin')
const MCPORTER_CONFIG = join(ROOT, 'config', 'mcporter.json')
/**
 * ── ★★★ 隔离的 `HOME`：登录态**落在工作区内**，不写 `~` ──────────────────────────────
 *
 * Agent Reach 用 `HOME` 定位配置目录（`utils/paths.py` 逐字：`explicit_home` 优先）。
 * 而沙箱只允许写工作区 ⇒ 把 `HOME` 指进来，凭据才写得下、也才**收得住**。
 *
 * ★★ 这个目录**含凭据**（X 的 `auth_token`/`ct0`、B 站的 `SESSDATA`），已在 `.gitignore`。
 * ★★★ 而它是**后补的**：我先建了目录、后想到 gitignore，中间 `git status` 已经把它
 *   报成 untracked —— 那一刻它可以被 `git add -A` 带进版本库。
 */
const ISOLATED_HOME = join(ROOT, '.agent-reach-home')
const REACH_CONFIG = join(ISOLATED_HOME, '.agent-reach', 'config.yaml')

/**
 * 读 Agent Reach 的 YAML 配置里**两个扁平键**（不引 YAML 解析器 —— 它只写 `key: value`）。
 * ★ 凭据**不进日志、不进 argv**：只作为子进程的环境变量。
 */
function credential(key) {
  try {
    const text = readFileSync(REACH_CONFIG, 'utf8')
    const line = text.split('\n').find((entry) => entry.startsWith(`${key}:`))
    if (line === undefined) return undefined
    return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '')
  } catch {
    return undefined
  }
}

/**
 * 子进程的完整环境。
 *
 * ★★ 为什么**必须**在 JS 里拼、而不是让调用方自己 export：
 *   这条链上有三个隐含前提（`HOME` 指向哪、`twitter`/`bili` 在不在 `PATH`、
 *   两个凭据从哪来），任何一个缺了，症状都是**同一条** `HTTP 404` / `未登录`。
 *   ⇒ 让包装器自己负责，别让下一个人再猜一遍。
 */
function childEnv() {
  const env = { ...process.env, HOME: ISOLATED_HOME }
  env.PATH = [VENV_DIR, NPM_BIN, env.PATH ?? ''].filter((part) => part !== '').join(':')
  const authToken = credential('twitter_auth_token')
  const ct0 = credential('twitter_ct0')
  if (authToken !== undefined) env.TWITTER_AUTH_TOKEN = authToken
  if (ct0 !== undefined) env.TWITTER_CT0 = ct0
  return env
}

const HELP = `agent-reach —— 本机的互联网能力（只读）

  node scripts/agent-reach.mjs doctor            哪些渠道通、哪些要配
  node scripts/agent-reach.mjs search "<query>"  全网语义搜索（Exa MCP，免费）
  node scripts/agent-reach.mjs read <url>        读任意网页（Jina Reader）
  node scripts/agent-reach.mjs x search "..." -t photos -n 8
                                                 X 搜索（★ 复用 Edge 登录态）
  node scripts/agent-reach.mjs bili search "..." --type video
                                                 B 站搜索（★ 复用 Edge 登录态）

★ 装在工作区的 .agent-reach-venv / .agent-reach-npm（已 gitignore）
★ 搜索配置在 config/mcporter.json（进仓 —— 它只含公开地址，无凭据）
★★ 登录态在 .agent-reach-home/（**含凭据**，已 gitignore —— 见 .gitignore 里那条注释）
`

const [command, ...rest] = process.argv.slice(2)

if (command === undefined || command === '--help' || command === '-h') {
  process.stdout.write(HELP)
  process.exit(command === undefined ? 2 : 0)
}

if (!existsSync(VENV_BIN)) {
  /**
   * ★★ 这一格的措辞是**承重的**：缺安装 ≠ "搜索没结果"。
   *   把两者写成同一句话，会让下一个人去调搜索参数，而真正要做的是装东西。
   */
  process.stderr.write(
    'agent-reach: 本机没有装（找不到 .agent-reach-venv/bin/agent-reach）\n'
    + '  ⇒ 这与"搜了没结果"是两件事。安装：见 docs/TOOLING-INTERNET.md\n'
    + '  ★ 它需要写工作区之外的目录 —— 沙箱会拒，所以要人授权。\n',
  )
  process.exit(2)
}

function run(bin, args, { quiet = false, env = childEnv() } = {}) {
  try {
    const out = execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env })
    if (!quiet) process.stdout.write(out)
    return { ok: true, out }
  } catch (error) {
    const out = String(error?.stdout ?? '')
    const err = String(error?.stderr ?? error?.message ?? error)
    if (!quiet) process.stderr.write(err)
    return { ok: false, out, err }
  }
}

if (command === 'doctor') {
  run(VENV_BIN, ['doctor'])
  process.exit(0)
}

/**
 * ── ★★★ `x` / `bili`：两个**已配好登录态**的渠道 ─────────────────────────────────
 *
 * 它们此前都不可用，而原因**都不是"没装"**：
 * ```
 * X       twitter-cli 装了、cookie 也读到了，但每次调用都 404
 *         ⇒ 真因：`x-client-transaction` 初始化失败 —— 它去 x.com 首页找
 *           `ondemand.s.<hash>a.js` 的指纹，而**未登录的首页里没有那段**（登录墙）。
 *         ⇒ 修法：带 cookie 取 `/home`，把 home_html + ondemand 写进
 *           `~/.twitter-cli/transaction_cache.json`（twitter-cli 自己会读它）。
 * B站      `agent-reach configure --from-browser edge` 报 "No cookies found"
 *         ⇒ 真因：Edge **开着**时它的 Cookies 库被锁/未落盘，且
 *           `browser_cookie3` 直接读活库会 "Unable to get key for cookie decryption"。
 *         ⇒ 修法：先 `cp` 一份到临时目录再解；解出来写进 bili-cli 的 credential.json。
 * ```
 * ★★ 两条修法的共同点：**症状同形（404 / 未登录），真因在别处** ——
 *   而"同形"正是本仓 §4 记账最久的那类事故。
 */
if (command === 'x') {
  if (rest.length === 0) {
    process.stderr.write('agent-reach x: 需要参数，例如 `x search "pixel art" -t latest -n 5`\n')
    process.exit(2)
  }
  const result = run(join(VENV_DIR, 'twitter'), ['-c', ...rest])
  process.exit(result.ok ? 0 : 1)
}

if (command === 'bili') {
  if (rest.length === 0) {
    process.stderr.write('agent-reach bili: 需要参数，例如 `bili search "像素风 房间" --type video`\n')
    process.exit(2)
  }
  const result = run(join(VENV_DIR, 'bili'), rest)
  process.exit(result.ok ? 0 : 1)
}

if (command === 'search') {
  const query = rest.join(' ').trim()
  if (query === '') {
    process.stderr.write('agent-reach search: 需要一个查询词\n')
    process.exit(2)
  }
  if (!existsSync(MCPORTER)) {
    process.stderr.write(
      'agent-reach search: 找不到 mcporter（.agent-reach-npm）\n'
      + `  ⇒ 全网搜索走 Exa MCP，而它由 mcporter 调。安装：npm install --prefix .agent-reach-npm --cache .agent-reach-npm/.cache mcporter\n`,
    )
    process.exit(2)
  }
  /**
   * ★ 用 `--config` 显式指向仓内那份 —— 不依赖 mcporter 的全局查找顺序。
   *   否则"配置文件在哪"会随 mcporter 的版本变，而那是一份不该漂的真相。
   */
  const result = run(MCPORTER, [
    'call', 'exa.web_search_exa',
    `query=${query}`,
    `numResults=${process.env.AGENT_REACH_SEARCH_RESULTS ?? '5'}`,
    '--config', MCPORTER_CONFIG,
  ])
  process.exit(result.ok ? 0 : 1)
}

if (command === 'read') {
  const url = rest[0]
  if (url === undefined) {
    process.stderr.write('agent-reach read: 需要一个 URL\n')
    process.exit(2)
  }
  /**
   * ★ Jina Reader 是**装好即用**的渠道（无需配置、无需 key）。
   *   走 `curl https://r.jina.ai/<url>` —— Agent Reach 的 doctor 报的就是这条。
   */
  const result = run('curl', ['-sS', '-m', '60', `https://r.jina.ai/${url}`])
  process.exit(result.ok ? 0 : 1)
}

process.stderr.write(`agent-reach: 未知命令 "${command}"\n\n${HELP}`)
process.exit(2)
