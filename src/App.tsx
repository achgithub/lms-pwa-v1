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

function initials(name: string): string {
  return name.split(' ').map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2);
}

function useUpdateAvailable() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(reg => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setUpdateAvailable(true);
          }
        });
      });
    });
  }, []);
  return updateAvailable;
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { supported, permission, subscribed, busy, enable, disable } = usePushSubscription();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} style={{
      position: 'absolute',
      top: 'calc(100% + 8px)',
      right: 0,
      background: '#1c1c1c',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: '16px',
      minWidth: 260,
      zIndex: 100,
      boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
        Notifications
      </div>
      {!supported ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
          Install the app to your home screen to enable push notifications.
        </p>
      ) : permission === 'denied' ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
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
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Enable notifications</span>
          <button className="btn btn-primary btn-sm" onClick={enable} disabled={busy}>
            {busy ? <span className="spinner" /> : 'Enable'}
          </button>
        </div>
      )}
    </div>
  );
}

function MainApp() {
  const { user, isManager, isPlayer, viewMode, setViewMode, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('games');
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const isOnline = useOnlineSync();
  const updateAvailable = useUpdateAvailable();

  const managerMode = isManager && viewMode !== 'player';

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

  const navItems: { id: Tab; label: string; icon: string; managerOnly?: boolean }[] = [
    { id: 'games',   label: 'Games',   icon: 'ti ti-layout-grid' },
    { id: 'reports', label: 'Reports', icon: 'ti ti-chart-bar',  managerOnly: true },
    { id: 'setup',   label: 'Setup',   icon: 'ti ti-settings',   managerOnly: true },
    { id: 'tools',   label: 'Tools',   icon: 'ti ti-tool',       managerOnly: true },
  ];
  const visibleNavItems = navItems.filter(item => !item.managerOnly || managerMode);

  return (
    <div style={{ background: 'var(--bg-base)', minHeight: '100dvh', position: 'relative' }}>
      {/* Decorative blobs */}
      <div className="blob blob-indigo" aria-hidden="true" />
      <div className="blob blob-emerald" aria-hidden="true" />

      {/* Content wrapper */}
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 430, margin: '0 auto', minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>

        {/* Top bar */}
        <header style={{ padding: 'calc(env(safe-area-inset-top) + 14px) 18px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span className="app-logo">
            Last<span style={{ color: 'var(--indigo)' }}>Man</span>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isManager && !isPlayer && (
              <button className="ghost-pill" onClick={toggleViewMode}>
                {viewMode === 'player' ? '← Manager' : 'Player View'}
              </button>
            )}
            <button className="ghost-pill" onClick={logout}>Sign out</button>
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowSettings(s => !s)}
                aria-label="Settings"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.09)',
                  border: '1px solid rgba(255,255,255,0.13)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {initials(user!.name)}
              </button>
              {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
            </div>
          </div>
        </header>

        {/* Banners */}
        {updateAvailable && (
          <div className="offline-banner" style={{ background: 'var(--indigo-dim)', borderColor: 'var(--indigo-border)', color: 'var(--indigo)' }}>
            New version available — close all app tabs and reopen to update
          </div>
        )}
        {!isOnline && (
          <div className="offline-banner">
            No connection — viewing saved data, changes disabled
          </div>
        )}

        {/* Page content */}
        <main className="app-content" style={{ flex: 1, padding: '16px 18px 80px' }}>
          {activeTab === 'setup'       && <SetupTab />}
          {activeTab === 'games'       && <GamesListTab onSelectGame={openGame} />}
          {activeTab === 'game-detail' && selectedGameId !== null && (
            <GameDetailTab gameId={selectedGameId} onBack={backToGames} />
          )}
          {activeTab === 'reports'     && <ReportsTab />}
          {activeTab === 'tools'       && <ToolsTab />}
        </main>

        {/* Bottom navigation */}
        <nav className="bottom-nav" role="navigation" aria-label="Main navigation">
          {visibleNavItems.map(item => {
            const isActive = activeTab === item.id || (item.id === 'games' && activeTab === 'game-detail');
            return (
              <button
                key={item.id}
                className={`nav-item${isActive ? ' nav-item--active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => {
                  setActiveTab(item.id);
                  if (item.id !== 'games') setSelectedGameId(null);
                }}
              >
                <i className={item.icon} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>
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
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
