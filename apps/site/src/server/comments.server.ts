import type { Reader } from "./reader.server";
import { db } from "./rows.server";

/** One comment per reader per piece: writing again replaces it. */
export async function saveComment(postId: string, body: string, reader: Reader) {
	const now = new Date().toISOString();
	await db()
		.prepare(
			`INSERT INTO comments (id, post_id, reader_id, reader_name, body, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (post_id, reader_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
		)
		.bind(crypto.randomUUID(), postId, reader.id, reader.name, body, now, now)
		.run();
}

export async function deleteComment(postId: string, reader: Reader) {
	await db().prepare("DELETE FROM comments WHERE post_id = ? AND reader_id = ?").bind(postId, reader.id).run();
}

/**
 * The author's one short note under a comment. PROTOTYPE: the caller only
 * checks "View as author"; with sign-in this must check that the signed-in
 * person wrote the piece the comment is on.
 */
export async function saveAuthorNote(commentId: string, note: string | null) {
	await db().prepare("UPDATE comments SET author_note = ? WHERE id = ?").bind(note, commentId).run();
}
