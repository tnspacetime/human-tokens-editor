import { createFileRoute, notFound } from "@tanstack/react-router";
import { ArchivePage } from "../components/Archive";
import { getArchive } from "../server/site.functions";

// One year of the archive, at its own address (/archive/2025).
export const Route = createFileRoute("/archive/$year")({
	loader: ({ params }) => {
		const year = Number(params.year);
		if (!/^\d{4}$/.test(params.year)) throw notFound();
		return getArchive({ data: { year } });
	},
	head: ({ params }) => ({
		meta: [
			{ title: `${params.year} · Every piece · Human Tokens` },
			{ name: "description", content: `Every piece published on Human Tokens in ${params.year}, by month.` },
		],
	}),
	component: () => <ArchivePage archive={Route.useLoaderData()} />,
});
