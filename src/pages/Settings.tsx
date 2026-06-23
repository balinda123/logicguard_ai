import React, { useState, useEffect } from 'react';
import { Cpu, Sliders, Shield, RefreshCw, CheckCircle, XCircle, Key, Zap, Globe } from 'lucide-react';
import type { SystemStatus } from '../types';
import { getLlmConfig, setLlmConfig, testLlmConnection } from '../api/llmBridge';
import type { LlmConfig } from '../api/llmBridge';
import { invoke } from '@tauri-apps/api/core';
import { createUser, disableUser, getCredentialStatus, listUsers, resetUserPassword, saveApiKey, type SessionUser } from '../api/auth';
import { getCdpPort, setCdpPort as saveCdpPort } from '../api/browserBridge';

interface SettingsProps {
  status: SystemStatus;
  setStatus: React.Dispatch<React.SetStateAction<SystemStatus>>;
  currentUser: SessionUser;
}

type TestState = 'idle' | 'testing' | 'ok' | 'error';

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

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent overflow-y-auto p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-text-primary">系统配置面板</h2>
        <p className="text-xs text-text-muted">管理云端 AI 模型、浏览器 CDP 和本地用户配置</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ─── Section 1: AI Model Provider ─── */}
        <div className="p-5 rounded-xl border border-border bg-surface-1/70 space-y-4 glow col-span-full">
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
              <label className={labelCls}>模型提供商</label>
              <select
                value={llmConfig.provider}
                onChange={(e) => setLlmConfigState(prev => ({
                  ...prev,
                  provider: e.target.value as LlmConfig['provider'],
                  model: e.target.value === 'gemini' ? 'gemini-2.0-flash'
                    : 'deepseek-chat'
                }))}
                className={inputCls}
              >
                <option value="gemini">Google Gemini API（公司推荐）</option>
                <option value="openai_compat">OpenAI 兼容接口（DeepSeek/Qwen 等）</option>
              </select>
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
                    placeholder={llmConfig.credential_configured ? '已安全保存；留空表示不修改' : llmConfig.provider === 'gemini' ? 'AIza...' : 'sk-...'}
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
            {llmConfig.provider === 'openai_compat' && (
              <div className="space-y-1">
                <label className={labelCls}>API Base URL</label>
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
              <label className={labelCls}>Chrome Profile 路径</label>
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

        {currentUser.role === 'admin' && (
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
