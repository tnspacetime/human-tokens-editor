import type { FeedPage } from "../lib/types";
import { FIX_WINDOW_MINUTES } from "./publish.server";
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

/** Lists show a post once its author can no longer fix it: its 15-minute fix window has ended. */
export const settledBefore = (now = Date.now()) => new Date(now - FIX_WINDOW_MINUTES * 60_000).toISOString();

export async function listFeed(before?: string, limit = FEED_PAGE): Promise<FeedPage> {
	const after = parseCursor(before);
	const where = after ? "AND (p.published_at < ?3 OR (p.published_at = ?3 AND p.id < ?4))" : "";
	const statement = db().prepare(
		`SELECT ${POST_COLUMNS} FROM posts p JOIN authors a ON a.id = p.author_id
		 WHERE p.published_at <= ?1 ${where}
		 ORDER BY p.published_at DESC, p.id DESC LIMIT ?2`,
	);
	const { results } = await (after ? statement.bind(settledBefore(), limit + 1, after.publishedAt, after.id) : statement.bind(settledBefore(), limit + 1)).all<PostRow>();

	const rows = results.slice(0, limit);
	const counts = await qualityCounts(rows.map((r) => r.id));
	return {
		items: rows.map((row) => toFeedItem(row, counts.get(row.id) ?? {})),
		next: results.length > limit ? cursor(rows[rows.length - 1]) : null,
	};
}
