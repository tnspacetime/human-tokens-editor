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

type PieceLink = { id: string; slug: string; title: string };

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

	const [counts, mine, comments, postscripts, follows, followUps] = await Promise.all([
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
		// The earlier piece this one follows up, and the pieces that follow it up.
		db()
			.prepare("SELECT e.id, e.slug, e.title FROM posts p JOIN posts e ON e.id = p.follows WHERE p.id = ?")
			.bind(id)
			.first<PieceLink>(),
		db()
			.prepare("SELECT id, slug, title FROM posts WHERE follows = ? ORDER BY published_at")
			.bind(id)
			.all<PieceLink>(),
	]);

	return {
		...toFeedItem(row, counts.get(id) ?? {}),
		...chapters(renderer.render(row.markdown), row.parts),
		allowDebate: row.allow_debate === 1,
		mine: mine.results.map((r) => r.quality),
		follows: follows ?? null,
		followUps: followUps.results,
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
