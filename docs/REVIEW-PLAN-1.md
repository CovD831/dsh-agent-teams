# 计划审查①（第 3 轮）：依赖与顺序 —— t36 修复后的复验

> **审查人**：reviewer（t37，attempt `faf4570e-aad1-4b17-a173-041795c3e2dc`）
> **审查范围**：**仅**「依赖与顺序」这一个面（`§2 总 DAG` / `§2 依赖` / `§7 执行批次`）。其余面由别的审查者负责，本文不越界。
> **被审版本**：`docs/REFACTOR-PLAN.md` **829 行**（t36 修订后；含新增的 §8 工装缺陷与 P 线）
> **第 1/2 轮基线**：本文**下半部分**（第 2 轮 v2=661 行、第 1 轮 v1=281 行）
> **纪律**：本文**只写 `docs/REVIEW-PLAN-1.md`**；`git status --porcelain -- src/ scripts/` ⇒ 空。
> **裁决**：**needs_revision**（1 medium；**第 2 轮 3 条 finding 全部已修复**）

---

## R3-0. 结论摘要

**第 2 轮 3 条 finding 全部已修复。其中 F8 是「我错了、t36 对了」，我据实更正。**

| 第 2 轮 id | 状态 | 复验要点 |
|---|---|---|
| F8 medium（「18/384」复现不出） | ✅ **已修，且我方判断被推翻** | **t36 的 18 是对的，我的 12 是子集** —— 见 R3-2 |
| F9 low（`§6b.5` 工装阻塞陈述过期） | ✅ **已修** | `:755` 新增「该阻塞已解除」；★ 我用**新建 worktree** 做了最强验证（见 R3-3） |
| F10 low（`§2:78` M 行「依赖 无」） | ✅ **已修** | M/N 两行都改为「无（跨线）+ 线内依赖」，并写明「表里的『无』指跨线，不是线内」 |

**但本轮新发现一条 medium**：

> **§7 新排进来的 3 组工作 —— `O`（孤岛普查）、`T1/T2/T3`（工装缺陷）、`P`（效率线，P1–P5）—— 全部没有进 §2 的 DAG 图，也没有进 §2 的依赖表。** 而 §2 的依赖表正是「依赖与顺序」这一面的**权威位置**，§7 只是它的执行映射。§7 现在排了 12+ 项，§2 只认 9 行。

这正是**第 2 轮 F10 的同一形态**（表与批次不一致），只是这次规模更大：不是一行写漏，而是**三条工作线整条没进表**。

---

## R3-1. 覆盖面（本轮核了哪几条依赖、跑了什么命令）

### R3-1.1 逐条依赖复核（当前 829 行版）

| # | 依赖（`§2` 依赖表） | 我的核法 | 结论 |
|---|---|---|---|
| D1 | `E` ← `P0(含P0a/P0b) + B + M` | 核 M2/M3 与 B/E 写域 | ✅ 成立（M 拆 `quality-gates.ts` 2520 / `tools.ts` 2227，与 client 面不重叠） |
| D2 | `B` ← `P0 + A`（+ 软依赖 D3） | 核 `§2` 新增的 D3 行与 B0.4 的高度算式 | ✅ **新增的软依赖成立**（见 R3-1.4） |
| D3 | `A` ↔ `D1` 软依赖 | 核 `§3-A` 对齐步骤 | ✅ 已修（第 2 轮 F1） |
| D4 | `M`/`N` 线内依赖 | 核 M/N 行与 §7 批次 | ✅ **已修**（第 2 轮 F10）：两行都写明「无（跨线）+ 线内依赖」 |
| D5 | `P0` 无依赖 | — | ✅ 零行为变更 |
| D6 | ★ `O` / `T1-T3` / `P` 的依赖 | 在 `§2` 依赖表与 DAG 图中查找 | ❌ **整条线缺席** ⇒ **R3-F1** |

### R3-1.2 回源命令与读数

```sh
# ① 第 2 轮 F8：t36 给的脚本，我【逐字原样】跑
$ node /tmp/verify-t36.mjs          # 内容 = §3-D :228-240 的代码块，一字未改
parsed=372 multiAny=70 multiDistinct=18 completionSide=12      ← ★ 与 t36 声称逐字相同

# ② 我第 2 轮用的窄口径（错了的那次）
$ node -e "…/\[([a-z]+\.[a-z0-9-]+)\]/…"   ⇒ multiDistinct=12
#   差别在字符类：t36 用 [\w][\w.-]*（任意 id 形状），我用 [a-z]+\.[a-z0-9-]+（只认小写字母段）
#   ⇒ 窄口径漏掉的 6 条，正是 title 里带 [always-red] 的那批（见 ③）

# ③ 那 6 条是谁（可复跑）
$ node -e "…列出宽/窄口径的差集…"
f-0056 | WIDE ["contract.verify-command","always-red"] | NARROW ["contract.verify-command"]
f-0061 | WIDE ["contract.verify-command","always-red"] | NARROW ["contract.verify-command"]
f-0062 | WIDE ["contract.verify-command","always-red"] | NARROW ["contract.verify-command"]
f-0063 | WIDE ["contract.verify-command","always-red"] | NARROW ["contract.verify-command"]
f-0079 | WIDE ["contract.verify-command","always-red"] | NARROW ["contract.verify-command"]
f-0080 | WIDE ["contract.verify-command","always-red"] | NARROW ["contract.verify-command"]
⇒ 18 = 12 + 6，与 t36 §3-D :255 的「18 条里 12 条含 completion.*、6 条是 contract.verify-command + always-red」**逐字吻合**

# ④ 第 2 轮 F9：worktree 阻塞是否真解除（我用【新建 worktree】做最强验证）
$ git worktree add --detach /tmp/t37-check HEAD && ls /tmp/t37-check/docs/REFACTOR-PLAN.md
/tmp/t37-check/docs/REFACTOR-PLAN.md        ← ★ 干净检出【能读到】
$ git log --oneline -- docs/REFACTOR-PLAN.md | wc -l
3                                            ← 已入库（首次 25e7e2b）
（对照：旧的 t28 worktree 仍 No such file —— 那是【旧】worktree，不是反例）

# ⑤ 第 2 轮 F10：M/N 两行
$ sed -n '73,90p' docs/REFACTOR-PLAN.md | grep -cE "无（跨线）"
2                                            ← M 与 N 都改到了

# ⑥ 验收回归（4 项，全部不变）
$ grep -rh "^export const point = " src/gates/*/*.ts | sed "s/.*'\(.*\)'.*/\1/" | sort | uniq -c
   3 admission  4 completion  3 contract  2 delivery  3 dispatch  2 runtime      ⇒ 合 17
$ sed -n '/^const ALL_GATES = \[/,/^\] as const/p' src/gates/index.ts | grep -cE '^  [a-zA-Z0-9]+,$'  ⇒ 14
$ grep -cE 'readSource\(|readFile\(new URL' scripts/workspace-activity.test.mjs                       ⇒ 18
$ grep -c "includes(" scripts/workspace-activity.test.mjs                                             ⇒ 30
$ grep -rn "gateIdFromMessage(" src/ --include=*.ts | grep -vE ':[0-9]+:\s*(\*|//)' | wc -l           ⇒ 6
```

### R3-1.3 ★ 我第 2 轮的 F8 是错的 —— 据实更正

我第 2 轮用**窄字符类** `/\[([a-z]+\.[a-z0-9-]+)\]/` 复算得 12，据此判 `18` 复现不出。**t36 没有照我的字面改，而是把脚本写进文档并复算 —— 结果 18 为真。** 我逐字跑它的脚本得到 `multiDistinct=18`，与它声称完全一致。

**我的错在哪**（这是本轮最该记下的方法论点）：我**自己造了一个口径**（窄字符类）去复算**别人用另一口径写出的数**，然后把「我的口径得 12」当成了「18 是错的」。**正确的做法是先问「这个数用的是哪个口径」，再按那个口径复算。**
⇒ 而 t36 的处理**恰好正确**：它没有盲从我的「改成 12」，而是**把口径写进文档 + 给出可复跑脚本 + 说明 12 与 18 的子集关系（18 = 12 + 6）**，并额外标出宽口径 70 与「52 = 70 − 18 不回退」的反向半边。**这三点我逐条复现，全部成立。**

### R3-1.4 `§2` 新增的 D3 软依赖复核（第 2 轮之后新增）

```sh
$ sed -n '/### 依赖/,/可立刻并行/p' docs/REFACTOR-PLAN.md | grep -E "D3.*B0.4"
| **D3**（`admission.*` 是否接线） | 无（**待用户拍板**） | ★ **但它是 B0.4 的输入**：D3 裁定"接" ⇒ 异常上界 12→15 ⇒ **固定高度 23→26 行**（见 R9） |
```
**算式复核**（用 §3-A 的插入点表）：不含 `admission` 的注册判据 = `contract 3 + dispatch 3 + completion 4 + delivery 2` = **12** ✅；含 `admission 3` = **15** ✅。
⇒ **D3 → B0.4 的软依赖成立，算式正确**（我实算 `3+3+4+2=12`、`3+3+3+4+2=15`）。这是**本轮新增的一条依赖，且它被正确记进了表**——正好反衬出 R3-F1（O/T/P 没进表）。

### R3-1.5 第 2 轮已判「通过」的部分（回归复核）

| 项 | 第 2 轮读数 | 本轮 | 判定 |
|---|---|---|---|
| `F8` 改 18 / 真名 / 基数 18 与 30 | 18 / 30 | 未变 | ✅ |
| `E`←`B` 必要（同碰 client 两文件） | 61,265B / 37,836B | 未变 | ✅ |
| 写域冲突三组无交集 | C/N↔P0、P0↔A、M↔B/E | 未变 | ✅ |
| `gateIdFromMessage` 调用点 | 6 | 未变 | ✅ |

---

## R3-2. Findings

### R3-F1 — **MEDIUM**：`§7` 排进来的 `O` / `T1-T3` / `P(P1-P5)` 全部未进 §2 的 DAG 与依赖表

- **文件:行**：
  - `§7` 第一批（`:774-775`）：「★ **O** 孤岛普查（t33）—— 派生自用户裁定 R2」·「★ **T1/T2/T3** 三条工装缺陷（见 §8）」
  - `§7` 第二批（`:784-785`）：「★ **P 线**效率：P1 分快环/全环 · P2 按 inScope 选夹具 · P4 判据成本可见 · P5 全仓夹具读取缓存 · P3 存量红分流」
  - `§2` DAG 图（`:52-71`）：标题写「**6 条一等线**」，图里只有 `M / N / A / D / G / B` → `E`
  - `§2` 依赖表（`:75-90`）：只有 `P0 / M / N / A / D / G / B / E` + `D3` 软依赖行
- **问题**：`§7` 现在排了 **12 项以上**（`P0 M1 N1 A D1 G O T1 T2 T3` / `M2-M4 N2-N4 B1 D2 D4 P1 P2 P4 P5 P3` / `E`），而 `§2` 只认 **9 行**。`O`、`T1/T2/T3`、`P1-P5` **三组工作整条没进**：
  ```sh
  $ sed -n '/## 2\. 总 DAG/,/### 依赖/p' docs/REFACTOR-PLAN.md | grep -cE 'O 孤岛|T1|T2|T3|P 效率'
  0                                    # ★ DAG 图里一次都没出现
  $ sed -n '/### 依赖/,/可立刻并行/p' docs/REFACTOR-PLAN.md | grep -cE 'P1|P2|P3|P4|P5|O 孤岛'
  0                                    # ★ 依赖表里没有它们的行
  ```
- **为什么这是「依赖与顺序」这一面的问题（不是我越界审别的面）**：
  - `§2` 的依赖表是**依赖的权威位置**（第 2 轮 F10 已确立这一口径：表与批次不一致时读者信表）；
  - `O` 和 `P` 被**明确排进了批次**（`O` 在第一批、`P` 在第二批），而批次是**顺序**问题；
  - 更要紧的是**它们的依赖关系完全没写**：`O` 派生自「用户裁定 R2」，但 R2 的裁定状态没在表里；`P3` 自陈「**唯一需用户拍板**（与 backtest『基线先绿才能归因』冲突）」—— **这是一条真依赖（P3 与既有判据冲突），却没进依赖表**；`P1/P2/P4/P5` 在第二批，但**它们与第一批的 `P0` 有没有关系**（效率优化会不会被解耦改动影响）**没写**。
  - ⇒ 读者按 `§2` 排期，会**完全看不见** `O/T/P` 的存在；按 `§7` 排期，又会**查不到**它们的依赖。**这正是 t58 的形态（拆法的前提不在表里）。**
- **影响**：**中**。不阻塞已列出的线，但 `O` 是「用户裁定 R2」的直接产物（88 个零引用孤岛、删代码不可逆），`P3` 与既有判据冲突待拍板 —— **两条都是"必须先定才能做"的工作，却被排在批次里而没有依赖记录**。
- **必须怎么修**（三处，缺一不可）：
  1. **`§2` DAG 图**：标题从「6 条一等线」改为反映实际（或图内补 `O` / `P` / `T` 三个框）；至少注明「另有 `O`/`T`/`P` 三组短线未画入本图，见 §7 与 §8」。
  2. **`§2` 依赖表**：补行 ——
     - `O` 孤岛普查｜**依赖：用户裁定 R2 的删除授权**（`:654` 明写「删代码是不可逆动作，需你逐批拍板」）｜`O` 只出清单、不动手
     - `T1/T2/T3`｜**依赖：无**（工装缺陷，见 §8；`T2` 已应急处置）
     - `P1/P2/P4/P5`｜**依赖：无（跨线）**；★ 但**需写明与 `P0` 的关系**（效率优化是否受解耦改动影响）
     - `P3` 存量红分流｜**依赖：用户拍板**（与 `backtest`「基线先绿才能归因」冲突）
  3. **`§7` 每项补依赖标注**（或统一指向 `§2` 的表），使「批次」与「依赖」两个视图能互查。

---

## R3-3. 明确判「通过」的部分（本轮复验，不得因上面有 finding 而推翻）

1. **第 2 轮 F8 已修，且 t36 的判断优于我** ✅ —— 见 R3-1.3。它**没有**照我字面「改成 12」，而是把口径写进文档、给可复跑脚本、说明 `12 ⊂ 18`（`18 = 12 + 6`，6 条是 `contract.verify-command + always-red`），并标出宽口径 **70** 与「`52 = 70 − 18` 的同 id 重复**不回退**」的反向半边。**我逐条复现，全部成立。**
2. **`§3-D` 的验收句已改为可判** ✅ —— 「基线 = 18，命令 ⇒ `multiDistinct=18`，分母 372/384」「t30 修完后 18 → 0」，并附反向半边。这是我第 2 轮 F8 要求的，它做得更完整。
3. **第 2 轮 F9 已修，且我用最强方式验证** ✅ —— 不只看提交号，而是**新建 worktree 实测**：`git worktree add --detach /tmp/... HEAD` ⇒ `ls docs/REFACTOR-PLAN.md` **成功**。⇒ 干净检出确实能读到计划。该段**保留不删**（作为「为什么必须先把计划入库」的记录）—— 这个处置对。
4. **第 2 轮 F10 已修，且 M/N 两行都改到了** ✅ —— 两行均为「**无（跨线）**；★ 线内：…」，并写明「表里的『无』指**跨线**无依赖，**不是线内**无依赖」。**这正是我第 2 轮要的口径。**
5. **`§2` 新增的 D3 软依赖正确且算式可核** ✅ —— `12 = 3+3+4+2`（不含 admission）、`15 = 3+3+3+4+2`（含 admission）；`B ← P0+A` 与 `B0.4` 的固定高度联动已记入表。**这条新依赖进了表，且算得对。**
6. **写域冲突（t54/t70 式）本轮仍未发现** ✅ —— `C/N↔P0`、`P0↔A`、`M(quality-gates/tools)↔B/E(client)` 三组均无文件交集。
7. **验收回归 4 项不变** ✅ —— 插入点 `3/4/3/2/3/2`（合 17）· `ALL_GATES` 14 · P0a 基数 18 · `includes(` 30 · `gateIdFromMessage` 调用点 6。

---

## R3-4. 裁决

**verdict = `needs_revision`**

| id | severity | 文件:行 | 问题 |
|---|---|---|---|
| **R3-F1** | **medium** | `REFACTOR-PLAN.md:52-71`（DAG）· `:75-90`（依赖表）· `:774-775,784-785`（§7 批次） | `§7` 排进的 `O` / `T1-T3` / `P1-P5` 三组工作**整条未进 §2 的 DAG 与依赖表**；其中 `O` 依赖「用户裁定 R2」、`P3` 自陈「需用户拍板」且与既有判据冲突 —— **两条"必须先定才能做"的工作没有依赖记录** |

**放行条件（很轻，预计 10 分钟）**：
1. **R3-F1 必修** —— `§2` 补 `O`/`T`/`P` 的依赖行（至少写明 `O` 依赖 R2 授权、`P3` 待拍板），DAG 图注明「另有 O/T/P 三组未画入」。
2. 建议 `§7` 每项补依赖标注，使两个视图可互查。
3. 改完重跑 R3-1.2 的 ⑥ 四条命令自证读数不变（我预期全部不变）。

**为什么不是 `pass`**：`§2` 的依赖表是这一面的**权威位置**（第 2 轮 F10 已确立），而它现在**漏了三条工作线**。更要紧的是漏掉的里面有两条**待裁定的前置**（`O` 要 R2 授权、`P3` 与 backtest 冲突）—— 这正是本队反复处理的形态：**「必须先定才能做」的工作被排进批次，却没记下它为什么能/不能开始。**

**为什么不是 `reject`**：**第 2 轮 3 条 finding 全部已修复**，其中 F8 **推翻了我自己的判断**（t36 对、我错），且它给出的三档口径 + 可复跑脚本 + 反向半边我**逐条复现成立**；F9 我用新建 worktree 做了最强验证；F10 两行都改到。依赖链、写域、验收回归均无问题。缺陷是**一处表与批次不一致**，定点可修。

---

*本轮只审「依赖与顺序」。载荷预算、符号纪律、M/N/P 线的方案本身、C 线架构决策等面**刻意未审**，留给其他审查者。*

---
---

# 计划审查①（第 2 轮）：依赖与顺序 —— t28 修复后的复验

> **审查人**：reviewer（t29，attempt `9eb00529-55ac-49ce-a01b-6beb9cd9516f`）
> **审查范围**：**仅**「依赖与顺序」这一个面（`§2 总 DAG` / `§2 依赖` / `§7 执行批次`）。其余面由别的审查者负责，本文不越界。
> **被审版本**：`docs/REFACTOR-PLAN.md` **v2 = 661 行**（t28 修订后）
> **第 1 轮基线**：本文**下半部分**（「第 1 轮（t25）」一节，v1 = 281 行）
> **纪律**：本文**只写 `docs/REVIEW-PLAN-1.md`**；`git status --porcelain -- src/ scripts/` ⇒ 空。
> **裁决**：**needs_revision**（1 medium + 2 low；**第 1 轮 7 条 finding 全部已修复**）

---

## R2-0. 结论摘要

**第一轮 7 条 finding 全部已修复，且修法普遍比我要求的更好。**

| 第 1 轮 id | 状态 | 复验要点 |
|---|---|---|
| F1 blocker（`A`↔`D1` 隐性依赖） | ✅ **已修** | `§2:80-81` 写明软依赖；`§7:644-646` 加「第一批开工前先写两份读出契约」 |
| F2 blocker（`D1` 目标写小了） | ✅ **已修且超出要求** | `§3-D:191` 逐字改为「真实缺口是 `gateIdFromMessage` 用 `.exec()` 只取第一个 id」；立为 t30；`V:203-208` **加了反向半边双验收** |
| F3 high（`D2`/`D4` 无落点） | ✅ **已修** | `§7` 第二批含 `D2/D4`；并给整线顺序 `D1 → (D2 ∥ D4)` |
| F4 high（「21 处」/ 不存在的函数） | ✅ **已修** | `F8` 改 **18**；`P0a:455` 明写「不许引用 `extractActivityPanelCss`（不存在）」 |
| F5 high（`R5` 未结案） | ✅ **已修** | `R5:549` 标「已由 §7 解除」；**新增 `R5b:550`** 承载残余并给二选一处置 |
| F6 medium（`E` 依赖未含 P0b） | ✅ **已修** | `:84` 改为 `P0（含 P0a 与 P0b）+ B + M`，并写明 CSS 切分输入条件 |
| F7 medium（`C3`↔`D1/D2` 共享语料） | ✅ **已修** | `§2:88-92` 新增「共享资源」段，并写明后果（「字段没了」与「卡点本来就没有」同形） |

**且 v2 新增的 6 条可复跑命令我逐条复现，全部命中**（见 R2-1.2）。

**但仍有三处必须修**：
1. **F8（medium）**：`F13` 新写的「语料 **18/384** 条已受害」**我复现不出来** —— 四种口径分别得 **12 / 9 / 3 / 70**，无一是 18。而这是 t28 本轮**新引入**的数，被用作 `D1`（t30）的**语料基线与验收判据**。
2. **F9（low）**：`§6b.5` 记的「`REFACTOR-PLAN.md` 从未被 commit」**已被 `25e7e2b` 解决**，但正文仍以现在时陈述 ⇒ 读者会以为阻塞仍在。
3. **F10（low）**：`§2:78` 把 `M` 写成「依赖 无」，而 `M2/M3/M4` 硬依赖 `M1`（`§3-M` 与 `§7` 都已写对）⇒ 同一事实三处三种写法。

**另点名肯定**：`§6b.5` 处理「契约行号指向 v1」的方式（**逐条按语义核对、只补残余、不重做已满足的**）是本轮最专业的一处。

---

## R2-1. 覆盖面（本轮核了哪几条依赖、跑了什么命令）

### R2-1.1 逐条依赖复核

| # | 依赖（v2 `§2:75-84`） | 我的核法 | 结论 |
|---|---|---|---|
| D1 | `E` ← `P0(含P0a/P0b) + B + M` | 核 M2/M3 与 B/E 的写域 | ✅ **成立**（M 拆 `quality-gates.ts` 2520 行 / `tools.ts` 2227 行，与 B/E 的 client 面不重叠） |
| D2 | `B` ← `P0 + A` | 同第 1 轮 | ✅ 必要 |
| D3 | `A` ↔ `D1` 软依赖 | 核 `§3-A:145` 的对齐步骤是否落地 | ✅ **已按 F1 修** |
| D4 | `M` 依赖「无」 | 核 `M1→M2/M3/M4` 的内部顺序 | ⚠️ **见 F10** |
| D5 | `N` 依赖「无」 | 核 `N2/N3` 是否需用户裁定 | ✅ `N2` 标「需你拍板」⇒ 与 `D3` 同形，非硬依赖 |
| D6 | 六线「可立刻并行」 | 逐线取写域求交 | ⚠️ **见 F10**（`§7` 已把 M1/M2-M4 分排两批，但依赖表只写「无」） |

### R2-1.2 v2 新增的「可复跑」命令 —— 逐条复现

```sh
# ① 六个插入点的判据数
$ grep -rh "^export const point = " src/gates/*/*.ts | sed "s/.*'\(.*\)'.*/\1/" | sort | uniq -c
   3 admission      4 completion     3 contract
   2 delivery       3 dispatch       2 runtime
⇒ 合计 17；completion 上限 4 —— 与 §3-A 表逐字一致 ✅

# ② ALL_GATES 实注册数
$ sed -n '/^const ALL_GATES = \[/,/^\] as const/p' src/gates/index.ts | grep -cE '^  [a-zA-Z0-9]+,$'
14                                                  ✅

# ③ status.ts 只送 runtime_gates 一格
$ sed -n '743p' src/tools/status.ts
          ...runtimeRecord === undefined ? {} : { runtime_gates: runtimeRecord },   ✅

# ④ client 侧零判据字段（唯一命中是注释）
$ grep -rn "runtime_gates\|gate" src/client/activity-monitor.ts
42: * @returns `'inconclusive'` (review found problems — the gate did its job),
⇒ 1 处且是注释 ✅ —— §3-A「client 今天收不到任何判据数据」成立

# ⑤ gateIdFromMessage 的真实调用点数
$ grep -rn "gateIdFromMessage(" src/ --include=*.ts | grep -vE ":[0-9]+:\s*(\*|//)" | wc -l
6                                                   ✅ —— F13 的「6 个调用点」成立

# ⑥ P0a 的基数（t28 本轮新增）
$ grep -cE 'readSource\(|readFile\(new URL' scripts/workspace-activity.test.mjs
18                                                  ✅
$ grep -c "includes(" scripts/workspace-activity.test.mjs
30                                                  ✅ —— 「改后不许降」的判据可复跑
```

### R2-1.3 F2（blocker）修复的实质复核

```sh
$ sed -n '191p' docs/REFACTOR-PLAN.md
**真实缺口是 `gateIdFromMessage` 用 `.exec()` 只取第一个 id**（F13）—— 一条**会丢数据的落盘路径**。
$ sed -n '2933,2936p' src/tools/shared/entities.ts
export function gateIdFromMessage(message: string): string | undefined {
  const match = /\[([\w][\w.-]*)\]/u.exec(message)
  return match?.[1]                      # ★ .exec() 非全局 ⇒ 只返回第一个匹配
}
$ node -e "const re=/\[([\w][\w.-]*)\]/u; console.log(re.exec('…: [a.b] and [c.d]')?.[1])"
a.b                                       # 复现：第二条丢失
```
⇒ `§3-D:197` 把 D1 立为 **t30**，并把验收写成「正向 + 反向半边」双表（`:203-208`），它自己写明了**为什么必需**：「一个**只记首条**的实现能通过全部正向断言」。**这一条修得比我第 1 轮要求的更完整。**

### R2-1.4 第 1 轮已判「通过」的部分（回归复核）

| 项 | 第 1 轮读数 | 本轮 | 判定 |
|---|---|---|---|
| `E`←`B` 必要（同碰 client 两文件） | 61,265B / 37,836B | 未变 | ✅ |
| `C/N↔P0` 不撞 | 测试不引用 triage 脚本 | 未变 | ✅ |
| `P0↔A` 不撞 | 测试不引用 `status.ts` | 未变 | ✅ |
| `F8` 的 5 个引用行号 | 全部属实 | 未变（`F8` 已改 18） | ✅ |
| `D3` 与 `D1` 可解耦 | `admission: []` | 未变 | ✅ |

### R2-1.5 工装/追踪状态复核

```sh
$ git status --short docs/REFACTOR-PLAN.md
（无输出）
$ git log --oneline -- docs/REFACTOR-PLAN.md
25e7e2b docs: land this round's deliverables so worktree-isolated tasks can read them
```
⇒ **`REFACTOR-PLAN.md` 已被 commit**（`25e7e2b`），第 1 轮/t28 记的「从未被 commit、干净检出里没有它」**已解决** ⇒ 见 **F9**（`§6b.5` 陈述需更新）。
```sh
$ git status --porcelain -- src/ scripts/
（空）                      # 我未改动任何 src/、scripts/ ✅
```

---

## R2-2. Findings

### F8 — **MEDIUM**：`F13` 的「语料 **18/384** 条已受害」复现不出来（我实测 12 / 9 / 3 / 70，无一是 18）

- **文件:行**：`docs/REFACTOR-PLAN.md:43`（`F13`：「⇒ 落盘端系统性丢数据；6 个调用点；语料 **18/384** 条已受害」）· `:213`（「★ 语料基线（可复跑）：**18/384** 条卡点已受此缺陷之害（F13），修复后该分母应下降」）
- **问题**：`18` 是本轮（t28/v2）**新引入**的数，且被用作 `D1`（t30）的**语料基线与验收判据**。我用四种口径复算，**没有一种得出 18**：

```sh
$ # 口径 A：标题里 >1 个【不同】[id] 的记录（= 落盘端真会丢的那批）
multi-id records = 12      ← ★ 我实得 12
   列表（可核）：f-0037 f-0052 f-0069 f-0286 f-0292 f-0296 f-0299
                 f-0309 f-0313 f-0318 f-0320 f-0334
   其中 f-0286 有 3 个 id，落盘只存了 completion.verify-rerun
         f-0292 有 2 个 id，落盘只存了 completion.r5（丢了 completion.backtest）

$ # 口径 B：已落盘 gate 且丢了额外 id 的
 = 9
$ # 口径 C：多 id 且完全未落盘 gate 的
 = 3
$ # 口径 D：标题里 [id] token 总数 > 1 的（含重复 token）
 = 70
```
- **为什么这条要紧**（不是吹毛求疵）：
  1. 它是**本轮新写的数**，而本轮的主题正是「数要能复跑」；
  2. 它被写成**验收判据**（「修复后该分母应下降」）—— 若基线错，`t30` 修完后**无法判断分母是否真的下降**（基线 18 → 实得 12，会被读成「修得不对」或「基线虚高」）；
  3. 第 1 轮 F4 就是同一类（「21 处」实际 18）。**同一份计划连着两轮都在一个"数"上出问题**，这一格值得作为纪律点。
- **必须怎么修**（二选一，都要给命令）：
  - (a) 改 **18 → 12**，并附口径与命令：
    ```sh
    # 口径：标题里 >1 个【不同】[id] 的记录（落盘端会丢的那批）
    node -e "…[...new Set(title.matchAll(/\[([a-z]+\.[a-z0-9-]+)\]/g))].length > 1…"   # ⇒ 12
    ```
  - (b) 若 `18` 出自**另一种口径**，**把该口径与命令写出来**（例如「含 token 重复的记录」「6 个调用点各自的受影响数之和」等），并说明它与「12」的差别。
  - ★ 无论选哪个，`:213` 的验收句要改为**可判**：写明「基线 = N（命令 ⇒ N）」，让 `t30` 修完后能机械比对。

### F9 — **LOW**：`§6b.5` 记的「`REFACTOR-PLAN.md` 从未被 commit」已被 `25e7e2b` 解决，但正文仍以现在时陈述

- **文件:行**：`docs/REFACTOR-PLAN.md:628-635`（`§6b.5` 末尾「★ 另一件必须留痕的事（工装问题，不是计划问题）：t28 被分派到隔离 worktree…但 **`docs/REFACTOR-PLAN.md` 从未被 commit**（`git log -- docs/REFACTOR-PLAN.md` ⇒ 空；它在队长工作区是 `??` 未跟踪）⇒ **干净检出里没有这个文件**」）
- **问题**：该陈述在**写入时是对的**（t28 实测过），但**现在已不成立**：

```sh
$ git log --oneline -- docs/REFACTOR-PLAN.md
25e7e2b docs: land this round's deliverables so worktree-isolated tasks can read them
$ git status --short docs/REFACTOR-PLAN.md
（无输出）                    # 已跟踪、无未提交改动
```
  ⇒ `§6b.5` 的建议（「把 `docs/REFACTOR-PLAN.md` 纳入 git」）**已被执行**，但正文仍以现在时描述阻塞 ⇒ 读者会以为问题仍在（或以为还没处理）。
- **影响**：低 —— 不影响任何依赖判断，但**会让下一位读者重复排查一个已解决的工装问题**，而 `§6b.5` 存在的意义正是「留痕以免重查」。
- **必须怎么修**：在 `:628` 那段末尾加一句状态更新，例如：
  > ★ **2026-10-15 更新**：已由 `25e7e2b`（docs: land this round's deliverables…）**纳入 git** —— `git log --oneline -- docs/REFACTOR-PLAN.md` ⇒ 命中 1 条。**该阻塞已解除**；此段保留为「为什么必须先把计划入库」的记录。

### F10 — **LOW**：`§2:78` 把 `M` 写成「依赖 无」，但 `M2/M3/M4` 硬依赖 `M1`（表与 `§3-M`/`§7` 三处口径不一）

- **文件:行**：`docs/REFACTOR-PLAN.md:78`（`| **M** 模块拆分 | 无（纯搬运，先做） | 与 client 不重叠时安全 |`）· `:104-107`（`§3-M`：`M1` 只读分析；`M2`/`M3`/`M4` 是搬运，`M4` 明写「**视 M1 结论而定**」）· `:648`（`§7` 第二批：「`M2–M4` 拆分（**依 M1 结论**）」）
- **问题**：`§7` 与 `§3-M` 都正确地把 `M1` 放第一批、`M2–M4` 放第二批（依 M1 结论）—— **执行顺序是对的**。但 `§2` 的依赖表**只写「M 依赖 无」**。"无依赖"是针对**整条 M 线**（不依赖别的线）而言的，**但读表的人会以为 M 内部可立刻全开工**；而 `M2/M3/M4` 实际**硬依赖 `M1` 的结论**。
  ⇒ **同一事实在三处三种写法**：依赖表「无」/ `§3-M` 隐含 `M1→M2..M4` / `§7` 明确「依 M1 结论」。**依赖表是关于依赖的权威位置，它应当给出口径最严的那一版。**
- **影响**：低（`§7` 已排对，执行时大概率不会错），但这是**第 1 轮 F3（`D2/D4` 无落点）的同类**：表与批次不一致时，读者会信表。
- **必须怎么修**：`:78` 的 `M` 行改为：
  > `M` 模块拆分｜**无（跨线）**；★ **线内：`M2/M3/M4` 依赖 `M1` 的结论**（`M1` 只读分析在第一批，`M2–M4` 在第二批）｜与 client 不重叠时安全

  并建议顺带核对 `N` 行同形（`N2–N4` 依 `N1` 地图 + 用户裁定）—— `§7` 已排对，但依赖表同样只写了「无」。

---

## R2-3. 明确判「通过」的部分（本轮复验，不得因上面有 finding 而推翻）

1. **第 1 轮 F1（blocker）已修** ✅ —— `§2:80-81` 写明 `A`/`D` 软依赖；`§3-A:145` 给出对齐步骤；`§7:644-646` 把「两份读出契约」落在**第一批开工前**。这正是我第 1 轮要求的「把 t54 的教训提前到设计期」，且它选了**不合并 A1/D1** 并写明代价（写域不同、合并会拆掉两个独立审查者）—— 这个取舍我认可。
2. **第 1 轮 F2（blocker）已修且超出要求** ✅ —— `§3-D:191` 逐字写明真实缺口是 `.exec()` 只取第一个；立为 t30；`V:203-208` 给出**正向 + 反向半边**双验收并写明理由。
3. **第 1 轮 F3/F4/F5/F6/F7 全部已修** ✅ —— 见 R2-0 表；F4 的两个新基数（18 / 30）我**逐条复现命中**。
4. **v2 新增的可复跑命令 6 条全部命中** ✅ —— 插入点 3/4/3/2/3/2、`ALL_GATES` 14、`status.ts:743`、client 零判据字段（唯一命中是注释）、`gateIdFromMessage` 6 个调用点、P0a 基数 18/30。
5. **`§6b.5` 的「契约行号指向 v1」处置是专业的** ✅ —— 它没有盲从契约行号，而是**逐条按语义核对**，结论「3 条已被 v2 满足 / 1 条部分 / 3 条残余」，并**只补残余、不重做已满足的**（理由写明：「重做会产生重复条款，比缺条款更难发现」）。**这一条值得作为本队纪律。**
6. **`E` 的依赖链已完整** ✅ —— `P0（含 P0a 与 P0b）+ B + M`，且写明 `E1` 的 CSS 切分输入条件（`P0b` 删净死类之后）；`§7:652-654` 同步注明 `R5b` 待处置。
7. **`R5`/`R5b` 的拆分正确** ✅ —— `R5` 标「已由 §7 解除」（P0 批次1、E 批次3 ⇒ 天然串行），`R5b` 承载第 1 轮 F5 的**残余**（E 无备选）并给二选一处置，`§7` 第三批同步提醒。
8. **写域冲突（t54/t70 式）本轮仍未发现** ✅ —— `C/N↔P0`、`P0↔A`、`M(quality-gates/tools)↔B/E(client)` 三组均无文件交集。

---

## R2-4. 裁决

**verdict = `needs_revision`**

| id | severity | 文件:行 | 问题 |
|---|---|---|---|
| **F8** | **medium** | `REFACTOR-PLAN.md:43,213` | `F13` 新写的「语料 **18/384** 已受害」复现不出（我实测 **12 / 9 / 3 / 70**，无一是 18）；而它被用作 `D1`（t30）的**语料基线与验收判据** |
| **F9** | **low** | `REFACTOR-PLAN.md:628-635` | `§6b.5` 仍以现在时陈述「`REFACTOR-PLAN.md` 从未被 commit」，但已由 `25e7e2b` 解决 ⇒ 读者会以为阻塞仍在 |
| **F10** | **low** | `REFACTOR-PLAN.md:78` | `§2` 依赖表把 `M` 写成「依赖 无」，而 `M2/M3/M4` 硬依赖 `M1`（`§3-M`/`§7` 已写对）⇒ 同一事实三处三种写法 |

**放行条件（很轻，预计 10 分钟）**：
1. **F8 必修** —— 改为 12，或**写出 18 的口径与命令**；并把 `:213` 的验收句改成可判（「基线 = N（命令 ⇒ N）」）。
2. F9、F10 建议同批修（都是补一句状态/口径）。
3. 改完重跑本节 R2-1.2 的 6 条命令自证读数不变（我预期全部不变）。

**为什么不是 `pass`**：F8 落在**本轮新引入的数**上，且被写成 `t30` 的**验收基线** —— 基线错会让「修复后该分母应下降」这句**无法机械判定**。本计划本轮的主题正是「数要能复跑」，而它自己在这一格没给命令（第 1 轮 F4 的「21 处」是同一类，**连着两轮在同一个"数"上**）。F9/F10 是干净度问题，一并修掉可让下一轮直接判 pass。

**为什么不是 `reject`**：**第 1 轮 7 条 finding 全部已修复**，其中两条 blocker 的修法**超出我的要求**；v2 新增的 6 条可复跑命令**逐条复现命中**；依赖链 `E ← P0(含P0a/P0b) + B + M` 完整；写域冲突三组均无交集。缺陷是**一个待核的数 + 两处陈述**，**定点可修**。

---

*本轮只审「依赖与顺序」。载荷预算、符号纪律、M/N 线的拆分方案本身、C 线架构决策等面**刻意未审**，留给其他审查者。*

---
---

# 第 1 轮（t25）：v1 的计划审查记录

> **审查人**：reviewer（t25，attempt `dedb5b0b-bddd-4fb2-b6f6-62f3ce02ec30`）
> **审查范围**：**仅**「依赖与顺序」这一个面（`§2 总 DAG` / `§2 依赖关系` / `§7 建议的执行顺序`）。其余面由别的审查者负责，本文**不越界**。
> **被审版本**：`docs/REFACTOR-PLAN.md` 281 行（2026-10-15）
> **事故基线**：`docs/PLAN-REVIEW.md` §1 三类事故（t58 前提不在 / t54 amend 三次 / t70 丢 4 组接线）
> **纪律**：本文**只写 `docs/REVIEW-PLAN-1.md`**；未改任何被审文件、未改 `src/`、`scripts/`。
> **裁决**：**needs_revision**（2 blocker + 3 high + 2 medium）

---

## 0. 结论摘要

**DAG 的骨架是对的**：`P0` 作为前置（解耦测试绑定）、`B` 依赖 `P0+A`、`E` 放在最后 —— 这三条都有实据支撑，且`E`放最后**确实是必要的**（B 和 E 碰的是同一批文件，见覆盖面 D1）。

**但第一批「四线并行」这个安排有两处会真出事**：

1. **`A` 与 `D1` 之间存在一条计划没画出来的隐性依赖**（**F1, blocker**）。但**方向与任务书的猜测相反**：不是「A1 需要等 D1」，而是 **D1 需要的那个数据源，正由 A 线在改** —— 两者都要动「`/state` 载荷 + 判据读数出口」这一块语义。更关键的是：**`evaluate()` 今天已经把 `ran[]` 返回了**，`D1` 说的「让 ran 落盘」**描述的缺口不是产生不了，而是没人消费**（见 F2）。计划的措辞把这两件事混成了一件。

2. **`D1` 被同时放进「第一批并行」和「D2/D4 的前置」**，而 `D2/D4` 没有出现在任何批次里（**F3, high**）—— `§7` 只排到第三批就结束了，`D` 线的下游步骤**无处安放**。

另有一处**数字性错误**必须修：`F8` 的「21 处」实测是 **18 处**，且 `P0a` 引用的 `extractActivityPanelCss` 与 `:1823-1829` **在盘上不存在**（**F4, high**）—— 而 `P0a` 的整个做法**建立在这个引用上**。

---

## 1. ★ 覆盖面（先给读数）

### 1.1 我核了哪几条依赖

| # | 依赖（计划 `:73-82`） | 我的核法 | 结论 |
|---|---|---|---|
| D1 | `E` ← `B`：是否真必要 | 比对 B/E 的文件写域（`§3 B1-B6` vs `§3 E1`） | ✅ **必要**（同碰 `ActivityPanel.tsx` 37,836B + `.module.css` 61,265B） |
| D2 | `B` ← `P0`：是否真必要 | 核 `P0a` 改的是「读 client 源文本的测试」 | ✅ **必要**（`workspace-activity.test.mjs` 是本仓 client 的**假红唯一来源**） |
| D3 | `B` ← `A`：是否真必要 | 核 B2「实现判据管线图组件」的数据来源 | ✅ **必要**（B 要画的就是 A1 要送的那份数据） |
| D4 | `P0`/`A`/`C`/`D` 四线无依赖 | 逐线取写域并求交 | ❌ **`A` 与 `D1` 相交** ⇒ **F1** |
| D5 | `C` ← 无 | 核 `C` 与 `P0` 是否同碰 `scripts/` | ✅ **不撞**（见 1.3） |
| D6 | `F` ← `D` | — | ⚠️ `F` 是「待裁定」，不是执行线，无需排期 |

### 1.2 回源命令与读数（每条可复跑）

```sh
# ① F3 的「ran 产出即被丢弃」——我独立复跑，成立
$ grep -rn "\.ran\b" src/ | wc -l
0                                   # 零消费，与计划 F3 一致 ✅
$ grep -rn "\.ran\b" src/tools/ | wc -l
0                                   # 连 tools/ 里也没有

# ② ★ 但 ran 是【被产生并返回】的，不是「没落盘」
$ sed -n '143,147p' src/gates/registry.ts
export interface GateEvaluation { ok, blockers, unmeasured?, ran: GateRunEntry[], outputs, ... }
$ sed -n '650p' src/gates/registry.ts
      const ran: GateRunEntry[] = []          # ← 每一轮 evaluate() 都在填
$ grep -c "ran.push(" src/gates/registry.ts
9                                   # 9 处 push（skipped/unmeasured/ok/blocked 各态）
$ sed -n '843p' src/gates/registry.ts
      const counts = { evaluated, skipped, registered }   # ← counts 也返回了

# ③ ★ D1 要补的真实缺口：gate id 是靠【正则解析人话】得到的，权威的 ran[] 被丢掉
$ sed -n '1530,1534p' src/tools/update-task.ts
              auto: {
                tool: 'agent_teams_update_task',
                point: 'completion',
                ...gateIdFromMessage(frictionMessage) === undefined ? {} : { gate: gateIdFromMessage(frictionMessage) as string },
              },
$ sed -n '2933,2936p' src/tools/shared/entities.ts
export function gateIdFromMessage(message: string): string | undefined {
  const match = /\[([\w][\w.-]*)\]/u.exec(message)
  return match?.[1]
}
$ node -e "const re=/\[([\w][\w.-]*)\]/u; \
  console.log(re.exec('…: [a.b] and [c.d]')?.[1])"
a.b                                 # ★ 只取【第一个】—— 多判据同时开火时丢失其余
```

**⇒ 这条是本次审查最有价值的发现**：落盘的 `auto.gate` **不是**从 `ran[]` 来的，而是**从拒绝消息里正则抽的第一个 `[id]`**。
我在 t17/t19 量到的「一条记录可归因多个 id（12 条多值记录，f-0286 命中 3 个）」**在落盘端就已经丢掉了 2 个** —— 因为 `gateIdFromMessage` 只返回第一个。这与本队刚修完的 `completion.r5` 数字盲区**是同一族**（正则 vs 权威数据源）。

### 1.3 写域交集（t54/t70 那一类）

```sh
# C 与 P0 是否撞：C 拟移的 scripts 文件，P0 的测试是否引用
$ ls scripts/friction-triage.mjs scripts/judgement-triage.mjs
-rw-r--r--  160390  scripts/friction-triage.mjs
-rw-r--r--   43624  scripts/judgement-triage.mjs
$ grep -n "friction-triage\|judgement-triage\|triage" scripts/workspace-activity.test.mjs
（无输出）                          # ★ 不撞 ✅ —— C 与 P0 虽然同属 scripts/，但不是同一批文件

# P0 与 A 是否撞
$ grep -n "status.ts" scripts/workspace-activity.test.mjs
（无输出）                          # ★ 不撞 ✅
```

⇒ 计划标称的「`P0` 与 `A` 文件不重叠」**成立**；「`C` 与 `P0` 同属 `scripts/` 但会撞」**不成立**（是不同文件）。
⇒ 但**这不等于第一批没问题** —— 问题在 `A` 与 `D1`（F1）。

### 1.4 `P0a` 引用复核

```sh
$ grep -rn "extractActivityPanelCss" src/ scripts/
（无输出）                          # ★ 不存在
$ sed -n '1823,1829p' scripts/workspace-activity.test.mjs
/** The ActivityPanel stylesheet, which owns every screen-one class. */
async function panelStylesheet() {          # ← 实际是这个函数，不是 extractActivityPanelCss
$ grep -cE "(readSource|readFile|readFileSync)\(" scripts/workspace-activity.test.mjs
18                                  # ★ 实测 18 处，计划 F8 写「21 处」
$ wc -l scripts/workspace-activity.test.mjs
2180
```

### 1.5 引用的行号是否属实

```sh
$ for n in 1231 1266 1281 1743 1801; do sed -n "${n}p" scripts/workspace-activity.test.mjs | cut -c1-70; done
1231:  const cssSource = await readFile(new URL('../src/client/ActivityPanel.module.css', import.meta.re
1266:  const source = await readFile(new URL('../src/client/MemberRow.tsx', import.meta.url), 'utf8')
1281:  const panel = await readFile(new URL('../src/client/ActivityPanel.tsx', import.meta.url), 'utf8')
1743:  const cssSource = await readSource(new URL('ActivityPanel.module.css', CLIENT_ROOT), 'utf8')
1801:  const bundle = await readSource(new URL('../lib/client.js', import.meta.url), 'utf8')
```
⇒ **`F8` 的 5 个行号全部属实** ✅（这是好的；问题只在「21」这个计数与 `extractActivityPanelCss` 这个引用）

### 1.6 `E` 放最后是否必要（B/E 写域）

```
B 的目标（§3 B1-B6）：判据管线图组件 · 成员降级为流程行 · 状态挂到任务 ·
                      CJK 宽度 · 成员名中文+两行
E1 的目标（§3 E1）  ：CSS 按组件切（61KB）· TSX 拆文件（37KB）

$ wc -c src/client/ActivityPanel.module.css src/client/ActivityPanel.tsx
 61265 src/client/ActivityPanel.module.css      # 「61KB」✅
 37836 src/client/ActivityPanel.tsx             # 「37KB」✅
```
⇒ B 要重排的正是 E 要拆的那两个文件 ⇒ **`E` ← `B` 必要** ✅（若反过来，E 拆完的文件 B 还要再动一遍 —— 正是任务书问的"先做后返工"）

---

## 2. Findings

### F1 — **BLOCKER**：`A` 与 `D1` 之间有隐性依赖，第一批「四线并行」这一格不成立

- **文件:行**：`docs/REFACTOR-PLAN.md:76`（`A` 依赖「无」）· `:79`（`D` 依赖「无」）· `:84`（「P0/A/C/D 四线可立刻并行开工」）· `:266`（第一批列 `A 读数出口` 与 `D1 ran/skipped 落盘` 并列）
- **问题**：计划把 `A`（读数出口）与 `D1`（让 ran/skipped 落盘）判为互不依赖并放进同一批。实测两者**改的是同一条数据通路的两端**：

```sh
$ grep -n "from '../gates" src/tools/status.ts
7:import { registry } from '../gates/index.ts'          # ← A 的宿主文件已 import 注册表

$ grep -n "\.ran\b" src/tools/status.ts
（无输出）                                              # ← A1 要补的正是这个消费点

$ grep -n "\.ran\b" src/tools/update-task.ts
（无输出）                                              # ← D1 要补的也是这个消费点
```

  ⇒ **`A1`（`/state` 增加判据视图）与 `D1`（把 ran/skipped 落盘）都是「`ran[]` 的消费者」，只是出口不同**（一个送 `/state` 给 client，一个写进卡点记录供离线度量）。两者会**同时改同一个"读数出口"概念**，且都依赖同一个前提：**`ran[]` 的形状要先定下来**。
- **任务书的猜测方向与本条不同**（据实说明）：任务书问「A1 的数据正是 D1 產出的，是否必须串行」。实测**不是**「A1 等 D1」—— 因为 `evaluate()` **今天就已经返回 `ran[]` 与 `counts`**（见 1.2 的 ②），`A1` 无需等 `D1` 就能拿到数据。**真正的问题是两者共用一条通路与一个形状决定**，并行改会各自假设一个 `ran[]` 的用法，在合流时撞车（t54 的形态：**inScope 各自成立、合起来漏**）。
- **必须怎么修**（三步）：
  1. `:76`/`:79` 的「依赖 无」改为**显式记下这条软依赖**，例如：
     `A` 依赖：无（但 **A1 与 D1 共用 `ran[]` 形状决策** ⇒ 二者必须先对齐 `ran[]` 的读出契约，再各自实现）
  2. 在第一批前**加一个 30 分钟的"接口对齐"步骤**（不是新任务，是开工前的合流点）：**先写下 `ran[]` → `/state` 与 `ran[]` → 卡点记录 两份读出的字段契约**，再放两条线并行。这是把 t54 的教训（inScope 漏文件）**提前到设计期**。
  3. 或者更简单、也更稳：**把 `A1` 与 `D1` 合并成一个任务**（同一人、同一 inScope），**顺带**产出两份出口 —— 避免两线各写一份形状。

---

### F2 — **BLOCKER**：`D1` 的措辞把「产生不了」与「没人消费」混为一谈，而两者的修法不同

- **文件:行**：`docs/REFACTOR-PLAN.md:184`（`D1`｜★ **让 `evaluate()` 的 `ran/skipped` 落盘**｜无 —— 这是 D 的关键一格）· `:23`（`F3`：「`ran: GateRunEntry[]` **产出即被丢弃**」）
- **问题**：`:23` 的 `F3` 说「产出即被丢弃」（**这句是对的**，我实测零消费），但 `:184` 的 `D1` 说「让 `evaluate()` 的 `ran/skipped` **落盘**」—— **`evaluate()` 早就落盘了（它返回了）**。真正的缺口在**下游没有消费者**，而且**现存那条落盘路径用的是错的数据源**：

```sh
$ sed -n '650p' src/gates/registry.ts
      const ran: GateRunEntry[] = []         # 每轮都填
$ grep -c "ran.push(" src/gates/registry.ts
9
$ sed -n '2933,2936p' src/tools/shared/entities.ts
export function gateIdFromMessage(message: string): string | undefined {
  const match = /\[([\w][\w.-]*)\]/u.exec(message)
  return match?.[1]                          # ★ 只取第一个
}
$ sed -n '1530,1534p' src/tools/update-task.ts
              auto: { tool:…, point:'completion', ...gateIdFromMessage(frictionMessage) … }
```
  ⇒ **卡点记录里的 `auto.gate` 是从拒绝消息正文正则抽的第一个 `[id]`，不是从 `ran[]` 取的。**
  ⇒ 后果可与 t17/t19 的读数对上：我实测「一条记录可归因多个 id」**有 12 条**（`f-0286` 命中 3 个），而**落盘端 `gateIdFromMessage` 只留第一个** ⇒ **语料里的多值信息是残缺的**，`completion.r5` 那类「非首位的判据」会被系统性漏计。
  ⇒ **`D1` 的真实价值远大于计划所述**：它不只是「让 9 条判据可判」，而是**换掉一个会用正则丢数据的落盘路径**（与刚修完的 `completion.r5` 数字盲区**同族**）。
- **必须怎么修**：
  1. `:184` 的 `D1` 改为准确措辞：**「把 `evaluate()` 已返回的 `ran[]`/`counts` 接到落盘路径上，替换现有『从拒绝消息正则抽第一个 `[id]`』的 `gateIdFromMessage` 路径」**。
  2. `:23` 的 `F3` 补一句「★ 且**现存落盘走的是 `gateIdFromMessage`，它只取第一个 `[id]`** —— 所以这条不只是『丢了一个读数』，而是**在落盘端用正则替代了权威数据源**」。
  3. **验收要能证伪**（照 t18 的做法）：`D1` 的验证里加一条**反向半边** —— 造一条**多判据同时开火**的记录（如 `[a.b] and [c.d]`），断言**两条都被记下**；再断言 `completion.r5` 这类**非首位** id 不再丢失。

---

### F3 — **HIGH**：`§7` 第一批列了 `D1`，但 `D2`/`D4` 无处安放，且未标「D 线整线顺序」

- **文件:行**：`docs/REFACTOR-PLAN.md:265-277`（`§7` 三批）· `:185`（`D2` 依赖 D1）· `:187`（`D4` 依赖 D1）
- **问题**：`§3 D` 明确 `D2` 与 `D4` 依赖 `D1`（`:185`/`:187`），但 `§7` 的**三批里一次都没出现 `D2`/`D4`**：

```
第一批：P0 · A · C 可行性方案 · D1
第二批：B1 样张 → B2–B6
第三批：E
（D2 · D4 从未出现）
```
  ⇒ 这是 **t58 的形态**：一条线被拆开，**后半截没有落点**。执行者读完 `§7` 会不知道 `D2/D4` 什么时候做、由谁做。
- **必须怎么修**：`§7` 补两行 ——
  - 第一批末或第二批：`D2 判开"很稳 vs 从不生效"（依赖 D1）`；
  - `D4 判据运行时优化机制（依赖 D1；且需 F1 的读数，建议排在 D2 之后）`。
  - 并给 `D` 线一句**整线顺序**：`D1 → (D2 ∥ D4)`，`D3` 独立（等你拍板）。

---

### F4 — **HIGH**：`F8` 的「21 处」实测为 **18 处**；`P0a` 引用的 `extractActivityPanelCss` **不存在**

- **文件:行**：`docs/REFACTOR-PLAN.md:28`（`F8`｜★ 测试绑定源文本：`workspace-activity.test.mjs` **21 处**）· `:96`（`P0a`：复用 `:1823-1829` 已有的 `extractActivityPanelCss`）
- **问题**：两处数字/引用都与盘上不符，而 `P0a` 的**整个做法建立在这个引用上**：

```sh
$ grep -cE "(readSource|readFile|readFileSync)\(" scripts/workspace-activity.test.mjs
18                                  # ★ 实测 18，不是 21
$ grep -rn "extractActivityPanelCss" src/ scripts/
（无输出）                          # ★ 这个名字在盘上【不存在】
$ sed -n '1823,1829p' scripts/workspace-activity.test.mjs
async function panelStylesheet() {  # ← 实际叫这个，且它是「从 bundle 里取样式表」，语义与「按语义查找」并不等同
```
  ⇒ `F8` 的行号（`:1231 :1266 :1281 :1743 :1801`）**5 处全部属实** ✅，问题只在**计数**与**那个可复用函数的引用**。
  ⇒ 这是 **t54 的形态**（inScope/依据写错一个数，执行者按错的数去改）。
- **必须怎么修**：
  1. `:28` 的「21 处」改为「**18 处**」（并附可复跑命令 `grep -cE "(readSource|readFile|readFileSync)\("`）。
  2. `:96` 的 `extractActivityPanelCss` 改为**盘上真实存在的**名字，或改为「**需新建**一个按语义查找的助手（现有 `panelStylesheet()` 是从 bundle 取样式文本，**不是**按语义查找）」。**若确实要新建**，`P0a` 的 inScope 必须**显式包含这个新文件**，否则又是 t54。
  3. `P0a` 的验收（`:96` 的「改前改后测试集合相等」）建议补一条：**记录改前 `grep -c` 的基数 = 18**，改后该数应下降且**通过的断言数不下降** —— 这样才能证伪「为了变绿而放宽断言」（`:99` 的硬纪律）。

---

### F5 — **HIGH**：`R5`（`ui-refactor` 同时做 `P0` 与 `E`）**已被 `§7` 的批次排序解决**，但计划把它留在"风险"里没结案 —— 反之真正没解决的是 `ui-refactor` 的**跨批占位**

- **文件:行**：`docs/REFACTOR-PLAN.md:247`（`R5`｜`ui-refactor` 同时做 P0 和 E，若并行会自己撞自己｜中（需串行））· `:228`/`:233`（`P0` 实现者与 `E` 实现者**都是** `ui-refactor`）· `:266`/`:273`（`P0` 在第一批、`E` 在第三批）
- **问题**：`R5` 担心的「并行撞车」**其实不会发生** —— `P0`（第一批）与 `E`（第三批）**在 `§7` 里本来就串行**。所以 `R5` 的措辞与 `§7` 不一致：一处说"需串行"（像是个待办），一处已经排成串行。**读者无法判断这条风险是"已解决"还是"待处理"。**
  ⇒ 而**真正没被处理的是另一件事**：`ui-refactor` 被**同时指定为第一批（`P0`）与第三批（`E`）的唯一实现者** ⇒ 这个成员会在**第一批与第三批各被占一次**，若调度按"一人一任务"派，`E` 期间该成员的空档与依赖（`E←B`）会互相等待。**计划没写 `E` 的备选实现者。**
- **必须怎么修**：
  1. `:247` 的 `R5` 状态改为**已由 `§7` 解决**（`P0` 批次 1、`E` 批次 3 ⇒ 天然串行），避免读者把它当未决项。
  2. 补一条**新的**风险并给处置：`ui-refactor` 跨第一/三批占位 ⇒ **指定 `E` 的备选实现者**（或明确 `E` 必须等该成员空闲，且在 `§7` 第三批注明）。
  3. `:233` 的 `E` 审查者 `rev-e` 与 `:228` 的 `rev-p0` 是不同人 ✅（这一点没问题，点名肯定）。

---

### F6 — **MEDIUM**：`E` 依赖写「`P0 + B`」，但 `E1` 的写域与 `P0b` 的写域相交（`ActivityPanel.module.css`）

- **文件:行**：`docs/REFACTOR-PLAN.md:80`（`E` 依赖 `P0 + B`）· `:97`（`P0b`：L0 纯删除 **6 个死 CSS 类**）· `:199`（`E1`：CSS 按组件切 **61KB**）
- **问题**：`P0b` 要删 `ActivityPanel.module.css` 里的 6 个死类，`E1` 要把同一个文件**按组件切分**。两者是**同一文件的先后改动**，虽然 `§7` 已把 `P0` 排在 `E` 之前（顺序正确 ✅），但**依赖表 `:80` 只写了 `P0 + B`，没写明「`E1` 必须在 `P0b` 的死类删除之后」** —— 若将来有人把 `P0b` 挪后（`P0b` 与 `P0a` 在计划里是同一个 `P0`，但**性质不同**：`P0a` 解耦测试、`P0b` 纯删除），`E1` 会把死类一起搬进去。
- **必须怎么修**：`:80` 的 `E` 依赖改为 **`P0（含 P0a 与 P0b）+ B`**，或显式加一句「`E1` 的 CSS 切分以**`P0b` 删净死类之后**的样式表为输入」。

---

### F7 — **MEDIUM**：`C` 与 `P0` 虽不同文件，但 `C3`（接 `poolForRescue`）与 `D1`（判据落盘）**读的是同一份卡点语料**，计划未标这条共享

- **文件:行**：`docs/REFACTOR-PLAN.md:170`（`C3`：把 `poolForRescue` 接上档位与出口）· `:27`（`F7`：`poolForRescue` 是唯一的卡点分诊判据点）· `:184`（`D1`）· `:79`（`D` 依赖「无」）
- **问题**：`C3` 与 `D1`/`D2` 都消费**卡点记录**（`C3` 用它决定救援档位，`D1/D2` 用它判判据效能）。两者**不改同一文件**（`C3` 在 `entities.ts` 附近、`D1` 在 `gates/` + 落盘点），所以不构成写域冲突 ✅；但它们**对同一份语料的字段有共同期待**（`C3` 要档位、`D1` 要把 `ran[]` 写进去）⇒ 若两线各自扩字段而不对齐，会重演 `entities.ts:2545` 那个「两份真相」的形状（该处注释逐字记着这件事）。
- **必须怎么修**：在 `§2 依赖关系` 加一条**共享资源说明**（不是硬依赖）：`C3 与 D1/D2 共同消费卡点语料 ⇒ 字段扩展需在开工前对齐（与 F1 的接口对齐同办）`。

---

## 3. 明确判「通过」的部分（不得因上面有 finding 而推翻）

1. **`E` ← `B` 必要且方向正确** ✅ —— B 与 E 同碰 `ActivityPanel.tsx`(37,836B) 与 `.module.css`(61,265B)；`§3 :202` 的「在 B 定稿前搬代码是白搬」**与我实测一致**。**这是全计划里最有价值的一条排序判断**，它直接避免了最大的一笔返工。
2. **`B` ← `P0` 必要** ✅ —— `workspace-activity.test.mjs` 确实是本仓 client 改动的假红来源（21/18 处读源文本，我实测 18 处绑定，5 个引用行号全部属实）。
3. **`B` ← `A` 必要** ✅ —— B2「实现判据管线图组件」画的正是 A1 要送的数据，无 A 则 B 无数据可画。
4. **`C` 与 `P0` 不撞** ✅ —— 虽同属 `scripts/`，但 `workspace-activity.test.mjs` **不引用** `friction-triage.mjs`/`judgement-triage.mjs`（`grep` 无输出）。**「同目录 ≠ 同文件」这一条计划判断正确**。
5. **`P0` 与 `A` 文件不重叠** ✅ —— `workspace-activity.test.mjs` **不引用** `status.ts`（`grep` 无输出）。
6. **`D3` 与 `D1` 确实可解耦** ✅ —— `admission.*` 三条**当前未注册**（我实跑活注册表：`registry.list().admission === []`，总数 14），故 `D3`「要不要接」是**拍板题**，不阻塞 `D1`。
7. **`F` 不是执行线** ✅ —— 它是「待裁定」清单，不占批次，无需排期。
8. **审查者与实现者不共用** ✅ —— `§4` 六条线各自配了独立审查者，且 `:235` 明写「不复用实现者脚本」，与本队已验证有效的做法一致。

---

## 4. 裁决

**verdict = `needs_revision`**

| id | severity | 文件:行 | 问题 |
|---|---|---|---|
| **F1** | **blocker** | `REFACTOR-PLAN.md:76,79,84,266` | `A` 与 `D1` 共用 `ran[]` 形状决策与同一条读数通路，被误判为无依赖并放进同一批 ⇒ 需接口对齐或合并任务 |
| **F2** | **blocker** | `REFACTOR-PLAN.md:184`（关联 `:23`） | `D1` 措辞「让 `evaluate()` 的 ran/skipped 落盘」与事实不符：`evaluate()` **早已返回** `ran[]`/`counts`；真实缺口是**下游改用 `gateIdFromMessage` 正则抽第一个 id** |
| **F3** | high | `REFACTOR-PLAN.md:265-277` | `§7` 三批里 `D2`/`D4` **从未出现**，而其依赖 `D1` 在第一批 ⇒ t58 形态（后半截无落点） |
| **F4** | high | `REFACTOR-PLAN.md:28,96` | `F8`「21 处」实测 **18 处**；`P0a` 引用的 `extractActivityPanelCss` 与 `:1823-1829` **在盘上不存在**（实际是 `panelStylesheet()`，语义不同） |
| **F5** | high | `REFACTOR-PLAN.md:247`（关联 `:228,233,266,273`） | `R5` 已被 `§7` 批次解决却仍挂在"风险"里未结案；真正未处理的是 `ui-refactor` 跨第一/三批占位、`E` 无备选实现者 |
| **F6** | medium | `REFACTOR-PLAN.md:80`（关联 `:97,199`） | `E` 依赖只写 `P0 + B`，未写明 `E1` 的 CSS 切分须以 `P0b` 删净死类之后为输入 |
| **F7** | medium | `REFACTOR-PLAN.md:79`（关联 `:170,27`） | `C3` 与 `D1/D2` 共同消费卡点语料，未标为共享资源 ⇒ 字段扩展需对齐 |

**放行条件**：
1. **F1、F2 必修** —— 它们决定第一批能不能真的并行，以及 `D1` 做出来是不是**换掉了错误的落盘路径**。
2. **F3、F4 必修** —— F3 会让执行者不知道 `D2/D4` 何时做；F4 让 `P0a` 按一个不存在的函数去改。
3. F5~F7 建议同批修（都很小）。
4. 修完重跑本文 §1.2 的 `grep`/`node` 命令自证读数（我预期 `ran` 消费仍为 0 直到 `D1` 落地）。

**为什么不是 `reject`**：DAG 的**骨架正确**（`P0` 前置、`B←P0+A`、`E` 最后且必要），四条"不撞"的判断经我逐条回源**全部成立**（`C`↔`P0`、`P0`↔`A` 均无文件交集），`E←B` 这条关键排序**判断正确且有实据**。缺陷集中在**第一批的 `A`/`D1` 一格的措辞与依赖标注**，以及若干计数/引用，**定点可修**。

**为什么不是 `pass`**：F1/F2 落在第一批——**计划自己说这是"立刻并行开工"的那一批**。t58/t54/t70 三次事故的教训都是"拆法在派出去之前没人审过"；`A` 与 `D1` 这一格正是**派出去之前就该对齐、而计划没对齐**的地方。F2 更实质：它让 `D1` 的**目标**看起来是"补一个能力"，而真实目标是"**换掉一条会用正则丢数据的落盘路径**"——**目标写小了，验收就会写松**（多值 `[id]` 与 `completion.r5` 那类非首位判据会继续被漏计）。

---

*本审查只覆盖「依赖与顺序」。载荷预算、符号纪律、C 线架构、D 线判据形态等面**刻意未审**，留给其他审查者。*