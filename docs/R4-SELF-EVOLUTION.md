# R4 · 上报路径自进化：基线 + 可行性判定（t64）

> **本文件只写 `docs/` 与 `scripts/report-escalation-rate.mjs`。未改 `src/`、`lib/`。**
> **测量点**：语料 `.agent-teams/frictions/`（**384 个文件**，截至 2026-10-14 17:42）。

---

## 〇、★★★ 一句话结论（★ 两件事必须不同形）

| | 状态 |
|---|---|
| **R4 的基线（今天同类卡点的重复上报次数）** | ✅ **已造出**，可复跑（§1） |
| **R4 本身（让同类以后不用再上报）** | ❌ **不可由代码达成** —— 而原因**不是"还没做"，是结构性的**（§2） |

★★ **这两行必须分开读**：R4 的验收是「**该数下降**」，而本任务交出的是「**那个数本身**」。
**"我能数出这个数" ≠ "R4 完成"** —— 前者是后者的**前提**，不是它的**结论**（你的硬纪律 ①）。

---

## 1. 基线（★ 可复跑）

```sh
$ node scripts/report-escalation-rate.mjs
```

### 1.1 语料的三态（★ 先说清分母，再说数）

```
files            : 384
parsed           : 372
unreadable       : 12   ← ★ 不许静默丢，逐个列出（见下）
```

★★ **`384` 与 `385` 的差别也是一个读数**：
```sh
$ ls .agent-teams/frictions/f-*.json | wc -l      ⇒ 384     # 只数 f-*.json
$ node -e "console.log(require('fs').readdirSync('…').length)"  ⇒ 385   # 目录里还有 README.md
```
⇒ 两个命令**都对**，但答的是**两个问题**（"有几条卡点" vs "目录里有几个文件"）。
★ 本报告一律用 **384**（`f-*.json` 口径），并把 385 的差**归给 `README.md`**。

### 1.2 ★ 12 个坏文件：逐个报出（不是一句"有一些读不出"）

```
f-0152.json  (17209B)  Unexpected non-whitespace character after JSON at position 13139 (line 259 column 1)
f-0158.json  (28759B)  Unexpected non-whitespace character after JSON at position 16218 (line 300 column 1)
f-0161.json  (38881B)  Unexpected non-whitespace character after JSON at position 32749 (line 344 column 1)
f-0167.json  (16903B)  Unexpected non-whitespace character after JSON at position 12788 (line 270 column 1)
f-0172.json  (38086B)  Unexpected non-whitespace character after JSON at position 33021 (line 363 column 1)
f-0180.json  (17289B)  Unexpected non-whitespace character after JSON at position 13248 (line 260 column 1)
f-0183.json  (24999B)  Unexpected non-whitespace character after JSON at position 20990 (line 259 column 1)
f-0190.json  (23339B)  Unexpected non-whitespace character after JSON at position 17131 (line 322 column 1)
f-0216.json  (31341B)  Unexpected non-whitespace character after JSON at position 23830 (line 395 column 1)
f-0220.json  (41740B)  Unexpected non-whitespace character after JSON at position 34999 (line 371 column 2)
f-0241.json  (18041B)  Unexpected non-whitespace character after JSON at position 13499 (line 260 column 1)
f-0244.json  (41011B)  Unexpected non-whitespace character after JSON at position 34452 (line 352 column 1)
```
★ 这 12 个与 `docs/GATE-EFFICACY.md` §1 报的**是同一批**（同一形状：**合法的 JSON 头 + 垃圾尾**）——
而那正是 `try{JSON.parse}catch{}` 会**静默吞掉**的那种"坏了"，被读成"不在"。
⇒ ★ **本读取器不吞**：`readCorpus()` 把失败原因与字节数一起收进 `unreadable`，
而**退出码 2** 表示"这条读数不完整"（不是 0）。

### 1.3 ★★ 基线数字（三种口径**并列，不合并**）

★ 契约硬纪律「不许为了让数字好看而合并口径」⇒ 这里**全报**。分母都是 **372 条已解析记录**。

| 口径 | distinct（不同卡点类型） | repeated（重复过的类型） | 落在重复里的记录 | ★ **可省的上报次数** | 最大重复 |
|---|---:|---:|---:|---:|---:|
| `exact`（title 逐字） | 134 | 26 | 264（**71.0%**） | **238** | **149** |
| `hex`（折 ≥7 位 hex） | 122 | 23 | 273 | 250 | 149 |
| `hex-path`（再折引号内容） | 109 | 32 | 295 | 263 | 149 |

**★ "可省的上报次数" 的定义**：每个重复组只报 1 次时，本可少报多少 —— 即 `Σ(count − 1)`。
⇒ **这就是 R4 要压下去的那个数**：今天 **238**（exact 口径，最保守）。

### 1.4 ★ 为什么需要后两种口径（一个真实的口径陷阱）

实测 4 组「重复 title」里嵌了 **commit 哈希**：
```
7×  update_task rejected: [completion.backtest] attribution is impossible: the baseline (ba321305baae723…
7×  update_task rejected: [completion.backtest] attribution is impossible: the baseline (5441b81684972d16…
```
⇒ **逐字口径会把同一件事读成两件不同的事**。
★ 而"折多少"是一个**口径选择**，不是事实 ⇒ 三种**并列报出**，由读的人判断。
★ 本报告的**头条数字取最保守的 `exact`**（238）—— **它最小**，所以它不会把功劳算大。

**Top 重复（exact 口径，前 4）**：
```
149×  update_task rejected:                       ← ★ 空拒绝（即 GATE-EFFICACY 记的"沉淀案例"）
 14×  …[completion.backtest] the baseline state is unavailable, and this task SHOULD have one…
  9×  …[completion.r5] R5 could not locate the new test files…
  9×  …[completion.mutation] no killer suite was declared…
```

---

## 2. ★★★ 第二步：R4 能否由代码达成？—— **不能，而原因是结构性的**

### 2.1 判据（先说清楚我问的是什么）

R4 ＝「**通过上报解决过的卡点，让同类以后不用再上报**」。
⇒ 它要求机制能回答：**「A 类卡点曾经被解决过 ⇒ 现在 A 类再出现时，不要再上报」**。
⇒ 那需要**两个机器可读的事实**：① 某条卡点**属于哪一类**；② 那一类**已被解决**。

### 2.2 ★★ 实测：这两个事实**在台账里从不同时成立**

```sh
$ node scripts/report-escalation-rate.mjs --json   # 数据源；下面的分组是独立复算
```
**独立的决定性读数**（两组**完全不相交**）：

| 集合 | 条数 | 自动记录占比 | `resolution.state` |
|---|---:|---:|---|
| **落在重复组里的记录** | **264** | **264/264 = 100%** | **全部 `(absent)`**（0 条有 state） |
| **有 `state` 的记录** | 27 | 0/27 = **0%** | `fixed` 20 · `scheduled` 6 · `wontfix` 1 |

```
$ 20 条 state=fixed 的 title 逐个查重复次数
f-0001 repeat=1 · f-0002 repeat=1 · f-0003 repeat=1 · … · f-0025 repeat=1
⇒ ★ fixed 的 title 里有几个是重复的: 0
⇒ ★ 而 26 个重复组里，有几个含 fixed: 0
```

### 2.3 ★★ 为什么必然如此（不是巧合，是结构）

```sh
$ sed -n "$(grep -n 'export interface FrictionCapture' src/tools/shared/entities.ts|cut -d: -f1),+22p" src/tools/shared/entities.ts
```
`FrictionCapture` 的字段里**根本没有 `resolution`** —— 它有 `point` / `message` / `context` /
`mechanismState` / `taskId` / `stateRoot` / `couldNotObserve`，而**没有**任何一格可以说"这条解决了"。

⇒ ★★ **`recordFriction` 在结构上不可能把一条自动记录标成 `fixed`。**
⇒ 而**重复的**那 264 条**全部**是自动记录（判据拒绝路径写的），
**有 `state` 的**那 27 条**全部**是人手写的设计缺陷记录（title 各不相同，重复 ×1）。

★★★ **所以 R4 今天面对的不是"机制没写"，而是一个循环**：

```
   要抑制 A 类 ⇒ 必须知道「A 类被解决过」
        但「被解决」只能由【人手填】resolution.state 表达
        而重复上报的 A 类【全部】是自动记录 ⇒ 它们【永远不会】有 state
   ⇒ 没有任何一条重复卡点会被标记为"已解决" ⇒ 没有任何一类能被抑制
```

### 2.4 ★ 卡在哪（如实报出，不粉饰）

| # | 卡点 | 为什么它**不是**"写个函数就能解决" |
|---|---|---|
| **①** | **「被解决」需要人的判断** | `resolution.state = fixed` 的 20 条，其 `fix` 是**自由文本**（`'amend 契约（多次）；后来 admission/requires 机制让…'`）。⇒ 让它机器可比需要**先把"什么叫解决"形式化** —— 而那是**语义决定**，不是编码 |
| **②** | **"同类"的等价类是口径，不是事实** | §1.3 实测：同一批记录，口径一换，重复组从 **26 → 32**、可省次数从 **238 → 263**。⇒ "同类"本身**没有唯一答案** |
| **③** | ★ **抑制方向与台账的另一个用途冲突** | 台账的用途之一是"**如实记录发生过什么**"（`docs/GATE-EFFICACY.md` 的空拒绝案例正是靠它才被定位的）。⇒ 抑制上报**减少的是记录本身** —— 那会让"某类还在发生"**看不见**。★ 这是**取舍**，要人拍板 |
| **④** | ★ **反向半边今天无法构造** | 硬纪律 ④ 要求"若报告下降，必须证明下降由代码造成，不是时间推移或人工忽略"。而今天**连下降都还没有** ⇒ 那条对照臂**只能预写、不能验证**（见 §5） |

---

## 3. ★ 三态（`数字` / `没有数据` / `读不出`）—— 三者不同形

读者要求（本仓最久的纪律，`t60` 的 `{ids, from}` 就是为它设计的）：

| 态 | 何时 | 读数 | 退出码 |
|---|---|---|---|
| **`number`** | 至少 1 条可解析 | 报出**数字 + 分母 + 口径** | **0** |
| **`no-data`** | 目录不存在 / 一条记录都没有 | `the corpus directory does not exist: …` | **2** |
| **`unreadable`** | 文件在，但**全部**解析失败 | `every one of the N files failed to parse` | **2** |

```sh
$ node scripts/report-escalation-rate.mjs                              # ⇒ number, exit 0
$ node scripts/report-escalation-rate.mjs --dir /tmp/definitely-not-here
[r4] CANNOT MEASURE (no-data): the corpus directory does not exist: /tmp/definitely-not-here
exit=2
$ D=$(mktemp -d); printf '{"id":"f-0001",' > $D/f-0001.json
$ node scripts/report-escalation-rate.mjs --dir $D
[r4] CANNOT MEASURE (unreadable): every one of the 1 files failed to parse
exit=2
```
★ **`no-data` 与 `unreadable` 的补救动作相反**（一个去攒语料，一个去修文件），所以**不同形**。
★ 而**部分坏**（12/384）**不**把整体降级为 `unreadable` —— 它是 `number` **+ 一条显式的 `unreadable: 12`**。
  那是刻意的：**"12 条读不出"不等于"读数作废"**，但**必须被看见**。

---

## 4. ★ R 线 §10：R3 的读数与 R4 的基线**并列**（以及两者的关系）

| 线 | 读数 | 单位 | 它们的关系 |
|---|---|---|---|
| **R3**（分诊池） | `self 366 / escalate 6` | **卡点**（每条计一次） | R3 回答「**多少卡点需要人**」 |
| **R4**（本任务） | **可省上报 238**（exact 口径） | **上报次数**（`Σ(count−1)`） | R4 回答「**多少上报是重复的**」 |

★★ **两者不是同一个量，不许相加、也不许互推**：
- R3 的分母是 **372 条卡点**；R4 的分母是 **372 条卡点**，但它的量是**去重后能省下的次数**。
- R3 的 `escalate 6` 与 R4 的 238 **没有关系**：前者是"需要人裁决的卡点"，后者是"重复上报的浪费"。
- ★ 而**它们共享一个前提**：都建立在**同一份台账**上 ⇒ 台账的 12 条坏文件
  对**两者同时**有效（R3 的 366+6=372 也**不含**那 12 条）。

★ **一个值得并列看的对照**：R3 说 **98.4% 的卡点自消化**（`self`），
而 R4 说 **71.0% 的卡点在重复**。⇒ **"不用人管"与"不用再报"是两件事** ——
前者已经做到了，后者今天**一件都没做到**（§2）。

---

## 5. ★ 反向半边：怎么写才能日后证明"下降由代码造成"

**今天写不出"下降"的证据**（没有下降）。但**判据可以现在写下来**，
免得日后有人拿一个下降的数字来邀功。**三条同时成立才允许说"R4 生效"**：

1. **同一口径、同一读取器**：`node scripts/report-escalation-rate.mjs`（`exact` 口径）
   在两个不同时刻跑出的**可省上报次数**，后者 < 前者。
   ★ **口径必须逐字相同** —— §1.3 已证同一批数据换口径差 25 次，混口径能把任何结论做出来。
2. **★ 控制时间推移**：按**时间窗**切分，比较**同类卡点的"每窗新增次数"**是否下降。
   ★ 只看总数会把"新卡点本来就更少"读成"抑制生效"（你的硬纪律 ④ 第 1 条）。
   ⇒ 判据形式：取两个等长窗口 `W1` / `W2`，若 `W1` 里某类出现 7 次而 `W2` 里 0 次，
   **且该类的抑制键在 `W1` 结束时已被写入** ⇒ 那是代码造成的。
3. **★ 控制人工忽略**：抑制**必须留痕**（抑制键 + 生效时刻 + 被抑制的次数）。
   ⇒ 若"某类不再上报"而**没有**一条抑制记录 ⇒ 那是**有人手工关掉了**，不是代码。
   ★ 本仓现成的形状：`auto.observed` 与 `resolution.state` 都是"留下痕迹"的先例。

★ **一条现在就能有的坏消息**（可核）：要实现 3，必须有个地方**写下抑制键**。
而 §2.3 已证 `FrictionCapture` **没有**任何一格承载它 ⇒ **这一步也要一份契约改动**，
不是"加个字段"那么轻。

---

## 6. 净变化（判据是集合）

```sh
$ pnpm test:gates
ℹ tests 1471 · pass 1415 · fail 19 · skipped 37        ⇒ **与任务书给的基线（1415 / 19）逐字相同**
```

★ **失败文件集合 15 个**：`gate-baseline-known-failures` · `gate-contract-build-artifacts` ·
`gate-falsification-pairs` · `gate-input-wiring` · `gate-producer-consumer` ·
`gate-repair-completion` · `gate-reviewed-passthrough` · `gate-source-reading-convention` ·
`gate-stale-module` · `gate-t1-completion-probe` · `gate-worktree-arrival` ·
`verify-admission` · `verify-input-requires` · `verify-runtime-integration` · `verify-unified-pipeline`
—— ★ **全部是已知存量红**。

★★ **其中一个必须单独证明"不是我造成的"**：`gate-source-reading-convention` 是**扫全仓**的，
而本任务**新增了一个 `scripts/` 文件** ⇒ 它**有可能**被新文件绊倒。**我实测排除了这个可能**：
```sh
$ grep -c "src/" scripts/report-escalation-rate.mjs      ⇒ 0    # 它【只读】.agent-teams/frictions
$ mv scripts/report-escalation-rate.mjs /tmp/ && node --test scripts/gate-source-reading-convention.test.mjs
ℹ pass 5 · fail 1                                        # ← 移走我的文件后【读数完全相同】
```
⇒ **它的红是存量**（它报的是"**别的夹具**直接读 `src/tools/**` 的文本"共 2 处，
而那 2 处**不在本任务写域**）。
★ 另复核两个同样扫全仓的：`gate-shared-artifact-writes` **5/5 绿** · `gate-wording-sources` **8/8 绿**。

⇒ ★★ **`pnpm test:gates` 净新失败 = 0**（且计数与基线**逐字相同**）。
★ 本任务**未放宽任何断言**：新增的是一个**只读**读取器 + 一份文档。

---

## 7. ★ 交给下一个人的四条

1. ★★ **不要把"基线已造"读成"R4 完成"** —— §2 已证**机制不可由代码单独达成**。
   要做 R4，**先做的是 §2.4 的 ①（形式化"什么叫解决"）**，而不是写抑制函数。
2. ★ **这份基线是"某时刻"的**：台账会随新卡点增长。⇒ 任何"下降"的断言**必须附两次读数**。
3. ★ **口径必须一起引用**：只报"238"而不报"exact 口径 / 372 分母"是不可复跑的。
4. ★ **`no-data` 与 `unreadable` 不许合并**（§3）—— 它们的补救动作相反。
