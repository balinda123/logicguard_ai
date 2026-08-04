# 自动登录元素识别 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让自动登录无需手填选择器，并让表单错误在当前编辑卡片中清晰可见。

**Architecture:** React 表单将选择器收进可选高级区域；Rust 继续独占凭据并把非敏感模型配置传给 Sidecar；Sidecar 按“手工选择器、本地语义规则、AI observe”顺序定位元素，最终始终由 Playwright 本地填入凭据。

**Tech Stack:** React 19、TypeScript、Vitest、Tauri 2/Rust、Node.js、Playwright、Stagehand。

---

### Task 1: 前端账号表单

**Files:**
- Modify: `src/components/TestAccountsPanel.tsx`
- Test: `src/components/TestAccountsPanel.test.tsx`

- [ ] 先新增失败测试：高级设置默认折叠，不填选择器仍可保存自动登录账号。
- [ ] 新增失败测试：缺少凭据时，编辑卡片内出现 `role="alert"`，字段具有 `aria-invalid` 且首个错误字段获得焦点。
- [ ] 实现折叠高级设置、字段级错误和成功/失败状态分离。
- [ ] 运行 `npm test -- src/components/TestAccountsPanel.test.tsx`，期望全部通过。

### Task 2: Sidecar 登录定位策略

**Files:**
- Modify: `sidecar/session.js`
- Modify: `sidecar/session.node.js`
- Modify: `sidecar/index.js`

- [ ] 先新增失败测试：登录 payload 接受空选择器。
- [ ] 先新增失败测试：手工选择器优先，本地语义规则次之，本地失败时才调用 AI resolver。
- [ ] 实现跨页面/iframe 的可见元素查找和三段式定位。
- [ ] 在 `login_with_credentials` 中提供 Stagehand observe resolver，指令不得包含凭据。
- [ ] 运行 `node --test sidecar/session.node.js`，期望全部通过。

### Task 3: 模型配置桥接

**Files:**
- Modify: `src/api/testingBridge.ts`
- Test: `src/api/testingBridge.test.ts`
- Modify: `src-tauri/src/browser.rs`

- [ ] 先修改桥接测试，要求 `browser_login_test_account` 接收当前 LLM 配置且没有用户名、密码字段，并观察旧实现失败。
- [ ] 前端传入 `getLlmConfig()`；Rust 将选择器改为可选并通过 `run_sidecar_with_config` 注入模型配置和登录 payload。
- [ ] 运行 `npm test -- src/api/testingBridge.test.ts` 和 `cargo check --manifest-path src-tauri/Cargo.toml`。

### Task 4: 文档与回归验证

**Files:**
- Modify: `README.md`
- Modify: `开发文档.md`
- Modify: `sidecar/README.md`

- [ ] 更新自动登录配置、定位优先级和凭据不进入 AI 的说明。
- [ ] 搜索并移除“自动登录必须填写选择器”等过时说明。
- [ ] 运行定向测试、`npm run build` 和 Rust 编译检查，记录真实结果。
