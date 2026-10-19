/**
 * ★ 问题：6 棵保留树的 4.8G 里，删了**真能多出多少空间**？
 *
 * 口径（为什么不能用 `du -sh` 直接报）：
 *   `du` 报的是**表观字节**。同一个 inode 被 N 个路径引用时，删其中 1 个释放 0 字节，
 *   只有**最后一条链接**消失才真正还盘。
 *   ⇒ 必须按 inode 记账，且要区分「这个 inode 在**待删集合之外**还有引用吗」。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

const KEEP = ['task-agent-teams-refactor-t101','task-agent-teams-refactor-t102',
  'task-agent-teams-refactor-t108','task-agent-teams-refactor-t109',
  'task-agent-teams-refactor-t111','task-agent-teams-refactor-t112']
const WT = '.agent-teams/worktrees'

const sh = (cmd) => execFileSync('bash', ['-c', cmd], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })

// 每个 inode 的 512B 块数 + nlink（整仓范围，才看得见"集合外还有没有引用"）
const raw = sh(`find . -type f -exec stat -f '%i %b %l' {} + 2>/dev/null`)
const blocks = new Map(), nlink = new Map()
for (const line of raw.split('\n')) {
  const [ino, b, l] = line.trim().split(/\s+/)
  if (!ino) continue
  blocks.set(ino, Number(b)); nlink.set(ino, Number(l))
}

// 待删集合里每个 inode 出现几次（同一棵树内部也可能被引用多次）
const inSet = new Map()
for (const t of KEEP) {
  const r = sh(`find ${WT}/${t} -type f -exec stat -f '%i' {} + 2>/dev/null`)
  for (const ino of r.split('\n')) {
    const k = ino.trim(); if (!k) continue
    inSet.set(k, (inSet.get(k) ?? 0) + 1)
  }
}

let apparent = 0, freedIfAllDeleted = 0, survivesOutside = 0
for (const [ino, count] of inSet) {
  const b = blocks.get(ino) ?? 0
  const total = nlink.get(ino) ?? 1
  apparent += b * count              // 表观：出现几次算几次（≈ du 逐棵相加，不减同树内重复）
  if (total <= count) freedIfAllDeleted += b   // 集合外的链接数 = 0 ⇒ 全删才释放，且能释放
  else survivesOutside += b          // 集合外仍有引用 ⇒ 全删也释放不了
}
const GiB = (x) => (x * 512 / 2 ** 30).toFixed(2)

console.log(`6 棵保留树（t101 t102 t108 t109 t111 t112）`)
console.log(`  表观总量（逐次计）           : ${GiB(apparent)} GiB`)
console.log(`  删光后**真能释放**           : ${GiB(freedIfAllDeleted)} GiB   ← 这才是"删了多出多少"`)
console.log(`  删光也释放不了（集合外有引用）: ${GiB(survivesOutside)} GiB   ← pnpm store 硬链接`)
console.log(`  唯一 inode 数                : ${inSet.size}`)
console.log('')
console.log(`  释放占总表观              : ${(100 * freedIfAllDeleted / apparent).toFixed(1)}%`)
