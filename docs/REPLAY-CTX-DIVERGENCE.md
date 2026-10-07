# 重放的 ctx 与运行时那一份已分叉（t79）

> 本文记录 `gate-friction-capture` 臂 4 的**根因**与修法。
> 判据本体在 `scripts/gate-friction-capture.test.mjs`，
> 重放工具在 `src/tools/shared/entities.ts` 的 `rehydrateReplayCtx`。

---

## 1. 症状（t69 报出，t79 定位）

`gate-friction-capture` 臂 4 自称「记录 vs 日志的分水岭」，而它红着：

```
记录里写的是  [completion.mutation]
重放得到的是  [completion.verify-rerun]
```

★ 而它红着**是在说真话** —— 它的注释就是这么写的。

---

## 2. ★★★ 根因：不是"缺一格"，是"函数进不了 JSON"

### 2.1 第一步：记录里其实**一格都不缺**

实测记录里的 `scene.ctx` **含全部 16 个键**：

```
task · update · wantsCompleted · taskNotTerminal
execVerifyCommand · loadRules · loadKindRequirements
scanDirs · runTestOnRevision · readFile · writeFile
runTest · changedFiles · killerSuites · testCommand
execBacktestCommand · execSelectedCommand
```

⇒ ★ 所以"记录里缺什么"（选项 ②）**答不上来** —— 键一个不少。

### 2.2 第二步：丢的是**函数的性质**

`toReplayableSnapshot` 把每一个函数序列化成 `{ __absent: 'function' }`：

```
loadKindRequirements : {"__absent":"function"}
loadRules            : {"__absent":"function"}
execVerifyCommand    : {"__absent":"function"}
runTestOnRevision    : {"__absent":"function"}
readFile             : {"__absent":"function"}
runTest              : {"__absent":"function"}
scanDirs             : {"__absent":"undefined"}
```

★ 而那一步是**忠实**的：函数确实进不了 JSON。
★ 问题不在记录 —— **问题在重放拿着一个它兑现不了的 ctx 照常跑。**

### 2.3 第三步：后果链（这是真正的那条）

```
loadKindRequirements 那一格上是【对象】而不是函数
    ↓
loadKindRequirementsOfHost 判 typeof === 'function' ⇒ 不成立
    ↓
返回 { status: 'absent' }
    ↓
mutation.appliesTo ⇒ gateRequirementFor(absent, …) ⇒ status !== 'required'
    ↓
★ 返回 false ⇒ 门【不说话】（silently skipped）
    ↓
裁决落到 verify-rerun 上 —— 而那是一条**看起来完全正常**的结论
```

★ 而这条链与 t54 报过的那个形态**是同一个**：

> **缺 loader ⇒ 四条门一起沉默。**

⇒ 而重放**必然**缺 loader（函数进不了 JSON）
⇒ 所以**每一次重放**都落在这条链上。那不是偶发分叉，是**结构性的分叉**。

---

## 3. ★★ 为什么选 ①（让重放更真），而不是 ②（让分叉可见）

契约问：「重放该不该复现生产环境？」

### 3.1 ② 已经实现了 —— 而它没能帮上忙

★ 记录**已经**把"这一格是个函数、而它没被带来"写下来了（`{__absent:'function'}`）。
⇒ 它忠实、可读、机器可判 —— 而它**没用**。

**因为记录是诚实的，撒谎的是重放。**
重放拿着一个兑现不了的 ctx 照常跑，然后交出一个属于**另一条分支**的结论。

⇒ ★ 所以"把缺什么记进记录"这个方向**已经走到头了**：再加字段也只是更详细地
描述一个**重放不打算兑现**的输入。

### 3.2 ① 的正确形式：从【宿主】重新注入

★ 而"注入同样的 `loadKindRequirements`"**不可能从 JSON 做到** ——
函数就是进不了 JSON。⇒ 它必须**在重放时由宿主提供**。

⇒ 那正是 `rehydrateReplayCtx(snapshot, injections)` 做的事：

```
注入表里有那一格的函数  ⇒ 用【宿主的】实现（与生产同形）
注入表里没有            ⇒ ★ 把那一格【整个去掉】，并记进 `unreplayable`
```

★ 为什么"去掉"而不是"留一个占位对象"：
判据们判的是 `typeof x === 'function'`。留一个对象会让它们读成
「有这一格、只是类型不对」；而**去掉**等于「这一格不在」——
后者是可解释的（缺输入），前者会让人去查"为什么它不是函数"。

### 3.3 ★ 而 ① 与 ② 的合取才是完整答案

```
① 让能注入的注入        ⇒ 重放**更真**
② 把注入不了的【列出来】  ⇒ 分叉**可见**（`unreplayable` 是返回值的一部分）
```

★ 所以本任务不是二选一 —— 而是"① 为主，把 ② 的价值并进 ① 的返回值里"。

---

## 4. ★★★ 修的过程中发现的第二个陷阱（比第一个更隐蔽）

★ 我第一版给的是：

```js
loadKindRequirements: () => ({})      // ← 空对象
```

⇒ 而 `parseKindRequirements({})` 判它 **`malformed`**（"no kinds array"）

⇒ ★ 于是它与"**根本没注入**"在后果上**完全相同**：
`mutation.appliesTo` 仍然返回 false ⇒ 门仍然沉默 ⇒ 裁决仍然落到 `verify-rerun`。

> **★ "注入了"与"注入的东西能用"是两件事。**

★ 而这一条是本任务最有价值的发现：一个**只检查"注入表里有没有那个键"**的修法
会通过，而重放**仍然**是错的 —— 因为注入的是一个用不了的东西。
⇒ 所以修法必须注入**形状正确**的表（实际用的是
`src/gates/completion/kind-requirements.json`，并断言 `status === 'loaded'`）。

★ 同一条也适用于 `execVerifyCommand`：缺它时 `verify-rerun` 会报 `unmeasured`
并**成为裁决**，那同样挡住 `mutation`。而生产里那一格**本来就是接上的**
（`src/tools/update-task.ts` 注入 `runVerifyCommand`）——
⇒ 重放要复现生产，就必须也接上它。★ **这不是"为了让它绿而凑齐"。**

---

## 5. 修了什么（清单）

| 文件 | 改动 |
|---|---|
| `src/tools/shared/entities.ts` | ★ 新增 `rehydrateReplayCtx(snapshot, injections)`：把函数格从宿主重新注入，注入不了的进 `unreplayable` |
| `scripts/gate-friction-capture.test.mjs` | 臂 4 改为**重注入后再重放**；注入真实的 kind 表与 executor；新增三态与反向半边 |

★ **没有**改：判定逻辑、`src/tools/update-task.ts`（生产注入点，outOfScope）、
任何生产行为。

---

## 6. ★★ 三态不同形（契约要求）

```
consistent   —— 重放与记录落到【同一个判据】上
diverged     —— 落到了别的判据上（★ 消息里说清分在哪一格）
unmeasurable —— 重放跑不起来（注入不了 ⇒ 不许假装跑过）
```

★ 而本臂的判法是 `replayedGate === recordedGate`（**精确相等**，不是"都拒绝了"）。
⇒ 因为"重放出来是拒绝、但拒绝的是别的原因"同样不能叫可重放 ——
那说明 ctx 丢了关键的一格，判据跑到了另一条分支上。

---

## 7. 定向突变与反向半边（实测）

```
★ 定向突变：把 `loadKindRequirements: undefined` 传进注入表
  ⇒ 臂 4 红（其余 3 条绿）⇒ 还原后 4/4 绿
  ★ 而那同时是反向半边：它证明本臂【仍能抓住真分叉】，
    而不是"我把它改成绿了"。
```

---

## 8. 剩下什么没做（如实）

```
1. ★ `rehydrateReplayCtx` 只做【一步】重注入 —— 它不校验注入进来的东西
   形状对不对（§4 那个陷阱只能靠调用方自觉）。
   ⇒ 本任务把那条教训写进了臂 4 的注释与本文，但**没有**把它变成机制。
   ★ 若将来有第二次同类分叉，值得考虑让 `rehydrateReplayCtx` 接受
     "每一格的形状断言"。

2. ★ 生产路径【不受影响】：`scene.ctx` 仍然照原样序列化，
   本任务只改了"重放侧怎么读它"。

3. ★ 臂 4 仍依赖那份 `kind-requirements.json` 在盘上可读；
   读不到时它 assert.fail（而不是静默跳过）—— 那是本仓一贯的"读不到就报"。
```
