import { useEffect, useRef, useState, useCallback } from 'react';
import type { Game, Participant, Round, Pick, Team, Fixture, Standing } from '../types';
import type { PickResult } from '../types';
import type { AutoAssignment } from '../gameLogic';
import * as db from '../db';
import * as logic from '../gameLogic';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';


type FixtureOutcome = 'home' | 'draw' | 'away' | 'postponed';

function outcomeToResults(outcome: FixtureOutcome): { home: PickResult; away: PickResult } {
  if (outcome === 'home')      return { home: 'win',       away: 'loss' };
  if (outcome === 'away')      return { home: 'loss',      away: 'win' };
  if (outcome === 'draw')      return { home: 'draw',      away: 'draw' };
  return                              { home: 'postponed', away: 'postponed' };
}

function fixtureResultHint(f: Fixture): string {
  if (f.status === 'FINISHED' && f.homeScore != null && f.awayScore != null)
    return `Result: ${f.homeTeamName} ${f.homeScore} – ${f.awayScore} ${f.awayTeamName}`
  if (f.status === 'POSTPONED') return 'Postponed'
  if (f.status === 'CANCELLED') return 'Cancelled'
  if (f.status === 'IN_PLAY' || f.status === 'PAUSED' || f.status === 'HALFTIME')
    return `Live: ${f.homeScore ?? 0} – ${f.awayScore ?? 0}`
  return 'Awaiting result'
}

function activeOutcome(fixtureId: number, pendingFixtureOutcomes: Record<number, FixtureOutcome>): FixtureOutcome | null {
  return pendingFixtureOutcomes[fixtureId] ?? null;
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
  const [pendingPicks, setPendingPicks] = useState<Record<string, { teamId: number; fixtureId?: number }>>({});

  // Results entry state: fixture outcomes (keyed by fixtureId) + unpaired team results
  const [pendingFixtureOutcomes, setPendingFixtureOutcomes] = useState<Record<number, FixtureOutcome>>({});
  const [pendingTeamResults, setPendingTeamResults] = useState<Record<string, PickResult>>({});

  const [busy, setBusy] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyStatus, setNotifyStatus] = useState('');
  const [allFixtures, setAllFixtures] = useState<Fixture[]>([]);
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<number[]>([]);
  const [roundFixtures, setRoundFixtures] = useState<Fixture[]>([]);
  const [savingFixtures, setSavingFixtures] = useState(false);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [pendingAutoAssignments, setPendingAutoAssignments] = useState<AutoAssignment[] | null>(null);
  const [inPicksPhase, setInPicksPhase] = useState(true);
  const [massEliminationState, setMassEliminationState] = useState<{
    candidates: string[];
    eliminatedIds: number[];
    openRoundId: number;
    currentRound: number;
    singleWinnerChoice: string;
  } | null>(null);
  const [showDeclareResult, setShowDeclareResult] = useState(false);
  const [declareResultWinners, setDeclareResultWinners] = useState<Set<string>>(new Set());
  const { user, actingAsPlayer } = useAuth();

  const load = useCallback(async () => {
    try {
      const [detail, fixtures, standingsData] = await Promise.all([
        db.getGameDetail(gameId, actingAsPlayer),
        db.getAllFixtures().catch(() => [] as Fixture[]),
        db.getStandings().catch(() => [] as Standing[]),
      ]);
      setStandings(standingsData);
      if (!detail) { onBack(); return; }
      setGame(detail.game);
      setParticipants(detail.participants);
      setRounds(detail.rounds);
      setPicks(detail.picks);
      setAllFixtures(fixtures);

      const t = await db.getTeamsByGroup(detail.game.groupId);
      setTeams(t);

      // Pre-populate pick dropdowns from saved picks for the open round
      const open = detail.rounds.find(
        r => r.roundNumber === detail.game.currentRound && r.status === 'open'
      );
      if (open) {
        const initial: Record<string, { teamId: number; fixtureId?: number }> = {};
        for (const pick of detail.picks) {
          if (pick.roundId === open.id && pick.teamId) {
            initial[pick.playerName] = { teamId: pick.teamId, fixtureId: pick.fixtureId };
          }
        }
        setPendingPicks(initial);

        // Transition to results phase automatically only if all picks were already in
        // (i.e. a previous session finalised — don't transition on Save Picks)
        const active = detail.participants.filter(p => p.isActive);
        const allHave = active.length > 0 && active.every(p => initial[p.playerName] !== undefined);
        setInPicksPhase(!allHave);

        // Load fixtures for this round if already set; always reset selection
        setRoundFixtures(open.fixtureIds?.length ? fixtures.filter(f => open.fixtureIds!.includes(f.id)) : []);
        setSelectedFixtureIds([]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [gameId, onBack]);

  useEffect(() => { load(); }, [load]);

  const autoAssignRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pendingAutoAssignments !== null && autoAssignRef.current) {
      autoAssignRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [pendingAutoAssignments]);

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
  const picksPhase = inPicksPhase;
  const resultsPhase = !inPicksPhase && allActiveHavePick && game.status === 'active';

  // Team group for results entry
  const picksByTeam = new Map<string, Pick[]>();
  for (const pick of currentRoundPicks) {
    if (pick.teamName) {
      const arr = picksByTeam.get(pick.teamName) ?? [];
      arr.push(pick);
      picksByTeam.set(pick.teamName, arr);
    }
  }
  const fixtureTeamNames = new Set(roundFixtures.flatMap(f => [f.homeTeamName, f.awayTeamName]));
  const fixturesWithPicks = roundFixtures.filter(f => picksByTeam.has(f.homeTeamName) || picksByTeam.has(f.awayTeamName));
  const unpairedTeams = [...picksByTeam.keys()].filter(t => !fixtureTeamNames.has(t));

  // ── Set fixtures ─────────────────────────────────────────────────────────

  async function handleSetFixtures() {
    if (!openRound || selectedFixtureIds.length === 0) return;
    setSavingFixtures(true);
    try {
      const updated = await db.setRoundFixtures(openRound.id, selectedFixtureIds);
      setRounds(prev => prev.map(r => r.id === updated.id ? updated : r));
      setRoundFixtures(allFixtures.filter(f => selectedFixtureIds.includes(f.id)));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingFixtures(false);
    }
  }

  // ── Save all picks ───────────────────────────────────────────────────────

  async function saveAllPicks() {
    if (!openRound) return;
    setBusy(true);
    setError('');
    try {
      // Save manually set picks
      for (const [playerName, pickData] of Object.entries(pendingPicks)) {
        if (!pickData?.teamId) continue;
        const team = teams.find(t => t.id === pickData.teamId);
        if (!team) continue;
        const existing = currentRoundPicks.find(p => p.playerName === playerName);
        const saved = await db.upsertPick({
          id: existing?.id,
          gameId,
          roundId: openRound.id,
          playerName,
          teamId: team.id,
          teamName: team.name,
          fixtureId: pickData.fixtureId,
          autoAssigned: false,
        });
        setPicks(prev => [...prev.filter(p => p.id !== saved.id), saved]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Finalise picks (auto-assign missing, then enter results) ─────────────

  async function handleFinalisePicks() {
    if (!openRound) return;
    const latestPicks = await db.getPicks(gameId);
    const latestRoundPicks = latestPicks.filter(p => p.roundId === openRound.id);
    const playersWithoutPicks = activeParticipants
      .filter(p => !latestRoundPicks.some(cp => cp.playerName === p.playerName && cp.teamId != null))
      .map(p => p.playerName);

    if (playersWithoutPicks.length === 0) {
      await load(); // already complete, just refresh to show results phase
      return;
    }

    const matchdayTeamNames = new Set(roundFixtures.flatMap(f => [f.homeTeamName, f.awayTeamName]));
    const teamsForAssign = matchdayTeamNames.size > 0 ? teams.filter(t => matchdayTeamNames.has(t.name)) : teams;
    const assignments = logic.autoAssignTeams(playersWithoutPicks, teamsForAssign, latestRoundPicks, rounds, standings);
    setPendingAutoAssignments(assignments.length > 0 ? assignments : []);
  }

  async function confirmFinalisePicks(autoAssignments: AutoAssignment[]) {
    if (!openRound) return;
    setBusy(true);
    setError('');
    setPendingAutoAssignments(null);
    try {
      for (const { playerName, team } of autoAssignments) {
        const existing = picks.find(p => p.roundId === openRound.id && p.playerName === playerName);
        const teamFix = roundFixtures.filter(f => f.homeTeamName === team.name || f.awayTeamName === team.name);
        const saved = await db.upsertPick({
          id: existing?.id,
          gameId, roundId: openRound.id, playerName,
          teamId: team.id, teamName: team.name,
          fixtureId: teamFix.length === 1 ? teamFix[0].id : undefined,
          autoAssigned: true,
        });
        setPicks(prev => [...prev.filter(p => p.id !== saved.id), saved]);
      }
      await load(); // reload → allActiveHavePick becomes true → results phase shows
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Apply results and close round ────────────────────────────────────────

  async function handleCloseRound() {
    if (!openRound || !game) return;

    // Validate all fixtures (with picks) and unpaired teams have a result
    const missingFix = fixturesWithPicks.filter(f => pendingFixtureOutcomes[f.id] === undefined);
    const missingTeam = unpairedTeams.filter(t => pendingTeamResults[t] === undefined);
    if (missingFix.length > 0 || missingTeam.length > 0) {
      const labels = [
        ...missingFix.map(f => `${f.homeTeamName} vs ${f.awayTeamName}`),
        ...missingTeam,
      ];
      setError(`Set a result for: ${labels.join(', ')}`);
      return;
    }

    setBusy(true);
    setError('');
    try {
      // Save results — fixture-linked picks matched by fixtureId, unpaired by team name
      for (const [fixtureIdStr, outcome] of Object.entries(pendingFixtureOutcomes)) {
        const fId = Number(fixtureIdStr);
        const fixture = roundFixtures.find(f => f.id === fId);
        if (!fixture) continue;
        const { home: homeResult, away: awayResult } = outcomeToResults(outcome);
        for (const pick of currentRoundPicks) {
          if (pick.fixtureId === fId) {
            await db.upsertPick({ ...pick, result: pick.teamName === fixture.homeTeamName ? homeResult : awayResult });
          } else if (pick.fixtureId == null) {
            // Legacy/auto-assigned pick — apply only if this team plays exactly once in the round
            const teamFixCount = roundFixtures.filter(f2 => f2.homeTeamName === pick.teamName || f2.awayTeamName === pick.teamName).length;
            if (teamFixCount === 1) {
              if (pick.teamName === fixture.homeTeamName) await db.upsertPick({ ...pick, result: homeResult });
              else if (pick.teamName === fixture.awayTeamName) await db.upsertPick({ ...pick, result: awayResult });
            }
          }
        }
      }
      for (const [teamName, result] of Object.entries(pendingTeamResults)) {
        for (const pick of currentRoundPicks.filter(p => p.teamName === teamName)) {
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

      const decision = logic.computeAdvanceDecision(game.currentRound, survivingParticipants, activeParticipants);

      if (decision.action === 'manager-decision') {
        setMassEliminationState({
          candidates: decision.candidates,
          eliminatedIds,
          openRoundId: openRound.id,
          currentRound: game.currentRound,
          singleWinnerChoice: decision.candidates[0] ?? '',
        });
        return;
      }

      const updatedGame = await db.advanceRound({
        gameId,
        currentRound: game.currentRound,
        openRoundId: openRound.id,
        eliminatedParticipantIds: eliminatedIds,
        nextRoundNumber: decision.action === 'game-over' ? null : decision.nextRoundNumber,
        winnerNames: decision.action === 'game-over' ? decision.winnerNames : undefined,
      });

      await load();
      setGame(updatedGame);
      setPendingFixtureOutcomes({});
      setPendingTeamResults({});
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Mass elimination decision (all players out same round) ──────────────

  async function handleMassEliminationDecision(type: 'winner' | 'split' | 'rollover') {
    if (!massEliminationState) return;
    setBusy(true);
    setError('');
    try {
      let updatedGame: Game;
      if (type === 'rollover') {
        updatedGame = await db.advanceRound({
          gameId,
          currentRound: massEliminationState.currentRound,
          openRoundId: massEliminationState.openRoundId,
          eliminatedParticipantIds: [],
          nextRoundNumber: massEliminationState.currentRound + 1,
        });
      } else {
        const winnerNames = type === 'split'
          ? massEliminationState.candidates
          : [massEliminationState.singleWinnerChoice];
        updatedGame = await db.advanceRound({
          gameId,
          currentRound: massEliminationState.currentRound,
          openRoundId: massEliminationState.openRoundId,
          eliminatedParticipantIds: massEliminationState.eliminatedIds,
          nextRoundNumber: null,
          winnerNames,
        });
      }
      setGame(updatedGame);
      setMassEliminationState(null);
      setPendingFixtureOutcomes({});
      setPendingTeamResults({});
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Declare result early (scenario 2: manager ends game) ────────────────

  async function handleDeclareResult() {
    if (declareResultWinners.size === 0) return;
    setBusy(true);
    setError('');
    try {
      const updatedGame = await db.declareResult(gameId, [...declareResultWinners]);
      setGame(updatedGame);
      setShowDeclareResult(false);
      setDeclareResultWinners(new Set());
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Send push notification ───────────────────────────────────────────────

  async function handleNotify(type: 'round-opened' | 'closing-soon' | 'eliminated') {
    setNotifyBusy(true);
    setNotifyStatus('');
    try {
      const { sent } = await api.post<{ sent: number }>('/push/notify', { gameId, type });
      setNotifyStatus(sent === 0 ? 'No subscribers found' : `Sent to ${sent}`);
    } catch {
      setNotifyStatus('Failed to send');
    } finally {
      setNotifyBusy(false);
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

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      {error && <div className="alert alert-error">{error} <button style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }} onClick={() => setError('')}>✕</button></div>}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 8 }}>
            ← Back
          </button>
          <h2 style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>{game.name}</h2>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{game.groupName}</span>
            <span className={`badge badge-${game.status}`}>{game.status}</span>
            {game.status === 'active' && (
              <span className="badge badge-open">Round {game.currentRound}</span>
            )}
            {game.winnerName && (
              <span style={{ color: 'var(--amber)', fontWeight: 600, fontSize: 13 }}>Winner: {game.winnerName}</span>
            )}
          </div>
        </div>
        {!actingAsPlayer && (
          <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={busy} style={{ flexShrink: 0 }}>
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
          {/* ── Fixture Picker ── */}
          {!actingAsPlayer && !openRound.fixtureIds?.length && allFixtures.length > 0 && (
            <div className="card">
              <h3 className="card-title">Select Fixtures for Round {game.currentRound}</h3>
              <p className="text-muted" style={{ marginBottom: 12 }}>
                Tick all games for this round. Sorted by date — includes any rescheduled games.
              </p>
              {(() => {
                  const now = new Date();
                  const from = new Date(now); from.setDate(now.getDate() - 14);
                  const to   = new Date(now); to.setDate(now.getDate() + 28);
                  const visible = allFixtures.filter(f => {
                    const d = new Date(f.utcDate);
                    return d >= from && d <= to;
                  });
                  if (visible.length === 0) return <p className="text-muted" style={{ padding: 12 }}>No fixtures in this window.</p>;
                  return (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                      {visible.map((f, i) => {
                        const checked = selectedFixtureIds.includes(f.id);
                        const d = new Date(f.utcDate);
                        const dateStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
                        const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                        return (
                          <label key={f.id} className="checkbox-row" style={{
                            padding: '8px 12px',
                            borderBottom: i < visible.length - 1 ? '1px solid var(--border)' : 'none',
                          }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={e => setSelectedFixtureIds(prev =>
                                e.target.checked ? [...prev, f.id] : prev.filter(id => id !== f.id)
                              )}
                            />
                            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>{dateStr} {timeStr}</span>
                              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>GW{f.matchday}</span>
                              <span style={{ fontSize: 13, fontWeight: 500 }}>{f.homeTeamName} vs {f.awayTeamName}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  );
                })()}
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="text-muted">{selectedFixtureIds.length} selected</span>
                <button
                  className="btn btn-primary"
                  onClick={handleSetFixtures}
                  disabled={selectedFixtureIds.length === 0 || savingFixtures}
                >
                  {savingFixtures ? <><span className="spinner" /> Saving…</> : `Confirm (${selectedFixtureIds.length} games)`}
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
                  {openRound.fixtureIds?.length ? <span className="text-muted" style={{ fontWeight: 400, marginLeft: 8 }}>{openRound.fixtureIds.length} fixtures</span> : null}
                </h3>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button className="btn btn-primary btn-sm" onClick={saveAllPicks} disabled={busy}>
                    {busy ? <><span className="spinner" /> Saving…</> : actingAsPlayer ? 'Save Pick' : 'Save Picks'}
                  </button>
                  {!actingAsPlayer && (
                    <button className="btn btn-success btn-sm" onClick={handleFinalisePicks} disabled={busy}>
                      Finalise Picks
                    </button>
                  )}
                </div>
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
                      const matchdayTeamNames = new Set(roundFixtures.flatMap(f => [f.homeTeamName, f.awayTeamName]));
                      const filteredAvailable = matchdayTeamNames.size > 0
                        ? available.filter(t => matchdayTeamNames.has(t.name))
                        : available;
                      return (
                        <tr key={p.id}>
                          <td style={{ fontWeight: 600 }}>{p.playerName}</td>
                          <td>
                            <select
                              value={
                                pendingPicks[p.playerName]
                                  ? `${pendingPicks[p.playerName].teamId}:${pendingPicks[p.playerName].fixtureId ?? ''}`
                                  : ''
                              }
                              onChange={e => {
                                const val = e.target.value;
                                if (!val) { setPendingPicks(prev => { const n = { ...prev }; delete n[p.playerName]; return n; }); return; }
                                const ci = val.indexOf(':');
                                const teamId = Number(val.substring(0, ci));
                                const fStr = val.substring(ci + 1);
                                setPendingPicks(prev => ({ ...prev, [p.playerName]: { teamId, fixtureId: fStr ? Number(fStr) : undefined } }));
                              }}
                            >
                              <option value="">Select team…</option>
                              {(() => {
                                const opts: { value: string; label: string }[] = [];
                                for (const t of filteredAvailable) {
                                  const tFix = roundFixtures.filter(f => f.homeTeamName === t.name || f.awayTeamName === t.name);
                                  if (tFix.length === 0) {
                                    opts.push({ value: `${t.id}:`, label: t.name });
                                  } else {
                                    for (const f of tFix) {
                                      const isHome = f.homeTeamName === t.name;
                                      const opp = isHome ? f.awayTeamName : f.homeTeamName;
                                      const d = new Date(f.utcDate);
                                      const ds = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
                                      const ts = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                                      opts.push({ value: `${t.id}:${f.id}`, label: `${t.name} (${isHome ? 'Home' : 'Away'} vs ${opp}, ${ds} ${ts})` });
                                    }
                                  }
                                }
                                return opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>);
                              })()}
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

          {/* ── Auto-assign confirmation ── */}
          {pendingAutoAssignments && (
            <div ref={autoAssignRef} className="card" style={{ border: '1px solid var(--indigo-border)', background: 'var(--indigo-dim)' }}>
              <h3 className="card-title" style={{ marginBottom: 8 }}>Auto-assign picks</h3>
              <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
                The following players have no pick. These will be assigned before closing the round:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {pendingAutoAssignments.map(({ playerName, team, position, standingsUpdatedAt }) => {
                  const posLabel = position != null ? `position ${position}` : 'no standings data';
                  const dateLabel = standingsUpdatedAt
                    ? new Date(standingsUpdatedAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : null;
                  return (
                    <div key={playerName} style={{ fontSize: 14 }}>
                      <strong>{playerName}</strong> → {team.name}
                      <span className="text-muted" style={{ fontSize: 12, marginLeft: 8 }}>
                        {posLabel}{dateLabel ? `, standings as at ${dateLabel}` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={() => confirmFinalisePicks(pendingAutoAssignments)} disabled={busy}>
                  {busy ? <><span className="spinner" /> Working…</> : 'Confirm & Enter Results'}
                </button>
                <button className="btn btn-ghost" onClick={() => setPendingAutoAssignments(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ── Results Phase ── */}
          {resultsPhase && !pendingAutoAssignments && !massEliminationState && (
            <div className="card">
              <div className="section-header">
                <h3 className="card-title" style={{ marginBottom: 0 }}>
                  Round {game.currentRound} — Enter Results
                  {openRound.fixtureIds?.length ? <span className="text-muted" style={{ fontWeight: 400, marginLeft: 8 }}>{openRound.fixtureIds.length} fixtures</span> : null}
                </h3>
                {!actingAsPlayer && (
                  <button
                    className="btn btn-success btn-sm"
                    onClick={handleCloseRound}
                    disabled={busy || fixturesWithPicks.some(f => pendingFixtureOutcomes[f.id] === undefined) || unpairedTeams.some(t => pendingTeamResults[t] === undefined)}
                  >
                    {busy ? <><span className="spinner" /> Working…</> : 'Close Round'}
                  </button>
                )}
              </div>

              {roundFixtures.length > 0 ? (() => {
                return (
                  <>
                    {fixturesWithPicks.map(f => {
                      const homePicks = picksByTeam.get(f.homeTeamName) ?? [];
                      const awayPicks = picksByTeam.get(f.awayTeamName) ?? [];
                      const outcome = activeOutcome(f.id, pendingFixtureOutcomes);
                      const dateStr = new Date(f.utcDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
                      return (
                        <div key={f.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700 }}>{f.homeTeamName}</span>
                            <span className="text-muted">vs</span>
                            <span style={{ fontWeight: 700 }}>{f.awayTeamName}</span>
                            <span className="text-muted" style={{ fontSize: 13 }}>{dateStr}</span>
                          </div>
                          <div className="text-muted" style={{ fontSize: 13, marginBottom: 6 }}>
                            {homePicks.length > 0 && <span>{f.homeTeamName}: <strong>{homePicks.map(p => p.playerName).join(', ')}</strong></span>}
                            {homePicks.length > 0 && awayPicks.length > 0 && <span> · </span>}
                            {awayPicks.length > 0 && <span>{f.awayTeamName}: <strong>{awayPicks.map(p => p.playerName).join(', ')}</strong></span>}
                          </div>
                          <div style={{ fontSize: 12, color: f.status === 'FINISHED' ? 'var(--accent)' : 'var(--text-muted)', marginBottom: 8 }}>
                            {fixtureResultHint(f)}
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
                                onClick={() => setPendingFixtureOutcomes(prev => ({ ...prev, [f.id]: key }))}
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
                              <button key={r} className={`result-btn ${pendingTeamResults[teamName] === r ? `active-${r}` : ''}`}
                                onClick={() => setPendingTeamResults(prev => ({ ...prev, [teamName]: r }))}>{r}</button>
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
                        <button key={r} className={`result-btn ${pendingTeamResults[teamName] === r ? `active-${r}` : ''}`}
                          onClick={() => setPendingTeamResults(prev => ({ ...prev, [teamName]: r }))}>{r}</button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
          {/* ── Mass Elimination Decision ── */}
          {massEliminationState && (
            <div className="card">
              <h3 className="card-title">All Players Eliminated — Round {massEliminationState.currentRound}</h3>
              <p className="text-muted" style={{ marginBottom: 16 }}>
                All {massEliminationState.candidates.length} remaining players were eliminated in the same round. Choose how to proceed:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Declare a single winner</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      value={massEliminationState.singleWinnerChoice}
                      onChange={e => setMassEliminationState(prev => prev ? { ...prev, singleWinnerChoice: e.target.value } : null)}
                      style={{ flex: 1, minWidth: 140 }}
                    >
                      {massEliminationState.candidates.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleMassEliminationDecision('winner')}
                      disabled={busy || !massEliminationState.singleWinnerChoice}
                    >
                      {busy ? <span className="spinner" /> : 'Declare Winner'}
                    </button>
                  </div>
                </div>
                <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Split the pot</div>
                  <div className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
                    All eliminated players share: {massEliminationState.candidates.join(', ')}
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleMassEliminationDecision('split')}
                    disabled={busy}
                  >
                    {busy ? <span className="spinner" /> : 'Declare Split'}
                  </button>
                </div>
                <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Rollover to next round</div>
                  <div className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
                    Close this round with no eliminations. All players carry forward to round {massEliminationState.currentRound + 1}.
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleMassEliminationDecision('rollover')}
                      disabled={busy}
                    >
                      {busy ? <span className="spinner" /> : 'Rollover'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setMassEliminationState(null)}
                      disabled={busy}
                    >
                      Back
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="card">
          <div className="alert alert-info">No open round. Something may have gone wrong — try reloading.</div>
        </div>
      )}

      {/* ── Notify players ── */}
      {!actingAsPlayer && game.status === 'active' && (
        <div className="card mt-16">
          <div className="section-header">
            <h3 className="section-title" style={{ marginBottom: 0 }}>Notify Players</h3>
            {notifyStatus && (
              <span className="text-muted" style={{ fontSize: 13 }}>{notifyStatus}</span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 12 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleNotify('round-opened')}
              disabled={notifyBusy}
            >
              Round Open
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleNotify('closing-soon')}
              disabled={notifyBusy}
            >
              Closing Soon
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleNotify('eliminated')}
              disabled={notifyBusy}
            >
              Eliminated
            </button>
          </div>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
            Sends a push notification to players who have enabled it. "Eliminated" targets the most recently knocked-out players.
          </p>
        </div>
      )}

      {/* ── Declare Result (end game early) ── */}
      {!actingAsPlayer && game.status === 'active' && activeParticipants.length >= 2 && (
        <div className="card mt-16">
          {!showDeclareResult ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600 }}>End Game Early</div>
                <div className="text-muted" style={{ fontSize: 13 }}>Declare winner(s) without playing further rounds</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowDeclareResult(true)}>
                Declare Result
              </button>
            </div>
          ) : (
            <>
              <h3 className="card-title">Declare Result</h3>
              <p className="text-muted" style={{ marginBottom: 12 }}>
                Select the winner(s). This ends the game immediately.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {activeParticipants.map(p => (
                  <label key={p.id} className="checkbox-row" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={declareResultWinners.has(p.playerName)}
                      onChange={() => setDeclareResultWinners(prev => {
                        const n = new Set(prev);
                        n.has(p.playerName) ? n.delete(p.playerName) : n.add(p.playerName);
                        return n;
                      })}
                      style={{ marginRight: 8 }}
                    />
                    {p.playerName}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  onClick={handleDeclareResult}
                  disabled={busy || declareResultWinners.size === 0}
                >
                  {busy ? <><span className="spinner" /> Working…</> : `Declare ${declareResultWinners.size > 1 ? 'Winners' : 'Winner'}`}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => { setShowDeclareResult(false); setDeclareResultWinners(new Set()); }}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Participants ── */}
      <div className="card mt-16">
        <div className="section-header">
          <h3 className="section-title">Participants ({participants.length})</h3>
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
