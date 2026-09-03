import { useEffect, useState } from 'react'
import { Check, Circle, Clock3, RefreshCw, Sparkles, XCircle } from 'lucide-react'

import type { TestCase } from '../../types'
import type { GenerationBatch, RequirementVersion } from '../../types/testDesign'
import type { AccountEnvironmentScope, TestAccount } from '../../types/workflow'
import { TestAccountsPanel } from '../../components/TestAccountsPanel'

interface Props {
  requirement?: RequirementVersion
  batches: GenerationBatch[]
  cases: TestCase[]
  generating: boolean
  progress?: {
    phase: 'preparing' | 'requesting' | 'parsing' | 'saving' | 'completed' | 'failed'
    startedAt: number
    generatedCount?: number
    message?: string
  }
  accountScope: AccountEnvironmentScope
  canManageAccounts: boolean
  onAccountsChanged: (accounts: TestAccount[]) => void
  onGenerate: () => void
}

const GENERATION_STEPS = [
  { phase: 'preparing', label: '读取需求与测试账号', detail: '确认需求版本、业务角色和可用账号' },
  { phase: 'requesting', label: 'AI 规划并生成用例', detail: '覆盖正常流程、边界、异常和多角色流转' },
  { phase: 'parsing', label: '检查生成结果', detail: '校验用例结构、账号绑定和步骤顺序' },
  { phase: 'saving', label: '保存到当前设计', detail: '写入用例后即可逐条检查和修改' },
] as const

function GenerationWorkflow({ progress }: Pick<Props, 'progress'>) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!progress || progress.phase === 'completed' || progress.phase === 'failed') return
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - progress.startedAt) / 1000)))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [progress])
  if (!progress) return null

  const activeIndex = progress.phase === 'completed'
    ? GENERATION_STEPS.length
    : Math.max(0, GENERATION_STEPS.findIndex((item) => item.phase === progress.phase))
  return (
    <section aria-label="用例生成进度" aria-live="polite" className="border border-brand-500/25 bg-brand-500/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div>
          <h4 className="text-xs font-bold text-text-primary">{progress.phase === 'failed' ? '生成未完成' : progress.phase === 'completed' ? '用例生成完成' : 'AI 正在生成用例'}</h4>
          <p className="mt-1 text-[11px] text-text-muted">
            {progress.phase === 'requesting' ? '模型会一次返回完整结果，等待期间不会伪造尚未生成的用例。' : '这里展示真实处理阶段。'}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] text-text-secondary"><Clock3 className="h-3.5 w-3.5" />已用时 {elapsed} 秒</span>
      </div>
      <ol className="mt-3 grid gap-2 md:grid-cols-4">
        {GENERATION_STEPS.map((item, index) => {
          const done = activeIndex > index
          const active = activeIndex === index && progress.phase !== 'failed'
          return (
            <li key={item.phase} className={`min-h-20 border p-3 ${active ? 'border-brand-500 bg-surface-1' : done ? 'border-success/25 bg-success/5' : 'border-border bg-surface-2/50'}`}>
              <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                {done ? <Check className="h-4 w-4 text-success" /> : active ? <RefreshCw className="h-4 w-4 animate-spin text-brand-400" /> : <Circle className="h-4 w-4 text-text-muted" />}
                {item.label}
              </div>
              <p className="mt-2 text-[10px] leading-4 text-text-muted">{item.detail}</p>
            </li>
          )
        })}
      </ol>
      {progress.phase === 'completed' && <p className="mt-3 flex items-center gap-2 text-xs text-success"><Check className="h-4 w-4" />已生成并保存 {progress.generatedCount ?? 0} 条用例，正在进入检查页面。</p>}
      {progress.phase === 'failed' && <p role="alert" className="mt-3 flex items-start gap-2 text-xs text-error"><XCircle className="mt-0.5 h-4 w-4 shrink-0" />{progress.message || '生成失败，请检查模型连接后重试。'}</p>}
    </section>
  )
}

export function GenerationStage({ requirement, batches, cases, generating, progress, accountScope, canManageAccounts, onAccountsChanged, onGenerate }: Props) {
  const currentBatch = batches.find((batch) => batch.requirementVersionId === requirement?.id)
  return (
    <section aria-labelledby="generation-stage-title" className="space-y-4">
      <div className="border-b border-border pb-3">
        <h3 id="generation-stage-title" className="text-sm font-bold text-text-primary">生成用例</h3>
        <p className="mt-1 text-[11px] text-text-muted">先配置本系统需要参与流程的账号，再让 AI 根据当前需求生成单角色和跨角色用例。</p>
      </div>
      <TestAccountsPanel canManage={canManageAccounts} scope={accountScope} onAccountsChanged={onAccountsChanged} />
      <GenerationWorkflow progress={progress} />
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
