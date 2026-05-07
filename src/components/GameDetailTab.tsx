import { useEffect, useState, useCallback } from 'react';
import type { Game, Participant, Round, Pick, Team, Fixture, MatchdayInfo } from '../types';
import type { PickResult } from '../types';
import * as db from '../db';
import * as logic from '../gameLogic';
import { useAuth } from '../contexts/AuthContext';

function formatMatchdayOption(m: MatchdayInfo): string {
  const d = new Date(m.firstDate);
  const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `GW${m.matchday} — w/c ${dateStr} (${m.fixtureCount} games)`;
}

function fixtureLabel(team: Team, fixtures: Fixture[]): string {
  const matches = fixtures.filter(f => f.homeTeamName === team.name || f.awayTeamName === team.name);
  if (matches.length === 0) return team.name;
  const parts = matches.map(f => {
    const isHome = f.homeTeamName === team.name;
    const opponent = isHome ? f.awayTeamName : f.homeTeamName;
    const venue = isHome ? 'vs' : '@';
    const d = new Date(f.utcDate);
    const dateStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    return `${venue} ${opponent} (${dateStr})`;
  });
  return `${team.name} — ${parts.join(', ')}`;
}

type FixtureOutcome = 'home' | 'draw' | 'away' | 'postponed';

function outcomeToResults(outcome: FixtureOutcome): { home: PickResult; away: PickResult } {
  if (outcome === 'home')      return { home: 'win',       away: 'loss' };
  if (outcome === 'away')      return { home: 'loss',      away: 'win' };
  if (outcome === 'draw')      return { home: 'draw',      away: 'draw' };
  return                              { home: 'postponed', away: 'postponed' };
}

function activeOutcome(fixture: Fixture, pendingResults: Record<string, PickResult>): FixtureOutcome | null {
  const hr = pendingResults[fixture.homeTeamName];
  if (!hr) return null;
  if (hr === 'win')       return 'home';
  if (hr === 'loss')      return 'away';
  if (hr === 'draw')      return 'draw';
  if (hr === 'postponed') return 'postponed';
  return null;
}

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
  const [matchdayOptions, setMatchdayOptions] = useState<MatchdayInfo[]>([]);
  const [selectedMatchday, setSelectedMatchday] = useState<number | ''>('');
  const [matchdayFixtures, setMatchdayFixtures] = useState<Fixture[]>([]);
  const [savingMatchday, setSavingMatchday] = useState(false);
  const { user, actingAsPlayer } = useAuth();

  const load = useCallback(async () => {
    try {
      const [detail, matchdays] = await Promise.all([
        db.getGameDetail(gameId, actingAsPlayer),
        db.getMatchdays().catch(() => [] as MatchdayInfo[]),
      ]);
      if (!detail) { onBack(); return; }
      setGame(detail.game);
      setParticipants(detail.participants);
      setRounds(detail.rounds);
      setPicks(detail.picks);
      setMatchdayOptions(matchdays);

      const t = await db.getTeamsByGroup(detail.game.groupId);
      setTeams(t);

      // Pre-populate pick dropdowns from any already-saved picks for the open round
      const open = detail.rounds.find(
        r => r.roundNumber === detail.game.currentRound && r.status === 'open'
      );
      if (open) {
        const initial: Record<string, number> = {};
        for (const pick of detail.picks) {
          if (pick.roundId === open.id && pick.teamId) initial[pick.playerName] = pick.teamId;
        }
        setPendingPicks(initial);
      }

      // Load fixtures for the open round's matchday if already set
      const openRound = detail.rounds.find(
        r => r.roundNumber === detail.game.currentRound && r.status === 'open'
      );
      if (openRound?.matchday) {
        const fixtures = await db.getFixturesByMatchday(openRound.matchday).catch(() => []);
        setMatchdayFixtures(fixtures);
      }

      // Auto-select next upcoming matchday for the selector
      const today = new Date().toISOString();
      const next = matchdays.find(m => m.firstDate >= today);
      setSelectedMatchday(next?.matchday ?? matchdays[matchdays.length - 1]?.matchday ?? '');
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
  const visibleParticipants = actingAsPlayer
    ? activeParticipants.filter(p => p.playerName === user?.name)
    : activeParticipants;
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

  // ── Set matchday ────────────────────────────────────────────────────────

  async function handleSetMatchday() {
    if (!openRound || !selectedMatchday) return;
    setSavingMatchday(true);
    try {
      const updated = await db.setRoundMatchday(openRound.id, selectedMatchday as number);
      setRounds(prev => prev.map(r => r.id === updated.id ? updated : r));
      const fixtures = await db.getFixturesByMatchday(selectedMatchday as number);
      setMatchdayFixtures(fixtures);
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingMatchday(false);
    }
  }

  // ── Save all picks ───────────────────────────────────────────────────────

  async function saveAllPicks() {
    if (!openRound) return;
    setBusy(true);
    setError('');
    try {
      // Save manually set picks
      for (const [playerName, teamId] of Object.entries(pendingPicks)) {
        if (!teamId) continue;
        const team = teams.find(t => t.id === teamId);
        if (!team) continue;
        const existing = currentRoundPicks.find(p => p.playerName === playerName);
        const saved = await db.upsertPick({
          id: existing?.id,
          gameId,
          roundId: openRound.id,
          playerName,
          teamId: team.id,
          teamName: team.name,
          autoAssigned: false,
        });
        setPicks(prev => [...prev.filter(p => p.id !== saved.id), saved]);
      }

      // Auto-assign any players still without a pick
      const latestPicks = await db.getPicks(gameId);
      const latestRoundPicks = latestPicks.filter(p => p.roundId === openRound.id);
      const playersWithoutPicks = activeParticipants
        .filter(p => !latestRoundPicks.some(cp => cp.playerName === p.playerName && cp.teamId != null))
        .map(p => p.playerName);

      if (playersWithoutPicks.length > 0) {
        const matchdayTeamNames = new Set(matchdayFixtures.flatMap(f => [f.homeTeamName, f.awayTeamName]));
        const teamsForAssign = matchdayTeamNames.size > 0 ? teams.filter(t => matchdayTeamNames.has(t.name)) : teams;
        const assignments = logic.autoAssignTeams(playersWithoutPicks, teamsForAssign, latestRoundPicks, rounds);
        for (const { playerName, team } of assignments) {
          const saved = await db.upsertPick({
            gameId, roundId: openRound.id, playerName,
            teamId: team.id, teamName: team.name, autoAssigned: true,
          });
          setPicks(prev => [...prev.filter(p => p.id !== saved.id), saved]);
        }
      }

      await load();
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
        {!actingAsPlayer && (
          <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={busy}>
            Delete
          </button>
        )}
      </div>

      {game.status === 'completed' ? (
        <div className="card">
          <div className="alert alert-success" style={{ marginBottom: 0 }}>
            Game complete! Winner{game.winnerName?.includes(',') ? 's' : ''}: <strong>{game.winnerName}</strong>
          </div>
        </div>
      ) : openRound ? (
        <>
          {/* ── Matchday Selector ── */}
          {!actingAsPlayer && !openRound.matchday && matchdayOptions.length > 0 && (
            <div className="card">
              <h3 className="card-title">Set Gameweek for Round {game.currentRound}</h3>
              <p className="text-muted" style={{ marginBottom: 16 }}>
                Select the gameweek this round corresponds to. Sorted by earliest fixture date.
              </p>
              <div className="form-row">
                <div className="form-group">
                  <select
                    value={selectedMatchday}
                    onChange={e => setSelectedMatchday(Number(e.target.value))}
                  >
                    <option value="">Select gameweek…</option>
                    {matchdayOptions.map(m => (
                      <option key={m.matchday} value={m.matchday}>{formatMatchdayOption(m)}</option>
                    ))}
                  </select>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={handleSetMatchday}
                  disabled={!selectedMatchday || savingMatchday}
                >
                  {savingMatchday ? <><span className="spinner" /> Saving…</> : 'Confirm Gameweek'}
                </button>
              </div>
            </div>
          )}

          {/* ── Picks Phase ── */}
          {picksPhase && (
            <div className="card">
              <div className="section-header">
                <h3 className="card-title" style={{ marginBottom: 0 }}>
                  Round {game.currentRound} — Assign Picks
                  {openRound.matchday && <span className="text-muted" style={{ fontWeight: 400, marginLeft: 8 }}>GW{openRound.matchday}</span>}
                </h3>
                {!actingAsPlayer && (
                  <button className="btn btn-primary" onClick={saveAllPicks} disabled={busy}>
                    {busy ? <><span className="spinner" /> Saving…</> : 'Save Picks'}
                  </button>
                )}
              </div>

              <div className="table-wrap mt-12">
                <table>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Pick</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleParticipants.map(p => {
                      const available = logic.availableTeams(p.playerName, teams, picks, rounds);
                      const matchdayTeamNames = new Set(matchdayFixtures.flatMap(f => [f.homeTeamName, f.awayTeamName]));
                      const filteredAvailable = matchdayTeamNames.size > 0
                        ? available.filter(t => matchdayTeamNames.has(t.name))
                        : available;
                      return (
                        <tr key={p.id}>
                          <td style={{ fontWeight: 600 }}>{p.playerName}</td>
                          <td>
                            <select
                              value={pendingPicks[p.playerName] ?? ''}
                              onChange={e => setPendingPicks(prev => ({ ...prev, [p.playerName]: Number(e.target.value) }))}
                            >
                              <option value="">Select team…</option>
                              {filteredAvailable.map(t => (
                                <option key={t.id} value={t.id}>{fixtureLabel(t, matchdayFixtures)}</option>
                              ))}
                            </select>
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
                <h3 className="card-title" style={{ marginBottom: 0 }}>
                  Round {game.currentRound} — Enter Results
                  {openRound.matchday && <span className="text-muted" style={{ fontWeight: 400, marginLeft: 8 }}>GW{openRound.matchday}</span>}
                </h3>
                {!actingAsPlayer && (
                  <button
                    className="btn btn-success"
                    onClick={handleCloseRound}
                    disabled={busy || [...picksByTeam.keys()].some(t => !pendingResults[t])}
                  >
                    {busy ? <><span className="spinner" /> Working…</> : 'Close Round & Advance'}
                  </button>
                )}
              </div>

              {matchdayFixtures.length > 0 ? (() => {
                const fixtureTeamNames = new Set(matchdayFixtures.flatMap(f => [f.homeTeamName, f.awayTeamName]));
                const fixturesWithPicks = matchdayFixtures.filter(
                  f => picksByTeam.has(f.homeTeamName) || picksByTeam.has(f.awayTeamName)
                );
                const unpairedTeams = [...picksByTeam.keys()].filter(t => !fixtureTeamNames.has(t));

                return (
                  <>
                    {fixturesWithPicks.map(f => {
                      const homePicks = picksByTeam.get(f.homeTeamName) ?? [];
                      const awayPicks = picksByTeam.get(f.awayTeamName) ?? [];
                      const outcome = activeOutcome(f, pendingResults);
                      const dateStr = new Date(f.utcDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
                      return (
                        <div key={f.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700 }}>{f.homeTeamName}</span>
                            <span className="text-muted">vs</span>
                            <span style={{ fontWeight: 700 }}>{f.awayTeamName}</span>
                            <span className="text-muted" style={{ fontSize: 13 }}>{dateStr}</span>
                          </div>
                          <div className="text-muted" style={{ fontSize: 13, marginBottom: 10 }}>
                            {homePicks.length > 0 && <span>{f.homeTeamName}: <strong>{homePicks.map(p => p.playerName).join(', ')}</strong></span>}
                            {homePicks.length > 0 && awayPicks.length > 0 && <span> · </span>}
                            {awayPicks.length > 0 && <span>{f.awayTeamName}: <strong>{awayPicks.map(p => p.playerName).join(', ')}</strong></span>}
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {([
                              { key: 'home',      label: `${f.homeTeamName} Win`, css: 'active-win' },
                              { key: 'draw',      label: 'Draw',                  css: 'active-draw' },
                              { key: 'away',      label: `${f.awayTeamName} Win`, css: 'active-win' },
                              { key: 'postponed', label: 'Postponed',             css: 'active-postponed' },
                            ] as { key: FixtureOutcome; label: string; css: string }[]).map(({ key, label, css }) => (
                              <button
                                key={key}
                                className={`result-btn ${outcome === key ? css : ''}`}
                                onClick={() => {
                                  const { home, away } = outcomeToResults(key);
                                  setPendingResults(prev => ({ ...prev, [f.homeTeamName]: home, [f.awayTeamName]: away }));
                                }}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {unpairedTeams.map(teamName => {
                      const teamPicks = picksByTeam.get(teamName) ?? [];
                      return (
                        <div key={teamName} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 12 }}>
                          <div>
                            <div style={{ fontWeight: 600 }}>{teamName}</div>
                            <div className="text-muted" style={{ fontSize: 13 }}>{teamPicks.map(p => p.playerName).join(', ')}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {(['win', 'loss', 'draw', 'postponed'] as PickResult[]).map(r => (
                              <button key={r} className={`result-btn ${pendingResults[teamName] === r ? `active-${r}` : ''}`}
                                onClick={() => setPendingResults(prev => ({ ...prev, [teamName]: r }))}>{r}</button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </>
                );
              })() : (
                // Fallback: no fixture data
                [...picksByTeam.entries()].map(([teamName, teamPicks]) => (
                  <div key={teamName} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{teamName}</div>
                      <div className="text-muted" style={{ fontSize: 13 }}>{teamPicks.map(p => p.playerName).join(', ')}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(['win', 'loss', 'draw', 'postponed'] as PickResult[]).map(r => (
                        <button key={r} className={`result-btn ${pendingResults[teamName] === r ? `active-${r}` : ''}`}
                          onClick={() => setPendingResults(prev => ({ ...prev, [teamName]: r }))}>{r}</button>
                      ))}
                    </div>
                  </div>
                ))
              )}
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
          {game.status === 'active' && !actingAsPlayer && (
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
