import { type FormEvent, useEffect, useRef, useState } from 'react'
import { KeyRound, Pencil, Plus, RefreshCw, UserRoundX } from 'lucide-react'

import {
  createTestAccount,
  disableTestAccount,
  listTestAccounts,
  setTestAccountCredential,
  updateTestAccount,
} from '../api/testingBridge'
import type { BusinessRole, LoginAutomationConfig, LoginMode, TestAccount } from '../types/workflow'

interface TestAccountsPanelProps {
  canManage: boolean
}

const ROLE_LABEL: Record<BusinessRole, string> = {
  employee: '员工',
  manager: '上级',
  hrbp: 'HRBP',
}

const LOGIN_MODE_LABEL: Record<LoginMode, string> = {
  automatic: '自动登录',
  manual_sso: 'SSO 手动登录',
  manual_otp: '验证码手动登录',
}

function readField(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim()
}

function loginConfigFrom(formData: FormData): LoginAutomationConfig {
  const pageSelector = readField(formData, 'pageSelector')
  const usernameSelector = readField(formData, 'usernameSelector')
  const passwordSelector = readField(formData, 'passwordSelector')
  const submitSelector = readField(formData, 'submitSelector')
  const successSelector = readField(formData, 'successSelector')
  return {
    loginUrl: readField(formData, 'loginUrl'),
    ...(pageSelector ? { pageSelector } : {}),
    ...(usernameSelector ? { usernameSelector } : {}),
    ...(passwordSelector ? { passwordSelector } : {}),
    ...(submitSelector ? { submitSelector } : {}),
    ...(successSelector ? { successSelector } : {}),
  }
}

function hasHttpLoginUrl(config: LoginAutomationConfig): boolean {
  try {
    const url = new URL(config.loginUrl)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function TestAccountsPanel({ canManage }: TestAccountsPanelProps) {
  const [accounts, setAccounts] = useState<TestAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [editingAccount, setEditingAccount] = useState<TestAccount | null>(null)
  const [creating, setCreating] = useState(false)
  const [loginMode, setLoginMode] = useState<LoginMode>('automatic')
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const refreshAccounts = async () => {
    setLoading(true)
    try {
      setAccounts(await listTestAccounts())
      setNotice('')
    } catch {
      setNotice('测试账号加载失败，请刷新后重试。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshAccounts()
  }, [])

  const closeEditor = () => {
    formRef.current?.reset()
    setEditingAccount(null)
    setCreating(false)
  }

  const openCreate = () => {
    setNotice('')
    setEditingAccount(null)
    setLoginMode('automatic')
    setCreating(true)
  }

  const openEdit = (account: TestAccount) => {
    setNotice('')
    setLoginMode(account.loginMode)
    setEditingAccount(account)
    setCreating(false)
  }

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const displayName = readField(formData, 'displayName')
    const role = readField(formData, 'role') as BusinessRole
    const config = loginConfigFrom(formData)
    const username = String(formData.get('username') ?? '')
    const password = String(formData.get('password') ?? '')

    if (!displayName || !hasHttpLoginUrl(config)) {
      setNotice('请填写账号显示名和有效的 http(s) 登录地址。')
      return
    }
    if (loginMode === 'automatic' && ((creating && (!username || !password)) || Boolean(username) !== Boolean(password))) {
      setNotice('自动登录账号需要同时填写用户名和密码。')
      return
    }

    setSaving(true)
    setNotice('')
    try {
      const input = { displayName, role, loginMode, loginConfig: config }
      const saved = editingAccount
        ? await updateTestAccount(editingAccount.id, input)
        : await createTestAccount(input)
      if (loginMode === 'automatic' && username && password) {
        await setTestAccountCredential(saved.id, username, password)
      }
      formRef.current?.reset()
      await refreshAccounts()
      setNotice('测试账号已保存。')
    } catch {
      formRef.current?.reset()
      setNotice('测试账号保存失败，请检查配置后重试。')
    } finally {
      setSaving(false)
    }
  }

  const handleDisable = async (account: TestAccount) => {
    if (!window.confirm(`确认停用测试账号“${account.displayName}”？`)) return
    try {
      await disableTestAccount(account.id)
      await refreshAccounts()
      setNotice('测试账号已停用。')
    } catch {
      setNotice('测试账号停用失败，请稍后重试。')
    }
  }

  const editorOpen = creating || editingAccount !== null
  const initial = editingAccount

  return (
    <section aria-label="测试账号管理" className="col-span-full space-y-4 rounded-xl border border-border bg-surface-1/70 p-5 glow">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2.5">
          <KeyRound className="h-4 w-4 text-brand-400" />
          <div>
            <h3 className="text-xs font-bold text-text-primary">测试账号</h3>
            <p className="mt-0.5 text-[10px] text-text-muted">仅保存脱敏账号信息；自动登录凭据写入系统凭据库且不可回读。</p>
          </div>
        </div>
        {canManage && <button type="button" aria-label="新增测试账号" onClick={openCreate} className="flex h-8 items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-xs font-semibold text-white hover:bg-brand-600"><Plus className="h-3.5 w-3.5" />新增账号</button>}
      </div>

      {notice && <p role="status" className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning">{notice}</p>}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-surface-3/40 text-[10px] uppercase text-text-muted"><tr><th className="px-3 py-2">业务角色</th><th className="px-3 py-2">显示名</th><th className="px-3 py-2">登录名</th><th className="px-3 py-2">登录方式</th><th className="px-3 py-2">状态</th>{canManage && <th className="px-3 py-2 text-right">操作</th>}</tr></thead>
          <tbody className="divide-y divide-border">
            {loading && <tr><td colSpan={canManage ? 6 : 5} className="px-3 py-7 text-center text-text-muted">正在加载测试账号...</td></tr>}
            {!loading && accounts.length === 0 && <tr><td colSpan={canManage ? 6 : 5} className="px-3 py-7 text-center text-text-muted">暂无测试账号。</td></tr>}
            {!loading && accounts.map(account => <tr key={account.id} className={account.enabled ? '' : 'opacity-55'}><td className="px-3 py-2.5">{ROLE_LABEL[account.role]}</td><td className="px-3 py-2.5 font-semibold text-text-primary">{account.displayName}</td><td className="px-3 py-2.5 font-mono text-text-secondary">{account.maskedLoginName}</td><td className="px-3 py-2.5 text-text-secondary">{LOGIN_MODE_LABEL[account.loginMode]}</td><td className="px-3 py-2.5"><span className={account.enabled ? 'text-success' : 'text-text-muted'}>{account.enabled ? '启用' : '已停用'}</span></td>{canManage && <td className="px-3 py-2.5 text-right"><div className="flex justify-end gap-2">{account.enabled && <button type="button" aria-label={`编辑${account.displayName}`} onClick={() => openEdit(account)} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[10px] text-brand-400 hover:bg-brand-500/10"><Pencil className="h-3 w-3" />编辑</button>}{account.enabled && <button type="button" onClick={() => void handleDisable(account)} className="inline-flex h-7 items-center gap-1 rounded-md border border-error/20 px-2 text-[10px] text-error hover:bg-error/10"><UserRoundX className="h-3 w-3" />停用</button>}</div></td>}</tr>)}
          </tbody>
        </table>
      </div>

      {editorOpen && canManage && <div role="dialog" aria-modal="true" aria-label="测试账号编辑" className="space-y-4 rounded-lg border border-brand-500/30 bg-surface-2 p-4">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-3"><div><h4 className="text-sm font-bold text-text-primary">{editingAccount ? '编辑测试账号' : '新增测试账号'}</h4><p className="mt-1 text-[10px] text-text-muted">登录选择器只用于自动化定位，不填写任何真实凭据。</p></div><button type="button" onClick={closeEditor} className="text-xs text-text-muted hover:text-text-primary">关闭</button></div>
        <form ref={formRef} onSubmit={event => void handleSave(event)} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">显示名</span><input name="displayName" aria-label="账号显示名" defaultValue={initial?.displayName ?? ''} required className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label>
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">业务角色</span><select name="role" aria-label="业务角色" defaultValue={initial?.role ?? 'employee'} className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500"><option value="employee">员工</option><option value="manager">上级</option><option value="hrbp">HRBP</option></select></label>
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">登录方式</span><select name="loginMode" aria-label="登录方式" value={loginMode} onChange={event => setLoginMode(event.target.value as LoginMode)} className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500"><option value="automatic">自动登录</option><option value="manual_sso">SSO 手动登录</option><option value="manual_otp">验证码手动登录</option></select></label>
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">登录地址</span><input name="loginUrl" aria-label="登录地址" type="url" defaultValue={initial?.loginConfig.loginUrl ?? ''} required placeholder="https://example.test/login" className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label>
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">页面选择器</span><input name="pageSelector" aria-label="页面选择器" defaultValue={initial?.loginConfig.pageSelector ?? ''} placeholder="#login-page" className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label>
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">用户名选择器</span><input name="usernameSelector" aria-label="用户名选择器" defaultValue={initial?.loginConfig.usernameSelector ?? ''} placeholder="input[name=username]" className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label>
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">密码选择器</span><input name="passwordSelector" aria-label="密码选择器" defaultValue={initial?.loginConfig.passwordSelector ?? ''} placeholder="input[type=password]" className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label>
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">提交选择器</span><input name="submitSelector" aria-label="提交选择器" defaultValue={initial?.loginConfig.submitSelector ?? ''} placeholder="button[type=submit]" className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label>
          <label className="block md:col-span-2"><span className="mb-1 block text-[10px] text-text-secondary">登录成功选择器</span><input name="successSelector" aria-label="登录成功选择器" defaultValue={initial?.loginConfig.successSelector ?? ''} placeholder="[data-testid=home]" className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label>
          {loginMode === 'automatic' && <div className="md:col-span-2 grid grid-cols-1 gap-3 border-t border-border pt-3 md:grid-cols-2"><label className="block"><span className="mb-1 block text-[10px] text-text-secondary">账号用户名</span><input name="username" aria-label="账号用户名" autoComplete="off" className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label><label className="block"><span className="mb-1 block text-[10px] text-text-secondary">账号密码</span><input name="password" aria-label="账号密码" type="password" autoComplete="new-password" className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label><p className="md:col-span-2 text-[10px] text-text-muted">保存后直接写入系统凭据库，页面不会回显或保存该信息。</p></div>}
          <div className="col-span-full flex justify-end gap-2 border-t border-border pt-3"><button type="button" onClick={closeEditor} className="h-8 rounded-lg border border-border px-3 text-xs text-text-secondary hover:text-text-primary">取消</button><button type="submit" disabled={saving} className="flex h-8 items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50">{saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}保存测试账号</button></div>
        </form>
      </div>}
    </section>
  )
}
