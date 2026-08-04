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
  role: 'employee' | 'manager' | 'hrbp'
  loginMode: 'automatic' | 'manual_sso' | 'manual_otp'
  allowedOrigin: string
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
  roleSteps: readonly { commandIndex: number; role: ExecutionRunAccountSnapshot['role']; accountId: string }[]
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

export interface RunUpdatedEvent { run: ExecutionRun }
export interface RunEventPayload { event: ExecutionRunEvent }
