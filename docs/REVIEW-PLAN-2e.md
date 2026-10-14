# 审查 · round 5（补审）—— U/R/V/P 四条线 + T1–T4 工装缺陷（reviewer-glm / glm-5.3-flash）

> **命名**：沿用 2b/2c/2d —— 本文件是 round-5（补审计划从未被审查的章节，兑现 R8）。
> **审查对象**：`docs/REFACTOR-PLAN.md` v4（HEAD `35e9b0a`）的 §3-U（`:672-716`）、§3-R（`:718-740`）、§3-V（`:742-756`）、§3-P 相关行（`:102-103, 995-996`）、§8 T1–T4（`:1006-1054`）+ `docs/EFFICIENCY-PROBE.md`。
> **方法**：逐条回源、自己写读取器；先确认口径再复算。**只读**：未改被审文件与 src/、scripts/、lib/。
> **工具通道**：全部调用一次成功，零失败。

---

## 0. 结论一句话

U/R/V/P 的**多数事实引用成立**（baseline 机制、R3 读数、Qoder 参照、P3↔backtest 冲突、T4 缺陷方向全对），但存在 **2 条 medium 事实性问题**（判据层并非零耦合；"17 条判据"口径与同文件 14 冲突）、**2 条 medium 结构性缺口**（R/V 全线无验收列；V4 元判据被声明未被操作化）、**1 条 medium 语义风险**（P1/P2 缺"快环不进裁决"硬约束）。无 blocker/high。

---

## 1. U 线

### 1.1 事实依据回源

| 计划声称 | 我的实测 | 判定 |
|---|---|---|
| 「判据层 17 条判据」 | `ALL_GATES`（`src/gates/index.ts:305-398`，剥注释）实数 **14** 个；盘上 gate 模块（`export const id`）= **17**（含 3 条未接线的 `admission/*`） | ⚠️ 数对但口径未标 —— 与同文件 §6b.1 F-4 自记的「`ALL_GATES` ⇒ 14」**同文档两口径并存**（UF-2） |
| 「判据源码里只有 3 处提到项目名」 | 字面项目名口径（`agent-teams\|dsh\|nanmicoder`）⇒ **0**；注释口径（`本仓\|这个仓\|本插件`）⇒ **43 处、分布在 14 个文件**。两个口径都复现不出 3 | ❌ 未复现（UF-1） |
| 「判据层几乎为零（项目耦合）」 | **反例一处，代码级**：`src/gates/contract/task-atomicity.ts:210-213` `ROOT_LEVEL_DIRECTORIES = new Set(['src','lib','scripts','docs','skills','assets','release-notes','node_modules','compatibility.json'])` —— **在代码里**硬编码本仓顶层布局（注释自认"本仓库的顶层布局"），`:332` 还有 `scripts→src` 归并规则 | ❌ 「几乎为零」不成立，至少有一条**有意但真实**的代码级耦合（UF-1） |
| 「88 个夹具」 | `ls scripts/gate-*.test.mjs \| wc -l` ⇒ **88**（t42 G-2 已定口径） | ✅ |
| 「34 个硬编码本仓路径」 | 探针：字面绝对路径 ⇒ 0；`join(root…)` ⇒ 54 文件；`walk(\|readdirSync)` ⇒ 17。**34 未在任何探针下出现**（延续 t41/t42 的"待补口径"，本条不新增 finding） | 未复现 |

### 1.2 「只分层不抽取」是否可执行

**判定：可执行，不是"什么也没做"。** U1（三层地图+每项耦合读数）是可判真假的读数任务；U3 是真实的机制改造（见 1.3）；U2 是唯一软的一步——但它**不是零**：让三层在路径上可分辨是 U3 与未来抽取的前置（没有可分辨的边界，"通用化"无从谈起）。**但见 UF-3：U2 的"纯搬运"标签不实。**

### 1.3 U3「机制已存在，只是没通用化」—— ✅ 成立

回源：`scripts/fixtures/baseline-known-failures.json` 的 `_comment`/`_why`/`_how` 逐字支持计划的引用（三态问句、白名单 vs 清单的区分、"不许把新失败写进清单"）；**且消费端已接线**：`src/quality-gates.ts:1458` 读该文件、`src/gates/completion/backtest.ts:597,756` 消费 `knownBaselineFailures`。⇒ U3 的表述（"设计已对，缺的是提升为底座能力"）**与盘上事实一致**。✅

---

## 2. R 线

| 条 | 可判真假？ | 依据 |
|---|---|---|
| R1 救援机制 | ✅ 可判 | `poolForRescue`（`entities.ts:2868`）唯一分诊点已核（t42）；"接上档位与出口"可判（接线前后 `escalate` 的 6 条去向可数） |
| R2 三类识别规则 | ✅ 可判 | "三类不同形"是形状断言，可用同形对照表验收（本仓已有此格式） |
| R3 智能上报 | ✅ 可判 | 读数已核：`self 378 (98.44%) / escalate 6`（`GATE-EFFICACY-CONTEXT.md:59-60`） |
| **R4 上报自进化** | ❌ **不可判** | 「让同类以后不用再上报」无基线、无度量、无对照臂——**愿望，不是验收**（UF-4） |
| R5 沉淀为机械判据 | ⚠️ 半可判 | "161 条空拒绝→0 复发"案例已核实存在（`GATE-EFFICACY-CONTEXT.md:142`），但"以后每条卡点都沉淀为机械判据"仍无验收 |

**QODER-LESSONS §8 参照**：✅ 适用。`docs/QODER-LESSONS.md:348` 起确为「自进化 / 上报路径——三维切开与机器不能自授权写盘」专项，且 §8.3 明确论证了该闸门在本插件"部分不适用+一条真缺口"——**不是生搬硬套**，计划引用它是恰当的设计输入。`humanTurns` 硬保证逐字在 `:363`。

---

## 3. V 线

**V3（漂移防护↔速度权衡）**：判定——**作为计划变更规则可操作**（"任何更严格的建议必须同时给出速度代价"是一条可执行的否决规则），但它**没有被机械化为任何检查**（无脚本、无模板字段）。降为"原则声明+一条软纪律"尚可接受，前提是 VF-1 被修——否则 V 线整体只是三行引文。

**V4（最小 MVP 元判据）**：★ **发现计划的自述与事实不符**（VF-1，medium）：
- t27 **确实用过**该判据（`REVIEW-PLAN-3.md` §12 逐条"不做它会怎样"）✅；
- 但 t27 的四条结论——**D4 建议删、C1/C2 建议降级、P0b 建议并进 B、E 建议推迟**——在 v4 里**一条都没落实**：`D4` 仍在 §3-D（`:238`）且排在第二批（`:994`）；P0b 仍独立存在（`:645`）；计划无任何"争议节"记录为何不采纳。
- ⇒ **"所有新增步骤都要过这一关"是声明，不是机制**：v4 新增的 U/R/V/P1–P5/T4 各步，没有任何一条附"不做它会怎样"的作答。

---

## 4. P 线

**P1/P2/P4/P5「不改判定语义」**：⚠️ **声明缺少使其为真的硬约束**（PF-1，medium）。
- P1 快环=少跑夹具 ⇒ **判定面变小**。"不改语义"仅在快环结果**永不进入终态裁决/派工判据**时成立——计划没有写这条。若无人值守循环里用快环结果决定派工（V 线正在推动这种用法！），语义就变了。
- P2 按 inScope 选夹具有**真实的漏报面**：`gate-shared-artifact-writes`、`gate-tautology-sweep`、`gate-producer-consumer` 这类**全仓扫描夹具**管的恰恰是"inScope 之外"的东西（跨任务共享产物、恒真断言、无消费导出）——它们最不该被按 inScope 跳过。计划未列这条豁免。
- P4（成本可见）/P5（缓存）确实不改语义 ✅——缓存需注意"读数过期"要与 `dispatch.worktree` 的 base 版本机制对齐，计划未提（low，随 PF-1 一并修）。

**P3 ↔ backtest 冲突描述**：✅ **准确**。回源：`backtest.ts` 的 `_why` 逐字「基线【几乎从不全绿】…要求的那件事在当前工作方式下【不可满足】」；消费端 `quality-gates.ts:1458` 与计划描述的"pin 那一半"一致。U3=「P3 的正名」的改写也与 baseline 文件的 `_how` 三态吻合。✅

**效率探测读数回源**：
| 读数 | 实测 | 判定 |
|---|---|---|
| `verify:gates` 39.8s | 未复跑（成本高、且受并发 build 抖动，TEST-TRIAGE 已记录 22–39s 波动带） | 不判，来源单一 |
| 最贵 3 夹具 55.3s（22.9/16.9/15.5） | `gate-producer-consumer` 复测 **21.7s**（并发抖动内一致） | ✅ 方向与量级成立 |
| 15 个扫全仓夹具 | `grep -lE "walk(\|readdirSync"` ⇒ **17** 文件 | ⚠️ 未复现 15（口径未定义；PF-2 low） |

---

## 5. T1–T4 工装缺陷

| # | 修法方向可行？ | 反向半边？ | 我的实测 |
|---|---|---|---|
| T1（sourceTaskId 挂错） | ✅ 可行（闭环自动派生处改） | ❌ 计划未给（TF-2） | — |
| T2（输入不过桥） | ⚠️ 方向对但**最难**（git 追踪与 worktree 的接口缺口，无现成挂点） | ❌ 未给 | 计划自己标"根因未修"，诚实 |
| T3（行号锚定） | ✅ 可行、成本极低（三位成员独立同提） | ❌ 未给（易补：锚文本被删时脚本必须红） | — |
| T4（remove_member requeue） | ✅ **方向正确，且我实测确认缺陷仍在、比计划写的更宽**：`src/tools/members.ts:146-148` 只跳过 `status === 'completed'` —— **`cancelled`/`failed` 的任务照样被 requeue**。计划写"跳过 completed/cancelled/failed 终态"，代码现状只差一半 | ✅ 可构造：3 completed + 1 in_progress + 1 cancelled ⇒ 移除后只应 requeue 1 个（TF-1 给了精确臂） | `sed -n '145,150p' src/tools/members.ts` |

---

## 6. Finding 汇总

| id | severity | 位置 | 问题 | 必须怎么修 |
|---|---|---|---|---|
| **UF-1** | **medium** | `REFACTOR-PLAN.md:685`（U 表①行） | 「判据层几乎零耦合」不成立：`task-atomicity.ts:210-213` 在**代码**里硬编码本仓顶层目录集合（`ROOT_LEVEL_DIRECTORIES`）+ `:332` 的 `scripts→src` 归并规则；且「3 处提到项目名」在字面口径（0）与注释口径（43）下均不复现 | 该行改为：「判据层有一条**已知的有意**代码级耦合（task-atomicity 的顶层目录集合，注释自认"本仓库的顶层布局"）+ 注释级提及 43 处；字面项目名 0 处」——耦合必须**如实计价**，否则 U2/U3 的"底座干净"结论被高估 |
| **UF-2** | **medium** | `:685` vs `:873`（6b.1 F-4） | 同一文档两口径并存：「17 条判据」（盘上模块数，含 3 条未接线 admission）与「`ALL_GATES` ⇒ 14」（注册数），U 表未标口径 | U 表①行标注「17=盘上模块（14 已注册 + 3 admission 未接线待 D3）」 |
| **UF-3** | **medium** | `:697`（U2 行） | 「纯搬运」不实：移动 `src/gates/**` 或改模块路径会改 import ⇒ 触发构建链，与风险 R3（N 收拢触发构建链=高）同类，U 线未记此风险 | U2 的判据列删去「纯搬运」，改为「搬运+构建链影响面声明（若只动 `scripts/fixtures/**` 则为零）」；或显式把 U2 限定为 scripts 侧 |
| **UF-4** | **high→medium** | `:718-740`（R 表）、`:742-756`（V 表） | **R1–R5 与 V1–V4 全部没有验收列**——本计划自己的纪律（各步验收可判真假、恒真验收=无验收，t27 专答 2）没有适用于这两条线；R4「自进化」无可证伪半边 | 给 R/V 每步补验收列；R4 至少给出可测定义：「同类卡点（按归因键分组）的重复上报率，修复前后对照，下降 X% ⇒ 过」——键、分母、对照臂三件套缺一不可 |
| **VF-1** | **medium** | `:749`（V4 行） | 「t27 用的正是此判据」属实，但 t27 的四条结论（D4 删/C 降级/P0b 并进 B/E 推迟）**一条未落实**，且 v4 新增步骤无一附"不做它会怎样"的作答 ⇒ 元判据被声明未被操作化 | 二选一：①采纳 t27 四条（至少 D4 从第二批拿掉）；②立"争议节"逐条写不采纳理由。并给 v4 新增步骤补 MVP 作答 |
| **PF-1** | **medium** | `:995`（P 线批次行）+ `EFFICIENCY-PROBE.md §5` | 「快环不改判定语义」缺硬约束：少跑夹具=判定面变小，且 V 线（无人值守）正在制造"用快环结果做派工决策"的诱惑；P2 的 inScope 选择会漏掉全仓扫描夹具管的跨任务问题 | P1/P2 补两条机械判据：①「快环结果不得进入任何终态裁决/派工判据」（可在闭环处静态断言）；②全仓扫描夹具（producer-consumer/shared-artifact-writes/tautology-sweep 等）**豁免** inScope 裁剪，快环也必跑 |
| **TF-1** | **medium** | `:1028-1031`（T4 修法方向） | 方向可行且缺陷实测仍在，但代码现状比计划描述**更宽**：`members.ts:147` 只跳 `completed`，`cancelled`/`failed` 仍被 requeue（它们的 attempt 已失效，requeue 后成员拿到的是必失败的历史任务） | 修法方向写实为「跳过全部终态（completed/cancelled/failed）」；反向半边臂改为「3 completed + 1 in_progress + 1 cancelled ⇒ 移除后只 requeue 那 1 个」——cancelled 那条必须不被 requeue，这是现计划的臂测不出来的 |
| **PF-2** | low | `EFFICIENCY-PROBE.md:83` | 「15 个扫全仓夹具」复现得 17（`walk(\|readdirSync` 口径），口径未定义 | 补口径与复跑命令（与 88 个夹具同一做法） |
| **TF-2** | low | `:1044-1048`（T1/T3 修法） | 反向半边缺失（T4 有、T1/T2/T3 无）——T3 易补：锚文本被删除/改名时定位脚本必须红 | 三条各补一句反向臂；T2 的反向臂=「引用未提交输入的任务，在旧 base 上必须拿到显式错误而非空输入」 |

**通过项（附覆盖面）**：U3 机制已存在且设计对 ✅（baseline 文件 `_comment/_why/_how` + `quality-gates.ts:1458` + `backtest.ts:597,756` 双端核实）；P3↔backtest 冲突描述准确 ✅；R3 读数 ✅（378/6, `:59-60`）；R1 锚点 ✅；Qoder §8 参照适用 ✅（`:348-404` 主题与论证均匹配，非生搬）；T4 反向半边可构造 ✅；88 夹具 ✅；T4 缺陷代码级确认 ✅。

---

## 7. 覆盖面（可复跑命令）

| # | 命令 | 读数 |
|---|---|---|
| 1 | `grep -nE "^\s+[a-zA-Z]+,?$" <(sed -n '305,399p' src/gates/index.ts)`（剥注释） | ALL_GATES = 14 |
| 2 | `grep -rn "export const id" src/gates/**/ *.ts`（排除 registry） | 17 个 gate 模块 |
| 3 | `grep -rn "本仓\|这个仓\|本插件" src/gates/ --include=*.ts \| wc -l` | 43 |
| 4 | `sed -n '210,213p' src/gates/contract/task-atomicity.ts` | ROOT_LEVEL_DIRECTORIES 硬编码集合 |
| 5 | `ls scripts/gate-*.test.mjs \| wc -l` | 88 |
| 6 | `ls scripts/gate-*.test.mjs \| xargs grep -lE "walk(\|readdirSync" \| wc -l` | 17 |
| 7 | `time node --test scripts/gate-producer-consumer.test.mjs` | 21.7s（声明 22.9s，抖动带内） |
| 8 | `sed -n '145,150p' src/tools/members.ts` | 只跳 `completed` ⇒ TF-1 |
| 9 | `grep -n "knownBaselineFailures" src/quality-gates.ts src/gates/completion/backtest.ts` | 1458 / 597 / 756 ⇒ U3 双端接线 |
| 10 | `python3 -c`（team.json t27 output） | t27 四条建议原文 ⇒ VF-1 |
| 11 | `grep -n "D4" docs/REFACTOR-PLAN.md` | `:238,:994` 仍在 ⇒ VF-1 |
| 12 | `sed -n '348,364p' docs/QODER-LESSONS.md` | §8 主题匹配 ⇒ R 线参照成立 |

---

*本审查只读。所有命令实跑于 HEAD `35e9b0a`。审查者：reviewer-glm（wb/glm-5.3-flash）。*
