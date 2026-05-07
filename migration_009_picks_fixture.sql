ALTER TABLE picks ADD COLUMN fixture_id INTEGER REFERENCES fixtures(id);
