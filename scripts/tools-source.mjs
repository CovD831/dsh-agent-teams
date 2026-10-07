/**
 * ── t39：读「工具实现的源码面」的**唯一入口** ────────────────────────────────────
 *
 * MEASURED（t39）：t30/t39 把 `src/tools.ts`（6916 行）拆成
 * `src/tools.ts`（装配）+ `src/tools/*.ts`（15 个工具模块）+ `src/tools/shared/`。
 *
 * ★ 而 9 个既有夹具此前是这么读的：
 *
 *     const TOOLS_SOURCE = readFileSync(join(ROOT, 'src', 'tools.ts'), 'utf8')
 *
 * ⇒ 拆分之后，**工具的源码面不再只在那一个文件里**，于是那些夹具报红：
 *     「源码里找不到工具 "agent_teams_create" —— 它被改名或删掉了」
 *
 * ── ★★ 修法：把"源码面"的定义收进一个地方，而不是让 9 个夹具各自抄一份 ──────────
 *
 * ★ 关键：**这不能是放宽**。那些断言的目的是"在【生产的源码】里真的找得到这个工具的
 *   块"，而放宽成"找不到就跳过"会让它们从红变绿 —— 那正是本队记账的"把红变绿"。
 * ⇒ 所以这里只改【取数范围】（从 1 个文件 → 全部工具源码），
 *   **判别力一个字不动**：仍然断言"找得到"，仍然对"改名/删掉"报红。
 *
 * ★ 顺序：`src/tools.ts` 在前，其余按文件名 —— 让"组装点"与"工具模块"有一个稳定顺序，
 *   而夹具里 `${TOOLS_CODE}` 的匹配结果与文件顺序无关（它们按大括号配平取块）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 工具实现的源码文件清单（`src/tools.ts` + `src/tools/**` 下的全部 `.ts`）。 */
export function toolsSourceFiles() {
  const files = [join(ROOT, 'src', 'tools.ts')]
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts')) files.push(full)
    }
  }
  walk(join(ROOT, 'src', 'tools'))
  return files
}

/**
 * 工具实现的**全部源码文本**，拼成一份（文件间用换行分隔）。
 *
 * ★ 为什么拼成一份而不是返回数组：既有夹具的用法是"在这份文本里找某个工具的块"，
 *   而"块"是**单个工具的连续源码**（按 `defineTool(` 大括号配平）。
 *   拼成一份之后，每一个工具的块仍然【连续且完整】—— 因为它们各自住在一个文件里。
 *   ⇒ 夹具的解析逻辑一行都不用改。
 */
export function toolsSource() {
  return toolsSourceFiles().map((file) => readFileSync(file, 'utf8')).join('\n')
}

/** 剥注释（既有夹具多处需要；它此前各自写了一遍）。 */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** 常用组合：工具源码面 + 剥注释。 */
export function toolsCode() {
  return stripComments(toolsSource())
}
