import { invoke } from '@tauri-apps/api/core';
import type { PlanStep, GeneratorOutput, HealerLog } from '../types';
import { sanitizeForLlm } from '../utils/privacy';

// =============================================
// LLM Configuration (stored in app state)
// =============================================

export interface LlmConfig {
  provider: 'gemini' | 'openai_compat' | 'ollama';
  api_key?: string;
  base_url?: string;
  model: string;
  credential_configured?: boolean;
}

// Default to Gemini for company use
const DEFAULT_CONFIG: LlmConfig = {
  provider: 'gemini',
  model: 'gemini-2.0-flash',
};

let _config: LlmConfig = { ...DEFAULT_CONFIG };

function configStorageKey(): string {
  return `logicguard_llm_config_${sessionStorage.getItem('logicguard_user_id') ?? 'anonymous'}`;
}

export function getLlmConfig(): LlmConfig {
  // Try to load from localStorage (persisted across sessions)
  try {
    const stored = localStorage.getItem(configStorageKey());
    if (stored) {
      _config = JSON.parse(stored);
      delete _config.api_key;
    }
  } catch {
    // ignore
  }
  return _config;
}

export function setLlmConfig(config: LlmConfig): void {
  const safeConfig = { ...config };
  delete safeConfig.api_key;
  _config = safeConfig;
  localStorage.setItem(configStorageKey(), JSON.stringify(safeConfig));
}

export function isConfigured(): boolean {
  const c = getLlmConfig();
  return c.credential_configured === true;
}

// =============================================
// Test LLM Connection
// =============================================

function localizeLlmMessage(message: string): string {
  const normalized = message.trim();
  const lower = normalized.toLowerCase();
  if (lower === 'llm connection successful' || lower === 'connection successful') {
    return '模型连接成功';
  }
  if (lower.includes('api key') && lower.includes('missing')) {
    return '缺少 API Key，请先在系统设置中保存密钥';
  }
  if (lower.includes('base_url not configured')) {
    return '缺少 API Base URL，请在系统设置中填写接口地址';
  }
  if (lower.includes('unknown llm provider')) {
    return '未知的模型提供商，请重新选择模型预设';
  }
  return normalized;
}

export async function testLlmConnection(config?: LlmConfig): Promise<{ ok: boolean; message: string }> {
  const cfg = config ?? getLlmConfig();
  try {
    const raw = await invoke<string>('test_llm_connection', { config: cfg });
    const parsed = JSON.parse(raw);
    return { ok: parsed.status === 'ok', message: localizeLlmMessage(parsed.message ?? raw) };
  } catch (e) {
    return { ok: false, message: localizeLlmMessage(String(e)) };
  }
}

// =============================================
// Planning: Natural language → PlanStep[]
// =============================================

export interface PlannerResult {
  planId: string;
  task: string;
  estimatedTime: number;
  steps: PlanStep[];
}

export async function planTask(
  userIntent: string,
  context: string = '',
  onProgress?: (status: string) => void
): Promise<PlannerResult> {
  const config = getLlmConfig();

  onProgress?.('🧠 正在连接 AI 模型...');

  let raw: string;
  try {
    raw = await invoke<string>('plan_task', {
      userIntent: sanitizeForLlm(userIntent),
      context: sanitizeForLlm(context),
      config,
    });
  } catch (e) {
    throw new Error(`LLM 调用失败: ${e}`);
  }

  onProgress?.('📋 正在解析执行计划...');

  try {
    const parsed: PlannerResult = extractJson(raw);

    // Ensure all steps are in 'pending' status
    parsed.steps = parsed.steps.map((s, i) => ({
      ...s,
      stepId: s.stepId ?? i + 1,
      status: 'pending' as const,
    }));

    return parsed;
  } catch {
    throw new Error(`AI 返回格式解析失败，原始内容：${raw.slice(0, 200)}`);
  }
}

// =============================================
// JSON Parser Helper
// =============================================

function extractJson(raw: string): any {
  console.log(raw,'rawllm');
  
  try {
    // 1. Try standard replace first
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    // 2. Fallback: Find first { or [ and last } or ]
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    const firstBracket = raw.indexOf('[');
    const lastBracket = raw.lastIndexOf(']');
    
    let startIdx = -1;
    let endIdx = -1;

    // Use object braces if they exist and are valid, otherwise arrays
    if (firstBrace !== -1 && lastBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      startIdx = firstBrace;
      endIdx = lastBrace;
    } else if (firstBracket !== -1 && lastBracket !== -1) {
      startIdx = firstBracket;
      endIdx = lastBracket;
    }

    if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
      const jsonStr = raw.substring(startIdx, endIdx + 1);
      try {
        return JSON.parse(jsonStr);
      } catch {
        throw new Error(`无法从 LLM 返回内容中提取有效的 JSON: ${raw}`);
      }
    }
    
    throw new Error(`LLM 未返回任何 JSON 结构: ${raw}`);
  }
}

// =============================================
// Generator: Step + DOM → Concrete Action
// =============================================

export async function generateAction(
  stepDescription: string,
  domContext: string
): Promise<GeneratorOutput> {
  const config = getLlmConfig();

  const raw = await invoke<string>('generate_action', {
    stepDescription: sanitizeForLlm(stepDescription),
    domContext: sanitizeForLlm(domContext),
    config,
  });

  return extractJson(raw) as GeneratorOutput;
}

// =============================================
// Healer: Failed step + DOM → Recovery action
// =============================================

export interface HealerResult {
  diagnosis: string;
  strategy: HealerLog['strategy'];
  action: GeneratorOutput['action'];
  target: string;
  value?: string;
  confidence: number;
  resolved: boolean;
}

export async function healStep(
  stepDescription: string,
  failureReason: string,
  domContext: string
): Promise<HealerResult> {
  const config = getLlmConfig();

  const raw = await invoke<string>('heal_step', {
    stepDescription: sanitizeForLlm(stepDescription),
    failureReason: sanitizeForLlm(failureReason),
    domContext: sanitizeForLlm(domContext),
    config,
  });

  return extractJson(raw) as HealerResult;
}
