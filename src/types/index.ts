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
  ariaLabel?: string;
  labelText?: string;
  options?: string;
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
export type TargetStrategy = 'placeholder' | 'aria-label' | 'text' | 'testid' | 'name' | 'selector' | 'index' | 'accessible-name' | 'role';

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

/** 参数集：一组具体的变量值，用于对同一模板进行多轮不同参数的重复测试 */
export interface ParameterSet {
  id: string;
  name: string;                       // 如 "测试场景：管理员角色"
  values: Record<string, string>;     // 变量名 → 具体值
  lastRunStatus?: 'success' | 'failed' | 'pending';
  lastRunAt?: string;                 // ISO 时间字符串
}

import type { BusinessRole } from './workflow';

export interface ScenarioTemplate {
  id: string;
  name: string;
  category: 'login' | 'form' | 'approval' | 'query' | 'other';
  description: string;
  targetUrl?: string;
  steps: {
    order: number;
    /** The business actor responsible for this step when the template models a workflow. */
    role?: BusinessRole;
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
  /** 可配置的多组参数集，用于重复测试 */
  parameterSets?: ParameterSet[];
  /** 生成该模板的需求文档片段（前500字，仅AI生成模板有） */
  sourceDocument?: string;
  /** AI 生成时间戳 */
  generatedAt?: string;
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
  duration?: number;
  suiteId?: string;
  suiteName?: string;
  caseId?: string;
  caseName?: string;
  managementSummary?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  releaseAdvice?: 'can_release' | 'review_required' | 'block_release';
}

export interface SystemStatus {
  llm: 'connected' | 'disconnected' | 'checking';
  browser: 'connected' | 'disconnected' | 'checking';
  sidecar: 'connected' | 'disconnected' | 'checking';
  activeProfile: string;
  activeModel: string;
}

export type DataSecurityMode = 'strict_redaction' | 'local_model_first' | 'cloud_enhanced';

export interface DataSecurityConfig {
  mode: DataSecurityMode;
  allowRawScreenshots: boolean;
}

export type TestCaseType =
  | 'normal'
  | 'boundary'
  | 'empty'
  | 'permission'
  | 'repeat'
  | 'combination';

export type TestCaseStatus = 'draft' | 'confirmed' | 'archived';

export interface TestCaseStep {
  order: number;
  /** Kept from the scenario template so workflow conversion does not lose account handoffs. */
  role?: BusinessRole;
  action: string;
  expectedResult: string;
}

export interface TestCase {
  id: string;
  designId?: string;
  requirementVersionId?: string;
  generationBatchId?: string;
  title: string;
  requirementTitle: string;
  module: string;
  templateId?: string;
  templateName?: string;
  sourceKind?: 'requirement' | 'template' | 'manual';
  type: TestCaseType;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  riskPoint: string;
  preconditions: string[];
  testData: Record<string, string>;
  steps: TestCaseStep[];
  expectedResult: string;
  isBoundary: boolean;
  isRepeat: boolean;
  status: TestCaseStatus;
  createdAt: string;
  confirmedAt?: string;
  suiteIds: string[];
  lastRunStatus?: 'success' | 'failed' | 'pending';
  lastRunAt?: string;
}

export interface RegressionSuite {
  id: string;
  name: string;
  description: string;
  module: string;
  caseIds: string[];
  createdAt: string;
  lastRunAt?: string;
  lastPassRate?: number;
}

export type {
  CreateEnvironmentInput,
  CreateGenerationBatchInput,
  CreateRegressionConfigInput,
  CreateRequirementVersionInput,
  DesignTestCaseRecord,
  CreateReviewRecordInput,
  CreateTestDesignInput,
  EnvironmentKind,
  GenerationBatch,
  SaveGenerationCasesInput,
  RegressionConfig,
  RequirementVersion,
  ReviewRecord,
  SystemEnvironment,
  TestDesign,
  TestSystem,
  UpdateEnvironmentInput,
  UpdateDesignCaseStatusInput,
  UpdateTestDesignInput,
  UpdateTestSystemInput,
} from './testDesign'

export type {
  ExecutionErrorCategory,
  ExecutionPlan,
  ExecutionRun,
  ExecutionRunEvent,
  ExecutionRunStatus,
  RunEventPayload,
  RunUpdatedEvent,
  StartRunInput,
} from './execution'
