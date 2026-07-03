# 测试小助手

测试小助手是一个 Windows / macOS 桌面自动化测试工具。用户用自然语言描述任务，应用通过云端大模型生成操作，再由本机 Playwright + Stagehand sidecar 连接 Chrome CDP 执行。

## 当前能力

- Stagehand Agent 当前主执行路径
- 确定性 Script、Classic Planner/Generator/Healer 代码保留为备用能力，当前 UI 不暴露切换入口
- “测试设计”：将需求来源、场景模板、测试用例和回归套件串成一条流程，支持直接从需求生成用例，也支持基于场景模板扩展用例
- 回归套件：已确认用例可加入套件并一键批量执行，执行结果写入用户报告
- 用例执行优先走确定性 Script 生成与回放，适合沉淀发版前回归流程
- 场景模板、参数集、执行日志、自愈记录和测试报告
- 报告包含管理摘要、风险等级、发版建议、失败复现路径和技术日志
- 本地管理员/普通用户登录
- 管理员用户列表、创建用户、禁用用户和重置密码
- 系统设置页展示本机数据存储位置，并可打开应用数据目录
- 按用户隔离模型配置、模板和报告
- API Key 保存到 Windows Credential Manager 或 macOS Keychain
- 模型提供商提供 DeepSeek、OpenAI、通义千问、Kimi、智谱、豆包、Gemini、Ollama 和自定义 OpenAI Compatible 预设
- 数据安全模式默认“严格脱敏”，发送给模型前会遮蔽手机号、身份证、邮箱、银行卡、薪资、部门等敏感值
- 安装包内置 Node.js 22 和 sidecar，运行端无需安装 Node.js
- Windows x64 NSIS 安装包
- macOS Apple Silicon `.app` / `.dmg` 构建支持（当前未签名）

当前版本不依赖 PocketBase、Tailscale、Ollama 或其他自建服务。每个用户配置自己的 Gemini 或 OpenAI Compatible API Key。

## 架构

```text
React / Tauri WebView
        │ invoke / event
        ▼
Rust 后端
  ├─ 本地登录：SQLite + Argon2id
  ├─ 系统凭据：Credential Manager / Keychain
  ├─ 云模型请求
  ├─ 用户报告存储
  └─ sidecar 进程管理
        │ JSON Lines + CDP
        ▼
内置 Node.js 22 + Playwright + Stagehand
        │
        ▼
Chrome / Edge
```

## 安装版首次使用

1. 安装并启动测试小助手。
2. 首次启动创建本机管理员账号。
3. 管理员可在“系统设置”中创建普通用户。
4. 当前用户配置模型 Provider、Model、Base URL（如需要）和自己的 API Key。
5. 点击“测试并保存配置”。
6. 设置 CDP 端口并点击“一键启动受控浏览器”。
7. 在浏览器中完成目标系统登录，然后开始自动化任务。
8. 如需部门测试流程，进入“测试设计”页粘贴需求，或先从需求文档建模生成场景模板，再生成并确认用例，最后加入回归套件执行。

API Key 不写入 localStorage、SQLite、日志或报告。登录是本机应用级隔离，不用于抵御拥有操作系统管理员权限的攻击者。
人事测试环境默认按敏感数据处理；严格脱敏只能降低传给模型的文本风险，仍建议测试环境使用虚构员工数据。

## 本地开发

### 环境要求

- Node.js `22.x`
- Rust stable
- Google Chrome 或 Microsoft Edge

```bash
npm ci
npm run lint
npm run build
npm run tauri dev
```

开发模式允许使用项目根目录下的 `sidecar/` 和系统 Node；发布模式只使用安装包内资源。

## 构建安装包

Windows x64：

```powershell
npm run bundle:windows
```

输出：`src-tauri/target/release/bundle/nsis/测试小助手_0.1.0_x64-setup.exe`

macOS Apple Silicon：

```bash
npm run bundle:macos
```

macOS 包必须在 Apple Silicon Mac 上构建。当前包未签名、未公证，首次打开需要通过 Finder 右键“打开”或在“隐私与安全性”中允许。

完整构建与发布检查见 [BUILDING.md](./BUILDING.md)。

## 项目结构

```text
src/                       React 页面、API 桥接和执行编排
src-tauri/src/             Rust 命令、登录、模型、报告和浏览器控制
sidecar/                   Playwright + Stagehand 浏览器引擎
scripts/                   前端构建与 sidecar 资源准备脚本
src-tauri/resources/       构建时生成的内置 Runtime（不提交）
.codex/skills/             项目开发技能与文档同步规范
```

## 文档

- [开发文档.md](./开发文档.md)：当前实现、接口、数据、安全和开发规范
- [零成本部署附录.md](./零成本部署附录.md)：不部署服务器的安装与维护方案
- [BUILDING.md](./BUILDING.md)：Windows / macOS 安装包构建步骤
- [sidecar/README.md](./sidecar/README.md)：sidecar 命令协议

## 常见问题

- **提示未配置 API Key**：登录当前用户后到“系统设置”保存并测试密钥；顶部状态栏也提供“去设置”快捷入口。
- **CDP 连接失败**：先点击“一键启动受控浏览器”，并确认端口未被占用。
- **安装版提示 sidecar 资源缺失**：重新安装应用；发布版不会回退到系统 Node。
- **macOS 无法直接打开**：当前为内部未签名包，按上面的 Gatekeeper 说明操作。
- **构建提示 Node 版本错误**：切换到 Node 22 后重新执行 `npm ci`。
- **本地运行报 `CustomEvent is not defined`**：当前终端仍在使用旧版 Node。确认 `node -v` 为 `22.x` 后重新执行 `npm ci` 和 `npm run tauri dev`。

## 技术栈

React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · Tauri 2 · Rust · SQLite · Argon2id · Playwright · Stagehand

## 许可证

私有项目 — 测试小助手
