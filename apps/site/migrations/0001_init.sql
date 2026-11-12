-- Prototype schema. Readers are anonymous ids from a cookie until sign-in
-- (Google, GitHub) exists; then they become users.

CREATE TABLE authors (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  bio TEXT
);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,                -- the permanent part of /p/<id>/<slug>
  author_id TEXT NOT NULL REFERENCES authors(id),
  slug TEXT NOT NULL,                 -- cosmetic; follows the title
  title TEXT NOT NULL,
  excerpt TEXT,
  markdown TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  allow_debate INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX posts_by_date ON posts (published_at DESC);

-- How a post read to someone: a few named qualities instead of likes.
CREATE TABLE reactions (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reader_id TEXT NOT NULL,
  quality TEXT NOT NULL CHECK (quality IN ('novel', 'fresh', 'clear', 'moving')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, reader_id, quality)
);

-- One comment per reader per post, no replies. The author may add one
-- short note under a comment.
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reader_id TEXT NOT NULL,
  reader_name TEXT NOT NULL,
  body TEXT NOT NULL,
  author_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (post_id, reader_id)
);
CREATE INDEX comments_by_post ON comments (post_id, created_at);
