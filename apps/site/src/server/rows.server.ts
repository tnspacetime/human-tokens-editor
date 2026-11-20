import { env } from "cloudflare:workers";
import { QUALITIES, type Quality, type QualityCounts } from "../lib/qualities";
import type { FeedItem } from "../lib/types";

// Shared by the modules that read posts: the columns a feed item needs, the
// row they come back as, and how it becomes a FeedItem.

export const db = () => env.DB;

export const POST_COLUMNS = `p.id, p.slug, p.title, p.excerpt, p.word_count, p.published_at,
	p.shape, p.opening, a.name AS author_name, a.handle AS author_handle,
	(SELECT t.comments FROM post_totals t WHERE t.post_id = p.id) AS comment_count`;

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
	comment_count: number | null;
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
		comments: row.comment_count ?? 0,
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

// Counts come from post_totals, which the database keeps up to date with
// every reaction and comment (migrations/0015_post_totals.sql): one row per
// post, however popular.

/** The totals' quality columns, for a SELECT with `t` as post_totals. */
export const QUALITY_TOTALS = QUALITIES.map((q) => `t.${q.id}`).join(", ");

/** A post_totals row (or one with its quality columns) as counts, leaving out the zeros. */
export function totalsToCounts(row: Partial<Record<Quality, number | null>>): QualityCounts {
	const counts: QualityCounts = {};
	for (const { id } of QUALITIES) if (row[id]) counts[id] = row[id] ?? 0;
	return counts;
}

type TotalsRow = { post_id: string } & Record<Quality, number>;

/** How many readers chose each quality, for each of these posts. */
export async function qualityCounts(postIds: string[]): Promise<Map<string, QualityCounts>> {
	const result = new Map<string, QualityCounts>();
	const pieces = await Promise.all(
		batches(postIds).map((ids) =>
			db()
				.prepare(`SELECT t.post_id, ${QUALITY_TOTALS} FROM post_totals t WHERE t.post_id IN (${marks(ids)})`)
				.bind(...ids)
				.all<TotalsRow>(),
		),
	);
	for (const { results } of pieces) for (const row of results) result.set(row.post_id, totalsToCounts(row));
	return result;
}

