ALTER TABLE participants ADD COLUMN user_id INTEGER REFERENCES users(id);
