import { QUALITIES, type Quality } from "../lib/qualities";
import type { Board, BoardEntry, BoardWindow } from "../lib/types";
import { batches, db, marks } from "./rows.server";

const WINDOWS: { id: BoardWindow["id"]; label: string; hours: number }[] = [
	{ id: "1h", label: "Last hour", hours: 1 },
	{ id: "12h", label: "Last 12 hours", hours: 12 },
	{ id: "24h", label: "Last 24 hours", hours: 24 },
	{ id: "7d", label: "This week", hours: 24 * 7 },
];

// The board takes a few queries, so it's kept for a minute rather than
// worked out for every visitor; a reaction on this server clears it at once.
// (This keeps it per server instance; with real traffic, move it to
// Cloudflare's cache or KV so every instance shares one copy.)
const KEEP_MS = 60_000;

/** How far down each quality's chart goes (the feed's board shows three). */
export const CHART_LENGTH = 10;
let kept: { at: number; board: Board } | null = null;

export function forgetBoard() {
	kept = null;
}

export async function loadBoard(): Promise<Board> {
	if (kept && Date.now() - kept.at < KEEP_MS) return kept.board;
	const board = await countBoard(Date.now());
	kept = { at: Date.now(), board };
	return board;
}

/**
 * For each time window: how many pieces came in, how many reactions from
 * how many readers, and the top ten pieces for each quality. The board
 * opens on the shortest window that fills all four lists, so nobody arrives
 * to a row of blanks.
 */
async function countBoard(now: number): Promise<Board> {
	// Every window ends now, so the shorter ones sit inside the week: two
	// queries over the week count all four. (?1 to ?4: where each window
	// starts, shortest first; the last is the week's.)
	const starts = WINDOWS.map(({ hours }) => new Date(now - hours * 3_600_000).toISOString());
	const week = WINDOWS.length;
	const per = (template: (n: number) => string) => WINDOWS.map((_, i) => template(i + 1)).join(", ");
	const [totals, counts] = await Promise.all([
		db()
			.prepare(
				`SELECT
				   (SELECT json_array(${per((n) => `SUM(published_at >= ?${n})`)}) FROM posts WHERE published_at >= ?${week}) AS pieces,
				   (SELECT json_array(${per((n) => `SUM(created_at >= ?${n})`)}) FROM reactions WHERE created_at >= ?${week}) AS reactions,
				   (SELECT json_array(${per((n) => `COUNT(DISTINCT CASE WHEN created_at >= ?${n} THEN user_id END)`)})
				    FROM reactions WHERE created_at >= ?${week}) AS readers`,
			)
			.bind(...starts)
			.first<{ pieces: string; reactions: string; readers: string }>(),
		// Each post and quality chosen this week: how often in each window,
		// and when last (the latest is always inside any window it's in).
		db()
			.prepare(
				`SELECT post_id, quality, json_array(${per((n) => `SUM(created_at >= ?${n})`)}) AS n, MAX(created_at) AS last
				 FROM reactions WHERE created_at >= ?${week} GROUP BY post_id, quality`,
			)
			.bind(...starts)
			.all<{ post_id: string; quality: Quality; n: string; last: string }>(),
	]);
	const numbers = (json: string | undefined) => (JSON.parse(json ?? "[]") as (number | null)[]).map((n) => n ?? 0);
	const [pieces, reactions, readers] = [numbers(totals?.pieces), numbers(totals?.reactions), numbers(totals?.readers)];
	const rows = counts.results.map((row) => ({ ...row, n: numbers(row.n) }));

	const counted = WINDOWS.map(({ id, label }, i) => {
		// Most chosen first; between equals, the one chosen most lately.
		const ranked = rows
			.filter((row) => row.n[i] > 0)
			.sort((x, y) => y.n[i] - x.n[i] || (x.last < y.last ? 1 : x.last > y.last ? -1 : 0));
		const top = new Map<Quality, { postId: string; votes: number }[]>();
		for (const row of ranked) {
			const list = top.get(row.quality) ?? [];
			if (list.length < CHART_LENGTH) list.push({ postId: row.post_id, votes: row.n[i] });
			top.set(row.quality, list);
		}
		return { id, label, pieces: pieces[i] ?? 0, reactions: reactions[i] ?? 0, readers: readers[i] ?? 0, top };
	});

	// Fill in the posts every list mentions, in one query.
	const ids = [...new Set(counted.flatMap((w) => [...w.top.values()].flat().map((e) => e.postId)))];
	const posts = new Map<string, BoardEntry["post"]>();
	// Up to 200 of them (four windows, five lists of ten): in pieces, as D1
	// takes at most 100 values in a query.
	const found = await Promise.all(
		batches(ids).map((piece) =>
			db()
				.prepare(`SELECT p.id, p.slug, p.title, a.name AS author FROM posts p JOIN authors a ON a.id = p.author_id WHERE p.id IN (${marks(piece)})`)
				.bind(...piece)
				.all<BoardEntry["post"]>(),
		),
	);
	for (const { results } of found) for (const post of results) posts.set(post.id, post);
	const entries = (list: { postId: string; votes: number }[] = []) =>
		list.flatMap((e) => {
			const post = posts.get(e.postId);
			return post ? [{ post, votes: e.votes }] : [];
		});

	const windows: BoardWindow[] = counted.map(({ top, ...rest }) => ({
		...rest,
		top: Object.fromEntries(QUALITIES.map((q) => [q.id, entries(top.get(q.id))])) as BoardWindow["top"],
	}));
	const filled = (w: BoardWindow) => Object.values(w.top).filter((list) => list.length > 0).length;
	const initial = (windows.find((w) => filled(w) === QUALITIES.length) ?? [...windows].sort((a, b) => filled(b) - filled(a))[0]).id;
	return { windows, initial };
}
