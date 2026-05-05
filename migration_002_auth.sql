CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','manager','player')),
  passcode_hash TEXT NOT NULL,
  passcode_salt TEXT NOT NULL,
  created_by    INTEGER REFERENCES users(id),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS users_name_ci ON users (name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS invite_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL CHECK (role IN ('manager','player')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  used_at    TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE games  ADD COLUMN manager_id INTEGER REFERENCES users(id);
ALTER TABLE groups ADD COLUMN manager_id INTEGER REFERENCES users(id);
