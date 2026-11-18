import { createRenderer } from "@human-tokens/renderer";
import type { Quality } from "../lib/qualities";
import type { PostPage } from "../lib/types";
import type { User } from "./auth.server";
import { db, POST_COLUMNS, type PostRow, qualityCounts, toFeedItem } from "./rows.server";

// Images: only web links for now. Images next to the author's file get
// uploaded with the post later (R2), and resolve to their stored copy.
const renderer = createRenderer({
	resolveImage: (src) => (/^https:\/\//i.test(src) ? src : null),
	unresolvedImageLabel: "Image not uploaded yet",
});

type PieceRow = { id: string; slug: string; title: string; name: string; handle: string; own: number; published_at: string };
const pieceLink = (row: PieceRow) => ({ id: row.id, slug: row.slug, title: row.title, author: { name: row.name, handle: row.handle } });

/**
 * A series' chapters are its h2s: give each an id to jump to, and list them
 * for the contents at the top. A single piece has none.
 */
function chapters(html: string, parts: number | null) {
	if (!parts) return { html, chapters: [] };
	const list: { id: string; title: string }[] = [];
	const marked = html.replace(/<h2>([\s\S]*?)<\/h2>/g, (_, inner: string) => {
		const id = `part-${list.length + 1}`;
		list.push({ id, title: plainText(inner) });
		return `<h2 id="${id}">${inner}</h2>`;
	});
	return { html: marked, chapters: list };
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** A rendered heading's text, without its tags. */
const plainText = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e] ?? e);

/** A piece, rendered, with its comments and what the viewer chose. */
export async function loadPost(id: string, user: User | null): Promise<PostPage | null> {
	const row = await db()
		.prepare(`SELECT ${POST_COLUMNS}, p.markdown, p.parts, a.user_id AS author_user_id FROM posts p JOIN authors a ON a.id = p.author_id WHERE p.id = ?`)
		.bind(id)
		.first<PostRow & { markdown: string; parts: number | null; author_user_id: string | null }>();
	if (!row) return null;

	const [counts, mine, comments, postscripts, respondsTo, responses] = await Promise.all([
		qualityCounts([id]),
		user
			? db()
					.prepare("SELECT quality FROM reactions WHERE post_id = ? AND user_id = ?")
					.bind(id, user.id)
					.all<{ quality: Quality }>()
			: { results: [] as { quality: Quality }[] },
		db()
			.prepare(
				`SELECT c.id, c.user_id, u.name, c.body, c.author_note, c.created_at
				 FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.created_at`,
			)
			.bind(id)
			.all<{ id: string; user_id: string; name: string; body: string; author_note: string | null; created_at: string }>(),
		db()
			.prepare("SELECT id, body, created_at FROM postscripts WHERE post_id = ? ORDER BY created_at")
			.bind(id)
			.all<{ id: string; body: string; created_at: string }>(),
		// The piece this one responds to, and the pieces that respond to it:
		// by the same author, follow-ups; by anyone else, replies.
		db()
			.prepare(
				`SELECT e.id, e.slug, e.title, a.name, a.handle, e.published_at, e.author_id = p.author_id AS own
				 FROM posts p JOIN posts e ON e.id = p.responds_to JOIN authors a ON a.id = e.author_id WHERE p.id = ?`,
			)
			.bind(id)
			.first<PieceRow>(),
		db()
			.prepare(
				`SELECT r.id, r.slug, r.title, a.name, a.handle, r.published_at, r.author_id = p.author_id AS own
				 FROM posts r JOIN posts p ON p.id = r.responds_to JOIN authors a ON a.id = r.author_id
				 WHERE r.responds_to = ? ORDER BY r.published_at`,
			)
			.bind(id)
			.all<PieceRow>(),
	]);

	return {
		...toFeedItem(row, counts.get(id) ?? {}),
		...chapters(renderer.render(row.markdown), row.parts),
		allowDebate: row.allow_debate === 1,
		mine: mine.results.map((r) => r.quality),
		respondsTo: respondsTo ? { ...pieceLink(respondsTo), own: respondsTo.own === 1 } : null,
		followUps: responses.results.filter((r) => r.own === 1).map(pieceLink),
		replies: responses.results.filter((r) => r.own !== 1).map((r) => ({ ...pieceLink(r), publishedAt: r.published_at })),
		postscripts: postscripts.results.map((ps) => ({ id: ps.id, html: renderer.render(ps.body), createdAt: ps.created_at })),
		commentList: comments.results.map((c) => ({
			id: c.id,
			name: c.name,
			body: c.body,
			authorNote: c.author_note,
			createdAt: c.created_at,
			mine: c.user_id === user?.id,
		})),
		viewer: user && { name: user.name, isAuthor: row.author_user_id === user.id },
	};
}
