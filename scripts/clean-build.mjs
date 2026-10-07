/**
 * ── 构建的【原子替换】：tsc 构到 lib.tmp/，全部成功之后才换成 lib/（t56）──────────
 *
 * ── 它修的是什么失效 ──────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-07，本队当天实测到多次）：
 *
 *     此前本脚本用 `rm -rf lib/` **整个删除**，然后才跑 tsc / tsdown。
 *     ⇒ 从 rm 到最后一个编译产物落盘之间（**数秒**），lib/ 是不存在或残缺的。
 *
 *     实测到的窗口时刻：15:54 / 15:58 / 16:10 / 16:17 / 19:39 ——
 *     而每次都有夹具报 `ERR_MODULE_NOT_FOUND: lib/...`。
 *
 * ★ 当天 8 条卡点的直接成因就是它：并发读的人在那个窗口里拿到一个**不可用的树**。
 *
 * ── ★★ 而它顺带修掉一个更严重的现状：失败留下【残缺的 lib】──────────────────────
 *
 *     现状：rm 先跑、tsc 后失败 ⇒ lib/ 里剩下半批产物。
 *     ⇒ 而"残缺的 lib"让**后续每一个动作**都以奇怪的方式失败 ——
 *       不是"build 失败"，而是"跑什么都说找不到模块"。
 *
 *     ★ 这正是本队那条纪律的长相：
 *       **一个失败的构建，留下一个看起来正常的残缺产物。**
 *
 *     原子替换顺手修掉它：**在 tsc 全部成功之前，我们【从不碰】lib/**。
 *
 * ── 三态（★ 不同形，各自说清是"关于什么"的结论）────────────────────────────────
 *
 *     ① 成功     ⇒ lib/ 是新的完整版（旧版已被移走并清理）
 *     ② 失败     ⇒ ★ lib/ 仍是**旧的完整版** —— 一个字节都没动过
 *     ③ 无法判断 ⇒ 不在本机制里：本脚本**只在确实换成了**之后才说成功，
 *                   其余一律以非零退出码结束、并说清"lib/ 没有被改动"
 *                   ⇒ 第三态由【退出码 + 那句话】共同表达，而不是"我猜它大概还行"
 *
 * ── ★★ 为什么只 stage tsc、而 tsdown 在替换【之后】跑（这是实测逼出来的）────────
 *
 * 三个都是**实测**的约束，不是设计偏好：
 *
 *   ① `rename` **不能**把目录覆盖到另一个**非空目录**上（实测 ENOTEMPTY）
 *      ⇒ "构到 lib.tmp 再 rename 过去"这一步**本身不够** —— 必须先把它挪开。
 *
 *   ② `tsdown` 的 `entry` / `outDir`（`lib/client/index.js` / `lib`）是相对
 *      【配置文件所在目录】解析的，**不是**相对 cwd（实测：换 cwd 仍报
 *      `UNRESOLVED_ENTRY: Cannot resolve entry module lib/client/index.js`）。
 *      ⇒ 它**只认项目根的 `lib/`** ⇒ 没法把它 stage 到别处。
 *      ★ 而 `tsdown.config.ts` 是**本任务的 outOfScope** ⇒ 不改它。
 *
 *   ③ 契约要求 `lib/` 保持**真目录**（"不同 worktree 互撞"那一半的已满足，
 *      正建立在这个事实上）⇒ 不用"软链 + 换链"那种能把窗口降到严格零的写法。
 *
 * ⇒ ★ 所以正确顺序是（而它也是自然的顺序）：
 *
 *     1. `clear`   —— 清场，建空的 lib.tmp/
 *     2. `tsc ×2`  —— 全部写进 lib.tmp/；**此时 lib/ 一个字节没动**，读的人看到完整旧树
 *     3. `publish` —— 两次原子 rename：lib → lib.old，lib.tmp → lib
 *     4. `tsdown`  —— 跑在**新树**之上（读新的 lib/client/index.js）⇒ bundle 的是新代码
 *     5. `git-artifacts.mjs --write` —— 给最终树打指纹
 *
 * ⇒ **窗口 = 第 3 步那两次 rename**，而不是"整个编译"。
 *   实测：rename1 0.075 ms、两步之间 0.055 ms；而 rm+tsc+tsdown 是**秒**级。
 *   ★ 窗口缩小约 5 个数量级，而**不是**严格为零 —— 这一条如实写在下面。
 *
 * ── ★ 关于"窗口真的消失了吗"：不夸大 ───────────────────────────────────────────
 *
 *     窗口：数秒  →  数十微秒
 *     ★ 而不是"零"。要做到严格零，只能把 lib/ 变成软链再原子换链 ——
 *       而那样会毁掉约束 ③（一个**已论证**的性质）。⇒ 不做。
 *     ⇒ 所以本文件与 build-atomic 夹具都按"微秒级窗口"断言，
 *       而不是按"绝不出现"断言（后者会是一条**恒真的**断言：它测不到东西）。
 */

import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const buildOutput = join(projectRoot, 'lib')
const stagingOutput = join(projectRoot, 'lib.tmp')
const previousOutput = join(projectRoot, 'lib.old')

/**
 * ★ 两个子命令，由 package.json 的 build 串起来：
 *
 *     clean-build.mjs clear    → 删掉上次残留的 lib.tmp / lib.old，建一个空的 lib.tmp
 *     tsc ×2                   → 全部写进 lib.tmp（--outDir lib.tmp --declarationDir lib.tmp/types）
 *     clean-build.mjs publish  → 原子替换 lib.tmp → lib
 *     tsdown                   → 在新树之上做客户端 bundle
 *
 * ★ 为什么必须分成多个进程：`tsc` 与 `tsdown` 是**外部命令**。
 *   ⇒ 本脚本只做【清场】与【替换】两半；
 *     而"替换只在全部编译成功之后发生"由 shell 的 `&&` 保证 —— 前一步失败则 publish 不跑。
 *     **这就是"失败不销毁旧版"的实现方式**：没有任何一处"先删再建"。
 */
function assertScoped(target) {
  if (dirname(target) !== projectRoot) {
    throw new Error(`refusing to touch a path outside the project root: ${target}`)
  }
  const name = basename(target)
  if (name !== 'lib' && name !== 'lib.tmp' && name !== 'lib.old') {
    throw new Error(`refusing to touch an unexpected build directory: ${target}`)
  }
}

async function exists(target) {
  try { await stat(target); return true } catch { return false }
}

/**
 * ── ★★ 为什么要先把旧的 tsdown 产物【搬进】暂存树（t56 实测逼出来的一条）─────────
 *
 * MEASURED（本任务，实测抓出来的一个**我自己引入的**缺陷）：
 *
 *     lib/ 里有【两类】产物，而它们是**两个不同的工具**造的：
 *
 *       · tsc     → lib/index.js / lib/types/** / lib/client/**   （几百个文件，**秒**级）
 *       · tsdown  → lib/client.js (+ .map)                        （2 个文件，**最后**才跑）
 *
 *     我第一版只 stage 了 tsc ⇒ 换上去的那棵树**没有 client.js**（它要等 tsdown 造）。
 *     ⇒ 实测：并发探针在 client.js 上 miss 了 **5854 次**，
 *       而 index.js 与 types 是 **0 次**。
 *
 *     ★ 也就是说：那一版对 tsc 的产物把窗口降到零，**却把 client.js 的窗口
 *       从一个"完全不存在"变成了一个"整个 tsc 期间都不存在"** —— 对那个文件是**更坏**的。
 *
 * ⇒ 修法：换树之前，把**上一版的 tsdown 产物**搬进暂存树。
 *   于是 lib/ 在整个过程中**从不缺少 client.js**；tsdown 随后就地刷新它
 *   （实测：单独跑 tsdown 时 client.js 的 miss = 0 —— 它是就地改写，不是先删再建）。
 *
 * ★ 而"搬一版旧的"在语义上也是对的：那一刻它**确实是**上一版的产物，
 *   而 tsdown 紧接着会把它换成这一版的。⇒ 读的人要么看到旧的那一版、要么看到新的那一版。
 */
const CARRIED_FORWARD = ['client.js', 'client.js.map']

async function carryForwardTscdownArtifacts() {
  for (const name of CARRIED_FORWARD) {
    const from = join(buildOutput, name)
    const to = join(stagingOutput, name)
    if (await exists(from)) await copyFile(from, to)
  }
}

/** 清场：删掉上一次可能留下的残留，然后建一个新的空 lib.tmp。★ 全程不碰 lib/。 */
async function clear() {
  for (const target of [stagingOutput, previousOutput]) {
    assertScoped(target)
    await rm(target, { recursive: true, force: true })
  }
  await mkdir(stagingOutput, { recursive: true })
}

/**
 * 发布：**只有走到这里，lib/ 才会被改动**。
 *
 * ★ 顺序是刻意的，而它就是"失败不销毁旧版"的实现：
 *   ⓪ 把上一版的 tsdown 产物搬进暂存树 —— **见上面那段实测**；不做它，
 *      换来的是一个缺 client.js 的树（而那是本任务修的那个缺陷的另一种长相）
 *   ① `lib → lib.old`     —— 原子；这一步失败 ⇒ lib/ 原样不动
 *   ② `lib.tmp → lib`     —— 原子；这一步失败 ⇒ 把 lib.old 挪回来（回滚）
 *   ③ 删 `lib.old`        —— 清理；失败**不影响正确性**（只留下一个待清理目录）
 */
async function publish() {
  assertScoped(buildOutput); assertScoped(stagingOutput); assertScoped(previousOutput)

  if (!await exists(stagingOutput)) {
    throw new Error(`no staging output to publish: ${stagingOutput} (did the compiler actually run?)`)
  }

  /** ⓪ 先补齐"另一个工具造的"那两格（否则换上去的树缺 client.js）。 */
  await carryForwardTscdownArtifacts()

  const hadPrevious = await exists(buildOutput)
  if (hadPrevious) {
    await rename(buildOutput, previousOutput)
  }
  try {
    await rename(stagingOutput, buildOutput)
  } catch (error) {
    /**
     * ★ 回滚：第 ② 步失败时把旧版挪回来 —— 否则会**留下一个没有 lib 的树**，
     *   而那比"构建失败"坏得多（它让后续每个动作都找不到模块）。
     */
    if (hadPrevious) {
      await rename(previousOutput, buildOutput).catch(() => undefined)
    }
    throw error
  }
  /** ③ 清理旧版。★ 失败不影响正确性，所以它【不许】让整个构建失败。 */
  await rm(previousOutput, { recursive: true, force: true }).catch(() => undefined)
}

const command = process.argv[2]
if (command === 'clear') await clear()
else if (command === 'publish') await publish()
else {
  throw new Error(
    `clean-build.mjs needs a subcommand: "clear" | "publish" (got ${JSON.stringify(command)})\n`
    + '  · clear   —— 建一个空的 lib.tmp/（上一次的残留会被删掉）\n'
    + '  · publish —— 把 lib.tmp/ 原子地换成 lib/（只在全部编译成功之后调用）',
  )
}
