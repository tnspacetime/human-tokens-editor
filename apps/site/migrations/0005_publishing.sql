-- Publishing from Fold MD.
--
-- Connecting: Fold MD asks for a short code, you allow it on the site while
-- signed in, and Fold MD gets a token to publish as you (Better Auth's
-- device-authorization plugin, under our names like 0004; the token is a
-- session). Pending codes live here for a few minutes, then go.
CREATE TABLE device_codes (
  id TEXT PRIMARY KEY,
  device_code TEXT NOT NULL UNIQUE,   -- Fold MD's secret half, polled with
  user_code TEXT NOT NULL UNIQUE,     -- the half you see, like KQ4M-7TXD
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL,               -- 'pending', 'approved', 'denied'
  last_polled_at TEXT,
  polling_interval INTEGER,           -- milliseconds
  client_id TEXT,                     -- 'fold-md'
  scope TEXT
);

-- Which file a post came from: Fold MD keeps an id for each file it
-- publishes and sends it every time, so publishing the same file again
-- fixes that post (only in its fix window, before anyone reacts or comments)
-- instead of making a second one.
ALTER TABLE posts ADD COLUMN source_id TEXT;
CREATE UNIQUE INDEX posts_by_source ON posts (author_id, source_id);

-- When the author last promised they wrote it themselves (at every publish
-- and fix). The sample posts have none.
ALTER TABLE posts ADD COLUMN pledged_at TEXT;
