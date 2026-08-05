import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSystemWithEnvironment } from '../api/testDesignBridge'
import { QuickCreateSystemDialog } from './QuickCreateSystemDialog'

vi.mock('../api/testDesignBridge', () => ({ createSystemWithEnvironment: vi.fn() }))

const scope = {
  system: { id: 'trial', name: '试用期管理', createdAt: 'now', updatedAt: 'now' },
  environment: { id: 'trial-test', systemId: 'trial', kind: 'test' as const, name: '测试环境', baseUrl: 'https://onboardingtest.oa.wanmei.net', isEnabled: true, createdAt: 'now', updatedAt: 'now' },
}

describe('QuickCreateSystemDialog', () => {
  afterEach(cleanup)

  it('creates a system and its first environment in one submission', async () => {
    vi.mocked(createSystemWithEnvironment).mockResolvedValue(scope)
    const onCreated = vi.fn()
    render(<QuickCreateSystemDialog open onClose={vi.fn()} onCreated={onCreated} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('系统名称'), '试用期管理')
    await user.click(screen.getByRole('button', { name: '创建并使用' }))

    expect(createSystemWithEnvironment).toHaveBeenCalledWith({
      systemName: '试用期管理',
      kind: 'test',
      environmentName: '测试环境',
      baseUrl: 'https://onboardingtest.oa.wanmei.net',
    })
    expect(onCreated).toHaveBeenCalledWith(scope)
  })

  it('keeps entered values when creation fails', async () => {
    vi.mocked(createSystemWithEnvironment).mockRejectedValue(new Error('DATABASE_OPERATION_FAILED'))
    render(<QuickCreateSystemDialog open onClose={vi.fn()} onCreated={vi.fn()} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('系统名称'), '失败系统')
    await user.click(screen.getByRole('button', { name: '创建并使用' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('DATABASE_OPERATION_FAILED')
    expect(screen.getByLabelText('系统名称')).toHaveValue('失败系统')
  })
})
