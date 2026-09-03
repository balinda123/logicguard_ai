import { ClipboardList, FileWarning, ListChecks, Route, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { runScope, RUN_STATUS_LABEL } from '../api/runPresentation'
import { listSystems, listSystemEnvironments } from '../api/testDesignBridge'
import { matchesRunFilters, RunFilters, type RunFilterValue } from '../components/RunFilters'
import { useActiveRuns } from '../contexts/ActiveRunContext'
import { USER_COPY } from '../constants/userFacingCopy'
import type { SystemEnvironment, TestSystem } from '../types/testDesign'

const INITIAL_FILTERS: RunFilterValue = { systemId: 'all', environmentId: 'all', status: 'all', time: 'all' }

export function Dashboard({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { runs, activeRuns } = useActiveRuns()
  const [filters, setFilters] = useState(INITIAL_FILTERS)
  const [systems, setSystems] = useState<TestSystem[]>([])
  const [environments, setEnvironments] = useState<SystemEnvironment[]>([])
  useEffect(() => { void listSystems().then(async (items) => { setSystems(items); setEnvironments((await Promise.all(items.map((item) => listSystemEnvironments(item.id)))).flat()) }) }, [])
  const filtered = useMemo(() => runs.filter((run) => matchesRunFilters(run, runScope(run), filters)), [filters, runs])
  const summary = useMemo(() => ({ passed: filtered.filter((run) => run.status === 'passed').length, failed: filtered.filter((run) => run.status === 'business_failed').length, diagnostics: filtered.filter((run) => ['blocked', 'cancelled', 'interrupted'].includes(run.status)).length }), [filtered])
  const actions = [{ title: USER_COPY.designTests, tab: 'testdesign', icon: Sparkles }, { title: USER_COPY.testRuns, tab: 'execution', icon: ListChecks }, { title: '测试报告', tab: 'reports', icon: ClipboardList }, { title: '问题跟踪', tab: 'issues', icon: FileWarning }]
  return <div className="flex h-full flex-1 flex-col overflow-y-auto p-6"><header className="border-b border-border pb-4"><h2 className="text-lg font-bold text-text-primary">全局测试工作台</h2><p className="mt-1 text-xs text-text-muted">这里汇总全部系统；只有设计测试按系统和环境隔离。</p></header>
    <section className="grid grid-cols-2 border-b border-border lg:grid-cols-4">{actions.map(({ title, tab, icon: Icon }) => <button key={tab} onClick={() => onNavigate?.(tab)} className="flex min-h-20 items-center gap-3 border-r border-border p-4 text-left hover:bg-surface-2/50"><Icon className="h-4 w-4 text-brand-400" /><span className="text-sm font-semibold text-text-primary">{title}</span></button>)}</section>
    <RunFilters value={filters} systems={systems} environments={environments.filter((item) => filters.systemId === 'all' || item.systemId === filters.systemId)} onChange={setFilters} />
    <section className="grid grid-cols-2 border-b border-border md:grid-cols-4"><Metric label="活动运行" value={activeRuns.length} tone="text-warning" /><Metric label="已通过" value={summary.passed} tone="text-success" /><Metric label="业务失败" value={summary.failed} tone="text-error" /><Metric label="运行诊断" value={summary.diagnostics} tone="text-warning" /></section>
    <section className="shrink-0"><div className="flex items-center justify-between border-b border-border px-4 py-3"><h3 className="text-sm font-bold text-text-primary">最近运行</h3><button onClick={() => onNavigate?.('execution')} className="text-xs font-semibold text-brand-400">查看全部</button></div>{filtered.slice(0, 8).map((run) => { const scope = runScope(run); return <button key={run.id} onClick={() => onNavigate?.('execution')} className="grid w-full grid-cols-[minmax(0,1fr)_180px_100px] items-center gap-3 border-b border-border/70 px-4 py-3 text-left hover:bg-surface-2/40"><span className="truncate text-xs font-semibold text-text-primary">{scope.suiteName}</span><span className="truncate text-[11px] text-text-muted">{scope.systemName} · {scope.environmentName}</span><span className="text-right text-[11px] text-text-secondary">{RUN_STATUS_LABEL[run.status]}</span></button> })}</section>
    <footer className="flex shrink-0 items-center gap-2 border-t border-border px-4 pt-4 text-[11px] text-text-muted"><Route className="h-3.5 w-3.5" />运行由后台管理器持有，页面导航不会终止浏览器自动化。</footer>
  </div>
}
function Metric({ label, value, tone }: { label: string; value: number; tone: string }) { return <div className="border-r border-border p-4"><p className="text-[10px] text-text-muted">{label}</p><p className={`mt-1 text-xl font-bold ${tone}`}>{value}</p></div> }
export default Dashboard
