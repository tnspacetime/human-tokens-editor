import type { Quality, QualityCounts } from "../lib/qualities";
import type { Archive, ArchiveItem } from "../lib/types";
import { db } from "./rows.server";

const minutes = (words: number) => Math.max(1, Math.round(words / 220));

/**
 * Every piece, one year at a time: which years have pieces (and how many),
 * then the chosen year's pieces newest first, in months. With no year, the
 * latest. Null for a year with nothing in it.
 */
export async function loadArchive(year?: number): Promise<Archive | null> {
	const [years, first] = await Promise.all([
		db()
			.prepare("SELECT CAST(substr(published_at, 1, 4) AS INTEGER) AS year, COUNT(*) AS count FROM posts GROUP BY year ORDER BY year DESC")
			.all<{ year: number; count: number }>(),
		db().prepare("SELECT MIN(published_at) AS at FROM posts").first<{ at: string | null }>(),
	]);
	const chosen = year ?? years.results[0]?.year;
	const total = years.results.reduce((sum, y) => sum + y.count, 0);
	if (chosen === undefined) return year === undefined ? { years: [], year: new Date().getUTCFullYear(), total: 0, since: null, months: [] } : null;
	if (!years.results.some((y) => y.year === chosen)) return null;

	// The year as a range of dates, so the index on published_at answers it.
	const from = `${chosen}-01-01`;
	const to = `${chosen + 1}-01-01`;
	const [rows, reactions] = await Promise.all([
		db()
			.prepare(
				`SELECT p.id, p.slug, p.title, p.word_count, p.published_at, a.name AS author,
					(SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments
				 FROM posts p JOIN authors a ON a.id = p.author_id
				 WHERE p.published_at >= ?1 AND p.published_at < ?2
				 ORDER BY p.published_at DESC, p.id DESC`,
			)
			.bind(from, to)
			.all<{ id: string; slug: string; title: string; word_count: number; published_at: string; author: string; comments: number }>(),
		db()
			.prepare(
				`SELECT r.post_id, r.quality, COUNT(*) AS n FROM reactions r JOIN posts p ON p.id = r.post_id
				 WHERE p.published_at >= ?1 AND p.published_at < ?2 GROUP BY r.post_id, r.quality`,
			)
			.bind(from, to)
			.all<{ post_id: string; quality: Quality; n: number }>(),
	]);

	const counts = new Map<string, QualityCounts>();
	for (const r of reactions.results) {
		const c = counts.get(r.post_id) ?? {};
		c[r.quality] = r.n;
		counts.set(r.post_id, c);
	}

	const months: Archive["months"] = [];
	for (const row of rows.results) {
		const month = Number(row.published_at.slice(5, 7));
		const item: ArchiveItem = {
			id: row.id,
			slug: row.slug,
			title: row.title,
			author: row.author,
			publishedAt: row.published_at,
			minutes: minutes(row.word_count),
			qualities: counts.get(row.id) ?? {},
			comments: row.comments,
		};
		const last = months.at(-1);
		if (last?.month === month) last.items.push(item);
		else months.push({ month, items: [item] });
	}
	return { years: years.results, year: chosen, total, since: first?.at ?? null, months };
}

/** How many pieces there are in all. */
export async function countPosts() {
	const row = await db().prepare("SELECT COUNT(*) AS n FROM posts").first<{ n: number }>();
	return row?.n ?? 0;
}
