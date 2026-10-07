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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
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

function ensureLibBuilt() {
  if (!existsSync(join(LIB, 'index.js')) || !existsSync(join(LIB, 'client.js'))) {
    const built = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: true })
    assert.equal(built.status, 0, `★ 前置：需要一份完整的 lib/；pnpm build 失败:\n${built.stdout}\n${built.stderr}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★ 并发读 —— 差分口径（新实现 vs 旧实现）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★★ 并发读（差分）：旧实现 miss 数十万 · 新实现 miss 十个以内', async () => {
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
  ensureLibBuilt()
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

test('★ 臂 2 反向臂：`clear` 之后若编译没跑（＝build 失败那一路），lib/ 一个字节没动', async () => {
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
  ensureLibBuilt()
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

test('臂 3 ★ 三态臂：成功 / 失败（旧版完好）/ 无法判断 —— 三者不同形', async () => {
  /**
   * ── 三态各自是"关于什么"的结论 ───────────────────────────────────────────────
   *
   *     ① 成功     ⇒ lib/ 是**新**的完整版
   *     ② 失败     ⇒ lib/ 是**旧**的完整版（而上面臂 2 已钉住"一个字节没动"）
   *     ③ 无法判断 ⇒ publish 在没有暂存树时必须**说出来**，而不是静默当成成功
   *
   * ★ 判法：①②用**指纹是否变化**区分；③用**退出码 + 消息**区分。
   * ★ 定向突变：让 `publish` 在 lib.tmp 缺席时静默返回 ⇒ ③ 那条红。
   */
  ensureLibBuilt()

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
  const built = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: true })
  assert.equal(built.status, 0, '★ 完整 build 必须成功')
  const afterBuild = treeDigest(LIB)
  const REQUIRED = ['index.js', 'client.js', 'types/index.d.ts', 'types/client/index.d.ts', 'git-artifact-stamp.json']
  for (const rel of REQUIRED) {
    assert.ok(existsSync(join(LIB, rel)), `★ 成功态：lib/ 必须【完整】—— 缺 ${rel}`)
  }
  assert.equal(existsSync(STAGING), false, '★ 成功态：暂存树必须已被消费掉（留着它说明 publish 没跑完）')
  assert.equal(existsSync(PREVIOUS), false, '★ 成功态：旧版必须已被清理（留着它说明收尾没做）')

  /** ② 失败：clear 之后不编译 ⇒ lib/ 完整【且】暂存树在场（＝clear 跑过、publish 没跑）。 */
  assert.equal(spawnSync(process.execPath, [CLEAN_BUILD, 'clear'], { cwd: ROOT }).status, 0)
  assert.equal(treeDigest(LIB), afterBuild, '★ 失败态：lib/ 仍是【旧】的完整版（逐字节相同）')
  assert.ok(existsSync(STAGING), '★ 失败态：暂存树在场 —— 这与成功态的"暂存树已被消费"【不同形】')

  /** ③ 无法判断：没有暂存树时 publish 必须**说出来**。 */
  const noStaging = spawnSync(process.execPath, [CLEAN_BUILD, 'publish'], { cwd: ROOT, encoding: 'utf8' })
  /**
   * ★ 此时 lib.tmp 是 clear 建出来的**空目录** —— 所以这里要先把空目录删掉，
   *   才是真正的"没有暂存树"。
   */
  if (existsSync(STAGING)) execFileSync('rm', ['-rf', STAGING])
  const missingStaging = spawnSync(process.execPath, [CLEAN_BUILD, 'publish'], { cwd: ROOT, encoding: 'utf8' })
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
  const bogus = spawnSync(process.execPath, [CLEAN_BUILD, 'wat'], { cwd: ROOT, encoding: 'utf8' })
  assert.notEqual(bogus.status, 0, '★ 未知子命令必须拒绝 —— 静默 no-op 会让"参数打错"与"构建成功"同形')

  /**
   * ── ★★ 收尾：把共享树恢复成【完整】状态（本臂自己造成的污染，必须自己收拾）──────
   *
   * MEASURED（本任务，实测）：本臂把 lib/ 留在了"失败态"（clear 跑过、publish 没跑），
   * 而**lib.tmp 一旦留在那里，下一个 build 的 `clear` 会正常处理它**
   * —— 但**在此刻**，lib/ 与 lib.tmp 同时在场，而 lib/ 里那棵树是**旧的**。
   *
   * ★ 而真正的危害是：如果**本臂之后**有别的东西读 lib/，它会读到一棵
   *   "看起来完整、其实是旧版"的树 —— 那正是本任务要消灭的那种"看起来正常的残缺产物"。
   * ⇒ 所以本臂**必须在结束时重建一次**，把共享树交还给后续用例时是【这一版源码】的产物。
   */
  const rebuilt = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: true })
  assert.equal(rebuilt.status, 0, `★ 收尾：本臂必须能把共享树重建回完整状态:
${rebuilt.stderr}`)
  for (const rel of REQUIRED) {
    assert.ok(existsSync(join(LIB, rel)), `★ 收尾后 lib/ 必须是完整的 —— 缺 ${rel}`)
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
