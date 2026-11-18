import { createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";
import { PostTile } from "../components/PostCard";
import { tileSizes } from "../components/tileSizes";
import { useFeedMotion } from "../components/useFeedMotion";
import type { AuthorPage } from "../lib/types";
import { getAuthorPage } from "../server/site.functions";

// /@<handle>: an author's page. Who they are, then every piece of theirs
// as the homepage draws them, newest leading across the full width; the
// island under the site's carries the numbers.
export const Route = createFileRoute("/@{$handle}")({
	loader: ({ params }) => getAuthorPage({ data: { handle: params.handle } }),
	head: ({ loaderData }) => ({
		meta: loaderData
			? [
					{ title: `${loaderData.author.name} · Human Tokens` },
					{ name: "description", content: `Every piece by ${loaderData.author.name} on Human Tokens, written by a person.` },
				]
			: [],
	}),
	component: AuthorRoute,
});

const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });

function AuthorRoute() {
	const page = Route.useLoaderData();
	const list = useRef<HTMLUListElement>(null);
	useFeedMotion(list, page.pieces.length);
	const sizes = tileSizes(page.pieces.length, true);

	// What readers made of the writing rides in the island (AuthorIsland).
	return (
		<main className="feed author-page">
			<header className="author-head">
				<Portrait author={page.author} />
				<div>
					<h1 className="author-name">{page.author.name}</h1>
					<p className="author-handle">
						@{page.author.handle}
						{page.since && (
							<>
								<span aria-hidden="true"> · </span>
								since {monthYear(page.since)}
							</>
						)}
					</p>
				</div>
			</header>

			{page.pieces.length === 0 ? (
				<p className="author-empty">
					{page.isYou ? "Nothing published yet. Your pieces will be here once you publish from Fold MD." : "Nothing published yet."}
				</p>
			) : (
				<ul ref={list} className="tiles" aria-label="Pieces">
					{page.pieces.map((post, i) => (
						<li key={post.id} className={`tiles-item tiles-${sizes[i]}`}>
							<PostTile post={post} size={sizes[i]} eyebrow={post.parts ? `A series in ${post.parts} parts` : null} />
						</li>
					))}
				</ul>
			)}
		</main>
	);
}

/** Their picture from Google or GitHub, or their initial. */
function Portrait({ author }: { author: AuthorPage["author"] }) {
	return (
		<div className="author-portrait" aria-hidden="true">
			{author.image ? <img src={author.image} alt="" referrerPolicy="no-referrer" /> : <span>{[...author.name.trim()][0]?.toUpperCase()}</span>}
		</div>
	);
}
