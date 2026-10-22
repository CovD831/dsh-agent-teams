/**
 * ── ★★★ 两条**已配好登录态**的渠道：X 与 B 站（判据，2026-10-22）────────────────────
 *
 * ── 为什么需要这个文件 ──────────────────────────────────────────────────────────
 *
 * 这两个渠道在本轮之前**都不可用**，而两次的症状**同形**：
 * ```
 * X        `twitter search …`      ⇒ HTTP 404（不是 401、不是 429）
 * B 站     `agent-reach configure` ⇒ "No cookies found"
 * ```
 * ★★ 而真因都不在"没装"或"没登录"上：
 *
 * ```
 * X     twitter-cli 已装、cookie 也已从 Edge 读出，但每次调用都 404。
 *       ⇒ 真因：`x-client-transaction` 初始化失败。它要 x.com 首页里那段
 *         `ondemand.s.<hash>a.js` 的指纹，而**未登录的首页是登录墙、没有那段**。
 *       ⇒ 修法：带 cookie 取 `/home`，把 home_html + ondemand 写进
 *         `~/.twitter-cli/transaction_cache.json`（twitter-cli 自己会读它）。
 *       ★ 我先怀疑的是 queryId 过期，改了常量 —— **改了没用**，已回退。
 *         这条弯路正是"症状同形"的代价，所以它要进判据。
 *
 * B站   `agent-reach configure --from-browser edge` 报 "No cookies found"。
 *       ⇒ 真因：Edge **开着**时它的 Cookies 库被锁/未落盘；而
 *         `browser_cookie3` 直接读活库会 `Unable to get key for cookie decryption`。
 *       ⇒ 修法：先 `cp` 一份到临时目录再解，解出来写进 bili-cli 的 credential.json。
 * ```
 *
 * ── 判据的形状（★ 本机没有视觉模型，也**不联网**）────────────────────────────────
 *
 * ```
 * 臂 1  wrapper 有三条子命令，且**凭据不进 argv**（只进子进程环境）
 * 臂 2  ★ 反向半边：wrapper 不再把 `doctor` 偷偷换成 `install`（那会改机器状态）
 * 臂 3  ★★ 凭据目录**在 .gitignore 里**（它含 X 的 auth_token / B 站 SESSDATA）
 * 臂 4  ★★ 两个渠道的"修法"写进了文档（否则下一个人会重走 404 那条路）
 * ```
 * ★ 判据**不跑真实搜索**：那需要网络与登录态，且结果每天都在变。
 *   它只钉住"接得对不对"与"凭据收没收到"。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WRAPPER = readFileSync(join(ROOT, 'scripts', 'agent-reach.mjs'), 'utf8')
const GITIGNORE = readFileSync(join(ROOT, '.gitignore'), 'utf8')
const DOC = readFileSync(join(ROOT, 'docs', 'TOOLING-INTERNET.md'), 'utf8')

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：三条子命令都在，且凭据只经**环境**传递
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 1：wrapper 暴露 x / bili 两条子命令，且凭据走 env 不走 argv', () => {
  assert.match(WRAPPER, /command === 'x'/, '缺 `x` 子命令 —— X 搜索就没有可复跑的入口')
  assert.match(WRAPPER, /command === 'bili'/, '缺 `bili` 子命令 —— B 站搜索就没有可复跑的入口')

  /**
   * ★★ 凭据**不许出现在 execFileSync 的 args 里**：`ps` 能看到命令行。
   *   它只该出现在 `childEnv()` 返回的对象上。
   */
  assert.match(WRAPPER, /env\.TWITTER_AUTH_TOKEN = authToken/, '凭据必须经子进程环境注入')
  assert.match(WRAPPER, /env\.TWITTER_CT0 = ct0/, '凭据必须经子进程环境注入')
  const argvWithCredential = /execFileSync\([^)]*TWITTER_AUTH_TOKEN/.test(WRAPPER)
  assert.equal(argvWithCredential, false, '★★ 凭据不许进 argv（`ps` 会看见）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★ 反向半边 —— doctor 只读
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 2（反向半边）：`doctor` 是**只读**的，不许偷偷跑 `install`', () => {
  /**
   * MEASURED（修之前）：wrapper 的 `doctor` 分支调的是 `agent-reach install --env=auto`。
   * ⇒ 一条**叫 doctor 的只读命令**在改机器状态（装依赖、写配置）。
   *   这与本仓 §4「两件不同的事不许同形」直接冲突：体检 ≠ 治疗。
   */
  const doctorBlock = WRAPPER.slice(WRAPPER.indexOf("command === 'doctor'"), WRAPPER.indexOf("command === 'x'"))
  assert.ok(doctorBlock.length > 0, '找不到 doctor 分支')
  assert.equal(
    /install/.test(doctorBlock),
    false,
    '★★ `doctor` 分支里出现了 `install` —— 只读命令不许改机器状态',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★★★ 凭据目录必须被 gitignore（这条是**事后补的**，所以要钉住）
// ─────────────────────────────────────────────────────────────────────────────
test('★★★ 臂 3：`.agent-reach-home/` 在 .gitignore 里（它含登录凭据）', () => {
  /**
   * MEASURED（本轮的顺序错误）：先 `mkdir .agent-reach-home`、把 X 的 auth_token
   * 与 B 站的 SESSDATA 写进去，**之后**才想到 gitignore。
   * 中间那一段 `git status --short` 已经把它报成 `?? .agent-reach-home/`
   * ⇒ 一次 `git add -A` 就会把登录态提交进仓库。
   * ★ 这条臂的存在意义就是：**下一个人不必再想一次**。
   */
  const line = GITIGNORE.split('\n').find((entry) => entry.trim() === '.agent-reach-home/')
  assert.ok(line !== undefined, '★★★ .gitignore 里缺 `.agent-reach-home/` —— 那是登录凭据目录')
  assert.match(
    GITIGNORE,
    /含凭据|绝不许进仓/,
    '★ 那一条要写明**为什么**（含凭据），否则下一轮会被当成"没用的临时目录"删掉',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★ 两条修法写进文档（否则下一个人重走 404）
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 4：X 的 transaction 缓存与 B 站的"先 cp 再解"都写进了文档', () => {
  /**
   * ★★ 判据只钉**关键词**，不钉整段文字 —— 文档措辞会改，而"这条弯路记过没有"
   *   是一个不会改的事实。
   */
  assert.match(DOC, /transaction_cache|ClientTransaction/, '★★ 文档缺 X 的 transaction 缓存修法')
  assert.match(DOC, /browser-cookie3|browser_cookie3/, '★★ 文档缺 B 站 cookie 解不出来的真因')
  assert.match(DOC, /agent-reach\.mjs x|agent-reach\.mjs bili/, '★ 文档缺两条新命令的用法')
})
