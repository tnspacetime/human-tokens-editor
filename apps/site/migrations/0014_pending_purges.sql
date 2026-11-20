-- Labels whose kept pages Cloudflare refused to clear (purges are rationed:
-- 5 requests a minute for the whole account). src/server/cache.server.ts
-- tries them again every 2 minutes and removes them once cleared.
CREATE TABLE pending_purges (
  tag TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
