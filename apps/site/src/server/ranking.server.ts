import { QUALITIES, type Quality } from "../lib/qualities";
import { shorten, TRAIL_COUNT } from "../lib/trails";
import type { Ranking, RankingPeriod, Trail, TrailPeriod, TrailPost, Trails } from "../lib/types";
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
// drops out.
//
// Trails are worked out with them, in the same runs and the same writes:
// the replies readers chose most (all qualities together), each with the
// posts it answers back to the opening one. This week and This month with
// the hourly board, All time with the daily one. Only settled posts are ranked (as on every list): one its
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
/** A trail as stored: the reply, its votes, the posts shown (opening first, reply last), and how many are left out. */
type StoredTrail = { votes: number; shown: string[]; more: number };
type StoredTrails = Partial<Record<TrailPeriod, StoredTrail[]>>;
type Stored = { workedOutAt: string; lists: Lists; trails: StoredTrails };

/** The boards, as the `ranking` table keeps them. */
type Board = "recent" | "all_time";

async function store(board: Board, now: number, lists: Lists, trails: StoredTrails): Promise<Stored> {
	const stored: Stored = { workedOutAt: new Date(now).toISOString(), lists, trails };
	await db()
		.prepare(
			"INSERT INTO ranking (board, worked_out_at, lists, trails) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (board) DO UPDATE SET worked_out_at = ?2, lists = ?3, trails = ?4",
		)
		.bind(board, stored.workedOutAt, JSON.stringify(lists), JSON.stringify(trails))
		.run();
	return stored;
}

/**
 * How far back a trail is followed: a bound on the work for one trail, far
 * past any real conversation. (Each post answers an earlier one, so a trail
 * can't loop; this only caps its length.)
 */
const TRAIL_DEPTH = 1000;

/**
 * Each reply's trail: the posts it answers, back to the opening one. One
 * query follows every reply's links at once, reading one post per step.
 * A reply whose link was dropped (the post it answered was deleted) isn't
 * a reply any more, and has no trail.
 */
async function followTrails(replies: string[]): Promise<Map<string, string[]>> {
	const paths = new Map<string, string[]>();
	if (replies.length === 0) return paths;
	const { results } = await db()
		.prepare(
			`WITH RECURSIVE up (reply, id, depth) AS (
			   SELECT id, id, 0 FROM posts WHERE id IN (${marks(replies)})
			   UNION ALL
			   SELECT up.reply, p.responds_to, up.depth + 1 FROM up JOIN posts p ON p.id = up.id
			   WHERE p.responds_to IS NOT NULL AND up.depth < ?${replies.length + 1}
			 )
			 SELECT reply, id FROM up ORDER BY reply, depth DESC`,
		)
		.bind(...replies, TRAIL_DEPTH)
		.all<{ reply: string; id: string }>();
	for (const { reply, id } of results) {
		const path = paths.get(reply);
		if (path) path.push(id);
		else paths.set(reply, [id]);
	}
	return paths;
}

/** The trails for the replies chosen, in their order: each one shortened to what's shown. */
function trailsOf(chosen: { post_id: string; votes: number }[], paths: Map<string, string[]>): StoredTrail[] {
	return chosen.flatMap(({ post_id, votes }) => {
		const path = paths.get(post_id);
		if (!path || path.length < 2) return [];
		const { shown, more } = shorten(path);
		return [{ votes, shown, more }];
	});
}

const emptyLists = () => Object.fromEntries(QUALITIES.map((q) => [q.id, []])) as unknown as Record<Quality, [string, number][]>;

/**
 * The homepage's board (hourly). For each period, one query adds up the
 * tallies and keeps the top ten per quality (most chosen first; between
 * equals, the one chosen most lately), so only those rows come back.
 *
 * Each reads only its period's tallies, by their key (hour or day first),
 * and adds them up per post before looking each post up once by its id
 * (to leave out those still being fixed). The period is worked out on its
 * own first (MATERIALIZED): joined straight to posts, the planner would
 * walk every post ever published instead.
 */
export async function workOutRanking(now = Date.now()): Promise<Stored> {
	const settled = settledBefore(now);
	const week = PERIODS.find((p) => p.id === "week")!;
	const month = PERIODS.find((p) => p.id === "month")!;
	// The replies chosen most, This week and This month: one pass over the
	// month's daily tallies serves both (the week is the end of the month),
	// added up per post first, then each post looked up once to keep the
	// replies. Between equals, the one chosen most lately.
	const replies = db()
		.prepare(
			`WITH chosen AS MATERIALIZED (
			   SELECT post_id, SUM(n) AS month, SUM(CASE WHEN day >= ?2 THEN n ELSE 0 END) AS week, MAX(day) AS last
			   FROM reaction_days WHERE day >= ?1 GROUP BY post_id
			 ),
			 replies AS MATERIALIZED (
			   SELECT c.* FROM chosen c JOIN posts p ON p.id = c.post_id AND p.published_at <= ?3 AND p.responds_to IS NOT NULL
			 )
			 SELECT * FROM (SELECT 'week' AS period, post_id, week AS votes FROM replies WHERE week > 0 ORDER BY week DESC, last DESC, post_id LIMIT ?4)
			 UNION ALL
			 SELECT * FROM (SELECT 'month' AS period, post_id, month AS votes FROM replies WHERE month > 0 ORDER BY month DESC, last DESC, post_id LIMIT ?4)`,
		)
		.bind(month.from(now), week.from(now), settled, TRAIL_COUNT);
	const statements = PERIODS.map(({ tallies, unit, from }) =>
		db()
			.prepare(
				`WITH period AS MATERIALIZED (
				   SELECT post_id, quality, SUM(n) AS votes, MAX(${unit}) AS last
				   FROM ${tallies} WHERE ${unit} >= ?1
				   GROUP BY post_id, quality HAVING SUM(n) > 0
				 )
				 SELECT post_id, quality, votes FROM (
				   SELECT t.post_id, t.quality, t.votes,
				     ROW_NUMBER() OVER (PARTITION BY t.quality ORDER BY t.votes DESC, t.last DESC, t.post_id) AS place
				   FROM period t JOIN posts p ON p.id = t.post_id AND p.published_at <= ?3
				 ) WHERE place <= ?2 ORDER BY quality, place`,
			)
			.bind(from(now), LIST_LENGTH, settled),
	);
	const [chosen, ...results] = await db().batch([replies, ...statements]);
	const lists: Lists = {};
	PERIODS.forEach(({ id }, i) => {
		const byQuality = emptyLists();
		for (const row of results[i].results as { post_id: string; quality: Quality; votes: number }[]) byQuality[row.quality]?.push([row.post_id, row.votes]);
		lists[id] = byQuality;
	});
	const rows = chosen.results as { period: "week" | "month"; post_id: string; votes: number }[];
	const paths = await followTrails([...new Set(rows.map((row) => row.post_id))]);
	const trails: StoredTrails = {
		week: trailsOf(rows.filter((row) => row.period === "week"), paths),
		month: trailsOf(rows.filter((row) => row.period === "month"), paths),
	};
	return store("recent", now, lists, trails);
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
	// The replies chosen most, ever: each reply's running totals, all
	// qualities together. Read through the replies' own index
	// (posts_by_responds_to), not every post.
	const all = QUALITIES.map((q) => `t.${q.id}`).join(" + ");
	const replies = db()
		.prepare(
			`SELECT p.id AS post_id, ${all} AS votes
			 FROM posts p INDEXED BY posts_by_responds_to JOIN post_totals t ON t.post_id = p.id
			 WHERE p.responds_to IS NOT NULL AND p.published_at <= ?2 AND ${all} > 0
			 ORDER BY votes DESC, p.id LIMIT ?1`,
		)
		.bind(TRAIL_COUNT, settled);
	const [chosen, ...results] = await db().batch<{ post_id: string; votes: number }>([
		replies,
		...QUALITIES.map((q) =>
			db()
				.prepare(
					`SELECT t.post_id, t.${q.id} AS votes FROM post_totals t JOIN posts p ON p.id = t.post_id AND p.published_at <= ?2
					 WHERE t.${q.id} > 0 ORDER BY t.${q.id} DESC, t.post_id LIMIT ?1`,
				)
				.bind(LIST_LENGTH, settled),
		),
	]);
	const byQuality = emptyLists();
	QUALITIES.forEach((q, i) => {
		byQuality[q.id] = results[i].results.map((row) => [row.post_id, row.votes]);
	});
	const paths = await followTrails(chosen.results.map((row) => row.post_id));
	return store("all_time", now, { all: byQuality }, { all: trailsOf(chosen.results, paths) });
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
	const stored: Pick<Stored, "workedOutAt" | "lists"> = row
		? { workedOutAt: row.worked_out_at, lists: JSON.parse(row.lists) }
		: await (board === "recent" ? workOutRanking() : workOutAllTime());

	// The posts every list names (at most 150).
	const posts = await postsByIds([...new Set(Object.values(stored.lists).flatMap((byQuality) => Object.values(byQuality ?? {}).flat().map(([id]) => id)))]);

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

/** Titles and authors for these posts, in one query per 100. */
async function postsByIds(ids: string[]): Promise<Map<string, TrailPost>> {
	const posts = new Map<string, TrailPost>();
	const found = await Promise.all(
		batches(ids).map((some) =>
			db()
				.prepare(`SELECT p.id, p.slug, p.title, a.name AS author FROM posts p JOIN authors a ON a.id = p.author_id WHERE p.id IN (${marks(some)})`)
				.bind(...some)
				.all<TrailPost>(),
		),
	);
	for (const { results } of found) for (const post of results) posts.set(post.id, post);
	return posts;
}

/**
 * The homepage's trails: This week and This month from the hourly board,
 * All time from the daily one, with their posts' titles (at most 60 posts).
 * A board not worked out with its trails yet (just after deploying) is
 * worked out on the spot. A trail missing one of its posts (deleted since)
 * is left out until the next work-out.
 */
export async function loadTrails(): Promise<Trails> {
	const { results } = await db()
		.prepare("SELECT board, trails FROM ranking WHERE board IN ('recent', 'all_time')")
		.all<{ board: Board; trails: string | null }>();
	const kept = new Map(results.map((row) => [row.board, row.trails]));
	const read = async (board: Board): Promise<StoredTrails> => {
		const trails = kept.get(board);
		if (trails) return JSON.parse(trails);
		return (await (board === "recent" ? workOutRanking() : workOutAllTime())).trails;
	};
	const [recent, allTime] = await Promise.all([read("recent"), read("all_time")]);
	const stored: Record<TrailPeriod, StoredTrail[]> = { week: recent.week ?? [], month: recent.month ?? [], all: allTime.all ?? [] };

	const posts = await postsByIds([...new Set(Object.values(stored).flatMap((trails) => trails.flatMap((trail) => trail.shown)))]);
	const withPosts = (trails: StoredTrail[]): Trail[] =>
		trails.flatMap(({ votes, shown, more }) => {
			const found = shown.map((id) => posts.get(id));
			return found.every((post) => post) ? [{ votes, posts: found as TrailPost[], more }] : [];
		});
	return { week: withPosts(stored.week), month: withPosts(stored.month), all: withPosts(stored.all) };
}
