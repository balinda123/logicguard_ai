import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'

import {
  createSystem,
  createSystemEnvironment,
  listSystemEnvironments,
  listSystems,
  updateSystemEnvironment,
} from '../api/testDesignBridge'
import type { EnvironmentKind, SystemEnvironment, TestSystem } from '../types/testDesign'

export function SystemEnvironmentManager() {
  const [systems, setSystems] = useState<TestSystem[]>([])
  const [systemId, setSystemId] = useState('')
  const [environments, setEnvironments] = useState<SystemEnvironment[]>([])
  const [systemName, setSystemName] = useState('')
  const [environmentName, setEnvironmentName] = useState('')
  const [environmentKind, setEnvironmentKind] = useState<EnvironmentKind>('test')
  const [baseUrl, setBaseUrl] = useState('')

  const refreshSystems = async () => {
    const items = await listSystems()
    setSystems(items)
    setSystemId((current) => current || items[0]?.id || '')
  }

  useEffect(() => { void refreshSystems() }, [])
  useEffect(() => {
    if (!systemId) return setEnvironments([])
    void listSystemEnvironments(systemId).then(setEnvironments)
  }, [systemId])

  const addSystem = async () => {
    if (!systemName.trim()) return
    const created = await createSystem(systemName.trim())
    setSystems((items) => [...items, created])
    setSystemId(created.id)
    setSystemName('')
  }

  const addEnvironment = async () => {
    if (!systemId || !environmentName.trim() || !baseUrl.trim()) return
    const created = await createSystemEnvironment({
      systemId,
      kind: environmentKind,
      name: environmentName.trim(),
      baseUrl: baseUrl.trim(),
    })
    setEnvironments((items) => [...items, created])
    setEnvironmentName('')
    setBaseUrl('')
  }

  const toggleEnvironment = async (environment: SystemEnvironment) => {
    const updated = await updateSystemEnvironment({
      id: environment.id,
      systemId: environment.systemId,
      kind: environment.kind,
      name: environment.name,
      baseUrl: environment.baseUrl,
      isEnabled: !environment.isEnabled,
    })
    setEnvironments((items) => items.map((item) => item.id === updated.id ? updated : item))
  }

  return (
    <section aria-labelledby="system-management-title" className="space-y-4 border-t border-border pt-5">
      <div><h3 id="system-management-title" className="text-sm font-bold text-text-primary">被测系统与环境</h3><p className="mt-1 text-[11px] text-text-muted">全局维护系统；每个系统只使用本地启动或测试环境。</p></div>
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <input aria-label="系统名称" value={systemName} onChange={(event) => setSystemName(event.target.value)} placeholder="系统名称" className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none" />
        <button disabled={!systemName.trim()} onClick={() => void addSystem()} className="flex h-9 items-center justify-center gap-2 rounded-lg border border-brand-500/30 px-4 text-xs text-brand-400 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />新增系统</button>
      </div>
      <div className="grid gap-3 lg:grid-cols-4">
        <select aria-label="管理系统" value={systemId} onChange={(event) => setSystemId(event.target.value)} className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary"><option value="">选择系统</option>{systems.map((system) => <option key={system.id} value={system.id}>{system.name}</option>)}</select>
        <select aria-label="环境类型" value={environmentKind} onChange={(event) => setEnvironmentKind(event.target.value as EnvironmentKind)} className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary"><option value="local">本地启动</option><option value="test">测试环境</option></select>
        <input aria-label="环境名称" value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} placeholder="环境名称" className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none" />
        <div className="flex gap-2"><input aria-label="环境地址" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://test.example" className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none" /><button aria-label="新增环境" disabled={!systemId || !environmentName.trim() || !baseUrl.trim()} onClick={() => void addEnvironment()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white disabled:opacity-40"><Plus className="h-4 w-4" /></button></div>
      </div>
      <div className="divide-y divide-border border-y border-border">
        {environments.map((environment) => <div key={environment.id} className="flex items-center justify-between gap-4 py-3 text-xs"><div><span className="font-semibold text-text-primary">{environment.name}</span><span className="ml-2 text-[10px] text-text-muted">{environment.kind === 'local' ? '本地启动' : '测试环境'} · {environment.baseUrl}</span></div><button onClick={() => void toggleEnvironment(environment)} className={environment.isEnabled ? 'text-success' : 'text-text-muted'}>{environment.isEnabled ? '已启用' : '已停用'}</button></div>)}
      </div>
    </section>
  )
}
