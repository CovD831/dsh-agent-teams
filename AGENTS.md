# Project maintenance skills

Before using a DSH plugin lifecycle skill in this repository, read `skills/README.md` for its source, version, and project-specific applicability. Prefer the project copy when a global skill has the same name.

Vendored skills are community guidance. Historical version examples are not the current support policy; verify exact Harness tags, npm artifacts, the resolved dependency graph, and AgentTeams behavior. Preserve upstream skill files; record local integration rules separately.

User instructions and authorization take precedence over skill defaults. Do not repeat confirmation for work the user has already authorized.

# Browser automation

For interactive browser automation, use the `ego-browser` skill from Ego Lite. Do not use `agent-browser` or another browser-control skill unless the user explicitly requests it or Ego Lite is unavailable.

# 需求捕获（`docs/REQUIREMENTS.md`）

本仓**已有** `docs/REQUIREMENTS.md`。全局指令要求：对话中形成的**新需求、需求变更、
设计原则、或被推翻的旧判断**，应在当轮结束前提案追加到该文档，由用户确认或否决。

## 什么该提案

```
✅ 用户明确裁定的设计原则（★ 附原话）
✅ 被推翻的旧判断（★ 写明"旧的是什么、为什么推翻"）
✅ 需求变更（★ 写明影响面）
❌ 一次性排期 · 尚未裁定的提案 ⇒ 那些进 docs/DECISIONS-PENDING.md
```

## 格式（每条三格，缺一不可）

```markdown
## N. ★ 一句话说清这条需求

> 「★ 用户原话逐字 —— 引用，不改写」

**判据**:为什么它是需求（用户原话 / 可复跑读数）
**现状**:✅ 已实现 / ⚠️ 部分 / ⬜ 未实现 / ❌ 已推翻
**证据**:文件路径 或 可复跑命令
```

## 两条纪律

```
★ 不许把"计划"写成"需求" —— 需求是【已裁定】的，计划是【待做】的
★★ 每条都要能回答「它是否还在生效」——
   否则文档会变成一份读完不知道哪些还算数的清单
```

## 相关文档的分工

```
docs/REQUIREMENTS.md        已裁定的需求（★ 可被 workbench-align 对齐）
docs/DECISIONS-PENDING.md   尚未裁定的提案（★ 需要人拍板）
docs/*-SPEC.md / *-PLAN.md  专题设计（★ 细节，不是需求本身）
docs/DEFECT-*.md            已记账的缺陷（★ 有根因与反向半边）
```
