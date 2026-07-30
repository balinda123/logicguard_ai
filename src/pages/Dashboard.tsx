import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, FileWarning, ListChecks, RefreshCw, Route, Sparkles } from 'lucide-react'

import { listDefectDrafts, listWorkflowRuns, listWorkflowScenarios } from '../api/testingBridge'
import type { DefectDraft, WorkflowRun, WorkflowScenario } from '../types/workflow'

interface DashboardProps {
  onNavigate?: (tab: string) => void
}

const RUN_LABEL: Record<WorkflowRun['status'], string> = {
  queued: '待执行',
  running: '执行中',
  waiting_handoff: '等待交接',
  execution_blocked: '执行受阻',
  business_failed: '业务失败',
  passed: '通过',
  cancelled: '已取消',
}

function statusTone(status: WorkflowRun['status']): string {
  if (status === 'passed') return 'text-success'
  if (status === 'business_failed' || status === 'execution_blocked') return 'text-error'
  if (status === 'waiting_handoff') return 'text-warning'
  return 'text-text-secondary'
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [scenarios, setScenarios] = useState<WorkflowScenario[]>([])
  const [drafts, setDrafts] = useState<DefectDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const scenarioTitle = useMemo(() => new Map(scenarios.map(item => [item.id, item.title])), [scenarios])
  const pendingCount = drafts.filter(item => item.status === 'pending_confirmation').length

  const load = async () => {
    setLoading(true)
    try {
      const [nextRuns, nextScenarios, nextDrafts] = await Promise.all([
        listWorkflowRuns(),
        listWorkflowScenarios(),
        listDefectDrafts(),
      ])
      setRuns(nextRuns)
      setScenarios(nextScenarios)
      setDrafts(nextDrafts)
      setError(null)
    } catch {
      setError('暂时无法读取工作台数据，请稍后刷新。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const actions = [
    { title: '需求建模', description: '从需求文档提取测试范围与规则', tab: 'testdesign', icon: Sparkles },
    { title: '用例设计', description: '补充正常、边界和权限测试用例', tab: 'testdesign', icon: ClipboardList },
    { title: '执行中心', description: '按角色与账号组合运行流程', tab: 'execution', icon: ListChecks },
    { title: '问题跟踪', description: '确认失败问题并交给开发修复', tab: 'issues', icon: FileWarning },
  ]

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto p-6">
      <header className="flex items-start justify-between border-b border-border pb-4">
        <div>
          <h2 className="text-lg font-bold text-text-primary">测试工作台</h2>
          <p className="mt-1 text-xs text-text-muted">围绕需求、用例、流程执行和问题修复组织测试工作。</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} aria-label="刷新工作台" className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-muted hover:text-brand-400 disabled:opacity-45"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
      </header>

      <section className="grid grid-cols-1 border-b border-border sm:grid-cols-2 xl:grid-cols-4">
        {actions.map(action => {
          const Icon = action.icon
          return <button key={action.title} type="button" onClick={() => onNavigate?.(action.tab)} className="flex min-h-28 items-start gap-3 border-b border-border p-4 text-left last:border-b-0 hover:bg-surface-2/60 sm:border-b-0 sm:border-r sm:last:border-r-0"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-500/10 text-brand-400"><Icon className="h-4 w-4" /></span><span><span className="block text-sm font-semibold text-text-primary">{action.title}</span><span className="mt-1 block text-xs leading-5 text-text-muted">{action.description}</span></span></button>
        })}
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-1 border-b border-border lg:grid-cols-[minmax(0,1fr)_300px] lg:border-b-0">
        <div className="min-h-0 border-b border-border lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-border px-4 py-3"><h3 className="text-sm font-bold text-text-primary">最近流程运行</h3><button type="button" onClick={() => onNavigate?.('execution')} className="text-xs font-semibold text-brand-400 hover:text-brand-300">进入执行中心</button></div>
          {error ? <p role="alert" className="p-4 text-xs text-error">{error}</p> : loading ? <p className="p-4 text-xs text-text-muted">正在读取运行记录...</p> : runs.length === 0 ? <p className="p-4 text-xs text-text-muted">尚无流程运行记录。请先在用例设计中创建场景。</p> : <div>{runs.slice(0, 6).map(run => <div key={run.id} className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3 last:border-b-0"><div className="min-w-0"><p className="truncate text-xs font-semibold text-text-primary">{scenarioTitle.get(run.scenarioId) ?? '场景不可用'}</p><p className="mt-1 text-[11px] text-text-muted">{new Date(run.updatedAt).toLocaleString('zh-CN', { hour12: false })}</p></div><span className={`shrink-0 text-[11px] font-semibold ${statusTone(run.status)}`}>{RUN_LABEL[run.status]}</span></div>)}</div>}
        </div>
        <aside>
          <div className="flex items-center justify-between border-b border-border px-4 py-3"><h3 className="text-sm font-bold text-text-primary">待确认问题</h3><button type="button" onClick={() => onNavigate?.('issues')} className="text-xs font-semibold text-brand-400 hover:text-brand-300">查看全部</button></div>
          <div className="px-4 py-3"><p className="text-xs text-text-muted">当前有 <span className="font-semibold text-warning">{pendingCount}</span> 条失败断言等待测试人员确认。</p>{drafts.filter(item => item.status === 'pending_confirmation').slice(0, 4).map(draft => <button key={draft.id} type="button" onClick={() => onNavigate?.('issues')} className="mt-3 block w-full border-l-2 border-warning/60 pl-2 text-left text-xs text-text-secondary hover:text-text-primary"><span className="block truncate font-medium">{draft.title}</span><span className="mt-1 block text-[11px] text-text-muted">{new Date(draft.updatedAt).toLocaleString('zh-CN', { hour12: false })}</span></button>)}</div>
        </aside>
      </section>

      <footer className="flex items-center justify-between gap-3 pt-4 text-[11px] text-text-muted"><span className="flex items-center gap-2"><Route className="h-3.5 w-3.5" />浏览器连接、账号配置和模型设置仍可在系统设置中管理。</span><button type="button" onClick={() => onNavigate?.('settings')} className="shrink-0 font-semibold text-brand-400 hover:text-brand-300">打开系统设置</button></footer>
    </div>
  )
}

export default Dashboard
