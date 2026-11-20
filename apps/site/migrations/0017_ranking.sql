-- The ranking (Today · This week · This month), worked out once an hour.
--
-- Tallies: how many readers chose each quality for each post, per hour and
-- per day. Working out the ranking adds up tallies instead of reading every
-- reaction: Today from the hourly ones (at most 25 per post and quality),
-- This week and This month from the daily ones (at most 30). The database
-- keeps them itself (the triggers below), in the same write as each
-- reaction, so no code path can forget to. The hourly job drops hourly
-- tallies after 2 days and daily ones after 31.
CREATE TABLE reaction_hours (
  hour TEXT NOT NULL,          -- "2026-11-20T13", UTC: the first 13 characters of created_at
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  quality TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (hour, post_id, quality)
) WITHOUT ROWID;

CREATE TABLE reaction_days (
  day TEXT NOT NULL,           -- "2026-11-20", UTC: the first 10 characters of created_at
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  quality TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, post_id, quality)
) WITHOUT ROWID;

-- Deleting a post deletes its tallies.
CREATE INDEX reaction_hours_post ON reaction_hours (post_id);
CREATE INDEX reaction_days_post ON reaction_days (post_id);

-- The reactions already there, tallied once.
INSERT INTO reaction_hours (hour, post_id, quality, n)
  SELECT substr(created_at, 1, 13), post_id, quality, COUNT(*)
  FROM reactions
  WHERE created_at >= strftime('%Y-%m-%dT%H', 'now', '-2 days')
  GROUP BY 1, 2, 3;

INSERT INTO reaction_days (day, post_id, quality, n)
  SELECT substr(created_at, 1, 10), post_id, quality, COUNT(*)
  FROM reactions
  WHERE created_at >= strftime('%Y-%m-%d', 'now', '-31 days')
  GROUP BY 1, 2, 3;

CREATE TRIGGER reaction_tallies_added AFTER INSERT ON reactions BEGIN
  INSERT INTO reaction_hours (hour, post_id, quality, n)
    VALUES (substr(NEW.created_at, 1, 13), NEW.post_id, NEW.quality, 1)
    ON CONFLICT (hour, post_id, quality) DO UPDATE SET n = n + 1;
  INSERT INTO reaction_days (day, post_id, quality, n)
    VALUES (substr(NEW.created_at, 1, 10), NEW.post_id, NEW.quality, 1)
    ON CONFLICT (day, post_id, quality) DO UPDATE SET n = n + 1;
END;

-- Un-choosing takes it off the hour and day it was chosen in (if still kept).
CREATE TRIGGER reaction_tallies_removed AFTER DELETE ON reactions BEGIN
  UPDATE reaction_hours SET n = n - 1
    WHERE hour = substr(OLD.created_at, 1, 13) AND post_id = OLD.post_id AND quality = OLD.quality;
  UPDATE reaction_days SET n = n - 1
    WHERE day = substr(OLD.created_at, 1, 10) AND post_id = OLD.post_id AND quality = OLD.quality;
END;

-- The boards as last worked out, one row each: "recent" (the homepage's
-- Today, This week, This month; hourly) and "all_time" (the archive's;
-- daily, from post_totals). Each holds post ids and their counts for each
-- period and quality (JSON). Titles are looked up when a page is built, so
-- a deleted post drops out.
CREATE TABLE ranking (
  board TEXT PRIMARY KEY,
  worked_out_at TEXT NOT NULL,
  lists TEXT NOT NULL
);
