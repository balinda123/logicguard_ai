# LogicGuard AI 应用开发学习路线

这份路线面向已有 React / TypeScript 经验、正在补后端和 AI 工程能力的开发者。学习时不要按目录从头读代码，而要沿一条真实业务链路纵向阅读。

## 总路线

| 阶段 | 主题 | 对应代码 | 完成标准 |
| --- | --- | --- | --- |
| 1 | 模型调用全链路 | `GenerationStage.tsx`、`TestDesignPage.tsx`、`testCaseGenerator.ts`、`lib.rs`、`llm.rs` | 能解释一次模型请求如何往返前端和 Rust |
| 2 | Prompt 与结构化输出 | `testCaseGenerator.ts`、`templateGenerator.ts` | 能修改输出 Schema，并同步修改解析与校验 |
| 3 | Agent 与工具调用 | `sidecar/stagehand/session.js`、`compiler.js`、`protocol.js` | 能区分确定性步骤、`act` 和有界 Agent |
| 4 | 长任务编排 | `run_manager.rs`、`runBridge.ts` | 能解释状态迁移、检查点、暂停恢复和重试 |
| 5 | AI 安全边界 | `privacy.ts`、`auth.rs`、`interaction_guard.rs` | 能说明脱敏、凭据、域名和浏览器控制边界 |
| 6 | RAG 实践 | 后续新增“历史缺陷知识库” | 能完成切分、检索、引用和检索评测 |
| 7 | 评测与作品整理 | 用例生成与执行测试 | 能用指标证明改动提高了质量，而不只展示 Demo |

当前先完成第 1 阶段。LangGraph.js 可以在理解第 4 阶段后再学；PEFT/LoRA 属于模型训练路线，建议放到独立 Python 项目。

## 第 1 课：一次模型请求如何穿过前后端

### 学习目标

完成本课后，你应当能回答：

1. 点击“生成用例”后，最先执行哪个 React 回调？
2. TypeScript 为什么能调用 Rust 函数？
3. API Key 在哪里补入请求，为什么不应保存在前端？
4. 模型返回 JSON 后，为什么不能直接 `as TestCase[]`？
5. 浏览器开发者工具为什么看不到真正的模型 HTTP 请求？

### 先建立整体图

```text
GenerationStage 按钮
  -> TestDesignPage.generateCases
  -> generateTestCasesFromRequirement
       1. 脱敏需求
       2. 构造 Prompt
       3. invoke("generate_test_cases")
  -> Tauri IPC
  -> lib.rs 注册的 llm::generate_test_cases
  -> route_llm 根据 provider 分流
  -> Gemini / Ollama / OpenAI Compatible HTTP API
  -> 原始模型文本返回前端
  -> extractJson + 字段归一化
  -> 保存为正式测试用例
```

这里有两个必须记住的边界：

- `invoke` 是桌面应用内部的 IPC 调用，不是浏览器发出的 `fetch`。
- 模型输出是不可信输入，即使要求模型返回 JSON，也必须解析、归一化和校验。

### 第一步：从按钮找到业务回调

打开 `src/pages/test-design/GenerationStage.tsx`，找到按钮的 `onClick={onGenerate}`。这个组件只负责展示，不负责模型调用。

然后在 `src/pages/TestDesignPage.tsx` 搜索 `onGenerate`，可以看到父组件把 `generateCases` 传入。继续查看 `generateCases`，重点观察它做的四件事：

1. 检查当前需求版本是否存在。
2. 更新 `preparing/requesting/parsing/saving` 进度。
3. 调用 `generateTestCasesFromRequirement`。
4. 把生成结果通过 bridge 保存到 SQLite。

这是前端常见的容器组件模式：页面负责流程，子组件负责交互，API 模块负责边界调用。

### 第二步：理解 TypeScript 侧的 AI 适配层

打开 `src/api/testCaseGenerator.ts`，找到 `generateTestCasesFromRequirement`。

```ts
const cleanRequirement = sanitizeForLlm(requirement.trim())
const prompt = buildPrompt(cleanRequirement, moduleName, flowAccounts)
const raw = await invoke<string>('generate_test_cases', { prompt, config })
const parsed = extractJson(raw)
```

这几行对应 AI 应用最常见的四层：输入治理、Prompt、模型调用、输出治理。

不要把 `invoke<string>` 理解成“Rust 一定返回合法字符串”。它只表示 TypeScript 期望成功值是字符串；Rust 仍可能返回 `Err(String)`，模型也可能在字符串中返回错误格式。

`extractJson` 看起来比 `JSON.parse` 复杂，是因为不同兼容网关可能返回 Markdown 代码块、在 JSON 后追加说明，甚至把 JSON 再包成字符串。这里的兼容逻辑是在吸收模型和网关的不确定性。

### 第三步：找到 Tauri 命令入口

打开 `src-tauri/src/lib.rs`，搜索 `llm::generate_test_cases`。

`tauri::generate_handler!` 相当于桌面后端的路由表。只有注册在这里并带有 `#[command]` 的 Rust 函数，前端才能按名称调用。

对应关系是：

```text
TypeScript: invoke("generate_test_cases", { prompt, config })
Rust:       generate_test_cases(prompt: String, config: LlmConfig)
```

参数名和可序列化结构必须匹配。Tauri 负责 JSON 序列化、跨进程传输和异步结果返回。

### 第四步：用前端思维读懂 Rust

打开 `src-tauri/src/llm.rs`，先只读 `generate_test_cases` 和 `route_llm`，不要从文件第一行硬啃。

```rust
pub async fn generate_test_cases(
    prompt: String,
    config: LlmConfig,
) -> Result<String, String> {
    route_llm(&prompt, &config).await
}
```

把它翻译成 TypeScript 心智模型：

```ts
async function generateTestCases(
  prompt: string,
  config: LlmConfig,
): Promise<string> {
  return await routeLlm(prompt, config)
}
```

几个 Rust 符号先这样理解：

| Rust | 前端类比 | 含义 |
| --- | --- | --- |
| `String` | `string` | 拥有内容、可独立存活的字符串 |
| `&str` | 只读字符串视图 | 借用字符串，不复制所有权 |
| `&config` | 只读对象引用 | 暂时借用，不转移所有权 |
| `Option<T>` | `T \| undefined` | 值可能不存在 |
| `Result<T, E>` | 成功值或抛错 | `Ok(T)` 成功，`Err(E)` 失败 |
| `?` | 失败时立即 `throw` | `Err` 会提前返回，成功则取出值 |
| `match` | 穷尽式 `switch` | 每种分支都必须处理 |

`route_llm` 是 Provider 路由器。它根据 `config.provider` 选择 Gemini、Ollama 或 OpenAI Compatible，并在需要时从系统凭据库读取当前用户的 API Key。

### 第五步：理解真正的 HTTP 请求

以 OpenAI Compatible 为例，继续依次阅读：

```text
call_openai_compat
  -> openai_chat_completions_url
  -> request_openai_compat
  -> parse_openai_compat_response
```

`reqwest::Client` 可以先类比成后端版 `fetch`。请求发生在 Rust 进程中，因此浏览器开发者工具的 Network 面板看不到它。

该实现只对 `502/503/504` 重试，因为这些错误通常是短暂的网关或上游故障。`401`、`400` 等错误重试通常没有意义，还会增加延迟和调用成本。

### 第六步：跟一次真实运行

1. 启动应用并打开“设计测试”。
2. 准备一条很短的虚构需求，例如“员工姓名必填，最长 20 字”。
3. 点击“生成用例”，观察页面阶段从 `requesting` 进入 `parsing`、`saving`。
4. 在 `generateTestCasesFromRequirement` 的 `invoke` 前后各打一个断点。
5. 暂时把模型地址配置错一次，观察 Rust `Err(String)` 如何变成前端异常和失败状态。

注意：不要在日志、截图或断点分享内容中暴露 API Key。真实模型请求在 Rust 侧，前端断点只能看到非敏感配置和返回文本。

### 本课练习

先不修改业务代码，口头或写在个人笔记中回答：

1. 如果新增一个 Provider，需要修改哪一层？
2. 如果模型返回合法 JSON，但字段名是 `测试步骤`，哪一层负责兼容？
3. 如果需求里有手机号，在哪一步被遮蔽？
4. 如果接口持续返回 401，会请求几次？为什么？
5. 为什么 API Key 缺省时由 Rust 获取，而不是让前端从 localStorage 读取？

参考答案：

1. 至少修改 `LlmConfig` 支持范围、`route_llm` 分支和对应 HTTP 适配函数；前端设置项是否需要修改取决于是否已有通用 OpenAI Compatible 配置。
2. TypeScript 的 `extractJson` 与后续字段归一化负责。
3. `generateTestCasesFromRequirement` 构造 Prompt 前调用 `sanitizeForLlm`。
4. 一次。当前只重试 `502/503/504`，401 属于确定性鉴权错误。
5. 这样可以把长期凭据留在操作系统凭据库中，避免进入 localStorage、普通前端状态和日志。

### 进入下一课的标准

不看本文，能够从“生成用例”按钮开始，在编辑器中独立找到以下五个位置：

1. React 点击回调。
2. TypeScript Prompt 构造函数。
3. `invoke` 调用。
4. Rust Tauri 命令和 Provider 路由。
5. 模型返回后的 JSON 解析与用例保存位置。

达到这个标准后，再进入第 2 课“Prompt、Schema 与不可信模型输出”。
