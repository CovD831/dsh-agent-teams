# HMR 实测报告：它能用于插件自迭代（2026-10-16）

> **用户的问题**：
> 「关于热重载的 HMR，我们以前做这个插件迭代的时候就尝试过，
>  但是好像**没有办法用于我们插件的自迭代**，插件有的部分改了之后还是需要重启。
>  之前就是尝试过 HMR，**后来为什么不行我也忘记了**。」

★ **本报告的全部结论都有实测或源码证据。** 而我**在过程中推翻了自己两次**（见 §4）。

---

## 0. ★★★ 结论：**HMR 是通的 —— 实测确认**

**实验设计（可证伪）**：
```
① 给 src/client/locales.ts 的一条可见文案加前缀 HMRTEST
② pnpm build
③ ★ 不重启 DSH，只刷新页面
```

**结果（用户截图确认）**：
```
  HMRTEST·已完成 t74 · 待派工
  HMRTEST·已完成 t76 · 待派工
  HMRTEST·已完成 t72 · 待派工
  HMRTEST·已完成 t71 · 待派工
  t69 失败 · 待重派              ← ★ 见 §2，这一行是天然对照组
```

⇒ ★★ **改动直接到达了浏览器，没有重启。**
⇒ **HMR 设计上支持"改 src → build → 生效"。**

---

## 1. 机制（全部从 `app.asar` 取回,不是推测）

### ① `rev` = 文件【元数据】的哈希

```js
function artifactRevision(baseline) {
  return framedHash("plugin-artifact", [
    String(baseline.mtimeMs),   // 修改时间
    String(baseline.ctimeMs),   // 变更时间
    String(baseline.size)       // 大小
  ])
}
```

**官方注释逐字**：
> 「**Unchanged mtime, ctime and size preserve the graph without reading the bundle.**」

★ 即：**只要 mtime/ctime/size 有一个变了,就认为"产物变了"。**

### ② `rebuilt()` 是变更进入图的唯一入口

```js
rebuilt(id) {
  const baseline = this.captureArtifactBaseline(record.meta.clientPath)
  const rev = artifactRevision(baseline)
  if (rev === record.entry.rev) return rev      // 没变 ⇒ 不做事
  const bundle = readFileSync(record.meta.clientPath)   // ★ 变了 ⇒ 重读盘
  record.entry = graphRow(id, rev, record.meta)
  this.composed = this.compose()                // ★ 重组合
  for (const notify of this.rebuildListeners) notify(id, rev)   // ★ 通知浏览器
}
```

**官方注释逐字**：
> 「`rebuilt(id)` — Publish one completed bundle generation
> （**the HMR watch's registration hook — the only entry point through which build changes reach the graph**）」

### ③ 它是【stat 轮询】,不是 inotify

**官方注释逐字**：
> 「Host transport … **One interval stat-polls every graph row's client bundle**
>  （**polling by design: network mounts deliver no inotify events**）,
>  reports changes through `clientModules.rebuilt(id)`, and serves the
>  `/plugins/events` SSE channel broadcasting graph/rebuilt frames to the browser half.」

**而轮询间隔的官方文档**：
> `pollIntervalMs` | **`500`** | Bundle stat-poll interval in milliseconds

★ 即：**每 500ms 检查一次 mtime/ctime/size。** 无需重启、无需 inotify。

---

## 2. ★★★ 天然对照组：D12 的修复在真实 UI 里生效了

实验**只改了 `awaitingAssignment`**（"已完成·待派工"）这条文案，
**没改** `awaitingRedispatch`（"失败·待重派"）。

**结果**：
```
走 finished 分支的成员（t71/t72/t74/t76）  ⇒ 「HMRTEST·已完成 tN · 待派工」
走 failed   分支的成员（t69）              ⇒ 「t69 失败 · 待重派」（★ 无 HMRTEST）
```

⇒ ★★ **这同时证明了两件事**：
1. **只改一条文案,另一条不受影响** ⇒ 两条真的走**不同代码路径**（D12 的核心）
2. ★ **D12 的修复在真实 UI 里确实生效** —— 若没修,这几行**全都**会是「等待队长派工」

★ 即：**这次 HMR 实验顺带在生产界面上验证了 D12。**

---

## 3. 用户的环境本来就是对的（★ 注释是用户自己写的）

`~/.dsh/profiles/desktop/cordis.patch.yml:527-545`：
```yaml
# ── 模块热重载（由 scripts/enable-hmr.mjs 写入）────────────────────
#   打开 root 之后，改 src/** → pnpm build 即生效，不必重启宿主。
#   ★ base 必须显式写：缺省是 profile 目录，而源码不在那里。
- id: hmr
  name: '@deepseek-ai/dsh-hmr'
  disabled: false
  config:
    base: file:///Users/abab/Desktop/agent-teams-dev
    root: [ "." ]
    ignored: ['**/node_modules', '**/.*', 'cache', 'data']
    debounce: 100
```

★ 配置**完全正确**：
- `base` **显式**指向源码树（用户注释已写明为什么必须显式写）
- `~/.dsh/profiles/desktop/node_modules/@nanmicoder/dsh-agent-teams` 是 **symlink** ⇒ 通路完整

⇒ ★★ **所以 HMR 当年是通的**，"后来不行"必有具体原因（见 §5）。

---

## 4. ★★ 我在过程中推翻了自己两次（如实记账）

| 我说的 | 真相 | 怎么发现的 |
|---|---|---|
| 「`immediately` 可能就是那条线索」 | ❌ **错**。它管**初载顺序** | 查到 `graphRow` 注释：「Order composed **rows** so every requested dynamic package **precedes its consumers**」 |
| 「`rev` 不含插件内容 ⇒ 改代码不生效」 | ❌ **错**。`rev = f(mtime, ctime, size)` | 查到 `artifactRevision` 的实现 |

⇒ ★ **两次都是"先给了一个像样的解释,查到底后发现不成立"。**
★ 而这**正是本队反复坚持的纪律**：不停在第一个像样的解释上。

---

## 5. ★ 那么"后来不行"的可能原因（待查,不猜）

★ **我只列出【可从证据区分】的候选,不排序、不下结论**：

| # | 候选 | 如何区分 |
|---|---|---|
| **1** | **改的是【宿主侧】代码**（`src/*.ts`，非 `client/`）| HMR 的图只含 **client bundle** ⇒ 宿主侧改动**确实需要重启** |
| **2** | **改了但没 `pnpm build`** | mtime 不变 ⇒ rev 不变 ⇒ **静默无变化** |
| **3** | **`base` 曾经没写**（注释说"缺省是 profile 目录 ⇒ 静默无效"）| ★ 用户注释已指出这个坑 ⇒ **很可能就是它** |
| **4** | **改了 `package.json` 的 `dsh.client` 声明**（inject 列表等）| 那属于**组装**，不是 bundle ⇒ 可能不在 HMR 范围 |
| **5** | **改了 `cordis.patch.yml`**（plugin 组装）| 走另一条路（`refresh`/`readProfileManifest`），不是 `rebuilt()` |

★ **第 1 与第 3 是我认为最值得先查的** ——
而**第 3 条的坑,用户自己的注释已经记下了**（"静默无效"）。

---

## 6. 实用的三条

1. ★ **改 `src/client/**` → `pnpm build` → 刷新页面** ⇒ 生效，**不用重启**
2. ★ **改 `src/*.ts`（宿主侧）** ⇒ **必须重启**（HMR 的图只含 client bundle）
3. ★ **`pnpm build` 是必需的** —— 没有它 mtime 不变，HMR **静默不动作**
   （而"没动作"与"改了但没效果"**在界面上同形**）

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`（测试用的 HMRTEST 已还原并重建）。*

---

## 7. ★★★ 准确的边界（补，2026-10-16）：**两条 HMR 通路,各管一半**

★ 从 asar 取回的**官方说明**区分了两条**互不相同**的通路：

### 通路 A：`dsh-hmr` —— 管【插件组装】

> 「The enabled `dsh-hmr` plugin **watches the profile manifest and both user patch files**,
>  re-reads the ordered bundle layers, and applies the reload failure policy.
>  ★ **The launcher does not install HMR or watchers; disabled or absent HMR means
>  changes require restart.**」
> 「★ **package operations run outside its queue**」

**它热的是**：`package.json`（manifest）· `cordis.patch.yml`（两个用户 patch 文件）
⇒ ★ **即"用了哪些插件、怎么接线"。**

### 通路 B：`dsh-client-modules` 的 stat 轮询 —— 管【client bundle】

> 「每个 combo 或 chunk map …… **首次发布与 HMR 都从入口的 `mtimeMs`、`ctimeMs`
>  和大小派生逐插件 revision,不对产物内容求哈希。**」

**它热的是**：`lib/client.js`（**每 500ms 轮询 mtime/ctime/size**）

### ★★★ 于是得到一张准确的表

| 改什么 | 通路 | 生效方式 |
|---|---|---|
| `src/client/**` → `lib/client.js` | ★ **B** | ✅ **`pnpm build` + 刷新,不用重启**（**已实测**）|
| `package.json` / `cordis.patch.yml` | ★ **A** | ✅ **保存即生效,不用重启** |
| ★ **宿主侧 `src/*.ts` / `src/tools/**` → `lib/*.js`** | ❌ **两条都不覆盖** | ❌ **必须重启** |

### ★★ 所以对"插件自迭代"的准确回答

> **前端（UI）可以免重启迭代;宿主侧（工具/状态/判据逻辑）不能。**

★ 而**这个划分对本插件特别要紧**:我们的大量逻辑在**宿主侧**
（`src/tools/**`、`src/gates/**`、`src/state.ts`、`confidence.ts`…）
⇒ ★ **改那些仍然要重启。**

★ 而**"`pnpm build` 是必需的"** 那句话现在有了机制依据:
**没有 build ⇒ mtime 不变 ⇒ 通路 B 静默不动作。**

---

## 8. 一句话总结

```
① src/client/**       → pnpm build → 刷新  ⇒ ✅ 免重启（已实测）
② package.json / patch → 保存              ⇒ ✅ 免重启（通路 A）
③ 宿主侧 src/*.ts      → 必须重启           ⇒ ❌ 两条通路都不覆盖
④ ★ 任何情况都要 pnpm build 或主动保存 —— 否则 HMR 静默不动作
```
