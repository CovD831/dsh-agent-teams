# admission 接线（t85）：本仓最后一处「写了但没接线」

> **改动**：`src/gates/index.ts` 接上 `admission` 位置的三条判据 + 更新四条**自己声明了要改**的当下快照断言。
> ★ **判据逻辑一个字未改**（`src/gates/admission/*.ts` 未碰）。

---

## 1. ★★★ 这一步**早就被写好了**，本文只是把预告执行掉

`src/gates/index.ts` 顶部两段注释**逐字预告了今天**：

> 「★ 本任务（t5）**只加位置，一条判据都不加**，所以这个位置现在是空的。
>   …… t6/t7/t8 会往里挂判据（审查检查点 / 吸收痕迹 / 成团闸门）。
>   ⇒ ★★ **任何夹具都不许把"admission 现在没有判据"写成断言**：
>     接上第一条判据的那一刻它就会**按设计变红**，而不是发现有东西坏了。」

> 「③【接线位置】`import` 与 `ALL_GATES` 里各留一行槽位……
>   在自己那一行落把 import 后，把该行从 `T? ——— 待接` 改成 `T? ——— 已接`；
>   **不要**动别人的行，也不要重排。」

⇒ ★ 所以本轮做的**不是发明**，是**执行那句预告**：
接上三条 ⇒ 四个夹具**按设计**变红 ⇒ 逐个更新（见 §3）。

---

## 2. 接线（照约定，只加自己那两处）

### 2.1 `import` ×3（`src/gates/index.ts`）

```ts
import * as admissionAbsorb from './admission/absorb.ts'
import * as admissionCheckpoint from './admission/checkpoint.ts'
import * as admissionConvene from './admission/convene.ts'
```

★ 顺序 = **absorb（吸收痕迹）→ checkpoint（审查检查点）→ convene（成团闸门）**：
先问"该记的记了吗"与"该审的审了吗"，最后才问"能不能开会"。
★ 与别处一致：`ALL_GATES` 的**书写顺序 = 求值顺序**（契约 §3）。

### 2.2 `ALL_GATES` ×3

```ts
  admissionAbsorb,
  admissionCheckpoint,
  admissionConvene,
] as const
```

### 2.3 ★ 第三条登记点：`NEW_POSITION_GATES`（`gate-index-assembly` 里）

★ 任务书说「若 `NEW_POSITION_GATES` 有 admission 槽位，一并登记」——
**实测它必须登记**，否则臂 3 会判「**出现了不在装配清单里的判据**」。
★ 而那张表里**本来就有一句逐字指认**：

> 「★ 这与 `admission` 那三条是**同一个病**：「写了但没接线」。」

⇒ 本行就是把那句话执行掉。三条各一行，`point` 都是 `'admission'`。

---

## 3. ★★ 四条**当下快照**断言的更新（本任务最需要小心的部分）

★ **共同原则**：它们**不是坏的** —— 它们**如实钉住了"这一刻 admission 是空的"**，
且**自己写明了接上时要改**。⇒ 更新时**不许静默放宽**，每条都要写清
「**改前它防的是什么**」与「**为什么现在要改**」。

### 3.1 `gate-admission-point.test.mjs` · 臂 1

| | |
|---|---|
| **改前** | `assert.deepEqual(built.list()[POINT], [], '★ 本任务只加位置、不加判据…（★ 这一条是【当下快照】，t6/t7/t8 接上第一条判据时应当删掉它）')` |
| **它防什么** | `t5` **顺手**往 admission 挂判据 —— `t5` 的范围**只有"加位置"**。★ 而"这一轮不该有"是**当下快照**，报文自己写了 |
| **为什么改** | `t85` **就是**那句"t6/t7/t8 接上第一条判据"所指的那一步 |
| **改成** | `assert.deepEqual(built.list()[POINT].map(e => e.id), ['admission.absorb','admission.checkpoint','admission.convene'], …)` |

★★ **这不是放宽 —— 是收紧**：旧版只断言"是空的"（对**内容零信息**），
新版断言**正好是那三个 id 且顺序固定** ⇒ 它现在还能回答
「**接上的是不是那三条**」与「**有没有人顺手多挂一条**」—— 而这两件事**旧版都答不出来**。
★ "空位置"的语义**没有消失**：它由**臂 2**（真的新建一个空实例）继续守着 —— 那才是它的正确归宿。

### 3.2 `gate-index-assembly.test.mjs` · 臂 4（分布快照）

| | |
|---|---|
| **改前** | `{ admission: 0, contract: 3, dispatch: 3, completion: 4, delivery: 2, runtime: 2 }` |
| **它防什么** | 那一行的实质（原注释逐字）是「**在这个分布上，每条判据都声明了输入面**」；数字本身是**位置快照**。具体到 `admission: 0`，它钉的是"t5 一条都没加" |
| **为什么改** | 三条进 `ALL_GATES` ⇒ **`0 → 3` 是接线的定义**，不是分布漂移 |
| **改成** | `{ admission: 3, …其余五格一字未动… }` |

★ **没有变弱**：下面那段仍要求"每条判据都声明了 `requires`"，
而三条**各自都声明了** ⇒ 它们若没声明，本条**照样红**。
★ **只改 admission 一格** ⇒ 反过来证明这次接线**没有波及别处**。
★ **反向半边 A 靠的就是这一格**：拿掉三条 ⇒ `3 !== 0` ⇒ 立刻红（实测）。

### 3.3 `NEW_POSITION_GATES` +3（同一夹具）

★ 见 §2.3。**它防什么**：臂 3 的 `known` 列表防的是
「**有人绕过 `index.ts` 的清单注册判据**」与「**有人把判据摘掉**」。
★ 三条此前**不在这张表里是对的** —— 它们的 `binding` 在 `index.ts` 里**根本不存在**，
登记它们等于**登记一个不存在的东西**。接上线之后**可登记了**，不登记就会被判"绕过清单"。

### 3.4 `gate-position-verdict.test.mjs` · 臂 4

| | |
|---|---|
| **改前** | `const empty = await registry.evaluate('admission', {})` ⇒ 断言 `empty.ok === true`（"空位置仍放行"） |
| **它防什么** | **空位置仍放行**这条底线：一个位置没判据是**正常情形**（契约 §9.1），而"下游后果"（全跳过改判）**不许**把它误伤成拒绝 |
| **为什么改** | 它**拿真实的 `admission` 充"空位置"**，因为那时 admission 恰好为空。★ 接上三条后 **admission 不再是空位置** ⇒ 这条断言**测的已是别的东西**（它会去求值三条真实判据） |
| **改成** | `await createGateRegistry().evaluate('admission', {})` —— **当场造**一个空注册表 |

★★ **这不是放宽，是把"空位置"与某个具体位置解耦**：原来依赖"admission 恰好为空"这个**偶合**
（**任何**位置接线都会让它红，而它想测的与**哪个**位置无关）。
★ 并**增设**一条对照：`assert.ok(registry.count('admission') > 0)` ——
钉住"真实的 admission 现在**不是**空位置"。**没有它**，"拿一个永远读不到判据的位置充空位置"这种错**读不出来**。

### 3.5 `verify-readout-uniform.test.mjs` · 臂 3c（C 态）

| | |
|---|---|
| **改前** | `const emptyPoint = 'admission'`（C 态 = "字段不出现"） |
| **它防什么** | 三态里的**第三种**：`checked + skipped === 0 ⇒ inputSurfaceOf` 返回 `undefined`。★ 它防**恒挂** —— 把那一行改成 `if (false)` ⇒ "没有判据"与"有判据且都齐"**同形** |
| **为什么改** | 它**拿 admission 充 C 态**（理由：那时它恰好一条都没接线）。接上三条后实测 `inputSurfaceOf('admission', {})` **返回真实的面**（`{checked:1,incomplete:1,skipped:2,missing:[…]}`）⇒ 拿它当 C 态**测的已是别的** |
| **改成** | `const emptyPoint = 'no-such-position'` —— 一个**结构上就没有模块**的位置名 |

★★ **一个必须如实说清的后果**：接线之后，**`INSERTION_POINTS` 的六个位置全都 ≥1 条判据**了
（实测 `admission 3 / contract 3 / dispatch 3 / completion 4 / delivery 2 / runtime 2`）
⇒ ★ **这六个位置里再也没有"天然的 C 态"了。**
★ 而这**不是**让这条断言消失的理由 —— C 态是三态之一，必须继续**可被观测**，
否则"恒挂"那行就再也没人盯着。

★★ **实测它仍然能被打红**（分辨力**没有**变弱）：把 `lib/` 里那行改成
`if (false && …)` ⇒ **臂 3c 立刻红**。⇒ 判据本身一字未动，
只是不再依赖"哪个位置恰好为空"这个偶合。

---

## 4. 两条反向半边

### 4.1 ★★ A：把三条从 `ALL_GATES` 拿掉 ⇒ 更新的断言**必须变红**

实测（改 `ALL_GATES` + 重建 `lib/` 后逐条跑）：

| 夹具 | 拿掉后 | 报文 |
|---|---|---|
| `gate-admission-point` | ✖ **红** | `★★ t85 已接：admission 位置上正好是那三条判据` |
| `gate-index-assembly` | ✖ **红** | `★ 六位置的判据分布变了`（`0 !== 3`） |
| `gate-position-verdict` | ✖ **红** | `★ t85 已接线：真实的 admission 位置上现在有判据` |
| `verify-readout-uniform` | ✅ **仍绿** | ★ **如实报出**（见下） |

★★ **第四条为什么仍绿，以及它算不算"没在管事"**：
我把它的 C 态位置**解耦**了（改成 `'no-such-position'`），所以"admission 有没有接线"**structurally** 不再影响它。
★ 那**不是**防护变弱 —— 我用**恒挂突变**单独证明了它仍然会红（§3.5：
`if (false && …)` ⇒ 臂 3c 立刻红）。
★ 准确说法是：**它的射程从"admission 这一个位置"扩大到了"任何空位置"**，
代价是**它不再对"admission 有没有接线"这件事发言**（而那是上面三条的职责）。
⇒ 四条里三条直接管接线、一条管三态语义，**分工清楚**，不是漏了一条。

### 4.2 ★★ B：判据夹具必须仍绿（接线不许碰判据逻辑）

| 夹具 | 读数 |
|---|---|
| `gate-admission-absorb` | ℹ pass **29** · fail 0 ✅ |
| `gate-admission-checkpoint` | ℹ pass **26** · fail 0 ✅ |
| `gate-admission-convene` | ℹ pass **27** · fail 0 ✅ |
| `verify-admission` | ℹ pass 9 · **fail 1** ← ★ **存量红，非本轮造成**（见 §5） |

★ `src/gates/admission/*.ts` **一个字未改**（`git status` 可核）。

---

## 5. ★ 净变化（判据是**失败文件集合**）

```sh
# 基线（三条从 ALL_GATES 拿掉 + 四个夹具还原到改前）：
$ pnpm test:gates ⇒ ℹ tests 1488 · pass 1429 · fail 21 · 16 文件
# 接线 + 四个夹具更新后：
$ pnpm test:gates ⇒ ℹ tests 1488 · pass 1430 · fail 20 · 16 文件
$ diff <基线失败集合> <改后失败集合>  ⇒ 无输出 ✅
```

★★ **集合逐条相同（16 个文件）**，而 **fail 从 21 → 20**：
⇒ 本轮是**净减少一个失败**（接线 + 按设计更新，没有引入任何新增红）。

★ **那四条的去留**（任务书点名要说明）：
| 夹具 | 改前 | 改后 |
|---|---|---|
| `gate-admission-point` | 在集合里（临时接上会红） | ★ **不在集合里了**（已更新 ⇒ 绿） |
| `gate-index-assembly` | 同上 | ★ **不在集合里了** |
| `gate-position-verdict` | 同上 | ★ **不在集合里了** |
| `verify-readout-uniform` | 同上 | ★ **不在集合里了** |
| `verify-admission` | ★ **本来就在存量 16 里**（红 1 条） | ★ **仍在**（存量，与本轮无关） |

⇒ ★ **四条按设计更新后离开了失败集合；存量 16 个文件一个没多、一个没少。**

★ `npx tsc -p tsconfig.json --noEmit` ⇒ **exit=0**；
`npx tsc -p tsconfig.client.json --noEmit` ⇒ **exit=0**；`pnpm build` ⇒ **exit=0**。

---

## 6. ★ 一处**必须如实报出**的事：`verify-admission` 的红是**存量**

它的臂 0 报 `★ 全跳过也必须放行（"这一轮没有适用判据"是正常情形）`（`ok false !== true`）。
★ **我实测它【本来就在红】**：把三条从 `ALL_GATES` **拿掉**、并用 `git checkout` 把四个夹具
还原到改前之后重跑，它**同样 9 pass / 1 fail**。
⇒ ★ **非本轮造成**，且它**本来就在那 16 个存量里**。
⇒ 本任务**没有修它**（不在 inScope，且它与"接线"是两件事）。

---

## 7. ★ 交给下一个人的三条

1. ★★ **`admission` 是五个位置里最后被接上的一个** ⇒ 从此本仓
   「**写了但没接线**」**再也没有实例**（t6 那句"进 `ALL_GATES` 才叫接上了"的收口）。
2. ★★ **六个位置现在全都 ≥1 条判据** ⇒ **没有"天然的 C 态"了**。
   要测"字段不出现"必须用**结构上没有模块的位置名**（见 §3.5），
   **不要**去找"哪个位置恰好为空" —— 那种偶合已经没有了。
3. ★ **`NEW_POSITION_GATES` 是第三个登记点**：加判据时它和 `ALL_GATES` **都要改**，
   否则臂 3 会判"绕过装配清单"。★ 这是**已经踩过**的形状（`contractTaskAtomicity`
   那段注释逐字写着"与 admission 那三条是同一个病"）。
