# R 线机制：救援分诊接上动作 · 三类不同形 · 沉淀为机械判据

> **本文是 R 线（上半）的实做记录**，对应用户第 3/5/7 点。
> **改动范围**：只有 `src/tools/shared/entities.ts`（`+354 行`）及其 lib 产物。
> **基线**：HEAD `d7ce157`（worktree `task-agent-teams-refactor-t63`）。开工前 stamp 陈旧（`0b29ba5`）⇒ 已先 `pnpm build` 对齐。
> **硬纪律自证**：未碰 `src/client/**`、`scripts/**`、`docs/REFACTOR-PLAN.md`、`docs/QODER-LESSONS.md`、`src/quality-gates.ts`、`src/mutation.ts`。

---

## 0. 一句话

实测发现 **`poolForRescue` 的裁决只被写进台账、从来不驱动任何东西**
（`grep -rn "\.pool\b" src/ --include=*.ts` ⇒ 除定义与写入处**零命中**），
而注释里引用的 `actionForFriction` **根本不存在**（`entities.ts:2854`）。
⇒ 本次补上四件：**动作**（R1）· **三类不同形**（R2）· **比值可复算**（R3）· **沉淀必须指得出判据**（R5）。

---

## 1. ★ 开工前实测：R 线的那个"缺口"到底是什么

### 1.1 裁决有，动作没有

```sh
$ grep -rn "poolForRescue" src/ --include=*.ts
src/tools/shared/entities.ts:2868:export function poolForRescue(...)          ← 定义
src/tools/shared/entities.ts:3439,3455,3460: pool: poolForRescue(rescue.state)  ← 三处【写入】

$ grep -rn "\.pool\b" src/ --include=*.ts | grep -v entities.ts
（无输出）                                                                      ← ★ 零读取
```

⇒ `poolForRescue` 返回的 `'self' | 'escalate'` **被写进 JSON 就结束了** ——
**没有任何代码据此做事**。这正是用户第 5 点要的"让判定变成动作"的缺口。

### 1.2 一个"注释里存在"的函数

```sh
$ grep -rn "actionForFriction" src/ --include=*.ts
src/tools/shared/entities.ts:2854: *   **也不再是待办**（见 `actionForFriction` 的 no-action 分支）。
```

⇒ 只有**一处注释**引用它，**函数不存在**。
★ 这与本仓反复记账的「注释说有、代码里没有」同形 —— 我把它补成真的。

### 1.3 台账的两个时代（R3 的关键实测）

对真台账 `.agent-teams/frictions/`（**384 条**）逐条解析：

```sh
$ python3 …（脚本见 §5）
total: 384
has top-level rescue : 8          ← ★ 只有 8 条带【救援三态】读数
has resolution.pool  : 384        ← ★ 全部 384 条都有【已归档的池子】
top-level rescue.state: {'trying': 8}
resolution.pool       : {'self': 378, 'escalate': 6}
```

⇒ ★★ **文档记的 `self 378 / escalate 6` 用的是 `resolution.pool` 那一口径**
（我逐条复算确认，§4.3）。而本线倡导的"救援三态"口径**只在 8 条上算得出**。
⇒ **两个口径必须分开报**，否则"口径换了"这件事看不出来（见 §3.2）。

★ 另注：384 个文件里**有 1 个是"合法 JSON 头 + 垃圾尾巴"**（解析报 `Extra data: line 270`）——
即 `docs/GATE-EFFICACY.md` 记的那种形态。我的脚本按"取最长可解析前缀"处理，**384 条全部读进来了**
（不是 383）。这一点值得记：`JSON.parse` 直接抛错会静默少一条记录。

---

## 2. R1：把裁决变成**动作**

新增 `actionForFriction(rescue)` → `RescueAction`，**四态**（不是三态）：

| 输入 | `kind` | `pool` | 动作 | `why` |
|---|---|---|---|---|
| `solved`（证据齐） | `none` | `self` | **不再是待办** | 缺席 |
| `trying` | `self-resolve` | `self` | 交给**自己**解 | 缺席 |
| `cannot-solve`（带理由） | `escalate` | `escalate` | **请人进来** | ★ **必须在场** |
| `undefined` | **`unknown`** | `self` | 不动，但**留痕** | 缺席 |

**★★ 为什么是四态而不是三态**：`poolForRescue(undefined)` 返回 `'self'` ——
那是**按用户裁定取的默认值**（它的长注释逐字说明这不是猜）。但这**丢掉了一个事实**：
这条记录**没有 rescue 读数**。⇒ 本函数把它标成 `unknown`：
归宿仍与 `trying` 相同（都不惊动人），但**形状不同** ⇒ "没人看过的卡点积了多少"成为**读得出来的数**。

**★ 证据缺口 ⇒ 降级**（与既有 `missingRescueEvidence` 的接缝）：
`solved` 缺 `solvedBy`/`howSolved`、或 `cannot-solve` 缺 `whyCannotSolve`
⇒ 一律降级为 `unknown`，**不照它声称的那一态动作**。
理由：一声称就照做 = 把未检验的声称当事实（本仓立场：未检验的声称与猜测同形）。

**★ `escalate` 的 `why` 是它的专属形状**：只在 `escalate` 在场，其余三态**必须缺席** ——
否则"带理由"就不再是 `escalate` 的判别面。

---

## 3. R2：三类识别规则**两两不同形**

### 3.1 三类与各自的机械判据

| 类（用户原话） | 判据（机械） | 处置 |
|---|---|---|
| **什么不自觉** `unnoticed` | **没有 rescue 读数**（`state === undefined`） | `unknown`：不惊动人，但**留下计数** |
| **什么自己解决** `self` | `trying` 或 `solved` **且证据齐** | `self-resolve` / `none` |
| **什么必须上报** `escalate` | ★ **只有** `cannot-solve` **且** `whyCannotSolve` 在场 | `escalate`（带理由） |

★ **三者不同形的落点是 `kind` 的四个取值**，不是"三个字符串" ——
`unknown` 与 `self-resolve` **归宿相同（都是 `self`）而形状不同**：
这正是本仓记的那条「**归宿相同 ≠ 是同一件事**」。

★ 一处刻意的连带：**证据不齐的 `solved` 落 `unnoticed` 而不是 `self`** ——
"声称解了却说不出谁解的" = 还没被**核实**看过。这由 `actionForFriction` 的降级自然推出，
不是特判。

### 3.2 R3：比值**可从台账复算**，且**两个口径分开报**

`rescueRatio(records)` → 同时给出：
- **`byPool`** —— 按 `resolution.pool`（**与文档记的 378/6 同一口径**）；
- **`byRescue`** —— 按救援三态（只有带 `rescue` 读数的记录参与）。

★ **`unnoticed` 单列、不进分母** —— 否则"没人标注过"会把自消化率**抬高**，
而它恰恰是"还没被看过"的那一批（把它们算成"自己解决了"就是本仓反复记账的合流）。

★ **分母为 0 ⇒ `selfRatio === undefined`**（**不是 0，也不是 1**）：
"一条记录都没有"与"自消化 100%"是两件事，同形之下会读成同一件。

---

## 4. 验证（全部可复跑）

### 4.1 自证脚本：26 条断言，全绿

```sh
$ node /tmp/rcheck.mjs "$(pwd)"
── R1：poolForRescue 的裁决能驱动【动作】（不只是字符串）        （6 条 ✔）
── R1 的【证据缺口】降级（接 missingRescueEvidence）             （2 条 ✔）
── R2：三类识别规则两两不同形（每类正例 + 反例）                 （7 条 ✔）
── R3：比值可从台账复算                                       （6 条 ✔）
── R5：沉淀必须指向机械判据（prompt 不算）                       （2 条 ✔）
── R3 补充：两个口径【分开报】                                   （3 条 ✔）
★ 结果：pass 26 / fail 0
```

**R2 每类各一正例 + 一反例**（验收明确要求）：
```
正例① unnoticed（无读数）                    ✔
反例① 【有】trying 读数 ⇒ 不是 unnoticed      ✔
正例② self（trying）                        ✔
反例② cannot-solve ⇒ 不是 self               ✔
正例③ escalate（cannot-solve + 理由）        ✔
反例③ trying ⇒ 不是 escalate                 ✔
★ 三类取值两两不同（三个不同处置）              ✔
```

### 4.2 ★★ 反向半边：三个变异体，**全部被检出**

**没有它，"分类正确"与"两个分支都不触发"同形。**

| 变异体 | 改法 | 结果 |
|---|---|---|
| **A** | `undefined` 与 `trying` **合流**（把 `unknown` 改回 `self-resolve`） | ✅ exit=1，**8 条 ✖** |
| **B** | `escalate` 被读成 `self`（`classifyRescue` 的 escalate 分支返回 `'self'`） | ✅ exit=1，**7 条 ✖** |
| **C** | `prompt` 被当成**已沉淀**（`auditSediment` 的 kind 检查短路） | ✅ exit=1，**2 条 ✖** |

★ **变异体 B 第一次没红 —— 但那不是断言的错**：我第一版改的是**源码里**的一行，
而 `lib/` 里编译后的**格式不同**（`if (false)` 那条 patch 根本没落上）。
改到**真代码**（`return 'escalate'` → `return 'self'`）后立刻 7 条 ✖。
⇒ **"变异体没被检出"要先怀疑变异体本身**，这与 t62 那次"先怀疑自己的量具"是同一条。

### 4.3 ★ R3 在**真台账**上的复算（384 条）

```sh
$ node …（用 lib/tools/shared/entities.js 的 rescueRatio 跑真台账）
台账 384 条。★ 旧口径（resolution.pool）self 378 / escalate 6（自消化 98.44%）；
★ 新口径（rescue 三态）self 8 / escalate 0（100.00%）；
★ 另 376 条**没有 rescue 读数**（单列，不进分母）
```

⇒ ★ **文档记的 `378/6` 被逐条复算出来**（`byPool = {self:378, escalate:6}`）✅，
同时**暴露出**：本线倡导的三态口径今天只在 **8 条**上成立。
★ 这两件事**必须同时可见** —— 只报一个就会让"口径覆盖率 2%"被藏起来。

### 4.4 R5：沉淀必须指得出**机械判据**（prompt 不算）

新增 `auditSediment(entries)`，**机械校验**四条：

| # | 判据 | 不过时 |
|---|---|---|
| ① | `kind` **必须**是 `'gate'` | `'prompt'` / `'doc'` / `'convention'` **一律**判未沉淀（用户原话「prompt 是软手段」） |
| ② | `at` **必须**是 `^src\/.+:\d+$`（`文件:行`） | 指不出行号的不算 |
| ③ | `because` 必须非空 | 说不出"为什么它是机械判据"的不算 |
| ④ | `at` 必须以 `src/` 开头 | 防止指向文档/提示词 |

**自测读数**（6 条输入）：
```
真沉淀 1 条（kind=gate + 完整 src/…:行号 + because）
未沉淀 5 条（prompt / doc / convention 各 1 + 缺 at 1 + at 形状错 1）
```
★ 为什么用**数据 + 校验器**而不是写在注释里：因为「沉淀成 prompt」的症状**恰恰**是
"它读起来像已经解决了" —— 一句写进 prompt 的话与一条真判据**在报告里同形**，
只有机械校验能把它们分开（与 `kind-requirements.ts` 同一条纪律）。

### 4.5 构建与净变化

```sh
$ npx tsc -p tsconfig.json --noEmit   # exit=0
$ pnpm build                          # exit=0；新增 196 行 lib/tools/shared/entities.js + 186 行 d.ts
$ pnpm test:gates                     # tests 1471 / pass 1413 / fail 20
```

★ **净变化按【失败文件集合】判**（契约要求，因为计数会抖）：

```sh
$ comm -13 <(改前失败文件集排序) <(改后失败文件集排序)     # 净新
（空）
$ comm -23 …                                              # 净减少
（空）
```
⇒ ★ **净新失败 = 0，净减少 = 0** —— 失败文件集**逐条相同**（16 个文件，含 `gate-producer-consumer` 那条既有的）。

★ **基线口径修正**（与前几轮同）：任务书给 1415/19，而我**动代码前实测** = **1413 pass / 20 fail** ⇒ 差异先于我的改动存在。

---

## 5. 复现命令与脚本

```sh
cd /Users/abab/Desktop/agent-teams-dev/.agent-teams/worktrees/task-agent-teams-refactor-t63
```

**R 线自证（26 条断言 + 反向半边）**
```sh
node /tmp/rcheck.mjs "$(pwd)"                     # ⇒ pass 26 / fail 0
```

**真台账复算（384 条）**
```sh
node --input-type=module -e "
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const { rescueRatio } = await import('$(pwd)/lib/tools/shared/entities.js')
const L='/Users/abab/Desktop/agent-teams-dev/.agent-teams/frictions'
function load(f){const s=readFileSync(f,'utf8');try{return JSON.parse(s)}catch{for(let c=s.length;c>0;c--){try{return JSON.parse(s.slice(0,c))}catch{}}}}
const recs=readdirSync(L).filter(n=>n.endsWith('.json')).map(n=>load(join(L,n))).filter(Boolean)
const r=rescueRatio(recs); console.log(r.summary); console.log('byPool',JSON.stringify(r.byPool))
"
# ⇒ 旧口径 self 378 / escalate 6（98.44%）；新口径 self 8 / escalate 0；另 376 条无 rescue 读数
```

**反向半边（三个变异体各跑一次）**
```sh
cp lib/tools/shared/entities.js /tmp/ent.bak
# A: 把 actionForFriction 最后一支的 kind:'unknown' 改成 'self-resolve'   ⇒ 期望 exit=1
# B: 把 classifyRescue 的 return 'escalate' 改成 return 'self'             ⇒ 期望 exit=1
# C: 把 auditSediment 的 if (entry.kind !== 'gate') 改成 if (false)         ⇒ 期望 exit=1
node /tmp/rcheck.mjs "$(pwd)"; echo "exit=$?"
cp /tmp/ent.bak lib/tools/shared/entities.js       # 还原
```

---

## 6. ★ 我自己的两处错，留痕

1. **`rescueRatio` 第一版只把 `{ state }` 交下去** —— 丢掉了 `solvedBy` / `howSolved` /
   `whyCannotSolve`，于是 `missingRescueEvidence` **如实报证据缺口** ⇒
   `solved` 与 `cannot-solve` **双双降级成 `unknown`**，被算进 `unnoticed`。
   读数从真值 `3/1/1` 变成 `2/0/3`。**是我自己的自证脚本抓到的。**
   ⇒ 修法：交**整份 rescue 对象**，并加 `normalizeRescueInput` 把两种入参形状**归一**
   （写漏一格就是这次这个缺陷）。
2. **反向半边第一次"没红"**：我改的是**源码**，而跑的是 **`lib/` 编译产物**，
   格式不同 ⇒ patch 没落上。改到真代码后 7 条 ✖。
   ⇒ **"变异体没被检出"要先怀疑变异体本身。**

---

## 7. 局限（如实留白）

1. **R4（上报路径自进化）不在此任务范围** —— 计划 §3-R 已判它「需先造基线」
   （"同类卡点重复上报次数"这个数今天不存在）。**本次未做。**
2. **`rescue` 读数的覆盖率只有 8/384（2%）** —— 本线倡导的三态口径今天**几乎无数据**。
   ★ 这不是本次改动引入的，但它意味着 **R1/R2 的判据在真实台账上还"没被用过"**。
3. **`actionForFriction` 尚未接上任何调用方** —— 本次只补出**机制**（纯函数 + 自证）。
   ★ 与计划 §2 共享资源段的「那 8 个机制在 `scripts/`」是同一类问题：
   **建好了不等于接线了**。接线点应落在 `src/tools/status.ts` 的读数里（本次未动，避免与 A/D 写域冲突）。
4. **`auditSediment` 的输入是人工维护的清单** —— 我没有把它接到任何自动发现上
   （例如"从台账里自动找出未被沉淀的卡点模式"）。**那是 R4 的题目。**
5. **未验证 `kind: 'gate'` 的 `gate` 字段真能对应到一条存在的判据** ——
   校验器只查**形状**（含 `src/…:行号`），不查**那个行号上真的有这条判据**。
   ⇒ 一个指错门的沉淀今天能通过校验。**这是一个已知的校验盲区，不是已解决的。**

---

*本文件只写 `docs/R-LINE-MECHANISM.md`。改动仅 `src/tools/shared/entities.ts`（`+354`）及其 lib 产物。*
