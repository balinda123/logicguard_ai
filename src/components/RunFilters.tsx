import type { ExecutionRunStatus } from '../types/execution'
import { RUN_STATUS_LABEL } from '../api/runPresentation'

export interface RunFilterValue {
  systemId: string
  environmentId: string
  status: 'all' | ExecutionRunStatus
  time: 'all' | 'today' | 'week' | 'month'
}

interface Option { id: string; name: string }

export function RunFilters({ value, systems, environments, onChange }: {
  value: RunFilterValue
  systems: Option[]
  environments: Option[]
  onChange: (value: RunFilterValue) => void
}) {
  const field = 'h-8 min-w-32 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary'
  return <div className="flex flex-wrap items-end gap-3 border-b border-border py-3">
    <label className="grid gap-1 text-[11px] text-text-muted">系统<select aria-label="系统筛选" value={value.systemId} onChange={(event) => onChange({ ...value, systemId: event.target.value, environmentId: 'all' })} className={field}><option value="all">全部系统</option>{systems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label className="grid gap-1 text-[11px] text-text-muted">环境<select aria-label="环境筛选" value={value.environmentId} onChange={(event) => onChange({ ...value, environmentId: event.target.value })} className={field}><option value="all">全部环境</option>{environments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label className="grid gap-1 text-[11px] text-text-muted">状态<select aria-label="状态筛选" value={value.status} onChange={(event) => onChange({ ...value, status: event.target.value as RunFilterValue['status'] })} className={field}><option value="all">全部状态</option>{Object.entries(RUN_STATUS_LABEL).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>
    <label className="grid gap-1 text-[11px] text-text-muted">时间<select aria-label="时间筛选" value={value.time} onChange={(event) => onChange({ ...value, time: event.target.value as RunFilterValue['time'] })} className={field}><option value="all">全部时间</option><option value="today">今天</option><option value="week">近 7 天</option><option value="month">近 30 天</option></select></label>
  </div>
}

// eslint-disable-next-line react-refresh/only-export-components -- colocated pure filter contract
export function matchesRunFilters(run: { status: ExecutionRunStatus; createdAt: string }, scope: { systemId: string; environmentId: string }, filters: RunFilterValue): boolean {
  if (filters.systemId !== 'all' && scope.systemId !== filters.systemId) return false
  if (filters.environmentId !== 'all' && scope.environmentId !== filters.environmentId) return false
  if (filters.status !== 'all' && run.status !== filters.status) return false
  if (filters.time === 'all') return true
  const age = Date.now() - new Date(run.createdAt).getTime()
  const limit = filters.time === 'today' ? 86_400_000 : filters.time === 'week' ? 604_800_000 : 2_592_000_000
  return Number.isFinite(age) && age <= limit
}
