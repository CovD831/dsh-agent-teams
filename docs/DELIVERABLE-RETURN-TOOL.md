# G · 交付回流检查工具（`scripts/check-deliverable-return.mjs`）

> **它回答一个本仓此前没有判据回答的问题**：
>
> 「任务在**自己 worktree** 里提交的东西，**回到队长工作区了吗**？」

---

## 1. 为什么它必须存在（实测发生两次）

| 事件 | 现象 |
|---|---|
| **t18** | 修复产物在 `.agent-teams/worktrees/…-t18` 的提交 `e7c617b` 里，**队长工作区仍是旧版**（461 行 vs 546 行） |
| **t20** | 同样：提交 `f5f04de` 只在它自己的 worktree 里 |

★ **危害不是"文件没拿回来"这么轻** —— 它会让**复核判出与事实相反的结论**：

```
实现者 → 写在自己的 worktree 里（提交 e7c617b）
复核员 → 读的是队长工作区（还是 t16 的旧版）
⇒ 复核看到的是【已经被判定为错的那一版】⇒ 结论："缺陷没修"
   而事实是："修了，但没交回来"
```

⇒ ★★ **"没修"与"修了但没交回来"在读数上同形，而两者的处置相反**（一个要重做，一个只要取回）。
这正是本仓反复记账的那条形态；而它此前**没有任何判据**看得见。

★ **本仓已有的那条判据不管这件事**：`dispatch.worktree` 管的是
「隔离目录**建得出**吗」——它管**入口**；而**出口**（东西交回来没有）是空的。

---

## 2. 用法

```sh
node scripts/check-deliverable-return.mjs <commit> [--workspace <dir>] [--json]
```

| 参数 | 含义 |
|---|---|
| `<commit>` | 要检查的提交。任意 rev：完整 sha / 短 sha / 分支名 / `HEAD` |
| `--workspace <dir>` | 队长工作区根。**缺省** = 本脚本所在仓库的根（`git rev-parse --show-toplevel`） |
| `--json` | 机器可读输出（给夹具与下游用）；缺省是人类可读 |

**退出码与三态一一对应**（shell 侧不必解析文本）：

| 退出码 | 状态 | 含义 |
|---:|---|---|
| **0** | `ok` | 该提交的每个 changedPath，两边内容**逐字节相同** |
| **1** | `diverged` | 有路径两边不同（**逐条列出是哪几个文件、两边哈希各是什么**） |
| **2** | `unmeasured` | **读不出来**（文件不在任一侧 / 不是 git 对象 / 路径不可读 / **空交付**） |

★ **`ok` 与 `diverged` 不同码、`unmeasured` 又不同码** —— 三态**不许合并**。

---

## 3. 三态的定义（★ 不许并进 `ok`）

### `ok` —— 全等
```sh
$ node scripts/check-deliverable-return.mjs f5f04de --workspace /Users/abab/Desktop/agent-teams-dev
commit    : f5f04de
workspace : /Users/abab/Desktop/agent-teams-dev
state     : OK — all 1 path(s) are byte-identical

  same      docs/GATE-EFFICACY.md

★ the delivery is in the workspace. This tool does not merge: that is a human decision.
```

### `diverged` —— 有不等（逐条报哈希）
```sh
$ node scripts/check-deliverable-return.mjs e7c617b --workspace /Users/abab/Desktop/agent-teams-dev
state     : DIVERGED — 2 of 2 path(s) differ between the commit and the workspace

  DIFFERS   docs/GATE-EFFICACY-CONTEXT.md
              commit    c09143dafc6ad91d04bf757614948f1fac3f25aa705b130cd157451c8175a6e3
              workspace 2fcafc3437ee44fad0ac862d3415d683d5d432ba5050daea23452341407d5592
  DIFFERS   docs/GATE-EFFICACY.md
              commit    35c8c96e9ec92bc9f4e0a4532b03205b3a8c83767ddd773303df57d4d055c673
              workspace b0d37cd2bd2799b9b5e39a888397259de02843c586b9d7dd5966fd803751a634
```

### `unmeasured` —— 读不出（**绝不并进 `ok`**）

本仓最贵的一条纪律是「**可判定的事实不得写成没能测量**」；它的**反面同样成立**：
**没能测量不得写成通过**。一份读不出来的清单与一份恰好全等的清单**必须不同形**。

因此下列**四种**情形一律落 `unmeasured`（退出码 2），各自**带因**：

| 情形 | 报出的话 |
|---|---|
| 提交不是 git 对象 | `the commit "deadbeef…" is not a git object here` |
| **文件不在工作区** | `not in the workspace at <abs path>` |
| 提交里没有该路径（该提交**删除了**它） | `not in <sha> at this path (deleted by the commit?)` |
| ★ **空交付**（该提交不改变任何路径） | `changes no path — an empty delivery cannot be "returned"; writing it as ok would be vacuously true` |

★★ **最后一条是刻意的**：一个**什么都不改**的提交，"全等"是**恒真的**（空集上一切比较都成立）。
若不显式挡掉，这个工具就会给出一条**恒真的 `ok`** —— 而恒真的通过等于没有通过（本仓已记账多次）。

★ **成因不同的"没有"不许同形**（上表前三行各自一句）：它们的**补救动作相反** ——
「工作区没有」要**把东西取回**；「提交里没有」可能是**一次删除**，要核对是否该删。

---

## 4. ★ 只读，不归并（本仓纪律）

`docs/PROPOSAL-DELIVERABLE-RETURN.md` §6 逐字：

> 「**不**自动归并（不 `git merge`、不 `git checkout`）—— 判据只**报告**，
>   归并动作是人的决定（本仓纪律：**判据不替人做决定**）。」

**本工具只用两条 git 子命令，都是只读的**：

```sh
$ grep -oE "git\(\[?'(rev-parse|show)'" scripts/check-deliverable-return.mjs | sort -u
git(['rev-parse'      # rev 解析
git(['show'           # 取 changedPaths 与 <commit>:<path> 的内容
```

**动态证明（不是"我读过代码"，是实测指纹）**：

```sh
# 跑之前 / 跑之后 对整棵工作区取文件指纹
BEFORE=$(find . -type f | sort | xargs shasum | shasum)
node scripts/check-deliverable-return.mjs f5f04de --workspace /Users/abab/Desktop/agent-teams-dev >/dev/null
node scripts/check-deliverable-return.mjs e7c617b --workspace /Users/abab/Desktop/agent-teams-dev >/dev/null
AFTER=$(find . -type f | sort | xargs shasum | shasum)
[ "$BEFORE" = "$AFTER" ] && echo "✅ 工具没有改动任何文件"
```
⇒ 实测：**文件指纹相同、`git status` 相同**（工具跑完不留下任何痕迹）。

★ 而**"只报告"不是一句客套**：之所以不许自动归并，是因为**归并是可逆性最低的一步** ——
它把两棵树的历史搅在一起，而"这条交付该不该进"需要人看**内容**才能判（工具的哈希不回答"它对不对"）。

---

## 5. ★ 反向半边（可复跑：改一个字节 ⇒ 必须报不一致）

**没有反向半边的"检查"与"通过"在报告里同形。** 以下命令可直接复跑：

```sh
$ T=scripts/check-deliverable-return.mjs
$ WS=$(mktemp -d); mkdir -p "$WS/docs"
$ cp docs/GATE-EFFICACY.md "$WS/docs/GATE-EFFICACY.md"

# ① 原样拷贝 ⇒ OK（exit 0）
$ node $T f5f04de --workspace "$WS"; echo "exit=$?"
state     : OK — all 1 path(s) are byte-identical
exit=0

# ② 手工翻【一个字节】（'#' → '@'）
$ python3 -c "
p='$WS/docs/GATE-EFFICACY.md'
b=bytearray(open(p,'rb').read()); b[0]=ord('@'); open(p,'wb').write(bytes(b))"

# ③ 必须报不一致（exit 1），且给出两个哈希
$ node $T f5f04de --workspace "$WS"; echo "exit=$?"
state     : DIVERGED — 1 of 1 path(s) differ between the commit and the workspace
  DIFFERS   docs/GATE-EFFICACY.md
              commit    b0d37cd2bd2799b9b5e39a888397259de02843c586b9d7dd5966fd803751a634
              workspace 5f654d9539fcf439a73561ca1b10d6cb11c1b9529e9ef68d0bd0cd461f0ecec5
exit=1
```

⇒ **实测：一个字节就足以让它从 `OK` 翻成 `DIVERGED`** ⇒ 这条判据**可证伪**。

★ **一次完整生命周期（diverged → 人归并 → ok）** 也已实测（用一个临时仓库造的**真实**未回流提交）：

```sh
# 1. 工作区还是旧版（交付未回流） ⇒ DIVERGED / exit 1
# 2. 人把交付的字节拷进去（= 模拟归并） ⇒ OK / exit 0
```

---

## 6. ★ 真实场景：对本仓两个已知提交的实测读数（**如实报告**）

**命令**（也是契约的 verify 命令）：
```sh
$ git show --name-only --format=%H e7c617b
$ git show --name-only --format=%H f5f04de
```

**读数**（工作区 = 队长工作区 `/Users/abab/Desktop/agent-teams-dev`）：

| 提交 | 三态 | 说明 |
|---|---|---|
| **`f5f04de`（t20）** | **`ok`**（exit 0） | ★ **一致** —— 队长**已把 t20 的交付取回**。`docs/GATE-EFFICACY.md` 两边**逐字节相同**（`8378e8ee76ab…`） |
| **`e7c617b`（t18）** | **`diverged`**（exit 1） | ★ **不一致** —— 两文件都不同：`GATE-EFFICACY.md` 被**更晚的 `f5f04de` 取代**；`CONTEXT.md` 后来又被人改过 |

★★ **这两条读数都是真的，而且不矛盾 —— 必须一起读**：

1. **git 层面它们都没被归并**：
   ```sh
   $ for c in e7c617b f5f04de; do git merge-base --is-ancestor $c HEAD && echo "$c MERGED" || echo "$c NOT an ancestor"; done
   e7c617b NOT an ancestor
   f5f04de NOT an ancestor
   ```
   ⇒ **两个提交都不是 HEAD 的祖先**（仓库里从没 `git merge` 过它们）。

2. **但内容层面 t20 的交付确实在工作区里**：
   队长**手工拷贝**了文件（不走 git 归并）⇒ `f5f04de` 报 `ok`。

⇒ ★ **这正是本工具的用武之处，也正是它证明的一点**：
**「提交是不是祖先」与「东西回没回来」是两个问题。**
`git branch --contains` 会告诉你"没归并"（这两条都会说 `NOT an ancestor`），
而**它不回答"队长盘上那份是不是这一版"** —— 而复核员读的恰恰是**盘上那份**。

★ **关于 `e7c617b` 报 `diverged` 是否算"未回流"** —— 如实说明：**它已不适用**。
它不是"东西丢了"，而是**被更晚的交付（`f5f04de`）取代**，且 `CONTEXT.md` 在那之后又被改过。
⇒ **本工具报的是"这个提交的内容是否就是工作区现在的样子"，而不是"历史上它有没有回来过"。**
后者需要按提交序列逐条跑（见 §8 的局限）。

---

## 7. 验收：三态各自的可复跑命令

```sh
$ T=scripts/check-deliverable-return.mjs

# ok
$ node $T f5f04de --workspace /Users/abab/Desktop/agent-teams-dev ; echo $?    # ⇒ OK / 0
# diverged
$ node $T e7c617b --workspace /Users/abab/Desktop/agent-teams-dev ; echo $?    # ⇒ DIVERGED / 1
# unmeasured（三种各自带因）
$ node $T deadbeefdeadbeef ; echo $?                                            # ⇒ 不是 git 对象 / 2
$ WS=$(mktemp -d) && node $T f5f04de --workspace "$WS" ; echo $?                # ⇒ 工作区没有 / 2
# unmeasured（空交付：恒真保护）
$ NOOP=$(git commit-tree "$(git rev-parse HEAD^{tree})" -p HEAD -m noop)
$ node $T "$NOOP" ; echo $?                                                     # ⇒ 空交付 / 2（不是 ok）
```

---

## 8. ★ 这个工具的边界（不许把边界读成"它不管"）

| # | 局限 | 说明 |
|---|---|---|
| **1** | **只比内容，不比"该不该进"** | 哈希全等**不代表**交付是对的。工具回答"回没回来"，不回答"好不好" |
| **2** | **只对单提交** | 它说"**这个**提交的内容是不是工作区现在的样子"。一条交付若随后被**更新**的提交取代，会报 `diverged` —— 那是**正确**的（工作区确实不再是那一版），但**不等于**"当初没回来" |
| **3** | **不做语义比较** | 工作区那份可能**恰好**与提交相同但**来源无关**（例如两边独立写成一样） |
| **4** | **不覆盖被 `.gitignore` 的路径** | 本工具的"工作区侧"是**文件系统读取**，所以 gitignored 的文件**也算**（这比 `git diff` 更强）；但**不存在**的文件一律 `unmeasured` |
| **5** | ★ **本工具自己也有那条走廊** | 它的"提交侧"读 `git show`，"工作区侧"读文件系统 ⇒ 若**两者指向不同的仓库**（例如你从 A 仓库跑到 B 仓库上），`rev-parse` 会失败 ⇒ 报 `unmeasured`，**不会**静默给出错的 `ok`（已实测：跨仓库时报 `the commit … is not a git object here`） |

---

## 9. 它该被用在哪（下一步，**不属于本任务**）

本工具是**只报告**的那一半。要让它真正拦住事件，还需要在某个**插入点**调用它 ——
`docs/PROPOSAL-DELIVERABLE-RETURN.md` §4 给的形状是一条判据（`completion.deliverable-return`），
而**接不接、接在哪**是**用户/队长的裁定**（本任务 out of scope，且提案 §7 已把它列为待裁定）。

★ 本工具**不自带调用点** —— 那是刻意的：先有可跑的读数，再谈要不要把它变成闸门。
