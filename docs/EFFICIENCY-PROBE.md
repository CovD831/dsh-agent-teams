# 效率探测报告（2026-10-15）

> **触发**：用户原话 ——
> 「我做这个插件除了希望能做到**无人值守的开发**以外，还希望它能实现**快速迭代开发**。
> 为了解决无人值守的漂移问题我做了很多判决和预防性措施，但这不可避免地会带来**速度上的变慢**。
> 所以在重构优化各个模块、环节、部分时，**还需要考虑到效率的问题，这非常重要。**」
>
> **用户裁定**：选 **(丙)** —— 快环 + 全环两套判定（快环用于迭代，全环用于交付）。
>
> **本文只测量，不修**。所有数字附可复跑命令。

---

## 0. 一句话

**瓶颈极度集中：一次验证的绝大部分时间是 3 个夹具的 64.5 秒，而全仓有 15 个夹具在"扫全仓"。**
⇒ 分层的收益极大，**且不需要放宽任何判据**。

---

## 1. 测量一：`verify` 22 步各自的耗时

| 步骤 | 耗时 | 退出 |
|---|---|---|
| `verify.mjs` | **0.2s** | 1（★ 8 条 UI 断言红，见 §4） |
| `verify:quality-gates` | 0.2s | 1 |
| **`verify:gates`（88 夹具）** | ★ **39.8s** | 1 |
| `verify:harness-contract` | 0.7s | 1 |
| `verify:http-body` | 0.1s | 0 |
| `verify:compatibility` | 0.6s | 0 |
| `verify:capabilities` | 0.8s | 0 |

⇒ **除 `verify:gates` 外几乎全是亚秒级。** 效率问题**不在"22 步太多"，而在"其中一步极贵"。**

★ 而 `verify` 是 **`&&` 串行**的：第一步 `verify.mjs` 就红 ⇒ **后面 21 步一步都不跑**。
所以当前"一次迭代的真实成本"**不是总时长，而是"撞上第一条红就停"**。
而那 8 条红**是既有的、与本轮改动无关的存量**（`src/` 全程零改动，已核）。

---

## 2. 测量二：88 个夹具逐个计时

```
串行总计 80.8s（单跑累加；整包跑为 39.8s —— node --test 有内部并发）
```

**最贵的 10 个（占 80%）：**

| 耗时 | 夹具 |
|---|---|
| **22.9s** | `gate-producer-consumer` |
| **16.9s** | `gate-friction-capture` |
| **15.5s** | `gate-mutation` |
| 1.8s | `gate-worktree-arrival` |
| 1.6s | `gate-stale-module` |
| 1.4s | `gate-readout-uniform` |
| 1.3s | `gate-wording-sources` |
| 1.1s | `gate-requires` |
| 1.0s | `gate-completion-hardening` |
| 0.9s | `gate-position-wiring` |

⇒ ★ **最贵 3 个合计 55.3s**，而第 4 名起就掉到 1.8s 以下。
**这不是"普遍慢"，是"三个特例"。**

---

## 3. ★ 根因：成本随**仓库规模**线性增长

`gate-producer-consumer`（22.9s）的实际成本来源（`:58-157`、`:319-336`）：

```js
function walk(dir, extensions) { … readdirSync … }        // :58  全目录遍历
const srcFiles    = walk(join(root,'src'),    ['.ts'])
const scriptFiles = walk(join(root,'scripts'),['.mjs','.js'])
for (const file of [...srcFiles, ...scriptFiles])
    textByFile.set(rel(file), stripComments(readFileSync(file,'utf8')))  // :157 逐文件全量读
```

⇒ **它 walk 整个 `src/` 与 `scripts/`，把每个文件读进来做文本分析。**

**这一类夹具的规模**：
```
含目录遍历的夹具     15 个
全仓源文件（扫描基数）  260 个（src + scripts 的 .ts/.mjs）
```

⇒ ★★ **成本是 O(仓库规模) 的。** 仓库每长大一点，这 15 个夹具就一起变慢。
**这解释了用户观察到的"加了东西之后速度变慢"——它不是感觉，是结构。**

---

## 4. ★ 测量三：为什么"第一步就挂"

```
0.2s  verify.mjs  ⇒ exit=1
```

`scripts/verify.mjs` 里有 **8 条 client/UI 断言**，**全部是红的**：

```
FAIL  client uses the uiConversation event registry and registers the official locale namespace
FAIL  discarded and stopped teams render terminal semantics instead of pending execution copy
FAIL  working member and captain states use the host semantic business color …
FAIL  running DAG tasks reuse the animated work glyph without losing focus context …
FAIL  running tasks surface the assignee model on the activity card …
FAIL  member model badge renders compact text inline with full-route metadata …
FAIL  delegation list collapses finished members and sorts them by finish time (issue #192) …
FAIL  member model badge is a compact neutral inline pill that truncates without overflowing …
```

★ **它们是存量红**（`src/` 本轮零改动；`TEST-TRIAGE.md` 已把它们归入既有基线）。

⇒ **后果**：任何人跑 `pnpm verify`，**0.2 秒后看到失败并停下**，而真正有价值的 21 步**从未执行**。
**这会让"验证"看起来又快又没用 —— 实际上快是因为它什么都没跑。**

---

## 5. 由测量推出的分层方案（支撑用户的"丙"）

### 5.1 快环（迭代用，目标 **秒级**）

| 内容 | 预估耗时 | 依据 |
|---|---|---|
| `tsc` 类型检查（host + client） | **~1s** | 实测 |
| ★ **只跑受影响的夹具** | 秒级 | 见 5.3 |
| ⇒ 合计 | **数秒** | |

### 5.2 全环（交付用）

```
全部 88 夹具 + 其余 21 步  =  约 40–60s（今日实测 39.8s + 亚秒级余项）
```

★ **重要**：全环**不需要放宽任何判据**。测得的总量本就只有 40–60 秒量级；
问题从来不是"全环太慢"，而是**"全环被前面的红挡住了，跑不到"**。

### 5.3 ★ 快环的关键机制：受影响夹具选择

不做这个，快环就退化成"要么全跑 40s，要么不跑"。

**依据现成**：每个任务契约都带 `inScope`（工作区相对路径清单），
而夹具与源码的对应关系**可机械推导**（夹具名字/内容里引用哪些源文件）。

```
快环 = tsc + { 夹具 f : f 引用了 inScope 里的任一文件 }
```

★ 这**不新造判据**，只是选择"跑哪些"。**判定语义一个字不改。**

### 5.4 ★ 但有一类必须例外：15 个扫全仓的夹具

上面那 15 个夹具**扫全仓**，所以**任何改动都可能影响它们** ⇒ **它们不能按 inScope 剪枝**。

⇒ 处置：把这 15 个**归入全环**（或单独一组"全仓类"）。
**代价**：它们的 64.5 秒（最贵 3 个 + 其余）在全环里必然支付。

★ 而这也给出了**一个后续优化方向**（本文不实施）：
那 15 个的 `walk + readFileSync` 可以**缓存**（同一次运行内读一次）。
`gate-producer-consumer` 的 22.9s 里，相当部分是**把同一批文件读了多遍**。

---

## 6. 与本次重构的关系（为什么这条必须进 DAG）

| 事实 | 对 DAG 的影响 |
|---|---|
| `verify` 是 22 步 `&&` 串行 | ★ **8 条并行线每验证一次都要付这个成本** ⇒ 效率是**并行度的约束** |
| 第一步就挂 | 多线并行时，**每条线都可能撞上同一个存量红** ⇒ 重复浪费 |
| 15 个扫全仓夹具 = O(仓库规模) | ★ **M 线（模块拆分）会动仓库结构** ⇒ 可能影响这批夹具的成本与正确性 |

⇒ **效率不是优化项，是一等约束。** 已提议加 **P 线（性能）**：

| 步 | 内容 | 是否需用户拍板 |
|---|---|---|
| P1 | 分快环/全环（`pnpm verify:fast` / `verify`） | 否（不改判据） |
| P2 | 受影响夹具选择（依 inScope） | 否 |
| P3 | ★ **存量红分流**：区分"本次改动造成"与"历史存量"，使存量红不阻塞后续步骤 | **是** —— 会改判定语义，且与 `completion.backtest`「基线先绿才能归因」冲突 |
| P4 | 判据成本可见（每条判据记录自己的耗时） | 否 |
| P5 | 15 个扫全仓夹具的读取缓存 | 否 |

★ **P3 是唯一需要用户裁定的**，其余四条都是"不改语义、只改调度"。

---

## 7. 未测 / 测不了（不许当结论）

1. **全环的完整时长未测** —— 因为第一步就挂，21 步从未跑完。上述 40–60s 是**分段测量之和**，不是端到端实测。
2. **`node --test` 的内部并发度未知** —— 单跑累加 80.8s，整包 39.8s，差 2×，但并发上限未取证。
3. **快环的秒级预估未实测** —— P1/P2 尚未实现。
4. **P5 的收益未测** —— "读了多遍"是从源码推断的，未做 I/O 计数。

---

*本文只写 `docs/`。未改动任何 `src/`、`scripts/`、`lib/` 文件。*
