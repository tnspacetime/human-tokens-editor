import type { Quality } from "../lib/qualities";
import type { Archive, ArchiveItem, ArchiveLines } from "../lib/types";
import { settledBefore } from "./feed.server";
import { loadAllTime } from "./ranking.server";
import { db, QUALITY_TOTALS, totalsToCounts } from "./rows.server";

// The archive: every post, one month at a time, with the All time board on
// top. Built from rows that don't grow with the site: the month counts
// (post_months, kept by database triggers), one month's lines 100 at a time,
// and the stored board. Like every list, it shows a post once its fix window
// has ended.

/** How many lines come at a time: the first with the page, the rest as you scroll. */
export const ARCHIVE_BATCH = 100;

const minutes = (words: number) => Math.max(1, Math.round(words / 220));
const pad = (n: number) => String(n).padStart(2, "0");
/** "2026-11" */
const monthKey = (year: number, month: number) => `${year}-${pad(month)}`;

/**
 * How many posts each month has ("2026-11" → 12), counting only those whose
 * fix window has ended: the stored counts, less the posts of the last 15
 * minutes (a handful, read from the date index).
 */
export async function monthCounts(settled: string): Promise<Map<string, number>> {
	const [all, unsettled] = await db().batch<{ month: string; n: number }>([
		db().prepare("SELECT month, n FROM post_months ORDER BY month DESC"),
		db().prepare("SELECT substr(published_at, 1, 7) AS month, COUNT(*) AS n FROM posts WHERE published_at > ? GROUP BY 1").bind(settled),
	]);
	const counts = new Map(all.results.map((r) => [r.month, r.n]));
	for (const r of unsettled.results) counts.set(r.month, (counts.get(r.month) ?? 0) - r.n);
	for (const [month, n] of counts) if (n <= 0) counts.delete(month);
	return counts;
}

/**
 * A page of the archive: a month (the latest of `year`, or the latest of
 * all, when not given). Null for a year or month with nothing in it.
 */
export async function loadArchive(year?: number, month?: number): Promise<Archive | null> {
	const settled = settledBefore();
	const [counts, first, board] = await Promise.all([
		monthCounts(settled),
		db().prepare("SELECT published_at FROM posts WHERE published_at <= ? ORDER BY published_at, id LIMIT 1").bind(settled).first<{ published_at: string }>(),
		loadAllTime(),
	]);
	const keys = [...counts.keys()].sort().reverse();
	const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
	const since = first?.published_at ?? null;

	if (keys.length === 0) {
		if (year !== undefined) return null;
		return { board, years: [], year: new Date().getUTCFullYear(), months: [], month: null, total: 0, since, items: [], next: null };
	}
	const chosen = month !== undefined && year !== undefined ? monthKey(year, month) : keys.find((k) => year === undefined || k.startsWith(`${year}-`));
	if (!chosen || !counts.has(chosen)) return null;
	const chosenYear = Number(chosen.slice(0, 4));

	const years = new Map<number, number>();
	for (const [key, n] of counts) years.set(Number(key.slice(0, 4)), (years.get(Number(key.slice(0, 4))) ?? 0) + n);
	return {
		board,
		years: [...years].sort((a, b) => b[0] - a[0]).map(([y, count]) => ({ year: y, count })),
		year: chosenYear,
		months: keys.filter((k) => k.startsWith(`${chosenYear}-`)).map((k) => ({ month: Number(k.slice(5, 7)), count: counts.get(k) ?? 0 })),
		month: Number(chosen.slice(5, 7)),
		total,
		since,
		...(await loadArchiveLines(chosen, undefined, settled)),
	};
}

/**
 * One month's lines ("2026-11"), newest first, 100 at a time. Paging goes by
 * position: `after` is the last line already shown (its date and id).
 */
export async function loadArchiveLines(month: string, after?: string, settled = settledBefore()): Promise<ArchiveLines> {
	const year = Number(month.slice(0, 4));
	const m = Number(month.slice(5, 7));
	// The month as a range of dates, so the index on published_at answers it,
	// ending where its fix windows end.
	const from = `${month}-01`;
	const end = m === 12 ? `${year + 1}-01-01` : `${monthKey(year, m + 1)}-01`;
	const [at, id] = after?.split("~") ?? [];
	const position = at && id ? "AND (p.published_at < ?4 OR (p.published_at = ?4 AND p.id < ?5))" : "";
	const statement = db().prepare(
		`SELECT p.id, p.slug, p.title, p.word_count, p.published_at, a.name AS author, t.comments, ${QUALITY_TOTALS}
		 FROM posts p JOIN authors a ON a.id = p.author_id LEFT JOIN post_totals t ON t.post_id = p.id
		 WHERE p.published_at >= ?1 AND p.published_at < ?2 AND p.published_at <= ?3 ${position}
		 ORDER BY p.published_at DESC, p.id DESC LIMIT ${ARCHIVE_BATCH + 1}`,
	);
	const { results } = await (position ? statement.bind(from, end, settled, at, id) : statement.bind(from, end, settled)).all<
		{ id: string; slug: string; title: string; word_count: number; published_at: string; author: string; comments: number | null } & Record<Quality, number | null>
	>();
	const rows = results.slice(0, ARCHIVE_BATCH);
	const items: ArchiveItem[] = rows.map((row) => ({
		id: row.id,
		slug: row.slug,
		title: row.title,
		author: row.author,
		publishedAt: row.published_at,
		minutes: minutes(row.word_count),
		qualities: totalsToCounts(row),
		comments: row.comments ?? 0,
	}));
	const last = rows.at(-1);
	return { items, next: results.length > ARCHIVE_BATCH && last ? `${last.published_at}~${last.id}` : null };
}
