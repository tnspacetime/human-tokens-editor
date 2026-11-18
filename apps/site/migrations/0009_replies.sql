-- A piece can respond to any piece on the site, not just the author's own.
-- Responding to your own piece is a follow-up; to someone else's, a reply.
-- Either way the new piece points back, and the earlier one lists it. So
-- the column that held follow-ups now holds both.
ALTER TABLE posts RENAME COLUMN follows TO responds_to;
DROP INDEX posts_by_follows;
CREATE INDEX posts_by_responds_to ON posts (responds_to);
