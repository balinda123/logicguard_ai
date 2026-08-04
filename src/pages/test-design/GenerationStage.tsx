import { RefreshCw, Sparkles } from 'lucide-react'

import type { TestCase } from '../../types'
import type { GenerationBatch, RequirementVersion } from '../../types/testDesign'

interface Props {
  requirement?: RequirementVersion
  batches: GenerationBatch[]
  cases: TestCase[]
  generating: boolean
  onGenerate: () => void
}

export function GenerationStage({ requirement, batches, cases, generating, onGenerate }: Props) {
  const currentBatch = batches.find((batch) => batch.requirementVersionId === requirement?.id)
  return (
    <section aria-labelledby="generation-stage-title" className="space-y-4">
      <div className="border-b border-border pb-3">
        <h3 id="generation-stage-title" className="text-sm font-bold text-text-primary">生成用例</h3>
        <p className="mt-1 text-[11px] text-text-muted">只根据当前已保存需求版本生成；新版本不会覆盖旧结果。</p>
      </div>
      {!requirement ? (
        <div className="border border-dashed border-border p-8 text-center text-xs text-text-muted">先保存需求版本，才能生成用例。</div>
      ) : (
        <div className="flex items-center justify-between gap-4 border-y border-border py-4">
          <div>
            <div className="text-xs font-semibold text-text-primary">需求 v{requirement.versionNo}</div>
            <div className="mt-1 text-[11px] text-text-muted">{currentBatch ? `已生成 ${cases.filter((item) => item.requirementVersionId === requirement.id).length} 条` : '尚未生成'}</div>
          </div>
          <button type="button" disabled={generating} onClick={onGenerate} className="flex h-9 items-center gap-2 rounded-lg bg-brand-500 px-4 text-xs font-semibold text-white disabled:opacity-40">
            {generating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {currentBatch ? '重新生成一批' : '生成用例'}
          </button>
        </div>
      )}
      {batches.some((batch) => batch.isStale) && <p role="status" className="border-l-2 border-warning bg-warning/5 px-3 py-2 text-xs text-warning">旧批次来源已过期，检查和回归默认只使用当前需求版本。</p>}
    </section>
  )
}
