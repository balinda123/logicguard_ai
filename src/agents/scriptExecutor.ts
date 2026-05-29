/**
 * scriptExecutor.ts — 确定性测试脚本执行引擎
 *
 * 与旧的 executorEngine 的核心区别：
 * - 旧引擎：每步都调用 LLM，依赖模型实时推理"点哪里"
 * - 新引擎：按 TestScript 的 target.strategy 精准构建 CSS 选择器，100% 确定性执行
 */

import type { TestScript, TestStep, TargetStrategy, HealerLog } from '../types';
import { executeBrowserAction, browserPress } from '../api/browserBridge';

export interface ExecutorCallbacks {
  onStepUpdate: (step: TestStep) => void;
  onHealerLog: (log: HealerLog) => void;
  onComplete: () => void;
}

/**
 * 将 TestTarget 转换为 CSS 选择器
 * 这是新架构的核心：根据策略类型构建精准选择器
 */
export function buildCssSelector(strategy: TargetStrategy, value: string): string {
  switch (strategy) {
    case 'placeholder':
      // 使用 *= 进行包含匹配，更健壮
      return `[placeholder*="${value}"]`;
    case 'aria-label':
      return `[aria-label*="${value}"]`;
    case 'name':
      return `[name="${value}"]`;
    case 'testid':
      return `[data-testid="${value}"]`;
    case 'text':
      // Playwright 的 :text() 伪选择器
      return `:text("${value}")`;
    case 'selector':
      // 原始 CSS 选择器直接使用
      return value;
    case 'index':
      // 兜底：使用旧的 data-lg-id 方案
      return `[data-lg-id]`; // 会在 sidecar 中被替换
    default:
      return value;
  }
}

/**
 * 执行整份测试脚本
 */
export async function executeTestScript(
  script: TestScript,
  callbacks: ExecutorCallbacks
): Promise<void> {
  const { onStepUpdate, onHealerLog, onComplete } = callbacks;

  for (const step of script.steps) {
    // 标记为运行中
    const runningStep: TestStep = { ...step, status: 'running' };
    onStepUpdate(runningStep);

    onHealerLog({
      timestamp: new Date().toLocaleTimeString(),
      stepId: step.stepId,
      strategy: 'retry',
      message: `▶️ [S${step.stepId}] 执行: ${step.description}`,
      resolved: true,
    });

    try {
      await executeOneStep(step, onHealerLog);

      const successStep: TestStep = { ...step, status: 'success' };
      onStepUpdate(successStep);

      onHealerLog({
        timestamp: new Date().toLocaleTimeString(),
        stepId: step.stepId,
        strategy: 'retry',
        message: `✅ [S${step.stepId}] 成功`,
        resolved: true,
      });

      // 步骤间短暂等待，让页面响应
      await delay(600);
    } catch (err: any) {
      const failedStep: TestStep = { ...step, status: 'failed' };
      onStepUpdate(failedStep);

      onHealerLog({
        timestamp: new Date().toLocaleTimeString(),
        stepId: step.stepId,
        strategy: 'ai_diagnose',
        message: `❌ [S${step.stepId}] 失败: ${err.message ?? String(err)}`,
        resolved: false,
      });

      // 步骤失败时终止整个脚本执行
      break;
    }
  }

  onComplete();
}

async function executeOneStep(step: TestStep, onHealerLog: (log: HealerLog) => void): Promise<void> {
  const { action, target, value } = step;

  // 对于 navigate，target.value 就是 URL
  if (action === 'navigate') {
    await executeBrowserAction('navigate', target.value, value);
    return;
  }

  // 对于 wait，直接等待
  if (action === 'wait') {
    const ms = parseInt(value ?? '1000');
    await delay(ms);
    return;
  }

  // ── 关键修复：不再预先转为 CSS，而是传语义格式给 sidecar ──
  // 格式：strategy:value，例如 "placeholder:请选择直属部门"
  // sidecar 的 7 级降级引擎收到后自己决定用哪种 Playwright 定位 API
  // 对于 selector 策略，直接传原始 CSS（不加前缀）
  const smartSelector = target.strategy === 'selector'
    ? target.value
    : `${target.strategy}:${target.value}`;

  onHealerLog({
    timestamp: new Date().toLocaleTimeString(),
    stepId: step.stepId,
    strategy: 'retry',
    message: `🔍 [S${step.stepId}] 智能定位: ${target.strategy}="${target.value}" → 启动7级降级链`,
    resolved: true,
  });

  // 分发具体动作
  switch (action) {
    case 'click':
      await executeBrowserAction('click', smartSelector);
      break;
    case 'hover':
      await executeBrowserAction('hover', smartSelector);
      break;
    case 'type':
      await executeBrowserAction('type', smartSelector, value ?? '');
      break;
    case 'press':
      await browserPress(smartSelector, value ?? 'Enter');
      break;
    case 'select':
      await executeBrowserAction('select', smartSelector, value);
      break;
    case 'assert':
      await executeBrowserAction('assert', smartSelector, value);
      break;
    case 'scroll':
      await executeBrowserAction('click', smartSelector);
      break;
    default:
      throw new Error(`未知动作类型: ${action}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
