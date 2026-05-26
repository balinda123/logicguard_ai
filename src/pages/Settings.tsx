import React, { useState, useEffect } from 'react';
import { Cpu, Database, Sliders, Shield, RefreshCw, CheckCircle, XCircle, Key, Zap, Globe, Play } from 'lucide-react';
import type { SystemStatus } from '../types';
import { getLlmConfig, setLlmConfig, testLlmConnection } from '../api/llmBridge';
import type { LlmConfig } from '../api/llmBridge';
import { invoke } from '@tauri-apps/api/core';

interface SettingsProps {
  status: SystemStatus;
  setStatus: React.Dispatch<React.SetStateAction<SystemStatus>>;
}

type TestState = 'idle' | 'testing' | 'ok' | 'error';

export const Settings: React.FC<SettingsProps> = ({ status, setStatus }) => {
  const [llmConfig, setLlmConfigState] = useState<LlmConfig>(getLlmConfig());
  const [showApiKey, setShowApiKey] = useState(false);
  const [llmTestState, setLlmTestState] = useState<TestState>('idle');
  const [llmTestMsg, setLlmTestMsg] = useState('');

  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [dbUrl, setDbUrl] = useState('http://localhost:8090');
  const [cdpPort, setCdpPort] = useState('9222');
  const [chromeProfile, setChromeProfile] = useState(status.activeProfile);
  const [isolatedMode, setIsolatedMode] = useState(true);
  const [isTestingDb, setIsTestingDb] = useState(false);
  const [dbTestState, setDbTestState] = useState<TestState>('idle');

  // Chrome CDP 一键启动状态
  const [chromeLaunchState, setChromeLaunchState] = useState<TestState>('idle');
  const [chromeLaunchMsg, setChromeLaunchMsg] = useState('');
  const [cdpConnected, setCdpConnected] = useState(false);

  // 检查 CDP 连接状态
  const checkCdpConnection = async () => {
    try {
      const connected = await invoke<boolean>('browser_check_connection', { port: parseInt(cdpPort) });
      setCdpConnected(connected);
      if (connected) setStatus(prev => ({ ...prev, tailscale: 'connected' }));
      else setStatus(prev => ({ ...prev, tailscale: 'disconnected' }));
    } catch {
      setCdpConnected(false);
    }
  };

  // 一键启动 Chrome CDP
  const handleLaunchChrome = async () => {
    setChromeLaunchState('testing');
    setChromeLaunchMsg('');
    try {
      const msg = await invoke<string>('launch_chrome_cdp', {
        port: parseInt(cdpPort),
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


  // Sync ollama URL into llmConfig when provider is ollama
  useEffect(() => {
    if (llmConfig.provider === 'ollama') {
      setLlmConfigState(prev => ({ ...prev, base_url: ollamaUrl }));
    }
  }, [ollamaUrl, llmConfig.provider]);

  const handleSaveLlmConfig = () => {
    const cfg = llmConfig.provider === 'ollama'
      ? { ...llmConfig, base_url: ollamaUrl }
      : llmConfig;
    setLlmConfig(cfg);
  };

  const handleTestLlm = async () => {
    setLlmTestState('testing');
    setLlmTestMsg('');
    handleSaveLlmConfig();
    const result = await testLlmConnection(llmConfig);
    setLlmTestState(result.ok ? 'ok' : 'error');
    setLlmTestMsg(result.message);
    if (result.ok) {
      setStatus(prev => ({ ...prev, ollama: 'connected' }));
    } else {
      setStatus(prev => ({ ...prev, ollama: 'disconnected' }));
    }
  };

  const handleTestDb = async () => {
    setIsTestingDb(true);
    setDbTestState('testing');
    try {
      const resp = await fetch(`${dbUrl}/api/health`);
      if (resp.ok) {
        setDbTestState('ok');
        setStatus(prev => ({ ...prev, pocketbase: 'connected' }));
      } else {
        setDbTestState('error');
        setStatus(prev => ({ ...prev, pocketbase: 'disconnected' }));
      }
    } catch {
      setDbTestState('error');
      setStatus(prev => ({ ...prev, pocketbase: 'disconnected' }));
    }
    setIsTestingDb(false);
  };

  const inputCls = 'w-full h-9 px-3 rounded-lg bg-surface-2 border border-border focus:border-brand-500 text-xs text-text-primary font-mono outline-none transition-all duration-200';
  const labelCls = 'text-[10px] text-text-secondary font-semibold uppercase block mb-1';

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent overflow-y-auto p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-text-primary">系统配置面板</h2>
        <p className="text-xs text-text-muted">管理 AI 模型接入、浏览器 CDP 控制、PocketBase 数据存储等核心配置</p>
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
                    : e.target.value === 'ollama' ? 'qwen2.5:7b'
                    : 'deepseek-chat'
                }))}
                className={inputCls}
              >
                <option value="gemini">Google Gemini API（公司推荐）</option>
                <option value="ollama">本地 Ollama（家里/离线）</option>
                <option value="openai_compat">OpenAI 兼容接口（DeepSeek/Qwen 等）</option>
              </select>
            </div>

            {/* Model name */}
            <div className="space-y-1">
              <label className={labelCls}>模型名称</label>
              {llmConfig.provider === 'ollama' ? (
                <select
                  value={llmConfig.model}
                  onChange={(e) => setLlmConfigState(prev => ({ ...prev, model: e.target.value }))}
                  className={inputCls}
                >
                  <option value="qwen2.5:7b">qwen2.5:7b（推荐）</option>
                  <option value="deepseek-r1:7b">deepseek-r1:7b</option>
                  <option value="llama3.1:8b">llama3.1:8b</option>
                </select>
              ) : (
                <input
                  type="text"
                  value={llmConfig.model}
                  onChange={(e) => setLlmConfigState(prev => ({ ...prev, model: e.target.value }))}
                  placeholder={llmConfig.provider === 'gemini' ? 'gemini-2.0-flash' : 'deepseek-chat'}
                  className={inputCls}
                />
              )}
            </div>

            {/* API Key (not needed for Ollama) */}
            {llmConfig.provider !== 'ollama' && (
              <div className="space-y-1 sm:col-span-2">
                <label className={labelCls}>
                  <Key className="w-3 h-3 inline mr-1" />
                  API 密钥
                </label>
                <div className="flex gap-2">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={llmConfig.api_key ?? ''}
                    onChange={(e) => setLlmConfigState(prev => ({ ...prev, api_key: e.target.value }))}
                    placeholder={llmConfig.provider === 'gemini' ? 'AIza...' : 'sk-...'}
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
                  密钥仅存储在本地 localStorage，不会上传到任何服务器
                </p>
              </div>
            )}

            {/* Ollama URL */}
            {llmConfig.provider === 'ollama' && (
              <div className="space-y-1">
                <label className={labelCls}>Ollama 服务地址</label>
                <input
                  type="text"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  className={inputCls}
                />
              </div>
            )}

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

        {/* ─── Section 3: PocketBase ─── */}
        <div className="p-5 rounded-xl border border-border bg-surface-1/70 space-y-4 glow">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-2.5">
              <Database className="w-4 h-4 text-brand-400" />
              <h3 className="text-xs font-bold text-text-primary">PocketBase 数据存储</h3>
            </div>
            {dbTestState === 'ok' && <span className="flex items-center gap-1 text-[10px] text-success"><CheckCircle className="w-3 h-3" /> 已连接</span>}
            {dbTestState === 'error' && <span className="flex items-center gap-1 text-[10px] text-error"><XCircle className="w-3 h-3" /> 未连接</span>}
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className={labelCls}>数据库端点</label>
              <input
                type="text"
                value={dbUrl}
                onChange={(e) => setDbUrl(e.target.value)}
                className={inputCls}
              />
              <p className="text-[9px] text-text-muted mt-1">
                家里 PC 已配置。公司环境若未开机，任务报告将暂存本地。
              </p>
            </div>
            <button
              onClick={handleTestDb}
              disabled={isTestingDb}
              className="h-8 px-4 rounded-lg bg-surface-2 hover:bg-surface-3 border border-border hover:border-border-hover text-text-primary text-xs font-semibold flex items-center gap-1.5 transition-all duration-200 disabled:opacity-40"
            >
              {isTestingDb ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              测试 PocketBase 连通性
            </button>
          </div>
        </div>

        {/* ─── Section 4: Cloud fallback note ─── */}
        <div className="p-5 rounded-xl border border-border bg-surface-1/70 space-y-3 glow col-span-full">
          <div className="flex items-center gap-2.5 pb-3 border-b border-border">
            <Shield className="w-4 h-4 text-brand-400" />
            <h3 className="text-xs font-bold text-text-primary">降级兜底策略</h3>
          </div>
          <div className="p-3 rounded-lg bg-info/10 border border-info/20">
            <p className="text-[10px] text-info leading-relaxed">
              💡 当前策略：<strong>Gemini API (云端)</strong> 为主推理引擎。回到家后切换"模型提供商"为 Ollama 即可无缝改为本地推理，所有 Prompt 模板完全兼容，无需修改任何代码。
            </p>
          </div>
          <div className="p-3 rounded-lg bg-warning/5 border border-warning/15">
            <p className="text-[10px] text-warning leading-relaxed">
              ⚠️ API 密钥安全：密钥存储在浏览器 localStorage 中，通过 Tauri Rust 后端中转请求，前端代码中不直接暴露密钥给任何第三方脚本。
            </p>
          </div>
        </div>

      </div>
    </div>
  );
};
export default Settings;
