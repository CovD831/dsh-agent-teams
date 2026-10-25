# S1 · 判据结果落盘到 task（t71 交付记录）

> **一句话**：`completion` 位置的判据结果（`GateEvaluation`）求值后曾被丢弃（本仓自记 F3「ran[] 产出即被丢弃，零消费」）；本任务把它**投影落盘**到 `TeamTask.gateEvaluation`，三态（缺字段 / 空位置 / 有内容）在形状上即可分辨。

---

## 1. 改了什么（逐文件）

| 文件 | 改动 |
|---|---|
| `src/state/tasks.ts`（形状） | 新增 `GateEvaluationRecord` / `GateRunEntryRecord` / `GateRequiresSummary` 三个落盘形状；`TeamTask.gateEvaluation?` 经 **module augmentation** 挂上 `TeamTask` —— inScope 不含 `types.ts`（零 import 叶子由独立任务持有写域），TS 声明合并使 `task.gateEvaluation` 对所有消费者与定义在 types.ts 逐字等价（已核：编译进 `lib/types/types.d.ts:508`） |
| `src/state/tasks.ts`（逻辑） | ① `clearAttemptResult` 增加 `task.gateEvaluation = undefined`（判据结果与 output/verdict **同一代际**：retry/reassign 清掉旧读数）② 新增 `gateEvaluationRecordOf()` —— 求值结果 → 落盘形状的**投影**（原样抄 `ran[]` 含 `skipped`/`observed`；`requires` 去掉当场才需要的 `checks[]`） |
| `src/state.ts` | 逐条再导出 `gateEvaluationRecordOf`（导出面不变纪律） |
| `src/tools/update-task.ts` | **唯一的行为新增**：字段写入块里 `task.gateEvaluation = gateEvaluationRecordOf(completionGates)` 一行（附硬约束③说明：只写不读，不改裁决语义） |
| `src/tools/update-task/completion.ts` | **零改动**（硬约束③：不许动裁决语义 —— 投影在调用方做，不在求值模块里做） |
| `lib/**` | 由 `pnpm build` 重新生成（含 `git-artifact-stamp.json`） |

### 设计决定（三条，各附理由）

1. **投影而不是原样塞**：`GateEvaluation.requires.checks[]` 是当场日志的形状（逐条判据的 present/skippedBecause），落盘只留计数 + 人话清单（`missing` / `gateCellsUndeclared`）。B 线（S2 → /state）读的是 `ran[]` 与计数，明细不损失；team.json 是持久文件，不是日志文件。
2. **不放进 `executions[]`**：历史记"那次尝试的结果"，本格记"最近一次求值的判据明细"——明细大、只对"现在读"有意义。代价如实记下：retry 会清掉上一代读数（`clearAttemptResult`），"上一代判据说什么"只在当场日志里 —— 与 `output`/`verdict` 同一代际策略。
3. **三态由写入点 + 形状共同保证**：
   - 【缺字段】= 没走过带求值的 update（如刚 reassign 完、从未 update 过）—— `clearAttemptResult` 拔掉旧一代读数后即此态；
   - 【空位置/全跳过】= 求值了但一条都没跑 —— `ran` 全是 `verdict:'skipped'` + `skippedAll` 在场（实测见 §2）；
   - 【有内容】= 求值了、有裁决。
   ★ **"没求值"绝不写成"求值了且通过"**：投影原样抄 `ran[]`，`skipped` 条目保留为 `verdict:'skipped'`（不是丢掉、更不是翻成 ok）；`observed` 原样保留（"开火了、被放过"必须可读，符号表 #4 的数据源）。

---

## 2. 验证（全部实跑，13/13 臂通过）

验证夹具走**真生产路径**：`registerAgentTools` + 真实 `agent_teams_update_task`（成员身份）+ 从盘上重读 `team.json`（断言持久化事实，不是内存状态——t19 教训）。

```
A/B 读数: {"ok":false,"evaluated":0,"skipped":4,"registered":4,"ranLen":4,
           "ranVerdicts":["skipped","skipped","skipped","skipped"]}
```

| 臂 | 断言 | 结果 |
|---|---|---|
| A 前置 | update_task 落得下 completed | PASS |
| **A ★** | **落盘后能读出来**：`task.gateEvaluation` 在盘上（非 undefined） | PASS |
| A | `ran[]` 是数组；`ok`/`evaluated`/`registered` 三计数可读；`requires` 投影在场 | PASS ×3 |
| **B ★** | **空位置可分辨**：`registered===0 ⟺ ran 空`；`skipped` 条目原样保留（ran 内 skipped 数 == skipped 计数，本例 4==4）；`observed` 双向一致 | PASS ×3 |
| **D ★** | **缺字段 ≠ 求值了且通过**：reassign（⇒ `clearAttemptResult`）后字段缺席；cancelled 路径**会**走过求值 ⇒ 字段在场是【如实记录】（全跳过 ⇒ `skippedAll` 在场，与"没求值"不同形） | PASS ×2 |
| **C ★ 反向半边** | **把落盘那一行从 lib 里删掉 ⇒ 重新走同一条生产路径 ⇒ 盘上字段缺席（读数 `{"hasField":false}`）⇒ 「字段在场」断言必须红** | PASS |

★ 夹具本体在 `/tmp`（一次性验证脚本）；本文件 §2 是它的可复现记录。要复跑：按 §1 的改动重放 + 上述流程，或等 S2 把 `/state` 转发接上后用正式夹具钉住（**S2 应把本记录的臂转成 `scripts/gate-*.test.mjs` 的常驻臂**）。

### 语义澄清（实测纠正了契约里的一个预设）

契约臂 D 预设「cancelled 任务 = 没求值过」。实测：`update_task(status='cancelled')` **会**走过 completion 求值点（它不是提前返回的路径），判据全部 `appliesTo` 跳过 ⇒ `skippedAll: "none of the 4 gate(s) registered at \"completion\" applied…"` 落盘。**这是如实记录**（那次确实求值了），恰好展示了三态里的第二态。真正的"缺字段"由 reassign/retry 的 `clearAttemptResult` 承载。

---

## 3. Verify 三条（正式命令）

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | exit=0 |
| `pnpm build` | exit=0（stamp.commit == HEAD `2b23665`） |
| `pnpm test:gates` | 1410 pass / 23 fail / **16 个失败文件** —— 与基线**逐条相同**（测试级集合相等，见 §4） |

## 4. 失败文件集合比对（口径先于数）

**基线（改动前同 worktree 实跑）**：1410 pass / 23 fail / **16 文件**（不是契约写的 1415/19/15 —— 那是在更早的 HEAD 上量的；本任务以**本 HEAD 的改动前读数**为基线，符合"净变化用失败文件集合判定"的纪律）。

改动后失败文件集合与基线**逐文件相同**（16 个，无新增、无消失）：
`gate-baseline-known-failures` / `gate-contract-build-artifacts` / `gate-falsification-pairs` / `gate-input-wiring` / `gate-producer-consumer` / `gate-repair-completion` / `gate-reviewed-passthrough` / `gate-source-reading-convention` / `gate-stale-module` / `gate-worktree-arrival` / `moment-facts` / `verify-admission` / `verify-input-requires` / `verify-runtime-integration` / `verify-task-atomicity` / `verify-unified-pipeline`。

★ 失败的**测试名**逐条属于 pin 清单或既有读数臂（如 producer-consumer 臂 4 的 `fixtureOnly 21 > 20` 记账红、stale-module 的基线新鲜度臂）；无一条因本任务新增的 `gateEvaluation` 字段而红。
★ **测试级集合相等已机械比对**（剥去用时戳后逐名比对）：基线与改动的失败文件集合（16 个）**与**逐文件失败测试名集合 **均为零差异** —— 不是"文件数恰好相同"，是**每一条红都同名**。

### lib/client.js 的 390 行 diff —— 环境产物，非内容变更

逐行核实：diff **100%** 由两类行构成——① `//#region \0dsh-css:<绝对路径>`（构建机路径：worktree vs 主检出）；② CSS-module 哈希类名（`_8qZE2a_*` → `DqeB0a_*` 等，hash 由路径派生）。排除这两类后**剩 0 行**。`src/client/**` 零改动。这是本仓 build 的已知路径非确定性（`tsdown` 内联 CSS 时嵌入绝对路径），不是本任务引入的。

---

## 5. 边界与后续

- **S2**（下一任务）把 `task.gateEvaluation` 转发进 `/state` 的 per-task map（`status.ts` 的 `tasks.map` + schema）。
- 本格与 t69 的 `auto.taskId/teamId`（卡点台账归属）**是两件事**：那个记"哪个任务被拒了"，这个记"判据在这条任务上看到了什么"。
- `gate-tool-output-schema` 的产出面对账不受影响：本字段挂在**持久层**（team.json），不新增任何工具返回字段。

---

## ★★ t74 补记：上面第 11 行描述的设计**有一半是错的**，已修正

> 本节**追加**，不改写上文 —— 上文如实记录了当时的实现与其自述，而那一自述本身是缺陷的一部分。

### 事实更正（逐条）

上文第 11 行写「S1 的形状**住 `state/tasks.ts`**，经 module augmentation 挂上 `TeamTask`」。
**实测不成立**：

```
$ grep -rn "export interface GateEvaluationRecord" src/            # 改前
src/state/tasks.ts:67:  export interface GateEvaluationRecord {
src/types.ts:341:       export interface GateEvaluationRecord {    ← ★ 这一份才是【活的】
```

两份**逐字相同**（各 **1091 字符**，md5 同为 `0dc8f4bb3ec101a87665437770944106`）。
而 `TeamTask.gateEvaluation` 绑定的是 **`types.ts` 那份**（`TeamTask` 与它同文件，
编译进 `lib/types/types.d.ts:508`）⇒ `state/tasks.ts` 那份是**重复声明**。

★ 连带发现：`gateEvaluation` 这个字段当时有 **3 处**声明 ——
`types.ts` 的 `TeamTask` 接口体、`state/tasks.ts` 的 `declare module` augmentation、
以及**它以为自己在做主**的那份接口。我的探针实测：**把 augmentation 整段删掉，`tsc --noEmit` 仍 exit=0**
⇒ augmentation 从第 1 天起就是**冗余的**。

### 为什么"以为在复制"却复制了已经存在的东西

上文的理由逐字是：「`src/types.ts` 是零 import 叶子，**它不能 import 别的模块**」。
★ **这条推理是对的，但它证明的结论不成立**：形状**本来就住在 `types.ts` 里**
（`TeamTask` 就在那儿，字段也声明在那儿）⇒ 不需要"因为叶子不能 import，所以形状只能住别处"。
⇒ 真正的成因是：**先假定"形状不该在 types.ts"，于是照那个假定写了一份** ——
而这正是本仓记账最久的形态：**一个成立的局部论证，被用来支持一个不成立的结论。**

### 改法（t74 实际做的）

| 动作 | 位置 |
|---|---|
| 删掉**重复的那一份**（三个接口） | `src/state/tasks.ts`（原 `:45-122`） |
| 改为 `import type { GateEvaluationRecord, GateRequiresSummary, GateRunEntryRecord }` | 同文件 import 块 |
| 删掉**冗余的 module augmentation** | `src/state/tasks.ts`（原 `:211-252`） |
| **不碰** `src/types.ts` | 它保留唯一声明，且仍是**零 import 叶子**（实测 `^import ` 计数 **0**） |

★ **零新依赖、零新环**：`src/state/tasks.ts` **本来就** import `../types.ts`（同文件既有 import）
⇒ 这次改动**没有新增任何依赖边**。

### 验证

```
$ grep -c "export interface GateEvaluationRecord" src/types.ts        ⇒ 1
$ grep -c "export interface GateEvaluationRecord" src/state/tasks.ts  ⇒ 0
$ npx tsc -p tsconfig.json --noEmit                                    ⇒ exit=0
$ pnpm build                                                           ⇒ exit=0
$ pnpm test:gates   ⇒ 1482 tests / 1424 pass / 20 fail / 16 文件
                       ★ 与基线【失败文件集合】逐条相同（comm 两侧均空）
```

**反向半边**（证明留下的那份**真在被用**，而非"两份都是死的"）：
```
$ 把 src/types.ts 的声明改名 ⇒ npx tsc --noEmit
src/state/tasks.ts(18,8): error TS2305: Module '"../types.ts"' has no exported member 'GateEvaluationRecord'.
src/types.ts(566,20):     error TS2304: Cannot find name 'GateEvaluationRecord'.
                                                       ⇒ exit=2 ★ 两处独立报错
```
★ **`types.ts:566` 那条是关键的**：它由 `TeamTask.gateEvaluation` 触发
⇒ 直接证明该字段绑的**就是**这一份，而不是靠推理。

**产物核对**（重复在编译结果里也消失了）：
```
lib/types/types.d.ts        GateEvaluationRecord ×2 = 1 声明 + 1 字段引用   ← 唯一声明
lib/types/state/tasks.d.ts  GateEvaluationRecord ×3 = 1 import + 2 使用      ← 【没有】声明
```

### 这一节与 t73 是同一条教训吗

**不是，但相邻**。t73 修的是「判据的**参照**会自毁」；t74 修的是
「**声明**有两份，而两份都编译得过」。
★ 共同点是同一个问题的两面：**当"正确"与"错误"在编译器眼里同形时，编译器就不再是判据**。
t65 为 `VisualTaskState` 删过一次同样的重复，并在那里写下了危害 ——
**本次是同一个缺陷在同一模块上的第二次出现**，成因也相同：*以为自己在"必要时复制"，实际复制了已经存在的东西*。
