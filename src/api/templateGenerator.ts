/**
 * templateGenerator.ts - 从需求文档文本生成测试模板
 *
 * 这个模块负责：
 * 1. 组装"需求文档 → 测试模板"的 LLM Prompt
 * 2. 复用现有的 Rust LLM 通道调用 AI
 * 3. 解析 AI 返回的 JSON，容错处理
 *
 * ⚠️ 只有调用 generateTemplateFromDocument() 时才消耗 token
 *    读取页面内容本身（getPageContent）是零 token 操作
 */

import { invoke } from '@tauri-apps/api/core';
import { getLlmConfig } from './llmBridge';
import type { ScenarioTemplate } from '../types';

// ─── Prompt 模板 ──────────────────────────────────────────────────────────────

function buildPrompt(documentText: string, targetUrl: string): string {
  return `你是一名资深的软件 QA 测试开发工程师。请深度分析下方的需求文档，基于 MetaGPT 的 QA 自动化测试用例规范（Test Case Design Specification），对该需求进行结构化分析、场景建模，并生成一份高质量的自动化测试模板。

要求与规范：

1. 【测试用例场景规划 (Test Scenario Design)】
   - 根据需求，梳理出正常主流程（Happy Path）和必要的分支场景。
   - 提取出清晰的模板名称（name），字数控制在 25 字以内，格式如：“XX模块配置/申请流程测试”。
   - category 从以下类型中精准选择：login（登录相关）、form（表单填写与提交）、approval（审批与流转）、query（数据查询与筛选）、other（其他场景）。

2. 【MetaGPT 风格的变量抽离与参数化建模 (Parameterization & Variables)】
   - 仔细识别需求正文中所有可变输入项（如输入框输入的内容、下拉框选择的值、开关勾选的状态等）。
   - 将这些输入项抽象为 \`variables\` 数组，每个变量包含：
     - \`name\`: 必须使用小驼峰命名法（如 \`staffNo\`, \`targetWeight\`, \`approveOpinion\`）。
     - \`label\`: 简短明了的中文描述名称（如 “工号”, “指标权重”, “审批意见”），对应前端界面表单的 Label。
     - \`type\`: 必须从 \`text\`（普通文本/数字输入）、\`password\`（密码输入）、\`select\`（下拉框选择）中选择。
     - \`required\`: 必填项设为 true，选填项设为 false。
     - \`defaultValue\`: 根据需求文档给出的实例或默认场景，提供一个代表成功路径的预设默认值。

3. 【步骤原子化与变量绑定 (Atomic Steps & Variable Binding)】
   - 步骤必须是原子的、可被执行的单一 UI 交互动作。操作类型（action）必须为：\`navigate\`、\`click\`、\`type\`、\`select\`、\`assert\`、\`wait\` 之一。
   - 【大纲导航补全】：如果正文上方含有 "[需求文档全局导航目录大纲]"，必须首先推理出当前测试页面所处的侧边栏或主菜单层级结构（例如“通用配置 - 评分规则”属于“通用配置”分类）。
     - 在第 1 步和第 2 步，必须生成进入该页面的点击步骤（如 步骤1：[click] 点击左侧菜单“通用配置”；步骤2：[click] 点击菜单“评分规则”），不能直接越级操作。
   - 【变量双向替换】：若某步骤包含用户输入或下拉选择，必须在描述或选择器提示中使用双大括号 \`{{变量名}}\` 进行参数化绑定（例如：在“工号输入框”填写时，步骤描述写为：\`"在工号输入框输入 {{staffNo}}"\`；元素提示 \`selectorHint\` 写为：\`"工号输入框"\`）。
   - 【验证与断言 (Assertion)】：根据 MetaGPT QA 规范，一个合格的测试用例必须包含预期结果校验。测试的最后 1~2 步，必须生成包含 \`assert\` 动作的断言步骤（例如：\`"验证页面是否显示：保存成功"\`，并将其 \`selectorHint\` 设为 \`"提示气泡"\`）。

需求文档内容：
---
${documentText}
---

目标系统 URL（参考）：${targetUrl || '未知'}

请严格输出以下符合格式要求的标准 JSON 对象，不要输出任何额外的 markdown 代码标记、前后包裹或解释性文字：
{
  "id": "tpl_auto_${Date.now()}",
  "name": "（格式如：XX模块配置/申请流程测试）",
  "category": "form",
  "description": "（对该测试模板业务场景的详细说明，包含前置条件）",
  "targetUrl": "${targetUrl || ''}",
  "steps": [
    {
      "order": 1,
      "description": "（操作步骤中文描述，输入项用 {{变量名}} 占位）",
      "action": "navigate",
      "selectorHint": "（给 AI 执行器的元素提示定位文字，如：保存按钮，不要带有 html 标签）"
    }
  ],
  "variables": [
    {
      "name": "camelCaseName",
      "label": "（中文友好展示名）",
      "type": "text",
      "required": true,
      "defaultValue": "（合法默认值）"
    }
  ],
  "tags": ["（与场景相关的 2~3 个中文标签，如：绩效、通用配置、审批）"]
}`;
}

// ─── 从 LLM 原始返回中提取 JSON ───────────────────────────────────────────────

function extractJson(raw: string): any {
  // 先去掉 markdown 代码块
  const cleaned = raw
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fallback：找第一个 { 到最后一个 }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && start < end) {
      try {
        return JSON.parse(cleaned.substring(start, end + 1));
      } catch {
        throw new Error(`AI 返回的内容不是有效的 JSON 格式。原始内容片段：${raw.slice(0, 300)}`);
      }
    }
    throw new Error(`AI 返回内容中找不到 JSON 结构。原始内容片段：${raw.slice(0, 300)}`);
  }
}

// ─── 校验并补全 AI 生成的模板结构 ─────────────────────────────────────────────

function normalizeTemplate(raw: any, documentText: string): ScenarioTemplate {
  // 确保必填字段存在
  const id = raw.id || `tpl_auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const name = raw.name || '（AI 生成的测试模板）';
  const category = ['login', 'form', 'approval', 'query', 'other'].includes(raw.category)
    ? raw.category
    : 'other';

  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((s: any, idx: number) => ({
        order: s.order ?? idx + 1,
        description: s.description || `步骤 ${idx + 1}`,
        action: s.action || 'click',
        selectorHint: s.selectorHint || undefined,
      }))
    : [{ order: 1, description: '（AI 未生成步骤，请手动添加）', action: 'click' }];

  const variables = Array.isArray(raw.variables)
    ? raw.variables.map((v: any) => ({
        name: v.name || 'variable',
        label: v.label || v.name || '变量',
        type: (['text', 'password', 'select'].includes(v.type) ? v.type : 'text') as 'text' | 'password' | 'select',
        required: v.required ?? false,
        defaultValue: v.defaultValue ?? '',
      }))
    : [];

  const tags: string[] = Array.isArray(raw.tags) ? raw.tags : ['AI生成'];

  return {
    id,
    name,
    category: category as ScenarioTemplate['category'],
    description: raw.description || `基于需求文档自动生成的测试模板（${documentText.slice(0, 50)}...）`,
    targetUrl: raw.targetUrl || undefined,
    steps,
    variables,
    tags,
    parameterSets: [],
    sourceDocument: documentText.slice(0, 500), // 保存前500字作为来源记录
    generatedAt: new Date().toISOString(),
  };
}

// ─── 主函数：调用 LLM 生成模板 ───────────────────────────────────────────────

export interface GenerateTemplateOptions {
  onProgress?: (status: string) => void;
  targetUrl?: string;
}

export async function generateTemplateFromDocument(
  documentText: string,
  options: GenerateTemplateOptions = {}
): Promise<ScenarioTemplate> {
  const { onProgress, targetUrl = '' } = options;

  if (!documentText.trim()) {
    throw new Error('需求文档内容不能为空');
  }

  const config = getLlmConfig();
  const prompt = buildPrompt(documentText.trim(), targetUrl);

  onProgress?.('🧠 正在连接 AI 分析需求文档...');

  let raw: string;
  try {
    // 复用现有的 Rust LLM 通道（plan_task 接口，但用 context 传入 Prompt）
    // 实际上我们把整个 prompt 作为 userIntent 传入，context 留空
    raw = await invoke<string>('plan_task', {
      userIntent: prompt,
      context: '请严格按照 JSON 格式输出，不要输出任何其他内容。',
      config,
    });
  } catch (e) {
    throw new Error(`LLM 调用失败: ${e}`);
  }

  onProgress?.('📋 正在解析 AI 生成的测试步骤...');

  let parsed: any;
  try {
    parsed = extractJson(raw);
  } catch (e) {
    throw new Error(String(e));
  }

  const template = normalizeTemplate(parsed, documentText);

  onProgress?.(null as any);
  return template;
}

// ─── 本地模板存储（localStorage）────────────────────────────────────────────

const STORAGE_KEY = 'logicguard_custom_templates';

export function loadCustomTemplates(): ScenarioTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ScenarioTemplate[];
  } catch {
    return [];
  }
}

export function saveCustomTemplate(template: ScenarioTemplate): ScenarioTemplate[] {
  const existing = loadCustomTemplates();
  // 如果同 id 已存在则替换，否则追加
  const idx = existing.findIndex(t => t.id === template.id);
  if (idx !== -1) {
    existing[idx] = template;
  } else {
    existing.unshift(template); // 新模板放在最前面
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  return existing;
}

export function updateTemplateParameterSets(
  _templateId: string,
  updater: (templates: ScenarioTemplate[]) => ScenarioTemplate[]
): ScenarioTemplate[] {
  const all = loadCustomTemplates();
  const updated = updater(all);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

export function deleteCustomTemplate(templateId: string): ScenarioTemplate[] {
  const existing = loadCustomTemplates().filter(t => t.id !== templateId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  return existing;
}
