---
name: git-commit-conventions
description: Use whenever creating, amending, rewording, squashing, proposing, or reporting a Git commit for LogicGuard AI. Enforces Chinese commit subjects, bodies, and user-facing commit descriptions.
---

# 中文 Git 提交规范

这是 LogicGuard AI 项目的硬性提交规则。

## 硬性要求

1. 每次创建、修改、合并或建议 Git 提交前，都必须使用本技能。
2. 提交标题和正文必须使用中文，不得使用英文提交说明。
3. 类型前缀也使用中文，例如 `修复：`、`功能：`、`维护：`、`文档：`、`测试：`、`重构：`。
4. 代码标识符、文件路径、命令、依赖名和产品专有名词可以保留原文。
5. 提交前检查 `git status --short` 和 `git diff --cached`，确保说明准确覆盖暂存内容。
6. 向用户汇报提交结果时，提交内容摘要也必须使用中文。

若仓库工具强制要求其他格式，提交前先说明冲突，不得静默违反本规则。
