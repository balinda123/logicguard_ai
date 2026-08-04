import { invoke } from '@tauri-apps/api/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  captureFailureScreenshot,
  clearBrowserSession,
  createTestAccount,
  loginTestAccount,
  listTestAccounts,
  saveWorkflowScenario,
  setTestAccountCredential,
} from './testingBridge'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('./llmBridge', () => ({
  getLlmConfig: () => ({ provider: 'openai_compat', model: 'company-model', base_url: 'http://gateway.test' }),
}))

const invokeMock = vi.mocked(invoke)

afterEach(() => {
  invokeMock.mockReset()
})

describe('testingBridge', () => {
  it('maps account records to the workflow domain type without exposing credentials', async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: 'account-1',
        displayName: 'Employee A',
        businessRole: 'employee',
        maskedLoginName: 'em***',
        credentialRef: 'logicguard.test-account.account-1',
        loginMode: 'automatic',
        loginConfig: { loginUrl: 'https://example.test/login' },
        isEnabled: true,
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:00.000Z',
      },
    ])

    await expect(listTestAccounts()).resolves.toEqual([
      expect.objectContaining({
        id: 'account-1',
        role: 'employee',
        enabled: true,
        maskedLoginName: 'em***',
      }),
    ])
    expect(invokeMock).toHaveBeenCalledWith('list_test_accounts')
  })

  it('uses Tauri camelCase payload names and keeps credentials write-only', async () => {
    invokeMock.mockResolvedValueOnce({
      id: 'account-1',
      displayName: 'Employee A',
      businessRole: 'employee',
      maskedLoginName: 'not-configured',
      credentialRef: 'logicguard.test-account.account-1',
      loginMode: 'automatic',
      loginConfig: { loginUrl: 'https://example.test/login' },
      isEnabled: true,
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
    })

    await createTestAccount({
      displayName: 'Employee A',
      role: 'employee',
      loginMode: 'automatic',
      loginConfig: { loginUrl: 'https://example.test/login' },
    })
    await expect(setTestAccountCredential('account-1', 'employee-a', 'test-password')).resolves.toBeUndefined()

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'create_test_account', {
      input: {
        displayName: 'Employee A',
        businessRole: 'employee',
        loginMode: 'automatic',
        loginConfig: { loginUrl: 'https://example.test/login' },
      },
    })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'set_test_account_credential', {
      accountId: 'account-1',
      username: 'employee-a',
      password: 'test-password',
    })
  })

  it('uses backend-owned failure evidence paths and workflow scenario payloads', async () => {
    invokeMock.mockResolvedValueOnce({
      screenshotPath: 'failure-evidence/run-1/step-1-123.png',
    })
    invokeMock.mockResolvedValueOnce(undefined)
    invokeMock.mockResolvedValueOnce({
      id: 'scenario-1',
      name: 'Employee creates a goal',
      scenarioKind: 'single_role',
      sourceTestCaseId: 'case-1',
      businessTagsJson: '["goal"]',
      preconditionsJson: '["Employee is signed in"]',
      stepsJson: '[]',
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
    })

    await captureFailureScreenshot('run-1', 'step-1')
    await clearBrowserSession()
    await saveWorkflowScenario({
      id: 'scenario-1',
      title: 'Employee creates a goal',
      scenarioKind: 'single_role',
      businessTags: ['goal'],
      preconditions: ['Employee is signed in'],
      steps: [],
      sourceTestCaseId: 'case-1',
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
    })

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'browser_capture_failure_screenshot', {
      runId: 'run-1',
      stepId: 'step-1',
      port: 9222,
    })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'browser_clear_session', { port: 9222 })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'save_workflow_scenario', {
      input: expect.objectContaining({
        id: 'scenario-1',
        name: 'Employee creates a goal',
        sourceTestCaseId: 'case-1',
      }),
    })
  })

  it('starts automatic login by account id without receiving credentials', async () => {
    invokeMock.mockResolvedValueOnce({ status: 'completed', finalUrl: 'https://example.test/home' })

    await expect(loginTestAccount('account-1')).resolves.toEqual({
      status: 'completed',
      finalUrl: 'https://example.test/home',
    })

    expect(invokeMock).toHaveBeenCalledWith('browser_login_test_account', {
      accountId: 'account-1',
      port: 9222,
      config: { provider: 'openai_compat', model: 'company-model', base_url: 'http://gateway.test' },
    })
    expect(JSON.stringify(invokeMock.mock.calls)).not.toMatch(/password|username|credential/i)
  })
})
