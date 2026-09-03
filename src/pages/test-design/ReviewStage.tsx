import { ArrowRight, Check, CheckCircle2, Clock3, Pencil, Trash2 } from 'lucide-react'

import type { TestCase } from '../../types'
import type { TestAccount } from '../../types/workflow'
import { TestCaseCard } from './TestCaseCard'

interface Props {
  cases: TestCase[]
  staleCount: number
  reviewing: boolean
  accounts?: TestAccount[]
  onApprove: (testCase: TestCase) => void
  onEdit: (testCase: TestCase) => void
  onDelete: (testCase: TestCase) => void
  onContinue: () => void
}

export function ReviewStage({ cases, staleCount, reviewing, accounts = [], onApprove, onEdit, onDelete, onContinue }: Props) {
  const reviewComplete = cases.length > 0 && cases.every(testCase => testCase.status === 'confirmed')
  return (
    <section aria-labelledby="review-stage-title" className="space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <h3 id="review-stage-title" className="text-sm font-bold text-text-primary">检查确认</h3>
          <p className="mt-1 text-[11px] text-text-muted">确认记录写入当前设计，不复用其他设计的本地状态。</p>
        </div>
        {staleCount > 0 && <span className="text-[11px] text-warning">{staleCount} 条来源已过期</span>}
      </div>
      {reviewComplete && <div role="status" className="flex flex-wrap items-center justify-between gap-3 border border-success/30 bg-success/5 px-4 py-3">
        <div className="flex items-start gap-2.5"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /><div><p className="text-xs font-semibold text-text-primary">检查完成</p><p className="mt-0.5 text-[11px] text-text-secondary">当前 {cases.length} 条用例已全部确认，可以选择本次范围并执行测试。</p></div></div>
        <button type="button" onClick={onContinue} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-500 px-4 text-xs font-semibold text-white hover:bg-brand-600">下一步：执行测试<ArrowRight className="h-3.5 w-3.5" /></button>
      </div>}
      {cases.length === 0 && <div className="border border-dashed border-border p-8 text-center text-xs text-text-muted">当前需求版本还没有可检查用例。</div>}
      <div className="grid gap-4 xl:grid-cols-2">
        {cases.map((testCase) => (
          <TestCaseCard
            key={testCase.id}
            testCase={testCase}
            accounts={accounts}
            actions={(
              <>
                {testCase.status === 'confirmed' ? (
                  <span className="flex h-8 items-center gap-1.5 text-xs text-success"><Check className="h-3.5 w-3.5" />已确认</span>
                ) : (
                  <button type="button" disabled={reviewing} onClick={() => onApprove(testCase)} className="flex h-8 items-center gap-1.5 rounded-lg border border-success/30 px-3 text-xs text-success disabled:opacity-40"><Clock3 className="h-3.5 w-3.5" />确认</button>
                )}
                <button type="button" aria-label={`编辑 ${testCase.title}`} title="编辑用例" disabled={reviewing} onClick={() => onEdit(testCase)} className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-secondary hover:text-brand-400 disabled:opacity-40"><Pencil className="h-3.5 w-3.5" /></button>
                <button type="button" aria-label={`删除 ${testCase.title}`} title="删除用例" disabled={reviewing} onClick={() => onDelete(testCase)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-error/30 text-error hover:bg-error/10 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
              </>
            )}
          />
        ))}
      </div>
    </section>
  )
}
