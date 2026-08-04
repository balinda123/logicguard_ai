import { describe, expect, it } from 'vitest'

import { DEFAULT_LLM_CONFIG } from '../api/llmBridge'
import { canDiscoverGatewayModels, gatewayModelOptions, PROVIDER_PRESETS, REASONING_EFFORT_OPTIONS } from './Settings'

describe('model provider presets', () => {
  it('includes the company ChatGPT gateway as an OpenAI-compatible preset', () => {
    expect(PROVIDER_PRESETS).toContainEqual(
      expect.objectContaining({
        id: 'company-chatgpt',
        provider: 'openai_compat',
        model: '',
        baseUrl: 'http://10.255.240.106:9019',
      }),
    )
  })

  it('requires models discovered from the gateway instead of static model IDs', () => {
    expect(DEFAULT_LLM_CONFIG).toMatchObject({
      provider: 'openai_compat',
      model: '',
      base_url: 'http://10.255.240.106:9019',
    })
    expect(gatewayModelOptions(['gpt-5.6-luna', 'gpt-5.6-luna', 'company-fast'])).toEqual([
      { value: 'company-fast', label: 'company-fast' },
      { value: 'gpt-5.6-luna', label: 'gpt-5.6-luna' },
    ])
  })

  it('offers reasoning effort choices including xhigh', () => {
    expect(REASONING_EFFORT_OPTIONS.map(option => option.value)).toEqual(
      expect.arrayContaining(['', 'low', 'medium', 'high', 'xhigh']),
    )
  })

  it('allows model discovery before a model has been selected', () => {
    expect(canDiscoverGatewayModels({ provider: 'openai_compat', base_url: 'http://10.255.240.106:9019' })).toBe(true)
  })
})
