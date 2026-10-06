/**
 * ── 判据：契约里的 verify 命令【真的可判】吗 ────────────────────────────────────
 *
 * 插入点：`contract`（建任务 / 改契约 —— 契约 §1 ①）
 *
 * ── 它防的是什么失效（MEASURED，2026-10-05）────────────────────────────────────
 *
 * 契约的 `verify` 是【一个命令字符串列表】。任何进了这份清单的命令都必须是
 * **可判的**：它要能因为"工作做出来了"而变成 0，因为"工作没做出来"而变成非 0。
 * 一条做不到这件事的命令会让整个任务无法诚实地完成 —— 而它在清单里看起来
 * 与别的命令一模一样。
 *
 * 本轮实测的形状（START-HERE §6③ 的原话）：
 *
 *     grep -qx 7 <(wc -l < file)
 *
 * `wc -l` 的输出带前导空格（`      7`），而 `grep -x` 要求【整行】匹配 ⇒ 拿
 * `7` 去比 `"      7"` 永远不匹配 ⇒ 这条命令**永远非零**。于是：
 *
 *     · 任务做对了 ⇒ 命令仍然红 ⇒ 成员无法诚实地宣告完成；
 *     · 而它与"我的工作做错了"在退出码上同形 —— 判据层读不出这两者的区别。
 *
 * 更坏的一层：一条【永远失败】的 verify 会让"伪造 completed"成为唯一出路
 * （那正是 `completion.verify-rerun` 堵的洞）。契约本身不可判，会把成员推向
 * 伪造。所以这条判据的位置是 `contract` —— **在建任务那一刻就说**。
 *
 * ── 它问的是【三条】问题，不是一条（同一个失效有三个来源）──────────────────────
 *
 *   ① **空命令**：`"   "` 与 `""` 不是命令。它们跑起来退出码 0（`test -n ''` 为假
 *      会被读成"通过"）—— 于是它给不出任何信息，却占着 verify 清单的一个位置。
 *   ② **永远失败 / 永远成功**：命令里写死了一个不可能满足的匹配，或者它压根不
 *      依赖任何可变的产物（`true` / `false`）。一个字面量常量没有任何可判性。
 *   ③ **目标是过程替换**（`grep -x PATTERN <(…)`）：PATTERN 要去匹配一个**命令的
 *      输出**，而那条输出有没有前导空白取决于它是什么命令 —— 静态不可判。
 *      ★ 这一条正是本次实测的那条命令的形状。它不是一个错别字，是一个**类别**。
 *
 * ── 判据是【纯数据变换】：I/O 由调用方注入 ────────────────────────────────────
 *
 * 本文件不 import 任何 I/O（`scripts/verify-gates-integration.test.mjs` ④ 会逐行
 * 检查 import 子句）。它需要的唯一"实测"是**真的跑一次那条命令**：
 *
 *     ctx.execVerifyCommand?: (command: string) => Promise<number>
 *
 * ★ 注入与不注入的差别不是"多测一点"，而是**结论的性质**：
 *
 *     不注入 ⇒ 静态分析说"这条命令可以变成 0，也可以变成非 0" ⇒ 但没人真的跑过它
 *              ⇒ `unmeasured`。★ 绝不能返回 ok：那等于声称"我验过了"。
 *     注入   ⇒ 真的跑一次，命令与退出码一起给出 ⇒ 这个结论可以被独立复核。
 *
 * 复跑**判定"永远失败"**是真的要跑：一条命令永远非零，只有跑过才知道。
 * 这也是为什么这条判据在【建任务/改契约】那一刻只做一次（见 `appliesTo` 的说明）。
 *
 * ── 三条不可协商的性质（契约 §2）──────────────────────────────────────────────
 *
 * ① 纯数据变换：不 import I/O；要跑命令时由调用方注入执行器。
 * ② 不调用别的判据（`completion.verify-rerun` 也读 verify 清单，但两者不互相调用）。
 * ③ 三态：ok / blocked([原因]) / unmeasured(为什么没测成)，后两者不同形。
 */
import { ok, blocked, unmeasured } from "../registry.js";
export const id = 'contract.verify-command';
export const point = 'contract';
export const description = '契约里声明的 verify 命令必须可判（既能为做对的工作变绿、也能为做错的工作变红）：空命令、写死的真/假、以及拿 -x 去比"命令输出"（如 grep -qx N <(wc -l …)，前导空格让整行匹配永远不成立）都会在【建任务那一刻】被说清楚';
/**
 * 这个 id 的另一半用途：**调用方可以按它决定要不要注入执行器**。
 *
 * ★ 为什么把一个判据的 id 导出在这里：`tools.ts` 的注入口径是"缺什么就不注入什么
 *   （而不是注入一个空值）"—— 见 tools.ts 的注入口径一节。要在 create_task /
 *   amend_task 上按需注入，调用方必须能问出"contract 位置有没有一条判据需要跑命令"，
 *   而**注册表不认识判据的名字与语义**（契约 §8），所以能回答这个问题的只有判据自己。
 */
export const VERIFY_COMMAND_GATE_ID = id;
/**
 * ── ★ 输入面声明（B 层，编译期）────────────────────────────────────────────────
 *
 * ★ 本条判据正是上一轮五次缺口里的**第三次「执行器缺席」**。而它在这一轮里
 *   提供的是一条与 `build-artifact-scope` **相反的**口径 —— 两条合起来才完整：
 *
 *     build-artifact-scope：判据【可选地】读的东西 ⇒ 不进 requires
 *     verify-command      ：判据【需要它才说得出话】的东西 ⇒ 必须进 requires
 *
 * ── 为什么 `execVerifyCommand` 是必填格，尽管它在类型上是可选的 ────────────────
 *
 * `execVerifyCommand?:` 的"可选"是**类型层的**（判据不许 import I/O，它只能拿到
 * 调用方注入的东西，所以类型上不能强制）。但它在**语义上不是可选的**：
 *
 *     注入   ⇒ 真的跑一次 ⇒ 结论是**观察**（"这条命令退出 3"），可被独立复核
 *     不注入 ⇒ 只有静态分析 ⇒ 结论降级成 `unmeasured`（见 gate 里那段注释）
 *
 * ⇒ 而 `unmeasured` 在本插件里**等于拒绝**（`rejectOnContractGates` 对 unmeasured
 *   抛错）。这正是 t17/t18 实测过的形态：
 *
 *     contract 的两个调用点都没注入 ⇒ `contract.verify-command` 在生产路径上
 *     永远 `unmeasured` ⇒ **implementation / repair 这类必须验的契约连
 *     create_task 都过不去**（一道永远关着的门）。
 *
 * ⇒ 所以这一格【必须】进 requires：它缺席不是"这条判据安静一点"，而是
 *   "这条判据说不出它唯一想说的事"。核对层报出它，与判据自己报 `unmeasured`
 *   是**同一句话的两种说法** —— 它们必须一致（否则就是新的静默失效）。
 *
 * ── 那为什么不干脆声明 `'task'` 就收工 ─────────────────────────────────────────
 *
 * 因为那样会让"执行器没接线"这件事**退回人眼审查**：`task` 在场时判据照常跑、
 * 照常返回一句读起来与"没能测量"同形的 unmeasured —— 而**没有人**能从读数里
 * 看出那是"调用方漏了一行注入"。这正是本轮要消灭的东西：
 * 「判据要的这一格 ctx 没接上」必须变成一次机械核对，而不是一次阅读。
 *
 * ── 边界：`creating` / `task.verify` 为什么不进 ─────────────────────────────────
 *
 * 与 `build-artifact-scope` 同一条口径（见那份声明的长注释）：
 *   · `creating` —— 本条判据**根本不读它**（`gate()` 里没有 `ctx.creating` 的
 *     任何一处使用；它是契约位置两个调用点的共同事实，不是这条判据的输入）。
 *     声明一个判据不读的格子，会让核对层替它说一句它自己不会说的话。
 *   · `task.verify` —— 判据**可选地**读它，而且"缺席"正是它的一条裁决分支
 *     （verify 整个缺席 ⇒ **ok**，t17 的收口）。声明它 = 给每个 `kind=work`
 *     的普通任务制造假告警。它的与未测量臂的对应关系见下面 `appliesTo` 一节。
 *
 * ★ 与未测量臂的一致性（本任务验收 ②）—— 逐条对齐如下：
 *
 *     判据的 unmeasured 分支                          它读的格           进 requires?
 *     ──────────────────────────────────────────────  ─────────────────  ──────────
 *     "no executor was injected …"                    execVerifyCommand  ✔ 是
 *     "the contract declares a verify value that
 *      is not a list"                                 task               ✔ 是
 *     "declares an empty verify list"                 task.verify        ✘ 否（可选）
 *     "running … raised / returned a non-integer"     ——                 ✔（由前者保证）
 *     "the contract could not be judged"（exec 抛错）  ——                 ✔（同上）
 *
 * ⇒ 唯一的"缺 X 就 unmeasured 而 X 不在 requires 里"是 `task.verify`，而它**不是
 *   遗漏**：它的缺席是一条**合法裁决**（t17：verify 缺席 ⇒ ok，不是 unmeasured），
 *   它由 gate 自己的分支持有，并有三条夹具臂钉住（不适用臂 / 未测量臂 / 三态不同形）。
 */
export const requires = ['task', 'execVerifyCommand'];
/**
 * 把一条命令拆成"需要判定的外层命令"与"它嵌套的里层命令"。
 *
 * ★ 为什么需要它：`grep -qx 7 <(wc -l < f)` 里，`wc -l < f` 是**里层**，而
 *   `grep …` 是外层。本判据要判的是【外层】（里层只是它的一个输入）。
 *   被实测咬到的正是外层：`grep -x` 拿一个不含前导空格的模式去比一条**命令的输出**。
 *
 * ★ 只识别 `<(…)` 与 `$(…)`（进程替换与命令替换）。它们都【先于】外层命令求值，
 *   所以里层永远进不了"被判定"的位置 —— 这也正是它必须被排除的原因。
 *   `$( )` 在双引号里同样成立（词仍然可能是分裂的），但保守起见只处理这两种形态。
 */
function splitNestedCommands(command) {
    const inner = [];
    let outer = '';
    let i = 0;
    while (i < command.length) {
        const two = command.slice(i, i + 2);
        if (two === '<(' || two === '$(') {
            let depth = 1;
            let j = i + 2;
            while (j < command.length && depth > 0) {
                const ch = command[j];
                if (ch === '(')
                    depth += 1;
                else if (ch === ')')
                    depth -= 1;
                j += 1;
            }
            inner.push(command.slice(i + 2, depth === 0 ? j - 1 : command.length));
            /** ★ 里层被替换成一个【占位词】而不是删掉：`grep -x 7`（没有目标）与
             *  `grep -x 7 <file>`（有目标）不是同一条命令，形状要保住。 */
            outer += ' @nested@ ';
            i = depth === 0 ? j : command.length;
            continue;
        }
        outer += command[i];
        i += 1;
    }
    return { outer: outer.trim(), inner };
}
/** 拆词（只按空白切；引号里的空白**不**切 —— 一个带空格的模式是一个词）。 */
export function shellTokens(command) {
    const tokens = [];
    let current = '';
    let quote = null;
    for (const ch of command) {
        if (quote !== null) {
            if (ch === quote) {
                quote = null;
                /**
                 * ★ 闭合引号【要留在词里】：`unquote` 靠它认出"这一整个 token 是被引起来的"。
                 *   把它吃掉（只在引号内累积）会让 `"a b"` 变成一个以引号开头的半个词 ——
                 *   而它接下去会喂给"空命令"与"整行匹配"两条规则，两条都会判错。
                 */
                current += ch;
                continue;
            }
            current += ch;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
            continue;
        }
        if (/\s/.test(ch)) {
            if (current !== '') {
                tokens.push(current);
                current = '';
            }
            continue;
        }
        current += ch;
    }
    if (current !== '')
        tokens.push(current);
    return tokens;
}
/** 去掉一个词两端的引号（`'7'` 与 `7` 是同一个模式）。 */
function unquote(token) {
    const match = /^(['"])([\s\S]*)\1$/.exec(token);
    return match === null ? token : (match[2] ?? '');
}
/**
 * ── 写死的真 / 假 ─────────────────────────────────────────────────────────────
 *
 * ★ 为什么 `test -n ''` 那类要单列：它**永远为真** —— 也就是说它永远退出 0，
 *   一条永远绿的 verify 给不出任何关于工作的信息，却会让"完成"看起来被验证过。
 *   它与"永远红"是同一个失效的两面：**没有可判性**。
 */
function constantExitProblem(outer) {
    const tokens = shellTokens(outer).map((token) => token.replace(/^\s+/, ''));
    const first = tokens[0];
    if (first === undefined)
        return undefined;
    const rest = tokens.slice(1);
    if (first === 'true') {
        return { kind: 'always-green', message: `the command "true" exits 0 no matter what the task produced; a verify command that cannot fail cannot certify anything` };
    }
    if (first === 'false') {
        return { kind: 'always-red', message: `the command "false" exits non-zero no matter what the task produced, so this task could never be completed honestly` };
    }
    if (first === ':' || first === '!false') {
        return { kind: 'always-green', message: `the command "${first}" exits 0 no matter what the task produced; it cannot fail the way a verify command must` };
    }
    /**
     * ★ `! …`（取反）**不在**这份清单里，这是刻意的：本仓库真实用过
     *   `! grep -qiE "rollback" file.md`（一个"文档里不许出现某个词"的检查）——
     *   它完全可判（词出现了就红、没出现就绿），把它算成"恒真"是**误伤**。
     *   一条按形状猜语义的规则会把真实命令拒掉，而误伤正是本队最贵的失效。
     */
    if (first === 'test' || first === '[') {
        /**
         * ★ 只抓【确定】的那一种：完全没有断言算子的 `test <字面量>`。
         *
         *   `test -n ''` 是**假**（它断言"空串非空"），`test ''` 才是恒真 —— 而
         *   两者的区别要靠 `test` 的语义去推。本判据不推语义：它只报"这个测试里
         *   没有任何算子，所以它断言的是写在契约里的一个字面量"。
         *   一条靠猜的判据会误伤真实命令（例如 `! grep -qiE "rollback" file.md`
         *   那种可判的取反命令），而误伤会把这条判据教成噪音。
         */
        const args = rest.map(unquote).filter((token) => token !== '');
        if (rest.length === 0) {
            return { kind: 'always-green', message: `bare "${first}" with no assertion always exits 0` };
        }
        if (args.length === 0) {
            return { kind: 'always-green', message: `"${first}" with only empty operands asserts nothing and always exits 0` };
        }
        if (rest.length === 1 && !/^-/.test(rest[0] ?? '')) {
            return { kind: 'always-green', message: `"${first} ${rest[0] ?? ''}" has no operator: it tests whether a single literal word is non-empty, which is fixed at the time the contract was written, not by the task's outcome` };
        }
    }
    return undefined;
}
/**
 * ── ★ 本次实测的那条命令的形状：拿 -x 去比"命令的输出"───────────────────────────
 *
 *     grep -qx 7 <(wc -l < file)
 *     ^        ^  ^  ^  ^^^^ 这条命令的输出就是被比的那一行
 *     │        │  │  └ 进程替换 ⇒ 一个词，内容由里层命令在【运行时】决定
 *     │        │  └ 模式字面量（不含前导空白）
 *     │        └ 匹配类型 x = 整行相等
 *     └ 外层命令
 *
 * `wc -l` 的输出是 `"      7"`（右对齐、带前导空格）⇒ 整行匹配永远不成立。
 * **静态不可判**：同一个模式配一条不带空白的输出（`cat`）是对的。
 * ⇒ 判据说的是"这条命令的成败取决于一个命令的输出空白，而这一点在契约里看不出来"，
 *   而不是"这个模式写错了"。★ 措辞必须落在可复核的事实上。
 */
function processSubstitutionProblem(outer, inner) {
    const tokens = shellTokens(outer);
    const cmd = tokens[0];
    if (cmd !== 'grep' && cmd !== 'egrep' && cmd !== 'fgrep')
        return undefined;
    const nestedTarget = tokens.indexOf('@nested@');
    if (nestedTarget === -1)
        return undefined;
    /**
     * 整行匹配的开关：`-x` / `--line-regexp`，可以并进组合短选项（`-qx`、`-qxE`）。
     * ★ 只认【确定】的那些；`-w`（词匹配）不在此列 —— 它不要求整行相等，
     *   前导空格不影响它。把它也算进来会误伤。
     */
    const wholeLine = tokens.some((token) => token === '--line-regexp'
        || /^-[a-zA-Z]*x[a-zA-Z]*$/.test(token));
    if (!wholeLine)
        return undefined;
    const sample = inner[0] ?? '(a command)';
    return {
        kind: 'non-judgeable',
        message: `this command decides its pattern with a whole-line match (-x) against the OUTPUT of ${JSON.stringify(sample)} (a process substitution), but the pattern itself is the literal ${JSON.stringify(tokens[nestedTarget - 1] ?? '')}. `
            + `An output's leading/trailing whitespace is decided by the producer at run time and is not visible in the contract, so whether this command can ever match cannot be determined statically. `
            + `Concretely, \`wc -l\` prints a right-aligned number with leading blanks (e.g. "      7"), so \`grep -x 7\` never matches. `
            + `Fix it by removing the ambiguity (for example: compare in the shell — \`[ "$(wc -l < file | tr -d " ")" = "7" ]\` — or match against the raw text instead of a command's output).`,
    };
}
/**
 * 一条命令的静态问题；没有 ⇒ `undefined`（"看过这条命令，它看起来可判"）。
 *
 * ★ `undefined` 说的是【静态可判性】，不是"它一定通过"。两者不能混：
 *   一条命令看起来可判，但它在当前工作区里到底跑成什么，只有真的跑一次才知道。
 */
export function verifyCommandProblems(command) {
    if (typeof command !== 'string') {
        return [{ kind: 'empty', message: `verify entries must be strings; got ${JSON.stringify(command)}` }];
    }
    const trimmed = command.trim();
    if (trimmed === '') {
        return [{
                kind: 'empty',
                message: 'this verify entry is blank. A blank command is not a test: the shell exits 0 for an empty command line, and that 0 would be read as "the work was verified" while nothing was run.',
            }];
    }
    const { outer, inner } = splitNestedCommands(trimmed);
    const problems = [];
    const constant = constantExitProblem(outer);
    if (constant !== undefined)
        problems.push(constant);
    const substitution = processSubstitutionProblem(outer, inner);
    if (substitution !== undefined)
        problems.push(substitution);
    return problems;
}
/* ──────────────────────────────────────────────────────────────────────────────
 * 判据本体
 * ────────────────────────────────────────────────────────────────────────────── */
/**
 * 只对【真的带着契约】的上下文生效。
 *
 * ★ `appliesTo` **不**排除"没有 verify"的情形：那正是未测量臂要表达的东西
 *   （拿不到清单 ⇒ `unmeasured`，不是 `ok`，也不是 `skipped`）。把"没有 verify"
 *   写成 `appliesTo: () => false` 会让它落进 `skipped`，而 `skipped` 在日志里与
 *   "这条判据不适用"同形 —— 于是"契约里根本没写 verify"这件事永远不会有人说。
 *   （与 t9 的"观察模式不是 appliesTo"同一个道理：**不适用**与**没能测量**不同形。）
 *
 * ★ 收窄在 `gate` 里按【事实】做，不在这里按 kind 收窄（与 t11 的 build-artifact-scope
 *   同构）：判据不猜哪些 kind "应该"有 verify —— 它进 gate 之后看手上这份契约
 *   有没有提出可判性要求。
 *
 * ★ MEASURED（2026-10-05，t17 收口）：本判据此前对「整个 verify 缺席」报 `unmeasured`，
 *   而调用方把 unmeasured 读成拒绝 ⇒ **所有 `kind=work` 的普通任务都建不出来**
 *   （实测打红 `scripts/stress-verify.mjs`）。依据在 `src/quality-gates.ts:510`：
 *   `if (kind === 'work') return { ok: true }` —— work 类**本就没有 verify 要求**。
 *   ⇒ 「不适用」被写成了「没能测量」，而那正是本队那条跨层规则禁止的形状。
 */
export function appliesTo(ctx) {
    return ctx?.task !== undefined;
}
export async function gate(ctx) {
    const task = ctx?.task;
    const commands = task?.verify;
    /**
     * ── ★ verify【整个缺席】⇒ ok（不适用），**不是** unmeasured（t17）─────────────
     *
     * MEASURED（2026-10-05）：`kind=work` 的任务本来就**不声明** `verify`，而
     * `src/quality-gates.ts:510` 对 work 类直接 `return { ok: true }` —— 它没有
     * verify 要求。（要求 verify 的是 implementation/repair/verification/integration，
     * 那几类在 `evaluateQualityCompletion` 里由 `verifyCovered` 单独把关。）
     *
     * ⇒ 本判据若对"整个缺席"报 `unmeasured`，而缺席恰恰是**每个普通任务**的常态，
     *   那么 unmeasured（= 调用方拒绝）就把所有普通任务挡在门外 ——
     *   那不是判据严格，那是把"不适用"写成了"没测到"。**两者代价方向相反**：
     *
     *     不适用 ⇒ 没有这个要求，放行是**对的**
     *     没测到 ⇒ 有这个要求而我没能检查，放行是**错的**
     *
     * ★ 分界不是"字段在不在"，而是**"这份契约有没有提出可判性要求"**（与 t11 的
     *   inScope 那次逐字同构）：
     *     · verify **整个缺席** ⇒ 这份契约没有提出"这些命令要能判定"的要求 ⇒ ok
     *     · verify **在场但不可判**（空清单 / 全是无法规整的条目）⇒ **它提了要求**，
     *       而那个清单读不出内容 ⇒ 我**没能测量**它 ⇒ unmeasured / blocked
     *
     * ★ 它不会被用来偷偷放过一份坏契约：真正会拿空命令去"验"任务的是**声明了
     *   verify 的质量任务**，而那些走下面的分支。缺席的契约在 `quality-gates.ts`
     *   的 work 分支上根本不被读 verify，所以这里放行不改变任何一条命令的可判性结论。
     */
    if (commands === undefined)
        return ok();
    /**
     * ★ 非数组 ⇒ 仍是 `unmeasured`：这与"缺席"不同 —— 一份**写了** verify 却不是列表的
     *   契约是"它提了要求，而那个要求读不出来"，不是"它没提要求"。
     */
    if (!Array.isArray(commands)) {
        return unmeasured(`the task contract (${task?.id ?? 'unnamed'}, kind=${task?.kind ?? 'unspecified'}) declares a verify value that is not a list (got ${typeof commands}), so whether the commands that will decide this task are judgeable could not be determined`);
    }
    const meaningful = commands.filter((entry) => typeof entry === 'string' && entry.trim() !== '');
    /**
     * ★ 空清单与"清单里全是空条目"都要说话。
     *
     *   空清单 ⇒ 没有命令可判（这是"没能测量"：没有可判的东西）。
     *   全空条目 ⇒ 那是一条**真的缺陷**（成员会跑一条空命令并拿到 0）⇒ blocked。
     */
    if (commands.length === 0) {
        return unmeasured(`the task contract (${task?.id ?? 'unnamed'}) declares an empty verify list, so there is no command to check; an empty list is not evidence that the contract is judgeable`);
    }
    if (meaningful.length === 0) {
        const problems = commands.map((entry) => verifyCommandProblems(entry)[0]).filter((item) => item !== undefined);
        return blocked(problems.map((problem) => `[${problem.kind}] ${problem.message}`));
    }
    /** ── 静态检查：每条命令都要能自己做判定 ─────────────────────────────────── */
    const staticProblems = [];
    const suspects = [];
    for (const command of commands) {
        const problems = verifyCommandProblems(command);
        if (problems.length === 0)
            continue;
        suspects.push(command.trim());
        for (const problem of problems)
            staticProblems.push(`"${command.trim()}" — [${problem.kind}] ${problem.message}`);
    }
    const exec = ctx?.execVerifyCommand;
    /**
     * ★ 没有执行器 ⇒ **静态结论降级成 `unmeasured`**。
     *
     *   理由（契约 §3.4 的同一条纪律）：静态分析说的是"这条命令在壳里会怎么走"，
     *   它没有真的跑过。把它当成"测过了"就是把一次推断并进一次测量。
     *   ★ 但**静态问题本身不许丢**：它必须原样出现在 unmeasured 的那句话里，
     *   否则"没测成"会变成一次静默 —— 而"我没测到"与"我什么都没说"不同形。
     *   （这也是为什么这里不写 `blocked`：blocked 是"测了，发现问题"，
     *     而没有执行器时我们确实没能测。三态的措辞就是它们的证据强度。）
     */
    if (typeof exec !== 'function') {
        return unmeasured(staticProblems.length === 0
            ? `no executor was injected, so the ${commands.length} declared verify command(s) were only inspected statically (none of them looked constant or statically undecidable) but never actually run; without a run there is no evidence that any of them can go green for correct work and red for incorrect work`
            : `no executor was injected, so the ${commands.length} declared verify command(s) were only inspected statically — and that inspection says: ${staticProblems.join(' | ')} (nothing was actually run, so this is "could not measure", not "found problems in a run")`);
    }
    /**
     * ── 真的跑一次：把"永远红 / 永远绿"从推断变成观察 ──────────────────────────
     *
     * 一条命令永远非零是可以**被告知**的（跑一次就知道了），而这一层是整套判据里
     * 唯一能说这句话的地方：`completion.verify-rerun` 只在完成时重跑，那时成员已经
     * 白跑了一趟；而这条在契约落库那一刻就说。
     */
    const runs = [];
    const blockers = [];
    for (const command of commands) {
        const trimmed = String(command).trim();
        if (trimmed === '') {
            /** 已在静态检查里说过一次；这里不再重复 —— 一条缺陷只说一次。 */
            continue;
        }
        let exitCode;
        try {
            exitCode = await exec(trimmed);
        }
        catch (error) {
            /**
             * ★ 执行器抛错 ⇒ `unmeasured`，不是"命令失败"。
             *
             *   两者不同形：前者说"我没能跑它"，后者说"它跑了并且失败"。
             *   把它们并成一类，会让一次基础设施故障伪装成一个关于契约的结论。
             *   （与 `completion.verify-rerun` 的同名分支逐字同构。）
             */
            return unmeasured(`judging the declared verify command "${trimmed}" raised: ${String(error?.message)} — the contract could not be judged, which is not the same as the contract being wrong`);
        }
        if (!Number.isSafeInteger(exitCode)) {
            return unmeasured(`running the declared verify command "${trimmed}" returned a non-integer exit code: ${JSON.stringify(exitCode)}; an exit code that is not an integer cannot be read as pass or fail`);
        }
        runs.push({ command: trimmed, exitCode });
    }
    /**
     * ── 命令跑不跑得动：`127` 是"这条命令不存在"──────────────────────────────────
     *
     * ★ 为什么单独说：它与"命令跑了并且失败"在退出码上都是非零，但成因完全不同 ——
     *   前者是**契约不可能被执行**（写错了一个不存在的工具名），后者是**工作没做出来**。
     *   一条永远 127 的 verify 就是本次实测那类"永远失败"，而它的修法是改契约。
     *   ★ 而它与 `unmeasured` 也不同形：我们确实跑了它，只是它压根不存在。
     */
    for (const run of runs) {
        if (run.exitCode === 127) {
            blockers.push(`the declared verify command "${run.command}" exited 127 when it was run: the shell could not find that command (or a command inside it). The contract names something that cannot be executed, so this task can never pass its own verify.`);
        }
    }
    /**
     * ── 静态发现的问题：现在它们有了一次真实的运行可以对照 ──────────────────────
     *
     * ★ 两条口径，刻意不同（这是本判据最重要的一处"不同形"）：
     *
     *   ① 静态说"这条命令看着有问题"（常量、空、拿 -x 比命令输出）
     *      ⇒ 跑一次看它是否真的【永远绿】。绿了 ⇒ blocked（它给不出信息）；
     *        红了 ⇒ 这一次的观察与静态分析一致（一条不可判的命令当然可能红），
     *        但仍不能据此说"它可判" —— 它只是这一次红。
     *      无论如何：**静态问题都要报**，因为它说的是一件与这一次运行无关的事实。
     *
     *   ② 命令自己声明了成功判据却写成常数（`true` / `false`）
     *      ⇒ 无论这一次的退出码是多少，blocked：退出码与工作无关。
     */
    if (staticProblems.length > 0) {
        const observed = new Map(runs.map((run) => [run.command, run.exitCode]));
        const lines = [];
        for (const command of suspects) {
            const exitCode = observed.get(command);
            const showsGreen = exitCode === 0;
            lines.push(`${staticProblems.filter((line) => line.startsWith(`"${command}"`)).join(' | ')}`
                + (exitCode === undefined
                    ? ' (it was not run)'
                    : showsGreen
                        ? ` — and it was run: it exited 0, so it also cannot fail`
                        : ` — it was run and exited ${exitCode} this once; that single run does not make it judgeable, and it does not tell us anything about the work either`));
        }
        blockers.push(`the contract declares verify command(s) that cannot judge the work: ${lines.join(' || ')}`);
    }
    if (blockers.length > 0) {
        return blocked(blockers, [
            `★ A verify command must be able to go green when the work was done and red when it was not; these cannot, so the task they belong to has no honest completion (and a contract whose own test can never pass pushes the member towards fabricating one).`,
            `If the intent really is "this condition must hold", write it as something that depends on the produced artifact (a file's contents, a test's exit code) rather than on a literal or on another command's whitespace.`,
        ]);
    }
    /**
     * ★ 通过时【也把跑过的证据交出去】：调用方可以把这次观察落进记录，
     *   而不是只留下"契约看着没问题"这句话（与 verify-rerun 交回 reruns 同构）。
     */
    return { ok: true, verifyProbe: runs.map((run) => ({ ...run, status: run.exitCode === 0 ? 'passed' : 'failed' })) };
}
