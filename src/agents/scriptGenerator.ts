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
import { compressDomForLlm } from '../utils/domCompressor';

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
 * 构建富含元数据的 DOM 快照
 * 比普通的 compressDomForLlm 多了 placeholder / aria-label / name 等关键定位属性
 */
function buildRichSnapshot(snapshot: { url: string; title: string; interactiveElements: any[] }): string {
  const lines: string[] = [];
  lines.push(`页面标题: ${snapshot.title}`);
  lines.push('---');

  for (const el of snapshot.interactiveElements) {
    const parts: string[] = [];
    parts.push(`[#${el.index}]`);
    parts.push(`<${(el.tag || 'el').toLowerCase()}>`);

    if (el.text?.trim()) {
      parts.push(`text="${el.text.trim().slice(0, 60)}"`);
    }
    if (el.placeholder) {
      parts.push(`placeholder="${el.placeholder}"`);
    }
    if (el.ariaLabel) {
      parts.push(`aria-label="${el.ariaLabel}"`);
    }
    if (el.role) {
      parts.push(`role="${el.role}"`);
    }
    if (el.type) {
      parts.push(`type="${el.type}"`);
    }
    if (el.x !== undefined && el.y !== undefined) {
      parts.push(`[x:${el.x}, y:${el.y}]`);
    }
    if (!el.visible) {
      parts.push('[hidden]');
    }

    lines.push(parts.join(' '));
  }

  return lines.join('\n');
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
