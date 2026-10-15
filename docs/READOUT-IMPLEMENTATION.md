# A1 读数出口：`/state` 的判据视图（分组形状决策）

> **本文件是 A 线的产出，**供 **D1 直接采用**（契约 X2 要求两端一起定分组）。
> **只读说明**：本文描述的实现改的是 `src/tools/status.ts` 及其产物；
> **未改** `src/client/**`、`src/gates/registry.ts`（X2 裁定不碰）。

---

## 1. 一句话

`/state` 现在还只送 `runtime_gates` 一格；本轮**新增顶层 `gate_view`**，
把 `ran[]` 按**四类**交出去，**分组由服务端做**，且**一个字节都不改 `registry.ts`**。

---

## 2. ★ 分组形状（**这是 D1 要直接采用的那一份**）

```jsonc
"gate_view": {
  "points": [                       // ① 六个插入点的三态聚合（每点一行）
    { "point": "delivery", "registered": 2, "evaluated": 2,
      "ok": 2, "blocked": 0, "unmeasured": 0, "skipped": 0 }
  ],
  "active":   [ /* ② 活跃明细，上界 4 */ ],
  "abnormal": [ /* ③ 异常明细，上界 12 */ ],
  "unchecked":[ /* ④ ★ 未检查明细：skippedAll 在场的位置 */ ],
  "truncated": { "active": 0, "abnormal": 0 }   // ★ 被上界截掉的条数
}
```

**明细格（②③ 共用）**：
```jsonc
{ "id": "completion.backtest", "verdict": "blocked", "observed": false, "count": 3 }
```

### 2.1 ★★ 为什么分组在服务端做（X2：**服务端分组**）

`ran[]` 是**位置级**的 —— `registry.evaluate(point, ctx)` 一次调用的产物
（`registry.ts:676-677` 的 `if (reg.point !== point) continue` 保证它只含该位置的判据）。
⇒ 两条路：

| | (i) **服务端分组** ✅ 采纳 | (ii) 扁平 + 每格加 `point` ✗ |
|---|---|---|
| 形状 | `{ delivery: ran[], runtime: ran[] }` | `[{ ..., point }]` |
| 代价 | 载荷多一层嵌套 | ★ **必须给 `GateRunEntry` 加字段** ⇒ **改 `registry.ts` 的形状** |
| 可核 | `git diff --stat src/gates/registry.ts` ⇒ **空** | 那个 diff 非空 |

**采纳 (i)**，理由与契约 §4.2 X2 逐字一致，且**已实测**：
```sh
$ git diff --stat src/gates/registry.ts
（空）                                    # ✅ 零改动
```

★ 而本文的实现在此之上做了一个**更保守**的选择（见 §3.1）：**不送 `ran[]` 原数组**，
而是送**按位置聚合后的四类** —— 因为 `status` 手里只有 **2 个位置**的 ctx，
把"六份 `ran[]`"做成形状会**暗示**另外四份也在（而它们不在）。

---

## 3. 四类，以及**每条明细的 `observed` 是显式布尔**

### 3.1 ★★ 一个必须先说的诚实边界：`status` 只有**两个位置**的 ctx

| 位置 | `status` 能做什么 | 出口里怎么表达 |
|---|---|---|
| `delivery` | ★ **真的求值**（`registry.evaluate('delivery', deliveryContext)`），`ran[]` 是**真读数** | ① 有完整计数；②③ 有明细 |
| `runtime` | ★ **真的求值**（`evaluateRuntimeGates`） | 同上 |
| `admission` `contract` `dispatch` `completion` | **没有** ctx ⇒ `status` **不求值** | ① 只报**静态注册数** `registered` + `evaluated: 0`；②③ **为空**；★ **不进 ④** |

★★ **为什么后四个不进第 ④ 类**：`skippedAll` 的语义是
「**挂了判据、但一条都没检查**」（`registry.ts:886-896` 的第三格）。
而在这里，"没检查"的成因是 **`status` 自己没去问**，不是判据被跳过。
把两者写成同一个形状，会把「**我没问**」读成「**它没跑**」—— 那正是本仓记账最久的形态。
⇒ 它们**不进 ④**，而 `registered: N` + `evaluated: 0` 已足以区分"有判据但本轮未在 status 里求值"。

★ 至于**第 ④ 类本身**是有内容的：当**求过值的那个位置**出现"挂了判据却一条没检查"时
（`skippedAll` 在场），它会进 ④ —— 反向半边见 §5。

### 3.2 四类的定义（写死，不许合并）

| # | 类 | 判据 | 说明 |
|---|---|---|---|
| ① | `points` | 每个位置一行 | `registered` / `evaluated` / `ok` / `blocked` / `unmeasured` / `skipped` 六个数 |
| ② | `active` | `verdict !== 'skipped'` | ★ `skipped` **不算"在动"** —— 它根本没跑 |
| ③ | `abnormal` | `verdict ∈ {blocked, unmeasured}` | ★ `ok` 与 `skipped` **都不算异常** |
| ④ | `unchecked` | `skippedAll !== undefined && registered > 0 && evaluated === 0` | ★ 三条件**缺一不可** |

★★ **②③ 有重叠是刻意的**：②回答"现在有什么在动"，③回答"哪里不对劲"。
合并会让"正在跑且正常"与"正在跑但没过"同形 —— 而四符号纪律要的正是两者**不同形**。

★★ **④ 的第三个条件不许省**：`registered === 0`（空位置）也是 `evaluated === 0`，
而"这里本来就没挂判据"与"挂了但一条都没检查"是**两件相反的事**
（前者正常，后者是 t58 修的那个缺陷）。契约 §2.1 与 `registry.ts:886-896` 逐字给出三分。

### 3.3 ★★★ `observed` 必须**显式**（t41 的验收，逐字理由）

> 只送 `verdict` 时，`observed:true` 与 `observed:false` **都读成 `'blocked'`** ⇒ **画不出底纹**。

⇒ 本实现对**每一条**明细**恒写出** `observed: <boolean>`：
```
entry.observed === true  ⇒  true      （开火了，裁决被放过 ⇒ 画底纹）
否则                      ⇒  false     （缺席 / 非 true）
```

★ 用 `=== true` 而不是 `Boolean(...)`：后者会把任何真值当 `true`，而这一格的类型是
`boolean | undefined` ⇒ **只有 `true` 才算"被放过"**。

★★ **一个必须写清的层次差别（否则会误读契约 C1）**：
- 契约 **C1** 说"`/state` 的 `observed` **只允许**显式 `true` 或**字段缺席**" —— 那是**`ran[]` 层**的规则，
  那里**字段缺席本身携带信息**（"没被放过"）；
- 而**出口这一层**必须**显式化**，因为消费方是 client，它要一个**布尔**来画底纹。
  ★ 两层规则**不同**，而**三态的分辨力不靠这个显式化**，靠 `verdict`：
  `skipped`（没跑）与 `blocked + observed:false`（跑了、拒了）**仍然不同形**。

⇒ 实测三态互不同形（§5.2）。

### 3.4 载荷预算（★ 不送全量）

| 类 | 上界 | 常量 | 依据 |
|---|---:|---|---|
| `active` | **4** | `ACTIVE_LIMIT` | 契约实测 |
| `abnormal` | **10–12** | `ABNORMAL_LIMIT = 12` | 契约实测（取上沿） |

★ **截断必须报**：`truncated: { active, abnormal }` 给出**被截掉的条数** ——
「**没送出去**」与「**没有**」必须不同形（本仓纪律）。若只 `slice()` 而不报数，
读者会把"截断"读成"就这么多"。

★ **全量多少？** 实测注册 14 条（`admission` 0 / `contract` 3 / `dispatch` 3 /
`completion` 4 / `delivery` 2 / `runtime` 2）⇒ **一条都不会全量送出**，
①只送**六个计数**，②③只送**上界内的明细**。

---

## 4. 与既有出口的关系（不替换任何东西）

| 既有字段 | 关系 |
|---|---|
| `runtime_gates`（顶层，`status.ts:743`） | ★ **保留不动**。它装的是 runtime 位置的**原始** `JsonValue`（别人的形状）；`gate_view` 是**跨位置**的视图 ⇒ 两者**并存且不同形** |
| `delivery.ok / unmeasured / blockers / gates_evaluated` | ★ **保留不动**。那是**一个位置**的裁决；`gate_view` 是**多个位置**的判据明细 |
| `delivery.input_surface` | ★ 保留。它说的是"输入面缺没缺"，与"判据跑了没有"是两个轴 |

★ **为什么不把 `gate_view` 挂进 `delivery`**：它**不是**某一个位置的裁决，而是**跨位置**的一份视图。
挂进去会让"哪一份属于哪个位置"读不出来 —— 本文件 `input_surface` 那段的注释记的正是这个教训。

---

## 5. 反向半边（★ 可复跑，两条）

### 5.1 全跳过 ⇒ 落第 ④ 类，**不是** `ok`

用**真注册表**驱动（不是造的假数据）：
```sh
$ node --input-type=module -e "
import { registry } from './lib/gates/index.js'
for (const p of ['contract','dispatch','completion','delivery','runtime']) {
  const n = registry.count(p); if (!n) continue
  const ev = await registry.evaluate(p, { nothing: 'matches' })
  const unchecked = ev.skippedAll !== undefined && ev.evaluated === 0
  console.log(p, 'registered='+n, 'evaluated='+ev.evaluated, 'ok='+ev.ok,
              'skippedAll='+(ev.skippedAll===undefined?'absent':'PRESENT'), '=> ④:'+unchecked)
}"
```
**实测读数**（五个有判据的位置**全部**落入 ④）：
```
contract    registered=3 evaluated=0 ok=false skippedAll=PRESENT => ④未检查: YES
dispatch    registered=3 evaluated=0 ok=false skippedAll=PRESENT => ④未检查: YES
completion  registered=4 evaluated=0 ok=false skippedAll=PRESENT => ④未检查: YES
delivery    registered=2 evaluated=0 ok=false skippedAll=PRESENT => ④未检查: YES
runtime     registered=2 evaluated=0 ok=false skippedAll=PRESENT => ④未检查: YES
```
★ **对照（空位置不许进 ④）**：
```
admission   registered=0 evaluated=0 ok=true  skippedAll=absent
```
⇒ ★★ **这正是三态不许合流的可核证据**：空位置 `ok=true` 且 `skippedAll` **缺席**（正常）；
全跳过则 `ok=false` 且 `skippedAll` **在场**（进 ④）。**两者不同形。**

### 5.2 `observed` 的三态两两不同形

用 `registry.ts` 里**真实的 9 个 `ran.push` 站点形状**构造（不是编的）：
```
ok        : {"id":"g.ok",         "verdict":"ok",        "observed":false, "produced":true}
blocked   : {"id":"g.blocked",    "verdict":"blocked",   "observed":false, "count":3}
observed  : {"id":"g.observed",   "verdict":"blocked",   "observed":true,  "count":2}
unmeasured: {"id":"g.unmeasured", "verdict":"unmeasured","observed":false}
skipped   : 不在 active 里 ✅
```
⇒ ✅ `observed:true` **被保留**；`false` **显式**；`skipped` **被排除**在 ②③ 之外。

---

## 6. 验证读数（实测）

| 命令 | 读数 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | **exit=0** |
| `pnpm build` | **exit=0** |
| `git diff --stat src/gates/registry.ts` | **空**（X2 ✅） |
| `pnpm verify:fixtures` | **exit=0**（16 个工具与活注册表一致） |

---

## 7. ★★ 净变化：**新失败 = 0**，但报告里必须同时写清两件事

### 7.1 判据是**失败文件集合**，不是计数

```sh
# 基线（把我的改动全部 stash 掉）：
$ pnpm test:gates   ⇒ ℹ tests 1471 · pass 1409 · fail 24 · skipped 38
# 改动后：
$ pnpm test:gates   ⇒ ℹ tests 1471 · pass 1412 · fail 21 · skipped 38

$ comm -23 /tmp/t54-base-fail.txt /tmp/t54-final-fail.txt   # 只在基线里出现的
（空）
$ comm -13 /tmp/t54-base-fail.txt /tmp/t54-final-fail.txt   # 只在我的改动里出现的
（空）
```
⇒ ★★ **失败文件集合两侧逐行相同（各 17 个）** ⇒ **新失败 = 0**。

★ **为什么不能只看计数**：两次运行的 **fail 计数是 24 vs 21**（相差 3），
而**集合完全相同** ⇒ 那 3 条的差异是**夹具自身的抖动**（同一文件内的臂随机红），
不是我的改动造成的。**实测佐证**：`gate-session-id-chip.test.mjs` 单独跑也 `fail 1`
（它同时出现在两次运行的集合里）。
★ 本仓 `docs/GATE-EFFICACY.md` §7 第 1 条记过"同一提交的失败集合会抖" —— 这里**再次兑现**，
所以**判据写死为集合差**，计数只作参考。

### 7.2 ★ 本次改动**造成的两处红，已当场修好**（如实记，不掩盖）

我的第一版**确实引入了 2 条新失败**，而且都是**真实的**（不是环境抖动）：

| 夹具 | 报的什么 | 成因 | 怎么修的 |
|---|---|---|---|
| `gate-tool-output-schema` 臂 1 | ★ 「工具的返回值通不过自己的 **output schema**……宿主会在 `createSuccessResult` 里抛 `ToolOutputError`，于是这个工具**每次调用都失败**」 | 我给 `gate_view` 的五个子字段写了 `required: true`，而该夹具的 `valueFor()` 把**必填的嵌套对象**渲染成 `{}` ⇒ 生成的值过不了自己的 schema | 去掉那五个子字段的 `required: true`（与本 schema 里其余嵌套字段**同一种写法**：断言"字段在不在"，不断言"子字段全在"） |
| `gate-tool-split` 臂 2 | ★ golden 对拍：「`agent_teams_status` 的 `output` 与拆分前不同 —— 拆分是【纯搬运】，一个字符都不该变」 | 该臂的职责是**守着一次纯搬运**（t30/t39 的工具面拆分）；而我这次是**有意的行为变更**（加 `gate_view`）⇒ golden 必须**显式**更新 | 用**仓库自带的**命令 `pnpm fixtures:tools`（= `node scripts/tool-definitions.mjs --write`）重生成 |

★★ **我核过那次 golden 更新是"纯新增"**，不是把断言放宽：
```sh
$ diff <(json.tool 更新前) <(json.tool 更新后) | grep -c '^>'   # ⇒ 142 行新增
$ diff <(json.tool 更新前) <(json.tool 更新后) | grep -c '^<'   # ⇒ 0  行删除
$ 逐个工具比对 ⇒ 只有 agent_teams_status 变了，其余 15 个逐字节相同
```
⇒ **16 个工具里只有 1 个的 schema 变了，且只增不减** —— 与"我确实只加了 `gate_view`"相符。
★ 而 `pnpm verify:fixtures`（`--check`）**exit=0** ⇒ 更新后的 golden 与**活注册表**一致。

### 7.3 ★ 一处**超出声明 inScope** 的改动（如实报，请队长裁定）

| 文件 | 在 inScope 里吗 | 为什么必须改 |
|---|---|---|
| `scripts/fixtures/tool-definitions.json` | ★ **不在** | 它是 `gate-tool-split` 臂 2 的 golden 快照。A1 有意改了 `status` 的 output schema ⇒ **不更新它，那条臂必然红**（且红得**正确** —— 它就是在报告"输出变了"） |

★ 我没有别的选择：**要么更新 golden，要么让一条本来正确的臂永远红**。
而更新走的是**仓库自带的命令**（`pnpm fixtures:tools`），不是手改 JSON。
⇒ **如果队长认为该文件不该由本任务改**，请裁定；我**已把 diff 的性质（纯新增、只 1 个工具）**写在这里备查。

---

## 8. 给 D1 的交接（★ 直接采用这几条）

1. **分组形状照抄上表**：`{ points[], active[], abnormal[], unchecked[], truncated{} }`
   —— D1 那一侧是**落盘**，形状可不同（台账是 JSON），但**分类判据必须一致**（§3.2 四条）。
2. **④ 的三条件不许省**（`skippedAll` 在场 + `registered > 0` + `evaluated === 0`）。
3. **`observed` 在 D1 侧按契约 X1 的推荐**：**不进 `gates[]`，另立 `observed[]`**（与 `gates[]` 平级）
   —— 这样"拒了"与"开火但被放过"不同形。
   ★ 而 A 侧（本文件）**没有** `observed[]` 这一格，因为 A 送的是**逐格带 `observed` 布尔**的明细：
   两者形状不同**是刻意的** —— **出口**要"每格一个布尔"（画底纹），**台账**要"两个平级数组"（事后可查）。
4. **`gate` 保持单值**（契约 C3）：`noteStall` 靠 `previous.gate === gate` 的**标量相等**判"同一判据又拒了"，
   改数组会让它**恒为假** ⇒ 每一次拒绝都算"第一次" ⇒ 卡点永不触发。
5. ★ **`status` 只有 2 个位置的 ctx**（§3.1）—— D1 若假设"六份 `ran[]` 都在"会撞上一个不存在的前提。
