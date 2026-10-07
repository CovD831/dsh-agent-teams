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
export function writeGitArtifactStamp(root) {
  writeFileSync(join(root, STAMP), JSON.stringify(current(root), null, 2) + '\n')
}
export function verifyGitArtifacts(root) {
  if (!existsSync(join(root, STAMP))) throw new Error('Missing Git artifact stamp; run pnpm build')
  const saved = JSON.parse(readFileSync(join(root, STAMP), 'utf8'))
  const actual = current(root)
  if (saved.schema !== actual.schema || saved.source !== actual.source || saved.output !== actual.output) {
    throw new Error('Git artifacts are stale or modified; run pnpm build and include lib/ with the source changes')
  }
  return actual
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  if (process.argv[2] === '--write') writeGitArtifactStamp(root)
  else { verifyGitArtifacts(root); console.log('Git artifacts match source and build settings.') }
}
