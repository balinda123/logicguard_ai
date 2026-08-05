# 测试设计入口与旧数据归档实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在测试设计页提供管理员快速创建“系统 + 首个环境”的入口，并把旧试用期数据幂等归入“试用期管理”系统。

**Architecture:** Rust 侧新增事务型创建命令和独立的结构迁移；前端用独立弹窗承载表单，并由选择器刷新及自动选中新范围。迁移在数据库初始化后运行，保留旧 localStorage 导入逻辑但统一默认系统和测试域名。

**Tech Stack:** React、TypeScript、Vitest、Tauri 2、Rust、rusqlite、Tailwind CSS

---

### Task 1: 原子创建系统和环境

**Files:**
- Modify: `src-tauri/src/test_design.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/test_design_tests.rs`
- Modify: `src/types/testDesign.ts`
- Modify: `src/api/testDesignBridge.ts`
- Test: `src/api/testDesignBridge.test.ts`

- [ ] **Step 1: 写失败测试**

Rust 测试调用 `create_system_with_environment_record`，验证管理员一次得到系统和环境、远程 HTTP 返回 `HTTPS_REQUIRED`、普通用户返回 `ADMIN_REQUIRED`、环境重复时事务不留下孤立系统。桥接测试验证调用 `create_system_with_environment` 且参数保持 camelCase。

- [ ] **Step 2: 运行失败测试**

Run: `cargo test test_design_tests:: --manifest-path src-tauri/Cargo.toml`
Expected: FAIL，缺少新函数或类型。

- [ ] **Step 3: 最小实现**

新增输入和返回类型：

```rust
pub struct CreateSystemWithEnvironmentInput {
    pub system_name: String,
    pub kind: String,
    pub environment_name: String,
    pub base_url: String,
}

pub struct SystemEnvironmentScope {
    pub system: TestSystem,
    pub environment: SystemEnvironment,
}
```

在单个 `TransactionBehavior::Immediate` 事务中校验并插入两条记录；远程地址仅允许 HTTPS，本地地址允许 localhost/127.0.0.1/::1 的 HTTP。Tauri 命令先读取当前用户角色，再调用记录层函数。

- [ ] **Step 4: 运行测试并提交**

Run: `cargo test test_design_tests:: --manifest-path src-tauri/Cargo.toml`
Expected: PASS。

Commit: `功能：支持原子创建系统和首个环境`

### Task 2: 试用期管理结构迁移

**Files:**
- Modify: `src-tauri/src/test_design.rs`
- Modify: `src-tauri/src/auth.rs`
- Modify: `src-tauri/src/legacy_migration.rs`
- Modify: `src-tauri/src/legacy_migration_tests.rs`
- Modify: `src/api/legacyMigration.ts`

- [ ] **Step 1: 写失败测试**

覆盖仅旧系统时保留 ID 重命名；新旧并存时把旧设计及直接环境引用移到目标系统；复用规范测试环境；重复执行不重复；无 URL 旧用例进入规范测试环境，本地 URL 进入本地环境。

- [ ] **Step 2: 运行失败测试**

Run: `cargo test legacy_migration_tests:: --manifest-path src-tauri/Cargo.toml`
Expected: FAIL，尚无结构迁移或默认值不符。

- [ ] **Step 3: 最小实现**

新增幂等函数 `ensure_trial_management_scope`，规范值为：

```rust
const TRIAL_SYSTEM_NAME: &str = "试用期管理";
const LEGACY_TRIAL_SYSTEM_NAME: &str = "试用期转正系统";
const TRIAL_TEST_BASE_URL: &str = "https://onboardingtest.oa.wanmei.net";
```

在事务中完成别名重命名或合并、环境复用/迁移、设计引用更新和规范测试环境补齐；`open_db` 完成表结构初始化后调用。浏览器迁移默认系统改为“试用期管理”，共享测试 URL 使用规范域名。

- [ ] **Step 4: 运行测试并提交**

Run: `cargo test legacy_migration_tests:: --manifest-path src-tauri/Cargo.toml`
Expected: PASS。

Commit: `功能：归档试用期历史测试数据`

### Task 3: 快速创建弹窗与清晰入口

**Files:**
- Create: `src/components/QuickCreateSystemDialog.tsx`
- Create: `src/components/QuickCreateSystemDialog.test.tsx`
- Modify: `src/components/SystemEnvironmentPicker.tsx`
- Modify: `src/components/SystemEnvironmentPicker.test.tsx`
- Modify: `src/pages/TestDesignPage.tsx`
- Modify: `src/pages/TestDesignPage.test.tsx`

- [ ] **Step 1: 写失败测试**

覆盖管理员看到 `+`、普通用户不显示、弹窗提交后自动选中新范围、失败保留输入、无系统和无环境空状态，以及“新建设计”文字按钮。

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- src/components/QuickCreateSystemDialog.test.tsx src/components/SystemEnvironmentPicker.test.tsx src/pages/TestDesignPage.test.tsx`
Expected: FAIL，组件和入口尚不存在。

- [ ] **Step 3: 最小实现**

`QuickCreateSystemDialog` 管理四个字段、客户端必填提示、提交忙碌态和后端错误。`SystemEnvironmentPicker` 接收 `canCreate`，在系统选择器旁显示图标按钮，成功后刷新列表并调用 `onChange(result)`。`TestDesignPage` 传入管理员权限，并把原图标按钮改为带文字的“新建设计”；无设计时显示可操作空状态。

- [ ] **Step 4: 运行测试并提交**

Run: `npm test -- src/components/QuickCreateSystemDialog.test.tsx src/components/SystemEnvironmentPicker.test.tsx src/pages/TestDesignPage.test.tsx`
Expected: PASS。

Commit: `功能：优化测试设计创建入口`

### Task 4: 文档同步与最终验证

**Files:**
- Modify: `README.md`
- Modify: `OpenMontage使用指南.md`
- Modify: `开发文档.md`
- Modify: `docs/test-design-migration.md`
- Modify: `零成本部署附录.md`

- [ ] **Step 1: 同步现状**

记录测试设计入口、系统级隔离、仅 local/test 两类环境、快速创建权限、四阶段数据流和试用期历史数据归档；删除旧 `TestCases` 页面、模板工作区、套件按钮及需求 URL 建模说明。

- [ ] **Step 2: 扫描过时描述**

Run: `rg -n "TestCases|需求 URL|预发环境|一键执行套件|加入当前套件" README.md OpenMontage使用指南.md 开发文档.md docs/test-design-migration.md 零成本部署附录.md`
Expected: 无不符合当前实现的命中。

- [ ] **Step 3: 最终定向验证**

Run: `npm test -- src/components/QuickCreateSystemDialog.test.tsx src/components/SystemEnvironmentPicker.test.tsx src/pages/TestDesignPage.test.tsx src/api/testDesignBridge.test.ts`

Run: `cargo test test_design_tests:: legacy_migration_tests:: --manifest-path src-tauri/Cargo.toml`

Expected: 全部 PASS。

- [ ] **Step 4: 检查并提交**

确认 `git status --short` 中用户已有的 `src-tauri/Cargo.toml` 不在暂存区，检查 `git diff --cached` 后提交。

Commit: `文档：同步系统级测试设计使用说明`
