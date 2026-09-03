import { Eye, LockKeyhole, Pause, Play, Square, TerminalSquare, UnlockKeyhole } from 'lucide-react'
import { useState } from 'react'

import { focusRunBrowser } from '../api/runBridge'
import { runCurrentStep, runScope, RUN_STATUS_LABEL } from '../api/runPresentation'
import { useActiveRuns } from '../contexts/ActiveRunContext'

export function ActiveRunBar({ onOpenExecution }: { onOpenExecution: () => void }) {
  const { activeRuns, eventsByRun, pause, resume, terminate, setSelectedRunId } = useActiveRuns()
  const [busy, setBusy] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const run = activeRuns[0]
  if (!run) return null

  const scope = runScope(run)
  const total = run.executionPlan.commands.length
  const completed = Math.min(run.currentStep, total)
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0
  const canPause = run.status === 'running'
  const canResume = run.status === 'paused' || run.status === 'waiting_handoff'
  const canTerminate = ['queued', 'preflight', 'running', 'pause_requested', 'paused', 'waiting_handoff'].includes(run.status)
  const awaitingUser = run.status === 'paused' || run.status === 'waiting_handoff'

  const perform = async (key: string, operation: () => Promise<unknown>) => {
    setBusy(key)
    setNotice(undefined)
    try { await operation() } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '操作失败')
    } finally { setBusy(undefined) }
  }

  return <section aria-label="活动执行控制" className={`shrink-0 border px-4 py-3 shadow-md ${awaitingUser ? 'border-warning/70 bg-warning/15' : 'border-warning/40 bg-warning/10'}`}>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex min-w-52 items-center gap-2 text-warning">
        <span className="relative flex h-3 w-3">{!awaitingUser && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-50" />}<span className="relative inline-flex h-3 w-3 rounded-full bg-warning" /></span>
        <strong className="text-sm">{run.status === 'paused' ? '自动化已暂停' : run.status === 'waiting_handoff' ? '等待人工操作' : '自动化执行中'}</strong>
        <span className="rounded border border-warning/30 px-1.5 py-0.5 text-[10px] font-semibold">{RUN_STATUS_LABEL[run.status]}</span>
      </div>
      <div className="min-w-0 flex-1 text-xs text-text-secondary">
        <span className="font-semibold text-text-primary">{scope.systemName}</span> · {scope.environmentName} · {scope.suiteName}
        <span className="mx-2 text-border-hover">|</span>{runCurrentStep(run, eventsByRun[run.id] ?? [])}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-warning">{awaitingUser ? <UnlockKeyhole className="h-3.5 w-3.5" /> : <LockKeyhole className="h-3.5 w-3.5" />}{awaitingUser ? '浏览器已解除控制，可以手动操作' : '浏览器受控，暂停后才可手动操作'}</div>
      <div className="flex items-center gap-1.5">
        <button type="button" title="查看受控浏览器" aria-label="查看浏览器" onClick={() => void perform('focus', () => focusRunBrowser(run.id))} disabled={Boolean(busy)} className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-1 text-text-secondary hover:text-brand-400 disabled:opacity-40"><Eye className="h-3.5 w-3.5" /></button>
        <button type="button" title="查看测试运行" aria-label="查看测试运行" onClick={() => { setSelectedRunId(run.id); onOpenExecution() }} className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-1 text-text-secondary hover:text-brand-400"><TerminalSquare className="h-3.5 w-3.5" /></button>
        <button type="button" title="暂停执行" aria-label="暂停执行" onClick={() => void perform('pause', () => pause(run.id))} disabled={!canPause || Boolean(busy)} className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-1 text-text-secondary hover:text-warning disabled:opacity-35"><Pause className="h-3.5 w-3.5" /></button>
        <button type="button" title="继续执行" aria-label="继续执行" onClick={() => void perform('resume', () => resume(run.id))} disabled={!canResume || Boolean(busy)} className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-1 text-text-secondary hover:text-success disabled:opacity-35"><Play className="h-3.5 w-3.5" /></button>
        <button type="button" title="停止测试" aria-label="停止测试" onClick={() => void perform('terminate', () => terminate(run.id))} disabled={!canTerminate || Boolean(busy)} className="flex h-8 w-8 items-center justify-center rounded-md border border-error/30 bg-surface-1 text-error hover:bg-error/10 disabled:opacity-35"><Square className="h-3.5 w-3.5" /></button>
      </div>
    </div>
    <div className="mt-2 flex items-center gap-3"><div className="h-1.5 flex-1 overflow-hidden bg-surface-3"><div className="h-full bg-warning transition-[width]" style={{ width: `${progress}%` }} /></div><span className="w-16 text-right text-[10px] text-text-muted">{completed}/{total} · {progress}%</span></div>
    {notice && <p role="alert" className="mt-2 text-[11px] text-error">{notice}</p>}
  </section>
}
