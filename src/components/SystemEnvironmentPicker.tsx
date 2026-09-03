import { useEffect, useState } from 'react'
import { MonitorCog, Plus } from 'lucide-react'

import { listSystemEnvironments, listSystems } from '../api/testDesignBridge'
import type { SystemEnvironment, TestSystem } from '../types/testDesign'
import { QuickCreateSystemDialog } from './QuickCreateSystemDialog'

export interface SystemEnvironmentSelection {
  system: TestSystem
  environment: SystemEnvironment
}

interface Props {
  value?: SystemEnvironmentSelection
  onChange: (selection: SystemEnvironmentSelection | undefined) => void
  canCreate?: boolean
}

export function SystemEnvironmentPicker({ value, onChange, canCreate = false }: Props) {
  const [systems, setSystems] = useState<TestSystem[]>([])
  const [environments, setEnvironments] = useState<SystemEnvironment[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    let active = true
    listSystems()
      .then((items) => {
        if (!active) return
        setSystems(items)
        if (!value && items[0]) {
          return listSystemEnvironments(items[0].id).then((scoped) => {
            if (!active) return
            const enabled = scoped.filter((item) => item.isEnabled)
            setEnvironments(enabled)
            onChange(enabled[0] ? { system: items[0], environment: enabled[0] } : undefined)
          })
        }
      })
      .finally(() => active && setLoading(false))
    return () => { active = false }
    // Initial scope selection intentionally runs once; subsequent system changes use selectSystem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!value?.system.id) return
    let active = true
    listSystemEnvironments(value.system.id).then((items) => {
      if (active) setEnvironments(items.filter((item) => item.isEnabled))
    })
    return () => { active = false }
  }, [value?.system.id])

  const selectSystem = async (systemId: string) => {
    const system = systems.find((item) => item.id === systemId)
    if (!system) return
    const scoped = (await listSystemEnvironments(system.id)).filter((item) => item.isEnabled)
    setEnvironments(scoped)
    onChange(scoped[0] ? { system, environment: scoped[0] } : undefined)
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
      <MonitorCog className="mb-2 h-4 w-4 text-brand-400" aria-hidden="true" />
      <div className="flex min-w-48 flex-1 items-end gap-2">
      <label className="min-w-0 flex-1">
        <span className="mb-1.5 block text-[11px] font-semibold text-text-muted">系统</span>
        <select
          aria-label="系统"
          disabled={loading || systems.length === 0}
          value={value?.system.id ?? ''}
          onChange={(event) => void selectSystem(event.target.value)}
          className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500"
        >
          {systems.length === 0 && <option value="">暂无已配置系统</option>}
          {systems.map((system) => <option key={system.id} value={system.id}>{system.name}</option>)}
        </select>
      </label>
      {canCreate && <button type="button" aria-label="快速新建系统" title="快速新建系统" onClick={() => setDialogOpen(true)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-brand-500/40 text-brand-400 hover:bg-brand-500/10"><Plus className="h-4 w-4" /></button>}
      </div>
      <label className="min-w-48 flex-1">
        <span className="mb-1.5 block text-[11px] font-semibold text-text-muted">环境</span>
        <select
          aria-label="环境"
          disabled={!value || environments.length === 0}
          value={value?.environment.id ?? ''}
          onChange={(event) => {
            const environment = environments.find((item) => item.id === event.target.value)
            if (value && environment) onChange({ system: value.system, environment })
          }}
          className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500"
        >
          {environments.length === 0 && <option value="">暂无可用环境</option>}
          {environments.map((environment) => (
            <option key={environment.id} value={environment.id}>
              {environment.name} · {environment.kind === 'local' ? '本地启动' : '测试环境'}
            </option>
          ))}
        </select>
      </label>
      {value && <span className="mb-2 text-[11px] text-text-muted">{value.environment.baseUrl}</span>}
      {!loading && systems.length === 0 && <p className="w-full text-xs text-text-muted">{canCreate ? '新建系统和首个环境后即可开始设计测试。' : '请联系管理员配置系统和环境。'}</p>}
      {!loading && systems.length > 0 && !value && <p className="w-full text-xs text-text-muted">当前系统没有启用的环境，请由管理员在系统设置中补充。</p>}
      <QuickCreateSystemDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        suggestedSystemName={systems.length === 0 ? '试用期管理' : ''}
        onCreated={(created) => {
          setSystems((current) => current.some((item) => item.id === created.system.id) ? current : [...current, created.system])
          setEnvironments([created.environment])
          onChange(created)
        }}
      />
    </div>
  )
}
