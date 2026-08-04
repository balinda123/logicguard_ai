import { invoke } from '@tauri-apps/api/core';
import type { ScenarioTemplate, TestCase, TestCaseType } from '../types';
import type { BusinessRole, TestAccount } from '../types/workflow';
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

const TYPE_ORDER: TestCaseType[] = ['normal', 'boundary', 'empty', 'permission', 'repeat', 'combination'];

function pickString(item: any, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return fallback;
}

function pickArray(item: any, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = item?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function pickObject(item: any, keys: string[]): Record<string, string> {
  for (const key of keys) {
    const value = item?.[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return {};
}

function normalizeType(value: unknown, title: string, index: number): TestCaseType {
  const raw = String(value ?? '').toLowerCase();
  const probe = `${raw} ${title}`.toLowerCase();
  if (/\bnormal\b|正常|主流程|happy/.test(probe)) return 'normal';
  if (/\bboundary\b|边界|上限|下限|最大|最小|长度/.test(probe)) return 'boundary';
  if (/\bempty\b|空值|为空|异常|非法|必填/.test(probe)) return 'empty';
  if (/\bpermission\b|权限|越权|角色|无权/.test(probe)) return 'permission';
  if (/\brepeat\b|重复|二次提交|重复提交|幂等/.test(probe)) return 'repeat';
  if (/\bcombination\b|组合|多用户|多部门|多状态|状态流转/.test(probe)) return 'combination';
  return TYPE_ORDER[index % TYPE_ORDER.length];
}

function normalizeBusinessRole(value: unknown): BusinessRole | undefined {
  const role = String(value ?? '').trim().toLowerCase();
  if (role === 'employee' || role === 'manager' || role === 'hrbp') return role;
  if (/员工|employee/.test(role)) return 'employee';
  if (/上级|主管|经理|manager/.test(role)) return 'manager';
  if (/hrbp|人力资源/.test(role)) return 'hrbp';
  return undefined;
}

function genericTitle(type: TestCaseType, requirementTitle: string): string {
  return `${TYPE_LABELS[type]}：${requirementTitle}`;
}

function buildPrompt(requirement: string, moduleName: string, flowAccounts: TestAccount[] = []): string {
  const enabledAccounts = flowAccounts.filter((account) => account.enabled);
  const workflowContext = enabledAccounts.length
    ? `\n\nWorkflow account context (metadata only; credentials are intentionally omitted):\n${enabledAccounts
        .map((account) => `- ${account.role}: ${account.displayName} (accountId: ${account.id}, loginMode: ${account.loginMode})`)
        .join('\n')}\n\nFor every case that needs a configured role, include the exact displayName in the step action. For cross-role processes, create a P0 combination case with explicit login switches in sequence, such as [employee] login -> submit -> [manager] login -> approve. Never invent credentials or include them in output.`
    : '';
  return `你是一名谨慎的人事系统测试工程师。请根据下面需求生成测试用例，必须覆盖正常流程、边界值、空值/异常值、权限校验、重复提交、多用户/多部门/多状态组合。

输出必须是一个 JSON 对象，不要输出 Markdown。对象中只允许包含 testCases 数组，总数必须为 6-10 条，每个数组元素字段固定如下：
{
  "testCases": [{
  "title": "用例标题",
  "requirementTitle": "需求标题",
  "module": "${moduleName}",
  "type": "normal|boundary|empty|permission|repeat|combination",
  "priority": "P0|P1|P2|P3",
  "riskPoint": "风险点",
  "preconditions": ["前置条件"],
  "testData": {"字段": "测试数据"},
  "steps": [{"order": 1, "role": "employee|manager|hrbp", "action": "操作步骤", "expectedResult": "步骤预期"}],
  "expectedResult": "总体预期结果"
  }]
}

要求：
1. 测试数据不要使用真实员工信息，全部使用脱敏或虚构数据。
2. 每个类型至少 1 条，总数控制在 6-10 条。
3. 优先关注人事系统的权限、审批、重复提交、边界日期、薪资/身份证/手机号等敏感字段。

需求内容：
${requirement}${workflowContext}`;
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced ? fenced[1].trim() : raw.trim();

  const parseFirstValue = (): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      // Some compatible gateways append explanatory text after the JSON value.
    }

    for (let start = 0; start < text.length; start += 1) {
      if (text[start] !== '[' && text[start] !== '{') continue;

      const stack: string[] = [];
      let inString = false;
      let escaped = false;
      for (let end = start; end < text.length; end += 1) {
        const char = text[end];
        if (inString) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') inString = false;
          continue;
        }
        if (char === '"') inString = true;
        else if (char === '[' || char === '{') stack.push(char);
        else if (char === ']' || char === '}') {
          const expected = char === ']' ? '[' : '{';
          if (stack.pop() !== expected) break;
        }

        if (stack.length === 0) {
          try {
            return JSON.parse(text.slice(start, end + 1));
          } catch {
            break;
          }
        }
      }
    }
    throw new Error('AI 返回内容中找不到有效的 JSON');
  };

  const isCaseObject = (value: unknown): value is Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const hasTitle = ['title', 'caseTitle', 'name', '用例标题', '标题'].some((key) => (
      typeof record[key] === 'string' && String(record[key]).trim().length > 0
    ));
    const hasSteps = ['steps', 'testSteps', '测试步骤', '步骤'].some((key) => Array.isArray(record[key]));
    return hasTitle && hasSteps;
  };

  const collectCases = (value: unknown, depth = 0): Record<string, unknown>[] => {
    if (depth > 8) return [];
    if (isCaseObject(value)) return [value];
    if (Array.isArray(value)) return value.flatMap((item) => collectCases(item, depth + 1));
    if (typeof value === 'string') {
      const nested = value.trim();
      if (!nested.startsWith('{') && !nested.startsWith('[')) return [];
      try {
        return collectCases(JSON.parse(nested), depth + 1);
      } catch {
        return [];
      }
    }
    if (!value || typeof value !== 'object') return [];

    const record = value as Record<string, unknown>;
    const preferredKeys = ['cases', 'testCases', 'test_cases', 'items', 'data', 'content', '测试用例', '用例'];
    for (const key of preferredKeys) {
      const preferred = collectCases(record[key], depth + 1);
      if (preferred.length) return preferred;
    }
    return Object.values(record).flatMap((nested) => collectCases(nested, depth + 1));
  };

  const cases = collectCases(parseFirstValue());
  if (cases.length) return cases;
  throw new Error('AI 返回 JSON 中找不到测试用例数组');
}

export function fallbackCases(requirement: string, moduleName: string, _flowAccounts: TestAccount[] = []): TestCase[] {
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

export async function generateTestCasesFromRequirement(
  requirement: string,
  moduleName: string,
  flowAccounts: TestAccount[] = [],
): Promise<TestCase[]> {
  const cleanRequirement = sanitizeForLlm(requirement.trim());
  const prompt = buildPrompt(cleanRequirement, moduleName.trim() || '人事系统', flowAccounts);
  try {
    const raw = await invoke<string>('generate_test_cases', {
      prompt: sanitizeForLlm(prompt),
      config: getLlmConfig(),
    });
    const parsed = extractJson(raw);
    if (!Array.isArray(parsed)) throw new Error('AI 未返回数组');
    const now = new Date().toISOString();
    return parsed.map((item: any, itemIndex) => {
      const rawTitle = pickString(item, ['title', 'caseTitle', 'name', '用例标题', '标题']);
      const requirementTitle = pickString(
        item,
        ['requirementTitle', 'requirement_title', 'requirement', '需求标题', '需求'],
        cleanRequirement.split(/\r?\n/).find(Boolean)?.slice(0, 40) || '未命名需求',
      );
      const type = normalizeType(
        item.type ?? item.caseType ?? item.testType ?? item['用例类型'] ?? item['类型'],
        rawTitle,
        itemIndex,
      );
      const preconditions = pickArray(item, ['preconditions', 'pre_conditions', '前置条件']);
      const rawSteps = pickArray(item, ['steps', 'testSteps', '测试步骤', '步骤']);
      const steps = rawSteps.map((step: any, index: number) => ({
        order: Number(step.order || step.step || step['序号'] || index + 1),
        role: normalizeBusinessRole(step.role ?? step.actorRole ?? step.executorRole ?? step['执行角色']),
        action: pickString(step, ['action', 'description', 'step', '操作步骤', '步骤描述', '操作'], `按${TYPE_LABELS[type]}场景执行第 ${index + 1} 步`),
        expectedResult: pickString(step, ['expectedResult', 'expected_result', 'expected', '预期结果', '步骤预期'], '系统反馈符合预期'),
      }));
      return {
        id: `case_${crypto.randomUUID()}`,
        title: rawTitle && rawTitle !== '正常流程测试' ? rawTitle : genericTitle(type, requirementTitle),
        requirementTitle,
        module: pickString(item, ['module', '模块'], moduleName || '人事系统'),
        sourceKind: 'requirement',
        type,
        priority: ['P0', 'P1', 'P2', 'P3'].includes(item.priority) ? item.priority : (type === 'normal' || type === 'permission' ? 'P0' : 'P1'),
        riskPoint: pickString(item, ['riskPoint', 'risk_point', 'risk', '风险点'], `${TYPE_LABELS[type]}覆盖不足`),
        preconditions: preconditions.length ? preconditions.map(String) : ['已登录测试环境'],
        testData: pickObject(item, ['testData', 'test_data', '测试数据']),
        steps: steps.length ? steps : [
          { order: 1, action: `进入${moduleName || '人事系统'}相关页面`, expectedResult: '页面正常打开且无权限异常' },
          { order: 2, action: `按${TYPE_LABELS[type]}场景填写或查询测试数据`, expectedResult: '系统给出符合预期的业务反馈' },
          { order: 3, action: '提交或保存后检查结果', expectedResult: '数据状态、提示信息和列表结果正确' },
        ],
        expectedResult: pickString(item, ['expectedResult', 'expected_result', 'expected', '预期结果'], '系统行为符合需求。'),
        isBoundary: type === 'boundary',
        isRepeat: type === 'repeat' || type === 'combination',
        status: 'draft',
        createdAt: now,
        suiteIds: [],
      } satisfies TestCase;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`AI 生成失败，未创建任何测试用例：${message}`);
  }
}

export async function generateTestCasesFromTemplate(
  template: ScenarioTemplate,
  flowAccounts: TestAccount[] = [],
): Promise<TestCase[]> {
  const steps = template.steps
    .sort((a, b) => a.order - b.order)
    .map((step) => `${step.order}. [${step.role ?? 'employee'}] [${step.action}] ${step.description}${step.selectorHint ? `，元素提示：${step.selectorHint}` : ''}`)
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

  const cases = await generateTestCasesFromRequirement(templateContext, template.name, flowAccounts);
  return cases.map((testCase) => ({
    ...testCase,
    templateId: template.id,
    templateName: template.name,
    sourceKind: 'template' as const,
  }));
}
