import { Check, Clock3 } from 'lucide-react'

import type { TestCase } from '../../types'

interface Props {
  cases: TestCase[]
  staleCount: number
  reviewing: boolean
  onApprove: (testCase: TestCase) => void
}

export function ReviewStage({ cases, staleCount, reviewing, onApprove }: Props) {
  return (
    <section aria-labelledby="review-stage-title" className="space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <h3 id="review-stage-title" className="text-sm font-bold text-text-primary">检查确认</h3>
          <p className="mt-1 text-[11px] text-text-muted">确认记录写入当前设计，不复用其他设计的本地状态。</p>
        </div>
        {staleCount > 0 && <span className="text-[11px] text-warning">{staleCount} 条来源已过期</span>}
      </div>
      {cases.length === 0 && <div className="border border-dashed border-border p-8 text-center text-xs text-text-muted">当前需求版本还没有可检查用例。</div>}
      <div className="divide-y divide-border border-y border-border">
        {cases.map((testCase) => (
          <article key={testCase.id} className="grid gap-3 py-4 lg:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-text-primary">{testCase.title}</span>
                <span className="text-[10px] text-text-muted">{testCase.priority}</span>
              </div>
              <p className="mt-1 text-[11px] text-text-secondary">{testCase.riskPoint}</p>
              <ol className="mt-2 space-y-1 text-[11px] text-text-muted">
                {testCase.steps.map((step) => <li key={step.order}>{step.order}. {step.action} → {step.expectedResult}</li>)}
              </ol>
            </div>
            {testCase.status === 'confirmed' ? (
              <span className="flex h-8 items-center gap-1.5 text-xs text-success"><Check className="h-3.5 w-3.5" />已确认</span>
            ) : (
              <button type="button" disabled={reviewing} onClick={() => onApprove(testCase)} className="flex h-8 items-center gap-1.5 rounded-lg border border-success/30 px-3 text-xs text-success disabled:opacity-40"><Clock3 className="h-3.5 w-3.5" />确认</button>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
