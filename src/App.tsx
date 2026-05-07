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

// Only rendered when the user is authenticated — safe to sync
function MainApp() {
  const { user, isManager, isPlayer, viewMode, setViewMode, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('games');
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const isOnline = useOnlineSync();

  function openGame(id: number) {
    setSelectedGameId(id);
    setActiveTab('game-detail');
  }

  function backToGames() {
    setSelectedGameId(null);
    setActiveTab('games');
  }

  function toggleViewMode() {
    setViewMode(viewMode === 'player' ? 'default' : 'player');
    setSelectedGameId(null);
    setActiveTab('games');
  }

  const allTabs: { id: Tab; label: string; managerOnly?: boolean }[] = [
    { id: 'setup',   label: 'Setup',   managerOnly: true },
    { id: 'games',   label: 'Games' },
    { id: 'reports', label: 'Reports' },
    { id: 'tools',   label: 'Tools',   managerOnly: true },
  ];
  const tabs = allTabs.filter(t => !t.managerOnly || (isManager && viewMode !== 'player'));

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo">LMS</span>
        <span className="app-title">Last Man Standing</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {!isOnline && <span className="offline-badge">Offline</span>}
          {isManager && !isPlayer && (
            <button className="btn btn-ghost btn-sm" onClick={toggleViewMode}>
              {viewMode === 'player' ? '← Manager View' : 'Player View'}
            </button>
          )}
          <span className="text-muted" style={{ fontSize: 13 }}>{user!.name}</span>
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

function Shell() {
  const { user } = useAuth();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  const inviteToken = new URLSearchParams(window.location.search).get('token');

  useEffect(() => {
    api.get<{ needsSetup: boolean }>('/auth/status')
      .then(r => setNeedsSetup(r.needsSetup))
      .catch(() => setNeedsSetup(false));
  }, []);

  if (needsSetup === null) return <div className="auth-page"><span className="spinner" /></div>;
  if (user)                return <MainApp />;
  if (inviteToken)         return <RegisterPage token={inviteToken} />;
  if (needsSetup)          return <SetupPage />;
  return <LoginPage />;

  return <MainApp />;
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
