import { createFileRoute } from "@tanstack/react-router";
import { sitemap } from "../server/discovery.server";

// /sitemap.xml: every page worth finding, for search engines (discovery.server.ts).
export const Route = createFileRoute("/sitemap.xml")({
	server: {
		handlers: {
			GET: () => sitemap(),
		},
	},
});
