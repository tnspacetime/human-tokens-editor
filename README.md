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

A real account becomes an author the first time it publishes from Fold MD (below).
To link yourself to a sample author locally instead, use the Dev sign-in "as an author".

## Publishing from Fold MD

Pieces are published from Fold MD, never written on the site.
Open the publishing surface (⌥⌘P); its strip of the toolbar has a **Publish** pill.

1. **Connect, the first time.** Fold MD shows a short code (like `KQ4M-7TXD`) and an *Open human-tokens.dev* button.
   The site's `/connect` page asks you to sign in with Google or GitHub if you aren't, shows the code, and asks *Let Fold MD publish as you?*
   Click **Allow**: Fold MD notices within seconds and keeps its token in your login Keychain (*Fold MD · human-tokens.dev*).
   Your password is only ever typed on Google's or GitHub's own page.
2. **Your first publish.** Choose your author name (filled in from your account) and a handle.
3. **Publish.** The sheet shows the title and opening lines as the feed will, an *Open to debate* toggle, and the pledge: *I wrote this myself. No AI wrote or rewrote any of it.* Publishing needs the pledge every time.
4. **Published · View** opens the piece on the site, where you have the author's tools.
   Once a piece is published, the pill also sits in the window's own toolbar while the publishing surface is closed.
5. **Fix, for a short while.** For 15 minutes after publishing, and only until someone reacts or comments, you can still fix the piece: change the file and the pill reads **Fix**.
   After that its text is locked, so what readers reacted to stays what's there. The site enforces it (`423 Locked`), and your later changes stay on your Mac.
   **Unpublish** is in the pill's menu (it takes the post's reactions and comments with it), and so is *Disconnect*.

Only the file's markdown is sent. Self-notes stay in their own hidden file and never leave your Mac.
Each published file remembers its post in another hidden file beside it, `.Name.md.published`, so the `.md` stays plain markdown.
A debug build of Fold MD publishes to `http://localhost:3100`; run the site first (`bun run dev` in `apps/site`).
Pieces in a series are published one by one for now.

How it works: Better Auth's [device authorization](https://www.better-auth.com/docs/plugins/device-authorization) (`client_id` `fold-md`) and `bearer` plugins, with the device codes in `migrations/0005_publishing.sql`.
Fold MD then calls `/api/fold/*` (`apps/site/src/routes/api.fold.$.ts`) with `Authorization: Bearer <token>`; that API ignores cookies, so no web page can publish in your name.
Each file sends a stable id with every publish, so publishing it again (a fix) changes its post instead of making a second one.

## Run the editor

See [`apps/editor`](apps/editor).
