# 面向新手的测试执行流程实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复执行测试导致桌面应用退出的问题，恢复卡片式用例编辑删除和按选择执行，并统一小白可理解的界面文案。

**Architecture:** 保留现有 `TestDesignPage` 生命周期和 Rust/SQLite 所有权边界，将用例卡片、编辑表单和执行选择拆成聚焦组件。Rust 端通过软删除、payload 更新和测试集合配置扩展现有 `test_design` 接口；Windows 窗口枚举回调改为不跨 FFI 传播 panic。内部类型和数据库概念保持不变，用户可见文案单独集中维护。

**Tech Stack:** React 19、TypeScript、Vitest、Tauri 2、Rust、rusqlite、windows-sys、Tailwind CSS、lucide-react

---

## 文件结构

- 新建 `src/pages/test-design/TestCaseCard.tsx`：检查与执行阶段复用的卡片展示。
- 新建 `src/pages/test-design/EditTestCaseDialog.tsx`：编辑完整用例 payload。
- 新建 `src/constants/userFacingCopy.ts`：集中维护面向新手的导航、阶段和运行状态文案。
- 修改 `src/pages/test-design/ReviewStage.tsx`：卡片列表及编辑、删除、确认入口。
- 修改 `src/pages/test-design/RegressionStage.tsx`：测试集合、勾选范围和执行按钮。
- 修改 `src/pages/TestDesignPage.tsx`：持久化编辑/归档/集合，仅生成所选用例的执行计划并显示错误。
- 修改 `src/api/testDesignBridge.ts`、`src/types/testDesign.ts`：新增 payload 更新和集合名称字段。
- 修改 `src-tauri/src/test_design.rs`、`src-tauri/src/lib.rs`：实现持久化命令和归属校验。
- 修改 `src-tauri/src/interaction_guard.rs`：消除 Windows FFI 回调 panic 边界。
- 修改导航、执行页、报告和运行控制组件：只调整用户可见名称。
- 更新 `README.md`、`开发文档.md`：同步当前行为和崩溃隔离边界。

### Task 1: 阻止 Windows 浏览器窗口枚举带崩应用

**Files:**
- Modify: `src-tauri/src/interaction_guard.rs`
- Modify: `src-tauri/src/interaction_guard_tests.rs`

- [ ] **Step 1: 写失败测试，证明回调异常必须转成失败结果**

在 `interaction_guard_tests.rs` 增加一个针对平台无关回调包装器的测试：

```rust
#[test]
fn window_enumeration_callback_failure_is_reported_without_unwinding() {
    assert_eq!(callback_outcome(|| panic!("enumeration failed")), 0);
    assert_eq!(callback_outcome(|| ()), 1);
}
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cargo test interaction_guard_tests::window_enumeration_callback_failure_is_reported_without_unwinding --manifest-path src-tauri/Cargo.toml`

Expected: FAIL，提示 `callback_outcome` 不存在。

- [ ] **Step 3: 用线程本地状态替代 LPARAM 裸指针**

在 Windows 平台模块中引入 `RefCell`、`catch_unwind` 和 `AssertUnwindSafe`，实现：

```rust
fn callback_outcome(action: impl FnOnce()) -> BOOL {
    catch_unwind(AssertUnwindSafe(action)).map(|_| 1).unwrap_or(0)
}

thread_local! {
    static ENUMERATION: RefCell<Option<Enumeration>> = const { RefCell::new(None) };
}

unsafe extern "system" fn enum_window(hwnd: HWND, _parameter: LPARAM) -> BOOL {
    callback_outcome(|| ENUMERATION.with(|slot| {
        let mut state = slot.borrow_mut();
        let Some(state) = state.as_mut() else { return };
        let mut owner_pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut owner_pid);
        if owner_pid == state.pid && IsWindowVisible(hwnd) != 0 {
            state.windows.push(hwnd as WindowHandle);
        }
    }))
}
```

`top_level_windows` 在调用 `EnumWindows` 前写入线程本地 `Enumeration`，调用后无论成功失败都取出并清空；返回 0 时返回 `LOCK_UNAVAILABLE`，不得 panic。

- [ ] **Step 4: 运行 Rust 定向测试**

Run: `cargo test interaction_guard --manifest-path src-tauri/Cargo.toml`

Expected: PASS，窗口锁测试和新增 panic 隔离测试全部通过。

### Task 2: 增加用例编辑、软删除与测试集合持久化

**Files:**
- Modify: `src-tauri/src/test_design.rs`
- Modify: `src-tauri/src/test_design_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types/testDesign.ts`
- Modify: `src/api/testDesignBridge.ts`
- Modify: `src/api/testDesignBridge.test.ts`

- [ ] **Step 1: 写 Rust 失败测试**

覆盖三个行为：更新 payload 后状态为 `draft`；归档用例不出现在默认列表；测试集合拒绝包含其他设计或未确认用例。

```rust
let updated = update_design_test_case_record(&conn, "owner-1", &UpdateDesignTestCaseInput {
    design_id: design.id.clone(), case_id: case_id.clone(), payload: json!({"id":case_id,"title":"已修改"}),
})?;
assert_eq!(updated.status, "draft");

update_design_case_status_record(&conn, "owner-1", &UpdateDesignCaseStatusInput {
    design_id: design.id.clone(), case_id: case_id.clone(), status: "archived".into(),
})?;
assert!(list_design_test_cases_record(&conn, "owner-1", &design.id)?.is_empty());
```

- [ ] **Step 2: 运行失败测试**

Run: `cargo test test_design_tests --manifest-path src-tauri/Cargo.toml`

Expected: FAIL，缺少 `UpdateDesignTestCaseInput` 和集合校验。

- [ ] **Step 3: 实现 Rust 数据接口**

新增 `UpdateDesignTestCaseInput { design_id, case_id, payload }`。更新前验证设计归属和 payload 对象，强制 payload 内 `id` 为 `case_id`、`status` 为 `draft`，同时更新列状态。默认列表 SQL 增加 `status <> 'archived'`。

为 `regression_configs` 增加可迁移的 `name TEXT NOT NULL DEFAULT '默认测试集合'`，保存配置时解析 `case_ids_json`，确保 ID 无重复、属于同一设计且状态为 `confirmed`。在 `lib.rs` 注册 `update_design_test_case`。

- [ ] **Step 4: 写前端桥接失败测试并实现类型映射**

```ts
await updateDesignTestCase({ designId: 'design-1', caseId: 'case-1', payload: { id: 'case-1', title: '已修改' } })
expect(invoke).toHaveBeenCalledWith('update_design_test_case', { input: expect.objectContaining({ caseId: 'case-1' }) })
```

`RegressionConfig` 增加 `name`，`CreateRegressionConfigInput` 接收 `name`，并新增 `UpdateDesignTestCaseInput`。

- [ ] **Step 5: 运行桥接与 Rust 测试**

Run: `npm test -- src/api/testDesignBridge.test.ts`

Run: `cargo test test_design_tests --manifest-path src-tauri/Cargo.toml`

Expected: PASS。

### Task 3: 恢复卡片式检查、编辑和删除

**Files:**
- Create: `src/pages/test-design/TestCaseCard.tsx`
- Create: `src/pages/test-design/EditTestCaseDialog.tsx`
- Modify: `src/pages/test-design/ReviewStage.tsx`
- Create: `src/pages/test-design/ReviewStage.test.tsx`
- Modify: `src/pages/TestDesignPage.tsx`
- Modify: `src/pages/TestDesignPage.test.tsx`

- [ ] **Step 1: 写失败的卡片交互测试**

```tsx
render(<ReviewStage cases={[confirmedCase]} staleCount={0} reviewing={false}
  onApprove={approve} onEdit={edit} onDelete={remove} />)
expect(screen.getByRole('article', { name: confirmedCase.title })).toBeVisible()
await user.click(screen.getByRole('button', { name: `编辑 ${confirmedCase.title}` }))
expect(edit).toHaveBeenCalledWith(confirmedCase)
await user.click(screen.getByRole('button', { name: `删除 ${confirmedCase.title}` }))
expect(remove).toHaveBeenCalledWith(confirmedCase)
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- src/pages/test-design/ReviewStage.test.tsx`

Expected: FAIL，缺少卡片和编辑删除按钮。

- [ ] **Step 3: 实现复用卡片和编辑表单**

`TestCaseCard` 使用独立圆角卡片展示标签、风险点、前置条件、步骤和预期结果；详情用 `<details>` 折叠。操作使用 lucide `Pencil`、`Trash2`、`Check` 图标并提供 `aria-label`、`title`。

`EditTestCaseDialog` 编辑标题、风险点、前置条件、步骤动作/预期和总体预期；保存输出新的 `TestCase`，明确写入 `status: 'draft'`。

- [ ] **Step 4: 在页面接入持久化编辑和软删除**

`editCase` 调用 `updateDesignTestCase` 后替换 state；`deleteCase` 使用中文确认框，确认后调用 `updateDesignCaseStatus(...archived)` 并从 state 移除。两者捕获错误并写入页面 notice，不能留下永久 busy 状态。

- [ ] **Step 5: 运行卡片和页面测试**

Run: `npm test -- src/pages/test-design/ReviewStage.test.tsx src/pages/TestDesignPage.test.tsx`

Expected: PASS。

### Task 4: 只执行用户所选用例并保存测试集合

**Files:**
- Modify: `src/pages/test-design/RegressionStage.tsx`
- Create: `src/pages/test-design/RegressionStage.test.tsx`
- Modify: `src/pages/TestDesignPage.tsx`
- Modify: `src/pages/TestDesignPage.test.tsx`

- [ ] **Step 1: 写选择范围失败测试**

```tsx
render(<RegressionStage cases={[caseA, caseB]} selectedIds={new Set()}
  collectionName="核心流程" running={false} onSelectionChange={select} onCollectionNameChange={rename}
  onSaveCollection={save} onRun={run} />)
expect(screen.getByRole('button', { name: '执行所选用例（0 条）' })).toBeDisabled()
await user.click(screen.getByRole('checkbox', { name: `选择 ${caseA.title}` }))
expect(select).toHaveBeenCalledWith(new Set([caseA.id]))
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- src/pages/test-design/RegressionStage.test.tsx`

Expected: FAIL，当前组件没有选择属性。

- [ ] **Step 3: 实现选择和测试集合界面**

顶部工具栏包含集合名称、保存按钮、全选、清空和 `已选择 X / Y 条`。下方继续使用 `TestCaseCard`，每张卡片左上角有稳定尺寸复选框。主按钮为 `执行所选用例（X 条）`。

- [ ] **Step 4: 页面只基于 selectedCases 创建任务**

`runTests` 先校验选择非空和 URL；保存 `name + selectedIds`；随后只对 `selectedCases` 调用 `safeGoal`，快照写入 `suiteName`、`caseIds`。每个阶段 `catch` 后显示：

```ts
setNotice(`无法开始测试：${friendlyRunError(error)}`)
```

不得跳转到“测试运行”，除非 `startRun` 返回 runId。

- [ ] **Step 5: 运行选择和页面测试**

Run: `npm test -- src/pages/test-design/RegressionStage.test.tsx src/pages/TestDesignPage.test.tsx`

Expected: PASS，并断言 `startRun` 只收到选中用例对应的命令。

### Task 5: 统一面向新手的全局文案

**Files:**
- Create: `src/constants/userFacingCopy.ts`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/TestDesignPage.tsx`
- Modify: `src/pages/test-design/RequirementStage.tsx`
- Modify: `src/pages/test-design/ReviewStage.tsx`
- Modify: `src/pages/test-design/RegressionStage.tsx`
- Modify: `src/pages/ExecutionCenter.tsx`
- Modify: `src/components/ActiveRunBar.tsx`
- Modify: `src/components/WorkflowRunConsole.tsx`
- Modify: `src/pages/Reports.tsx`
- Modify: `src/api/runPresentation.ts`
- Create: `src/constants/userFacingCopy.test.ts`
- Modify: `src/pages/TestDesignPage.test.tsx`
- Modify: `src/components/ActiveRunBar.test.tsx`
- Modify: `src/components/WorkflowRunConsole.test.tsx`

- [ ] **Step 1: 写失败的文案契约测试**

在 `userFacingCopy.test.ts` 中断言完整术语映射；在三个现有页面/组件测试中断言 `设计测试`、`测试运行`、`执行测试`、`停止测试`，并断言对应旧名称不再显示。

- [ ] **Step 2: 运行相关测试并确认失败**

Run: `npm test -- src/pages/TestDesignPage.test.tsx src/components/ActiveRunBar.test.tsx src/components/WorkflowRunConsole.test.tsx`

Expected: FAIL，仍显示旧术语。

- [ ] **Step 3: 添加集中式文案并替换用户界面**

```ts
export const USER_COPY = {
  testDesign: '设计测试', requirement: '需求内容', reviewCases: '检查用例',
  runTests: '执行测试', testCollection: '测试集合', testRuns: '测试运行',
  runDetails: '本次执行信息', blocked: '无法继续', handoff: '等待人工操作', stop: '停止测试',
} as const
```

只替换用户可见标题、按钮、空状态和状态标签，不改路由 id、Rust 枚举、数据库列或日志协议。

- [ ] **Step 4: 运行文案相关测试**

Run: `npm test -- src/constants/userFacingCopy.test.ts src/pages/TestDesignPage.test.tsx src/components/ActiveRunBar.test.tsx src/components/WorkflowRunConsole.test.tsx`

Expected: PASS。

### Task 6: 文档与最终验证

**Files:**
- Modify: `README.md`
- Modify: `开发文档.md`

- [ ] **Step 1: 同步产品和架构文档**

README 说明卡片检查、测试集合和仅执行所选用例；开发文档说明软删除、payload 更新、集合校验以及 Windows 回调不能 panic 的边界。

- [ ] **Step 2: 运行前端测试与类型检查**

Run: `npm test -- src/pages/TestDesignPage.test.tsx src/pages/test-design/ReviewStage.test.tsx src/pages/test-design/RegressionStage.test.tsx src/api/testDesignBridge.test.ts`

Run: `npm run build`

Expected: 全部 PASS，TypeScript 与 Vite 构建成功。

- [ ] **Step 3: 运行 Rust 测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: 全部 PASS，无 panic 或 abort。

- [ ] **Step 4: 运行仓库检查**

Run: `git diff --check`

Expected: 无错误；仅允许已有换行符提示。

- [ ] **Step 5: 手动验证关键路径**

启动开发版后验证：编辑已确认用例会退回待确认；删除后卡片消失；勾选两条时按钮显示 2 条且后台任务只有两条命令；未启动受控浏览器或窗口锁不可用时显示“无法开始测试”，应用不退出。
