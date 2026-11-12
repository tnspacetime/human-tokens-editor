-- What the feed shows of a piece, worked out once at publish from its
-- markdown (see src/server/derive.ts) instead of on every visit: its cover
-- drawing and its opening paragraphs, as JSON. `bun run db:derive` fills
-- them in for pieces already here.
ALTER TABLE posts ADD COLUMN shape TEXT NOT NULL DEFAULT '[]';
ALTER TABLE posts ADD COLUMN opening TEXT NOT NULL DEFAULT '[]';

-- The feed pages by date, then id (two pieces can share a second).
DROP INDEX posts_by_date;
CREATE INDEX posts_by_date ON posts (published_at DESC, id DESC);

-- The live board counts reactions by time; this index answers it without
-- reading the table.
CREATE INDEX reactions_by_time ON reactions (created_at, post_id, quality, reader_id);
