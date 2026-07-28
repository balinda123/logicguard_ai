import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DefectDraft, FailureEvidence, WorkflowScenario } from '../types/workflow'
import {
  listDefectDrafts,
  listFailureEvidence,
  listWorkflowScenarios,
  saveDefectDraft,
  updateDefectDraftStatus,
} from '../api/testingBridge'
import { IssueTracker } from './IssueTracker'

vi.mock('../api/testingBridge', () => ({
  listDefectDrafts: vi.fn(),
  listFailureEvidence: vi.fn(),
  listWorkflowScenarios: vi.fn(),
  saveDefectDraft: vi.fn(),
  updateDefectDraftStatus: vi.fn(),
}))

const createdAt = '2026-07-28T08:00:00.000Z'

const scenario: WorkflowScenario = {
  id: 'scenario-1',
  sourceTestCaseId: 'case-1',
  title: '员工创建试用期目标',
  scenarioKind: 'single_role',
  businessTags: [],
  preconditions: [],
  steps: [],
  createdAt,
  updatedAt: createdAt,
}

const pendingDraft: DefectDraft = {
  id: 'defect-1',
  status: 'pending_confirmation',
  title: '目标名称长度校验缺失',
  reproductionSteps: ['登录员工账号', '输入 101 个字符', '保存目标'],
  expectedResult: '提示最多 100 个字符',
  actualResult: '允许保存',
  impact: '目标数据不符合规则',
  role: 'employee',
  scenarioId: scenario.id,
  runId: 'run-1',
  evidenceId: 'evidence-1',
  createdAt,
  updatedAt: createdAt,
}

const managerDraft: DefectDraft = {
  ...pendingDraft,
  id: 'defect-2',
  title: '上级审批入口不可见',
  role: 'manager',
  status: 'pending_fix',
  evidenceId: 'evidence-2',
}

const evidence: FailureEvidence[] = [
  { id: 'evidence-1', runId: 'run-1', stepId: 'step-1', expected: '提示最多 100 个字符', actual: '允许保存', screenshotPath: 'failure-evidence/run-1/step-1.png', createdAt, updatedAt: createdAt },
  { id: 'evidence-2', runId: 'run-2', stepId: 'step-1', expected: '显示审批入口', actual: '入口不可见', screenshotPath: '../credential-store/password.txt', createdAt, updatedAt: createdAt },
]

describe('IssueTracker', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listDefectDrafts).mockResolvedValue([pendingDraft, managerDraft])
    vi.mocked(listFailureEvidence).mockResolvedValue(evidence)
    vi.mocked(listWorkflowScenarios).mockResolvedValue([scenario])
    vi.mocked(saveDefectDraft).mockImplementation(async input => ({ ...pendingDraft, ...input, id: input.id ?? pendingDraft.id }))
    vi.mocked(updateDefectDraftStatus).mockImplementation(async (id, status) => ({ ...(id === managerDraft.id ? managerDraft : pendingDraft), status }))
  })

  it('lets a tester edit a pending confirmation draft before submitting it to development', async () => {
    render(<IssueTracker />)
    const user = userEvent.setup()

    await screen.findByText('目标名称长度校验缺失')
    await user.click(screen.getByRole('button', { name: '查看目标名称长度校验缺失' }))
    const title = screen.getByLabelText('问题标题')
    await user.clear(title)
    await user.type(title, '目标名称 101 字符未拦截')
    await user.click(screen.getByRole('button', { name: '确认提交开发' }))

    await waitFor(() => expect(saveDefectDraft).toHaveBeenCalledWith(expect.objectContaining({ title: '目标名称 101 字符未拦截' })))
    await waitFor(() => expect(updateDefectDraftStatus).toHaveBeenCalledWith('defect-1', 'pending_fix'))
  })

  it('only renders legal status actions for the current draft status', async () => {
    render(<IssueTracker />)
    const user = userEvent.setup()

    await screen.findByText('上级审批入口不可见')
    await user.click(screen.getByRole('button', { name: '查看上级审批入口不可见' }))

    expect(screen.getByRole('button', { name: '转待验证' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '确认提交开发' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '关闭问题' })).not.toBeInTheDocument()
  })

  it('filters by status, role and keyword', async () => {
    render(<IssueTracker />)
    const user = userEvent.setup()

    await screen.findByText('目标名称长度校验缺失')
    await user.selectOptions(screen.getByLabelText('状态筛选'), 'pending_fix')
    expect(screen.queryByText('目标名称长度校验缺失')).not.toBeInTheDocument()
    expect(screen.getByText('上级审批入口不可见')).toBeVisible()
    await user.selectOptions(screen.getByLabelText('角色筛选'), 'employee')
    expect(screen.queryByText('上级审批入口不可见')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('状态筛选'), 'all')
    await user.type(screen.getByLabelText('关键词筛选'), '长度')
    expect(screen.getByText('目标名称长度校验缺失')).toBeVisible()
  })

  it('does not render an unsafe evidence path as an image or link', async () => {
    render(<IssueTracker />)
    const user = userEvent.setup()

    await screen.findByText('上级审批入口不可见')
    await user.click(screen.getByRole('button', { name: '查看上级审批入口不可见' }))

    expect(screen.getByText('证据不可用')).toBeVisible()
    expect(document.body.innerHTML).not.toContain('credential-store/password.txt')
  })
})
