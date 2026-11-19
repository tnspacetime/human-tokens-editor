import { createFileRoute } from "@tanstack/react-router";
import { feed } from "../server/discovery.server";

// /rss.xml: the newest posts, whole, for feed readers (discovery.server.ts).
export const Route = createFileRoute("/rss.xml")({
	server: {
		handlers: {
			GET: async () => (await feed()) as Response,
		},
	},
});
