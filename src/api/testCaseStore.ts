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

/** Read-only source for the Task 9 SQLite migration. */
export function loadLegacyTestCases(): TestCase[] {
  return readList<TestCase>('test_cases');
}

/** @deprecated Legacy UI compatibility only. Delete after Task 9 switches all callers to SQLite. */
export function loadTestCases(): TestCase[] {
  return loadLegacyTestCases();
}

/** @deprecated Legacy UI compatibility only. Delete after Task 9 switches all callers to SQLite. */
export function saveTestCases(cases: TestCase[]): void {
  writeList('test_cases', cases);
}

/** @deprecated Legacy UI compatibility only. Delete after Task 9 switches all callers to SQLite. */
export function upsertTestCase(testCase: TestCase): TestCase[] {
  const cases = loadTestCases();
  const index = cases.findIndex((item) => item.id === testCase.id);
  if (index >= 0) cases[index] = testCase;
  else cases.unshift(testCase);
  saveTestCases(cases);
  return cases;
}

export function isCaseSourceStale(
  testCase: Pick<TestCase, 'requirementVersionId'>,
  currentVersionId?: string,
): boolean {
  return Boolean(currentVersionId && testCase.requirementVersionId !== currentVersionId);
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
