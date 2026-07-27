import { describe, expect, it } from 'vitest'

import {
  canCreateDefectDraft,
  isRunTerminal,
  transitionDefectStatus,
  type AccountCombination,
  type DefectDraft,
  type FailureEvidence,
  type TestAccount,
  type WorkflowRun,
  type WorkflowRunEvent,
  type WorkflowScenario,
} from './workflow'

describe('workflow domain rules', () => {
  it('creates defect drafts only after a business assertion failure', () => {
    expect(canCreateDefectDraft('business_failed')).toBe(true)
    expect(canCreateDefectDraft('queued')).toBe(false)
    expect(canCreateDefectDraft('running')).toBe(false)
    expect(canCreateDefectDraft('waiting_handoff')).toBe(false)
    expect(canCreateDefectDraft('execution_blocked')).toBe(false)
    expect(canCreateDefectDraft('passed')).toBe(false)
    expect(canCreateDefectDraft('cancelled')).toBe(false)
  })

  it('recognizes every terminal workflow run status', () => {
    expect(isRunTerminal('queued')).toBe(false)
    expect(isRunTerminal('running')).toBe(false)
    expect(isRunTerminal('waiting_handoff')).toBe(false)
    expect(isRunTerminal('execution_blocked')).toBe(true)
    expect(isRunTerminal('business_failed')).toBe(true)
    expect(isRunTerminal('passed')).toBe(true)
    expect(isRunTerminal('cancelled')).toBe(true)
  })

  it('allows only the defined defect lifecycle transitions', () => {
    expect(transitionDefectStatus('pending_confirmation', 'pending_fix')).toBe(true)
    expect(transitionDefectStatus('pending_confirmation', 'not_a_bug')).toBe(true)
    expect(transitionDefectStatus('pending_fix', 'pending_validation')).toBe(true)
    expect(transitionDefectStatus('pending_validation', 'closed')).toBe(true)
    expect(transitionDefectStatus('pending_validation', 'pending_fix')).toBe(true)

    expect(transitionDefectStatus('pending_confirmation', 'closed')).toBe(false)
    expect(transitionDefectStatus('pending_fix', 'closed')).toBe(false)
    expect(transitionDefectStatus('pending_validation', 'not_a_bug')).toBe(false)
    expect(transitionDefectStatus('closed', 'pending_fix')).toBe(false)
    expect(transitionDefectStatus('not_a_bug', 'pending_fix')).toBe(false)
  })

  it('keeps workflow records serializable and credential-free', () => {
    const scenario = {
      id: 'scenario_1',
      sourceTestCaseId: 'case_1',
      title: 'Employee submits probation goal',
      scenarioKind: 'workflow',
      businessTags: ['probation', 'goal'],
      preconditions: ['The probation record is active'],
      steps: [
        {
          id: 'step_1',
          order: 1,
          role: 'employee',
          actionIntent: 'Submit the probation goal',
          assertions: ['The record moves to the manager review state'],
          pageUrl: 'https://example.test/probation',
          selector: '[data-testid="submit-goal"]',
          expectedValue: 'manager_review',
          createdAt: '2026-07-27T00:00:00.000Z',
          updatedAt: '2026-07-27T00:00:00.000Z',
        },
      ],
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    } satisfies WorkflowScenario

    const account = {
      id: 'account_1',
      role: 'employee',
      displayName: 'Test employee',
      maskedLoginName: 'empl***@example.test',
      loginMode: 'automatic',
      enabled: true,
      loginConfig: {
        loginUrl: 'https://example.test/login',
        loginNameSelector: '#login-name',
        credentialSelector: '#credential',
        submitSelector: 'button[type="submit"]',
        postLoginAssertion: 'Welcome',
      },
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    } satisfies TestAccount

    const combination = {
      id: 'combination_1',
      name: 'Standard approval path',
      employeeAccountId: account.id,
      managerAccountId: 'account_2',
      hrbpAccountId: 'account_3',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    } satisfies AccountCombination

    const run = {
      id: 'run_1',
      scenarioId: scenario.id,
      accountCombinationId: combination.id,
      status: 'business_failed',
      currentStepIndex: 1,
      startedAt: '2026-07-27T00:00:00.000Z',
      finishedAt: '2026-07-27T00:01:00.000Z',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:01:00.000Z',
    } satisfies WorkflowRun

    const event = {
      id: 'event_1',
      runId: run.id,
      sequence: 1,
      phase: 'business_assertion',
      role: 'employee',
      message: 'Expected manager review status but received employee draft',
      occurredAt: '2026-07-27T00:01:00.000Z',
    } satisfies WorkflowRunEvent

    const evidence = {
      id: 'evidence_1',
      runId: run.id,
      stepId: scenario.steps[0].id,
      expected: 'manager_review',
      actual: 'employee_draft',
      screenshotPath: 'evidence/run_1/step_1.png',
      createdAt: '2026-07-27T00:01:00.000Z',
      updatedAt: '2026-07-27T00:01:00.000Z',
    } satisfies FailureEvidence

    const defect = {
      id: 'defect_1',
      status: 'pending_confirmation',
      title: 'Submitting a goal does not start manager review',
      reproductionSteps: ['Log in as the employee', 'Submit a probation goal'],
      expectedResult: 'The record moves to manager review',
      actualResult: 'The record remains in employee draft',
      impact: 'The approval workflow cannot continue',
      role: 'employee',
      scenarioId: scenario.id,
      runId: run.id,
      evidenceId: evidence.id,
      createdAt: '2026-07-27T00:01:00.000Z',
      updatedAt: '2026-07-27T00:01:00.000Z',
    } satisfies DefectDraft

    expect(JSON.parse(JSON.stringify({ scenario, account, combination, run, event, evidence, defect }))).toEqual({
      scenario,
      account,
      combination,
      run,
      event,
      evidence,
      defect,
    })
  })
})
