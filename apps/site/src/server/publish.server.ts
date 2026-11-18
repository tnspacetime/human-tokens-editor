import { auth } from "./auth.server";
import { deriveFromMarkdown } from "./derive";
import { db } from "./rows.server";

// Publishing from Fold MD: who is asking (by the token Fold MD got when you
// connected it), becoming an author on your first publish, and publishing,
// fixing (only in the fix window), adding a P.S. and unpublishing your own
// pieces. The HTTP side is routes/api.fold.$.ts.

/** A refusal Fold MD can show as it is. */
export class PublishError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

type Author = { id: string; handle: string; name: string };
export type Publisher = { id: string; name: string; image: string | null; author: Author | null };

/**
 * The person Fold MD publishes as, from `Authorization: Bearer <token>`.
 * Only the token counts: a browser's cookies are ignored here, so no other
 * page can publish in your name.
 */
export async function publisherFrom(request: Request): Promise<Publisher> {
	const authorization = request.headers.get("authorization");
	if (!authorization?.toLowerCase().startsWith("bearer ")) throw new PublishError(401, "Connect Fold MD to your account first.");
	const session = await auth.api.getSession({ headers: new Headers({ authorization }) });
	if (!session) throw new PublishError(401, "This connection has ended. Connect Fold MD again.");
	const author = await db()
		.prepare("SELECT id, handle, name FROM authors WHERE user_id = ?")
		.bind(session.user.id)
		.first<Author>();
	return { id: session.user.id, name: session.user.name, image: session.user.image ?? null, author };
}

function requireAuthor(publisher: Publisher): Author {
	if (!publisher.author) throw new PublishError(409, "Choose your author name before your first publish.");
	return publisher.author;
}

// ----------------------------------------------------------------- authors

const RESERVED = new Set([
	"admin", "api", "archive", "auth", "connect", "fold", "fold-md", "help", "human-tokens",
	"humantokens", "p", "rules", "settings", "support", "write",
]);

/** Your public name and handle, once, on your first publish. */
export async function becomeAuthor(publisher: Publisher, input: Record<string, unknown>): Promise<Author> {
	if (publisher.author) return publisher.author;
	if (typeof input.name !== "string" || typeof input.handle !== "string") throw new PublishError(400, "A name and a handle, please.");
	const name = input.name.trim().replace(/\s+/g, " ");
	const handle = input.handle.trim().replace(/^@/, "").toLowerCase();
	if (name.length < 1 || name.length > 60) throw new PublishError(400, "Your name should be 1 to 60 characters.");
	if (!/^[a-z0-9](?:[a-z0-9_-]{0,28}[a-z0-9])?$/.test(handle) || handle.length < 2) {
		throw new PublishError(400, "A handle is 2 to 30 letters, numbers, - or _, starting and ending with a letter or number.");
	}
	if (RESERVED.has(handle)) throw new PublishError(409, `@${handle} isn't available.`);

	const author = { id: `a_${randomId(10)}`, handle, name };
	try {
		await db()
			.prepare("INSERT INTO authors (id, handle, name, user_id) VALUES (?, ?, ?, ?)")
			.bind(author.id, author.handle, author.name, publisher.id)
			.run();
	} catch (error) {
		if (!/UNIQUE/i.test(String(error))) throw error;
		// Either the handle is taken, or this person became an author a moment ago.
		const mine = await db().prepare("SELECT id, handle, name FROM authors WHERE user_id = ?").bind(publisher.id).first<Author>();
		if (mine) return mine;
		throw new PublishError(409, `@${handle} is taken. Try another.`);
	}
	return author;
}

// ------------------------------------------------------------------- posts

const MAX_MARKDOWN = 200_000;

const slugify = (title: string) =>
	title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 60) || "untitled";

const minutes = (words: number) => Math.max(1, Math.round(words / 220));

function markdownFrom(value: unknown) {
	if (typeof value !== "string" || !value.trim()) throw new PublishError(400, "There's nothing to publish yet.");
	if (value.length > MAX_MARKDOWN) throw new PublishError(413, "This piece is too long to publish.");
	return value;
}

/** What the feed will show of a piece: its title and opening lines. */
export function preview(input: Record<string, unknown>) {
	const markdown = markdownFrom(input.markdown);
	const derived = deriveFromMarkdown(markdown);
	return {
		title: derived.title,
		opening: JSON.parse(derived.opening) as string[],
		words: derived.wordCount,
		minutes: minutes(derived.wordCount),
	};
}

/**
 * A published piece's text can still be fixed for this long after it went
 * up, and only until someone reacts or comments. After that it's locked:
 * what readers reacted to stays what's there.
 */
export const FIX_WINDOW_MINUTES = 15;
const FIX_WINDOW_MS = FIX_WINDOW_MINUTES * 60_000;

export const LOCKED =
	"Its text is locked now: it's been up for more than 15 minutes, or someone has reacted or commented. Your changes stay on your Mac.";

export type Published = {
	id: string;
	slug: string;
	url: string;
	title: string;
	allowDebate: boolean;
	publishedAt: string;
	updatedAt: string;
	/** Until when its text can still be fixed; null once it's locked. */
	fixableUntil: string | null;
};

type PostRow = {
	id: string;
	slug: string;
	title: string;
	allow_debate: number;
	published_at: string;
	updated_at: string;
	/** 1 once anyone has reacted or commented. */
	touched: number;
};

function fixableUntil(row: Pick<PostRow, "published_at" | "touched">, now = Date.now()): string | null {
	if (row.touched) return null;
	const until = Date.parse(row.published_at) + FIX_WINDOW_MS;
	return until > now ? new Date(until).toISOString() : null;
}

const toPublished = (row: PostRow, origin: string): Published => ({
	id: row.id,
	slug: row.slug,
	url: `${origin}/p/${row.id}/${row.slug}`,
	title: row.title,
	allowDebate: row.allow_debate === 1,
	publishedAt: row.published_at,
	updatedAt: row.updated_at,
	fixableUntil: fixableUntil(row),
});

/**
 * Publish a file, or fix the post it was published as, while that's still
 * allowed (see FIX_WINDOW_MINUTES); after that, 423 Locked. `sourceId` is
 * Fold MD's id for the file. Every publish asks for the pledge.
 */
export async function publish(
	publisher: Publisher,
	input: Record<string, unknown>,
	origin: string,
): Promise<Published & { created: boolean }> {
	const author = requireAuthor(publisher);
	if (input.pledge !== true) throw new PublishError(400, "Publishing needs your promise that you wrote this yourself.");
	if (typeof input.sourceId !== "string" || !/^[0-9A-Za-z-]{8,64}$/.test(input.sourceId)) throw new PublishError(400, "Missing the file's id.");
	const markdown = markdownFrom(input.markdown);
	const derived = deriveFromMarkdown(markdown);
	if (!derived.title) throw new PublishError(400, "Give the piece a title: a first line like “# My title”.");
	const allowDebate = input.allowDebate === true ? 1 : 0;
	const now = new Date().toISOString();

	const existing = await db()
		.prepare(`SELECT id, published_at, ${TOUCHED} AS touched FROM posts p WHERE author_id = ? AND source_id = ?`)
		.bind(author.id, input.sourceId)
		.first<Pick<PostRow, "id" | "published_at" | "touched">>();
	if (existing && !fixableUntil(existing)) throw new PublishError(423, LOCKED);
	const id = existing?.id ?? randomId(8);

	// The fix window is checked again in the write itself, so a reaction
	// that lands in between still locks it.
	const { meta } = await db()
		.prepare(
			`INSERT INTO posts (id, author_id, source_id, slug, title, excerpt, markdown, word_count, shape, opening, allow_debate, pledged_at, published_at, updated_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?12)
			 ON CONFLICT (id) DO UPDATE SET slug = ?4, title = ?5, excerpt = ?6, markdown = ?7, word_count = ?8,
			   shape = ?9, opening = ?10, allow_debate = ?11, pledged_at = ?12, updated_at = ?12
			 WHERE posts.author_id = ?2 AND posts.published_at > ?13
			   AND NOT EXISTS (SELECT 1 FROM reactions WHERE post_id = posts.id)
			   AND NOT EXISTS (SELECT 1 FROM comments WHERE post_id = posts.id)`,
		)
		.bind(
			id,
			author.id,
			input.sourceId,
			slugify(derived.title),
			derived.title,
			derived.excerpt,
			markdown,
			derived.wordCount,
			derived.shape,
			derived.opening,
			allowDebate,
			now,
			new Date(Date.parse(now) - FIX_WINDOW_MS).toISOString(),
		)
		.run();
	if (!meta.changes) throw new PublishError(existing ? 423 : 500, existing ? LOCKED : "The piece didn't save. Try again.");

	const row = await ownPost(author, id);
	if (!row) throw new PublishError(500, "The piece didn't save. Try again.");
	return { ...toPublished(row, origin), created: !existing };
}

/** 1 once anyone has reacted to or commented on post `p`. */
const TOUCHED = `(EXISTS (SELECT 1 FROM reactions WHERE post_id = p.id) OR EXISTS (SELECT 1 FROM comments WHERE post_id = p.id))`;

async function ownPost(author: Author, id: string) {
	return db()
		.prepare(`SELECT id, slug, title, allow_debate, published_at, updated_at, ${TOUCHED} AS touched FROM posts p WHERE id = ? AND author_id = ?`)
		.bind(id, author.id)
		.first<PostRow>();
}

const postId = (value: string) => {
	if (!/^[0-9A-Za-z]{6,16}$/.test(value)) throw new PublishError(404, "No such piece.");
	return value;
};

/** One of your posts as it stands on the site, with its P.S.es, or 404 if it's gone. */
export async function published(
	publisher: Publisher,
	id: string,
	origin: string,
): Promise<Published & { postscripts: Postscript[] }> {
	const row = await ownPost(requireAuthor(publisher), postId(id));
	if (!row) throw new PublishError(404, "This piece isn't on the site.");
	const { results } = await db()
		.prepare("SELECT id, body, created_at FROM postscripts WHERE post_id = ? ORDER BY created_at")
		.bind(row.id)
		.all<{ id: string; body: string; created_at: string }>();
	return { ...toPublished(row, origin), postscripts: results.map((r) => ({ id: r.id, body: r.body, createdAt: r.created_at })) };
}

// --------------------------------------------------------------------- P.S.

/** A P.S. is short: anything longer belongs in a follow-up. */
export const PS_MAX_WORDS = 150;
const PS_MAX_CHARS = 1_500;

export type Postscript = { id: string; body: string; createdAt: string };

const wordsIn = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Add a P.S. under one of your pieces. It can't be edited or removed. */
export async function addPostscript(publisher: Publisher, id: string, input: Record<string, unknown>): Promise<Postscript> {
	const author = requireAuthor(publisher);
	if (input.pledge !== true) throw new PublishError(400, "A P.S. needs your promise that you wrote it yourself.");
	if (typeof input.body !== "string" || !input.body.trim()) throw new PublishError(400, "Write the P.S. first.");
	const body = input.body
		.replace(/\r\n?/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	if (wordsIn(body) > PS_MAX_WORDS || body.length > PS_MAX_CHARS) {
		throw new PublishError(400, `A P.S. is at most ${PS_MAX_WORDS} words. For more, publish a follow-up.`);
	}
	const row = await ownPost(author, postId(id));
	if (!row) throw new PublishError(404, "This piece isn't on the site.");

	const postscript = { id: randomId(10), body, createdAt: new Date().toISOString() };
	await db()
		.prepare("INSERT INTO postscripts (id, post_id, body, pledged_at, created_at) VALUES (?1, ?2, ?3, ?4, ?4)")
		.bind(postscript.id, row.id, body, postscript.createdAt)
		.run();
	return postscript;
}

/** Take one of your posts down, with its reactions and comments. */
export async function unpublish(publisher: Publisher, id: string): Promise<void> {
	const author = requireAuthor(publisher);
	const { meta } = await db().prepare("DELETE FROM posts WHERE id = ? AND author_id = ?").bind(postId(id), author.id).run();
	if (!meta.changes) throw new PublishError(404, "This piece isn't on the site.");
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const randomId = (length: number) =>
	[...crypto.getRandomValues(new Uint8Array(length))].map((byte) => ALPHABET[byte % 62]).join("");
