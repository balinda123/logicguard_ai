# LogicGuard Stagehand Sidecar

生产执行只有一个入口：Rust `RunManager` 启动 `index.js stagehand-worker`，入口随后加载 `stagehand/worker.js`。旧的一次性 CLI 已删除，前端不能直接调用浏览器动作。

## 协议

worker 在同一 Stagehand v3 会话内逐行读取 NDJSON。每个请求最多 64 KiB，只产生一个终态响应；进度使用独立的 `{ id, event: "progress", data }` 包络。stdout 只承载协议，诊断写 stderr，并由 Rust 限长、脱敏。

允许的命令为 `execute`、`observe`、`act`、`agent`、`assert_page`、`capture_requirement`、`set_control_marker`、`remove_control_marker`、`self_check`、`terminate`。确定性动作闭集为 `navigate`、`click`、`fill`、`select`、`press`、`wait`、`read`、`assert`；定位器闭集为 `role`、`label`、`text`、`placeholder`、`testId`、`css`。`assert_page` 只读取当前页面可见文本或 URL，支持 `text_contains`、`text_absent`、`url_contains`，在页面异步更新期间有限轮询且不调用模型；`capture_requirement` 从用户指定且已校验的 URL 开始导航，不继承受控浏览器的当前页面，导航后的最终 URL 仍必须属于本次允许域名。该命令的 `aiMatch` 必须是布尔值；为 `false` 时先匹配本地 DOM 原文，DOM 不可读或关键词全部未命中时以零 Token 可访问性快照确定性匹配；为 `true` 时调用当前用户选择的模型做语义提取。

`act` 和 `agent` 必须声明允许 origin 与超时，`agent.maxActions` 为 1 到 20。远程 origin 只允许 HTTPS，本地开发可使用显式 localhost、127.0.0.1 或 ::1 HTTP。CSS 先经过保守编译检查，再由浏览器原生 selector parser 验证。

本地 Stagehand 会话启用 `experimental: true` 并保持 `disableAPI: true`，用于支持 Agent 步骤回调和超时中止信号；不会切换到远程 Stagehand API。

## 安全边界

- 普通 worker 请求拒绝 `password`、`token`、`otp`、`secret`、`credential` 字段、值和占位符。
- API Key 由 Rust 从操作系统凭据库读取，只在启动 worker 时注入环境，不进入计划、快照、事件、SQLite 或日志。
- 需求 AI 匹配默认关闭。开启后先用可访问性树执行一次结构化提取；返回为空或明显乱码时，才回退到页面截图 Agent。页面可见内容、可访问性树或按需截图会发送给当前模型；抓取 Agent 在执行层移除点击、填写、按键、导航、返回、搜索和坐标交互工具，只保留读取、截图、滚动、等待与结束。两条路径都失败时返回经过协议脱敏和限长的阶段原因，前端翻译为可操作的中文提示。
- 测试账号密码同样保存在操作系统凭据库；自动登录和人工接管由 Rust 执行边界协调，密码不进入 Stagehand 普通协议。
- 自动登录由 Rust 启动一次性 `stagehand/login-worker.js`。账号密码只通过该子进程的短生命周期环境值传入，登录 worker 使用 Stagehand Page/Locator API，不开放 NDJSON 命令；完成或失败后立即清空环境入口并退出。
- 控制标识只接受系统、环境、运行编号和当前步骤，使用 `textContent` 渲染固定“自动化执行中”提示。
- Windows 仅锁定应用启动并记录 PID 的专用浏览器窗口。外部 CDP 浏览器无法建立可信窗口锁，会在预检阶段阻断。

## 生命周期

Rust 持有运行状态、浏览器 lease、worker PID、暂停检查点和取消信号。暂停只在原子命令结束并落盘后生效；暂停、人工接管和所有终态都会释放浏览器输入锁。EOF 或 `terminate` 关闭 Stagehand 会话。新运行快照的 `llmRuntime` 固化 provider、model 和非敏感 base URL，一次性登录 worker、页面评估、持久业务 worker及失败重试均使用同一配置；API Key 不进入快照。

运行期间 worker 在受控页面的隔离 Shadow DOM 中绘制闪烁边框和禁止点击提示；页面捕获真实 `pointerdown` 坐标，在被点击控件上显示圆点波纹。导航或刷新销毁旧 DOM 后，worker 会在下一个动作边界按当前运行标识自动补回提示层，避免任务仍在执行但页面看起来已解除控制。提示层使用 `pointer-events: none`，避免阻断 Stagehand/CDP；真正的人工输入禁止仍由 Rust 持有的 Windows 浏览器交互锁完成。运行结束、暂停或人工接管前移除提示层并恢复原网页标题；若长 Agent 动作未及时消费清理命令，Rust 会在结束主 worker 后启动一次性清理 worker 兜底移除标识。

运行快照可包含 `accountOrchestration`：system/environment、非敏感账号 ID、动态角色键/名称、显示名，以及按 command index 排序的账号步骤。导航命令不绑定账号，第一条业务命令通常从 command index 1 开始。Rust 只为 `execute.navigate` 合并快照中的可信登录 origin，使入口页的 302 能落到 SSO；其他 execute/act/agent/assert 命令仍使用各自的业务 origin 白名单。第一次业务执行前，独立 login worker 以 `assess` 模式只读观察页面，并结合密码框、具体账号标识或登录成功 locator 返回 `login_required`、`authenticated` 或 `uncertain`；模型观察或通用角色文字不能在缺少身份 DOM 证据时自行确认登录。后续 account ID 变化强制切换账号。自动模式读取 keyring，未配置 locator 时自动识别常见登录控件；多个普通登录入口按运行快照中的系统名称选择目标系统按钮，并排除 SSO、扫码和验证码入口。账号可配置仅用于人工接管的可信 SSO/OTP origin，页面进入这些域名后释放浏览器控制并进入 `waiting_handoff`，不会向第三方页面填写业务凭据。扫码或验证码完成并返回业务 origin 后，恢复操作会重新校验页面身份、申请浏览器输入锁并继续原 checkpoint。未配置域名错误只回传实际 origin，不包含路径、查询参数或片段。

自动账号登录不使用可能在预填值后追加的通用 `fill`：隔离 worker 通过原生输入值 setter 清空并覆盖用户名和密码，触发页面框架需要的输入事件，再读回校验两项值。任一字段不完全一致时不会点击登录按钮，而是以登录执行条件不满足结束并转入人工处理。

Agent 执行会把 Stagehand `toolCalls` 转换成脱敏的人类可读进度：保留点击目标和动作类型，不记录填写值。统一系统指令要求填写前检查现值、修改时覆盖而非追加；执行前按“账号 + 操作 + 预期结果 + 断言 + 测试数据”精确去重，同一用例内连续且同账号的步骤合并为一轮有界 Agent，角色变化与用例边界仍是硬检查点。跨用例会重新打开环境入口；若业务数据本身要求独立夹具，仍必须由需求或测试环境提供真实重置能力，执行器不会伪造。简单且有确定性证据的动作先走 `act`，失败后才升级为有界 Agent；成功的无参数定位仅缓存在当前 worker 内存，最多 100 项，失效时自动重新定位，不缓存填写值、账号、密码，也不写磁盘。计划同时固化供前端展示的场景标题、业务动作和预期结果，展示字段在发送给 sidecar 前移除。页面内的具体控件和后续动作仍在执行时根据实时 DOM 决定。Agent 上限按模型回合计算，读取 DOM 等同回合内工具调用不会错误耗尽后续确认额度；达到回合上限后若仍存在语义明确的正向确认按钮，执行器会确定性完成一次确认，再核验弹窗是否关闭。每次页面动作后优先读取轻量 DOM/可访问性状态，识别弹窗、抽屉、遮罩、加载和校验错误，且只在状态变化时记录动态；任务结束时仍有交互面会再次交给 Agent 对照预期处理。截图仅在 DOM 语义不足或用例明确要求视觉断言时按需查看，不会逐操作截图。连续 15 秒没有新工具回调时会发送等待心跳，区分“仍在等待模型/页面”与程序无响应。Rust 还会记录每条编译命令的开始、完成和耗时，便于定位慢在登录、模型还是页面等待。

用例生成要求 `testData` 提供可直接执行的虚构业务值；执行计划会把具体数据连同步骤传给 Agent。多角色步骤必须遵循需求中的状态流转并补齐必要交接动作；边界值在可编辑阶段依次验证，完成本阶段覆盖后只做一次不可逆正式提交。没有需求或前置条件证明时，不得虚构独立记录或可重置夹具。历史用例中的变量占位符不会原样输入页面，而会转成按字段语义和边界生成真实测试值的要求。长文本必须保持业务语义，除非用例明确验证异常输入，否则禁止重复字符、连续数字或乱码凑长度。

## 依赖与打包

`@browserbasehq/stagehand` 是唯一浏览器自动化 API。`playwright` 目前仍保留在生产依赖和锁文件中，因为 Stagehand 本地 CDP 运行时依赖其浏览器基础能力；应用源码不得直接 import/require Playwright，也不得直接调用 `connectOverCDP`。

`npm run prepare:sidecar` 会复制内置 Node 22、`index.js`、完整 `stagehand/` 目录和生产依赖到 Tauri resources。`sidecar/test` 不进入安装资源。生成的 resources、profile、trace、截图和 coverage 均由 `.gitignore` 与仓库审计排除。

环境变量：`LOGICGUARD_CDP_URL`、`LOGICGUARD_ALLOWED_ORIGINS`、`LLM_PROVIDER`、`LLM_MODEL`、`LLM_BASE_URL`、`LLM_API_KEY`。`LOGICGUARD_CDP_URL` 可填写本机 Chrome 的 HTTP 调试端点（如 `http://127.0.0.1:9222`），worker 会通过 `/json/version` 解析浏览器 WebSocket 地址。网页需求抓取会等待 SPA 正文加载；默认保留标题、段落、列表和表格行，关键词先按 DOM 原文筛选，在线文档 DOM 不可读或全部未命中时再从不调用模型的可访问性快照匹配，命中目录标题后确定性点击目录并逐章合并正文，仍未匹配则回退完整可读正文并返回未命中明细。显式启用 `aiMatch` 时先从可访问性树做单次 AI 语义提取，内容质量校验失败后再由受限只读 Agent 结合页面截图滚动匹配；响应中的 `aiMatchMethod` 标明实际使用 `accessibility` 或 `vision`。最终用户无需单独安装 Node.js。
