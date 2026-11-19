import { createFileRoute } from "@tanstack/react-router";
import { feed } from "../server/discovery.server";

// /@<handle>/rss.xml: one author's newest posts, whole (discovery.server.ts).
export const Route = createFileRoute("/@{$handle}_/rss.xml")({
	server: {
		handlers: {
			GET: async ({ params }) =>
				(await feed(params.handle)) ?? new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } }),
		},
	},
});
