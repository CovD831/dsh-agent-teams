# 裁决 ① 的实测答案：`worktree` 保留，而回收的**真实缺口**不是"没接进终态"

> 2026-10-21。下面每一条都可复跑。

---

## 0. 先说结论

**回收机制早就接在终态那一跳了**（`reclaimWorktreeAfterDelivery`，
`src/tools/update-task.ts`，由提交 `5441b81` / `077b794` 落）。
⇒ 所以"把 reclaim 接进终态"这个建议**不需要做** —— 它已经在。

★★ **而真正的问题是判据看不见"内容已被吸收"的那 4 棵。**

---

## 1. 读数

```
$ node scripts/worktree-reclaim.mjs
  主干引用：task-mutation-integrate @ 0a35dd7
  可清 1 · 保留 5 · 判不了 0
  预计回收 2497.5 MiB
```

清掉 t6 之后：

```
$ du -sk .agent-teams/worktrees/*/ | sort -rn
  1712.1 MB  task-agent-teams-refactor-t108/
  1402.7 MB  task-shortfall-repair-t1/
   648.4 MB  task-shortfall-repair-t3/
   648.4 MB  task-shortfall-repair-t4/
   648.4 MB  task-shortfall-repair-t5/
  ─────────
  合计 ≈ 4.5 GB（5 棵）
```

---

## 2. ★★★ 保留的 5 棵里，有 4 棵的**内容已经在主树里**

逐条核实（可复跑）：

```bash
# ① 那 4 棵的 HEAD 全都是 t1 的提交
$ for t in t1 t3 t4 t5; do git -C .agent-teams/worktrees/task-shortfall-repair-$t log --oneline -1; done
  084604c task(t1): worktree deliverable      ← 四棵同一个

# ② 而 t1 / t3 的**内容**确实在主树里（实测行为，不是看文件在不在）
$ grep -c "生产零求值点" src/gates/index.ts            # → 2（t1 的改动）
$ node -e "…judgeSelfReview(requirements 自审)…"        # → ok:false（t3 的修复生效）

# ③ t4 / t5 是**零脏文件**（一个从未产出、一个是契约不可满足时正确地停下）
```

⇒ ★★ **4 棵树的内容都在主树里，而判据答 `keep / not-absorbed`。**

---

## 3. 为什么判据看不见 —— 逐文件定位

```bash
$ for f in docs/REQUIREMENTS.md src/gates/index.ts src/types.ts; do
    blob=$(git rev-parse "084604c:$f")
    echo "$f  blob=${blob:0:8}  在主干历史=$(git rev-list --objects HEAD -- "$f" | grep -c "^${blob:0:8}")"
  done
  docs/REQUIREMENTS.md   blob=310ac8ac  在主干历史=0     ← ★ 只有这一个不在
  src/gates/index.ts     blob=25688ec0  在主干历史=1
  src/types.ts           blob=dc510c3a  在主干历史=1
```

★★ **根因**：`containedAbsorbed` 要求"**它碰过的每一个文件**的内容都在主干历史里"。
而 `084604c` 那份 `docs/REQUIREMENTS.md` 是「§18 结尾」的版本 ——
我在它之后又追加了 §19 / §20 / §21 ⇒ **那一份内容永远不在任何提交里**。

⇒ ★★★ **这是判据的正确行为，不是缺陷。**
它说"这棵树碰过的文档，主干里没有一模一样的版本"——而**那是真的**。

---

## 4. 所以裁决 ① 的真实选项

| | 做法 | 代价 | 判断 |
|---|---|---|---|
| **(甲)** | 保留隔离；这 4 棵**靠人判一次**后手工删 | 零（一次性）| ✅ **建议** |
| **(乙)** | 放宽 `containedAbsorbed`：允许"文档类文件不参与" | ★ 会给一个**真实的**未吸收情形开后门 | ❌ |
| **(丙)** | 把 `084604c` **真合进**主干（`git merge` / `cherry-pick`），判据就能认出来 | 中（一次合并）| ⚠️ 可选 |

**我建议 (甲)。** 理由：
- 那 4 棵的内容**已在主树**（逐条验过），删掉不丢东西
- 而 (乙) 会把"文档演化了"与"内容没吸收"**合流** —— 那正是本仓最贵的那条

★ **(丙) 也成立**，而且更"干净"：让判据自己认出来。但它要一次真合并，
  而 `084604c` 的文档版本**已经被我改过**（§19-21）⇒ 合并必然冲突。

---

## 5. 如果选 (甲)：一条可复跑的删除前核对

```bash
# 对每一棵要删的树，逐文件核它的 blob 是否在主树历史里
for f in $(git -C <tree> show --name-only --format="" HEAD); do
  blob=$(git -C <tree> rev-parse "HEAD:$f")
  printf "%-26s 在主干历史=%s\n" "$f" "$(git rev-list --objects HEAD -- "$f" | grep -c "^${blob:0:8}")"
done
```
★ 只要**源码文件**（`src/` / `scripts/`）全部命中，那棵树就可以删 ——
文档的 blob 不命中是**预期**（它被后续编辑推进过）。

---

## 6. 一条值得记的教训

我最初按建议去做"接进终态"，读代码时才发现**它已经在里面了**
（而且那段注释比我准备写的更细：它逐字说明"把回收挂在提交成功那一支上，
等于把入口设在判据必然说『不』的时刻"）。

⇒ ★★ **"这个机制没接线"这个判断，本身要先被核实。**
本轮之前我已经在 `admission` 那一格上栽过一次同形的事
（文档说"没有实例了"，而实际是"注册了、零求值点"）。

---

## 7. 实际清理（2026-10-21，用户批准后执行）

### 7.1 删之前逐个核对「有没有主树里不存在的内容」

★ 这一步**不能省** —— 删隔离树是不可逆的。

```bash
# 对每棵树的每个源码文件，查它的 blob 是否在主树历史里
for f in $(git -C <tree> ls-files 'src/*' 'scripts/*'); do
  b=$(git -C <tree> rev-parse "HEAD:$f")
  echo "$f $(git rev-list --objects HEAD -- "$f" | grep -c "^${b:0:8}")"
done
```

| 树 | 脏文件 | 源码 blob 在主树历史里缺失 | 独有内容 |
|---|---|---|---|
| `t1` | 0 | **0** | 无（`types.ts` 树内独有 0 行，主树独有 61 行 = 我后加的字段）|
| `t3` | 10（全 `lib/`）| **0** | 无（`create.ts` 与臂文件**逐字节相同**；`quality-gates.ts` 的差异全是**主树多出**的 t5/t6 改动）|
| `t4` | 0 | — | 无（从未产出）|
| `t5` | 0 | — | 无（契约不可满足时正确地停下）|
| `t108` | 0 | **0** | 无（只改过 `lib/client.js`）|
| `/private/tmp/t3-base-git` | 5（全 `lib/` + `node_modules`）| **0** | 无 |

★★ **一张表里"缺失 0"出现 6 次** —— 那是删它的唯一依据，而它**可复跑**。

### 7.2 删法

```bash
git worktree remove --force <path>     # 不是 rm -rf
```
★ `git worktree remove` 会把 `.git/worktrees/<name>` 的元数据一起清掉；
`rm -rf` 只删目录，留下一条**指向不存在的树的记录** —— 而 `git worktree list`
会继续把它列出来（"读数指向一个不存在的东西"）。

### 7.3 读数

```
删前：6 棵 · 5.0 GB（+ /private/tmp 下一棵 41 MB）
删后：0 棵 · 0 B
     git worktree list ⇒ 只剩主树一条

省下：≈ 5.0 GB
```

★ 而 `pnpm test:gates` 与 `lifecycle-verify` 在删后**逐条不变**
（1775 / 1709 / 27 · NOT in pin = 0；132 PASS / EXIT 0）
—— 那证明删掉的确实是**已经没用的东西**，而不是测试依赖的夹具。

### 7.4 一条值得记的判据

**"这棵树能不能删"不问"它有多旧"，问"它有没有主树里不存在的内容"。**
`t108` 是最旧的一棵（10-17），而它的源码 blob 缺失 **0** ⇒ 可删。
`t3` 是唯一有脏文件的一棵，而那 10 个全是 `lib/` ⇒ 也可删。

★ 反过来：如果某棵树的某个源码 blob 在主树历史里**找不到**，那就**不能删** ——
那正是 `unique-work` 那条判据在守的东西。
