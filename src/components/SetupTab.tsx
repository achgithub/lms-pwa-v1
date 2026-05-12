import { useEffect, useState, useCallback } from 'react';
import type { Group, Player, Team } from '../types';
import * as db from '../db';
import { api } from '../api/client';
import InviteQR from './auth/InviteQR';
import { useAuth } from '../contexts/AuthContext';

interface AppUser {
  id: number;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export default function SetupTab() {
  const { isAdmin } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teamsByGroup, setTeamsByGroup] = useState<Record<number, Team[]>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [error, setError] = useState('');
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetPasscode, setResetPasscode] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetSuccess, setResetSuccess] = useState('');

  // New entry state
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newTeamInputs, setNewTeamInputs] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    try {
      const fetches: [Promise<Group[]>, Promise<Player[]>, Promise<AppUser[]>] = [
        db.getGroups(),
        db.getPlayers(),
        isAdmin ? api.get<AppUser[]>('/admin/users') : Promise.resolve([]),
      ];
      const [g, p, u] = await Promise.all(fetches);
      setGroups(g);
      setPlayers(p);
      setAppUsers(u);
      // Load teams for already-expanded groups
      const teamMap: Record<number, Team[]> = {};
      await Promise.all(
        g.map(async group => {
          teamMap[group.id] = await db.getTeamsByGroup(group.id);
        })
      );
      setTeamsByGroup(teamMap);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Players ────────────────────────────────────────────────────────────

  async function handleAddPlayer(e: React.FormEvent) {
    e.preventDefault();
    const name = newPlayerName.trim();
    if (!name) return;
    try {
      const p = await db.createPlayer(name);
      setPlayers(prev => [...prev, p]);
      setNewPlayerName('');
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDeletePlayer(id: number) {
    if (!confirm('Delete this player?')) return;
    try {
      await db.deletePlayer(id);
      setPlayers(prev => prev.filter(p => p.id !== id));
    } catch (e) {
      setError(String(e));
    }
  }

  // ── Groups ─────────────────────────────────────────────────────────────

  async function handleAddGroup(e: React.FormEvent) {
    e.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    try {
      const g = await db.createGroup(name);
      setGroups(prev => [...prev, g]);
      setTeamsByGroup(prev => ({ ...prev, [g.id]: [] }));
      setNewGroupName('');
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDeleteGroup(id: number) {
    if (!confirm('Delete this group and all its teams?')) return;
    try {
      await db.deleteGroup(id);
      setGroups(prev => prev.filter(g => g.id !== id));
      setTeamsByGroup(prev => { const n = { ...prev }; delete n[id]; return n; });
    } catch (e) {
      setError(String(e));
    }
  }

  function toggleGroup(id: number) {
    setExpandedGroups(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  // ── Users ──────────────────────────────────────────────────────────────

  async function handleDemote(id: number, name: string) {
    if (!confirm(`Demote ${name} from Manager to Player?`)) return;
    try {
      await api.patch(`/admin/users/${id}/role`, { role: 'player' });
      setAppUsers(prev => prev.map(u => u.id === id ? { ...u, role: 'player' } : u));
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleResetPasscode(userId: number) {
    if (resetPasscode.trim().length < 4) { setError('Passcode must be at least 4 characters'); return; }
    setResetBusy(true);
    setError('');
    try {
      await api.post('/auth/reset-passcode', { userId, passcode: resetPasscode.trim() });
      setResetUserId(null);
      setResetPasscode('');
      setResetSuccess(`Passcode updated`);
      setTimeout(() => setResetSuccess(''), 3000);
    } catch (e) {
      setError(String(e));
    } finally {
      setResetBusy(false);
    }
  }

  // ── Teams ──────────────────────────────────────────────────────────────

  async function handleAddTeam(e: React.FormEvent, groupId: number) {
    e.preventDefault();
    const name = (newTeamInputs[groupId] ?? '').trim();
    if (!name) return;
    try {
      const team = await db.createTeam(groupId, name);
      setTeamsByGroup(prev => ({ ...prev, [groupId]: [...(prev[groupId] ?? []), team] }));
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, teamCount: g.teamCount + 1 } : g));
      setNewTeamInputs(prev => ({ ...prev, [groupId]: '' }));
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDeleteTeam(teamId: number, groupId: number) {
    if (!confirm('Delete this team?')) return;
    try {
      await db.deleteTeam(teamId, groupId);
      setTeamsByGroup(prev => ({ ...prev, [groupId]: prev[groupId].filter(t => t.id !== teamId) }));
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, teamCount: Math.max(0, g.teamCount - 1) } : g));
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 className="card-title">Invite</h2>
        <InviteQR />
      </div>

      {isAdmin && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 className="card-title">Users</h2>
          {resetSuccess && <div className="alert alert-success" style={{ marginBottom: 12 }}>{resetSuccess}</div>}
          {appUsers.length === 0 ? (
            <p className="empty-state">No users yet.</p>
          ) : (
            <>
              {['manager', 'player'].map(role => {
                const group = appUsers.filter(u => u.role === role);
                if (group.length === 0) return null;
                return (
                  <div key={role} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                      {role === 'manager' ? 'Managers' : 'Players'}
                    </div>
                    {group.map(u => (
                      <div key={u.id}>
                        <div className="list-item">
                          <span>{u.name}</span>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {u.role === 'manager' && (
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => handleDemote(u.id, u.name)}
                              >
                                Demote
                              </button>
                            )}
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                setResetUserId(resetUserId === u.id ? null : u.id);
                                setResetPasscode('');
                                setError('');
                              }}
                            >
                              Reset passcode
                            </button>
                          </div>
                        </div>
                        {resetUserId === u.id && (
                          <div style={{ padding: '8px 12px 12px', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                            <div className="form-group" style={{ flex: 1 }}>
                              <label>New passcode for {u.name}</label>
                              <input
                                type="password"
                                placeholder="Min. 4 characters"
                                value={resetPasscode}
                                onChange={e => setResetPasscode(e.target.value)}
                                autoFocus
                              />
                            </div>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleResetPasscode(u.id)}
                              disabled={resetBusy || resetPasscode.trim().length < 4}
                            >
                              {resetBusy ? <span className="spinner" /> : 'Save'}
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => { setResetUserId(null); setResetPasscode(''); }}
                              disabled={resetBusy}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      <div className="two-col">
        {/* ── Player Pool ── */}
        <div className="card">
          <h2 className="card-title">Player Pool</h2>

          <form onSubmit={handleAddPlayer} className="form-row">
            <div className="form-group">
              <input
                type="text"
                placeholder="Player name"
                value={newPlayerName}
                onChange={e => setNewPlayerName(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={!newPlayerName.trim()}>
              Add
            </button>
          </form>

          <div className="mt-16">
            {players.length === 0 ? (
              <p className="empty-state">No players yet. Add one above.</p>
            ) : (
              players.map(p => (
                <div key={p.id} className="list-item">
                  <span>{p.name}</span>
                  <button className="btn-icon" onClick={() => handleDeletePlayer(p.id)} title="Delete">✕</button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Groups & Teams ── */}
        <div className="card">
          <h2 className="card-title">Groups &amp; Teams</h2>

          {isAdmin && (
            <form onSubmit={handleAddGroup} className="form-row">
              <div className="form-group">
                <input
                  type="text"
                  placeholder="Group name"
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={!newGroupName.trim()}>
                Add Group
              </button>
            </form>
          )}

          <div className="mt-16">
            {groups.length === 0 ? (
              <p className="empty-state">No groups yet. Add one above.</p>
            ) : (
              groups.map(group => {
                const expanded = expandedGroups.has(group.id);
                const teams = teamsByGroup[group.id] ?? [];
                return (
                  <div key={group.id} style={{ marginBottom: 12 }}>
                    <div className="list-item" style={{ background: 'var(--card)', borderRadius: 'var(--radius)' }}>
                      <button
                        style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flex: 1, textAlign: 'left' }}
                        onClick={() => toggleGroup(group.id)}
                      >
                        <span style={{ fontSize: 11 }}>{expanded ? '▼' : '▶'}</span>
                        <span style={{ fontWeight: 600 }}>{group.name}</span>
                        <span className="text-muted" style={{ fontSize: 13 }}>({group.teamCount} teams)</span>
                      </button>
                      {isAdmin && <button className="btn-icon" onClick={() => handleDeleteGroup(group.id)} title="Delete group">✕</button>}
                    </div>

                    {expanded && (
                      <div style={{ paddingLeft: 16, marginTop: 6 }}>
                        {teams.map(t => (
                          <div key={t.id} className="list-item">
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              {t.crestUrl && (
                                <img
                                  src={t.crestUrl}
                                  alt=""
                                  width={22}
                                  height={22}
                                  style={{ objectFit: 'contain', flexShrink: 0 }}
                                />
                              )}
                              <span className="text-muted">{t.name}</span>
                            </span>
                            {isAdmin && <button className="btn-icon btn-sm" onClick={() => handleDeleteTeam(t.id, group.id)} title="Delete team">✕</button>}
                          </div>
                        ))}

                        {isAdmin && (
                          <form
                            onSubmit={e => handleAddTeam(e, group.id)}
                            className="form-row mt-8"
                            style={{ paddingRight: 4 }}
                          >
                            <div className="form-group">
                              <input
                                type="text"
                                placeholder="Team name"
                                value={newTeamInputs[group.id] ?? ''}
                                onChange={e => setNewTeamInputs(prev => ({ ...prev, [group.id]: e.target.value }))}
                              />
                            </div>
                            <button
                              type="submit"
                              className="btn btn-secondary btn-sm"
                              disabled={!(newTeamInputs[group.id] ?? '').trim()}
                            >
                              Add Team
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
