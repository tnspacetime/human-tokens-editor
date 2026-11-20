import type { Quality } from "../lib/qualities";
import type { Comment, CommentPage, PostLive, PostPage, PostYou } from "../lib/types";
import type { User } from "./auth.server";
import { fixableUntil, TOUCHED } from "./publish.server";
import { renderMarkdown } from "./render";
import { db, POST_COLUMNS, type PostRow, QUALITY_TOTALS, toFeedItem, totalsToCounts } from "./rows.server";


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

/**
 * A piece's own page, the same for everyone (Cloudflare keeps it: see
 * cache.server.ts): rendered, with its P.S.es and what it responds to and
 * what responds to it. Nothing about who's looking: that's loadPostYou, and
 * the reactions and comments are loadPostLive. When `slug` (from the
 * address) isn't its current one: only where it is now.
 */
export async function loadPost(id: string, slug: string | undefined): Promise<PostPage | { movedTo: string; fixable: boolean } | null> {
	const row = await db()
		.prepare(`SELECT ${POST_COLUMNS}, p.html, p.parts, ${TOUCHED} AS touched FROM posts p JOIN authors a ON a.id = p.author_id WHERE p.id = ?`)
		.bind(id)
		.first<PostRow & { html: string | null; parts: number | null; touched: number }>();
	if (!row) return null;
	// An old or wrong slug: where it is now, before anything else is read or rendered.
	if (slug !== undefined && row.slug !== slug) return { movedTo: row.slug, fixable: fixableUntil(row) !== null };

	const [postscripts, respondsTo, responses] = await Promise.all([
		db()
			.prepare("SELECT id, html, body, created_at FROM postscripts WHERE post_id = ? ORDER BY created_at")
			.bind(id)
			.all<{ id: string; html: string | null; body: string; created_at: string }>(),
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

	// No counts in the stored page (they'd be as old as it): PostLive has them.
	const { qualities: _counts, comments: _comments, ...item } = toFeedItem(row, {});
	return {
		...item,
		...chapters(row.html ?? (await storedHtml(id)), row.parts),
		fixableUntil: fixableUntil(row),
		respondsTo: respondsTo ? { ...pieceLink(respondsTo), own: respondsTo.own === 1 } : null,
		followUps: responses.results.filter((r) => r.own === 1).map(pieceLink),
		replies: responses.results.filter((r) => r.own !== 1).map((r) => ({ ...pieceLink(r), publishedAt: r.published_at })),
		postscripts: postscripts.results.map((ps) => ({ id: ps.id, html: ps.html ?? renderMarkdown(ps.body), createdAt: ps.created_at })),
	};
}

/** A post from before HTML was stored: rendered now (the markdown is read only in this case). */
async function storedHtml(id: string) {
	const row = await db().prepare("SELECT markdown FROM posts WHERE id = ?").bind(id).first<{ markdown: string }>();
	return renderMarkdown(row?.markdown ?? "");
}

type CommentRow = { id: string; user_id: string; name: string; body: string; author_note: string | null; created_at: string };
const toComment = (c: CommentRow): Comment => ({ id: c.id, name: c.name, body: c.body, authorNote: c.author_note, createdAt: c.created_at });

/** How many comments come at a time. */
export const COMMENTS_PAGE = 20;

/**
 * What readers made of a piece: its counts (one row, post_totals) and the
 * first page of comments. The same for everyone (stored 5 minutes). Null
 * when it's gone.
 */
export async function loadPostLive(id: string): Promise<PostLive | null> {
	const [totals, first] = await Promise.all([
		db().prepare(`SELECT t.comments, ${QUALITY_TOTALS} FROM post_totals t WHERE t.post_id = ?`).bind(id).first<{ comments: number } & Record<Quality, number>>(),
		loadComments(id),
	]);
	if (!totals) return null;
	return { qualities: totalsToCounts(totals), comments: totals.comments, ...first };
}

// Comments go oldest first; a page ends at its last comment (time, then id),
// so one written meanwhile can't push another onto two pages.
const commentCursor = (c: CommentRow) => `${c.created_at}~${c.id}`;

/** A page of a piece's comments, after `after` (the previous page's `next`). */
export async function loadComments(id: string, after?: string): Promise<CommentPage> {
	const [at, commentId] = after?.split("~") ?? [];
	const from = at && commentId ? "AND (c.created_at > ?2 OR (c.created_at = ?2 AND c.id > ?3))" : "";
	const { results } = await db()
		.prepare(
			`SELECT c.id, c.user_id, u.name, c.body, c.author_note, c.created_at
			 FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ?1 ${from}
			 ORDER BY c.created_at, c.id LIMIT ${COMMENTS_PAGE + 1}`,
		)
		.bind(...(from ? [id, at, commentId] : [id]))
		.all<CommentRow>();
	const page = results.slice(0, COMMENTS_PAGE);
	return { page: page.map(toComment), next: results.length > COMMENTS_PAGE ? commentCursor(page[page.length - 1]) : null };
}

/** What's yours on a piece: your reactions, your comment, whether you wrote it. Never kept. Null when signed out. */
export async function loadPostYou(id: string, user: User | null): Promise<PostYou | null> {
	if (!user) return null;
	const [mine, comment, author] = await Promise.all([
		db().prepare("SELECT quality FROM reactions WHERE post_id = ? AND user_id = ?").bind(id, user.id).all<{ quality: Quality }>(),
		db()
			.prepare(
				`SELECT c.id, c.user_id, u.name, c.body, c.author_note, c.created_at
				 FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? AND c.user_id = ?`,
			)
			.bind(id, user.id)
			.first<CommentRow>(),
		db().prepare("SELECT 1 FROM posts p JOIN authors a ON a.id = p.author_id WHERE p.id = ? AND a.user_id = ?").bind(id, user.id).first(),
	]);
	return { name: user.name, isAuthor: Boolean(author), mine: mine.results.map((r) => r.quality), myComment: comment ? toComment(comment) : null };
}
