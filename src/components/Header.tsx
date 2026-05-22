import React from 'react';
import { Cpu, Database, Network, RefreshCw } from 'lucide-react';
import type { SystemStatus } from '../types';

interface HeaderProps {
  status: SystemStatus;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const Header: React.FC<HeaderProps> = ({ status, onRefresh, isRefreshing }) => {
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
        <h2 className="text-sm font-semibold tracking-wide text-text-primary whitespace-nowrap">全链路分布式自动化引擎</h2>
        <span className="h-4 w-px bg-border shrink-0"></span>
        <div className="flex items-center gap-1 text-[11px] text-text-secondary bg-surface-2 px-2.5 py-1 rounded-md border border-border shrink-0 whitespace-nowrap">
          <span className="status-dot status-dot--online mr-1"></span>
          <span>执行端连接安全</span>
        </div>
      </div>

      <div className="flex items-center gap-6 shrink-0">
        {/* Status indicators */}
        <div className="flex items-center gap-4 bg-surface-0/40 px-3 py-1.5 rounded-lg border border-border shrink-0 whitespace-nowrap">
          {/* Ollama Status */}
          <div className="flex items-center gap-2" title={`AI 推理中心 (${status.activeModel})`}>
            <Cpu className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-[11px] text-text-secondary font-medium">Ollama:</span>
            <span className={`status-dot ${getStatusClass(status.ollama)}`}></span>
            <span className="text-[10px] text-text-muted">{getStatusLabel(status.ollama)}</span>
          </div>

          <span className="h-3 w-px bg-border"></span>

          {/* PocketBase Status */}
          <div className="flex items-center gap-2" title="轻量数据库服务">
            <Database className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-[11px] text-text-secondary font-medium">数据存储:</span>
            <span className={`status-dot ${getStatusClass(status.pocketbase)}`}></span>
            <span className="text-[10px] text-text-muted">{getStatusLabel(status.pocketbase)}</span>
          </div>

          <span className="h-3 w-px bg-border"></span>

          {/* Tailscale Status */}
          <div className="flex items-center gap-2" title="内网穿透安全通道">
            <Network className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-[11px] text-text-secondary font-medium">穿透网关:</span>
            <span className={`status-dot ${getStatusClass(status.tailscale)}`}></span>
            <span className="text-[10px] text-text-muted">{getStatusLabel(status.tailscale)}</span>
          </div>
        </div>

        {/* Refresh button */}
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
