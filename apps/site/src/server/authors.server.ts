import type { Quality, QualityCounts } from "../lib/qualities";
import type { AuthorPage } from "../lib/types";
import type { User } from "./auth.server";
import { db, POST_COLUMNS, type PostRow, qualityCounts, toFeedItem } from "./rows.server";

/**
 * An author's page: who they are, what readers made of their writing, then
 * every piece of theirs, newest first. Null for a handle nobody has.
 */
export async function loadAuthorPage(handle: string, user: User | null): Promise<AuthorPage | null> {
	const author = await db()
		.prepare(
			`SELECT a.id, a.handle, a.name, a.user_id, u.image FROM authors a LEFT JOIN users u ON u.id = a.user_id
			 WHERE a.handle = ? COLLATE NOCASE`,
		)
		.bind(handle)
		.first<{ id: string; handle: string; name: string; user_id: string | null; image: string | null }>();
	if (!author) return null;

	const [rows, readers] = await Promise.all([
		db()
			.prepare(
				`SELECT ${POST_COLUMNS}, p.parts FROM posts p JOIN authors a ON a.id = p.author_id
				 WHERE p.author_id = ? ORDER BY p.published_at DESC, p.id DESC`,
			)
			.bind(author.id)
			.all<PostRow & { word_count: number; parts: number | null }>(),
		db()
			.prepare("SELECT COUNT(DISTINCT r.user_id) AS n FROM reactions r JOIN posts p ON p.id = r.post_id WHERE p.author_id = ?")
			.bind(author.id)
			.first<{ n: number }>(),
	]);
	const counts = await qualityCounts(rows.results.map((r) => r.id));

	// What readers made of all of it, together.
	const qualities: QualityCounts = {};
	for (const c of counts.values()) {
		for (const [quality, n] of Object.entries(c) as [Quality, number][]) qualities[quality] = (qualities[quality] ?? 0) + n;
	}

	return {
		author: { handle: author.handle, name: author.name, image: author.image },
		pieces: rows.results.map((row) => ({ ...toFeedItem(row, counts.get(row.id) ?? {}), parts: row.parts })),
		since: rows.results.at(-1)?.published_at ?? null,
		words: rows.results.reduce((sum, r) => sum + r.word_count, 0),
		qualities,
		comments: rows.results.reduce((sum, r) => sum + r.comment_count, 0),
		readers: readers?.n ?? 0,
		isYou: Boolean(user && author.user_id === user.id),
	};
}

/** Deletes one of your own pieces, with its reactions, comments and P.S.es. False if it isn't yours. */
export async function deleteOwnPost(id: string, user: User): Promise<boolean> {
	const { meta } = await db()
		.prepare("DELETE FROM posts WHERE id = ? AND author_id IN (SELECT id FROM authors WHERE user_id = ?)")
		.bind(id, user.id)
		.run();
	return meta.changes > 0;
}
