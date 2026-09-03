import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, Pencil, Plus, Power, Trash2, X } from 'lucide-react'

import {
  createSystem,
  createSystemEnvironment,
  deleteSystem,
  deleteSystemEnvironment,
  listSystemEnvironments,
  listSystems,
  updateSystem,
  updateSystemEnvironment,
} from '../api/testDesignBridge'
import type { EnvironmentKind, SystemEnvironment, TestSystem } from '../types/testDesign'
import { handoffOriginInput, isHttpUrl, normalizeHandoffOriginInput, parseHandoffOrigins } from '../utils/loginEnvironment'

type EnvironmentDraft = {
  kind: EnvironmentKind
  name: string
  baseUrl: string
  loginUrl: string
  handoffOrigins: string
}

const blankEnvironment = (): EnvironmentDraft => ({ kind: 'test', name: '', baseUrl: '', loginUrl: '', handoffOrigins: '' })

const environmentDraft = (environment: SystemEnvironment): EnvironmentDraft => ({
  kind: environment.kind,
  name: environment.name,
  baseUrl: environment.baseUrl,
  loginUrl: environment.loginUrl,
  handoffOrigins: handoffOriginInput(environment.handoffOrigins),
})

function errorMessage(error: unknown): string {
  const value = String(error)
  if (value.includes('SYSTEM_IN_USE')) return '该系统已有测试设计，不能删除。请先在设计测试中处理相关设计。'
  if (value.includes('ENVIRONMENT_IN_USE')) return '该环境已有测试设计，不能删除。请先在设计测试中处理相关设计。'
  if (value.includes('HTTPS_REQUIRED')) return '测试环境地址必须使用 HTTPS；本地地址可使用 localhost。'
  if (value.includes('INVALID_BASE_URL')) return '请输入有效的本地或测试环境地址。'
  if (value.includes('INVALID_LOGIN_URL')) return '请输入有效的 http(s) 登录地址。'
  if (value.includes('INVALID_HANDOFF_ORIGIN')) return '可信登录域名格式不正确，请一行填写一个域名。'
  return `操作失败：${value.replace(/^Error:\s*/, '')}`
}

export function SystemEnvironmentManager() {
  const [systems, setSystems] = useState<TestSystem[]>([])
  const [environments, setEnvironments] = useState<Record<string, SystemEnvironment[]>>({})
  const [newSystemName, setNewSystemName] = useState('')
  const [expandedSystemId, setExpandedSystemId] = useState<string | null>(null)
  const [editingSystem, setEditingSystem] = useState<{ id: string; name: string } | null>(null)
  const [creatingEnvironmentFor, setCreatingEnvironmentFor] = useState<string | null>(null)
  const [newEnvironment, setNewEnvironment] = useState<EnvironmentDraft>(blankEnvironment)
  const [editingEnvironment, setEditingEnvironment] = useState<{ id: string; systemId: string; value: EnvironmentDraft } | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    const nextSystems = await listSystems()
    setSystems(nextSystems)
    setExpandedSystemId((current) => current && nextSystems.some((system) => system.id === current)
      ? current
      : nextSystems[0]?.id ?? null)
    const nextEnvironments: Record<string, SystemEnvironment[]> = {}
    const failedSystemIds = new Set<string>()
    const failures: string[] = []
    for (const system of nextSystems) {
      try {
        nextEnvironments[system.id] = await listSystemEnvironments(system.id)
      } catch (error) {
        failedSystemIds.add(system.id)
        failures.push(`${system.name}：${String(error).replace(/^Error:\s*/, '')}`)
      }
    }
    // 单个系统加载失败时只保留该系统的旧数据，成功系统仍刷新，且不会让 refresh 依赖 environments 形成循环。
    setEnvironments((current) => Object.fromEntries(nextSystems.map((system) => [
      system.id,
      failedSystemIds.has(system.id) ? current[system.id] ?? [] : nextEnvironments[system.id] ?? [],
    ])))
    if (failures.length > 0) throw new Error(`部分环境加载失败（${failures.join('；')}）`)
  }, [])

  useEffect(() => {
    void refresh().catch((error) => setNotice(`列表加载失败：${String(error).replace(/^Error:\s*/, '')}`))
  }, [refresh])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setNotice('')
    try {
      await action()
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const addSystem = () => void run(async () => {
    const name = newSystemName.trim()
    if (!name) return
    const created = await createSystem(name)
    setNewSystemName('')
    setExpandedSystemId(created.id)
    await refresh()
  })

  const saveSystem = () => void run(async () => {
    if (!editingSystem?.name.trim()) return
    await updateSystem({ id: editingSystem.id, name: editingSystem.name.trim() })
    setEditingSystem(null)
    await refresh()
  })

  const removeSystem = (system: TestSystem) => void run(async () => {
    if (!window.confirm(`确认删除“${system.name}”及其未使用的环境吗？`)) return
    await deleteSystem({ id: system.id })
    if (expandedSystemId === system.id) setExpandedSystemId(null)
    await refresh()
  })

  const addEnvironment = (systemId: string) => void run(async () => {
    if (!newEnvironment.name.trim() || !newEnvironment.baseUrl.trim() || !isHttpUrl(newEnvironment.loginUrl)) return
    const parsedOrigins = parseHandoffOrigins(newEnvironment.handoffOrigins)
    if (parsedOrigins.invalid) throw new Error(`INVALID_HANDOFF_ORIGIN: ${parsedOrigins.invalid}`)
    await createSystemEnvironment({
      systemId,
      kind: newEnvironment.kind,
      name: newEnvironment.name.trim(),
      baseUrl: newEnvironment.baseUrl.trim(),
      loginUrl: newEnvironment.loginUrl.trim(),
      handoffOrigins: parsedOrigins.origins,
    })
    setCreatingEnvironmentFor(null)
    setNewEnvironment(blankEnvironment())
    await refresh()
  })

  const saveEnvironment = () => void run(async () => {
    if (!editingEnvironment?.value.name.trim() || !editingEnvironment.value.baseUrl.trim() || !isHttpUrl(editingEnvironment.value.loginUrl)) return
    const parsedOrigins = parseHandoffOrigins(editingEnvironment.value.handoffOrigins)
    if (parsedOrigins.invalid) throw new Error(`INVALID_HANDOFF_ORIGIN: ${parsedOrigins.invalid}`)
    const updated = await updateSystemEnvironment({
      id: editingEnvironment.id,
      systemId: editingEnvironment.systemId,
      kind: editingEnvironment.value.kind,
      name: editingEnvironment.value.name.trim(),
      baseUrl: editingEnvironment.value.baseUrl.trim(),
      loginUrl: editingEnvironment.value.loginUrl.trim(),
      handoffOrigins: parsedOrigins.origins,
      isEnabled: environments[editingEnvironment.systemId]?.find((item) => item.id === editingEnvironment.id)?.isEnabled ?? true,
    })
    setEnvironments((current) => ({
      ...current,
      [updated.systemId]: (current[updated.systemId] ?? []).map((item) => item.id === updated.id ? updated : item),
    }))
    setEditingEnvironment(null)
    try {
      await refresh()
    } catch (error) {
      setNotice(`地址已保存，但列表重新加载失败：${String(error).replace(/^Error:\s*/, '')}`)
    }
  })

  const toggleEnvironment = (environment: SystemEnvironment) => void run(async () => {
    await updateSystemEnvironment({
      id: environment.id,
      systemId: environment.systemId,
      kind: environment.kind,
      name: environment.name,
      baseUrl: environment.baseUrl,
      loginUrl: environment.loginUrl,
      handoffOrigins: environment.handoffOrigins,
      isEnabled: !environment.isEnabled,
    })
    await refresh()
  })

  const removeEnvironment = (environment: SystemEnvironment) => void run(async () => {
    if (!window.confirm(`确认删除环境“${environment.name}”吗？`)) return
    await deleteSystemEnvironment({ id: environment.id })
    await refresh()
  })

  return (
    <section aria-labelledby="system-management-title" className="col-span-full space-y-4 border-t border-border pt-5">
      <div>
        <h3 id="system-management-title" className="text-sm font-bold text-text-primary">被测系统与环境</h3>
        <p className="mt-1 text-[11px] text-text-muted">在这里维护全部被测系统和可用环境。测试设计正在使用的系统或环境不能删除。</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input aria-label="新系统名称" value={newSystemName} onChange={(event) => setNewSystemName(event.target.value)} placeholder="输入系统名称" className="h-9 min-w-56 flex-1 rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none" />
        <button type="button" disabled={busy || !newSystemName.trim()} onClick={addSystem} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-xs font-semibold text-white disabled:opacity-45"><Plus className="h-3.5 w-3.5" />新增系统</button>
      </div>

      {notice && <div role="alert" className="border border-warning/35 bg-warning/10 px-3 py-2 text-xs text-warning">{notice}</div>}

      <div className="overflow-hidden border border-border">
        <div className="grid grid-cols-[minmax(0,1fr)_150px_140px] gap-3 border-b border-border bg-surface-2 px-3 py-2 text-[11px] text-text-muted">
          <span>系统名称</span><span>环境数量</span><span className="text-right">操作</span>
        </div>
        {systems.length === 0 ? <div className="px-3 py-8 text-center text-xs text-text-muted">还没有系统，先新增一个系统。</div> : systems.map((system) => {
          const isExpanded = expandedSystemId === system.id
          const systemEnvironments = environments[system.id] ?? []
          const isEditing = editingSystem?.id === system.id
          return <div key={system.id} className="border-b border-border last:border-b-0">
            <div className="grid grid-cols-[minmax(0,1fr)_150px_140px] items-center gap-3 px-3 py-3 text-xs">
              {isEditing ? <div className="flex min-w-0 items-center gap-2"><input aria-label={`编辑系统 ${system.name}`} value={editingSystem.name} onChange={(event) => setEditingSystem({ ...editingSystem, name: event.target.value })} className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary" /><button type="button" aria-label={`保存系统 ${system.name}`} disabled={busy || !editingSystem.name.trim()} onClick={saveSystem} className="rounded p-1 text-success disabled:opacity-40"><Check className="h-4 w-4" /></button><button type="button" aria-label="取消编辑系统" onClick={() => setEditingSystem(null)} className="rounded p-1 text-text-muted"><X className="h-4 w-4" /></button></div> : <button type="button" onClick={() => setExpandedSystemId(isExpanded ? null : system.id)} className="flex min-w-0 items-center gap-2 text-left font-semibold text-text-primary"><ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`} /><span className="truncate">{system.name}</span></button>}
              <button type="button" aria-label={`${isExpanded ? '收起' : '查看'}${system.name}的环境配置`} onClick={() => setExpandedSystemId(isExpanded ? null : system.id)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border px-2 text-[11px] font-semibold text-brand-400 hover:border-brand-500/40 hover:bg-brand-500/5"><span>{systemEnvironments.length} 个环境</span><ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? '' : '-rotate-90'}`} /></button>
              <div className="flex justify-end gap-1"><button type="button" title="编辑系统名称" aria-label={`编辑系统 ${system.name}`} disabled={busy || isEditing} onClick={() => { setExpandedSystemId(system.id); setEditingSystem({ id: system.id, name: system.name }) }} className="rounded border border-border p-1.5 text-brand-400 disabled:opacity-40"><Pencil className="h-3.5 w-3.5" /></button><button type="button" title="删除系统" aria-label={`删除系统 ${system.name}`} disabled={busy} onClick={() => removeSystem(system)} className="rounded border border-error/30 p-1.5 text-error disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button></div>
            </div>
            {isExpanded && <div className="border-t border-border bg-surface-1 px-3 py-3">
              <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold text-text-secondary">环境</p><button type="button" onClick={() => { setCreatingEnvironmentFor(system.id); setNewEnvironment(blankEnvironment()) }} disabled={busy} className="inline-flex h-7 items-center gap-1 rounded-md border border-brand-500/30 px-2 text-[11px] font-semibold text-brand-400 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />新增环境</button></div>
              {creatingEnvironmentFor === system.id && <div className="mb-3 space-y-2 border border-brand-500/25 bg-brand-500/5 p-3">
                <div className="grid gap-2 lg:grid-cols-[120px_1fr_1.5fr_auto]"><select aria-label="新增环境类型" value={newEnvironment.kind} onChange={(event) => setNewEnvironment({ ...newEnvironment, kind: event.target.value as EnvironmentKind })} className="h-8 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary"><option value="local">本地启动</option><option value="test">测试环境</option></select><input aria-label="新增环境名称" value={newEnvironment.name} onChange={(event) => setNewEnvironment({ ...newEnvironment, name: event.target.value })} placeholder="环境名称" className="h-8 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary" /><input aria-label="新增环境地址" value={newEnvironment.baseUrl} onChange={(event) => setNewEnvironment({ ...newEnvironment, baseUrl: event.target.value })} placeholder="系统入口，例如 https://test.example" className="h-8 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary" /><div className="flex gap-1"><button type="button" aria-label="保存新增环境" disabled={busy || !newEnvironment.name.trim() || !newEnvironment.baseUrl.trim() || !isHttpUrl(newEnvironment.loginUrl)} onClick={() => addEnvironment(system.id)} className="rounded bg-brand-500 p-1.5 text-white disabled:opacity-40"><Check className="h-3.5 w-3.5" /></button><button type="button" aria-label="取消新增环境" onClick={() => setCreatingEnvironmentFor(null)} className="rounded border border-border p-1.5 text-text-muted"><X className="h-3.5 w-3.5" /></button></div></div>
                <div className="grid gap-2 lg:grid-cols-2"><label className="grid gap-1 text-[10px] text-text-muted">登录地址<input aria-label="新增环境登录地址" value={newEnvironment.loginUrl} onChange={(event) => setNewEnvironment({ ...newEnvironment, loginUrl: event.target.value })} placeholder="https://test.example/user/login" className="h-8 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary" /></label><label className="grid gap-1 text-[10px] text-text-muted">可信登录域名（可选）<textarea aria-label="新增环境可信登录域名" value={newEnvironment.handoffOrigins} onChange={(event) => setNewEnvironment({ ...newEnvironment, handoffOrigins: event.target.value })} onBlur={(event) => setNewEnvironment({ ...newEnvironment, handoffOrigins: normalizeHandoffOriginInput(event.target.value) })} placeholder="sso.example.test；多个域名一行一个" rows={2} className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary" /></label></div>
              </div>}
              <div className="divide-y divide-border border-y border-border">{systemEnvironments.length === 0 ? <p className="py-4 text-center text-xs text-text-muted">暂无环境</p> : systemEnvironments.map((environment) => {
                const isEnvironmentEditing = editingEnvironment?.id === environment.id
                const value = isEnvironmentEditing ? editingEnvironment.value : environmentDraft(environment)
                return <div key={environment.id} className="space-y-2 py-3 text-xs">
                  <div className="grid items-center gap-2 lg:grid-cols-[120px_1fr_1.5fr_84px_116px]">
                    {isEnvironmentEditing ? <><select aria-label={`编辑环境类型 ${environment.name}`} value={value.kind} onChange={(event) => setEditingEnvironment({ ...editingEnvironment, value: { ...value, kind: event.target.value as EnvironmentKind } })} className="h-8 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary"><option value="local">本地启动</option><option value="test">测试环境</option></select><input aria-label={`编辑环境名称 ${environment.name}`} value={value.name} onChange={(event) => setEditingEnvironment({ ...editingEnvironment, value: { ...value, name: event.target.value } })} className="h-8 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary" /><input aria-label={`编辑环境地址 ${environment.name}`} value={value.baseUrl} onChange={(event) => setEditingEnvironment({ ...editingEnvironment, value: { ...value, baseUrl: event.target.value } })} className="h-8 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary" /></> : <><span className="text-text-muted">{environment.kind === 'local' ? '本地启动' : '测试环境'}</span><span className="font-medium text-text-primary">{environment.name}</span><span className="truncate text-text-secondary" title={environment.baseUrl}>{environment.baseUrl}</span></>}
                    <button type="button" disabled={busy} onClick={() => toggleEnvironment(environment)} className={`inline-flex h-7 items-center justify-center gap-1 rounded border px-2 text-[11px] font-semibold disabled:opacity-40 ${environment.isEnabled ? 'border-success/30 text-success' : 'border-border text-text-muted'}`}><Power className="h-3 w-3" />{environment.isEnabled ? '启用中' : '已停用'}</button>
                    <div className="flex gap-1">{isEnvironmentEditing ? <><button type="button" aria-label={`保存环境 ${environment.name}`} disabled={busy || !value.name.trim() || !value.baseUrl.trim() || !isHttpUrl(value.loginUrl)} onClick={saveEnvironment} className="rounded bg-brand-500 p-1.5 text-white disabled:opacity-40"><Check className="h-3.5 w-3.5" /></button><button type="button" aria-label="取消编辑环境" onClick={() => setEditingEnvironment(null)} className="rounded border border-border p-1.5 text-text-muted"><X className="h-3.5 w-3.5" /></button></> : <><button type="button" title="编辑环境" aria-label={`编辑环境 ${environment.name}`} disabled={busy} onClick={() => setEditingEnvironment({ id: environment.id, systemId: environment.systemId, value })} className="rounded border border-border p-1.5 text-brand-400 disabled:opacity-40"><Pencil className="h-3.5 w-3.5" /></button><button type="button" title="删除环境" aria-label={`删除环境 ${environment.name}`} disabled={busy} onClick={() => removeEnvironment(environment)} className="rounded border border-error/30 p-1.5 text-error disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button></>}</div>
                  </div>
                  {isEnvironmentEditing ? <div className="grid gap-2 border-l-2 border-brand-500/30 pl-3 lg:grid-cols-2"><label className="grid gap-1 text-[10px] text-text-muted">登录地址<input aria-label={`编辑环境登录地址 ${environment.name}`} value={value.loginUrl} onChange={(event) => setEditingEnvironment({ ...editingEnvironment, value: { ...value, loginUrl: event.target.value } })} className="h-8 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary" /></label><label className="grid gap-1 text-[10px] text-text-muted">可信登录域名（可选）<textarea aria-label={`编辑环境可信登录域名 ${environment.name}`} value={value.handoffOrigins} onChange={(event) => setEditingEnvironment({ ...editingEnvironment, value: { ...value, handoffOrigins: event.target.value } })} onBlur={(event) => setEditingEnvironment({ ...editingEnvironment, value: { ...value, handoffOrigins: normalizeHandoffOriginInput(event.target.value) } })} rows={2} className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-text-primary" /></label></div> : <div className="grid gap-1 text-[10px] text-text-muted lg:grid-cols-2"><span>登录地址：<span className="text-text-secondary">{environment.loginUrl || '尚未配置（历史账号继续使用原配置）'}</span></span><span>可信域名：<span className="text-text-secondary">{environment.handoffOrigins.length > 0 ? environment.handoffOrigins.map((item) => new URL(item).host).join('、') : '无'}</span></span></div>}
                </div>
              })}</div>
            </div>}
          </div>
        })}
      </div>
    </section>
  )
}
