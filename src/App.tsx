import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import SetupPage from './components/auth/SetupPage';
import LoginPage from './components/auth/LoginPage';
import RegisterPage from './components/auth/RegisterPage';
import SetupTab from './components/SetupTab';
import GamesListTab from './components/GamesListTab';
import GameDetailTab from './components/GameDetailTab';
import ReportsTab from './components/ReportsTab';
import ToolsTab from './components/ToolsTab';
import { useOnlineSync } from './hooks/useOnlineSync';
import { api } from './api/client';

type Tab = 'setup' | 'games' | 'game-detail' | 'reports' | 'tools';

function Shell() {
  const { user, isManager, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('games');
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const isOnline = useOnlineSync();

  // Check for invite token in URL
  const inviteToken = new URLSearchParams(window.location.search).get('token');

  useEffect(() => {
    // Check if admin account exists yet
    api.get<{ needsSetup: boolean }>('/auth/status')
      .then(r => setNeedsSetup(r.needsSetup))
      .catch(() => setNeedsSetup(false));
  }, []);

  if (needsSetup === null) return <div className="auth-page"><span className="spinner" /></div>;
  if (needsSetup)         return <SetupPage />;
  if (inviteToken)        return <RegisterPage token={inviteToken} />;
  if (!user)              return <LoginPage />;

  function openGame(id: number) {
    setSelectedGameId(id);
    setActiveTab('game-detail');
  }

  function backToGames() {
    setSelectedGameId(null);
    setActiveTab('games');
  }

  const allTabs: { id: Tab; label: string; managerOnly?: boolean }[] = [
    { id: 'setup',   label: 'Setup',   managerOnly: true },
    { id: 'games',   label: 'Games' },
    { id: 'reports', label: 'Reports' },
    { id: 'tools',   label: 'Tools',   managerOnly: true },
  ];
  const tabs = allTabs.filter(t => !t.managerOnly || isManager);

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo">LMS</span>
        <span className="app-title">Last Man Standing</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {!isOnline && <span className="offline-badge">Offline</span>}
          <span className="text-muted" style={{ fontSize: 13 }}>{user.name}</span>
          <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
        </div>
      </header>

      <nav className="app-nav">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`nav-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => { setActiveTab(t.id); setSelectedGameId(null); }}
          >
            {t.label}
          </button>
        ))}
        {activeTab === 'game-detail' && (
          <button className="nav-tab active">Game Detail</button>
        )}
      </nav>

      {!isOnline && (
        <div className="offline-banner">
          No connection — viewing saved data, changes disabled
        </div>
      )}

      <main className="app-content">
        {activeTab === 'setup'       && <SetupTab />}
        {activeTab === 'games'       && <GamesListTab onSelectGame={openGame} />}
        {activeTab === 'game-detail' && selectedGameId !== null && (
          <GameDetailTab gameId={selectedGameId} onBack={backToGames} />
        )}
        {activeTab === 'reports'     && <ReportsTab />}
        {activeTab === 'tools'       && <ToolsTab />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
