import type { Game, Participant, Pick, Round, Standing, Team } from './types';

// ── Pick validation ──────────────────────────────────────────────────────────

/** Teams a player has used in closed rounds — unavailable for future picks. */
export function usedTeamNames(
  playerName: string,
  picks: Pick[],
  rounds: Round[]
): Set<string> {
  const closedIds = new Set(rounds.filter(r => r.status === 'closed').map(r => r.id));
  const used = new Set<string>();
  for (const p of picks) {
    if (p.playerName === playerName && closedIds.has(p.roundId) && p.teamName) {
      used.add(p.teamName);
    }
  }
  return used;
}

/** Teams available to a player for the current open round. */
export function availableTeams(
  playerName: string,
  teams: Team[],
  picks: Pick[],
  rounds: Round[]
): Team[] {
  const used = usedTeamNames(playerName, picks, rounds);
  return teams.filter(t => !used.has(t.name));
}

// ── Elimination ──────────────────────────────────────────────────────────────

/** Result values that eliminate a player (respects postponeAsWin flag). */
function isEliminating(result: Pick['result'], postponeAsWin: boolean): boolean {
  if (!result) return false;
  if (result === 'loss' || result === 'draw') return true;
  if (result === 'postponed') return !postponeAsWin;
  return false; // 'win'
}

/**
 * Returns the IDs of participants to eliminate after a round.
 * A participant is eliminated if their pick result is eliminating.
 */
export function computeEliminations(
  activeParticipants: Participant[],
  roundPicks: Pick[],
  postponeAsWin: boolean
): number[] {
  const pickByPlayer = new Map<string, Pick>();
  for (const p of roundPicks) pickByPlayer.set(p.playerName, p);

  const eliminated: number[] = [];
  for (const p of activeParticipants) {
    const pick = pickByPlayer.get(p.playerName);
    if (!pick || isEliminating(pick.result, postponeAsWin)) {
      eliminated.push(p.id);
    }
  }
  return eliminated;
}

// ── Round advancement decision ────────────────────────────────────────────────

export type AdvanceDecision =
  | { action: 'next-round'; nextRoundNumber: number }
  | { action: 'game-over'; winnerNames: string[] }
  | { action: 'rollover' };

/**
 * Determines what happens after a round closes.
 * Called with the participants *after* elimination has been applied.
 */
export function computeAdvanceDecision(
  game: Game,
  survivingParticipants: Participant[],
  allParticipants: Participant[]
): AdvanceDecision {
  const activeCount = survivingParticipants.filter(p => p.isActive).length;

  if (game.winnerMode === 'multiple') {
    // Enough survivors to declare winners
    if (activeCount > 0 && activeCount <= game.maxWinners) {
      return { action: 'game-over', winnerNames: survivingParticipants.filter(p => p.isActive).map(p => p.playerName) };
    }
    // All eliminated — use highest-surviving set or rollover
    if (activeCount === 0) {
      // Check if we can declare winners from last standing before elimination
      const prevActive = allParticipants.filter(p => p.isActive);
      if (prevActive.length <= game.maxWinners) {
        return { action: 'game-over', winnerNames: prevActive.map(p => p.playerName) };
      }
      return { action: 'rollover' };
    }
  } else {
    // single winner mode
    if (activeCount === 1) {
      const winner = survivingParticipants.find(p => p.isActive)!;
      return { action: 'game-over', winnerNames: [winner.playerName] };
    }
    if (activeCount === 0) {
      return { action: 'rollover' };
    }
  }

  return { action: 'next-round', nextRoundNumber: game.currentRound + 1 };
}

// ── Auto-assign ───────────────────────────────────────────────────────────────

/**
 * Assigns available teams to players who haven't picked.
 * Returns an array of {playerName, team} assignments.
 */
function sortByStandings(teams: Team[], standings: Standing[]): Team[] {
  const posMap = new Map(standings.map(s => [s.teamName.toLowerCase(), s.position]));
  return [...teams].sort((a, b) => {
    const pa = posMap.get(a.name.toLowerCase()) ?? 0;
    const pb = posMap.get(b.name.toLowerCase()) ?? 0;
    // Bottom of table first (highest position number), ties broken alphabetically
    if (pb !== pa) return pb - pa;
    return a.name.localeCompare(b.name);
  });
}

export interface AutoAssignment {
  playerName: string;
  team: Team;
  position: number | null;
  standingsUpdatedAt: string | null;
}

export function autoAssignTeams(
  playersWithoutPicks: string[],
  teams: Team[],
  existingPicks: Pick[],
  rounds: Round[],
  standings: Standing[] = [],
): AutoAssignment[] {
  const posMap = new Map(standings.map(s => [s.teamName.toLowerCase(), s]));
  const updatedAt = standings.length > 0 ? standings[0].updatedAt : null;
  const assignments: AutoAssignment[] = [];
  const alreadyAssignedThisRound = new Set(existingPicks.map(p => p.teamName).filter(Boolean));
  const sorted = sortByStandings(teams, standings);

  for (const playerName of playersWithoutPicks) {
    const available = availableTeams(playerName, sorted, existingPicks, rounds).filter(
      t => !alreadyAssignedThisRound.has(t.name)
    );
    const pool = available.length > 0
      ? available
      : availableTeams(playerName, sorted, existingPicks, rounds);

    if (pool.length > 0) {
      const team = pool[0]; // sorted bottom-first, take the first
      const standing = posMap.get(team.name.toLowerCase());
      assignments.push({
        playerName,
        team,
        position: standing?.position ?? null,
        standingsUpdatedAt: standing ? updatedAt : null,
      });
      alreadyAssignedThisRound.add(team.name);
    }
  }

  return assignments;
}
