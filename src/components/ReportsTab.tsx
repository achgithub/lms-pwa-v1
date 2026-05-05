import { useEffect, useState, useCallback } from 'react';
import type { Game, Participant, Round, Pick } from '../types';
import * as db from '../db';
import { useAuth } from '../contexts/AuthContext';

export default function ReportsTab() {
  const { actingAsPlayer } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<number | ''>('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [filterRound, setFilterRound] = useState<number | 'all'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    db.getGames(actingAsPlayer).then(setGames).catch(e => setError(String(e)));
  }, [actingAsPlayer]);

  const loadGame = useCallback(async (gameId: number) => {
    setLoading(true);
    setError('');
    try {
      const detail = await db.getGameDetail(gameId);
      if (!detail) return;
      setParticipants(detail.participants);
      setRounds(detail.rounds);
      setPicks(detail.picks);
      setFilterRound('all');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  function handleGameSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value ? Number(e.target.value) : '';
    setSelectedGameId(id);
    if (id) loadGame(id);
  }

  const selectedGame = games.find(g => g.id === selectedGameId);
  const displayRounds = filterRound === 'all'
    ? rounds
    : rounds.filter(r => r.roundNumber === filterRound);

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="section-header">
          <h2 className="section-title">Reports</h2>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Select Game</label>
            <select value={selectedGameId} onChange={handleGameSelect}>
              <option value="">Choose a game…</option>
              {games.map(g => (
                <option key={g.id} value={g.id}>
                  {g.name} — {g.groupName} ({g.status})
                </option>
              ))}
            </select>
          </div>

          {rounds.length > 0 && (
            <div className="form-group">
              <label>Filter Round</label>
              <select
                value={filterRound}
                onChange={e => setFilterRound(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              >
                <option value="all">All Rounds</option>
                {rounds.map(r => (
                  <option key={r.id} value={r.roundNumber}>Round {r.roundNumber}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {loading && <div className="empty-state mt-24"><span className="spinner" /></div>}

      {selectedGame && !loading && (
        <>
          {/* ── Game Summary ── */}
          <div className="card">
            <h3 className="card-title">{selectedGame.name}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 16 }}>
              <Stat label="Group" value={selectedGame.groupName} />
              <Stat label="Status" value={<span className={`badge badge-${selectedGame.status}`}>{selectedGame.status}</span>} />
              <Stat label="Players" value={selectedGame.participantCount} />
              <Stat label="Current Round" value={selectedGame.currentRound} />
              <Stat label="Winner Mode" value={selectedGame.winnerMode} />
              <Stat label="Rollover" value={selectedGame.rolloverMode} />
              <Stat label="Postpone = Win" value={selectedGame.postponeAsWin ? 'Yes' : 'No'} />
              {selectedGame.winnerName && (
                <Stat label="Winner" value={<strong style={{ color: 'var(--warning)' }}>{selectedGame.winnerName}</strong>} />
              )}
            </div>
          </div>

          {/* ── Participant Standings ── */}
          <div className="card">
            <h3 className="card-title">Standings</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Status</th>
                    <th>Eliminated Round</th>
                    <th>Picks (W/L/D/P)</th>
                  </tr>
                </thead>
                <tbody>
                  {[...participants]
                    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || (a.eliminatedInRound ?? 999) - (b.eliminatedInRound ?? 999))
                    .map(p => {
                      const playerPicks = picks.filter(pk => pk.playerName === p.playerName);
                      const w = playerPicks.filter(pk => pk.result === 'win').length;
                      const l = playerPicks.filter(pk => pk.result === 'loss').length;
                      const d = playerPicks.filter(pk => pk.result === 'draw').length;
                      const pp = playerPicks.filter(pk => pk.result === 'postponed').length;
                      return (
                        <tr key={p.id}>
                          <td style={{ fontWeight: 500 }}>{p.playerName}</td>
                          <td>
                            {p.isActive
                              ? <span className="badge badge-active">Active</span>
                              : <span className="badge badge-completed">Eliminated</span>
                            }
                          </td>
                          <td className="text-muted">{p.eliminatedInRound ? `Round ${p.eliminatedInRound}` : '—'}</td>
                          <td>
                            <span className="text-success">{w}W</span>
                            {' / '}
                            <span className="text-danger">{l}L</span>
                            {' / '}
                            <span className="text-warning">{d}D</span>
                            {' / '}
                            <span className="text-info">{pp}P</span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Round Breakdown ── */}
          {displayRounds.length > 0 && (
            <div className="card">
              <h3 className="card-title">
                {filterRound === 'all' ? 'All Rounds' : `Round ${filterRound}`}
              </h3>
              {displayRounds.map(round => {
                const roundPicks = picks.filter(p => p.roundId === round.id);
                const teamNames = [...new Set(roundPicks.map(p => p.teamName).filter(Boolean))] as string[];

                // Team stats
                const teamStats = teamNames.map(team => {
                  const tpicks = roundPicks.filter(p => p.teamName === team);
                  const result = tpicks[0]?.result;
                  return { team, players: tpicks.map(p => p.playerName), result };
                });

                const eliminated = participants.filter(p => p.eliminatedInRound === round.roundNumber);

                return (
                  <div key={round.id} style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <span style={{ fontWeight: 700 }}>Round {round.roundNumber}</span>
                      <span className={`badge badge-${round.status}`}>{round.status}</span>
                      {round.status === 'closed' && (
                        <span className="text-muted" style={{ fontSize: 13 }}>
                          {eliminated.length} eliminated
                        </span>
                      )}
                    </div>

                    {teamStats.length > 0 ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Team</th>
                              <th>Players</th>
                              <th>Result</th>
                            </tr>
                          </thead>
                          <tbody>
                            {teamStats.map(({ team, players: ps, result }) => (
                              <tr key={team}>
                                <td style={{ fontWeight: 500 }}>{team}</td>
                                <td className="text-muted">{ps.join(', ')}</td>
                                <td>
                                  {result ? (
                                    <span className={`text-${result === 'win' ? 'success' : result === 'loss' ? 'danger' : result === 'draw' ? 'warning' : 'info'}`}>
                                      {result}
                                    </span>
                                  ) : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-muted" style={{ fontSize: 13 }}>No picks recorded.</p>
                    )}

                    {round.status === 'closed' && eliminated.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <span className="text-muted" style={{ fontSize: 13 }}>Eliminated: </span>
                        <span style={{ fontSize: 13, color: 'var(--danger)' }}>{eliminated.map(p => p.playerName).join(', ')}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {!selectedGameId && !loading && (
        <div className="card">
          <p className="empty-state">Select a game above to view its report.</p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{value}</div>
    </div>
  );
}
