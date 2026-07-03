import { invoke } from '@tauri-apps/api/core';
import type { ScenarioTemplate, TestCase, TestCaseType } from '../types';
import { getLlmConfig } from './llmBridge';
import { sanitizeForLlm } from '../utils/privacy';

const TYPE_LABELS: Record<TestCaseType, string> = {
  normal: '正常流程',
  boundary: '边界值',
  empty: '空值/异常值',
  permission: '权限校验',
  repeat: '重复提交',
  combination: '多用户/多部门/多状态组合',
};

function buildPrompt(requirement: string, moduleName: string): string {
  return `你是一名谨慎的人事系统测试工程师。请根据下面需求生成测试用例，必须覆盖正常流程、边界值、空值/异常值、权限校验、重复提交、多用户/多部门/多状态组合。

输出必须是 JSON 数组，不要输出 Markdown。每个元素字段固定如下：
{
  "title": "用例标题",
  "requirementTitle": "需求标题",
  "module": "${moduleName}",
  "type": "normal|boundary|empty|permission|repeat|combination",
  "priority": "P0|P1|P2|P3",
  "riskPoint": "风险点",
  "preconditions": ["前置条件"],
  "testData": {"字段": "测试数据"},
  "steps": [{"order": 1, "action": "操作步骤", "expectedResult": "步骤预期"}],
  "expectedResult": "总体预期结果"
}

要求：
1. 测试数据不要使用真实员工信息，全部使用脱敏或虚构数据。
2. 每个类型至少 1 条，总数控制在 6-10 条。
3. 优先关注人事系统的权限、审批、重复提交、边界日期、薪资/身份证/手机号等敏感字段。

需求内容：
${requirement}`;
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  let text = fenced ? fenced[1].trim() : raw.trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return JSON.parse(text);
}

function fallbackCases(requirement: string, moduleName: string): TestCase[] {
  const now = new Date().toISOString();
  const requirementTitle = requirement.split(/\r?\n/).find(Boolean)?.slice(0, 40) || `${moduleName}需求`;
  const types: TestCaseType[] = ['normal', 'boundary', 'empty', 'permission', 'repeat', 'combination'];
  return types.map((type) => ({
    id: `case_${crypto.randomUUID()}`,
    title: `${TYPE_LABELS[type]}：${requirementTitle}`,
    requirementTitle,
    module: moduleName,
    sourceKind: 'requirement',
    type,
    priority: type === 'normal' || type === 'permission' ? 'P0' : 'P1',
    riskPoint: type === 'permission' ? '越权访问或误操作员工敏感数据' : '流程遗漏导致发版后业务异常',
    preconditions: ['已登录测试环境', '使用脱敏测试账号和测试数据'],
    testData: {
      员工: '员工A',
      部门: '部门_1',
      手机号: '手机号_1',
    },
    steps: [
      { order: 1, action: `进入${moduleName}相关页面`, expectedResult: '页面正常打开且无权限异常' },
      { order: 2, action: `按${TYPE_LABELS[type]}场景填写或查询测试数据`, expectedResult: '系统给出符合预期的业务反馈' },
      { order: 3, action: '提交或保存后检查结果', expectedResult: '数据状态、提示信息和列表结果正确' },
    ],
    expectedResult: '系统行为符合需求，且不会暴露或误处理员工敏感信息。',
    isBoundary: type === 'boundary',
    isRepeat: type === 'repeat' || type === 'combination',
    status: 'draft',
    createdAt: now,
    suiteIds: [],
  }));
}

export async function generateTestCasesFromRequirement(requirement: string, moduleName: string): Promise<TestCase[]> {
  const cleanRequirement = sanitizeForLlm(requirement.trim());
  const prompt = buildPrompt(cleanRequirement, moduleName.trim() || '人事系统');
  try {
    const raw = await invoke<string>('plan_task', {
      userIntent: sanitizeForLlm(prompt),
      context: '',
      config: getLlmConfig(),
    });
    const parsed = extractJson(raw);
    if (!Array.isArray(parsed)) throw new Error('AI 未返回数组');
    const now = new Date().toISOString();
    return parsed.map((item: any) => {
      const type = ['normal', 'boundary', 'empty', 'permission', 'repeat', 'combination'].includes(item.type)
        ? item.type as TestCaseType
        : 'normal';
      return {
        id: `case_${crypto.randomUUID()}`,
        title: String(item.title || `${TYPE_LABELS[type]}测试`),
        requirementTitle: String(item.requirementTitle || item.requirement_title || '未命名需求'),
        module: String(item.module || moduleName || '人事系统'),
        sourceKind: 'requirement',
        type,
        priority: ['P0', 'P1', 'P2', 'P3'].includes(item.priority) ? item.priority : 'P1',
        riskPoint: String(item.riskPoint || item.risk_point || '需求覆盖不足'),
        preconditions: Array.isArray(item.preconditions) ? item.preconditions.map(String) : ['已登录测试环境'],
        testData: typeof item.testData === 'object' && item.testData ? item.testData : {},
        steps: Array.isArray(item.steps) ? item.steps.map((step: any, index: number) => ({
          order: Number(step.order || index + 1),
          action: String(step.action || step.description || ''),
          expectedResult: String(step.expectedResult || step.expected_result || ''),
        })) : [],
        expectedResult: String(item.expectedResult || item.expected_result || ''),
        isBoundary: type === 'boundary',
        isRepeat: type === 'repeat' || type === 'combination',
        status: 'draft',
        createdAt: now,
        suiteIds: [],
      } satisfies TestCase;
    });
  } catch (error) {
    console.warn('[testCaseGenerator] AI 生成失败，使用本地兜底用例', error);
    return fallbackCases(cleanRequirement, moduleName || '人事系统');
  }
}

export async function generateTestCasesFromTemplate(template: ScenarioTemplate): Promise<TestCase[]> {
  const steps = template.steps
    .sort((a, b) => a.order - b.order)
    .map((step) => `${step.order}. [${step.action}] ${step.description}${step.selectorHint ? `，元素提示：${step.selectorHint}` : ''}`)
    .join('\n');
  const variables = template.variables
    .map((variable) => `- ${variable.label} (${variable.name})：${variable.defaultValue || '请按需求生成'}`)
    .join('\n');
  const parameterSets = template.parameterSets?.length
    ? template.parameterSets.map((set) => `- ${set.name}：${JSON.stringify(set.values)}`).join('\n')
    : '暂无参数集，请按模板变量推导测试数据';

  const templateContext = `场景模板：${template.name}
模板类型：${template.category}
业务描述：${template.description}
目标 URL：${template.targetUrl || '未提供'}

流程骨架：
${steps}

输入变量：
${variables || '暂无变量'}

已有参数集：
${parameterSets}

请基于上面的场景模板生成可确认的测试用例，用例需要覆盖正常、边界、空值、权限、重复提交和组合场景。`;

  const cases = await generateTestCasesFromRequirement(templateContext, template.name);
  return cases.map((testCase) => ({
    ...testCase,
    templateId: template.id,
    templateName: template.name,
    sourceKind: 'template' as const,
  }));
}
