// How long Cloudflare may keep a response, as headers, and under which
// labels. Here (server/cache.server.ts has the rest: setting them, and
// clearing) so a page's own redirect can carry them too.

/** The labels pages are kept under. One place, so a change and a page always agree. */
export const TAGS = {
	post: (id: string) => `post-${id}`,
	postLive: (id: string) => `live-${id}`,
	/** The homepage, its scroll batches, the site's RSS feed and the sitemap. */
	home: "home",
	/** Every page of the archive. */
	archive: "archive",
	/** An author's page and feed. */
	author: (handle: string) => `author-${handle.toLowerCase()}`,
} as const;

export type Keep = { seconds: number; tags: string[] } | "never";

/** Kept until a change clears it. */
export const UNTIL_CLEARED = 365 * 24 * 3600;

/** The headers for a response kept `keep`: the browser always asks again; Cloudflare keeps it. */
export function cacheHeaders(keep: Keep): Record<string, string> {
	if (keep === "never") return { "Cache-Control": "private, no-store" };
	return {
		"Cache-Control": "public, max-age=0",
		"Cloudflare-CDN-Cache-Control": `public, max-age=${keep.seconds}`,
		"Cache-Tag": keep.tags.join(","),
	};
}

/** How long a post's page is kept while its author can still fix it: fixes show within this. */
export const FIXABLE_KEEP_SECONDS = 30;

/**
 * A post's page, and an old slug's redirect to it (a title fixed after the
 * link was shared): 30 seconds while it can be fixed (the slug can still
 * change, even back), then until it's cleared.
 */
export function keepPost(id: string, fixable: boolean): Keep {
	return { seconds: fixable ? FIXABLE_KEEP_SECONDS : UNTIL_CLEARED, tags: [TAGS.post(id)] };
}

/**
 * How long a post's Live data (reaction counts, comments) is stored: others'
 * reactions and comments show within this. Your own show at once, and your
 * browser remembers them this long (lib/post-view.ts), so a reload can't hide them.
 */
export const LIVE_KEEP_SECONDS = 5 * 60;

/**
 * The lists (homepage, archive, author pages) change in two ways:
 * - their posts: a new one appears when its fix window ends, a deleted one
 *   goes. Each clears the list (within a minute; publishing queues it for
 *   when the window ends: server/publish.server.ts).
 * - others' reactions and comments: too frequent to clear for, so the
 *   counts are refreshed by expiry, below.
 *
 * The homepage (with its scroll batches and the RSS feed): 5 minutes, its
 * tiles' counts at most that old. A delete clears it, as the ranking on it
 * can name any post reacted to in the last month.
 */
export const HOME_KEEP = { seconds: 5 * 60, tags: [TAGS.home] } satisfies Keep;

/** The archive (every page of it, with its All time board, and the sitemap): 15 minutes, its counts at most that old. */
export const ARCHIVE_KEEP = { seconds: 15 * 60, tags: [TAGS.archive] } satisfies Keep;

/** An author's page (with its scroll batches and their RSS feed): 15 minutes, its counts at most that old. */
export const keepAuthor = (handle: string) => ({ seconds: 15 * 60, tags: [TAGS.author(handle)] }) satisfies Keep;
