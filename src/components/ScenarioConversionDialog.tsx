import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'

import { saveWorkflowScenario } from '../api/testingBridge'
import type { TestCase } from '../types'
import type { BusinessRole, ScenarioKind, WorkflowScenario, WorkflowScenarioStep } from '../types/workflow'

interface ScenarioConversionDialogProps {
  testCase: TestCase
  onClose: () => void
  onSaved: (scenario: WorkflowScenario) => void
}

interface EditableStep {
  id: string
  role: BusinessRole
  actionIntent: string
  assertion: string
  pageUrl: string
  selector: string
}

const ROLE_LABEL: Record<BusinessRole, string> = { employee: '员工', manager: '上级', hrbp: 'HRBP' }
const KIND_LABEL: Record<ScenarioKind, string> = { single_role: '单角色', permission: '权限', workflow: '多角色流程', branch: '分支' }

function makeStepId(index: number): string {
  return `workflow-step-${index + 1}`
}

function fromCase(testCase: TestCase): EditableStep[] {
  return testCase.steps
    .sort((left, right) => left.order - right.order)
    .map((step, index) => ({
      id: makeStepId(index),
      role: 'employee',
      actionIntent: step.action,
      assertion: step.expectedResult,
      pageUrl: '',
      selector: '',
    }))
}

function splitLines(value: string): string[] {
  return value.split(/[\n,，]/).map(item => item.trim()).filter(Boolean)
}

export function ScenarioConversionDialog({ testCase, onClose, onSaved }: ScenarioConversionDialogProps) {
  const [title, setTitle] = useState(testCase.title)
  const [scenarioKind, setScenarioKind] = useState<ScenarioKind>('single_role')
  const [tagsText, setTagsText] = useState(testCase.module)
  const [preconditionsText, setPreconditionsText] = useState(testCase.preconditions.join('\n'))
  const [steps, setSteps] = useState<EditableStep[]>(() => fromCase(testCase))
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  if (testCase.status !== 'confirmed') return null

  const updateStep = (index: number, patch: Partial<EditableStep>) => {
    setSteps(current => current.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step))
  }

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= steps.length) return
    setSteps(current => {
      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }

  const addStep = () => {
    setSteps(current => [...current, { id: makeStepId(current.length), role: 'employee', actionIntent: '', assertion: '', pageUrl: '', selector: '' }])
  }

  const removeStep = (index: number) => {
    setSteps(current => current.filter((_, stepIndex) => stepIndex !== index))
  }

  const handleSave = async () => {
    if (!title.trim() || steps.length === 0 || steps.some(step => !step.actionIntent.trim() || !step.assertion.trim())) {
      setNotice('请填写场景名称，并完善每一步操作意图与断言。')
      return
    }
    setSaving(true)
    setNotice('')
    try {
      const now = new Date().toISOString()
      const scenario: WorkflowScenario = {
        id: globalThis.crypto?.randomUUID?.() ?? `workflow-${Date.now()}`,
        sourceTestCaseId: testCase.id,
        title: title.trim(),
        scenarioKind,
        businessTags: splitLines(tagsText),
        preconditions: splitLines(preconditionsText),
        steps: steps.map((step, index): WorkflowScenarioStep => ({
          id: step.id,
          order: index + 1,
          role: step.role,
          actionIntent: step.actionIntent.trim(),
          assertions: [step.assertion.trim()],
          ...(step.pageUrl.trim() ? { pageUrl: step.pageUrl.trim() } : {}),
          ...(step.selector.trim() ? { selector: step.selector.trim() } : {}),
          createdAt: now,
          updatedAt: now,
        })),
        createdAt: now,
        updatedAt: now,
      }
      const saved = await saveWorkflowScenario(scenario)
      onSaved(saved)
    } catch {
      setNotice('流程场景保存失败，请稍后重试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="转换为流程场景" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 p-4 md:items-center">
      <section className="my-4 w-full max-w-4xl space-y-4 rounded-xl border border-border bg-surface-1 p-5 shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-border pb-3"><div><h3 className="text-base font-bold text-text-primary">转换为流程场景</h3><p className="mt-1 text-[11px] text-text-muted">基于已确认用例配置不同角色的连续操作；不保存或展示任何账号凭据。</p></div><button type="button" onClick={onClose} className="text-xs text-text-muted hover:text-text-primary">关闭</button></header>
        {notice && <p role="status" className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning">{notice}</p>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">场景名称</span><input aria-label="场景名称" value={title} onChange={event => setTitle(event.target.value)} className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label>
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">场景类型</span><select aria-label="场景类型" value={scenarioKind} onChange={event => setScenarioKind(event.target.value as ScenarioKind)} className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500">{(Object.keys(KIND_LABEL) as ScenarioKind[]).map(kind => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">业务标签</span><input aria-label="业务标签" value={tagsText} onChange={event => setTagsText(event.target.value)} placeholder="使用英文逗号分隔" className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label>
          <label className="block"><span className="mb-1 block text-[10px] text-text-secondary">前置条件</span><input aria-label="前置条件" value={preconditionsText} onChange={event => setPreconditionsText(event.target.value)} placeholder="使用英文逗号或换行分隔" className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500" /></label>
        </div>
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between"><h4 className="text-sm font-bold text-text-primary">流程步骤</h4><button type="button" onClick={addStep} className="flex h-8 items-center gap-1.5 rounded-lg border border-brand-500/20 px-3 text-xs font-semibold text-brand-400 hover:bg-brand-500/10"><Plus className="h-3.5 w-3.5" />新增步骤</button></div>
          {steps.map((step, index) => <div key={step.id} className="grid grid-cols-1 gap-3 border border-border bg-surface-2/60 p-3 md:grid-cols-[80px_130px_minmax(0,1fr)_minmax(0,1fr)]"><div className="text-xs font-semibold text-text-muted">步骤 {index + 1}</div><label className="block"><span className="mb-1 block text-[10px] text-text-secondary">执行角色</span><select aria-label={`步骤 ${index + 1} 执行角色`} value={step.role} onChange={event => updateStep(index, { role: event.target.value as BusinessRole })} className="h-8 w-full rounded-md border border-border bg-surface-1 px-2 text-xs text-text-primary outline-none">{(Object.keys(ROLE_LABEL) as BusinessRole[]).map(role => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}</select></label><label className="block"><span className="mb-1 block text-[10px] text-text-secondary">操作意图</span><input aria-label={`步骤 ${index + 1} 操作意图`} value={step.actionIntent} onChange={event => updateStep(index, { actionIntent: event.target.value })} className="h-8 w-full rounded-md border border-border bg-surface-1 px-2 text-xs text-text-primary outline-none" /></label><label className="block"><span className="mb-1 block text-[10px] text-text-secondary">断言</span><input aria-label={`步骤 ${index + 1} 断言`} value={step.assertion} onChange={event => updateStep(index, { assertion: event.target.value })} className="h-8 w-full rounded-md border border-border bg-surface-1 px-2 text-xs text-text-primary outline-none" /></label><label className="block md:col-start-3"><span className="mb-1 block text-[10px] text-text-secondary">页面地址（可选）</span><input aria-label={`步骤 ${index + 1} 页面地址`} value={step.pageUrl} onChange={event => updateStep(index, { pageUrl: event.target.value })} className="h-8 w-full rounded-md border border-border bg-surface-1 px-2 text-xs text-text-primary outline-none" /></label><label className="block"><span className="mb-1 block text-[10px] text-text-secondary">安全选择器（可选）</span><input aria-label={`步骤 ${index + 1} 安全选择器`} value={step.selector} onChange={event => updateStep(index, { selector: event.target.value })} placeholder="[data-testid=...]" className="h-8 w-full rounded-md border border-border bg-surface-1 px-2 text-xs text-text-primary outline-none" /></label><div className="flex items-end justify-end gap-1"><button type="button" aria-label={`上移步骤 ${index + 1}`} onClick={() => moveStep(index, -1)} disabled={index === 0} className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-secondary disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" aria-label={`下移步骤 ${index + 1}`} onClick={() => moveStep(index, 1)} disabled={index === steps.length - 1} className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-secondary disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button><button type="button" aria-label={`删除步骤 ${index + 1}`} onClick={() => removeStep(index)} disabled={steps.length === 1} className="flex h-8 w-8 items-center justify-center rounded-md border border-error/20 text-error disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" /></button></div></div>)}
        </div>
        <footer className="flex justify-end gap-2 border-t border-border pt-4"><button type="button" onClick={onClose} className="h-8 rounded-lg border border-border px-3 text-xs text-text-secondary hover:text-text-primary">取消</button><button type="button" onClick={() => void handleSave()} disabled={saving} className="h-8 rounded-lg bg-brand-500 px-3 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50">{saving ? '正在保存...' : '保存流程场景'}</button></footer>
      </section>
    </div>
  )
}
