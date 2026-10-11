/** Record and verify source/build-output digests for script-free Git installation. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const STAMP = 'lib/git-artifact-stamp.json'
const REQUIRED = ['lib/index.js', 'lib/client.js', 'lib/types/index.d.ts', 'lib/types/client/index.d.ts']
const CONFIG = ['tsconfig.json', 'tsconfig.client.json', 'tsdown.config.ts', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'scripts/clean-build.mjs', 'scripts/git-artifacts.mjs']
function files(root, directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return files(root, path)
    if (!entry.isFile()) throw new Error(`Unsupported build input/output: ${path}`)
    return [path]
  }).sort()
}
function digest(root, paths, prefix = '') {
  const hash = createHash('sha256').update(prefix)
  for (const path of [...paths].sort()) hash.update(path).update('\0').update(readFileSync(join(root, path))).update('\0')
  return hash.digest('hex')
}
/**
 * ── ★★ f-0026：把【构建时的 git 提交】写进 stamp ──────────────────────────────────
 *
 * ★ 它补的是哪一格：stamp 此前只有 { schema, source, output } 三个**内容摘要**，
 *   于是检测器只能回答「盘上自本进程启动以来有没有被 rebuild 过」，
 *   而**答不出**「本进程加载的是哪个 commit 的代码」。
 *
 *   MEASURED（point-dev 发现、captain 核实）：若进程启动【之前】盘上就已经是当前这一版，
 *   两个 output 相等 ⇒ 恒报 current —— 而那时进程里的代码仍可能是更早 commit 的。
 *   ⇒ 那不是"没测到"伪装成"通过"，是**另一个问题被当成了这个问题的答案**。
 *
 * ★ 为什么 output 比对【补不上】这一格（两者测的不是同一件事）：
 *     · 一次 amend / rebase / revert，或两处改动互相抵消 ⇒ 内容摘要回到原值，而提交已不同；
 *     · 改一行注释 ⇒ output 变，而"代码是否落后"这件事与它无关。
 *   ⇒ 两个都要，且各自可读。
 *
 * ★ 取值时机（f-0025「按取值时机区分」）：
 *     本函数在 **build 时**取 HEAD —— 它是**常量**，随 stamp 一起落盘。
 *     而「当前 HEAD」是**每次调用都可能变**的量 ⇒ 必须在**调用时**读
 *     （见 `moduleFreshness()`）。两者不是同一格。
 *
 * ★ 读不到 git（不在仓库里 / 没装 git / 没有提交）⇒ **不写这一格**，
 *   而不是写一个空串或猜测值：缺席是"我没能记录"，空串是"记录到的就是空的"。
 *   ⇒ 检测器随后会诚实地说 `unknown`（见 entities.ts 的三态），而不是报 current。
 */
function gitCommit(root) {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    return /^[0-9a-f]{40}$/u.test(sha) ? sha : undefined
  } catch {
    return undefined
  }
}
function current(root) {
  for (const path of REQUIRED) if (!existsSync(join(root, path))) throw new Error(`Missing Git artifact: ${path}; run pnpm build`)
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const settings = JSON.stringify({ name: pkg.name, version: pkg.version, type: pkg.type, exports: pkg.exports, devDependencies: pkg.devDependencies, dependencies: pkg.dependencies, build: pkg.scripts?.build })
  const commit = gitCommit(root)
  return {
    schema: 1,
    source: digest(root, [...files(root, 'src'), ...CONFIG], settings),
    output: digest(root, files(root, 'lib').filter(path => path !== STAMP)),
    ...commit === undefined ? {} : { commit },
  }
}
/**
 * ── ★★★ t33：把「这份 stamp 与这棵树对不上」分成**两种不同的东西** ─────────────────
 *
 * ── 原先是什么样（MEASURED，本任务在真 worktree 上复现）──────────────────────────
 *
 * `verifyGitArtifacts` 只比 `schema/source/output` 三个**内容摘要**，并在一处不符时
 * 抛**同一句**话：
 *
 *     'Git artifacts are stale or modified; run pnpm build and include lib/ with the source changes'
 *
 * ⇒ 于是下面这两件**补救动作完全不同**的事，在读数上**同形**：
 *
 *   A. **陈旧 stamp**：`source` 与 `output` 都对得上（这棵树内部自洽），
 *      只是 stamp 里记的 `commit` 是一个**更早的提交** ——
 *      典型成因：worktree 从某个提交建出来，而那条提交里的 stamp 是它的父提交写的
 *      （**t31 实测的那个 hazard**）。
 *      ⇒ 补救：`pnpm build` 刷新一下；**与"谁的改动弄坏了什么"无关**。
 *      ⇒ 它**不是**一次失败，它是"这台工作区比 stamp 新"。
 *
 *   B. **真的对不上**：`source` 或 `output` **不一致** ⇒ 有人改了 src 没重建、
 *      或者手改了 lib/。
 *      ⇒ 补救：看是哪一半变了，然后重建（或撤掉手改）。
 *
 * ★★ 为什么这个区分**必须**做（本任务的全部理由）：本轮 t10/t11 都在做
 *   「这个红是先于我的改动就有的，还是我引入的」这个判断，而 pin 台账
 *   （`baseline-known-failures.json`）存在的理由正是它。⇒ 一条**恒报同一句话**
 *   的检查让那个判断只能靠**推理**（去翻 git log、去 stash 自己的改动再跑一次），
 *   而推理在不同的人那里会给出不同的答案。
 *
 * ── ★ 三态（与全仓纪律同源，且**不许合流**）────────────────────────────────────
 *
 *   `current`           —— 三个摘要都对上，**且** stamp 的 commit 就是当前 HEAD
 *   `stale-commit`      —— 摘要都对上，**而** stamp.commit ≠ HEAD（A）
 *   `content-differs`   —— 摘要对不上（B）★ 它把"哪一半变了"也说出来
 *
 * ★ 还有**第四态**，而它不是"通过"：`commit` **读不出来**（不在仓库里 / 没有提交 /
 *   没有 git）。那时**不许**报 `current` —— 那会把"我没能核对提交"
 *   说成"提交对得上"（与 `moduleFreshness` 的三态同一条纪律）。
 *   ⇒ 它落在 `stale-commit` 之外的 `unknown-commit`，且**不**阻断
 *     （一个没有 git 的安装包必须仍然能自检内容摘要）。
 */
export const ARTIFACT_VERDICTS = ['current', 'stale-commit', 'content-differs', 'unknown-commit']

/**
 * 核对一次，返回**带理由的裁决**（不抛错）。
 *
 * ★ 为什么不直接改成"永远不抛"：命令行那一条路要的仍然是**退出码**
 *   （`&&` 串联、`pnpm verify` 都读它）。⇒ 这里交出**数据**，
 *   由 `verifyGitArtifacts`（抛错的那一层）与 CLI 各自决定怎么用。
 *   ★ 两者**同源**：CLI 不再自己算一遍 —— 否则两处会随下一次改动分叉。
 */
export function inspectGitArtifacts(root) {
  if (!existsSync(join(root, STAMP))) {
    return { verdict: 'missing-stamp', why: 'Missing Git artifact stamp; run pnpm build' }
  }
  let saved
  try {
    saved = JSON.parse(readFileSync(join(root, STAMP), 'utf8'))
  } catch (error) {
    /**
     * ★ 坏 JSON 是**第四种**成因，而它与"内容对不上"不同形：
     *   前者是 stamp 本身坏了（去重建），后者是树与 stamp 不一致（去看谁改了）。
     */
    return { verdict: 'unreadable-stamp', why: `Git artifact stamp is not readable JSON: ${String(error?.message ?? error)}` }
  }
  let actual
  try {
    actual = current(root)
  } catch (error) {
    /** ★ 缺产物（`Missing Git artifact: …`）是**它自己**的一种成因，不许并进内容不一致。 */
    return { verdict: 'missing-artifact', why: String(error?.message ?? error) }
  }
  const savedCommit = typeof saved.commit === 'string' ? saved.commit : undefined
  const head = actual.commit

  /**
   * ★★ **先判内容**，再判提交 —— 顺序是刻意的：内容对不上时，
   *   "提交是哪一条"已经不重要了（补救动作是同一个：重建）。
   *   ⇒ 把它排在前面，读的人第一步就拿到**该做什么**。
   */
  if (saved.schema !== actual.schema || saved.source !== actual.source || saved.output !== actual.output) {
    const which = saved.source !== actual.source && saved.output !== actual.output
      ? 'both the source digest and the build output differ'
      : saved.source !== actual.source
        ? 'the source digest differs (src/, config or dependency settings changed since the stamp was written) — rebuild, or revert the change'
        : saved.output !== actual.output
          ? "the build output differs but the source digest matches — lib/ was modified or hand-edited without a rebuild"
          : `the stamp schema differs (stamp records ${String(saved.schema)}, this build writes ${String(actual.schema)})`
    return {
      verdict: 'content-differs',
      why: `Git artifacts are stale or modified: ${which}; run pnpm build and include lib/ with the source changes`,
      savedCommit,
      headCommit: head,
    }
  }

  /**
   * ── ★★★ 到这里，内容摘要**全部对得上** ⇒ 这棵树内部自洽。剩下的只有提交那一格 ─────
   */
  if (head === undefined || savedCommit === undefined) {
    return {
      verdict: 'unknown-commit',
      why: 'the artifact digests match, but the stamped and/or current commit could not be read '
        + `(stamped: ${savedCommit ?? 'absent'}, current: ${head ?? 'unreadable'}), so whether this stamp is from this commit was NOT checked`,
      savedCommit,
      headCommit: head,
    }
  }
  if (savedCommit !== head) {
    /**
     * ★★★ **这就是 t31 那个 hazard**：内容对得上，而 stamp 是**更早的提交**写的。
     *   ⇒ 它**不是**"这棵树坏了"，它是"这棵树比 stamp 新"。
     *   ★ 而它必须可读地**自报家门**，好让成员与 integrator 一眼分清
     *     "先于我的红" 与 "我引入的红"。
     */
    return {
      verdict: 'stale-commit',
      why: 'the artifact digests match (this tree is internally consistent), but the stamp was written '
        + `at commit ${savedCommit} while HEAD is ${head} — this is PRE-EXISTING, not caused by the current work; `
        + 'run pnpm build to refresh the stamp if you need it to name this commit',
      savedCommit,
      headCommit: head,
    }
  }
  return { verdict: 'current', why: 'Git artifacts match source and build settings.', savedCommit, headCommit: head }
}
export function writeGitArtifactStamp(root) {
  writeFileSync(join(root, STAMP), JSON.stringify(current(root), null, 2) + '\n')
}
export function verifyGitArtifacts(root) {
  const inspection = inspectGitArtifacts(root)
  /**
   * ── ★★ 哪几态**抛**，哪几态**不抛** —— 而这是一条**裁决**，不是格式选择 ────────────
   *
   * 抛（退出码非 0）：
   *   `missing-stamp` / `unreadable-stamp` / `missing-artifact` / `content-differs`
   *   ⇒ 这棵树**确实对不上**：产物缺了、stamp 坏了、或者内容变了没重建。
   *      这些都是"去修"的信号，而 CLI 的非零退出码正是 `pnpm verify` 需要的。
   *
   * **不抛**：
   *   `stale-commit` —— ★ 内容摘要**全部对得上** ⇒ 这棵树内部自洽，只是 stamp
   *     记的提交更早。⇒ 把它报成失败，正是本任务要消灭的那个**假红**：
   *     一个从这种 worktree 量"这棵树绿不绿"的人，会看到一个**先于他存在**的红。
   *   `unknown-commit` —— 读不到 git（没有 git 的安装包）。★ 同样不抛：
   *     把一个**安装包**（本来就不是 git 仓库）判成失败，会让这条检查
   *     在每个非仓库环境里都红 —— 而那时人们会去**删掉这条检查**。
   *     ★ 而它**不静默**：裁决与理由都交出去（见下面 CLI 的输出）。
   */
  if (inspection.verdict === 'current' || inspection.verdict === 'stale-commit' || inspection.verdict === 'unknown-commit') {
    /**
     * ★★ 保持**旧有的返回形状**：既有调用方（与既有臂）读的是
     *   `verifyGitArtifacts(root).schema` —— 也就是 `current(root)` 的那一份摘要。
     *   ⇒ MEASURED（本任务第一版）：我改成返回 `inspection` 之后，
     *     既有的那条臂当场红在 `actual: undefined, expected: 1` 上。
     *   ★ 判据：这一格是**公开接口**，而"改一个检查的输出形状"不该顺带
     *     改掉它的**返回类型** —— 那会把"这条臂红了"变成"接口变了"，
     *     而两者在红出来的措辞上同形。
     *   ⇒ 摘要仍在（`actual` 那一格），**另外**把裁决挂上去，两个都拿得到。
     */
    const actual = current(root)
    return Object.assign(actual, { verdict: inspection.verdict, why: inspection.why })
  }
  throw new Error(inspection.why)
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  if (process.argv[2] === '--write') writeGitArtifactStamp(root)
  else {
    const inspection = inspectGitArtifacts(root)
    if (inspection.verdict === 'current') console.log(inspection.why)
    else if (inspection.verdict === 'stale-commit') {
      /**
       * ── ★★★ 这一行**就是本任务的交付物**：成员读**一句命令的输出**就知道
       *   "这个红先于我的工作"，而不用去推理（翻 git log / stash 自己的改动再跑一次）。
       */
      console.log(`Git artifacts match source and build settings (the stamp is STALE, not broken).`)
      console.log(`  stamp commit: ${inspection.savedCommit}`)
      console.log(`  HEAD:         ${inspection.headCommit}`)
      console.log('  \u2192 this is PRE-EXISTING: it predates the current work and is not caused by it.')
      console.log('  \u2192 run `node scripts/git-artifacts.mjs --write` (or pnpm build) to refresh the stamp.')
    } else if (inspection.verdict === 'unknown-commit') {
      /** ★ 第四态：**说出来**，且不判失败（没有 git 的环境是正常的）。 */
      console.log('Git artifacts match source and build settings.')
      console.log(`  \u26A0 commit provenance NOT checked: ${inspection.why}`)
    } else {
      console.error(inspection.why)
      process.exitCode = 1
    }
  }
}
