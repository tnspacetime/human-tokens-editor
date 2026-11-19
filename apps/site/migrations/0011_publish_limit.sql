-- Each new piece, when it went up, so an author can publish at most so
-- many in 30 days (publish.server.ts). Fixes don't count, and deleting a
-- piece doesn't give its place back: the row stays.
CREATE TABLE publishes (
  author_id TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX publishes_by_author ON publishes (author_id, created_at);

INSERT INTO publishes (author_id, created_at) SELECT author_id, published_at FROM posts;
