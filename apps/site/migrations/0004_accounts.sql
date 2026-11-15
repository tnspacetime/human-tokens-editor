-- Sign-in, run by Better Auth (src/server/auth.server.ts). Its four tables,
-- with our snake_case column names (the config maps them): a user is a
-- person on the site; they get in through accounts (Google, GitHub) and stay
-- in through sessions; verifications hold short-lived values such as OAuth
-- state. Dates are ISO text and booleans 0/1, as Better Auth writes them on
-- SQLite. Reactions and comments now belong to a user, and an author is the
-- public face of a user who publishes.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                 -- shown on their comments
  email TEXT NOT NULL UNIQUE,         -- never shown
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX sessions_by_user ON sessions (user_id);

-- One way in. Google and GitHub accounts with the same verified email lead
-- to the same user.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,           -- the provider's id for the person
  provider_id TEXT NOT NULL,          -- 'google', 'github'
  access_token TEXT,                  -- encrypted (encryptOAuthTokens)
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  scope TEXT,
  password TEXT,                      -- unused: no passwords here
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider_id, account_id)
);
CREATE INDEX accounts_by_user ON accounts (user_id);

CREATE TABLE verifications (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX verifications_by_identifier ON verifications (identifier);

-- Which user writes as this author: they see the author's tools on their
-- own pieces. One author per user.
ALTER TABLE authors ADD COLUMN user_id TEXT REFERENCES users(id);
CREATE UNIQUE INDEX authors_by_user ON authors (user_id);

-- The prototype's anonymous readers become users with no way to sign in
-- (no account, a placeholder address), so what they already said counts.
INSERT OR IGNORE INTO users (id, name, email, created_at, updated_at)
  SELECT reader_id, reader_name, reader_id || '@readers.invalid', MIN(created_at), MIN(created_at)
  FROM comments GROUP BY reader_id;
INSERT OR IGNORE INTO users (id, name, email, created_at, updated_at)
  SELECT reader_id, 'Reader ' || upper(substr(reader_id, 1, 4)), reader_id || '@readers.invalid', MIN(created_at), MIN(created_at)
  FROM reactions GROUP BY reader_id;

-- Reactions and comments are rebuilt to point at users (SQLite can't add a
-- foreign key in place). A comment's name now comes from its user.
CREATE TABLE reactions_next (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quality TEXT NOT NULL CHECK (quality IN ('novel', 'fresh', 'clear', 'sharp', 'moving')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id, quality)
);
INSERT INTO reactions_next (post_id, user_id, quality, created_at)
  SELECT post_id, reader_id, quality, created_at FROM reactions;
DROP TABLE reactions;
ALTER TABLE reactions_next RENAME TO reactions;
CREATE INDEX reactions_by_time ON reactions (created_at, post_id, quality, user_id);

CREATE TABLE comments_next (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (post_id, user_id)
);
INSERT INTO comments_next (id, post_id, user_id, body, author_note, created_at, updated_at)
  SELECT id, post_id, reader_id, body, author_note, created_at, updated_at FROM comments;
DROP TABLE comments;
ALTER TABLE comments_next RENAME TO comments;
CREATE INDEX comments_by_post ON comments (post_id, created_at);
