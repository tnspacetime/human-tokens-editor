import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { cleanUp } from "./server/cleanup.server";

// The site's Worker: pages and the API as Start serves them, plus the hourly
// cleanup Cloudflare runs on its own (wrangler.jsonc, "triggers").
const pages = createStartHandler(defaultStreamHandler);

export default {
	fetch: (request) => pages(request),
	scheduled: (_controller, _env, ctx) => {
		ctx.waitUntil(cleanUp());
	},
} satisfies ExportedHandler<Env>;
