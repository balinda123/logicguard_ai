export type TestDesignStep = 1 | 2 | 3 | 4
export type ModelerStep = 1 | 2 | 3 | 4

export interface WizardCompletionState {
  generated: boolean
  reviewed: boolean
  executionReady: boolean
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function highestUnlockedTestDesignStep(input: {
  hasRequirement: boolean
  hasCases: boolean
  hasConfirmedCases: boolean
}): TestDesignStep {
  if (!input.hasRequirement) return 1
  if (!input.hasCases) return 2
  if (input.hasConfirmedCases) return 4
  return 3
}

export function clampTestDesignStep(
  requested: TestDesignStep,
  highest: TestDesignStep,
): TestDesignStep {
  return Math.min(requested, highest) as TestDesignStep
}

export function invalidateAfterRequirementChange(
  state: WizardCompletionState,
): WizardCompletionState {
  void state
  return {
    generated: false,
    reviewed: false,
    executionReady: false,
  }
}
