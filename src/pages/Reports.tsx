import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Clock, FileClock, ListChecks, Search } from 'lucide-react'

import { listWorkflowRunEvents, listWorkflowRuns, listWorkflowScenarios } from '../api/testingBridge'
import { scopedStorageKey } from '../api/auth'
import type { WorkflowRun, WorkflowRunEvent, WorkflowScenario } from '../types/workflow'

interface ReportsProps {
  onNavigate?: (tab: string) => void
}

interface LegacyResult {
  id: string
  testName?: string
  task?: string
  testStatus?: 'success' | 'failed' | 'pending'
  createdAt?: string
}

const STATUS_LABEL: Record<WorkflowRun['status'], string> = {
  queued: '待执行',
  running: '执行中',
  waiting_handoff: '等待交接',
  execution_blocked: '执行受阻',
  business_failed: '业务失败',
  passed: '通过',
  cancelled: '已取消',
}

function readLegacyResults(): LegacyResult[] {
  try {
    const raw = localStorage.getItem(scopedStorageKey('logicguard_test_results'))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is LegacyResult => Boolean(item) && typeof item === 'object' && typeof (item as LegacyResult).id === 'string') : []
  } catch {
    return []
  }
}

function displayTime(value?: string): string {
  if (!value) return '未记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

export function Reports({ onNavigate }: ReportsProps) {
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [scenarios, setScenarios] = useState<WorkflowScenario[]>([])
  const [legacyResults, setLegacyResults] = useState<LegacyResult[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [events, setEvents] = useState<WorkflowRunEvent[]>([])
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<'all' | WorkflowRun['status']>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const selectedRun = runs.find(item => item.id === selectedRunId) ?? null
  const scenarioTitle = useMemo(() => new Map(scenarios.map(item => [item.id, item.title])), [scenarios])
  const filteredRuns = useMemo(() => {
    const search = keyword.trim().toLowerCase()
    return runs.filter(run => {
      const title = scenarioTitle.get(run.scenarioId) ?? run.scenarioId
      return (status === 'all' || run.status === status) && (!search || `${title} ${run.id}`.toLowerCase().includes(search))
    })
  }, [keyword, runs, scenarioTitle, status])

  const load = async () => {
    setLoading(true)
    try {
      const [nextRuns, nextScenarios] = await Promise.all([listWorkflowRuns(), listWorkflowScenarios()])
      setRuns(nextRuns)
      setScenarios(nextScenarios)
      setLegacyResults(readLegacyResults())
      setSelectedRunId(current => current && nextRuns.some(item => item.id === current) ? current : null)
      setError(null)
    } catch {
      setError('无法加载真实流程执行历史，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!selectedRunId) {
      setEvents([])
      return
    }
    void listWorkflowRunEvents(selectedRunId).then(setEvents).catch(() => setEvents([]))
  }, [selectedRunId])

  if (selectedRun) {
    return <div className="flex h-full flex-1 flex-col overflow-hidden p-6"><header className="flex items-center justify-between border-b border-border pb-4"><div className="flex items-center gap-3"><button type="button" onClick={() => setSelectedRunId(null)} className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-text-secondary hover:text-text-primary"><ArrowLeft className="h-3.5 w-3.5" />返回历史</button><div><h2 className="text-sm font-bold text-text-primary">{scenarioTitle.get(selectedRun.scenarioId) ?? '场景不可用'}</h2><p className="mt-1 text-[11px] text-text-muted">运行编号：{selectedRun.id}</p></div></div><button type="button" onClick={() => onNavigate?.('execution')} className="flex h-8 items-center gap-1.5 rounded-md bg-brand-500 px-3 text-xs font-semibold text-white hover:bg-brand-600"><ListChecks className="h-3.5 w-3.5" />进入执行中心</button></header><section className="mt-4 grid grid-cols-1 border border-border md:grid-cols-3"><div className="border-b border-border p-4 md:border-b-0 md:border-r"><p className="text-[11px] text-text-muted">当前状态</p><p className="mt-1 text-sm font-semibold text-text-primary">{STATUS_LABEL[selectedRun.status]}</p></div><div className="border-b border-border p-4 md:border-b-0 md:border-r"><p className="text-[11px] text-text-muted">当前步骤</p><p className="mt-1 text-sm font-semibold text-text-primary">第 {selectedRun.currentStepIndex || 0} 步</p></div><div className="p-4"><p className="text-[11px] text-text-muted">更新时间</p><p className="mt-1 text-sm font-semibold text-text-primary">{displayTime(selectedRun.updatedAt)}</p></div></section><section className="mt-4 min-h-0 flex-1 overflow-y-auto border border-border"><div className="border-b border-border px-4 py-3"><h3 className="text-sm font-bold text-text-primary">执行记录</h3></div>{events.length === 0 ? <p className="p-4 text-xs text-text-muted">暂无语义化执行记录。</p> : events.map(event => <div key={event.id} className="border-b border-border/70 px-4 py-3 last:border-b-0"><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-text-primary">{event.message}</span><time className="shrink-0 text-[11px] text-text-muted">{displayTime(event.occurredAt)}</time></div><p className="mt-1 text-[11px] text-text-muted">{event.role ? `测试角色：${event.role === 'employee' ? '员工' : event.role === 'manager' ? '上级' : 'HRBP'} · ` : ''}{event.phase}</p></div>)}</section></div>
  }

  return <div className="flex h-full flex-1 flex-col overflow-hidden p-6"><header className="flex shrink-0 flex-col gap-3 border-b border-border pb-4 xl:flex-row xl:items-end xl:justify-between"><div><h2 className="text-lg font-bold text-text-primary">执行历史</h2><p className="mt-1 text-xs text-text-muted">展示流程运行和语义化执行记录；历史兼容数据仅供只读查看。</p></div><button type="button" onClick={() => onNavigate?.('execution')} className="flex h-8 items-center gap-1.5 rounded-md bg-brand-500 px-3 text-xs font-semibold text-white hover:bg-brand-600"><ListChecks className="h-3.5 w-3.5" />进入执行中心</button></header><section className="flex shrink-0 flex-wrap items-end gap-3 border-b border-border py-3"><label className="grid min-w-52 flex-1 gap-1 text-[11px] text-text-muted">搜索运行<span className="relative"><Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-text-muted" /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索场景或运行编号" className="h-8 w-full rounded-md border border-border bg-surface-2 pl-7 pr-2 text-xs text-text-primary" /></span></label><label className="grid gap-1 text-[11px] text-text-muted">状态<select aria-label="运行状态筛选" value={status} onChange={event => setStatus(event.target.value as 'all' | WorkflowRun['status'])} className="h-8 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary"><option value="all">全部状态</option>{Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></section>{error ? <p role="alert" className="mt-4 text-xs text-error">{error}</p> : loading ? <p className="mt-4 text-xs text-text-muted">正在读取执行历史...</p> : <><section className="mt-4 min-h-0 flex-1 overflow-auto border border-border"><table className="w-full min-w-[760px] table-fixed text-left text-xs"><thead className="sticky top-0 bg-surface-2 text-[11px] text-text-muted"><tr><th className="w-[35%] px-4 py-2 font-medium">场景</th><th className="w-[16%] px-3 py-2 font-medium">状态</th><th className="w-[15%] px-3 py-2 font-medium">进度</th><th className="w-[24%] px-3 py-2 font-medium">更新时间</th><th className="px-3 py-2 font-medium">操作</th></tr></thead><tbody>{filteredRuns.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-text-muted">暂无匹配的流程运行记录。</td></tr> : filteredRuns.map(run => <tr key={run.id} className="border-t border-border/70 hover:bg-surface-2/40"><td className="truncate px-4 py-3 font-medium text-text-primary">{scenarioTitle.get(run.scenarioId) ?? '场景不可用'}</td><td className="px-3 py-3 text-text-secondary">{STATUS_LABEL[run.status]}</td><td className="px-3 py-3 text-text-secondary">第 {run.currentStepIndex || 0} 步</td><td className="px-3 py-3 text-[11px] text-text-muted">{displayTime(run.updatedAt)}</td><td className="px-3 py-3"><button type="button" onClick={() => setSelectedRunId(run.id)} className="text-xs font-semibold text-brand-400 hover:text-brand-300">查看记录</button></td></tr>)}</tbody></table></section><section className="mt-4 border-t border-border pt-4"><div className="flex items-center gap-2"><FileClock className="h-4 w-4 text-text-muted" /><h3 className="text-sm font-bold text-text-primary">历史兼容记录（只读）</h3></div>{legacyResults.length === 0 ? <p className="mt-2 text-xs text-text-muted">没有旧版本地记录。</p> : <div className="mt-2 divide-y divide-border border border-border">{legacyResults.slice(0, 8).map(result => <div key={result.id} className="flex items-center justify-between gap-4 px-3 py-2 text-xs"><span className="truncate text-text-secondary">{result.testName ?? result.task ?? result.id}</span><span className="shrink-0 text-[11px] text-text-muted"><Clock className="mr-1 inline h-3 w-3" />{displayTime(result.createdAt)}</span></div>)}</div>}</section></>}</div>
}

export default Reports
