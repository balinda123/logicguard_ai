import type { ExecutionRun, ExecutionRunEvent, ExecutionRunStatus } from '../types/execution'

export interface RunScopePresentation {
  systemId: string
  systemName: string
  environmentId: string
  environmentName: string
  designId: string
  designTitle: string
  suiteName: string
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

export function runScope(run: ExecutionRun): RunScopePresentation {
  const snapshot = run.snapshot
  return {
    systemId: text(snapshot.systemId, 'legacy'),
    systemName: text(snapshot.systemName, '历史未归属'),
    environmentId: text(snapshot.environmentId, 'legacy'),
    environmentName: text(snapshot.environmentName, '未标记环境'),
    designId: text(snapshot.designId),
    designTitle: text(snapshot.designTitle, '未命名测试任务'),
    suiteName: text(snapshot.suiteName, text(snapshot.designTitle, '默认测试集合')),
  }
}

export function runCurrentStep(run: ExecutionRun, events: readonly ExecutionRunEvent[]): string {
  if (run.status === 'paused') return '测试已暂停，当前步骤不会继续执行'
  if (run.status === 'waiting_handoff') return '等待你完成登录或页面确认'
  if (run.status === 'cancelled') return '测试已停止'
  const latest = events.at(-1)
  return latest ? eventMessage(latest) : `准备执行第 ${run.currentStep + 1} 步`
}

export const RUN_STATUS_LABEL: Record<ExecutionRunStatus, string> = {
  queued: '排队中',
  preflight: '执行前检查',
  running: '执行中',
  pause_requested: '正在暂停',
  paused: '已暂停',
  waiting_handoff: '等待人工操作',
  passed: '通过',
  business_failed: '业务失败',
  blocked: '执行受阻',
  cancelled: '已停止',
  interrupted: '异常中断',
}

export function eventMessage(event: ExecutionRunEvent): string {
  const explicitMessage = text(event.data.message, text(event.data.error))
  if (explicitMessage) return explicitMessage
  const nested = event.data.data && typeof event.data.data === 'object'
    ? event.data.data as Readonly<Record<string, unknown>>
    : event.data
  const phase = text(nested.phase)
  const actionCount = typeof nested.action === 'number' ? nested.action : undefined
  const tools = Array.isArray(nested.tools) ? nested.tools.map(String) : []
  const details = Array.isArray(nested.details) ? nested.details.map(String).filter(Boolean) : []
  const toolLabels: Record<string, string> = {
    act: '点击或填写页面', ariaTree: '读取页面内容', done: '完成当前步骤', extract: '读取测试结果',
    fillForm: '填写表单', goto: '打开页面', keys: '输入内容', navback: '返回上一页', screenshot: '检查页面画面',
    scroll: '滚动查找内容', search: '查找页面内容', think: '分析下一步操作', wait: '等待页面响应', action: '操作页面',
  }

  if (event.kind === 'progress' && phase === 'agent_step') {
    const detail = details.at(-1)
    if (detail) return `AI 正在${detail}${actionCount ? `（第 ${actionCount} 个页面动作）` : ''}`
    const action = toolLabels[tools.at(-1) ?? 'action'] ?? '操作页面'
    return `AI 正在${action}${actionCount ? `（第 ${actionCount} 个页面动作）` : ''}`
  }
  if (event.kind === 'progress' && phase === 'agent_waiting') {
    const idleSeconds = typeof nested.idleSeconds === 'number' ? nested.idleSeconds : undefined
    return `AI 正在等待页面或模型响应${idleSeconds ? `（已等待 ${idleSeconds} 秒）` : ''}`
  }
  if (event.kind === 'progress' && phase === 'agent_page_state') {
    if (nested.uncertain === true) return '页面状态暂时无法读取，AI 将按需查看页面画面'
    if (nested.loading === true) return '页面正在加载，AI 正在等待页面稳定'
    const errorCount = typeof nested.errorCount === 'number' ? nested.errorCount : 0
    if (errorCount > 0) return `页面出现 ${errorCount} 条校验或错误提示，AI 正在核对是否符合预期`
    const surfaceLabels: Record<string, string> = { dialog: '弹窗', drawer: '抽屉面板', overlay: '遮罩操作层' }
    const surface = surfaceLabels[text(nested.surface)]
    if (surface) return `页面出现${surface}，AI 正在判断是否需要继续操作`
  }
  if (event.kind === 'progress' && phase === 'agent_post_action') return 'AI 正在检查操作后的页面，并处理必要的后续步骤'
  if (event.kind === 'progress' && phase === 'agent_confirmation') return '检测到二次确认窗口，AI 正在完成确认提交'
  if (event.kind === 'progress' && phase === 'act_fallback') return '快速操作未完成，正在切换为 AI 深度处理'
  if (event.kind === 'progress' && phase === 'assert_page') {
    const total = typeof nested.total === 'number' ? nested.total : 0
    const passed = typeof nested.passed === 'number' ? nested.passed : 0
    return `正在核对页面结果（${passed} / ${total} 项已通过）`
  }
  if (event.kind === 'progress' && text(nested.action) === 'navigate') return '已打开测试环境，正在识别当前页面'
  if (event.kind === 'role_switched') return `已切换为“${text(event.data.roleName, text(event.data.role, '指定'))}”测试账号`
  if (event.kind === 'identity_verified') return '已确认当前登录账号，可以继续测试'
  if (event.kind === 'handoff_required') return '需要你完成登录或验证码，完成后点击“继续测试”'
  if (event.kind === 'retry') return `页面或 AI 暂时没有响应，正在自动重试${typeof event.data.attempt === 'number' ? `（第 ${event.data.attempt} 次）` : ''}`
  if (event.kind === 'command_started') return `开始：${text(event.data.title, '当前测试步骤')}`
  if (event.kind === 'command_completed') {
    const elapsedMs = typeof event.data.elapsedMs === 'number' ? event.data.elapsedMs : 0
    return `完成：${text(event.data.title, '当前测试步骤')}${elapsedMs ? `（${Math.max(0.1, elapsedMs / 1000).toFixed(1)} 秒）` : ''}`
  }
  const labels: Record<string, string> = {
    queued: '测试已加入执行队列', preflight: '正在检查浏览器、账号和测试配置', running: '检查完成，开始执行测试',
    pause_requested: '正在完成当前动作，然后暂停', paused: '测试已暂停，可以手动操作浏览器', passed: '全部步骤执行完成，测试通过',
    business_failed: '页面结果与预期不一致，已记录为待确认问题', blocked: '执行条件不满足，测试已停止',
    cancelled: '测试已停止', interrupted: '执行意外中断',
  }
  return labels[event.kind] ?? '执行状态已更新'
}

export function planStepLabel(command: Readonly<Record<string, unknown>>, index: number): string {
  const title = text(command.title)
  if (title) return title
  if (command.command === 'execute') {
    const step = command.step && typeof command.step === 'object' ? command.step as Record<string, unknown> : undefined
    if (step?.action === 'navigate') return '打开测试环境并识别页面'
    return `执行页面操作 ${index + 1}`
  }
  if (command.command === 'agent') {
    const goal = text(command.goal).split(/[。；\n]/).find(Boolean)?.replace(/^请按顺序完成并核验：/, '').replace(/^测试集合：/, '')
    return goal ? goal.slice(0, 80) : `执行测试场景 ${index}`
  }
  if (command.command === 'observe') return '读取并检查当前页面'
  if (command.command === 'act') return '完成当前页面操作'
  if (command.command === 'assert_page') return '核对页面结果'
  return `执行步骤 ${index + 1}`
}

export function planStepDetails(command: Readonly<Record<string, unknown>>): string[] {
  if (!Array.isArray(command.details)) return []
  return command.details.map((item) => text(item)).filter(Boolean).slice(0, 10)
}
