import { createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";
import { PostTile, Signals } from "../components/PostCard";
import { tileSizes } from "../components/tileSizes";
import { useFeedMotion } from "../components/useFeedMotion";
import { describeQualities } from "../lib/qualities";
import type { AuthorPage } from "../lib/types";
import { getAuthorPage } from "../server/site.functions";

// /@<handle>: an author's page. Who they are and what readers made of their
// writing, then every piece of theirs as the homepage draws them, newest
// leading across the full width.
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

/** 8,412 · 12.3k · 1.2M */
function compact(n: number) {
	if (n < 10_000) return n.toLocaleString("en");
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace(/\.0$/, "")}k`;
	return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function AuthorRoute() {
	const page = Route.useLoaderData();
	const list = useRef<HTMLUListElement>(null);
	useFeedMotion(list, page.pieces.length);
	const sizes = tileSizes(page.pieces.length, true);
	const said = describeQualities(page.qualities);

	return (
		<main className="feed author-page">
			<header className="author-hero">
				<Portrait author={page.author} />
				<h1 className="author-name">{page.author.name}</h1>
				<p className="author-handle">
					@{page.author.handle}
					{page.since && (
						<>
							<span aria-hidden="true"> · </span>
							writing here since {monthYear(page.since)}
						</>
					)}
				</p>
				{said && (
					<p className="author-said">
						Readers find this writing <em>{said}</em>.
					</p>
				)}
				{page.pieces.length > 0 && <Stats page={page} />}
				{said && <Signals post={{ qualities: page.qualities, comments: 0 }} />}
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

/** Their picture from Google or GitHub, or their initial on the brand's warm gradient. */
function Portrait({ author }: { author: AuthorPage["author"] }) {
	return (
		<div className="author-portrait" aria-hidden="true">
			{author.image ? <img src={author.image} alt="" referrerPolicy="no-referrer" /> : <span>{[...author.name.trim()][0]?.toUpperCase()}</span>}
		</div>
	);
}

function Stats({ page }: { page: AuthorPage }) {
	const stats = [
		{ label: page.pieces.length === 1 ? "piece" : "pieces", value: page.pieces.length },
		{ label: "words", value: page.words },
		{ label: page.readers === 1 ? "reader reacted" : "readers reacted", value: page.readers },
		{ label: page.comments === 1 ? "comment" : "comments", value: page.comments },
	].filter((stat, i) => i < 2 || stat.value > 0); // no "0 comments" on a new page
	return (
		<dl className="author-stats">
			{stats.map((stat) => (
				<div key={stat.label} className="author-stat">
					<dd>{compact(stat.value)}</dd>
					<dt>{stat.label}</dt>
				</div>
			))}
		</dl>
	);
}
