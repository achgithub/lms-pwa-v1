ALTER TABLE teams ADD COLUMN external_id INTEGER;
ALTER TABLE teams ADD COLUMN crest_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS teams_group_external ON teams (group_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS fixtures (
  id             INTEGER PRIMARY KEY,  -- football-data.org match id
  matchday       INTEGER NOT NULL,
  utc_date       TEXT NOT NULL,
  status         TEXT NOT NULL,        -- SCHEDULED, TIMED, FINISHED, POSTPONED, CANCELLED
  home_team_name TEXT NOT NULL,
  away_team_name TEXT NOT NULL,
  home_score     INTEGER,
  away_score     INTEGER,
  winner         TEXT,                 -- HOME_TEAM, AWAY_TEAM, DRAW, null
  last_synced    TEXT NOT NULL
);
