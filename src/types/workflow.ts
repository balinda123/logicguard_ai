/** System-defined actor key. Legacy values include employee, manager and hrbp. */
export type BusinessRole = string

export type LoginMode = 'automatic' | 'manual_sso' | 'manual_otp'

export type ScenarioKind = 'single_role' | 'permission' | 'workflow' | 'branch'

export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_handoff'
  | 'execution_blocked'
  | 'business_failed'
  | 'passed'
  | 'cancelled'

export type DefectStatus =
  | 'pending_confirmation'
  | 'pending_fix'
  | 'pending_validation'
  | 'closed'
  | 'not_a_bug'

export interface ScopeRef {
  systemId: string
  environmentId: string
}

export interface AccountEnvironmentScope extends ScopeRef {
  baseUrl: string
  loginUrl: string
  handoffOrigins: string[]
}

export type ScopeState = 'scoped' | 'legacy'

export interface WorkflowRunSnapshotAccount {
  readonly id: string
  readonly role: BusinessRole
  readonly displayName: string
}

export interface WorkflowRunSnapshot {
  readonly scenario: {
    readonly id: string
    readonly name: string
    readonly scenarioKind: ScenarioKind
    readonly sourceTestCaseId?: string
    readonly steps: readonly WorkflowScenarioStep[]
  }
  readonly combination?: {
    readonly id: string
    readonly name: string
    readonly accounts: readonly WorkflowRunSnapshotAccount[]
  }
  readonly caseIds: readonly string[]
}

interface ScopedRecord {
  systemId?: string
  environmentId?: string
  scopeState?: ScopeState
}

export interface WorkflowScenarioStep {
  id: string
  order: number
  role: BusinessRole
  actionIntent: string
  assertions: string[]
  pageUrl?: string
  selector?: string
  expectedValue?: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowScenario extends ScopedRecord {
  id: string
  sourceTestCaseId: string
  title: string
  scenarioKind: ScenarioKind
  businessTags: string[]
  preconditions: string[]
  steps: WorkflowScenarioStep[]
  createdAt: string
  updatedAt: string
}

/** Contains only browser field selectors and human-readable login expectations. */
export interface LoginAutomationConfig {
  loginUrl: string
  /** Trusted external origins that may host SSO or OTP handoff pages. */
  handoffOrigins?: string[]
  pageSelector?: string
  usernameSelector?: string
  passwordSelector?: string
  submitSelector?: string
  successSelector?: string
}

export interface TestAccount extends ScopedRecord {
  id: string
  role: BusinessRole
  roleName?: string
  displayName: string
  maskedLoginName: string
  credentialRef: string
  loginMode: LoginMode
  enabled: boolean
  loginConfig: LoginAutomationConfig
  createdAt: string
  updatedAt: string
}

export interface AccountCombination extends ScopedRecord {
  id: string
  name: string
  employeeAccountId?: string
  managerAccountId?: string
  hrbpAccountId?: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowRun extends ScopedRecord {
  id: string
  scenarioId: string
  accountCombinationId?: string
  status: RunStatus
  currentStepIndex: number
  designId?: string
  requirementVersionId?: string
  snapshot?: WorkflowRunSnapshot
  startedAt?: string
  finishedAt?: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowRunEvent {
  id: string
  runId: string
  sequence: number
  phase: string
  role?: BusinessRole
  message: string
  occurredAt: string
}

export interface FailureEvidence extends ScopedRecord {
  id: string
  runId: string
  stepId: string
  expected: string
  actual: string
  screenshotPath?: string
  createdAt: string
  updatedAt: string
}

export interface DefectDraft extends ScopedRecord {
  id: string
  status: DefectStatus
  title: string
  reproductionSteps: string[]
  expectedResult: string
  actualResult: string
  impact: string
  role?: BusinessRole
  scenarioId: string
  runId: string
  evidenceId?: string
  createdAt: string
  updatedAt: string
}

const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  'execution_blocked',
  'business_failed',
  'passed',
  'cancelled',
]

const DEFECT_TRANSITIONS: Readonly<Record<DefectStatus, readonly DefectStatus[]>> = {
  pending_confirmation: ['pending_fix', 'not_a_bug'],
  pending_fix: ['pending_validation'],
  pending_validation: ['closed', 'pending_fix'],
  closed: [],
  not_a_bug: [],
}

export function canCreateDefectDraft(status: RunStatus): boolean {
  return status === 'business_failed'
}

export function isRunTerminal(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status)
}

export function transitionDefectStatus(current: DefectStatus, next: DefectStatus): boolean {
  return (DEFECT_TRANSITIONS[current] ?? []).includes(next)
}
