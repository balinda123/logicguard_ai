export type ExecutionRunStatus =
  | 'queued'
  | 'preflight'
  | 'running'
  | 'pause_requested'
  | 'paused'
  | 'waiting_handoff'
  | 'passed'
  | 'business_failed'
  | 'blocked'
  | 'cancelled'
  | 'interrupted'

export type ExecutionErrorCategory =
  | 'invalid_request'
  | 'model_response'
  | 'rate_limited'
  | 'timeout'
  | 'connection'
  | 'business_assertion'
  | 'cancelled'
  | 'interrupted'

export interface ExecutionPlan { commands: readonly Record<string, unknown>[] }

export interface ExecutionRunAccountSnapshot {
  id: string
  role: string
  roleName: string
  displayName: string
  loginMode: 'automatic' | 'manual_sso' | 'manual_otp'
  allowedOrigin: string
  handoffOrigins: readonly string[]
  loginPageUrl: string
  pageLocator?: string
  identityLocator?: string
  privateLocator?: string
  submitLocator?: string
  successLocator?: string
}

export interface ExecutionAccountOrchestrationSnapshot {
  systemId: string
  environmentId: string
  combinationId: string
  accounts: readonly ExecutionRunAccountSnapshot[]
  roleSteps: readonly { commandIndex: number; role: string; accountId: string }[]
}

export interface StartRunInput {
  executionPlan: ExecutionPlan
  snapshot: Readonly<Record<string, unknown>>
}

export interface ExecutionRun {
  id: string
  ownerId: string
  status: ExecutionRunStatus
  currentStep: number
  checkpoint?: Readonly<Record<string, unknown>>
  snapshot: Readonly<Record<string, unknown>>
  executionPlan: ExecutionPlan
  errorCategory?: ExecutionErrorCategory
  errorMessage?: string
  workerPid?: number
  leaseOwner?: string
  leaseExpiresAt?: string
  startedAt?: string
  finishedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ExecutionRunEvent {
  runId: string
  sequence: number
  kind: string
  data: Readonly<Record<string, unknown>>
  createdAt: string
}

export type ExecutionIssueStatus =
  | 'pending_confirmation'
  | 'pending_fix'
  | 'pending_validation'
  | 'closed'
  | 'not_a_bug'

export interface ExecutionIssue {
  id: string
  runId: string
  status: ExecutionIssueStatus
  title: string
  reproductionSteps: string[]
  expectedResult: string
  actualResult: string
  impact: string
  role?: string
  systemId?: string
  environmentId?: string
  createdAt: string
  updatedAt: string
}

export interface UpdateExecutionIssueInput {
  id: string
  title: string
  reproductionSteps: string[]
  expectedResult: string
  actualResult: string
  impact: string
  role?: ExecutionIssue['role']
}

export interface RunUpdatedEvent { run: ExecutionRun }
export interface RunEventPayload { event: ExecutionRunEvent }
