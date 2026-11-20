import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PostTile } from "../components/PostCard";
import { tileSizes } from "../components/tileSizes";
import { useFeedMotion } from "../components/useFeedMotion";
import { useDeleted } from "../lib/deleted";
import { share } from "../lib/share";
import type { AuthorPage } from "../lib/types";
import { useYou } from "../lib/you";
import { getAuthorPage, getAuthorPosts } from "../server/site.functions";

// /@<handle>: an author's page, the same for everyone (stored 15 minutes,
// lib/keep.ts). Who they are, then their posts as the homepage draws them,
// newest leading across the full width, 24 at a time as you scroll; the
// island under the site's carries the numbers. Whether it's you is worked
// out in the browser, once the page is up.
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

/** How far below the screen the next posts start loading, so they're usually there before you reach them. */
const AHEAD = "0px 0px 1600px 0px";

function AuthorRoute() {
	const page = Route.useLoaderData();
	// A new page (another author, or this one fetched again) starts the list over.
	return <AuthorPosts key={`${page.author.handle}~${page.pieces.length}~${page.pieces[0]?.id ?? ""}~${page.next ?? ""}`} page={page} />;
}

function AuthorPosts({ page }: { page: AuthorPage }) {
	const you = useYou();
	const isYou = you?.user?.author?.handle.toLowerCase() === page.author.handle.toLowerCase();
	const [pieces, setPieces] = useState(page.pieces);
	const [next, setNext] = useState(page.next);
	const [loading, setLoading] = useState(false);
	const [failed, setFailed] = useState(false);
	const list = useRef<HTMLUListElement>(null);
	const end = useRef<HTMLDivElement>(null);
	useFeedMotion(list, pieces.length);
	// Less any you've just deleted (lib/deleted.ts).
	const deleted = useDeleted();
	const visible = deleted.size ? pieces.filter((post) => !deleted.has(post.id)) : pieces;
	const sizes = tileSizes(visible.length, !next);

	async function loadMore() {
		if (!next || loading) return;
		setLoading(true);
		setFailed(false);
		try {
			const batch = await getAuthorPosts({ data: { handle: page.author.handle, after: next } });
			setPieces((already) => [...already, ...batch.pieces]);
			setNext(batch.next);
		} catch {
			setFailed(true);
		} finally {
			setLoading(false);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-armed as the list grows and loads, not on every render.
	useEffect(() => {
		const marker = end.current;
		if (!marker || !next || loading || failed) return;
		const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && loadMore(), { rootMargin: AHEAD });
		observer.observe(marker);
		return () => observer.disconnect();
	}, [pieces.length, next, loading, failed]);

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

			{visible.length === 0 ? (
				<p className="author-empty">
					{isYou
						? "Nothing here yet. A post you publish from Fold MD appears here 15 minutes later, once it can't be fixed any more. Its link works at once."
						: "Nothing published yet."}
				</p>
			) : (
				<>
					<ul ref={list} className="tiles" aria-label="Posts">
						{visible.map((post, i) => (
							<li key={post.id} className={`tiles-item tiles-${sizes[i]}`}>
								<PostTile post={post} size={sizes[i]} eyebrow={post.parts ? `A series in ${post.parts} parts` : null} />
							</li>
						))}
					</ul>
					{(next || failed) && (
						<div ref={end} className="feed-end" aria-live="polite">
							{failed ? (
								<button type="button" className="feed-retry" onClick={loadMore}>
									Couldn't load more. Try again
								</button>
							) : (
								<span className="feed-loading">
									<span className="live-dot" aria-hidden="true" />
									{loading ? "Loading more" : "More below"}
								</span>
							)}
						</div>
					)}
				</>
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
