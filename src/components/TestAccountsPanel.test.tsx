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

  it('writes an automatic-login credential once then closes the editor', async () => {
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
    expect(screen.queryByRole('dialog', { name: '测试账号编辑' })).not.toBeInTheDocument()
    expect(screen.queryByText('should-not-persist')).not.toBeInTheDocument()
  })

  it('keeps optional browser selectors collapsed until advanced settings are opened', async () => {
    render(<TestAccountsPanel canManage />)
    const user = userEvent.setup()

    await screen.findByText('员工 A')
    await user.click(screen.getByRole('button', { name: '新增测试账号' }))
    expect(screen.queryByLabelText('用户名选择器')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '高级设置（可选）' }))
    expect(screen.getByLabelText('用户名选择器')).toBeVisible()

    await user.selectOptions(screen.getByRole('combobox', { name: '登录方式' }), 'manual_sso')
    expect(screen.queryByLabelText('用户名选择器')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('账号用户名')).not.toBeInTheDocument()
  })

  it('shows credential errors inside the editor and focuses the first invalid field', async () => {
    render(<TestAccountsPanel canManage />)
    const user = userEvent.setup()

    await screen.findByText('员工 A')
    await user.click(screen.getByRole('button', { name: '新增测试账号' }))
    await user.type(screen.getByLabelText('账号显示名'), '员工 B')
    await user.type(screen.getByLabelText('登录地址'), 'https://example.test/login')
    await user.click(screen.getByRole('button', { name: '保存测试账号' }))

    const editor = screen.getByRole('dialog', { name: '测试账号编辑' })
    expect(editor).toContainElement(screen.getByRole('alert'))
    expect(screen.getByRole('alert')).toHaveTextContent('请填写账号用户名和账号密码')
    expect(screen.getByLabelText('账号用户名')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('账号密码')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('账号用户名')).toHaveFocus()
    expect(createTestAccount).not.toHaveBeenCalled()
  })

  it('refreshes the edited account and closes the editor after saving', async () => {
    const manualAccount: TestAccount = {
      ...account,
      role: 'manager',
      displayName: '上级（手动登录）',
      loginMode: 'manual_sso',
    }
    const updatedAccount: TestAccount = {
      ...manualAccount,
      displayName: '上级测试账号',
      updatedAt: '2026-08-03T00:00:00.000Z',
    }
    vi.mocked(listTestAccounts)
      .mockResolvedValueOnce([manualAccount])
      .mockResolvedValueOnce([updatedAccount])
    vi.mocked(updateTestAccount).mockResolvedValue(updatedAccount)
    render(<TestAccountsPanel canManage />)
    const user = userEvent.setup()

    await screen.findByText('上级（手动登录）')
    await user.click(screen.getByRole('button', { name: '编辑上级（手动登录）' }))
    const displayName = screen.getByLabelText('账号显示名')
    await user.clear(displayName)
    await user.type(displayName, '上级测试账号')
    await user.click(screen.getByRole('button', { name: '保存测试账号' }))

    await waitFor(() => {
      expect(updateTestAccount).toHaveBeenCalledWith(manualAccount.id, {
        displayName: '上级测试账号',
        role: 'manager',
        loginMode: 'manual_sso',
        loginConfig: { loginUrl: 'https://example.test/login' },
      })
    })
    expect(await screen.findByText('上级测试账号')).toBeVisible()
    expect(screen.queryByRole('dialog', { name: '测试账号编辑' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '编辑上级测试账号' }))
    expect(screen.getByLabelText('账号显示名')).toHaveValue('上级测试账号')
  })

  it('preserves existing advanced selectors when saving with the section collapsed', async () => {
    const configuredAccount: TestAccount = {
      ...account,
      loginConfig: {
        loginUrl: 'https://example.test/login',
        usernameSelector: '#username',
        passwordSelector: '#password',
        submitSelector: '#login',
      },
    }
    vi.mocked(listTestAccounts).mockResolvedValue([configuredAccount])
    vi.mocked(updateTestAccount).mockResolvedValue(configuredAccount)
    render(<TestAccountsPanel canManage />)
    const user = userEvent.setup()

    await screen.findByText('员工 A')
    await user.click(screen.getByRole('button', { name: '编辑员工 A' }))
    await user.click(screen.getByRole('button', { name: '保存测试账号' }))

    await waitFor(() => {
      expect(updateTestAccount).toHaveBeenCalledWith(configuredAccount.id, expect.objectContaining({
        loginConfig: configuredAccount.loginConfig,
      }))
    })
  })
})
