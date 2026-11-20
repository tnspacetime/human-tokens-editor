-- Running totals per post: how many readers chose each quality, and how
-- many comments. Showing a post's counts then reads one row, however
-- popular it is, instead of counting every reaction and comment.
--
-- The database keeps them itself (the triggers below), in the same write as
-- each reaction or comment, so no code path can forget to.
CREATE TABLE post_totals (
  post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  novel INTEGER NOT NULL DEFAULT 0,
  fresh INTEGER NOT NULL DEFAULT 0,
  clear INTEGER NOT NULL DEFAULT 0,
  sharp INTEGER NOT NULL DEFAULT 0,
  moving INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0
);

-- The posts already there, counted once.
INSERT INTO post_totals (post_id, novel, fresh, clear, sharp, moving, comments)
  SELECT p.id,
    (SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id AND r.quality = 'novel'),
    (SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id AND r.quality = 'fresh'),
    (SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id AND r.quality = 'clear'),
    (SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id AND r.quality = 'sharp'),
    (SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id AND r.quality = 'moving'),
    (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id)
  FROM posts p;

-- A new post starts at zero.
CREATE TRIGGER post_totals_new_post AFTER INSERT ON posts BEGIN
  INSERT OR IGNORE INTO post_totals (post_id) VALUES (NEW.id);
END;

CREATE TRIGGER post_totals_reaction_added AFTER INSERT ON reactions BEGIN
  UPDATE post_totals SET
    novel = novel + (NEW.quality = 'novel'),
    fresh = fresh + (NEW.quality = 'fresh'),
    clear = clear + (NEW.quality = 'clear'),
    sharp = sharp + (NEW.quality = 'sharp'),
    moving = moving + (NEW.quality = 'moving')
  WHERE post_id = NEW.post_id;
END;

CREATE TRIGGER post_totals_reaction_removed AFTER DELETE ON reactions BEGIN
  UPDATE post_totals SET
    novel = novel - (OLD.quality = 'novel'),
    fresh = fresh - (OLD.quality = 'fresh'),
    clear = clear - (OLD.quality = 'clear'),
    sharp = sharp - (OLD.quality = 'sharp'),
    moving = moving - (OLD.quality = 'moving')
  WHERE post_id = OLD.post_id;
END;

-- Editing a comment is an update, not an insert: it doesn't count again.
CREATE TRIGGER post_totals_comment_added AFTER INSERT ON comments BEGIN
  UPDATE post_totals SET comments = comments + 1 WHERE post_id = NEW.post_id;
END;

CREATE TRIGGER post_totals_comment_removed AFTER DELETE ON comments BEGIN
  UPDATE post_totals SET comments = comments - 1 WHERE post_id = OLD.post_id;
END;
