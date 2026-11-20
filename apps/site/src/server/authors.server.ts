import type { AuthorPage, AuthorPosts } from "../lib/types";
import type { User } from "./auth.server";
import { settledBefore } from "./feed.server";
import { picturesOf, sweepPictures } from "./images.server";
import { db, POST_COLUMNS, type PostRow, QUALITY_TOTALS, qualityCounts, toFeedItem, totalsToCounts } from "./rows.server";

// An author's page, the same for everyone: who they are, what readers made
// of their writing, then their posts, newest first, 24 at a time. Built from
// rows that don't grow with what they've written: their running totals
// (author_totals, kept by database triggers) and one batch of posts from the
// index on (author, date). Like every list, it shows a post once its fix
// window has ended.

/** How many posts come at a time: the first with the page, the rest as you scroll. */
export const AUTHOR_BATCH = 24;

type Totals = { posts: number; words: number; comments: number } & Record<"novel" | "fresh" | "clear" | "sharp" | "moving", number>;

/** An author's page by handle (any case). Null for a handle nobody has. */
export async function loadAuthorPage(handle: string): Promise<AuthorPage | null> {
	const author = await db()
		.prepare(
			`SELECT a.id, a.handle, a.name, u.image FROM authors a LEFT JOIN users u ON u.id = a.user_id
			 WHERE a.handle = ? COLLATE NOCASE`,
		)
		.bind(handle)
		.first<{ id: string; handle: string; name: string; image: string | null }>();
	if (!author) return null;

	const settled = settledBefore();
	const [[totals, unsettled, first], posts] = await Promise.all([
		db().batch([
			db().prepare(`SELECT t.posts, t.words, t.comments, ${QUALITY_TOTALS} FROM author_totals t WHERE t.author_id = ?`).bind(author.id),
			// Their posts still in the fix window (a handful at most), left out of the totals as they're not listed yet.
			db()
				.prepare(
					`SELECT COUNT(*) AS posts, COALESCE(SUM(p.word_count), 0) AS words, COALESCE(SUM(t.comments), 0) AS comments,
					   ${["novel", "fresh", "clear", "sharp", "moving"].map((q) => `COALESCE(SUM(t.${q}), 0) AS ${q}`).join(", ")}
					 FROM posts p LEFT JOIN post_totals t ON t.post_id = p.id WHERE p.author_id = ? AND p.published_at > ?`,
				)
				.bind(author.id, settled),
			db().prepare("SELECT published_at FROM posts WHERE author_id = ? AND published_at <= ? ORDER BY published_at, id LIMIT 1").bind(author.id, settled),
		]),
		loadAuthorPosts(author.id, undefined, settled),
	]);
	const all = (totals.results[0] ?? {}) as Partial<Totals>;
	const fixing = (unsettled.results[0] ?? {}) as Partial<Totals>;
	const less = (key: keyof Totals) => Math.max(0, (all[key] ?? 0) - (fixing[key] ?? 0));
	const qualities = totalsToCounts({ novel: less("novel"), fresh: less("fresh"), clear: less("clear"), sharp: less("sharp"), moving: less("moving") });

	return {
		author: { handle: author.handle, name: author.name, image: author.image },
		posts: less("posts"),
		since: (first.results[0] as { published_at: string } | undefined)?.published_at ?? null,
		words: less("words"),
		qualities,
		comments: less("comments"),
		...posts,
	};
}

/** A batch of an author's posts (by author id), after `after` (the last one shown: its date and id). */
export async function loadAuthorPosts(authorId: string, after?: string, settled = settledBefore()): Promise<AuthorPosts> {
	const [at, id] = after?.split("~") ?? [];
	const position = at && id ? "AND (p.published_at < ?3 OR (p.published_at = ?3 AND p.id < ?4))" : "";
	const statement = db().prepare(
		`SELECT ${POST_COLUMNS}, p.parts FROM posts p JOIN authors a ON a.id = p.author_id
		 WHERE p.author_id = ?1 AND p.published_at <= ?2 ${position}
		 ORDER BY p.published_at DESC, p.id DESC LIMIT ${AUTHOR_BATCH + 1}`,
	);
	const { results } = await (position ? statement.bind(authorId, settled, at, id) : statement.bind(authorId, settled)).all<PostRow & { parts: number | null }>();
	const rows = results.slice(0, AUTHOR_BATCH);
	const counts = await qualityCounts(rows.map((r) => r.id));
	const last = rows.at(-1);
	return {
		pieces: rows.map((row) => ({ ...toFeedItem(row, counts.get(row.id) ?? {}), parts: row.parts })),
		next: results.length > AUTHOR_BATCH && last ? `${last.published_at}~${last.id}` : null,
	};
}

/** The author's id for a handle (any case), for the next batch of their posts. */
export async function authorIdFor(handle: string): Promise<string | null> {
	const row = await db().prepare("SELECT id FROM authors WHERE handle = ? COLLATE NOCASE").bind(handle).first<{ id: string }>();
	return row?.id ?? null;
}

/** Deletes one of your own posts, with its reactions, comments and P.S.es. False if it isn't yours. */
export async function deleteOwnPost(id: string, user: User): Promise<boolean> {
	const pictures = await picturesOf(id);
	const { meta } = await db()
		.prepare("DELETE FROM posts WHERE id = ? AND author_id IN (SELECT id FROM authors WHERE user_id = ?)")
		.bind(id, user.id)
		.run();
	if (meta.changes > 0) await sweepPictures(pictures);
	return meta.changes > 0;
}
