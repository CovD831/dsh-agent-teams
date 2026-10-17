# 裁定：读路径的三态选 **甲**（调用方分辨），而理由是一组实测数字（2026-10-17）

> **用户问**:「你觉得选哪个」
> **我的答复**:**甲** —— ★ 而在**新的调用点**上做，**不改 `readTeam`**。

---

## 1. ★★★ 先看一组决定性数字

```
$ grep -c "readTeam(" src/  ⇒ 28 处调用
★ 而第一实参是 stateRoot 的:     23 处
★ 其它（root / root.owned.id 等）: 5 处
⇒ ★★★ 而这 28 处的【区】全部是确定的:
   · workspaceOf(caller)（调用者自己那个）
   · workspaceRegistry.list()（已注册的）
   · root（同一个 stateRoot 传下来）
```

⇒ ★★★ **即:"区不存在"这一格在【现有 28 处里根本不会发生】。**

★ **而它只在【新场景】发生:**
```
★ 聚合入口的"读别区" —— 而它读的是 workspaceRegistry.list()
   ⇒ ★ 那些区【都是已注册的】⇒ ★ 也不会是"不存在的区"
★★ 真正会读"不存在的区"的,只有一种:★★★ 【调用方自己拼错了路径】
```

---

## 2. ★★★ 所以"三态"要解决的其实是**一个还没有发生的问题**

```
★ t104 报的缺口是真的（ENOENT 在 state.ts:640 合流）
★★ 而它的【实际影响面】比看起来小得多:
   · 现有 28 处:都是确定的区 ⇒ 不受影响
   · 聚合入口:读注册表 ⇒ 不受影响
   · 只有"人手拼一个路径"时才会遇到
⇒ ★★★ 所以【不该为了让一个未发生的场景改 28 处的类型】
```

---

## 3. ★★ 为什么是甲而不是乙

| | 甲（调用方分辨）| 乙（`readTeam` 返回"为什么是空的"）|
|---|---|---|
| 改动面 | ★ **0 处既有调用** | ★ **11 处声明 `TeamState \| undefined`** 要改 |
| 风险 | ★ 新代码，不碰既有 | ⚠️ 改一个**28 处在用**的函数签名 |
| 三态在哪 | ★ 在**需要它的那一处** | ⚠️ **每一处**都被迫处理 |
| 与既有纪律 | ★ **与"最小 MVP"一致** | ⚠️ 为一个未发生的问题扩类型 |

⇒ ★★★ **而乙那条"每一处都被迫处理"是关键** ——
**它会让 28 处都多一个必须回答的问题，而其中 27 处答案是"不可能发生"。**

★ **那正是"过度设计"的形状**:让 28 个地方为一个地方的例外付代价。

---

## 4. ★★★ 而甲的正确形状（不是"调用方随手 statSync"）

```
★★ 不是让每个调用方自己 statSync —— 那会散成 28 份
★ 而是在【需要三态的那一处】加一个【小探针】:
```

```ts
/** ★ 只在"我要区分区在不在"的地方用，不进 readTeam 的签名。 */
export async function readTeamEx(
  stateRoot: string, teamId: string,
): Promise<
  | { kind: 'found'; team: TeamState }
  | { kind: 'no-team'; }        // ★ 区在，但没有这个队
  | { kind: 'no-region'; }      // ★ 区本身不在（目录不存在）
> {
  // ★ 只在这里判别 ENOENT 的来源，而 readTeam 一字不动
}
```

## ★★ 而它的实现要点（★ 两个坑，都是实测过的）

```
★ 坑①:不能靠 catch ENOENT 的来源 —— 两者都是 ENOENT
   ⇒ 所以必须先 statSync(stateRoot) 分辨"区在不在"，再调 readTeam
★ 坑②:而 statSync 也失败 ⇒ ★ 那要报 no-region，不是"没有队"
```

★ **而那一层【只在一个地方】，不是 28 处。**

---

## 5. ★★ 而它与三个实验的结论一致

```
① main key    ✅ 通（注册 + selectPanel）
② 跨区读      ✅ 通 —— 而三态问题【只在人手拼错路径时】发生
③ 跨区写      ✅ 通 —— ★ 而写侧【已经可读】（抛 ENOENT，说"指错了区"）
⇒ ★★★ 所以:写侧不用改，读侧只加一个 ex 版本，而【既有 28 处一处不改】
```

---

## 6. ★ 一条我如实说的

```
★★ 这个裁定【可以反悔】:若将来聚合入口真的需要"区不在"与"没队"在【多处】区分，
   ★ 那时再升乙就不迟 —— 因为那时【有真实需求】，不是为一个假设的场景付 28 处的代价
★ 而"先甲、需要时再升乙"是【可逆的】；反过来（先乙后甲）不可逆
```

---

---

## 7. ★ t108 执行记录：裁定"甲"已落地

**改动**：`src/state.ts` 新增 `readTeamEx` + 新增判据 `scripts/gate-read-team-ex.test.mjs`（7 臂）。
★ **`readTeam` 一字未动**（实测见 §7.2），**28 处既有调用一处未改**（见 §7.3）。

### 7.1 实现：先判区、再读队（坑①有实测依据）

```ts
// ① 先问"区在不在"（stat 那个【目录】，与"有没有这个队"无关）
const stats = await stat(stateRoot)
if (!stats.isDirectory()) return { kind: 'no-region' }   // ★ 路径写成文件 ⇒ 同归宿
// （catch 一切 ⇒ no-region —— 坑②：判不出来不是 no-team）
// ② 区确实在 ⇒ 现在才问"有没有这个队"
const team = await readTeam(stateRoot, teamId)
return team === undefined ? { kind: 'no-team' } : { kind: 'found', team }
```

★★ **坑① 不是照抄，是当场复验的**（本任务开工时实测）：

```
readFile("<root>/NO-SUCH-REGION/team.json")  ⇒ code ENOENT · path …/NO-SUCH-REGION/team.json
readFile("<root>/REGION/team.json")          ⇒ code ENOENT · path …/REGION/team.json
★★ 两者 code 相同 ⇒ 靠 code 分辨不出来 ⇒ 必须先 stat 目录
```

★ 该读数已固化成**判据臂 1**（不是靠人记得）。

### 7.2 ★★ 硬边界①：`readTeam` 一字不动（机械核过）

```sh
$ diff <(git show HEAD:src/state.ts | sed -n '/^export async function readTeam(/,/^}/p') \
       <(sed -n '/^export async function readTeam(/,/^}/p' src/state.ts)
（无输出） ⇒ ✅ readTeam 函数体【逐字节相同】
$ grep -n "export async function readTeam(" src/state.ts
630:export async function readTeam(stateRoot: string, teamId: string): Promise<TeamState | undefined>
```

★ 而**判据臂 6** 钉住它的**语义形状**：对"区不在"与"队不在"，`readTeam` **仍然**都返回 `undefined`。
★★ 理由（写进臂 6 的注释）：若有人为了复用把它改成返回判别对象，
那 28 处 `if (team === undefined)` 会**恒为假** ⇒ **静默地把"没有队"读成"有队"**。

### 7.3 ★★ 硬边界③：28 处调用一处未改

```sh
$ grep -rn "readTeam(" src/ --include=*.ts | grep -v "readTeamSync|readTeamEx|export async function readTeam(" | wc -l
29
$ # ★ 其中 1 处是 readTeamEx 自己内部的调用（src/state.ts:717）
⇒ 存量 = 28 ✅（与裁定里的计数一致）
```

### 7.4 三条反向半边（均实测）

| 半边 | 情形 | 必须 | 实测 |
|---|---|---|---|
| **A** | 区不存在 | `no-region` | ✅ |
| **B** | 区在、队不在 | `no-team` | ✅ ★ 且**与 A 不同值** |
| **C** | 区在、队也在 | `found` + `team` | ✅ ★ 且与 `readTeam` **给同一条记录** |

### 7.5 ★★ 双突变：判据可证伪

```
突变①  去掉 stat 探针（= 直接 readTeam 再猜）      ⇒ ★ 4/7 红（A、B、5、7）
突变②  把 no-region 落成 no-team（= 两者同形）    ⇒ ★ 3/7 红（A、B、5）
```
★★ 突变②正是**本裁定存在的理由**被推翻的那个方向 —— 而判据**当场红**。
★ 而臂 4（C）在两个突变下**都绿**，因为"找得到"这一格没被碰 ——
⇒ 恰好说明 A/B 与 C 是**各自独立**的承担者（C 防的是"加判别把正常路径弄坏"）。

### 7.6 ★ 一处必须点明的取舍（写在这里免得下一个人以为是漏）

★ 坑②的处置：**`stat` 本身失败 ⇒ 一律 `no-region`**，把"权限不足"与"真不存在"**合在一格**。
★ 理由：对**调用方**而言两者动作相同（去查路径/去查权限），而它们**都**与 `no-team` 不同归宿
（`no-team` 是"那个队确实不在了"）。⇒ 合成的是**同一类**，**没有**把本裁定要分的那一对合掉。
★ 另：`stateRoot` 是**文件**（不是目录）⇒ `no-region`（臂 7）。
这一格若不判，`readTeam` 会拿到 **ENOTDIR**（**不是** ENOENT）而**抛出去** ——
于是"路径写错了"会变成一次异常，而它与"区不在"是同一类问题。

