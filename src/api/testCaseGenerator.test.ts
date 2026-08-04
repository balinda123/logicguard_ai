import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { generateTestCasesFromRequirement } from './testCaseGenerator'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('./llmBridge', () => ({ getLlmConfig: () => ({ provider: 'openai_compat', model: 'test' }) }))
vi.mock('../utils/privacy', () => ({ sanitizeForLlm: (value: string) => value }))

describe('generateTestCasesFromRequirement', () => {
  beforeEach(() => vi.clearAllMocks())

  it('ignores trailing bracketed commentary after the first complete JSON array', async () => {
    vi.mocked(invoke).mockResolvedValue(`${JSON.stringify([{
      title: '员工提交目标',
      requirementTitle: '试用期目标流转',
      module: '试用期',
      type: 'normal',
      priority: 'P0',
      steps: [{ order: 1, role: 'employee', action: '提交目标', expectedResult: '提交成功' }],
      expectedResult: '目标提交成功',
    }])}\n补充说明：[以上用例已覆盖正常流程]`)

    const cases = await generateTestCasesFromRequirement('员工提交试用期目标', '试用期')

    expect(cases).toHaveLength(1)
    expect(cases[0].title).toBe('员工提交目标')
  })

  it('unwraps the test-case array instead of an earlier metadata array', async () => {
    vi.mocked(invoke).mockResolvedValue(JSON.stringify({
      preconditions: ['测试环境可用', '流程数据可重置', '员工账号可用', '上级账号可用'],
      testCases: [{
        title: '员工提交后上级退回',
        requirementTitle: '试用期目标流转',
        module: '试用期',
        type: 'combination',
        priority: 'P0',
        steps: [
          { order: 1, role: 'employee', action: '提交目标', expectedResult: '进入上级待办' },
          { order: 2, role: 'manager', action: '退回目标', expectedResult: '回到员工待办' },
        ],
        expectedResult: '状态按角色流转',
      }],
    }))

    const cases = await generateTestCasesFromRequirement('员工提交后由上级退回', '试用期')

    expect(cases).toHaveLength(1)
    expect(cases[0].title).toBe('员工提交后上级退回')
    expect(cases[0].steps.map(step => step.role)).toEqual(['employee', 'manager'])
  })

  it('accepts a single case object returned by json_object mode', async () => {
    vi.mocked(invoke).mockResolvedValue(JSON.stringify({
      title: 'employee lower-bound validation',
      type: 'boundary',
      preconditions: ['employee is logged in'],
      steps: [{ order: 1, role: 'employee', action: 'submit 9 chars', expectedResult: 'show minimum 10 chars' }],
      expectedResult: 'submission is blocked',
    }))

    const cases = await generateTestCasesFromRequirement('minimum 10 chars', 'probation')

    expect(cases).toHaveLength(1)
    expect(cases[0].title).toBe('employee lower-bound validation')
  })

  it('collects case objects grouped by arbitrary keys', async () => {
    vi.mocked(invoke).mockResolvedValue(JSON.stringify({
      normalCase: {
        title: 'employee submits a valid goal',
        type: 'normal',
        steps: [{ order: 1, role: 'employee', action: 'submit goal', expectedResult: 'submitted' }],
      },
      workflowCase: {
        title: 'manager reviews employee goal',
        type: 'combination',
        steps: [
          { order: 1, role: 'employee', action: 'submit goal', expectedResult: 'manager task created' },
          { order: 2, role: 'manager', action: 'approve goal', expectedResult: 'state advances' },
        ],
      },
    }))

    const cases = await generateTestCasesFromRequirement('role handoff', 'probation')

    expect(cases.map((item) => item.title)).toEqual([
      'employee submits a valid goal',
      'manager reviews employee goal',
    ])
  })

  it('parses a JSON array wrapped in a string field', async () => {
    vi.mocked(invoke).mockResolvedValue(JSON.stringify({
      content: JSON.stringify([{
        title: 'HRBP termination boundary',
        type: 'boundary',
        steps: [{ order: 1, role: 'hrbp', action: 'enter 9 chars', expectedResult: 'termination is blocked' }],
      }]),
    }))

    const cases = await generateTestCasesFromRequirement('termination reason minimum length', 'probation')

    expect(cases[0].title).toBe('HRBP termination boundary')
  })

  it('uses the case-generation command and keeps the role assigned to each step', async () => {
    vi.mocked(invoke).mockResolvedValue(JSON.stringify([{
      title: '员工提交后上级退回',
      requirementTitle: '试用期目标流转',
      module: '试用期',
      type: 'combination',
      priority: 'P0',
      riskPoint: '角色交接丢失',
      preconditions: ['三个测试账号可用'],
      testData: {},
      steps: [
        { order: 1, role: 'employee', action: '提交目标', expectedResult: '进入上级评价' },
        { order: 2, role: 'manager', action: '退回目标', expectedResult: '员工可修改' },
        { order: 3, role: 'hrbp', action: '终止流程', expectedResult: '流程终止' },
      ],
      expectedResult: '状态按角色流转',
    }]))

    const cases = await generateTestCasesFromRequirement('试用期目标提交、退回、终止', '试用期')

    expect(invoke).toHaveBeenLastCalledWith('generate_test_cases', expect.objectContaining({ prompt: expect.any(String) }))
    expect(vi.mocked(invoke).mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({
      prompt: expect.stringContaining('"testCases"'),
    }))
    expect(cases[0].steps.map(step => step.role)).toEqual(['employee', 'manager', 'hrbp'])
  })
})
