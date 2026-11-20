import { createFileRoute } from "@tanstack/react-router";
import { sitemapPart } from "../server/discovery.server";

// /sitemap/site.xml and /sitemap/2026-11.xml: the sitemap's parts (discovery.server.ts).
export const Route = createFileRoute("/sitemap/{$part}.xml")({
	server: {
		handlers: {
			GET: async ({ params }) => (await sitemapPart(params.part)) ?? new Response("Not found", { status: 404 }),
		},
	},
});
