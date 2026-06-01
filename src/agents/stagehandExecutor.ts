/**
 * stagehandExecutor.ts — Stagehand-First 全动态执行引擎
 *
 * 🏗️ 架构核心：
 * 与旧的 scriptExecutor（死脚本回放）和 executorEngine（DOM 压缩+LLM 推理）不同，
 * 这个引擎每一步都通过 Stagehand 的 act() API 直接用自然语言驱动浏览器。
 *
 * 优势：
 * - AI 实时感知当前页面 DOM（无需预先抓取快照）
 * - 完美支持跨页面跳转（跳转后 Stagehand 自动感知新页面）
 * - 不依赖 CSS 选择器（AI 自行理解页面结构并定位元素）
 * - 单步执行，单步反馈，单步重试
 */

import type { HealerLog } from '../types';
import { browserAct } from '../api/browserBridge';

// ── Stagehand 执行引擎的步骤类型 ──
export interface StagehandStep {
  stepId: number;
  description: string;  // 自然语言描述，直接传给 Stagehand act()
  status: 'pending' | 'running' | 'success' | 'failed';
}

export interface StagehandScript {
  title: string;
  userIntent: string;
  steps: StagehandStep[];
  generatedAt: string;
}

export interface StagehandCallbacks {
  onStepUpdate: (step: StagehandStep) => void;
  onHealerLog: (log: HealerLog) => void;
  onComplete: () => void;
  checkPause?: () => Promise<void>;
}

/**
 * 执行 Stagehand-First 脚本
 * 对每个步骤：直接调用 browserAct(step.description)
 * Stagehand 内部会自动连接当前活跃 Chrome 页面，用 AI 理解并执行操作
 */
export async function executeStagehandScript(
  script: StagehandScript,
  callbacks: StagehandCallbacks
): Promise<void> {
  const { onStepUpdate, onHealerLog, onComplete, checkPause } = callbacks;

  for (const step of script.steps) {
    // 暂停挂起检查
    if (checkPause) {
      await checkPause();
    }

    // 标记为运行中
    const runningStep: StagehandStep = { ...step, status: 'running' };
    onStepUpdate(runningStep);

    onHealerLog({
      timestamp: new Date().toLocaleTimeString(),
      stepId: step.stepId,
      strategy: 'ai_diagnose',
      message: `🤖 [S${step.stepId}] Stagehand AI 执行: ${step.description}`,
      resolved: false,
    });

    let maxRetries = 3;
    let attempt = 0;
    let success = false;

    while (attempt < maxRetries && !success) {
      attempt++;

      try {
        // 🧠 核心：直接用自然语言驱动 Stagehand
        const result = await browserAct(step.description);

        success = true;
        const successStep: StagehandStep = { ...step, status: 'success' };
        onStepUpdate(successStep);

        onHealerLog({
          timestamp: new Date().toLocaleTimeString(),
          stepId: step.stepId,
          strategy: 'ai_diagnose',
          message: `✅ [S${step.stepId}] 成功: ${result.message}`,
          resolved: true,
        });

        // 步骤间等待，让页面完成渲染/跳转
        await delay(1500);

      } catch (err: any) {
        const errMsg = err.message || String(err);

        onHealerLog({
          timestamp: new Date().toLocaleTimeString(),
          stepId: step.stepId,
          strategy: 'retry',
          message: `🔴 [S${step.stepId}] 第 ${attempt}/${maxRetries} 次尝试失败: ${errMsg}`,
          resolved: false,
        });

        if (attempt >= maxRetries) {
          // 超出重试次数，标记失败并终止
          const failedStep: StagehandStep = { ...step, status: 'failed' };
          onStepUpdate(failedStep);

          onHealerLog({
            timestamp: new Date().toLocaleTimeString(),
            stepId: step.stepId,
            strategy: 'abort',
            message: `❌ [S${step.stepId}] 最终失败: ${errMsg}`,
            resolved: false,
          });

          break;
        }

        // 等待后重试（页面可能还在加载）
        await delay(2000);
      }
    }

    // 如果这一步失败了，终止后续步骤
    if (!success) {
      break;
    }
  }

  onComplete();
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
