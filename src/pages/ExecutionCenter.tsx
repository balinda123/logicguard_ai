import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, RefreshCw } from 'lucide-react'

import { runScope, RUN_STATUS_LABEL } from '../api/runPresentation'
import { listSystems, listSystemEnvironments } from '../api/testDesignBridge'
import { WorkflowRunConsole } from '../components/WorkflowRunConsole'
import { matchesRunFilters, RunFilters, type RunFilterValue } from '../components/RunFilters'
import { useActiveRuns } from '../contexts/ActiveRunContext'
import type { SystemEnvironment, TestSystem } from '../types/testDesign'
import { formatChinaDateTime } from '../utils/dateTime'

const INITIAL_FILTERS: RunFilterValue = { systemId: 'all', environmentId: 'all', status: 'all', time: 'all' }

export function ExecutionCenter({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { runs, selectedRunId, setSelectedRunId, eventsByRun, loadRun, loading, error, refresh } = useActiveRuns()
  const [systems, setSystems] = useState<TestSystem[]>([])
  const [environments, setEnvironments] = useState<SystemEnvironment[]>([])
  const [filters, setFilters] = useState(INITIAL_FILTERS)

  useEffect(() => {
    void listSystems().then(async (items) => {
      setSystems(items)
      setEnvironments((await Promise.all(items.map((item) => listSystemEnvironments(item.id)))).flat())
    })
  }, [])
  useEffect(() => { if (selectedRunId) void loadRun(selectedRunId) }, [loadRun, selectedRunId])

  const availableEnvironments = environments.filter((item) => filters.systemId === 'all' || item.systemId === filters.systemId)
  const filtered = useMemo(() => runs.filter((run) => matchesRunFilters(run, runScope(run), filters)), [filters, runs])

  return <div className="flex h-full flex-1 flex-col overflow-hidden p-6">
    <header className="flex shrink-0 items-end justify-between gap-3 border-b border-border pb-4">
      <div><h2 className="flex items-center gap-2 text-lg font-bold text-text-primary"><ClipboardList className="h-5 w-5 text-brand-400" />测试运行</h2><p className="mt-1 text-xs text-text-muted">查看正在执行和等待操作的测试，切换页面不会中断任务。</p></div>
      <button type="button" aria-label="刷新运行记录" onClick={() => void refresh()} disabled={loading} className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-muted hover:text-brand-400 disabled:opacity-40"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
    </header>
    <RunFilters value={filters} systems={systems} environments={availableEnvironments} onChange={setFilters} />
    {error && <p role="alert" className="mt-3 text-xs text-error">{error}</p>}
    <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="min-h-0 overflow-auto border border-border">
        <table className="w-full min-w-[760px] table-fixed text-left text-xs">
          <thead className="sticky top-0 bg-surface-2 text-[11px] text-text-muted"><tr><th className="w-[28%] px-4 py-2 font-medium">测试集合 / 测试任务</th><th className="w-[22%] px-3 py-2 font-medium">系统 / 环境</th><th className="w-[14%] px-3 py-2 font-medium">状态</th><th className="w-[14%] px-3 py-2 font-medium">进度</th><th className="px-3 py-2 font-medium">更新时间（北京时间）</th></tr></thead>
          <tbody>{filtered.length === 0 ? <tr><td colSpan={5} className="px-4 py-12 text-center text-text-muted">暂无匹配的运行记录。</td></tr> : filtered.map((run) => {
            const scope = runScope(run)
            const total = run.executionPlan.commands.length
            return <tr key={run.id} onClick={() => setSelectedRunId(run.id)} className={`cursor-pointer border-t border-border/70 ${selectedRunId === run.id ? 'bg-brand-500/5' : 'hover:bg-surface-2/40'}`}><td className="px-4 py-3"><p className="truncate font-semibold text-text-primary">{scope.suiteName}</p><p className="mt-1 text-[10px] text-text-muted">{run.id.slice(0, 8)}</p></td><td className="px-3 py-3 text-text-secondary">{scope.systemName}<span className="mx-1 text-text-muted">·</span>{scope.environmentName}</td><td className="px-3 py-3 text-text-secondary">{RUN_STATUS_LABEL[run.status]}</td><td className="px-3 py-3 text-text-secondary">{Math.min(run.currentStep, total)} / {total}</td><td className="px-3 py-3 text-[11px] text-text-muted">{formatChinaDateTime(run.updatedAt)}</td></tr>
          })}</tbody>
        </table>
      </section>
      <WorkflowRunConsole runId={selectedRunId} onBackToDesign={() => onNavigate?.('testdesign')} key={`${selectedRunId}:${eventsByRun[selectedRunId ?? '']?.length ?? 0}`} />
    </div>
  </div>
}

export default ExecutionCenter
