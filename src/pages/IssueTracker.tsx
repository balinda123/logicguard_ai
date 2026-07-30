import { useEffect, useMemo, useState } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { Check, ChevronDown, Download, FileSpreadsheet, Search, X } from 'lucide-react'

import {
  listDefectDrafts,
  listFailureEvidence,
  listWorkflowScenarios,
  saveDefectDraft,
  updateDefectDraftStatus,
} from '../api/testingBridge'
import type { DefectDraft, DefectStatus, FailureEvidence, WorkflowScenario } from '../types/workflow'
import {
  downloadDefectCsv,
  downloadDefectWorkbook,
  safeEvidenceRelativePath,
} from '../utils/defectExport'

type AppStorage = { appDataDir: string }

const STATUS_LABEL: Record<DefectStatus, string> = {
  pending_confirmation: '待确认',
  pending_fix: '待修复',
  pending_validation: '待验证',
  closed: '已关闭',
  not_a_bug: '非缺陷',
}

const ROLE_LABEL: Record<DefectDraft['role'], string> = {
  employee: '员工',
  manager: '上级',
  hrbp: 'HRBP',
}

const ALLOWED_ACTIONS: Record<DefectStatus, Array<{ next: DefectStatus; label: string }>> = {
  pending_confirmation: [
    { next: 'pending_fix', label: '确认提交开发' },
    { next: 'not_a_bug', label: '标记非缺陷' },
  ],
  pending_fix: [{ next: 'pending_validation', label: '转待验证' }],
  pending_validation: [
    { next: 'closed', label: '关闭问题' },
    { next: 'pending_fix', label: '退回待修复' },
  ],
  closed: [],
  not_a_bug: [],
}

function statusClass(status: DefectStatus): string {
  if (status === 'pending_confirmation') return 'border-warning/35 bg-warning/10 text-warning'
  if (status === 'pending_fix') return 'border-error/30 bg-error/10 text-error'
  if (status === 'pending_validation') return 'border-brand-500/30 bg-brand-500/10 text-brand-400'
  if (status === 'closed') return 'border-success/30 bg-success/10 text-success'
  return 'border-border bg-surface-2 text-text-muted'
}

function safePreviewUrl(appDataDir: string, relativePath?: string): string | undefined {
  const safePath = safeEvidenceRelativePath(relativePath)
  if (!safePath || !appDataDir) return undefined
  const normalizedBase = appDataDir.replace(/[\\/]+$/, '')
  return convertFileSrc(`${normalizedBase}/${safePath}`)
}

function formatTime(value: string): string {
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString('zh-CN', { hour12: false })
}

export function IssueTracker() {
  const [drafts, setDrafts] = useState<DefectDraft[]>([])
  const [scenarios, setScenarios] = useState<WorkflowScenario[]>([])
  const [evidence, setEvidence] = useState<FailureEvidence[]>([])
  const [appDataDir, setAppDataDir] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | DefectStatus>('all')
  const [roleFilter, setRoleFilter] = useState<'all' | DefectDraft['role']>('all')
  const [keyword, setKeyword] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<DefectDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(() => drafts.find(item => item.id === selectedId) ?? null, [drafts, selectedId])
  const evidenceById = useMemo(() => new Map(evidence.map(item => [item.id, item])), [evidence])
  const scenarioById = useMemo(() => new Map(scenarios.map(item => [item.id, item.title])), [scenarios])

  const filteredDrafts = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    return drafts.filter(draft => {
      const matchesStatus = statusFilter === 'all' || draft.status === statusFilter
      const matchesRole = roleFilter === 'all' || draft.role === roleFilter
      const searchable = [draft.title, draft.expectedResult, draft.actualResult, draft.impact, ...draft.reproductionSteps].join(' ').toLowerCase()
      return matchesStatus && matchesRole && (!query || searchable.includes(query))
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [drafts, keyword, roleFilter, statusFilter])

  const load = async () => {
    setLoading(true)
    try {
      const [nextDrafts, nextEvidence, nextScenarios] = await Promise.all([
        listDefectDrafts(),
        listFailureEvidence(),
        listWorkflowScenarios(),
      ])
      setDrafts(nextDrafts)
      setEvidence(nextEvidence)
      setScenarios(nextScenarios)
      setError(null)
    } catch {
      setError('无法加载问题单，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    void invoke<AppStorage>('get_storage_locations').then(locations => setAppDataDir(locations.appDataDir)).catch(() => undefined)
  }, [])

  const openDraft = (draft: DefectDraft) => {
    setSelectedId(draft.id)
    setForm({ ...draft, reproductionSteps: [...draft.reproductionSteps] })
  }

  const updateForm = (patch: Partial<DefectDraft>) => setForm(current => current ? { ...current, ...patch } : current)

  const saveEdits = async (): Promise<DefectDraft | null> => {
    if (!form) return null
    const saved = await saveDefectDraft({
      id: form.id,
      scenarioId: form.scenarioId,
      runId: form.runId,
      evidenceId: form.evidenceId,
      status: form.status,
      title: form.title.trim(),
      reproductionSteps: form.reproductionSteps.map(item => item.trim()).filter(Boolean),
      expectedResult: form.expectedResult.trim(),
      actualResult: form.actualResult.trim(),
      impact: form.impact.trim(),
      role: form.role,
    })
    setDrafts(current => current.map(item => item.id === saved.id ? saved : item))
    setForm(saved)
    return saved
  }

  const applyAction = async (next: DefectStatus) => {
    if (!selected || !form) return
    setSaving(true)
    try {
      const saved = await saveEdits()
      if (!saved) return
      const updated = await updateDefectDraftStatus(saved.id, next)
      setDrafts(current => current.map(item => item.id === updated.id ? updated : item))
      setSelectedId(updated.id)
      setForm(updated)
      setError(null)
    } catch {
      setError('问题单更新失败，请刷新后重试。')
    } finally {
      setSaving(false)
    }
  }

  const exportItems = filteredDrafts.map(draft => ({
    draft,
    evidencePath: evidenceById.get(draft.evidenceId ?? '')?.screenshotPath,
  }))
  const selectedEvidence = selected ? evidenceById.get(selected.evidenceId ?? '') : undefined
  const previewUrl = safePreviewUrl(appDataDir, selectedEvidence?.screenshotPath)

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden p-6">
      <header className="flex shrink-0 flex-col gap-3 border-b border-border pb-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-lg font-bold text-text-primary">问题跟踪</h2>
          <p className="mt-1 text-xs text-text-muted">失败断言生成待确认问题单，确认后再交由开发修复。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => downloadDefectCsv(exportItems)} disabled={exportItems.length === 0} className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-semibold text-text-secondary hover:border-brand-500/40 hover:text-brand-400 disabled:cursor-not-allowed disabled:opacity-45"><Download className="h-3.5 w-3.5" />导出 CSV</button>
          <button type="button" onClick={() => downloadDefectWorkbook(exportItems)} disabled={exportItems.length === 0} className="flex h-8 items-center gap-1.5 rounded-md border border-brand-500/30 bg-brand-500/10 px-3 text-xs font-semibold text-brand-400 hover:bg-brand-500/15 disabled:cursor-not-allowed disabled:opacity-45"><FileSpreadsheet className="h-3.5 w-3.5" />导出 Excel</button>
        </div>
      </header>

      <section className="flex shrink-0 flex-wrap items-end gap-3 border-b border-border py-3">
        <label className="grid gap-1 text-[11px] text-text-muted">状态筛选<select aria-label="状态筛选" value={statusFilter} onChange={event => setStatusFilter(event.target.value as 'all' | DefectStatus)} className="h-8 min-w-28 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary"><option value="all">全部状态</option>{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="grid gap-1 text-[11px] text-text-muted">角色筛选<select aria-label="角色筛选" value={roleFilter} onChange={event => setRoleFilter(event.target.value as 'all' | DefectDraft['role'])} className="h-8 min-w-28 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary"><option value="all">全部角色</option>{Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="grid min-w-52 flex-1 gap-1 text-[11px] text-text-muted">关键词筛选<span className="relative"><Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-text-muted" /><input aria-label="关键词筛选" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索标题、复现步骤或结果" className="h-8 w-full rounded-md border border-border bg-surface-2 pl-7 pr-2 text-xs text-text-primary placeholder:text-text-muted" /></span></label>
      </section>

      {error && <div role="alert" className="mt-3 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</div>}
      <div className="mt-4 min-h-0 flex-1 overflow-auto border border-border">
        {loading ? <div className="flex h-48 items-center justify-center text-xs text-text-muted">正在加载问题单...</div> : filteredDrafts.length === 0 ? <div className="flex h-48 items-center justify-center text-xs text-text-muted">暂无符合条件的问题单。</div> : <table className="w-full min-w-[980px] table-fixed text-left text-xs"><thead className="sticky top-0 z-10 bg-surface-2 text-[11px] text-text-muted"><tr><th className="w-[20%] px-4 py-2 font-medium">问题标题</th><th className="w-[26%] px-3 py-2 font-medium">问题描述</th><th className="w-[10%] px-3 py-2 font-medium">测试角色</th><th className="w-[14%] px-3 py-2 font-medium">场景</th><th className="w-[10%] px-3 py-2 font-medium">状态</th><th className="w-[13%] px-3 py-2 font-medium">创建时间</th><th className="px-3 py-2 font-medium">操作</th></tr></thead><tbody>{filteredDrafts.map(draft => <tr key={draft.id} className="border-t border-border/70 align-top hover:bg-surface-2/40"><td className="px-4 py-3 font-medium text-text-primary">{draft.title}</td><td className="px-3 py-3 text-text-secondary"><details><summary className="cursor-pointer list-none text-brand-400"><span className="inline-flex items-center gap-1">复现与结果<ChevronDown className="h-3 w-3" /></span></summary><div className="mt-2 whitespace-pre-line text-[11px] leading-5">{draft.reproductionSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n预期：{draft.expectedResult}\n实际：{draft.actualResult}</div></details></td><td className="px-3 py-3 text-text-secondary">{ROLE_LABEL[draft.role]}</td><td className="truncate px-3 py-3 text-text-secondary" title={scenarioById.get(draft.scenarioId) ?? draft.scenarioId}>{scenarioById.get(draft.scenarioId) ?? '场景不可用'}</td><td className="px-3 py-3"><span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${statusClass(draft.status)}`}>{STATUS_LABEL[draft.status]}</span></td><td className="px-3 py-3 text-[11px] text-text-muted">{formatTime(draft.createdAt)}</td><td className="px-3 py-3"><button type="button" aria-label={`查看${draft.title}`} onClick={() => openDraft(draft)} className="text-xs font-semibold text-brand-400 hover:text-brand-300">查看</button></td></tr>)}</tbody></table>}
      </div>

      {selected && form && <div role="dialog" aria-label="问题详情" className="absolute inset-y-0 right-0 z-20 flex w-full max-w-xl flex-col border-l border-border bg-surface-1 shadow-xl"><header className="flex items-start justify-between border-b border-border px-5 py-4"><div><h3 className="text-sm font-bold text-text-primary">问题详情</h3><p className="mt-1 text-[11px] text-text-muted">{STATUS_LABEL[selected.status]} · {ROLE_LABEL[selected.role]}</p></div><button type="button" aria-label="关闭问题详情" onClick={() => { setSelectedId(null); setForm(null) }} className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text-primary"><X className="h-4 w-4" /></button></header><div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"><label className="grid gap-1 text-xs text-text-secondary">问题标题<input aria-label="问题标题" value={form.title} onChange={event => updateForm({ title: event.target.value })} className="h-9 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary" /></label><label className="grid gap-1 text-xs text-text-secondary">复现步骤<textarea aria-label="复现步骤" value={form.reproductionSteps.join('\n')} onChange={event => updateForm({ reproductionSteps: event.target.value.split('\n') })} rows={4} className="resize-y rounded-md border border-border bg-surface-2 p-2 text-xs leading-5 text-text-primary" /></label><label className="grid gap-1 text-xs text-text-secondary">预期结果<textarea aria-label="预期结果" value={form.expectedResult} onChange={event => updateForm({ expectedResult: event.target.value })} rows={2} className="resize-y rounded-md border border-border bg-surface-2 p-2 text-xs text-text-primary" /></label><label className="grid gap-1 text-xs text-text-secondary">实际结果<textarea aria-label="实际结果" value={form.actualResult} onChange={event => updateForm({ actualResult: event.target.value })} rows={2} className="resize-y rounded-md border border-border bg-surface-2 p-2 text-xs text-text-primary" /></label><label className="grid gap-1 text-xs text-text-secondary">影响范围<textarea aria-label="影响范围" value={form.impact} onChange={event => updateForm({ impact: event.target.value })} rows={2} className="resize-y rounded-md border border-border bg-surface-2 p-2 text-xs text-text-primary" /></label><section className="border-t border-border pt-4"><p className="text-xs font-semibold text-text-primary">失败证据</p>{previewUrl ? <div className="mt-2 overflow-hidden border border-border bg-surface-2"><a href={previewUrl} target="_blank" rel="noreferrer" className="block text-xs text-brand-400 hover:text-brand-300"><img src={previewUrl} alt="失败截图" className="max-h-52 w-full object-contain" /><span className="block border-t border-border px-2 py-2">打开失败截图</span></a></div> : <p className="mt-2 text-xs text-text-muted">证据不可用</p>}</section></div><footer className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{ALLOWED_ACTIONS[selected.status].map(action => <button key={action.next} type="button" disabled={saving} onClick={() => void applyAction(action.next)} className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold disabled:opacity-45 ${action.next === 'not_a_bug' ? 'border border-border text-text-secondary hover:text-text-primary' : 'bg-brand-500 text-white hover:bg-brand-600'}`}>{action.next === 'pending_fix' && <Check className="h-3.5 w-3.5" />}{action.label}</button>)}</footer></div>}
    </div>
  )
}

export default IssueTracker
