import React from 'react';
import { LayoutDashboard, FileText, BarChart2, Settings, Terminal, ShieldAlert, Cpu } from 'lucide-react';
import type { SystemStatus } from '../types';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  status: SystemStatus;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, status }) => {
  const menuItems = [
    { id: 'dashboard', label: '任务控制台', icon: LayoutDashboard },
    { id: 'templates', label: '场景模板', icon: FileText },
    { id: 'reports', label: '测试报告', icon: BarChart2 },
    { id: 'settings', label: '系统设置', icon: Settings },
  ];

  return (
    <aside className="w-64 border border-border rounded-2xl shadow-md bg-surface-1 flex flex-col h-full animate-slide-in select-none overflow-hidden shrink-0">
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 gap-3 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center glow">
          <Terminal className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-bold text-sm tracking-wide text-text-primary">LogicGuard AI</h1>
          <span className="text-[10px] text-text-muted font-medium uppercase tracking-wider">v1.0.0 Beta</span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 group ${
                isActive
                  ? 'bg-brand-500/10 text-brand-400 border border-brand-500/20'
                  : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary border border-transparent'
              }`}
            >
              <Icon className={`w-4 h-4 transition-transform group-hover:scale-105 ${isActive ? 'text-brand-400' : 'text-text-muted group-hover:text-text-secondary'}`} />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Connection & Run Info Footer */}
      <div className="p-4 border-t border-border bg-surface-0/50 space-y-3">
        <div className="p-3 rounded-lg bg-surface-2/60 border border-border space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text-muted flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5" /> 本地模型:
            </span>
            <span className="font-mono text-brand-400 font-medium max-w-[100px] truncate" title={status.activeModel}>
              {status.activeModel}
            </span>
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text-muted flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" /> Chrome 配置:
            </span>
            <span className="text-text-secondary font-medium truncate max-w-[100px]" title={status.activeProfile}>
              {status.activeProfile}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
};
export default Sidebar;
