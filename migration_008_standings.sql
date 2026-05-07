CREATE TABLE IF NOT EXISTS standings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id INTEGER NOT NULL UNIQUE,
  team_name   TEXT NOT NULL,
  position    INTEGER NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
