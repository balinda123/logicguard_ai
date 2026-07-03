import type { DataSecurityConfig, DataSecurityMode } from '../types';

const DEFAULT_SECURITY_CONFIG: DataSecurityConfig = {
  mode: 'strict_redaction',
  allowRawScreenshots: false,
};

function currentUserId(): string {
  return sessionStorage.getItem('logicguard_user_id') ?? 'anonymous';
}

function storageKey(): string {
  return `logicguard_data_security_${currentUserId()}`;
}

export function getDataSecurityConfig(): DataSecurityConfig {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return DEFAULT_SECURITY_CONFIG;
    return { ...DEFAULT_SECURITY_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SECURITY_CONFIG;
  }
}

export function setDataSecurityConfig(config: DataSecurityConfig): void {
  localStorage.setItem(storageKey(), JSON.stringify({ ...DEFAULT_SECURITY_CONFIG, ...config }));
}

export function isStrictRedactionEnabled(): boolean {
  return getDataSecurityConfig().mode !== 'cloud_enhanced';
}

function maskFieldValue(text: string, label: string, token: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${escaped}\\s*[:：=]\\s*)([^\\s,，;；|｜\\n\\r]{1,40})`, 'g'), `$1${token}`);
}

export function maskSensitiveText(input: string): string {
  if (!input) return input;
  let output = input;

  output = output.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '邮箱_1');
  output = output.replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '手机号_1');
  output = output.replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, '身份证_1');
  output = output.replace(/(?<!\d)(?:\d{4}[-\s]?){3,5}\d{3,4}(?!\d)/g, '银行卡_1');
  output = output.replace(/(?:￥|¥|CNY\s*)?\d{4,9}(?:\.\d{1,2})?\s*(?:元|人民币|RMB)?/gi, (match) => {
    if (/^\d{4}$/.test(match.trim())) return match;
    return '金额_1';
  });

  const fieldMasks: Array<[string, string]> = [
    ['姓名', '员工A'],
    ['员工姓名', '员工A'],
    ['人员姓名', '员工A'],
    ['手机号', '手机号_1'],
    ['手机号码', '手机号_1'],
    ['身份证', '身份证_1'],
    ['证件号', '证件号_1'],
    ['证件号码', '证件号_1'],
    ['邮箱', '邮箱_1'],
    ['邮件', '邮箱_1'],
    ['薪资', '金额_1'],
    ['工资', '金额_1'],
    ['银行卡', '银行卡_1'],
    ['部门', '部门_1'],
    ['组织', '部门_1'],
    ['岗位', '岗位_1'],
    ['地址', '地址_1'],
  ];
  for (const [label, token] of fieldMasks) {
    output = maskFieldValue(output, label, token);
  }

  return output;
}

export function sanitizeForLlm<T extends string | undefined | null>(value: T): T {
  if (value == null) return value;
  if (!isStrictRedactionEnabled()) return value;
  return maskSensitiveText(value) as T;
}

export function securityModeLabel(mode: DataSecurityMode): string {
  if (mode === 'strict_redaction') return '严格脱敏';
  if (mode === 'local_model_first') return '本地模型优先';
  return '云端模型增强';
}
