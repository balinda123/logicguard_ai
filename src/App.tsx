import { useCallback, useEffect, useRef, useState } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { TestDesignPage } from './pages/TestDesignPage';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { ExecutionCenter } from './pages/ExecutionCenter';
import { IssueTracker } from './pages/IssueTracker';
import type { SystemStatus } from './types';
import { getLlmConfig, isConfigured, testLlmConnection } from './api/llmBridge';
import { checkBrowserConnection } from './api/browserBridge';
import { invoke } from '@tauri-apps/api/core';
import './App.css';
import { AuthGate } from './components/AuthGate';
import type { SessionUser } from './api/auth';
import { ActiveRunProvider } from './contexts/ActiveRunContext';

function AuthenticatedApp({ user }: { user: SessionUser }) {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const statusRefreshInFlight = useRef(false);

  // Connection states
  const [status, setStatus] = useState<SystemStatus>({
    llm: 'checking',
    browser: 'checking',
    sidecar: 'checking',
    activeProfile: 'Default (Admin)',
    activeModel: getLlmConfig().model
  });

  const handleRefreshStatus = useCallback(async () => {
    if (statusRefreshInFlight.current) return;
    statusRefreshInFlight.current = true;
    setIsRefreshing(true);
    setStatus(prev => ({
      ...prev,
      llm: 'checking',
      browser: 'checking',
      sidecar: 'checking'
    }));
    try {
      const [browser, sidecar, llm] = await Promise.all([
        checkBrowserConnection(),
        invoke<boolean>('browser_check_sidecar').catch(() => false),
        isConfigured() ? testLlmConnection().then((result) => result.ok) : Promise.resolve(false),
      ]);
      setStatus((prev) => ({
        ...prev,
        llm: llm ? 'connected' : 'disconnected',
        browser: browser ? 'connected' : 'disconnected',
        sidecar: sidecar ? 'connected' : 'disconnected',
        activeModel: getLlmConfig().model,
      }));
    } finally {
      statusRefreshInFlight.current = false;
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // 连接状态是当前进程的实时事实，不能沿用上次关闭前的结果；登录后立即并行探测，
    // 让首页无需人工刷新，同时用 in-flight 锁避免开发模式和手动点击造成重复请求。
    void handleRefreshStatus();
  }, [handleRefreshStatus]);

  const renderActivePage = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard onNavigate={setActiveTab} />;
      case 'testdesign':
        return <TestDesignPage canManageAccounts={user.role === 'admin'} onNavigate={setActiveTab} />;
      case 'reports':
        return <Reports onNavigate={setActiveTab} />;
      case 'execution':
        return <ExecutionCenter onNavigate={setActiveTab} />;
      case 'issues':
        return <IssueTracker onNavigate={setActiveTab} />;
      case 'settings':
        return <Settings status={status} setStatus={setStatus} currentUser={user} />;
      default:
        return <Dashboard onNavigate={setActiveTab} />;
    }
  };

  return (
    <Layout
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      status={status}
      onRefresh={handleRefreshStatus}
      isRefreshing={isRefreshing}
    >
      {renderActivePage()}
    </Layout>
  );
}

function App() {
  return <AuthGate>{(user) => <ActiveRunProvider><AuthenticatedApp user={user} /></ActiveRunProvider>}</AuthGate>;
}

export default App;
