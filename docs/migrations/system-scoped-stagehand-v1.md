# 系统级测试设计与 Stagehand v1 迁移

## 生效范围

本版本把测试设计绑定到明确的系统和环境。每个系统只有管理员维护的“本地启动”和“测试环境”两类环境；执行中心、测试报告和问题跟踪仍是跨系统公共视图，通过系统、环境、状态和时间筛选。

四阶段不再保存独立页面状态。需求版本、生成批次、测试用例、审核记录和回归配置共享同一个 `designId` 并写入 SQLite。需求更新会产生新版本，旧批次保留但标记为过期。

## 执行切换

生产执行链固定为：

```text
UI -> Tauri start_run -> Rust RunManager -> sidecar/stagehand/worker.js -> Stagehand -> 专用 Chrome CDP
```

旧前端脚本执行器、前端 Stagehand 执行器、DOM + LLM executor、一次性 Playwright sidecar 命令和 JSON 报告写入均已删除。Rust 只保留专用浏览器启动、连接探测和资源定位；它们不执行测试步骤。

运行和事件写入 SQLite `execution_runs` / `execution_events`。报告直接读取终态运行及持久事件，不再生成 `logicguard_reports_<user>.json`。只有 `business_failed` 可形成业务缺陷；`blocked`、`cancelled`、`interrupted` 是执行诊断。

## 凭据与浏览器控制

API Key 和测试账号凭据保存在 Windows Credential Manager 或 macOS Keychain。计划、快照、普通 Stagehand 请求、事件、报告和日志拒绝秘密字段或占位符。Rust 使用短生命周期值启动 worker，并在使用后清零内存。

Windows 自动执行只接受由应用启动并记录 PID 的专用浏览器。运行时页面显示固定“自动化执行中”标识，目标浏览器窗口禁止用户输入；暂停、人工接管和所有终态释放窗口。外部 CDP 会话因无法证明窗口归属而阻断。macOS/Linux 尚不提供等价输入锁，因此自动执行当前标记为不支持。

## 旧数据导入

`legacyMigration.ts` 仅在迁移时读取旧 localStorage 用例、套件和报告，交给 Rust 事务导入、去重和对账。localhost 归入本地启动环境，共享测试域名归入测试环境，未知域名进入隔离区。只有 Rust 返回 `verified=true` 后才写浏览器 marker。

该读取器保留一个弃用周期，计划在 `0.2.0` 删除。当前版本绝不会向旧 localStorage 或 JSON 报告路径回写。

## 升级与回滚

升级前备份应用数据目录中的 `logicguard.db` 和 `ChromeProfile/`，不要导出或提交凭据。保持 Tauri identifier `ai.logicguard.desktop` 不变。

回滚应用代码不会删除新表；旧版本会忽略 `execution_runs`、`execution_events` 和系统级测试设计表。若必须回滚业务数据，先停止所有运行，再恢复整份 SQLite 备份，不能只复制单表。迁移隔离记录应在新版本中重新归类，不能手工伪造成第三类环境。

## 仓库清理

- 运行 trace、截图、profile、coverage、打包 resources、迁移备份不提交，由 `.gitignore` 排除。
- `scripts/audit-repo-hygiene.mjs` 拒绝生成物，以及生产源码中的旧 executor、直接 Playwright import 和直接 CDP 连接。
- Stagehand 当前需要 Playwright 浏览器基础依赖，因此依赖和锁文件暂时保留；应用源码不得直接使用它。
- mocked parity 测试保留在测试目录，不复制进安装资源。每次执行产生的临时测试代码应删除；确需保留的可重复测试必须进入正式测试目录。
