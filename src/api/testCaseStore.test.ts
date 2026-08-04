import { beforeEach, describe, expect, it } from 'vitest'

import { loadTestCases, saveTestCases } from './testCaseStore'

describe('loadTestCases', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('removes only the known legacy placeholder cases', () => {
    localStorage.setItem('logicguard_test_cases_anonymous', JSON.stringify([
      { id: 'legacy', title: '正常流程测试', requirementTitle: '入职登记表问题', riskPoint: '需求覆盖不足' },
      { id: 'real', title: '输入101字校验', requirementTitle: '3.1 输入字数与提交校验', riskPoint: '字数上限校验失效' },
    ]))

    expect(loadTestCases().map(testCase => testCase.id)).toEqual(['real'])
  })

  it('removes generated generic fallback cases while keeping detailed generated cases', () => {
    localStorage.setItem('logicguard_test_cases_anonymous', JSON.stringify([
      {
        id: 'generic',
        title: '正常流程：场景模板：试用期全角色字数校验测试',
        requirementTitle: '场景模板：试用期全角色字数校验测试',
        riskPoint: '正常流程覆盖不足',
        expectedResult: '系统行为符合需求。',
        steps: [
          { order: 1, action: '进入试用期相关页面' },
          { order: 2, action: '按正常流程场景填写或查询测试数据' },
          { order: 3, action: '提交或保存后检查结果' },
        ],
      },
      {
        id: 'detailed',
        title: '员工提交后上级退回目标',
        requirementTitle: '3.1 输入字数与提交校验',
        riskPoint: '多角色状态流转失败',
        expectedResult: '目标回到员工待办',
        steps: [{ order: 1, role: 'manager', action: '退回目标' }],
      },
    ]))

    expect(loadTestCases().map(testCase => testCase.id)).toEqual(['detailed'])
  })

  it('does not persist legacy placeholders when current UI state still contains them', () => {
    saveTestCases([
      { id: 'legacy', title: '正常流程测试 ', requirementTitle: ' 入职登记表问题 ', riskPoint: '需求覆盖不足 ', expectedResult: '' },
      { id: 'real', title: '员工目标边界校验', requirementTitle: '3.1', riskPoint: '边界错误' },
    ] as any)

    expect(loadTestCases().map(testCase => testCase.id)).toEqual(['real'])
  })
})
