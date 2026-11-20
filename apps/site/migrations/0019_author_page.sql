-- The author page, and clearing lists when a new post settles.

-- 1. Clearings that wait. A new post can't be listed while its author can
-- still fix it, so publishing queues the clearing of the lists it'll be on
-- (the homepage, the archive, its author's page) for when its 15-minute fix
-- window ends: `not_before`. The every-minute job sends what's due. The same
-- label can wait for several times (a post settling now, another later).
CREATE TABLE pending_purges_new (
  tag TEXT NOT NULL,
  not_before TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tag, not_before)
) WITHOUT ROWID;
INSERT INTO pending_purges_new (tag, not_before, created_at) SELECT tag, created_at, created_at FROM pending_purges;
DROP TABLE pending_purges;
ALTER TABLE pending_purges_new RENAME TO pending_purges;
CREATE INDEX pending_purges_due ON pending_purges (not_before);

-- 2. An author's posts, newest first, straight from an index (their page,
-- their feed), instead of reading through every post.
CREATE INDEX posts_by_author ON posts (author_id, published_at DESC, id DESC);

-- 3. Running totals per author: how many posts and words, how many readers
-- chose each quality across all their posts, and how many comments. Their
-- page then reads one row, however much they've written. Kept by the
-- database itself, in the same write as each post, reaction and comment.
CREATE TABLE author_totals (
  author_id TEXT PRIMARY KEY REFERENCES authors(id) ON DELETE CASCADE,
  posts INTEGER NOT NULL DEFAULT 0,
  words INTEGER NOT NULL DEFAULT 0,
  novel INTEGER NOT NULL DEFAULT 0,
  fresh INTEGER NOT NULL DEFAULT 0,
  clear INTEGER NOT NULL DEFAULT 0,
  sharp INTEGER NOT NULL DEFAULT 0,
  moving INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0
);

-- The authors already there, counted once.
INSERT INTO author_totals (author_id, posts, words, novel, fresh, clear, sharp, moving, comments)
  SELECT a.id, COUNT(p.id), COALESCE(SUM(p.word_count), 0),
    COALESCE(SUM(t.novel), 0), COALESCE(SUM(t.fresh), 0), COALESCE(SUM(t.clear), 0),
    COALESCE(SUM(t.sharp), 0), COALESCE(SUM(t.moving), 0), COALESCE(SUM(t.comments), 0)
  FROM authors a LEFT JOIN posts p ON p.author_id = a.id LEFT JOIN post_totals t ON t.post_id = p.id
  GROUP BY a.id;

CREATE TRIGGER author_totals_new_author AFTER INSERT ON authors BEGIN
  INSERT OR IGNORE INTO author_totals (author_id) VALUES (NEW.id);
END;

CREATE TRIGGER author_totals_post_added AFTER INSERT ON posts BEGIN
  INSERT OR IGNORE INTO author_totals (author_id) VALUES (NEW.author_id);
  UPDATE author_totals SET posts = posts + 1, words = words + NEW.word_count WHERE author_id = NEW.author_id;
END;

-- A fix while the post can still be fixed changes its length.
CREATE TRIGGER author_totals_post_fixed AFTER UPDATE OF word_count ON posts BEGIN
  UPDATE author_totals SET words = words + NEW.word_count - OLD.word_count WHERE author_id = NEW.author_id;
END;

-- A deleted post takes everything it had with it, read from its running
-- totals before they go. (Its reactions and comments are then deleted with
-- it; their triggers below find no post, so nothing is taken off twice.)
CREATE TRIGGER author_totals_post_removed BEFORE DELETE ON posts BEGIN
  UPDATE author_totals SET
    posts = posts - 1,
    words = words - OLD.word_count,
    novel = novel - COALESCE((SELECT novel FROM post_totals WHERE post_id = OLD.id), 0),
    fresh = fresh - COALESCE((SELECT fresh FROM post_totals WHERE post_id = OLD.id), 0),
    clear = clear - COALESCE((SELECT clear FROM post_totals WHERE post_id = OLD.id), 0),
    sharp = sharp - COALESCE((SELECT sharp FROM post_totals WHERE post_id = OLD.id), 0),
    moving = moving - COALESCE((SELECT moving FROM post_totals WHERE post_id = OLD.id), 0),
    comments = comments - COALESCE((SELECT comments FROM post_totals WHERE post_id = OLD.id), 0)
  WHERE author_id = OLD.author_id;
END;

CREATE TRIGGER author_totals_reaction_added AFTER INSERT ON reactions BEGIN
  UPDATE author_totals SET
    novel = novel + (NEW.quality = 'novel'),
    fresh = fresh + (NEW.quality = 'fresh'),
    clear = clear + (NEW.quality = 'clear'),
    sharp = sharp + (NEW.quality = 'sharp'),
    moving = moving + (NEW.quality = 'moving')
  WHERE author_id = (SELECT author_id FROM posts WHERE id = NEW.post_id);
END;

CREATE TRIGGER author_totals_reaction_removed AFTER DELETE ON reactions BEGIN
  UPDATE author_totals SET
    novel = novel - (OLD.quality = 'novel'),
    fresh = fresh - (OLD.quality = 'fresh'),
    clear = clear - (OLD.quality = 'clear'),
    sharp = sharp - (OLD.quality = 'sharp'),
    moving = moving - (OLD.quality = 'moving')
  WHERE author_id = (SELECT author_id FROM posts WHERE id = OLD.post_id);
END;

CREATE TRIGGER author_totals_comment_added AFTER INSERT ON comments BEGIN
  UPDATE author_totals SET comments = comments + 1 WHERE author_id = (SELECT author_id FROM posts WHERE id = NEW.post_id);
END;

CREATE TRIGGER author_totals_comment_removed AFTER DELETE ON comments BEGIN
  UPDATE author_totals SET comments = comments - 1 WHERE author_id = (SELECT author_id FROM posts WHERE id = OLD.post_id);
END;
