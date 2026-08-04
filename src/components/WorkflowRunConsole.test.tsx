import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionRun } from '../types/execution'
import { WorkflowRunConsole } from './WorkflowRunConsole'

const resume = vi.fn()
let status: ExecutionRun['status'] = 'waiting_handoff'
vi.mock('../contexts/ActiveRunContext', () => ({
  isTerminalRun: (value: string) => ['passed', 'business_failed', 'blocked', 'cancelled', 'interrupted'].includes(value),
  useActiveRuns: () => ({ runs: [{ id: 'run-1', ownerId: 'owner', status, currentStep: 1, snapshot: { systemName: '人事系统', environmentName: '测试环境', designTitle: '审批回归' }, executionPlan: { commands: [{}] }, createdAt: '2026-08-04T00:00:00Z', updatedAt: '2026-08-04T00:00:00Z' }], eventsByRun: { 'run-1': [{ runId: 'run-1', sequence: 1, kind: 'handoff', data: { message: '等待验证码交接' }, createdAt: '2026-08-04T00:00:00Z' }] }, pause: vi.fn(), resume, terminate: vi.fn() }),
}))
describe('WorkflowRunConsole', () => {
  beforeEach(() => { status = 'waiting_handoff'; vi.clearAllMocks() })
  it('restores events and enables resume for handoff state', async () => {
    render(<WorkflowRunConsole runId="run-1" />)
    expect(screen.getByText('等待验证码交接')).toBeVisible()
    expect(screen.getByRole('button', { name: '暂停' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(resume).toHaveBeenCalledWith('run-1')
  })
})
