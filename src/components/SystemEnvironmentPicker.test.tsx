import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listSystemEnvironments, listSystems } from '../api/testDesignBridge'
import { SystemEnvironmentPicker, type SystemEnvironmentSelection } from './SystemEnvironmentPicker'

vi.mock('../api/testDesignBridge', () => ({ listSystems: vi.fn(), listSystemEnvironments: vi.fn() }))

const systems = [
  { id: 'system-a', name: '系统 A', createdAt: 'now', updatedAt: 'now' },
  { id: 'system-b', name: '系统 B', createdAt: 'now', updatedAt: 'now' },
]
const environments = {
  'system-a': [{ id: 'env-a-test', systemId: 'system-a', kind: 'test' as const, name: '测试环境', baseUrl: 'https://a.example.test', isEnabled: true, createdAt: 'now', updatedAt: 'now' }],
  'system-b': [{ id: 'env-b-local', systemId: 'system-b', kind: 'local' as const, name: '本地启动', baseUrl: 'http://localhost:3000', isEnabled: true, createdAt: 'now', updatedAt: 'now' }],
}

describe('SystemEnvironmentPicker', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.mocked(listSystems).mockResolvedValue(systems)
    vi.mocked(listSystemEnvironments).mockImplementation(async (id) => environments[id as keyof typeof environments] ?? [])
  })

  it('only offers configured local and test environments and switches the whole scope', async () => {
    let latest: SystemEnvironmentSelection | undefined
    const { rerender } = render(<SystemEnvironmentPicker onChange={(selection) => { latest = selection }} />)
    await waitFor(() => expect(latest?.system.id).toBe('system-a'))
    rerender(<SystemEnvironmentPicker value={latest} onChange={(selection) => { latest = selection }} />)
    await userEvent.setup().selectOptions(screen.getByLabelText('系统'), 'system-b')
    await waitFor(() => expect(latest).toMatchObject({ system: { id: 'system-b' }, environment: { id: 'env-b-local', kind: 'local' } }))
  })
})
