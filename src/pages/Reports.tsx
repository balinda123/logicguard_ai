import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, FileWarning, ListChecks } from 'lucide-react'

import { eventMessage, runScope, RUN_STATUS_LABEL } from '../api/runPresentation'
import { listSystems, listSystemEnvironments } from '../api/testDesignBridge'
import { matchesRunFilters, RunFilters, type RunFilterValue } from '../components/RunFilters'
import { isTerminalRun, useActiveRuns } from '../contexts/ActiveRunContext'
import type { SystemEnvironment, TestSystem } from '../types/testDesign'

const INITIAL_FILTERS: RunFilterValue = { systemId: 'all', environmentId: 'all', status: 'all', time: 'all' }

export function Reports({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { runs, eventsByRun, selectedRunId, setSelectedRunId, loadRun } = useActiveRuns()
  const [systems, setSystems] = useState<TestSystem[]>([])
  const [environments, setEnvironments] = useState<SystemEnvironment[]>([])
  const [filters, setFilters] = useState(INITIAL_FILTERS)
  const [detailId, setDetailId] = useState<string>()

  useEffect(() => { void listSystems().then(async (items) => { setSystems(items); setEnvironments((await Promise.all(items.map((item) => listSystemEnvironments(item.id)))).flat()) }) }, [])
  useEffect(() => { if (detailId) void loadRun(detailId) }, [detailId, loadRun])
  const filtered = useMemo(() => runs.filter((run) => isTerminalRun(run.status) && matchesRunFilters(run, runScope(run), filters)), [filters, runs])
  const detail = runs.find((run) => run.id === detailId)
  const availableEnvironments = environments.filter((item) => filters.systemId === 'all' || item.systemId === filters.systemId)

  if (detail) {
    const scope = runScope(detail)
    const businessFailure = detail.status === 'business_failed'
    return <div className="flex h-full flex-1 flex-col overflow-hidden p-6"><header className="flex items-center justify-between border-b border-border pb-4"><div className="flex items-center gap-3"><button type="button" onClick={() => setDetailId(undefined)} className="flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-text-secondary"><ArrowLeft className="h-3.5 w-3.5" />返回报告</button><div><h2 className="text-sm font-bold text-text-primary">{scope.suiteName}</h2><p className="mt-1 text-[11px] text-text-muted">{scope.systemName} · {scope.environmentName} · {detail.id}</p></div></div><button type="button" onClick={() => { setSelectedRunId(detail.id); onNavigate?.('execution') }} className="flex h-8 items-center gap-1.5 rounded-md bg-brand-500 px-3 text-xs font-semibold text-white"><ListChecks className="h-3.5 w-3.5" />进入执行中心</button></header>
      <section className="grid grid-cols-2 border-b border-border md:grid-cols-4"><Metric label="状态" value={RUN_STATUS_LABEL[detail.status]} /><Metric label="步骤" value={`${detail.currentStep} / ${detail.executionPlan.commands.length}`} /><Metric label="开始" value={formatTime(detail.startedAt ?? detail.createdAt)} /><Metric label="结束" value={formatTime(detail.finishedAt ?? detail.updatedAt)} /></section>
      <div className={`mt-4 border-l-2 px-3 py-2 text-xs ${businessFailure ? 'border-error bg-error/5 text-error' : 'border-warning bg-warning/5 text-warning'}`}>{businessFailure ? '这是业务断言失败：可创建缺陷，并在问题跟踪中保存业务截图证据。' : detail.status === 'passed' ? '业务流程通过，不创建问题。' : '这是运行基础设施诊断：不会创建缺陷，也不会把诊断截图当作业务证据。'}{detail.errorMessage ? ` ${detail.errorMessage}` : ''}</div>
      <section className="mt-4 min-h-0 flex-1 overflow-y-auto border border-border"><div className="border-b border-border px-4 py-3 text-sm font-bold text-text-primary">持久化事件</div>{(eventsByRun[detail.id] ?? []).map((event) => <div key={event.sequence} className="border-b border-border/70 px-4 py-3"><div className="flex justify-between gap-3"><span className="text-xs font-semibold text-text-primary">{eventMessage(event)}</span><time className="text-[10px] text-text-muted">{formatTime(event.createdAt)}</time></div><p className="mt-1 text-[10px] text-text-muted">#{event.sequence} · {event.kind}</p></div>)}</section>
    </div>
  }

  return <div className="flex h-full flex-1 flex-col overflow-hidden p-6"><header className="flex items-end justify-between border-b border-border pb-4"><div><h2 className="text-lg font-bold text-text-primary">测试报告</h2><p className="mt-1 text-xs text-text-muted">汇总所有系统的完整终态；业务失败与运行诊断分开处理。</p></div><button type="button" onClick={() => onNavigate?.('execution')} className="flex h-8 items-center gap-1.5 rounded-md bg-brand-500 px-3 text-xs font-semibold text-white"><ListChecks className="h-3.5 w-3.5" />执行中心</button></header>
    <RunFilters value={filters} systems={systems} environments={availableEnvironments} onChange={setFilters} />
    <section className="mt-4 min-h-0 flex-1 overflow-auto border border-border"><table className="w-full min-w-[860px] table-fixed text-left text-xs"><thead className="sticky top-0 bg-surface-2 text-[11px] text-text-muted"><tr><th className="w-[30%] px-4 py-2 font-medium">套件</th><th className="w-[22%] px-3 py-2 font-medium">系统 / 环境</th><th className="w-[14%] px-3 py-2 font-medium">终态</th><th className="w-[22%] px-3 py-2 font-medium">结果类型</th><th className="px-3 py-2 font-medium">操作</th></tr></thead><tbody>{filtered.map((run) => { const scope = runScope(run); const business = run.status === 'business_failed'; return <tr key={run.id} className="border-t border-border/70"><td className="px-4 py-3 font-semibold text-text-primary">{scope.suiteName}</td><td className="px-3 py-3 text-text-secondary">{scope.systemName} · {scope.environmentName}</td><td className="px-3 py-3 text-text-secondary">{RUN_STATUS_LABEL[run.status]}</td><td className="px-3 py-3"><span className={business ? 'text-error' : run.status === 'passed' ? 'text-success' : 'text-warning'}>{business ? '业务失败，可建缺陷' : run.status === 'passed' ? '业务通过' : '运行诊断，不建问题'}</span></td><td className="px-3 py-3"><button type="button" onClick={() => setDetailId(run.id)} className="font-semibold text-brand-400">查看报告</button></td></tr> })}{filtered.length === 0 && <tr><td colSpan={5} className="p-12 text-center text-text-muted"><FileWarning className="mx-auto mb-2 h-5 w-5" />暂无匹配报告</td></tr>}</tbody></table></section>
  </div>
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="border-r border-border p-4 last:border-r-0"><p className="text-[10px] text-text-muted">{label}</p><p className="mt-1 truncate text-xs font-semibold text-text-primary">{value}</p></div> }
function formatTime(value?: string) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未记录' }

export default Reports
