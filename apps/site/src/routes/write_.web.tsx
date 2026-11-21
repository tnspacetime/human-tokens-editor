import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { share } from "../lib/share";

// Where the island's Write leads: Fold MD in the browser
// (components/writer). The page is the same for everyone; the writer, its
// editor and its renderer load only here, in the browser, since the draft
// lives in the browser too. Fold MD for the Mac has its own page, /fold-md.
export const Route = createFileRoute("/write_/web")({
	head: () =>
		share({
			title: "Write in your browser",
			description: "Write a post in your browser, see it set as it will read, and publish it here.",
			path: "/write/web",
		}),
	component: WritePage,
});

const Writer = lazy(() => import("../components/writer/Writer"));

function WritePage() {
	const [here, setHere] = useState(false);
	useEffect(() => setHere(true), []);
	return (
		<main className="writer-page">
			<h1 className="visually-hidden">Write in your browser</h1>
			{here && (
				<Suspense fallback={null}>
					<Writer />
				</Suspense>
			)}
		</main>
	);
}
