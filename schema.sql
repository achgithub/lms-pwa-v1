CREATE TABLE IF NOT EXISTS groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS players (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS games (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  group_id          INTEGER NOT NULL REFERENCES groups(id),
  status            TEXT NOT NULL DEFAULT 'active',
  winner_name       TEXT,
  postpone_as_win   INTEGER NOT NULL DEFAULT 0,
  winner_mode       TEXT NOT NULL DEFAULT 'single',
  rollover_mode     TEXT NOT NULL DEFAULT 'round',
  max_winners       INTEGER NOT NULL DEFAULT 1,
  current_round     INTEGER NOT NULL DEFAULT 1,
  participant_count INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS participants (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id             INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_name         TEXT NOT NULL,
  is_active           INTEGER NOT NULL DEFAULT 1,
  eliminated_in_round INTEGER,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (game_id, player_name)
);

CREATE TABLE IF NOT EXISTS rounds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id      INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS picks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_id      INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  player_name   TEXT NOT NULL,
  team_id       INTEGER REFERENCES teams(id),
  team_name     TEXT,
  result        TEXT,
  auto_assigned INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (game_id, round_id, player_name)
);
