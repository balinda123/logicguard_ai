# Test Design Guided Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hidden legacy template workspace with ordered, reversible test-design and requirement-modeling wizards.

**Architecture:** `TestCases` owns cases, suites, templates, and the main wizard. A focused `RequirementModeler` child owns URL navigation, keyword filtering, extraction, AI modeling, and saving. Pure rules in `testDesignWizard.ts` define validation and step locking for unit tests.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest, Testing Library, Tauri invoke bridge, Tailwind CSS 4.

## Global Constraints

- Preserve existing `ScenarioTemplate`, `TestCase`, and `RegressionSuite` formats.
- Preserve direct and template-based case generation.
- Only confirmed cases may join suites or execute.
- Accept only HTTP(S) requirement URLs.
- Call `browserNavigate(url)` before `getPageContent(keyword)`.
- Back navigation preserves entered/generated state.
- URL or keyword changes invalidate captured text and drafts.
- Do not change Tauri commands, sidecar protocol, auth, CDP configuration, or model prompts.
- Preserve unrelated uncommitted user changes.

---

### Task 1: Frontend test harness and pure wizard rules

**Files:**
- Modify: `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.app.json`
- Create: `src/test/setup.ts`, `src/pages/testDesignWizard.ts`
- Test: `src/pages/testDesignWizard.test.ts`

**Interfaces:**
- Produces: `TestDesignStep`, `ModelerStep`, `isHttpUrl`, `highestUnlockedTestDesignStep`, `clampTestDesignStep`, `invalidateAfterRequirementChange`

- [ ] **Step 1: Install test dependencies and add the script**

Run:

```powershell
npm install --save-dev vitest@^3.2.4 jsdom@^26.1.0 @testing-library/react@^16.3.0 @testing-library/jest-dom@^6.6.3 @testing-library/user-event@^14.6.1
```

Add `"test": "vitest run"` to `package.json`. Expected: only dev dependencies change.

- [ ] **Step 2: Configure Vitest**

Import `defineConfig` from `vitest/config` in `vite.config.ts` and add:

```ts
test: {
  environment: 'jsdom',
  setupFiles: ['./src/test/setup.ts'],
  clearMocks: true,
},
```

Add `vitest/globals` and `@testing-library/jest-dom` to `tsconfig.app.json` types. Create `src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 3: Write the failing rule tests**

Create `src/pages/testDesignWizard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clampTestDesignStep, highestUnlockedTestDesignStep, invalidateAfterRequirementChange, isHttpUrl } from './testDesignWizard';

describe('test design wizard rules', () => {
  it('accepts only HTTP and HTTPS URLs', () => {
    expect(isHttpUrl('https://example.com/spec')).toBe(true);
    expect(isHttpUrl('http://localhost:3000/spec')).toBe(true);
    expect(isHttpUrl('example.com/spec')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
  });

  it('unlocks steps in strict order', () => {
    expect(highestUnlockedTestDesignStep({ hasRequirement: false, hasCases: false, hasConfirmedCases: false })).toBe(1);
    expect(highestUnlockedTestDesignStep({ hasRequirement: true, hasCases: false, hasConfirmedCases: false })).toBe(2);
    expect(highestUnlockedTestDesignStep({ hasRequirement: true, hasCases: true, hasConfirmedCases: false })).toBe(3);
    expect(highestUnlockedTestDesignStep({ hasRequirement: true, hasCases: true, hasConfirmedCases: true })).toBe(4);
  });

  it('blocks forward jumps but permits returning', () => {
    expect(clampTestDesignStep(4, 2)).toBe(2);
    expect(clampTestDesignStep(1, 4)).toBe(1);
  });

  it('invalidates downstream completion after requirement changes', () => {
    expect(invalidateAfterRequirementChange({ generated: true, reviewed: true, executionReady: true })).toEqual({ generated: false, reviewed: false, executionReady: false });
  });
});
```

- [ ] **Step 4: Verify RED**

Run: `npm test -- src/pages/testDesignWizard.test.ts`

Expected: FAIL because `testDesignWizard.ts` does not exist.

- [ ] **Step 5: Implement the rules**

Create `src/pages/testDesignWizard.ts`:

```ts
export type TestDesignStep = 1 | 2 | 3 | 4;
export type ModelerStep = 1 | 2 | 3 | 4;

export interface WizardCompletionState {
  generated: boolean;
  reviewed: boolean;
  executionReady: boolean;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function highestUnlockedTestDesignStep(input: { hasRequirement: boolean; hasCases: boolean; hasConfirmedCases: boolean }): TestDesignStep {
  if (!input.hasRequirement) return 1;
  if (!input.hasCases) return 2;
  if (!input.hasConfirmedCases) return 3;
  return 4;
}

export function clampTestDesignStep(requested: TestDesignStep, highest: TestDesignStep): TestDesignStep {
  return Math.min(requested, highest) as TestDesignStep;
}

export function invalidateAfterRequirementChange(_state: WizardCompletionState): WizardCompletionState {
  return { generated: false, reviewed: false, executionReady: false };
}
```

- [ ] **Step 6: Verify GREEN and commit**

Run: `npm test -- src/pages/testDesignWizard.test.ts` (expected: 4 PASS), then `npm run lint` (expected: exit 0).

```powershell
git add package.json package-lock.json vite.config.ts tsconfig.app.json src/test/setup.ts src/pages/testDesignWizard.ts src/pages/testDesignWizard.test.ts
git commit -m "test: add guided workflow state coverage"
```

---

### Task 2: Ordered requirement-modeling child wizard

**Files:**
- Create: `src/pages/RequirementModeler.tsx`
- Test: `src/pages/RequirementModeler.test.tsx`

**Interfaces:**
- Consumes: `browserNavigate`, `getPageContent`, `generateTemplateFromDocument`, `saveCustomTemplate`
- Produces: `RequirementModelerProps { onCancel(): void; onSaved(template: ScenarioTemplate): void }`

- [ ] **Step 1: Write failing component tests**

Mock browser/template APIs. The primary test must assert exact order and preserved backward state:

```ts
it('navigates before extraction and preserves backward state', async () => {
  const user = userEvent.setup();
  render(<RequirementModeler onCancel={vi.fn()} onSaved={vi.fn()} />);
  await user.type(screen.getByLabelText('需求文档网址'), 'https://example.com/spec');
  await user.click(screen.getByRole('button', { name: '下一步：设置关键词' }));
  await user.type(screen.getByLabelText('关键词过滤（可选）'), '请假申请');
  await user.click(screen.getByRole('button', { name: '打开并抓取网页' }));
  expect(browserNavigate).toHaveBeenCalledWith('https://example.com/spec');
  expect(getPageContent).toHaveBeenCalledWith('请假申请');
  expect(browserNavigate.mock.invocationCallOrder[0]).toBeLessThan(getPageContent.mock.invocationCallOrder[0]);
  await user.click(screen.getByRole('button', { name: '上一步' }));
  expect(screen.getByLabelText('关键词过滤（可选）')).toHaveValue('请假申请');
});
```

Also assert invalid URL blocks progress, empty extraction blocks AI modeling, cancel calls `onCancel`, and save calls `onSaved` with the draft.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/pages/RequirementModeler.test.tsx`

Expected: FAIL because the component is missing.

- [ ] **Step 3: Implement four-step modeler state and capture flow**

Use:

```ts
const [step, setStep] = useState<ModelerStep>(1);
const [url, setUrl] = useState('');
const [keyword, setKeyword] = useState('');
const [docText, setDocText] = useState('');
const [capturedInput, setCapturedInput] = useState<{ url: string; keyword: string } | null>(null);
const [draft, setDraft] = useState<ScenarioTemplate | null>(null);
const [busy, setBusy] = useState<'capture' | 'generate' | 'save' | null>(null);
const [error, setError] = useState<string | null>(null);
```

Implement strict capture:

```ts
await browserNavigate(url.trim());
const result = await getPageContent(keyword.trim() || undefined);
if (!result.content.trim()) throw new Error('未抓取到可用的需求正文，请修改网址或关键词后重试。');
setDocText(result.content);
setCapturedInput({ url: url.trim(), keyword: keyword.trim() });
setDraft(null);
setStep(4);
```

Generate with `{ targetUrl: url.trim(), onProgress }`. Save with `saveCustomTemplate(draft)` before `onSaved(draft)`. Changing URL/keyword after capture clears `capturedInput` and `draft` and displays “网址或关键词已变化，请重新抓取”.

Render a left vertical rail (“输入网址 / 设置关键词 / 抓取网页 / AI 建模”), one active panel, “返回测试设计”, “上一步”, and one step-specific primary action. Do not include template lists, search, categories, parameter sets, or execution console.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- src/pages/RequirementModeler.test.tsx` (expected: PASS).

```powershell
git add src/pages/RequirementModeler.tsx src/pages/RequirementModeler.test.tsx
git commit -m "feat: add ordered requirement modeling wizard"
```

---

### Task 3: Rebuild TestCases as a reversible four-step wizard

**Files:**
- Modify: `src/pages/TestCases.tsx`
- Test: `src/pages/TestCases.test.tsx`

**Interfaces:**
- Consumes: `RequirementModeler`, wizard rules
- Preserves existing generation, deduplication, confirmation, suite storage, case execution, and suite execution handlers

- [ ] **Step 1: Write failing UI tests**

Mock storage/generation/execution modules. Cover: step 2 locked until requirement exists; modeler cancel preserves requirement; saved template returns to step 2 and is selected; generated cases unlock step 3; confirmed cases unlock step 4; “上一步” returns; requirement edits mark generated results stale.

```ts
it('returns from modeling without losing requirement text', async () => {
  const user = userEvent.setup();
  render(<TestCases />);
  await user.type(screen.getByLabelText('需求或验收标准'), '保留这段需求');
  await user.click(screen.getByRole('button', { name: '从需求文档建模' }));
  await user.click(screen.getByRole('button', { name: '返回测试设计' }));
  expect(screen.getByLabelText('需求或验收标准')).toHaveValue('保留这段需求');
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/pages/TestCases.test.tsx`

Expected: FAIL because current UI has no ordered navigation or inline modeler.

- [ ] **Step 3: Add step and revision state**

```ts
const [step, setStep] = useState<TestDesignStep>(1);
const [showModeler, setShowModeler] = useState(false);
const [requirementRevision, setRequirementRevision] = useState(0);
const [generatedRevision, setGeneratedRevision] = useState<number | null>(null);
```

Clamp forward navigation to `highestUnlockedTestDesignStep`. Permit backward navigation. Increment revision on requirement edits, show a stale notice when revisions differ, and set the generated revision after successful direct/template generation.

On saved template, reload/merge templates, select its ID, close the modeler, and move to step 2. Keep `TestCases` mounted while rendering its child so cancel preserves state.

- [ ] **Step 4: Render one active work panel**

- Step 1: module, labeled requirement textarea, privacy notice, “从需求文档建模”.
- Step 2: two generation choices—direct and template-based.
- Step 3: case details and confirmation actions.
- Step 4: suite selection/creation, add-to-suite, case/suite execution, run log.
- Left rail: active/completed/locked semantic buttons.
- Footer: “上一步” and one stage-specific primary action.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- src/pages/TestCases.test.tsx src/pages/RequirementModeler.test.tsx src/pages/testDesignWizard.test.ts` (expected: PASS), then `npm run lint` (expected: exit 0).

```powershell
git add src/pages/TestCases.tsx src/pages/TestCases.test.tsx
git commit -m "feat: guide users through test design"
```

---

### Task 4: Remove legacy template routes and code

**Files:**
- Modify: `src/App.tsx`
- Delete: `src/pages/Templates.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- `AuthenticatedApp` retains only `dashboard`, `testdesign`, `reports`, and `settings` branches.

- [ ] **Step 1: Write a failing source regression test**

```ts
it('contains no legacy template routes', async () => {
  const source = await import('./App.tsx?raw').then((module) => module.default);
  expect(source).not.toContain("case 'templates'");
  expect(source).not.toContain("case 'templateModeler'");
  expect(source).not.toContain("case 'testcases'");
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/App.test.tsx`

Expected: FAIL on all three legacy cases.

- [ ] **Step 3: Remove branches and old component**

Delete the `Templates` import and reduce the switch to:

```tsx
switch (activeTab) {
  case 'dashboard': return <Dashboard />;
  case 'testdesign': return <TestCases />;
  case 'reports': return <Reports />;
  case 'settings': return <Settings status={status} setStatus={setStatus} currentUser={user} />;
  default: return <Dashboard />;
}
```

Delete `src/pages/Templates.tsx`. Search for `Templates`, `templateModeler`, `case 'templates'`, and `case 'testcases'`; no runtime reference may remain.

- [ ] **Step 4: Verify GREEN and commit**

Run `npm test -- src/App.test.tsx`, `npm run lint`, and `npm run build`. Expected: all exit 0.

```powershell
git add src/App.tsx src/App.test.tsx src/pages/Templates.tsx
git commit -m "refactor: remove legacy template workspace"
```

---

### Task 5: Synchronize project documentation

**Files:**
- Modify: `README.md`, `OpenMontage使用指南.md`, `开发文档.md`

**Interfaces:**
- Documentation describes only current UI.

- [ ] **Step 1: Update user workflow**

Document `需求来源 → 生成用例 → 检查确认 → 回归执行`. Describe URL input, optional keyword, automatic browser navigation/extraction, and state-preserving back navigation. Remove old list, parameter-set configuration, and direct template execution instructions.

- [ ] **Step 2: Update as-built architecture**

Replace standalone `Templates` with child `RequirementModeler`; document `browserNavigate` before `getPageContent`; remove the claim that Templates calls `browser_run_agent`; state that templates remain stored data and a generation choice without a standalone route.

- [ ] **Step 3: Search for obsolete claims**

Run:

```powershell
rg -n "场景模板列表|参数集配置|Templates|需求来源 → 场景模板|先在受控浏览器中打开目标页面" --glob "*.md" .
```

Expected: historical specs aside, no deleted screen is described as current behavior.

- [ ] **Step 4: Commit docs**

```powershell
git add README.md OpenMontage使用指南.md 开发文档.md
git commit -m "docs: document guided test design workflow"
```

---

### Task 6: Final verification

**Files:**
- Modify only already-touched files if a verification defect is found.

- [ ] **Step 1: Run all automated checks**

Run `npm test` and `npm run check`.

Expected: all tests pass without React act warnings; lint, TypeScript, and Vite build exit 0.

- [ ] **Step 2: Verify removal and diff hygiene**

Run:

```powershell
rg -n "templateModeler|case 'templates'|case 'testcases'|currentView.*configure|场景模板配置 \(Seed Files\)" src README.md OpenMontage使用指南.md 开发文档.md
git status --short
git diff --check
```

Expected: no obsolete runtime matches or whitespace errors; unrelated dirty files remain untouched.

- [ ] **Step 3: Desktop visual smoke check**

Open “测试设计” and verify: ordered unlocking; backward preservation; valid URL requirement; navigate-then-capture; cancel preserves parent input; saving selects the new template; generated and confirmed cases unlock steps 3 and 4; no action reaches the deleted list.

If Chrome/CDP or a model is unavailable, record that limitation instead of claiming full desktop verification.
