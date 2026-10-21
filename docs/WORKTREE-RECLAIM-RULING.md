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
