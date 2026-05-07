import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { api } from './api/client';
import type {
  Group, Team, Player, Game, Participant, Round, Pick, SyncData, GameDetail,
  Fixture, Standing,
} from './types';

// ── Schema ───────────────────────────────────────────────────────────────────

interface LmsDB extends DBSchema {
  groups:       { key: number; value: Group };
  teams:        { key: number; value: Team;        indexes: { 'by-group': number } };
  players:      { key: number; value: Player };
  games:        { key: number; value: Game };
  participants: { key: number; value: Participant; indexes: { 'by-game': number } };
  rounds:       { key: number; value: Round;       indexes: { 'by-game': number } };
  picks:        { key: number; value: Pick;        indexes: { 'by-game': number; 'by-round': number } };
}

let _db: Promise<IDBPDatabase<LmsDB>> | null = null;

function idb(): Promise<IDBPDatabase<LmsDB>> {
  if (!_db) {
    _db = openDB<LmsDB>('lms-db', 2, {
      upgrade(conn, oldVersion) {
        const stores = ['groups', 'teams', 'players', 'games', 'participants', 'rounds', 'picks'] as const;
        if (oldVersion < 2) {
          for (const s of stores) {
            if (conn.objectStoreNames.contains(s)) conn.deleteObjectStore(s);
          }
        }
        conn.createObjectStore('groups', { keyPath: 'id', autoIncrement: true });
        const teams = conn.createObjectStore('teams', { keyPath: 'id', autoIncrement: true });
        teams.createIndex('by-group', 'groupId');
        conn.createObjectStore('players', { keyPath: 'id', autoIncrement: true });
        conn.createObjectStore('games', { keyPath: 'id', autoIncrement: true });
        const parts = conn.createObjectStore('participants', { keyPath: 'id', autoIncrement: true });
        parts.createIndex('by-game', 'gameId');
        const rounds = conn.createObjectStore('rounds', { keyPath: 'id', autoIncrement: true });
        rounds.createIndex('by-game', 'gameId');
        const picks = conn.createObjectStore('picks', { keyPath: 'id', autoIncrement: true });
        picks.createIndex('by-game', 'gameId');
        picks.createIndex('by-round', 'roundId');
      },
    });
  }
  return _db;
}

export class OfflineError extends Error {
  constructor() {
    super('You are offline. Reconnect to make changes.');
    this.name = 'OfflineError';
  }
}

function requireOnline() {
  if (!navigator.onLine) throw new OfflineError();
}

// ── Offline sync (populate IDB from API snapshot) ─────────────────────────────

export async function importSync(data: SyncData): Promise<void> {
  const conn = await idb();
  const storeNames = ['groups', 'teams', 'players', 'games', 'participants', 'rounds', 'picks'] as const;
  const tx = conn.transaction(storeNames, 'readwrite');
  for (const s of storeNames) tx.objectStore(s).clear();
  for (const r of data.groups)       tx.objectStore('groups').put(r);
  for (const r of data.teams)        tx.objectStore('teams').put(r);
  for (const r of data.players)      tx.objectStore('players').put(r);
  for (const r of data.games)        tx.objectStore('games').put(r);
  for (const r of data.participants) tx.objectStore('participants').put(r);
  for (const r of data.rounds)       tx.objectStore('rounds').put(r);
  for (const r of data.picks)        tx.objectStore('picks').put(r);
  await tx.done;
}

// ── Groups ────────────────────────────────────────────────────────────────────

export async function getGroups(): Promise<Group[]> {
  if (navigator.onLine) return api.get<Group[]>('/groups');
  return (await idb()).getAll('groups');
}

export async function createGroup(name: string): Promise<Group> {
  requireOnline();
  const group = await api.post<Group>('/groups', { name });
  await (await idb()).put('groups', group);
  return group;
}

export async function deleteGroup(id: number): Promise<void> {
  requireOnline();
  await api.delete(`/groups/${id}`);
  const conn = await idb();
  const tx = conn.transaction(['groups', 'teams'], 'readwrite');
  const teams = await tx.objectStore('teams').index('by-group').getAll(id);
  await Promise.all([
    ...teams.map(t => tx.objectStore('teams').delete(t.id)),
    tx.objectStore('groups').delete(id),
    tx.done,
  ]);
}

// ── Teams ─────────────────────────────────────────────────────────────────────

export async function getTeamsByGroup(groupId: number): Promise<Team[]> {
  if (navigator.onLine) return api.get<Team[]>(`/groups/${groupId}/teams`);
  return (await idb()).getAllFromIndex('teams', 'by-group', groupId);
}

export async function createTeam(groupId: number, name: string): Promise<Team> {
  requireOnline();
  const team = await api.post<Team>(`/groups/${groupId}/teams`, { name });
  const conn = await idb();
  const tx = conn.transaction(['teams', 'groups'], 'readwrite');
  await tx.objectStore('teams').put(team);
  const group = await tx.objectStore('groups').get(groupId);
  if (group) await tx.objectStore('groups').put({ ...group, teamCount: group.teamCount + 1 });
  await tx.done;
  return team;
}

export async function deleteTeam(teamId: number, groupId: number): Promise<void> {
  requireOnline();
  await api.delete(`/teams/${teamId}`);
  const conn = await idb();
  const tx = conn.transaction(['teams', 'groups'], 'readwrite');
  await tx.objectStore('teams').delete(teamId);
  const group = await tx.objectStore('groups').get(groupId);
  if (group && group.teamCount > 0) {
    await tx.objectStore('groups').put({ ...group, teamCount: group.teamCount - 1 });
  }
  await tx.done;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

export async function getAllFixtures(): Promise<Fixture[]> {
  return api.get<Fixture[]>('/fixtures');
}

export async function getStandings(): Promise<Standing[]> {
  return api.get<Standing[]>('/standings');
}

export async function setRoundFixtures(roundId: number, fixtureIds: number[]): Promise<Round> {
  return api.patch<Round>(`/rounds/${roundId}/fixtures`, { fixtureIds });
}

// ── Players ───────────────────────────────────────────────────────────────────

export async function getPlayers(): Promise<Player[]> {
  if (navigator.onLine) return api.get<Player[]>('/players');
  return (await idb()).getAll('players');
}

export async function createPlayer(name: string): Promise<Player> {
  requireOnline();
  const player = await api.post<Player>('/players', { name });
  await (await idb()).put('players', player);
  return player;
}

export async function deletePlayer(id: number): Promise<void> {
  requireOnline();
  await api.delete(`/players/${id}`);
  await (await idb()).delete('players', id);
}

// ── Games ─────────────────────────────────────────────────────────────────────

export async function getGames(asPlayer = false): Promise<Game[]> {
  if (navigator.onLine) return api.get<Game[]>(asPlayer ? '/games?view=player' : '/games');
  return (await idb()).getAll('games');
}

export async function getGameDetail(gameId: number, asPlayer = false): Promise<GameDetail | null> {
  if (navigator.onLine) {
    return api.get<GameDetail>(asPlayer ? `/games/${gameId}?view=player` : `/games/${gameId}`);
  }
  // Offline: assemble from IDB
  const conn = await idb();
  const game = await conn.get('games', gameId);
  if (!game) return null;
  const [participants, rounds, picks] = await Promise.all([
    conn.getAllFromIndex('participants', 'by-game', gameId),
    conn.getAllFromIndex('rounds', 'by-game', gameId),
    conn.getAllFromIndex('picks', 'by-game', gameId),
  ]);
  return { game, participants, rounds, picks };
}

export interface CreateGameParams {
  name: string;
  groupId: number;
  playerNames: string[];
  postponeAsWin: boolean;
}

export async function createGame(params: CreateGameParams): Promise<Game> {
  requireOnline();
  const game = await api.post<Game>('/games', params);
  await (await idb()).put('games', game);
  return game;
}

export async function deleteGame(id: number): Promise<void> {
  requireOnline();
  await api.delete(`/games/${id}`);
  const conn = await idb();
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

// ── Participants ──────────────────────────────────────────────────────────────

export async function addParticipant(gameId: number, playerName: string): Promise<Participant> {
  requireOnline();
  const participant = await api.post<Participant>(`/games/${gameId}/participants`, { playerName });
  const conn = await idb();
  const tx = conn.transaction(['participants', 'games'], 'readwrite');
  await tx.objectStore('participants').put(participant);
  const game = await tx.objectStore('games').get(gameId);
  if (game) await tx.objectStore('games').put({ ...game, participantCount: game.participantCount + 1 });
  await tx.done;
  return participant;
}

// ── Picks ─────────────────────────────────────────────────────────────────────

export async function getPicks(gameId: number): Promise<Pick[]> {
  if (navigator.onLine) {
    const detail = await api.get<GameDetail>(`/games/${gameId}`);
    return detail.picks;
  }
  return (await idb()).getAllFromIndex('picks', 'by-game', gameId);
}

export async function upsertPick(pick: Omit<Pick, 'id' | 'createdAt'> & { id?: number }): Promise<Pick> {
  requireOnline();
  const saved = await api.put<Pick>('/picks', pick);
  await (await idb()).put('picks', saved);
  return saved;
}

export async function deletePick(id: number): Promise<void> {
  requireOnline();
  await api.delete(`/picks/${id}`);
  await (await idb()).delete('picks', id);
}

// ── Round advancement ─────────────────────────────────────────────────────────

export interface AdvanceRoundParams {
  gameId: number;
  currentRound: number;
  openRoundId: number;
  eliminatedParticipantIds: number[];
  nextRoundNumber: number | null;
  winnerNames?: string[];
}

export async function advanceRound(params: AdvanceRoundParams): Promise<Game> {
  requireOnline();
  const game = await api.post<Game>(`/games/${params.gameId}/advance`, params);
  await (await idb()).put('games', game);
  return game;
}

export interface RolloverParams {
  gameId: number;
  currentRound: number;
  openRoundId: number;
  rolloverMode: 'round' | 'game';
}

export async function rolloverGame(params: RolloverParams): Promise<Game> {
  requireOnline();
  const game = await api.post<Game>(`/games/${params.gameId}/rollover`, params);
  await (await idb()).put('games', game);
  return game;
}

export async function voidRound(gameId: number, openRoundId: number): Promise<void> {
  requireOnline();
  await api.post(`/games/${gameId}/void-round`, { openRoundId });
}

export async function declareResult(gameId: number, winnerNames: string[]): Promise<Game> {
  requireOnline();
  const game = await api.post<Game>(`/games/${gameId}/declare-result`, { winnerNames });
  await (await idb()).put('games', game);
  return game;
}

// ── Export / Import (local backup) ───────────────────────────────────────────

export interface BackupData {
  version: 2;
  exportedAt: string;
  groups: Group[];
  teams: Team[];
  players: Player[];
  games: Game[];
  participants: Participant[];
  rounds: Round[];
  picks: Pick[];
}

export async function exportData(): Promise<BackupData> {
  const conn = await idb();
  const [groups, teams, players, games, participants, rounds, picks] = await Promise.all([
    conn.getAll('groups'), conn.getAll('teams'), conn.getAll('players'),
    conn.getAll('games'), conn.getAll('participants'), conn.getAll('rounds'), conn.getAll('picks'),
  ]);
  return { version: 2, exportedAt: new Date().toISOString(), groups, teams, players, games, participants, rounds, picks };
}

export async function importData(json: string): Promise<void> {
  const data = JSON.parse(json) as Partial<BackupData>;
  if (data.version !== 2) throw new Error('Unrecognised backup format (expected version 2)');
  const storeNames = ['groups', 'teams', 'players', 'games', 'participants', 'rounds', 'picks'] as const;
  const conn = await idb();
  const tx = conn.transaction(storeNames, 'readwrite');
  for (const s of storeNames) tx.objectStore(s).clear();
  for (const r of data.groups       ?? []) tx.objectStore('groups').put(r);
  for (const r of data.teams        ?? []) tx.objectStore('teams').put(r);
  for (const r of data.players      ?? []) tx.objectStore('players').put(r);
  for (const r of data.games        ?? []) tx.objectStore('games').put(r);
  for (const r of data.participants ?? []) tx.objectStore('participants').put(r);
  for (const r of data.rounds       ?? []) tx.objectStore('rounds').put(r);
  for (const r of data.picks        ?? []) tx.objectStore('picks').put(r);
  await tx.done;
}
