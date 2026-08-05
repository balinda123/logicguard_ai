export type EnvironmentKind = 'local' | 'test'

export interface TestSystem {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface SystemEnvironment {
  id: string
  systemId: string
  kind: EnvironmentKind
  name: string
  baseUrl: string
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

export interface TestDesign {
  id: string
  systemId: string
  environmentId: string
  title: string
  status: string
  currentRequirementVersionId?: string
  createdAt: string
  updatedAt: string
}

export interface RequirementVersion {
  id: string
  designId: string
  versionNo: number
  sourceKind: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface GenerationBatch {
  id: string
  designId: string
  requirementVersionId: string
  model: string
  templateId?: string
  isStale: boolean
  createdAt: string
  updatedAt: string
}

export interface DesignTestCaseRecord {
  id: string
  designId: string
  requirementVersionId: string
  generationBatchId?: string
  payload: Record<string, unknown>
  status: 'draft' | 'confirmed' | 'archived'
  createdAt: string
  updatedAt: string
}

export interface ReviewRecord {
  id: string
  designId: string
  generationBatchId: string
  reviewerId: string
  conclusion: string
  changeSummary: string
  createdAt: string
  updatedAt: string
}

export interface RegressionConfig {
  id: string
  designId: string
  suiteId?: string
  accountCombinationId?: string
  caseIdsJson: string
  createdAt: string
  updatedAt: string
}

export interface UpdateTestSystemInput {
  id: string
  name: string
}

export interface CreateEnvironmentInput {
  systemId: string
  kind: EnvironmentKind
  name: string
  baseUrl: string
}

export interface CreateSystemWithEnvironmentInput {
  systemName: string
  kind: EnvironmentKind
  environmentName: string
  baseUrl: string
}

export interface SystemEnvironmentScope {
  system: TestSystem
  environment: SystemEnvironment
}

export interface UpdateEnvironmentInput extends CreateEnvironmentInput {
  id: string
  isEnabled: boolean
}

export interface CreateTestDesignInput {
  systemId: string
  environmentId: string
  title: string
  status: string
}

export interface UpdateTestDesignInput extends CreateTestDesignInput {
  id: string
}

export interface CreateRequirementVersionInput {
  designId: string
  sourceKind: string
  content: string
}

export interface CreateGenerationBatchInput {
  designId: string
  requirementVersionId: string
  model: string
  templateId?: string
}

export interface SaveGenerationCasesInput {
  designId: string
  requirementVersionId: string
  generationBatchId: string
  cases: readonly Record<string, unknown>[]
}

export interface UpdateDesignCaseStatusInput {
  designId: string
  caseId: string
  status: 'draft' | 'confirmed' | 'archived'
}

export interface CreateReviewRecordInput {
  designId: string
  generationBatchId: string
  conclusion: string
  changeSummary: string
}

export interface CreateRegressionConfigInput {
  designId: string
  suiteId?: string
  accountCombinationId?: string
  caseIdsJson: string
}
