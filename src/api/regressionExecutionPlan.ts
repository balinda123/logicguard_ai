import type { TestCase, TestCaseStep } from '../types'
import type { ExecutionPlan } from '../types/execution'
import type { TestAccount } from '../types/workflow'

export interface RegressionRoleCommand {
  commandIndex: number
  accountId: string
  role: string
  roleName: string
  accountHint: string
}

export interface RegressionExecutionBundle {
  executionPlan: ExecutionPlan
  roleCommands: RegressionRoleCommand[]
  sourceStepCount: number
  compiledStepCount: number
}

interface BoundStep {
  testCase: TestCase
  step: TestCaseStep
  account?: TestAccount
}

interface RoleSegment {
  testCase: TestCase
  account?: TestAccount
  items: BoundStep[]
}

export type ExecutionAccountOverrides = Readonly<Record<string, string>>

function normalized(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function accountRoleIdentity(account: TestAccount): string {
  return normalized(account.roleName || account.role)
}

export function executionRoleAccounts(roleKey: string, accounts: readonly TestAccount[]): TestAccount[] {
  const enabled = accounts.filter((account) => account.enabled)
  const anchors = enabled.filter((account) => account.role === roleKey)
  if (anchors.length === 0) return []
  const identities = new Set(anchors.map(accountRoleIdentity))
  // role_key 是持久化绑定，role_name 是用户可见身份；历史英文键与新建中文键只要显示身份相同，
  // 执行时就必须归入同一角色，否则会漏掉可选账号或把整个角色误判为歧义。
  return enabled.filter((account) => account.role === roleKey || identities.has(accountRoleIdentity(account)))
}

export function executionRoleKey(step: TestCaseStep, accounts: readonly TestAccount[]): string | undefined {
  const enabled = accounts.filter((account) => account.enabled)
  const boundRole = step.accountId ? enabled.find((account) => account.id === step.accountId)?.role.trim() : undefined
  if (boundRole) return boundRole

  const actorLabels = [step.role, step.actorName].map((item) => normalized(item || '')).filter(Boolean)
  const matchingAccounts = enabled
    .filter((account) => actorLabels.some((label) => label === normalized(account.role) || label === normalized(account.roleName || '')))
  const matchingIdentities = new Set(matchingAccounts.map(accountRoleIdentity))
  return matchingIdentities.size === 1 ? matchingAccounts[0]?.role : undefined
}

function resolveStepAccount(
  step: TestCaseStep,
  accounts: readonly TestAccount[],
  accountOverrides: ExecutionAccountOverrides,
): TestAccount | undefined {
  const enabled = accounts.filter((account) => account.enabled)
  const roleKey = executionRoleKey(step, accounts)
  const overrideId = roleKey ? accountOverrides[roleKey] : undefined
  if (roleKey && overrideId) {
    // 覆盖只发生在执行计划编译期，并且只能选择同一显示角色内的账号；
    // 这样换账号不会触发 AI 重生成，也不会把步骤错误地交给其他业务身份。
    const overridden = executionRoleAccounts(roleKey, enabled).find((account) => account.id === overrideId)
    if (!overridden) throw new Error(`角色“${roleKey}”选择的执行账号不可用，请重新选择。`)
    return overridden
  }
  if (step.accountId) {
    const exact = enabled.find((account) => account.id === step.accountId)
    if (exact) return exact
  }

  if (roleKey) {
    const roleAccounts = executionRoleAccounts(roleKey, enabled)
    if (roleAccounts.length === 1) return roleAccounts[0]
  }

  // 没有角色元数据的步骤沿用当前浏览器会话，不猜测账号；猜错身份比不切换账号风险更高。
  if (!roleKey && !step.accountId) return undefined

  const actor = step.actorName || step.role || '未指定角色'
  throw new Error(`步骤“${step.action}”无法唯一匹配执行账号（${actor}），请在用例中选择具体账号。`)
}

function compileSuite(
  cases: readonly TestCase[],
  accounts: readonly TestAccount[],
  accountOverrides: ExecutionAccountOverrides,
): BoundStep[] {
  const seen = new Set<string>()
  const compiled: BoundStep[] = []
  for (const testCase of cases) {
    const steps = testCase.steps.length > 0
      ? testCase.steps
      : [{ order: 1, action: testCase.title, expectedResult: testCase.expectedResult }]
    for (const step of steps) {
      const account = resolveStepAccount(step, accounts, accountOverrides)
      // 只合并完全等价的步骤；边界数据或断言不同必须保留，否则会掩盖真实覆盖范围。
      const key = [
        account?.id || 'unbound',
        normalized(step.action),
        normalized(step.expectedResult),
        JSON.stringify(step.assertions ?? []),
        JSON.stringify(testCase.testData ?? {}),
      ].join('\u0000')
      if (seen.has(key)) continue
      seen.add(key)
      compiled.push({ testCase, step, account })
    }
  }
  return compiled
}

function segmentByCaseAndAccount(compiled: readonly BoundStep[]): RoleSegment[] {
  const segments: RoleSegment[] = []
  for (const item of compiled) {
    const previous = segments.at(-1)
    if (previous?.testCase.id === item.testCase.id && previous.account?.id === item.account?.id) {
      previous.items.push(item)
    } else {
      segments.push({ testCase: item.testCase, account: item.account, items: [item] })
    }
  }
  return segments
}

function agentBudget(stepCount: number): { maxActions: number; timeoutMs: number } {
  return {
    maxActions: Math.min(16, Math.max(7, 4 + stepCount * 3)),
    timeoutMs: Math.min(240_000, Math.max(90_000, 60_000 + stepCount * 30_000)),
  }
}

function canUseSingleAct(step: TestCaseStep): boolean {
  const action = step.action.replace(/\s+/g, ' ').trim()
  if (!step.assertions?.length || action.length > 100) return false
  if (/然后|并且|并|之后|后再|依次|分别|逐组|全部|边界|填写|输入|修改|提交|确认|通过|退回|终止|保存|删除/i.test(action)) return false
  return /^(?:打开|进入|查看|选择|勾选|切换|展开|关闭|返回|click\b|open\b|view\b|select\b|check\b|switch\b)/i.test(action)
}

export function buildRegressionExecutionBundle(
  baseUrl: string,
  cases: readonly TestCase[],
  goalForCase: (testCase: TestCase) => string,
  accounts: readonly TestAccount[],
  accountOverrides: ExecutionAccountOverrides = {},
): RegressionExecutionBundle {
  const target = new URL(baseUrl)
  const allowedOrigin = target.origin
  const commands: Record<string, unknown>[] = [{
    command: 'execute',
    step: { action: 'navigate', url: target.toString() },
    allowedOrigins: [allowedOrigin],
    timeoutMs: 30_000,
  }]
  const roleCommands: RegressionRoleCommand[] = []
  const compiled = compileSuite(cases, accounts, accountOverrides)
  // 同一用例中连续且同账号的动作共享一轮 Agent，减少重复读页和推理；角色变化与用例边界仍是硬检查点，
  // 因此账号交接和用例状态隔离不会被性能合并吞掉。
  const segments = segmentByCaseAndAccount(compiled)
  let activeCaseId = segments.at(0)?.testCase.id

  for (const segment of segments) {
    if (segment.testCase.id !== activeCaseId) {
      commands.push({
        command: 'execute',
        step: { action: 'navigate', url: target.toString() },
        allowedOrigins: [allowedOrigin],
        timeoutMs: 30_000,
      })
      activeCaseId = segment.testCase.id
    }
    const commandIndex = commands.length
    const source = segment.testCase
    const sourceTitles = [...new Set(segment.items.map((item) => item.testCase.title.trim()).filter(Boolean))]
    const commandTitle = sourceTitles.length <= 1 ? (sourceTitles[0] || '执行测试场景') : `${sourceTitles[0]}等 ${sourceTitles.length} 个场景`
    const commandDetails = segment.items.map((item) => `${item.step.action} → 预期：${item.step.expectedResult}`)
    const scopedCase: TestCase = {
      ...source,
      title: `测试集合：${source.title}`,
      steps: segment.items.map((item, index) => ({ ...item.step, order: index + 1 })),
      expectedResult: segment.items.map((item) => item.step.expectedResult).join('；'),
    }
    const fastStep = segment.items.length === 1 ? segment.items[0].step : undefined
    if (fastStep && canUseSingleAct(fastStep)) {
      commands.push({
        command: 'act',
        title: commandTitle,
        details: commandDetails,
        instruction: fastStep.action,
        fallbackGoal: goalForCase(scopedCase),
        maxActions: 6,
        allowedOrigins: [allowedOrigin],
        timeoutMs: 45_000,
      })
    } else {
      const budget = agentBudget(segment.items.length)
      commands.push({
        command: 'agent',
        title: commandTitle,
        details: commandDetails,
        goal: goalForCase(scopedCase),
        allowedOrigins: [allowedOrigin],
        maxActions: budget.maxActions,
        timeoutMs: budget.timeoutMs,
      })
    }
    if (segment.account) {
      roleCommands.push({
        commandIndex,
        accountId: segment.account.id,
        role: segment.account.role,
        roleName: segment.account.roleName || segment.account.role,
        accountHint: segment.account.displayName,
      })
    }
    const assertions = segment.items.flatMap((item) => item.step.assertions ?? []).slice(0, 8)
    if (assertions.length > 0) {
      const assertionIndex = commands.length
      commands.push({
        command: 'assert_page',
        title: `校验：${commandTitle}`,
        details: assertions.map((assertion) => `${assertion.type} → ${assertion.expected}`),
        assertions,
        allowedOrigins: [allowedOrigin],
        timeoutMs: 15_000,
      })
      if (segment.account) {
        roleCommands.push({
          commandIndex: assertionIndex,
          accountId: segment.account.id,
          role: segment.account.role,
          roleName: segment.account.roleName || segment.account.role,
          accountHint: segment.account.displayName,
        })
      }
    }
  }

  const sourceStepCount = cases.reduce((total, item) => total + Math.max(item.steps.length, 1), 0)
  return {
    executionPlan: { commands },
    roleCommands,
    sourceStepCount,
    compiledStepCount: compiled.length,
  }
}

export function buildRegressionExecutionPlan(
  baseUrl: string,
  cases: readonly TestCase[],
  goalForCase: (testCase: TestCase) => string,
  accounts: readonly TestAccount[],
  accountOverrides: ExecutionAccountOverrides = {},
): ExecutionPlan {
  return buildRegressionExecutionBundle(baseUrl, cases, goalForCase, accounts, accountOverrides).executionPlan
}
