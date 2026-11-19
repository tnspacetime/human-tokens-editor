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

Nothing here talks to Cloudflare yet: the database and the stored pictures are local (in `apps/site/.wrangler`).
`db:reset` also signs everyone out.

Every page tells search engines and link previews (iMessage, Slack, X…) its title, a line about it and its one address (`src/lib/share.ts`), with one share picture for the whole site.
The icons and that picture (`public/og.png`) are made from `brand/icon.html` and `brand/card.html` by `sh brand/make.sh` (it uses Google Chrome on your Mac); `public/favicon.svg` is written by hand.

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
3. **Publish.** The sheet shows the title and opening lines as the feed will, and the pledge: *I wrote this myself. No AI wrote or rewrote any of it.* Publishing needs the pledge every time.
4. **Published · View** opens the piece on the site, where you have the author's tools.
   Once a piece is published, the pill also sits in the window's own toolbar while the publishing surface is closed.
5. **Fix, for a short while.** For 15 minutes after publishing, and only until someone reacts or comments, you can still fix the piece: change the file and the pill reads **Fix**.
   After that its text is locked, so what readers reacted to stays what's there. The site enforces it (`423 Locked`).
6. **Respond to a piece.** When you publish a new piece, paste the link of the piece it responds to where the sheet asks (*Copy Link* is in a piece's pill menu, or copy it from the site).
   One of your own pieces makes it a **follow-up**: it says *Follows …* under its byline, and the earlier piece, which stays as it was, points forward to it.
   Anyone else's makes it a **reply**: it says *In reply to … by …*, and the piece it answers lists it under *Replies*, at its foot and in the reader island. Anyone can reply to any piece, and every reply shows.
7. **Pictures.** Drag or paste a picture into a piece: Fold MD copies it into an `images` folder beside the file and links it. When you publish, Fold MD gets each picture ready on your Mac first: at most 2000 pixels on its long side, the right way up, photos as JPEG (iPhone HEIC included) and screenshots as PNG, written afresh so nothing else in the file goes along (not where it was taken, not the camera). Then it sends the ones the site doesn't have yet, and the button says how far it's got.
   A piece can have up to 20 pictures, 5 MB each and 10 MB in all; SVGs can't go up yet. With pictures, the pledge adds that they're yours or free to share, and none was made by AI.
   On the site they're kept in Cloudflare R2 under the SHA-256 of their bytes and shown at `/img/<hash>`, so a picture is stored once however often it's used. Your file keeps its links as you wrote them. Pictures are locked with the text, and go when their piece goes.
8. **Add a P.S.** From the pill's menu, add a short note (at most 150 words) at the end of the piece, dated, with the pledge.
   It's how you add a correction or a thought once the text is locked. A P.S. can't be changed or removed.

An author can publish at most 50 new pieces in 30 days: plenty for writing every day, and a stop on anyone flooding the site. Fixes and P.S.es don't count; a deleted piece still does. When you've reached it, the publish sheet says so, and when you can publish again.

Every author has a page listing their pieces, newest first: `/@handle`. Click the name in a byline, or your own name in the island's account panel.
Publishing the same text twice makes two pieces, as on any social site; delete the one you don't want.
To delete a piece, open it while signed in as its author: **Delete…** is at its foot (it takes the post's reactions, comments and P.S.es with it).
**Unpublish** in the pill's menu does the same from Fold MD, and *Disconnect* is there too.

Only the file's markdown is sent. Self-notes stay in their own hidden file and never leave your Mac.
Fold MD remembers which post each file became in its own folder, `Application Support/Fold MD/published/`, so your folders hold only your markdown. It finds the file again after you rename or move it. (Older versions kept a hidden `.Name.md.published` beside the file; Fold MD moves those in the first time it opens the file.)
A debug build of Fold MD publishes to `http://localhost:3100`; run the site first (`bun run dev` in `apps/site`).
A **series** is published whole, as one piece: open it in the series sidebar (⌃⌘S) and use the **Publish** pill at its foot.
The parts are joined in the sidebar's order, each part a chapter (its `# Title` becomes the chapter's heading), and on the site a small island at the foot of the page shows the part you're in and opens the list of parts.
It then follows the same rules as any piece: the fix window, P.S. and follow-ups.

How it works: Better Auth's [device authorization](https://www.better-auth.com/docs/plugins/device-authorization) (`client_id` `fold-md`) and `bearer` plugins, with the device codes in `migrations/0005_publishing.sql`.
Fold MD then calls `/api/fold/*` (`apps/site/src/routes/api.fold.$.ts`) with `Authorization: Bearer <token>`; that API ignores cookies, so no web page can publish in your name.
Each file sends a stable id with every publish, so publishing it again (a fix) changes its post instead of making a second one.

## Run the editor

See [`apps/editor`](apps/editor).
