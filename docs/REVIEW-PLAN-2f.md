# 审查 · round 6（冻结前最后一轮）—— t44 四条修复 + §7.5 口径案例 + 冻结判定（reviewer-glm / glm-5.3-flash）

> **命名**：沿用 2b–2e。本文件是 round-6，冻结判定轮。
> **审查对象**：`docs/REFACTOR-PLAN.md` 的 t44 修订（提交 `cd28dbd`，+131/−18 —— ★ 自报 +101/−18，实际 131/18，见争议节）与新增 §7.5（`:1104-1136`）。含同日 `cf2ccb9`（t43 处置）的连带核对。
> **方法**：逐条回源、自写探针、先确认口径。**只读**；唯一产出本文件。
> **工具通道**：全部调用一次成功，零失败。

---

## 0. 冻结判定（最重要的结论）

**★ 不能按现状冻结 —— 差一段就能冻。**

四条修复里 **三条（UF-2 / UF-3 / PF-1 / PF-2）全部落地且读数我全部复现**；但 **UF-1 的处置只写进了提交说明（`cf2ccb9`），没有写进文档正文** —— §3-U 的表（`:708`）仍印着已被 t43 证伪的「判据层几乎为零 / 3 处项目名」。这是本轮**唯一**一处会让下游**按错前提执行**的缺陷（U 线开工者会带着"底座已干净"的前提出发）。修一行即可冻结（FF-1）。

---

## 1. 四条修复逐条回源

### UF-2（判据三口径）—— ✅ 落地，引用属实
- `docs/GATE-EFFICACY.md:21` 逐字含「**盘上 17 个模块，注册表里 14 条，语料里开火 9 条**」—— 计划的三口径表是**引用既有权威口径**，非自造 ✅。
- 载荷表拆为两列（①盘上 / ②已注册），`admission` 行 **①3 / ②0** —— 与源码一致（`ALL_GATES` 无 admission，`index.ts:65` 注释自认"t5 只加位置，不加判据"）✅。用数约定（算任务判到几条用②、清点用①）明确 ✅。
- 差集断言复现：②−③=5 条（coverage/convergence/worktree/liveness/stall）未逐个核开火数（③=9 来自 GATE-EFFICACY 的语料统计，不在本轮源码可测范围——**不判，来源已链**）。

### UF-3（U2 非"纯搬运"）—— ✅ 落地，构建链证据全对
实测：`tsconfig.json:13` `"rootDir": "src"`、`:21` `include:["src"]`；`package.json:86` build 链含 `tsdown && git-artifacts.mjs --write`；`tsdown.config.ts:62` `outDir:'lib'`；`git ls-files lib/ | wc -l` ⇒ **173** ✅（四个读数全部逐字复现）。
M2–M4 同步改写 + E1 的对照（"E1 才是字面纯搬运"）在盘（`:126-140`）✅。

### PF-1（快环两条硬约束）—— ✅ 落地，可判性达标
§7（`:1065-1080`）两条约束在场；**约束一确有机械判据**且可静态断言：两条不变量（快环产物不得写 `verdict`/`blockers`/`gate` 字段；`poolForRescue`/派工判据不得读快环产物）都是**可以对源码静态断言**的禁止性检查（与计划里 D 线反向半边、B0.1 对拍臂同一性质）。★ 静态断言**未排期、未指派检查脚本**（FF-3 low）——但不阻塞冻结：它是 P1 实现的一部分，判据已可写进契约。
约束二附了口径 A/B 命令与点名名单（见 PF-2）✅。

### PF-2（15/17 口径）—— ✅ 落地，两个口径我独立复现，B⊂A 成立
```
口径 A（walk(|readdirSync）⇒ 17
口径 B（只 readdirSync）   ⇒ 15
A∩B = 6 个共有文件；A−B = 恰好 2 个：gate-contract-verify-command / gate-kind-requirements
```
与计划/契约说的差集**逐字一致** ✅；t43 点名的 3 条（shared-artifact-writes / tautology-sweep / producer-consumer）我核了都在 A 的 17 个里 ⇒ **名单完整** ✅。★ 补充一个计划没写的精确化：`walk(` 单独口径有 **8** 个文件（含 6 个 A∩B），计划只给了 A/B 两档 —— 不构成缺陷（A 是采纳口径），仅备忘。

---

## 2. §7.5 四个口径案例核对

| # | 案例 | 我的复核 | 判定 |
|---|---|---|---|
| 1 | 88 vs 130 | `ls scripts/gate-*.test.mjs \| wc -l` ⇒ **88**；`ls scripts/*.test.mjs \| wc -l` ⇒ **130** | ✅ 双数复现 |
| 2 | 902 vs 904 | 我的探针：含/不含 `export default` 前缀两种正则**都得 904**；且 `src/**/*.{ts,tsx}` 内 `export default` = **0 处**、`export {}` = **0 处** —— **没找到任何能产出 902 的口径** | ⚠️ 未复现（FF-2） |
| 3 | 15 vs 17 | §1 PF-2 已核 | ✅ |
| 4 | 561/911/1027 | t42/t44 已核（911=唯一名、1027=声明处、561=旧 `grep -w` 口径已撤回）；我重算 904=911−7 闭合在档 | ✅ |

**FF-2（low）**：`REFACTOR-PLAN.md:1112`（§7.5 表第 2 行）。**问题**：案例 2 的 902/904 口径描述（"不含/含 export default 与 export {}"）在两轮独立探针下都复现不出 902 —— `export default` 与 `export {}` 在 `src/` 内均为 0 处，加减它们不可能改变计数。**这正踩在 §7.5 自己立的判据 2 上（"报数必须带口径与命令"）**：方法论节的示例自身没有命令。
**必须怎么修**：给该行补上队长的原始口径命令（若能找到）；找不到就把该行改为「904（t42，命令在档）vs 902（口径未找到，待补）」——方法论节里**不能留一个自己都没口径的数**，否则它示范的是反面。

---

## 3. 连带核对（cf2ccb9，t43 处置）

- VF-1（D4 删除）：✅ 落地（`:261,263,1198`，理由在档）。
- UF-4（R/V 验收列）：✅ 落地（`:771-786`），R4 如实标"需先造基线、留给你"——符合 R4 裁定 ✅。
- TF-1（T4 加宽）：✅ 落地（`:1163-1176`），`members.ts:147` 逐字引用正确，反向臂含 cancelled ✅。
- **UF-1（判据层耦合普查）：❌ 未落地进正文** —— census（5 行 / 2/17 文件：`task-atomicity.ts:212,331-332` + `build-artifact-scope.ts:105-106`）**只存在于提交说明里**，文档 §3-U 表（`:708`）原句未动。我核实了那三处代码**确实存在**（`ROOT_LEVEL_DIRECTORIES` / lib→src 归并 / `SOURCE_ROOT='src'`/`ARTIFACT_ROOT='lib'`，均属**有意耦合**、量小）—— 队长的 commit 描述准确，但**文档没有拿到它**。

**FF-1（medium，冻结阻塞）**：`REFACTOR-PLAN.md:708`。
**问题**：§3-U 表 ① 行仍写「判据层 几乎为零 / 3 处项目名」——该断言已被 t43（UF-1）证伪、处置也已在 `cf2ccb9` 完成，但**只进了 commit message 没进文档**。下游 U 线开工者只读文档 ⇒ 带着"底座已干净"的前提出发 = **按错前提执行**，且这正是本队 T2 缺陷的文档版（"记录在不在盘上的地方"）。
**必须怎么修**：① 行改为（一条即可）：「判据层：**有意**代码级耦合 **5 行 / 2 个文件**（`task-atomicity.ts:212` 顶层目录集合、`:331-332` lib/scripts 归并；`build-artifact-scope.ts:105-106` `SOURCE_ROOT/ARTIFACT_ROOT`）；注释级项目提及 43 处；字面项目名 0 处。可注入化 ~5 行，属架构变更，**已 PARKED 给用户**（cf2ccb9）。」同时 §3-U 的「⇒ 底座（①）已经是干净的」一句改为「底座（①）基本干净（残留 5 行有意耦合，见上）」。

---

## 4. 争议节

| 争议点 | 我的判定 | 反证/依据 |
|---|---|---|
| t44 自报 diff「+101/−18」 | 实际 **+131/−18**（`git show cd28dbd --shortstat`）。方向没错但自报数与落盘不符 —— 与 t41 的同类瑕疵同族（那次 +118 vs +141）。**记账问题，low，不阻塞**；§7.5 的判据 2（报数带口径）应当也适用于自报 diff（附基线 commit） | `git show cd28dbd -- docs/REFACTOR-PLAN.md --shortstat` |
| §7.5 表「谁发现的」列把 15/17 记为 t44 发现 | 17 首次见于 t43（探针 `walk(\|readdirSync`），t44 是**拆出 B=15 并定 B⊂A** 的人。功劳归属表述略偏，但两轮都是队长线内工作，**不构成 finding**，备忘即可 | t43 报告 §4、t44 报告"先取 t43 的显式口径" |
| 902 的存在性 | 我**没找到**能产出 902 的口径（≠ 断言它不存在）—— 按 §7.5 自己的规则记"待补口径"并降为 low（FF-2），不改数 | §2 探针读数 |

---

## 5. Finding 汇总

| id | severity | 位置 | 问题 | 必须怎么修 |
|---|---|---|---|---|
| **FF-1** | **medium（冻结阻塞）** | `REFACTOR-PLAN.md:708-712`（§3-U 表） | UF-1 的处置只进了 commit message（cf2ccb9），正文仍印被证伪的「几乎为零 / 3 处」 | 按 §3 FF-1 的改法补一行普查读数；改完此条即可冻结 |
| **FF-2** | low | `:1112`（§7.5 表第 2 行） | 902/904 案例自身缺口径命令，两轮探针均复现不出 902（`export default`/`export {}` 在 src 内均为 0 处） | 补原始命令，或改标"902 口径未找到，待补"——方法论节不许留无口径的数 |
| **FF-3** | low | `:1069-1072`（PF-1 约束一） | 静态断言的两条不变量表述到位，但**未排期、未指派检查脚本位置** | 在 P1 的契约里落一条验收：「快环产物写入面 grep 检查 = 0 命中」即可，无需新立任务 |

**通过项（附覆盖面）**：UF-2 三口径引用逐字核实（GATE-EFFICACY:21）+ admission ①3/②0 与源码一致；UF-3 四个构建链读数全复现（rootDir/include/build 链/outDir/173）；PF-1 两条约束在场且约束一可静态断言；PF-2 口径 A=17、B=15、A−B 恰为点名的 2 个文件、t43 名单完整；§7.5 案例 1/3/4 准确；cf2ccb9 的 VF-1/UF-4/TF-1 三条处置全部落地且读数正确。

---

## 6. 覆盖面（可复跑命令，全部实跑于 HEAD `cd28dbd`）

| # | 命令 | 读数 |
|---|---|---|
| 1 | `sed -n '21p' docs/GATE-EFFICACY.md` | 「盘上 17 模块 / 注册 14 / 开火 9」逐字在 |
| 2 | `grep -nE '"rootDir"\|"include"' tsconfig.json; grep -n '"build"' package.json; grep -n outDir tsdown.config.ts; git ls-files lib/ \| wc -l` | :13/:21 / :86 / :62 / **173** |
| 3 | `ls scripts/gate-*.test.mjs \| xargs grep -lE "readdirSync" \| wc -l` | **15**（口径 B） |
| 4 | `ls scripts/gate-*.test.mjs \| xargs grep -lE "walk\(\|readdirSync" \| wc -l` | **17**（口径 A） |
| 5 | `comm -23 <(A) <(B)`（两口径文件列表差集） | 恰 2 个：contract-verify-command / kind-requirements |
| 6 | `ls scripts/gate-*.test.mjs \| wc -l; ls scripts/*.test.mjs \| wc -l` | **88 / 130** |
| 7 | 自写 python 重算导出唯一名（含/不含 default 两种正则） | 均 **904**；`grep -rn "export default\|export {}" src` ⇒ **0 处** ⇒ FF-2 |
| 8 | `sed -n '210,213p;331,333p' src/gates/contract/task-atomicity.ts; sed -n '104,106p' src/gates/contract/build-artifact-scope.ts` | t43 census 的 3 处代码级耦合**确实存在** |
| 9 | `grep -n "task-atomicity.ts:212\|census\|几乎为零" docs/REFACTOR-PLAN.md` | 正文无 census；`:708` 仍是旧句 ⇒ FF-1 |
| 10 | `git show cd28dbd --shortstat -- docs/REFACTOR-PLAN.md` | **+131/−18**（自报 +101/−18）|
| 11 | `sed -n '771,786p;1163,1176p;261,263p' docs/REFACTOR-PLAN.md` | UF-4/TF-1/VF-1 处置均在盘 |

---

## 7. 冻结判定（复述）

**条件通过**：修掉 FF-1（§3-U 表一行 + 一句结论）即可冻结派工；FF-2/FF-3 不阻塞，可随首个相关任务捎带。除此之外，我没有找到其它会让下游按错前提执行的缺陷：载荷表、批次依赖、U2/M2–M4 性质标注、快环约束、T1–T4 修法与反向臂、§7.5 方法论本身，全部与盘上事实一致。

---

*本审查只读。所有命令实跑于 HEAD `cd28dbd`。审查者：reviewer-glm（wb/glm-5.3-flash）。*
