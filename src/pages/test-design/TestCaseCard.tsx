import type { ReactNode } from 'react'

import type { TestCase } from '../../types'
import type { TestAccount } from '../../types/workflow'

const TYPE_LABEL: Record<TestCase['type'], string> = {
  normal: '正常流程',
  boundary: '边界值',
  empty: '空值异常',
  permission: '权限',
  repeat: '重复提交',
  combination: '组合测试',
}

interface Props {
  testCase: TestCase
  selected?: boolean
  onSelectionChange?: (selected: boolean) => void
  actions?: ReactNode
  accounts?: TestAccount[]
}

const DATA_LABELS: Record<string, string> = {
  draftGoalContent: '草稿目标内容', draftExpectedResult: '草稿预期结果', goalContent: '目标内容', targetContent: '目标内容',
  expectedResult: '预期结果', goalReview: '目标回顾', overallSelfEvaluation: '总体自评', managerEvaluationOpinion: '上级评价意见',
  terminationReason: '终止流程说明', returnReason: '退回说明',
}

function replaceAll(value: string, search: string, replacement: string): string {
  return search ? value.split(search).join(replacement) : value
}

function readableCaseText(value: string, accounts: readonly TestAccount[] = []): string {
  let result = value.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, key: string) => `【${DATA_LABELS[key] || key}】`)
  result = result.replace(/\bHIS-T0*(\d+)\b/gi, (raw, index: string) => `历史记录 ${index}（${raw}）`)
  for (const account of accounts) result = replaceAll(result, account.id, `${account.roleName || account.role}账号（${account.displayName}）`)
  return result
}

function stepActorName(testCase: TestCase, stepIndex: number, accounts: readonly TestAccount[]): string | undefined {
  const step = testCase.steps[stepIndex]
  const account = step.accountId ? accounts.find((item) => item.id === step.accountId) : undefined
  if (account) return account.roleName || account.role
  const matchingRoles = accounts.filter((item) => item.role === step.role)
  if (matchingRoles.length > 0) return matchingRoles[0].roleName || matchingRoles[0].role
  return step.actorName
}

export function TestCaseCard({ testCase, selected, onSelectionChange, actions, accounts = [] }: Props) {
  return (
    <article aria-label={testCase.title} className="rounded-lg border border-border bg-surface-2/60 p-4">
      <div className="flex items-start gap-3">
        {onSelectionChange && (
          <input
            type="checkbox"
            aria-label={`选择 ${testCase.title}`}
            checked={selected}
            onChange={(event) => onSelectionChange(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-bold text-text-primary">{testCase.title}</h4>
            <span className="rounded border border-brand-500/20 bg-brand-500/10 px-1.5 py-0.5 text-[10px] text-brand-400">{TYPE_LABEL[testCase.type]}</span>
            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted">{testCase.priority}</span>
            <span className={`rounded border px-1.5 py-0.5 text-[10px] ${testCase.status === 'confirmed' ? 'border-success/20 bg-success/10 text-success' : 'border-warning/20 bg-warning/10 text-warning'}`}>
              {testCase.status === 'confirmed' ? '已确认' : '待确认'}
            </span>
          </div>
          <p className="mt-2 text-xs text-text-secondary"><span className="text-text-muted">风险点：</span>{testCase.riskPoint}</p>
        </div>
      </div>

      <details className="mt-3 border-t border-border pt-3">
        <summary className="cursor-pointer text-xs font-semibold text-brand-400">查看用例详情</summary>
        <div className="mt-3 space-y-3 text-xs text-text-secondary">
          <p><span className="text-text-muted">前置条件：</span>{testCase.preconditions.map((item) => readableCaseText(item, accounts)).join('；') || '无'}</p>
          <div>
            <span className="text-text-muted">测试数据：</span>
            {Object.keys(testCase.testData).length === 0
              ? '无'
              : Object.entries(testCase.testData).map(([key, value]) => `${DATA_LABELS[key] || key}：${readableCaseText(value, accounts)}`).join('；')}
          </div>
          <ol className="space-y-1">
            {testCase.steps.map((step, index) => {
              const actorName = stepActorName(testCase, index, accounts)
              return <li key={step.order}>{step.order}. {actorName && <strong className="text-text-primary">[{actorName}] </strong>}{readableCaseText(step.action, accounts)} → {readableCaseText(step.expectedResult, accounts)}</li>
            })}
          </ol>
          <p><span className="text-text-muted">总体预期：</span>{readableCaseText(testCase.expectedResult, accounts)}</p>
        </div>
      </details>

      {actions && <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">{actions}</div>}
    </article>
  )
}
