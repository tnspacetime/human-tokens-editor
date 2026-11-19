import { createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";
import { PostTile } from "../components/PostCard";
import { tileSizes } from "../components/tileSizes";
import { useFeedMotion } from "../components/useFeedMotion";
import { share } from "../lib/share";
import type { AuthorPage } from "../lib/types";
import { getAuthorPage } from "../server/site.functions";

// /@<handle>: an author's page. Who they are, then every piece of theirs
// as the homepage draws them, newest leading across the full width; the
// island under the site's carries the numbers.
export const Route = createFileRoute("/@{$handle}")({
	loader: ({ params }) => getAuthorPage({ data: { handle: params.handle } }),
	head: ({ loaderData }) => {
		if (!loaderData) return {};
		const { author } = loaderData;
		const page = share({
			title: author.name,
			description: `Every post by ${author.name} on Human Tokens, written by a person.`,
			path: `/@${author.handle}`,
			type: "profile",
		});
		// This author's own feed, beside the site's.
		const rss = { rel: "alternate", type: "application/rss+xml", title: `${author.name} · Human Tokens`, href: `/@${author.handle}/rss.xml` };
		return { ...page, links: [...page.links, rss] };
	},
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
					{page.isYou ? "Nothing published yet. Your posts will be here once you publish from Fold MD." : "Nothing published yet."}
				</p>
			) : (
				<ul ref={list} className="tiles" aria-label="Posts">
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
