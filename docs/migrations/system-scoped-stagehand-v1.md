# 系统级测试设计与 Stagehand v1 迁移

## 生效范围

本版本把测试设计绑定到明确的系统和环境。每个系统只有管理员维护的“本地启动”和“测试环境”两类环境；执行中心、测试报告和问题跟踪仍是跨系统公共视图，通过系统、环境、状态和时间筛选。

四阶段不再保存独立页面状态。需求版本、生成批次、测试用例、审核记录和测试集合配置共享同一个 `designId` 并写入 SQLite。需求更新会产生新版本，旧批次保留但标记为过期。测试集合保存名称和已确认用例 ID；编辑已确认用例会恢复为待确认，删除用例会标记为 `archived` 并从默认列表和执行范围排除。

测试账号入口位于“生成用例”阶段，不再放在系统设置。账号通过 `systemId + environmentId` 隔离，同一业务角色可以保存多个账号。登录地址和 SSO/验证码可信域名改由管理员在系统环境创建或编辑时统一配置，账号表单只保留角色、登录方式、凭据和可选定位器。前端使用 `list_scoped_test_accounts`、`create_scoped_test_account` 和 `update_scoped_test_account` 管理当前范围；只有账号显示名、角色和登录方式进入 AI 用例生成上下文，真实用户名和密码仍只写入系统凭据库。旧数据库升级时新增环境字段但不回填，环境尚未保存前执行器继续回退历史账号配置，避免已有任务中断。

“需求来源”保留手工填写，并恢复系统级网页导入入口。网页导入按“输入网址 → 设置关键词 → 抓取网页 → AI 整理需求”执行；`capture_requirement_page` 默认通过当前 Stagehand 受控浏览器读取 DOM 正文，不截图、不调用模型，DOM 不可读或关键词全部未匹配时自动改用同样不调用模型的页面可访问性快照，命中在线文档目录后按标题逐章跳转并合并正文，仍未匹配才回退完整可读正文供用户核对。用户也可显式开启默认关闭的“AI 语义匹配”；此时页面可见内容或截图会发送给当前选择的模型并消耗 Token，受限 Agent 只能读取、滚动和提取，不能点击、输入、导航或联网搜索。关键词支持用中文/英文分号分隔或一行一个，AI 按语义合并相关章节并返回匹配结果。第四步把用户确认的正文再次发送给当前模型，只输出需求主题、角色职责、状态流转、校验规则、边界值、前置条件和覆盖场景，不生成页面操作步骤；具体步骤在后续“生成用例”阶段结合测试账号产生。完成后结果回填当前设计并以 `sourceKind=web` 保存为需求版本，返回上一步不会重复抓取。

开发模式下，如果 `src-tauri/resources/sidecar/stagehand` 尚未由 `prepare-sidecar` 生成，运行管理器会回退到仓库中的 `sidecar/stagehand` 源码；安装包仍只读取打包资源，缺少 worker 时保持阻断，不静默降级到旧执行器。

## 执行切换

生产执行链固定为：

```text
UI -> Tauri start_run -> Rust RunManager -> sidecar/stagehand/worker.js -> Stagehand -> 专用 Chrome CDP
```

旧前端脚本执行器、前端 Stagehand 执行器、DOM + LLM executor、一次性 Playwright sidecar 命令和 JSON 报告写入均已删除。Rust 只保留专用浏览器启动、连接探测和资源定位；它们不执行测试步骤。

运行和事件写入 SQLite `execution_runs` / `execution_events`。报告直接读取终态运行及持久事件，不再生成 `logicguard_reports_<user>.json`。当状态进入 `business_failed` 时，同一 SQLite 事务会写入 `execution_issues` 的待确认问题单，问题跟踪页会与历史问题单统一展示、编辑、流转和导出；`blocked`、`cancelled`、`interrupted` 仍只是执行诊断。

管理员在系统设置的“被测系统与环境”中看到全部系统及其环境，可新增、编辑、启停和删除。为避免误删历史测试数据，已有测试设计引用的系统或环境拒绝删除；需要先在设计测试中处理该设计。

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
