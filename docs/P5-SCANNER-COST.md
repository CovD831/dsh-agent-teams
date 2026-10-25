# P5 · 扫全仓夹具的成本：从 O(符号×文件×行) 降到一次遍历

> **目标文件**：`scripts/gate-producer-consumer.test.mjs`（唯一改动的源码文件）
> **基线**：HEAD `3b80827`（worktree `task-agent-teams-refactor-t62`）。开工前 stamp 陈旧（`0b29ba5`），已先 `pnpm build` 对齐。
> **性质**：**纯性能改动** —— 语义逐条不变（证明见 §4）。

---

## 0. 一句话

`moduleLevelProducers` 的算法是 **`O(符号 × 文件 × 行)`**：670 个符号各自编译一个新正则、
各自把 76 个文件的**全文重切一遍行**去匹配 ⇒ **50,920 次全文扫描**。
改成**一次遍历建倒排索引**后：**21.7s → 0.33s（≈65.8×）**，而**559 个符号的三态判定逐条不变**。

---

## 1. ★ 复核队长的诊断（我独立复跑，结论一致）

### 1.1 热点不是 I/O —— 我用 CPU profile 复核

**改前**（`node --cpu-prof` 跑原实现）：

```
profile: total=21574ms  samples=14447
   12076.5ms   56.0%  (anon) @ gate-producer-consumer.test.mjs:168   ← ★ 逐符号×逐文件的全文扫描
    5537.7ms   25.7%  moduleLevelProducers @ gate-producer-consumer.test.mjs:131
     264.7ms    1.2%  (anon) @ :263
     247.9ms    1.1%  (anon) @ :398
     241.1ms    1.1%  (anon) @ :198
     186.1ms    0.9%  (program)
     135.4ms    0.6%  (garbage collector)
      41.8ms    0.2%  readFileUtf8 @ :0          ← ★ I/O 只占 0.2%
```

⇒ **队长报的「热点不是 I/O」成立**：真正的热点在 `:168` 那个
`for (符号) { for (文件) { source.split('\n').forEach(...) } }` 的内层，
而 `readFileUtf8` 只占 **0.2%**（队长实测 0.6%，同一量级，差异来自机器负载）。
★ `moduleLevelProducers` 自己占 25.7%，是把内层闭包的样本归属之外的开销 ——
**两处相加 = 81.7%**，全部是**算法形状**造成的，不是 I/O。

### 1.2 规模复核

```sh
$ node /tmp/dump3.mjs | wc -l      # 导出符号数（改前）
559
$ node -e "…walk(scripts…)…"       # 文件数
```
⇒ **559 个符号 × 76 个文件**（队长报 670 × 76；符号数因仓库演进从 670 降到 **559**，
**不改变结论的方向**：仍是"符号数 × 文件数"的乘积，仍随每加一个导出线性增长）。
★ 另两处已确认的浪费，我逐条核过：
- **同文件读两次**：`:141`（收集导出）与 `:157`（建 `textByFile`）各 `readFileSync` + `stripComments` 一次；
- **每符号编一个新正则**：`new RegExp('\\b'+name+'\\b','g')` 在符号循环里。

---

## 2. 改法（三条独立改动，各自可测）

| # | 改动 | 改动前 | 改动后 |
|---|---|---|---|
| ① | **每文件读一次 / 剥注释一次** | `readFileSync`+`stripComments` **调用点 3 处**（`:141`/`:157` 对同一批文件重复） | **调用点 2 处**（`:161` 统一；`:415` 是另一条臂的独立用途，未动） |
| ② | **每文件切一次行** | 在符号循环里**每符号重切全部文件** | 建索引时切**一次**，存进 `perFile` |
| ③ | **符号匹配只扫一遍全文** | 559 符号 × 76 文件 = **42,484 次全文扫描** | **一次**遍历建倒排索引 `符号 → 文件 → 行号集合` |

★ **两种口径都要给**（它们的差是 `import` 那一行）：

```sh
# ★ 契约给的命令（含 import 行）：
$ grep -c "readFileSync" /tmp/pc-orig.mjs                            # 改前 ⇒ 4
$ grep -c "readFileSync" scripts/gate-producer-consumer.test.mjs     # 改后 ⇒ 3
# ★ 只看【调用点】（带左括号）：
$ grep -c "readFileSync(" /tmp/pc-orig.mjs                           # 改前 ⇒ 3
$ grep -c "readFileSync(" scripts/gate-producer-consumer.test.mjs    # 改后 ⇒ 2
```

★ 差 **1** 就是 `:47` 的 `import { readFileSync, … } from 'node:fs'` —— 它不随改动变化。
★ 两处调用点去掉的是 **`:141` 与 `:157` 对【同一批 src 文件】的重复读/重复剥注释**
（合并成 `:161` 一次）；剩的 `:415` 属于**另一条臂**（ctx 格那条），**本改动未动它**。
★ 严格说本改动消掉的是 **1 次重复读**（不是"读 3 减到 2"这个表面差）：
原来同一份 `src/**` 文本被 `stripComments` 处理**两次**，现在**一次**。

### 2.1 等价性口径（这是本改动的核心）

旧实现数的是**一行里该符号出现几次**：

```js
const pattern = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'g')
...
const hits = (line.match(pattern) ?? []).length     // ← 是【出现次数】，不是"这一行有没有"
```

新实现**保留同一口径**：建索引时按 token 找候选行，**统计时仍用
`occurrencesInLine` 复算真实出现次数** ⇒ **按出现次数累加，不做行去重**。

★ **`$` 的边界**（最容易错的一处）：`\b` 的词字符集是 `[A-Za-z0-9_]`，**不含 `$`**。
⇒ 不能简单按 `[$A-Za-z0-9_]+` 切 token（那样 `foo$` 会成为一个 token，
而 `\bfoo\b` 在 `foo$` 里**其实是命中的**）。`tokenize` 按 `[A-Za-z0-9_]+` 切，
并对每个片段**同时**产出「片段本身」与「片段 ⊗ 邻接 `$` 串」，覆盖 `NAME` / `NAME$` / `$NAME` 三形。

★★ **但正确性不靠这段论证** —— 它由 §4 的**逐条对拍**机械保证（论证只解释"为什么它们应当一致"）。

---

## 3. 改前 / 改后读数

### 3.1 耗时（各 3 次，同一台机）

| | run1 | run2 | run3 | 中位 |
|---|---:|---:|---:|---:|
| **改前** | 21.81s | 21.65s | 21.56s | **21.7s** |
| **改后** | 0.37s | 0.32s | 0.32s | **0.33s** |

⇒ **≈65.8× 加速**。

### 3.2 改后 profile（对比 §1.1）

```
profile: total=304ms  samples=197
      55.4ms   18.2%  (anon) @ gate-producer-consumer.test.mjs:194
      52.4ms   17.2%  tokenize @ gate-producer-consumer.test.mjs:250
      45.7ms   15.0%  readFileUtf8 @ :0
      25.2ms    8.3%  moduleLevelProducers @ gate-producer-consumer.test.mjs:131
      21.1ms    6.9%  RegExp: [A-Za-z0-9_]+ @ :0
      18.5ms    6.1%  (garbage collector) @ :0
      15.7ms    5.2%  occurrencesInLine @ gate-producer-consumer.test.mjs:267
```

★ **一个值得记下的形状变化**：改后 **`readFileUtf8` 从 0.2% 升到 15.0%** ——
不是 I/O 变慢了（绝对时间 41.8ms → 45.7ms，几乎没动），而是**分母塌了**（21574ms → 304ms）。
⇒ 此时 I/O 才成为可见成本，而**它已不是瓶颈**（最大的两项仍是索引与 tokenize）。
★ 这是一条通用教训：**"某项占比上升"不等于"它变慢了"** —— 必须同时报**绝对值**。

### 3.3 全环影响（P 线的原始动机）

`pnpm test:gates` 全量：

| | tests | pass | fail |
|---|---:|---:|---:|
| **改前（实测基线）** | 1471 | 1413 | 20 |
| **改后** | 1471 | 1413 | 20 |

★ **基线口径修正**：任务书给 **1415 pass / 19 fail**，而我在**动任何代码之前**实测本 worktree
= **1413 pass / 20 fail** ⇒ **差异先于我的改动存在**。⇒ 净新失败 = **0**、净减少 = **0**。

★ 这同时回答了 t61 的那个结论（「快环只省 6s，因为 89% 是动不了的固定开销」）：
**那 89% 里有 21.7s 是这一个夹具**，而它现在只要 **0.33s**。

---

## 4. ★★ 语义等价的机械证明（本改动的验收核心）

### 4.1 全量对拍：559 个符号的三态逐条相同

**做法**：把 `moduleLevelProducers` 从**改前/改后**两份源码里各剥出一个可执行副本
（去掉 `test(...)` 块，`ROOT` 显式注入），各跑一遍全仓，输出
`名字 \t 裁决 \t production \t fixture \t 定义位置`，然后 `diff`。

```sh
$ node /tmp/base-clean.mjs > /tmp/vb.tsv    # 改前（来自 git HEAD 的原文）
$ node /tmp/head-clean.mjs > /tmp/va.tsv    # 改后（当前工作树）
$ wc -l /tmp/vb.tsv /tmp/va.tsv
     559 /tmp/vb.tsv
     559 /tmp/va.tsv
$ diff /tmp/vb.tsv /tmp/va.tsv
（无输出）                                    # ★ 逐条相同
```

**裁决分布（两边一致）**：

| 裁决 | 数量 |
|---|---:|
| `consumed` | 425 |
| `fixtureOnly` | 26 |
| `unconsumed` | 6 |
| `unmeasured` | 102 |
| **合计** | **559** |

★ **`production` 与 `fixture` 两个计数也逐条相同** —— 不只是裁决相同。
（这一点重要：裁决相同但计数不同，说明口径已经在漂，只是还没跨过阈值。）

★ **一次自我纠错（留痕）**：我第一版对拍脚本（用行号切片抽函数）**算出的
`name` 的 fixture 是 1677，而改后是 1681**，看上去像语义漂移。
回源后发现是**我的抽取脚本切错了函数边界**（切到 `193` 而函数实际止于 `192`）；
改用**剥 `test` 块 + 显式 `ROOT`** 的干净抽法后，两边都是 **1681**，
`diff` 全空。⇒ **先怀疑自己的量具，再怀疑被测对象** —— 否则会把量具误差报成语义变更。

### 4.2 ★ 反向半边：构造四种符号，逐个验三态判对

夹具自带的 **臂 1**（三态不同形）与 **臂 5**（定向突变：拿掉生产消费点 ⇒ fixtureOnly；
拿掉夹具消费点 ⇒ unconsumed）**都通过**。另**独立**写了一份不依赖夹具的沙箱验证：

```sh
$ node /tmp/tristate-author.mjs
OK   alpha     want=consumed     got=consumed        # src 内有生产消费
OK   beta      want=fixtureOnly  got=fixtureOnly     # 只被 scripts/ 消费
OK   gamma     want=unconsumed   got=unconsumed      # 无人消费
OK   delta     want=unmeasured   got=unmeasured      # 定义在 src/client/**（可扫范围之外）
OK   epsilon   want=unconsumed   got=unconsumed      # ★ 定义行【自引用】不算消费
★ 四态全部判对（含定义行自引用不算消费）
```

★ 第五个用例（`epsilon`）是**专门针对"定义行排除"那条口径**的：
`export const epsilon = epsilon` 里 `epsilon` 在**它自己那一行**出现，
按口径**必须**不计消费（否则每个导出都"消费了自己"）⇒ 判 `unconsumed` 正确。

### 4.3 夹具自身：全绿且断言条数不减少

| | tests | pass | fail | ✔/✖ 行数 |
|---|---:|---:|---:|---:|
| **改前** | 5 | 4 | 1 | 7 |
| **改后** | 5 | 4 | 1 | 7 |

★ **臂数、断言条数一字未减**（7 = 5 个 `test` + 2 行汇总，两版一致）。
★ **那 1 个失败是【改动前就存在】的**（臂 4 的全仓读数上限），且**报文逐字相同**：

```
改前 & 改后（同一句，我逐字比对过）：
★ "只有夹具消费"的产出涨到了 26（记账值 20：17 + worktree-reclaim 的两条 + verdictState）
  —— ★ 而若多出的那一条是 readContractGateVerdict（src/quality-gates.ts:1301），它【不许】被记账
```

★ **我没有动这条断言**（"不许为了让测试变绿而放宽断言"）。它报的是**仓库现状**（26 vs 记账 20），
与本次性能改动无关 —— 改前改后**同为 26**。

---

## 5. 本报告的局限（如实留白）

1. **符号数 559 ≠ 队长的 670**：那是仓库演进（导出数变化），不是口径差；
   我**没有**去核实 670 出自哪个时点的哪条命令。
2. **未改 `friction-capture`**：任务书说"若同形先报队长"。我**只核了它的耗时占比**
   （t61 报 20.4s），**未逐行核它的算法形状** ⇒ 它在不在同一形态，**我判不了**，留给队长定。
3. **未做多机 / 多次长跑的稳定性统计**：3 次读数已足够区分 21.7s 与 0.33s（量级差），
   但**没有**报置信区间。
4. **`tokenize` 的 `$` 处理靠对拍而非证明**：我用**全量 559 符号的对拍**验证了它，
   但**没有**做形式化论证；若将来出现新的 `$` 形态命名，应重跑 §4.1 的对拍。
5. **未评估内存**：倒排索引把"符号 → 文件 → 行号集合"常驻，而旧实现是流式的。
   实测 GC 占比 6.1%（改后），**未测量峰值 RSS**。

---

*本文件只写 `docs/P5-SCANNER-COST.md`。改动仅 `scripts/gate-producer-consumer.test.mjs`
（`+93 / −14`）。未改 `src/`、`lib/`、其它 `scripts/`、以及任何断言。*
