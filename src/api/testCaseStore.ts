import type { RegressionSuite, TestCase } from '../types';

function currentUserId(): string {
  return sessionStorage.getItem('logicguard_user_id') ?? 'anonymous';
}

function key(name: string): string {
  return `logicguard_${name}_${currentUserId()}`;
}

function readList<T>(name: string): T[] {
  try {
    const raw = localStorage.getItem(key(name));
    return raw ? JSON.parse(raw) as T[] : [];
  } catch {
    return [];
  }
}

function writeList<T>(name: string, items: T[]): void {
  localStorage.setItem(key(name), JSON.stringify(items));
}

function isLegacyPlaceholderCase(testCase: TestCase): boolean {
  const knownLegacyCase = !testCase.templateId && (
    testCase.title?.trim() === '正常流程测试'
    || (
      testCase.requirementTitle?.trim().includes('入职登记表问题')
      && testCase.riskPoint?.trim().includes('需求覆盖不足')
      && !testCase.expectedResult?.trim()
    )
  );
  const generatedGenericCase = testCase.expectedResult === '系统行为符合需求。'
    && testCase.riskPoint?.endsWith('覆盖不足')
    && testCase.steps?.some((step) => step.action.includes('场景填写或查询测试数据'))
    && testCase.steps?.some((step) => step.action === '提交或保存后检查结果');
  return knownLegacyCase || generatedGenericCase;
}

export function loadTestCases(): TestCase[] {
  const cases = readList<TestCase>('test_cases');
  const filtered = cases.filter((testCase) => !isLegacyPlaceholderCase(testCase));
  if (filtered.length !== cases.length) writeList('test_cases', filtered);
  return filtered;
}

export function saveTestCases(cases: TestCase[]): void {
  writeList('test_cases', cases.filter((testCase) => !isLegacyPlaceholderCase(testCase)));
}

export function upsertTestCase(testCase: TestCase): TestCase[] {
  const cases = loadTestCases();
  const index = cases.findIndex((item) => item.id === testCase.id);
  if (index >= 0) cases[index] = testCase;
  else cases.unshift(testCase);
  saveTestCases(cases);
  return cases;
}

export function loadSuites(): RegressionSuite[] {
  return readList<RegressionSuite>('regression_suites');
}

export function saveSuites(suites: RegressionSuite[]): void {
  writeList('regression_suites', suites);
}

export function upsertSuite(suite: RegressionSuite): RegressionSuite[] {
  const suites = loadSuites();
  const index = suites.findIndex((item) => item.id === suite.id);
  if (index >= 0) suites[index] = suite;
  else suites.unshift(suite);
  saveSuites(suites);
  return suites;
}

export function createDefaultSuite(moduleName = '人事核心流程'): RegressionSuite {
  return {
    id: `suite_${crypto.randomUUID()}`,
    name: `${moduleName}回归套件`,
    description: '用于发版前重复验证高频人事流程。',
    module: moduleName,
    caseIds: [],
    createdAt: new Date().toISOString(),
  };
}
