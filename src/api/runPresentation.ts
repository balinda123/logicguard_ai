import type { ExecutionRun, ExecutionRunEvent, ExecutionRunStatus } from '../types/execution'

export interface RunScopePresentation {
  systemId: string
  systemName: string
  environmentId: string
  environmentName: string
  designId: string
  designTitle: string
  suiteName: string
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

export function runScope(run: ExecutionRun): RunScopePresentation {
  const snapshot = run.snapshot
  return {
    systemId: text(snapshot.systemId, 'legacy'),
    systemName: text(snapshot.systemName, '历史未归属'),
    environmentId: text(snapshot.environmentId, 'legacy'),
    environmentName: text(snapshot.environmentName, '未标记环境'),
    designId: text(snapshot.designId),
    designTitle: text(snapshot.designTitle, '未命名测试设计'),
    suiteName: text(snapshot.suiteName, text(snapshot.designTitle, '回归套件')),
  }
}

export function runCurrentStep(run: ExecutionRun, events: readonly ExecutionRunEvent[]): string {
  const latest = [...events].reverse().find((event) => {
    const message = event.data.message
    return typeof message === 'string' && message.trim()
  })
  return latest ? String(latest.data.message) : `第 ${run.currentStep + 1} 步`
}

export const RUN_STATUS_LABEL: Record<ExecutionRunStatus, string> = {
  queued: '排队中',
  preflight: '执行前检查',
  running: '执行中',
  pause_requested: '正在暂停',
  paused: '已暂停',
  waiting_handoff: '等待人工接管',
  passed: '通过',
  business_failed: '业务失败',
  blocked: '执行受阻',
  cancelled: '已终止',
  interrupted: '异常中断',
}

export function eventMessage(event: ExecutionRunEvent): string {
  return text(event.data.message, text(event.data.error, event.kind))
}
