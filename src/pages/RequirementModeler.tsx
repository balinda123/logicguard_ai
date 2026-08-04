import { useState } from 'react'
import {
  ArrowLeft,
  Check,
  FileSearch,
  Globe2,
  Link2,
  Save,
  Search,
  Sparkles,
} from 'lucide-react'

import { browserNavigate, getPageContent } from '../api/browserBridge'
import {
  generateTemplateFromDocument,
  saveCustomTemplate,
} from '../api/templateGenerator'
import type { ScenarioTemplate } from '../types'
import { isHttpUrl, type ModelerStep } from './testDesignWizard'

export interface RequirementModelerProps {
  onCancel: () => void
  onSaved: (template: ScenarioTemplate) => void
}

interface CapturedPageInfo {
  title: string
  url: string
  keyword: string | null
  totalChars: number
  filteredChars: number
  paragraphCount: number
}

const stepLabels: Record<ModelerStep, string> = {
  1: '输入网址',
  2: '设置关键词',
  3: '抓取网页',
  4: 'AI 建模',
}

const stepIcons = {
  1: Link2,
  2: Search,
  3: Globe2,
  4: Sparkles,
} as const

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function RequirementModeler({ onCancel, onSaved }: RequirementModelerProps) {
  const [step, setStep] = useState<ModelerStep>(1)
  const [url, setUrl] = useState('')
  const [keyword, setKeyword] = useState('')
  const [docText, setDocText] = useState('')
  const [capturedInput, setCapturedInput] = useState<{
    url: string
    keyword: string
  } | null>(null)
  const [capturedPage, setCapturedPage] = useState<CapturedPageInfo | null>(null)
  const [draft, setDraft] = useState<ScenarioTemplate | null>(null)
  const [busy, setBusy] = useState<'capture' | 'generate' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [urlTouched, setUrlTouched] = useState(false)
  const [highestStep, setHighestStep] = useState<ModelerStep>(1)
  const [captureInvalidated, setCaptureInvalidated] = useState(false)

  const validUrl = isHttpUrl(url.trim())

  function invalidateCapture(nextUrl: string, nextKeyword: string) {
    if (
      capturedInput &&
      (nextUrl.trim() !== capturedInput.url || nextKeyword.trim() !== capturedInput.keyword)
    ) {
      setCapturedInput(null)
      setCapturedPage(null)
      setDocText('')
      setDraft(null)
      setCaptureInvalidated(true)
      setHighestStep(3)
      setStatus(null)
      setError(null)
    }
  }

  function goTo(nextStep: ModelerStep) {
    if (!busy && nextStep <= highestStep) {
      setStep(nextStep)
    }
  }

  function advance(nextStep: ModelerStep) {
    setStep(nextStep)
    setHighestStep(current => Math.max(current, nextStep) as ModelerStep)
    setError(null)
  }

  async function capturePage() {
    if (busy || !validUrl) return
    setBusy('capture')
    setError(null)
    setCapturedInput(null)
    setCapturedPage(null)
    setDocText('')
    setDraft(null)
    setCaptureInvalidated(false)
    setHighestStep(3)
    setStatus('正在打开并抓取网页…')
    try {
      const normalizedUrl = url.trim()
      const normalizedKeyword = keyword.trim()
      await browserNavigate(normalizedUrl)
      const result = await getPageContent(normalizedKeyword || undefined)
      if (!result.content.trim()) {
        throw new Error('未抓取到有效的需求正文，请检查网页内容或关键词。')
      }
      setDocText(result.content)
      setCapturedInput({ url: normalizedUrl, keyword: normalizedKeyword })
      setCapturedPage({
        title: result.title,
        url: result.url,
        keyword: result.keyword,
        totalChars: result.totalChars,
        filteredChars: result.filteredChars,
        paragraphCount: result.paragraphCount,
      })
      setDraft(null)
      setCaptureInvalidated(false)
      setStatus('网页抓取完成。')
      advance(4)
    } catch (caught) {
      setError(messageFrom(caught, '打开或抓取网页失败，请重试。'))
      setStatus(null)
    } finally {
      setBusy(null)
    }
  }

  async function generateDraft() {
    if (busy || !capturedInput || !docText.trim()) return
    setBusy('generate')
    setError(null)
    setStatus('AI 正在解析需求并建模…')
    try {
      const generated = await generateTemplateFromDocument(docText, {
        targetUrl: url.trim(),
        onProgress: progress => setStatus(progress),
      })
      setDraft(generated)
      setStatus('AI 建模完成。')
    } catch (caught) {
      setError(messageFrom(caught, 'AI 建模失败，请重试。'))
      setStatus(null)
    } finally {
      setBusy(null)
    }
  }

  async function saveDraft() {
    if (busy || !draft) return
    setBusy('save')
    setError(null)
    setStatus('正在保存模板…')
    try {
      await Promise.resolve(saveCustomTemplate(draft))
      onSaved(draft)
    } catch (caught) {
      setError(messageFrom(caught, '保存模板失败，请重试。'))
      setStatus(null)
    } finally {
      setBusy(null)
    }
  }

  const updateDraft = (patch: Partial<ScenarioTemplate>) => {
    setError(null)
    setDraft(current => (current ? { ...current, ...patch } : current))
  }

  const fieldClassName =
    'w-full rounded-lg border border-border bg-surface-2 px-3 text-xs text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-brand-500 disabled:opacity-50'
  const primaryButtonClassName =
    'flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-4 text-xs font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40'
  const secondaryButtonClassName =
    'flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-2 px-4 text-xs font-semibold text-text-secondary transition-colors hover:border-border-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <section
      aria-labelledby="requirement-modeler-title"
      className="h-full overflow-y-auto bg-surface-1 text-text-primary"
    >
      <div className="mx-auto w-full max-w-5xl px-5 py-5 sm:px-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h1 id="requirement-modeler-title" className="text-lg font-bold text-text-primary">
              需求文档建模
            </h1>
            <p className="mt-1 text-xs text-text-muted">
              从网页提取需求正文并生成可复用的场景模板
            </p>
          </div>
          <button type="button" onClick={onCancel} className={secondaryButtonClassName}>
            <ArrowLeft className="h-3.5 w-3.5" />
            返回测试设计
          </button>
        </header>

        <nav aria-label="建模步骤" className="overflow-x-auto border-b border-border py-4">
          <ol className="grid min-w-[640px] grid-cols-4 gap-2">
            {([1, 2, 3, 4] as ModelerStep[]).map(item => {
              const active = step === item
              const completed = item < highestStep
              const locked = item > highestStep
              const Icon = stepIcons[item]

              return (
                <li key={item}>
                  <button
                    type="button"
                    aria-label={`${item}. ${stepLabels[item]}`}
                    aria-current={active ? 'step' : undefined}
                    disabled={busy !== null || locked}
                    onClick={() => goTo(item)}
                    className={`flex h-14 w-full items-center gap-2 rounded-lg border px-3 text-left transition-colors ${
                      active
                        ? 'border-brand-500/30 bg-brand-500/10 text-brand-600'
                        : completed
                          ? 'border-success/20 bg-success/5 text-text-secondary'
                          : locked
                            ? 'border-border bg-surface-2/50 text-text-muted opacity-50'
                            : 'border-border bg-surface-2 text-text-secondary hover:border-brand-500/30'
                    }`}
                  >
                    <span
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                        active
                          ? 'bg-brand-500 text-white'
                          : completed
                            ? 'bg-success/10 text-success'
                            : 'bg-surface-3 text-text-muted'
                      }`}
                    >
                      {completed ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Icon className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[10px] opacity-70">步骤 {item}</span>
                      <span className="block truncate text-xs font-semibold">{stepLabels[item]}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>

        <main className="mx-auto w-full max-w-2xl py-6">
          <div className="mb-5">
            <p className="text-[10px] font-semibold text-brand-500">步骤 {step} / 4</p>
            <h2 className="mt-1 text-base font-bold text-text-primary">{stepLabels[step]}</h2>
          </div>

          {step === 1 && (
            <div className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-text-secondary">
                  需求文档网址
                </span>
                <input
                  value={url}
                  disabled={busy !== null}
                  onChange={event => {
                    const nextUrl = event.target.value
                    setUrl(nextUrl)
                    setError(null)
                    invalidateCapture(nextUrl, keyword)
                  }}
                  onBlur={() => setUrlTouched(true)}
                  placeholder="https://example.com/requirements"
                  className={`${fieldClassName} h-10`}
                />
              </label>
              {urlTouched && !validUrl && (
                <p role="alert" className="text-xs text-error">
                  请输入有效的 HTTP(S) 网址。
                </p>
              )}
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={!validUrl || busy !== null}
                  onClick={() => advance(2)}
                  className={primaryButtonClassName}
                >
                  下一步：设置关键词
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-text-secondary">
                  关键词过滤（可选）
                </span>
                <input
                  value={keyword}
                  disabled={busy !== null}
                  onChange={event => {
                    const nextKeyword = event.target.value
                    setKeyword(nextKeyword)
                    setError(null)
                    invalidateCapture(url, nextKeyword)
                  }}
                  placeholder="例如：登录、订单、结算"
                  className={`${fieldClassName} h-10`}
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" disabled={busy !== null} onClick={() => setStep(1)} className={secondaryButtonClassName}>
                  上一步
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => advance(3)}
                  className={primaryButtonClassName}
                >
                  下一步：抓取网页
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="space-y-4 rounded-lg border border-border bg-surface-2/60 p-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-text-secondary">
                    需求文档网址
                  </span>
                  <input
                    value={url}
                    disabled={busy !== null}
                    onChange={event => {
                      const nextUrl = event.target.value
                      setUrl(nextUrl)
                      invalidateCapture(nextUrl, keyword)
                    }}
                    onBlur={() => setUrlTouched(true)}
                    className={`${fieldClassName} h-10`}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-text-secondary">
                    关键词过滤（可选）
                  </span>
                  <input
                    value={keyword}
                    disabled={busy !== null}
                    onChange={event => {
                      const nextKeyword = event.target.value
                      setKeyword(nextKeyword)
                      invalidateCapture(url, nextKeyword)
                    }}
                    className={`${fieldClassName} h-10`}
                  />
                </label>
              </div>
              {captureInvalidated && (
                <p role="status" className="rounded-lg border border-warning/20 bg-warning/10 p-3 text-xs text-warning">
                  输入已更改，请重新抓取网页后再进行 AI 建模。
                </p>
              )}
              {!validUrl && (
                <p role="alert" className="text-xs text-error">
                  请输入有效的 HTTP(S) 网址。
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" disabled={busy !== null} onClick={() => setStep(2)} className={secondaryButtonClassName}>
                  上一步
                </button>
                <div className="flex flex-wrap items-center gap-3">
                  {capturedInput && docText.trim() && !captureInvalidated && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => advance(4)}
                      className={secondaryButtonClassName}
                    >
                      继续使用已抓取正文
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy !== null || !validUrl}
                    onClick={capturePage}
                    className={primaryButtonClassName}
                  >
                    <FileSearch className="h-3.5 w-3.5" />
                    {busy === 'capture' ? '正在打开并抓取…' : '打开并抓取网页'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              {capturedPage && (
                <section
                  aria-label="抓取信息"
                  className="rounded-lg border border-border bg-surface-2/60 p-4 text-xs"
                >
                  <p className="font-semibold text-text-secondary">抓取信息</p>
                  <p className="mt-2 font-medium text-text-primary">{capturedPage.title || '未命名页面'}</p>
                  <p className="mt-1 break-all text-text-muted">{capturedPage.url}</p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-text-secondary">
                    <span>关键词：{capturedPage.keyword || '未筛选'}</span>
                    <span>正文：{capturedPage.filteredChars} 字</span>
                    <span>段落：{capturedPage.paragraphCount}</span>
                  </div>
                </section>
              )}
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-text-secondary">
                  需求正文
                </span>
                <textarea
                  rows={10}
                  value={docText}
                  onChange={event => {
                    setDocText(event.target.value)
                    setError(null)
                  }}
                  className={`${fieldClassName} min-h-56 p-3 leading-relaxed`}
                />
              </label>
              <button
                type="button"
                disabled={busy !== null || !capturedInput || !docText.trim()}
                onClick={generateDraft}
                className={primaryButtonClassName}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {busy === 'generate' ? 'AI 正在解析需求并建模…' : 'AI 解析需求并建模'}
              </button>

              {draft && (
                <fieldset className="space-y-4 rounded-lg border border-border bg-surface-2/40 p-4">
                  <legend className="px-2 text-sm font-bold text-text-primary">模板草稿</legend>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-text-secondary">模板名称</span>
                    <input
                      value={draft.name}
                      onChange={event => updateDraft({ name: event.target.value })}
                      className={`${fieldClassName} h-10`}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-text-secondary">模板说明</span>
                    <textarea
                      value={draft.description}
                      onChange={event => updateDraft({ description: event.target.value })}
                      className={`${fieldClassName} min-h-24 p-3 leading-relaxed`}
                    />
                  </label>
                  <div>
                    <p className="mb-2 text-xs font-semibold text-text-secondary">步骤</p>
                    {draft.steps.map((draftStep, index) => (
                      <input
                        key={`${draftStep.order}-${index}`}
                        aria-label={`步骤 ${index + 1}`}
                        value={draftStep.description}
                        onChange={event =>
                          updateDraft({
                            steps: draft.steps.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, description: event.target.value }
                                : item,
                            ),
                          })
                        }
                        className={`${fieldClassName} mb-2 h-10`}
                      />
                    ))}
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold text-text-secondary">变量</p>
                    {draft.variables.map((variable, index) => (
                      <input
                        key={`${variable.name}-${index}`}
                        aria-label={`变量 ${index + 1}`}
                        value={variable.name}
                        onChange={event =>
                          updateDraft({
                            variables: draft.variables.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, name: event.target.value } : item,
                            ),
                          })
                        }
                        className={`${fieldClassName} mb-2 h-10`}
                      />
                    ))}
                  </div>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-text-secondary">标签（以英文逗号分隔）</span>
                    <input
                      value={draft.tags.join(', ')}
                      onChange={event =>
                        updateDraft({
                          tags: event.target.value
                            .split(',')
                            .map(tag => tag.trim())
                            .filter(Boolean),
                        })
                      }
                      className={`${fieldClassName} h-10`}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={saveDraft}
                    className={primaryButtonClassName}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {busy === 'save' ? '正在保存…' : '保存模板并返回'}
                  </button>
                </fieldset>
              )}

              <button type="button" disabled={busy !== null} onClick={() => setStep(3)} className={secondaryButtonClassName}>
                上一步
              </button>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-5 rounded-lg border border-error/20 bg-error/10 p-3 text-xs text-error">
              {error}
            </p>
          )}
          {status && !error && (
            <p role="status" className="mt-5 rounded-lg border border-brand-500/20 bg-brand-500/10 p-3 text-xs text-brand-600">
              {status}
            </p>
          )}
        </main>
      </div>
    </section>
  )
}
