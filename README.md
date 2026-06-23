# LogicGuard AI

全链路 AI 自动化测试桌面应用。在本地通过 CDP 控制 Chrome，结合 **云端大语言模型**（推荐 **DeepSeek 付费 API**）与 [Stagehand](https://github.com/browserbase/stagehand) 实现自然语言驱动的浏览器测试、场景模板回归与失败自愈。

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│  Tauri 桌面应用 (React)                                  │
│  Dashboard · Templates · Reports · Settings             │
└────────────────────┬────────────────────────────────────┘
                     │ Tauri invoke
┌────────────────────▼────────────────────────────────────┐
│  Rust 后端 (llm.rs / browser.rs / reports.rs)           │
└────────┬───────────────────────────────┬────────────────┘
         │ HTTPS                          │ 子进程 JSON
         ▼                                ▼
┌─────────────────┐              ┌──────────────────────┐
│ DeepSeek API    │  ← 推荐      │ sidecar (Playwright  │
│ (付费云端推理)   │              │ + Stagehand)         │
└─────────────────┘              └──────────┬───────────┘
                                            │ CDP
                                            ▼
                                   ┌─────────────────┐
                                   │ Chrome :9222    │
                                   └─────────────────┘
```

浏览器在本地执行；AI 推理**推荐云端接入**，无需自建家里算力。本地 Ollama 可作为降本备选，但对 Stagehand 复杂任务能力有限。

**三种执行模式**（Dashboard 可切换）：

| 模式 | 说明 |
| --- | --- |
| **Stagehand**（默认） | 自然语言目标 → Stagehand 闭环 Agent 自主执行 |
| **Script** | LLM 一次生成测试脚本 → 确定性回放，失败时 Stagehand 愈合 |
| **Classic** | Planner 拆解计划 → 逐步 LLM 决策 → Healer 文本重试 |

详细设计见 [开发文档.md](./开发文档.md)。

## 快速开始

### 环境要求

- Node.js 18+
- Rust（Tauri 构建）
- Google Chrome
- DeepSeek API Key（[platform.deepseek.com](https://platform.deepseek.com)）

### 安装与运行

```bash
# 克隆仓库后，安装前端依赖
npm install

# 安装 Sidecar 依赖（Playwright + Stagehand，必需）
cd sidecar && npm install && cd ..

# 开发模式启动
npm run tauri dev
```

### 首次配置（推荐：DeepSeek）

1. 打开 **Settings**，配置 LLM：
   - Provider：`openai_compat`
   - Base URL：`https://api.deepseek.com`
   - Model：`deepseek-chat`
   - API Key：你的 DeepSeek 密钥
2. 点击 **测试连接** 确认可用
3. 点击 **启动 Chrome（CDP）**，或手动运行：
   ```bash
   chrome.exe --remote-debugging-port=9222 --user-data-dir="%APPDATA%\LogicGuardAI\ChromeProfile"
   ```
4. 在 **Dashboard** 输入自然语言测试任务，默认 Stagehand 模式即可开始

> 也可改用 Gemini、通义千问等 OpenAI 兼容端点；本地 Ollama 见 [零成本部署附录.md](./零成本部署附录.md)（可选，能力有限）。

### 生产构建

```bash
npm run tauri build
```

## 文档

| 文档 | 说明 |
| --- | --- |
| [开发文档.md](./开发文档.md) | 权威技术文档：架构、API、DeepSeek 配置、故障排查 |
| [零成本部署附录.md](./零成本部署附录.md) | **可选**本地 Ollama + Tailscale（非主力方案） |
| [sidecar/README.md](./sidecar/README.md) | Sidecar 命令与依赖说明 |

## 项目结构

```
src/           React 前端与执行编排 (agents/)
src-tauri/     Rust 后端
sidecar/       Playwright + Stagehand 浏览器引擎
```

## 常见问题

- **CDP 连接失败 `ECONNREFUSED ::1:9222`**：先启动 Chrome CDP，使用 `127.0.0.1` 而非 `localhost`
- **Stagehand 依赖缺失**：在 `sidecar/` 目录执行 `npm install`
- **LLM 连接失败**：确认 DeepSeek API Key 有效，Base URL 为 `https://api.deepseek.com`（无需手动加 `/v1`）
- 更多见 [开发文档 §13.2](./开发文档.md#132-常见问题faq)

## 技术栈

React · Vite · Tailwind CSS · Tauri 2 · Playwright · Stagehand · DeepSeek API · Rust

## 许可证

私有项目 — LogicGuard AI 开发团队
