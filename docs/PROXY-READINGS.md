# 代理读数：按距离取块（j-0003）

> **j-0003 的原话**：**「代理读数在它所代理的东西没变时也会变。」**
>
> 判据实施：`scripts/gate-proxy-readings.test.mjs`。
> ★ 而它 **报告而不拦** —— 理由见 §4。

---

## 1. 两个真实实例（今晚各出现过一次，两个都已被修）

### ① t49 的臂 7：一个有界距离的正则

```js
// 旧（按距离）
assert.match(body, /if \(!arbitration\.allowed\)[\s\S]{0,400}?return \{/)
```

在拒绝分支里加了一段注释（说明"只有 work-in-flight 才排队"）
⇒ 距离变成 **1165** ⇒ 臂红，**而控制流的字一个没变**。

```js
// 新（按归属）
const refusalIf = body.indexOf('if (!arbitration.allowed)')
const refusalBlock = balancedBlockFrom(body, refusalIf)
assert.match(refusalBlock, /return \{/, …)
```

★ 修法**不是**"把 400 改大" —— 那只是把失效推迟到下一次。
它是**换掉代理**：按**名字**定位，按**结构**（配平）取块。

### ② t69 的 gate-index-assembly：一个 80 行窗口

```js
// 旧（按距离）
const window = lines.slice(index, index + 80).join('\n')
logsGaps: new RegExp(`${match[1]}\\.missing`).test(window)
```

在 `update-task.ts` 的 dispatch 段加了 **4 行注释** ⇒ 那句日志掉出 80 行窗口
⇒ 臂红，**而日志一个字没少**（`grep` 仍在）。

```js
// 新（按归属）
logsGaps: new RegExp(`${match[1]}\\.missing`).test(source)
```

★ 那一格要问的是「**这个变量**有没有被读出它的缺格」——
**那是一个全文问题，不是"附近 80 行"问题。**

**共同点**：两者都**按距离取块**，而两者都**声称在测"那个东西还在不在"**。

---

## 2. 三态

| 态 | 取块方式 | 受位置影响吗 | 例子 |
|---|---|---|---|
| `attribution-based` | 按**名字/模式**在**全文**里找 | **不**受 | `new RegExp(name).test(source)` |
| `distance-based` | 按**距离**（`slice(i, i+N)` / `{0,N}`） | ★ **一变就失效** | `lines.slice(index, index + 80)` |
| `unmeasurable` | 动态构造，静态看不出来 | 不知道 | `source.slice(start, computedEnd)` |

### ★ 为什么 `unmeasurable` 必须自成一态

一个有界距离是**静态可判**的；而"距离是算出来的"看不出来。
⇒ 把它硬判成 `distance-based` 就是**把不可判并进可判** —— 本队记过的那种合流。

---

## 3. ★★ 判据踩了它自己：第一版 65 条里大部分是误报

第一版全仓跑报出 **65** 条 `distance-based`。抽样三条**全是误报**：

```js
html.slice(0, 200)         // 把 HTML 字符串截短做展示
missing.slice(0, 3)        // 把错误清单截短做展示
withRecord.slice(0, 200)   // 把记录截短做展示
```

三者都命中 `slice(x, N)`，而它们**都不是"从源码里取一段来做断言"** —— 它们是**把值截短**。

⇒ ★ 第一版读的是**形状的代理**，而被代理的是"**从源码里**按距离取一段"。
**而那是 j-0003 的镜像**：

```
原命题：代理读数在它所代理的东西【没变】时也会变
这一版：它在它所代理的东西【变了】时（值 → 源码）【也不变】
```

⇒ **两个方向都要防。** 加一条限定（距离必须落在**源码文本**上：`source` / `body` / `lines` / …）
之后，存量从 **65 → 11**，而两个真实实例仍然被抓到。

### 现在的存量（对全仓 87 个夹具跑一次）

```
attribution-based   46
★ distance-based    11      ← 逐条列出（见下面）
unmeasurable         3
三态之和            60
```

而那 11 条**是真的**（抽样核对过），例如：

```
scripts/gate-index-assembly.test.mjs:1119   lines.slice(index, index + 600)
scripts/gate-restart-arbitration.test.mjs:271  source.slice(from, i + 1)
scripts/gate-restart-arbitration.test.mjs:542  /state\.waitingOn…[\s\S]{0,600}?fiber\.restart\(\)/
scripts/gate-wiring-pinned.test.mjs:178      source.slice(i, i + 2)
```

★ **它们不是"错误清单"，而是"待判断清单"。** 见 §4。

---

## 4. ★★★ 为什么它【报告而不拦】

j-0003 **自己的 counterexample** 明说：

> **有些代理读数是合理的。** 例如"这一段代码在附近"本身就是一个正当的断言。

⇒ 所以本判据的产出是**标记 + 读数的性质**，**不是 `blocked`**。

★ 一条"把所有按位置取的全判成坏的"判据会**误伤**那些合理的用法，
而误伤的代价是**人学会忽略这条判据** —— 那正是本队一直在防的。

### ★ 那么，哪一种距离取法是危险的？

**判据问的那个问题**：

> 「它读的是**那个东西**，还是**那个东西附近**？」

而那条分界线有一个**可操作的判准**：

```
若那条断言声称测的是「X 还在不在」  ⇒ 按距离取是危险的
   （因为 X 挪远一点它就红，而 X 还在 ⇒ 归因方向是错的）
若那条断言声称测的是「X 就在 Y 附近」⇒ 按距离取是正当的
   （"附近"就是它要测的那件事，距离变了它本来就该变）
```

★ 而那正是 t49/t69 修完之后的写法所满足的：它们测的是**存在性**，
而它们现在按**全文/结构**取 —— **直接读它要测的东西 ⇒ 不会失效**。

---

## 5. ★★ 它的边界是【已裁】的（t65 与 captain 的那次分歧）

| | 主张 |
|---|---|
| **工具答 gate** | 断言写下之后，它读的东西**现成可取吗**？⇒ 距离/行号/缩进**都现成可取** |
| **captain 裁定（2026-10-08）** | 「『构造它需要理解』是【**作者**】的属性，而它在**判据跑起来之后**就不存在了」 |

⇒ **按工具那一侧做。** 而那是已裁的。

★ 那个"需要理解"的部分（"这个距离取法危不危险"，见 §4）是**作者在写它的那一刻**的问题。
而工具能做的、也正是本判据做的，是**把它指出来** ——
让人在**写/改的那一刻**看见，而不是等它几个月后以"臂红了而东西没坏"的形式出现。

---

## 6. 变更记录

| 日期 | 改了什么 | 依据 |
|---|---|---|
| 2026-10-08 | 初稿：三态 + 报告而不拦 + 误报面修正（65→11） | t81 契约；`f-0079`（t65 与 captain 的边界裁定：工具答 gate / 表答 diagnosis）· `f-0109`（`gate-index-assembly` 那条代理读数的原形）· `f-0080`（同一裁定的另一份记录）；两个真实实例的原文见 `gate-restart-arbitration.test.mjs:348` 与 `gate-index-assembly.test.mjs:1209` |
