import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Group,
  Team,
  Player,
  Game,
  Participant,
  Round,
  Pick,
} from './types';

// ── Schema ──────────────────────────────────────────────────────────────────

// Games are stored without the computed groupName field
type StoredGame = Omit<Game, 'groupName'>;

// Strip id before passing to add() so autoIncrement generates the key
type New<T extends { id: number }> = Omit<T, 'id'>;

interface LmsDB extends DBSchema {
  groups: { key: number; value: Group };
  teams: {
    key: number;
    value: Team;
    indexes: { 'by-group': number };
  };
  players: { key: number; value: Player };
  games: { key: number; value: StoredGame };
  participants: {
    key: number;
    value: Participant;
    indexes: { 'by-game': number };
  };
  rounds: {
    key: number;
    value: Round;
    indexes: { 'by-game': number };
  };
  picks: {
    key: number;
    value: Pick;
    indexes: { 'by-game': number; 'by-round': number };
  };
}

let _db: Promise<IDBPDatabase<LmsDB>> | null = null;

function db(): Promise<IDBPDatabase<LmsDB>> {
  if (!_db) {
    _db = openDB<LmsDB>('lms-db', 1, {
      upgrade(db) {
        db.createObjectStore('groups', { keyPath: 'id', autoIncrement: true });

        const teams = db.createObjectStore('teams', { keyPath: 'id', autoIncrement: true });
        teams.createIndex('by-group', 'groupId');

        db.createObjectStore('players', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('games', { keyPath: 'id', autoIncrement: true });

        const parts = db.createObjectStore('participants', { keyPath: 'id', autoIncrement: true });
        parts.createIndex('by-game', 'gameId');

        const rounds = db.createObjectStore('rounds', { keyPath: 'id', autoIncrement: true });
        rounds.createIndex('by-game', 'gameId');

        const picks = db.createObjectStore('picks', { keyPath: 'id', autoIncrement: true });
        picks.createIndex('by-game', 'gameId');
        picks.createIndex('by-round', 'roundId');
      },
    });
  }
  return _db;
}

async function enrichGame(stored: StoredGame): Promise<Game> {
  const conn = await db();
  const group = await conn.get('groups', stored.groupId);
  return { ...stored, groupName: group?.name ?? 'Unknown' };
}

// ── Groups ───────────────────────────────────────────────────────────────────

export async function getGroups(): Promise<Group[]> {
  return (await db()).getAll('groups');
}

export async function createGroup(name: string): Promise<Group> {
  const conn = await db();
  const now = new Date().toISOString();
  const record: New<Group> = { name, teamCount: 0, createdAt: now };
  const id = await conn.add('groups', record as Group);
  return { ...record, id };
}

export async function deleteGroup(id: number): Promise<void> {
  const conn = await db();
  const tx = conn.transaction(['groups', 'teams'], 'readwrite');
  const teams = await tx.objectStore('teams').index('by-group').getAll(id);
  await Promise.all([
    ...teams.map(t => tx.objectStore('teams').delete(t.id)),
    tx.objectStore('groups').delete(id),
    tx.done,
  ]);
}

// ── Teams ────────────────────────────────────────────────────────────────────

export async function getTeamsByGroup(groupId: number): Promise<Team[]> {
  return (await db()).getAllFromIndex('teams', 'by-group', groupId);
}

export async function createTeam(groupId: number, name: string): Promise<Team> {
  const conn = await db();
  const now = new Date().toISOString();
  const record: New<Team> = { groupId, name, createdAt: now };
  const tx = conn.transaction(['teams', 'groups'], 'readwrite');
  const id = await tx.objectStore('teams').add(record as Team);
  const group = await tx.objectStore('groups').get(groupId);
  if (group) {
    await tx.objectStore('groups').put({ ...group, teamCount: group.teamCount + 1 });
  }
  await tx.done;
  return { ...record, id };
}

export async function deleteTeam(teamId: number, groupId: number): Promise<void> {
  const conn = await db();
  const tx = conn.transaction(['teams', 'groups'], 'readwrite');
  await tx.objectStore('teams').delete(teamId);
  const group = await tx.objectStore('groups').get(groupId);
  if (group && group.teamCount > 0) {
    await tx.objectStore('groups').put({ ...group, teamCount: group.teamCount - 1 });
  }
  await tx.done;
}

// ── Players ──────────────────────────────────────────────────────────────────

export async function getPlayers(): Promise<Player[]> {
  return (await db()).getAll('players');
}

export async function createPlayer(name: string): Promise<Player> {
  const conn = await db();
  const now = new Date().toISOString();
  const record: New<Player> = { name, createdAt: now };
  const id = await conn.add('players', record as Player);
  return { ...record, id };
}

export async function deletePlayer(id: number): Promise<void> {
  return (await db()).delete('players', id);
}

// ── Games ────────────────────────────────────────────────────────────────────

export async function getGames(): Promise<Game[]> {
  const stored = await (await db()).getAll('games');
  return Promise.all(stored.map(enrichGame));
}

export async function getGame(id: number): Promise<Game | undefined> {
  const stored = await (await db()).get('games', id);
  if (!stored) return undefined;
  return enrichGame(stored);
}

export interface CreateGameParams {
  name: string;
  groupId: number;
  playerNames: string[];
  postponeAsWin: boolean;
  winnerMode: 'single' | 'multiple';
  rolloverMode: 'round' | 'game';
  maxWinners: number;
}

export async function createGame(params: CreateGameParams): Promise<Game> {
  const conn = await db();
  const now = new Date().toISOString();

  const gameRecord: New<StoredGame> = {
    name: params.name,
    groupId: params.groupId,
    status: 'active',
    postponeAsWin: params.postponeAsWin,
    winnerMode: params.winnerMode,
    rolloverMode: params.rolloverMode,
    maxWinners: params.maxWinners,
    participantCount: params.playerNames.length,
    currentRound: 1,
    createdAt: now,
  };

  const tx = conn.transaction(['games', 'participants', 'rounds'], 'readwrite');
  const gameId = await tx.objectStore('games').add(gameRecord as StoredGame);

  await Promise.all([
    ...params.playerNames.map(playerName =>
      tx.objectStore('participants').add({
        gameId,
        playerName,
        isActive: true,
        createdAt: now,
      } as Participant)
    ),
    tx.objectStore('rounds').add({
      gameId,
      roundNumber: 1,
      status: 'open',
      createdAt: now,
    } as Round),
    tx.done,
  ]);

  return enrichGame({ ...gameRecord, id: gameId });
}

export async function deleteGame(id: number): Promise<void> {
  const conn = await db();
  const tx = conn.transaction(['games', 'participants', 'rounds', 'picks'], 'readwrite');
  const [participants, rounds, picks] = await Promise.all([
    tx.objectStore('participants').index('by-game').getAll(id),
    tx.objectStore('rounds').index('by-game').getAll(id),
    tx.objectStore('picks').index('by-game').getAll(id),
  ]);
  await Promise.all([
    ...participants.map(p => tx.objectStore('participants').delete(p.id)),
    ...rounds.map(r => tx.objectStore('rounds').delete(r.id)),
    ...picks.map(p => tx.objectStore('picks').delete(p.id)),
    tx.objectStore('games').delete(id),
    tx.done,
  ]);
}

// ── Participants ─────────────────────────────────────────────────────────────

export async function getParticipants(gameId: number): Promise<Participant[]> {
  return (await db()).getAllFromIndex('participants', 'by-game', gameId);
}

export async function addParticipant(gameId: number, playerName: string): Promise<Participant> {
  const conn = await db();
  const now = new Date().toISOString();
  const record: New<Participant> = { gameId, playerName, isActive: true, createdAt: now };
  const tx = conn.transaction(['participants', 'games'], 'readwrite');
  const id = await tx.objectStore('participants').add(record as Participant);
  const game = await tx.objectStore('games').get(gameId);
  if (game) {
    await tx.objectStore('games').put({ ...game, participantCount: game.participantCount + 1 });
  }
  await tx.done;
  return { ...record, id };
}

// ── Rounds ───────────────────────────────────────────────────────────────────

export async function getRounds(gameId: number): Promise<Round[]> {
  return (await db()).getAllFromIndex('rounds', 'by-game', gameId);
}

// ── Picks ────────────────────────────────────────────────────────────────────

export async function getPicks(gameId: number): Promise<Pick[]> {
  return (await db()).getAllFromIndex('picks', 'by-game', gameId);
}

export async function getPicksByRound(roundId: number): Promise<Pick[]> {
  return (await db()).getAllFromIndex('picks', 'by-round', roundId);
}

export async function upsertPick(pick: Omit<Pick, 'id' | 'createdAt'> & { id?: number }): Promise<Pick> {
  const conn = await db();
  const now = new Date().toISOString();
  if (pick.id) {
    const existing = await conn.get('picks', pick.id);
    if (existing) {
      const updated = { ...existing, ...pick } as Pick;
      await conn.put('picks', updated);
      return updated;
    }
  }
  const { id: _omit, ...rest } = { ...pick, id: undefined };
  void _omit;
  const newPick: New<Pick> = { ...rest, createdAt: now };
  const id = await conn.add('picks', newPick as Pick);
  return { ...newPick, id };
}

export async function deletePick(id: number): Promise<void> {
  return (await db()).delete('picks', id);
}

// ── Round advancement (main game-state mutation) ──────────────────────────────

export interface AdvanceRoundParams {
  gameId: number;
  currentRound: number;
  openRoundId: number;
  eliminatedParticipantIds: number[];
  nextRoundNumber: number | null; // null = game over
  winnerNames?: string[];
}

export async function advanceRound(params: AdvanceRoundParams): Promise<Game> {
  const conn = await db();
  const now = new Date().toISOString();

  const tx = conn.transaction(['games', 'participants', 'rounds'], 'readwrite');
  const participantsStore = tx.objectStore('participants');
  const roundsStore = tx.objectStore('rounds');
  const gamesStore = tx.objectStore('games');

  // Eliminate players
  await Promise.all(
    params.eliminatedParticipantIds.map(async pid => {
      const p = await participantsStore.get(pid);
      if (p) {
        await participantsStore.put({ ...p, isActive: false, eliminatedInRound: params.currentRound });
      }
    })
  );

  // Close the open round
  const openRound = await roundsStore.get(params.openRoundId);
  if (openRound) {
    await roundsStore.put({ ...openRound, status: 'closed' });
  }

  // Update the game
  const game = await gamesStore.get(params.gameId);
  if (!game) throw new Error('Game not found');

  let updatedGame: StoredGame;
  if (params.nextRoundNumber === null) {
    updatedGame = { ...game, status: 'completed', winnerName: params.winnerNames?.join(', ') };
  } else {
    await roundsStore.add({
      gameId: params.gameId,
      roundNumber: params.nextRoundNumber,
      status: 'open',
      createdAt: now,
    } as Round);
    updatedGame = { ...game, currentRound: params.nextRoundNumber };
  }

  await gamesStore.put(updatedGame);
  await tx.done;

  return enrichGame(updatedGame);
}

// Rollover: restore all players, optionally reset picks/rounds
export interface RolloverParams {
  gameId: number;
  currentRound: number;
  openRoundId: number;
  rolloverMode: 'round' | 'game';
}

export async function rolloverGame(params: RolloverParams): Promise<Game> {
  const conn = await db();
  const now = new Date().toISOString();

  const tx = conn.transaction(['games', 'participants', 'rounds', 'picks'], 'readwrite');
  const participantsStore = tx.objectStore('participants');
  const roundsStore = tx.objectStore('rounds');
  const picksStore = tx.objectStore('picks');
  const gamesStore = tx.objectStore('games');

  // Restore all participants
  const allParticipants = await participantsStore.index('by-game').getAll(params.gameId);
  await Promise.all(
    allParticipants.map(p =>
      participantsStore.put({ ...p, isActive: true, eliminatedInRound: undefined })
    )
  );

  const game = await gamesStore.get(params.gameId);
  if (!game) throw new Error('Game not found');

  let nextRound: number;

  if (params.rolloverMode === 'game') {
    const allRounds = await roundsStore.index('by-game').getAll(params.gameId);
    const allPicks = await picksStore.index('by-game').getAll(params.gameId);
    await Promise.all([
      ...allRounds.map(r => roundsStore.delete(r.id)),
      ...allPicks.map(p => picksStore.delete(p.id)),
    ]);
    await roundsStore.add({
      gameId: params.gameId,
      roundNumber: 1,
      status: 'open',
      createdAt: now,
    } as Round);
    nextRound = 1;
  } else {
    const openRound = await roundsStore.get(params.openRoundId);
    if (openRound) await roundsStore.put({ ...openRound, status: 'closed' });
    const roundPicks = await picksStore.index('by-round').getAll(params.openRoundId);
    await Promise.all(roundPicks.map(p => picksStore.delete(p.id)));
    await roundsStore.add({
      gameId: params.gameId,
      roundNumber: params.currentRound,
      status: 'open',
      createdAt: now,
    } as Round);
    nextRound = params.currentRound;
  }

  const updatedGame: StoredGame = { ...game, currentRound: nextRound, status: 'active', winnerName: undefined };
  await gamesStore.put(updatedGame);
  await tx.done;

  return enrichGame(updatedGame);
}

// ── Export / Import ───────────────────────────────────────────────────────────

export interface BackupData {
  version: 1;
  exportedAt: string;
  groups: Group[];
  teams: Team[];
  players: Player[];
  games: StoredGame[];
  participants: Participant[];
  rounds: Round[];
  picks: Pick[];
}

/** Reads every store and returns a serialisable backup object. */
export async function exportData(): Promise<BackupData> {
  const conn = await db();
  const [groups, teams, players, games, participants, rounds, picks] = await Promise.all([
    conn.getAll('groups'),
    conn.getAll('teams'),
    conn.getAll('players'),
    conn.getAll('games'),
    conn.getAll('participants'),
    conn.getAll('rounds'),
    conn.getAll('picks'),
  ]);
  return { version: 1, exportedAt: new Date().toISOString(), groups, teams, players, games, participants, rounds, picks };
}

/**
 * Clears every store then restores from a backup.
 * All operations run in one transaction so a parse error leaves data untouched.
 */
export async function importData(json: string): Promise<void> {
  const data = JSON.parse(json) as Partial<BackupData>;
  if (data.version !== 1) throw new Error('Unrecognised backup format (expected version 1)');

  const storeNames = ['groups', 'teams', 'players', 'games', 'participants', 'rounds', 'picks'] as const;
  const conn = await db();
  const tx = conn.transaction(storeNames, 'readwrite');

  // Queue all clears first — IDB processes requests in order within a transaction
  for (const s of storeNames) tx.objectStore(s).clear();

  // Queue all puts (ids are preserved so foreign keys stay intact)
  for (const r of data.groups       ?? []) tx.objectStore('groups').put(r);
  for (const r of data.teams        ?? []) tx.objectStore('teams').put(r);
  for (const r of data.players      ?? []) tx.objectStore('players').put(r);
  for (const r of data.games        ?? []) tx.objectStore('games').put(r);
  for (const r of data.participants ?? []) tx.objectStore('participants').put(r);
  for (const r of data.rounds       ?? []) tx.objectStore('rounds').put(r);
  for (const r of data.picks        ?? []) tx.objectStore('picks').put(r);

  await tx.done;
}
