# Test Account Edit Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让测试账号编辑结果正确刷新，并在保存成功后关闭编辑卡片。

**Architecture:** 保留现有 Tauri 更新接口和列表刷新流程，只修正 `TestAccountsPanel` 的成功态转换。以组件测试覆盖原账号 ID、刷新后的新数据和编辑器关闭行为。

**Tech Stack:** React、TypeScript、Vitest、Testing Library

---

### Task 1: 修复编辑保存成功态

**Files:**
- Modify: `src/components/TestAccountsPanel.tsx`
- Test: `src/components/TestAccountsPanel.test.tsx`
- Modify: `README.md`

- [x] **Step 1: 写失败测试**

新增组件测试：编辑“员工 A”为“员工 A（已更新）”，断言 `updateTestAccount` 使用 `employee-a`，刷新列表后出现新名称，且“编辑测试账号”对话框消失。

- [x] **Step 2: 验证测试失败**

Run: `npm test -- --run src/components/TestAccountsPanel.test.tsx`

Expected: FAIL，编辑对话框保存后仍存在。

- [x] **Step 3: 实现最小修复**

在保存及列表刷新成功后调用已有 `closeEditor()`；失败分支不重置表单，保留用户输入。

- [x] **Step 4: 验证测试通过**

Run: `npm test -- --run src/components/TestAccountsPanel.test.tsx`

Expected: PASS。

- [x] **Step 5: 同步说明并做静态检查**

在 README 的测试账号说明中明确保存成功自动关闭、失败保留输入。

Run: `npm run build`

Expected: PASS。
