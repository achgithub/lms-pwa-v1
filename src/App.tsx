import { useState, useEffect, useRef } from 'react';
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
import { usePushSubscription } from './hooks/usePushSubscription';
import { api } from './api/client';

type Tab = 'setup' | 'games' | 'game-detail' | 'reports' | 'tools';

function useUpdateAvailable() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.ready.then(reg => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        if (!newWorker) return
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setUpdateAvailable(true)
          }
        })
      })
    })
  }, [])
  return updateAvailable
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { supported, permission, subscribed, busy, enable, disable } = usePushSubscription()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <div ref={ref} style={{
      position: 'absolute',
      top: 'calc(100% + 8px)',
      right: 0,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '16px',
      minWidth: 260,
      zIndex: 100,
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Settings</div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
          Notifications
        </div>
        {!supported ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            Not available — install the app to your home screen to enable push notifications.
          </p>
        ) : permission === 'denied' ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            Blocked in browser settings.
          </p>
        ) : subscribed ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 13 }}>Notifications enabled</span>
            <button className="btn btn-ghost btn-sm" onClick={disable} disabled={busy}>
              {busy ? <span className="spinner" /> : 'Turn off'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span className="text-muted" style={{ fontSize: 13 }}>Enable notifications</span>
            <button className="btn btn-primary btn-sm" onClick={enable} disabled={busy}>
              {busy ? <span className="spinner" /> : 'Enable'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Only rendered when the user is authenticated — safe to sync
function MainApp() {
  const { user, isManager, isPlayer, viewMode, setViewMode, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('games');
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const isOnline = useOnlineSync();
  const updateAvailable = useUpdateAvailable();

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
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowSettings(s => !s)}
              aria-label="Settings"
              style={{ padding: '4px 8px', fontSize: 16, lineHeight: 1 }}
            >
              ⚙
            </button>
            {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
          </div>
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

      {updateAvailable && (
        <div className="offline-banner" style={{ background: 'var(--accent)', color: '#000' }}>
          New version available — close all app tabs and reopen to update
        </div>
      )}
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
