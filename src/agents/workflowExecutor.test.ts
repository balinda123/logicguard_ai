import { describe, expect, it, vi } from 'vitest'

import {
  WorkflowAssertionError,
  createWorkflowRunController,
  type WorkflowExecutorDependencies,
} from './workflowExecutor'
import type {
  AccountCombination,
  TestAccount,
  WorkflowRun,
  WorkflowScenario,
} from '../types/workflow'

const now = '2026-07-28T08:00:00.000Z'

const scenario: WorkflowScenario = {
  id: 'scenario-1',
  sourceTestCaseId: 'case-1',
  title: '试用期目标审批',
  scenarioKind: 'workflow',
  businessTags: ['试用期'],
  preconditions: [],
  steps: [
    {
      id: 'step-employee',
      order: 1,
      role: 'employee',
      actionIntent: '员工提交目标',
      assertions: ['状态变为上级审批'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'step-manager',
      order: 2,
      role: 'manager',
      actionIntent: '上级完成评价',
      assertions: ['状态变为 HRBP 审核'],
      createdAt: now,
      updatedAt: now,
    },
  ],
  createdAt: now,
  updatedAt: now,
}

const accounts: TestAccount[] = [
  {
    id: 'employee-account',
    role: 'employee',
    displayName: '员工测试账号',
    maskedLoginName: 'emp***',
    credentialRef: 'credential-employee',
    loginMode: 'automatic',
    enabled: true,
    loginConfig: { loginUrl: 'https://example.test/login' },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'manager-account',
    role: 'manager',
    displayName: '上级测试账号',
    maskedLoginName: 'mgr***',
    credentialRef: 'credential-manager',
    loginMode: 'automatic',
    enabled: true,
    loginConfig: { loginUrl: 'https://example.test/login' },
    createdAt: now,
    updatedAt: now,
  },
]

const combination: AccountCombination = {
  id: 'combination-1',
  name: '标准审批组合',
  employeeAccountId: 'employee-account',
  managerAccountId: 'manager-account',
  createdAt: now,
  updatedAt: now,
}

function makeRun(status: WorkflowRun['status'] = 'queued', currentStepIndex = 0): WorkflowRun {
  return {
    id: 'run-1',
    scenarioId: scenario.id,
    accountCombinationId: combination.id,
    status,
    currentStepIndex,
    createdAt: now,
    updatedAt: now,
  }
}

function createDependencies(overrides: Partial<WorkflowExecutorDependencies> = {}): WorkflowExecutorDependencies {
  let currentRun = makeRun()
  return {
    createWorkflowRun: vi.fn(async () => currentRun),
    updateWorkflowRun: vi.fn(async (_id, status, currentStepIndex) => {
      currentRun = { ...currentRun, status, currentStepIndex }
      return currentRun
    }),
    appendWorkflowRunEvent: vi.fn(async (input) => ({
      id: `event-${input.sequence}`,
      runId: input.runId,
      sequence: input.sequence,
      phase: input.phase,
      role: input.role,
      message: input.message,
      occurredAt: now,
    })),
    clearBrowserSession: vi.fn(async () => undefined),
    loginTestAccount: vi.fn(async () => ({ status: 'completed' as const })),
    executeIntent: vi.fn(async () => undefined),
    captureFailureScreenshot: vi.fn(async () => ({ screenshotPath: 'failure-evidence/run-1/step-1.png' })),
    saveFailureEvidence: vi.fn(async (input) => ({
      id: 'evidence-1',
      ...input,
      createdAt: now,
      updatedAt: now,
    })),
    saveDefectDraft: vi.fn(async (input) => ({
      id: 'defect-1',
      ...input,
      createdAt: now,
      updatedAt: now,
    })),
    ...overrides,
  }
}

describe('workflowExecutor', () => {
  it('按角色顺序清理会话、安全登录并持久化语义事件', async () => {
    const dependencies = createDependencies()
    const controller = createWorkflowRunController(dependencies)

    const run = await controller.start({ scenario, combination, accounts })

    expect(run.status).toBe('passed')
    expect(dependencies.clearBrowserSession).toHaveBeenCalledTimes(2)
    expect(dependencies.loginTestAccount).toHaveBeenNthCalledWith(1, 'employee-account')
    expect(dependencies.loginTestAccount).toHaveBeenNthCalledWith(2, 'manager-account')
    expect(dependencies.executeIntent).toHaveBeenNthCalledWith(1, scenario.steps[0])
    expect(dependencies.executeIntent).toHaveBeenNthCalledWith(2, scenario.steps[1])
    expect(vi.mocked(dependencies.appendWorkflowRunEvent).mock.calls.map(([event]) => event.phase)).toEqual([
      'session_started',
      'login_started',
      'step_started',
      'assertion_passed',
      'step_completed',
      'login_started',
      'step_started',
      'assertion_passed',
      'step_completed',
      'run_completed',
    ])
    expect(dependencies.captureFailureScreenshot).not.toHaveBeenCalled()
  })

  it('在 SSO 账号交接处暂停并从同一个 run 恢复', async () => {
    const ssoAccounts = accounts.map((account) => account.role === 'manager'
      ? { ...account, loginMode: 'manual_sso' as const }
      : account)
    const dependencies = createDependencies()
    const controller = createWorkflowRunController(dependencies)

    const waitingRun = await controller.start({ scenario, combination, accounts: ssoAccounts })

    expect(waitingRun).toMatchObject({ id: 'run-1', status: 'waiting_handoff', currentStepIndex: 2 })
    expect(dependencies.loginTestAccount).toHaveBeenCalledTimes(1)
    expect(dependencies.executeIntent).toHaveBeenCalledTimes(1)
    expect(vi.mocked(dependencies.appendWorkflowRunEvent).mock.calls.at(-1)?.[0]).toMatchObject({
      phase: 'handoff_required',
      role: 'manager',
    })

    const resumedRun = await controller.resume({ run: waitingRun, scenario, combination, accounts: ssoAccounts })

    expect(resumedRun).toMatchObject({ id: 'run-1', status: 'passed' })
    expect(dependencies.clearBrowserSession).toHaveBeenCalledTimes(1)
    expect(dependencies.executeIntent).toHaveBeenCalledTimes(2)
  })

  it('业务断言失败时仅截图一次并创建待确认问题草稿', async () => {
    const dependencies = createDependencies({
      executeIntent: vi.fn(async () => {
        throw new WorkflowAssertionError('状态仍为草稿', '状态变为上级审批')
      }),
    })
    const controller = createWorkflowRunController(dependencies)

    const run = await controller.start({ scenario, combination, accounts })

    expect(run.status).toBe('business_failed')
    expect(dependencies.captureFailureScreenshot).toHaveBeenCalledTimes(1)
    expect(dependencies.saveFailureEvidence).toHaveBeenCalledWith(expect.objectContaining({
      runId: run.id,
      stepId: 'step-employee',
      expected: '状态变为上级审批',
      actual: '状态仍为草稿',
    }))
    expect(dependencies.saveDefectDraft).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending_confirmation',
      runId: run.id,
      role: 'employee',
    }))
  })

  it('技术阻断不截图也不创建问题草稿', async () => {
    const dependencies = createDependencies({
      executeIntent: vi.fn(async () => {
        throw new Error('CDP connection refused')
      }),
    })
    const controller = createWorkflowRunController(dependencies)

    const run = await controller.start({ scenario, combination, accounts })

    expect(run.status).toBe('execution_blocked')
    expect(dependencies.captureFailureScreenshot).not.toHaveBeenCalled()
    expect(dependencies.saveFailureEvidence).not.toHaveBeenCalled()
    expect(dependencies.saveDefectDraft).not.toHaveBeenCalled()
    expect(vi.mocked(dependencies.appendWorkflowRunEvent).mock.calls.at(-1)?.[0]).toMatchObject({
      phase: 'execution_blocked',
      message: '浏览器执行被阻断，请检查 CDP 连接后重试。',
    })
  })

  it('可以取消正在运行的流程且不恢复终态 run', async () => {
    const dependencies = createDependencies()
    const controller = createWorkflowRunController(dependencies)

    await expect(controller.cancel({ ...makeRun('running', 1) })).resolves.toMatchObject({ status: 'cancelled' })
    await expect(controller.resume({ run: makeRun('cancelled', 1), scenario, combination, accounts })).rejects.toThrow('终态')
  })
})
