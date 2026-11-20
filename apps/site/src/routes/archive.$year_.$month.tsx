import { createFileRoute, notFound } from "@tanstack/react-router";
import { ArchivePage } from "../components/Archive";
import { share } from "../lib/share";
import { getArchive } from "../server/site.functions";

const monthName = (month: number) => new Date(Date.UTC(2000, month - 1, 1)).toLocaleDateString("en", { month: "long", timeZone: "UTC" });

// One month of the archive, at its own address (/archive/2026/11).
export const Route = createFileRoute("/archive/$year_/$month")({
	loader: ({ params }) => {
		if (!/^\d{4}$/.test(params.year) || !/^(0[1-9]|1[0-2])$/.test(params.month)) throw notFound();
		return getArchive({ data: { year: Number(params.year), month: Number(params.month) } });
	},
	head: ({ params }) => {
		const when = /^(0[1-9]|1[0-2])$/.test(params.month) ? `${monthName(Number(params.month))} ${params.year}` : params.year;
		return share({
			title: `${when} · Every post`,
			description: `Every post published on Human Tokens in ${when}.`,
			path: `/archive/${params.year}/${params.month}`,
		});
	},
	component: () => <ArchivePage archive={Route.useLoaderData()} />,
});
