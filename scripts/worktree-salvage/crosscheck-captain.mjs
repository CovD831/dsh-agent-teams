/**
 * 交叉核对：队长的 `merge-base --is-ancestor` 读数 vs 判据的四格。
 *
 * ★ 为什么这两件事**不等价**：
 *   `--is-ancestor` 只回答「这个**提交**在不在主干线上」—— 那是 judge 的 how=ancestor 那一格。
 *   judge 还有另外三格：content(patch-id 等价) / files(逐文件 blob 在 tip) / contained(blob 在历史里)。
 *   ⇒ 「is-ancestor 全为否」**推不出**「产物没被吸收」。
 */
import { judgeWorktreeReclaimable } from '../../lib/worktree.js'
import { execFileSync } from 'node:child_process'

const repo = process.cwd()
const INT = 'task-mutation-integrate'
const trees = ['t101', 't102', 't108', 't109', 't111', 't112']

const git = (cwd, args) => {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  catch { return null }
}

console.log('树       is-ancestor   judge 裁决        HEAD 独有文件（非 lib/ 派生）')
console.log('─'.repeat(96))
for (const t of trees) {
  const name = `task-agent-teams-refactor-${t}`
  const wt = `${repo}/.agent-teams/worktrees/${name}`
  const head = git(wt, ['rev-parse', 'HEAD'])
  let anc = 'no'
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', head, INT], { cwd: repo, stdio: 'ignore' })
    anc = 'YES'
  } catch { anc = 'no' }
  const v = judgeWorktreeReclaimable({ repo, worktree: wt, mainRef: INT })
  // 未合流的**非派生**文件（逐个 blob 查集成分支历史）
  const changed = (git(wt, ['diff', '--name-only', `${INT}...HEAD`]) ?? '').split('\n').filter(Boolean)
  const absent = []
  for (const f of changed) {
    if (f.startsWith('lib/') || f.endsWith('git-artifact-stamp.json')) continue
    const blob = git(wt, ['rev-parse', `HEAD:${f}`])
    if (blob === null) continue
    const hit = git(repo, ['log', INT, '--oneline', `--find-object=${blob}`])
    if (hit === null || hit === '') absent.push(f)
  }
  console.log(`${t.padEnd(7)} ${anc.padEnd(13)} ${(v.status + '/' + (v.reason ?? '')).padEnd(17)} ${absent.length === 0 ? '（无）' : absent.join(', ')}`)
}
