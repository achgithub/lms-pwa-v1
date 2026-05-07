export type Role = 'admin' | 'manager' | 'player'

export interface AuthUser {
  id: number;
  name: string;
  role: Role;
}

export interface Group {
  id: number;
  name: string;
  teamCount: number;
  createdAt: string;
}

export interface Team {
  id: number;
  groupId: number;
  name: string;
  externalId?: number;
  crestUrl?: string;
  createdAt: string;
}

export interface Player {
  id: number;
  name: string;
  createdAt: string;
}

export type GameStatus = 'active' | 'completed';
export type WinnerMode = 'single' | 'multiple';
export type RolloverMode = 'round' | 'game';
export type PickResult = 'win' | 'loss' | 'draw' | 'postponed';
export type RoundStatus = 'open' | 'closed';

export interface Game {
  id: number;
  name: string;
  groupId: number;
  groupName: string;
  status: GameStatus;
  winnerName?: string;
  postponeAsWin: boolean;
  winnerMode: WinnerMode;
  rolloverMode: RolloverMode;
  maxWinners: number;
  participantCount: number;
  currentRound: number;
  createdAt: string;
}

export interface Participant {
  id: number;
  gameId: number;
  playerName: string;
  isActive: boolean;
  eliminatedInRound?: number;
  createdAt: string;
}

export interface Round {
  id: number;
  gameId: number;
  roundNumber: number;
  status: RoundStatus;
  fixtureIds?: number[];
  createdAt: string;
}

export interface Fixture {
  id: number;
  matchday: number;
  utcDate: string;
  status: string;
  homeTeamName: string;
  awayTeamName: string;
  homeScore?: number;
  awayScore?: number;
  winner?: string;
}

export interface Pick {
  id: number;
  gameId: number;
  roundId: number;
  playerName: string;
  teamId?: number;
  teamName?: string;
  result?: PickResult;
  autoAssigned: boolean;
  createdAt: string;
}

export interface GameDetail {
  game: Game;
  participants: Participant[];
  rounds: Round[];
  picks: Pick[];
}

export interface SyncData {
  groups: Group[];
  teams: Team[];
  players: Player[];
  games: Game[];
  participants: Participant[];
  rounds: Round[];
  picks: Pick[];
}
