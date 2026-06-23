# LogicGuard Sidecar

Node.js 浏览器控制子进程，由 Tauri Rust 后端（`src-tauri/src/browser.rs`）调度。通过 CDP 协议附着用户 Chrome，执行 Playwright 操作与 Stagehand AI 命令。

完整协议与架构说明见 [开发文档 §5.3](../开发文档.md#53-sidecar-命令参考)。

## 安装

```bash
cd sidecar
npm install
```

Stagehand 3.4+ 需要 `@ai-sdk/*` 系列包，均已列入 `package.json`。若报错 `Cannot find package '@ai-sdk/...'`，请重新执行 `npm install`。

## 调用方式

```bash
node index.js <command> [--port=9222] [--key=value ...]
```

**响应**（stdout 最后一行）：

```json
{ "ok": true, "data": { ... } }
{ "ok": false, "error": "..." }
```

`agent` 命令额外输出 `[AGENT_STEP]{...}` 行供 Rust 流式解析。

## 命令速查

| 命令 | 说明 |
| --- | --- |
| `get_snapshot` | 页面结构化快照（AX + DOM） |
| `click` / `hover` / `type` / `press` | 元素操作，支持 `--strategy` + `--value` 七级定位 |
| `navigate` | URL 导航 |
| `select` | 下拉选择 |
| `wait_for` | 等待元素 |
| `assert` | 文本断言 |
| `screenshot` | 截图到文件（未接入 Tauri） |
| `act` | Stagehand 单步自然语言操作 |
| `observe` | Stagehand 观察页面 |
| `agent` | Stagehand 闭环 Agent（产品默认路径） |

## 环境变量（Stagehand 命令）

由 Rust 后端注入：

| 变量 | 说明 |
| --- | --- |
| `LLM_PROVIDER` | `openai_compat`（**DeepSeek 推荐**）/ `gemini` / `ollama` / `anthropic` |
| `LLM_MODEL` | 如 `deepseek-chat` |
| `LLM_API_KEY` | DeepSeek 等平台 API Key |
| `LLM_BASE_URL` | 如 `https://api.deepseek.com`（OpenAI 兼容端点） |

## CDP 要求

- Chrome 须以 `--remote-debugging-port=9222` 启动
- 连接使用 `127.0.0.1`，避免 `localhost` → `::1` 导致连接失败
- 验证：`curl http://127.0.0.1:9222/json/version`

## 日志

Script 模式定位失败后的 Stagehand 愈合日志：`../stagehand_healer.log`（项目根目录）。
