export interface PlanStep {
  stepId: number;
  description: string;
  expectedAction: 'click' | 'type' | 'navigate' | 'scroll' | 'wait' | 'assert' | 'select';
  successCriteria: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  healed?: boolean;
}

export interface PlannerOutput {
  planId: string;
  task: string;
  steps: PlanStep[];
  estimatedTime: number;
}

export interface InteractiveElement {
  index: number;
  tag: string;
  text: string;
  type?: string;
  placeholder?: string;
  role?: string;
  disabled?: boolean;
  selector: string;
  x?: number;
  y?: number;
}

export interface PageContext {
  url: string;
  title: string;
  interactiveElements: InteractiveElement[];
}

export interface GeneratorOutput {
  action: 'click' | 'type' | 'press' | 'navigate' | 'scroll' | 'wait' | 'select' | 'hover' | 'assert';
  target: string;
  value?: string;
  reason: string;
  confidence: number;
}

// ── 新架构：确定性测试脚本 ──
export type TargetStrategy = 'placeholder' | 'aria-label' | 'text' | 'testid' | 'name' | 'selector' | 'index';

export interface TestTarget {
  strategy: TargetStrategy;
  value: string;
  description?: string; // 人类可读说明
}

export interface TestStep {
  stepId: number;
  description: string;
  action: 'click' | 'type' | 'press' | 'hover' | 'navigate' | 'scroll' | 'wait' | 'assert' | 'select';
  target: TestTarget;
  value?: string; // type 的文字内容、press 的按键名、assert 的期望文本等
  status: 'pending' | 'running' | 'success' | 'failed';
}

export interface TestScript {
  scriptId: string;
  title: string;
  userIntent: string;
  steps: TestStep[];
  generatedAt: string;
}

export interface HealerLog {
  timestamp: string;
  stepId: number;
  strategy: 'retry' | 'alt_selector' | 're_perceive' | 'ai_diagnose' | 'cloud_fallback' | 'skip' | 'abort';
  message: string;
  resolved: boolean;
}

export interface ScenarioTemplate {
  id: string;
  name: string;
  category: 'login' | 'form' | 'approval' | 'query' | 'other';
  description: string;
  targetUrl?: string;
  steps: {
    order: number;
    description: string;
    action: string;
    selectorHint?: string;
  }[];
  variables: {
    name: string;
    label: string;
    type: 'text' | 'password' | 'select';
    required: boolean;
    defaultValue?: string;
  }[];
  tags: string[];
}

export interface TestResult {
  id: string;
  testName: string;
  testStatus: 'success' | 'failed' | 'pending';
  task: string;
  createdAt: string;
  completedAt?: string;
  stepsTotal: number;
  stepsSuccess: number;
  reportMarkdown?: string;
  screenshot?: string;
}

export interface SystemStatus {
  ollama: 'connected' | 'disconnected' | 'checking';
  pocketbase: 'connected' | 'disconnected' | 'checking';
  tailscale: 'connected' | 'disconnected' | 'checking';
  activeProfile: string;
  activeModel: string;
}
