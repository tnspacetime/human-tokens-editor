-- A P.S.: a short note the author adds under a published piece, sent from
-- Fold MD. A piece's text gets locked once readers react, so this is how
-- an author adds a correction or a thought afterwards. Each is dated and
-- pledged, and never edited or removed; it goes when its piece does.
CREATE TABLE postscripts (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  pledged_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX postscripts_by_post ON postscripts (post_id, created_at);
