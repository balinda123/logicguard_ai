import { useState } from 'react'
import { ArrowLeft, Check, FileSearch, Link2, Search, Sparkles } from 'lucide-react'

import { captureRequirementPage, type CapturedRequirementPage } from '../../api/browserBridge'
import { generateRequirementModelFromDocument, type RequirementModel } from '../../api/templateGenerator'
import { isHttpUrl, type ModelerStep } from '../testDesignWizard'

interface Props {
  onCancel: () => void
  onApply: (content: string) => void
}

const labels: Record<ModelerStep, string> = { 1: '输入网址', 2: '设置关键词', 3: '抓取网页', 4: 'AI 整理需求' }
const icons = { 1: Link2, 2: Search, 3: FileSearch, 4: Sparkles } as const

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error)
}

function captureErrorMessage(error: unknown): string {
  const message = errorMessage(error)
  if (message.includes('REQUIREMENT_CONTENT_UNREADABLE')) {
    return '在线文档正文未提供可读的 DOM 或可访问性文本，请确认文档已完全加载，或改用手工填写。'
  }
  if (!message.includes('AI_REQUIREMENT_EXTRACTION_FAILED')) return message
  // Sidecar 已对两阶段原因做脱敏和限长；界面按能力缺失、正文为空和其他异常分别给出可执行提示。
  if (/tool|function|schema|unsupported|not support|404|405/i.test(message)) {
    return '当前模型网关不支持页面 AI 提取所需的结构化输出或工具调用，请更换支持这些能力的模型后重试。'
  }
  if (/未返回有效正文|no content|empty/i.test(message)) {
    return 'AI 没有识别到可用正文，请确认在线文档已完全加载并显示正文后重试。'
  }
  return `AI 未能提取需求正文。${message.replace(/^.*AI_REQUIREMENT_EXTRACTION_FAILED:\s*/, '原因：')}`
}

function modeledRequirement(page: CapturedRequirementPage, documentText: string, draft: RequirementModel): string {
  const roles = draft.roles.map((item) => `- ${item.name}：${item.responsibilities.join('；') || '职责以需求正文为准'}`).join('\n')
  const transitions = draft.stateTransitions.map((item) => `- ${item.from || '初始状态'} → ${item.to || '目标状态'}；${item.role || '系统'}执行“${item.trigger || '状态变更'}”`).join('\n')
  const rules = draft.validationRules.map((item) => `- ${item.field || '通用规则'}：${item.rule}${item.boundaries.length ? `；边界：${item.boundaries.join('、')}` : ''}`).join('\n')
  const scenarios = draft.scenarios.map((item) => `- [${item.type}] ${item.name}${item.roles.length ? `（角色：${item.roles.join('、')}）` : ''}`).join('\n')
  return [
    `来源页面：${page.title || '未命名页面'}`,
    `来源网址：${page.url}`,
    page.keyword ? `抓取关键词：${page.keyword}` : '',
    '',
    '需求正文：',
    documentText.trim(),
    '',
    'AI 整理结果：',
    `主题：${draft.name}`,
    `摘要：${draft.summary}`,
    draft.preconditions.length ? `\n前置条件：\n${draft.preconditions.map((item) => `- ${item}`).join('\n')}` : '',
    roles ? `\n角色职责：\n${roles}` : '',
    transitions ? `\n状态流转：\n${transitions}` : '',
    rules ? `\n校验规则：\n${rules}` : '',
    scenarios ? `\n覆盖场景：\n${scenarios}` : '',
  ].filter((item) => item !== '').join('\n')
}

export function RequirementWebImporter({ onCancel, onApply }: Props) {
  const [step, setStep] = useState<ModelerStep>(1)
  const [highestStep, setHighestStep] = useState<ModelerStep>(1)
  const [url, setUrl] = useState('')
  const [keyword, setKeyword] = useState('')
  const [aiMatch, setAiMatch] = useState(false)
  const [page, setPage] = useState<CapturedRequirementPage>()
  const [documentText, setDocumentText] = useState('')
  const [draft, setDraft] = useState<RequirementModel>()
  const [busy, setBusy] = useState<'capture' | 'model'>()
  const [error, setError] = useState('')
  const validUrl = isHttpUrl(url.trim())

  const advance = (next: ModelerStep) => {
    setStep(next)
    setHighestStep((current) => Math.max(current, next) as ModelerStep)
    setError('')
  }

  const invalidateCapture = (fallbackStep: ModelerStep) => {
    const hadCapturedPage = !!page
    setPage(undefined)
    setDocumentText('')
    setDraft(undefined)
    setHighestStep(hadCapturedPage ? 3 : fallbackStep)
    setError('')
  }

  const capture = async () => {
    if (!validUrl || busy) return
    setBusy('capture')
    setError('')
    try {
      const result = await captureRequirementPage(url.trim(), keyword, { aiMatch })
      if (!result.content.trim()) throw new Error('没有抓取到正文，请调整关键词或检查页面内容。')
      setPage(result)
      setDocumentText(result.content)
      setDraft(undefined)
      advance(4)
    } catch (caught) {
      setError(`抓取失败：${captureErrorMessage(caught)}`)
    } finally {
      setBusy(undefined)
    }
  }

  const model = async () => {
    if (!page || !documentText.trim() || busy) return
    setBusy('model')
    setError('')
    try {
      setDraft(await generateRequirementModelFromDocument(documentText, { targetUrl: page.url }))
    } catch (caught) {
      setError(`AI 整理失败：${errorMessage(caught)}`)
    } finally {
      setBusy(undefined)
    }
  }

  const inputClass = 'w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none focus:border-brand-500'
  const secondary = 'flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-1 px-4 text-xs font-semibold text-text-secondary disabled:opacity-40'
  const primary = 'flex h-9 items-center gap-2 rounded-lg bg-brand-500 px-4 text-xs font-semibold text-white disabled:opacity-40'

  return (
    <section aria-label="需求文档建模" className="space-y-5">
      <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div><h3 className="text-base font-bold text-text-primary">从网页抓取需求</h3><p className="mt-1 text-xs text-text-muted">提取网页正文并由 AI 整理成可生成用例的需求</p></div>
        <button type="button" className={secondary} onClick={onCancel}><ArrowLeft className="h-4 w-4" />返回手工填写</button>
      </header>

      <ol aria-label="抓取需求步骤" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {([1, 2, 3, 4] as ModelerStep[]).map((item) => {
          const Icon = icons[item]
          const completed = item < highestStep
          return <li key={item}><button type="button" disabled={!!busy || item > highestStep} onClick={() => setStep(item)} aria-current={step === item ? 'step' : undefined} className={`flex h-14 w-full items-center gap-2 rounded-lg border px-3 text-left ${step === item ? 'border-brand-500 bg-brand-500/10 text-brand-500' : 'border-border bg-surface-2 text-text-secondary'} disabled:opacity-40`}><span className="grid h-7 w-7 place-items-center rounded-full bg-surface-1">{completed ? <Check className="h-4 w-4 text-success" /> : <Icon className="h-4 w-4" />}</span><span><span className="block text-[10px] opacity-70">步骤 {item}</span><span className="text-xs font-semibold">{labels[item]}</span></span></button></li>
        })}
      </ol>

      <div className="mx-auto max-w-3xl space-y-5">
        <div><p className="text-[10px] font-semibold text-brand-500">步骤 {step} / 4</p><h4 className="mt-1 text-sm font-bold text-text-primary">{labels[step]}</h4></div>
        {step === 1 && <>
          <label className="block"><span className="mb-2 block text-xs font-semibold text-text-secondary">需求文档网址</span><input aria-label="需求文档网址" className={`${inputClass} h-10`} value={url} onChange={(event) => { setUrl(event.target.value); invalidateCapture(1) }} placeholder="https://example.com/prd" /></label>
          {url && !validUrl && <p role="alert" className="text-xs text-error">请输入有效的 HTTP(S) 网址。</p>}
          <div className="flex justify-end"><button type="button" className={primary} disabled={!validUrl} onClick={() => advance(2)}>下一步：设置关键词</button></div>
        </>}
        {step === 2 && <>
          <label className="block"><span className="mb-2 block text-xs font-semibold text-text-secondary">需求关键词（可选，可填写多个）</span><textarea aria-label="需求关键词（可选，可填写多个）" className={`${inputClass} min-h-24 resize-y py-3 leading-relaxed`} value={keyword} onChange={(event) => { setKeyword(event.target.value); invalidateCapture(2) }} placeholder={'例如：3.1 输入字数与提交校验；3.2 员工端 - 结果查看\n支持中文分号“；”，也可以一行填写一个需求'} /><span className="mt-2 block text-[11px] text-text-muted">多个需求请用中文分号“；”分隔，或一行填写一个关键词。</span></label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface-2 p-3">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-500" checked={aiMatch} onChange={(event) => { setAiMatch(event.target.checked); invalidateCapture(2) }} />
            <span><span className="block text-xs font-semibold text-text-primary">使用 AI 语义匹配</span><span className="mt-1 block text-[11px] leading-relaxed text-text-muted">发送当前页面可见内容或截图至当前模型并消耗 Token；AI 仅可读取、滚动和提取页面。</span></span>
          </label>
          <div className="flex justify-between"><button type="button" className={secondary} onClick={() => setStep(1)}>上一步</button><button type="button" className={primary} onClick={() => advance(3)}>下一步：抓取网页</button></div>
        </>}
        {step === 3 && <>
          <div className="rounded-lg border border-border bg-surface-2 p-4 text-xs text-text-secondary"><p><strong>网址：</strong>{url}</p><p className="mt-2 whitespace-pre-wrap"><strong>关键词：</strong>{keyword || '不过滤，提取正文区域'}</p><p className="mt-2"><strong>匹配方式：</strong>{aiMatch ? 'AI 语义匹配（消耗 Token）' : '页面原文匹配（不消耗 Token）'}</p></div>
          <div className="flex justify-between"><button type="button" className={secondary} disabled={!!busy} onClick={() => setStep(2)}>上一步</button><button type="button" className={primary} disabled={!validUrl || !!busy} onClick={() => void capture()}>{aiMatch ? <Sparkles className="h-4 w-4" /> : <FileSearch className="h-4 w-4" />}{busy === 'capture' ? (aiMatch ? 'AI 正在匹配…' : '正在抓取…') : (aiMatch ? 'AI 匹配并抓取' : '打开并抓取网页')}</button></div>
        </>}
        {step === 4 && page && <>
          <div className="rounded-lg border border-border bg-surface-2 p-4 text-xs text-text-secondary"><p className="font-semibold text-text-primary">{page.title || '未命名页面'}</p><p className="mt-1 break-all text-text-muted">{page.url}</p><p className="mt-2">关键词：{page.keyword || '未筛选'} / 正文：{page.filteredChars} 字 / 段落：{page.paragraphCount}</p></div>
          {page.usedAiMatch
            ? <p role="status" className="rounded-lg border border-success/30 bg-success/5 p-3 text-xs text-text-secondary">已由 AI 按语义匹配需求内容（{page.aiMatchMethod === 'vision' ? '页面截图' : '页面可访问性内容'}），请核对正文后再继续整理。</p>
            : page.usedAccessibilityFallback && page.usedFullTextFallback
            ? <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">在线文档正文由画布渲染，已改用不消耗 Token 的页面可访问性文本；关键词仍未匹配，已提取完整正文供核对。</p>
            : page.usedAccessibilityFallback
            ? <p role="status" className="rounded-lg border border-success/30 bg-success/5 p-3 text-xs text-text-secondary">在线文档正文由画布渲染，已使用不消耗 Token 的页面可访问性文本匹配标题。</p>
            : page.usedFullTextFallback
            ? <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">填写的关键词均未匹配页面原文，已回退提取完整正文，请检查后再继续。</p>
            : !!page.unmatchedKeywords?.length && <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">以下关键词未匹配，已保留其他匹配章节：{page.unmatchedKeywords.join('；')}</p>}
          <label className="block"><span className="mb-2 block text-xs font-semibold text-text-secondary">需求正文</span><textarea aria-label="需求正文" className={`${inputClass} min-h-56 p-3 leading-relaxed`} value={documentText} onChange={(event) => { setDocumentText(event.target.value); setDraft(undefined) }} /></label>
          <div className="flex flex-wrap justify-between gap-3"><button type="button" className={secondary} disabled={!!busy} onClick={() => setStep(3)}>上一步</button><button type="button" className={primary} disabled={!documentText.trim() || !!busy} onClick={() => void model()}><Sparkles className="h-4 w-4" />{busy === 'model' ? 'AI 正在整理…' : 'AI 整理角色、规则和场景'}</button></div>
          {draft && <section aria-label="AI 整理结果" className="space-y-4 rounded-lg border border-success/30 bg-success/5 p-4 text-xs"><div><p className="font-bold text-text-primary">{draft.name}</p><p className="mt-1 text-text-secondary">{draft.summary}</p></div>{draft.roles.length > 0 && <div><p className="font-semibold text-text-primary">角色职责</p><ul className="mt-1 space-y-1 text-text-secondary">{draft.roles.map((item) => <li key={item.name}>• {item.name}：{item.responsibilities.join('；') || '以需求正文为准'}</li>)}</ul></div>}{draft.stateTransitions.length > 0 && <div><p className="font-semibold text-text-primary">状态流转</p><ul className="mt-1 space-y-1 text-text-secondary">{draft.stateTransitions.map((item, index) => <li key={`${item.from}-${item.to}-${index}`}>• {item.from || '初始状态'} → {item.to || '目标状态'}（{item.role || '系统'}：{item.trigger || '状态变更'}）</li>)}</ul></div>}{draft.validationRules.length > 0 && <div><p className="font-semibold text-text-primary">校验规则</p><ul className="mt-1 space-y-1 text-text-secondary">{draft.validationRules.map((item, index) => <li key={`${item.field}-${index}`}>• {item.field || '通用规则'}：{item.rule}{item.boundaries.length ? `；边界：${item.boundaries.join('、')}` : ''}</li>)}</ul></div>}{draft.scenarios.length > 0 && <div><p className="font-semibold text-text-primary">覆盖场景</p><ul className="mt-1 space-y-1 text-text-secondary">{draft.scenarios.map((item, index) => <li key={`${item.name}-${index}`}>• {item.name}{item.roles.length ? `（${item.roles.join('、')}）` : ''}</li>)}</ul></div>}<div className="flex justify-end"><button type="button" className={primary} onClick={() => onApply(modeledRequirement(page, documentText, draft))}><Check className="h-4 w-4" />使用整理结果</button></div></section>}
        </>}
        {error && <p role="alert" className="rounded-lg border border-error/30 bg-error/10 p-3 text-xs text-error">{error}</p>}
      </div>
    </section>
  )
}
