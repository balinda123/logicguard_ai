import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'

import type { DefectDraft } from '../types/workflow'
import { buildDefectCsv, buildDefectWorkbook, defectExportColumns } from './defectExport'

const draft: DefectDraft = {
  id: 'defect-1',
  status: 'pending_confirmation',
  title: '员工保存目标时没有提示超长输入',
  reproductionSteps: ['以员工身份登录', '在目标名称输入 101 个字符', '点击保存'],
  expectedResult: '提示最多输入 100 个字符',
  actualResult: '页面允许提交且没有提示',
  impact: '可能造成异常目标数据',
  role: 'employee',
  scenarioId: 'scenario-1',
  runId: 'run-1',
  evidenceId: 'evidence-1',
  createdAt: '2026-07-28T08:00:00.000Z',
  updatedAt: '2026-07-28T08:00:00.000Z',
}

describe('defectExport', () => {
  it('creates UTF-8 BOM CSV with developer-facing fields and safe evidence paths only', () => {
    const csv = buildDefectCsv([{ draft, evidencePath: 'failure-evidence/run-1/step-1.png' }])

    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('编号,标题,问题描述/复现,预期结果,实际结果,影响范围,测试角色,场景,状态,创建时间,证据相对路径')
    expect(csv).toContain('failure-evidence/run-1/step-1.png')
    expect(csv).not.toMatch(/password|credential|selector|token/i)
  })

  it('creates a real workbook and omits unsafe evidence paths', () => {
    const workbook = buildDefectWorkbook([{ draft, evidencePath: '../credential-store/password.txt' }])
    const encoded = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const loaded = XLSX.read(encoded, { type: 'array' })
    const rows = XLSX.utils.sheet_to_json<string[]>(loaded.Sheets[loaded.SheetNames[0]], { header: 1 })

    expect(rows[0]).toEqual(defectExportColumns.map(column => column.label))
    expect(rows[1]).toContain('')
    expect(JSON.stringify(rows)).not.toContain('credential-store')
  })
})
