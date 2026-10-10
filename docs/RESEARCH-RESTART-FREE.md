# 免重启改代码：研究结论（2026-10-09）

> 用户问题：「有没有办法不用重启就让我改的插件代码生效？」
> 本文是**实测结论**，不是推测。每条都指名读数与出处。

---

## 0. 一句话结论

```
★ 有办法 —— 而且宿主已经把机制装好了，只是【默认关着】。

   dsh-base 的 cordis.patch.yml（逐字）:
       # Module reload is opt-in per profile. `patchReload: live` config watching
       # uses the launcher's watch-only fallback and does not require this row.
       - id: hmr
         name: '@deepseek-ai/cordis-plugin-hmr'
         disabled: true          ← ★ 就是这一行
         config:
           root: ['.']

   ⇒ 把 disabled 改成 false，代码改动就【热重载】。
```

**★ 而且它在这台机器上曾经真的跑起来过** —— 见 §3 的 `EMFILE` 证据。

---

## 1. 先纠正一条本项目已记的结论（错了一半）

`docs/PENDING-RESTARTS.md` §0 与 `docs/MODULE-RELOAD.md` 说：

> 「`cordis.patch.yml:32` 的 `root: []` 表示不监听任何源码目录 ⇒ 模块只在进程启动时加载一次。」

**实测：`root: []` 这件事本身没错，但它的含义被读反了一半。**

| | 实际含义 |
|---|---|
| `root: []` | **是的**，不监听任何**模块**目录 |
| 但它**不等于**「模块只加载一次」 | HMR 服务仍然**挂着**、仍然监听配置层；`root` 只是**模块**监听根 |

**★ 而真正的开关不是 `root`，是 `disabled`。** 在本机的 Tauri 运行时里它是
`disabled: true`；在 `.app` 的 dsh-base 里它是 `root: []`（服务开着，只监听配置）。
**两种写法都指向同一件事：模块热重载默认不开。**

⇒ 所以「找不到免重启的办法」的原因**不是机制不存在**，是**它的开关没被打开**。

---

## 2. 为什么 `agent_teams_restart` 那个工具救不了这件事

它调的是 cordis 的 `fiber.restart()`。实测（逐字读 `cordis/lib/index.js`）：

```js
async restart() { this.assertActive(); this._setEpoch(INACTIVE); this._refresh(); await this.await() }
// → _unload() 跑 disposer，→ _reload() → _execute(this._runner)
// _runner.execute 里是【构造时捕获的】runtime.callback —— 直接调用它
```

```
★ 整条链里没有一次 import()、没有一次 loadCache/require.cache 的删除。

⇒ fiber.restart() 重跑的是【同一个已缓存的模块对象】的 apply()。
   它能拿到【新配置】，永远拿不到【新代码】。
```

**★ 所以那个工具的名字（"reload the plugin"）比它实际做的事更大。**
它是**重新 apply**，不是**重新加载**。这一条值得改掉措辞，否则下一个会话还会以为它够用。

---

## 3. ★ 决定性证据：HMR 在本机真的起来过

`~/Library/Application Support/dsh-tauri/logs/desktop.log` 逐字：

```
WARN dsh: dsh: warning: 1 entry did not activate
WARN dsh: hmr (@deepseek-ai/cordis-plugin-hmr): Error: EMFILE: too many open files, watch
    at FSWatcher._handle.onchange (node:internal/fs/watchers:269:21)
```

**★ 这三行的信息量很大**：

```
① 它叫 @deepseek-ai/cordis-plugin-hmr ⇒ 说明那一行【被启用过】（disabled: false）
② 它抛的是 EMFILE（文件描述符耗尽）⇒ 说明它【进到了 chokidar 建监听】那一步
③ 而它不是 "--expose-internals is required" 那个错
   ⇒ ★ 证明进程【确实带着 --expose-internals】跑
     （否则构造函数第一行就抛，根本走不到建 watcher）
```

**⇒ HMR 的机制在本机是**通的**，只差两件事：把 `disabled` 打开，以及别让 fd 耗尽。**

`~/Library/Application Support/dsh-tauri/cordis.hmr.patch.yml`（本机已存在，非本次创建）：

```yaml
- id: hmr
  name: '@deepseek-ai/dsh-hmr'
  config:
    base: file:///Users/abab/Desktop/自动化开发插件
    root: ['.']
    ignored: ['**[/\\]node_modules', ...]
    debounce: 100
```

⇒ **这是一个「按项目开 HMR」的手工补丁**。它是可行性的活证据：
有人（过去的会话）已经这么干过，并把它指向了另一个项目。

---

## 4. HMR 到底怎么换掉代码（这是它比 `?query` 强的地方）

本项目 `docs/MODULE-RELOAD.md` 的负结论里有一条关键机制：

> 「指纹只作用在它被应用的那一个模块上。换掉的是「模块」，不是「模块图」。」

**★ 这一条是对的，而 HMR 正是绕过它的实现。** 逐字读 `cordis-plugin-hmr/lib/index.js`：

```js
// ① 用 Node 内部 loadCache 拿到【活的依赖图】并递归遍历
async function loadDependencies(job, ignored) { ... await job.linked ... }

// ② 清缓存：ESM loadCache + CJS require.cache 【两个都清】
Map.prototype.delete.call(this.internal.loadCache, filename)
Reflect.deleteProperty(require.cache, filepath)

// ③ 用清理后的缓存重新 import，然后替换注册表里的插件
const replacement = this.ctx.loader.unwrapExports(await this.ctx.loader.import(...))
this.ctx.registry.delete(plugin); await reload(replacement, fibers)
```

**★ 三个细节值得记住（都是它自己代码注释里的实测）**：

```
① Node 22/23 的 loadCache 是普通 Map；Node 24 是 LoadCache extends Map，
   它自己的 .delete() 只把槽位置 undefined、【不删条目】
   ⇒ 所以必须用 Map.prototype.delete.call(...) 绕过去
② Node 24 里「通过 import() 加载的 CJS」会同时出现在两个缓存里
   ⇒ 只清 loadCache 会被 CJS 缓存喂旧模块
③ 路径要用 realpathSync() 的写法，否则文件事件与缓存键对不上
```

### 我复现了 ①②③ 的因果（本次实测）

```
不带 realpath（/tmp/... 而非 /private/tmp/...）:
    gen1 = 1 · 清缓存后 gen2 = 1   ← ★ 静默地仍是旧代码
带 realpathSync（与 HMR 同口径）:
    gen1 = 1 · 清缓存后 gen2 = 2   ← ★ 新代码，且是【传递依赖】被换掉
```

**⇒ 这一对读数是本条最值钱的证据**：
**「清了缓存却仍是旧代码」是可能的，而它与「清成功」在返回值上同形** ——
差的就是路径形态。这正是 HMR 注释里那条 `realpathSync` 在防的事。

---

## 5. ★ 诚实的边界（HMR 不是万能）

官方 README 逐字给的已知限制：

```
① 模块替换需要 Node loader 内部接口
   依赖框架本身的改动 ⇒ 回落到 loader.exit() ⇒ 【宿主重启】
   （即：改「插件自己的代码」能热重载；改「宿主/依赖树」不能）

② ★ 通过 Plugin Manager 替换【已安装包的版本】仍然需要重启
   浏览器 Client 模块图另有一套浏览器侧加载机制

③ darwin 上 watchConfig() 在 chokidar 报告 ready 时 resolve，
   而 libuv 之后才在自己的线程上启动 FSEvents 流
   ⇒ 注册后数毫秒内落地的写入要等该目录的下一个事件才会被报告
```

**⇒ 对本插件的具体含义**：

```
✓ 改 src/** → build → 【热重载】           （这是我们要的那一格）
✗ 改 package.json 的 exports / 依赖图     ⇒ 仍需重启
✗ 改 profile 的 bundles 列表              ⇒ 仍需重启（除非 patchReload: live）
✗ 浏览器侧 client.js 的 bundle 结构        ⇒ 另有 dsh-client-hmr 一套
```

**★ 而这一条把「需要重启」从一个笼统的感觉，变成了三种可分辨的情形** ——
这比「能不能免重启」这个问法更有用。

---

## 6. ★ 落到本项目：可直接执行的那一步

### 6.1 本机跑的是哪一个运行时（实测，决定了补丁写什么名字）

```
★ 本会话的 GUI = Tauri 桌面壳（不是 .app 那个 Electron 壳）
   证据: ~/Library/Application Support/dsh-tauri/.store.dat → "active_profile": "tauri"
        ~/Library/Application Support/dsh-tauri/logs/dsh-web.log → "dsh web: http://127.0.0.1:3080/..."

★ 而两者的 HMR 包【不是同一个】：
   dsh-tauri 运行时  ⇒  @deepseek-ai/cordis-plugin-hmr   （本机实测已安装）
   .app  运行时      ⇒  @deepseek-ai/dsh-hmr
   ⇒ ★ 写补丁时必须用【本运行时的那一个名字】，写错了它解析不到。
```

实测（本次）：

```
$ ls ~/Library/Application Support/dsh-tauri/dependencies/dsh/node_modules/@deepseek-ai/ | grep cordis-plugin
cordis-plugin-group
cordis-plugin-hmr        ← ★ 它在这里
cordis-plugin-include
cordis-plugin-loader
cordis-plugin-timer

$ node -e "…createRequire(runtime dsh)/resolve('@deepseek-ai/cordis-plugin-hmr')"
/Users/abab/Library/Application Support/dsh-tauri/dependencies/dsh/node_modules/@deepseek-ai/cordis-plugin-hmr/lib/index.js
⇒ ★ 解析得到（这是"补丁能不能生效"的前置）

★ 而它的 Config schema 也在本运行时当场读出来了：
   base(无默认) · root: ["."] · ignored: ["**/node_modules","**/.*","cache","data"] · debounce: 100
```

### 6.2 要写的那一段（加进 `~/.dsh/profiles/tauri/cordis.patch.yml`）

```yaml
# ★ 模块热重载：本项目自己的代码改动，build 后即生效，不必重启宿主。
#   dsh-base 的那一行默认 disabled: true（原文："Module reload is opt-in per profile."）
#   ⇒ 这里按 id 覆盖它。★ 注意包名是【本运行时的】cordis-plugin-hmr，不是 dsh-hmr。
- id: hmr
  name: '@deepseek-ai/cordis-plugin-hmr'
  disabled: false
  config:
    base: file:///Users/abab/Desktop/agent-teams-dev
    root: ['.']
    ignored:
      - '**/node_modules'
      - '**/.*'
      - 'cache'
      - 'data'
    debounce: 100
```

**★ 而 `base` + `root` 这一对是关键**：`root: ['.']` 是相对 `base` 的，
而 `base` 缺省是 context 的 baseUrl（= profile 目录）。
**⇒ 不写 `base`，它就去盯 profile 目录 —— 而我们的源码不在那里。**

### 6.3 生效步骤（顺序不能反）

```
① 先把这一段写进 profile 的 cordis.patch.yml
② ★ 重启一次 —— 这一行【本身】要在 apply 时读入，所以它自己免不了这一次
③ 此后: 改 src/ → pnpm build → 【改动静默生效】，不再需要重启
```

**★ 判据（重启后怎么确认真的生效）**：

```
✓ 启动日志里 [hmr] 报的是 watching ['.'] in /Users/abab/Desktop/agent-teams-dev
  （或至少【不再】报 EMFILE —— 见 §6.4）
✓ 之后改一个字符串 → pnpm build → 日志出现 "reload plugin at <相对路径>"
✗ 若报 "--expose-internals is required for HMR service" ⇒ 那不是补丁的问题，是启动器变了
```

### 6.4 ★ 必须同时处理的两件事，否则开了也会退化

```
① EMFILE（本机实测撞到过，见 §3）
   22 个 bundle、每层都开 watch，fd 被耗尽 ⇒ HMR 起不来而【其余一切照旧】
   ⇒ 处置: 缩小 root（只盯本项目，不要盯 home 或整个 Desktop），
           或提高该进程的 fd 上限。
   ★ 而不处理的后果是【静默的】—— 日志里一行 warn，功能没了，没人发现。

② ★ 热重载【不覆盖】宿主/依赖树的变化
   改了 package.json 的 exports、依赖、或 profile 的 bundles 列表
   ⇒ 仍然必须重启（官方 README 逐字写着这一条）。
```

---

## 7. 三条结论（给下一个会话）

```
① ★ 「免重启」是有办法的 —— 而且它不是我们没找到，是【默认关着】
    dsh-base: `disabled: true` + 注释 "Module reload is opt-in per profile."

② ★ `agent_teams_restart` 那个工具救不了它，而且它的名字比它做的事大
    它调 fiber.restart() ⇒ 重跑【同一份缓存模块】的 apply() ⇒ 只能拿新配置，拿不到新代码
    ⇒ 建议: 改它的措辞（"重新 apply"），否则下一个会话还会以为它够用。

③ ★ 「需要重启」应当被拆成三种可分辨的情形，而不是一个笼统的感觉
    A. 改插件自己的 src/**          ⇒ ✓ 热重载（本项目 95% 的改动属于这一类）
    B. 改 package.json / 依赖图     ⇒ ✗ 仍需重启
    C. 改 profile bundles / 宿主    ⇒ ✗ 仍需重启（除非 patchReload: live）
```

---

## 8. 一条方法论备注（为什么这篇值得留）

**本次研究推翻了本项目一条已记的结论（`root: []` 的含义），
而推翻它的不是推理，是三条读数**：

```
· 本机 log 里 HMR 抛的是 EMFILE 而不是 "requires --expose-internals"
  ⇒ 反推出 --expose-internals 在、且它走到过建 watcher
· 本机已存在一个 root: ['.'] 的 hmr 补丁（cordis.hmr.patch.yml）
  ⇒ 反推出「有人这么干过」
· 清缓存 + realpath 的对照读数
  ⇒ 反推出 HMR 那条 realpathSync 注释在防什么
```

**★ 而这三条都是【盘上已有的东西】，不需要网络、不需要新实验。**
⇒ 与 `docs/PENDING-RESTARTS.md` §24 那条同源：
**一个写在某个时刻的结论，在没有被复核的情况下继续被当成本刻的事实。**
