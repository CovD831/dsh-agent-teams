#!/usr/bin/env node
/**
 * ── 一键重启宿主：找到持有 GUI 端口的那个进程，杀掉它 ────────────────────────────
 *
 * ── 为什么需要它（而不是"在活动监视器里退出"）───────────────────────────────────
 *
 * MEASURED（2026-10-10）：
 *   · 宿主进程持有插件的模块（ESM 绑定在求值时建立，之后永远指向同一个函数对象）
 *     ⇒ 改 `src/**` + `pnpm build` 之后，**它的内存里还是旧代码**；
 *   · 而 `loadedStamp()` 是**进程级、加载时读一次**的常量
 *     ⇒ 不重启，任何"读一读现在用的是哪一版"的说法都测不到真相。
 *
 * ★ 所以 `scripts/enable-hmr.mjs` 配好之后，**这一次重启免不了**：
 *   `hmr` 那一行要在 apply 时读入 —— 它自己不能靠 HMR 生效。
 *
 * ── ★★ 为什么必须用 `lsof` 找，不能用 `pgrep`（本机实测）──────────────────────
 *
 * MEASURED（本脚本作者实测）：
 *     pgrep -x "DeepSeek"                      ⇒ 空（exit 1）
 *     pgrep -fl "DeepSeek"                     ⇒ 空
 *     lsof -nP -iTCP:19387 -sTCP:LISTEN        ⇒ DeepSeek  PID 41339  ✅
 *
 * ⇒ 两者对**同一个进程**给出相反答案。若本脚本信 `pgrep`，它会报"没找到宿主"
 *   而宿主明明在跑 —— 那正是本仓那条"一个静默的读数被读成了它想读成的意思"。
 *   ★ 所以：**端口是唯一判据**，进程名只用来交叉核对（且允许不一致，只提示）。
 *
 * ── 端口从哪来 ────────────────────────────────────────────────────────────────
 *
 * 三个来源，按【可信度从高到低】：
 *   ① `--port <n>`   —— 人显式给的，最高
 *   ② `DSH_PORT`     —— 环境变量
 *   ③ 自动探测        —— 扫本机 LISTEN 端口，找**命令行含 dsh 且名字像宿主**的那个
 *
 * ★ ③ 故意不做"猜一个默认端口"：猜错会**杀错进程**，而那是不可逆的。
 *   找不到就报"找不到"，让人给 `--port`。
 *
 * 用法:
 *   node scripts/restart-host.mjs                 # 干跑：只说它找到了谁
 *   node scripts/restart-host.mjs --port 19387    # 指定端口
 *   node scripts/restart-host.mjs --kill          # 真的杀（先 SIGTERM）
 *   node scripts/restart-host.mjs --kill --force  # 5 秒不退则 SIGKILL
 */

import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const kill = args.includes('--kill')
const force = args.includes('--force')
const portArg = (() => {
  const i = args.indexOf('--port')
  return i >= 0 ? args[i + 1] : process.env.DSH_PORT
})()

/** 跑一条命令并取回 stdout（失败 ⇒ 空串；调用方自己判"空"是什么意思）。 */
function run(cmd, cmdArgs) {
  try {
    return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return ''
  }
}

/**
 * ── 端口 ⇒ { pid, command } ───────────────────────────────────────────────────
 *
 * ★ 只认 LISTEN。ESTABLISHED 那一堆是浏览器/渲染进程连上来的连接，
 *   它们**也有**这个端口号，但持有者不是宿主 ⇒ 只看 LISTEN 才是那个"服务提供者"。
 */
function listenerOn(port) {
  const out = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
  const lines = out.split('\n').filter((l) => l.trim() !== '')
  if (lines.length < 2) return undefined
  // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
  const first = lines[1].split(/\s+/)
  const pid = Number(first[1])
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  return { pid, command: first[0], raw: lines.slice(1).join('\n') }
}

/** 本机所有 LISTEN 的端口号（去重、升序）。 */
function listeningPorts() {
  const out = run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'])
  const ports = new Set()
  for (const line of out.split('\n')) {
    const m = line.match(/:(\d+)\s*\(LISTEN\)\s*$/)
    if (m) ports.add(Number(m[1]))
  }
  return [...ports].sort((a, b) => a - b)
}

/**
 * ── 自动探测：哪个 LISTEN 端口属于 dsh 宿主 ────────────────────────────────────
 *
 * ★ 判据是**两条一起**，缺一不可（宁可找不到，也不杀错）：
 *   ① 持有者的命令名或 argv 里含 `dsh` / `DeepSeek`（本机实测名字是 `DeepSeek`）
 *   ② 该端口的名字是 127.0.0.1:<port>（本机形态）
 *
 * ★ 为什么允许"名字不含关键字"时**不猜**：本机实测 `pgrep` 看不到它，
 *   说明本沙箱对进程信息的可见性是**部分**的 —— 那么"读不到名字"这件事
 *   既可能是"它不叫这个名字"，也可能是"我读不到"。
 *   ⇒ 两者不同形，而本脚本在分不清时选择**不动手**。
 */
function probe() {
  const found = []
  for (const port of listeningPorts()) {
    const who = listenerOn(port)
    if (who === undefined) continue
    // 拿到完整命令行为好：名字可能被截断成 8 字符（lsof 的 COMMAND 列）
    const full = run('lsof', ['-nP', `-p`, String(who.pid)]).split('\n')[0]?.split(/\s+/)[0] ?? ''
    const blob = `${who.command} ${full}`.toLowerCase()
    if (!/deepseek|dsh/.test(blob)) continue
    found.push({ port, pid: who.pid, command: who.command, blob })
  }
  return found
}

console.log('── 重启宿主 ──────────────────────────────────────────────')

let target
if (portArg !== undefined && portArg !== '') {
  const port = Number(portArg)
  const who = listenerOn(port)
  if (who === undefined) {
    console.error(`★ 端口 ${port} 上没有 LISTEN 的进程。`)
    console.error('  ⇒ 宿主可能已经退出（那就不必重启了），或者端口不对。')
    console.error('  查:  lsof -nP -iTCP -sTCP:LISTEN | grep -iE "deepseek|dsh"')
    process.exit(2)
  }
  target = { port, ...who }
  console.log(`  端口来源          ${args.includes('--port') ? '--port 参数' : 'DSH_PORT 环境变量'}`)
} else {
  const found = probe()
  console.log(`  端口来源          自动探测（扫了本机 LISTEN 端口）`)
  if (found.length === 0) {
    console.error()
    console.error('★ 没有探测到 dsh 宿主的 LISTEN 端口 —— 本脚本【不猜】，因此不动手。')
    console.error('  ⇒ 请显式指定:  node scripts/restart-host.mjs --port <数字>  --kill')
    console.error('  查端口:        lsof -nP -iTCP -sTCP:LISTEN | grep -iE "deepseek|dsh"')
    process.exit(2)
  }
  if (found.length > 1) {
    console.error()
    console.error(`★ 探测到 ${found.length} 个候选 ⇒ 本脚本【拒绝猜】杀哪一个：`)
    for (const f of found) console.error(`     port ${f.port}  pid ${f.pid}  (${f.command})`)
    console.error('  ⇒ 请用 --port <数字> 指定。')
    process.exit(3)
  }
  target = found[0]
}

console.log(`  宿主 PID          ${target.pid}`)
console.log(`  进程名            ${target.command}`)
console.log(`  持有端口          ${target.port}  (LISTEN)`)
console.log()

if (!kill) {
  console.log('── 干跑（没有杀任何进程）────────────────────────────────')
  console.log(`  ⇒ 真要杀掉它:  node scripts/restart-host.mjs --port ${target.port} --kill`)
  console.log()
  console.log('  ★ 杀掉之后：这个 GUI 会断开。重新打开 DeepSeek Harness 即可。')
  console.log('    重启后确认 HMR 开着:  node scripts/enable-hmr.mjs --check')
  process.exit(0)
}

/** 先 SIGTERM，给它机会自己收尾（写状态、关 session.lock）。 */
try {
  process.kill(target.pid, 'SIGTERM')
  console.log(`  ★ 已发送 SIGTERM  ${target.pid}`)
} catch (error) {
  console.error(`★ 发不出 SIGTERM：${error?.message ?? String(error)}`)
  console.error('  错误码可能是 EPERM（权限/沙箱）或 ESRCH（进程已不在）。')
  console.error('  ⇒ 若为 EPERM：在你自己的终端里跑本命令，或直接 `kill -TERM ' + target.pid + '`。')
  process.exit(4)
}

/**
 * ── 等它真的退出 ──────────────────────────────────────────────────────────────
 *
 * ★ 判据是**端口不再被 LISTEN**，而不是"进程还在不在"：
 *   进程可能变成僵尸、或名字读不到（本机 `pgrep` 就看不到它）
 *   ⇒ 用端口才是那个"它还接不接受连接"的**可观测**事实。
 */
const deadline = Date.now() + 5000
let gone = false
while (Date.now() < deadline) {
  if (listenerOn(target.port) === undefined) { gone = true; break }
  try { execFileSync('sleep', ['0.25']) } catch { /* ignore */ }
}

if (!gone) {
  console.log(`  ★ ${target.port} 仍被监听（5 秒内没退出）`)
  if (!force) {
    console.log('  ⇒ 若它确实是宿主:  再跑一次并加 --force')
    process.exit(5)
  }
  try {
    console.log('  ★ 即将使用 SIGKILL：它不给进程任何收尾机会（不写状态、不关 session.lock）')
    process.kill(target.pid, 'SIGKILL')
    console.log(`  ★ 已发送 SIGKILL  ${target.pid}`)
    console.log('  ⚠ SIGKILL-UNGRACEFUL: SIGKILL 不给进程任何收尾机会（不写状态、不关 session.lock），')
    console.log('    未落盘的状态可能被留在原地。下次请先只发 SIGTERM（即不加 --force）等它自己退。')
  } catch (error) {
    console.error(`★ SIGKILL 也失败：${error?.message ?? String(error)}`)
    process.exit(4)
  }
}

console.log()
console.log('── 宿主已退出 ────────────────────────────────────────────')
console.log(`  ★ ${target.port} 已不再被监听`)
console.log()
console.log('  下一步:')
console.log('    ① 重新打开 DeepSeek Harness')
console.log('    ② 确认 HMR 开着:      node scripts/enable-hmr.mjs --check')
console.log('    ③ 验证重载生效:       改一个字符串 → pnpm build → 看宿主日志')
console.log()
console.log('  ★ 模型看不到重载（dsh-hmr 文档: "ctx.hmr adds no model-facing')
console.log('    tools or messages."）⇒ 验证只能靠日志，没有捷径。')
