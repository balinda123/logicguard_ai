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
import type { BusinessRole } from '../types/workflow';
import { sanitizeForLlm } from '../utils/privacy';

// ─── Prompt 模板 ──────────────────────────────────────────────────────────────

function buildPrompt(documentText: string, targetUrl: string): string {
  return `Preserve business-role handoffs using the role names found in the requirement. Never assume a fixed employee/manager/HRBP taxonomy; other systems may define entirely different actors. Keep boundary combinations in variables/description instead of duplicating steps.

你是一名资深的软件 QA 测试开发工程师。请深度分析下方的需求文档，基于 MetaGPT 的 QA 自动化测试用例规范（Test Case Design Specification），对该需求进行结构化分析、场景建模，并生成一份高质量的自动化测试模板。

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
      "role": "employee",
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

export interface RequirementModel {
  name: string;
  summary: string;
  preconditions: string[];
  roles: { name: string; responsibilities: string[] }[];
  stateTransitions: { from: string; to: string; role: string; trigger: string }[];
  validationRules: { field: string; rule: string; boundaries: string[] }[];
  scenarios: { name: string; type: 'normal' | 'boundary' | 'exception' | 'workflow'; roles: string[] }[];
}

function buildRequirementModelPrompt(documentText: string, targetUrl: string): string {
  return `你是一名资深软件测试分析师。请把需求正文整理成供后续生成测试用例使用的“需求模型”。

本阶段不要生成任何页面点击、输入、选择器、断言或可执行步骤，也不要输出 steps、action、selectorHint 字段。后续系统会结合测试账号和真实页面单独生成操作步骤。

必须保留：
1. 所有业务角色及职责，尤其是员工、上级、HRBP 等角色之间的交接。
2. 状态变化、触发动作和执行角色。
3. 字段必填、长度、保存/提交/退回/终止时机等校验规则。
4. 最小值前一位、最小值、最大值、最大值后一位、空值和纯空白等边界。
5. 正常、边界、异常和多角色流程场景，但只写场景目标，不展开操作步骤。

需求正文：
---
${documentText}
---
目标系统 URL（参考）：${targetUrl || '未知'}

只输出以下 JSON，不要输出 Markdown 或解释：
{
  "name": "需求主题，25字以内",
  "summary": "测试范围和核心业务规则摘要",
  "preconditions": ["业务前置条件"],
  "roles": [
    { "name": "员工", "responsibilities": ["填写并提交目标"] }
  ],
  "stateTransitions": [
    { "from": "草稿", "to": "待上级处理", "role": "员工", "trigger": "正式提交目标" }
  ],
  "validationRules": [
    { "field": "单条目标内容", "rule": "正式提交时去除首尾空白后为10至100字", "boundaries": ["空值", "纯空白", "9字", "10字", "100字", "101字"] }
  ],
  "scenarios": [
    { "name": "员工提交合法目标", "type": "normal", "roles": ["员工"] },
    { "name": "员工提交后由上级处理并流转至HRBP", "type": "workflow", "roles": ["员工", "上级", "HRBP"] }
  ]
}`;
}

function textArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
}

function normalizeRequirementModel(raw: unknown): RequirementModel {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const nested = [source.requirementModel, source.requirement_model, source.model, source.data, source.result]
    .find((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown> | undefined;
  const model = nested ?? source;
  const name = firstText(model, ['name', 'title', '主题', '需求主题']);
  const summary = firstText(model, ['summary', 'description', '摘要', '需求摘要']);
  if (!name || !summary) {
    throw new Error(`AI 返回的需求模型不完整，缺少主题或摘要。已识别字段：${Object.keys(model).slice(0, 12).join('、') || '无'}`);
  }

  const roles = firstArray(model, ['roles', 'actors', '角色']) ?? [];
  const transitions = firstArray(model, ['stateTransitions', 'state_transitions', 'transitions', '状态流转']) ?? [];
  const rules = firstArray(model, ['validationRules', 'validation_rules', 'rules', '校验规则']) ?? [];
  const scenarios = firstArray(model, ['scenarios', 'coverageScenarios', '场景']) ?? [];

  return {
    name,
    summary,
    preconditions: textArray(model.preconditions ?? model['前置条件']),
    roles: roles.map((item) => {
      const role = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      return {
        name: firstText(role, ['name', 'role', '角色']) ?? String(item ?? '').trim(),
        responsibilities: textArray(role.responsibilities ?? role.duties ?? role['职责']),
      };
    }).filter((item) => item.name),
    stateTransitions: transitions.map((item) => {
      const transition = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      return {
        from: firstText(transition, ['from', 'source', '原状态']) ?? '',
        to: firstText(transition, ['to', 'target', '目标状态']) ?? '',
        role: firstText(transition, ['role', 'actor', '角色']) ?? '',
        trigger: firstText(transition, ['trigger', 'action', '触发动作']) ?? '',
      };
    }).filter((item) => item.from || item.to || item.trigger),
    validationRules: rules.map((item) => {
      const rule = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      return {
        field: firstText(rule, ['field', 'name', '字段']) ?? '',
        rule: firstText(rule, ['rule', 'description', '规则']) ?? String(item ?? '').trim(),
        boundaries: textArray(rule.boundaries ?? rule.boundaryValues ?? rule['边界值']),
      };
    }).filter((item) => item.field || item.rule),
    scenarios: scenarios.map((item) => {
      const scenario = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const rawType = firstText(scenario, ['type', '类型']) ?? 'normal';
      const type = ['normal', 'boundary', 'exception', 'workflow'].includes(rawType)
        ? rawType as RequirementModel['scenarios'][number]['type']
        : 'normal';
      return {
        name: firstText(scenario, ['name', 'title', '场景']) ?? String(item ?? '').trim(),
        type,
        roles: textArray(scenario.roles ?? scenario.actors ?? scenario['角色']),
      };
    }).filter((item) => item.name),
  };
}

export async function generateRequirementModelFromDocument(
  documentText: string,
  options: GenerateTemplateOptions = {},
): Promise<RequirementModel> {
  const { onProgress, targetUrl = '' } = options;
  if (!documentText.trim()) throw new Error('需求文档内容不能为空');
  const sanitizedDocument = sanitizeForLlm(documentText.trim());
  onProgress?.('AI 正在整理角色、规则和场景…');
  let raw: string;
  try {
    raw = await invoke<string>('generate_template', {
      prompt: sanitizeForLlm(buildRequirementModelPrompt(sanitizedDocument, targetUrl)),
      config: getLlmConfig(),
    });
  } catch (error) {
    throw new Error(`LLM 调用失败: ${error}`);
  }
  return normalizeRequirementModel(extractJson(raw));
}

// ─── 校验并补全 AI 生成的模板结构 ─────────────────────────────────────────────

function firstText(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function firstArray(source: Record<string, unknown>, keys: string[]): unknown[] | undefined {
  for (const key of keys) {
    if (Array.isArray(source[key])) return source[key] as unknown[];
  }
  return undefined;
}

function normalizeBusinessRole(value: unknown): BusinessRole | undefined {
  const role = String(value ?? '').trim();
  return role ? role.slice(0, 64) : undefined;
}

function resolveTemplatePayload(raw: unknown): Record<string, unknown> {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const candidates = [source, source.template, source.scenarioTemplate, source.scenario_template, source.data, source.result]
    .filter((candidate): candidate is Record<string, unknown> => !!candidate && typeof candidate === 'object' && !Array.isArray(candidate));
  const payload = candidates.find((candidate) =>
    ['name', 'templateName', 'template_name', '模板名称', 'steps', 'testSteps', 'test_steps', '测试步骤'].some((key) => key in candidate),
  ) ?? source;

  return {
    ...payload,
    name: firstText(payload, ['name', 'templateName', 'template_name', '模板名称']),
    description: firstText(payload, ['description', 'templateDescription', 'template_description', '模板说明', '说明']),
    steps: firstArray(payload, ['steps', 'testSteps', 'test_steps', 'scenarioSteps', '测试步骤', '步骤']),
    variables: firstArray(payload, ['variables', 'params', 'parameters', '变量']),
    tags: firstArray(payload, ['tags', 'labels', '标签']),
  };
}

function normalizeTemplate(raw: any, documentText: string): ScenarioTemplate {
  raw = resolveTemplatePayload(raw);
  const detectedKeys = Object.keys(raw).slice(0, 12).join('、') || '无可识别字段';
  if (
    !raw
    || typeof raw !== 'object'
    || !String(raw.name ?? '').trim()
    || !String(raw.description ?? '').trim()
    || !Array.isArray(raw.steps)
    || raw.steps.length === 0
  ) {
    throw new Error(`AI 返回的模板不完整，未保存占位模板。已识别字段：${detectedKeys}`);
  }

  // 确保必填字段存在
  const id = raw.id || `tpl_auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const name = raw.name || '（AI 生成的测试模板）';
  const category = ['login', 'form', 'approval', 'query', 'other'].includes(raw.category)
    ? raw.category
    : 'other';

  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((s: any, idx: number) => ({
        order: s.order ?? idx + 1,
        role: normalizeBusinessRole(s.role ?? s.actorRole ?? s.executorRole),
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
  const sanitizedDocument = sanitizeForLlm(documentText.trim());
  const prompt = buildPrompt(sanitizedDocument, targetUrl);

  onProgress?.('🧠 正在连接 AI 分析需求文档...');

  let raw: string;
  try {
    raw = await invoke<string>('generate_template', {
      prompt: sanitizeForLlm(prompt),
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

  const template = normalizeTemplate(parsed, sanitizedDocument);

  onProgress?.(null as any);
  return template;
}

// ─── 本地模板存储（localStorage）────────────────────────────────────────────

function storageKey(): string {
  return `logicguard_custom_templates_${sessionStorage.getItem('logicguard_user_id') ?? 'anonymous'}`;
}

function isLegacyPlaceholderTemplate(template: ScenarioTemplate): boolean {
  const normalizedName = String(template.name ?? '')
    .trim()
    .toLowerCase()
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, '');

  return normalizedName === '(ai生成的测试模板)';
}

export function loadCustomTemplates(): ScenarioTemplate[] {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const templates = JSON.parse(raw) as ScenarioTemplate[];
    if (!Array.isArray(templates)) return [];
    const filtered = templates.filter((template) => !isLegacyPlaceholderTemplate(template));
    if (filtered.length !== templates.length) {
      localStorage.setItem(storageKey(), JSON.stringify(filtered));
    }
    return filtered;
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
  localStorage.setItem(storageKey(), JSON.stringify(existing));
  return existing;
}

export function updateTemplateParameterSets(
  _templateId: string,
  updater: (templates: ScenarioTemplate[]) => ScenarioTemplate[]
): ScenarioTemplate[] {
  const all = loadCustomTemplates();
  const updated = updater(all);
  localStorage.setItem(storageKey(), JSON.stringify(updated));
  return updated;
}

export function deleteCustomTemplate(templateId: string): ScenarioTemplate[] {
  const existing = loadCustomTemplates().filter(t => t.id !== templateId);
  localStorage.setItem(storageKey(), JSON.stringify(existing));
  return existing;
}
