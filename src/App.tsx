import { useState } from 'react';
import SetupTab from './components/SetupTab';
import GamesListTab from './components/GamesListTab';
import GameDetailTab from './components/GameDetailTab';
import ReportsTab from './components/ReportsTab';
import ToolsTab from './components/ToolsTab';
import { useOnlineSync } from './hooks/useOnlineSync';

type Tab = 'setup' | 'games' | 'game-detail' | 'reports' | 'tools';

export default function App() {
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

  const tabs: { id: Tab; label: string }[] = [
    { id: 'setup', label: 'Setup' },
    { id: 'games', label: 'Games' },
    { id: 'reports', label: 'Reports' },
    { id: 'tools', label: 'Tools' },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo">LMS</span>
        <span className="app-title">Last Man Standing</span>
        {!isOnline && (
          <span className="offline-badge">Offline</span>
        )}
      </header>

      <nav className="app-nav">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`nav-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => {
              setActiveTab(t.id);
              if (t.id !== 'game-detail') setSelectedGameId(null);
            }}
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
        {activeTab === 'setup' && <SetupTab />}
        {activeTab === 'games' && <GamesListTab onSelectGame={openGame} />}
        {activeTab === 'game-detail' && selectedGameId !== null && (
          <GameDetailTab gameId={selectedGameId} onBack={backToGames} />
        )}
        {activeTab === 'reports' && <ReportsTab />}
        {activeTab === 'tools' && <ToolsTab />}
      </main>
    </div>
  );
}
