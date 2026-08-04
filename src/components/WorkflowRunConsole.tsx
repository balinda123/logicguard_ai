import { AlertTriangle, CheckCircle2, Clock3, Pause, Play, Square, XCircle } from 'lucide-react'

import { eventMessage, runScope, RUN_STATUS_LABEL } from '../api/runPresentation'
import { isTerminalRun, useActiveRuns } from '../contexts/ActiveRunContext'

export function WorkflowRunConsole({ runId, onBackToDesign }: { runId?: string; onBackToDesign?: (designId: string) => void }) {
  const { runs, eventsByRun, pause, resume, terminate } = useActiveRuns()
  const run = runs.find((item) => item.id === runId)
  if (!run) return <section className="grid min-h-[360px] place-items-center border-l border-border bg-surface-1 p-6 text-center"><div><Clock3 className="mx-auto h-6 w-6 text-text-muted" /><p className="mt-3 text-xs text-text-muted">选择一条运行记录查看持久化事件</p></div></section>

  const scope = runScope(run)
  const events = eventsByRun[run.id] ?? []
  const canPause = run.status === 'running'
  const canResume = run.status === 'paused' || run.status === 'waiting_handoff'
  return <section className="flex min-h-[360px] flex-col border-l border-border bg-surface-1">
    <header className="border-b border-border px-4 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-bold text-text-primary">{scope.suiteName}</h3><p className="mt-1 text-[11px] text-text-muted">{scope.systemName} · {scope.environmentName} · {run.id.slice(0, 8)}</p></div><span className="shrink-0 rounded border border-border bg-surface-2 px-2 py-1 text-[10px] font-semibold text-text-secondary">{RUN_STATUS_LABEL[run.status]}</span></div>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void pause(run.id)} disabled={!canPause} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-text-secondary disabled:opacity-35"><Pause className="h-3 w-3" />暂停</button><button type="button" onClick={() => void resume(run.id)} disabled={!canResume} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-text-secondary disabled:opacity-35"><Play className="h-3 w-3" />继续</button><button type="button" onClick={() => void terminate(run.id)} disabled={isTerminalRun(run.status)} className="inline-flex h-7 items-center gap-1 rounded-md border border-error/30 px-2 text-[11px] text-error disabled:opacity-35"><Square className="h-3 w-3" />终止</button>{scope.designId && <button type="button" onClick={() => onBackToDesign?.(scope.designId)} className="ml-auto text-[11px] font-semibold text-brand-400">返回测试设计</button>}</div>
    </header>
    {run.status === 'business_failed' && <div className="m-4 flex items-center gap-2 border border-error/25 bg-error/10 p-3 text-xs text-error"><AlertTriangle className="h-4 w-4" />业务断言失败，可在问题跟踪中创建缺陷并查看业务截图。</div>}
    {run.status === 'passed' && <div className="mx-4 mt-4 flex items-center gap-2 border border-success/25 bg-success/10 px-3 py-2 text-xs text-success"><CheckCircle2 className="h-4 w-4" />运行通过</div>}
    {['blocked', 'cancelled', 'interrupted'].includes(run.status) && <div className="mx-4 mt-4 flex items-start gap-2 border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning"><XCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>这是执行诊断，不会创建业务问题。{run.errorMessage ? ` ${run.errorMessage}` : ''}</span></div>}
    <ol className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{events.length === 0 ? <li className="py-8 text-center text-xs text-text-muted">暂无事件，重新进入页面后会按运行编号恢复。</li> : events.map((event) => <li key={event.sequence} className="border-l border-border py-2 pl-4 text-xs text-text-secondary"><div className="flex items-center justify-between gap-2"><span className="font-medium text-text-primary">{eventMessage(event)}</span><time className="shrink-0 text-[10px] text-text-muted">{new Date(event.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}</time></div><p className="mt-1 text-[10px] text-text-muted">#{event.sequence} · {event.kind}</p></li>)}</ol>
  </section>
}

export default WorkflowRunConsole
