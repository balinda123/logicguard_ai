import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, CircleAlert, Play, Plus, X } from 'lucide-react'

import {
  createGenerationBatch,
  createRequirementVersion,
  createReview,
  createTestDesign,
  getRegressionConfig,
  listDesignTestCases,
  listGenerationBatches,
  listRequirementVersions,
  listReviewRecords,
  listSystemEnvironments,
  listTestDesigns,
  saveGenerationCases,
  saveRegressionConfig,
  updateDesignTestCase,
  updateDesignCaseStatus,
} from '../api/testDesignBridge'
import { generateTestCasesFromRequirement } from '../api/testCaseGenerator'
import { getLlmConfig } from '../api/llmBridge'
import { migrateLegacyTestData } from '../api/legacyMigration'
import { buildRegressionAccountOrchestration } from '../api/regressionAccountOrchestration'
import { buildRegressionExecutionBundle, executionRoleAccounts, executionRoleKey } from '../api/regressionExecutionPlan'
import { startRun } from '../api/runBridge'
import { buildCaseExecutionGoal } from '../api/testCaseExecutionGoal'
import { listScopedTestAccounts } from '../api/testingBridge'
import { SystemEnvironmentPicker, type SystemEnvironmentSelection } from '../components/SystemEnvironmentPicker'
import { WorkflowRunConsole } from '../components/WorkflowRunConsole'
import type { TestCase } from '../types'
import type { DesignTestCaseRecord, GenerationBatch, RequirementVersion, ReviewRecord, TestDesign } from '../types/testDesign'
import type { TestAccount } from '../types/workflow'
import { GenerationStage } from './test-design/GenerationStage'
import { EditTestCaseDialog } from './test-design/EditTestCaseDialog'
import { RegressionStage } from './test-design/RegressionStage'
import { RequirementStage } from './test-design/RequirementStage'
import { ReviewStage } from './test-design/ReviewStage'
import { highestUnlockedTestDesignStep, restoreTestDesignStep, type TestDesignStep } from './testDesignWizard'

type Stage = TestDesignStep

export interface GenerationProgress {
  phase: 'preparing' | 'requesting' | 'parsing' | 'saving' | 'completed' | 'failed'
  startedAt: number
  generatedCount?: number
  message?: string
}

const STAGES: { id: Stage; title: string; description: string }[] = [
  { id: 1, title: '需求来源', description: '保存可追溯的需求版本' },
  { id: 2, title: '生成用例', description: '绑定当前需求生成批次' },
  { id: 3, title: '检查确认', description: '审核当前版本的用例' },
  { id: 4, title: '执行测试', description: '选择并执行测试用例' },
]

function stageStorageKey(designId: string): string {
  return `logicguard.test-design.stage.${designId}`
}

function readSavedStage(designId: string): number | undefined {
  try {
    const value = Number(localStorage.getItem(stageStorageKey(designId)))
    return Number.isInteger(value) ? value : undefined
  } catch {
    return undefined
  }
}

function saveStage(designId: string, stage: Stage): void {
  try { localStorage.setItem(stageStorageKey(designId), String(stage)) } catch { /* 本地记忆失败不影响设计主流程。 */ }
}

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

interface Props {
  canManageAccounts?: boolean
  onNavigate?: (tab: string) => void
}

export function TestDesignPage({ canManageAccounts = false, onNavigate }: Props) {
  const [scope, setScope] = useState<SystemEnvironmentSelection>()
  const [designs, setDesigns] = useState<TestDesign[]>([])
  const [selectedDesign, setSelectedDesign] = useState<TestDesign>()
  const [versions, setVersions] = useState<RequirementVersion[]>([])
  const [batches, setBatches] = useState<GenerationBatch[]>([])
  const [reviews, setReviews] = useState<ReviewRecord[]>([])
  const [cases, setCases] = useState<TestCase[]>([])
  const [requirement, setRequirement] = useState('')
  const [requirementSourceKind, setRequirementSourceKind] = useState<'text' | 'web'>('text')
  const [embeddedRunId, setEmbeddedRunId] = useState<string>()
  const [newTitle, setNewTitle] = useState('')
  const [creatingDesign, setCreatingDesign] = useState(false)
  const [showNewTitleError, setShowNewTitleError] = useState(false)
  const [stage, setStage] = useState<Stage>(1)
  const [busy, setBusy] = useState<'saving' | 'generating' | 'reviewing' | 'running'>()
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress>()
  const [notice, setNotice] = useState('')
  const [editingCase, setEditingCase] = useState<TestCase>()
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set())
  const [collectionName, setCollectionName] = useState('默认测试集合')
  const [savingCollection, setSavingCollection] = useState(false)
  const [flowAccounts, setFlowAccounts] = useState<TestAccount[]>([])
  const [accountOverrides, setAccountOverrides] = useState<Record<string, string>>({})
  const [runFeedback, setRunFeedback] = useState<{ kind: 'progress' | 'error'; message: string }>()
  const [globalAlert, setGlobalAlert] = useState<{ id: number; message: string }>()
  const requestedStageRef = useRef<{ designId: string; stage: Stage } | undefined>(undefined)
  const newTitleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!globalAlert) return
    const timer = window.setTimeout(() => setGlobalAlert(undefined), 5000)
    return () => window.clearTimeout(timer)
  }, [globalAlert])

  const showGlobalAlert = (message: string) => {
    setGlobalAlert({ id: Date.now(), message })
  }

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
    setRequirementSourceKind('text')
    setEditingCase(undefined)
    setSelectedCaseIds(new Set())
    setCollectionName('默认测试集合')
    setFlowAccounts([])
    setAccountOverrides({})
    setRunFeedback(undefined)
    setGenerationProgress(undefined)
    setStage(1)
    setNotice('')
    if (!scope) return
    void loadDesigns(scope)
    void listScopedTestAccounts({ systemId: scope.system.id, environmentId: scope.environment.id })
      .then(setFlowAccounts)
      .catch((error) => setNotice(`测试账号加载失败：${String(error)}`))
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
    setRequirementSourceKind('text')
    setAccountOverrides({})
    setRunFeedback(undefined)
    setGenerationProgress(undefined)
    setStage(1)
    if (!selectedDesign) return
    let active = true
    Promise.all([
      listRequirementVersions(selectedDesign.id),
      listGenerationBatches(selectedDesign.id),
      listReviewRecords(selectedDesign.id),
      listDesignTestCases(selectedDesign.id),
      getRegressionConfig(selectedDesign.id),
    ]).then(([nextVersions, nextBatches, nextReviews, nextCases, regressionConfig]) => {
      if (!active) return
      const mappedCases = nextCases.map(mapCase)
      const currentRequirement = nextVersions[0]
      const currentBatch = nextBatches.find(item => item.requirementVersionId === currentRequirement?.id)
      const currentDesignCases = mappedCases.filter(item => item.requirementVersionId === currentRequirement?.id && (
        currentBatch ? item.generationBatchId === currentBatch.id : !item.generationBatchId
      ))
      const confirmedCount = currentDesignCases.filter(item => item.status === 'confirmed').length
      const highest = highestUnlockedTestDesignStep({
        hasRequirement: Boolean(currentRequirement),
        hasCases: currentDesignCases.length > 0,
        hasConfirmedCases: confirmedCount > 0,
      })
      const requested = requestedStageRef.current?.designId === selectedDesign.id ? requestedStageRef.current.stage : undefined
      const nextStage = restoreTestDesignStep({
        highest,
        saved: readSavedStage(selectedDesign.id),
        requested,
        reviewComplete: currentDesignCases.length > 0 && confirmedCount === currentDesignCases.length,
      })
      // 快捷入口也必须服从持久化进度，不能跳过需求、生成或确认前置条件。
      if (requested && requested > highest) setNotice('该设计还没有已确认用例，请先完成当前步骤。')
      requestedStageRef.current = undefined
      setVersions(nextVersions)
      setBatches(nextBatches)
      setReviews(nextReviews)
      setCases(mappedCases)
      setRequirement(nextVersions[0]?.content ?? '')
      setRequirementSourceKind(nextVersions[0]?.sourceKind === 'web' ? 'web' : 'text')
      setCollectionName(regressionConfig?.name || '默认测试集合')
      try {
        const ids = JSON.parse(regressionConfig?.caseIdsJson || '[]')
        setSelectedCaseIds(new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []))
      } catch {
        setSelectedCaseIds(new Set())
      }
      setStage(nextStage)
      saveStage(selectedDesign.id, nextStage)
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
  const selectedCases = confirmedCases.filter((item) => selectedCaseIds.has(item.id))
  const highestStage = highestUnlockedTestDesignStep({ hasRequirement: Boolean(currentVersion), hasCases: currentCases.length > 0, hasConfirmedCases: confirmedCases.length > 0 })

  const changeStage = (nextStage: Stage) => {
    if (!selectedDesign || nextStage > highestStage) return
    setStage(nextStage)
    saveStage(selectedDesign.id, nextStage)
  }

  const openExecution = (design: TestDesign) => {
    setEmbeddedRunId(undefined)
    if (selectedDesign?.id === design.id) {
      if (highestStage >= 4) changeStage(4)
      else setNotice('该设计还没有已确认用例，请先完成当前步骤。')
      return
    }
    requestedStageRef.current = { designId: design.id, stage: 4 }
    setSelectedDesign(design)
  }

  const createDesign = async () => {
    if (!scope) {
      showGlobalAlert('请先选择系统和环境，再新建设计。')
      return
    }
    if (!newTitle.trim()) {
      setShowNewTitleError(true)
      showGlobalAlert('请先输入设计名称。')
      newTitleInputRef.current?.focus()
      return
    }
    setShowNewTitleError(false)
    setCreatingDesign(true)
    try {
      const created = await createTestDesign({
        systemId: scope.system.id,
        environmentId: scope.environment.id,
        title: newTitle.trim(),
        status: 'draft',
      })
      setDesigns((items) => [created, ...items])
      setSelectedDesign(created)
      setNewTitle('')
    } catch (error) {
      showGlobalAlert(`新建设计失败：${String(error)}`)
    } finally {
      setCreatingDesign(false)
    }
  }

  const saveRequirement = async () => {
    if (!selectedDesign || !requirement.trim()) return
    setBusy('saving')
    try {
      const saved = await createRequirementVersion({ designId: selectedDesign.id, sourceKind: requirementSourceKind, content: requirement.trim() })
      setVersions((items) => [saved, ...items])
      setSelectedDesign({ ...selectedDesign, currentRequirementVersionId: saved.id })
      setBatches((items) => items.map((item) => ({ ...item, isStale: item.requirementVersionId !== saved.id })))
      setStage(2)
      saveStage(selectedDesign.id, 2)
    } finally {
      setBusy(undefined)
    }
  }

  const generateCases = async () => {
    if (!selectedDesign || !currentVersion) return
    setBusy('generating')
    const startedAt = Date.now()
    setGenerationProgress({ phase: 'preparing', startedAt })
    try {
      const batch = await createGenerationBatch({
        designId: selectedDesign.id,
        requirementVersionId: currentVersion.id,
        model: getLlmConfig().model || 'configured-model',
      })
      const generated = (await generateTestCasesFromRequirement(currentVersion.content, selectedDesign.title, flowAccounts, (phase) => {
        setGenerationProgress({ phase, startedAt })
      })).map((item) => ({
        ...item,
        designId: selectedDesign.id,
        requirementVersionId: currentVersion.id,
        generationBatchId: batch.id,
      }))
      setGenerationProgress({ phase: 'saving', startedAt, generatedCount: generated.length })
      const persisted = await saveGenerationCases({
        designId: selectedDesign.id,
        requirementVersionId: currentVersion.id,
        generationBatchId: batch.id,
        cases: generated.map((item) => ({ ...item } as unknown as Record<string, unknown>)),
      })
      setBatches((items) => [batch, ...items])
      setCases((items) => [...persisted.map(mapCase), ...items])
      setGenerationProgress({ phase: 'completed', startedAt, generatedCount: persisted.length })
      setStage(3)
      saveStage(selectedDesign.id, 3)
    } catch (error) {
      const message = String(error)
      setGenerationProgress({ phase: 'failed', startedAt, message })
      setNotice(`生成用例失败：${message}`)
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
      const reviewComplete = currentCases.every(item => item.id === testCase.id || item.status === 'confirmed')
      if (reviewComplete) setNotice('用例检查已完成，可以进入“执行测试”。')
    } finally {
      setBusy(undefined)
    }
  }

  const saveEditedCase = async (testCase: TestCase) => {
    if (!selectedDesign) return
    setBusy('reviewing')
    try {
      const updated = await updateDesignTestCase({
        designId: selectedDesign.id,
        caseId: testCase.id,
        payload: { ...testCase } as unknown as Record<string, unknown>,
      })
      setCases((items) => items.map((item) => item.id === testCase.id ? mapCase(updated) : item))
      setSelectedCaseIds((ids) => {
        const next = new Set(ids)
        next.delete(testCase.id)
        return next
      })
      setEditingCase(undefined)
      setNotice('用例已保存并恢复为待确认，请检查后重新确认。')
    } catch (error) {
      setNotice(`用例保存失败：${String(error)}`)
    } finally {
      setBusy(undefined)
    }
  }

  const deleteCase = async (testCase: TestCase) => {
    if (!selectedDesign || !window.confirm(`确认删除用例“${testCase.title}”？`)) return
    setBusy('reviewing')
    try {
      await updateDesignCaseStatus({ designId: selectedDesign.id, caseId: testCase.id, status: 'archived' })
      setCases((items) => items.filter((item) => item.id !== testCase.id))
      setSelectedCaseIds((ids) => {
        const next = new Set(ids)
        next.delete(testCase.id)
        return next
      })
      setNotice('用例已删除，并已从当前测试集合移除。')
    } catch (error) {
      setNotice(`用例删除失败：${String(error)}`)
    } finally {
      setBusy(undefined)
    }
  }

  const saveCollection = async () => {
    if (!selectedDesign || selectedCases.length === 0 || !collectionName.trim()) return
    setSavingCollection(true)
    try {
      await saveRegressionConfig({
        designId: selectedDesign.id,
        name: collectionName.trim(),
        caseIdsJson: JSON.stringify(selectedCases.map((item) => item.id)),
      })
      setNotice(`测试集合“${collectionName.trim()}”已保存。`)
    } catch (error) {
      setNotice(`测试集合保存失败：${String(error)}`)
    } finally {
      setSavingCollection(false)
    }
  }

  const runRegression = async () => {
    if (!scope || !selectedDesign || !currentVersion || selectedCases.length === 0) return
    setBusy('running')
    setRunFeedback({ kind: 'progress', message: '正在检查账号和测试配置...' })
    try {
      const scopedAccounts = await listScopedTestAccounts({ systemId: scope.system.id, environmentId: scope.environment.id })
      const requiredRoles = Array.from(new Set(selectedCases.flatMap((item) => item.steps.map((step) => executionRoleKey(step, scopedAccounts)).filter((role): role is string => Boolean(role)))))
      // 选择区与执行前校验必须共用“角色键或显示身份相同”的规则；否则动态角色账号会在按钮已启用后被静默拦截。
      const missingRoles = requiredRoles.filter((role) => !executionRoleAccounts(role, scopedAccounts).some((account) => account.id === accountOverrides[role]))
      if (missingRoles.length > 0) {
        const labels = missingRoles.map((role) => scopedAccounts.find((account) => account.role === role)?.roleName || role)
        const message = `请先选择${labels.join('、')}的执行账号，再开始测试。`
        setNotice(message)
        setRunFeedback({ kind: 'error', message })
        showGlobalAlert(message)
        return
      }
      setRunFeedback({ kind: 'progress', message: '账号检查完成，正在创建测试任务...' })
      await saveRegressionConfig({ designId: selectedDesign.id, name: collectionName.trim() || '默认测试集合', caseIdsJson: JSON.stringify(selectedCases.map((item) => item.id)) })
      const execution = buildRegressionExecutionBundle(scope.environment.baseUrl, selectedCases, buildCaseExecutionGoal, scopedAccounts, accountOverrides)
      const accountOrchestration = buildRegressionAccountOrchestration({
        systemId: scope.system.id,
        environmentId: scope.environment.id,
        baseUrl: scope.environment.baseUrl,
        loginUrl: scope.environment.loginUrl,
        handoffOrigins: scope.environment.handoffOrigins,
        accounts: scopedAccounts,
        roleCommands: execution.roleCommands,
      })
      const llm = getLlmConfig()
      const runId = await startRun({
        executionPlan: execution.executionPlan,
        snapshot: {
          systemId: scope.system.id,
          systemName: scope.system.name,
          environmentId: scope.environment.id,
          environmentName: scope.environment.name,
          designId: selectedDesign.id,
          designTitle: selectedDesign.title,
          requirementVersionId: currentVersion.id,
          caseIds: selectedCases.map((item) => item.id),
          suiteName: collectionName.trim() || '默认测试集合',
          suiteCompilation: {
            sourceStepCount: execution.sourceStepCount,
            compiledStepCount: execution.compiledStepCount,
          },
          llmRuntime: {
            provider: llm.provider,
            model: llm.model,
            baseUrl: llm.base_url,
          },
          accountOrchestration,
        },
      })
      setNotice(`测试任务 ${runId.slice(0, 8)} 已开始执行。`)
      setRunFeedback(undefined)
      setEmbeddedRunId(runId)
    } catch (error) {
      const message = `无法开始测试：${String(error)}`
      setNotice(message)
      setRunFeedback({ kind: 'error', message })
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      {globalAlert && <div role="alert" aria-live="assertive" className="fixed left-1/2 top-5 z-[60] flex w-[min(92vw,520px)] -translate-x-1/2 items-start gap-3 rounded-md border border-warning/40 bg-surface-1 px-4 py-3 text-text-primary shadow-xl">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p className="min-w-0 flex-1 text-sm font-semibold leading-5">{globalAlert.message}</p>
        <button type="button" aria-label="关闭提示" title="关闭提示" onClick={() => setGlobalAlert(undefined)} className="grid h-6 w-6 shrink-0 place-items-center text-text-muted hover:text-text-primary"><X className="h-4 w-4" /></button>
      </div>}
      <header className="mb-4 flex items-start justify-between gap-4">
        <div><h2 className="text-lg font-bold text-text-primary">设计测试</h2><p className="mt-1 text-xs text-text-muted">依次填写需求、生成用例、检查用例并执行测试。</p></div>
      </header>
      <SystemEnvironmentPicker value={scope} onChange={setScope} canCreate={canManageAccounts} />
      {notice && <p role="status" className="my-3 border-l-2 border-brand-500 bg-brand-500/5 px-3 py-2 text-xs text-text-secondary">{notice}</p>}
      <div className="grid min-h-0 flex-1 gap-5 pt-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-r border-border pr-4">
          <div className="mb-3 flex gap-2">
            <input ref={newTitleInputRef} aria-label="新设计名称" aria-invalid={showNewTitleError || undefined} value={newTitle} onChange={(event) => {
              setNewTitle(event.target.value)
              if (event.target.value.trim()) setShowNewTitleError(false)
            }} onKeyDown={(event) => {
              if (event.key === 'Enter') void createDesign()
            }} placeholder="新设计名称" className={`h-9 min-w-0 flex-1 rounded-lg border bg-surface-2 px-3 text-xs text-text-primary outline-none ${showNewTitleError ? 'border-danger focus:border-danger' : 'border-border focus:border-brand-500'}`} />
            <button aria-label="新建设计" disabled={creatingDesign} onClick={() => void createDesign()} className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-brand-500 px-3 text-xs font-semibold text-white disabled:opacity-40"><Plus className="h-4 w-4" />{creatingDesign ? '正在创建...' : '新建设计'}</button>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {designs.map((design) => (
              <div key={design.id} className={`flex items-center gap-1 ${selectedDesign?.id === design.id ? 'text-brand-400' : 'text-text-secondary'}`}>
                <button onClick={() => { setSelectedDesign(design); setEmbeddedRunId(undefined) }} className="flex min-w-0 flex-1 items-center justify-between gap-2 py-3 text-left">
                  <span className="min-w-0"><span className="block truncate text-xs font-semibold">{design.title}</span><span className="mt-1 block text-[10px] text-text-muted">{design.status === 'historical' ? '历史导入' : design.status}</span></span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                </button>
                <button type="button" aria-label={`执行测试：${design.title}`} title="直接进入执行测试" onClick={() => openExecution(design)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[10px] font-semibold text-brand-400 hover:bg-brand-500/10"><Play className="h-3 w-3" />执行</button>
              </div>
            ))}
          </div>
          {scope && designs.length === 0 && <p className="py-8 text-center text-xs text-text-muted">当前系统和环境还没有设计。</p>}
        </aside>
        <main className="min-h-0 overflow-y-auto">
          {!selectedDesign ? <div className="grid h-full place-items-center text-center text-sm text-text-muted"><div><p className="font-semibold text-text-secondary">{scope ? '新建第一个测试任务' : '先选择系统和环境'}</p><p className="mt-1 text-xs">{scope ? '在左侧输入任务名称，随后从需求内容开始。' : '设计测试的数据会按系统和环境隔离。'}</p></div></div> : (
            <div className="space-y-5">
              <div className="border-b border-border pb-4"><h3 className="text-base font-bold text-text-primary">{selectedDesign.title}</h3><p className="mt-1 text-[11px] text-text-muted">{scope?.system.name} · {scope?.environment.name}</p></div>
              <nav aria-label="设计测试步骤" className="sticky top-0 z-20 border-y border-border bg-surface-1/95 py-2 backdrop-blur">
                <ol className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                  {STAGES.map((item) => {
                    const activeStage = stage === item.id
                    const completedStage = item.id === 1
                      ? Boolean(currentVersion)
                      : item.id === 2
                        ? currentCases.length > 0
                        : item.id === 3
                          ? currentCases.length > 0 && currentCases.every(testCase => testCase.status === 'confirmed')
                          : false
                    return <li key={item.id}><button disabled={item.id > highestStage} aria-current={activeStage ? 'step' : undefined} onClick={() => changeStage(item.id)} className={`flex h-16 w-full items-center gap-2.5 rounded-md border px-3 text-left transition-colors ${activeStage ? 'border-brand-500 bg-brand-500/10 text-brand-400' : completedStage ? 'border-success/25 bg-success/5 text-text-primary' : 'border-border bg-surface-2 text-text-secondary'} disabled:cursor-not-allowed disabled:opacity-35`}><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] font-bold ${activeStage ? 'border-brand-500 bg-brand-500 text-white' : completedStage ? 'border-success text-success' : 'border-border text-text-muted'}`}>{completedStage ? <Check className="h-3.5 w-3.5" /> : item.id}</span><span className="min-w-0"><span className="block text-xs font-semibold">{item.title}</span><span className="mt-0.5 block truncate text-[10px] text-text-muted">{item.description}</span></span></button></li>
                  })}
                </ol>
              </nav>
              {stage === 1 && <RequirementStage content={requirement} latest={currentVersion} saving={busy === 'saving'} onContentChange={setRequirement} onSourceKindChange={setRequirementSourceKind} onSave={() => void saveRequirement()} />}
              {stage === 2 && scope && <GenerationStage requirement={currentVersion} batches={batches} cases={cases} generating={busy === 'generating'} progress={generationProgress} accountScope={{ systemId: scope.system.id, environmentId: scope.environment.id, baseUrl: scope.environment.baseUrl, loginUrl: scope.environment.loginUrl, handoffOrigins: scope.environment.handoffOrigins }} canManageAccounts={canManageAccounts} onAccountsChanged={setFlowAccounts} onGenerate={() => void generateCases()} />}
              {stage === 3 && <ReviewStage cases={currentCases} staleCount={cases.length - currentCases.length} reviewing={busy === 'reviewing'} accounts={flowAccounts} onApprove={(item) => void approveCase(item)} onEdit={setEditingCase} onDelete={(item) => void deleteCase(item)} onContinue={() => changeStage(4)} />}
              {stage === 4 && <div className={`grid items-start gap-5 ${embeddedRunId ? '2xl:grid-cols-2' : ''}`}>
                <RegressionStage cases={confirmedCases} selectedIds={selectedCaseIds} collectionName={collectionName} running={busy === 'running'} saving={savingCollection} runFeedback={runFeedback} accounts={flowAccounts} accountOverrides={accountOverrides} onSelectionChange={setSelectedCaseIds} onCollectionNameChange={setCollectionName} onSaveCollection={() => void saveCollection()} onAccountOverridesChange={setAccountOverrides} onMissingAccounts={showGlobalAlert} onRun={() => void runRegression()} />
                {embeddedRunId && <aside aria-label="当前测试执行过程" className="sticky top-0 h-[max(620px,calc(100vh-250px))] min-h-0 overflow-hidden rounded-md border border-border bg-surface-1 shadow-sm">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[11px]"><strong className="text-text-primary">当前测试执行过程</strong><button type="button" onClick={() => onNavigate?.('execution')} className="font-semibold text-brand-400">查看全部运行记录</button></div>
                  <div className="h-[calc(100%-37px)] min-h-0"><WorkflowRunConsole runId={embeddedRunId} onBackToDesign={() => setEmbeddedRunId(undefined)} /></div>
                </aside>}
              </div>}
              <p className="sr-only">审核记录 {reviews.length} 条</p>
            </div>
          )}
        </main>
      </div>
      {editingCase && <EditTestCaseDialog testCase={editingCase} saving={busy === 'reviewing'} onClose={() => setEditingCase(undefined)} onSave={(item) => void saveEditedCase(item)} />}
    </div>
  )
}

export default TestDesignPage
