# 三线并行执行计划（变异测试 · 验收状态 · UI 读数）v3

> v3 已吸收第二轮独立复核（t16，四方向并行）的三条 blocker 与五条 high。
> ★ v2 的 §3 合并策略**不可执行**，已被推翻；见 §3。
> 判据纪律：进展 = 命令打印的数字，不读任何模型的自我陈述。

## 0. 现状（已核实，非记忆）

| 事实 | 证据 |
| --- | --- |
| 账本未接入生产完成路径 | `grep -rn ledger src/tools/update-task/` ⇒ 空 |
| 账本实现在 t3 工作树里 | `t3/src/gates/completion/mutation.ts:269` |
| **五棵树互不为超集** | 符号矩阵见 §3.1——没有任何一棵含全部能力 |
| **10 对组合全部冲突，0 对干净** | `git merge-tree --write-tree` 逐对 exit=1（t16 实测） |
| **裁定 A 已落地** | t13 工作区 `src/mutation.ts:1092` `scored = killed\|survived`；`:1110` `scoreDenominator = scored + uncoveredRuns`；门禁 `:610` 读 `totals.scored` 对 20 地板 |
| 状态点把「会话已卸」读成停滞 | `MemberRow.tsx:109` `not-live ⇒ 'stalled'` |
| 成员时钟只给在飞任务计时 | `activity-model.ts:938` 只认 claimed/in_progress |
| **t17/t18 的成果未提交** | t13 工作区 5 文件未提交；t18 工作区 16 文件未提交、HEAD 仍是 `2ecd498` |

## 1. 用户裁定（前置，不可协商）

### 裁定 A：`uncovered` **不进** `totals.scored` ✅ 已落地（t17）

`scored` 同时喂两个方向相反的判读：
```
mutationScore = killed / scored        （分母越小 ⇒ 分数越高）
scored < MIN_SCORED_FOR_VERDICT (20)   （分母越小 ⇒ 越容易拿到裁决）
```
t13 原来把 uncovered 并进 scored ⇒ 一行覆盖都没有时 `scored = 40` ⇒ **越过 20 地板拿到「0 分」裁决**。而「一行都没跑」本该是 unmeasured。

落地形状（已核）：`scored = killed | survived`；分数分母 = `scored + uncovered`（保守）；**地板只读 `scored`**。

### 裁定 B：`runMutationEngine` 删除 ✅ 已落地（t17）

零调用方；t1/t11 在其中留了两份分歧实现。删除后全仓只剩注释。

## 2. ★★ v2 的三条 blocker（t16 复核结论，全部已复核）

### B1 · v2 的合并顺序不可执行（blocker）

10 对组合全部冲突。逐对块数（t16 实测）：

```
t1×t11=31  t1×t3=4   t1×t13=5  t1×t7=9   t11×t3=4
t11×t13=7  t11×t7=9  t13×t3=7  t13×t7=18 t3×t7=9
```

v2 定的顺序 `t11 → +t1 → +t13 → +t3 → +t7` 逐步为：t11 干净 → +t1 **31 块** → +t13 7 → +t3 8 → +t7 25。

★ **v2 自己的「两边改同一函数体 ⇒ 停下报人」在第二步 S1.3 就触发**：t11×t1 的 `runMutationEngine` 内两边各改。裁定 B 删它**救不了**——另 9 块落在 `generateMutants` / `establishEquivalence` / `isIdentChar` / `numericLiteralAfter` 等处。

### B2 · v2 的判据看不见最危险的那处（blocker）

`t13×t7` 有一处**无冲突标记**的自动合并：取 t13 的 `scored`（含 uncovered）与 t7 的 `denominator = scored + uncovered` ⇒ `uncovered` **双重计入**。

★ 那正是裁定 A 要消灭的形态，而**任何按冲突数判红的检查都看不见它**。

### B3 · v2 的 P2-a 与仓库既有臂冲突（blocker）—— 已由 t18 用更好的形状解决

`scripts/workspace-activity.test.mjs:177-179` 断言「全 completed ⇒ `kind==='idle'`, `ms===0`」，而 v2 §5 要求「全 completed ⇒ `done`」。同一输入两个相反断言。

★ **t18 没有撞它，而是把它分开了**（实测 52/52 绿）：
- 既有臂的输入改成 `[]`（名下**没有任何**任务）⇒ 仍 `idle`
- 新增 `done` 表示「**刚干完活**」
- 新增 `assert.notEqual(idle.kind, finished.kind)` 钉住两者不同形

⇒ 这比 v2 精确：**「从没接过活」与「刚干完活」是两件事**。v3 采纳 t18 的形状。

## 3. ★★ v3 的合并策略（替换 v2 §3）

### 3.1 为什么不能合：五棵树是五个平行实现

符号矩阵（各树 `src/mutation.ts` 命中数，实测）：

| 能力 | 符号 | t1 | t11 | t3 | t13 | t7 |
| --- | --- | :-: | :-: | :-: | :-: | :-: |
| 等价证明 | `establishEquivalence` | ● | ● | | | |
| 覆盖报告解析 | `coverageLineReading` / `resolveMutationCoverage` | | | | ● | ● |
| 账本 | `createMutationLedger` | | | ● | | |
| 逐测试收窄 | `perTest` | | | | | ● |
| 标识符/字面量算子 | `isIdentChar` / `numericLiteralAfter` | ● | ● | | | |

**没有任何一棵是超集。** t13 与 t7 各有一套覆盖解析（`coverageLineReading` vs `resolveMutationCoverage`），互不包含。

### 3.2 v3 的做法：在集成分支上按能力重做，而不是合提交

```
I1  从 t7 切 task-mutation-integrate（t7 能力最全：逐测试收窄 + 覆盖解析 + 镜像）
I2  按能力逐项移植，每项一个提交、每项一次 build+测：
      a. 裁定 A 的形状（t17 已落地在 t13，移植过来）
      b. t11 的 establishEquivalence
      c. t1 的静态等价不执行
      d. t3 的账本（+ 生产路径接线，见 §4）
      e. t13 的未覆盖分界（与 t7 的那套解析**取其一**，不是两套并存）
I3  收口：全量 build + 夹具
```

★ **为什么不 cherry-pick**：五棵树的改动交织在同一函数里（31 块的 t1×t11 就是证据）。cherry-pick 一个提交会带进它那棵树的全套上下文，冲突量与 merge 相同。

★ **为什么以 t7 为基**：它能力最全（`perTest` 3 处命中、覆盖解析、镜像单条），且它的 `scored` 形状**已经是裁定 A 要的形状**——以它为基，裁定 A 是「保持」而不是「改」。

### 3.3 每一步的验收（不是 pass 数）

```
pnpm build                                    ← 夹具 import 的是 lib/
node --test scripts/gate-mutation-cap.test.mjs
```
★ **臂编号集合比对**，不是 pass 数：实测各树 pass 数 base 9 / t1 12 / t11 12 / t13 11 / t3 12 / t7 15，而合并带入的臂总比删掉的多 ⇒ pass 数单调对「吞掉臂」零灵敏度。

★ 但**集合比对也不够**（t16 finding P6）：集合恒为 `{1..10}`，对「继承臂变红」零灵敏度。⇒ 追加一条：
```
每个编号下的断言条数必须显式登记；且「继承臂」（base 臂 1–7）必须逐条绿
```

### 3.4 已知的移植陷阱（t16 实测 + 队长复核，写死以免重踩）

- **同名助手会 SyntaxError**：`sandbox` 在 t1:410/t11:410 签名不同；`makeRunTest` 在 base:104/t7:111 不同且在**前导区**。拼接即整个文件不加载（`tests 1 / pass 0 / fail 1`）。
- **只点 `sandbox` 不够**：base 前导 + t7 新增实测 `tests 15 / pass 9 / **fail 6**`——6 条继承臂变红，而「臂编号集合不减」照样通过。
- **臂绑定各自的 `lib/`**：`establishEquivalence` 只在 t1/t11，`createMutationLedger` 只在 t3。
- **机制本身没问题**：实测重名 `test` 两条都跑（`tests 15 / pass 15`）。

#### ★★ 臂 10 同号不同内容（队长复核，真实存在于 t7 与 t17 之间）

| 出处 | 臂 10 测什么 | 强度 |
| --- | --- | --- |
| t7 `gate-mutation-cap.test.mjs` | 没有逐测试覆盖时整份套件照跑 | 只断言 `verdict.mutationScore < 1` |
| t17（t13 工作区） | **守门臂**：全未覆盖 ⇒ 判 `unmeasured`，不是 0 分 | 断言 disposition 与措辞 |

★ 两者**都必须留**：t7 那条钉的是「不猜单条测试」，t17 那条钉的是「越过 20 地板也不能拿 0 分裁决」。
★ 而 t7 那条的断言是**弱的**（`mutationScore < 1` 对「0 分裁决」这个坏结果不敏感）——
  所以 t17 的守门臂不是重复，是**补强**。移植时按内容改名（臂 10 / 臂 10e），不按编号去重。

#### ★★ 裁定 A 的第二半目前**没有任何臂钉住**（t19 finding，队长已独立复现）

t19 判 t17 pass，但报了一条 medium finding。**我复现了，它是真的。**

臂 10 的注释（t13 树 `scripts/gate-mutation-cap.test.mjs:652`）宣称：
> 若有人把 `scored` 改回 `killed | survived | uncovered`（**或把地板改读分母**），这里会红。

后半句**是假的**。实测把门禁地板改读分母：
```
lib/gates/completion/mutation.js:498
  report.totals.scored < MIN_SCORED_FOR_VERDICT
  ⇒ (report.totals.scored + report.totals.uncovered) < MIN_SCORED_FOR_VERDICT
```
⇒ **tests 12 / pass 12 / fail 0**（恢复后 shasum `1525d736e84580fd`）。

机制：臂 10 的输入里 `scored.length === 0` ⇒ `src/mutation.ts:1237` 由 `scoreMutants`
**自己**返回 unmeasured，门禁在 `lib/gates/completion/mutation.js:478` 直接 return
⇒ **根本走不到 `:498` 的地板**。

⇒ 臂 10 钉的是 `scoreMutants` 的**过滤器**（裁定 A 第一半）；
  **地板读哪个数**（第二半）**只由 diff 钉住**。

★ 这是本队最忌的形态：读起来合理、而事实是反的，**还写在守门臂的注释里**。

**I2-f（新增，必做）**：补一条臂钉住地板的输入，并更正那句注释。
- 输入须满足：`dropped > 0` ∧ `scored < 20` ∧ `scored + uncovered ≥ 20` ∧ **`scored.length > 0`**
  （最后一条是关键：否则又掉进 `:1237` 早返回，照样测不到地板）
- 断言判据给 **unmeasured**（不是 blocked、不是 0 分裁决）
- 会红性：地板改读 `scored + uncovered` ⇒ 红；地板整段删掉 ⇒ 红
- 注释删掉那半句，或改成事实（「臂 10 钉的是 scoreMutants 的过滤器」）

★ 该工作**只能在集成分支上做**：t13 工作树的成果不在基线里，契约闸实测
  主树 `grep '臂 10' scripts/gate-mutation-cap.test.mjs` 命中 **0**，
  所以针对 t13 工作树建的任务过不了闸（两次尝试都被拒，闸的判读是对的）。

## 4. 主线 S2：账本接入生产路径（不变）

前置：I2-d 完成。事实来源 = t3 工作树。
- `src/gates/completion/mutation.ts`：门禁交出 `mutationLedger`（t3:269、272）
- `src/tools/update-task/completion.ts`：接收 `context.mutationLedger`，无则自建，结束回传同一份（t3:330、639、727）

验收（**不是**静态 grep）：
```
node --test scripts/gate-mutation-cap.test.mjs
```
外加新臂：同一变异体第二次 completion ⇒ `reused` 且该次 `runTest` 调用数为 **0**。

## 5. 客户端两处（P1 / P2）

### P1 状态点（t18 已实现，形状见 §2 B3）

```
not-live + 名下有未完成任务  ⇒ stalled
not-live + 名下无未完成任务  ⇒ idle
never-spawned               ⇒ dormant
working                     ⇒ running
```
判据用**任务板**，不用 `member.status`（`src/members.ts:944` 记着它会残留）。
最小改法（t16 实测，零新增 import）：`MemberRow.tsx:84-89` 给 context 加
`readonly tasks?: readonly ActivityTask[]`（`ActivityTask` 已在 `:47` 导入）；
`:256` 传 `tasks`；`:109` 换三态读。

### P2 时钟 `done` 态

```
有在飞 + 在跑   ⇒ running
有在飞 + 没在跑 ⇒ stale
无任何任务      ⇒ idle      ★ 与 done 不同形
刚干完活        ⇒ done      ★ 新增
读不出戳        ⇒ unknown
```

★ **三处必须一起改，否则编译失败或静默错文案**（t16 实测）：
- `MemberRow.tsx:190` `Record<MemberClockKind, ...>` ⇒ 缺键 **TS2741 编译失败**（这是好事）
- `MemberClock.tsx:76-83` `memberClockText` 是**非穷尽三元链**，末支落 `running` 文案 ⇒
  **编译通过但把 `done` 印成「已工作 N」**。★ 这条不报错，比上面那条更该防。
- `locales.ts` 两册

★ `done` 不每秒重渲染**成立**：`MemberRow.tsx:339` 不传 `active` ⇒ 落 `memberClockTicks(kind)` ⇒ `false`。

**不做「总耗时」**：「开工时刻」不在 `/state` 上（`ActivityTask` 只有一个 `updatedAt`）。

## 6. ★ 提交纪律（v2 漏掉的一环）

t17 与 t18 的成果**全部躺在未提交的工作区里**（t13 5 文件、t18 16 文件，t18 HEAD 仍是 `2ecd498`）。

⇒ 每一张实现任务完成时**必须提交到它自己的工作树**，否则：
- I1 从 `2ecd498` 切集成分支会**漏掉这两份工作**
- 工作区改动不属于任何提交 ⇒ 无法 cherry-pick、无法对比、无法回滚

## 7. 阶段表

| 阶段 | 动作 | 通过条件 |
| --- | --- | --- |
| 0 | 已完成的裁定 A/B（t17）、客户端两处（t18）**各自提交** | 两棵树 `git status --short` 为空 |
| 1 | I1 从 t7 切集成分支 | 分支存在且 `pnpm build` 绿 |
| 2 | I2-a..e 逐项移植，每项一个提交 | 每项：`pnpm build` 绿 + 臂集合不减 + 继承臂全绿 |
| 3 | §4 账本接线 | 上述两条验收 |
| 4 | 三方进 `main`，合并前后同一条命令各跑一次 | 新增失败为空 |
| 5 | 刷新 GUI，人工看读数 | 状态点灰色；时钟显示 `done` |

## 8. 我不做的

- 不降 `DEFAULT_MAX_MUTANTS`（仍 40）
- 不加 L3；不改开火时机
- 不动 `mutation-quality` 已收口的 T1–T8
- 不自动合并进 `main`
- P2 不做「总耗时」
- **不再用「合提交」的方式合这五棵树**（§3 已证不可执行）

## 9. 验收命令汇总

```
pnpm build
node --test scripts/gate-mutation-cap.test.mjs
node --test scripts/workspace-activity.test.mjs
node --test scripts/gate-position-wiring.test.mjs
node --test scripts/verify-unmeasured-consumers.test.mjs
```
