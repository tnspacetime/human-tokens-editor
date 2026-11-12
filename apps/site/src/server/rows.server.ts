import { env } from "cloudflare:workers";
import type { Quality, QualityCounts } from "../lib/qualities";
import type { FeedItem } from "../lib/types";

// Shared by the modules that read posts: the columns a feed item needs, the
// row they come back as, and how it becomes a FeedItem.

export const db = () => env.DB;

export const POST_COLUMNS = `p.id, p.slug, p.title, p.excerpt, p.word_count, p.allow_debate, p.published_at,
	p.shape, p.opening, a.name AS author_name, a.handle AS author_handle,
	(SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count`;

export type PostRow = {
	id: string;
	slug: string;
	title: string;
	excerpt: string | null;
	word_count: number;
	allow_debate: number;
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

/** How many readers chose each quality, for each of these posts. */
export async function qualityCounts(postIds: string[]): Promise<Map<string, QualityCounts>> {
	const result = new Map<string, QualityCounts>();
	if (postIds.length === 0) return result;
	const marks = postIds.map(() => "?").join(", ");
	const { results } = await db()
		.prepare(`SELECT post_id, quality, COUNT(*) AS n FROM reactions WHERE post_id IN (${marks}) GROUP BY post_id, quality`)
		.bind(...postIds)
		.all<{ post_id: string; quality: Quality; n: number }>();
	for (const row of results) {
		const counts = result.get(row.post_id) ?? {};
		counts[row.quality] = row.n;
		result.set(row.post_id, counts);
	}
	return result;
}
