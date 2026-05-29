/**
 * browser.rs - 浏览器控制层
 * 
 * 这个模块负责：
 * 1. 调用 Node.js Sidecar 脚本控制 Chrome
 * 2. 解析 Sidecar 的 JSON 输出
 * 3. 把结果以 Tauri Command 的形式暴露给前端
 * 
 * 数据流：
 * React前端 → invoke("browser_get_snapshot") 
 *   → browser.rs 
 *   → node sidecar/index.js get_snapshot
 *   → Chrome CDP
 *   → JSON输出 
 *   → browser.rs 解析
 *   → 返回给 React 前端
 */

use std::process::Command;
use std::io::{BufRead, BufReader};
use serde::{Deserialize, Serialize};
use tauri::command;
use tauri::Emitter;

// ─── 数据类型定义 ──────────────────────────────────────────────
// 📚 这些结构体要和前端的 TypeScript 类型完全对应
//    Rust 通过 serde 自动把它们转换成 JSON

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InteractiveElement {
    pub index: u32,
    pub tag: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aria_label: Option<String>,
    pub disabled: bool,
    pub selector: String,
    pub visible: bool,
    pub x: Option<i32>,
    pub y: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PageSnapshot {
    pub url: String,
    pub title: String,
    pub interactive_elements: Vec<InteractiveElement>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActionResult {
    pub action: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selector: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_url: Option<String>,
}

// Sidecar 返回的通用响应格式
#[derive(Debug, Deserialize)]
struct SidecarResponse<T> {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

// ─── 核心函数：运行 Sidecar 命令 ──────────────────────────────
// 📚 这个函数是所有浏览器操作的基础
//    它启动 Node.js 子进程，等待结果，然后解析 JSON

use crate::llm::LlmConfig;

fn run_sidecar(args: Vec<String>, envs: Vec<(String, String)>) -> Result<String, String> {
    // 找到 node.js 可执行文件
    // 📚 在 Windows 上可能是 "node.exe"，在 Mac/Linux 上是 "node"
    let node_cmd = if cfg!(target_os = "windows") { "node" } else { "node" };
    
    // sidecar 脚本路径：相对于项目根目录
    // 📚 注意：这是开发时的路径。打包发布时需要把 Node.js 也一起打包
    let sidecar_path = {
        // 获取当前可执行文件的目录，往上找项目根目录
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("无法获取程序路径: {}", e))?;
        
        // 开发模式：target/debug/app.exe → 项目根目录/sidecar/index.js
        // 找到包含 src-tauri 的父目录
        let mut path = exe_path.clone();
        let mut found = false;
        for _ in 0..6 {
            path = match path.parent() {
                Some(p) => p.to_path_buf(),
                None => break,
            };
            if path.join("sidecar").join("index.js").exists() {
                found = true;
                break;
            }
        }
        
        if !found {
            return Err(
                "找不到 sidecar/index.js。\n请确保在项目根目录下有 sidecar/ 文件夹。".to_string()
            );
        }
        
        path.join("sidecar").join("index.js")
    };

    // 构建并运行命令
    // 📚 std::process::Command 是 Rust 的标准库，用来启动子进程
    let mut cmd = Command::new(node_cmd);
    cmd.arg(&sidecar_path)
       .args(&args);
    
    // 注入大模型配置环境变量供 Stagehand 调用
    for (k, v) in envs {
        cmd.env(k, v);
    }

    let output = cmd.output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "找不到 Node.js！请先安装 Node.js (https://nodejs.org)".to_string()
            } else {
                format!("启动 Node.js 失败: {}", e)
            }
        })?;

    // 检查子进程是否正常退出
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    
    // 📚 Playwright 首次安装可能报错，给出友好提示
    if stderr.contains("playwright") && stderr.contains("install") {
        return Err(
            "Playwright 浏览器驱动未安装。\n请运行: cd sidecar && npm install".to_string()
        );
    }
    
    if stdout.is_empty() {
        return Err(format!(
            "Sidecar 无输出。\n错误信息: {}\n请检查 Node.js 是否正确安装并且 sidecar/ 目录已执行 npm install",
            if stderr.is_empty() { "无" } else { &stderr }
        ));
    }

    Ok(stdout.trim().to_string())
}

fn run_sidecar_with_config(args: Vec<String>, config: Option<LlmConfig>) -> Result<String, String> {
    let mut envs = Vec::new();
    if let Some(cfg) = config {
        if let Some(ref key) = cfg.api_key {
            envs.push(("LLM_API_KEY".to_string(), key.clone()));
            envs.push(("OPENAI_API_KEY".to_string(), key.clone()));
            envs.push(("ANTHROPIC_API_KEY".to_string(), key.clone()));
            envs.push(("GOOGLE_API_KEY".to_string(), key.clone()));
            envs.push(("GEMINI_API_KEY".to_string(), key.clone()));
            envs.push(("GOOGLE_GENERATIVE_AI_API_KEY".to_string(), key.clone()));
        }
        if let Some(ref base_url) = cfg.base_url {
            envs.push(("LLM_BASE_URL".to_string(), base_url.clone()));
            envs.push(("OPENAI_BASE_URL".to_string(), base_url.clone()));
        }
        envs.push(("LLM_PROVIDER".to_string(), cfg.provider));
        envs.push(("LLM_MODEL".to_string(), cfg.model));
    }
    run_sidecar(args, envs)
}

// ─── 解析 Sidecar 响应 ────────────────────────────────────────
fn parse_response<T: for<'de> Deserialize<'de>>(raw: &str) -> Result<T, String> {
    // 🌟 容错处理：从多行输出中寻找到真正的 JSON 响应行（兼容 Stagehand / Playwright 打印的背景日志）
    let json_line = raw.lines()
        .find(|line| line.trim().starts_with("{\"ok\":") || (line.trim().starts_with("{") && line.trim().contains("\"ok\"")))
        .ok_or_else(|| format!("在 Sidecar 输出中找不到有效的 JSON 响应头。\n原始输出: {}", raw))?;

    // 先解析外层的 { ok, data, error }
    let response: SidecarResponse<serde_json::Value> = serde_json::from_str(json_line)
        .map_err(|e| format!("Sidecar 响应 JSON 解析失败: {}\n匹配到的行: {}", e, json_line))?;
    
    if !response.ok {
        return Err(response.error.unwrap_or_else(|| "未知错误".to_string()));
    }
    
    // 再把 data 字段解析成目标类型
    let data = response.data
        .ok_or_else(|| "响应中缺少 data 字段".to_string())?;
    
    serde_json::from_value(data)
        .map_err(|e| format!("数据格式解析失败: {}", e))
}

// ─── Tauri Commands (暴露给前端的函数) ────────────────────────

/// 获取当前 Chrome 页面快照
/// 📚 前端调用: await invoke('browser_get_snapshot', { port: 9222 })
#[command]
pub fn browser_get_snapshot(port: Option<u16>, config: Option<LlmConfig>) -> Result<PageSnapshot, String> {
    let cdp_port = port.unwrap_or(9222).to_string();
    
    let raw = run_sidecar_with_config(vec![
        "get_snapshot".to_string(),
        format!("--port={}", cdp_port),
    ], config)?;
    
    // 📚 中间层转换：Sidecar 返回 camelCase JSON，我们需要 snake_case
    //    所以先解析成 serde_json::Value，手动映射字段
    let json_line = raw.lines()
        .find(|line| line.trim().starts_with("{\"ok\":") || (line.trim().starts_with("{") && line.trim().contains("\"ok\"")))
        .ok_or_else(|| format!("在快照输出中找不到有效的 JSON 响应头。\n原始输出: {}", raw))?;

    let response: SidecarResponse<serde_json::Value> = serde_json::from_str(json_line)
        .map_err(|e| format!("解析快照响应失败: {}\n匹配到的行: {}", e, json_line))?;
    
    if !response.ok {
        return Err(response.error.unwrap_or_else(|| "获取快照失败".to_string()));
    }
    
    let data = response.data.ok_or("快照数据为空")?;
    
    let url = data["url"].as_str().unwrap_or("").to_string();
    let title = data["title"].as_str().unwrap_or("").to_string();
    
    let elements: Vec<InteractiveElement> = data["interactiveElements"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|el| {
            Some(InteractiveElement {
                index: el["index"].as_u64()? as u32,
                tag: el["tag"].as_str()?.to_string(),
                text: el["text"].as_str().unwrap_or("").to_string(),
                r#type: el["type"].as_str().map(String::from),
                placeholder: el["placeholder"].as_str().map(String::from),
                role: el["role"].as_str().map(String::from),
                aria_label: el["ariaLabel"].as_str().map(String::from),
                disabled: el["disabled"].as_bool().unwrap_or(false),
                selector: el["selector"].as_str().unwrap_or("").to_string(),
                visible: el["visible"].as_bool().unwrap_or(true),
                x: el["x"].as_i64().map(|v| v as i32),
                y: el["y"].as_i64().map(|v| v as i32),
            })
        })
        .collect();
    
    Ok(PageSnapshot { url, title, interactive_elements: elements })
}

/// 执行浏览器点击操作
/// 📚 前端调用: await invoke('browser_click', { selector: '#btn-submit', port: 9222 })
#[command]
pub fn browser_click(selector: String, port: Option<u16>, timeout: Option<u32>, config: Option<LlmConfig>) -> Result<ActionResult, String> {
    let cdp_port = port.unwrap_or(9222).to_string();
    let timeout_ms = timeout.unwrap_or(5000).to_string();
    
    let raw = run_sidecar_with_config(vec![
        "click".to_string(),
        format!("--port={}", cdp_port),
        format!("--selector={}", selector),
        format!("--timeout={}", timeout_ms),
    ], config)?;
    
    parse_response::<ActionResult>(&raw)
}

/// 鼠标悬停
#[command]
pub fn browser_hover(selector: String, port: Option<u16>, timeout: Option<u32>, config: Option<LlmConfig>) -> Result<ActionResult, String> {
    let cdp_port = port.unwrap_or(9222).to_string();
    let timeout_ms = timeout.unwrap_or(5000).to_string();
    
    let raw = run_sidecar_with_config(vec![
        "hover".to_string(),
        format!("--port={}", cdp_port),
        format!("--selector={}", selector),
        format!("--timeout={}", timeout_ms),
    ], config)?;
    
    parse_response::<ActionResult>(&raw)
}

/// 在输入框里输入文字
/// 📚 前端调用: await invoke('browser_type', { selector: '#username', value: 'admin' })
#[command]
pub fn browser_type(selector: String, value: String, port: Option<u16>, config: Option<LlmConfig>) -> Result<ActionResult, String> {
    let cdp_port = port.unwrap_or(9222).to_string();
    
    let raw = run_sidecar_with_config(vec![
        "type".to_string(),
        format!("--port={}", cdp_port),
        format!("--selector={}", selector),
        format!("--value={}", value),
    ], config)?;
    
    parse_response::<ActionResult>(&raw)
}

/// 发送按键事件 (如 Enter)
#[command]
pub fn browser_press(selector: String, key: String, port: Option<u16>, config: Option<LlmConfig>) -> Result<ActionResult, String> {
    let cdp_port = port.unwrap_or(9222).to_string();
    
    let raw = run_sidecar_with_config(vec![
        "press".to_string(),
        format!("--port={}", cdp_port),
        format!("--selector={}", selector),
        format!("--key={}", key),
    ], config)?;
    
    parse_response::<ActionResult>(&raw)
}

/// 导航到指定 URL
#[command]
pub fn browser_navigate(url: String, port: Option<u16>, config: Option<LlmConfig>) -> Result<ActionResult, String> {
    let cdp_port = port.unwrap_or(9222).to_string();
    
    let raw = run_sidecar_with_config(vec![
        "navigate".to_string(),
        format!("--port={}", cdp_port),
        format!("--url={}", url),
    ], config)?;
    
    parse_response::<ActionResult>(&raw)
}

/// 断言：检查元素存在
#[command]
pub fn browser_assert(selector: String, contains: Option<String>, port: Option<u16>, config: Option<LlmConfig>) -> Result<ActionResult, String> {
    let cdp_port = port.unwrap_or(9222).to_string();
    
    let mut sidecar_args = vec![
        "assert".to_string(),
        format!("--port={}", cdp_port),
        format!("--selector={}", selector),
    ];
    
    if let Some(text) = contains {
        sidecar_args.push(format!("--contains={}", text));
    }
    
    let raw = run_sidecar_with_config(sidecar_args, config)?;
    parse_response::<ActionResult>(&raw)
}

/// 检查 Chrome CDP 连接状态
/// 📚 前端调用: await invoke('browser_check_connection')
///    用于 Header 里的"穿透网关"状态灯
#[command]
pub fn browser_check_connection(port: Option<u16>) -> Result<bool, String> {
    let cdp_port = port.unwrap_or(9222);
    
    // 📚 用 TCP 连接检测端口是否开放，比 HTTP 请求更轻量
    //    Chrome CDP 在指定端口监听 WebSocket 连接
    use std::net::TcpStream;
    use std::time::Duration;
    
    match TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", cdp_port).parse().map_err(|e: std::net::AddrParseError| e.to_string())?,
        Duration::from_secs(2)
    ) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// 查找本机 Chrome 安装路径
/// 📚 Windows 上 Chrome 通常在以下几个位置之一
fn find_chrome_path() -> Option<String> {
    let local_app_data = format!(
        r"{}\AppData\Local\Google\Chrome\Application\chrome.exe",
        std::env::var("USERPROFILE").unwrap_or_default()
    );

    let candidates = vec![
        // 最常见的安装路径
        r"C:\Program Files\Google\Chrome\Application\chrome.exe".to_string(),
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe".to_string(),
        // 用户目录安装（没有管理员权限时）
        local_app_data,
        // 国内常见的 360 Chrome / Edge 作为备用
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe".to_string(),
    ];

    for path in candidates {
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }
    None
}

/// 一键启动带 CDP 调试端口的 Chrome
/// 
/// 📚 这是整个 SSO 绕过方案的"一键配置"入口！
/// 
/// 工作原理：
/// 1. 找到 Chrome 的安装路径
/// 2. 用 --remote-debugging-port=9222 参数启动 Chrome
/// 3. 用 --user-data-dir 指定一个专用的用户数据目录
///    （这样不会和普通 Chrome 冲突，也不会丢失登录状态）
/// 
/// 用户只需要点一次，然后在打开的 Chrome 里登录自己的 OA/SSO，
/// 之后 LogicGuard 就可以复用这个登录状态了。
#[command]
pub fn launch_chrome_cdp(port: Option<u16>, user_data_dir: Option<String>) -> Result<String, String> {
    let cdp_port = port.unwrap_or(9222);
    
    // 先检查端口是否已经有 Chrome 在跑
    use std::net::TcpStream;
    use std::time::Duration;
    if TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", cdp_port).parse().map_err(|e: std::net::AddrParseError| e.to_string())?,
        Duration::from_millis(500)
    ).is_ok() {
        return Ok(format!("Chrome 已经在端口 {} 上运行，无需重复启动！", cdp_port));
    }

    // 找 Chrome
    let chrome_path = find_chrome_path()
        .ok_or_else(|| {
            "找不到 Chrome 浏览器！\n请确认已安装 Google Chrome，或手动设置 Chrome 路径。".to_string()
        })?;

    // 用户数据目录：专门给 LogicGuard 用的 Chrome Profile
    // 📚 为什么要单独一个目录？
    //    - 避免和用户日常使用的 Chrome 产生锁冲突（两个 Chrome 不能共享同一个 Profile）
    //    - 保留 SSO 登录 Cookie，重启不丢失
    //    - 和普通 Chrome 互相独立，互不影响
    let data_dir = user_data_dir.unwrap_or_else(|| {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| "C:\\Users\\Public".to_string());
        format!("{}\\LogicGuardAI\\ChromeProfile", appdata)
    });

    // 📚 Command::new 启动子进程
    //    .spawn() 是"启动后不等待"，让 Chrome 在后台运行
    //    （如果用 .output() 就会等 Chrome 关闭才返回，那就卡死了）
    std::process::Command::new(&chrome_path)
        .args(&[
            &format!("--remote-debugging-port={}", cdp_port),
            &format!("--user-data-dir={}", data_dir),
            // 以下参数让 Chrome 更适合自动化场景
            "--no-first-run",                    // 跳过"欢迎使用"页面
            "--no-default-browser-check",        // 跳过"设为默认浏览器"弹窗
            "--disable-features=TranslateUI",    // 关闭翻译弹窗
            "about:blank",                       // 打开空白页（更快）
        ])
        .spawn()
        .map_err(|e| format!("启动 Chrome 失败: {}\nChrome 路径: {}", e, chrome_path))?;

    // 等一秒让 Chrome 初始化
    std::thread::sleep(Duration::from_millis(1000));

    Ok(format!(
        "Chrome 已启动！\n\n📍 CDP 端口: {}\n📂 Profile 目录: {}\n\n请在弹出的 Chrome 窗口中登录您的 OA/SSO 系统，\n登录后 LogicGuard AI 就可以复用您的登录状态了。",
        cdp_port, data_dir
    ))
}

/// 获取本机 Chrome 的安装路径（供前端展示）
#[command]
pub fn get_chrome_path() -> Result<String, String> {
    find_chrome_path().ok_or_else(|| "未检测到 Chrome 安装".to_string())
}

// ═══════════════════════════════════════════════════════════════
// 🤖 Stagehand-First 命令：用 AI 直接驱动浏览器
// ═══════════════════════════════════════════════════════════════

/// Stagehand act：用自然语言指令让 AI 直接在当前页面执行操作
/// 前端调用: await invoke('browser_act', { instruction: '点击报表中心', port: 9222 })
#[command]
pub fn browser_act(instruction: String, port: Option<u16>, config: Option<LlmConfig>) -> Result<ActionResult, String> {
    let cdp_port = port.unwrap_or(9222).to_string();

    let raw = run_sidecar_with_config(vec![
        "act".to_string(),
        format!("--port={}", cdp_port),
        format!("--instruction={}", instruction),
    ], config)?;

    parse_response::<ActionResult>(&raw)
}

/// Stagehand observe：用自然语言让 AI 观察当前页面有哪些可操作元素
/// 前端调用: await invoke('browser_observe', { instruction: '找到所有按钮', port: 9222 })
#[command]
pub fn browser_observe(instruction: String, port: Option<u16>, config: Option<LlmConfig>) -> Result<serde_json::Value, String> {
    let cdp_port = port.unwrap_or(9222).to_string();

    let raw = run_sidecar_with_config(vec![
        "observe".to_string(),
        format!("--port={}", cdp_port),
        format!("--instruction={}", instruction),
    ], config)?;

    // observe 返回结构不固定（含 observations 数组），用 serde_json::Value 透传
    let json_line = raw.lines()
        .find(|line| line.trim().starts_with("{\"ok\":") || (line.trim().starts_with("{") && line.trim().contains("\"ok\"")))
        .ok_or_else(|| format!("在 observe 输出中找不到有效的 JSON 响应。\n原始输出: {}", raw))?;

    let response: SidecarResponse<serde_json::Value> = serde_json::from_str(json_line)
        .map_err(|e| format!("解析 observe 响应失败: {}\n匹配到的行: {}", e, json_line))?;

    if !response.ok {
        return Err(response.error.unwrap_or_else(|| "observe 失败".to_string()));
    }

    response.data.ok_or_else(|| "observe 返回空数据".to_string())
}

// ═══════════════════════════════════════════════════════════════
// 🚀 Stagehand 原生闭环 Agent：实时流式执行
// ═══════════════════════════════════════════════════════════════

/// Agent 步骤事件的数据结构（对应 sidecar 输出的 [AGENT_STEP] JSON）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentStepEvent {
    /// 步骤类型: "thinking" | "action" | "done" | "error"
    #[serde(rename = "type")]
    pub step_type: String,
    /// 对用户展示的可读步骤描述
    pub description: String,
    /// 工具名或其他补充信息（可选）
    pub detail: Option<String>,
    /// ISO 时间戳
    pub timestamp: String,
}

/// 启动 Stagehand 原生闭环 Agent，实时向前端推送每一步的动作
/// 
/// 工作原理：
/// 1. 以 Stdio::piped() 方式启动 Node sidecar 子进程
/// 2. 逐行读取子进程的 stdout
/// 3. 对每一行以 "[AGENT_STEP]" 开头的行，解析 JSON 并通过 Tauri emit 发给前端
/// 4. 等待子进程结束，解析最终结果返回
/// 
/// 前端调用: await invoke('browser_run_agent', { instruction: '登录并下载报表', port: 9222 })
/// 前端监听: await listen('stagehand-agent-step', (event) => { ... })
#[command]
pub fn browser_run_agent(
    app: tauri::AppHandle,
    instruction: String,
    port: Option<u16>,
    config: Option<LlmConfig>,
) -> Result<serde_json::Value, String> {
    let cdp_port = port.unwrap_or(9222).to_string();
    let node_cmd = "node";

    // ── 找到 sidecar/index.js 路径 ──────────────────────────────
    let sidecar_path = {
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("无法获取程序路径: {}", e))?;
        let mut path = exe_path.clone();
        let mut found = false;
        for _ in 0..6 {
            path = match path.parent() {
                Some(p) => p.to_path_buf(),
                None => break,
            };
            if path.join("sidecar").join("index.js").exists() {
                found = true;
                break;
            }
        }
        if !found {
            return Err("找不到 sidecar/index.js".to_string());
        }
        path.join("sidecar").join("index.js")
    };

    // ── 构建带环境变量的命令 ─────────────────────────────────────
    let mut cmd = Command::new(node_cmd);
    cmd.arg(&sidecar_path)
       .arg("agent")
       .arg(format!("--port={}", cdp_port))
       .arg(format!("--instruction={}", instruction))
       .stdout(std::process::Stdio::piped())
       .stderr(std::process::Stdio::piped());

    // 注入 LLM 配置环境变量
    if let Some(cfg) = config {
        if let Some(ref key) = cfg.api_key {
            cmd.env("LLM_API_KEY", key);
            cmd.env("OPENAI_API_KEY", key);
        }
        if let Some(ref base_url) = cfg.base_url {
            cmd.env("LLM_BASE_URL", base_url);
            cmd.env("OPENAI_BASE_URL", base_url);
        }
        cmd.env("LLM_PROVIDER", &cfg.provider);
        cmd.env("LLM_MODEL", &cfg.model);
    }

    // ── 启动子进程，以流式方式读取 stdout ────────────────────────
    let mut child = cmd.spawn()
        .map_err(|e| format!("启动 Agent sidecar 失败: {}", e))?;

    let stdout = child.stdout.take()
        .ok_or_else(|| "无法获取 sidecar stdout".to_string())?;

    let reader = BufReader::new(stdout);
    let mut all_output_lines: Vec<String> = Vec::new();
    let agent_step_prefix = "[AGENT_STEP]";

    // 逐行读取 stdout，实时解析并推送 Agent 步骤事件
    for line in reader.lines() {
        match line {
            Ok(line_str) => {
                all_output_lines.push(line_str.clone());
                // 只处理带有 [AGENT_STEP] 前缀的行
                if let Some(json_part) = line_str.strip_prefix(agent_step_prefix) {
                    if let Ok(step_event) = serde_json::from_str::<AgentStepEvent>(json_part) {
                        // 通过 Tauri 事件总线推送到前端
                        // 前端通过 listen('stagehand-agent-step', ...) 接收
                        let _ = app.emit("stagehand-agent-step", step_event);
                    }
                }
            }
            Err(_) => break,
        }
    }

    // 等待子进程结束
    let exit_status = child.wait()
        .map_err(|e| format!("等待 Agent sidecar 结束失败: {}", e))?;

    let full_output = all_output_lines.join("\n");

    if !exit_status.success() {
        // 从所有输出中找最终的 JSON 结果行（包含 ok: false 的错误信息）
        let error_msg = full_output.lines()
            .filter(|line| line.trim().starts_with("{\"ok\":") || 
                           (line.trim().starts_with("{") && line.trim().contains("\"ok\"")))
            .last()
            .and_then(|line| serde_json::from_str::<SidecarResponse<serde_json::Value>>(line).ok())
            .and_then(|resp| resp.error)
            .unwrap_or_else(|| format!("Agent 执行失败（退出码: {:?}）", exit_status.code()));
        return Err(error_msg);
    }

    // 从输出中提取最终的成功 JSON 结果行
    let json_line = full_output.lines()
        .filter(|line| !line.starts_with(agent_step_prefix)) // 排除 AGENT_STEP 行
        .find(|line| line.trim().starts_with("{\"ok\":") || 
                     (line.trim().starts_with("{") && line.trim().contains("\"ok\"")))
        .ok_or_else(|| format!("Agent 执行完成但未找到有效的 JSON 结果。\n原始输出片段: {}", 
                               &full_output[..full_output.len().min(500)]))?;

    let response: SidecarResponse<serde_json::Value> = serde_json::from_str(json_line)
        .map_err(|e| format!("解析 Agent 最终结果失败: {}", e))?;

    if !response.ok {
        return Err(response.error.unwrap_or_else(|| "Agent 报告任务失败".to_string()));
    }

    response.data.ok_or_else(|| "Agent 返回空数据".to_string())
}
