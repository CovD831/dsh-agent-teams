# 需求（本仓当前认领的设计原则与裁定）

> **本文件是什么**:本仓**已裁定**的需求、设计原则、与被推翻的旧判断。
> ★ 它不是计划文档（那些在 `docs/*-PLAN.md` 与各专题文档里）；
> 它是**一份可对齐的清单** —— 供 `workbench-align` 双向比对。
>
> **怎么写**:见本仓 `AGENTS.md` 的「需求捕获」一节（判据与格式）。
> ★ 每条都必须能回答:**它是否还在生效**、**谁在实现它**、**怎么验证**。

---

## 0. 判据（什么样的东西该进这里）

```
✅ 该进:  用户明确裁定的设计原则 · 被推翻的旧判断 · 需求变更
★ 而每条必须带三格:
   ① 【判据】—— 为什么它是需求（用户原话或可复跑的读数）
   ② 【现状】—— 已实现 / 未实现 / 已推翻
   ③ 【证据】—— 文件路径或命令
❌ 不该进:一次性的排期 · 尚未裁定的提案（那些在 DECISIONS-PENDING.md）
```

---

## 1. ★★★ 模块边界（用户硬约束，逐字）

> 「**我是不允许模块之间互相侵入的。** 所以，需要暴露给其他模块使用的功能，
>  都必须做一个**接口**接出来，供其他模块调用，**不能做模块之间的互相侵入**。」

**判据**:用户原话 · **现状**:✅ 已落地为四条规则 · **证据**:`docs/MODULE-REPARTITION.md` §1.4

```
A. 别人 → evolution：★ 只许 import src/evolution/（一个接口面）
B. evolution → 别人：★ 只读。要影响别人 ⇒ 发信号给宿主
C. 采集点：★ 别的模块不许主动调用 —— 宿主在【既有汇合点】调用
D. ★★★ 裁决器（gates / 验证命令 / 阈值）【AI 只读】，由机械臂钉住
```

★ **并已实测**:`src/evaluator/` 三文件**剥注释后零 import**（独立于 evolution/gates）。

---

## 2. ★★★ 三模块划分（用户裁定：实施不是模块）

> 「**我觉得不一定一定要有这个实施模块。** 因为我们这个插件本身就是一个任务的实施，
>  它可以走我们**本身的 Agent Team 派发任务**之类的。」
> 「我们目前做的这个，**可能不能被称为一个"自净化模块"**，因为它不包含
>  **"改完之后产生收益"这样一个完整的闭环**。目前做的可能只是一个**信息采集和初步处理的模块**。」

**判据**:用户原话 + 六个导出全为采集侧的实测 · **现状**:✅ · **证据**:`docs/MODULE-REPARTITION.md`

| 模块 | 职责 | 现状 |
|---|---|---|
| **① 采集与处理** | 采集 · 该不该采 · 分类 ⇒ 产出**结论** | ✅ `src/evolution/` |
| **② 实施** | ★ **不存在** —— `Proposal` 转成 `create_task` 契约 | ✅ 一个转换函数 |
| **③ 评估器** | 衡量**收益**（前后两个窗口）| ✅ `src/evaluator/` |

★ **而 ③ 独立的理由（技术性的，不是组织性的）:**
```
★ 单次判据回答「这次改动【合规】吗」—— 当下、机械
★★ 而收益回答「这次改动【有收益】吗」—— ★ 需要【前后两个窗口】
⇒ 单次判据【结构上】回答不了趋势
```

---

## 3. ★★★ 评估器待在循环外（安全边界）

**判据**:STOP（microsoft）的两文件设计 + 用户裁定 · **现状**:✅ · **证据**:`src/evolution/types.ts:105`

```ts
LOOP_B_SUBJECTS = ['collection-gates', 'verify-command', 'confidence-threshold']
canLoopAAutoChange ⇒ 对这三者返回 false
★★ 而 src/evolution/ 里【没有任何函数能改判据】—— 刻意不提供
```
★ **理由（STOP 的结构）:**
```
tasks/maxcut/utility.py         ← 给被进化的程序看的（n_tests=3）
tasks/maxcut/secret_utility.py  ← ★ 真正裁决，被进化对象【看不到、改不到】
⇒ ★★ "一条只禁止调用的注释会腐烂，没有那个函数则不会"
```

---

## 4. ★★★ 「两件不同的事不许同形」（本会话 9 次事故的共同根因）

**判据**:★ 本会话**实测 9 次**同族事故 · **现状**:⚠️ **已实现但未成文** · **证据**:`docs/DECISIONS-PENDING.md` §3③

**事故清单（每条都有据）:**
```
① t79/t80「尝试被拦下」被写成「越界」
② #2 一条被写成两条
③「四处登记」实际五处
④「第二份完整写入」实际是残片
⑤ 验收写 test:gates 而那条命令【不含】被测文件
⑥「全跳过」被画成 ✓
⑦ 读了上游的排除列表，当成我们的
⑧ 引的锚点字符串属于另两个测试
⑨ 写「六处精确匹配」，实测 12 处
```

**⇒ 需求:每一层读数都必须有【第三态】，且它不许退化成"否"或"低分"：**
```
判据      ok / blocked / unmeasured          ✅ src/gates/registry.ts
飞轮      promote / observe / archive / unmeasured   ✅ src/confidence.ts
采集      true / false / undefined           ✅ src/evolution/collect.ts
分流      hard / soft / contract / none / unmeasured  ✅ src/evolution/types.ts
收益      improved / unchanged / unmeasured   ✅ src/evaluator/effect.ts
评估      effective / ineffective / unmeasured ⚠️ 待接
```

★★ **而两处已实测的推论:**
```
★ 评估器:verdict unmeasured ⇒ probability 【必为 undefined】
  ——"一个数字挂在弃权上会被读成低把握的判断"（t92 实测，40 臂）
★ 候选:无基线（before===0）与「降了但幅度小」【不同形】（t92 三条反向半边）
```

---

## 5. ★★ 采集：该不该采（第七个插入点）

**判据**:用户批准 + AutoLibra 的 redundancy/coverage · **现状**:✅ · **证据**:`src/gates/collection/`

```
INSERTION_POINTS 七个 · 共 21 条判据 · 3 个生产调用点
  （entities.ts:4136 · create-task.ts:616 · tools.ts:2124）

四条采集判据:dedupe · cooldown · attributable · immunity
★★ 而它防的第一件事不是"采错的"，而是"采重复的":
   MEASURED:372 条里唯一 (component,kind) 只有 54 对，
   dispatch·unwired 【161 条、持续 8 天】而无人发现
```

---

## 6. ★★★ 收益衡量：结构性判据，无阈值

**判据**:用户裁定 + 本仓实测（54 个桶里 49 个只有 1 条）· **现状**:✅ · **证据**:`src/evaluator/effect.ts`

```
before.count === 0         ⇒ unmeasured（无基线）
after.count <  before.count ⇒ improved（★ 无阈值:降了就是降了）
after.count >= before.count ⇒ unchanged
★ 而【幅度】作读数报出，★ 不进 verdict
```
★★ **依据**:MemOS 源码实测 —— `minEpisodesForInduction` 已被下调到 1，
注释反复记录「**真实使用中阈值永不触发**」⇒ **阈值该是提示开关，不是执行开关。**

★ **而「最小观察期」那个常量叫 `GUESSED_MIN_OBSERVATION_MS`** ——
**名字带 `GUESSED`、注释声明无依据、且可覆盖** ⇒
**一个猜测与一个测量在代码里不许同形。**

---

## 7. ★★★ 实施顺序：最小 MVP + 每步两条硬门槛

**判据**:用户裁定（m0069 / m0078 原话）· **现状**:⚠️ **已裁定，执行未开始** · **证据**:`docs/MVP-FUSION-PLAN.md`

```
「整体的实施顺序必须按照【最小 MVP 的思想】去做，以我们当前的状态为极限。
  每次做完改动，都需要满足以下要求：
  1. 【证明收益】要么通过前后对比实验来证明有收益，要么通过真实的测试来证明
     前后确实有所改善；或者如果某些机制提升了某种性能，那性能的对比都要出来。
  2. 【保证运行】这一切的前提都是能保证这个插件正常运行，能正常帮我完成任务。」
```

**⇒ 需求（三条，缺一条就不算完成）:**
```
① 每一步只接【一个】已有能力：不新增工具、不新增角色、不改数据模型的语义
   （新增字段可以，但必须是【正交】的 —— 例如 parentTaskId 不进 unsatisfiedDependencies）
② 每一步都必须给出【改前 / 改后】两组命令打印的数字，且改前读数必须在改产品【之前】就采到
   ⇒ 先写读数脚本，再改产品
③ 任何一步若读数说"没收益"，就地停止，不继续往下做（不为了"计划完整"而继续）
```

★ **而"证伪比证明便宜"的具体落法**:每条断言都要有**反向半边**（见 §9），
每条"改夹具让它变绿"的改动都必须能在拿掉修复后**重新红在同一条**上 ——
否则那只是把红灯涂绿，不是修好。

★★ **一条已实测的教训（本仓实测）**:
```
一个关于夹具的结论，被一次清理竞态（finally 里的 ENOTEMPTY）伪装了出来 ——
`scripts/lifecycle-verify.mjs` 的真正红是 `dispatch.plan-reviewed` 拒绝，
而外层的 rm 先抛，把那条报错盖住了 ⇒ ★ 先修"让读数可读"，再修"读数说的事"
```

---

## 8. ★★ 判据要「一致性的三处登记」

**判据**:加一个插入点时实测踩到 `contract.task-atomicity` · **现状**:✅ · **证据**:`docs/PARALLELISM-BOTTLENECK.md`

```
加一个位置要改【五处】，而不是一处:
  ① registry.ts 的 INSERTION_POINTS
  ② types.ts 的 GATE_INSERTION_POINTS 镜像
  ③ GATE_DIRS（verify-gate-tristate，★ 已改为从 INSERTION_POINTS 派生）
  ④ 装配清单 + 注释槽位
  ⑤ ★ NEW_POSITION_GATES（gate-index-assembly）
★ 而 ③ 已改成派生 ⇒ 下次不会再漏那一处
```

---

## 9. ★★ 断言必须双向（反向半边）

**判据**:本会话反复受益 · **现状**:✅ 已成习惯 · **证据**:各夹具

```
★ 每条断言都要能在【反向】下变红 —— 否则它没有判别力
★ 而"两侧都测过"与"我以为两侧都测过"不同形

已实测的例子:
  · t92 把 stripLineAnchors 换成恒等 ⇒ 4/6 红（而没有它，"我保持了强度"无从证明）
  · t93 把三段拆开跑 12 次并发 ⇒ unique 1/12（串行化后 12/12）
  · t95 stash 全部修复 ⇒ 5 条臂里 4 条红
  · t76 的"集合差"取代"计数比"（未提交文件会让计数虚高）
```

★ **而净变化的判定一律用【失败文件集合】，不靠计数** ——
**本会话实测同树两次跑得 `1429/21` 与 `1427/23`（计数会抖动）。**

---

## 10. ★★★ 宿主版本闸门：要么声明支持并真跑通，要么整层消失 —— 不许"靠豁免过闸门"

> 「定位根因后**移植上游 0.1.24/0.1.25 的 Harness 0.2.1 适配**」
> —— ★ 用户在本次会话的两个候选处置里选了"移植"，而不是"加版本豁免"

**判据**:本会话实测。宿主自动升到 `0.2.1-rc.2` 后，本仓 `0.1.23` 的
21 个 peer 全部停在 `0.2.0-rc.2` ⇒ compose 阶段被判 `incompatible`，
**整个 profile bundle 被跳过**：16 个 `agent_teams_*` 工具与
`agent-teams:usage` systemPrompt section 一次性全没，而对话里**没有任何报错**
（用户侧只看到"Agent Teams 怎么异常了"）。
**现状**:✅ 已实现（声明 `0.2.1-rc.2` + 移植激活适配）
**证据**:`docs/harness-0.2.1-rc.2/README.md`；复验命令（隔离 `DSH_HOME`，
profile 的 `dsh.profile.bundles` 里放本插件 + `link:` 到本仓）：
`dsh --profile <隔离profile> --dump-config` 从「stderr 一行 skipping」变成
「stderr 0 行 + 树里出现 `- id: agent-teams`」；
真宿主 `/plugins/dsh-agent-teams/degraded` ⇒ `200 {"state":"healthy","degraded":[]}`。

★★ **被推翻的旧判断**：此前认为"缺的只是 `compatibility.json` 一行豁免"。
**推翻理由**：实测 `allow-version` 生成的豁免确实能让插件过闸门并被 eval，
但 `0.2.1` 同时把成员创建契约从 `startContinuable`/`start` 换成了
`startActivation`，且 spawn provider 的能力位去掉了 `persona`/`toolFilter`
⇒ 过了闸门也会在 `spawnMember` 的能力位检查处抛错。
**"过闸门"与"能跑"是两件事**，豁免只解决前者。

★★★ **由此产生的设计原则（本会话新裁定，待用户确认）**：
```
支持矩阵里声明一个宿主版本，唯一有效的证据是【在那个版本上真跑通】。
  · `compatibility.json` 的 supportedHosts 是【声明】，不是【证据】
  · `doctor.mjs` 只校验仓库侧的依赖自洽（0.2.1 适配后它报 295 个身份全过），
    它【不能】证明运行中的宿主能加载本插件
  · ⇒ 判据必须是宿主侧的读数：entry 树里有这一条 + degraded 路由回 healthy
     + 需要鉴权的路由回 401 而不是 404（404 = 压根没注册）
★ 反例成本：只加豁免而不移植，会把"整层消失"换成"启动成功后一 spawn 就抛"，
  后者更难查（错误发生在用户第一次建队时，而不是启动时）
```

## 11. ★★★ 「自迭代」由两个方向组成，而两者不是一回事

> 「1. 自进化：在运行的过程中如果遇到问题，它可以自己做处理、修补和更新。
>  2. 深度挖掘：我给出几个方向之后，它能对这几个方向进行深挖，
>     看看自己在这几个方向还能做到什么样的提升。」
> —— 用户原话（m00001，逐字）

**判据**:用户原话逐字；且它是一条**从没有被写下来过**的需求 ——
本文件此前 `grep -n "自迭代\|自进化\|深挖\|深度挖掘" docs/REQUIREMENTS.md` **零命中**，
而它是这个插件最初要做的事（用户 m00001 逐字："我做这个插件最开始的想法就是想去做一个'自迭代'"）。

**现状**:⚠️ 部分 —— 两个方向的成熟度**差得很远**，且断点各不相同：

| 方向 | 现状 | 断在哪（可复跑读数） |
|---|---|---|
| **自进化** | ⚠️ 部分 | 采集只写 `rejection`（`src/evolution/collect.ts:462` 硬编码）⇒ success/insight 通道焊死；`cooldown:unmeasured` **29/29**；`collected` 键落盘 **0/29**；`Proposal` 产生方 **0**；计划审查链每一环都有代码而每一环都没有生产调用方 |
| **深度挖掘** | ⚠️ 部分（2026-10-20 修正，原记 ⬜）| 完整勘探循环仍未实现；★ 但"**方向 → 今天的缺陷密度**"这一格本轮已可给：`.agent-teams/frictions/` **393 条**按 `index.component` 分桶实测 `dispatch 170 / completion 164 / contract 24 / …`，落在 N0 的 `directions` 输出里（零新步骤）⇒ 用户给出方向后可当场决定先挖哪条 |

**证据**:`docs/SELF-ITERATION-PLAN.md`（计划与改前读数）；
`.agent-teams/evolution/signals.jsonl`（39 行，kind `{rejection:36, insight:2, success:1}`，
`collected` 键 0 条 —— ★ 其中 10 条是 t88 旧形状，结构上就没有该格，
故"修好写方后 `keyPresent` 的上限是 **29** 不是 39"，详见计划 §N1.1）；
复跑 `node scripts/evolution-readout.mjs`（N0 落地后）。

★★ **两个方向的顺序是裁定，不是偏好**：深挖的产出是**计划**，而计划的正确性由
N1 的台账与 N3 的审查链判定 ⇒ **先有数据与审查，再有深挖**。反过来会造出
"能生成很多改进建议、而每条建议都无法判定有没有用"的机器 —— 那正是 §7 硬门槛②要挡的形态。

★ 但要区分**两件事**（2026-10-20 修正）：完整的勘探循环要等 N1–N3；
而"**人给出方向 → 立刻看到这个方向今天的缺陷密度与信号量**"**今天就能做**，
它只需要一次提问加一次只读统计，不需要那条链。⇒ 把这两件事混成一句
"深挖要等",会让一件本来今天就能做的事被推后好几轮。

★★★ **一条从 m00001 直接推出的硬约束**：自迭代**不是**"它自己决定改自己"。
自进化的每一步都必须留下**改前/改后两组可复跑读数**（§7 硬门槛②），
深挖必须以**人给出的方向**为输入 —— 用户 m00001 逐字："我给出几个方向之后"。

---

*本文件是【需求清单】，不是计划。未裁定的提案在 `docs/DECISIONS-PENDING.md`。*

## 12. ★★★ 「计划的审查循环什么时候可以结束」是一条需求，而它此前没进台账

> 「加进去，然后计划是否能开始跑也是希望有一个门禁把关，
>  其实就是计划的审查循环是否可以结束的问题。」
> —— 用户原话（m01373，逐字）

**判据**:用户原话逐字；且 `grep -n "计划\|审查循环" docs/REQUIREMENTS.md` 在本次追加前
**零命中** —— 这条需求此前只活在 `docs/SELF-ITERATION-PLAN.md` 里，没有进需求台账。
★ 这正是本仓 `AGENTS.md`「需求捕获」纪律要挡的那一格：**需求活在计划文档里，
于是计划一改口径、需求就跟着漂**。

**现状**:⬜ 未实现（设计已在计划文档里改了四版，仍未实施）

★★ 用户问的是**终止性**（这个循环会不会自己停），不是**准入性**（这一次能不能放行）。
这两件事的差别是可复跑的：准入性是一次函数求值；终止性要三样东西 ——
**(i) 一个单调不减的度量**、**(ii) 一个有界的上界且触顶后真的停**、
**(iii) 一个存在于循环执行者手里的终止动作**。

**证据**（改前实测，2026-10-20）：
- (i) `planReviewRounds` 全仓**零命中** —— 度量根本不存在；
  且四条变更路径里只有 `edit_plan` 能计（`create_task`/`amend_task` 无 phase 闸、不计数，
  `approval:'automatic'` 完全不经过 `approveStagedTeam`）。
- (ii) `approveStagedTeam`（`src/tools.ts:2143-2180`）**不读轮次、不读 escalated** ——
  实测把 staged 团队写成 `escalated:true, planReviewRounds:4`（max=3）后
  `agent_teams_approve` 仍返回 `{"status":"running"}`。
- (iii) `halt` / `discard` / `continue` **三个终止动作全在 Web 路由里，工具面一个都没有**
  （`src/index.ts:461`、`:537`、`:542`；16 个 `agent_teams_*` 工具零命中）
  ⇒ **模型自己无法结束这个循环**。

★ 设计见 `docs/SELF-ITERATION-PLAN.md` 的 N5 / N5.11–N5.17（含对抗性审查的七条修正）。
★ 其中一条会改变行为：**分档 + `reviewed` 戳那一层被砍掉** ——
`tierOf` 的判据方向是反的（数"声明了几个 `src/` 文件"，实测
`['src/tools.ts','src/types.ts']` ⇒ `large` 而 `['src/tools.ts','lib/tools.js','lib/types/tools.d.ts']` ⇒ `small`），
它奖励少写 `inScope`、惩罚写清，且能被 `amend_task` 缩域绕过。
⇒ 保留的是"**让循环状态可读 + 让计数不可绕 + 让触顶真的停且可解**"这三件，
它们才直接回答用户这一问。

## 13. ★★ 契约在建任务那一刻就该自查：声明了 `src/` 就必须配对 `lib/`

> 「若门要求"changedPaths ⊆ inScope"而契约又强制 lockstep 产物，那么**任何改 src/ 的实现任务都需要把对应 lib/ 产物写进 inScope** —— 建议在 create_task 侧把这条变成默认生成，否则会一直重复。」
> —— 2026-10-20，t11 成员在其交付报告里提出（本次会话采纳）

**判据**:本轮**三个**任务（t5、t11、t8/t6/t9）全部栽在同一件事上：实现完成、验收全绿，
被 `implementation cannot complete: <artifact> is undeclared` 挡在门外。而本仓
`scripts/git-artifacts.mjs` 在 build 陈旧时失败、`pnpm build` 又是改 `src/` 后的硬要求
⇒ **任何碰 `src/` 的任务必然产出 `lib/` 改动**，这不是偶然，是结构性的。
代价每次都是"一个成员的完整实现 + 一次契约修订 + 一次重来"。

**现状**:⚠️ 部分 —— 判据**本体**早已存在且正确，缺的是"它在建任务那一刻说话"。
- ✅ `src/gates/contract/build-artifact-scope.ts:317` `return blocked(blockers)`，措辞逐字：
  `inScope declares source path(s) ... but declares no build artifact under "lib/"...`
- ✅ 它的文件头 `:14` 早就把这个失效形态写下来了：「契约在【建】的那一刻就已经写错了」
- ✅ `src/tools/create-task.ts:821` `await rejectOnContractGates(ctx, {...}, 'create_task', ...)` —— **create_task 路径真的会跑它**
- ❌ **`edit_plan` 的 `add_task` 路径完全不跑任何契约门**：`src/tools.ts:2049` 硬编码 `kind: 'work'`，
  而 `StagedPlanMutation`（`src/tools/shared/entities.ts:240`）结构上没有 `kind`/`inScope`/`acceptance` 格
  ⇒ 本轮 t11 的契约是我用 `create_task` 建的，却**没有**经过判据自查，
  而 t9 要修的正是这条路的另一半

**证据**:
```bash
# 判据存在且在 create_task 上生效
grep -n "rejectOnContractGates" src/tools/create-task.ts        # :821
# plan 路线不跑它
grep -c "rejectOnContractGates" src/tools.ts                    # 0
# 触发条件：声明了 src/ 但没声明 lib/
node scripts/plan-review-check.mjs --help                       # （相邻的 CLI，同一族判据）
```

★★ 两条纪律：
1. **在"建"那一刻说，不在"完成"那一刻说** —— 同一个事实，建任务时说是一次提醒，
   完成时说是一次损失（`build-artifact-scope.ts:18-20` 逐字）。
2. **"自动补齐"与"提示"是两件事**，不要顺手把 `lib/` 塞进 `inScope` ——
   那会让 `inScope` 从"这次要改什么"退化成"这次可能会碰到什么"，而它现在是
   `changedPaths ⊆ inScope` 那条判据的唯一真值来源。

## 14. ★★★ `shape` 是声明，所以必须有一条判据问「声明被执行了吗」

> 「你这个建团 是用早期插件的形态建的 而不是后来我规定的形态
>   而且关于这个问题 其实我已经做过修复了 但显然并没有起效」
> —— 用户 2026-10-20（`docs/DEFECT-TEAM-SHAPE-FALLBACK.md` 逐字）

**判据**:上一轮形态验证自己写下的结论（`docs/SHAPE-VERIFICATION-PROBE-1.md` §4 逐字）：
「**`shape` 是一条声明，而"声明有没有被执行"今天没有读数。** 一个 `shape: 'dispatch'`
的队如果成员全都自己干活，**没有任何一条臂会红**。」
★ 那正是本条存在的理由：**乙方案让"派临时工"成为可能，而"有没有真的派"仍然只能靠人看会话文件。**

**现状**:✅ 已实现（2026-10-20）—— 判据 `runtime.shape-execution` + 三格 `status` 出口。

```
声明在哪   team.json 的 shape（乙方案，d52c9c4）
执行证据   宿主写在父会话里的 subagent/catalog 事件（每派一个 worker 多一条）
           ★ 不是"当前活着的子代理"—— 后者漏掉"派过又结束了"，而那正是 dispatch 的常态
读数出口   agent_teams_status 的 team_shape / shape_execution / shape_violations
判据       runtime.shape-execution（只报告，不拒绝 —— runtime 位置纪律，契约 §5）
```

★★ **三态，且三者两两不同形**（这是本条的要害，不是形式）：
```
measured        —— 读了（violations 空 = 真的没有违规）
unmeasured      —— 派工读不到（★ 绝不并进"零违规"）
not-applicable  —— flat / 缺声明（存量队：这一格对它根本没有"该不该派"可言）
```
★ 判定只认两格同时成立：**干完过活**（名下有终态任务）**且一个 worker 都没派**。
只看"没派"会把还没开工的成员判成违规，而那会立刻教会人忽略这条判据。

**证据**:
```bash
node scripts/gate-shape-execution.test.mjs      # 13 臂全绿（含一条真实路径臂）
# 真实读数（dispatch-shape-probe 队）：
#   ledger  executedTasks=1  dispatched=1（worker 48403c6f）⇒ violations=[]
#   inspector executedTasks=0 ⇒ 不计（没机会派工）
```
9 次定向突变，8 次打红（第 9 次暴露了一条只断言总数、不断言"非 catalog 事件不算数"的
弱臂 —— 已补强后打红）。

★★ 两条纪律：
1. **"声明"与"执行"是两句话**，不许合成一句 —— 合成之后"声明了、也照做了"与
   "声明了、全员自己干"在读数上同形，而它们要求的动作相反。
2. **`shape` 缺席（存量队）绝不默认成 `dispatch`** —— 那会让 8 个存量队里实测 5 个
   早期形态的队**看起来都符合规定**，一次静默的假绿。

## 15. ★★ 「这个产物进主干了吗」必须在**树被回收之后**仍然答得出

> 「有 78 个 `deliverableCommit`，而 `merge-base --is-ancestor` 只认出 4 个 ——
>   另外 42 个是**手工按文件落盘**的，内容早就在主干里。」
> —— 2026-10-20，本会话实测（可复跑，见 `docs/WORKTREE-BASE-DEFECT.md`）

**判据**:上一轮清点把这条记为「`deliverableCommit` 仍无读者」。★ **那句话不准确**：
`scheduler.ts` 的 `collectUpstreamBaselines` 与 `worktree.ts` 的 `resolveWorktreeBaseline`
都在读它。真正的缺口是**另一个问句**：这个队的产物有多少进了主干。
而实测证明它**必须**被回答 —— 只看 `--is-ancestor` 会把 42/78 报成"没合流"。

**现状**:✅ 已实现（2026-10-20）—— `absorbPlanOf` 抽出 + `status.deliverable_landing` 出口。

**证据**:
```bash
node --test scripts/gate-deliverable-landing.test.mjs   # 8 臂全绿
node --input-type=module -e "
import { deliverableLandingFor } from './lib/worktree.js'
import { readTeamSync } from './lib/state.js'
const t = readTeamSync('.agent-teams','agent-teams-refactor')
console.log(deliverableLandingFor({repo:process.cwd(),tasks:t.tasks}))"
# agent-teams-hardening 17/31 · agent-teams-refactor 23/34
# mutation-quality 1/8 · overnight-registration-hardening 5/5  ⇒ 合计 46/78
```

★★ 三条纪律：

1. **判据只有一份**。`judgeWorktreeReclaimable` **调** `absorbPlanOf`，不是复制它。
   两份吸收判据必然分叉，而分叉之后「回收时算已吸收、交付时说没合流」会成为一个
   新的、更难查的不一致。★ 这一条由臂 4 钉住（对同一棵树对拍两条路径）。

2. **四态的依据必须可读**。`ancestor` / `content` / `files` / `contained` 的
   **复核动作不同**（查 merge / 查 cherry-pick / 逐文件比对 / 查历史可达性），
   所以 `how` 随读数一起交出，不许合流成一个布尔。

3. **`unreadable` 不许并进 `not-landed`**。前者去查"这个 commit 怎么没了"，
   后者去合流 —— 补救动作相反。★★ 而**主干读不到**时整份 `unmeasured`，
   绝不落成"零条未合流"（那会让"一次比较都没发生"读成"全部已合流"）。

★ 剩下那一半**本轮没做**：调度器仍把上游 commit 当基线传下去，而**不检查它进没进主干**。
见 `docs/WORKTREE-BASE-DEFECT.md` 处置方向第 3 条。

## 16. ★★ 一个戳必须能核对它审过什么，否则它只是一句自称

> 「一份『五问齐全、why 写得很漂亮、`at` 指向一年前』的戳能**一路通过**。
>   门问的是「五问都答了吗」，而**不是**「这份记录有可能是真的吗」。」
> —— `src/gates/dispatch/plan-reviewed.ts` 的文件头（2026-10-19）

**判据**:2026-10-20 的实测把「90 个不可能戳」这件事的**性质**说清了：

```
90 个不可能戳 · 全部同时早于它们自己的 createdAt
其中 85 个在 agent-teams-refactor，at - createdAt 恒为 -365 天 ±0.4 天
★★ 而它们的 why 是逐条真写的（83/85 条互不相同）
```
⇒ **审查是真的，只有那个数字错了**（一次批量回填把年份写错了一年）。
★★ 而这件事暴露了更根本的一格：**改一个 `at` 就能让它"合法"，而改数字的成本是零**
⇒ `at` 本身不是一个能承重的证据。

更狠的读数：`node scripts/reviewed-stamp-census.mjs --active` ⇒ **118 个戳，0 个 bound**。
即"**没有任何一份戳能核对它审过什么**"。

**现状**:✅ 已实现前一阶段（2026-10-20）—— 戳在落盘时绑定它审过的字节。

| 落点 | 状态 |
|---|---|
| `update_task` 落判决时写 `reviewedArtifacts` | ✅ 早已有（t97） |
| **`create_task` 落戳时写 `reviewedArtifacts`** | ✅ **2026-10-20 补上** |
| 普查多一维 `bound` / `unbound` | ✅ `scripts/reviewed-stamp-census.mjs` |
| 臂 8 从"零个不可能戳"改成"戳必须可核" | ✅ 且现在钉的是**逐条清单**，不是计数 |

**证据**:
```bash
node scripts/reviewed-stamp-census.mjs --active   # bound: 0 / unbound: 118
node --test scripts/gate-plan-reviewed-stamp.test.mjs   # 8 臂
```

★★ 三条纪律：

1. **`at` 不是证据**。一个可以自由改写的数字，不能用来回答"这份记录有可能是真的吗"。
   能承重的是"它绑过哪些字节的摘要"—— 那个改起来要**同时**改字节。

2. **历史那 118 份是已知的、不会自愈的**。它们被逐条钉在
   `gate-plan-reviewed-stamp.test.mjs` 的 `KNOWN_UNBOUND_STAMPS` 里
   ⇒ **只许变短**。★ 想把它清空之前先回答：那 118 份怎么变成可核的？
   改 `at` 不是答案。

3. **`unmeasured` 与 `unbound` 都是"判不了"，不是"没问题"**。普查里
   `unreadable`（at 不是数）与 `unbound`（没有绑定）**各占一格**，
   谁都不并进 `plausible`。

★ 剩下那一半：**历史 118 份戳仍然无绑定**。它们不可能被事后绑定
（字节早已变过），所以正确的处置是让它们**显式地**读成 `unbound`
—— 那已经做到了，而且由臂 8 逐条钉住。

## 17. ★★ 派活那一刻必须知道「上游产物进主干了吗」

> 「调度器把上游 commit 当基线传下去，而**从不问它进没进主干**。」
> —— 本会话对 `docs/WORKTREE-BASE-DEFECT.md` 处置方向第 3 条的核实

**判据**:实测（本仓 78 个 `deliverableCommit`）：`--is-ancestor` 只认出 4 个，
而四态口径认出 46 个 ⇒ 若按前者报"没合流"，那是 **42 份误报**。
★ 而调度器此前**一个都不问**：下游可能在"上游的活还没合流"的世界上干活，
而没有任何读数说这件事。

**现状**:✅ 已实现（2026-10-20）—— `BaselineResolution.upstream[].landed` 三态 + `describeBaseline` 说出来。

```
baseline is upstream deliverable t3@6bc6c936e8c9
  — NOT yet in the trunk: t3@6bc6c936e8c9 — its committed work has not been
    absorbed by the trunk under any of the four forms, so the trunk alone
    does not yet contain it
```

**证据**:`node --test scripts/gate-deliverable-landing.test.mjs`（10 臂，含派活那一半）

★★ 三条纪律：

1. **只报告、不改基线**。把"还没合流"的上游排除会让下游在**更旧**的代码上干活
   —— 方向反了。`usable` 照旧收它，只是把事实说出来。

2. **`not-committed` 与 `not-landed` 不同形**。前者是"上游没产出"（等它做完），
   后者是"产出了、还没合流"（去合流）。合并会让补救动作指向错的方向。

3. **`diverged` 与 `not-landed` 也不同形**。前者是"从这条基线**到达不了**那个上游"
   （历史分叉），后者是"**主干**上没有那份工作"。★ 合成一句会让读的人去查历史，
   而真正该做的是去合流。

★ 剩下那一半：**基线仍然不会因为"没合流"而改变**。那是另一条改动
（要不要在派活前强制合流 / 拒绝派发），本轮**没做** —— 而它现在**有读数可依**了。
