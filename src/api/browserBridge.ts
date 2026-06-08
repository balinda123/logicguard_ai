/**
 * browserBridge.ts - 浏览器控制前端封装
 * 
 * 📚 这个文件的作用：
 * 把复杂的 Tauri invoke() 调用封装成简单的函数，
 * 让 Dashboard 组件只需要调用 getPageSnapshot() 这样的友好函数，
 * 不需要关心底层是怎么调用 Rust 的。
 * 
 * 这种模式叫做"Service Layer（服务层）"，
 * 好处是：如果将来我们换了底层实现，只需要改这一个文件。
 */

import { invoke } from '@tauri-apps/api/core';
import type { PageContext, InteractiveElement } from '../types';
import { getLlmConfig } from './llmBridge';

// Rust 返回的字段名是 snake_case，前端 TypeScript 用 camelCase
// 这个接口对应 browser.rs 里的 PageSnapshot 结构体
interface RustPageSnapshot {
  url: string;
  title: string;
  interactive_elements: RustInteractiveElement[];
}

interface RustInteractiveElement {
  index: number;
  tag: string;
  text: string;
  type?: string;
  placeholder?: string;
  role?: string;
  aria_label?: string;
  disabled: boolean;
  selector: string;
  visible: boolean;
}

// 把 Rust 的 snake_case 字段转换成前端 camelCase
function mapElement(el: RustInteractiveElement): InteractiveElement {
  return {
    index: el.index,
    tag: el.tag,
    text: el.text,
    type: el.type,
    placeholder: el.placeholder,
    role: el.role,
    disabled: el.disabled,
    selector: el.selector,
  };
}

// CDP 配置（可以从 Settings 读取，目前硬编码默认值）
const CDP_PORT = 9222;

// ─── 检查 Chrome CDP 连接 ─────────────────────────────────────
export async function checkBrowserConnection(): Promise<boolean> {
  try {
    return await invoke<boolean>('browser_check_connection', { port: CDP_PORT });
  } catch {
    return false;
  }
}

// ─── 读取页面纯文本内容（零 AI token 消耗）────────────────────────

/** 读取当前 CDP 页面的纯文本内容，用于需求文档解析。
 * 
 * @param keyword 可选关键词，若提供则只返回包含该关键词的段落（及前后各1段作为上下文）
 *                不提供则返回全页文字（最多20000字符）
 * 
 * ⚡ 完全不调用 AI，是纯本地 CDP 操作，零 token 消耗。
 *    只有最终把返回内容发给 LLM 时才会消耗 token。
 */
export async function getPageContent(keyword?: string): Promise<{
  url: string;
  title: string;
  content: string;
  totalChars: number;
  filteredChars: number;
  keyword: string | null;
  paragraphCount: number;
}> {
  const config = getLlmConfig();
  return await invoke('browser_get_page_content', {
    port: CDP_PORT,
    keyword: keyword?.trim() || null,
    config,
  });
}

// ─── 获取页面快照 ──────────────────────────────────────────────
export async function getPageSnapshot(): Promise<PageContext> {
  const config = getLlmConfig();
  const snapshot = await invoke<RustPageSnapshot>('browser_get_snapshot', {
    port: CDP_PORT,
    config,
  });

  return {
    url: snapshot.url,
    title: snapshot.title,
    interactiveElements: snapshot.interactive_elements.map(mapElement),
  };
}

// ─── 执行浏览器动作 ────────────────────────────────────────────

export interface BrowserActionResult {
  action: string;
  message: string;
  selector?: string;
  value?: string;
}

export async function browserClick(selector: string, timeout = 5000): Promise<BrowserActionResult> {
  const config = getLlmConfig();
  return await invoke<BrowserActionResult>('browser_click', {
    selector,
    port: CDP_PORT,
    timeout,
    config,
  });
}

/**
 * 鼠标悬停
 */
export async function browserHover(selector: string): Promise<BrowserActionResult> {
  const config = getLlmConfig();
  return await invoke<BrowserActionResult>('browser_hover', {
    selector,
    port: CDP_PORT,
    config,
  });
}

export async function browserType(selector: string, value: string): Promise<BrowserActionResult> {
  const config = getLlmConfig();
  return await invoke<BrowserActionResult>('browser_type', {
    selector,
    value,
    port: CDP_PORT,
    config,
  });
}

export async function browserNavigate(url: string): Promise<BrowserActionResult> {
  const config = getLlmConfig();
  return await invoke<BrowserActionResult>('browser_navigate', {
    url,
    port: CDP_PORT,
    config,
  });
}

export async function browserAssert(selector: string, contains?: string): Promise<BrowserActionResult> {
  const config = getLlmConfig();
  return await invoke<BrowserActionResult>('browser_assert', {
    selector,
    contains,
    port: CDP_PORT,
    config,
  });
}

// ─── 通用执行器：根据 action 类型分发到对应函数 ─────────────────
// 📚 这是"执行引擎"的核心分发函数
//    AI 生成的 GeneratorOutput 告诉我们 action 是 click/type/navigate...
//    这个函数负责路由到正确的操作

export async function browserPress(selector: string, key: string): Promise<BrowserActionResult> {
  const config = getLlmConfig();
  return await invoke<BrowserActionResult>('browser_press', {
    selector,
    key,
    port: CDP_PORT,
    config,
  });
}

export async function executeBrowserAction(
  action: string,
  target: string,
  value?: string
): Promise<BrowserActionResult> {
  switch (action) {
    case 'click':
      return await browserClick(target);
    case 'hover':
      return await browserHover(target);
    case 'type':
      return await browserType(target, value ?? '');
    case 'press':
      return await browserPress(target, value ?? 'Enter');
    case 'navigate':
      return await browserNavigate(target);
    case 'assert':
      return await browserAssert(target, value);
    case 'select':
      // 暂时用 click 模拟 select
      return await browserClick(target);
    case 'wait':
      // wait 不需要浏览器操作，只是等待
      await new Promise(r => setTimeout(r, parseInt(value ?? '1000')));
      return { action: 'wait', message: `等待 ${value ?? 1000}ms 完成` };
    default:
      throw new Error(`不支持的 action 类型: ${action}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 🤖 Stagehand-First API：用自然语言直接驱动 AI 浏览器操作
// ═══════════════════════════════════════════════════════════════

/**
 * Stagehand act：用自然语言指令让 AI 直接在当前页面执行操作
 * 核心优势：AI 实时感知当前页面 DOM，自动定位元素，完美支持跨页面
 */
export async function browserAct(instruction: string): Promise<BrowserActionResult> {
  const config = getLlmConfig();
  return await invoke<BrowserActionResult>('browser_act', {
    instruction,
    port: CDP_PORT,
    config,
  });
}

/**
 * Stagehand observe：用自然语言让 AI 观察当前页面有哪些可操作元素
 */
export async function browserObserve(instruction: string): Promise<any> {
  const config = getLlmConfig();
  return await invoke<any>('browser_observe', {
    instruction,
    port: CDP_PORT,
    config,
  });
}
