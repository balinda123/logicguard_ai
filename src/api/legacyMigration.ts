import { invoke } from '@tauri-apps/api/core'

import { loadLegacyTestCases, loadSuites } from './testCaseStore'

const MIGRATION_MARKER = 'logicguard_test_design_migration_v1'

export interface LegacyMigrationResult {
  migrationVersion: string
  importedRecords: number
  importedCases: number
  quarantinedRecords: number
  verified: boolean
}

interface LegacyRecord {
  sourceKey: string
  kind: 'case' | 'suite' | 'report'
  loginUrl?: string
  data: Record<string, unknown>
}

function activeUserId(): string {
  return sessionStorage.getItem('logicguard_user_id') ?? 'anonymous'
}

function markerKey(): string {
  return `${MIGRATION_MARKER}_${activeUserId()}`
}

function recordUrl(record: Record<string, unknown>): string | undefined {
  for (const key of ['loginUrl', 'targetUrl', 'baseUrl', 'url']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function readLegacyReports(): Record<string, unknown>[] {
  const key = `logicguard_test_results_${activeUserId()}`
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : []
  } catch {
    return []
  }
}

export function collectLegacyRecords(): LegacyRecord[] {
  const cases = loadLegacyTestCases().map((item, index) => ({
    sourceKey: `case:${item.id || index}`,
    kind: 'case' as const,
    loginUrl: recordUrl(item as unknown as Record<string, unknown>),
    data: item as unknown as Record<string, unknown>,
  }))
  const suites = loadSuites().map((item, index) => ({
    sourceKey: `suite:${item.id || index}`,
    kind: 'suite' as const,
    loginUrl: recordUrl(item as unknown as Record<string, unknown>),
    data: item as unknown as Record<string, unknown>,
  }))
  const reports = readLegacyReports().map((item, index) => ({
    sourceKey: `report:${String(item.id ?? index)}`,
    kind: 'report' as const,
    loginUrl: recordUrl(item),
    data: item,
  }))
  return [...cases, ...suites, ...reports]
}

export async function migrateLegacyTestData(sharedTestBaseUrl?: string): Promise<LegacyMigrationResult | undefined> {
  if (localStorage.getItem(markerKey())) return undefined
  const result = await invoke<LegacyMigrationResult>('import_legacy_test_data', {
    payload: {
      defaultSystemName: '试用期转正系统',
      sharedTestBaseUrl: sharedTestBaseUrl || undefined,
      records: collectLegacyRecords(),
    },
  })
  if (!result.verified) throw new Error('MIGRATION_RECONCILIATION_FAILED')
  localStorage.setItem(markerKey(), JSON.stringify({
    migrationVersion: result.migrationVersion,
    reconciledAt: new Date().toISOString(),
  }))
  return result
}
