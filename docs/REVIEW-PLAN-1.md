# 计划审查①：依赖与顺序（`docs/REFACTOR-PLAN.md` §2 + §7）

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