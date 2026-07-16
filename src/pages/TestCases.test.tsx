import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RegressionSuite, ScenarioTemplate, TestCase } from '../types'
import { generateTestCasesFromRequirement, generateTestCasesFromTemplate } from '../api/testCaseGenerator'
import {
  createDefaultSuite,
  loadSuites,
  loadTestCases,
  saveTestCases,
  upsertSuite,
  upsertTestCase,
} from '../api/testCaseStore'
import { loadCustomTemplates } from '../api/templateGenerator'
import { TestCases } from './TestCases'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../api/testCaseGenerator', () => ({
  generateTestCasesFromRequirement: vi.fn(),
  generateTestCasesFromTemplate: vi.fn(),
}))
vi.mock('../api/testCaseStore', () => ({
  createDefaultSuite: vi.fn(),
  loadSuites: vi.fn(),
  loadTestCases: vi.fn(),
  saveTestCases: vi.fn(),
  upsertSuite: vi.fn(),
  upsertTestCase: vi.fn(),
}))
vi.mock('../api/templateGenerator', () => ({ loadCustomTemplates: vi.fn() }))
vi.mock('../agents/scriptGenerator', () => ({ generateTestScript: vi.fn() }))
vi.mock('../agents/scriptExecutor', () => ({ executeTestScript: vi.fn() }))
vi.mock('../utils/privacy', () => ({
  maskSensitiveText: (value: string) => value,
  securityModeLabel: () => 'strict',
  getDataSecurityConfig: () => ({ mode: 'strict_redaction', allowRawScreenshots: false }),
}))
vi.mock('./RequirementModeler', () => ({
  RequirementModeler: ({ onCancel, onSaved }: { onCancel: () => void; onSaved: (template: ScenarioTemplate) => void }) => (
    <div aria-label="requirement-modeler">
      <button onClick={onCancel}>modeler-cancel</button>
      <button onClick={() => onSaved(savedTemplate)}>modeler-save</button>
    </div>
  ),
}))

const savedTemplate: ScenarioTemplate = {
  id: 'saved-template',
  name: 'Saved template',
  category: 'form',
  description: 'Saved flow',
  steps: [{ order: 1, description: 'Submit', action: 'click' }],
  variables: [],
  tags: ['saved'],
}

const draftCase: TestCase = {
  id: 'case-1',
  title: 'Draft case',
  requirementTitle: 'Requirement',
  module: 'Module A',
  sourceKind: 'requirement',
  type: 'normal',
  priority: 'P1',
  riskPoint: 'Submission fails',
  preconditions: ['Signed in'],
  testData: { employee: 'A' },
  steps: [{ order: 1, action: 'Submit', expectedResult: 'Success' }],
  expectedResult: 'Success',
  isBoundary: false,
  isRepeat: false,
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  suiteIds: [],
}

const suite: RegressionSuite = {
  id: 'suite-1',
  name: 'Regression suite',
  description: 'Main regression',
  module: 'Module A',
  caseIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
}

const directGenerateMock = vi.mocked(generateTestCasesFromRequirement)
const templateGenerateMock = vi.mocked(generateTestCasesFromTemplate)
const loadCasesMock = vi.mocked(loadTestCases)
const loadSuitesMock = vi.mocked(loadSuites)
const loadTemplatesMock = vi.mocked(loadCustomTemplates)
const upsertCaseMock = vi.mocked(upsertTestCase)

function rail(step: number, title: string) {
  return screen.getByRole('button', { name: new RegExp(`^${step}.*${title}`) })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(promiseResolve => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

async function enterRequirement(value = 'Acceptance criteria') {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('需求或验收标准'), value)
  return user
}

async function generateDirect() {
  const user = await enterRequirement()
  await user.click(rail(2, '生成用例'))
  await user.click(screen.getByRole('button', { name: '直接从需求生成' }))
  await screen.findByText('Draft case')
  return user
}

describe('TestCases wizard', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    loadCasesMock.mockReturnValue([])
    loadSuitesMock.mockReturnValue([suite])
    loadTemplatesMock.mockReturnValue([])
    directGenerateMock.mockResolvedValue([draftCase])
    templateGenerateMock.mockResolvedValue([{ ...draftCase, templateId: savedTemplate.id, sourceKind: 'template' }])
    vi.mocked(saveTestCases).mockImplementation(value => value)
    vi.mocked(createDefaultSuite).mockReturnValue(suite)
    vi.mocked(upsertSuite).mockImplementation(value => [value])
    upsertCaseMock.mockImplementation(value => [value])
  })

  it('keeps step 2 locked until a requirement source is entered', async () => {
    render(<TestCases />)

    expect(rail(2, '生成用例')).toBeDisabled()
    expect(screen.getByRole('heading', { name: '需求来源' })).toBeVisible()

    await enterRequirement()

    expect(rail(2, '生成用例')).toBeEnabled()
  })

  it('uses an existing template selected on step 1 as a source', async () => {
    loadTemplatesMock.mockReturnValue([savedTemplate])
    render(<TestCases />)
    const user = userEvent.setup()

    expect(rail(2, '生成用例')).toBeDisabled()
    await user.selectOptions(screen.getByRole('combobox', { name: '已有场景模板（可选）' }), savedTemplate.id)

    expect(rail(2, '生成用例')).toBeEnabled()
    await user.click(rail(2, '生成用例'))
    await user.click(screen.getByRole('button', { name: '基于场景模板生成' }))

    await waitFor(() => expect(templateGenerateMock).toHaveBeenCalledWith(savedTemplate))
    expect(await screen.findByRole('heading', { name: '检查确认' })).toBeVisible()
  })

  it('returns from the modeler with requirement and module inputs preserved', async () => {
    render(<TestCases />)
    const user = await enterRequirement('Keep this requirement')
    const moduleInput = screen.getByLabelText('模块名称')
    await user.clear(moduleInput)
    await user.type(moduleInput, 'Keep this module')

    await user.click(screen.getByRole('button', { name: '从需求文档建模' }))
    expect(screen.getByLabelText('requirement-modeler')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'modeler-cancel' }))

    expect(screen.getByRole('heading', { name: '需求来源' })).toBeVisible()
    expect(screen.getByLabelText('需求或验收标准')).toHaveValue('Keep this requirement')
    expect(moduleInput).toHaveValue('Keep this module')
  })

  it('moves to step 2 and selects a template saved by the modeler', async () => {
    loadTemplatesMock.mockReturnValueOnce([]).mockReturnValueOnce([savedTemplate])
    render(<TestCases />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '从需求文档建模' }))
    await user.click(screen.getByRole('button', { name: 'modeler-save' }))

    expect(screen.getByRole('heading', { name: '生成用例' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: '场景模板' })).toHaveValue(savedTemplate.id)
  })

  it('generates directly through the existing API and advances to step 3', async () => {
    render(<TestCases />)

    await generateDirect()

    expect(directGenerateMock).toHaveBeenCalledWith('Acceptance criteria', '人事核心流程')
    expect(screen.getByRole('heading', { name: '检查确认' })).toBeVisible()
  })

  it('generates from a saved template without pasted requirement and advances to step 3', async () => {
    loadTemplatesMock.mockReturnValueOnce([]).mockReturnValueOnce([savedTemplate])
    render(<TestCases />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '从需求文档建模' }))
    await user.click(screen.getByRole('button', { name: 'modeler-save' }))

    await user.click(screen.getByRole('button', { name: '基于场景模板生成' }))

    await waitFor(() => expect(templateGenerateMock).toHaveBeenCalledWith(savedTemplate))
    expect(await screen.findByRole('heading', { name: '检查确认' })).toBeVisible()
  })

  it('unlocks execution after confirmation and preserves cases and suite selection when going back', async () => {
    render(<TestCases />)
    const user = await generateDirect()
    expect(rail(4, '回归执行')).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '人工确认' }))
    expect(rail(4, '回归执行')).toBeEnabled()
    await user.click(rail(4, '回归执行'))
    expect(screen.getByRole('heading', { name: '回归执行' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: '回归套件' })).toHaveValue(suite.id)

    await user.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByRole('heading', { name: '检查确认' })).toBeVisible()
    expect(screen.getByText('Draft case')).toBeVisible()
    await user.click(rail(4, '回归执行'))
    expect(screen.getByRole('combobox', { name: '回归套件' })).toHaveValue(suite.id)
  })

  it.each([
    ['requirement', '需求或验收标准'],
    ['module', '模块名称'],
  ])('marks generated cases stale when the %s changes', async (_kind, label) => {
    render(<TestCases />)
    const user = await generateDirect()
    await user.click(rail(1, '需求来源'))
    await user.type(screen.getByLabelText(label), ' changed')

    expect(screen.getByText('需求已修改，请重新生成测试用例')).toBeVisible()
    expect(rail(3, '检查确认')).toBeDisabled()
    expect(rail(4, '回归执行')).toBeDisabled()
  })

  it('does not allow locked rail buttons to skip ahead', async () => {
    render(<TestCases />)
    const user = userEvent.setup()

    await user.click(rail(3, '检查确认'))
    await user.click(rail(4, '回归执行'))

    expect(screen.getByRole('heading', { name: '需求来源' })).toBeVisible()
    expect(rail(3, '检查确认')).toBeDisabled()
    expect(rail(4, '回归执行')).toBeDisabled()
  })

  it('ignores a direct-generation response when its source revision becomes stale', async () => {
    const pending = deferred<TestCase[]>()
    directGenerateMock.mockReturnValue(pending.promise)
    loadTemplatesMock.mockReturnValue([savedTemplate])
    render(<TestCases />)
    const user = await enterRequirement()
    await user.click(rail(2, '生成用例'))

    await user.click(screen.getByRole('button', { name: '直接从需求生成' }))
    expect(rail(1, '需求来源')).toBeDisabled()
    const templateSelector = screen.getByRole('combobox', { name: '场景模板' })
    expect(templateSelector).toBeDisabled()
    fireEvent.change(templateSelector, { target: { value: savedTemplate.id } })
    pending.resolve([draftCase])

    await waitFor(() => expect(screen.getByRole('heading', { name: '生成用例' })).toBeVisible())
    expect(screen.queryByRole('heading', { name: '检查确认' })).not.toBeInTheDocument()
    expect(rail(3, '检查确认')).toBeDisabled()
  })

  it('stays on generation with a visible notice when generation returns no cases', async () => {
    directGenerateMock.mockResolvedValue([])
    render(<TestCases />)
    const user = await enterRequirement()
    await user.click(rail(2, '生成用例'))

    await user.click(screen.getByRole('button', { name: '直接从需求生成' }))

    expect(await screen.findByRole('status')).toHaveTextContent('未生成任何测试用例')
    expect(screen.getByRole('heading', { name: '生成用例' })).toBeVisible()
    expect(rail(3, '检查确认')).toBeDisabled()
  })

  it('opens persisted drafts in review and unlocks persisted confirmed cases after review is entered', async () => {
    loadCasesMock.mockReturnValue([{ ...draftCase, status: 'confirmed' }])
    render(<TestCases />)
    const user = userEvent.setup()

    expect(rail(3, '检查确认')).toBeEnabled()
    expect(rail(4, '回归执行')).toBeDisabled()
    await user.click(rail(3, '检查确认'))

    expect(screen.getByText('Draft case')).toBeVisible()
    expect(rail(4, '回归执行')).toBeEnabled()
  })
})
