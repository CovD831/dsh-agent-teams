# P 线 · 效率：快环 / 全环两套验证（t61）

> **只读说明**：本文描述的实现只写 `scripts/` 与 `package.json`（**未改 `src/`**）。
> **测量点**：HEAD `0b29ba5`（M3 之后）· 测量机：本 worktree（与队长 `EFFICIENCY-PROBE` 同一台，**不同时刻**）。

---

## 1. 一句话

新增 `pnpm verify:fast`（**按改动面**选夹具）+ `pnpm verify:fast:self-test`（**约束一/二的机械自检**）。
★ **而实测结论与计划的预期不符** —— 见 §3，**豁免集合本身就吃掉 89% 的预算**。
这条比"做出来了"重要，本文如实报。

---

## 2. 交付物

| 文件 | 作用 |
|---|---|
| `scripts/select-fixtures.mjs` | **选择器**：给一组改动路径，交回该跑的夹具 + **逐条理由** |
| `scripts/verify-fast.mjs` | **快环**：跑选择器选出的夹具；内含**约束一**的静态断言与其**反向半边**；`--self-test` 可独立复跑 |
| `package.json` | 新增 `verify:fast` 与 `verify:fast:self-test` 两个条目（`verify` 全环**一字未改**） |

---

## 3. ★★ 先说不好的：**豁免集合吃掉了 89% 的预算**

约束二要求「**全仓扫描夹具豁免 `inScope` 裁剪**」（它们恒跑）。
★ 而**实测**：那 17 个正是最贵的那些。

| 组成 | 实测耗时 | 占比 |
|---|---:|---:|
| **全部 88 个 `gate-*.test.mjs`** | **45s** | 100% |
| ├ **17 个豁免的扫描器** | **40s** | **89%** |
| │ ├ `gate-producer-consumer` | **28.5s** | 63% ← **单个夹具** |
| │ ├ `gate-friction-capture` | **20.4s** | 45% ← **单个夹具** |
| │ └ 其余 **15** 个扫描器 | **6.1s** | 14% |
| └ 71 个**不**豁免的夹具 | 26s | 58% |

（★ 两个夹具相加 > 40s 是因为**测量有噪声**；下面 §3.1 给同一会话内的对照读数。）

⇒ ★★ **对一次"只改 `package.json` / `docs/`"的改动**：
```
$ pnpm verify:fast     ⇒ 17 / 88 个夹具 ⇒ 39s    ← 只省了 6s（45s → 39s）
```
**因为省掉的那 71 个里，26s 是它们，而剩下的 17 个恒跑的占 40s。**

### 3.1 ★ 这条为什么必须写下来（而不是当成"做出来了"）

计划的推论是「少跑夹具 ⇒ 更快」。**实测否证了它的一半**：
在**约束二存在**的前提下，"少跑"能省的是**那 58% 里被选中的部分**，而**89% 的固定开销动不了**。

⇒ ★ **真正的杠杆不是"选夹具"，而是那两个 28.5s / 20.4s 的夹具本身。**
（它们是**扫全仓**的 ⇒ 成本 `O(仓库规模)` ⇒ 这正是队长在 `EFFICIENCY-PROBE` 里记的
「**越加越慢的结构性根因**」。本任务的 P5「扫全仓夹具的读取缓存」才正对它，
而那是"若时间允许"的那一格 —— 本轮**没做**，见 §7。）

★ **我不把这条写成"任务失败"**：快环**做出来了、可用、且约束可静态断言**（§4/§5），
省下的 6s 是真的。但**把"省 6s"说成"效率问题解决了"是假的**，所以它在这里单列。

---

## 4. ★★ 约束一：快环结果**不得进入任何终态裁决 / 派工判据**

### 4.1 它的三条机械形式

| # | 形式 | 位置 |
|---|---|---|
| **① 结构** | 快环产物**只有一个字段集**：`{ mode:'fast', at, ran, skipped, changed }` —— ★ **刻意没有 `ok` / `verdict` / `blockers` / `gate`**（四个"下结论"的词） | `writeState()` |
| **② 静态断言** | `src/**` 的**代码**里不许出现指向快环产物的引用（`fast-ring` / `verify:fast` / `fast_ring`） | `assertFastRingIsNonAuthoritative()` |
| **③ 反向半边** | 往一份 `src/` 副本里**植入**一个"把快环读数写进 `verdict`"的文件 ⇒ 同一条断言**必须报出它** | `selfTestReverseHalf()` |

★ **②的两条口径细节（都是刻意的）**：
- **剥注释，不剥字符串**。讨论这件事的注释在 `src/` 里**到处都是**（本仓的文化），
  而真正的违规**必然**把路径写成**字符串**（`join(pluginRoot(), '.agent-teams', 'fast-ring')`）。
  ⇒ 剥掉字符串会让断言**抓不到它要抓的东西**。
- 扫的是 `src/**` 的 `*.ts` / `*.tsx`（不改任何文件，**只读**）。

### 4.2 可复跑（★ 一条命令，不依赖任何夹具）

```sh
$ pnpm verify:fast:self-test
[fast-ring] constraint-1 static assertion
  real src/ offenders : 0 ✅
  reverse half (planted): 1 ✅ (the assertion has discriminating power)
    src/offender.ts:3: const p = join(pluginRoot(), '.agent-teams', 'fast-ring', 'last-run.json')
[fast-ring] constraint-2 exemption
  repo-wide scanners always selected: 17 ✅ (matches grep -lE "walk\(|readdirSync" 口径 A)
  exempt under every changed-path shape: 5 shapes checked → ✅ always present
exit=0
```
⇒ ★★ **两个半边都在**：真实的 `src/` **0 条违规**（通过），而**植入的那一条被抓到**（有分辨力）。
没有第二行，"通过"与"这条断言根本不会红"在报告里**同形**。

---

## 5. ★ 约束二：全仓扫描夹具**豁免** `inScope` 裁剪（口径 A ⇒ 17）

**判定**（与 `docs/` 逐字同源）：
```sh
$ grep -lE "walk\(|readdirSync" scripts/gate-*.test.mjs | wc -l    # ⇒ 17   ← 本实现采用（宽）
$ grep -l  "readdirSync"      scripts/gate-*.test.mjs | wc -l    # ⇒ 15
```
★ **我的函数与那句 grep 逐条相等**（实测比对集合，非只比数量）：
```
via isRepoWideScanner() : 17
via grep -lE A          : 17
✅ IDENTICAL
```
★ 而 `--self-test` 把这条**做成断言**（`wide.length === 17`），口径漂了就红。

**「它们始终进快环」的证明**（★ 不是"我看了一眼代码"）：
`--self-test` 用 **5 种改动面形状**（`src/foo.ts` · `scripts/bar.mjs` · `docs/baz.md` · **空** · `README.md`）
各跑一次选择器，断言那 17 个**每次都出现**：
```
exempt under every changed-path shape: 5 shapes checked → ✅ always present
```
⇒ 连**空改动面**（`changed = []`）也恒选它们 —— 那是"任何改动都可能影响它们"的极限形式。

---

## 6. 选择规则与一次真实读数

**规则**（详见 `scripts/select-fixtures.mjs` 的文件头）：夹具入选 ⟺ **至少一条**成立
① 它是全仓扫描的（**豁免**，恒选）｜ ② 改动路径**就是**它自己 ｜ ③ 改动路径出现在它的**源码文本**里。

**真实读数**：
```sh
$ node scripts/select-fixtures.mjs --changed-from-git      # 本次改动 = package.json（1 个）
selected 17 / 88 fixtures (of which 17 repo-wide scanners are exempt)

$ node scripts/select-fixtures.mjs src/tools/shared/entities.ts
selected 20 / 88 fixtures (of which 17 repo-wide scanners are exempt)
  gate-assignment-parity.test.mjs  ← reads src/tools/shared/entities.ts
  …

$ pnpm verify:fast                                         # 实跑
[fast-ring] 17 / 88 fixtures (repo-wide scanners exempt: 17)
[fast-ring] NOTE: this ring is NOT a verdict — it ran a SUBSET. Delivery requires the full ring.
ℹ tests 147 · pass 139 · fail 3
```

★ **③ 是一条代理读数**，所以它的**边界**必须写明（见 §7 第 3 条）：
- **可能多选**（夹具在注释里提到某路径）⇒ **安全**（多跑不误判）；
- **可能漏选** 一个"读了某文件却没把路径写下来"的夹具 ⇒ ★ 而**碰到全仓的那一类被 ① 兜住**。
⇒ 这正是 ① 存在的原因，也正是本口径的边界。

---

## 7. ★ 「测不了」与边界（不许把边界读成"它没问题"）

| # | 测不了 / 边界 | 说明 |
|---|---|---|
| 1 | ★ **P5（扫全仓夹具的读取缓存）未做** | 计划的"若时间允许"。★ 而 §3 显示**它才是真正的杠杆**（那两个夹具 49s）。⇒ **建议单独立项**，不要让它继续挂在"若时间允许"上 |
| 2 | ★ **P4（判据成本可见）未做** | 同上。本轮的耗时读数是**临时 `date` 测的**，**没有落进任何产物** ⇒ 不可复跑。⇒ 也是一个应立的小项 |
| 3 | 选择器 ③ 的**漏选** | 见 §6 的边界。★ 漏选**不会**被快环自己发现（它只报"我跑了什么"） |
| 4 | 快环**不替代全环** | ★ 这是约束一的**本意**：产物里没有 `ok`，且 `NOTE` 每次打印。**但它无法阻止人肉把 `verify:fast` 的退出码当裁决** —— 那只能靠纪律，不是靠代码 |

---

## 8. ★ 净变化（判据是**集合**，不是计数）

**基线（把本轮改动全部移走后重跑）**：
```
$ pnpm test:gates   ⇒ ℹ tests 1471 · pass 1410 · fail 23 · 失败文件 16 个
```
**改动后**：
```
$ pnpm test:gates   ⇒ ℹ tests 1471 · pass 1410 · fail 23 · 失败文件 16 个
$ diff <基线失败集合> <改动后失败集合>    ⇒ （无输出）✅ 逐行相同
```
⇒ ★★ **`pnpm test:gates` 净新失败 = 0**（失败文件集合**逐条相同**）。

★ **一次读数抖动，如实记**：第一次全量跑出现 **17** 个失败文件，多的是
`scripts/gate-shared-artifact-writes.test.mjs`。查明：
- **单跑 5/5 通过**（且是在我**全部改动在场**的情况下跑的）；
- 第二次全量跑**它没红**；
- 那个夹具的职责恰恰是「**共享产物在并发下的序关系**」（`t68`）—— ★ **它在并发下自己会抖**，
  而那正是它要抓的形状。⇒ 判定为**夹具抖动**，不是本轮改动造成的。
★ 但**判据仍按集合报**：`16 vs 16`，`diff` 空。

`pnpm verify` 的失败集合：**改前 8 条 == 改后 8 条**（`diff` 空，逐条相同）。

---

## 9. 契约的 verify 命令读数

```sh
$ node -e "const p=require('./package.json'); console.log(Object.keys(p.scripts).filter(k=>k.includes('verify')).length)"
19                     # 改前 17 ⇒ 新增 2 个
$ node scripts/verify.mjs || echo VERIFY_IS_RED_AS_EXPECTED
VERIFY_IS_RED_AS_EXPECTED    # ★ 与改前同：它本来就是红的（8 条 UI 断言）
```

---

## 10. 给下一个人的三条

1. ★ **不要用 `verify:fast` 的退出码做裁决** —— 产物里**没有** `ok` 字段是**刻意的**；
   而 `verify` 才是交付判据。这条有静态断言盯着（§4），**但人肉的读法它管不了**。
2. ★ **真正的效率杠杆是那两个 28.5s / 20.4s 的夹具**（§3），不是"选夹具"。
   在动选择器之前，先去看它们为什么那么贵。
3. ★ **口径 A（17）与 `isRepoWideScanner()` 必须一起改**：`--self-test` 里有
   `wide.length === 17` 的断言 —— 只改一边会当场红（这是**故意的**）。
