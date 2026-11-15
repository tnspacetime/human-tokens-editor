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

/** A piece, rendered, with its comments and what the viewer chose. */
export async function loadPost(id: string, user: User | null): Promise<PostPage | null> {
	const row = await db()
		.prepare(`SELECT ${POST_COLUMNS}, p.markdown, a.user_id AS author_user_id FROM posts p JOIN authors a ON a.id = p.author_id WHERE p.id = ?`)
		.bind(id)
		.first<PostRow & { markdown: string; author_user_id: string | null }>();
	if (!row) return null;

	const [counts, mine, comments] = await Promise.all([
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
	]);

	return {
		...toFeedItem(row, counts.get(id) ?? {}),
		html: renderer.render(row.markdown),
		allowDebate: row.allow_debate === 1,
		mine: mine.results.map((r) => r.quality),
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
