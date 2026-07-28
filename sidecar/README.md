# LogicGuard Sidecar

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
