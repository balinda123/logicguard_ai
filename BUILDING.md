# 测试小助手安装包构建

## 通用要求

- Node.js 22（构建脚本会拒绝其他主版本）
- Rust stable
- 使用 `npm ci` 安装根目录依赖
- Chrome 或 Microsoft Edge 用于 Stagehand 本地 CDP 自动化；Windows 自动执行必须使用应用启动的专用浏览器

sidecar 不依赖用户电脑上的 Node.js。`npm run prepare:sidecar` 会把当前平台的 Node Runtime、sidecar 和生产依赖复制到 Tauri resources。

## Windows x64

在 x64 Windows 和 Node 22 环境中运行：

```powershell
npm ci
npm run check
npm run bundle:windows
```

安装程序输出到：

```text
src-tauri/target/release/bundle/nsis/测试小助手_0.1.0_x64-setup.exe
```

## macOS Apple Silicon

必须在 Apple Silicon Mac 和 arm64 Node 22 环境中运行：

```bash
npm ci
rustup target add aarch64-apple-darwin
npm run check
npm run bundle:macos
```

输出位于 `src-tauri/target/aarch64-apple-darwin/release/bundle/`。

当前 DMG 未签名、未公证。首次打开时需要在 Finder 中右键应用并选择“打开”，或在“系统设置 → 隐私与安全性”中允许打开。面向外部用户发布前应配置 Apple Developer ID 签名与 notarization。

## 发布检查

1. 在未安装 Node.js 的干净系统上安装。
2. 确认 `resources/runtime` 中 Node 版本为 22。
3. 首次启动创建管理员并登录。
4. 创建普通用户，分别配置 API Key，确认数据互相隔离。
5. 启动受控浏览器，验证 CDP、任务取消和报告生成。
6. 覆盖升级后确认账号、系统凭据和报告仍然存在。
