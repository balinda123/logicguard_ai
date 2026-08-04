# LogicGuard Stagehand Sidecar

生产执行只有一个入口：Rust `RunManager` 启动 `index.js stagehand-worker`，入口随后加载 `stagehand/worker.js`。旧的一次性 CLI 已删除，前端不能直接调用浏览器动作。

## 协议

worker 在同一 Stagehand v3 会话内逐行读取 NDJSON。每个请求最多 64 KiB，只产生一个终态响应；进度使用独立的 `{ id, event: "progress", data }` 包络。stdout 只承载协议，诊断写 stderr，并由 Rust 限长、脱敏。

允许的命令为 `execute`、`observe`、`act`、`agent`、`set_control_marker`、`remove_control_marker`、`self_check`、`terminate`。确定性动作闭集为 `navigate`、`click`、`fill`、`select`、`press`、`wait`、`read`、`assert`；定位器闭集为 `role`、`label`、`text`、`placeholder`、`testId`、`css`。

`act` 和 `agent` 必须声明允许 origin 与超时，`agent.maxActions` 为 1 到 20。远程 origin 只允许 HTTPS，本地开发可使用显式 localhost、127.0.0.1 或 ::1 HTTP。CSS 先经过保守编译检查，再由浏览器原生 selector parser 验证。

## 安全边界

- 普通 worker 请求拒绝 `password`、`token`、`otp`、`secret`、`credential` 字段、值和占位符。
- API Key 由 Rust 从操作系统凭据库读取，只在启动 worker 时注入环境，不进入计划、快照、事件、SQLite 或日志。
- 测试账号密码同样保存在操作系统凭据库；自动登录和人工接管由 Rust 执行边界协调，密码不进入 Stagehand 普通协议。
- 自动登录由 Rust 启动一次性 `stagehand/login-worker.js`。账号密码只通过该子进程的短生命周期环境值传入，登录 worker 使用 Stagehand Page/Locator API，不开放 NDJSON 命令；完成或失败后立即清空环境入口并退出。
- 控制标识只接受系统、环境、运行编号和当前步骤，使用 `textContent` 渲染固定“自动化执行中”提示。
- Windows 仅锁定应用启动并记录 PID 的专用浏览器窗口。外部 CDP 浏览器无法建立可信窗口锁，会在预检阶段阻断。

## 生命周期

Rust 持有运行状态、浏览器 lease、worker PID、暂停检查点和取消信号。暂停只在原子命令结束并落盘后生效；暂停、人工接管和所有终态都会释放浏览器输入锁。EOF 或 `terminate` 关闭 Stagehand 会话。

运行快照可包含 `accountOrchestration`：system/environment、组合 ID、非敏感账号元数据，以及按 command index 排序的角色步骤。角色变化时 Rust 依据快照选择账号；自动模式读取 keyring，SSO/OTP、缺少凭据/locator 或登录结果需要验证码时进入 `waiting_handoff`。恢复时先使用快照中的成功 locator 校验当前页面身份，再重新申请浏览器输入锁并继续原 checkpoint。

## 依赖与打包

`@browserbasehq/stagehand` 是唯一浏览器自动化 API。`playwright` 目前仍保留在生产依赖和锁文件中，因为 Stagehand 本地 CDP 运行时依赖其浏览器基础能力；应用源码不得直接 import/require Playwright，也不得直接调用 `connectOverCDP`。

`npm run prepare:sidecar` 会复制内置 Node 22、`index.js`、完整 `stagehand/` 目录和生产依赖到 Tauri resources。`sidecar/test` 不进入安装资源。生成的 resources、profile、trace、截图和 coverage 均由 `.gitignore` 与仓库审计排除。

环境变量：`LOGICGUARD_CDP_URL`、`LOGICGUARD_ALLOWED_ORIGINS`、`LLM_PROVIDER`、`LLM_MODEL`、`LLM_BASE_URL`、`LLM_API_KEY`。最终用户无需单独安装 Node.js。
