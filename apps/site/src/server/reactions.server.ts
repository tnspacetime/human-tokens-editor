import type { Quality } from "../lib/qualities";
import type { User } from "./auth.server";
import { forgetBoard } from "./board.server";
import { db } from "./rows.server";

/** Choose a quality for a piece, or un-choose it if this person already had. */
export async function toggleQuality(postId: string, quality: Quality, user: User) {
	const removed = await db()
		.prepare("DELETE FROM reactions WHERE post_id = ? AND user_id = ? AND quality = ?")
		.bind(postId, user.id, quality)
		.run();
	if (removed.meta.changes === 0) {
		await db()
			.prepare("INSERT INTO reactions (post_id, user_id, quality, created_at) VALUES (?, ?, ?, ?)")
			.bind(postId, user.id, quality, new Date().toISOString())
			.run();
	}
	forgetBoard();
}
