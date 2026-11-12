# Human Tokens

Writing by people, published at [human-tokens.dev](https://human-tokens.dev).
No AI wrote or rewrote any of it.

| Path | What |
| --- | --- |
| [`apps/editor`](apps/editor) | **Fold MD**, the macOS markdown editor posts are written and published from |
| [`apps/site`](apps/site) | **human-tokens.dev**: the feed, post pages, reactions and comments (TanStack Start on Cloudflare Workers, D1) |
| [`packages/renderer`](packages/renderer) | Markdown → HTML (markdown-it, KaTeX, highlight.js), used by both, so a post looks the same in the editor and on the site |

The JavaScript parts are one [Bun](https://bun.sh) workspace: run `bun install` once at the root.

## Run the site locally

```bash
bun install
cd apps/site
bun run db:reset   # create the local D1 database and load the sample posts
bun run dev        # http://localhost:3100
```

Nothing here talks to Cloudflare yet: the database is local (in `apps/site/.wrangler`).
Readers are anonymous for now; the bar at the bottom lets you switch reader or view a post as its author.

## Run the editor

See [`apps/editor`](apps/editor).
