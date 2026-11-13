import { QUALITIES, type Quality } from "../lib/qualities";
import type { Board, BoardEntry, BoardWindow } from "../lib/types";
import { db } from "./rows.server";

const WINDOWS: { id: BoardWindow["id"]; label: string; hours: number }[] = [
	{ id: "1h", label: "Last hour", hours: 1 },
	{ id: "12h", label: "Last 12 hours", hours: 12 },
	{ id: "24h", label: "Last 24 hours", hours: 24 },
	{ id: "7d", label: "This week", hours: 24 * 7 },
];

// The board takes a dozen queries, so it's kept for a minute rather than
// worked out for every visitor; a reaction on this server clears it at once.
// (This keeps it per server instance; with real traffic, move it to
// Cloudflare's cache or KV so every instance shares one copy.)
const KEEP_MS = 60_000;
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
 * how many readers, and the top three pieces for each quality. The board
 * opens on the shortest window that fills all four lists, so nobody arrives
 * to a row of blanks.
 */
async function countBoard(now: number): Promise<Board> {
	const counted = await Promise.all(
		WINDOWS.map(async ({ id, label, hours }) => {
			const since = new Date(now - hours * 3_600_000).toISOString();
			const [pieces, activity, counts] = await Promise.all([
				db().prepare("SELECT COUNT(*) AS n FROM posts WHERE published_at >= ?").bind(since).first<{ n: number }>(),
				db()
					.prepare("SELECT COUNT(*) AS reactions, COUNT(DISTINCT reader_id) AS readers FROM reactions WHERE created_at >= ?")
					.bind(since)
					.first<{ reactions: number; readers: number }>(),
				db()
					.prepare(
						"SELECT post_id, quality, COUNT(*) AS n FROM reactions WHERE created_at >= ? GROUP BY post_id, quality ORDER BY n DESC, MAX(created_at) DESC",
					)
					.bind(since)
					.all<{ post_id: string; quality: Quality; n: number }>(),
			]);
			const top = new Map<Quality, { postId: string; votes: number }[]>();
			for (const row of counts.results) {
				const list = top.get(row.quality) ?? [];
				if (list.length < 3) list.push({ postId: row.post_id, votes: row.n });
				top.set(row.quality, list);
			}
			return { id, label, pieces: pieces?.n ?? 0, reactions: activity?.reactions ?? 0, readers: activity?.readers ?? 0, top };
		}),
	);

	// Fill in the posts every list mentions, in one query.
	const ids = [...new Set(counted.flatMap((w) => [...w.top.values()].flat().map((e) => e.postId)))];
	const posts = new Map<string, BoardEntry["post"]>();
	if (ids.length > 0) {
		const { results } = await db()
			.prepare(
				`SELECT p.id, p.slug, p.title, a.name AS author FROM posts p JOIN authors a ON a.id = p.author_id WHERE p.id IN (${ids.map(() => "?").join(", ")})`,
			)
			.bind(...ids)
			.all<BoardEntry["post"]>();
		for (const post of results) posts.set(post.id, post);
	}
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
