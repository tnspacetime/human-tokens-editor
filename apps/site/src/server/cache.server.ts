import { cache } from "cloudflare:workers";
import { getResponseHeader, setResponseHeader } from "@tanstack/react-start/server";
import { cacheHeaders, type Keep, TAGS } from "../lib/keep";
import { batches, db, MAX_BOUND, marks } from "./rows.server";

export { cacheHeaders, type Keep, TAGS, UNTIL_CLEARED } from "../lib/keep";

// How Cloudflare stores what the site sends, and how stored copies are
// cleared (docs/release-plan.md, item 0).
//
// Workers Cache ("cache" in wrangler.jsonc) sits in front of the Worker: a
// stored copy is sent without running any code. It ignores cookies, so only
// what's the same for everyone may be stored; anything personal is "never"
// (and src/server.ts makes "never" the default for anything that doesn't say).
//
// Clearing is rationed (about 5 requests a minute for the whole account, up
// to 100 labels each), so a change never clears anything itself: it adds its
// labels to a queue (pending_purges), and once a minute sendClearings() sends
// everything due. A thousand changes in a minute clear each page once.
//
// A clearing can wait: a new post is listed only once its fix window ends,
// so publishing queues its lists' clearing for then (`notBefore`).

/**
 * Inside a server function or a page's loader: how this response may be
 * stored. Several in one response (a page and the data it loads) combine:
 * the shortest time, every label, and "never" if any says never.
 */
export function keepResponse(keep: Keep) {
	const never = String(getResponseHeader("Cache-Control") ?? "").includes("no-store");
	if (keep === "never" || never) {
		setAll(cacheHeaders("never"));
		setResponseHeader("Cloudflare-CDN-Cache-Control", "no-store");
		return;
	}
	const said = getResponseHeader("Cloudflare-CDN-Cache-Control");
	if (!said) return setAll(cacheHeaders(keep));
	const before = Number(/max-age=(\d+)/.exec(String(said))?.[1] ?? keep.seconds);
	const tags = [...String(getResponseHeader("Cache-Tag") ?? "").split(","), ...keep.tags].filter(Boolean);
	setAll(cacheHeaders({ seconds: Math.min(before, keep.seconds), tags: [...new Set(tags)] }));
}

function setAll(headers: Record<string, string>) {
	for (const [name, value] of Object.entries(headers)) setResponseHeader(name, value);
}

/** Has this response said how it may be stored? (src/server.ts: if not, it's "never".) */
export function saysHowToKeep(headers: Headers) {
	return headers.has("Cache-Control") || headers.has("Cloudflare-CDN-Cache-Control") || headers.has("CDN-Cache-Control");
}

/**
 * After a change is saved: the stored copies under these labels are out of
 * date. They're queued, and cleared within a minute (sendClearings), or
 * within a minute after `notBefore` (an ISO time) when given.
 */
export async function forget(tags: string[], notBefore?: string) {
	const unique = [...new Set(tags)];
	if (unique.length === 0) return;
	const now = new Date().toISOString();
	await db().batch(
		unique.map((tag) => db().prepare("INSERT OR IGNORE INTO pending_purges (tag, not_before, created_at) VALUES (?, ?, ?)").bind(tag, notBefore ?? now, now)),
	);
}

/** A clearing request carries at most 100 labels. */
const PER_REQUEST = 100;
/** Cloudflare allows about 5 clearing requests a minute for the account; leave one for the other site. */
const REQUESTS_PER_RUN = 4;

/** `vite dev` has a `cache` with no purge: nothing is stored there, so there's nothing to clear. */
const clearing = () => typeof cache?.purge === "function";

/**
 * Every minute (src/server.ts): send the labels that are due, longest
 * waiting first, in as few requests as possible. A refusal (the account's
 * limit) ends the run; what's left waits for the next. One small query when
 * nothing is due.
 */
export async function sendClearings(now = new Date().toISOString()) {
	const { results } = await db()
		.prepare("SELECT tag FROM pending_purges WHERE not_before <= ?1 GROUP BY tag ORDER BY MIN(not_before) LIMIT ?2")
		.bind(now, PER_REQUEST * REQUESTS_PER_RUN)
		.all<{ tag: string }>();
	let sent = 0;
	for (let i = 0; i < results.length; i += PER_REQUEST) {
		const tags = results.slice(i, i + PER_REQUEST).map((r) => r.tag);
		let ok = false;
		try {
			ok = clearing() ? (await cache.purge({ tags })).success : true;
		} catch (error) {
			console.error(JSON.stringify({ message: "Clearing failed", error: String(error) }));
		}
		if (!ok) break;
		// Sent: every time it was due by now (a later one still waits).
		await db().batch(
			batches(tags, MAX_BOUND - 1).map((some) =>
				db().prepare(`DELETE FROM pending_purges WHERE tag IN (${marks(some)}) AND not_before <= ?`).bind(...some, now),
			),
		);
		sent += tags.length;
	}
	return sent;
}

/**
 * Every stored page that shows post `id`, to clear when it's deleted or its
 * title changes: its own page and its Live data, the post it responds to
 * (which lists it), and the posts that respond to it (which name it). Read
 * before a delete, while those links are still there.
 */
export async function pagesShowing(id: string): Promise<string[]> {
	const { results } = await db()
		.prepare("SELECT responds_to AS id FROM posts WHERE id = ?1 AND responds_to IS NOT NULL UNION SELECT id FROM posts WHERE responds_to = ?1")
		.bind(id)
		.all<{ id: string }>();
	return [TAGS.post(id), TAGS.postLive(id), ...results.map((r) => TAGS.post(r.id))];
}
