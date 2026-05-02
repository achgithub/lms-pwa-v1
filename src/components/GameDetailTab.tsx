import { useEffect, useState, useCallback } from 'react';
import type { Game, Participant, Round, Pick, Team } from '../types';
import type { PickResult } from '../types';
import * as db from '../db';
import * as logic from '../gameLogic';

interface Props {
  gameId: number;
  onBack: () => void;
}

export default function GameDetailTab({ gameId, onBack }: Props) {
  const [game, setGame] = useState<Game | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Picks assignment state: playerName -> teamId
  const [pendingPicks, setPendingPicks] = useState<Record<string, number>>({});

  // Results entry state: teamName -> result
  const [pendingResults, setPendingResults] = useState<Record<string, PickResult>>({});

  // Add participant
  const [newParticipant, setNewParticipant] = useState('');
  const [addingPlayer, setAddingPlayer] = useState(false);

  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [g, parts, rds, pks] = await Promise.all([
        db.getGame(gameId),
        db.getParticipants(gameId),
        db.getRounds(gameId),
        db.getPicks(gameId),
      ]);
      if (!g) { onBack(); return; }
      setGame(g);
      setParticipants(parts);
      setRounds(rds);
      setPicks(pks);
      const t = await db.getTeamsByGroup(g.groupId);
      setTeams(t);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [gameId, onBack]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="empty-state"><span className="spinner" /></div>;
  if (!game) return null;

  const openRound = rounds.find(r => r.roundNumber === game.currentRound && r.status === 'open');
  const activeParticipants = participants.filter(p => p.isActive);
  const currentRoundPicks = picks.filter(p => openRound && p.roundId === openRound.id);

  // Determine phase: 'assign' = assigning picks, 'results' = entering results
  const allActiveHavePick = activeParticipants.every(p =>
    currentRoundPicks.some(cp => cp.playerName === p.playerName && cp.teamId != null)
  );
  const picksPhase = !allActiveHavePick;
  const resultsPhase = allActiveHavePick && game.status === 'active';

  // Team group for results entry
  const picksByTeam = new Map<string, Pick[]>();
  for (const pick of currentRoundPicks) {
    if (pick.teamName) {
      const arr = picksByTeam.get(pick.teamName) ?? [];
      arr.push(pick);
      picksByTeam.set(pick.teamName, arr);
    }
  }

  // ── Assign pick ─────────────────────────────────────────────────────────

  async function savePendingPick(playerName: string) {
    if (!openRound) return;
    const teamId = pendingPicks[playerName];
    if (!teamId) return;
    const team = teams.find(t => t.id === teamId);
    if (!team) return;

    // Check if pick already exists for this player in this round
    const existing = currentRoundPicks.find(p => p.playerName === playerName);

    try {
      const saved = await db.upsertPick({
        id: existing?.id,
        gameId,
        roundId: openRound.id,
        playerName,
        teamId: team.id,
        teamName: team.name,
        autoAssigned: false,
      });
      setPicks(prev => {
        const without = prev.filter(p => p.id !== saved.id);
        return [...without, saved];
      });
      setPendingPicks(prev => { const n = { ...prev }; delete n[playerName]; return n; });
    } catch (e) {
      setError(String(e));
    }
  }

  async function finalizePicks() {
    if (!openRound) return;
    setBusy(true);
    setError('');
    try {
      const playersWithoutPicks = activeParticipants
        .filter(p => !currentRoundPicks.some(cp => cp.playerName === p.playerName && cp.teamId != null))
        .map(p => p.playerName);

      const assignments = logic.autoAssignTeams(playersWithoutPicks, teams, currentRoundPicks, rounds);
      const newPicks: Pick[] = [];
      for (const { playerName, team } of assignments) {
        const saved = await db.upsertPick({
          gameId,
          roundId: openRound.id,
          playerName,
          teamId: team.id,
          teamName: team.name,
          autoAssigned: true,
        });
        newPicks.push(saved);
      }
      setPicks(prev => [...prev, ...newPicks]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Apply results and close round ────────────────────────────────────────

  async function handleCloseRound() {
    if (!openRound || !game) return;

    // Validate all teams have a result
    const teamNames = [...picksByTeam.keys()];
    const missing = teamNames.filter(t => !pendingResults[t]);
    if (missing.length > 0) {
      setError(`Set a result for: ${missing.join(', ')}`);
      return;
    }

    setBusy(true);
    setError('');
    try {
      // Save results to picks
      for (const [teamName, result] of Object.entries(pendingResults)) {
        const teamPicks = picksByTeam.get(teamName) ?? [];
        for (const pick of teamPicks) {
          await db.upsertPick({ ...pick, result });
        }
      }

      // Refresh picks after saving
      const updatedPicks = await db.getPicks(gameId);
      const updatedRoundPicks = updatedPicks.filter(p => p.roundId === openRound.id);

      // Compute eliminations
      const eliminatedIds = logic.computeEliminations(activeParticipants, updatedRoundPicks, game.postponeAsWin);

      // Compute new participant states (apply eliminations locally for decision)
      const survivingParticipants = participants.map(p =>
        eliminatedIds.includes(p.id) ? { ...p, isActive: false, eliminatedInRound: game.currentRound } : p
      );

      const decision = logic.computeAdvanceDecision(game, survivingParticipants, participants);

      let updatedGame: Game;

      if (decision.action === 'rollover') {
        updatedGame = await db.rolloverGame({
          gameId,
          currentRound: game.currentRound,
          openRoundId: openRound.id,
          rolloverMode: game.rolloverMode,
        });
        // Reload everything after rollover
        await load();
        setGame(updatedGame);
        setPendingResults({});
        return;
      }

      updatedGame = await db.advanceRound({
        gameId,
        currentRound: game.currentRound,
        openRoundId: openRound.id,
        eliminatedParticipantIds: eliminatedIds,
        nextRoundNumber: decision.action === 'game-over' ? null : decision.nextRoundNumber,
        winnerNames: decision.action === 'game-over' ? decision.winnerNames : undefined,
      });

      // Reload fresh state
      await load();
      setGame(updatedGame);
      setPendingResults({});
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Delete game ──────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!confirm(`Delete game "${game?.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await db.deleteGame(gameId);
      onBack();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  // ── Add participant ──────────────────────────────────────────────────────

  async function handleAddParticipant(e: React.FormEvent) {
    e.preventDefault();
    const name = newParticipant.trim();
    if (!name) return;
    setAddingPlayer(true);
    try {
      const p = await db.addParticipant(gameId, name);
      setParticipants(prev => [...prev, p]);
      if (game) setGame({ ...game, participantCount: game.participantCount + 1 });
      setNewParticipant('');
    } catch (e) {
      setError(String(e));
    } finally {
      setAddingPlayer(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      {error && <div className="alert alert-error">{error} <button style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }} onClick={() => setError('')}>✕</button></div>}

      {/* Header */}
      <div className="section-header">
        <div>
          <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 8 }}>
            ← Back to Games
          </button>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>{game.name}</h2>
          <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
            <span className="text-muted">{game.groupName}</span>
            <span className={`badge badge-${game.status}`}>{game.status}</span>
            {game.status === 'active' && (
              <span className="badge badge-open">Round {game.currentRound}</span>
            )}
            {game.winnerName && (
              <span style={{ color: 'var(--warning)', fontWeight: 600 }}>Winner: {game.winnerName}</span>
            )}
          </div>
        </div>
        <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={busy}>
          Delete
        </button>
      </div>

      {game.status === 'completed' ? (
        <div className="card">
          <div className="alert alert-success" style={{ marginBottom: 0 }}>
            Game complete! Winner{game.winnerName?.includes(',') ? 's' : ''}: <strong>{game.winnerName}</strong>
          </div>
        </div>
      ) : openRound ? (
        <>
          {/* ── Picks Phase ── */}
          {picksPhase && (
            <div className="card">
              <div className="section-header">
                <h3 className="card-title" style={{ marginBottom: 0 }}>Round {game.currentRound} — Assign Picks</h3>
                <button
                  className="btn btn-primary"
                  onClick={finalizePicks}
                  disabled={busy}
                >
                  {busy ? <><span className="spinner" /> Working…</> : 'Finalize Picks (Auto-assign remaining)'}
                </button>
              </div>

              <div className="table-wrap mt-12">
                <table>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Current Pick</th>
                      <th>Assign Team</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeParticipants.map(p => {
                      const existingPick = currentRoundPicks.find(cp => cp.playerName === p.playerName);
                      const available = logic.availableTeams(p.playerName, teams, picks, rounds);
                      const selectedId = pendingPicks[p.playerName] ?? '';

                      return (
                        <tr key={p.id}>
                          <td style={{ fontWeight: 600 }}>{p.playerName}</td>
                          <td>
                            {existingPick?.teamName
                              ? <span style={{ color: 'var(--info)' }}>{existingPick.teamName}{existingPick.autoAssigned ? ' (auto)' : ''}</span>
                              : <span className="text-muted">—</span>
                            }
                          </td>
                          <td>
                            <select
                              value={selectedId}
                              onChange={e => setPendingPicks(prev => ({ ...prev, [p.playerName]: Number(e.target.value) }))}
                              disabled={!!existingPick?.teamName}
                            >
                              <option value="">Select team…</option>
                              {available.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            {!existingPick?.teamName && (
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => savePendingPick(p.playerName)}
                                disabled={!pendingPicks[p.playerName]}
                              >
                                Save
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Results Phase ── */}
          {resultsPhase && (
            <div className="card">
              <div className="section-header">
                <h3 className="card-title" style={{ marginBottom: 0 }}>Round {game.currentRound} — Enter Results</h3>
                <button
                  className="btn btn-success"
                  onClick={handleCloseRound}
                  disabled={busy || [...picksByTeam.keys()].some(t => !pendingResults[t])}
                >
                  {busy ? <><span className="spinner" /> Working…</> : 'Close Round & Advance'}
                </button>
              </div>

              <p className="text-muted" style={{ marginBottom: 16 }}>
                Set a result for each team. All players on the same team get the same result.
              </p>

              {[...picksByTeam.entries()].map(([teamName, teamPicks]) => (
                <div key={teamName} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 0',
                  borderBottom: '1px solid var(--border)',
                  flexWrap: 'wrap',
                  gap: 12,
                }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{teamName}</div>
                    <div className="text-muted" style={{ fontSize: 13 }}>
                      {teamPicks.map(p => p.playerName).join(', ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['win', 'loss', 'draw', 'postponed'] as PickResult[]).map(r => (
                      <button
                        key={r}
                        className={`result-btn ${pendingResults[teamName] === r ? `active-${r}` : ''}`}
                        onClick={() => setPendingResults(prev => ({ ...prev, [teamName]: r }))}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="card">
          <div className="alert alert-info">No open round. Something may have gone wrong — try reloading.</div>
        </div>
      )}

      {/* ── Participants ── */}
      <div className="card mt-16">
        <div className="section-header">
          <h3 className="section-title">Participants ({participants.length})</h3>
          {game.status === 'active' && (
            <form onSubmit={handleAddParticipant} className="form-row" style={{ margin: 0 }}>
              <input
                type="text"
                placeholder="Add player"
                value={newParticipant}
                onChange={e => setNewParticipant(e.target.value)}
                style={{ width: 150 }}
              />
              <button type="submit" className="btn btn-secondary btn-sm" disabled={addingPlayer || !newParticipant.trim()}>
                Add
              </button>
            </form>
          )}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Status</th>
                <th>Eliminated In</th>
              </tr>
            </thead>
            <tbody>
              {[...participants].sort((a, b) => Number(b.isActive) - Number(a.isActive)).map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 500 }}>{p.playerName}</td>
                  <td>
                    {p.isActive
                      ? <span className="badge badge-active">Active</span>
                      : <span className="badge badge-completed">Eliminated</span>
                    }
                  </td>
                  <td className="text-muted">{p.eliminatedInRound ? `Round ${p.eliminatedInRound}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Round History ── */}
      <div className="card mt-16">
        <h3 className="section-title" style={{ marginBottom: 14 }}>Round History</h3>
        {rounds.length === 0 ? (
          <p className="empty-state">No rounds yet.</p>
        ) : (
          rounds.map(round => {
            const roundPicks = picks.filter(p => p.roundId === round.id);
            return (
              <div key={round.id} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontWeight: 700 }}>Round {round.roundNumber}</span>
                  <span className={`badge badge-${round.status}`}>{round.status}</span>
                </div>
                {roundPicks.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Player</th>
                          <th>Team</th>
                          <th>Result</th>
                          <th>Auto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {roundPicks.map(pick => (
                          <tr key={pick.id}>
                            <td>{pick.playerName}</td>
                            <td>{pick.teamName ?? '—'}</td>
                            <td>
                              {pick.result ? (
                                <span className={`text-${pick.result === 'win' ? 'success' : pick.result === 'loss' ? 'danger' : pick.result === 'draw' ? 'warning' : 'info'}`}>
                                  {pick.result}
                                </span>
                              ) : '—'}
                            </td>
                            <td className="text-muted">{pick.autoAssigned ? 'yes' : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-muted" style={{ fontSize: 13 }}>No picks yet.</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
