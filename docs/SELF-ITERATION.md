# 自迭代：从「改代码要重装」到「改代码即生效」

> 建立：2026-10-05。**这份是可执行的操作步骤，不是设计文档。**
> 触发：判据层（6 条）已全部落地，但已装插件仍是上游原始版本 ——
> 所以那些判据在真实运行中**还没生效**。

---

## 0. 问题：现在为什么改代码不生效

```
~/.dsh/profiles/desktop/package.json
    "@nanmicoder/dsh-agent-teams": "file:/Users/abab/Desktop/agent-teams-dev"
                                   ↑ file: = pnpm 把它【拷贝】成真实目录
```

**实测证据**（2026-10-05）：

```
已装 lib/gates/          ⇒ 不存在（上游原始版本）
源码 lib/gates/          ⇒ completion/ dispatch/ index.js registry.js
两者 md5 不同，且已装版本连目录都没有
```

⇒ 所以「改代码」现在是三步：**改 src → pnpm build → 重新安装**。
第三步不是「重启」能替代的 —— 因为拷贝一直没更新。

### 对照实验（实测，link: 生效）

```
link: 安装 → 改源码 → require 立刻拿到新值      ✓ 免重装
file: 安装 → 改源码 → require 还是旧值（拷贝）   ✗ 必须重装
```

---

## 1. 目标形态

```
~/.dsh/profiles/desktop/package.json
    "@nanmicoder/dsh-agent-teams": "link:/Users/abab/Desktop/agent-teams-dev"
                                   ↑ link: = profile 指向源码目录
```

**效果**：

```
改 src → pnpm build → ★ 立即生效（新任务用新代码）
```

不需要重新安装，也不需要重启 host（只要 host 重新加载模块 ——
新会话或下一轮加载时自然拿到）。

---

## 2. 操作步骤（需要写工作区外，由人在终端执行）

### ★ 一键脚本（推荐）

```sh
cd ~/Desktop/agent-teams-dev
sh scripts/switch-to-link.sh          # 默认 desktop；也可传 profile 名
```

脚本做五件事，每步失败即停（`set -e`），不会留下半改状态：

```
① 备份 package.json（带时间戳）
② 改依赖指向（只改那一行，其余结构不动）
③ pnpm install
④ 验证 readlink 指向源码目录（不对就报错并给回退命令）
⑤ 验证 lib/gates/ 已可见（切换前这里是空的）
```

**已演练**：隔离目录里验证过改动逻辑（只改那一行）；不存在的 profile 会被拒绝；
在真实 profile 上因沙箱 EPERM 会在**备份那一步就停下**，不会留下半改状态。

### 手动步骤（与脚本等价）

### 前提确认

```sh
cd ~/Desktop/agent-teams-dev
pnpm verify          # 期望 exit=0（当前已满足）
```

### 步骤 1：备份

```sh
cp ~/.dsh/profiles/desktop/package.json ~/.dsh/profiles/desktop/package.json.bak
```

### 步骤 2：改依赖指向

把 `package.json` 里这一行：

```json
"@nanmicoder/dsh-agent-teams": "file:/Users/abab/Desktop/agent-teams-dev"
```

改成：

```json
"@nanmicoder/dsh-agent-teams": "link:/Users/abab/Desktop/agent-teams-dev"
```

### 步骤 3：重装依赖

```sh
cd ~/.dsh/profiles/desktop && pnpm install
```

### 步骤 4：验证切换成功

```sh
# 指向的应当是源码目录，不是拷贝
readlink ~/.dsh/profiles/desktop/node_modules/@nanmicoder/dsh-agent-teams
# 期望输出：/Users/abab/Desktop/agent-teams-dev

# 而且应当能看到新的 gates 目录
ls ~/.dsh/profiles/desktop/node_modules/@nanmicoder/dsh-agent-teams/lib/gates/
# 期望：completion  dispatch  index.js  registry.js
```

### 步骤 5：验证自迭代真的成立

```sh
cd ~/Desktop/agent-teams-dev
echo "// probe" >> src/gates/index.ts
pnpm build
# 立即检查已装位置是否变了（link 之下应当同时变）
grep -c "probe" ~/.dsh/profiles/desktop/node_modules/@nanmicoder/dsh-agent-teams/lib/gates/index.js
# 期望：1（如果是 0，说明还是拷贝）
git checkout src/gates/index.ts && pnpm build   # 还原
```

---

## 3. 回退

```sh
cp ~/.dsh/profiles/desktop/package.json.bak ~/.dsh/profiles/desktop/package.json
cd ~/.dsh/profiles/desktop && pnpm install
```

---

## 4. ★ 一个已知风险（必须先说清）

`link:` 让**源码即生产**。这意味着：

```
改 src 到一半（编译不过 / 逻辑没写完） ⇒ 下一轮加载就拿到那份半成品
```

**而 `pnpm build` 的第一步是 `rm -rf lib/`**（`scripts/clean-build.mjs`）。
多成员并行或人在编辑时，会存在「lib/ 已删未重建」的窗口 ——
此时插件加载会失败。

⇒ **配套纪律（本仓库已经建立）**：

```
① 只在确认无人改动时 build
② build 完立刻跑 pnpm verify 确认 lib 与 src 同步
③ 不在 build 中途让 host 加载新模块
```

**这也是为什么 `link:` 之后「自动 build」要谨慎做**：
一个「保存即 build」的 watcher 会把上面那个窗口**常态化**。

### 与 HMR 的关系

`dsh-hmr` 也能做到热重载，但它有**已取证的风险**（源项目 §39.4）：
文件变化时**立即** dispose + reload，**没有任何「等这一轮跑完」的闸门**
⇒ 把「看不到新代码」换成「看到两版代码」，而后者更难发现。

**⇒ 本方案不启用 HMR。** 用 `link:` + 手动 build：
改动在**下一个新任务**用新代码，正在跑的不受影响 —— 这正是想要的语义，
且避开了「两版代码」。

---

## 5. 完成后能做什么（这才是自迭代的意义）

切换成功后，本仓库的 6 条判据才真正开始工作：

```
dispatch:   changed-paths | worktree
completion: verify-rerun | r5 | mutation | backtest
（mutation-guard 是 guard，不进注册表）
```

⇒ 此后 AgentTeams 派活时：
· 成员写错地方 ⇒ `dispatch.worktree` 拒绝
· 命令伪造 passed ⇒ `completion.verify-rerun` 当场驳回（已实测抓过一次）
· 测试是装饰品 ⇒ `completion.r5` / `mutation` 拒绝
· 基准不绿 ⇒ `completion.backtest` 报告无法归因

**即：插件开始用自己刚长出来的判据约束自己的开发。**

---

## 6. 仍未做的（下一步候选）

```
① 自动 build 的「安全窗口」机制 —— 若要自动化，必须先解决 §4 的窗口问题
② link: 之下的多 worktree 切换（改 link 指向到某条集成好的 worktree）
③ 判据接进 delivery / contract / runtime 三个仍为空的位置
```
