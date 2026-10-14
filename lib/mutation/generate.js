import { DEFAULT_MAX_PER_OPERATOR, DEFAULT_OPERATORS, OFTEN_EQUIVALENT, } from "./operators.js";
export function capMutants(items, max) {
    if (!Number.isFinite(max) || max <= 0)
        return [...items];
    if (items.length <= max)
        return [...items];
    const step = items.length / max;
    const out = [];
    for (let index = 0; index < max; index += 1) {
        const at = Math.floor(index * step);
        const item = items[at];
        if (item !== undefined)
            out.push(item);
    }
    return out;
}
// ─────────────────────────────────────────────────────────────────────────────
// 生成
// ─────────────────────────────────────────────────────────────────────────────
/** 1-based, inclusive. 行号按 `\n` 数，与 git diff 的语义一致。 */
export function lineOf(text, index) {
    let line = 1;
    for (let i = 0; i < index && i < text.length; i += 1)
        if (text[i] === '\n')
            line += 1;
    return line;
}
/** 某一行是否在【改动行】集合里。改动的定义来自调用方（git 证据，不是猜的）。 */
export function isChangedLine(line, changedLines) {
    if (changedLines === undefined)
        return true;
    return changedLines.includes(line);
}
/**
 * 近似但保守的注释判定：`index` 是否落在一段 // 或 /* *\/ 注释里。
 *
 * 为什么要它：把注释里的 `+` 改成 `-` 生成的不是变异体，是【文本编辑】——
 * 它【永远不会红】，于是它必然"存活"，于是覆盖率被一堆假存活体拉低。
 * 这不是保守的方向，这是把噪声当信号。
 */
export function isInsideComment(text, index) {
    const lineStart = text.lastIndexOf('\n', index - 1) + 1;
    let inString = null;
    for (let i = lineStart; i < index; i += 1) {
        const ch = text[i];
        if (inString !== null) {
            if (ch === '\\')
                i += 1;
            else if (ch === inString)
                inString = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            inString = ch;
            continue;
        }
        if (ch === '/' && text[i + 1] === '/')
            return true;
        if (ch === '/' && text[i + 1] === '*') {
            const close = text.indexOf('*/', i + 2);
            if (close === -1 || close > index)
                return true;
            i = close + 1;
        }
    }
    const blockOpen = text.lastIndexOf('/*', index);
    if (blockOpen !== -1) {
        const blockClose = text.lastIndexOf('*/', index);
        if (blockClose < blockOpen)
            return true;
    }
    return false;
}
/** 同一行内 `index` 之前有没有未闭合的引号 ⇒ 它在字符串字面量里。 */
export function isInsideString(text, index) {
    const lineStart = text.lastIndexOf('\n', index - 1) + 1;
    let inString = null;
    for (let i = lineStart; i < index; i += 1) {
        const ch = text[i];
        if (inString !== null) {
            if (ch === '\\')
                i += 1;
            else if (ch === inString)
                inString = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`')
            inString = ch;
    }
    return inString !== null;
}
/**
 * 这个出现位置该不该跳过？
 *
 * ★ 理由不是"避免误报"，是【一个语法错误也会变红】—— 而那种红证明不了任何关于
 *   断言的事。把语法错误算成"测试杀死了变异体"，是在给覆盖率注水。
 *
 * ★ MEASURED（本任务夹具抓到的真实缺陷）：`after` 必须从 `index + operator.length`
 *   起算，不能从 `index` 起算。第一版写的是 `text.slice(index, index + 3)` ——
 *   那个切片【永远以算子自身开头】，于是 `after.startsWith('=')` 对 `>=` 判断的是
 *   "`>` 后面是不是 `=`"（对），但对【单独一个 `>`】（如 `return value > 0`）判断的
 *   是"`>` 后面是不是 `>`" —— 永远为真 ⇒ **`gt-to-ge` 一条都生不出来**。
 *   实测后果：`value > 0` 这种最常见的边界比较完全进不了分母，而报告读起来
 *   与"这里没有被覆盖"完全同形。这是"算子静默失效"，不是"没有可变异的东西"。
 */
export function isSkippableOccurrence(operatorId, text, index) {
    const before = text.slice(Math.max(0, index - 2), index);
    /** 算子【之后】的文本。长度按各算子取，见下面每个 case 的注释。 */
    const restAfter = (length) => text.slice(index + length, index + length + 3);
    const lengthOf = (id) => {
        switch (id) {
            case 'plus-to-minus':
            case 'true-to-false':
                return 4;
            case 'false-to-true':
                return 5;
            case 'seq-to-sneq':
            case 'sneq-to-seq':
                return 3;
            case 'nullish-to-or':
                return 2;
            default:
                return 1;
        }
    };
    const after = restAfter(lengthOf(operatorId));
    if (isInsideComment(text, index))
        return true;
    switch (operatorId) {
        case 'plus-to-minus':
            // `++` / `+=` 不是我们想变的那个二元 `+`
            if (before.endsWith('+') || after.startsWith('+'))
                return true;
            break;
        case 'ge-to-gt':
            // `>>=`：`>=` 前面还有一个 `>`
            if (before.endsWith('>'))
                return true;
            break;
        case 'gt-to-ge':
            // `>=` / `>>` 是另一种算子；`=>`（箭头函数）不是比较
            if (before.endsWith('=') || after.startsWith('=') || after.startsWith('>'))
                return true;
            break;
        case 'le-to-lt':
            // `<<=`：`<=` 前面还有一个 `<`
            if (before.endsWith('<'))
                return true;
            break;
        case 'lt-to-le':
            // `<=` / `<<`
            if (after.startsWith('=') || after.startsWith('<'))
                return true;
            break;
        case 'and-to-or':
        case 'or-to-and':
            // `&&=` / `||=`
            if (after.startsWith('='))
                return true;
            break;
        case 'seq-to-sneq':
        case 'sneq-to-seq':
            // `====`（多余等号）或 `!==` 里的 `===`
            if (before.endsWith('=') || before.endsWith('!'))
                return true;
            break;
        case 'nullish-to-or':
            // `??=`、`?.` 都与 `??` 不是一回事
            if (after.startsWith('=') || after.startsWith('.'))
                return true;
            break;
        case 'true-to-false':
            // 标识符的一部分（`isTrue` / `trueValue`）不是布尔字面量
            if (/[\w$]/.test(before.slice(-1)) || /[\w$]/.test(after.slice(0, 1)))
                return true;
            break;
        case 'false-to-true':
            if (/[\w$]/.test(before.slice(-1)) || /[\w$]/.test(after.slice(0, 1)))
                return true;
            break;
        case 'await-dropped':
            /**
             * `await ` 出现在注释或字符串里已经被上面拦下。这里只拦一种：
             * 它前面紧挨着 `.`（如 `x.await `）不合法，保留判断即可。
             */
            break;
        default:
            break;
    }
    // ★ 字符串字面量里的符号是【数据】不是逻辑：改它不会改变任何行为。
    if (isInsideString(text, index))
        return true;
    return false;
}
/**
 * 在【改动行范围】内生成 L1/L2 变异体。
 *
 * ★ R1 是这样落地的：`startLine..endLine` 先过滤行号，`changedLines` 再过滤改动。
 *   两者都缺席时才会变异整个文件 —— 而调用方（判据）在拿不到 git 证据时【不是】
 *   退回全文件，而是 unmeasured。不让机制层替它做这个决定。
 */
export function generateMutants(source, options) {
    const { startLine, endLine, changedLines, operators = DEFAULT_OPERATORS, 
    /**
     * ★ 2026-10-12：25 → {@link DEFAULT_MAX_PER_OPERATOR}（4）。
     *   25 × 13 算子 = 325 条/文件，而每条要重跑一遍杀手套件 —— 那是 t34 事故里
     *   2.2 小时/attempt 的算术来源。★ 这个缺省值只影响**没显式传**的调用方；
     *   判据侧另有独立的总量上限（`DEFAULT_MAX_MUTANTS`）。
     */
    maxPerOperator = DEFAULT_MAX_PER_OPERATOR, file, } = options;
    const mutants = [];
    for (const op of operators) {
        let from = 0;
        let emitted = 0;
        while (emitted < maxPerOperator) {
            const index = source.indexOf(op.find, from);
            if (index === -1)
                break;
            from = index + op.find.length;
            const line = lineOf(source, index);
            if (line < startLine || line > endLine)
                continue;
            if (!isChangedLine(line, changedLines))
                continue;
            if (isSkippableOccurrence(op.id, source, index))
                continue;
            mutants.push({
                id: `${op.id}@L${line}`,
                layer: op.layer,
                operator: op.id,
                kind: op.kind,
                ...(file === undefined ? {} : { file }),
                line,
                find: op.find,
                replace: op.replace,
                mutated: source.slice(0, index) + op.replace + source.slice(index + op.find.length),
                oftenEquivalent: OFTEN_EQUIVALENT.has(op.id),
            });
            emitted += 1;
        }
    }
    return mutants;
}
/**
 * 把【声明的】L3 契约违反体载成变异体。
 *
 * ★ 声明缺件是【错误】而不是跳过：静默跳过一个坏定义，等于报告一份"L3 全覆盖"
 *   而 L3 一个都没测 —— 这与本文件存在的理由（证明测试真的在测）直接冲突。
 */
export function loadInvariants(definitions) {
    const errors = [];
    const mutants = [];
    for (const def of definitions) {
        const label = def.id === undefined || def.id === '' ? '<no id>' : def.id;
        for (const field of ['id', 'invariant', 'contract', 'file']) {
            if (def[field] === undefined || def[field] === '')
                errors.push(`invariant ${label}: missing required field "${field}"`);
        }
        if (def.mutate?.find === undefined || def.mutate.find === '' || def.mutate.replace === undefined) {
            errors.push(`invariant ${label}: mutate requires { find, replace }`);
            continue;
        }
        mutants.push({
            id: `L3:${label}`,
            layer: 'L3',
            operator: `L3:${label}`,
            kind: 'contract',
            file: def.file,
            find: def.mutate.find,
            replace: def.mutate.replace,
            oftenEquivalent: false,
            invariant: def.invariant,
            contract: def.contract,
            ...(def.expect_red === undefined ? {} : { expectRed: def.expect_red }),
            ...(def.expect_red_exact === undefined ? {} : { expectRedExact: def.expect_red_exact }),
        });
    }
    return { mutants, errors };
}
/**
 * 核对每个 L3 因子的锚点【真的在它声明的文件里】。
 *
 * ★ 锚点找不到 ⇒ 硬错误。静默跳过它，就会在"契约被删了/片段漂移了"的时候
 *   报告一份满分的 L3 覆盖 —— 那正好是我们最该看见的那次失效。
 */
export function verifyAnchors(mutants, readFile) {
    const problems = [];
    for (const mutant of mutants) {
        if (mutant.layer !== 'L3')
            continue;
        const file = mutant.file ?? '';
        let text;
        try {
            text = readFile(file);
        }
        catch (error) {
            problems.push(`invariant ${mutant.id}: cannot read ${file} (${error instanceof Error ? error.message : String(error)})`);
            continue;
        }
        const count = countOccurrences(text, mutant.find);
        if (count === 0) {
            problems.push(`invariant ${mutant.id}: anchor not found in ${file}. 契约 "${mutant.contract ?? ''}" 声称 ${mutant.invariant ?? ''} 被守着，` +
                `而代码里已经没有这段文本了 —— 契约被删了，或片段漂移了。这必须被解决，不能被跳过。`);
        }
        else if (count > 1) {
            problems.push(`invariant ${mutant.id}: anchor appears ${count} times in ${file}; expected exactly 1（歧义锚点让变异不可复现）`);
        }
    }
    return problems;
}
function countOccurrences(text, needle) {
    let count = 0;
    let from = 0;
    for (;;) {
        const index = text.indexOf(needle, from);
        if (index === -1)
            break;
        count += 1;
        from = index + needle.length;
    }
    return count;
}
// ─────────────────────────────────────────────────────────────────────────────
// ★ 探针射程：杀手套件够不到被变异文件
// ─────────────────────────────────────────────────────────────────────────────
