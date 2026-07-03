import React, { useEffect, useMemo, useState } from 'react';
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

interface TestCasesProps {
  onOpenTemplateModeler?: () => void;
}

export const TestCases: React.FC<TestCasesProps> = ({ onOpenTemplateModeler }) => {
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

  useEffect(() => {
    setCases(loadTestCases());
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
    setSelectedTemplateId(mergedTemplates[0]?.id ?? '');
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

  const refreshCases = (next: TestCase[]) => {
    saveTestCases(next);
    setCases(next);
  };

  const handleGenerate = async () => {
    if (!requirement.trim()) {
      window.alert('请先输入需求或场景描述');
      return;
    }
    setGenerating(true);
    try {
      const generated = await generateTestCasesFromRequirement(requirement, moduleName);
      refreshCases([...generated, ...cases]);
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateFromTemplate = async () => {
    if (!selectedTemplate) {
      window.alert('请先选择一个场景模板');
      return;
    }
    setGenerating(true);
    try {
      const generated = await generateTestCasesFromTemplate(selectedTemplate);
      refreshCases([...generated, ...cases]);
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

  return (
    <div className="flex-1 h-full overflow-y-auto p-6 space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-text-primary">测试设计</h2>
          <p className="text-xs text-text-muted mt-1">
            需求来源 → 场景模板 → 测试用例 → 回归执行 → 部门可读报告
          </p>
        </div>
        <div className="rounded-xl border border-success/20 bg-success/10 px-3 py-2 text-[11px] text-success flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" />
          数据安全：{securityModeLabel(getDataSecurityConfig().mode)}
        </div>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {[
          ['1', '需求来源', '粘贴需求，或从需求文档建模'],
          ['2', '场景模板', '沉淀可复用的流程骨架'],
          ['3', '测试用例', '扩展风险、数据和预期结果'],
          ['4', '回归执行', '确认后加入套件并生成报告'],
        ].map(([order, title, description]) => (
          <div key={order} className="rounded-xl border border-border bg-surface-1/80 p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-500/10 border border-brand-500/20 text-[11px] font-bold text-brand-400">
                {order}
              </span>
              <span className="text-xs font-bold text-text-primary">{title}</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-text-muted">{description}</p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">
        <section className="rounded-2xl border border-border bg-surface-1/80 p-5 space-y-4 glow">
          <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-brand-400" />
              <h3 className="text-sm font-bold text-text-primary">需求来源</h3>
            </div>
            <button
              onClick={onOpenTemplateModeler}
              className="h-8 rounded-lg border border-brand-500/20 bg-brand-500/10 px-3 text-[11px] font-semibold text-brand-400 hover:bg-brand-500/15 flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              从需求文档建模
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-3">
            <input
              value={moduleName}
              onChange={(event) => setModuleName(event.target.value)}
              className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500"
              placeholder="模块，例如：入职流程"
            />
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="h-9 rounded-lg bg-brand-500 px-4 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {generating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {generating ? '正在生成...' : '直接生成测试用例'}
            </button>
          </div>
          <textarea
            value={requirement}
            onChange={(event) => setRequirement(event.target.value)}
            className="min-h-36 w-full rounded-xl border border-border bg-surface-2 p-3 text-xs leading-relaxed text-text-primary outline-none focus:border-brand-500"
            placeholder="粘贴需求、场景描述或产品验收标准。例如：员工入职时需要填写姓名、手机号、身份证、部门、岗位，提交后进入审批..."
          />
          <div className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-[11px] text-warning leading-relaxed">
            默认会先脱敏再发给模型；测试数据要求使用员工A、手机号_1、部门_1 等虚构值。
          </div>
        </section>

        <div className="space-y-5">
          <section className="rounded-2xl border border-border bg-surface-1/80 p-5 space-y-4 glow">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-brand-400" />
                <h3 className="text-sm font-bold text-text-primary">场景模板</h3>
              </div>
              <span className="text-[10px] text-text-muted">流程骨架</span>
            </div>
            {templates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-text-muted">
                暂无场景模板。可以先从需求文档建模生成一个流程骨架。
              </div>
            ) : (
              <div className="space-y-3">
                <select
                  value={selectedTemplateId}
                  onChange={(event) => setSelectedTemplateId(event.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none"
                >
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
                {selectedTemplate && (
                  <div className="rounded-xl border border-border bg-surface-2/60 p-3 space-y-2 text-xs">
                    <div className="font-semibold text-text-primary">{selectedTemplate.name}</div>
                    <div className="line-clamp-2 text-text-muted">{selectedTemplate.description}</div>
                    <div className="grid grid-cols-3 gap-2 text-[11px] text-text-secondary">
                      <span>步骤：{selectedTemplate.steps.length}</span>
                      <span>变量：{selectedTemplate.variables.length}</span>
                      <span>参数集：{selectedTemplate.parameterSets?.length ?? 0}</span>
                    </div>
                    <button
                      onClick={handleGenerateFromTemplate}
                      disabled={generating}
                      className="h-8 w-full rounded-lg bg-brand-500/10 text-brand-400 border border-brand-500/20 hover:bg-brand-500/15 text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {generating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      基于模板生成测试用例
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

        <section className="rounded-2xl border border-border bg-surface-1/80 p-5 space-y-4 glow">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Layers3 className="w-4 h-4 text-brand-400" />
              <h3 className="text-sm font-bold text-text-primary">回归套件</h3>
            </div>
            <button onClick={handleCreateSuite} className="text-[11px] text-brand-400 hover:text-brand-300">新建套件</button>
          </div>
          {suites.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-text-muted">
              暂无套件。确认用例后可以新建回归套件。
            </div>
          ) : (
            <div className="space-y-3">
              <select
                value={selectedSuiteId}
                onChange={(event) => setSelectedSuiteId(event.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none"
              >
                {suites.map((suite) => (
                  <option key={suite.id} value={suite.id}>{suite.name}</option>
                ))}
              </select>
              {selectedSuite && (
                <div className="rounded-xl border border-border bg-surface-2/60 p-3 space-y-2 text-xs">
                  <div className="font-semibold text-text-primary">{selectedSuite.name}</div>
                  <div className="text-text-muted">{selectedSuite.description}</div>
                  <div className="flex items-center justify-between text-[11px] text-text-secondary">
                    <span>用例数：{selectedSuite.caseIds.length}</span>
                    <span>上次通过率：{selectedSuite.lastPassRate ?? '--'}%</span>
                  </div>
                  <button
                    onClick={() => runSuite(selectedSuite)}
                    disabled={runningId !== null}
                    className="h-8 w-full rounded-lg bg-success/10 text-success border border-success/20 hover:bg-success/15 text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5" />
                    一键执行套件
                  </button>
                </div>
              )}
            </div>
          )}
          </section>
        </div>
      </div>

      <section className="rounded-2xl border border-border bg-surface-1/80 p-5 space-y-4 glow">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <h3 className="text-sm font-bold text-text-primary">测试用例列表</h3>
            <p className="text-[11px] text-text-muted mt-1">待确认 {draftCases.length} 条 · 已确认 {confirmedCases.length} 条</p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {cases.map((testCase) => (
            <article key={testCase.id} className="rounded-xl border border-border bg-surface-2/60 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="rounded-md bg-brand-500/10 border border-brand-500/20 px-2 py-0.5 text-[10px] text-brand-400">{TYPE_LABEL[testCase.type]}</span>
                    <span className="rounded-md bg-surface-3 border border-border px-2 py-0.5 text-[10px] text-text-muted">{testCase.priority}</span>
                    <span className={`rounded-md px-2 py-0.5 text-[10px] border ${testCase.status === 'confirmed' ? 'bg-success/10 text-success border-success/20' : 'bg-warning/10 text-warning border-warning/20'}`}>
                      {STATUS_LABEL[testCase.status]}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-text-primary leading-snug">{testCase.title}</h4>
                  <p className="text-[11px] text-text-muted mt-1">{testCase.module} · {testCase.requirementTitle}</p>
                  <p className="text-[11px] text-text-muted mt-1">
                    {testCase.templateName ? `基于流程模板：${testCase.templateName}` : '未关联流程模板'}
                  </p>
                </div>
                {testCase.lastRunStatus === 'success' && <CheckCircle2 className="w-4 h-4 text-success shrink-0" />}
                {testCase.lastRunStatus === 'failed' && <AlertTriangle className="w-4 h-4 text-error shrink-0" />}
              </div>

              <div className="rounded-lg border border-border bg-surface-1/60 p-3 text-[11px] text-text-secondary space-y-1">
                <div><span className="text-text-muted">风险点：</span>{testCase.riskPoint}</div>
                <div><span className="text-text-muted">前置条件：</span>{testCase.preconditions.join('；')}</div>
                <div><span className="text-text-muted">预期结果：</span>{testCase.expectedResult}</div>
              </div>

              <ol className="space-y-1 text-[11px] text-text-secondary">
                {testCase.steps.slice(0, 4).map((step) => (
                  <li key={step.order}>{step.order}. {step.action} → {step.expectedResult}</li>
                ))}
              </ol>

              <div className="flex flex-wrap gap-2 pt-1">
                {testCase.status === 'draft' && (
                  <button onClick={() => handleConfirm(testCase)} className="h-8 rounded-lg bg-brand-500 px-3 text-xs font-semibold text-white hover:bg-brand-600">
                    人工确认
                  </button>
                )}
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
                  className="h-8 rounded-lg border border-success/20 bg-success/10 px-3 text-xs font-semibold text-success hover:bg-success/15 disabled:opacity-40 flex items-center gap-1.5"
                >
                  {runningId === testCase.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  执行
                </button>
              </div>
            </article>
          ))}
        </div>

        {cases.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-text-muted">
            还没有测试用例。先粘贴一段人事需求，让 AI 帮你补齐正常、边界、权限和重复测试。
          </div>
        )}
      </section>

      {runLog.length > 0 && (
        <section className="rounded-2xl border border-border bg-[#070b16] p-4 text-[11px] font-mono text-slate-300 space-y-1">
          <div className="mb-2 text-xs font-bold text-white">最近执行日志</div>
          {runLog.slice(-16).map((line, index) => (
            <div key={`${line}-${index}`}>{line}</div>
          ))}
        </section>
      )}
    </div>
  );
};

export default TestCases;
