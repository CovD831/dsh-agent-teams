# 本会话卡点补录（t88）—— 10 条，带 kind 与 routing

> **只写数据**：`.agent-teams/evolution/signals.jsonl`（10 条）+ `index.json`（读数）+ 本文。
> ★ `src/`、`lib/`、`scripts/` **一个字节未动**。

---

## 0. 一句话

本会话有 **7 次「契约被实测推翻」**（队长认了 6 次，其中 3 次是**我推翻他**的），
它们**一条都没进过台账** ⇒ 现补录为 **10 条**记录（#2 拆成 2a/2b，
另加 2 条**做对了**的样本），每条都带 `kind` 与 `routing`（含 **why**）。

---

## 1. ★★★ 为什么它们此前一条都进不去（根因）

```
.agent-teams/frictions/  384 条
★ 最新是 2026-10-14
★ 10-16（本会话）有: 0 条
```

**根因**：`recordFriction` 只在【**判据**拒绝】时触发，
而本会话这类里 **5 条是【闸门】拒绝**（inScope 冲突 / 未声明产物）⇒ **走不到那儿**。

★ 所以本批**故意**包含 5 条闸门拒绝（`e-0007`），
**那正是此前一条都进不了台账的那一类**（反向半边 A）。

---

## 2. ★★ 三条我推翻队长的地方（他全部核实并认了）

| # | 我报的 | 队长核实结果 |
|---|---|---|
| **#6** | t79/t80 **没越界**（`changedPaths` 是 `inScope` 子集） | ✅ 认，并查明那句"越界"的来源：**t79 第一版尝试被闸门拦下（未提交）**，而队长把"**尝试被拦下**"写成了"**越界**" —— 两件事 |
| **#2** | t81 的 `inScope` **包含** `activity-model.ts`，没有"整体在 outOfScope" | ✅ 认，并给出**真实所指**（见 §3），比我与队长原先的都准 |
| **#1/#3** | 归属可疑：两条**已由 t81 解决**，不该写「待处置」 | ✅ 认。原话：「写成『待处置』会让采集层**把已解决的事当待办**」 |

★★ **队长补了一层**：「已解决」与「待处置」在记录里同形 ——
那是本仓记账最久形态的**一个新变体**。

---

## 3. ★★ #2 拆成两条（2b 是**新的**，此前没进过任何清单）

`team.json` 的 t81 `revisions` **逐字记着两次修订**：

```
① 实施方报出：「UI 四态（0条/团队级/未开始/未落盘）的定义与计算全在
   src/client/activity-model.ts」—— ★ 而那当时在 outOfScope 里
   ⇒ ★ 队长把落点判断错了（revision 1，fields=['inScope']）

② ★ 队长把它加进 inScope 时【没摘掉 outOfScope 的旧条目】
   ⇒ 同一路径出现在两张表里
   ⇒ 校验器先看 outOfScope ⇒ 提交被判「越界」
   ⇒ 闸门报文逐字：implementation cannot complete: src/client/activity-model.ts is out_of_scope
   ★ 而实施方【没有绕过闸门】（没把文件从 changedPaths 偷偷拿掉），是按队规报上来的
   ⇒ ★ 那是队长的第二次错（revision 2 与 3，fields=['outOfScope']）
```

⇒ 我按裁定拆成 **`e-0002`（2a，落点错）** 与 **`e-0003`（2b，两表冲突）**。

★ **2b 的价值**：它是一条**纯谓词** —— `inScope ∩ outOfScope ≠ ∅`，
**闸门已经有这条检**（报文说的就是 out_of_scope），
缺的是「它在**创建/修订那一刻**就报，而不是等到提交」。
★ 所以 2b 是 `hard`，而 2a 是 `soft` —— **两条的 routing 不同，正是它们该分开的理由**。

---

## 4. 十条清单

| id | # | kind | routing | 一句话 |
|---|---|---|---|---|
| `e-0001` | 1 | rejection | **none** | `rejectOnContractGates` 通过路径不返回 `{ gates }` ⇒ **已由 t81 解决** |
| `e-0002` | 2a | rejection | soft | 四态逻辑在 outOfScope 文件里（**队长落点判断错**）|
| `e-0003` | 2b | rejection | **hard** | ★ **加 inScope 时没摘 outOfScope ⇒ 两表冲突 ⇒ 提交被拦** |
| `e-0004` | 3 | rejection | **none** | `types.ts` 零 import 叶子 ⇒ **已由 t81 解决** |
| `e-0005` | 4 | rejection | hard | S1 被 `c32f0a5` 静默删 ⇒ **t75/t76 两条判据已落地** |
| `e-0006` | 5 | rejection | hard | 验收恒真（`test:gates` 不含被测文件）⇒ **t73 已加臂** |
| `e-0007` | 6 | rejection | **hard** | ★ **五条真实「未声明产物」越界**（t54/t60/t67/t70/t86）|
| `e-0008` | 7 | insight | soft | `role` 两个消费者：面板新鲜 / persona 冻结 |
| `e-0009` | 8 | **success** | none | ★ t86 用「停下核对口径」把 redundancy 从 **0.1022** 更正到 **0.145161** |
| `e-0010` | 9 | insight | **hard** | ★ 加一个插入点是 **五处登记**，不是一处 |

**三类齐备**（不是硬造）：`rejection` **7** · `insight` **2** · `success` **1**。

### 4.1 ★ #6：五条真实越界（全部实测）

| 任务 | 越界的路径 | 闸门报文 |
|---|---|---|
| t54 | `scripts/fixtures/tool-definitions.json` | is undeclared |
| t60 | `scripts/friction-triage.d.ts` | is undeclared |
| t67 | `lib/client.js.map` | is undeclared |
| t70 | `lib/client.js.map` | is undeclared |
| t86 | `src/gates/collection/shared.ts` 等 | is undeclared |

★ 五条**状态全部是 `failed`** ⇒ **全部是闸门拒绝**，不是判据拒绝。

### 4.2 ★★ #9：是 **五处**，不是四处（队长的四处之后还有一处）

队长说「你报的是三处，而实际加了 `GATE_DIRS` 后是四处」，
并叮嘱「**若你还查到第五处，照实写**」⇒ **我查到了第五处**：

```
① src/gates/registry.ts              — INSERTION_POINTS（真值）
② src/types.ts                       — GATE_INSERTION_POINTS + GateInsertionPoint（镜像）
③ scripts/verify-gate-tristate.test.mjs — GATE_DIRS（目录表）
④ src/gates/index.ts                 — import + ALL_GATES（装配）
⑤ scripts/gate-index-assembly.test.mjs — NEW_POSITION_GATES（登记表）   ★★ 第五处
```

★ **它不是 ③ 的别名**：两者是**两个文件里的两张独立的表**。
★ 而 `gate-index-assembly.test.mjs:477` **逐字**说了这件事：
> 「`★ ${point} 位置该有 ${expected.length} 条（**由装配点的 import + 清单 + NEW_POSITION_GATES 决定**）」」

---

## 5. ★★ 反向半边 B：`redundancy` 补录前后是**两个具体的数**

**口径**（与 t86 的 `collectionHealthOf` 一致）：**唯一 `(component, 单个 kind)` 对数 / 总记录数**。

| | 记录数 | 唯一对 | **redundancy** |
|---|---:|---:|---:|
| **补录前**（只台账 372 条） | 372 | 54 | **0.145161** |
| **补录后**（台账 + 本会话 10 条） | **382** | **71** | **0.185864** |
| **差值** | +10 | +17 | **+0.040703** |

```sh
$ python3 /tmp/index88.py     # 本文件的复跑脚本（见 §6）
=== BEFORE（只台账）===
  records: 372 | pairs: 54 | redundancy: 0.145161
=== AFTER（台账 + 本会话 10 条）===
  records: 382 | pairs: 71 | redundancy: 0.185864
```

★ **它是一个可读的数，不是一句"变好了"**：`+0.040703`，
而它的**方向与理由**也说得清 —— 那 10 条是**7 种不同性质**的事
（记了 17 个不同的 `(component, kind)` 对），所以唯一对**增得比记录快**。

★ 这批的 `index.json` 还给出分组读数：
```
by_kind      : rejection 7 · insight 2 · success 1
by_decision  : none 3 · soft 2 · hard 5
```
⇒ ★ 而 `hard=5` 与 `soft=2` 的比是**一条可用的信号**：
本会话的规格错里**多数是可机械判定的**（5 条），少数要改 prompt（2 条）。

---

## 6. 复跑

```sh
# 写盘
$ python3 /tmp/write88.py      # 10 条 → .agent-teams/evolution/signals.jsonl
$ python3 /tmp/index88.py      # 读数 → .agent-teams/evolution/index.json

# 校验（形状 + 来源可指）
$ python3 -c "import json;[json.loads(l) for l in open('.agent-teams/evolution/signals.jsonl') if l.strip()];print('jsonl ok')"
```

★ **来源逐条可指**（实测：所有 path-like `sources` 都存在；
行号引用抽查 6 处**全部命中**：`snapshot.ts:368/372` · `members.ts:532/634` ·
`tools.ts:1978` · `gate-index-assembly.test.mjs:477`）。

---

## 7. ★ 诚实边界

| # | 边界 | 说明 |
|---|---|---|
| **1** | ★ **补录不能替代 t87** | 本批是**手工**补的历史；而 `recordFriction` 的触发条件仍是"只在判据拒绝时" —— **t87 才让闸门拒绝自动进台账**。⇒ 不修 t87，**下一次仍会漏**。 |
| **2** | ★ **`e-0007` 记的是"五条合成一条"** | 五条越界各有各的路径与报文，本批为控制条数合成一条（`sources` 逐条列出）。★ 若要按条计，它应是 **5 条**而不是 1 条 ⇒ 那会让 `redundancy` 的补录后读数**更高**。 |
| **3** | ★ **口径统一是刻意的** | 台账那批的 `component` = `index.component`，本会话那批的 `component` = `routing.target ?? (routing:<decision>)`。★ 两者**不是同一种东西**，放在同一个比值里只因为 `redundancy` 量的是"标签粒度"。⇒ 若要严格，应分两组各算一个 redundancy（**未做**，如实记下）。 |
| **4** | `e-0002`/`e-0008` 的 `soft` 判定 | 判据是"能否机械判定"，而两条都是**跨模块的语义追踪**（哪个模块该承载 / 何时读）⇒ 不是谓词。★ 但 `e-0008` 的 `effect` 我给了读数（"改动后发现第二个消费者的返工数"），那个数**现在还没人采**。 |
