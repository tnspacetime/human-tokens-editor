-- A follow-up: a new piece that points back to an earlier piece by the same
-- author. A piece's text gets locked once readers react, so when the author
-- has more to say, or wants to say it differently, it goes in a new piece.
-- The earlier piece stays as it was and links forward to it. Unpublishing
-- the earlier piece just drops the link.
ALTER TABLE posts ADD COLUMN follows TEXT REFERENCES posts(id) ON DELETE SET NULL;
CREATE INDEX posts_by_follows ON posts (follows);
