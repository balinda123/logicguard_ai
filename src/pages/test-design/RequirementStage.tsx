import { useState } from 'react'
import { Globe2, Save } from 'lucide-react'

import type { RequirementVersion } from '../../types/testDesign'
import { RequirementWebImporter } from './RequirementWebImporter'

interface Props {
  content: string
  latest?: RequirementVersion
  saving: boolean
  onContentChange: (content: string) => void
  onSourceKindChange: (sourceKind: 'text' | 'web') => void
  onSave: () => void
}

export function RequirementStage({ content, latest, saving, onContentChange, onSourceKindChange, onSave }: Props) {
  const [showWebImporter, setShowWebImporter] = useState(false)

  if (showWebImporter) {
    return <RequirementWebImporter onCancel={() => setShowWebImporter(false)} onApply={(nextContent) => {
      onContentChange(nextContent)
      onSourceKindChange('web')
      setShowWebImporter(false)
    }} />
  }

  return (
    <section aria-labelledby="requirement-stage-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h3 id="requirement-stage-title" className="text-sm font-bold text-text-primary">需求来源</h3>
          <p className="mt-1 text-[11px] text-text-muted">可手工填写，也可以通过四步流程从网页抓取并由 AI 整理角色、规则和场景。</p>
        </div>
        <div className="flex items-center gap-3">
          {latest && <span className="text-[11px] text-text-muted">当前 v{latest.versionNo}</span>}
          <button type="button" onClick={() => setShowWebImporter(true)} className="flex h-9 items-center gap-2 rounded-lg border border-brand-500/30 bg-brand-500/5 px-4 text-xs font-semibold text-brand-500 hover:bg-brand-500/10">
            <Globe2 className="h-4 w-4" />从网页抓取需求
          </button>
        </div>
      </div>
      <label className="block">
        <span className="mb-2 block text-xs font-semibold text-text-secondary">需求或验收标准</span>
        <textarea
          aria-label="需求或验收标准"
          value={content}
          onChange={(event) => { onContentChange(event.target.value); onSourceKindChange('text') }}
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
