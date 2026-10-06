/**
 * ── 判据：产物相对【上次审查时的版本】变了没有 —— 什么时候该做对抗性审查 ────────────
 *
 * 插入点：`admission`（成团【之前】：这份需求 / 计划够不够格进场）
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * 用户的原话，就是这一整段存在的理由：
 *
 *     「以前这些都是手动做的，什么时候触发也是凭我的个人经验。」
 *
 * ⇒「凭经验决定何时触发」= 一条**靠人执行的规则**，而本项目的文档已经反复证明
 *   这类规则会腐烂（判据层存在的理由本身就是"不采信自述"）。
 *
 * 这条判据把触发条件换成一个**机械可判的问题**：
 *
 *     产物（需求 / 计划文档）相对【上次被审查时的那个版本】变了没有？
 *
 * 变了 ⇒ 触发一次对抗性审查（`blocked`：**告警，不是拒绝流程**）；
 * 没变 ⇒ 再开一轮审查是白花的预算（用户抱怨过的"繁琐、重"）。
 *
 * ── ★ 「上次审查的版本」为什么必须是 git rev（用户已裁定）────────────────────────
 *
 * 三个候选，只有第三个不可伪造：
 *
 *     ① 内容 hash（本判据自己算）  —— 判据于是要读盘 ⇒ 有 I/O；更坏的是
 *        **"上次审查时的内容"与"现在的内容"会由同一次读产生** ⇒ 两者恒等 ⇒
 *        整条判据恒真（本队记账的第一种恒真写法）。
 *     ② 自报的"我审过了最新版"     —— 把判据的输入交给被判的一方。本队为这条
 *        已经交过学费（`dispatch.changed-paths` / `completion.verify-rerun` 同源）。
 *     ③ **git 版本（rev）**        —— 用户裁定：「不可伪造，比内容 hash 或自报强」。
 *        它由 git 产生、由调用方读，判据只做**字符串比较**。
 *
 * ⇒ 所以两半都是**调用方注入的观察**，本判据不自报、不算、不读盘。
 *
 * ── ★ 与本队那两条判据的分工（三条互不重复，也不许合成一条）────────────────────
 *
 *     `dispatch.changed-paths`（已有）  自报的改动清单 vs 会话事件里的真实写入（**代码**）
 *     `admission.absorb`     （t7）     自报的「已吸收」  vs 产物真的变了（**文档**·内容）
 *     本判据                 （t6）     产物【现在的版本】vs 上次审查时的版本（**版本**）
 *
 * ★ 本判据与 `absorb` 的两个问题**不同形**，这是它们必须同时存在的理由：
 *
 *     absorb  问：「审查意见**进没进产物**」—— 一次编辑的**存在性**（内容变了没有）
 *     本判据  问：「这一次改动**被审过没有**」—— 一个版本的**审查状态**
 *
 *   一个主会话可以**真的改了文档**（absorb 满意）而那份改动**从没被审过**
 *   （本判据必须报警）—— 这正是循环的第五格「④ 吸收 ⇒ 产物被改动 ⇒ ⑤ 要不要再审」。
 *   把两条合成一条，会让"改了但没审"与"没改"在日志里同形。
 *
 * ★ 而它**不是** absorb 的重复的第二个证据：absorb 的输入里**没有任何版本号**，
 *   本判据的输入里**没有内容**。两条判据观察的是两种不同的东西，
 *   所以两条合起来才覆盖"吸收 ⇒ 需要再审"这半步。
 *
 * ── 三态，且后两者不同形（契约 §3.4）────────────────────────────────────────────
 *
 *   ok          —— 测成了：产物相对上次审查的版本**没变** ⇒ 不需要再审
 *   blocked     —— ★ 测成了：**有未审改动** ⇒ 触发对抗性审查（告警 + 证据，不拒流程）
 *   unmeasured  —— ★ 没能测量：读不到会话事件 / 不是 git 仓库 / 拿不到版本
 *
 * ── ★★ 「拿不到版本」与「没改动」必须不同形（本任务验收单列的一条）──────────────
 *
 * 这是本判据最容易写错、而且错了以后看起来最好的地方：
 *
 *     `current === reviewed`  ⇒ ok          （测了，没变）
 *     `current === undefined` ⇒ **unmeasured**（★ 不是 ok）
 *
 * 一个"版本读不出来就当没变"的实现，在**非 git 仓库**里会把每一次都读成"不用再审"
 * —— 于是这条判据在最需要它的地方（一个新项目、还没 git init）**永远沉默**，
 * 而它沉默的样子与"审过了、没问题"一模一样。那是本队记账的"把没测到并进通过"。
 *
 * ⇒ 判据里**不允许**出现 `?? <某一个版本>` 这种兜底（那会让两个版本相等）。
 *   一个版本缺席就是"这一次没能测"，不是"这一次相等"。
 *
 * ── 三条不可协商的性质（契约 §2）──────────────────────────────────────────────
 *
 * ① 纯数据变换：本文件不 import 任何 I/O（不 import node:child_process，也不
 *    import `src/worktree.ts` —— 那是个 I/O 模块）。git 版本、会话事件、时钟
 *    全部由调用方注入；缺席时返回 `unmeasured`。
 * ② 不调用别的判据（`admission.absorb` 也读产物，但两者不互相调用）。
 * ③ 三态：ok / blocked / unmeasured，且后两者不同形。
 */

import { ok, blocked, unmeasured, type GateVerdict } from '../registry.ts'
import { normalizeWorkspacePath } from '../../quality-gates.ts'
import type { CtxPaths } from '../requires.ts'

export const id = 'admission.checkpoint'
export const point = 'admission'
export const description =
  '把产物（需求 / 计划文档）【现在的 git 版本】与【上次审查时的 git 版本】比较：有未审改动 ⇒ 触发对抗性审查（告警，不拒流程）；拿不到事件或版本 ⇒ unmeasured，绝不是 ok'

/**
 * ── ★ 输入面声明（B 层，编译期）────────────────────────────────────────────────
 *
 * ★ 与本队其余判据同一条纪律：这里声明的**不是"ctx 上有个字段"**，而是
 *   "**有人真的去看过**"。四格全部是【调用方注入的观察】：
 *
 *     `documents`        —— 产物是哪几份（要读仓库才知道；判据不做 I/O）
 *     `currentRevisions` —— 每份产物**现在**的 git 版本（要跑 git 才知道）
 *     `reviewedRevisions`—— 每份产物**上次审查时**的 git 版本（要读审查记录才知道）
 *     `observedDocumentWrites` —— 会话事件里这个主会话**真的写过**哪些产物
 *
 * ★ 为什么 `currentRevisions` 与 `reviewedRevisions` 是**两格**而不是一格"改过没有"：
 *   合成一格（`changed?: boolean`）会让本判据变成**恒真**的一种写法 —— 那个布尔值
 *   是**调用方替判据做了决定**，判据只剩下把它转写成裁决。而本判据的全部价值
 *   恰恰在"比较两个版本"这一步：定向突变"把比较改成恒真/恒假"就是打在这一步上的。
 *   两格分开，判据才真的在比较；也只有这样，"从哪个版本到哪个版本"才写得出来
 *   （验收 ②：输出要指名字典级的证据，而不是笼统一句"你该审了"）。
 *
 * ★ `reviewedAt` / `now` **不进 requires**：它们是**可选**的（见下面 interface），
 *   缺席 ⇒ 输出里少一句"距上次多久"，而裁决本身不变。声明它们会让核对层在
 *   每一个没注入时钟的调用点上报一格缺失 —— 而那是**正常情形**，它会把
 *   一句本可以读出来的话（"这条判据要的观察面接没接上"）淹没在噪音里
 *   （requires.ts 的闸门那一节：不适用就不报）。
 *
 * ★ `task.kind` **不进 requires**：它是闸门（见 `appliesTo`）。声明它会让
 *   每一次 `kind=implementation` 的派发都产出一份缺格清单 —— 而那种 ctx 上
 *   本判据按设计闭嘴。"不适用"与"缺输入"必须不同形。
 */
export const requires: CtxPaths<CheckpointContext>[] = [
  'documents',
  'currentRevisions',
  'reviewedRevisions',
  'observedDocumentWrites',
]

/**
 * ── 本判据的 ctx（★ 导出：`requires` 的类型参数点名它，夹具也用它）────────────
 */
export interface CheckpointContext {
  /** 任务标识（只为写进告警的人话里；裁决不依赖它）。 */
  task?: { id?: string; kind?: string }
  /**
   * ── ★ 产物文档（需求 / 计划），workspace 相对路径 ─────────────────────────────
   *
   * 由调用方给出（判据不做 I/O，所以"产物是哪几份"也是交进来的一部分事实）。
   *
   * ★ 缺席与空数组**不同形**（与 `admission.absorb` 的 `producedDocuments` 同一条）：
   *
   *     缺席   ⇒ 判据不知道产物是什么        ⇒ unmeasured（没人接线 / 读不到）
   *     `[]`   ⇒ 判据知道产物集，而它是空的  ⇒ blocked（可判定的事实：没有产物）
   *
   * 把两者合成一个 `?? []`，会让"没人接线"与"确实没有产物"在日志里同形，
   * 而补救动作完全不同（去接线 vs 回去写需求文档）。
   */
  documents?: string[]
  /**
   * ── ★ 每份产物【现在】的 git 版本（`git rev-parse` 的结果）────────────────────
   *
   * `undefined` 作为**整个对象的缺席**与**某一份产物的缺席**必须都不同形于"版本相同"：
   *
   *     整个对象缺席        ⇒ 没人接线（没能观察）      ⇒ unmeasured
   *     `{ 'a.md': undefined }` ⇒ 这一份读不出 git 版本 ⇒ unmeasured
   *     `{ 'a.md': 'abc123' }`  ⇒ 读到了               ⇒ 参与比较
   *
   * ★ 一个"读不到就填个占位串"的调用方会把本判据变成恒真或恒假（取决于占位串
   *   与 reviewed 值的关系），而判据自己看不出来 —— 所以这里只接受
   *   `string`（非空白）或 `undefined`，其余形状（数字、null、空串）一律读作
   *   "这一份没读到"（★ 不是"等于某个版本"）。
   */
  currentRevisions?: Record<string, string | undefined>
  /**
   * ── ★ 每份产物【上次审查时】的 git 版本 ──────────────────────────────────────
   *
   * 键**缺席**（从没审过这一份）与键在场但值是空串/非字符串**不同形**：
   *
   *     键缺席         ⇒ 这一份从没被审过 ⇒ 一次都还没审 ⇒ 有未审改动（触发）
   *     键在场、值合法  ⇒ 拿它去比现在的版本
   *     键在场、值非法  ⇒ ★ 审查记录读坏了 ⇒ unmeasured（不是"从没审过"）
   *
   * ★ 第三条是刻意的：一份**坏掉的**审查记录与一份**不存在的**审查记录，
   *   补救动作完全不同（去修记录 vs 去开一轮审查）。把坏的读成"从没审过"
   *   会让判据常态化地多开审查，而"多开"这个方向的代价是预算 —— 更要命的是
   *   它**掩盖**了记录正在腐烂这个事实。
   */
  reviewedRevisions?: Record<string, string | undefined>
  /**
   * ★ 上次审查的时刻（epoch ms）。与 `now` **配对**使用，缺一不出话。
   *
   * 它**不是**触发条件的一部分（触发只看版本），它只让告警里能写出
   * 「距上次审查 3 小时」—— 验收 ② 要求输出说清"距上次多久"，
   * 而一个**只有版本号**的告警读起来仍然像"你该审了"。
   */
  reviewedAt?: number
  /**
   * ★ 现在（epoch ms）。由调用方注入 —— 判据**不读时钟**（与
   *   `runtime.liveness` 同一条纪律：时钟是注入的，判据是纯函数）。
   */
  now?: number
  /**
   * ── ★ 会话事件里，这个主会话**真的写过**哪几份产物（workdir 相对路径）────────
   *
   * 由调用方从 `sessionOwnEvents(session)` 的 `tool/result → meta.diffs[].path`
   * 折叠得到（与 `dispatch.changed-paths`、`harness-compat.observedChangedPaths`
   * 同一个入口、同一个取法 —— ★ 不是同一格，见下）。
   *
   * `undefined`（没能观察）与 `[]`（观察了，确实没写过）必须不同形 ——
   * 这是本队已经立过多次的界线，也是 `observedChangedPaths` 那条注释的原话。
   *
   * ★ 它与版本面**分工不同，且不许互相顶替**：
   *
   *     版本面回答：产物**变了没有**（git 说它现在是不是另一个版本）
   *     本格回答：  **谁动的**、以及"我有没有能力看到谁动了"
   *
   *   一个成员/主会话可以**真的改了产物**（版本面变了），而它的会话事件里
   *   一条 `tool/result` 都没有（改的是别的东西 / 事件读不到）—— 那时版本面
   *   仍然能报出"有未审改动"，而本格只能说"不知道是谁写的"。
   *   ⇒ 所以"读不到事件"**不推翻**版本面的结论（见下面 gate() 里的排序）：
   *     它降级的是**证据的完整性**，不是"变了没有"这个事实。
   *
   * ★★ 反过来才是本队记账的"读错位置的出口"：拿 `observedChangedPaths`
   *   （**工作区全部路径**）顶替本格。一个主会话改了十个源文件、产物一行未动，
   *   在那一格上非常热闹 —— 用它判"产物动过"，本判据就成了恒真。
   */
  observedDocumentWrites?: string[]
}

/**
 * ── 闸门：什么时候这条判据说话 ────────────────────────────────────────────────
 *
 * 只对【有产物】的 `requirements` / `review` 阶段生效 —— 也就是"成团之前"。
 *
 * ★ 为什么闸门是 **`documents` 在场**（而不是只看 kind）：
 *
 *   用户这一轮裁定的是「检查点：产物相对上次审查的版本变了 ⇒ 触发」。
 *   触发条件里没有"这一轮是什么 kind"这个东西 —— 一个 `work` 类任务里，
 *   主会话照样可能刚改完需求文档、要做一次再审。把闸门收成 kind 白名单，
 *   会让"改了需求却因为 kind=work 而没人再审"变成一个**判据看不见**的形态。
 *
 *   ⇒ 闸门 = 「**有人在问这件事**」：调用方交出了一份产物清单。没交出清单
 *     （`documents` 缺席）⇒ 这条判据这一轮不说话（`skipped`），
 *     而不是开火说"你没有产物"。
 *
 * ★ 这与 `admission.absorb` 的闸门（`absorb.claims` 在场）是同一条口径：
 *   闸门管"说不说话"，requires 管"说话时缺不缺输入"（requires.ts 的那一节）。
 */
export function appliesTo(ctx: CheckpointContext | undefined): boolean {
  /**
   * ★ 用 `Array.isArray` 而不是 `ctx?.documents !== undefined`：一个把
   *   `documents` 交成字符串/对象的调用方，在这里被读作"这一轮没有说话"，
   *   而不是"有产物、但形状不对" —— 后者会让判据在一份形状错的 ctx 上
   *   开火，而它连"该比哪几份"都还没拿到。
   */
  return Array.isArray(ctx?.documents)
}

/** 一个合法的 git 版本：非空白字符串。其余形状（数字 / null / 空串 / 对象）都不算。 */
function isRevision(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * 版本面的一格读数。**三态**（与判据自己的三态同源）：
 *
 *     { kind: 'read',    revision }  —— 读到了这个版本
 *     { kind: 'missing' }            —— ★ 这一次【没读到】：键缺席，或值是 `undefined`
 *     { kind: 'invalid' }            —— ★ 格子在场、值也在场，但它不是版本
 *
 * ── ★ `undefined` 落在 `missing` 而不是 `invalid`：这不是风格，是那句注释的实现 ──
 *
 * interface 里对 `currentRevisions` 写的是「只接受 `string`（非空白）或 `undefined`」——
 * 因为调用方的**诚实表示法**就是 `{ 'a.md': undefined }`：
 *
 *     git rev-parse 这一份失败  ⇒  调用方如实交出 `undefined`
 *
 * ⇒ 若把 `undefined` 读成 `invalid`（"记录坏了"），那么**每一次真正的读取失败**
 *   都会被判据读成"审查记录腐烂了" —— 判据会常态化地报一个关于**记录健康**的
 *   问题，而真正发生的事是"这一次没读到"。两种情形的补救动作不同（去修记录 vs
 *   去看为什么读不到），而它们的读数会一模一样。
 *
 * ★ 剩下的才是 `invalid`：一个**在场但不可能成立**的值（数字 / 空串 / 对象 /
 *   `null`）。那些值不可能由一次诚实的 git 读取产生 —— 它们只可能来自一份
 *   坏掉的记录或一个写错的调用方。这一支仍然必须存在，且必须与 `missing` 不同形：
 *   把"坏记录"读成"从没审过"会让判据常态化地多开审查，从而**掩盖**记录在腐烂。
 */
type RevisionRead =
  | { kind: 'read'; revision: string }
  | { kind: 'missing' }
  | { kind: 'invalid' }

function readRevision(bag: Record<string, unknown> | undefined, path: string): RevisionRead {
  if (bag === undefined || bag === null || typeof bag !== 'object' || Array.isArray(bag)) return { kind: 'missing' }
  if (!Object.prototype.hasOwnProperty.call(bag, path)) return { kind: 'missing' }
  const value = bag[path]
  /** ★ `undefined` = "这一格没读到"（诚实表示法），不是"记录坏了"。 */
  if (value === undefined) return { kind: 'missing' }
  if (isRevision(value)) return { kind: 'read', revision: value }
  return { kind: 'invalid' }
}

/** `undefined` 的键与缺失的键都读作"没读到"—— ★ 不是"等于某个版本"。 */
function isRevisionBag(value: unknown): value is Record<string, string | undefined> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 「距上次多久」的人话。三个输入缺一个就不说 —— 一个用 0 兜底的实现会写出
 * 「距上次审查 0 分钟」，而那与"刚刚审过"同形（本判据存在的理由就是分辨这个）。
 */
function humanAge(reviewedAt: unknown, now: unknown): string | undefined {
  if (typeof reviewedAt !== 'number' || !Number.isFinite(reviewedAt)) return undefined
  if (typeof now !== 'number' || !Number.isFinite(now)) return undefined
  const delta = now - reviewedAt
  /**
   * ★ 时钟倒退（`delta < 0`）不许折成 0：那会让"记录里的时刻在未来"
   *   （注入错、时钟漂移、恢复自另一个进程）伪装成"刚刚审过"。如实说出来。
   */
  if (delta < 0) {
    return `${Math.round(-delta / 1000)}s in the FUTURE relative to the injected clock, which cannot be read as "just reviewed"`
  }
  const seconds = Math.round(delta / 1000)
  if (seconds < 90) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes}m ago`
  const hours = (minutes / 60).toFixed(1)
  return `${hours}h ago`
}

export function gate(ctx: CheckpointContext): GateVerdict {
  /**
   * ── ★ 先问"这次能不能观察"，而不是先问"产物是什么" ──────────────────────────
   *
   * 顺序是刻意的（与 `admission.absorb` 同一条）：闸门不进 `requires`，
   * 所以**判据要自己对它负责**。一个没有 `documents` 的 ctx 走到这里，
   * 正确答案是"我没能测量"，**不是**"产物一个都没有 ⇒ 拒绝" ——
   * 后者会在一份完全合规的 ctx 上开火，而误伤的代价比漏报更贵（§3.5）。
   */
  const documents = ctx?.documents
  if (!Array.isArray(documents)) {
    return unmeasured(
      'the requirement/plan documents for this run could not be observed (documents was not provided), so "has the artefact moved since it was last reviewed" is not a question this run can answer',
    )
  }

  /**
   * ── ★★ 版本面读不到 ⇒ unmeasured，**绝不是 ok** ─────────────────────────────────
   *
   * 这是本任务验收单列的一条。★ 两半都要：整个对象缺席（没人接线）与
   * 某一格的形状不对（读坏了）**都**落在这一支上 —— 但它们说的是同一件事：
   * "我没能拿到版本"。★ 而"某一格没读到"由下面的每份产物各自处理（见 `unknown`
   * 那一支），因为那时**别的**产物仍然比较得出来。
   *
   * ★ 一个 `?? {}` 兜底（把一个缺席的观察面读成空对象）会让下面每一份产物
   *   都落进 `unknown` 那一支 —— 恰好也是 unmeasured。那不算错，但它把
   *   "没人接线"与"接线了、只是这一份没读到"合成同一句话，而它们的补救动作
   *   不同（去接线 vs 去看为什么 git 读不出这份文件）。所以在**入口**就分开说。
   */
  const currentBag = ctx?.currentRevisions
  if (!isRevisionBag(currentBag)) {
    return unmeasured(
      'the current git revision of the produced documents could not be observed (currentRevisions was not provided), so "has the artefact moved" could not be measured — this is "not measured", not "unchanged"',
    )
  }
  const reviewedBag = ctx?.reviewedRevisions
  if (!isRevisionBag(reviewedBag)) {
    return unmeasured(
      'the git revision the documents were last reviewed at could not be observed (reviewedRevisions was not provided), so "has the artefact moved since the review" could not be measured — this is "not measured", not "unchanged"',
    )
  }

  /**
   * ── 会话事件那一格：`undefined` ⇒ 没能观察 ────────────────────────────────────
   *
   * ★ 它与版本面**不同形**，所以它**不推翻**版本面的结论（见下面 gate 的排序），
   *   但它决定告警里能不能写出"是这一侧真的写过"这份证据。
   *
   * ★★ 缺陷（本队记账的"守卫检查了另一个同名的东西"）会在这里长出来：
   *   一个把 `?? []` 写进去的实现，会让"没能观察事件"读成"观察了、没写过"
   *   —— 于是每一份产物都成了"没写过"（隐瞒）。那是**说谎**，不是保守。
   */
  const observedWrites = ctx?.observedDocumentWrites
  if (observedWrites !== undefined && !Array.isArray(observedWrites)) {
    return unmeasured(
      'this session\'s write history was injected in a shape that is not a list, so which produced documents this session wrote could not be read (a malformed observation is "not measured", not "nothing was written")',
    )
  }

  const age = humanAge(ctx?.reviewedAt, ctx?.now)

  /**
   * ── 规整产物清单（非法路径单独交出来，不静默丢弃）─────────────────────────────
   *
   * 与 `dispatch.changed-paths` 的 `bucket` 同构：判据要做的是"两个版本之间的
   * 字符串比较"，而一个绝对路径 / 带 `..` 的路径**没法**与 git 的相对版本对上 ——
   * 静默丢掉它会让"这一份没被比较"读起来像"这一份没变"。
   */
  const legal: string[] = []
  const illegal: string[] = []
  for (const raw of documents) {
    const normalized = normalizeWorkspacePath(raw)
    if (normalized === undefined) illegal.push(String(raw))
    else if (!legal.includes(normalized)) legal.push(normalized)
  }

  const blockers: string[] = []
  for (const path of illegal) {
    blockers.push(
      `"${path}" was listed as a produced document but is not a workspace-relative path, so its revision can never be compared with what git reports (absolute paths and ".." have no revision to compare)`,
    )
  }

  /**
   * ★ 产物一个都没有 ⇒ **可判定的事实**，不是"没能测量"（本队那条跨层规则）。
   *   这与上面 `documents` 缺席那一支**不同形**：那是"我不知道产物是什么"，
   *   这是"产物集是空的"。它答不了"该不该再审"这个问题 —— 没有可以再审的东西。
   */
  if (legal.length === 0 && illegal.length === 0) {
    blockers.push(
      'this run declares no requirement/plan document at all, so "has the artefact moved since it was last reviewed" cannot hold: there is no artefact that could carry a revision',
    )
    return blocked(blockers)
  }

  /**
   * ★★ 路径一条都不合法（全是绝对路径 / 带 `..`）⇒ 也是**测到了的问题**，不是"没能测量"
   *   —— 一次给全：非法路径那几条 blocker 已经建好了，直接交出去。
   *
   * MEASURED（本任务第一次跑，`臂 3d`）：这一支**曾经不存在**，于是
   * "legal 为空"掉进了最后那个兜底 —— 而兜底当时是 `ok()`。它的读数是：
   *
   *     调用方交了两份产物 ⇒ 判据说"没事，审过了" ⇒ 而它一份都没比过
   *
   * ⇒ 这一支与末尾那个 `legal.length === 0 ⇒ unmeasured` 的兜底**不同形**，
   *   差别是**有没有一条已经建好的 blocker**：
   *
   *     有非法路径（可判定的缺陷）        ⇒ blocked（说清哪几条、为什么）
   *     没有非法路径、只是没比出来        ⇒ unmeasured（我什么都没比）
   *
   * ★ 把两者合成一个"反正都没比过 ⇒ unmeasured"，会让一份**交了绝对路径的**
   *   产物清单读起来像"基础设施读不到版本"—— 而补救动作完全不同
   *   （改调用方的路径书写 vs 去看为什么 git 读不出）。
   */
  if (legal.length === 0) return blocked(blockers)

  /**
   * ── 逐份产物：比较"现在"与"上次审查时" ─────────────────────────────────────────
   *
   * 三个出口，且**互不折叠**（一次给全，不短路 —— 契约 §3 与
   * `dispatch.changed-paths` 的"不短路"同源：修一份又冒一份是要人跑很多轮）：
   *
   *   moved            现在 != 上次审查     ⇒ 有未审改动（触发）
   *   same             现在 == 上次审查     ⇒ 审过了、没动
   *   neverReviewed    上次审查那一格没有键 ⇒ 一次都没审 ⇒ 有未审改动（触发）
   *   unknown          任一格读不出          ⇒ 这一份没能测（★ 不是"没变"）
   */
  const moved: Array<{ path: string; from: string; to: string }> = []
  const neverReviewed: string[] = []
  const unchanged: string[] = []
  const unknown: string[] = []

  for (const path of legal) {
    const now = readRevision(currentBag as Record<string, unknown>, path)
    const reviewed = readRevision(reviewedBag as Record<string, unknown>, path)

    /**
     * ★ 顺序：先问"现在"这一格。它是**不可替代**的 —— 没有它，下面每一个比较
     *   都无从谈起，而"读不出现在的版本"必须落成没能测量（验收 ⑤）。
     */
    if (now.kind !== 'read') {
      unknown.push(
        now.kind === 'invalid'
          ? `"${path}" has a current revision that is not a revision at all (a non-string or blank value), so it cannot be compared with the reviewed version`
          : `"${path}" has no readable current git revision (git could not resolve a revision for it — a non-git repository, an untracked file, or a failed read), so whether it moved could not be measured`,
      )
      continue
    }

    /**
     * ★ "上次审查那一格读坏了" 与 "从没审过" **不同形**（见 interface 的注释）：
     *   前者落 unknown（去修记录），后者落 neverReviewed（去开一轮审查）。
     */
    if (reviewed.kind === 'invalid') {
      unknown.push(
        `the recorded review revision for "${path}" is not a revision at all (a non-string or blank value), so it could not be compared with the current revision ${now.revision} — a corrupted review record is not the same as "never reviewed"`,
      )
      continue
    }
    if (reviewed.kind === 'missing') {
      neverReviewed.push(path)
      continue
    }

    if (reviewed.revision === now.revision) unchanged.push(path)
    else moved.push({ path, from: reviewed.revision, to: now.revision })
  }

  /**
   * ── ★ 会话事件这一格怎么用（它是**证据**，不是第二个裁决源）───────────────────
   *
   * `observedWrites === undefined`（没能观察）⇒ 附一句"谁写的不知道"。
   * ★ 它**不**把裁决翻成 unmeasured，理由是版本面已经**独立**回答了"变了没有"：
   *   两个版本的字符串不等，这件事不因为"我没看见谁写的"而变得不确定。
   *   把这一支翻成 unmeasured 会让判据在"事件读不到"时**永远沉默**，
   *   而那正是它最需要说话的时刻（有人改了产物，判据却装作没测到）。
   *
   * ★ 反过来的分工在 `admission.absorb` 那一侧：那边的事件格是**它唯一的**
   *   真实性来源（它在问"是不是空操作"），所以那边缺席就必须 unmeasured。
   *   两条判据在这里的差别不是不一致，是**它们问的问题不同**。
   */
  const attribution = observedWrites === undefined
    ? ', and this session\'s write history could not be observed, so which of them this session wrote itself is unknown — the version comparison above does not depend on it'
    : ''
  /** 观察到了事件 ⇒ 把"这一侧真的写了哪几份"写成可读的证据。 */
  const observedSet = new Set(
    (observedWrites ?? [])
      .map((path) => normalizeWorkspacePath(path))
      .filter((path): path is string => path !== undefined),
  )
  const wroteItself = legal.filter((path) => observedSet.has(path))

  /**
   * ── ★★ 有未审改动 ⇒ blocked（**告警，不是拒绝流程**）────────────────────────────
   *
   * 用户裁定这一条是"触发一次对抗性审查"，而**触发**与**拒绝**是两件事
   * （契约 §5 用同一条纪律约束 `runtime`：告警不拒任务）。裁决是 `blocked`
   * 只是因为三态里没有第四态 —— 而 `blocked([原因])` 的形状恰恰是
   * "说清为什么"的那一支，编排列层既可以据此派一次审查、也可以只记一行
   * 告警。★ 本判据**不**决定"派不派"，它只回答"该不该再审"。
   *
   * ★ 证据必须点名（验收 ②）：哪份文档、从哪个版本到哪个版本、距上次多久。
   *   一句笼统的"你该审了"与"没说话"在下游同形 —— 而这条判据的全部价值
   *   就是让"什么时候审"变成一个**可读的**读数，而不是一次经验判断。
   *
   * ★★ `attribution` 那一句**必须真的被拼进 blocker**（缺陷：它一度是个死变量）
   *    —— 一次"事件读不到"如果不留痕，告警里"这一侧真的写了它"与"我没看见谁写的"
   *    就只差一个**缺席的括号**：两句读起来都像是在说"这份文档有问题"，
   *    而其中一句背后有一次观察失败、另一句背后有一次成功的归因。
   *    把观察失败如实说出来，是"没能观察"与"观察到"在这条裁决上**仍然不同形**的
   *    唯一落点（契约 §3.4 在**证据**这一层的运用）。
   */
  if (moved.length > 0) {
    for (const entry of moved) {
      blockers.push(
        `"${entry.path}"${ctx?.task?.id === undefined ? '' : ` (task "${ctx.task.id}")`} has an UNREVIEWED change: it was reviewed at ${entry.from} and is now at ${entry.to}`
        + `${age === undefined ? '' : `, ${age}`}`
        + `${wroteItself.includes(entry.path) ? ' (this session wrote it)' : ''}`
        + `${attribution}`
        + ' — run an adversarial review of this artefact before treating it as settled',
      )
    }
    return blocked(blockers)
  }

  /**
   * ★ 从未审过 ⇒ 也是"有未审改动"（本判据存在的理由的另一半）。
   *   一个**从没被审过**的产物与一个**刚审过**的产物在任何"看着挺全"的检查下
   *   同形 —— 而"这份需求从没被对抗性审查过"恰恰是用户要消灭的那件事。
   *   ★ 但它与 `moved` **分开写**：一句话不能同时说"从 A 变到 B"与"没有 A"。
   */
  if (neverReviewed.length > 0) {
    for (const path of neverReviewed) {
      blockers.push(
        `"${path}"${ctx?.task?.id === undefined ? '' : ` (task "${ctx.task.id}")`} has NEVER been reviewed: there is no recorded review revision for it`
        + `${age === undefined ? '' : `, and the last review was ${age}`}`
        + `${wroteItself.includes(path) ? ' (this session wrote it)' : ''}`
        + `${attribution}`
        + ' — a document nobody has attacked is not the same as a document that survived an attack',
      )
    }
    return blocked(blockers)
  }

  /**
   * ── ★★ 读不出任何一份的版本 ⇒ unmeasured（**不是 ok**）──────────────────────────
   *
   * 这是验收 ⑤ 的落点："拿不到版本 ≠ 没改动"。它排在 `moved` / `neverReviewed`
   * **之后**，因为那两支是**已经测到的事实**（版本不等 / 没有记录），
   * 而"可判定的事实不得写成没能测量"是本队那条跨层规则。
   *
   * ★ 一次给全（不短路）：每一份读不出的原因各写一句 —— 一份没读到与三份都没读到
   *   的补救动作不同，而"一份 unmeasured"的告警读起来像"就这一份有问题"。
   */
  if (unknown.length > 0) {
    if (unchanged.length === 0) {
      return unmeasured(
        `no produced document could be compared against its last review, so whether anything needs re-reviewing is unknown — this is "not measured", not "nothing changed": ${unknown.join('; ')}`,
      )
    }
    /**
     * ★ 一半比出来了、一半没比出来：形状与"全都没测到"必须不同 ——
     *   前者是"有一部分确定没动"，后者是"什么都不知道"。两份读数都要说，
     *   否则读日志的人会以为这条判据整体没干活。
     */
    return unmeasured(
      `${unknown.length} of the ${legal.length} produced document(s) could not be compared against their last review, so "this artefact is settled" cannot be certified for them (the other ${unchanged.length} are unchanged): ${unknown.join('; ')}`,
    )
  }

  /**
   * ── ★★ 一份都没比过 ⇒ unmeasured（恒真写法：一次空守卫必须红）────────────────────
   *
   * MEASURED（本任务的第一次跑，`臂 3d` 抓出来的）：这一行**曾经是 `return ok()`**
   * —— 而它只是在下面那条 `ok()` 之前落的一个兜底。当时的理由看起来无懈可击：
   * "`moved` / `neverReviewed` 都是空的、`unknown` 也是空的 ⇒ 那一定全都比过了"。★ 而那个
   * 推论**不成立**：`legal` 可以为空，而 `blockers` 里已经装着两条非法路径
   * （一份绝对路径 + 一份 `..`）⇒ 三份清单**全是空的**，判据于是返回 `ok`。
   *
   * 它的坏法正是本任务要消灭的那一种，而且**看起来最好**：
   *
   *     调用方交了两份产物 ⇒ 判据说"没事，审过了" ⇒ 而它一份都没比过
   *
   * 而这个洞**在夹具的第一次跑里就露出来了**（臂 3d 期望 blocked、拿到 `{ok:true}`）
   * —— 这正是"对照臂不可省"的又一次落点：没有它，这一支会在生产里静默地
   * 对每一份写法不对的产物清单**背书**。
   *
   * ⇒ 兜底写成 unmeasured。**"我什么都没比"永远不许读成"我比过、都没事"**，
   *   与本判据存在的理由（拿不到版本 ≠ 没改动）是同一条纪律的第二次运用。
   */
  if (legal.length === 0) {
    return unmeasured(
      `none of the ${documents.length} declared document(s) could be compared against a review revision (every one of them is not a workspace-relative path), so "this artefact is settled" was never measured — this is "not measured", not "nothing changed"`,
    )
  }

  /**
   * ── ★ 走到这里 = 每一份都比过了，且**全部等于**上次审查的版本 ──────────────────
   *
   * ★ 出口形状【必须与"没能测量"不同形】（验收 ⑤ 的另一半）：这里是
   *   `{ ok: true }` —— 没有 `unmeasured`，没有 `blockers`。而"拿不到版本"
   *   走的是上面那一支，返回 `{ ok: false, unmeasured: '<一句为什么>' }`。
   *   两条出口一个字段都不共享，所以任何把它们读成同一件事的调用方都是**读错了
   *   形状**，不是读错了一句话。
   *
   * ★ 到达这一行的**前提**由上面那个 `legal.length === 0` 的守卫保证：
   *   "比过每一份、且每一份都相等" —— 而 `unchanged.length !== legal.length`
   *   在这里**不可能**（每一份要么落 unchanged、要么落在前面某一支里返回）。
   *   ⇒ 这个不变量不是靠注释声明的，它由那四条出口的**穷尽性**保证：
   *     moved / neverReviewed / unknown / legal.length===0 各覆盖一棵子树。
   */
  return ok()
}

/**
 * ── ★ 一条只在夹具里用得到的出口（导出是为了让三态**结构上**可分辨）────────────
 *
 * 与 `ok()` / `blocked()` / `unmeasured()` 同源：三态的差别不是"措辞不同"，
 * 而是**返回对象上有没有那个字段**。本函数把这条性质交给夹具直接断言，
 * 而不是让夹具去匹配告警里的一段自然语言 —— 后者会因为改一个标点而静默失效。
 *
 * ★ 它不是裁决的第四个分支：它只是把"这一条裁决属于哪一态"读出来。
 */
export type GateVerdictState = 'ok' | 'blocked' | 'unmeasured'

export function verdictState(verdict: GateVerdict): GateVerdictState {
  if (verdict.ok === true) return 'ok'
  if (typeof (verdict as { unmeasured?: unknown }).unmeasured === 'string') return 'unmeasured'
  return 'blocked'
}
