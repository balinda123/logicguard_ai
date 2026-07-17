import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ScenarioTemplate } from '../types'
import { browserNavigate, getPageContent } from '../api/browserBridge'
import {
  generateTemplateFromDocument,
  saveCustomTemplate,
} from '../api/templateGenerator'
import { RequirementModeler } from './RequirementModeler'

vi.mock('../api/browserBridge', () => ({
  browserNavigate: vi.fn(),
  getPageContent: vi.fn(),
}))

vi.mock('../api/templateGenerator', () => ({
  generateTemplateFromDocument: vi.fn(),
  saveCustomTemplate: vi.fn(),
}))

const navigateMock = vi.mocked(browserNavigate)
const contentMock = vi.mocked(getPageContent)
const generateMock = vi.mocked(generateTemplateFromDocument)
const saveMock = vi.mocked(saveCustomTemplate)

const generatedTemplate: ScenarioTemplate = {
  id: 'generated-1',
  name: 'Generated flow',
  category: 'form',
  description: 'Generated description',
  targetUrl: 'https://example.com/requirements',
  steps: [
    { order: 1, description: 'Open form', action: 'navigate' },
    { order: 2, description: 'Submit form', action: 'click' },
  ],
  variables: [
    {
      name: 'account',
      label: 'Account',
      type: 'text',
      required: true,
      defaultValue: 'demo',
    },
  ],
  tags: ['smoke', 'form'],
}

function pageContent(content = 'Captured requirement text') {
  return {
    url: 'https://example.com/requirements',
    title: 'Requirements',
    content,
    totalChars: content.length,
    filteredChars: content.length,
    keyword: 'checkout',
    paragraphCount: 1,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

async function reachCapture(keyword = 'checkout') {
  const user = userEvent.setup()
  await user.type(
    screen.getByLabelText('需求文档网址'),
    ' https://example.com/requirements ',
  )
  await user.click(screen.getByRole('button', { name: '下一步：设置关键词' }))
  if (keyword) {
    await user.type(screen.getByLabelText('关键词过滤（可选）'), keyword)
  }
  await user.click(screen.getByRole('button', { name: '下一步：抓取网页' }))
  return user
}

describe('RequirementModeler', () => {
  afterEach(cleanup)

  beforeEach(() => {
    navigateMock.mockResolvedValue({ action: 'navigate', message: 'ok' })
    contentMock.mockResolvedValue(pageContent())
    generateMock.mockResolvedValue(generatedTemplate)
    saveMock.mockReturnValue([generatedTemplate])
  })

  it('keeps the first next action disabled for an invalid URL and shows an inline error', async () => {
    const user = userEvent.setup()
    render(<RequirementModeler onCancel={vi.fn()} onSaved={vi.fn()} />)

    const next = screen.getByRole('button', { name: '下一步：设置关键词' })
    expect(next).toBeDisabled()

    await user.type(screen.getByLabelText('需求文档网址'), 'example.com')
    await user.tab()

    expect(next).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的 HTTP(S) 网址')
  })

  it('captures after navigation, passes the keyword, and preserves values while going back', async () => {
    render(<RequirementModeler onCancel={vi.fn()} onSaved={vi.fn()} />)
    const user = await reachCapture()

    await user.click(screen.getByRole('button', { name: '打开并抓取网页' }))

    expect(await screen.findByLabelText('需求正文')).toHaveValue(
      'Captured requirement text',
    )
    expect(navigateMock).toHaveBeenCalledWith('https://example.com/requirements')
    expect(contentMock).toHaveBeenCalledWith('checkout')
    expect(navigateMock.mock.invocationCallOrder[0]).toBeLessThan(
      contentMock.mock.invocationCallOrder[0],
    )

    await user.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByRole('button', { name: '打开并抓取网页' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByLabelText('关键词过滤（可选）')).toHaveValue('checkout')
    await user.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByLabelText('需求文档网址')).toHaveValue(
      ' https://example.com/requirements ',
    )
  })

  it.each([
    ['empty content', () => contentMock.mockResolvedValue(pageContent(''))],
    ['capture rejection', () => contentMock.mockRejectedValue(new Error('offline'))],
  ])('stays on capture after %s and does not unlock AI generation', async (_name, arrange) => {
    arrange()
    render(<RequirementModeler onCancel={vi.fn()} onSaved={vi.fn()} />)
    const user = await reachCapture()

    await user.click(screen.getByRole('button', { name: '打开并抓取网页' }))

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.getByRole('button', { name: '打开并抓取网页' })).toBeEnabled()
    expect(screen.queryByLabelText('需求正文')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'AI 解析需求并建模' }),
    ).not.toBeInTheDocument()
  })

  it('locks AI modeling when a repeat capture returns empty content', async () => {
    render(<RequirementModeler onCancel={vi.fn()} onSaved={vi.fn()} />)
    const user = await reachCapture()
    await user.click(screen.getByRole('button', { name: '打开并抓取网页' }))
    await screen.findByLabelText('需求正文')
    await user.click(screen.getByRole('button', { name: '上一步' }))
    contentMock.mockResolvedValue(pageContent(''))

    await user.click(screen.getByRole('button', { name: '打开并抓取网页' }))

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.getByRole('button', { name: /4\.\s*AI 建模/ })).toBeDisabled()
  })

  it('locks navigation while capture is pending so stale results cannot commit to changed inputs', async () => {
    const navigation = deferred<{ action: string; message: string }>()
    navigateMock.mockReturnValue(navigation.promise)
    render(<RequirementModeler onCancel={vi.fn()} onSaved={vi.fn()} />)
    const user = await reachCapture()

    await user.click(screen.getByRole('button', { name: '打开并抓取网页' }))

    expect(screen.getByRole('button', { name: /1\.\s*输入网址/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /2\.\s*设置关键词/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: '上一步' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /正在打开并抓取/ })).toBeDisabled()

    navigation.resolve({ action: 'navigate', message: 'ok' })
    expect(await screen.findByLabelText('需求正文')).toHaveValue(
      'Captured requirement text',
    )
  })

  it('disables capture and exposes URL validation when an invalidated URL is invalid', async () => {
    render(<RequirementModeler onCancel={vi.fn()} onSaved={vi.fn()} />)
    const user = await reachCapture()
    await user.click(screen.getByRole('button', { name: '打开并抓取网页' }))
    await screen.findByLabelText('需求正文')
    await user.click(screen.getByRole('button', { name: /1\.\s*输入网址/ }))
    const urlInput = screen.getByLabelText('需求文档网址')
    await user.clear(urlInput)
    await user.type(urlInput, 'not-a-url')
    await user.click(screen.getByRole('button', { name: /3\.\s*抓取网页/ }))

    expect(screen.getByRole('button', { name: '打开并抓取网页' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的 HTTP(S) 网址')
  })

  it('cancels from the always-visible return action', async () => {
    const onCancel = vi.fn()
    render(<RequirementModeler onCancel={onCancel} onSaved={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: '返回测试设计' }))

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('generates from the current document and URL, then persists before notifying the parent', async () => {
    const onSaved = vi.fn()
    render(<RequirementModeler onCancel={vi.fn()} onSaved={onSaved} />)
    const user = await reachCapture()
    await user.click(screen.getByRole('button', { name: '打开并抓取网页' }))

    const documentInput = await screen.findByLabelText('需求正文')
    await user.clear(documentInput)
    await user.type(documentInput, 'Edited current requirement')
    await user.click(screen.getByRole('button', { name: 'AI 解析需求并建模' }))

    expect(generateMock).toHaveBeenCalledWith(
      'Edited current requirement',
      expect.objectContaining({
        targetUrl: 'https://example.com/requirements',
        onProgress: expect.any(Function),
      }),
    )
    expect(await screen.findByDisplayValue('Generated flow')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '保存模板并返回' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(generatedTemplate))
    expect(saveMock).toHaveBeenCalledWith(generatedTemplate)
    expect(saveMock.mock.invocationCallOrder[0]).toBeLessThan(
      onSaved.mock.invocationCallOrder[0],
    )
  })

  it('preserves document text after generation rejection and allows retry', async () => {
    generateMock
      .mockRejectedValueOnce(new Error('model unavailable'))
      .mockResolvedValueOnce(generatedTemplate)
    render(<RequirementModeler onCancel={vi.fn()} onSaved={vi.fn()} />)
    const user = await reachCapture()
    await user.click(screen.getByRole('button', { name: '打开并抓取网页' }))
    const documentInput = await screen.findByLabelText('需求正文')

    await user.click(screen.getByRole('button', { name: 'AI 解析需求并建模' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('model unavailable')
    expect(documentInput).toHaveValue('Captured requirement text')
    const generate = screen.getByRole('button', { name: 'AI 解析需求并建模' })
    expect(generate).toBeEnabled()
    await user.click(generate)
    expect(await screen.findByDisplayValue('Generated flow')).toBeVisible()
    expect(generateMock).toHaveBeenCalledTimes(2)
  })

  it('keeps an edited draft visible when saving fails and does not notify the parent', async () => {
    const onSaved = vi.fn()
    saveMock.mockImplementation(() => {
      throw new Error('disk full')
    })
    render(<RequirementModeler onCancel={vi.fn()} onSaved={onSaved} />)
    const user = await reachCapture()
    await user.click(screen.getByRole('button', { name: '打开并抓取网页' }))
    await screen.findByLabelText('需求正文')
    await user.click(screen.getByRole('button', { name: 'AI 解析需求并建模' }))
    const nameInput = await screen.findByDisplayValue('Generated flow')
    await user.clear(nameInput)
    await user.type(nameInput, 'Edited generated flow')

    await user.click(screen.getByRole('button', { name: '保存模板并返回' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
    expect(screen.getByDisplayValue('Edited generated flow')).toBeVisible()
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Edited generated flow' }),
    )
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('invalidates captured content when the keyword changes and requires recapture', async () => {
    render(<RequirementModeler onCancel={vi.fn()} onSaved={vi.fn()} />)
    const user = await reachCapture()
    await user.click(screen.getByRole('button', { name: '打开并抓取网页' }))
    await screen.findByLabelText('需求正文')

    await user.click(screen.getByRole('button', { name: '上一步' }))
    await user.click(screen.getByRole('button', { name: '上一步' }))
    await user.type(screen.getByLabelText('关键词过滤（可选）'), ' changed')
    await user.click(screen.getByRole('button', { name: '下一步：抓取网页' }))

    expect(screen.getByText('输入已更改，请重新抓取网页后再进行 AI 建模。')).toBeVisible()
    expect(screen.getByRole('button', { name: '打开并抓取网页' })).toBeEnabled()
    expect(screen.queryByLabelText('需求正文')).not.toBeInTheDocument()
  })
})
