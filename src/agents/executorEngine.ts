import type { PlanStep, PageContext, HealerLog, GeneratorOutput } from '../types';
import { generateAction, healStep } from '../api/llmBridge';
import { getPageSnapshot, executeBrowserAction } from '../api/browserBridge';
import { compressDomForLlm } from '../utils/domCompressor';

/**
 * 执行真实的自动化任务主循环 (Phase 3 Core)
 * 
 * @param steps Planner 解析出的任务步骤
 * @param onStepUpdate 步骤状态更新回调
 * @param onHealerLog Healer 自愈日志更新回调
 * @param onPageUpdate CDP 页面状态更新回调
 */
export async function executeTaskLoop(
  steps: PlanStep[],
  onStepUpdate: (step: PlanStep) => void,
  onHealerLog: (log: HealerLog) => void,
  onPageUpdate: (page: PageContext) => void
): Promise<void> {
  for (const step of steps) {
    if (step.status === 'success') continue;

    // 1. 标记当前步骤为进行中
    const currentStep = { ...step, status: 'running' as const };
    onStepUpdate(currentStep);

    let maxRetries = 3;
    let attempt = 0;
    let stepSuccess = false;
    let lastFailureReason = '';

    while (attempt < maxRetries && !stepSuccess) {
      attempt++;

      try {
        // 2. 抓取真实页面快照 (Perception Layer)
        onHealerLog({
          timestamp: new Date().toLocaleTimeString(),
          stepId: step.stepId,
          strategy: 'retry',
          message: `🔍 [P1] 正在通过 CDP 抓取页面实时 DOM (尝试 ${attempt}/${maxRetries})...`,
          resolved: false
        });

        const pageContext = await getPageSnapshot();
        onPageUpdate(pageContext);

        // 如果没有提取到元素，可能是加载慢，抛出异常触发 Healer
        if (!pageContext.interactiveElements || pageContext.interactiveElements.length === 0) {
          throw new Error("页面 DOM 为空，可能尚未渲染完毕");
        }

        // 3. 压缩 DOM 以便喂给 LLM，节省 Token
        const compressedDom = compressDomForLlm(pageContext.interactiveElements);

        // 4. 调用 Generator 生成器，或者是 Healer 自愈器
        let actionPlan: { action: string; target: string; value?: string; reason?: string };
        
        if (attempt === 1) {
          // 第一次尝试：正常生成
          onHealerLog({
            timestamp: new Date().toLocaleTimeString(),
            stepId: step.stepId,
            strategy: 'ai_diagnose',
            message: `🧠 [G1] 正在请求大模型生成决策：${step.description}`,
            resolved: false
          });
          const genResult = await generateAction(step.description, compressedDom);
          actionPlan = genResult;
          
          onHealerLog({
            timestamp: new Date().toLocaleTimeString(),
            stepId: step.stepId,
            strategy: 'ai_diagnose',
            message: `💡 [G2] 模型决策: ${genResult.action} 操作元素 ${genResult.target}。原因: ${genResult.reason}`,
            resolved: true
          });
        } else {
          // 第二次及以上尝试：触发 Healer 自愈
          onHealerLog({
            timestamp: new Date().toLocaleTimeString(),
            stepId: step.stepId,
            strategy: 'ai_diagnose',
            message: `🚑 [H1] 步骤执行失败，触发 Healer 自愈。失败原因: ${lastFailureReason}`,
            resolved: false
          });
          
          const healResult = await healStep(step.description, lastFailureReason, compressedDom);
          actionPlan = {
            action: healResult.action,
            target: healResult.target,
            value: healResult.value,
          };

          onHealerLog({
            timestamp: new Date().toLocaleTimeString(),
            stepId: step.stepId,
            strategy: healResult.strategy,
            message: `💡 [H2] Healer 诊断: ${healResult.diagnosis}。提供新策略: 操作元素 ${healResult.target}`,
            resolved: true
          });
          currentStep.healed = true; // 标记该步骤触发过自愈
        }

        // 5. 在真实的 CDP 浏览器中执行动作
        onHealerLog({
          timestamp: new Date().toLocaleTimeString(),
          stepId: step.stepId,
          strategy: 'retry',
          message: `🚀 [E1] 正在浏览器中执行动作：${actionPlan.action} -> ${actionPlan.target}`,
          resolved: false
        });

        const execResult = await executeBrowserAction(actionPlan.action, actionPlan.target, actionPlan.value);
        
        // 执行成功
        stepSuccess = true;
        currentStep.status = 'success';
        onStepUpdate(currentStep);

        onHealerLog({
          timestamp: new Date().toLocaleTimeString(),
          stepId: step.stepId,
          strategy: 'retry',
          message: `✅ [E2] 动作执行成功: ${execResult.message}`,
          resolved: true
        });

        // 稍微等待页面反应
        await new Promise(r => setTimeout(r, 1000));
        
        // 获取执行后的新状态
        const newPageContext = await getPageSnapshot();
        onPageUpdate(newPageContext);

      } catch (err: any) {
        lastFailureReason = err.message || String(err);
        onHealerLog({
          timestamp: new Date().toLocaleTimeString(),
          stepId: step.stepId,
          strategy: 'retry',
          message: `🔴 [E3] 执行抛出异常: ${lastFailureReason}`,
          resolved: false
        });

        // 如果超出最大重试次数，直接失败
        if (attempt >= maxRetries) {
          currentStep.status = 'failed';
          onStepUpdate(currentStep);
          onHealerLog({
            timestamp: new Date().toLocaleTimeString(),
            stepId: step.stepId,
            strategy: 'abort',
            message: `❌ [E4] 超过最大重试次数(${maxRetries})，任务中止。`,
            resolved: false
          });
          // 停止后续所有步骤
          return;
        }

        // 没超过就稍微等待一下，然后进入下一次 while 循环（也就是下一次重试/Healer）
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
}
