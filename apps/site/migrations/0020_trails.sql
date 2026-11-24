-- Trails: the replies readers chose most, each with the posts it answers
-- back to the opening post (server/ranking.server.ts, workOutTrails). Kept
-- with the boards they're worked out alongside, in the same write: This
-- week and This month on the "recent" row (hourly), All time on the
-- "all_time" row (daily). Post ids and counts only, as JSON; titles are
-- looked up when a page is built. Null until first worked out.
ALTER TABLE ranking ADD COLUMN trails TEXT;
