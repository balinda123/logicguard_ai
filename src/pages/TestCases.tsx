import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileText,
  Layers3,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { HealerLog, RegressionSuite, ScenarioTemplate, TestCase, TestResult, TestStep } from '../types';
import { generateTestCasesFromRequirement, generateTestCasesFromTemplate } from '../api/testCaseGenerator';
import {
  createDefaultSuite,
  loadSuites,
  loadTestCases,
  saveTestCases,
  upsertSuite,
  upsertTestCase,
} from '../api/testCaseStore';
import { defaultTemplates } from '../templates/defaultTemplates';
import { loadCustomTemplates } from '../api/templateGenerator';
import { generateTestScript } from '../agents/scriptGenerator';
import { executeTestScript } from '../agents/scriptExecutor';
import { maskSensitiveText, securityModeLabel, getDataSecurityConfig } from '../utils/privacy';
import { RequirementModeler } from './RequirementModeler';
import { clampTestDesignStep, highestUnlockedTestDesignStep, type TestDesignStep } from './testDesignWizard';
import { ScenarioConversionDialog } from '../components/ScenarioConversionDialog';
import { listWorkflowScenarios } from '../api/testingBridge';

const TYPE_LABEL: Record<TestCase['type'], string> = {
  normal: '正常流程',
  boundary: '边界值',
  empty: '空值/异常',
  permission: '权限',
  repeat: '重复提交',
  combination: '组合测试',
};

const STATUS_LABEL: Record<TestCase['status'], string> = {
  draft: '待确认',
  confirmed: '已确认',
  archived: '已归档',
};

function scopedStorageKey(base: string): string {
  return `${base}_${sessionStorage.getItem('logicguard_user_id') ?? 'anonymous'}`;
}

function buildCaseIntent(testCase: TestCase, template?: ScenarioTemplate | null): string {
  const data = Object.entries(testCase.testData)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n') || '无特殊测试数据';
  const templateSteps = template
    ? template.steps
        .sort((a, b) => a.order - b.order)
        .map((step) => `${step.order}. [${step.action}] ${step.description}${step.selectorHint ? `；元素提示：${step.selectorHint}` : ''}`)
        .join('\n')
    : '';
  const steps = testCase.steps
    .sort((a, b) => a.order - b.order)
    .map((step) => `${step.order}. ${step.action}；预期：${step.expectedResult}`)
    .join('\n');

  return maskSensitiveText(`执行测试用例：${testCase.title}
模块：${testCase.module}
${template ? `关联场景模板：${template.name}
请优先按下面的模板流程骨架执行，再用测试用例的数据和预期结果校验。
模板流程骨架：
${templateSteps}
` : ''}
前置条件：${testCase.preconditions.join('；')}
测试数据：
${data}
测试步骤：
${steps}
总体预期：${testCase.expectedResult}
请按步骤在当前浏览器页面完成操作，并以断言校验关键预期。`);
}

async function appendReport(report: TestResult): Promise<void> {
  let existingReports: TestResult[] = [];
  try {
    const raw = await invoke<string>('load_reports_from_file');
    if (raw) existingReports = JSON.parse(raw);
  } catch {
    const raw = localStorage.getItem(scopedStorageKey('logicguard_test_results'));
    if (raw) existingReports = JSON.parse(raw);
  }

  const updated = [report, ...existingReports];
  try {
    await invoke('save_reports_to_file', { data: JSON.stringify(updated) });
  } catch {
    localStorage.setItem(scopedStorageKey('logicguard_test_results'), JSON.stringify(updated));
  }
}

function buildDepartmentReport(
  testCase: TestCase,
  suite: RegressionSuite | null,
  template: ScenarioTemplate | null,
  success: boolean,
  logs: string[],
  stepsTotal: number,
  stepsSuccess: number,
  duration: number,
): TestResult {
  const riskLevel = success ? 'low' : testCase.priority === 'P0' ? 'high' : 'medium';
  const releaseAdvice = success ? 'can_release' : testCase.priority === 'P0' ? 'block_release' : 'review_required';
  const summary = success
    ? `本次用例通过。${testCase.module} 的 ${TYPE_LABEL[testCase.type]} 场景未发现阻断问题。`
    : `本次用例失败。建议开发优先排查「${testCase.riskPoint}」，产品复核需求预期。`;

  return {
    id: `res_${crypto.randomUUID()}`,
    testName: testCase.title,
    testStatus: success ? 'success' : 'failed',
    task: buildCaseIntent(testCase, template),
    createdAt: new Date(Date.now() - duration).toISOString(),
    completedAt: new Date().toISOString(),
    stepsTotal,
    stepsSuccess,
    duration: Math.round(duration / 1000),
    suiteId: suite?.id,
    suiteName: suite?.name,
    caseId: testCase.id,
    caseName: testCase.title,
    managementSummary: summary,
    riskLevel,
    releaseAdvice,
    reportMarkdown: maskSensitiveText(`### 管理摘要

- **测试用例**：${testCase.title}
- **所属模块**：${testCase.module}
- **用例类型**：${TYPE_LABEL[testCase.type]}
- **执行结论**：${success ? '通过' : '失败'}
- **风险等级**：${riskLevel === 'high' ? '高' : riskLevel === 'medium' ? '中' : '低'}
- **发版建议**：${releaseAdvice === 'can_release' ? '可继续发版' : releaseAdvice === 'block_release' ? '阻断发版，需修复后复测' : '需人工复核后决定'}
- **摘要**：${summary}

### 失败排查建议

${success ? '- 暂无失败项。' : `- 失败步骤见下方日志。\n- 复现路径：登录测试环境 → 进入 ${testCase.module} → 按用例步骤执行。\n- 可能原因：${testCase.riskPoint}。`}

### 技术详情

- **前置条件**：${testCase.preconditions.join('；')}
- **测试数据**：${JSON.stringify(testCase.testData)}
- **步骤统计**：${stepsSuccess}/${stepsTotal}

### 执行日志

${logs.map((line) => `- ${line}`).join('\n') || '- 无日志'}`),
  };
}

/**
 * Read-only migration compatibility surface. The product route now uses TestDesignPage,
 * which persists every stage by designId. Keep this loader until migration telemetry is reconciled.
 */
export const TestCases: React.FC = () => {
  const [requirement, setRequirement] = useState('');
  const [moduleName, setModuleName] = useState('人事核心流程');
  const [cases, setCases] = useState<TestCase[]>([]);
  const [suites, setSuites] = useState<RegressionSuite[]>([]);
  const [templates, setTemplates] = useState<ScenarioTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedSuiteId, setSelectedSuiteId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runLog, setRunLog] = useState<string[]>([]);
  const [step, setStep] = useState<TestDesignStep>(1);
  const [showModeler, setShowModeler] = useState(false);
  const [requirementRevision, setRequirementRevision] = useState(0);
  const [generatedRevision, setGeneratedRevision] = useState<number | null>(null);
  const [reviewReached, setReviewReached] = useState(false);
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const [convertedCaseIds, setConvertedCaseIds] = useState<Set<string>>(() => new Set());
  const [conversionCase, setConversionCase] = useState<TestCase | null>(null);
  const requirementRevisionRef = useRef(0);

  useEffect(() => {
    const loadedCases = loadTestCases();
    setCases(loadedCases);
    if (loadedCases.length > 0) setGeneratedRevision(0);
    const loadedSuites = loadSuites();
    setSuites(loadedSuites);
    setSelectedSuiteId(loadedSuites[0]?.id ?? '');
    const loadedCustomTemplates = loadCustomTemplates();
    const mergedTemplates = [
      ...loadedCustomTemplates,
      ...defaultTemplates.filter(
        (template) => !loadedCustomTemplates.some((custom) => custom.id === template.id),
      ),
    ];
    setTemplates(mergedTemplates);
    void listWorkflowScenarios()
      .then((scenarios) => setConvertedCaseIds(new Set(scenarios.map((scenario) => scenario.sourceTestCaseId).filter(Boolean))))
      .catch(() => setConvertedCaseIds(new Set()));
  }, []);

  const selectedSuite = useMemo(
    () => suites.find((suite) => suite.id === selectedSuiteId) ?? null,
    [selectedSuiteId, suites],
  );
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );

  const confirmedCases = cases.filter((item) => item.status === 'confirmed');
  const draftCases = cases.filter((item) => item.status === 'draft');
  const generationIsCurrent = generatedRevision !== null && generatedRevision === requirementRevision;
  const hasPersistedSource = generationIsCurrent && cases.length > 0;
  const hasSource = Boolean(requirement.trim() || selectedTemplate || hasPersistedSource);
  const highestUnlockedStep = highestUnlockedTestDesignStep({
    hasRequirement: hasSource,
    hasCases: generationIsCurrent && cases.length > 0,
    hasConfirmedCases: generationIsCurrent && reviewReached && confirmedCases.length > 0,
  });
  const isStale = generatedRevision !== null && generatedRevision !== requirementRevision;

  const mergeTemplates = (customTemplates: ScenarioTemplate[]) => [
    ...customTemplates,
    ...defaultTemplates.filter(
      (template) => !customTemplates.some((custom) => custom.id === template.id),
    ),
  ];

  const requestStep = (requested: TestDesignStep) => {
    if (generating) return;
    const nextStep = clampTestDesignStep(requested, highestUnlockedStep);
    if (nextStep === 3) setReviewReached(true);
    setStep(nextStep);
  };

  const markRequirementChanged = () => {
    requirementRevisionRef.current += 1;
    setRequirementRevision(requirementRevisionRef.current);
    setReviewReached(false);
    setGenerationNotice(null);
  };

  const handleTemplateSaved = (savedTemplate: ScenarioTemplate) => {
    const loadedCustomTemplates = loadCustomTemplates();
    const customTemplates = loadedCustomTemplates.some((template) => template.id === savedTemplate.id)
      ? loadedCustomTemplates
      : [savedTemplate, ...loadedCustomTemplates];
    setTemplates(mergeTemplates(customTemplates));
    setSelectedTemplateId(savedTemplate.id);
    markRequirementChanged();
    setShowModeler(false);
    setStep(2);
  };

  const refreshCases = (next: TestCase[]) => {
    saveTestCases(next);
    setCases(next);
  };

  const caseKey = (testCase: TestCase) => [
    testCase.templateId || 'no-template',
    testCase.module.trim(),
    testCase.requirementTitle.trim(),
    testCase.type,
    testCase.title.trim(),
  ].join('|').toLowerCase();

  const mergeUniqueCases = (generated: TestCase[], existing: TestCase[]) => {
    const seen = new Set(existing.map(caseKey));
    const uniqueGenerated = generated.filter((testCase) => {
      const key = caseKey(testCase);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      uniqueGenerated,
      nextCases: [...uniqueGenerated, ...existing],
    };
  };

  const handleGenerate = async () => {
    if (!requirement.trim()) {
      window.alert('请先输入需求或场景描述');
      return;
    }
    const sourceRevision = requirementRevisionRef.current;
    setGenerating(true);
    setGenerationNotice(null);
    try {
      const generated = await generateTestCasesFromRequirement(requirement, moduleName);
      if (sourceRevision !== requirementRevisionRef.current) return;
      if (generated.length === 0) {
        setGenerationNotice('未生成任何测试用例，请检查需求后重试');
        return;
      }
      const { uniqueGenerated, nextCases } = mergeUniqueCases(generated, cases);
      refreshCases(nextCases);
      setGeneratedRevision(sourceRevision);
      setReviewReached(true);
      setStep(3);
      if (uniqueGenerated.length < generated.length) {
        window.alert(`已跳过 ${generated.length - uniqueGenerated.length} 条重复用例`);
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateFromTemplate = async () => {
    if (!selectedTemplate) {
      window.alert('请先选择一个场景模板');
      return;
    }
    const sourceRevision = requirementRevisionRef.current;
    const sourceTemplateId = selectedTemplate.id;
    setGenerating(true);
    setGenerationNotice(null);
    try {
      const generated = await generateTestCasesFromTemplate(selectedTemplate);
      if (
        sourceRevision !== requirementRevisionRef.current
        || sourceTemplateId !== selectedTemplateId
      ) return;
      if (generated.length === 0) {
        setGenerationNotice('未生成任何测试用例，请检查模板后重试');
        return;
      }
      const { uniqueGenerated, nextCases } = mergeUniqueCases(generated, cases);
      refreshCases(nextCases);
      setGeneratedRevision(sourceRevision);
      setReviewReached(true);
      setStep(3);
      if (uniqueGenerated.length < generated.length) {
        window.alert(`已跳过 ${generated.length - uniqueGenerated.length} 条重复用例`);
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleConfirm = (testCase: TestCase) => {
    const updated = {
      ...testCase,
      status: 'confirmed' as const,
      confirmedAt: new Date().toISOString(),
    };
    setCases(upsertTestCase(updated));
  };

  const handleScenarioSaved = (scenarioId: string) => {
    setConvertedCaseIds((current) => new Set(current).add(scenarioId));
    setConversionCase(null);
  };

  const handleCreateSuite = () => {
    const suite = createDefaultSuite(moduleName || '人事核心流程');
    const next = upsertSuite(suite);
    setSuites(next);
    setSelectedSuiteId(suite.id);
  };

  const handleAddToSuite = (testCase: TestCase) => {
    const suite = selectedSuite ?? createDefaultSuite(testCase.module);
    const suiteIds = Array.from(new Set([...testCase.suiteIds, suite.id]));
    const caseIds = Array.from(new Set([...suite.caseIds, testCase.id]));
    const nextSuites = upsertSuite({ ...suite, caseIds });
    setSuites(nextSuites);
    setSelectedSuiteId(suite.id);
    setCases(upsertTestCase({ ...testCase, suiteIds }));
  };

  const runCase = async (testCase: TestCase, suite: RegressionSuite | null = null): Promise<boolean> => {
    if (testCase.status !== 'confirmed') {
      window.alert('用例需要先人工确认，确认后才能执行。');
      return false;
    }
    setRunningId(testCase.id);
    const logs: string[] = [];
    // Event-handler timing is intentionally sampled at execution start.
    // eslint-disable-next-line react-hooks/purity
    const startedAt = Date.now();
    let latestSteps: TestStep[] = [];
    let success = false;

    const pushLog = (line: string) => {
      logs.push(maskSensitiveText(line));
      setRunLog([...logs]);
    };
    const linkedTemplate = testCase.templateId
      ? templates.find((template) => template.id === testCase.templateId) ?? null
      : null;

    try {
      pushLog('正在生成确定性回归脚本...');
      const script = await generateTestScript(buildCaseIntent(testCase, linkedTemplate), {
        onProgress: pushLog,
      });

      pushLog(`开始回放脚本：${script.title}`);
      await executeTestScript(script, {
        onStepUpdate: (step) => {
          latestSteps = [...latestSteps.filter((item) => item.stepId !== step.stepId), step];
        },
        onHealerLog: (log: HealerLog) => pushLog(log.message),
        onComplete: () => pushLog('脚本执行结束，正在生成部门可读报告...'),
      });
      success = latestSteps.length > 0 && latestSteps.every((step) => step.status === 'success');
      if (!success) pushLog('存在失败或未执行步骤，本次用例判定为失败。');
    } catch (error) {
      success = false;
      pushLog(`执行异常：${String(error)}`);
    }

    // Event-handler timing is intentionally sampled at execution completion.
    // eslint-disable-next-line react-hooks/purity
    const duration = Date.now() - startedAt;
    const stepsTotal = latestSteps.length || testCase.steps.length;
    const stepsSuccess = latestSteps.filter((step) => step.status === 'success').length;
    const report = buildDepartmentReport(testCase, suite, linkedTemplate, success, logs, stepsTotal, stepsSuccess, duration);
    await appendReport(report);

    const updatedCase = {
      ...testCase,
      lastRunStatus: success ? 'success' as const : 'failed' as const,
      lastRunAt: new Date().toISOString(),
    };
    setCases(upsertTestCase(updatedCase));
    setRunningId(null);
    return success;
  };

  const runSuite = async (suite: RegressionSuite) => {
    const suiteCases = cases.filter((item) => suite.caseIds.includes(item.id) && item.status === 'confirmed');
    if (suiteCases.length === 0) {
      window.alert('当前套件还没有已确认用例。');
      return;
    }
    let passed = 0;
    for (const testCase of suiteCases) {
      const ok = await runCase(testCase, suite);
      if (ok) passed += 1;
    }
    const updatedSuite = {
      ...suite,
      lastRunAt: new Date().toISOString(),
      lastPassRate: Math.round((passed / suiteCases.length) * 100),
    };
    setSuites(upsertSuite(updatedSuite));
  };

  const renderCaseDetails = (testCase: TestCase, executionActions: boolean) => (
    <article key={testCase.id} className="rounded-xl border border-border bg-surface-2/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-brand-500/20 bg-brand-500/10 px-2 py-0.5 text-[10px] text-brand-400">{TYPE_LABEL[testCase.type]}</span>
            <span className="rounded-md border border-border bg-surface-3 px-2 py-0.5 text-[10px] text-text-muted">{testCase.priority}</span>
            <span className={`rounded-md border px-2 py-0.5 text-[10px] ${testCase.status === 'confirmed' ? 'border-success/20 bg-success/10 text-success' : 'border-warning/20 bg-warning/10 text-warning'}`}>
              {STATUS_LABEL[testCase.status]}
            </span>
            {testCase.status === 'confirmed' && (
              <span className={`rounded-md border px-2 py-0.5 text-[10px] ${convertedCaseIds.has(testCase.id) ? 'border-brand-500/20 bg-brand-500/10 text-brand-400' : 'border-border bg-surface-3 text-text-muted'}`}>
                {convertedCaseIds.has(testCase.id) ? '已转为流程场景' : '未转为流程场景'}
              </span>
            )}
          </div>
          <h4 className="text-sm font-bold leading-snug text-text-primary">{testCase.title}</h4>
          <p className="mt-1 text-[11px] text-text-muted">{testCase.module} · {testCase.requirementTitle}</p>
          <p className="mt-1 text-[11px] text-text-muted">
            {testCase.templateName ? `基于流程模板：${testCase.templateName}` : '未关联流程模板'}
          </p>
        </div>
        {testCase.lastRunStatus === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />}
        {testCase.lastRunStatus === 'failed' && <AlertTriangle className="h-4 w-4 shrink-0 text-error" />}
      </div>
      <div className="space-y-1 rounded-lg border border-border bg-surface-1/60 p-3 text-[11px] text-text-secondary">
        <div><span className="text-text-muted">风险点：</span>{testCase.riskPoint}</div>
        <div><span className="text-text-muted">前置条件：</span>{testCase.preconditions.join('；')}</div>
        <div><span className="text-text-muted">预期结果：</span>{testCase.expectedResult}</div>
      </div>
      <ol className="space-y-1 text-[11px] text-text-secondary">
        {testCase.steps.map((caseStep) => (
          <li key={caseStep.order}>{caseStep.order}. {caseStep.action} → {caseStep.expectedResult}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2 pt-1">
        {!executionActions && testCase.status === 'draft' && (
          <button onClick={() => handleConfirm(testCase)} className="h-8 rounded-lg bg-brand-500 px-3 text-xs font-semibold text-white hover:bg-brand-600">
            人工确认
          </button>
        )}
        {testCase.status === 'confirmed' && (
          <button type="button" onClick={() => setConversionCase(testCase)} className="h-8 rounded-lg border border-brand-500/20 bg-brand-500/10 px-3 text-xs font-semibold text-brand-400 hover:bg-brand-500/15">
            转为流程场景
          </button>
        )}
        {executionActions && (
          <>
            <button
              onClick={() => handleAddToSuite(testCase)}
              disabled={testCase.status !== 'confirmed'}
              className="h-8 rounded-lg border border-border bg-surface-3 px-3 text-xs font-semibold text-text-secondary hover:text-brand-400 disabled:opacity-40"
            >
              加入当前套件
            </button>
            <button
              onClick={() => runCase(testCase, selectedSuite)}
              disabled={runningId !== null || testCase.status !== 'confirmed'}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-success/20 bg-success/10 px-3 text-xs font-semibold text-success hover:bg-success/15 disabled:opacity-40"
            >
              {runningId === testCase.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              执行
            </button>
          </>
        )}
      </div>
    </article>
  );

  if (showModeler) {
    return <RequirementModeler onCancel={() => setShowModeler(false)} onSaved={handleTemplateSaved} />;
  }

  const wizardSteps: { id: TestDesignStep; title: string; description: string }[] = [
    { id: 1, title: '需求来源', description: '填写需求，或从需求文档建模' },
    { id: 2, title: '生成用例', description: '选择直接生成或场景模板' },
    { id: 3, title: '检查确认', description: '核对风险、步骤和预期结果' },
    { id: 4, title: '回归执行', description: '加入套件、执行并保存报告' },
  ];

  return (
    <div className="h-full flex-1 space-y-5 overflow-y-auto p-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-text-primary">测试设计</h2>
          <p className="mt-1 text-xs text-text-muted">按顺序完成需求、生成、确认和回归执行</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-success/20 bg-success/10 px-3 py-2 text-[11px] text-success">
          <ShieldCheck className="h-4 w-4" />
          数据安全：{securityModeLabel(getDataSecurityConfig().mode)}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="测试设计步骤" className="rounded-2xl border border-border bg-surface-1/80 p-3 glow">
          <ol className="space-y-2">
            {wizardSteps.map((item) => {
              const locked = item.id > highestUnlockedStep;
              const active = item.id === step;
              const completed = item.id < step && !locked;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-label={`${item.id} ${item.title}${active ? ' 当前步骤' : completed ? ' 已完成' : locked ? ' 已锁定' : ''}`}
                    aria-current={active ? 'step' : undefined}
                    disabled={generating || locked}
                    onClick={() => requestStep(item.id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${active ? 'border-brand-500/40 bg-brand-500/10 text-text-primary' : completed ? 'border-success/20 bg-success/5 text-text-secondary' : locked ? 'cursor-not-allowed border-border bg-surface-2/40 text-text-muted opacity-45' : 'border-border bg-surface-2/60 text-text-secondary hover:border-brand-500/30'}`}
                  >
                    <span className="flex items-center gap-2 text-xs font-bold"><span className="flex h-6 w-6 items-center justify-center rounded-lg border border-current/20">{item.id}</span>{item.title}</span>
                    <span className="mt-2 block text-[11px] leading-relaxed opacity-75">{item.description}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <section className="min-w-0 space-y-4 rounded-2xl border border-border bg-surface-1/80 p-5 glow">
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
                <div className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-brand-400" /><h3 className="text-sm font-bold text-text-primary">需求来源</h3></div>
                <button type="button" disabled={generating} onClick={() => setShowModeler(true)} className="flex h-8 items-center gap-1.5 rounded-lg border border-brand-500/20 bg-brand-500/10 px-3 text-[11px] font-semibold text-brand-400 hover:bg-brand-500/15 disabled:opacity-40"><Sparkles className="h-3.5 w-3.5" />从需求文档建模</button>
              </div>
              <label className="block"><span className="mb-2 block text-xs font-semibold text-text-secondary">模块名称</span><input aria-label="模块名称" disabled={generating} value={moduleName} onChange={(event) => { setModuleName(event.target.value); markRequirementChanged(); }} className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500 disabled:opacity-40" /></label>
              <label className="block"><span className="mb-2 block text-xs font-semibold text-text-secondary">需求或验收标准</span><textarea aria-label="需求或验收标准" disabled={generating} value={requirement} onChange={(event) => { setRequirement(event.target.value); markRequirementChanged(); }} className="min-h-36 w-full rounded-xl border border-border bg-surface-2 p-3 text-xs leading-relaxed text-text-primary outline-none focus:border-brand-500 disabled:opacity-40" placeholder="粘贴需求、场景描述或产品验收标准" /></label>
              {templates.length > 0 && <label className="block"><span className="mb-2 block text-xs font-semibold text-text-secondary">已有场景模板（可选）</span><select aria-label="已有场景模板（可选）" disabled={generating} value={selectedTemplateId} onChange={(event) => { setSelectedTemplateId(event.target.value); markRequirementChanged(); }} className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none disabled:opacity-40"><option value="">请选择模板</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>}
              {isStale && <p role="status" className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning">需求已修改，请重新生成测试用例</p>}
              <div className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-[11px] leading-relaxed text-warning">默认会先脱敏再发给模型；测试数据要求使用员工A、手机号_1、部门_1 等虚构值。</div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-border pb-3"><FileText className="h-4 w-4 text-brand-400" /><h3 className="text-sm font-bold text-text-primary">生成用例</h3></div>
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="space-y-3 rounded-xl border border-border bg-surface-2/60 p-4"><h4 className="text-sm font-bold text-text-primary">直接从需求生成</h4><p className="text-xs text-text-muted">根据需求与模块生成覆盖正常、边界和异常场景的用例。</p><button type="button" onClick={handleGenerate} disabled={generating || !requirement.trim()} className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-40">{generating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}直接从需求生成</button></div>
                <div className="space-y-3 rounded-xl border border-border bg-surface-2/60 p-4"><h4 className="text-sm font-bold text-text-primary">基于场景模板生成</h4><label className="block"><span className="mb-2 block text-[11px] text-text-muted">场景模板</span><select aria-label="场景模板" disabled={generating} value={selectedTemplateId} onChange={(event) => { setSelectedTemplateId(event.target.value); markRequirementChanged(); }} className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none disabled:opacity-40"><option value="">请选择模板</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>{selectedTemplate && <div className="space-y-1 rounded-lg border border-border bg-surface-1/60 p-3 text-[11px] text-text-muted"><div className="font-semibold text-text-primary">{selectedTemplate.name}</div><div>{selectedTemplate.description}</div><div>步骤：{selectedTemplate.steps.length} · 变量：{selectedTemplate.variables.length} · 参数集：{selectedTemplate.parameterSets?.length ?? 0}</div></div>}<button type="button" onClick={handleGenerateFromTemplate} disabled={generating || !selectedTemplate} className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-brand-500/20 bg-brand-500/10 text-xs font-semibold text-brand-400 hover:bg-brand-500/15 disabled:opacity-40">{generating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}基于场景模板生成</button></div>
              </div>
              {generationNotice && <p role="status" className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning">{generationNotice}</p>}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3"><div><h3 className="text-sm font-bold text-text-primary">检查确认</h3><p className="mt-1 text-[11px] text-text-muted">待确认 {draftCases.length} 条 · 已确认 {confirmedCases.length} 条</p></div></div>
              <div className="grid gap-4 xl:grid-cols-2">{cases.map((testCase) => renderCaseDetails(testCase, false))}</div>
              {cases.length === 0 && <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-text-muted">还没有测试用例。</div>}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 border-b border-border pb-3"><Layers3 className="h-4 w-4 text-brand-400" /><h3 className="text-sm font-bold text-text-primary">回归执行</h3></div>
              <div className="space-y-3 rounded-xl border border-border bg-surface-2/60 p-4"><div className="flex items-center justify-between"><h4 className="text-sm font-bold text-text-primary">回归套件</h4><button type="button" onClick={handleCreateSuite} className="text-[11px] text-brand-400 hover:text-brand-300">新建套件</button></div>{suites.length === 0 ? <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-text-muted">暂无套件。可以新建回归套件。</div> : <><select aria-label="回归套件" value={selectedSuiteId} onChange={(event) => setSelectedSuiteId(event.target.value)} className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none">{suites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{selectedSuite && <div className="space-y-2 rounded-xl border border-border bg-surface-1/60 p-3 text-xs"><div className="font-semibold text-text-primary">{selectedSuite.name}</div><div className="text-text-muted">{selectedSuite.description}</div><div className="flex items-center justify-between text-[11px] text-text-secondary"><span>用例数：{selectedSuite.caseIds.length}</span><span>上次通过率：{selectedSuite.lastPassRate ?? '--'}%</span></div><button type="button" onClick={() => runSuite(selectedSuite)} disabled={runningId !== null} className="flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-success/20 bg-success/10 text-xs font-semibold text-success hover:bg-success/15 disabled:opacity-50"><Play className="h-3.5 w-3.5" />一键执行套件</button></div>}</>}</div>
              <div className="grid gap-4 xl:grid-cols-2">{confirmedCases.map((testCase) => renderCaseDetails(testCase, true))}</div>
              {runLog.length > 0 && <section className="space-y-1 rounded-2xl border border-border bg-[#070b16] p-4 font-mono text-[11px] text-slate-300"><div className="mb-2 text-xs font-bold text-white">最近执行日志</div>{runLog.slice(-16).map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}</section>}
            </div>
          )}

          {step > 1 && <footer className="flex justify-start border-t border-border pt-4"><button type="button" disabled={generating} onClick={() => requestStep((step - 1) as TestDesignStep)} className="h-9 rounded-lg border border-border bg-surface-2 px-4 text-xs font-semibold text-text-secondary hover:text-text-primary disabled:opacity-40">上一步</button></footer>}
        </section>
      </div>
      {conversionCase && <ScenarioConversionDialog testCase={conversionCase} onClose={() => setConversionCase(null)} onSaved={(scenario) => handleScenarioSaved(scenario.sourceTestCaseId)} />}
    </div>
  );
};

export default TestCases;
