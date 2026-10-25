/**
 * ── 四条并行线的读数装配清单 ────────────────────────────────────────────────────
 *
 * ── 为什么需要这个文件（不是"多一层抽象"）─────────────────────────────────────────
 *
 * MEASURED（2026-10-23，独立仓合并实验，每组 ≥3 轮）：
 *
 * ```
 * 四条线都往同一行追加（= 直接往 return 字面量加字段）  合并成功 1/4
 * 预置 4 槽位、槽位【相邻无分隔】                       合并成功 2/4
 * 预置 4 槽位、槽间 ≥1 行分隔                            合并成功 4/4
 * 四条线各加一行【相邻 import】                          合并成功 1/4
 * 预置 4 个 import 槽位、槽间带分隔注释                  合并成功 4/4
 * ```
 *
 * ⇒ 两条结论，都不是偏好：
 *   ① **"预置槽位"只对一半** —— 槽位相邻仍会撞，必须有分隔行；
 *   ② 容器把冲突从 `return` 字面量搬到了 **import 区**，**没有消掉它**。
 *
 * ⇒ 所以 import 也必须预置槽位。本文件就是那个槽位表。
 *
 * ── ★ 使用纪律（四条线各读一遍）──────────────────────────────────────────────────
 *
 * ```
 * 开工时只取消【自己那两行】的注释；不碰别人的行；不重排。
 * ```
 *
 * 这一行与你 `gates/index.ts` 的 `ALL_GATES`（一人一行、不要重排）是同一条纪律。
 *
 * ── ★ 为什么"不 import 就没读数" ────────────────────────────────────────────────
 *
 * `contributeReadout` 是**模块顶层副作用**：某个模块被 import 一次，它才登记一次。
 * ⇒ **没人 import 这个文件，四个槽位永远空** ⇒ `collectReadouts()` 恒返回 `{}`
 *   ⇒ 快照里整格缺席 ⇒ 面板看起来"这条线没做"。
 *
 * MEASURED（同日）：容器落地后、本文件建立前，`contributeReadout` 的
 * 外部调用点 = **0**，`readouts` 那一格**永远缺席**。那是"写了没接线"的教科书形态。
 *
 * @module dsh-agent-teams/readouts/index
 */

import { contributeReadout } from '../readouts.ts'

// ── 线 A：证据链 ─────────────────────────────────────────────────────────────
// 落点 src/evidence.ts。产出两条 durable 证据流（executions / supplementalEvidence）
// 的**投影**（只读不存），每条带 `task.id + attemptId + at` 派生的稳定 evidenceId。
import { provideEvidenceReadout } from '../evidence.ts'
contributeReadout('evidence', provideEvidenceReadout)

// ── 线 B：软硬配对 ───────────────────────────────────────────────────────────
// 落点 src/gates/pairing.ts。产出"已注册判据 ↔ 其 soft 说明"的双向校验结果
// （`{ [gateId]: { hasSoft, hasHard } }`）。侧表不闭合 ⇒ 该槽位落 unmeasured 并列出 id。
import { providePairingReadout } from '../gates/pairing.ts'
contributeReadout('pairing', providePairingReadout)

// ── 线 C：后端能力位 ─────────────────────────────────────────────────────────
// 落点 src/backends.ts。产出本队**用过**的后端（读 `<stateRoot>/<teamId>/team.json`
// 的 `members[].provider`）与每个后端**声明**的能力位（`source: 'declared'`）。
import { provideBackendsReadout } from '../backends.ts'
contributeReadout('backends', provideBackendsReadout)

// ── 线 D：流程模板 ───────────────────────────────────────────────────────────
// 落点 src/templates/index.ts（尚未落地）。产出已加载的流程模板清单与生效版本。
// import { provideTemplatesReadout } from '../templates/index.ts'
// contributeReadout('templates', provideTemplatesReadout)
