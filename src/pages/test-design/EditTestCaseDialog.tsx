import { Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { TestCase, TestCaseStep } from '../../types'

interface Props {
  testCase: TestCase
  saving: boolean
  onClose: () => void
  onSave: (testCase: TestCase) => void
}

export function EditTestCaseDialog({ testCase, saving, onClose, onSave }: Props) {
  const [title, setTitle] = useState(testCase.title)
  const [riskPoint, setRiskPoint] = useState(testCase.riskPoint)
  const [preconditions, setPreconditions] = useState(testCase.preconditions.join('\n'))
  const [steps, setSteps] = useState<TestCaseStep[]>(testCase.steps)
  const [expectedResult, setExpectedResult] = useState(testCase.expectedResult)

  useEffect(() => {
    setTitle(testCase.title)
    setRiskPoint(testCase.riskPoint)
    setPreconditions(testCase.preconditions.join('\n'))
    setSteps(testCase.steps)
    setExpectedResult(testCase.expectedResult)
  }, [testCase])

  const updateStep = (index: number, patch: Partial<TestCaseStep>) => {
    setSteps((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  const save = () => {
    if (!title.trim() || !riskPoint.trim() || !expectedResult.trim() || steps.length === 0) return
    onSave({
      ...testCase,
      title: title.trim(),
      riskPoint: riskPoint.trim(),
      preconditions: preconditions.split('\n').map((item) => item.trim()).filter(Boolean),
      steps: steps.map((item, index) => ({ ...item, order: index + 1, action: item.action.trim(), expectedResult: item.expectedResult.trim() })),
      expectedResult: expectedResult.trim(),
      status: 'draft',
      confirmedAt: undefined,
    })
  }

  const isValid = Boolean(title.trim() && riskPoint.trim() && expectedResult.trim() && steps.length > 0 && steps.every((item) => item.action.trim() && item.expectedResult.trim()))

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="edit-case-title" className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-surface-1 shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 id="edit-case-title" className="text-sm font-bold text-text-primary">编辑用例</h3>
            <p className="mt-1 text-[11px] text-warning">保存后会变为待确认，需要重新确认才能执行。</p>
          </div>
          <button type="button" aria-label="关闭编辑" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-primary"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="block text-xs font-semibold text-text-secondary">用例名称<input aria-label="用例名称" value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary outline-none focus:border-brand-500" /></label>
          <label className="block text-xs font-semibold text-text-secondary">风险点<textarea aria-label="风险点" value={riskPoint} onChange={(event) => setRiskPoint(event.target.value)} rows={2} className="mt-1.5 w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500" /></label>
          <label className="block text-xs font-semibold text-text-secondary">前置条件（每行一条）<textarea aria-label="前置条件" value={preconditions} onChange={(event) => setPreconditions(event.target.value)} rows={3} className="mt-1.5 w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500" /></label>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-text-secondary">操作步骤</span>
              <button type="button" onClick={() => setSteps((items) => [...items, { order: items.length + 1, action: '', expectedResult: '' }])} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs text-text-secondary"><Plus className="h-3.5 w-3.5" />添加步骤</button>
            </div>
            <div className="space-y-2">
              {steps.map((step, index) => (
                <div key={`${step.order}-${index}`} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_32px]">
                  <span className="pt-2 text-center text-xs text-text-muted">{index + 1}</span>
                  <input aria-label={`第 ${index + 1} 步操作`} value={step.action} onChange={(event) => updateStep(index, { action: event.target.value })} placeholder="操作" className="h-9 min-w-0 rounded-md border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" />
                  <input aria-label={`第 ${index + 1} 步预期`} value={step.expectedResult} onChange={(event) => updateStep(index, { expectedResult: event.target.value })} placeholder="预期结果" className="h-9 min-w-0 rounded-md border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" />
                  <button type="button" aria-label={`删除第 ${index + 1} 步`} disabled={steps.length === 1} onClick={() => setSteps((items) => items.filter((_, itemIndex) => itemIndex !== index))} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-error disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
          <label className="block text-xs font-semibold text-text-secondary">最终预期结果<textarea aria-label="最终预期结果" value={expectedResult} onChange={(event) => setExpectedResult(event.target.value)} rows={3} className="mt-1.5 w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500" /></label>
        </div>
        <footer className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-border px-4 text-xs text-text-secondary">取消</button>
          <button type="button" disabled={!isValid || saving} onClick={save} className="h-9 rounded-md bg-brand-500 px-4 text-xs font-semibold text-white disabled:opacity-40">{saving ? '正在保存...' : '保存修改'}</button>
        </footer>
      </section>
    </div>
  )
}
