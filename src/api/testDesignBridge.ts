import { invoke } from '@tauri-apps/api/core'

import type {
  CreateEnvironmentInput,
  DesignTestCaseRecord,
  CreateGenerationBatchInput,
  CreateRegressionConfigInput,
  CreateRequirementVersionInput,
  CreateReviewRecordInput,
  CreateTestDesignInput,
  GenerationBatch,
  RegressionConfig,
  RequirementVersion,
  ReviewRecord,
  SystemEnvironment,
  TestDesign,
  TestSystem,
  UpdateEnvironmentInput,
  SaveGenerationCasesInput,
  UpdateDesignCaseStatusInput,
  UpdateTestDesignInput,
  UpdateTestSystemInput,
} from '../types/testDesign'

type RustTestDesign = Omit<TestDesign, 'currentRequirementVersionId'> & {
  currentRequirementVersionId: string | null
}

type RustGenerationBatch = Omit<GenerationBatch, 'templateId'> & {
  templateId: string | null
}

type RustRegressionConfig = Omit<RegressionConfig, 'suiteId' | 'accountCombinationId'> & {
  suiteId: string | null
  accountCombinationId: string | null
}

type RustDesignTestCase = Omit<DesignTestCaseRecord, 'generationBatchId'> & {
  generationBatchId: string | null
}

function mapTestDesign(record: RustTestDesign): TestDesign {
  return {
    ...record,
    currentRequirementVersionId: record.currentRequirementVersionId ?? undefined,
  }
}

function mapGenerationBatch(record: RustGenerationBatch): GenerationBatch {
  return { ...record, templateId: record.templateId ?? undefined }
}

function mapRegressionConfig(record: RustRegressionConfig): RegressionConfig {
  return {
    ...record,
    suiteId: record.suiteId ?? undefined,
    accountCombinationId: record.accountCombinationId ?? undefined,
  }
}

function mapDesignTestCase(record: RustDesignTestCase): DesignTestCaseRecord {
  return { ...record, generationBatchId: record.generationBatchId ?? undefined }
}

export async function listSystems(): Promise<TestSystem[]> {
  return invoke<TestSystem[]>('list_systems')
}

export async function createSystem(name: string): Promise<TestSystem> {
  return invoke<TestSystem>('create_system', { name })
}

export async function updateSystem(input: UpdateTestSystemInput): Promise<TestSystem> {
  return invoke<TestSystem>('update_system', { input })
}

export async function listSystemEnvironments(systemId: string): Promise<SystemEnvironment[]> {
  return invoke<SystemEnvironment[]>('list_system_environments', { systemId })
}

export async function createSystemEnvironment(input: CreateEnvironmentInput): Promise<SystemEnvironment> {
  return invoke<SystemEnvironment>('create_system_environment', { input })
}

export async function updateSystemEnvironment(input: UpdateEnvironmentInput): Promise<SystemEnvironment> {
  return invoke<SystemEnvironment>('update_system_environment', { input })
}

export async function listTestDesigns(systemId?: string, environmentId?: string): Promise<TestDesign[]> {
  const records = await invoke<RustTestDesign[]>('list_test_designs', { systemId, environmentId })
  return records.map(mapTestDesign)
}

export async function createTestDesign(input: CreateTestDesignInput): Promise<TestDesign> {
  return mapTestDesign(await invoke<RustTestDesign>('create_test_design', { input }))
}

export async function updateTestDesign(input: UpdateTestDesignInput): Promise<TestDesign> {
  return mapTestDesign(await invoke<RustTestDesign>('update_test_design', { input }))
}

export async function listRequirementVersions(designId: string): Promise<RequirementVersion[]> {
  return invoke<RequirementVersion[]>('list_requirement_versions', { designId })
}

export async function createRequirementVersion(input: CreateRequirementVersionInput): Promise<RequirementVersion> {
  return invoke<RequirementVersion>('create_requirement_version', { input })
}

export async function listGenerationBatches(designId: string): Promise<GenerationBatch[]> {
  const records = await invoke<RustGenerationBatch[]>('list_generation_batches', { designId })
  return records.map(mapGenerationBatch)
}

export async function createGenerationBatch(input: CreateGenerationBatchInput): Promise<GenerationBatch> {
  return mapGenerationBatch(await invoke<RustGenerationBatch>('create_generation_batch', { input }))
}

export async function listDesignTestCases(designId: string): Promise<DesignTestCaseRecord[]> {
  return (await invoke<RustDesignTestCase[]>('list_design_test_cases', { designId })).map(mapDesignTestCase)
}

export async function saveGenerationCases(input: SaveGenerationCasesInput): Promise<DesignTestCaseRecord[]> {
  return (await invoke<RustDesignTestCase[]>('save_generation_cases', { input })).map(mapDesignTestCase)
}

export async function updateDesignCaseStatus(input: UpdateDesignCaseStatusInput): Promise<DesignTestCaseRecord> {
  return mapDesignTestCase(await invoke<RustDesignTestCase>('update_design_case_status', { input }))
}

export async function listReviewRecords(designId: string): Promise<ReviewRecord[]> {
  return invoke<ReviewRecord[]>('list_review_records', { designId })
}

export async function createReview(input: CreateReviewRecordInput): Promise<ReviewRecord> {
  return invoke<ReviewRecord>('create_review', { input })
}

export async function getRegressionConfig(designId: string): Promise<RegressionConfig | undefined> {
  const record = await invoke<RustRegressionConfig | null>('get_regression_config', { designId })
  return record ? mapRegressionConfig(record) : undefined
}

export async function saveRegressionConfig(input: CreateRegressionConfigInput): Promise<RegressionConfig> {
  return mapRegressionConfig(await invoke<RustRegressionConfig>('save_regression_config', { input }))
}
