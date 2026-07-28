import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TestAccount } from '../types/workflow'
import {
  createTestAccount,
  disableTestAccount,
  listTestAccounts,
  setTestAccountCredential,
  updateTestAccount,
} from '../api/testingBridge'
import { TestAccountsPanel } from './TestAccountsPanel'

vi.mock('../api/testingBridge', () => ({
  createTestAccount: vi.fn(),
  disableTestAccount: vi.fn(),
  listTestAccounts: vi.fn(),
  setTestAccountCredential: vi.fn(),
  updateTestAccount: vi.fn(),
}))

const account: TestAccount = {
  id: 'employee-a',
  role: 'employee',
  displayName: '员工 A',
  maskedLoginName: 'emp***',
  credentialRef: 'logicguard.test-account.employee-a',
  loginMode: 'automatic',
  enabled: true,
  loginConfig: { loginUrl: 'https://example.test/login' },
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
}

describe('TestAccountsPanel', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listTestAccounts).mockResolvedValue([account])
    vi.mocked(createTestAccount).mockResolvedValue(account)
    vi.mocked(updateTestAccount).mockResolvedValue(account)
    vi.mocked(disableTestAccount).mockResolvedValue()
    vi.mocked(setTestAccountCredential).mockResolvedValue()
  })

  it('does not expose management controls when rendered read-only', async () => {
    render(<TestAccountsPanel canManage={false} />)

    expect(await screen.findByText('员工 A')).toBeVisible()
    expect(screen.getByText('emp***')).toBeVisible()
    expect(screen.queryByRole('button', { name: '新增测试账号' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑员工 A' })).not.toBeInTheDocument()
    expect(screen.queryByText('账号密码')).not.toBeInTheDocument()
  })

  it('writes an automatic-login credential once then clears the uncontrolled form values', async () => {
    render(<TestAccountsPanel canManage />)
    const user = userEvent.setup()

    await screen.findByText('员工 A')
    await user.click(screen.getByRole('button', { name: '新增测试账号' }))
    await user.type(screen.getByLabelText('账号显示名'), '员工 B')
    await user.type(screen.getByLabelText('登录地址'), 'https://example.test/login')
    await user.type(screen.getByLabelText('账号用户名'), 'employee-b')
    await user.type(screen.getByLabelText('账号密码'), 'should-not-persist')
    await user.click(screen.getByRole('button', { name: '保存测试账号' }))

    await waitFor(() => {
      expect(setTestAccountCredential).toHaveBeenCalledWith('employee-a', 'employee-b', 'should-not-persist')
    })
    expect(screen.getByLabelText('账号用户名')).toHaveValue('')
    expect(screen.getByLabelText('账号密码')).toHaveValue('')
    expect(screen.queryByText('should-not-persist')).not.toBeInTheDocument()
  })
})
