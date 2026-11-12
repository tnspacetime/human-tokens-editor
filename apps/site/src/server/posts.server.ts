import { createRenderer } from "@human-tokens/renderer";
import type { Quality } from "../lib/qualities";
import type { PostPage } from "../lib/types";
import type { Reader } from "./reader.server";
import { db, POST_COLUMNS, type PostRow, qualityCounts, toFeedItem } from "./rows.server";

// Images: only web links for now. Images next to the author's file get
// uploaded with the post later (R2), and resolve to their stored copy.
const renderer = createRenderer({
	resolveImage: (src) => (/^https:\/\//i.test(src) ? src : null),
	unresolvedImageLabel: "Image not uploaded yet",
});

/** A piece, rendered, with its comments and what this reader chose. */
export async function loadPost(id: string, reader: Reader): Promise<PostPage | null> {
	const row = await db()
		.prepare(`SELECT ${POST_COLUMNS}, p.markdown FROM posts p JOIN authors a ON a.id = p.author_id WHERE p.id = ?`)
		.bind(id)
		.first<PostRow & { markdown: string }>();
	if (!row) return null;

	const [counts, mine, comments] = await Promise.all([
		qualityCounts([id]),
		db()
			.prepare("SELECT quality FROM reactions WHERE post_id = ? AND reader_id = ?")
			.bind(id, reader.id)
			.all<{ quality: Quality }>(),
		db()
			.prepare(
				"SELECT id, reader_id, reader_name, body, author_note, created_at FROM comments WHERE post_id = ? ORDER BY created_at",
			)
			.bind(id)
			.all<{ id: string; reader_id: string; reader_name: string; body: string; author_note: string | null; created_at: string }>(),
	]);

	return {
		...toFeedItem(row, counts.get(id) ?? {}),
		html: renderer.render(row.markdown),
		allowDebate: row.allow_debate === 1,
		mine: mine.results.map((r) => r.quality),
		commentList: comments.results.map((c) => ({
			id: c.id,
			name: c.reader_name,
			body: c.body,
			authorNote: c.author_note,
			createdAt: c.created_at,
			mine: c.reader_id === reader.id,
		})),
		viewer: { name: reader.name, isAuthor: reader.asAuthor },
	};
}
