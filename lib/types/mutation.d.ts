/**
 * ── 变异测试：证明"测试真的在测" ────────────────────────────────────────────────
 *
 * ★ 本文件是**再导出桶**（barrel）—— M2 拆分后它只做一件事：
 *   把 `src/mutation/` 下四块的导出**原样**再导出，保持对外面（唯一消费者
 *   `src/gates/completion/mutation.ts`）的 import 路径与导出面**逐条不变**。
 *
 * ── 四块（依赖是一条 DAG，B1 ← B2 ← B3 ← B4，无环）──────────────────────────────
 *
 *   `./mutation/operators.ts`  L1/L2 算子目录与常量（**零依赖**）
 *   `./mutation/generate.ts`   变异体生成与去噪（依赖 operators）
 *   `./mutation/suite.ts`      测试套件判读（依赖 operators / generate 的类型）
 *   `./mutation/coverage.ts`   覆盖率解析与打分 / 引擎（依赖以上三块）
 *
 * ★ 为什么要拆：M1 模块地图实测本文件 1692 行（**1088 行代码 + 大量实测注释**）
 *   混装了 4 件事；而它是 **fork 全新文件**（上游 `upstream/main` 上 ABSENT）
 *   ⇒ 拆分对上游冲突面**零影响**，是最安全的一块。
 *
 * ★ 为什么桶要保留：`grep -rn "from '.*mutation\.ts'" src/` ⇒ 唯一消费者是
 *   `src/gates/completion/mutation.ts`（它按 `'../../mutation.ts'` 取 21 个符号）。
 *   保留桶 ⇒ **改拆分不动那 21 个 import**，也让"导出集合逐条相等"这条验收
 *   可以由一次 `grep` 直接对拍（见 `docs/MODULE-MAP.md`）。
 *
 * ★ 本文件**不含任何实现**：任何新增实现都应进 `./mutation/` 下的对应块，
 *   而不是加在这里 —— 否则桶会重新长成"混装件"。
 */
export type { MutationOperator, MutantOutcome, MutationLayer, } from './mutation/operators.ts';
export { DEFAULT_MAX_MUTANTS, DEFAULT_MAX_PER_OPERATOR, DEFAULT_OPERATORS, L1_OPERATORS, L2_OPERATORS, MIN_SCORED_FOR_VERDICT, OFTEN_EQUIVALENT, } from './mutation/operators.ts';
export type { GenerateOptions, InvariantDefinition, LineRange, Mutant, MutantInvariant, MutantResult, MutantRun, MutationTarget, SuiteTarget, } from './mutation/generate.ts';
export { capMutants, generateMutants, isChangedLine, isInsideComment, isInsideString, isSkippableOccurrence, lineOf, loadInvariants, verifyAnchors, } from './mutation/generate.ts';
export type { ProbeReach, TestSummary, } from './mutation/suite.ts';
export { classifyRun, failingFiles, parseTestSummary, probeReach, } from './mutation/suite.ts';
export type { CoverageFileReading, ExpectRedViolation, LayerScore, MutationCoverage, MutationEngineInput, MutationReport, MutationTotals, ScoreInput, SurvivingMutant, LineCoverageReading, MutationDisposition, } from './mutation/coverage.ts';
export { runMutationEngine, coverageUnmeasured, isDecorative, matchCoverageFile, mirrorMutants, noScorableMutants, parseNodeCoverageReport, parsePerTestCoverageBlock, readExplicitExecutedLines, readExplicitTestsByLine, resolveMutationCoverage, scoreMutants, } from './mutation/coverage.ts';
