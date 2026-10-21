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
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** ★ 工作区内的两个目录（已被 `.gitignore` 忽略）。 */
const VENV_BIN = join(ROOT, '.agent-reach-venv', 'bin', 'agent-reach')
const MCPORTER = join(ROOT, '.agent-reach-npm', 'node_modules', '.bin', 'mcporter')
const MCPORTER_CONFIG = join(ROOT, 'config', 'mcporter.json')

const HELP = `agent-reach —— 本机的互联网能力（只读）

  node scripts/agent-reach.mjs doctor            哪些渠道通、哪些要配
  node scripts/agent-reach.mjs search "<query>"  全网语义搜索（Exa MCP，免费）
  node scripts/agent-reach.mjs read <url>        读任意网页（Jina Reader）

★ 装在工作区的 .agent-reach-venv / .agent-reach-npm（已 gitignore）
★ 搜索配置在 config/mcporter.json（进仓 —— 它只含公开地址，无凭据）
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

function run(bin, args, { quiet = false } = {}) {
  try {
    const out = execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
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
  run(VENV_BIN, ['install', '--env=auto'])
  process.exit(0)
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
