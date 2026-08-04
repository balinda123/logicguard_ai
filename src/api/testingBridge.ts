import { invoke } from '@tauri-apps/api/core'

import { getCdpPort } from './browserBridge'
import { getLlmConfig } from './llmBridge'
import type {
  AccountCombination,
  BusinessRole,
  DefectDraft,
  DefectStatus,
  FailureEvidence,
  LoginAutomationConfig,
  RunStatus,
  ScenarioKind,
  TestAccount,
  WorkflowRun,
  WorkflowRunEvent,
  WorkflowScenario,
  WorkflowScenarioStep,
} from '../types/workflow'

interface RustTestAccount {
  id: string
  displayName: string
  businessRole: BusinessRole
  maskedLoginName: string
  credentialRef: string
  loginMode: TestAccount['loginMode']
  loginConfig: LoginAutomationConfig
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

interface RustWorkflowScenario {
  id: string
  name: string
  scenarioKind: ScenarioKind
  sourceTestCaseId?: string
  businessTagsJson: string
  preconditionsJson: string
  stepsJson: string
  createdAt: string
  updatedAt: string
}

interface RustWorkflowRun {
  id: string
  scenarioId: string
  accountCombinationId?: string
  status: RunStatus
  currentStepOrder: number
  startedAt?: string
  finishedAt?: string
  createdAt: string
  updatedAt: string
}

interface RustWorkflowRunEvent {
  id: string
  runId: string
  sequenceNo: number
  phase: string
  businessRole?: BusinessRole
  message: string
  createdAt: string
}

interface RustFailureEvidence {
  id: string
  runId: string
  stepId: string
  expected: string
  actual: string
  screenshotPath?: string
  createdAt: string
  updatedAt: string
}

interface RustDefectDraft {
  id: string
  status: DefectStatus
  title: string
  reproductionStepsJson: string
  expectedResult: string
  actualResult: string
  impactSummary: string
  businessRole: BusinessRole
  scenarioId: string
  runId: string
  evidenceId?: string
  createdAt: string
  updatedAt: string
}

export interface TestAccountInput {
  displayName: string
  role: BusinessRole
  loginMode: TestAccount['loginMode']
  loginConfig: LoginAutomationConfig
}

export interface AccountCombinationInput {
  id?: string
  name: string
  employeeAccountId?: string
  managerAccountId?: string
  hrbpAccountId?: string
}

export interface WorkflowRunInput {
  scenarioId: string
  accountCombinationId?: string
  status: RunStatus
  currentStepIndex: number
}

export interface WorkflowRunEventInput {
  runId: string
  sequence: number
  phase: string
  role?: BusinessRole
  message: string
}

export interface FailureEvidenceInput {
  id?: string
  runId: string
  stepId: string
  expected: string
  actual: string
  screenshotPath?: string
}

export interface DefectDraftInput {
  id?: string
  scenarioId: string
  runId: string
  evidenceId?: string
  status: DefectStatus
  title: string
  reproductionSteps: string[]
  expectedResult: string
  actualResult: string
  impact: string
  role: BusinessRole
}

function parseStringList(serialized: string): string[] {
  try {
    const value: unknown = JSON.parse(serialized)
    return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : []
  } catch {
    return []
  }
}

function parseSteps(serialized: string): WorkflowScenarioStep[] {
  try {
    const value: unknown = JSON.parse(serialized)
    if (!Array.isArray(value)) return []
    return value.filter((item): item is WorkflowScenarioStep => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Partial<WorkflowScenarioStep>
      return typeof candidate.id === 'string'
        && typeof candidate.order === 'number'
        && (candidate.role === 'employee' || candidate.role === 'manager' || candidate.role === 'hrbp')
        && typeof candidate.actionIntent === 'string'
        && Array.isArray(candidate.assertions)
        && candidate.assertions.every(assertion => typeof assertion === 'string')
        && typeof candidate.createdAt === 'string'
        && typeof candidate.updatedAt === 'string'
    })
  } catch {
    return []
  }
}

function mapTestAccount(account: RustTestAccount): TestAccount {
  return {
    id: account.id,
    role: account.businessRole,
    displayName: account.displayName,
    maskedLoginName: account.maskedLoginName,
    credentialRef: account.credentialRef,
    loginMode: account.loginMode,
    enabled: account.isEnabled,
    loginConfig: account.loginConfig,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }
}

function mapScenario(scenario: RustWorkflowScenario): WorkflowScenario {
  return {
    id: scenario.id,
    sourceTestCaseId: scenario.sourceTestCaseId ?? '',
    title: scenario.name,
    scenarioKind: scenario.scenarioKind,
    businessTags: parseStringList(scenario.businessTagsJson),
    preconditions: parseStringList(scenario.preconditionsJson),
    steps: parseSteps(scenario.stepsJson),
    createdAt: scenario.createdAt,
    updatedAt: scenario.updatedAt,
  }
}

function mapRun(run: RustWorkflowRun): WorkflowRun {
  return {
    id: run.id,
    scenarioId: run.scenarioId,
    accountCombinationId: run.accountCombinationId,
    status: run.status,
    currentStepIndex: run.currentStepOrder,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  }
}

function mapEvent(event: RustWorkflowRunEvent): WorkflowRunEvent {
  return {
    id: event.id,
    runId: event.runId,
    sequence: event.sequenceNo,
    phase: event.phase,
    role: event.businessRole,
    message: event.message,
    occurredAt: event.createdAt,
  }
}

function mapEvidence(evidence: RustFailureEvidence): FailureEvidence {
  return evidence
}

function mapDefect(draft: RustDefectDraft): DefectDraft {
  return {
    id: draft.id,
    status: draft.status,
    title: draft.title,
    reproductionSteps: parseStringList(draft.reproductionStepsJson),
    expectedResult: draft.expectedResult,
    actualResult: draft.actualResult,
    impact: draft.impactSummary,
    role: draft.businessRole,
    scenarioId: draft.scenarioId,
    runId: draft.runId,
    evidenceId: draft.evidenceId,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  }
}

export async function listTestAccounts(): Promise<TestAccount[]> {
  const accounts = await invoke<RustTestAccount[]>('list_test_accounts')
  return accounts.map(mapTestAccount)
}

export async function createTestAccount(input: TestAccountInput): Promise<TestAccount> {
  const account = await invoke<RustTestAccount>('create_test_account', {
    input: {
      displayName: input.displayName,
      businessRole: input.role,
      loginMode: input.loginMode,
      loginConfig: input.loginConfig,
    },
  })
  return mapTestAccount(account)
}

export async function updateTestAccount(id: string, input: TestAccountInput): Promise<TestAccount> {
  const account = await invoke<RustTestAccount>('update_test_account', {
    input: {
      id,
      displayName: input.displayName,
      businessRole: input.role,
      loginMode: input.loginMode,
      loginConfig: input.loginConfig,
    },
  })
  return mapTestAccount(account)
}

export async function disableTestAccount(id: string): Promise<void> {
  await invoke('disable_test_account', { id })
}

/** Credentials are sent once to the OS credential store and never cached in this module. */
export async function setTestAccountCredential(accountId: string, username: string, password: string): Promise<void> {
  await invoke('set_test_account_credential', { accountId, username, password })
}

export async function listAccountCombinations(): Promise<AccountCombination[]> {
  return await invoke<AccountCombination[]>('list_account_combinations')
}

export async function saveAccountCombination(input: AccountCombinationInput): Promise<AccountCombination> {
  return await invoke<AccountCombination>('save_account_combination', { input })
}

export async function deleteAccountCombination(id: string): Promise<void> {
  await invoke('delete_account_combination', { id })
}

export async function listWorkflowScenarios(): Promise<WorkflowScenario[]> {
  const scenarios = await invoke<RustWorkflowScenario[]>('list_workflow_scenarios')
  return scenarios.map(mapScenario)
}

export async function saveWorkflowScenario(scenario: WorkflowScenario): Promise<WorkflowScenario> {
  const result = await invoke<RustWorkflowScenario>('save_workflow_scenario', {
    input: {
      id: scenario.id || null,
      name: scenario.title,
      scenarioKind: scenario.scenarioKind,
      sourceTestCaseId: scenario.sourceTestCaseId || null,
      businessTagsJson: JSON.stringify(scenario.businessTags),
      preconditionsJson: JSON.stringify(scenario.preconditions),
      stepsJson: JSON.stringify(scenario.steps),
    },
  })
  return mapScenario(result)
}

export async function deleteWorkflowScenario(id: string): Promise<void> {
  await invoke('delete_workflow_scenario', { id })
}

export async function createWorkflowRun(input: WorkflowRunInput): Promise<WorkflowRun> {
  const run = await invoke<RustWorkflowRun>('create_workflow_run', {
    input: {
      scenarioId: input.scenarioId,
      accountCombinationId: input.accountCombinationId ?? null,
      status: input.status,
      currentStepOrder: input.currentStepIndex,
    },
  })
  return mapRun(run)
}

export async function updateWorkflowRun(id: string, status: RunStatus, currentStepIndex: number): Promise<WorkflowRun> {
  const run = await invoke<RustWorkflowRun>('update_workflow_run', {
    input: { id, status, currentStepOrder: currentStepIndex },
  })
  return mapRun(run)
}

export async function listWorkflowRuns(): Promise<WorkflowRun[]> {
  const runs = await invoke<RustWorkflowRun[]>('list_workflow_runs')
  return runs.map(mapRun)
}

export async function appendWorkflowRunEvent(input: WorkflowRunEventInput): Promise<WorkflowRunEvent> {
  const event = await invoke<RustWorkflowRunEvent>('append_workflow_run_event', {
    input: {
      runId: input.runId,
      sequenceNo: input.sequence,
      phase: input.phase,
      businessRole: input.role ?? null,
      message: input.message,
    },
  })
  return mapEvent(event)
}

export async function listWorkflowRunEvents(runId: string): Promise<WorkflowRunEvent[]> {
  const events = await invoke<RustWorkflowRunEvent[]>('list_workflow_run_events', { runId })
  return events.map(mapEvent)
}

export async function saveFailureEvidence(input: FailureEvidenceInput): Promise<FailureEvidence> {
  const evidence = await invoke<RustFailureEvidence>('save_failure_evidence', { input })
  return mapEvidence(evidence)
}

export async function listFailureEvidence(runId?: string): Promise<FailureEvidence[]> {
  const evidence = await invoke<RustFailureEvidence[]>('list_failure_evidence', { runId: runId ?? null })
  return evidence.map(mapEvidence)
}

export async function saveDefectDraft(input: DefectDraftInput): Promise<DefectDraft> {
  const draft = await invoke<RustDefectDraft>('save_defect_draft', {
    input: {
      id: input.id ?? null,
      scenarioId: input.scenarioId,
      runId: input.runId,
      evidenceId: input.evidenceId ?? null,
      status: input.status,
      title: input.title,
      reproductionStepsJson: JSON.stringify(input.reproductionSteps),
      expectedResult: input.expectedResult,
      actualResult: input.actualResult,
      impactSummary: input.impact,
      businessRole: input.role,
    },
  })
  return mapDefect(draft)
}

export async function listDefectDrafts(): Promise<DefectDraft[]> {
  const drafts = await invoke<RustDefectDraft[]>('list_defect_drafts')
  return drafts.map(mapDefect)
}

export async function updateDefectDraftStatus(id: string, status: DefectStatus): Promise<DefectDraft> {
  const draft = await invoke<RustDefectDraft>('update_defect_draft_status', { id, status })
  return mapDefect(draft)
}

export async function clearBrowserSession(): Promise<void> {
  await invoke('browser_clear_session', { port: getCdpPort() })
}

/** Starts a credential-store-owned login. No credential is readable by the frontend. */
export async function loginTestAccount(accountId: string): Promise<{
  status: 'completed' | 'manual_handoff_required'
  finalUrl?: string
}> {
  return await invoke('browser_login_test_account', {
    accountId,
    port: getCdpPort(),
    config: getLlmConfig(),
  })
}

export async function captureFailureScreenshot(runId: string, stepId: string): Promise<{ screenshotPath: string }> {
  return await invoke<{ screenshotPath: string }>('browser_capture_failure_screenshot', {
    runId,
    stepId,
    port: getCdpPort(),
  })
}
