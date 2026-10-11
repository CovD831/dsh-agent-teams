# 拆解本身被审：一次实测（t17）

> **谁写的**：`architect`（本队新加的名册身份），attempt `79b32335-bb1c-4860-88ec-bb86da63848d`。
> **这份文件是什么**：一次**真实的**拆解，加上一次**独立的**对**拆解本身**的审查。
> **它不是设计文档，也不是任务清单的副本**——它是「拆法可以被判错」这件事的第一个可核实例。
> **判据**：`git status --short`（见 §8）；本任务 inScope 只有这一个文件。

---

## 0. 先说读完要带走什么

```
★ 我给出的拆法是【错的】。而推翻它的不是"我推理不够仔细" ——
  是【三次已经被别人实测过的读数】，而这三次全都在盘上、在我写拆法的时候就在盘上。
★ 更贵的一层：我在读那些读数的时候，自己制造了两次【假读数】，
  而它们与真读数在屏幕上完全同形。那两次的成因是同一个，且它是可复现的（§4）。
★ 于是这条链是：我漏读了别人的读数 ⇒ 我自己又造了两次假读数 ⇒
  两个错叠在一起，看起来仍然像一份"有据可依"的拆解。
```

---

## 1. 目标（真的那个，可判真假）

**GOAL·A（我最初选的）**

> 一个探针推翻了某条任务的前提之后，captain 能在**运行中的团队**上重排任务图：
> 删掉被推翻的那条、并把它后面依赖它的任务指向真正的新前置。

**GOAL·A 的机械判据**：`agent_teams_edit_plan` 在一个 `phase==='running'` 的团队上，
以 `remove_task` + `add_task` 为操作被**接受**（而不是抛出）。

**GOAL·B（探针把我打回去之后换的那个）**

> 让**拆解本身**成为可审、可被否的产物：给一个真实目标产出带契约的任务图，
> 由**第二次独立阅读**去审**这份拆法**（而不是审每一条任务做得对不对）。

★ **A 与 B 不是我随手换的**：是 §5 的探针**先否掉了 A**，才轮到 B。
把这一次否掉记下来，正是这份文件存在的一半理由。

---

## 2. 拆解：GOAL·A（11 条 · 17 条依赖边）

★ **为了让审查咬得住，这里给完整契约字段 + 每条边防什么**——
因为**审查的对象是拆法，而拆法的载体是边与写域**。

### 阶段一：地基（三条，可并行）

| 任务 | kind | objective（机械可判那一面） | acceptance（一句可读真假） | verify | inScope |
|---|---|---|---|---|---|
| **A1** `plan-graph-patch` | implementation | 在**同一把队伍锁**下做一次「删任务 + 改依赖」的原子批量，**磁盘上不存在**"删了但下游没改"的中间态 | 一次 `plan_patch` 调用后，团队文件里要么两处都变，要么两处都没变（读文件逐字比对） | `pnpm build` · `node --test scripts/gate-plan-patch.test.mjs` | `src/plan-rewrite.ts` `lib/plan-rewrite.js` `lib/types/plan-rewrite.d.ts` `scripts/gate-plan-patch.test.mjs` |
| **A2** `refutation-record` | implementation | 把「这条任务的前提被证否了」写成一条**带证据的记录**，而不是一次状态改写 | 一条被证否的任务与一条"跑挂了"的任务在**记录上不同形**（`refuted_by` 与 `failure_kind` 二者互斥且都非空判定） | `pnpm build` · `node --test scripts/gate-refutation.test.mjs` | `src/state.ts` `lib/state.js` `lib/types/state.d.ts` `scripts/gate-refutation.test.mjs` |
| **A3** `architect-identity` | implementation | `architect` 身份在从 roster 建队时**可被指派且可被调度器唤醒**（与其它身份同路径） | 从 roster 建的一个队里，`architect` 出现在 `agent_teams_status` 的名册上且名字正确 | `pnpm build` · `node --test scripts/gate-roster-architect.test.mjs` | `src/profiles.ts` `lib/profiles.js` `lib/types/profiles.d.ts` `scripts/gate-roster-architect.test.mjs` |

### 阶段二：表面（一条）

| 任务 | kind | objective | acceptance | verify | inScope |
|---|---|---|---|---|---|
| **A4** `plan-patch-tool` | implementation | 暴露 `agent_teams_plan_patch` 工具，**逐字段校验**并返回改前后的图 | 一次成功调用后 `graph` 与磁盘团队文件逐字一致；一次非法调用后**文件一字未变** | `pnpm build` · `node --test scripts/gate-tool-output-schema.test.mjs` | `src/tools/plan-patch.ts` `lib/tools/plan-patch.js` `lib/types/tools/plan-patch.d.ts` |

### 阶段三：配对验证（三条，与 A1/A2/A3 一一配对）

| 任务 | kind | objective | acceptance | verify | inScope |
|---|---|---|---|---|---|
| **A5** `verify-atomicity` | verification | 独立造一次**并发写**，看阶段一说的"没有中间态"是否真的成立 | 一个"删了而下游没改"的中间态在**能被构造出来**的情况下必须被观察到一次（否则报 unmeasured，不报 pass） | `node --test scripts/verify-plan-patch.test.mjs` | `scripts/verify-plan-patch.test.mjs` |
| **A6** `verify-refutation` | verification | 独立造一条**假证否**，看 A2 的两类记录是否真的不同形 | 把 `refuted_by` 挪一格 ⇒ 那条判据的红/绿必须跟着动（不动 ⇒ 报"该臂未被刺激过"） | `node --test scripts/verify-refutation.test.mjs` | `scripts/verify-refutation.test.mjs` |
| **A7** `verify-architect` | verification | 独立核 roster→建队→指派这条链，而不是复述 A3 的夹具 | 在**一个真实的 team.json** 上读到 `architect`，而不是在夹具自己的拷贝上 | `node --test scripts/verify-roster-architect.test.mjs` | `scripts/verify-roster-architect.test.mjs` |

### 阶段四：整树 + 收口（三条）

| 任务 | kind | objective | acceptance | verify | inScope |
|---|---|---|---|---|---|
| **A8** `verify-tree` | verification | 全量 + 存量红对照，回答"有没有改坏别处" | 本树失败**集合**与基线失败**集合**的交集为空（★ 不是比计数，见 DISPATCH-RULES §7） | `pnpm test:gates` | `scripts/verify-tree.test.mjs` |
| **A9** `integrate` | integration | 按 `changedPaths` + `baseRevision` 判写域冲突并并入 | 每条 worktree 的产物在主树可指认（commit 存在且 `--is-ancestor` 成立） | `git merge-base --is-ancestor` 逐条 | `docs/`（只写记录） |
| **A10** `architect-readback` | implementation | 把「这次拆解为什么这样拆」落成可读文件，使拆法本身可被复核 | 文件里每条边都说得出口径（见下表第一列） | `git status --short` | `docs/DECOMPOSITION-AUDIT.md` |

### §2.1 ★★ 逐条边：它**防**什么（防不了任何东西的那条被点名）

> **规则**（DISPATCH-RULES §1）：一条边只能来自 ① 真写域冲突 或 ② 真前置。
> **判据**：「把 A 删掉，B 还能开工吗？」**能 ⇒ 不该有这条边。**

| # | 边 | 来源 | ★ 它防的是（具体到"去掉会出什么事"） |
|---|---|---|---|
| E1 | A1 → A5 | ② 真前置 | 去掉：A5 没有可被测的对象，**会绿**——而那个绿**什么都没测**（DISPATCH-RULES §15 的第三态） |
| E2 | A2 → A6 | ② 真前置 | 同上；且 A6 的核心动作是「把 `refuted_by` 挪一格」，没有 A2 就没有那个量可挪 |
| E3 | A3 → A7 | ② 真前置 | 去掉：A7 只能读 A3 夹具自己的拷贝 ⇒ **产品修好它也不变**（DISPATCH-RULES §13.3 "不会报过期"的形态） |
| E4 | A1 → A4 | ② 真前置 | 去掉：A4 会**重新实现**一次批量语义 ⇒ 同一件事两份实现，而它们会分叉（PLAN-REVIEW §8 "两份实现"） |
| E5 | **A2 → A4** | ★ **无** | ★★ **这条边防不了任何东西**：A4 的验收只读 `graph`（图的形状），而 A2 产出的是**证否记录**——两者无共有字段。**我把"相关"当成了"前置"**。见 §6-F1 |
| E6 | A2 → A1 | ① 写域冲突 | 去掉：A1（`src/plan-rewrite.ts`）与 A2（`src/state.ts`）若同时改状态落盘路径 ⇒ 整文件覆盖（DISPATCH-RULES §9.3 的 (乙) 已实测过后果） |
| E7 | A1 → A10 | ② 真前置 | 去掉：A10 会描述一个不存在的接口 ⇒ **文档与实现对不上**，而那正是 ORPHAN-CENSUS 那类文档腐烂的入口 |
| E8 | A2 → A10 | ② 真前置 | 去掉：记录的字段名会写错（本队已实测过一次：`memberModel` vs `member_model` 使工具每次调用都抛） |
| E9 | A3 → A10 | ② 真前置 | 去掉：名册的实际名字会被写错（"我以为它叫 X"） |
| E10 | A4 → A8 | ② 真前置 | 去掉：A8 跑全量时那条**新接线**还没进构建产物 ⇒ 它测的是旧树 |
| E11 | A5 → A8 | ★ 无（屏障） | ★ 去掉它**什么坏事都不会发生**：A8 是整树验证，它自己会跑全部——**A8 不读 A5 的产物**。我照 §2 的假规则加的第二条屏障边。见 §6-F2 |
| E12 | A6 → A8 | ★ 无（屏障） | 同 E11 |
| E13 | A7 → A8 | ★ 无（屏障） | 同 E11 |
| E14 | A1…A7 → A9 | ② 真前置 | 去掉：integrator 会在产物未落盘时就"并入"⇒ 并进一份**不存在的交付**（本队 captain 手工并时犯过三次） |
| E15 | A4 → A9 | ① 写域冲突 | 去掉：A4 与 A9 同时写 `src/tools.ts` 那个装配点 ⇒ 整文件覆盖 |
| E16 | A8 → A9 | ② 真前置 | 去掉：整树红着并 ⇒ 把一条**不知道有没有改坏别处**的交付并进主树 |
| E17 | A10 → A9 | ② 真前置 | 去掉：收口时那份记录不在 ⇒ 下一个人读到的图与实际不符（ORPHAN-CENSUS 说的就是这件事） |

**⇒ 17 条边里，E5/E11/E12/E13 四条去掉不会出任何事。它们被我点名，而不是被留着。**

---

## 3. 拆解：GOAL·B（6 条，形成闭环）

★ **为什么是 B 而不是继续修 A**：见 §4-G3——A 的第一条任务被**别人已经做过的实测**证明前提不在，而修它要先做一次契约修正。

| 任务 | kind | objective | acceptance | verify | inScope |
|---|---|---|---|---|---|
| **B1** `contract-scan` | implementation | 给每条任务契约做**机械自检**：`inScope` 非空、`verify` 非空、**每条 acceptance 至少能被一个 inScope 文件观测到** | 对一份**已知有缺陷**的契约报出缺陷；对一份**合法**契约报通过（★ 反向半边，否则测不出"一律拒绝"） | `node --test scripts/contract-scan.test.mjs` | `scripts/contract-scan.mjs` `scripts/contract-scan.test.mjs` |
| **B2** `contract-vs-produce` | implementation | 给已完成的契约加一列：**产物是否是可指认的提交**（而不是 `status === 'completed'`） | 对一条"记录说完成而 commit 不在 HEAD 祖先里"的任务，报出**未并入**而不是通过 | `node --test scripts/contract-produce.test.mjs` | `scripts/contract-produce.mjs` `scripts/contract-produce.test.mjs` |
| **B3** `packet-readback` | implementation | 让**接收端**能按名字读回：某条任务被派发时**实际**注入了什么 | 从 `agent_teams_status` 里能取到该次派发的 worker/模型；取不到时**报 unmeasured**而不是猜 | `pnpm build` · `node --test scripts/gate-brief.test.mjs` | `src/members.ts` `lib/members.js` `lib/types/members.d.ts` `scripts/gate-brief.test.mjs` |
| **B4** `divergence-probe` | verification | **物理端到端**：真起一个 headless profile + 真实浏览器，读**被注入文本里实际出现的路径**，与合同里的路径**作集合比对** | 比对三态：一致 / 不一致（附差异集合）/ unmeasured（起不来就如实说，不许报通过） | `curl` 名册 + ego-browser DOM 探针 + 截图存档 | `scripts/verify-brief-e2e.mjs` |
| **B5** `decomp-audit` | review | **审这份拆法**（不是审任务做得对不对），verdict ∈ {pass, needs_revision, reject}，且必须能给出 reject | 对 §2 那份真实拆法给出 verdict + findings（每条 finding 有 requiredFix） | 读 §2 全文，逐条核边与写域 | `docs/DECOMPOSITION-AUDIT.md` §6 |
| **B6** `rewire` | implementation | 用 B2 的读数改写被证否的边，并**记录改写** | 改写前后两份图都可读，且改写理由指向具体读数 | `git status --short` | `docs/DECOMPOSITION-AUDIT.md` §7 |

### §3.1 边表（一句话防什么）

| # | 边 | 它防的是 |
|---|---|---|
| F1 | B2 → B1 | 去掉：B1 的"契约自检"会只检查**格式**（字段非空），而不检查**产物**——而 §4-G1 证明格式全对、产物不在，是可以同时成立的 |
| F2 | B2 → B5 | 去掉：审查只能用眼睛读 11 条契约 ⇒ 漏掉"这一格的名词没有观测面"，而那正是 §2 里我犯的错（§4-G3） |
| F3 | **B4 → B6** | ★ 去掉：**重排会由"我读代码后觉得"驱动，而不是由读数驱动**——那正是 DISPATCH-RULES §16.3 禁止的形态 |
| F4 | B3 → B4 | 去掉：B4 必须**自己实现一套注入口径**才能比对 ⇒ 两人各写一份 ⇒ 分叉之后"合同说要 X、实际注入 Y"在日志里同形（PLAN-REVIEW §8 第三次口径修正的同族） |
| F5 | B3 → B5 | 去掉：审查会以为"被派发时实际注入了什么"已可读回，而它其实不可读 ⇒ **一条不存在的可观测性会被当成存在** |
| F6 | **B6 → B5** | ★ **这是我改过一次的边**：初稿里 B6 没有任何下游（它是我加的"总得有个收口"）。按规则它**不该存在**。见 §6-F3 与 §7-R6 |

---

## 4. 这一轮里测出来的四件事

### G1 ★ 名册里确实有这个身份（P1，唯一一条"如我所料"）

```
$ python3 -c "读 team.json 的 members"
architect | contract design and task decomposition (auditable artifact) | working
```
⇒ 否掉「新身份还没进名册」这个前提。**这条不影响拆法，记它是为了让 §5 的三态不混淆。**

### G2 ★★ 我造了两次假读数，而它们与真读数同形

**两次的形态完全相同：把 `grep` 的输出接了 `| head -N`，而我要的那一行在第 N 行之外。**

| # | 我跑了什么 | 我以为读到了什么 | 实际是什么 |
|---|---|---|---|
| 假读数① | `grep -rn failure_kind src/tools/status.ts \| head`（截尾） | "0 命中 ⇒ t12 的产物不在基线上" | **`src/tools/status.ts:548` 就是 `failure_kind` 的投影行**（t12 已并入） |
| 假读数② | `grep -rn inconclusive src/client/ \| head -20` | "0 命中 ⇒ t13 的产物不在基线上" | 这一条**结论恰好成立**（t13 的收敛渲染确实没落进 `88d1bdd`），但它是**碰巧**对的：同一个管道在同一轮里也给了我一个错的 |

**★★ 而它们为什么危险，不是"我读错了"，是**：

```
★ 假读数①的输出是【空白】—— 而"空白的 grep"在屏幕上与
   "那个词确实不存在"【完全同形】。
★ 更硬的一层: 假读数①【恰好支持了我当时正在写的那句话】
   （"上游的产物不在基线上 ⇒ 边该按产物判"）——
   ⇒ 一个错的读数与我的假设一致，于是我没有去验它。
```

**★ 而这条的设备层成因是可以复现的**（本仓已有同族记录）：
一次 `bash` 调用的输出**会被截成尾部**（工具说明逐字：*"Long output is truncated to its tail"*）。
⇒ **`| head -N` 再叠上"截尾"，两次截断方向相反，而中间那一段谁也没看见。**
**⇒ 纪律：任何"0 命中"的结论，必须用 `grep -c`（它给一个数）或 `-c` 逐文件计数复述一次，
不许用"带截断的列表为空"来立论。**

**★★★ 而这一条有一条更一般的形状，回应本仓已有的那条**：

> **「没测到」≠「测得是零」**（本仓既有）。

```
本条的推进: ★ 我【测】了，而装置把结果掐掉了 ⇒
   屏幕上留下的东西与"确实为零"同形。
⇒ ★ 所以"我测过"这句话，必须连同【我是怎么读的】一起说 ——
   否则一个被装置掐掉的读数会冒充一个测出来的零。
```

### G3 ★★★ 两条结构性读数：GOAL·A 的前提不在，而它已经被别人实测过

#### (a) 那条闸门（我核过，且我第一版写错了）

```ts
// src/tools.ts:1926-1928 —— updatePlanBatch(...)
if (!staged && mutations.some(mutation => mutation.action !== 'update_task')) {
  throw new Error('a running team only permits update_task edits to pending, never-started tasks; roster and removal edits require a staged plan')
}
// src/tools/edit-plan.ts:123 —— 工具路径【自己】把第五个参数写成 true
const updated = await updatePlanBatch(captain, team.id, mutations, exec.signal, true)
```

**⇒ 只有两条批量写路径**：

```
工具路径 edit-plan.ts:123  ⇒ allowPendingEdits = true   ⇒ ★ 这把闸门对它【从来就是假的】
路线路径 index.ts:443      ⇒ 无该参数               ⇒ allowPendingEdits = false ⇒ 闸门对它成立
```

★ **我第一版写的是"running 队根本不允许 add/remove"——那是错的**（闸门对工具路径恒假）。
**★ 而真正的闸门是另一条**：

```ts
// src/tools.ts:1976-1979 —— remove_task 分支
const dependent = fresh.tasks.find((candidate) => candidate.dependencies.includes(task.id))
if (dependent !== undefined) throw new Error(`task "${task.id}" is still required by "${dependent.id}"; …`)
```

**⇒ 被推翻一条有下游的任务时，删不掉它——除非同一批里先把下游改掉。
而这恰恰是"重排"的全部工作量。**
⇒ 所以真正被挡住的是**顺序与原子性**，不是"允许不允许"。**我为一个被别的东西挡住的步骤造了一条独立任务。**

#### (b) 而这整格已经被实测判过——`t16` 的 blocker 报告（我漏读了）

`t16` 的成员逐字给出过同一格：

```
· 它要改的两处闸门在 src/client/ActivityPanel.tsx —— ★ 不在它的 inScope 里（而 src/tools/ 被显式排除）
· 它要放行的那条闸门是 tools.ts:1926 的无条件 !staged 拒绝 ⇒ 每次保存 409
★ 而它给的更硬的一条: 即使放行，t14 已实测「路由不传播」
  （"a member's route is frozen into its continuable descriptor at creation"）
★ 它建议 (a) 扩 inScope + 放宽 1926；(b) 放弃 running 队那一半。
★ 而它没被处置: t16 的记录现在是 status=failed。
```

**⇒ 我选的 GOAL·A 不是"难"，而是已经被一次实测判为"前提不在"。**

**★★★ 而这是本文件最贵的一条，因为它关于【拆解者该读什么】**：

```
★ 方法论文件（PLAN-REVIEW / DISPATCH-RULES）会告诉你【怎么拆】，
  而它不会告诉你【这一格已经被拆过、并且被证否了】。
★ 后者在【台账】里: 失败的 task 记录 / inbox 里的 blocker 报告 / 已完成任务的 output。
⇒ ★ 我这一轮的读法是"先读两份方法论，再挑目标"——
   而正确的读法是"先读台账里【failed 的任务与它们的理由】，再挑目标"。
   ★ 因为 failed 的任务里，每一条都是一次"这个前提不在"的实测。
```

**★ 而它有一个干净的操作形式**（我在 §6 把它写成 B1 的验收）：

> **挑目标之前，先枚举所有 `status===failed` 的任务，逐条读它的失败理由。
> 若你的新目标与其中任何一条重叠，你面对的不是"没人做过"，
> 而是"已经有人证明它现在做不了"。**

### G4 ★★★ 第三条读数：这个仓的**交付流程本身**有一条被实测四次的断裂

```
$ git merge-base --is-ancestor c452026 HEAD   ⇒ NO   (t12 的交付 commit)
$ git merge-base --is-ancestor 7e1ec5d HEAD   ⇒ NO   (t13 的交付 commit)
$ git merge-base --is-ancestor 9edfcfe HEAD   ⇒ NO   (t13 的修正 commit)
```

★ **而它不是我发现的**——`88d1bdd` 的提交信息逐字写着（我把它读完了，因为我上一段的管道差点又掐掉它）：

```
Worktree deliverables are local commits that are never ancestors of the
main tree -- merging is by landing files, not by git merge. Nothing had
landed, so every task with a dependency was dispatched onto a base that
structurally could not contain its dependency's output. Two members
measured this independently (t6 ran three byte-identical attempts, t8
two), and all six completed deliverables were confirmed un-merged.
```

★ 而 `friction-eng` 在它的 t8 报告里独立给出了同一条的**判据形式**：

> **"t3 is marked completed while its commit is in no base — the dependency is nominal, not real."**

**★★ 而这就是 §2/§3 那两张边表共同的致命缺陷**：
**我的每一条边都写在 `dependencies: [...]` 这个【记录级】字段上**，
而**记录级的前置可以在产物级不成立**——本仓已有明令（DISPATCH-RULES §5.3）：

> 依赖问的应该是「前置的**产物**存不存在」，而不是「它的**记录**是不是 completed」。

⇒ ★ 而我这一轮**亲眼看到这条规则在同一个队里以两种形态各命中一次**（commit 信息 + t8 报告），
**却仍然把全部边写成了记录级**。见 §6-F4。

---

## 5. 探针与它的读数（§7 改写记录的输入）

| # | 探针 | 命令 | 读数 | 它推翻了什么 |
|---|---|---|---|---|
| **P1** | 名册是否有这个身份 | 读 `team.json` 的 `members`（只读） | **存在**（`architect`） | 否掉「新身份还没进名册」 |
| **P2** | `failure_kind` 在基线上存在吗 | `grep -c failure_kind src/tools/status.ts` | **4**（★ 第一次用 `\| head` 读到的是 0 ⇒ **假读数**） | ★ **推翻"t12 的产物不在基线上"这个我自己的假设** |
| **P3** | running 队能不能 add/remove | `grep -n "only permits" src/tools.ts` + 读 `edit-plan.ts:123` | 工具路径**没有**这把闸门（第五参恒 `true`）；真闸门是 `:1976` 的"还有下游" | ★ **推翻我第一版的 framing**（见 G3a） |
| **P4** | GOAL·A 是否已被实测判过 | 读 `inbox/captain.jsonl`（只读） | `t16` 的 blocker 报告逐字给出同一格，且**未被处置** | ★ **推翻 GOAL·A 作为"新目标"**（见 G3b） |
| **P5** | 边是不是名义的 | `git merge-base --is-ancestor` × 3 | 三条**全部 NO**；而 `88d1bdd` 的提交信息独立记录了同一条 | ★ **推翻"边一写进图就真的在约束"**（见 G4） |
| **P6** | t13 的 UI 产物在不在 | `grep -rc inconclusive src/client/`（逐文件计数，不用管道） | 18 个文件**全部 0** | 成立；★ **但它与假读数②同形**，所以此处必须用计数复核 |

★ **P2/P4/P5 三条是同一个形状的三次独立出现**：
**「记录说完成了」与「事实建立了」不同形**（本仓已记：SELF-ITERATION §6 经验 F、
DISPATCH-RULES §5.3、§12.1 的代理读数表）。

---

## 6. ★★★ 第二次独立阅读对**拆法**的审查（verdict + findings）

> **审查对象**：§2 与 §3 两份拆法及其边表。
> **审查不到的东西，按第三态写**（"读不到"与"读到了且是错的"不同形）。
> **verdict**：`reject`（对 §2 整份拆法）。**保留这个 verdict**，因为 F1–F6 全部挂着可核读数。

### 6.1 结论

```
§2（GOAL·A 拆解）  ⇒ ★ reject
   理由：F1（一条边防不了任何东西）· F2（三条屏障边）· F4（所有边都是记录级）
         · ★ F5（目标先验不可达，且【已经被实测判过】）
§3（GOAL·B 拆解）  ⇒ ★ needs_revision
   理由：F3（初稿的 B6 连不到任何下游 ⇒ 它防不了任何东西，与 F1 同形）
```

### 6.2 findings

| id | severity | 问题 | requiredFix |
|---|---|---|---|
| **F1** | high | **E5（A2→A4）防不了任何东西**：A4 的验收只读 `graph`，A2 产出的是证否记录，两者无共有字段。我把"相关"当成了"前置" | 删掉 E5，或把它改成真前置（A4 的验收里真的读 A2 的字段） |
| **F2** | high | **E11/E12/E13 是屏障，不是依赖**：A8 是整树验证，它自己会跑全部；三条边去掉后 A8 照跑。实测依据：本仓 DISPATCH-RULES §0 记过同一形态（29 条屏障边把并发压到 1） | 三条全删，只留"最终 → 整树验证"这一条 |
| **F3** | medium | **初稿的 B6 没有下游** ⇒ 按本任务自己的判据（"去掉它不会出任何事"）它不该存在 | 已改：B6 现在挂在 B5 之下（§3.1-F6），并承接 B2 的读数 |
| **F4** | **blocker** | **§2 与 §3 的全部边都是"记录级"**（读 `status===completed`），而 P5 与 `88d1bdd` 的提交信息**各自独立**证明记录与产物会不一致 ⇒ 一个**名义上满足而实际没满足**的前置会让下游"开工并拿到错的前提"。本仓已有明令：依赖该按**产物**判 | 每条边加一条**派发时**的机械前置检查（"前置的 commit 是 HEAD 的祖先"）；实现落在 **B2**，验收写进 B2 与 B6 |
| **F5** | **blocker** | **目标本身先验不可达**：GOAL·A 需要的两处授权在同一批任务里互相排除（`src/tools.ts` 与 `ActivityPanel.tsx`），而 t14 已实测"路由不传播" ⇒ 即使前两条解开，改动也不生效 | ★ **不修**：把 GOAL·A 降级为证据（§4-G3），改用 GOAL·B；并把判据（"每条 acceptance 至少能被一个 inScope 文件观测到"）写进 **B1** 的验收 |
| **F6** | medium | **§2 的 A5/A6/A7 验收里没有"反向半边"**：三条 verification 都只写"必须被观察到一次"，而没写"必须有一条喂**该放行**的输入" ⇒ 它们测不出"一律拒绝"（SELF-ITERATION §6 经验 B 的产品级实例） | 每条 verification 的 acceptance 加一条反向半边 |
| **F7** | high | **本审查自己有同一个病**：我在 §4-G2 里承认了两次假读数，**而 §5 的初稿把 P2 的假读数当成了真读数写进表里**。若这两件事没有被写出来，这份审查的"独立"就是假的 | 已在 §4-G2 与 §5-P2 逐条标出"哪一次是假读数、它错在哪"；并要求任何"0 命中"结论用 `grep -c` 复核 |

### 6.3 ★ 而它能说出"这份拆法是错的"——证据是**它真的说出来了**

```
★ 本审查给出的不是"看起来还行"，而是两条 【blocker】：
   F4: 全部边是记录级 —— 有两次独立实测（P5 + 88d1bdd 的提交信息）
   F5: 目标先验不可达 —— 有一次实测（t16 的 blocker 报告）在我写拆法之前就在盘上
★ 而 F7 是把它【对准自己】的那一条：一个承认自己造过假读数的审查，
   其结论的可信度不来自"我仔细"，而来自【每条读数都给了命令与输出形态】。
★ 第三态：我【没有】去核的东西 ——
   · 我没有跑 ego-browser（不经本会话的授权面）
   · 我没有跑 `pnpm build`（本 worktree 里没有 node_modules，而本任务 inScope 里没有源码）
   · 我没有核过 A6 的"假证否"能不能被机械构造
   ⇒ ★ 这三条我写的是【unmeasured】，不是 pass。
```

---

## 7. ★★ 改写记录

> **纪律与它的边界**：`edit_plan` 在 running 队上**只能改 `update_task` 的 pending 编辑**——
> 而本拆解里的改写是**删边 / 改目标**，**不在这条路的射程内**。
> ⇒ 所以下面的改写**没有一条是用 `edit_plan` 落地的**。这一点本身是读数（§7.1）。

| # | 改什么 | 为什么（指向哪条读数） | 它可核吗 |
|---|---|---|---|
| **R1** | **删掉 E5**（A2→A4） | §6-F1：A4 的验收只读 `graph`，A2 无从被它观测 | 读 §2.1 表即可核 |
| **R2** | **删掉 E11/E12/E13**（三条 → A8 的屏障） | §6-F2 + DISPATCH-RULES §0 的 29 条屏障实测 | 同上 |
| **R3** | **E14 收窄**：由"七条全部 → A9"改成"**产物已落盘**那几条 → A9" | §6-F4：记录级边会让 integrator 并进不存在的交付 | 同上 |
| **R4** | **每条边加一条派发时前置检查**（"前置的 commit 是 HEAD 的祖先"） | §4-G4 / §5-P5：两条独立实测的"记录 ≠ 产物" | ★ 由 **B2** 的验收承载（可跑） |
| **R5** | **GOAL·A 降级为证据，GOAL·B 取代它** | §6-F5 + §4-G3b（t16 的 blocker 报告） | 读 §1 与本文 |
| **R6** | **B6 从"收口"改成"挂在 B5 之下、承接 B2 的读数"** | §6-F3（它原本没有下游） | 读 §3.1-F6 |

### 7.1 ★★★ 为什么这一轮**没有**一次 `edit_plan` 调用（这是本文件最尖的一格）

★ 本任务契约的第 5 条验收是：「**探针返回之后**发现的错边，用 `edit_plan` 改掉并记录」。
**★ 这一条对本轮【不可执行】，而原因是机械的、三条同时成立**：

```
① `agent_teams_edit_plan` 是【captain-only】工具 —— 成员根本没有它。
   src/tool-names.ts:24-28
     MEMBER_TOOL_NAMES = [claim_task, update_task, send_message, status]
     CAPTAIN_TOOL_NAMES = TEAM_TOOL_NAMES - MEMBER_TOOL_NAMES   ⇒ 含 edit_plan
   ⇒ ★ 我是 architect 成员，不是 captain。这条路对本轮【不可达】，
     而它不可达的原因不是权限设置错了，是【身份边界本身】。

② 即使有它，running 队上它【只能】做一件事。
   src/tools.ts:1946
     if (task.status !== 'pending' || (task.attempt ?? 0) !== 0 || task.reassigning === true)
       throw new Error(`task "${task.id}" has already started and cannot be edited`)
   ⇒ ★ 它只能改【从未开工的 pending 任务】。

③ ★★ 而本轮我要改的每一条边，两端都命中 ② 的排除条件（读 team.json，只读）：
     t6  status=failed      attempt=3   deps=[t3]
     t8  status=in_progress attempt=3   deps=[t3]
     t16 status=failed      attempt=1   deps=[t13,t14]
     t17 status=claimed     attempt=1   deps=[t16]   ← ★ 我自己
     t19 status=failed      attempt=1   deps=[t3,t12]
   ⇒ ★ 零条可编辑。F4 说的那些"记录级边"恰好全在【已开工】的任务上。
```

**★★★ 于是这一格有一个很干净的形状**：

> **一个机制被设计成"只在还没有发生时可用"，
> 而它要修的那类错误，全部只在【已经发生之后】才被发现。**

⇒ ★ **这不是"我这一轮没机会用"，是 `edit_plan` 的射程与"事后改写"这件事本身不重叠。**
   而这一点**在本任务契约写下那条验收的时候就在盘上了** ——
   契约逐字说"它 permits `update_task` on never-started pending tasks while running"，
   **那句话本身就是它不可用的证明**：我的错边没有一条在 never-started pending 的任务上。

**★ 所以本轮的处置是【如实交出等待状态】，而不是伪造一次改写动作或声称做过**：

```
★ 已做: 把 6 条改写（R1–R6）写成【可核的差异 + 每条指向的读数】
★ 未做: 一次 edit_plan 调用 —— 因为它不可达（①②），而不是因为它没必要（③）
★ 而"不可达"与"没必要"不同形: 前者要人来扩权或改契约，后者不需要任何人做任何事
```

★ 而**同一个形状在这一轮里已经是第二次出现**：§3.1-F6 的 B6 是我初稿里"总得有个收口"的产物，
而它**没有下游** ⇒ 按本任务自己的判据它不该存在 ⇒ 我把它改挂在 B5 之下。
**两次都是"我加了一个动作，而没有先问它防什么"。**

---

## 8. 验证（本任务的 verify 命令）

```sh
$ git status --short
?? docs/DECOMPOSITION-AUDIT.md        # ★ 本任务唯一 inScope 文件，唯一新增
```

★ **未命中 `src/ lib/ scripts/` 中任何文件**（out of scope），未改动任何已跟踪文件。
★ 而**这一条 verify 的局限必须说出来**：`git status --short` 只能证明"我只动了这一个文件"，
**它证明不了"这份拆解是对的还是错的"**——那份判决在 §6，而它的可核性来自 §5 的探针读数
（每条都给了命令与输出形态，任何第三方可以重跑，包括那两个假读数的复核方式）。

---

## 9. 变更记录

| 日期 | 改了什么 | 依据 |
|---|---|---|
| 2026-10-11 | 初稿：GOAL·A 拆解（11 条 / 17 边）→ 探针 P1–P6 → GOAL·B 拆解（6 条 / 6 边）+ 独立审查 reject/needs_revision + 改写 R1–R6 | t17 契约；本仓 `docs/PLAN-REVIEW.md`、`docs/DISPATCH-RULES.md`、`docs/SELF-ITERATION.md`；实测：`src/tools.ts:1926-1979`、`src/tools/edit-plan.ts:123`、`src/tools/status.ts:548`、`src/snapshot.ts:254`、`git merge-base --is-ancestor` × 3、`git log -1 88d1bdd` 的提交信息、`.agent-teams/agent-teams-hardening/{team.json,inbox/captain.jsonl}`（只读） |
| 2026-10-11 | ★ 修订：初稿 §4-G2/§5-P2 曾把两次**假读数**（`\| head` 掐掉了匹配行）当成真读数；本次逐条标出哪一次是假的、它错在哪，并立下"0 命中必须用 `grep -c` 复核"的纪律 | 实测（同一命令带/不带管道给出相反结论） |
| 2026-10-11 | ★★ 追加：§7.1 从"我这一轮没机会用 edit_plan"改成**机械证明它不可达**——三条同时成立（captain-only 工具 / 只接受 never-started pending / 我要改的五条任务全部已开工） | 实测：`src/tool-names.ts:24-28`、`src/tools.ts:1946`、`team.json` 的 t6/t8/t16/t17/t19 记录（只读） |
