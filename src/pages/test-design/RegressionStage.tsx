import { useRef, useState } from 'react'
import { Play, Save } from 'lucide-react'

import type { TestCase } from '../../types'
import { executionRoleAccounts, executionRoleKey, type ExecutionAccountOverrides } from '../../api/regressionExecutionPlan'
import type { TestAccount } from '../../types/workflow'
import { TestCaseCard } from './TestCaseCard'

interface Props {
  cases: TestCase[]
  selectedIds: Set<string>
  collectionName: string
  running: boolean
  saving: boolean
  runFeedback?: { kind: 'progress' | 'error'; message: string }
  accounts: TestAccount[]
  accountOverrides: ExecutionAccountOverrides
  onSelectionChange: (ids: Set<string>) => void
  onCollectionNameChange: (name: string) => void
  onSaveCollection: () => void
  onAccountOverridesChange: (overrides: Record<string, string>) => void
  onMissingAccounts: (message: string) => void
  onRun: () => void
}

export function RegressionStage({ cases, selectedIds, collectionName, running, saving, runFeedback, accounts, accountOverrides, onSelectionChange, onCollectionNameChange, onSaveCollection, onAccountOverridesChange, onMissingAccounts, onRun }: Props) {
  const accountSectionRef = useRef<HTMLDivElement>(null)
  const accountSelectRefs = useRef<Record<string, HTMLSelectElement | null>>({})
  const [showAccountErrors, setShowAccountErrors] = useState(false)
  const selectedCount = cases.filter((item) => selectedIds.has(item.id)).length
  const allSelected = cases.length > 0 && selectedCount === cases.length
  const enabledAccounts = accounts.filter((account) => account.enabled)
  const roleBindings = Array.from(cases
    .filter((item) => selectedIds.has(item.id))
    .flatMap((item) => item.steps)
    .reduce((bindings, step) => {
      const key = executionRoleKey(step, accounts)
      if (!key || bindings.has(key)) return bindings
      const sameRoleAccounts = executionRoleAccounts(key, enabledAccounts)
      if (sameRoleAccounts.length === 0) return bindings
      bindings.set(key, {
        key,
        label: sameRoleAccounts[0].roleName || sameRoleAccounts[0].role,
        options: sameRoleAccounts,
      })
      return bindings
    }, new Map<string, { key: string; label: string; options: TestAccount[] }>()).values())
  const missingRoleBindings = roleBindings.filter((binding) => !binding.options.some((account) => account.id === accountOverrides[binding.key]))
  const toggleCase = (id: string, selected: boolean) => {
    const next = new Set(selectedIds)
    if (selected) next.add(id)
    else next.delete(id)
    onSelectionChange(next)
  }
  const requestRun = () => {
    if (missingRoleBindings.length === 0) {
      setShowAccountErrors(false)
      onRun()
      return
    }
    const message = `请先选择${missingRoleBindings.map((item) => item.label).join('、')}的执行账号，再开始测试。`
    setShowAccountErrors(true)
    onMissingAccounts(message)
    accountSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    requestAnimationFrame(() => accountSelectRefs.current[missingRoleBindings[0].key]?.focus())
  }

  return (
    <section aria-labelledby="regression-stage-title" className="space-y-4">
      <div className="border-b border-border pb-3">
        <h3 id="regression-stage-title" className="text-sm font-bold text-text-primary">执行测试</h3>
        <p className="mt-1 text-[11px] text-text-muted">勾选这次要执行的用例。系统会按账号流转顺序融合步骤，只去除账号、操作和预期结果都相同的重复项；不同边界值和断言会保留。</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-2/40 p-4">
        <label className="min-w-[220px] flex-1 text-xs font-semibold text-text-secondary">测试集合名称
          <input aria-label="测试集合名称" value={collectionName} onChange={(event) => onCollectionNameChange(event.target.value)} placeholder="例如：试用期核心流程" className="mt-1.5 h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-xs text-text-primary outline-none focus:border-brand-500" />
        </label>
        <button type="button" disabled={saving || selectedCount === 0 || !collectionName.trim()} onClick={onSaveCollection} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-brand-500/30 px-3 text-xs font-semibold text-brand-400 disabled:opacity-40"><Save className="h-3.5 w-3.5" />{saving ? '正在保存...' : '保存测试集合'}</button>
      </div>

      {roleBindings.length > 0 && <div ref={accountSectionRef} className="border-y border-border bg-surface-2/25 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h4 className="text-xs font-bold text-text-primary">本次执行账号</h4><p className="mt-1 text-[11px] text-text-muted">只替换本次执行账号，不修改用例，也不会调用 AI 或消耗 Token。</p></div>
          {Object.keys(accountOverrides).length > 0 && <button type="button" onClick={() => onAccountOverridesChange({})} className="text-xs font-semibold text-brand-400">清空已选账号</button>}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {roleBindings.map((binding) => {
            const selectedAccountId = accountOverrides[binding.key] || ''
            const showMissing = showAccountErrors && missingRoleBindings.some((item) => item.key === binding.key)
            return <label key={binding.key} className="text-xs font-semibold text-text-secondary">{binding.label}
              <select ref={(element) => { accountSelectRefs.current[binding.key] = element }} aria-label={`${binding.label}执行账号`} aria-invalid={showMissing || undefined} value={selectedAccountId} onChange={(event) => {
                const next = { ...accountOverrides }
                if (!event.target.value) delete next[binding.key]
                else next[binding.key] = event.target.value
                onAccountOverridesChange(next)
              }} className={`mt-1.5 h-9 w-full rounded-md border bg-surface-1 px-3 text-xs text-text-primary outline-none ${showMissing ? 'border-danger focus:border-danger' : 'border-border focus:border-brand-500'}`}>
                <option value="">请选择执行账号</option>
                {binding.options.map((account) => <option key={account.id} value={account.id}>{account.displayName} · {account.roleName || account.role}</option>)}
              </select>
            </label>
          })}
        </div>
        {missingRoleBindings.length > 0 && <p role="alert" className="mt-3 border-l-2 border-warning bg-warning/5 px-3 py-2 text-[11px] text-warning">请先选择 {missingRoleBindings.map((item) => item.label).join('、')} 的执行账号，选择完成后才能开始测试。</p>}
      </div>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-text-secondary">已确认 {cases.length} 条，已选择 <strong className="text-brand-400">{selectedCount}</strong> 条</div>
        <div className="flex gap-2">
          <button type="button" disabled={cases.length === 0 || allSelected} onClick={() => onSelectionChange(new Set(cases.map((item) => item.id)))} className="text-xs text-brand-400 disabled:opacity-40">全选</button>
          <button type="button" disabled={selectedCount === 0} onClick={() => onSelectionChange(new Set())} className="text-xs text-text-muted disabled:opacity-40">清空</button>
        </div>
      </div>

      {cases.length === 0 && <div className="border border-dashed border-border p-8 text-center text-xs text-text-muted">还没有已确认的用例，请先回到“检查用例”完成确认。</div>}
      <div className="grid gap-4 xl:grid-cols-2">
        {cases.map((testCase) => (
          <TestCaseCard key={testCase.id} testCase={testCase} accounts={accounts} selected={selectedIds.has(testCase.id)} onSelectionChange={(selected) => toggleCase(testCase.id, selected)} />
        ))}
      </div>

      <div className="sticky bottom-0 flex min-h-16 flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-1/95 py-3 backdrop-blur">
        <p aria-live="polite" className={`min-w-0 flex-1 text-[11px] ${runFeedback?.kind === 'error' ? 'text-danger' : 'text-text-muted'}`}>
          {runFeedback?.message}
        </p>
        <button type="button" disabled={running || selectedCount === 0} onClick={requestRun} className="flex h-10 items-center gap-2 rounded-md bg-success px-5 text-xs font-semibold text-white disabled:opacity-40"><Play className="h-3.5 w-3.5" />{running ? '正在启动...' : `执行所选用例（${selectedCount} 条）`}</button>
      </div>
    </section>
  )
}
