import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, Loader2, PauseCircle, XCircle } from 'lucide-react'

import type { DefectDraft, FailureEvidence, WorkflowRun, WorkflowRunEvent, WorkflowScenario } from '../types/workflow'

interface WorkflowRunConsoleProps {
  run: WorkflowRun | null
  scenario?: WorkflowScenario
  events: WorkflowRunEvent[]
  evidence?: FailureEvidence
  defect?: DefectDraft
  busy?: boolean
  onResume: () => void
  onCancel: () => void
}

const ROLE_LABEL = {
  employee: '员工',
  manager: '上级',
  hrbp: 'HRBP',
} as const

const STATUS_LABEL: Record<WorkflowRun['status'], string> = {
  queued: '待开始',
  running: '执行中',
  waiting_handoff: '等待交接',
  execution_blocked: '执行被阻断',
  business_failed: '业务失败',
  passed: '通过',
  cancelled: '已取消',
}

function statusStyle(status: WorkflowRun['status']): string {
  if (status === 'passed') return 'border-success/25 bg-success/10 text-success'
  if (status === 'business_failed' || status === 'execution_blocked') return 'border-error/25 bg-error/10 text-error'
  if (status === 'waiting_handoff') return 'border-warning/25 bg-warning/10 text-warning'
  if (status === 'running') return 'border-brand-500/25 bg-brand-500/10 text-brand-400'
  return 'border-border bg-surface-2 text-text-muted'
}

export function WorkflowRunConsole({
  run,
  scenario,
  events,
  evidence,
  defect,
  busy = false,
  onResume,
  onCancel,
}: WorkflowRunConsoleProps) {
  if (!run) {
    return (
      <section className="flex min-h-[360px] flex-col items-center justify-center border-l border-border bg-surface-1 p-6 text-center">
        <Clock3 className="h-6 w-6 text-text-muted" />
        <p className="mt-3 text-xs text-text-muted">选择一条运行记录查看流程时间线</p>
      </section>
    )
  }

  return (
    <section className="flex min-h-[360px] flex-col border-l border-border bg-surface-1">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-text-primary">{scenario?.title ?? '流程运行'}</h3>
          <p className="mt-1 text-[11px] text-text-muted">第 {run.currentStepIndex || 0} 步</p>
        </div>
        <span className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold ${statusStyle(run.status)}`}>
          {STATUS_LABEL[run.status]}
        </span>
      </div>

      {run.status === 'waiting_handoff' && (
        <div className="m-4 flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/10 p-3 text-xs text-warning">
          <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">请在浏览器完成 SSO/验证码后继续</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={onResume} disabled={busy} className="h-7 rounded-md bg-warning px-2.5 text-[11px] font-semibold text-surface-0 disabled:opacity-50">
                {busy ? '处理中' : '继续流程'}
              </button>
              <button type="button" onClick={onCancel} disabled={busy} className="h-7 rounded-md border border-warning/30 px-2.5 text-[11px] font-semibold text-warning disabled:opacity-50">
                取消流程
              </button>
            </div>
          </div>
        </div>
      )}

      {run.status === 'running' && (
        <div className="mx-4 mt-4 flex items-center gap-2 rounded-lg border border-brand-500/20 bg-brand-500/5 px-3 py-2 text-[11px] text-brand-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在执行当前步骤
          <button type="button" onClick={onCancel} disabled={busy} className="ml-auto text-text-muted hover:text-error">取消流程</button>
        </div>
      )}

      {run.status === 'business_failed' && (
        <div className="m-4 rounded-lg border border-error/25 bg-error/10 p-3 text-xs text-error">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />已生成待确认问题草稿</div>
          {defect && <p className="mt-1 truncate text-[11px]">{defect.title}</p>}
          {evidence?.screenshotPath && <button type="button" className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold hover:underline" title="失败截图已保存，可在问题单中查看"><ExternalLink className="h-3 w-3" />查看失败截图</button>}
        </div>
      )}

      {run.status === 'passed' && (
        <div className="mx-4 mt-4 flex items-center gap-2 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-[11px] text-success"><CheckCircle2 className="h-4 w-4" />流程已通过</div>
      )}
      {run.status === 'execution_blocked' && (
        <div className="mx-4 mt-4 flex items-center gap-2 rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-[11px] text-error"><XCircle className="h-4 w-4" />执行被阻断，请检查浏览器连接</div>
      )}

      <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {events.length === 0 ? (
          <li className="py-8 text-center text-xs text-text-muted">暂无语义执行记录</li>
        ) : events.map((event) => (
          <li key={event.id} className="relative border-l border-border pl-4 text-xs text-text-secondary">
            <span className="absolute -left-1.5 top-1 h-3 w-3 rounded-full border border-brand-500/40 bg-surface-1" />
            <div className="flex items-center gap-2 text-[10px] text-text-muted">
              <span>{new Date(event.occurredAt).toLocaleTimeString()}</span>
              {event.role && <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5">{ROLE_LABEL[event.role]}</span>}
            </div>
            <p className="mt-1 leading-relaxed">{event.message}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default WorkflowRunConsole
