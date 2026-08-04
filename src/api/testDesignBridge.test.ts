import { invoke } from '@tauri-apps/api/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createGenerationBatch,
  createRequirementVersion,
  createReview,
  createSystem,
  createSystemEnvironment,
  createTestDesign,
  getRegressionConfig,
  listDesignTestCases,
  listGenerationBatches,
  listRequirementVersions,
  listReviewRecords,
  listSystemEnvironments,
  listSystems,
  listTestDesigns,
  saveRegressionConfig,
  saveGenerationCases,
  updateSystem,
  updateSystemEnvironment,
  updateTestDesign,
  updateDesignCaseStatus,
} from './testDesignBridge'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const invokeMock = vi.mocked(invoke)
const record = { id: 'id-1', createdAt: 'now', updatedAt: 'now' }

afterEach(() => invokeMock.mockReset())

describe('testDesignBridge', () => {
  it('uses the Rust command names and camelCase arguments', async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command.startsWith('list_')) return []
      if (command === 'get_regression_config') return null
      if (command === 'create_test_design' || command === 'update_test_design') {
        return { ...record, currentRequirementVersionId: null }
      }
      if (command === 'create_generation_batch') return { ...record, templateId: null }
      if (command === 'save_generation_cases') return []
      if (command === 'update_design_case_status') return { ...record, generationBatchId: null, payload: {}, status: 'confirmed' }
      if (command === 'save_regression_config') {
        return { ...record, suiteId: null, accountCombinationId: null }
      }
      return record
    })

    await listSystems()
    await createSystem('Payroll')
    await updateSystem({ id: 'system-1', name: 'Payroll v2' })
    await listSystemEnvironments('system-1')
    await createSystemEnvironment({ systemId: 'system-1', kind: 'local', name: 'Local', baseUrl: 'http://localhost:3000' })
    await updateSystemEnvironment({ id: 'environment-1', systemId: 'system-1', kind: 'test', name: 'QA', baseUrl: 'https://qa.example.test', isEnabled: true })
    await listTestDesigns('system-1', 'environment-1')
    await createTestDesign({ systemId: 'system-1', environmentId: 'environment-1', title: 'Payroll approval', status: 'draft' })
    await updateTestDesign({ id: 'design-1', systemId: 'system-1', environmentId: 'environment-1', title: 'Payroll approval v2', status: 'active' })
    await listRequirementVersions('design-1')
    await createRequirementVersion({ designId: 'design-1', sourceKind: 'text', content: 'v1' })
    await listGenerationBatches('design-1')
    await createGenerationBatch({ designId: 'design-1', requirementVersionId: 'requirement-1', model: 'model-1' })
    await listDesignTestCases('design-1')
    await saveGenerationCases({ designId: 'design-1', requirementVersionId: 'requirement-1', generationBatchId: 'batch-1', cases: [{ id: 'case-1' }] })
    await updateDesignCaseStatus({ designId: 'design-1', caseId: 'case-1', status: 'confirmed' })
    await listReviewRecords('design-1')
    await createReview({ designId: 'design-1', generationBatchId: 'batch-1', conclusion: 'approved', changeSummary: '' })
    await getRegressionConfig('design-1')
    await saveRegressionConfig({ designId: 'design-1', caseIdsJson: '["case-1"]' })

    expect(invokeMock.mock.calls).toEqual([
      ['list_systems'],
      ['create_system', { name: 'Payroll' }],
      ['update_system', { input: { id: 'system-1', name: 'Payroll v2' } }],
      ['list_system_environments', { systemId: 'system-1' }],
      ['create_system_environment', { input: { systemId: 'system-1', kind: 'local', name: 'Local', baseUrl: 'http://localhost:3000' } }],
      ['update_system_environment', { input: { id: 'environment-1', systemId: 'system-1', kind: 'test', name: 'QA', baseUrl: 'https://qa.example.test', isEnabled: true } }],
      ['list_test_designs', { systemId: 'system-1', environmentId: 'environment-1' }],
      ['create_test_design', { input: { systemId: 'system-1', environmentId: 'environment-1', title: 'Payroll approval', status: 'draft' } }],
      ['update_test_design', { input: { id: 'design-1', systemId: 'system-1', environmentId: 'environment-1', title: 'Payroll approval v2', status: 'active' } }],
      ['list_requirement_versions', { designId: 'design-1' }],
      ['create_requirement_version', { input: { designId: 'design-1', sourceKind: 'text', content: 'v1' } }],
      ['list_generation_batches', { designId: 'design-1' }],
      ['create_generation_batch', { input: { designId: 'design-1', requirementVersionId: 'requirement-1', model: 'model-1' } }],
      ['list_design_test_cases', { designId: 'design-1' }],
      ['save_generation_cases', { input: { designId: 'design-1', requirementVersionId: 'requirement-1', generationBatchId: 'batch-1', cases: [{ id: 'case-1' }] } }],
      ['update_design_case_status', { input: { designId: 'design-1', caseId: 'case-1', status: 'confirmed' } }],
      ['list_review_records', { designId: 'design-1' }],
      ['create_review', { input: { designId: 'design-1', generationBatchId: 'batch-1', conclusion: 'approved', changeSummary: '' } }],
      ['get_regression_config', { designId: 'design-1' }],
      ['save_regression_config', { input: { designId: 'design-1', caseIdsJson: '["case-1"]' } }],
    ])
  })

  it('creates a new requirement version instead of updating the previous record', async () => {
    invokeMock
      .mockResolvedValueOnce({ ...record, id: 'requirement-1', designId: 'design-1', versionNo: 1, sourceKind: 'text', content: 'v1' })
      .mockResolvedValueOnce({ ...record, id: 'requirement-2', designId: 'design-1', versionNo: 2, sourceKind: 'text', content: 'v2' })

    const first = await createRequirementVersion({ designId: 'design-1', sourceKind: 'text', content: 'v1' })
    const second = await createRequirementVersion({ designId: 'design-1', sourceKind: 'text', content: 'v2' })

    expect(first).toMatchObject({ id: 'requirement-1', versionNo: 1, content: 'v1' })
    expect(second).toMatchObject({ id: 'requirement-2', versionNo: 2, content: 'v2' })
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'create_requirement_version', { input: { designId: 'design-1', sourceKind: 'text', content: 'v1' } })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'create_requirement_version', { input: { designId: 'design-1', sourceKind: 'text', content: 'v2' } })
  })

  it('normalizes nullable Rust fields without swallowing errors', async () => {
    invokeMock
      .mockResolvedValueOnce({ ...record, systemId: 'system-1', environmentId: 'environment-1', title: 'Design', status: 'draft', currentRequirementVersionId: null })
      .mockResolvedValueOnce({ ...record, designId: 'design-1', requirementVersionId: 'requirement-1', model: 'model-1', templateId: null, isStale: false })
      .mockResolvedValueOnce({ ...record, designId: 'design-1', suiteId: null, accountCombinationId: null, caseIdsJson: '[]' })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('NOT_FOUND'))

    await expect(createTestDesign({ systemId: 'system-1', environmentId: 'environment-1', title: 'Design', status: 'draft' }))
      .resolves.toMatchObject({ currentRequirementVersionId: undefined })
    await expect(createGenerationBatch({ designId: 'design-1', requirementVersionId: 'requirement-1', model: 'model-1' }))
      .resolves.toMatchObject({ templateId: undefined })
    await expect(saveRegressionConfig({ designId: 'design-1', caseIdsJson: '[]' }))
      .resolves.toMatchObject({ suiteId: undefined, accountCombinationId: undefined })
    await expect(getRegressionConfig('design-2')).resolves.toBeUndefined()
    await expect(listRequirementVersions('missing')).rejects.toThrow('NOT_FOUND')
  })
})
