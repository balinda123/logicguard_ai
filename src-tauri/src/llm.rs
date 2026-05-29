use serde::{Deserialize, Serialize};
use tauri::command;

// =============================================
// Types for LLM request/response
// =============================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LlmConfig {
    pub provider: String, // "gemini" | "ollama" | "openai_compat"
    pub api_key: Option<String>,
    pub base_url: Option<String>, // for custom OpenAI-compat endpoints
    pub model: String,
}

impl Default for LlmConfig {
    fn default() -> Self {
        LlmConfig {
            provider: "gemini".to_string(),
            api_key: None,
            base_url: None,
            model: "gemini-2.0-flash".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmMessage {
    pub role: String, // "user" | "assistant" | "system"
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmResponse {
    pub content: String,
    pub model: String,
    pub usage_tokens: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GeminiPart {
    text: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    #[serde(rename = "generationConfig")]
    generation_config: GeminiGenerationConfig,
}

#[derive(Debug, Serialize, Deserialize)]
struct GeminiGenerationConfig {
    temperature: f32,
    #[serde(rename = "maxOutputTokens")]
    max_output_tokens: u32,
    #[serde(rename = "responseMimeType")]
    response_mime_type: String,
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: GeminiContent,
}

// =============================================
// Gemini API Call
// =============================================

pub async fn call_gemini(
    prompt: &str,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, api_key
    );

    let request_body = GeminiRequest {
        contents: vec![GeminiContent {
            parts: vec![GeminiPart {
                text: prompt.to_string(),
            }],
        }],
        generation_config: GeminiGenerationConfig {
            temperature: 0.1, // low temperature for structured JSON output
            max_output_tokens: 4096,
            response_mime_type: "application/json".to_string(),
        },
    };

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Gemini HTTP error: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Gemini API error {}: {}", status, body));
    }

    let gemini_resp: GeminiResponse = response
        .json()
        .await
        .map_err(|e| format!("Gemini parse error: {}", e))?;

    let text = gemini_resp
        .candidates
        .first()
        .and_then(|c| c.content.parts.first())
        .map(|p| p.text.clone())
        .ok_or_else(|| "Empty response from Gemini".to_string())?;

    Ok(text)
}

// =============================================
// Ollama API Call (home PC / local)
// =============================================

pub async fn call_ollama(
    prompt: &str,
    model: &str,
    base_url: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/generate", base_url);

    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false,
        "format": "json",
        "options": {
            "temperature": 0.1,
            "num_predict": 4096
        }
    });

    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama HTTP error: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama API error {}: {}", status, body));
    }

    let resp_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Ollama parse error: {}", e))?;

    let text = resp_json["response"]
        .as_str()
        .ok_or_else(|| "Missing response field from Ollama".to_string())?
        .to_string();

    Ok(text)
}

// =============================================
// OpenAI-compatible API (e.g. DeepSeek, Qwen API)
// =============================================

pub async fn call_openai_compat(
    prompt: &str,
    api_key: &str,
    base_url: &str,
    model: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.1,
        "max_tokens": 4096,
        "response_format": {"type": "json_object"}
    });

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API HTTP error: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, body));
    }

    let resp_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    let text = resp_json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "Missing content in response".to_string())?
        .to_string();

    Ok(text)
}

// =============================================
// Router: auto-select provider based on config
// =============================================

pub async fn route_llm(prompt: &str, config: &LlmConfig) -> Result<String, String> {
    match config.provider.as_str() {
        "gemini" => {
            let api_key = config
                .api_key
                .as_deref()
                .ok_or("Gemini API key not configured")?;
            call_gemini(prompt, api_key, &config.model).await
        }
        "ollama" => {
            let base_url = config
                .base_url
                .as_deref()
                .unwrap_or("http://localhost:11434");
            call_ollama(prompt, &config.model, base_url).await
        }
        "openai_compat" => {
            let api_key = config
                .api_key
                .as_deref()
                .ok_or("API key not configured")?;
            let base_url = config
                .base_url
                .as_deref()
                .ok_or("base_url not configured for openai_compat")?;
            call_openai_compat(prompt, api_key, base_url, &config.model).await
        }
        other => Err(format!("Unknown LLM provider: {}", other)),
    }
}

// =============================================
// Tauri Commands (exposed to frontend)
// =============================================

/// Test LLM connectivity and return raw response
#[command]
pub async fn test_llm_connection(config: LlmConfig) -> Result<String, String> {
    let test_prompt = r#"Reply with exactly this JSON and nothing else: {"status":"ok","message":"LLM connection successful"}"#;
    route_llm(test_prompt, &config).await
}

/// Main planning command: converts user intent to structured steps
#[command]
pub async fn plan_task(user_intent: String, context: String, config: LlmConfig) -> Result<String, String> {
    let system_prompt = build_planner_prompt(&user_intent, &context);
    route_llm(&system_prompt, &config).await
}

/// Generate action for a specific step given DOM context
#[command]
pub async fn generate_action(
    step_description: String,
    dom_context: String,
    config: LlmConfig,
) -> Result<String, String> {
    let prompt = build_generator_prompt(&step_description, &dom_context);
    route_llm(&prompt, &config).await
}

/// Heal a failed step: re-analyze with current DOM
#[command]
pub async fn heal_step(
    step_description: String,
    failure_reason: String,
    dom_context: String,
    config: LlmConfig,
) -> Result<String, String> {
    let prompt = build_healer_prompt(&step_description, &failure_reason, &dom_context);
    route_llm(&prompt, &config).await
}

/// 新架构：根据用户自然语言 + 当前 DOM 快照，一次性生成完整的确定性测试脚本
#[command]
pub async fn generate_test_script(
    user_intent: String,
    dom_snapshot: String,
    page_url: String,
    config: LlmConfig,
) -> Result<String, String> {
    let prompt = build_test_script_prompt(&user_intent, &dom_snapshot, &page_url);
    route_llm(&prompt, &config).await
}

// =============================================
// Prompt Builders
// =============================================

fn build_planner_prompt(user_intent: &str, context: &str) -> String {
    format!(
        r#"你是 LogicGuard AI 的 Planner (计划制定) 代理。你的任务是将用户的自动化意图拆解为浏览器自动化系统可执行的精确步骤。

当前浏览器上下文（状态）:
{}

用户意图: "{}"

重要指示: 如果“当前浏览器上下文”显示用户【已经】在目标网站或目标页面上，绝对不要生成导航到首页或登录的步骤。直接从当前页面开始规划后续操作。

请只输出一个符合以下确切格式的合法 JSON 对象：
{{
  "planId": "plan_<timestamp>",
  "task": "<任务的简短总结>",
  "estimatedTime": <预估秒数，整数>,
  "steps": [
    {{
      "stepId": 1,
      "description": "<清晰的中文操作步骤描述>",
      "expectedAction": "<从以下选项中选择: click|type|navigate|scroll|wait|assert|select|hover>",
      "successCriteria": "<执行此步后，什么条件为真则代表成功>",
      "status": "pending"
    }}
  ]
}}

规则:
- 最多拆分为 3 到 8 个步骤
- 描述必须使用中文
- 明确指出需要交互的元素是什么
- 步骤必须是顺序执行、合乎逻辑的
- 对于需要展开下拉菜单的操作，必须先生成一个使用 hover 动作悬停在父级菜单上的步骤，等待其展开后再在下一步执行 click。
- 绝对不要根据元素的文字去臆测它在页面上的位置布局（例如不要写“在左侧菜单”、“在顶部”等），只用元素的文本内容来描述即可。
- 对于需要登录的流程，必须包含 SSO/凭证输入步骤（除非上下文显示已登录）"#,
        context,
        user_intent
    )
}

fn build_generator_prompt(step_description: &str, dom_context: &str) -> String {
    format!(
        r#"你是 LogicGuard AI 的 Generator (动作生成) 代理。请根据给定的步骤描述和当前页面的 DOM 上下文，输出确切的浏览器执行动作。

当前需要执行的步骤: "{}"

当前页面可交互元素列表 (Accessibility Tree):
{}

重要提示: 元素后面带有 [x:坐标, y:坐标] 表示其在页面上的物理绝对位置。
如果你需要在一堆同名元素（比如多个“搜索”按钮）中做选择：
1. 观察执行步骤中提到的参照物（比如“在某个输入框后面”）。
2. 找到该参照物的 [x, y] 坐标。
3. 寻找与参照物坐标最接近（通常 Y 轴相近代表在同一行）的目标按钮。
如果没有同名冲突，直接通过文字特征寻找即可，不要过度依赖坐标。

请只输出一个符合以下确切格式的合法 JSON 对象：
{{
  "action": "<从以下选项中选择: click|type|navigate|scroll|wait|select|hover>",
  "target": "<上方列表中目标元素的序号数字，例如 12。如果是 navigate 动作，则填 URL>",
  "value": "<需要输入的文本值，如果有的话>",
  "reason": "<一句话用中文解释为什么选择这个元素>",
  "confidence": <0.0 到 1.0 的置信度>
}}"#,
        step_description, dom_context
    )
}

fn build_healer_prompt(step: &str, failure: &str, dom: &str) -> String {
    format!(
        r#"你是 LogicGuard AI 的 Healer (自愈诊断) 代理。某一个浏览器自动化步骤执行失败了，你必须进行诊断并提供备用的替代方案。

执行失败的步骤: "{}"
失败原因: "{}"

失败后当前页面的可交互元素列表 (带有物理空间坐标 [x, y]):
{}

请分析失败原因（如果是因为点错了同名元素，请结合目标元素和其旁边参照物的 [x,y] 坐标重新推理），并输出一个包含恢复策略的合法 JSON 对象：
{{
  "diagnosis": "<用中文解释为什么该步骤会失败>",
  "strategy": "<从以下选项中选择: retry|alt_selector|re_perceive|ai_diagnose|skip>",
  "action": "<从以下选项中选择: click|type|navigate|scroll|wait|select|hover>",
  "target": "<尝试操作的新元素的序号数字，例如 15。如果是 navigate，则填 URL>",
  "value": "<需要输入的文本值，如果有的话>",
  "confidence": <0.0 到 1.0 的置信度>,
  "resolved": false
}}"#,
        step, failure, dom
    )
}

fn build_test_script_prompt(user_intent: &str, dom_snapshot: &str, page_url: &str) -> String {
    format!(
        r#"你是一名专业的自动化测试工程师，精通 Playwright 框架。你的职责是将用户的自然语言需求，转化为精确、可靠、可重复执行的自动化测试脚本。

当前浏览器页面: {}

页面上所有可交互元素列表（注意每个元素前有类型标签）:
{}

用户需求: "{}"

请将上述需求转化为一份完整的测试脚本。

## 元素类型说明（非常重要）
元素列表中每个元素都有明确的类型标签，你必须根据类型选择正确的动作：
- `[DROPDOWN]` → 原生 HTML 下拉框，使用 `select` 动作，value 填要选择的选项文字
- `[INPUT] placeholder="请选择..."` → **自定义下拉选择器**（Vue/React 组件），使用 `click` 打开，再用 `click` 点击选项文字，**绝对不要用 type 或 select**
- `[INPUT] placeholder="请输入..."` → 普通文字输入框，使用 `type` 动作
- `[BUTTON]`   → 按钮，使用 `click` 动作
- `[LINK]`     → 链接，使用 `click` 动作
- `[CHECKBOX]` → 复选框，使用 `click` 动作

## 意图匹配规则（最关键！）
**必须严格将用户意图与 placeholder/label 匹配：**
- 用户说"筛选/选择部门" → 找 placeholder 包含"部门"的输入框（如 `placeholder="请选择直属部门"`）
- 用户说"输入工号" → 找 placeholder 包含"工号"的输入框（如 `placeholder="请输入员工工号/姓名"`）
- **同一页面可能有多个输入框，必须通过 placeholder 中的关键词精准区分，绝不能搞混！**

## 自定义下拉框与级联选择器（Cascader/Tree Select）交互模式（可搜索与多步法说明）
当页面包含自定义下拉框（Vue/React 级联选择器或树形选择器，通常带有 `placeholder="请选择..."`）且用户需要选择嵌套的子级部门或选项（如 "人力资源中心"）时，你必须根据该选择器是否支持输入搜索来选择最佳模式：
1. **输入搜索法（首选且最推荐，尤其适用于组织架构部门树）**：如果下拉框（如 `placeholder="请选择直属部门"`) 支持输入搜索或带有搜索输入框，并且要选择的节点是嵌套较深的子部门（比如“人力资源中心”），**最稳健且 100% 成功**的做法是：
   * 第一步：点击该下拉触发框（如：`click` 策略 `placeholder`，值 `"请选择直属部门"`）以打开并激活下拉浮层。
   * 第二步：在同一个定位元素中输入要搜索的文本进行过滤（如：`type` 策略 `placeholder`，值 `"请选择直属部门"`，输入的 `value` 填 `"人力资源中心"`），此时执行器会自动寻找其内部的 input 完成输入并过滤出目标节点。
   * 第三步：点击过滤后出现的唯一选项节点（如：`click` 策略 `text`，值 `"人力资源中心"`）完成选择。
2. **逐层点击法（备选）**：如果下拉框是静态的多级联级菜单且无法搜索，必须按层级逐一生成点击步骤，绝对不能跳过中间层级：
   * 第一步：点击下拉触发框打开浮层。
   * 第二步：点击一级父选项（如 `text` 值 `"游戏业务"`) 展开二级菜单。
   * 第三步：点击子选项（如 `text` 值 `"游戏一代"`) 完成选择。
每一层级作为一个独立的步骤生成。

## 元素定位策略优先级
1. `placeholder`：最精准，直接用 placeholder 文字匹配
2. `aria-label`：aria-label 属性
3. `text`：按钮/选项的精确文字
4. `selector`：最后手段

## 其他规则
- **回车搜索**: 先 `type` 输入内容，再 `press` + `Enter`
- **系统内导航优先使用点击**: 当用户表示"进入/打开/访问系统内的某个子页面/报表"时，如果当前页面上有对应的菜单、标签页、链接或按钮（例如顶部或左侧的 "报表中心"、"绩效报表" 菜单），**必须优先生成点击（click）该菜单的步骤**，让系统自然跳转！绝对不要闭眼盲猜一个可能不存在的子页面路由网址进行 `navigate`！只有在最初打开系统首页或登录页时，才允许使用 `navigate` 动作。
- **绝对禁止**: 将不同字段的 placeholder 混淆使用
- **中文按钮空格处理**: 在 Ant Design 等组件库中，两个字的中文按钮（如“查询”、“导出”）中间可能会被渲染空格（如 `"查 询"`、`"导 出"`）。在生成 `text` 定位策略时，**必须**使用包含空格的真实文本，或者使用模糊匹配。
- **避免同名冲突**: 当用户点击下拉框内的选项时，策略应为 `text`，值应为选项文字。系统执行器会自动优先在下拉框内查找，防止与左侧树形导航或页面其他文字冲突。

## 输出格式
请只输出以下 JSON 格式，不要输出任何其他文字:
{{
  "scriptId": "ts_<当前时间戳>",
  "title": "<用一句话描述这个测试脚本的目的>",
  "userIntent": "{}",
  "generatedAt": "<ISO 时间>",
  "steps": [
    {{
      "stepId": 1,
      "description": "<清晰的中文步骤描述>",
      "action": "<click|type|press|select|hover|navigate|scroll|wait|assert>",
      "target": {{
        "strategy": "<placeholder|aria-label|name|testid|text|selector>",
        "value": "<对应属性的值>",
        "description": "<中文说明这是什么元素，例如：部门筛选下拉框>"
      }},
      "value": "<type时填输入内容 / press时填按键名如Enter / select时填要选择的选项文字 / assert时填期望文字>",
      "status": "pending"
    }}
  ]
}}"#,
        page_url, dom_snapshot, user_intent, user_intent
    )
}
