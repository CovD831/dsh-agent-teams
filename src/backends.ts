/**
 * ── 线 C：后端能力位读数（`readouts.backends`）──────────────────────────────────
 *
 * ── 它回答的是哪两个问题（这两个问题不许合成一个）────────────────────────────────
 *
 *   ① **本队用了哪些后端** —— 一个 `string[]`（去重、已 trim）
 *   ② **每个后端声明了哪几个能力位** —— 一张**静态声明表**（`source: 'declared'`）
 *
 * ★ 两者**不同形**，因为它们的信息来源不同：
 *   · ① 来自**盘上的 durable 记录**（`<stateRoot>/<teamId>/team.json` 的
 *     `members[].provider`）—— 它是**测量**，每个队可以不一样；
 *   · ② 来自**本文件的一张表** —— 它是**声明**，与哪个队、哪次运行都无关。
 *   ⇒ 所以 ② 的每一项都带 `source: 'declared'`：它今天**不是**一致性测试的结论，
 *     而"声明"与"验证过的"必须能一眼分开（`'conformance'` 那一档留给将来真去
 *     探后端的实现，今天不产）。
 *
 * ── ★★★ 为什么"本队用了哪些后端"只能读盘（不是偷懒）──────────────────────────
 *
 * `ReadoutContext` 只有三格（`teamId` / `stateRoot` / `historic`），**没有 `ctx`**。
 * 而"这一队用了哪些后端"在内存里没有任何权威副本 —— 成员的 route 是创建那一刻
 * 解析出来并**落进成员记录**的（见 `TeamMember.provider` 的注释）。
 * ⇒ 唯一的真源就是那份 durable 记录，而读它的既有入口是 `readTeamEx`
 *   （`src/state.ts`，三态：`found` / `no-team` / `no-region`）。
 *
 * ★ **不许**为了"让读数里有东西"而从 ctx / 进程环境 / harness 反查 provider：
 *   `ReadoutContext` 刻意不带 `ctx`（见 `src/readouts.ts` 的注释），
 *   而绕过它去别处摸一个全局 —— 那会让"这条读数测到了什么"无法回答。
 *
 * ── ★★ 四态（本线最容易被合并掉的地方）─────────────────────────────────────────
 *
 * ```
 *   no-region:          区（stateRoot）本身不在 / 读不了 ⇒ 去查路径或权限
 *   no-team:            区在，但里面没有这个队   ⇒ 那个队确实不在了
 *   no-provider-record: 队读到了，但**没有任何成员记下 provider** ⇒ 去查成员创建路径
 *   （正常）             providers: [...]                    ⇒ 这就是这一队的后端清单
 * ```
 *
 * ★ 四者**不许合并**：它们的补救动作完全不同（查路径 / 查归档 / 查写点 / 不用改）。
 *   合并成一句"读不到后端"会让"我配错了"与"这个队压根没用过后端"同形。
 *
 * ★ `no-provider-record` **不等于** `providers: []`：
 *   前者是"这一格没被记下来"（可能有人手改过 team.json，或那是一个早于本字段的队），
 *   后者是"记下来了，就是零个"—— 而后者在本函数里**不出现**（`providers: []`
 *   只在成员全无 provider 时才可能，而那种情况恰好就是 `no-provider-record`）。
 *   把两者合成一个空数组，会让"没记"悄悄地读成"没有"。
 *
 * ── ★ `readTeamEx` 的抛出**一律不 catch** ──────────────────────────────────────
 *
 * 它会抛的情况是开放的、且**异质**的：invalid state（记录形状坏了）、截断的 JSON、
 * 空文件、权限错误……任何单一前缀都会把这些不同的成因合并成一句话，
 * 而"记录坏了"与"读不到"要修的地方完全不同。
 * ⇒ 交给读数容器（`src/readouts.ts`）统一落成 `{ unmeasured: '…threw(原因)…' }`：
 *   那里会**原样带出错误消息**，于是成因仍然可读。
 *
 * ── ★ 已知缺口（如实记账，不在本文件修）──────────────────────────────────────────
 *
 * `docs/TEAM-CONTROL-PLANE-SPEC.md` §23.1 的硬约束 #1 是"容器 context 必须
 * **一次读盘、多格共享**，不得每格各读一次"。而 `ReadoutContext` 只有三格原始值，
 * **没有一个共享的读取句柄** ⇒ 线 A（`src/evidence.ts`）与本文件各 `readTeamEx`
 * 一次 = **每次轮询 2 次读盘**。
 *
 * ★ 本文件**不**用模块级缓存去凑这一条：那正是 §23.1 驳回的第二份真相
 *   （缓存与投影的区别是"投影没有写入端"，而一个跨调用的缓存有写入端）。
 * ⇒ 要兑现它得改 `readouts.ts` / `snapshot.ts`（容器层，不在本线范围内），
 *   或者由契约裁定加一个"每轮一次读"的句柄。**未做，留给裁定。**
 *
 * @module dsh-agent-teams/backends
 */

import type { ReadoutProvider } from './readouts.ts'
import { readTeamEx } from './state.ts'
import type { TeamState } from './types.ts'

/**
 * 后端能力位的**封闭清单**。
 *
 * ★ 为什么是封闭联合而不是 `Record<string, boolean>`：一张开放的能力位表会让
 *   "这个后端有没有 X"与"我拼错了 X"在读数上同形（拼错的那个键永远查不到值，
 *   而读的人会把它读成 `false`）。加一位是**契约变更**，不是本地改动。
 */
export const BACKEND_CAPABILITY_BITS = [
  /** 交付时能自报改动了哪些路径（不是"声称"，而是可核的那一份）。 */
  'reportsChangedPaths',
  /** 能在本机执行命令（verify 重跑这类判据的前提）。 */
  'canExec',
  /** 会把工具调用暴露给会话（审计/追溯的前提）。 */
  'exposesToolCalls',
  /** 会话可被冷恢复续跑。 */
  'resumable',
  /** 文件系统与主检出隔离（worktree 纪律的前提）。 */
  'isolatesFs',
] as const

/** 一个能力位的名字。 */
export type BackendCapabilityBit = (typeof BACKEND_CAPABILITY_BITS)[number]

/** 一个后端的**完整**能力位声明（五位都必须在，缺一位就是没声明）。 */
export type BackendCapabilities = Readonly<Record<BackendCapabilityBit, boolean>>

/**
 * ── ★★ 静态声明表：今天**没有任何条目**，而这是一个**决定**，不是一个遗漏 ─────────
 *
 * 本表要回答的是"某个后端**声明**了哪几个能力位"。而**盘上没有任何一处**能支撑
 * 某个具体后端的取值：
 *
 * ```
 *   grep -rn "reportsChangedPaths\|canExec\|exposesToolCalls\|resumable\|isolatesFs" src/
 *   ⇒ 只有本文件（这五个名字是契约给的，本仓没有第二个真源）
 *   宿主的能力位是另一套（`{agentOptions, outputSchema, depthLimit}`，
 *   见 src/harness-compat.ts:68 的世代记录），且 `ReadoutContext` 没有 `ctx` 可供探测
 * ```
 *
 * ⇒ 于是**任何**填进来的条目都会是猜的。而"猜一个 `canExec: true`"的代价是具体的：
 *   UI 会据此认为"这个后端的 verify 能重跑"，而那条判据在该后端上其实无从执行 ——
 *   这正是本仓反复记账的形态（**没测到并进通过**）。
 *
 * ★ 所以今天的读数是：每个 provider 都落 `unknown-backend: …`（见
 *   `capabilityOf`）。它诚实、可读、且一眼看得出"缺的是声明，不是实现"。
 * ★ 要填它的人**必须带着依据来**（宿主文档 / 实测），并按 `source` 的语义
 *   决定填 `'declared'`（本插件声明）还是等 `'conformance'`（真去探）那一档。
 *   ★ 填表是**契约动作**，不是实现细节。
 */
export const DECLARED_BACKENDS: Readonly<Record<string, BackendCapabilities>> = Object.freeze({})

/**
 * 一个后端的能力位读数 —— **两态，不同形**。
 *
 * · 表里有 ⇒ `{ capabilities, source: 'declared' }`（五位齐全、带来源）
 * · 表里没有 ⇒ `{ unmeasured: 'unknown-backend: …' }`
 *   ★ **不许**退化成"五位都是 false"：那读起来就是"查过了，这后端什么都不会"，
 *     而事实是"没人声明过它"。`false` 是一个断言，`unmeasured` 不是断言。
 */
export type BackendCapabilityReading =
  | { readonly capabilities: BackendCapabilities; readonly source: 'declared' }
  | { readonly unmeasured: string }

/** 一个能力位声明是否**完整**（五位都是布尔）。★ 半张表比没有表更危险。 */
function isCompleteCapabilities(value: unknown): value is BackendCapabilities {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return BACKEND_CAPABILITY_BITS.every((bit) => typeof record[bit] === 'boolean')
}

/**
 * 查一个后端的能力位。
 *
 * @param providerId - 已 trim 的后端 id（调用方保证）。
 * @param table - 声明表；**默认就是** {@link DECLARED_BACKENDS}。
 *   ★ 参数化不是为了"让夹具能造假读数"，而是为了让**未知后端那一支**与
 *     **已声明那一支**都能被夹具钉住（`source: 'declared'` 这个标记本身要有一条臂）。
 *     生产路径永远用缺省值。
 * @throws 表里那个条目自己形状坏了（缺位 / 非布尔）—— 那是一个**写坏的声明**，
 *   必须当场现形，而不是被读成一个"部分能力"的后端。
 */
export function capabilityOf(
  providerId: string,
  table: Readonly<Record<string, BackendCapabilities>> = DECLARED_BACKENDS,
): BackendCapabilityReading {
  if (!Object.prototype.hasOwnProperty.call(table, providerId)) {
    return {
      unmeasured: `unknown-backend: "${providerId}" is not in the declared capability table (src/backends.ts DECLARED_BACKENDS has ${Object.keys(table).length} entries), so none of its ${BACKEND_CAPABILITY_BITS.length} capability bits was measured — a capability that nobody declared must not be guessed, and must not be rendered as "false" (that would read as "checked: this backend can do nothing")`,
    }
  }
  const declared = table[providerId]
  if (!isCompleteCapabilities(declared)) {
    throw new Error(`the declared capability entry for backend "${providerId}" is incomplete: expected all of ${BACKEND_CAPABILITY_BITS.join(' / ')} as booleans, got ${JSON.stringify(declared)} — a partial entry would make "we never declared this bit" and "we declared it false" look identical`)
  }
  return { capabilities: { ...declared }, source: 'declared' }
}

/**
 * 从一份 team 记录读"本队用了哪些后端"。
 *
 * ★ 三条**都不可省**（每一条都对应一个假阳性）：
 *   ① `typeof === 'string'` —— 手改过的 team.json 可能塞进 `null` / 数字；
 *   ② **用 `p.trim()` 的值，而不是原值** —— `' fake '` 与 `'fake'` 是同一个后端；
 *   ③ **trim 之后再 `Set` 去重** —— 先 `Set` 后 `trim` 去不掉它们
 *      （`new Set(['fake', ' fake '])` 长度是 2，这是本线最容易写错的一行）。
 *   ④ 空白串（`''` / `'   '`）**不进**结果 —— 它不是"一个叫空字符串的后端"，
 *      而是"这一格没有值"。
 *
 * ★ 顺序 = 首次出现序（`members[]` 的顺序），于是同一份记录两次跑得到同一个数组
 *   （读数要做 golden 对比，随机/哈希序会让夹具红得莫名其妙）。
 *
 * ★ 不按 `status` 过滤：`removed` 的成员**用过**那个后端 —— 那是这个队的历史事实。
 *   过滤会让"这个后端在本队用过，只是那个人已经退场"从读数上消失。
 */
export function providersOf(team: TeamState): string[] {
  const providers: string[] = []
  const seen = new Set<string>()
  for (const member of team.members) {
    const raw: unknown = member.provider
    if (typeof raw !== 'string') continue
    const provider = raw.trim()
    if (provider === '') continue
    if (seen.has(provider)) continue
    seen.add(provider)
    providers.push(provider)
  }
  return providers
}

/**
 * 线 C 的读数提供者。
 *
 * 产出（正常）：
 * ```ts
 * { providers: ['fake'], capability: { fake: { unmeasured: 'unknown-backend: …' } } }
 * ```
 * 产出（三态之一，各自一行、各自一句原因）：
 * ```ts
 * { unmeasured: 'no-region: …' } | { unmeasured: 'no-team: …' } | { unmeasured: 'no-provider-record: …' }
 * ```
 *
 * ★ 失败态**不带 `providers: []`**：一个空数组会让"没读成"与"读成了、零个"
 *   在只读 `providers.length` 的 UI 上同形。⇒ 键根本不出场（本仓三态纪律：
 *   缺席 ≠ 空 ≠ 未测量）。
 * ★ 不 `try`/`catch`（理由见文件头）：`readTeamEx` 的抛出交给容器。
 * ★ 不读墙钟、不读 `historic`：归档队的后端清单照样是**盘上的事实**，
 *   而"它是历史"不改变"它用过哪个后端"。
 */
export const provideBackendsReadout: ReadoutProvider = async ({ teamId, stateRoot }) => {
  const read = await readTeamEx(stateRoot, teamId)

  if (read.kind === 'no-region') {
    return {
      unmeasured: `no-region: the state root "${stateRoot}" is not a readable directory, so team "${teamId}" could not be looked up at all — this is "the region (workspace state dir) is wrong or unreadable", not "the team is gone" and not "the team has no members"`,
    }
  }
  if (read.kind === 'no-team') {
    return {
      unmeasured: `no-team: the state root "${stateRoot}" is readable but has no team "${teamId}" (expected ${stateRoot}/${teamId}/team.json) — this is "that team is not here (archived / never created)", not "the region is wrong"`,
    }
  }

  const providers = providersOf(read.team)
  if (providers.length === 0) {
    return {
      unmeasured: `no-provider-record: team "${teamId}" was read (${read.team.members.length} member(s)) but no member records a usable provider (members[].provider is absent, blank, or not a string) — this is "the member route was never persisted", not "the team used zero backends"`,
    }
  }

  const capability: Record<string, BackendCapabilityReading> = {}
  for (const provider of providers) capability[provider] = capabilityOf(provider)
  return { providers, capability }
}
