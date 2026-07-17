import { useState } from 'react'

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

const stepLabels: Record<ModelerStep, string> = {
  1: '输入网址',
  2: '设置关键词',
  3: '抓取网页',
  4: 'AI 建模',
}

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

  return (
    <section className="mx-auto max-w-6xl rounded-2xl bg-slate-950 p-6 text-slate-100">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400">
            Requirement Modeler
          </p>
          <h1 className="text-2xl font-semibold">Requirement document modeling</h1>
        </div>
        <button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2">
          返回测试设计
        </button>
      </div>

      <div className="grid gap-8 md:grid-cols-[15rem_1fr]">
        <nav aria-label="建模步骤" className="border-l border-slate-700 pl-4">
          <ol className="space-y-3">
            {([1, 2, 3, 4] as ModelerStep[]).map(item => (
              <li key={item}>
                <button
                  type="button"
                  aria-current={step === item ? 'step' : undefined}
                  disabled={busy !== null || item > highestStep}
                  onClick={() => goTo(item)}
                  className={`w-full rounded-lg px-3 py-3 text-left ${
                    step === item ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400'
                  }`}
                >
                  <span className="mr-2">{item}.</span>
                  {stepLabels[item]}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="mb-5 text-xl font-semibold">{stepLabels[step]}</h2>

          {step === 1 && (
            <div className="space-y-5">
              <label className="block">
                <span className="mb-2 block">需求文档网址</span>
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
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3"
                />
              </label>
              {urlTouched && !validUrl && (
                <p role="alert" className="text-sm text-rose-300">
                  请输入有效的 HTTP(S) 网址。
                </p>
              )}
              <button
                type="button"
                disabled={!validUrl || busy !== null}
                onClick={() => advance(2)}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-slate-950 disabled:opacity-40"
              >
                下一步：设置关键词
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <label className="block">
                <span className="mb-2 block">关键词过滤（可选）</span>
                <input
                  value={keyword}
                  disabled={busy !== null}
                  onChange={event => {
                    const nextKeyword = event.target.value
                    setKeyword(nextKeyword)
                    setError(null)
                    invalidateCapture(url, nextKeyword)
                  }}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3"
                />
              </label>
              <div className="flex gap-3">
                <button type="button" disabled={busy !== null} onClick={() => setStep(1)} className="rounded-lg border px-4 py-2">
                  上一步
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => advance(3)}
                  className="rounded-lg bg-cyan-500 px-4 py-2 text-slate-950"
                >
                  下一步：抓取网页
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <dl className="rounded-lg bg-slate-950 p-4 text-sm">
                <dt className="text-slate-400">URL</dt>
                <dd className="break-all">{url.trim()}</dd>
                <dt className="mt-3 text-slate-400">关键词</dt>
                <dd>{keyword.trim() || '无'}</dd>
              </dl>
              {captureInvalidated && (
                <p role="status" className="text-amber-300">
                  输入已更改，请重新抓取网页后再进行 AI 建模。
                </p>
              )}
              {!validUrl && (
                <p role="alert" className="text-sm text-rose-300">
                  请输入有效的 HTTP(S) 网址。
                </p>
              )}
              <div className="flex gap-3">
                <button type="button" disabled={busy !== null} onClick={() => setStep(2)} className="rounded-lg border px-4 py-2">
                  上一步
                </button>
                <button
                  type="button"
                  disabled={busy !== null || !validUrl}
                  onClick={capturePage}
                  className="rounded-lg bg-cyan-500 px-4 py-2 text-slate-950 disabled:opacity-40"
                >
                  {busy === 'capture' ? '正在打开并抓取…' : '打开并抓取网页'}
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <label className="block">
                <span className="mb-2 block">需求正文</span>
                <textarea
                  rows={10}
                  value={docText}
                  onChange={event => {
                    setDocText(event.target.value)
                    setError(null)
                  }}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3"
                />
              </label>
              <button
                type="button"
                disabled={busy !== null || !capturedInput || !docText.trim()}
                onClick={generateDraft}
                className="rounded-lg bg-violet-400 px-4 py-2 text-slate-950 disabled:opacity-40"
              >
                {busy === 'generate' ? 'AI 正在解析需求并建模…' : 'AI 解析需求并建模'}
              </button>

              {draft && (
                <fieldset className="space-y-4 rounded-xl border border-slate-700 p-4">
                  <legend className="px-2 font-semibold">模板草稿</legend>
                  <label className="block">
                    <span className="mb-1 block text-sm">模板名称</span>
                    <input
                      value={draft.name}
                      onChange={event => updateDraft({ name: event.target.value })}
                      className="w-full rounded border bg-slate-950 p-2"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm">模板说明</span>
                    <textarea
                      value={draft.description}
                      onChange={event => updateDraft({ description: event.target.value })}
                      className="w-full rounded border bg-slate-950 p-2"
                    />
                  </label>
                  <div>
                    <p className="mb-2 text-sm">步骤</p>
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
                        className="mb-2 w-full rounded border bg-slate-950 p-2"
                      />
                    ))}
                  </div>
                  <div>
                    <p className="mb-2 text-sm">变量</p>
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
                        className="mb-2 w-full rounded border bg-slate-950 p-2"
                      />
                    ))}
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-sm">标签（以英文逗号分隔）</span>
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
                      className="w-full rounded border bg-slate-950 p-2"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={saveDraft}
                    className="rounded-lg bg-emerald-400 px-4 py-2 text-slate-950 disabled:opacity-40"
                  >
                    {busy === 'save' ? '正在保存…' : '保存模板并返回'}
                  </button>
                </fieldset>
              )}

              <button type="button" disabled={busy !== null} onClick={() => setStep(3)} className="rounded-lg border px-4 py-2">
                上一步
              </button>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-5 rounded-lg bg-rose-500/10 p-3 text-rose-300">
              {error}
            </p>
          )}
          {status && !error && (
            <p role="status" className="mt-5 text-sm text-cyan-300">
              {status}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
