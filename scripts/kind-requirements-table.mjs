/**
 * ── t54：夹具拿到【kind 需求表】的**唯一入口** ────────────────────────────────────
 *
 * ── 为什么要有这个文件 ────────────────────────────────────────────────────────
 *
 * MEASURED（t54）：三条完工门（r5 / mutation / backtest）的 kind 守卫从**硬编码**
 * 改成了**问表** ⇒ 表必须由**调用方注入**（判据不许 import I/O）。
 *
 * ★ 而那让 **15 个既有夹具**同时变红：它们调那三条门时**没有注入表**
 *   ⇒ 门按新契约报 `unmeasured`（"表没能被咨询"）—— 而那正是契约要求的
 *   （不得静默退化成"这个 kind 不需要门"）。
 *
 * ── ★★ 而这个文件的形状来自一个**既有先例**（t39 的 `scripts/tools-source.mjs`）──
 *
 *   那次也是"9 个夹具各要读同一份东西"，而当时的定论是：
 *
 *     「把『源码面』的定义收进**一个地方**，而不是让 9 个夹具各自抄一份。」
 *
 *   因为 N 份拷贝会**分叉**，而分叉的那一刻，两个夹具测的就不再是同一件事 ——
 *   而它们在日志里同形。
 *
 * ⇒ 所以这里只定义一次"夹具怎么拿到那张表"，15 个夹具各 import 一次。
 *
 * ── ★★ 而它绝不是"放宽" ────────────────────────────────────────────────────────
 *
 *   它**只**提供**真的那张表**（从 `src/gates/completion/kind-requirements.json` 读），
 *   而**不提供**任何缺省/兜底：
 *
 *     · 读不到 ⇒ 抛错（夹具当场红）—— ★ 不是"当成空表"、也不是"当成默认要求"
 *     · 表坏   ⇒ 抛错
 *   ★ 理由（t54 的纪律）：一个**内置缺省表**会造出**两条来源**
 *     （数据文件 + 代码里的缺省），而"哪一条说了算"取决于 ctx 有没有注入
 *     ⇒ **在读的人眼里同形**。
 *     ⇒ 那会让"captain 自己就能调这张表"这句话**只在生产是真的**，
 *       而在夹具/别的调用方是假的 —— 而两者看起来一样。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────────
 *
 *     import { kindRequirementsTable } from './kind-requirements-table.mjs'
 *     const TABLE = kindRequirementsTable()          // 解析好的那张表
 *     ...ctx 里加：loadKindRequirements: () => TABLE
 *
 *   ★ 而夹具**每次**调它都会重新读盘（不缓存）—— 与生产同一条口径
 *     （"不缓存"是"改数据立刻生效"的成立条件）。
 *     要测"改数据 ⇒ 行为变"的臂，自己造一份表传给 ctx（见 t53/t54 的臂）。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RULES_PATH = join(ROOT, 'src', 'gates', 'completion', 'kind-requirements.json')

/**
 * 读**真的那张表**并解析它。
 *
 * ★ 读不到 / 表坏 ⇒ **抛错**（夹具当场红）。
 *   ★ 而**不**返回一个缺省表 —— 那会造出第二条来源（见文件头）。
 */
export function kindRequirementsTable(parseKindRequirements) {
  if (typeof parseKindRequirements !== 'function') {
    throw new Error(
      'kindRequirementsTable needs the gate\'s parseKindRequirements (import it from ../lib/gates/completion/r5.js) '
      + '— this helper deliberately does not carry its own copy of the validator, because two validators would drift',
    )
  }
  const parsed = parseKindRequirements(JSON.parse(readFileSync(RULES_PATH, 'utf8')))
  if (parsed.status !== 'loaded') {
    throw new Error(`the committed kind-requirements table must parse, got: ${JSON.stringify(parsed)}`)
  }
  return parsed
}

/** 那张表在盘上的位置（要给读的人看时用；也便于臂断言"读的是哪一份"）。 */
export const KIND_REQUIREMENTS_PATH = RULES_PATH
