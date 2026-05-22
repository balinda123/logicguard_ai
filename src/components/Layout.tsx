import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import type { SystemStatus } from '../types';

interface LayoutProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  status: SystemStatus;
  onRefresh: () => void;
  isRefreshing: boolean;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({
  activeTab,
  setActiveTab,
  status,
  onRefresh,
  isRefreshing,
  children
}) => {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-surface-0 p-4 gap-4">
      {/* Sidebar navigation */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} status={status} />

      {/* Main panel container */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden gap-4">
        {/* Header toolbar */}
        <Header status={status} onRefresh={onRefresh} isRefreshing={isRefreshing} />

        {/* Content area */}
        <main className="flex-1 min-h-0 min-w-0 overflow-hidden relative bg-surface-1 rounded-2xl border border-border shadow-md flex flex-col">
          {children}
        </main>
      </div>
    </div>
  );
};
export default Layout;
