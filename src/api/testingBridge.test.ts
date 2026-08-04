import { invoke } from '@tauri-apps/api/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  captureFailureScreenshot,
  clearBrowserSession,
  createTestAccount,
  createScopedWorkflowRun,
  loginTestAccount,
  listDefectDrafts,
  listFailureEvidence,
  listAccountCombinations,
  listTestAccounts,
  listWorkflowRuns,
  listWorkflowScenarios,
  saveWorkflowScenario,
  setTestAccountCredential,
} from './testingBridge'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const invokeMock = vi.mocked(invoke)

afterEach(() => {
  invokeMock.mockReset()
})

describe('testingBridge', () => {
  it('normalizes nullable Rust options without leaking null into public records', async () => {
    invokeMock
      .mockResolvedValueOnce([{ id: 'account-1', displayName: 'Employee', businessRole: 'employee', maskedLoginName: 'em***', credentialRef: 'ref', loginMode: 'automatic', loginConfig: { loginUrl: 'https://example.test' }, isEnabled: true, systemId: null, environmentId: null, scopeState: 'legacy', createdAt: 'now', updatedAt: 'now' }])
      .mockResolvedValueOnce([{ id: 'combination-1', name: 'Legacy', employeeAccountId: null, managerAccountId: null, hrbpAccountId: null, systemId: null, environmentId: null, scopeState: 'legacy', createdAt: 'now', updatedAt: 'now' }])
      .mockResolvedValueOnce([{ id: 'scenario-1', name: 'Legacy', scenarioKind: 'single_role', sourceTestCaseId: null, businessTagsJson: '[]', preconditionsJson: '[]', stepsJson: '[]', systemId: null, environmentId: null, scopeState: 'legacy', createdAt: 'now', updatedAt: 'now' }])
      .mockResolvedValueOnce([{ id: 'run-1', scenarioId: 'scenario-1', accountCombinationId: null, status: 'queued', currentStepOrder: 0, systemId: null, environmentId: null, designId: null, requirementVersionId: null, scopeState: 'legacy', snapshot: null, startedAt: null, finishedAt: null, createdAt: 'now', updatedAt: 'now' }])
      .mockResolvedValueOnce([{ id: 'evidence-1', runId: 'run-1', stepId: 'step-1', expectedValue: 'yes', actualValue: 'no', screenshotPath: null, systemId: null, environmentId: null, scopeState: 'legacy', createdAt: 'now', updatedAt: 'now' }])
      .mockResolvedValueOnce([{ id: 'defect-1', status: 'pending_confirmation', title: 'Legacy', reproductionStepsJson: '[]', expectedResult: 'yes', actualResult: 'no', impactSummary: 'impact', businessRole: 'employee', scenarioId: 'scenario-1', runId: 'run-1', evidenceId: null, systemId: null, environmentId: null, scopeState: 'legacy', createdAt: 'now', updatedAt: 'now' }])

    const [account] = await listTestAccounts()
    const [combination] = await listAccountCombinations()
    const [scenario] = await listWorkflowScenarios()
    const [run] = await listWorkflowRuns()
    const [evidence] = await listFailureEvidence()
    const [defect] = await listDefectDrafts()

    expect(account).toMatchObject({ systemId: undefined, environmentId: undefined })
    expect(combination).toMatchObject({ employeeAccountId: undefined, managerAccountId: undefined, hrbpAccountId: undefined, systemId: undefined, environmentId: undefined })
    expect(scenario).toMatchObject({ sourceTestCaseId: '', systemId: undefined, environmentId: undefined })
    expect(run).toMatchObject({ accountCombinationId: undefined, systemId: undefined, environmentId: undefined, designId: undefined, requirementVersionId: undefined, snapshot: undefined })
    expect(evidence).toMatchObject({ screenshotPath: undefined, systemId: undefined, environmentId: undefined })
    expect(defect).toMatchObject({ evidenceId: undefined, systemId: undefined, environmentId: undefined })
    expect(JSON.stringify({ account, combination, scenario, run, evidence, defect })).not.toContain('null')
  })
  it('maps scoped workflow run identity and immutable snapshot with camelCase payloads', async () => {
    invokeMock.mockResolvedValueOnce({
      id: 'run-1', scenarioId: 'scenario-1', accountCombinationId: 'combination-1', status: 'queued', currentStepOrder: 0,
      systemId: 'system-1', environmentId: 'environment-1', designId: 'design-1', requirementVersionId: 'requirement-1', scopeState: 'scoped',
      snapshot: { scenario: { id: 'scenario-1', name: 'Approval', scenarioKind: 'workflow', steps: [], sourceTestCaseId: 'case-1' }, combination: { id: 'combination-1', name: 'Default', accounts: [] }, caseIds: ['case-1'] },
      createdAt: '2026-08-04T00:00:00Z', updatedAt: '2026-08-04T00:00:00Z',
    })
    await expect(createScopedWorkflowRun({
      systemId: 'system-1', environmentId: 'environment-1', designId: 'design-1', requirementVersionId: 'requirement-1', scenarioId: 'scenario-1', accountCombinationId: 'combination-1',
    })).resolves.toMatchObject({ systemId: 'system-1', environmentId: 'environment-1', snapshot: { caseIds: ['case-1'] } })
    expect(invokeMock).toHaveBeenCalledWith('create_scoped_workflow_run', { input: {
      scope: { systemId: 'system-1', environmentId: 'environment-1' }, designId: 'design-1', requirementVersionId: 'requirement-1', scenarioId: 'scenario-1', accountCombinationId: 'combination-1',
    } })
  })
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
    })
    expect(JSON.stringify(invokeMock.mock.calls)).not.toMatch(/password|username|credential/i)
  })
})
