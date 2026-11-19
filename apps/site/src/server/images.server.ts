import { imageSources } from "@human-tokens/renderer";
import { env } from "cloudflare:workers";
import { SITE } from "../lib/share";
import { PublishError, type Publisher } from "./publish.server";
import { db, marks } from "./rows.server";

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
	/**
	 * Uploaded but not in a post yet, per hour: three posts' worth, so
	 * swapping pictures before publishing doesn't lock you out, while
	 * nobody can fill the store without publishing.
	 */
	waitingBytes: 30_000_000,
} as const;

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;
const HASH = /^[0-9a-f]{64}$/;
const bucket = () => env.IMAGES;
/** /img/<hash>, or the same on this site's own address. */
const PICTURE_LINK = new RegExp(`^(?:${SITE.url.replace(/[.]/g, "\\.")})?/img/([0-9a-f]{64})$`);

/**
 * The pictures a piece shows, each once: real pictures only, as the page
 * reads them. A /img/... address written inside code, or in a plain link,
 * isn't one.
 */
export function picturesIn(markdown: string): string[] {
	const hashes = imageSources(markdown).flatMap((src) => PICTURE_LINK.exec(src)?.[1] ?? []);
	return [...new Set(hashes)];
}

/** Whether a piece shows any picture that isn't one of the site's own. */
export function outsidePictures(markdown: string): boolean {
	return imageSources(markdown).some((src) => !PICTURE_LINK.test(src));
}

/** Of these pictures, the ones the site doesn't have yet. */
export async function missingPictures(publisher: Publisher, input: Record<string, unknown>): Promise<string[]> {
	if (!publisher.author) throw new PublishError(409, "Choose your author name before your first publish.");
	const hashes = input.hashes;
	if (!Array.isArray(hashes) || hashes.length > PICTURES.perPiece || !hashes.every((h) => typeof h === "string" && HASH.test(h))) {
		throw new PublishError(400, `A post can have at most ${PICTURES.perPiece} pictures.`);
	}
	if (hashes.length === 0) return [];
	const { results } = await db()
		.prepare(`SELECT hash FROM images WHERE hash IN (${marks(hashes)})`)
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
	const bytes = await readUpTo(request, PICTURES.maxBytes, tooBig);
	const buffer = bytes.buffer as ArrayBuffer;
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
			`SELECT COALESCE(SUM(bytes), 0) AS bytes FROM images
			 WHERE placed = 0 AND uploaded_by = ? AND created_at > ?`,
		)
		.bind(publisher.id, hourAgo)
		.first<{ bytes: number }>();
	if ((waiting?.bytes ?? 0) + bytes.byteLength > PICTURES.waitingBytes) {
		throw new PublishError(429, "That's a lot of pictures waiting for a post. Publish it, then try again in an hour.");
	}
	// The row first, then the file: if storing the file fails, the row goes
	// again; if anything stops in between, the row is unplaced and the
	// sweep removes it (and the file) a day later. A file is never left
	// without a row that would clean it up.
	const { meta } = await db()
		.prepare("INSERT OR IGNORE INTO images (hash, type, bytes, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?)")
		.bind(hash, type, bytes.byteLength, publisher.id, new Date().toISOString())
		.run();
	if (!meta.changes) return; // arrived meanwhile, from another upload
	try {
		await bucket().put(hash, bytes, { httpMetadata: { contentType: type } });
	} catch (error) {
		await db().prepare("DELETE FROM images WHERE hash = ? AND placed = 0").bind(hash).run();
		throw error;
	}
}

/**
 * The request's body, read no further than `limit` bytes: a sender that
 * doesn't say how big it is can't make the server hold more than that.
 */
async function readUpTo(request: Request, limit: number, tooBig: string): Promise<Uint8Array> {
	if (!request.body) return new Uint8Array();
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > limit) {
			await reader.cancel();
			throw new PublishError(413, tooBig);
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.byteLength;
	}
	return bytes;
}

/** Before a piece goes up: its pictures are all here, and within the limits. */
export async function checkPictures(hashes: string[]): Promise<void> {
	if (hashes.length > PICTURES.perPiece) {
		throw new PublishError(413, `A post can have at most ${PICTURES.perPiece} pictures. This one has ${hashes.length}.`);
	}
	if (hashes.length === 0) return;
	const { results } = await db()
		.prepare(`SELECT hash, bytes FROM images WHERE hash IN (${marks(hashes)})`)
		.bind(...hashes)
		.all<{ hash: string; bytes: number }>();
	if (results.length < hashes.length) throw new PublishError(400, "A picture didn't arrive. Publish again.");
	const total = results.reduce((sum, r) => sum + r.bytes, 0);
	if (total > PICTURES.perPieceBytes) {
		throw new PublishError(413, `The pictures in a post can come to at most ${mb(PICTURES.perPieceBytes)}. These come to ${mb(total)}.`);
	}
}

/** The pictures a piece uses now. */
export async function picturesOf(postId: string): Promise<string[]> {
	const { results } = await db().prepare("SELECT hash FROM post_images WHERE post_id = ?").bind(postId).all<{ hash: string }>();
	return results.map((r) => r.hash);
}

const UNUSED = "NOT EXISTS (SELECT 1 FROM post_images WHERE hash = images.hash)";

/**
 * The statements that record which pictures a piece uses, for the same
 * batch (one transaction) as the piece itself. Each runs only if `written`
 * holds, a condition true only when that batch's write of the piece went
 * through. Afterwards, sweep the ones it no longer uses.
 */
export function pictureStatements(postId: string, hashes: string[], written: { sql: string; values: unknown[] }) {
	return [
		db().prepare(`DELETE FROM post_images WHERE post_id = ? AND ${written.sql}`).bind(postId, ...written.values),
		...hashes.map((hash) =>
			db().prepare(`INSERT INTO post_images (post_id, hash) SELECT ?, ? WHERE ${written.sql}`).bind(postId, hash, ...written.values),
		),
		...(hashes.length
			? [db().prepare(`UPDATE images SET placed = 1 WHERE hash IN (${marks(hashes)}) AND ${written.sql}`).bind(...hashes, ...written.values)]
			: []),
	];
}

/**
 * Removes pictures no piece uses: `released` ones (their piece just let go
 * of them) right away, and any upload that was never published after a day.
 * Only pictures not in a piece are looked at (`placed = 0`), so this reads
 * a handful of rows however many pictures the site has. Returns how many
 * went (at most 50 a call).
 */
export async function sweepPictures(released: string[] = []): Promise<number> {
	if (released.length) {
		// Not in a piece any more. If removing them below fails, the next
		// sweep finds them again, a day on.
		await db()
			.prepare(`UPDATE images SET placed = 0 WHERE hash IN (${marks(released)}) AND ${UNUSED}`)
			.bind(...released)
			.run();
	}
	const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
	// The rows go first, and only the pictures whose rows went are removed
	// from R2: a piece that took one up a moment ago keeps it.
	const { results } = await db()
		.prepare(
			`DELETE FROM images WHERE hash IN (
			   SELECT hash FROM images
			   WHERE placed = 0 AND (created_at < ?${released.length ? ` OR hash IN (${marks(released)})` : ""}) AND ${UNUSED}
			   LIMIT 50
			 ) AND ${UNUSED}
			 RETURNING hash`,
		)
		.bind(dayAgo, ...released)
		.all<{ hash: string }>();
	if (results.length) await bucket().delete(results.map((r) => r.hash));
	return results.length;
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
