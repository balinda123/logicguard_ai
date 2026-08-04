# Stateful Multi-Account Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 LogicGuard AI 从单账号用例回放扩展为同时支持单角色边界测试、跨角色状态流转、人工登录接管和可确认问题清单的本地测试工作台。

**Architecture:** 在现有 React/Tauri/sidecar 架构上新增一个 `testing` Rust 模块，使用现有 SQLite 保存非敏感测试元数据，使用系统凭据库保存测试账号密码。前端以场景、执行批次和问题草稿为边界组织页面；浏览器仍由单个 CDP 受控 Chrome 顺序执行，角色切换通过清理会话、自动登录或人工接管完成。

**Tech Stack:** React 19、TypeScript、Vitest、Tauri 2、Rust、rusqlite、keyring、Node.js 22、Playwright/Stagehand、SheetJS `xlsx`。

---

## File Structure

| 文件 | 责任 |
| --- | --- |
| `src/types/workflow.ts` | 前端测试账号、场景、批次、事件、证据和问题草稿类型与纯状态辅助函数 |
| `src/api/testingBridge.ts` | Tauri `invoke` 的类型化测试领域桥接，不在前端存储密码 |
| `src/agents/workflowExecutor.ts` | 角色切换、脚本分段执行、检查点、人工接管和失败分类 |
| `src/utils/defectExport.ts` | 已确认问题的 CSV/XLSX 导出与敏感字段过滤 |
| `src/components/TestAccountsPanel.tsx` | 管理员的测试账号与账号组合维护面板 |
| `src/components/WorkflowRunConsole.tsx` | 可读的实时步骤流、人工接管和失败证据视图 |
| `src/pages/ExecutionCenter.tsx` | 执行批次列表与详情页面 |
| `src/pages/IssueTracker.tsx` | 已确认问题表格、状态更新、详情抽屉和导出 |
| `src/pages/TestCases.tsx` | 将已确认用例转换为可执行场景，保留现有需求建模和回归套件能力 |
| `src/pages/Settings.tsx` | 嵌入测试账号管理员入口 |
| `src/pages/Dashboard.tsx` | 改为测试工作台，提供开始、继续和待处理入口 |
| `src/App.tsx`、`src/components/Sidebar.tsx` | 注册执行中心与问题清单导航 |
| `src-tauri/src/testing.rs` | SQLite 模型、所有权校验、测试账号凭据、批次/问题/证据命令 |
| `src-tauri/src/auth.rs` | 向 `testing` 模块暴露受限的数据库和管理员检查能力 |
| `src-tauri/src/browser.rs` | 受控浏览器清会话与失败截图的安全包装命令 |
| `src-tauri/src/lib.rs` | 注册 `testing` 模块和新增浏览器命令 |
| `sidecar/session.js` | Playwright 级别的清 Cookie 与截图实现 |
| `sidecar/index.js` | 暴露 `clear_session` 与 `screenshot` 子命令 |
| `README.md`、`开发文档.md`、`sidecar/README.md` | 同步实现后的能力、存储边界、命令和限制 |

现有 localStorage 中的 `TestCase`、`RegressionSuite` 和模板不迁移、不删除。场景页提供“转换为测试场景”动作，用户补全角色、初始状态和账号要求后才创建新场景；现有单账号用例继续可查看和执行。

### Task 1: 定义工作流领域模型和纯状态规则

**Files:**
- Create: `src/types/workflow.ts`
- Create: `src/types/workflow.test.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: 为场景、批次和问题状态写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import {
  canCreateDefectDraft,
  isRunTerminal,
  transitionDefectStatus,
} from './workflow'

describe('workflow state rules', () => {
  it('only creates defects for assertion failures', () => {
    expect(canCreateDefectDraft('business_failed')).toBe(true)
    expect(canCreateDefectDraft('execution_blocked')).toBe(false)
    expect(canCreateDefectDraft('passed')).toBe(false)
  })

  it('treats paused runs as resumable and terminal runs as locked', () => {
    expect(isRunTerminal('waiting_handoff')).toBe(false)
    expect(isRunTerminal('business_failed')).toBe(true)
    expect(isRunTerminal('passed')).toBe(true)
  })

  it('allows only the confirmed issue lifecycle', () => {
    expect(transitionDefectStatus('pending_confirmation', 'pending_fix')).toBe('pending_fix')
    expect(() => transitionDefectStatus('pending_confirmation', 'pending_validation')).toThrow('非法问题状态流转')
  })
})
```

- [ ] **Step 2: 运行测试并确认领域模块缺失**

Run: `npm test -- src/types/workflow.test.ts`

Expected: FAIL，提示找不到 `./workflow`。

- [ ] **Step 3: 新增完整领域类型和状态函数**

```ts
export type BusinessRole = 'employee' | 'manager' | 'hrbp'
export type LoginMode = 'automatic' | 'manual_sso' | 'manual_otp'
export type ScenarioKind = 'single_role' | 'permission' | 'workflow' | 'branch'
export type RunStatus = 'queued' | 'running' | 'waiting_handoff' | 'execution_blocked' | 'business_failed' | 'passed' | 'cancelled'
export type DefectStatus = 'pending_confirmation' | 'pending_fix' | 'pending_validation' | 'closed' | 'not_a_bug'

export interface WorkflowScenarioStep {
  id: string
  order: number
  actor: BusinessRole
  intent: string
  expectedPage: string
  expectedBusinessState: string
  handoffRequired: boolean
}

export interface WorkflowScenario {
  id: string
  name: string
  sourceCaseId?: string
  requirementTitle: string
  module: string
  kind: ScenarioKind
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  requiredRoles: BusinessRole[]
  initialState: string
  dataStrategy: 'create_new' | 'reuse_prepared' | 'manual_prepare'
  steps: WorkflowScenarioStep[]
  status: 'draft' | 'confirmed' | 'archived'
  createdAt: string
  confirmedAt?: string
}

export interface LoginAutomationConfig {
  loginUrl: string
  usernameSelector: string
  passwordSelector: string
  submitSelector: string
  identitySelector: string
  expectedIdentity: string
}

export interface TestAccount {
  id: string
  displayName: string
  environment: string
  businessRole: BusinessRole
  loginMode: LoginMode
  maskedUsername: string
  credentialConfigured: boolean
  enabled: boolean
  loginConfig: LoginAutomationConfig
}

export interface AccountCombination {
  id: string
  displayName: string
  environment: string
  employeeAccountId: string
  managerAccountId: string
  hrbpAccountId: string
  dataStrategy: WorkflowScenario['dataStrategy']
  preparationNote: string
  enabled: boolean
}

export interface WorkflowRun {
  id: string
  scenarioId: string
  scenarioName: string
  accountCombinationId?: string
  status: RunStatus
  currentStep: number
  currentActor?: BusinessRole
  createdAt: string
  updatedAt: string
}

export interface WorkflowRunEvent {
  id: string
  runId: string
  stepOrder: number
  actor: BusinessRole
  businessState: string
  action: string
  expectedResult: string
  actualResult: string
  status: 'passed' | 'business_failed' | 'execution_blocked'
  createdAt: string
}

export interface FailureEvidence {
  id: string
  runId: string
  eventId: string
  screenshotPath: string
  createdAt: string
}

export interface DefectDraft {
  id: string
  runId: string
  scenarioName: string
  title: string
  actor: BusinessRole
  expectedResult: string
  actualResult: string
  evidenceIds: string[]
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  status: DefectStatus
  createdAt: string
  updatedAt: string
}

export function canCreateDefectDraft(status: RunStatus): boolean {
  return status === 'business_failed'
}

export function isRunTerminal(status: RunStatus): boolean {
  return ['execution_blocked', 'business_failed', 'passed', 'cancelled'].includes(status)
}

export function transitionDefectStatus(from: DefectStatus, to: DefectStatus): DefectStatus {
  const allowed: Record<DefectStatus, DefectStatus[]> = {
    pending_confirmation: ['pending_fix', 'not_a_bug'],
    pending_fix: ['pending_validation'],
    pending_validation: ['closed', 'pending_fix'],
    closed: [],
    not_a_bug: [],
  }
  if (!allowed[from].includes(to)) throw new Error('非法问题状态流转')
  return to
}
```

补齐 `TestAccount`、`AccountCombination`、`WorkflowRun`、`WorkflowRunEvent`、`FailureEvidence` 和 `DefectDraft` 接口，并从 `src/types/index.ts` 重新导出它们。

- [ ] **Step 4: 运行领域测试和现有类型相关测试**

Run: `npm test -- src/types/workflow.test.ts src/pages/TestCases.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交领域模型**

```bash
git add src/types/index.ts src/types/workflow.ts src/types/workflow.test.ts
git commit -m "feat: add workflow domain types"
```

### Task 2: 建立后端测试数据仓库与所有权规则

**Files:**
- Create: `src-tauri/src/testing.rs`
- Modify: `src-tauri/src/auth.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 为 SQLite 迁移和问题状态校验写 Rust 单元测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn migration_creates_testing_tables() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let table_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('test_accounts','account_combinations','workflow_scenarios','workflow_runs','defect_drafts')",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(table_count, 5);
    }

    #[test]
    fn defect_transition_rejects_skipping_confirmation() {
        assert!(validate_defect_transition("pending_confirmation", "pending_validation").is_err());
        assert!(validate_defect_transition("pending_confirmation", "pending_fix").is_ok());
    }
}
```

- [ ] **Step 2: 运行 Rust 测试并确认它先失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml testing::tests`

Expected: FAIL，因为 `testing` 模块尚未注册。

- [ ] **Step 3: 实现迁移、数据结构和用户隔离查询**

在 `auth.rs` 将 `open_db` 和 `require_admin` 改为 `pub(crate)`；不要公开 API Key 或当前用户密码。

在 `testing.rs` 中创建以下表，所有运行、场景、证据和问题均带 `owner_id`；测试账号和账号组合带 `managed_by_user_id`，由管理员维护、所有已登录用户只读选择：

```rust
const TEST_ACCOUNT_CREDENTIAL_SERVICE: &str = "com.logicguard.ai.test-account";

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS test_accounts (
           id TEXT PRIMARY KEY,
           managed_by_user_id TEXT NOT NULL,
           display_name TEXT NOT NULL,
           environment TEXT NOT NULL,
           business_role TEXT NOT NULL CHECK(business_role IN ('employee','manager','hrbp')),
           login_mode TEXT NOT NULL CHECK(login_mode IN ('automatic','manual_sso','manual_otp')),
           login_config_json TEXT NOT NULL,
           masked_username TEXT NOT NULL,
           credential_configured INTEGER NOT NULL DEFAULT 0,
           enabled INTEGER NOT NULL DEFAULT 1,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS account_combinations (
           id TEXT PRIMARY KEY,
           managed_by_user_id TEXT NOT NULL,
           display_name TEXT NOT NULL,
           environment TEXT NOT NULL,
           employee_account_id TEXT NOT NULL REFERENCES test_accounts(id),
           manager_account_id TEXT NOT NULL REFERENCES test_accounts(id),
           hrbp_account_id TEXT NOT NULL REFERENCES test_accounts(id),
           data_strategy TEXT NOT NULL CHECK(data_strategy IN ('create_new','reuse_prepared','manual_prepare')),
           preparation_note TEXT NOT NULL DEFAULT '',
           enabled INTEGER NOT NULL DEFAULT 1,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS workflow_scenarios (
           id TEXT PRIMARY KEY,
           owner_id TEXT NOT NULL,
           payload_json TEXT NOT NULL,
           status TEXT NOT NULL CHECK(status IN ('draft','confirmed','archived')),
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS workflow_runs (
           id TEXT PRIMARY KEY,
           owner_id TEXT NOT NULL,
           scenario_id TEXT NOT NULL,
           account_snapshot_json TEXT NOT NULL,
           status TEXT NOT NULL,
           current_step INTEGER NOT NULL DEFAULT 0,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS workflow_events (
           id TEXT PRIMARY KEY,
           run_id TEXT NOT NULL,
           owner_id TEXT NOT NULL,
           payload_json TEXT NOT NULL,
           created_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS failure_evidence (
           id TEXT PRIMARY KEY,
           run_id TEXT NOT NULL,
           owner_id TEXT NOT NULL,
           event_id TEXT NOT NULL,
           relative_path TEXT NOT NULL,
           created_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS defect_drafts (
           id TEXT PRIMARY KEY,
           owner_id TEXT NOT NULL,
           run_id TEXT NOT NULL,
           payload_json TEXT NOT NULL,
           status TEXT NOT NULL CHECK(status IN ('pending_confirmation','pending_fix','pending_validation','closed','not_a_bug')),
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );"
    ).map_err(|error| error.to_string())
}
```

每个查询都从 `auth::current_user_id()` 取 `owner_id`，不接受前端传入 owner。管理员写测试账号时使用 `auth::require_admin()`；返回给前端的账号对象只含 `credential_configured`，不含系统凭据库内容。

- [ ] **Step 4: 注册安全的 CRUD 命令**

注册并实现：`list_test_accounts`、`save_test_account`、`set_test_account_secret`、`delete_test_account`、`list_account_combinations`、`save_account_combination`、`list_workflow_scenarios`、`save_workflow_scenario`、`list_workflow_runs`、`create_workflow_run`、`append_workflow_event`、`update_workflow_run_status`、`list_defect_drafts`、`save_defect_draft`、`transition_defect_draft`。

每个 `save_*` 命令解析 `serde_json::Value` 前先校验可枚举字段、必填字符串长度和步骤顺序；拒绝包含 `password`、`otp`、`secret` 键的 JSON payload。删除测试账号时同时删除该账号对应的 keyring 条目，且当账号被任何账号组合引用时返回明确错误。

- [ ] **Step 5: 重新运行 Rust 测试并提交**

Run: `cargo test --manifest-path src-tauri/Cargo.toml testing::tests`

Expected: PASS。

```bash
git add src-tauri/src/auth.rs src-tauri/src/testing.rs src-tauri/src/lib.rs
git commit -m "feat: persist testing workflows securely"
```

### Task 3: 实现测试账号凭据与账号组合前端桥接

**Files:**
- Create: `src/api/testingBridge.ts`
- Create: `src/api/testingBridge.test.ts`
- Modify: `src/types/workflow.ts`

- [ ] **Step 1: 编写桥接层测试，禁止把密码返回到页面状态**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

describe('saveTestAccountSecret', () => {
  beforeEach(() => invoke.mockReset())

  it('sends a password only to the dedicated credential command', async () => {
    const { saveTestAccountSecret } = await import('./testingBridge')
    await saveTestAccountSecret('acct-1', 'secret-value')
    expect(invoke).toHaveBeenCalledWith('set_test_account_secret', {
      accountId: 'acct-1',
      password: 'secret-value',
    })
  })
})
```

- [ ] **Step 2: 运行测试并确认桥接文件缺失**

Run: `npm test -- src/api/testingBridge.test.ts`

Expected: FAIL，提示无法解析 `./testingBridge`。

- [ ] **Step 3: 实现只传递类型化、非敏感数据的桥接**

```ts
import { invoke } from '@tauri-apps/api/core'
import type {
  AccountCombination,
  DefectDraft,
  TestAccount,
  WorkflowRun,
  WorkflowScenario,
} from '../types'

export const listTestAccounts = () => invoke<TestAccount[]>('list_test_accounts')
export const listAccountCombinations = () => invoke<AccountCombination[]>('list_account_combinations')
export const listWorkflowScenarios = () => invoke<WorkflowScenario[]>('list_workflow_scenarios')
export const listWorkflowRuns = () => invoke<WorkflowRun[]>('list_workflow_runs')
export const listDefectDrafts = () => invoke<DefectDraft[]>('list_defect_drafts')

export const saveTestAccountSecret = (accountId: string, password: string) =>
  invoke<void>('set_test_account_secret', { accountId, password })
```

`saveTestAccount` 的输入类型不得定义 `password` 字段；密码输入由组件局部状态保存，调用完成后立即清空。

- [ ] **Step 4: 运行桥接测试并提交**

Run: `npm test -- src/api/testingBridge.test.ts`

Expected: PASS。

```bash
git add src/api/testingBridge.ts src/api/testingBridge.test.ts src/types/workflow.ts
git commit -m "feat: add testing domain bridge"
```

### Task 4: 补齐受控浏览器会话和失败截图能力

**Files:**
- Create: `sidecar/session.js`
- Create: `sidecar/session.test.js`
- Modify: `sidecar/index.js`
- Modify: `src-tauri/src/browser.rs`
- Modify: `src-tauri/src/testing.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/api/browserBridge.ts`

- [ ] **Step 1: 为 Playwright 会话清理与失败截图写 Node 测试**

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const { clearBrowserSession, captureFailureScreenshot } = require('./session')

test('clearBrowserSession clears cookies and opens a blank page', async () => {
  const calls = []
  await clearBrowserSession({
    clearCookies: async () => calls.push('cookies'),
  }, {
    goto: async (url) => calls.push(url),
  })
  assert.deepEqual(calls, ['cookies', 'about:blank'])
})

test('captureFailureScreenshot uses a viewport screenshot', async () => {
  let options
  await captureFailureScreenshot({ screenshot: async (value) => { options = value } }, 'C:/evidence/fail.png')
  assert.deepEqual(options, { path: 'C:/evidence/fail.png', fullPage: false })
})
```

- [ ] **Step 2: 运行 Node 测试并确认实现缺失**

Run: `node --test sidecar/session.test.js`

Expected: FAIL，提示找不到 `./session`。

- [ ] **Step 3: 实现 sidecar 命令和 Rust 安全包装**

```js
async function clearBrowserSession(context, page) {
  await context.clearCookies()
  await page.goto('about:blank')
}

async function captureFailureScreenshot(page, path) {
  await page.screenshot({ path, fullPage: false })
}

module.exports = { clearBrowserSession, captureFailureScreenshot }
```

在 `sidecar/index.js` 中复用上述函数，增加 `clear_session` 分支；保留既有 `screenshot` 分支但改为调用 `captureFailureScreenshot`。

在 Rust 增加：

```rust
#[command]
pub fn browser_clear_session(port: Option<u16>) -> Result<ActionResult, String> {
    let raw = run_sidecar_with_config(
        vec!["clear_session".to_string(), format!("--port={}", port.unwrap_or(9222))],
        None,
    )?;
    parse_response::<ActionResult>(&raw)
}

#[command]
pub fn browser_capture_failure_screenshot(
    app: tauri::AppHandle,
    run_id: String,
    evidence_id: String,
    port: Option<u16>,
) -> Result<String, String> {
    let owner_id = crate::auth::current_user_id()?;
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?
        .join("evidence").join(owner_id).join(run_id);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let path = root.join(format!("{}.png", evidence_id));
    let raw = run_sidecar_with_config(
        vec!["screenshot".to_string(), format!("--port={}", port.unwrap_or(9222)), format!("--path={}", path.display())],
        None,
    )?;
    parse_response::<ActionResult>(&raw)?;
    Ok(path.display().to_string())
}
```

在 `testing.rs` 新增只供 Rust 模块调用的 `pub(crate) fn load_automatic_login(app, account_id) -> Result<StoredAutomaticLogin, String>`。它必须验证当前用户可以使用该启用账号、登录模式为 `automatic`，从 keyring 读取密码，并返回未序列化的 `StoredAutomaticLogin { login_url, username_selector, password_selector, submit_selector, identity_selector, expected_identity, username, password }`。该结构不得实现 `Serialize`。

随后在 `browser.rs` 增加 `browser_login_test_account`：

```rust
#[command]
pub fn browser_login_test_account(
    app: tauri::AppHandle,
    account_id: String,
    port: Option<u16>,
) -> Result<ActionResult, String> {
    let login = crate::testing::load_automatic_login(&app, &account_id)?;
    let cdp_port = port.unwrap_or(9222).to_string();
    run_sidecar_with_config(vec![
        "navigate".to_string(), format!("--port={}", cdp_port), format!("--url={}", login.login_url),
    ], None)?;
    run_sidecar_with_config(vec![
        "type".to_string(), format!("--port={}", cdp_port), format!("--selector={}", login.username_selector), format!("--value={}", login.username),
    ], None)?;
    run_sidecar_with_config(vec![
        "type".to_string(), format!("--port={}", cdp_port), format!("--selector={}", login.password_selector), format!("--value={}", login.password),
    ], None)?;
    let raw = run_sidecar_with_config(vec![
        "click".to_string(), format!("--port={}", cdp_port), format!("--selector={}", login.submit_selector),
    ], None)?;
    parse_response::<ActionResult>(&raw)
}
```

为 `load_automatic_login` 增加 Rust 单元测试，证明 manual 账号会被拒绝，且 `StoredAutomaticLogin` 不能序列化或作为 Tauri 命令返回。身份断言在执行器的下一步通过既有 `browser_assert` 完成。

前端桥接只暴露 `clearBrowserSession()` 和 `captureFailureScreenshot(runId, evidenceId)`；不允许 UI 传任意文件路径。

- [ ] **Step 4: 运行 Node 测试、Rust 检查并提交**

Run: `node --test sidecar/session.test.js`

Expected: PASS。

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: PASS。

```bash
git add sidecar/session.js sidecar/session.test.js sidecar/index.js src-tauri/src/browser.rs src-tauri/src/lib.rs src/api/browserBridge.ts
git commit -m "feat: add browser session and failure evidence controls"
```

### Task 5: 增加管理员测试账号和账号组合配置

**Files:**
- Create: `src/components/TestAccountsPanel.tsx`
- Create: `src/components/TestAccountsPanel.test.tsx`
- Modify: `src/pages/Settings.tsx`
- Create: `src/pages/Settings.test.tsx`

- [ ] **Step 1: 编写设置页组件测试**

```tsx
it('hides account administration from normal users', async () => {
  render(<TestAccountsPanel currentUser={{ id: 'u1', username: 'tester', role: 'user' }} />)
  expect(screen.getByText('测试账号仅由管理员维护')).toBeVisible()
  expect(screen.queryByRole('button', { name: '新增测试账号' })).not.toBeInTheDocument()
})

it('clears the password input after saving an automatic account', async () => {
  const user = userEvent.setup()
  render(<TestAccountsPanel currentUser={{ id: 'a1', username: 'admin', role: 'admin' }} />)
  await user.type(screen.getByLabelText('登录密码'), 'secret-value')
  await user.click(screen.getByRole('button', { name: '保存测试账号' }))
  expect(screen.getByLabelText('登录密码')).toHaveValue('')
})
```

- [ ] **Step 2: 运行测试并确认组件缺失**

Run: `npm test -- src/components/TestAccountsPanel.test.tsx`

Expected: FAIL，提示找不到组件。

- [ ] **Step 3: 实现账号与组合面板**

管理员表单字段固定为显示名称、环境、业务角色、登录模式、登录页 URL、脱敏账号名、登录验证文本，以及自动登录时的用户名、密码、用户名输入选择器、密码输入选择器和提交选择器。`manual_sso`、`manual_otp` 不渲染密码字段。

账号组合表单只允许同环境且启用的员工、上级、HRBP 账号；提交前要求三种角色各选择一次。账号表格只展示“凭据已配置/未配置”，从不回显密码。

将面板插入 `Settings.tsx` 的管理员区域，并在保存后重新加载账号和组合列表。

- [ ] **Step 4: 运行组件测试和设置页回归测试**

Run: `npm test -- src/components/TestAccountsPanel.test.tsx src/pages/Settings.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交账号配置页**

```bash
git add src/components/TestAccountsPanel.tsx src/components/TestAccountsPanel.test.tsx src/pages/Settings.tsx src/pages/Settings.test.tsx
git commit -m "feat: manage test accounts and combinations"
```

### Task 6: 将已确认用例扩展为可审阅测试场景

**Files:**
- Create: `src/components/ScenarioConversionDialog.tsx`
- Create: `src/components/ScenarioConversionDialog.test.tsx`
- Modify: `src/pages/TestCases.tsx`
- Modify: `src/api/testCaseGenerator.ts`
- Modify: `src/pages/testDesignWizard.ts`

- [ ] **Step 1: 为转换对话框写测试**

```tsx
it('requires an actor and initial state before creating a single-role scenario', async () => {
  const user = userEvent.setup()
  render(<ScenarioConversionDialog testCase={confirmedCase} onSaved={vi.fn()} onClose={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: '创建测试场景' }))
  expect(screen.getByText('请选择执行角色')).toBeVisible()
  await user.selectOptions(screen.getByLabelText('执行角色'), 'employee')
  await user.type(screen.getByLabelText('初始业务状态'), '待设定目标')
  await user.click(screen.getByRole('button', { name: '创建测试场景' }))
  expect(screen.getByText('请选择执行角色')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试并确认转换入口缺失**

Run: `npm test -- src/components/ScenarioConversionDialog.test.tsx`

Expected: FAIL，提示找不到对话框。

- [ ] **Step 3: 在生成提示词中明确两层覆盖，并实现转换对话框**

将 `buildPrompt()` 的输出 schema 扩展为 `coverageKind`、`suggestedRoles`、`initialState`、`expectedBusinessState`。生成器必须将“100/101 字、必填、权限、重复提交”等规则标为单角色/权限场景，将 PRD 状态机迁移标为工作流/分支场景。

转换对话框从现有 `TestCase` 复制需求、步骤、优先级和测试数据；用户补齐：场景类型、所需角色、初始状态、数据准备策略和每步期望业务状态。保存后通过 `save_workflow_scenario` 写入后端，原 `TestCase` 保持不变。

修改测试设计步骤文案，使最后一步从“回归执行”改为“确认场景”；原回归套件可继续包含未转换用例和已确认场景。

- [ ] **Step 4: 运行生成器、向导与转换测试**

Run: `npm test -- src/pages/TestCases.test.tsx src/pages/testDesignWizard.test.ts src/components/ScenarioConversionDialog.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交场景转换能力**

```bash
git add src/components/ScenarioConversionDialog.tsx src/components/ScenarioConversionDialog.test.tsx src/pages/TestCases.tsx src/api/testCaseGenerator.ts src/pages/testDesignWizard.ts
git commit -m "feat: convert confirmed cases into workflows"
```

### Task 7: 实现检查点、人工接管和失败分类执行器

**Files:**
- Create: `src/agents/workflowExecutor.ts`
- Create: `src/agents/workflowExecutor.test.ts`
- Modify: `src/agents/scriptExecutor.ts`
- Modify: `src/api/testingBridge.ts`

- [ ] **Step 1: 为角色切换和失败分类写执行器测试**

```ts
it('pauses before a manual OTP actor and resumes from the same step', async () => {
  const result = await executeWorkflowScenario(otpScenario, dependencies)
  expect(result.status).toBe('waiting_handoff')
  expect(dependencies.saveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ currentStep: 2 }))
  await result.resume()
  expect(dependencies.executeIntent).toHaveBeenCalledTimes(2)
})

it('creates evidence only for an assertion mismatch', async () => {
  dependencies.executeIntent.mockRejectedValueOnce(new WorkflowAssertionError('未进入目标待确认'))
  const result = await executeWorkflowScenario(singleRoleScenario, dependencies)
  expect(result.status).toBe('business_failed')
  expect(dependencies.captureFailureEvidence).toHaveBeenCalledTimes(1)

  dependencies.executeIntent.mockRejectedValueOnce(new WorkflowExecutionBlockedError('CDP disconnected'))
  const blocked = await executeWorkflowScenario(singleRoleScenario, dependencies)
  expect(blocked.status).toBe('execution_blocked')
  expect(dependencies.captureFailureEvidence).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: 运行测试并确认执行器缺失**

Run: `npm test -- src/agents/workflowExecutor.test.ts`

Expected: FAIL，提示找不到 `workflowExecutor`。

- [ ] **Step 3: 实现顺序单浏览器编排**

`workflowExecutor.ts` 仅依赖注入的桥接函数，便于 Vitest mock：

```ts
export async function switchActor(
  account: TestAccount,
  config: LoginAutomationConfig,
  browser: WorkflowBrowser,
): Promise<'ready' | 'waiting_handoff'> {
  await browser.clearSession()
  if (account.loginMode !== 'automatic') return 'waiting_handoff'
  await browser.loginWithStoredCredential(account.id)
  await browser.assert(config.identitySelector, config.expectedIdentity)
  return 'ready'
}
```

在 `workflowExecutor.ts` 顶部定义并导出执行器使用的错误和依赖接口：

```ts
export class WorkflowAssertionError extends Error {}
export class WorkflowExecutionBlockedError extends Error {}

export interface WorkflowBrowser {
  clearSession(): Promise<void>
  loginWithStoredCredential(accountId: string): Promise<void>
  assert(selector: string, expected: string): Promise<void>
}

export interface WorkflowExecutorDependencies {
  browser: WorkflowBrowser
  executeIntent(step: WorkflowScenarioStep): Promise<void>
  saveCheckpoint(runId: string, currentStep: number, event: WorkflowRunEvent): Promise<void>
  captureFailureEvidence(runId: string, eventId: string): Promise<FailureEvidence>
  createDefectDraft(runId: string, evidence: FailureEvidence, event: WorkflowRunEvent): Promise<void>
}
```

在本文件定义并导出 `WorkflowAssertionError` 和 `WorkflowExecutionBlockedError`；前者仅由页面/业务状态断言不匹配抛出，后者包装 CDP 连接、定位、登录、前置状态和人工接管超时。`browser.loginWithStoredCredential(account.id)` 调用 Task 4 的 Rust `browser_login_test_account`，前端只收到成功或失败，绝不接收密码。

每个角色步骤按当前页面调用既有 `generateTestScript()` 和 `executeTestScript()`；在成功后保存语义化事件与业务状态检查点。`WorkflowAssertionError` 触发一次截图、证据记录和问题草稿；`WorkflowExecutionBlockedError` 映射为 `execution_blocked`。

- [ ] **Step 4: 运行执行器与旧脚本执行器测试**

Run: `npm test -- src/agents/workflowExecutor.test.ts src/agents/scriptExecutor.test.ts`

Expected: PASS；若旧执行器没有测试文件，新增一条测试证明未传入 `checkPause` 时原有单账号回放仍执行全部步骤。

- [ ] **Step 5: 提交编排执行器**

```bash
git add src/agents/workflowExecutor.ts src/agents/workflowExecutor.test.ts src/agents/scriptExecutor.ts src/agents/scriptExecutor.test.ts src/api/testingBridge.ts src-tauri/src/testing.rs src-tauri/src/lib.rs
git commit -m "feat: execute stateful multi-account workflows"
```

### Task 8: 新增执行中心与实时语义化步骤流

**Files:**
- Create: `src/components/WorkflowRunConsole.tsx`
- Create: `src/components/WorkflowRunConsole.test.tsx`
- Create: `src/pages/ExecutionCenter.tsx`
- Create: `src/pages/ExecutionCenter.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: 编写实时步骤与人工接管 UI 测试**

```tsx
it('shows semantic execution fields without a screenshot for passing events', () => {
  render(<WorkflowRunConsole run={runningRun} events={[passingEvent]} onResume={vi.fn()} />)
  expect(screen.getByText('员工')).toBeVisible()
  expect(screen.getByText('待设定目标')).toBeVisible()
  expect(screen.getByText('点击“提交目标”')).toBeVisible()
  expect(screen.queryByAltText('失败截图')).not.toBeInTheDocument()
})

it('offers a continuation action when waiting for SSO', () => {
  render(<WorkflowRunConsole run={handoffRun} events={[]} onResume={vi.fn()} />)
  expect(screen.getByRole('button', { name: '我已完成登录，继续执行' })).toBeVisible()
})
```

- [ ] **Step 2: 运行测试并确认页面和组件缺失**

Run: `npm test -- src/components/WorkflowRunConsole.test.tsx src/pages/ExecutionCenter.test.tsx`

Expected: FAIL，提示找不到新组件和页面。

- [ ] **Step 3: 实现执行批次列表和详情**

执行中心左侧为批次列表，右侧为当前批次详情。详情事件行固定显示：时间、角色、业务状态、浏览器动作、预期断言、实际结果和结果状态；正常事件没有图片占位，失败事件才显示 `失败截图`。

人工接管状态展示当前要登录的账号显示名称和角色、登录方式、最后成功检查点，并提供“我已完成登录，继续执行”按钮。点击后先调用当前账号的身份验证规则，验证成功才恢复执行器。

在 `App.tsx` 新增 `execution` 路由，在 `Sidebar.tsx` 新增“执行中心”入口。保留现有“测试报告”路由，后续只承担执行记录历史。

- [ ] **Step 4: 运行页面测试和应用壳回归测试**

Run: `npm test -- src/components/WorkflowRunConsole.test.tsx src/pages/ExecutionCenter.test.tsx src/App.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交执行中心**

```bash
git add src/components/WorkflowRunConsole.tsx src/components/WorkflowRunConsole.test.tsx src/pages/ExecutionCenter.tsx src/pages/ExecutionCenter.test.tsx src/App.tsx src/components/Sidebar.tsx
git commit -m "feat: add workflow execution center"
```

### Task 9: 建立问题清单、确认生命周期与 Excel/CSV 导出

**Files:**
- Create: `src/pages/IssueTracker.tsx`
- Create: `src/pages/IssueTracker.test.tsx`
- Create: `src/utils/defectExport.ts`
- Create: `src/utils/defectExport.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: 为问题状态和导出内容写测试**

```ts
it('exports only confirmed developer issues and removes sensitive keys', () => {
  const rows = buildDefectExportRows([
    pendingConfirmationDraft,
    pendingFixDraft,
    { ...pendingFixDraft, id: 'd2', actualResult: 'password=secret-value OTP=123456' },
  ])
  expect(rows).toHaveLength(2)
  expect(rows[1].实际结果).not.toContain('secret-value')
  expect(rows[1].实际结果).not.toContain('123456')
})

it('does not render pending confirmation drafts in the developer issue table', () => {
  render(<IssueTracker initialDrafts={[pendingConfirmationDraft, pendingFixDraft]} />)
  expect(screen.queryByText(pendingConfirmationDraft.title)).not.toBeInTheDocument()
  expect(screen.getByText(pendingFixDraft.title)).toBeVisible()
})
```

- [ ] **Step 2: 运行测试并确认实现缺失**

Run: `npm test -- src/utils/defectExport.test.ts src/pages/IssueTracker.test.tsx`

Expected: FAIL，提示找不到导出工具和问题页面。

- [ ] **Step 3: 安装导出依赖并实现导出工具**

Run: `npm install xlsx`

实现固定列：`问题描述`、`需求/场景`、`测试角色`、`预期结果`、`实际结果`、`截图`、`优先级`、`状态`、`执行日期`、`执行批次`。`buildDefectExportRows()` 先调用既有 `maskSensitiveText()`，再删除任何字段名为 `password`、`otp`、`secret` 的扩展数据。

```ts
import { utils, writeFileXLSX } from 'xlsx'

export function exportDefectsXlsx(drafts: DefectDraft[]): void {
  const rows = buildDefectExportRows(drafts)
  const worksheet = utils.json_to_sheet(rows)
  const workbook = utils.book_new()
  utils.book_append_sheet(workbook, worksheet, '问题清单')
  writeFileXLSX(workbook, `LogicGuard-问题清单-${new Date().toISOString().slice(0, 10)}.xlsx`)
}
```

同时保留 `exportDefectsCsv()`，以 UTF-8 BOM 输出同一列集合。

- [ ] **Step 4: 实现表格、详情抽屉和确认操作**

`IssueTracker` 默认只列出 `pending_fix`、`pending_validation`、`closed` 状态。测试人员在执行记录或草稿详情中将 `pending_confirmation` 更新为 `pending_fix` 或 `not_a_bug`；开发问题表格无权直接跳过状态。截图列仅显示失败证据缩略图，详情抽屉显示截图、复现步骤、语义化日志和实际/预期结果。

新增 `issues` 路由和“问题清单”导航入口。

- [ ] **Step 5: 运行测试并提交**

Run: `npm test -- src/utils/defectExport.test.ts src/pages/IssueTracker.test.tsx`

Expected: PASS。

```bash
git add package.json package-lock.json src/utils/defectExport.ts src/utils/defectExport.test.ts src/pages/IssueTracker.tsx src/pages/IssueTracker.test.tsx src/App.tsx src/components/Sidebar.tsx
git commit -m "feat: manage and export confirmed defects"
```

### Task 10: 将首页调整为测试工作台并保留历史报告

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Create: `src/pages/Dashboard.test.tsx`
- Modify: `src/pages/Reports.tsx`
- Modify: `src/pages/Reports.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: 编写首页任务优先级测试**

```tsx
it('prioritizes resuming a handoff run over aggregate statistics', async () => {
  render(<Dashboard activeRun={handoffRun} actionableItems={[handoffItem, pendingDefectItem]} />)
  expect(screen.getByRole('button', { name: '继续执行' })).toBeVisible()
  expect(screen.getByText('等待人工登录')).toBeVisible()
  expect(screen.queryByText('总执行次数')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试并确认当前首页不满足工作台行为**

Run: `npm test -- src/pages/Dashboard.test.tsx`

Expected: FAIL，当前 Dashboard 未接收工作流批次数据。

- [ ] **Step 3: 实现工作台首页和报告职责收敛**

首页顶部只保留 `导入需求`、`创建场景`、`开始执行`、`查看问题` 四个主要动作，并通过 `setActiveTab` 或回调跳转。主区域优先显示未终态批次的当前角色、最新步骤、人工接管提示和继续入口；其次显示待确认问题、待验收问题与最近结果的紧凑列表。不要恢复大面积统计卡。

在 `Dashboard` 增加 `onNavigate: (tab: string) => void` 属性；`App.tsx` 使用 `<Dashboard onNavigate={setActiveTab} />` 注入现有导航状态。首页不直接读写账号秘密，也不直接启动浏览器动作。

`Reports.tsx` 保留历史执行记录和诊断详情；删除任何“模拟新增报告”入口，报告详情明确显示运行状态为通过、业务失败或执行异常。问题草稿和开发问题的编辑不放在 Reports 中。

- [ ] **Step 4: 运行首页与报告测试**

Run: `npm test -- src/pages/Dashboard.test.tsx src/pages/Reports.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交工作台改造**

```bash
git add src/pages/Dashboard.tsx src/pages/Dashboard.test.tsx src/pages/Reports.tsx src/pages/Reports.test.tsx
git commit -m "feat: focus dashboard on testing work"
```

### Task 11: 同步文档并完成全量验证

**Files:**
- Modify: `README.md`
- Modify: `开发文档.md`
- Modify: `sidecar/README.md`
- Modify: `docs/superpowers/specs/2026-07-27-stateful-multi-account-testing-design.md`

- [ ] **Step 1: 更新已实现能力和限制**

在 README 的“当前能力”中加入单角色边界、跨角色场景、人工接管、失败截图和问题导出；明确首版未接飞书、不跟踪 PS 审批内部结果。开发文档补充 SQLite 表、系统凭据 service/account 规则、Tauri 命令、证据文件目录、状态机和脱敏限制。sidecar README 补充 `clear_session` 和 `screenshot` 命令及只接受 Rust 生成截图路径的约束。

设计文档状态从“尚未实现”改为“已实现”，并将任何未实现的项保留在“首版不包含”中，不把计划功能写成当前行为。

- [ ] **Step 2: 搜索过期名称和不安全存储声明**

Run: `rg -n "单账号|报告.*截图|password|OTP|飞书|PS.*审批" README.md 开发文档.md sidecar/README.md docs/superpowers/specs/2026-07-27-stateful-multi-account-testing-design.md`

Expected: 所有匹配均与已实现边界一致；修正任何仍声称密码会进入前端、报告或 localStorage 的文字。

- [ ] **Step 3: 执行前端、sidecar、Rust 全量检查**

Run: `npm test`

Expected: PASS，0 failures。

Run: `npm run check`

Expected: PASS，ESLint、TypeScript 和 Vite 构建退出码为 0。

Run: `node --test sidecar/session.test.js`

Expected: PASS。

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS。

- [ ] **Step 4: 执行人工浏览器验收**

启动 `npm run tauri dev`，在本机测试环境完成以下检查：

1. 管理员创建自动员工账号、SSO 上级账号和 HRBP 账号组合；保存后密码输入框为空且列表只显示凭据状态。
2. 将“目标内容 101 字”用例转换为员工单角色场景，运行后仅在断言失败时生成一张截图和待确认问题草稿。
3. 运行员工 -> 上级 -> HRBP 场景，SSO 环节进入等待人工接管，手动登录并验证身份后从原检查点继续。
4. 将失败草稿确认到待修复，检查问题清单字段、截图抽屉和 XLSX/CSV 导出内容；确认没有密码、OTP 或原始敏感输入。
5. 检查首页优先显示未完成批次和待处理项，报告页只显示执行历史。

- [ ] **Step 5: 审核变更范围并提交文档**

Run: `git diff --check && git status --short`

Expected: 不存在空白错误；变更仅包含本计划列出的代码、测试、锁文件和文档。

```bash
git add README.md 开发文档.md sidecar/README.md docs/superpowers/specs/2026-07-27-stateful-multi-account-testing-design.md
git commit -m "docs: document stateful testing workflow"
```

## Plan Self-Review

Spec coverage mapping:

- 测试账号、凭据隔离和账号组合：Task 2、Task 3、Task 5。
- 单角色功能/边界/权限和跨角色状态流转：Task 1、Task 6、Task 7。
- 单浏览器顺序切换、SSO/OTP 人工接管与检查点：Task 4、Task 7、Task 8。
- 仅失败截图、业务失败与执行异常分离、按需 AI 分析：Task 1、Task 4、Task 7、Task 8。
- 问题草稿确认、生命周期和 Excel/CSV 导出：Task 2、Task 9。
- 工作台首页、执行中心、报告与问题清单职责划分：Task 8、Task 9、Task 10。
- 文档、安装后运行边界和全量验证：Task 11。

一致性检查：所有阶段使用同一组 `RunStatus` 和 `DefectStatus` 字面量；密码在 Rust/keyring 与 `browser_login_test_account` 命令边界内使用，不返回到 TypeScript；截图只在 `business_failed` 分支由 Rust 创建路径并保存。
