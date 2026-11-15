import type { User } from "./auth.server";
import { db } from "./rows.server";

/** One comment per person per piece: writing again replaces it. */
export async function saveComment(postId: string, body: string, user: User) {
	const now = new Date().toISOString();
	await db()
		.prepare(
			`INSERT INTO comments (id, post_id, user_id, body, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT (post_id, user_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
		)
		.bind(crypto.randomUUID(), postId, user.id, body, now, now)
		.run();
}

export async function deleteComment(postId: string, user: User) {
	await db().prepare("DELETE FROM comments WHERE post_id = ? AND user_id = ?").bind(postId, user.id).run();
}

/**
 * The author's one short note under a comment, only on a piece this user
 * wrote. False when it isn't theirs (or the comment is gone).
 */
export async function saveAuthorNote(commentId: string, note: string | null, user: User) {
	const result = await db()
		.prepare(
			`UPDATE comments SET author_note = ? WHERE id = ? AND post_id IN
			 (SELECT p.id FROM posts p JOIN authors a ON a.id = p.author_id WHERE a.user_id = ?)`,
		)
		.bind(note, commentId, user.id)
		.run();
	return result.meta.changes > 0;
}
