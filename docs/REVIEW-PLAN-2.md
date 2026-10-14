# 审查2 · 视觉与读数设计（对 `docs/REFACTOR-PLAN.md` §3-A / §3-B）

**审查对象**：`docs/REFACTOR-PLAN.md`（281 行，队长）的 **§3-A 读数出口** 与 **§3-B 视觉重构**。
**审查面**：只审**设计是否成立**（不审依赖、不审过设计 —— 另有审查者）。
**方法**：全部回源复跑，**不复用计划作者的脚本**。
**基线**：`agent-teams-dev` @ HEAD `b8f357e`（工作树含本轮其他线的产物）。

---

## 判决

# verdict = **needs_revision**（2 条 blocker：F-2 / F-6）

**为什么不是 pass**：两条 blocker，各自独立成立 ——

1. **F-2（设计漏洞）**：计划一边把"`⊘` 与 `✓` 必须不同形"写成风险条目（`:155`），
   一边**没有任何一格说明 `skippedAll` 落在哪**。而 §3-B 的展开规则（"只展开活跃 + 异常"）
   对 `skippedAll` 的**三种可能处置没有一种是对的**（详见 F-2 表）：
   按 `ok===true` 判 ⇒ **折叠**；按 `ok===false` 判 ⇒ **与真异常合流**（`registry.ts:980-982` 逐字禁止）；
   规则里不提 ⇒ 取决于实现者。⇒ **`skippedAll` 是位置级事实，而规则是判据级的，它必然无处安放。**
2. **F-6（前提事实错误）**：B4 的根因陈述（"成员颜色借自当前任务"）**回源一读就不成立** ——
   `memberDotTone` 只读 `liveness`/`activity`，全文不引用任何 task tone。⇒ B4 按现描述实现会**空转**，
   而且会改坏 t4 修好的行为。

**为什么不是 reject**：设计骨架（一张图 / 四符号 / 固定画布 / 帧合成为先）**方向是对的**，
且 §3-A 的"只送聚合 + 异常"在**载荷上成立**（F-4 的问题是数字写错，不是方向错；
§3-A 唯一的结构问题是 F-8 的写域重叠，属可拆解）。
⇒ 可修，不需要推翻。**9 条 finding 里没有一条要求放弃这个设计。**

---

## 0. 覆盖面（判 pass 必须附；此处附在 needs_revision 上，作用相同）

**我实际读了、跑了什么**：

| # | 覆盖对象 | 方式 | 结果 |
|---|---|---|---|
| 1 | `docs/REFACTOR-PLAN.md` §3-A / §3-B / §1 / §5 / §6 | 全文通读 281 行 | ✅ |
| 2 | `src/gates/registry.ts:140-230`（三态纪律原文） | 逐行读 | ✅ 逐字复核，见 §1 |
| 3 | `src/gates/registry.ts:880-1010`（`skippedAll` 产出点） | 逐行读 + grep | ✅ 4 处产出，见 F-2 |
| 4 | `src/gates/registry.ts:119-142`（`GateRunEntry` 全字段） | 逐行读 | ✅ 见 F-4 |
| 5 | `src/gates/registry.ts:296-330`（`GateVerdict` 三态 + `unmeasuredDisposition`） | 逐行读 | ✅ 见 §1 |
| 6 | 六个插入点的**真实判据条数** | `grep '^export const point'` × 6 | ✅ 见 F-4 |
| 7 | `src/tools/status.ts:640-760`（`/state` 实际送什么） | 读 | ✅ 见 F-4/F-6 |
| 8 | `src/client/activity-monitor.ts`（client 收到的字段） | grep + 读 | ✅ **零判据字段**，见 F-6 |
| 9 | `src/client/MemberRow.tsx:60-116, 300-330`（成员颜色的真实来源） | 逐行读 | ✅ **推翻 B4 前提**，见 F-5 |
| 10 | `tsdown.config.ts:22-110`（externals / purity gate 全文） | 逐行读 | ✅ 见 F-7 |
| 11 | 依赖树里是否有 CJK 宽度库 | 8 个候选名逐个 `ls node_modules/` | ✅ **全部 NOT PRESENT**，见 F-7 |
| 12 | `package.json` 全部 deps | 读 | ✅ **`dependencies` 键不存在**（`devDependencies` 35 个） |
| 13 | `src/client/panel-geometry.ts`（是否已有内容尺寸逻辑） | grep | ✅ 无行数估算 |
| 14 | `src/client/ActivityPanel.module.css` 的截断手段 | grep | ✅ 53 处 ellipsis/nowrap |
| 15 | `scripts/workspace-activity.test.mjs` F8 的 5 个行号 | 逐个 `sed -n` | ✅ 全部命中 |

**我没有覆盖的（如实列出）**：
- **未跑真实 `/state` 载荷** —— 所有载荷数字是**读注册表 + 数 module 导出**算出来的，不是实测（与计划作者 R2 同一限制，见 F-4 末尾）。
- **未渲染 SVG 样张** —— B1 尚未产出，我审的是**文字描述的设计**。
- **未测 CJK 渲染** —— 浏览器里的实际宽度我未测量（F-7 判的是**依赖可用性**，不是渲染结果）。
- **未审 C/D/E/F/G 线**（不在本任务面内）。

---

## 1. ★ 专答问题 1：四符号 `✓ ⊘ ● ✗` 真能防住合流吗？

### 结论：**符号本身不够；但问题不是符号，是「四符号映射到了五到六个状态」。**

**先复核计划引用的纪律原文**（`src/gates/registry.ts:191-198`，我逐字读）：

> `registered === 0`（空位置）与 `registered > 0 && evaluated === 0`（全跳过）
> **必须【不同形】** —— 前者是"这里还没有判据"，后者是"有判据却一条没跑"。
> 把这两件事混起来，一次静默全跳过就会伪装成"这个位置本来就没判据"。

并 `:163-166`：
> `unmeasured` —— 判据【跑了】，但它说"我测不了"。这是关于**测量**的结论。
> `evaluated:0` —— 判据【根本没跑】。这是关于**这一步有没有被检查**的结论。

⇒ **纪律要求区分的是 5 个格子**（空位置 / 全跳过 / 跑了说测不了 / 跑了有问题 / 跑了没问题），
而 §3-B 给的是 **4 个符号**。这才是真问题 —— 不是"`⊘` 长得像不像 `✓`"。

### F-1【high】四符号覆盖不了 `GateRunEntry` 的真实状态数

**问题**：`GateRunEntry.verdict` 是四值（`src/gates/registry.ts:121`）：
```ts
verdict: 'ok' | 'blocked' | 'unmeasured' | 'skipped'
```
而**在它之上**还有两个正交维度：

| 维度 | 取值 | 出处 |
|---|---|---|
| `entry.observed?: boolean` | 「开火了、但被观察模式放过」 | `registry.ts:140`（`:124-139` 长注释逐字论证"必须有第三个字段"） |
| `Evaluation.skippedAll?: string` | 「有判据、却一条都没跑」 | `registry.ts:205` |
| `Evaluation.observedBlockers?: number` | 「这一轮有几条开火了而被放过」 | `registry.ts:221` |
| `verdict.count / produced` | 判据自报的计数与产出 | `registry.ts:122-123` |

⇒ **`observed` 那一格是 `registry.ts:124-139` 明确要求"不能只靠 `verdict` 表示"的**：
> 只读 verdict 的调用方会以为流程被拒了，只读 ok 的调用方会以为这条判据温和。

计划的两处设计分别撞在这上面：
- `:129` 的样张把 `completion ●○○○` 当成"四格"来画（即把 `skipped` 画成 `○`），
  但**没有 `observed` 的符号** ⇒ **一个"开火了但被放过"的判据会被画成 `✗`（看起来被拒）或 `✓`（看起来温和）**，两者都错。
- `:112` 的验收只写"`skipped` 与 `ok` 必须不同形" ⇒ **只钉住了 4 个状态里的 2 个**，
  `observed` / `skippedAll` / `unmeasured` **都没有验收臂**。

**必须怎么修**：
1. 把 A2 的验收从"2 态不同形"扩到**全状态两两不同形**（至少 5 态：`ok` / `blocked` / `unmeasured` / `skipped` / `observed-blocked`）。
   给出一个**状态 → 符号**的**满射表**，并断言**映射是单射**（每格唯一符号）。
2. `observed` 必须有自己的符号或结构位（例如符号不变但加下划线/底色，见 F-3 的"结构位"方案）。

**可复跑**：
```sh
sed -n '119,142p' src/gates/registry.ts      # verdict 四值 + observed 字段与它的长注释
sed -n '199,222p' src/gates/registry.ts      # skippedAll / observedBlockers
grep -c "'ok' | 'blocked' | 'unmeasured' | 'skipped'" src/gates/registry.ts   # ⇒ 1
```

### F-2【blocker】★ 专答问题 2：「只展开活跃 + 异常」**会折叠掉 `skippedAll`** —— 而且是最坏的那种折叠

**这是本次审查最重要的 finding。**

**计划的规则**（`:141`）：B3 把成员降级为流程行；`:129` 样张里只有两种行被展开
（`▶ completion.mutation 运行中`、`completion.r5 等待`）。§3-A（`:111`）把出口定义为
**聚合 + 活跃明细 + 异常明细**三类。

**`skippedAll` 是什么**（`registry.ts:203-205`，我逐字读）：
> 该位置【有判据、却一条都没跑】时的一句人话；其余情形缺席。
> 空位置【不产出】它 —— 那是正常情形，不是异常。

**⇒ 关键：`skippedAll` 不是 `verdict` 的一个值，它是 `Evaluation` 的一个字段。**
⇒ 一条判据的 `verdict` 可以是 `skipped`，但 **`skippedAll` 说的是"这个位置上一条都没跑"** ——
**它是位置级的事实，不是判据级的**。

**⇒ 于是"只展开活跃 + 异常"会把 `skippedAll` 判成哪一类？三者都不是：**

| 情形 | 是"活跃"吗 | 是"异常"吗 | ⇒ 折叠规则的后果 |
|---|---|---|---|
| 全跳过，`ok` 仍为 `true`（**旧行为**，见 `:155-157` 记录的那次实测） | ❌ 没有判据在跑 | ❌ **`ok:true`，不是异常** | **被折叠** |
| 全跳过，`ok` 已被 t58 修为 `false` + `skippedAll` 在场（`:174-178`） | ❌ | ⚠️ 取决于"异常"怎么定义 | **若"异常"= `ok===false`，则它会**膨胀成"所有全跳过的位置都是异常"**；若"异常"只看 `blockers.length>0`，则**仍被折叠** |

**⇒ `skippedAll` 的三种结局，没有一种是对的**：
1. 按 `ok===true` 判 → **被折叠**（重复本仓最贵的那个错）
2. 按 `ok===false` 判 → **与真异常合流**（`skippedAll` 与 `blockers` 混在一起，而 `registry.ts:980-982` 逐字要求三者不同形）：
   ```
   ok:false · blockers:[]               · skippedAll:在场  ← 这一步没被检查
   ok:false · blockers:[…]              · skippedAll:缺席  ← 判据说有问题
   ok:false · unmeasured:在场            · skippedAll:缺席  ← 判据说测不了
   ```
3. 完全没被规则提到 → **取决于实现者当天的选择**

**⇒ 这正是你担心的形态，且我可以指出它为什么必然发生**：
`skippedAll` 是**位置级**字段，而 §3-B 的展开规则是**判据级**的（"活跃的判据"）。
⇒ **一个位置级的"什么都没发生"，在一条判据级的展开规则里必然找不到位置。**

**★ 一个加重证据**：t58 的实测（`registry.ts:174-178` 逐字）说
`registered > 0 && evaluated === 0` 在真实注册表上曾意味着
**integration / verification / review 三类任务永远报 ok**（实测 `ok=true, evaluated=0, skipped=4, registered=4`）。
⇒ **这不是假想情形，它是本仓已经发生过一次的真实缺陷**，而 §3-B 的展开规则会让它在**新的展示层里再次消失**。

**必须怎么修**（给三条，任选但必须选一条并写进计划）：
1. **`skippedAll` 强制展开**：把展开规则从"活跃 + 异常"改成
   **"活跃 + 异常 + 未检查"**（三类），且**"未检查"优先级高于前两类** —— 理由：它是唯一"你不看就永远不会知道"的一类。
2. **聚合行必须可见**：六个插入点的聚合行里，**每个点除了计数还要有一个"未检查"标记**，
   例如 `completion ✓✓✓⊘  (4 条，全部跳过)`。⇒ 即使明细被折叠，**折叠本身也必须留痕**。
3. **禁止用 `ok` 作为"异常"的判据**：`异常 = blockers.length > 0 || unmeasured 在场 || skippedAll 在场`，
   三者**各自有符号**（对齐 `registry.ts:980-982` 的三种 `ok:false`）。

**可复跑**：
```sh
sed -n '199,206p' src/gates/registry.ts      # skippedAll 的定义与"空位置不产出它"
sed -n '880,900p' src/gates/registry.ts      # 三态三分表原文
sed -n '975,995p' src/gates/registry.ts      # ok:false 的三种成因逐字并列
grep -rn "skippedAll" src/ --include=*.ts | grep -v "^src/gates/registry.ts" | head
# ⇒ update-task.ts:1059,1075,1082,1098 —— 生产路径**已经在用**它做三态判定，
#   证明它是承重字段，不是调试信息
```

### F-3【high】★ 符号语义从未定义，且清单自相矛盾：`✗` 声明了却从不出现，`○` 出现了却从未声明

**问题（这是最容易被肉眼跳过、但一 grep 就实锤的一条）**：

| 事实 | 读数 |
|---|---|
| `:255` 声明的四符号 | `✓ ⊘ ● ✗`（**4 个**） |
| `:129-130` 样张实际用的符号 | `✓ ⊘ ● ○`（**4 个，但第三个本是 `✗`**） |
| **声明了却从不出现** | **`✗`** —— 全文只出现 **1 次**（就是 `:255` 自己那行） |
| **出现了却从未声明** | **`○`** —— 全文只出现 **1 次**（`:130` 样张里，用了 **4 个**） |
| 图例 / 符号说明 | **不存在**（`grep -n "图例\|legend\|符号说明"` ⇒ 无输出） |

```sh
$ grep -c "✗" docs/REFACTOR-PLAN.md   # ⇒ 1   （只在 :255 被声明）
$ grep -c "○" docs/REFACTOR-PLAN.md   # ⇒ 1   （只在 :130 被使用，那行里出现 4 次）
$ grep -n "图例\|legend\|符号说明" docs/REFACTOR-PLAN.md   # ⇒ 无输出
```

**⇒ 为什么这是 high 而不是"措辞不严谨"**：
`skipped` 的符号到底是 `⊘` 还是 `○`，**在这份计划里没有答案**。
`:129` 的 `dispatch ✓✓⊘` 用 `⊘` 表示跳过，而 `:130` 的 `completion ●○○○` 里
**同时**有 `●`（`:128` 语境里是"进行中"）与 3 个 `○`。
⇒ 一个实现者完全可能把 `○` 读成"跳过"，从而**把跳过画成一种"空"** ——
**而"空"与"没跑"正是 `registry.ts:194-197` 明令不许合流的那一对**（"空位置"vs"挂了判据却全跳过"）。

⇒ **"极简"的视觉约束下，符号表的歧义会被放大**：符号越少、越抽象，读者越依赖约定，
而**约定在这份计划里不存在**。

**必须怎么修**：
1. **补一张图例表**，一行一符号：`符号 | 语义 | 对应 registry 的哪个字段值 | 反例（它不能被读成什么）`。
2. **消除 `○` 与 `⊘` 的歧义**：二选一。我建议（按 F-2 的"结构位"方案）：
   `○` 留给"等待/未开始"（`pending` 类），`⊘` 专表"跳过（判据没跑）"，
   **且二者不共存于同一聚合行**，避免读者在窄格子里比较两个圈。
3. 让 `✗` 真的用上（`blocked`），或从符号表里删掉它。
4. **符号表要能机械核对**：加一条验收，断言样张里出现的符号集合 == 图例声明的符号集合
   （★ 这一条现在是**红的**：`{✓,⊘,●,○}` vs 声明 `{✓,⊘,●,✗}`）。

**可复跑**：
```sh
grep -c "✗" docs/REFACTOR-PLAN.md     # ⇒ 1
grep -c "○" docs/REFACTOR-PLAN.md     # ⇒ 1
grep -n "图例\|legend\|符号说明" docs/REFACTOR-PLAN.md   # ⇒ 无输出
sed -n '127,135p;255p' docs/REFACTOR-PLAN.md            # 样张 vs 声明逐字对照
```

### F-3b【medium】即使符号定义清楚，字形区分度也不够，需要正交「结构位」

**问题**：`⊘`（U+2298 CIRCLED DIVISION SLASH）与 `✓` 的**字面区分度**在中文界面 + 小字号下并不稳：
- 两者都是"圈/勾"类小字形，视觉重量接近；
- `●` 与 `○` 只差填充（样张 `:129-130` 正是这么用的）；
- **F-7 要引入的 CJK 宽度问题会让符号所在列宽变化**，进一步压缩区分余量。

⇒ **仅靠字形兜不住"不许合流"这条纪律** —— 因为纪律要的是**读者不会读错**，不是"字形不同"。

**必须怎么修**：给符号加**正交的结构位**（至少一条）：
- **位置**：`skipped` 不占位（列宽塌缩）vs `ok` 占位 ⇒ 见 F-2 的"分类"
- **字重/底色**：`observed` 用同符号 + 底纹（它"开火了"这件事必须可见）
- **固定列宽**：四符号占同一列宽（对齐），但 `⊘` 与 `✗` 走**不同底色 token**（`--dsw-alias-state-warn-*` vs `-error-*`）

**并且**：A2 的验收臂必须**断言结构差异，而不是断言字形** —— 例如
"造一条 `skippedAll` 记录，断言它渲染出的**行数/占位数/底色 token** 与全 `ok` 不同"。
（对照本仓已有的做法：`workspace-activity.test.mjs:1231` 那类断言就是"读一个块的文本再断言"，形态是现成的。）

**可复跑**：
```sh
grep -n "⊘\|●\|○\|✓\|✗" docs/REFACTOR-PLAN.md    # 符号的定义处 :129-130, :155, :255
grep -rn "data-tone" src/client/MemberRow.tsx     # 本仓已有的"用 data 属性承载语义"先例
```

---

## 2. 专答问题 3：固定画布 vs 内容超长

### F-4【high】载荷估算不成立：「每任务 ≤3 条」与注册表实测不符

**计划原文**（`:111`）：
> 载荷实测：每任务 **≤ 3** + 异常数；**不送全量 17 条**

**实测（我数的，按 `export const point` 归组）**：

| 插入点 | 注册判据数 | 判据 id |
|---|---:|---|
| `admission` | **3** | `admission.absorb` / `.checkpoint` / `.convene`（★ 均**未注册**，见下） |
| `contract` | **3** | `contract.build-artifact-scope` / `.verify-command` / `.task-atomicity` |
| `dispatch` | **3** | `dispatch.changed-paths` / `.worktree` / `.plan-reviewed` |
| `completion` | **4** | `completion.backtest` / `.mutation` / `.r5` / `.verify-rerun` |
| `delivery` | **2** | `delivery.coverage` / `.convergence` |
| `runtime` | **2** | `runtime.liveness` / `.stall` |
| 磁盘合计 | **17** | （与 F2 的"17 个模块"一致） |
| **实际注册（`ALL_GATES`）** | **14** | 减去 `admission.*` 三条 |

⇒ **`completion` 一个点就有 4 条**，而 `:111` 说"每任务 ≤3"。
⇒ 一个任务至少触及 `contract` + `dispatch` + `completion` 三点 = **3+3+4 = 10 条**，
若含 `delivery` = **12 条**。**"≤3 条"只有把"每任务"读成"每个插入点"才勉强对，而 `completion` 仍是 4。**

**⇒ 但方向是对的**（这不影响 verdict）：
- 送**聚合 + 异常**而不是全量，这个判断**成立** —— 因为**正常情况下 `skipped` 占多数**，
  而"异常"在设计上本就是少数（对照 `docs/GATE-EFFICACY.md` 的 `self 378 / escalate 6` 量级）。
- 真正要修的是**把"≤3"换成一个可核的上界**：**每任务 ≤ 12 条异常**（10 + delivery 2，若 admission 也接上则 15）。

**必须怎么修**：
1. 把 `:111` 的"≤3 条/任务"改成**准确的两种口径**：
   - **活跃明细**：≤ 同时开火的判据数（实测上限 **4**，`completion` 点）
   - **异常明细**：≤ 该任务触及的注册判据总数（实测上限 **10–12**）
2. 给 B1 的 SVG 样张加一个**最坏情形样张**（一个任务 10 条异常）——
   现在的样张（`:129-133`）只有 4+2 个符号，**远低于最坏情形**，无法验证固定画布够不够高。
3. ★ **计划自己已经诚实标了 R2（`:244`）说"载荷估算未经实测"** —— 我同意，
   且现在可以给出**静态上界**（上表），不必等实测就能修这一条。**实测应留给"异常在真实数据里的分布"**。

**可复跑**：
```sh
grep -rh "^export const point = " src/gates/*/[a-z]*.ts | sort | uniq -c   # ⇒ 4/3/3/3/2/2
grep -rh "^export const id = " src/gates/*/[a-z]*.ts | wc -l                # ⇒ 17
sed -n '/^const ALL_GATES = \[/,/^\] as const/p' src/gates/index.ts | grep -cE '^  [a-zA-Z0-9]+,$'  # ⇒ 14
```

### F-5【high】固定高度未定义 + CJK 宽度会让"预估行数"失准（三条落点，计划一条都没给）

**计划原文**（`:149`）：「**预留固定高度**」。——**但没给任何数字或算法**。

**实测现状**：
```sh
grep -n "estimateRow\|lineCount\|precompute.*row\|wrap-ansi" src/client/ | head    # ⇒ 空
grep -n "height\|measure" src/client/panel-geometry.ts                            # ⇒ 有 heightMode，但无内容行数
```
⇒ client **完全没有**行数估算逻辑；`panel-geometry.ts` 只管**窗口**几何（`heightMode: 'auto' | 'manual'`），不管**内容**高度。

**三条具体落点**：
1. **固定高度定多少？** 从 F-4 的上界推：一个插入点一格 `4` 符号（`completion` 最宽），
   六个点 = 6 行符号区；再加活跃 4 行 + 异常最多 10 行 ⇒ **最多 20 行**。
   若固定画布只留 8 行（样张 `:128-134` 的量级），**最坏情形溢出 2.5 倍**。
2. **超长时省略什么？** 计划 `:156` 只说"需要省略策略（Ink 也是这么做的）"。
   而本仓**已有**的省略手段是 **53 处** `text-overflow/nowrap`（CSS 层），
   ⇒ 但固定画布要的是**行级省略**（`+3 条未显示`），**CSS 给不了**，必须在**帧合成**里算。
   ⇒ **这正是 `:148`"帧合成而非元素堆叠"唯一真正承重的地方**，而计划没有把它和省略策略接起来。
3. **★ 中文双宽会不会让预估失准 —— 会，而且这里是唯一会"错得看不出来"的地方。**
   - `docs/UI-DISSECTION.md`（我上一份）实测 client **未处理 CJK 宽度**（计划 F9 `:29` 引用正确）；
   - 固定画布要求"**先算行数再渲染**"（`:148`）⇒ 算错 = 画布高度与内容不匹配 = 用户看到的正是"截断"；
   - **中文判据描述**（例如 `:132` `completion.mutation 运行中 · 变异 8/14`）里
     `运行中` 是**双宽**，`8/14` 是**单宽** ⇒ 同一行混排，按 `length` 估必然偏小；
   - ⇒ 而失败形态是**"看起来合理的错数字"**（少算 1 行 → 最后一行被裁），
     **不报错**。这与本队反复记账的那种错误同族。

**必须怎么修**：
1. **给出固定高度的数字与它的推导**（按 F-4 的上界，不是按样张）。
2. **省略策略写进 A 线**：`/state` 就该送"总数 + 前 N 条"，而不是送全量让 client 截 ——
   因为**client 一旦要截，它就得先能算行数**，而算行数需要宽度库（F-7）。
   ⇒ **把"截断"的责任放在服务端**（它知道条数，不需要知道像素），
     client 只负责"渲染 N 行 + 一行 `+k 未显示`"。
3. **CJK 宽度必须在同一处解决**：见 F-7 的两条可选路径（都不引入新依赖）。

**可复跑**：
```sh
grep -rn "estimateRow\|lineCount\|wrap-ansi" src/client/ | wc -l        # ⇒ 0
grep -c "text-overflow\|nowrap" src/client/ActivityPanel.module.css     # ⇒ 53（已有手段是 CSS 层的）
sed -n '145,157p' docs/REFACTOR-PLAN.md                                  # "预留固定高度"无数字
```

---

## 3. 另外三条（B4 / B5 / 载荷）

### F-6【blocker】B4 的前提是错的：成员颜色**不是**借自当前任务

**计划原文**（`:142`）：
> B4 | 状态**挂到任务上**而不是成员上（你说的"成员集体变红"的根因：**成员颜色借自当前任务**）

**实测（我逐行读了 `memberDotTone` 全函数）**：`src/client/MemberRow.tsx:103-116`

```ts
export function memberDotTone(member: MemberRowMember, context: MemberDotContext): MemberDotTone {
  if (context.discarded === true || context.staged === true) return 'dormant'
  if (context.stopped === true || context.historic === true) return 'idle'
  const liveness = member.liveness
  if (liveness !== undefined && liveness !== '') {
    if (liveness === 'working') return 'running'
    if (liveness === 'not-live') return 'stalled'
    if (liveness === 'never-spawned') return 'dormant'
    return 'idle'
  }
  if (member.activity === 'working') return 'running'
  return member.activity === 'idle' ? 'idle' : 'dormant'
}
```

⇒ **它的两个参数里没有 task 对象**：`MemberRowMember`（`:75` = `ActivityMember & {...}`）与
`MemberDotContext`（`:84-89` = `discarded/stopped/staged/historic` 四个布尔）。
⇒ **`MemberRow.tsx` 全文不引用 `taskTerminalTone` / `taskTone`**：
```sh
grep -n "taskTerminalTone\|taskTone" src/client/MemberRow.tsx   # ⇒ 无输出
```

**★ 但要给计划一个公道（这一层区分很重要）**：`ActivityMember` **确实**带一个 `currentTask: string`
（`src/client/activity-monitor.ts:95`）与 `progress/done/total`（`:96-98`）。
⇒ 所以"颜色可能和当前任务有关"**不是凭空来的** —— 它有一个真实的表面。
**然而：** `memberDotTone` **一个都不读**（我逐行核过 `:103-116`，无 `currentTask` / `progress` / `done` / `total`）。
`MemberRow.tsx` 里 `currentTask` 只出现在**两处**，都与颜色无关：
`:249` 是 `owned.find(task => task.id === member.currentTask)`（取**当前那个任务对象**给后续文案用），
`:150` 是一句注释。

⇒ 成员颜色的真实来源是 **`liveness` 优先、`activity` 兜底**（`:94-101` 的注释逐字论证过这个顺序，
理由是"`activity` 是持久字段，会话死了它仍说 `working`"）。
**这是 t4 刻意修好的行为**，与任务无关。

**⇒ 这条 finding 的意义**（比"前提写错"更重）：
1. **B4 作为一个动作是空转的** —— 它要"把状态从成员移到任务"，而**状态从来不在任务上**。
   按现描述实现，只会把 `liveness` 的读数**改坏**（t4 修的那个"死成员永远绿/红"会回来）。
2. **"成员集体变红"的真因没被定位**。既然颜色来自 `liveness`，那么"集体变红/变同一个颜色"
   的候选解释只能是：**`liveness` 字段在那一批成员上同时取到了同一个值**（例如都 `not-live` ⇒ 都 `stalled`=琥珀），
   或 `liveness` 缺席时都落进 `activity` 的同一个分支。
   ⇒ **这需要一次真实读数才能定，不能靠推测** —— 而我**没有**那条读数。
   ★ 补充一条 `liveness` 的**语义边界**（`MemberRow.tsx:106-112` 的取值分支即为全部已知取值）：
   `working` ⇒ running；`not-live` ⇒ stalled（琥珀）；`never-spawned` ⇒ dormant；
   **其余任何值（含 `idle`、`could-not-measure`）都落进 `idle`**。
   ⇒ 注意最后那一支：**"活着但不驱动"与"测不出来"在这里是同一个颜色** ——
   这是本仓三态纪律在**颜色层**的一个既有合流点（`registry.ts:163-166` 要求"测不了"与"没跑"不同形，
   而这里 `could-not-measure` 与 `idle` 同形）。★ **这不是本次要修的缺陷**（它在 B4 范围外），
   但若 B4 真要动成员颜色，**这一格必须一起考虑**，否则会修出一个新的合流。
3. **⇒ 我的建议**：**B4 退回"未判定"**，先补一条读数（取一次真实 `/state`，看那批成员的 `liveness`/`activity` 实际取值），
   **再定这一格怎么改**。若不补，B4 会以"修了一个没坏的机制"收场。
   ★ 形态提醒：这正是本队刚花三轮修正的那类 —— **一个看着合理的归因（"颜色借自任务"）被写进计划，而回源一读就不成立**。

**可复跑**：
```sh
sed -n '103,116p' src/client/MemberRow.tsx       # memberDotTone 全文，无 task 参与
sed -n '70,89p'   src/client/MemberRow.tsx       # 两个参数的真实形状
grep -n "taskTerminalTone\|taskTone" src/client/MemberRow.tsx   # ⇒ 空
grep -rn "memberDotTone" src/client/ | head       # ⇒ 定义 + MemberRow.tsx:256 的调用
```

### F-7【high（判定修正）】B5 引库**不违反** externals 约束 —— 计划担心的风险不存在，但**有真实的代价**

**计划原文**（`:150`）：「Ink 专门用 `get-east-asian-width` + `bidi-js` + `emoji-regex`」，
`:143` B5「CJK 宽度处理（F9）」。

**实测 `tsdown.config.ts:22-110`**：

| 机制 | 内容 | 对 B5 的含义 |
|---|---|---|
| `CLIENT_EXTERNALS`（`:33`） | 只有 7 个平台模块（react / react-dom / cordis / 4 个 dsh-client-*） | **`get-east-asian-width` 不在其中** |
| `deps.alwaysBundle`（`:69`） | `(id) => !CLIENT_EXTERNALS.includes(id)` | ⇒ 非 externals 的包**会被打进产物** |
| **purity gate**（`:78-91`） | `if (!source.startsWith('@deepseek-ai/')) return null` | ★ **它只检查 `@deepseek-ai/*` 的 import** |

⇒ **结论**：引入 `get-east-asian-width`（一个非 `@deepseek-ai` 的 npm 包）
**不会触发 purity gate**，会被正常 bundle 进 `lib/client.js`。
**⇒ 计划在 §3-B `:150` 隐含担心的"违反 externals 约束"这件事，实测不成立。**

**但真实的代价是三条（这才是要写进计划的）**：
1. **`package.json` 里根本没有 `dependencies` 键**（实测 `'dependencies' in d` ⇒ `False`；只有 35 个 `devDependencies`）⇒ 这不是"空数组"，是**该字段从未声明**，
   而三个候选库**全部不在依赖树里**（`ls node_modules/<name>` ⇒ 8 个候选全 NOT PRESENT）。
   ⇒ 引入 = **新增一个运行时依赖** + `package-lock.json` 变更 + 打包体积增加。
2. **体积进的是 client bundle**（`lib/client.js`，用户要下载的那一份）——
   对"极简"目标是一次**反向**的取舍，必须显式记账。
3. **`get-east-asian-width` 只解决"宽度"**，不解决 `:150` 一并提到的 `bidi-js` / `emoji-regex`
   ⇒ 若要全覆盖是**三个依赖**。

**⇒ 我建议的替代方案（零新依赖，且与 F-5 的修法同向）**：
- **把截断责任移到服务端**（F-5 第 2 条）：服务端按**条数**截（它不需要知道像素），
  client 只渲染"N 条 + `+k 未显示`" ⇒ **完全不需要预估行数** ⇒ **宽度库的需求消失**。
- 若仍要在 client 侧算宽度，**最小实现**是一个**内联常量表**
  （CJK 区间 + 半宽标点的几个 `[start,end]` 段 + `charCodeAt` 判断，约 20 行），
  与 `MemberRow.tsx:123-141` 已有的 `stableHash` / `accentOf` 同风格 ⇒ **不引依赖**。
  ★ 但这条要**先验证**：内联表是否够准（我未测中文渲染，见 §0 覆盖面的"未覆盖"）。

**可复跑**：
```sh
sed -n '22,42p' tsdown.config.ts            # EXTERNALS 只有 7 个 + INLINE_SAFE/VENDORED_LIBRARY
sed -n '65,95p' tsdown.config.ts            # alwaysBundle 与 purity gate 的 startsWith('@deepseek-ai/')
for p in get-east-asian-width string-width wrap-ansi emoji-regex bidi-js; do ls node_modules/$p 2>&1 | tail -1; done
python3 -c "import json;d=json.load(open('package.json'));print('dependencies' in d)"   # ⇒ False（键不存在）
```

### F-8【medium】§3-A 的出口设计漏了 client **今天根本收不到判据数据**这件事

**计划原文**（`:111`）：A1 让 `/state` 增加判据视图。**方向对，但有两个前提没写**：

1. **F4 说的"只送 `runtime_gates` 一格"** 我复核了 `src/tools/status.ts`：
   `:743` 是 `...runtimeRecord === undefined ? {} : { runtime_gates: runtimeRecord }`
   ⇒ 确实只有 runtime 那一格，**其余五个插入点的裁决不出现在 `/state` 里**。
2. **client 侧零消费**：`grep -rn "runtime_gates\|gate" src/client/activity-monitor.ts` ⇒
   只命中 `:42` 一句**注释**（"the gate did its job"）。`ActivityTask` 接口（`:101-122`）
   里**没有任何判据字段**。
   ⇒ **A1 不是"把已有的数据接出来"，而是"新增一整条 wire 字段 + client 的解析层"。**

**⇒ 为什么这是 finding 而不是备注**：计划把 A 写成"服务端线，可与 P0 并行"（`:76`），
但**B 依赖 A**（`:77`），而 A 的 client 半边**落在 `src/client/`** ——
即 **A 线会碰 client，而 B 线也碰 client**。⇒ `:247` 的 R5（"并行线的写域可能重叠"）
**只提了 `ui-refactor` 同时做 P0+E，没有提 A 与 B 在 client 上重叠**。

**必须怎么修**：把 A 拆成 **A-服务端**（`/state` 新增字段）与 **A-client**（解析 + 四符号纪律），
并把 A-client 并入 B 的写域（同一个人做，避免 R5 的形态）。

**可复跑**：
```sh
sed -n '740,746p' src/tools/status.ts                       # runtime_gates 那一格
grep -n "runtime_gates\|gate" src/client/activity-monitor.ts # ⇒ 仅 :42 注释
sed -n '101,122p' src/client/activity-monitor.ts             # ActivityTask：无判据字段
grep -n "A-服务端\|读数列" docs/REFACTOR-PLAN.md              # ⇒ 无（计划未拆）
```

---

## 4. Finding 汇总

| id | severity | 位置 | 一句话 |
|---|---|---|---|
| **F-2** | **blocker** | `REFACTOR-PLAN.md:111,129,141` vs `registry.ts:203-205,880-900` | 「只展开活跃+异常」会**折叠掉 `skippedAll`** —— 位置级事实在判据级规则里没有位置 ⇒ 重复本仓最贵的错 |
| **F-6** | **blocker** | `REFACTOR-PLAN.md:142` vs `MemberRow.tsx:103-116` | B4 前提**事实错误**：成员颜色来自 `liveness`/`activity`，**与任务无关**（全文不引用 `taskTone`）⇒ B4 空转，且真因未定位 |
| **F-7** | **high（判定修正）** | `REFACTOR-PLAN.md:150` | §3-B 把"引入宽度库会违反 externals"当成隐含约束/风险 —— **实测不成立**：purity gate 只查 `@deepseek-ai/*`，非该 scope 的包会被正常打包。⇒ 风险写错了方向（真代价是新增依赖 + 体积） |
| **F-1** | high | `REFACTOR-PLAN.md:112,129` vs `registry.ts:119-142` | 四符号映射不到真实状态数（≥5，含 `observed`）；验收只钉 2 态 |
| **F-3** | high | `REFACTOR-PLAN.md:130,255` | ★ **符号语义从未定义（无图例）且清单自相矛盾**：`✗` 声明了从不出现（1 次）、`○` 出现了从未声明（1 次），`○`/`⊘` 跳过语义歧义 |
| **F-4** | high | `REFACTOR-PLAN.md:111` vs `src/gates/*` | "每任务 ≤3 条"与实测不符（`completion` 单点 4 条；一个任务 10–12 条） |
| **F-5** | high | `REFACTOR-PLAN.md:149,156` | 固定高度无数字/无算法；行级省略未设计；CJK 双宽必然使预估失准 |
| **F-3b** | medium | `REFACTOR-PLAN.md:129-130,255` | 字形区分度不够，需正交"结构位"；验收应断言结构而非字形 |
| **F-8** | medium | `REFACTOR-PLAN.md:76-77,247` | A 的 client 半边与 B 写域重叠，R5 未覆盖；且 client 今天零判据字段（新增而非接线） |

**计数**：**9 条 finding**（F-1/F-2/F-3/F-3b/F-4/F-5/F-6/F-7/F-8）= **2 blocker / 5 high / 2 medium**
—— **满足"至少 5 条实质 finding"**。

★ 另外，verdict 的判定依据是 **F-2 与 F-6 两条 blocker**：前者是设计的**可证伪漏洞**（会折叠 `skippedAll`），
后者是**前提事实错误**（B4 空转）。F-7 是**方向修正**（把"有风险"改成"风险不在此处"），不构成 blocker。

---

## 5. 三个必答问题的直接回答（一页版）

**Q1 · 四符号真能防住 `skipped` 伪装成 `ok` 吗？**
**不能，而且有两层问题。**
**第一层（F-3，一 grep 就实锤）**：这份计划**没有图例**，符号语义从未定义；
且清单自相矛盾 —— `✗` 声明了却从不出现（全文 1 次，就是声明那行），
`○` 出现了却从未声明（`:130` 那行里用了 4 次）。⇒ **`skipped` 到底画成 `⊘` 还是 `○`，计划里没有答案**，
而"空"与"没跑"正是 `registry.ts:194-197` 明令不许合流的那一对。
**第二层（F-1）**：符号数 < 状态数 —— `GateRunEntry.verdict` 四值之外还有
`observed`（`registry.ts:124-139` 明确要求独立表达）、`skippedAll`、`observedBlockers`。
⇒ 必须给**状态 → 符号的满射表**并把验收扩到**全状态两两不同形**（现在只钉了 `skipped` vs `ok`）。
且**字形不够**，需要正交结构位（位置/底色/占位，见 F-3b）。

**Q2 · 「只展开活跃 + 异常」会漏掉 `skippedAll` 吗？**
★★ **会 —— 而且这是我判定 needs_revision 的主因。**
`skippedAll` 是**位置级**字段（`:203-205`「该位置有判据、却一条都没跑」），
而展开规则是**判据级**的 ⇒ **它在规则里没有位置**。
三种可能处置**都不是对的**：按 `ok===true` 判会**折叠**（重复本仓最贵的错）；
按 `ok===false` 判会**与真异常/测不了合流**（`registry.ts:980-982` 逐字禁止）；
没写就**取决于实现者**。
t58 的实测（`registry.ts:174-178`）证明这**不是假想**：integration/verification/review 三类任务
**曾经永远报 ok**（`ok=true, evaluated=0, skipped=4, registered=4`）。
⇒ **修法**：展开规则改三类（活跃 + 异常 + **未检查**），且聚合行上必须有"未检查"标记 —— **折叠本身要留痕**。

**Q3 · 固定画布 vs 内容超长怎么解？**
三条一起修：
1. **固定高度必须给数字**，且按**最坏情形**（F-4：单点 4 符号 × 6 点 + 活跃 4 + 异常 ≤10 ≈ **20 行**），
   不是按样张的 6 行。
2. **截断责任放服务端**：`/state` 送"总数 + 前 N 条"，client 渲染"N 条 + `+k 未显示`"。
   ⇒ 这是唯一能同时解掉 F-5（行数估算）与 F-7（宽度库依赖）的方案。
3. **CJK 双宽**：确实会让预估失准，且失败形态是"看起来合理的错数字"（少算 1 行）。
   但**不需要引依赖** —— 走第 2 条就不需要算行数；若一定要在 client 算，
   用内联常量表（约 20 行，与 `MemberRow.tsx:123-141` 同风格）。
   ★ 并纠正：**引库不违反 externals 约束**（purity gate 只查 `@deepseek-ai/*`）。

---

## 6. 我判不了 / 未覆盖的（不许当结论）

1. **"成员集体变红"的真因** —— 我只证明了**不是**"颜色借自任务"（F-6）。
   真因需要一次真实 `/state` 读数（那批成员的 `liveness`/`activity` 实际取值）。**未判定。**
2. **异常在真实数据里的分布** —— F-4 给的是**静态上界**，不是实测分布。R2 仍然成立。
3. **CJK 内联宽度表的准确度** —— 我未测中文渲染，未判定内联表够不够。
4. **`⊘` 与 `✓` 在目标字号下的实际辨识度** —— 需要真实渲染，未测。
5. **B1 的 SVG 样张**（尚未产出）—— 我审的是文字描述，样张出来可能需要复审。

---

*本文只写 `docs/REVIEW-PLAN-2.md`。未改动 `docs/REFACTOR-PLAN.md`、`src/`、`scripts/`、`lib/`、`docs/UI-DISSECTION.md`。*
*所有 finding 均附可复跑命令或 `文件:行`；所有引用均来自我本轮回源复读，未转述他人脚本。*
