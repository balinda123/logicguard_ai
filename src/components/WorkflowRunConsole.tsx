import { AlertTriangle, Check, CheckCircle2, Circle, Clock3, ListChecks, LoaderCircle, Pause, Play, Square, Trash2, XCircle } from 'lucide-react'

import { eventMessage, planStepDetails, planStepLabel, runScope, RUN_STATUS_LABEL } from '../api/runPresentation'
import { isTerminalRun, useActiveRuns } from '../contexts/ActiveRunContext'
import type { ExecutionRun, ExecutionRunEvent } from '../types/execution'
import { formatChinaTime } from '../utils/dateTime'

function eventDetail(event: ExecutionRunEvent): string | undefined {
  const detail = Object.fromEntries(Object.entries(event.data).filter(([key]) => key !== 'message' && key !== 'error'))
  return Object.keys(detail).length > 0 ? JSON.stringify(detail) : undefined
}

function stepState(index: number, currentStep: number, status: ExecutionRun['status']): 'done' | 'active' | 'paused' | 'stopped' | 'pending' {
  if (status === 'passed' || index < currentStep) return 'done'
  if ((status === 'paused' || status === 'waiting_handoff') && index === currentStep) return 'paused'
  if (isTerminalRun(status) && index === currentStep) return 'stopped'
  if (index === currentStep) return 'active'
  return 'pending'
}

function runErrorText(message?: string): string {
  if (!message) return '测试未能继续，请展开技术详情查看原因。'
  if (/Terminated by user/i.test(message)) return '你已停止本次测试。'
  if (/LOGIN_STATE_UNCERTAIN/i.test(message)) return '无法确认当前登录账号，需要人工确认后继续。'
  if (/ORIGIN_NOT_ALLOWED/i.test(message)) {
    const origin = message.match(/ORIGIN_NOT_ALLOWED:\s*(https?:\/\/[^\s/]+)/i)?.[1]
    return origin
      ? `当前页面跳到了未配置的登录域名 ${origin}。请在系统环境中添加该“可信登录域名”后重新执行。`
      : '当前页面跳到了未配置的登录域名。请在系统环境中添加“可信登录域名”后重新执行。'
  }
  if (/AGENT_FAILED|ACT_FAILED/i.test(message)) return 'AI 没有完成当前页面操作，请检查页面状态后重试。'
  if (/POST_ACTION_UNRESOLVED/i.test(message)) return '提交后仍有确认窗口未完成，测试已停止以避免误操作。'
  return message
}

export function WorkflowRunConsole({ runId, onBackToDesign }: { runId?: string; onBackToDesign?: (designId: string) => void }) {
  const { runs, eventsByRun, pause, resume, terminate, remove } = useActiveRuns()
  const run = runs.find((item) => item.id === runId)
  if (!run) return <section className="grid min-h-[360px] place-items-center border-l border-border bg-surface-1 p-6 text-center"><div><Clock3 className="mx-auto h-6 w-6 text-text-muted" /><p className="mt-3 text-xs text-text-muted">选择一条运行记录查看实时执行日志</p></div></section>

  const scope = runScope(run)
  const events = eventsByRun[run.id] ?? []
  const canPause = run.status === 'running'
  const canResume = run.status === 'paused' || run.status === 'waiting_handoff'
  return <section className="flex h-full min-h-[360px] flex-col overflow-hidden border-l border-border bg-surface-1">
    <header className="shrink-0 border-b border-border px-4 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-bold text-text-primary">{scope.suiteName}</h3><p className="mt-1 text-[11px] text-text-muted">{scope.systemName} · {scope.environmentName} · {run.id.slice(0, 8)}</p></div><span className="shrink-0 rounded border border-border bg-surface-2 px-2 py-1 text-[10px] font-semibold text-text-secondary">{RUN_STATUS_LABEL[run.status]}</span></div>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void pause(run.id)} disabled={!canPause} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-text-secondary disabled:opacity-35"><Pause className="h-3 w-3" />暂停测试</button><button type="button" onClick={() => void resume(run.id)} disabled={!canResume} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-text-secondary disabled:opacity-35"><Play className="h-3 w-3" />继续测试</button><button type="button" onClick={() => void terminate(run.id)} disabled={isTerminalRun(run.status)} className="inline-flex h-7 items-center gap-1 rounded-md border border-error/30 px-2 text-[11px] text-error disabled:opacity-35"><Square className="h-3 w-3" />停止测试</button><button type="button" onClick={() => { if (window.confirm('确认删除这条测试运行记录及其日志？')) void remove(run.id) }} disabled={!isTerminalRun(run.status)} className="inline-flex h-7 items-center gap-1 rounded-md border border-error/30 px-2 text-[11px] text-error disabled:opacity-35"><Trash2 className="h-3 w-3" />删除记录</button>{scope.designId && <button type="button" onClick={() => onBackToDesign?.(scope.designId)} className="ml-auto text-[11px] font-semibold text-brand-400">返回设计测试</button>}</div>
    </header>
    {run.status === 'business_failed' && <div className="m-4 flex items-center gap-2 border border-error/25 bg-error/10 p-3 text-xs text-error"><AlertTriangle className="h-4 w-4" />业务断言失败，已自动在问题跟踪中创建待确认问题单。</div>}
    {run.status === 'passed' && <div className="mx-4 mt-4 flex items-center gap-2 border border-success/25 bg-success/10 px-3 py-2 text-xs text-success"><CheckCircle2 className="h-4 w-4" />测试通过</div>}
    {run.status === 'paused' && <div role="status" className="mx-4 mt-4 flex items-start gap-2 border-2 border-warning/50 bg-warning/15 px-3 py-3 text-xs font-semibold text-warning"><Pause className="mt-0.5 h-4 w-4 shrink-0" /><span>测试已暂停，当前步骤不会继续执行。浏览器控制已经释放，你可以手动检查页面；准备好后点击“继续测试”。</span></div>}
    {run.status === 'waiting_handoff' && <div role="alert" className="mx-4 mt-4 flex items-start gap-2 border-2 border-warning/50 bg-warning/15 px-3 py-3 text-xs font-semibold text-warning"><Clock3 className="mt-0.5 h-4 w-4 shrink-0" /><span>正在等待你完成登录或页面确认，当前步骤不会继续执行。完成后点击“继续测试”。</span></div>}
    {['blocked', 'cancelled', 'interrupted'].includes(run.status) && <div className="mx-4 mt-4 flex items-start gap-2 border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning"><XCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{runErrorText(run.errorMessage)}</span></div>}
    <div className="mx-4 mt-4 shrink-0 rounded-md border border-border bg-surface-2/40 p-3">
      <h4 className="flex items-center gap-2 text-xs font-bold text-text-primary"><ListChecks className="h-4 w-4 text-brand-400" />执行步骤</h4>
      <ol aria-label="执行步骤" className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">{run.executionPlan.commands.map((command, index) => {
        const state = stepState(index, run.currentStep, run.status)
        const details = planStepDetails(command)
        return <li key={index} className={`flex items-start gap-2 rounded border px-2.5 py-2 text-[11px] ${state === 'active' ? 'border-brand-500/40 bg-brand-500/10 text-text-primary' : state === 'paused' ? 'border-warning/50 bg-warning/15 text-text-primary' : state === 'stopped' ? 'border-warning/40 bg-warning/10 text-text-secondary' : 'border-border/70 text-text-secondary'}`}>
          {state === 'done' ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> : state === 'active' ? <LoaderCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-brand-400" /> : state === 'paused' ? <Pause className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> : state === 'stopped' ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />}
          <div className="min-w-0"><div><strong className="mr-1">{index + 1}.</strong>{planStepLabel(command, index)}</div>{details.length > 0 && <ul className="mt-1.5 space-y-1 border-l border-border pl-2 text-[10px] leading-4 text-text-muted">{details.map((detail, detailIndex) => <li key={detailIndex}>{detailIndex + 1}. {detail}</li>)}</ul>}</div>
        </li>
      })}</ol>
    </div>
    <div aria-label="实时执行日志" className="m-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-surface-1">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs font-semibold text-text-primary"><Clock3 className="h-3.5 w-3.5 text-brand-400" />实时执行动态<span className="ml-auto text-[10px] font-normal text-text-muted">北京时间</span></div>
      <ol className="min-h-0 flex-1 overflow-y-auto px-3 py-2">{events.length === 0 ? <li className="py-8 text-center text-xs text-text-muted">正在准备，很快会显示执行过程</li> : events.map((event) => {
        const detail = eventDetail(event)
        return <li key={event.sequence} className="border-l-2 border-brand-500/25 py-2 pl-3 text-[11px]"><div className="flex items-start justify-between gap-2"><span className="font-medium text-text-primary">{eventMessage(event)}</span><time className="shrink-0 text-[10px] text-text-muted">{formatChinaTime(event.createdAt)}</time></div>{detail && <details className="mt-1 text-[10px] text-text-muted"><summary className="cursor-pointer select-none hover:text-brand-400">查看技术详情</summary><pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-2 p-2 font-mono leading-4">{detail}</pre></details>}</li>
      })}</ol>
    </div>
  </section>
}

export default WorkflowRunConsole
