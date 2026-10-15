# N 线盘局收拢（N2/N3）：判定 + 基线（t66）

> **本文件是 N2/N3 的判定记录。** 结论是：**两条迁移都不可行，而原因不是"没做"，是实测的结构性障碍。**
> ★ 本文**未改任何 `src/` 或 `scripts/` 文件** —— 见 §0 的 inScope 说明。

---

## 〇、★ 先说清楚：本轮**没有产生代码改动**，以及为什么

| 步 | 判定 | 依据 |
|---|---|---|
| **N2**（把运行时机制迁进 `src/`） | ❌ **不可行** | §2 的**实测**：`.mjs` 放进 `src/` **不会**被 `tsc` 产出到 `lib/` ⇒ 迁完**必然**调不到 |
| **N3**（`scripts/{dev,release,harness}/` 分层） | ⛔ **不在我写域** | §4：要移动的那些文件**全部不在**本任务 inScope，且移动会打断 `package.json` 与**至少 10 个夹具** |

★ 而 **N2 的判定顺带查出一条真缺陷**（§3）：那两个机制**根本没进包** ——
**而那件事的修法也不在我写域**（`package.json`）。⇒ 按 t54/t60 的同一纪律：**报出，不动手**。

---

## 1. N1 的读数（本轮的起点，已复核）

`docs/PLATE-MAP.md` 的结论我**独立复核过**，逐条成立：
```
真·生产引用只有 2 个：
  scripts/friction-triage.mjs  ← src/tools/shared/entities.ts:1994
  scripts/worktree-reclaim.mjs ← src/tools/update-task.ts:728
其余 6 个"机制"的可执行引用为 0
```
```sh
$ grep -rnE "join\(pluginRoot\(\), *'scripts'|import\(.*scripts/" src/ --include=*.ts \
    | grep -E "friction-triage|worktree-reclaim"
src/tools/shared/entities.ts:1994:  …join(pluginRoot(), 'scripts', 'friction-triage.mjs')…
src/tools/update-task.ts:728:      …join(pluginRoot(), 'scripts', 'worktree-reclaim.mjs')…
# ⇒ 恰好 2 处，行号与 N1 逐字相同
```

---

## 2. ★★ N2 判定：**迁进 `src/` 不可行**（三层实证，不是推断）

### 2.1 第一层：`tsconfig` 的结构

```sh
$ python3 -c "…读 tsconfig.json…"
rootDir: src        include: ['src']        exclude: ['src/client']        allowJs: (未设)
$ find src -name '*.mjs' | wc -l
0                   # ★ src/ 下今天一个 .mjs 都没有
```
⇒ `allowJs` **未设** ⇒ `src/` 下的 `.mjs` **不参与编译**。

### 2.2 ★★ 第二层：**实测**——放进去也不会产出

不是从 `allowJs` 推断的，而是**真的放一个进去跑了一遍**：
```sh
$ mkdir -p src/__probe__ && printf 'export const probe = 1\n' > src/__probe__/probe.mjs
$ npx tsc -p tsconfig.json --outDir /tmp/probe-out --declarationDir /tmp/probe-out/types
tsc exit=0
$ ls /tmp/probe-out/__probe__/
NOT EMITTED ⇒ a .mjs under src/ never reaches lib/
```
⇒ ★★ **迁进 `src/` 的 `.mjs` 不会出现在 `lib/` 里** ⇒ 而**生产路径读的是 `lib/`**
（或 `pluginRoot()` 下的产物）⇒ 迁完**必然调不到**。

### 2.3 第三层：路径算术会被静默改变

两个机制都**依赖自己在 `scripts/` 这个位置**：

```js
// scripts/worktree-reclaim.mjs:137
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
```
```sh
$ node -e "…同一条算式，三种落点…"
/repo/scripts/worktree-reclaim.mjs => ROOT = /repo            ← 今天（对：仓库根）
/repo/src/tools/worktree-reclaim.ts => ROOT = /repo/src       ← 搬进去就错了
/repo/src/worktree-reclaim.ts      => ROOT = /repo            ← 只有放在 src/ 根才对
```
★ 而那个 `ROOT` 是**承重的**，源码注释逐字写着：
> 「★★ 回收的根：**父仓库**，而不是"我自己所在的那个检出"」
> 「…那时 `ROOT` 是那棵 worktree ⇒ `.agent-teams/worktrees/` **不存在** ⇒ 扫描结果是 **0 个**，
>   而它与"确实没有可回收的"**同形**。」

⇒ ★★ **搬迁会静默改变一个被文档判定为承重的值**，而"扫描 0 个"与"确实没有"同形 ——
那正是本仓记账最久的形态。

### 2.4 ⇒ 结论

**N2 不可行**，而**不是**"本轮没时间做"。三条实证各自独立，且**第二层是决定性的**（实测产出为空）。

---

## 3. ★★★ 而复核 N2 时查出一条**真缺陷**（必须报出）

### 3.1 读数

`package.json` 的 `files` 白名单（决定**用户装上之后有什么**）：
```json
["lib", "assets/agent-teams", "assets/readme", "assets/ui.png", "cordis.patch.yml",
 "release-notes", "README.md", "README_ZH.md", "compatibility.json",
 "scripts/doctor.mjs", "scripts/compatibility.mjs",
 "scripts/fixtures/baseline-known-failures.json", "pnpm-workspace.yaml"]
```
```sh
# ★ 那两个被生产动态 import 的文件，在不在白名单里？
scripts/friction-triage.mjs    ⇒ MISSING
scripts/worktree-reclaim.mjs   ⇒ MISSING
scripts/judgement-triage.mjs   ⇒ MISSING   （它是 friction-triage 的依赖）
```

### 3.2 为什么会坏

生产路径是：
```js
const target = pathToFileURL(join(pluginRoot(), 'scripts', 'friction-triage.mjs')).href
return await import(target)
```
⇒ 在**本机**它工作，因为**插件恰好 `link:` 在本仓库里**（`docs/` 记过这个巧合）。
⇒ 而在**用户机器**上，`pluginRoot()/scripts/friction-triage.mjs` **不存在**（没进包）
⇒ 那次动态 `import` **抛** ⇒ `readExperienceDispatch` 走它的 `unmeasured` 分支
（**它会如实报"装载不了"** —— 这一点是好的）⇒ **但那条功能在用户那边从来没工作过**。

### 3.3 ★ 有**先例**，而且判词一模一样

```sh
$ git log --oneline -S'baseline-known-failures.json' -- package.json
981cb4f fix: the two process.cwd() sites get the anchors that actually hold
```
该提交的说明逐字：
> 「But a second-order defect surfaced only because a reviewer built the **INSTALLED shape**
>   rather than testing in the checkout: **package.json's `files` whitelist ships only `lib/`
>   plus two named scripts**, so `scripts/fixtures/` never reaches a user's machine.
>   The loader would answer `undefined` there and the pin list would go back to being
>   indistinguishable from no list at all — **the exact state this list exists to avoid.**
>   Proven with a real `npm pack`…」

⇒ ★★ **同一类缺陷、同一段推理、同一个修法**（往 `files` 里加一行），
而那次**只修了 `baseline-known-failures.json` 一个文件**，**这两个机制被漏掉了**。

### 3.4 修法（★ 不在我写域，故只报）

```diff
   "files": [
     …
     "scripts/doctor.mjs",
     "scripts/compatibility.mjs",
     "scripts/fixtures/baseline-known-failures.json",
+    "scripts/friction-triage.mjs",
+    "scripts/worktree-reclaim.mjs",
+    "scripts/judgement-triage.mjs",
     "pnpm-workspace.yaml"
   ]
```
★ `judgement-triage.mjs` **必须一起加** —— 实测 `friction-triage.mjs:126-127` 是**真代码**：
```js
export { triage as triageJudgement, … } from './judgement-triage.mjs'   // :126
import { triage as triageJudgement } from './judgement-triage.mjs'      // :127
```
（★ 我一开始 grep 到的是**注释里的**同名提及，差点误判 —— 逐行核过才确认这两行是真代码。）

### 3.5 ★ 精确到"闭包里有几个文件不发货"（不是猜）

我把两个机制的**相对 import 传递闭包**算了一遍（剥注释、解析 `./` 与 `../`）：
```
transitive closure size: 4
files in closure that DO NOT ship:
    scripts/friction-triage.mjs
    scripts/worktree-reclaim.mjs
    scripts/judgement-triage.mjs
```
⇒ ★★ **闭包共 4 个文件，恰好 3 个不发货**；第 4 个是 `lib/worktree.js`
（`worktree-reclaim.mjs:126,135` 的依赖），它**被 `"lib"` 覆盖**、确实在盘上。
⇒ **§3.4 那三行是完备的** —— 不是"大概要加几个"，是**闭包内全部缺失项的精确清单**。

★ **验证方法**（与先例同法）：`npm pack` 之后在 tarball 里确认这三个文件在。

---

## 4. N3 判定：分层**不在本任务写域**（且它的风险是量的，不是质的）

### 4.1 障碍

N1 的分类是：**开发工具 27 · 发布工具 5 · 一次性夹具 5**。
⇒ 分层要移动的文件**全部不在**本任务 inScope（inScope 只有两个运行时机制 + `entities.ts` + 产物 + docs）。

### 4.2 而移动一个 `scripts/` 文件的**影响面**是实测的（不是猜的）

```sh
$ grep -rl "scripts/friction-triage\|scripts/worktree-reclaim" --include=*.mjs --include=*.json . | grep -v node_modules
./package.json
./scripts/review-unified-pipeline.test.mjs
./scripts/verify-unified-pipeline.test.mjs
./scripts/friction-triage.test.mjs
./scripts/gate-t1-completion-probe.test.mjs
./scripts/gate-producer-consumer.test.mjs
./scripts/fixtures/baseline-known-failures.json
./scripts/gate-plan-reviewed.test.mjs
…（至少 10 处引用这两个名字）
```
★ 加上 `package.json` 里**逐条列名**的 `test:gates`（88 个夹具）与两个 `reclaim:*` 脚本，
以及 `files` 白名单里的三条 `scripts/…` 路径。
⇒ **分层不是"移动文件"，是"改一张会被 12 处以上引用的名字表"**。

### 4.3 ⇒ 结论

**N3 未做**，理由**不是"不重要"**，而是：① 文件不在我写域；
② 它的**正确形状取决于 N2 的判定** —— 而 N2 已判不可行（§2），
所以"运行时机制该放哪一层"这个问题**今天没有答案**（它们**只能留在 `scripts/` 根**，
因为搬走就调不到）。
⇒ ★ 建议：**分层只对 `dev/` `release/` `harness/` 三类做**（共 37 个），
而那需要一个**写了 `scripts/` 全部那些文件**的任务 —— 请另派。

---

## 5. ★ 硬验收②：反向半边 —— **怎么证明"报出失效"这件事本身有效**

要求是「迁完若有条失效，**必须能报出**；不要只报'都成功了'」。
★ 而本轮**没有迁移** ⇒ 没有"迁移后失效"可报。**但判据可以现在给出并可复跑**。

### 5.1 我做的临时检查器（已实测有效，**未留在盘上**——不在 inScope）

`broken` 态的定义：**生产路径调它（真代码引用）∧ 它不进包**。

```sh
# ① 常态 ⇒ 2 条 broken（★ 即 §3 那条真缺陷）
[reachability] 44 non-test script(s) checked
  ★ wired  (production calls it AND it ships): 0
  ★★ broken: 2
      scripts/friction-triage.mjs  ⇒ not in package.json "files"
        ← called from src/tools/shared/entities.ts:1994
      scripts/worktree-reclaim.mjs ⇒ not in package.json "files"
        ← called from src/tools/update-task.ts:728

# ② ★ 反向半边：把两个文件加进 files 白名单 ⇒ 必须翻成 wired / exit 0
  ★ wired  : 2      ★★ broken: 0                      ⇒ exit=0
# ③ 还原 ⇒ 翻回 broken 2 ⇒ exit=1
```
⇒ ★★ **检查器有分辨力**（加进去就绿、拿掉就红），所以"报出失效"这件事**不是空话**。

### 5.2 ★ 一处必须留痕的自纠

该检查器**第一版把行号报错了**：它报 `entities.ts:1227` / `update-task.ts:352`，
而真实调用点是 `:1994` / `:728`。
**根因**：我在**剥掉注释之后**取行号，而剥注释**删掉了整行** ⇒ 行号与原文错位。
**修法**：把块注释替换成**等量空行**（而不是删掉），行号自然对齐。
⇒ 修后**逐字命中** `:1994` / `:728`（与 N1 的读数一致）。
★ 记下来是因为：**一个报错行号的检查器，会把读的人送到错的地方** ——
而"送到错的地方"比"没报"更坏。

---

## 6. ★ 净变化

**本任务未改任何代码文件** —— 盘上只多出本文档：
```sh
$ git status --porcelain
?? docs/N-LINE-CONVERGENCE.md
```
★ `pnpm test:gates` 的**失败文件集合与基线逐条相同**（基线见 §7）。
★ 没有代码改动 ⇒ 不可能引入回归；**这也是本轮唯一能保证"净变化 = 0"的方式** ——
而它同时意味着 **N2/N3 的验收项 ⑤（N4 的 `auto.gates[]` 消费不被破坏）自动成立**：
本轮**没有碰**那条路径（`entities.ts` 一行未改）。

---

## 7. 基线（供下一个人对照，实测）

```sh
$ pnpm test:gates
ℹ tests 1471 · pass 1410 · fail 23 · skipped 38
failing files: 16
```
16 个失败文件：`gate-baseline-known-failures` · `gate-contract-build-artifacts` ·
`gate-falsification-pairs` · `gate-input-wiring` · `gate-producer-consumer` ·
`gate-repair-completion` · `gate-reviewed-passthrough` · `gate-source-reading-convention` ·
`gate-stale-module` · `gate-t1-completion-probe` · `gate-worktree-arrival` ·
`verify-admission` · `verify-input-requires` · `verify-runtime-integration` ·
`verify-unified-pipeline` · `verify-task-atomicity`。

★ 另：本 worktree 到手时 stamp（`5108854444a9`）≠ HEAD（`1a1672d53e70`），
而 `node scripts/git-artifacts.mjs --check` 自报 **"this is PRE-EXISTING: it predates the current work
and is not caused by it"** ⇒ 与本任务无关（且本轮未跑 `pnpm build`，因为**没有源码改动可构建**）。

---

## 8. ★ 交给下一个人的四条

1. ★★ **N2 不要再试"把 `.mjs` 搬进 `src/`"** —— §2.2 已实测它**不产出**。
   若真要迁，**唯一的形状是"重写成 `.ts` 并让 `tsc` 编译它"**，
   而那要同时处理 §2.3 的 `ROOT` 算术（那条算式**只有放在 `src/` 根才对**）。
   ⇒ 那是一件**重写**，不是搬家。
2. ★★ **先修 §3.4 那三行 `files`** —— 它比 N2/N3 **便宜得多**，而且**修的是"用户那边从来没工作过"**。
   修完请用 `npm pack` 在 tarball 里核对（先例 `981cb4f` 就是这么验的）。
3. ★ **N3 分层请另派**，且只对 `dev/release/harness` 三类做（37 个）；
   `runtime/` 那一层**今天不成立**（§4.3）。
4. ★ **检查器的行号必须指向原文**（§5.2）—— 拿掉注释时用**等量空行**，不要删行。
