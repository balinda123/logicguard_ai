# System-Scoped Stagehand Execution Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build system-scoped test design, a persistent Rust-owned execution lifecycle, a Stagehand-only production browser stack, safe browser control, and unified global reports without losing historical data.

**Architecture:** SQLite becomes the single source of truth for systems, environments, test designs, runs, evidence, and reports. Rust owns durable run state and browser locking, while a constrained Stagehand v3 sidecar owns browser actions; React reads state through typed Tauri bridges and never owns the lifetime of a run. Delivery is incremental behind compatibility boundaries, with legacy code removed only after migration and parity checks pass.

**Tech Stack:** React 19, TypeScript 6, Vitest, Tauri 2, Rust 2021, rusqlite, Tokio, OS keyring, Node.js 22, Stagehand v3, Node test runner.

**Design reference:** `docs/superpowers/specs/2026-08-03-system-scoped-stagehand-execution-redesign-design.md`

---

## Delivery Rules

- Execute in an isolated worktree created with `superpowers:using-git-worktrees`; the current workspace contains unrelated user changes.
- Follow TDD for every behavior change: add a focused failing test, run it, implement the smallest behavior, rerun the focused test, then run the owning package suite.
- Keep formal regression tests under version control. Ignore only generated artifacts such as traces, screenshots, temporary browser profiles, coverage, runtime state, and migration backups.
- Before every commit run `git diff --cached --name-only` and `git diff --cached --check`. The staged list must contain only files named by the current task.
- At the end of every task record three cleanup results in the commit or task notes: removed legacy code, new ignore entries, and retained compatibility code with its deletion condition.
- Do not remove a legacy execution path until Task 10 parity and migration gates pass.

## File Structure

### New Rust Modules

- `src-tauri/src/test_design.rs`: system, environment, design, requirement version, generation batch, review, and regression configuration records and commands.
- `src-tauri/src/run_manager.rs`: durable run state machine, queue, checkpoints, cancellation, pause, resume, and event broadcasting.
- `src-tauri/src/interaction_guard.rs`: platform-neutral browser lock contract and Windows/macOS adapters.
- `src-tauri/src/legacy_migration.rs`: idempotent import of local test design data and historical reports.
- `src-tauri/src/test_design_tests.rs`, `run_manager_tests.rs`, `legacy_migration_tests.rs`: focused Rust unit/integration tests.

### New Frontend Modules

- `src/types/testDesign.ts`: system-scoped design contracts.
- `src/types/execution.ts`: new run states, snapshots, reports, filters, and control commands.
- `src/api/testDesignBridge.ts`: typed Tauri commands for test design.
- `src/api/runBridge.ts`: typed Tauri commands and run event subscription.
- `src/context/ActiveRunContext.tsx`: global run state, polling/event recovery, and controls.
- `src/components/ActiveRunBar.tsx`: global visible execution strip.
- `src/components/SystemEnvironmentPicker.tsx`: scoped picker used only by test design and settings editors.
- `src/pages/TestDesignPage.tsx`: design list and detail shell.
- `src/pages/test-design/RequirementStage.tsx`, `GenerationStage.tsx`, `ReviewStage.tsx`, `RegressionStage.tsx`: lifecycle stages.
- `src/api/legacyMigration.ts`: one-time structured import from browser storage.

### New Sidecar Modules

- `sidecar/stagehand/protocol.js`: strict NDJSON request/response and error categories.
- `sidecar/stagehand/compiler.js`: constrained action and locator validation, including secret-placeholder rejection.
- `sidecar/stagehand/session.js`: one Stagehand session using Page/Locator, observe, act, and bounded agent.
- `sidecar/stagehand/worker.js`: long-lived command worker used by Rust.
- `sidecar/test/compiler.test.js`, `protocol.test.js`, `session.test.js`: Node tests with Stagehand mocked at the boundary.

## Task 1: Repository Hygiene Baseline

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `sidecar/package.json`
- Create: `scripts/audit-repo-hygiene.mjs`
- Create: `scripts/audit-repo-hygiene.test.mjs`

- [ ] **Step 1: Write the failing hygiene audit test**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyPath } from './audit-repo-hygiene.mjs'

test('classifies generated execution artifacts without hiding formal tests', () => {
  assert.equal(classifyPath('artifacts/runs/r1/trace.zip'), 'generated')
  assert.equal(classifyPath('sidecar/.stagehand/profile/Preferences'), 'generated')
  assert.equal(classifyPath('src/pages/TestCases.test.tsx'), 'source')
  assert.equal(classifyPath('src/agents/scriptExecutor.ts'), 'source')
})
```

- [ ] **Step 2: Run the test and verify the export is missing**

Run: `node --test scripts/audit-repo-hygiene.test.mjs`

Expected: FAIL because `classifyPath` is not exported.

- [ ] **Step 3: Implement the audit and ignore only generated paths**

```js
const GENERATED_PREFIXES = ['artifacts/', 'sidecar/.stagehand/', 'src-tauri/runtime/', 'migration-backups/']

export function classifyPath(path) {
  const normalized = path.replaceAll('\\', '/')
  return GENERATED_PREFIXES.some(prefix => normalized.startsWith(prefix)) ? 'generated' : 'source'
}

if (process.argv[1]?.endsWith('audit-repo-hygiene.mjs')) {
  const forbidden = process.argv.slice(2).filter(path => classifyPath(path) === 'generated')
  if (forbidden.length) {
    console.error(`Generated artifacts must not be committed:\n${forbidden.join('\n')}`)
    process.exitCode = 1
  }
}
```

Append these exact ignore entries:

```gitignore
# Generated browser execution artifacts
artifacts/runs/
sidecar/.stagehand/
src-tauri/runtime/
migration-backups/
coverage/
```

Add root script `"audit:hygiene": "node scripts/audit-repo-hygiene.mjs"` and sidecar script `"test": "node --test test/*.test.js"`.

- [ ] **Step 4: Verify hygiene and existing checks**

Run: `node --test scripts/audit-repo-hygiene.test.mjs`

Expected: PASS.

Run: `npm run lint`

Expected: PASS with no new errors.

- [ ] **Step 5: Audit and commit only hygiene files**

Run: `git check-ignore -v artifacts/runs/example/trace.zip sidecar/.stagehand/profile/Preferences coverage/index.html`

Expected: every generated path is matched; `git check-ignore src/pages/TestCases.test.tsx` returns no match.

Commit: `chore: enforce generated artifact hygiene`

## Task 2: System, Environment, and Test Design Schema

**Files:**
- Create: `src-tauri/src/test_design.rs`
- Create: `src-tauri/src/test_design_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/auth.rs`

- [ ] **Step 1: Write failing schema and cross-scope tests**

```rust
#[test]
fn creates_local_and_test_environments_and_rejects_cross_system_links() {
    let conn = test_connection();
    test_design::initialize_schema(&conn).unwrap();
    let system_a = test_design::create_system_record(&conn, "试用期转正系统").unwrap();
    let system_b = test_design::create_system_record(&conn, "招聘系统").unwrap();
    let local = test_design::create_environment_record(&conn, &system_a.id, "local", "http://127.0.0.1:5173").unwrap();
    assert_eq!(local.kind, "local");
    assert_eq!(test_design::create_environment_record(&conn, &system_a.id, "production", "https://prod.example").unwrap_err(), "INVALID_ENVIRONMENT_KIND");
    assert_eq!(test_design::create_design_record(&conn, &system_b.id, &local.id, "跨系统").unwrap_err(), "CROSS_SYSTEM_REFERENCE");
}
```

- [ ] **Step 2: Run the focused Rust test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_design_tests::creates_local_and_test_environments_and_rejects_cross_system_links`

Expected: FAIL because `test_design` does not exist.

- [ ] **Step 3: Implement schema and commands**

Define these public records with `camelCase` serialization:

```rust
pub struct TestSystem { pub id: String, pub name: String, pub created_at: String, pub updated_at: String }
pub struct SystemEnvironment { pub id: String, pub system_id: String, pub kind: String, pub name: String, pub base_url: String, pub is_enabled: bool }
pub struct TestDesign { pub id: String, pub system_id: String, pub environment_id: String, pub title: String, pub status: String, pub current_requirement_version_id: Option<String>, pub created_at: String, pub updated_at: String }
pub struct RequirementVersion { pub id: String, pub design_id: String, pub version_no: i64, pub source_kind: String, pub content: String, pub created_at: String }
pub struct GenerationBatch { pub id: String, pub design_id: String, pub requirement_version_id: String, pub model: String, pub template_id: Option<String>, pub created_at: String }
pub struct ReviewRecord { pub id: String, pub design_id: String, pub generation_batch_id: String, pub reviewer_id: String, pub conclusion: String, pub change_summary: String, pub created_at: String }
pub struct RegressionConfig { pub id: String, pub design_id: String, pub suite_id: Option<String>, pub account_combination_id: Option<String>, pub case_ids_json: String, pub updated_at: String }
```

Create tables with foreign keys and composite scope checks in record functions. Register list/create/update Tauri commands in `lib.rs`, and call `test_design::initialize_schema` wherever `auth::open_db` initializes testing tables.

- [ ] **Step 4: Verify schema and existing Rust behavior**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_design_tests`

Expected: PASS.

Run: `cargo test --manifest-path src-tauri/Cargo.toml testing_tests`

Expected: PASS.

- [ ] **Step 5: Clean and commit**

Confirm no temporary database is staged. Retain `testing.rs` because Task 3 migrates its scoped entities.

Commit: `feat: add system-scoped test design schema`

## Task 3: Scope Accounts, Scenarios, Suites, and Run Snapshots

**Files:**
- Modify: `src-tauri/src/testing.rs`
- Modify: `src-tauri/src/testing_tests.rs`
- Modify: `src/types/workflow.ts`
- Modify: `src/api/testingBridge.ts`
- Modify: `src/api/testingBridge.test.ts`

- [ ] **Step 1: Write failing Rust and TypeScript scope tests**

```rust
#[test]
fn refuses_a_run_when_scenario_and_account_combination_have_different_environments() {
    let fixture = scoped_fixture();
    let input = CreateWorkflowRunInput {
        scenario_id: fixture.local_scenario.id,
        account_combination_id: Some(fixture.test_combination.id),
        status: "queued".into(),
        current_step_order: 0,
        design_id: fixture.design.id,
        requirement_version_id: fixture.requirement.id,
    };
    assert_eq!(testing::create_workflow_run_record(&fixture.conn, &fixture.owner_id, &input).unwrap_err(), "CROSS_ENVIRONMENT_REFERENCE");
}
```

```ts
expect(mappedRun).toMatchObject({
  systemId: 'system-1',
  environmentId: 'env-test',
  designId: 'design-1',
  requirementVersionId: 'requirement-2',
})
```

- [ ] **Step 2: Run focused tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml refuses_a_run_when_scenario_and_account_combination_have_different_environments`

Run: `npm test -- src/api/testingBridge.test.ts`

Expected: both FAIL because scope fields are absent.

- [ ] **Step 3: Add scope columns and immutable run snapshots**

Extend accounts, combinations, scenarios, suites, runs, evidence, and defects with `system_id` and `environment_id`. Extend run creation with immutable `design_id`, `requirement_version_id`, and `snapshot_json`.

Use this frontend contract:

```ts
export interface ScopeRef {
  systemId: string
  environmentId: string
}

export interface WorkflowRunSnapshot extends ScopeRef {
  designId: string
  requirementVersionId: string
  scenarioId: string
  accountCombinationId?: string
  caseIds: string[]
}
```

All save/create record functions must load referenced rows and compare scope before writing.

- [ ] **Step 4: Verify scope behavior**

Run: `cargo test --manifest-path src-tauri/Cargo.toml testing_tests`

Run: `npm test -- src/api/testingBridge.test.ts src/types/workflow.test.ts`

Expected: PASS.

- [ ] **Step 5: Clean and commit**

Retain legacy nullable scope only for rows marked by the migration version; new commands reject missing scope.

Commit: `feat: enforce system and environment run scope`

## Task 4: Persisted Test Design Frontend Contracts

**Files:**
- Create: `src/types/testDesign.ts`
- Create: `src/api/testDesignBridge.ts`
- Create: `src/api/testDesignBridge.test.ts`
- Modify: `src/types/index.ts`
- Modify: `src/api/testCaseStore.ts`
- Modify: `src/api/testCaseStore.test.ts`

- [ ] **Step 1: Write failing bridge and stale-version tests**

```ts
it('creates a new requirement version without overwriting the previous version', async () => {
  invokeMock.mockResolvedValueOnce({ id: 'req-2', designId: 'd1', versionNo: 2, sourceKind: 'text', content: 'new', createdAt: 'now' })
  await expect(createRequirementVersion('d1', 'text', 'new')).resolves.toMatchObject({ id: 'req-2', versionNo: 2 })
  expect(invokeMock).toHaveBeenCalledWith('create_requirement_version', { designId: 'd1', sourceKind: 'text', content: 'new' })
})

it('marks cases from an older requirement as stale', () => {
  expect(isCaseSourceStale({ requirementVersionId: 'req-1' }, 'req-2')).toBe(true)
})
```

- [ ] **Step 2: Run focused frontend tests**

Run: `npm test -- src/api/testDesignBridge.test.ts src/api/testCaseStore.test.ts`

Expected: FAIL because the bridge and version fields do not exist.

- [ ] **Step 3: Implement typed commands and remove localStorage writes for new data**

Define `TestSystem`, `SystemEnvironment`, `TestDesign`, `RequirementVersion`, `GenerationBatch`, `ReviewRecord`, and `RegressionConfig` matching Rust camelCase responses. Add `designId`, `requirementVersionId`, and `generationBatchId` to `TestCase`.

Keep `testCaseStore.ts` read-only for legacy import:

```ts
export function loadLegacyTestCases(): TestCase[] {
  return readList<TestCase>('test_cases').filter(testCase => !isLegacyPlaceholderCase(testCase))
}

export function isCaseSourceStale(testCase: Pick<TestCase, 'requirementVersionId'>, currentVersionId?: string): boolean {
  return Boolean(currentVersionId && testCase.requirementVersionId !== currentVersionId)
}
```

New saves must call Tauri commands through `testDesignBridge.ts`; no new path writes `test_cases` localStorage.

- [ ] **Step 4: Verify contracts**

Run: `npm test -- src/api/testDesignBridge.test.ts src/api/testCaseStore.test.ts src/types/workflow.test.ts`

Expected: PASS.

- [ ] **Step 5: Clean and commit**

Retain `loadLegacyTestCases` only until Task 9 migration completes; note that deletion condition.

Commit: `feat: add persisted test design contracts`

## Task 5: Constrained Stagehand Protocol and Compiler

**Files:**
- Create: `sidecar/stagehand/protocol.js`
- Create: `sidecar/stagehand/compiler.js`
- Create: `sidecar/test/protocol.test.js`
- Create: `sidecar/test/compiler.test.js`
- Modify: `sidecar/package.json`

- [ ] **Step 1: Write failing protocol/compiler tests**

```js
test('rejects text masquerading as css and any secret placeholder', () => {
  assert.throws(() => compileStep({ action: 'click', locator: { kind: 'css', value: '我的试用期' } }), /INVALID_CSS_LOCATOR/)
  assert.throws(() => compileStep({ action: 'fill', locator: { kind: 'label', value: '密码' }, value: '{{employeePassword}}' }), /SECRET_PLACEHOLDER/)
  assert.throws(() => compileStep({ action: 'fill', locator: { kind: 'label', value: '密码' }, value: '${password}' }), /SECRET_PLACEHOLDER/)
})

test('accepts semantic locators and bounded agent requests', () => {
  assert.deepEqual(compileStep({ action: 'click', locator: { kind: 'role', value: 'button', name: '提交' } }).action, 'click')
  assert.equal(parseRequest(JSON.stringify({ id: '1', command: 'agent', goal: '提交表单', allowedOrigins: ['https://test.example'], maxActions: 6, timeoutMs: 30000 })).maxActions, 6)
})
```

- [ ] **Step 2: Run sidecar tests**

Run: `npm --prefix sidecar test`

Expected: FAIL because compiler and protocol modules do not exist.

- [ ] **Step 3: Implement the closed action model**

Use these exact allowed values:

```js
export const ACTIONS = new Set(['navigate', 'click', 'fill', 'select', 'press', 'wait', 'read', 'assert'])
export const LOCATORS = new Set(['role', 'label', 'text', 'placeholder', 'testId', 'css'])
export const SECRET_PATTERN = /\{\{[^}]*?(password|token|otp|secret)[^}]*\}\}|\$\{[^}]*?(password|token|otp|secret)[^}]*\}/i
```

Validate CSS with `CSS.escape`-independent parsing available in Stagehand's page context before execution; locally reject bare natural-language CSS and unsafe pseudo syntax. `parseRequest` must reject unknown fields, commands, origins, non-positive bounds, and payloads over 64 KiB. Return error categories `invalid_request`, `blocked`, `business_failed`, `cancelled`, and `interrupted`.

- [ ] **Step 4: Verify compiler and package lock**

Run: `npm --prefix sidecar test`

Expected: PASS.

Run: `npm --prefix sidecar install --package-lock-only --ignore-scripts`

Expected: lock file remains consistent.

- [ ] **Step 5: Clean and commit**

Confirm no sidecar profile or trace is staged.

Commit: `feat: add constrained Stagehand command protocol`

## Task 6: Stagehand-Only Session Worker

**Files:**
- Create: `sidecar/stagehand/session.js`
- Create: `sidecar/stagehand/worker.js`
- Create: `sidecar/test/session.test.js`
- Modify: `sidecar/index.js`
- Modify: `sidecar/session.js`
- Modify: `sidecar/package.json`
- Modify: `sidecar/package-lock.json`

- [ ] **Step 1: Write failing session routing tests**

```js
test('uses deterministic locators before observe and bounds agent execution', async () => {
  const fake = createFakeStagehand()
  const session = createSession({ stagehand: fake, allowedOrigins: ['https://test.example'] })
  await session.execute({ action: 'click', locator: { kind: 'role', value: 'button', name: '提交' } })
  assert.equal(fake.page.getByRole.mock.calls.length, 1)
  assert.equal(fake.observe.mock.calls.length, 0)
  await assert.rejects(() => session.agent({ goal: '完成审批', maxActions: 21, timeoutMs: 30000 }), /AGENT_BOUND_EXCEEDED/)
})
```

- [ ] **Step 2: Run focused sidecar test**

Run: `npm --prefix sidecar test -- test/session.test.js`

Expected: FAIL because `createSession` does not exist.

- [ ] **Step 3: Implement one long-lived Stagehand session**

`session.js` must expose:

```js
export function createSession({ stagehand, allowedOrigins, emit = () => {} }) {
  return {
    execute: step => executeCompiledStep(stagehand, allowedOrigins, step, emit),
    observe: request => observeCandidates(stagehand, allowedOrigins, request),
    act: request => runBoundedAct(stagehand, allowedOrigins, request),
    agent: request => runBoundedAgent(stagehand, allowedOrigins, request),
    close: () => stagehand.close(),
  }
}
```

`worker.js` reads one NDJSON request per line and writes one response per line. It initializes one Stagehand v3 local session, validates allowed origins before and after navigation, emits progress events, and closes on `terminate` or stdin end. Keep secrets on a separate Rust-owned login command; worker requests reject credential fields.

Move reusable Stagehand code out of monolithic `index.js`. Do not delete direct Playwright yet; mark the old command dispatcher compatibility-only for Task 10.

- [ ] **Step 4: Verify Stagehand worker**

Run: `npm --prefix sidecar test`

Expected: PASS.

Run: `node sidecar/stagehand/worker.js --self-check`

Expected JSON line: `{"ok":true,"stagehand":true}`.

- [ ] **Step 5: Clean and commit**

Retain direct Playwright only behind the existing compatibility entry point; record “remove after Task 10 parity suite”.

Commit: `feat: add persistent Stagehand browser worker`

## Task 7: Rust-Owned Run Manager and State Machine

**Files:**
- Create: `src-tauri/src/run_manager.rs`
- Create: `src-tauri/src/run_manager_tests.rs`
- Modify: `src-tauri/src/testing.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src/types/execution.ts`
- Create: `src/api/runBridge.ts`
- Create: `src/api/runBridge.test.ts`

- [ ] **Step 1: Write failing state transition and recovery tests**

```rust
#[test]
fn pause_finishes_the_atomic_action_before_unlocking() {
    let fixture = manager_fixture();
    let run = fixture.manager.enqueue(fixture.request()).unwrap();
    fixture.manager.mark_preflight_complete(&run.id).unwrap();
    fixture.manager.request_pause(&run.id).unwrap();
    assert_eq!(fixture.manager.get(&run.id).unwrap().status, "pause_requested");
    fixture.manager.complete_action(&run.id, 2).unwrap();
    let paused = fixture.manager.get(&run.id).unwrap();
    assert_eq!(paused.status, "paused");
    assert_eq!(paused.checkpoint_step_order, 2);
    assert!(!fixture.guard.is_locked());
}

#[test]
fn startup_marks_unrecoverable_active_runs_interrupted() {
    let fixture = manager_fixture_with_persisted_run("running");
    fixture.manager.recover().unwrap();
    assert_eq!(fixture.manager.get(&fixture.run_id).unwrap().status, "interrupted");
}
```

- [ ] **Step 2: Run focused Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml run_manager_tests`

Expected: FAIL because the manager does not exist.

- [ ] **Step 3: Implement durable states and commands**

Use this state enum and terminal classification:

```rust
pub enum RunStatus {
    Queued,
    Preflight,
    Running,
    PauseRequested,
    Paused,
    WaitingHandoff,
    Passed,
    BusinessFailed,
    Blocked,
    Cancelled,
    Interrupted,
}

impl RunStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Passed | Self::BusinessFailed | Self::Blocked | Self::Cancelled | Self::Interrupted)
    }
}
```

Persist every transition and checkpoint before emitting Tauri events. Expose `start_run`, `pause_run`, `resume_run`, `terminate_run`, `get_run`, `list_runs`, and `list_active_runs`. Queue tasks when the single browser lease is occupied. Add bounded exponential retry for model HTML, HTTP 429, timeout, and connection failures; final classification is `blocked`.

- [ ] **Step 4: Verify Rust and bridge behavior**

Run: `cargo test --manifest-path src-tauri/Cargo.toml run_manager_tests testing_tests`

Run: `npm test -- src/api/runBridge.test.ts`

Expected: PASS.

- [ ] **Step 5: Clean and commit**

Remove frontend-only transition helpers made unreachable by `runBridge`; retain old workflow commands until Task 10 report migration.

Commit: `feat: move execution lifecycle into Rust run manager`

## Task 8: Credential Boundary and Browser Interaction Guard

**Files:**
- Create: `src-tauri/src/interaction_guard.rs`
- Create: `src-tauri/src/interaction_guard_tests.rs`
- Modify: `src-tauri/src/browser.rs`
- Modify: `src-tauri/src/testing.rs`
- Modify: `src-tauri/src/run_manager.rs`
- Modify: `sidecar/stagehand/worker.js`
- Modify: `sidecar/test/protocol.test.js`

- [ ] **Step 1: Write failing secret and lock-order tests**

```rust
#[test]
fn run_cannot_enter_running_without_the_browser_lock() {
    let fixture = manager_fixture_with_guard_failure();
    let error = fixture.manager.finish_preflight(&fixture.run_id).unwrap_err();
    assert_eq!(error, "BROWSER_INTERACTION_LOCK_UNAVAILABLE");
    assert_eq!(fixture.manager.get(&fixture.run_id).unwrap().status, "blocked");
}

#[test]
fn credential_payload_is_destroyed_after_login() {
    let payload = EphemeralCredentialPayload::new("user", "secret");
    let probe = payload.zeroize_probe();
    drop(payload);
    assert!(probe.was_zeroized());
}
```

- [ ] **Step 2: Run focused security-boundary tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml interaction_guard_tests`

Run: `npm --prefix sidecar test -- test/protocol.test.js`

Expected: FAIL because the guard and explicit credential rejection are absent.

- [ ] **Step 3: Implement lock ownership, marker, watchdog, and isolated login**

Define the platform contract:

```rust
pub trait InteractionGuard: Send + Sync {
    fn acquire(&self, run_id: &str, browser_pid: u32) -> Result<GuardLease, String>;
    fn release(&self, lease: GuardLease) -> Result<(), String>;
    fn force_release_stale(&self) -> Result<(), String>;
}
```

The dedicated browser title and injected fixed top strip display run/system/environment/step. Lock after preflight and before `running`; unlock on paused, waiting handoff, blocked, cancelled, interrupted, passed, and business failed. Watchdog releases stale leases at startup and after worker exit.

Keep login in Rust using the existing OS keyring retrieval. Send credentials only through an inherited, one-use local IPC handle or environment value to the login subprocess, zeroize it after fill, and reject `password`, `token`, `otp`, `secret`, `credential`, or placeholder-shaped fields in normal Stagehand worker requests.

- [ ] **Step 4: Verify lock and secret behavior**

Run: `cargo test --manifest-path src-tauri/Cargo.toml interaction_guard_tests run_manager_tests testing_tests`

Run: `npm --prefix sidecar test`

Expected: PASS; emitted events and captured test logs contain neither `secret` nor credential values.

- [ ] **Step 5: Clean and commit**

Delete any test credential file produced by manual checks. No keyring dump, screenshot, or browser profile may be staged.

Commit: `feat: protect controlled browser and credential boundary`

## Task 9: System-Scoped Test Design UI and Legacy Import

**Files:**
- Create: `src/components/SystemEnvironmentPicker.tsx`
- Create: `src/components/SystemEnvironmentPicker.test.tsx`
- Create: `src/pages/TestDesignPage.tsx`
- Create: `src/pages/TestDesignPage.test.tsx`
- Create: `src/pages/test-design/RequirementStage.tsx`
- Create: `src/pages/test-design/GenerationStage.tsx`
- Create: `src/pages/test-design/ReviewStage.tsx`
- Create: `src/pages/test-design/RegressionStage.tsx`
- Create: `src/api/legacyMigration.ts`
- Create: `src-tauri/src/legacy_migration.rs`
- Create: `src-tauri/src/legacy_migration_tests.rs`
- Modify: `src/App.tsx`
- Modify: `src/pages/TestCases.tsx`
- Modify: `src/pages/TestCases.test.tsx`

- [ ] **Step 1: Write failing lifecycle and import tests**

```tsx
it('switches the design dataset only inside test design', async () => {
  render(<TestDesignPage canManageAccounts />)
  await user.selectOptions(screen.getByLabelText('系统'), 'system-b')
  expect(listDesignsMock).toHaveBeenLastCalledWith('system-b', 'env-b-test')
  expect(screen.queryByText('系统 A 的设计')).not.toBeInTheDocument()
})

it('shows stale cases after a new requirement version is saved', async () => {
  render(<TestDesignPage canManageAccounts />)
  await user.click(screen.getByRole('button', { name: '保存新版本' }))
  expect(await screen.findByText('来源已过期')).toBeInTheDocument()
})
```

```rust
#[test]
fn legacy_import_is_idempotent_and_uses_historical_design_for_missing_requirements() {
    let fixture = migration_fixture();
    let first = legacy_migration::import(&fixture.conn, fixture.payload()).unwrap();
    let second = legacy_migration::import(&fixture.conn, fixture.payload()).unwrap();
    assert_eq!(first.imported_cases, 1);
    assert_eq!(second.imported_cases, 0);
    assert_eq!(fixture.design_title_for_legacy_case(), "历史导入设计单");
}
```

- [ ] **Step 2: Run focused UI and migration tests**

Run: `npm test -- src/pages/TestDesignPage.test.tsx src/components/SystemEnvironmentPicker.test.tsx`

Run: `cargo test --manifest-path src-tauri/Cargo.toml legacy_migration_tests`

Expected: FAIL because the new page and importer do not exist.

- [ ] **Step 3: Build design list/detail and one-time import**

Replace the loose wizard with design list plus detail lifecycle. Keep the four stages but bind all reads and writes to the selected `designId`. Requirement save creates a new version; generation records a batch; review records confirmation; regression stage creates a background run and navigates to execution center.

`legacyMigration.ts` reads existing `test_cases`, suites, and legacy report keys once, sends a structured payload to Rust, then writes a migration marker only after Rust returns verified counts. Environment inference rules are: localhost/127.0.0.1 -> local; configured shared domain -> test; otherwise put the record in a migration quarantine table and require explicit local/test classification before creating formal design records.

Route only `testdesign` through the system/environment picker. Dashboard, execution, reports, issues, and settings remain global.

- [ ] **Step 4: Verify design behavior**

Run: `npm test -- src/pages/TestDesignPage.test.tsx src/components/SystemEnvironmentPicker.test.tsx src/pages/TestCases.test.tsx src/App.test.tsx`

Run: `cargo test --manifest-path src-tauri/Cargo.toml legacy_migration_tests test_design_tests`

Expected: PASS.

- [ ] **Step 5: Clean and commit**

Delete wizard-only state helpers and tests that assert obsolete transient behavior. Keep meaningful generation/review regression tests under the new page. Retain read-only legacy loader until migration telemetry confirms completion.

Commit: `feat: add system-scoped test design lifecycle`

## Task 10: Global Run Bar, Execution Center, Reports, and Issues

**Files:**
- Create: `src/context/ActiveRunContext.tsx`
- Create: `src/context/ActiveRunContext.test.tsx`
- Create: `src/components/ActiveRunBar.tsx`
- Create: `src/components/ActiveRunBar.test.tsx`
- Modify: `src/components/Layout.tsx`
- Modify: `src/components/WorkflowRunConsole.tsx`
- Modify: `src/components/WorkflowRunConsole.test.tsx`
- Modify: `src/pages/ExecutionCenter.tsx`
- Modify: `src/pages/Reports.tsx`
- Create: `src/pages/Reports.test.tsx`
- Modify: `src/pages/IssueTracker.tsx`
- Modify: `src/pages/IssueTracker.test.tsx`
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: Write failing navigation-survival and classification tests**

```tsx
it('keeps run controls visible after navigating away from execution center', async () => {
  render(<AuthenticatedAppForTest initialRun={runningRun} />)
  await user.click(screen.getByRole('button', { name: '测试报告' }))
  expect(screen.getByRole('status', { name: '自动化执行中' })).toHaveTextContent('试用期转正系统')
  expect(screen.getByRole('button', { name: '暂停执行' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '终止执行' })).toBeEnabled()
})

it.each(['passed', 'business_failed', 'blocked', 'cancelled', 'interrupted'])('shows terminal run %s in reports', async status => {
  listRunsMock.mockResolvedValue([{ ...baseRun, id: status, status }])
  render(<Reports />)
  expect(await screen.findByTestId(`run-${status}`)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run focused UI tests**

Run: `npm test -- src/context/ActiveRunContext.test.tsx src/components/ActiveRunBar.test.tsx src/pages/Reports.test.tsx src/pages/IssueTracker.test.tsx`

Expected: FAIL because global run state and complete terminal statuses are absent.

- [ ] **Step 3: Implement global state and unified report behavior**

Mount `ActiveRunProvider` above page switching. On mount, call `listActiveRuns`; subscribe to Tauri run events; after reconnect, reload active run and events by `runId`. `ActiveRunBar` renders system, environment, suite, current step, progress, view browser, pause/resume, and terminate according to status.

Execution center, reports, dashboard, and issues query all systems and apply explicit system/environment/status/time filters. Reports display all terminal statuses. Only `business_failed` enables defect draft creation and business screenshot evidence; `blocked`, `cancelled`, and `interrupted` display operational diagnostics without defect actions.

- [ ] **Step 4: Verify UI and build**

Run: `npm test -- src/context/ActiveRunContext.test.tsx src/components/ActiveRunBar.test.tsx src/components/WorkflowRunConsole.test.tsx src/pages/Reports.test.tsx src/pages/IssueTracker.test.tsx src/App.test.tsx`

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Clean and commit**

Delete `TaskExecutionConsole.tsx` only if `rg "TaskExecutionConsole" src` finds no production import and its covered behavior exists in `ActiveRunBar`/`WorkflowRunConsole`. Delete obsolete tests with it; do not ignore them.

Commit: `feat: add global persistent execution controls and reports`

## Task 11: Stagehand Cutover, Legacy Removal, Documentation, and Release Gate

**Files:**
- Modify: `sidecar/index.js`
- Modify: `sidecar/session.js`
- Delete when parity passes: `src/agents/scriptExecutor.ts`
- Delete when parity passes: `src/agents/stagehandExecutor.ts`
- Delete when parity passes: `src/agents/executorEngine.ts`
- Modify: `src/pages/TestCases.tsx`
- Modify: `src/pages/TestCases.test.tsx`
- Modify: `src-tauri/src/browser.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `sidecar/package.json`
- Modify: `sidecar/package-lock.json`
- Modify: `README.md`
- Modify: `sidecar/README.md`
- Modify: `开发文档.md`
- Modify: `.gitignore`
- Create: `docs/migrations/system-scoped-stagehand-v1.md`

- [ ] **Step 1: Write the failing parity and forbidden-path audits**

Add a Stagehand mocked parity suite covering login handoff, semantic click/fill, invalid selector rejection, role switch orchestration, business assertion failure, model 429 blocking, safe pause, resume revalidation, cancellation, and report persistence.

Add these exact static assertions to `scripts/audit-repo-hygiene.test.mjs`:

```js
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

async function readProductionSources(root = process.cwd()) {
  const roots = ['src', 'src-tauri/src', 'sidecar']
  const allowed = new Set(['.ts', '.tsx', '.rs', '.js'])
  const files = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'test') await walk(absolute)
      } else if (allowed.has(path.extname(entry.name)) && !entry.name.includes('.test.')) {
        files.push(absolute)
      }
    }
  }
  for (const directory of roots) await walk(path.join(root, directory))
  return (await Promise.all(files.map(file => readFile(file, 'utf8')))).join('\n')
}

test('production source no longer imports removed browser executors', async () => {
  const forbidden = ['scriptExecutor', 'stagehandExecutor', 'executorEngine', "require('playwright')", 'connectOverCDP']
  const source = await readProductionSources()
  for (const token of forbidden) assert.equal(source.includes(token), false, token)
})
```

- [ ] **Step 2: Run the full gate and confirm it fails on legacy paths**

Run: `npm test`

Run: `npm --prefix sidecar test`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: behavior tests pass, forbidden-path audit FAILS while old imports/dependencies remain.

- [ ] **Step 3: Remove old production paths and complete migration documentation**

Route all production browser execution through `run_manager -> stagehand/worker.js`. Remove direct browser command registrations that are no longer used, then delete the three old frontend executors and their obsolete mocks. Remove direct `playwright` from `sidecar/package.json` only after `npm ls --prefix sidecar playwright` proves Stagehand does not require it as a peer for the selected local engine; if Stagehand declares an optional peer, keep no application import and document why the transitive package remains.

Delete legacy JSON/localStorage report writes after migration verification. Keep only the idempotent historical importer for one deprecation cycle, with a documented removal version.

Update README, sidecar README, developer documentation, and migration guide with Stagehand runtime, system/environment behavior, Tauri commands, keyring use, report storage, rollback, and cleanup policy.

- [ ] **Step 4: Run the complete release verification**

Run: `npm test`

Run: `npm --prefix sidecar test`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Run: `npm run check`

Run: `npm run prepare:sidecar`

Run in PowerShell:

```powershell
$stagedFiles = git diff --cached --name-only
npm run audit:hygiene -- $stagedFiles
```

Expected: all commands PASS; forbidden-path audit finds no production direct Playwright/custom CDP/old executor imports; sidecar preparation succeeds.

- [ ] **Step 5: Perform final cleanup audit and commit**

Run these read-only checks:

```powershell
rg -n "scriptExecutor|stagehandExecutor|executorEngine|connectOverCDP|require\(['\"]playwright['\"]\)|logicguard_reports_|localStorage" src src-tauri sidecar
git status --short --ignored
git diff --cached --name-only
git diff --cached --check
```

Classify every match: remove obsolete production code, retain documented migration compatibility, or ignore only generated artifacts. Verify no secrets, screenshots, traces, browser profiles, local databases, or migration backups are staged.

Commit: `refactor: complete Stagehand-only execution cutover`

## Final Acceptance

- [ ] Create one local and one test environment under the same system and verify design data never crosses environments.
- [ ] Create a second system and verify only Test Design changes scope; global execution/report/issues/settings still show all systems with filters.
- [ ] Start a run, navigate through every sidebar page, refresh the frontend, and verify the run continues with controls restored.
- [ ] Verify running locks the dedicated browser and shows the controlled marker; safe pause unlocks it; resume revalidates state and locks again; terminate unlocks it.
- [ ] Verify a secret placeholder is rejected before browser execution and no real secret appears in AI requests, logs, screenshots, events, or reports.
- [ ] Verify natural-language text cannot reach CSS query execution.
- [ ] Simulate HTML gateway response, 429, timeout, and lost browser connection; each becomes retryable `blocked` without creating an issue.
- [ ] Simulate a business assertion failure; it creates a report, redacted evidence, and one issue draft.
- [ ] Verify passed, business failed, blocked, cancelled, and interrupted runs all appear in reports.
- [ ] Import legacy cases and reports twice; counts are stable, missing-source cases belong to “历史导入设计单”, and backups remain recoverable.
- [ ] Confirm Stagehand is the only production browser SDK path and all obsolete direct executors are deleted.
- [ ] Run the full release verification and repository hygiene audit with a clean staged set.
