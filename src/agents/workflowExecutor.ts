import {
  browserAct,
  browserAssert,
  browserNavigate,
} from '../api/browserBridge'
import type {
  AccountCombination,
  BusinessRole,
  DefectDraft,
  FailureEvidence,
  RunStatus,
  TestAccount,
  WorkflowRun,
  WorkflowRunEvent,
  WorkflowScenario,
  WorkflowScenarioStep,
} from '../types/workflow'
import { isRunTerminal } from '../types/workflow'

export class WorkflowAssertionError extends Error {
  readonly expected: string

  constructor(
    message: string,
    expected: string,
  ) {
    super(message)
    this.name = 'WorkflowAssertionError'
    this.expected = expected
  }
}

export class WorkflowExecutionBlockedError extends Error {
  constructor(message = '浏览器执行被阻断，请检查 CDP 连接后重试。') {
    super(message)
    this.name = 'WorkflowExecutionBlockedError'
  }
}

export interface WorkflowExecutorDependencies {
  createWorkflowRun: (input: Pick<WorkflowRun, 'scenarioId' | 'accountCombinationId' | 'status' | 'currentStepIndex'>) => Promise<WorkflowRun>
  updateWorkflowRun: (id: string, status: RunStatus, currentStepIndex: number) => Promise<WorkflowRun>
  appendWorkflowRunEvent: (input: Pick<WorkflowRunEvent, 'runId' | 'sequence' | 'phase' | 'role' | 'message'>) => Promise<WorkflowRunEvent>
  clearBrowserSession: () => Promise<void>
  loginTestAccount: (accountId: string) => Promise<{ status: 'completed' | 'manual_handoff_required' }>
  executeIntent: (step: WorkflowScenarioStep) => Promise<void>
  captureFailureScreenshot: (runId: string, stepId: string) => Promise<{ screenshotPath: string }>
  saveFailureEvidence: (input: Omit<FailureEvidence, 'id' | 'createdAt' | 'updatedAt'>) => Promise<FailureEvidence>
  saveDefectDraft: (input: Omit<DefectDraft, 'id' | 'createdAt' | 'updatedAt'>) => Promise<DefectDraft>
  onRunUpdated?: (run: WorkflowRun) => void
  onEvent?: (event: WorkflowRunEvent) => void
}

export interface WorkflowRunContext {
  scenario: WorkflowScenario
  combination: AccountCombination
  accounts: TestAccount[]
}

type ResumeContext = WorkflowRunContext & { run: WorkflowRun }

function roleAccountId(combination: AccountCombination, role: BusinessRole): string | undefined {
  if (role === 'employee') return combination.employeeAccountId
  if (role === 'manager') return combination.managerAccountId
  return combination.hrbpAccountId
}

function roleLabel(role: BusinessRole): string {
  return role === 'employee' ? '员工' : role === 'manager' ? '上级' : 'HRBP'
}

function blockedMessage(): string {
  return '浏览器执行被阻断，请检查 CDP 连接后重试。'
}

export async function executeWorkflowIntent(step: WorkflowScenarioStep): Promise<void> {
  if (step.pageUrl) await browserNavigate(step.pageUrl)
  await browserAct(step.actionIntent)

  if (!step.selector) return
  for (const assertion of step.assertions) {
    try {
      await browserAssert(step.selector, step.expectedValue ?? assertion)
    } catch {
      throw new WorkflowAssertionError(
        '页面结果未满足业务断言。',
        step.expectedValue ?? assertion,
      )
    }
  }
}

export function createWorkflowRunController(dependencies: WorkflowExecutorDependencies) {
  const notifyRun = (run: WorkflowRun) => dependencies.onRunUpdated?.(run)

  const updateRun = async (run: WorkflowRun, status: RunStatus, currentStepIndex: number): Promise<WorkflowRun> => {
    const updated = await dependencies.updateWorkflowRun(run.id, status, currentStepIndex)
    notifyRun(updated)
    return updated
  }

  const createEventWriter = (runId: string) => {
    let sequence = 0
    return async (phase: string, message: string, role?: BusinessRole): Promise<void> => {
      const event = await dependencies.appendWorkflowRunEvent({
        runId,
        sequence: ++sequence,
        phase,
        role,
        message,
      })
      dependencies.onEvent?.(event)
    }
  }

  const getAccount = (context: WorkflowRunContext, role: BusinessRole): TestAccount => {
    const accountId = roleAccountId(context.combination, role)
    const account = context.accounts.find(item => item.id === accountId && item.role === role && item.enabled)
    if (!account) throw new WorkflowExecutionBlockedError('当前角色没有可用的测试账号，请先在设置中配置。')
    return account
  }

  const persistFailure = async (
    run: WorkflowRun,
    context: WorkflowRunContext,
    step: WorkflowScenarioStep,
    error: WorkflowAssertionError,
  ) => {
    let screenshotPath: string | undefined
    try {
      screenshotPath = (await dependencies.captureFailureScreenshot(run.id, step.id)).screenshotPath
    } catch {
      // Evidence remains useful even when a CDP screenshot cannot be collected.
    }
    const evidence = await dependencies.saveFailureEvidence({
      runId: run.id,
      stepId: step.id,
      expected: error.expected,
      actual: error.message,
      screenshotPath,
    })
    await dependencies.saveDefectDraft({
      status: 'pending_confirmation',
      title: `${context.scenario.title}：${step.actionIntent}未满足预期`,
      reproductionSteps: [`以${roleLabel(step.role)}身份执行：${step.actionIntent}`],
      expectedResult: error.expected,
      actualResult: error.message,
      impact: '当前流程无法继续，请开发确认并修复。',
      role: step.role,
      scenarioId: context.scenario.id,
      runId: run.id,
      evidenceId: evidence.id,
    })
  }

  const execute = async (initialRun: WorkflowRun, context: WorkflowRunContext, resuming: boolean): Promise<WorkflowRun> => {
    if (isRunTerminal(initialRun.status)) throw new WorkflowExecutionBlockedError('终态运行不能恢复。')

    const writeEvent = createEventWriter(initialRun.id)
    let run = await updateRun(initialRun, 'running', initialRun.currentStepIndex)
    await writeEvent('session_started', resuming ? '已继续流程执行。' : '已开始流程执行。')

    const steps = [...context.scenario.steps].sort((left, right) => left.order - right.order)
    const pendingSteps = steps.filter(step => initialRun.currentStepIndex === 0 || step.order >= initialRun.currentStepIndex)
    let previousRole: BusinessRole | undefined

    for (const step of pendingSteps) {
      const account = getAccount(context, step.role)
      const roleChanged = previousRole !== step.role
      if (roleChanged && !(resuming && initialRun.status === 'waiting_handoff' && account.loginMode !== 'automatic')) {
        if (account.loginMode === 'automatic') {
          try {
            await dependencies.clearBrowserSession()
            await writeEvent('login_started', `正在切换至${roleLabel(step.role)}账号。`, step.role)
            const login = await dependencies.loginTestAccount(account.id)
            if (login.status === 'manual_handoff_required') {
              run = await updateRun(run, 'waiting_handoff', step.order)
              await writeEvent('handoff_required', `请在浏览器完成${roleLabel(step.role)}账号的 SSO 或验证码后继续。`, step.role)
              return run
            }
          } catch {
            run = await updateRun(run, 'execution_blocked', step.order)
            await writeEvent('execution_blocked', blockedMessage(), step.role)
            return run
          }
        } else {
          run = await updateRun(run, 'waiting_handoff', step.order)
          await writeEvent('handoff_required', `请在浏览器完成${roleLabel(step.role)}账号的 SSO 或验证码后继续。`, step.role)
          return run
        }
      }

      previousRole = step.role
      run = await updateRun(run, 'running', step.order)
      await writeEvent('step_started', `正在执行：${step.actionIntent}`, step.role)
      try {
        await dependencies.executeIntent(step)
      } catch (error) {
        if (error instanceof WorkflowAssertionError) {
          run = await updateRun(run, 'business_failed', step.order)
          await writeEvent('assertion_failed', '业务断言未通过，已生成待确认问题草稿。', step.role)
          await persistFailure(run, context, step, error)
          return run
        }
        run = await updateRun(run, 'execution_blocked', step.order)
        await writeEvent('execution_blocked', blockedMessage(), step.role)
        return run
      }
      for (const assertion of step.assertions) {
        await writeEvent('assertion_passed', `断言通过：${assertion}`, step.role)
      }
      await writeEvent('step_completed', `已完成：${step.actionIntent}`, step.role)
    }

    const finalStepOrder = steps.at(-1)?.order ?? 0
    run = await updateRun(run, 'passed', finalStepOrder)
    await writeEvent('run_completed', '流程执行通过。')
    return run
  }

  return {
    async start(context: WorkflowRunContext): Promise<WorkflowRun> {
      const run = await dependencies.createWorkflowRun({
        scenarioId: context.scenario.id,
        accountCombinationId: context.combination.id,
        status: 'queued',
        currentStepIndex: 0,
      })
      notifyRun(run)
      return execute(run, context, false)
    },
    async resume(context: ResumeContext): Promise<WorkflowRun> {
      return execute(context.run, context, true)
    },
    async cancel(run: WorkflowRun): Promise<WorkflowRun> {
      if (isRunTerminal(run.status)) throw new WorkflowExecutionBlockedError('终态运行不能取消。')
      const cancelled = await updateRun(run, 'cancelled', run.currentStepIndex)
      const writeEvent = createEventWriter(run.id)
      await writeEvent('run_completed', '流程已取消。')
      return cancelled
    },
  }
}
