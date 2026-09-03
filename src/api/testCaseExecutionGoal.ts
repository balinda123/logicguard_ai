import type { TestCase } from '../types'

const PLACEHOLDER_PATTERN = /\{\{\s*([^}]+?)\s*\}\}|\$\{\s*([^}]+?)\s*\}|\[运行时数据\]|\b(?:TBD|TODO|N\/A)\b|待补充|待填写/gi

function executableText(value: string): string {
  return value.replace(PLACEHOLDER_PATTERN, (_match, moustacheKey, templateKey) => {
    const key = String(moustacheKey || templateKey || '该字段').trim()
    return `“${key}”对应的真实业务测试值`
  })
}

function executableData(testCase: TestCase): string {
  const entries = Object.entries(testCase.testData)
  if (entries.length === 0) return '未预置测试数据；执行时先根据页面字段、用例类型和边界要求生成语义合理的虚构业务数据。'
  return entries.map(([key, value]) => `${key}=${executableText(String(value))}`).join('；')
}

export function buildCaseExecutionGoal(testCase: TestCase): string {
  const procedure = testCase.steps
    .map((step) => `${step.order}. ${executableText(step.action)}，预期：${executableText(step.expectedResult)}`)
    .join('；')
  // 通用页面操作约束由 Stagehand 的 systemInstructions 统一注入；这里只保留本组执行必需的数据和边界，避免每组重复消耗模型上下文。
  const rules = '优先使用测试数据；缺值时按字段语义生成合理虚构值。边界数据须精准满足长度且保持业务语义。不要输入占位符、字段名、乱码或无意义重复内容；除非用例明确要求异常值。若当前步骤包含多组边界值，必须在当前可编辑页面逐组覆盖输入并逐组核验；全部边界组检查完成前不得正式提交。合法边界可在页面支持时分别新增为多行并一次提交，否则只在最后一组合法数据上正式提交一次。没有明确的可重置夹具时，不得假设页面存在独立测试记录。'
  return `${rules} 测试数据：${executableData(testCase)}。依次执行并核验：${procedure}。场景：${testCase.title}。提交、保存、通过、退回或终止后，继续处理弹窗或页面变化，确认预期结果后再结束。`
    .replace(/\b(password|token|otp|secret|credential)\b/gi, '敏感字段')
    .slice(0, 2400)
}
