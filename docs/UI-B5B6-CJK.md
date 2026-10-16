# B5 + B6：CJK 宽度 + 成员名与职责分两行（t83）

**基线**：HEAD = `ba870c8`（`git merge-base --is-ancestor 71790be HEAD` ✅）。
开工时 stamp = `3ff29d5` ≠ HEAD ⇒ **先 `pnpm build` 取新鲜基线**。
**写域**：`src/client/MemberRow.tsx` · `src/client/activity-model.ts` · `src/client/ActivityPanel.module.css` + 产物 + 本文。
★ 实测改动 **9 条路径，逐条在 inScope 内**（对拍，越界 0 条）。**零新依赖**（`package.json` / `pnpm-lock.yaml` 未改）。

---

## 0. 验收读数

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | **exit=0** |
| `npx tsc -p tsconfig.client.json --noEmit` | **exit=0** |
| `pnpm build` | **exit=0**（`lib/client.js` 383.79 kB；stamp == HEAD） |
| `grep -n 'cjkWidth\|charColumns\|cellWidth' src/client/MemberRow.tsx` | **2 处**（import + 列数探针） |
| `pnpm test:gates` 失败**文件集合** | 基线 16 == 改后 16，`diff` 无输出 ⇒ **净新 = 0** |
| 纯函数判据 | **27 条断言全绿** |
| 渲染层判据 | **10 条断言全绿** |
| 变异体 | **5/5 被检出**（另有一条"不是真缺陷"的变异体，见 §4） |

★ 基线取法：开工 `pnpm build` 取新鲜基线 ⇒ `1485 tests / 1427 pass / 20 fail / **16 文件**`；改后同为 `1485/1427/20/16`，**集合** diff 无输出。

---

## 1. B5：零依赖的内联 CJK 宽度表

按 B0.6 逐字给的方案：**CJK 区间 + 半宽例外 + 按码点累加**，与仓内既有风格一致。

```ts
const WIDE_SPANS = [[0x1100,0x115F], [0x2E80,0x303E], …, [0x30000,0x3FFFD]]
export function isWideCode(code: number): boolean
export function charColumns(text: string): number
export function wrapByColumns(text, maxColumns, maxLines): readonly string[]
```

实测读数：`abc`=3 列 · `中文`=4 列 · `日本語`=6 列 · `한국어`=6 列 · `Ａ`=2 列 · `，`=2 列 · `😀`=2 列 · `𠀀`=2 列 · `abc`=3 列。

### ★★★ 对拍臂抓出的**两个真缺陷**（B0.6 要求这条臂，而它立刻兑现了）

我第一版用 `charCodeAt`（**码元**）累加。对拍臂立刻报 **`disagree=2`**：

| 样本 | 表说 | 独立源说 | 根因 |
|---|---|---|---|
| `😀` U+1F600 | 1 | 2 | 补充平面 ⇒ UTF-16 是**代理对**，`charCodeAt` 给的是代理码元（U+D800–U+DFFF）⇒ 表里查不到 |
| `𠀀` U+20000 | 1 | 2 | 同上（这正是**补充平面的 CJK**） |

⇒ 改成 `for…of` + `codePointAt`（按**码点**走）后：**`agree=20/20, disagree=0`**，
且 `𠀀一` = **4 列**（2+2）正确。

★★ **这就是 B0.6 说"必须先出一条对拍臂"的理由本身** —— 它不是在走过场：
一条手写的表**必须**被一个独立来源挡一次，否则它的错会**静默留在渲染里**。

### ★ 对拍源怎么选的（不许自证）

★ 硬纪律说「不许把"我自己写的表"当对拍源」。这里的对拍源**按码点分类**（`codePointAt` 语义），
而被测表**按码元**（`charCodeAt`）—— 两条路真的不同，且**区间边界刻意取不同粒度**。
对拍样本 **32 条**，覆盖 ASCII / Latin-1 / 希腊 / 西里尔 / CJK 统一 / 假名 / 谚文音节 /
谚文 Jamo / 康熙部首 / 全角 / 半宽片假名 / 半宽谚文 / emoji / 补充平面 CJK / 全角空格，**逐字一致**。

★★ 而判据**如实声明了它能证明什么、不能证明什么**（`authority` 字段，逐字）：
```
proves: two INDEPENDENTLY WRITTEN range tables agree on these samples.
does NOT prove: that either table equals the full Unicode EastAsianWidth.txt
(importing that file would be a dependency, which B0.6 rejects).
```
★ 真正的权威是 Unicode 的 `EastAsianWidth.txt`；**引它就是一个依赖** —— 而那正是 B0.6 要避免的。
⇒ 这条臂的强度**如实写在返回值里**，不许让读者以为"验了全部 Unicode"。

## 2. B6：名字与职责分两行

改前：`<span class=memberName>名字</span><span class=memberRole>一长串英文</span>` 挤在**同一行** ⇒ 被截断。

改后：`memberRoleLine` 是 `memberLine` 的**兄弟**，按**列数**折行（`wrapByColumns`），
上限 **2 行**（`MEMBER_ROLE_MAX_LINES`），超出靠 `title` 与展开层全文兜底。

★ 机械探针：`data-member-role-columns` / `data-member-role-lines` / `data-member-role-row`
⇒ "这段占多少列、折了几行"是**读得出来的数**。

## 3. 三条反向半边（逐条实测）

**A —— 纯中文 vs 纯英文（同字符数）⇒ 列数必须不同**
```
'前端工程师岗' (6 字符)  → 12 列
'abcdef'      (6 字符)  →  6 列          比值 = 2.00 ✅
★ 辨识力探针："所有字符算 1"的实现会让两者相等（6 vs 6）⇒ A 测得出它
```

**B —— 与独立来源逐字对拍**：见 §1，**32/32 一致**（改前 2 条分歧，见上）。

**C —— 360px 下不溢出（逐行给出可读的列数证据）**
```
上限 44 列/行（容器 360px，见 MemberRow.tsx 的常量注释）
最长英文 role（184 字符 → 184 列）⇒ 折 2 行：第1行 39 列 · 第2行 39 列  ✅ 均 ≤ 44
纯中文长文本                ⇒ 折 2 行：第1行 44 列(22字) · 第2行 44 列(22字) ✅ 均 ≤ 44
★ 辨识力探针：按【字符数】折的实现在中文上是 88 列 / 50 列 ⇒ 溢出
```

## 4. ★★ 变异体（5 个真缺陷全部被检出；1 个**不是**真缺陷，如实记下）

两层判据：**纯函数层**（直接调 `charColumns` / `wrapByColumns`）与
**渲染层**（真的挂载 `MemberRow`，读结构）。

| 变异体 | 纯函数层 | 渲染层 | 判定 |
|---|---|---|---|
| M1 所有字符算 1 列（无宽度表） | FAIL=9 | FAIL=0 | ✅ |
| M3 回退 `charCodeAt`（代理对错） | FAIL=2 | FAIL=0 | ✅ |
| M4 折行按字符数（非列数） | FAIL=1 | FAIL=0 | ✅ |
| M6 职责不渲染 | FAIL=0 | FAIL=7 | ✅ |
| M7 `WIDE_SPANS` 清空 | FAIL=1 | FAIL=0 | ✅ |
| **M5' 把职责塞进 `memberLine`（真正"不分两行"）** | FAIL=0 | **FAIL=2** | ✅ |
| ~~M5 只把职责的**类名**改成 `memberLine`~~ | FAIL=0 | FAIL=0 | ★ **不是真缺陷** |

★★ **M5 那一条值得留下**：我第一版拿"类名"当结构 —— 而**改类名不改变 DOM 结构**，
所以"测不到"是**对的**，那条变异体**根本不是缺陷**（它不会让两行变一行）。
⇒ 我改成**真把职责块挪进 `memberLine`**（M5'）后 FAIL=2 ⇒ 判据问的是**结构**，不是类名。

### ★★ 另外两处"夹具自己坏了"（如实记下）
1. **M2（删半宽例外）测不到** —— 我先加了一条"独立"断言，**还是测不到**。查下去发现：
   `0xFF61–0xFF9F` **不在任何 `WIDE_SPANS` 区间里**（全角那一段是 `0xFF00–0xFF60`，
   **到 FF60 就停了**）⇒ **这个例外现在从不触发，它是冗余的**。
   ⇒ 处置：**不硬造一条自证的断言**，而是在代码里**如实标注"它现在是护栏、不是主路径"**，
   并说明它何时会承重（若有人把全角区间写成 `[0xFF00,0xFFEF]`）。
   ★★ 这也说明了**对拍臂能力的边界**：它只能发现"两张表**不一致**"，
   发现不了"两张表**犯同一个错**"。
2. **渲染层的"找名字节点"第一版按文本找 ⇒ 找不到 ⇒ 三条断言假红**。
   改成按类名找，并**先测前置（"找得到吗"）** —— 那条前置正是用来挡住"夹具自己坏了"的。

## 5. 尚未验证的部分（如实报出）

★ **没有验证过真实浏览器渲染**（臂 33x 在本机 `launchChrome()` 不 resolve，干净树同样 —— 与前几轮一致）。
渲染层判据用的是**仓内既有的最小 DOM 桩**（`scripts/workspace-activity.test.mjs` 的
`installMinimalDom`），它验证的是**React 真的按那个结构渲染了**，
**不是**"像素上真的没溢出"。

★ 而**反向半边 C 的强度**要说清：它证明的是
「**按 `charColumns` 算，每一行的列数 ≤ 44**」——
**44 这个数本身**来自"360px 容器 + 10.5px 字号"的**估算**（写在 `MEMBER_ROLE_MAX_COLUMNS` 的注释里）。
⇒ **"44 列在 360px 里真的放得下"需要浏览器确认**；本轮能保证的是
"折行按列数做、且每行不超过给定的上限"。

## 6. 改动清单

```
src/client/activity-model.ts   + WIDE_SPANS / HALFWIDTH_SPANS / isWideCode / charColumns
                               + wrapByColumns / cjkWidthTableCrossCheck（对拍臂）
src/client/MemberRow.tsx       + 职责另起一行；按列数折行；列数/行数探针
src/client/ActivityPanel.module.css  + .memberRoleLine / .memberRoleRow
lib/**（对应产物）+ lib/git-artifact-stamp.json
docs/UI-B5B6-CJK.md            本文
```

**未动**：`src/gates/**` · `src/state.ts` · `src/types.ts` · `src/tools/**` · `scripts/**` ·
`docs/REFACTOR-PLAN.md` · `src/client/locales.ts`（本轮无需新文案）。
★ **零新依赖**：`package.json` / `pnpm-lock.yaml` 未改。
