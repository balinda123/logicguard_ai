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
    screen.getByLabelText('闇€姹傛枃妗ｇ綉鍧€'),
    ' https://example.com/requirements ',
  )
  await user.click(screen.getByRole('button', { name: '涓嬩竴姝ワ細璁剧疆鍏抽敭璇峘' }))
  if (keyword) {
    await user.type(screen.getByLabelText('鍏抽敭璇嶈繃婊わ紙鍙€夛級'), keyword)
  }
  await user.click(screen.getByRole('button', { name: '涓嬩竴姝ワ細鎶撳彇缃戦〉' }))
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

    const next = screen.getByRole('button', { name: '涓嬩竴姝ワ細璁剧疆鍏抽敭璇峘' })
    expect(next).toBeDisabled()

    await user.type(screen.getByLabelText('闇€姹傛枃妗ｇ綉鍧€'), 'example.com')
    await user.tab()

    expect(next).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP')
  })

  it('captures after navigation, passes the keyword, and preserves values while going back', async () => {
    render(<RequirementModeler onCancel={vi.fn()} onSaved={vi.fn()} />)
    const user = await reachCapture()

    await user.click(screen.getByRole('button', { name: '鎵撳紑骞舵姄鍙栫綉椤礰' }))

    expect(await screen.findByLabelText('闇€姹傛鏂嘸')).toHaveValue(
      'Captured requirement text',
    )
    expect(navigateMock).toHaveBeenCalledWith('https://example.com/requirements')
    expect(contentMock).toHaveBeenCalledWith('checkout')
    expect(navigateMock.mock.invocationCallOrder[0]).toBeLessThan(
      contentMock.mock.invocationCallOrder[0],
    )

    await user.click(screen.getByRole('button', { name: '涓婁竴姝' }))
    expect(screen.getByRole('button', { name: '鎵撳紑骞舵姄鍙栫綉椤礰' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '涓婁竴姝' }))
    expect(screen.getByLabelText('鍏抽敭璇嶈繃婊わ紙鍙€夛級')).toHaveValue('checkout')
    await user.click(screen.getByRole('button', { name: '涓婁竴姝' }))
    expect(screen.getByLabelText('闇€姹傛枃妗ｇ綉鍧€')).toHaveValue(
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

    await user.click(screen.getByRole('button', { name: '鎵撳紑骞舵姄鍙栫綉椤礰' }))

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.getByRole('button', { name: '鎵撳紑骞舵姄鍙栫綉椤礰' })).toBeEnabled()
    expect(screen.queryByLabelText('闇€姹傛鏂嘸')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'AI 瑙ｆ瀽闇€姹傚苟寤烘ā' }),
    ).not.toBeInTheDocument()
  })

  it('locks AI modeling when a repeat capture returns empty content', async () => {
    render(<RequirementModeler onCancel={vi.fn()} onSaved={vi.fn()} />)
    const user = await reachCapture()
    await user.click(screen.getByRole('button', { name: '鎵撳紑骞舵姄鍙栫綉椤礰' }))
    await screen.findByLabelText('闇€姹傛鏂嘸')
    await user.click(screen.getByRole('button', { name: '涓婁竴姝' }))
    contentMock.mockResolvedValue(pageContent(''))

    await user.click(screen.getByRole('button', { name: '鎵撳紑骞舵姄鍙栫綉椤礰' }))

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.getByRole('button', { name: /4\.\s*AI 寤烘ā/ })).toBeDisabled()
  })

  it('locks navigation while capture is pending so stale results cannot commit to changed inputs', async () => {
    const navigation = deferred<{ action: string; message: string }>()
    navigateMock.mockReturnValue(navigation.promise)
    render(<RequirementModeler onCancel={vi.fn()} onSaved={vi.fn()} />)
    const user = await reachCapture()

    await user.click(screen.getByRole('button', { name: '鎵撳紑骞舵姄鍙栫綉椤礰' }))

    expect(screen.getByRole('button', { name: /1\.\s*杈撳叆缃戝潃/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /2\.\s*璁剧疆鍏抽敭璇峘/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: '涓婁竴姝' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /姝ｅ湪鎵撳紑骞舵姄鍙?/ })).toBeDisabled()

    navigation.resolve({ action: 'navigate', message: 'ok' })
    expect(await screen.findByLabelText('闇€姹傛鏂嘸')).toHaveValue(
      'Captured requirement text',
    )
  })

  it('disables capture and exposes URL validation when an invalidated URL is invalid', async () => {
    render(<RequirementModeler onCancel={vi.fn()} onSaved={vi.fn()} />)
    const user = await reachCapture()
    await user.click(screen.getByRole('button', { name: '鎵撳紑骞舵姄鍙栫綉椤礰' }))
    await screen.findByLabelText('闇€姹傛鏂嘸')
    await user.click(screen.getByRole('button', { name: /1\.\s*杈撳叆缃戝潃/ }))
    const urlInput = screen.getByLabelText('闇€姹傛枃妗ｇ綉鍧€')
    await user.clear(urlInput)
    await user.type(urlInput, 'not-a-url')
    await user.click(screen.getByRole('button', { name: /3\.\s*鎶撳彇缃戦〉/ }))

    expect(screen.getByRole('button', { name: '鎵撳紑骞舵姄鍙栫綉椤礰' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP')
  })

  it('cancels from the always-visible return action', async () => {
    const onCancel = vi.fn()
    render(<RequirementModeler onCancel={onCancel} onSaved={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: '杩斿洖娴嬭瘯璁捐' }))

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('generates from the current document and URL, then persists before notifying the parent', async () => {
    const onSaved = vi.fn()
    render(<RequirementModeler onCancel={vi.fn()} onSaved={onSaved} />)
    const user = await reachCapture()
    await user.click(screen.getByRole('button', { name: '鎵撳紑骞舵姄鍙栫綉椤礰' }))

    const documentInput = await screen.findByLabelText('闇€姹傛鏂嘸')
    await user.clear(documentInput)
    await user.type(documentInput, 'Edited current requirement')
    await user.click(screen.getByRole('button', { name: 'AI 瑙ｆ瀽闇€姹傚苟寤烘ā' }))

    expect(generateMock).toHaveBeenCalledWith(
      'Edited current requirement',
      expect.objectContaining({
        targetUrl: 'https://example.com/requirements',
        onProgress: expect.any(Function),
      }),
    )
    expect(await screen.findByDisplayValue('Generated flow')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '淇濆瓨妯℃澘骞惰繑鍥瀈' }))

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
    await user.click(screen.getByRole('button', { name: '鎵撳紑骞舵姄鍙栫綉椤礰' }))
    const documentInput = await screen.findByLabelText('闇€姹傛鏂嘸')

    await user.click(screen.getByRole('button', { name: 'AI 瑙ｆ瀽闇€姹傚苟寤烘ā' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('model unavailable')
    expect(documentInput).toHaveValue('Captured requirement text')
    const generate = screen.getByRole('button', { name: 'AI 瑙ｆ瀽闇€姹傚苟寤烘ā' })
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
    await user.click(screen.getByRole('button', { name: '鎵撳紑骞舵姄鍙栫綉椤礰' }))
    await screen.findByLabelText('闇€姹傛鏂嘸')
    await user.click(screen.getByRole('button', { name: 'AI 瑙ｆ瀽闇€姹傚苟寤烘ā' }))
    const nameInput = await screen.findByDisplayValue('Generated flow')
    await user.clear(nameInput)
    await user.type(nameInput, 'Edited generated flow')

    await user.click(screen.getByRole('button', { name: '淇濆瓨妯℃澘骞惰繑鍥瀈' }))

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
    await user.click(screen.getByRole('button', { name: '鎵撳紑骞舵姄鍙栫綉椤礰' }))
    await screen.findByLabelText('闇€姹傛鏂嘸')

    await user.click(screen.getByRole('button', { name: '涓婁竴姝' }))
    await user.click(screen.getByRole('button', { name: '涓婁竴姝' }))
    await user.type(screen.getByLabelText('鍏抽敭璇嶈繃婊わ紙鍙€夛級'), ' changed')
    await user.click(screen.getByRole('button', { name: '涓嬩竴姝ワ細鎶撳彇缃戦〉' }))

    expect(screen.getByText('缃戝潃鎴栧叧閿瘝宸插彉鍖栵紝璇烽噸鏂版姄鍙朻')).toBeVisible()
    expect(screen.getByRole('button', { name: '鎵撳紑骞舵姄鍙栫綉椤礰' })).toBeEnabled()
    expect(screen.queryByLabelText('闇€姹傛鏂嘸')).not.toBeInTheDocument()
  })
})
