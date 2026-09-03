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

export function restoreTestDesignStep(input: {
  highest: TestDesignStep
  saved?: number
  requested?: TestDesignStep
  reviewComplete: boolean
}): TestDesignStep {
  if (input.requested) return clampTestDesignStep(input.requested, input.highest)
  // 全部用例确认后优先进入执行页，避免用户每次重新打开都要重复寻找第四步。
  if (input.reviewComplete && input.highest === 4) return 4
  if (input.saved && input.saved >= 1 && input.saved <= 4) {
    return clampTestDesignStep(input.saved as TestDesignStep, input.highest)
  }
  return input.highest
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
