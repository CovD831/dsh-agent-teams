/**
 * ── 判据：verify 由判据层重跑，不采信成员自报的 exitCode ──────────────────────────
 *
 * 插入点：`completion`（成员汇报完成时）
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-05，gate-probe 探针，上游 v0.1.22）：一个成员【零真实工作】，
 * 提交两条 acceptanceResults 全 passed（evidence 里直接写 "FABRICATED"）+ 两条
 * commandsRun 全 passed（exitCode 填伪造的 0，命令根本没跑，产物文件不存在），
 * 任务被判 completed —— 与真实完成（t3 干净基线）在判据层【不可区分】。
 *
 * 根因：`evaluateQualityCompletion` 只比对【条数与 status】，而 status/exitCode
 * 都是【成员自报的】。那等于把判据的输入交给被判的一方。
 *
 * ── 它为什么是一条【判据】而不是编排里的一个特例 ────────────────────────────────
 *
 * 这条逻辑最初硬编码在 `tools.ts` 的 update_task 里。搬进注册表后：
 *   · 编排层只调 `registry.evaluate('completion', ctx)`，不知道有这条判据；
 *   · 换/删这条判据不改编排代码；
 *   · 它有自己的三臂夹具（`verify-rerun.test.mjs`），进 verify 链。
 *
 * ── 执行器由调用方注入（保持判据本身是纯数据变换）──────────────────────────────
 *
 * 判据不 import 任何 I/O。它从 context 里取 `execVerifyCommand`；缺席时返回
 * `unmeasured`（★ 不是 `ok`）—— 没能重跑就不能声称验过了。
 */

import { ok, blocked, unmeasured, type GateVerdict } from '../registry.ts'

export const id = 'completion.verify-rerun'
export const point = 'completion'
export const description =
  '重跑任务声明的 verify 命令，与成员自报的 exitCode 比对；不一致即拒绝（防止伪造 passed）'

/**
 * 只对【本次试图置为 completed】且【声明了 verify 命令】的【非终态】任务生效。
 *
 * ★ 三个条件的由来，每条都有实测依据：
 *   · 非 completed 的中间状态不重跑 —— 没有裁决要复核；
 *   · ★ 任务【已经是终态】不重跑 —— issue159 的补证据路径：那是往已完成的任务上
 *     追加署名证据，不是一次新的完成裁决。重跑会用它今天的结果重新审判历史结论
 *     （实测：lifecycle-verify 的 issue159 夹具因此被误拒）；
 *   · 没声明 verify 的任务不重跑 —— 没有可重跑的东西。
 */
export function appliesTo(ctx: VerifyRerunContext | undefined): boolean {
  return ctx?.wantsCompleted === true
    && ctx?.taskNotTerminal === true
    && Array.isArray(ctx?.task?.verify)
    && ctx.task.verify.length > 0
}

interface VerifyRerunContext {
  task?: { id?: string; verify?: string[]; commandsRun?: CommandResult[] }
  update?: { commandsRun?: CommandResult[] }
  execVerifyCommand?: (command: string) => Promise<number>
  /** ★ 调用方表达的意图：本次是否试图置为 completed（判据据此决定要不要跑）。 */
  wantsCompleted?: boolean
  /** ★ 任务当前是否非终态（终态补证据不是新的完成裁决）。 */
  taskNotTerminal?: boolean
}
interface CommandResult { command: string; status?: string; exitCode?: number; evidence?: string }

export async function gate(ctx: VerifyRerunContext): Promise<GateVerdict> {
  const task = ctx?.task
  const update = ctx?.update
  const exec = ctx?.execVerifyCommand

  if (typeof exec !== 'function') {
    /**
     * ★ 没执行器 ⇒ `unmeasured`，不是 `ok`。
     *   一个不能重跑的判据如果返回 ok，那就是"装上了但从不生效"——
     *   比没装更坏，因为它会让人以为验过了。
     */
    return unmeasured(
      `verify re-execution is unavailable (no executor injected), so the ${task?.verify?.length ?? 0} declared verify command(s) could not be checked`,
    )
  }

  const claimed = update?.commandsRun ?? task?.commandsRun
  const byCommand = new Map((claimed ?? []).map((item: CommandResult) => [item.command, item]))
  const mismatches: Array<{ command: string; exitCode: number; claimedStatus: string }> = []
  const reruns: CommandResult[] = []

  for (const command of task?.verify ?? []) {
    let exitCode
    try {
      exitCode = await exec(command)
    } catch (error) {
      /**
       * ★ 执行器抛错 ⇒ 未测量，不是"命令失败"。
       *   两者不同形：前者说"我没能跑它"，后者说"它跑了并且失败"。
       *   把它们并成一类，会让一次基础设施故障伪装成一个关于工作的结论（§3.4）。
       */
      return unmeasured(`re-executing "${command}" raised: ${String((error as Error | undefined)?.message)}`)
    }
    if (!Number.isSafeInteger(exitCode)) {
      return unmeasured(`re-executing "${command}" returned a non-integer exit code: ${JSON.stringify(exitCode)}`)
    }
    const status = exitCode === 0 ? 'passed' : 'failed'
    reruns.push({
      command,
      status,
      exitCode,
      evidence: `re-executed by the quality gate on ${new Date().toISOString()}`,
    })
    const claimedItem = byCommand.get(command)
    if (claimedItem?.status === 'passed' && exitCode !== 0) {
      mismatches.push({ command, exitCode, claimedStatus: claimedItem.status })
    }
  }

  if (mismatches.length > 0) {
    return blocked(
      mismatches.map(
        (m) => `"${m.command}" re-executed by the quality gate exited ${m.exitCode} while the member reported passed`,
      ),
    )
  }

  /**
   * ★ 通过时【也把重跑结果交出去】—— 调用方要把它们并回 commandsRun，
   *   让落盘的 exitCode 是判据层亲眼看到的那个，而不是成员填的。
   *   否则"通过"这条路径上，成员伪造的 exitCode 仍然会留在记录里。
   */
  return { ok: true, reruns }
}
