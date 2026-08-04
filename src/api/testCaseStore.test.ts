import { beforeEach, describe, expect, it } from 'vitest'

import { isCaseSourceStale, loadLegacyTestCases } from './testCaseStore'
import type { TestCase } from '../types'

const testCase = {
  id: 'case-1',
  title: 'Case',
  requirementTitle: 'Requirement',
  module: 'Payroll',
  type: 'normal',
  priority: 'P1',
  riskPoint: '',
  preconditions: [],
  testData: {},
  steps: [],
  expectedResult: 'Approved',
  isBoundary: false,
  isRepeat: false,
  status: 'draft',
  createdAt: 'now',
  suiteIds: [],
} satisfies TestCase

beforeEach(() => {
  localStorage.clear()
  sessionStorage.setItem('logicguard_user_id', 'user-1')
})

describe('legacy test case compatibility', () => {
  it('reads the existing user-scoped test_cases key for migration', () => {
    localStorage.setItem('logicguard_test_cases_user-1', JSON.stringify([testCase]))
    expect(loadLegacyTestCases()).toEqual([testCase])
  })

  it('marks a scoped case stale only when its requirement version differs', () => {
    expect(isCaseSourceStale({ ...testCase, requirementVersionId: 'requirement-1' }, 'requirement-2')).toBe(true)
    expect(isCaseSourceStale({ ...testCase, requirementVersionId: 'requirement-2' }, 'requirement-2')).toBe(false)
    expect(isCaseSourceStale(testCase, 'requirement-2')).toBe(true)
    expect(isCaseSourceStale(testCase, undefined)).toBe(false)
  })
})
