# Human Tokens

Writing by people, published at [human-tokens.dev](https://human-tokens.dev).
No AI wrote or rewrote any of it.

| Path | What |
| --- | --- |
| [`apps/editor`](apps/editor) | **Fold MD**, the macOS markdown editor posts are written and published from |
| [`apps/site`](apps/site) | **human-tokens.dev**: the feed, post pages, reactions and comments, sign-in (TanStack Start on Cloudflare Workers, D1, Better Auth) |
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
`db:reset` also signs everyone out.

### Sign-in

Anyone can read. To say how a piece read or to comment, you sign in with Google or GitHub, from your account in the island at the top.
If you write as an author, you get the author's tools (a note under a comment) on your own pieces.
Sign-in runs on [Better Auth](https://better-auth.com) with its tables in D1 (`migrations/0004_accounts.sql`).

Until the OAuth apps exist, `bun run dev` offers a **Dev** sign-in (dashed, at `/auth/dev`): sign in as a reader by name, or as one of the sample authors.
It is only in `vite dev` and only on localhost; a production build doesn't contain it.

To turn on Google and GitHub, copy `apps/site/.dev.vars.example` to `apps/site/.dev.vars` (gitignored) and fill it in:

1. **Secret.** Set `BETTER_AUTH_SECRET` to the output of `openssl rand -base64 32`.
2. **Google.** In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), create a project, set up the OAuth consent screen (External; add yourself as a test user while it's in Testing), then *Create credentials → OAuth client ID → Web application*.
   - Authorized JavaScript origin: `http://localhost:3100`
   - Authorized redirect URI: `http://localhost:3100/api/auth/callback/google`
   - Put the client ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. **GitHub.** In *GitHub → Settings → Developer settings → [OAuth Apps](https://github.com/settings/developers) → New OAuth App*:
   - Homepage URL: `http://localhost:3100`
   - Authorization callback URL: `http://localhost:3100/api/auth/callback/github`
   - Generate a client secret, and put both in `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
4. Restart `bun run dev`. The island's account panel now offers Google and GitHub.

A GitHub OAuth app has one callback URL, so the live site will need its own app (`https://human-tokens.dev/api/auth/callback/github`); a Google client can list both redirect URIs.
Signing in with Google and GitHub under the same verified email leads to the same person.

A real account becomes an author when it publishes from Fold MD (not built yet).
Until then, to link yourself to a sample author locally:

```bash
cd apps/site
npx wrangler d1 execute DB --local --command "UPDATE authors SET user_id = (SELECT id FROM users WHERE email = 'you@example.com') WHERE handle = 'mara'"
```

## Run the editor

See [`apps/editor`](apps/editor).
