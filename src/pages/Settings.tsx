import React, { useState, useEffect } from 'react';
import { Cpu, Sliders, Shield, RefreshCw, CheckCircle, XCircle, Key, Zap, Globe, Users, UserPlus, LockKeyhole, FolderOpen, Database, FileText } from 'lucide-react';
import type { SystemStatus } from '../types';
import { getLlmConfig, setLlmConfig, testLlmConnection } from '../api/llmBridge';
import type { LlmConfig } from '../api/llmBridge';
import { invoke } from '@tauri-apps/api/core';
import { createUser, disableUser, getCredentialStatus, listUsers, resetUserPassword, saveApiKey, type SessionUser } from '../api/auth';
import { getCdpPort, setCdpPort as saveCdpPort } from '../api/browserBridge';
import { getDataSecurityConfig, setDataSecurityConfig, securityModeLabel } from '../utils/privacy';
import type { DataSecurityConfig, DataSecurityMode } from '../types';
import { TestAccountsPanel } from '../components/TestAccountsPanel';

interface SettingsProps {
  status: SystemStatus;
  setStatus: React.Dispatch<React.SetStateAction<SystemStatus>>;
  currentUser: SessionUser;
}

type TestState = 'idle' | 'testing' | 'ok' | 'error';

interface ProviderPreset {
  id: string;
  label: string;
  provider: LlmConfig['provider'];
  model: string;
  baseUrl?: string;
  apiKeyPlaceholder: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek（推荐 / OpenAI 兼容）',
    provider: 'openai_compat',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'openai',
    label: 'OpenAI 官方',
    provider: 'openai_compat',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'qwen',
    label: '通义千问 / 阿里云百炼',
    provider: 'openai_compat',
    model: 'qwen-plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'kimi',
    label: 'Kimi / Moonshot',
    provider: 'openai_compat',
    model: 'moonshot-v1-8k',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    provider: 'openai_compat',
    model: 'glm-4-flash',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyPlaceholder: '填写智谱 API Key',
  },
  {
    id: 'doubao',
    label: '豆包 / 火山方舟',
    provider: 'openai_compat',
    model: 'doubao-seed-1-6',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyPlaceholder: '填写火山方舟 API Key',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    apiKeyPlaceholder: 'AIza...',
  },
  {
    id: 'ollama',
    label: '本地 Ollama（实验）',
    provider: 'ollama',
    model: 'qwen2.5:7b',
    baseUrl: 'http://127.0.0.1:11434',
    apiKeyPlaceholder: '本地 Ollama 可填写任意占位 Key',
  },
  {
    id: 'custom',
    label: '自定义 OpenAI 兼容接口',
    provider: 'openai_compat',
    model: 'your-model-name',
    baseUrl: 'https://example.com/v1',
    apiKeyPlaceholder: 'sk-...',
  },
];

interface StorageLocations {
  appDataDir: string;
  usersDbPath: string;
  currentUserReportPath: string;
  chromeProfileDir: string;
  credentialService: string;
  credentialAccount: string;
  localStorageNote: string;
}

export const Settings: React.FC<SettingsProps> = ({ status, setStatus, currentUser }) => {
  const [llmConfig, setLlmConfigState] = useState<LlmConfig>(getLlmConfig());
  const [showApiKey, setShowApiKey] = useState(false);
  const [llmTestState, setLlmTestState] = useState<TestState>('idle');
  const [llmTestMsg, setLlmTestMsg] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [users, setUsers] = useState<SessionUser[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [cdpPort, setCdpPort] = useState(String(getCdpPort()));
  const [chromeProfile, setChromeProfile] = useState(status.activeProfile);
  const [isolatedMode, setIsolatedMode] = useState(true);
  const activeUsers = users.filter((user) => !user.disabled);
  const disabledUsers = users.filter((user) => user.disabled);
  const showLegacyUserPanel = false;
  const [storageLocations, setStorageLocations] = useState<StorageLocations | null>(null);
  const [storageMsg, setStorageMsg] = useState('');
  const [securityConfig, setSecurityConfigState] = useState<DataSecurityConfig>(getDataSecurityConfig());
  const selectedPreset =
    PROVIDER_PRESETS.find((preset) =>
      preset.provider === llmConfig.provider &&
      preset.model === llmConfig.model &&
      (preset.baseUrl ?? '') === (llmConfig.base_url ?? '')
    ) ??
    PROVIDER_PRESETS.find((preset) =>
      preset.provider === llmConfig.provider &&
      (preset.baseUrl ?? '') === (llmConfig.base_url ?? '')
    ) ??
    PROVIDER_PRESETS.find((preset) => preset.id === 'custom')!;
  const apiKeyPlaceholder = llmConfig.credential_configured
    ? '已安全保存；留空表示不修改'
    : selectedPreset.apiKeyPlaceholder;

  // Chrome CDP 一键启动状态
  const [chromeLaunchState, setChromeLaunchState] = useState<TestState>('idle');
  const [chromeLaunchMsg, setChromeLaunchMsg] = useState('');

  // 检查 CDP 连接状态
  const checkCdpConnection = async () => {
    try {
      const port = parseInt(cdpPort, 10);
      saveCdpPort(port);
      const connected = await invoke<boolean>('browser_check_connection', { port });
      if (connected) setStatus(prev => ({ ...prev, browser: 'connected' }));
      else setStatus(prev => ({ ...prev, browser: 'disconnected' }));
    } catch {
      setStatus(prev => ({ ...prev, browser: 'disconnected' }));
    }
  };

  // 一键启动 Chrome CDP
  const handleLaunchChrome = async () => {
    setChromeLaunchState('testing');
    setChromeLaunchMsg('');
    try {
      const port = parseInt(cdpPort, 10);
      saveCdpPort(port);
      const msg = await invoke<string>('launch_chrome_cdp', {
        port,
        userDataDir: null,
      });
      setChromeLaunchState('ok');
      setChromeLaunchMsg(msg);
      // 启动后检查连接
      setTimeout(checkCdpConnection, 1500);
    } catch (e) {
      setChromeLaunchState('error');
      setChromeLaunchMsg(String(e));
    }
  };


  useEffect(() => {
    getCredentialStatus().then((configured) => {
      setLlmConfigState((prev) => ({ ...prev, credential_configured: configured }));
    });
    invoke<StorageLocations>('get_storage_locations')
      .then(setStorageLocations)
      .catch((reason) => setStorageMsg(String(reason)));
    if (currentUser.role === 'admin') listUsers().then(setUsers).catch(() => setUsers([]));
  }, [currentUser.role]);

  const handleSaveLlmConfig = async () => {
    let credentialConfigured = llmConfig.credential_configured === true;
    if (apiKeyInput.trim()) {
      await saveApiKey(apiKeyInput);
      credentialConfigured = true;
      setApiKeyInput('');
    }
    if (!credentialConfigured) {
      throw new Error('请先填写当前用户的 API Key');
    }
    const cfg = { ...llmConfig, credential_configured: credentialConfigured };
    setLlmConfig(cfg);
    setLlmConfigState(cfg);
    return cfg;
  };

  const handleTestLlm = async () => {
    setLlmTestState('testing');
    setLlmTestMsg('');
    let cfg: LlmConfig;
    try {
      cfg = await handleSaveLlmConfig();
    } catch (reason) {
      setLlmTestState('error');
      setLlmTestMsg(String(reason));
      return;
    }
    const result = await testLlmConnection(cfg);
    setLlmTestState(result.ok ? 'ok' : 'error');
    setLlmTestMsg(result.message);
    if (result.ok) {
      setStatus(prev => ({ ...prev, llm: 'connected' }));
    } else {
      setStatus(prev => ({ ...prev, llm: 'disconnected' }));
    }
  };

  const inputCls = 'w-full h-9 px-3 rounded-lg bg-surface-2 border border-border focus:border-brand-500 text-xs text-text-primary font-mono outline-none transition-all duration-200';
  const labelCls = 'text-[10px] text-text-secondary font-semibold uppercase block mb-1';
  const updateSecurityConfig = (patch: Partial<DataSecurityConfig>) => {
    const next = { ...securityConfig, ...patch };
    setSecurityConfigState(next);
    setDataSecurityConfig(next);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent overflow-y-auto p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-text-primary">系统配置面板</h2>
        <p className="text-xs text-text-muted">管理云端 AI 模型、浏览器 CDP 和本地用户配置</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

        {/* ─── Section 1: AI Model Provider ─── */}
        <div className="p-5 rounded-xl border border-border bg-surface-1/70 space-y-4 glow">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-2.5">
              <Cpu className="w-4 h-4 text-brand-400" />
              <h3 className="text-xs font-bold text-text-primary">AI 模型接入配置</h3>
            </div>
            {llmTestState === 'ok' && (
              <span className="flex items-center gap-1 text-[10px] text-success font-medium">
                <CheckCircle className="w-3 h-3" /> 连接成功
              </span>
            )}
            {llmTestState === 'error' && (
              <span className="flex items-center gap-1 text-[10px] text-error font-medium">
                <XCircle className="w-3 h-3" /> 连接失败
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Provider select */}
            <div className="space-y-1">
              <label className={labelCls}>模型提供商 / 预设</label>
              <select
                value={selectedPreset.id}
                onChange={(e) => {
                  const preset = PROVIDER_PRESETS.find((item) => item.id === e.target.value) ?? PROVIDER_PRESETS[0];
                  setLlmConfigState(prev => ({
                    ...prev,
                    provider: preset.provider,
                    model: preset.model,
                    base_url: preset.baseUrl,
                  }));
                }}
                className={inputCls}
              >
                {PROVIDER_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.label}</option>
                ))}
              </select>
              <p className="text-[9px] text-text-muted mt-1">
                选择预设会自动填入推荐模型和 Base URL；仍可在右侧手动微调模型名称。
              </p>
            </div>

            {/* Model name */}
            <div className="space-y-1">
              <label className={labelCls}>模型名称</label>
              <input
                  type="text"
                  value={llmConfig.model}
                  onChange={(e) => setLlmConfigState(prev => ({ ...prev, model: e.target.value }))}
                  placeholder={llmConfig.provider === 'gemini' ? 'gemini-2.0-flash' : 'deepseek-chat'}
                  className={inputCls}
                />
            </div>

              <div className="space-y-1 sm:col-span-2">
                <label className={labelCls}>
                  <Key className="w-3 h-3 inline mr-1" />
                  API 密钥
                </label>
                <div className="flex gap-2">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={apiKeyPlaceholder}
                    className={`${inputCls} flex-1`}
                  />
                  <button
                    onClick={() => setShowApiKey(v => !v)}
                    className="px-3 rounded-lg bg-surface-2 border border-border text-xs text-text-secondary hover:text-text-primary transition-all"
                  >
                    {showApiKey ? '隐藏' : '显示'}
                  </button>
                </div>
                <p className="text-[9px] text-text-muted mt-1">
                  密钥保存在当前系统用户的安全凭据库中，不写入配置文件
                </p>
              </div>

            {/* OpenAI-compat base URL */}
            {llmConfig.provider !== 'gemini' && (
              <div className="space-y-1">
                <label className={labelCls}>接口地址</label>
                <input
                  type="text"
                  value={llmConfig.base_url ?? ''}
                  onChange={(e) => setLlmConfigState(prev => ({ ...prev, base_url: e.target.value }))}
                  placeholder="https://api.deepseek.com"
                  className={inputCls}
                />
              </div>
            )}
          </div>

          {/* Test msg */}
          {llmTestMsg && (
            <div className={`p-2.5 rounded-lg text-[10px] font-mono border ${llmTestState === 'ok' ? 'bg-success/10 border-success/20 text-success' : 'bg-error/10 border-error/20 text-error'}`}>
              {llmTestMsg}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={handleTestLlm}
              disabled={llmTestState === 'testing'}
              className="h-8 px-4 rounded-lg bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-all duration-200 disabled:opacity-40"
            >
              {llmTestState === 'testing'
                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                : <Zap className="w-3.5 h-3.5" />}
              {llmTestState === 'testing' ? '测试中...' : '测试并保存配置'}
            </button>
          </div>
        </div>

        {/* ─── Section 2: Chrome CDP ─── */}
        <div className="p-5 rounded-xl border border-border bg-surface-1/70 space-y-4 glow">
          <div className="flex items-center gap-2.5 pb-3 border-b border-border">
            <Sliders className="w-4 h-4 text-brand-400" />
            <h3 className="text-xs font-bold text-text-primary">浏览器 CDP 控制（SSO 绕过）</h3>
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <label className={labelCls}>CDP 远程调试端口</label>
              <div className="flex gap-2">
                <input type="text" value={cdpPort} onChange={(e) => setCdpPort(e.target.value)} className={`${inputCls} w-24`} />
                <button
                  onClick={handleLaunchChrome}
                  disabled={chromeLaunchState === 'testing'}
                  className="flex-1 h-8 px-3 rounded-lg bg-surface-3 hover:bg-brand-500/10 border border-border hover:border-brand-500/30 text-text-primary hover:text-brand-400 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 whitespace-nowrap"
                >
                  {chromeLaunchState === 'testing' ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Globe className="w-3.5 h-3.5 text-[#4285F4]" />
                  )}
                  一键启动受控浏览器
                </button>
              </div>
              
              {/* 启动状态 / 消息 */}
              {chromeLaunchMsg && (
                <div className={`mt-2 p-2.5 rounded-lg text-[10px] font-mono leading-relaxed border ${chromeLaunchState === 'ok' ? 'bg-success/10 border-success/20 text-success' : 'bg-error/10 border-error/20 text-error whitespace-pre-wrap'}`}>
                  {chromeLaunchMsg}
                </div>
              )}

              <p className="text-[9px] text-text-muted mt-1 leading-relaxed">
                手动启动命令：<code className="bg-surface-3 px-1 rounded">chrome.exe --remote-debugging-port={cdpPort}</code>
              </p>
            </div>
            <div className="space-y-1">
              <label className={labelCls}>浏览器登录态目录</label>
              <input
                type="text"
                value={chromeProfile}
                onChange={(e) => {
                  setChromeProfile(e.target.value);
                  setStatus(prev => ({ ...prev, activeProfile: e.target.value }));
                }}
                className={inputCls}
              />
              <p className="text-[9px] text-text-muted mt-1 leading-relaxed">
                加载此目录中的 Session 以继承 SSO 登录态，完美绕过手机 MFA 验证
              </p>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-2 border border-border">
              <div>
                <span className="text-xs font-bold text-text-primary block">隔离沙盒模式</span>
                <span className="text-[9px] text-text-muted leading-relaxed block mt-0.5">
                  复制 Profile 到临时目录执行，防止锁冲突
                </span>
              </div>
              <input
                type="checkbox"
                checked={isolatedMode}
                onChange={(e) => setIsolatedMode(e.target.checked)}
                className="w-4 h-4 rounded accent-brand-500 cursor-pointer"
              />
            </div>
          </div>
        </div>

        <div className="p-5 rounded-xl border border-border bg-surface-1/70 space-y-4 glow col-span-full">
          <div className="flex items-start justify-between gap-4 pb-3 border-b border-border">
            <div className="flex items-center gap-2.5">
              <Shield className="w-4 h-4 text-brand-400" />
              <div>
                <h3 className="text-xs font-bold text-text-primary">数据安全模式</h3>
                <p className="text-[10px] text-text-muted mt-0.5">
                  人事测试环境也可能包含员工敏感信息。默认在发送给大模型前脱敏页面文本、需求、用例和报告摘要。
                </p>
              </div>
            </div>
            <span className="rounded-lg border border-success/20 bg-success/10 px-2.5 py-1 text-[10px] text-success">
              当前：{securityModeLabel(securityConfig.mode)}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {([
              ['strict_redaction', '严格脱敏', '默认推荐。云端模型不会收到姓名、手机号、身份证、薪资、部门等原始值。'],
              ['local_model_first', '本地模型优先', '适合 Ollama 或内网模型；仍会脱敏，但提示用户优先使用本地/私有模型。'],
              ['cloud_enhanced', '云端模型增强', '为提升智能效果允许更多原始上下文，仅建议在确认无真实员工数据时使用。'],
            ] as Array<[DataSecurityMode, string, string]>).map(([mode, title, desc]) => (
              <button
                key={mode}
                onClick={() => updateSecurityConfig({ mode })}
                className={`rounded-xl border p-3 text-left transition-all ${
                  securityConfig.mode === mode
                    ? 'border-brand-500/40 bg-brand-500/10 text-brand-400'
                    : 'border-border bg-surface-2/60 text-text-secondary hover:border-brand-500/30'
                }`}
              >
                <div className="text-xs font-bold">{title}</div>
                <div className="text-[10px] leading-relaxed mt-1 text-text-muted">{desc}</div>
              </button>
            ))}
          </div>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/60 p-3">
            <div>
              <span className="text-xs font-bold text-text-primary block">允许报告保存真实截图</span>
              <span className="text-[10px] text-text-muted leading-relaxed">
                默认关闭。截图可能包含员工姓名、薪资、身份证等信息，建议只在本地私有模型或完全脱敏测试数据时开启。
              </span>
            </div>
            <input
              type="checkbox"
              checked={securityConfig.allowRawScreenshots}
              onChange={(event) => updateSecurityConfig({ allowRawScreenshots: event.target.checked })}
              className="w-4 h-4 rounded accent-brand-500 cursor-pointer"
            />
          </label>
        </div>

        <div className="p-5 rounded-xl border border-border bg-surface-1/70 space-y-4 glow col-span-full">
          <div className="flex items-start justify-between gap-4 pb-3 border-b border-border">
            <div className="flex items-center gap-2.5">
              <Database className="w-4 h-4 text-brand-400" />
              <div>
                <h3 className="text-xs font-bold text-text-primary">数据存储说明</h3>
                <p className="text-[10px] text-text-muted mt-0.5">
                  所有业务数据都保存在本机；普通用户也可以在这里确认自己的测试报告文件位置。
                </p>
              </div>
            </div>
            <button
              className="h-8 px-3 rounded-lg bg-surface-2 hover:bg-brand-500/10 border border-border hover:border-brand-500/30 text-text-secondary hover:text-brand-400 text-[11px] font-semibold flex items-center gap-1.5 transition-all"
              onClick={async () => {
                try {
                  await invoke('open_app_data_dir');
                  setStorageMsg('已打开应用数据目录。');
                } catch (reason) {
                  setStorageMsg(String(reason));
                }
              }}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              打开数据目录
            </button>
          </div>

          {storageMsg && (
            <div className="rounded-lg border border-info/20 bg-info/10 px-3 py-2 text-[10px] text-info">
              {storageMsg}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-surface-2/60 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-text-primary">
                <FileText className="w-3.5 h-3.5 text-brand-400" />
                当前用户测试报告
              </div>
              <div className="text-[10px] text-text-muted leading-relaxed">报告按登录用户隔离保存，其他用户看不到你的报告。</div>
              <code className="block rounded-md bg-surface-3 px-2 py-1.5 text-[10px] text-text-secondary break-all">
                {storageLocations?.currentUserReportPath || '正在读取...'}
              </code>
            </div>

            <div className="rounded-lg border border-border bg-surface-2/60 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-text-primary">
                <Database className="w-3.5 h-3.5 text-brand-400" />
                用户列表与密码摘要
              </div>
              <div className="text-[10px] text-text-muted leading-relaxed">用户、角色、禁用状态和 Argon2id 密码摘要保存在本地 SQLite。</div>
              <code className="block rounded-md bg-surface-3 px-2 py-1.5 text-[10px] text-text-secondary break-all">
                {storageLocations?.usersDbPath || '正在读取...'}
              </code>
            </div>

            <div className="rounded-lg border border-border bg-surface-2/60 p-3 space-y-2">
              <div className="text-[11px] font-bold text-text-primary">模型密钥</div>
              <div className="text-[10px] text-text-muted leading-relaxed">
                API Key 不写入 SQLite、localStorage、日志或报告，只保存在系统凭据库。
              </div>
              <div className="rounded-md bg-surface-3 px-2 py-1.5 text-[10px] text-text-secondary break-all">
                service: {storageLocations?.credentialService || 'com.logicguard.ai'}<br />
                account: {storageLocations?.credentialAccount || currentUser.id}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-surface-2/60 p-3 space-y-2">
              <div className="text-[11px] font-bold text-text-primary">模板、模型配置和浏览器 Profile</div>
              <div className="text-[10px] text-text-muted leading-relaxed">
                模板、模型名称、Base URL 和 CDP 端口在 WebView localStorage 中按用户隔离；浏览器登录态在独立 Profile 目录。
              </div>
              <code className="block rounded-md bg-surface-3 px-2 py-1.5 text-[10px] text-text-secondary break-all">
                {storageLocations?.chromeProfileDir || '正在读取...'}
              </code>
            </div>
          </div>

          <div className="rounded-lg border border-warning/15 bg-warning/5 px-3 py-2 text-[10px] text-warning leading-relaxed">
            卸载或升级前如果要保留账号、报告和浏览器登录态，请不要手动删除上面的应用数据目录；API Key 位于系统凭据库，需要在 Windows Credential Manager 或 macOS Keychain 中单独管理。
          </div>
        </div>

        {currentUser.role === 'admin' && <TestAccountsPanel canManage />}

        {currentUser.role === 'admin' && (
          <div className="p-5 rounded-xl border border-border bg-surface-1/70 space-y-4 glow col-span-full">
            <div className="flex items-start justify-between gap-4 pb-3 border-b border-border">
              <div className="flex items-center gap-2.5">
                <Users className="w-4 h-4 text-brand-400" />
                <div>
                  <h3 className="text-xs font-bold text-text-primary">本地用户列表与管理</h3>
                  <p className="text-[10px] text-text-muted mt-0.5">
                    管理员可创建用户、禁用账号和重置密码；权限控制列已预留，后续可扩展角色/功能授权。
                  </p>
                </div>
              </div>
              <div className="flex gap-2 text-[10px] shrink-0">
                <span className="px-2 py-1 rounded-md bg-success/10 text-success border border-success/20">启用 {activeUsers.length}</span>
                <span className="px-2 py-1 rounded-md bg-surface-2 text-text-muted border border-border">禁用 {disabledUsers.length}</span>
                <span className="px-2 py-1 rounded-md bg-brand-500/10 text-brand-400 border border-brand-500/20">总计 {users.length}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto] gap-2">
              <input className={`${inputCls} min-w-40`} placeholder="新用户名（至少 3 位）" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
              <input className={`${inputCls} min-w-40`} type="password" placeholder="初始密码（至少 8 位）" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <button className="h-9 px-4 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold flex items-center justify-center gap-1.5" onClick={async () => {
                try {
                  await createUser(newUsername, newPassword);
                  setUsers(await listUsers());
                  setNewUsername(''); setNewPassword('');
                } catch (reason) { window.alert(String(reason)); }
              }}>
                <UserPlus className="w-3.5 h-3.5" />
                创建用户
              </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-surface-2/60">
              <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr_1fr_1.2fr] gap-3 px-3 py-2 border-b border-border bg-surface-3/40 text-[10px] font-semibold text-text-muted uppercase">
                <span>用户</span>
                <span>角色</span>
                <span>状态</span>
                <span>权限</span>
                <span className="text-right">操作</span>
              </div>
              <div className="divide-y divide-border">
                {users.length === 0 && (
                  <div className="px-3 py-6 text-center text-xs text-text-muted">暂无用户</div>
                )}
                {users.map((user) => (
                  <div key={user.id} className={`grid grid-cols-[1.2fr_0.8fr_0.8fr_1fr_1.2fr] gap-3 items-center px-3 py-2.5 text-xs ${user.disabled ? 'opacity-55' : ''}`}>
                    <div className="min-w-0">
                      <div className="font-semibold text-text-primary truncate">
                        {user.username}
                        {user.id === currentUser.id && <span className="ml-2 text-[9px] text-brand-400">当前登录</span>}
                      </div>
                      <div className="text-[9px] text-text-muted font-mono truncate">{user.id}</div>
                    </div>
                    <span className={`w-fit px-2 py-1 rounded-md border text-[10px] ${user.role === 'admin' ? 'bg-brand-500/10 text-brand-400 border-brand-500/20' : 'bg-surface-1 text-text-secondary border-border'}`}>
                      {user.role === 'admin' ? '管理员' : '普通用户'}
                    </span>
                    <span className={`w-fit px-2 py-1 rounded-md border text-[10px] ${user.disabled ? 'bg-error/10 text-error border-error/20' : 'bg-success/10 text-success border-success/20'}`}>
                      {user.disabled ? '已禁用' : '启用中'}
                    </span>
                    <span className="text-[10px] text-text-muted flex items-center gap-1.5">
                      <LockKeyhole className="w-3 h-3" />
                      基础权限
                    </span>
                    <div className="flex justify-end gap-2">
                      {user.id !== currentUser.id && !user.disabled && (
                        <>
                          <button className="px-2 py-1 rounded-md border border-border text-[10px] text-brand-400 hover:bg-brand-500/10" onClick={async () => {
                            const password = window.prompt(`为 ${user.username} 设置新密码（至少 8 位）`);
                            if (password) await resetUserPassword(user.id, password).catch((reason) => window.alert(String(reason)));
                          }}>重置密码</button>
                          <button className="px-2 py-1 rounded-md border border-error/20 text-[10px] text-error hover:bg-error/10" onClick={async () => {
                            if (window.confirm(`确认禁用 ${user.username}？禁用后该用户将不能登录。`)) { await disableUser(user.id); setUsers(await listUsers()); }
                          }}>禁用</button>
                        </>
                      )}
                      {user.id === currentUser.id && <span className="text-[10px] text-text-muted">不可操作当前账号</span>}
                      {user.disabled && <span className="text-[10px] text-text-muted">已禁用</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {showLegacyUserPanel && currentUser.role === 'admin' && (
          <div className="p-5 rounded-xl border border-border bg-surface-1/70 space-y-4 glow col-span-full">
            <div className="flex items-center gap-2.5 pb-3 border-b border-border">
              <Shield className="w-4 h-4 text-brand-400" />
              <h3 className="text-xs font-bold text-text-primary">本地用户管理</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <input className={`${inputCls} flex-1 min-w-40`} placeholder="新用户名" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
              <input className={`${inputCls} flex-1 min-w-40`} type="password" placeholder="初始密码（至少 8 位）" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <button className="h-9 px-4 rounded-lg bg-brand-500 text-white text-xs font-semibold" onClick={async () => {
                try {
                  await createUser(newUsername, newPassword);
                  setUsers(await listUsers());
                  setNewUsername(''); setNewPassword('');
                } catch (reason) { window.alert(String(reason)); }
              }}>创建用户</button>
            </div>
            <div className="space-y-2">
              {users.map((user) => <div key={user.id} className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2">
                <span className="text-xs text-text-primary">{user.username} <span className="text-text-muted">({user.role})</span></span>
                {user.id !== currentUser.id && <div className="flex gap-2">
                  <button className="text-[10px] text-brand-400" onClick={async () => {
                    const password = window.prompt(`为 ${user.username} 设置新密码（至少 8 位）`);
                    if (password) await resetUserPassword(user.id, password).catch((reason) => window.alert(String(reason)));
                  }}>重置密码</button>
                  <button className="text-[10px] text-error" onClick={async () => {
                    if (window.confirm(`确认禁用 ${user.username}？`)) { await disableUser(user.id); setUsers(await listUsers()); }
                  }}>禁用</button>
                </div>}
              </div>)}
            </div>
          </div>
        )}

        {/* ─── Section 4: Cloud fallback note ─── */}
        <div className="p-5 rounded-xl border border-border bg-surface-1/70 space-y-3 glow col-span-full">
          <div className="flex items-center gap-2.5 pb-3 border-b border-border">
            <Shield className="w-4 h-4 text-brand-400" />
            <h3 className="text-xs font-bold text-text-primary">降级兜底策略</h3>
          </div>
          <div className="p-3 rounded-lg bg-info/10 border border-info/20">
            <p className="text-[10px] text-info leading-relaxed">
              💡 当前版本使用用户自行配置的云端模型，不依赖 PocketBase、Tailscale 或本地模型服务。
            </p>
          </div>
          <div className="p-3 rounded-lg bg-warning/5 border border-warning/15">
            <p className="text-[10px] text-warning leading-relaxed">
              ⚠️ API 密钥安全：密钥保存在 Windows Credential Manager 或 macOS Keychain，并按当前登录用户隔离。
            </p>
          </div>
        </div>

      </div>
    </div>
  );
};
export default Settings;
