import { QUALITIES, type Quality } from "../lib/qualities";
import type { Ranking, RankingEntry, RankingPeriod } from "../lib/types";
import { settledBefore } from "./feed.server";
import { batches, db, marks } from "./rows.server";

// The boards: the posts readers chose most for each quality. The homepage's
// for Today, This week and This month; the archive's for All time.
//
// It's worked out once an hour (src/server.ts, the hourly schedule) from
// tallies kept by database triggers (migrations/0017_ranking.sql): Today
// from the hourly ones, This week and This month from the daily ones, so a
// busy month reads 30 tallies per post and quality, not 720. It's stored in
// the `ranking` table: post ids and counts only. The All time board is
// worked out once a day from each post's running totals (post_totals).
// Pages read the stored boards and look up the titles, so a deleted post
// drops out. Only settled posts are ranked (as on every list): one its
// author can still fix joins at the first work-out after it settles.

/** "2026-11-20T13": an hour as reaction_hours keeps it. */
const hourOf = (ms: number) => new Date(ms).toISOString().slice(0, 13);
/** "2026-11-20": a day as reaction_days keeps it. */
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Each period: the tallies it adds up, and the first one it takes (UTC). */
const PERIODS: { id: RankingPeriod["id"]; label: string; tallies: "reaction_hours" | "reaction_days"; unit: "hour" | "day"; from: (now: number) => string }[] = [
	// The last 24 hours, and the hour now under way.
	{ id: "day", label: "Today", tallies: "reaction_hours", unit: "hour", from: (now) => hourOf(now - 24 * HOUR_MS) },
	// The day under way and the 6 before it.
	{ id: "week", label: "This week", tallies: "reaction_days", unit: "day", from: (now) => dayOf(now - 6 * DAY_MS) },
	// The day under way and the 29 before it.
	{ id: "month", label: "This month", tallies: "reaction_days", unit: "day", from: (now) => dayOf(now - 29 * DAY_MS) },
];

/** How far down each quality's list goes (the homepage shows three, then ten). */
export const LIST_LENGTH = 10;

/** The hourly cleanup drops tallies no period needs: hourly ones after 2 days, daily ones after 31. */
export const oldestTallies = (now: number) => ({ hour: hourOf(now - 2 * DAY_MS), day: dayOf(now - 31 * DAY_MS) });

type Lists = Partial<Record<RankingPeriod["id"], Record<Quality, [postId: string, votes: number][]>>>;
type Stored = { workedOutAt: string; lists: Lists };

/** The boards, as the `ranking` table keeps them. */
type Board = "recent" | "all_time";

async function store(board: Board, now: number, lists: Lists): Promise<Stored> {
	const stored: Stored = { workedOutAt: new Date(now).toISOString(), lists };
	await db()
		.prepare("INSERT INTO ranking (board, worked_out_at, lists) VALUES (?1, ?2, ?3) ON CONFLICT (board) DO UPDATE SET worked_out_at = ?2, lists = ?3")
		.bind(board, stored.workedOutAt, JSON.stringify(lists))
		.run();
	return stored;
}

const emptyLists = () => Object.fromEntries(QUALITIES.map((q) => [q.id, []])) as unknown as Record<Quality, [string, number][]>;

/**
 * The homepage's board (hourly). For each period, one query adds up the
 * tallies and keeps the top ten per quality (most chosen first; between
 * equals, the one chosen most lately), so only those rows come back.
 */
export async function workOutRanking(now = Date.now()): Promise<Stored> {
	const settled = settledBefore(now);
	const statements = PERIODS.map(({ tallies, unit, from }) =>
		db()
			.prepare(
				`SELECT post_id, quality, votes FROM (
				   SELECT t.post_id, t.quality, SUM(t.n) AS votes,
				     ROW_NUMBER() OVER (PARTITION BY t.quality ORDER BY SUM(t.n) DESC, MAX(t.${unit}) DESC, t.post_id) AS place
				   FROM ${tallies} t JOIN posts p ON p.id = t.post_id AND p.published_at <= ?3
				   WHERE t.${unit} >= ?1
				   GROUP BY t.post_id, t.quality HAVING SUM(t.n) > 0
				 ) WHERE place <= ?2 ORDER BY quality, place`,
			)
			.bind(from(now), LIST_LENGTH, settled),
	);
	const results = await db().batch<{ post_id: string; quality: Quality; votes: number }>(statements);
	const lists: Lists = {};
	PERIODS.forEach(({ id }, i) => {
		const byQuality = emptyLists();
		for (const row of results[i].results) byQuality[row.quality]?.push([row.post_id, row.votes]);
		lists[id] = byQuality;
	});
	return store("recent", now, lists);
}

/** How often the archive's All time board is worked out. */
const ALL_TIME_EVERY_MS = DAY_MS;

/**
 * The archive's All time board (daily): the posts with the most readers for
 * each quality, ever, from each post's running totals (post_totals). One
 * pass over the totals per quality, once a day.
 */
export async function workOutAllTime(now = Date.now()): Promise<Stored> {
	const settled = settledBefore(now);
	const results = await db().batch<{ post_id: string; votes: number }>(
		QUALITIES.map((q) =>
			db()
				.prepare(
					`SELECT t.post_id, t.${q.id} AS votes FROM post_totals t JOIN posts p ON p.id = t.post_id AND p.published_at <= ?2
					 WHERE t.${q.id} > 0 ORDER BY t.${q.id} DESC, t.post_id LIMIT ?1`,
				)
				.bind(LIST_LENGTH, settled),
		),
	);
	const byQuality = emptyLists();
	QUALITIES.forEach((q, i) => {
		byQuality[q.id] = results[i].results.map((row) => [row.post_id, row.votes]);
	});
	return store("all_time", now, { all: byQuality });
}

/** Run every hour: the All time board when a day has passed since it was last worked out (or it never was). */
export async function workOutAllTimeIfDue(now = Date.now()) {
	const row = await db().prepare("SELECT worked_out_at FROM ranking WHERE board = 'all_time'").first<{ worked_out_at: string }>();
	// A few minutes' slack, so an hourly run that starts a little early still counts as a day.
	if (row && now - Date.parse(row.worked_out_at) < ALL_TIME_EVERY_MS - 10 * 60_000) return;
	await workOutAllTime(now);
}

/** A stored board with its posts' titles. Worked out on the spot only if it never has been (just after deploying). */
async function loadBoard(board: Board): Promise<Ranking> {
	const row = await db().prepare("SELECT worked_out_at, lists FROM ranking WHERE board = ?").bind(board).first<{ worked_out_at: string; lists: string }>();
	const stored: Stored = row
		? { workedOutAt: row.worked_out_at, lists: JSON.parse(row.lists) }
		: await (board === "recent" ? workOutRanking() : workOutAllTime());

	// The posts every list names (at most 150), in one query per 100.
	const ids = [...new Set(Object.values(stored.lists).flatMap((byQuality) => Object.values(byQuality ?? {}).flat().map(([id]) => id)))];
	const posts = new Map<string, RankingEntry["post"]>();
	const found = await Promise.all(
		batches(ids).map((some) =>
			db()
				.prepare(`SELECT p.id, p.slug, p.title, a.name AS author FROM posts p JOIN authors a ON a.id = p.author_id WHERE p.id IN (${marks(some)})`)
				.bind(...some)
				.all<RankingEntry["post"]>(),
		),
	);
	for (const { results } of found) for (const post of results) posts.set(post.id, post);

	const shown = board === "recent" ? PERIODS : [{ id: "all" as const, label: "All time" }];
	const periods: RankingPeriod[] = shown.map(({ id, label }) => ({
		id,
		label,
		top: Object.fromEntries(
			QUALITIES.map((q) => [
				q.id,
				(stored.lists[id]?.[q.id] ?? []).flatMap(([postId, votes]) => {
					const post = posts.get(postId);
					return post ? [{ post, votes }] : [];
				}),
			]),
		) as RankingPeriod["top"],
	}));
	// Open on the shortest period that fills all five lists, so nobody
	// arrives to a row of blanks; failing that, the fullest.
	const filled = (p: RankingPeriod) => Object.values(p.top).filter((list) => list.length > 0).length;
	const initial = (periods.find((p) => filled(p) === QUALITIES.length) ?? [...periods].sort((a, b) => filled(b) - filled(a))[0]).id;
	return { periods, initial, workedOutAt: stored.workedOutAt, cadence: board === "recent" ? "hourly" : "daily" };
}

/** The homepage's board: Today, This week, This month (worked out hourly). */
export const loadRanking = () => loadBoard("recent");

/** The archive's board: All time (worked out daily). */
export const loadAllTime = () => loadBoard("all_time");
