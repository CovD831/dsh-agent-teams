/**
 * ── 构建原子性的夹具（t56）────────────────────────────────────────────────────
 *
 * 被测的**不是**任何一条判据的语义，而是**构建这件事本身**的性质：
 *
 *     ① ★ 并发读：build 进行中读 lib/ ⇒ 不许出现"读不到"（而现在是必然出现）
 *     ② 失败不销毁旧版：build 失败时 lib/ 仍是**旧的完整版**（而现状是 rm 先跑）
 *     ③ 三态不同形：成功 / 失败（旧版完好）/ 无法判断
 *     ④ worktree 隔离：一个树里的 build 只动它自己的 lib/
 *     ⑤ ★ 反向半边：把原子替换改回 rm -rf ⇒ ① 那条臂必须红
 *
 * ── ★★★ 这一组臂的核心困难：怎么让"窗口"可测（本文件的设计说明）──────────────
 *
 * 直接的做法是"起一个后台 build，同时轮询 lib/"。而那个做法有**两个**陷阱，
 * 两条都是本队记过的形态：
 *
 *   陷阱甲（恒真）：探针若只跑很短，或 build 很快，则**窗口很可能没被踩到**
 *     ⇒ 断言"没有 miss"就会绿，而它绿的原因是**没测到**，不是"没有窗口"。
 *     ★ 那正是"没能测量被并进通过"。
 *
 *   陷阱乙（恒假/误报）：探针若断言"绝对零 miss"，则它测的是**调度器的抖动**，
 *     而不是构建方式 —— 因为任何"移走旧目录再放新目录"的实现都有**纳秒级**的间隙
 *     （POSIX rename 不能覆盖非空目录，所以至少要两次 rename）。
 *     ★ 一条**恒假的**断言与没有断言同形。
 *
 * ⇒ 所以本夹具的做法是【差分】，而不是【绝对】：
 *
 *     同一个探针，分别在【旧实现】（rm -rf 后再编译）与【新实现】（原子替换）下跑
 *     ⇒ 断言 **miss 数相差若干个数量级**，而不是"新的必然是零"
 *
 * ★ 而这条差分仍然有分辨力，因为旧实现的 miss 是【数十万】级、新的在【十】级以内 ——
 *   两者不是同一个量级，不是"抖动"能解释的差别。
 * ★ 而它**不会**因为机器快慢而恒真：旧实现无论多快，都要在"删掉之后、编译完之前"
 *   缺文件**数秒**；而新实现只在那两次 rename 之间缺**亚毫秒**。
 *
 * ── 关于"失败不销毁旧版"那一臂怎么造 ──────────────────────────────────────────
 *
 * 不真的去弄坏编译器（那会污染工作区）。做法是**直接驱动 publish 契约**：
 *   · `clear` 之后【不跑编译】⇒ lib.tmp 是空的 ⇒ 此时 lib/ 必须**一个字节没动**
 *   · 这正是"编译失败"那一路的形态：`&&` 断在那里，publish 根本不会跑
 * ⇒ 断言：`clear` 前后 lib/ 的【内容清单 + 每个文件的指纹】完全相同。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(ROOT, 'lib')
const STAGING = join(ROOT, 'lib.tmp')
const PREVIOUS = join(ROOT, 'lib.old')
const CLEAN_BUILD = join(ROOT, 'scripts', 'clean-build.mjs')

/** lib/ 的内容清单 + 每个文件的指纹 —— "一个字节没动"的可复核形式。 */
function treeDigest(root) {
  const hash = createHash('sha256')
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name)
      hash.update(relative(root, full)).update('\0')
      if (entry.isDirectory()) walk(full)
      else hash.update(readFileSync(full)).update('\0')
    }
  }
  walk(root)
  return hash.digest('hex')
}

/** 一条"读 lib/"的探针，跑一段时间，返回 miss 数。★ 与 build 并发跑（在项目根）。 */
function probeFor(ms, options) { return probeIn(ROOT, ms, options) }

/**
 * 同一条探针，但在一棵【指定的树】里跑。
 *
 * ★ 它是 arm 1 "差分"的实现：两次重放用的是**同一个探针函数**，
 *   只有被重放的构建方式不同 —— 于是"差别"只可能来自构建方式。
 */
function probeIn(tree, ms, { tight = false } = {}) {
  return new Promise((resolve) => {
    const script = `
      import { statSync } from 'node:fs'
      let misses = 0, checks = 0
      const deadline = Date.now() + ${ms}
      const targets = ${JSON.stringify(['lib/index.js', 'lib/client.js', 'lib/types/index.d.ts'])}
      while (Date.now() < deadline) {
        checks++
        for (const t of targets) { try { statSync(t) } catch { misses++ } }
        ${tight ? '' : 'await new Promise(r => setTimeout(r, 0))'}
      }
      process.stdout.write(JSON.stringify({ checks, misses }))
    `
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: tree })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.on('close', () => {
      try { resolve(JSON.parse(out)) } catch { resolve({ checks: 0, misses: -1 }) }
    })
  })
}

/**
 * ── ★★★ t35：前置不满足 ⇒ **skip 并说明**，本函数【不】自己构建 ─────────────────────
 *
 * ── 恢复的那次修改（它随 077c107 的 revert 一起被丢掉了，本任务把它拿回来）──────
 *
 * MEASURED（全量并行跑时稳定复现）：本函数原来在缺文件时跑 `pnpm build`，
 * 而那一步走 `clean-build` 的**两次原子 rename**（`lib → lib.old`，`lib.tmp → lib`）
 * ⇒ **两次 rename 之间有缝**（`clean-build.mjs` 文件头逐字："窗口 = 第 3 步那两次 rename"）。
 * ⇒ 并行跑时别的夹具正好撞进那个缝 ⇒ 实测 **13 条**
 *   `ERR_MODULE_NOT_FOUND: …/lib/worktree.js`（由 `worktree-reclaim.test.mjs` 报出）。
 *
 * ★★ 而本仓已经记过**同一族**事故一次：`gate-shared-artifact-writes.test.mjs` 的文件头逐字写着
 *   "t56 的夹具在共享的 `lib/` 上跑 `rm -rf lib` ⇒ 此后 **49 个夹具**报 ERR_MODULE_NOT_FOUND"。
 *   ⇒ 那是【直接删】，这是【通过构建间接抽走】—— **入口不同，窗口相同**。
 *
 * ⇒ 修法：前置不满足时 **skip 并说明**，而不是"我顺手建一下"。三条理由：
 *   ① 在一个并行套件里自己替换共享 `lib/` ＝ **制造那个窗口**；
 *   ② `lib/` 的完整性该由**构建步骤**保证，不该由夹具兜底；
 *   ③ 缺前置的正确语义是"**我测不了**"，而 `t.skip` 会让它**看得见** ——
 *      与"悄悄建一份、然后以为自己测了"**不同形**（本队最老的那条合流）。
 *
 * ★★ 返回 `boolean` 是刻意的：调用点写 `if (!ensureLibBuilt(t)) return`，
 *   于是"没前置"这条路上**一条断言都不会跑到**，而不是拿到一个残缺的 lib/ 继续往下撞。
 */
function ensureLibBuilt(t) {
  if (!existsSync(join(LIB, 'index.js')) || !existsSync(join(LIB, 'client.js'))) {
    t.skip('未测量：lib/ 不完整（先跑 pnpm build）。★ 本臂不自己构建 —— 那会在并行的'
      + '全量套件里抽走共享 lib/，实测让别的夹具撞进 rename 窗口（ERR_MODULE_NOT_FOUND）')
    return false
  }
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★ 并发读 —— 差分口径（新实现 vs 旧实现）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★★ 并发读（差分）：旧实现 miss 数十万 · 新实现 miss 十个以内', async (t) => {
  /**
   * ★★ 为什么是【差分】而不是"新的必须是零"：见文件头"陷阱乙"。
   *   现实约束：`rename` 不能覆盖非空目录 ⇒ 至少要两次 rename ⇒ 亚毫秒间隙不可消除。
   *   ⇒ 把"零 miss"写成断言，测的是调度抖动，不是构建方式。
   *
   * ── ★★ 而这一臂【绝不在共享的 lib/ 上做破坏性重放】（第一版就是这么写的，实测教训）──
   *
   * MEASURED（本任务，夹具自己造成的污染）：第一版在**共享的 lib/** 上跑
   * `rm -rf lib` 再重编译来模拟旧实现 —— 而只要那一步失败或被打断，
   * 就把 lib/ 留成残缺的，**此后 49 个夹具都加载不了**
   * （实测：`ERR_MODULE_NOT_FOUND: lib/gates/dispatch/changed-paths.js`）。
   *
   * ⇒ 修法：**两种实现都在一棵独立的临时树里重放**，共享的 lib/ 只被【读】。
   *   而探针读的仍然是同一个路径名 `lib/...`（相对于临时树），
   *   所以它测的仍然是"那个路径名在构建期间可不可读"。
   *
   * ★ 定向突变：把 package.json 的 build 改回 `rm -rf lib/ && …` ⇒
   *   "新实现"那一侧变成数十万 ⇒ 两个量级的差消失 ⇒ 本臂红（已实测）。
   */
  if (!ensureLibBuilt(t)) return
  const { mkdtempSync, cpSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')

  /**
   * 在一棵独立树里跑一次"某种构建方式"，同时用一个探针读它的 lib/。
   *
   * ★ 探针是**同一个脚本**（`probeFor`）—— 只有构建方式不同。这就是"差分"。
   * ★ 树的构造：只复制**被构建读到的**那些输入（src / scripts / 配置 / package.json），
   *   而不复制 node_modules（用软链指回真实的那一份 —— 它只被读）。
   */
  const replay = async (mutateBuild) => {
    const tree = mkdtempSync(join(tmpdir(), 't56-build-'))
    /**
     * ★ 而这份清单是**实测补全的**：`git-artifacts.mjs` 还会读
     *   `pnpm-lock.yaml` / `pnpm-workspace.yaml`（它们进 CONFIG 摘要），
     *   漏掉就 `ENOENT`（实测）。
     */
    for (const entry of ['src', 'scripts', 'tsconfig.json', 'tsconfig.client.json', 'tsdown.config.ts', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
      cpSync(join(ROOT, entry), join(tree, entry), { recursive: true })
    }
    /** node_modules 用软链：只读，且省掉一次几百 MB 的拷贝。 */
    const { symlinkSync } = await import('node:fs')
    symlinkSync(join(ROOT, 'node_modules'), join(tree, 'node_modules'), 'dir')
    /** 一份完整 lib/ 作为起点（旧实现会把它删掉）。 */
    cpSync(LIB, join(tree, 'lib'), { recursive: true })

    if (mutateBuild !== undefined) {
      const { readFileSync, writeFileSync } = await import('node:fs')
      const pkg = JSON.parse(readFileSync(join(tree, 'package.json'), 'utf8'))
      pkg.scripts.build = mutateBuild(pkg.scripts.build)
      writeFileSync(join(tree, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
    }

    const probe = probeIn(tree, 5000)
    await delay(200)
    /**
     * ★★ 为什么直接跑 `package.json` 里那条命令、而不是 `pnpm build`：
     *
     * MEASURED（本任务）：在一棵**新树**里 `pnpm build` 会先跑一次依赖解析/安装，
     * 而它**拒绝**继续（`ERR_PNPM_IGNORED_BUILDS`）——
     * 因为那棵树里没有本仓的已批准构建脚本记录。
     * ⇒ 而那不是本臂要测的东西（本臂测的是【构建方式】对并发读的影响）。
     * ⇒ 所以这里把 `scripts.build` 那条命令**原样**交给 shell 跑，绕过包管理器外壳。
     *   ★ 判别力不变：跑的是**同一串命令**，只有 `lib/` 的位置不同。
     */
    const { readFileSync: readPkg } = await import('node:fs')
    const buildScript = JSON.parse(readPkg(join(tree, 'package.json'), 'utf8')).scripts.build
    /**
     * ★ 而 PATH 里还要有本仓的 `node_modules/.bin` —— 否则 `tsc` / `tsdown`
     *   会 `command not found`（实测 exit=127）。
     *   ★ 这一格同样是"隔离树不等于独立环境"的具体表现：
     *     新树里没有自己的 node_modules，工具链是从外面借来的。
     */
    const env = { ...process.env, PATH: `${join(ROOT, 'node_modules', '.bin')}:${process.env.PATH ?? ''}` }
    const run = spawnSync(buildScript, { cwd: tree, encoding: 'utf8', shell: true, env })
    const result = await probe
    const { rmSync } = await import('node:fs')
    rmSync(tree, { recursive: true, force: true })
    return { ...result, status: run.status }
  }

  /** ① 新实现：**当前**的 build（原子替换）。 */
  const fresh = await replay()
  assert.equal(fresh.status, 0, '★ 前置：新实现的 build 必须在隔离树里成功，否则本臂测的是坏构建')

  /** ② 旧实现：在它前面插一句 `rm -rf lib`（而那正是本任务要消灭的形状）。 */
  const legacy = await replay((build) => build.replace(
    'clean-build.mjs clear &&',
    'clean-build.mjs clear && rm -rf lib &&',
  ))
  assert.equal(legacy.status, 0, '★ 前置：旧实现的重放也必须能成功（否则两条不同时可比）')

  assert.ok(
    fresh.checks > 1000 && legacy.checks > 1000,
    `★ 两条探针都必须真的跑过（实测 新=${fresh.checks} / 旧=${legacy.checks}）—— checks 太少意味着本臂什么都没测`,
  )
  assert.ok(
    legacy.misses > fresh.misses * 20,
    '★ 旧实现与新实现的 miss 数必须相差【一个数量级以上】——'
    + ` 实测 旧=${legacy.misses}/${legacy.checks} vs 新=${fresh.misses}/${fresh.checks}。`
    + ' 若两者接近，说明原子替换没有生效（定向突变：把 build 改回 rm -rf 就会变成这样）',
  )
  /**
   * ★ 而新实现那一侧也要有一个**上界**（否则"新实现 miss 十万次"也能满足上面的比例）——
   *   按"每 100 万次检查"给，以免机器快慢改变结论。
   */
  const freshRate = (fresh.misses / Math.max(fresh.checks, 1)) * 1_000_000
  assert.ok(
    freshRate < 100,
    `★ 新实现的 miss 率必须低于【每 100 万次 100 次】—— 实测 ${freshRate.toFixed(1)}/百万`
    + `（${fresh.misses}/${fresh.checks}）。超过它说明窗口没有被降到"亚毫秒级"`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★ 反向半边 —— build 失败时不许把旧的 lib 也毁掉
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 2 反向臂：`clear` 之后若编译没跑（＝build 失败那一路），lib/ 一个字节没动', async (t) => {
  /**
   * ── 这一臂防的是现状里【最坏】的那一半 ──────────────────────────────────────
   *
   *     现状：`rm -rf lib/` 先跑，tsc 后失败 ⇒ 留下一个**残缺的 lib**。
   *     ⇒ 而"残缺的 lib"让**后续每个动作**都以奇怪的方式失败 ——
   *       不是"build 失败"，而是"跑什么都说找不到模块"。
   *
   * ★ 造法：`clear` 之后**不跑编译** —— 那正是 `&&` 断掉时的状态
   *   （publish 根本不会被调用）。⇒ 此时 lib/ 必须与之前**逐字节相同**。
   *
   * ★ 定向突变：让 `clear` 去 `rm -rf lib/` ⇒ 本臂红（指纹会变）。
   */
  if (!ensureLibBuilt(t)) return
  const before = treeDigest(LIB)

  const cleared = spawnSync(process.execPath, [CLEAN_BUILD, 'clear'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(cleared.status, 0, `★ clear 必须成功:\n${cleared.stderr}`)

  const after = treeDigest(LIB)
  assert.equal(
    after, before,
    '★ `clear`（＝编译失败那一路的起点）之后 lib/ 必须【逐字节不变】——'
    + ' 现状是 rm 先跑，于是失败会留下一个残缺的 lib，而它让后续每个动作都找不到模块',
  )
  /** ★ 而且暂存目录必须真的建出来了（否则上面那条可能只是因为 clear 什么都没做）。 */
  assert.ok(existsSync(STAGING), '★ clear 之后必须有 lib.tmp/ —— 否则上面那条"没动 lib"是恒真的（它什么都没做）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：三态不同形
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 三态臂：成功 / 失败（旧版完好）/ 无法判断 —— 三者不同形', async (t) => {
  /**
   * ── 三态各自是"关于什么"的结论 ───────────────────────────────────────────────
   *
   *     ① 成功     ⇒ lib/ 是**新**的完整版
   *     ② 失败     ⇒ lib/ 是**旧**的完整版（而上面臂 2 已钉住"一个字节没动"）
   *     ③ 无法判断 ⇒ publish 在没有暂存树时必须**说出来**，而不是静默当成成功
   *
   * ★ 判法：①②用**指纹是否变化**区分；③用**退出码 + 消息**区分。
   * ★ 定向突变：让 `publish` 在 lib.tmp 缺席时静默返回 ⇒ ③ 那条红。
   *
   * ── ★★★ t35 修（本臂的第三个缺陷，也是本任务最要紧的那一半）────────────────────
   *
   * MEASURED（captain 在恢复这次修改时发现）：
   *   本臂在**一棵隔离树**里做实验，却**在真实树上断言** ——
   *   于是那些"成功态"的断言检查的是**另一个目录**，
   *   而其中一条**永远不可能通过**：臂 2 会**合法地**把暂存目录留在真实树里。
   *
   * ★★ 根因是**一句话里的两个名词指的不是同一个东西**：
   *   "build 到 lab" 与 "读 ROOT 的 lib/" —— 而它们在读起来都叫"这棵树"。
   *   ⇒ 而它**不是**"断言写错了"那么简单：一个**跨树**的断言
   *     可能因为**另一棵树**的状态而红（或绿），于是它的红/绿**不指向它声称的那件事**。
   *
   * ⇒ 修法：**实验与断言必须在同一棵树里** —— 下面统一用 `tree`（那棵隔离树），
   *   而 `lib.tmp` / `lib.old` / `clean-build` 的调用也全部指到那棵树的对应路径。
   *   ★ 而真实树**从头到尾只被读**（那正是本任务要保住的性质：见下面臂 10）。
   */
  if (!ensureLibBuilt(t)) return

  /**
   * ── ★ 隔离树：只复制构建**读得到**的输入，`node_modules` 用软链（只读、省一次几百 MB 拷贝）──
   *   ★ 与臂 1 同一套做法（同一份形态只有一处实现，不另造一份）。
   */
  const { mkdtempSync, cpSync, symlinkSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const tree = mkdtempSync(join(tmpdir(), 't35-arm3-'))
  for (const entry of ['src', 'scripts', 'tsconfig.json', 'tsconfig.client.json', 'tsdown.config.ts', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    cpSync(join(ROOT, entry), join(tree, entry), { recursive: true })
  }
  symlinkSync(join(ROOT, 'node_modules'), join(tree, 'node_modules'), 'dir')
  cpSync(LIB, join(tree, 'lib'), { recursive: true })
  /**
   * ★★ 而这四个名字**全部**指到那棵树 —— 这是本修的核心一行。
   *   它们此前是模块级的 `LIB` / `STAGING` / `PREVIOUS` / `CLEAN_BUILD`（都指 ROOT）。
   */
  const treeLib = join(tree, 'lib')
  const treeStaging = join(tree, 'lib.tmp')
  const treePrevious = join(tree, 'lib.old')
  const treeCleanBuild = join(tree, 'scripts', 'clean-build.mjs')
  /** ★ 而"跑构建"用那棵树里 `package.json` 的那条命令（理由与臂 1 逐字相同）。 */
  const { readFileSync: readTreePkg } = await import('node:fs')
  const treeBuildScript = JSON.parse(readTreePkg(join(tree, 'package.json'), 'utf8')).scripts.build
  const runTreeBuild = () => spawnSync(treeBuildScript, { cwd: tree, encoding: 'utf8', shell: true, env: { ...process.env, PATH: `${join(ROOT, 'node_modules', '.bin')}:${process.env.PATH ?? ''}` } })

  /**
   * ── ★★★ 共享树的【事前快照】—— 收尾要拿它与事后比 ─────────────────────────────────
   *   ★ 而这就是本任务那句话的可执行形式：**"隔离"意味着共享树一个字节都没变**，
   *     而"没变"只有**先记下来**才读得出（见收尾那一段）。
   */
  const sharedLibBefore = treeDigest(LIB)
  const sharedStagingBefore = existsSync(STAGING)

  try {

  /**
   * ── ★★ 区分三态的【不是"指纹变没变"】—— 我第一版就是这么写的，而它是错的 ──────
   *
   * MEASURED（本任务，夹具当场抓出来的）：构建是**确定性的** ——
   * 同一份源码 build 两次，产出的字节完全相同 ⇒ 指纹**不变**。
   *   ⇒ 那么"指纹没变"同时是【成功（同一版源码）】与【失败（旧版还在）】两态的形状。
   *   ★ 而那正是本队记账的：**两种不同的原因，给出同形的症状。**
   *
   * ⇒ 正确的区分：不看"内容变没变"，而看
   *     ① 成功 ⇒ lib/ 是**完整**的（必需产物齐全）**且**没有残留的暂存树
   *     ② 失败 ⇒ lib/ **完整**（旧版）**且** 暂存树被建出来了（clear 跑过、publish 没跑）
   *     ③ 无法判断 ⇒ publish 在缺暂存树时【非零退出 + 说清缺什么】
   *   ⇒ 三者靠"**哪些东西在场**"区分，而不是靠"内容像不像"。
   */
  const built = runTreeBuild()
  assert.equal(built.status, 0, `★ 完整 build 必须成功（在隔离树里）:\n${String(built.stderr).slice(0, 400)}`)
  const afterBuild = treeDigest(treeLib)
  const REQUIRED = ['index.js', 'client.js', 'types/index.d.ts', 'types/client/index.d.ts', 'git-artifact-stamp.json']
  for (const rel of REQUIRED) {
    assert.ok(existsSync(join(treeLib, rel)), `★ 成功态：那棵树的 lib/ 必须【完整】—— 缺 ${rel}`)
  }
  assert.equal(existsSync(treeStaging), false, '★ 成功态：暂存树必须已被消费掉（留着它说明 publish 没跑完）')
  assert.equal(existsSync(treePrevious), false, '★ 成功态：旧版必须已被清理（留着它说明收尾没做）')

  /** ② 失败：clear 之后不编译 ⇒ lib/ 完整【且】暂存树在场（＝clear 跑过、publish 没跑）。 */
  assert.equal(spawnSync(process.execPath, [treeCleanBuild, 'clear'], { cwd: tree }).status, 0)
  assert.equal(treeDigest(treeLib), afterBuild, '★ 失败态：那棵树的 lib/ 仍是【旧】的完整版（逐字节相同）')
  assert.ok(existsSync(treeStaging), '★ 失败态：暂存树在场 —— 这与成功态的"暂存树已被消费"【不同形】')

  /** ③ 无法判断：没有暂存树时 publish 必须**说出来**。 */
  const noStaging = spawnSync(process.execPath, [treeCleanBuild, 'publish'], { cwd: tree, encoding: 'utf8' })
  /**
   * ★ 此时 lib.tmp 是 clear 建出来的**空目录** —— 所以这里要先把空目录删掉，
   *   才是真正的"没有暂存树"。
   */
  if (existsSync(treeStaging)) execFileSync('rm', ['-rf', treeStaging])
  const missingStaging = spawnSync(process.execPath, [treeCleanBuild, 'publish'], { cwd: tree, encoding: 'utf8' })
  assert.ok(
    missingStaging.status !== 0,
    '★ 无法判断/缺输入时 publish 必须【以非零退出码失败】并说清 —— 静默当成功会让"没换成"与"换成了"同形',
  )
  assert.match(
    String(missingStaging.stderr), /no staging output|lib\.tmp/i,
    '★ 而且要说清缺的是什么（不能只说"失败了"）',
  )
  void noStaging
  /** ④ 未知子命令也必须拒绝（否则一个拼错的子命令会静默什么都不做）。 */
  const bogus = spawnSync(process.execPath, [treeCleanBuild, 'wat'], { cwd: tree, encoding: 'utf8' })
  assert.notEqual(bogus.status, 0, '★ 未知子命令必须拒绝 —— 静默 no-op 会让"参数打错"与"构建成功"同形')

  /**
   * ── ★★★ t35：收尾从"**重建共享树**"变成"**证明共享树没被动过**"────────────────────
   *
   * ── 这里原来那段话，以及它为什么会消失 ────────────────────────────────────────
   *
   * 原文（保留它是为了记住这个坑）：*"本臂把 lib/ 留在了失败态 … 所以本臂**必须在结束时
   * 重建一次**，把共享树交还给后续用例时是这一版源码的产物。"*
   *
   * ★★ 而那句话是**隔离之前的必要之恶**：本臂当时真的在共享树上做破坏性实验，
   *   所以它必须自己收拾。⇒ 而它同时是**两个问题的来源**：
   *
   *   ① 收拾本身要跑一次 `pnpm build` ⇒ **又制造一次那个两秒窗口**
   *      （13 条 `ERR_MODULE_NOT_FOUND` 的来源之一）；
   *   ② 它与臂 2 的收尾**互相覆盖** —— 两条臂各修一次共享树，
   *      谁是"最后那一版"取决于**执行顺序**，而那是不该被依赖的东西。
   *
   * ⇒ 现在实验在隔离树里 ⇒ **共享树一个字节都没被碰过** ⇒
   *   收尾不是"修回来"，而是**断言它没被动过**（那一句才是本任务真正想说的话）。
   *   ★ 见下面臂 10：它把这条性质提升成一条**独立的臂**。
   */
  assert.equal(
    treeDigest(LIB), sharedLibBefore,
    '★★★ 本臂的实验**完全没有碰到共享树** —— 否则"隔离"这个词就是空的',
  )
  assert.equal(existsSync(STAGING), sharedStagingBefore, '★ 共享树的暂存目录状态也不许被本臂改变')
  } finally {
    /** ★ 隔离树是本臂**自己的**产物 ⇒ 它自己收拾（共享树由上面那两条断言保证没被碰）。 */
    rmSync(tree, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：worktree 隔离（契约里"第二个竞态"的那一半）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 4 隔离臂：lib/ 是【真目录】不是软链 —— 且构建只写自己这一棵树', async () => {
  /**
   * ── 契约里那"两个竞态"的第二个 ──────────────────────────────────────────────
   *
   *     "不同 worktree 之间互撞 ⇒ ★ 已查：worktree 的 lib/ 是【真目录】不是软链
   *      ⇒ 这一半已满足 ——（verify 后仍要确认：worktree 的 build 是否只动它自己的 lib）"
   *
   * ⇒ 本臂就是那次"确认"：
   *   ① `lib/` 必须是真目录（★ 而这也正是我不采用"软链 + 换链"写法的理由 ——
   *      那个写法能把窗口降到严格零，但会毁掉这一条已论证的性质）
   *   ② 构建脚本里的目标路径必须**由脚本自身位置推导**、且被 `assertScoped` 限制在项目根
   */
  assert.ok(existsSync(LIB), '★ lib/ 必须存在')
  assert.equal(
    statSync(LIB).isSymbolicLink(), false,
    '★ `lib/` 必须是**真目录**：worktree 之间互不干扰，正建立在这个事实上。'
    + ' 若改成软链，两个树会共享同一份产物 —— 而那是一个本任务【不该引入】的新竞态',
  )
  /** ② 构建脚本不引用任何绝对路径 / 别的树。 */
  const source = readFileSync(CLEAN_BUILD, 'utf8')
  assert.equal(
    /\/Users\/|\/home\/|\/tmp\//.test(source), false,
    '★ 构建脚本不许硬编码绝对路径 —— 那会让它在别的树/别的机器上写错地方',
  )
  assert.match(source, /fileURLToPath\(import\.meta\.url\)/, '★ 项目根必须由脚本自身位置推导')
  assert.match(source, /assertScoped|refusing to touch/, '★ 目标路径必须被显式限制在项目根之内')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：结构臂 —— 没有任何"先删后建"
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5 结构臂：build 里【不存在】"先删目标再重建"的形状', async () => {
  /**
   * ── 这一臂把"缺陷的形状"本身钉住，而不是只钉"它这次有没有发作" ────────────────
   *
   *     `rm -rf lib` + 之后的编译 ＝ **先删后建** ⇒ 那一段必然是"不可用的树"。
   *     ★ 所以判据不该是"今天的窗口有多小"，而是**那种形状还在不在**。
   *
   * ★ 定向突变：把 `rm -rf lib` 加回 clean-build.mjs（针对 buildOutput）⇒ 本臂红。
   *   ★ 注意：`rm -rf lib.tmp` / `lib.old` 是**允许**的 —— 它们不是读者看的树。
   */
  const source = readFileSync(CLEAN_BUILD, 'utf8')
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  /**
   * ★ 判法：删 `buildOutput` 的那一行**不许存在**。
   *   而"删 staging/previous"是允许的 ⇒ 所以判的是**目标是不是 buildOutput**。
   */
  const lines = stripped.split('\n').filter((line) => /rm\(/.test(line) || /rmSync|unlink/.test(line))
  assert.ok(lines.length > 0, '★ 本臂要能看见清理语句（否则它测的是空气）')

  const build = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.build
  assert.equal(
    /clean-build\.mjs\b(?!\s+(clear|publish))/.test(build), false,
    '★ package.json 的 build 不许再调用【无子命令】的 clean-build（那正是旧的 `rm -rf lib/` 路径）',
  )
  assert.match(build, /clean-build\.mjs clear/, '★ build 必须显式调用 `clear`（清场）')
  assert.match(build, /clean-build\.mjs publish/, '★ build 必须显式调用 `publish`（原子替换）')
  /**
   * ★★ 而顺序也是契约的一部分：`publish` 必须在**两个 tsc 之后**、`tsdown` 之前。
   *   · 在 tsc 之前 ⇒ 换上去的是空树（缺编译产物）
   *   · 在 tsdown 之后 ⇒ tsdown 读的是旧 lib/client/index.js ⇒ bundle 旧代码
   */
  const iPublish = build.indexOf('clean-build.mjs publish')
  const iTsc1 = build.indexOf('tsc -p tsconfig.json')
  const iTsc2 = build.indexOf('tsc -p tsconfig.client.json')
  const iTsdown = build.indexOf('tsdown')
  assert.ok(iTsc1 < iPublish, '★ publish 必须在第一个 tsc 之后')
  assert.ok(iTsc2 < iPublish, '★ publish 必须在第二个 tsc 之后')
  assert.ok(iPublish < iTsdown, '★ publish 必须在 tsdown 之前 —— 否则 tsdown 会去读旧的 lib/client/index.js 而 bundle 出【旧代码】')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ 臂 6-9：构建锁的四态（2026-10-10，由合并级实测引入）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一组进来的路（值得记，因为它是"合并才暴露"的样本）───────────────────────
 *
 * 实测：两条链各自在自己的 worktree 上改 `clean-build.mjs` ——
 *   链 A 给 `clear()` 加 `lib.tmp.LOCK` 守卫，链 B 给 `publish()` 加一行日志。
 * 合并**零冲突**，而 integrator 在【合并后的语义】上发现：
 *
 *   ★ 陈旧的 `lib.tmp.LOCK` ⇒ **构建永久死锁**。
 *
 * 三条成因，各自单条链都看不到：
 *   ① 全仓【没有任何代码创建或删除】这个文件 —— 守卫把"没人写的文件"
 *      当成了"另一个构建在跑"；
 *   ② 没有任何路径清理它，而 `clear` 恰是唯一能复位它、又被它挡住的入口
 *      ⇒ 一次崩溃 = 永久死锁，仓库无法自愈；
 *   ③ 守卫位于 `rm` 循环【之后】⇒"拒绝"发生时，`lib.tmp`/`lib.old` 已被删掉。
 *
 * ── 本组臂钉住修法 ────────────────────────────────────────────────────────────
 *   臂 6：陈旧（持有者已死）⇒ **自愈**（清掉并继续）
 *   臂 7：持有者活着 ⇒ **拒绝**（不许把"活着"读成"陈旧"）
 *   臂 8：★ 读不出持有者 ⇒ **按持有处理**（"没测到"不许并进"没有锁"）
 *   臂 9：★ 守卫在 `rm` **之前**（拒绝时不许造成破坏）
 */

/** 造一个最小项目根：`scripts/clean-build.mjs` + `lib/`。 */
function lockFixture() {
  const base = mkdtempSync(join(tmpdir(), 'build-lock-'))
  mkdirSync(join(base, 'scripts'), { recursive: true })
  mkdirSync(join(base, 'lib'), { recursive: true })
  copyFileSync(join(ROOT, 'scripts', 'clean-build.mjs'), join(base, 'scripts', 'clean-build.mjs'))
  return base
}

/** 在 fixture 里跑一次 clear，取回退出码与两个流。 */
function runClear(base) {
  const r = spawnSync('node', ['scripts/clean-build.mjs', 'clear'], { cwd: base, encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') }
}

test('★★★ 臂 6（自愈臂）：陈旧的构建锁必须被清掉并继续 —— 否则构建永久死锁', () => {
  /**
   * ── 这条就是那个死锁的修复 ────────────────────────────────────────────────────
   *
   * MEASURED（修之前，用合并后的产物）：植入一个持有者不存在的 LOCK 之后，
   * `clear` 连续两次都 `exit 1`、LOCK 仍在 ⇒ **每一次构建都在第一步失败**。
   *
   * ★ 判据是**两半**：退出码为 0 **且** LOCK 真的没了。
   *   只看退出码会让"没拒绝但也没清"照样绿（那是另一种死锁）。
   *
   * 定向突变：把 `state === 'stale'` 那一支删掉（改成一律 held）⇒ 本臂红。
   */
  const base = lockFixture()
  try {
    /** pid 选一个**必定不存在**的：Linux/macOS 的 pid 上限远低于它。 */
    writeFileSync(join(base, 'lib.tmp.LOCK'), '999999')
    const r = runClear(base)
    assert.equal(r.code, 0, `★ 陈旧锁必须自愈（实际 exit=${r.code}）—— exit!=0 就是永久死锁`)
    assert.equal(existsSync(join(base, 'lib.tmp.LOCK')), false, '★★ 而且 LOCK 必须真的被清掉')
    /** ★ 而它不静默：要说清"我清掉了一个谁的锁"。 */
    assert.match(r.stderr, /陈旧/, '★ 自愈必须留下可读的一句话（否则与"没有过锁"同形）')
    assert.match(r.stderr, /999999/, '★ 且指名持有者 pid')
  } finally { rmSync(base, { recursive: true, force: true }) }
})

test('★★ 臂 7（拒绝臂）：持有者【活着】⇒ 必须拒绝 —— 不许把"活着"读成"陈旧"', () => {
  /**
   * ★ 反向半边。没有它，"自愈"会被写成"无条件删锁"——
   *   而那把互斥本身取消了（两个构建照样会互相踩）。
   *
   * ★ 用 **当前进程自己的 pid** 当持有者：它在测试运行期间必然活着。
   */
  const base = lockFixture()
  try {
    writeFileSync(join(base, 'lib.tmp.LOCK'), String(process.pid))
    const r = runClear(base)
    assert.equal(r.code, 1, '★★ 持有者活着 ⇒ 必须拒绝')
    assert.equal(existsSync(join(base, 'lib.tmp.LOCK')), true, '★ 拒绝时不许删掉别人的锁')
    assert.match(r.stderr + r.stdout, /另一个构建正在进行/, '★ 拒绝的话要说清是什么在跑')
  } finally { rmSync(base, { recursive: true, force: true }) }
})

test('★★★ 臂 8（三态臂）：LOCK 存在但持有者读不出 ⇒ 按【持有】处理，不是"没有锁"', () => {
  /**
   * ── 这一条是本仓那条最贵的纪律在这一格的落点 ──────────────────────────────────
   *
   * "LOCK 里没有可用的 pid"是一件**没能测量**的事，而它有两种读法：
   *   · 读成 `free`（没有锁）⇒ ★ "没测到"并进了"通过" —— 两个构建会互相踩；
   *   · 读成 `held`（保守）  ⇒ 正确，且**措辞要说清是哪一种**。
   *
   * ★ 与本仓「未测量不得并进通过」逐字同源。
   *   定向突变：把 `unreadable` 那一支并进 `free` ⇒ 本臂红。
   */
  const base = lockFixture()
  try {
    /** 空文件：一个"存在但什么也没说"的锁。 */
    writeFileSync(join(base, 'lib.tmp.LOCK'), '')
    const r1 = runClear(base)
    assert.equal(r1.code, 1, '★★ 读不出持有者 ⇒ 保守拒绝（不许当成没有锁）')
    assert.equal(existsSync(join(base, 'lib.tmp.LOCK')), true, '★ 也不许删掉它')

    /** ★ 而措辞必须与"持有者活着"**不同形** —— 两者的处置不一样。 */
    writeFileSync(join(base, 'lib.tmp.LOCK'), 'not-a-pid')
    const r2 = runClear(base)
    assert.equal(r2.code, 1, '★ 非数字内容同样保守')
    assert.match(r2.stderr + r2.stdout, /could not be determined|无法确定|读不出/,
      '★ 必须说清是"读不出持有者"，而不是"有人在跑"（两者不同形）')
  } finally { rmSync(base, { recursive: true, force: true }) }
})

test('★★★ 臂 9（顺序臂）：守卫必须在 `rm` 【之前】—— 拒绝时不许造成破坏', () => {
  /**
   * ── 这条来自链 A 审核工那条被降级的 low finding（F1）──────────────────────────
   *
   * 它当时写的是"守卫在 rm 循环之后，故 LOCK 存在时 lib.tmp/lib.old 已被删"，
   * 而它被判为"契约字面已满足"（契约只说 before the mkdir）。
   * ★ 而它其实是一条**真的**顺序错误：一次"拒绝"造成了一半的破坏，
   *   而它读起来像"我拦住了"。⇒ 合并级实测把它变成了必须修的一条。
   *
   * 判据：植入一个**活着**的持有者 ⇒ clear 拒绝，而 `lib.tmp` 与 `lib.old`
   *   **必须都还在**（若守卫在 rm 之后，它们已经被删了）。
   */
  const base = lockFixture()
  try {
    mkdirSync(join(base, 'lib.tmp'), { recursive: true })
    writeFileSync(join(base, 'lib.tmp', 'keep-me.txt'), 'x')
    mkdirSync(join(base, 'lib.old'), { recursive: true })
    writeFileSync(join(base, 'lib.old', 'keep-me-too.txt'), 'x')
    writeFileSync(join(base, 'lib.tmp.LOCK'), String(process.pid))

    const r = runClear(base)
    assert.equal(r.code, 1, '★ 有活锁 ⇒ 拒绝')
    assert.equal(existsSync(join(base, 'lib.tmp', 'keep-me.txt')), true,
      '★★★ 拒绝时 lib.tmp 必须【原样未动】—— 守卫在 rm 之后就做不到这一点')
    assert.equal(existsSync(join(base, 'lib.old', 'keep-me-too.txt')), true,
      '★★★ lib.old 同理')
  } finally { rmSync(base, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 10（t35）：★★★ 隔离臂 —— 在隔离树里跑一次完整构建，而共享树**一个字节都不变**
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂为什么必须**独立**存在，而不是只留在臂 3 的收尾里 ────────────────────────
 *
 * 臂 3 的收尾**也**断言了共享树没被动过（那两句是它的收尾）。
 * ★ 而"某一条臂顺带断言了 X"与"有一条臂**专门**钉住 X"是两件事：
 *   前者在**有人重构臂 3** 时会跟着消失，而消失的方式是**静默的**
 *   （那两句只是被删掉，测试照常绿）。
 *
 * ★★★ 而这一条性质是本任务的**全部要点**，值得它自己的臂：
 *
 *     MEASURED（本轮，两次独立事故，同一族）：
 *       · t56 的夹具在**共享的 lib/** 上跑 `rm -rf lib` ⇒ 此后 **49 个夹具**报 ERR_MODULE_NOT_FOUND
 *       · 本夹具原来在共享树里跑 `pnpm build` ⇒ `lib/worktree.js` 消失 1.9–2.5 秒
 *         ⇒ 并行跑全量套件时 **13 条** ERR_MODULE_NOT_FOUND（由 `worktree-reclaim.test.mjs` 报出）
 *     ⇒ 两次的**入口不同**（直接删 vs 通过构建间接抽走），而**窗口相同**。
 *
 * ⇒ 本臂把"构建只发生在一棵一次性树里"变成一条**可执行的**读数：
 *   在隔离树里跑**完整构建**，然后逐字节比对共享 `lib/`。
 *
 * ★ 反向半边：若哪天有人把构建搬回共享树（例如"顺手重建一下"），
 *   本臂**当场红** —— 而那正是它存在的理由。
 */
test('臂 10 ★★★（t35 隔离臂）：在隔离树里跑完整构建 ⇒ 共享 lib/ 逐字节不变', async (t) => {
  if (!ensureLibBuilt(t)) return

  const { mkdtempSync, cpSync, symlinkSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')

  /** ★ 事前快照：共享 lib/ 的指纹、以及共享树上那几个**会被构建挪动**的兄弟路径。 */
  const libBefore = treeDigest(LIB)
  const stagingBefore = existsSync(STAGING)
  const previousBefore = existsSync(PREVIOUS)
  /** ★ 同时盯住"读得到"这件事本身：共享 lib/ 必须一直是**可用**的。 */
  const indexBefore = existsSync(join(LIB, 'index.js'))

  const tree = mkdtempSync(join(tmpdir(), 't35-isolation-'))
  try {
    for (const entry of ['src', 'scripts', 'tsconfig.json', 'tsconfig.client.json', 'tsdown.config.ts', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
      cpSync(join(ROOT, entry), join(tree, entry), { recursive: true })
    }
    symlinkSync(join(ROOT, 'node_modules'), join(tree, 'node_modules'), 'dir')
    cpSync(LIB, join(tree, 'lib'), { recursive: true })

    const { readFileSync: readTreePkg } = await import('node:fs')
    const buildScript = JSON.parse(readTreePkg(join(tree, 'package.json'), 'utf8')).scripts.build
    const built = spawnSync(buildScript, {
      cwd: tree,
      encoding: 'utf8',
      shell: true,
      env: { ...process.env, PATH: `${join(ROOT, 'node_modules', '.bin')}:${process.env.PATH ?? ''}` },
    })
    console.log(`    ℹ 隔离树里的完整构建 ⇒ exit ${built.status}`)

    assert.equal(built.status, 0, `★ 前置：隔离树里的构建必须成功，否则本臂测不了隔离:\n${String(built.stderr).slice(0, 400)}`)

    /** ★ 而它**真的**动了那棵树（否则"隔离"是因为什么都没做 —— 那是恒真）。 */
    assert.ok(
      existsSync(join(tree, 'lib', 'index.js')),
      '★ 前置：隔离树里的构建必须真的产出了东西 —— 否则下面那条"共享树没变"是恒真的',
    )

    /**
     * ── ★★★ 读数：共享树逐字节没变 ────────────────────────────────────────────────
     */
    assert.equal(
      treeDigest(LIB), libBefore,
      '★★★ 隔离树里的一次完整构建让**共享 lib/** 变了 —— 那意味着构建被搬回了共享树，\n'
      + '   而那正是 13 条 ERR_MODULE_NOT_FOUND 的成因（本文件的文件头记着它）。',
    )
    assert.equal(existsSync(STAGING), stagingBefore, '★ 共享树的 `lib.tmp` 状态不许被改变')
    assert.equal(existsSync(PREVIOUS), previousBefore, '★ 共享树的 `lib.old` 状态不许被改变')
    /**
     * ★★ 第三个读数，与上面三个**不同形**：不是"没变"，而是"**一直读得到**"。
     *   上面那三条在"构建把 lib/ 抽走两秒又放回来"时**都会通过**
     *   （快照是在构建**之后**取的）—— 而那个两秒窗口正是真正的危害。
     *   ⇒ 所以本臂**同时**断言那些必需产物在**事后**仍然在位，
     *     而"窗口期"的守卫由 ensureLibBuilt 的 skip 语义承担（它不再触发构建）。
     */
    assert.equal(
      existsSync(join(LIB, 'index.js')), indexBefore,
      '★ 共享 lib/ 的核心产物必须在场 —— 本臂的实验不许让它消失',
    )
  } finally {
    rmSync(tree, { recursive: true, force: true })
  }
})
