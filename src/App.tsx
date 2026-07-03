import { useState } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Templates } from './pages/Templates';
import { TestCases } from './pages/TestCases';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import type { SystemStatus } from './types';
import { getLlmConfig, isConfigured, testLlmConnection } from './api/llmBridge';
import { checkBrowserConnection } from './api/browserBridge';
import { invoke } from '@tauri-apps/api/core';
import './App.css';
import { AuthGate } from './components/AuthGate';
import type { SessionUser } from './api/auth';

function AuthenticatedApp({ user }: { user: SessionUser }) {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Connection states
  const [status, setStatus] = useState<SystemStatus>({
    llm: 'disconnected',
    browser: 'disconnected',
    sidecar: 'checking',
    activeProfile: 'Default (Admin)',
    activeModel: getLlmConfig().model || 'qwen2.5:7b'
  });

  const handleRefreshStatus = async () => {
    setIsRefreshing(true);
    setStatus(prev => ({
      ...prev,
      llm: 'checking',
      browser: 'checking',
      sidecar: 'checking'
    }));
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
    setIsRefreshing(false);
  };

  const renderActivePage = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'templates':
        return <Templates />;
      case 'templateModeler':
        return <Templates initialView="generate" />;
      case 'testdesign':
        return <TestCases onOpenTemplateModeler={() => setActiveTab('templateModeler')} />;
      case 'testcases':
        return <TestCases onOpenTemplateModeler={() => setActiveTab('templateModeler')} />;
      case 'reports':
        return <Reports />;
      case 'settings':
        return <Settings status={status} setStatus={setStatus} currentUser={user} />;
      default:
        return <Dashboard />;
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
  return <AuthGate>{(user) => <AuthenticatedApp user={user} />}</AuthGate>;
}

export default App;
