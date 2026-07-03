import React from 'react';
import { Cpu, Globe, RefreshCw, Settings } from 'lucide-react';
import type { SystemStatus } from '../types';

interface HeaderProps {
  status: SystemStatus;
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  onRefresh,
  isRefreshing,
  onOpenSettings,
}) => {
  const getStatusClass = (state: 'connected' | 'disconnected' | 'checking') => {
    switch (state) {
      case 'connected':
        return 'status-dot--online';
      case 'disconnected':
        return 'status-dot--offline';
      case 'checking':
      default:
        return 'status-dot--warning';
    }
  };

  const getStatusLabel = (state: 'connected' | 'disconnected' | 'checking') => {
    switch (state) {
      case 'connected':
        return '已连接';
      case 'disconnected':
        return '未连接';
      case 'checking':
      default:
        return '检测中...';
    }
  };

  return (
    <header className="h-16 border border-border rounded-2xl shadow-md bg-surface-1/80 backdrop-blur-md flex items-center justify-between px-6 select-none z-10 shrink-0 overflow-x-auto gap-4">
      <div className="flex items-center gap-3 shrink-0">
        <h2 className="text-sm font-semibold tracking-wide text-text-primary whitespace-nowrap">
          需求到回归的自动化测试助手
        </h2>
        <span className="h-4 w-px bg-border shrink-0" />
        <div className="flex items-center gap-1 text-[11px] text-text-secondary bg-surface-2 px-2.5 py-1 rounded-md border border-border shrink-0 whitespace-nowrap">
          <span className="status-dot status-dot--online mr-1" />
          <span>执行端连接安全</span>
        </div>
      </div>

      <div className="flex items-center gap-4 shrink-0">
        <div className="hidden lg:flex items-center gap-1.5 bg-surface-0/40 px-3 py-1.5 rounded-lg border border-border whitespace-nowrap" title={status.activeModel}>
          <Cpu className="w-3.5 h-3.5 text-text-muted shrink-0" />
          <span className="text-[10px] text-text-muted">当前模型</span>
          <span className="max-w-[190px] truncate font-mono text-[10px] text-brand-400">
            {status.activeModel || '未配置'}
          </span>
        </div>

        <div className="flex items-center gap-4 bg-surface-0/40 px-3 py-1.5 rounded-lg border border-border whitespace-nowrap">
          <div className="flex items-center gap-2" title={`云模型 (${status.activeModel || '未配置'})`}>
            <Cpu className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-[11px] text-text-secondary font-medium">模型:</span>
            <span className={`status-dot ${getStatusClass(status.llm)}`} />
            <span className="text-[10px] text-text-muted">{getStatusLabel(status.llm)}</span>
          </div>

          <span className="h-3 w-px bg-border" />

          <div className="flex items-center gap-2" title="Chrome / Edge CDP 连接">
            <Globe className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-[11px] text-text-secondary font-medium">浏览器:</span>
            <span className={`status-dot ${getStatusClass(status.browser)}`} />
            <span className="text-[10px] text-text-muted">{getStatusLabel(status.browser)}</span>
          </div>
        </div>

        <button
          onClick={onOpenSettings}
          className="h-8 px-3 rounded-lg bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/20 hover:border-brand-500/40 text-brand-400 text-[11px] font-semibold flex items-center gap-1.5 transition-all duration-200 whitespace-nowrap"
          title="打开系统设置，配置模型和浏览器连接"
        >
          <Settings className="w-3.5 h-3.5" />
          去设置
        </button>

        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-2 rounded-lg bg-surface-2 hover:bg-surface-3 border border-border hover:border-border-hover text-text-secondary hover:text-text-primary transition-all duration-200"
          title="重新刷新连接状态"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-brand-400' : ''}`} />
        </button>
      </div>
    </header>
  );
};

export default Header;
