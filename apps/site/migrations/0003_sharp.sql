-- A fifth quality, Sharp: well reasoned, it holds up. SQLite can't change a
-- CHECK in place, so the table is rebuilt with the new list and its rows
-- copied across.
CREATE TABLE reactions_next (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reader_id TEXT NOT NULL,
  quality TEXT NOT NULL CHECK (quality IN ('novel', 'fresh', 'clear', 'sharp', 'moving')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, reader_id, quality)
);
INSERT INTO reactions_next (post_id, reader_id, quality, created_at)
  SELECT post_id, reader_id, quality, created_at FROM reactions;
DROP TABLE reactions;
ALTER TABLE reactions_next RENAME TO reactions;
CREATE INDEX reactions_by_time ON reactions (created_at, post_id, quality, reader_id);
