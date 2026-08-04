import { describe, expect, it } from 'vitest'

import { defaultTemplates } from './defaultTemplates'

describe('defaultTemplates', () => {
  it('does not ship demonstration templates into a user workspace', () => {
    expect(defaultTemplates).toEqual([])
  })
})
