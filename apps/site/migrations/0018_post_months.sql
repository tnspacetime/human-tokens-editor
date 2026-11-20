-- How many posts each month has ("2026-11" → 12), for the archive's years
-- and months: reading these few rows replaces counting every post on every
-- visit. Kept by the database itself (the triggers below), in the same write
-- as each post, so no code path can forget to. A post still in its fix
-- window is counted here; the archive subtracts those (archive.server.ts).
CREATE TABLE post_months (
  month TEXT PRIMARY KEY,
  n INTEGER NOT NULL
) WITHOUT ROWID;

INSERT INTO post_months (month, n)
  SELECT substr(published_at, 1, 7), COUNT(*) FROM posts GROUP BY 1;

CREATE TRIGGER post_months_added AFTER INSERT ON posts BEGIN
  INSERT INTO post_months (month, n) VALUES (substr(NEW.published_at, 1, 7), 1)
    ON CONFLICT (month) DO UPDATE SET n = n + 1;
END;

CREATE TRIGGER post_months_removed AFTER DELETE ON posts BEGIN
  UPDATE post_months SET n = n - 1 WHERE month = substr(OLD.published_at, 1, 7);
END;

-- A month whose posts are all gone leaves the archive.
CREATE TRIGGER post_months_emptied AFTER UPDATE OF n ON post_months WHEN NEW.n <= 0 BEGIN
  DELETE FROM post_months WHERE month = NEW.month;
END;
