import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { X } from 'lucide-react'

import { createSystemWithEnvironment } from '../api/testDesignBridge'
import type { EnvironmentKind, SystemEnvironmentScope } from '../types/testDesign'
import { normalizeHandoffOriginInput, parseHandoffOrigins } from '../utils/loginEnvironment'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (scope: SystemEnvironmentScope) => void
  suggestedSystemName?: string
}

export function QuickCreateSystemDialog({ open, onClose, onCreated, suggestedSystemName = '' }: Props) {
  const [systemName, setSystemName] = useState(suggestedSystemName)
  const [kind, setKind] = useState<EnvironmentKind>('test')
  const [environmentName, setEnvironmentName] = useState('测试环境')
  const [baseUrl, setBaseUrl] = useState('https://onboardingtest.oa.wanmei.net')
  const [loginUrl, setLoginUrl] = useState('https://onboardingtest.oa.wanmei.net/user/login')
  const [handoffOrigins, setHandoffOrigins] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && !systemName) setSystemName(suggestedSystemName)
  }, [open, suggestedSystemName, systemName])

  if (!open) return null

  const changeKind = (nextKind: EnvironmentKind) => {
    setKind(nextKind)
    setEnvironmentName(nextKind === 'test' ? '测试环境' : '本地启动')
    setBaseUrl(nextKind === 'test' ? 'https://onboardingtest.oa.wanmei.net' : 'http://localhost:5173')
    setLoginUrl(nextKind === 'test' ? 'https://onboardingtest.oa.wanmei.net/user/login' : 'http://localhost:5173/login')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!systemName.trim() || !environmentName.trim() || !baseUrl.trim() || !loginUrl.trim()) {
      setError('请完整填写系统和环境信息。')
      return
    }
    const parsedOrigins = parseHandoffOrigins(handoffOrigins)
    if (parsedOrigins.invalid) {
      setError(`可信登录域名“${parsedOrigins.invalid}”格式不正确。`)
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const created = await createSystemWithEnvironment({
        systemName: systemName.trim(),
        kind,
        environmentName: environmentName.trim(),
        baseUrl: baseUrl.trim(),
        loginUrl: loginUrl.trim(),
        handoffOrigins: parsedOrigins.origins,
      })
      onCreated(created)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="快速新建系统" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-lg rounded-lg border border-border bg-surface-1 shadow-2xl">
        <header className="flex items-start justify-between border-b border-border px-5 py-4">
          <div><h3 className="text-sm font-bold text-text-primary">快速新建系统</h3><p className="mt-1 text-xs text-text-muted">同时创建首个可用环境，完成后立即进入设计测试。</p></div>
          <button type="button" aria-label="关闭" onClick={onClose} className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text-primary"><X className="h-4 w-4" /></button>
        </header>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-xs font-semibold text-text-secondary sm:col-span-2">系统名称<input aria-label="系统名称" autoFocus value={systemName} onChange={(event) => setSystemName(event.target.value)} className="h-9 rounded-md border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label>
          <label className="grid gap-1.5 text-xs font-semibold text-text-secondary">环境类型<select aria-label="环境类型" value={kind} onChange={(event) => changeKind(event.target.value as EnvironmentKind)} className="h-9 rounded-md border border-border bg-surface-2 px-3 text-xs text-text-primary"><option value="test">测试环境</option><option value="local">本地启动</option></select></label>
          <label className="grid gap-1.5 text-xs font-semibold text-text-secondary">环境名称<input aria-label="环境名称" value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} className="h-9 rounded-md border border-border bg-surface-2 px-3 text-xs text-text-primary" /></label>
          <label className="grid gap-1.5 text-xs font-semibold text-text-secondary sm:col-span-2">环境地址<input aria-label="环境地址" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} className="h-9 rounded-md border border-border bg-surface-2 px-3 text-xs text-text-primary" /></label>
          <label className="grid gap-1.5 text-xs font-semibold text-text-secondary sm:col-span-2">登录地址<input aria-label="环境登录地址" value={loginUrl} onChange={(event) => setLoginUrl(event.target.value)} className="h-9 rounded-md border border-border bg-surface-2 px-3 text-xs text-text-primary" /></label>
          <label className="grid gap-1.5 text-xs font-semibold text-text-secondary sm:col-span-2">可信登录域名（可选）<textarea aria-label="环境可信登录域名" value={handoffOrigins} onChange={(event) => setHandoffOrigins(event.target.value)} onBlur={(event) => setHandoffOrigins(normalizeHandoffOriginInput(event.target.value))} placeholder="sso.example.test；多个域名一行一个" rows={2} className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-text-primary" /><span className="font-normal text-[10px] text-text-muted">用于 SSO、扫码或验证码跳转；该环境下所有测试账号共用。</span></label>
          {error && <p role="alert" className="text-xs text-danger sm:col-span-2">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onClose} disabled={submitting} className="h-9 rounded-md border border-border px-4 text-xs font-semibold text-text-secondary">取消</button>
          <button type="submit" disabled={submitting} className="h-9 rounded-md bg-brand-500 px-4 text-xs font-semibold text-white disabled:opacity-45">{submitting ? '创建中...' : '创建并使用'}</button>
        </footer>
      </form>
    </div>
  )
}
