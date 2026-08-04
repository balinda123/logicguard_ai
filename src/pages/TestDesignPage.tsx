import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Plus } from 'lucide-react'

import {
  createGenerationBatch,
  createRequirementVersion,
  createReview,
  createTestDesign,
  listDesignTestCases,
  listGenerationBatches,
  listRequirementVersions,
  listReviewRecords,
  listSystemEnvironments,
  listTestDesigns,
  saveGenerationCases,
  saveRegressionConfig,
  updateDesignCaseStatus,
} from '../api/testDesignBridge'
import { generateTestCasesFromRequirement } from '../api/testCaseGenerator'
import { getLlmConfig } from '../api/llmBridge'
import { migrateLegacyTestData } from '../api/legacyMigration'
import { startRun } from '../api/runBridge'
import { SystemEnvironmentPicker, type SystemEnvironmentSelection } from '../components/SystemEnvironmentPicker'
import type { TestCase } from '../types'
import type { DesignTestCaseRecord, GenerationBatch, RequirementVersion, ReviewRecord, TestDesign } from '../types/testDesign'
import { GenerationStage } from './test-design/GenerationStage'
import { RegressionStage } from './test-design/RegressionStage'
import { RequirementStage } from './test-design/RequirementStage'
import { ReviewStage } from './test-design/ReviewStage'

type Stage = 1 | 2 | 3 | 4

const STAGES: { id: Stage; title: string; description: string }[] = [
  { id: 1, title: '需求来源', description: '保存可追溯的需求版本' },
  { id: 2, title: '生成用例', description: '绑定当前需求生成批次' },
  { id: 3, title: '检查确认', description: '审核当前版本的用例' },
  { id: 4, title: '回归执行', description: '创建后台运行快照' },
]

function mapCase(record: DesignTestCaseRecord): TestCase {
  return {
    ...(record.payload as unknown as TestCase),
    id: record.id,
    designId: record.designId,
    requirementVersionId: record.requirementVersionId,
    generationBatchId: record.generationBatchId,
    status: record.status,
    createdAt: record.createdAt,
  }
}

function safeGoal(testCase: TestCase): string {
  return `${testCase.title}。${testCase.steps.map((step) => `${step.order}. ${step.action}，预期：${step.expectedResult}`).join('；')}`
    .replace(/\{\{[^}]+\}\}|\$\{[^}]+\}/g, '[运行时数据]')
    .replace(/\b(password|token|otp|secret|credential)\b/gi, '敏感字段')
    .slice(0, 4000)
}

interface Props {
  canManageAccounts?: boolean
  onNavigate?: (tab: string) => void
}

export function TestDesignPage({ onNavigate }: Props) {
  const [scope, setScope] = useState<SystemEnvironmentSelection>()
  const [designs, setDesigns] = useState<TestDesign[]>([])
  const [selectedDesign, setSelectedDesign] = useState<TestDesign>()
  const [versions, setVersions] = useState<RequirementVersion[]>([])
  const [batches, setBatches] = useState<GenerationBatch[]>([])
  const [reviews, setReviews] = useState<ReviewRecord[]>([])
  const [cases, setCases] = useState<TestCase[]>([])
  const [requirement, setRequirement] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [stage, setStage] = useState<Stage>(1)
  const [busy, setBusy] = useState<'saving' | 'generating' | 'reviewing' | 'running'>()
  const [notice, setNotice] = useState('')

  const loadDesigns = async (selection: SystemEnvironmentSelection) => {
    const items = await listTestDesigns(selection.system.id, selection.environment.id)
    setDesigns(items)
    setSelectedDesign((current) => items.find((item) => item.id === current?.id) ?? items[0])
  }

  useEffect(() => {
    setDesigns([])
    setSelectedDesign(undefined)
    setVersions([])
    setBatches([])
    setReviews([])
    setCases([])
    setRequirement('')
    setStage(1)
    setNotice('')
    if (!scope) return
    void loadDesigns(scope)
    void listSystemEnvironments(scope.system.id)
      .then((items) => migrateLegacyTestData(items.find((item) => item.kind === 'test')?.baseUrl))
      .then((result) => {
        if (result && result.importedRecords > 0) void loadDesigns(scope)
        if (result?.quarantinedRecords) setNotice(`${result.quarantinedRecords} 条历史数据因环境无法识别，已进入迁移隔离区。`)
      })
      .catch((error) => setNotice(`历史数据迁移未完成：${String(error)}`))
    // Reload only when the persisted scope identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope?.system.id, scope?.environment.id])

  useEffect(() => {
    setVersions([])
    setBatches([])
    setReviews([])
    setCases([])
    setRequirement('')
    setStage(1)
    if (!selectedDesign) return
    let active = true
    Promise.all([
      listRequirementVersions(selectedDesign.id),
      listGenerationBatches(selectedDesign.id),
      listReviewRecords(selectedDesign.id),
      listDesignTestCases(selectedDesign.id),
    ]).then(([nextVersions, nextBatches, nextReviews, nextCases]) => {
      if (!active) return
      setVersions(nextVersions)
      setBatches(nextBatches)
      setReviews(nextReviews)
      setCases(nextCases.map(mapCase))
      setRequirement(nextVersions[0]?.content ?? '')
    })
    return () => { active = false }
    // Local design metadata updates must not overwrite the current lifecycle state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDesign?.id])

  const currentVersion = versions[0]
  const currentCases = useMemo(() => {
    const currentBatch = batches.find((item) => item.requirementVersionId === currentVersion?.id)
    return cases.filter((item) => item.requirementVersionId === currentVersion?.id && (
      currentBatch ? item.generationBatchId === currentBatch.id : !item.generationBatchId
    ))
  }, [batches, cases, currentVersion?.id])
  const confirmedCases = currentCases.filter((item) => item.status === 'confirmed')
  const highestStage: Stage = !currentVersion ? 1 : currentCases.length === 0 ? 2 : confirmedCases.length === 0 ? 3 : 4

  const createDesign = async () => {
    if (!scope || !newTitle.trim()) return
    const created = await createTestDesign({
      systemId: scope.system.id,
      environmentId: scope.environment.id,
      title: newTitle.trim(),
      status: 'draft',
    })
    setDesigns((items) => [created, ...items])
    setSelectedDesign(created)
    setNewTitle('')
  }

  const saveRequirement = async () => {
    if (!selectedDesign || !requirement.trim()) return
    setBusy('saving')
    try {
      const saved = await createRequirementVersion({ designId: selectedDesign.id, sourceKind: 'text', content: requirement.trim() })
      setVersions((items) => [saved, ...items])
      setSelectedDesign({ ...selectedDesign, currentRequirementVersionId: saved.id })
      setBatches((items) => items.map((item) => ({ ...item, isStale: item.requirementVersionId !== saved.id })))
      setStage(2)
    } finally {
      setBusy(undefined)
    }
  }

  const generateCases = async () => {
    if (!selectedDesign || !currentVersion) return
    setBusy('generating')
    try {
      const batch = await createGenerationBatch({
        designId: selectedDesign.id,
        requirementVersionId: currentVersion.id,
        model: getLlmConfig().model || 'configured-model',
      })
      const generated = (await generateTestCasesFromRequirement(currentVersion.content, selectedDesign.title)).map((item) => ({
        ...item,
        designId: selectedDesign.id,
        requirementVersionId: currentVersion.id,
        generationBatchId: batch.id,
      }))
      const persisted = await saveGenerationCases({
        designId: selectedDesign.id,
        requirementVersionId: currentVersion.id,
        generationBatchId: batch.id,
        cases: generated.map((item) => ({ ...item } as unknown as Record<string, unknown>)),
      })
      setBatches((items) => [batch, ...items])
      setCases((items) => [...persisted.map(mapCase), ...items])
      setStage(3)
    } finally {
      setBusy(undefined)
    }
  }

  const approveCase = async (testCase: TestCase) => {
    if (!selectedDesign || !testCase.generationBatchId) return
    setBusy('reviewing')
    try {
      await updateDesignCaseStatus({ designId: selectedDesign.id, caseId: testCase.id, status: 'confirmed' })
      const review = await createReview({
        designId: selectedDesign.id,
        generationBatchId: testCase.generationBatchId,
        conclusion: 'approved',
        changeSummary: `确认用例：${testCase.title}`,
      })
      setReviews((items) => [review, ...items])
      setCases((items) => items.map((item) => item.id === testCase.id ? { ...item, status: 'confirmed' } : item))
    } finally {
      setBusy(undefined)
    }
  }

  const runRegression = async () => {
    if (!scope || !selectedDesign || !currentVersion || confirmedCases.length === 0) return
    setBusy('running')
    try {
      const allowedOrigin = new URL(scope.environment.baseUrl).origin
      await saveRegressionConfig({ designId: selectedDesign.id, caseIdsJson: JSON.stringify(confirmedCases.map((item) => item.id)) })
      const runId = await startRun({
        executionPlan: {
          commands: confirmedCases.map((testCase) => ({
            command: 'agent',
            goal: safeGoal(testCase),
            allowedOrigins: [allowedOrigin],
            maxActions: 20,
            timeoutMs: 300_000,
          })),
        },
        snapshot: {
          systemId: scope.system.id,
          systemName: scope.system.name,
          environmentId: scope.environment.id,
          environmentName: scope.environment.name,
          designId: selectedDesign.id,
          designTitle: selectedDesign.title,
          requirementVersionId: currentVersion.id,
          caseIds: confirmedCases.map((item) => item.id),
        },
      })
      setNotice(`回归任务 ${runId.slice(0, 8)} 已进入执行队列。`)
      onNavigate?.('execution')
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div><h2 className="text-lg font-bold text-text-primary">测试设计</h2><p className="mt-1 text-xs text-text-muted">需求、用例、审核与回归统一归属到同一设计单。</p></div>
      </header>
      <SystemEnvironmentPicker value={scope} onChange={setScope} />
      {notice && <p role="status" className="my-3 border-l-2 border-brand-500 bg-brand-500/5 px-3 py-2 text-xs text-text-secondary">{notice}</p>}
      <div className="grid min-h-0 flex-1 gap-5 pt-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-r border-border pr-4">
          <div className="mb-3 flex gap-2">
            <input aria-label="新设计名称" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="新设计名称" className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none" />
            <button aria-label="新建设计" disabled={!scope || !newTitle.trim()} onClick={() => void createDesign()} className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-white disabled:opacity-40"><Plus className="h-4 w-4" /></button>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {designs.map((design) => (
              <button key={design.id} onClick={() => setSelectedDesign(design)} className={`flex w-full items-center justify-between gap-2 py-3 text-left ${selectedDesign?.id === design.id ? 'text-brand-400' : 'text-text-secondary'}`}>
                <span className="min-w-0"><span className="block truncate text-xs font-semibold">{design.title}</span><span className="mt-1 block text-[10px] text-text-muted">{design.status === 'historical' ? '历史导入' : design.status}</span></span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              </button>
            ))}
          </div>
          {scope && designs.length === 0 && <p className="py-8 text-center text-xs text-text-muted">当前系统和环境还没有设计。</p>}
        </aside>
        <main className="min-h-0 overflow-y-auto">
          {!selectedDesign ? <div className="grid h-full place-items-center text-sm text-text-muted">选择或新建一个测试设计。</div> : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                <div><h3 className="text-base font-bold text-text-primary">{selectedDesign.title}</h3><p className="mt-1 text-[11px] text-text-muted">{scope?.system.name} · {scope?.environment.name}</p></div>
                <ol aria-label="测试设计阶段" className="flex flex-wrap gap-1">
                  {STAGES.map((item) => <li key={item.id}><button disabled={item.id > highestStage} aria-current={stage === item.id ? 'step' : undefined} onClick={() => setStage(item.id)} className={`h-8 border-b-2 px-3 text-xs ${stage === item.id ? 'border-brand-500 text-brand-400' : 'border-transparent text-text-muted'} disabled:opacity-30`}>{item.id}. {item.title}</button></li>)}
                </ol>
              </div>
              {stage === 1 && <RequirementStage content={requirement} latest={currentVersion} saving={busy === 'saving'} onContentChange={setRequirement} onSave={() => void saveRequirement()} />}
              {stage === 2 && <GenerationStage requirement={currentVersion} batches={batches} cases={cases} generating={busy === 'generating'} onGenerate={() => void generateCases()} />}
              {stage === 3 && <ReviewStage cases={currentCases} staleCount={cases.length - currentCases.length} reviewing={busy === 'reviewing'} onApprove={(item) => void approveCase(item)} />}
              {stage === 4 && <RegressionStage cases={confirmedCases} running={busy === 'running'} onRun={() => void runRegression()} />}
              <p className="sr-only">审核记录 {reviews.length} 条</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default TestDesignPage
