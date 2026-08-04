# Requirement Modeler Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将需求文档建模页改为与 LogicGuard AI 一致的浅色居中向导，同时保持现有业务行为不变。

**Architecture:** 保留 `RequirementModeler` 的全部状态和事件处理，只替换 JSX 的视觉结构与 Tailwind 类。横向步骤条直接由现有 `step`、`highestStep` 和 `busy` 派生，不引入新状态或组件边界。

**Tech Stack:** React 19、TypeScript、Tailwind CSS 4、Lucide React、Vitest、Testing Library

---

### Task 1: 锁定统一视觉结构

**Files:**
- Modify: `src/pages/RequirementModeler.test.tsx`
- Test: `src/pages/RequirementModeler.test.tsx`

- [ ] **Step 1: 写入失败的视觉结构测试**

在 `describe('RequirementModeler')` 中加入：

```tsx
it('uses the shared light workspace style with a horizontal stepper', () => {
  render(<RequirementModeler onCancel={vi.fn()} onSaved={vi.fn()} />)

  const region = screen.getByRole('region', { name: '需求文档建模' })
  expect(region).toHaveClass('bg-surface-1', 'text-text-primary')
  expect(region).not.toHaveClass('bg-slate-950', 'text-slate-100')
  expect(screen.getByRole('heading', { name: '需求文档建模' })).toBeVisible()
  expect(screen.getByRole('navigation', { name: '建模步骤' })).toHaveClass(
    'overflow-x-auto',
  )
})
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `npm test -- src/pages/RequirementModeler.test.tsx -t "uses the shared light workspace style"`

Expected: FAIL，因为现有 section 没有可访问名称，且标题和深色样式仍为旧实现。

- [ ] **Step 3: 保留失败证据并进入最小实现**

不修改既有行为测试和 mock；仅用这条测试约束本次视觉结构。

### Task 2: 实现居中浅色向导

**Files:**
- Modify: `src/pages/RequirementModeler.tsx`
- Test: `src/pages/RequirementModeler.test.tsx`

- [ ] **Step 1: 引入现有图标并定义步骤图标**

添加 Lucide 导入，并将每一步映射到图标：

```tsx
import {
  ArrowLeft,
  Check,
  FileSearch,
  Globe2,
  Link2,
  Save,
  Search,
  Sparkles,
} from 'lucide-react'

const stepIcons = {
  1: Link2,
  2: Search,
  3: Globe2,
  4: Sparkles,
} satisfies Record<ModelerStep, typeof Link2>
```

- [ ] **Step 2: 替换页面外壳和标题栏**

将根节点改为带可访问标题的滚动浅色区域：

```tsx
<section
  aria-labelledby="requirement-modeler-title"
  className="h-full overflow-y-auto bg-surface-1 text-text-primary"
>
  <div className="mx-auto w-full max-w-5xl px-5 py-5 sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
      <div>
        <h1 id="requirement-modeler-title" className="text-lg font-bold text-text-primary">
          需求文档建模
        </h1>
        <p className="mt-1 text-xs text-text-muted">从网页提取需求正文并生成可复用的场景模板</p>
      </div>
      <button type="button" onClick={onCancel} className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 text-xs font-semibold text-text-secondary hover:border-border-hover hover:text-text-primary">
        <ArrowLeft className="h-3.5 w-3.5" />
        返回测试设计
      </button>
    </header>
```

- [ ] **Step 3: 将左侧步骤栏改为横向步骤条**

导航使用固定最小宽度和水平滚动；当前、完成、锁定状态分别使用品牌色、成功色和弱化表面：

```tsx
<nav aria-label="建模步骤" className="overflow-x-auto border-b border-border py-4">
  <ol className="grid min-w-[640px] grid-cols-4 gap-2">
    {([1, 2, 3, 4] as ModelerStep[]).map(item => {
      const active = step === item
      const completed = item < highestStep
      const Icon = stepIcons[item]
      return (
        <li key={item}>
          <button
            type="button"
            aria-current={active ? 'step' : undefined}
            disabled={busy !== null || item > highestStep}
            onClick={() => goTo(item)}
            className={`flex h-14 w-full items-center gap-2 rounded-lg border px-3 text-left transition-colors ${
              active
                ? 'border-brand-500/30 bg-brand-500/10 text-brand-600'
                : completed
                  ? 'border-success/20 bg-success/5 text-text-secondary'
                  : item > highestStep
                    ? 'border-border bg-surface-2/50 text-text-muted opacity-50'
                    : 'border-border bg-surface-2 text-text-secondary hover:border-brand-500/30'
            }`}
          >
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${active ? 'bg-brand-500 text-white' : completed ? 'bg-success/10 text-success' : 'bg-surface-3 text-text-muted'}`}>
              {completed ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
            </span>
            <span><span className="block text-[10px] opacity-70">步骤 {item}</span><span className="block text-xs font-semibold">{stepLabels[item]}</span></span>
          </button>
        </li>
      )
    })}
  </ol>
</nav>
```

- [ ] **Step 4: 统一居中表单和控件样式**

使用 `mx-auto max-w-2xl py-6` 包裹步骤内容。标题使用 `text-base font-bold`；字段标签使用 `text-xs font-semibold text-text-secondary`；输入框和文本域统一使用：

```tsx
className="w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-brand-500 disabled:opacity-50"
```

单行输入增加 `h-10`，文本域保留稳定最小高度。主按钮统一使用：

```tsx
className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-4 text-xs font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
```

次要按钮使用 `border-border bg-surface-2 text-text-secondary`。操作区使用 `flex flex-wrap items-center gap-3`，避免窄屏文字重叠。

- [ ] **Step 5: 统一反馈和草稿编辑区**

将错误改为 `border-error/20 bg-error/10 text-error`，警告改为 `border-warning/20 bg-warning/10 text-warning`，状态改为 `border-brand-500/20 bg-brand-500/10 text-brand-600`。草稿 `fieldset` 使用 `border-border bg-surface-2/40`，保存按钮使用主品牌色并配 `Save` 图标；抓取和 AI 操作分别配 `FileSearch`、`Sparkles` 图标。

- [ ] **Step 6: 运行目标测试并确认通过**

Run: `npm test -- src/pages/RequirementModeler.test.tsx`

Expected: 目标视觉测试和全部既有建模流程测试 PASS。

### Task 3: 验证回归与实际布局

**Files:**
- Verify: `src/pages/RequirementModeler.tsx`
- Verify: `src/pages/RequirementModeler.test.tsx`

- [ ] **Step 1: 运行静态检查和构建**

Run: `npm run check`

Expected: ESLint 与 TypeScript/Vite build 均以 exit code 0 完成。

- [ ] **Step 2: 启动本地开发服务器**

Run: `npm run dev -- --host 127.0.0.1`

Expected: Vite 输出可访问的本地 URL，保持进程运行用于浏览器检查。

- [ ] **Step 3: 检查桌面视口**

使用 1440x900 视口打开应用，进入“测试设计”并点击“从需求文档建模”。确认横向四步完整可见、编辑区居中、无深色残留、文字和按钮不重叠，并保存截图。

- [ ] **Step 4: 检查窄屏视口**

使用 768x900 视口复查同一路径。确认步骤条可横向滚动、标题栏与操作区正常换行、页面纵向可滚动，并保存截图。

- [ ] **Step 5: 检查变更范围与文档影响**

Run: `git diff --check && git status --short`

Expected: 仅包含 `RequirementModeler.tsx`、对应测试和本实施计划；项目说明文档无需更新，因为流程、配置、接口、依赖和运行要求均未变化。
