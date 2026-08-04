# 测试设计滚动、删除与日志布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让测试设计右侧工作区和执行日志独立滚动，并让检查阶段删除的用例同步从回归套件及下一步移除。

**Architecture:** 保持 `TestCases` 为四步向导的状态所有者。删除操作同时更新 `cases` 和 `suites` 两个已有状态并调用现有持久化函数；布局仅通过响应式网格、视口高度约束和滚动容器调整，不新增数据模型或后端命令。

**Tech Stack:** React 19、TypeScript、Tailwind CSS 4、Vitest、Testing Library。

---

### Task 1: 删除用例并同步回归套件

**Files:**
- Modify: `src/pages/TestCases.test.tsx`
- Modify: `src/pages/TestCases.tsx`

- [ ] **Step 1: 写删除同步失败测试**

加载两条已确认用例和一个同时包含两条用例的套件，进入检查确认，确认删除第一条后断言：

```tsx
expect(window.confirm).toHaveBeenCalledWith('确认删除流程“Draft case”？删除后会同步从回归套件移除。')
expect(saveTestCases).toHaveBeenCalledWith([remainingCase])
expect(upsertSuite).toHaveBeenCalledWith({ ...suite, caseIds: [remainingCase.id] })
expect(screen.queryByText('Draft case')).not.toBeInTheDocument()
```

- [ ] **Step 2: 运行测试并确认旧实现失败**

运行：`node_modules/.bin/vitest.cmd run src/pages/TestCases.test.tsx`

期望：失败，页面不存在“删除流程 Draft case”按钮。

- [ ] **Step 3: 实现最小删除逻辑**

在 `TestCases.tsx` 引入 `Trash2`，新增：

```tsx
const handleDeleteCase = (testCase: TestCase) => {
  if (!window.confirm(`确认删除流程“${testCase.title}”？删除后会同步从回归套件移除。`)) return;
  const nextCases = cases.filter((item) => item.id !== testCase.id);
  const nextSuites = suites.map((suite) => suite.caseIds.includes(testCase.id)
    ? { ...suite, caseIds: suite.caseIds.filter((caseId) => caseId !== testCase.id) }
    : suite);
  refreshCases(nextCases);
  nextSuites
    .filter((suite, index) => suite !== suites[index])
    .forEach((suite) => upsertSuite(suite));
  setSuites(nextSuites);
  setConvertedCaseIds((current) => {
    const next = new Set(current);
    next.delete(testCase.id);
    return next;
  });
};
```

在检查模式的卡片操作区加入图标按钮：

```tsx
{!executionActions && (
  <button type="button" aria-label={`删除流程 ${testCase.title}`} onClick={() => handleDeleteCase(testCase)}>
    <Trash2 className="h-3.5 w-3.5" />
  </button>
)}
```

- [ ] **Step 4: 增加取消删除和最后一条已确认用例测试**

分别断言 `window.confirm` 返回 `false` 时不调用 `saveTestCases`；删除最后一条已确认用例后第 4 步按钮重新禁用。

- [ ] **Step 5: 运行定向测试**

运行：`node_modules/.bin/vitest.cmd run src/pages/TestCases.test.tsx`

期望：新增和现有向导测试全部通过。

### Task 2: 右侧工作区和日志侧栏布局

**Files:**
- Modify: `src/pages/TestCases.test.tsx`
- Modify: `src/pages/TestCases.tsx`

- [ ] **Step 1: 写布局语义失败测试**

为右侧工作区、回归用例列表和日志侧栏增加稳定的 `aria-label`，测试进入第 4 步后断言：

```tsx
expect(screen.getByLabelText('测试设计工作区')).toHaveClass('overflow-y-auto')
expect(screen.getByLabelText('回归用例列表')).toBeVisible()
expect(screen.getByLabelText('最近执行日志')).toHaveTextContent('尚未执行用例')
```

- [ ] **Step 2: 运行测试并确认旧实现失败**

运行：`node_modules/.bin/vitest.cmd run src/pages/TestCases.test.tsx`

期望：失败，旧页面没有独立工作区和常驻日志区域。

- [ ] **Step 3: 实现视口内滚动工作区**

将页面外层改为 `min-h-0 overflow-hidden`，桌面网格使用 `min-h-0`；左侧导航增加 `lg:sticky lg:top-0 lg:self-start`，右侧步骤区域增加：

```tsx
<section
  aria-label="测试设计工作区"
  className="min-h-0 min-w-0 space-y-4 overflow-y-auto rounded-2xl border border-border bg-surface-1/80 p-5 glow lg:max-h-[calc(100vh-12rem)]"
>
```

- [ ] **Step 4: 实现回归双栏与常驻日志**

套件区下方使用 `xl:grid-cols-[minmax(0,1fr)_360px]`。左侧 `aria-label="回归用例列表"` 独立滚动；右侧日志区始终渲染：

```tsx
<section aria-label="最近执行日志" className="min-h-48 max-h-[32rem] overflow-y-auto rounded-xl border border-border bg-[#070b16] p-4 font-mono text-[11px] text-slate-300">
  <div className="mb-3 text-xs font-bold text-white">最近执行日志</div>
  {runLog.length === 0
    ? <p className="font-sans text-text-muted">尚未执行用例，执行过程会实时显示在这里。</p>
    : runLog.slice(-50).map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
</section>
```

移动端保持套件、日志、用例列表的顺序，避免日志再次落到长列表末尾。

- [ ] **Step 5: 运行定向测试和 TypeScript 构建**

运行：

```powershell
node_modules/.bin/vitest.cmd run src/pages/TestCases.test.tsx
node_modules/.bin/tsc.cmd -b
```

期望：测试与类型检查通过。

### Task 3: 文档与最终验证

**Files:**
- Modify: `README.md`
- Modify: `开发文档.md`

- [ ] **Step 1: 同步当前行为**

在 README 的测试设计能力中补充检查阶段可删除流程、套件同步和执行日志侧栏；在开发文档的 `TestCases` 状态说明中记录删除同时更新 `cases` 与 `suites`。

- [ ] **Step 2: 搜索过时描述**

运行：

```powershell
rg -n "执行日志|检查确认|回归执行" README.md 开发文档.md src/pages/TestCases.tsx
```

确认没有“日志仅在列表末尾显示”或“已确认用例不可删除”的描述。

- [ ] **Step 3: 完整验证**

运行：

```powershell
node_modules/.bin/vitest.cmd run src/pages/TestCases.test.tsx
node_modules/.bin/tsc.cmd -b
node_modules/.bin/vite.cmd build
git diff --check
```

期望：测试、类型检查、生产构建和差异检查通过；Vite 既有大分块警告不作为失败。
