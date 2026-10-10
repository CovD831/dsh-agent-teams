/**
 * ── 嵌套测试环境的【唯一】出处：剥离递归标记，且必须配一对"还原" ─────────────────
 *
 * ── 它防的是什么失效（MEASURED，本仓库多个夹具各撞过一次）──────────────────────
 *
 * `node --test` 会给它起的**测试文件子进程**种下 `NODE_TEST_CONTEXT`。任何继承
 * `process.env` 的后代（`runVerifyCommand` 用的就是 `env: process.env`）都会把它
 * 带下去，而**看见它的那次 `node --test` 会被静默跳过**：
 *
 *     exitCode = 0 · 测试 stdout 为空 · stderr 只有一句
 *     "node:test run() is being called recursively within a test file. skipping running files."
 *
 * ★ 要害在于**形态**：那条被跳过的运行与"真的跑过且全绿"在**退出码上完全同形**，
 *   于是 `completion.mutation` / `completion.r5` 这类靠 exitCode 判绿的判据会把
 *   "没测到"并进"通过"。这就是 f-0028：**判据拿到了一个它读不出区别的读数**。
 *
 * ── 为什么是一个共享模块，而不是每个夹具各写一遍 ────────────────────────────────
 *
 * 迁移前有 **7 个**夹具各自处理这一格，手法互不相同（有的只删 `NODE_TEST_CONTEXT`，
 * 有的删 `NODE_TEST*` + `NODE_OPTIONS`，`review-unified-pipeline.test.mjs` 干脆
 * 一个都不删、只读退出码）。同一件事有 7 份实现 ⇒ 没有单一出处可核对，
 * 而它恰恰是"判据能不能真的测到东西"的前置条件 —— 前置条件本身没有读数。
 * ⇒ 收敛到这里：**哪些键算递归标记**、**怎么剥**、**怎么还原**，三件事只有一处。
 *
 * ── ★ 为什么导出的是一对"捕获/还原"，而不是一个函数直接改 `process.env` ──────────
 *
 * MEASURED（本仓库实测的失败形态）：夹具在 `node --test` 里改 `process.env` 之后
 * **忘了还原**，那个副作用会**泄漏给同一进程里后面跑的夹具** —— 后面的夹具于是
 * 在一个"看起来干净"的环境里跑，而它干净的原因是**别人擦过地**。
 * 那种污染不可重算：读数已经生了，谁都说不清它属于哪个环境。
 *
 * ⇒ 所以本模块的接口全部成对，且还原的那一半**包住**使用的那一半：
 *   · `nestedTestEnv()` / `captureNestedTestEnv()` —— 显式拿到 `restore()`
 *   · `withNestedTestEnv()` —— 还原写在 `finally` 里，**调用方想忘也忘不掉**
 *   · `recursionFreeEnv()` —— 纯函数，不碰 `process.env`，给"只想要一份干净 env"的
 *     调用方（`execFileSync(..., { env })`）用
 *
 * ★ 射程（本模块**不**做的事，写出来免得被读成"它保证了干净"）：
 *   · 它只剥【递归标记】那几个键（见 `NESTED_TEST_RECURSION_KEYS`），
 *     **不**动别的环境变量。别的键是别的机制的事，混在一起会让人以为是同一个原因。
 *   · 它**不**保证子进程里 `node --test` 一定会跑 —— 只保证"不会因为继承递归标记
 *     这一条原因被跳过"。剩下的原因（路径写错、套件本身坏了）仍然要夹具自己看输出。
 *   · 它**不**触碰 `execArgv`：那是每个进程自己的，本来就不继承（`gate-nested-test-probe`
 *     臂 4 钉过这条不对称），把两者混为一谈是本队记过的"读错位置的出口"。
 *
 * ★ 本文件没有 shebang、没有顶层副作用，本来就是给 `node --test` 夹具 import 的。
 */

/**
 * ★ 被当作【递归标记】的键 —— 机器可读，供读取方（和夹具）当场核对。
 *
 * 逐条都有出处，不是拍脑袋列的：
 *   · `NODE_TEST_CONTEXT` —— Node 在 `--test` 子进程里设它，实测值 `child-v8`。
 *     ★ **这一条是机制本体**：看见它的 `node --test` 会跳过整份文件。
 *   · `NODE_OPTIONS` —— 它可能夹带 `--test` / `--experimental-test-*`，
 *     把子进程拽进同一个测试运行器里。本仓多个夹具早就在删它（见迁移前的
 *     `gate-mutation` / `gate-t1-completion-probe` / `worktree-reclaim`），
 *     这里只是把那件既成事实**收进唯一一处**，不是新加的清洗。
 *   · 其余 `NODE_TEST*` —— 同一族的运行器开关（如 `NODE_TEST_*` 下的报告器配置）。
 *     按**前缀**处理而不是逐个列举：这一族的键由 Node 自己增删，硬编码一份名单
 *     会在 Node 升级后静默漏掉新键，而漏掉的后果正是"子进程又被跳过"。
 */
export const NESTED_TEST_RECURSION_KEYS = Object.freeze([
  'NODE_TEST_CONTEXT',
  'NODE_OPTIONS',
  'NODE_TEST*',
])

/** 前缀匹配的键族（`NODE_TEST*` 那一项的展开）。 */
const RECURSION_PREFIXES = Object.freeze(['NODE_TEST'])

/** 精确匹配的键。 */
const RECURSION_EXACT = Object.freeze(['NODE_TEST_CONTEXT', 'NODE_OPTIONS'])

/** 一个键是不是递归标记 —— 夹具想自己判时用同一份判据，别再抄一遍。 */
export function isRecursionMarkerKey(key) {
  return RECURSION_EXACT.includes(key) || RECURSION_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/**
 * 剥掉递归标记的**副本** —— 纯函数，**不动** `process.env`。
 *
 * ★ 给"只想要一份干净 env 交给 `execFileSync`"的调用方。它之所以必须是纯的：
 *   一旦它有副作用，调用方就欠一次还原 —— 而"欠一次还原"正是本模块要消灭的形态。
 *
 * @param {Record<string, string|undefined>} [source] 默认 `process.env`
 * @returns {Record<string, string|undefined>} 浅拷贝，递归标记已删除
 */
export function recursionFreeEnv(source = process.env) {
  const env = { ...source }
  for (const key of Object.keys(env)) {
    if (isRecursionMarkerKey(key)) delete env[key]
  }
  return env
}

/**
 * 捕获当前进程环境里递归标记的**原值**，返回一个可还原的句柄。
 *
 * ★ 为什么要记"原值"而不是记"删过"：`process.env.NODE_TEST_CONTEXT` 在本仓夹具里
 *   **本来就在场**（夹具自己跑在 `node --test` 下）。还原时若一律 `delete`，
 *   本进程就从此丢掉那一格 —— 后面读它的臂（`gate-member-process-probe` 的采样臂、
 *   `gate-nested-test-probe` 的观测臂）会读到一个**被自己人擦掉**的环境，
 *   而那与"这台机器上没有它"同形。
 *
 * @param {Record<string, string|undefined>} [source] 默认 `process.env`
 * @returns {{ keys: string[], saved: Map<string, string>, restore: () => void }}
 */
export function captureNestedTestEnv(source = process.env) {
  const keys = Object.keys(source).filter(isRecursionMarkerKey)
  const saved = new Map(keys.map((key) => [key, source[key]]))
  let restored = false
  return {
    keys,
    saved,
    /** 还原到捕获那一刻：原本在场的写回原值，原本缺席的**再次删除**。 */
    restore() {
      /**
       * ★ 幂等：`finally` 与调用方显式调用可能都会走到这里，第二次必须是空操作
       *   （而不是把"已还原"的状态再改一次）。
       */
      if (restored) return
      restored = true
      for (const key of keys) {
        const value = saved.get(key)
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    },
  }
}

/**
 * 剥掉递归标记并给出**配对**的还原句柄 —— 模块的主入口。
 *
 * ★ 返回 `{ env, restore }` 而不是直接改 `process.env` 再返回一个函数：名字里带着
 *   被剥掉的那份 env，读代码的人一眼能看到"这份 env 是要交给谁的"，
 *   而 `restore` 就摆在它旁边，忘记的概率比"改完再去别处找还原函数"低。
 *
 * ★ 它**同时**改了 `process.env` 吗？**改了**，而且这是刻意的：本仓的触发路径
 *   （`agent_teams_update_task` / `agent_teams_create_task`）内部由 `runVerifyCommand`
 *   读**全局** `process.env`，调用方拿不到注入点 ⇒ 只给一份 `env` 副本是没用的。
 *   于是"改了全局"这件事必须配一次还原，而还原就在返回值的 `restore()` 里。
 *   ★ 想连"忘掉还原"都不可能时，用 `withNestedTestEnv()`。
 *
 * @param {Record<string, string|undefined>} [source] 默认 `process.env`
 * @returns {{ env: Record<string, string|undefined>, restore: () => void, keys: string[] }}
 */
export function nestedTestEnv(source = process.env) {
  const handle = captureNestedTestEnv(source)
  for (const key of handle.keys) delete process.env[key]
  const env = recursionFreeEnv(source)
  return {
    env,
    keys: handle.keys,
    restore: handle.restore,
  }
}

/**
 * 在剥离递归标记的环境里跑 `fn`，**无论它抛不抛都在 `finally` 里还原**。
 *
 * ★ 这是"想忘也忘不掉"的那一形：还原由本函数拥有，调用方没有机会漏掉。
 *   MEASURED 的教训是"漏还原"比"忘剥离"更常见，也更难查（它污染的是**后面的**夹具）。
 *
 * ★ `fn` 收到被剥干净的那份 `env`（可直接交给 `execFileSync`），
 *   而 `process.env` 在整个 `fn` 执行期间也被剥着 —— 两条路都覆盖到。
 *
 * @template T
 * @param {Record<string, string|undefined>} source
 * @param {(env: Record<string, string|undefined>) => T|Promise<T>} fn
 * @returns {Promise<T>} `fn` 的返回值
 */
export async function withNestedTestEnv(source, fn) {
  const { env, restore } = nestedTestEnv(source)
  try {
    return await fn(env)
  } finally {
    restore()
  }
}
