import { env } from "cloudflare:workers";
import { PublishError, type Publisher } from "./publish.server";
import { db } from "./rows.server";

// Pictures in pieces (migrations/0010_pictures.sql). Fold MD gets each one
// ready on the Mac (shrunk, and without the place it was taken), asks which
// the site doesn't have yet, uploads those, then publishes markdown that
// links each picture as /img/<hash>. The bytes live in R2 under their
// SHA-256, so a picture is stored once however often it's used, and a link
// can never point at different bytes later.

export const PICTURES = {
	/** One picture, as Fold MD sends it (already shrunk). */
	maxBytes: 5_000_000,
	/** Pictures in one piece. */
	perPiece: 20,
	/** All the pictures in one piece together. */
	perPieceBytes: 10_000_000,
} as const;

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;
const HASH = /^[0-9a-f]{64}$/;
const bucket = () => env.IMAGES;

/** The pictures a piece's markdown links, each once. */
export function picturesIn(markdown: string): string[] {
	return [...new Set([...markdown.matchAll(/\/img\/([0-9a-f]{64})\b/g)].map((m) => m[1]))];
}

/** Of these pictures, the ones the site doesn't have yet. */
export async function missingPictures(publisher: Publisher, input: Record<string, unknown>): Promise<string[]> {
	if (!publisher.author) throw new PublishError(409, "Choose your author name before your first publish.");
	const hashes = input.hashes;
	if (!Array.isArray(hashes) || hashes.length > PICTURES.perPiece || !hashes.every((h) => typeof h === "string" && HASH.test(h))) {
		throw new PublishError(400, `A piece can have at most ${PICTURES.perPiece} pictures.`);
	}
	if (hashes.length === 0) return [];
	const { results } = await db()
		.prepare(`SELECT hash FROM images WHERE hash IN (${hashes.map(() => "?").join(", ")})`)
		.bind(...hashes)
		.all<{ hash: string }>();
	const have = new Set(results.map((r) => r.hash));
	return hashes.filter((h) => !have.has(h));
}

/** The kind of picture these bytes are, from their first bytes; null for anything else. */
function sniff(bytes: Uint8Array): string | null {
	const starts = (...values: number[]) => values.every((v, i) => bytes[i] === v);
	if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
	if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
	if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
	if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
	return null;
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** One picture's bytes, stored under `hash`, which must be their SHA-256. */
export async function uploadPicture(publisher: Publisher, hash: string, request: Request): Promise<void> {
	if (!publisher.author) throw new PublishError(409, "Choose your author name before your first publish.");
	if (!HASH.test(hash)) throw new PublishError(404, "Not found.");
	const declared = Number(request.headers.get("content-length") ?? 0);
	const tooBig = `A picture can be at most ${mb(PICTURES.maxBytes)}.`;
	if (declared > PICTURES.maxBytes) throw new PublishError(413, tooBig);
	const buffer = await request.arrayBuffer();
	if (buffer.byteLength > PICTURES.maxBytes) throw new PublishError(413, tooBig);
	const bytes = new Uint8Array(buffer);
	const type = sniff(bytes);
	if (!type) throw new PublishError(415, "Pictures go up as JPEG, PNG or GIF.");
	if (hex(await crypto.subtle.digest("SHA-256", buffer)) !== hash) {
		throw new PublishError(400, "A picture arrived damaged. Publish again.");
	}

	const known = await db().prepare("SELECT 1 FROM images WHERE hash = ?").bind(hash).first();
	if (known) return;
	// Pictures wait for their piece only so long, and only one piece's
	// worth at a time: nobody can fill the store without publishing.
	const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
	const waiting = await db()
		.prepare(
			`SELECT COALESCE(SUM(bytes), 0) AS bytes FROM images i
			 WHERE uploaded_by = ? AND created_at > ? AND NOT EXISTS (SELECT 1 FROM post_images WHERE hash = i.hash)`,
		)
		.bind(publisher.id, hourAgo)
		.first<{ bytes: number }>();
	if ((waiting?.bytes ?? 0) + bytes.byteLength > PICTURES.perPieceBytes) {
		throw new PublishError(429, "These pictures come to more than one piece can hold. Publish the piece, then try again in an hour.");
	}
	await bucket().put(hash, bytes, { httpMetadata: { contentType: type } });
	await db()
		.prepare("INSERT OR IGNORE INTO images (hash, type, bytes, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?)")
		.bind(hash, type, bytes.byteLength, publisher.id, new Date().toISOString())
		.run();
}

/** Before a piece goes up: its pictures are all here, and within the limits. */
export async function checkPictures(hashes: string[]): Promise<void> {
	if (hashes.length > PICTURES.perPiece) {
		throw new PublishError(413, `A piece can have at most ${PICTURES.perPiece} pictures. This one has ${hashes.length}.`);
	}
	if (hashes.length === 0) return;
	const { results } = await db()
		.prepare(`SELECT hash, bytes FROM images WHERE hash IN (${hashes.map(() => "?").join(", ")})`)
		.bind(...hashes)
		.all<{ hash: string; bytes: number }>();
	if (results.length < hashes.length) throw new PublishError(400, "A picture didn't arrive. Publish again.");
	const total = results.reduce((sum, r) => sum + r.bytes, 0);
	if (total > PICTURES.perPieceBytes) {
		throw new PublishError(413, `The pictures in a piece can come to at most ${mb(PICTURES.perPieceBytes)}. These come to ${mb(total)}.`);
	}
}

/** The pictures a piece uses now. */
export async function picturesOf(postId: string): Promise<string[]> {
	const { results } = await db().prepare("SELECT hash FROM post_images WHERE post_id = ?").bind(postId).all<{ hash: string }>();
	return results.map((r) => r.hash);
}

/** Record which pictures a piece uses, then let go of the ones it no longer does. */
export async function attachPictures(postId: string, hashes: string[]): Promise<void> {
	const before = await picturesOf(postId);
	await db().batch([
		db().prepare("DELETE FROM post_images WHERE post_id = ?").bind(postId),
		...hashes.map((hash) => db().prepare("INSERT INTO post_images (post_id, hash) VALUES (?, ?)").bind(postId, hash)),
	]);
	await sweepPictures(before.filter((h) => !hashes.includes(h)));
}

/**
 * Removes pictures no piece uses: `released` ones (their piece just let go
 * of them) right away, and any upload that was never published after a day.
 */
export async function sweepPictures(released: string[] = []): Promise<void> {
	const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
	const { results } = await db()
		.prepare(
			`SELECT hash FROM images i
			 WHERE NOT EXISTS (SELECT 1 FROM post_images WHERE hash = i.hash)
			   AND (created_at < ?${released.length ? ` OR hash IN (${released.map(() => "?").join(", ")})` : ""})
			 LIMIT 50`,
		)
		.bind(dayAgo, ...released)
		.all<{ hash: string }>();
	if (results.length === 0) return;
	const hashes = results.map((r) => r.hash);
	await bucket().delete(hashes);
	await db()
		.prepare(`DELETE FROM images WHERE hash IN (${hashes.map(() => "?").join(", ")}) AND NOT EXISTS (SELECT 1 FROM post_images WHERE hash = images.hash)`)
		.bind(...hashes)
		.run();
}

/** A stored picture, for /img/<hash>. */
export async function pictureResponse(hash: string): Promise<Response> {
	const missing = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
	if (!HASH.test(hash)) return missing();
	const object = await bucket().get(hash);
	if (!object) return missing();
	return new Response(object.body, {
		headers: {
			"content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
			"content-length": String(object.size),
			// The address is the content's hash, so it never changes.
			"cache-control": "public, max-age=31536000, immutable",
			etag: `"${hash}"`,
			"x-content-type-options": "nosniff",
			"content-security-policy": "default-src 'none'",
		},
	});
}
