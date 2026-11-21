import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { cacheHeaders, saysHowToKeep, sendClearings, UNTIL_CLEARED } from "./server/cache.server";
import { cleanUp } from "./server/cleanup.server";
import { workOutAllTimeIfDue, workOutRanking } from "./server/ranking.server";

// The site's Worker: pages and the API as Start serves them, plus what
// Cloudflare runs on its own (wrangler.jsonc, "triggers"): every hour, the
// boards (the homepage's; the archive's once a day) and the cleanup; every
// minute, the queued clearings of stored pages.
const pages = createStartHandler(defaultStreamHandler);

/** The hourly schedule in wrangler.jsonc ("triggers"). */
const HOURLY = "0 * * * *";

/** The site's one address: www and plain http are sent here, for good. */
const HOST = "human-tokens.dev";

/**
 * Workers Cache keeps any response that doesn't say otherwise for 2 hours.
 * Here, a response that doesn't say how it may be kept is never kept: a
 * page or an answer that forgets is fetched fresh, never shown to the wrong
 * person (src/server/cache.server.ts says how the rest are kept).
 */
function neverKeptUnlessSaid(response: Response): Response {
	if (saysHowToKeep(response.headers)) return response;
	try {
		response.headers.set("Cache-Control", "private, no-store");
		return response;
	} catch {
		// Some responses (redirects) have headers that can't change: copy them.
		const copy = new Response(response.body, response);
		copy.headers.set("Cache-Control", "private, no-store");
		return copy;
	}
}

/**
 * Pages with nothing on them that changes between deploys, the same for
 * everyone: kept until the next deploy empties the stored copies. They load
 * no data of their own to say so (the root's sign-in options say nothing), so
 * it's said here, by address.
 */
const FIXED_PAGES = new Set(["/rules", "/privacy", "/write", "/write/web"]);

function keptIfFixed(request: Request, url: URL, response: Response): Response {
	if (request.method !== "GET" || response.status !== 200 || !FIXED_PAGES.has(url.pathname) || url.search) return response;
	if (saysHowToKeep(response.headers)) return response;
	for (const [name, value] of Object.entries(cacheHeaders({ seconds: UNTIL_CLEARED, tags: ["fixed"] }))) response.headers.set(name, value);
	return response;
}

export default {
	fetch: async (request) => {
		const url = new URL(request.url);
		if (url.hostname === `www.${HOST}` || (url.hostname === HOST && url.protocol === "http:")) {
			url.hostname = HOST;
			url.protocol = "https:";
			url.port = "";
			return neverKeptUnlessSaid(Response.redirect(url.toString(), 301));
		}
		return neverKeptUnlessSaid(keptIfFixed(request, url, await pages(request)));
	},
	scheduled: (controller, _env, ctx) => {
		// The hourly schedule works out the ranking and cleans up; any other
		// sends the queued clearings (so a schedule Cloudflare hasn't updated
		// yet still does the safe job). The homepage shows the new ranking
		// when it's next rebuilt, within 5 minutes (lib/keep.ts, HOME_KEEP).
		ctx.waitUntil(controller.cron === HOURLY ? Promise.all([workOutRanking(), workOutAllTimeIfDue(), cleanUp()]) : sendClearings());
	},
} satisfies ExportedHandler<Env>;
