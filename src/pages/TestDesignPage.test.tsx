import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as designBridge from '../api/testDesignBridge'
import { TestDesignPage } from './TestDesignPage'

vi.mock('../api/testDesignBridge')
vi.mock('../api/legacyMigration', () => ({ migrateLegacyTestData: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../api/testCaseGenerator', () => ({ generateTestCasesFromRequirement: vi.fn() }))
vi.mock('../api/llmBridge', () => ({ getLlmConfig: () => ({ model: 'test-model' }) }))
vi.mock('../api/runBridge', () => ({ startRun: vi.fn() }))

const system = { id: 'system-a', name: '系统 A', createdAt: 'now', updatedAt: 'now' }
const environment = { id: 'env-a', systemId: 'system-a', kind: 'test' as const, name: '测试环境', baseUrl: 'https://qa.example.test', isEnabled: true, createdAt: 'now', updatedAt: 'now' }
const design = { id: 'design-a', systemId: 'system-a', environmentId: 'env-a', title: '系统 A 的设计', status: 'draft', createdAt: 'now', updatedAt: 'now' }

describe('TestDesignPage', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(designBridge.listSystems).mockResolvedValue([system])
    vi.mocked(designBridge.listSystemEnvironments).mockResolvedValue([environment])
    vi.mocked(designBridge.listTestDesigns).mockResolvedValue([design])
    vi.mocked(designBridge.listRequirementVersions).mockResolvedValue([])
    vi.mocked(designBridge.listGenerationBatches).mockResolvedValue([])
    vi.mocked(designBridge.listReviewRecords).mockResolvedValue([])
    vi.mocked(designBridge.listDesignTestCases).mockResolvedValue([])
  })

  it('loads designs using the selected system and environment together', async () => {
    render(<TestDesignPage canManageAccounts />)
    expect((await screen.findAllByText('系统 A 的设计')).some((element) => element.offsetParent !== null || element.isConnected)).toBe(true)
    expect(designBridge.listTestDesigns).toHaveBeenCalledWith('system-a', 'env-a')
    expect(screen.getByRole('button', { name: '新建设计' })).toHaveTextContent('新建设计')
  })

  it('marks previous generation batches stale after saving a new requirement version', async () => {
    vi.mocked(designBridge.listRequirementVersions).mockResolvedValue([{ id: 'requirement-1', designId: 'design-a', versionNo: 1, sourceKind: 'text', content: '旧需求', createdAt: 'now', updatedAt: 'now' }])
    vi.mocked(designBridge.listGenerationBatches).mockResolvedValue([{ id: 'batch-1', designId: 'design-a', requirementVersionId: 'requirement-1', model: 'test-model', isStale: false, createdAt: 'now', updatedAt: 'now' }])
    vi.mocked(designBridge.createRequirementVersion).mockResolvedValue({ id: 'requirement-2', designId: 'design-a', versionNo: 2, sourceKind: 'text', content: '新需求', createdAt: 'now', updatedAt: 'now' })
    render(<TestDesignPage />)
    const user = userEvent.setup()
    const input = await screen.findByLabelText('需求或验收标准')
    await waitFor(() => expect(input).toHaveValue('旧需求'))
    await user.clear(input)
    await user.type(input, '新需求')
    await user.click(screen.getByRole('button', { name: '保存新版本' }))
    expect(await screen.findByText('旧批次来源已过期，检查和回归默认只使用当前需求版本。')).toBeVisible()
    await waitFor(() => expect(designBridge.createRequirementVersion).toHaveBeenCalledWith({ designId: 'design-a', sourceKind: 'text', content: '新需求' }))
  })
})
