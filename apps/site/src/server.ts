import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { cleanUp } from "./server/cleanup.server";

// The site's Worker: pages and the API as Start serves them, plus the hourly
// cleanup Cloudflare runs on its own (wrangler.jsonc, "triggers").
const pages = createStartHandler(defaultStreamHandler);

/** The site's one address: www and plain http are sent here, for good. */
const HOST = "human-tokens.dev";

export default {
	fetch: (request) => {
		const url = new URL(request.url);
		if (url.hostname === `www.${HOST}` || (url.hostname === HOST && url.protocol === "http:")) {
			url.hostname = HOST;
			url.protocol = "https:";
			url.port = "";
			return Response.redirect(url.toString(), 301);
		}
		return pages(request);
	},
	scheduled: (_controller, _env, ctx) => {
		ctx.waitUntil(cleanUp());
	},
} satisfies ExportedHandler<Env>;
