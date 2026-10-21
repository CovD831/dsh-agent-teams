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
> ★ 2026-10-21 更正：旧读数写「21 条判据」，实测 **22** —— 漏的是 `completion.r5`
> （它的 id 以**数字**结尾，而旧数法用的正则是 `[a-z-]+\.[a-z-]+`）。
> ★ 这条更正现在有判据守着（`scripts/requirements-claims.mjs` 的 R5.1 / 探针 `gate-count-is-22`）：
> 判据增删改了而这张表没跟 ⇒ 对齐命令当场红。

INSERTION_POINTS 七个 · 共 22 条判据 · 3 个生产调用点
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

**现状**:⚠️ **部分**（★ 2026-10-21 更正：原写「⬜ 未实现」是**过期读数**）

> ★★ **这是一条追记，不是改写历史。** 下面「证据（改前实测）」那一整段**原样保留** ——
>   它记录的是 2026-10-20 04:10 那一刻的盘面。而 `7309ed1`（同日 07:51）把 (i) 与 (ii)
>   都实现了，**§12 写成两小时后**。⇒ 一个读数过期之后，它比没有那个读数更坏：
>   它会让下一个人不再去查这一格。这正是本文件 §23 存在的理由。

**当前三件事的实际状态**（可复跑，见 `scripts/requirements-claims.mjs` 的 R12.1–R12.3）：

```
(i)   ✅ 已实现  `planReviewRounds` 在 edit_plan 的唯一锁内 +1（口径：per 调用；per operation 会打爆上限）
(ii)  ✅ 已实现  approve 读 `rounds >= PLAN_REVIEW_MAX_ROUNDS` 并拒绝；describePlanLoop 五态可读
(iii) ❌ **未实现**  halt / discard 仍然只在 Web 路由 —— 17 个工具零命中
```

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

## 18. ★★ 「这个位置接上了」必须是**三件事**都说得出读数，不是一句断言

> 「修 2026-10-20 审计查出的六条短板：①admission『已注册零求值点』的假话 …」
> —— 用户在 2026-10-20 对本轮目标的原话（六条里第一条）
>
> Node 属性：「★ 不许为了让文档自洽而去删判据、也不许顺手接一个假求值点。」
> —— 用户对本条的处置裁定（admission 走「**改文档说真话**」，**不**接线）

**判据**:两处文档（`src/gates/index.ts` / `src/types.ts`）此前对 `admission` 这一格的
说法**都是反的**：一处写「于是"写了但没接线"这句话在本仓**再也没有实例**了」，
另一处写「**空段**：三条判据存在但**未注册**」。而实测是 **注册了 3 条、生产零求值点**。
★ 它的坏法不是"写错了一个词"，而是**让下一个人不再去查这一格** —— 本仓反复记账的形态：
一个读数过期之后，它比没有那个读数更坏。

**现状**:⚠️ **已知缺口**（★ 文档已按用户裁定改成真话；**接线本身没做**）
- ✅ 已注册 3 条：`admission.absorb` / `.checkpoint` / `.convene`（都在 `ALL_GATES` 里）
- ❌ **生产零求值点**：全仓没有任何 `evaluate('admission', …)` 调用
- ❌ **输入面零产出**：四格在 `src/gates/admission/` 之外**没有任何生产者**
- ⬜ 缺的入口 = 「**自动成团**」，而它**还没实现**（`convene.ts` 文件头记着用户原话：
  「产物非空 + 无未审改动 + 无待确认问题 ⇒ 自动成团（用户明确不需要点头）」）

⇒ ★★ 所以「接上了」这三个字在本仓的**完整口径**是：**① 注册 ② 有生产求值点 ③ 输入面真有产出**。
`admission` 只满足 ①。★ 只报 ① 会读成"这一格已经有人看着了"；只报 ② 会读成"没写过判据" ——
两者补救动作不同（接线 vs 删判据），所以**必须各自一个读数**。

**证据**:
```bash
# ① 已注册（3 条）
node --input-type=module -e "import {registry} from './lib/gates/index.js'; console.log(registry.count('admission'))"

# ② 生产零求值点（空输出，exit 1）
grep -rn "evaluate('admission'" src/ --include=*.ts

# ③ 四格输入在生产零产出（四行全是 0）
for k in producedDocuments documentsRead observedDocumentChanged currentRevisions; do
  printf "%-26s " "$k"
  grep -rn "$k" src/ --include=*.ts | grep -v "src/gates/admission/" | wc -l
done
```

★★ 三条纪律：

1. **不删判据**。三条判据本体是对的（`convene.ts` 的四条条件写得比"空段"这个词细得多），
   缺的是求值点与输入面。删掉它们会把"一个未实现的入口"伪装成"一个被裁掉的需求"。

2. **不接假求值点**。★ 在四格输入零产出的现在接线，三条判据只会恒 `unmeasured` ——
   那会把"没测到"变成"测过了"的另一种写法，与这条需求要修的病同形。

3. **下一格检查的人该看的是"三件事里有几件"**，不是"位置名字在不在 `ALL_GATES` 里"。
   ★ 这条口径对**其余六个位置**同样适用 —— 本轮只核了 `admission`。

---

## 19. ★★ `pnpm build` 在 worktree 里**不可复现** —— 而它出现在**每一个** implementation 任务的 verify 里

> 「`lib/client.js` 那 484 行**全部是构建路径污染**。功能等价，但**产物不可复现** ——
>   同一份 `src/` 在两台机器 / 两个 worktree 上构建出的 `lib/client.js` 字节不同。」
> —— integrator 在 t3 的开工报告里实测报出（2026-10-20）

**判据**:`tsdown.config.ts` 的 CSS Modules 配置逐字是 `cssModules: { pattern: '[hash]_[local]' }`，
而那个 `hash` 由 **`filename`（绝对路径）** 决定 ⇒ **同一个 worktree 路径不同，CSS 类名 radix 全变**。

实测（两条，方向相反，缺一不可）：
```
在 worktree 里 build：git diff lib/client.js | grep -c 'task-shortfall-repair-t3'  ⇒ 8
                      归一化（抹掉绝对根路径 + CSS hash）后逐字节比                    ⇒ IDENTICAL
在【主树】里 build：  git diff --numstat lib/client.js                              ⇒ 空（0 行）
                      归一化后                                                       ⇒ IDENTICAL
```
⇒ ★★ **主树可复现，worktree 不可复现。** 这不是缺陷，是 worktree 的固有属性。

**现状**:⚠️ 已知、未修。本轮**刻意不修**，理由有两条：
- 根治要动 `tsdown.config.ts`，而那个文件**不在任何任务的 inScope 里**；
- 更要紧：**同轮既改产物生成规则、又改产物本身，会让「新增失败 = 0」这个读数不可信**。

**证据**:
```bash
grep -n "pattern: '\\[hash\\]_\\[local\\]'" tsdown.config.ts
git status --short lib/ | grep -v 'lib/client.js'    # 除 client.js 外应当为空
```

★★ 三条纪律：

1. **`lib/client.js` 不许进任何任务的交付物。** 它对只碰 `src/quality-gates.ts` 这类文件的任务
   完全无关，而它 484 行的路径噪音会把真正的功能改动埋掉。
2. **`git-artifacts --check` 在 worktree 里会红，而那个红是"可解释的"** ——
   判据必须能区分「产物真的不一致」与「client.js 的路径污染」，
   否则每一个 implementation 任务都会撞同一条红，然后学会忽略它。
3. **它解释了「worktree 里 verify 全绿」与「合进主树后全绿」之间的那道缝** ——
   每个 worktree 都生成一份字节不同的产物，而合并时只有最后那份进主干。

★ 下一条独立任务：让 CSS 命名不依赖绝对路径（或设 `sourcemapBasePath` 类的东西），
然后**一次性重建**所有人的 `lib/client.js`。

## 20. ★★★ 契约在**建的那一刻**写窄，会让成员正确地选择失败 —— 而那不是成员的错

> 「未实现一行代码 —— 契约在结构上不可满足，按任务书「Do NOT guess a file set」停下并上报。」
> —— `t5`（测试文件哈希基线）的交付报告，2026-10-20

**判据**:`t5` 的 `inScope` 是 `src/artifacts.ts` · `src/tools/update-task.ts` · `src/state/tasks.ts`，
而它要做的两件事里有**两件在结构上做不到**（逐条实测）：

```
claim 时快照必须挂在三个 claim 点：
  src/tools/claim.ts:98       beginTaskAttempt(...)
  src/scheduler.ts:891        beginTaskAttempt(...)
  src/tools/reassign.ts:117   beginTaskAttempt(...)
  ⇒ 三个全在 inScope 之外
而臂的落点：scripts/gate-*.test.mjs（实测 119 个）⇒ 也在 inScope 之外
```

⇒ ★★ 它**只能**加一个"可选参数"，而 scope 内没有任何调用方能传它
⇒ 基线永远不存在 ⇒ 比对永远落"拿不到" ⇒ **一条看起来装好、永不生效的判据**。

**现状**:⚠️ 已记账，未修。根因是**我用 `edit_plan` 建的契约**，而
`grep -c "rejectOnContractGates" src/tools.ts` ⇒ **0** —— 那条路线不跑契约门
（需求 §13 已逐字记录过同一件事，而我在同一会话里又踩了一次）。

**证据**:
```bash
node --input-type=module -e "import {readTeamSync} from './lib/state.js'
const t=readTeamSync('.agent-teams','shortfall-repair')
for (const x of t.tasks) if (x.kind==='implementation') {
  const s=(x.inScope??[]).some(p=>p.startsWith('src/')), l=(x.inScope??[]).some(p=>p.startsWith('lib/'))
  if (s&&!l) console.log(x.id, x.status)
}"
# 修复前：t1 completed · t4 pending · t5 failed · t6 pending  ← 4 条
```

★★★ 三条纪律：

1. **一个成员因"契约不可满足"而 `failed`，不能与"做砸了"同形。**
   `t5` 的选择是对的（宁可失败，也不造一个恒 `unmeasured` 的空壳），
   而 `failed` 这个状态**区分不了**这两件事 —— 于是它会被读成"它没做成"。

2. **`edit_plan` 的 `add_task` 必须跑契约门。** 这是 §13 的核心诉求，
   而本轮 4/4 条 implementation 契约都缺 `lib/` 配对，全部由这条缺口造成。

3. **写 scope 时要问「这件事的**每个落点**都在里面吗」**，而不只是"要改哪个文件"。
   `t5` 的教训不是"t5 很难"，是"我把落点数少了一半"。

★ 处置：`lib/` 配对已逐条 `amend_task` 补上（t3/t4/t6）；`t5` 因已终态不可改，
由 `t7` 的验收**明确裁定其失败性质**，并如实记「测试文件哈希基线至今未做」。

---

### ★★★ 而 2026-10-20 的修复只解决了**一半**（这条必须留在这里）

`edit_plan` 的 `add_task` 路线现在**真的跑契约门**了（`src/tools.ts`，见提交 `4f831b3`）。
★ 但它跑的是 `contract.build-artifact-scope`，**它只查 `src/` 有没有配对 `lib/`**。

实测（两条，方向相反）：
```bash
# ① t5 的原契约 ⇒ 被拦
gate({task:{kind:'implementation', inScope:['src/artifacts.ts','src/tools/update-task.ts','src/state/tasks.ts']}})
⇒ ok:false「declares no build artifact under "lib/"…」

# ② 配了 lib/，但**仍然**缺三个 claim 点与 scripts 落点 ⇒ **放行**
gate({task:{kind:'implementation', inScope:['src/artifacts.ts','src/state/tasks.ts','lib/artifacts.js','lib/state/tasks.js']}})
⇒ ok:true
```

⇒ ★★★ 也就是说：**`t5` 真正的毛病，这道门查不出来。**
它的病是「**这件事的每个落点都在 scope 里吗**」，而 `build-artifact-scope` 只回答
「**lockstep 产物配了吗**」。这是两个问题。

★★ 而第二个问题**今天没有任何判据在问** —— 它需要一个更弱也更难的判据：
从 `objective` / `acceptance` 里推出"会碰哪些路径"，而那件事
**在判据层做不到**（判据不许猜，`requires.ts:611` 逐字写过"这一类如实推不出来（少报），
而不是猜一个"）。

⇒ 所以正确的处置是**承认它做不到**，并换一条路：让**契约的作者**在写 scope 时
被问一句可判定的话。可行形态是 `add_task` 的 `inScope` 声明**要求作者列出落点**，
而"落点齐不齐"由**成员开工后的第一条读数**报出来（它一碰就超出 scope ⇒ 现有门就红）。
★ 这比造一个猜得出来就报、猜不出来就沉默的判据**诚实**。

## 21. ★★★ 六件短板的最终交付（2026-10-20/21）—— 以及团队为什么停在半路

**判据**:用户在 2026-10-20 要求「把这些都安排进 DAG 里」。团队 `shortfall-repair`
（4 成员 / 7 任务）被建起来并跑到 t1/t2 完成、t3 产出后被上游拦截。

**现状**:✅ **六件全部落地**，但其中**四件是队长自己做的**（团队停摆之后）。

| # | 短板 | 谁做的 | 提交 | 臂 |
|---|---|---|---|---|
| ① | admission「已注册零求值点」的假话 | t1（architect） | `ad32ab4` | 文档三处 + 4 处同源假话（`36dd061`）|
| ② | requirements 自审缝 | t3（integrator） | `ad32ab4` | 13 条（含反向半边）|
| ③ | 重派必然复用已满会话 | 队长 | `44d119e` `52c3f6f` | 7 条 + 3 突变 |
| ④ | 判据 outputs 无读者 | t2（researcher） | `docs/OUTPUTS-CONSUMER-AUDIT.md` | 机械自检 45=12+23+9+1 |
| ⑤ | 测试文件无哈希基线 | 队长 | `b7d716e` | 7 条 + 4 突变 |
| ⑥ | 判官独立性无可读读数 | 队长 | `67b0c69` | 6 条 + 3 突变 |

**★★★ 团队停摆的直接原因：上游账号被限制**

```
wb API error (400): {"code":"upstream_content_policy_blocked",
  "message":"账号存在异常行为，已被限制使用"}
```
四个成员**全部**路由到同一个 `wb` 账号 ⇒ 每一次成员回合都立即失败
⇒ t3/t4/t6/t7 被自动标记 `failed`（**而 t3 的产物其实完整**）。

★ 冷协议说法：这是**环境故障**，不是任务失败。它同时是「单点 provider」的代价 ——
  一个有 4 个成员、7 条任务的队，因为一个账号被限制而**整体停摆**。

**证据**（全部可复跑）:
```bash
node --test scripts/gate-test-file-baseline.test.mjs      # 7 臂
node --test scripts/gate-review-independence.test.mjs     # 6 臂
node --test scripts/gate-session-budget.test.mjs          # 7 臂
node --test scripts/gate-self-review.test.mjs             # 13 臂
pnpm test:gates   # 1760 tests / 1694 pass / 27 fail —— NOT in pin = 0
```

★★★ 三条值得留下的纪律：

1. **「判不了」**不许并进**「通过」** —— 这条在六件里出现了**五次**
   （`unmeasured` / `not-landed` / `unreadable` / `unknown` / `could-not-measure`）。
   每一次的补救动作都不同，而合流会让读的人去做另一件事。

2. **一条恒真的判据比没有判据更坏。** ③ 里最容易犯的是拿**累计** token 比阈值
   （实测队长 4.03 亿 vs 窗口 100 万）—— 那会让 `full` 在任何真实队伍上永远为真。
   ★ 臂 4 专门钉这一格，且用定向突变证明它真的会红。

3. **第二份实现是本仓最贵的缺陷**。⑤ 里我**自己重写了一遍** Zstd 帧遍历器，
   而它错了两次（magic 字节序、RLE 块长度）。⇒ 正确处置是**移进 `src/` 让两处共用**，
   而不是"我这次写对了"。

★ **没做的**（如实记账）：本插件**仍然没有**"给成员换一个干净会话"的能力 ——
用户裁定本轮只做「读数 + 拒绝重派」。⇒ 撞上 `full` 的队伍今天只能**换成员**。
而拒绝语已明写「Reassigning will NOT help」，不会让人误以为重派能解决。

## 22. ★★ 三条**裁定为不做**的（附读数，防止下一轮重做）

**判据**:2026-10-21 用户批准了裁决表的全部建议。下面三条是「**不做**」，
而"不做"必须**写下来** —— 否则下一个人会重新发现它们、重新提案、重新讨论一遍。

**现状**:✅ 已裁定（三条都不做），读数如下。

### ① 能力匹配 rank（MVP 步骤 3）—— 不做

```bash
node -e "…遍历 .agent-teams 下所有 team.json…"
# → { tasks: 228, withAssignee: 228, pendingNoAssignee: 0 }
```

★★ **228 条任务全部有 assignee，零条落在共享池。**
⇒ 那个"共享池 ⇒ 按能力匹配挑人"的第二条规则，在真实语料里**一次都不会被走到**。

★ 而它原先的验收判据（离线重放一致率 ≥95%）**分母只有 5** —— 怎么算都能过。
一条没有可复跑收益读数、且判据分母只有 5 的机制，做出来只会是
"看起来有、而永远不会被走到"。

### ② tools 白名单收紧（MVP 步骤 5）—— 不做

```
真正的"审查者/验证者动了源码"   1 条 / 84  （1.2%）
"同一个成员既审又写"           18 条 / 93  （19.4%）
```

★★ 而机制上 `tools.restrict()` 的 deny **按 agent 一生生效**
（`src/capabilities.ts:53` 的 `WeakMap<Agent>`）⇒ **不能按任务切换**
⇒ 唯一能落地的形态是"给 review 单独派人"，而那**依赖 ①**（已裁定不做）。

★ 另一条可行形态是"审的成员**永久只读**" —— 代价（一个成员永久失去写权）
  与它防的东西（1.2%）**不成比例**。

### ③ admission 的"无待确认问题" —— 读**已有**事实，不新造文件

`planReviewState` 已在生产用着（`create.ts` 1 处 / `status.ts` 5 处 / `state.ts` 3 处）。

★ 裁定：读 `planReviewState` + 未读收件箱 —— **两样都是已有事实**。
★★ **不**新造 `open-questions.json`：那会造出**第二份真相**，
   正是本仓这几年一直在清理的那种东西。

---

★ 三条共同的判据（值得复用）：**一条机制如果"在真实语料里一次都走不到"，
  或者"判据的分母小到怎么算都能过"，那它做出来只会增加维护面，不会增加读数。**

---

## 23. ★★★ 需求台账必须有一条**本仓自己的**机械对齐判据

> 「**我希望在整个插件的开发过程中，能不断对齐这份文档，看还差什么。
>  除了你在代码层面查看以外，在需求层面也要看这份文档，看跟我的需求还差什么。**」
> —— 用户原话（源文档 §12.1；而本仓此前**从未**对它做过任何机械检查）

**判据**:用户原话 + 2026-10-21 的可复跑读数（下）。★ 而**这一条推翻了一个旧判断**：

```
旧判断：本文件第 5 行写「它是**一份可对齐的清单** —— 供 workbench-align 双向比对」
        ⇒ 读起来像"对齐机制已经有了"
实测：  find . -name "requirements-contract*" -not -path "./node_modules/*"   ⇒ 空
        find . -name "workbench-align*"       -not -path "./node_modules/*"   ⇒ 空
        grep -rn "REQUIREMENTS.md" scripts/ | grep -c claims                   ⇒ 0
        node ~/Desktop/自动化开发插件/bin/workbench-align.mjs --repo .
        ⇒ ✖ 26 claim(s) marked MET whose evidence is GONE（26 条全指向另一个仓的文件）
推翻理由：那个工具住在另一个仓，它的 37 条 claim **硬编码那个仓的路径** ⇒
          它对本仓只能回答"你的 26 个文件不存在"，而它回答不了本仓的任何一条需求。
```

★★ **而它已经漂了**（这三处都是本轮实测，不是推测）：

| 漂在哪 | 台账写的 | 实测 |
|---|---|---|
| §12 现状 | 「⬜ 未实现」 | (i)(ii) 已实现，见 §12 的追记 |
| §5 判据数 | 「共 21 条判据」 | **22** 条（`completion.r5` 被漏数 —— 它的 id 带数字） |
| README | 「14 coordination tools」 | **17** 个 → **18** 个（`agent_teams_*`，2026-10-22 加了 halt） |

**⇒ 需求:**
```
① 台账必须有一条**本仓自己的**机械对齐命令（不是"借另一个仓的工具"）
② 它必须**双向**：需求有证据缺失（gone）· 台账有节无人认领（unclaimed）· claim 指向被删的节
③ 它必须**诚实分级**：mechanical 与 manual 分列，绝不合并成一个"全绿"
④ ★★ 而 `gap` 与 `met` 必须**对称** —— 一份只在缺口存在时才通过的清单会**永远绿**，
   于是"缺口被补上了"这件事**看不见**（见 `claim-stale` 那一态）
```

**现状**:✅ 已实现（2026-10-21）

```bash
node scripts/requirements-align.mjs                     # 人读
node scripts/requirements-align.mjs --json              # 机器读
node scripts/requirements-align.mjs --sections          # 每节被哪条 claim 认领
node --test scripts/gate-requirements-align.test.mjs    # 12 臂（含 5 条反向半边）
```

★ 读数：**38 条 claim · 30 条机械核对 · 2 条只能靠读 · 0 条证据消失 · 0 个未认领节**。

**证据**:`scripts/requirements-claims.mjs`（claims + 探针）· `scripts/requirements-align.mjs`（命令）·
`scripts/gate-requirements-align.test.mjs`（12 臂）。

★★ 三条纪律：

1. **`manual` 不许并进 `verified`。** "每条断言都要能在反向变红"是**跨整个程序的行为属性**，
   用 grep 去"验证"它就是**把谎话打扮成检查**。一个声称"全部已验证"的报告会被忽略。
2. **`gone` 与 `claim-stale` 的补救动作相反**（去补实现 vs 去改文档），所以是两态、两个断言。
3. **探针不翻转方向。** 方向属于 claim 的 `status`，不属于探针 —— 本条实现时**踩过一次**：
   §19 的探针写成"缺口还在就返回 true"，于是 `status: 'gap'` 被读成 `claim-stale`，
   而**方向写反的探针与真的修好了在读数上完全同形**（臂 4 / 臂 9 现在钉住这一格）。

---

## 24. ★★★ 重启那一环**如实保持"人来做"** —— 在有人拍板之前不许实现

> 「有没有办法不用重启就让我改的插件代码生效？」—— 用户问题（`docs/RESEARCH-RESTART-FREE.md`）
> 而一旦把它回答成"能"，就会踩上 `docs/DEFECT-HMR-DURING-MEMBER-TURN.md` 记的那条：
> **一次 `pnpm build` = 一次插件重载 = 打断所有正在跑的成员回合。**

**判据**:本仓三层实测（`src/hmr-trace.ts` 文件头 + `docs/RESEARCH-RESTART-FREE.md` §2）：

```
① HMR 看到文件变化      ✅  .agent-teams/hmr-reloads.jsonl 有 50 条记录
② 模块被重新求值        ✅
③ apply() 被重新执行    ❌  宿主持有的工具闭包仍是旧的
   ⇒ 「改了代码就生效」这句话是假的 —— 而三层在外部读数上**同形**
```

**⇒ 需求（这条是边界，不是能力）:**
```
★ `agent_teams_restart` 的 description 必须继续**逐字**声明它换不了代码，
  并交出 `code_on_disk_in_effect` 的三态读数（yes / no / unmeasured）。
★ 谁把那句话改成"reload 后即生效"，就必须同时拿出③成立的新读数 —— 否则那是 t11 记过的
  同一句假承诺（措辞承诺了一件实现做不到的事）。
★ 自迭代的最后一跳**只能是人**：这不是"还没做完"，是**当前配置下的正确形态**
  （循环跑在 host 进程内，加载不到它自己刚写的代码 ⇒ 自迭代结构上不闭合）。
```

**现状**:✅ 已实现（"如实声明"那一半早就有了；本条把它**变成受判据保护的边界**）
`node scripts/requirements-align.mjs` ⇒ `R24.1` 探针 `restart-still-honest` 绿。

**证据**:`src/tools/restart.ts:113`（description 逐字）· `scripts/requirements-claims.mjs` 的
`restart-still-honest` 探针 · `docs/DEFECT-HMR-DURING-MEMBER-TURN.md`。

★★ 而**重载打断成员回合这件事已经修好了** —— 这条必须写清，否则下一个人会重做一遍：
`ad5be83`（2026-10-20 04:10）加了 `infrastructureFailureOf`：紧跟在本进程一次重载之后的
`inactive context` 失败**不落 `failed`**，任务保持打开、成员回 idle、队长收到一条明说是
基础设施故障的消息。实测 **17/17 绿**（`node scripts/member-failure-tdd.mjs`），
含三条对照臂（窗口外 / 别的 pid / 别的报错 都不豁免）。

★ 而**仍缺的一格**：`FAILURE_KINDS` 里没有 `infrastructure` 这一类 ⇒ 那条路径**不写**
`failureKind`（任务根本没落 `failed`），于是"被重载打断过"这件事在**任务的终态历史**里
读不到（只在收件箱消息与 `hmr-reloads.jsonl` 里）。本轮**刻意不改**数据模型：
加枚举值是语义变更，而它现在的收益（给一条已豁免的路径多一个标签）与风险
（`types.ts` 镜像 + 客户端三处 + 夹具逐字比对）不成比例。

---

---

## 25. ★★ 三处「算出来了但没落地」的接线修补（2026-10-21）—— 附改前/改后读数

**判据**:用户"都去做"批准了本轮的三个修补 + §23 对齐判据 + §24 边界。本条记录**改前/改后**两组可复跑读数，
符合本文件 §7 硬门槛②（改前读数必须在改产品**之前**采到 —— 本轮三条的改前读数都写在下面，
且每条都有一条**先红后绿**的夹具作证）。

### 25.1 `edit_plan` 采集点的输入面（R11.4）

```
改前：dedupe:unmeasured  cooldown:unmeasured  attributable:unmeasured  immunity:ok
改后：dedupe:ok          cooldown:blocked     attributable:ok          immunity:ok
```
★ 复跑方式见 `scripts/gate-observe-call-sites.test.mjs`（5 臂，按调用点逐块核）。
★★ 而**这不是"§5 说的 21 条判据又变了"** —— 变的是**输入面**，不是判据本身：
   `attributable` 从 unmeasured 变 ok 是因为 `component: 'plan'` 补上了；
   `cooldown` 从 unmeasured 变 **blocked** 是因为它**第一次真的有窗口可比**。

★★ **而 blocked 那个读数要读对**：cooldown 窗口是 5 分钟，同一来源 5 分钟内再来一条就拒。
   它现在**真的会拦**了 —— 在此之前它 44/44 全 `unmeasured`（等于这条判据不存在）。
   这是"补上输入面"的预期后果，**不是**新引入的严格性。

### 25.2 提案的写方（R2.2 前半）

```
改前：ls .agent-teams/evolution/  ⇒ index.json  signals.jsonl（从来没有过 proposals.jsonl）
改后：每次采集 ⇒ 分流 ⇒ 追加一行到 proposals.jsonl（并发 20 次 id 不撞车，臂 3 钉住）
```
★ 而 `R2.3`（提案**真的变成**一条 `create_task`）**仍然是 gap**，本轮**刻意**不做：
   一旦派发，"提案 → 任务"就成了无人值守的动作，而那要先有"谁的提案该被自动派发"这条判据 ——
   那是产品决策，不是实现细节。

### 25.3 重载归因：★ **本轮不修，因为已经修好了**（如实记账）

```
我上一轮的报告里有一条错：说"重载失败仍被记成 failed_context"。
实测 `node scripts/member-failure-tdd.mjs` ⇒ 17/17 绿，含：
  ✔ ★ N4 豁免臂：紧跟在一次重载之后的 inactive context 不落 failed，任务仍打开
  ✔ ★★ N4 接线臂：真实接线（失败后立刻重派）下，重载打断的任务绝不停在 failed
  ✔ 三条对照臂（窗口外 / 别的 pid / 别的报错 都不豁免）
```
⇒ `ad5be83`（2026-10-20 04:10）已实现。★ 本轮**没有**加 `infrastructure` 枚举值：
   那条路径**根本不落 `failed`**，加枚举只是给一条已豁免的路径贴标签，而代价是
   `types.ts` 镜像 + 客户端三处 + 夹具逐字比对 —— 收益与风险不成比例。
   ★★ 这条更正本身是 §23 的直接产物：**写下来之前先复跑，而不是先相信上一轮的报告。**

---

---

## 26. ★★★ 2026-10-22 的六个落地（1 / 5 / 6 / 7 / 8 / 9 / 10 / 11）—— 附读数

**判据**:用户 2026-10-22「做 1,5，ui 还需要讨论，B 都做」的逐字裁定。

### 26.1 ① 模型侧的终止动作（R12.3）

```
改前：17 个工具，grep halt/discard src/tool-names.ts ⇒ 零命中
      ⇒ 模型只能 delete（不可逆），不能"先停一下"
改后：18 个工具，agent_teams_halt（captain-only）
      而且它与 delete **语义分界**：halt = 任务 cancel（不是 remove）+ 成员 idle
      + 团队仍在 + resume 能拉回；delete = 归档、不可逆
```
★ 判据：`scripts/gate-halt-tool.test.mjs`（6 臂，**2 条反向半边**：非队长拒绝且零副作用 / 重复 halt 不重复 cancel）。

### 26.2 ⑤ 供应商拒绝服务时的 fallback（§21 那次整队停摆的根因）

```
改前：FALLBACK_FAILURE_CODES = QUOTA · RATE_LIMIT · AUTH · MISSING_CREDENTIAL · NO_ADAPTER
      ★ 而 MISSING_CREDENTIAL / NO_ADAPTER 在 harness 里**一次都不会被产出**
        （它们是 `dsh-llm/lib/types/error.d.ts` 注释里的举例）
      ★ 而那次真实报错 `wb API error (400): {...upstream_content_policy_blocked...}`
        经 `classifyPiAiError` 判成 **INVALID_REQUEST** ⇒ 不在清单里 ⇒ 不换路由 ⇒ 整队停摆
改后：QUOTA · ACCOUNT_QUOTA · RATE_LIMIT · AUTH · **INVALID_REQUEST**
```
★★ **这条推翻了本轮审计我给的建议**：我原本建议"加 `upstream_content_policy_blocked`"，
  而那个字符串**不是** harness 的 `failure.code`（它是供应商响应体里的 content）。
  ⇒ 正确落点是 400 那一族。判据：`scripts/fallback-tdd.mjs` 新增的**真实事故臂**
  （把那次报错原文喂进分类器，再问"该不该换路由"）。
★ 仍**不加** `CONTEXT_WINDOW_EXCEEDED`（换路由时上下文一字不变）。

### 26.3 ⑥ 收益读数有了生产出口（R6.2）

```
改前：grep -rn "from ['"].*evaluator/" src/ | grep -v '^src/evaluator/' ⇒ 空
改后：`snapshot` 的 `effectReadout` —— 评估器的第一个生产消费者
```
★ 落点在**装配层**（§1 规则 A + §3：evolution 与 evaluator 互不 import，只有 snapshot 同时看得见两边）。
★ 判据：`scripts/gate-effect-readout.test.mjs`（6 臂，含反向半边"没靶不进分母"）。
★★ 而真实语料那一格**此刻仍无数据**（本仓零 stored proposal）—— 臂 3b 把那个读数如实报出来，不报成通过。

### 26.4 ⑦ `lib/client.js` 字节可复现（R19.1）

```
改前（同 commit、两棵树、同一份 src）：
  主树     md5 f8567dd035e6d5b9c8e97f67a9056c1c
  worktree md5 5690c8bbbf65583d5a21d9860bced66a
改后：
  主树     md5 505c631b444b76c290c7f92a2257dc31
  worktree md5 7262cea96312c60da6b0b4a342e99c3a
  ⇒ 归一化根路径后**逐字节相同**（只剩 esbuild `//#region` 的 module-id 注释带绝对路径）
```
★★ **推翻了 §19 的旧判断**：「这不是缺陷，是 worktree 的固有属性」。错了一半 ——
  成因是**我们给一个会哈希路径的工具传了绝对路径**，worktree 只是让它显形。
★ 判据：`scripts/gate-client-reproducible.test.mjs`（4 臂，含反向半边：绝对路径**确实**改变类名）。

### 26.5 ⑧ `inScope` 的说明改成"要求作者列出落点"（§20 的处置）

★ 不加新判据（§20 逐字判定"判据层做不到、不许猜"），而是把**那个可判定的问句**
  放进 `create_task` 与 `edit_plan` **两条路线的同一格说明**里（逐字同源）。
★★ 提示词是**必要条件而不是充分条件**：真正的防线仍是 `dispatch.changed-paths`。

### 26.6 ⑨⑩⑪ pin 清单 / 文档工具数 / 待决归档

```
⑨ pin 35 → 34：退 1 条（gate-input-wiring 臂 4，已由接线修复转绿）
   ★★ 另三条**主树上绿而刻意不退**：它们是**环境依赖**（需要 .agent-teams 语料 / node_modules 缓存），
      转绿不构成"缺陷已修"的证据。退它们会让下一次 worktree 里那次真实红被当成"已知"吞掉。
⑩ 文档工具数 14 → 18（README / README_ZH / progressive-loading / usage），
   并加探针 `doc-tool-counts-match`：★ 它在第一次运行时**抓到我漏改的两处 README**
⑪ docs/DECISIONS-PENDING.md 归档：它自称"需要你判的 3 条"，实测 6 条全部闭掉。
```
★ 探针 `doc-tool-counts-match` 的落点在第 10 条：**一个写着过期数字的文档比没有那个数字更坏**。

---

---

## 27. ★★★ 统一入口要**图形化到能看懂在干什么**，而不是"像素风的文件夹"

> 「目前它是一个像素工作区，一个一个文件夹对吧？**我想要的不是这种文件夹的形式，
>  而是更加图形化一点。比如真的有那种像素小人之类的，然后是一个一个工作区，
>  因为单纯的像素文件夹其实没有意义啊。**」
> —— 用户 2026-10-22 逐字（对本轮已上线的第一层的裁定）

> 「我原本不是说关于 personal agent，就是 **Grok BOT 或者是 muse** 之类那种形态是比较好的嘛。
>  后来有人给 DeepSeek 也做了一个 BOT，你可以去查一下。
>  **https://github.com/ypyik0669/claude-web** 这个项目做了一个像素风的界面 其实还挺好的
>  它是一个**网吧的场景** 还挺有意思的」
> —— 用户 2026-10-22 逐字

**判据**:用户原话逐字 + 本轮**已上线实现**与它的差距（可复跑读数）。

### 27.1 ★★ 已上线的那一层被用户**明确否决了一半**

```
已实现：`src/client/folders-panel.tsx` —— 一个 `<button>` + 16×16 像素文件夹 SVG + 两行文字
        （`data-folder` / `data-folder-teams` / `data-folder-live` 三个可读读数）
被判否：★ "单纯的像素文件夹其实没有意义" —— 它表达了"有几个工作区"，而
        **没有表达"里面的人在干什么"**
```

★★ **这段话把 §27 的判据说清了：图形化的目的不是"好看"，是"让人一眼看出在干什么"。**
   一个文件夹图标无论画得多像素，它的信息量都是"一个工作区"；而用户要看的是
   **谁在干活、干到哪一步、谁卡住了** —— 那是**活动**，不是**容器**。

### 27.2 ★★★ 参照物（外部材料，已核实）

```
仓库：ypyik0669/claude-web（TypeScript，34★，2026-10-21 更新）
定位：Claude Code 的可视化工作台（网页 + 桌面），也能驱动 Codex / Gemini CLI 等
形态：★ 后台有一间**像素网吧**
      · 主对话 = 前台的**网管**（在跑时在柜台敲键盘，闲着四处转）
      · 每个子代理 = 一位**客人**：进门开机 → 坐到机位 → 干活时屏幕滚代码、
        头顶冒泡说刚做了什么 → 闲了去吃泡面/打游戏 → 做完到前台**结账**（弹小票）
      · 失败 = **蓝屏**；被停 = 网管喊「被叫下机」
实现：web/src/features/cafe/{sim,render,map,bake,iso,path}.ts ≈ 2000 行
      · `sim.ts`：**状态机**（`Doing` 14 态：toDesk/checkin/toSeat/work/game/activity/bsod/checkout/leave/…）
      · `render.ts`：等距（iso）房间 → 小 canvas 一点一像素地画 → 无平滑放大
        → 光照（整间压暗 + 加光源）→ 最后在页面分辨率上画名字/座位牌/气泡/小票
      · 角色是 24×24 像素、一个角色一个 JSON
```

★★ **而它最值得借的不是"像素"，是这条分工**：
```
状态机（在 sim.ts，可单测）  ≠  渲染（在 render.ts，只管画）
⇒ sim.test.ts / map.test.ts 是**纯数据测试**，不需要看画面
```
★ 这与本仓的既有纪律**同源**：判据必须落成**可读的数据形状**，本机没有视觉模型。
  所以"画对了没有"只能靠 `data-*` 读数与纯函数判断 —— 见 §27.4。

### 27.3 ★★★ 已裁定（2026-10-22 第二轮）：**工作区 = 一个房间**

> 「在目前的 DeepSeek 2.4 里面，**一个文件夹其实是作为一个工作区**。我需要这个工作区
>  就像一个**房间**，你可以参考一些经营类或者像素游戏的房间概念，去看看它的画面是怎么做的。」
>
> 「**一个工作区（或者说一个项目）就是一个房间。房间里面一般只有一个团队**，
>  当然也不排除有两个或几个团队，**这样应该就不会显得很空吧**。」
> —— 用户 2026-10-22 逐字

```
★ 层级（裁定）：
    工作区 = 项目 = **一个房间**
    团队   = 房间里的**一群人**（通常 1 个，可能 2~N 个）
    成员   = 房间里的**像素小人**
    ★ "一个房间通常只有一个团队"是用户对**空房间**风险的正面回答
      ⇒ 房间尺寸不该按"最多能放几个团队"设计，而该按**一个团队的人头数**设计
```

★★ **场景②（照抄网吧：队长=网管 / 成员=客人）被这一条排除**：
   网吧是"一个会话里许多子代理"的一层结构，而本插件是"工作区 → 团队 → 成员"三层。
   照抄会让**工作区与团队的层级**失去表达 —— 而用户这句话恰恰是在说层级。

★ 实测占用（本工作区，可复跑 `collectTeamsActivity`）：**8 个团队 / 35 个成员**
  ⇒ 这不是"一个工作区只有一个房间"的反例：本工作区同时住着 8 个队，
    所以一个房间要能容纳"1~8 个团队、最多 ~35 个人"两个量级 ——
    **房间必须能长大**（这正是参照物的 `COLS/rows` 按座位数增长的做法）。

### 27.4 ★★★ 无论选哪个案子，**判据形状**是同一个（这一条已可执行）

```
★ 每个成员 = 一个可读的 `data-member-*` 读数（doing / seat / lastAction / token）
★ "在干什么"必须来自**既有事实**，不加数据通道：
  · doing       ← task.status（pending/claimed/in_progress/completed/failed/cancelled）
  · lastAction  ← task 的 commandsRun / output（已有字段）
  · token       ← memberSessionBudget 的读数（§21 那条已有）
  · 卡住了      ← runtime.liveness 的 blocked（★ 已有判据，不许另算一套）
★★ 而"画得好不好看"**不进判据** —— 本机没有视觉模型。
   判据只回答"这个格子的读数对不对"，与 folders-panel 的 `data-*` 同一条路。
```

### 27.5 ⚠️ 仍然待裁定的两条（**本轮刻意不做**）

```
① 房间页要不要成为**默认入口**？
   现状：两个 main key 并存（`agent-teams/folders` + `agent-teams/room`），
        房间**没有**被设为默认。
   ★ 为什么不当场替换：`gate-folders-panel` 的 **11 条臂**钉在 `FoldersPanel` 上
     （含"面板 import 了 noteProbeRender"这条反向半边的落点）。
     直接换会让它们**失去落点** —— 而"失去落点"与"那条判据不适用"同形。
   ★★ 而"哪一个是入口"是**产品决策**：文件夹页仍在表达"有几个工作区"，
     房间表达"里面的人在干什么"。两者不是替代关系，是**两个问题**。

② 画风要不要升级到**等距房间**（16×8 格子 + 墙 + 光照 + 24×24 角色）？
   现状：**正投影**（一格一工位、地板 grid + 方块小人）——
        先让"谁在哪、在干什么"可读。
   ★ 等距是**观感**，按 27.4 的纪律不进判据；而它会让一屏能放更多工位
     （参照物实测 34 列 × 18+ 行）。
```

**现状**:✅ **已实现最小实验**（2026-10-22）—— 房间的**状态机 + 正投影渲染**通了；
          上面两条待裁定

**证据**:`src/client/room-plan.ts`（纯函数）· `src/client/room-panel.tsx` + `.module.css`（渲染）·
`scripts/gate-room-plan.test.mjs`（9 臂，含 3 条反向半边与 1 条真实语料臂）·
`src/client/folders-probe.tsx` 的 `ROOM_MAIN_KEY`（第二个 main key）·
外部参照 `ypyik0669/claude-web` 的 `web/src/features/cafe/`（★ 已 clone 核实，非转述）·
`docs/PIXEL-UI-RESEARCH.md` / `PIXEL-UI-RESEARCH-2.md`（像素风的既有调研）。

★★ 三条纪律：

1. **先定"要表达什么"，再定"画成什么样"** —— 用户这句话的落点是"看不出在干什么"，
   而不是"像素画得不够好"。先改信息层级，再谈美术。
2. **状态机与渲染分开**（借用参照物的那条分工）：状态机是纯函数、可单测；
   渲染只读它。★ 否则"画错了"与"数据错了"在读数上同形。
3. **不加数据通道**：所有读数都从既有字段投影（`task.status` / `commandsRun` /
   `memberSessionBudget` / `runtime.liveness`）。★ 为了画小人而新开一条后端投影，
   会让"界面上看到的"与"判据读到的"变成两份真相。

---

*本文件是【需求清单】，不是计划。未裁定的提案在 `docs/DECISIONS-PENDING.md`。*
