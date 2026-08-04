import { Save } from 'lucide-react'

import type { RequirementVersion } from '../../types/testDesign'

interface Props {
  content: string
  latest?: RequirementVersion
  saving: boolean
  onContentChange: (content: string) => void
  onSave: () => void
}

export function RequirementStage({ content, latest, saving, onContentChange, onSave }: Props) {
  return (
    <section aria-labelledby="requirement-stage-title" className="space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <h3 id="requirement-stage-title" className="text-sm font-bold text-text-primary">需求来源</h3>
          <p className="mt-1 text-[11px] text-text-muted">需求按版本保存，后续用例始终引用明确版本。</p>
        </div>
        {latest && <span className="text-[11px] text-text-muted">当前 v{latest.versionNo}</span>}
      </div>
      <label className="block">
        <span className="mb-2 block text-xs font-semibold text-text-secondary">需求或验收标准</span>
        <textarea
          aria-label="需求或验收标准"
          value={content}
          onChange={(event) => onContentChange(event.target.value)}
          className="min-h-48 w-full rounded-lg border border-border bg-surface-2 p-3 text-xs leading-relaxed text-text-primary outline-none focus:border-brand-500"
          placeholder="粘贴需求、验收标准或关键业务规则"
        />
      </label>
      <div className="flex justify-end">
        <button type="button" disabled={saving || !content.trim() || content.trim() === latest?.content} onClick={onSave} className="flex h-9 items-center gap-2 rounded-lg bg-brand-500 px-4 text-xs font-semibold text-white disabled:opacity-40">
          <Save className="h-3.5 w-3.5" />保存新版本
        </button>
      </div>
    </section>
  )
}
