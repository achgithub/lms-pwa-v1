import { useEffect, useState, useCallback } from 'react';
import type { Game, Group, Player } from '../types';
import * as db from '../db';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  onSelectGame: (id: number) => void;
}

function GameCard({ game, onSelect, index }: { game: Game; onSelect: () => void; index: number }) {
  const isActive = game.status === 'active';
  return (
    <div
      className={`card${!isActive ? ' row--eliminated' : ''}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
        marginBottom: 8,
        animationDelay: `${index * 50}ms`,
      }}
      onClick={onSelect}
    >
      <div className={`card-icon card-icon--${isActive ? 'live' : 'done'}`}>
        <i className={`ti ti-${isActive ? 'flame' : 'check'}`} aria-hidden="true" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{game.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
          {game.groupName} · Round {game.currentRound}
          {game.winnerName ? ` · Winner: ${game.winnerName}` : ''}
        </div>
      </div>
      <span className={`badge badge-${isActive ? 'active' : 'completed'}`}>
        <i className={`ti ti-${isActive ? 'check' : 'star'}`} aria-hidden="true" />
        <span className="sr-only">Status: </span>
        {game.status}
      </span>
    </div>
  );
}

export default function GamesListTab({ onSelectGame }: Props) {
  const { actingAsPlayer } = useAuth();
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
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      if (actingAsPlayer) {
        const g = await db.getGames(true);
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
  }, [actingAsPlayer]);

  useEffect(() => { load(); }, [load]);

  // Single-game auto-redirect for player view
  useEffect(() => {
    if (actingAsPlayer && !loading && games.length === 1) {
      onSelectGame(games[0].id);
    }
  }, [actingAsPlayer, loading, games, onSelectGame]);

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

  // Player view
  if (actingAsPlayer) {
    return (
      <div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="section-header">
          <h2 className="section-title">Your Games</h2>
        </div>
        {games.length === 0 ? (
          <div className="empty-state">You haven't been added to any games yet.</div>
        ) : (
          <div>
            {games.map((game, i) => (
              <GameCard key={game.id} game={game} onSelect={() => onSelectGame(game.id)} index={i} />
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
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(f => !f)}>
          {showForm ? 'Cancel' : '+ New Game'}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 12 }}>
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
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  Players ({formSelectedPlayers.size} selected)
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={toggleAll}>
                  {formSelectedPlayers.size === players.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              {players.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No players in pool. Add players in Setup first.</p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  {players.map(p => (
                    <label key={p.id} className="checkbox-row" style={{
                      padding: '6px 12px',
                      border: '1px solid',
                      borderColor: formSelectedPlayers.has(p.name) ? 'var(--indigo)' : 'var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      background: formSelectedPlayers.has(p.name) ? 'var(--indigo-dim)' : 'transparent',
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

            <div className="mt-16">
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
        <div className="empty-state">No games yet. Create one to get started.</div>
      ) : (
        <div>
          {games.map((game, i) => (
            <GameCard key={game.id} game={game} onSelect={() => onSelectGame(game.id)} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
