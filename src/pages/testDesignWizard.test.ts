import { describe, expect, it } from 'vitest'

import {
  clampTestDesignStep,
  highestUnlockedTestDesignStep,
  invalidateAfterRequirementChange,
  isHttpUrl,
} from './testDesignWizard'

describe('test design wizard rules', () => {
  it('accepts HTTP and HTTPS URLs while rejecting unsupported URL values', () => {
    expect(isHttpUrl('http://example.com')).toBe(true)
    expect(isHttpUrl('https://example.com/path')).toBe(true)
    expect(isHttpUrl('example.com')).toBe(false)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
  })

  it('unlocks each step only after its prerequisite is complete', () => {
    expect(
      highestUnlockedTestDesignStep({
        hasRequirement: false,
        hasCases: false,
        hasConfirmedCases: false,
      }),
    ).toBe(1)
    expect(
      highestUnlockedTestDesignStep({
        hasRequirement: true,
        hasCases: false,
        hasConfirmedCases: false,
      }),
    ).toBe(2)
    expect(
      highestUnlockedTestDesignStep({
        hasRequirement: true,
        hasCases: true,
        hasConfirmedCases: false,
      }),
    ).toBe(3)
    expect(
      highestUnlockedTestDesignStep({
        hasRequirement: true,
        hasCases: true,
        hasConfirmedCases: true,
      }),
    ).toBe(4)
  })

  it('does not unlock later steps when the requirement prerequisite is missing', () => {
    expect(
      highestUnlockedTestDesignStep({
        hasRequirement: false,
        hasCases: true,
        hasConfirmedCases: true,
      }),
    ).toBe(1)
  })

  it('does not unlock confirmation when generated cases are missing', () => {
    expect(
      highestUnlockedTestDesignStep({
        hasRequirement: true,
        hasCases: false,
        hasConfirmedCases: true,
      }),
    ).toBe(2)
  })

  it('blocks forward jumps and permits backward navigation', () => {
    expect(clampTestDesignStep(4, 2)).toBe(2)
    expect(clampTestDesignStep(1, 4)).toBe(1)
  })

  it('invalidates all downstream completion after requirement changes', () => {
    expect(
      invalidateAfterRequirementChange({
        generated: true,
        reviewed: true,
        executionReady: true,
      }),
    ).toEqual({
      generated: false,
      reviewed: false,
      executionReady: false,
    })
  })
})
