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
pub async fn plan_task(user_intent: String, config: LlmConfig) -> Result<String, String> {
    let system_prompt = build_planner_prompt(&user_intent);
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

// =============================================
// Prompt Builders
// =============================================

fn build_planner_prompt(user_intent: &str) -> String {
    format!(
        r#"You are LogicGuard AI's Planner agent. Your job is to break down a user's automation intent into precise, executable steps for a web browser automation system.

User Intent: "{}"

Output ONLY a valid JSON object in this exact format:
{{
  "planId": "plan_<timestamp>",
  "task": "<summary of the task>",
  "estimatedTime": <estimated seconds as integer>,
  "steps": [
    {{
      "stepId": 1,
      "description": "<clear action description in Chinese>",
      "expectedAction": "<one of: click|type|navigate|scroll|wait|assert|select>",
      "successCriteria": "<what must be true after this step succeeds>",
      "status": "pending"
    }}
  ]
}}

Rules:
- Break into 3-8 steps maximum
- Use Chinese for descriptions
- Be specific about what element to interact with
- Steps must be sequential and logically ordered
- For login flows, include SSO/credential steps"#,
        user_intent
    )
}

fn build_generator_prompt(step_description: &str, dom_context: &str) -> String {
    format!(
        r#"You are LogicGuard AI's Generator agent. Given a step description and current page DOM context, output the exact browser action to take.

Step to execute: "{}"

Current page interactive elements (Accessibility Tree):
{}

Output ONLY a valid JSON object:
{{
  "action": "<one of: click|type|navigate|scroll|wait|select>",
  "target": "<CSS selector or XPath of the element>",
  "value": "<text to type or URL to navigate to, if applicable>",
  "reason": "<one sentence explaining why this element was chosen>",
  "confidence": <0.0 to 1.0>
}}"#,
        step_description, dom_context
    )
}

fn build_healer_prompt(step: &str, failure: &str, dom: &str) -> String {
    format!(
        r#"You are LogicGuard AI's Healer agent. A browser automation step has failed and you must diagnose and provide an alternative approach.

Failed step: "{}"
Failure reason: "{}"

Current page interactive elements after failure:
{}

Analyze why it failed and output a recovery JSON:
{{
  "diagnosis": "<why the step failed>",
  "strategy": "<one of: retry|alt_selector|re_perceive|ai_diagnose|skip>",
  "action": "<one of: click|type|navigate|scroll|wait|select>",
  "target": "<new CSS selector or XPath to try>",
  "value": "<value if needed>",
  "confidence": <0.0 to 1.0>,
  "resolved": false
}}"#,
        step, failure, dom
    )
}
