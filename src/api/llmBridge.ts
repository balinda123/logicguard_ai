import { invoke } from '@tauri-apps/api/core';
import type { PlanStep, GeneratorOutput, HealerLog } from '../types';

// =============================================
// LLM Configuration (stored in app state)
// =============================================

export interface LlmConfig {
  provider: 'gemini' | 'ollama' | 'openai_compat';
  api_key?: string;
  base_url?: string;
  model: string;
}

// Default to Gemini for company use
const DEFAULT_CONFIG: LlmConfig = {
  provider: 'gemini',
  model: 'gemini-2.0-flash',
};

let _config: LlmConfig = { ...DEFAULT_CONFIG };

export function getLlmConfig(): LlmConfig {
  // Try to load from localStorage (persisted across sessions)
  try {
    const stored = localStorage.getItem('logicguard_llm_config');
    if (stored) {
      _config = JSON.parse(stored);
    }
  } catch {
    // ignore
  }
  return _config;
}

export function setLlmConfig(config: LlmConfig): void {
  _config = config;
  localStorage.setItem('logicguard_llm_config', JSON.stringify(config));
}

export function isConfigured(): boolean {
  const c = getLlmConfig();
  if (c.provider === 'ollama') return true; // Ollama needs no key
  return !!(c.api_key && c.api_key.trim().length > 10);
}

// =============================================
// Test LLM Connection
// =============================================

export async function testLlmConnection(config?: LlmConfig): Promise<{ ok: boolean; message: string }> {
  const cfg = config ?? getLlmConfig();
  try {
    const raw = await invoke<string>('test_llm_connection', { config: cfg });
    const parsed = JSON.parse(raw);
    return { ok: parsed.status === 'ok', message: parsed.message ?? raw };
  } catch (e) {
    return { ok: false, message: String(e) };
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
  onProgress?: (status: string) => void
): Promise<PlannerResult> {
  const config = getLlmConfig();

  onProgress?.('🧠 正在连接 AI 模型...');

  let raw: string;
  try {
    raw = await invoke<string>('plan_task', {
      userIntent,
      config,
    });
  } catch (e) {
    throw new Error(`LLM 调用失败: ${e}`);
  }

  onProgress?.('📋 正在解析执行计划...');

  try {
    // Strip potential markdown code fences
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed: PlannerResult = JSON.parse(cleaned);

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
// Generator: Step + DOM → Concrete Action
// =============================================

export async function generateAction(
  stepDescription: string,
  domContext: string
): Promise<GeneratorOutput> {
  const config = getLlmConfig();

  const raw = await invoke<string>('generate_action', {
    stepDescription,
    domContext,
    config,
  });

  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned) as GeneratorOutput;
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
    stepDescription,
    failureReason,
    domContext,
    config,
  });

  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned) as HealerResult;
}
