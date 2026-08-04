# LogicGuard Sidecar

## Persistent Stagehand worker

`stagehand/worker.js` is the NDJSON worker entry for the Rust-owned execution
lifecycle. It may also be started through the compatibility CLI:

```bash
node index.js stagehand-worker
```

The worker initializes one local Stagehand v3 session, consumes one JSON request
per stdin line, and writes protocol JSON only to stdout. Progress uses a separate
`{ id, event: "progress", data }` envelope; every request still receives exactly
one terminal success or error envelope. Diagnostics go to stderr. `terminate` or
stdin EOF closes the Stagehand session.

Production resources include the complete `sidecar/stagehand` directory but not
`sidecar/test`. The legacy Playwright dispatcher and credential-login helpers are
compatibility-only and must remain until the Task 10 parity and migration gates
prove that all production browser execution uses this worker.

Worker requests never accept credential, password, token, OTP, or secret fields
or values. Login remains a separate Rust-owned compatibility flow. Deterministic
steps use Stagehand v3 Page/Locator APIs; semantic `observe`, single-boundary
`act`, and bounded `agent` are used only by their explicit protocol commands.

Sidecar 是 LogicGuard AI 的 Node.js 浏览器自动化子进程，由 Tauri Rust 后端调用，负责连接 Chrome/Edge 的 CDP、执行 Playwright 操作，并在需要时调用 Stagehand/Agent 能力。

安装版会内置 Node Runtime、sidecar 脚本和生产依赖。最终用户不需要安装 Node.js，也不需要进入本目录执行 `npm install`。

## 安装版运行方式

打包时由 `npm run prepare:sidecar:*` 将以下内容复制到 Tauri resources：

- 对应平台的 Node Runtime。
- `sidecar/index.js` 及相关脚本。
- sidecar 生产依赖。

运行时 Rust 后端只从应用资源目录定位这些文件，不再依赖项目源码目录。

## 开发调试

只有在直接调试 sidecar CLI 时，才需要在项目源码中安装依赖：

```bash
cd sidecar
npm install
node index.js check --port=9222
```

产品主流程请优先从 Tauri 应用启动和调用 sidecar，避免开发命令与安装版行为不一致。

## 调用格式

```bash
node index.js <command> [--port=<cdp-port>] [--key=value ...]
```

stdout 最后一行返回 JSON：

```json
{ "ok": true, "data": { "...": "..." } }
```

失败时：

```json
{ "ok": false, "error": "..." }
```

`agent` 命令会额外输出 `[AGENT_STEP]{...}` 行，Rust 后端会同时读取 stdout/stderr 并解析进度。

## 受限 Stagehand 协议

`stagehand/protocol.js` 和 `stagehand/compiler.js` 定义了供持久化 worker 使用的 NDJSON 请求边界。当前模块已经实现并可独立测试；Task 6 接入 `stagehand/worker.js` 后才会替代现有兼容 CLI 路径。

- 每个请求是一行 JSON，UTF-8 编码后最多 64 KiB；顶层必须是对象，未知命令和未知字段会被拒绝。
- 命令闭集为 `execute`、`observe`、`act`、`agent`、`terminate`、`self_check`。
- 确定性动作闭集为 `navigate`、`click`、`fill`、`select`、`press`、`wait`、`read`、`assert`；定位器闭集为 `role`、`label`、`text`、`placeholder`、`testId`、`css`。
- `act` 和 `agent` 必须携带允许 origin 与正整数超时。远程 origin 仅允许 HTTPS；HTTP 仅允许显式的 `localhost`、`127.0.0.1` 或 `::1`。`agent.maxActions` 范围为 1 到 20。
- 协议响应使用 `{ id, ok, data }` 或 `{ id, ok: false, error: { category, code, message } }`。错误类别仅为 `invalid_request`、`blocked`、`business_failed`、`cancelled`、`interrupted`，错误消息在输出前脱敏。

普通 Stagehand 请求的 key 或字符串 value 不能包含 `password`、`token`、`otp`、`secret` 或 `credential`，也不能包含对应的 `{{...}}` / `${...}` 秘密占位符。登录凭据继续只走 Rust 管理的独立登录路径，不进入该协议。

CSS locator 在编译阶段只执行保守的结构和安全预检：中文自然语言等非 selector 输入、未配对结构、selector 列表和危险伪类会以稳定错误码 `INVALID_CSS_LOCATOR` 提前拒绝。这不是完整 CSS parser。Task 6 的 session 必须在执行前使用页面上下文中的浏览器原生 locator/DOM selector 解析再次确认；预检通过不代表 selector 已被浏览器接受。

## 命令速查

| 命令 | 用途 |
| --- | --- |
| `check` | 检查 sidecar、浏览器和 CDP 连接状态 |
| `get_snapshot` | 获取页面结构化快照 |
| `get_page_content` | 获取页面文本/内容 |
| `click` / `hover` / `type` / `press` | 基础元素操作 |
| `navigate` | URL 导航 |
| `select` | 下拉选择 |
| `wait_for` | 等待元素或状态 |
| `assert` | 文本断言 |
| `screenshot` | 截图到文件 |
| `clear_session` | 清除 cookies、localStorage、sessionStorage，并回到安全初始页 |
| `login_with_credentials` | 仅由 Rust 通过临时环境变量调用的自动登录命令，不接收命令行凭据 |
| `act` | Stagehand 单步自然语言操作 |
| `observe` | Stagehand 页面观察 |
| `agent` | Stagehand 闭环 Agent 执行 |

## 模型环境变量

这些变量由 Rust 后端按当前登录用户配置注入，sidecar 不负责保存 API Key。

| 变量 | 说明 |
| --- | --- |
| `LLM_PROVIDER` | `openai_compat` 或 `gemini` |
| `LLM_MODEL` | 当前用户选择的模型 |
| `LLM_API_KEY` | 从 Windows Credential Manager 或 macOS Keychain 读取后临时注入 |
| `LLM_BASE_URL` | OpenAI Compatible 服务地址 |

API Key 不应写入 localStorage、SQLite、日志、报告或本目录文件。测试账号登录凭据同样只由 Rust 从系统凭据库读取，并通过短生命周期 `LG_BROWSER_LOGIN_PAYLOAD` 环境变量传给 `login_with_credentials`；sidecar 不输出用户名、密码、验证码或令牌。

## CDP 与浏览器约定

- CDP 端口由 Rust 统一分配和传入，不再固定为 `9222`。
- sidecar 连接 `127.0.0.1`，避免 `localhost` 被解析到 IPv6 `::1` 后连接失败。
- 浏览器 Profile 使用系统应用数据目录下的 LogicGuard 专用目录。
- Windows 支持 Chrome/Edge 常见安装路径；macOS Apple Silicon 支持 Chrome/Edge `.app` 路径检测。

## 退出清理

应用退出、任务取消或超时时，Rust 后端负责终止 sidecar 子进程和由应用启动的浏览器进程。sidecar 侧应避免产生脱离父进程管理的长期后台任务。
