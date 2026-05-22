import React, { useState } from 'react';
import { Cpu, Database, Sliders, Shield, RefreshCw } from 'lucide-react';
import type { SystemStatus } from '../types';

interface SettingsProps {
  status: SystemStatus;
  setStatus: React.Dispatch<React.SetStateAction<SystemStatus>>;
}

export const Settings: React.FC<SettingsProps> = ({ status, setStatus }) => {
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [dbUrl, setDbUrl] = useState('http://localhost:8090');
  const [chromeProfile, setChromeProfile] = useState('C:/Users/Administrator/AppData/Local/Google/Chrome/User Data');
  const [gptKey, setGptKey] = useState('sk-proj-************************');
  const [activeModel, setActiveModel] = useState(status.activeModel);
  const [isTestingOllama, setIsTestingOllama] = useState(false);
  const [isTestingDb, setIsTestingDb] = useState(false);

  const handleTestOllama = async () => {
    setIsTestingOllama(true);
    await new Promise((r) => setTimeout(r, 1200));
    setIsTestingOllama(false);
    setStatus(prev => ({ ...prev, ollama: 'connected' }));
  };

  const handleTestDb = async () => {
    setIsTestingDb(true);
    await new Promise((r) => setTimeout(r, 1000));
    setIsTestingDb(false);
    setStatus(prev => ({ ...prev, pocketbase: 'connected' }));
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent overflow-y-auto p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-text-primary">系统配置面板</h2>
        <p className="text-xs text-text-muted">管理您的本地算力节点、浏览器环境配置、同步服务及云端备份通道</p>
      </div>

      {/* Settings Sections Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Section 1: Ollama Model settings */}
        <div className="p-5 rounded-xl border border-border bg-surface-1/70 space-y-4 glow">
          <div className="flex items-center gap-2.5 pb-3 border-b border-border">
            <Cpu className="w-4 h-4 text-brand-400" />
            <h3 className="text-xs font-bold text-text-primary">AI 算力中心配置 (Ollama)</h3>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] text-text-secondary font-semibold uppercase block">Ollama 服务端点</label>
              <input
                type="text"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-surface-2 border border-border focus:border-brand-500 text-xs text-text-primary font-mono outline-none transition-all duration-200"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-text-secondary font-semibold uppercase block">本地主推理大模型</label>
              <select
                value={activeModel}
                onChange={(e) => {
                  setActiveModel(e.target.value);
                  setStatus(prev => ({ ...prev, activeModel: e.target.value }));
                }}
                className="w-full h-9 px-3 rounded-lg bg-surface-2 border border-border focus:border-brand-500 text-xs text-text-primary outline-none transition-all duration-200"
              >
                <option value="qwen2.5:7b">qwen2.5:7b (推荐本地推理模型)</option>
                <option value="deepseek-v3">deepseek-v3 (高难度任务推理)</option>
                <option value="llama3.1:8b">llama3.1:8b (通用基础模型)</option>
              </select>
            </div>

            <button
              onClick={handleTestOllama}
              disabled={isTestingOllama}
              className="h-8 px-4 rounded-lg bg-surface-2 hover:bg-surface-3 border border-border hover:border-border-hover text-text-primary text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 disabled:opacity-40"
            >
              {isTestingOllama ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              测试 Ollama 通信连接
            </button>
          </div>
        </div>

        {/* Section 2: Browser Persistent Profile */}
        <div className="p-5 rounded-xl border border-border bg-surface-1/70 space-y-4 glow">
          <div className="flex items-center gap-2.5 pb-3 border-b border-border">
            <Sliders className="w-4 h-4 text-brand-400" />
            <h3 className="text-xs font-bold text-text-primary">浏览器控制与 SSO 穿透环境</h3>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] text-text-secondary font-semibold uppercase block">Chrome 用户配置路径 (Profile Path)</label>
              <input
                type="text"
                value={chromeProfile}
                onChange={(e) => {
                  setChromeProfile(e.target.value);
                  setStatus(prev => ({ ...prev, activeProfile: e.target.value }));
                }}
                className="w-full h-9 px-3 rounded-lg bg-surface-2 border border-border focus:border-brand-500 text-xs text-text-primary font-mono outline-none transition-all duration-200"
              />
              <span className="text-[9px] text-text-muted block mt-1 leading-relaxed">
                Tauri 执行端将无缝加载此目录中的 Session 以继承登录态，绕过扫码和手机 MFA 验证
              </span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-2 border border-border">
              <div>
                <span className="text-xs font-bold text-text-primary block">隔离运行模式</span>
                <span className="text-[9px] text-text-muted leading-relaxed block mt-0.5">
                  开启后复制 Profile 到临时沙盒执行，防止锁冲突
                </span>
              </div>
              <input type="checkbox" defaultChecked className="w-4 h-4 rounded text-brand-500 bg-surface-2 border-border focus:ring-0 outline-none cursor-pointer" />
            </div>
          </div>
        </div>

        {/* Section 3: PocketBase DB endpoints */}
        <div className="p-5 rounded-xl border border-border bg-surface-1/70 space-y-4 glow">
          <div className="flex items-center gap-2.5 pb-3 border-b border-border">
            <Database className="w-4 h-4 text-brand-400" />
            <h3 className="text-xs font-bold text-text-primary">本地轻量存储中心 (PocketBase)</h3>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] text-text-secondary font-semibold uppercase block">后端数据库端点</label>
              <input
                type="text"
                value={dbUrl}
                onChange={(e) => setDbUrl(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-surface-2 border border-border focus:border-brand-500 text-xs text-text-primary font-mono outline-none transition-all duration-200"
              />
            </div>

            <button
              onClick={handleTestDb}
              disabled={isTestingDb}
              className="h-8 px-4 rounded-lg bg-surface-2 hover:bg-surface-3 border border-border hover:border-border-hover text-text-primary text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 disabled:opacity-40"
            >
              {isTestingDb ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              测试 PocketBase 联通性
            </button>
          </div>
        </div>

        {/* Section 4: Cloud fallback */}
        <div className="p-5 rounded-xl border border-border bg-surface-1/70 space-y-4 glow">
          <div className="flex items-center gap-2.5 pb-3 border-b border-border">
            <Shield className="w-4 h-4 text-brand-400" />
            <h3 className="text-xs font-bold text-text-primary">云端大模型降级兜底网关</h3>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] text-text-secondary font-semibold uppercase block">OpenAI / GPT-4o 秘钥</label>
              <input
                type="password"
                value={gptKey}
                onChange={(e) => setGptKey(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-surface-2 border border-border focus:border-brand-500 text-xs text-text-primary font-mono outline-none transition-all duration-200"
              />
            </div>

            <div className="p-3 rounded-lg bg-warning/5 border border-warning/15">
              <p className="text-[10px] text-warning leading-relaxed">
                ⚠️ **降级提示**：该秘钥仅在 Healer 自愈引擎处理高难度视觉页面失效时进行降级兜底。主路径操作不会产生云端通信费用。
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
export default Settings;
