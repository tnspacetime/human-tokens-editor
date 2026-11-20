import { createFileRoute } from "@tanstack/react-router";
import { sitemapIndex } from "../server/discovery.server";

// /sitemap.xml: the list of the sitemap's parts, for search engines (discovery.server.ts).
export const Route = createFileRoute("/sitemap.xml")({
	server: {
		handlers: {
			GET: () => sitemapIndex(),
		},
	},
});
