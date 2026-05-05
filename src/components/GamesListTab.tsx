import { useEffect, useState, useCallback } from 'react';
import type { Game, Group, Player } from '../types';
import * as db from '../db';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  onSelectGame: (id: number) => void;
}

export default function GamesListTab({ onSelectGame }: Props) {
  const { isPlayer } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formGroupId, setFormGroupId] = useState<number | ''>('');
  const [formSelectedPlayers, setFormSelectedPlayers] = useState<Set<string>>(new Set());
  const [formPostponeAsWin, setFormPostponeAsWin] = useState(false);
  const [formWinnerMode, setFormWinnerMode] = useState<'single' | 'multiple'>('single');
  const [formRolloverMode, setFormRolloverMode] = useState<'round' | 'game'>('round');
  const [formMaxWinners, setFormMaxWinners] = useState(3);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      if (isPlayer) {
        const g = await db.getGames();
        setGames(g);
      } else {
        const [g, gr, p] = await Promise.all([db.getGames(), db.getGroups(), db.getPlayers()]);
        setGames(g);
        setGroups(gr);
        setPlayers(p);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [isPlayer]);

  useEffect(() => { load(); }, [load]);

  // Players with exactly one game skip the list and go straight in
  useEffect(() => {
    if (isPlayer && !loading && games.length === 1) {
      onSelectGame(games[0].id);
    }
  }, [isPlayer, loading, games, onSelectGame]);

  function togglePlayer(name: string) {
    setFormSelectedPlayers(prev => {
      const n = new Set(prev);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  }

  function toggleAll() {
    if (formSelectedPlayers.size === players.length) {
      setFormSelectedPlayers(new Set());
    } else {
      setFormSelectedPlayers(new Set(players.map(p => p.name)));
    }
  }

  function resetForm() {
    setFormName('');
    setFormGroupId('');
    setFormSelectedPlayers(new Set());
    setFormPostponeAsWin(false);
    setFormWinnerMode('single');
    setFormRolloverMode('round');
    setFormMaxWinners(3);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim() || formGroupId === '' || formSelectedPlayers.size === 0) return;
    setCreating(true);
    setError('');
    try {
      const game = await db.createGame({
        name: formName.trim(),
        groupId: Number(formGroupId),
        playerNames: [...formSelectedPlayers],
        postponeAsWin: formPostponeAsWin,
        winnerMode: formWinnerMode,
        rolloverMode: formRolloverMode,
        maxWinners: formWinnerMode === 'multiple' ? formMaxWinners : 1,
      });
      setGames(prev => [game, ...prev]);
      resetForm();
      setShowForm(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="empty-state"><span className="spinner" /></div>;

  // Player view — simple game picker (auto-redirect handled by useEffect for 1 game)
  if (isPlayer) {
    return (
      <div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="section-header">
          <h2 className="section-title">Your Games</h2>
        </div>
        {games.length === 0 ? (
          <div className="card">
            <p className="empty-state">You haven't been added to any games yet.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {games.map(game => (
              <div key={game.id} className="card" style={{ cursor: 'pointer' }} onClick={() => onSelectGame(game.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{game.name}</div>
                    <div className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>{game.groupName} · Round {game.currentRound}</div>
                  </div>
                  <span className={`badge badge-${game.status}`}>{game.status}</span>
                </div>
                {game.winnerName && (
                  <div style={{ marginTop: 8, fontSize: 13, color: 'var(--warning)' }}>
                    Winner: {game.winnerName}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="section-header">
        <h2 className="section-title">Games</h2>
        <button className="btn btn-primary" onClick={() => setShowForm(f => !f)}>
          {showForm ? 'Cancel' : '+ New Game'}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 className="card-title">Create New Game</h3>
          <form onSubmit={handleCreate}>
            <div className="form-row">
              <div className="form-group">
                <label>Game Name</label>
                <input
                  type="text"
                  placeholder="e.g. 2024/25 Season"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Team Group</label>
                <select
                  value={formGroupId}
                  onChange={e => setFormGroupId(e.target.value ? Number(e.target.value) : '')}
                  required
                >
                  <option value="">Select group…</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.name} ({g.teamCount} teams)</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-16">
              <div className="section-header">
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
                  Players ({formSelectedPlayers.size} selected)
                </label>
                <button type="button" className="btn btn-ghost btn-sm" onClick={toggleAll}>
                  {formSelectedPlayers.size === players.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              {players.length === 0 ? (
                <p className="text-muted">No players in pool. Add players in Setup first.</p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  {players.map(p => (
                    <label key={p.id} className="checkbox-row" style={{
                      padding: '6px 12px',
                      border: '1px solid',
                      borderColor: formSelectedPlayers.has(p.name) ? 'var(--accent)' : 'var(--border)',
                      borderRadius: 'var(--radius)',
                      background: formSelectedPlayers.has(p.name) ? 'rgba(233,69,96,0.1)' : 'transparent',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}>
                      <input
                        type="checkbox"
                        checked={formSelectedPlayers.has(p.name)}
                        onChange={() => togglePlayer(p.name)}
                        style={{ display: 'none' }}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-16" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
                  Winner Mode
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['single', 'multiple'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      className={`btn ${formWinnerMode === m ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setFormWinnerMode(m)}
                    >
                      {m === 'single' ? 'Single Winner' : 'Multiple Winners'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
                  Rollover Mode
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['round', 'game'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      className={`btn ${formRolloverMode === m ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setFormRolloverMode(m)}
                    >
                      {m === 'round' ? 'Rollover Round' : 'Rollover Game'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-16" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {formWinnerMode === 'multiple' && (
                <div className="form-group" style={{ maxWidth: 180 }}>
                  <label>Max Winners</label>
                  <input
                    type="number"
                    min={1}
                    max={formSelectedPlayers.size || 99}
                    value={formMaxWinners}
                    onChange={e => setFormMaxWinners(Number(e.target.value))}
                  />
                </div>
              )}

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={formPostponeAsWin}
                  onChange={e => setFormPostponeAsWin(e.target.checked)}
                />
                Postponed = Win
              </label>
            </div>

            <div className="mt-24 form-row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={creating || !formName.trim() || formGroupId === '' || formSelectedPlayers.size === 0}
              >
                {creating ? <><span className="spinner" /> Creating…</> : 'Create Game'}
              </button>
            </div>
          </form>
        </div>
      )}

      {games.length === 0 ? (
        <div className="card">
          <p className="empty-state">No games yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Group</th>
                  <th>Players</th>
                  <th>Round</th>
                  <th>Status</th>
                  <th>Winner</th>
                </tr>
              </thead>
              <tbody>
                {games.map(game => (
                  <tr
                    key={game.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onSelectGame(game.id)}
                  >
                    <td style={{ fontWeight: 600 }}>{game.name}</td>
                    <td className="text-muted">{game.groupName}</td>
                    <td>{game.participantCount}</td>
                    <td>{game.currentRound}</td>
                    <td>
                      <span className={`badge badge-${game.status}`}>{game.status}</span>
                    </td>
                    <td className="text-muted">{game.winnerName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
