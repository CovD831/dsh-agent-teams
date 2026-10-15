# 判据：关键能力不许被静默删除（t75）

> **新增判据**：`scripts/gate-critical-symbols.test.mjs`（已注册进 `pnpm test:gates`）。
> **本文件说明它防什么、怎么加一条、以及它的边界在哪。**

---

## 1. 它防的是哪一次事故（MEASURED，2026-10-16）

**`247dd87` 落了 S1，`c32f0a5` 把它整个删掉了 —— 而没有任何东西发现。**

```
247dd87（S1 提交后）: src/state/tasks.ts = 302 行
c32f0a5（D12 提交）: src/state/tasks.ts = 109 行   ← ★ S1 被删
grep -rn gateEvaluationRecordOf src/               ⇒ 0 处
```

**机制**：那次用了 `git add -A src lib docs` ⇒ **把当时另一任务 worktree 的中间态扫了进来**。
★ 而 `c32f0a5` 的**提交信息自称是 D12 UI 修复** —— 一次"UI 改动"顺手删掉了别的任务刚落的服务端能力。

### 1.1 ★★ 为什么那 5 条验收**全部通过**

> 「`tsc` 在回退后的树上 **exit=0** —— ★ **静默绿**：代码**不在那里**，所以编译得过。
>   回退**删掉了新代码而没有改坏老代码**，所以**什么都不红**。」

⇒ ★ 这正是本仓记账最久的形态：**「它被删了」与「它从来没做过」在报告里同形。**

### 1.2 ★ 它与 t63 那条互为反面

| | 形态 | 本仓的判据 |
|---|---|---|
| **t63** | **机制建好了 ≠ 接线了** | `scripts/gate-position-wiring.test.mjs` |
| ★ **本条** | **接线了 ≠ 没被删掉** | `scripts/gate-critical-symbols.test.mjs` |

⇒ 两条合起来才闭环：t63 管"挂了判据会不会被跑到"，本条管"跑到过的东西还在不在"。

---

## 2. ★★ 形状：**不许读源码文本**（本判据的全部要点）

`grep "gateEvaluationRecordOf" src/state/tasks.ts` **不是判据**，两条理由：

| # | 它怎么骗过人 | 本仓的先例 |
|---|---|---|
| **①** | **改名/挪文件就失效** ⇒ 能力**还在**而判据**假红** | ★ t67/t70 那两次"按文件路径读源码"的夹具（`docs/E-LINE-L0.md` §4） |
| **②** | 测的是**文本**不是**能力** ⇒ 注释掉的、死代码里的符号名同样命中 ⇒ **假绿** | 同上 |

⇒ 本文件照 **`scripts/gate-position-wiring.test.mjs`** 的形状。它的注释逐字：
> 「所以本文件的每一条断言都必须是【**实测**】的：往注册表上真的挂一条判据，
>   真的走一次工具路径，然后检查判据【自己被调用了】。」

★ **具体到本文件**：每一条能力的 `check` 都是一个**可执行的函数**，
它**真的 `import`** 那个模块、**真的走一次工具路径**，然后读**盘上的事实**。

### 2.1 ★★ "整个符号被删掉"是怎么被抓住的（**这是事故的形状**）

事故里是**整个符号消失**，不是"改坏了一行"。⇒ `check` 里**先取那个符号**：

```js
const project = tasks.gateEvaluationRecordOf      // ★ 符号没了 ⇒ undefined
assert.equal(typeof project, 'function', …)       // ★ 这里当场抛
```

★ 这不是读文本 —— 它**真的 import 了编译产物**。
**实测**（见 §4）：把 `lib/state/tasks.js` 里的 `export` 去掉 ⇒ 这条**当场红**。

### 2.2 ★★ "落盘那一行没了"是怎么被抓住的（真实工具路径）

★ **它读不出来**：`task.gateEvaluation = …` 是一次**内部赋值**，
**在模块导出面上看不见**。⇒ 只有**真的跑一次 `update_task`**、再**从盘上读回**才能分辨。

⇒ 本文件带一个**真实路径夹具**（与 `scripts/gate-execution-history.test.mjs` 同形状）：
真的 `registerAgentTeamsTools` → 真的 `createTeamDir` → 真的 `update_task.execute` →
**真的 `readTeam` 从盘上读回** → 断言 `task.gateEvaluation` 在场且 `ran[]` 非空。

**实测读数**（真的跑了一遍）：
```
call result: ok
task.status: completed
has gateEvaluation: true
  ran ids: completion.verify-rerun, completion.r5, completion.mutation, completion.backtest | registered: 4
```
★ 而**删掉落盘那一行**之后：`has gateEvaluation: false` ⇒ **当场红**（见 §4）。

---

## 3. ★ 清单：一条能力一格（**怎么加一条**）

```js
{ id, capability, symbols, check }
```

| 字段 | 作用 |
|---|---|
| `id` | 短名（`S1` / `T5` / `T8`），**不许重复** |
| `capability` | 它是什么能力（读的人要知道"没了"意味着丢什么） |
| `symbols` | 该能力依赖哪些导出（人读面，也是"谁没了"的读数） |
| ★ `check` | **一个函数**：真的去执行那件事，并 `return` 读数 |

**加一条的动作 = 加一个对象。** ★ **刻意不写成一个巨大正则** —— 那样加一条要改正则，
而**正则会腐烂**；而且改正则时你不知道改的是哪条能力。

★ 而"`check` 必须是函数"这件事**由臂 4 当场挡下**：
```js
assert.equal(typeof entry.check, 'function',
  `★★ \`${entry.id}\` 的 check 必须是**可执行的函数**，不许是正则或源码文本`)
```
⇒ 于是"有人图省事写成 `grep`"这条路**在判据层就被堵住**，而不是靠纪律。

### 3.1 现有三条

| id | 能力 | 关键符号 | 检查方式 |
|---|---|---|---|
| **S1** | 判据结果落盘到 task（B 线唯一的服务端前置） | `gateEvaluationRecordOf` + `task.gateEvaluation` | ① `import` 产物并断言该导出可调用（**整个符号被删 ⇒ 红**）；② 喂一份**真实的** `GateEvaluation` ⇒ 断言 `ran[]` 保序且全在、`registered`/`evaluated` 在 |
| **T5** | 闸门判定：inScope 里"结构上不可能产出"的路径 | `emittedProductGaps` | 真跑：只声明 `src/state/tasks.ts` ⇒ **必须报出缺口**；★ 对照：把产物**声明齐** ⇒ 缺口**消失** |
| **T8** | 成对产物：声明 `.js` 漏 `.map` | `emittedProductGaps` | 真跑：只声明 `src/tools.ts` ⇒ 报出的缺口里**必须含 `lib/tools.js`** |

★ **T5/T8 是同一条能力的两个面，但各自一格** —— 改 T8 不动 T5，这就是"可维护"的全部含义。

★ **每条的 check 都带一个对照读数**（不是只报"非空"）：
T5 的对照是"声明齐了就该消失" ⇒ 没有它，"它永远返回非空"与"它正确工作"**同形**。

---

## 4. 验收读数（全部可复跑）

### 4.1 常态：能力都在 ⇒ 全绿

```sh
$ node --test scripts/gate-critical-symbols.test.mjs
✔ ★ 关键能力在岗：S1 — 判据结果落盘到 task（B 线唯一的服务端前置）
✔ ★ 关键能力在岗：T5 — 闸门判定：inScope 里"结构上不可能产出"的路径要报出来
✔ ★ 关键能力在岗：T8 — 成对产物：声明 `.js` 却漏了它的 `.map` 要报出来
✔ ★★ 反向半边 B：`gateEvaluationRecordOf` 整个消失 ⇒ 判据必须红
✔ ★★ 反向半边 A：走一遍真实 update_task ⇒ 盘上必须真的出现 `task.gateEvaluation`
✔ ★ 清单体检：每条都有 id/能力名/符号/可执行的 check，且 id 不重复
ℹ tests 6 · pass 6 · fail 0
```

### 4.2 ★★ 反向半边 B（**更关键的那半**）：整个符号消失

**做法**：把编译产物里 `gateEvaluationRecordOf` 的 `export` 去掉（模拟"整个符号被删"）。
```sh
$ node --test scripts/gate-critical-symbols.test.mjs
✖ ★ 关键能力在岗：S1 — …
  AssertionError: ★ `gateEvaluationRecordOf` 必须是一个可调用的导出（整个符号被删是最重的形状）
```
⇒ ★ 这正是事故的形状（**整个符号消失**，不是改坏一行）。

### 4.3 ★★ 反向半边 A：落盘那一行没了

**做法**：把 `lib/tools/update-task.js` 里的 `task.gateEvaluation = gateEvaluationRecordOf(completionGates);` 删掉。
```sh
$ node --test scripts/gate-critical-symbols.test.mjs
✖ ★★ 反向半边 A：走一遍真实 update_task ⇒ 盘上必须真的出现 `task.gateEvaluation`
  AssertionError: ★★ 走完一次真实的 update_task 之后，盘上必须真的有 `task.gateEvaluation` ——
                  它缺席就意味着**落盘那一行没了**（那正是本任务要撞的事故形状）
ℹ tests 6 · pass 5 · fail 1
```
★ 而**删掉之前**同一个驱动读到 `has gateEvaluation: true` ⇒ **这条判据有分辨力**。

### 4.4 ★★ 一处如实留痕：**我第一版的臂 A 是假的**

★ 我第一版把臂 A 写成"`import` 调用点模块，断言它能装载" —— 那是**弱判据**：
实测**删掉落盘那一行后它照样绿**（模块当然还能装载）。

⇒ ★ 这正是本任务警告的形状（「只做 A 会漏掉 B」）—— 而我第一版的 A **连自己那半都漏了**。
★ 修法就是 §2.2 那条**真实工具路径**：只有真的跑一次、从盘上读回，才分得出
「它写了」与「它没写」。**修后实测：删行 ⇒ 红；行在 ⇒ 绿。**

---

## 5. 净变化

| 面 | 读数 |
|---|---|
| `node --test scripts/gate-critical-symbols.test.mjs` | `ℹ tests 6 · pass 6 · fail 0` |
| `npx tsc -p tsconfig.json --noEmit` | **exit=0** |
| `pnpm test:gates` 失败文件集合 | ★ **逐条相同**（两侧均 16 个文件，`diff` 无输出）⇒ **净新失败 = 0** |
| 注册 | ★ 已加进 `package.json` 的 `test:gates` ⇒ **它在全环里真的会跑**（不是 skip） |

```sh
# 基线（把本判据移走 + 还原 package.json 后重跑）
$ pnpm test:gates   ⇒ ℹ tests 1471 · pass 1410 · fail 23 · 16 文件
# 加上本判据之后
$ pnpm test:gates   ⇒ ℹ tests 1477 · pass 1416 · fail 23 · 16 文件
$ diff <基线失败集合> <改后失败集合>   ⇒ 无输出 ✅

★ 判据数 1471 → 1477（**+6**，正是本文件的 6 条臂），pass 同步 +6，
  而 fail 一侧**一动不动**（23 ⇒ 23）⇒ **新增判据没有碰到任何既有臂**。
★ 且 `critical-symbols` **不在失败集合里**（`grep -c` ⇒ 0）⇒ 它**真的跑到了并且绿**，
  不是 skip、也不是"没被选中"。
```

---

## 6. ★ 边界（不许把边界读成"它没问题"）

| # | 边界 | 说明 |
|---|---|---|
| **1** | ★ **只保护清单上列了的能力** | 清单是**人写的** ⇒ 一条能力若**没被登记**，它被删了本判据**看不见**。⇒ 加能力的人**有责任**同时加一格 |
| **2** | ★ **它不能防"同一次提交把能力和它的判据一起删"** | 若某个提交把 `gate-critical-symbols.test.mjs` 自己删了，全环里就少一条 —— 而那与"它从来没跑过"同形。★ 这条**本判据管不了**，需要的是"已注册判据数不许减少"那种元判据（**未做**） |
| **3** | 真实路径臂**只覆盖 S1** | T5/T8 走的是**纯函数调用**（它们本来就是纯的）⇒ 没有"接线"那一层可测。★ 若某条能力**只有接线面**，它必须像 S1 那样配一个真实路径臂 |
| **4** | 臂 A 的驱动用 `work` 类任务 | 质量类会被完工判据拦（引入无关前置条件）⇒ 它测的是"**判据结果有没有落盘**"，不是"质量类任务的裁决对不对" |

---

## 7. 给下一个人的三条

1. ★★ **加一条能力 = 加一个对象**（`{id, capability, symbols, check}`），
   而 `check` **必须是函数** —— 写成 `grep` 会被臂 4 当场挡下。
2. ★★ **能"接线"的能力必须配真实路径臂**（像 S1 那样）：
   模块导出面**看不出**内部赋值，所以"符号在"与"它被用在落盘处"是**两件事**。
3. ★ **每条的 check 都要带一个对照读数**（像 T5 那样"声明齐了就该消失"）：
   没有对照，"它永远报"与"它正确工作"**同形**。
