import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { WorkflowRunConsole } from './WorkflowRunConsole'
import type { WorkflowRun, WorkflowRunEvent, WorkflowScenario } from '../types/workflow'

const now = '2026-07-28T08:00:00.000Z'

const scenario: WorkflowScenario = {
  id: 'scenario-1',
  sourceTestCaseId: 'case-1',
  title: '试用期审批',
  scenarioKind: 'workflow',
  businessTags: [],
  preconditions: [],
  steps: [],
  createdAt: now,
  updatedAt: now,
}

const waitingRun: WorkflowRun = {
  id: 'run-1',
  scenarioId: scenario.id,
  status: 'waiting_handoff',
  currentStepIndex: 2,
  createdAt: now,
  updatedAt: now,
}

const events: WorkflowRunEvent[] = [
  { id: 'event-1', runId: 'run-1', sequence: 1, phase: 'handoff_required', role: 'manager', message: '请在浏览器完成上级账号的 SSO 或验证码后继续。', occurredAt: now },
]

describe('WorkflowRunConsole', () => {
  it('shows a semantic handoff timeline with resume and cancel actions', async () => {
    const onResume = vi.fn()
    const onCancel = vi.fn()
    render(<WorkflowRunConsole run={waitingRun} scenario={scenario} events={events} onResume={onResume} onCancel={onCancel} />)
    const user = userEvent.setup()

    expect(screen.getByText('请在浏览器完成 SSO/验证码后继续')).toBeVisible()
    expect(screen.getByText('请在浏览器完成上级账号的 SSO 或验证码后继续。')).toBeVisible()
    expect(screen.queryByText(/selector|stack/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '继续流程' }))
    await user.click(screen.getByRole('button', { name: '取消流程' }))
    expect(onResume).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
