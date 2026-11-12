import type { Quality } from "../lib/qualities";
import { forgetBoard } from "./board.server";
import type { Reader } from "./reader.server";
import { db } from "./rows.server";

/** Choose a quality for a piece, or un-choose it if this reader already had. */
export async function toggleQuality(postId: string, quality: Quality, reader: Reader) {
	const removed = await db()
		.prepare("DELETE FROM reactions WHERE post_id = ? AND reader_id = ? AND quality = ?")
		.bind(postId, reader.id, quality)
		.run();
	if (removed.meta.changes === 0) {
		await db()
			.prepare("INSERT INTO reactions (post_id, reader_id, quality, created_at) VALUES (?, ?, ?, ?)")
			.bind(postId, reader.id, quality, new Date().toISOString())
			.run();
	}
	forgetBoard();
}
