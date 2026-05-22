import type { PlanStep, HealerLog, PageContext } from '../types';

// Predefined mock pages for visual simulation
export const mockPages: Record<string, PageContext> = {
  navigate_sso: {
    url: 'https://sso.company.com/sso',
    title: '企业统一认证平台',
    interactiveElements: [
      { index: 0, tag: 'INPUT', text: '', placeholder: '邮箱/工号', selector: 'input#username' },
      { index: 1, tag: 'INPUT', text: '', type: 'password', placeholder: '密码', selector: 'input#password' },
      { index: 2, tag: 'BUTTON', text: '企业账户一键登录', selector: 'button#sso-quick-login' },
      { index: 3, tag: 'A', text: '扫码登录', selector: 'a.qr-login-link' }
    ]
  },
  detect_credentials: {
    url: 'https://sso.company.com/sso?detected=true',
    title: '企业统一认证平台 - 安全检测中',
    interactiveElements: [
      { index: 0, tag: 'DIV', text: '检测到有效Chrome Profile凭证 (Active Session)', selector: '.sso-alert' },
      { index: 1, tag: 'BUTTON', text: '确认无缝登入', selector: 'button.btn-continue' }
    ]
  },
  click_quick: {
    url: 'https://sso.company.com/sso-redirecting',
    title: '正在重定向至OA主系统...',
    interactiveElements: [
      { index: 0, tag: 'SPAN', text: '跳转中，请稍候...', selector: '.loading-text' }
    ]
  },
  oa_home: {
    url: 'https://oa.company.com/home',
    title: '企业智能办公协同主页',
    interactiveElements: [
      { index: 0, tag: 'A', text: '待办审批 (3)', selector: 'a.todo-badge' },
      { index: 1, tag: 'A', text: '请假申请', selector: 'a#menu-leave' },
      { index: 2, tag: 'A', text: '报销提报', selector: 'a#menu-finance' },
      { index: 3, tag: 'DIV', text: '欢迎您，张三 (管理员已授权)', selector: '.welcome-message' }
    ]
  }
};

export const simulatePlanning = async (
  task: string,
  onProgress: (status: string) => void
): Promise<PlanStep[]> => {
  onProgress(' sedang Menghubungi Ollama (Model: qwen2.5:7b)...');
  await new Promise((r) => setTimeout(r, 1200));

  onProgress(' 正在提取页面感知结构并对比场景模板...');
  await new Promise((r) => setTimeout(r, 800));

  onProgress(' 正在规划最优执行路径...');
  await new Promise((r) => setTimeout(r, 800));

  if (task.includes('财务') || task.includes('报销')) {
    return [
      { stepId: 1, description: '导航至新建报销单页面', expectedAction: 'navigate', successCriteria: '页面标题包含"报销"', status: 'pending' },
      { stepId: 2, description: '填写费用事由和报销总金额', expectedAction: 'type', successCriteria: '事由及金额输入框有数据', status: 'pending' },
      { stepId: 3, description: '下拉选择报销关联项目为 "2026年AI研发专项"', expectedAction: 'select', successCriteria: '项目选择器选中值', status: 'pending' },
      { stepId: 4, description: '自动解析并上传发票凭证附件', expectedAction: 'type', successCriteria: '附件栏出现成功列表', status: 'pending' },
      { stepId: 5, description: '提报单据并触发审批流断言', expectedAction: 'click', successCriteria: '弹出成功提示或单据号', status: 'pending' }
    ];
  }

  // Default OA Login / General flow
  return [
    { stepId: 1, description: '导航至企业SSO统一登录入口', expectedAction: 'navigate', successCriteria: '检测到登录页加载', status: 'pending' },
    { stepId: 2, description: '感知并继承本地Chrome Profile安全凭证', expectedAction: 'wait', successCriteria: 'Cookie/Session匹配成功', status: 'pending' },
    { stepId: 3, description: '定位并点击一键极速快捷登录按钮', expectedAction: 'click', successCriteria: '页面重定向跳转', status: 'pending' },
    { stepId: 4, description: '断言是否无感透传进入OA工作台主页', expectedAction: 'assert', successCriteria: '发现欢迎模块或待办事项', status: 'pending' }
  ];
};

export const runStepSimulation = async (
  step: PlanStep,
  onStepUpdate: (updatedStep: PlanStep) => void,
  onHealerLog: (log: HealerLog) => void,
  onPageUpdate: (page: PageContext) => void
) => {
  onStepUpdate({ ...step, status: 'running' });

  // Update mock page based on step
  if (step.stepId === 1) {
    onPageUpdate(mockPages.navigate_sso);
    await new Promise((r) => setTimeout(r, 1500));
    onStepUpdate({ ...step, status: 'success' });
  } else if (step.stepId === 2) {
    onPageUpdate(mockPages.detect_credentials);
    await new Promise((r) => setTimeout(r, 1200));
    onStepUpdate({ ...step, status: 'success' });
  } else if (step.stepId === 3) {
    // Let's trigger a HEALER event for Step 3 to make it visually spectacular
    onPageUpdate(mockPages.click_quick);
    await new Promise((r) => setTimeout(r, 1000));

    // Simulate selector mismatch failure
    onHealerLog({
      timestamp: new Date().toLocaleTimeString(),
      stepId: step.stepId,
      strategy: 'retry',
      message: '🔴 [H1] 定位 button#sso-quick-login 失败：元素尚未渲染。正在重试...',
      resolved: false
    });
    await new Promise((r) => setTimeout(r, 1500));

    onHealerLog({
      timestamp: new Date().toLocaleTimeString(),
      stepId: step.stepId,
      strategy: 'alt_selector',
      message: '⚠️ [H2] 重试无响应。启动备用选择器定位：button.btn-continue...',
      resolved: false
    });
    await new Promise((r) => setTimeout(r, 1200));

    onHealerLog({
      timestamp: new Date().toLocaleTimeString(),
      stepId: step.stepId,
      strategy: 'ai_diagnose',
      message: '🧠 [H4] 启动本地模型诊断：检测到凭证页面状态更新，正在调用 qwen2.5:7b 诊断...',
      resolved: false
    });
    await new Promise((r) => setTimeout(r, 1500));

    onHealerLog({
      timestamp: new Date().toLocaleTimeString(),
      stepId: step.stepId,
      strategy: 'alt_selector',
      message: '✅ [Healer 成功自愈] 选择器已自动修正为 "button.btn-continue"，执行器重新提交...',
      resolved: true
    });

    onStepUpdate({ ...step, status: 'success', healed: true });
  } else if (step.stepId === 4) {
    onPageUpdate(mockPages.oa_home);
    await new Promise((r) => setTimeout(r, 1600));
    onStepUpdate({ ...step, status: 'success' });
  }
};
