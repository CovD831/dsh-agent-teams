#!/usr/bin/env node
/**
 * ── test-tree：依赖只装一份，代码临时进去，跑完丢弃 ──────────────────────────────
 *
 * ╔════════════════════════════════════════════════════════════════════════════╗
 * ║ ★★★ 已知限制（2026-10-23，未修）：依赖是【软链】不是副本                    ║
 * ║                                                                            ║
 * ║   require.resolve(...) 会解析回源仓 ⇒ 走 .bin/ 或原生模块 rebuild 的命令    ║
 * ║   会把改动写回源仓。⇒ 本脚本当前只适合【只读测试】（node --test 一类），     ║
 * ║   不适合 pnpm install / rebuild / postinstall。                            ║
 * ║   生产应改为 pnpm --offline 或 cp -al。                                     ║
 * ║                                                                            ║
 * ║   MEASURED：树里跑 `require.resolve('typescript')` 返回的是                ║
 * ║     /Users/…/agent-teams-dev/node_modules/.pnpm/typescript@5.9.3/…          ║
 * ║   —— 即**源仓**的路径，不是树里的路径。                                     ║
 * ║   ★ 为什么这句话要顶到文件最上面：这会让"测试树"污染开发树，而"不污染"      ║
 * ║     正是它存在的全部理由。半年后有人拿它跑 `pnpm install`，只留一行注释      ║
 * ║     是拦不住的 ⇒ `run` 启动时会**打印**这条警告（见 warnIfSymlinkedDeps）。  ║
 * ╚════════════════════════════════════════════════════════════════════════════╝
 *
 * 要解决的问题（本机实测，2026-10-23）：
 *
 *   node_modules   2.4 GB
 *   .pnpm-store    1.7 GB
 *   tsc --noEmit   峰值 328 MB / 68.7 秒
 *   ⇒ 每个开发 worktree 都装一遍依赖 ⇒ 6 个任务 = 14.4 GB 磁盘
 *
 * 做法：
 *   init   ⇒ `git worktree add --detach` 建一棵独立树，然后把它缺的依赖「借」过来
 *   run    ⇒ 把源工作树的未提交改动搬进去 → 跑命令 → 无论成败都搬走
 *   status ⇒ 打印这棵树现在的状态（干净吗 / 依赖在吗 / 依赖是副本还是软链）
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ 为什么取 diff 用 `git diff HEAD`，而**不是**任务卡建议的 `git add -N .`
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   任务卡给的路子是：`git add -N .`（让未跟踪文件进 diff）→ `git diff --binary`。
 *   它能 work，但它**改了源工作树的 index**：`-N` 把每个未跟踪文件写成
 *   intent-to-add 条目。后果不是"看不见"，而是：
 *
 *     ① 成员/主理人随后敲 `git status`，那些文件从 `?? 新文件` 变成 ` A 新文件`
 *        —— **读数变了**。而本仓工作流里 `git status --porcelain` 本身就是被消费的
 *        证据（`scripts/worktree-reclaim.mjs` 就靠它判"有没有唯一产物"），
 *        改它的读数就是污染一份正在被用来做决定的证据。
 *     ② `git stash pop` / `git checkout -- .` 这类日常操作遇到 intent-to-add 会报错。
 *     ③ 要回退得再跑 `git rm --cached`，而那一串命令**跑错就是把文件删了**。
 *
 *   ⇒ 换成**纯读**的 `git diff HEAD --binary --full-index`：
 *
 *       · `git diff HEAD` = HEAD 与**工作树**的差异，**已包含** staged + unstaged 两边
 *         ⇒ 「有未提交改动」全覆盖，且**不碰 index**（实测前后 `git status --porcelain`
 *         逐字节相同）。
 *       · 「有被删除的文件」（工作树里没了）**天然在 diff 里**，表现为
 *         `deleted file mode` ⇒ 不用额外处理。
 *       · 唯一漏的是「未跟踪新文件」。而给未跟踪文件伪造补丁比直接复制更糟
 *         （要自己编 index 行、编 blob sha），所以直接
 *         `git ls-files --others --exclude-standard` 列出来、**按文件复制**进
 *         test-tree —— 复制更保真（权限位、软链都能带过去）。
 *       · `--binary` 把二进制转成 base64 文本块（所以补丁仍然是 ASCII），
 *         `--full-index` 给全 blob sha ⇒ `git apply --3way` 才有三方合并的锚点。
 *
 *   MEASURED（本仓 task-mutation-integrate 830a45e，20 个已跟踪改动 + 10+ 未跟踪）：
 *     取补丁全程 < 0.2 s；源树 `git status --porcelain` 前后完全一致。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ 软链 node_modules 的坑（实测出来的，不是猜的）
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   本仓 `.gitignore` 写的是 `node_modules/`（**带尾斜杠**）。git 的规矩：
 *   带尾斜杠的模式**只匹配真目录**，而软链在 git 眼里是**文件** ⇒ 匹配不上。
 *
 *   MEASURED（/tmp 探针，git 2.50.1）：
 *     .gitignore 只有 `node_modules/`，再 `ln -s real_nm node_modules`
 *       ⇒ `git status --porcelain` 报 `?? node_modules`
 *       ⇒ `git clean -fd` **把软链删掉了**（依赖当场"消失"）
 *
 *   两条修法，本脚本选后者：
 *     ① 往 git 的 exclude 里加一行 `node_modules`（不带尾斜杠）—— 干净，但
 *        MEASURED：linked worktree 里 `git rev-parse --git-path info/exclude` 返回的是
 *        **共享的** `<repo>/.git/info/exclude`，不是 per-worktree 的
 *        ⇒ 为了这棵树去改**主仓**的 git 管理文件，越界了。
 *     ② 什么都不写：`clean` 加 `-e node_modules` 把它摘出去；读「干净吗」时把
 *        这一行**扣除并单独报告**（打印"已扣除 node_modules 软链 N 行"）。
 *        ← 选这个：对源仓零副作用。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ 依赖：软链是本次的**验证手段**，不是生产形态（细节在这里，结论看文件顶部）
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   生产上应该二选一：
 *     · `pnpm install --offline`（共用 .pnpm-store ⇒ 每棵树只多出几百 MB 的
 *       hardlink，而不是 2.4 GB 的实体副本）；或
 *     · 对 node_modules 做 hardlink 克隆（`cp -al`）。
 *
 *   软链最快、最省盘，但它有两个**真实**缺陷，别当成免费的：
 *     (a) `node_modules/.bin/*` 里的相对路径（`../.pnpm/...`）解析出来指向**源仓**的
 *         位置 —— 大部分自举脚本仍能跑，但任何按 `__dirname` 往 package 目录里写的
 *         工具会把产物写进源仓；
 *     (b) 原生模块（.node）的 install 路径、以及 `npm rebuild` 会对源仓生效。
 *   ⇒ (a)(b) 合起来就是文件顶部那个「已知限制」：**只适合只读测试**。
 *   ⇒ 所以 `run` 启动时会打印警告、`init`/`status` 也会标明，不做静默降级。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 退出码约定
 * ══════════════════════════════════════════════════════════════════════════════
 *   run    ⇒ **被测命令的退出码**（原样透传，128+n 表示被信号杀）
 *   init   ⇒ 0 成功 / 1 失败
 *   status ⇒ 0 = 已初始化且干净；1 = 未初始化或不干净（可直接当门禁）
 *   任何内部错误（不是被测命令的错误）⇒ 2
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

// ── 常量 ──────────────────────────────────────────────────────────────────────

/** 默认位置：放在仓内的 `.workbuddy/` 下（该目录已在 .gitignore 里 ⇒ 不污染主树 status）。 */
const DEFAULT_TREE_REL = path.join('.workbuddy', 'test-tree');
/** 元数据写在 test-tree 自己的 gitdir 里 ⇒ 能扛住 `reset --hard` + `clean -fd`。 */
const META_NAME = 'test-tree-meta.json';
const TREE_NM = 'node_modules';
/** 单次 git 调用最多吃多少 stdout（补丁可能几 MB，二进制转 base64 会更大）。 */
const GIT_MAX_BUFFER = 512 * 1024 * 1024;

// ── 小工具 ────────────────────────────────────────────────────────────────────

const log = (msg = '') => process.stdout.write(`${msg}\n`);

/**
 * 按**显示宽度**补齐。`padEnd` 数的是 UTF-16 码元，一个汉字算 1 ⇒ 中文标签会错位。
 * （本仓有 `gate-cjk-width-parity` 门禁，说明这件事在本项目里是被当真的。）
 */
function displayWidth(s) {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    const wide =
      cp >= 0x1100 &&
      (cp <= 0x115f ||
        (cp >= 0x2e80 && cp <= 0xa4cf) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe30 && cp <= 0xfe6f) ||
        (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) ||
        (cp >= 0x20000 && cp <= 0x3fffd));
    w += wide ? 2 : 1;
  }
  return w;
}

const kv = (k, v) => process.stdout.write(`  ${k}${' '.repeat(Math.max(1, 18 - displayWidth(String(k))))} ${v}\n`);
const reading = (msg) => log(`  [读数] ${msg}`);

function die(msg, code = 2) {
  process.stderr.write(`\n✗ ${msg}\n`);
  process.exit(code);
}

function tailLines(text, n = 20) {
  const s = String(text ?? '').replace(/\s+$/, '');
  if (!s) return '(空)';
  return s.split('\n').slice(-n).join('\n');
}

function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function isSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * 把路径**彻底解析成物理路径**再比较。
 *
 * ★ 这个函数是被一个真 bug 逼出来的（MEASURED，macOS）：
 *   `git worktree list` 返回的是 `/private/tmp/x`，而用户 `--dir` 给的是 `/tmp/x`
 *   （macOS 上 `/tmp` 是 `/private/tmp` 的软链）⇒ 同一棵树被比成"不是本仓注册的
 *   worktree"，`run` 直接拒绝干活。**路径字符串相等 ≠ 同一个目录。**
 *
 * 目标路径还不存在时（init 首次），退到「最长的已存在祖先」做 realpath 再拼回去，
 * 这样创建**之前**的预期路径与创建**之后** git 报的路径也能对上。
 */
function normalizePath(p) {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch {
    /* 还不存在，往下走 */
  }
  const parts = [];
  let cur = abs;
  for (;;) {
    const parent = path.dirname(cur);
    if (parent === cur) return abs;
    parts.unshift(path.basename(cur));
    cur = parent;
    try {
      return path.join(fs.realpathSync(cur), ...parts);
    } catch {
      /* 继续往上找 */
    }
  }
}

// ── git 原语 ──────────────────────────────────────────────────────────────────

/**
 * 同步跑一条 git。**永不抛**，把退出码与输出一起交回来。
 * `GIT_OPTIONAL_LOCKS=0`：让只读的 `git status` 连 index.lock 都不去抢 ——
 * 源工作树可能正被别的成员/编辑器用着，只读操作不该产生任何锁。
 */
function git(cwd, args, { input } = {}) {
  const res = spawnSync('git', args, {
    cwd,
    input,
    maxBuffer: GIT_MAX_BUFFER,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  if (res.error) throw new Error(`git ${args.join(' ')} 无法启动：${res.error.message}`);
  const outBuf = res.stdout ?? Buffer.alloc(0);
  return {
    code: res.status === null ? 128 : res.status,
    out: outBuf,
    text: outBuf.toString('utf8'),
    err: (res.stderr ?? Buffer.alloc(0)).toString('utf8'),
  };
}

/** 跑一条 git，非零就带着 stderr 尾部 20 行退出（内部错误 ⇒ 2）。 */
function gitOk(cwd, args, what) {
  const r = git(cwd, args);
  if (r.code !== 0) {
    die(`${what}失败（git 退出码 ${r.code}）\n  命令: git ${args.join(' ')}\n  目录: ${cwd}\n--- stderr 尾部 20 行 ---\n${tailLines(r.err)}`);
  }
  return r;
}

function repoRootOf(p) {
  const r = git(p, ['rev-parse', '--show-toplevel']);
  if (r.code !== 0) {
    die(`不是一个 git 工作树：${p}\n--- stderr 尾部 20 行 ---\n${tailLines(r.err)}`);
  }
  return r.text.trim();
}

function headOf(p) {
  return gitOk(p, ['rev-parse', 'HEAD'], '读 HEAD').text.trim();
}

function treeGitDir(tree) {
  return gitOk(tree, ['rev-parse', '--absolute-git-dir'], '解析 test-tree 的 git 目录').text.trim();
}

function registeredWorktrees(repoRoot) {
  const r = git(repoRoot, ['worktree', 'list', '--porcelain']);
  if (r.code !== 0) return [];
  return r.text
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => normalizePath(l.slice('worktree '.length).trim()));
}

function readMeta(tree) {
  const p = path.join(treeGitDir(tree), META_NAME);
  if (!exists(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeMeta(tree, meta) {
  fs.writeFileSync(path.join(treeGitDir(tree), META_NAME), `${JSON.stringify(meta, null, 2)}\n`);
}

// ── 「干净吗」的读数 ──────────────────────────────────────────────────────────

/** `?? a -> b` 里取 b；`M  path` 里取 path。引号路径不还原（见"未处理边界"）。 */
function pathOfPorcelainLine(line) {
  const rest = line.slice(3);
  const arrow = rest.indexOf(' -> ');
  return arrow === -1 ? rest : rest.slice(arrow + 4);
}

function readPorcelain(tree) {
  const r = git(tree, ['status', '--porcelain', '--untracked-files=all']);
  if (r.code !== 0) {
    die(`读 test-tree 的 status 失败：${tree}\n--- stderr 尾部 20 行 ---\n${tailLines(r.err)}`);
  }
  return r.text.split('\n').filter((l) => l.trim() !== '');
}

/**
 * 把 test-tree 自己的 node_modules 软链从读数里**扣除**（不是忽略错误，是明确排除）。
 * 返回扣除掉的行数，好让报告能说清"这个 0 是怎么来的"。
 */
function splitOurNodeModules(lines) {
  const kept = [];
  let dropped = 0;
  for (const line of lines) {
    const p = pathOfPorcelainLine(line);
    if (p === TREE_NM || p.startsWith(`${TREE_NM}/`)) dropped += 1;
    else kept.push(line);
  }
  return { kept, dropped };
}

/**
 * 把 test-tree 恢复到「刚 init 完」的样子。
 * ★ `clean` 必须带 `-e node_modules`：软链匹配不上 `.gitignore` 的 `node_modules/`
 *   （见文件头 MEASURED），不带这句 `clean -fd` 会把依赖一起删掉。
 * 返回**清理前**残留的条目（这是要打印出来的读数，不是错误）。
 */
function cleanTree(tree) {
  const before = splitOurNodeModules(readPorcelain(tree)).kept;
  gitOk(tree, ['reset', '--hard', '--quiet'], '恢复 test-tree 已跟踪文件');
  gitOk(tree, ['clean', '-fdq', '-e', TREE_NM], '清除 test-tree 未跟踪文件');
  const after = splitOurNodeModules(readPorcelain(tree)).kept;
  if (after.length > 0) {
    die(
      `清理后 test-tree 仍不干净（${after.length} 项），拒绝在被污染的身份上跑（结果会误导）\n` +
        `--- 残留（最多 20 行）---\n${tailLines(after.join('\n'))}`,
    );
  }
  return before;
}

/**
 * 硬闸：test-tree 若落在源仓**内部**，它必须在源仓的忽略规则里。
 *
 * ★ 这条是被 fixture 打出来的真事故（不是假想）：fixture 仓的 .gitignore 只写了
 *   `node_modules/`，test-tree 放在 `<仓>/.workbuddy/test-tree` ⇒ 源仓的
 *   `git ls-files --others --exclude-standard` 把**树自己的每个文件**列成"未跟踪新文件"
 *   ⇒ `run` 会把树复制进它自己（递归、且读数全错）。
 *   本仓碰巧把 `.workbuddy/` 忽略了，所以第一次跑没暴露 —— 这类"只是碰巧不出事"
 *   的依赖必须变成断言，否则换个仓就炸。
 */
function assertTreeIgnored(srcRoot, tree) {
  const rel = path.relative(srcRoot, tree);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return; // 在源仓外，无所谓
  const r = git(srcRoot, ['check-ignore', '-q', '--no-index', rel]);
  if (r.code === 0) return;
  die(
    `test-tree 落在源仓内部、却没被源仓忽略：${rel}\n` +
      `  ★ 不加忽略会出事：源仓的 \`git ls-files --others --exclude-standard\` 会把\n` +
      `    这棵树自己的文件当成"未跟踪新文件"列出来 ⇒ run 会把树复制进它自己。\n` +
      `  两条路选一条：\n` +
      `    (a) 把 \`${rel.split(path.sep)[0]}/\` 加进源仓的 .gitignore；或\n` +
      `    (b) 用 --dir 把 test-tree 放到源仓外面（例如 ../test-tree）。`,
    1,
  );
}

/**
 * ── 保证执行的收尾清理 ────────────────────────────────────────────────────────
 *
 * ★ 这段是被 fixture 打出来的真缺陷（MEASURED）：apply **半应用**之后失败
 *   （补丁删掉了 b/del.js、写入 c/mod.js 时 Permission denied），`die()` 直接
 *   `process.exit()` ⇒ 后面那段 `finally` 式的收尾**根本没跑** ⇒ 树里留着
 *   `D b/del.js`。契约写的是"无论成败，结束后恢复"，而 `process.exit()` 会跳过
 *   一切正常控制流 —— 所以恢复动作必须挂在 `process.on('exit')` 上，
 *   用 spawnSync 做（'exit' 里只允许同步操作）。
 */
let pendingCleanup = null;

process.on('exit', () => {
  if (!pendingCleanup) return;
  const { tree } = pendingCleanup;
  pendingCleanup = null;
  try {
    git(tree, ['reset', '--hard', '--quiet']);
    git(tree, ['clean', '-fdq', '-e', TREE_NM]);
    process.stderr.write('\n  [收尾] 中途退出（非正常路径）⇒ 已强制 reset --hard + clean -fd，test-tree 恢复干净\n');
  } catch (e) {
    process.stderr.write(`\n  ✗ 中途退出后清理失败，test-tree 可能是脏的，去跑一次 status：${e.message}\n`);
  }
});

// ── 参数解析 ──────────────────────────────────────────────────────────────────

function parseOpts(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') break;
    else if (a === '--from') opts.from = argv[(i += 1)];
    else if (a.startsWith('--from=')) opts.from = a.slice('--from='.length);
    else if (a === '--dir') opts.dir = argv[(i += 1)];
    else if (a.startsWith('--dir=')) opts.dir = a.slice('--dir='.length);
    else if (a === '-h' || a === '--help') opts.help = true;
    else opts.unknown = [...(opts.unknown ?? []), a];
  }
  if (opts.unknown?.length) die(`不认识的参数：${opts.unknown.join(' ')}\n${USAGE}`, 2);
  return opts;
}

function resolveTree(opts) {
  const base = opts.from ? normalizePath(opts.from) : process.cwd();
  const repoRoot = repoRootOf(base);
  const tree = normalizePath(opts.dir ?? path.join(repoRoot, DEFAULT_TREE_REL));
  return { repoRoot, tree };
}

// ── init ──────────────────────────────────────────────────────────────────────

function cmdInit(argv) {
  const opts = parseOpts(argv);
  if (opts.help) {
    log(USAGE);
    return 0;
  }
  const { repoRoot, tree } = resolveTree(opts);

  log('');
  log('── test-tree init ──────────────────────────────────────────────');
  kv('源工作树', repoRoot);
  kv('test-tree', tree);

  assertTreeIgnored(repoRoot, tree);
  const isRegistered = () => registeredWorktrees(repoRoot).includes(tree);

  // ① 树被外部清空过（临时目录被扫、手滑 rm -rf）：注册还在、目录没了
  if (isRegistered() && !exists(tree)) {
    reading('上次建的树被外部清空了（worktree 注册还在、目录不在）⇒ prune 后重建');
    gitOk(repoRoot, ['worktree', 'prune'], '清理失效的 worktree 注册');
  }

  // ② 目录在、但没被注册进本仓：**绝不自己删**（这是别人的东西还是垃圾，我判不了）
  if (!isRegistered() && exists(tree)) {
    die(
      `目录已存在、但不是本仓注册的 worktree，脚本不会自己清：${tree}\n` +
        `  确认它没用之后手动删掉（rm -rf "${tree}"），再跑一次 init。`,
      1,
    );
  }

  if (!isRegistered()) {
    fs.mkdirSync(path.dirname(tree), { recursive: true });
    // ★ 生产上这里应该考虑 `--no-checkout` + 依赖克隆；本次验证用「检出 + 软链」。
    gitOk(repoRoot, ['worktree', 'add', '--detach', tree, 'HEAD'], '建 test-tree');
    reading(`git worktree add --detach ${tree} HEAD`);
  } else {
    reading('test-tree 已注册为 worktree，复用（不重建）');
  }

  // 依赖：只在这时候「接」一次，之后 run 里**永不安装**
  const dep = linkDependencies(repoRoot, tree);

  const meta = {
    tool: 'scripts/test-tree.mjs',
    sourceRepo: repoRoot,
    baseCommit: headOf(tree),
    dependencyMode: dep.mode,
    dependencySource: dep.mode === 'symlink' ? dep.target : null,
    createdAt: readMeta(tree)?.createdAt ?? new Date().toISOString(),
    lastInitAt: new Date().toISOString(),
  };
  writeMeta(tree, meta);

  log('');
  printStatus(tree, repoRoot, meta);
  log('');
  log('✓ init 完成。以后只会用 `run`，依赖不会再装第二次。');
  return 0;
}

/**
 * 依赖是软链时，在 `run` 启动处**打印**警告 —— 不是静默、不是只留注释。
 *
 * ★ 为什么值得占三行输出：半年后有人拿这棵树跑 `pnpm install`，
 *   源码里的注释他看不到，但启动横幅他一定看得到。这条限制会让
 *   "测试树"污染开发树，而"不污染"正是它存在的全部理由。
 */
function warnIfSymlinkedDeps(tree) {
  if (!isSymlink(path.join(tree, TREE_NM))) return;
  log('');
  log('  ⚠ 依赖是【软链】不是副本：require.resolve 会解析回源仓 ⇒ 本树只适合只读测试');
  log('    （node --test 一类）；不要在这里跑 pnpm install / rebuild / postinstall。');
  log('    生产用 pnpm --offline 或 cp -al。详见文件顶部「已知限制」。');
}

/**
 * 把依赖「接」进来。**只连不装** —— 装依赖是 init 的事，而且只做一次。
 * ★ 生产形态见文件头：pnpm --offline 共享 store / cp -al 硬链。软链仅为本次验证。
 */
function linkDependencies(repoRoot, tree) {
  const srcNm = path.join(repoRoot, TREE_NM);
  const dstNm = path.join(tree, TREE_NM);

  if (!exists(srcNm)) {
    die(`源工作树里没有 ${TREE_NM}：${srcNm}\n  先在那里正常装一次依赖，再回来 init。`, 1);
  }

  if (isSymlink(dstNm)) {
    const target = path.resolve(tree, fs.readlinkSync(dstNm));
    if (target !== path.resolve(srcNm) && !exists(target)) {
      reading(`test-tree 的依赖软链指向已消失的目标（${target}）⇒ 重新接`);
      fs.unlinkSync(dstNm);
    } else {
      reading(`依赖已接好：${TREE_NM} → ${target}（软链，不占盘）`);
      return { mode: 'symlink', target };
    }
  } else if (exists(dstNm)) {
    reading(`${TREE_NM} 是实体目录（不是软链）⇒ 当成已有依赖，不动它`);
    return { mode: 'directory', target: dstNm };
  }

  fs.symlinkSync(srcNm, dstNm, 'dir');
  reading(`依赖接好：${TREE_NM} → ${srcNm}（软链，不是 2.4 GB 的副本）`);
  return { mode: 'symlink', target: srcNm };
}

// ── status ────────────────────────────────────────────────────────────────────

function printStatus(tree, repoRoot, meta) {
  const dirThere = exists(tree);
  const registered = dirThere ? registeredWorktrees(repoRoot).includes(normalizePath(tree)) : false;
  let clean = null;
  let dropped = 0;
  let residue = [];

  if (dirThere && registered) {
    const split = splitOurNodeModules(readPorcelain(tree));
    dropped = split.dropped;
    residue = split.kept;
    clean = residue.length === 0;
  }

  const nmPath = path.join(tree, TREE_NM);
  let nmLine = '缺失（run 会直接报错，不会自动装）';
  if (isSymlink(nmPath)) {
    const target = path.resolve(tree, fs.readlinkSync(nmPath));
    nmLine = `软链 → ${target}${exists(target) ? '' : '  【目标不存在！】'}`;
  } else if (exists(nmPath)) {
    nmLine = '实体目录（副本，会额外占盘）';
  }

  kv('路径', tree);
  kv('已初始化', dirThere && registered ? '是' : '否');
  kv('worktree 注册', registered ? '是' : '否');
  if (dirThere && registered) {
    kv('git 目录', treeGitDir(tree));
    const head = headOf(tree);
    kv('树 HEAD', `${head.slice(0, 8)}（detached，不是分支）`);
    kv('init 时基线', (meta?.baseCommit ?? '(未知)').slice(0, 8));
    // ★ 真正的对齐判据是「树 HEAD 是否 = 源树 HEAD」，不是「= init 那天那个提交」。
    //   这两者混在一起说过，会让人以为树落后了（其实 run 每次都会自动对齐）。
    const srcHead = meta?.sourceRepo && exists(meta.sourceRepo) ? headOf(meta.sourceRepo) : null;
    if (srcHead) {
      kv('源树 HEAD', `${srcHead.slice(0, 8)}${srcHead === head ? '（= 树 HEAD，已对齐）' : '（未对齐；下次 run 开头会自动对齐）'}`);
    }
  }
  kv('源工作树', meta?.sourceRepo ?? repoRoot);
  kv('依赖', nmLine);
  kv(
    '干净',
    clean === null
      ? '(未初始化，无法判断)'
      : clean
        ? `是（0 项；已扣除 ${TREE_NM} 软链 ${dropped} 行）`
        : `否（${residue.length} 项残留）`,
  );
  if (residue.length > 0) {
    for (const line of residue.slice(0, 10)) log(`      ${line}`);
    if (residue.length > 10) log(`      … 还有 ${residue.length - 10} 项`);
  }
  if (meta?.lastRunAt) kv('上次 run', `${meta.lastRunAt}（退出码 ${meta.lastRunCode}）`);

  if (isSymlink(nmPath)) {
    log('');
    log('  ⚠ 依赖是【软链】不是副本：require.resolve 会解析回源仓 ⇒ 本树只适合只读测试');
    log('    （node --test 一类）；不要在这里跑 pnpm install / rebuild / postinstall。');
    log('    生产用 pnpm --offline 或 cp -al。详见文件顶部「已知限制」。');
  }
}

function cmdStatus(argv) {
  const opts = parseOpts(argv);
  if (opts.help) {
    log(USAGE);
    return 0;
  }
  const { repoRoot, tree } = resolveTree(opts);
  log('');
  log('── test-tree status ────────────────────────────────────────────');

  if (!exists(tree) || !registeredWorktrees(repoRoot).includes(normalizePath(tree))) {
    kv('路径', tree);
    kv('已初始化', '否');
    log('');
    log('  跑 `node scripts/test-tree.mjs init` 建它。');
    return 1;
  }

  const meta = readMeta(tree);
  printStatus(tree, repoRoot, meta);
  const split = splitOurNodeModules(readPorcelain(tree));
  log('');
  return split.kept.length === 0 ? 0 : 1;
}

// ── run（核心）────────────────────────────────────────────────────────────────

async function cmdRun(argv) {
  const sep = argv.indexOf('--');
  if (sep === -1) die(`run 需要 \`--\` 把命令隔开\n${USAGE}`, 2);
  const own = argv.slice(0, sep);
  const cmdv = argv.slice(sep + 1);
  if (cmdv.length === 0) die(`\`--\` 后面没有命令\n${USAGE}`, 2);

  const opts = parseOpts(own);
  if (opts.help) {
    log(USAGE);
    return 0;
  }
  const srcRoot = normalizePath(repoRootOf(normalizePath(opts.from ?? process.cwd())));
  const tree = normalizePath(opts.dir ?? path.join(srcRoot, DEFAULT_TREE_REL));
  const label = cmdv.join(' ');

  log('');
  log('── test-tree run ───────────────────────────────────────────────');
  kv('源工作树', srcRoot);
  kv('test-tree', tree);
  kv('命令', label);
  // ★ 每次 run 都打印（不加 --quiet 开关：这条限制不该能被静音掉）
  warnIfSymlinkedDeps(tree);

  // ── 前置断言：树在、依赖在、身份对、树不在源仓的可见范围里 ──────────────────
  assertTreeIgnored(srcRoot, tree);
  if (!exists(tree)) die(`test-tree 不存在：${tree}\n  先跑 \`node scripts/test-tree.mjs init\`。`, 1);
  if (!registeredWorktrees(srcRoot).includes(tree)) {
    die(`目录存在但不是本仓注册的 worktree：${tree}\n  先跑 init（脚本不会自己清目录）。`, 1);
  }
  const meta = readMeta(tree);
  if (meta?.sourceRepo && normalizePath(meta.sourceRepo) !== srcRoot) {
    die(
      `这棵 test-tree 属于另一个源仓，不能拿来跑当前源树：\n` +
        `  test-tree 的源: ${meta.sourceRepo}\n  本次 --from : ${srcRoot}`,
      1,
    );
  }
  // ★ 依赖永不重装：缺了就报错，不自动装
  const nmPath = path.join(tree, TREE_NM);
  if (!exists(nmPath)) {
    die(`${TREE_NM} 不在 test-tree 里：${nmPath}\n  本脚本**不会**自动装依赖（那是 init 一次的事）。\n  跑 \`node scripts/test-tree.mjs init\` 重新接一次。`, 1);
  }
  if (isSymlink(nmPath)) {
    const target = path.resolve(tree, fs.readlinkSync(nmPath));
    if (!exists(target)) die(`${TREE_NM} 软链的目标已不存在：${target}\n  源仓的依赖被删了？跑 init 重接，或先把源仓的依赖装回来。`, 1);
  }

  // ── 读数①：上一轮残留（这既是断言，也是一个要被打印的数字）──────────────────
  const residue = cleanTree(tree);
  // ★ 从这一行起，树随时可能被改动 ⇒ 挂上"保证执行"的收尾（见文件上方 process.on('exit')）
  pendingCleanup = { tree };
  reading(residue.length === 0 ? '上一轮残留: 0 项（干净）' : `上一轮残留: ${residue.length} 项 ⇒ 已 reset --hard + clean -fd 清掉`);
  if (residue.length > 0) {
    for (const line of residue.slice(0, 10)) log(`           ${line}`);
    if (residue.length > 10) log(`           … 还有 ${residue.length - 10} 项`);
  }

  // ── 读数②：把基底对齐到源树 HEAD（树可能停在 init 那天的旧提交）─────────────
  const srcHead = headOf(srcRoot);
  const treeHead = headOf(tree);
  if (srcHead !== treeHead) {
    gitOk(tree, ['reset', '--hard', '--quiet', srcHead], '把 test-tree 基底对齐到源树 HEAD');
    reading(`基底: ${treeHead.slice(0, 8)} → ${srcHead.slice(0, 8)}（对齐源树 HEAD）`);
  } else {
    reading(`基底: ${srcHead.slice(0, 8)}（已 = 源树 HEAD）`);
  }

  // ── 搬改动：跟踪文件走补丁，未跟踪文件走复制 ────────────────────────────────
  const patch = gitOk(srcRoot, ['diff', 'HEAD', '--binary', '--full-index'], '读源工作树的未提交改动').out;
  const patchFiles = (patch.toString('utf8').match(/^diff --git /gm) ?? []).length;

  if (patch.length > 0) {
    const patchFile = path.join(treeGitDir(tree), 'last.patch');
    fs.writeFileSync(patchFile, patch);
    const ap = git(tree, ['apply', '--3way', '--whitespace=nowarn', patchFile]);
    if (ap.code !== 0) {
      // ★ 契约：失败就报错并**不继续** —— 不在半应用的状态上跑测试，那读数没有意义
      die(
        `应用补丁失败（git apply --3way 退出码 ${ap.code}），已中止，不跑命令。\n` +
          `  补丁留在: ${patchFile}\n` +
          `  常见原因：源树和 test-tree 的基底不一致、或补丁里有子模块/二进制冲突。\n` +
          `--- stderr 尾部 20 行 ---\n${tailLines(ap.err)}`,
        1,
      );
    }
    reading(`补丁: ${patch.length} bytes / ${patchFiles} 个跟踪文件（含删除）⇒ git apply --3way 成功`);
  } else {
    reading('补丁: 0 bytes（源树没有已跟踪文件的改动）');
  }

  const untracked = gitOk(srcRoot, ['ls-files', '--others', '--exclude-standard', '-z'], '列源树的未跟踪文件')
    .text.split('\0')
    .filter(Boolean);
  const copied = copyUntracked(srcRoot, tree, untracked);
  reading(`未跟踪新文件: ${untracked.length} 个 ⇒ 复制 ${copied.copied} 个`);
  if (copied.failures.length > 0) {
    die(
      `有 ${copied.failures.length} 个未跟踪文件没搬过去。\n` +
        `  ★ 不继续：少一个源文件就是拿"另一棵树"在跑，读数会误导。\n` +
        copied.failures.map((f) => `  - ${f}`).join('\n'),
      1,
    );
  }

  const landed = splitOurNodeModules(readPorcelain(tree)).kept.length;
  reading(`test-tree 里现在的改动: ${landed} 项`);

  // ── 跑命令 ────────────────────────────────────────────────────────────────
  log('');
  log(`▶ ${label}`);
  log('');
  const result = await runCommand(cmdv[0], cmdv.slice(1), tree);
  const ms = Math.round(result.ms);

  // ── 收尾：无论成败都恢复 ──────────────────────────────────────────────────
  let cleanupError = null;
  try {
    const leftover = cleanTree(tree);
    pendingCleanup = null; // 正常收尾已完成，别再让 exit 钩子重复清一遍
    reading(`收尾: 清掉 ${leftover.length} 项，test-tree 已恢复干净`);
  } catch (e) {
    cleanupError = e;
  }

  try {
    const m = readMeta(tree) ?? {};
    // baseCommit 记的是「这棵树现在停在哪个提交」，不是「init 那天的提交」——
    // 否则 status 会一直显示一个过期的基线，把"已对齐"误报成"落后"。
    writeMeta(tree, {
      ...m,
      baseCommit: srcHead,
      lastRunAt: new Date().toISOString(),
      lastRunCode: result.code,
      lastRunLabel: label,
    });
  } catch {
    /* 元数据写不上不影响结论 */
  }

  log('');
  if (result.signal) {
    const n = os.constants.signals[result.signal];
    log(`■ ${label} ⇒ 被信号 ${result.signal} 终结（退出码 ${result.code} = 128+${n}）`);
  } else {
    log(`■ ${label} ⇒ 退出码 ${result.code}（${ms} ms）`);
  }
  if (result.code !== 0 && result.errTail) {
    log('--- 被测命令 stderr 尾部 20 行 ---');
    log(tailLines(result.errTail));
  }
  if (cleanupError) {
    process.stderr.write(`\n✗ 收尾清理失败（结论可能仍有效，但树可能是脏的）：${cleanupError.message}\n`);
  }
  return result.code;
}

/** 复制未跟踪文件。权限位与软链都带过去（补丁做不到这两件事）。 */
function copyUntracked(srcRoot, tree, rels) {
  let copied = 0;
  const failures = [];
  for (const rel of rels) {
    const from = path.join(srcRoot, rel);
    const to = path.join(tree, rel);
    try {
      const st = fs.lstatSync(from);
      if (st.isDirectory()) continue; // ls-files --others 只列文件，防御性跳过
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (st.isSymbolicLink()) {
        if (exists(to)) fs.unlinkSync(to);
        fs.symlinkSync(fs.readlinkSync(from), to);
      } else {
        if (exists(to) && fs.lstatSync(to).isDirectory()) {
          failures.push(`${rel}: test-tree 里同名的是目录，无法覆盖`);
          continue;
        }
        fs.copyFileSync(from, to);
        fs.chmodSync(to, st.mode & 0o777);
      }
      copied += 1;
    } catch (e) {
      failures.push(`${rel}: ${e.message}`);
    }
  }
  return { copied, failures };
}

/**
 * 跑被测命令：**边跑边透传**（保留 tty 与实时输出），同时留 stderr 尾巴 20 行做诊断。
 * 不用 `stdio: 'inherit'` 是因为那样拿不到尾巴；不用 `execSync` 是因为那样会
 * 憋住输出、长测试看起来像挂了。
 */
function runCommand(cmd, args, cwd) {
  return new Promise((resolve) => {
    const started = Date.now();
    let errAll = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: process.env, stdio: ['inherit', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: 127, signal: null, errTail: e.message, ms: Date.now() - started });
      return;
    }
    child.stdout.on('data', (d) => process.stdout.write(d));
    child.stderr.on('data', (d) => {
      process.stderr.write(d);
      errAll += d.toString();
      if (errAll.length > 65536) errAll = errAll.slice(-65536);
    });
    child.on('error', (e) => {
      resolve({ code: 127, signal: null, errTail: `无法启动命令: ${e.message}`, ms: Date.now() - started });
    });
    child.on('close', (code, signal) => {
      // 契约：退出码 = 被测命令的退出码。被信号杀时 shell 惯例是 128+n，
      // 而 node 只给 `code === null` + 信号名 ⇒ 自己把 n 查出来（SIGTERM ⇒ 143）。
      const signalNumber = signal ? os.constants.signals[signal] : undefined;
      resolve({
        code: code === null ? 128 + (signalNumber ?? 0) : code,
        signal,
        errTail: errAll,
        ms: Date.now() - started,
      });
    });
  });
}

// ── 入口 ──────────────────────────────────────────────────────────────────────

const USAGE = `test-tree —— 依赖只装一份，代码临时进去，跑完丢弃

用法：
  node scripts/test-tree.mjs init  [--from <源工作树>] [--dir <test-tree 路径>]
  node scripts/test-tree.mjs run   --from <源工作树> -- <命令...>
  node scripts/test-tree.mjs status [--from <源工作树>] [--dir <test-tree 路径>]

  init    建 test-tree 并把依赖"接"过来（只做一次；run 里永不重装）
  run     把源树的未提交改动搬进去 → 跑命令 → 无论成败都恢复
          ★ 退出码 = 被测命令的退出码（原样透传）
  status  打印状态；退出码 0 = 已初始化且干净，1 = 未初始化或不干净

  默认当前位置：<源仓>/.workbuddy/test-tree（该目录已 gitignore，不污染主树 status）
  环境提示：GIT_* 一律不弹交互提示（GIT_TERMINAL_PROMPT=0）`;

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  if (!sub || sub === '-h' || sub === '--help') {
    log(USAGE);
    return sub ? 0 : 2;
  }
  if (sub === 'init') return cmdInit(rest);
  if (sub === 'run') return cmdRun(rest);
  if (sub === 'status') return cmdStatus(rest);
  die(`未知子命令：${sub}\n${USAGE}`, 2);
}

main().then(
  (code) => process.exit(typeof code === 'number' ? code : 0),
  (e) => {
    process.stderr.write(`\n✗ 未捕获的错误：${e?.stack ?? e}\n`);
    process.exit(2);
  },
);
