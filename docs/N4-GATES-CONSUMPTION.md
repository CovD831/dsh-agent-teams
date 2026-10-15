# N4 消费 `auto.gates[]`（t60）

> **本文件是 D 线的收口记录**：`friction-triage`（N4）的接口面**声明并消费** `auto.gates[]`。
> ★ 只读说明：本文描述的实现只改 `scripts/friction-triage.mjs` + `scripts/friction-triage.d.ts`
> （及其构建产物）。**未改** `src/client/**`、**未改** `src/tools/update-task.ts`。

---

## 1. 一句话

写端（`recordFriction`）**早就**把全部被拒判据写进 `auto.gates[]` 了；
**读端（N4）此前只拿标量 `gate`** ⇒ 一条含多个判据 id 的记录，在分诊眼里**只剩第一个**。
本轮把读端补上，并把「我读到的是不是全量」做成**类型层可见**的三态。

---

## 2. 改了什么

| 文件 | 改动 |
|---|---|
| `scripts/friction-triage.mjs` | 新增 `readGateIds(origin)`；`actionForFriction()` 改用它，且返回值多两格 `gates` / `gatesFrom` |
| `scripts/friction-triage.d.ts` | ★ **声明面**：新增 `FrictionAutoGateRead` / `readGateIds` / `FrictionAction` |

★ **零改动**：`src/tools/update-task.ts`（T5 闸门死锁那条，本任务不需要碰它）、
`src/client/**`、`src/gates/registry.ts`、`src/tools/status.ts`。

---

## 3. ★★ 契约 §5 N-a：为什么返回的是 `{ ids, from }` 而不是 `string[]`

契约 N-a 逐字：

> 「`auto.gates[]` 是 N4 要消费的新字段 ⇒ N4 的接口面**必须先声明它**；
> 否则 N4 的读数**静默变空**，而**「字段没了」与「卡点本来就没有」同形**。」

**若 `readGateIds` 写成 `origin.gates ?? []`，那两件事就合流了**：

```
「这个字段不在（我读不到全量）」  ⇒ []
「这一轮真的没有判据」            ⇒ []
```

⇒ 所以 `from` **必填**，三态互斥：

| `from` | 含义 | 是"全量"吗 |
|---|---|---|
| `'gates'` | `auto.gates[]` 在场（t30 之后写的记录） | ★ **是**（权威源） |
| `'gate'` | 只有标量 `gate` —— 写于那个字段之前 | ✗ **不是**：**非首位判据丢了** |
| `'none'` | 两种都没有 —— 这条记录**没记到判据** | —（第三种"没有"） |

★ 而且它**落进人读的那一格**：`from === 'gate'` 时 `why` 会**显式加一句**
「这条记录只有标量 `gate` …… 上面那个 id 是**首位**，而这条记录**可能还拒过别的判据**」。
⇒ 读的人**不会**把"回退读到的首位"误当成"这就是全部"。

---

## 4. ★ 契约 N-c：`gate` 保持单值 —— 本文件不许把它当数组用

**实测依据**（不是约定）：`noteStall` 用**标量相等** `previous.gate === gate`
（`src/types.ts:717-719`）判"同一个判据又拒了一次"。
⇒ 若 `gate` 被写成数组，那条相等**恒为 false** ⇒ `sameGate` 恒 false
⇒ 每次拒绝都被算成"第一次" ⇒ **卡点计数永不触发**（整个卡点机制失效）。

★ **本文件的处置**：`readGateIds` 里的回退分支写成
```js
if (typeof origin?.gate === 'string' && origin.gate !== '') { … }
```
—— 那是**"我只接受标量"**的显式形式。
★ 而**刻意不写** `Array.isArray(origin.gate)` 的分支：那会**暗示"它可能是数组"**，
而这个字段按契约**永远是标量**。写一个"防数组"的分支反而会让下一个人以为它可以变数组。

★ **反向实测**（见 §6 ③）：把数组塞进 `gate` ⇒ 读数落 `'none'`（按"读不出来"处置），
**不会**被当成一份有效的多值读数。

---

## 5. ★★ 一个必须如实报的读数：**真实语料里 `auto.gates` 是 0 条**

```sh
$ grep -l '"gates"' .agent-teams/frictions/*.json | wc -l
348          # ← 看着像有，但那不是 auto.gates

$ python3 -c "…逐条看 auto.gates…"
auto.gates present : 0
"gates" elsewhere  : 336      # ← 那些是 observed.gates（判据求值结果，另一个字段）
```

⇒ ★★ **在盘上的 372 条可解析记录里，`auto.gates` 出现了 0 次。**
N4 的实际读数分布：

```
from='gates'（权威全量）      :   0
from='gate' （标量回退、有损）: 110
from='none' （没记到判据）    : 262
```

**为什么**（可核，不是猜）：
- `auto.gates` 由 `fe7f2b0`（**2026-10-15 05:03**）落地；
- 而语料**最后一条**记录是 **2026-10-14 17:42**（f-0383），**早于那个字段约 11 小时**。

⇒ ★ **这条改动的收益是"面向未来"的**：它**不会**让现有 110 条记录的读数变好
（那些记录**物理上**没有全量可读），但**从此以后**写下的记录会被读全。
★ 而 N-a 要的正是这件事：**让"读不到全量"与"本来就没有全量"不同形** ——
在盘上那 110 条，现在的读数是 `from='gate'`（**明确标注为有损回退**），而不是一个
看起来像"这条记录只有一个判据"的干净读数。

★ **不许**把这段读成"改动没用"：它把一类**静默的有损读法**变成了一类**显式的**。
而"显式"是本仓最贵那条纪律的全部内容。

---

## 6. 验收（逐条可复跑）

### ① 反向半边：多 id 卡点 ⇒ N4 读数含**全部** id
```sh
$ node --input-type=module -e "
import { actionForFriction } from './scripts/friction-triage.mjs'
console.log(actionForFriction({ auto:{ tool:'t', point:'completion', gate:'completion.r5',
                                       gates:['completion.r5','completion.backtest'] } }))"
# ⇒ action 'auto-recorded' · gates ['completion.r5','completion.backtest'] · gatesFrom 'gates'
```
⇒ **PASS**（两个 id 都在，且保序）。

### ② ★ 反向半边**可证伪**：把 `gates` 消费去掉 ⇒ 必须失败
实测：把 `readGateIds` 里读 `gates[]` 的那一支短路（`if (false && …)`）后重跑同一断言：
```
actionForFriction → {"gates":["completion.r5"],"gatesFrom":"gate"}
❌ 读全部 2 个 id        ❌ gatesFrom === "gates"
```
⇒ **去掉消费就只剩首位**，正是 t30 那个缺陷在读端的原样。恢复后重新全绿。

### ③ 静默变空的防线（N-a）：三态**不许合并**
```
旧记录(只有 gate) → {"gates":["completion.r5"],"gatesFrom":"gate"}   ← 回退，非全量
无判据记录        → {"gates":[],"gatesFrom":"none"}                  ← 第三种"没有"
```
⇒ **PASS**：两者 `from` **不同形**；且旧记录那条的 `why` 显式说明"可能还拒过别的判据"。

### ④ 边界（写侧损坏时的处置）
| 输入 | 读数 | 为什么 |
|---|---|---|
| `gate: ['completion.r5']`（数组） | `from:'none'` | N-c：`gate` 只能是标量；数组**不是**一条路 |
| `gates: []` | `from:'none'` | 空数组按契约**根本不会被写出** ⇒ 出现即写侧损坏 |
| `gates: ['completion.r5', 42]` | `from:'none'` | ★ **半坏的全量比诚实的回退更危险** ⇒ 整体作废，不许返回半份 |

---

## 7. 验证读数

| 命令 | 读数 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | **exit=0** |
| `pnpm build` | **exit=0** |
| `pnpm test:gates` | 见 §8（净变化） |

---

## 8. ★ 净变化：**新失败 = 0**（判据是集合，不是计数）

```sh
# 改动后：
$ pnpm test:gates   ⇒ ℹ tests 1471 · pass 1413 · fail 20 · skipped 38
# 基线（把两处改动 stash 掉后重跑）：
$ pnpm test:gates   ⇒ ℹ tests 1471 · pass 1413 · fail 20 · skipped 38

$ comm -23 /tmp/t60-base-fail.txt /tmp/t60-fail.txt   # 只在基线里出现的
（空）
$ comm -13 /tmp/t60-base-fail.txt /tmp/t60-fail.txt   # 只在我的改动里出现的
（空）
```
⇒ ★★ **失败文件集合两侧逐行相同（各 16 个）⇒ 新失败 = 0**；连计数也相同（1413 / 20）。

★ **为什么仍然按集合判**：本仓 `docs/GATE-EFFICACY.md` §7 第 1 条记过"同一提交的失败集合会抖"，
t54 也实测过 `fail 24 vs 21` 而集合相同。⇒ **判据写死为集合差**，计数只作参考。

★ 该 16 个失败文件**全部是已知存量红**，与本次改动无关（`gate-*` / `verify-*` 一族）。
★ **未放宽任何断言**：本次改动**只增加**读数（`gates` / `gatesFrom` 两格 + 一个导出函数），
没有删除或弱化任何既有断言。

---

## 9. ★ 交给下一个人的三条

1. **写端不需要再改** —— `auto.gates[]` 已在 `entities.ts:3508-3511`（`fe7f2b0`），
   端到端验证过（多 id 落盘两个都在）。
2. ★ **不要用提交哈希判"这件事做没做"**：契约 §0 说它由 `4be6952` 落地，而
   `git merge-base --is-ancestor 4be6952 HEAD` ⇒ **NOT an ancestor**；功能其实在，
   只是**由另一个哈希到达本分支**（`fe7f2b0`）。★ 这条已在 `docs/` 的 T7 记录里。
   判据请用**行为**（端到端落盘读数）或 `grep -c "export function gateIdsFromMessage" src/`。
3. ★ **`from === 'gate'` 的 110 条是历史包袱**，不会自愈（它们物理上没有全量）。
   若将来要做"把老记录补全"，那需要**重放**——而台账**不可重算**
   （`recordFriction` 注释逐字），所以**只能靠新记录自然替换**。
