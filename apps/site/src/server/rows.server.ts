import { env } from "cloudflare:workers";
import type { Quality, QualityCounts } from "../lib/qualities";
import type { FeedItem } from "../lib/types";

// Shared by the modules that read posts: the columns a feed item needs, the
// row they come back as, and how it becomes a FeedItem.

export const db = () => env.DB;

export const POST_COLUMNS = `p.id, p.slug, p.title, p.excerpt, p.word_count, p.published_at,
	p.shape, p.opening, a.name AS author_name, a.handle AS author_handle,
	(SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count`;

export type PostRow = {
	id: string;
	slug: string;
	title: string;
	excerpt: string | null;
	word_count: number;
	published_at: string;
	shape: string;
	opening: string;
	author_name: string;
	author_handle: string;
	comment_count: number;
};

const minutes = (words: number) => Math.max(1, Math.round(words / 220));

function json<T>(text: string | null, fallback: T): T {
	try {
		return text ? (JSON.parse(text) as T) : fallback;
	} catch {
		return fallback;
	}
}

export function toFeedItem(row: PostRow, qualities: QualityCounts): FeedItem {
	return {
		id: row.id,
		slug: row.slug,
		title: row.title,
		excerpt: row.excerpt,
		author: { name: row.author_name, handle: row.author_handle },
		publishedAt: row.published_at,
		minutes: minutes(row.word_count),
		qualities,
		comments: row.comment_count,
		shape: json(row.shape, []),
		opening: json(row.opening, []),
	};
}

/**
 * D1 takes at most 100 values in one query (SQLite on your Mac takes far
 * more, so going over only shows on the live site). Lists of ids go in
 * pieces of this size.
 */
export const MAX_BOUND = 90;

/** `ids` in pieces of at most MAX_BOUND. */
export function batches<T>(ids: T[], size = MAX_BOUND): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
	return out;
}

/** "?, ?, ?" for each value. */
export const marks = (values: unknown[]) => values.map(() => "?").join(", ");

type CountRow = { post_id: string; quality: Quality; n: number };

function collectCounts(rows: CountRow[], into = new Map<string, QualityCounts>()) {
	for (const row of rows) {
		const counts = into.get(row.post_id) ?? {};
		counts[row.quality] = row.n;
		into.set(row.post_id, counts);
	}
	return into;
}

/** How many readers chose each quality, for each of these posts. */
export async function qualityCounts(postIds: string[]): Promise<Map<string, QualityCounts>> {
	const result = new Map<string, QualityCounts>();
	const pieces = await Promise.all(
		batches(postIds).map((ids) =>
			db()
				.prepare(`SELECT post_id, quality, COUNT(*) AS n FROM reactions WHERE post_id IN (${marks(ids)}) GROUP BY post_id, quality`)
				.bind(...ids)
				.all<CountRow>(),
		),
	);
	for (const { results } of pieces) collectCounts(results, result);
	return result;
}

/** The same, for every post by one author: one value, however many posts. */
export async function qualityCountsByAuthor(authorId: string): Promise<Map<string, QualityCounts>> {
	const { results } = await db()
		.prepare(
			`SELECT r.post_id, r.quality, COUNT(*) AS n FROM reactions r JOIN posts p ON p.id = r.post_id
			 WHERE p.author_id = ? GROUP BY r.post_id, r.quality`,
		)
		.bind(authorId)
		.all<CountRow>();
	return collectCounts(results);
}
