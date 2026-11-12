import type { FeedPage } from "../lib/types";
import { db, POST_COLUMNS, type PostRow, qualityCounts, toFeedItem } from "./rows.server";

export const FEED_PAGE = 12;

// A page of the feed, newest first. Paging goes by position, not by page
// number: `before` is the last piece already shown (its date and id), so a
// piece published meanwhile can't push one onto two pages.
const cursor = (row: PostRow) => `${row.published_at}~${row.id}`;

function parseCursor(before: string | undefined) {
	if (!before) return null;
	const [publishedAt, id] = before.split("~");
	return publishedAt && id ? { publishedAt, id } : null;
}

export async function listFeed(before?: string, limit = FEED_PAGE): Promise<FeedPage> {
	const after = parseCursor(before);
	const where = after ? "WHERE p.published_at < ?1 OR (p.published_at = ?1 AND p.id < ?2)" : "";
	const statement = db().prepare(
		`SELECT ${POST_COLUMNS} FROM posts p JOIN authors a ON a.id = p.author_id ${where}
		 ORDER BY p.published_at DESC, p.id DESC LIMIT ${after ? "?3" : "?1"}`,
	);
	const { results } = await (after ? statement.bind(after.publishedAt, after.id, limit + 1) : statement.bind(limit + 1)).all<PostRow>();

	const rows = results.slice(0, limit);
	const counts = await qualityCounts(rows.map((r) => r.id));
	return {
		items: rows.map((row) => toFeedItem(row, counts.get(row.id) ?? {})),
		next: results.length > limit ? cursor(rows[rows.length - 1]) : null,
	};
}
