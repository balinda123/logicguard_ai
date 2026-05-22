import { useState } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Templates } from './pages/Templates';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import type { SystemStatus } from './types';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Connection states
  const [status, setStatus] = useState<SystemStatus>({
    ollama: 'connected',
    pocketbase: 'connected',
    tailscale: 'connected',
    activeProfile: 'Default (Admin)',
    activeModel: 'qwen2.5:7b'
  });

  const handleRefreshStatus = async () => {
    setIsRefreshing(true);
    // Simulate checking connection statuses
    setStatus(prev => ({
      ...prev,
      ollama: 'checking',
      pocketbase: 'checking',
      tailscale: 'checking'
    }));

    await new Promise((r) => setTimeout(r, 1500));

    setStatus({
      ollama: 'connected',
      pocketbase: 'connected',
      tailscale: 'connected',
      activeProfile: 'Default (Admin)',
      activeModel: status.activeModel
    });
    setIsRefreshing(false);
  };

  const renderActivePage = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'templates':
        return <Templates />;
      case 'reports':
        return <Reports />;
      case 'settings':
        return <Settings status={status} setStatus={setStatus} />;
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

export default App;
