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

export type TestCaseGenerationPhase = 'requesting' | 'parsing';

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

function configuredAccountForStep(step: any, accounts: readonly TestAccount[]): TestAccount | undefined {
  const accountId = pickString(step, ['accountId', 'account_id', '执行账号ID']);
  if (accountId) return accounts.find((account) => account.enabled && account.id === accountId);
  const actor = pickString(step, ['actorName', 'actor', 'role', 'actorRole', 'executorRole', '执行角色']);
  if (!actor) return undefined;
  const normalizedActor = actor.trim().toLocaleLowerCase();
  const matches = accounts.filter((account) => account.enabled && [account.displayName, account.roleName, account.role]
    .filter(Boolean)
    .some((label) => normalizedActor.includes(String(label).trim().toLocaleLowerCase())));
  return matches.length === 1 ? matches[0] : undefined;
}

function genericTitle(type: TestCaseType, requirementTitle: string): string {
  return `${TYPE_LABELS[type]}：${requirementTitle}`;
}

function buildPrompt(requirement: string, moduleName: string, flowAccounts: TestAccount[] = []): string {
  const enabledAccounts = flowAccounts.filter((account) => account.enabled);
  const workflowContext = enabledAccounts.length
    ? `\n\nWorkflow account context (metadata only; credentials are intentionally omitted):\n${enabledAccounts
        .map((account) => `- roleName=${account.roleName || account.role}; displayName=${account.displayName}; accountId=${account.id}; loginMode=${account.loginMode}`)
        .join('\n')}\n\nEvery executable step must use one accountId from this list and copy its roleName into actorName. Decide which configured actor should perform each business action from the requirement. Do not create login steps: the executor assesses the page and logs in before the first business step or when accountId changes. Never invent roles, accounts or credentials.`
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
  "steps": [{"order": 1, "accountId": "配置中的账号ID", "actorName": "配置中的角色名称", "action": "业务操作步骤（不要写登录）", "expectedResult": "步骤预期", "assertions": [{"type": "text_contains|text_absent|url_contains", "expected": "页面上可直接校验的短文本或 URL 片段"}]}],
  "expectedResult": "总体预期结果"
  }]
}

要求：
1. 测试数据不要使用真实员工信息，全部使用脱敏或虚构数据。
2. 每个类型至少 1 条，总数控制在 6-10 条。
3. 优先关注人事系统的权限、审批、重复提交、边界日期、薪资/身份证/手机号等敏感字段。
4. testData 必须提供执行时可直接填写的具体业务值，步骤必须明确使用哪个数据；禁止输出 {{变量}}、\${变量}、TBD、待填写、字段名本身或“数据1”一类占位符。
5. 目标内容、预期结果、评价意见、退回/终止说明等长文本必须是连贯、合理的虚构业务句子。例如目标可描述具体交付物，预期结果应包含可验收成果；禁止重复单字、连续数字、乱码或复制字段名凑长度。
6. 边界测试数据要精确满足需求中的字符数，但仍保持业务语义；只有明确测试纯空白或特殊字符时才能使用异常文本。日期、比例、金额、权重等数值必须符合场景规则，多个目标的权重按页面规则合计。
7. 多角色流程必须严格按需求中的状态流转排序。某角色提交后若状态进入另一角色待办，下一步必须切换到该角色完成必要处理；流程之后回到原角色时，要再次写出该角色步骤，不能把目标填写、自评、上级评价等不同阶段连续压在同一个角色步骤中。
8. 每个步骤只描述当前角色在当前业务状态下可完成的一项操作。即使是为了衔接后续校验，也要补齐“上级确认目标”等必要过渡步骤；不要假设执行器会自行猜测缺失的业务动作。
9. 边界用例应在同一可编辑阶段依次覆盖最小值前一位、最小值、最大值和最大值后一位：非法值验证拦截后继续修正，合法值可保存草稿验证；只有所有本阶段检查完成后才正式提交一次。页面支持多行时可在同一次提交中放入不同合法边界行，但权重等合计必须合法。不要为了每个边界值反复正式提交不可逆流程。
10. 除非需求或前置条件明确说明存在可重置夹具或独立测试记录，禁止虚构 HIS-T01、T-N01、“两条独立记录”等页面中并不存在的数据。互相冲突的终态操作要拆成不同用例，并明确各自需要全新或可重置的流程实例。
11. assertions 只填写能够从页面 DOM 或 URL 直接判断的证据，例如明确的成功提示、校验文案、状态文字或 URL 片段；抽象业务描述不能伪装成断言。没有可靠证据时返回空数组。禁止用“操作成功”“符合预期”这类泛化文字充当断言。

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
      // 部分兼容网关会在 JSON 后追加解释文字，因此完整解析失败后再提取第一个闭合的 JSON 值。
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

export function fallbackCases(requirement: string, moduleName: string, flowAccounts: TestAccount[] = []): TestCase[] {
  void flowAccounts;
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
      员工: '测试员工陈晓宁',
      部门: '产品研发测试部',
      手机号: '13800001234',
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
  onProgress?: (phase: TestCaseGenerationPhase) => void,
): Promise<TestCase[]> {
  // 这是前端进入模型调用链前的第一道数据边界：先脱敏原始需求，再构造提示词；
  // 账号只传非敏感元数据，真实凭据始终由 Rust 从系统凭据库读取。
  const cleanRequirement = sanitizeForLlm(requirement.trim());
  const prompt = buildPrompt(cleanRequirement, moduleName.trim() || '人事系统', flowAccounts);
  try {
    onProgress?.('requesting');
    // invoke 不是 HTTP 请求，而是调用 lib.rs 中注册的同名 Tauri 命令；返回值仍是不可信的模型文本，
    // 必须经过 extractJson 和后续字段归一化后，才能进入应用的 TestCase 数据结构。
    const raw = await invoke<string>('generate_test_cases', {
      prompt: sanitizeForLlm(prompt),
      config: getLlmConfig(),
    });
    onProgress?.('parsing');
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
      const steps = rawSteps.map((step: any, index: number) => {
        const account = configuredAccountForStep(step, flowAccounts);
        const actorName = account?.roleName || pickString(step, ['actorName', 'actor', 'role', 'actorRole', 'executorRole', '执行角色']) || undefined;
        const assertions = pickArray(step, ['assertions', 'checks', '断言', '页面断言'])
          .map((assertion: any) => {
            const assertionType = pickString(assertion, ['type', 'kind', '类型']);
            const expected = pickString(assertion, ['expected', 'value', 'text', '预期']);
            if (!['text_contains', 'text_absent', 'url_contains'].includes(assertionType) || !expected) return undefined;
            return { type: assertionType as 'text_contains' | 'text_absent' | 'url_contains', expected: expected.slice(0, 500) };
          })
          .filter((assertion): assertion is NonNullable<typeof assertion> => Boolean(assertion))
          .slice(0, 8);
        return ({
        order: Number(step.order || step.step || step['序号'] || index + 1),
        accountId: account?.id,
        actorName,
        role: (account?.role || actorName) as BusinessRole | undefined,
        action: pickString(step, ['action', 'description', 'step', '操作步骤', '步骤描述', '操作'], `按${TYPE_LABELS[type]}场景执行第 ${index + 1} 步`),
        expectedResult: pickString(step, ['expectedResult', 'expected_result', 'expected', '预期结果', '步骤预期'], '系统反馈符合预期'),
        assertions,
      });
      });
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
