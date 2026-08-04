import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TestCase } from '../types'
import { saveWorkflowScenario } from '../api/testingBridge'
import { ScenarioConversionDialog } from './ScenarioConversionDialog'

vi.mock('../api/testingBridge', () => ({ saveWorkflowScenario: vi.fn() }))

const confirmedCase: TestCase = {
  id: 'case-1',
  title: '员工创建目标',
  requirementTitle: '试用期目标',
  module: '试用期管理',
  type: 'normal',
  priority: 'P1',
  riskPoint: '目标没有保存',
  preconditions: ['员工已登录'],
  testData: {},
  steps: [{ order: 1, action: '填写目标', expectedResult: '目标保存成功' }],
  expectedResult: '保存成功',
  isBoundary: false,
  isRepeat: false,
  status: 'confirmed',
  createdAt: '2026-07-28T00:00:00.000Z',
  suiteIds: [],
}

describe('ScenarioConversionDialog', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(saveWorkflowScenario).mockImplementation(async scenario => scenario)
  })

  it('starts each legacy step as an employee action and saves a credential-free workflow scenario', async () => {
    const onSaved = vi.fn()
    render(<ScenarioConversionDialog testCase={confirmedCase} onClose={vi.fn()} onSaved={onSaved} />)
    const user = userEvent.setup()

    expect(screen.getByRole('combobox', { name: '步骤 1 执行角色' })).toHaveValue('employee')
    expect(screen.getByDisplayValue('填写目标')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '保存流程场景' }))

    await waitFor(() => expect(saveWorkflowScenario).toHaveBeenCalledTimes(1))
    const payload = vi.mocked(saveWorkflowScenario).mock.calls[0][0]
    expect(payload).toMatchObject({
      id: '',
      sourceTestCaseId: 'case-1',
      title: '员工创建目标',
      scenarioKind: 'single_role',
      businessTags: ['试用期管理'],
      preconditions: ['员工已登录'],
      steps: [expect.objectContaining({ role: 'employee', actionIntent: '填写目标', assertions: ['目标保存成功'] })],
    })
    expect(JSON.stringify(payload)).not.toMatch(/password|credential|username/i)
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ sourceTestCaseId: 'case-1' }))
  })

  it('preserves generated account handoffs and defaults them to a workflow scenario', async () => {
    const onSaved = vi.fn()
    render(<ScenarioConversionDialog testCase={{
      ...confirmedCase,
      type: 'combination',
      steps: [
        { order: 1, role: 'employee', action: '提交目标', expectedResult: '提交成功' },
        { order: 2, role: 'manager', action: '退回目标', expectedResult: '显示退回说明' },
        { order: 3, role: 'hrbp', action: '终止流程', expectedResult: '流程终止' },
      ],
    }} onClose={vi.fn()} onSaved={onSaved} />)
    const user = userEvent.setup()

    expect(screen.getByRole('combobox', { name: '步骤 1 执行角色' })).toHaveValue('employee')
    expect(screen.getByRole('combobox', { name: '步骤 2 执行角色' })).toHaveValue('manager')
    expect(screen.getByRole('combobox', { name: '步骤 3 执行角色' })).toHaveValue('hrbp')
    expect(screen.getByRole('combobox', { name: '场景类型' })).toHaveValue('workflow')

    await user.click(screen.getByRole('button', { name: '保存流程场景' }))
    await waitFor(() => expect(saveWorkflowScenario).toHaveBeenCalledTimes(1))
    expect(vi.mocked(saveWorkflowScenario).mock.calls[0][0]).toMatchObject({
      scenarioKind: 'workflow',
      steps: [
        expect.objectContaining({ role: 'employee' }),
        expect.objectContaining({ role: 'manager' }),
        expect.objectContaining({ role: 'hrbp' }),
      ],
    })
  })
})
