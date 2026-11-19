import { createFileRoute } from "@tanstack/react-router";
import { ArchivePage } from "../components/Archive";
import { share } from "../lib/share";
import { getArchive } from "../server/site.functions";

// The archive opens on the latest year.
export const Route = createFileRoute("/archive/")({
	loader: () => getArchive({ data: {} }),
	head: () => share({ title: "Every post", description: "Every post on Human Tokens, by year and month.", path: "/archive" }),
	component: () => <ArchivePage archive={Route.useLoaderData()} />,
});
