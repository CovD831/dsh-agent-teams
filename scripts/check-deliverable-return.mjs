#!/usr/bin/env node
/**
 * ── G · 交付回流检查（只读）────────────────────────────────────────────────────
 *
 * 回答一个本仓**此前没有判据**回答的问题：
 *
 *     「任务在自己 worktree 里提交的东西，**回到队长工作区了吗**？」
 *
 * ── 为什么它必须存在（实测发生两次）────────────────────────────────────────────
 *
 *   t18：修复产物在 `.agent-teams/worktrees/…-t18` 的提交 `e7c617b` 里，
 *        而队长工作区仍是旧版（461 行 vs 546 行）。
 *   t20：同样，提交 `f5f04de` 只在它自己的 worktree 里。
 *
 * ★ 危害是**判出与事实相反的结论**：复核员读**队长工作区**，实现者写**自己 worktree**
 *   ⇒ 若不先归并，复核看到的是**已被判定为错的那一版**，于是"它没修"这个判断
 *     在读数上与"它修了但没交回来"**同形** —— 而两者的处置相反。
 *
 * ★ 本仓已有判据管「隔离目录**建得出**吗」（`dispatch.worktree`），但没有判据管
 *   「东西**交回来没有**」。这个工具补的就是那根线。
 *
 * ── ★★★ 只报告，不归并（本仓纪律）──────────────────────────────────────────────
 *
 * `docs/PROPOSAL-DELIVERABLE-RETURN.md` §6 逐字：
 *    「**不**自动归并（不 `git merge`、不 `git checkout`）—— 判据只**报告**，
 *      归并动作是人的决定（本仓纪律：判据不替人做决定）。」
 *
 * ⇒ 本文件**绝不**执行任何写操作。它只读两处内容、算两个哈希、报三态。
 *   连 `git stash` / `git checkout` / `git merge` / `git apply` 都不出现。
 *   （可核：`grep -nE "merge|checkout|stash|apply|writeFile|rm |unlink" <本文件>`
 *     只会命中注释与本说明。）
 *
 * ── ★★ 三态，且不许合并 ────────────────────────────────────────────────────────
 *
 *     ok          —— 该提交的每个 changedPath，两边内容**逐字节相同**
 *     diverged    —— 有路径两边不同（**逐条列出是哪几个文件、两边哈希各是什么**）
 *     unmeasured  —— **读不出来**（文件不在任一侧 / 不是 git 对象 / 路径不可读）
 *
 * ★ `unmeasured` **绝不并进 `ok`**：本仓最贵的一条纪律是
 *   「可判定的事实不得写成没能测量」，而它的反面同样成立 ——
 *   **没能测量不得写成通过**。一份读不出来的清单与一份恰好全等的清单**必须不同形**。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────────
 *
 *   node scripts/check-deliverable-return.mjs <commit> [--workspace <dir>] [--json]
 *
 *   <commit>      要检查的提交（任意 rev：sha / 短 sha / 分支 / HEAD）
 *   --workspace   队长工作区根（缺省：**本脚本所在仓库的根**，即 `git rev-parse --show-toplevel`）
 *   --json        机器可读输出（给夹具与下游用）；缺省是人类可读
 *
 * 退出码：ok ⇒ 0 ｜ diverged ⇒ 1 ｜ unmeasured ⇒ 2
 *   ★ 三个退出码**互不相同** —— 与三态一一对应，好让 shell 侧不必解析文本。
 *      （`unmeasured` 与 `diverged` 不同码，因为"没交回来"与"读不出来"处置相反。）
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** `git` 的只读包装。**任何**失败都返回 `undefined`（由调用方归入第三态，绝不抛穿）。 */
function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return undefined
  }
}

/** 内容哈希：对**原始字节**做 sha256（不加 git 头）。 */
function hashBytes(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * 取一个 rev 的**工作区根**（`--workspace` 缺省值）。
 * ★ 用 `--show-toplevel` 而不是 `process.cwd()`：本工具会被从**任何** cwd 调用
 *   （实现者的 worktree、队长的树、夹具的临时目录），而"哪棵树"必须由 git 回答、不许猜。
 */
function toplevel(cwd) {
  const out = git(['rev-parse', '--show-toplevel'], cwd)
  return out === undefined ? undefined : out.toString('utf8').trim()
}

/**
 * 该提交里**改动的路径**（相对仓库根的 POSIX 路径）。
 *
 * ★ 用 `--diff-filter=` 的**缺省值**（含 A/M/D/R），因为**删除也是一种交付** ——
 *   一条只删文件的交付如果没有回流，队长工作区里那个文件**还在**，而这正是要报出来的。
 * ★ `-z`（NUL 分隔）：路径可能含空格 / 中文，按行切会切错。
 */
function changedPaths(commit, cwd) {
  const out = git(['show', '--name-only', '--format=', '-z', commit], cwd)
  if (out === undefined) return undefined
  return out
    .toString('utf8')
    .split('\0')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/** 提交侧的内容（`git show <commit>:<path>`）。读不出 ⇒ `undefined`。 */
function blobInCommit(commit, path, cwd) {
  return git(['show', `${commit}:${path}`], cwd)
}

/**
 * 工作区侧的内容。
 *
 * ★ 直接读**文件系统**而不是 `git show :<path>`（索引）：要回答的问题是
 *   「**队长现在盘上那份**是不是这一版」—— 索引与工作区可能不同（未 stage 的改动），
 *   而复核员读的是**工作区**。
 * ★ 目录 / 符号链接 / 权限不可读 ⇒ `undefined`（第三态），**不抛**。
 */
function blobInWorkspace(path, workspaceRoot) {
  try {
    const stat = statSync(join(workspaceRoot, path))
    if (!stat.isFile()) return undefined
    return readFileSync(join(workspaceRoot, path))
  } catch {
    return undefined
  }
}

/** 主判定：三态。 */
function check(commit, workspaceRoot, cwd) {
  const resolved = git(['rev-parse', commit], cwd)
  if (resolved === undefined) {
    return { state: 'unmeasured', why: `the commit "${commit}" is not a git object here`, entries: [] }
  }
  const sha = resolved.toString('utf8').trim()

  const paths = changedPaths(sha, cwd)
  if (paths === undefined) {
    return { state: 'unmeasured', why: `could not list the changed paths of ${sha}`, entries: [] }
  }
  /**
   * ★ **空交付**是 `unmeasured`，**不是** `ok` —— 一个什么都没改的提交
   *   "全等"是**恒真的**（空集上一切比较都成立）。这正是本仓记过的恒真形态，
   *   所以显式挡掉。
   */
  if (paths.length === 0) {
    return {
      state: 'unmeasured',
      why: `${sha.slice(0, 12)} changes no path — an empty delivery cannot be "returned"; `
        + 'writing it as ok would be vacuously true',
      entries: [],
    }
  }

  const entries = []
  for (const path of paths) {
    const inCommit = blobInCommit(sha, path, cwd)
    const inWorkspace = blobInWorkspace(path, workspaceRoot)
    /**
     * ★ 三种"读不出"**各自带因**（不合成一个 `undefined`）：
     *     提交里没有（该路径是**删除**）/ 工作区没有（**还没交回来**或**已被删**）/ 两侧都没有
     *   ⇒ 补救动作不同：删改补、还是把文件取回。本仓纪律：成因不同的"没有"不许同形。
     */
    let why
    if (inCommit === undefined && inWorkspace === undefined) why = 'absent on both sides'
    else if (inCommit === undefined) why = `not in ${sha.slice(0, 12)} at this path (deleted by the commit?)`
    else if (inWorkspace === undefined) why = `not in the workspace at ${join(workspaceRoot, path)}`

    if (why !== undefined) {
      entries.push({ path, status: 'unreadable', why })
      continue
    }
    const commitHash = hashBytes(inCommit)
    const workspaceHash = hashBytes(inWorkspace)
    entries.push({
      path,
      status: commitHash === workspaceHash ? 'same' : 'differs',
      commitHash,
      workspaceHash,
    })
  }

  const unreadable = entries.filter((e) => e.status === 'unreadable')
  const differs = entries.filter((e) => e.status === 'differs')
  /**
   * ★ 优先级写死：**读不出 > 不等 > 全等**。
   *   一份"有的读不出、有的相等"的清单**不许**报 `ok` —— 那会把"没测到"埋进"通过"。
   */
  if (unreadable.length > 0) {
    return {
      state: 'unmeasured',
      why: `${unreadable.length} of ${entries.length} path(s) could not be read on both sides`,
      entries,
    }
  }
  if (differs.length > 0) {
    return {
      state: 'diverged',
      why: `${differs.length} of ${entries.length} path(s) differ between the commit and the workspace`,
      entries,
    }
  }
  return { state: 'ok', why: `all ${entries.length} path(s) are byte-identical`, entries }
}

const CODE = { ok: 0, diverged: 1, unmeasured: 2 }

function main(argv) {
  const args = argv.slice(2)
  const flags = new Set(args.filter((a) => a.startsWith('--')))
  const positional = args.filter((a) => !a.startsWith('--'))
  const wsIndex = args.indexOf('--workspace')
  const wsArg = wsIndex === -1 ? undefined : args[wsIndex + 1]

  if (positional.length === 0) {
    process.stderr.write(
      'usage: node scripts/check-deliverable-return.mjs <commit> [--workspace <dir>] [--json]\n'
      + '\n'
      + '  reports whether what a commit delivered is present, byte-for-byte, in the\n'
      + '  captain\'s workspace. READ-ONLY: it never merges, checks out or applies.\n'
      + '\n'
      + '  exit 0 = ok · 1 = diverged · 2 = unmeasured\n',
    )
    return 2
  }

  const cwd = process.cwd()
  const workspaceRoot = resolve(wsArg ?? toplevel(cwd) ?? cwd)
  const commit = positional[0]
  const result = check(commit, workspaceRoot, cwd)

  if (flags.has('--json')) {
    process.stdout.write(`${JSON.stringify({ commit, workspace: workspaceRoot, ...result }, null, 2)}\n`)
    return CODE[result.state]
  }

  const lines = []
  lines.push(`commit    : ${commit}`)
  lines.push(`workspace : ${workspaceRoot}`)
  lines.push(`state     : ${result.state.toUpperCase()} — ${result.why}`)
  lines.push('')
  for (const e of result.entries) {
    if (e.status === 'same') {
      lines.push(`  same      ${e.path}`)
    } else if (e.status === 'differs') {
      lines.push(`  DIFFERS   ${e.path}`)
      lines.push(`              commit    ${e.commitHash}`)
      lines.push(`              workspace ${e.workspaceHash}`)
    } else {
      lines.push(`  UNREADABLE ${e.path}`)
      lines.push(`              ${e.why}`)
    }
  }
  lines.push('')
  lines.push(
    result.state === 'ok'
      ? '★ the delivery is in the workspace. This tool does not merge: that is a human decision.'
      : result.state === 'diverged'
        ? '★ the delivery is NOT in the workspace (or the workspace has moved on). '
          + 'This tool does not merge: it reports, you decide.'
        : '★ could not measure — "not measured" is NOT "returned". Read the per-path reasons above.',
  )
  process.stdout.write(`${lines.join('\n')}\n`)
  return CODE[result.state]
}

process.exitCode = main(process.argv)
