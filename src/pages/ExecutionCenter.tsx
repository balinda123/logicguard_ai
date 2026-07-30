import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ClipboardList, Play, RefreshCw, XCircle } from 'lucide-react'

import {
  appendWorkflowRunEvent,
  captureFailureScreenshot,
  clearBrowserSession,
  createWorkflowRun,
  listAccountCombinations,
  listDefectDrafts,
  listFailureEvidence,
  listTestAccounts,
  listWorkflowRunEvents,
  listWorkflowRuns,
  listWorkflowScenarios,
  loginTestAccount,
  saveDefectDraft,
  saveFailureEvidence,
  updateWorkflowRun,
} from '../api/testingBridge'
import { createWorkflowRunController, executeWorkflowIntent } from '../agents/workflowExecutor'
import { WorkflowRunConsole } from '../components/WorkflowRunConsole'
import type { AccountCombination, DefectDraft, FailureEvidence, TestAccount, WorkflowRun, WorkflowRunEvent, WorkflowScenario } from '../types/workflow'

const STATUS_LABEL: Record<WorkflowRun['status'], string> = {
  queued: '待开始',
  running: '执行中',
  waiting_handoff: '等待交接',
  execution_blocked: '执行被阻断',
  business_failed: '业务失败',
  passed: '通过',
  cancelled: '已取消',
}

function combinationAccountLabel(combination: AccountCombination, accounts: TestAccount[]): string {
  const accountIds = [combination.employeeAccountId, combination.managerAccountId, combination.hrbpAccountId].filter(Boolean)
  const labels = accountIds.map((accountId) => {
    const account = accounts.find(item => item.id === accountId)
    return account ? `${account.displayName} (${account.maskedLoginName})` : '账号不可用'
  })
  return labels.join(' / ') || '未配置账号'
}

function statusClass(status: WorkflowRun['status']): string {
  if (status === 'passed') return 'bg-success/10 text-success border-success/20'
  if (status === 'business_failed' || status === 'execution_blocked') return 'bg-error/10 text-error border-error/20'
  if (status === 'waiting_handoff') return 'bg-warning/10 text-warning border-warning/20'
  if (status === 'running') return 'bg-brand-500/10 text-brand-400 border-brand-500/20'
  return 'bg-surface-2 text-text-muted border-border'
}

export function ExecutionCenter() {
  const [scenarios, setScenarios] = useState<WorkflowScenario[]>([])
  const [combinations, setCombinations] = useState<AccountCombination[]>([])
  const [accounts, setAccounts] = useState<TestAccount[]>([])
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [eventsByRun, setEventsByRun] = useState<Record<string, WorkflowRunEvent[]>>({})
  const [evidenceByRun, setEvidenceByRun] = useState<Record<string, FailureEvidence>>({})
  const [defectByRun, setDefectByRun] = useState<Record<string, DefectDraft>>({})
  const [selectedScenarioId, setSelectedScenarioId] = useState('')
  const [selectedCombinationId, setSelectedCombinationId] = useState('')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const selectedScenario = useMemo(() => scenarios.find(item => item.id === selectedScenarioId), [scenarios, selectedScenarioId])
  const selectedCombination = useMemo(() => combinations.find(item => item.id === selectedCombinationId), [combinations, selectedCombinationId])
  const selectedRun = useMemo(() => runs.find(item => item.id === selectedRunId) ?? null, [runs, selectedRunId])
  const consoleScenario = useMemo(() => scenarios.find(item => item.id === selectedRun?.scenarioId), [scenarios, selectedRun])

  const appendEvent = (event: WorkflowRunEvent) => {
    setEventsByRun(previous => ({
      ...previous,
      [event.runId]: [...(previous[event.runId] ?? []), event],
    }))
  }

  const replaceRun = (run: WorkflowRun) => {
    setRuns(previous => [run, ...previous.filter(item => item.id !== run.id)])
    setSelectedRunId(run.id)
  }

  const loadRunDetails = async (runId: string) => {
    const [events, evidence, drafts] = await Promise.all([
      listWorkflowRunEvents(runId),
      listFailureEvidence(runId),
      listDefectDrafts(),
    ])
    setEventsByRun(previous => ({ ...previous, [runId]: events }))
    if (evidence[0]) setEvidenceByRun(previous => ({ ...previous, [runId]: evidence[0] }))
    const draft = drafts.find(item => item.runId === runId)
    if (draft) setDefectByRun(previous => ({ ...previous, [runId]: draft }))
  }

  const refresh = async () => {
    setLoading(true)
    try {
      const [nextScenarios, nextCombinations, nextAccounts, nextRuns] = await Promise.all([
        listWorkflowScenarios(),
        listAccountCombinations(),
        listTestAccounts(),
        listWorkflowRuns(),
      ])
      setScenarios(nextScenarios)
      setCombinations(nextCombinations)
      setAccounts(nextAccounts)
      setRuns(nextRuns)
      setSelectedScenarioId(current => nextScenarios.some(item => item.id === current) ? current : nextScenarios[0]?.id ?? '')
      setSelectedCombinationId(current => nextCombinations.some(item => item.id === current) ? current : nextCombinations[0]?.id ?? '')
      setSelectedRunId(current => current && nextRuns.some(item => item.id === current) ? current : nextRuns[0]?.id ?? null)
      await Promise.all(nextRuns.map(run => loadRunDetails(run.id)))
      setNotice(null)
    } catch {
      setNotice('无法加载流程执行数据，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // Initial data loading intentionally runs once; callbacks update live state afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const controller = () => createWorkflowRunController({
    createWorkflowRun,
    updateWorkflowRun,
    appendWorkflowRunEvent,
    clearBrowserSession,
    loginTestAccount,
    executeIntent: executeWorkflowIntent,
    captureFailureScreenshot,
    saveFailureEvidence,
    saveDefectDraft,
    onRunUpdated: replaceRun,
    onEvent: appendEvent,
  })

  const start = async () => {
    if (!selectedScenario || !selectedCombination) return
    setBusy(true)
    setNotice(null)
    try {
      const run = await controller().start({ scenario: selectedScenario, combination: selectedCombination, accounts })
      replaceRun(run)
      await loadRunDetails(run.id)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '流程启动失败，请检查账号与浏览器连接。')
    } finally {
      setBusy(false)
    }
  }

  const resume = async () => {
    if (!selectedRun || !consoleScenario) return
    const combination = combinations.find(item => item.id === selectedRun.accountCombinationId)
    if (!combination) {
      setNotice('该运行的账号组合已不可用。')
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const run = await controller().resume({ run: selectedRun, scenario: consoleScenario, combination, accounts })
      replaceRun(run)
      await loadRunDetails(run.id)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法继续该流程。')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!selectedRun) return
    setBusy(true)
    try {
      const run = await controller().cancel(selectedRun)
      replaceRun(run)
      await loadRunDetails(run.id)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法取消该流程。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden p-6">
      <header className="flex shrink-0 flex-col gap-3 border-b border-border pb-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-text-primary"><ClipboardList className="h-5 w-5 text-brand-400" />执行中心</h2>
          <p className="mt-1 text-xs text-text-muted">多角色流程运行与待处理交接</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-[11px] text-text-muted"><span>流程场景</span><select aria-label="流程场景" value={selectedScenarioId} onChange={event => setSelectedScenarioId(event.target.value)} disabled={busy || loading} className="h-8 min-w-44 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary disabled:opacity-50"><option value="">选择场景</option>{scenarios.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label className="grid gap-1 text-[11px] text-text-muted"><span>账号组合</span><select aria-label="账号组合" value={selectedCombinationId} onChange={event => setSelectedCombinationId(event.target.value)} disabled={busy || loading} className="h-8 min-w-52 max-w-72 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary disabled:opacity-50"><option value="">选择账号组合</option>{combinations.map(item => <option key={item.id} value={item.id}>{item.name} · {combinationAccountLabel(item, accounts)}</option>)}</select></label>
          <button type="button" onClick={() => void start()} disabled={busy || loading || !selectedScenario || !selectedCombination} className="flex h-8 items-center gap-1.5 rounded-md bg-brand-500 px-3 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-45"><Play className="h-3.5 w-3.5" />开始执行</button>
          <button type="button" onClick={() => void refresh()} disabled={loading || busy} aria-label="刷新运行记录" className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-muted hover:text-brand-400 disabled:opacity-45"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </header>

      {notice && <div role="status" className="mt-3 flex items-center gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning"><AlertTriangle className="h-4 w-4" />{notice}</div>}

      <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-h-0 overflow-hidden border border-border bg-surface-1">
          <div className="flex items-center justify-between border-b border-border px-4 py-3"><h3 className="text-sm font-bold text-text-primary">运行记录</h3><span className="text-[11px] text-text-muted">{runs.length} 条</span></div>
          <div className="h-full overflow-y-auto">
            {loading ? <div className="flex h-48 items-center justify-center text-xs text-text-muted"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />加载中</div> : runs.length === 0 ? <div className="flex h-48 flex-col items-center justify-center px-6 text-center text-xs text-text-muted"><ClipboardList className="h-6 w-6" /><p className="mt-2">尚无流程运行记录</p></div> : (
              <table className="w-full table-fixed text-left text-xs"><thead className="sticky top-0 bg-surface-2 text-[11px] text-text-muted"><tr><th className="w-[36%] px-4 py-2 font-medium">场景</th><th className="w-[20%] px-3 py-2 font-medium">状态</th><th className="w-[20%] px-3 py-2 font-medium">当前步骤</th><th className="px-3 py-2 font-medium">更新时间</th></tr></thead><tbody>{runs.map(run => { const runScenario = scenarios.find(item => item.id === run.scenarioId); const active = run.id === selectedRunId; return <tr key={run.id} onClick={() => setSelectedRunId(run.id)} className={`cursor-pointer border-t border-border/70 ${active ? 'bg-brand-500/5' : 'hover:bg-surface-2/50'}`}><td className="truncate px-4 py-3 font-medium text-text-primary">{runScenario?.title ?? '已删除场景'}</td><td className="px-3 py-3"><span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${statusClass(run.status)}`}>{STATUS_LABEL[run.status]}</span></td><td className="px-3 py-3 text-text-secondary">第 {run.currentStepIndex || 0} 步</td><td className="truncate px-3 py-3 text-[11px] text-text-muted">{new Date(run.updatedAt).toLocaleString()}</td></tr> })}</tbody></table>
            )}
          </div>
        </section>
        <WorkflowRunConsole run={selectedRun} scenario={consoleScenario} events={selectedRun ? eventsByRun[selectedRun.id] ?? [] : []} evidence={selectedRun ? evidenceByRun[selectedRun.id] : undefined} defect={selectedRun ? defectByRun[selectedRun.id] : undefined} busy={busy} onResume={() => void resume()} onCancel={() => void cancel()} />
      </div>
      {selectedRun?.status === 'business_failed' && <footer className="mt-3 flex items-center gap-2 text-[11px] text-text-muted"><XCircle className="h-3.5 w-3.5 text-error" />问题草稿需在问题管理中确认后再提交给开发。</footer>}
    </div>
  )
}

export default ExecutionCenter
