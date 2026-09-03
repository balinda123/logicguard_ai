import type { ExecutionAccountOrchestrationSnapshot } from '../types/execution'
import type { TestAccount } from '../types/workflow'
import type { RegressionRoleCommand } from './regressionExecutionPlan'

export function buildRegressionAccountOrchestration(input: {
  systemId: string
  environmentId: string
  baseUrl: string
  loginUrl: string
  handoffOrigins: readonly string[]
  accounts: readonly TestAccount[]
  roleCommands: readonly RegressionRoleCommand[]
}): ExecutionAccountOrchestrationSnapshot {
  const allowedOrigin = new URL(input.baseUrl).origin
  const enabled = input.accounts.filter((account) => account.enabled)
  const environmentLoginConfigured = Boolean(input.loginUrl.trim())
  const selected = new Map<string, TestAccount>()
  const roleSteps = input.roleCommands.map((command) => {
    const account = enabled.find((item) => item.id === command.accountId)
    if (!account) throw new Error(`测试账号“${command.accountHint}”不存在或已停用，请重新选择账号后执行。`)
    // 环境登录配置统一约束本次执行；仅对尚未迁移的旧环境回退账号历史字段。
    const loginPageUrl = environmentLoginConfigured ? input.loginUrl : account.loginConfig.loginUrl
    const loginOrigin = new URL(loginPageUrl).origin
    if (loginOrigin !== allowedOrigin) throw new Error(`测试账号“${account.displayName}”的登录地址不属于当前测试环境。`)
    selected.set(account.id, account)
    return { commandIndex: command.commandIndex, role: account.role, accountId: account.id }
  })

  return {
    systemId: input.systemId,
    environmentId: input.environmentId,
    combinationId: `runtime:${input.systemId}:${input.environmentId}`,
    accounts: [...selected.values()].map((account) => ({
      id: account.id,
      role: account.role,
      roleName: account.roleName || account.role,
      displayName: account.displayName,
      loginMode: account.loginMode,
      allowedOrigin,
      handoffOrigins: environmentLoginConfigured ? [...input.handoffOrigins] : account.loginConfig.handoffOrigins ?? [],
      loginPageUrl: environmentLoginConfigured ? input.loginUrl : account.loginConfig.loginUrl,
      pageLocator: account.loginConfig.pageSelector || undefined,
      identityLocator: account.loginConfig.usernameSelector || undefined,
      privateLocator: account.loginConfig.passwordSelector || undefined,
      submitLocator: account.loginConfig.submitSelector || undefined,
      successLocator: account.loginConfig.successSelector || undefined,
    })),
    roleSteps,
  }
}
