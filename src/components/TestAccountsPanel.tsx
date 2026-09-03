import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, ChevronDown, KeyRound, Pencil, Plus, RefreshCw, UserRoundX } from 'lucide-react'

import {
  createScopedTestAccount,
  disableTestAccount,
  listScopedTestAccounts,
  setTestAccountCredential,
  updateScopedTestAccount,
} from '../api/testingBridge'
import type { AccountEnvironmentScope, LoginAutomationConfig, LoginMode, TestAccount } from '../types/workflow'
import { isHttpUrl } from '../utils/loginEnvironment'

interface TestAccountsPanelProps {
  canManage: boolean
  scope: AccountEnvironmentScope
  onAccountsChanged?: (accounts: TestAccount[]) => void
}

type AccountField = 'displayName' | 'roleName' | 'username' | 'password'
type AccountFieldErrors = Partial<Record<AccountField, string>>

const LOGIN_MODE_LABEL: Record<LoginMode, string> = {
  automatic: '自动登录',
  manual_sso: 'SSO 手动登录',
  manual_otp: '验证码手动登录',
}

function readField(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim()
}

function roleKeyFrom(roleName: string): string {
  return roleName.trim().toLocaleLowerCase().replace(/\s+/g, '-').slice(0, 64)
}

function normalizedRoleName(roleName: string): string {
  return roleName.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function loginConfigFrom(formData: FormData, loginUrl: string, handoffOrigins: string[]): LoginAutomationConfig {
  const pageSelector = readField(formData, 'pageSelector')
  const usernameSelector = readField(formData, 'usernameSelector')
  const passwordSelector = readField(formData, 'passwordSelector')
  const submitSelector = readField(formData, 'submitSelector')
  const successSelector = readField(formData, 'successSelector')
  return {
    loginUrl,
    ...(handoffOrigins.length > 0 ? { handoffOrigins } : {}),
    ...(pageSelector ? { pageSelector } : {}),
    ...(usernameSelector ? { usernameSelector } : {}),
    ...(passwordSelector ? { passwordSelector } : {}),
    ...(submitSelector ? { submitSelector } : {}),
    ...(successSelector ? { successSelector } : {}),
  }
}

export function TestAccountsPanel({ canManage, scope, onAccountsChanged }: TestAccountsPanelProps) {
  const { systemId, environmentId } = scope
  const [accounts, setAccounts] = useState<TestAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [formError, setFormError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<AccountFieldErrors>({})
  const [editingAccount, setEditingAccount] = useState<TestAccount | null>(null)
  const [creating, setCreating] = useState(false)
  const [loginMode, setLoginMode] = useState<LoginMode>('automatic')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const refreshAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const nextAccounts = await listScopedTestAccounts({ systemId, environmentId })
      setAccounts(nextAccounts)
      onAccountsChanged?.(nextAccounts)
      setNotice('')
      return true
    } catch {
      setNotice('测试账号加载失败，请刷新后重试。')
      return false
    } finally {
      setLoading(false)
    }
  }, [environmentId, onAccountsChanged, systemId])

  useEffect(() => {
    void refreshAccounts()
  }, [refreshAccounts])

  const closeEditor = () => {
    formRef.current?.reset()
    setEditingAccount(null)
    setCreating(false)
    setFormError('')
    setFieldErrors({})
    setAdvancedOpen(false)
  }

  const openCreate = () => {
    setNotice('')
    setEditingAccount(null)
    setLoginMode('automatic')
    setFormError('')
    setFieldErrors({})
    setAdvancedOpen(false)
    setCreating(true)
  }

  const openEdit = (account: TestAccount) => {
    setNotice('')
    setLoginMode(account.loginMode)
    setFormError('')
    setFieldErrors({})
    setAdvancedOpen(false)
    setEditingAccount(account)
    setCreating(false)
  }

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const displayName = readField(formData, 'displayName')
    const roleName = readField(formData, 'roleName')
    // 编辑显示名称时保留原角色键；新增或改角色时复用同名角色的已有键，
    // 避免“employee/员工”这类同一业务身份被拆成两个执行账号组。
    const originalRoleName = initial?.roleName ?? initial?.role
    const existingRole = accounts.find((account) => normalizedRoleName(account.roleName || account.role) === normalizedRoleName(roleName))
    const role = initial && roleName === originalRoleName ? initial.role : existingRole?.role ?? roleKeyFrom(roleName)
    // 环境配置是登录地址和 SSO 域名的唯一新来源；环境尚未配置时才回退旧账号字段，
    // 以保证数据库升级后历史账号仍可执行，管理员保存环境后所有账号立即统一生效。
    const environmentConfigured = isHttpUrl(scope.loginUrl)
    const loginUrl = environmentConfigured
      ? scope.loginUrl
      : editingAccount?.loginConfig.loginUrl || scope.baseUrl
    const handoffOrigins = environmentConfigured
      ? scope.handoffOrigins
      : editingAccount?.loginConfig.handoffOrigins ?? []
    const submittedConfig = loginConfigFrom(formData, loginUrl, handoffOrigins)
    const config = editingAccount && !advancedOpen
      ? { ...editingAccount.loginConfig, loginUrl: submittedConfig.loginUrl }
      : submittedConfig
    if (handoffOrigins.length > 0) config.handoffOrigins = handoffOrigins
    else delete config.handoffOrigins
    const username = String(formData.get('username') ?? '')
    const password = String(formData.get('password') ?? '')

    const errors: AccountFieldErrors = {}
    if (!displayName) errors.displayName = '请填写账号显示名'
    if (!roleName) errors.roleName = '请填写业务角色'
    if (!isHttpUrl(config.loginUrl)) {
      setFieldErrors({})
      setFormError('当前环境还没有有效登录地址，请先到系统设置中编辑该环境。')
      return
    }
    if (loginMode === 'automatic') {
      const credentialRequired = creating || editingAccount?.maskedLoginName === 'not-configured'
      if ((credentialRequired && !username) || (!username && Boolean(password))) errors.username = '请填写账号用户名'
      if ((credentialRequired && !password) || (Boolean(username) && !password)) errors.password = '请填写账号密码'
    }
    if (Object.keys(errors).length > 0) {
      const missingCredentials = errors.username && errors.password
      setFieldErrors(errors)
      setFormError(missingCredentials ? '请填写账号用户名和账号密码。' : Object.values(errors)[0] ?? '请检查表单。')
      const firstInvalid = (['displayName', 'roleName', 'username', 'password'] as AccountField[])
        .find(field => errors[field])
      const field = firstInvalid ? formRef.current?.elements.namedItem(firstInvalid) : null
      if (field instanceof HTMLElement) {
        field.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
        field.focus()
      }
      return
    }

    setSaving(true)
    setNotice('')
    setFormError('')
    setFieldErrors({})
    try {
      const input = { displayName, role, roleName, loginMode, loginConfig: config }
      const saved = editingAccount
        ? await updateScopedTestAccount(editingAccount.id, { systemId, environmentId }, input)
        : await createScopedTestAccount({ systemId, environmentId, ...input })
      if (loginMode === 'automatic' && username && password) {
        await setTestAccountCredential(saved.id, username, password)
      }
      const refreshed = await refreshAccounts()
      if (refreshed) {
        closeEditor()
        setNotice('测试账号已保存。')
      }
    } catch {
      setFormError('测试账号保存失败，请检查配置后重试。')
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
            <h3 className="text-xs font-bold text-text-primary">本系统测试账号</h3>
            <p className="mt-0.5 text-[10px] text-text-muted">按当前系统自由填写业务角色，可为同一角色添加多个账号；登录地址和 SSO 域名统一继承当前环境。凭据仅写入系统凭据库。</p>
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
            {!loading && accounts.map(account => <tr key={account.id} className={account.enabled ? '' : 'opacity-55'}><td className="px-3 py-2.5">{account.roleName || account.role}</td><td className="px-3 py-2.5 font-semibold text-text-primary">{account.displayName}</td><td className="px-3 py-2.5 font-mono text-text-secondary">{account.maskedLoginName}</td><td className="px-3 py-2.5 text-text-secondary">{LOGIN_MODE_LABEL[account.loginMode]}</td><td className="px-3 py-2.5"><span className={account.enabled ? 'text-success' : 'text-text-muted'}>{account.enabled ? '启用' : '已停用'}</span></td>{canManage && <td className="px-3 py-2.5 text-right"><div className="flex justify-end gap-2">{account.enabled && <button type="button" aria-label={`编辑${account.displayName}`} onClick={() => openEdit(account)} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[10px] text-brand-400 hover:bg-brand-500/10"><Pencil className="h-3 w-3" />编辑</button>}{account.enabled && <button type="button" onClick={() => void handleDisable(account)} className="inline-flex h-7 items-center gap-1 rounded-md border border-error/20 px-2 text-[10px] text-error hover:bg-error/10"><UserRoundX className="h-3 w-3" />停用</button>}</div></td>}</tr>)}
          </tbody>
        </table>
      </div>

      {editorOpen && canManage && <div role="dialog" aria-modal="true" aria-label="测试账号编辑" className="space-y-4 rounded-lg border border-brand-500/30 bg-surface-2 p-4">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-3"><div><h4 className="text-sm font-bold text-text-primary">{editingAccount ? '编辑测试账号' : '新增测试账号'}</h4><p className="mt-1 text-[10px] text-text-muted">登录地址和可信域名来自系统环境；这里只配置角色、登录方式和账号凭据。</p></div><button type="button" onClick={closeEditor} className="text-xs text-text-muted hover:text-text-primary">关闭</button></div>
        <form ref={formRef} noValidate onSubmit={event => void handleSave(event)} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {formError && <div role="alert" className="col-span-full flex items-start gap-2 rounded-lg border border-error/40 bg-error/10 px-3 py-2.5 text-xs font-medium text-error"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{formError}</span></div>}
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">显示名</span><input name="displayName" aria-label="账号显示名" aria-invalid={Boolean(fieldErrors.displayName)} defaultValue={initial?.displayName ?? ''} className={`h-9 w-full rounded-lg border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500 ${fieldErrors.displayName ? 'border-error' : 'border-border'}`} />{fieldErrors.displayName && <span className="mt-1 block text-[10px] text-error">{fieldErrors.displayName}</span>}</label>
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">业务角色</span><input name="roleName" aria-label="业务角色" aria-invalid={Boolean(fieldErrors.roleName)} defaultValue={initial?.roleName ?? initial?.role ?? ''} placeholder="例如：财务复核人" className={`h-9 w-full rounded-lg border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500 ${fieldErrors.roleName ? 'border-error' : 'border-border'}`} />{fieldErrors.roleName && <span className="mt-1 block text-[10px] text-error">{fieldErrors.roleName}</span>}</label>
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">登录方式</span><select name="loginMode" aria-label="登录方式" value={loginMode} onChange={event => { setLoginMode(event.target.value as LoginMode); setFormError(''); setFieldErrors({}) }} className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500"><option value="automatic">自动登录</option><option value="manual_sso">SSO 手动登录</option><option value="manual_otp">验证码手动登录</option></select></label>
          {loginMode === 'automatic' && <>
          <div className="md:col-span-2 grid grid-cols-1 gap-3 border-t border-border pt-3 md:grid-cols-2"><label className="block"><span className="mb-1 block text-[10px] text-text-secondary">账号用户名</span><input name="username" aria-label="账号用户名" aria-invalid={Boolean(fieldErrors.username)} autoComplete="off" className={`h-9 w-full rounded-lg border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500 ${fieldErrors.username ? 'border-error' : 'border-border'}`} />{fieldErrors.username && <span className="mt-1 block text-[10px] text-error">{fieldErrors.username}</span>}</label><label className="block"><span className="mb-1 block text-[10px] text-text-secondary">账号密码</span><input name="password" aria-label="账号密码" aria-invalid={Boolean(fieldErrors.password)} type="password" autoComplete="new-password" className={`h-9 w-full rounded-lg border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500 ${fieldErrors.password ? 'border-error' : 'border-border'}`} />{fieldErrors.password && <span className="mt-1 block text-[10px] text-error">{fieldErrors.password}</span>}</label><p className="md:col-span-2 text-[10px] text-text-muted">保存后直接写入系统凭据库，页面不会回显或保存该信息。</p></div>
          <button type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(value => !value)} className="col-span-full flex h-9 items-center justify-between rounded-lg border border-border bg-surface-1 px-3 text-xs font-medium text-text-secondary hover:text-text-primary"><span>高级设置（可选）</span><ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} /></button>
          {advancedOpen && <div className="col-span-full grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface-1/60 p-3 md:grid-cols-2">
          <p className="md:col-span-2 text-[10px] text-text-muted">系统会优先自动识别登录控件；仅在页面结构特殊或需要固定定位时填写选择器。</p>
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">页面选择器（可选）</span><input name="pageSelector" aria-label="页面选择器" defaultValue={initial?.loginConfig.pageSelector ?? ''} placeholder="#login-page" className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label>
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">用户名选择器</span><input name="usernameSelector" aria-label="用户名选择器" defaultValue={initial?.loginConfig.usernameSelector ?? ''} placeholder="input[name=username]" className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label>
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">密码选择器</span><input name="passwordSelector" aria-label="密码选择器" defaultValue={initial?.loginConfig.passwordSelector ?? ''} placeholder="input[type=password]" className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label>
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">提交选择器</span><input name="submitSelector" aria-label="提交选择器" defaultValue={initial?.loginConfig.submitSelector ?? ''} placeholder="button[type=submit]" className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label>
          <label className="block md:col-span-2"><span className="mb-1 block text-[10px] text-text-secondary">登录成功选择器</span><input name="successSelector" aria-label="登录成功选择器" defaultValue={initial?.loginConfig.successSelector ?? ''} placeholder="[data-testid=home]" className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label>
          </div>}
          </>}
          <div className="col-span-full flex justify-end gap-2 border-t border-border pt-3"><button type="button" onClick={closeEditor} className="h-8 rounded-lg border border-border px-3 text-xs text-text-secondary hover:text-text-primary">取消</button><button type="submit" disabled={saving} className="flex h-8 items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50">{saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}保存测试账号</button></div>
        </form>
      </div>}
    </section>
  )
}
