import * as XLSX from 'xlsx'

import type { DefectDraft } from '../types/workflow'

export interface DefectExportItem {
  draft: DefectDraft
  evidencePath?: string
}

export const defectExportColumns = [
  { key: 'id', label: '编号' },
  { key: 'title', label: '标题' },
  { key: 'description', label: '问题描述/复现' },
  { key: 'expectedResult', label: '预期结果' },
  { key: 'actualResult', label: '实际结果' },
  { key: 'impact', label: '影响范围' },
  { key: 'role', label: '测试角色' },
  { key: 'scenarioId', label: '场景' },
  { key: 'status', label: '状态' },
  { key: 'createdAt', label: '创建时间' },
  { key: 'evidencePath', label: '证据相对路径' },
] as const

type DefectExportRow = Record<(typeof defectExportColumns)[number]['key'], string>

const SAFE_EVIDENCE_PATH = /^failure-evidence\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|webp)$/i

const ROLE_LABEL = {
  employee: '员工',
  manager: '上级',
  hrbp: 'HRBP',
} as const

const STATUS_LABEL = {
  pending_confirmation: '待确认',
  pending_fix: '待修复',
  pending_validation: '待验证',
  closed: '已关闭',
  not_a_bug: '非缺陷',
} as const

export function safeEvidenceRelativePath(value?: string): string {
  return value && SAFE_EVIDENCE_PATH.test(value) ? value : ''
}

export function buildDefectRows(items: DefectExportItem[]): DefectExportRow[] {
  return items.map(({ draft, evidencePath }) => ({
    id: draft.id,
    title: draft.title,
    description: draft.reproductionSteps.map((step, index) => `${index + 1}. ${step}`).join('\n'),
    expectedResult: draft.expectedResult,
    actualResult: draft.actualResult,
    impact: draft.impact,
    role: ROLE_LABEL[draft.role],
    scenarioId: draft.scenarioId,
    status: STATUS_LABEL[draft.status],
    createdAt: draft.createdAt,
    evidencePath: safeEvidenceRelativePath(evidencePath),
  }))
}

function escapeCsvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

export function buildDefectCsv(items: DefectExportItem[]): string {
  const headers = defectExportColumns.map(column => column.label)
  const rows = buildDefectRows(items).map(row => defectExportColumns.map(column => escapeCsvCell(row[column.key])))
  return `\uFEFF${[headers, ...rows].map(row => row.join(',')).join('\r\n')}`
}

export function buildDefectWorkbook(items: DefectExportItem[]): XLSX.WorkBook {
  const headers = defectExportColumns.map(column => column.label)
  const rows = buildDefectRows(items).map(row => defectExportColumns.map(column => row[column.key]))
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
  sheet['!cols'] = defectExportColumns.map(column => ({ wch: column.label === '问题描述/复现' ? 38 : 18 }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, '问题单')
  return workbook
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadDefectCsv(items: DefectExportItem[]): void {
  downloadBlob(new Blob([buildDefectCsv(items)], { type: 'text/csv;charset=utf-8' }), '问题单.csv')
}

export function downloadDefectWorkbook(items: DefectExportItem[]): void {
  const output = XLSX.write(buildDefectWorkbook(items), { bookType: 'xlsx', type: 'array' })
  downloadBlob(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '问题单.xlsx')
}
