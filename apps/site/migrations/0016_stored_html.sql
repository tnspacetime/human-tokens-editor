-- Each post's (and P.S.'s) markdown rendered once, when it's published, and
-- stored (src/server/render.ts). NULL until then for older ones: they're
-- rendered when read, until `bun run db:derive` fills them in.
ALTER TABLE posts ADD COLUMN html TEXT;
ALTER TABLE postscripts ADD COLUMN html TEXT;
