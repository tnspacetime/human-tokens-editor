import { createFileRoute } from "@tanstack/react-router";
import { ArchivePage } from "../components/Archive";
import { getArchive } from "../server/site.functions";

// The archive opens on the latest year.
export const Route = createFileRoute("/archive/")({
	loader: () => getArchive({ data: {} }),
	head: () => ({
		meta: [
			{ title: "Every piece · Human Tokens" },
			{ name: "description", content: "Every piece on Human Tokens, by year and month." },
		],
	}),
	component: () => <ArchivePage archive={Route.useLoaderData()} />,
});
