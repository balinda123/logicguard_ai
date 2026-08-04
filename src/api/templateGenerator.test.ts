import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { generateTemplateFromDocument, loadCustomTemplates } from './templateGenerator'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('./llmBridge', () => ({ getLlmConfig: () => ({ provider: 'openai_compat', model: 'test' }) }))
vi.mock('../utils/privacy', () => ({ sanitizeForLlm: (value: string) => value }))

describe('loadCustomTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('removes the legacy unnamed AI template while retaining user-created templates', () => {
    localStorage.setItem('logicguard_custom_templates_anonymous', JSON.stringify([
      { id: 'demo-template', name: '（AI生成的测试模板）', description: '基于需求文档自动生成', steps: [], variables: [], tags: [] },
      { id: 'real-template', name: '试用期评价流程', description: '员工自评和上级评价', steps: [], variables: [], tags: [] },
    ]))

    expect(loadCustomTemplates().map(template => template.id)).toEqual(['real-template'])
  })

  it('rejects an incomplete AI response instead of fabricating a template', async () => {
    vi.mocked(invoke).mockResolvedValue('{"id":"template-1","steps":[]}')

    await expect(generateTemplateFromDocument('试用期考核需求')).rejects.toThrow('AI 返回的模板不完整')
  })

  it('accepts a complete template returned in a common nested gateway format', async () => {
    vi.mocked(invoke).mockResolvedValue(JSON.stringify({
      template: {
        id: 'template-2',
        templateName: '试用期字数校验流程',
        templateDescription: '员工、上级和 HRBP 的提交与退回校验。',
        testSteps: [{ order: 1, role: 'manager', description: '上级退回目标', action: 'click' }],
      },
    }))

    await expect(generateTemplateFromDocument('试用期考核需求')).resolves.toMatchObject({
      id: 'template-2',
      name: '试用期字数校验流程',
      steps: [{ role: 'manager', description: '上级退回目标' }],
    })
  })

  it('uses the template-specific backend command instead of the browser planner command', async () => {
    vi.mocked(invoke).mockResolvedValue(JSON.stringify({
      name: '试用期字数校验流程',
      description: '校验正式提交、退回和终止流程。',
      steps: [{ order: 1, description: '员工输入目标', action: 'type' }],
    }))

    await generateTemplateFromDocument('试用期考核需求')

    expect(invoke).toHaveBeenLastCalledWith('generate_template', expect.objectContaining({
      prompt: expect.any(String),
    }))
  })
})
