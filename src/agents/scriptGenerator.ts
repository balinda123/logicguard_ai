/**
 * scriptGenerator.ts — 测试脚本生成 Agent
 *
 * 新架构核心：
 * 用户输入 → 一次 LLM 调用（理解意图 + 观察当前 DOM）→ 生成结构化 TestScript
 * 执行时完全不再调用 LLM，由确定性执行器按策略精准定位元素。
 */

import { invoke } from '@tauri-apps/api/core';
import { getLlmConfig } from '../api/llmBridge';
import { getPageSnapshot } from '../api/browserBridge';
import type { TestScript, TestStep } from '../types';

export interface GenerateScriptOptions {
  onProgress?: (msg: string) => void;
}

/**
 * 将用户的自然语言需求转换为确定性测试脚本
 */
export async function generateTestScript(
  userIntent: string,
  opts?: GenerateScriptOptions
): Promise<TestScript> {
  const { onProgress } = opts ?? {};
  const config = getLlmConfig();

  onProgress?.('📡 正在抓取当前页面 DOM 结构...');

  let domSnapshot = '（无法获取当前页面信息，请确保 Chrome 已连接 CDP）';
  let pageUrl = 'unknown';

  try {
    const snapshot = await getPageSnapshot();
    pageUrl = snapshot.url;
    // 构建富含元数据的 DOM 快照，供大模型选择最佳定位策略
    domSnapshot = buildRichSnapshot(snapshot);
  } catch (e) {
    console.warn('[scriptGenerator] 无法获取 DOM 快照', e);
  }

  onProgress?.('🤖 AI 正在分析需求，生成测试脚本...');

  const raw = await invoke<string>('generate_test_script', {
    userIntent,
    domSnapshot,
    pageUrl,
    config,
  });

  const parsed = parseTestScript(raw);
  onProgress?.(`✅ 脚本生成完成，共 ${parsed.steps.length} 个步骤`);
  return parsed;
}

/**
 * 构建富含元数据的 DOM/AX 快照
 * 同时支持 AX 树节点（source='ax'）和 DOM 节点，为 AI 提供最完整的语义信息
 */
function buildRichSnapshot(snapshot: { url: string; title: string; interactiveElements: any[] }): string {
  const lines: string[] = [];
  lines.push(`页面标题: ${snapshot.title}`);
  lines.push('---');

  for (const el of snapshot.interactiveElements) {
    const parts: string[] = [];
    parts.push(`[#${el.index}]`);

    // ── AX 树节点（语义最准确）──
    if (el.source === 'ax') {
      const roleTag = mapRoleToLabel(el.role);
      parts.push(roleTag);

      // accessibleName 是用户可见的文字/标签，这是 AI 理解"这是什么"的核心
      if (el.accessibleName) parts.push(`name="${el.accessibleName}"`);
      if (el.description)    parts.push(`description="${el.description}"`);
      if (el.currentValue)   parts.push(`value="${el.currentValue}"`);
      if (el.disabled)       parts.push('[disabled]');

      // 定位策略：AX 节点优先用 accessible-name，通过 Playwright getByRole/getByLabel 定位
      parts.push(`→ strategy:accessible-name="${el.accessibleName || el.description}"`);

    } else {
      // ── DOM 节点（兜底方案）──
      const tag = (el.tag || 'el').toUpperCase();
      const typeLabel = mapDomTagToLabel(tag, el.type, el.placeholder);
      parts.push(typeLabel);

      // 优先显示 placeholder（对于 INPUT 最有辨识度）
      if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
      if (el.labelText)   parts.push(`label="${el.labelText}"`);
      if (el.ariaLabel)   parts.push(`aria-label="${el.ariaLabel}"`);
      if (el.text?.trim()) {
        const preview = el.text.trim().replace(/\s+/g, ' ').slice(0, 50);
        parts.push(tag === 'SELECT' ? `selected="${preview}"` : `text="${preview}"`);
      }
      if (tag === 'SELECT' && el.options) parts.push(`options=[${el.options}]`);
      if (el.x !== undefined && el.y !== undefined) parts.push(`[x:${el.x}, y:${el.y}]`);
      if (!el.visible) parts.push('[hidden]');
    }

    lines.push(parts.join(' '));
  }

  return lines.join('\n');
}

function mapRoleToLabel(role: string): string {
  const map: Record<string, string> = {
    'button':   '[BUTTON]',
    'link':     '[LINK]',
    'textbox':  '[INPUT]',
    'searchbox':'[INPUT(搜索)]',
    'combobox': '[DROPDOWN-自定义]',  // el-select / ant-select 等
    'listbox':  '[LISTBOX]',
    'option':   '[OPTION]',
    'checkbox': '[CHECKBOX]',
    'radio':    '[RADIO]',
    'tab':      '[TAB]',
    'menuitem': '[MENUITEM]',
    'treeitem': '[TREEITEM]',
    'spinbutton': '[NUMBER-INPUT]',
  };
  return map[role] ?? `[${role.toUpperCase()}]`;
}

function mapDomTagToLabel(tag: string, type?: string, placeholder?: string): string {
  if (tag === 'SELECT') return '[DROPDOWN-原生]';
  if (tag === 'INPUT') {
    const t = (type || 'text').toLowerCase();
    if (t === 'checkbox') return '[CHECKBOX]';
    if (t === 'radio')    return '[RADIO]';
    // placeholder 含"请选择"说明是自定义下拉框的触发输入框
    if (placeholder && placeholder.includes('请选择')) return '[DROPDOWN-自定义触发框]';
    return '[INPUT]';
  }
  if (tag === 'BUTTON')   return '[BUTTON]';
  if (tag === 'A')        return '[LINK]';
  if (tag === 'TEXTAREA') return '[TEXTAREA]';
  return `[${tag}]`;
}


/**
 * 解析 LLM 返回的 JSON，容错处理 Markdown 代码块等
 */
function parseTestScript(raw: string): TestScript {
  let jsonStr = raw.trim();

  // 去除可能的 markdown 代码块包裹
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // 找到第一个 { 和最后一个 } 之间的内容
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    jsonStr = jsonStr.slice(start, end + 1);
  }

  const parsed = JSON.parse(jsonStr);

  // 确保 steps 里每个元素有 status 字段
  if (Array.isArray(parsed.steps)) {
    parsed.steps = parsed.steps.map((s: Partial<TestStep>, i: number) => ({
      ...s,
      stepId: s.stepId ?? i + 1,
      status: 'pending' as const,
    }));
  }

  return parsed as TestScript;
}
