import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { migrateLegacyTestData } from './legacyMigration'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('./testCaseStore', () => ({
  loadLegacyTestCases: () => [{ id: 'case-1', title: '旧用例', module: '人事流程' }],
  loadSuites: () => [],
}))

describe('legacyMigration', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.setItem('logicguard_user_id', 'owner-a')
    vi.mocked(invoke).mockReset()
  })

  it('writes the browser marker only after Rust reconciliation succeeds', async () => {
    vi.mocked(invoke).mockResolvedValue({ migrationVersion: 'test-design-v1', importedRecords: 1, importedCases: 1, quarantinedRecords: 0, verified: true })
    await migrateLegacyTestData('https://qa.example.test')
    expect(localStorage.getItem('logicguard_test_design_migration_v1_owner-a')).toContain('test-design-v1')
  })

  it('does not write a marker when reconciliation fails', async () => {
    vi.mocked(invoke).mockResolvedValue({ migrationVersion: 'test-design-v1', importedRecords: 0, importedCases: 0, quarantinedRecords: 1, verified: false })
    await expect(migrateLegacyTestData()).rejects.toThrow('MIGRATION_RECONCILIATION_FAILED')
    expect(localStorage.getItem('logicguard_test_design_migration_v1_owner-a')).toBeNull()
  })
})
